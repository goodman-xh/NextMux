/** Browser-safe error presentation. Provider references and fixtures: docs/MODEL_ERROR_CATALOG.md.
 * This module never decides transport retries or whether a request is safe to replay.
 */
import { contentFilterMessage, modelErrorLocale, operationErrorFallback, formatWalletAdmissionDiagnostic } from './error-locales.js';
import { formatMediaDomainError } from './media-error-locales.js';
import { formatComicDomainError } from './comic-error-locales.js';
import { formatPlatformMediaError } from './platform-media-error-locales.js';
export { MODEL_ERROR_LOCALES, hasModelErrorTranslation, CONTENT_FILTER_MESSAGES, contentFilterMessage } from './error-locales.js';
export { mediaErrorMessage, formatMediaDomainError, MEDIA_ERROR_MESSAGE_KEYS } from './media-error-locales.js';
export { formatPlatformMediaError, PLATFORM_MEDIA_MESSAGES, PLATFORM_MEDIA_REASONS } from './platform-media-error-locales.js';

export const MODEL_ERROR_KINDS = [
  'auth_invalid', 'auth_missing', 'permission_denied', 'balance_insufficient', 'provider_quota_exhausted',
  'rate_limited', 'overloaded', 'model_not_found', 'model_not_supported_here', 'context_too_long',
  'output_too_long', 'content_refused', 'invalid_request', 'upload_too_large', 'unsupported_file',
  'timeout', 'network', 'provider_error', 'relay_unavailable', 'cancelled', 'stream_interrupted',
  'tool_call_invalid', 'invalid_response', 'unknown', 'billing_review_required', 'billing_unavailable', 'request_initialization_pending', 'request_budget_unavailable',
] as const;
export type ModelErrorKind = typeof MODEL_ERROR_KINDS[number];
export type ModelErrorSource = 'own_api' | 'relay' | 'local';
export type ModelErrorAction = 'retry' | 'settings' | 'top_up' | 'switch_model' | 'switch_relay' | 'none';
export interface ModelErrorContext {
  readonly source?: ModelErrorSource;
  readonly retryCount?: number;
  readonly relaySwitchCount?: number;
  readonly provider?: string;
}
export type ErrorMessageParams = Readonly<Record<string, string | number | boolean | null>>;
export type ErrorDomain = 'model' | 'media' | 'comic' | 'operation';
export interface WalletAdmissionDiagnostic {
  readonly currency: string;
  /** Admission ceiling and headroom, never held or charged fees. */
  readonly requiredMicros: number;
  readonly availableRequestBudgetMicros: number;
  readonly outstandingRiskMicros: number;
  readonly reason: 'outstanding_usage' | 'reserved_funds' | 'request_ceiling';
}
export interface ReadableModelError {
  readonly walletAdmission?: WalletAdmissionDiagnostic;
  readonly domain?: ErrorDomain;
  /** A preserved provider diagnosis, distinct from local domain validation and caller route context. */
  readonly providerFailure?: true;
  readonly messageKey?: string;
  readonly params?: ErrorMessageParams;
  readonly kind: ModelErrorKind;
  /** Redacted provider messages/codes for a details disclosure; never a request body or stack. */
  readonly detail: string;
  readonly httpStatus?: number;
  readonly code?: string;
  readonly parameter?: string;
  readonly retryAfterSeconds?: number;
  readonly providerReason?: string;
  /** Safe display cause only; it never changes billing review or replay policy. */
  readonly causeKind?: 'provider_quota_exhausted';
  readonly source?: ModelErrorSource;
  readonly retryCount?: number;
  readonly relaySwitchCount?: number;
}
export interface FormattedModelError extends ReadableModelError {
  readonly text: string;
  readonly action: ModelErrorAction;
  readonly actionLabel: string;
  /** Whether offering a manual retry is useful, not permission for automatic replay. */
  readonly retryable: boolean;
}

/** Keep useful provider prose while removing credential forms commonly echoed by APIs. */
export function redactModelErrorDetail(value: string): string {
  return value.slice(0, 16_384)
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/=:-]+/gi, '$1 [REDACTED]')
    .replace(/\b(?:sk|rk|pk)-(?:[A-Za-z0-9_-]{8,})\b/g, '[REDACTED]')
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, '[REDACTED]')
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret[_-]?key|authorization|x-api-key|password)["']?\s*[:=]\s*)(?:["'][^"'\r\n]*["']|[^\s,;}]+)/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/([?&](?:key|token|signature|sig|api_key|access_token|auth)=)[^&#\s]+/gi, '$1[REDACTED]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trim();
}

/**
 * Stepped busy/rate-limit retry schedule: 30s -> 60s -> 60s -> 120s, then stop.
 * A bounded schedule is mandatory: an unbounded "keep retrying" loop must never exist.
 */
export const BUSY_RETRY_DELAYS_SECONDS = [30, 60, 60, 120] as const;
/** Total number of retries the schedule allows. */
export const BUSY_RETRY_MAX_ATTEMPTS = BUSY_RETRY_DELAYS_SECONDS.length;
/**
 * Seconds to wait before retry attempt `attemptIndex` (0-based): 30, 60, 60, 120.
 * Returns undefined once the schedule is exhausted so callers stop instead of retrying forever.
 */
export function resolveBusyRetryDelaySeconds(attemptIndex: number): number | undefined {
  if (!Number.isInteger(attemptIndex) || attemptIndex < 0 || attemptIndex >= BUSY_RETRY_DELAYS_SECONDS.length) return undefined;
  return BUSY_RETRY_DELAYS_SECONDS[attemptIndex];
}

