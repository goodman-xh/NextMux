/**
 * Reasoning-aware provider health probe contract (Cherry Studio #1).
 *
 * A 1-token probe false-fails every reasoning model: the single token is spent inside
 * reasoning, so the answer arrives with `finish_reason: "length"` and no visible text.
 * The probe sets no sampling controls, which reasoning models and Claude thinking refuse.
 * The probe therefore budgets enough tokens for thinking, asks for the lowest effort,
 * and treats a length-truncated or reasoning-only answer as healthy.
 *
 * This module is transport-neutral: hosts build the request with `buildHealthProbeBody`
 * and classify the outcome with `classifyHealthProbeResponse`.
 */
import { classifyModelError, contentFilterReadableError, type ReadableModelError } from "./errors.js";
import { nativeFinishReason } from "./finish-reason.js";

/** Probe output budget: enough for a reasoning model to think and still answer. */
export const HEALTH_PROBE_MAX_OUTPUT_TOKENS = 16;
/** Lowest effort keeps probe spend bounded on models that expose reasoning_effort. */
export const HEALTH_PROBE_REASONING_EFFORT = "low" as const;
/** Minimal probe prompt; providers never bill meaningfully for it. */
export const HEALTH_PROBE_PROMPT = "Reply with the single word: OK";

export interface HealthProbeRequestOptions {
  readonly protocol?: string;
  readonly model?: string;
  /** Whether the target route accepts reasoning_effort (provider contract declaration). */
  readonly reasoningEffortSupported?: boolean;
  /** Official OpenAI/Azure reasoning models require max_completion_tokens. */
  readonly useMaxCompletionTokens?: boolean;
}

/** Builds a minimal, reasoning-safe probe body for the given protocol shape. */
export function buildHealthProbeBody(options: HealthProbeRequestOptions = {}): Record<string, unknown> {
  const limit = HEALTH_PROBE_MAX_OUTPUT_TOKENS;
  const protocol = options.protocol ?? "";
  if (protocol === "anthropic_messages" || protocol === "anthropic") {
    return {
      model: options.model ?? "",
      max_tokens: limit,
      messages: [{ role: "user", content: HEALTH_PROBE_PROMPT }],
    };
  }
  if (protocol === "gemini_generate_content" || protocol === "gemini") {
    return {
      contents: [{ role: "user", parts: [{ text: HEALTH_PROBE_PROMPT }] }],
      generationConfig: { maxOutputTokens: limit },
    };
  }
  return {
    model: options.model ?? "",
    ...(options.useMaxCompletionTokens ? { max_completion_tokens: limit } : { max_tokens: limit }),
    ...(options.reasoningEffortSupported === true ? { reasoning_effort: HEALTH_PROBE_REASONING_EFFORT } : {}),
    messages: [{ role: "user", content: HEALTH_PROBE_PROMPT }],
    stream: false,
  };
}

/** Structured probe failure codes; each maps to one actionable user fix. */
export type HealthProbeFailureCode =
  | "invalid_api_key"
  | "insufficient_balance"
  | "model_not_found"
  | "rate_limited"
  | "upstream_busy"
  | "content_filtered"
  | "empty_response"
  | "rejected";

export type HealthProbeOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly httpStatus: number;
      readonly code: HealthProbeFailureCode;
      /** What the reader sees: formatModelError(error, locale) (a safety block reads as contentFilterMessage). */
      readonly error: ReadableModelError;
    };

function nonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

const positive = (value: unknown): boolean => Number(value) > 0;

/**
 * A probe response is healthy when the model produced anything at all: visible text,
 * a tool call, reasoning/thinking output, a length-truncated finish (the reasoning
 * models' normal probe outcome), or a normal finish whose usage reports generated
 * tokens. A normal finish with nothing generated is the blank answer a failing relay
 * returns with HTTP 200 (Cherry Studio #4), so it fails.
 */
