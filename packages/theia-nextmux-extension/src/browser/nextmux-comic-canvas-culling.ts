/**
 * Pure viewport culling geometry and pending inline-edit flush registry for Comic Canvas & Comic Desk.
 * Kept DOM-free so culling math and flush lifecycle can be unit-tested directly in Node.
 */

export const DEFAULT_CANVAS_CULL_OVERSCAN_PX = 300;
export const DEFAULT_CANVAS_CULL_EXIT_OVERSCAN_PX = 600;
export const CANVAS_CULL_PAN_THRESHOLD_PX = 120;
export const CANVAS_CULL_ZOOM_THRESHOLD_RATIO = 0.1;

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
    readonly cullOverscanPx?: number;
    readonly previouslyCulledIds?: ReadonlySet<string>;
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
 * When `previouslyCulledIds` is supplied, applies hysteresis: previously culled nodes stay
 * culled until entering `overscanPx` (300px), and visible nodes stay visible until leaving
 * `cullOverscanPx` (600px).
 */
export function computeCulledCanvasNodeIds(options: ComputeCulledCanvasNodesOptions): Set<string> {
    const uncullOverscan = options.overscanPx ?? DEFAULT_CANVAS_CULL_OVERSCAN_PX;
    const bounds = computeCanvasViewportWorldBounds(options.viewport, options.viewportSize, uncullOverscan);
    const culled = new Set<string>();
    if (!bounds) return culled;

    const { previouslyCulledIds } = options;
    const exitOverscan = options.cullOverscanPx ?? Math.max(uncullOverscan, DEFAULT_CANVAS_CULL_EXIT_OVERSCAN_PX);
    const exitBounds = previouslyCulledIds && exitOverscan > uncullOverscan
        ? (computeCanvasViewportWorldBounds(options.viewport, options.viewportSize, exitOverscan) ?? bounds)
        : bounds;

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
        const rect = { x: node.position.x, y: node.position.y, width: node.size.width, height: node.size.height };
        const activeBounds = previouslyCulledIds && !previouslyCulledIds.has(node.id) ? exitBounds : bounds;
        if (!canvasRectIntersectsWorldBounds(rect, activeBounds)) {
            culled.add(node.id);
        }
    }
    return culled;
}

/** Return true when panning (>120px) or zooming (>10%) exceeds the viewport culling quantize threshold. */
export function shouldRecomputeCanvasCullingViewport(
    prev: CanvasCullingViewport | undefined,
    next: CanvasCullingViewport
): boolean {
    if (!prev) return true;
    if (Math.abs(next.x - prev.x) > CANVAS_CULL_PAN_THRESHOLD_PX) return true;
    if (Math.abs(next.y - prev.y) > CANVAS_CULL_PAN_THRESHOLD_PX) return true;
    if (!Number.isFinite(prev.zoom) || prev.zoom <= 0 || !Number.isFinite(next.zoom) || next.zoom <= 0) return true;
    return Math.abs(next.zoom - prev.zoom) / prev.zoom > CANVAS_CULL_ZOOM_THRESHOLD_RATIO;
}

/** Per-canvas external store with quantized viewport updates and 300px/600px hysteresis. */
export class CanvasCullingStore {
    private viewport: CanvasCullingViewport;
    private evaluatedViewport: CanvasCullingViewport | undefined;
    private viewportSize: CanvasCullingViewportSize = { width: 0, height: 0 };
    private nodes: readonly CanvasCullingNodeInput[] = [];
    private selectedIds: ReadonlySet<string> = new Set();
    private draggedIds: ReadonlySet<string> = new Set();
    private focusedIds: Set<string> = new Set();
    private editingIds: ReadonlySet<string> = new Set();
    private playingIds: Set<string> = new Set();
    private culledIds: Set<string> = new Set();
    private listeners: Map<string, Set<() => void>> = new Map();

    constructor(initialViewport: CanvasCullingViewport) {
        this.viewport = initialViewport.zoom > 0 ? initialViewport : { x: 0, y: 0, zoom: 1 };
    }

    isCulled(id: string): boolean {
        return this.culledIds.has(id);
    }

    subscribe(id: string, listener: () => void): () => void {
        let bucket = this.listeners.get(id);
        if (!bucket) {
            bucket = new Set();
            this.listeners.set(id, bucket);
        }
        bucket.add(listener);
        return () => {
            const current = this.listeners.get(id);
            if (!current) return;
            current.delete(listener);
            if (current.size === 0) this.listeners.delete(id);
        };
    }

    setViewport(viewport: CanvasCullingViewport): void {
        if (viewport.x === this.viewport.x && viewport.y === this.viewport.y && viewport.zoom === this.viewport.zoom) return;
        this.viewport = viewport;
        if (!shouldRecomputeCanvasCullingViewport(this.evaluatedViewport, viewport)) return;
        this.recompute();
    }

    setViewportSize(size: CanvasCullingViewportSize): void {
        if (size.width === this.viewportSize.width && size.height === this.viewportSize.height) return;
        this.viewportSize = size;
        this.recompute();
    }

    setInputs(inputs: {
        readonly nodes: readonly CanvasCullingNodeInput[];
        readonly selectedIds: ReadonlySet<string>;
        readonly draggedIds: ReadonlySet<string>;
        readonly editingIds: ReadonlySet<string>;
    }): void {
        this.nodes = inputs.nodes;
        this.selectedIds = inputs.selectedIds;
        this.draggedIds = inputs.draggedIds;
        this.editingIds = inputs.editingIds;
        const alive = new Set(inputs.nodes.map(node => node.id));
        for (const id of [...this.focusedIds]) if (!alive.has(id)) this.focusedIds.delete(id);
        for (const id of [...this.playingIds]) if (!alive.has(id)) this.playingIds.delete(id);
        this.recompute();
    }

    setFocusedIds(ids: ReadonlySet<string>): void {
        if (sameCulledNodeIdSet(this.focusedIds, ids)) return;
        this.focusedIds = new Set(ids);
        this.recompute();
    }

    setPlayingIds(ids: ReadonlySet<string>): void {
        if (sameCulledNodeIdSet(this.playingIds, ids)) return;
        this.playingIds = new Set(ids);
        this.recompute();
    }

    private recompute(): void {
        const hasValidBounds = Boolean(computeCanvasViewportWorldBounds(this.viewport, this.viewportSize, DEFAULT_CANVAS_CULL_OVERSCAN_PX));
        const next = computeCulledCanvasNodeIds({
            nodes: this.nodes,
            viewport: this.viewport,
            viewportSize: this.viewportSize,
            overscanPx: DEFAULT_CANVAS_CULL_OVERSCAN_PX,
            cullOverscanPx: DEFAULT_CANVAS_CULL_EXIT_OVERSCAN_PX,
            ...(this.evaluatedViewport ? { previouslyCulledIds: this.culledIds } : {}),
            selectedIds: this.selectedIds,
            draggedIds: this.draggedIds,
            focusedIds: this.focusedIds,
            editingIds: this.editingIds,
            playingIds: this.playingIds
        });
        if (hasValidBounds) this.evaluatedViewport = this.viewport;
        if (sameCulledNodeIdSet(this.culledIds, next)) return;
        const prev = this.culledIds;
        this.culledIds = next;
        const changed: string[] = [];
        for (const id of prev) if (!next.has(id)) changed.push(id);
        for (const id of next) if (!prev.has(id)) changed.push(id);
        for (const id of changed) {
            const bucket = this.listeners.get(id);
            if (!bucket) continue;
            for (const listener of [...bucket]) listener();
        }
    }
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
