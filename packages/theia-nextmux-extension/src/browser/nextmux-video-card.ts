/**
 * Clips inside conversation bodies (the coding and 漫剧 chats): a card that shows a still, the clip's length and a play
 * mark, never a black box. A click opens the clip large in the conversation's viewer (the widget handles the click).
 *
 * The still is the poster when one is given. Otherwise it is a frame read from the clip itself, the way open-source chat
 * front ends (Open WebUI, LobeChat) and HTML5 media practice do it: load the metadata, seek a little way in (the smaller
 * of 0.1 s and 5 % of the clip), draw that frame. A frame that is nearly black or one flat colour (a fade-in, a title
 * card) is passed over for one further in. When the frame can be read into a canvas, the card keeps a JPEG of it and the
 * decoder goes; when it cannot (a clip from another origin taints the canvas), the seeked <video> itself stays on as the
 * still. Reads are shared by URL, remembered, and at most two run at a time, so a long thread never starts a decoder
 * storm. A clip on the web is never read off-screen: its card's own <video> loads the metadata and seeks.
 *
 * Nothing here loads a file server path (`file://server/share/…`): opening one would let Windows sign in to that server
 * on its own. The conversation code decides which local files a card may load.
 */

export type VideoCardTextKey = 'play' | 'unavailable' | 'video';

const VIDEO_CARD_TEXT: Readonly<Record<string, Readonly<Record<VideoCardTextKey, string>>>> = {
    'zh-CN': { play: '播放视频：{name}', unavailable: '无法预览此视频', video: '视频' },
    'zh-TW': { play: '播放影片：{name}', unavailable: '無法預覽此影片', video: '影片' },
    en: { play: 'Play video: {name}', unavailable: 'Can’t preview this video', video: 'Video' },
    ja: { play: '動画を再生：{name}', unavailable: 'この動画はプレビューできません', video: '動画' },
    ko: { play: '동영상 재생: {name}', unavailable: '이 동영상은 미리 볼 수 없습니다', video: '동영상' },
    es: { play: 'Reproducir vídeo: {name}', unavailable: 'No se puede previsualizar este vídeo', video: 'Vídeo' },
    fr: { play: 'Lire la vidéo : {name}', unavailable: 'Impossible de prévisualiser cette vidéo', video: 'Vidéo' },
    de: { play: 'Video abspielen: {name}', unavailable: 'Für dieses Video ist keine Vorschau möglich', video: 'Video' },
    'pt-BR': { play: 'Reproduzir vídeo: {name}', unavailable: 'Não é possível pré-visualizar este vídeo', video: 'Vídeo' },
    ru: { play: 'Воспроизвести видео: {name}', unavailable: 'Не удалось показать превью видео', video: 'Видео' },
    ar: { play: 'تشغيل الفيديو: {name}', unavailable: 'تعذّرت معاينة هذا الفيديو', video: 'فيديو' },
    hi: { play: 'वीडियो चलाएँ: {name}', unavailable: 'इस वीडियो का पूर्वावलोकन नहीं हो सकता', video: 'वीडियो' }
};

export const VIDEO_CARD_LOCALES: readonly string[] = Object.keys(VIDEO_CARD_TEXT);

/** UI labels only; the clip's own name is inserted as it is (a `$` in it stays a `$`). */
export function videoCardText(locale: string, key: VideoCardTextKey, values: { readonly name?: string } = {}): string {
    const template = VIDEO_CARD_TEXT[locale]?.[key] || VIDEO_CARD_TEXT.en[key];
    return template.replace('{name}', () => values.name || VIDEO_CARD_TEXT[locale]?.video || VIDEO_CARD_TEXT.en.video);
}

const VIDEO_DATA_URL = /^data:video\/(?:mp4|webm|ogg|quicktime|x-m4v)[;,]/i;

/** A clip carried inside the reply itself (`data:video/mp4;base64,…`). */
export function isVideoDataUrl(url: string): boolean {
    return VIDEO_DATA_URL.test(url.trim());
}

/** A local file on a file server (`file://server/share/…`), as opposed to one on this computer (`file:///…`). */
export function isNetworkFileUrl(url: string): boolean {
    return /^file:\/\/[^/]/i.test(url.trim());
}

/** URLs a card may load by itself: the web, files on this computer, and clips carried in the reply. */
export function isLoadableVideoUrl(url: string): boolean {
    const value = url.trim();
    if (!value || /[\u0000-\u001f\u007f]/.test(value)) return false;
    return /^https?:\/\/[^\s/]/i.test(value) || /^blob:/i.test(value) || isVideoDataUrl(value) || /^file:\/\/\//i.test(value);
}

