import * as React from '@theia/core/shared/react';
import { validateCanvasDocument } from '@nextmux/comic-core/canvas';
import type { CanvasDocument, CanvasEdge } from '@nextmux/comic-core/canvas';
import { applyCanvasEdgeRepair, canvasEdgeBounds, CANVAS_EDGE_BASE_CHECKS, previewCanvasEdgeRepair, scanCanvasEdges } from './nextmux-comic-canvas-edge-audit';
import { canvasEdgeAuditText, canvasEdgeReasonKey, type CanvasEdgeAuditTextKey } from './nextmux-comic-canvas-edge-audit-text';

/** Repair is staged locally: an invalid intermediate graph must never bypass the project save boundary. */
export function CanvasEdgeAuditPanel(props: {
    readonly locale: string; readonly canvas: CanvasDocument;
    readonly onLocate: (edge: CanvasEdge) => void; readonly onApply: (canvas: CanvasDocument) => void; readonly onClose: () => void;
}): React.ReactElement {
    const p = (key: CanvasEdgeAuditTextKey, values?: Record<string, string | number>): string => canvasEdgeAuditText(props.locale, key, values);
    const panel = React.useRef<HTMLElement>(null);
    const [draft, setDraft] = React.useState<{ canvas: CanvasDocument; removed: readonly number[] }>({ canvas: props.canvas, removed: [] });
    const [selected, setSelected] = React.useState<ReadonlySet<number>>(new Set());
    const [notice, setNotice] = React.useState<CanvasEdgeAuditTextKey>();
    const [scan, setScan] = React.useState(0);
    const expected = React.useRef<CanvasDocument>();
    const applying = React.useRef(false);
    const active = draft.canvas === props.canvas;
    const removed = active ? draft.removed : [];
    const preview = React.useMemo(() => previewCanvasEdgeRepair(props.canvas, removed), [props.canvas, removed, scan]);
    const indices = props.canvas.edges.flatMap((_edge, index) => removed.includes(index) ? [] : [index]);
    const findings = React.useMemo(() => scanCanvasEdges(preview), [preview, scan]);
    const documentIssues = React.useMemo(() => removed.length ? validateCanvasDocument(preview) : [], [preview, removed.length]);
    const allSelected = findings.length > 0 && findings.every(item => selected.has(indices[item.index]));
    React.useEffect(() => {
        const previous = panel.current?.ownerDocument.activeElement;
        panel.current?.focus();
        return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
    }, []);
    React.useEffect(() => {
        if (draft.canvas === props.canvas) return;
        setNotice(expected.current === props.canvas ? 'applied' : 'changed');
        expected.current = undefined; applying.current = false;
        setDraft({ canvas: props.canvas, removed: [] }); setSelected(new Set());
    }, [props.canvas, draft.canvas]);
    const stageRemoval = (chosen: readonly number[]): void => {
        // Ignore stale row callbacks and entries that became valid after an earlier preview deletion.
        if (!active || applying.current) return;
        const current = new Set(findings.map(item => indices[item.index]));
        setDraft({ canvas: props.canvas, removed: [...new Set([...removed, ...chosen.filter(index => current.has(index))])] });
        setSelected(new Set()); setNotice(undefined);
    };
    const apply = (): void => {
        if (applying.current) return;
        const result = applyCanvasEdgeRepair(draft.canvas, props.canvas, removed, new Date().toISOString());
        if (!result.ok) { setNotice(result.reason === 'changed' ? 'changed' : 'failed'); return; }
        applying.current = true; expected.current = result.canvas;
        try { props.onApply(result.canvas); }
        catch { applying.current = false; expected.current = undefined; setNotice('failed'); }
    };
    const names = new Map(props.canvas.nodes.map(node => [node.id, node.title]));
    return <aside ref={panel} role='dialog' aria-label={p('title')} tabIndex={-1} className='nmx-board-side nmx-board-edge-audit'
        style={{ width: 'min(440px, calc(100% - 32px))', boxSizing: 'border-box' }}
        onKeyDown={event => {
            event.stopPropagation();
            if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); props.onClose(); }
        }}>
        <header><strong>{p('title')}</strong><button type='button' className='nmx-board-side-close' aria-label={p(removed.length ? 'cancel' : 'close')} onClick={props.onClose}>×</button></header>
        <div role='status' data-edge-summary>{p('summary', { nodes: props.canvas.nodes.length, edges: preview.edges.length, errors: findings.length })}</div>
        <p style={{ margin: 0, fontSize: 12 }}>{p('scope')}</p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type='button' className='nmx-secondary-button' onClick={() => { setScan(value => value + 1); setSelected(new Set()); setNotice(undefined); }}>{p('rescan')}</button>
            <button type='button' className='nmx-secondary-button' disabled={!findings.length} onClick={() => setSelected(allSelected ? new Set() : new Set(findings.map(item => indices[item.index])))}>{p(allSelected ? 'clearSelection' : 'selectAll')}</button>
            <button type='button' className='nmx-secondary-button' disabled={!active || !selected.size} onClick={() => stageRemoval([...selected])}>{p('removeSelected')}</button>
        </div>
        {notice && <p role='status' data-edge-notice style={{ margin: 0 }}>{p(notice)}</p>}
        {removed.length > 0 && <div data-edge-preview style={{ padding: 8, border: '1px solid var(--nmx-border)', borderRadius: 8 }}>
            <p style={{ margin: '0 0 8px' }}>{p('preview', { count: removed.length })}</p>
            <button type='button' className='nmx-link-button' onClick={() => { setDraft({ canvas: props.canvas, removed: [] }); setSelected(new Set()); setNotice(undefined); }}>{p('restore')}</button>
            {documentIssues.length > 0 && <p role='alert' data-edge-blocked>{p('blocked', { count: documentIssues.length })}</p>}
        </div>}
        {!findings.length && <p className='nmx-board-side-empty'>{p('none')}</p>}
        <ul className='nmx-board-side-list' style={{ flex: '1 1 auto' }}>
            {findings.map(finding => {
                const index = indices[finding.index], edge = finding.edge;
                const canLocate = Boolean(canvasEdgeBounds(props.canvas, edge));
                return <li key={index} data-edge-index={index} style={{ border: '1px solid var(--nmx-border)', borderRadius: 8, padding: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input type='checkbox' aria-label={p('selectEdge', { id: edge.id })} checked={active && selected.has(index)} onChange={event => {
                            const chosen = new Set(selected); if (event.currentTarget.checked) chosen.add(index); else chosen.delete(index); setSelected(chosen);
                        }} />
                        <button type='button' disabled={!canLocate} title={p(canLocate ? 'locate' : 'noLocation')} aria-label={`${p('locate')}: ${edge.id}`}
                            onClick={() => props.onLocate(edge)} style={{ minWidth: 0, flex: 1 }}>
                            <span data-nmx-literal>{names.get(edge.sourceNodeId) ?? `${p('missingNode')} (${edge.sourceNodeId})`} → {names.get(edge.targetNodeId) ?? `${p('missingNode')} (${edge.targetNodeId})`}</span>
                        </button>
                        <button type='button' aria-label={`${p('remove')}: ${edge.id}`} title={p('remove')} onClick={() => stageRemoval([index])} style={{ width: 28, flexShrink: 0 }}>×</button>
                    </div>
                    <ul style={{ margin: '4px 0', paddingInlineStart: 22, fontSize: 12 }}>
                        {[...new Set(finding.issues.map(issue => issue.code))].map(code => <li key={code}>{p(canvasEdgeReasonKey(code))}
                            {!CANVAS_EDGE_BASE_CHECKS.has(code) && <small style={{ display: 'block', opacity: .8 }}>{p('extra')}</small>}</li>)}
                    </ul>
                </li>;
            })}
        </ul>
        <footer style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type='button' className='nmx-secondary-button' onClick={props.onClose}>{p(removed.length ? 'cancel' : 'close')}</button>
            <button type='button' className='nmx-board-generate' disabled={!active || !removed.length || documentIssues.length > 0} onClick={apply}>{p('apply')}</button>
        </footer>
    </aside>;
}
