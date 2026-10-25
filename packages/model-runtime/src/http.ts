import type { OfficialProviderProtocol } from "./presets.js";
import type { OfficialModelUsage } from "./types.js";
import { classifyModelError, CONTENT_FILTER_PUBLIC_MESSAGE, contentFilterReadableError, normalizeErrorMessageParams, type ErrorMessageParams, type ModelErrorKind, type ReadableModelError } from "./errors.js";
import { inspectModelErrorSignal, inspectModelErrorDiagnostic, normalizeModelErrorDiagnostic, type ModelErrorDiagnostic } from "@nextmux/agent-runtime";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
/** Replayed thinking a model wrote (DeepSeek and GLM can think for 20k+ tokens on one tool call). */
export const MAX_REASONING_DETAILS_BYTES = 512 * 1024;
/** A turn's saved provider state: the reasoning text plus its wire details, and tool-call metadata. */
export const MAX_PROVIDER_STATE_BYTES = 1536 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_RETRY_AFTER_MS = 300_000;

export type OfficialModelFailureStage = "validation" | "request" | "connection" | "response" | "stream" | "decode" | "cancelled" | "unknown";
export type OfficialModelFailureCategory = "authentication" | "rate_limit" | "timeout" | "network" | "upstream" | "invalid_request" | "invalid_response" | "cancelled" | "unknown";

export interface OfficialModelErrorDetails {
  readonly messageKey?: string;
  readonly params?: ErrorMessageParams;
  readonly readableError?: ReadableModelError;
  readonly diagnostic?: ModelErrorDiagnostic;
  /** Observed provider usage on a failed output decode, never a guessed charge. */
  readonly usage?: OfficialModelUsage;
  readonly usageKnown?: boolean;
  readonly stage?: OfficialModelFailureStage;
  readonly category?: OfficialModelFailureCategory;
  readonly retryable?: boolean;
  /** True only for a proven pre-dispatch failure or an explicit HTTP rejection before any generation output. */
  readonly retrySafe?: boolean;
  readonly httpStatus?: number;
  /** Bounded server-advised delay before a safe retry, in milliseconds. */
  readonly retryAfterMs?: number;
  readonly requestId?: string;
  readonly attemptId?: string;
  readonly providerCode?: string;
  readonly networkCode?: string;
}

export interface OfficialModelErrorSnapshot {
  readonly domain: "model";
  readonly messageKey: string;
  readonly params: ErrorMessageParams;
  readonly readableError?: ReadableModelError;
  readonly diagnostic?: ModelErrorDiagnostic;
  readonly usage?: OfficialModelUsage;
  readonly usageKnown?: boolean;
  readonly code: string;
  readonly message: string;
  readonly stage: OfficialModelFailureStage;
  readonly category: OfficialModelFailureCategory;
  readonly retryable: boolean;
  readonly retrySafe: boolean;
  readonly httpStatus?: number;
  readonly retryAfterMs?: number;
  readonly requestId?: string;
  readonly attemptId?: string;
  readonly providerCode?: string;
  readonly networkCode?: string;
}

function failureDefaults(code: string): Required<Pick<OfficialModelErrorDetails, "stage" | "category" | "retryable" | "retrySafe">> {
  if (code === "CANCELLED") return { stage: "cancelled", category: "cancelled", retryable: false, retrySafe: false };
  if (code === "AUTH_FAILED" || code === "INVALID_API_KEY") {
    return { stage: code === "INVALID_API_KEY" ? "validation" : "response", category: "authentication", retryable: false, retrySafe: false };
  }
  if (code === "RATE_LIMITED") return { stage: "response", category: "rate_limit", retryable: true, retrySafe: false };
  if (code.includes("TIMEOUT") || code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT") {
    return { stage: "connection", category: "timeout", retryable: true, retrySafe: false };
  }
  if (["ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ENETUNREACH", "ENOTFOUND", "NETWORK_ERROR", "CONNECTION_FAILED"].includes(code)) {
    return { stage: "connection", category: "network", retryable: true, retrySafe: false };
  }
  if (code === "UPSTREAM_UNAVAILABLE") return { stage: "response", category: "upstream", retryable: true, retrySafe: false };
  if (code === "CONTENT_FILTER") return { stage: "response", category: "invalid_request", retryable: false, retrySafe: false };
  if (code === "BALANCE_INSUFFICIENT") return { stage: "response", category: "invalid_request", retryable: false, retrySafe: false };
  if (["INVALID_RESPONSE", "INVALID_USAGE", "INVALID_TOOL_CALL", "RESPONSE_TOO_LARGE", "INVALID_OUTPUT", "UNSUPPORTED_OUTPUT", "OUTPUT_TOO_LARGE", "EMPTY_RESPONSE"].includes(code)) {
    return { stage: "decode", category: "invalid_response", retryable: false, retrySafe: false };
  }
  if (code.startsWith("INVALID_") || code === "UNSUPPORTED_PROTOCOL" || code === "UNSUPPORTED_CAPABILITY"
    || code === "REQUEST_TOO_LARGE" || code === "REQUEST_REJECTED" || code === "MODEL_NOT_FOUND") {
    return { stage: code === "REQUEST_REJECTED" || code === "MODEL_NOT_FOUND" ? "response" : "validation", category: "invalid_request", retryable: false, retrySafe: false };
  }
  return { stage: "unknown", category: "unknown", retryable: false, retrySafe: false };
}

function safeIdentifier(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text && text.length <= 200 && /^[A-Za-z0-9._:/-]+$/.test(text) ? text : undefined;
}

function boundedRetryAfterMs(value: unknown, now = Date.now()): number | undefined {
  const number = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim())
      ? Number(value.trim()) : NaN;
  if (!Number.isFinite(number) || number < 0) return undefined;
  if (number >= 100_000_000_000) return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, Math.floor(number - now)));
  return Math.min(MAX_RETRY_AFTER_MS, Math.floor(number));
}

