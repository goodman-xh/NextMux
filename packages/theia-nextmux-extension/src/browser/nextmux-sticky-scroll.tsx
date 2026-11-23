import * as React from '@theia/core/shared/react';
import * as ReactDOM from '@theia/core/shared/react-dom';

/**
 * Floating sticky horizontal scrollbar modeled after Ant Design's `rc-table/src/stickyScrollBar.tsx`:
 * - Uses `position: fixed` aligned to the horizontal bounds of the scrollable table container.
 * - Automatically hides when there is no horizontal overflow OR when the native bottom scrollbar is
 *   already visible inside the scroll viewport (so a user never sees two bars at once).
 * - Syncs `scrollLeft` bidirectionally with RTL (`dir="rtl"`) awareness, ResizeObserver, MutationObserver,
 *   and passive scroll listeners on nearest vertical scroll ancestors + `window`.
 */

export interface StickyScrollMetrics {
    readonly visible: boolean;
    readonly left: number;
    readonly bottom: number;
    readonly width: number;
    readonly thumbWidth: number;
    readonly thumbLeft: number;
    readonly isRtl: boolean;
    readonly maxScroll: number;
}

const HIDDEN_METRICS: StickyScrollMetrics = {
    visible: false,
    left: 0,
    bottom: 0,
    width: 0,
    thumbWidth: 0,
    thumbLeft: 0,
    isRtl: false,
    maxScroll: 0
};

const MIN_THUMB_WIDTH = 28;
const BAR_EDGE_MARGIN = 6;

export interface StickyMetricsInput {
    readonly rectLeft: number;
    readonly rectRight: number;
    readonly rectTop: number;
    readonly rectBottom: number;
    readonly scrollWidth: number;
    readonly clientWidth: number;
    readonly scrollLeft: number;
    readonly clipLeft: number;
    readonly clipRight: number;
    readonly clipTop: number;
    readonly clipBottom: number;
    readonly viewportHeight: number;
    readonly isRtl: boolean;
}

/** Pure geometry calculation exposed for deterministic unit tests and shared by React + imperative hosts. */
export function computeStickyScrollMetrics(input: StickyMetricsInput): StickyScrollMetrics {
    const maxScroll = input.scrollWidth - input.clientWidth;
    if (!(maxScroll > 1) || !(input.clientWidth > 0)) return HIDDEN_METRICS;

    const visibleTop = Math.max(input.rectTop, input.clipTop);
    const visibleBottom = Math.min(input.rectBottom, input.clipBottom);
    const nativeScrollbarAlreadyInView = input.rectBottom <= input.clipBottom + 2;
    if (nativeScrollbarAlreadyInView || visibleBottom - visibleTop < 28) return HIDDEN_METRICS;

    const left = Math.max(input.rectLeft, input.clipLeft);
    const right = Math.min(input.rectRight, input.clipRight);
    const width = Math.max(0, right - left);
    if (width < 48) return HIDDEN_METRICS;

    const thumbWidth = Math.min(width, Math.max(MIN_THUMB_WIDTH, Math.round((input.clientWidth / input.scrollWidth) * width)));
    const trackRange = Math.max(0, width - thumbWidth);
    const ratio = input.isRtl
        ? Math.max(0, Math.min(1, -input.scrollLeft / maxScroll))
        : Math.max(0, Math.min(1, input.scrollLeft / maxScroll));
    const thumbLeft = input.isRtl
        ? Math.round((1 - ratio) * trackRange)
        : Math.round(ratio * trackRange);
    const bottom = Math.max(BAR_EDGE_MARGIN, Math.round(input.viewportHeight - input.clipBottom + BAR_EDGE_MARGIN));

    return {
        visible: true,
        left: Math.round(left),
        bottom,
        width: Math.round(width),
        thumbWidth,
        thumbLeft,
        isRtl: input.isRtl,
        maxScroll
    };
}

function verticalScrollAncestors(element: HTMLElement): HTMLElement[] {
    const ancestors: HTMLElement[] = [];
    let current = element.parentElement;
    while (current) {
        const style = typeof window.getComputedStyle === 'function' ? window.getComputedStyle(current) : undefined;
        const overflowY = style?.overflowY || '';
        const overflowX = style?.overflowX || '';
        if (/(auto|scroll|overlay)/.test(overflowY) || /(auto|scroll|overlay|hidden|clip)/.test(overflowX)) {
            ancestors.push(current);
        }
        current = current.parentElement;
    }
    return ancestors;
}