/** `1:05`, `12:30`, `1:02:03`; nothing for an unknown length. A clip shorter than a second reads `0:01`. */
export function formatVideoDuration(seconds: number | undefined): string {
    if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return '';
    const total = Math.max(1, Math.round(seconds));
    const pad = (value: number): string => String(value).padStart(2, '0');
    const hours = Math.floor(total / 3600), minutes = Math.floor(total % 3600 / 60), rest = total % 60;
    return hours ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

/**
 * Where to look for a still: a moment in (the smaller of 0.1 s and 5 % of the clip), then a quarter in (at most 1 s),
 * then the middle, each tried only when the one before showed a blank frame. A clip of unknown length gets 0.1 s and 1 s.
 */
export function videoStillTimes(duration?: number): number[] {
    if (duration === undefined || !Number.isFinite(duration) || duration <= 0) return [0.1, 1];
    const times: number[] = [];
    for (const time of [Math.min(0.1, duration * 0.05), Math.min(1, duration * 0.25), duration * 0.5]) {
        if (time > 0 && time < duration && times.every(other => Math.abs(other - time) >= 0.05)) times.push(time);
    }
    return times.length ? times : [duration / 2];
}

/** The still of a clip whose pixels cannot be read: a tenth of the way in (at most 1 s), past most fade-ins. */
export function videoElementStillTime(duration?: number): number {
    return duration !== undefined && Number.isFinite(duration) && duration > 0 ? Math.min(1, duration * 0.1) : 0.1;
}

/**
 * How much a sampled frame shows (RGBA bytes of a small copy). Nearly black (no pixel brighter than 40 of 255) or one
 * flat colour (brightness spread under 10) is blank; the score ranks candidates when every one is blank.
 */
export function videoFrameStats(rgba: ArrayLike<number>): { readonly blank: boolean; readonly score: number } {
    let min = 255, max = 0, sum = 0, count = 0;
    for (let index = 0; index + 2 < rgba.length; index += 4) {
        const luma = (rgba[index] * 54 + rgba[index + 1] * 183 + rgba[index + 2] * 19) >> 8;
        if (luma < min) min = luma;
        if (luma > max) max = luma;
        sum += luma;
        count++;
    }
    if (!count) return { blank: true, score: 0 };
    return { blank: max < 40 || max - min < 10, score: max - min + sum / count / 4 };
}

/**
 * What a read found. `frame`: a JPEG of the chosen frame. `element`: the frame cannot be read (another origin), so a
 * <video> seeked to `time` shows it itself. `sound`: the file has no picture. `failed`: it could not be decoded.
 */
export interface VideoStill {
    readonly kind: 'frame' | 'element' | 'sound' | 'failed';
    readonly poster?: string;
    readonly time?: number;
    readonly duration?: number;
    readonly width?: number;
    readonly height?: number;
}

const STILL_SAMPLE_WIDTH = 32;
const STILL_SAMPLE_HEIGHT = 18;
/** Sharp on a 2× screen for a card up to 640 CSS pixels wide; a 16:9 JPEG of it is about 100–200 KB. */
const STILL_MAX_WIDTH = 1280;
const STILL_QUALITY = 0.82;
const STILL_TIMEOUT_MS = 20_000;
const STILL_READERS = 2;
const STILL_CACHE_ENTRIES = 96;
const STILL_CACHE_CHARACTERS = 24 * 1024 * 1024;

const stills = new Map<string, VideoStill>();
let stillCharacters = 0;
const reading = new Map<string, Promise<VideoStill>>();
let readers = 0;
const waiting: (() => void)[] = [];

/** A still already read for this URL (the card and the viewer's poster use it at once, without waiting). */
export function cachedVideoStill(url: string | undefined): VideoStill | undefined {
    if (!url) return undefined;
    const still = stills.get(url);
    if (still) { stills.delete(url); stills.set(url, still); }
    return still;
}

function rememberStill(url: string, still: VideoStill): void {
    const previous = stills.get(url);
    if (previous) { stills.delete(url); stillCharacters -= previous.poster?.length || 0; }
    stills.set(url, still);
    stillCharacters += still.poster?.length || 0;
    for (const [key, value] of stills) {
        if (stills.size <= STILL_CACHE_ENTRIES && stillCharacters <= STILL_CACHE_CHARACTERS) break;
        if (key === url) continue;
        stills.delete(key);
        stillCharacters -= value.poster?.length || 0;
    }
}

/** Forgets every still (tests). */
export function clearVideoStills(): void {
    stills.clear();
    stillCharacters = 0;
}

function withReader<T>(work: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const run = (): void => {
            readers++;
            work().then(resolve, reject).finally(() => {
                readers--;
                waiting.shift()?.();
            });
        };
        if (readers < STILL_READERS) run(); else waiting.push(run);
    });
}

