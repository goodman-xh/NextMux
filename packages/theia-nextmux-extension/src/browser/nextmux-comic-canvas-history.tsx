import * as React from '@theia/core/shared/react';
import { createPortal } from '@theia/core/shared/react-dom';
import type { CanvasAssetVersion, CanvasDocument, CanvasMediaKind } from '@nextmux/comic-core/canvas';
import { CanvasModalLayer } from './nextmux-comic-canvas-modal';
import { canvasText } from './nextmux-comic-canvas-text';
import { canvasFloatText } from './nextmux-comic-canvas-float-text';
import { canvasHistoryText, type CanvasHistoryTextKey } from './nextmux-comic-canvas-history-text';
import { canvasHistoryParameters, canvasHistoryVersionAvailable, collectCanvasHistory, filterCanvasHistory, groupCanvasHistory, clampCanvasHistoryWindow,
    type CanvasHistoryEntry, type CanvasHistoryStatus, type CanvasHistoryWindow } from './nextmux-comic-canvas-history-logic';
import '../../src/browser/style/nextmux-comic-canvas-history.css';

export interface CanvasGenerationHistoryDialogProps {
    readonly locale: string;
    /** Only actual loaded documents; do not synthesize other projects' history from matching URLs. */
    readonly canvases: readonly CanvasDocument[];
    readonly initialCanvasId?: string;
    readonly initialNodeId?: string;
    readonly mediaUrl: (uri: string) => string;
    readonly isVersionAvailable?: (canvasId: string, nodeId: string, version: CanvasAssetVersion) => boolean;
    /** Parent rechecks the captured canvas and version, and persists node.selectVersion. No generation is requested. */
    readonly onSelectVersion: (canvasId: string, nodeId: string, versionId: string) => Promise<void> | void;
    readonly onRefresh?: () => Promise<void>;
    readonly onClose: () => void;
}

