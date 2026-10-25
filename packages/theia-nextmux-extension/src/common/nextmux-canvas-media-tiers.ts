import { normalizeOfferingMediaTiers, type OfferingMediaTier, type OfferingMediaTiers } from './nextmux-media-price-tiers';

/**
 * Canvas choices for a managed image offering sold by official price tiers (`offering.price.mediaTiers`).
 * The selectors only offer what a tier prices, and the tier picked here is the one the gateway bills
 * (apps/cloudflare-platform/src/media-benchmark-tiers.js selectImageTier — keep the two in step):
 * - quality × size (GPT Image): the three priced sizes, and quality low / medium / high;
 * - output classes (Gemini): 1K / 2K / 4K by picture area, a declared class may only raise the bill;
 * - one flat price: no extra choice.
 */

export type CanvasImageTierVariant = {
    readonly id: string;
    readonly resolution: string;
    readonly aspectRatios: readonly string[];
    readonly defaultAspectRatio: string;
    readonly dimensions: Readonly<Record<string, { readonly width: number; readonly height: number }>>;
};

export type CanvasImageTierPolicy = {
    readonly imageOutputVariants: readonly CanvasImageTierVariant[];
    readonly imageQualities?: readonly string[];
    readonly defaultImageQuality?: string;
};

const GPT_SIZES: Readonly<Record<string, { readonly width: number; readonly height: number }>> = {
    '1:1': { width: 1024, height: 1024 }, '3:2': { width: 1536, height: 1024 }, '2:3': { width: 1024, height: 1536 }
};

/** 1K picture sizes per aspect (Gemini image output); 2K and 4K double them, kept inside the 4096-pixel request limit. */
const CLASS_1K: Readonly<Record<string, readonly [number, number]>> = {
    '1:1': [1024, 1024], '16:9': [1344, 768], '9:16': [768, 1344], '4:3': [1184, 864], '3:4': [864, 1184],
    '3:2': [1248, 832], '2:3': [832, 1248], '21:9': [1536, 672]
};
const CLASS_SCALE: Readonly<Record<string, number>> = { '1K': 1, '2K': 2, '4K': 4 };
const CLASS_ORDER = ['0.5K', '1K', '2K', '4K'];

function classDimensions(resolution: string, ratio: string): { width: number; height: number } | undefined {
    const base = CLASS_1K[ratio], scale = CLASS_SCALE[resolution];
    if (!base || !scale) return undefined;
    let [width, height] = [base[0] * scale, base[1] * scale];
    const fit = Math.min(1, 4096 / Math.max(width, height));
    width = Math.floor(width * fit / 8) * 8; height = Math.floor(height * fit / 8) * 8;
    return { width, height };
}

export const offeringMediaTiers = (offering: { readonly price?: unknown } | undefined): OfferingMediaTiers | undefined =>
    normalizeOfferingMediaTiers((offering?.price as { readonly mediaTiers?: unknown } | undefined)?.mediaTiers);

const isGrid = (tiers: OfferingMediaTiers): boolean => tiers.tiers.length > 1 && tiers.tiers.every(tier => tier.quality && tier.size);
// A single output class (Gemini 3.1 Flash Lite Image is 1K only) is still a class: larger requests are refused.
const isClasses = (tiers: OfferingMediaTiers): boolean => tiers.tiers.length >= 1 && tiers.tiers.every(tier => tier.resolution && CLASS_ORDER.includes(tier.resolution));

/** Output variants (and the quality choice) a tiered image offering can bill exactly; undefined for flat or video tiers. */
export function canvasImageTierPolicy(tiers: OfferingMediaTiers | undefined, ratios: readonly string[]): CanvasImageTierPolicy | undefined {
    if (!tiers || tiers.kind !== 'image') return undefined;
    if (isGrid(tiers)) {
        const qualities = [...new Set(tiers.tiers.map(tier => tier.quality!))];
        const sizes = new Set(tiers.tiers.map(tier => tier.size));
        const dimensions = Object.fromEntries(Object.entries(GPT_SIZES).filter(([, size]) => sizes.has(`${size.width}x${size.height}`)));
        if (!Object.keys(dimensions).length) return undefined;
        return { imageOutputVariants: [{ id: 'tier-sizes', resolution: '1K', aspectRatios: Object.keys(dimensions), defaultAspectRatio: '1:1' in dimensions ? '1:1' : Object.keys(dimensions)[0], dimensions }],
            imageQualities: qualities, defaultImageQuality: tiers.tiers.find(tier => tier.id === tiers.defaultTierId)?.quality ?? qualities[0] };
    }
    if (isClasses(tiers)) {
        const classes = tiers.tiers.map(tier => tier.resolution!).filter(resolution => resolution !== '0.5K');
        const usable = ratios.filter(ratio => CLASS_1K[ratio]);
        if (!classes.length || !usable.length) return undefined;
        return { imageOutputVariants: classes.map(resolution => ({ id: `tier-${resolution.toLowerCase()}`, resolution, aspectRatios: usable,
            defaultAspectRatio: usable.includes('1:1') ? '1:1' : usable[0],
            dimensions: Object.fromEntries(usable.map(ratio => [ratio, classDimensions(resolution, ratio)!])) })) };
    }
    return undefined;
}

