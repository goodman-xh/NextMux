import { mediaMessage } from "./error-metadata.js";
import { capacityReasonMetadata, type CapacityWaitReason } from '@nextmux/model-runtime/capacity-reasons';
import { createHash, randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { lock as acquireFileLock } from "proper-lockfile";

import type {
  EnqueueMediaJobRequest,
  MediaJob,
  MediaJobCheckpoint,
  MediaJobFailure,
  MediaJobMutationOptions,
  MediaJobRemoteTask,
  MediaReferenceUpload,
  MediaJobStoreOptions,
  MediaQueueState,
  MediaWorkerLease,
} from "./types.js";
import { MEDIA_QUEUE_FILE, MEDIA_QUEUE_SCHEMA_VERSION } from "./types.js";
import {
  checkpoint,
  remoteTask,
  referenceUpload,
  enqueueRequest,
  failure,
  idempotencyKey,
  isoTimestamp,
  jobStatus,
  mediaInput,
  mediaJobId,
  MediaCoreError,
  safeInteger,
  workerId,
} from "./validation.js";

const MAX_HISTORY_JOBS_BYTES = 16 * 1024 * 1024;
const MAX_STORE_BYTES = 48 * 1024 * 1024;
const MAX_HISTORY_ARCHIVE_BYTES = MAX_HISTORY_JOBS_BYTES + 128 * 1024;
const MAX_ACTIVE_JOBS = 2_000;
const MAX_HISTORY_JOBS = 2_000;
const MAX_JOBS = MAX_ACTIVE_JOBS + MAX_HISTORY_JOBS;
const MAX_EVENTS_PER_JOB = 64;
const LOCK_WAIT_MS = 5_000;
const LOCK_STALE_MS = 40_000;
const LOCK_UPDATE_MS = 5_000;
const ATOMIC_WRITE_RETRIES = 8;
const MEDIA_HISTORY_FORMAT = "nextmux.media-job-history";
const MEDIA_HISTORY_VERSION = 2;
const MEDIA_HISTORY_SUFFIX = ".nmxmedia";
export const MEDIA_WORKER_LEASE_MS = 30_000;

interface MediaHistoryManifest {
  readonly format: typeof MEDIA_HISTORY_FORMAT;
  readonly version: typeof MEDIA_HISTORY_VERSION;
  readonly queueSchemaVersion: typeof MEDIA_QUEUE_SCHEMA_VERSION;
  readonly workspaceBinding: string;
  readonly createdAt: string;
  readonly assetsIncluded: false;
  readonly jobsCount: number;
  readonly jobsBytes: number;
  readonly jobsSha256: string;
  readonly contentSha256: string;
}

/** Deliberately excludes input, provider state, output paths, failure text and raw idempotency keys. */
interface MediaHistoryJobRecord {
  readonly id: string;
  readonly idempotencyDigest: string;
  readonly payloadHash: string;
  readonly kind: MediaJob["kind"];
  readonly projectId: string;
  readonly sceneId: string;
  readonly shotId: string;
  readonly billing: MediaJob["cost"]["billing"];
  readonly status: "succeeded" | "failed" | "cancelled";
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string;
}

export interface MediaHistoryArchiveExportResult {
  readonly file: string;
  readonly jobs: number;
  readonly bytes: number;
}

export interface MediaHistoryArchiveImportResult {
  readonly jobs: number;
  readonly bytes: number;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function isInside(root: string, candidate: string): boolean {
  const delta = relative(root, candidate);
  return delta === "" || (!delta.startsWith(`..${sep}`) && delta !== ".." && !isAbsolute(delta));
}

function validWorkspaceBinding(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function workerLease(timestamp: string): MediaWorkerLease {
  return { processId: process.pid, heartbeatAt: timestamp,
    expiresAt: new Date(Date.parse(timestamp) + MEDIA_WORKER_LEASE_MS).toISOString() };
}

function storedWorkerLease(value: MediaWorkerLease, index: number): MediaWorkerLease {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MediaCoreError("INVALID_MEDIA_STATE", mediaMessage("media.jobs_field_ownerlease_is_invalid", { index: index }));
  }
  return {
    processId: safeInteger(value.processId, `jobs[${index}].ownerLease.processId`, 1, 2 ** 31 - 1),
    heartbeatAt: isoTimestamp(value.heartbeatAt, `jobs[${index}].ownerLease.heartbeatAt`),
    expiresAt: isoTimestamp(value.expiresAt, `jobs[${index}].ownerLease.expiresAt`),
    ...(value.releasedAt === undefined ? {} : { releasedAt: isoTimestamp(value.releasedAt, `jobs[${index}].ownerLease.releasedAt`) }),
  };
}

function ownerIsGone(job: MediaJob, timestamp: string): boolean {
  const lease = job.ownerLease;
  // Legacy jobs have no verifiable owner. Another still-open old window may be executing them.
  if (!lease) return false;
  if (lease.releasedAt) return true;
  // A heartbeat timeout is a suspicion, not proof: a suspended app or busy event loop still owns its work.
  if (Date.parse(lease.expiresAt) > Date.parse(timestamp)) return false;
  try { process.kill(lease.processId, 0); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
}

function canResumeIdempotentSubmission(job: MediaJob): boolean {
  // The platform's video endpoint deduplicates POST by this job's unchanged idempotency key.
  // Never assume third-party media/music endpoints provide that guarantee.
  return (job.kind === "video" || job.capacityWaitRecorded === true) && 'connectionId' in job.input && job.input.connectionId.startsWith('managed:');
}

function unresolvedOutcome(problem: MediaJobFailure | undefined): MediaJobFailure | undefined {
  return problem && (problem.requestId || problem.recoveryMode || ['BILLING_TRANSPORT_UNKNOWN', 'MEDIA_OUTCOME_UNKNOWN'].includes(problem.code))
    ? { ...problem, retryable: false } : undefined;
}

function isDefiniteTerminalHistory(job: MediaJob): boolean {
  if (job.status !== "succeeded" && job.status !== "failed" && job.status !== "cancelled") return false;
  if (!job.completedAt || job.workerId || job.ownerLease || unresolvedOutcome(job.failure)) return false;
  // A failed/cancelled remote task may still have an unknown provider outcome.
  if (job.remoteTask && job.status !== "succeeded") return false;
  return true;
}

function historyRecord(job: MediaJob): MediaHistoryJobRecord {
  if (!isDefiniteTerminalHistory(job)) {
    throw new MediaCoreError("MEDIA_HISTORY_ARCHIVE_INVALID", mediaMessage("media.media_history_contains_unfinished_work"));
  }
  return {
    id: job.id,
    idempotencyDigest: job.archivedIdempotencyDigest ?? sha256(job.idempotencyKey),
    payloadHash: job.payloadHash,
    kind: job.kind,
    projectId: job.projectId,
    sceneId: job.sceneId,
    shotId: job.shotId,
    billing: job.cost.billing,
    status: job.status as MediaHistoryJobRecord["status"],
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt!,
  };
}

function historyInput(kind: MediaJob["kind"]): MediaJob["input"] {
  // These values satisfy the queue's legacy shape but carry no executable request data.
  const connectionId = "official-00000000-0000-0000-0000-000000000000";
  const model = "archived-history";
  const prompt = "Prompt omitted from read-only history";
  switch (kind) {
    case "image": return { connectionId, model, prompt, width: 64, height: 64 };
    case "video": return { connectionId, model, prompt, durationSeconds: 1, width: 64, height: 64 };
    case "speech": return { connectionId, model, text: prompt, voice: "archived-history", format: "mp3" };
    case "music": case "sound_effect": return { connectionId, model, prompt, durationSeconds: 1, format: "mp3" };
    case "subtitle": return { frameRate: 24, cues: [{ text: prompt, startFrame: 0, durationFrames: 1 }] };
    case "shot_preview": return { frameRate: 24, durationFrames: 1, width: 64, height: 64,
      visualAssetUri: "nextmux.media/archived-history-unavailable.png" };
    default: throw new MediaCoreError("MEDIA_HISTORY_ARCHIVE_INVALID", mediaMessage("media.unknown_archived_media_kind"));
  }
}

function materializeHistoryRecord(value: unknown, index: number): MediaJob {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MediaCoreError("MEDIA_HISTORY_ARCHIVE_INVALID", mediaMessage("media.media_history_record_is_invalid"));
  }
  const item = value as MediaHistoryJobRecord;
  if (!/^[a-f0-9]{64}$/.test(item.idempotencyDigest)) {
    throw new MediaCoreError("MEDIA_HISTORY_ARCHIVE_INVALID", mediaMessage("media.media_history_key_digest_is_invalid"));
  }
  const candidate = {
    id: item.id,
    idempotencyKey: `history-${item.idempotencyDigest}`,
    archivedIdempotencyDigest: item.idempotencyDigest,
    restoredHistoryOnly: true,
    payloadHash: item.payloadHash,
    kind: item.kind,
    projectId: item.projectId,
    sceneId: item.sceneId,
    shotId: item.shotId,
    input: historyInput(item.kind),
    cost: { billing: item.billing, description: "Imported read-only media history" },
    status: item.status,
    attempt: item.attempt,
    maxAttempts: item.maxAttempts,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    completedAt: item.completedAt,
    ...(item.status === "failed" ? { failure: failure({ code: "ARCHIVED_FAILURE", ...mediaMessage("media.archived_failure"), retryable: false }) } : {}),
    events: [{ at: item.completedAt, type: "recovered" }],
  };
  const job = storedJob(candidate, index);
  if (!isDefiniteTerminalHistory(job) || JSON.stringify(historyRecord(job)) !== JSON.stringify(value)) {
    throw new MediaCoreError("MEDIA_HISTORY_ARCHIVE_INVALID", mediaMessage("media.media_history_record_is_not_canonical_terminal_history"));
  }
  return job;
}

function interruptedFailure(job: MediaJob): MediaJobFailure {
  const existing = unresolvedOutcome(job.failure);
  if (existing) return existing;
  if (job.cost.billing !== 'free') {
    return failure({ code: job.cost.billing === 'platform_billed' ? 'BILLING_TRANSPORT_UNKNOWN' : 'MEDIA_OUTCOME_UNKNOWN',
      ...mediaMessage("media.recovery_provider_outcome_unknown"), retryable: false,
      ...(job.cost.billing === 'platform_billed' ? { recoveryMode: 'billing_review' as const } : {}) });
  }
  return failure({ code: 'WORKER_INTERRUPTED', ...mediaMessage("media.recovery_local_interrupted"), retryable: true });
}

function now(options: MediaJobMutationOptions): string {
  const value = options.now ?? new Date().toISOString();
  return isoTimestamp(value, "now");
}

function stateAt(timestamp: string): MediaQueueState {
  return {
    schemaVersion: MEDIA_QUEUE_SCHEMA_VERSION,
    revision: 0,
    jobs: [],
    updatedAt: timestamp,
  };
}

function payloadHash(request: EnqueueMediaJobRequest): string {
  return createHash("sha256").update(JSON.stringify({
    kind: request.kind,
    projectId: request.projectId,
    sceneId: request.sceneId,
    shotId: request.shotId,
    input: request.input,
    // Display metadata must never change paid-request idempotency identities.
    cost: { billing: request.cost.billing, description: request.cost.description },
    maxAttempts: request.maxAttempts ?? 3,
  })).digest("hex");
}

/** Only a new job receives this backend-selected execution format. Existing request hashes and jobs stay unchanged. */
function mediaJobImageSizeContract(value: unknown, kind: MediaJob["kind"]): Pick<MediaJob, "nativeImageSizeContract"> {
  if (value === undefined) return {};
  if (value !== "seedream45_v1" || kind !== "image") throw new MediaCoreError("INVALID_MEDIA_STATE", mediaMessage("media.invalid_field", { label: "nativeImageSizeContract" }));
  return { nativeImageSizeContract: value };
}

function mediaJobApiStyle(value: unknown, kind: MediaJob["kind"]): Pick<MediaJob, "mediaApiStyle"> {
  if (value === undefined) return {};
  if ((kind !== "image" && kind !== "video") || (value !== "openai" && value !== "openrouter")) {
    throw new MediaCoreError("INVALID_MEDIA_STATE", "Invalid frozen image/video media API format");
  }
  return { mediaApiStyle: value };
}

function appendEvent(job: MediaJob, event: MediaJob["events"][number]): readonly MediaJob["events"][number][] {
  return [...job.events, event].slice(-MAX_EVENTS_PER_JOB);
}

function event(value: unknown, index: number): MediaJob["events"][number] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MediaCoreError("INVALID_MEDIA_STATE", mediaMessage("media.events_field_is_invalid", { index: index }));
  }
  const item = value as MediaJob["events"][number];
  const types = [
    "created", "confirmed", "paused", "resumed", "claimed", "checkpointed", "submitted", "completed", "failed",
    "cancel_requested", "cancelled", "retried", "recovered",
  ] as const;
  if (!types.includes(item.type)) {
    throw new MediaCoreError("INVALID_MEDIA_STATE", mediaMessage("media.events_field_type_is_invalid", { index: index }));
  }
  if (item.note !== undefined && (typeof item.note !== "string" || item.note.length > 240 || item.note.includes("\0"))) {
    throw new MediaCoreError("INVALID_MEDIA_STATE", mediaMessage("media.events_field_note_is_invalid", { index: index }));
  }
  return {
    at: isoTimestamp(item.at, `events[${index}].at`),
    type: item.type,
    ...(item.note === undefined ? {} : { note: item.note }),
  };
}

