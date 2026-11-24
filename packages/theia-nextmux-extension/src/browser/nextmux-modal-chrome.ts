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

const SHELL_SELECTOR = '.nmx-shell';
const SHELL_BACKDROP_SELECTOR = '[aria-modal="true"], [class*="-backdrop"]';
const MODAL_HOST_CONTAINER_SELECTOR = '.nmx-shell, .nmx-board-modal-layer, .nmx-mc-drawer-layer';
const SKIP_SUBTREE_SELECTOR = '#nmx-workspace, .nmx-board:not(.nmx-board-modal-layer), .react-flow, .xterm, .monaco-editor, .nmx-task-view';
/**
 * A section kept mounted out of sight (Comic left for Coding, the closed work-context drawer) shows nothing, yet
 * still answers layout queries (content-visibility lays a subtree out when script asks), so a dialog left open
 * inside it would keep the window controls hidden on the section now on screen.
 */
const HIDDEN_KEEPALIVE_SELECTOR = '.nmx-keepalive-hidden';
const insideHiddenKeepAlive = (element: Element): boolean => typeof element.closest === 'function' && Boolean(element.closest(HIDDEN_KEEPALIVE_SELECTOR));

const activeChromeTriggers = new Set<() => void>();
let registeredOverlayCount = 0;

/** Notifies active modal chrome controllers to re-evaluate open modal state on the next frame. */
export function notifyModalChromeChanged(): void {
    for (const trigger of activeChromeTriggers) trigger();
}

/** Tracks explicit React modal host overlays without waiting on broad DOM mutation scans. */
export function registerModalChromeOverlay(active: boolean): void {
    if (active) registeredOverlayCount += 1;
    else registeredOverlayCount = Math.max(0, registeredOverlayCount - 1);
    notifyModalChromeChanged();
}

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
        if (element.closest(DRAWER_SELECTOR) || insideHiddenKeepAlive(element) || element.getClientRects().length === 0) continue;
        if (overlayRect(element).top <= 1) return true;
    }
    return false;
}

function shellHasVisibleBackdropOrModal(shell: Element): boolean {
    if (typeof shell.querySelectorAll !== 'function') return false;
    for (const element of Array.from(shell.querySelectorAll<HTMLElement>(SHELL_BACKDROP_SELECTOR))) {
        if (!insideHiddenKeepAlive(element) && element.getClientRects().length > 0) return true;
    }
    return false;
}

function toggleModalChromeClasses(doc: Document, open: boolean): void {
    doc.body?.classList?.toggle(MODAL_OPEN_CLASS, open);
    if (typeof doc.querySelectorAll === 'function') {
        for (const shell of Array.from(doc.querySelectorAll(SHELL_SELECTOR))) {
            const hasModal = open || registeredOverlayCount > 0 || shellHasVisibleBackdropOrModal(shell);
            shell.classList?.toggle('has-modal', hasModal);
        }
    }
}

