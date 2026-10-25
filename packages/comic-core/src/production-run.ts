import { ComicDomainError, type ComicErrorParams, type ReadableComicError } from "./errors.js";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { lock as acquireFileLock } from "proper-lockfile";

import type { ComicProject } from "./types.js";

/** This is a resumable media-queue slice, not a finished episode renderer. */
export const COMIC_PRODUCTION_RUN_SCHEMA_VERSION = 1 as const;
export const COMIC_PRODUCTION_RUN_FILE = "comic-production-runs-v1.json" as const;
const MAX_STORE_BYTES = 8 * 1024 * 1024;
const MAX_RUNS = 100;
const MAX_SHOTS_PER_RUN = 100;
const LOCK_WAIT_MS = 5_000;
// proper-lockfile refreshes this directory lock during live async operations.
const LOCK_STALE_MS = 120_000;
const LOCK_UPDATE_MS = 10_000;

export type ComicRunMediaKind = "image" | "speech";
export type ComicRunBilling = "free" | "provider_billed" | "platform_billed";
export type ComicRunStatus = "planning" | "queuing" | "running" | "media_ready" | "needs_attention";
export type ComicRunTaskStatus = "planned" | "awaiting_confirmation" | "queued" | "running" | "awaiting_attachment" | "succeeded" | "skipped" | "failed";

export interface ComicRunRouteApproval {
  readonly kind: ComicRunMediaKind;
  readonly connectionId: string;
  readonly model: string;
  readonly billing: ComicRunBilling;
  /** One job's authorized estimate. Paid routes require a positive quote. */
  readonly estimatedCostMicros: number;
  readonly description: string;
  readonly keyPriceQuoteId?: string;
  readonly voice?: string;
}

/** The trusted host must verify this snapshot against a real user approval. */
export interface ComicRunAuthorization {
  readonly approvalId: string;
  readonly approvedAt: string;
  readonly maxEstimatedCostMicros: number;
  readonly routes: readonly ComicRunRouteApproval[];
}

export interface StartComicProductionRunRequest {
  readonly requestKey: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly scriptVersion: number;
  readonly authorization: ComicRunAuthorization;
}

export interface ComicRunImageInput {
  readonly connectionId: string;
  readonly model: string;
  readonly prompt: string;
  readonly width: number;
  readonly height: number;
  readonly keyPriceQuoteId?: string;
}

export interface ComicRunSpeechInput {
  readonly connectionId: string;
  readonly model: string;
  readonly text: string;
  readonly voice: string;
  readonly format: "mp3";
  readonly keyPriceQuoteId?: string;
}

export interface ComicRunJobRequest {
  readonly idempotencyKey: string;
  readonly kind: ComicRunMediaKind;
  readonly projectId: string;
  readonly sceneId: string;
  readonly shotId: string;
  readonly input: ComicRunImageInput | ComicRunSpeechInput;
  readonly cost: { readonly billing: ComicRunBilling; readonly description: string };
}

export interface ComicRunTask {
  readonly key: string;
  readonly request: ComicRunJobRequest;
  readonly estimatedCostMicros: number;
  readonly status: ComicRunTaskStatus;
  readonly jobId?: string;
  readonly interruptedRetries?: number;
}

export interface ComicProductionRun {
  readonly id: string;
  readonly requestKey: string;
  readonly requestHash: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly scriptVersion: number;
  readonly authorization: ComicRunAuthorization;
  readonly status: ComicRunStatus;
  readonly tasks: readonly ComicRunTask[];
  readonly createdAt: string;
  readonly updatedAt: string;
  /** English diagnostic summary, retained for older readers. */
  readonly lastError?: string;
  readonly lastErrorInfo?: ReadableComicError;
}

interface ComicProductionRunsState {
  readonly schemaVersion: typeof COMIC_PRODUCTION_RUN_SCHEMA_VERSION;
  readonly revision: number;
  readonly runs: readonly ComicProductionRun[];
}

export class ComicProductionRunError extends ComicDomainError {
  constructor(code: string, message: string, messageKey = "comic.operation_failed", params: ComicErrorParams = {}) {
    super(code, message, messageKey, params);
    this.name = "ComicProductionRunError";
  }
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 160 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new ComicProductionRunError("INVALID_PRODUCTION_RUN", `${label} is invalid`, "comic.invalid_production_run.is_invalid", { field: label });
  }
  return value;
}

