import * as React from '@theia/core/shared/react';

export type CanvasShortcut = 'cancel' | 'undo' | 'redo' | 'copy' | 'paste' | 'duplicate' | 'group' | 'ungroup' | 'selectAll' | 'fit' | 'zoomIn' | 'zoomOut' | 'delete' | 'rename' | 'add';
export interface CanvasKeyboardViewport { readonly x: number; readonly y: number; readonly zoom: number }
export type CanvasNavigationKey = 'KeyW' | 'KeyA' | 'KeyS' | 'KeyD' | 'KeyQ' | 'KeyE';
const NAVIGATION_KEYS = new Set<string>(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE']);

export function canvasShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'isComposing' | 'keyCode'>): CanvasShortcut | undefined {
    if (event.isComposing || event.keyCode === 229 || event.altKey) return;
    const key = event.key.toLowerCase(), mod = event.ctrlKey || event.metaKey;
    if (mod) {
        if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
        if (key === 'y') return 'redo';
        if (key === 'g') return event.shiftKey ? 'ungroup' : 'group';
        return ({ a: 'selectAll', c: 'copy', v: 'paste', d: 'duplicate', '0': 'fit', '=': 'zoomIn', '+': 'zoomIn', '-': 'zoomOut', _: 'zoomOut' } as Record<string, CanvasShortcut>)[key];
    }
    return ({ escape: 'cancel', delete: 'delete', backspace: 'delete', f2: 'rename', tab: 'add' } as Record<string, CanvasShortcut>)[key];
}

/** Neowow's public useCanvasViewport: screen-pixel pan, center-preserving zoom and a 50ms frame cap. */
export function canvasNavigationStep(viewport: CanvasKeyboardViewport, pressed: ReadonlySet<string>, elapsedSeconds: number,
    size: { readonly width: number; readonly height: number }, sensitivity = 1, shiftBoost = 2.5, shift = false): CanvasKeyboardViewport {
    const dt = Math.max(0, Math.min(0.05, elapsedSeconds));
    const rate = Math.max(0.2, Math.min(3, sensitivity)) * (shift ? Math.max(1, Math.min(8, shiftBoost)) : 1);
    const distance = 800 * rate * dt;
    let x = viewport.x + (Number(pressed.has('KeyA')) - Number(pressed.has('KeyD'))) * distance;
    let y = viewport.y + (Number(pressed.has('KeyW')) - Number(pressed.has('KeyS'))) * distance;
    const zoom = Math.min(3, Math.max(0.04, viewport.zoom * 2.2 ** ((Number(pressed.has('KeyE')) - Number(pressed.has('KeyQ'))) * dt * rate)));
    const cx = size.width / 2, cy = size.height / 2;
    x = cx - (cx - x) / viewport.zoom * zoom;
    y = cy - (cy - y) / viewport.zoom * zoom;
    return { x, y, zoom };
}

