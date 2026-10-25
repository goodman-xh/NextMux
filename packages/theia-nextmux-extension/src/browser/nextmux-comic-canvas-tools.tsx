import * as React from '@theia/core/shared/react';
import * as ReactDOM from '@theia/core/shared/react-dom';
import type { CanvasAssetVersion, CanvasFrameSelection } from '@nextmux/comic-core/canvas';
import { ImeInput } from './nextmux-ime-field';
import { focusDialogOnMount } from './nextmux-comic-canvas-logic';
import { toolText, type ToolTextKey } from './nextmux-comic-canvas-tools-text';
import { CANVAS_IMAGE_TOOLS, type CanvasImageToolId } from '@nextmux/comic-core/canvas-image-tools';
import type { ImageToolLocale } from '@nextmux/comic-core/canvas-image-presets';
import { buildCanvasGridStitchDraft, canvasCurveSampler } from '../common/nextmux-canvas-local-image-tools';
import { AI_IMAGE_TOOL_GROUPS } from './nextmux-comic-canvas-ai-tools';
import { CANVAS_ON_DEVICE_MODELS } from '../common/nextmux-canvas-on-device-models';
import { canvasText } from './nextmux-comic-canvas-text';

/**
 * 画布 media tools: local FFmpeg operations on a node's chosen result (trim, split, crop, mirror, reverse, animation export,
 * compress, audio, grid split, colour, LUT). Each produces new nodes beside the source; the source never changes.
 */

export type CanvasToolId = 'video.trim' | 'video.split' | 'video.crop' | 'video.mirror' | 'video.reverse' | 'video.export' | 'video.compress'
    | 'video.extractAudio' | 'video.videoOnly' | 'video.wav' | 'image.crop' | 'image.mirror' | 'image.convert' | 'image.gridSplit'
    | 'color.adjust' | 'color.lut' | 'audio.trim' | 'audio.wav' | 'color.curves' | 'color.transfer' | 'image.paletteExtract' | 'image.gridStitch'
    | 'image.matting' | 'image.depth' | 'video.depth';

const MENU: Readonly<Record<'image' | 'video' | 'audio', readonly { readonly section: ToolTextKey; readonly tools: readonly CanvasToolId[] }[]>> = {
    video: [
        { section: 'section.edit', tools: ['video.trim', 'video.split', 'video.crop', 'video.mirror', 'video.reverse', 'video.depth'] },
        { section: 'section.export', tools: ['video.export', 'video.compress'] },
        { section: 'section.audio', tools: ['video.extractAudio', 'video.videoOnly', 'video.wav'] },
        { section: 'section.color', tools: ['color.adjust', 'color.curves', 'color.lut'] }
    ],
    image: [
        { section: 'section.edit', tools: ['image.crop', 'image.mirror', 'image.gridSplit', 'image.matting', 'image.depth'] },
        { section: 'section.export', tools: ['image.convert', 'image.paletteExtract'] },
        { section: 'section.color', tools: ['color.adjust', 'color.curves', 'color.transfer', 'color.lut'] }
    ],
    audio: [{ section: 'section.audio', tools: ['audio.trim', 'audio.wav'] }]
};

/** Tools that run straight away: nothing to choose. */
const IMMEDIATE = new Set<CanvasToolId>(['video.mirror', 'video.reverse', 'video.videoOnly', 'video.wav', 'image.mirror', 'audio.wav']);

/** Keep node menus below their toolbar, including when it moves beyond the visible board. */
function useCanvasToolMenuPlacement(anchor: React.RefObject<HTMLSpanElement>, menu: React.RefObject<HTMLDivElement>): {
    readonly host: HTMLElement | undefined; readonly place: React.CSSProperties | undefined;
} {
    const [host, setHost] = React.useState<HTMLElement>();
    const [place, setPlace] = React.useState<React.CSSProperties>();
    React.useLayoutEffect(() => { setHost(anchor.current?.closest<HTMLElement>('.nmx-board') ?? undefined); }, []);
    React.useLayoutEffect(() => {
        const toolbar = anchor.current?.parentElement, body = menu.current;
        if (!toolbar || !host || !body) return;
        const measure = (): void => {
            const bar = toolbar.getBoundingClientRect(), board = host.getBoundingClientRect();
            const left = bar.right - board.left - host.clientLeft + host.scrollLeft - body.offsetWidth;
            const top = bar.bottom - board.top - host.clientTop + host.scrollTop + 6;
            // Limit the scroll area to the board itself, never to the space left beside a moving node.
            const maxHeight = Math.max(1, host.clientHeight - 16);
            setPlace(current => current?.left === left && current.top === top && current.maxHeight === maxHeight
                ? current : { left, top, maxHeight });
        };
        measure();
        const resize = new ResizeObserver(measure);
        resize.observe(toolbar); resize.observe(host); resize.observe(body);
        // NodeToolbar updates its own transform for both node dragging and viewport pan/zoom.
        // Read after that update instead of measuring its previous transform in a viewport effect.
        const position = new MutationObserver(measure);
        position.observe(toolbar, { attributes: true, attributeFilter: ['style', 'class'] });
        window.addEventListener('resize', measure);
        document.addEventListener('scroll', measure, true);
        return () => { resize.disconnect(); position.disconnect(); window.removeEventListener('resize', measure);
            document.removeEventListener('scroll', measure, true); };
    }, [host]);
    return { host, place };
}

