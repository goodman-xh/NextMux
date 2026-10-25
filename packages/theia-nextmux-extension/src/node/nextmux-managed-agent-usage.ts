import type { ManagedGatewayResult } from '../common/nextmux-platform-protocol';

/** Display only authoritative gateway receipts, once per request in this run.
 * This never calculates prices, charges a wallet or estimates unknown usage.
 */
export class ManagedGatewayChargeTotal {
    private readonly requestIds = new Set<string>();
    chargedMicros = 0;
    currency = '';
    requestCount = 0;

    record(requestId: unknown, chargedMicros: unknown, currency: unknown): void {
        if (typeof requestId !== 'string' || !requestId || requestId.length > 160 || this.requestIds.has(requestId)
            || !Number.isSafeInteger(chargedMicros) || Number(chargedMicros) < 0
            || typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) return;
        const total = this.chargedMicros + Number(chargedMicros);
        if (!Number.isSafeInteger(total)) return;
        this.requestIds.add(requestId);
        this.chargedMicros = total;
        this.currency = currency;
        this.requestCount += 1;
    }
}

/** Model budgets count processed tokens; customer charges use gateway.billing. */
export function managedAgentUsage(response: ManagedGatewayResult['response']): {
    readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
    readonly usageKnown: boolean;
} {
    const separate = Object.hasOwn(response, 'contextUsageKnown') || Object.hasOwn(response, 'contextUsage');
    const counters = separate ? response.contextUsage : response.usage;
    const known = (separate ? response.contextUsageKnown === true : response.usage.usageKnown === true)
        && Number.isSafeInteger(counters?.inputTokens) && Number(counters?.inputTokens) >= 0
        && Number.isSafeInteger(counters?.outputTokens) && Number(counters?.outputTokens) >= 0;
    return {
        usage: known ? { inputTokens: counters!.inputTokens, outputTokens: counters!.outputTokens } : { inputTokens: 0, outputTokens: 0 },
        usageKnown: known
    };
}
