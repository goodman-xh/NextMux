import * as React from '@theia/core/shared/react';
import { CanvasModalLayer } from './nextmux-comic-canvas-modal';
import type { CanvasDocument } from '@nextmux/comic-core/canvas';
import { analyzeCanvasSequence } from '@nextmux/comic-core/canvas-sequence';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { canvasTimelineText } from './nextmux-comic-canvas-timeline-text';

export function ComicCanvasTimelineHistory(props: { readonly locale: NextMuxDesktopLocale;
    readonly entries: readonly { readonly id: string; readonly title: string; readonly source: string; readonly updatedAt: string }[];
    readonly onOpen: (id: string) => void; readonly onCancel: () => void }): React.ReactElement {
    const t = (key: Parameters<typeof canvasTimelineText>[1]): string => canvasTimelineText(props.locale, key);
    return <CanvasModalLayer locale={props.locale}><div className='nmx-board-modal-backdrop nmx-canvas-timeline-history'
        onMouseDown={event => { if (event.target === event.currentTarget) props.onCancel(); }}
        onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); props.onCancel(); } }}>
        <section className='nmx-board-modal' style={{ width: 680, maxWidth: '90vw', maxHeight: '85vh', overflow: 'auto', padding: 24 }} role='dialog' aria-modal='true' aria-label={t('chooseSaved')}>
            <header><h2>{t('chooseSaved')}</h2><button type='button' className='nmx-board-modal-close' autoFocus aria-label={t('cancel')} onClick={props.onCancel}>×</button></header>
            {props.entries.map(item => <article key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 0' }}>
                <div style={{ flex: 1, minWidth: 0 }}><strong>{item.title}</strong><p>{t('source')}: {item.source}</p><time>{new Intl.DateTimeFormat(props.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.updatedAt))}</time></div>
                <button type='button' className='nmx-secondary-button' onClick={() => props.onOpen(item.id)}>{t('open')}</button>
            </article>)}
        </section>
    </div></CanvasModalLayer>;
}

/** Each row is one deliberately chosen path, not an exponential enumeration of a branching graph. */
export function ComicCanvasTimelineChoice(props: { readonly canvas: CanvasDocument; readonly locale: NextMuxDesktopLocale;
    readonly legacy: boolean; readonly onChoose: (paths: readonly (readonly string[])[] | undefined, legacy: boolean) => void; readonly onCancel: () => void }): React.ReactElement {
    const [legacyChoice, setLegacyChoice] = React.useState(props.legacy);
    const [paths, setPaths] = React.useState<string[][]>([[]]);
    const graph = React.useMemo(() => analyzeCanvasSequence(props.canvas), [props.canvas]);
    const labels = new Map(props.canvas.nodes.map(node => [node.id, node.title || node.id]));
    const t = (key: Parameters<typeof canvasTimelineText>[1]): string => canvasTimelineText(props.locale, key);
    const selected = new Set(paths.flat());
    const change = (row: number, index: number, id: string): void => setPaths(current => current.map((path, position) => position !== row ? path : [...path.slice(0, index), ...(id ? [id] : [])]));
    const content = <div className='nmx-board-modal-backdrop nmx-canvas-timeline-choice' onMouseDown={event => { if (event.target === event.currentTarget) props.onCancel(); }}
        onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); props.onCancel(); } }}>
        <section className='nmx-board-modal' style={{ width: 680, maxWidth: '90vw', maxHeight: '85vh', overflow: 'auto', padding: 24 }} role='dialog' aria-modal='true' aria-label={t('choose')}>
            <header><h2>{t('choose')}</h2><button autoFocus type='button' className='nmx-board-modal-close' aria-label={t('cancel')} onClick={props.onCancel}>×</button></header>
            {legacyChoice ? <><p>{t('legacyHelp')}</p><div style={{ display: 'flex', gap: 12 }}>
                <button type='button' className='nmx-primary-button' onClick={() => props.onChoose(undefined, true)}>{t('legacy')}</button>
                <button type='button' className='nmx-secondary-button' onClick={() => setLegacyChoice(false)}>{t('fromCanvas')}</button>
            </div></> : <><p>{t('help')}</p>{paths.map((path, row) => <fieldset key={row} style={{ margin: '12px 0', padding: 12 }}><legend>{row + 1}</legend>
                {[...path, ''].map((id, index) => {
                    const options = index ? graph.successors[path[index - 1]] ?? [] : graph.nodeIds;
                    const available = options.filter(option => option === id || !selected.has(option));
                    if (index && !available.length && !id) return null;
                    return <label key={index} style={{ display: 'flex', gap: 10, margin: '8px 0', alignItems: 'center' }}><span>{t(index ? 'next' : 'start')}</span>
                        <select aria-label={`${row + 1} ${t(index ? 'next' : 'start')} ${index + 1}`} value={id} onChange={event => change(row, index, event.currentTarget.value)} style={{ flex: 1, minWidth: 0 }}>
                            <option value=''>{t(index ? 'stop' : 'empty')}</option>{available.map(option => <option key={option} value={option}>{labels.get(option)}</option>)}
                        </select></label>;
                })}
                {paths.length > 1 && <button type='button' className='nmx-secondary-button' onClick={() => setPaths(current => current.filter((_, index) => index !== row))}>{t('remove')}</button>}
            </fieldset>)}
                <button type='button' className='nmx-secondary-button' disabled={paths.some(path => !path.length) || selected.size >= graph.nodeIds.length} onClick={() => setPaths(current => [...current, []])}>{t('add')}</button>
                <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 20 }}><button type='button' className='nmx-secondary-button' onClick={props.onCancel}>{t('cancel')}</button>
                    <button type='button' className='nmx-primary-button' disabled={!paths.length || paths.some(path => !path.length)} onClick={() => props.onChoose(paths, false)}>{t('create')}</button></footer>
            </>}
        </section>
    </div>;
    return <CanvasModalLayer locale={props.locale}>{content}</CanvasModalLayer>;
}
