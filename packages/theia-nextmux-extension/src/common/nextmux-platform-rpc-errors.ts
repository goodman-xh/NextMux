import { ApplicationError } from '@theia/core/lib/common/application-error';
import { RpcProxyFactory } from '@theia/core/lib/common/messaging/proxy-factory';
import { classifyModelError, formatModelError, MODEL_ERROR_KINDS, normalizeWalletAdmissionDiagnostic, type ReadableModelError } from '@nextmux/model-runtime/errors';
import type { DesktopAgentRunFailure } from './nextmux-platform-protocol';
import type { DomainMessage } from './nextmux-domain-errors';

// This representation is only registered on NextMuxPlatformServicePath.
export const NEXTMUX_PLATFORM_RPC_ERROR = -45037;
const identifier = /^[A-Za-z0-9._:-]{1,160}$/;
const codePattern = /^[A-Za-z][A-Za-z0-9_.-]{0,159}$/;
const booleanFields = ['retrySafe', 'retryable', 'preDispatchPending', 'localPolicy', 'providerAccepted', 'zeroChargeConfirmed',
    'notDispatched', 'partial', 'resumable', 'replayable', 'upstreamResumeSupported', 'durableEvidence', 'settled', 'usageKnown',
    'billingPending', 'waitingCapacity', 'waitingPricing', 'canResumeCapacity'] as const;
const idFields = ['requestId', 'taskId', 'resumeCheckpointId'] as const;
const allowedFields = new Set<string>(['type', 'version', 'code', 'readableError', 'domainError', 'status', 'httpStatus', 'retryAfterMs',
    'lastSequence', 'chargedMicros', 'currency', 'pendingManagedReceipt', 'capacityReasons', 'recoveryMode', 'requestBodyHash',
    'priceReplacement', 'legacyPriceReplacement', 'legacyPriceResubmit', ...booleanFields, ...idFields]);
