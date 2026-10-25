/**
 * Inactive window buttons on macOS 26 are faint translucent circles that nearly vanish on the
 * light theme's title bar. While the window is inactive, gray discs are drawn under them, so the
 * native (translucent) buttons read as gray buttons again. The native buttons stay on top and keep
 * working; nothing is drawn while the window is active, in full screen or under a modal (which hides
 * the native buttons), and the dark theme is untouched.
 *
 * The disc positions are calibrated for the hiddenInset title bar on macOS 26: centres
 * at 20, 42 and 64 pt, 18 pt down, 14.5 pt wide. Older macOS lays the buttons out differently and
 * keeps the system look.
 */

export const WINDOW_INACTIVE_CLASS = 'nmx-window-inactive';
export const WINDOW_FULLSCREEN_CLASS = 'nmx-window-fullscreen';

interface FocusState { readonly focused?: boolean; readonly fullScreen?: boolean }
export interface InactiveWindowButtonsBridge {
    readonly macosMajor?: number;
    getWindowFocusState?(): Promise<FocusState | undefined>;
    onWindowFocusChange?(callback: (state: FocusState) => void): () => void;
}

export function inactiveWindowButtonsSupported(macosMajor: number | undefined): boolean {
    return Number.isFinite(macosMajor) && Number(macosMajor) >= 26;
}

export function installInactiveWindowButtons(
    doc: Document = document,
    bridge: InactiveWindowButtonsBridge | undefined = (window as Window & { nextmuxDesktop?: InactiveWindowButtonsBridge }).nextmuxDesktop
): () => void {
    if (!bridge?.onWindowFocusChange || !inactiveWindowButtonsSupported(bridge.macosMajor)) return () => undefined;
    const discs = doc.createElement('div');
    discs.className = 'nmx-inactive-window-buttons';
    discs.setAttribute('aria-hidden', 'true');
    discs.append(doc.createElement('i'), doc.createElement('i'), doc.createElement('i'));
    doc.body.appendChild(discs);
    const apply = (state: FocusState | undefined): void => {
        if (!state) return;
        doc.body.classList.toggle(WINDOW_INACTIVE_CLASS, state.focused === false);
        doc.body.classList.toggle(WINDOW_FULLSCREEN_CLASS, state.fullScreen === true);
    };
    const unsubscribe = bridge.onWindowFocusChange(apply);
    void bridge.getWindowFocusState?.().then(apply, () => undefined);
    return () => {
        unsubscribe();
        discs.remove();
        doc.body.classList.remove(WINDOW_INACTIVE_CLASS, WINDOW_FULLSCREEN_CLASS);
    };
}
