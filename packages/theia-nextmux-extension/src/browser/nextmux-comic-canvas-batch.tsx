import * as React from '@theia/core/shared/react';
import {
    CANVAS_BATCH_MAX_NODES, DEFAULT_BATCH_PROMPT_LAYOUT, DEFAULT_BATCH_PROMPT_NAMING, applyBatchPromptImport, compileBatchPromptImport, createBatchPromptImportState,
    moveBatchPromptImportEntry, orderBatchPromptImport, previewBatchPromptImport, renameBatchPromptImportEntry, updateBatchPromptImportSource,
    type BatchPromptImportOptions, type BatchPromptImportState, type BatchPromptLayout, type BatchPromptNaming, type BatchPromptSplitRule
} from '@nextmux/comic-core/canvas-batch-import';
import type { CanvasDocument, CanvasPoint } from '@nextmux/comic-core/canvas';
import { ImeInput, ImeTextarea } from './nextmux-ime-field';
import { focusDialogOnMount } from './nextmux-comic-canvas-logic';
import type { CanvasModelChoice } from './nextmux-comic-canvas';
import type { CanvasTextKey } from './nextmux-comic-canvas-text';
import { batchText, type BatchTextKey } from './nextmux-comic-canvas-batch-text';

/**
 * 批量导入提示词: paste many prompts, split them (blank lines, one per line, or a separator), add a shared head and
 * tail, name and number them, arrange them, preview exactly what each node will get, then add them all as one edit.
 * Adding nodes never generates or charges anything; each node runs when its 生成 is pressed.
 */
export interface BatchImportProps {
    readonly locale: string;
    readonly t: (key: CanvasTextKey, values?: Record<string, string | number>) => string;
    readonly canvas: CanvasDocument;
    readonly origin: CanvasPoint;
    readonly models: { readonly image: readonly CanvasModelChoice[]; readonly video: readonly CanvasModelChoice[] };
    readonly defaultRoute: (kind: 'image' | 'video') => CanvasModelChoice | undefined;
    readonly defaults: { readonly aspectRatio?: string; readonly durationSeconds?: number };
    readonly onAdd: (next: CanvasDocument, nodeIds: readonly string[], route: CanvasModelChoice | undefined) => void;
    readonly onClose: () => void;
}

type SplitKind = BatchPromptSplitRule['kind'];