export function isHealthyProbePayload(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const record = payload as Record<string, any>;
  // OpenAI-compatible chat completions.
  const choice = Array.isArray(record.choices) ? record.choices[0] : undefined;
  const message = choice?.message ?? choice?.delta;
  if (nonEmptyString(message?.content)) return true;
  if (Array.isArray(message?.tool_calls) && message.tool_calls.length > 0) return true;
  if ([message?.reasoning_content, message?.reasoning, message?.thinking].some(nonEmptyString)) return true;
  if (Array.isArray(message?.reasoning_details) && message.reasoning_details.length > 0) return true;
  if (choice?.finish_reason === "length") return true;
  if (choice && positive(record.usage?.completion_tokens)) return true;
  // Gemini generateContent.
  const candidate = Array.isArray(record.candidates) ? record.candidates[0] : undefined;
  const parts: any[] = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  if (parts.some(part => nonEmptyString(part?.text) || part?.functionCall || part?.thought === true)) return true;
  if (candidate?.finishReason === "MAX_TOKENS") return true;
  if (candidate && (positive(record.usageMetadata?.candidatesTokenCount) || positive(record.usageMetadata?.thoughtsTokenCount))) return true;
  // Anthropic messages.
  if (Array.isArray(record.content) && record.content.some((block: any) => nonEmptyString(block?.text)
    || block?.type === "tool_use" || block?.type === "thinking" || block?.type === "redacted_thinking")) return true;
  if (record.stop_reason === "max_tokens") return true;
  if (Array.isArray(record.content) && positive(record.usage?.output_tokens)) return true;
  return false;
}

/** Detects a provider safety block inside an HTTP 200 probe payload (any shape nativeFinishReason knows). */
export function isContentFilterPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const record = payload as Record<string, any>;
  const choice = Array.isArray(record.choices) ? record.choices[0] : undefined;
  const candidate = Array.isArray(record.candidates) ? record.candidates[0] : undefined;
  if ([choice?.finish_reason, candidate?.finishReason, record.stop_reason].some(reason => nativeFinishReason(reason, false) === "content-filter")) return true;
  const blockReason = record.promptFeedback?.blockReason;
  if (typeof blockReason === "string" && blockReason !== "BLOCK_REASON_UNSPECIFIED") return true;
  const errorCode = String(record.error?.code ?? record.error?.type ?? "").toLowerCase();
  return errorCode === "content_filter" || errorCode === "responsibleaipolicyviolation";
}

/**
 * Classifies one probe exchange. HTTP status maps to the structured failure code;
 * a 200 body is inspected for in-stream errors, safety blocks, and empty answers.
 */
export function classifyHealthProbeResponse(status: number, payload?: unknown): HealthProbeOutcome {
  if (status >= 200 && status < 300) {
    if (isContentFilterPayload(payload)) return { ok: false, httpStatus: status, code: "content_filtered", error: contentFilterReadableError() };
    if (payload && typeof payload === "object" && (payload as Record<string, any>).error) {
      return { ok: false, httpStatus: status, code: "rejected", error: classifyModelError(payload) };
    }
    if (isHealthyProbePayload(payload)) return { ok: true };
    return {
      ok: false,
      httpStatus: status,
      code: "empty_response",
      error: classifyModelError({ kind: "invalid_response", message: "The health probe returned no output" }),
    };
  }
  const error = classifyModelError({ httpStatus: status, ...(payload && typeof payload === "object" ? payload : {}) });
  // What the provider said decides first ("429 insufficient_quota" is an empty balance, not a busy key); the status
  // decides when it said nothing specific.
  const code: HealthProbeFailureCode = ["auth_invalid", "auth_missing"].includes(error.kind) ? "invalid_api_key"
    : ["balance_insufficient", "provider_quota_exhausted"].includes(error.kind) ? "insufficient_balance"
      : error.kind === "model_not_found" ? "model_not_found"
        : error.kind === "content_refused" ? "content_filtered"
          : status === 401 || status === 403 ? "invalid_api_key"
            : status === 402 ? "insufficient_balance"
              : status === 404 ? "model_not_found"
                : status === 429 ? "rate_limited"
                  : status >= 500 ? "upstream_busy"
                    : "rejected";
  return { ok: false, httpStatus: status, code, error };
}