function storedJob(value: unknown, index: number): MediaJob {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MediaCoreError("INVALID_MEDIA_STATE", mediaMessage("media.jobs_field_is_invalid", { index: index }));
  }
  const item = value as MediaJob;
  if (item.referenceUploads !== undefined && (!Array.isArray(item.referenceUploads) || item.referenceUploads.length > 8)) {
    throw new MediaCoreError("INVALID_MEDIA_STATE", mediaMessage("media.too_many_reference_upload_ids"));
  }
  if (item.kind !== "image" && item.kind !== "video" && item.kind !== "speech" && item.kind !== "music" && item.kind !== "sound_effect" && item.kind !== "subtitle" && item.kind !== "shot_preview") {
    throw new MediaCoreError("INVALID_MEDIA_STATE", mediaMessage("media.jobs_field_kind_is_invalid", { index: index }));
  }
  if (!/^project-[A-Za-z0-9][A-Za-z0-9-]{7,95}$/.test(item.projectId)
      || !/^scene-[A-Za-z0-9][A-Za-z0-9-]{7,95}$/.test(item.sceneId)
      || !/^shot-[A-Za-z0-9][A-Za-z0-9-]{7,95}$/.test(item.shotId)) {
    throw new MediaCoreError("INVALID_MEDIA_STATE", mediaMessage("media.jobs_field_references_invalid_comic_entities", { index: index }));
  }
  if (!/^[a-f0-9]{64}$/.test(item.payloadHash)) {
    throw new MediaCoreError("INVALID_MEDIA_STATE", mediaMessage("media.jobs_field_payloadhash_is_invalid", { index: index }));
  }
  if (item.restoredHistoryOnly !== undefined && item.restoredHistoryOnly !== true) {
    throw new MediaCoreError("INVALID_MEDIA_STATE", mediaMessage("media.jobs_field_restoredhistoryonly_is_invalid", { index: index }));
  }
  if (item.archivedIdempotencyDigest !== undefined && (item.restoredHistoryOnly !== true
      || typeof item.archivedIdempotencyDigest !== "string" || !/^[a-f0-9]{64}$/.test(item.archivedIdempotencyDigest))) {
    throw new MediaCoreError("INVALID_MEDIA_STATE", mediaMessage("media.jobs_field_archivedidempotencydigest_is_invalid", { index: index }));
  }
  if (!item.cost || (item.cost.billing !== "free" && item.cost.billing !== "provider_billed" && item.cost.billing !== "platform_billed")
      || typeof item.cost.description !== "string" || !item.cost.description.trim()
      || item.cost.description.length > 240 || item.cost.description.includes("\0")) {
    throw new MediaCoreError("INVALID_MEDIA_STATE", mediaMessage("media.jobs_field_cost_is_invalid", { index: index }));
  }
  if (!Array.isArray(item.events) || item.events.length < 1 || item.events.length > MAX_EVENTS_PER_JOB) {
    throw new MediaCoreError("INVALID_MEDIA_STATE", mediaMessage("media.jobs_field_events_is_invalid", { index: index }));
  }
  const normalized: MediaJob = {
    id: mediaJobId(item.id),
    idempotencyKey: idempotencyKey(item.idempotencyKey),
    ...(item.restoredHistoryOnly === true ? { restoredHistoryOnly: true as const } : {}),
    ...(item.archivedIdempotencyDigest === undefined ? {} : { archivedIdempotencyDigest: item.archivedIdempotencyDigest }),
    payloadHash: item.payloadHash,
    kind: item.kind,
    projectId: item.projectId,
    sceneId: item.sceneId,
    shotId: item.shotId,
    input: mediaInput(item.kind, item.input),
    ...mediaJobApiStyle(item.mediaApiStyle, item.kind),
    ...mediaJobImageSizeContract(item.nativeImageSizeContract, item.kind),
    cost: { billing: item.cost.billing, messageKey: `media.cost.${item.cost.billing}`, params: {}, description: item.cost.description.trim() },
    status: jobStatus(item.status),
    ...(item.waitingCapacity === true ? { waitingCapacity: true as const } : {}),
    ...(item.waitingCapacity === true ? capacityReasonMetadata(item.capacityReasons) : {}),
    ...(item.capacityWaitRecorded === true ? { capacityWaitRecorded: true as const } : {}),
    attempt: safeInteger(item.attempt, `jobs[${index}].attempt`, 0, 3),
    maxAttempts: safeInteger(item.maxAttempts, `jobs[${index}].maxAttempts`, 1, 3),
    createdAt: isoTimestamp(item.createdAt, `jobs[${index}].createdAt`),
    updatedAt: isoTimestamp(item.updatedAt, `jobs[${index}].updatedAt`),
    ...(item.confirmedAt === undefined ? {} : { confirmedAt: isoTimestamp(item.confirmedAt, `jobs[${index}].confirmedAt`) }),
    ...(item.startedAt === undefined ? {} : { startedAt: isoTimestamp(item.startedAt, `jobs[${index}].startedAt`) }),
    ...(item.completedAt === undefined ? {} : { completedAt: isoTimestamp(item.completedAt, `jobs[${index}].completedAt`) }),
    ...(item.workerId === undefined ? {} : { workerId: workerId(item.workerId) }),
    ...(item.ownerLease === undefined ? {} : { ownerLease: storedWorkerLease(item.ownerLease, index) }),
    ...(item.cancelRequestedAt === undefined ? {} : {
      cancelRequestedAt: isoTimestamp(item.cancelRequestedAt, `jobs[${index}].cancelRequestedAt`),
    }),
    ...(item.checkpoint === undefined ? {} : { checkpoint: checkpoint(item.checkpoint) }),
    ...(item.remoteTask === undefined ? {} : { remoteTask: remoteTask(item.remoteTask, index) }),
    ...(item.referenceUploads === undefined ? {} : { referenceUploads: item.referenceUploads.map(referenceUpload) }),
    ...(item.output === undefined ? {} : { output: checkpoint(item.output) }),
    ...(item.failure === undefined ? {} : { failure: failure(item.failure) }),
    events: item.events.map(event),
  };
  if (normalized.attempt > normalized.maxAttempts) {
    throw new MediaCoreError("INVALID_MEDIA_STATE", mediaMessage("media.jobs_field_exceeded_maxattempts", { index: index }));
  }
  if (normalized.status === "succeeded" && (!normalized.completedAt || !normalized.restoredHistoryOnly && !normalized.output)) {
    throw new MediaCoreError("INVALID_MEDIA_STATE", mediaMessage("media.jobs_field_has_no_successful_output", { index: index }));
  }
  if (normalized.status === "running" && !normalized.workerId) {
    throw new MediaCoreError("INVALID_MEDIA_STATE", mediaMessage("media.jobs_field_has_no_running_worker", { index: index }));
  }
  if (normalized.restoredHistoryOnly && !isDefiniteTerminalHistory(normalized)) {
    throw new MediaCoreError("INVALID_MEDIA_STATE", mediaMessage("media.jobs_field_is_not_read_only_terminal_history", { index: index }));
  }
  return normalized;
}

