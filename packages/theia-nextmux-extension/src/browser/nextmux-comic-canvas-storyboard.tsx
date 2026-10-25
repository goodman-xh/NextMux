import * as React from '@theia/core/shared/react';
import { CanvasModalLayer } from './nextmux-comic-canvas-modal';
import {
    STORYBOARD_APERTURES, STORYBOARD_FOCAL_LENGTHS, STORYBOARD_MAX_SHOTS, addStoryboardShot, compileStoryboardPrompt,
    createStoryboard, moveStoryboardShot, parseStoryboardPrompt, validateStoryboard, type CanvasStoryboard, type CanvasStoryboardShot, type StoryboardAperture, type StoryboardFocalLength
} from '@nextmux/comic-core/canvas-camera';
import { ImeTextarea } from './nextmux-ime-field';
import { CameraControl } from './nextmux-comic-canvas-camera';
import { cameraSelectionLabel } from './nextmux-comic-canvas-camera-text';
import { focusDialogOnMount } from './nextmux-comic-canvas-logic';
import { storyboardText, type StoryboardTextKey } from './nextmux-comic-canvas-storyboard-text';
import '../../src/browser/style/nextmux-comic-canvas-storyboard.css';

/** These are already connected inputs, never bindings inferred from text mentions. */
export interface StoryboardReference {
    readonly id: string;
    readonly kind: 'image' | 'video' | 'audio';
    readonly uri: string;
    readonly label: string;
}

/** Each card describes part of one video clip; applying only edits its prompt and saved plan. */
export interface StoryboardDialogProps {
    readonly locale: string;
    readonly prompt: string;
    readonly durationSeconds: number;
    readonly saved?: CanvasStoryboard;
    readonly references?: readonly StoryboardReference[];
    readonly onApply: (prompt: string, storyboard: CanvasStoryboard) => void;
    readonly onClose: () => void;
}

function initial(props: StoryboardDialogProps): { readonly storyboard: CanvasStoryboard; readonly plain?: string } {
    try {
        // Parsing against a shorter new generation duration must not silently truncate authored shots.
        const authoredEnds = [...props.prompt.matchAll(/【时间】\s*\d+(?:\.\d+)?\s*s?\s*[-–]\s*(\d+(?:\.\d+)?)/g)].map(match => Number(match[1]));
        const parseDuration = Math.max(props.durationSeconds, props.saved?.clipDurationSeconds ?? 0, ...authoredEnds);
        const parsed = parseStoryboardPrompt(props.prompt, { clipDurationSeconds: parseDuration, ...(props.saved ? { sourceStoryboard: props.saved } : {}) });
        if (parsed.hadMarkers) {
            const { originalPrompt: _original, ...storyboard } = parsed.storyboard;
            return { storyboard: { ...storyboard, clipDurationSeconds: props.durationSeconds }, ...(parsed.unparsedText.trim() ? { plain: parsed.unparsedText } : {}) };
        }
    } catch { /* Preserve an unstructured prompt when starting a fresh storyboard. */ }
    return { storyboard: { ...createStoryboard(props.durationSeconds), guidance: [storyboardText(props.locale, 'guidance')] }, ...(props.prompt.trim() ? { plain: props.prompt } : {}) };
}

const round = (value: number): number => Math.round(value * 10) / 10;
const Icon = (props: { name: string }): React.ReactElement => <i className={`codicon codicon-${props.name}`} aria-hidden='true' />;

