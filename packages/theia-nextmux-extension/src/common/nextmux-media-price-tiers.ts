/**
 * Multi-tier image and video prices of a catalog offering (`offering.price.mediaTiers`,
 * platform contract v1, published on GET /api/catalog). Absent or null when the offering has
 * one flat price; the flat `imageEachMicros` / `videoSecondMicros` then stay the default
 * tier's customer price. Micros are USD × 1,000,000 per image (kind image) or per second
 * (kind video). Everything here is display-only: the gateway picks the billed tier.
 */

export type OfferingMediaTierQuality = 'low' | 'medium' | 'high' | 'standard' | 'hd';

export interface OfferingMediaTier {
    /** For example `medium_1024x1024` or `720p_audio`. */
    readonly id: string;
    readonly quality?: OfferingMediaTierQuality;
    /** Exact `WxH` for fixed-size models such as gpt-image-1. */
    readonly size?: string;
    /** `1K`/`2K`/`4K` for images, `480p`…`4k` for video. */
    readonly resolution?: string;
    readonly aspectRatio?: string;
    /** Video only: the tier includes generated audio. */
    readonly audio?: boolean;
    /** Official price per unit; null for merchant-only tiers. */
    readonly officialMicros: number | null;
    /** What the user pays per unit after multiplier and fee. */
    readonly customerMicros: number;
}

/**
 * Tokens billed beside each picture (USD micros per 1M tokens): the text prompt (with images on Gemini), the cached
 * prompt, and text/thinking output. `customerMicros` already includes the multiplier and the platform fee.
 */
export interface OfferingMediaTokenRate {
    readonly metric: 'input_token' | 'cached_input_token' | 'output_token';
    readonly modality: 'text' | 'text_image' | 'text_thinking';
    readonly officialMicros: number | null;
    readonly customerMicros: number | null;
}

export interface OfferingMediaTiers {
    readonly version: 1;
    readonly kind: 'image' | 'video';
    readonly unit: 'image' | 'second';
    readonly currency: string;
    readonly basis: 'official_multiplier' | 'merchant';
    readonly multiplierBps: number | null;
    readonly defaultTierId: string;
    readonly sourceUrl: string | null;
    /** YYYY-MM-DD of the last official price check. */
    readonly verifiedAt: string | null;
    /**
     * Video only: `output_size` — the requested output size picks the tier; `fixed` — this API format sends no
     * resolution, so every request is billed at `billedTierId` (e.g. Veo's 720p default on the Gemini format).
     */
    readonly requestTier?: 'output_size' | 'fixed';
    readonly billedTierId?: string;
    /** Token charges beside each picture (image kind), customer rates as published. */
    readonly tokenRates?: readonly OfferingMediaTokenRate[];
    readonly promptInputPerMillionMicros?: number;
    readonly cachedPromptInputPerMillionMicros?: number;
    readonly imageInputPerMillionMicros?: number;
    readonly textOutputPerMillionMicros?: number;
    readonly tiers: readonly OfferingMediaTier[];
}

const QUALITIES: ReadonlySet<string> = new Set(['low', 'medium', 'high', 'standard', 'hd']);
const TOKEN_METRICS: ReadonlySet<string> = new Set(['input_token', 'cached_input_token', 'output_token']);
const TOKEN_MODALITIES: ReadonlySet<string> = new Set(['text', 'text_image', 'text_thinking']);
const TOKEN_FIELDS = ['promptInputPerMillionMicros', 'cachedPromptInputPerMillionMicros', 'imageInputPerMillionMicros', 'textOutputPerMillionMicros'] as const;
const MAX_TIERS = 64;

function cleanText(value: unknown, max: number): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed && trimmed.length <= max && !/[\u0000-\u001f\u007f]/.test(trimmed) ? trimmed : undefined;
}