function storedState(value: unknown): MediaQueueState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MediaCoreError("INVALID_MEDIA_STATE", mediaMessage("media.media_queue_file_is_invalid"));
  }
  const item = value as MediaQueueState;
  if (item.schemaVersion !== MEDIA_QUEUE_SCHEMA_VERSION || !Array.isArray(item.jobs) || item.jobs.length > MAX_JOBS) {
    throw new MediaCoreError("UNSUPPORTED_MEDIA_SCHEMA", mediaMessage("media.media_queue_schema_is_not_supported"));
  }
  const jobs = item.jobs.map(storedJob);
  const historyCount = jobs.filter(job => job.restoredHistoryOnly).length;
  if (historyCount > MAX_HISTORY_JOBS || jobs.length - historyCount > MAX_ACTIVE_JOBS) {
    throw new MediaCoreError("MEDIA_QUEUE_FULL", mediaMessage("media.media_queue_capacity_was_exceeded"));
  }
  if (new Set(jobs.map(job => job.id)).size !== jobs.length
      || new Set(jobs.map(job => job.idempotencyKey)).size !== jobs.length) {
    throw new MediaCoreError("INVALID_MEDIA_STATE", mediaMessage("media.media_queue_contains_duplicate_identifiers"));
  }
  return {
    schemaVersion: MEDIA_QUEUE_SCHEMA_VERSION,
    revision: safeInteger(item.revision, "queue.revision", 0, Number.MAX_SAFE_INTEGER),
    jobs,
    updatedAt: isoTimestamp(item.updatedAt, "queue.updatedAt"),
  };
}

async function readHistoryArchive(pathname: string, workspaceBinding: string): Promise<{
  readonly jobs: readonly MediaJob[];
  readonly bytes: number;
}> {
  try {
    const source = resolve(pathname);
    const metadata = await lstat(source);
    if (!source.endsWith(MEDIA_HISTORY_SUFFIX) || !metadata.isFile() || metadata.isSymbolicLink()
        || metadata.size < 1 || metadata.size > MAX_HISTORY_ARCHIVE_BYTES) throw new Error("invalid archive file");
    const content = await readFile(source);
    if (content.byteLength !== metadata.size || content.byteLength > MAX_HISTORY_ARCHIVE_BYTES) throw new Error("archive changed");
    const archive: unknown = JSON.parse(content.toString("utf8"));
    if (!archive || typeof archive !== "object" || Array.isArray(archive)) throw new Error("invalid archive");
    const value = archive as { manifest?: unknown; jobs?: unknown };
    if (!value.manifest || typeof value.manifest !== "object" || Array.isArray(value.manifest)
        || !Array.isArray(value.jobs)) throw new Error("invalid archive contents");
    const manifest = value.manifest as MediaHistoryManifest;
    if (manifest.format !== MEDIA_HISTORY_FORMAT || manifest.version !== MEDIA_HISTORY_VERSION
        || manifest.queueSchemaVersion !== MEDIA_QUEUE_SCHEMA_VERSION
        || !validWorkspaceBinding(manifest.workspaceBinding)
        || typeof manifest.createdAt !== "string" || !Number.isFinite(Date.parse(manifest.createdAt))
        || manifest.assetsIncluded !== false
        || !Number.isSafeInteger(manifest.jobsCount) || manifest.jobsCount < 1 || manifest.jobsCount > MAX_HISTORY_JOBS
        || !Number.isSafeInteger(manifest.jobsBytes) || manifest.jobsBytes < 1 || manifest.jobsBytes > MAX_HISTORY_JOBS_BYTES
        || typeof manifest.jobsSha256 !== "string" || !/^[a-f0-9]{64}$/.test(manifest.jobsSha256)
        || typeof manifest.contentSha256 !== "string" || !/^[a-f0-9]{64}$/.test(manifest.contentSha256)) {
      throw new Error("invalid manifest");
    }
    const { contentSha256, ...unsigned } = manifest;
    if (sha256(JSON.stringify(unsigned)) !== contentSha256) throw new Error("manifest checksum mismatch");
    if (manifest.workspaceBinding !== workspaceBinding) {
      throw new MediaCoreError("MEDIA_HISTORY_WORKSPACE_MISMATCH", mediaMessage("media.media_history_belongs_to_a_different_workspace"));
    }
    const jobsJson = JSON.stringify(value.jobs);
    if (value.jobs.length !== manifest.jobsCount || Buffer.byteLength(jobsJson, "utf8") !== manifest.jobsBytes
        || sha256(jobsJson) !== manifest.jobsSha256) throw new Error("job checksum mismatch");
    const jobs = value.jobs.map(materializeHistoryRecord);
    if (new Set(jobs.map(job => job.id)).size !== jobs.length
        || new Set(jobs.map(job => job.archivedIdempotencyDigest)).size !== jobs.length
        || JSON.stringify(jobs.map(historyRecord)) !== jobsJson) {
      throw new Error("archive contains nonterminal or noncanonical jobs");
    }
    return { jobs, bytes: manifest.jobsBytes };
  } catch (error) {
    if (error instanceof MediaCoreError && error.code === "MEDIA_HISTORY_WORKSPACE_MISMATCH") throw error;
    throw new MediaCoreError("MEDIA_HISTORY_ARCHIVE_INVALID", mediaMessage("media.media_job_history_archive_failed_validation"));
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));
}