function boundedRetryAfterSecondsMs(value: unknown, now = Date.now()): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    if (value >= 100_000_000_000) return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, Math.floor(value - now)));
    if (value >= 1_000_000_000) return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, Math.floor((value - now / 1_000) * 1_000)));
    return Math.min(MAX_RETRY_AFTER_MS, Math.floor(value * 1_000));
  }
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const number = Number(trimmed);
    if (!Number.isFinite(number) || number < 0) return undefined;
    if (number >= 100_000_000_000) return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, Math.floor(number - now)));
    if (number >= 1_000_000_000) return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, Math.floor((number - now / 1_000) * 1_000)));
    return Math.min(MAX_RETRY_AFTER_MS, Math.floor(number * 1_000));
  }
  const durationMatch = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m(?!s))?(?:(\d+(?:\.\d+)?)s)?(?:(\d+(?:\.\d+)?)ms)?$/i.exec(trimmed);
  if (durationMatch && (durationMatch[1] || durationMatch[2] || durationMatch[3] || durationMatch[4])) {
    const hours = Number(durationMatch[1] || 0);
    const minutes = Number(durationMatch[2] || 0);
    const secs = Number(durationMatch[3] || 0);
    const millis = Number(durationMatch[4] || 0);
    const totalMs = (hours * 3600 + minutes * 60 + secs) * 1_000 + millis;
    return Number.isFinite(totalMs) && totalMs >= 0 ? Math.min(MAX_RETRY_AFTER_MS, Math.floor(totalMs)) : undefined;
  }
  return undefined;
}

function retryAfterHeaderMs(value: unknown, now = Date.now()): number | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return undefined;
  const seconds = boundedRetryAfterSecondsMs(text, now);
  if (seconds !== undefined) return seconds;
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, timestamp - now));
}

function headerRawValue(headers: unknown, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return undefined;
  const record = headers as Record<string, unknown>;
  const wanted = name.toLowerCase();
  const key = Object.keys(record).find(candidate => candidate.toLowerCase() === wanted);
  return key ? String(record[key]) : undefined;
}

