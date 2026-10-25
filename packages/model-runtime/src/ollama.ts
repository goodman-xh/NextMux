import { estimateAgentModelInputTokens, type AgentModelRequest } from "@nextmux/agent-runtime";
import { boundedModel, boundedSecret, normalizeOfficialModelError, OfficialModelError, readLimitedJson, timeoutMs, validatedBaseUrl } from "./http.js";
import type { OfficialProviderId } from "./presets.js";

export type OllamaModelCapability = "tools" | "vision" | "thinking" | "completion" | "embedding";

export interface OllamaRequestOptions {
  readonly baseUrl: string;
  readonly providerId?: OfficialProviderId;
  readonly apiKey?: string;
  readonly allowInsecure?: boolean;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface OllamaModelMetadata {
  readonly capabilities?: readonly OllamaModelCapability[];
  readonly maxContextTokens?: number;
  readonly parameterSize?: string;
  readonly quantizationLevel?: string;
  readonly thinkingValues?: readonly (boolean | string)[];
  readonly thinkingLevels?: readonly string[];
  readonly thinkingDefault?: boolean | string;
}

export interface OllamaServerStatus {
  readonly version: string;
  readonly modelCount: number;
  readonly toolsModelCount: number;
}

const AUTOMATIC_CONTEXT_MINIMUM = 16_384;
const MAX_CONTEXT_TOKENS = 10_000_000;
const MAX_METADATA_CACHE_ENTRIES = 1_024;
const NAME_CACHE_TTL_MS = 60_000;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const positiveTokens = (value: unknown): number | undefined => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= MAX_CONTEXT_TOKENS ? value : undefined;
const boundedText = (value: unknown, maximum = 128): string | undefined => typeof value === "string" && value.trim() && value.length <= maximum && !/[\r\n\0]/.test(value) ? value.trim() : undefined;

export function isOllamaCandidate(options: Pick<OllamaRequestOptions, "baseUrl" | "providerId">): boolean {
  if (options.providerId === "ollama") return true;
  try {
    const host = new URL(options.baseUrl).hostname;
    return host === "localhost" || host === "[::1]" || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(host);
  } catch { return false; }
}

/** Preserve an explicitly configured reverse-proxy prefix while replacing /v1. */
export function ollamaBaseUrl(baseUrl: string, allowInsecure = false): URL {
  const url = validatedBaseUrl(baseUrl, allowInsecure);
  url.pathname = url.pathname.replace(/\/v1\/$/, "/");
  // Local providers must never resolve localhost through a hosts-file override.
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  return url;
}

/** Read-only native requests; no proxy URLs, credentials or provider bodies are returned. */
export async function ollamaJsonRequest(options: OllamaRequestOptions, operation: "version" | "tags" | "show", body?: unknown): Promise<any> {
  const endpoint = new URL(`api/${operation}`, ollamaBaseUrl(options.baseUrl, options.allowInsecure === true));
  if (options.signal?.aborted) throw normalizeOfficialModelError(options.signal.reason, { signal: options.signal });
  const controller = new AbortController();
  let timedOut = false;
  const abort = (): void => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  const duration = timeoutMs(options.timeoutMs);
  const timer = duration > 0 ? setTimeout(() => { timedOut = true; controller.abort(); }, duration) : undefined;
  try {
    const apiKey = options.apiKey?.trim() ? boundedSecret(options.apiKey) : undefined;
    const response = await (options.fetchImpl ?? fetch)(endpoint, {
      method: body === undefined ? "GET" : "POST", redirect: "error", signal: controller.signal,
      headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }), ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      let data: unknown;
      try { data = await readLimitedJson(response); } catch { /* HTTP classification survives a non-JSON body. */ }
      throw normalizeOfficialModelError({ status: response.status, headers: response.headers, data }, { provider: "ollama" });
    }
    const payload = await readLimitedJson(response);
    if (controller.signal.aborted) throw controller.signal.reason;
    return payload;
  } catch (error) {
    throw normalizeOfficialModelError(error, { signal: options.signal, timedOut, provider: options.providerId });
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

/** A compatible local server is Ollama only after its native version response. */
export async function detectOllama(options: OllamaRequestOptions): Promise<{ readonly version: string } | undefined> {
  if (!isOllamaCandidate(options)) return undefined;
  try {
    const payload = await ollamaJsonRequest({ ...options, timeoutMs: options.timeoutMs === undefined ? 2_000 : options.timeoutMs }, "version");
    const version = boundedText(payload?.version, 80);
    return version && /^\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?$/.test(version) ? { version } : undefined;
  } catch (error) {
    const normalized = normalizeOfficialModelError(error, { signal: options.signal, provider: options.providerId });
    if (normalized.code === "CANCELLED" || options.signal?.aborted) throw normalized;
    if ([404, 405, 501].includes(normalized.httpStatus ?? 0) || normalized.code === "INVALID_RESPONSE") return undefined;
    // Optional loopback detection must not prevent a different local API from working.
    if (options.providerId !== "ollama") return undefined;
    throw normalized;
  }
}

export function parseOllamaModelMetadata(payload: unknown): OllamaModelMetadata {
  const source = record(payload), details = record(source.details), info = record(source.model_info);
  const knownCapabilities: readonly OllamaModelCapability[] = ["tools", "vision", "thinking", "completion", "embedding"];
  const capabilities = Array.isArray(source.capabilities) ? knownCapabilities.filter(capability => (source.capabilities as unknown[]).includes(capability)) : undefined;
  const architecture = boundedText(info["general.architecture"]);
  // Prefer the language architecture's limit; vision projector contexts are not chat limits.
  const declaredContext = architecture ? positiveTokens(info[`${architecture}.context_length`]) : undefined;
  const candidates = Object.entries(info).filter(([key]) => /^[^.]+\.context_length$/.test(key)).map(([, value]) => positiveTokens(value)).filter((value): value is number => value !== undefined);
  const maxContextTokens = declaredContext ?? (candidates.length ? Math.min(...candidates) : undefined);
  const parameterSize = boundedText(details.parameter_size), quantizationLevel = boundedText(details.quantization_level);
  const thinking = record(source.thinking);
  const thinkingValues = Array.isArray(thinking.values) ? [...new Set(thinking.values.filter((value): value is boolean | string => typeof value === "boolean" || (typeof value === "string" && /^[\w-]{1,64}$/.test(value))).slice(0, 32))] : undefined;
  const thinkingLevels = thinkingValues?.filter((value): value is string => typeof value === "string");
  const thinkingDefault = thinkingValues?.includes(thinking.default as boolean | string) ? thinking.default as boolean | string : undefined;
  return {
    ...(capabilities === undefined ? {} : { capabilities }), ...(maxContextTokens ? { maxContextTokens } : {}),
    ...(parameterSize ? { parameterSize } : {}), ...(quantizationLevel ? { quantizationLevel } : {}),
    ...(thinkingValues ? { thinkingValues } : {}), ...(thinkingLevels?.length ? { thinkingLevels } : {}),
    ...(thinkingDefault === undefined ? {} : { thinkingDefault }),
  };
}

interface MetadataCacheEntry { readonly metadata: OllamaModelMetadata; readonly expiresAt: number }
// A host-owned fetch function scopes caches, including authentication/network policy changes.
const metadataCaches = new WeakMap<typeof fetch, Map<string, MetadataCacheEntry>>();

export async function getOllamaModelMetadata(options: OllamaRequestOptions & { readonly model: string; readonly digest?: string }): Promise<OllamaModelMetadata> {
  if (options.signal?.aborted) throw normalizeOfficialModelError(options.signal.reason, { signal: options.signal });
  const model = boundedModel(options.model), endpoint = ollamaBaseUrl(options.baseUrl, options.allowInsecure === true).toString();
  const fetchImpl = options.fetchImpl ?? fetch;
  let cache = metadataCaches.get(fetchImpl);
  if (!cache) { cache = new Map(); metadataCaches.set(fetchImpl, cache); }
  const digest = boundedText(options.digest, 200);
  const nameKey = `${endpoint}\0name\0${model}`;
  const key = digest ? `${endpoint}\0digest\0${digest}` : nameKey;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    if (digest) cache.set(nameKey, { metadata: cached.metadata, expiresAt: Date.now() + NAME_CACHE_TTL_MS });
    return cached.metadata;
  }
  const payload = await ollamaJsonRequest(options, "show", { model, verbose: false });
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new OfficialModelError("INVALID_RESPONSE", "Invalid Ollama model information response");
  const metadata = parseOllamaModelMetadata(payload);
  cache.set(key, { metadata, expiresAt: digest ? Number.POSITIVE_INFINITY : Date.now() + NAME_CACHE_TTL_MS });
  cache.set(nameKey, { metadata, expiresAt: Date.now() + NAME_CACHE_TTL_MS });
  while (cache.size > MAX_METADATA_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
  return metadata;
}

/** Expandable request ceiling exposed to the picker and agent compaction. */
export function ollamaContextLimit(options: { readonly maxContextTokens?: number; readonly userContextTokens?: number }): number {
  const maximum = positiveTokens(options.maxContextTokens), user = positiveTokens(options.userContextTokens);
  return Math.min(maximum ?? user ?? AUTOMATIC_CONTEXT_MINIMUM, user ?? maximum ?? AUTOMATIC_CONTEXT_MINIMUM);
}

/** Allocate only the power-of-two request budget needed, within both declared ceilings. */
export function selectOllamaContextTokens(options: { readonly maxContextTokens?: number; readonly userContextTokens?: number; readonly promptTokens: number; readonly maxOutputTokens?: number }): number {
  const prompt = Number.isFinite(options.promptTokens) ? Math.max(0, Math.ceil(options.promptTokens)) : MAX_CONTEXT_TOKENS;
  const output = positiveTokens(options.maxOutputTokens) ?? 4_096;
  const requestBudget = Math.max(AUTOMATIC_CONTEXT_MINIMUM, 2 ** Math.ceil(Math.log2(Math.max(1, prompt + output))));
  return Math.min(ollamaContextLimit(options), requestBudget);
}

/** Count text/tool schemas conservatively without treating image base64 as text tokens. */
export function estimateOllamaPromptTokens(request: Pick<AgentModelRequest, "instructions" | "messages" | "tools">): number {
  const estimate = estimateAgentModelInputTokens(request.instructions, request.messages, request.tools, { providerId: "ollama" });
  return Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(estimate * 1.1) + 256);
}
