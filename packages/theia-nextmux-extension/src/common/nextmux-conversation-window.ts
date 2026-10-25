import { ConversationDomainError } from './nextmux-conversation-domain-errors';

/** Field deltas keep a draft/model change separate from another window's stream updates. */
export type WindowRecord = Record<string, unknown>;
export interface ConversationWindowDelta {
    id: string;
    set: WindowRecord;
    unset: string[];
    turns?: { upserts: { id: string; set: WindowRecord; unset: string[] }[]; removed: string[]; order?: string[] };
}
const blocked = new Set(['__proto__', 'prototype', 'constructor']);
const record = (value: unknown): WindowRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as WindowRecord : {};
function fields(before: WindowRecord, after: WindowRecord, skip = ''): { set: WindowRecord; unset: string[] } {
    const set: WindowRecord = {}, unset: string[] = [];
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (blocked.has(key) || key === skip) continue;
        if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
        if (after[key] === undefined) unset.push(key); else set[key] = after[key];
    }
    return { set, unset };
}
export function conversationWindowDelta(beforeValue: unknown, afterValue: unknown): ConversationWindowDelta | undefined {
    const before = record(beforeValue), after = record(afterValue);
    if (typeof after.id !== 'string') return undefined;
    const delta: ConversationWindowDelta = { id: after.id, ...fields(before, after, 'turns') };
    const oldTurns = new Map((Array.isArray(before.turns) ? before.turns : []).map(item => [String(record(item).id), record(item)]));
    const nextTurns = (Array.isArray(after.turns) ? after.turns : []).map(record);
    const upserts = nextTurns.flatMap(turn => {
        const change = fields(oldTurns.get(String(turn.id)) || {}, turn);
        return Object.keys(change.set).length || change.unset.length ? [{ id: String(turn.id), ...change }] : [];
    });
    const nextOrder = nextTurns.map(turn => String(turn.id));
    const ids = new Set(nextOrder);
    const removed = [...oldTurns.keys()].filter(id => !ids.has(id));
    const defaultOrder = [...[...oldTurns.keys()].filter(id => ids.has(id)), ...upserts.map(item => item.id).filter(id => !oldTurns.has(id))];
    const orderChanged = nextOrder.length !== defaultOrder.length || nextOrder.some((id, index) => id !== defaultOrder[index]);
    if (upserts.length || removed.length || orderChanged) {
        delta.turns = { upserts, removed, ...(orderChanged ? { order: nextOrder } : {}) };
    }
    return Object.keys(delta.set).length || delta.unset.length || delta.turns ? delta : undefined;
}
export function applyConversationWindowDelta(value: unknown, delta: ConversationWindowDelta): WindowRecord {
    const apply = (current: WindowRecord, change: { set?: WindowRecord; unset?: string[] }): WindowRecord => {
        const next = { ...current };
        for (const key of Array.isArray(change.unset) ? change.unset : []) if (!blocked.has(key)) delete next[key];
        for (const [key, field] of Object.entries(record(change.set))) if (!blocked.has(key)) next[key] = field;
        return next;
    };
    const next = apply(record(value), delta);
    if (delta.turns && typeof delta.turns === 'object') {
        const turns = new Map((Array.isArray(next.turns) ? next.turns : []).map(item => [String(record(item).id), record(item)]));
        const removed = Array.isArray(delta.turns.removed) ? delta.turns.removed : [];
        const upserts = Array.isArray(delta.turns.upserts) ? delta.turns.upserts : [];
        for (const id of removed) turns.delete(String(id));
        const existingIds = new Set(turns.keys());
        let order = [...turns.keys()];
        for (const change of upserts) {
            if (!change || typeof change.id !== 'string') continue;
            turns.set(change.id, apply(turns.get(change.id) || {}, change));
        }
        if (Array.isArray(delta.turns.order)) {
            const specified = delta.turns.order.map(String).filter(id => turns.has(id));
            const seen = new Set(specified);
            order = [...specified, ...[...turns.keys()].filter(id => !seen.has(id))];
        } else if (upserts.length) {
            const validUpserts = upserts.filter(change => change && typeof change.id === 'string');
            const upsertedExisting = validUpserts.map(change => change.id).filter(id => existingIds.has(id));
            if (upsertedExisting.length > 1) {
                let cursor = 0;
                const reorderedSet = new Set(upsertedExisting);
                order = order.map(id => reorderedSet.has(id) ? upsertedExisting[cursor++] : id);
            }
            for (let index = 0; index < validUpserts.length; index++) {
                const id = validUpserts[index].id;
                if (order.includes(id)) continue;
                const nextExisting = validUpserts.slice(index + 1).find(item => order.includes(item.id));
                if (nextExisting) {
                    order.splice(order.indexOf(nextExisting.id), 0, id);
                    continue;
                }
                const prevItem = index > 0 ? validUpserts[index - 1] : undefined;
                if (prevItem && order.includes(prevItem.id)) {
                    order.splice(order.indexOf(prevItem.id) + 1, 0, id);
                    continue;
                }
                order.push(id);
            }
        }
        next.turns = order.filter(id => turns.has(id)).map(id => turns.get(id)!);
    }
    // An empty new session has no turn edits, but every reconstructed session
    // still needs the array expected by history merging and rendering.
    if (!Array.isArray(next.turns)) next.turns = [];
    next.id = delta.id;
    return next;
}
/** Compact tile size; a width the user resized to replaces the default width. */
export const DEFAULT_CONVERSATION_TILE_WIDTH = 380;
export const DEFAULT_CONVERSATION_TILE_HEIGHT = 540;
export const MIN_CONVERSATION_TILE_WIDTH = 280;
export const MIN_CONVERSATION_TILE_HEIGHT = 320;
export const MAX_CONVERSATION_TILE_WIDTH = 1600;
export const MAX_CONVERSATION_TILE_HEIGHT = 1400;
/** A loaded, hidden detached window with no conversation yet; `assign` gives it one in place of a cold start. */
export const WARM_DETACHED_SESSION_ID = '__warm__';
export interface ConversationWindowEvent {
    type: 'delta' | 'windows' | 'flush' | 'hidden' | 'motion' | 'reclaiming' | 'reveal' | 'highlight' | 'assign';
    sessionId?: string;
    /** `assign`: the assigned conversation (empty for standby), as `nextmux:conversation:state` returns it. */
    sessions?: WindowRecord[];
    delta?: ConversationWindowDelta;
    removed?: string[];
    requestId?: string;
    primaryWindowId?: number;
    motion?: { kind: 'detach' | 'reclaim'; bounds: { x: number; y: number; width: number; height: number }; origin?: { x: number; y: number } };
    windows?: { sessionId: string; visible: boolean; running: boolean; owner: number }[];
    /** `reveal`: a `file:` URI opened in the conversation's detached window, which has no file drawer of its own;
     *  the main window shows it in its drawer. */
    fileUri?: string;
}
export interface ConversationWindowState {
    windowId: number;
    primaryWindowId?: number;
    syncDiagnostic?: true;
    sessionId: string;
    sessions: WindowRecord[];
    windows: NonNullable<ConversationWindowEvent['windows']>;
}
export type ConversationSyncDiagnosticEvent = 'init' | 'input' | 'draft_scheduled' | 'draft_timer' | 'draft_persisted'
    | 'publish_attempt' | 'publish_result' | 'receive_delta' | 'flush_start' | 'flush_end'
    | 'shutdown_start' | 'shutdown_end' | 'state' | 'publish_received' | 'flush_received'
    | 'quit_requested' | 'close_requested' | 'flush_ack';
