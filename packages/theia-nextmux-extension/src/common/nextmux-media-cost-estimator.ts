import type {
    MediaAudioGenerationJobInput,
    MediaImageJobInput,
    MediaJobKind,
    MediaSpeechJobInput,
    MediaVideoJobInput
} from '@nextmux/media-core';
import { canvasImageTier, canvasVideoTier, offeringMediaTiers } from './nextmux-canvas-media-tiers';
import { estimateManagedVideoPriceMicros, managedVideoInputImageCount } from './nextmux-managed-video-price';
import { mediaTierInputRates } from './nextmux-media-price-tiers';
import type { PlatformOffering } from './nextmux-platform-protocol';

/**
 * What a managed media request is expected to cost the user, in USD micros, read from the catalog quote: the canvas
 * and the comic desk show it and check it against the cached wallet before they start anything. The gateway still
 * prices, holds and settles every request itself; these figures never bill anyone.
 */

export type EstimableOffering = Partial<Pick<PlatformOffering, 'price' | 'officialPrice' | 'multiplierBps' | 'keyPrice'>>;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const micros = (value: unknown): number | undefined => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

/** A merchant-set price (no multiplier), versus official price × multiplier. */
export function offeringIsOwnPriced(offering: Pick<EstimableOffering, 'price' | 'multiplierBps'>): boolean {
    return offering.price?.mode === 'direct' || offering.multiplierBps === null;
}

/** The multiplier applied to this offering (the quoted key price's first), or null when the merchant set its own price. */
export function offeringMultiplierBps(offering: Pick<EstimableOffering, 'price' | 'multiplierBps' | 'keyPrice'>): number | null {
    if (offeringIsOwnPriced(offering)) return null;
    const value = offering.keyPrice?.selectedMultiplierBps ?? offering.multiplierBps;
    return finite(value) ? value : null;
}

const PRICE_DIMENSION_KEYS = [
    'inputPerMillionMicros', 'imageInputPerMillionMicros', 'outputPerMillionMicros', 'imageOutputPerMillionMicros',
    'cachedInputPerMillionMicros', 'cacheWritePerMillionMicros', 'requestEachMicros', 'imageEachMicros', 'videoSecondMicros',
    'videoInputImageEachMicros', 'audioSecondMicros', 'audioPerMillionCharactersMicros', 'webSearchEachMicros'
] as const;

export type EffectiveOfferingPrice = { -readonly [K in (typeof PRICE_DIMENSION_KEYS)[number]]?: number } & { readonly currency: string };

/**
 * The customer price per dimension: as published, or — for an official × multiplier offering that does not publish
 * one — the official price × the multiplier (an estimate without the platform fee). A merchant's own price is never
 * derived from the official sheet.
 */
export function resolveEffectiveOfferingPrice(offering: EstimableOffering | undefined): EffectiveOfferingPrice {
    const published = (offering?.price ?? {}) as unknown as Record<string, unknown>;
    const official = (offering?.officialPrice ?? {}) as unknown as Record<string, unknown>;
    const bps = offering ? offeringMultiplierBps(offering) : null;
    const currency = typeof published.currency === 'string' && /^[A-Z]{3}$/.test(published.currency) ? published.currency : 'USD';
    const result: EffectiveOfferingPrice = { currency };
    for (const key of PRICE_DIMENSION_KEYS) {
        const own = micros(published[key]);
        if (own !== undefined) { result[key] = own; continue; }
        const base = finite(official[key]) ? official[key] as number : undefined;
        const scaled = base === undefined || bps === null ? undefined : Math.round(base * bps / 10_000);
        if (scaled !== undefined && Number.isSafeInteger(scaled)) result[key] = scaled;
    }
    return result;
}

/** Prompt tokens to budget for: the UTF-8 bytes (a byte-level tokenizer never emits more) plus framing, at least 64. */
export function estimatePromptTokens(prompt?: string): number {
    const bytes = prompt ? new TextEncoder().encode(prompt).byteLength : 0;
    return Math.max(64, bytes + 32);
}

