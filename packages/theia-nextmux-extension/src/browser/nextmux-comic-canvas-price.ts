import type { CanvasDocument, CanvasNode } from '@nextmux/comic-core/canvas';
import { resolveCanvasCapability, type CanvasModelCapability } from '@nextmux/comic-core/canvas-capabilities';
import {
    canvasImageEstimateParameters,
    canvasImageReferenceCount,
    canvasVideoEstimateParameters as resolveCanvasVideoParameters,
    canvasVideoInputImageCount
} from '../common/nextmux-canvas-estimate-parameters';
import type { PlatformOffering } from '../common/nextmux-platform-protocol';
import { formatManagedVideoEstimate } from './nextmux-video-price';
import { canvasImageTier, canvasVideoTier, offeringMediaTiers } from '../common/nextmux-canvas-media-tiers';
import {
    estimateManagedImageCostMicros,
    estimateManagedVideoCostMicros,
    offeringIsOwnPriced,
    offeringMultiplierBps,
    resolveEffectiveOfferingPrice
} from '../common/nextmux-media-cost-estimator';
import { mediaTierInputRates } from '../common/nextmux-media-price-tiers';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { formatPriceMicros, offeringPriceText } from './nextmux-offering-price';

export { canvasImageReferenceCount, canvasVideoInputImageCount };

/** A video node's expected cost in USD micros (what the canvas checks against the wallet before it starts). */
export function managedCanvasVideoEstimateMicros(
    canvas: CanvasDocument,
    node: CanvasNode,
    offering: PlatformOffering,
    capability?: CanvasModelCapability
): number | undefined {
    if (node.kind !== 'videoGen') return undefined;
    const params = resolveCanvasVideoParameters(node, capability);
    return estimateManagedVideoCostMicros(offering, {
        durationSeconds: params.seconds,
        resolution: params.resolution,
        width: params.width,
        height: params.height,
        inputImageCount: canvasVideoInputImageCount(canvas, node)
    });
}

/** A picture node's expected cost in USD micros, its token fees included. */
export function managedCanvasImageEstimateMicros(
    node: CanvasNode,
    offering: PlatformOffering,
    capability?: CanvasModelCapability,
    canvas?: CanvasDocument
): number | undefined {
    if (node.kind !== 'imageGen') return undefined;
    const parameters = node.payload.parameters;
    return estimateManagedImageCostMicros(offering, {
        ...canvasImageEstimateParameters(node, capability),
        prompt: node.payload.prompt,
        negativePrompt: typeof parameters.negativePrompt === 'string' ? parameters.negativePrompt : undefined,
        referenceImageCount: canvasImageReferenceCount(canvas, node)
    });
}

export function managedCanvasVideoEstimate(locale: string, canvas: CanvasDocument, node: CanvasNode, offering: PlatformOffering, capability?: CanvasModelCapability): string | undefined {
    if (node.kind !== 'videoGen') return undefined;
    const params = resolveCanvasVideoParameters(node, capability);
    // A tier-priced offering (Veo 720p / 1080p / 4K) pays the tier the gateway bills for this request.
    const tiers = offeringMediaTiers(offering);
    const tier = tiers ? canvasVideoTier(tiers, { ...(params.resolution ? { resolution: params.resolution } : {}),
        ...(params.width !== undefined ? { width: params.width } : {}), ...(params.height !== undefined ? { height: params.height } : {}) }) : undefined;
    const effective = resolveEffectiveOfferingPrice(offering);
    const basePrice = {
        ...offering.price,
        ...(offering.price?.videoSecondMicros == null && effective.videoSecondMicros !== undefined ? { videoSecondMicros: effective.videoSecondMicros } : {}),
        ...(offering.price?.videoInputImageEachMicros == null && effective.videoInputImageEachMicros !== undefined ? { videoInputImageEachMicros: effective.videoInputImageEachMicros } : {}),
        ...(offering.price?.requestEachMicros == null && effective.requestEachMicros !== undefined ? { requestEachMicros: effective.requestEachMicros } : {})
    };
    // A class above the table's dearest tier is refused by the gateway: no price is promised for it.
    const price = !tiers ? basePrice : { ...basePrice, videoSecondMicros: tier ? tier.customerMicros : null };
    return formatManagedVideoEstimate(locale, price, params.seconds, canvasVideoInputImageCount(canvas, node));
}

