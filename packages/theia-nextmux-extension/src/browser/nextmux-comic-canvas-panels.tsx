import * as React from '@theia/core/shared/react';
import { PIN_COLORS, type CanvasDocument, type CanvasNode, type PinColor } from '@nextmux/comic-core/canvas';
import { ImeInput } from './nextmux-ime-field';
import { searchCanvasNodes, type CanvasLocatorFilter } from './nextmux-comic-canvas-locator';
import { listCanvasPins } from './nextmux-comic-canvas-pins';
import { CANVAS_SETTINGS_SPEC, DEFAULT_CANVAS_SETTINGS, normalizeCanvasSettings, type CanvasSettings } from './nextmux-comic-canvas-settings';
import { canvasCurrentVersion, canvasKindIcon } from './nextmux-comic-canvas-logic';
import { panelText, type PanelTextKey } from './nextmux-comic-canvas-panels-text';
import { toolText, type ToolTextKey } from './nextmux-comic-canvas-tools-text';
import type { CanvasCompareLibrary, CanvasCompareVersion } from './nextmux-comic-canvas-compare';
import { canvasCompareKey, canvasCompareEditingTarget, canvasCompareSeek, zoomCanvasCompare, type CanvasCompareViewport } from './nextmux-comic-canvas-compare-interaction';
import type { CanvasTextKey } from './nextmux-comic-canvas-text';

/** 画布 side panels: find a node (by name, kind or pin colour) and the per-user canvas settings. */

export const PIN_SWATCH: Readonly<Record<PinColor, string>> = {
    red: '#ef4444', orange: '#f97316', yellow: '#eab308', lime: '#84cc16', green: '#22c55e', teal: '#14b8a6',
    cyan: '#06b6d4', blue: '#3b82f6', indigo: '#6366f1', purple: '#a855f7', pink: '#ec4899', grey: '#94a3b8'
};

type CanvasT = (key: CanvasTextKey, values?: Record<string, string | number>) => string;

export function PinPicker(props: { readonly locale: string; readonly node: CanvasNode; readonly onChange: (colors: readonly PinColor[]) => void }): React.ReactElement {
    const chosen = new Set(props.node.pinnedColors ?? []);
    return <div className='nmx-board-pins' role='group' aria-label={panelText(props.locale, 'pin')}>
        {PIN_COLORS.map(color => <button type='button' key={color} aria-pressed={chosen.has(color)} title={panelText(props.locale, `color.${color}` as PanelTextKey)}
            className={chosen.has(color) ? 'is-on' : ''} style={{ ['--pin' as string]: PIN_SWATCH[color] }}
            onClick={() => props.onChange(PIN_COLORS.filter(item => item === color ? !chosen.has(item) : chosen.has(item)))} />)}
    </div>;
}

