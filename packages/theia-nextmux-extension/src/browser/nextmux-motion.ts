/**
 * Small motion primitives for the class-based desktop widget.
 *
 * `FlipList` is adapted from AutoAnimate (formkit/auto-animate, MIT,
 * Copyright 2022 FormKit Inc., src/index.ts: `remain`/`add`/`remove` keyframes
 * and the "re-insert the removed node absolutely and fade it" technique).
 * Differences for NextMux: items are keyed (`data-*` attributes) so an item
 * that React re-mounts under another parent (pinned ↔ project) still FLIPs,
 * nested keyed items subtract their keyed ancestor's motion, and positions are
 * cached only on DOM/resize events — no polling intervals or
 * IntersectionObservers, so an idle sidebar costs nothing.
 *
 * All helpers honour `prefers-reduced-motion` (Web Animations are not covered
 * by the stylesheet's reduced-motion override, so each call checks it).
 */

export const MOTION_EASE_OUT = 'cubic-bezier(.2, .8, .2, 1)';

export function prefersReducedMotion(): boolean {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Radix/shadcn `fade-in-0` for content that replaces other content in place. */
export function fadeInElement(element: Element | null | undefined, duration = 180): Animation | undefined {
    if (!element || prefersReducedMotion() || typeof (element as HTMLElement).animate !== 'function') return undefined;
    return (element as HTMLElement).animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing: 'ease-out' });
}

export interface FlipListOptions {
    /** Selector for animated items inside the container. */
    readonly selector: string;
    /** Stable identity of an item; items without one are ignored. */
    readonly keyOf: (element: HTMLElement) => string | undefined;
    /** Items inside these subtrees are skipped (virtualized lists position themselves). */
    readonly ignoreWithin?: string;
    readonly duration?: number;
    /** Above this many insertions in one commit (initial page load) skip enter fades. */
    readonly maxEnterAnimations?: number;
}

interface Position { readonly top: number; readonly left: number; readonly width: number; readonly height: number }

export class FlipList {
    protected container: HTMLElement | undefined;
    protected mutationObserver: MutationObserver | undefined;
    protected resizeObserver: ResizeObserver | undefined;
    protected positions = new Map<string, Position>();
    protected readonly running = new Map<HTMLElement, Animation>();
    protected refreshFrame = 0;
    protected readonly duration: number;

    constructor(protected readonly options: FlipListOptions) {
        this.duration = options.duration ?? 200;
    }

    get element(): HTMLElement | undefined {
        return this.container;
    }

    /** React ref callback: attach to the list container. */
    readonly ref = (element: HTMLElement | null): void => {
        if (element === this.container) return;
        this.detach();
        if (!element) return;
        this.container = element;
        this.positions = this.measure();
        this.mutationObserver = new MutationObserver(records => this.handle(records));
        this.mutationObserver.observe(element, { childList: true, subtree: true });
        if (typeof ResizeObserver === 'function') {
            this.resizeObserver = new ResizeObserver(() => this.scheduleRefresh());
            this.resizeObserver.observe(element);
        }
    };

    dispose(): void { this.detach(); }

    protected detach(): void {
        this.mutationObserver?.disconnect();
        this.resizeObserver?.disconnect();
        this.mutationObserver = undefined;
        this.resizeObserver = undefined;
        if (this.refreshFrame) cancelAnimationFrame(this.refreshFrame);
        this.refreshFrame = 0;
        for (const animation of this.running.values()) animation.cancel();
        this.running.clear();
        this.container = undefined;
        this.positions.clear();
    }

    protected items(): HTMLElement[] {
        if (!this.container) return [];
        const ignore = this.options.ignoreWithin;
        return [...this.container.querySelectorAll<HTMLElement>(this.options.selector)]
            .filter(element => !element.closest('[data-nmx-flip-ghost]') && (!ignore || !element.closest(ignore)));
    }

    /** Layout box relative to the container's scrolled content, ignoring running FLIP transforms. */
    protected measure(): Map<string, Position> {
        const result = new Map<string, Position>();
        const container = this.container;
        if (!container) return result;
        const origin = container.getBoundingClientRect();
        for (const element of this.items()) {
            const key = this.options.keyOf(element);
            if (!key) continue;
            const box = element.getBoundingClientRect();
            const offset = this.translation(element);
            result.set(key, { top: box.top - origin.top + container.scrollTop - offset.y,
                left: box.left - origin.left + container.scrollLeft - offset.x, width: box.width, height: box.height });
        }
        return result;
    }

    protected translation(element: HTMLElement): { x: number; y: number } {
        if (!this.running.has(element)) return { x: 0, y: 0 };
        const transform = getComputedStyle(element).transform;
        if (!transform || transform === 'none') return { x: 0, y: 0 };
        const matrix = new DOMMatrixReadOnly(transform);
        return { x: matrix.m41, y: matrix.m42 };
    }

    protected scheduleRefresh(): void {
        if (this.refreshFrame || !this.container) return;
        this.refreshFrame = requestAnimationFrame(() => {
            this.refreshFrame = 0;
            if (!this.running.size) this.positions = this.measure();
        });
    }

    protected isItem(node: Node): node is HTMLElement {
        return node instanceof HTMLElement && node.matches(this.options.selector)
            && (!this.options.ignoreWithin || !node.closest(this.options.ignoreWithin));
    }

