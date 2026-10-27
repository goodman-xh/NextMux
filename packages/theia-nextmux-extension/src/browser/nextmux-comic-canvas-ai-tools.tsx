import * as React from '@theia/core/shared/react';
import type { CanvasAssetVersion, CanvasDocument, CanvasEdge, CanvasImageGenNode, CanvasNode, CanvasPoint } from '@nextmux/comic-core/canvas';
import {
    CANVAS_IMAGE_TOOLS, CanvasImageToolError, changeImageVariationTags, compileCanvasImageTool, prepareCanvasImageToolNodes,
    type CanvasImageToolId, type CanvasImageToolParameterSchema
} from '@nextmux/comic-core/canvas-image-tools';
import { IMAGE_PALETTE_PRESETS, type ImageToolLocale } from '@nextmux/comic-core/canvas-image-presets';
import { ImeInput, ImeTextarea } from './nextmux-ime-field';
import { focusDialogOnMount, canvasCurrentVersion } from './nextmux-comic-canvas-logic';
import { toolText, type ToolTextKey } from './nextmux-comic-canvas-tools-text';
import { MarkEditor, renderMarkedPicture, type CanvasMark } from './nextmux-comic-canvas-marks';
import { marksText } from './nextmux-comic-canvas-marks-text';
import type { CanvasCapabilityState, CanvasModelChoice, CanvasModelFamily } from './nextmux-comic-canvas';

/**
 * AI image tools (relight, angle, pose, imagine, style, palette, camera, outpaint, panorama, annotated edit, upscale,
 * depth illustration). The dialog compiles the tool into one or more image-generation drafts wired to the source; the
 * drafts are ordinary nodes, so the model choice, quote, confirmation and retries are the canvas's normal ones.
 */
export const AI_IMAGE_TOOL_GROUPS: readonly { readonly section: ToolTextKey; readonly tools: readonly CanvasImageToolId[] }[] = [
    { section: 'section.aiEdit', tools: ['image.annotatedEdit', 'image.upscale', 'image.relight', 'image.angle', 'image.pose', 'image.outpaint', 'image.panorama'] },
    { section: 'section.aiLook', tools: ['image.styleTransfer', 'image.palette', 'image.camera', 'image.depthIllustration'] },
    { section: 'section.aiIdeas', tools: ['image.imagine', 'image.angleVariants', 'image.gridStoryboard'] }
];

export interface AiToolDialogProps {
    readonly locale: string;
    readonly tool: CanvasImageToolId;
    readonly canvas: CanvasDocument;
    readonly source: CanvasNode;
    readonly version: CanvasAssetVersion;
    readonly families: readonly CanvasModelFamily[];
    readonly initialRoute?: CanvasModelChoice;
    readonly capabilityOf: (choice: CanvasModelChoice) => CanvasCapabilityState;
    readonly mediaUrl: (uri: string) => string;
    readonly defaults: { readonly aspectRatio?: string };
    readonly position: CanvasPoint;
    /** Marked drafts start from a new canvas (with the saved marked picture) and sit after that picture. */
    readonly onCreate: (nodes: readonly CanvasImageGenNode[], edges: readonly CanvasEdge[], route: CanvasModelChoice, run: boolean, base?: SavedMarks) => void;
    /** 标记修图: store the marked picture as an image node beside the source. */
    readonly onSaveMarks?: (picture: Blob) => Promise<SavedMarks>;
    readonly onClose: () => void;
}
export interface SavedMarks { readonly canvas: CanvasDocument; readonly node: CanvasNode; readonly version: CanvasAssetVersion }