export function StoryboardDialog(props: StoryboardDialogProps): React.ReactElement {
    const s = (key: StoryboardTextKey, values?: Record<string, string | number>): string => storyboardText(props.locale, key, values);
    const start = React.useMemo(() => initial(props), []);
    const [storyboard, setStoryboard] = React.useState<CanvasStoryboard>(start.storyboard);
    const [keepPlain, setKeepPlain] = React.useState(Boolean(start.plain));
    const [cameraId, setCameraId] = React.useState<string>();
    const [error, setError] = React.useState<string>();
    const [draggedId, setDraggedId] = React.useState<string>();
    const backdropPress = React.useRef(false), cameraBackdropPress = React.useRef(false);
    const zh = props.locale.startsWith('zh');
    // The compiler owns original text too: appending it again after compiling would duplicate it on reopen.
    const snapshot: CanvasStoryboard = { ...storyboard, clipDurationSeconds: props.durationSeconds, ...(keepPlain && start.plain ? { originalPrompt: start.plain } : {}) };
    const issues = validateStoryboard(snapshot);
    let finalPrompt = '';
    try { finalPrompt = compileStoryboardPrompt(snapshot).prompt; } catch { /* The error is shown below; apply remains disabled. */ }
    const attempt = (change: (current: CanvasStoryboard) => CanvasStoryboard): void => {
        try { const next = change({ ...storyboard, clipDurationSeconds: props.durationSeconds }); setStoryboard(next); setError(undefined); }
        catch { setError(s('issue.time')); }
    };
    const update = (id: string, patch: Partial<CanvasStoryboardShot>): void => {
        setStoryboard(current => ({ ...current, shots: current.shots.map(shot => shot.id === id ? { ...shot, ...patch } : shot) }));
        setError(undefined);
    };
    const duration = snapshot.clipDurationSeconds;
    const remaining = round(duration - Math.max(0, ...storyboard.shots.map(shot => shot.endSeconds ?? 0)));
    const cameraShot = storyboard.shots.find(shot => shot.id === cameraId);
    const cameraLabel = (shot: CanvasStoryboardShot): string => shot.camera.movements.length ? cameraSelectionLabel(props.locale, shot.camera) : '';
    const timeRange = (shot: CanvasStoryboardShot): { from: number; to: number; low: number; high: number } | undefined => {
        const others = storyboard.shots.filter(item => item.id !== shot.id && item.startSeconds !== undefined && item.endSeconds !== undefined)
            .sort((a, b) => a.startSeconds! - b.startSeconds!);
        if (shot.startSeconds !== undefined && shot.endSeconds !== undefined) {
            return { from: shot.startSeconds, to: shot.endSeconds,
                low: Math.max(0, ...others.filter(item => item.endSeconds! <= shot.startSeconds!).map(item => item.endSeconds!)),
                high: Math.floor((Math.min(duration, ...others.filter(item => item.startSeconds! >= shot.endSeconds!).map(item => item.startSeconds!)) + 1e-9) * 10) / 10 };
        }
        // A cleared interval can be restored in a free gap; never fill across occupied shots.
        let low = 0;
        const gaps: { from: number; to: number; low: number; high: number }[] = [];
        for (const item of [...others, { startSeconds: duration, endSeconds: duration }]) {
            const high = Math.floor((item.startSeconds! + 1e-9) * 10) / 10;
            if (round(high - low) >= .1) gaps.push({ from: low, to: round(Math.min(high, low + 5)), low, high });
            low = Math.max(low, item.endSeconds!);
        }
        return gaps.sort((a, b) => (b.high - b.low) - (a.high - a.low))[0];
    };
    const setTime = (shot: CanvasStoryboardShot, side: 'from' | 'to', value: number): void => {
        const range = timeRange(shot);
        if (!range) { setError(s('noTime')); return; }
        const nextFrom = side === 'from' ? round(Math.max(range.low, Math.min(range.to - .1, value))) : range.from;
        const nextTo = side === 'to' ? round(Math.max(range.from + .1, Math.min(range.high, value))) : range.to;
        if (nextFrom < range.low || nextTo > range.high || nextFrom >= nextTo) { setError(s('noTime')); return; }
        update(shot.id, { startSeconds: nextFrom, endSeconds: nextTo });
    };

    return <CanvasModalLayer locale={props.locale}><div className='nmx-sbd-overlay'
        onPointerDown={event => { backdropPress.current = event.button === 0 && event.target === event.currentTarget; }}
        onPointerUp={event => { if (event.target !== event.currentTarget) backdropPress.current = false; }}
        onPointerCancel={() => { backdropPress.current = false; }}
        onClick={event => { if (event.target === event.currentTarget && backdropPress.current) props.onClose(); backdropPress.current = false; }}
        onKeyDown={event => {
            event.stopPropagation();
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Escape') { event.preventDefault(); props.onClose(); }
        }}>
        <section ref={focusDialogOnMount} tabIndex={-1} className='nmx-sbd-dialog' role='dialog' aria-modal='true' aria-label={s('dialogTitle')}>
            <header className='nmx-sbd-header'>
                <div className='nmx-sbd-header-left'><div><h2>{s('dialogTitle')}</h2><p>{s('subtitle')}</p></div>
                    <span className='nmx-sbd-count' title={s('count', { n: storyboard.shots.length, max: STORYBOARD_MAX_SHOTS })}>{storyboard.shots.length}/{STORYBOARD_MAX_SHOTS}</span></div>
                <button type='button' className='nmx-sbd-close' title={s('close')} aria-label={s('close')} onClick={props.onClose}><Icon name='close' /></button>
            </header>
            {Boolean(props.references?.length) && <div className='nmx-sbd-ref-bar'><span>{s('references')}</span><div className='nmx-sbd-ref-items'>
                {props.references!.map(reference => <div className='nmx-sbd-ref-thumb' key={reference.id} title={reference.label}>
                    {reference.kind === 'image' ? <img src={reference.uri} alt={reference.label} /> : reference.kind === 'video' ? <video src={reference.uri} muted preload='metadata' aria-label={reference.label} /> : <Icon name='music' />}
                    <span>{reference.label}</span>
                </div>)}
            </div></div>}
            <div className='nmx-sbd-scenes'>
                {storyboard.shots.map((shot, index) => { const range = timeRange(shot); return <article key={shot.id} data-shot-id={shot.id} className={`nmx-sbd-scene${draggedId === shot.id ? ' is-dragging' : ''}`}
                    onDragOver={event => { if (draggedId) event.preventDefault(); }} onDrop={event => {
                        if (!draggedId) return; event.preventDefault(); attempt(current => moveStoryboardShot(current, draggedId, index)); setDraggedId(undefined);
                    }}>
                    <div className='nmx-sbd-scene-topbar'><div className='nmx-sbd-scene-topbar-main'>
                        <button type='button' className='nmx-sbd-drag' draggable title={s('drag')} aria-label={`${s('shot', { n: index + 1 })}: ${s('drag')}`}
                            onDragStart={event => { setDraggedId(shot.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', shot.id); }} onDragEnd={() => setDraggedId(undefined)}
                            onKeyDown={event => { if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return; event.preventDefault(); event.stopPropagation(); const target = index + (event.key === 'ArrowUp' ? -1 : 1); if (target >= 0 && target < storyboard.shots.length) attempt(current => moveStoryboardShot(current, shot.id, target)); }}><Icon name='gripper' /></button>
                        <span className='nmx-sbd-scene-label'>{s('shot', { n: index + 1 })}</span>
                        <div className='nmx-sbd-selectors'>
                            <label><span>{s('focal')}</span><select value={shot.focalLength ?? ''} title={s('focal')} onChange={event => update(shot.id, { focalLength: (event.currentTarget.value || undefined) as StoryboardFocalLength | undefined })}>
                                <option value=''>{s('none')}</option>{STORYBOARD_FOCAL_LENGTHS.map(item => <option key={item.value} value={item.value}>{zh ? item.label : item.value.match(/^[\d.]+mm/)?.[0] ?? item.value}</option>)}</select></label>
                            <label><span>{s('aperture')}</span><select value={shot.aperture ?? ''} title={s('aperture')} onChange={event => update(shot.id, { aperture: (event.currentTarget.value || undefined) as StoryboardAperture | undefined })}>
                                <option value=''>{s('none')}</option>{STORYBOARD_APERTURES.map(item => <option key={item.value} value={item.value}>{zh ? item.label : item.value.match(/^f\/[\d.]+/)?.[0] ?? item.value}</option>)}</select></label>
                            <div className='nmx-sbd-camera-field'><span>{s('camera')}</span><button type='button' className='nmx-sbd-camera-trigger' title={cameraLabel(shot) || s('chooseCamera')} aria-label={s('chooseCamera')} onClick={() => setCameraId(shot.id)}>
                                <span className={shot.camera.movements.length ? '' : 'is-placeholder'}>{cameraLabel(shot) || s('chooseCamera')}</span><Icon name='chevron-down' /></button></div>
                        </div>
                        {storyboard.shots.length > 1 && <button type='button' className='nmx-sbd-remove' title={s('remove')} aria-label={s('remove')} onClick={() => { setStoryboard(current => ({ ...current, shots: current.shots.filter(item => item.id !== shot.id) })); setError(undefined); }}><Icon name='close' /></button>}
                    </div>
                    <div className='nmx-sbd-time-row'><span>{s('range')}</span><div className='nmx-sbd-range' style={{ '--sbd-range-from': `${Math.min(100, (range?.from ?? 0) / duration * 100)}%`, '--sbd-range-to': `${Math.min(100, (range?.to ?? 0) / duration * 100)}%` } as React.CSSProperties} onPointerDown={event => {
                        if (event.target !== event.currentTarget || event.button !== 0 || !range) return;
                        const rect = event.currentTarget.getBoundingClientRect(), value = round((event.clientX - rect.left) / rect.width * duration);
                        const side = Math.abs(value - range.from) < Math.abs(value - range.to) ? 'from' : 'to';
                        event.currentTarget.querySelectorAll('input')[side === 'from' ? 0 : 1]?.focus(); setTime(shot, side, value);
                    }}>
                        <input type='range' min={0} max={duration} step={.1} disabled={!range} value={range?.from ?? 0} title={`${s('from')}: ${(shot.startSeconds ?? 0).toFixed(1)}s`} aria-label={`${s('shot', { n: index + 1 })}: ${s('from')}`} onChange={event => setTime(shot, 'from', Number(event.currentTarget.value))} />
                        <input type='range' min={0} max={duration} step={.1} disabled={!range} value={range?.to ?? 0} title={`${s('to')}: ${(shot.endSeconds ?? duration).toFixed(1)}s`} aria-label={`${s('shot', { n: index + 1 })}: ${s('to')}`} onChange={event => setTime(shot, 'to', Number(event.currentTarget.value))} />
                    </div><span className='nmx-sbd-time-value'>{shot.startSeconds === undefined || shot.endSeconds === undefined ? s('none') : `${shot.startSeconds.toFixed(1)}s - ${shot.endSeconds.toFixed(1)}s`}</span>
                        {shot.startSeconds !== undefined && <button type='button' className='nmx-sbd-clear-time' title={s('clearTime')} aria-label={s('clearTime')} onClick={() => update(shot.id, { startSeconds: undefined, endSeconds: undefined })}><Icon name='close' /></button>}
                    </div></div>
                    <div className='nmx-sbd-content'>
                        {(['foreground', 'background', 'requirements'] as const).map(field => <label key={field}><span>{s(field)}</span><ImeTextarea rows={field === 'requirements' ? 2 : 1} value={shot[field]} placeholder={s(field === 'foreground' ? 'foregroundHint' : field === 'background' ? 'backgroundHint' : 'requirementsHint')} onChange={event => update(shot.id, { [field]: event.currentTarget.value })} /></label>)}
                    </div>
                    {issues.filter(item => item.shotId === shot.id).map(item => <p key={item.code} className='nmx-sbd-error' role='alert'>{s(`issue.${item.code}` as StoryboardTextKey)}</p>)}
                </article>; })}
            </div>
            <div className='nmx-sbd-toolbar'><div className='nmx-sbd-switches'>
                <label title={s('notesHint')}><span>{s('soundLabel')}</span><input type='checkbox' role='switch' checked={storyboard.soundEffects} onChange={event => { const checked = event.currentTarget.checked; setStoryboard(current => ({ ...current, soundEffects: checked })); }} /></label>
                <label title={s('notesHint')}><span>{s('musicLabel')}</span><input type='checkbox' role='switch' checked={storyboard.backgroundMusic} onChange={event => { const checked = event.currentTarget.checked; setStoryboard(current => ({ ...current, backgroundMusic: checked })); }} /></label>
            </div><button type='button' className='nmx-sbd-add' disabled={issues.length > 0 || storyboard.shots.length >= STORYBOARD_MAX_SHOTS || remaining < .1} title={remaining < .1 ? s('noTime') : s('add')} onClick={() => attempt(current => addStoryboardShot(current))}><Icon name='add' />{s('add')}</button></div>
            <div className='nmx-sbd-other'><span>{s('other')}</span><div><p>{storyboard.guidance.join('\n') || s('none')}</p>
                {start.plain && <label title={start.plain}><input type='checkbox' checked={keepPlain} onChange={event => setKeepPlain(event.currentTarget.checked)} />{s('keepPlain')}</label>}
            </div></div>
            <footer className='nmx-sbd-footer'>
                {error || issues.length ? <span className='nmx-sbd-error' role='alert'>{error ?? s(`issue.${issues[0]!.code}` as StoryboardTextKey)}</span> : undefined}
                <button type='button' className='nmx-sbd-btn' title={s('cancel')} onClick={props.onClose}>{s('cancel')}</button>
                <button type='button' className='nmx-sbd-btn is-primary' title={s('apply')} disabled={issues.length > 0 || !finalPrompt} onClick={() => props.onApply(finalPrompt, snapshot)}>{s('confirm')}</button>
            </footer>
        </section>
        {cameraShot && <CanvasModalLayer locale={props.locale}><div className='nmx-sbd-camera-overlay'
            onPointerDown={event => { cameraBackdropPress.current = event.button === 0 && event.target === event.currentTarget; }}
            onPointerUp={event => { if (event.target !== event.currentTarget) cameraBackdropPress.current = false; }}
            onPointerCancel={() => { cameraBackdropPress.current = false; }}
            onClick={event => { if (event.target === event.currentTarget && cameraBackdropPress.current) setCameraId(undefined); cameraBackdropPress.current = false; }}>
            <CameraControl key={cameraShot.id} locale={props.locale} selection={cameraShot.camera} presentation='dialog' onCancel={() => setCameraId(undefined)} onConfirm={camera => { update(cameraShot.id, { camera }); setCameraId(undefined); }} />
        </div></CanvasModalLayer>}
    </div></CanvasModalLayer>;
}
