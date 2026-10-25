import { relayApprovalRating } from '../common/nextmux-relay-evidence';

export type RelayMarketplaceSort =
    | 'recommended'
    | 'rating'
    | 'multiplier'
    | 'estimated_price'
    | 'availability'
    | 'latency'
    | 'api_authenticity'
    | 'model_coverage';
export type RelayCapability = typeof RELAY_CAPABILITIES[number];
export type RelayApiVerificationStatus = 'verified' | 'partial' | 'unverified' | 'failed';

export const RELAY_CAPABILITIES = [
    'language', 'image', 'video', 'audio', 'music', 'audio_drama', 'silent_drama'
] as const;

export interface RelayMarketplaceMerchant {
    readonly id: string;
    readonly name: string;
    /** Platform-curated order. Positive ranks are pinned ahead of organic recommendations. */
    readonly recommendedRank?: number | null;
    readonly likes?: number | null;
    readonly dislikes?: number | null;
    readonly capabilities?: readonly RelayCapability[] | null;
    readonly modelIds?: readonly string[] | null;
    readonly multiplierBps?: number | null;
    readonly estimatedPrice?: RelayEstimatedPrice | null;
    readonly availability?: number | null;
    readonly latencyMs?: number | null;
    readonly apiVerification?: RelayApiVerification | null;
}

export interface RelayEstimatedPrice {
    readonly amountMicros: number;
    readonly currency: string;
    readonly unitKey: string;
}

export interface RelayApiVerification {
    readonly status: RelayApiVerificationStatus;
    readonly confidence?: number | null;
    readonly sampleCount?: number | null;
}

export interface RelayMarketplaceFilters {
    readonly capabilities?: readonly RelayCapability[];
    readonly capabilityMatch?: 'any' | 'all';
    readonly modelIds?: readonly string[];
    readonly modelMatch?: 'any' | 'all';
    readonly minModelCount?: number;
    readonly minRating?: number;
    readonly maxMultiplierBps?: number;
    readonly maxEstimatedPriceMicros?: number;
    readonly estimatedPriceCurrency?: string;
    readonly minAvailability?: number;
    readonly maxLatencyMs?: number;
    readonly apiVerification?: readonly RelayApiVerificationStatus[];
    readonly minApiConfidence?: number;
}

export interface RelayMarketplaceQuery {
    readonly sort?: RelayMarketplaceSort;
    readonly filters?: RelayMarketplaceFilters;
    /** Required for meaningful estimated-price ordering when a catalog mixes currencies. */
    readonly estimatedPriceCurrency?: string;
    /** BCP 47 locale used only for numeric display strings; invalid locales fall back safely. */
    readonly locale?: string;
}

export interface RelayMarketplaceDisplayData {
    readonly rating: string;
    readonly ratingState: 'rated' | 'unrated';
    readonly recommendation: string;
    readonly votes: string;
    /** Display threshold only; not a statistical confidence estimate. */
    readonly fewSamples: boolean;
    readonly multiplier?: string;
    readonly estimatedPrice?: {
        readonly amount: string;
        readonly currency: string;
        readonly unitKey: string;
    };
    readonly availability?: string;
    readonly latency?: { readonly value: string; readonly unitKey: 'millisecond' };
    readonly apiVerificationKey?: string;
    readonly modelCount: string;
    readonly capabilityKeys: readonly string[];
}

export interface RelayMarketplaceRow {
    readonly id: string;
    readonly name: string;
    readonly merchantNumber: string;
    readonly recommendedRank?: number;
    readonly capabilities: readonly RelayCapability[];
    readonly modelCount: number;
    readonly multiplierBps?: number;
    readonly estimatedPrice?: RelayEstimatedPrice;
    readonly availability?: number;
    readonly latencyMs?: number;
    readonly apiVerification?: {
        readonly status: RelayApiVerificationStatus;
        readonly confidence?: number;
        readonly sampleCount: number;
    };
    /** Balanced 0-10 recommendation score; unlike rating, this is not a user-vote score. */
    readonly recommendationScore: number;
    readonly display: RelayMarketplaceDisplayData;
    readonly rating: {
        /** The public approval (relayApprovalRating, 50 virtual positive votes) on a 0–10 scale. Absent when there are no votes. */
        readonly score?: number;
        /** Bayesian score used only for ranking and recommendation; never present as the public rating. */
        readonly confidenceAdjustedScore: number;
        readonly likes: number;
        readonly dislikes: number;
        readonly votes: number;
    };
}