/** The tier the gateway bills for these request facts (same rules as the platform). */
export function canvasImageTier(tiers: OfferingMediaTiers, request: { readonly width: number; readonly height: number; readonly quality?: string; readonly resolution?: string }): OfferingMediaTier | undefined {
    if (tiers.kind !== 'image' || !(request.width > 0) || !(request.height > 0)) return undefined;
    if (isGrid(tiers)) {
        const ratio = request.width / request.height;
        const size = ratio > 1.2 ? '1536x1024' : ratio < 0.84 ? '1024x1536' : '1024x1024';
        const quality = request.quality && request.quality !== 'auto' ? request.quality : tiers.tiers.find(tier => tier.id === tiers.defaultTierId)?.quality;
        return tiers.tiers.find(tier => tier.quality === quality && tier.size === size);
    }
    if (isClasses(tiers)) {
        const area = request.width * request.height;
        const byPixels = area <= 2_200_000 ? '1K' : area <= 6_000_000 ? '2K' : '4K';
        // Only a known class is sent upstream (canvasImageResolutionClass); any other value bills by the pixels.
        const declared = canvasImageResolutionClass(request.resolution);
        const wanted = declared && CLASS_ORDER.indexOf(declared) > CLASS_ORDER.indexOf(byPixels) ? declared : byPixels;
        return tiers.tiers.filter(tier => CLASS_ORDER.indexOf(tier.resolution!) >= CLASS_ORDER.indexOf(wanted))
            .sort((a, b) => CLASS_ORDER.indexOf(a.resolution!) - CLASS_ORDER.indexOf(b.resolution!))[0];
    }
    return tiers.tiers.length === 1 ? tiers.tiers[0] : tiers.tiers.find(tier => tier.id === tiers.defaultTierId);
}

/** The output class a request names upstream: only the classes the platform accepts are sent. */
export function canvasImageResolutionClass(resolution: string | undefined): string | undefined {
    const named = resolution?.trim().toLowerCase();
    return CLASS_ORDER.find(value => value.toLowerCase() === named);
}

const VIDEO_CLASS_ORDER = ['480p', '720p', '768p', '1024p', '1080p', '2k', '4k'];
/** Video classes by the short edge of their frame (apps/cloudflare-platform/src/video.js VIDEO_CLASS_SHORT_EDGES). */
const VIDEO_CLASS_SHORT_EDGES: readonly (readonly [string, number])[] = [['480p', 480], ['720p', 720], ['768p', 768], ['1024p', 1024], ['1080p', 1080], ['2k', 1440], ['4k', 2160]];

/**
 * The class an exact output size is billed at, as the gateway reads it (video.js coveringVideoClass): the smallest
 * class whose short edge covers the frame's, never a smaller one (960×540 is 720p, 2560×1440 is 2K).
 */
export function coveringVideoResolutionClass(width?: number, height?: number): string | undefined {
    if (typeof width !== 'number' || typeof height !== 'number' || !(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) return undefined;
    const edge = Math.min(width, height);
    return (VIDEO_CLASS_SHORT_EDGES.find(([, short]) => edge <= short) ?? VIDEO_CLASS_SHORT_EDGES[VIDEO_CLASS_SHORT_EDGES.length - 1])[0];
}

/**
 * The video tier the gateway bills (apps/cloudflare-platform/src/video.js mediaTierVideoRoute → selectVideoTier): the
 * requested output class when the API format sends a size — the named resolution, else the class covering the
 * width × height — the one billed tier when it sends none, and the table's default when the server does not say.
 * An unlisted class bills at the next listed class up. Undefined when no tier is at or above it (the gateway refuses).
 * Audio and aspect ratio do not pick a video tier: the gateway's tables price one tier per resolution.
 */
export function canvasVideoTier(tiers: OfferingMediaTiers, request: { readonly resolution?: string; readonly width?: number; readonly height?: number } = {}): OfferingMediaTier | undefined {
    if (tiers.kind !== 'video') return undefined;
    const byId = (id: string | undefined): OfferingMediaTier | undefined => tiers.tiers.find(tier => tier.id === id);
    if (tiers.tiers.length === 1) return tiers.tiers[0];
    if (tiers.requestTier === 'fixed') return byId(tiers.billedTierId) ?? byId(tiers.defaultTierId);
    const named = request.resolution?.trim().toLowerCase();
    const wanted = named && VIDEO_CLASS_ORDER.includes(named) ? named : coveringVideoResolutionClass(request.width, request.height);
    if (tiers.requestTier !== 'output_size' || !wanted) return byId(tiers.defaultTierId);
    const rank = (tier: OfferingMediaTier): number => VIDEO_CLASS_ORDER.indexOf(String(tier.resolution).toLowerCase());
    return tiers.tiers.filter(tier => rank(tier) >= VIDEO_CLASS_ORDER.indexOf(wanted)).sort((a, b) => rank(a) - rank(b))[0];
}
