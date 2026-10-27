/** Sound laid under a clip: a voice line, background music (may continue from the previous clip) or an effect. */
export interface ComicEditorAudio {
    readonly key: string;
    readonly assetId: string;
    readonly role: 'audio' | 'music' | 'effect';
    readonly url: string;
    /** Seconds into the file at the start of the clip. */
    readonly start: number;
    /** Absolute source-stream presentation origin; `start` stays content-relative. */
    readonly origin?: number;
    /** Seconds of the file left from `start`, when its length is known: the sound ends there. */
    readonly length?: number;
    readonly title?: string;
}

/** One shot on the episode timeline. Times are seconds from the start of the episode. */
export interface ComicEditorClip {
    readonly shotId: string;
    readonly sceneId: string;
    readonly title: string;
    readonly sceneTitle: string;
    readonly start: number;
    readonly duration: number;
    /** Playable URL of the accepted shot video, when one exists. */
    readonly videoUrl?: string;
    /** Seconds into the video file where the clip starts (trimmed head). */
    readonly videoStart?: number;
    /** Usable whole-frame duration of the source file (seconds). */
    readonly videoLength?: number;
    /** Absolute presentation origin; trim limits continue to use logical `videoStart`. */
    readonly videoOrigin?: number;
    /** Incoming overlap with the previous shot; the shared export schedule supplies this. */
    readonly dissolveIn?: number;
    /** A still picture shown for the whole clip when there is no video. */
    readonly imageUrl?: string;
    readonly fit?: 'contain' | 'cover';
    /** Camera motion of a still (push_in, pan_left…); the export renders the same move. */
    readonly motion?: string;
    readonly volume?: number;
    readonly fadeIn?: number;
    readonly fadeOut?: number;
    readonly audio?: readonly ComicEditorAudio[];
    readonly cues: readonly { readonly start: number; readonly duration: number; readonly text: string; readonly speaker?: string }[];
}

export interface ComicEditorState {
    readonly seconds: number;
    readonly duration: number;
    readonly playing: boolean;
    readonly speed: number;
    readonly shotId?: string;
}

export interface ComicEditorPlaybackError {
    readonly kind: 'video' | 'audio';
    readonly shotId: string;
    readonly name: string;
    readonly code?: number;
}

/** Imperative surface used by voice commands and the timeline. */
export interface ComicEditorController {
    play(): void;
    pause(): void;
    seek(seconds: number, hold?: boolean): void;
    nudge(deltaSeconds: number): void;
    setSpeed(speed: number): void;
    state(): ComicEditorState;
}

export function formatEditorTime(seconds: number): string {
    const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    const minutes = Math.floor(safe / 60);
    const rest = safe - minutes * 60;
    return `${String(minutes).padStart(2, '0')}:${rest.toFixed(1).padStart(4, '0')}`;
}

/** Which clip contains the given episode time (the last clip owns the end). */
export function clipAt(clips: readonly ComicEditorClip[], seconds: number): number {
    if (!clips.length || !Number.isFinite(seconds)) return -1;
    // During a dissolve the incoming clip owns the playhead and the outgoing one remains visible.
    for (let index = clips.length - 1; index >= 0; index--) {
        const clip = clips[index];
        if (seconds >= clip.start && seconds < clip.start + clip.duration) return index;
    }
    const last = clips.at(-1)!;
    return seconds === last.start + last.duration ? clips.length - 1 : -1;
}

export interface ComicEditorContribution {
    readonly clip: ComicEditorClip;
    readonly offset: number;
    /** Audio's linear crossfade weight; incoming picture uses this as its alpha over outgoing. */
    readonly weight: number;
}

export function comicEditorContributions(clips: readonly ComicEditorClip[], seconds: number): readonly ComicEditorContribution[] {
    const index = clipAt(clips, seconds);
    const clip = clips[index];
    if (!clip) return [];
    const offset = Math.max(0, seconds - clip.start);
    const previous = clips[index - 1];
    const overlap = clip.dissolveIn || 0;
    if (previous && overlap > 0 && offset < overlap && seconds < previous.start + previous.duration) {
        const weight = Math.max(0, Math.min(1, offset / overlap));
        return [{ clip: previous, offset: seconds - previous.start, weight: 1 - weight }, { clip, offset, weight }];
    }
    return [{ clip, offset, weight: 1 }];
}

/** Picture opacity for the clip's fades at `offset` seconds (a fade transition fades at least 0.12 s). */
export function clipOpacity(clip: ComicEditorClip | undefined, offset: number): number {
    if (!clip) return 1;
    const fadeIn = Math.max(0, Math.min(clip.duration, clip.fadeIn || 0));
    const fadeOut = Math.max(0, Math.min(clip.duration, clip.fadeOut || 0));
    let opacity = 1;
    if (fadeIn > 0 && offset < fadeIn) opacity *= Math.max(0, offset / fadeIn);
    if (fadeOut > 0 && offset > clip.duration - fadeOut) opacity *= Math.max(0, (clip.duration - offset) / fadeOut);
    return opacity;
}

/** A cross-origin media element can become silent when attached to Web Audio. */
export function comicEditorCanAmplify(sourceUrl: string, pageUrl: string): boolean {
    try {
        const page = new URL(pageUrl);
        const source = new URL(sourceUrl, page);
        if (source.protocol === 'file:') return page.protocol === 'file:';
        if (source.protocol === 'data:') return true;
        if (source.protocol === 'blob:') return source.origin === page.origin;
        return ['http:', 'https:'].includes(source.protocol) && source.origin === page.origin;
    } catch { return false; }
}

export function comicEditorVideoPosition(clip: ComicEditorClip, offset = 0): number {
    return (clip.videoOrigin || 0) + (clip.videoStart || 0) + offset;
}

export function comicEditorAudioPosition(item: ComicEditorAudio, offset = 0): number {
    return (item.origin || 0) + item.start + offset;
}

const comicEditorMediaSeeks = new WeakMap<HTMLMediaElement, { readonly source: string; readonly position: number; readonly duration: number }>();

/** Keep an absolute seek pending while Chromium discovers an offset stream's timestamp range. */
export function comicEditorSeekMedia(element: HTMLMediaElement, position: number): boolean {
    if (element.readyState < 2 || element.seeking) return false;
    if (Math.abs(element.currentTime - position) < 0.001) { comicEditorMediaSeeks.delete(element); return true; }
    // Some MP4s initially report a normalized duration. The first seek discovers
    // their absolute stream origin; durationchange/seeked retry a clamped seek
    // until the requested content offset has actually been decoded.
    const source = element.currentSrc || element.src;
    const previous = comicEditorMediaSeeks.get(element);
    if (previous?.source === source && previous.position === position && Object.is(previous.duration, element.duration)) return false;
    comicEditorMediaSeeks.set(element, { source, position, duration: element.duration });
    try { element.currentTime = position; } catch { return false; }
    const complete = !element.seeking && Math.abs(element.currentTime - position) < 0.001;
    if (complete) comicEditorMediaSeeks.delete(element);
    return complete;
}