export function installModalChrome(
    doc: Document = document,
    setChrome: (open: boolean) => unknown = open => (window as Window & { nextmuxDesktop?: { setModalChrome?: (value: boolean) => Promise<unknown> } }).nextmuxDesktop?.setModalChrome?.(open)
): () => void {
    let open = false, scheduled = false, disposed = false;
    const view = doc.defaultView;
    const observedContainers = new WeakSet<Node>();
    const observedModals = new WeakSet<Element>();
    let containerObserver: MutationObserver | undefined;
    let modalAttrObserver: MutationObserver | undefined;

    const observeContainer = (node: Node | null | undefined): void => {
        if (!node || !containerObserver || observedContainers.has(node)) return;
        observedContainers.add(node);
        containerObserver.observe(node, { childList: true, subtree: false });
    };

    const attachModalAttributeObservers = (): void => {
        if (!modalAttrObserver || typeof doc.querySelectorAll !== 'function') return;
        for (const element of Array.from(doc.querySelectorAll(`${MODAL_SELECTOR}, ${SHELL_SELECTOR} ${SHELL_BACKDROP_SELECTOR}`))) {
            if (observedModals.has(element)) continue;
            if (typeof element.closest === 'function' && element.closest('.react-flow')) continue;
            observedModals.add(element);
            modalAttrObserver.observe(element, {
                attributes: true,
                attributeFilter: ['aria-modal', 'class', 'hidden', 'style', 'open'],
                subtree: false
            });
        }
    };

    const attachContainerPath = (rootNode: Node): void => {
        if (!containerObserver) return;
        const element = rootNode instanceof Element ? rootNode : null;
        if (element && typeof element.matches === 'function' && element.matches(SKIP_SUBTREE_SELECTOR)) return;
        observeContainer(rootNode);
        if (element && typeof element.matches === 'function' && element.matches(SHELL_SELECTOR)) {
            return;
        }
        if (element && typeof element.querySelectorAll === 'function') {
            for (const target of Array.from(element.querySelectorAll(MODAL_HOST_CONTAINER_SELECTOR))) {
                observeContainer(target);
            }
            const theiaShell = element.querySelector('#theia-app-shell');
            if (theiaShell) attachTheiaWrapperChain(theiaShell);
        }
    };

    const attachTheiaWrapperChain = (node: Element): void => {
        if (!containerObserver) return;
        if (typeof node.matches === 'function' && node.matches(SKIP_SUBTREE_SELECTOR)) return;
        observeContainer(node);
        if (typeof node.matches === 'function' && node.matches(MODAL_HOST_CONTAINER_SELECTOR)) return;
        for (const child of Array.from(node.children || [])) {
            attachTheiaWrapperChain(child);
        }
    };

    const sync = (): void => {
        scheduled = false;
        if (disposed) return;
        attachModalAttributeObservers();
        const next = registeredOverlayCount > 0 || modalIsOpen(doc);
        toggleModalChromeClasses(doc, next);
        if (next === open) return;
        open = next;
        try { Promise.resolve(setChrome(open)).catch(() => undefined); } catch { /* the host bridge is optional */ }
    };

    // Mutations are coalesced to one check per frame, so streaming or layout changes cost a single query per frame at most.
    const schedule = (): void => {
        if (scheduled || disposed) return;
        scheduled = true;
        (view?.requestAnimationFrame ?? ((callback: () => void) => setTimeout(callback, 16)))(sync);
    };

    activeChromeTriggers.add(schedule);

    if (typeof MutationObserver !== 'undefined') {
        containerObserver = new MutationObserver(records => {
            for (const record of records) {
                for (const added of Array.from(record.addedNodes || [])) {
                    if (added.nodeType === 1) {
                        const el = added as Element;
                        if (typeof el.matches === 'function' && (
                            el.matches(MODAL_HOST_CONTAINER_SELECTOR)
                            || el.id === 'theia-app-shell'
                            || el.id === 'theia-main-content-panel'
                            || el.classList?.contains('lm-Widget')
                            || el.classList?.contains('nmx-desktop-widget')
                        )) {
                            attachContainerPath(el);
                        }
                    }
                }
            }
            schedule();
        });
        modalAttrObserver = new MutationObserver(schedule);
        if (doc.body) {
            attachContainerPath(doc.body);
            const theiaShell = typeof doc.querySelector === 'function' ? doc.querySelector('#theia-app-shell') : null;
            if (theiaShell) attachTheiaWrapperChain(theiaShell);
            if (typeof doc.querySelectorAll === 'function') {
                for (const host of Array.from(doc.querySelectorAll(MODAL_HOST_CONTAINER_SELECTOR))) {
                    observeContainer(host);
                }
            }
        }
    }

    // Responsive overlays can cross the top bar when the window is resized without any DOM mutation.
    view?.addEventListener('resize', schedule);
    sync();
    return () => {
        disposed = true;
        activeChromeTriggers.delete(schedule);
        containerObserver?.disconnect();
        modalAttrObserver?.disconnect();
        view?.removeEventListener('resize', schedule);
        if (open) {
            toggleModalChromeClasses(doc, false);
            try { Promise.resolve(setChrome(false)).catch(() => undefined); } catch { /* optional */ }
        }
    };
}