// Twenty virtual votes keep a handful of likes from beating sustained evidence.
const DEFAULT_POSITIVE_PRIOR = 0.7;
const DEFAULT_PRIOR_WEIGHT = 20;

export function relayMerchantNumber(id: string): string {
    let hash = 14_695_981_039_346_656_037n;
    for (const character of id.trim().toLowerCase()) {
        hash ^= BigInt(character.codePointAt(0) ?? 0);
        hash = BigInt.asUintN(64, hash * 1_099_511_628_211n);
    }
    return `RLY-${hash.toString(36).toUpperCase().padStart(13, '0')}`;
}

function voteCount(value: number | null | undefined): number {
    return Number.isFinite(value) && (value ?? 0) > 0 ? Math.floor(value as number) : 0;
}

function finiteInRange(
    value: number | null | undefined,
    minimum: number,
    maximum = Number.MAX_SAFE_INTEGER
): number | undefined {
    return Number.isFinite(value) && (value as number) >= minimum && (value as number) <= maximum
        ? value as number : undefined;
}

function positiveInteger(value: number | null | undefined): number | undefined {
    return Number.isFinite(value) && (value as number) > 0 ? Math.floor(value as number) : undefined;
}

function estimatedPriceFor(value: RelayEstimatedPrice | null | undefined): RelayEstimatedPrice | undefined {
    const amountMicros = finiteInRange(value?.amountMicros, 0);
    const currency = value?.currency.trim().toUpperCase();
    const unitKey = value?.unitKey.trim();
    return amountMicros !== undefined && currency && unitKey
        ? { amountMicros, currency, unitKey } : undefined;
}

function apiVerificationFor(
    value: RelayApiVerification | null | undefined
): RelayMarketplaceRow['apiVerification'] {
    if (!value || !(['verified', 'partial', 'unverified', 'failed'] as const).includes(value.status)) {
        return undefined;
    }
    return {
        status: value.status,
        confidence: finiteInRange(value.confidence, 0, 1),
        sampleCount: voteCount(value.sampleCount)
    };
}

function ratingFor(merchant: RelayMarketplaceMerchant): RelayMarketplaceRow['rating'] {
    const likes = voteCount(merchant.likes);
    const dislikes = voteCount(merchant.dislikes);
    const votes = likes + dislikes;
    const posterior = (likes + DEFAULT_POSITIVE_PRIOR * DEFAULT_PRIOR_WEIGHT)
        / (votes + DEFAULT_PRIOR_WEIGHT);
    return {
        score: votes > 0 ? relayApprovalRating(likes, votes) / 10 : undefined,
        confidenceAdjustedScore: Math.round(posterior * 100) / 10,
        likes,
        dislikes,
        votes
    };
}

function normalized(value: string): string {
    return value.trim().toLowerCase();
}

function uniqueNormalized(values: readonly string[] | null | undefined): readonly string[] {
    return [...new Set((values ?? []).map(normalized).filter(Boolean))];
}

function capabilitiesFor(merchant: RelayMarketplaceMerchant): readonly RelayCapability[] {
    const available = new Set(merchant.capabilities ?? []);
    return RELAY_CAPABILITIES.filter(capability => available.has(capability));
}

function matchesRequested(
    available: ReadonlySet<string>,
    requested: readonly string[] | undefined,
    mode: 'any' | 'all' = 'all'
): boolean {
    const wanted = uniqueNormalized(requested);
    if (!wanted.length) return true;
    return mode === 'any'
        ? wanted.some(value => available.has(value))
        : wanted.every(value => available.has(value));
}

function atLeast(value: number | undefined, minimum: number | undefined): boolean {
    return minimum === undefined || value !== undefined && value >= minimum;
}

