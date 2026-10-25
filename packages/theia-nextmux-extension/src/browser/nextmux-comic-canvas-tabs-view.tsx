import * as React from '@theia/core/shared/react';
import { ImeInput } from './nextmux-ime-field';
import { canvasText } from './nextmux-comic-canvas-text';
import { comicCanvasTabKeyTarget, type ComicCanvasTabRecord, type ComicCanvasTabView } from './nextmux-comic-canvas-tabs';
import { canvasTabsActionText, comicCanvasTabsErrorText } from './nextmux-comic-canvas-tabs-text';
import { CanvasModalLayer } from './nextmux-comic-canvas-modal';
import { canvasTransferText } from './nextmux-comic-canvas-transfer-text';
import type { CanvasTransferRequest } from './nextmux-comic-canvas-transfer';

export interface ComicCanvasTabsProps {
    readonly locale: string;
    readonly tabs: readonly ComicCanvasTabView[];
    readonly closed: readonly ComicCanvasTabRecord[];
    readonly pending: readonly ComicCanvasTabRecord[];
    readonly activeCanvasId?: string;
    readonly switching: boolean;
    readonly media: readonly { readonly id: string; readonly title: string }[];
    readonly onSwitch: (id: string) => Promise<void>;
    readonly onCreate: () => Promise<void>;
    readonly onClose: (id: string) => Promise<boolean>;
    readonly onRename: (id: string, name: string) => Promise<void>;
    readonly onDelete: (id: string) => Promise<void>;
    readonly onCopyToMain?: (id: string) => Promise<void>;
    readonly onTransfer?: (request: CanvasTransferRequest) => Promise<void>;
    readonly onResolveDelete: (id: string) => Promise<void>;
}