function validAuthorization(value: ComicRunAuthorization): ComicRunAuthorization {
  if (!value || typeof value !== "object" || !Array.isArray(value.routes) || value.routes.length > 2
      || !Number.isSafeInteger(value.maxEstimatedCostMicros) || value.maxEstimatedCostMicros < 0
      || typeof value.approvedAt !== "string" || !Number.isFinite(Date.parse(value.approvedAt))) {
    throw new ComicProductionRunError("INVALID_PRODUCTION_AUTHORIZATION", "Comic production authorization is invalid", "comic.invalid_production_authorization.comic_production_authorization_is_invalid", {});
  }
  identifier(value.approvalId, "approvalId");
  const kinds = new Set<ComicRunMediaKind>();
  for (const route of value.routes) {
    if (!route || (route.kind !== "image" && route.kind !== "speech") || kinds.has(route.kind)
        || !["free", "provider_billed", "platform_billed"].includes(route.billing)
        || !Number.isSafeInteger(route.estimatedCostMicros) || route.estimatedCostMicros < 0
        || (route.billing !== "free" && route.estimatedCostMicros === 0)
        || (route.billing === "free" && route.estimatedCostMicros !== 0)
        || typeof route.model !== "string" || !route.model.trim() || route.model.length > 200 || /[\r\n\0]/.test(route.model)
        || typeof route.description !== "string" || !route.description.trim() || route.description.length > 240 || /[\r\n\0]/.test(route.description)
        || (route.keyPriceQuoteId !== undefined && (!/^kq1_[a-f0-9]{64}$/.test(route.keyPriceQuoteId) || !route.connectionId.startsWith("managed:")))
        || (route.voice !== undefined && (typeof route.voice !== "string" || route.voice.length > 100))) {
      throw new ComicProductionRunError("INVALID_PRODUCTION_AUTHORIZATION", "Comic media route authorization is invalid", "comic.invalid_production_authorization.comic_media_route_authorization_is_invalid", {});
    }
    const localImage = route.kind === "image" && route.connectionId === "comfyui:local" && route.billing === "free";
    const officialPaid = /^official-[0-9a-f-]{36}$/.test(route.connectionId) && route.billing === "provider_billed";
    const managedPaid = /^managed:(?:auto|fixed):[0-9a-f-]{36}$/.test(route.connectionId) && route.billing === "platform_billed";
    if (!localImage && !officialPaid && !managedPaid) {
      throw new ComicProductionRunError("INVALID_PRODUCTION_AUTHORIZATION", "Comic media route does not match its billing method", "comic.invalid_production_authorization.comic_media_route_does_not_match_its_billing_method", {});
    }
    kinds.add(route.kind);
  }
  return value;
}

function validRequest(value: StartComicProductionRunRequest): StartComicProductionRunRequest {
  if (!value || typeof value !== "object" || !Number.isSafeInteger(value.scriptVersion) || value.scriptVersion < 1) {
    throw new ComicProductionRunError("INVALID_PRODUCTION_RUN", "Comic production request is invalid", "comic.invalid_production_run.comic_production_request_is_invalid", {});
  }
  identifier(value.requestKey, "requestKey");
  identifier(value.workspaceId, "workspaceId");
  identifier(value.projectId, "projectId");
  validAuthorization(value.authorization);
  return value;
}

function validErrorInfo(value: unknown): value is ReadableComicError {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<ReadableComicError>;
  return item.kind === "unknown" && item.domain === "comic"
    && typeof item.code === "string" && /^[A-Z][A-Z0-9_]{0,99}$/.test(item.code)
    && typeof item.messageKey === "string" && /^comic\.[a-z0-9_.]{1,240}$/.test(item.messageKey)
    && typeof item.detail === "string" && item.detail.length <= 500
    && !!item.params && typeof item.params === "object" && !Array.isArray(item.params)
    && Object.entries(item.params).length <= 24
    && Object.entries(item.params).every(([key, param]) => /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(key)
      && (typeof param === "boolean" || typeof param === "number" && Number.isFinite(param)
        || typeof param === "string" && param.length <= 500));
}

