/** Framework-free contracts for the desk's per-project canvas tabs. */
export interface ComicCanvasTabRecord {
    readonly id: string;
    readonly title: string;
    readonly kind: 'main' | 'free';
    readonly isOpen: boolean;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly deletedAt?: string;
    readonly deletionPending?: boolean;
}

export interface ComicCanvasTabsRegistry {
    readonly schemaVersion: 1;
    readonly revision: number;
    readonly projectId: string;
    readonly mainCanvasId: string;
    readonly canvases: readonly ComicCanvasTabRecord[];
}

export type ComicCanvasTabSaveState = 'saved' | 'dirty' | 'saving' | 'failed';

export interface ComicCanvasTabView extends ComicCanvasTabRecord {
    readonly active: boolean;
    readonly saveState: ComicCanvasTabSaveState;
    readonly loading: boolean;
    readonly error?: string;
    readonly notice?: string;
}

export interface CanvasTabKeyInput {
    readonly key: string;
    readonly isComposing?: boolean;
    readonly keyCode?: number;
    readonly ctrlKey?: boolean;
    readonly metaKey?: boolean;
    readonly altKey?: boolean;
    readonly editable?: boolean;
}

/** Arrow wrapping and Home/End follow the WAI-ARIA horizontal tabs pattern. */
export function comicCanvasTabKeyTarget(ids: readonly string[], activeId: string | undefined, input: CanvasTabKeyInput): string | undefined {
    if (!ids.length || input.isComposing || input.keyCode === 229 || input.editable || input.ctrlKey || input.metaKey || input.altKey) return undefined;
    const index = Math.max(0, ids.indexOf(activeId ?? ''));
    if (input.key === 'Home') return ids[0];
    if (input.key === 'End') return ids[ids.length - 1];
    if (input.key === 'ArrowLeft') return ids[(index + ids.length - 1) % ids.length];
    if (input.key === 'ArrowRight') return ids[(index + 1) % ids.length];
    return undefined;
}

export function comicCanvasTabNeedsCloseConfirmation(session: { readonly save: ComicCanvasTabSaveState; readonly saving?: unknown; readonly error?: string }): boolean {
    return session.save !== 'saved' || Boolean(session.saving) || Boolean(session.error);
}

/** A failed save leaves the active ID untouched. This contract never discards edits. */
export async function saveBeforeComicCanvasSwitch<T>(current: T | undefined, target: T, flush: (session: T) => Promise<void>, activate: (session: T) => Promise<void> | void): Promise<void> {
    if (current === target) return;
    if (current) await flush(current);
    await activate(target);
}

/** Result callbacks look up the captured owner, never whatever tab happens to be active now. */
export function ownedComicCanvasSession<T>(sessions: ReadonlyMap<string, T>, canvasId: string, expected?: T): T | undefined {
    const owner = sessions.get(canvasId);
    return expected === undefined || owner === expected ? owner : undefined;
}
