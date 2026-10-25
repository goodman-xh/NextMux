import * as React from '@theia/core/shared/react';
import URI from '@theia/core/lib/common/uri';
import type { CanvasDocument } from '@nextmux/comic-core/canvas';
import { resolveCanvasCapability } from '@nextmux/comic-core/canvas-capabilities';
import type { ComicAssetLibraryEntry } from '../common/nextmux-comic-asset-library';
import { CanvasModalLayer } from './nextmux-comic-canvas-modal';
import { canvasCurrentVersion, canvasVersionReady } from './nextmux-comic-canvas-logic';
import type { CanvasCapabilityState, CanvasModelChoice, CanvasModelFamily } from './nextmux-comic-canvas';
import { CanvasRouteSelector, useCanvasRouteSelection } from './nextmux-comic-canvas-route-selector';
import { canvasText } from './nextmux-comic-canvas-text';
import { comicStartFrameText as text } from './nextmux-comic-start-frame-text';
import type { ComicStartFrameSettings } from './nextmux-comic-start-frame-settings';
import './style/nextmux-comic-start-frame.css';

/** Library copies have absolute local paths; canvas media retains its project-root URL guard. */
export function comicStartFramePortraitMediaUrl(uri: string, fromLibrary: boolean, projectMediaUrl: (uri: string) => string): string {
    return fromLibrary ? URI.fromFilePath(uri).toString() : projectMediaUrl(uri);
}