/** Structure only. Claude owns the nmx-canvas-tabs styles. */
export function ComicCanvasTabs(props: ComicCanvasTabsProps): React.ReactElement {
    const [editor, setEditor] = React.useState<{ readonly id: string; readonly name: string }>();
    const [deleting, setDeleting] = React.useState<ComicCanvasTabView>();
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string>();
    const [transfer, setTransfer] = React.useState<CanvasTransferRequest>();
    const buttons = React.useRef(new Map<string, HTMLButtonElement>());
    const a = (key: Parameters<typeof canvasTabsActionText>[1], values?: Readonly<Record<string, string | number>>): string => canvasTabsActionText(props.locale, key, values);
    const t = (key: Parameters<typeof canvasText>[1]): string => canvasText(props.locale, key);
    const run = async (action: () => Promise<unknown>, done?: () => void): Promise<void> => {
        if (busy || props.switching) return;
        setBusy(true); setError(undefined);
        try { await action(); done?.(); }
        catch (failure) { setError(comicCanvasTabsErrorText(props.locale, failure)); }
        finally { setBusy(false); }
    };
    const disabled = busy || props.switching;
    const destinations = [...props.tabs, ...props.closed].filter(tab => tab.id !== props.activeCanvasId && !tab.deletedAt && !tab.deletionPending);
    const x = (key: Parameters<typeof canvasTransferText>[1]): string => canvasTransferText(props.locale, key);
    const reviseTransfer = (patch: Partial<CanvasTransferRequest>): void => setTransfer(value => value && ({ ...value, ...patch, requestId: crypto.randomUUID(), createdAt: new Date().toISOString() }));
    const dialogRef = React.useRef<HTMLDivElement>(null);
    const listRef = React.useRef<HTMLDivElement>(null);
    React.useEffect(() => { if (transfer && transfer.sourceId !== props.activeCanvasId) setTransfer(undefined); }, [props.activeCanvasId, transfer]);
    // The tab strip hides its scrollbar: a vertical wheel scrolls it sideways (non-passive, so the page never moves).
    React.useEffect(() => {
        const list = listRef.current;
        if (!list) return;
        const onWheel = (event: WheelEvent): void => {
            if (event.ctrlKey || event.metaKey || list.scrollWidth <= list.clientWidth + 1) return;
            const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
            if (!delta) return;
            event.preventDefault();
            list.scrollLeft += delta * (event.deltaMode === 1 ? 32 : 1);
        };
        list.addEventListener('wheel', onWheel, { passive: false });
        return () => list.removeEventListener('wheel', onWheel);
    }, []);
    // Keep the active tab inside the strip (manual scroll: scrollIntoView could also move the clipped desk stage).
    React.useEffect(() => {
        const list = listRef.current, tab = props.activeCanvasId ? buttons.current.get(props.activeCanvasId)?.parentElement : undefined;
        if (!list || !tab) return;
        const strip = list.getBoundingClientRect(), box = tab.getBoundingClientRect();
        if (box.left < strip.left) list.scrollLeft -= strip.left - box.left + 12;
        else if (box.right > strip.right) list.scrollLeft += box.right - strip.right + 12;
    }, [props.activeCanvasId, props.tabs.length]);
    React.useEffect(() => {
        if (!editor && !deleting) return;
        const onMouseDown = (event: MouseEvent): void => {
            if (!busy && dialogRef.current && !(event.target instanceof Node && dialogRef.current.contains(event.target))) {
                setEditor(undefined);
                setDeleting(undefined);
            }
        };
        document.addEventListener('mousedown', onMouseDown, true);
        return () => document.removeEventListener('mousedown', onMouseDown, true);
    }, [Boolean(editor), Boolean(deleting), busy]);
    return <div className='nmx-canvas-tabs'>
        <div ref={listRef} className='nmx-canvas-tabs-list' role='tablist' aria-label={a('tabs')}>
            {props.tabs.map(tab => <div key={tab.id} className='nmx-canvas-tab' role='presentation' data-save-state={tab.saveState}>
                <button type='button' role='tab' id={`nmx-canvas-tab-${tab.id}`} aria-controls={`nmx-canvas-panel-${tab.id}`} aria-selected={tab.active}
                    tabIndex={tab.active ? 0 : -1} disabled={disabled} ref={element => { if (element) buttons.current.set(tab.id, element); else buttons.current.delete(tab.id); }}
                    title={tab.error ?? tab.notice ?? t(tab.saveState === 'dirty' ? 'unsaved' : tab.saveState === 'failed' ? 'saveFailed' : tab.saveState)}
                    onClick={() => void run(() => props.onSwitch(tab.id))}
                    onKeyDown={event => {
                        if (event.key === 'Delete' && tab.kind === 'free' && !event.nativeEvent.isComposing && event.keyCode !== 229 && !event.ctrlKey && !event.metaKey && !event.altKey) {
                            event.preventDefault(); event.stopPropagation();
                            void run(async () => {
                                if (await props.onClose(tab.id)) {
                                    const fallback = props.tabs.filter(item => item.id !== tab.id).at(-1);
                                    if (fallback) buttons.current.get(fallback.id)?.focus();
                                }
                            });
                            return;
                        }
                        const id = comicCanvasTabKeyTarget(props.tabs.map(item => item.id), tab.id, { key: event.key, isComposing: event.nativeEvent.isComposing,
                            keyCode: event.keyCode, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey });
                        if (!id) return;
                        event.preventDefault(); event.stopPropagation();
                        void run(() => props.onSwitch(id), () => buttons.current.get(id)?.focus());
                    }}>
                    <span>{tab.title}</span><span className='nmx-canvas-tab-state' aria-hidden='true'>{tab.saveState === 'dirty' ? '•' : tab.saveState === 'saving' ? '…' : tab.saveState === 'failed' ? '!' : ''}</span>
                </button>
                {tab.kind === 'free' && <button type='button' className='nmx-canvas-tab-close' tabIndex={-1} disabled={disabled} aria-keyshortcuts='Delete' aria-label={a('closeTab', { name: tab.title })}
                    onClick={() => void run(() => props.onClose(tab.id))}>×</button>}
            </div>)}
        </div>
        <div className='nmx-canvas-tabs-actions'>
            <button type='button' disabled={disabled} aria-label={a('create')} onClick={() => void run(props.onCreate)}>+</button>
            {props.closed.length > 0 && <select aria-label={a('reopen')} value='' disabled={disabled} onChange={event => { const id = event.currentTarget.value; if (id) void run(() => props.onSwitch(id)); }}>
                <option value=''>{a('reopen')}</option>{props.closed.map(tab => <option key={tab.id} value={tab.id}>{tab.title}</option>)}
            </select>}
            {props.tabs.find(tab => tab.id === props.activeCanvasId)?.kind === 'free' && <>
                <button type='button' disabled={disabled} onClick={() => { const tab = props.tabs.find(item => item.id === props.activeCanvasId); if (tab) { setError(undefined); setDeleting(undefined); setEditor({ id: tab.id, name: tab.title }); } }}>{t('rename')}</button>
                <button type='button' disabled={disabled} onClick={() => { setError(undefined); setEditor(undefined); setDeleting(props.tabs.find(tab => tab.id === props.activeCanvasId)); }}>{t('delete')}</button>
                {!props.onTransfer && props.onCopyToMain && props.media.length > 0 && <select aria-label={a('copyToMain')} value='' disabled={disabled} onChange={event => { const id = event.currentTarget.value; if (id) void run(() => props.onCopyToMain!(id)); }}>
                    <option value=''>{a('copyToMain')}</option>{props.media.map(node => <option key={node.id} value={node.id}>{node.title}</option>)}
                </select>}
            </>}
            {props.onTransfer && props.media.length > 0 && destinations.length > 0 && <button type='button' disabled={disabled}
                onClick={() => { setError(undefined); setTransfer({ requestId: crypto.randomUUID(), createdAt: new Date().toISOString(), sourceId: props.activeCanvasId!,
                    targetId: destinations[0].id, nodeIds: [], mode: 'copy' }); }}>{x('title')}</button>}
        </div>
        {props.pending.map(tab => <div key={tab.id} className='nmx-canvas-tabs-pending'>
            <span>{a('deleteTitle', { name: tab.title })}</span><button type='button' disabled={disabled} onClick={() => void run(() => props.onResolveDelete(tab.id))}>{t('retry')}</button>
        </div>)}
        {editor && <div ref={dialogRef} className='nmx-canvas-tabs-dialog' role='dialog' aria-modal='true' aria-label={t('rename')} onKeyDown={event => {
            event.stopPropagation(); if (event.key === 'Escape' && !event.nativeEvent.isComposing && !busy) setEditor(undefined);
        }}>
            <ImeInput autoFocus aria-label={t('rename')} maxLength={64} value={editor.name} disabled={disabled} onChange={event => setEditor({ ...editor, name: event.currentTarget.value })} />
            <button type='button' disabled={disabled} onClick={() => setEditor(undefined)}>{t('cancel')}</button>
            <button type='button' disabled={disabled || !editor.name.trim()} onClick={() => void run(() => props.onRename(editor.id, editor.name), () => setEditor(undefined))}>{t('rename')}</button>
        </div>}
        {deleting && <div ref={dialogRef} className='nmx-canvas-tabs-dialog' role='dialog' aria-modal='true' aria-label={a('deleteTitle', { name: deleting.title })} onKeyDown={event => {
            event.stopPropagation(); if (event.key === 'Escape' && !event.nativeEvent.isComposing && !busy) setDeleting(undefined);
        }}>
            <strong>{a('deleteTitle', { name: deleting.title })}</strong><p>{a('deleteBody')}</p>
            <button type='button' autoFocus disabled={disabled} onClick={() => setDeleting(undefined)}>{t('cancel')}</button>
            <button type='button' disabled={disabled} onClick={() => void run(() => props.onDelete(deleting.id), () => setDeleting(undefined))}>{t('delete')}</button>
        </div>}
        {transfer && <CanvasModalLayer locale={props.locale}><div className='nmx-board-modal-backdrop'
            onMouseDown={event => { if (event.target === event.currentTarget && !disabled) setTransfer(undefined); }}
            onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape' && !event.nativeEvent.isComposing && event.keyCode !== 229 && !disabled) setTransfer(undefined); }}>
            <div className='nmx-canvas-transfer' role='dialog' aria-modal='true' aria-label={x('title')}>
                <strong>{x('title')}</strong><p>{x('detail')}</p>
                <fieldset disabled={disabled}><legend>{x('media')}</legend><div className='nmx-canvas-transfer-media'>
                    {props.media.map(node => <label key={node.id}><input type='checkbox' checked={transfer.nodeIds.includes(node.id)}
                        onChange={event => reviseTransfer({ nodeIds: event.currentTarget.checked ? [...transfer.nodeIds, node.id] : transfer.nodeIds.filter(id => id !== node.id) })} /><span>{node.title}</span></label>)}
                </div></fieldset>
                <label className='nmx-canvas-transfer-target'><span>{x('target')}</span><select autoFocus aria-label={x('target')} disabled={disabled} value={transfer.targetId}
                    onChange={event => reviseTransfer({ targetId: event.currentTarget.value })}>
                    {destinations.map(tab => <option key={tab.id} value={tab.id}>{tab.title}</option>)}
                </select></label>
                <div className='nmx-canvas-transfer-mode'>{(['copy', 'move'] as const).map(mode => <label key={mode}><input type='radio' name='canvas-transfer-mode' value={mode}
                    checked={transfer.mode === mode} disabled={disabled} onChange={() => reviseTransfer({ mode })} /><span>{x(mode)}</span></label>)}</div>
                {error && <p className='nmx-canvas-tabs-error' role='alert'>{error}</p>}
                <footer><button type='button' disabled={disabled} onClick={() => setTransfer(undefined)}>{t('cancel')}</button>
                    <button type='button' disabled={disabled || !transfer.nodeIds.length || !destinations.some(tab => tab.id === transfer.targetId) || transfer.nodeIds.some(id => !props.media.some(node => node.id === id))}
                        onClick={() => void run(() => props.onTransfer!(transfer), () => setTransfer(undefined))}>{disabled ? t('saving') : x(transfer.mode)}</button></footer>
            </div>
        </div></CanvasModalLayer>}
        {error && !transfer && <div className='nmx-canvas-tabs-error' role='alert'>{error}</div>}
    </div>;
}
