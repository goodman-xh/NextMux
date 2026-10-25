/**
 * Bounded, conversation-scoped scroll state for the right-side file editor.
 *
 * The editor is recreated when a conversation or file changes. Keeping this
 * state outside Monaco means reopening a file does not reset the user's place,
 * while the bounds keep it safe to persist with conversation history.
 */

export const MAX_CONTEXT_FILE_SCROLL_POSITIONS = 32;
export const MAX_CONTEXT_FILE_SCROLL_OFFSET = 50_000_000;

export interface ContextFileScrollPosition {
    readonly top: number;
    readonly left: number;
}

export type ContextFileScrollPositions = Readonly<Record<string, ContextFileScrollPosition>>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function validFileKey(value: string): boolean {
    return value.length > 0 && value.length <= 32_768
        && !/[\u0000-\u001f\u007f-\u009f]/.test(value)
        && value !== '__proto__' && value !== 'constructor' && value !== 'prototype';
}

function boundedOffset(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0, Math.min(MAX_CONTEXT_FILE_SCROLL_OFFSET, value)) : 0;
}

function definePosition(target: Record<string, ContextFileScrollPosition>, key: string, position: ContextFileScrollPosition): void {
    // defineProperty keeps even a hostile persisted key from changing the
    // prototype of the result object.
    Object.defineProperty(target, key, {
        value: position,
        enumerable: true,
        configurable: true,
        writable: true
    });
}

export function normalizeContextFileScrollPositions(value: unknown): ContextFileScrollPositions {
    if (!isRecord(value)) return {};
    const result: Record<string, ContextFileScrollPosition> = {};
    for (const [uri, candidate] of Object.entries(value)) {
        if (!validFileKey(uri) || !isRecord(candidate)) continue;
        definePosition(result, uri, {
            top: boundedOffset(candidate.top),
            left: boundedOffset(candidate.left)
        });
        if (Object.keys(result).length >= MAX_CONTEXT_FILE_SCROLL_POSITIONS) break;
    }
    return result;
}

export function contextFileScrollPosition(
    positions: ContextFileScrollPositions | undefined,
    uri: string
): ContextFileScrollPosition | undefined {
    if (!positions || !validFileKey(uri) || !Object.prototype.hasOwnProperty.call(positions, uri)) return undefined;
    const candidate = positions[uri];
    return candidate ? {
        top: boundedOffset(candidate.top),
        left: boundedOffset(candidate.left)
    } : undefined;
}

export function updateContextFileScrollPosition(
    positions: ContextFileScrollPositions | undefined,
    uri: string,
    top: number,
    left: number
): ContextFileScrollPositions {
    const normalized = normalizeContextFileScrollPositions(positions);
    if (!validFileKey(uri)) return normalized;
    const next: Record<string, ContextFileScrollPosition> = {};
    for (const [key, value] of Object.entries(normalized)) {
        if (key !== uri) definePosition(next, key, value);
    }
    definePosition(next, uri, { top: boundedOffset(top), left: boundedOffset(left) });
    const entries = Object.entries(next).slice(-MAX_CONTEXT_FILE_SCROLL_POSITIONS);
    const bounded: Record<string, ContextFileScrollPosition> = {};
    for (const [key, value] of entries) definePosition(bounded, key, value);
    return bounded;
}
