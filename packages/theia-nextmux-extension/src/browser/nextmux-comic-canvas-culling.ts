/**
 * Pure viewport culling geometry and pending inline-edit flush registry for Comic Canvas & Comic Desk.
 * Kept DOM-free so culling math and flush lifecycle can be unit-tested directly in Node.
 */

export const DEFAULT_CANVAS_CULL_OVERSCAN_PX = 300;

export interface CanvasCullingViewport {
    readonly x: number;
    readonly y: number;
    readonly zoom: number;
}

export interface CanvasCullingViewportSize {
    readonly width: number;
    readonly height: number;
}

export interface CanvasCullingRect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export interface CanvasCullingNodeInput {
    readonly id: string;
    readonly position: { readonly x: number; readonly y: number };
    readonly size: { readonly width: number; readonly height: number };
}

export interface CanvasViewportWorldBounds {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
}

export interface ComputeCulledCanvasNodesOptions {
    readonly nodes: readonly CanvasCullingNodeInput[];
    readonly viewport: CanvasCullingViewport;
    readonly viewportSize: CanvasCullingViewportSize;
    readonly overscanPx?: number;
    readonly selectedIds?: ReadonlySet<string>;
    readonly draggedIds?: ReadonlySet<string>;
    readonly focusedIds?: ReadonlySet<string>;
    readonly editingIds?: ReadonlySet<string>;
    readonly playingIds?: ReadonlySet<string>;
}

/**
 * Convert the screen-space viewport rectangle plus screen overscan margin into world coordinates.
 * Returns `undefined` when the viewport or container size is invalid/unmeasured so nodes are never culled blindly.
 */
export function computeCanvasViewportWorldBounds(
    viewport: CanvasCullingViewport,
    viewportSize: CanvasCullingViewportSize,
    overscanPx = DEFAULT_CANVAS_CULL_OVERSCAN_PX
): CanvasViewportWorldBounds | undefined {
    if (
        !Number.isFinite(viewport.x)
        || !Number.isFinite(viewport.y)
        || !Number.isFinite(viewport.zoom)
        || viewport.zoom <= 0
        || !Number.isFinite(viewportSize.width)
        || !Number.isFinite(viewportSize.height)
        || viewportSize.width <= 0
        || viewportSize.height <= 0
    ) {
        return undefined;
    }
    const safeOverscan = Number.isFinite(overscanPx) && overscanPx > 0 ? overscanPx : 0;
    const worldMargin = safeOverscan / viewport.zoom;
    const left = (-viewport.x / viewport.zoom - worldMargin) || 0;
    const top = (-viewport.y / viewport.zoom - worldMargin) || 0;
    const right = ((-viewport.x + viewportSize.width) / viewport.zoom + worldMargin) || 0;
    const bottom = ((-viewport.y + viewportSize.height) / viewport.zoom + worldMargin) || 0;
    return { left, top, right, bottom };
}

/** Return true when `rect` overlaps `bounds` in world space. */
export function canvasRectIntersectsWorldBounds(rect: CanvasCullingRect, bounds: CanvasViewportWorldBounds): boolean {
    const width = Number.isFinite(rect.width) ? Math.max(0, rect.width) : 0;
    const height = Number.isFinite(rect.height) ? Math.max(0, rect.height) : 0;
    const intersectsX = width > 0
        ? rect.x < bounds.right && rect.x + width > bounds.left
        : rect.x <= bounds.right && rect.x >= bounds.left;
    const intersectsY = height > 0
        ? rect.y < bounds.bottom && rect.y + height > bounds.top
        : rect.y <= bounds.bottom && rect.y >= bounds.top;
    return intersectsX && intersectsY;
}

/**
 * Compute the set of offscreen canvas node IDs that should be marked `.is-culled`.
 * Follows tldraw-style exclusions: selected, dragged, focused, editing, or actively playing
 * media nodes are NEVER culled; offscreen generating/busy nodes MAY be culled.
 */
export function computeCulledCanvasNodeIds(options: ComputeCulledCanvasNodesOptions): Set<string> {
    const bounds = computeCanvasViewportWorldBounds(options.viewport, options.viewportSize, options.overscanPx);
    const culled = new Set<string>();
    if (!bounds) return culled;

    const { nodes, selectedIds, draggedIds, focusedIds, editingIds, playingIds } = options;
    for (const node of nodes) {
        if (
            selectedIds?.has(node.id)
            || draggedIds?.has(node.id)
            || focusedIds?.has(node.id)
            || editingIds?.has(node.id)
            || playingIds?.has(node.id)
        ) {
            continue;
        }
        const visible = canvasRectIntersectsWorldBounds(
            { x: node.position.x, y: node.position.y, width: node.size.width, height: node.size.height },
            bounds
        );
        if (!visible) {
            culled.add(node.id);
        }
    }
    return culled;
}

/** Fast structural equality helper for culled node ID sets. */
export function sameCulledNodeIdSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
    if (left === right) return true;
    if (left.size !== right.size) return false;
    for (const id of left) {
        if (!right.has(id)) return false;
    }
    return true;
}

const pendingCanvasEditFlushers = new Set<() => void>();
const attachedFlushWindows = new WeakSet<object>();
const attachedFlushDocuments = new WeakSet<object>();

function onVisibilityChangeFlush(): void {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        flushPendingCanvasEdits();
    }
}

/**
 * Idempotently attach global browser flush listeners (`nmx:flush-pending-edits`, `pagehide`,
 * `beforeunload`, `visibilitychange`). Safe no-op in SSR/Node environments.
 */
export function ensurePendingCanvasEditFlushListeners(): void {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function' && !attachedFlushWindows.has(window)) {
        attachedFlushWindows.add(window);
        window.addEventListener('nmx:flush-pending-edits', flushPendingCanvasEdits);
        window.addEventListener('pagehide', flushPendingCanvasEdits);
        window.addEventListener('beforeunload', flushPendingCanvasEdits);
    }
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function' && !attachedFlushDocuments.has(document)) {
        attachedFlushDocuments.add(document);
        document.addEventListener('visibilitychange', onVisibilityChangeFlush);
    }
}

ensurePendingCanvasEditFlushListeners();

/** Register a synchronous flush callback for an active inline editor and return its cleanup handle. */
export function registerPendingCanvasEditFlush(fn: () => void): () => void {
    ensurePendingCanvasEditFlushListeners();
    pendingCanvasEditFlushers.add(fn);
    return () => {
        pendingCanvasEditFlushers.delete(fn);
    };
}

/** Synchronously flush all mounted inline canvas/desk editors so no debounced edits are lost. */
export function flushPendingCanvasEdits(): void {
    for (const fn of [...pendingCanvasEditFlushers]) {
        try {
            fn();
        } catch {
            // Isolate individual editor flushes so one failure cannot prevent others from saving.
        }
    }
}