export function ToolMenu(props: { readonly locale: string; readonly kind: 'image' | 'video' | 'audio'; readonly onPick: (tool: CanvasToolId) => void; readonly onPickAi?: (tool: CanvasImageToolId) => void }): React.ReactElement {
    const x = (key: ToolTextKey): string => toolText(props.locale, key);
    const aiLocale = imageToolLocale(props.locale);
    // Rendered on the board, not in the node toolbar: the toolbar lives inside React Flow's stacking context, under the
    // node settings panel. The portal keeps that stacking order without detaching the menu from its toolbar.
    const anchor = React.useRef<HTMLSpanElement>(null), menu = React.useRef<HTMLDivElement>(null);
    const { host, place } = useCanvasToolMenuPlacement(anchor, menu);
    const body = <div ref={menu} className='nmx-board-tools nowheel' role='menu' style={place ?? { visibility: 'hidden', left: 0, top: 0 }}
        onMouseDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
        {MENU[props.kind].map(group => <section key={group.section}>
            <h5>{x(group.section)}</h5>
            {group.tools.map(tool => <button type='button' role='menuitem' key={tool} title={x(`hint.${tool}` as ToolTextKey)} onClick={() => props.onPick(tool)}>
                {x(`tool.${tool}` as ToolTextKey)}</button>)}
        </section>)}
        {props.kind === 'image' && props.onPickAi && AI_IMAGE_TOOL_GROUPS.map(group => <section key={group.section}>
            <h5>{x(group.section)}</h5>
            {group.tools.map(tool => <button type='button' role='menuitem' key={tool} title={CANVAS_IMAGE_TOOLS[tool].hints[aiLocale]} onClick={() => props.onPickAi!(tool)}>
                {CANVAS_IMAGE_TOOLS[tool].labels[aiLocale]}</button>)}
        </section>)}
    </div>;
    return <><span ref={anchor} hidden />{host && ReactDOM.createPortal(body, host)}</>;
}

export function toolRunsImmediately(tool: CanvasToolId): boolean { return IMMEDIATE.has(tool); }

export type CanvasFrameExtractChoice = 'first' | 'last' | 'custom';

/** The first/last choices execute immediately; only Custom opens the time picker. */
export function CanvasFrameExtractMenu(props: {
    readonly locale: string;
    readonly busy?: boolean;
    readonly onPick: (choice: CanvasFrameExtractChoice) => void;
    readonly onClose?: () => void;
}): React.ReactElement {
    const anchor = React.useRef<HTMLSpanElement>(null), menu = React.useRef<HTMLDivElement>(null);
    const { host, place } = useCanvasToolMenuPlacement(anchor, menu);
    const picked = React.useRef(false);
    React.useEffect(() => { menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(); }, [host]);
    const t = (key: 'extract' | 'extractFirst' | 'extractLast' | 'extractAt'): string => canvasText(props.locale, key);
    const body = <div ref={menu} className='nmx-board-tools nmx-board-frame-menu nowheel' role='menu' aria-label={t('extract')}
        style={{ gridTemplateColumns: '1fr', ...(place ?? { visibility: 'hidden', left: 0, top: 0 }) }} onMouseDown={event => event.stopPropagation()}
        onKeyDown={event => {
            event.stopPropagation();
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === 'Escape') { event.preventDefault(); props.onClose?.(); }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
                const index = buttons.findIndex(button => button === event.currentTarget.ownerDocument.activeElement);
                buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
            }
        }}>
        {(['first', 'last', 'custom'] as const).map(choice => <button type='button' role='menuitem' key={choice} data-frame-choice={choice} disabled={props.busy}
            onClick={() => { if (picked.current || props.busy) return; picked.current = true; props.onPick(choice); }}>
            {t(choice === 'first' ? 'extractFirst' : choice === 'last' ? 'extractLast' : 'extractAt')}
        </button>)}
    </div>;
    return <><span ref={anchor} hidden />{host && ReactDOM.createPortal(body, host)}</>;
}

/** A requested display time is not a guessed frame number. FFmpeg resolves the actual presentation timestamp. */
export function canvasFrameTimeSelection(seconds: string, durationMs?: number): CanvasFrameSelection | undefined {
    if (!seconds.trim()) return undefined;
    const value = Number(seconds), timeMs = Math.round(value * 1000);
    if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(timeMs)
        || durationMs !== undefined && Number.isFinite(durationMs) && durationMs > 0 && timeMs > durationMs) return undefined;
    // Container duration ends after the last displayed frame. Ask the extractor for
    // that frame explicitly instead of sending an out-of-range presentation time.
    return durationMs !== undefined && durationMs > 0 && timeMs === durationMs ? { kind: 'last' } : { kind: 'time', timeMs };
}

export interface CanvasFrameExtractDialogProps {
    readonly locale: string;
    /** The caller captures this exact version when opening, rather than following currentVersionId. */
    readonly version: CanvasAssetVersion;
    readonly mediaUrl: (uri: string) => string;
    readonly busy: boolean;
    /** Reject on extraction failure. Success closes the picker; it never creates a pending frame node itself. */
    readonly onRun: (selection: CanvasFrameSelection) => Promise<void>;
    readonly onClose: () => void;
}