export interface ConversationSyncDiagnostic {
    event: ConversationSyncDiagnosticEvent;
    ready?: boolean;
    primary?: boolean;
    dirty?: boolean;
    historyReady?: boolean;
    active?: boolean;
    historyLoaded?: boolean;
    changed?: boolean;
    saved?: boolean;
    debouncePending?: boolean;
    draftLength?: number;
    storedDraftLength?: number;
    sessionCount?: number;
    deltaCount?: number;
    removedCount?: number;
}
const syncDiagnosticEvents = new Set<string>(['init', 'input', 'draft_scheduled', 'draft_timer', 'draft_persisted',
    'publish_attempt', 'publish_result', 'receive_delta', 'flush_start', 'flush_end', 'shutdown_start', 'shutdown_end',
    'state', 'publish_received', 'flush_received', 'quit_requested', 'close_requested', 'flush_ack']);
const syncDiagnosticBooleans = new Set(['ready', 'primary', 'dirty', 'historyReady', 'active', 'historyLoaded', 'changed', 'saved', 'debouncePending']);
const syncDiagnosticCounts = new Set(['draftLength', 'storedDraftLength', 'sessionCount', 'deltaCount', 'removedCount']);
/** Diagnostics accept no free text, identifiers, accessors or undeclared fields. */
export function normalizeConversationSyncDiagnostic(value: unknown): ConversationSyncDiagnostic | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    try {
        const descriptors = Object.getOwnPropertyDescriptors(value);
        const event = descriptors.event?.value;
        if (typeof event !== 'string' || !syncDiagnosticEvents.has(event)) return undefined;
        const result: Record<string, string | number | boolean> = { event };
        for (const key of Reflect.ownKeys(descriptors)) {
            if (typeof key !== 'string') return undefined;
            const descriptor = descriptors[key];
            if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) return undefined;
            if (key === 'event') continue;
            const field = descriptor.value;
            if (syncDiagnosticBooleans.has(key)) {
                if (typeof field !== 'boolean') return undefined;
            } else if (syncDiagnosticCounts.has(key)) {
                if (typeof field !== 'number' || !Number.isInteger(field) || field < 0 || field > 1_000_000_000) return undefined;
            } else return undefined;
            result[key] = field;
        }
        return result as unknown as ConversationSyncDiagnostic;
    } catch {
        return undefined;
    }
}
/** Keep unacknowledged edits in order so a transient IPC failure can be retried. */
export class ConversationWindowPublisher {
    private readonly pending: { changes: ConversationWindowDelta[]; removed: string[] }[] = [];
    private operation: Promise<void> = Promise.resolve();
    publish(changes: ConversationWindowDelta[], removed: string[], send: (changes: ConversationWindowDelta[], removed: string[]) => Promise<boolean>): Promise<void> {
        if (changes.length || removed.length) this.pending.push({ changes, removed });
        this.operation = this.operation.catch(() => undefined).then(async () => {
            while (this.pending.length) {
                const next = this.pending[0];
                if (!await send(next.changes, next.removed)) throw new ConversationDomainError('CONVERSATION_WINDOW_SYNC_FAILED', 'window_sync_failed');
                this.pending.shift();
            }
        });
        return this.operation;
    }
}
export interface ConversationWorkArea {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export interface ConversationWindowBounds {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export interface ConversationDisplayWorkArea {
    readonly id?: string | number;
    readonly workArea: ConversationWorkArea;
}

export interface ConversationTileGridSpec {
    readonly cols: number;
    readonly rows: number;
    readonly capacity: number;
    readonly gap: number;
    readonly cellWidth: number;
    readonly cellHeight: number;
}

export function parseDetachedConversationLocation(search: string): string | undefined {
    try {
        const raw = typeof search === 'string' ? search : '';
        const query = raw.includes('?') ? raw.slice(raw.indexOf('?')) : raw;
        const value = new URLSearchParams(query).get('nextmuxConversation')?.trim();
        return value || undefined;
    } catch {
        return undefined;
    }
}

export function buildDetachedConversationSearch(search: string, sessionId: string): string {
    const params = new URLSearchParams(typeof search === 'string' && search.startsWith('?') ? search.slice(1) : (search || ''));
    params.set('nextmuxConversation', String(sessionId || '').trim());
    const serialized = params.toString();
    return serialized ? `?${serialized}` : '';
}

/** A usable remembered tile width (rounded), or undefined for the compact default. */
function preferredTileWidth(preferredWidth: number | undefined): number | undefined {
    return preferredWidth !== undefined && Number.isFinite(preferredWidth) && preferredWidth > 0 ? Math.round(preferredWidth) : undefined;
}

/** A usable remembered tile height (rounded), or undefined for the compact default. */
function preferredTileHeight(preferredHeight: number | undefined): number | undefined {
    return preferredHeight !== undefined && Number.isFinite(preferredHeight) && preferredHeight > 0 ? Math.round(preferredHeight) : undefined;
}

export function conversationTileGridSpec(
    workArea: ConversationWorkArea,
    _requestedCount?: number,
    preferredWidth?: number,
    preferredHeight?: number
): ConversationTileGridSpec {
    const gap = 10;
    let cols = workArea.width >= 3000 ? 4 : workArea.width >= 1360 ? 3 : workArea.width >= 760 ? 2 : 1;
    let rows = workArea.height >= 1260 ? 3 : workArea.height >= 700 ? 2 : 1;
    const preferred = preferredTileWidth(preferredWidth);
    if (preferred !== undefined) {
        // Wider tiles take fewer columns, so tiles of the remembered width never overlap.
        const targetW = Math.max(Math.min(MIN_CONVERSATION_TILE_WIDTH, workArea.width), Math.min(workArea.width - gap * 2, preferred));
        while (cols > 1 && Math.floor((workArea.width - gap * (cols + 1)) / cols) < targetW) cols--;
    }
    const preferredH = preferredTileHeight(preferredHeight);
    if (preferredH !== undefined) {
        // Taller tiles take fewer rows, so tiles of the remembered height never overlap.
        const targetH = Math.max(Math.min(MIN_CONVERSATION_TILE_HEIGHT, workArea.height), Math.min(workArea.height - gap * 2, preferredH));
        while (rows > 1 && Math.floor((workArea.height - gap * (rows + 1)) / rows) < targetH) rows--;
    }
    const capacity = Math.max(1, cols * rows);
    const maxColWidth = Math.max(1, Math.floor((workArea.width - gap * (cols + 1)) / cols));
    const maxRowHeight = Math.max(1, Math.floor((workArea.height - gap * (rows + 1)) / rows));
    const desiredWidth = preferred ?? DEFAULT_CONVERSATION_TILE_WIDTH;
    const desiredHeight = preferredH ?? DEFAULT_CONVERSATION_TILE_HEIGHT;
    const cellWidth = Math.max(Math.min(240, workArea.width), Math.min(workArea.width, maxColWidth, desiredWidth));
    const cellHeight = Math.max(Math.min(300, workArea.height), Math.min(workArea.height, maxRowHeight, desiredHeight));
    return { cols, rows, capacity, gap, cellWidth, cellHeight };
}

export function conversationTileCapacity(workArea: ConversationWorkArea, preferredWidth?: number, preferredHeight?: number): number {
    return conversationTileGridSpec(workArea, undefined, preferredWidth, preferredHeight).capacity;
}

export function conversationTileSlotBounds(
    workArea: ConversationWorkArea,
    slotIndex: number,
    gridCols?: number,
    gridRows?: number,
    preferredWidth?: number,
    preferredHeight?: number
): ConversationWindowBounds {
    const spec = conversationTileGridSpec(workArea, undefined, preferredWidth, preferredHeight);
    const cols = Math.max(1, Math.trunc(gridCols ?? spec.cols));
    const rows = Math.max(1, Math.trunc(gridRows ?? spec.rows));
    const gap = spec.gap;
    const capacity = cols * rows;
    const safeIndex = Math.max(0, Math.trunc(Number.isFinite(slotIndex) ? slotIndex : 0));
    const normalizedSlot = safeIndex % capacity;
    const cycle = Math.floor(safeIndex / capacity);
    const row = Math.floor(normalizedSlot / cols);
    const col = normalizedSlot % cols;

    const rawCellWidth = Math.max(1, Math.floor((workArea.width - gap * (cols + 1)) / cols));
    const rawCellHeight = Math.max(1, Math.floor((workArea.height - gap * (rows + 1)) / rows));
    const offset = Math.min(cycle * 24, 96);
    const shrink = cycle > 0 ? Math.min(offset, 48) : 0;

    const minW = Math.min(240, workArea.width);
    const minH = Math.min(300, workArea.height);
    // Tiles keep the compact (or remembered) size and sit side by side from the top left, 10px apart,
    // instead of stretching across the whole cell. Positions step by the full tile so cascaded overflow
    // tiles shift uniformly by `offset`.
    const desiredWidth = preferredTileWidth(preferredWidth) ?? DEFAULT_CONVERSATION_TILE_WIDTH;
    const desiredHeight = preferredTileHeight(preferredHeight) ?? DEFAULT_CONVERSATION_TILE_HEIGHT;
    const tileWidth = Math.max(minW, Math.min(workArea.width, Math.min(rawCellWidth, desiredWidth)));
    const tileHeight = Math.max(minH, Math.min(workArea.height, Math.min(rawCellHeight, desiredHeight)));
    const width = Math.max(minW, tileWidth - shrink);
    const height = Math.max(minH, tileHeight - shrink);

    const unclampedX = workArea.x + gap + col * (tileWidth + gap) + offset;
    const unclampedY = workArea.y + gap + row * (tileHeight + gap) + offset;
    const maxX = workArea.x + Math.max(0, workArea.width - width);
    const maxY = workArea.y + Math.max(0, workArea.height - height);
    const x = Math.max(workArea.x, Math.min(maxX, unclampedX));
    const y = Math.max(workArea.y, Math.min(maxY, unclampedY));
    return { x, y, width, height };
}

function isSlotOccupiedByWindow(slot: ConversationWindowBounds, win: ConversationWindowBounds): boolean {
    const cx = win.x + win.width / 2;
    const cy = win.y + win.height / 2;
    if (cx >= slot.x && cx <= slot.x + slot.width && cy >= slot.y && cy <= slot.y + slot.height) {
        return true;
    }
    const ix = Math.max(0, Math.min(win.x + win.width, slot.x + slot.width) - Math.max(win.x, slot.x));
    const iy = Math.max(0, Math.min(win.y + win.height, slot.y + slot.height) - Math.max(win.y, slot.y));
    const intersectionArea = ix * iy;
    const referenceArea = Math.max(1, Math.min(slot.width * slot.height, win.width * win.height));
    return intersectionArea >= 0.35 * referenceArea;
}

export function assignNonDestructiveTileSlots(
    displays: ReadonlyArray<ConversationDisplayWorkArea>,
    existingBounds: ReadonlyArray<ConversationWindowBounds>,
    newCount: number,
    preferredWidth?: number,
    preferredHeight?: number
): { bounds: ConversationWindowBounds; displayIndex: number; slotIndex: number }[] {
    const count = Math.max(0, Math.trunc(Number.isFinite(newCount) ? newCount : 0));
    if (count === 0) return [];
    const safeDisplays: ReadonlyArray<ConversationDisplayWorkArea> = displays.length > 0
        ? displays
        : [{ workArea: { x: 0, y: 0, width: 1440, height: 900 } }];

    const displayTables = safeDisplays.map((display, displayIndex) => {
        const spec = conversationTileGridSpec(display.workArea, undefined, preferredWidth, preferredHeight);
        const slots = Array.from({ length: spec.capacity }, (_, slotIndex) => {
            const bounds = conversationTileSlotBounds(display.workArea, slotIndex, spec.cols, spec.rows, preferredWidth, preferredHeight);
            const occupied = existingBounds.some(existing => isSlotOccupiedByWindow(bounds, existing));
            return { displayIndex, slotIndex, bounds, occupied };
        });
        return { display, spec, slots };
    });

    const results: { bounds: ConversationWindowBounds; displayIndex: number; slotIndex: number }[] = [];
    let overflowCounter = 0;

    for (let i = 0; i < count; i++) {
        let assigned: { bounds: ConversationWindowBounds; displayIndex: number; slotIndex: number } | undefined;
        for (const table of displayTables) {
            const freeSlot = table.slots.find(slot => !slot.occupied);
            if (freeSlot) {
                freeSlot.occupied = true;
                assigned = { bounds: freeSlot.bounds, displayIndex: freeSlot.displayIndex, slotIndex: freeSlot.slotIndex };
                break;
            }
        }
        if (!assigned) {
            const displayIndex = overflowCounter % displayTables.length;
            const table = displayTables[displayIndex];
            const slotIndex = table.spec.capacity + Math.floor(overflowCounter / displayTables.length);
            overflowCounter++;
            assigned = {
                bounds: conversationTileSlotBounds(table.display.workArea, slotIndex, table.spec.cols, table.spec.rows, preferredWidth, preferredHeight),
                displayIndex,
                slotIndex,
            };
        }
        results.push(assigned);
    }
    return results;
}

export function tileConversationBounds(workArea: ConversationWorkArea, count: number, preferredWidth?: number, preferredHeight?: number): ConversationWindowBounds[] {
    const safeCount = Math.max(0, Math.trunc(Number.isFinite(count) ? count : 0));
    return Array.from({ length: safeCount }, (_, index) => conversationTileSlotBounds(workArea, index, undefined, undefined, preferredWidth, preferredHeight));
}

export function conversationTileBounds(area: ConversationWorkArea, index: number, _count?: number, preferredWidth?: number, preferredHeight?: number): ConversationWindowBounds {
    return conversationTileSlotBounds(area, index, undefined, undefined, preferredWidth, preferredHeight);
}
