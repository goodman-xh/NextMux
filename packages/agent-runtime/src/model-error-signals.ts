/**
 * Extracts conservative, provider-independent signals from errors that have
 * been wrapped by an SDK.  Some SDKs put the useful HTTP status only in the
 * final error message (for example, after their own retry loop), so callers
 * must not rely exclusively on enumerable `status` fields.
 */
export interface ModelErrorSignal {
  readonly rateLimited: boolean;
  readonly httpStatus?: number;
  readonly retryAfterMs?: number;
  readonly requestId?: string;
}

const DIAGNOSTIC_KINDS = ["error", "object", "array", "string", "number", "boolean", "undefined", "null", "bigint", "symbol", "function"] as const;
const DIAGNOSTIC_SOURCES = ["adapter_exception", "sdk_stream_error"] as const;
const DIAGNOSTIC_NAMES = ["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "AbortError", "TimeoutError", "OtherError",
  "AI_APICallError", "AI_RetryError", "AI_JSONParseError", "AI_TypeValidationError", "AI_InvalidResponseDataError",
  "AI_NoOutputGeneratedError", "AI_LoadAPIKeyError", "AI_UnsupportedFunctionalityError", "AI_InvalidArgumentError",
  "AI_InvalidPromptError", "AI_NoSuchModelError"] as const;
const STREAM_ERROR_CODES = ["server_error", "server_is_overloaded", "rate_limit_exceeded", "insufficient_quota",
  "context_length_exceeded", "invalid_api_key", "model_not_found", "invalid_prompt", "invalid_request_error",
  "usage_not_included", "content_policy_violation"] as const;
const PROVIDER_ERROR_TYPES = ["upstream_error"] as const;

/** Structural evidence only. These fields never decide classification or retries. */
export interface ModelErrorDiagnostic {
  readonly kind: typeof DIAGNOSTIC_KINDS[number];
  readonly source?: typeof DIAGNOSTIC_SOURCES[number];
  readonly names?: readonly typeof DIAGNOSTIC_NAMES[number][];
  readonly streamType?: "error" | "response.failed";
  /** Inner provider error.type, separate from the outer stream event type. */
  readonly providerErrorType?: typeof PROVIDER_ERROR_TYPES[number];
  readonly streamCode?: typeof STREAM_ERROR_CODES[number];
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : undefined;
}

/** Also used at persistence boundaries: arbitrary messages and field names cannot enter a receipt. */
export function normalizeModelErrorDiagnostic(value: unknown): ModelErrorDiagnostic | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const kind = enumValue(record.kind, DIAGNOSTIC_KINDS);
  if (!kind) return undefined;
  const source = enumValue(record.source, DIAGNOSTIC_SOURCES);
  const names = Array.isArray(record.names) ? record.names.slice(0, 6)
    .map(name => enumValue(name, DIAGNOSTIC_NAMES)).filter((name): name is typeof DIAGNOSTIC_NAMES[number] => name !== undefined) : [];
  const streamType = enumValue(record.streamType, ["error", "response.failed"] as const);
  const providerErrorType = enumValue(record.providerErrorType, PROVIDER_ERROR_TYPES);
  const streamCode = enumValue(record.streamCode, STREAM_ERROR_CODES);
  return { kind, ...(source ? { source } : {}), ...(names.length ? { names } : {}),
    ...(streamType ? { streamType } : {}), ...(providerErrorType ? { providerErrorType } : {}), ...(streamCode ? { streamCode } : {}) };
}

function diagnosticField(value: unknown, key: string): unknown {
  try { return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined; }
  catch { return undefined; }
}

