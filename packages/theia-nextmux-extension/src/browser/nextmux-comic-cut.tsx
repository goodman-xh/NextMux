import type { ComicEditorClip } from './nextmux-comic-editor';

/** Shared asset contracts and shot-timeline helpers used by the desktop editor. */
export type ComicCutRole = 'audio' | 'music' | 'effect';
export type ComicCutTransition = 'cut' | 'fade' | 'dissolve';

export interface ComicCutAsset {
    readonly id: string;
    readonly kind: 'image' | 'video' | 'audio' | 'music' | 'effect';
    readonly title: string;
    readonly url?: string;
    readonly durationMs?: number;
    readonly width?: number;
    readonly height?: number;
    readonly source: 'imported' | 'generated';
    readonly used: boolean;
    /** From another project (全部素材): named here, copied into this project when it is used. */
    readonly origin?: string;
}

/**
 * A section of the media library: 本对话 first, then 同项目其他对话, then 全部素材 (every other project, loaded
 * when opened). Without sections the library is one flat list of the project's media.
 */
export interface ComicCutAssetGroup {
    readonly key: string;
    readonly title: string;
    readonly assets: readonly ComicCutAsset[];
    readonly open: boolean;
    readonly loading?: boolean;
    /** Shown when the open section is empty. */
    readonly empty?: string;
    readonly onToggle?: () => void;
}

export interface ComicCutCue {
    readonly id: string;
    readonly text: string;
    readonly start: number;
    readonly duration: number;
    readonly speakerCharacterId?: string;
}

export interface ComicCutClip extends ComicEditorClip {
    readonly index: number;
    readonly kind: 'video' | 'image' | 'empty';
    readonly mediaAssetId?: string;
    readonly transitionIn: ComicCutTransition;
    readonly transitionOut: ComicCutTransition;
    readonly cameraMotion: string;
    readonly generating?: boolean;
    readonly cueList: readonly ComicCutCue[];
}

/** Where dropped files or library items go on the timeline. */
export interface ComicCutPlacement {
    /** Picture track: insert before the clip at this index (clips.length: at the end). */
    readonly index: number;
    readonly lane: 'video' | ComicCutRole;
    /** Audio tracks: the clip under the drop point. */
    readonly shotId?: string;
}

/** A continuous run of the same sound across neighbouring clips, drawn as one bar. */
export interface ComicCutLaneItem {
    readonly key: string;
    readonly role: ComicCutRole;
    readonly assetId: string;
    readonly title: string;
    readonly start: number;
    readonly duration: number;
    readonly shotIds: readonly string[];
}

/** Merge each role's sounds into bars: music that continues from clip to clip is one bar. */
export function comicCutLanes(clips: readonly ComicCutClip[]): Readonly<Record<ComicCutRole, readonly ComicCutLaneItem[]>> {
    // Mutate only the locally created run while collecting it. Repeated scans
    // and copying an ever-growing shotIds array made long timelines quadratic.
    type MutableRun = Omit<ComicCutLaneItem, 'duration' | 'shotIds'> & { duration: number; shotIds: string[] };
    const lanes: Record<ComicCutRole, MutableRun[]> = { audio: [], music: [], effect: [] };
    const lastByAsset: Record<ComicCutRole, Map<string, MutableRun>> = { audio: new Map(), music: new Map(), effect: new Map() };
    const sourceEnds = new Map<string, number>();
    for (const clip of clips) {
        for (const item of clip.audio || []) {
            const lane = lanes[item.role];
            const last = lastByAsset[item.role].get(item.assetId);
            // A sound lasts for the shot, or until its file ends.
            const duration = Math.min(clip.duration, item.length ?? Infinity);
            if (duration <= 0) continue;
            const previousEnd = last ? last.start + last.duration : 0;
            const continues = last && clip.start >= last.start && clip.start <= previousEnd + 1e-3
                && Math.abs((sourceEnds.get(last.key) ?? Infinity) - (previousEnd - clip.start) - item.start) < 1e-3 && item.role === 'music';
            if (continues) {
                last.duration = Math.max(previousEnd, clip.start + duration) - last.start;
                last.shotIds.push(clip.shotId);
                sourceEnds.set(last.key, item.start + Math.max(previousEnd - clip.start, duration));
            } else {
                const next = { key: `${item.role}:${item.assetId}:${clip.shotId}`, role: item.role, assetId: item.assetId, title: item.title || '', start: clip.start, duration, shotIds: [clip.shotId] };
                lane.push(next);
                lastByAsset[item.role].set(item.assetId, next);
                sourceEnds.set(next.key, item.start + duration);
            }
        }
    }
    return lanes;
}

/** The end trim uses whole source frames, so rounding never adds a frozen tail frame. */
export function comicCutMaximumDuration(clip: ComicCutClip, fps: number): number {
    if (clip.kind !== 'video') return Infinity;
    // A legacy file can shrink immediately; expansion waits for actual source metadata.
    if (clip.videoLength === undefined) return clip.duration;
    return Math.max(1, Math.floor((clip.videoLength - (clip.videoStart || 0)) * fps + 1e-7)) / fps;
}

export function comicCutTrimDelta(clip: ComicCutClip, edge: 'start' | 'end', requested: number, fps: number): number {
    const frame = 1 / fps;
    const delta = Number.isFinite(requested) ? Math.round(requested * fps) / fps : 0;
    if (edge === 'end') return Math.max(frame - clip.duration, Math.min(comicCutMaximumDuration(clip, fps) - clip.duration, delta));
    const sources = [...(clip.kind === 'video' ? [clip.videoStart || 0] : []), ...(clip.audio || []).map(item => item.start)];
    const minimum = sources.length ? -Math.min(...sources) : -Infinity;
    return Math.max(minimum, Math.min(clip.duration - frame, delta)) || 0;
}

/** Ruler step (seconds) so labels stay at least ~70 px apart. */
export function comicCutRulerStep(pixelsPerSecond: number): number {
    for (const step of [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]) if (step * pixelsPerSecond >= 70) return step;
    return 600;
}