async function atomicWrite(pathname: string, content: string, verifyOwnership: () => void): Promise<void> {
  const temporary = join(dirname(pathname), `.${randomUUID()}.media-queue.tmp`);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < ATOMIC_WRITE_RETRIES; attempt += 1) {
    try {
      verifyOwnership();
      // The temporary file was created 0600; no fallible step may follow the commit.
      await rename(temporary, pathname);
      return;
    } catch (error) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException).code;
      const retryable = code === "EPERM" || code === "EACCES" || code === "EBUSY" || code === "ENOTEMPTY";
      if (!retryable || attempt === ATOMIC_WRITE_RETRIES - 1) break;
      await sleep(5 * (attempt + 1));
    }
  }
  try { await unlink(temporary); } catch { /* best effort */ }
  throw lastError;
}

export class MediaJobStore {
  readonly #root: string;
  readonly #statePath: string;
  readonly #lockPath: string;
  readonly #legacyLockPath: string;

  private constructor(root: string) {
    this.#root = root;
    this.#statePath = join(root, MEDIA_QUEUE_FILE);
    // Clearing a workspace renames/removes `root`. A lock inside it would move
    // with the old queue, allowing another process to acquire a new lock at
    // the original path and commit a job that the clear then deletes.
    this.#lockPath = join(dirname(root), ".locks", `${basename(root)}.lock`);
    this.#legacyLockPath = join(root, "media-jobs.lock");
  }

  static async create(options: MediaJobStoreOptions): Promise<MediaJobStore> {
    if (!options || typeof options.root !== "string" || !options.root.trim()) {
      throw new MediaCoreError("INVALID_MEDIA_ROOT", mediaMessage("media.media_queue_root_is_required"));
    }
    const requested = resolve(options.root);
    await mkdir(requested, { recursive: true, mode: 0o700 });
    const root = await realpath(requested);
    if (!(await stat(root)).isDirectory()) {
      throw new MediaCoreError("INVALID_MEDIA_ROOT", mediaMessage("media.media_queue_root_is_not_a_directory"));
    }
    return new MediaJobStore(root);
  }

  get root(): string {
    return this.#root;
  }

  /** Serialize a queue-wide operation with every writer, including other processes. */
  async withQueueLock<T>(operation: (verifyOwnership: () => void) => Promise<T>): Promise<T> {
    return this.#withLock(operation);
  }