function validState(value: unknown): ComicProductionRunsState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ComicProductionRunError("PRODUCTION_RUN_CORRUPT", "Comic production record is invalid", "comic.production_run_corrupt.comic_production_record_is_invalid", {});
  }
  const state = value as Partial<ComicProductionRunsState>;
  if (state.schemaVersion !== COMIC_PRODUCTION_RUN_SCHEMA_VERSION || !Number.isSafeInteger(state.revision)
      || (state.revision ?? -1) < 0 || !Array.isArray(state.runs) || state.runs.length > MAX_RUNS) {
    throw new ComicProductionRunError("PRODUCTION_RUN_CORRUPT", "Comic production record version or count is invalid", "comic.production_run_corrupt.comic_production_record_version_or_count_is_invalid", {});
  }
  const ids = new Set<string>();
  const requestKeys = new Set<string>();
  for (const run of state.runs) {
    if (!run || typeof run !== "object" || !run.id?.startsWith("comic-run-")
        || !/^[a-f0-9]{64}$/.test(run.requestHash) || ids.has(run.id) || requestKeys.has(run.requestKey)
        || !["planning", "queuing", "running", "media_ready", "needs_attention"].includes(run.status)
        || !Array.isArray(run.tasks) || run.tasks.length > MAX_SHOTS_PER_RUN * 2
        || typeof run.createdAt !== "string" || typeof run.updatedAt !== "string"
        || (run.lastError !== undefined && (typeof run.lastError !== "string" || run.lastError.length > 500))
        || (run.lastErrorInfo !== undefined && !validErrorInfo(run.lastErrorInfo))) {
      throw new ComicProductionRunError("PRODUCTION_RUN_CORRUPT", "Comic production record content is invalid", "comic.production_run_corrupt.comic_production_record_content_is_invalid", {});
    }
    identifier(run.id, "runId");
    validRequest(run);
    for (const task of run.tasks) {
      if (!task || typeof task !== "object" || typeof task.key !== "string"
          || !task.request || task.request.idempotencyKey !== task.key
          || !["planned", "awaiting_confirmation", "queued", "running", "awaiting_attachment", "succeeded", "skipped", "failed"].includes(task.status)
          || !Number.isSafeInteger(task.estimatedCostMicros) || task.estimatedCostMicros < 0
          || (task.jobId !== undefined && (typeof task.jobId !== "string" || task.jobId.length > 160))
          || (task.interruptedRetries !== undefined && (!Number.isSafeInteger(task.interruptedRetries) || task.interruptedRetries < 0 || task.interruptedRetries > 10))) {
        throw new ComicProductionRunError("PRODUCTION_RUN_CORRUPT", "Comic production task content is invalid", "comic.production_run_corrupt.comic_production_task_content_is_invalid", {});
      }
    }
    ids.add(run.id);
    requestKeys.add(run.requestKey);
  }
  return { ...state, runs: state.runs.map(run => run.lastError && !run.lastErrorInfo
    ? { ...run, lastErrorInfo: { kind: "unknown", domain: "comic", code: "PRODUCTION_NEEDS_ATTENTION",
      messageKey: "comic.production_waiting", params: {}, detail: run.lastError } }
    : run) } as ComicProductionRunsState;
}

async function atomicWrite(pathname: string, content: string, verifyOwnership: () => void): Promise<void> {
  const temporary = join(dirname(pathname), `.${randomUUID()}.comic-run.tmp`);
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(content, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    verifyOwnership();
    await rename(temporary, pathname);
  }
  catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
}

