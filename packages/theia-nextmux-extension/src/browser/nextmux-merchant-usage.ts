import type { PlatformUsageRecord } from '../common/nextmux-platform-protocol';

export type MerchantModelReport = 'matched' | 'mismatched' | 'unreported';

export interface MerchantUsageSummary {
    readonly key: string;
    readonly merchantId: string;
    readonly providerName: string;
    readonly currency: string;
    readonly requestCount: number;
    readonly completedCount: number;
    readonly chargedMicros: number;
    /** Null when cache dimensions are present but accounting is unknown/mixed. */
    readonly tokenCount: number | null;
    readonly inputIncludesCached?: boolean;
    readonly averageDurationMs: number | null;
    readonly failoverCount: number;
    readonly modelReports: Readonly<Record<MerchantModelReport, number>>;
    readonly latestAt: number | null;
}

function normalizedModel(value: string): string {
    return String(value || '').trim().toLocaleLowerCase().replace(/^models\//, '');
}

export function usageModelReport(record: PlatformUsageRecord): MerchantModelReport {
    const reported = normalizedModel(record.reportedModel);
    const expected = normalizedModel(record.upstreamModel || record.canonicalModel);
    if (!reported || !expected) return 'unreported';
    return reported === expected ? 'matched' : 'mismatched';
}

/**
 * Summaries deliberately call this an upstream model report, not model
 * verification: a provider returning the expected model name is useful
 * evidence, but it is not an independent identity test.
 */
export function summarizeMerchantUsage(records: readonly PlatformUsageRecord[]): readonly MerchantUsageSummary[] {
    const groups = new Map<string, {
        merchantId: string; providerName: string; currency: string; requestCount: number; completedCount: number;
        chargedMicros: number; tokenCount: number | null; tokenAccountingKnown: boolean;
        inputIncludesCachedValues: Set<boolean>; durationTotal: number; durationCount: number; failoverCount: number;
        modelReports: Record<MerchantModelReport, number>; latestAt: number | null;
    }>();
    for (const record of records) {
        const merchantId = String(record.merchantId || '').trim();
        const providerName = String(record.providerName || '').trim() || '平台线路';
        const currency = String(record.currency || 'USD').trim().toUpperCase();
        const key = `${merchantId || `legacy:${providerName}`}\0${currency}`;
        const group = groups.get(key) || {
            merchantId, providerName, currency, requestCount: 0, completedCount: 0, chargedMicros: 0, tokenCount: 0, tokenAccountingKnown: true,
            inputIncludesCachedValues: new Set<boolean>(),
            durationTotal: 0, durationCount: 0, failoverCount: 0,
            modelReports: { matched: 0, mismatched: 0, unreported: 0 }, latestAt: null
        };
        group.requestCount += 1;
        if (record.status === 'completed') group.completedCount += 1;
        group.chargedMicros += Math.max(0, Number(record.chargedMicros) || 0);
        const input = Math.max(0, Number(record.inputTokens) || 0);
        const cached = Math.max(0, Number(record.cachedInputTokens) || 0);
        const writes = Math.max(0, Number(record.cacheWriteTokens) || 0);
        const output = Math.max(0, Number(record.outputTokens) || 0);
        const hasCacheDimensions = cached > 0 || writes > 0;
        if (hasCacheDimensions && typeof record.inputIncludesCached !== 'boolean') {
            group.tokenAccountingKnown = false;
        } else {
            if (hasCacheDimensions) group.inputIncludesCachedValues.add(record.inputIncludesCached!);
            const prompt = record.inputIncludesCached === false ? input + cached + writes : input;
            if (group.tokenCount !== null) group.tokenCount += prompt + output;
        }
        if (Number(record.durationMs) > 0) { group.durationTotal += Number(record.durationMs); group.durationCount += 1; }
        group.failoverCount += Math.max(0, Number(record.failoverCount) || 0);
        group.modelReports[usageModelReport(record)] += 1;
        const at = Number(record.completedAt || record.startedAt || 0);
        if (at > 0) group.latestAt = Math.max(group.latestAt || 0, at);
        groups.set(key, group);
    }
    return [...groups.entries()].map(([key, group]) => ({
        key, merchantId: group.merchantId, providerName: group.providerName, currency: group.currency,
        requestCount: group.requestCount, completedCount: group.completedCount, chargedMicros: group.chargedMicros,
        tokenCount: group.tokenAccountingKnown ? group.tokenCount : null,
        ...(group.tokenAccountingKnown && group.inputIncludesCachedValues.size === 1
            ? { inputIncludesCached: [...group.inputIncludesCachedValues][0] } : {}),
        averageDurationMs: group.durationCount ? Math.round(group.durationTotal / group.durationCount) : null,
        failoverCount: group.failoverCount, modelReports: group.modelReports, latestAt: group.latestAt
    })).sort((left, right) => Number(right.latestAt || 0) - Number(left.latestAt || 0) || left.providerName.localeCompare(right.providerName));
}
