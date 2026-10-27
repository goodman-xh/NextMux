import * as React from '@theia/core/shared/react';
import { assertCanvasContinuityInputs, type CanvasShotContinuity } from '@nextmux/comic-core/canvas-continuity';
import { resolveCanvasInputs, type CanvasAssetVersion, type CanvasDocument, type CanvasNode } from '@nextmux/comic-core/canvas';
import { continuityText } from './nextmux-comic-continuity-text';

/** Retained for frame operations and references saved by older canvases. */
export interface CanvasContinuityFrame { readonly canvas: CanvasDocument; readonly node: CanvasNode; readonly version: CanvasAssetVersion }

export function CanvasContinuitySummary(props: { readonly locale: string; readonly canvas: CanvasDocument; readonly nodeId: string; readonly record: CanvasShotContinuity; readonly onRemove: () => void }): React.ReactElement {
    const source = props.canvas.nodes.find(node => node.id === props.record.sourceNodeId);
    const changed = source && 'versions' in source.payload && source.payload.currentVersionId !== props.record.sourceVersionId;
    const node = props.canvas.nodes.find(item => item.id === props.nodeId);
    let invalid = false;
    try {
        if (node?.kind !== 'videoGen') throw new Error('missing');
        const resolved = resolveCanvasInputs(props.canvas, node.id);
        assertCanvasContinuityInputs(props.record, resolved.inputs, node.payload.mode);
    } catch { invalid = true; }
    return <div className='nmx-board-continuity-summary'><span>{continuityText(props.locale, 'source')}: <code>{props.record.sourceVersionId}</code></span>
        {invalid && <p role='alert'>{continuityText(props.locale, 'invalid')}</p>}
        {changed && <p role='status'>{continuityText(props.locale, 'updated')}</p>}
        <button type='button' onClick={props.onRemove}>{continuityText(props.locale, 'unlink')}</button></div>;
}