function editable(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && (target.isContentEditable || Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [data-canvas-keyboard-exclude], .monaco-editor, .xterm')));
}
function visible(element: HTMLElement): boolean {
    return element.isConnected && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden' && !element.closest('[inert], [aria-hidden="true"]');
}
function blockingModal(root: HTMLElement): boolean {
    // The comic desk is itself an aria-modal dialog. Only overlays above it block its canvas.
    return [...document.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"], [aria-modal="true"]')]
        .some(element => !element.contains(root) && visible(element));
}

/** Shared with the shell's earlier capture handler so its stock bindings can yield only to the active canvas. */
export function canvasKeyboardOwnsTarget(target: EventTarget | null, root?: HTMLElement): boolean {
    if (editable(target) || editable(document.activeElement)) return false;
    const boards = root ? [root] : [...document.querySelectorAll<HTMLElement>('.nmx-board')];
    return boards.some(board => visible(board) && !blockingModal(board)
        && (target === document || target === document.body || target === document.documentElement || target instanceof Node && board.contains(target)));
}

export interface CanvasKeyboardOptions {
    readonly root: React.RefObject<HTMLDivElement>;
    readonly scopeKey: string;
    readonly settings: { readonly navigationSensitivity?: number; readonly navigationShiftBoost?: number };
    readonly onCommand: (command: CanvasShortcut) => boolean;
    readonly onPaste: (event: ClipboardEvent) => boolean;
    /** A desktop may omit paste on a focused non-editable div. Claim coordinates with a native paste event. */
    readonly onPasteFallback?: (claim: (text: string) => boolean) => void;
    readonly getViewport: () => CanvasKeyboardViewport;
    readonly setViewport: (viewport: CanvasKeyboardViewport) => unknown;
    readonly onNavigationEnd: (viewport: CanvasKeyboardViewport) => void;
}

/** Capture before the editor shell's document bindings, but only for this visible canvas. */
export function useCanvasKeyboard(options: CanvasKeyboardOptions): { readonly spacePressed: boolean; readonly navigating: boolean; readonly navigationActive: React.MutableRefObject<boolean> } {
    const current = React.useRef(options); current.current = options;
    const navigationActive = React.useRef(false);
    const [spacePressed, setSpacePressed] = React.useState(false), [navigating, setNavigating] = React.useState(false);
    React.useEffect(() => {
        setSpacePressed(false); setNavigating(false);
        const pressed = new Set<string>();
        let frame = 0, last = 0, shift = false, composing = false, space = false;
        let pasteGesture: { handled: boolean; released: boolean; text?: string } | undefined;
        const inScope = (target: EventTarget | null): boolean => {
            const root = current.current.root.current;
            return Boolean(root && !composing && canvasKeyboardOwnsTarget(target, root));
        };
        const finish = (): void => {
            if (frame) cancelAnimationFrame(frame);
            frame = 0;
            if (navigationActive.current) {
                navigationActive.current = false; setNavigating(false);
                current.current.onNavigationEnd(current.current.getViewport());
            }
        };
        const clear = (): void => {
            pasteGesture = undefined;
            pressed.clear(); shift = false; composing = false;
            if (space) { space = false; setSpacePressed(false); }
            finish();
        };
        const tick = (time: number): void => {
            frame = 0;
            if (!pressed.size || !inScope(document.activeElement)) { pressed.clear(); finish(); return; }
            const { root, getViewport, setViewport, settings } = current.current;
            const rect = root.current!.getBoundingClientRect();
            const next = canvasNavigationStep(getViewport(), pressed, (time - last) / 1000, rect,
                settings.navigationSensitivity, settings.navigationShiftBoost, shift);
            last = time; setViewport(next); frame = requestAnimationFrame(tick);
        };
        const handled = (event: KeyboardEvent): void => { event.preventDefault(); event.stopImmediatePropagation(); };
        const down = (event: KeyboardEvent): void => {
            shift = event.shiftKey;
            if (event.ctrlKey || event.metaKey || event.altKey) { pressed.clear(); finish(); }
            if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || !inScope(event.target)) return;
            const target = event.target instanceof Element ? event.target : undefined;
            if (event.code === 'Space' && !event.ctrlKey && !event.metaKey && !event.altKey) {
                if (target?.closest('button, a, [role="button"]')) return;
                handled(event); space = true; setSpacePressed(true); return;
            }
            if (NAVIGATION_KEYS.has(event.code) && !event.ctrlKey && !event.metaKey && !event.altKey) {
                handled(event); pressed.add(event.code);
                if (!navigationActive.current) {
                    navigationActive.current = true; setNavigating(true); last = performance.now(); frame = requestAnimationFrame(tick);
                }
                return;
            }
            const command = canvasShortcut(event);
            if (!command || command === 'copy' && window.getSelection()?.toString()) return;
            // Keep the browser's native paste event (including image/video files), while bypassing editor bindings.
            if (command === 'paste') {
                event.stopImmediatePropagation();
                if (event.repeat) return;
                const gesture = { handled: false, released: false, text: undefined as string | undefined };
                pasteGesture = gesture;
                current.current.onPasteFallback?.(text => {
                    if (pasteGesture !== gesture || gesture.handled || !inScope(document.activeElement)) return false;
                    gesture.handled = true; gesture.text = text;
                    // A later Edit > Paste is a new action, not a duplicate of this completed key gesture.
                    if (gesture.released) window.setTimeout(() => { if (pasteGesture === gesture) pasteGesture = undefined; }, 0);
                    return true;
                });
                return;
            }
            pasteGesture = undefined;
            // Native tab traversal remains available on toolbar controls; Tab on the canvas opens Add.
            if (command === 'add' && target?.closest('button, a, [role="button"]')) return;
            if (event.repeat) { handled(event); return; }
            if (current.current.onCommand(command)) handled(event);
        };
        const up = (event: KeyboardEvent): void => {
            if (event.code === 'KeyV' && pasteGesture) {
                pasteGesture.released = true;
                if (pasteGesture.handled) pasteGesture = undefined;
            }
            shift = event.shiftKey;
            pressed.delete(event.code);
            if (!pressed.size) finish();
            if (event.code === 'Space' && space) { space = false; setSpacePressed(false); event.preventDefault(); }
            // macOS does not always deliver letter keyup while Command is held.
            if (event.key === 'Meta' || event.key === 'Control') { pressed.clear(); finish(); }
        };
        const focus = (event: FocusEvent): void => { if (!inScope(event.target)) clear(); };
        const startComposition = (): void => { clear(); composing = true; };
        const endComposition = (): void => { composing = false; };
        const visibility = (): void => { if (document.hidden) clear(); };
        const paste = (event: ClipboardEvent): void => {
            if (event.defaultPrevented || !inScope(event.target)) return;
            const duplicate = pasteGesture?.handled && pasteGesture.text !== undefined
                && event.clipboardData?.getData('text/plain') === pasteGesture.text;
            if (duplicate || current.current.onPaste(event)) {
                if (pasteGesture) pasteGesture.handled = true;
                event.preventDefault(); event.stopImmediatePropagation();
            }
        };
        window.addEventListener('keydown', down, true); window.addEventListener('keyup', up, true);
        window.addEventListener('paste', paste, true);
        window.addEventListener('blur', clear); window.addEventListener('focusin', focus, true);
        window.addEventListener('compositionstart', startComposition, true); window.addEventListener('compositionend', endComposition, true);
        document.addEventListener('visibilitychange', visibility);
        return () => {
            pasteGesture = undefined;
            window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true);
            window.removeEventListener('paste', paste, true);
            window.removeEventListener('blur', clear); window.removeEventListener('focusin', focus, true);
            window.removeEventListener('compositionstart', startComposition, true); window.removeEventListener('compositionend', endComposition, true);
            document.removeEventListener('visibilitychange', visibility);
            if (frame) cancelAnimationFrame(frame);
            navigationActive.current = false;
        };
    }, [options.scopeKey]);
    return { spacePressed, navigating, navigationActive };
}