export function LocatorPanel(props: {
    readonly locale: string; readonly t: CanvasT; readonly canvas: CanvasDocument; readonly mediaUrl: (uri: string) => string;
    readonly onLocate: (nodeId: string) => void; readonly onClearPins: (color?: PinColor) => void; readonly onClose: () => void;
}): React.ReactElement {
    const p = (key: PanelTextKey, values?: Record<string, string | number>): string => panelText(props.locale, key, values);
    const [query, setQuery] = React.useState('');
    const [filter, setFilter] = React.useState<CanvasLocatorFilter>('all');
    const [tab, setTab] = React.useState<'search' | 'pins'>('search');
    const labels = Object.fromEntries((['text', 'image', 'video', 'audio', 'imageGen', 'videoGen', 'frameExtract', 'composition', 'group', 'character'] as const)
        .map(kind => [kind, props.t(`kind.${kind}` as CanvasTextKey)]));
    const found = searchCanvasNodes(props.canvas, query, filter, { locale: props.locale, kindLabels: labels });
    const pins = listCanvasPins(props.canvas).filter(group => group.nodes.length);
    const row = (node: CanvasNode): React.ReactElement => {
        const version = canvasCurrentVersion(node);
        return <li key={node.id}><button type='button' onClick={() => props.onLocate(node.id)}>
            {version?.kind === 'image' ? <img src={props.mediaUrl(version.uri)} alt='' /> : <i className={`codicon codicon-${canvasKindIcon(node.kind)}`} aria-hidden='true'></i>}
            <span data-nmx-literal>{node.title.replace(/\s·\s(?:Portrait|Storyboard|Video)$/u, '')}</span>
            <small>{node.origin?.role && ['portrait', 'storyboard', 'shotVideo', 'script', 'scene'].includes(node.origin.role) ? props.t(`origin.${node.origin.role}` as CanvasTextKey) : labels[node.kind]}</small>
        </button></li>;
    };
    return <aside className='nmx-board-side' aria-label={p('locate')} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') props.onClose(); }}>
        <header>
            <div className='nmx-board-segmented' role='tablist'>
                <button type='button' role='tab' aria-selected={tab === 'search'} className={tab === 'search' ? 'is-active' : ''} onClick={() => setTab('search')}>{p('locate')}</button>
                <button type='button' role='tab' aria-selected={tab === 'pins'} className={tab === 'pins' ? 'is-active' : ''} onClick={() => setTab('pins')}>{p('pins')}</button>
            </div>
            <button type='button' className='nmx-board-side-close' aria-label={props.t('cancel')} onClick={props.onClose}><i className='codicon codicon-close' aria-hidden='true'></i></button>
        </header>
        {tab === 'search' ? <>
            <ImeInput className='nmx-board-side-search' autoFocus value={query} placeholder={p('locateHint')} onChange={event => setQuery(event.currentTarget.value)} />
            <div className='nmx-board-chips'>
                {(['all', 'picture', 'clip', 'sound', 'text', 'character'] as const).map(value => <button type='button' key={value} className={filter === value ? 'is-active' : ''}
                    aria-pressed={filter === value} onClick={() => setFilter(value)}>{p(`filter.${value}` as PanelTextKey)}</button>)}
            </div>
            {found.length ? <ul className='nmx-board-side-list'>{found.map(row)}</ul> : <p className='nmx-board-side-empty'>{p('noMatch')}</p>}
        </> : <>
            {pins.length ? pins.map(group => <section key={group.color} className='nmx-board-pin-group'>
                <h4><span className='nmx-board-pin-dot' style={{ background: PIN_SWATCH[group.color] }} />{p(`color.${group.color}` as PanelTextKey)}<em>{group.nodes.length}</em>
                    <button type='button' className='nmx-link-button' onClick={() => props.onClearPins(group.color)}>{p('clearColor')}</button></h4>
                <ul className='nmx-board-side-list'>{group.nodes.map(row)}</ul>
            </section>) : <p className='nmx-board-side-empty'>{p('noPins')}</p>}
            {pins.length > 0 && <button type='button' className='nmx-secondary-button nmx-board-side-clear' onClick={() => props.onClearPins()}>{p('clearPins')}</button>}
        </>}
    </aside>;
}

type SettingKey = keyof CanvasSettings;
const SECTIONS: readonly { readonly key: PanelTextKey; readonly settings: readonly SettingKey[] }[] = [
    { key: 'section.interaction', settings: ['blankAreaAction', 'wheelAction', 'panSensitivity', 'snapGrid'] },
    { key: 'section.wires', settings: ['wireWidth', 'wireHoverHighlight', 'wireAnimation', 'wireFocusOnly'] },
    { key: 'section.grid', settings: ['showGrid', 'gridSpacing', 'gridDotSize', 'minimap'] },
    { key: 'section.layout', settings: ['arrangeHorizontalSpacing', 'arrangeVerticalSpacing', 'groupPadding'] },
    { key: 'section.generation', settings: ['submitDelaySeconds', 'notifyOnCompletion'] }
];

export function SettingsPanel(props: { readonly locale: string; readonly t: CanvasT; readonly settings: CanvasSettings; readonly onChange: (settings: CanvasSettings) => void; readonly onClose: () => void }): React.ReactElement {
    const p = (key: PanelTextKey, values?: Record<string, string | number>): string => panelText(props.locale, key, values);
    const set = (key: SettingKey, value: unknown): void => props.onChange(normalizeCanvasSettings({ ...props.settings, [key]: value }));
    const control = (key: SettingKey): React.ReactElement => {
        const spec = CANVAS_SETTINGS_SPEC[key] as { readonly type: string; readonly min?: number; readonly max?: number; readonly step?: number; readonly values?: readonly unknown[] };
        const value = props.settings[key];
        if (spec.type === 'boolean') {
            return <label className='nmx-board-setting is-toggle' key={key}><span>{p(`set.${key}` as PanelTextKey)}</span>
                <input type='checkbox' checked={Boolean(value)} onChange={event => set(key, event.currentTarget.checked)} /></label>;
        }
        if (spec.type === 'enum') {
            return <label className='nmx-board-setting' key={key}><span>{p(`set.${key}` as PanelTextKey)}</span>
                <select value={String(value)} onChange={event => set(key, event.currentTarget.value)}>
                    {(spec.values ?? []).map(option => <option key={String(option)} value={String(option)}>{p(`set.${key}.${String(option)}` as PanelTextKey)}</option>)}
                </select></label>;
        }
        const number = Number(value);
        return <label className='nmx-board-setting is-range' key={key}><span>{p(`set.${key}` as PanelTextKey)}</span>
            <input type='range' min={spec.min} max={spec.max} step={spec.step} value={number} onChange={event => set(key, Number(event.currentTarget.value))} />
            <output data-nmx-literal>{key === 'submitDelaySeconds' && number === 0 ? p('off') : key === 'submitDelaySeconds' ? props.t('seconds', { n: number })
                : key === 'panSensitivity' ? `${number}×` : `${number}`}</output></label>;
    };
    return <aside className='nmx-board-side is-settings' aria-label={p('settings')} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') props.onClose(); }}>
        <header><strong>{p('settings')}</strong>
            <button type='button' className='nmx-link-button' onClick={() => props.onChange({ ...DEFAULT_CANVAS_SETTINGS })}>{p('resetDefaults')}</button>
            <button type='button' className='nmx-board-side-close' aria-label={props.t('cancel')} onClick={props.onClose}><i className='codicon codicon-close' aria-hidden='true'></i></button>
        </header>
        <div className='nmx-board-settings'>{SECTIONS.map(section => <section key={section.key}><h4>{p(section.key)}</h4>
            {section.settings.filter(key => key !== 'alignmentGuides').map(control)}</section>)}</div>
    </aside>;
}

