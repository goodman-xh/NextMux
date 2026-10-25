export type PublicMerchantSort = 'id' | 'quality' | 'authenticity' | 'availability' | 'latency' | 'multiplier';
export type PublicMerchantCapability = 'all' | 'coding' | 'reasoning' | 'image' | 'video' | 'audio' | 'music_generation' | 'transcription' | '3d';
export interface PublicMerchantMeasurement {
    readonly state: 'measured' | 'pending' | 'unknown' | 'stale';
    readonly reason?: 'no_feedback' | 'measurement_not_enabled' | 'awaiting_samples' | 'samples_expired';
    readonly sampleCount: number;
    readonly observedAt?: number;
}
export interface PublicMerchantStoreProfile {
    /** Plain text only: render as text, never HTML or Markdown. */
    readonly storeTagline?: string;
    /** Plain text, with at most two consecutive line breaks. */
    readonly storeDescription?: string;
}

export interface PublicMerchantIdentity extends PublicMerchantStoreProfile {
    readonly id: string;
    readonly name: string;
    readonly publicCode?: string;
    readonly metrics?: {
        /** Observed positive feedback percentage, 0–100; absent is not zero. */
        readonly quality?: number;
        /** Mean identity score of the relay's models that have evidence, 0–100; absent is unknown, not zero. */
        readonly authenticity?: number;
        /** Actual successful probe fraction, 0–1; absent is not zero. */
        readonly availability?: number;
        readonly latencyMs?: number;
        readonly multiplierBps?: number;
    };
    readonly measurement?: { readonly quality: PublicMerchantMeasurement; readonly authenticity?: PublicMerchantMeasurement; readonly availability: PublicMerchantMeasurement; readonly latency: PublicMerchantMeasurement };
    readonly stats?: { readonly discoveredCount: number; readonly executableCount: number };
    /** Mean multiplier over the merchant's executable multiplier-priced offerings (model × API); null when none. */
    readonly averageMultiplierBps?: number | null;
    /** Offerings sold by official price × multiplier, and at the merchant's own price. */
    readonly pricingModeCounts?: { readonly multiplier: number; readonly merchantPrice: number };
    readonly outputCategories?: readonly string[];
    readonly capabilities?: readonly string[];
    readonly apiStatus?: { readonly state: 'ready' | 'refreshing' | 'degraded' | 'unavailable'; readonly lastCheckedAt?: number; readonly reason?: 'discovery_pending' | 'discovery_failed' | 'no_current_validation' };
}

export interface PublicMerchantDirectoryQuery {
    readonly query?: string;
    readonly after?: string;
    readonly before?: string;
    readonly sort?: PublicMerchantSort;
    readonly direction?: 'asc' | 'desc';
    readonly capability?: PublicMerchantCapability;
    readonly merchantIds?: readonly string[];
}

export interface PublicMerchantDirectoryPage {
    readonly merchants: readonly PublicMerchantIdentity[];
    readonly previousCursor?: string;
    readonly nextCursor?: string;
    readonly measuredAt: string;
    readonly totalCount?: number;
    readonly sort?: PublicMerchantSort;
    readonly direction?: 'asc' | 'desc';
    readonly capabilityScope?: 'executable_offerings';
}

const merchantIdentity = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const sorts: readonly string[] = ['id', 'quality', 'authenticity', 'availability', 'latency', 'multiplier'];
const capabilities: readonly string[] = ['all', 'coding', 'reasoning', 'image', 'video', 'audio', 'music_generation', 'transcription', '3d'];

/** Bound untrusted public copy again at the desktop boundary, counting Unicode code points. */
export function normalizePublicMerchantStoreProfile(value: { readonly storeTagline?: unknown; readonly storeDescription?: unknown }): PublicMerchantStoreProfile {
    const text = (input: unknown, limit: number, multiline: boolean): string | undefined => {
        if (typeof input !== 'string') return undefined;
        let normalized = input.replace(/\r\n?/g, '\n').replace(/[\u2028\u2029]/g, '\n')
            .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '');
        normalized = multiline
            ? normalized.replace(/[^\S\n]+/gu, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n')
            : normalized.replace(/\s+/gu, ' ');
        // Keep markup literal: neither HTML nor Markdown is parsed or made interactive here.
        return Array.from(normalized.trim()).slice(0, limit).join('').trim() || undefined;
    };
    const storeTagline = text(value.storeTagline, 60, false);
    const storeDescription = text(value.storeDescription, 600, true);
    return { ...(storeTagline ? { storeTagline } : {}), ...(storeDescription ? { storeDescription } : {}) };
}

