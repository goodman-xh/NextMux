import * as React from '@theia/core/shared/react';
import {
    CAMERA_MOVES, CAMERA_PRESETS, CAMERA_SPEEDS, applyCameraPreset, createCameraSelection,
    normalizeCameraSelection, setCameraSpeed, toggleCameraMove, type CameraSelection
} from '@nextmux/comic-core/canvas-camera';
import { cameraControlText, cameraMoveLabel, cameraPresetLabel, cameraSpeedLabel } from './nextmux-comic-canvas-camera-text';
import '../../src/browser/style/nextmux-comic-canvas-camera.css';

export interface CameraControlProps {
    readonly locale: string;
    readonly selection?: CameraSelection;
    readonly onConfirm: (selection: CameraSelection) => void;
    readonly onCancel: () => void;
    readonly presentation?: 'popover' | 'dialog';
}
function CloseMark(): React.ReactElement { return <svg width='12' height='12' viewBox='0 0 12 12' aria-hidden='true'><path d='m3 3 6 6M9 3 3 9' fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round' /></svg>; }

/** A local draft: choosing an option never changes a node until Confirm is pressed. */
export function CameraControl({ locale, selection, onConfirm, onCancel, presentation = 'popover' }: CameraControlProps): React.ReactElement {
    const [draft, setDraft] = React.useState(() => normalizeCameraSelection(selection ?? createCameraSelection()));
    const root = React.useRef<HTMLDivElement>(null), composing = React.useRef(false);
    const cancel = React.useRef(onCancel); cancel.current = onCancel;
    const [maxHeight, setMaxHeight] = React.useState<number>();
    const t = (key: Parameters<typeof cameraControlText>[1]): string => cameraControlText(locale, key);
    React.useLayoutEffect(() => {
        const element = root.current;
        if (!element) return;
        const trigger = document.activeElement;
        element.focus({ preventScroll: true });
        if (presentation !== 'popover') return;
        const board = element.closest('.nmx-board');
        const measure = (): void => {
            const bounds = board?.getBoundingClientRect();
            const visibleTop = Math.max(0, bounds?.top ?? 0) + 8;
            const visibleBottom = Math.min(window.innerHeight, bounds?.bottom ?? window.innerHeight) - 8;
            // CSS keeps this drawer above its owner, including beyond a canvas edge.
            // Only the whole visible canvas limits its height; pan/zoom never relocates it.
            const next = Math.min(320, Math.max(1, Math.floor(visibleBottom - visibleTop)));
            setMaxHeight(current => current === next ? current : next);
        };
        const dismiss = (event: PointerEvent): void => {
            // The canvas reserves middle/right drag for panning; it is not an outside click.
            if (event.button !== 0) return;
            if (!(event.target instanceof Node) || element.contains(event.target)) return;
            // The opening button owns its toggle. Cancelling on its pointerdown would reopen on click.
            if (trigger instanceof HTMLElement && trigger.contains(event.target)) return;
            cancel.current();
        };
        measure();
        const observer = new ResizeObserver(measure);
        if (board) observer.observe(board);
        window.addEventListener('resize', measure);
        document.addEventListener('scroll', measure, true);
        document.addEventListener('pointerdown', dismiss, true);
        return () => { observer.disconnect(); window.removeEventListener('resize', measure);
            document.removeEventListener('scroll', measure, true); document.removeEventListener('pointerdown', dismiss, true); };
    }, [presentation]);
    return <div ref={root} className={`nmx-camera-control nodrag nopan nowheel is-${presentation}${presentation === 'popover' && maxHeight !== undefined && maxHeight < 120 ? ' is-short' : ''}`} role='dialog' aria-label={t('title')} tabIndex={-1} lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} data-canvas-keyboard-exclude
        style={presentation === 'popover' && maxHeight !== undefined ? { maxHeight } : undefined}
        onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
        onCompositionStartCapture={() => { composing.current = true; }} onCompositionEndCapture={() => { composing.current = false; }}
        onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape' && !composing.current && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); onCancel(); } }}>
        <header className='nmx-camera-header'><span>{t('title')}</span><button type='button' className='nmx-camera-close' data-camera-action='cancel' aria-label={t('close')} title={t('close')} data-nmx-tip={t('close')} onClick={onCancel}><CloseMark /></button></header>
        <div className='nmx-camera-body'>
            <aside className='nmx-camera-presets' aria-label={t('presets')}><div className='nmx-camera-section-title'>{t('presets')}</div><div className='nmx-camera-preset-list'>
                {CAMERA_PRESETS.map(preset => <button type='button' className={`nmx-camera-preset${draft.presetId === preset.id ? ' is-selected' : ''}`} key={preset.id} data-camera-preset={preset.id}
                    aria-pressed={draft.presetId === preset.id} onClick={() => setDraft(applyCameraPreset(preset.id))}>
                    <span className='nmx-camera-preset-name'>{cameraPresetLabel(locale, preset.id)}</span>
                    <span className='nmx-camera-preset-description'>{preset.movements.map(id => cameraMoveLabel(locale, id)).join(' + ')}</span>
                </button>)}
            </div></aside>
            <div className='nmx-camera-options'><div className='nmx-camera-section-title'>{t('custom')}</div><div className='nmx-camera-movements'>
                {(['zoom', 'horizontal', 'vertical', 'special'] as const).map(category => <div className='nmx-camera-category' key={category} data-camera-category={category}>
                    <span className='nmx-camera-category-label'>{t(category)}</span><div className='nmx-camera-choices'>
                        {CAMERA_MOVES.filter(move => move.category === category).map(move => <button type='button' className={`nmx-camera-option${draft.movements.includes(move.id) ? ' is-selected' : ''}`} key={move.id} data-camera-move={move.id}
                            aria-pressed={draft.movements.includes(move.id)} onClick={() => setDraft(value => toggleCameraMove(value, move.id))}>{cameraMoveLabel(locale, move.id)}</button>)}
                    </div>
                </div>)}
                <div className='nmx-camera-category is-speed'><span className='nmx-camera-category-label'>{t('speed')}</span><div className='nmx-camera-choices'>
                    {CAMERA_SPEEDS.map(speed => <button type='button' className={`nmx-camera-option${draft.speed === speed.id ? ' is-selected' : ''}`} key={speed.id} data-camera-speed={speed.id}
                        aria-pressed={draft.speed === speed.id} onClick={() => setDraft(value => setCameraSpeed(value, speed.id))}>{cameraSpeedLabel(locale, speed.id)}</button>)}
                </div></div>
            </div></div>
        </div>
        <footer className='nmx-camera-footer'><span>{t('hint')}</span><button type='button' className='nmx-camera-confirm' data-camera-action='confirm' onClick={() => onConfirm(normalizeCameraSelection(draft))}>{t('confirm')}</button></footer>
    </div>;
}