/**
 * Where the fixed bar layer lives: inside the NextMux shell that holds the table (not a portaled picker surface), so
 * the shell's dialogs and backdrops cover it and its CSS hides it while one is open, body-level pickers and menus stay
 * above it, and the --nmx-* theme tokens apply. On document.body it painted above every in-app dialog and could still be
 * dragged behind one. The shell has no transform, filter or containment, so `position: fixed` still measures from the
 * window. Outside a shell (or before mount) it falls back to the body.
 */
function stickyLayerParent(element: Element | null | undefined): HTMLElement {
    const shell = element?.closest('.nmx-shell:not(.nmx-model-picker-surface)');
    return shell instanceof HTMLElement ? shell : document.body;
}

function measureStickyTarget(target: HTMLElement, ancestors: readonly HTMLElement[]): StickyScrollMetrics {
    const rect = target.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement?.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0;
    let clipLeft = 0;
    let clipTop = 0;
    let clipRight = viewportWidth;
    let clipBottom = viewportHeight;
    for (const ancestor of ancestors) {
        if (!ancestor.isConnected) continue;
        const box = ancestor.getBoundingClientRect();
        if (box.width <= 0 || box.height <= 0) continue;
        clipLeft = Math.max(clipLeft, box.left);
        clipTop = Math.max(clipTop, box.top);
        clipRight = Math.min(clipRight, box.right);
        clipBottom = Math.min(clipBottom, box.bottom);
    }
    const direction = typeof window.getComputedStyle === 'function' ? window.getComputedStyle(target).direction : 'ltr';
    return computeStickyScrollMetrics({
        rectLeft: rect.left,
        rectRight: rect.right,
        rectTop: rect.top,
        rectBottom: rect.bottom,
        scrollWidth: target.scrollWidth,
        clientWidth: target.clientWidth,
        scrollLeft: target.scrollLeft,
        clipLeft,
        clipRight,
        clipTop,
        clipBottom,
        viewportHeight,
        isRtl: direction === 'rtl'
    });
}

function resolveShellTheme(element: HTMLElement | null): 'light' | 'dark' {
    const shell = element?.closest('.nmx-shell');
    return shell?.classList.contains('nmx-theme-light') ? 'light' : 'dark';
}

function resolveScrollLeftFromRatio(ratio: number, maxScroll: number, isRtl: boolean): number {
    const clamped = Math.max(0, Math.min(1, ratio));
    return isRtl ? -clamped * maxScroll : clamped * maxScroll;
}