/** Reference picture input tokens: on a tier table's image-input rate, and on a token-priced model's prompt rate. */
const TIER_REFERENCE_TOKENS = 1024;
const TOKEN_PRICED_REFERENCE_TOKENS = 1600;
/** The output a token-priced picture is budgeted for: one Gemini picture, else a 2 048-token text reserve. */
const TOKEN_PRICED_IMAGE_OUTPUT_TOKENS = 1290;
const TOKEN_PRICED_TEXT_OUTPUT_TOKENS = 2048;

export interface ManagedImageCostEstimateInput {
    readonly width?: number;
    readonly height?: number;
    readonly quality?: string;
    readonly resolution?: string;
    readonly prompt?: string;
    readonly negativePrompt?: string;
    readonly referenceImageCount?: number;
    readonly count?: number;
}

/**
 * One managed picture request: the tier (or flat) picture price plus the token fees billed beside it — prompt,
 * reference pictures, text/thinking output. Undefined when the offering prices neither, or the size has no tier
 * (the gateway refuses that request).
 */
export function estimateManagedImageCostMicros(offering: EstimableOffering | undefined, input: ManagedImageCostEstimateInput = {}): number | undefined {
    if (!offering) return undefined;
    const effective = resolveEffectiveOfferingPrice(offering);
    const tiers = offeringMediaTiers(offering);
    let base: number | undefined;
    if (tiers?.kind === 'image') {
        const width = finite(input.width) && input.width > 0 ? input.width : undefined;
        const height = finite(input.height) && input.height > 0 ? input.height : undefined;
        // The gateway needs the size to pick a tier; without one the estimate is the default tier (the flat price).
        const tier = width && height
            ? canvasImageTier(tiers, { width, height, ...(input.quality ? { quality: input.quality } : {}), ...(input.resolution ? { resolution: input.resolution } : {}) })
            : tiers.tiers.find(item => item.id === tiers.defaultTierId);
        if (!tier) return undefined;
        base = tier.customerMicros;
    } else {
        base = effective.imageEachMicros ?? effective.requestEachMicros;
    }
    const rates = mediaTierInputRates({ price: offering.price, officialPrice: offering.officialPrice,
        mediaTiers: tiers ?? (offering.price as { readonly mediaTiers?: unknown } | undefined)?.mediaTiers,
        multiplierBps: offeringMultiplierBps(offering), direct: offeringIsOwnPriced(offering) });
    const cost = (tokens: number, rate: number | undefined): number => rate && rate > 0 ? Math.ceil(tokens * rate / 1_000_000) : 0;
    const references = Math.max(0, Math.floor(input.referenceImageCount ?? 0));
    const prompt = rates?.promptPerMillionMicros;
    const textOutput = rates?.textOutputPerMillionMicros;
    const outputTokens = rates?.textOutputModality === 'text_thinking' ? 1024 : 256;
    let tokens = cost(estimatePromptTokens([input.prompt, input.negativePrompt].filter(Boolean).join('\n')), prompt);
    if (base !== undefined) {
        tokens += cost(references * TIER_REFERENCE_TOKENS, rates?.imageInputPerMillionMicros) + cost(outputTokens, textOutput);
    } else {
        // A token-priced model (no per-picture price): its pictures are output tokens too.
        tokens += cost(references * TOKEN_PRICED_REFERENCE_TOKENS, rates?.imageInputPerMillionMicros || prompt);
        tokens += effective.imageOutputPerMillionMicros
            ? cost(TOKEN_PRICED_IMAGE_OUTPUT_TOKENS, effective.imageOutputPerMillionMicros) + cost(outputTokens, textOutput)
            : cost(TOKEN_PRICED_TEXT_OUTPUT_TOKENS, textOutput);
        if (!tokens) return undefined;
    }
    const total = ((base ?? 0) + tokens) * Math.max(1, Math.floor(input.count ?? 1));
    return Number.isSafeInteger(total) ? total : undefined;
}

export interface ManagedVideoCostEstimateInput {
    readonly durationSeconds?: number;
    readonly resolution?: string;
    readonly width?: number;
    readonly height?: number;
    readonly inputImageCount?: number;
}