function validUsageToken(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

/** Product exceptions classify by stable codes; provider envelopes retain their own structured diagnosis. */
const MODEL_CODE_KINDS: Readonly<Record<string, ModelErrorKind>> = {
  INVALID_API_KEY: 'auth_invalid', AUTH_FAILED: 'auth_invalid', DISCOVERY_CREDENTIALS_MISSING: 'auth_missing',
  INVALID_MODEL: 'invalid_request', INVALID_BASE_URL: 'invalid_request', INSECURE_BASE_URL: 'invalid_request',
  PRIVATE_BASE_URL: 'invalid_request', LOCAL_MODEL_URL_REQUIRED: 'invalid_request', INVALID_REQUEST: 'invalid_request',
  UNSUPPORTED_PROTOCOL: 'model_not_supported_here', UNSUPPORTED_CAPABILITY: 'model_not_supported_here', DISCOVERY_UNSUPPORTED: 'model_not_supported_here',
  REQUEST_TOO_LARGE: 'upload_too_large', RESPONSE_TOO_LARGE: 'output_too_long', OUTPUT_TOO_LARGE: 'output_too_long',
  INVALID_RESPONSE: 'invalid_response', INVALID_USAGE: 'invalid_response', INVALID_OUTPUT: 'invalid_response',
  UNSUPPORTED_OUTPUT: 'model_not_supported_here', INVALID_ASSISTANT_OUTPUT: 'invalid_request', INVALID_TOOL_CALL: 'tool_call_invalid',
  RATE_LIMITED: 'rate_limited', TIMEOUT: 'timeout', CANCELLED: 'cancelled', MODEL_NOT_FOUND: 'model_not_found',
  UPSTREAM_UNAVAILABLE: 'provider_error', REQUEST_REJECTED: 'invalid_request', NETWORK_ERROR: 'network',
  CONTENT_FILTER: 'content_refused', EMPTY_RESPONSE: 'invalid_response', BALANCE_INSUFFICIENT: 'provider_quota_exhausted',
};

export class OfficialModelError extends Error {
  readonly domain = "model" as const;
  readonly messageKey: string;
  readonly params: ErrorMessageParams;
  readonly readableError: ReadableModelError;
  /** JSON-RPC preserves Error.data even when other custom Error fields are dropped. */
  readonly data: { readonly readableError: ReadableModelError; readonly domain: "model"; readonly code: string; readonly messageKey: string; readonly params: ErrorMessageParams };
  readonly diagnostic?: ModelErrorDiagnostic;
  readonly usage?: OfficialModelUsage;
  readonly usageKnown?: boolean;
  readonly code: string;
  readonly publicMessage: string;
  readonly stage: OfficialModelFailureStage;
  readonly category: OfficialModelFailureCategory;
  readonly retryable: boolean;
  readonly retrySafe: boolean;
  readonly httpStatus?: number;
  readonly retryAfterMs?: number;
  readonly requestId?: string;
  readonly attemptId?: string;
  readonly providerCode?: string;
  readonly networkCode?: string;

  constructor(code: string, publicMessage: string, details: OfficialModelErrorDetails = {}) {
    super(publicMessage);
    this.name = "OfficialModelError";
    this.code = code;
    this.publicMessage = publicMessage;
    this.messageKey = details.messageKey ?? `model.${code.toLowerCase()}`;
    this.params = normalizeErrorMessageParams(details.params);
    this.readableError = classifyModelError({ ...(details.readableError ?? { code, message: publicMessage, ...details, kind: MODEL_CODE_KINDS[code] }), domain: this.domain, messageKey: this.messageKey, params: this.params });
    this.data = { readableError: this.readableError, domain: this.domain, code, messageKey: this.messageKey, params: this.params };
    this.diagnostic = normalizeModelErrorDiagnostic(details.diagnostic);
    const defaults = failureDefaults(code);
    this.stage = details.stage ?? defaults.stage;
    this.category = details.category ?? defaults.category;
    this.retryable = details.retryable ?? defaults.retryable;
    this.retrySafe = details.retrySafe ?? defaults.retrySafe;
    const status = Number(details.httpStatus);
    if (Number.isSafeInteger(status) && status >= 100 && status <= 599) this.httpStatus = status;
    this.retryAfterMs = boundedRetryAfterMs(details.retryAfterMs);
    this.requestId = safeIdentifier(details.requestId);
    this.attemptId = safeIdentifier(details.attemptId);
    this.providerCode = safeIdentifier(details.providerCode);
    this.networkCode = safeIdentifier(details.networkCode);
    if (details.usageKnown !== undefined) {
      const value = details.usage;
      this.usageKnown = details.usageKnown === true && Boolean(value
        && Number.isSafeInteger(value.inputTokens) && value.inputTokens >= 0
        && Number.isSafeInteger(value.outputTokens) && value.outputTokens >= 0);
      if (this.usageKnown && value) {
        this.usage = {
          inputTokens: value.inputTokens,
          outputTokens: value.outputTokens,
          ...(validUsageToken(value.cachedInputTokens) ? { cachedInputTokens: value.cachedInputTokens } : {}),
          ...(validUsageToken(value.cacheWriteTokens) ? { cacheWriteTokens: value.cacheWriteTokens } : {}),
          ...(validUsageToken(value.reasoningTokens) ? { reasoningTokens: value.reasoningTokens } : {}),
          ...(value.cacheStatus === "hit" || value.cacheStatus === "miss" || value.cacheStatus === "unknown"
            ? { cacheStatus: value.cacheStatus } : {}),
        };
      }
    }
  }

  toJSON(): OfficialModelErrorSnapshot {
    return {
      readableError: this.readableError,
      domain: this.domain,
      messageKey: this.messageKey,
      params: this.params,
      code: this.code,
      message: this.publicMessage,
      stage: this.stage,
      category: this.category,
      retryable: this.retryable,
      retrySafe: this.retrySafe,
      ...(this.diagnostic ? { diagnostic: this.diagnostic } : {}),
      ...(this.usageKnown === undefined ? {} : { usageKnown: this.usageKnown }),
      ...(this.usage ? { usage: this.usage } : {}),
      ...(this.httpStatus !== undefined ? { httpStatus: this.httpStatus } : {}),
      ...(this.retryAfterMs !== undefined ? { retryAfterMs: this.retryAfterMs } : {}),
      ...(this.requestId ? { requestId: this.requestId } : {}),
      ...(this.attemptId ? { attemptId: this.attemptId } : {}),
      ...(this.providerCode ? { providerCode: this.providerCode } : {}),
      ...(this.networkCode ? { networkCode: this.networkCode } : {}),
    };
  }
}

/**
 * A response the provider's safety system blocked: an OpenAI/Azure `content_filter` finish, a Gemini SAFETY-family
 * finish or blocked prompt, a Claude `refusal`, a Cohere toxic-content stop. Every adapter fails with this one error;
 * readers see the approved sentence through formatModelError (contentFilterMessage), and `detail` keeps what the
 * provider said for the details view.
 */
/** The categories an OpenAI/Azure `content_filter_details` (or `content_filter_results`) object marks as filtered. */
export function contentFilterCategories(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return Object.entries(value as Record<string, any>).filter(([, result]) => result?.filtered === true)
    .map(([category]) => category.replace(/[^\w-]/g, "").slice(0, 40)).filter(Boolean).slice(0, 8).join(", ");
}

export function contentFilterError(detail?: string, details: OfficialModelErrorDetails = {}): OfficialModelError {
  return new OfficialModelError("CONTENT_FILTER", CONTENT_FILTER_PUBLIC_MESSAGE, {
    ...details,
    readableError: contentFilterReadableError(detail),
  });
}

export interface NormalizedErrorContext {
  readonly provider?: string;
  readonly diagnosticSource?: ModelErrorDiagnostic["source"];
  readonly signal?: AbortSignal;
  readonly timedOut?: boolean;
  readonly attemptId?: string;
}

interface SafeErrorDiagnostics {
  readonly readableError?: ReadableModelError;
  readonly httpStatus?: number;
  readonly retryAfterMs?: number;
  readonly requestId?: string;
  readonly attemptId?: string;
  readonly providerCode?: string;
  readonly networkCode?: string;
}

const NETWORK_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "EAI_AGAIN",
  "ENETDOWN",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function objectAt(value: unknown, ...path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function headerValue(headers: unknown, names: readonly string[]): string | undefined {
  if (headers instanceof Headers) {
    for (const name of names) {
      const value = safeIdentifier(headers.get(name));
      if (value) return value;
    }
    return undefined;
  }
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return undefined;
  const record = headers as Record<string, unknown>;
  for (const name of names) {
    const value = safeIdentifier(record[name] ?? record[name.toLowerCase()] ?? record[name.toUpperCase()]);
    if (value) return value;
  }
  return undefined;
}

function safeErrorDiagnostics(error: unknown): SafeErrorDiagnostics {
  const records: Record<string, unknown>[] = [];
  let current = error;
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth += 1) {
    const record = current as Record<string, unknown>;
    records.push(record);
    current = record.cause;
  }
  let httpStatus: number | undefined;
  let retryAfterMs: number | undefined;
  let requestId: string | undefined;
  let attemptId: string | undefined;
  let providerCode: string | undefined;
  let networkCode: string | undefined;
  const requestHeaderNames = ["x-request-id", "request-id", "openai-request-id", "anthropic-request-id", "x-goog-request-id"];
  for (const record of records) {
    const status = Number(record.httpStatus ?? record.statusCode ?? record.status ?? objectAt(record, "response", "status"));
    if (httpStatus === undefined && Number.isSafeInteger(status) && status >= 100 && status <= 599) httpStatus = status;
    const retrySources = [
      record,
      objectAt(record, "data"),
      objectAt(record, "error"),
      objectAt(record, "data", "error"),
      objectAt(record, "details")
    ];
    for (const source of retrySources) {
      if (!source || typeof source !== "object") continue;
      if (Array.isArray(source)) {
        for (const item of source) {
          if (item && typeof item === "object" && !Array.isArray(item)) {
            const detailRecord = item as Record<string, unknown>;
            retryAfterMs ??= boundedRetryAfterSecondsMs(detailRecord.retryDelay ?? detailRecord.retryAfter ?? detailRecord.retry_after);
          }
        }
        continue;
      }
      const retryRecord = source as Record<string, unknown>;
      retryAfterMs ??= boundedRetryAfterMs(retryRecord.retryAfterMs ?? retryRecord.retry_after_ms)
        ?? boundedRetryAfterSecondsMs(retryRecord.retryAfter ?? retryRecord.retry_after ?? retryRecord.retryAfterSeconds ?? retryRecord.retryDelay);
      if (Array.isArray(retryRecord.details)) {
        for (const item of retryRecord.details) {
          if (item && typeof item === "object" && !Array.isArray(item)) {
            const detailRecord = item as Record<string, unknown>;
            retryAfterMs ??= boundedRetryAfterSecondsMs(detailRecord.retryDelay ?? detailRecord.retryAfter ?? detailRecord.retry_after);
          }
        }
      }
    }
    const headersCandidate = record.responseHeaders ?? record.headers ?? objectAt(record, "response", "headers");
    if (retryAfterMs === undefined && headersCandidate) {
      const msHeader = headerRawValue(headersCandidate, "retry-after-ms") ?? headerRawValue(headersCandidate, "x-ms-retry-after-ms");
      if (msHeader !== undefined) retryAfterMs = boundedRetryAfterMs(msHeader);
      for (const headerName of [
        "retry-after",
        "x-ratelimit-reset-requests",
        "x-ratelimit-reset-tokens",
        "x-ratelimit-reset",
        "anthropic-ratelimit-requests-reset",
        "anthropic-ratelimit-tokens-reset",
        "anthropic-ratelimit-input-tokens-reset",
        "anthropic-ratelimit-output-tokens-reset",
      ]) {
        if (retryAfterMs !== undefined) break;
        const rawHeader = headerRawValue(headersCandidate, headerName);
        if (rawHeader !== undefined) retryAfterMs = retryAfterHeaderMs(rawHeader);
      }
    }
    requestId ??= safeIdentifier(record.requestId ?? record.request_id ?? objectAt(record, "response", "requestId"))
      ?? headerValue(headersCandidate, requestHeaderNames);
    attemptId ??= safeIdentifier(record.attemptId ?? record.attempt_id ?? record.providerAttemptId);
    const code = safeIdentifier(record.code);
    const explicitNetworkCode = safeIdentifier(record.networkCode);
    const networkCandidate = explicitNetworkCode
      ?? (code && NETWORK_ERROR_CODES.has(code.toUpperCase()) ? code.toUpperCase() : undefined);
    networkCode ??= networkCandidate;
    providerCode ??= safeIdentifier(record.providerCode ?? objectAt(record, "data", "error", "code")
      ?? objectAt(record, "error", "code"));
  }
  return { httpStatus, retryAfterMs, requestId, attemptId, providerCode, networkCode, readableError: classifyModelError(error) };
}

function mergedDetails(
  primary: SafeErrorDiagnostics,
  secondary: SafeErrorDiagnostics = {},
): SafeErrorDiagnostics {
  return {
    readableError: primary.readableError ?? secondary.readableError,
    httpStatus: primary.httpStatus ?? secondary.httpStatus,
    retryAfterMs: primary.retryAfterMs ?? secondary.retryAfterMs,
    requestId: primary.requestId ?? secondary.requestId,
    attemptId: primary.attemptId ?? secondary.attemptId,
    providerCode: primary.providerCode ?? secondary.providerCode,
    networkCode: primary.networkCode ?? secondary.networkCode,
  };
}

function responseDiagnostics(response: Response, payload?: unknown): SafeErrorDiagnostics {
  return mergedDetails(safeErrorDiagnostics({
    status: response.status,
    headers: response.headers,
    data: payload,
  }), safeErrorDiagnostics(response));
}

/**
 * Converts transport and provider failures into one stable, redacted error
 * interface shared by every model adapter.
 */
export function normalizeOfficialModelError(
  error: unknown,
  context: NormalizedErrorContext = {},
): OfficialModelError {
  if (error instanceof OfficialModelError) {
    if (context.provider) {
      const readableError = classifyModelError({ ...error.readableError, kind: undefined }, { provider: context.provider });
      if (readableError.kind !== 'unknown' && readableError.kind !== error.readableError.kind) {
        return new OfficialModelError(error.code, error.publicMessage, { ...error.toJSON(), readableError, attemptId: context.attemptId ?? error.attemptId });
      }
    }
    const wrappedSignal = inspectModelErrorSignal(error);
    if (error.code === "MODEL_CALL_FAILED" && wrappedSignal.rateLimited) {
      return new OfficialModelError("RATE_LIMITED", "The model service is rate limited or the account balance is insufficient", {
        ...error.toJSON(),
        ...(wrappedSignal.httpStatus === undefined ? {} : { httpStatus: wrappedSignal.httpStatus }),
        ...(wrappedSignal.retryAfterMs === undefined ? {} : { retryAfterMs: wrappedSignal.retryAfterMs }),
        ...(wrappedSignal.requestId === undefined ? {} : { requestId: wrappedSignal.requestId }),
        attemptId: context.attemptId ?? error.attemptId,
      });
    }
    if (!context.attemptId || error.attemptId) return error;
    return new OfficialModelError(error.code, error.publicMessage, {
      ...error.toJSON(),
      attemptId: context.attemptId,
    });
  }

  const diagnostics = { ...safeErrorDiagnostics(error), readableError: classifyModelError(error, { provider: context.provider }), diagnostic: inspectModelErrorDiagnostic(error, context.diagnosticSource) };
  const signal = inspectModelErrorSignal(error);
  const name = error instanceof Error ? error.name : "";
  const normalizedName = name.toLowerCase();
  const networkCode = diagnostics.networkCode?.toUpperCase();

  if (context.timedOut
    || normalizedName.includes("timeout")
    || networkCode === "ETIMEDOUT"
    || networkCode === "UND_ERR_CONNECT_TIMEOUT"
    || networkCode === "UND_ERR_HEADERS_TIMEOUT") {
    return new OfficialModelError("TIMEOUT", "Model connection timed out", {
      ...diagnostics,
      readableError: { ...diagnostics.readableError!, kind: 'timeout' },
      attemptId: context.attemptId,
      stage: "connection",
      category: "timeout",
      retryable: true,
      retrySafe: false,
    });
  }

  if (context.signal?.aborted || normalizedName === "aborterror") {
    return new OfficialModelError("CANCELLED", "Model request cancelled", {
      ...diagnostics,
      readableError: { ...diagnostics.readableError!, kind: 'cancelled' },
      attemptId: context.attemptId,
      stage: "cancelled",
      category: "cancelled",
      retryable: false,
      retrySafe: false,
    });
  }

  if (diagnostics.httpStatus !== undefined) {
    const failure = upstreamError(diagnostics.httpStatus, diagnostics);
    return context.attemptId
      ? new OfficialModelError(failure.code, failure.publicMessage, { ...failure.toJSON(), attemptId: context.attemptId })
      : failure;
  }

  if (signal.rateLimited) {
    return new OfficialModelError("RATE_LIMITED", "The model service is rate limited or the account balance is insufficient", {
      ...diagnostics,
      ...(signal.httpStatus === undefined ? {} : { httpStatus: signal.httpStatus }),
      ...(signal.retryAfterMs === undefined ? {} : { retryAfterMs: signal.retryAfterMs }),
      ...(signal.requestId === undefined ? {} : { requestId: signal.requestId }),
      attemptId: context.attemptId,
      stage: "response",
      category: "rate_limit",
      retryable: true,
      retrySafe: false,
    });
  }

  if (networkCode) {
    return new OfficialModelError(networkCode, "Unable to connect to the model service", {
      ...diagnostics,
      attemptId: context.attemptId,
      networkCode,
      stage: "connection",
      category: "network",
      retryable: true,
      retrySafe: false,
    });
  }

  if (/json|parse|validation|decode|response|content/.test(normalizedName)) {
    return new OfficialModelError("INVALID_RESPONSE", "The model returned unreadable data", {
      ...diagnostics,
      attemptId: context.attemptId,
      stage: "decode",
      category: "invalid_response",
      retryable: false,
      retrySafe: false,
    });
  }

  if (error instanceof TypeError) {
    return new OfficialModelError("NETWORK_ERROR", "Unable to connect to the model service", {
      ...diagnostics,
      attemptId: context.attemptId,
      stage: "connection",
      category: "network",
      retryable: true,
      retrySafe: false,
    });
  }

  // An SDK stream error carrying a fixed provider type supports a public reason,
  // not an invented HTTP status, transient classification, or permission to retry.
  const publicMessage = diagnostics.diagnostic.source === "sdk_stream_error" && diagnostics.diagnostic.providerErrorType === "upstream_error"
    ? "The upstream service returned an error; the request did not complete" : "Model request failed";
  return new OfficialModelError("MODEL_CALL_FAILED", publicMessage, {
    ...diagnostics,
    attemptId: context.attemptId,
    stage: "unknown",
    category: "unknown",
    retryable: false,
    retrySafe: false,
  });
}

export function boundedSecret(value: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new OfficialModelError("INVALID_API_KEY", "No API key is configured", {
      readableError: classifyModelError({ code: 'auth_missing', message: 'API key is missing' }),
    });
  }
  if (typeof value !== "string" || !value.trim() || value.length > 8_192 || /[\r\n\0]/.test(value)) {
    throw new OfficialModelError("INVALID_API_KEY", "Invalid API key format");
  }
  return value;
}

