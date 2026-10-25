import { mediaMessage } from "./error-metadata.js";
import { randomUUID } from "node:crypto";

import { detectImage, MediaRuntimeError, type MediaBinaryResult } from "./runtime.js";

const MAX_WORKFLOW_BYTES = 8 * 1024 * 1024;
const MAX_JSON_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_IMAGE_RESPONSE_BYTES = 40 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10 * 60_000;

export interface ComfyUiWorkflowNode {
  readonly class_type: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly _meta?: Readonly<Record<string, unknown>>;
}

export type ComfyUiWorkflow = Readonly<Record<string, ComfyUiWorkflowNode>>;

export interface ComfyUiWorkflowTemplate {
  readonly schemaVersion: 1;
  readonly name: string;
  readonly workflow: ComfyUiWorkflow;
  readonly outputNodeId?: string;
}

export interface ComfyUiWorkflowValues {
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly width: number;
  readonly height: number;
  readonly seed?: number;
}

export interface CompiledComfyUiWorkflow {
  readonly workflow: ComfyUiWorkflow;
  readonly outputNodeId: string;
}

export interface ComfyUiProbeResult {
  readonly version?: string;
  readonly deviceName?: string;
  readonly nodeCount: number;
}

export interface ComfyUiQueueResult {
  readonly promptId: string;
  readonly queueNumber?: number;
}

export type ComfyUiProgressPhase = "queueing" | "queued" | "executing" | "downloading" | "completed";

export interface ComfyUiProgressEvent {
  readonly phase: ComfyUiProgressPhase;
  readonly promptId?: string;
}

interface ComfyUiConnectionOptions {
  readonly baseUrl: string | URL;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface ProbeComfyUiOptions extends ComfyUiConnectionOptions {}

export interface QueueComfyUiWorkflowOptions extends ComfyUiConnectionOptions {
  readonly workflow: ComfyUiWorkflow;
  readonly clientId?: string;
  readonly promptId?: string;
}

export interface RequestComfyUiImageOptions extends ComfyUiConnectionOptions, ComfyUiWorkflowValues {
  readonly template: ComfyUiWorkflowTemplate;
  readonly clientId?: string;
  readonly promptId?: string;
  readonly resumePromptId?: string;
  readonly pollIntervalMs?: number;
  readonly onProgress?: (event: ComfyUiProgressEvent) => void;
}

export interface ComfyUiImageResult extends MediaBinaryResult {
  readonly promptId: string;
  readonly outputNodeId: string;
  readonly filename: string;
  readonly subfolder: string;
  readonly folderType: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function boundedString(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\r\n\0]/.test(value)
    ? value
    : undefined;
}

function serializableClone<T>(value: T, maximum = MAX_WORKFLOW_BYTES): T {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new MediaRuntimeError("INVALID_COMFYUI_WORKFLOW", mediaMessage("media.comfyui_workflow_cannot_be_serialized"), false);
  }
  if (!serialized || Buffer.byteLength(serialized, "utf8") > maximum) {
    throw new MediaRuntimeError("INVALID_COMFYUI_WORKFLOW", mediaMessage("media.comfyui_workflow_is_empty_or_exceeds_the_size_limit"), false);
  }
  return JSON.parse(serialized) as T;
}

function validatedWorkflow(value: unknown): ComfyUiWorkflow {
  const source = record(value);
  if (!source) throw new MediaRuntimeError("INVALID_COMFYUI_WORKFLOW", mediaMessage("media.comfyui_workflow_must_be_an_api_node_object"), false);
  const entries = Object.entries(source);
  if (entries.length === 0 || entries.length > 5_000) {
    throw new MediaRuntimeError("INVALID_COMFYUI_WORKFLOW", mediaMessage("media.comfyui_workflow_node_count_is_invalid"), false);
  }
  const workflow: Record<string, ComfyUiWorkflowNode> = {};
  for (const [nodeId, candidate] of entries) {
    if (!boundedString(nodeId, 160)) {
      throw new MediaRuntimeError("INVALID_COMFYUI_WORKFLOW", mediaMessage("media.comfyui_workflow_contains_an_invalid_node_id"), false);
    }
    const node = record(candidate);
    const classType = boundedString(node?.class_type, 240);
    const inputs = record(node?.inputs);
    if (!node || !classType || !inputs) {
      throw new MediaRuntimeError("INVALID_COMFYUI_WORKFLOW", mediaMessage("media.comfyui_node_field_is_invalid", { nodeId: nodeId }), false);
    }
    workflow[nodeId] = {
      class_type: classType,
      inputs,
      ...(record(node._meta) ? { _meta: record(node._meta)! } : {}),
    };
  }
  return serializableClone(workflow);
}