/**
 * The price of one picture as the gateway bills it: a tier-priced offering pays the tier of the chosen
 * size / output class / quality (the same rules as the platform); any other offering its flat per-image price.
 */
export function managedCanvasImageEstimate(locale: string, node: CanvasNode, offering: PlatformOffering, capability?: CanvasModelCapability): string | undefined {
    if (node.kind !== 'imageGen') return undefined;
    const parameters = node.payload.parameters;
    const tiers = offeringMediaTiers(offering);
    const effective = resolveEffectiveOfferingPrice(offering);
    let micros = effective.imageEachMicros ?? effective.requestEachMicros ?? offering.price?.imageEachMicros ?? undefined;
    if (tiers) {
        const resolved = capability ? resolveCanvasCapability(capability, { mode: node.payload.mode, ...(typeof parameters.resolution === 'string' ? { resolution: parameters.resolution } : {}) }) : undefined;
        const aspect = typeof parameters.aspectRatio === 'string' ? parameters.aspectRatio : resolved?.variant?.defaultAspectRatio;
        const size = aspect ? resolved?.variant?.dimensions?.[aspect] : undefined;
        const width = size?.width ?? Number(parameters.width), height = size?.height ?? Number(parameters.height);
        const qualityDefault = resolved?.mode?.parameters?.find(parameter => parameter.key === 'quality')?.defaultValue;
        const quality = typeof parameters.quality === 'string' ? parameters.quality : typeof qualityDefault === 'string' ? qualityDefault : undefined;
        // A size with no tier is refused by the gateway, so no price is shown; without a size it is the default tier.
        micros = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
            ? canvasImageTier(tiers, { width, height, ...(quality ? { quality } : {}), ...(typeof parameters.resolution === 'string' ? { resolution: parameters.resolution } : {}) })?.customerMicros
            : tiers.tiers.find(tier => tier.id === tiers.defaultTierId)?.customerMicros ?? micros;
    }
    if (micros === undefined || micros === null || !Number.isFinite(micros)) return undefined;
    const language = locale as NextMuxDesktopLocale;
    const currency = offering.price?.currency || effective.currency;
    // One formatter for the picture and its token rates, so a line never mixes "$" and "US$".
    const perImage = formatPriceMicros(language, micros, currency);
    // Official image sheets bill the text prompt (and on some models text/thinking output) per token on top of the
    // picture. Only a tier-priced picture carries these fees; a flat image price stays alone.
    const rates = tiers?.kind === 'image' ? mediaTierInputRates({ price: offering.price, officialPrice: offering.officialPrice,
        mediaTiers: tiers, multiplierBps: offeringMultiplierBps(offering), direct: offeringIsOwnPriced(offering) }) : undefined;
    if (!rates) return perImage;
    const perMillion = (value: number): string => `${formatPriceMicros(language, value, currency)}/${offeringPriceText(language, 'mtok')}`;
    const showImageInputOnly = rates.promptPerMillionMicros === undefined && rates.textOutputPerMillionMicros === undefined && rates.imageInputPerMillionMicros !== undefined;
    return [perImage,
        ...(rates.promptPerMillionMicros !== undefined ? [`${offeringPriceText(language, 'input')} ${perMillion(rates.promptPerMillionMicros)}`] : []),
        ...(showImageInputOnly ? [`${offeringPriceText(language, 'imageInput')} ${perMillion(rates.imageInputPerMillionMicros!)}`] : []),
        ...(rates.textOutputPerMillionMicros !== undefined ? [`${offeringPriceText(language, 'output')} ${perMillion(rates.textOutputPerMillionMicros)}`] : [])
    ].join(' + ');
}