export function boundedModel(value: string): string {
  const model = typeof value === "string" ? value.trim() : "";
  if (!model || model.length > 200 || /[\r\n\0]/.test(model)) {
    throw new OfficialModelError("INVALID_MODEL", "Invalid model ID format");
  }
  return model;
}

/** Loopback, private, link-local, carrier-grade NAT, "this network", benchmark and multicast/reserved IPv4. */
function privateIpv4(octets: readonly number[]): boolean {
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || a === 100 && b >= 64 && b <= 127
    || a === 169 && b === 254
    || a === 172 && b >= 16 && b <= 31
    || a === 192 && b === 168
    || a === 192 && b === 0 && octets[2] === 0
    || a === 198 && (b === 18 || b === 19);
}

/** Eight 16-bit groups of a URL-normalized IPv6 literal (the WHATWG parser already turned dotted tails into hex). */
function ipv6Groups(host: string): number[] | undefined {
  if (!/^[0-9a-f:.]+$/.test(host) || !host.includes(":")) return undefined;
  let text = host;
  const dotted = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return undefined;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return undefined;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail].map(value => Number.parseInt(value, 16));
  return groups.length === 8 && groups.every(value => Number.isInteger(value) && value >= 0 && value <= 0xffff) ? groups : undefined;
}

