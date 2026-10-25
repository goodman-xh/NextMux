/** Amount in currency micros per unitSize; token metrics are singular and normally use 1,000,000 units. */
export interface PublicPriceRate { readonly unitSize: number; readonly amountMicros: number; }
export interface PublicOfficialPriceRate extends PublicPriceRate {
    readonly sourceType: 'catalog_reference' | 'admin_override' | 'official_variant' | 'official_charge_contract' | 'official_media_output_sku' | 'official_media_tier';
    readonly sourceUrl?: string;
    readonly referencePriceId?: string;
    /** The platform's immutable official price contract the rate was read from. */
    readonly chargeContractId?: string;
    readonly referencePriceVariantId?: string;
    readonly dimensions?: Readonly<Record<string, string | number>>;
}
export interface PublicPriceDetails {
    readonly status: 'complete' | 'incomplete' | 'legacy';
    readonly currency: string;
    readonly quoteAt: number;
    readonly multiplierBps: number | null;
    readonly dimensions: readonly {
        readonly metric: string;
        readonly currency: string;
        readonly official: PublicOfficialPriceRate | null;
        readonly user: PublicPriceRate | null;
    }[];
}
/** Prices are quote evidence, not a renderer authorization to charge money. */
export function normalizePublicPriceDetails(value: unknown): PublicPriceDetails {
    const row = value as PublicPriceDetails | null;
    const invalid = (): never => { throw new Error('PUBLIC_PRICE_DETAILS_INVALID'); };
    const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
    const rate = (value: PublicPriceRate | null): PublicPriceRate | null => value === null ? null : value && integer(value.unitSize) && value.unitSize > 0 && integer(value.amountMicros)
        ? { unitSize: value.unitSize, amountMicros: value.amountMicros } : invalid();
    if (!row || !['complete', 'incomplete', 'legacy'].includes(row.status) || !/^[A-Z]{3}$/.test(row.currency)
        || !integer(row.quoteAt) || row.multiplierBps !== null && !integer(row.multiplierBps) || !Array.isArray(row.dimensions) || row.dimensions.length > 16) return invalid();
    const seen = new Set<string>();
    const dimensions = row.dimensions.map(dimension => {
        if (!dimension || !['input_token', 'cached_input_token', 'cache_write_token', 'output_token', 'request', 'image', 'image_output_token', 'video_second', 'video_input_image', 'audio_second', 'audio_character'].includes(dimension.metric)
            || dimension.currency !== row.currency || seen.has(dimension.metric)) return invalid();
        seen.add(dimension.metric);
        const officialRate = rate(dimension.official), user = rate(dimension.user);
        if (dimension.metric === 'video_input_image' && [officialRate, user].some(value => value && value.unitSize !== 1)) return invalid();
        let official: PublicOfficialPriceRate | null = null;
        if (officialRate && dimension.official) {
            const source = dimension.official;
            if (!['catalog_reference', 'admin_override', 'official_variant', 'official_charge_contract', 'official_media_output_sku', 'official_media_tier'].includes(source.sourceType) || source.referencePriceId !== undefined && (typeof source.referencePriceId !== 'string' || source.referencePriceId.length > 160)
                || source.chargeContractId !== undefined && (typeof source.chargeContractId !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(source.chargeContractId))
                || source.sourceUrl !== undefined && (typeof source.sourceUrl !== 'string' || source.sourceUrl.length > 2048 || !source.sourceUrl.startsWith('https://'))) return invalid();
            official = { ...officialRate, sourceType: source.sourceType, ...(source.sourceUrl ? { sourceUrl: source.sourceUrl } : {}), ...(source.referencePriceId ? { referencePriceId: source.referencePriceId } : {}),
                ...(source.chargeContractId ? { chargeContractId: source.chargeContractId } : {}) };
            if (source.sourceType === 'official_variant') {
                // A public ceiling can combine equivalent variants (for example
                // Claude cache TTLs), so it need not name a single variant ID.
                let url: URL;
                try { url = new URL(source.sourceUrl || ''); } catch { return invalid(); }
                if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) return invalid();
                if ((source.referencePriceVariantId === undefined) !== (source.dimensions === undefined)) return invalid();
                if (source.referencePriceVariantId !== undefined) {
                    if (typeof source.referencePriceVariantId !== 'string' || !source.referencePriceVariantId.length || source.referencePriceVariantId.length > 160
                        || !source.dimensions || typeof source.dimensions !== 'object' || Array.isArray(source.dimensions)) return invalid();
                    const numericKeys = ['context_max_tokens', 'prompt_min_tokens', 'prompt_max_tokens', 'cache_ttl_seconds'];
                    const textKeys = ['api', 'inference_geo', 'region', 'service_tier', 'speed', 'cache_mode'];
                    const entries = Object.entries(source.dimensions);
                    if (!entries.length || entries.some(([key, value]) => numericKeys.includes(key)
                        ? !integer(value) || key !== 'prompt_min_tokens' && value === 0
                        : !textKeys.includes(key) || typeof value !== 'string' || !value.length || value.length > 100 || /[\u0000-\u001f\u007f]/u.test(value))) return invalid();
                    const { prompt_min_tokens: min, prompt_max_tokens: max, context_max_tokens: context } = source.dimensions;
                    if ((min === undefined) !== (max === undefined) || typeof min === 'number' && typeof max === 'number' && min > max
                        || typeof max === 'number' && typeof context === 'number' && max > context) return invalid();
                    official = { ...official, referencePriceVariantId: source.referencePriceVariantId, dimensions: Object.fromEntries(entries) as Record<string, string | number> };
                }
            }
        }
        return { metric: dimension.metric, currency: dimension.currency, official, user };
    });
    return { status: row.status, currency: row.currency, quoteAt: row.quoteAt, multiplierBps: row.multiplierBps, dimensions };
}