/** Developer-facing message of the one content-filter error; readers see `contentFilterMessage` instead. */
export const CONTENT_FILTER_PUBLIC_MESSAGE = "The provider's content safety filter blocked this response";
/** Our own wording or generic code, which is never presented as "the provider's reason". */
const syntheticContentFilterText = (value: string): boolean => /^content[_ -]?filter$/i.test(value.trim()) || value.trim() === CONTENT_FILTER_PUBLIC_MESSAGE;

/**
 * A platform content/safety filter block. The kind classifies the failure; the exact
 * approved wording lives in `contentFilterMessage` and is never reworded per call site.
 */
export function contentFilterReadableError(detail?: string): ReadableModelError {
  const clean = typeof detail === "string" ? redactModelErrorDetail(detail).slice(0, 600) : "";
  return { kind: "content_refused", code: "content_filter", detail: clean };
}

/** The reason is shown inside the user-facing sentence; paths, stacks, JSON and URLs stay in `detail`. */
function publicProviderReason(value: string): string | undefined {
  const line = value.split(/\r?\n/).map(part => part.trim()).find(part => part && !/^at\s|^\s*[{\[]/.test(part));
  if (!line) return undefined;
  const clean = line
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '')
    .replace(/(?:^|\s)(?:~|\.{1,2})?(?:\/[\w.@-]+){2,}\/?/g, ' ')
    .replace(/\b[A-Za-z]:\\(?:[^\\\s]+\\?)+/g, '')
    .replace(/\s*[{\[].*$/, '')
    .replace(/\s+at\s+\S+\s*\(.*$/, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s:,;(-]+$/, '')
    .trim();
  if (clean.length < 3) return undefined;
  return clean.length > 240 ? `${clean.slice(0, 239).trimEnd()}…` : clean;
}
function field(value: unknown, key: string): unknown {
  try { return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined; }
  catch { return undefined; }
}
/** Project a complete platform admission snapshot; missing numbers stay missing.
 * This is presentation-only and never grants dispatch, retry, or funding. */
export function normalizeWalletAdmissionDiagnostic(value: unknown): WalletAdmissionDiagnostic | undefined {
  const currency = field(value, 'currency');
  const requiredMicros = field(value, 'requiredMicros');
  const availableRequestBudgetMicros = field(value, 'availableRequestBudgetMicros');
  const outstandingRiskMicros = field(value, 'outstandingRiskMicros');
  const reason = field(value, 'reason');
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)
    || ![requiredMicros, availableRequestBudgetMicros, outstandingRiskMicros]
      .every(amount => typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= 0)
    || typeof reason !== 'string' || !['outstanding_usage', 'reserved_funds', 'request_ceiling'].includes(reason)) return undefined;
  return { currency, requiredMicros: requiredMicros as number,
    availableRequestBudgetMicros: availableRequestBudgetMicros as number,
    outstandingRiskMicros: outstandingRiskMicros as number, reason: reason as WalletAdmissionDiagnostic['reason'] };
}
function short(value: unknown): string | undefined {
  return (typeof value === 'string' || typeof value === 'number') && String(value).trim()
    ? redactModelErrorDetail(String(value)).slice(0, 200) : undefined;
}
export function normalizeErrorMessageParams(value: unknown): ErrorMessageParams {
  const params: Record<string, string | number | boolean | null> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return params;
  for (const key of Object.keys(value).slice(0, 40)) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(key)) continue;
    const item = field(value, key);
    if (typeof item === 'string') params[key] = redactModelErrorDetail(item).slice(0, 600);
    else if (item === null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) params[key] = item;
  }
  return params;
}
function count(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= 1_000_000 ? number : undefined;
}
function sourceOf(value: unknown): ModelErrorSource | undefined {
  return value === 'own_api' || value === 'relay' || value === 'local' ? value : undefined;
}
function seconds(value: unknown, multiplier = 1, now = Date.now()): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    if (multiplier === 1 && value >= 100_000_000_000) {
      return Math.min(86_400, Math.max(0, Math.ceil((value - now) / 1_000)));
    }
    if (multiplier === 1 && value >= 1_000_000_000) {
      return Math.min(86_400, Math.max(0, Math.ceil(value - now / 1_000)));
    }
    return Math.min(86_400, Math.ceil(value * multiplier));
  }
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const rawNum = Number(trimmed);
    if (!Number.isFinite(rawNum) || rawNum < 0) return undefined;
    if (multiplier === 1 && rawNum >= 100_000_000_000) {
      return Math.min(86_400, Math.max(0, Math.ceil((rawNum - now) / 1_000)));
    }
    if (multiplier === 1 && rawNum >= 1_000_000_000) {
      return Math.min(86_400, Math.max(0, Math.ceil(rawNum - now / 1_000)));
    }
    return Math.min(86_400, Math.ceil(rawNum * multiplier));
  }
  const durationMatch = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m(?!s))?(?:(\d+(?:\.\d+)?)s)?(?:(\d+(?:\.\d+)?)ms)?$/i.exec(trimmed);
  if (durationMatch && (durationMatch[1] || durationMatch[2] || durationMatch[3] || durationMatch[4])) {
    const hours = Number(durationMatch[1] || 0);
    const minutes = Number(durationMatch[2] || 0);
    const secs = Number(durationMatch[3] || 0);
    const millis = Number(durationMatch[4] || 0);
    const totalSeconds = hours * 3600 + minutes * 60 + secs + millis / 1_000;
    return Number.isFinite(totalSeconds) && totalSeconds >= 0 ? Math.min(86_400, Math.ceil(totalSeconds)) : undefined;
  }
  const parsedDate = Date.parse(trimmed);
  if (Number.isFinite(parsedDate)) {
    return Math.min(86_400, Math.max(0, Math.ceil((parsedDate - now) / 1_000)));
  }
  return undefined;
}
function header(headers: unknown, name: string): unknown {
  if (headers && typeof field(headers, 'get') === 'function') {
    try { return (headers as { get: (name: string) => unknown }).get(name); } catch { return undefined; }
  }
  if (!headers || typeof headers !== 'object') return undefined;
  try {
    const key = Object.keys(headers).find(key => key.toLowerCase() === name);
    return key ? field(headers, key) : undefined;
  } catch { return undefined; }
}

