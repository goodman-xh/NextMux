import * as React from '@theia/core/shared/react';
import { createPortal } from '@theia/core/shared/react-dom';
import { notifyModalChromeChanged } from './nextmux-modal-chrome';

const THEME_CUSTOM_PROPS = [
    '--nmx-bg', '--nmx-panel', '--nmx-panel-2', '--nmx-panel-hover',
    '--nmx-border', '--nmx-border-strong', '--nmx-text', '--nmx-muted',
    '--nmx-accent', '--nmx-accent-soft', '--nmx-danger', '--nmx-color-scheme',
    '--cv-surface-0', '--cv-surface-1', '--cv-surface-2', '--cv-surface-3',
    '--cv-border', '--cv-border-strong', '--cv-text', '--cv-muted'
];

/**
 * Tracks whether the enclosing `.nmx-keepalive-host` is currently backgrounded (`.nmx-keepalive-hidden`).
 * Callers that portal overlays outside the host must render `<span ref={anchor} hidden />` in-place
 * and suppress their portal while `hidden` is true so backgrounded overlays never leak across sections.
 */
export function useKeepAliveHostHidden(): readonly [React.RefObject<HTMLSpanElement>, boolean] {
    const anchor = React.useRef<HTMLSpanElement>(null);
    const [hidden, setHidden] = React.useState(false);
    React.useLayoutEffect(() => {
        const host = anchor.current?.closest<HTMLElement>('.nmx-keepalive-host');
        if (!host) {
            setHidden(false);
            return;
        }
        const sync = (): void => {
            const next = host.classList.contains('nmx-keepalive-hidden');
            setHidden(prev => (prev === next ? prev : next));
        };
        sync();
        if (typeof MutationObserver === 'undefined') return;
        const observer = new MutationObserver(sync);
        observer.observe(host, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);
    React.useEffect(() => {
        notifyModalChromeChanged();
        return () => notifyModalChromeChanged();
    }, [hidden]);
    return [anchor, hidden] as const;
}

/** Canvas modal editors must sit above a form that has moved outside the desk's stacking context. */
export function CanvasModalLayer(props: { readonly locale: string; readonly children: React.ReactNode; readonly inPlace?: boolean; readonly initialFocusSelector?: string }): React.ReactElement {
    const anchor = React.useRef<HTMLSpanElement>(null), host = React.useRef<HTMLDialogElement>(null);
    const composing = React.useRef(false);
    const [previousFocus] = React.useState(() => document.activeElement);
    React.useLayoutEffect(() => {
        const source = anchor.current, target = host.current;
        if (!source || !target) return;
        const copyTheme = (): void => {
            const shell = source.closest<HTMLElement>('.nmx-shell') ?? document.querySelector<HTMLElement>('.nmx-shell');
            const style = getComputedStyle(source);
            for (let i = 0; i < style.length; i++) {
                const name = style[i];
                if (/^--(?:nmx-|cv-|theia-)/.test(name)) target.style.setProperty(name, style.getPropertyValue(name));
            }
            for (const name of THEME_CUSTOM_PROPS) {
                const val = style.getPropertyValue(name).trim();
                if (val) target.style.setProperty(name, val);
            }
            const isLight = Boolean(
                shell?.classList.contains('nmx-theme-light')
                || style.getPropertyValue('--nmx-color-scheme').trim() === 'light'
            );
            const isDark = Boolean(
                shell?.classList.contains('nmx-theme-dark')
                || (!isLight && style.getPropertyValue('--nmx-color-scheme').trim() === 'dark')
            );
            target.classList.toggle('nmx-theme-light', isLight);
            target.classList.toggle('nmx-theme-dark', isDark);
            target.style.colorScheme = isLight ? 'light' : isDark ? 'dark' : style.colorScheme || 'dark';
            target.style.fontFamily = style.fontFamily; target.style.fontSize = style.fontSize; target.style.color = style.color;
        };
        const keepAliveHost = source.closest<HTMLElement>('.nmx-keepalive-host');
        const focusDialog = (): void => {
            // React autoFocus can run while the native dialog is still closed.
            const initial = props.initialFocusSelector ? target.querySelector<HTMLElement>(props.initialFocusSelector) : undefined;
            initial?.focus({ preventScroll: true });
            if (!target.contains(document.activeElement)) {
                const dialog = target.querySelector<HTMLElement>('[role="dialog"]') ?? target;
                if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;
                dialog.focus({ preventScroll: true });
            }
        };
        const syncVisibility = (): void => {
            const hidden = Boolean(keepAliveHost?.classList.contains('nmx-keepalive-hidden'));
            target.hidden = hidden;
            if (hidden) {
                if (target.open) target.close();
            } else {
                copyTheme();
                if (!target.open) {
                    target.showModal();
                    focusDialog();
                }
            }
            notifyModalChromeChanged();
        };
        syncVisibility();
        const shellTarget = source.closest('.nmx-shell') ?? document.body;
        const observer = new MutationObserver(() => {
            if (!keepAliveHost?.classList.contains('nmx-keepalive-hidden')) copyTheme();
            syncVisibility();
        });
        observer.observe(shellTarget, { attributes: true, attributeFilter: ['class', 'style'] });
        if (keepAliveHost && keepAliveHost !== shellTarget) {
            observer.observe(keepAliveHost, { attributes: true, attributeFilter: ['class'] });
        }
        return () => {
            observer.disconnect();
            if (target.open) target.close();
            notifyModalChromeChanged();
        };
    }, []);
    React.useEffect(() => () => {
        if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    }, [previousFocus]);
    const layer = <dialog ref={host} className='nmx-desktop-widget nmx-board-modal-layer'
        lang={props.locale} dir={props.locale === 'ar' ? 'rtl' : 'ltr'} onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
        onCompositionStartCapture={() => { composing.current = true; }} onCompositionEndCapture={() => { composing.current = false; }}
        onCancel={event => { event.preventDefault(); if (composing.current) return; const dialog = event.currentTarget.querySelector<HTMLElement>('[role=dialog]'); dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); }}
        onKeyDown={event => event.stopPropagation()}
        onKeyDownCapture={event => {
            if (event.key === 'Escape' && (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)) {
                event.preventDefault(); event.stopPropagation(); return;
            }
            if (event.key !== 'Tab' || event.nativeEvent.isComposing) return;
            const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')]
                .filter(element => element.getClientRects().length > 0);
            const index = controls.indexOf(document.activeElement as HTMLElement);
            if (index < 0 || event.shiftKey && index === 0 || !event.shiftKey && index === controls.length - 1) {
                event.preventDefault(); event.stopPropagation(); (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
            }
        }}>{props.children}</dialog>;
    // Native top-layer isolation also works in place, preserving ancestor-scoped styles.
    return <><span ref={anchor} hidden />{props.inPlace ? layer : createPortal(layer, document.body)}</>;
}