/** Inspect non-enumerable Error/cause fields without retaining raw messages, bodies, URLs or stack traces. */
export function inspectModelErrorDiagnostic(error: unknown, source?: ModelErrorDiagnostic["source"]): ModelErrorDiagnostic {
  const kind = error === null ? "null" : error instanceof Error ? "error" : Array.isArray(error) ? "array" : typeof error;
  const names: typeof DIAGNOSTIC_NAMES[number][] = [];
  const seen = new Set<object>();
  let current = error;
  let streamType: ModelErrorDiagnostic["streamType"];
  let providerErrorType: ModelErrorDiagnostic["providerErrorType"];
  let streamCode: ModelErrorDiagnostic["streamCode"];
  for (let depth = 0; depth < 6 && current && typeof current === "object" && !seen.has(current); depth += 1) {
    seen.add(current);
    const name = enumValue(diagnosticField(current, "name"), DIAGNOSTIC_NAMES);
    if (name || current instanceof Error) names.push(name ?? "OtherError");
    // The Responses SDK places early error frames in APICallError.data;
    // after generation starts it forwards the same frame directly.
    for (const envelope of [current, diagnosticField(current, "data")]) {
      streamType ??= enumValue(diagnosticField(envelope, "type"), ["error", "response.failed"] as const);
      for (const candidate of [envelope, diagnosticField(envelope, "error"), diagnosticField(diagnosticField(envelope, "response"), "error")]) {
        // Compatible Chat Completions forwards error.type on the inner object.
        // Preserve only reviewed fixed types, never the provider's free text.
        providerErrorType ??= enumValue(diagnosticField(candidate, "type"), PROVIDER_ERROR_TYPES);
        streamCode ??= enumValue(diagnosticField(candidate, "code"), STREAM_ERROR_CODES);
      }
    }
    current = diagnosticField(current, "cause");
  }
  return normalizeModelErrorDiagnostic({ kind, source, names, streamType, providerErrorType, streamCode })!;
}

const MAX_RETRY_AFTER_MS = 300_000;

function boundedMilliseconds(value: number): number | undefined {
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.min(MAX_RETRY_AFTER_MS, Math.floor(value));
}

function errorMessageParts(value: unknown): readonly string[] {
  const parts: string[] = [];
  const pending: unknown[] = [value];
  const seen = new Set<object>();

  while (pending.length && parts.length < 16) {
    const current = pending.shift();
    if (typeof current === "string") {
      if (current.trim()) parts.push(current);
      continue;
    }
    if (!current || typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);
    const record = current as Record<string, unknown>;
    if (current instanceof Error && current.message.trim()) parts.push(current.message);
    for (const key of ["message", "reason", "statusText"] as const) {
      if (typeof record[key] === "string" && record[key].trim()) parts.push(record[key] as string);
    }
    for (const key of ["cause", "lastError", "error", "data", "response"] as const) {
      if (record[key] !== undefined) pending.push(record[key]);
    }
    const errors = record.errors;
    if (Array.isArray(errors)) pending.push(...errors.slice(-8));
  }
  return parts;
}

function inferStatus(text: string): number | undefined {
  const match = text.match(/\b(?:HTTP\s*|status(?:\s+code)?\s*[:=]\s*)(4\d{2}|5\d{2})\b/i)
    ?? text.match(/\b(429)\s+too\s+many\s+requests\b/i);
  return match ? Number(match[1]) : undefined;
}

function inferRetryAfterMs(text: string): number | undefined {
  const match = text.match(/\bretry[\s_-]*after(?:\s*(?:is|:|=))?\s*(\d+(?:\.\d+)?)\s*(milliseconds?|ms|seconds?|secs?|s)?\b/i);
  if (!match) return undefined;
  const value = Number(match[1]);
  const unit = (match[2] ?? "seconds").toLowerCase();
  return boundedMilliseconds(unit.startsWith("ms") || unit.startsWith("millisecond") ? value : value * 1_000);
}

function inferRequestId(text: string): string | undefined {
  const match = text.match(/\brequest[\s_-]*id\s*[:=]\s*([A-Za-z0-9._:/-]{4,200})/i);
  return match?.[1];
}

function isRateLimitText(text: string): boolean {
  const hasRateLimitPhrase = /\b(?:too\s+many\s+requests|rate[\s_-]*limit(?:ed|ing)?|throttl(?:ed|ing)?)\b/i.test(text)
    || /quota[\s_-]*(?:exceeded|exhausted|limit|depleted)|insufficient[\s_-]*quota/i.test(text);
  const hasRetryLimitWithStatus = /\b(?:exceeded|reached|max(?:imum)?)[\s_-]+(?:the\s+)?retry[\s_-]+limit\b[\s\S]*\b429\b/i.test(text);
  return hasRateLimitPhrase || hasRetryLimitWithStatus;
}

/**
 * Returns only bounded, non-secret transport hints.  A bare phrase such as
 * “retry limit” is intentionally not enough; it must carry a rate-limit
 * phrase or the concrete 429 status to avoid misclassifying application
 * retry policies.
 */
export function inspectModelErrorSignal(value: unknown): ModelErrorSignal {
  const text = errorMessageParts(value).join(" ");
  const httpStatus = inferStatus(text);
  const rateLimited = httpStatus === 429 || isRateLimitText(text);
  const retryAfterMs = inferRetryAfterMs(text);
  const requestId = inferRequestId(text);
  return {
    rateLimited,
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    ...(requestId === undefined ? {} : { requestId }),
  };
}
