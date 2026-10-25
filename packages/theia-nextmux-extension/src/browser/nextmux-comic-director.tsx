import * as React from '@theia/core/shared/react';
import '../../src/browser/style/nextmux-comic-director.css';
import { createPortal } from '@theia/core/shared/react-dom';
import {
    captureSceneKeyframe, commitSceneHistory, copySceneObjects, createSceneDocument, createSceneHistory, createSceneObject,
    deleteSceneObjects, groupSceneObjects, normalizeScene, normalizeWorld, redoSceneHistory, sampleScene, scenePlaybackFrame,
    setSceneKeyframe, undoSceneHistory, ungroupSceneObjects, SCENE_ASPECT_RATIOS, SCENE_CURVES, SCENE_PLAY_MODES,
    type SceneDocument, type SceneObject, type SceneVector, type WorldDocument
} from '@nextmux/comic-core/director-scene';
import { SCENE_BODY_TYPES, SCENE_CAMERAS, SCENE_POSES, SCENE_PROPS, SCENE_TEMPLATES, JOINT_RANGES, sceneFromTemplate, scenePosePosture, templateScene } from '@nextmux/comic-core/director-catalogue';
import type { ComicDirectorCameraSnapshot, ComicDirectorModelImportResult } from '../common/nextmux-director-contracts';
import { createDirectorRuntime, type DirectorRuntime } from './nextmux-comic-director-runtime';
import { directorCatalogueText } from './nextmux-comic-director-catalogue-text';
import { directorText } from './nextmux-comic-director-text';
import { normalizeDirectorScene } from './nextmux-comic-director-validation';
import { canvasText } from './nextmux-comic-canvas-text';
import { ImeInput, ImeTextarea } from './nextmux-ime-field';

export interface DirectorCapture {
    readonly captureId: string;
    readonly blob: Blob;
    readonly kind: 'image' | 'video';
    readonly scene: SceneDocument;
    readonly camera: ComicDirectorCameraSnapshot;
    readonly frame: number;
    readonly endFrame?: number;
}
export interface DirectorStageProps {
    readonly locale: string;
    readonly scene: SceneDocument;
    readonly world?: WorldDocument;
    /** Only images owned/referenced by this node, never an unrelated project-wide gallery. */
    readonly images: readonly { readonly id: string; readonly title: string; readonly uri: string }[];
    readonly resolveAssetUrl: (uri: string) => string;
    readonly onClose: () => void;
    readonly onSave: (scene: SceneDocument) => Promise<void> | void;
    readonly onSaveWorld?: (world: WorldDocument) => Promise<void> | void;
    readonly onCapture: (capture: DirectorCapture) => Promise<void>;
    readonly onImportModel: (file: File) => Promise<ComicDirectorModelImportResult>;
}
const id = (): string => crypto.randomUUID();
const zero = { x: 0, y: 0, z: 0 }, one = { x: 1, y: 1, z: 1 };
const COLORS = ['#e5e7eb', '#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899'];
const SKIES = ['#202838', '#000000', '#ffffff', '#94a3b8', '#0f172a', '#60a5fa', '#f59e0b', '#f472b6', '#86efac'];
const curveNames = { linear: 'linear', custom: 'custom', montage: 'montage', hero: 'hero', bullet: 'bullet', cut: 'jumpcut', easeIn: 'fastIn', easeOut: 'fastOut' };

function VectorFields(props: { readonly label: string; readonly value: SceneVector; readonly change: (value: SceneVector) => void }): React.ReactElement {
    return <fieldset className='nmx-director-vector'><legend>{props.label}</legend>{(['x', 'y', 'z'] as const).map(axis => <label key={axis}>{axis.toUpperCase()}
        <ImeInput type='number' step={0.1} value={props.value[axis]} aria-label={`${props.label} ${axis.toUpperCase()}`} onChange={event => {
            const value = Number(event.currentTarget.value); if (Number.isFinite(value)) props.change({ ...props.value, [axis]: value });
        }} /></label>)}</fieldset>;
}