/**
 * Whether a URL hostname is this computer, a private network or otherwise not a public server. Parses the address
 * instead of matching string prefixes: `[::ffff:127.0.0.1]` (normalized by URL to `[::ffff:7f00:1]`) and all of
 * fe80::/10 were accepted before (audit C35-04).
 */
export function privateHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) return privateIpv4(v4.slice(1).map(Number));
  const groups = ipv6Groups(host);
  if (!groups) return false;
  const embedded = [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff];
  if (groups.slice(0, 7).every(value => value === 0) && groups[7] <= 1) return true;               // :: and ::1
  if (groups.slice(0, 5).every(value => value === 0) && (groups[5] === 0xffff || groups[5] === 0)) return privateIpv4(embedded); // IPv4-mapped/compatible
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every(value => value === 0)) return privateIpv4(embedded); // NAT64
  return (groups[0] & 0xfe00) === 0xfc00      // fc00::/7 unique local
    || (groups[0] & 0xffc0) === 0xfe80        // fe80::/10 link-local
    || (groups[0] & 0xffc0) === 0xfec0        // fec0::/10 site-local (deprecated)
    || (groups[0] & 0xff00) === 0xff00;       // ff00::/8 multicast
}

export function validatedBaseUrl(baseUrl: string, allowInsecure: boolean): URL {
  if (typeof baseUrl !== "string" || !baseUrl.trim() || baseUrl.length > 2_048) {
    throw new OfficialModelError("INVALID_BASE_URL", "Invalid API URL");
  }
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new OfficialModelError("INVALID_BASE_URL", "Invalid API URL");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new OfficialModelError("INVALID_BASE_URL", "The API URL must not contain credentials, query parameters, or fragments");
  }
  // An empty fragment is the "#" that pins a typed API root (endpoint-url.ts); it is never sent.
  url.hash = "";
  if (url.protocol !== "https:" && !(allowInsecure && url.protocol === "http:")) {
    throw new OfficialModelError("INSECURE_BASE_URL", "The API URL must use HTTPS");
  }
  if (!allowInsecure && privateHostname(url.hostname)) {
    throw new OfficialModelError("PRIVATE_BASE_URL", "The API URL must not point to a local or private network address");
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return url;
}

