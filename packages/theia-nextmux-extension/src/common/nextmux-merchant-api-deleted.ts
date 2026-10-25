/**
 * The gateway stops a request whose merchant API was deleted while it was in use with HTTP 410
 * `merchant_api_deleted` (apps/cloudflare-platform/src/gateway.js, MERCHANT_API_DELETED_READABLE). Model adapters
 * wrap that body (REQUEST_REJECTED, a stream error, a runtime failure), so the code can sit on the failure itself,
 * its envelope, its readable error or provider code, or survive only as the gateway's sentence.
 */
const DELETED_CODES = new Set(['merchant_api_deleted', 'offering_deleted', 'merchant_offering_deleted']);
const DELETED_SENTENCE = /merchant\s+api\s+(?:was\s+|has\s+been\s+)?deleted|商家\s*API\s*已(?:被)?(?:删除|刪除)/i;

export function isMerchantApiDeletedFailure(value: unknown): boolean {
    const seen = new Set<object>();
    const visit = (candidate: unknown, depth: number): boolean => {
        if (typeof candidate === 'string') return DELETED_CODES.has(candidate.trim().toLowerCase()) || DELETED_SENTENCE.test(candidate);
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || depth > 4 || seen.has(candidate)) return false;
        seen.add(candidate);
        const record = candidate as Record<string, unknown>;
        // Error's message and cause are not enumerable; read them explicitly.
        const text = (key: string): string => typeof record[key] === 'string' ? record[key] as string : '';
        if (['code', 'providerCode', 'kind', 'stopReason'].some(key => DELETED_CODES.has(text(key).trim().toLowerCase()))) return true;
        if (['message', 'detail', 'publicMessage'].some(key => DELETED_SENTENCE.test(text(key)))) return true;
        return ['error', 'failure', 'details', 'cause', 'data', 'readableError'].some(key => visit(record[key], depth + 1));
    };
    return visit(value, 0);
}