/** Tags are the editable display of the submitted camera prefix, separate from authored prompt text. */
export function CameraTags({ locale, selection, onChange }: {
    readonly locale: string; readonly selection: CameraSelection; readonly onChange: (selection: CameraSelection) => void;
}): React.ReactElement | null {
    const t = (key: Parameters<typeof cameraControlText>[1]): string => cameraControlText(locale, key);
    if (!selection.movements.length && selection.speed === 'normal') return null;
    return <div className='nmx-camera-tags nodrag nopan' aria-label={t('title')}>
        {selection.presetId ? <span className='nmx-camera-tag is-preset'><span>{cameraPresetLabel(locale, selection.presetId)}</span>
            <button type='button' data-camera-action='clear-preset' aria-label={t('clear')} title={t('clear')} data-nmx-tip={t('clear')} onClick={() => onChange(createCameraSelection())}><CloseMark /></button></span>
            : selection.movements.map(id => <span className='nmx-camera-tag' key={id} data-camera-tag={id}><span>{cameraMoveLabel(locale, id)}</span>
                <button type='button' data-camera-remove={id} aria-label={`${t('remove')} ${cameraMoveLabel(locale, id)}`} title={`${t('remove')} ${cameraMoveLabel(locale, id)}`} data-nmx-tip={`${t('remove')} ${cameraMoveLabel(locale, id)}`} onClick={() => onChange(toggleCameraMove(selection, id))}><CloseMark /></button></span>)}
        {selection.speed !== 'normal' && <span className='nmx-camera-tag is-speed'><span>{cameraSpeedLabel(locale, selection.speed)}</span><button type='button' data-camera-action='reset-speed' aria-label={t('resetSpeed')} title={t('resetSpeed')} data-nmx-tip={t('resetSpeed')} onClick={() => onChange(setCameraSpeed(selection, 'normal'))}><CloseMark /></button></span>}
        <button type='button' className='nmx-camera-clear' data-camera-action='clear' aria-label={t('clear')} title={t('clear')} data-nmx-tip={t('clear')} onClick={() => onChange(createCameraSelection())}><CloseMark /></button>
    </div>;
}