/** Full-screen overlay structure; all presentation belongs to Claude's nmx-director-* stylesheet. */
export function DirectorStage(props: DirectorStageProps): React.ReactElement {
    const t = (key: string): string => directorText(props.locale, key);
    const ct = (key: Parameters<typeof canvasText>[1]): string => canvasText(props.locale, key);
    const name = (category: Parameters<typeof directorCatalogueText>[1], key: string): string => directorCatalogueText(props.locale, category, key);
    const [scene, setScene] = React.useState(() => normalizeScene(props.scene));
    const sceneRef = React.useRef(scene); sceneRef.current = scene;
    const [world, setWorld] = React.useState(() => props.world ? normalizeWorld(props.world) : undefined);
    const history = React.useRef(createSceneHistory(scene.objects));
    const [, historyTick] = React.useState(0);
    const [selected, setSelected] = React.useState<readonly string[]>([]);
    const [left, setLeft] = React.useState<'characters' | 'props' | 'cameras' | 'templates'>('characters');
    const [tab, setTab] = React.useState<'objects' | 'properties' | 'scene'>('objects');
    const [search, setSearch] = React.useState('');
    const [json, setJson] = React.useState<string>();
    const [pendingTemplate, setPendingTemplate] = React.useState<string>();
    const [error, setError] = React.useState<string>();
    const [busy, setBusy] = React.useState(false);
    const [ready, setReady] = React.useState(false);
    const [progress, setProgress] = React.useState(0);
    const [frame, setFrame] = React.useState(0);
    const [playing, setPlaying] = React.useState(false);
    const [editing, setEditing] = React.useState(false);
    const [cameraId, setCameraId] = React.useState<string>();
    const [mode, setMode] = React.useState<'translate' | 'rotate' | 'scale'>('translate');
    const [snap, setSnap] = React.useState(false), [snapSize, setSnapSize] = React.useState(0.5);
    const [helpers, setHelpers] = React.useState(true);
    const [height, setHeight] = React.useState(1080);
    const [flySpeed, setFlySpeed] = React.useState(3), [sensitivity, setSensitivity] = React.useState(1);
    const host = React.useRef<HTMLDivElement>(null), overlay = React.useRef<HTMLDivElement>(null);
    const runtime = React.useRef<DirectorRuntime>();
    const recorder = React.useRef<AbortController>();
    const disposed = React.useRef(false);
    const commit = (next: SceneDocument, record = true): void => {
        const valid = normalizeDirectorScene(next);
        if (record) { history.current = commitSceneHistory(history.current, valid.objects); historyTick(value => value + 1); }
        setPlaying(false); setScene(valid); setEditing(true);
        setSelected(ids => ids.filter(key => valid.objects.some(object => object.id === key)));
        if (cameraId && !valid.objects.some(object => object.id === cameraId && object.kind === 'camera')) setCameraId(undefined);
    };
    const commitRef = React.useRef(commit); commitRef.current = commit;
    const transformHandler = React.useRef<(key: string, transform: Pick<SceneObject, 'position' | 'rotation' | 'scale'>) => void>(() => undefined);
    transformHandler.current = (key, transform) => {
        const current = sceneRef.current, objects = editing ? current.objects : sampleScene(current, frame);
        commitRef.current({ ...current, objects: objects.map(object => object.id === key ? { ...object, ...transform, matrix: undefined } : object) });
    };
    const safe = async (work: () => Promise<void> | void): Promise<void> => {
        if (busy) return;
        setError(undefined); setBusy(true);
        try { await work(); } catch (failure) { if (!disposed.current && (failure as { name?: string })?.name !== 'AbortError') setError(t('error')); }
        finally { if (!disposed.current) { setBusy(false); setProgress(0); } }
    };
    React.useEffect(() => {
        disposed.current = false; let cancelled = false;
        overlay.current?.focus({ preventScroll: true });
        void createDirectorRuntime(host.current!, {
            resolveAssetUrl: props.resolveAssetUrl,
            onSelect: ids => { setSelected(ids); setTab('properties'); },
            onTransform: (key, transform) => transformHandler.current(key, transform),
            onError: code => { if (!cancelled) setError(`${t('error')} (${code})`); }
        }).then(value => {
            if (cancelled) { value.dispose(); return; }
            runtime.current = value;
            try { value.update(sceneRef.current); setReady(true); } catch { setError(t('error')); }
        }, () => { if (!cancelled) setError(t('error')); });
        return () => { cancelled = true; disposed.current = true; recorder.current?.abort(); runtime.current?.dispose(); runtime.current = undefined; };
    }, []);
    React.useEffect(() => {
        if (!runtime.current) return;
        try { runtime.current.update(scene, { sample: !editing }); if (!editing) runtime.current.renderFrame(frame); if (!ready) setReady(true); }
        catch { setReady(false); setError(t('error')); }
    }, [scene, ready, editing]);
    React.useEffect(() => { runtime.current?.select([...selected]); }, [selected, ready]);
    React.useEffect(() => { runtime.current?.setCamera(cameraId); }, [cameraId, ready]);
    React.useEffect(() => { runtime.current?.setTransformMode(mode); }, [mode, ready]);
    React.useEffect(() => { runtime.current?.setSnap(snap, snapSize); }, [snap, snapSize, ready]);
    React.useEffect(() => { runtime.current?.setHelpers(helpers); }, [helpers, ready]);
    React.useEffect(() => { runtime.current?.setNavigation({ flySpeed, rotateSensitivity: sensitivity }); }, [flySpeed, sensitivity, ready]);
    React.useEffect(() => {
        if (!ready || !world) return;
        runtime.current?.setFreeCamera(world.camera);
        void runtime.current?.setWorld(world.uri && world.kind !== 'empty' ? { kind: world.kind, uri: world.uri } : undefined).catch(() => setError(t('error')));
    }, [world?.kind, world?.uri, ready]);
    React.useEffect(() => { if (!editing) runtime.current?.renderFrame(frame); }, [frame, ready, editing]);
    React.useEffect(() => {
        if (!playing) return;
        const start = performance.now(), initial = frame; let handle = 0;
        const tick = (time: number): void => {
            const result = scenePlaybackFrame(initial + (time - start) * scene.fps / 1000, scene.duration, scene.playMode);
            setFrame(Math.floor(result.frame)); runtime.current?.renderFrame(result.frame);
            if (result.finished) { setPlaying(false); return; }
            handle = requestAnimationFrame(tick);
        };
        handle = requestAnimationFrame(tick); return () => cancelAnimationFrame(handle);
    }, [playing, scene.duration, scene.fps, scene.playMode]);
    const seek = (to: number): void => { setPlaying(false); setEditing(false); setFrame(Math.max(0, Math.min(scene.duration, Math.round(to)))); };
    const togglePlayback = (): void => { setEditing(false); if (!playing && frame >= scene.duration && scene.playMode === 'once') setFrame(0); setPlaying(value => !value); };
    const updateObject = (key: string, patch: Partial<SceneObject>): void => {
        const displayed = editing ? scene.objects : sampleScene(scene, frame);
        commit({ ...scene, objects: displayed.map(object => object.id === key ? { ...object, ...patch } : object) });
    };
    const displayedScene = { ...scene, objects: editing ? scene.objects : sampleScene(scene, frame) };
    const object = displayedScene.objects.find(item => item.id === selected[0]);
    const undo = (redo = false): void => {
        history.current = redo ? redoSceneHistory(history.current) : undoSceneHistory(history.current);
        const objects = history.current.present;
        commit({ ...scene, objects, keys: scene.keys.filter(key => objects.some(item => item.id === key.objectId)) }, false);
        historyTick(value => value + 1);
    };
    const keyframe = (): void => {
        let next = scene;
        for (const item of (editing ? scene.objects : sampleScene(scene, frame)).filter(item => selected.includes(item.id))) next = setSceneKeyframe(next, captureSceneKeyframe(item, frame, id()));
        setScene(next);
    };
    const copy = (): void => { const result = copySceneObjects(displayedScene, selected, id); commit(result.scene); setSelected(result.objectIds); };
    const remove = (): void => { commit(deleteSceneObjects(displayedScene, selected)); setSelected([]); };
    const group = (): void => { const key = id(); commit(groupSceneObjects(displayedScene, selected, key, ct('group'))); setSelected([key]); };
    const add = (kind: SceneObject['kind'], patch: Partial<SceneObject>): void => {
        const value = createSceneObject(kind, id(), patch); commit({ ...displayedScene, objects: [...displayedScene.objects, value] }); setSelected([value.id]); setTab('properties');
    };
    const applyTemplate = (templateId: string): void => {
        const template = SCENE_TEMPLATES.find(item => item.id === templateId)!;
        const next = templateScene(template.id, id);
        const objects = next.objects.map((item, index) => {
            const camera = item.kind === 'camera' ? template.cameras[index - template.characters.length] : undefined;
            return { ...item, label: item.kind === 'camera' ? camera?.id ? name('camera', camera.id) : `${t('cameras')} ${index - template.characters.length + 1}` : item.kind === 'prop' ? name('prop', item.assetId!) : `${t('characters')} ${index + 1}` };
        });
        commit({ ...scene, objects, keys: [] }); setSelected([]); seek(0); setPendingTemplate(undefined);
    };
    const close = (): void => { recorder.current?.abort(); setPlaying(false); props.onClose(); };
    const cameraSnapshot = (): ComicDirectorCameraSnapshot => {
        return { ...runtime.current!.readCamera(cameraId), ...(cameraId ? { id: cameraId } : {}) };
    };
    const capture = (video = false): void => { void safe(async () => {
        if (!runtime.current) throw new Error(t('error'));
        setPlaying(false); recorder.current = new AbortController();
        const ratio = scene.aspectRatio.split(':').map(Number), width = Math.round(height * ratio[0] / ratio[1] / 2) * 2;
        if (video) runtime.current.renderFrame(0);
        const camera = cameraSnapshot();
        let blob: Blob;
        try {
            blob = video ? await runtime.current.record({ width, height, fps: scene.fps, frames: scene.duration, cameraId, signal: recorder.current.signal, onProgress: value => setProgress(value / scene.duration) })
                : await runtime.current.capture({ width, height, cameraId, frame, sample: !editing });
        } finally {
            if (video && !disposed.current) { runtime.current.update(scene, { sample: !editing }); if (!editing) runtime.current.renderFrame(frame); }
            recorder.current = undefined;
        }
        const capturedScene = !video && editing ? { ...scene, keys: [] } : scene;
        await props.onCapture({ captureId: id(), blob, kind: video ? 'video' : 'image', scene: capturedScene, camera, frame: video ? 0 : frame, ...(video ? { endFrame: scene.duration } : {}) });
    }); };
    const importModel = (file: File): void => { void safe(async () => {
        const imported = await props.onImportModel(file);
        if (world) {
            const next = normalizeWorld({ ...world, kind: imported.kind, uri: imported.uri, format: file.name.split('.').pop()?.toLowerCase() });
            setWorld(next); await props.onSaveWorld?.(next);
        } else {
            if (imported.kind !== 'model') throw new Error(t('unsupported'));
            add('model', { label: file.name, modelUri: imported.uri });
        }
    }); };
    const imageOptions = <><option value=''>—</option>{props.images.map(image => <option key={image.id} value={image.uri}>{image.title}</option>)}</>;
    const number = (label: string, value: number, change: (value: number) => void, min?: number, max?: number, step = 0.1): React.ReactElement =>
        <label className='nmx-director-field'>{label}<ImeInput type='number' value={value} min={min} max={max} step={step} onChange={event => {
            const next = Number(event.currentTarget.value); if (Number.isFinite(next) && (min === undefined || next >= min) && (max === undefined || next <= max)) change(next);
        }} /></label>;
    const toggle = (label: string, value: boolean, change: (value: boolean) => void): React.ReactElement =>
        <label className='nmx-director-toggle'><input type='checkbox' checked={value} onChange={event => change(event.currentTarget.checked)} />{label}</label>;
    const filtered = (category: Parameters<typeof directorCatalogueText>[1], key: string): boolean => name(category, key).toLocaleLowerCase().includes(search.toLocaleLowerCase());
    // Portaled to the body: two layout-less layers carry the desktop's theme variables (as the model picker does).
    const themeClass = document.querySelector('.nmx-shell.nmx-theme-light') ? 'nmx-theme-light' : 'nmx-theme-dark';
    return createPortal(<div className='nmx-director-portal nmx-desktop-widget' lang={props.locale}><div className={`nmx-director-surface nmx-shell ${themeClass}`}><div ref={overlay} className='nmx-director-stage' role='dialog' aria-modal='true' aria-label={world ? t('world') : t('stage')} tabIndex={-1}
        onPointerDownCapture={event => {
            const target = event.target as Element | null;
            if (pendingTemplate && !busy && !target?.closest('.nmx-director-template-confirm')) setPendingTemplate(undefined);
            if (json !== undefined && !busy && !target?.closest('.nmx-director-json')) setJson(undefined);
        }}
        onKeyDown={event => {
            event.stopPropagation();
            if (event.nativeEvent.isComposing || (event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')) return;
            const key = event.key.toLowerCase(), mod = event.metaKey || event.ctrlKey;
            if (event.altKey) return;
            if (key === 'escape') { event.preventDefault(); if (pendingTemplate) setPendingTemplate(undefined); else if (json !== undefined) setJson(undefined); else close(); }
            else if (mod && key === 'z' && !busy) { event.preventDefault(); undo(event.shiftKey); }
            else if (mod && key === 'y' && !busy) { event.preventDefault(); undo(true); }
            else if (mod && (key === 'd' || key === 'c') && selected.length && !busy) { event.preventDefault(); copy(); }
            else if (mod && key === 'g' && selected.length > 1 && !busy) { event.preventDefault(); group(); }
            else if ((key === 'delete' || key === 'backspace') && !busy) { event.preventDefault(); remove(); }
            else if (key === ' ' && !busy) { event.preventDefault(); togglePlayback(); }
            else if (key === 'k' && !busy) { event.preventDefault(); keyframe(); }
            else if (['w', 'e', 'r'].includes(key)) { event.preventDefault(); setMode(key === 'w' ? 'translate' : key === 'e' ? 'rotate' : 'scale'); }
        }}>
        <header className='nmx-director-header'><strong>{world ? t('world') : t('stage')}</strong>
            <button type='button' disabled={busy || !history.current.past.length} onClick={() => undo()}>{ct('undo')}</button>
            <button type='button' disabled={busy || !history.current.future.length} onClick={() => undo(true)}>{ct('redo')}</button>
            <button type='button' disabled={busy} onClick={() => setJson(JSON.stringify(scene, null, 2))}>{t('json')}</button>
            <label className='nmx-director-import'>{t('importModel')}<input type='file' accept={world ? '.glb,.gltf,.spz,.ply' : '.glb,.gltf'} disabled={busy} onChange={event => {
                const file = event.currentTarget.files?.[0]; if (file) importModel(file); event.currentTarget.value = '';
            }} /></label>
            <button type='button' disabled={busy} onClick={() => void safe(async () => { const saved = normalizeDirectorScene(scene); await props.onSave(saved); if (world) await props.onSaveWorld?.({ ...world, scene: saved, aspectRatio: saved.aspectRatio, camera: runtime.current?.readFreeCamera() ?? world.camera }); })}>{t('save')}</button>
            <button type='button' className='is-primary' disabled={busy || !ready || !!world && world.kind === 'empty'} onClick={() => capture()}>{t('capture')}</button>
            <button type='button' className='is-primary' disabled={busy || !ready || !!world && world.kind === 'empty'} onClick={() => capture(true)}>{t('record')}</button>
            {busy && <button type='button' disabled={!recorder.current} onClick={() => recorder.current?.abort()}>{ct('cancel')}</button>}
            <button type='button' className='nmx-director-close' aria-label={ct('cancel')} onClick={close}>×</button>
        </header>
        {error && <div className='nmx-director-error' role='alert'>{error}</div>}
        {busy && <div className='nmx-director-progress' role='status'>{t('busy')}{progress > 0 ? ` ${Math.round(progress * 100)}%` : ''}</div>}
        <div className='nmx-director-workspace'>
            <aside className='nmx-director-catalogue'><nav>{(['characters', 'props', 'cameras', 'templates'] as const).map(key => <button type='button' key={key} aria-pressed={left === key} onClick={() => { setLeft(key); setSearch(''); }}>{t(key)}</button>)}</nav>
                <ImeInput value={search} aria-label={t('search')} placeholder={t('search')} onChange={event => setSearch(event.currentTarget.value)} />
                <fieldset disabled={busy} className='nmx-director-catalogue-items'>
                    {left === 'characters' && <>{SCENE_BODY_TYPES.filter(body => filtered('body', body.id)).map(body => <button type='button' key={body.id} onClick={() => add('character', { label: name('body', body.id), bodyType: body.id, posture: scenePosePosture('stand') })}>{name('body', body.id)}</button>)}
                        <button type='button' onClick={() => { const objects = Array.from({ length: 15 }, (_, index) => createSceneObject('character', id(), { label: `${t('characters')} ${index + 1}`, position: { x: (index % 5 - 2) * 0.8, y: 0, z: Math.floor(index / 5) * 0.9 }, color: COLORS[index % COLORS.length], posture: scenePosePosture('stand') })); commit({ ...displayedScene, objects: [...displayedScene.objects, ...objects] }); setSelected(objects.map(item => item.id)); }}>{t('crowd')}</button></>}
                    {left === 'props' && <>{SCENE_PROPS.filter(prop => filtered('prop', prop.id)).map(prop => <button type='button' key={prop.id} onClick={() => add('prop', { label: name('prop', prop.id), assetId: prop.id, color: prop.defaultColor, scale: prop.defaultScale })}>{name('prop', prop.id)}</button>)}
                        {(['point', 'spot', 'directional'] as const).map(lightType => <button type='button' key={lightType} onClick={() => add('light', { label: t(`${lightType}Light`), lightType, position: { x: 2, y: 3, z: 2 }, lookAt: zero })}>{t(`${lightType}Light`)}</button>)}</>}
                    {left === 'cameras' && SCENE_CAMERAS.filter(camera => filtered('camera', camera.id)).map(camera => <button type='button' key={camera.id} onClick={() => add('camera', { ...camera, id: id(), label: name('camera', camera.id) })}>{name('camera', camera.id)}</button>)}
                    {left === 'templates' && SCENE_TEMPLATES.filter(template => filtered('template', template.id)).map(template => <button type='button' key={template.id} onClick={() => setPendingTemplate(template.id)}>{name('template', template.id)}</button>)}
                </fieldset>
            </aside>
            <main className='nmx-director-view'><div className='nmx-director-tools' role='toolbar'>
                {(['translate', 'rotate', 'scale'] as const).map(key => <button type='button' key={key} disabled={busy} aria-pressed={mode === key} onClick={() => setMode(key)}>{t(key)}</button>)}
                <button type='button' disabled={!selected.length || busy} onClick={() => { setCameraId(undefined); runtime.current?.focus([...selected]); }}>{t('focus')}</button>
                <select aria-label={t('cameras')} disabled={busy} value={cameraId ?? ''} onChange={event => setCameraId(event.currentTarget.value || undefined)}><option value=''>{t('free')}</option>{scene.objects.filter(item => item.kind === 'camera').map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select>
                {toggle(t('snap'), snap, setSnap)}{number(t('snap'), snapSize, setSnapSize, 0.05, 100)}{toggle(t('helpers'), helpers, setHelpers)}
            </div><div ref={host} className='nmx-director-renderer' tabIndex={0} aria-label={t('stage')} />
                <p className='nmx-director-help'>{t('navigation')}</p>
                {world?.kind === 'empty' && <p>{t('noWorld')}</p>}
            </main>
            <aside className='nmx-director-inspector'><nav>{(['objects', 'properties', 'scene'] as const).map(key => <button type='button' key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{t(key)}</button>)}</nav>
                <fieldset disabled={busy} className='nmx-director-inspector-fields'>
                    {tab === 'objects' && <><ul className='nmx-director-objects'>{scene.objects.map(item => <li key={item.id} data-parent={item.parentId}>
                        <button type='button' aria-pressed={selected.includes(item.id)} onClick={event => setSelected(event.ctrlKey || event.metaKey ? selected.includes(item.id) ? selected.filter(key => key !== item.id) : [...selected, item.id] : [item.id])}>{item.label}</button>
                        {toggle(t('visible'), item.visible, visible => updateObject(item.id, { visible }))}{toggle(t('locked'), item.locked, locked => updateObject(item.id, { locked }))}
                    </li>)}</ul><button type='button' disabled={!selected.length} onClick={copy}>{ct('duplicate')}</button><button type='button' disabled={selected.length < 2} onClick={group}>{ct('group')}</button><button type='button' disabled={!selected.length} onClick={remove}>{ct('delete')}</button></>}
                    {tab === 'properties' && object && <>
                        <label>{ct('rename')}<ImeInput value={object.label} onChange={event => updateObject(object.id, { label: event.currentTarget.value })} /></label>
                        <VectorFields label={t('position')} value={object.position} change={position => updateObject(object.id, { position, matrix: undefined })} />
                        <VectorFields label={t('rotation')} value={object.rotation} change={rotation => updateObject(object.id, { rotation, matrix: undefined })} />
                        <VectorFields label={t('size')} value={object.scale} change={scale => updateObject(object.id, { scale, matrix: undefined })} />
                        <label>{t('color')}<input type='color' value={object.color ?? '#e5e7eb'} onChange={event => updateObject(object.id, { color: event.currentTarget.value })} /></label>
                        <div className='nmx-director-colors'>{COLORS.map(color => <button type='button' key={color} aria-label={`${t('color')} ${color}`} data-color={color} title={color} style={{ background: color }} onClick={() => updateObject(object.id, { color })}></button>)}</div>
                        <button type='button' onClick={() => updateObject(object.id, { position: zero, rotation: zero, scale: one, matrix: undefined })}>{t('reset')}</button>
                        {(object.parentId || object.kind === 'group') && <button type='button' onClick={() => commit(ungroupSceneObjects(displayedScene, [object.id]))}>{t(object.kind === 'group' ? 'ungroup' : 'detach')}</button>}
                        {object.kind === 'character' && <>
                            <label>{t('bodyType')}<select value={object.bodyType} onChange={event => updateObject(object.id, { bodyType: event.currentTarget.value })}>{SCENE_BODY_TYPES.map(body => <option key={body.id} value={body.id}>{name('body', body.id)}</option>)}</select></label>
                            <div className='nmx-director-poses'>{SCENE_POSES.map(pose => <button type='button' key={pose.id} aria-pressed={object.pose === pose.id} onClick={() => updateObject(object.id, { pose: pose.id, posture: scenePosePosture(pose.id), mirror: false })}>{name('pose', pose.id)}</button>)}</div>
                            {toggle(t('mirror'), object.mirror ?? false, mirror => updateObject(object.id, { mirror }))}
                            <button type='button' onClick={() => updateObject(object.id, { pose: 'stand', posture: scenePosePosture('stand'), mirror: false })}>{t('resetPose')}</button>
                            {Object.entries(JOINT_RANGES).map(([joint, axes]) => <fieldset key={joint} className='nmx-director-joint'><legend>{name('joint', joint)}</legend>{Object.entries(axes).map(([axis, range]) => <label key={axis}>{name('axis', axis)}
                                <input type='range' min={range[0]} max={range[1]} step={1} value={object.posture?.[joint]?.[axis] ?? 0} onChange={event => updateObject(object.id, { pose: 'custom', posture: { ...object.posture, [joint]: { ...object.posture?.[joint], [axis]: Number(event.currentTarget.value) } } })} /><output>{object.posture?.[joint]?.[axis] ?? 0}°</output></label>)}</fieldset>)}
                        </>}
                        {object.kind === 'prop' && object.assetId === 'image_board' && <label>{t('picture')}<select value={object.imageUri ?? ''} onChange={event => updateObject(object.id, { imageUri: event.currentTarget.value || undefined })}>{imageOptions}</select></label>}
                        {(object.kind === 'camera' || object.kind === 'light' && object.lightType !== 'point') && <VectorFields label={t('target')} value={object.lookAt ?? zero} change={lookAt => updateObject(object.id, { lookAt, matrix: undefined })} />}
                        {object.kind === 'camera' && <>{number(t('fov'), object.fov ?? 50, fov => updateObject(object.id, { fov }), 10, 120, 1)}<div>{[24, 35, 50, 60, 90].map(fov => <button type='button' key={fov} onClick={() => updateObject(object.id, { fov })}>{fov}°</button>)}</div>
                            <input type='range' aria-label={t('fov')} min={10} max={120} step={1} value={object.fov ?? 50} onChange={event => updateObject(object.id, { fov: Number(event.currentTarget.value) })} />
                            <button type='button' onClick={() => setCameraId(object.id)}>{t('enterCamera')}</button><button type='button' onClick={() => {
                                if (!runtime.current) return;
                                try { updateObject(object.id, { ...runtime.current.readFreeCameraForObject(object.id), rotation: zero, scale: one }); }
                                catch { updateObject(object.id, { ...runtime.current.readFreeCamera(), parentId: undefined, rotation: zero, scale: one, matrix: undefined }); }
                            }}>{t('storeCamera')}</button></>}
                        {object.kind === 'light' && <><select aria-label={t('props')} value={object.lightType} onChange={event => updateObject(object.id, { lightType: event.currentTarget.value as SceneObject['lightType'] })}>{(['point', 'spot', 'directional'] as const).map(key => <option key={key} value={key}>{t(`${key}Light`)}</option>)}</select>
                            {number(t('intensity'), object.intensity ?? 1, intensity => updateObject(object.id, { intensity }), 0, 100000)}
                            {object.lightType !== 'directional' && number(t('distance'), object.distance ?? 0, distance => updateObject(object.id, { distance }), 0, 100000)}
                            {object.lightType === 'spot' && number(t('angle'), object.angle ?? 45, angle => updateObject(object.id, { angle }), 0.1, 90)}
                            {toggle(t('shadow'), object.castShadow ?? true, castShadow => updateObject(object.id, { castShadow }))}</>}
                    </>}
                    {tab === 'scene' && <>
                        <label>{t('aspect')}<select value={scene.aspectRatio} onChange={event => setScene({ ...scene, aspectRatio: event.currentTarget.value as SceneDocument['aspectRatio'] })}>{SCENE_ASPECT_RATIOS.map(value => <option key={value}>{value}</option>)}</select></label>
                        <label>{t('exportSize')}<select value={height} onChange={event => setHeight(Number(event.currentTarget.value))}>{[720, 1080, 1440, 2160].map(value => <option key={value}>{value}</option>)}</select></label>
                        <label>{t('sky')}<input type='color' value={scene.skyColor} onChange={event => setScene({ ...scene, skyColor: event.currentTarget.value })} /></label><div className='nmx-director-colors'>{SKIES.map(skyColor => <button key={skyColor} type='button' aria-label={`${t('sky')} ${skyColor}`} data-color={skyColor} title={skyColor} style={{ background: skyColor }} onClick={() => setScene({ ...scene, skyColor })}></button>)}</div>
                        <label>{t('panorama')}<select value={scene.panoramaUri ?? ''} onChange={event => setScene({ ...scene, panoramaUri: event.currentTarget.value || undefined })}>{imageOptions}</select></label>
                        <button type='button' disabled={!scene.panoramaUri} onClick={() => setScene({ ...scene, panoramaUri: undefined })}>{t('removePanorama')}</button>
                        {number(t('groundHeight'), scene.groundHeight, groundHeight => setScene({ ...scene, groundHeight }), -10000, 10000)}{number(t('groundOpacity'), scene.groundOpacity, groundOpacity => setScene({ ...scene, groundOpacity }), 0, 1, 0.05)}
                        {toggle(ct('grid'), scene.showGrid, showGrid => setScene({ ...scene, showGrid }))}{toggle(t('labels'), scene.showLabels, showLabels => setScene({ ...scene, showLabels }))}
                        {number(t('labelSize'), scene.labelFontSize, labelFontSize => setScene({ ...scene, labelFontSize }), 8, 128, 1)}{toggle(t('marker'), scene.showBaseMarker, showBaseMarker => setScene({ ...scene, showBaseMarker }))}
                        {number(t('flySpeed'), flySpeed, setFlySpeed, 0.1, 100)}{number(t('sensitivity'), sensitivity, setSensitivity, 0.1, 5)}
                        {world && <label>{t('panorama')}<select value={world.kind === 'panorama' ? world.uri : ''} onChange={event => {
                            const next = normalizeWorld({ ...world, kind: event.currentTarget.value ? 'panorama' : 'empty', uri: event.currentTarget.value || undefined, format: undefined });
                            setWorld(next); void safe(() => props.onSaveWorld?.(next));
                        }}>{imageOptions}</select></label>}
                    </>}
                </fieldset>
            </aside>
        </div>
        <footer className='nmx-director-timeline'><fieldset disabled={busy}>
            <button type='button' aria-label={t('first')} onClick={() => seek(0)}>⏮</button><button type='button' aria-label={t('previous')} onClick={() => seek(frame - 1)}>‹</button>
            <button type='button' onClick={togglePlayback}>{t(playing ? 'pause' : 'play')}</button><button type='button' aria-label={t('next')} onClick={() => seek(frame + 1)}>›</button><button type='button' aria-label={t('last')} onClick={() => seek(scene.duration)}>⏭</button>
            <button type='button' disabled={!selected.length} onClick={keyframe}>{t('addKey')}</button><button type='button' disabled={!scene.keys.some(key => selected.includes(key.objectId) && key.frame === frame)} onClick={() => setScene({ ...scene, keys: scene.keys.filter(key => !selected.includes(key.objectId) || key.frame !== frame) })}>{t('deleteKey')}</button>
            {number(t('duration'), scene.duration, value => { const duration = Math.round(value); setScene({ ...scene, duration, keys: scene.keys.filter(key => key.frame <= duration) }); if (frame > duration) seek(duration); }, 1, 18000, 1)}
            <select aria-label={t('fps')} value={scene.fps} onChange={event => setScene({ ...scene, fps: Number(event.currentTarget.value) })}>{[12, 24, 25, 30, 60].map(value => <option key={value}>{value}</option>)}</select>
            <select aria-label={t('play')} value={scene.playMode} onChange={event => setScene({ ...scene, playMode: event.currentTarget.value as SceneDocument['playMode'] })}>{SCENE_PLAY_MODES.map(key => <option key={key} value={key}>{t(key)}</option>)}</select>
            <select aria-label={t('curve')} value={scene.curve} onChange={event => setScene({ ...scene, curve: event.currentTarget.value as SceneDocument['curve'] })}>{SCENE_CURVES.map(key => <option key={key} value={key}>{t(curveNames[key])}</option>)}</select>
            {scene.curve === 'custom' && number(t('exponent'), scene.customCurve, customCurve => setScene({ ...scene, customCurve }), 0.1, 5)}
            <input type='range' min={0} max={scene.duration} step={1} value={frame} aria-label={t('frame')} onChange={event => seek(Number(event.currentTarget.value))} /><output>{frame}/{scene.duration}</output>
            <div className='nmx-director-tracks'>{scene.objects.filter(item => scene.keys.some(key => key.objectId === item.id)).map(item => <div key={item.id}><button type='button' onClick={() => { setSelected([item.id]); setTab('properties'); }}>{item.label}</button><span className='nmx-director-track'>{scene.keys.filter(key => key.objectId === item.id).map(key => <button type='button' key={key.id} aria-label={`${item.label} ${t('frame')} ${key.frame}`} title={String(key.frame)} className={key.frame === frame ? 'is-current' : ''} style={{ insetInlineStart: `${key.frame / Math.max(1, scene.duration) * 100}%` }} onClick={() => seek(key.frame)} onContextMenu={event => { event.preventDefault(); setScene({ ...scene, keys: scene.keys.filter(value => value.id !== key.id) }); }}>◆</button>)}</span></div>)}</div>
        </fieldset></footer>
        {pendingTemplate && <section className='nmx-director-template-confirm' role='dialog' aria-modal='true' aria-label={t('applyTemplate')}>
            <strong>{name('template', pendingTemplate)}</strong><p>{t('replaceTemplate')}</p>
            <button type='button' disabled={busy} onClick={() => applyTemplate(pendingTemplate)}>{t('applyTemplate')}</button><button type='button' onClick={() => setPendingTemplate(undefined)}>{ct('cancel')}</button>
        </section>}
        {json !== undefined && <section className='nmx-director-json' role='dialog' aria-label={t('json')}><ImeTextarea value={json} rows={20} aria-label={t('json')} onChange={event => setJson(event.currentTarget.value)} />
            <button type='button' disabled={busy} onClick={() => void safe(() => {
                const parsed: unknown = JSON.parse(json);
                const next = parsed && typeof parsed === 'object' && Array.isArray((parsed as { characters?: unknown }).characters) ? sceneFromTemplate(parsed, id) : normalizeScene(parsed);
                commit(next); setJson(undefined); seek(0);
            })}>{t('apply')}</button>
            <button type='button' onClick={() => { const url = URL.createObjectURL(new Blob([json], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'director-scene.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>{t('download')}</button>
            <button type='button' onClick={() => setJson(undefined)}>{ct('cancel')}</button></section>}
    </div></div></div>, document.body);
}

export function emptyDirectorScene(): SceneDocument { return createSceneDocument(); }
