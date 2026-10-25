/*
 * Usage analytics math for the desktop usage page.
 *
 * Ported from the NextMux web dashboard (apps/cloudflare-platform/web/src/features/account/usage-stats.ts),
 * whose page structure follows the LiteLLM usage/spend dashboard and OpenRouter's Activity page:
 * KPI row → trend by day → breakdown by model → breakdown by route. Unknown values stay `null`
 * (rendered as “—”); nothing is guessed or reported as 0.
 */
import type { PlatformMerchantUsageSummary, PlatformUsageHistoryRecord } from '../common/nextmux-platform-protocol';

export const USAGE_DAY_MS = 86_400_000;

/**
 * Cache-hit accounting mirrors the platform (portal-queries.js): when the tariff's input count
 * already includes cached tokens the denominator is input; otherwise input + cache read + cache
 * write. Records whose accounting is unknown are left out rather than guessed.
 */
export function usageCacheParts(record: Pick<PlatformUsageHistoryRecord, 'inputTokens' | 'cachedInputTokens' | 'cacheWriteTokens' | 'inputIncludesCached'>): { hit: number; total: number } | undefined {
    if (record.inputIncludesCached === null || record.inputIncludesCached === undefined) return undefined;
    if (record.inputTokens === null || record.cachedInputTokens === null || record.cacheWriteTokens === null) return undefined;
    if (record.inputIncludesCached && record.cachedInputTokens > record.inputTokens) return undefined;
    const total = record.inputIncludesCached ? record.inputTokens : record.inputTokens + record.cachedInputTokens + record.cacheWriteTokens;
    return { hit: record.cachedInputTokens, total };
}

export interface UsageBucket {
    requests: number;
    completed: number;
    failed: number;
    chargedMicros: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    cacheWriteTokens: number;
    /** Total tokens by each record's own accounting (cache reads/writes added when input excludes them). */
    totalTokens: number;
    /** Records with cache tokens whose accounting is unknown: the total is then not exact. */
    unknownTokenAccounting: number;
    /** Requests with provider-reported token counts. */
    metered: number;
    cacheHit: number;
    cacheTotal: number;
    durations: number[];
}

export function emptyUsageBucket(): UsageBucket {
    return { requests: 0, completed: 0, failed: 0, chargedMicros: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, totalTokens: 0, unknownTokenAccounting: 0, metered: 0, cacheHit: 0, cacheTotal: 0, durations: [] };
}

export function addUsageRecord(bucket: UsageBucket, record: PlatformUsageHistoryRecord): void {
    bucket.requests += 1;
    if (record.status === 'completed') bucket.completed += 1;
    if (record.status === 'failed') bucket.failed += 1;
    bucket.chargedMicros += Number(record.chargedMicros || 0);
    if (record.inputTokens !== null || record.outputTokens !== null) bucket.metered += 1;
    bucket.inputTokens += record.inputTokens ?? 0;
    bucket.outputTokens += record.outputTokens ?? 0;
    bucket.cachedTokens += record.cachedInputTokens ?? 0;
    bucket.cacheWriteTokens += record.cacheWriteTokens ?? 0;
    // The same token total as the balance details (nextmux-merchant-usage): cache reads and writes count when the
    // input counter leaves them out; unknown accounting with cache is marked, never guessed (audit A15-03).
    const cacheTokens = (record.cachedInputTokens ?? 0) + (record.cacheWriteTokens ?? 0);
    if (cacheTokens > 0 && typeof record.inputIncludesCached !== 'boolean') bucket.unknownTokenAccounting += 1;
    bucket.totalTokens += (record.inputTokens ?? 0) + (record.outputTokens ?? 0) + (record.inputIncludesCached === false ? cacheTokens : 0);
    const cache = usageCacheParts(record);
    if (cache) { bucket.cacheHit += cache.hit; bucket.cacheTotal += cache.total; }
    if (record.durationMs !== null && record.durationMs >= 0) bucket.durations.push(record.durationMs);
}

export function usagePercentile(values: readonly number[], p: number): number | null {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p / 100 * sorted.length) - 1))];
}

export function usageRatio(part: number, whole: number): number | null {
    return whole > 0 ? Math.min(1, Math.max(0, part / whole)) : null;
}

