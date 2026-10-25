import type { ComicMusicMvSegment, ComicMusicMvSettings, ComicMusicSettings } from '@nextmux/comic-core';
import { plannedClipSeconds, videoModelGuide } from '../common/nextmux-video-model-guide';

/** Request only clip lengths supported by the selected model; shorter clips loop in the MV. */
export function musicMvRequestSeconds(segment: Pick<ComicMusicMvSegment, 'startMs' | 'endMs'>, model: string, highRes = false): number {
    const wanted = Math.max(1, Math.ceil((segment.endMs - segment.startMs) / 1000));
    const guide = videoModelGuide(model);
    const choices = plannedClipSeconds(guide, guide.clipSeconds, { highRes });
    return choices.find(seconds => seconds >= wanted) ?? choices[choices.length - 1] ?? Math.min(25, wanted);
}

export function musicMvCurrent(settings: ComicMusicSettings, durationMs: number): boolean {
    return Boolean(settings.mv && settings.mv.songAssetId === settings.selectedAssetId
        && settings.mv.lyrics === (settings.instrumental ? '' : settings.lyrics)
        && Math.abs(settings.mv.durationMs - durationMs) <= 50);
}

/** An async result may only attach to the song and section it was requested for. */
export function musicMvSegmentCurrent(settings: ComicMusicSettings | undefined, expected: ComicMusicMvSettings, segment: ComicMusicMvSegment): boolean {
    const mv = settings?.mv;
    const current = mv?.segments.find(item => item.id === segment.id);
    return Boolean(mv && current && settings?.selectedAssetId === expected.songAssetId && mv.songAssetId === expected.songAssetId
        && (settings.instrumental ? '' : settings.lyrics) === expected.lyrics && mv.lyrics === expected.lyrics && mv.durationMs === expected.durationMs
        && mv.singerPortraitAssetId === expected.singerPortraitAssetId && current.performance === segment.performance
        && current.startMs === segment.startMs && current.endMs === segment.endMs && current.prompt === segment.prompt && current.source === segment.source);
}

/** Keep each section's media and edited prompts when alignment moves its boundaries. */
export function retainMusicMvMedia(segments: readonly ComicMusicMvSegment[], previous: readonly ComicMusicMvSegment[]): ComicMusicMvSegment[] {
    const indices = new Map<number, number>();
    return segments.map(segment => {
        const index = indices.get(segment.sectionIndex) || 0;
        indices.set(segment.sectionIndex, index + 1);
        const old = previous.filter(item => item.sectionIndex === segment.sectionIndex)[index];
        if (!old) return segment;
        return { ...segment, source: old.source, prompt: old.prompt, ...(old.performance !== undefined ? { performance: old.performance } : {}),
            ...(old.assetId ? { assetId: old.assetId } : {}), ...(old.jobId ? { jobId: old.jobId } : {}) };
    });
}

/** Price confirmation is bound to the model, quote and exact current generation inputs. */
export function musicMvConfirmationKey(mv: ComicMusicMvSettings | undefined, route: {
    readonly id: string; readonly model: string; readonly quote?: string; readonly price?: unknown;
    readonly width?: number; readonly height?: number;
} | undefined): string {
    return JSON.stringify({ song: mv?.songAssetId, duration: mv?.durationMs, singerPortraitAssetId: mv?.singerPortraitAssetId, route,
        segments: mv?.segments.map(({ id, startMs, endMs, source, prompt, jobId, performance }) => ({ id, startMs, endMs, source, prompt, jobId, performance })) });
}