/** One managed clip: the tier (or flat) per-second price × seconds, or a per-request price, plus each input picture. */
export function estimateManagedVideoCostMicros(offering: EstimableOffering | undefined, input: ManagedVideoCostEstimateInput = {}): number | undefined {
    if (!offering) return undefined;
    const effective = resolveEffectiveOfferingPrice(offering);
    const tiers = offeringMediaTiers(offering);
    let videoSecondMicros = effective.videoSecondMicros;
    if (tiers?.kind === 'video') {
        const tier = canvasVideoTier(tiers, { ...(input.resolution ? { resolution: input.resolution } : {}),
            ...(input.width !== undefined ? { width: input.width } : {}), ...(input.height !== undefined ? { height: input.height } : {}) });
        if (!tier) return undefined;
        videoSecondMicros = tier.customerMicros;
    }
    return estimateManagedVideoPriceMicros({ videoSecondMicros: videoSecondMicros ?? null,
        videoInputImageEachMicros: effective.videoInputImageEachMicros ?? null, requestEachMicros: effective.requestEachMicros ?? null },
    input.durationSeconds, input.inputImageCount ?? 0);
}

/** A managed text call (a prompt translation, a plan): its prompt plus an expected 512-token answer. */
export function estimateManagedTextCostMicros(offering: EstimableOffering | undefined, input: { readonly prompt?: string; readonly expectedOutputTokens?: number } = {}): number | undefined {
    if (!offering) return undefined;
    const effective = resolveEffectiveOfferingPrice(offering);
    const { inputPerMillionMicros: inRate, outputPerMillionMicros: outRate, requestEachMicros: each } = effective;
    if (inRate === undefined && outRate === undefined && each === undefined) return undefined;
    const outputTokens = Math.max(64, Math.floor(input.expectedOutputTokens ?? 512));
    const total = (each ?? 0) + (inRate ? Math.ceil(estimatePromptTokens(input.prompt) * inRate / 1_000_000) : 0)
        + (outRate ? Math.ceil(outputTokens * outRate / 1_000_000) : 0);
    return Number.isSafeInteger(total) ? total : undefined;
}

/** Any managed media job as the desk queues it (image, video, speech, music, sound effect). */
export function estimateManagedMediaJobMicros(
    offering: EstimableOffering | undefined,
    kind: MediaJobKind,
    input: MediaImageJobInput | MediaVideoJobInput | MediaSpeechJobInput | MediaAudioGenerationJobInput | Record<string, unknown>
): number | undefined {
    if (!offering) return undefined;
    if (kind === 'image') {
        const image = input as MediaImageJobInput;
        return estimateManagedImageCostMicros(offering, { width: image.width, height: image.height, quality: image.quality, resolution: image.resolution,
            prompt: image.prompt, negativePrompt: image.negativePrompt, referenceImageCount: image.characterReferenceUris?.length ?? 0 });
    }
    if (kind === 'video') {
        const video = input as MediaVideoJobInput;
        return estimateManagedVideoCostMicros(offering, { durationSeconds: video.durationSeconds, resolution: video.resolution, width: video.width, height: video.height,
            inputImageCount: managedVideoInputImageCount(video) });
    }
    const effective = resolveEffectiveOfferingPrice(offering);
    if (kind === 'speech') {
        const characters = Math.max(1, [...((input as MediaSpeechJobInput).text || '')].length);
        if (effective.audioPerMillionCharactersMicros !== undefined) return Math.ceil(characters * effective.audioPerMillionCharactersMicros / 1_000_000);
        // About 12 characters a second of speech.
        if (effective.audioSecondMicros !== undefined) return Math.ceil(Math.max(1, Math.ceil(characters / 12)) * effective.audioSecondMicros);
        return effective.requestEachMicros;
    }
    if (kind === 'music' || kind === 'sound_effect') {
        const seconds = (input as MediaAudioGenerationJobInput).durationSeconds;
        if (effective.audioSecondMicros !== undefined) return Math.ceil((finite(seconds) && seconds > 0 ? seconds : 10) * effective.audioSecondMicros);
        return effective.requestEachMicros;
    }
    return undefined;
}
