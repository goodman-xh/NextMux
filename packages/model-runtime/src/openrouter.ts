import type { MetadataExtractor } from "@ai-sdk/openai-compatible" with { "resolution-mode": "import" };
import type { ProviderMetadata } from "ai" with { "resolution-mode": "import" };

import { MAX_REASONING_DETAILS_BYTES, OfficialModelError } from "./http.js";

const MAX_MODELS = 16;
const MAX_PROVIDERS = 32;
const MAX_MODEL_ID_LENGTH = 256;
const MAX_PROVIDER_ID_LENGTH = 128;
const MAX_SESSION_ID_LENGTH = 256;
const MAX_METRIC_VALUE = 1_000_000_000;

export type OpenRouterSortDimension = "price" | "throughput" | "latency";
export type OpenRouterSortPartition = "model" | "none";
export type OpenRouterPercentile = "p50" | "p75" | "p90" | "p99";

export interface OpenRouterPercentileThresholds {
  readonly p50?: number;
  readonly p75?: number;
  readonly p90?: number;
  readonly p99?: number;
}

export type OpenRouterPerformanceThreshold = number | OpenRouterPercentileThresholds;

export interface OpenRouterMaxPrice {
  /** USD per million prompt tokens. */
  readonly prompt?: number;
  /** USD per million completion tokens. */
  readonly completion?: number;
  /** USD per image. */
  readonly image?: number;
  /** USD per request. */
  readonly request?: number;
}

export interface OpenRouterProviderPolicy {
  readonly order?: readonly string[];
  readonly allow_fallbacks?: boolean;
  readonly require_parameters?: boolean;
  readonly data_collection?: "allow" | "deny";
  readonly zdr?: boolean;
  readonly sort?: OpenRouterSortDimension | {
    readonly by: OpenRouterSortDimension;
    readonly partition?: OpenRouterSortPartition;
  };
  readonly preferred_max_latency?: OpenRouterPerformanceThreshold;
  readonly preferred_min_throughput?: OpenRouterPerformanceThreshold;
  readonly max_price?: OpenRouterMaxPrice;
}

/** A deliberately small subset of OpenRouter routing controls supported by NextMux. */
export interface OpenRouterRoutePolicy {
  /** Model fallbacks, in priority order after the requested model. */
  readonly models?: readonly string[];
  readonly provider?: OpenRouterProviderPolicy;
  /** Routing/cache affinity only; this never replaces replaying conversation messages. */
  readonly session_id?: string;
}

export type OpenRouterResolvedValue<T> =
  | { readonly verified: true; readonly value: T }
  | { readonly verified: false };

/** Values observed in OpenRouter's response, never inferred from the request. */
export interface OpenRouterResolvedMetadata {
  readonly version: 1;
  readonly kind: "openrouter_resolved_metadata";
  readonly requestedModel: string;
  readonly model: OpenRouterResolvedValue<string>;
  readonly generationId: OpenRouterResolvedValue<string>;
  readonly provider: OpenRouterResolvedValue<string>;
  readonly cost: OpenRouterResolvedValue<number>;
  readonly usageKnown: boolean;
}

export const OPENROUTER_APP_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "HTTP-Referer": "https://nextmux.app",
  "X-OpenRouter-Title": "NextMux",
  "X-OpenRouter-Metadata": "enabled",
});

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OfficialModelError("INVALID_REQUEST", `${label} must be an object`, { params: { field: label } });
  }
  return value as Record<string, unknown>;
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unexpected = Object.keys(value).filter(key => !allowed.includes(key));
  if (unexpected.length) {
    throw new OfficialModelError("INVALID_REQUEST", `${label} contains unsupported field ${unexpected[0]}`, { params: { field: label, unsupportedField: unexpected[0] } });
  }
}

function boundedId(value: unknown, maximum: number, label: string): string {
  if (typeof value !== "string") throw new OfficialModelError("INVALID_REQUEST", `${label} must be a string`, { params: { field: label } });
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new OfficialModelError("INVALID_REQUEST", `${label} is invalid or exceeds the length limit`, { params: { field: label, maximum } });
  }
  return normalized;
}

function boundedNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_METRIC_VALUE) {
    throw new OfficialModelError("INVALID_REQUEST", `${label} must be a bounded non-negative number`, { params: { field: label, maximum: MAX_METRIC_VALUE } });
  }
  return value;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new OfficialModelError("INVALID_REQUEST", `${label} must be a boolean`, { params: { field: label } });
  return value;
}

