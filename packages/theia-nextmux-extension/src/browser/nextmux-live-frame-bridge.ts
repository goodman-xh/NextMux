/**
 * Keeps an app tab's live picture moving when its window capture stalls or keeps repeating an old frame.
 *
 * The capture can stay open while its picture stands still: the window went to another Space or virtual desktop, was
 * minimized or hidden, the system capture stopped sending frames, or (Windows 11's texture path) it keeps sending its
 * last frame. When no new frame arrives for STALL_MS, the window's own snapshots are drawn on a canvas over the video
 * (one request at a time, 4–8 a second, fewer while nothing changes) until its frames come again. A capture that
 * repeats its last frame is caught by a slow probe that looks at the window itself while the video stands still.
 *
 * This is the Stage 2B bridge of the torn-off tab window (apps/desktop/computer-tab-window.js: watchFrames,
 * engageBridge, probe, handBack, tick), with the same constants, for the tab inside the conversation. Pure DOM: the
 * caller owns the video, the canvas and where the snapshots come from.
 */

const STALL_MS = 600, WATCH_MS = 150, RESUME_FRAMES = 3;
const BRIDGE_FAST_MS = 125, BRIDGE_SLOW_MS = 250, BRIDGE_IDLE_MS = 500, BRIDGE_REST_MS = 1000;
// A window that has not changed for a while (an idle app's still picture also stops its frames): every 2 s.
const BRIDGE_QUIET_MS = 2000;
// A video thumbnail reads a whole frame back from the GPU: once a second is enough to tell a still picture.
const STILL_CHECK_MS = 1000, STILL_FOR_MS = 1000, PROBE_MS = 2000;
// After the user's input the window should change: if the video still shows the same picture this long after the last
// input (a burst of hover moves counts once, after it ends), the probe looks at the window at once instead of waiting.
const NUDGE_SETTLE_MS = 250;
// Mean difference of 32×18 grey thumbnails (0–255) of a picture's inner part (the edges differ between captures):
// up to STILL_DIFF it stands still; past CHANGED_DIFF the window changed between two snapshots; past MISMATCH_DIFF a
// snapshot shows something else than the video.
const THUMB_W = 32, THUMB_H = 18, THUMB_INSET = 0.06, STILL_DIFF = 1.5, CHANGED_DIFF = 2.5, MISMATCH_DIFF = 12;
// A stalled video stays the picture (it is sharper than any snapshot) until a snapshot differs from it somewhere by
// more than SHOWN_DIFF: a typed word does, JPEG noise or a blinking caret does not.
const SHOWN_DIFF = 8;
// The probe only needs a thumbnail; captures that cannot work here are not asked again.
const PROBE_SIZE = 640;
const LASTING_ERRORS: ReadonlySet<string> = new Set(['capture_permission_required', 'live_view_unsupported', 'snapshot_unsupported']);
// The host shares one capture per window and retries a busy one itself; one that still comes back busy is "no new
// picture yet", asked again at the slow pace, never a failure.
const TRANSIENT_ERRORS: ReadonlySet<string> = new Set(['capture_busy']);
/**
 * Bridged this long while the window keeps changing: the capture itself is stuck, so the tab restarts it (with the
 * watchdog's backoff). Matches LIVE_FRAME_STALL_MS in nextmux-conversation-tabs-view.tsx.
 */
export const LIVE_BRIDGE_LONG_STALL_MS = 4_000;

/** A window snapshot: JPEG/PNG bytes (`binary: true`) or, from an older host, base64 `data`. */
export interface LiveBridgeSnapshot {
    readonly ok: boolean;
    readonly mimeType?: string;
    readonly data?: string;
    readonly bytes?: Uint8Array;
    readonly width?: number;
    readonly height?: number;
    readonly error?: string;
}