/**
 * The still of a clip on this computer or carried in the reply, read off-screen once per URL; concurrent asks share
 * one read. A failed read is not remembered (the file may appear later, as when a render is still writing it).
 */
export function readVideoStill(url: string): Promise<VideoStill> {
    const known = cachedVideoStill(url);
    if (known) return Promise.resolve(known);
    let pending = reading.get(url);
    if (!pending) {
        pending = withReader(() => decodeVideoStill(url)).then(still => {
            reading.delete(url);
            if (still.kind !== 'failed') rememberStill(url, still);
            return still;
        }, () => {
            reading.delete(url);
            return { kind: 'failed' } as VideoStill;
        });
        reading.set(url, pending);
    }
    return pending;
}

/** Stops a media element and lets its decoder and file go (a viewer closing, an off-screen read finishing). */
export function releaseMediaElement(media: HTMLMediaElement | null | undefined): void {
    if (!media) return;
    try {
        media.pause();
        media.removeAttribute('src');
        media.load();
    } catch {
        /* already gone */
    }
}

/**
 * Pauses every clip or sound that is playing aloud (not muted) inside `root`, except `keep` and what is inside it: a
 * clip opened large never plays over another one.
 */
export function pauseAudibleMedia(root: ParentNode | null | undefined, keep?: Element | null): void {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    for (const media of Array.from(root.querySelectorAll<HTMLMediaElement>('video, audio'))) {
        if (keep && (media === keep || keep.contains(media))) continue;
        if (media.paused || media.muted || media.volume === 0) continue;
        try { media.pause(); } catch { /* a detached element */ }
    }
}

function sampleVideoFrame(video: HTMLVideoElement): { readonly blank: boolean; readonly score: number } {
    const canvas = video.ownerDocument.createElement('canvas');
    canvas.width = STILL_SAMPLE_WIDTH;
    canvas.height = STILL_SAMPLE_HEIGHT;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('VIDEO_STILL_NO_CANVAS');
    context.drawImage(video, 0, 0, STILL_SAMPLE_WIDTH, STILL_SAMPLE_HEIGHT);
    // Throws a SecurityError when the clip came from another origin (the canvas is tainted).
    return videoFrameStats(context.getImageData(0, 0, STILL_SAMPLE_WIDTH, STILL_SAMPLE_HEIGHT).data);
}