function performanceThreshold(value: unknown, label: string): OpenRouterPerformanceThreshold {
  if (typeof value === "number") return boundedNumber(value, label);
  const source = record(value, label);
  const keys: OpenRouterPercentile[] = ["p50", "p75", "p90", "p99"];
  assertOnlyKeys(source, keys, label);
  if (!Object.keys(source).length) throw new OfficialModelError("INVALID_REQUEST", `${label} must not be empty`, { params: { field: label } });
  return Object.fromEntries(Object.entries(source).map(([key, entry]) => [key, boundedNumber(entry, `${label}.${key}`)]));
}

function maxPrice(value: unknown): OpenRouterMaxPrice {
  const source = record(value, "OpenRouter max_price");
  const keys = ["prompt", "completion", "image", "request"] as const;
  assertOnlyKeys(source, keys, "OpenRouter max_price");
  if (!Object.keys(source).length) throw new OfficialModelError("INVALID_REQUEST", "OpenRouter max_price must not be empty");
  return Object.fromEntries(Object.entries(source).map(([key, entry]) => [key, boundedNumber(entry, `OpenRouter max_price.${key}`)]));
}

function providerPolicy(value: unknown): OpenRouterProviderPolicy {
  const source = record(value, "OpenRouter provider");
  const keys = [
    "order", "allow_fallbacks", "require_parameters", "data_collection", "zdr", "sort",
    "preferred_max_latency", "preferred_min_throughput", "max_price",
  ] as const;
  assertOnlyKeys(source, keys, "OpenRouter provider");
  const result: Record<string, unknown> = {};
  if (source.order !== undefined) {
    if (!Array.isArray(source.order) || !source.order.length || source.order.length > MAX_PROVIDERS) {
      throw new OfficialModelError("INVALID_REQUEST", "Invalid OpenRouter provider.order count", { params: { field: "provider.order", maximum: MAX_PROVIDERS } });
    }
    result.order = source.order.map((item, index) => boundedId(item, MAX_PROVIDER_ID_LENGTH, `OpenRouter provider.order[${index}]`));
  }
  for (const key of ["allow_fallbacks", "require_parameters", "zdr"] as const) {
    if (source[key] !== undefined) result[key] = booleanValue(source[key], `OpenRouter provider.${key}`);
  }
  if (source.data_collection !== undefined) {
    if (source.data_collection !== "allow" && source.data_collection !== "deny") {
      throw new OfficialModelError("INVALID_REQUEST", "Invalid OpenRouter provider.data_collection");
    }
    result.data_collection = source.data_collection;
  }
  if (source.sort !== undefined) {
    if (source.sort === "price" || source.sort === "throughput" || source.sort === "latency") {
      result.sort = source.sort;
    } else {
      const sort = record(source.sort, "OpenRouter provider.sort");
      assertOnlyKeys(sort, ["by", "partition"], "OpenRouter provider.sort");
      if (sort.by !== "price" && sort.by !== "throughput" && sort.by !== "latency") {
        throw new OfficialModelError("INVALID_REQUEST", "Invalid OpenRouter provider.sort.by");
      }
      if (sort.partition !== undefined && sort.partition !== "model" && sort.partition !== "none") {
        throw new OfficialModelError("INVALID_REQUEST", "Invalid OpenRouter provider.sort.partition");
      }
      result.sort = { by: sort.by, ...(sort.partition ? { partition: sort.partition } : {}) };
    }
  }
  if (source.preferred_max_latency !== undefined) {
    result.preferred_max_latency = performanceThreshold(source.preferred_max_latency, "OpenRouter provider.preferred_max_latency");
  }
  if (source.preferred_min_throughput !== undefined) {
    result.preferred_min_throughput = performanceThreshold(source.preferred_min_throughput, "OpenRouter provider.preferred_min_throughput");
  }
  if (source.max_price !== undefined) result.max_price = maxPrice(source.max_price);
  return result as OpenRouterProviderPolicy;
}

/** Validates and copies a policy so caller mutation cannot change an in-flight request. */
export function boundedOpenRouterRoutePolicy(value: unknown): OpenRouterRoutePolicy | undefined {
  if (value === undefined) return undefined;
  const source = record(value, "OpenRouter route policy");
  assertOnlyKeys(source, ["models", "provider", "session_id"], "OpenRouter route policy");
  const result: Record<string, unknown> = {};
  if (source.models !== undefined) {
    if (!Array.isArray(source.models) || !source.models.length || source.models.length > MAX_MODELS) {
      throw new OfficialModelError("INVALID_REQUEST", "Invalid OpenRouter models count", { params: { field: "models", maximum: MAX_MODELS } });
    }
    result.models = source.models.map((item, index) => boundedId(item, MAX_MODEL_ID_LENGTH, `OpenRouter models[${index}]`));
  }
  if (source.provider !== undefined) result.provider = providerPolicy(source.provider);
  if (source.session_id !== undefined) {
    result.session_id = boundedId(source.session_id, MAX_SESSION_ID_LENGTH, "OpenRouter session_id");
  }
  return result as OpenRouterRoutePolicy;
}