async function acquireProductionLock(pathname: string, lockPath: string): Promise<{
  readonly release: () => Promise<void>;
  readonly verifyOwnership: () => void;
}> {
  let compromised: Error | undefined;
  let release: () => Promise<void>;
  try {
    release = await acquireFileLock(pathname, {
      realpath: false, lockfilePath: lockPath,
      stale: LOCK_STALE_MS, update: LOCK_UPDATE_MS,
      retries: { retries: Math.ceil(LOCK_WAIT_MS / 50), factor: 1, minTimeout: 50, maxTimeout: 50 },
      onCompromised: error => { compromised = error; },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOCKED") throw new ComicProductionRunError("PRODUCTION_RUN_BUSY", "Comic production records are being saved by another operation", "comic.production_run_busy.comic_production_records_are_being_saved_by_another_operation", {});
    throw new ComicProductionRunError("PRODUCTION_RUN_LOCK_FAILED", "Unable to lock comic production records", "comic.production_run_lock_failed.unable_to_lock_comic_production_records", {});
  }
  return {
    release,
    verifyOwnership: () => {
      if (compromised) throw new ComicProductionRunError("PRODUCTION_RUN_LOCK_COMPROMISED", "Comic production record lock was lost; check the result again", "comic.production_run_lock_compromised.comic_production_record_lock_was_lost_check_the_result_again", {});
    },
  };
}

/** Store is scoped to one canonical workspace by its trusted host. */
export class ComicProductionRunStore {
  readonly #root: string;
  readonly #rootIdentity: { readonly dev: number; readonly ino: number };
  readonly #path: string;
  readonly #lockPath: string;

  private constructor(root: string, rootIdentity: { readonly dev: number; readonly ino: number }) {
    this.#root = root;
    this.#rootIdentity = rootIdentity;
    this.#path = join(root, COMIC_PRODUCTION_RUN_FILE);
    this.#lockPath = `${this.#path}.lock`;
  }

  static async create(root: string): Promise<ComicProductionRunStore> {
    if (typeof root !== "string" || !root.trim()) throw new ComicProductionRunError("INVALID_RUN_ROOT", "Comic production record directory is invalid", "comic.invalid_run_root.comic_production_record_directory_is_invalid", {});
    const requested = resolve(root);
    await mkdir(requested, { recursive: true, mode: 0o700 });
    if ((await lstat(requested)).isSymbolicLink()) throw new ComicProductionRunError("INVALID_RUN_ROOT", "Comic production record directory cannot be a symbolic link", "comic.invalid_run_root.comic_production_record_directory_cannot_be_a_symbolic_link", {});
    const canonical = await realpath(requested);
    const metadata = await lstat(canonical);
    if (!metadata.isDirectory()) throw new ComicProductionRunError("INVALID_RUN_ROOT", "Comic production record directory is invalid", "comic.invalid_run_root.comic_production_record_directory_is_invalid", {});
    return new ComicProductionRunStore(canonical, { dev: metadata.dev, ino: metadata.ino });
  }

  get root(): string { return this.#root; }

  async #verifyRoot(): Promise<void> {
    try {
      const metadata = await lstat(this.#root);
      if (metadata.isDirectory() && metadata.dev === this.#rootIdentity.dev && metadata.ino === this.#rootIdentity.ino) return;
    } catch { /* Report one stable error below. */ }
    throw new ComicProductionRunError("PRODUCTION_RUN_ROOT_CHANGED", "Comic production record directory was replaced; reopen the workspace", "comic.production_run_root_changed.comic_production_record_directory_was_replaced_reopen_the_workspace", {});
  }

  async read(): Promise<ComicProductionRunsState> {
    await this.#verifyRoot();
    let raw: string;
    try {
      const before = await lstat(this.#path);
      if (!before.isFile() || before.size > MAX_STORE_BYTES) throw new ComicProductionRunError("PRODUCTION_RUN_CORRUPT", "Comic production record file exceeds the limit", "comic.production_run_corrupt.comic_production_record_file_exceeds_the_limit", { maximum: MAX_STORE_BYTES });
      // O_NOFOLLOW protects POSIX. The before/fd/after identity checks also
      // reject replacement on platforms where that flag is unavailable.
      const file = await open(this.#path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const metadata = await file.stat();
        const after = await lstat(this.#path);
        if (!metadata.isFile() || !after.isFile() || metadata.size > MAX_STORE_BYTES
            || metadata.dev !== before.dev || metadata.ino !== before.ino
            || after.dev !== metadata.dev || after.ino !== metadata.ino) {
          throw new ComicProductionRunError("PRODUCTION_RUN_CORRUPT", "Comic production record was replaced while reading", "comic.production_run_corrupt.comic_production_record_was_replaced_while_reading", {});
        }
        raw = await file.readFile("utf8");
      } finally {
        await file.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: COMIC_PRODUCTION_RUN_SCHEMA_VERSION, revision: 0, runs: [] };
      if (error instanceof ComicProductionRunError) throw error;
      throw new ComicProductionRunError("PRODUCTION_RUN_UNAVAILABLE", "Unable to read comic production records", "comic.production_run_unavailable.unable_to_read_comic_production_records", {});
    }
    try { return validState(JSON.parse(raw)); }
    catch (error) {
      if (error instanceof ComicProductionRunError) throw error;
      throw new ComicProductionRunError("PRODUCTION_RUN_CORRUPT", "Comic production records are not valid JSON", "comic.production_run_corrupt.comic_production_records_are_not_valid_json", {});
    }
  }

  async get(runId: string): Promise<ComicProductionRun> {
    identifier(runId, "runId");
    const run = (await this.read()).runs.find(candidate => candidate.id === runId);
    if (!run) throw new ComicProductionRunError("PRODUCTION_RUN_NOT_FOUND", "Comic production run does not exist", "comic.production_run_not_found.comic_production_run_does_not_exist", {});
    return run;
  }

  /** Serializes analysis and queue side effects for one run across processes. */
  async withRunLock<T>(runId: string, work: (verifyOwnership: () => void) => Promise<T>): Promise<T> {
    identifier(runId, "runId");
    await this.#verifyRoot();
    const pathname = join(this.#root, `.${runId}`);
    const lock = await acquireProductionLock(pathname, `${pathname}.lock`);
    try {
      const result = await work(lock.verifyOwnership);
      lock.verifyOwnership();
      return result;
    } finally {
      try {
        await lock.release();
      } catch {
        // Ignore release errors so primary or ownership-verification errors are not masked.
      }
    }
  }

  async start(requestValue: StartComicProductionRunRequest): Promise<ComicProductionRun> {
    const request = validRequest(requestValue);
    const requestHash = hash(request);
    return this.#mutate(state => {
      const existing = state.runs.find(run => run.requestKey === request.requestKey);
      if (existing) {
        if (existing.requestHash !== requestHash) throw new ComicProductionRunError("PRODUCTION_RUN_IDEMPOTENCY_CONFLICT", "The idempotency key is already used for a different production plan", "comic.production_run_idempotency_conflict.the_idempotency_key_is_already_used_for_a_different_production_plan", {});
        return { state, result: existing, changed: false };
      }
      if (state.runs.length >= MAX_RUNS) throw new ComicProductionRunError("PRODUCTION_RUN_FULL", "Comic production record count has reached the limit", "comic.production_run_full.comic_production_record_count_has_reached_the_limit", { maximum: MAX_RUNS });
      const now = new Date().toISOString();
      const run: ComicProductionRun = {
        id: `comic-run-${randomUUID()}`, requestKey: request.requestKey, requestHash,
        workspaceId: request.workspaceId, projectId: request.projectId, scriptVersion: request.scriptVersion,
        authorization: request.authorization, status: "planning", tasks: [], createdAt: now, updatedAt: now,
      };
      return { state: { ...state, runs: [...state.runs, run] }, result: run, changed: true };
    });
  }

  async update(runId: string, change: (run: ComicProductionRun) => ComicProductionRun | Promise<ComicProductionRun>): Promise<ComicProductionRun> {
    identifier(runId, "runId");
    return this.#mutate(async state => {
      const index = state.runs.findIndex(run => run.id === runId);
      if (index < 0) throw new ComicProductionRunError("PRODUCTION_RUN_NOT_FOUND", "Comic production run does not exist", "comic.production_run_not_found.comic_production_run_does_not_exist", {});
      const previous = state.runs[index];
      const next = await change(previous);
      if (next === previous) return { state, result: previous, changed: false };
      if (next.id !== previous.id || next.requestHash !== previous.requestHash || next.projectId !== previous.projectId
          || next.workspaceId !== previous.workspaceId || next.scriptVersion !== previous.scriptVersion
          || hash(next.authorization) !== hash(previous.authorization)) {
        throw new ComicProductionRunError("PRODUCTION_RUN_IMMUTABLE", "Production plans and authorization snapshots cannot be changed", "comic.production_run_immutable.production_plans_and_authorization_snapshots_cannot_be_changed", {});
      }
      const updated = { ...next, updatedAt: new Date().toISOString() };
      const runs = [...state.runs];
      runs[index] = updated;
      return { state: { ...state, runs }, result: updated, changed: true };
    });
  }

  async #mutate<T>(change: (state: ComicProductionRunsState) => { state: ComicProductionRunsState; result: T; changed: boolean } | Promise<{ state: ComicProductionRunsState; result: T; changed: boolean }>): Promise<T> {
    await this.#verifyRoot();
    const lock = await acquireProductionLock(this.#path, this.#lockPath);
    try {
      await this.#verifyRoot();
      const current = await this.read();
      const result = await change(current);
      if (result.changed) {
        const next = validState({ ...result.state, revision: current.revision + 1 });
        const content = `${JSON.stringify(next, undefined, 2)}\n`;
        if (Buffer.byteLength(content, "utf8") > MAX_STORE_BYTES) throw new ComicProductionRunError("PRODUCTION_RUN_FULL", "Comic production records exceed the disk size limit", "comic.production_run_full.comic_production_records_exceed_the_disk_size_limit", { maximum: MAX_STORE_BYTES });
        await this.#verifyRoot();
        await atomicWrite(this.#path, content, lock.verifyOwnership);
      }
      lock.verifyOwnership();
      return result.result;
    } finally {
      try {
        await lock.release();
      } catch {
        // Ignore release errors so primary or ownership-verification errors are not masked.
      }
    }
  }
}

export interface ComicRunProjectState {
  readonly project: ComicProject;
  readonly scriptVersion: number;
  readonly analysisReady: boolean;
  /** Trusted host has verified that every analyzed scene/shot is applied. */
  readonly analysisApplied: boolean;
}

export interface ComicRunMediaJob {
  readonly id: string;
  readonly status: "awaiting_confirmation" | "queued" | "paused" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
}

/** Ports bind one workspace; authorization must be checked by a trusted host. */
export interface ComicProductionRunPorts {
  loadProject(): Promise<ComicRunProjectState>;
  applyAnalysis(expectedRevision: number): Promise<ComicRunProjectState>;
  authorize(authorization: ComicRunAuthorization, tasks: readonly ComicRunTask[]): Promise<void>;
  enqueueMediaJob(request: ComicRunJobRequest): Promise<ComicRunMediaJob>;
  /** The trusted host must check job source against the current project while
   * releasing this confirmation. The coordinator's preceding loadProject is
   * not atomic with this paid side effect across project-store processes. */
  confirmMediaJob(jobId: string, authorization: ComicRunAuthorization): Promise<ComicRunMediaJob>;
  getMediaJob(jobId: string): Promise<ComicRunMediaJob>;
  /**
   * Re-queues an interrupted job under its own record, as MediaJobStore.retry does, and resolves with the job unchanged
   * when it may not be retried: a paid request whose provider outcome is unknown, or one that used its attempts.
   * Rejects only when the queue cannot be read or written. Without this port an interrupted task waits for the user.
   */
  retryMediaJob?(jobId: string): Promise<ComicRunMediaJob>;
}

/** Automatic retries of an interrupted media job per task; after them the task fails and waits for the user. */
const MAX_INTERRUPTED_RETRIES = 3;

function plannedTasks(run: ComicProductionRun, project: ComicProject): readonly ComicRunTask[] {
  const shots = project.scenes.flatMap(scene => scene.shots.map(shot => ({ scene, shot })));
  if (!shots.length) throw new ComicProductionRunError("PRODUCTION_STORYBOARD_EMPTY", "Script analysis did not produce any shots to render", "comic.production_storyboard_empty.script_analysis_did_not_produce_any_shots_to_render", {});
  if (shots.length > MAX_SHOTS_PER_RUN) throw new ComicProductionRunError("PRODUCTION_RUN_TOO_LARGE", "One automatic production run supports at most 100 shots", "comic.production_run_too_large.one_automatic_production_run_supports_at_most_100_shots", { maximum: 100 });
  const routes = new Map(run.authorization.routes.map(route => [route.kind, route]));
  const tasks: ComicRunTask[] = [];
  for (const { scene, shot } of shots) {
    for (const kind of ["image", "speech"] as const) {
      if (kind === "image" && (readyAsset(project, shot.visualAssetId, "image") || readyAsset(project, shot.videoAssetId, "video"))) continue;
      if (kind === "speech" && (readyAsset(project, shot.audioAssetId, "audio") || !shot.dialogueCues.length)) continue;
      const route = routes.get(kind);
      if (!route) throw new ComicProductionRunError("PRODUCTION_ROUTE_MISSING", `No authorized media route is available for ${kind}`, "comic.production_route_missing.no_authorized_media_route_is_available_for", { kind });
      const text = shot.dialogueCues.map(cue => cue.text.trim()).filter(Boolean).join("\n");
      if (kind === "speech" && (!text || text.length > 20_000)) throw new ComicProductionRunError("PRODUCTION_SPEECH_TOO_LONG", "Shot speech text exceeds the per-task length limit", "comic.production_speech_too_long.shot_speech_text_exceeds_the_per_task_length_limit", { maximum: 20_000, actual: text.length });
      const key = `comic-run-${hash([run.id, scene.id, shot.id, kind]).slice(0, 48)}`;
      const input = kind === "image"
        ? { connectionId: route.connectionId, model: route.model, prompt: shot.visualPrompt || shot.description || shot.title, width: project.canvas.width, height: project.canvas.height,
            ...(route.keyPriceQuoteId ? { keyPriceQuoteId: route.keyPriceQuoteId } : {}) }
        : { connectionId: route.connectionId, model: route.model, text, voice: route.voice || "alloy", format: "mp3" as const,
            ...(route.keyPriceQuoteId ? { keyPriceQuoteId: route.keyPriceQuoteId } : {}) };
      tasks.push({ key, request: { idempotencyKey: key, kind, projectId: project.id, sceneId: scene.id, shotId: shot.id,
        input, cost: { billing: route.billing, description: route.description } }, estimatedCostMicros: route.estimatedCostMicros,
        status: "planned" });
    }
  }
  const total = tasks.reduce((sum, task) => sum + task.estimatedCostMicros, 0);
  if (!Number.isSafeInteger(total) || total > run.authorization.maxEstimatedCostMicros) {
    throw new ComicProductionRunError("PRODUCTION_BUDGET_EXCEEDED", "Estimated media cost exceeds the authorized budget", "comic.production_budget_exceeded.estimated_media_cost_exceeds_the_authorized_budget", { maximum: run.authorization.maxEstimatedCostMicros, actual: total });
  }
  return tasks;
}

function readyAsset(project: ComicProject, assetId: string | undefined, kind: "image" | "video" | "audio"): boolean {
  return Boolean(assetId && project.assets.some(asset => asset.id === assetId && asset.kind === kind && asset.status === "ready"));
}

function taskAssetReady(project: ComicProject, task: ComicRunTask): boolean {
  const shot = project.scenes.find(scene => scene.id === task.request.sceneId)?.shots.find(shot => shot.id === task.request.shotId);
  return Boolean(shot && (task.request.kind === "image"
    ? readyAsset(project, shot.visualAssetId, "image") || readyAsset(project, shot.videoAssetId, "video")
    : readyAsset(project, shot.audioAssetId, "audio")));
}

function storyboardMediaReady(project: ComicProject): boolean {
  const shots = project.scenes.flatMap(scene => scene.shots);
  return shots.length > 0 && shots.every(shot =>
    (readyAsset(project, shot.visualAssetId, "image") || readyAsset(project, shot.videoAssetId, "video"))
    && (!shot.dialogueCues.length || readyAsset(project, shot.audioAssetId, "audio")));
}

function taskSourceCurrent(project: ComicProject, task: ComicRunTask): boolean {
  const shot = project.scenes.find(scene => scene.id === task.request.sceneId)?.shots.find(candidate => candidate.id === task.request.shotId);
  if (!shot) return false;
  if (task.request.kind === "image") {
    const input = task.request.input as ComicRunImageInput;
    return input.prompt === (shot.visualPrompt || shot.description || shot.title)
      && input.width === project.canvas.width && input.height === project.canvas.height;
  }
  const input = task.request.input as ComicRunSpeechInput;
  return input.text === shot.dialogueCues.map(cue => cue.text.trim()).filter(Boolean).join("\n");
}

/** Advance may be repeated after a crash; stable job keys make enqueue replay safe. */
export class ComicProductionRunCoordinator {
  constructor(private readonly store: ComicProductionRunStore, private readonly ports: ComicProductionRunPorts) {}

  async start(request: StartComicProductionRunRequest): Promise<ComicProductionRun> {
    const run = await this.store.start(request);
    return this.advance(run.id);
  }

  async advance(runId: string): Promise<ComicProductionRun> {
    return this.store.withRunLock(runId, verifyOwnership => this.#advanceLocked(runId, verifyOwnership));
  }

  async #advanceLocked(runId: string, verifyOwnership: () => void): Promise<ComicProductionRun> {
    let run = await this.store.get(runId);
    try {
      let state = await this.ports.loadProject();
      if (state.project.id !== run.projectId || state.scriptVersion !== run.scriptVersion) {
        throw new ComicProductionRunError("PRODUCTION_SOURCE_CHANGED", "The project or script changed; create a new production plan", "comic.production_source_changed.the_project_or_script_changed_create_a_new_production_plan", {});
      }
      if (run.status === "media_ready") {
        if (!storyboardMediaReady(state.project) || run.tasks.some(task => !taskAssetReady(state.project, task))) {
          throw new ComicProductionRunError("PRODUCTION_MEDIA_MISSING", "Completed shot media was removed; check the storyboard and render again", "comic.production_media_missing.completed_shot_media_was_removed_check_the_storyboard_and_render_again", {});
        }
        return run;
      }
      if (!run.tasks.length) {
        if (!state.analysisReady) throw new ComicProductionRunError("PRODUCTION_ANALYSIS_MISSING", "Provide a script before starting analysis", "comic.production_analysis_missing.provide_a_script_before_starting_analysis", {});
        if (!state.analysisApplied) state = await this.ports.applyAnalysis(state.project.revision);
        if (!state.analysisApplied) {
          throw new ComicProductionRunError("PRODUCTION_ANALYSIS_INCOMPLETE", "Script analysis is not fully applied; repair missing scenes or shots", "comic.production_analysis_incomplete.script_analysis_is_not_fully_applied_repair_missing_scenes_or_shots", {});
        }
        if (state.project.id !== run.projectId || state.scriptVersion !== run.scriptVersion) {
          throw new ComicProductionRunError("PRODUCTION_SOURCE_CHANGED", "The project or script changed during storyboard analysis", "comic.production_source_changed.the_project_or_script_changed_during_storyboard_analysis", {});
        }
        const tasks = plannedTasks(run, state.project);
        await this.ports.authorize(run.authorization, tasks);
        run = await this.store.update(run.id, current => current.tasks.length ? current : { ...current, tasks, status: "queuing", lastError: undefined, lastErrorInfo: undefined });
      } else {
        if (!state.analysisApplied) throw new ComicProductionRunError("PRODUCTION_ANALYSIS_INCOMPLETE", "The storyboard is incomplete; no further media tasks will be submitted", "comic.production_analysis_incomplete.the_storyboard_is_incomplete_no_further_media_tasks_will_be_submitted", {});
        await this.ports.authorize(run.authorization, run.tasks);
      }
      for (const initialTask of run.tasks) {
        let task = (await this.store.get(run.id)).tasks.find(candidate => candidate.key === initialTask.key)!;
        const latest = await this.ports.loadProject();
        if (latest.project.id !== run.projectId || latest.scriptVersion !== run.scriptVersion) {
          throw new ComicProductionRunError("PRODUCTION_SOURCE_CHANGED", "The project or script changed; check unfinished media tasks", "comic.production_source_changed.the_project_or_script_changed_check_unfinished_media_tasks", {});
        }
        if (task.status === "succeeded" || task.status === "skipped") {
          if (!taskAssetReady(latest.project, task)) {
            throw new ComicProductionRunError("PRODUCTION_MEDIA_MISSING", "Completed shot media was removed; check the storyboard and render again", "comic.production_media_missing.completed_shot_media_was_removed_check_the_storyboard_and_render_again", {});
          }
          continue;
        }
        if (!task.jobId && taskAssetReady(latest.project, task)) {
          await this.#updateTask(run.id, task.key, { ...task, status: "skipped" });
          continue;
        }
        if (!task.jobId) {
          if (!taskSourceCurrent(latest.project, task)) {
            throw new ComicProductionRunError("PRODUCTION_SOURCE_CHANGED", "The shot changed; its previous media request will not be submitted automatically", "comic.production_source_changed.the_shot_changed_its_previous_media_request_will_not_be_submitted_automatically", {});
          }
          verifyOwnership();
          const job = await this.ports.enqueueMediaJob(task.request);
          task = await this.#updateTask(run.id, task.key, { ...task, jobId: job.id, status: job.status === "awaiting_confirmation" ? "awaiting_confirmation" : "queued" });
        }
        let job = await this.ports.getMediaJob(task.jobId!);
        const interruptedRetries = task.interruptedRetries ?? 0;
        // An interrupted job is retried under its own record. Enqueueing the request again would only return that
        // record (the idempotency key matches) or, through another queue, submit a second paid request while the
        // first one's outcome is unknown.
        if (job.status === "interrupted" && this.ports.retryMediaJob && interruptedRetries < MAX_INTERRUPTED_RETRIES
            && !taskAssetReady(latest.project, task)) {
          if (!taskSourceCurrent(latest.project, task)) {
            throw new ComicProductionRunError("PRODUCTION_SOURCE_CHANGED", "The shot changed; its previous media request will not be submitted automatically", "comic.production_source_changed.the_shot_changed_its_previous_media_request_will_not_be_submitted_automatically", {});
          }
          verifyOwnership();
          // Counted before the retry, so a crash right after it cannot earn the task an extra one.
          task = await this.#updateTask(run.id, task.key, { ...task, interruptedRetries: interruptedRetries + 1 });
          job = await this.ports.retryMediaJob(job.id);
        }
        if (job.status === "awaiting_confirmation") {
          // The host rechecks the original route and budget approval immediately
          // before releasing a paid job. A queue record alone is not consent.
          await this.ports.authorize(run.authorization, (await this.store.get(run.id)).tasks);
          const current = await this.ports.loadProject();
          if (current.project.id !== run.projectId || current.scriptVersion !== run.scriptVersion
              || !current.analysisApplied || !taskSourceCurrent(current.project, task)
              || taskAssetReady(current.project, task)) {
            throw new ComicProductionRunError("PRODUCTION_SOURCE_CHANGED", "The shot changed or already has media; the previous paid request will not be confirmed automatically", "comic.production_source_changed.the_shot_changed_or_already_has_media_the_previous_paid_request_will_not_be_confirmed_automatically", {});
          }
          verifyOwnership();
          job = await this.ports.confirmMediaJob(job.id, run.authorization);
        }
        const status: ComicRunTaskStatus = job.status === "succeeded"
          ? taskAssetReady((await this.ports.loadProject()).project, task) ? "succeeded" : "awaiting_attachment"
          : job.status === "failed" || job.status === "cancelled" || job.status === "interrupted" ? "failed"
          : job.status === "awaiting_confirmation" ? "awaiting_confirmation"
          : job.status === "running" ? "running" : "queued";
        await this.#updateTask(run.id, task.key, { ...task, status });
      }
      const currentProject = await this.ports.loadProject();
      if (currentProject.project.id !== run.projectId || currentProject.scriptVersion !== run.scriptVersion) {
        throw new ComicProductionRunError("PRODUCTION_SOURCE_CHANGED", "The project or script changed; check unfinished media tasks", "comic.production_source_changed.the_project_or_script_changed_check_unfinished_media_tasks", {});
      }
      const allTasksFinished = (await this.store.get(run.id)).tasks.every(task => task.status === "succeeded" || task.status === "skipped");
      if (allTasksFinished && !storyboardMediaReady(currentProject.project)) {
        throw new ComicProductionRunError("PRODUCTION_MEDIA_MISSING", "Shot media is incomplete; the production cannot be marked ready to render", "comic.production_media_missing.shot_media_is_incomplete_the_production_cannot_be_marked_ready_to_render", {});
      }
      run = await this.store.update(run.id, current => ({ ...current,
        status: allTasksFinished ? "media_ready" : current.tasks.some(task => task.status === "failed") ? "needs_attention" : "running",
        lastError: undefined, lastErrorInfo: undefined }));
      return run;
    } catch (error) {
      if (error instanceof ComicProductionRunError && error.code === "PRODUCTION_RUN_LOCK_COMPROMISED") {
        throw error;
      }
      const message = error instanceof ComicDomainError ? error.message : "Comic media production needs attention";
      const info: ReadableComicError = error instanceof ComicDomainError ? error.readableError
        : { kind: "unknown", domain: "comic", code: "PRODUCTION_NEEDS_ATTENTION", messageKey: "comic.production_waiting", params: {},
          detail: error instanceof Error ? error.message : typeof error === "string" ? error : message };
      await this.store.update(run.id, current => ({ ...current, status: "needs_attention", lastError: message.slice(0, 500),
        lastErrorInfo: { ...info, detail: info.detail.slice(0, 500) } }));
      throw error;
    }
  }

  async #updateTask(runId: string, key: string, task: ComicRunTask): Promise<ComicRunTask> {
    const run = await this.store.update(runId, current => ({ ...current,
      tasks: current.tasks.map(candidate => candidate.key === key ? task : candidate), status: "running" }));
    return run.tasks.find(candidate => candidate.key === key)!;
  }
}
