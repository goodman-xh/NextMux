import * as React from '@theia/core/shared/react';
import type { CanvasNode } from '@nextmux/comic-core/canvas';
import { canvasCurrentVersion, canvasVersionReady } from './nextmux-comic-canvas-logic';
import { ImeInput } from './nextmux-ime-field';
import { canvasDownloadAutoName, canvasDownloadExtension, canvasDownloadFileNames, canvasDownloadTimestamp, normalizeCanvasDownloadNaming,
    renameCanvasDownloads, sanitizeCanvasDownloadName, type CanvasDownloadItem, type CanvasDownloadNaming, type CanvasDownloadResult } from '../common/nextmux-canvas-download';
import { downloadErrorText, downloadText } from './nextmux-comic-canvas-download-text';
import '../../src/browser/style/nextmux-comic-canvas-download.css';

export type CanvasDownloadSave = (items: readonly CanvasDownloadItem[], zipName: string, signal: AbortSignal) => Promise<CanvasDownloadResult | undefined>;
const storageKey = 'nextmux.canvas.download.naming.v1';
export function canvasDownloadItems(nodes: readonly CanvasNode[]): CanvasDownloadItem[] {
    return nodes.flatMap(node => {
        const version = canvasCurrentVersion(node), extension = version && canvasDownloadExtension(version.uri);
        return version && canvasVersionReady(version) && extension && ['image', 'video', 'audio'].includes(version.kind)
            ? [{ nodeId: node.id, versionId: version.id, assetId: version.assetId, kind: version.kind as CanvasDownloadItem['kind'], label: node.title, extension, name: '', manual: false }] : [];
    });
}
export function CanvasDownloadDialog(props: { readonly locale: string; readonly items: readonly CanvasDownloadItem[]; readonly onSave: CanvasDownloadSave;
    readonly onClose: () => void; readonly onSaved: (result: CanvasDownloadResult) => void }): React.ReactElement {
    const t = (key: Parameters<typeof downloadText>[1]): string => downloadText(props.locale, key);
    const [stamp] = React.useState(() => canvasDownloadTimestamp());
    const [options, setOptions] = React.useState<CanvasDownloadNaming>(() => { try { return normalizeCanvasDownloadNaming(JSON.parse(localStorage.getItem(storageKey) || 'null')); } catch { return normalizeCanvasDownloadNaming(null); } });
    const [items, setItems] = React.useState(() => renameCanvasDownloads(props.items, options, stamp));
    const [zipName, setZipName] = React.useState('NextMux');
    const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
    const active = React.useRef<AbortController>(), mounted = React.useRef(true), dragged = React.useRef<number>();
    const root = React.useRef<HTMLDivElement>(null);
    React.useEffect(() => { mounted.current = true; root.current?.focus(); return () => { mounted.current = false; active.current?.abort(); }; }, []);
    const validOptions = Number.isInteger(options.start) && options.start >= 0 && options.start <= 99999
        && Number.isInteger(options.padding) && options.padding >= 1 && options.padding <= 6;
    const resolved = canvasDownloadFileNames(items), valid = validOptions && items.length > 0 && items.length <= 1000
        && resolved.empty.length === 0 && (items.length === 1 || Boolean(sanitizeCanvasDownloadName(zipName.replace(/\.zip$/iu, ''))));
    const update = (patch: Partial<CanvasDownloadNaming>): void => {
        const next = { ...options, ...patch }; setOptions(next); setError('');
        if (Number.isInteger(next.start) && Number.isInteger(next.padding)) setItems(renameCanvasDownloads(items, next, stamp));
    };
    const move = (from: number, to: number): void => {
        if (busy || to < 0 || to >= items.length || from === to) return;
        const next = [...items], [item] = next.splice(from, 1); next.splice(to, 0, item); setItems(renameCanvasDownloads(next, options, stamp));
    };
    const close = (): void => { active.current?.abort(); props.onClose(); };
    const save = async (): Promise<void> => {
        if (!valid || active.current) return;
        const controller = new AbortController(); active.current = controller; setBusy(true); setError('');
        try {
            const result = await props.onSave(items, sanitizeCanvasDownloadName(zipName.replace(/\.zip$/iu, '')) + '.zip', controller.signal);
            if (result) {
                try { localStorage.setItem(storageKey, JSON.stringify(normalizeCanvasDownloadNaming(options))); } catch { /* Export success is independent of preference storage. */ }
                props.onSaved(result);
                if (mounted.current) props.onClose();
            }
        } catch (error) { if (mounted.current && !controller.signal.aborted) setError(downloadErrorText(props.locale, error)); }
        finally { active.current = undefined; if (mounted.current) setBusy(false); }
    };
    return <div className='nmx-board-download-backdrop' ref={root} tabIndex={-1} onMouseDown={event => { if (event.target === event.currentTarget && !busy) close(); }} onKeyDown={event => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') { event.preventDefault(); close(); }
        if (event.key === 'Tab') {
            const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)')];
            const index = controls.indexOf(document.activeElement as HTMLElement);
            if (index < 0 || event.shiftKey && index === 0 || !event.shiftKey && index === controls.length - 1) {
                event.preventDefault(); (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
            }
        }
    }}><section className='nmx-board-download' role='dialog' aria-modal='true' aria-label={t('title')} dir={props.locale === 'ar' ? 'rtl' : undefined}>
        <header><h2>{t('title')}</h2><button type='button' aria-label={t('cancel')} onClick={close}>×</button></header>
        <fieldset disabled={busy}><div className='nmx-board-download-options'>
            <label>{t('rule')}<select value={options.rule} onChange={event => update({ rule: event.target.value as CanvasDownloadNaming['rule'] })}>
                {(['index_name','name_index','name','index','type_index'] as const).map(rule => <option key={rule} value={rule}>{t(rule)}</option>)}</select></label>
            <label>{t('start')}<input aria-label={t('start')} type='number' min={0} max={99999} step={1} value={Number.isFinite(options.start) ? options.start : ''} onChange={event => update({ start: event.target.value === '' ? NaN : Number(event.target.value) })} /></label>
            <label>{t('padding')}<input aria-label={t('padding')} type='number' min={1} max={6} step={1} value={Number.isFinite(options.padding) ? options.padding : ''} onChange={event => update({ padding: event.target.value === '' ? NaN : Number(event.target.value) })} /></label>
            <label>{t('separator')}<select value={options.separator} onChange={event => update({ separator: event.target.value as CanvasDownloadNaming['separator'] })}>
                {(['_', '-', ' ', ''] as const).map((value, index) => <option key={value} value={value}>{t((['underscore','hyphen','space','none'] as const)[index])}</option>)}</select></label>
            <label>{t('prefix')}<ImeInput aria-label={t('prefix')} maxLength={24} value={options.prefix} onChange={event => update({ prefix: event.currentTarget.value })} /></label>
            <label className='nmx-board-download-check'><input type='checkbox' checked={options.timestamp} onChange={event => update({ timestamp: event.target.checked })} />{t('timestamp')}</label>
        </div><button type='button' disabled={!validOptions} onClick={() => setItems(renameCanvasDownloads(items, options, stamp, true))}>{t('applyAll')}</button>
        <ol className='nmx-board-download-items'>{items.map((item, index) => <li key={`${item.nodeId}:${item.versionId}`} draggable={!busy} onDragStart={() => { dragged.current = index; }}
            onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (dragged.current !== undefined) move(dragged.current, index); dragged.current = undefined; }}>
            <div className='nmx-board-download-order'><button type='button' aria-label={t('up')} disabled={index === 0} onClick={() => move(index, index - 1)}>↑</button><button type='button' aria-label={t('down')} disabled={index === items.length - 1} onClick={() => move(index, index + 1)}>↓</button></div>
            <div><label><span data-nmx-literal>{item.label}</span><ImeInput aria-label={`${t('fileName')} ${index + 1}`} value={item.name} maxLength={140}
                onChange={event => { const name = event.currentTarget.value; setItems(items.map((value, i) => i === index ? { ...value, name, manual: true } : value)); }} /></label>
                <small>{t('preview')}: <bdi data-nmx-literal>{resolved.names[index]}</bdi> · {t(item.manual ? 'manual' : 'automatic')}</small></div>
            <button type='button' disabled={!item.manual || !validOptions} onClick={() => setItems(items.map((value, i) => i === index ? { ...value, manual: false, name: canvasDownloadAutoName(value, i, options, stamp) } : value))}>{t('restore')}</button>
        </li>)}</ol>
        {items.length > 1 && <label>{t('zipName')}<ImeInput aria-label={t('zipName')} value={zipName} maxLength={140} onChange={event => setZipName(event.currentTarget.value)} /><span>.zip</span></label>}
        </fieldset>
        {resolved.conflicts.length > 0 && <p role='status'>{t('conflicts')}</p>}
        {resolved.empty.length > 0 && <p role='alert'>{t('empty')}</p>}
        {!validOptions && <p role='alert'>{t('invalid')}</p>}
        {error && <p role='alert'>{error}</p>}
        <footer><small>{t('tooLarge')}</small><button type='button' onClick={close}>{t('cancel')}</button><button type='button' className='is-primary' disabled={busy || !valid} onClick={() => void save()}>{t(busy ? 'saving' : 'save')}</button></footer>
    </section></div>;
}