/** Provider options are scoped to a model named `openrouter`, so no other provider sees them. */
export function openRouterProviderOptions(policy: OpenRouterRoutePolicy | undefined): ProviderMetadata {
  const openrouter: ProviderMetadata[string] = { usage: { include: true } };
  if (policy?.models) openrouter.models = [...policy.models];
  if (policy?.provider) openrouter.provider = policy.provider as unknown as ProviderMetadata[string];
  if (policy?.session_id) openrouter.session_id = policy.session_id;
  return { openrouter };
}

function responseRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function safeObservedText(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/u.test(value) ? value : undefined;
}

function safeObservedNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_METRIC_VALUE
    ? value : undefined;
}

interface ExtractedOpenRouterMetadata {
  model?: string;
  generationId?: string;
  provider?: string;
  cost?: number;
  reasoningDetails?: OpenRouterReasoningDetail[];
  reasoningBytes?: number;
}

export type OpenRouterReasoningDetail = Record<string, string | number | null> & {
  type: "reasoning.text" | "reasoning.summary" | "reasoning.encrypted";
};

/** Keep the wire blocks opaque, including explicit [] and signature-only deltas. */
export function openRouterReasoningDetails(value: unknown): OpenRouterReasoningDetail[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 1024 || Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_REASONING_DETAILS_BYTES
    || value.some(item => !responseRecord(item)
      || !["reasoning.text", "reasoning.summary", "reasoning.encrypted"].includes(item.type)
      || Object.values(item).some(field => field !== null && typeof field !== "string" && typeof field !== "number"))) {
    throw new OfficialModelError("INVALID_RESPONSE", "OpenRouter returned invalid or oversized reasoning state");
  }
  return value.map(item => ({ ...item })) as OpenRouterReasoningDetail[];
}

export function hasKimiOpenRouterReasoningDetails(details: readonly OpenRouterReasoningDetail[] | undefined): boolean {
  return Boolean(details?.some(detail => detail.format === "kimi-done-v1"
    || (typeof detail.id === "string" && detail.id.startsWith("thinking-"))));
}

/**
 * OpenRouterTeam/ai-sdk-provider (Apache-2.0) omits unsigned Anthropic/Gemini
 * text details on replay: their upstream thought signatures cannot be rebuilt.
 * Preserve the empty array because it is itself a multi-turn protocol signal.
 */
export function replayableOpenRouterReasoningDetails(details: readonly OpenRouterReasoningDetail[]): OpenRouterReasoningDetail[] {
  return details
    .filter(detail => detail.type !== "reasoning.text"
      || !["anthropic-claude-v1", "google-gemini-v1"].includes(String(detail.format ?? "anthropic-claude-v1"))
      || (typeof detail.signature === "string" && detail.signature.length > 0))
    .map(detail => {
      const isKimi = detail.format === "kimi-done-v1" || (typeof detail.id === "string" && detail.id.startsWith("thinking-"));
      if (isKimi && "index" in detail) {
        const { index: _index, ...rest } = detail;
        return rest as OpenRouterReasoningDetail;
      }
      return detail;
    });
}

export function openRouterReadableReasoning(details: readonly OpenRouterReasoningDetail[] | undefined): string {
  return (details ?? []).map(detail => detail.type === "reasoning.text" && typeof detail.text === "string" ? detail.text
    : detail.type === "reasoning.summary" && typeof detail.summary === "string" ? detail.summary : "").join("");
}