// ——— 对比库: put two results side by side or under a slider ———

export function CompareWindow(props: {
    readonly locale: string; readonly library: CanvasCompareLibrary; readonly mediaUrl: (uri: string) => string;
    readonly onRemove: (uri: string) => void; readonly onClear: () => void; readonly onClose: () => void;
}): React.ReactElement {
    const x = (key: ToolTextKey): string => toolText(props.locale, key);
    const p = (key: PanelTextKey): string => panelText(props.locale, key);
    const [left, setLeft] = React.useState<string | undefined>(props.library[0]?.uri);
    const [right, setRight] = React.useState<string | undefined>(props.library[1]?.uri);
    const [mode, setMode] = React.useState<'slider' | 'side'>('slider');
    const [split, setSplit] = React.useState(50), [help, setHelp] = React.useState(false);
    const [muted, setMuted] = React.useState(true), [playing, setPlaying] = React.useState(false);
    const [audioSide, setAudioSide] = React.useState<'left' | 'right'>('left');
    const [selectionSide, setSelectionSide] = React.useState<'left' | 'right'>('left');
    const [view, setView] = React.useState<CanvasCompareViewport>({ scale: 1, x: 0, y: 0 });
    const dialog = React.useRef<HTMLElement>(null), stage = React.useRef<HTMLDivElement>(null);
    const leftVideo = React.useRef<HTMLVideoElement>(null), rightVideo = React.useRef<HTMLVideoElement>(null);
    const pan = React.useRef<{ pointerId: number; x: number; y: number }>();
    const backdropDown = React.useRef(false);
    const item = (uri?: string): CanvasCompareVersion | undefined => props.library.find(entry => entry.uri === uri);
    const a = item(left), b = item(right), hasVideo = a?.kind === 'video' || b?.kind === 'video';
    const activeAudio = audioSide === 'left' && a?.kind === 'video' || b?.kind !== 'video' ? 'left' : 'right';
    React.useEffect(() => {
        const previous = dialog.current?.ownerDocument.activeElement;
        dialog.current?.focus();
        return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
    }, []);
    React.useEffect(() => {
        const videos = [leftVideo.current, rightVideo.current];
        setPlaying(false);
        return () => { for (const video of videos) video?.pause(); };
    }, [left, right, mode]);
    React.useEffect(() => {
        // A removed URI must not retain a playing, invisible preview or reappear as a different asset.
        if (left && !a) setLeft(undefined);
        if (right && !b) setRight(undefined);
    }, [left, right, a, b]);
    React.useEffect(() => {
        const element = stage.current;
        if (!element) return;
        const wheel = (event: WheelEvent): void => {
            event.preventDefault(); event.stopPropagation();
            const box = element.getBoundingClientRect();
            setView(current => zoomCanvasCompare(current, Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * .002),
                { x: event.clientX - box.left - box.width / 2, y: event.clientY - box.top - box.height / 2 }));
        };
        element.addEventListener('wheel', wheel, { passive: false });
        return () => element.removeEventListener('wheel', wheel);
    }, [mode, left, right]);
    const videos = (): HTMLVideoElement[] => [leftVideo.current, rightVideo.current].filter((video): video is HTMLVideoElement => Boolean(video));
    const playBoth = (): void => {
        const elements = videos();
        if (elements.some(video => !video.paused)) { elements.forEach(video => video.pause()); setPlaying(false); }
        else {
            const time = elements[0]?.currentTime || 0;
            for (const video of elements) { video.currentTime = canvasCompareSeek(time, video.duration, 0); void video.play().catch(() => setPlaying(false)); }
            setPlaying(elements.length > 0);
        }
    };
    const reset = (): void => setView({ scale: 1, x: 0, y: 0 });
    const clearPreview = (): void => { videos().forEach(video => video.pause()); setPlaying(false); setLeft(undefined); setRight(undefined); reset(); dialog.current?.focus(); };
    const choose = (uri: string, side: 'left' | 'right'): void => { setSelectionSide(side); (side === 'left' ? setLeft : setRight)(uri); };
    const keyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
        const focused = Boolean(dialog.current?.contains(dialog.current.ownerDocument.activeElement));
        if (!focused) return;
        // Native edits remain native, but keys inside this modal must never delete nodes behind it.
        event.stopPropagation();
        const target = event.target as Element;
        const strip = target.closest<HTMLElement>('[data-compare-index]');
        const action = canvasCompareKey({ key: event.key, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey,
            altKey: event.altKey, isComposing: event.nativeEvent.isComposing, focused, editing: canvasCompareEditingTarget(event.target),
            hasVideo, mode, stripIndex: strip ? Number(strip.dataset.compareIndex) : undefined, count: props.library.length });
        if (!action) return;
        event.preventDefault();
        switch (action.type) {
            case 'mode': setMode(mode === 'slider' ? 'side' : 'slider'); break;
            case 'center': setSplit(50); break;
            case 'split': setSplit(value => Math.max(0, Math.min(100, value + action.value))); break;
            case 'swap': setLeft(right); setRight(left); break;
            case 'seek': for (const video of videos()) video.currentTime = canvasCompareSeek(video.currentTime, video.duration, action.value); break;
            case 'play': playBoth(); break;
            case 'mute': setMuted(value => !value); break;
            case 'help': setHelp(value => !value); break;
            case 'zoom': setView(current => zoomCanvasCompare(current, action.value)); break;
            case 'reset': reset(); break;
            case 'select': {
                const requested = target.closest<HTMLElement>('[data-compare-side]')?.dataset.compareSide;
                const side = requested === 'left' || requested === 'right' ? requested : selectionSide;
                const entry = props.library[action.value]; if (entry) choose(entry.uri, side);
                dialog.current?.querySelector<HTMLElement>(`[data-compare-index="${action.value}"]`)?.focus(); break;
            }
            case 'escape': if (help) { setHelp(false); dialog.current?.focus(); } else if (a || b) clearPreview(); else props.onClose(); break;
        }
    };
    const transform: React.CSSProperties = { transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transformOrigin: 'center', pointerEvents: 'none' };
    const media = (entry: CanvasCompareVersion | undefined, ref: React.RefObject<HTMLVideoElement>, side: 'left' | 'right'): React.ReactNode => !entry ? <div className='nmx-board-compare-empty'>{props.library.length > 1 ? x(side === 'left' ? 'compareLeft' : 'compareRight') : x('compareOne')}</div>
        : entry.kind === 'video' ? <video ref={ref} src={props.mediaUrl(entry.uri)} muted={muted || activeAudio !== side} loop playsInline preload='metadata' style={transform} onPause={() => setPlaying(false)} /> : <img src={props.mediaUrl(entry.uri)} alt='' draggable={false} style={transform} />;
    return <div className='nmx-board-modal-backdrop' onMouseDown={event => { backdropDown.current = event.target === event.currentTarget; }}
        onClick={event => { if (backdropDown.current && event.target === event.currentTarget) props.onClose(); backdropDown.current = false; }}>
        <section ref={dialog} className='nmx-board-modal nmx-board-compare' role='dialog' aria-modal='true' aria-label={x('compare')} tabIndex={-1} onKeyDown={keyDown}>
            <header style={{ flexWrap: 'wrap', gap: 6 }}>
                <strong>{x('compare')}</strong>
                <div className='nmx-board-segmented'>
                    <button type='button' className={mode === 'slider' ? 'is-active' : ''} onClick={() => setMode('slider')}>{x('compareSlider')}</button>
                    <button type='button' className={mode === 'side' ? 'is-active' : ''} onClick={() => setMode('side')}>{x('compareSide')}</button>
                </div>
                <button type='button' className='nmx-secondary-button' onClick={() => { setLeft(right); setRight(left); }}>{x('compareSwap')}</button>
                {hasVideo && <>
                    <button type='button' className='nmx-secondary-button' onClick={playBoth}>{playing ? p('comparePause') : x('comparePlay')}</button>
                    <button type='button' className='nmx-secondary-button' aria-pressed={muted} onClick={() => setMuted(!muted)}>{muted ? p('compareUnmute') : p('compareMute')}</button>
                    {(['left', 'right'] as const).map(side => <button key={side} type='button' className='nmx-secondary-button' disabled={(side === 'left' ? a : b)?.kind !== 'video'} aria-pressed={!muted && activeAudio === side}
                        onClick={() => { setAudioSide(side); setMuted(false); }}>{p(side === 'left' ? 'compareAudioLeft' : 'compareAudioRight')}</button>)}
                </>}
                <button type='button' className='nmx-secondary-button' onClick={reset}>{p('compareReset')} <span data-nmx-literal>{Math.round(view.scale * 100)}%</span></button>
                <button type='button' className='nmx-secondary-button' onClick={clearPreview}>{p('compareClearPreview')}</button>
                <button type='button' className='nmx-secondary-button' aria-expanded={help} onClick={() => setHelp(!help)}>{p('compareHelp')}</button>
                <button type='button' className='nmx-board-modal-close' aria-label={x('close')} onClick={props.onClose}><i className='codicon codicon-close' aria-hidden='true'></i></button>
            </header>
            {help && <aside data-compare-help role='note' style={{ padding: 12, whiteSpace: 'pre-line' }}>{p('compareHelpKeys')}</aside>}
            {!props.library.length ? <div className='nmx-board-compare-empty'>{x('compareEmpty')}</div> : <div ref={stage} data-compare-stage={mode} data-compare-scale={view.scale}
                className={mode === 'side' ? 'nmx-board-compare-side' : 'nmx-board-compare-slider'} tabIndex={0} style={{ overflow: 'hidden' }}
                onDoubleClick={reset} onPointerDown={event => {
                    if (event.button !== 1 && (event.button !== 0 || view.scale <= 1 || canvasCompareEditingTarget(event.target))) return;
                    event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
                    pan.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
                }} onPointerMove={event => {
                    if (pan.current?.pointerId !== event.pointerId) return;
                    const dx = event.clientX - pan.current.x, dy = event.clientY - pan.current.y;
                    pan.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
                    setView(current => ({ ...current, x: current.x + dx, y: current.y + dy }));
                }} onPointerUp={() => { pan.current = undefined; }} onPointerCancel={() => { pan.current = undefined; }}>
                {mode === 'side' ? <><div>{media(a, leftVideo, 'left')}</div><div>{media(b, rightVideo, 'right')}</div></> : <>
                    <div className='nmx-board-compare-layer'>{media(a, leftVideo, 'left')}</div>
                    <div className='nmx-board-compare-layer is-top' style={{ clipPath: `inset(0 0 0 ${split}%)` }}>{media(b, rightVideo, 'right')}</div>
                    <input type='range' min={0} max={100} value={split} aria-label={x('compareSlider')} onChange={event => setSplit(Number(event.currentTarget.value))} />
                    <span className='nmx-board-compare-line' style={{ left: `${split}%` }} />
                </>}
            </div>}
            <footer className='nmx-board-compare-strip'>
                {props.library.map((entry, index) => <figure key={entry.uri} tabIndex={0} data-compare-index={index} aria-label={`${index + 1}`} className={entry.uri === left ? 'is-left' : entry.uri === right ? 'is-right' : ''}>
                    {entry.kind === 'video' ? <video src={props.mediaUrl(entry.uri)} muted preload='metadata' /> : <img src={props.mediaUrl(entry.uri)} alt='' />}
                    <div>
                        <button type='button' data-compare-side='left' title={x('compareLeft')} aria-label={x('compareLeft')} onClick={() => choose(entry.uri, 'left')}><i className='codicon codicon-arrow-left' aria-hidden='true'></i></button>
                        <button type='button' data-compare-side='right' title={x('compareRight')} aria-label={x('compareRight')} onClick={() => choose(entry.uri, 'right')}><i className='codicon codicon-arrow-right' aria-hidden='true'></i></button>
                        <button type='button' title={x('compareRemove')} aria-label={x('compareRemove')} onClick={() => props.onRemove(entry.uri)}><i className='codicon codicon-close' aria-hidden='true'></i></button>
                    </div>
                </figure>)}
                {props.library.length > 0 && <button type='button' className='nmx-link-button' onClick={props.onClear}>{x('compareClear')}</button>}
            </footer>
        </section>
    </div>;
}
