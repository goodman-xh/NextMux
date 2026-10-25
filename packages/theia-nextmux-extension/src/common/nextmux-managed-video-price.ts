import type { MediaVideoJobInput } from '@nextmux/media-core';
import type { OfferingPriceDimensions, PlatformOffering } from './nextmux-platform-protocol';

type VideoPrice = Pick<OfferingPriceDimensions, 'videoSecondMicros' | 'videoInputImageEachMicros' | 'requestEachMicros'>;
const money = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Each transmitted image is billed once, including an image used in two different frame roles. */
export function managedVideoInputImageCount(input: Pick<MediaVideoJobInput, 'firstFrameUri' | 'lastFrameUri' | 'referenceAssetUris' | 'characterReferenceUris'>): number {
    return Number(Boolean(input.firstFrameUri)) + Number(Boolean(input.lastFrameUri))
        + (input.referenceAssetUris?.length ?? 0) + (input.characterReferenceUris?.length ?? 0);
}

/** Old quotes omitted this component because their video hold covered only seconds. */
export function managedVideoInputImagePriceMicros(price: Pick<VideoPrice, 'videoInputImageEachMicros'> | undefined): number | undefined {
    const value = price?.videoInputImageEachMicros;
    return value == null ? 0 : money(value) ? value : undefined;
}

/** The desktop estimate uses the same integer-micro hold components as the frozen managed quote. */
export function estimateManagedVideoPriceMicros(price: VideoPrice | undefined, durationSeconds: number | undefined, inputImages = 0): number | undefined {
    const each = managedVideoInputImagePriceMicros(price);
    if (each === undefined || !Number.isSafeInteger(inputImages) || inputImages < 0) return undefined;
    if (money(price?.videoSecondMicros)) {
        if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return undefined;
        const total = Math.ceil(price.videoSecondMicros * durationSeconds) + each * inputImages;
        return money(total) ? total : undefined;
    }
    if (price?.videoSecondMicros == null && money(price?.requestEachMicros)) {
        const total = price.requestEachMicros + each * inputImages;
        return money(total) ? total : undefined;
    }
    return undefined;
}

/** Shape evidence and displayed prices must describe the same quote's per-image component. */
export function managedVideoImagePriceMatchesProof(offering: Partial<Pick<PlatformOffering, 'price'>>, limits: PlatformOffering['videoLimits']): boolean {
    const price = managedVideoInputImagePriceMicros(offering.price);
    const proof = limits?.inputImagePriceMicros ?? 0;
    return price !== undefined && money(proof) && price === proof;
}