/** Local calendar-day key so days match the viewer's calendar. */
export function usageDayKey(time: number): string {
    const d = new Date(time);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export type UsageDay = UsageBucket & { readonly day: string; readonly time: number };

/** One bucket per calendar day in [since, until), oldest first, including empty days. */
export function usageByDay(records: readonly PlatformUsageHistoryRecord[], since: number, until: number, currency: string): UsageDay[] {
    const days = new Map<string, UsageDay>();
    const cursor = new Date(since);
    cursor.setHours(0, 0, 0, 0);
    // Step by calendar date (not 24 h) so daylight-saving changes never skip a day.
    while (cursor.getTime() < until && days.size < 400) {
        const time = cursor.getTime();
        days.set(usageDayKey(time), { ...emptyUsageBucket(), day: usageDayKey(time), time });
        cursor.setDate(cursor.getDate() + 1);
    }
    for (const record of records) {
        if (record.currency !== currency) continue;
        const bucket = days.get(usageDayKey(record.createdAt));
        if (bucket) addUsageRecord(bucket, record);
    }
    return [...days.values()];
}

export type UsageModel = UsageBucket & { readonly model: string; readonly label: string };

export function usageByModel(records: readonly PlatformUsageHistoryRecord[], currency: string): UsageModel[] {
    const models = new Map<string, UsageModel>();
    for (const record of records) {
        if (record.currency !== currency) continue;
        const model = record.canonicalModel || record.modelName || '';
        let bucket = models.get(model);
        if (!bucket) {
            bucket = { ...emptyUsageBucket(), model, label: record.modelName || record.canonicalModel || '' };
            models.set(model, bucket);
        }
        addUsageRecord(bucket, record);
    }
    return [...models.values()].sort((a, b) => b.chargedMicros - a.chargedMicros || b.requests - a.requests);
}

export interface UsageProviderTotals {
    requests: number;
    completed: number;
    failed: number;
    chargedMicros: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    cacheWriteTokens: number;
    /** Tokens by each route's own accounting; `tokensLowerBound` when some route's cache accounting is unknown. */
    totalTokens: number;
    tokensLowerBound: boolean;
    failovers: number;
    averageDurationMs: number | null;
}

/** One summary row's tokens by its accounting, and whether that is only a lower bound (audit A15-03). */
export function usageRowTokens(row: Pick<PlatformMerchantUsageSummary, 'inputTokens' | 'outputTokens' | 'cachedInputTokens' | 'cacheWriteTokens' | 'inputIncludesCached'>): { tokens: number; lowerBound: boolean } {
    const cache = row.cachedInputTokens + row.cacheWriteTokens;
    return { tokens: row.inputTokens + row.outputTokens + (row.inputIncludesCached === false ? cache : 0), lowerBound: cache > 0 && row.inputIncludesCached === undefined };
}

/** Exact window totals from the server aggregates (one currency). */
export function usageProviderTotals(rows: readonly PlatformMerchantUsageSummary[], currency: string): UsageProviderTotals {
    const total: UsageProviderTotals = { requests: 0, completed: 0, failed: 0, chargedMicros: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, totalTokens: 0, tokensLowerBound: false, failovers: 0, averageDurationMs: null };
    let weighted = 0, samples = 0;
    for (const row of rows) {
        if (row.currency !== currency) continue;
        total.requests += row.requestCount;
        total.completed += row.completedCount;
        total.failed += row.failedCount;
        total.chargedMicros += row.chargedMicros;
        total.inputTokens += row.inputTokens;
        total.outputTokens += row.outputTokens;
        total.cachedTokens += row.cachedInputTokens;
        total.cacheWriteTokens += row.cacheWriteTokens;
        const tokens = usageRowTokens(row);
        total.totalTokens += tokens.tokens;
        total.tokensLowerBound ||= tokens.lowerBound;
        total.failovers += row.failoverCount;
        if (row.averageDurationMs !== null && row.durationSampleCount > 0) {
            weighted += row.averageDurationMs * row.durationSampleCount;
            samples += row.durationSampleCount;
        }
    }
    total.averageDurationMs = samples > 0 ? Math.round(weighted / samples) : null;
    return total;
}

/**
 * Cache hit rate from the server aggregates alone (Settings summary): only
 * rows whose tariff accounting is known contribute, as in `usageCacheParts`.
 */
export function usageProviderCacheRate(rows: readonly PlatformMerchantUsageSummary[], currency: string): number | null {
    let hit = 0, total = 0;
    for (const row of rows) {
        if (row.currency !== currency || typeof row.inputIncludesCached !== 'boolean') continue;
        if (row.inputIncludesCached && row.cachedInputTokens > row.inputTokens) continue;
        hit += row.cachedInputTokens;
        total += row.inputIncludesCached ? row.inputTokens : row.inputTokens + row.cachedInputTokens + row.cacheWriteTokens;
    }
    return usageRatio(hit, total);
}

/** USD first (the platform wallet currency), then any other currency seen. */
export function usagePrimaryCurrency(currencies: Iterable<string>): string {
    const all = [...new Set(currencies)].filter(Boolean).sort();
    return all.includes('USD') ? 'USD' : all[0] || 'USD';
}
