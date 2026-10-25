/**
 * What each video model can produce: aspect ratios, frame rates and clip lengths.
 *
 * Two sources are combined:
 *   documented — published API limits for well-known models (kept in step with
 *                apps/cloudflare-platform/src/video-profiles.js), and
 *   measured   — the real size and frame rate of finished clips, reported by desktops
 *                after download (ffmpeg) and aggregated by the platform.
 * A new comic asks for its video model first, then offers only the ratios and frame
 * rates that model delivers, so shots are not letterboxed or frame-rate converted.
 */

export type VideoAspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9';
export const VIDEO_ASPECT_RATIOS: readonly VideoAspectRatio[] = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];

export interface VideoModelProfile {
    /** Supported ratios, most used first. */
    readonly aspectRatios: readonly VideoAspectRatio[];
    /** Output frame rates, most common first; empty when not known yet. */
    readonly frameRates: readonly number[];
    readonly durationsSeconds?: readonly number[];
    readonly sources: readonly ('documented' | 'measured')[];
    /** Finished clips measured for this model. */
    readonly samples?: number;
}

interface DocumentedProfile {
    readonly pattern: RegExp;
    readonly aspectRatios: readonly VideoAspectRatio[];
    readonly frameRates?: readonly number[];
    readonly durationsSeconds?: readonly number[];
}

/**
 * Only published limits. Sora 2 takes 720×1280 / 1280×720 (Pro also 1024×1792 / 1792×1024)
 * for 4, 8 or 12 seconds; Veo renders 16:9 or 9:16 at 24 fps.
 */
const DOCUMENTED: readonly DocumentedProfile[] = [
    { pattern: /(?:^|\/)sora-2-pro(?:$|[-:@])/i, aspectRatios: ['16:9', '9:16'], durationsSeconds: [4, 8, 12] },
    { pattern: /(?:^|\/)sora-2(?:$|[-:@])/i, aspectRatios: ['16:9', '9:16'], durationsSeconds: [4, 8, 12] },
    { pattern: /(?:^|\/)veo-[23](?:$|[-.:@])/i, aspectRatios: ['16:9', '9:16'], frameRates: [24] }
];

export function documentedVideoProfile(model: string): VideoModelProfile | undefined {
    const id = model.trim().toLowerCase();
    const match = DOCUMENTED.find(entry => entry.pattern.test(id));
    return match ? {
        aspectRatios: match.aspectRatios, frameRates: match.frameRates || [],
        ...(match.durationsSeconds ? { durationsSeconds: match.durationsSeconds } : {}), sources: ['documented']
    } : undefined;
}

/** The standard ratio a frame size belongs to (2 % tolerance), e.g. 1280×720 → 16:9. */
export function videoAspectRatioOf(width: number, height: number): VideoAspectRatio | undefined {
    if (!(width > 0 && height > 0)) return undefined;
    const value = width / height;
    const targets: readonly [VideoAspectRatio, number][] = [['16:9', 16 / 9], ['9:16', 9 / 16], ['1:1', 1], ['4:3', 4 / 3], ['3:4', 3 / 4], ['21:9', 21 / 9]];
    return targets.find(([, ratio]) => Math.abs(value - ratio) / ratio <= 0.02)?.[0];
}

/** 23.976 → 24, 29.97 → 30, 59.94 → 60; other values rounded to a whole frame rate. */
export function standardFrameRate(fps: number): number | undefined {
    if (!Number.isFinite(fps) || fps < 1 || fps > 240) return undefined;
    for (const standard of [24, 25, 30, 48, 50, 60, 120]) if (Math.abs(fps - standard) <= standard * 0.002 + 0.03) return standard;
    return Math.round(fps);
}

export interface MeasuredVideoStream {
    readonly width: number;
    readonly height: number;
    readonly fps?: number;
}