/** Local mode is not the global allowInsecure escape hatch: no LAN or remote DNS. */
export function validatedLocalModelBaseUrl(baseUrl: string): URL {
  const url = validatedBaseUrl(baseUrl, true);
  if (!['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
    || !['/', '/v1/'].includes(url.pathname)) {
    throw new OfficialModelError('LOCAL_MODEL_URL_REQUIRED', 'Local models require a /v1 URL on 127.0.0.1, [::1], or localhost');
  }
  // Pin localhost to a literal address: never trust hosts-file/DNS changes.
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  return url;
}

function normalizeEndpointBaseUrl(url: URL): URL {
  url.pathname = `${url.pathname.replace(/\/+$/, "").replace(/\/(?:chat\/completions|responses|messages|models)$/i, "")}/`;
  return url;
}

export function openAICompatibleEndpointUrl(
  baseUrl: string,
  // "images" is OpenRouter's image router.
  operation: "chat/completions" | "images/generations" | "images/edits" | "images" | "audio/speech",
  allowInsecure: boolean
): URL {
  return new URL(operation, normalizeEndpointBaseUrl(validatedBaseUrl(baseUrl, allowInsecure)));
}

export function endpointUrl(
  baseUrl: string,
  protocol: OfficialProviderProtocol,
  model: string,
  allowInsecure: boolean
): URL {
  const url = normalizeEndpointBaseUrl(validatedBaseUrl(baseUrl, allowInsecure));
  if (protocol === "anthropic_messages") return new URL("messages", url);
  if (protocol === "cohere_chat") return new URL("chat", url);
  if (protocol === "gemini_generate_content") {
    return new URL(`models/${encodeURIComponent(model)}:generateContent`, url);
  }
  if (protocol === "openai_responses") return new URL("responses", url);
  return new URL("chat/completions", url);
}

export function timeoutMs(value: number | undefined): number {
  // A model response may legitimately stream for an unbounded amount of
  // time. Hosts that own the lifecycle can explicitly pass 0 or Infinity and
  // rely on AbortSignal cancellation; omitted/invalid values retain the short
  // default for discovery probes. Do not turn a product task lifetime into an
  // arbitrary 72-hour deadline here.
  if (value === 0 || value === Number.POSITIVE_INFINITY) return 0;
  return Number.isSafeInteger(value) && (value as number) >= 1_000
    ? value as number
    : DEFAULT_TIMEOUT_MS;
}

export function jsonBody(value: unknown, maximumBytes = MAX_REQUEST_BYTES): string {
  let body: string;
  try {
    body = JSON.stringify(value);
  } catch {
    throw new OfficialModelError("INVALID_REQUEST", "The model request cannot be serialized");
  }
  if (Buffer.byteLength(body, "utf8") > maximumBytes) {
    throw new OfficialModelError("REQUEST_TOO_LARGE", "The model request exceeds the size limit", { params: { maxBytes: maximumBytes } });
  }
  return body;
}

export async function readLimitedJson(response: Response): Promise<any> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new OfficialModelError("RESPONSE_TOO_LARGE", "The model response exceeds the size limit", { params: { maxBytes: MAX_RESPONSE_BYTES } });
  }
  if (!response.body) return {};
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        throw new OfficialModelError("RESPONSE_TOO_LARGE", "The model response exceeds the size limit", { params: { maxBytes: MAX_RESPONSE_BYTES } });
      }
      chunks.push(value);
    }
  } finally {
    // Always release the upstream socket, including on abort and oversized bodies
    // (Cherry Studio #5): a dangling reader keeps the connection open.
    void reader.cancel().catch(() => {});
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const responseText = new TextDecoder().decode(merged);
  try {
    return JSON.parse(responseText);
  } catch {
    throw new OfficialModelError("INVALID_RESPONSE", "The model returned unreadable data", {
      readableError: classifyModelError({ kind: 'invalid_response', message: responseText }),
    });
  }
}