function micros(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Validated tiers, or undefined when the field is absent or does not follow the v1 contract. */
export function normalizeOfferingMediaTiers(value: unknown): OfferingMediaTiers | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const raw = value as Record<string, unknown>;
    if (raw.version !== 1 || (raw.kind !== 'image' && raw.kind !== 'video') || !Array.isArray(raw.tiers)) return undefined;
    const kind: 'image' | 'video' = raw.kind;
    if (raw.unit !== (kind === 'image' ? 'image' : 'second')) return undefined;
    const ids = new Set<string>();
    const tiers: OfferingMediaTier[] = [];
    for (const item of raw.tiers.slice(0, MAX_TIERS)) {
        if (!item || typeof item !== 'object') continue;
        const tier = item as Record<string, unknown>;
        const id = cleanText(tier.id, 64);
        // The platform publishes every sellable tier with its customer price (multiplier and fee included). A tier it
        // could not price comes without one and is not offered: an official × multiplier stand-in would leave out
        // the fee and offer a size the gateway refuses.
        const customerMicros = micros(tier.customerMicros);
        if (!id || ids.has(id) || customerMicros === undefined) continue;
        ids.add(id);
        const size = cleanText(tier.size, 16);
        const resolution = cleanText(tier.resolution, 8);
        const aspectRatio = cleanText(tier.aspectRatio, 8);
        tiers.push({
            id, customerMicros, officialMicros: micros(tier.officialMicros) ?? null,
            ...(typeof tier.quality === 'string' && QUALITIES.has(tier.quality) ? { quality: tier.quality as OfferingMediaTierQuality } : {}),
            ...(size && /^\d{2,5}x\d{2,5}$/i.test(size) ? { size: size.toLowerCase() } : {}),
            ...(resolution ? { resolution } : {}),
            ...(aspectRatio && /^\d{1,2}:\d{1,2}$/.test(aspectRatio) ? { aspectRatio } : {}),
            ...(kind === 'video' && typeof tier.audio === 'boolean' ? { audio: tier.audio } : {})
        });
    }
    if (!tiers.length) return undefined;
    const defaultTierId = cleanText(raw.defaultTierId, 64);
    const currency = cleanText(raw.currency, 8);
    const billedTierId = cleanText(raw.billedTierId, 64);
    const requestTier = kind !== 'video' ? undefined : raw.requestTier === 'fixed' && billedTierId && ids.has(billedTierId) ? 'fixed' as const
        : raw.requestTier === 'output_size' ? 'output_size' as const : undefined;
    // One rate per metric; a rate with neither price is dropped.
    const metrics = new Set<string>();
    const tokenRates = kind !== 'image' || !Array.isArray(raw.tokenRates) ? [] : raw.tokenRates.slice(0, 8).flatMap((item): OfferingMediaTokenRate[] => {
        const rate = item && typeof item === 'object' ? item as Record<string, unknown> : {};
        const metric = String(rate.metric), modality = String(rate.modality);
        const officialMicros = micros(rate.officialMicros) ?? null, customerMicros = micros(rate.customerMicros) ?? null;
        if (!TOKEN_METRICS.has(metric) || !TOKEN_MODALITIES.has(modality) || metrics.has(metric) || officialMicros === null && customerMicros === null) return [];
        metrics.add(metric);
        return [{ metric: metric as OfferingMediaTokenRate['metric'], modality: modality as OfferingMediaTokenRate['modality'], officialMicros, customerMicros }];
    });
    const tokenFields = kind !== 'image' ? {} : Object.fromEntries(TOKEN_FIELDS.flatMap(field => micros(raw[field]) === undefined ? [] : [[field, micros(raw[field])]]));
    return {
        version: 1, kind, unit: kind === 'image' ? 'image' : 'second',
        currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : 'USD',
        basis: raw.basis === 'merchant' ? 'merchant' : 'official_multiplier',
        multiplierBps: micros(raw.multiplierBps) ?? null,
        defaultTierId: defaultTierId && ids.has(defaultTierId) ? defaultTierId : tiers[0].id,
        sourceUrl: typeof raw.sourceUrl === 'string' && raw.sourceUrl.length <= 2048 && /^https:\/\//.test(raw.sourceUrl) ? raw.sourceUrl : null,
        verifiedAt: typeof raw.verifiedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.verifiedAt) ? raw.verifiedAt : null,
        ...(requestTier ? { requestTier } : {}),
        ...(requestTier === 'fixed' ? { billedTierId } : {}),
        ...(tokenRates.length ? { tokenRates } : {}),
        ...tokenFields,
        tiers
    };
}

export interface MediaTierLabelText {
    readonly quality: (quality: OfferingMediaTierQuality) => string;
    readonly audio: (withAudio: boolean) => string;
}

/** A tier's short label, e.g. "高质量 · 1024×1536" or "1080p · 16:9 · 有声". */
export function mediaTierLabel(tier: OfferingMediaTier, text: MediaTierLabelText): string {
    const parts = [
        tier.quality ? text.quality(tier.quality) : undefined,
        tier.size ? tier.size.replace('x', '×') : tier.resolution,
        tier.aspectRatio,
        tier.audio === undefined ? undefined : text.audio(tier.audio)
    ].filter((part): part is string => Boolean(part));
    return parts.length ? parts.join(' · ') : tier.id;
}

/**
 * Token fees billed on top of a tier image price. Official image sheets charge the text prompt per input token in
 * addition to the per-image tier, some also the cached prompt or image input, and text/thinking output (GPT Image 1.5,
 * Gemini image models); a relay passes them on at its multiplier. Micros per million tokens.
 */
