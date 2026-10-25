import type { ManagedPriceUpdate } from '@nextmux/agent-runtime';

const quote = /^kq1_[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
/** Invalid advisory data is ignored; it must not restart a paid model call. */
export function readManagedPriceUpdate(value: unknown, requestId?: string): ManagedPriceUpdate | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const item = value as Record<string, unknown>;
    if (typeof item.requestId !== 'string' || !uuid.test(item.requestId) || requestId && requestId !== item.requestId
        || typeof item.effectiveQuoteId !== 'string' || !quote.test(item.effectiveQuoteId)
        || item.id !== `${item.requestId}:${item.effectiveQuoteId}`
        || !Number.isSafeInteger(item.at) || Number(item.at) <= 0
        || typeof item.offeringId !== 'string' || !uuid.test(item.offeringId)
        || typeof item.model !== 'string' || !item.model.trim() || item.model.length > 256
        || typeof item.currency !== 'string' || !/^[A-Z]{3}$/.test(item.currency)
        || item.usageMultiplierBps !== null && (!Number.isSafeInteger(item.usageMultiplierBps) || Number(item.usageMultiplierBps) < 0)
        || item.previousQuoteId !== undefined && item.previousQuoteId !== '' && (typeof item.previousQuoteId !== 'string' || !quote.test(item.previousQuoteId))
        || !Array.isArray(item.rates) || !item.rates.length || item.rates.length > 64) return undefined;
    const rates: ManagedPriceUpdate['rates'][number][] = [], seen = new Set<string>();
    for (const raw of item.rates) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
        const rate = raw as Record<string, unknown>;
        if (typeof rate.metric !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(rate.metric) || seen.has(rate.metric)
            || !Number.isSafeInteger(rate.unitSize) || Number(rate.unitSize) <= 0
            || !Number.isSafeInteger(rate.customerAmountMicros) || Number(rate.customerAmountMicros) < 0) return undefined;
        seen.add(rate.metric);
        rates.push({ metric: rate.metric, unitSize: Number(rate.unitSize), customerAmountMicros: Number(rate.customerAmountMicros) });
    }
    return { id: String(item.id), requestId: item.requestId, at: Number(item.at), effectiveQuoteId: item.effectiveQuoteId,
        ...(item.previousQuoteId ? { previousQuoteId: String(item.previousQuoteId) } : {}),
        offeringId: item.offeringId, model: item.model, currency: item.currency,
        ...(Number.isSafeInteger(item.previousUsageMultiplierBps) && Number(item.previousUsageMultiplierBps) >= 0
            ? { previousUsageMultiplierBps: Number(item.previousUsageMultiplierBps) } : {}),
        usageMultiplierBps: item.usageMultiplierBps as number | null, rates: rates.sort((a, b) => a.metric.localeCompare(b.metric)) };
}