export function parseComfyUiWorkflowTemplate(value: unknown): ComfyUiWorkflowTemplate {
  const wrapper = record(value);
  const wrapped = wrapper && "workflow" in wrapper;
  const schemaVersion = wrapped ? wrapper.schemaVersion : 1;
  if (schemaVersion !== 1) {
    throw new MediaRuntimeError("INVALID_COMFYUI_WORKFLOW", mediaMessage("media.comfyui_workflow_template_version_is_not_supported"), false);
  }
  const workflow = validatedWorkflow(wrapped ? wrapper.workflow : value);
  const name = wrapped
    ? boundedString(wrapper.name, 200) ?? "ComfyUI workflow"
    : "ComfyUI workflow";
  const outputNodeId = wrapped && wrapper.outputNodeId !== undefined
    ? boundedString(wrapper.outputNodeId, 160)
    : undefined;
  if (wrapped && wrapper.outputNodeId !== undefined && (!outputNodeId || !workflow[outputNodeId])) {
    throw new MediaRuntimeError("INVALID_COMFYUI_WORKFLOW", mediaMessage("media.comfyui_output_node_was_not_found"), false);
  }
  return { schemaVersion: 1, name, workflow, ...(outputNodeId ? { outputNodeId } : {}) };
}

function linkNodeId(value: unknown): string | undefined {
  return Array.isArray(value) && value.length >= 1 && typeof value[0] === "string" ? value[0] : undefined;
}

function substitute(value: unknown, values: Required<ComfyUiWorkflowValues>, replaced: Set<string>): unknown {
  if (typeof value === "string") {
    const placeholders: Readonly<Record<string, string | number>> = {
      $NEXTMUX_PROMPT: values.prompt,
      $NEXTMUX_NEGATIVE_PROMPT: values.negativePrompt,
      $NEXTMUX_WIDTH: values.width,
      $NEXTMUX_HEIGHT: values.height,
      $NEXTMUX_SEED: values.seed,
    };
    if (Object.prototype.hasOwnProperty.call(placeholders, value)) {
      replaced.add(value);
      return placeholders[value];
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(item => substitute(item, values, replaced));
  const object = record(value);
  if (!object) return value;
  return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, substitute(item, values, replaced)]));
}

function standardOutputNode(workflow: ComfyUiWorkflow): string | undefined {
  const preferred = ["SaveImage", "SaveAnimatedWEBP", "VHS_VideoCombine", "PreviewImage"];
  for (const classType of preferred) {
    const match = Object.entries(workflow).find(([, node]) => node.class_type === classType);
    if (match) return match[0];
  }
  return undefined;
}