export interface LiveBridgeOptions {
    /** A fresh picture of the window, at most `maxSize` px wide or high. Ask for bytes (`binary: true`) where the host has them. */
    readonly snapshot: (maxSize: number) => Promise<LiveBridgeSnapshot | undefined>;
    /** The picture's size in device pixels, at most 2048. */
    readonly maxSize: () => number;
    /** The canvas became (true) or stopped being (false) the picture. */
    readonly onShown?: (shown: boolean) => void;
    /** Bridged for LIVE_BRIDGE_LONG_STALL_MS while the window keeps changing (once per bridge). */
    readonly onLongStall?: () => void;
    /** False while the bridge has nothing to do (the tab already shows the window's snapshots as its stream). */
    readonly enabled?: () => boolean;
    readonly now?: () => number;
    readonly setTimeout?: (callback: () => void, ms: number) => unknown;
    readonly clearTimeout?: (handle: unknown) => void;
}

/** A decoded snapshot, drawable on a canvas; `release` frees it (an ImageBitmap's memory) once drawn. */
export interface DecodedWindowPicture {
    readonly image: CanvasImageSource;
    readonly width: number;
    readonly height: number;
    readonly release: () => void;
}

const pictureType = (shot: Pick<LiveBridgeSnapshot, 'mimeType'>): string =>
    typeof shot.mimeType === 'string' && shot.mimeType.startsWith('image/') ? shot.mimeType : 'image/jpeg';

/**
 * Decodes a snapshot off the main thread where it can: bytes through createImageBitmap(Blob); base64 `data` (a host
 * without `binary`) through an image element, never through a per-character atob copy.
 */
export async function decodeWindowPicture(shot: Pick<LiveBridgeSnapshot, 'mimeType' | 'data' | 'bytes'> | undefined): Promise<DecodedWindowPicture | undefined> {
    if (!shot) return undefined;
    const type = pictureType(shot);
    if (shot.bytes && shot.bytes.byteLength > 0) {
        if (typeof createImageBitmap !== 'function' || typeof Blob !== 'function') return undefined;
        try {
            const bitmap = await createImageBitmap(new Blob([shot.bytes as unknown as BlobPart], { type }));
            return { image: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
        } catch { return undefined; }
    }
    if (typeof shot.data !== 'string' || !shot.data || typeof Image !== 'function') return undefined;
    const image = new Image();
    image.decoding = 'async';
    image.src = `data:${type};base64,${shot.data}`;
    try {
        if (typeof image.decode === 'function') await image.decode();
        else await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(); });
    } catch { return undefined; }
    const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
    return width > 0 && height > 0 ? { image, width, height, release: () => { image.src = ''; } } : undefined;
}

const bridgedVideos = new WeakSet<object>();
const bridgeNudgers = new WeakMap<object, () => void>();
/** Whether a bridge canvas is this video's picture now: its own frames are not the window as it is. */
export function liveBridgeShown(video: object | null | undefined): boolean {
    return Boolean(video && bridgedVideos.has(video));
}
/** After the user's input: a bridge on show asks for its next picture now; else a still video soon gets a probe. */
export function nudgeLiveVideoBridge(video: object | null | undefined): void {
    if (video) bridgeNudgers.get(video)?.();
}

