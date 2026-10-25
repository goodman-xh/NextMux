/**
 * What an OpenRouter video model accepts, read from GET {base}/videos/models.
 *
 * OpenRouter rejects a request whose duration, resolution or aspect ratio the model does not list
 * (Veo 3.1 takes 4, 6 or 8 seconds only; Kling v3 renders 720p only). A comic shot has any length,
 * so the request is fitted to the model: the shortest allowed clip that still covers the shot (the
 * timeline plays only the shot's own length), the requested resolution or the nearest one below it,
 * and the closest listed ratio. A picture goes in as the first frame only where the model takes one.
 */

import { OPENROUTER_VIDEO_DEFAULT_RATIOS } from '../common/nextmux-canvas-adapter-policy';

export interface OpenRouterVideoLimits {
    readonly durations: readonly number[];
    readonly resolutions: readonly string[];
    readonly aspectRatios: readonly string[];
    readonly frameImages: readonly string[];
    readonly audio?: boolean;
}

export interface OpenRouterVideoFit {
    readonly duration: number;
    readonly resolution?: string;
    readonly aspectRatio: string;
    /** Send the picture as `frame_images` first frame; otherwise as a style reference. */
    readonly firstFrame: boolean;
}

export const OPENROUTER_VIDEO_RESOLUTION_HEIGHT: Readonly<Record<string, number>> = { '480p': 480, '720p': 720, '768p': 768, '1080p': 1080, '1k': 1080, '2k': 1440, '4k': 2160 };

const strings = (value: unknown, max = 40): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length <= 16).slice(0, max) : [];

/** Parse the `/videos/models` payload into limits by model id. */
export function parseOpenRouterVideoModels(payload: unknown): Map<string, OpenRouterVideoLimits> {
    const out = new Map<string, OpenRouterVideoLimits>();
    const data = payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data) ? (payload as { data: unknown[] }).data : [];
    for (const raw of data.slice(0, 1_000)) {
        if (!raw || typeof raw !== 'object') continue;
        const item = raw as Record<string, unknown>;
        const id = typeof item.id === 'string' ? item.id.trim().toLowerCase() : '';
        if (!id || id.length > 200) continue;
        const durations = (Array.isArray(item.supported_durations) ? item.supported_durations : [])
            .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 600)
            .sort((left, right) => left - right).slice(0, 120);
        out.set(id, {
            durations,
            resolutions: strings(item.supported_resolutions),
            aspectRatios: strings(item.supported_aspect_ratios),
            frameImages: strings(item.supported_frame_images, 4),
            ...(typeof item.generate_audio === 'boolean' ? { audio: item.generate_audio } : {})
        });
    }
    return out;
}

function ratioValue(ratio: string): number {
    const [width, height] = ratio.split(':').map(Number);
    return width > 0 && height > 0 ? width / height : NaN;
}

export function fitOpenRouterVideoRequest(
    limits: OpenRouterVideoLimits | undefined,
    request: { readonly durationSeconds: number; readonly width: number; readonly height: number; readonly hasPicture: boolean;
        readonly resolution?: string; readonly aspectRatio?: string }
): OpenRouterVideoFit {
    const wanted = Math.max(1, Math.ceil(request.durationSeconds));
    const durations = limits?.durations || [];
    const duration = durations.length ? durations.find(value => value >= wanted) ?? durations[durations.length - 1] : wanted;
    const ratios = limits?.aspectRatios.length ? limits.aspectRatios : OPENROUTER_VIDEO_DEFAULT_RATIOS;
    const target = request.width / request.height;
    const aspectRatio = request.aspectRatio && ratios.includes(request.aspectRatio) ? request.aspectRatio : ratios
        .filter(ratio => Number.isFinite(ratioValue(ratio)))
        .sort((left, right) => Math.abs(Math.log(ratioValue(left) / target)) - Math.abs(Math.log(ratioValue(right) / target)))[0] || '16:9';
    const short = Math.min(request.width, request.height);
    const wantedResolution = short >= 2000 ? '4K' : short >= 1080 ? '1080p' : short >= 720 ? '720p' : '480p';
    let resolution: string | undefined = wantedResolution;
    if (limits?.resolutions.length) {
        const heights = limits.resolutions
            .map(value => ({ value, height: OPENROUTER_VIDEO_RESOLUTION_HEIGHT[value.toLowerCase()] || 0 }))
            .filter(entry => entry.height > 0)
            .sort((left, right) => right.height - left.height);
        const cap = OPENROUTER_VIDEO_RESOLUTION_HEIGHT[wantedResolution.toLowerCase()];
        resolution = heights.find(entry => entry.height <= cap)?.value ?? heights[heights.length - 1]?.value;
    }
    // Canvas resolutions are exact choices. Pixel thresholds otherwise misclassify 768p and 2K.
    if (request.resolution && OPENROUTER_VIDEO_RESOLUTION_HEIGHT[request.resolution.toLowerCase()]
        && (!limits?.resolutions.length || limits.resolutions.some(value => value.toLowerCase() === request.resolution!.toLowerCase()))) {
        resolution = request.resolution;
    }
    // Unknown model (no listing): keep sending the picture as the first frame, as before.
    const firstFrame = request.hasPicture && (!limits || limits.frameImages.includes('first_frame'));
    return { duration, ...(resolution ? { resolution } : {}), aspectRatio, firstFrame };
}