function drawVideoStill(video: HTMLVideoElement): string {
    const width = Math.min(STILL_MAX_WIDTH, video.videoWidth);
    const height = Math.max(1, Math.round(video.videoHeight * width / video.videoWidth));
    const canvas = video.ownerDocument.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('VIDEO_STILL_NO_CANVAS');
    context.drawImage(video, 0, 0, width, height);
    const poster = canvas.toDataURL('image/jpeg', STILL_QUALITY);
    if (!/^data:image\//.test(poster)) throw new Error('VIDEO_STILL_NOT_ENCODED');
    return poster;
}

function decodeVideoStill(url: string): Promise<VideoStill> {
    if (typeof document === 'undefined') return Promise.resolve({ kind: 'failed' });
    const video = document.createElement('video');
    if (typeof video.canPlayType !== 'function') return Promise.resolve({ kind: 'failed' });
    return new Promise<VideoStill>(resolve => {
        let times: number[] = [];
        let index = 0;
        let settling = false;
        let best: { readonly time: number; readonly score: number } | undefined;
        let duration: number | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = (still: VideoStill): void => {
            if (timer !== undefined) clearTimeout(timer);
            timer = undefined;
            video.onloadedmetadata = null;
            video.onseeked = null;
            video.onerror = null;
            releaseMediaElement(video);
            resolve(still);
        };
        const seek = (time: number): void => {
            try { video.currentTime = time; } catch { finish({ kind: 'failed' }); }
        };
        timer = setTimeout(() => finish({ kind: 'failed' }), STILL_TIMEOUT_MS);
        video.onerror = () => finish({ kind: 'failed' });
        video.onloadedmetadata = () => {
            duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : undefined;
            if (!video.videoWidth || !video.videoHeight) {
                finish({ kind: 'sound', duration });
                return;
            }
            times = videoStillTimes(duration);
            seek(times[0]);
        };
        video.onseeked = () => {
            const time = video.currentTime;
            const size = { duration, width: video.videoWidth, height: video.videoHeight };
            try {
                if (!settling) {
                    const stats = sampleVideoFrame(video);
                    if (!best || stats.score > best.score) best = { time, score: stats.score };
                    if (stats.blank && index + 1 < times.length) {
                        seek(times[++index]);
                        return;
                    }
                    // Every candidate blank: the one that showed the most.
                    if (stats.blank && Math.abs(best.time - time) > 0.001) {
                        settling = true;
                        seek(best.time);
                        return;
                    }
                }
                finish({ kind: 'frame', poster: drawVideoStill(video), time, ...size });
            } catch {
                finish({ kind: 'element', time: settling ? time : times[0], ...size });
            }
        };
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.src = url;
    });
}

export interface VideoStillOptions {
    /** What the card plays: the web, a file on this computer (`file:///…`) or a clip carried in the reply. */
    readonly url: string;
    readonly locale: string;
    /** A poster the reply gave (an image URL): shown at once instead of a frame. */
    readonly poster?: string;
    /** Takes the clip's shape once known (`--nmx-video-ratio`); a card whose shape is already set leaves it out. */
    readonly ratioTarget?: HTMLElement;
    /** Start decoding immediately instead of waiting for streaming Markdown to settle. */
    readonly immediate?: boolean;
    /** Called once when the clip cannot be shown (a link's preview removes itself; an embed keeps its error state). */
    readonly onUnavailable?: () => void;
}

const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8.6 5.4c0-.83.9-1.35 1.62-.92l9.3 5.6a1.07 1.07 0 0 1 0 1.84l-9.3 5.6A1.07 1.07 0 0 1 8.6 16.6Z"/></svg>';
/** Read the still only once a card has stayed on the page this long: a reply still streaming redraws its last part. */
const STILL_START_DELAY_MS = 220;

function element(document: Document, tag: string, className: string): HTMLElement {
    const node = document.createElement(tag);
    node.setAttribute('class', className);
    return node;
}

/**
 * Fills a card's still area (`.nmx-video-card-still`, owned entirely by this function) and keeps it current: loading,
 * then the picture with the clip's length, or the error state. Returns a function that stops it and empties the area.
 * The state is the area's `data-state`: loading | ready | failed.
 */
export function mountVideoStill(still: HTMLElement, options: VideoStillOptions): () => void {
    const document = still.ownerDocument;
    const web = /^https?:/i.test(options.url);
    let stopped = false;
    let usePoster = Boolean(options.poster);
    let startTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let player: HTMLVideoElement | undefined;
    still.replaceChildren();
    still.setAttribute('data-state', 'loading');
    const play = element(document, 'span', 'nmx-video-card-play');
    play.setAttribute('aria-hidden', 'true');
    play.innerHTML = PLAY_ICON;
    const time = element(document, 'span', 'nmx-video-card-time');
    time.setAttribute('aria-hidden', 'true');
    time.setAttribute('dir', 'ltr');
    still.append(play, time);

    const describe = (duration: number | undefined, width: number | undefined, height: number | undefined): void => {
        const length = formatVideoDuration(duration);
        if (length) time.textContent = length;
        if (width && height) {
            const ratio = String(Number((width / height).toFixed(4)));
            const style = options.ratioTarget?.style as CSSStyleDeclaration | undefined;
            style?.setProperty('--nmx-video-ratio', ratio);
            if (options.ratioTarget?.classList?.contains('nmx-comic-chat-media')) {
                style?.setProperty('--nmx-media-ratio', ratio);
            }
        }
    };
    const ready = (): void => { if (!stopped && still.getAttribute('data-state') === 'loading') still.setAttribute('data-state', 'ready'); };
    const fail = (): void => {
        if (stopped || still.getAttribute('data-state') === 'failed') return;
        still.setAttribute('data-state', 'failed');
        const note = element(document, 'span', 'nmx-video-card-note');
        note.textContent = videoCardText(options.locale, 'unavailable');
        still.append(note);
        options.onUnavailable?.();
    };
    const showPicture = (src: string, onError: () => void): void => {
        const image = element(document, 'img', 'nmx-video-card-picture') as HTMLImageElement;
        image.setAttribute('alt', '');
        image.setAttribute('draggable', 'false');
        image.setAttribute('decoding', 'async');
        image.addEventListener('load', ready, { once: true });
        image.addEventListener('error', () => { image.remove(); if (!stopped) onError(); }, { once: true });
        image.setAttribute('src', src);
        still.append(image);
    };
    // The clip's own <video>, seeked to the still and kept paused: for the web, and for a frame no canvas may read.
    const showElement = (at: number | undefined): void => {
        if (stopped || player) return;
        const video = element(document, 'video', 'nmx-video-card-picture') as HTMLVideoElement;
        player = video;
        video.muted = true;
        video.playsInline = true;
        video.preload = 'metadata';
        for (const name of ['muted', 'playsinline', 'disablepictureinpicture']) video.setAttribute(name, '');
        video.setAttribute('preload', 'metadata');
        video.setAttribute('tabindex', '-1');
        video.setAttribute('aria-hidden', 'true');
        video.addEventListener('loadedmetadata', () => {
            const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : undefined;
            describe(duration, video.videoWidth, video.videoHeight);
            if (!video.videoWidth || !video.videoHeight) { ready(); return; }
            try { video.currentTime = at ?? videoElementStillTime(duration); } catch { ready(); }
        }, { once: true });
        video.addEventListener('seeked', ready, { once: true });
        // A clip that never reports its seek still shows the frame it decoded first, rather than the loading shimmer.
        video.addEventListener('loadeddata', () => { setTimeout(ready, 700); }, { once: true });
        video.addEventListener('error', fail, { once: true });
        video.setAttribute('src', options.url);
        still.append(video);
    };
    const apply = (result: VideoStill): void => {
        if (stopped) return;
        describe(result.duration, result.width, result.height);
        // A poster the reply gave is the still; the read only told the clip's length.
        if (usePoster) return;
        if (result.kind === 'frame' && result.poster) showPicture(result.poster, () => showElement(result.time));
        else if (result.kind === 'element') showElement(result.time);
        else if (result.kind === 'sound') { still.setAttribute('data-sound', 'true'); ready(); }
        else fail();
    };
    const start = (): void => {
        startTimer = undefined;
        if (stopped) return;
        // A card not on the page yet waits (a few seconds at most); one replaced while a reply streams never reads.
        if ((still as { isConnected?: boolean }).isConnected === false) {
            if (++attempts < 30) startTimer = setTimeout(start, STILL_START_DELAY_MS);
            return;
        }
        if (web) showElement(undefined);
        else void readVideoStill(options.url).then(apply);
    };
    const begin = (): void => {
        const known = web ? undefined : cachedVideoStill(options.url);
        if (known) apply(known);
        else if (options.immediate) start();
        else if (startTimer === undefined) startTimer = setTimeout(start, STILL_START_DELAY_MS);
    };

    if (!isLoadableVideoUrl(options.url)) fail();
    else if (usePoster) {
        showPicture(options.poster!, () => { usePoster = false; begin(); });
        // The length comes from a read on this computer; a clip on the web is not fetched just for it.
        if (!web) begin();
    } else begin();
    return () => {
        stopped = true;
        if (startTimer !== undefined) clearTimeout(startTimer);
        startTimer = undefined;
        releaseMediaElement(player);
        player = undefined;
        still.replaceChildren();
    };
}

export const fillVideoCardStill = mountVideoStill;

/** Records a still for a URL: the read of another card, or a test. */
export function primeVideoStill(url: string, still: VideoStill): void {
    if (still.kind !== 'failed') rememberStill(url, still);
}

export interface VideoCardOptions extends VideoStillOptions {
    /** The clip's name: the card's label ("Play video: name") and, without a path, its tooltip. */
    readonly label: string;
    /** The full path (or web address) shown on hover and handed to the viewer. */
    readonly path?: string;
    /** A link's preview below its paragraph rather than a clip written into the reply. */
    readonly preview?: boolean;
}

/**
 * A card for a clip in rendered Markdown (built as DOM, since replies are HTML): a button, so Enter and Space open it,
 * that carries what the widget's click handler needs to open the viewer.
 */
export function createVideoCard(document: Document, options: VideoCardOptions): HTMLElement {
    const card = element(document, 'button', `nmx-video-card is-inline${options.preview ? ' is-preview' : ''}`);
    card.setAttribute('type', 'button');
    card.setAttribute('data-nmx-video-src', options.url);
    card.setAttribute('data-nmx-label', options.label);
    if (options.path) card.setAttribute('data-nmx-path', options.path);
    card.setAttribute('data-nmx-gallery', 'video');
    card.setAttribute('aria-label', videoCardText(options.locale, 'play', { name: options.label }));
    card.setAttribute('title', options.path || options.label);
    const still = element(document, 'span', 'nmx-video-card-still');
    card.append(still);
    mountVideoStill(still, { ...options, ratioTarget: card });
    return card;
}