    protected touchesItems(records: readonly MutationRecord[]): boolean {
        const selector = this.options.selector;
        const touches = (node: Node): boolean => node instanceof HTMLElement && (node.matches(selector) || Boolean(node.querySelector(selector)));
        return records.some(record => [...record.addedNodes, ...record.removedNodes].some(touches));
    }

    protected handle(records: readonly MutationRecord[]): void {
        const container = this.container;
        if (!container) return;
        // Ghost insertions/removals below are our own mutations.
        const external = records.filter(record => ![...record.addedNodes, ...record.removedNodes]
            .every(node => node instanceof HTMLElement && node.dataset.nmxFlipGhost === 'true'));
        if (!external.length) return;
        if (!this.touchesItems(external)) { this.scheduleRefresh(); return; }
        const previous = this.positions;
        // Interrupted FLIPs continue from where they visually are.
        const interrupted = new Map<string, { x: number; y: number }>();
        for (const [element, animation] of this.running) {
            const key = element.isConnected ? this.options.keyOf(element) : undefined;
            if (key) interrupted.set(key, this.translation(element));
            animation.cancel();
        }
        this.running.clear();
        const next = this.measure();
        this.positions = next;
        if (prefersReducedMotion()) return;
        const origin = container.getBoundingClientRect();
        const deltas = new Map<HTMLElement, { x: number; y: number }>();
        const items = this.items();
        const entering = items.filter(element => { const key = this.options.keyOf(element); return key && !previous.has(key); });
        const allowEnter = entering.length <= (this.options.maxEnterAnimations ?? 12);
        for (const element of items) {
            const key = this.options.keyOf(element);
            if (!key) continue;
            const before = previous.get(key), after = next.get(key);
            if (!after) continue;
            if (!before) {
                if (allowEnter) this.play(element, [
                    { transform: 'scale(.98)', opacity: 0 },
                    { transform: 'scale(.98)', opacity: 0, offset: .5 },
                    { transform: 'scale(1)', opacity: 1 }
                ], this.duration * 1.5, 'ease-in');
                continue;
            }
            const carried = interrupted.get(key) || { x: 0, y: 0 };
            let x = before.left + carried.x - after.left, y = before.top + carried.y - after.top;
            // A keyed ancestor already carries its subtree; move only the remainder.
            const ancestor = element.parentElement?.closest<HTMLElement>(this.options.selector);
            const inherited = ancestor && container.contains(ancestor) ? deltas.get(ancestor) : undefined;
            if (inherited) { x -= inherited.x; y -= inherited.y; }
            deltas.set(element, { x: x + (inherited?.x || 0), y: y + (inherited?.y || 0) });
            if (Math.abs(x) < .5 && Math.abs(y) < .5) continue;
            this.play(element, [{ transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' }], this.duration, 'ease-in-out');
        }
        let ghosts = 0;
        for (const record of external) {
            if (!(record.target instanceof HTMLElement) || !record.target.isConnected || !container.contains(record.target)) continue;
            for (const node of record.removedNodes) {
                if (!this.isItem(node) || node.isConnected) continue;
                const key = this.options.keyOf(node);
                const before = key ? previous.get(key) : undefined;
                if (!key || !before || next.has(key) || ++ghosts > (this.options.maxEnterAnimations ?? 12)) continue;
                this.ghost(node, record.target, before, origin);
            }
        }
    }

    protected play(element: HTMLElement, keyframes: Keyframe[], duration: number, easing: string): void {
        if (typeof element.animate !== 'function') return;
        const animation = element.animate(keyframes, { duration, easing });
        this.running.set(element, animation);
        const settle = (): void => {
            if (this.running.get(element) !== animation) return;
            this.running.delete(element);
            if (!this.running.size) this.scheduleRefresh();
        };
        animation.addEventListener('finish', settle, { once: true });
        animation.addEventListener('cancel', settle, { once: true });
    }

    /** AutoAnimate `remove`: put the removed node back, absolutely, and fade it out. */
    protected ghost(node: HTMLElement, parent: HTMLElement, before: Position, origin: DOMRect): void {
        const container = this.container!;
        node.dataset.nmxFlipGhost = 'true';
        node.setAttribute('aria-hidden', 'true');
        node.setAttribute('inert', '');
        Object.assign(node.style, { position: 'absolute', margin: '0', pointerEvents: 'none', zIndex: '1',
            width: `${before.width}px`, height: `${before.height}px`, top: '0px', left: '0px', transformOrigin: 'center' });
        parent.appendChild(node);
        const anchor = (node.offsetParent as HTMLElement | null) || container;
        const anchorBox = anchor.getBoundingClientRect();
        const viewportTop = origin.top - container.scrollTop + before.top;
        const viewportLeft = origin.left - container.scrollLeft + before.left;
        node.style.top = `${viewportTop - anchorBox.top + anchor.scrollTop - anchor.clientTop}px`;
        node.style.left = `${viewportLeft - anchorBox.left + anchor.scrollLeft - anchor.clientLeft}px`;
        if (typeof node.animate !== 'function') { node.remove(); return; }
        const animation = node.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.98)', opacity: 0 }],
            { duration: this.duration * .75, easing: 'ease-out' });
        const done = (): void => node.remove();
        animation.addEventListener('finish', done, { once: true });
        animation.addEventListener('cancel', done, { once: true });
    }
}