type BooleanField = typeof booleanFields[number];
type IdField = typeof idFields[number];
export type PlatformRpcFailure = Partial<Record<BooleanField, boolean>> & Partial<Record<IdField, string>> & {
    readonly type: 'nextmux-platform-error'; readonly version: 1; readonly code: string; readonly readableError: ReadableModelError;
    readonly domainError?: DomainMessage; readonly status?: number; readonly httpStatus?: number; readonly retryAfterMs?: number;
    readonly lastSequence?: number | null; readonly chargedMicros?: number; readonly currency?: string;
    readonly recoveryMode?: 'resume' | 'billing_only' | 'billing_review' | 'none';
    readonly pendingManagedReceipt?: DesktopAgentRunFailure['pendingManagedReceipt'];
    readonly capacityReasons?: readonly ('concurrency' | 'rpm' | 'tpm' | 'daily_tokens')[];
    readonly requestBodyHash?: string;
    readonly priceReplacement?: { version: 1; authority: 'task'; originalRequestId: string; clientNonce: string; bodyHash: string };
    readonly legacyPriceReplacement?: { version: 1; authority: 'legacy'; originalRequestId: string; clientNonce: string; requestHash: string };
    readonly legacyPriceResubmit?: { version: 1; authority: 'legacy'; originalRequestId: string; clientNonce: string; requestHash: string };
};
function record(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function nonNegative(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number | undefined {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : undefined;
}
function pendingReceipt(value: unknown): DesktopAgentRunFailure['pendingManagedReceipt'] {
    const item = record(value);
    if (!item || Object.keys(item).some(key => !['version', 'requestId', 'userId', 'platformOrigin', 'conversationId', 'runId'].includes(key))
        || item.version !== 1 || typeof item.requestId !== 'string'
        || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(item.requestId)
        || !['userId', 'conversationId', 'runId'].every(key => typeof item[key] === 'string' && /^[A-Za-z0-9._:-]{1,200}$/.test(item[key] as string))
        || typeof item.platformOrigin !== 'string' || item.platformOrigin.length > 2048) return undefined;
    try {
        const origin = new URL(item.platformOrigin);
        if (!['https:', 'http:'].includes(origin.protocol) || origin.origin !== item.platformOrigin || origin.username || origin.password) return undefined;
    } catch { return undefined; }
    return { version: 1, requestId: item.requestId, userId: item.userId as string, platformOrigin: item.platformOrigin,
        conversationId: item.conversationId as string, runId: item.runId as string };
}
/** Transport presentation uses identities and bounded numbers, never provider prose, request bodies or stacks. */
function presentation(value: unknown): ReadableModelError | undefined {
    const item = record(value);
    if (!item || typeof item.kind !== 'string' || !MODEL_ERROR_KINDS.includes(item.kind as typeof MODEL_ERROR_KINDS[number])) return undefined;
    const fields: Record<string, unknown> = { kind: item.kind, detail: '' };
    for (const key of ['domain', 'source', 'providerFailure', 'causeKind', 'httpStatus', 'retryAfterSeconds', 'retryCount', 'relaySwitchCount']) {
        fields[key] = item[key];
    }
    for (const key of ['code', 'messageKey', 'parameter']) {
        if (typeof item[key] === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,159}$/.test(item[key] as string)) fields[key] = item[key];
    }
    const params = record(item.params);
    if (params) fields.params = Object.fromEntries(Object.entries(params).slice(0, 40).filter(([key, value]) =>
        /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(key) && (value === null || typeof value === 'boolean'
            || typeof value === 'number' && Number.isFinite(value))));
    const walletAdmission = normalizeWalletAdmissionDiagnostic(item.walletAdmission);
    if (walletAdmission) fields.walletAdmission = walletAdmission;
    return { ...classifyModelError(fields), detail: '' };
}
function priceAuthority(value: unknown, authority: 'task' | 'legacy', requestId: string | undefined): PlatformRpcFailure['priceReplacement'] | PlatformRpcFailure['legacyPriceReplacement'] {
    const item = record(value), hashKey = authority === 'task' ? 'bodyHash' : 'requestHash';
    if (!item || Object.keys(item).some(key => !['version', 'authority', 'originalRequestId', 'clientNonce', hashKey].includes(key))
        || item.version !== 1 || item.authority !== authority || typeof item.originalRequestId !== 'string'
        || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(item.originalRequestId)
        || item.originalRequestId !== requestId || typeof item.clientNonce !== 'string'
        || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(item.clientNonce)
        || typeof item[hashKey] !== 'string' || !/^[a-f0-9]{64}$/.test(item[hashKey] as string)) return undefined;
    const identity = { version: 1 as const, originalRequestId: item.originalRequestId, clientNonce: item.clientNonce };
    return authority === 'task' ? { ...identity, authority, bodyHash: item.bodyHash as string }
        : { ...identity, authority, requestHash: item.requestHash as string };
}
/** Called on the backend only after an actual PlatformRequestError instanceof check. */
export function platformRpcApplicationError(value: unknown): ApplicationError<typeof NEXTMUX_PLATFORM_RPC_ERROR, PlatformRpcFailure> | undefined {
    const projected = projectPlatformRpcFailure(value);
    if (!projected) return undefined;
    const error = ApplicationError.fromJson(NEXTMUX_PLATFORM_RPC_ERROR, { message: 'Platform request failed.', data: projected });
    error.stack = undefined;
    return error;
}
function projectPlatformRpcFailure(value: unknown): PlatformRpcFailure | undefined {
    const item = record(value), readableError = presentation(item?.readableError);
    if (!item || typeof item.code !== 'string' || !codePattern.test(item.code) || !readableError) return undefined;
    const output: PlatformRpcFailure = { type: 'nextmux-platform-error', version: 1, code: item.code, readableError };
    for (const key of booleanFields) if (typeof item[key] === 'boolean') output[key] = item[key];
    for (const key of idFields) if (typeof item[key] === 'string' && identifier.test(item[key] as string)) output[key] = item[key] as string;
    const extra: Record<string, unknown> = {};
    const status = nonNegative(item.status ?? item.httpStatus, 599);
    if (status !== undefined && status >= 400) { extra.status = status; extra.httpStatus = status; }
    const retryAfterMs = nonNegative(item.retryAfterMs, 300_000);
    if (retryAfterMs !== undefined) extra.retryAfterMs = retryAfterMs;
    const sequence = nonNegative(item.lastSequence);
    if (sequence !== undefined || item.lastSequence === null) extra.lastSequence = sequence ?? null;
    for (const key of ['chargedMicros']) { const number = nonNegative(item[key]); if (number !== undefined) extra[key] = number; }
    if (typeof item.currency === 'string' && /^[A-Z]{3}$/.test(item.currency)) extra.currency = item.currency;
    if (['resume', 'billing_only', 'billing_review', 'none'].includes(String(item.recoveryMode))) extra.recoveryMode = item.recoveryMode;
    const domain = record(item.domainError);
    if (domain && typeof domain.code === 'string' && /^[A-Z][A-Z0-9_.-]{1,127}$/.test(domain.code)) {
        extra.domainError = { code: domain.code, fallbackEnglish: 'Platform request failed.',
            params: Object.fromEntries(Object.entries(record(domain.params) ?? {}).slice(0, 40).filter(([key, value]) =>
                /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(key) && (typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)))) };
    }
    const data = record(item.data);
    const pending = pendingReceipt(item.pendingManagedReceipt ?? data?.pendingManagedReceipt);
    if (pending && (item.code.toUpperCase().startsWith('BILLING_') || item.code.toUpperCase() === 'RESPONSE_REPLAY_EXPIRED')
        && output.settled !== true) extra.pendingManagedReceipt = pending;
    const capacity = item.capacityReasons ?? data?.capacityReasons;
    if (Array.isArray(capacity) && capacity.length <= 4) extra.capacityReasons = ['concurrency', 'rpm', 'tpm', 'daily_tokens'].filter(reason => capacity.includes(reason));
    Object.assign(output, extra);
    if (output.waitingCapacity === true && output.providerAccepted === false
        && typeof item.requestBodyHash === 'string' && /^[a-f0-9]{64}$/.test(item.requestBodyHash)) {
        extra.requestBodyHash = item.requestBodyHash;
    }
    const replacementEligible = output.code.toLowerCase() === 'price_revision_required' && output.settled === true
        && output.usageKnown === true && output.chargedMicros === 0 && output.providerAccepted === false
        && output.partial !== true && output.recoveryMode === 'none';
    if (replacementEligible) {
        const task = priceAuthority(item.priceReplacement, 'task', output.requestId);
        const legacy = priceAuthority(item.legacyPriceReplacement, 'legacy', output.requestId);
        if (task) extra.priceReplacement = task;
        if (legacy) extra.legacyPriceReplacement = legacy;
    }
    if (output.code.toLowerCase() === 'price_replacement_not_received' && output.status === 409
        && output.providerAccepted === false && output.partial !== true && output.usageKnown !== true
        && (output.chargedMicros === undefined || output.chargedMicros === 0)) {
        const resubmit = priceAuthority(item.legacyPriceResubmit, 'legacy', output.requestId);
        if (resubmit) extra.legacyPriceResubmit = resubmit;
    }
    Object.assign(output, extra);
    if (output.canResumeCapacity === true && (!output.requestBodyHash || !output.requestId
        || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(output.requestId))) output.canResumeCapacity = false;
    // Preserve the existing denial; a presentation DTO never creates retry permission for an unknown/accepted outcome.
    if (output.partial === true || output.providerAccepted === true || output.billingPending === true
        || output.recoveryMode?.startsWith('billing_') || output.code.toUpperCase().startsWith('BILLING_')) {
        output.retrySafe = false; output.retryable = false;
    }
    // An already accepted/partial task can still support trusted same-task replay; only billing review forbids resume.
    if (output.recoveryMode?.startsWith('billing_') || output.code.toUpperCase().startsWith('BILLING_')) {
        output.resumable = false;
    }
    return output;
}
/** A malformed application envelope is a generic failure, never a resume or retry signal. */
export function decodePlatformRpcError(value: unknown): Error | undefined {
    if (!value || typeof value !== 'object' || !ApplicationError.is(value) || value.code !== NEXTMUX_PLATFORM_RPC_ERROR) return undefined;
    const item = record(value.data);
    const projected = item && item.type === 'nextmux-platform-error' && item.version === 1
        && !Object.keys(item).some(key => !allowedFields.has(key)) ? projectPlatformRpcFailure(item) : undefined;
    if (!projected) return Object.assign(new Error('Platform request failed.'), { name: 'PlatformRequestError', retrySafe: false, retryable: false, resumable: false });
    const { type: _type, version: _version, ...metadata } = projected;
    const error = Object.assign(new Error(formatModelError(projected.readableError, 'en').text), metadata, {
        name: 'PlatformRequestError',
        ...(projected.recoveryMode?.startsWith('billing_') || projected.code.toUpperCase().startsWith('BILLING_')
            ? { kind: 'waiting_user' as const } : {}),
        data: { readableError: projected.readableError, ...(projected.domainError ? { domainError: projected.domainError } : {}),
            ...(projected.httpStatus === undefined ? {} : { httpStatus: projected.httpStatus }),
            ...(projected.retryAfterMs === undefined ? {} : { retryAfterMs: projected.retryAfterMs }),
            ...(projected.pendingManagedReceipt ? { pendingManagedReceipt: projected.pendingManagedReceipt } : {}),
            ...(projected.capacityReasons ? { capacityReasons: projected.capacityReasons } : {}) }
    });
    error.stack = undefined;
    return error;
}
export class NextMuxPlatformRpcProxyFactory<T extends object> extends RpcProxyFactory<T> {
    protected override deserializeError(capturedError: Error, value: unknown): unknown {
        const decoded = super.deserializeError(capturedError, value);
        return decodePlatformRpcError(decoded) ?? decoded;
    }
}