type Thumb = Float32Array;
let thumbContext: CanvasRenderingContext2D | null | undefined;
function thumbnail(source: CanvasImageSource, width: number, height: number): Thumb | undefined {
    try {
        if (!(width > 0 && height > 0) || typeof document === 'undefined') return undefined;
        if (thumbContext === undefined) {
            const canvas = document.createElement('canvas');
            canvas.width = THUMB_W;
            canvas.height = THUMB_H;
            thumbContext = canvas.getContext('2d', { willReadFrequently: true });
        }
        if (!thumbContext) return undefined;
        thumbContext.clearRect?.(0, 0, THUMB_W, THUMB_H);
        thumbContext.drawImage(source, width * THUMB_INSET, height * THUMB_INSET, width * (1 - 2 * THUMB_INSET), height * (1 - 2 * THUMB_INSET), 0, 0, THUMB_W, THUMB_H);
        const pixels = thumbContext.getImageData(0, 0, THUMB_W, THUMB_H).data;
        const grey = new Float32Array(THUMB_W * THUMB_H);
        for (let index = 0; index < grey.length; index++) {
            const alpha = pixels[index * 4 + 3] ?? 255;
            grey[index] = alpha < 8
                ? -1
                : pixels[index * 4] * 0.299 + pixels[index * 4 + 1] * 0.587 + pixels[index * 4 + 2] * 0.114;
        }
        return grey;
    } catch { return undefined; }
}
const difference = (a: Thumb | undefined, b: Thumb | undefined): number => {
    if (!a || !b || a.length !== b.length) return Infinity;
    let sum = 0;
    for (let index = 0; index < a.length; index++) sum += Math.abs(Math.max(0, a[index]) - Math.max(0, b[index]));
    return sum / a.length;
};
const peakDifference = (a: Thumb | undefined, b: Thumb | undefined): number => {
    if (!a || !b || a.length !== b.length) return Infinity;
    let peak = 0;
    for (let index = 0; index < a.length; index++) peak = Math.max(peak, Math.abs(Math.max(0, a[index]) - Math.max(0, b[index])));
    return peak;
};
// A capture that failed can come back transparent, pure black, or pure white: it never replaces a picture. (An unreadable thumbnail is not blank.)
const blank = (thumb: Thumb | undefined): boolean => {
    if (!thumb || !thumb.length) return false;
    let allBlackOrTransparent = true;
    let allWhite = true;
    for (let index = 0; index < thumb.length; index++) {
        const value = thumb[index];
        if (value >= 0) {
            if (value > 4) allBlackOrTransparent = false;
            if (value < 252) allWhite = false;
        } else {
            allWhite = false;
        }
        if (!allBlackOrTransparent && !allWhite) return false;
    }
    return allBlackOrTransparent || allWhite;
};

/** The same snapshot again (the window did not change): compared without decoding it. */
function samePicture(shot: LiveBridgeSnapshot, last: { bytes?: Uint8Array; data?: string } | undefined): boolean {
    if (!last) return false;
    if (shot.bytes && last.bytes) {
        if (shot.bytes.byteLength !== last.bytes.byteLength) return false;
        for (let index = 0; index < shot.bytes.byteLength; index++) if (shot.bytes[index] !== last.bytes[index]) return false;
        return true;
    }
    return typeof shot.data === 'string' && shot.data !== '' && shot.data === last.data;
}
const hasPicture = (shot: LiveBridgeSnapshot): boolean =>
    Boolean(shot.ok && (shot.bytes && shot.bytes.byteLength > 0 || typeof shot.data === 'string' && shot.data));

interface Bridge {
    readonly reason: 'stall' | 'stale';
    readonly total: number | undefined;
    readonly presented: number;
    frozen: Thumb | undefined;
    last: { bytes?: Uint8Array; data?: string } | undefined;
    same: number;
    failures: number;
    timer: unknown;
    shown: boolean;
    shownAt: number;
    changedAt: number;
    longStallTold: boolean;
    poll?: () => Promise<void>;
}

/**
 * Watches one live video and bridges its stalls on `canvas` (rendered hidden, over the video, with pointer-events off)
 * until the returned function is called. The canvas is hidden again then. Nothing is watched where frames cannot be
 * counted (no requestVideoFrameCallback and no decoded-frame count): a still picture could not be told from a frozen one.
 */