function atMost(value: number | undefined, maximum: number | undefined): boolean {
    return maximum === undefined || value !== undefined && value <= maximum;
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function apiAuthenticityScore(value: RelayMarketplaceRow['apiVerification']): number | undefined {
    if (!value) return undefined;
    const statusScore: Record<RelayApiVerificationStatus, number> = {
        verified: 1,
        partial: 0.65,
        unverified: 0.25,
        failed: 0
    };
    return statusScore[value.status] * (value.confidence ?? 0.5);
}

function recommendationScore(row: Pick<
    RelayMarketplaceRow,
    'rating' | 'availability' | 'latencyMs' | 'multiplierBps' | 'apiVerification' | 'modelCount'
>): number {
    const availability = row.availability ?? 0;
    const latency = row.latencyMs === undefined ? 0 : 1 / (1 + row.latencyMs / 1_000);
    const cost = row.multiplierBps === undefined ? 0 : clamp01(2 - row.multiplierBps / 10_000);
    const authenticity = apiAuthenticityScore(row.apiVerification) ?? 0;
    const coverage = clamp01(row.modelCount / 20);
    // Quality/reliability lead; latency, cost, authenticity and breadth remain independently sortable.
    const normalized = row.rating.confidenceAdjustedScore / 10 * 0.35
        + availability * 0.25
        + latency * 0.15
        + cost * 0.1
        + authenticity * 0.1
        + coverage * 0.05;
    return Math.round(normalized * 1_000) / 100;
}

function formatNumber(locale: string | undefined, value: number, options: Intl.NumberFormatOptions): string {
    try {
        return new Intl.NumberFormat(locale, options).format(value);
    } catch {
        return new Intl.NumberFormat('en-US', options).format(value);
    }
}

function displayFor(
    row: Omit<RelayMarketplaceRow, 'display'>,
    locale: string | undefined
): RelayMarketplaceDisplayData {
    return {
        rating: row.rating.score === undefined ? '—' : formatNumber(locale, row.rating.score, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
        ratingState: row.rating.score === undefined ? 'unrated' : 'rated',
        recommendation: formatNumber(locale, row.recommendationScore, { minimumFractionDigits: 1, maximumFractionDigits: 2 }),
        votes: formatNumber(locale, row.rating.votes, { maximumFractionDigits: 0 }),
        fewSamples: row.rating.votes < 20,
        // Two decimals, display only; a paid quote under 0.005× reads "<0.01×", never "0.00×".
        multiplier: row.multiplierBps === undefined ? undefined
            : row.multiplierBps > 0 && row.multiplierBps < 50
                ? `<${formatNumber(locale, 0.01, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`
                : `${formatNumber(locale, row.multiplierBps / 10_000, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`,
        estimatedPrice: row.estimatedPrice ? {
            amount: formatNumber(locale, row.estimatedPrice.amountMicros / 1_000_000, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 6
            }),
            currency: row.estimatedPrice.currency,
            unitKey: row.estimatedPrice.unitKey
        } : undefined,
        availability: row.availability === undefined ? undefined : formatNumber(locale, row.availability, {
            style: 'percent',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }),
        latency: row.latencyMs === undefined ? undefined : {
            value: formatNumber(locale, row.latencyMs, { maximumFractionDigits: 2 }),
            unitKey: 'millisecond'
        },
        apiVerificationKey: row.apiVerification
            ? `relayMarketplace.apiVerification.${row.apiVerification.status}` : undefined,
        modelCount: formatNumber(locale, row.modelCount, { maximumFractionDigits: 0 }),
        capabilityKeys: row.capabilities.map(capability => `relayMarketplace.capability.${capability}`)
    };
}

function compareRatings(
    left: RelayMarketplaceRow['rating'],
    right: RelayMarketplaceRow['rating']
): number {
    // Unrated merchants are always below merchants with observed votes. Among
    // rated merchants, use the confidence-adjusted value so a tiny sample of
    // perfect votes cannot outrank sustained evidence.
    const observed = compareOptional(left.score, right.score, 'descending');
    if (observed !== 0 && left.score !== undefined && right.score !== undefined) {
        return compareOptional(left.confidenceAdjustedScore, right.confidenceAdjustedScore, 'descending') || observed;
    }
    if (left.score === undefined || right.score === undefined) return observed;
    return compareOptional(left.confidenceAdjustedScore, right.confidenceAdjustedScore, 'descending');
}

function compareOptional(
    left: number | undefined,
    right: number | undefined,
    direction: 'ascending' | 'descending'
): number {
    if (left === undefined) return right === undefined ? 0 : 1;
    if (right === undefined) return -1;
    return direction === 'ascending' ? left - right : right - left;
}

export function rankRelayMarketplace(
    merchants: readonly RelayMarketplaceMerchant[],
    query: RelayMarketplaceQuery = {}
): readonly RelayMarketplaceRow[] {
    const filters = query.filters;
    return merchants.map((merchant, index) => {
        const capabilities = capabilitiesFor(merchant);
        const modelIds = uniqueNormalized(merchant.modelIds);
        const estimatedPrice = estimatedPriceFor(merchant.estimatedPrice);
        const row: Omit<RelayMarketplaceRow, 'recommendationScore' | 'display'> & {
            readonly modelIds: ReadonlySet<string>;
            readonly index: number;
        } = {
            id: merchant.id,
            name: merchant.name,
            merchantNumber: relayMerchantNumber(merchant.id),
            recommendedRank: positiveInteger(merchant.recommendedRank),
            capabilities,
            modelCount: modelIds.length,
            rating: ratingFor(merchant),
            multiplierBps: finiteInRange(merchant.multiplierBps, 0),
            estimatedPrice,
            availability: finiteInRange(merchant.availability, 0, 1),
            latencyMs: finiteInRange(merchant.latencyMs, 0),
            apiVerification: apiVerificationFor(merchant.apiVerification),
            modelIds: new Set(modelIds),
            index
        };
        const scored = { ...row, recommendationScore: recommendationScore(row) };
        return { ...scored, display: displayFor(scored, query.locale) };
    }).filter(row => (filters?.minModelCount === undefined || row.modelCount >= filters.minModelCount)
        && matchesRequested(new Set(row.capabilities), filters?.capabilities, filters?.capabilityMatch)
        && matchesRequested(row.modelIds, filters?.modelIds, filters?.modelMatch)
        && atLeast(row.rating.score, filters?.minRating)
        && atMost(row.multiplierBps, filters?.maxMultiplierBps)
        && (filters?.maxEstimatedPriceMicros === undefined || Boolean(row.estimatedPrice
            && row.estimatedPrice.amountMicros <= filters.maxEstimatedPriceMicros
            && (!filters.estimatedPriceCurrency
                || row.estimatedPrice.currency === filters.estimatedPriceCurrency.trim().toUpperCase())))
        && atLeast(row.availability, filters?.minAvailability)
        && atMost(row.latencyMs, filters?.maxLatencyMs)
        && (!filters?.apiVerification?.length
            || Boolean(row.apiVerification && filters.apiVerification.includes(row.apiVerification.status)))
        && atLeast(row.apiVerification?.confidence, filters?.minApiConfidence))
        .sort((left, right) => {
            if (query.sort === 'recommended' || query.sort === undefined) {
                const leftPromoted = left.recommendedRank !== undefined;
                const rightPromoted = right.recommendedRank !== undefined;
                const promoted = Number(rightPromoted) - Number(leftPromoted)
                    || (left.recommendedRank ?? Number.MAX_SAFE_INTEGER) - (right.recommendedRank ?? Number.MAX_SAFE_INTEGER);
                if (promoted) return promoted;
            }
            const currency = query.estimatedPriceCurrency?.trim().toUpperCase();
            const estimatedPrice = (row: typeof left): number | undefined => row.estimatedPrice
                && (!currency || row.estimatedPrice.currency === currency)
                ? row.estimatedPrice.amountMicros : undefined;
            let primary: number;
            switch (query.sort ?? 'recommended') {
                case 'rating': primary = compareRatings(left.rating, right.rating); break;
                case 'multiplier':
                    primary = compareOptional(left.multiplierBps, right.multiplierBps, 'ascending');
                    break;
                case 'estimated_price':
                    primary = compareOptional(estimatedPrice(left), estimatedPrice(right), 'ascending');
                    break;
                case 'availability':
                    primary = compareOptional(left.availability, right.availability, 'descending');
                    break;
                case 'latency': primary = compareOptional(left.latencyMs, right.latencyMs, 'ascending'); break;
                case 'api_authenticity':
                    primary = compareOptional(
                        apiAuthenticityScore(left.apiVerification),
                        apiAuthenticityScore(right.apiVerification),
                        'descending'
                    );
                    break;
                case 'model_coverage':
                    primary = compareOptional(left.modelCount, right.modelCount, 'descending');
                    break;
                default:
                    primary = compareOptional(left.recommendationScore, right.recommendationScore, 'descending');
            }
            if (primary) return primary;
            const recommendation = query.sort === 'recommended' || query.sort === undefined
                ? 0 : right.recommendationScore - left.recommendationScore;
            return recommendation || compareRatings(left.rating, right.rating) || left.index - right.index;
        })
        .map(({ index: _index, modelIds: _modelIds, ...row }) => row);
}