export function compileComfyUiWorkflow(
  template: ComfyUiWorkflowTemplate,
  values: ComfyUiWorkflowValues,
): CompiledComfyUiWorkflow {
  const prompt = values.prompt.trim();
  if (!prompt || prompt.length > 30_000) {
    throw new MediaRuntimeError("INVALID_MEDIA_REQUEST", mediaMessage("media.comfyui_image_prompt_is_invalid"), false);
  }
  const negativePrompt = values.negativePrompt?.trim() ?? "";
  if (negativePrompt.length > 20_000) {
    throw new MediaRuntimeError("INVALID_MEDIA_REQUEST", mediaMessage("media.comfyui_negative_prompt_exceeds_the_size_limit"), false);
  }
  if (!Number.isSafeInteger(values.width) || !Number.isSafeInteger(values.height)
      || values.width < 64 || values.height < 64 || values.width > 8_192 || values.height > 8_192) {
    throw new MediaRuntimeError("INVALID_MEDIA_REQUEST", mediaMessage("media.comfyui_canvas_dimensions_are_invalid"), false);
  }
  const seed = values.seed === undefined ? Math.floor(Math.random() * Number.MAX_SAFE_INTEGER) : values.seed;
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw new MediaRuntimeError("INVALID_MEDIA_REQUEST", mediaMessage("media.comfyui_random_seed_is_invalid"), false);
  }
  const normalized = { prompt, negativePrompt, width: values.width, height: values.height, seed };
  const replaced = new Set<string>();
  const workflow = substitute(serializableClone(template.workflow), normalized, replaced) as Record<string, ComfyUiWorkflowNode>;

  const sampler = Object.values(workflow).find(node => /(?:^|_)KSampler(?:Advanced)?$/i.test(node.class_type))
    ?? Object.values(workflow).find(node => /sampler/i.test(node.class_type) && ("positive" in node.inputs || "negative" in node.inputs));
  if (sampler) {
    const positiveId = linkNodeId(sampler.inputs.positive);
    const negativeId = linkNodeId(sampler.inputs.negative);
    const latentId = linkNodeId(sampler.inputs.latent_image);
    if (!replaced.has("$NEXTMUX_PROMPT") && positiveId && workflow[positiveId] && "text" in workflow[positiveId].inputs) {
      workflow[positiveId] = { ...workflow[positiveId], inputs: { ...workflow[positiveId].inputs, text: prompt } };
    }
    if (!replaced.has("$NEXTMUX_NEGATIVE_PROMPT") && negativeId && workflow[negativeId] && "text" in workflow[negativeId].inputs) {
      workflow[negativeId] = { ...workflow[negativeId], inputs: { ...workflow[negativeId].inputs, text: negativePrompt } };
    }
    if (latentId && workflow[latentId]) {
      workflow[latentId] = {
        ...workflow[latentId],
        inputs: { ...workflow[latentId].inputs, width: values.width, height: values.height },
      };
    }
    const seedKey = "noise_seed" in sampler.inputs ? "noise_seed" : "seed" in sampler.inputs ? "seed" : undefined;
    if (!replaced.has("$NEXTMUX_SEED") && seedKey) {
      const samplerId = Object.entries(workflow).find(([, node]) => node === sampler)?.[0];
      if (samplerId) workflow[samplerId] = { ...sampler, inputs: { ...sampler.inputs, [seedKey]: seed } };
    }
  }
  const outputNodeId = template.outputNodeId ?? standardOutputNode(workflow);
  if (!outputNodeId || !workflow[outputNodeId]) {
    throw new MediaRuntimeError("INVALID_COMFYUI_WORKFLOW", mediaMessage("media.comfyui_workflow_has_no_recognized_image_output_node"), false);
  }
  return { workflow: validatedWorkflow(workflow), outputNodeId };
}