function imageLocale(locale: string): ImageToolLocale {
    const known = ['zh-CN', 'en', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
    return (known.includes(locale) ? locale : locale.startsWith('zh') ? 'zh-CN' : 'en') as ImageToolLocale;
}

function batchId(): string { return window.crypto.randomUUID().replace(/[^a-zA-Z0-9]/g, '').slice(0, 24); }

export function AiToolDialog(props: AiToolDialogProps): React.ReactElement {
    const x = (key: ToolTextKey, values?: Record<string, string | number>): string => toolText(props.locale, key, values);
    const locale = imageLocale(props.locale);
    const definition = CANVAS_IMAGE_TOOLS[props.tool];
    const [params, setParams] = React.useState<Record<string, unknown>>(() => structuredClone(definition.defaults) as unknown as Record<string, unknown>);
    const [palettePresetId, setPalettePresetId] = React.useState('');
    const [pendingTags, setPendingTags] = React.useState<readonly string[]>();
    const [poseGuideId, setPoseGuideId] = React.useState('');
    const usable = props.families.filter(family => family.available);
    const [routeKey, setRouteKey] = React.useState(() => {
        const initial = props.initialRoute && usable.some(family => family.routes.some(route => route.key === props.initialRoute!.key && route.available)) ? props.initialRoute : undefined;
        return initial?.key ?? usable[0]?.routes.find(route => route.available)?.key ?? '';
    });
    const route = usable.flatMap(family => family.routes).find(item => item.key === routeKey);
    const state = route ? props.capabilityOf(route) : undefined;
    const pictures = props.canvas.nodes.filter(node => node.id !== props.source.id && canvasCurrentVersion(node)?.kind === 'image');
    const poseGuide = pictures.find(node => node.id === poseGuideId);
    const field = (schema: CanvasImageToolParameterSchema): string => schema.labels[locale];
    const annotating = props.tool === 'image.annotatedEdit';
    const [marks, setMarks] = React.useState<readonly CanvasMark[]>([]);
    const [saving, setSaving] = React.useState(false);
    const [saveError, setSaveError] = React.useState('');
    const picture = React.useRef<HTMLImageElement | null>(null);
    const latest = React.useRef(props);
    latest.current = props;
    const references = (marked?: SavedMarks) => annotating
        // The clean source is edited and the marked copy only locates the edits. Until the marked copy exists, the source stands in
        // for it so the route (it must take two pictures) and the parameters are still checked.
        ? { source: { nodeId: props.source.id, version: props.version }, marks: marked ? { nodeId: marked.node.id, version: marked.version } : { version: props.version } }
        : { source: { nodeId: props.source.id, version: props.version }, ...(poseGuide && canvasCurrentVersion(poseGuide) ? { poseGuide: { nodeId: poseGuide.id, version: canvasCurrentVersion(poseGuide)! } } : {}) };
    // Upscale derives its aspect from the source pixels, which may differ from the project's default frame.
    // Share this input between preview and creation so both select the same highest compatible output.
    const outputParameters = props.tool !== 'image.upscale' && props.defaults.aspectRatio ? { aspectRatio: props.defaults.aspectRatio } : {};

    // Compile and plan on every change: what the footer offers is exactly what can be created.
    let plan: ReturnType<typeof prepareCanvasImageToolNodes> | undefined;
    let compiledPrompt = '';
    let problem = '';
    try {
        const compiled = compileCanvasImageTool(props.tool, params as never, locale);
        compiledPrompt = (compiled.variants ?? [compiled]).map(item => item.prompt).join('\n\n———\n\n');
        if (!route) problem = x('aiNoModel');
        else if (state?.loading) problem = x('aiChecking');
        else if (!state?.capability) problem = state?.error ?? x('aiNoModel');
        else plan = prepareCanvasImageToolNodes(compiled, { batchId: 'preview', capability: state.capability, locale, position: props.position,
            parameters: outputParameters, references: references() });
    } catch (error) {
        const known = error instanceof CanvasImageToolError ? error : undefined;
        problem = known?.code === 'IMAGE_TOOL_ROUTE_UNAVAILABLE' ? x('aiRouteUnavailable', { detail: known.message })
            : known?.code === 'IMAGE_TOOL_REFERENCE_REQUIRED' ? x('aiNeedsPicture')
            : known ? x('aiParamInvalid', { field: definition.parameters.find(item => known.path.startsWith(item.key))?.labels[locale] ?? known.path })
            : String(error);
    }

    // Marked edits need marks and a written change before anything else; say that rather than a generic parameter error.
    if (annotating && !marks.length) problem = marksText(props.locale, 'empty');
    else if (annotating && !String(params.instruction ?? '').trim()) problem = marksText(props.locale, 'needInstruction');
    const ready = Boolean(plan) && !problem && !saving;

    const create = async (run: boolean): Promise<void> => {
        if (!ready || !route || !state?.capability) return;
        const capability = state.capability;
        // The final plan gets its own batch id (stable for this click), so ids never collide with an earlier run of the tool.
        const compiled = compileCanvasImageTool(props.tool, params as never, locale);
        const draft = (marked?: SavedMarks) => prepareCanvasImageToolNodes(compiled, { batchId: batchId(), capability, locale, position: props.position,
            parameters: outputParameters, references: references(marked) });
        if (!annotating) { const final = draft(); props.onCreate(final.nodes, final.edges, route, run); return; }
        if (!picture.current || !props.onSaveMarks) return;
        setSaving(true); setSaveError('');
        try {
            const saved = await props.onSaveMarks(await renderMarkedPicture(picture.current, marks));
            const final = draft(saved);
            latest.current.onCreate(final.nodes, final.edges, route, run, saved);
        } catch (error) {
            setSaveError(marksText(props.locale, 'failed', { error: error instanceof Error ? error.message : String(error) }));
            setSaving(false);
        }
    };

    const set = (key: string, value: unknown): void => {
        if (key === 'colors') setPalettePresetId('');
        setParams({ ...params, [key]: value });
    };
    const visible = (schema: CanvasImageToolParameterSchema): boolean => !schema.visibleWhen || params[schema.visibleWhen.key] === schema.visibleWhen.equals;
    const render = (schema: CanvasImageToolParameterSchema): React.ReactNode => {
        const value = params[schema.key];
        const label = <span className='nmx-board-ai-label'>{field(schema)}</span>;
        switch (schema.type) {
            case 'number': return <label key={schema.key} className='nmx-board-ai-field is-number' title={schema.hints[locale]}>{label}
                <input type='range' aria-label={field(schema)} min={schema.min} max={schema.max} step={schema.step ?? 1} value={Number(value)} onChange={event => set(schema.key, Number(event.currentTarget.value))} />
                <ImeInput type='number' aria-label={field(schema)} min={schema.min} max={schema.max} step={schema.step ?? 1} value={String(value)} onChange={event => { const next = Number(event.currentTarget.value); if (Number.isFinite(next)) set(schema.key, next); }} />
            </label>;
            case 'boolean': return <label key={schema.key} className='nmx-board-ai-field is-toggle' title={schema.hints[locale]}>
                <input type='checkbox' checked={value === true} onChange={event => set(schema.key, event.currentTarget.checked)} />{label}</label>;
            case 'select': return <label key={schema.key} className='nmx-board-ai-field' title={schema.hints[locale]}>{label}
                <select value={String(value)} onChange={event => set(schema.key, event.currentTarget.value)}>
                    {(schema.options ?? []).map(option => <option key={option.value} value={option.value}>{option.labels[locale]}</option>)}
                </select></label>;
            case 'multiSelect': {
                const chosen = new Set((pendingTags ?? (Array.isArray(value) ? value : [])) as readonly string[]);
                return <div key={schema.key} className='nmx-board-ai-field is-chips' title={schema.hints[locale]}>{label}
                    <div className='nmx-board-ai-chips'>{(schema.options ?? []).map(option => <button type='button' key={option.value} className={chosen.has(option.value) ? 'is-on' : ''} aria-pressed={chosen.has(option.value)}
                        onClick={() => {
                            const next = chosen.has(option.value) ? [...chosen].filter(item => item !== option.value) : [...chosen, option.value];
                            if (schema.minItems && next.length < schema.minItems) return;
                            if (schema.maxItems && next.length > schema.maxItems) return;
                            // Tags write the default instruction; an authored one is only replaced after an explicit choice.
                            const result = changeImageVariationTags(params as never, next as never);
                            if (result.confirmationRequired) setPendingTags(next); else { setPendingTags(undefined); setParams(result.parameters as never); }
                        }}>{option.labels[locale]}</button>)}</div>
                    {pendingTags && <div className='nmx-board-ai-confirm'><span>{x('aiOverwriteInstruction')}</span>
                        <button type='button' className='nmx-link-button' onClick={() => { setParams(changeImageVariationTags(params as never, pendingTags as never, true).parameters as never); setPendingTags(undefined); }}>{x('aiOverwrite')}</button>
                        <button type='button' className='nmx-link-button' onClick={() => { setParams({ ...params, [schema.key]: pendingTags }); setPendingTags(undefined); }}>{x('aiKeepInstruction')}</button></div>}
                </div>;
            }
            case 'palette': {
                const colors = (Array.isArray(value) ? value : []) as readonly { readonly hex: string; readonly weight: number }[];
                return <div key={schema.key} className='nmx-board-ai-field is-palette' title={schema.hints[locale]}>{label}
                    <label className='nmx-board-ai-field'>
                        <span className='nmx-board-ai-label'>{x('aiPalettePreset')}</span>
                        <select aria-label={x('aiPalettePreset')} value={palettePresetId} onChange={event => {
                            const preset = IMAGE_PALETTE_PRESETS.find(item => item.id === event.currentTarget.value);
                            setPalettePresetId(preset?.id ?? '');
                            if (preset) setParams({ ...params, [schema.key]: preset.colors.map(color => ({ hex: color.hex, weight: Number((color.weight * 100).toFixed(4)) })) });
                        }}>
                            <option value=''>{x('aiPaletteCustom')}</option>
                            {IMAGE_PALETTE_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.names[locale]}</option>)}
                        </select>
                    </label>
                    <div className='nmx-board-ai-palette'>
                        {colors.map((color, index) => <span key={index} className='nmx-board-ai-swatch'>
                            <input type='color' value={color.hex} aria-label={color.hex} onChange={event => set(schema.key, colors.map((item, at) => at === index ? { ...item, hex: event.currentTarget.value.toUpperCase() } : item))} />
                            <ImeInput type='number' min={1} max={100} value={String(color.weight)} aria-label={x('aiWeight')} onChange={event => { const weight = Number(event.currentTarget.value); if (Number.isFinite(weight) && weight > 0) set(schema.key, colors.map((item, at) => at === index ? { ...item, weight } : item)); }} />
                            <button type='button' disabled={colors.length <= (schema.minItems ?? 1)} aria-label={x('aiRemoveColor')} title={x('aiRemoveColor')} onClick={() => set(schema.key, colors.filter((_, at) => at !== index))}><i className='codicon codicon-close' aria-hidden='true'></i></button>
                        </span>)}
                        {colors.length < (schema.maxItems ?? 8) && <button type='button' className='nmx-secondary-button' onClick={() => set(schema.key, [...colors, { hex: '#808080', weight: 10 }])}>
                            <i className='codicon codicon-add' aria-hidden='true'></i>{x('aiAddColor')}</button>}
                    </div></div>;
            }
            default: return schema.multiline
                ? <label key={schema.key} className='nmx-board-ai-field is-text'>
                    {annotating ? <span className='nmx-board-ai-label'>{marksText(props.locale, 'instruction')}</span> : label}
                    <ImeTextarea aria-label={annotating ? marksText(props.locale, 'instruction') : field(schema)} rows={annotating ? 6 : 3} maxLength={schema.maxLength} value={String(value ?? '')}
                        placeholder={annotating ? marksText(props.locale, 'instructionHint') : schema.hints[locale]} onChange={event => set(schema.key, event.currentTarget.value)} /></label>
                : <label key={schema.key} className='nmx-board-ai-field is-text' title={schema.hints[locale]}>{label}
                    <ImeInput aria-label={field(schema)} maxLength={schema.maxLength} value={String(value ?? '')} placeholder={schema.hints[locale]} onChange={event => set(schema.key, event.currentTarget.value)} /></label>;
        }
    };

    return <div className='nmx-board-modal-backdrop' onMouseDown={event => { if (event.target === event.currentTarget) props.onClose(); }}
        onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') props.onClose(); }}>
        <section ref={focusDialogOnMount} tabIndex={-1} className={`nmx-board-modal nmx-board-ai${annotating ? ' is-marks' : ''}`} role='dialog' aria-modal='true' aria-label={definition.labels[locale]}>
            <header>
                <strong>{definition.labels[locale]}</strong><span>{definition.hints[locale]}</span>
                <button type='button' className='nmx-board-modal-close' aria-label={x('close')} onClick={props.onClose}><i className='codicon codicon-close' aria-hidden='true'></i></button>
            </header>
            <div className='nmx-board-ai-body'>
                <div className='nmx-board-ai-source'>
                    {annotating
                        ? <MarkEditor locale={props.locale} src={props.mediaUrl(props.version.uri)} marks={marks} onChange={setMarks} imageRef={picture} disabled={saving} />
                        : <img src={props.mediaUrl(props.version.uri)} alt='' />}
                    {props.tool === 'image.pose' && params.usePoseGuide === true && <label className='nmx-board-ai-field'>
                        <span className='nmx-board-ai-label'>{x('aiPoseGuide')}</span>
                        <select value={poseGuideId} onChange={event => setPoseGuideId(event.currentTarget.value)}>
                            <option value=''>{x('aiChooseImage')}</option>
                            {pictures.map(node => <option key={node.id} value={node.id}>{node.title}</option>)}
                        </select>
                        {poseGuide && <img src={props.mediaUrl(canvasCurrentVersion(poseGuide)!.uri)} alt='' />}
                    </label>}
                </div>
                <div className='nmx-board-ai-form'>
                    <label className='nmx-board-ai-field'>
                        <span className='nmx-board-ai-label'>{x('aiModel')}</span>
                        <select value={routeKey} onChange={event => setRouteKey(event.currentTarget.value)}>
                            {!usable.length && <option value=''>{x('aiNoModel')}</option>}
                            {usable.map(family => family.routes.filter(item => item.available).map(item =>
                                <option key={item.key} value={item.key}>{family.routes.filter(other => other.available).length > 1 ? `${family.name} · ${item.source}` : family.name}</option>))}
                        </select>
                    </label>
                    {definition.parameters.filter(visible).map(render)}
                    <details className='nmx-board-ai-preview'>
                        <summary>{x('aiPromptPreview')}{plan && plan.nodes.length > 1 ? ` · ${x('aiNodesCount', { n: plan.nodes.length })}` : ''}</summary>
                        <pre data-nmx-literal>{compiledPrompt}</pre>
                    </details>
                </div>
            </div>
            <footer>
                <span className='nmx-board-batch-note' role={saveError ? 'alert' : undefined}>{saveError || (saving ? marksText(props.locale, 'saving') : problem || x('aiCreateNote'))}</span>
                <button type='button' className='nmx-secondary-button' disabled={!ready} onClick={() => void create(false)}>{x('aiCreateOnly')}</button>
                <button type='button' className='nmx-board-generate' disabled={!ready} onClick={() => void create(true)}>
                    <i className='codicon codicon-sparkle' aria-hidden='true'></i>{plan && plan.nodes.length > 1 ? x('aiCreateRunMany', { n: plan.nodes.length }) : x('aiCreateRun')}</button>
            </footer>
        </section>
    </div>;
}