  async read(): Promise<MediaQueueState> {
    let raw: string;
    try {
      const metadata = await stat(this.#statePath);
      if (!metadata.isFile() || metadata.size > MAX_STORE_BYTES) {
        throw new MediaCoreError("MEDIA_STORE_CORRUPT", mediaMessage("media.media_queue_file_exceeds_the_size_limit"));
      }
      raw = await readFile(this.#statePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return stateAt(new Date(0).toISOString());
      if (error instanceof MediaCoreError) throw error;
      throw new MediaCoreError("MEDIA_STORE_UNAVAILABLE", mediaMessage("media.unable_to_read_media_queue_state"));
    }
    try {
      return storedState(JSON.parse(raw));
    } catch (error) {
      if (error instanceof MediaCoreError) throw error;
      throw new MediaCoreError("MEDIA_STORE_CORRUPT", mediaMessage("media.media_queue_file_is_not_valid_json"));
    }
  }

  async list(limit = 100): Promise<readonly MediaJob[]> {
    const maximum = safeInteger(limit, "limit", 1, 500);
    const state = await this.read();
    return [...state.jobs]
      .sort((left, right) => Number(Boolean(left.restoredHistoryOnly)) - Number(Boolean(right.restoredHistoryOnly))
        || right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
      .slice(0, maximum);
  }

  async get(jobId: string): Promise<MediaJob> {
    const id = mediaJobId(jobId);
    const job = (await this.read()).jobs.find(candidate => candidate.id === id);
    if (!job) throw new MediaCoreError("JOB_NOT_FOUND", mediaMessage("media.media_job_does_not_exist"));
    return job;
  }

  /** Export verifiably finished records only. The archive never includes generated media bytes. */
  async exportTerminalHistory(destinationParent: string, workspaceBinding: string): Promise<MediaHistoryArchiveExportResult> {
    if (!validWorkspaceBinding(workspaceBinding)) {
      throw new MediaCoreError("MEDIA_HISTORY_ARCHIVE_INVALID", mediaMessage("media.media_history_workspace_binding_is_invalid"));
    }
    let parent: string;
    try {
      const requested = resolve(destinationParent);
      const metadata = await lstat(requested);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("invalid directory");
      parent = await realpath(requested);
      if (isInside(dirname(this.#root), parent)) throw new Error("archive cannot live inside media queues");
    } catch {
      throw new MediaCoreError("MEDIA_HISTORY_DESTINATION_INVALID", mediaMessage("media.choose_an_existing_backup_folder_outside_media_queues"));
    }
    return this.#withLock(async verifyOwnership => {
      const jobs = (await this.read()).jobs.filter(isDefiniteTerminalHistory).map(historyRecord);
      if (jobs.length === 0) throw new MediaCoreError("MEDIA_HISTORY_EMPTY", mediaMessage("media.there_is_no_finished_media_job_history_to_export"));
      if (jobs.length > MAX_HISTORY_JOBS) throw new MediaCoreError("MEDIA_HISTORY_ARCHIVE_INVALID", mediaMessage("media.too_many_finished_jobs_for_one_archive"));
      const jobsJson = JSON.stringify(jobs);
      const jobsBytes = Buffer.byteLength(jobsJson, "utf8");
      if (jobsBytes > MAX_HISTORY_JOBS_BYTES) throw new MediaCoreError("MEDIA_HISTORY_ARCHIVE_INVALID", mediaMessage("media.media_job_history_exceeds_the_archive_limit"));
      const unsigned = {
        format: MEDIA_HISTORY_FORMAT, version: MEDIA_HISTORY_VERSION,
        queueSchemaVersion: MEDIA_QUEUE_SCHEMA_VERSION, workspaceBinding,
        createdAt: new Date().toISOString(), assetsIncluded: false as const,
        jobsCount: jobs.length, jobsBytes, jobsSha256: sha256(jobsJson),
      } as const;
      const manifest: MediaHistoryManifest = { ...unsigned, contentSha256: sha256(JSON.stringify(unsigned)) };
      const content = `${JSON.stringify({ manifest, jobs }, undefined, 2)}\n`;
      if (Buffer.byteLength(content, "utf8") > MAX_HISTORY_ARCHIVE_BYTES) {
        throw new MediaCoreError("MEDIA_HISTORY_ARCHIVE_INVALID", mediaMessage("media.media_job_history_exceeds_the_archive_limit"));
      }
      const label = new Date().toISOString().replace(/[:.]/g, "-");
      const destination = join(parent, `NextMux-media-history-${label}-${randomUUID()}${MEDIA_HISTORY_SUFFIX}`);
      const temporary = join(parent, `.nextmux-media-history-${randomUUID()}.tmp`);
      try {
        const handle = await open(temporary, "wx", 0o600);
        try {
          await handle.writeFile(content, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        verifyOwnership();
        await link(temporary, destination); // Atomic creation; never replace an existing user file.
        return { file: destination, jobs: jobs.length, bytes: jobsBytes };
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
    });
  }

  /** Validate an entire bounded archive before taking the queue lock, then commit only into an empty queue. */
  async importTerminalHistory(archiveFile: string, workspaceBinding: string): Promise<MediaHistoryArchiveImportResult> {
    if (!validWorkspaceBinding(workspaceBinding)) {
      throw new MediaCoreError("MEDIA_HISTORY_ARCHIVE_INVALID", mediaMessage("media.media_history_workspace_binding_is_invalid"));
    }
    const source = resolve(archiveFile);
    try {
      if (isInside(this.#root, await realpath(source))) throw new Error("archive inside live queue");
    } catch {
      throw new MediaCoreError("MEDIA_HISTORY_ARCHIVE_INVALID", mediaMessage("media.archive_cannot_be_inside_the_live_media_queue"));
    }
    const archive = await readHistoryArchive(source, workspaceBinding);
    return this.#withLock(async verifyOwnership => {
      const existingFile = await lstat(this.#statePath).catch(error => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      });
      if (existingFile && (!existingFile.isFile() || existingFile.isSymbolicLink())) {
        throw new MediaCoreError("MEDIA_HISTORY_IMPORT_FAILED", mediaMessage("media.media_queue_file_is_not_safe_to_replace"));
      }
      const current = await this.read();
      if (current.jobs.length > 0) {
        throw new MediaCoreError("MEDIA_HISTORY_NOT_EMPTY", mediaMessage("media.clear_current_media_jobs_before_restoring_history"));
      }
      if (current.revision >= Number.MAX_SAFE_INTEGER) {
        throw new MediaCoreError("MEDIA_HISTORY_IMPORT_FAILED", mediaMessage("media.media_queue_revision_cannot_advance"));
      }
      const next = storedState({
        schemaVersion: MEDIA_QUEUE_SCHEMA_VERSION,
        revision: current.revision + 1,
        jobs: archive.jobs,
        updatedAt: new Date().toISOString(),
      });
      const content = `${JSON.stringify(next, undefined, 2)}\n`;
      if (Buffer.byteLength(content, "utf8") > MAX_STORE_BYTES) {
        throw new MediaCoreError("MEDIA_HISTORY_ARCHIVE_INVALID", mediaMessage("media.restored_media_queue_would_exceed_its_disk_limit"));
      }
      try {
        await atomicWrite(this.#statePath, content, verifyOwnership);
      } catch (error) {
        if (error instanceof MediaCoreError) throw error;
        throw new MediaCoreError("MEDIA_HISTORY_IMPORT_FAILED", mediaMessage("media.unable_to_install_media_history_original_queue_was_preserved"));
      }
      return { jobs: next.jobs.length, bytes: archive.bytes };
    });
  }

  async enqueue(
    value: EnqueueMediaJobRequest,
    options: MediaJobMutationOptions & { readonly mediaApiStyle?: "openai" | "openrouter"; readonly nativeImageSizeContract?: "seedream45_v1" } = {},
  ): Promise<MediaJob> {
    const request = enqueueRequest(value);
    const timestamp = now(options);
    return this.#mutate(state => {
      const hash = payloadHash(request);
      const requestDigest = sha256(request.idempotencyKey);
      const existing = state.jobs.find(job => job.idempotencyKey === request.idempotencyKey
        || job.archivedIdempotencyDigest === requestDigest);
      if (existing) {
        if (existing.payloadHash !== hash) {
          throw new MediaCoreError("IDEMPOTENCY_CONFLICT", mediaMessage("media.the_media_idempotency_key_was_already_used_for_different_input"));
        }
        return { state, result: existing, changed: false };
      }
      if (state.jobs.filter(job => !job.restoredHistoryOnly).length >= MAX_ACTIVE_JOBS) {
        throw new MediaCoreError("MEDIA_QUEUE_FULL", mediaMessage("media.media_queue_can_contain_at_most_field_active_records", { MAX_ACTIVE_JOBS: MAX_ACTIVE_JOBS }));
      }
      const id = mediaJobId(options.idFactory?.() ?? `media-job-${randomUUID()}`);
      if (state.jobs.some(job => job.id === id)) {
        throw new MediaCoreError("DUPLICATE_JOB_ID", mediaMessage("media.media_job_identifier_already_exists"));
      }
      const status = request.cost.billing === "free" ? "queued" : "awaiting_confirmation";
      const job: MediaJob = {
        id,
        idempotencyKey: request.idempotencyKey,
        payloadHash: hash,
        kind: request.kind,
        projectId: request.projectId,
        sceneId: request.sceneId,
        shotId: request.shotId,
        input: request.input,
        ...mediaJobApiStyle(options.mediaApiStyle, request.kind),
        ...mediaJobImageSizeContract(options.nativeImageSizeContract, request.kind),
        cost: request.cost,
        status,
        attempt: 0,
        maxAttempts: request.maxAttempts ?? 3,
        createdAt: timestamp,
        updatedAt: timestamp,
        ...(status === "queued" ? { confirmedAt: timestamp } : {}),
        events: [{ at: timestamp, type: "created", note: status }],
      };
      return { state: { ...state, jobs: [...state.jobs, job] }, result: job, changed: true };
    }, timestamp);
  }

  async confirm(jobId: string, options: MediaJobMutationOptions = {}): Promise<MediaJob> {
    const id = mediaJobId(jobId);
    const timestamp = now(options);
    return this.#updateJob(id, timestamp, job => {
      if (job.status !== "awaiting_confirmation") {
        if (job.confirmedAt && job.status !== "cancelled") return job;
        throw new MediaCoreError("JOB_NOT_CONFIRMABLE", mediaMessage("media.media_job_is_not_waiting_for_cost_confirmation"));
      }
      return {
        ...job,
        status: "queued",
        confirmedAt: timestamp,
        updatedAt: timestamp,
        events: appendEvent(job, { at: timestamp, type: "confirmed" }),
      };
    });
  }

  async claimNext(claimingWorkerId: string, options: MediaJobMutationOptions = {}): Promise<MediaJob | undefined> {
    const claimedBy = workerId(claimingWorkerId);
    const timestamp = now(options);
    return this.#mutate(state => {
      const candidate = [...state.jobs]
        .filter(job => job.status === "queued" && !job.cancelRequestedAt && job.attempt < job.maxAttempts)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))[0];
      if (!candidate) return { state, result: undefined, changed: false };
      const job: MediaJob = {
        ...candidate,
        status: "running",
        attempt: candidate.attempt + 1,
        workerId: claimedBy,
        ownerLease: workerLease(timestamp),
        startedAt: timestamp,
        updatedAt: timestamp,
        failure: undefined,
        events: appendEvent(candidate, { at: timestamp, type: "claimed", note: claimedBy }),
      };
      return {
        state: { ...state, jobs: state.jobs.map(item => item.id === job.id ? job : item) },
        result: job,
        changed: true,
      };
    }, timestamp);
  }

  /** Keep this connection's running jobs owned while other windows inspect the same queue. */
  async heartbeatWorker(claimingWorkerId: string, options: MediaJobMutationOptions = {}): Promise<number> {
    const claimedBy = workerId(claimingWorkerId);
    const timestamp = now(options);
    return this.#mutate(state => {
      let count = 0;
      const jobs = state.jobs.map(job => {
        if (job.status !== "running" || job.workerId !== claimedBy || job.ownerLease?.releasedAt) return job;
        if (job.ownerLease && job.ownerLease.processId !== process.pid) {
          throw new MediaCoreError("JOB_NOT_OWNED", mediaMessage("media.media_worker_belongs_to_another_process"));
        }
        count += 1;
        return { ...job, ownerLease: workerLease(timestamp) };
      });
      return { state: { ...state, jobs }, result: count, changed: count > 0 };
    }, timestamp);
  }

  /** Call only after this connection's executions have stopped; never release another connection's worker. */
  async releaseWorker(claimingWorkerId: string, options: MediaJobMutationOptions = {}): Promise<number> {
    const claimedBy = workerId(claimingWorkerId);
    const timestamp = now(options);
    return this.#mutate(state => {
      let count = 0;
      const jobs = state.jobs.map(job => {
        if (job.status !== "running" || job.workerId !== claimedBy || job.ownerLease?.releasedAt) return job;
        if (!job.ownerLease || job.ownerLease.processId !== process.pid) {
          throw new MediaCoreError("JOB_NOT_OWNED", mediaMessage("media.media_worker_belongs_to_another_process"));
        }
        count += 1;
        return { ...job, ownerLease: { ...job.ownerLease, expiresAt: timestamp, releasedAt: timestamp } };
      });
      return { state: { ...state, jobs }, result: count, changed: count > 0 };
    }, timestamp);
  }

  async setCapacityWaiting(jobId: string, claimingWorkerId: string, waiting: boolean, options: MediaJobMutationOptions & { readonly capacityReasons?: readonly CapacityWaitReason[] } = {}): Promise<MediaJob> {
    const timestamp = now(options);
    return this.#updateJob(mediaJobId(jobId), timestamp, job => {
      this.#assertRunningOwner(job, workerId(claimingWorkerId));
      const metadata = waiting ? capacityReasonMetadata(options.capacityReasons) : {};
      if (Boolean(job.waitingCapacity) === waiting && JSON.stringify(capacityReasonMetadata(job.capacityReasons)) === JSON.stringify(metadata)) return job;
      const { waitingCapacity: _previous, capacityReasons: _reasons, ...rest } = job;
      return { ...rest, ...(waiting ? { waitingCapacity: true as const, capacityWaitRecorded: true as const, ...metadata } : {}), updatedAt: timestamp };
    });
  }

  /** The provider accepted the request: remember its task, so an interruption resumes waiting for it. */
  async saveRemoteTask(
    jobId: string,
    claimingWorkerId: string,
    value: MediaJobRemoteTask,
    options: MediaJobMutationOptions = {},
  ): Promise<MediaJob> {
    const id = mediaJobId(jobId);
    const claimedBy = workerId(claimingWorkerId);
    const task = remoteTask(value, id);
    const timestamp = now(options);
    return this.#updateJob(id, timestamp, job => {
      this.#assertRunningOwner(job, claimedBy);
      if (job.remoteTask?.taskId === task.taskId) return job;
      return {
        ...job,
        remoteTask: task,
        updatedAt: timestamp,
        events: appendEvent(job, { at: timestamp, type: "submitted", note: task.taskId.slice(0, 200) }),
      };
    });
  }

  /** Persist before generation: a failed submit can reuse the provider's still-valid upload. */
  async saveReferenceUpload(jobId: string, claimingWorkerId: string, value: MediaReferenceUpload, options: MediaJobMutationOptions = {}): Promise<MediaJob> {
    const id = mediaJobId(jobId);
    const claimedBy = workerId(claimingWorkerId);
    const upload = referenceUpload(value);
    const timestamp = now(options);
    return this.#updateJob(id, timestamp, job => {
      this.#assertRunningOwner(job, claimedBy);
      const referenceUploads = [...(job.referenceUploads || []).filter(item => item.scope !== upload.scope
        && (item.expiresAt === undefined || item.expiresAt > Date.parse(timestamp))), upload].slice(-8);
      return { ...job, referenceUploads, updatedAt: timestamp };
    });
  }

  async saveCheckpoint(
    jobId: string,
    claimingWorkerId: string,
    value: MediaJobCheckpoint,
    options: MediaJobMutationOptions = {},
  ): Promise<MediaJob> {
    const id = mediaJobId(jobId);
    const claimedBy = workerId(claimingWorkerId);
    const output = checkpoint(value);
    const timestamp = now(options);
    return this.#updateJob(id, timestamp, job => {
      this.#assertRunningOwner(job, claimedBy);
      if (job.checkpoint) {
        if (JSON.stringify(job.checkpoint) === JSON.stringify(output)) return job;
        throw new MediaCoreError("CHECKPOINT_CONFLICT", mediaMessage("media.media_job_already_has_a_different_output_checkpoint"));
      }
      return {
        ...job,
        checkpoint: output,
        updatedAt: timestamp,
        events: appendEvent(job, { at: timestamp, type: "checkpointed", note: output.relativeUri }),
      };
    });
  }

  async complete(jobId: string, claimingWorkerId: string, options: MediaJobMutationOptions = {}): Promise<MediaJob> {
    const id = mediaJobId(jobId);
    const claimedBy = workerId(claimingWorkerId);
    const timestamp = now(options);
    return this.#updateJob(id, timestamp, job => {
      this.#assertRunningOwner(job, claimedBy);
      if (!job.checkpoint) throw new MediaCoreError("CHECKPOINT_REQUIRED", mediaMessage("media.media_output_must_be_checkpointed_before_completion"));
      return {
        ...job,
        status: "succeeded",
        output: job.checkpoint,
        workerId: undefined,
        ownerLease: undefined,
        cancelRequestedAt: undefined,
        failure: undefined,
        completedAt: timestamp,
        updatedAt: timestamp,
        events: appendEvent(job, { at: timestamp, type: "completed", note: job.checkpoint.relativeUri }),
      };
    });
  }

  async fail(
    jobId: string,
    claimingWorkerId: string,
    value: MediaJobFailure,
    options: MediaJobMutationOptions = {},
  ): Promise<MediaJob> {
    const id = mediaJobId(jobId);
    const claimedBy = workerId(claimingWorkerId);
    const validated = failure(value);
    const problem = unresolvedOutcome(validated) || validated;
    const timestamp = now(options);
    return this.#updateJob(id, timestamp, job => {
      this.#assertRunningOwner(job, claimedBy);
      // A paid output already saved as a checkpoint outlives a late cancel: a failure while linking it stays
      // recoverable (failed, resumable from the checkpoint) instead of becoming a final "cancelled" (audit B03-03).
      if (job.checkpoint && problem.code !== "CANCELLED") {
        return {
          ...job,
          status: "failed",
          workerId: undefined,
          ownerLease: undefined,
          cancelRequestedAt: undefined,
          completedAt: timestamp,
          updatedAt: timestamp,
          failure: { ...problem, retryable: true },
          events: appendEvent(job, { at: timestamp, type: "failed", note: problem.code }),
        };
      }
      if (job.cancelRequestedAt || problem.code === "CANCELLED") {
        return {
          ...job,
          status: "cancelled",
          workerId: undefined,
          ownerLease: undefined,
          completedAt: timestamp,
          updatedAt: timestamp,
          failure: unresolvedOutcome(problem),
          events: appendEvent(job, { at: timestamp, type: "cancelled" }),
        };
      }
      return {
        ...job,
        status: "failed",
        workerId: undefined,
        ownerLease: undefined,
        completedAt: timestamp,
        updatedAt: timestamp,
        failure: problem,
        events: appendEvent(job, { at: timestamp, type: "failed", note: problem.code }),
      };
    });
  }

  async cancel(jobId: string, options: MediaJobMutationOptions = {}): Promise<MediaJob> {
    const id = mediaJobId(jobId);
    const timestamp = now(options);
    return this.#updateJob(id, timestamp, job => {
      if (job.status === "cancelled") return job;
      if (job.status === "succeeded" || job.status === "failed" || job.status === "interrupted") {
        throw new MediaCoreError("JOB_NOT_CANCELLABLE", mediaMessage("media.completed_media_job_cannot_be_cancelled"));
      }
      if (job.status === "running") {
        if (job.checkpoint) {
          throw new MediaCoreError("JOB_NOT_CANCELLABLE", mediaMessage("media.media_output_is_already_ready_and_is_being_attached_to_the_project"));
        }
        if (job.cancelRequestedAt) return job;
        return {
          ...job,
          cancelRequestedAt: timestamp,
          failure: unresolvedOutcome(job.failure) || job.failure,
          updatedAt: timestamp,
          events: appendEvent(job, { at: timestamp, type: "cancel_requested" }),
        };
      }
      return {
        ...job,
        status: "cancelled",
        completedAt: timestamp,
        updatedAt: timestamp,
        events: appendEvent(job, { at: timestamp, type: "cancelled" }),
      };
    });
  }

  async pause(jobId: string, options: MediaJobMutationOptions = {}): Promise<MediaJob> {
    const id = mediaJobId(jobId);
    const timestamp = now(options);
    return this.#updateJob(id, timestamp, job => {
      if (job.status === "paused") return job;
      if (job.status === "running") {
        throw new MediaCoreError("JOB_NOT_PAUSABLE", mediaMessage("media.a_job_submitted_to_the_provider_cannot_be_paused_cancel_it_or_wait_for_completion"));
      }
      if (job.status !== "queued") {
        throw new MediaCoreError("JOB_NOT_PAUSABLE", mediaMessage("media.this_media_job_cannot_be_paused"));
      }
      return {
        ...job,
        status: "paused",
        updatedAt: timestamp,
        events: appendEvent(job, { at: timestamp, type: "paused" }),
      };
    });
  }

  async resume(jobId: string, options: MediaJobMutationOptions = {}): Promise<MediaJob> {
    const id = mediaJobId(jobId);
    const timestamp = now(options);
    return this.#updateJob(id, timestamp, job => {
      if (job.status === "queued") return job;
      if (job.status !== "paused") {
        throw new MediaCoreError("JOB_NOT_RESUMABLE", mediaMessage("media.this_media_job_is_not_paused"));
      }
      return {
        ...job,
        status: "queued",
        updatedAt: timestamp,
        events: appendEvent(job, { at: timestamp, type: "resumed" }),
      };
    });
  }

  async retry(jobId: string, options: MediaJobMutationOptions = {}): Promise<MediaJob> {
    const id = mediaJobId(jobId);
    const timestamp = now(options);
    return this.#updateJob(id, timestamp, job => {
      if (job.restoredHistoryOnly) {
        throw new MediaCoreError("JOB_HISTORY_ONLY", mediaMessage("media.restored_media_history_cannot_be_retried"));
      }
      if (job.status !== "failed" && job.status !== "interrupted") {
        throw new MediaCoreError("JOB_NOT_RETRYABLE", mediaMessage("media.media_job_is_not_in_a_retryable_state"));
      }
      if (job.failure && !job.failure.retryable) {
        throw new MediaCoreError("JOB_NOT_RETRYABLE", mediaMessage("media.this_media_failure_requires_a_new_job_with_corrected_input"));
      }
      // A saved output only needs linking into the project again, which costs nothing: the last attempt is handed
      // back for it, as crash recovery does (audit A13-04). Everything else keeps the attempt limit.
      const resumesOutput = Boolean(job.checkpoint) && job.attempt >= job.maxAttempts;
      if (job.attempt >= job.maxAttempts && !resumesOutput) {
        throw new MediaCoreError("ATTEMPT_LIMIT", mediaMessage("media.media_job_reached_its_retry_limit"));
      }
      return {
        ...job,
        ...(resumesOutput ? { attempt: job.maxAttempts - 1 } : {}),
        status: "queued",
        workerId: undefined,
        ownerLease: undefined,
        cancelRequestedAt: undefined,
        completedAt: undefined,
        failure: undefined,
        // Retrying a poll/download continues the accepted generation; only regenerate creates a new request.
        updatedAt: timestamp,
        events: appendEvent(job, { at: timestamp, type: "retried", note: job.checkpoint ? "resume_checkpoint" : job.remoteTask ? "resume_remote_task" : "repeat_request" }),
      };
    });
  }

  /** Backend-only CAS after a completed GET preflight and verified HTTPS asset.
   * Never changes input, price, acceptance identity or unknown provider fees. */
  async retryAcceptedHttpsAsset(jobId: string, taskId: string, expectedPayloadHash: string,
    evidence: { readonly hostSha256: string; readonly urlSha256: string; readonly suppliedScheme: 'http' | 'https' },
    options: MediaJobMutationOptions = {}): Promise<MediaJob> {
    const id = mediaJobId(jobId);
    const timestamp = now(options);
    if (!/^[a-f0-9]{64}$/u.test(evidence.urlSha256) || !/^[a-f0-9]{64}$/u.test(evidence.hostSha256)
      || !['http', 'https'].includes(evidence.suppliedScheme)) {
      throw new MediaCoreError('JOB_NOT_RETRYABLE', mediaMessage('media.media_job_is_not_in_a_retryable_state'));
    }
    return this.#updateJob(id, timestamp, job => {
      if (job.restoredHistoryOnly || job.status !== 'failed' || job.kind !== 'video' || job.cost.billing !== 'provider_billed'
        || job.failure?.code !== 'INSECURE_BASE_URL' || job.failure.retryable !== false
        || !job.remoteTask?.taskId || job.remoteTask.taskId !== taskId || job.payloadHash !== expectedPayloadHash
        || job.checkpoint || job.output || job.cancelRequestedAt || job.attempt >= job.maxAttempts
        || !('connectionId' in job.input) || !job.input.connectionId.startsWith('official-')) {
        throw new MediaCoreError('JOB_NOT_RETRYABLE', mediaMessage('media.media_job_is_not_in_a_retryable_state'));
      }
      return { ...job, status: 'queued', workerId: undefined, ownerLease: undefined, completedAt: undefined,
        failure: undefined, updatedAt: timestamp, events: appendEvent(job, { at: timestamp, type: 'retried',
          note: JSON.stringify({ mode: 'resume_remote_task_https_asset', scheme: evidence.suppliedScheme,
            hostSha256: evidence.hostSha256,
            urlSha256: evidence.urlSha256 }) }) };
    });
  }

  /** A separate paid generation always starts as a fresh job requiring cost confirmation. */
  async regenerate(jobId: string, options: MediaJobMutationOptions = {}): Promise<MediaJob> {
    const previous = await this.get(jobId);
    if (previous.restoredHistoryOnly) {
      throw new MediaCoreError("JOB_HISTORY_ONLY", mediaMessage("media.restored_media_history_cannot_start_a_new_generation"));
    }
    if (previous.status !== "failed" && previous.status !== "interrupted" && previous.status !== "cancelled" && previous.status !== "succeeded") {
      throw new MediaCoreError("JOB_NOT_REGENERATABLE", mediaMessage("media.wait_for_the_current_media_job_to_stop_before_generating_again"));
    }
    return this.enqueue({
      idempotencyKey: `regenerate-${randomUUID()}`,
      kind: previous.kind,
      projectId: previous.projectId,
      sceneId: previous.sceneId,
      shotId: previous.shotId,
      input: previous.input,
      cost: previous.cost,
      maxAttempts: previous.maxAttempts,
    }, options);
  }

  async recoverInterrupted(options: MediaJobMutationOptions = {}): Promise<readonly MediaJob[]> {
    const timestamp = now(options);
    return this.#mutate(state => {
      const recovered: MediaJob[] = [];
      const jobs = state.jobs.map(job => {
        if (job.status !== "running" || !ownerIsGone(job, timestamp)) return job;
        const cancelled = Boolean(job.cancelRequestedAt) && !job.checkpoint;
        // Accepted by the provider before the interruption: wait for that task again (the same attempt, not a retry).
        const resume = !job.checkpoint && !cancelled && (Boolean(job.remoteTask) || canResumeIdempotentSubmission(job));
        const problem = job.checkpoint || resume ? undefined : interruptedFailure(job);
        const next: MediaJob = {
          ...job,
          // Attaching a saved result or waiting for the accepted task regenerates
          // nothing, so it must not use up an attempt: a final attempt that
          // produced its checkpoint stays claimable (audit 36-11).
          ...(job.checkpoint || resume ? { attempt: Math.max(0, job.attempt - 1) } : {}),
          status: job.checkpoint || resume ? "queued" : cancelled ? "cancelled" : "interrupted",
          workerId: undefined,
          ownerLease: undefined,
          cancelRequestedAt: cancelled ? job.cancelRequestedAt : undefined,
          completedAt: cancelled ? timestamp : job.completedAt,
          updatedAt: timestamp,
          failure: cancelled ? unresolvedOutcome(problem) : problem,
          events: appendEvent(job, {
            at: timestamp,
            type: "recovered",
            note: job.checkpoint ? "resume_checkpoint" : resume ? job.remoteTask ? "resume_remote_task" : "resume_idempotent_submission" : problem?.retryable === false ? "original_outcome_review_required" : cancelled ? "cancelled_after_restart" : "manual_retry_required",
          }),
        };
        recovered.push(next);
        return next;
      });
      return { state: { ...state, jobs }, result: recovered, changed: recovered.length > 0 };
    }, timestamp);
  }

  /**
   * Restart recovery: an interrupted job whose output the host finished writing
   * (and has verified against its recorded digest) before the process stopped
   * adopts it as its checkpoint, to be attached like any other checkpoint with
   * no new provider request (audit 36-10).
   */
  async adoptWrittenOutput(jobId: string, value: MediaJobCheckpoint, options: MediaJobMutationOptions = {}): Promise<MediaJob> {
    const id = mediaJobId(jobId);
    const output = checkpoint(value);
    const timestamp = now(options);
    return this.#updateJob(id, timestamp, job => {
      if (job.status !== "interrupted" || job.checkpoint) return job;
      return {
        ...job,
        status: "queued",
        checkpoint: output,
        attempt: Math.max(0, job.attempt - 1),
        failure: undefined,
        updatedAt: timestamp,
        events: appendEvent(job, { at: timestamp, type: "recovered", note: "adopt_written_output" }),
      };
    });
  }

  async dismiss(jobId: string, options: MediaJobMutationOptions = {}): Promise<{ readonly removed: true }> {
    const id = mediaJobId(jobId);
    const timestamp = now(options);
    return this.#mutate(state => {
      const job = state.jobs.find(candidate => candidate.id === id);
      if (!job) throw new MediaCoreError("JOB_NOT_FOUND", mediaMessage("media.media_job_does_not_exist"));
      if (job.status === "awaiting_confirmation" || job.status === "queued" || job.status === "running") {
        throw new MediaCoreError("JOB_NOT_DISMISSIBLE", mediaMessage("media.active_media_job_cannot_be_removed_from_history"));
      }
      return {
        state: { ...state, jobs: state.jobs.filter(candidate => candidate.id !== id) },
        result: { removed: true } as const,
        changed: true,
      };
    }, timestamp);
  }

  #assertRunningOwner(job: MediaJob, claimedBy: string): void {
    if (job.status !== "running" || job.workerId !== claimedBy || job.ownerLease?.releasedAt
        || (job.ownerLease && job.ownerLease.processId !== process.pid)) {
      throw new MediaCoreError("JOB_NOT_OWNED", mediaMessage("media.media_job_is_not_owned_by_this_worker"));
    }
  }

  async #updateJob(
    id: string,
    timestamp: string,
    update: (job: MediaJob) => MediaJob,
  ): Promise<MediaJob> {
    return this.#mutate(state => {
      const job = state.jobs.find(candidate => candidate.id === id);
      if (!job) throw new MediaCoreError("JOB_NOT_FOUND", mediaMessage("media.media_job_does_not_exist"));
      const next = update(job);
      const changed = next !== job;
      return {
        state: changed
          ? { ...state, jobs: state.jobs.map(candidate => candidate.id === id ? next : candidate) }
          : state,
        result: next,
        changed,
      };
    }, timestamp);
  }

  async #mutate<T>(
    operation: (state: MediaQueueState) => {
      readonly state: MediaQueueState;
      readonly result: T;
      readonly changed: boolean;
    },
    timestamp: string,
  ): Promise<T> {
    return this.#withLock(async verifyOwnership => {
      const current = await this.read();
      const mutation = operation(current);
      if (!mutation.changed) return mutation.result;
      const next: MediaQueueState = {
        ...mutation.state,
        schemaVersion: MEDIA_QUEUE_SCHEMA_VERSION,
        revision: current.revision + 1,
        updatedAt: timestamp,
      };
      const normalized = storedState(next);
      const serialized = `${JSON.stringify(normalized, undefined, 2)}\n`;
      if (Buffer.byteLength(serialized, "utf8") > MAX_STORE_BYTES) {
        throw new MediaCoreError("MEDIA_STORE_TOO_LARGE", mediaMessage("media.media_queue_exceeds_the_48_mb_disk_limit"));
      }
      try {
        await atomicWrite(this.#statePath, serialized, verifyOwnership);
      } catch (error) {
        if (error instanceof MediaCoreError) throw error;
        throw new MediaCoreError("MEDIA_STORE_UNAVAILABLE", mediaMessage("media.unable_to_save_media_queue_state"));
      }
      return mutation.result;
    });
  }

  async #withLock<T>(operation: (verifyOwnership: () => void) => Promise<T>): Promise<T> {
    let compromised: Error | undefined;
    let release: () => Promise<void>;
    let identity: { readonly dev: bigint; readonly ino: bigint } | undefined;
    try {
      await mkdir(dirname(this.#lockPath), { recursive: true, mode: 0o700 });
      release = await acquireFileLock(this.#statePath, {
        realpath: false,
        lockfilePath: this.#lockPath,
        stale: LOCK_STALE_MS,
        update: LOCK_UPDATE_MS,
        retries: { retries: Math.ceil(LOCK_WAIT_MS / 50), factor: 1, minTimeout: 50, maxTimeout: 50 },
        onCompromised: error => { compromised = error; },
      });
      // The compromise callback runs on the next heartbeat. Capture the lock directory
      // identity so a replaced lock is rejected before an old writer commits.
      const acquired = lstatSync(this.#lockPath, { bigint: true });
      if (!acquired.isDirectory()) throw new Error("media lock is not a directory");
      identity = { dev: acquired.dev, ino: acquired.ino };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ELOCKED") {
        throw new MediaCoreError("MEDIA_QUEUE_BUSY", mediaMessage("media.another_nextmux_process_is_updating_the_media_queue"));
      }
      throw new MediaCoreError("MEDIA_LOCK_FAILED", mediaMessage("media.unable_to_lock_the_media_queue"));
    }
    const stillOwned = (): boolean => {
      if (compromised || !identity) return false;
      try {
        const current = lstatSync(this.#lockPath, { bigint: true });
        return current.isDirectory() && current.dev === identity.dev && current.ino === identity.ino;
      } catch { return false; }
    };
    const verifyOwnership = () => {
      if (!stillOwned()) throw new MediaCoreError("MEDIA_LOCK_FAILED", mediaMessage("media.media_queue_lock_was_lost_while_saving"));
    };
    try {
      // A prior build locked inside the queue tree. Refuse to mutate or clear
      // while that old lock is present: the two lock locations cannot safely
      // coordinate with a still-running old process.
      const legacy = await lstat(this.#legacyLockPath).catch(error => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      });
      if (legacy) {
        throw new MediaCoreError("MEDIA_QUEUE_BUSY", mediaMessage("media.a_legacy_media_queue_lock_is_active_or_remains_close_the_old_application_and_confirm_its_jobs_have_stopped_bef"));
      }
      // An enqueue may have created its store before a concurrent clear. The
      // stable parent lock makes it safe to recreate that now-absent root.
      await mkdir(this.#root, { recursive: true, mode: 0o700 });
      if (await realpath(this.#root) !== this.#root) {
        throw new MediaCoreError("MEDIA_STORE_UNAVAILABLE", mediaMessage("media.media_queue_root_changed_while_locking"));
      }
      verifyOwnership();
      const result = await operation(verifyOwnership);
      return result;
    } finally {
      // proper-lockfile releases by pathname. A former owner must not remove a new lock.
      // A failed release after an atomic rename cannot roll back the committed operation.
      if (stillOwned()) try { await release(); } catch { /* stale-lock recovery handles this */ }
    }
  }
}