export function normalizeComfyUiBaseUrl(value: string | URL): URL {
  let url: URL;
  try {
    url = value instanceof URL ? new URL(value.toString()) : new URL(value.trim());
  } catch {
    throw new MediaRuntimeError("INVALID_COMFYUI_URL", mediaMessage("media.comfyui_endpoint_is_invalid"), false);
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname
      || url.username || url.password || url.search || url.hash) {
    throw new MediaRuntimeError("INVALID_COMFYUI_URL", mediaMessage("media.comfyui_endpoint_requires_http_s_without_credentials_or_query_parameters"), false);
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return url;
}

function endpoint(baseUrl: string | URL, path: string): URL {
  return new URL(path.replace(/^\/+/, ""), normalizeComfyUiBaseUrl(baseUrl));
}

function requestTimeout(value: number | undefined): number {
  return Number.isSafeInteger(value) && (value as number) >= 1_000 && (value as number) <= 30 * 60_000
    ? value as number
    : DEFAULT_TIMEOUT_MS;
}

async function readLimited(response: Response, maximum: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximum) {
    throw new MediaRuntimeError("RESPONSE_TOO_LARGE", mediaMessage("media.comfyui_response_exceeds_the_size_limit"), false);
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new MediaRuntimeError("RESPONSE_TOO_LARGE", mediaMessage("media.comfyui_response_exceeds_the_size_limit"), false);
    }
    chunks.push(value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function comfyResponseError(status: number, retryAfterMs?: number): MediaRuntimeError {
  const retry = retryAfterMs === undefined ? [] : [retryAfterMs];
  if (status === 401 || status === 403) return new MediaRuntimeError("AUTH_FAILED", mediaMessage("media.comfyui_access_was_denied"), false);
  if (status === 404) return new MediaRuntimeError("COMFYUI_ENDPOINT_NOT_FOUND", mediaMessage("media.comfyui_api_endpoint_was_not_found_or_its_version_is_incompatible"), false);
  if (status === 408) return new MediaRuntimeError("UPSTREAM_TIMEOUT", mediaMessage("media.comfyui_request_timed_out"), true, ...retry);
  if (status === 429) return new MediaRuntimeError("RATE_LIMITED", mediaMessage("media.comfyui_queue_is_temporarily_busy"), true, ...retry);
  if (status >= 500) return new MediaRuntimeError("UPSTREAM_UNAVAILABLE", mediaMessage("media.comfyui_is_temporarily_unavailable"), true, ...retry);
  return new MediaRuntimeError("COMFYUI_REQUEST_REJECTED", mediaMessage("media.comfyui_rejected_the_request"), false);
}

function retryAfterMs(response: Response, now = Date.now()): number | undefined {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Math.min(300_000, Number(value) * 1_000);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.min(300_000, Math.max(0, timestamp - now));
}

async function comfyFetch(
  options: ComfyUiConnectionOptions,
  path: string | URL,
  init: RequestInit = {},
  maximum = MAX_JSON_RESPONSE_BYTES,
): Promise<Uint8Array> {
  if (options.signal?.aborted) throw new MediaRuntimeError("CANCELLED", mediaMessage("media.comfyui_job_was_cancelled"), false);
  const controller = new AbortController();
  let timedOut = false;
  const abort = (): void => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, requestTimeout(options.timeoutMs));
  try {
    const response = await (options.fetchImpl ?? fetch)(typeof path === "string" ? endpoint(options.baseUrl, path) : path, {
      ...init,
      redirect: "error",
      signal: controller.signal,
    });
    const bytes = await readLimited(response, maximum);
    if (!response.ok) throw comfyResponseError(response.status, retryAfterMs(response));
    return bytes;
  } catch (error) {
    if (error instanceof MediaRuntimeError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      if (options.signal?.aborted && !timedOut) throw new MediaRuntimeError("CANCELLED", mediaMessage("media.comfyui_job_was_cancelled"), false);
      throw new MediaRuntimeError("TIMEOUT", mediaMessage("media.comfyui_connection_timed_out"), true);
    }
    throw new MediaRuntimeError("CONNECTION_FAILED", mediaMessage("media.cannot_connect_to_comfyui"), true);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

async function comfyJson(options: ComfyUiConnectionOptions, path: string, init?: RequestInit): Promise<unknown> {
  const bytes = await comfyFetch(options, path, init);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new MediaRuntimeError("INVALID_COMFYUI_RESPONSE", mediaMessage("media.comfyui_returned_invalid_data"), false);
  }
}

export async function probeComfyUi(options: ProbeComfyUiOptions): Promise<ComfyUiProbeResult> {
  const system = record(await comfyJson(options, "system_stats"));
  const objectInfo = record(await comfyJson(options, "object_info"));
  if (!system || !objectInfo) throw new MediaRuntimeError("INVALID_COMFYUI_RESPONSE", mediaMessage("media.comfyui_capability_information_is_invalid"), false);
  const systemInfo = record(system.system);
  const devices = Array.isArray(system.devices) ? system.devices : [];
  const firstDevice = devices.map(record).find(Boolean);
  return {
    nodeCount: Object.keys(objectInfo).length,
    ...(boundedString(systemInfo?.comfyui_version, 120) ? { version: systemInfo!.comfyui_version as string } : {}),
    ...(boundedString(firstDevice?.name, 240) ? { deviceName: firstDevice!.name as string } : {}),
  };
}

export async function queueComfyUiWorkflow(options: QueueComfyUiWorkflowOptions): Promise<ComfyUiQueueResult> {
  const workflow = validatedWorkflow(options.workflow);
  const clientId = boundedString(options.clientId, 200) ?? randomUUID();
  const promptId = options.promptId === undefined ? undefined : boundedString(options.promptId, 200);
  if (options.promptId !== undefined && !promptId) {
    throw new MediaRuntimeError("INVALID_MEDIA_REQUEST", mediaMessage("media.comfyui_task_id_is_invalid"), false);
  }
  const body = JSON.stringify({ prompt: workflow, client_id: clientId, ...(promptId ? { prompt_id: promptId } : {}) });
  if (Buffer.byteLength(body, "utf8") > MAX_WORKFLOW_BYTES) {
    throw new MediaRuntimeError("INVALID_COMFYUI_WORKFLOW", mediaMessage("media.comfyui_workflow_exceeds_the_request_size_limit"), false);
  }
  const response = record(await comfyJson(options, "prompt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  }));
  const resolvedId = boundedString(response?.prompt_id, 200);
  const nodeErrors = record(response?.node_errors);
  if (!resolvedId || nodeErrors && Object.keys(nodeErrors).length > 0) {
    throw new MediaRuntimeError("COMFYUI_WORKFLOW_REJECTED", mediaMessage("media.comfyui_workflow_validation_failed"), false);
  }
  return {
    promptId: resolvedId,
    ...(typeof response?.number === "number" && Number.isFinite(response.number)
      ? { queueNumber: response.number }
      : {}),
  };
}

export async function interruptComfyUi(options: ComfyUiConnectionOptions, promptId?: string): Promise<void> {
  const id = promptId ? boundedString(promptId, 200) : undefined;
  if (id) {
    try {
      await comfyFetch(options, "queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ delete: [id] }),
      });
    } catch {
      // Queue removal is best-effort before issuing the targeted interrupt.
    }
  }
  await comfyFetch(options, "interrupt", {
    method: "POST",
    ...(id ? {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt_id: id }),
    } : {}),
  });
}

function notify(options: RequestComfyUiImageOptions, phase: ComfyUiProgressPhase, promptId?: string): void {
  try { options.onProgress?.({ phase, ...(promptId ? { promptId } : {}) }); } catch {
    // Progress observers cannot interrupt the durable media operation.
  }
}

function historyFailure(entry: Record<string, unknown>): MediaRuntimeError | undefined {
  const status = record(entry.status);
  const statusText = typeof status?.status_str === "string" ? status.status_str.toLowerCase() : "";
  if (statusText.includes("error") || statusText.includes("fail")) {
    return new MediaRuntimeError("COMFYUI_EXECUTION_FAILED", mediaMessage("media.comfyui_workflow_execution_failed"), true);
  }
  const messages = Array.isArray(status?.messages) ? status.messages : [];
  if (messages.some(item => Array.isArray(item) && String(item[0]).includes("execution_error"))) {
    return new MediaRuntimeError("COMFYUI_EXECUTION_FAILED", mediaMessage("media.comfyui_node_execution_failed"), true);
  }
  return undefined;
}

interface ComfyOutputDescriptor {
  readonly outputNodeId: string;
  readonly filename: string;
  readonly subfolder: string;
  readonly folderType: string;
}

function outputDescriptor(entry: Record<string, unknown>, preferredNodeId: string): ComfyOutputDescriptor | undefined {
  const outputs = record(entry.outputs);
  if (!outputs) return undefined;
  const ordered = [preferredNodeId, ...Object.keys(outputs).filter(nodeId => nodeId !== preferredNodeId)];
  for (const outputNodeId of ordered) {
    const output = record(outputs[outputNodeId]);
    const images = Array.isArray(output?.images) ? output.images : [];
    for (const candidate of images) {
      const item = record(candidate);
      const filename = boundedString(item?.filename, 1_024);
      const subfolder = typeof item?.subfolder === "string" && item.subfolder.length <= 1_024 && !item.subfolder.includes("\0")
        ? item.subfolder
        : undefined;
      const folderType = boundedString(item?.type, 80);
      if (filename && subfolder !== undefined && folderType) {
        return { outputNodeId, filename, subfolder, folderType };
      }
    }
  }
  return undefined;
}

function pollingInterval(value: number | undefined): number {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 10_000
    ? value as number
    : 400;
}

async function pause(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new MediaRuntimeError("CANCELLED", mediaMessage("media.comfyui_job_was_cancelled"), false);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new MediaRuntimeError("CANCELLED", mediaMessage("media.comfyui_job_was_cancelled"), false));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function requestComfyUiImage(options: RequestComfyUiImageOptions): Promise<ComfyUiImageResult> {
  const compiled = compileComfyUiWorkflow(options.template, options);
  let promptId = options.resumePromptId;
  try {
    if (!promptId) {
      notify(options, "queueing");
      const queued = await queueComfyUiWorkflow({
        baseUrl: options.baseUrl,
        workflow: compiled.workflow,
        clientId: options.clientId,
        promptId: options.promptId,
        fetchImpl: options.fetchImpl,
        signal: options.signal,
        timeoutMs: options.timeoutMs,
      });
      promptId = queued.promptId;
      notify(options, "queued", promptId);
    }
    if (!boundedString(promptId, 200)) {
      throw new MediaRuntimeError("INVALID_MEDIA_REQUEST", mediaMessage("media.comfyui_task_id_is_invalid"), false);
    }
    if (options.signal?.aborted) throw new MediaRuntimeError("CANCELLED", mediaMessage("media.comfyui_job_was_cancelled"), false);
    notify(options, "executing", promptId);
    const deadline = Date.now() + requestTimeout(options.timeoutMs);
    let descriptor: ComfyOutputDescriptor | undefined;
    while (!descriptor) {
      if (Date.now() >= deadline) throw new MediaRuntimeError("TIMEOUT", mediaMessage("media.comfyui_workflow_execution_timed_out"), true);
      const history = record(await comfyJson(options, `history/${encodeURIComponent(promptId)}`));
      const entry = history ? record(history[promptId]) : undefined;
      if (entry) {
        const failure = historyFailure(entry);
        if (failure) throw failure;
        descriptor = outputDescriptor(entry, compiled.outputNodeId);
        const status = record(entry.status);
        if (!descriptor && status?.completed === true) {
          throw new MediaRuntimeError("COMFYUI_OUTPUT_MISSING", mediaMessage("media.comfyui_workflow_completed_without_image_output"), false);
        }
      }
      if (!descriptor) await pause(pollingInterval(options.pollIntervalMs), options.signal);
    }
    notify(options, "downloading", promptId);
    const viewUrl = endpoint(options.baseUrl, "view");
    viewUrl.searchParams.set("filename", descriptor.filename);
    viewUrl.searchParams.set("subfolder", descriptor.subfolder);
    viewUrl.searchParams.set("type", descriptor.folderType);
    const bytes = await comfyFetch(options, viewUrl, {}, MAX_IMAGE_RESPONSE_BYTES);
    const detected = detectImage(bytes);
    notify(options, "completed", promptId);
    return { bytes, ...detected, promptId, ...descriptor };
  } catch (error) {
    if (error instanceof MediaRuntimeError && error.code === "CANCELLED" && promptId) {
      try {
        await interruptComfyUi({ baseUrl: options.baseUrl, fetchImpl: options.fetchImpl, timeoutMs: 5_000 }, promptId);
      } catch {
        // Cancellation remains authoritative even when the remote interrupt cannot be acknowledged.
      }
    }
    throw error;
  }
}