function createBarDragHandlers(
    getTarget: () => HTMLElement | null,
    getMetrics: () => StickyScrollMetrics,
    onDraggingChange: (dragging: boolean) => void
): {
    readonly onBarPointerDown: (event: React.PointerEvent<HTMLDivElement> | PointerEvent) => void;
    readonly onBarWheel: (event: React.WheelEvent<HTMLDivElement> | WheelEvent) => void;
} {
    const onBarPointerDown = (event: React.PointerEvent<HTMLDivElement> | PointerEvent): void => {
        const target = getTarget();
        const metrics = getMetrics();
        if (!target || !metrics.visible) return;
        const barElement = event.currentTarget as HTMLElement | null;
        if (!barElement) return;
        if (typeof event.button === 'number' && event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();

        const barRect = barElement.getBoundingClientRect();
        const trackRange = Math.max(1, metrics.width - metrics.thumbWidth);
        const targetNode = event.target as HTMLElement | null;
        const clickedThumb = Boolean(targetNode?.closest('.nmx-sticky-hscroll-thumb'));
        if (!clickedThumb) {
            const clickX = event.clientX - barRect.left - metrics.thumbWidth / 2;
            const ratio = Math.max(0, Math.min(1, clickX / trackRange));
            const nextRatio = metrics.isRtl ? 1 - ratio : ratio;
            target.scrollLeft = resolveScrollLeftFromRatio(nextRatio, metrics.maxScroll, metrics.isRtl);
        }

        const startX = event.clientX;
        const startScrollLeft = target.scrollLeft;
        onDraggingChange(true);

        const handleMove = (moveEvent: PointerEvent | MouseEvent): void => {
            const liveMetrics = getMetrics();
            const liveTarget = getTarget();
            if (!liveTarget || !liveMetrics.visible) return;
            const liveTrackRange = Math.max(1, liveMetrics.width - liveMetrics.thumbWidth);
            const deltaX = moveEvent.clientX - startX;
            const scrollDelta = (deltaX / liveTrackRange) * liveMetrics.maxScroll;
            if (liveMetrics.isRtl) {
                liveTarget.scrollLeft = Math.max(-liveMetrics.maxScroll, Math.min(0, startScrollLeft + scrollDelta));
            } else {
                liveTarget.scrollLeft = Math.max(0, Math.min(liveMetrics.maxScroll, startScrollLeft + scrollDelta));
            }
        };

        const handleUp = (): void => {
            onDraggingChange(false);
            window.removeEventListener('pointermove', handleMove);
            window.removeEventListener('pointerup', handleUp);
            window.removeEventListener('pointercancel', handleUp);
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('mouseup', handleUp);
        };

        window.addEventListener('pointermove', handleMove, { passive: true });
        window.addEventListener('pointerup', handleUp);
        window.addEventListener('pointercancel', handleUp);
        window.addEventListener('mousemove', handleMove, { passive: true });
        window.addEventListener('mouseup', handleUp);
    };

    const onBarWheel = (event: React.WheelEvent<HTMLDivElement> | WheelEvent): void => {
        const target = getTarget();
        if (!target) return;
        const delta = Math.abs(event.deltaX) >= Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        if (delta) target.scrollLeft += delta;
    };

    return { onBarPointerDown, onBarWheel };
}

export interface StickyHorizontalScrollProps {
    readonly children: React.ReactNode;
    readonly className?: string;
    /** CSS selector matching the actual scrollable descendant (e.g. `.nmx-usage-table-scroll` or `.nmx-billing-table`). */
    readonly targetSelector?: string;
}

/**
 * React wrapper attaching a fixed sticky horizontal scrollbar to the wrapped scrollable container.
 * Safe in SSR (`renderToStaticMarkup` renders only the host wrapper and children).
 */
export function StickyHorizontalScroll(props: StickyHorizontalScrollProps): React.ReactElement {
    const hostRef = React.useRef<HTMLDivElement | null>(null);
    const targetRef = React.useRef<HTMLElement | null>(null);
    const metricsRef = React.useRef<StickyScrollMetrics>(HIDDEN_METRICS);
    const [metrics, setMetrics] = React.useState<StickyScrollMetrics>(HIDDEN_METRICS);
    const [dragging, setDragging] = React.useState(false);
    const [theme, setTheme] = React.useState<'light' | 'dark'>('dark');

    React.useEffect(() => {
        if (typeof window === 'undefined' || typeof document === 'undefined') return;
        const host = hostRef.current;
        if (!host) return;
        const target = (props.targetSelector ? host.querySelector<HTMLElement>(props.targetSelector) : null)
            ?? (host.firstElementChild as HTMLElement | null)
            ?? host;
        targetRef.current = target;
        let ancestors = verticalScrollAncestors(target);
        let rafId = 0;

        const updateMetrics = (): void => {
            rafId = 0;
            if (!target.isConnected) {
                metricsRef.current = HIDDEN_METRICS;
                setMetrics(HIDDEN_METRICS);
                return;
            }
            const nextTheme = resolveShellTheme(host);
            setTheme(previous => previous === nextTheme ? previous : nextTheme);
            const next = measureStickyTarget(target, ancestors);
            const prev = metricsRef.current;
            if (prev.visible === next.visible
                && prev.left === next.left
                && prev.bottom === next.bottom
                && prev.width === next.width
                && prev.thumbWidth === next.thumbWidth
                && prev.thumbLeft === next.thumbLeft
                && prev.isRtl === next.isRtl
                && prev.maxScroll === next.maxScroll) {
                return;
            }
            metricsRef.current = next;
            setMetrics(next);
        };

        const scheduleMeasure = (): void => {
            if (rafId) return;
            rafId = window.requestAnimationFrame(updateMetrics);
        };

        const bindAncestorListeners = (): void => {
            for (const ancestor of ancestors) ancestor.removeEventListener('scroll', scheduleMeasure);
            ancestors = verticalScrollAncestors(target);
            for (const ancestor of ancestors) ancestor.addEventListener('scroll', scheduleMeasure, { passive: true });
        };

        bindAncestorListeners();
        target.addEventListener('scroll', scheduleMeasure, { passive: true });
        window.addEventListener('scroll', scheduleMeasure, { passive: true });
        window.addEventListener('resize', scheduleMeasure, { passive: true });

        const resizeObserver = typeof ResizeObserver === 'function'
            ? new ResizeObserver(() => scheduleMeasure())
            : undefined;
        resizeObserver?.observe(target);
        if (target.firstElementChild instanceof Element) resizeObserver?.observe(target.firstElementChild);

        const mutationObserver = typeof MutationObserver === 'function'
            ? new MutationObserver(() => {
                bindAncestorListeners();
                scheduleMeasure();
            })
            : undefined;
        mutationObserver?.observe(target, { childList: true, subtree: true });

        const shell = host.closest('.nmx-shell');
        const themeObserver = typeof MutationObserver === 'function' && shell
            ? new MutationObserver(() => scheduleMeasure())
            : undefined;
        themeObserver?.observe(shell!, { attributes: true, attributeFilter: ['class', 'dir'] });

        scheduleMeasure();

        return () => {
            if (rafId) window.cancelAnimationFrame(rafId);
            target.removeEventListener('scroll', scheduleMeasure);
            window.removeEventListener('scroll', scheduleMeasure);
            window.removeEventListener('resize', scheduleMeasure);
            for (const ancestor of ancestors) ancestor.removeEventListener('scroll', scheduleMeasure);
            resizeObserver?.disconnect();
            mutationObserver?.disconnect();
            themeObserver?.disconnect();
        };
    }, [props.targetSelector]);

    const handlers = React.useMemo(() => createBarDragHandlers(
        () => targetRef.current,
        () => metricsRef.current,
        setDragging
    ), []);

    return <>
        <div ref={hostRef} className={props.className ? `nmx-sticky-hscroll-host ${props.className}` : 'nmx-sticky-hscroll-host'}>
            {props.children}
        </div>
        {metrics.visible && typeof document !== 'undefined' && document.body
            ? ReactDOM.createPortal(
                <div className={`nmx-sticky-hscroll-layer nmx-theme-${theme}`} dir={metrics.isRtl ? 'rtl' : 'ltr'}>
                    <div
                        className={`nmx-sticky-hscroll-bar${dragging ? ' is-dragging' : ''}`}
                        role='scrollbar'
                        aria-orientation='horizontal'
                        aria-valuemin={0}
                        aria-valuemax={Math.round(metrics.maxScroll)}
                        aria-valuenow={Math.round(Math.abs(targetRef.current?.scrollLeft ?? 0))}
                        style={{
                            left: `${metrics.left}px`,
                            bottom: `${metrics.bottom}px`,
                            width: `${metrics.width}px`
                        }}
                        onPointerDown={handlers.onBarPointerDown as React.PointerEventHandler<HTMLDivElement>}
                        onWheel={handlers.onBarWheel as React.WheelEventHandler<HTMLDivElement>}
                    >
                        <div
                            className='nmx-sticky-hscroll-thumb'
                            style={{
                                width: `${metrics.thumbWidth}px`,
                                transform: `translate3d(${metrics.thumbLeft}px, 0, 0)`
                            }}
                        />
                    </div>
                </div>,
                stickyLayerParent(hostRef.current)
            )
            : null}
    </>;
}

interface ImperativeStickyController {
    sync(): void;
    dispose(): void;
}

const imperativeControllers = new WeakMap<HTMLElement, ImperativeStickyController>();
const activeImperativeControllers = new Set<ImperativeStickyController>();

function pruneDisconnectedImperativeControllers(): void {
    for (const controller of activeImperativeControllers) controller.sync();
}

/**
 * Imperatively attach a sticky horizontal scrollbar to an arbitrary scrollable element (e.g. `.nmx-md-table`
 * generated inside `innerHTML` by `ConversationMarkdown`). Safe to call repeatedly (`WeakMap`-idempotent).
 */
export function attachStickyHorizontalScroll(target: HTMLElement): () => void {
    const existing = imperativeControllers.get(target);
    if (existing) {
        existing.sync();
        return () => existing.dispose();
    }
    if (typeof window === 'undefined' || typeof document === 'undefined' || !document.body) return () => undefined;

    let disposed = false;
    let metrics = HIDDEN_METRICS;
    let ancestors = verticalScrollAncestors(target);
    let rafId = 0;

    const layer = document.createElement('div');
    layer.className = `nmx-sticky-hscroll-layer nmx-theme-${resolveShellTheme(target)}`;

    const bar = document.createElement('div');
    bar.className = 'nmx-sticky-hscroll-bar';
    bar.setAttribute('role', 'scrollbar');
    bar.setAttribute('aria-orientation', 'horizontal');

    const thumb = document.createElement('div');
    thumb.className = 'nmx-sticky-hscroll-thumb';
    bar.appendChild(thumb);
    layer.appendChild(bar);

    const handlers = createBarDragHandlers(
        () => target,
        () => metrics,
        dragging => bar.classList.toggle('is-dragging', dragging)
    );
    const onPointerDown = (event: PointerEvent): void => handlers.onBarPointerDown(event);
    const onWheel = (event: WheelEvent): void => handlers.onBarWheel(event);
    bar.addEventListener('pointerdown', onPointerDown);
    bar.addEventListener('wheel', onWheel, { passive: true });

    const applyMeasure = (): void => {
        rafId = 0;
        if (disposed || !target.isConnected) {
            dispose();
            return;
        }
        const theme = resolveShellTheme(target);
        layer.className = `nmx-sticky-hscroll-layer nmx-theme-${theme}`;
        const next = measureStickyTarget(target, ancestors);
        metrics = next;
        if (!next.visible) {
            if (layer.parentNode) layer.remove();
            return;
        }
        layer.dir = next.isRtl ? 'rtl' : 'ltr';
        if (!layer.parentNode) stickyLayerParent(target).appendChild(layer);
        bar.style.left = `${next.left}px`;
        bar.style.bottom = `${next.bottom}px`;
        bar.style.width = `${next.width}px`;
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuemax', String(Math.round(next.maxScroll)));
        bar.setAttribute('aria-valuenow', String(Math.round(Math.abs(target.scrollLeft))));
        thumb.style.width = `${next.thumbWidth}px`;
        thumb.style.transform = `translate3d(${next.thumbLeft}px, 0, 0)`;
    };

    const scheduleMeasure = (): void => {
        if (disposed || rafId) return;
        rafId = window.requestAnimationFrame(applyMeasure);
    };

    const bindAncestors = (): void => {
        for (const ancestor of ancestors) ancestor.removeEventListener('scroll', scheduleMeasure);
        ancestors = verticalScrollAncestors(target);
        for (const ancestor of ancestors) ancestor.addEventListener('scroll', scheduleMeasure, { passive: true });
    };

    bindAncestors();
    target.addEventListener('scroll', scheduleMeasure, { passive: true });
    window.addEventListener('scroll', scheduleMeasure, { passive: true });
    window.addEventListener('resize', scheduleMeasure, { passive: true });

    const resizeObserver = typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => scheduleMeasure())
        : undefined;
    resizeObserver?.observe(target);
    if (target.firstElementChild instanceof Element) resizeObserver?.observe(target.firstElementChild);

    const mutationObserver = typeof MutationObserver === 'function'
        ? new MutationObserver(() => {
            if (!target.isConnected) dispose();
            else {
                bindAncestors();
                scheduleMeasure();
            }
        })
        : undefined;
    mutationObserver?.observe(target, { childList: true, subtree: false });

    const shell = target.closest('.nmx-shell');
    const themeObserver = typeof MutationObserver === 'function' && shell
        ? new MutationObserver(() => scheduleMeasure())
        : undefined;
    themeObserver?.observe(shell!, { attributes: true, attributeFilter: ['class', 'dir'] });

    function dispose(): void {
        if (disposed) return;
        disposed = true;
        if (rafId) window.cancelAnimationFrame(rafId);
        bar.removeEventListener('pointerdown', onPointerDown);
        bar.removeEventListener('wheel', onWheel);
        target.removeEventListener('scroll', scheduleMeasure);
        window.removeEventListener('scroll', scheduleMeasure);
        window.removeEventListener('resize', scheduleMeasure);
        for (const ancestor of ancestors) ancestor.removeEventListener('scroll', scheduleMeasure);
        resizeObserver?.disconnect();
        mutationObserver?.disconnect();
        themeObserver?.disconnect();
        layer.remove();
        imperativeControllers.delete(target);
        activeImperativeControllers.delete(controller);
    }

    const controller: ImperativeStickyController = {
        sync: () => {
            if (!target.isConnected) dispose();
            else scheduleMeasure();
        },
        dispose
    };
    imperativeControllers.set(target, controller);
    activeImperativeControllers.add(controller);
    scheduleMeasure();
    return dispose;
}

/** Attach/refresh sticky horizontal scrollbars for every `.nmx-md-table` inside a rendered markdown element. */
export function syncStickyHorizontalScrollsIn(root: ParentNode | null | undefined): void {
    pruneDisconnectedImperativeControllers();
    if (!root || typeof root.querySelectorAll !== 'function') return;
    for (const element of root.querySelectorAll<HTMLElement>('.nmx-md-table')) {
        attachStickyHorizontalScroll(element);
    }
}