export function CanvasFrameExtractDialog(props: CanvasFrameExtractDialogProps): React.ReactElement {
    const t = (key: Parameters<typeof canvasText>[1], values?: Record<string, string | number>): string => canvasText(props.locale, key, values);
    const [seconds, setSeconds] = React.useState('0');
    const [mediaDuration, setMediaDuration] = React.useState<number>();
    const [pending, setPending] = React.useState(false), [error, setError] = React.useState('');
    const video = React.useRef<HTMLVideoElement>(null), lock = React.useRef(false), operation = React.useRef(0);
    const identity = `${props.version.id}\n${props.version.uri}`;
    const currentIdentity = React.useRef(identity); currentIdentity.current = identity;
    React.useEffect(() => {
        setSeconds('0'); setMediaDuration(undefined); setError(''); setPending(false); lock.current = false;
        return () => { operation.current++; };
    }, [identity]);
    const durationMs = mediaDuration ?? props.version.metadata?.durationMs;
    const selection = canvasFrameTimeSelection(seconds, durationMs);
    const busy = props.busy || pending;
    const ready = props.version.kind === 'video' && Boolean(props.version.uri) && props.version.status !== 'missing' && props.version.status !== 'uploading';
    const seek = (value: string): void => {
        setSeconds(value);
        video.current?.pause();
        const request = canvasFrameTimeSelection(value, durationMs);
        if (request && video.current?.readyState) video.current.currentTime = request.kind === 'time' ? request.timeMs / 1000 : (durationMs ?? 0) / 1000;
    };
    const run = async (): Promise<void> => {
        if (!selection || !ready || busy || lock.current) return;
        lock.current = true; setPending(true); setError(''); video.current?.pause();
        const token = ++operation.current;
        try {
            await props.onRun(selection);
            if (token === operation.current && currentIdentity.current === identity) props.onClose();
        } catch (failure) {
            if (token === operation.current && currentIdentity.current === identity)
                setError(t('extractFailed', { error: failure instanceof Error ? failure.message : String(failure) }));
        } finally {
            if (token === operation.current && currentIdentity.current === identity) { lock.current = false; setPending(false); }
        }
    };
    return <div className='nmx-board-modal-backdrop nmx-board-frame-backdrop' onMouseDown={event => {
        if (event.target === event.currentTarget && !busy) props.onClose(); event.stopPropagation();
    }} onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape' && !event.nativeEvent.isComposing && event.keyCode !== 229 && !busy) { event.preventDefault(); props.onClose(); }
    }}>
        <section ref={focusDialogOnMount} tabIndex={-1} className='nmx-board-modal nmx-board-frame-dialog' role='dialog' aria-modal='true' aria-label={t('extractAt')}
            style={{ width: 'min(760px, 100%)' }}>
            <header><strong>{t('extractAt')}</strong><button type='button' className='nmx-board-modal-close' aria-label={t('cancel')} disabled={busy} onClick={props.onClose}>
                <i className='codicon codicon-close' aria-hidden='true' /></button></header>
            <div className='nmx-board-tool-preview'>
                <video key={identity} ref={video} src={props.mediaUrl(props.version.uri)} controls={!busy} muted playsInline preload='metadata'
                    onLoadedMetadata={event => {
                        const duration = event.currentTarget.duration;
                        if (Number.isFinite(duration) && duration > 0) setMediaDuration(Math.round(duration * 1000));
                    }} onTimeUpdate={event => { if (!lock.current) setSeconds(String(Math.round(event.currentTarget.currentTime * 1000) / 1000)); }} />
            </div>
            <div className='nmx-board-tool-form' style={{ borderLeft: 0 }}>
                <label className='nmx-board-tool-row'><span>{t('extractAt')}</span>
                    <ImeInput type='number' aria-label={t('extractAt')} min={0} max={durationMs && durationMs > 0 ? durationMs / 1000 : undefined} step={0.001}
                        disabled={busy} value={seconds} aria-invalid={!selection} onChange={event => seek(event.currentTarget.value)} />
                    <em>{t('seconds', { n: '' }).trim()}</em>
                </label>
                {durationMs !== undefined && Number.isFinite(durationMs) && durationMs > 0 && <input type='range' aria-label={t('extractAt')} min={0} max={durationMs} step={1}
                    disabled={busy} value={selection?.kind === 'time' ? selection.timeMs : selection?.kind === 'last' ? durationMs : 0} onChange={event => seek(String(Number(event.currentTarget.value) / 1000))} />}
                {error && <p role='alert'>{error}</p>}
            </div>
            <footer><span className='nmx-board-panel-spacer' /><button type='button' className='nmx-secondary-button' disabled={busy} onClick={props.onClose}>{t('cancel')}</button>
                <button type='button' className='nmx-board-generate' disabled={busy || !selection || !ready} onClick={() => void run()}>
                    <i className={`codicon codicon-${busy ? 'loading codicon-modifier-spin' : 'device-camera'}`} aria-hidden='true' />{t('extractGo')}
                </button></footer>
        </section>
    </div>;
}