export const validPublicMerchantCursor = (value: unknown): value is string => typeof value === 'string'
    && (merchantIdentity.test(value) || /^md1_[A-Za-z0-9_-]{1,1020}$/.test(value));

export function publicMerchantDirectoryParameters(input: PublicMerchantDirectoryQuery = {}): URLSearchParams {
    if (!input || typeof input !== 'object' || Array.isArray(input)
        || input.query !== undefined && typeof input.query !== 'string'
        || input.after !== undefined && typeof input.after !== 'string'
        || input.before !== undefined && typeof input.before !== 'string') throw new Error('PUBLIC_MERCHANT_QUERY_INVALID');
    const query = typeof input.query === 'string' ? input.query.trim().normalize('NFKC') : '';
    if (query.length > 160 || /[\u0000-\u001f\u007f]/u.test(query)
        || input.after && !validPublicMerchantCursor(input.after) || input.before && !validPublicMerchantCursor(input.before)
        || input.after && input.before || input.sort !== undefined && !sorts.includes(input.sort)
        || input.direction !== undefined && !['asc', 'desc'].includes(input.direction)
        || input.capability !== undefined && !capabilities.includes(input.capability)
        || input.merchantIds !== undefined && (!Array.isArray(input.merchantIds) || input.merchantIds.length > 100
            || input.merchantIds.some(id => typeof id !== 'string' || !merchantIdentity.test(id)))) throw new Error('PUBLIC_MERCHANT_QUERY_INVALID');
    const params = new URLSearchParams({ limit: '100' });
    if (query) params.set('q', query);
    if (input.after) params.set('after', input.after);
    if (input.before) params.set('before', input.before);
    if (input.sort) params.set('sort', input.sort);
    if (input.direction) params.set('direction', input.direction);
    if (input.capability && input.capability !== 'all') params.set('capability', input.capability);
    for (const id of [...new Set(input.merchantIds || [])].sort()) params.append('merchantId', id);
    return params;
}