/** The first video stream in `ffmpeg -i` output: "Video: h264 …, 1280x720 [SAR 1:1 DAR 16:9], … 24 fps, …". */
export function parseFfmpegVideoStream(stderr: string): MeasuredVideoStream | undefined {
    const line = /Stream\s+#\S+.*?:\s+Video:\s+([^\n]*)/i.exec(stderr)?.[1];
    if (!line) return undefined;
    const size = /(?:^|[\s,])(\d{2,5})x(\d{2,5})(?=[\s,[]|$)/.exec(line);
    if (!size) return undefined;
    const width = Number(size[1]), height = Number(size[2]);
    if (width < 16 || height < 16 || width > 16_384 || height > 16_384) return undefined;
    const rate = /(?:^|[\s,])(\d+(?:\.\d+)?)\s+fps\b/.exec(line) || /(?:^|[\s,])(\d+(?:\.\d+)?)\s+tbr\b/.exec(line);
    const fps = rate ? Number(rate[1]) : NaN;
    return { width, height, ...(Number.isFinite(fps) && fps > 0 && fps <= 240 ? { fps } : {}) };
}

export interface MeasuredVideoProfile {
    readonly aspectRatios: readonly { readonly ratio: VideoAspectRatio; readonly samples: number }[];
    readonly frameRates: readonly { readonly fps: number; readonly samples: number }[];
    readonly samples: number;
}

/** Documented limits win; measurements add what real clips show (and the frame rate when docs are silent). */
export function combineVideoProfiles(documented: VideoModelProfile | undefined, measured: MeasuredVideoProfile | undefined): VideoModelProfile | undefined {
    if (!documented && !measured?.samples) return documented;
    const measuredRatios = [...(measured?.aspectRatios || [])].sort((left, right) => right.samples - left.samples).map(item => item.ratio);
    const measuredRates = [...(measured?.frameRates || [])].sort((left, right) => right.samples - left.samples).map(item => item.fps);
    const aspectRatios = documented ? [...documented.aspectRatios] : measuredRatios;
    // A measured ratio outside the documented list means the model grew a new size.
    for (const ratio of measuredRatios) if (!aspectRatios.includes(ratio)) aspectRatios.push(ratio);
    const frameRates = documented?.frameRates.length ? [...documented.frameRates] : [];
    for (const fps of measuredRates) if (!frameRates.includes(fps)) frameRates.push(fps);
    return {
        aspectRatios, frameRates,
        ...(documented?.durationsSeconds ? { durationsSeconds: documented.durationsSeconds } : {}),
        sources: [...(documented ? ['documented' as const] : []), ...(measured?.samples ? ['measured' as const] : [])],
        ...(measured?.samples ? { samples: measured.samples } : {})
    };
}

/** Parse the platform's /api/models/video-profiles payload into lookups by canonical model. */
export function parseVideoProfilesPayload(payload: unknown): ReadonlyMap<string, MeasuredVideoProfile> {
    const out = new Map<string, MeasuredVideoProfile>();
    const profiles = payload && typeof payload === 'object' && Array.isArray((payload as { profiles?: unknown }).profiles) ? (payload as { profiles: unknown[] }).profiles : [];
    for (const raw of profiles.slice(0, 2_000)) {
        if (!raw || typeof raw !== 'object') continue;
        const item = raw as Record<string, unknown>;
        const model = typeof item.model === 'string' ? item.model.trim().toLowerCase().slice(0, 200) : '';
        if (!model) continue;
        const ratios = (Array.isArray(item.aspectRatios) ? item.aspectRatios : []).flatMap(entry => {
            const value = entry as Record<string, unknown>;
            return VIDEO_ASPECT_RATIOS.includes(value?.ratio as VideoAspectRatio) && Number.isSafeInteger(value.samples) && Number(value.samples) > 0
                ? [{ ratio: value.ratio as VideoAspectRatio, samples: Number(value.samples) }] : [];
        });
        const rates = (Array.isArray(item.frameRates) ? item.frameRates : []).flatMap(entry => {
            const value = entry as Record<string, unknown>;
            const fps = standardFrameRate(Number(value?.fps));
            return fps && Number.isSafeInteger(value.samples) && Number(value.samples) > 0 ? [{ fps, samples: Number(value.samples) }] : [];
        });
        const samples = Number.isSafeInteger(item.samples) ? Number(item.samples) : ratios.reduce((total, entry) => total + entry.samples, 0);
        if (samples > 0) out.set(model, { aspectRatios: ratios, frameRates: rates, samples });
    }
    return out;
}

/** The profile for a model id as the desktop sees it (canonical "provider/model" or a bare upstream id). */
export function videoModelProfile(model: string, measured: ReadonlyMap<string, MeasuredVideoProfile> = new Map()): VideoModelProfile | undefined {
    const id = model.trim().toLowerCase();
    const bare = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id;
    const observed = measured.get(id) || [...measured.entries()].find(([key]) => key === bare || key.endsWith(`/${bare}`))?.[1];
    return combineVideoProfiles(documentedVideoProfile(id), observed);
}