function observeReasoning(target: ExtractedOpenRouterMetadata, source: Record<string, unknown>): void {
  const first = Array.isArray(source.choices) ? responseRecord(source.choices[0]) : undefined;
  const message = responseRecord(first?.delta) ?? responseRecord(first?.message);
  const details = openRouterReasoningDetails(message?.reasoning_details);
  if (!details) return;
  target.reasoningDetails ??= [];
  // Adapted from OpenRouterTeam/ai-sdk-provider (Apache-2.0),
  // 1b22b053/src/chat/index.ts: consecutive text/summary fragments are one
  // block; encrypted blocks remain discrete. Never group by index alone:
  // different block types can all have index 0. See upstream issue #519.
  for (const detail of details) {
    const last = target.reasoningDetails.at(-1);
    const field = detail.type === "reasoning.text" ? "text" : detail.type === "reasoning.summary" ? "summary" : undefined;
    const continuation = message === first?.delta && field && last?.type === detail.type
      && !(last.id && detail.id && last.id !== detail.id)
      && !(last.format && detail.format && last.format !== detail.format);
    if (continuation) {
      const fragment = typeof detail[field] === "string" ? detail[field] : "";
      last[field] = String(last[field] ?? "") + fragment;
      target.reasoningBytes = (target.reasoningBytes ?? 0) + Buffer.byteLength(fragment);
      for (const [key, value] of Object.entries(detail)) {
        if (key !== field && (last[key] === undefined || last[key] === null) && value !== null) {
          last[key] = value;
          target.reasoningBytes += Buffer.byteLength(JSON.stringify(value));
        }
      }
    } else {
      target.reasoningDetails.push(detail);
      target.reasoningBytes = (target.reasoningBytes ?? 0) + Buffer.byteLength(JSON.stringify(detail));
    }
    if (target.reasoningDetails.length > 1024 || (target.reasoningBytes ?? 0) > MAX_REASONING_DETAILS_BYTES) {
      throw new OfficialModelError("INVALID_RESPONSE", "OpenRouter reasoning state exceeds the size limit");
    }
  }
}

function observeChunk(target: ExtractedOpenRouterMetadata, value: unknown): void {
  const source = responseRecord(value);
  if (!source) return;
  observeReasoning(target, source);
  target.model = safeObservedText(source.model, MAX_MODEL_ID_LENGTH) ?? target.model;
  target.generationId = safeObservedText(source.id, MAX_MODEL_ID_LENGTH)
    ?? safeObservedText(source.generation_id, MAX_MODEL_ID_LENGTH)
    ?? target.generationId;
  target.provider = safeObservedText(source.provider, MAX_PROVIDER_ID_LENGTH) ?? target.provider;
  const usage = responseRecord(source.usage);
  target.cost = safeObservedNumber(usage?.cost) ?? safeObservedNumber(source.cost) ?? target.cost;
}

function metadataObject(value: ExtractedOpenRouterMetadata): ProviderMetadata[string] | undefined {
  const result: ProviderMetadata[string] = {};
  if (value.model) result.model = value.model;
  if (value.generationId) result.generationId = value.generationId;
  if (value.provider) result.provider = value.provider;
  if (value.cost !== undefined) result.cost = value.cost;
  if (value.reasoningDetails !== undefined) result.reasoning_details = value.reasoningDetails;
  return Object.keys(result).length ? result : undefined;
}

export function createOpenRouterMetadataExtractor(): MetadataExtractor {
  return {
    async extractMetadata({ parsedBody }) {
      const extracted: ExtractedOpenRouterMetadata = {};
      observeChunk(extracted, parsedBody);
      const openrouter = metadataObject(extracted);
      return openrouter ? { openrouter } : undefined;
    },
    createStreamExtractor() {
      const extracted: ExtractedOpenRouterMetadata = {};
      return {
        processChunk(parsedChunk) { observeChunk(extracted, parsedChunk); },
        buildMetadata() {
          const openrouter = metadataObject(extracted);
          return openrouter ? { openrouter } : undefined;
        },
      };
    },
  };
}

function observed<T>(value: T | undefined): OpenRouterResolvedValue<T> {
  return value === undefined ? { verified: false } : { verified: true, value };
}

function header(headers: Readonly<Record<string, string>> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return match ? safeObservedText(match[1], MAX_MODEL_ID_LENGTH) : undefined;
}

export function resolvedOpenRouterMetadata(options: {
  readonly requestedModel: string;
  readonly providerMetadata?: ProviderMetadata;
  readonly responseHeaders?: Readonly<Record<string, string>>;
  readonly usageKnown: boolean;
}): OpenRouterResolvedMetadata {
  const source = responseRecord(options.providerMetadata?.openrouter);
  const model = safeObservedText(source?.model, MAX_MODEL_ID_LENGTH);
  const generationId = header(options.responseHeaders, "x-generation-id")
    ?? safeObservedText(source?.generationId, MAX_MODEL_ID_LENGTH);
  const provider = safeObservedText(source?.provider, MAX_PROVIDER_ID_LENGTH);
  const cost = safeObservedNumber(source?.cost);
  return {
    version: 1,
    kind: "openrouter_resolved_metadata",
    requestedModel: options.requestedModel,
    model: observed(model),
    generationId: observed(generationId),
    provider: observed(provider),
    cost: observed(cost),
    usageKnown: options.usageKnown,
  };
}
