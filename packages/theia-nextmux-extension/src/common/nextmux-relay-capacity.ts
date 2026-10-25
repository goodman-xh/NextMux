export type PublicMerchantCapacityScope = 'coding' | 'comic';
export interface PublicMerchantCapacitySnapshot {
    readonly scope: PublicMerchantCapacityScope;
    readonly merchants: readonly {
        readonly merchantId: string;
        readonly state: 'available' | 'full' | 'unknown';
        /** Local deadline, capped at three seconds from request start. */
        readonly expiresAt: number;
    }[];
}

const merchantIdentity = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

export function publicMerchantCapacityParameters(merchantIds: readonly string[], scope: PublicMerchantCapacityScope): URLSearchParams {
    if (!['coding', 'comic'].includes(scope) || !Array.isArray(merchantIds) || merchantIds.length < 1 || merchantIds.length > 32
        || merchantIds.some(id => typeof id !== 'string' || !merchantIdentity.test(id))) throw new Error('PUBLIC_MERCHANT_CAPACITY_QUERY_INVALID');
    const parameters = new URLSearchParams({ scope });
    for (const id of [...new Set(merchantIds)].sort()) parameters.append('merchantId', id);
    return parameters;
}

/** Only requested public merchant status crosses RPC, with no credential or lease data. */
export function normalizePublicMerchantCapacity(value: unknown, merchantIds: readonly string[], scope: PublicMerchantCapacityScope,
    requestStartedAt: number, now = Date.now()): PublicMerchantCapacitySnapshot {
    publicMerchantCapacityParameters(merchantIds, scope);
    const input = value as { scope?: unknown; observedAt?: unknown; merchants?: unknown };
    if (!input || input.scope !== scope || !Number.isSafeInteger(input.observedAt) || !Array.isArray(input.merchants)
        || input.merchants.length > 32 || !Number.isSafeInteger(requestStartedAt) || requestStartedAt > now) throw new Error('PUBLIC_MERCHANT_CAPACITY_RESPONSE_INVALID');
    const requested = new Set(merchantIds), seen = new Set<string>();
    const merchants = input.merchants.map((row: unknown) => {
        const item = row as { merchantId?: unknown; state?: unknown; validUntil?: unknown };
        if (!item || typeof item.merchantId !== 'string' || !requested.has(item.merchantId) || seen.has(item.merchantId)
            || typeof item.state !== 'string' || !['available', 'full', 'unknown'].includes(item.state) || !Number.isSafeInteger(item.validUntil)) throw new Error('PUBLIC_MERCHANT_CAPACITY_RESPONSE_INVALID');
        seen.add(item.merchantId);
        const ttl = Math.max(0, Math.min(3000, Number(item.validUntil) - Number(input.observedAt)));
        return { merchantId: item.merchantId, state: item.state as 'available' | 'full' | 'unknown', expiresAt: requestStartedAt + ttl };
    });
    for (const merchantId of requested) if (!seen.has(merchantId)) merchants.push({ merchantId, state: 'unknown', expiresAt: now });
    return { scope, merchants };
}

export function relayMerchantIsFull(snapshot: PublicMerchantCapacitySnapshot | undefined, merchantId: string | undefined,
    scope: PublicMerchantCapacityScope, now = Date.now()): boolean {
    return snapshot?.scope === scope && !!merchantId
        && snapshot.merchants.some(item => item.merchantId === merchantId && item.state === 'full' && item.expiresAt > now);
}