export function BatchImportDialog(props: BatchImportProps): React.ReactElement {
    const { t } = props;
    const b = (key: BatchTextKey, values?: Record<string, string | number>): string => batchText(props.locale, key, values);
    const [kind, setKind] = React.useState<'image' | 'video'>('image');
    const choices = kind === 'image' ? props.models.image : props.models.video;
    const [routeKey, setRouteKey] = React.useState<string>(() => props.defaultRoute('image')?.key ?? props.models.image[0]?.key ?? '');
    const route = choices.find(choice => choice.key === routeKey) ?? props.defaultRoute(kind) ?? choices[0];
    const [splitKind, setSplitKind] = React.useState<SplitKind>('paragraphs');
    const [separator, setSeparator] = React.useState('---');
    const rule: BatchPromptSplitRule = splitKind === 'separator' ? { kind: 'separator', separator: separator || '---' } : { kind: splitKind };
    const [state, setState] = React.useState<BatchPromptImportState>(() => createBatchPromptImportState('', { kind: 'paragraphs' }));
    const [head, setHead] = React.useState('');
    const [tail, setTail] = React.useState('');
    const [naming, setNaming] = React.useState<BatchPromptNaming>({ ...DEFAULT_BATCH_PROMPT_NAMING });
    const [layout, setLayout] = React.useState<Omit<BatchPromptLayout, 'origin' | 'nodeSize'>>({
        direction: DEFAULT_BATCH_PROMPT_LAYOUT.direction, perRow: DEFAULT_BATCH_PROMPT_LAYOUT.perRow,
        horizontalSpacing: DEFAULT_BATCH_PROMPT_LAYOUT.horizontalSpacing, verticalSpacing: DEFAULT_BATCH_PROMPT_LAYOUT.verticalSpacing
    });
    const [error, setError] = React.useState<string>();

    const options: BatchPromptImportOptions = {
        kind, modelId: route?.modelId ?? '', headPrompt: head, tailPrompt: tail, naming,
        layout: { ...layout, origin: props.origin, nodeSize: { width: 280, height: 280 } },
        parameters: kind === 'video'
            ? { ...(props.defaults.aspectRatio ? { aspectRatio: props.defaults.aspectRatio } : {}), ...(props.defaults.durationSeconds ? { durationSeconds: props.defaults.durationSeconds } : {}) }
            : { ...(props.defaults.aspectRatio ? { aspectRatio: props.defaults.aspectRatio } : {}) }
    };
    let preview: ReturnType<typeof previewBatchPromptImport> | undefined;
    let previewError: string | undefined;
    try { preview = previewBatchPromptImport(state, options); } catch (problem) { previewError = problem instanceof Error ? problem.message : String(problem); }
    const errors = preview?.issues.filter(issue => issue.severity === 'error') ?? [];
    const count = preview?.entries.length ?? 0;

    const setSource = (text: string, nextRule = rule): void => setState(current => {
        try { return updateBatchPromptImportSource(current, text, nextRule); } catch { return current; }
    });
    const changeRule = (next: SplitKind, nextSeparator = separator): void => {
        setSplitKind(next);
        setSource(state.sourceText, next === 'separator' ? { kind: 'separator', separator: nextSeparator || '---' } : { kind: next });
    };
    const add = (): void => {
        try {
            const plan = compileBatchPromptImport(props.canvas, state, options);
            const next = applyBatchPromptImport(props.canvas, plan, { now: new Date().toISOString(), expectedRevision: props.canvas.revision });
            props.onAdd(next, plan.nodes.map(node => node.id), route);
        } catch (problem) {
            setError(problem instanceof Error ? problem.message : String(problem));
        }
    };
    const number = (value: string, min: number, max: number, fallback: number): number => {
        const parsed = Math.round(Number(value));
        return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
    };
    const issueText = (code: string): string => {
        const key = `issue.${code}` as BatchTextKey;
        const text = b(key);
        return text === key ? code : text;
    };

    return <div className='nmx-board-modal-backdrop' onMouseDown={event => { if (event.target === event.currentTarget) props.onClose(); }}
        onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') props.onClose(); }}>
        <section ref={focusDialogOnMount} tabIndex={-1} className='nmx-board-modal nmx-board-batch' role='dialog' aria-modal='true' aria-label={b('title')}>
            <header>
                <strong>{b('title')}</strong>
                <span>{b('lead', { max: CANVAS_BATCH_MAX_NODES })}</span>
                <button type='button' className='nmx-board-modal-close' aria-label={t('cancel')} onClick={props.onClose}><i className='codicon codicon-close' aria-hidden='true'></i></button>
            </header>
            <div className='nmx-board-batch-body'>
                <div className='nmx-board-batch-settings'>
                    <label className='nmx-board-batch-row'><span>{b('kind')}</span>
                        <div className='nmx-board-segmented' role='radiogroup'>
                            {(['image', 'video'] as const).map(value => <button type='button' key={value} role='radio' aria-checked={kind === value} className={kind === value ? 'is-active' : ''}
                                onClick={() => { setKind(value); setRouteKey(props.defaultRoute(value)?.key ?? (value === 'image' ? props.models.image : props.models.video)[0]?.key ?? ''); }}>
                                {t(value === 'image' ? 'kind.imageGen' : 'kind.videoGen')}</button>)}
                        </div>
                    </label>
                    <label className='nmx-board-batch-row'><span>{t('model')}</span>
                        <select value={route?.key ?? ''} onChange={event => setRouteKey(event.currentTarget.value)}>
                            {!route && <option value=''>{t('noModel')}</option>}
                            {choices.map(choice => <option key={choice.key} value={choice.key}>{choice.label} · {choice.source}</option>)}
                        </select>
                    </label>
                    <label className='nmx-board-batch-row'><span>{b('split')}</span>
                        <select value={splitKind} onChange={event => changeRule(event.currentTarget.value as SplitKind)}>
                            <option value='paragraphs'>{b('split.paragraphs')}</option>
                            <option value='lines'>{b('split.lines')}</option>
                            <option value='separator'>{b('split.separator')}</option>
                        </select>
                    </label>
                    {splitKind === 'separator' && <label className='nmx-board-batch-row'><span>{b('separator')}</span>
                        <ImeInput value={separator} onChange={event => { setSeparator(event.currentTarget.value); if (event.currentTarget.value) changeRule('separator', event.currentTarget.value); }} /></label>}
                    <label className='nmx-board-batch-row is-stack'><span>{b('head')}</span>
                        <ImeTextarea rows={2} value={head} placeholder={b('headHint')} onChange={event => setHead(event.currentTarget.value)} /></label>
                    <label className='nmx-board-batch-row is-stack'><span>{b('tail')}</span>
                        <ImeTextarea rows={2} value={tail} placeholder={b('tailHint')} onChange={event => setTail(event.currentTarget.value)} /></label>
                    <fieldset className='nmx-board-batch-group'>
                        <legend>{b('naming')}</legend>
                        <div className='nmx-board-batch-grid'>
                            <label><span>{b('prefix')}</span><ImeInput value={naming.prefix} onChange={event => setNaming({ ...naming, prefix: event.currentTarget.value })} /></label>
                            <label><span>{b('suffix')}</span><ImeInput value={naming.suffix} onChange={event => setNaming({ ...naming, suffix: event.currentTarget.value })} /></label>
                            <label className='is-wide'><span>{b('template')}</span><ImeInput value={naming.template} onChange={event => setNaming({ ...naming, template: event.currentTarget.value })} /></label>
                            <label><span>{b('start')}</span><ImeInput type='number' min={0} max={999999} value={naming.start} onChange={event => setNaming({ ...naming, start: number(event.currentTarget.value, 0, 999999, naming.start) })} /></label>
                            <label><span>{b('step')}</span><ImeInput type='number' min={1} max={9999} value={naming.step} onChange={event => setNaming({ ...naming, step: number(event.currentTarget.value, 1, 9999, naming.step) })} /></label>
                            <label><span>{b('padding')}</span><ImeInput type='number' min={0} max={8} value={naming.padding} onChange={event => setNaming({ ...naming, padding: number(event.currentTarget.value, 0, 8, naming.padding) })} /></label>
                        </div>
                        <small>{b('templateHint')}</small>
                    </fieldset>
                    <fieldset className='nmx-board-batch-group'>
                        <legend>{b('layout')}</legend>
                        <div className='nmx-board-batch-grid'>
                            <label className='is-wide'><span>{b('direction')}</span>
                                <select value={layout.direction} onChange={event => setLayout({ ...layout, direction: event.currentTarget.value as BatchPromptLayout['direction'] })}>
                                    <option value='rowFirst'>{b('rowFirst')}</option><option value='columnFirst'>{b('columnFirst')}</option>
                                </select></label>
                            <label><span>{b('perRow')}</span><ImeInput type='number' min={1} max={20} value={layout.perRow} onChange={event => setLayout({ ...layout, perRow: number(event.currentTarget.value, 1, 20, layout.perRow) })} /></label>
                            <label><span>{b('hSpacing')}</span><ImeInput type='number' min={0} max={2000} value={layout.horizontalSpacing} onChange={event => setLayout({ ...layout, horizontalSpacing: number(event.currentTarget.value, 0, 2000, layout.horizontalSpacing) })} /></label>
                            <label><span>{b('vSpacing')}</span><ImeInput type='number' min={0} max={2000} value={layout.verticalSpacing} onChange={event => setLayout({ ...layout, verticalSpacing: number(event.currentTarget.value, 0, 2000, layout.verticalSpacing) })} /></label>
                        </div>
                    </fieldset>
                </div>
                <div className='nmx-board-batch-source'>
                    <span className='nmx-board-batch-caption'>{b('source')}</span>
                    <ImeTextarea autoFocus value={state.sourceText} placeholder={b('sourceHint')} onChange={event => setSource(event.currentTarget.value)} />
                </div>
                <div className='nmx-board-batch-preview'>
                    <div className='nmx-board-batch-caption'>
                        <span>{b('preview', { n: count })}</span>
                        <button type='button' className='nmx-link-button' disabled={count < 2} onClick={() => setState(orderBatchPromptImport(state, 'reverse'))}>{b('reverse')}</button>
                        <button type='button' className='nmx-link-button' disabled={count < 2} onClick={() => setState(orderBatchPromptImport(state, 'restore'))}>{b('restore')}</button>
                    </div>
                    <ol>
                        {preview?.entries.map((entry, index) => <li key={entry.id}>
                            <div className='nmx-board-batch-entry-head'>
                                <ImeInput className='nmx-board-batch-name' value={entry.name} aria-label={t('rename')}
                                    onChange={event => setState(renameBatchPromptImportEntry(state, entry.id, event.currentTarget.value))} />
                                <button type='button' disabled={index === 0} title={b('up')} aria-label={b('up')} onClick={() => setState(moveBatchPromptImportEntry(state, entry.id, index - 1))}><i className='codicon codicon-arrow-up' aria-hidden='true'></i></button>
                                <button type='button' disabled={index === count - 1} title={b('down')} aria-label={b('down')} onClick={() => setState(moveBatchPromptImportEntry(state, entry.id, index + 1))}><i className='codicon codicon-arrow-down' aria-hidden='true'></i></button>
                            </div>
                            <p data-nmx-literal>{entry.prompt}</p>
                        </li>)}
                    </ol>
                    {!count && <div className='nmx-board-batch-empty'>{b('empty')}</div>}
                </div>
            </div>
            <footer>
                <span className='nmx-board-batch-note'>
                    {previewError || error || (errors[0] ? issueText(errors[0].code) : preview?.omittedCount ? b('omitted', { max: CANVAS_BATCH_MAX_NODES, n: preview.omittedCount }) : b('noCharge'))}
                </span>
                <button type='button' className='nmx-secondary-button' onClick={props.onClose}>{t('cancel')}</button>
                <button type='button' className='nmx-board-generate' disabled={!preview?.canImport || !count} onClick={add}>{b('add', { n: count })}</button>
            </footer>
        </section>
    </div>;
}