export function CanvasGenerationHistoryDialog(props: CanvasGenerationHistoryDialogProps): React.ReactElement {
    const h = (key: CanvasHistoryTextKey, values?: Readonly<Record<string, string | number>>): string => canvasHistoryText(props.locale, key, values);
    const nodeLayout = Boolean(props.initialNodeId);
    const [query, setQuery] = React.useState(''), [kind, setKind] = React.useState<CanvasMediaKind | 'all'>('all');
    const [statuses, setStatuses] = React.useState<ReadonlySet<CanvasHistoryStatus>>(new Set(['success', 'running', 'failed', 'other']));
    const [view, setView] = React.useState<'grid' | 'list'>('grid');
    const [groupBy, setGroupBy] = React.useState<'day' | 'week' | 'month'>(() => { try { const value = window.localStorage.getItem('nextmux.canvas.history.groupBy'); return value === 'week' || value === 'month' ? value : 'day'; } catch { return 'day'; } });
    const [nodeKey, setNodeKey] = React.useState(props.initialNodeId ? JSON.stringify([props.initialCanvasId ?? props.canvases.find(canvas => canvas.nodes.some(node => node.id === props.initialNodeId))?.id, props.initialNodeId]) : '');
    const [selectedKey, setSelectedKey] = React.useState(''), [page, setPage] = React.useState(1), [pageSize, setPageSize] = React.useState(42);
    const [working, setWorking] = React.useState<'select' | 'refresh'>(), [error, setError] = React.useState(false);
    const [previewEpoch, setPreviewEpoch] = React.useState(0);
    const lock = React.useRef(false), mounted = React.useRef(true), backdropDown = React.useRef(false), latest = React.useRef(props); latest.current = props;
    const [mediaState, setMediaState] = React.useState<{ readonly key: string; readonly state: 'ready' | 'failed' }>();
    const strip = React.useRef<HTMLDivElement>(null), main = React.useRef<HTMLElement>(null);
    const [previousFocus] = React.useState(() => document.activeElement);
    const [viewport, setViewport] = React.useState({ width: window.innerWidth, height: window.innerHeight });
    const [rect, setRect] = React.useState<CanvasHistoryWindow>(() => {
        let saved: Partial<CanvasHistoryWindow> = {}; try { saved = JSON.parse(window.localStorage.getItem('nextmux.canvas.history.window.v1') || '{}'); } catch { /* defaults */ }
        return clampCanvasHistoryWindow({ left: (window.innerWidth - 760) / 2, top: 24, width: 760, height: Math.min(720, window.innerHeight - 48), ...saved }, { width: window.innerWidth, height: window.innerHeight });
    });
    const rectRef = React.useRef(rect); rectRef.current = rect;
    const drag = React.useRef<{ readonly id: number; readonly x: number; readonly y: number; readonly rect: CanvasHistoryWindow; readonly resize: boolean }>();
    React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    React.useEffect(() => { if (nodeLayout) return; main.current?.focus({ preventScroll: true }); return () => { if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true }); }; }, [nodeLayout, previousFocus]);
    React.useEffect(() => { const resize = (): void => { const next = { width: window.innerWidth, height: window.innerHeight }; setViewport(next); setRect(value => clampCanvasHistoryWindow(value, next)); };
        window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
    // The floating window is not modal, so focus is often on the canvas: Escape anywhere closes it. Its own keydown
    // (focus inside) and any modal dialog opened above it handle Escape first and stop it before this listener.
    React.useEffect(() => {
        if (nodeLayout) return;
        const modalAbove = (): boolean => {
            try { return [...document.querySelectorAll('dialog[open]')].some(dialog => dialog.matches(':modal')); }
            catch { return document.querySelector('dialog[open]') !== null; }
        };
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.keyCode === 229 || modalAbove()) return;
            event.preventDefault();
            latest.current.onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [nodeLayout]);
    const entries = collectCanvasHistory(props.canvases);
    const scoped = props.initialCanvasId ? entries.filter(entry => entry.canvasId === props.initialCanvasId) : entries;
    const nodes = [...new Map(scoped.map(entry => [JSON.stringify([entry.canvasId, entry.nodeId]), entry])).entries()];
    const nodeEntries = scoped.filter(entry => !nodeKey || JSON.stringify([entry.canvasId, entry.nodeId]) === nodeKey);
    const filtered = filterCanvasHistory(nodeEntries, { query, kind }).filter(entry => !nodeLayout || statuses.has(entry.status));
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize)), currentPage = Math.min(page, pages), visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    const selected = filtered.find(entry => entry.key === selectedKey) ?? (nodeLayout ? filtered[0] : undefined);
    const version = selected?.version;
    let url = '';
    try { if (version && canvasHistoryVersionAvailable(selected!)) url = props.mediaUrl(version.uri); } catch { /* inaccessible mappings stay disabled */ }
    const mediaKey = JSON.stringify([selected?.key, url, previewEpoch]);
    const available = Boolean(selected && canvasHistoryVersionAvailable(selected) && version && url
        && (!props.isVersionAvailable || props.isVersionAvailable(selected.canvasId, selected.nodeId, version)));
    const previewReady = mediaState?.key === mediaKey && mediaState.state === 'ready';
    const previewFailed = mediaState?.key === mediaKey && mediaState.state === 'failed';
    const canSelect = Boolean(selected && version && available && previewReady && !selected.current && !working);
    const reset = (): void => { setPage(1); setSelectedKey(''); setError(false); };
    const operate = async (operation: 'select' | 'refresh'): Promise<void> => {
        if (lock.current || operation === 'select' && !canSelect) return;
        lock.current = true; setWorking(operation); setError(false);
        if (operation === 'refresh') setPreviewEpoch(value => value + 1);
        try {
            const owner = latest.current;
            if (operation === 'refresh') await owner.onRefresh?.();
            else if (selected?.version) {
                const actual = collectCanvasHistory(owner.canvases).find(entry => entry.key === selected.key);
                if (!actual?.version || !canvasHistoryVersionAvailable(actual) || (owner.isVersionAvailable && !owner.isVersionAvailable(actual.canvasId, actual.nodeId, actual.version))) throw new Error('HISTORY_UNAVAILABLE');
                await owner.onSelectVersion(actual.canvasId, actual.nodeId, actual.version.id);
            }
        } catch { if (mounted.current) setError(true); }
        finally { lock.current = false; if (mounted.current) setWorking(undefined); }
    };
    const statusText = (entry: CanvasHistoryEntry): string => h(entry.status);
    const date = (value: string): string => { try { return new Date(value).toLocaleString(props.locale); } catch { return value; } };
    const chosen = (entry: CanvasHistoryEntry): void => {
        setSelectedKey(entry.key); setPreviewEpoch(value => value + 1); setError(false);
        if (!nodeLayout && viewport.width >= 890) setRect(value => value.left + value.width + 392 <= viewport.width - 12 || value.left >= 404 ? value
            : clampCanvasHistoryWindow({ ...value, left: 24, width: Math.min(value.width, viewport.width - 440) }, viewport));
    };
    const preview = <div className='nmx-canvas-history-preview' key={mediaKey}>
        {selected && (available && !previewFailed ? version?.kind === 'image'
            ? <img src={url} alt={selected.nodeTitle} onLoad={() => setMediaState({ key: mediaKey, state: 'ready' })} onError={() => setMediaState({ key: mediaKey, state: 'failed' })} />
            : version?.kind === 'video' ? <video src={url} controls preload='metadata' onLoadedMetadata={() => setMediaState({ key: mediaKey, state: 'ready' })} onError={() => setMediaState({ key: mediaKey, state: 'failed' })} />
                : <audio src={url} controls preload='metadata' onLoadedMetadata={() => setMediaState({ key: mediaKey, state: 'ready' })} onError={() => setMediaState({ key: mediaKey, state: 'failed' })} />
            : <p>{h(version ? 'unavailable' : 'noResult')}</p>)}
        {selected && available && !previewReady && !previewFailed && <p role='status'>{h('checking')}</p>}
        {!selected && <p>{h('empty')}</p>}
    </div>;
    const detail = <div className='nmx-canvas-history-detail'>{selected && <>
        <div className='nmx-canvas-history-meta'><div><small>{h('node')}</small><span>{selected.nodeTitle}</span></div><div><small>{h('time')}</small><span>{date(selected.createdAt)}</span></div>
            <div><small>{h('status')}</small><span>{statusText(selected)}</span></div>{selected.snapshot && <><div><small>{h('model')}</small><span>{selected.snapshot.modelId}</span></div>
                {Object.entries(canvasHistoryParameters(selected.snapshot)).map(([key, value]) => <div key={key}><small>{key === 'resolution' ? canvasText(props.locale, 'resolution') : key === 'aspectRatio' ? canvasText(props.locale, 'aspect') : key === 'durationSeconds' ? canvasText(props.locale, 'duration') : key === 'generateAudio' || key === 'preserveInputAudio' ? canvasText(props.locale, 'audio') : key}</small><span>{typeof value === 'boolean' ? canvasText(props.locale, value ? 'audioOn' : 'audioOff') : String(value)}</span></div>)}</>}</div>
        {selected.snapshot && <section className='nmx-canvas-history-prompt-section'><h4>{h('prompt')}</h4><div className='nmx-canvas-history-prompt'>{selected.snapshot.prompt}</div></section>}
    </>}</div>;
    const selectionFooter = <footer className='nmx-canvas-history-select'><span role={error ? 'alert' : 'status'}>{error ? h('failedAction') : working === 'select' ? h('saving') : selected?.current ? h('current') : ''}</span>
        <button type='button' disabled={!canSelect} title={h('select')} onClick={() => void operate('select')}>{h('select')}</button></footer>;
    const row = (entry: CanvasHistoryEntry): React.ReactElement => {
        let thumbnail = ''; try { if (entry.version && entry.kind === 'image' && canvasHistoryVersionAvailable(entry)) thumbnail = props.mediaUrl(entry.version.uri); } catch { /* unavailable */ }
        return <button type='button' key={entry.key} data-history-key={entry.key} className={`nmx-canvas-history-card${entry.key === selected?.key ? ' is-selected' : ''}`}
            title={`${entry.nodeTitle} · ${date(entry.createdAt)} · ${statusText(entry)}`} aria-label={`${entry.nodeTitle} · ${date(entry.createdAt)} · ${statusText(entry)}`} onClick={() => chosen(entry)}>
            {thumbnail ? <img src={thumbnail} loading='lazy' alt='' onError={event => { event.currentTarget.style.visibility = 'hidden'; }} /> : <span className='nmx-canvas-history-card-placeholder'>{canvasText(props.locale, `kind.${entry.kind}`)}</span>}
            <span className='nmx-canvas-history-card-info'><strong>{entry.nodeTitle}</strong><small>{date(entry.createdAt)} · {statusText(entry)}</small></span>{entry.current && <em>{h('current')}</em>}
        </button>;
    };
    const close = <button type='button' className='nmx-canvas-history-close' aria-label={h('close')} title={h('close')} onClick={props.onClose}>×</button>;
    const keyDown = (event: React.KeyboardEvent): void => { event.stopPropagation(); if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); props.onClose(); } };
    if (nodeLayout) return <CanvasModalLayer locale={props.locale}><div className='nmx-canvas-history-backdrop'
        onMouseDown={event => { backdropDown.current = event.target === event.currentTarget; }}
        onClick={event => { if (backdropDown.current && event.target === event.currentTarget) props.onClose(); backdropDown.current = false; }}
        onKeyDown={keyDown}>
        <section className='nmx-canvas-history is-node' role='dialog' aria-modal='true' aria-label={h('title')} tabIndex={-1}>
            <div className='nmx-canvas-history-node-left'>{preview}<div className='nmx-canvas-history-bottom'>
                <div className='nmx-canvas-history-statuses'>{(['success', 'running', 'failed', ...(nodeEntries.some(entry => entry.status === 'other') ? ['other' as const] : [])] as const).map(value =>
                    <button type='button' key={value} aria-pressed={statuses.has(value)} title={h(value)} onClick={() => { const next = new Set(statuses); if (next.has(value)) next.delete(value); else next.add(value); setStatuses(next); setSelectedKey(''); }}>
                        <span>{h(value)}</span><span>{nodeEntries.filter(entry => entry.status === value).length}</span></button>)}</div>
                <button type='button' className='nmx-canvas-history-strip-scroll' title={h('previous')} aria-label={h('previous')} onClick={() => strip.current?.scrollBy({ left: -Math.max(240, strip.current.clientWidth * .6), behavior: 'smooth' })}>‹</button>
                <div className='nmx-canvas-history-strip' ref={strip}>{filtered.length ? filtered.map(row) : <p>{h('empty')}</p>}</div>
                <button type='button' className='nmx-canvas-history-strip-scroll' title={h('next')} aria-label={h('next')} onClick={() => strip.current?.scrollBy({ left: Math.max(240, strip.current.clientWidth * .6), behavior: 'smooth' })}>›</button>
            </div></div><aside className='nmx-canvas-history-node-right'><header><strong>{h('parameters')}</strong>{close}</header>
                <p className='nmx-canvas-history-scope'>{h('scope', { n: props.initialCanvasId ? 1 : props.canvases.length })}</p>{detail}
                {props.onRefresh && <button type='button' className='nmx-canvas-history-refresh' disabled={Boolean(working)} title={h('refresh')} onClick={() => void operate('refresh')}>{h('refresh')}</button>}{selectionFooter}</aside>
        </section></div></CanvasModalLayer>;
    const begin = (event: React.PointerEvent<HTMLElement>, resize: boolean): void => {
        if (event.button !== 0 || !resize && (event.target as HTMLElement).closest('button,input,select')) return;
        event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, rect, resize };
    };
    const move = (event: React.PointerEvent<HTMLElement>): void => {
        const own = drag.current; if (!own || own.id !== event.pointerId) return;
        const dx = event.clientX - own.x, dy = event.clientY - own.y;
        const next = clampCanvasHistoryWindow(own.resize ? { ...own.rect, width: own.rect.width + dx, height: own.rect.height + dy } : { ...own.rect, left: own.rect.left + dx, top: own.rect.top + dy }, viewport);
        rectRef.current = next; setRect(next);
    };
    const end = (): void => { if (!drag.current) return; drag.current = undefined; try { window.localStorage.setItem('nextmux.canvas.history.window.v1', JSON.stringify(rectRef.current)); } catch { /* current window still works */ } };
    const dockRight = rect.left + rect.width + 392 <= viewport.width - 12, dockLeft = rect.left >= 404;
    const drawerStyle: React.CSSProperties = dockRight ? { left: rect.width + 12 } : dockLeft ? { right: rect.width + 12 }
        : { left: Math.max(0, rect.width - Math.min(380, rect.width)), width: Math.min(380, rect.width), top: 52 };
    return <>{createPortal(<section ref={main} className='nmx-canvas-history is-global' role='dialog' aria-label={h('title')} tabIndex={-1}
        lang={props.locale} dir={props.locale === 'ar' ? 'rtl' : 'ltr'} style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        onKeyDown={keyDown} onMouseDown={event => event.stopPropagation()} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
        <header title={canvasFloatText(props.locale, 'move')} onPointerDown={event => begin(event, false)}><strong>{h('title')}</strong>
            <div className='nmx-canvas-history-category-tabs'>{(['all', 'image', 'video', 'audio'] as const).map(value => <button key={value} type='button' aria-pressed={kind === value} title={value === 'all' ? h('all') : canvasText(props.locale, `kind.${value}`)} onClick={() => { setKind(value); reset(); }}>{value === 'all' ? h('all') : canvasText(props.locale, `kind.${value}`)}</button>)}</div>{close}</header>
        <div className='nmx-canvas-history-global-controls'><div>{(['day', 'week', 'month'] as const).map(value => <button key={value} type='button' aria-pressed={groupBy === value} title={h(value)} onClick={() => { setGroupBy(value); try { window.localStorage.setItem('nextmux.canvas.history.groupBy', value); } catch { /* optional preference */ } }}>{h(value)}</button>)}</div>
            <button type='button' title={h(view === 'grid' ? 'list' : 'grid')} aria-label={h(view === 'grid' ? 'list' : 'grid')} onClick={() => setView(view === 'grid' ? 'list' : 'grid')}>{h(view === 'grid' ? 'list' : 'grid')}</button>
            {props.onRefresh && <button type='button' disabled={Boolean(working)} title={h('refresh')} onClick={() => void operate('refresh')}>{h('refresh')}</button>}</div>
        <p className='nmx-canvas-history-scope'>{h('scope', { n: props.canvases.length })}</p>
        <div className='nmx-canvas-history-filters'><input type='search' aria-label={h('search')} placeholder={h('search')} value={query} onChange={event => { setQuery(event.currentTarget.value); reset(); }} />
            <select aria-label={h('node')} value={nodeKey} onChange={event => { setNodeKey(event.currentTarget.value); reset(); }}><option value=''>{h('all')} · {h('node')}</option>{nodes.map(([key, entry]) => <option key={key} value={key}>{entry.canvasTitle} · {entry.nodeTitle}</option>)}</select></div>
        <div className='nmx-canvas-history-groups'>{!visible.length && <p>{h('empty')}</p>}{groupCanvasHistory(visible, groupBy).map(group => <section key={group.date}>
            <h4>{group.date} <small>{group.entries.length}</small></h4><div className={`nmx-canvas-history-grid${view === 'list' ? ' is-list' : ''}`}>{group.entries.map(row)}</div></section>)}</div>
        <footer className='nmx-canvas-history-pages'><button type='button' disabled={currentPage <= 1} title={h('previous')} aria-label={h('previous')} onClick={() => { setPage(currentPage - 1); setSelectedKey(''); }}>‹</button>
            <span>{h('page', { page: currentPage, pages })}</span><button type='button' disabled={currentPage >= pages} title={h('next')} aria-label={h('next')} onClick={() => { setPage(currentPage + 1); setSelectedKey(''); }}>›</button>
            <select aria-label={h('perPage')} value={pageSize} onChange={event => { setPageSize(Number(event.currentTarget.value)); reset(); }}>{[24, 42, 60, 90].map(count => <option key={count} value={count}>{count}</option>)}</select></footer>
        {selected && <aside className='nmx-canvas-history-drawer' style={drawerStyle}><header><strong>{h('parameters')}</strong><button type='button' title={h('close')} aria-label={h('close')} onClick={() => setSelectedKey('')}>×</button></header>{preview}{detail}{selectionFooter}</aside>}
        <button type='button' className='nmx-canvas-history-resize' title={canvasFloatText(props.locale, 'br')} aria-label={canvasFloatText(props.locale, 'br')} onPointerDown={event => begin(event, true)}
            onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); setRect(clampCanvasHistoryWindow({ ...rect, width: rect.width + (event.key === 'ArrowRight' ? 20 : event.key === 'ArrowLeft' ? -20 : 0), height: rect.height + (event.key === 'ArrowDown' ? 20 : event.key === 'ArrowUp' ? -20 : 0) }, viewport)); }}>◢</button>
    </section>, document.body)}</>;
}