export function bridgeLiveVideo(video: HTMLVideoElement, canvas: HTMLCanvasElement, options: LiveBridgeOptions): () => void {
    const now = options.now ?? Date.now;
    const later = options.setTimeout ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
    const cancel = options.clearTimeout ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    let stopped = false;
    let inFlight: Promise<LiveBridgeSnapshot | undefined> | undefined;
    // One request at a time, shared by the probe and the bridge.
    const fetchSnapshot = (maxSize: number): Promise<LiveBridgeSnapshot | undefined> => {
        if (inFlight) return inFlight;
        let request: Promise<LiveBridgeSnapshot | undefined>;
        try { request = Promise.resolve(options.snapshot(maxSize)); } catch (error) { request = Promise.reject(error); }
        inFlight = request;
        const settled = (): void => { if (inFlight === request) inFlight = undefined; };
        request.then(settled, settled);
        return request;
    };
    const snapshotSize = (): number => Math.max(64, Math.min(2048, Math.round(options.maxSize() || 1280)));
    const videoThumbnail = (): Thumb | undefined => thumbnail(video, video.videoWidth, video.videoHeight);
    const videoFrameTotal = (): number | undefined => {
        try {
            const quality = typeof video.getVideoPlaybackQuality === 'function' ? video.getVideoPlaybackQuality() : undefined;
            if (quality && Number.isFinite(quality.totalVideoFrames)) return quality.totalVideoFrames;
        } catch { /* not decoding yet */ }
        const decoded = (video as HTMLVideoElement & { webkitDecodedFrameCount?: number }).webkitDecodedFrameCount;
        return typeof decoded === 'number' && Number.isFinite(decoded) ? decoded : undefined;
    };
    const frameCallbacks = typeof video.requestVideoFrameCallback === 'function';
    if (!frameCallbacks && videoFrameTotal() === undefined) return () => undefined;

    const watching = (): boolean => !stopped && (typeof document === 'undefined' || document.visibilityState !== 'hidden') && options.enabled?.() !== false;
    const started = now();
    const current = {
        timer: undefined as unknown, frameHandle: undefined as number | undefined, total: videoFrameTotal(), presented: 0,
        reported: undefined as number | undefined, lastFrameAt: started, probeAt: started, probing: false, probeOff: false,
        // The capture says the window cannot be viewed: nothing is bridged again until the video moves.
        notViewable: false,
        thumbAt: started, stillSince: started, stillThumb: undefined as Thumb | undefined, nudgedAt: undefined as number | undefined,
        probeShot: undefined as Thumb | undefined, probeLast: undefined as { bytes?: Uint8Array; data?: string } | undefined,
        bridge: undefined as Bridge | undefined
    };
    const setShown = (shown: boolean): void => {
        if (canvas.hidden === !shown && bridgedVideos.has(video) === shown) return;
        canvas.hidden = !shown;
        if (shown) bridgedVideos.add(video); else bridgedVideos.delete(video);
        options.onShown?.(shown);
    };
    // A fresh watch starts from the live video.
    setShown(false);
    const freshFrames = (bridge: Bridge): number => Math.max(
        Number.isFinite(current.total) && Number.isFinite(bridge.total) ? current.total! - bridge.total! : 0,
        current.presented - bridge.presented);
    // A frame or two while bridged (the window changed, the capture is waking up): the next snapshot is asked for now,
    // not after a backed-off wait, so what the user types shows at once.
    const kickBridge = (bridge: Bridge): void => {
        bridge.same = 0;
        if (!bridge.timer || inFlight) return;
        cancel(bridge.timer);
        bridge.timer = later(() => void bridge.poll?.(), 0);
    };
    const paint = (picture: DecodedWindowPicture): void => {
        // Drawn at the video's own size when the shapes match (snapshots stop at 2048 px), so the picture keeps its size
        // and place when it takes over.
        let width = picture.width, height = picture.height;
        const videoWidth = video.videoWidth, videoHeight = video.videoHeight;
        if (videoWidth > 0 && videoHeight > 0 && Math.abs(width / height - videoWidth / videoHeight) <= 0.01 * (videoWidth / videoHeight)) {
            width = videoWidth;
            height = videoHeight;
        }
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        try { canvas.getContext('2d')?.drawImage(picture.image, 0, 0, width, height); } catch { /* the last picture stays */ }
    };
    // The video's picture changed (or watching began): its stillness and the probe's notes start over.
    const pictureMoved = (at: number, thumb: Thumb | undefined): void => {
        current.thumbAt = at;
        current.stillSince = at;
        current.stillThumb = thumb;
        current.probeShot = undefined;
        current.probeLast = undefined;
    };
    const reveal = (bridge: Bridge): void => {
        if (bridge.shown) return;
        bridge.shown = true;
        bridge.shownAt = now();
        setShown(true);
    };
    // The video moves again: it is the picture once more.
    const handBack = (): void => {
        const bridge = current.bridge;
        if (!bridge) return;
        current.bridge = undefined;
        cancel(bridge.timer);
        setShown(false);
        const at = now();
        current.lastFrameAt = at;
        current.probeAt = at;
        pictureMoved(at, undefined);
    };
    const engage = (reason: Bridge['reason'], seed?: { picture: DecodedWindowPicture; last: Bridge['last']; frozen: Thumb | undefined }): void => {
        if (!watching() || current.bridge) { seed?.picture.release(); return; }
        const at = now();
        const bridge: Bridge = { reason, total: current.total, presented: current.presented, frozen: seed ? seed.frozen : videoThumbnail(), last: seed?.last,
            same: 0, failures: 0, timer: undefined, shown: false, shownAt: 0, changedAt: at, longStallTold: false };
        current.bridge = bridge;
        // The probe's snapshot already shows the window moved on: it is the picture at once. A stalled video stays the
        // picture until a snapshot shows something it does not (an idle window keeps its sharp video).
        if (seed) {
            paint(seed.picture);
            seed.picture.release();
            reveal(bridge);
        }
        const bridging = (): boolean => watching() && current.bridge === bridge;
        const poll = bridge.poll = async (): Promise<void> => {
            bridge.timer = undefined;
            if (!bridging()) return;
            const startedAt = now();
            // Until the bridge is the picture, a thumbnail-sized snapshot tells whether the window moved on; the full
            // size is fetched once it shows (an idle window, whose still picture also stops its frames, costs little).
            const small = !bridge.shown;
            let shot: LiveBridgeSnapshot | undefined;
            try { shot = await fetchSnapshot(small ? PROBE_SIZE : snapshotSize()); } catch { shot = undefined; }
            if (!bridging()) return;
            if (shot && hasPicture(shot)) {
                bridge.failures = 0;
                const same = samePicture(shot, bridge.last);
                bridge.same = same ? bridge.same + 1 : 0;
                if (!same) {
                    bridge.last = shot.bytes ? { bytes: shot.bytes } : { data: shot.data };
                    bridge.changedAt = now();
                    const picture = await decodeWindowPicture(shot);
                    if (!bridging()) { picture?.release(); return; }
                    if (picture) {
                        const thumb = thumbnail(picture.image, picture.width, picture.height);
                        if (!blank(thumb) && (bridge.shown || peakDifference(thumb, bridge.frozen) > SHOWN_DIFF)) {
                            paint(picture);
                            reveal(bridge);
                        }
                        picture.release();
                    }
                }
                // Shown for a while and the window still changes: the capture itself is stuck.
                if (bridge.shown && !bridge.longStallTold && now() - bridge.shownAt >= LIVE_BRIDGE_LONG_STALL_MS && now() - bridge.changedAt < BRIDGE_REST_MS * 2) {
                    bridge.longStallTold = true;
                    options.onLongStall?.();
                    if (!bridging()) return;
                }
                // Revealed with a thumbnail-sized picture: the full-size one follows at once.
                if (small && bridge.shown) { bridge.timer = later(() => void poll(), 0); return; }
                // 4–8 pictures a second for a window that changes, fewer for one that does not; a slow capture is never
                // asked again sooner than half its own time.
                const latency = now() - startedAt;
                const pace = bridge.same >= 16 ? BRIDGE_QUIET_MS : bridge.same >= 8 ? BRIDGE_REST_MS : bridge.same >= 3 ? BRIDGE_IDLE_MS
                    : Math.min(BRIDGE_SLOW_MS, Math.max(BRIDGE_FAST_MS, latency * 1.5));
                bridge.timer = later(() => void poll(), Math.max(16, pace - latency, latency / 2));
                return;
            }
            const error = shot?.error || '';
            if (TRANSIENT_ERRORS.has(error)) { bridge.timer = later(() => void poll(), BRIDGE_SLOW_MS); return; }
            bridge.failures++;
            // A window that cannot be captured any more: the video stays the picture and the tab's own checks take over;
            // nothing is bridged again until the video presents a new frame.
            if (error === 'window_not_viewable' && bridge.failures >= 2) { handBack(); current.notViewable = true; return; }
            // A capture that cannot work here is not asked again (the video stays the picture); a failing one is asked less
            // often, and never sooner than half the time it took to fail.
            if (LASTING_ERRORS.has(error)) return;
            bridge.timer = later(() => void poll(), Math.max(Math.min(BRIDGE_REST_MS, 150 + bridge.failures * 100), (now() - startedAt) / 2));
        };
        void poll();
    };
    // The video has stood still for a while: does the window itself still look like it?
    const probe = async (): Promise<void> => {
        current.probing = true;
        current.probeAt = now();
        try {
            let shot: LiveBridgeSnapshot | undefined;
            try { shot = await fetchSnapshot(PROBE_SIZE); } catch { shot = undefined; }
            if (shot?.error && LASTING_ERRORS.has(shot.error)) current.probeOff = true;
            if (shot?.error === 'window_not_viewable') current.notViewable = true;
            if (!watching() || current.bridge || !shot || !hasPicture(shot) || samePicture(shot, current.probeLast)) return;
            const picture = await decodeWindowPicture(shot);
            if (!picture) return;
            if (!watching() || current.bridge) { picture.release(); return; }
            const thumb = thumbnail(picture.image, picture.width, picture.height);
            // Without a readable thumbnail nothing can be compared: the probe tells nothing.
            if (!thumb || blank(thumb)) { picture.release(); return; }
            const previous = current.probeShot;
            const last = shot.bytes ? { bytes: shot.bytes } : { data: shot.data };
            current.probeShot = thumb;
            current.probeLast = last;
            if (difference(thumb, current.stillThumb) > MISMATCH_DIFF || previous && difference(thumb, previous) > CHANGED_DIFF) {
                // The video may have started moving while the window was captured: then it is live after all.
                const still = videoThumbnail();
                if (still && !blank(still) && difference(still, current.stillThumb) > STILL_DIFF) { picture.release(); pictureMoved(now(), still); return; }
                engage('stale', { picture, last, frozen: current.stillThumb });
                return;
            }
            picture.release();
        } finally { current.probing = false; }
    };
    const videoLooksNonBlack = (): boolean => {
        const thumb = videoThumbnail();
        return !(thumb && blank(thumb));
    };
    const tick = (): void => {
        current.timer = undefined;
        if (!watching()) {
            // Switched off while running (the tab moved to its snapshot stream): the video, or that stream, is the picture.
            if (!stopped && options.enabled?.() === false) { if (current.bridge) cancel(current.bridge.timer); current.bridge = undefined; setShown(false); }
            return;
        }
        const at = now();
        const total = videoFrameTotal();
        if (total !== undefined && total !== current.total) {
            current.total = total;
            current.lastFrameAt = at;
            current.notViewable = false;
        }
        const bridge = current.bridge;
        // The user's input ended a while ago (a burst of hover moves is one input, counted once it stops).
        // A probe still running may have looked before the input: the nudge waits for it to finish.
        const nudgeSettled = current.nudgedAt !== undefined && at - current.nudgedAt >= NUDGE_SETTLE_MS && !current.probing;
        if (bridge?.reason === 'stall') {
            if (freshFrames(bridge) >= RESUME_FRAMES && videoLooksNonBlack()) handBack();
            else if (total !== undefined && current.lastFrameAt === at) {
                if (!bridge.shown) bridge.frozen = videoThumbnail() ?? bridge.frozen;
                kickBridge(bridge);
            }
        } else if (bridge) {
            // A repeating capture keeps sending its old picture: it is back once that picture changes to a non-black frame.
            if (at - current.thumbAt >= STILL_CHECK_MS) {
                current.thumbAt = at;
                const thumb = videoThumbnail();
                if (thumb && !blank(thumb) && difference(thumb, bridge.frozen) > STILL_DIFF) handBack();
            }
        } else if (at - current.lastFrameAt > STALL_MS && !current.notViewable) {
            current.nudgedAt = undefined;
            engage('stall');
        } else if (!current.notViewable && (at - current.thumbAt >= STILL_CHECK_MS || nudgeSettled)) {
            if (nudgeSettled) current.nudgedAt = undefined;
            current.thumbAt = at;
            const thumb = videoThumbnail();
            if (!thumb) {
                // Nothing readable to compare: as before, the picture counts as moving.
                pictureMoved(at, thumb);
            } else if (blank(thumb)) {
                // Pure-black video frame: probe promptly instead of stalling behind a blank picture.
                if (!current.probing && !current.probeOff && !current.notViewable && at - current.probeAt >= STILL_CHECK_MS) {
                    void probe();
                }
            } else if (difference(thumb, current.stillThumb) > STILL_DIFF) {
                pictureMoved(at, thumb);
            } else if (!current.probing && !current.probeOff && !current.notViewable
                && (nudgeSettled ? at - current.probeAt >= NUDGE_SETTLE_MS : at - current.stillSince >= STILL_FOR_MS && at - current.probeAt >= PROBE_MS)) {
                void probe();
            }
        }
        if (watching()) current.timer = later(tick, WATCH_MS);
    };
    const onFrame = (_time: number, metadata?: { readonly presentedFrames?: number }): void => {
        if (!watching()) return;
        try { current.frameHandle = video.requestVideoFrameCallback(onFrame); } catch { current.frameHandle = undefined; }
        current.lastFrameAt = now();
        current.notViewable = false;
        // Frames presented since watching began (the element's own count may include an earlier stream's).
        const reported = typeof metadata?.presentedFrames === 'number' && Number.isFinite(metadata.presentedFrames) ? metadata.presentedFrames : undefined;
        current.presented += reported !== undefined && current.reported !== undefined ? Math.max(1, reported - current.reported) : 1;
        current.reported = reported;
        const bridge = current.bridge;
        if (bridge?.reason === 'stall') {
            if (freshFrames(bridge) >= RESUME_FRAMES && videoLooksNonBlack()) { handBack(); return; }
            // The video shows this new frame itself while the canvas is off: snapshots are compared with it from now on.
            if (!bridge.shown) bridge.frozen = videoThumbnail() ?? bridge.frozen;
            kickBridge(bridge);
        }
    };
    const nudge = (): void => {
        if (!watching()) return;
        if (current.bridge) kickBridge(current.bridge);
        else current.nudgedAt = now();
    };
    bridgeNudgers.set(video, nudge);
    // The picture on show now is the baseline: a tab shown again with the capture repeating the frame it had when it was
    // hidden then gets its prompt look at the window (nudge) instead of counting that old frame as movement.
    pictureMoved(started, videoThumbnail());
    if (frameCallbacks) { try { current.frameHandle = video.requestVideoFrameCallback(onFrame); } catch { current.frameHandle = undefined; } }
    current.timer = later(tick, WATCH_MS);
    return () => {
        if (stopped) return;
        stopped = true;
        if (bridgeNudgers.get(video) === nudge) bridgeNudgers.delete(video);
        cancel(current.timer);
        if (current.bridge) cancel(current.bridge.timer);
        current.bridge = undefined;
        if (current.frameHandle !== undefined) { try { video.cancelVideoFrameCallback?.(current.frameHandle); } catch { /* already gone */ } }
        setShown(false);
    };
}