// Gateway admission errors describe the selected route or request before any
// provider submission. Reuse the existing localized guidance and retain codes
// and provider details for the diagnostic disclosure.
const gatewayMediaAdmissionKinds: Readonly<Record<string, ModelErrorKind>> = {
  image_reference_unsupported: 'model_not_supported_here',
  media_model_kind_unsupported: 'model_not_supported_here',
  upstream_media_protocol_unsupported: 'model_not_supported_here',
  video_model_kind_unsupported: 'model_not_supported_here',
  upstream_video_protocol_unsupported: 'model_not_supported_here',
  media_reference_required: 'invalid_request',
  video_reference_required: 'invalid_request',
  video_duration_unsupported: 'invalid_request',
  video_aspect_unsupported: 'invalid_request',
  video_resolution_unsupported: 'invalid_request',
  video_request_shape_unsupported: 'invalid_request',
};

export function classifyModelError(value: unknown, context: ModelErrorContext = {}): ReadableModelError {
  const queue: Array<{ value: unknown; depth: number; presentation?: boolean }> = [{ value, depth: 0 }];
  const seen = new Set<object>();
  const messages: string[] = [];
  const codes: string[] = [];
  let httpStatus: number | undefined;
  let retryAfterSeconds: number | undefined;
  let parameter: string | undefined;
  let source: ModelErrorSource | undefined;
  let retryCount: number | undefined;
  let relaySwitchCount: number | undefined;
  let rememberedKind: ModelErrorKind | undefined;
  let causeKind: ReadableModelError['causeKind'];
  let domain: ErrorDomain | undefined;
  let messageKey: string | undefined;
  let params: ErrorMessageParams | undefined;
  let providerReason: string | undefined;
  let walletAdmission: WalletAdmissionDiagnostic | undefined;
  let providerFailure = false;
  let minimax = context.provider === 'minimax' || context.provider === 'minimax_media';
  let billingReview = false;
  let upstreamEnvelope = Boolean(context.provider);
  const addMessage = (text: string): void => {
    const clean = redactModelErrorDetail(text);
    if (clean && !messages.includes(clean)) messages.push(clean);
  };
  // Visit only error/response envelopes. In particular do not retain request, headers,
  // prompts, input, flagged_input, images, audio or arbitrary SDK requestBodyValues.
  for (let visited = 0; queue.length && visited < 160; visited += 1) {
    const current = queue.shift()!;
    if (current.depth > 10) continue;
    if (typeof current.value === 'string') {
      const text = current.value.slice(0, 32_768).trim();
      const jsonStart = text.search(/[\[{]/);
      if (jsonStart >= 0) {
        try {
          const parsed: unknown = JSON.parse(text.slice(jsonStart));
          queue.push({ value: parsed, depth: current.depth + 1 });
          if (jsonStart) addMessage(text.slice(0, jsonStart));
          continue;
        } catch { /* Plain provider message. */ }
      }
      addMessage(text);
      continue;
    }
    if (!current.value || typeof current.value !== 'object' || seen.has(current.value)) continue;
    seen.add(current.value);
    if (Array.isArray(current.value)) {
      queue.push(...current.value.slice(-12).map(value => ({ value, depth: current.depth + 1 })));
      continue;
    }
    const record = current.value;
    const candidateDomain = field(record, 'domain');
    if (['model', 'media', 'comic', 'operation'].includes(String(candidateDomain)) && (current.presentation || !domain)) domain = candidateDomain as ErrorDomain;
    const candidateKey = field(record, 'messageKey');
    if (typeof candidateKey === 'string' && /^[a-zA-Z][a-zA-Z0-9_.-]{0,159}$/.test(candidateKey) && (current.presentation || !messageKey)) {
      messageKey = candidateKey;
      params = normalizeErrorMessageParams(field(record, 'params'));
      const structuredField = short(params.field);
      if (structuredField && /^[\w.[\]-]{1,160}$/.test(structuredField)) parameter ??= structuredField;
    }
    source ??= sourceOf(field(record, 'source'));
    retryCount ??= count(field(record, 'retryCount'));
    relaySwitchCount ??= count(field(record, 'relaySwitchCount'));
    const known = field(record, 'kind');
    const recordedSource = sourceOf(field(record, 'source'));
    if (!context.provider && known === 'request_budget_unavailable' && recordedSource === 'relay'
      && field(record, 'httpStatus') === 409
      && typeof field(record, 'code') === 'string'
      && String(field(record, 'code')).toLowerCase() === 'wallet_request_budget_unavailable'
      && (current.presentation || !walletAdmission)) {
      walletAdmission = normalizeWalletAdmissionDiagnostic(field(record, 'walletAdmission'));
    }
    if (known === 'billing_review_required' && recordedSource === 'relay'
      && field(record, 'causeKind') === 'provider_quota_exhausted') causeKind = 'provider_quota_exhausted';
    providerFailure ||= field(record, 'providerFailure') === true
      // Older media snapshots already identify a specific upstream diagnosis.
      // Context.source alone must never promote local domain errors to model failures.
      || candidateDomain === 'media' && typeof known === 'string' && known !== 'unknown'
        && MODEL_ERROR_KINDS.includes(known as ModelErrorKind) && (recordedSource === 'own_api' || recordedSource === 'relay');
    if (typeof known === 'string' && MODEL_ERROR_KINDS.includes(known as ModelErrorKind) && (current.presentation || !rememberedKind || rememberedKind === 'unknown')) {
      rememberedKind = known as ModelErrorKind;
      source = sourceOf(field(record, 'source')) ?? source;
      if (current.presentation) {
        retryCount = count(field(record, 'retryCount')) ?? retryCount;
        relaySwitchCount = count(field(record, 'relaySwitchCount')) ?? relaySwitchCount;
        retryAfterSeconds = seconds(field(record, 'retryAfterSeconds')) ?? retryAfterSeconds;
      }
      const preservedStatus = Number(field(record, 'httpStatus'));
      if (preservedStatus >= 400 && preservedStatus <= 599) httpStatus = preservedStatus;
    }
    providerReason ??= typeof field(record, 'providerReason') === 'string' ? redactModelErrorDetail(String(field(record, 'providerReason'))).slice(0, 600) : undefined;
    upstreamEnvelope ||= Boolean(field(record, 'provider_name') || field(record, 'provider_code') || field(record, 'raw'));
    minimax ||= Boolean(field(record, 'base_resp'));
    billingReview ||= field(record, 'acceptanceUnknown') === true || ['billing_review', 'billing_only'].includes(String(field(record, 'recoveryMode')));
    for (const key of ['httpStatus', 'statusCode', 'status', 'code', 'httpStatusCode']) {
      const status = Number(field(record, key));
      // Only non-success status is relevant; a 200 SSE can contain a 429 error.
      if (httpStatus === undefined && Number.isInteger(status) && status >= 400 && status <= 599) httpStatus = status;
    }
    for (const key of ['providerCode', 'streamCode', 'error_type', 'provider_code', 'code', 'Code', 'errorCode', 'error_code', 'status_code', 'type', 'name', 'status', 'finishReason', 'finish_reason', 'blockReason', 'stop_reason', '__type', 'providerErrorType']) {
      const text = short(field(record, key));
      if (text && !codes.includes(text)) codes.push(text);
    }
    for (const key of ['message', 'Message', 'publicMessage', 'error_msg', 'error_message', 'errorMessage', 'status_msg', 'msg', 'reason', 'task_status_msg', 'failure_reason', 'blockReasonMessage', 'providerReason']) {
      const text = field(record, key);
      if (typeof text === 'string') {
        // Some gateways embed JSON as their message, with another useful error inside.
        queue.push({ value: text, depth: current.depth + 1 });
      }
    }
    const detail = field(record, 'detail');
    if (typeof detail === 'string') queue.push({ value: detail, depth: current.depth + 1 });
    const candidateParameter = short(field(record, 'param') ?? field(record, 'parameter') ?? field(record, 'field'));
    if (candidateParameter && /^[\w.[\]-]{1,160}$/.test(candidateParameter)) parameter ??= candidateParameter;
    const location = field(record, 'loc');
    if (!parameter && Array.isArray(location)) {
      const candidate = location.filter(value => typeof value === 'string' || typeof value === 'number').join('.');
      if (/^[\w.[\]-]{1,160}$/.test(candidate)) parameter = candidate;
    }
    retryAfterSeconds ??= seconds(field(record, 'retryAfterMs') ?? field(record, 'retry_after_ms'), 0.001)
      ?? seconds(field(record, 'retryAfterSeconds') ?? field(record, 'retry_after') ?? field(record, 'retryAfter') ?? field(record, 'retryDelay'));
    const headersObj = field(record, 'headers') ?? field(record, 'responseHeaders');
    if (retryAfterSeconds === undefined && headersObj) {
      const msHeader = header(headersObj, 'retry-after-ms') ?? header(headersObj, 'x-ms-retry-after-ms');
      if (msHeader !== undefined) retryAfterSeconds = seconds(msHeader, 0.001);
      for (const headerName of [
        'retry-after',
        'x-ratelimit-reset-requests',
        'x-ratelimit-reset-tokens',
        'x-ratelimit-reset',
        'anthropic-ratelimit-requests-reset',
        'anthropic-ratelimit-tokens-reset',
        'anthropic-ratelimit-input-tokens-reset',
        'anthropic-ratelimit-output-tokens-reset',
      ]) {
        if (retryAfterSeconds !== undefined) break;
        const candidateHeader = header(headersObj, headerName);
        if (candidateHeader !== undefined) retryAfterSeconds = seconds(candidateHeader);
      }
    }
    for (const key of ['readableError', 'error', 'Error', 'cause', 'lastError', 'data', 'body', 'responseBody', 'response', 'Response', 'errors', 'details', 'detail', 'diagnostic', 'metadata', 'raw', 'debug', 'base_resp', '$metadata', 'output', 'promptFeedback', 'candidates', 'choices', 'innererror', 'innerError', 'incomplete_details', 'moderation_reasons', 'reasons', 'provider_specific_fields']) {
      const nested = field(record, key);
      if (nested !== undefined && nested !== null && typeof nested !== 'function') queue.push({ value: nested, depth: current.depth + 1, presentation: key === 'readableError' });
    }
  }
  const text = [...codes, ...messages].join(' ').toLowerCase();
  source ??= context.source;
  retryCount ??= context.retryCount;
  relaySwitchCount ??= context.relaySwitchCount;
  const codeText = codes.join(' ').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
  const has = (pattern: RegExp): boolean => pattern.test(text) || pattern.test(codeText);
  if (httpStatus === undefined) {
    const inferred = text.match(/\b(?:http\s*|status(?:\s+code)?\s*[:=]\s*)([45]\d{2})\b/) ?? text.match(/\b(429)\s+too many requests\b/);
    if (inferred) httpStatus = Number(inferred[1]);
  }
  if (retryAfterSeconds === undefined) {
    const match = text.match(/retry[ _-]*after\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(ms|milliseconds?|seconds?|s)?/);
    if (match) retryAfterSeconds = seconds(match[1], /^(ms|millisecond)/.test(match[2] ?? '') ? 0.001 : 1);
  }
  const rateLimitSignal = httpStatus === 429 || /rate[_ -]?limit|too[_ -]many[_ -]requests|resource_exhausted|throttl/.test(codeText)
    || has(/tokens? per (?:min|minute|hour|day)|requests? per (?:min|minute|hour|day)|\b[tr]pm\b|\(tpm\)|\(rpm\)/);
  let kind: ModelErrorKind = rememberedKind ?? 'unknown';
  const gatewayMediaAdmissionKind = codes.map(code => Object.hasOwn(gatewayMediaAdmissionKinds, code.toLowerCase())
    ? gatewayMediaAdmissionKinds[code.toLowerCase()] : undefined).find(Boolean);
  if (!rememberedKind || rememberedKind === 'unknown') {
    if (codes.some(code => code.toLowerCase() === 'wallet_request_budget_unavailable')) kind = 'request_budget_unavailable';
    else if (billingReview || has(/billing_review_required|upstream_transport_unknown|billing_pending_review|billing_finalization_pending/)) kind = 'billing_review_required';
    else if (source === 'relay' && has(/upstream_credential_invalid|upstream_balance_unavailable|upstream_model_unsupported/)) kind = 'relay_unavailable';
    else if (has(/\b(cancelled|canceled|aborterror|user_aborted|request_aborted)\b|用户取消|已取消/)) kind = 'cancelled';
    // Typed provider causes beat generic HTTP/auth wrappers (e.g. LiteLLM budget
    // errors under 401, DashScope AccessDenied.Arrearage, and OpenRouter 502).
    else if (/wallet_balance_insufficient|nextmux_balance_insufficient/.test(codeText)
      || source === 'relay' && !upstreamEnvelope && codes.some(code => /^insufficient_balance$/i.test(code))) kind = 'balance_insufficient';
    else if (/insufficient[_ .-](?:quota|balance|credits?|funds)|arrearage|overdue|quota_exceeded|quota_exhausted|exceeded_current_quota|budget_exceeded|billing_hard_limit|payment_required/.test(codeText)) kind = 'provider_quota_exhausted';
    else if (/content[_ .-]?(?:policy|filter|safety)|safety|refusal|data_?inspection|sensitive[_ -]?(?:content|word)|responsible_?ai_?policy/.test(codeText)) kind = 'content_refused';
    else if (/context[_ -](?:length|window|size)|context_too_long|text_too_long/.test(codeText)) kind = 'context_too_long';
    else if (/invalid_audio_format|unsupported_image_format|unsupported_file_format/.test(codeText)) kind = 'unsupported_file';
    else if (/unsupported_model/.test(codeText)) kind = 'model_not_supported_here';
    else if (gatewayMediaAdmissionKind) kind = gatewayMediaAdmissionKind;
    else if (has(/billing_review_required|account_suspended|account_deactivated|permission_denied|permission_error|accessdenied|access_denied|forbidden|not authorized to (?:access|invoke)|没有权限|无权访问/)) kind = 'permission_denied';
    else if (has(/auth_missing|missing[_ -](?:api[_ -]?)?key|api[_ -]?key.{0,25}(?:required|missing|not set)|loadapikey|no api key|未配置.*(?:key|密钥)/)) kind = 'auth_missing';
    else if (has(/link this desktop to your nextmux account|device[_\s-]*link[_\s-]*required|device[_\s-]*auth[_\s-]*required|account[_\s-]*auth[_\s-]*required|sign[_\s-]*in[_\s-]*required|desktop device link required|platform sign-in required|请先登录|需要先登录|auth_invalid|invalid[_ -](?:api[_ -]?)?key|authentication(?:_error)?\b|unauthenticated|invalid[_ -]token|token[_ -]expired|authfailure|unrecognizedclient|invalidsignature|expiredtoken|api key.{0,20}(?:invalid|expired|leaked)|密钥.{0,10}(?:无效|过期)/)) kind = 'auth_invalid';
    else if (has(/nextmux.{0,20}(?:余额不足|insufficient balance)|wallet_balance_insufficient/)) kind = 'balance_insufficient';
    else if (has(/insufficient[_ .-](?:quota|balance|credits?|funds)|insufficient account balance|quota[_ -](?:exhausted|depleted)|(?:credit|balance).{0,20}(?:insufficient|exhausted|depleted|too low)|(?:run out of|not enough) credits|payment_required|arrearage|overdue|quota_exceeded|exceeded_current_quota|budget_exceeded|organization_usage_limit|billing_hard_limit|exceeded your current quota|free[_ -]tier[_ -]quota|quota is not enough|insufficient_user_quota|pre_consume_token_quota_failed|余额不足|欠费|额度.{0,8}(?:用尽|耗尽|不足)/)) kind = 'provider_quota_exhausted';
    else if (has(/content[_ .-]?(?:policy|filter|safety)|content[_ -]?refused|moderation|safety|prohibited_content|sensitive[_ -]?(?:content|word)|data_inspection|datainspection|riskcontrol|refusal|recitation|responsibleaipolicyviolation|blocked.{0,25}(?:policy|content)|内容.{0,10}(?:违规|拒绝|审核)|敏感词|审核未通过/)) kind = 'content_refused';
    // Per-minute token quotas ("input tokens per minute", Gemini's input_token_count quota, TPM) mention input tokens
    // and a limit but are rate limits: a 429 or a rate-limit code wins over wording, as LiteLLM maps status first.
    else if (!rateLimitSignal && has(/context[_ -](?:length|window|size)|context_too_long|prompt.{0,25}(?:too long|too large)|input.{0,25}(?:token|length).{0,25}(?:exceed|limit)|input is too long|too many (?:input )?tokens|exceed(?:s|ed)? (?:the )?(?:model(?:'s)? )?(?:max(?:imum)? )?(?:token|context) limit|maximum number of tokens allowed|range of input length|reduce the length of the messages|maximum context|token limit.{0,20}input|上下文.{0,10}(?:过长|超|限制)/)) kind = 'context_too_long';
    else if (has(/output_too_long|max[_ -](?:completion[_ -])?tokens[_ -]exceeded|output[_ -]too[_ -]large|response[_ -]too[_ -]large|输出.{0,10}(?:超长|过长|限制)/) || codes.some(code => /^(?:length|max_tokens|max_output_tokens)$/i.test(code))) kind = 'output_too_long';
    else if (has(/(?:file|image|audio|video|payload|request|upload)[_ -]too[_ -]large|entitytoolarge|size.{0,15}exceed|文件.{0,10}(?:太大|过大)/) || httpStatus === 413) kind = 'upload_too_large';
    else if (has(/unsupported[_ -](?:file|image|audio|video|mime)|invalid_image|invalid_file|unsupported.{0,15}(?:file type|format)|不支持.{0,10}(?:文件|格式)/) || httpStatus === 415) kind = 'unsupported_file';
    else if (has(/model_not_supported_here|unsupported_capability|unsupported_protocol|discovery_unsupported|operationnotsupported|unsupported.{0,25}(?:modality|feature|region)|not supported.{0,30}(?:region|country|model)|(?:region|country|location).{0,25}(?:not supported|unavailable)|does not support.{0,30}(?:image|audio|video|tool|vision)|地区.{0,10}不支持/)) kind = 'model_not_supported_here';
    else if (has(/relay_unavailable|route_privacy_unavailable|no_available_channel|channel_not_found|no available (?:channel|route)|decision_model_unavailable|gateway_no_route|merchant_unavailable|upstream_capacity_exhausted|request_exceeds_key_limit|relay_not_found|relay_disabled|billing_route_unavailable|无可用.{0,5}(?:渠道|中转)/)) kind = 'relay_unavailable';
    else if (has(/model_not_found|deploymentnotfound|nosuchmodel|unknown model|model.{0,35}(?:not found|does not exist|doesn't exist)|pull model|model_not_exist|模型.{0,10}(?:不存在|未找到)/)) kind = 'model_not_found';
    else if (has(/overloaded|server_is_overloaded|capacity.{0,20}(?:exhausted|exceeded)|resource_unavailable|modelnotready|model_not_ready|high demand|服务繁忙/) || httpStatus === 529) kind = 'overloaded';
    // "request limit" only with exceeded/reached: a local "…_REQUEST limit must be…" is a field error, not throttling.
    else if (has(/rate[_ -]?limit|request[_ -]?limit[_ -]?(?:exceed|reach|hit)|too many requests|throttl|resource_exhausted|limit_requests|concurrent.{0,12}(?:limit|exceed)|并发.{0,5}(?:超|限制)|请求过于频繁|限流/) || httpStatus === 429) kind = 'rate_limited';
    else if (has(/timed?[_ -]?out|deadline_exceeded|etimedout|expired.{0,10}(?:request|task)|请求超时/) || httpStatus === 408 || httpStatus === 504 || httpStatus === 524) kind = 'timeout';
    else if (has(/stream[_ -](?:interrupted|cut|closed)|premature.{0,12}(?:close|end)|unexpected (?:end|eof)|terminated|流.{0,10}(?:中断|断开)/)) kind = 'stream_interrupted';
    // The request's own tool list was refused (count or names): a NextMux request problem, not a model answer.
    else if (has(/\btools_invalid\b|tools are invalid/)) kind = 'invalid_request';
    else if (has(/invalid_tool_call|tool_call_invalid|tool.{0,25}(?:parse|invalid|malformed)|工具调用.{0,10}(?:无效|解析)/)) kind = 'tool_call_invalid';
    else if (has(/decision_network|vision_network|econnreset|econnrefused|enotfound|eai_again|enetunreach|ehostunreach|und_err_socket|network[_ -]error|fetch failed|failed to fetch|network request failed|connection (?:refused|reset|closed)|platform_offline|无法连接|网络连接|(?:服务|连接)(?:未连接|已断开)/)) kind = 'network';
    else if (httpStatus === 401 || has(/auth_failed/)) kind = 'auth_invalid';
    else if (httpStatus === 403) kind = 'permission_denied';
    else if (httpStatus === 402) kind = 'provider_quota_exhausted';
    else if (has(/invalid_response|jsonparse|typevalidation|invalidresponsedata|invalid json|无法识别的数据/)) kind = 'invalid_response';
    else if (httpStatus !== undefined && httpStatus >= 500 || has(/server_error|internalserver|internal_error|api_error|upstream_error|provider_unavailable/)) kind = 'provider_error';
    else if (has(/invalid[_ -](?:request|argument|parameter|prompt)|validationexception|validation_error|invalidparameter|request_rejected|parameter_unknown|参数.{0,10}(?:错误|无效)/) || httpStatus === 400 || httpStatus === 422) kind = 'invalid_request';
    else if (httpStatus === 404) kind = 'model_not_found';
    // Vendor numeric codes are matched only where their envelope/provider identifies them.
    if (minimax && kind !== 'billing_review_required') {
      const numeric = codes.map(Number);
      if (numeric.includes(1004) || numeric.includes(2049)) kind = 'auth_invalid';
      else if (numeric.includes(1008)) kind = 'provider_quota_exhausted';
      else if (numeric.some(code => [1002, 1039, 1041, 2045, 2056].includes(code))) kind = 'rate_limited';
      else if (numeric.includes(1027) || numeric.includes(1026)) kind = 'content_refused';
      else if (numeric.includes(2013)) kind = 'invalid_request';
      else if (numeric.includes(1001)) kind = 'timeout';
    }
    if (['zhipu', 'glm', 'zai'].includes(context.provider ?? '') && kind !== 'billing_review_required') {
      if (codes.includes('1113')) kind = 'provider_quota_exhausted';
      else if (codes.includes('1301')) kind = 'content_refused';
      else if (codes.includes('1305')) kind = 'overloaded';
      else if (codes.includes('1001')) kind = 'auth_missing';
      else if (codes.includes('1211')) kind = 'model_not_found';
      else if (codes.includes('1212')) kind = 'model_not_supported_here';
      else if (codes.includes('1261')) kind = 'context_too_long';
      else if (codes.includes('1311')) kind = 'permission_denied';
      else if (codes.some(code => ['1302', '1303', '1308', '1310'].includes(code))) kind = 'rate_limited';
      else if (codes.some(code => ['1309', '1314', '1316', '1317', '1318', '1319', '1320', '1321'].includes(code))) kind = 'provider_quota_exhausted';
    }
    if (httpStatus === 498 && context.provider === 'groq') kind = 'overloaded';
    if (httpStatus === 498 && context.provider === 'cohere') kind = 'auth_invalid';
    if (['qianfan', 'baidu', 'ernie'].includes(context.provider ?? '')) {
      if (codes.some(code => ['110', '111'].includes(code))) kind = 'auth_invalid';
      else if (codes.some(code => ['17', '18', '19', '336501', '336502'].includes(code))) kind = 'rate_limited';
      else if (codes.some(code => ['336001', '336002', '336003'].includes(code))) kind = 'invalid_request';
      else if (codes.includes('336004')) kind = 'permission_denied';
      else if (codes.includes('336100')) kind = 'overloaded';
    }
    if (context.provider === 'kling') {
      if (codes.includes('1201')) kind = 'invalid_request';
      else if (codes.some(code => ['1300', '1301'].includes(code))) kind = 'content_refused';
      else if (codes.some(code => ['1302', '1303'].includes(code))) kind = 'rate_limited';
      else if (codes.includes('1304')) kind = 'permission_denied';
      else if (codes.some(code => ['5000', '5001'].includes(code))) kind = 'provider_error';
      else if (codes.includes('5002')) kind = 'timeout';
    }
  }
  // A known platform admission refusal is not a transient provider outage.
  // Keep this diagnosis through older wrappers that remembered provider_error;
  // uncertainty about an already accepted request still wins below.
  if (kind !== 'billing_review_required' && codes.some(code =>
    ['platform_quantity_tariff_required', 'wallet_no_hold_control_unavailable'].includes(code.toLowerCase()))) {
    kind = 'billing_unavailable';
  }
  // The model already answered and only billing is being settled: never a retryable provider failure, even when an
  // outer provider_error wrapper was remembered first.
  if (billingReview || has(/billing_review_required|billing_pending_review|billing_finalization_pending/)) {
    // Preserve an already typed relay diagnosis while retaining the review guard.
    if (kind === 'provider_quota_exhausted' && source === 'relay') causeKind = 'provider_quota_exhausted';
    kind = 'billing_review_required';
  }
  // A missing initialization receipt says nothing about whether a charge
  // occurred. Preserve that specific state without offering a model retry.
  if (codes.some(code => ['request_initialization_pending', 'billing_initialization_pending'].includes(code.toLowerCase()))) {
    kind = 'request_initialization_pending';
  }
  // Only the provider's own words or code are a reason; the safety sentence already says what our generic code would.
  if (kind === 'content_refused') providerReason ??= messages.filter(message => !syntheticContentFilterText(message)).at(-1)?.slice(0, 600)
    ?? codes.find(code => /safety|content|refus|recitation/i.test(code) && !syntheticContentFilterText(code));
  if (providerReason) providerReason = publicProviderReason(providerReason);
  if (has(/link this desktop to your nextmux account|device[_\s-]*link[_\s-]*required|device[_\s-]*auth[_\s-]*required|account[_\s-]*auth[_\s-]*required|sign[_\s-]*in[_\s-]*required|desktop device link required|platform sign-in required|请先登录|需要先登录/)
    && !codes.some(code => /^(?:device[_\s-]*link[_\s-]*required|device[_\s-]*auth[_\s-]*required|account[_\s-]*auth[_\s-]*required|sign[_\s-]*in[_\s-]*required)$/i.test(code))) {
    codes.unshift('device_link_required');
  }
  const detail = [...new Set([...messages.flatMap(message => message.split('\n')), ...codes.filter(code => !messages.some(message => message.includes(code)))])].join('\n').slice(0, 16_384);
  return {
    kind, detail,
    ...(kind === 'request_budget_unavailable' && source === 'relay' && httpStatus === 409 && walletAdmission ? { walletAdmission } : {}),
    ...(kind === 'billing_review_required' && source === 'relay' && causeKind ? { causeKind } : {}),
    ...(domain ? { domain } : {}),
    ...(providerFailure ? { providerFailure: true as const } : {}),
    ...(messageKey ? { messageKey, params: params ?? {} } : {}),
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(codes.length ? { code: codes.find(code => !/^\d{3}$/.test(code) && !/Error$/.test(code) && !['error', 'failed', 'Fail'].includes(code)) ?? codes[0] } : {}),
    ...(parameter ? { parameter } : {}),
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    ...(providerReason ? { providerReason } : {}),
    ...(source ? { source } : {}),
    ...(retryCount === undefined ? {} : { retryCount }),
    ...(relaySwitchCount === undefined ? {} : { relaySwitchCount }),
  };
}

export function formatModelError(value: unknown, locale = 'en', context: ModelErrorContext = {}): FormattedModelError {
  const failure = classifyModelError(value, context);
  const copy = modelErrorLocale(locale);
  const kind = failure.kind;
  const providerDiagnosis = failure.domain === 'media' && failure.providerFailure && kind !== 'unknown';
  if (failure.domain && failure.domain !== 'model' && !providerDiagnosis) {
    const localized = failure.domain === 'media'
      ? formatPlatformMediaError(failure.messageKey ?? '', failure.params ?? {}, locale) ?? formatMediaDomainError(failure.messageKey ?? '', failure.params ?? {}, locale)
      : failure.domain === 'comic' ? formatComicDomainError(failure.messageKey ?? '', failure.params ?? {}, locale) : undefined;
    return { ...failure, kind: 'unknown', text: localized ?? operationErrorFallback(locale, failure.domain), action: 'none', actionLabel: '', retryable: false };
  }
  let action: ModelErrorAction = 'none';
  let advice = copy.advice[kind];
  let message = copy.messages[kind];
  // A safety block reads as the one approved sentence in the reader's language, advice included (audit Cline #15);
  // a reason the provider gave still follows it.
  if (kind === 'content_refused') { message = contentFilterMessage(locale); advice = ''; }
  if (['auth_invalid', 'auth_missing', 'permission_denied', 'invalid_request'].includes(kind)) action = 'settings';
  if (['rate_limited', 'overloaded', 'timeout', 'provider_error', 'stream_interrupted', 'tool_call_invalid', 'invalid_response', 'unknown'].includes(kind)) action = 'retry';
  if (['model_not_found', 'model_not_supported_here', 'output_too_long'].includes(kind)) action = 'switch_model';
  if (kind === 'balance_insufficient') action = 'top_up';
  if (kind === 'relay_unavailable') action = 'switch_relay';
  const isPlatformSignInRequired = /^(?:device[_\s-]*link[_\s-]*required|device[_\s-]*auth[_\s-]*required|account[_\s-]*auth[_\s-]*required|sign[_\s-]*in[_\s-]*required)$/i.test(failure.code ?? '')
    || /link this desktop to your nextmux account|device[_\s-]*link[_\s-]*required|device[_\s-]*auth[_\s-]*required|account[_\s-]*auth[_\s-]*required|sign[_\s-]*in[_\s-]*required|desktop device link required|platform sign-in required|请先登录|需要先登录/i.test(`${failure.code ?? ''} ${failure.detail} ${failure.providerReason ?? ''}`);
  if (isPlatformSignInRequired) {
    message = copy.signInRequired;
    advice = copy.signInRequiredAdvice;
    action = 'settings';
  } else if (failure.source === 'relay' && ['auth_invalid', 'auth_missing', 'provider_quota_exhausted'].includes(kind)) {
    message = copy.relayAccount;
    advice = copy.advice.relay_unavailable;
    action = 'switch_relay';
  }
  // A quota refusal describes this API call, not the user's NextMux balance.
  if (kind === 'provider_quota_exhausted' || (kind === 'relay_unavailable' && (failure.code ?? '').toLowerCase() === 'upstream_balance_unavailable')) {
    message = copy.messages.provider_quota_exhausted;
    const relayQuota = failure.source === 'relay' || kind === 'relay_unavailable';
    advice = relayQuota ? copy.advice.relay_unavailable : copy.advice.provider_quota_exhausted;
    action = relayQuota ? 'switch_relay' : 'settings';
  }
  if (kind === 'network') {
    if (failure.source === 'own_api') {
      advice = copy.ownApiConnection;
      action = 'settings';
    } else if (failure.source === 'local') {
      advice = copy.localConnection;
      action = 'settings';
    } else if (failure.source === 'relay') {
      advice = copy.relayConnection;
      action = 'retry';
    } else {
      advice = copy.advice.network;
      action = 'retry';
    }
  }
  // Privacy preferences are advisory only and never block model usage: treat any legacy route_privacy_unavailable code as a retryable relay route error.
  if ((failure.code ?? '').toLowerCase() === 'route_privacy_unavailable') {
    message = copy.messages.relay_unavailable;
    advice = copy.advice.relay_unavailable;
    action = 'retry';
  }
  if (kind === 'rate_limited' && failure.retryAfterSeconds !== undefined) advice = copy.wait.replace('{seconds}', String(failure.retryAfterSeconds));
  if (kind === 'billing_review_required' && failure.source === 'relay' && failure.causeKind === 'provider_quota_exhausted') {
    message = `${copy.relayAccount} ${message}`;
  }
  let text = `${message} ${advice}`.trim();
  if (kind === 'request_budget_unavailable' && failure.walletAdmission) text += ` ${formatWalletAdmissionDiagnostic(failure.walletAdmission, locale)}`;
  if (failure.parameter && kind !== 'billing_unavailable') text += ` ${copy.parameter.replace('{parameter}', failure.parameter)}`;
  if (failure.providerReason && kind !== 'billing_unavailable' && !isPlatformSignInRequired) text += ` ${copy.reason.replace('{reason}', failure.providerReason)}`;
  if (failure.retryCount && failure.retryCount > 0) text += ` ${copy.retried.replace('{count}', String(failure.retryCount))}`;
  if (failure.relaySwitchCount && failure.relaySwitchCount > 0) text += ` ${copy.switched.replace('{count}', String(failure.relaySwitchCount))}`;
  return { ...failure, text, action, actionLabel: copy.actions[action], retryable: action === 'retry' };
}