/** Whitelist the public contract even if an upstream deployment adds fields. */
export function normalizePublicMerchantDirectory(value: unknown): PublicMerchantDirectoryPage {
    const page = value as Partial<PublicMerchantDirectoryPage> | null;
    if (!page || !Array.isArray(page.merchants) || page.merchants.length > 100
        || typeof page.measuredAt !== 'string' || !Number.isFinite(Date.parse(page.measuredAt))) throw new Error('PUBLIC_MERCHANT_DIRECTORY_INVALID');
    const seen = new Set<string>();
    const merchants = page.merchants.map(row => {
        if (!row || typeof row.id !== 'string' || !merchantIdentity.test(row.id)
            || typeof row.name !== 'string' || row.name.length > 160 || seen.has(row.id)
            || row.publicCode !== undefined && (typeof row.publicCode !== 'string' || !/^RLY-[A-F0-9]{16}$/.test(row.publicCode))) throw new Error('PUBLIC_MERCHANT_DIRECTORY_INVALID');
        seen.add(row.id);
        const metrics = row.metrics;
        const measured = (value: unknown, max = Number.MAX_SAFE_INTEGER): number | undefined =>
            typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : undefined;
        const measurement = row.measurement;
        const normalizeMeasurement = (entry: PublicMerchantMeasurement): PublicMerchantMeasurement => {
            if (!entry || !['measured', 'pending', 'unknown', 'stale'].includes(entry.state) || !Number.isSafeInteger(entry.sampleCount) || entry.sampleCount < 0
                || entry.reason !== undefined && !['no_feedback', 'measurement_not_enabled', 'awaiting_samples', 'samples_expired'].includes(entry.reason)
                || entry.observedAt !== undefined && measured(entry.observedAt) === undefined) throw new Error('PUBLIC_MERCHANT_DIRECTORY_INVALID');
            return { state: entry.state, sampleCount: entry.sampleCount, ...(entry.reason ? { reason: entry.reason } : {}), ...(entry.observedAt !== undefined ? { observedAt: entry.observedAt } : {}) };
        };
        const strings = (value: readonly string[]): string[] => {
            if (!Array.isArray(value) || value.length > 64 || value.some(item => typeof item !== 'string' || item.length > 100)) throw new Error('PUBLIC_MERCHANT_DIRECTORY_INVALID');
            return [...new Set(value)];
        };
        if (row.stats && (!Number.isSafeInteger(row.stats.discoveredCount) || row.stats.discoveredCount < 0 || !Number.isSafeInteger(row.stats.executableCount) || row.stats.executableCount < 0)
            || row.apiStatus && (!['ready', 'refreshing', 'degraded', 'unavailable'].includes(row.apiStatus.state)
                || row.apiStatus.lastCheckedAt !== undefined && measured(row.apiStatus.lastCheckedAt) === undefined
                || row.apiStatus.reason !== undefined && !['discovery_pending', 'discovery_failed', 'no_current_validation'].includes(row.apiStatus.reason))) throw new Error('PUBLIC_MERCHANT_DIRECTORY_INVALID');
        return { id: row.id, name: row.name || row.publicCode || '', ...(row.publicCode ? { publicCode: row.publicCode } : {}),
            ...normalizePublicMerchantStoreProfile(row),
            ...(row.stats ? { stats: { discoveredCount: row.stats.discoveredCount, executableCount: row.stats.executableCount } } : {}),
            ...(row.averageMultiplierBps === null ? { averageMultiplierBps: null } : measured(row.averageMultiplierBps) !== undefined ? { averageMultiplierBps: row.averageMultiplierBps } : {}),
            ...(row.pricingModeCounts && Number.isSafeInteger(row.pricingModeCounts.multiplier) && row.pricingModeCounts.multiplier >= 0
                && Number.isSafeInteger(row.pricingModeCounts.merchantPrice) && row.pricingModeCounts.merchantPrice >= 0
                ? { pricingModeCounts: { multiplier: row.pricingModeCounts.multiplier, merchantPrice: row.pricingModeCounts.merchantPrice } } : {}),
            ...(row.outputCategories ? { outputCategories: strings(row.outputCategories) } : {}), ...(row.capabilities ? { capabilities: strings(row.capabilities) } : {}),
            ...(row.apiStatus ? { apiStatus: { state: row.apiStatus.state, ...(row.apiStatus.reason ? { reason: row.apiStatus.reason } : {}), ...(row.apiStatus.lastCheckedAt !== undefined ? { lastCheckedAt: row.apiStatus.lastCheckedAt } : {}) } } : {}),
            ...(metrics && typeof metrics === 'object' ? { metrics: {
            quality: measured(metrics.quality, 100), ...(measured(metrics.authenticity, 100) !== undefined ? { authenticity: measured(metrics.authenticity, 100) } : {}), availability: measured(metrics.availability, 1),
            latencyMs: measured(metrics.latencyMs), multiplierBps: measured(metrics.multiplierBps)
        } } : {}), ...(measurement ? { measurement: { quality: normalizeMeasurement(measurement.quality), ...(measurement.authenticity ? { authenticity: normalizeMeasurement(measurement.authenticity) } : {}),
            availability: normalizeMeasurement(measurement.availability), latency: normalizeMeasurement(measurement.latency) } } : {}) };
    });
    for (const cursor of [page.previousCursor, page.nextCursor]) {
        if (cursor !== undefined && !validPublicMerchantCursor(cursor)) throw new Error('PUBLIC_MERCHANT_DIRECTORY_INVALID');
    }
    if (page.totalCount !== undefined && (!Number.isSafeInteger(page.totalCount) || page.totalCount < merchants.length)
        || page.sort !== undefined && !sorts.includes(page.sort) || page.direction !== undefined && !['asc', 'desc'].includes(page.direction)
        || page.capabilityScope !== undefined && page.capabilityScope !== 'executable_offerings') throw new Error('PUBLIC_MERCHANT_DIRECTORY_INVALID');
    return { merchants, measuredAt: page.measuredAt,
        ...(page.totalCount !== undefined ? { totalCount: page.totalCount } : {}), ...(page.sort ? { sort: page.sort } : {}),
        ...(page.direction ? { direction: page.direction } : {}), ...(page.capabilityScope ? { capabilityScope: page.capabilityScope } : {}),
        ...(page.previousCursor ? { previousCursor: page.previousCursor } : {}),
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) };
}
