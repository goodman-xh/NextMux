import * as React from '@theia/core/shared/react';
import { createPortal } from '@theia/core/shared/react-dom';

/** Delegation includes portal menus and disabled buttons, without changing their click/keyboard handlers. */
export function SurfaceTooltips({ scope }: { readonly scope: string }): React.ReactElement | null {
    const [tip, setTip] = React.useState<{ text: string; anchor: HTMLElement; host: Element }>();
    const bubble = React.useRef<HTMLDivElement>(null);
    const id = React.useId();
    React.useLayoutEffect(() => {
        const element = bubble.current;
        if (!tip || !element) return;
        element.style.left = '0px'; element.style.top = '0px';
        const anchor = tip.anchor.getBoundingClientRect();
        const size = element.getBoundingClientRect();
        const margin = 8, gap = 8;
        // Bottom canvas controls always explain themselves above the capsule, as in Neowow.
        // Other tips choose the side using their measured height, rather than a guessed line count.
        const bottomControl = tip.anchor.closest('.nmx-board-navigation, .nmx-board-dock, .nmx-board-statistics');
        const above = Boolean(bottomControl) || anchor.bottom + gap + size.height > window.innerHeight - margin;
        const left = Math.max(margin, Math.min(window.innerWidth - size.width - margin, anchor.left + anchor.width / 2 - size.width / 2));
        const top = Math.max(margin, Math.min(window.innerHeight - size.height - margin, above ? anchor.top - gap - size.height : anchor.bottom + gap));
        // A native dialog can establish a containing block; compensate for its real origin.
        element.style.left = `${left - size.left}px`;
        element.style.top = `${top - size.top}px`;
        element.style.visibility = 'visible';
    }, [tip]);
    React.useEffect(() => {
        let active: HTMLElement | undefined, timer: ReturnType<typeof setTimeout> | undefined;
        let title: string | null = null, described: string | null = null;
        let ancestorTitles: Array<[HTMLElement, string]> = [];
        let anchorLeft = 0, anchorTop = 0;
        let changes: MutationObserver | undefined, resize: ResizeObserver | undefined;
        const label = (button: HTMLElement): string => (button.getAttribute('data-help') || button.getAttribute('title')
            || (button === active ? title : null) || button.getAttribute('aria-label')
            || button.getAttribute('aria-labelledby')?.split(/\s+/).map(key => document.getElementById(key)?.textContent?.trim() || '').filter(Boolean).join(' ')
            || button.textContent || '').trim();
        const clear = (): void => {
            if (timer) clearTimeout(timer);
            timer = undefined;
            changes?.disconnect(); resize?.disconnect(); changes = undefined; resize = undefined;
            if (active) {
                if (title !== null && !active.hasAttribute('title')) active.setAttribute('title', title);
                if (described === null) active.removeAttribute('aria-describedby'); else active.setAttribute('aria-describedby', described);
            }
            for (const [node, saved] of ancestorTitles) {
                if (!node.hasAttribute('title')) node.setAttribute('title', saved);
            }
            ancestorTitles = [];
            active = undefined; setTip(undefined);
        };
        const show = (target: EventTarget | null, immediate = false): void => {
            const button = target instanceof Element ? target.closest<HTMLElement>('button, summary, [role="button"], [role="menuitem"], [role="switch"], select[aria-label], [data-help], [title]') : null;
            if (!button || !button.closest(scope)) { clear(); return; }
            if (button === active) return;
            clear();
            const text = label(button);
            if (!text) return;
            const rect = button.getBoundingClientRect();
            anchorLeft = rect.left; anchorTop = rect.top;
            active = button; title = button.getAttribute('title'); described = button.getAttribute('aria-describedby');
            if (title !== null) button.removeAttribute('title');
            for (let parent = button.parentElement; parent && parent.closest(scope); parent = parent.parentElement) {
                const parentTitle = parent.getAttribute('title');
                if (parentTitle !== null) {
                    ancestorTitles.push([parent, parentTitle]);
                    parent.removeAttribute('title');
                }
            }
            // Observe only the hovered control, not playback updates across the whole editor.
            // React may update its action (Play/Pause, Mute/Unmute) without a mouseleave.
            changes = new MutationObserver(() => {
                if (!button.isConnected || !button.getClientRects().length) { clear(); return; }
                const updatedTitle = button.getAttribute('title');
                if (updatedTitle !== null) { title = updatedTitle; button.removeAttribute('title'); }
                const updated = label(button);
                if (!updated) { clear(); return; }
                setTip(current => current?.anchor === button && current.text !== updated ? { ...current, text: updated } : current);
            });
            changes.observe(button, { attributes: true, attributeFilter: ['title', 'aria-label', 'aria-labelledby', 'data-help', 'dir', 'lang'], childList: true, characterData: true, subtree: true });
            for (const key of button.getAttribute('aria-labelledby')?.split(/\s+/) || []) {
                const reference = document.getElementById(key);
                if (reference && !button.contains(reference)) changes.observe(reference, { childList: true, characterData: true, subtree: true });
            }
            resize = new ResizeObserver(() => {
                if (!button.isConnected || !button.getClientRects().length) clear();
            });
            resize.observe(button);
            timer = setTimeout(() => {
                timer = undefined;
                if (!button.isConnected || !button.getClientRects().length) { clear(); return; }
                button.setAttribute('aria-describedby', [described, id].filter(Boolean).join(' '));
                setTip({ text: label(button), anchor: button, host: button.closest('dialog[open]') ?? document.body });
            }, immediate ? 0 : 220);
        };
        const over = (event: MouseEvent): void => show(event.target);
        const out = (event: MouseEvent): void => {
            if (active?.contains(event.relatedTarget as Node | null)) return;
            if (event.target !== active && active?.isConnected && typeof active.matches === 'function' && active.matches(':hover')) return;
            clear();
        };
        const focus = (event: FocusEvent): void => show(event.target, true);
        const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') clear(); };
        const onScroll = (): void => {
            if (active?.isConnected) {
                const rect = active.getBoundingClientRect();
                if (Math.abs(rect.left - anchorLeft) < 0.5 && Math.abs(rect.top - anchorTop) < 0.5) return;
            }
            clear();
        };
        document.addEventListener('mouseover', over); document.addEventListener('mouseout', out);
        document.addEventListener('focusin', focus); document.addEventListener('focusout', clear);
        document.addEventListener('pointerdown', clear, true); document.addEventListener('keydown', key, true);
        window.addEventListener('scroll', onScroll, true); window.addEventListener('resize', clear);
        return () => { clear(); document.removeEventListener('mouseover', over); document.removeEventListener('mouseout', out);
            document.removeEventListener('focusin', focus); document.removeEventListener('focusout', clear);
            document.removeEventListener('pointerdown', clear, true); document.removeEventListener('keydown', key, true);
            window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', clear); };
    }, [scope, id]);
    return tip ? createPortal(<div ref={bubble} id={id} role='tooltip' className='nmx-surface-tooltip'
        dir={getComputedStyle(tip.anchor).direction} lang={tip.anchor.closest('[lang]')?.getAttribute('lang') || undefined}
        style={{ position: 'fixed', zIndex: 10000, pointerEvents: 'none', left: 0, top: 0, visibility: 'hidden', boxSizing: 'border-box',
            maxWidth: 'min(320px, calc(100vw - 16px))', maxHeight: 'calc(100vh - 16px)', overflow: 'hidden', padding: '8px 11px', borderRadius: 7, background: '#242424', color: '#fff', border: '1px solid #555',
            boxShadow: '0 4px 18px #0005', fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{tip.text}</div>, tip.host) : null;
}