export function upstreamError(status: number, diagnostics: SafeErrorDiagnostics = {}, headers?: Headers): OfficialModelError {
  const fromHeaders = headers ? safeErrorDiagnostics({ status, headers }) : undefined;
  const merged = fromHeaders ? mergedDetails(diagnostics, fromHeaders) : diagnostics;
  const details = { ...merged, httpStatus: status, stage: "response" as const };
  if (status === 401 || status === 403) {
    return new OfficialModelError("AUTH_FAILED", "API key or account authorization failed", details);
  }
  if (status === 402) return new OfficialModelError("BALANCE_INSUFFICIENT", "The account balance is insufficient for this request", details);
  if (status === 404) return new OfficialModelError("MODEL_NOT_FOUND", "The API URL or model ID does not exist", details);
  if (status === 429) return new OfficialModelError("RATE_LIMITED", "The model service is rate limited or the account balance is insufficient", details);
  if (status >= 500) return new OfficialModelError("UPSTREAM_UNAVAILABLE", "The model service is temporarily unavailable", details);
  return new OfficialModelError("REQUEST_REJECTED", "The model service rejected the request; check the model ID and account permissions", details);
}

export async function postJson(options: {
  readonly endpoint: URL;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
  readonly fetchImpl: typeof fetch;
  readonly maximumRequestBytes?: number;
  /** Observe a successfully decoded, bounded response before status/envelope rejection; never a second request. */
  readonly onResponsePayload?: (payload: unknown) => void;
}): Promise<any> {
  if (options.signal?.aborted) {
    throw new OfficialModelError("CANCELLED", "Model request cancelled");
  }
  const controller = new AbortController();
  let timedOut = false;
  const abort = (): void => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = options.timeoutMs > 0 ? setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs) : undefined;
  try {
    const response = await options.fetchImpl(options.endpoint, {
      method: "POST",
      redirect: "error",
      headers: { accept: "application/json", "content-type": "application/json", ...options.headers },
      body: jsonBody(options.body, options.maximumRequestBytes),
      signal: controller.signal
    });
    let payload: any;
    try {
      payload = await readLimitedJson(response);
    } catch (error) {
      const failure = normalizeOfficialModelError(error);
      if (!response.ok) throw upstreamError(response.status, responseDiagnostics(response, { message: failure.readableError.detail }));
      throw new OfficialModelError(failure.code, failure.publicMessage, {
        ...failure,
        ...responseDiagnostics(response),
        readableError: failure.readableError,
      });
    }
    // Optional host accounting observation must not change ordinary transport
    // success/error behavior or cause a retry if the observer itself fails.
    try { options.onResponsePayload?.(payload); } catch { /* Accounting remains unknown when observation fails. */ }
    const diagnostics = responseDiagnostics(response, payload);
    if (!response.ok) throw upstreamError(response.status, diagnostics);
    if (payload?.error || Number(payload?.base_resp?.status_code ?? 0) !== 0
      || Array.isArray(payload?.choices) && payload.choices.some((choice: any) => choice?.error)) {
      throw new OfficialModelError("REQUEST_REJECTED", "The model service returned an error", diagnostics);
    }
    return payload;
  } catch (error) {
    // The request's own credential headers are the exact values a relay may echo back.
    throw redactErrorSecrets(normalizeOfficialModelError(error, { signal: options.signal, timedOut }), credentialSecrets(undefined, options.headers));
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

/** A token count as a provider sends it: a non-negative integer, or its decimal string. Anything else is unknown. */
export function strictTokenCount(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  if (typeof value === "string" && /^\d{1,15}$/.test(value.trim())) return Number(value.trim());
  return undefined;
}

// Booleans, empty strings and arrays are not counts: they read as 0 here and make the usage unknown (audit B02-03).
const countOrZero = (value: unknown): number => value === undefined || value === null || typeof value === "boolean" || Array.isArray(value)
  || (typeof value === "string" && !value.trim()) ? 0 : Number(value);

export function usagePair(input: unknown, output: unknown): { inputTokens: number; outputTokens: number } {
  const values = [countOrZero(input), countOrZero(output)];
  if (!values.every(value => Number.isSafeInteger(value) && value >= 0)) {
    throw new OfficialModelError("INVALID_USAGE", "The model returned invalid usage data");
  }
  return { inputTokens: values[0], outputTokens: values[1] };
}

/**
 * Optional provider usage fields. Providers use several names for the same
 * counters; adapters normalize them here so billing and the desktop usage
 * view do not need provider-specific parsing. Undefined fields are omitted on
 * purpose: an absent cache counter is not a cache miss.
 */
export interface OfficialUsageMetadata {
  readonly cachedInputTokens?: unknown;
  readonly cacheWriteTokens?: unknown;
  readonly reasoningTokens?: unknown;
}

function optionalUsageToken(value: unknown): number | undefined {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : undefined;
}

function usageCacheStatus(metadata: OfficialUsageMetadata, cachedInputTokens: number | undefined, cacheWriteTokens: number | undefined): OfficialModelUsage["cacheStatus"] {
  const hasRead = metadata.cachedInputTokens !== undefined && metadata.cachedInputTokens !== null;
  const hasWrite = metadata.cacheWriteTokens !== undefined && metadata.cacheWriteTokens !== null;
  if (!hasRead && !hasWrite) return undefined;
  // Ignore malformed optional counters rather than reporting a false miss.
  if (cachedInputTokens === undefined && cacheWriteTokens === undefined) return undefined;
  if (cachedInputTokens !== undefined && cachedInputTokens > 0) return "hit";
  // A provider reporting a zero read or a cache write has authoritatively
  // told us this request did not read an existing prefix.
  if (hasRead || hasWrite) return "miss";
  return "unknown";
}

/**
 * Preserve the historical zero-filled usage shape while telling the runner
 * whether both provider counters were actually present and valid.  Missing
 * usage is not a transport failure by itself, but a budgeted run must not
 * execute another side-effecting tool on an unverifiable account.
 */
export function usagePairWithKnown(
  input: unknown,
  output: unknown,
  metadata: OfficialUsageMetadata = {},
): {
  readonly usage: OfficialModelUsage;
  readonly usageKnown?: false;
} {
  const pair = usagePair(input, output);
  const cachedInputTokens = optionalUsageToken(metadata.cachedInputTokens);
  const cacheWriteTokens = optionalUsageToken(metadata.cacheWriteTokens);
  const reasoningTokens = optionalUsageToken(metadata.reasoningTokens);
  const status = usageCacheStatus(metadata, cachedInputTokens, cacheWriteTokens);
  const usage: OfficialModelUsage = {
    ...pair,
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    ...(status === undefined ? {} : { cacheStatus: status }),
  };
  const knownValue = (value: unknown): boolean => strictTokenCount(value) !== undefined;
  return knownValue(input) && knownValue(output)
    ? { usage }
    : { usage, usageKnown: false };
}

export function objectArguments(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OfficialModelError("INVALID_TOOL_CALL", message);
  }
  return value as Record<string, unknown>;
}