export function ComicStartFramePanel(props: {
    readonly locale: string; readonly canvas: CanvasDocument; readonly initial?: ComicStartFrameSettings;
    readonly families: readonly CanvasModelFamily[]; readonly defaultRoute?: CanvasModelChoice;
    readonly preferredAspectRatio?: string;
    readonly capabilityOf: (choice: CanvasModelChoice) => CanvasCapabilityState;
    readonly library: () => Promise<readonly ComicAssetLibraryEntry[]>;
    readonly mediaUrl: (uri: string) => string;
    readonly canRegenerate?: boolean;
    readonly onClose: () => void; readonly onSave: (value: ComicStartFrameSettings, regenerate?: boolean) => void;
}): React.ReactElement {
    const t = (key: Parameters<typeof text>[1]): string => text(props.locale, key);
    const c = (key: Parameters<typeof canvasText>[1]): string => canvasText(props.locale, key);
    const initialRoute = props.initial ? props.families.flatMap(f => f.routes).find(r => r.key === props.initial?.imageRouteKey && r.modelId === props.initial.imageModelId) : props.defaultRoute;
    const [enabled, setEnabled] = React.useState(props.initial?.enabled ?? true);
    const [route, setRoute] = React.useState(initialRoute);
    const [parameters, setParameters] = React.useState<Readonly<Record<string, unknown>>>(props.initial?.imageParameters ?? {});
    const [selected, setSelected] = React.useState(new Set((props.initial?.characterVersionIds ?? []).map(id => `canvas:${id}`).concat((props.initial?.characterLibraryAssetIds ?? []).map(id => `library:${id}`))));
    const [library, setLibrary] = React.useState<readonly ComicAssetLibraryEntry[]>([]);
    const [loadingLibrary, setLoadingLibrary] = React.useState(true);
    const [error, setError] = React.useState(false);
    React.useEffect(() => { let active = true; void props.library().then(items => { if (active) { setLibrary(items); setLoadingLibrary(false); } }, () => { if (active) { setError(true); setLoadingLibrary(false); } }); return () => { active = false; }; }, []);
    const selection = useCanvasRouteSelection(props.families, route, choice => { setRoute(choice); setParameters({}); });
    const capability = route ? props.capabilityOf(route) : undefined;
    const resolved = capability?.capability ? resolveCanvasCapability(capability.capability, { mode: 'imageToImage', ...(typeof parameters.resolution === 'string' ? { resolution: parameters.resolution } : {}) }) : undefined;
    const variants = resolved?.mode?.outputVariants ?? [];
    const ratios = resolved?.variant?.aspectRatios ?? [];
    const ratio = typeof parameters.aspectRatio === 'string' ? parameters.aspectRatio
        : props.preferredAspectRatio && ratios.includes(props.preferredAspectRatio) ? props.preferredAspectRatio : resolved?.variant?.defaultAspectRatio ?? (ratios.length === 1 ? ratios[0] : '');
    const portraitCandidates = props.canvas.nodes.flatMap(node => {
        if (node.kind !== 'character' && node.origin?.role !== 'portrait' || !('versions' in node.payload)) return [];
        const current = canvasCurrentVersion(node);
        const versions = [current, ...node.payload.versions.filter(version => version.id !== current?.id && selected.has(`canvas:${version.id}`))];
        return versions.flatMap(version => version?.kind === 'image' && canvasVersionReady(version) ? [{ key: `canvas:${version.id}`, name: node.title, uri: version.uri, fromLibrary: false }] : []);
    }).concat(library.filter(entry => entry.assetType === 'image' && (entry.assetCategory === 'character' || entry.characterBundleId) && entry.mediaPath)
        .map(entry => ({ key: `library:${entry.assetId}`, name: entry.assetName, uri: entry.mediaPath!, fromLibrary: true })));
    const portraits = [...new Map(portraitCandidates.map(portrait => [portrait.key, portrait])).values()];
    const availableKeys = new Set(portraits.map(p => p.key));
    const unavailable = [...selected].some(key => !(loadingLibrary && key.startsWith('library:')) && !availableKeys.has(key));
    const toggle = (key: string): void => { const next = new Set(selected); if (!next.delete(key)) next.add(key); setSelected(next); };
    const blocked = enabled ? !route || selection.blocked || !resolved?.variant || ratios.length > 0 && !ratios.includes(ratio) || selected.size < 1 || selected.size > 3 || unavailable || loadingLibrary && [...selected].some(key => key.startsWith('library:')) : !props.initial;
    const save = (regenerate = false): void => {
        if (!enabled && props.initial) { props.onSave({ ...props.initial, enabled: false }); return; }
        if (!route) return;
        const effective = { ...parameters, ...(resolved?.variant ? { resolution: resolved.variant.resolution } : {}), ...(ratio ? { aspectRatio: ratio } : {}) };
        props.onSave({ enabled, imageRouteKey: route.key, imageModelId: route.modelId, imageParameters: effective,
            characterVersionIds: [...selected].filter(key => key.startsWith('canvas:')).map(key => key.slice(7)),
            characterLibraryAssetIds: [...selected].filter(key => key.startsWith('library:')).map(key => key.slice(8)) }, regenerate);
    };
    return <CanvasModalLayer locale={props.locale} initialFocusSelector='.nmx-start-frame-panel select'>
        <div className='nmx-board-modal-backdrop' onMouseDown={event => { if (event.target === event.currentTarget) props.onClose(); }}
            onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) props.onClose(); }}>
            <section className='nmx-board-modal nmx-start-frame-panel' role='dialog' aria-modal='true' aria-label={t('title')}>
                <header>
                    <strong>{t('title')}</strong>
                    <button type='button' className='nmx-board-modal-close' title={c('cancel')} aria-label={c('cancel')} onClick={props.onClose}>
                        <i className='codicon codicon-close' aria-hidden='true'/>
                    </button>
                </header>
                <div className='nmx-start-frame-body'>
                    <label className='nmx-start-frame-toggle-card' title={t('hint')}>
                        <div className='nmx-start-frame-switch-copy'>
                            <strong>{t('hint')}</strong>
                            <span title={t('reuse')}>{t('feeNotice')}</span>
                        </div>
                        <input type='checkbox' checked={enabled} onChange={event => setEnabled(event.currentTarget.checked)}/>
                    </label>
                    <fieldset className='nmx-start-frame-section' disabled={!enabled}>
                        <div className='nmx-start-frame-section-head'>
                            <legend>{t('imageRoute')}</legend>
                        </div>
                        <div className='nmx-start-frame-route-row'>
                            <CanvasRouteSelector locale={props.locale} selection={selection}/>
                        </div>
                        {(variants.length > 0 || ratios.length > 0) && <div className='nmx-start-frame-param-row'>
                            {variants.length > 0 && <label className='nmx-board-field nmx-start-frame-param-field' title={c('resolution')}>
                                <span className='nmx-start-frame-param-label'>{c('resolution')}</span>
                                <select aria-label={c('resolution')} value={String(parameters.resolution ?? resolved?.variant?.resolution ?? '')}
                                    onChange={event => setParameters({ ...parameters, resolution: event.currentTarget.value })}>
                                    {!resolved?.variant && <option value=''>{c('resolution')}</option>}
                                    {variants.map(v => <option key={v.id} value={v.resolution}>{v.resolution}</option>)}
                                </select>
                            </label>}
                            {ratios.length > 0 && <label className='nmx-board-field nmx-start-frame-param-field' title={c('aspect')}>
                                <span className='nmx-start-frame-param-label'>{c('aspect')}</span>
                                <select aria-label={c('aspect')} value={ratio}
                                    onChange={event => setParameters({ ...parameters, aspectRatio: event.currentTarget.value })}>
                                    {!ratio && <option value=''>{c('aspect')}</option>}
                                    {ratios.map(value => <option key={value} value={value}>{value}</option>)}
                                </select>
                            </label>}
                        </div>}
                    </fieldset>
                    <fieldset className='nmx-start-frame-section' disabled={!enabled}>
                        <div className='nmx-start-frame-section-head' title={t('limit')}>
                            <legend>{t('portraits')}</legend>
                            <span className='nmx-start-frame-limit'>{selected.size} / 3</span>
                        </div>
                        {portraits.length ? <div className='nmx-start-frame-portraits'>{portraits.map(p => {
                            const isChecked = selected.has(p.key);
                            return <label key={p.key} title={p.name} className={isChecked ? 'is-selected' : ''}>
                                <input type='checkbox' checked={isChecked} disabled={!isChecked && selected.size >= 3} onChange={() => toggle(p.key)}/>
                                <img src={comicStartFramePortraitMediaUrl(p.uri, p.fromLibrary, props.mediaUrl)} alt='' draggable={false}/>
                                <span>{p.name}</span>
                            </label>;
                        })}</div> : <p className='nmx-start-frame-empty'>{t('empty')}</p>}
                        {unavailable && <button type='button' className='nmx-link-button' title={c('removeReference')} onClick={() => setSelected(new Set([...selected].filter(key => availableKeys.has(key))))}>{c('removeReference')}</button>}
                    </fieldset>
                    {(error || unavailable || capability?.error || route && !resolved?.mode) && <p role='alert'>{t('failed')}</p>}
                </div>
                <footer>
                    <button type='button' className='nmx-secondary-button nmx-start-frame-cancel' title={c('cancel')} onClick={props.onClose}>{c('cancel')}</button>
                    <div className='nmx-start-frame-footer-actions'>
                        {props.canRegenerate && enabled && <button type='button' className='nmx-secondary-button' title={t('redo')} disabled={blocked} onClick={() => save(true)}>{t('redo')}</button>}
                        <button type='button' className='nmx-primary-button is-primary' title={t('save')} onClick={() => save()} disabled={blocked}>{t('save')}</button>
                    </div>
                </footer>
            </section>
        </div>
    </CanvasModalLayer>;
}