export function imageToolLocale(locale: string): ImageToolLocale {
    const known = ['zh-CN', 'en', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
    return (known.includes(locale) ? locale : locale.startsWith('zh') ? 'zh-CN' : 'en') as ImageToolLocale;
}

const ASPECTS: readonly (readonly [number, number])[] = [[9, 16], [16, 9], [1, 1], [4, 3], [3, 4], [21, 9]];
const ADJUSTMENTS = ['exposure', 'brightness', 'contrast', 'saturation', 'vibrance', 'temperature', 'tint', 'highlights', 'shadows', 'whites', 'blacks', 'sharpen', 'vignette', 'fade', 'grain'] as const;
type Adjustment = typeof ADJUSTMENTS[number];
const SIGNED = new Set<Adjustment>(['exposure', 'brightness', 'contrast', 'saturation', 'vibrance', 'temperature', 'tint', 'highlights', 'shadows', 'whites', 'blacks']);

/** A centred crop of `width`×`height` to the aspect `a:b` (even pixel sizes). */
function centredCrop(width: number, height: number, aspect: readonly [number, number]): { x: number; y: number; width: number; height: number } {
    const ratio = aspect[0] / aspect[1];
    let cropWidth = width, cropHeight = Math.round(width / ratio);
    if (cropHeight > height) { cropHeight = height; cropWidth = Math.round(height * ratio); }
    cropWidth -= cropWidth % 2; cropHeight -= cropHeight % 2;
    return { x: Math.floor((width - cropWidth) / 2), y: Math.floor((height - cropHeight) / 2), width: cropWidth, height: cropHeight };
}

export interface ToolDialogProps {
    readonly locale: string;
    readonly tool: CanvasToolId;
    readonly version: CanvasAssetVersion;
    readonly mediaUrl: (uri: string) => string;
    readonly busy: boolean;
    readonly progress?: number;
    readonly onPickLut: () => Promise<string | undefined>;
    /** Other ready pictures on the canvas (colour transfer's reference). */
    readonly pictures?: readonly { readonly versionId: string; readonly title: string; readonly uri: string }[];
    /** Grid stitch: the selected pictures, in selection order. */
    readonly stitch?: readonly { readonly version: CanvasAssetVersion; readonly title: string }[];
    readonly onRun: (parameters: Readonly<Record<string, unknown>>) => void;
    readonly onCancel: () => void;
    readonly onClose: () => void;
}

export function ToolDialog(props: ToolDialogProps): React.ReactElement {
    const x = (key: ToolTextKey, values?: Record<string, string | number>): string => toolText(props.locale, key, values);
    const { tool, version } = props;
    const durationMs = version.metadata?.durationMs ?? 0;
    const width = version.metadata?.width ?? 0, height = version.metadata?.height ?? 0;
    const [range, setRange] = React.useState({ inMs: 0, outMs: durationMs || 1000 });
    const [segments, setSegments] = React.useState<{ inMs: number; outMs: number }[]>(() => durationMs ? [{ inMs: 0, outMs: Math.round(durationMs / 2) }, { inMs: Math.round(durationMs / 2), outMs: durationMs }] : []);
    const [aspect, setAspect] = React.useState<readonly [number, number]>([9, 16]);
    const [mirror, setMirror] = React.useState(false);
    const [invertDepth, setInvertDepth] = React.useState(false);
    const [smoothDepth, setSmoothDepth] = React.useState(true);
    const [depthResolution, setDepthResolution] = React.useState('source');
    const [format, setFormat] = React.useState<string>(tool === 'video.export' ? 'gif' : tool === 'video.extractAudio' ? 'mp3' : 'png');
    const [fps, setFps] = React.useState(tool === 'video.export' ? 12 : 24);
    const [outWidth, setOutWidth] = React.useState(480);
    const [quality, setQuality] = React.useState(80);
    const [maxSide, setMaxSide] = React.useState(1280);
    const [crf, setCrf] = React.useState(26);
    const [grid, setGrid] = React.useState({ rows: 2, columns: 2, gap: 0 });
    const [adjust, setAdjust] = React.useState<Partial<Record<Adjustment, number>>>({});
    const [lut, setLut] = React.useState<string>();
    const [strength, setStrength] = React.useState(100);
    const [curves, setCurves] = React.useState<Record<CurveChannel, readonly CurvePoint[]>>({ rgb: IDENTITY, red: IDENTITY, green: IDENTITY, blue: IDENTITY });
    const [channel, setChannel] = React.useState<CurveChannel>('rgb');
    // The reference is the user's choice, never a silent default; a picture shared by several nodes is offered once.
    const [reference, setReference] = React.useState('');
    const referencePictures = (props.pictures ?? []).filter((item, index, all) => all.findIndex(other => other.versionId === item.versionId) === index);
    const [preserveLight, setPreserveLight] = React.useState(true);
    const [colorCount, setColorCount] = React.useState(6);
    const stitchVersions = (props.stitch ?? []).map(item => item.version);
    const firstStitch = stitchVersions[0]?.metadata;
    const [stitch, setStitch] = React.useState(() => {
        const count = Math.max(1, stitchVersions.length), columns = Math.min(4, Math.ceil(Math.sqrt(count)));
        const side = 512, aspect = firstStitch?.width && firstStitch.height ? firstStitch.height / firstStitch.width : 1;
        return { rows: Math.ceil(count / columns), columns, cellWidth: side, cellHeight: Math.round(side * aspect), gap: 8, background: '#FFFFFF' };
    });
    const video = React.useRef<HTMLVideoElement>(null);
    const src = props.mediaUrl(version.uri);
    const seconds = (ms: number): string => (ms / 1000).toFixed(1);
    const seek = (ms: number): void => { if (video.current) video.current.currentTime = ms / 1000; };

    const parameters = (): Readonly<Record<string, unknown>> => {
        switch (tool) {
            case 'video.trim': case 'audio.trim': return { ...range };
            case 'video.split': return { segments };
            case 'video.crop': return { aspectRatio: aspect, mirror };
            case 'video.export': return { ...range, format, fps, width: outWidth, quality };
            case 'video.compress': return { maxWidth: width >= height ? maxSide : undefined, maxHeight: height > width ? maxSide : undefined, fps, crf };
            case 'video.extractAudio': return { format };
            case 'image.crop': return centredCrop(width, height, aspect);
            case 'image.convert': return { format, quality, maxWidth: maxSide, maxHeight: maxSide };
            case 'image.gridSplit': return { ...grid };
            case 'image.depth': return { invert: invertDepth };
            case 'video.depth': return { resolution: depthResolution, invert: invertDepth, smooth: smoothDepth };
            case 'color.adjust': return { ...adjust };
            case 'color.lut': return { cubePath: lut ?? '', strength: strength / 100, ...(Object.keys(adjust).length ? { adjustments: adjust } : {}) };
            case 'color.curves': return Object.fromEntries((Object.keys(curves) as CurveChannel[]).filter(key => !isIdentity(curves[key])).map(key => [key, curves[key]]));
            case 'color.transfer': return { referenceVersionId: reference, strength: strength / 100, preserveLuminance: preserveLight };
            case 'image.paletteExtract': return { colorCount };
            case 'image.gridStitch': return (stitchDraft?.parameters ?? {}) as unknown as Readonly<Record<string, unknown>>;
            default: return {};
        }
    };
    let stitchDraft: ReturnType<typeof buildCanvasGridStitchDraft> | undefined, stitchProblem = '';
    if (tool === 'image.gridStitch') {
        try { stitchDraft = buildCanvasGridStitchDraft(stitchVersions, stitch); } catch (problem) { stitchProblem = problem instanceof Error ? problem.message : String(problem); }
    }
    const ready = tool === 'color.lut' ? Boolean(lut) : tool === 'image.crop' ? width > 0 && height > 0
        : tool === 'color.curves' ? (Object.keys(curves) as CurveChannel[]).some(key => !isIdentity(curves[key]))
        : tool === 'color.transfer' ? Boolean(reference)
        : tool === 'image.gridStitch' ? Boolean(stitchDraft)
        : tool === 'video.split' ? segments.length > 0 && segments.every(segment => segment.outMs > segment.inMs)
            : tool === 'video.trim' || tool === 'audio.trim' || tool === 'video.export' ? range.outMs > range.inMs : true;

    const rangeEditor = <div className='nmx-board-tool-range'>
        <label><span>{x('start')}</span><ImeInput type='number' min={0} max={seconds(durationMs)} step={0.1} value={seconds(range.inMs)}
            onChange={event => { const ms = Math.round(Number(event.currentTarget.value) * 1000); if (Number.isFinite(ms) && ms >= 0) { setRange({ ...range, inMs: ms }); seek(ms); } }} /><em>{x('seconds')}</em></label>
        <input type='range' min={0} max={durationMs || 1000} step={100} value={range.inMs} onChange={event => { const ms = Number(event.currentTarget.value); setRange({ ...range, inMs: Math.min(ms, range.outMs - 100) }); seek(ms); }} />
        <input type='range' min={0} max={durationMs || 1000} step={100} value={range.outMs} onChange={event => { const ms = Number(event.currentTarget.value); setRange({ ...range, outMs: Math.max(ms, range.inMs + 100) }); seek(ms); }} />
        <label><span>{x('end')}</span><ImeInput type='number' min={0} max={seconds(durationMs)} step={0.1} value={seconds(range.outMs)}
            onChange={event => { const ms = Math.round(Number(event.currentTarget.value) * 1000); if (Number.isFinite(ms) && ms > 0) { setRange({ ...range, outMs: Math.min(ms, durationMs || ms) }); seek(ms); } }} /><em>{x('seconds')}</em></label>
    </div>;
    const aspectPicker = <div className='nmx-board-segmented'>
        {ASPECTS.map(item => <button type='button' key={item.join(':')} className={aspect[0] === item[0] && aspect[1] === item[1] ? 'is-active' : ''} onClick={() => setAspect(item)}>{item.join(':')}</button>)}
    </div>;
    const filter = tool === 'color.adjust' || tool === 'color.lut'
        ? `brightness(${1 + ((adjust.exposure ?? 0) / 200 + (adjust.brightness ?? 0) / 100) * 0.6}) contrast(${1 + (adjust.contrast ?? 0) / 100}) saturate(${1 + ((adjust.saturation ?? 0) + (adjust.vibrance ?? 0) / 2) / 100}) sepia(${Math.max(0, adjust.temperature ?? 0) / 300}) hue-rotate(${(adjust.tint ?? 0) / 4}deg)`
        : undefined;
    const mirrored = tool === 'video.mirror' || tool === 'image.mirror' || (tool === 'video.crop' && mirror);

    return <div className='nmx-board-modal-backdrop' onMouseDown={event => { if (event.target === event.currentTarget && !props.busy) props.onClose(); }}
        onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape' && !props.busy) props.onClose(); }}>
        <section ref={focusDialogOnMount} tabIndex={-1} className='nmx-board-modal nmx-board-tool' role='dialog' aria-modal='true' aria-label={x(`tool.${tool}` as ToolTextKey)}>
            <header>
                <strong>{x(`tool.${tool}` as ToolTextKey)}</strong><span>{x(`hint.${tool}` as ToolTextKey)}</span>
                <button type='button' className='nmx-board-modal-close' aria-label={x('close')} disabled={props.busy} onClick={props.onClose}><i className='codicon codicon-close' aria-hidden='true'></i></button>
            </header>
            <div className='nmx-board-tool-body'>
                <div className='nmx-board-tool-preview'>
                    {version.kind === 'audio' ? <audio src={src} controls preload='metadata' />
                        // The stage is exactly the picture's size, so the crop frame and grid lines sit on the picture, not the padded box.
                        : tool === 'image.gridStitch' ? <div className='nmx-board-tool-stitch' style={{ gridTemplateColumns: `repeat(${stitch.columns}, 1fr)`, gap: Math.max(1, stitch.gap / 4), background: stitch.background }}>
                            {(props.stitch ?? []).slice(0, stitch.rows * stitch.columns).map(item => <img key={item.version.id} src={props.mediaUrl(item.version.uri)} alt='' style={{ aspectRatio: `${stitch.cellWidth} / ${stitch.cellHeight}` }} />)}
                        </div>
                        : <div className='nmx-board-tool-stage' style={{ ...(filter ? { filter } : tool === 'color.curves' ? { filter: 'url(#nmx-board-curves-preview)' } : {}), ...(mirrored ? { transform: 'scaleX(-1)' } : {}) }}>
                            {version.kind === 'video' ? <video ref={video} src={src} controls muted playsInline preload='metadata' /> : <img src={src} alt='' />}
                            {(tool === 'image.crop' || tool === 'video.crop') && width > 0 && <div className='nmx-board-tool-crop' style={(() => {
                                const crop = centredCrop(width, height, aspect);
                                return { left: `${crop.x / width * 100}%`, top: `${crop.y / height * 100}%`, width: `${crop.width / width * 100}%`, height: `${crop.height / height * 100}%` };
                            })()} />}
                            {tool === 'image.gridSplit' && <div className='nmx-board-tool-grid' style={{ gridTemplateColumns: `repeat(${grid.columns}, 1fr)`, gridTemplateRows: `repeat(${grid.rows}, 1fr)` }}>
                                {Array.from({ length: grid.rows * grid.columns }, (_, index) => <span key={index} />)}</div>}
                        </div>}
                </div>
                <div className='nmx-board-tool-form'>
                    {(tool === 'image.matting' || tool === 'image.depth' || tool === 'video.depth') && <p className='nmx-board-panel-note'>
                        {x('localModelDownload', { size: CANVAS_ON_DEVICE_MODELS[tool === 'video.depth' ? 'image.depth' : tool].downloadMiB })}</p>}
                    {(tool === 'image.depth' || tool === 'video.depth') && <label className='nmx-board-tool-row is-toggle'>
                        <input type='checkbox' checked={invertDepth} disabled={props.busy} onChange={event => setInvertDepth(event.currentTarget.checked)} />
                        <span>{x('invertDepth')}</span></label>}
                    {tool === 'video.depth' && <>
                        <label className='nmx-board-tool-row'><span>{x('depthResolution')}</span>
                            <select value={depthResolution} disabled={props.busy} onChange={event => setDepthResolution(event.currentTarget.value)}>
                                <option value='source'>{x('depthSource')}</option><option value='720'>720P</option><option value='480'>480P</option>
                            </select></label>
                        <label className='nmx-board-tool-row is-toggle'><input type='checkbox' checked={smoothDepth} disabled={props.busy}
                            onChange={event => setSmoothDepth(event.currentTarget.checked)} /><span>{x('smoothDepth')}</span></label>
                    </>}
                    {(tool === 'video.trim' || tool === 'audio.trim' || tool === 'video.export') && rangeEditor}
                    {tool === 'video.split' && <div className='nmx-board-tool-segments'>
                        <span>{x('segments')}</span>
                        {segments.map((segment, index) => <div key={index}>
                            <ImeInput type='number' min={0} step={0.1} value={seconds(segment.inMs)} onChange={event => { const next = [...segments]; next[index] = { ...segment, inMs: Math.round(Number(event.currentTarget.value) * 1000) }; setSegments(next); }} />
                            <em>–</em>
                            <ImeInput type='number' min={0} step={0.1} value={seconds(segment.outMs)} onChange={event => { const next = [...segments]; next[index] = { ...segment, outMs: Math.round(Number(event.currentTarget.value) * 1000) }; setSegments(next); }} />
                            <em>{x('seconds')}</em>
                            <button type='button' className='nmx-board-side-close' aria-label={x('cancel')} onClick={() => setSegments(segments.filter((_, item) => item !== index))}><i className='codicon codicon-close' aria-hidden='true'></i></button>
                        </div>)}
                        <button type='button' className='nmx-link-button' onClick={() => { const last = segments.at(-1)?.outMs ?? 0; setSegments([...segments, { inMs: last, outMs: Math.min(durationMs || last + 1000, last + 2000) }]); }}>{x('addSegment')}</button>
                    </div>}
                    {(tool === 'video.crop' || tool === 'image.crop') && <label className='nmx-board-tool-row'><span>{x('aspect')}</span>{aspectPicker}</label>}
                    {tool === 'video.crop' && <label className='nmx-board-tool-row is-toggle'><input type='checkbox' checked={mirror} onChange={event => setMirror(event.currentTarget.checked)} /><span>{x('mirrorToo')}</span></label>}
                    {(tool === 'video.export' || tool === 'video.extractAudio' || tool === 'image.convert') && <label className='nmx-board-tool-row'><span>{x('format')}</span>
                        <select value={format} onChange={event => setFormat(event.currentTarget.value)}>
                            {(tool === 'video.export' ? ['gif', 'webp'] : tool === 'video.extractAudio' ? ['mp3', 'wav'] : ['png', 'jpeg', 'webp']).map(value => <option key={value} value={value}>{value.toUpperCase()}</option>)}
                        </select></label>}
                    {(tool === 'video.export' || tool === 'video.compress') && <label className='nmx-board-tool-row'><span>{x('fps')}</span>
                        <ImeInput type='number' min={1} max={60} value={fps} onChange={event => setFps(Math.max(1, Math.min(60, Math.round(Number(event.currentTarget.value)) || fps)))} /></label>}
                    {tool === 'video.export' && <label className='nmx-board-tool-row'><span>{x('width')}</span>
                        <ImeInput type='number' min={64} max={1920} step={2} value={outWidth} onChange={event => setOutWidth(Math.max(64, Math.min(1920, Math.round(Number(event.currentTarget.value)) || outWidth)))} /></label>}
                    {(tool === 'video.export' || tool === 'image.convert') && <label className='nmx-board-tool-row'><span>{x('quality')}</span>
                        <input type='range' min={10} max={100} value={quality} onChange={event => setQuality(Number(event.currentTarget.value))} /><output>{quality}</output></label>}
                    {(tool === 'video.compress' || tool === 'image.convert') && <label className='nmx-board-tool-row'><span>{x('maxSide')}</span>
                        <ImeInput type='number' min={64} max={4096} step={2} value={maxSide} onChange={event => setMaxSide(Math.max(64, Math.min(4096, Math.round(Number(event.currentTarget.value)) || maxSide)))} /></label>}
                    {tool === 'video.compress' && <label className='nmx-board-tool-row' title={x('crfHint')}><span>{x('crf')}</span>
                        <input type='range' min={18} max={36} value={crf} onChange={event => setCrf(Number(event.currentTarget.value))} /><output>{crf}</output></label>}
                    {tool === 'image.gridSplit' && <>
                        <label className='nmx-board-tool-row'><span>{x('rows')}</span><ImeInput type='number' min={1} max={8} value={grid.rows} onChange={event => setGrid({ ...grid, rows: Math.max(1, Math.min(8, Math.round(Number(event.currentTarget.value)) || grid.rows)) })} /></label>
                        <label className='nmx-board-tool-row'><span>{x('columns')}</span><ImeInput type='number' min={1} max={8} value={grid.columns} onChange={event => setGrid({ ...grid, columns: Math.max(1, Math.min(8, Math.round(Number(event.currentTarget.value)) || grid.columns)) })} /></label>
                        <label className='nmx-board-tool-row'><span>{x('gap')}</span><ImeInput type='number' min={0} max={200} value={grid.gap} onChange={event => setGrid({ ...grid, gap: Math.max(0, Math.min(200, Math.round(Number(event.currentTarget.value)) || 0)) })} /></label>
                    </>}
                    {tool === 'color.curves' && <div className='nmx-board-tool-curves'>
                        <div className='nmx-board-tool-curve-tabs' role='tablist'>
                            {(['rgb', 'red', 'green', 'blue'] as const).map(key => <button type='button' role='tab' key={key} aria-selected={channel === key} className={`is-${key}${channel === key ? ' is-active' : ''}`}
                                onClick={() => setChannel(key)}>{key === 'rgb' ? x('curvesMaster') : key[0].toUpperCase()}</button>)}
                            <button type='button' className='nmx-link-button' onClick={() => setCurves({ ...curves, [channel]: IDENTITY })}>{x('reset')}</button>
                        </div>
                        <CurveEditor points={curves[channel]} channel={channel} onChange={points => setCurves({ ...curves, [channel]: points })} />
                        <p className='nmx-board-panel-note'>{x('curvesHint')}</p>
                        <CurvesPreviewFilter curves={curves} />
                    </div>}
                    {tool === 'color.transfer' && <>
                        <div className='nmx-board-tool-field'><span>{x('transferReference')}</span>
                            {referencePictures.length
                                ? <div className='nmx-board-tool-pictures' role='radiogroup' aria-label={x('transferReference')}>
                                    {referencePictures.map(item => <button key={item.versionId} type='button' role='radio' aria-checked={reference === item.versionId} title={item.title}
                                        className={reference === item.versionId ? 'is-on' : ''} onClick={() => setReference(item.versionId)}>
                                        <img src={props.mediaUrl(item.uri)} alt='' loading='lazy' draggable={false} /><span>{item.title}</span></button>)}
                                </div>
                                : <p className='nmx-board-panel-note'>{x('aiChooseImage')}</p>}
                        </div>
                        <label className='nmx-board-tool-row'><span>{x('strength')}</span>
                            <input type='range' min={0} max={100} value={strength} onChange={event => setStrength(Number(event.currentTarget.value))} /><output>{strength}</output></label>
                        <label className='nmx-board-tool-row is-toggle'><input type='checkbox' checked={preserveLight} onChange={event => setPreserveLight(event.currentTarget.checked)} /><span>{x('preserveLuminance')}</span></label>
                    </>}
                    {tool === 'image.paletteExtract' && <label className='nmx-board-tool-row'><span>{x('paletteCount')}</span>
                        <input type='range' min={5} max={8} value={colorCount} onChange={event => setColorCount(Number(event.currentTarget.value))} /><output>{colorCount}</output></label>}
                    {tool === 'image.gridStitch' && <>
                        <label className='nmx-board-tool-row'><span>{x('rows')}</span><ImeInput type='number' min={1} max={20} value={stitch.rows} onChange={event => setStitch({ ...stitch, rows: Math.max(1, Math.min(20, Math.round(Number(event.currentTarget.value)) || stitch.rows)) })} /></label>
                        <label className='nmx-board-tool-row'><span>{x('columns')}</span><ImeInput type='number' min={1} max={20} value={stitch.columns} onChange={event => setStitch({ ...stitch, columns: Math.max(1, Math.min(20, Math.round(Number(event.currentTarget.value)) || stitch.columns)) })} /></label>
                        <div className='nmx-board-tool-row'><span>{x('cellSize')}</span>
                            <span className='nmx-board-tool-pair'>
                                <ImeInput type='number' min={64} max={4096} aria-label={`${x('cellSize')} W`} value={stitch.cellWidth} onChange={event => setStitch({ ...stitch, cellWidth: Math.max(64, Math.min(4096, Math.round(Number(event.currentTarget.value)) || stitch.cellWidth)) })} />
                                <em>×</em>
                                <ImeInput type='number' min={64} max={4096} aria-label={`${x('cellSize')} H`} value={stitch.cellHeight} onChange={event => setStitch({ ...stitch, cellHeight: Math.max(64, Math.min(4096, Math.round(Number(event.currentTarget.value)) || stitch.cellHeight)) })} />
                            </span></div>
                        <label className='nmx-board-tool-row'><span>{x('gap')}</span><ImeInput type='number' min={0} max={40} value={stitch.gap} onChange={event => setStitch({ ...stitch, gap: Math.max(0, Math.min(40, Math.round(Number(event.currentTarget.value)) || 0)) })} /></label>
                        <label className='nmx-board-tool-row'><span>{x('background')}</span><input type='color' value={stitch.background} onChange={event => setStitch({ ...stitch, background: event.currentTarget.value.toUpperCase() })} /></label>
                        {stitchDraft ? <p className='nmx-board-panel-note' data-nmx-literal>{stitchDraft.width} × {stitchDraft.height}</p> : <p className='nmx-board-camera-warning'>{stitchProblem}</p>}
                    </>}
                    {tool === 'color.lut' && <label className='nmx-board-tool-row'><span>{x('lutFile')}</span>
                        <button type='button' className='nmx-secondary-button' onClick={() => void props.onPickLut().then(path => { if (path) setLut(path); })}>{lut ? lut.split(/[\\/]/).pop() : x('chooseLut')}</button></label>}
                    {tool === 'color.lut' && <label className='nmx-board-tool-row'><span>{x('strength')}</span>
                        <input type='range' min={0} max={100} value={strength} onChange={event => setStrength(Number(event.currentTarget.value))} /><output>{strength}</output></label>}
                    {(tool === 'color.adjust' || tool === 'color.lut') && <div className='nmx-board-tool-adjust'>
                        {ADJUSTMENTS.map(key => <label key={key} className='nmx-board-tool-row'><span>{x(`adj.${key}` as ToolTextKey)}</span>
                            <input type='range' min={SIGNED.has(key) ? (key === 'exposure' ? -200 : -100) : 0} max={key === 'exposure' ? 200 : 100} value={adjust[key] ?? 0}
                                onChange={event => { const value = Number(event.currentTarget.value); const next = { ...adjust }; if (value) next[key] = value; else delete next[key]; setAdjust(next); }}
                                onDoubleClick={() => { const next = { ...adjust }; delete next[key]; setAdjust(next); }} />
                            <output>{adjust[key] ?? 0}</output></label>)}
                        <p className='nmx-board-panel-note'>{x('previewNote')}</p>
                    </div>}
                    <p className='nmx-board-panel-note'>{x('resultHint')}</p>
                </div>
            </div>
            <footer>
                <span className='nmx-board-batch-note'>{props.busy ? `${x('running')}${props.progress !== undefined ? ` ${Math.round(props.progress * 100)}%` : ''}` : ''}</span>
                {props.busy ? <button type='button' className='nmx-secondary-button' onClick={props.onCancel}>{x('cancel')}</button>
                    : <button type='button' className='nmx-secondary-button' onClick={props.onClose}>{x('close')}</button>}
                <button type='button' className='nmx-board-generate' disabled={props.busy || !ready} onClick={() => props.onRun(parameters())}>{x('run')}</button>
            </footer>
        </section>
    </div>;
}

type CurveChannel = 'rgb' | 'red' | 'green' | 'blue';
type CurvePoint = readonly [number, number];
const IDENTITY: readonly CurvePoint[] = [[0, 0], [1, 1]];
function isIdentity(points: readonly CurvePoint[]): boolean { return points.length === 2 && points[0][0] === 0 && points[0][1] === 0 && points[1][0] === 1 && points[1][1] === 1; }
/** Drag points to shape the curve; click empty space to add a point, double-click a point to remove it (ends stay). */
function CurveEditor(props: { readonly points: readonly CurvePoint[]; readonly channel: CurveChannel; readonly onChange: (points: readonly CurvePoint[]) => void }): React.ReactElement {
    const box = React.useRef<SVGSVGElement>(null);
    const [dragging, setDragging] = React.useState<number>();
    const size = 220;
    const toPoint = (event: React.PointerEvent | React.MouseEvent): CurvePoint => {
        const rect = box.current!.getBoundingClientRect();
        const clamp = (value: number): number => Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
        return [clamp((event.clientX - rect.left) / rect.width), clamp(1 - (event.clientY - rect.top) / rect.height)];
    };
    const move = (event: React.PointerEvent): void => {
        if (dragging === undefined) return;
        const [px, py] = toPoint(event), points = [...props.points];
        const last = points.length - 1;
        // Ends stay at x = 0 and x = 1; inner points stay between their neighbours so x keeps strictly increasing.
        const x = dragging === 0 ? 0 : dragging === last ? 1 : Math.min(points[dragging + 1][0] - 0.01, Math.max(points[dragging - 1][0] + 0.01, px));
        points[dragging] = [x, py];
        props.onChange(points);
    };
    const sample = canvasCurveSampler(props.points);
    const path = Array.from({ length: 111 }, (_, index) => { const x = index / 110; return `${index ? 'L' : 'M'}${(x * size).toFixed(2)} ${((1 - sample(x)) * size).toFixed(2)}`; }).join(' ');
    return <svg ref={box} className={`nmx-board-tool-curve is-${props.channel}`} viewBox={`0 0 ${size} ${size}`} width={size} height={size}
        onPointerMove={move} onPointerUp={() => setDragging(undefined)} onPointerLeave={() => setDragging(undefined)}
        onClick={event => {
            if (dragging !== undefined || (event.target as Element).tagName === 'circle') return;
            const point = toPoint(event);
            if (props.points.length >= 16 || props.points.some(([x]) => Math.abs(x - point[0]) < 0.02)) return;
            props.onChange([...props.points, point].sort((a, b) => a[0] - b[0]));
        }}>
        {[0.25, 0.5, 0.75].map(at => <g key={at}><line x1={at * size} y1={0} x2={at * size} y2={size} /><line x1={0} y1={at * size} x2={size} y2={at * size} /></g>)}
        <line className='is-diagonal' x1={0} y1={size} x2={size} y2={0} />
        <path d={path} />
        {props.points.map(([x, y], index) => <circle key={index} cx={x * size} cy={(1 - y) * size} r={6}
            onPointerDown={event => { (event.currentTarget as Element).setPointerCapture?.(event.pointerId); setDragging(index); }}
            onDoubleClick={() => { if (index > 0 && index < props.points.length - 1) props.onChange(props.points.filter((_, at) => at !== index)); }} />)}
    </svg>;
}

/** An SVG colour table with the filter's own curves for the live preview. */
function CurvesPreviewFilter(props: { readonly curves: Readonly<Record<CurveChannel, readonly CurvePoint[]>> }): React.ReactElement {
    // FFmpeg applies the channel curve, then the master curve.
    const master = canvasCurveSampler(props.curves.rgb);
    const table = (channel: 'red' | 'green' | 'blue'): string => {
        const own = canvasCurveSampler(props.curves[channel]);
        return Array.from({ length: 256 }, (_, index) => master(own(index / 255)).toFixed(4)).join(' ');
    };
    return <svg className='nmx-board-tool-curves-filter' aria-hidden='true' width={0} height={0}>
        <filter id='nmx-board-curves-preview' colorInterpolationFilters='sRGB'>
            <feComponentTransfer>
                <feFuncR type='table' tableValues={table('red')} />
                <feFuncG type='table' tableValues={table('green')} />
                <feFuncB type='table' tableValues={table('blue')} />
            </feComponentTransfer>
        </filter>
    </svg>;
}