/**
 * Exact-value credential scrubbing. Pattern redaction (redactModelErrorDetail) only knows common key shapes; a relay
 * can echo an opaque custom key ("nm_custom_…") in its error body. Every failure that leaves a model client is scrubbed
 * of the credentials that connection was configured with, before it reaches events, receipts or saved conversations.
 */
const SECRET_HEADER = /auth|key|token|secret|signature|cookie/i;
const MINIMUM_SECRET_LENGTH = 8;
/** An explicitly configured key is a secret however short; local servers' placeholder keys are not. */
const MINIMUM_CONFIGURED_KEY_LENGTH = 5;
const PLACEHOLDER_KEYS = new Set(['ollama', 'lm-studio', 'lmstudio', 'none', 'null', 'dummy', 'local', 'empty', 'no-key', 'nokey', 'not-needed', 'sk-no-key-required']);

export function credentialSecrets(apiKey?: string, headers?: Record<string, string> | Headers, environment: readonly (string | undefined)[] = []): readonly string[] {
  const values = new Set<string>();
  const add = (value: unknown, minimum = MINIMUM_SECRET_LENGTH): void => {
    if (typeof value !== 'string') return;
    const raw = value.trim();
    for (const candidate of [raw, raw.replace(/^(?:Bearer|Basic|Token)\s+/i, '')]) {
      if (candidate.length < minimum || PLACEHOLDER_KEYS.has(candidate.toLowerCase())) continue;
      // Also as a query string carries it (Gemini's ?key=), so an echoed URL is scrubbed too.
      for (const form of [candidate, encodeURIComponent(candidate)]) values.add(form);
    }
  };
  add(apiKey, MINIMUM_CONFIGURED_KEY_LENGTH);
  for (const value of environment) add(value);
  if (headers) {
    const entries = headers instanceof Headers ? [...headers.entries()] : Object.entries(headers);
    for (const [name, value] of entries) if (SECRET_HEADER.test(name)) add(value);
  }
  // Longest first, so a secret that contains another is replaced whole.
  return [...values].sort((left, right) => right.length - left.length);
}

function scrubString(value: string, secrets: readonly string[]): string {
  let out = value;
  for (const secret of secrets) if (out.includes(secret)) out = out.split(secret).join('[REDACTED]');
  return out;
}

/** Deep copy with every occurrence of the given secrets replaced; non-plain objects are returned as they are. */
export function redactExactSecrets<T>(value: T, secrets: readonly string[], depth = 0): T {
  if (!secrets.length || depth > 12) return value;
  if (typeof value === 'string') return scrubString(value, secrets) as unknown as T;
  if (Array.isArray(value)) return value.map(item => redactExactSecrets(item, secrets, depth + 1)) as unknown as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, redactExactSecrets(item, secrets, depth + 1)])) as T;
  }
  return value;
}

/** The same failure with configured secrets removed from every message and diagnostic field. */
export function redactErrorSecrets(error: unknown, secrets: readonly string[]): unknown {
  if (!secrets.length) return error;
  if (error instanceof OfficialModelError) {
    const details = error.toJSON() as unknown as Record<string, unknown>;
    const serialized = JSON.stringify(details) + error.publicMessage + (error.message || '');
    if (!secrets.some(secret => serialized.includes(secret))) return error;
    return new OfficialModelError(error.code, scrubString(error.publicMessage, secrets), redactExactSecrets(details, secrets) as OfficialModelErrorDetails);
  }
  if (error instanceof Error && secrets.some(secret => String(error.message).includes(secret) || String(error.stack || '').includes(secret))) {
    error.message = scrubString(error.message, secrets);
    if (error.stack) error.stack = scrubString(error.stack, secrets);
  }
  return error;
}
