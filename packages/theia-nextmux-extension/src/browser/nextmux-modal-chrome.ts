/**
 * Keep window chrome under modal overlays.
 *
 * Every modal backdrop covers the whole web page, including the HTML title
 * bar and its window controls that Windows (and Linux with the custom title
 * bar) use. macOS is different: its close/minimise/zoom buttons are drawn
 * natively above the page, so while a modal is open the main process hides
 * them. Any element with aria-modal="true" or a known overlay class counts,
 * so new dialogs are covered without registering them.
 */
export const MODAL_SELECTOR = '[aria-modal="true"], .nmx-dialog-backdrop, .nmx-attachment-lightbox, .nmx-project-memory-backdrop, .dialogOverlay';
/** Side drawers stop below the app's top bar, which stays usable, so they leave the window chrome alone. */
export const DRAWER_SELECTOR = '.nmx-sheet-backdrop:not(.nmx-dialog-backdrop), .nmx-mc-drawer-backdrop';
export const MODAL_OPEN_CLASS = 'nmx-modal-open';

/**
 * The area a modal really covers: its fixed-position overlay if it sits in one, else itself. Only an overlay that
 * reaches the window's top edge covers the window controls (macOS traffic lights top left, the Windows buttons top
 * right). A dialog kept inside the workspace below the top bar (the comic 制作台, round 33) leaves them usable, and
 * hiding them there left a comic window with no close button for as long as the studio was open.
 */
function overlayRect(element: HTMLElement): DOMRect {
    const view = element.ownerDocument.defaultView;
    for (let node: HTMLElement | null = element; node && node !== element.ownerDocument.body; node = node.parentElement) {
        if (view?.getComputedStyle(node).position === 'fixed') return node.getBoundingClientRect();
    }
    return element.getBoundingClientRect();
}

export function modalIsOpen(root: ParentNode): boolean {
    for (const element of Array.from(root.querySelectorAll<HTMLElement>(MODAL_SELECTOR))) {
        if (element.closest(DRAWER_SELECTOR) || element.getClientRects().length === 0) continue;
        if (overlayRect(element).top <= 1) return true;
    }
    return false;
}

export function installModalChrome(
    doc: Document = document,
    setChrome: (open: boolean) => unknown = open => (window as Window & { nextmuxDesktop?: { setModalChrome?: (value: boolean) => Promise<unknown> } }).nextmuxDesktop?.setModalChrome?.(open)
): () => void {
    let open = false, scheduled = false, disposed = false;
    const view = doc.defaultView;
    const sync = (): void => {
        scheduled = false;
        if (disposed) return;
        const next = modalIsOpen(doc);
        if (next === open) return;
        open = next;
        doc.body.classList.toggle(MODAL_OPEN_CLASS, open);
        try { Promise.resolve(setChrome(open)).catch(() => undefined); } catch { /* the host bridge is optional */ }
    };
    // Mutations are coalesced to one check per frame, so streaming output costs a single query per frame at most.
    const schedule = (): void => {
        if (scheduled) return;
        scheduled = true;
        (view?.requestAnimationFrame ?? ((callback: () => void) => setTimeout(callback, 16)))(sync);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal', 'class', 'hidden', 'style'] });
    // Responsive overlays can cross the top bar when the window is resized without any DOM mutation.
    view?.addEventListener('resize', schedule);
    sync();
    return () => {
        disposed = true;
        observer.disconnect();
        view?.removeEventListener('resize', schedule);
        if (open) { doc.body.classList.remove(MODAL_OPEN_CLASS); try { Promise.resolve(setChrome(false)).catch(() => undefined); } catch { /* optional */ } }
    };
}
