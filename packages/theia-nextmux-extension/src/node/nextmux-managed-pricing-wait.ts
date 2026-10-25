/** Only the gateway's explicit pre-dispatch proof permits another submission
 * of the same request. An error code or HTTP 503 alone proves nothing. */
export function managedPricingWaitEvidence(code: string, status: number | undefined, details: Record<string, unknown>): boolean {
    return ['pricing_authority_updating', 'route_temporarily_unavailable'].includes(code.toLowerCase()) && status === 503
        && details.providerAccepted === false && details.usageKnown === true && details.chargedMicros === 0
        && details.resumable === true && details.recoveryMode === 'resume'
        && !['partial', 'acceptanceUnknown', 'visibleOutputStarted', 'toolCallStarted', 'reasoningStarted', 'settled']
            .some(key => details[key] === true);
}

export async function waitForManagedPricing<T>(
    submit: (retry: boolean) => Promise<T>,
    options: { signal?: AbortSignal; onWaiting?: () => void | Promise<void>; cancelled: () => Error }
): Promise<T> {
    let retry = false;
    for (;;) {
        if (options.signal?.aborted) throw options.cancelled();
        try { return await submit(retry); }
        catch (error) {
            const failure = error as { waitingPricing?: boolean; retryAfterMs?: number } | undefined;
            if (failure?.waitingPricing !== true) throw error;
            if (options.signal?.aborted) throw options.cancelled();
            await options.onWaiting?.();
            await new Promise<void>(resolve => {
                const done = (): void => { clearTimeout(timer); options.signal?.removeEventListener('abort', done); resolve(); };
                const timer = setTimeout(done, Math.max(1000, Math.min(30000, failure.retryAfterMs || 2000)));
                options.signal?.addEventListener('abort', done, { once: true });
                if (options.signal?.aborted) done();
            });
            retry = true;
        }
    }
}
