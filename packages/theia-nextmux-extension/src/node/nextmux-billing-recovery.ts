import { setTimeout as delay } from 'node:timers/promises';

interface BillingFailure {
    readonly code?: string;
    readonly requestId?: string;
    readonly recoveryMode?: string;
    readonly durableEvidence?: boolean;
    readonly upstreamResumeSupported?: boolean;
    readonly resumable?: boolean;
    readonly retryAfterMs?: number;
    readonly preDispatchPending?: boolean;
    readonly providerAccepted?: boolean;
    readonly settled?: boolean;
    readonly usageKnown?: boolean;
    readonly partial?: boolean;
    readonly acceptanceUnknown?: boolean;
}

function billingFailure(value: unknown): BillingFailure {
    return value && typeof value === 'object' ? value as BillingFailure : {};
}

/** Allow a short visibility delay when the transport lost the server ID.
 * Every lookup uses the original key; this never retries model generation.
 * Exhaustion preserves the pending diagnosis, not a claim about charges.
 */
export async function recoverGatewayInitialization<T>(options: {
    readonly poll: () => Promise<T>;
    readonly signal?: AbortSignal;
    readonly onWaiting?: () => void | Promise<void>;
    readonly pause?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}): Promise<T> {
    const pause = options.pause || ((milliseconds, signal) => delay(milliseconds, undefined, { signal }));
    for (let attempt = 0; ; attempt++) {
        try { return await options.poll(); }
        catch (error) {
            const failure = billingFailure(error);
            if (!['request_initialization_pending', 'billing_initialization_pending'].includes((failure.code || '').toLowerCase())
                || failure.requestId || attempt >= 3 || options.signal?.aborted) throw error;
            try { await options.onWaiting?.(); } catch { /* advisory */ }
            try { await pause(Math.max(1_000, Math.min(30_000, failure.retryAfterMs ?? 2_000)), options.signal); }
            catch { throw error; }
            if (options.signal?.aborted) throw error;
        }
    }
}

export function canRecoverBilling(value: unknown): boolean {
    const failure = billingFailure(value);
    return !(failure.settled === true && failure.usageKnown === true)
        && ['billing_finalization_pending', 'billing_recovery_rate_limited'].includes(failure.code || '')
        && failure.recoveryMode === 'billing_only' && failure.durableEvidence === true
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(failure.requestId || '');
}

/** A verified upstream cursor permits waiting for the original result, not
 * submitting the prompt again. Keep billing-review/unknown-only failures out
 * of this path: they do not establish that the provider can recover content. */
export function canRecoverGatewayResult(value: unknown): boolean {
    if (canRecoverBilling(value)) return true;
    const failure = billingFailure(value);
    if ((failure.code || '').toLowerCase() === 'gateway_pre_dispatch_pending') return failure.preDispatchPending === true
        && failure.providerAccepted === false && failure.recoveryMode === 'resume' && failure.settled !== true
        && failure.partial !== true && failure.acceptanceUnknown !== true && failure.usageKnown !== true
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(failure.requestId || '');
    return failure.settled !== true && failure.recoveryMode === 'resume'
        && failure.upstreamResumeSupported === true && failure.resumable !== false
        && ['request_in_progress', 'billing_recovery_rate_limited', 'billing_transport_unknown',
            'upstream_response_pending', 'upstream_connection_failed', 'upstream_timeout',
            'upstream_stream_aborted', 'upstream_response_invalid'].includes((failure.code || '').toLowerCase())
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(failure.requestId || '');
}

/** Poll the original result/receipt, never create another model invocation. */
export async function recoverBillingResult<T extends { readonly call: { readonly id: string } }>(
    failure: unknown,
    options: {
        readonly poll: (requestId: string) => Promise<T>;
        readonly signal?: AbortSignal;
        readonly onWaiting?: () => void | Promise<void>;
        readonly maximumWaitMs?: number;
        readonly now?: () => number;
        readonly pause?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
    }
): Promise<T> {
    if (!canRecoverGatewayResult(failure)) throw failure;
    const original = billingFailure(failure);
    const now = options.now || Date.now;
    // A managed inference can legitimately remain pending for days.  Do not
    // impose a hidden recovery lifetime: the caller's AbortSignal is the
    // normal cancellation boundary.  An explicit maximumWaitMs remains
    // available for bounded callers and tests; zero still means expired now.
    const maximumWaitMs = options.maximumWaitMs;
    const deadline = maximumWaitMs === undefined
        ? Number.POSITIVE_INFINITY
        : now() + Math.max(0, maximumWaitMs);
    const pause = options.pause || ((milliseconds, signal) => delay(milliseconds, undefined, { signal }));
    let pending = failure;
    try { await options.onWaiting?.(); } catch { /* Telemetry cannot invalidate a paid result. */ }
    for (let attempt = 0; ; attempt++) {
        if (options.signal?.aborted) throw failure;
        const wait = attempt === 0 ? 0 : Math.max(1_000, billingFailure(pending).retryAfterMs ?? 2_000);
        if (now() + wait >= deadline) throw pending;
        try { await pause(wait, options.signal); } catch { throw failure; }
        if (options.signal?.aborted) throw failure;
        let result: T;
        try {
            result = await options.poll(original.requestId!);
        } catch (error) {
            const candidate = billingFailure(error);
            if (['gateway_pre_dispatch_pending', 'gateway_pre_dispatch_recovered'].includes((candidate.code || '').toLowerCase())
                && candidate.requestId !== original.requestId) throw Object.assign(new Error('The recovery receipt does not match the original request'), {
                    code: 'BILLING_RECEIPT_MISMATCH', requestId: original.requestId, providerAccepted: true, retrySafe: false,
                    retryable: false, recoveryMode: 'billing_review'
                });
            if (canRecoverGatewayResult(error) && candidate.requestId === original.requestId) pending = error;
            else if (['PLATFORM_OFFLINE', 'PLATFORM_TIMEOUT'].includes(candidate.code || '')) pending = failure;
            else throw error;
            continue;
        }
        if (options.signal?.aborted || result?.call?.id !== original.requestId) throw failure;
        return result;
    }
    throw pending;
}