export interface MediaTierInputRates {
    /** What the user pays per million text-prompt input tokens (merchant multiplier applied). */
    readonly promptPerMillionMicros?: number;
    readonly cachedPromptPerMillionMicros?: number;
    readonly imageInputPerMillionMicros?: number;
    /** Text (and, for Gemini, thinking) output tokens billed with each picture. */
    readonly textOutputPerMillionMicros?: number;
    readonly textOutputModality?: 'text' | 'text_thinking';
    /** The official rates the customer rates derive from, when the catalog publishes them. */
    readonly official: {
        readonly promptPerMillionMicros?: number;
        readonly cachedPromptPerMillionMicros?: number;
        readonly imageInputPerMillionMicros?: number;
        readonly textOutputPerMillionMicros?: number;
    };
}

type RateKind = 'prompt' | 'cached' | 'image' | 'output';
/** Customer fields (already multiplied), first the token-specific name, then the generic price dimension. */
const CUSTOMER_RATE_FIELDS: Readonly<Record<RateKind, readonly string[]>> = {
    prompt: ['promptInputPerMillionMicros', 'inputPerMillionMicros'],
    cached: ['cachedPromptInputPerMillionMicros', 'cachedInputPerMillionMicros'],
    image: ['imageInputPerMillionMicros', 'inputImagePerMillionMicros'],
    output: ['textOutputPerMillionMicros', 'outputPerMillionMicros']
};
const TOKEN_RATE_METRIC: Readonly<Partial<Record<RateKind, OfferingMediaTokenRate['metric']>>> = {
    prompt: 'input_token', cached: 'cached_input_token', output: 'output_token'
};

function firstMicros(source: unknown, keys: readonly string[]): number | undefined {
    if (!source || typeof source !== 'object') return undefined;
    for (const key of keys) {
        const value = micros((source as Record<string, unknown>)[key]);
        if (value !== undefined) return value;
    }
    return undefined;
}

function tokenRateOf(mediaTiers: unknown, metric: OfferingMediaTokenRate['metric'] | undefined): Record<string, unknown> | undefined {
    const rates = metric && mediaTiers && typeof mediaTiers === 'object' ? (mediaTiers as { readonly tokenRates?: unknown }).tokenRates : undefined;
    return Array.isArray(rates) ? rates.find(rate => rate && typeof rate === 'object' && (rate as Record<string, unknown>).metric === metric) : undefined;
}

/**
 * The additive token rates of a per-image priced offering. Customer rates are read as published — on
 * `price.mediaTiers` (its fields, then its `tokenRates`), then on `price` — and never multiplied again. Only when
 * no customer rate is published does a multiplier-priced offering pay the official rate × the merchant multiplier
 * (an estimate: the platform fee is not known here). A merchant's own (direct) price is never derived from the
 * official sheet. Undefined when neither a prompt nor an output token fee applies.
 */
export function mediaTierInputRates(input: {
    readonly price: unknown;
    readonly officialPrice?: unknown;
    readonly mediaTiers?: unknown;
    readonly multiplierBps: number | null;
    readonly direct?: boolean;
}): MediaTierInputRates | undefined {
    const bps = input.multiplierBps;
    const scale = (value: number | undefined): number | undefined => value === undefined || input.direct
        || bps === null || !Number.isSafeInteger(bps) || bps < 0 ? undefined : Math.round(value * bps / 10_000);
    const officialOf = (kind: RateKind): number | undefined => firstMicros(input.officialPrice, CUSTOMER_RATE_FIELDS[kind])
        ?? micros(tokenRateOf(input.mediaTiers, TOKEN_RATE_METRIC[kind])?.officialMicros);
    const customerOf = (kind: RateKind): number | undefined => firstMicros(input.mediaTiers, CUSTOMER_RATE_FIELDS[kind].slice(0, 1))
        ?? micros(tokenRateOf(input.mediaTiers, TOKEN_RATE_METRIC[kind])?.customerMicros)
        ?? firstMicros(input.price, CUSTOMER_RATE_FIELDS[kind]) ?? scale(officialOf(kind));
    const official = { promptPerMillionMicros: officialOf('prompt'), cachedPromptPerMillionMicros: officialOf('cached'),
        imageInputPerMillionMicros: officialOf('image'), textOutputPerMillionMicros: officialOf('output') };
    const prompt = customerOf('prompt'), output = customerOf('output'), image = customerOf('image');
    if (!prompt && !output && !image) return undefined;
    const cached = customerOf('cached');
    const outputModality = tokenRateOf(input.mediaTiers, 'output_token')?.modality;
    return {
        ...(prompt ? { promptPerMillionMicros: prompt } : {}),
        ...(cached ? { cachedPromptPerMillionMicros: cached } : {}),
        ...(image ? { imageInputPerMillionMicros: image } : {}),
        ...(output ? { textOutputPerMillionMicros: output } : {}),
        ...(output && (outputModality === 'text' || outputModality === 'text_thinking') ? { textOutputModality: outputModality } : {}),
        official: Object.fromEntries(Object.entries(official).filter(([, value]) => value !== undefined)) as MediaTierInputRates['official']
    };
}
