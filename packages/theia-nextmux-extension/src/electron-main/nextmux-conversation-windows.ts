import { injectable } from '@theia/core/shared/inversify';
import { ElectronMainApplication, ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import type { TheiaBrowserWindowOptions } from '@theia/core/lib/electron-main/theia-electron-window';
import { app, BrowserWindow, dialog, ipcMain, screen, systemPreferences, IpcMainInvokeEvent } from '@theia/core/electron-shared/electron';
import { randomUUID } from 'node:crypto';
import {
    applyConversationWindowDelta,
    assignNonDestructiveTileSlots,
    ConversationDisplayWorkArea,
    ConversationWindowBounds,
    ConversationWindowDelta,
    ConversationWindowEvent,
    conversationTileCapacity,
    DEFAULT_CONVERSATION_TILE_HEIGHT,
    DEFAULT_CONVERSATION_TILE_WIDTH,
    MAX_CONVERSATION_TILE_HEIGHT,
    MAX_CONVERSATION_TILE_WIDTH,
    MIN_CONVERSATION_TILE_HEIGHT,
    MIN_CONVERSATION_TILE_WIDTH,
    normalizeConversationSyncDiagnostic,
    WARM_DETACHED_SESSION_ID,
    WindowRecord
} from '../common/nextmux-conversation-window';

export const conversationCloseKey = Symbol.for('nextmux.conversation-window.close');
export const conversationQuitCancelledKey = Symbol.for('nextmux.conversation-window.quit-cancelled');
export const conversationQuitRequestKey = Symbol.for('nextmux.conversation-window.quit-request');
export const detachedConversationWindowKey = Symbol.for('nextmux.conversation-window.detached.v1');
export const primaryMainWindowKey = Symbol.for('nextmux.desktop.primary-main-window.v1');
export const showMainWindowKey = Symbol.for('nextmux.desktop.show-main.v1');
const isQuittingKey = Symbol.for('nextmux.desktop.is-quitting.v1');
/** Marks Theia's saved window state as written by a workbench window (nextmux-electron-main-module.ts). */
export const WORKBENCH_WINDOW_STATE_ROLE = 'workbench';

/** A detached conversation window or standby window: marked as soon as it is created (create below), loaded with `?nextmuxConversation=`. */
export function isDetachedConversationWindow(candidate: BrowserWindow | undefined): boolean {
    if (!candidate) return false;
    if ((candidate as unknown as Record<symbol, unknown>)[detachedConversationWindowKey]) return true;
    if (candidate.isDestroyed()) return false;
    try {
        return new URL(candidate.webContents.getURL()).searchParams.has('nextmuxConversation');
    } catch {
        return false;
    }
}

/**
 * Whether Theia's saved window state may size a main window that reopens. Only workbench windows save it now, and
 * mark it; an unmarked state of at most a tile's size (380 × 540) was left by a detached window of an earlier version.
 */
export function isRestorableWorkbenchWindowState(state: { readonly width?: unknown; readonly height?: unknown; readonly nextmuxWindowRole?: unknown }): boolean {
    if (state.nextmuxWindowRole === WORKBENCH_WINDOW_STATE_ROLE) return true;
    return !(typeof state.width === 'number' && typeof state.height === 'number'
        && state.width <= DEFAULT_CONVERSATION_TILE_WIDTH && state.height <= DEFAULT_CONVERSATION_TILE_HEIGHT);
}
let syncDiagnosticCount = 0;
const nativeSyncDiagnosticEvents = new Set(['state', 'publish_received', 'flush_received', 'quit_requested', 'close_requested', 'flush_ack']);
/** Beside Theia's own window state in the user data directory. */
const tilePreferencesFile = 'nextmux-conversation-window-prefs.json';
interface WindowEntry {
    window: BrowserWindow; sessionId: string; running: boolean; ready?: () => void; reclaimTimer?: ReturnType<typeof setTimeout>;
    /** Bounds this manager set: resize events until then, or at that size, are not the user's. */
    programmaticBoundsUntil?: number; lastProgrammaticWidth?: number; lastProgrammaticHeight?: number;
    /** A resize by hand (will-resize, macOS and Windows) is in progress until then. */
    manualResizeUntil?: number;
    /** The page finished loading: a standby window can take a conversation. */
    loaded?: boolean;
    /** The renderer asked for `nextmux:conversation:state`, confirming its React tree is hydrated. */
    stateHydrated?: boolean;
}

/** The main workbench remains the only durable history writer. Child windows share its backend. */
@injectable()
export class NextMuxConversationWindows implements ElectronMainApplicationContribution {
    private readonly syncDiagnosticEnabled = process.env.NEXTMUX_CONVERSATION_SYNC_DIAGNOSTIC === '1';
    private primary: BrowserWindow | undefined;
    private readonly workbenches = new Map<number, BrowserWindow>();
    private readonly windows = new Map<number, WindowEntry>();
    private readonly opening = new Map<string, Promise<BrowserWindow>>();
    private readonly sessions = new Map<string, WindowRecord>();
    private readonly flushes = new Map<string, (saved: boolean) => void>();
    private readonly workbenchRuns = new Map<string, number>();
    private readonly runOwners = new Map<string, number>();
    private readonly openings = new Set<Promise<BrowserWindow>>();
    private quitting = false;
    /** SIGTERM: quit without asking (see onStart). */
    private promptlessQuit = false;
    private quitCommitted = false;
    private quitTarget: BrowserWindow | undefined;
    private quitOperation: Promise<void> | undefined;
    private application!: ElectronMainApplication;
    /** The size the user last resized a conversation window to; new tiles take it (see recordUserResizedBounds). */
    private preferredTileWidth: number | undefined;
    private preferredTileHeight: number | undefined;
    private preferredTileWidthTimer: ReturnType<typeof setTimeout> | undefined;
    /** One hidden, loaded window waits for the next conversation, so a tile opens without starting a page. */
    private warmTimer: ReturnType<typeof setTimeout> | undefined;
    private readonly warmPoolEnabled = process.env.NEXTMUX_CONVERSATION_WARM_POOL !== '0';
    /** Standby pages that crashed or failed to load in a row; after three the pool stops refilling (tiles open cold). */
    private standbyFailures = 0;
    private reportSyncDiagnostic(window: BrowserWindow, payload: unknown, fromRenderer = false): boolean {
        if (!this.syncDiagnosticEnabled || syncDiagnosticCount >= 100 || window.isDestroyed()) return false;
        const diagnostic = normalizeConversationSyncDiagnostic(payload);
        if (!diagnostic || fromRenderer && nativeSyncDiagnosticEvents.has(diagnostic.event)) return false;
        const primaryWindowId = this.primary && !this.primary.isDestroyed() ? this.primary.webContents.id : undefined;
        syncDiagnosticCount++;
        try {
            console.info('[NextMux conversation sync diagnostic]', JSON.stringify({
                ...diagnostic, windowId: window.webContents.id,
                ...(primaryWindowId !== undefined ? { primaryWindowId } : {})
            }));
            return true;
        } catch {
            return false;
        }
    }
    private trusted(event: IpcMainInvokeEvent): BrowserWindow | undefined {
        if (event.senderFrame !== event.sender.mainFrame) return;
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window || window.isDestroyed()) return;
        try {
            const url = new URL(event.sender.getURL());
            if (url.protocol === 'file:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return window;
        } catch { /* invalid origin */ }
        return;
    }
    private prune(): void {
        for (const [windowId, entry] of this.windows) {
            if (entry.window.isDestroyed()) {
                clearTimeout(entry.reclaimTimer);
                this.windows.delete(windowId);
            }
        }
    }
    private orderedDisplays(referenceWindow?: BrowserWindow): ConversationDisplayWorkArea[] {
        const target = referenceWindow && !referenceWindow.isDestroyed() ? referenceWindow : this.primaryWindow;
        const primaryDisplay = target
            ? screen.getDisplayMatching(target.getBounds())
            : screen.getPrimaryDisplay();
        const allDisplays = typeof screen.getAllDisplays === 'function' ? screen.getAllDisplays() : [primaryDisplay];
        const ordered: ConversationDisplayWorkArea[] = [];
        const seen = new Set<string>();
        const pushDisplay = (display: { id?: string | number; workArea: { x: number; y: number; width: number; height: number } } | undefined): void => {
            if (!display?.workArea) return;
            const key = display.id !== undefined ? String(display.id) : `${display.workArea.x},${display.workArea.y},${display.workArea.width},${display.workArea.height}`;
            if (seen.has(key)) return;
            seen.add(key);
            ordered.push({ id: display.id, workArea: display.workArea });
        };
        pushDisplay(primaryDisplay);
        for (const display of allDisplays) pushDisplay(display);
        return ordered;
    }
    private getDisplayInfo(referenceWindow?: BrowserWindow): {
        displayCount: number;
        totalCapacity: number;
        displays: { id?: string | number; index: number; workArea: { x: number; y: number; width: number; height: number }; capacity: number }[];
    } {
        const ordered = this.orderedDisplays(referenceWindow);
        const displays = ordered.map((d, index) => ({
            id: d.id,
            index,
            workArea: d.workArea,
            capacity: conversationTileCapacity(d.workArea, this.preferredTileWidth, this.preferredTileHeight),
        }));
        return {
            displayCount: displays.length,
            totalCapacity: displays.reduce((sum, d) => sum + d.capacity, 0),
            displays,
        };
    }
    private moveWindowToNextDisplay(event: IpcMainInvokeEvent, sessionId?: string): {
        moved: boolean;
        displayCount: number;
        displayIndex?: number;
        bounds?: ConversationWindowBounds;
    } {
        const senderWindow = this.trusted(event);
        if (!senderWindow || this.quitting) return { moved: false, displayCount: 0 };
        this.prune();
        const cleanId = typeof sessionId === 'string' ? sessionId.trim() : '';
        const targetEntry = cleanId
            ? [...this.windows.values()].find(item => item.sessionId === cleanId && !item.window.isDestroyed())
            : this.windows.get(senderWindow.webContents.id);
        const allDisplays = typeof screen.getAllDisplays === 'function' ? screen.getAllDisplays() : [];
        // Only a conversation window moves into a tile: a main window is never squeezed to tile size,
        // and a standby window stays hidden.
        if (!targetEntry || targetEntry.sessionId === WARM_DETACHED_SESSION_ID || targetEntry.window.isDestroyed() || allDisplays.length <= 1) {
            return { moved: false, displayCount: allDisplays.length };
        }
        const targetWindow = targetEntry.window;
        const currentDisplay = screen.getDisplayMatching(targetWindow.getBounds());
        const currentIndex = Math.max(
            0,
            allDisplays.findIndex(d => d.id === currentDisplay.id || (d.workArea.x === currentDisplay.workArea.x && d.workArea.y === currentDisplay.workArea.y))
        );
        const nextIndex = (currentIndex + 1) % allDisplays.length;
        const nextDisplay = allDisplays[nextIndex];
        const otherBounds = [...this.windows.values()]
            .filter(entry => entry.window !== targetWindow && !entry.window.isDestroyed() && entry.window.isVisible())
            .map(entry => entry.window.getBounds());
        const [slot] = assignNonDestructiveTileSlots([{ id: nextDisplay.id, workArea: nextDisplay.workArea }], otherBounds, 1, this.preferredTileWidth, this.preferredTileHeight);
        if (targetWindow.isFullScreen()) targetWindow.setFullScreen(false);
        if (targetWindow.isMaximized()) targetWindow.unmaximize();
        this.applyProgrammaticBounds(targetEntry, slot.bounds,
            process.platform === 'darwin' && !systemPreferences.getAnimationSettings().prefersReducedMotion);
        targetWindow.show();
        targetWindow.focus();
        return { moved: true, displayCount: allDisplays.length, displayIndex: nextIndex, bounds: slot.bounds };
    }
    /** Standby windows have no conversation, so renderers never see them. */
    private entries(): NonNullable<ConversationWindowEvent['windows']> {
        return [...[...this.windows.values()].filter(entry => !entry.window.isDestroyed() && entry.sessionId !== WARM_DETACHED_SESSION_ID).map(entry => ({ sessionId: entry.sessionId,
            owner: entry.window.webContents.id, visible: entry.window.isVisible(), running: entry.running })),
            ...[...this.workbenchRuns].map(([sessionId, owner]) => ({ sessionId, owner, visible: false, running: true }))];
    }
    private send(event: ConversationWindowEvent, except?: number): void {
        if (event.type === 'windows') event = { ...event, primaryWindowId: this.primary && !this.primary.isDestroyed() ? this.primary.webContents.id : undefined };
        for (const window of [...this.workbenches.values(), ...[...this.windows.values()].map(entry => entry.window)]) {
            if (window.isDestroyed()) continue;
            const child = this.windows.get(window.webContents.id);
            if (event.delta && child && child.sessionId !== event.delta.id) continue;
            if (window.webContents.id !== except) window.webContents.send('nextmux:conversation:event', event);
        }
    }
    private notifyVisibility(): void {
        const visible = [...this.workbenches.values(), ...[...this.windows.values()].map(entry => entry.window)]
            .some(candidate => !candidate.isDestroyed() && candidate.isVisible());
        const hook = (app as unknown as Record<symbol, ((visible: boolean) => void) | undefined>)[Symbol.for('nextmux.desktop.visibility-changed.v1')];
        hook?.(visible);
    }
    private registerWorkbench(window: BrowserWindow): void {
        const id = window.webContents.id;
        if (this.workbenches.has(id)) return;
        this.workbenches.set(id, window);
        if (!this.primary || this.primary.isDestroyed()) this.primary = window;
        (window as unknown as Record<symbol, unknown>)[conversationCloseKey] = () => {
            this.reportSyncDiagnostic(window, { event: 'close_requested', primary: window === this.primary });
            if (this.quitting) return window !== this.quitTarget;
            if (window !== this.primary) return false;
            window.hide();
            this.notifyVisibility();
            return true;
        };
        window.on('show', () => this.notifyVisibility());
        window.on('hide', () => this.notifyVisibility());
        window.on('closed', () => this.forgetWorkbench(id, window));
        // A crashed page cannot save for the others: the writer role passes to a healthy window at once, and pending
        // saves are answered so their windows retry with the new writer (audit B19-05). Background runs keep their
        // owners; nothing is started again here.
        window.webContents.on('render-process-gone', () => {
            this.crashedWorkbenches.add(id);
            if (this.primary !== window) return;
            const healthy = [...this.workbenches.values()].find(candidate => candidate !== window && !candidate.isDestroyed() && !this.crashedWorkbenches.has(candidate.webContents.id));
            if (!healthy) return;
            this.primary = healthy;
            for (const finish of this.flushes.values()) finish(false);
            this.flushes.clear();
            this.send({ type: 'windows', windows: this.entries() });
        });
        window.webContents.on('did-finish-load', () => {
            this.crashedWorkbenches.delete(id);
            // Once the main window has loaded, a standby window loads behind it for the first tile.
            if (window === this.primary) this.scheduleWarmWindow(1200);
        });
        this.send({ type: 'windows', windows: this.entries() });
    }
    private readonly crashedWorkbenches = new Set<number>();
    private forgetWorkbench(id: number, window: BrowserWindow): void {
        this.workbenches.delete(id);
        this.crashedWorkbenches.delete(id);
        for (const [sessionId, owner] of this.workbenchRuns) if (owner === id) this.workbenchRuns.delete(sessionId);
        for (const [sessionId, owner] of this.runOwners) if (owner === id) this.runOwners.delete(sessionId);
        if (this.primary === window) {
            this.primary = [...this.workbenches.values()].find(candidate => !candidate.isDestroyed());
            // Receipts from the previous writer cannot acknowledge the
            // replacement writer's state. Callers can retry after the role event.
            for (const finish of this.flushes.values()) finish(false);
            this.flushes.clear();
        }
        this.send({ type: 'windows', windows: this.entries() });
    }
    get primaryWindow(): BrowserWindow | undefined {
        if (!this.primary || this.primary.isDestroyed()) {
            this.primary = [...this.workbenches.values()].find(candidate => !candidate.isDestroyed());
        }
        return this.primary && !this.primary.isDestroyed() ? this.primary : undefined;
    }
    onStart(application: ElectronMainApplication): void {
        this.application = application;
        void this.loadPreferredTileWidth();
        (app as unknown as Record<symbol, unknown>)[showMainWindowKey] = () => this.showPrimary();
        (app as unknown as Record<symbol, unknown>)[primaryMainWindowKey] = () => this.primaryWindow;
        (app as unknown as Record<symbol, unknown>)[isQuittingKey] = () => this.quitting;
        app.on('before-quit', event => {
            const window = this.primary && !this.primary.isDestroyed() ? this.primary
                : [...this.workbenches.values()].find(candidate => !candidate.isDestroyed());
            if (window) this.reportSyncDiagnostic(window, { event: 'quit_requested', primary: window === this.primary });
            if (this.quitCommitted) return;
            event.preventDefault();
            if (this.quitOperation) return;
            this.quitting = true;
            clearTimeout(this.warmTimer);
            this.warmTimer = undefined;
            this.flushPreferredTileWidth();
            // A running task is confirmed with a native dialog before any window starts its bounded save.
            this.quitOperation = this.confirmRunningQuit().then(confirmed => confirmed ? this.quitInOrder() : undefined).finally(() => {
                this.quitOperation = undefined;
                this.quitTarget = undefined;
                if (!this.quitCommitted) {
                    this.quitting = false;
                    // An abandoned quit may have closed the standby window.
                    this.scheduleWarmWindow(1200);
                }
            });
        });
        ipcMain.handle('nextmux:window:show-main', event => Boolean(this.trusted(event)) && this.showPrimary());
        // The page's own check (when the quit check above timed out on a busy page) asks with the same native
        // dialog. An in-page window.confirm blocked the whole page and, with nobody to answer, hung the quit.
        ipcMain.handle('nextmux:window:confirm-running-quit', async (event, payload: unknown) => {
            const window = this.trusted(event);
            if (!window) return false;
            if (this.promptlessQuit) return true;
            const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
            const text = (value: unknown, limit: number): string => typeof value === 'string' ? value.trim().slice(0, limit) : '';
            const texts = { title: text(record.title, 200), body: text(record.body, 600), quit: text(record.quit, 80), stay: text(record.stay, 80) };
            if (!texts.title || !texts.body || !texts.quit || !texts.stay || typeof dialog?.showMessageBox !== 'function') return true;
            if (window.isMinimized()) window.restore();
            window.show();
            window.focus();
            const result = await dialog.showMessageBox(window, { type: 'warning', buttons: [texts.quit, texts.stay], defaultId: 1, cancelId: 1, noLink: true, message: texts.title, detail: texts.body });
            return result.response === 0;
        });
        // A stop from the system or a tool (SIGTERM) quits with the usual bounded saves but asks nothing:
        // there is nobody to answer. If a save still hangs, the process ends after 15 seconds.
        if (typeof process.on === 'function') process.on('SIGTERM', () => {
            if (this.promptlessQuit) return;
            this.promptlessQuit = true;
            for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('nextmux:quit-confirmed');
            setTimeout(() => app.exit(0), 15_000).unref?.();
            app.quit();
        });
        // Window focus and full screen for the renderer's inactive window-button tint
        // (macOS light theme): the real window state, not the page's own focus.
        const sendFocus = (window: BrowserWindow): void => {
            if (window.isDestroyed() || typeof window.webContents?.send !== 'function') return;
            window.webContents.send('nextmux:window:focus', { focused: window.isFocused(), fullScreen: window.isFullScreen() });
        };
        if (typeof app.on === 'function') {
            app.on('browser-window-focus', (_event, window) => sendFocus(window));
            app.on('browser-window-blur', (_event, window) => sendFocus(window));
            app.on('browser-window-created', (_event, window) => {
                window.on('enter-full-screen', () => sendFocus(window));
                window.on('leave-full-screen', () => sendFocus(window));
            });
        }
        ipcMain.handle('nextmux:window:focus-state', event => {
            const window = this.trusted(event);
            return window ? { focused: window.isFocused(), fullScreen: window.isFullScreen() } : undefined;
        });
        // A modal in the renderer dims the whole window, but macOS draws the
        // traffic-light buttons natively above web content. Hide them while a
        // modal is open so the overlay really covers the window; restore after.
        ipcMain.handle('nextmux:window:modal-chrome', (event, open: unknown) => {
            const window = this.trusted(event);
            if (!window || typeof open !== 'boolean') return false;
            if (process.platform === 'darwin' && typeof window.setWindowButtonVisibility === 'function') window.setWindowButtonVisibility(!open);
            return true;
        });
        // Standard window shortcuts (⌘M, Window › Zoom) for a window whose native menu has no Window menu roles.
        ipcMain.handle('nextmux:window:minimize', event => {
            const window = this.trusted(event);
            if (!window || !window.isMinimizable()) return false;
            window.minimize();
            return true;
        });
        ipcMain.handle('nextmux:window:zoom', event => {
            const window = this.trusted(event);
            if (!window || window.isFullScreen()) return false;
            if (window.isMaximized()) window.unmaximize(); else window.maximize();
            return true;
        });
        ipcMain.handle('nextmux:window:close', event => {
            const window = this.trusted(event);
            if (!window) return false;
            window.close();
            return true;
        });
        ipcMain.handle('nextmux:conversation:sync-diagnostic', (event, payload: unknown) => {
            const window = this.trusted(event);
            return window ? this.reportSyncDiagnostic(window, payload, true) : false;
        });
        ipcMain.handle('nextmux:conversation:state', event => {
            const window = this.trusted(event);
            if (!window) return false;
            if (!this.windows.has(window.webContents.id) && !(window as unknown as Record<symbol, unknown>)[detachedConversationWindowKey]) {
                this.registerWorkbench(window);
            }
            (window as unknown as Record<symbol, unknown>)[conversationQuitCancelledKey] = () => { this.quitting = false; };
            const entry = this.windows.get(window.webContents.id);
            if (entry) {
                entry.stateHydrated = true;
                entry.ready?.();
                entry.ready = undefined;
            }
            const sessionId = this.windows.get(window.webContents.id)?.sessionId || '';
            this.reportSyncDiagnostic(window, { event: 'state', primary: window === this.primary, sessionCount: this.sessions.size });
            return { windowId: window.webContents.id, primaryWindowId: this.primary?.webContents.id, sessionId,
                ...(this.syncDiagnosticEnabled ? { syncDiagnostic: true as const } : {}),
                sessions: sessionId ? [this.sessions.get(sessionId)].filter(Boolean) : [...this.sessions.values()], windows: this.entries() };
        });
        ipcMain.handle('nextmux:conversation:publish', (event, deltas: ConversationWindowDelta[], removed: unknown = []) => {
            const window = this.trusted(event);
            if (!window || (!this.workbenches.has(window.webContents.id) && !this.windows.has(window.webContents.id)) || !Array.isArray(deltas)) return false;
            const removedIds = Array.isArray(removed) ? removed.filter((id): id is string => typeof id === 'string' && id !== WARM_DETACHED_SESSION_ID) : [];
            this.reportSyncDiagnostic(window, { event: 'publish_received', deltaCount: deltas.length,
                removedCount: removedIds.length });
            for (const delta of deltas) {
                if (!delta || typeof delta.id !== 'string' || !Array.isArray(delta.unset) || !delta.set || typeof delta.set !== 'object') return false;
                // The standby placeholder is never a conversation: nothing about it reaches history or other windows.
                if (delta.id === WARM_DETACHED_SESSION_ID) continue;
                if (!this.workbenches.has(window.webContents.id) && this.windows.get(window.webContents.id)?.sessionId !== delta.id) return false;
                this.sessions.set(delta.id, applyConversationWindowDelta(this.sessions.get(delta.id), delta));
                this.send({ type: 'delta', delta }, window.webContents.id);
            }
            if (removedIds.length && this.workbenches.has(window.webContents.id)) {
                for (const id of removedIds) this.sessions.delete(id);
                this.send({ type: 'delta', removed: removedIds }, window.webContents.id);
            }
            return true;
        });
        ipcMain.handle('nextmux:conversation:open', async (event, ids: string[], origin?: unknown) => {
            const parent = this.trusted(event);
            if (!parent || !Array.isArray(ids) || !this.primary || this.quitting) return false;
            this.prune();
            const candidateOrigin = origin && typeof origin === 'object' ? origin as { x?: unknown; y?: unknown } : undefined;
            const pointerOrigin = typeof candidateOrigin?.x === 'number' && Number.isFinite(candidateOrigin.x)
                && typeof candidateOrigin?.y === 'number' && Number.isFinite(candidateOrigin.y)
                ? { x: Math.max(-100_000, Math.min(100_000, Number(candidateOrigin!.x))),
                    y: Math.max(-100_000, Math.min(100_000, Number(candidateOrigin!.y))) }
                : undefined;
            const unique = [...new Set(ids)].filter(id => typeof id === 'string' && id !== WARM_DETACHED_SESSION_ID && this.sessions.has(id));
            if (!unique.length) return false;

            const alreadyVisibleEntries: WindowEntry[] = [];
            const newOrHiddenIds: string[] = [];
            for (const id of unique) {
                const existing = [...this.windows.values()].find(entry => entry.sessionId === id && !entry.window.isDestroyed());
                if (existing && existing.window.isVisible()) {
                    alreadyVisibleEntries.push(existing);
                } else {
                    newOrHiddenIds.push(id);
                }
            }

            // Restore/focus already-visible tiled windows in place without altering their bounds!
            for (const existing of alreadyVisibleEntries) {
                clearTimeout(existing.reclaimTimer);
                existing.reclaimTimer = undefined;
                if (existing.window.isMinimized()) existing.window.restore();
                existing.window.show();
                existing.window.focus();
                existing.window.flashFrame?.(true);
                existing.window.webContents.send('nextmux:conversation:highlight');
                existing.window.webContents.send('nextmux:conversation:event', { type: 'highlight', sessionId: existing.sessionId } satisfies ConversationWindowEvent);
                setTimeout(() => { if (!existing.window.isDestroyed()) existing.window.flashFrame?.(false); }, 900);
            }

            let opened: BrowserWindow | undefined = alreadyVisibleEntries[alreadyVisibleEntries.length - 1]?.window;
            if (newOrHiddenIds.length > 0) {
                const existingVisibleBounds = [...this.windows.values()]
                    .filter(entry => !entry.window.isDestroyed() && entry.window.isVisible())
                    .map(entry => entry.window.getBounds());
                const displays = this.orderedDisplays(parent);
                const totalCapacity = displays.reduce((sum, d) => sum + conversationTileCapacity(d.workArea, this.preferredTileWidth, this.preferredTileHeight), 0);
                const maxAllowedNew = Math.max(1, Math.max(6, totalCapacity) - existingVisibleBounds.length);
                const targetIds = newOrHiddenIds.slice(0, maxAllowedNew);
                const assignments = assignNonDestructiveTileSlots(displays, existingVisibleBounds, targetIds.length, this.preferredTileWidth, this.preferredTileHeight);
                const createdWindows = await Promise.all(
                    targetIds.map((id, index) => {
                        if (this.quitting) return Promise.resolve(undefined);
                        const opening = this.open(id, assignments[index]?.bounds);
                        this.openings.add(opening);
                        return opening.finally(() => this.openings.delete(opening));
                    })
                );
                const validOpened = createdWindows.filter((win): win is BrowserWindow => Boolean(win && !win.isDestroyed()));
                if (validOpened.length > 0) {
                    opened = validOpened[validOpened.length - 1];
                }
            }
            if (this.quitting) return false;
            this.send({ type: 'windows', windows: this.entries() });
            if (opened && !opened.isDestroyed()) {
                const bounds = opened.getBounds();
                const motion = pointerOrigin ? { kind: 'detach' as const, bounds, origin: pointerOrigin }
                    : { kind: 'detach' as const, bounds };
                this.primary.webContents.send('nextmux:conversation:event', { type: 'motion', motion } satisfies ConversationWindowEvent);
            }
            return true;
        });
        ipcMain.handle('nextmux:conversation:tile', (event, sessionIds?: unknown) => {
            const parent = this.trusted(event);
            if (!parent || this.quitting) return false;
            this.prune();
            const filterSet = Array.isArray(sessionIds) && sessionIds.length > 0
                ? new Set(sessionIds.filter((id): id is string => typeof id === 'string'))
                : undefined;
            const visibleEntries = [...this.windows.values()].filter(entry => !entry.window.isDestroyed() && entry.window.isVisible()
                && entry.sessionId !== WARM_DETACHED_SESSION_ID && (!filterSet || filterSet.has(entry.sessionId)));
            if (!visibleEntries.length) return false;
            const displays = this.orderedDisplays(parent);
            const assignments = assignNonDestructiveTileSlots(displays, [], visibleEntries.length, this.preferredTileWidth, this.preferredTileHeight);
            const animate = process.platform === 'darwin' && !systemPreferences.getAnimationSettings().prefersReducedMotion;
            visibleEntries.forEach((entry, index) => {
                if (entry.window.isFullScreen()) entry.window.setFullScreen(false);
                if (entry.window.isMaximized()) entry.window.unmaximize();
                if (assignments[index]) this.applyProgrammaticBounds(entry, assignments[index].bounds, animate);
            });
            return true;
        });
        ipcMain.handle('nextmux:conversation:display-info', event => {
            const window = this.trusted(event);
            if (!window) return { displayCount: 1, totalCapacity: 6, displays: [] };
            return this.getDisplayInfo(window);
        });
        ipcMain.handle('nextmux:conversation:move-display', (event, sessionId?: string) => this.moveWindowToNextDisplay(event, sessionId));
        ipcMain.handle('nextmux:conversation:reveal-in-main', (event, sessionId?: string, fileUri?: unknown) => {
            if (!this.trusted(event) || this.quitting) return { ok: false };
            const cleanId = typeof sessionId === 'string' ? sessionId.trim() : '';
            // A file opened in a detached window, which has no file drawer: the main window's drawer shows it.
            const file = typeof fileUri === 'string' && fileUri.length <= 8192 && /^file:\/\//i.test(fileUri) && !/[\0\r\n]/.test(fileUri)
                ? fileUri : undefined;
            this.showPrimary();
            const primary = this.primaryWindow;
            if (cleanId && primary && !primary.isDestroyed()) {
                primary.webContents.send('nextmux:conversation:event', { type: 'reveal', sessionId: cleanId, ...(file ? { fileUri: file } : {}) } satisfies ConversationWindowEvent);
            }
            return { ok: Boolean(cleanId) };
        });
        ipcMain.handle('nextmux:conversation:focus', (event, id: string) => {
            if (!this.trusted(event) || this.quitting || id === WARM_DETACHED_SESSION_ID) return false;
            const entry = [...this.windows.values()].find(item => item.sessionId === id && !item.window.isDestroyed());
            if (!entry) return false;
            clearTimeout(entry.reclaimTimer);
            entry.reclaimTimer = undefined;
            if (entry.window.isMinimized()) entry.window.restore();
            entry.window.show();
            entry.window.focus();
            entry.window.flashFrame?.(true);
            entry.window.webContents.send('nextmux:conversation:highlight');
            entry.window.webContents.send('nextmux:conversation:event', { type: 'highlight', sessionId: id } satisfies ConversationWindowEvent);
            setTimeout(() => { if (!entry.window.isDestroyed()) entry.window.flashFrame?.(false); }, 900);
            this.send({ type: 'windows', windows: this.entries() });
            return true;
        });
        ipcMain.handle('nextmux:conversation:reclaim', (event, sessionId?: unknown) => {
            const caller = this.trusted(event);
            if (!caller || this.quitting) return false;
            const callerEntry = this.windows.get(caller.webContents.id);
            const requestedSessionId = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : undefined;
            const targetSessionId = requestedSessionId || callerEntry?.sessionId;
            // A detached window exits tiling for its own conversation only; a standby window has none.
            if (targetSessionId === WARM_DETACHED_SESSION_ID || callerEntry && targetSessionId !== callerEntry.sessionId) return false;
            if (targetSessionId) {
                const entry = [...this.windows.values()].find(item => item.sessionId === targetSessionId && !item.window.isDestroyed());
                const primary = this.primaryWindow;
                if (entry) {
                    clearTimeout(entry.reclaimTimer);
                    entry.reclaimTimer = undefined;
                    if (entry.window.isVisible() && primary && !primary.isDestroyed()) {
                        primary.webContents.send('nextmux:conversation:event',
                            { type: 'motion', motion: { kind: 'reclaim', bounds: entry.window.getBounds() } } satisfies ConversationWindowEvent);
                    }
                    entry.window.hide();
                    entry.window.webContents.send('nextmux:conversation:event', { type: 'hidden' } satisfies ConversationWindowEvent);
                }
                this.send({ type: 'windows', windows: this.entries() });
                this.showPrimary();
                if (primary && !primary.isDestroyed()) {
                    primary.webContents.send('nextmux:conversation:event', { type: 'reveal', sessionId: targetSessionId } satisfies ConversationWindowEvent);
                }
                return true;
            }
            if (caller !== this.primary) return false;
            const visible = [...this.windows.values()].filter(entry => !entry.window.isDestroyed() && entry.window.isVisible());
            const last = visible[visible.length - 1];
            if (last) caller.webContents.send('nextmux:conversation:event',
                { type: 'motion', motion: { kind: 'reclaim', bounds: last.window.getBounds() } } satisfies ConversationWindowEvent);
            for (const entry of visible) {
                clearTimeout(entry.reclaimTimer);
                entry.window.webContents.send('nextmux:conversation:event', { type: 'reclaiming' } satisfies ConversationWindowEvent);
                const hide = () => {
                    entry.reclaimTimer = undefined;
                    if (entry.window.isDestroyed() || this.quitting) return;
                    entry.window.hide();
                    entry.window.webContents.send('nextmux:conversation:event', { type: 'hidden' });
                    this.send({ type: 'windows', windows: this.entries() });
                };
                if (systemPreferences.getAnimationSettings().prefersReducedMotion) hide();
                else entry.reclaimTimer = setTimeout(hide, 220);
            }
            return true;
        });
        ipcMain.handle('nextmux:conversation:running', (event, sessionId: string, running: boolean) => {
            const workbench = this.trusted(event);
            if (workbench && this.workbenches.has(workbench.webContents.id)) {
                if (running) this.workbenchRuns.set(sessionId, workbench.webContents.id);
                else if (this.workbenchRuns.get(sessionId) === workbench.webContents.id) this.workbenchRuns.delete(sessionId);
                this.send({ type: 'windows', windows: this.entries() });
                return true;
            }
            const entry = this.windows.get(event.sender.id);
            if (!this.trusted(event) || !entry) return false;
            if (entry.running !== running) { entry.running = running; this.send({ type: 'windows', windows: this.entries() }); }
            return true;
        });
        ipcMain.handle('nextmux:conversation:claim', (event, sessionId: string, release: boolean) => {
            const window = this.trusted(event);
            if (!window || typeof sessionId !== 'string' || !sessionId) return false;
            const owner = this.runOwners.get(sessionId);
            if (release) {
                if (owner === event.sender.id) this.runOwners.delete(sessionId);
                return true;
            }
            if (owner !== undefined && owner !== event.sender.id) return false;
            this.runOwners.set(sessionId, event.sender.id);
            return true;
        });
        ipcMain.handle('nextmux:conversation:flush', async event => {
            const window = this.trusted(event);
            if (!window) return false;
            this.reportSyncDiagnostic(window, { event: 'flush_received', primary: window === this.primary });
            if (!this.primary || this.primary.isDestroyed()) return 'unavailable';
            if (event.sender.id === this.primary.webContents.id) return 'primary';
            const requestId = randomUUID();
            return new Promise<boolean>(resolve => {
                const timer = setTimeout(() => { this.flushes.delete(requestId); resolve(false); }, 15_000);
                this.flushes.set(requestId, saved => { clearTimeout(timer); this.flushes.delete(requestId); resolve(saved); });
                this.primary!.webContents.send('nextmux:conversation:event', { type: 'flush', requestId });
            });
        });
        ipcMain.handle('nextmux:conversation:flushed', (event, id: string, saved: boolean) => {
            const window = this.trusted(event);
            if (window && window === this.primary) {
                this.reportSyncDiagnostic(window, { event: 'flush_ack', saved: saved === true });
                this.flushes.get(id)?.(saved === true);
                this.flushes.delete(id);
            }
        });
        ipcMain.handle('nextmux:conversation:release', async event => {
            const entry = this.windows.get(event.sender.id);
            if (!this.trusted(event) || !entry || this.quitting || entry.running || entry.window.isVisible()) return false;
            const standby = [...this.windows.values()].filter(item => item !== entry && !item.window.isDestroyed()
                && !item.window.isVisible() && item.sessionId === WARM_DETACHED_SESSION_ID).length;
            if (this.warmPoolEnabled && entry.loaded && standby < 2) {
                // The page saved everything before asking (releaseHiddenConversationWindow). Instead of closing,
                // it waits hidden as a standby window, and the next tile reuses it without starting a page.
                clearTimeout(entry.reclaimTimer);
                entry.reclaimTimer = undefined;
                entry.sessionId = WARM_DETACHED_SESSION_ID;
                for (const [id, owner] of this.runOwners) if (owner === event.sender.id) this.runOwners.delete(id);
                entry.window.webContents.send('nextmux:conversation:event',
                    { type: 'assign', sessionId: WARM_DETACHED_SESSION_ID, sessions: [] } satisfies ConversationWindowEvent);
                this.send({ type: 'windows', windows: this.entries() });
                return true;
            }
            entry.window.destroy();
            return true;
        });
    }
    private showPrimary(): boolean {
        if (this.quitting) return false;
        const primary = this.primaryWindow;
        if (!primary) return false;
        if (primary.isMinimized()) primary.restore();
        primary.show();
        primary.focus();
        if (process.platform === 'darwin') app.focus?.({ steal: true });
        this.notifyVisibility();
        return true;
    }
    /**
     * Ask the workbench whether a task is running (it knows scheduled, comic and child runs too) and,
     * if so, confirm with a native dialog in the interface language. The renderers are then told the
     * quit is confirmed so their own close handshake does not ask again.
     */
    private async confirmRunningQuit(): Promise<boolean> {
        if (this.promptlessQuit) return true;
        const target = this.primary && !this.primary.isDestroyed() ? this.primary
            : [...this.workbenches.values()].find(candidate => !candidate.isDestroyed());
        const detachedRunning = [...this.windows.values()].some(entry => !entry.window.isDestroyed() && entry.running);
        const reply = target ? await this.askQuitCheck(target) : undefined;
        const running = Boolean(reply?.running) || detachedRunning || this.workbenchRuns.size > 0;
        // Without a native dialog (tests, early startup) the renderer's own close check still asks.
        if (!running || typeof dialog?.showMessageBox !== 'function') return true;
        const texts = reply?.texts || { title: 'A task is still running', body: 'Quitting NextMux stops the running task. What it has finished so far is kept.',
            quit: 'Quit and stop the task', stay: 'Keep running' };
        if (target) { if (target.isMinimized()) target.restore(); target.show(); target.focus(); }
        const options = { type: 'warning' as const, buttons: [texts.quit, texts.stay], defaultId: 1, cancelId: 1, noLink: true, message: texts.title, detail: texts.body };
        const result = target ? await dialog.showMessageBox(target, options) : await dialog.showMessageBox(options);
        if (result.response !== 0) return false;
        for (const window of BrowserWindow.getAllWindows()) {
            if (!window.isDestroyed()) window.webContents.send('nextmux:quit-confirmed');
        }
        return true;
    }

    private askQuitCheck(window: BrowserWindow): Promise<{ running: boolean; texts?: { title: string; body: string; quit: string; stay: string } } | undefined> {
        if (typeof ipcMain.on !== 'function' || typeof window.webContents?.send !== 'function') return Promise.resolve(undefined);
        return new Promise(resolve => {
            const nonce = randomUUID();
            const text = (value: unknown, limit: number): string | undefined => typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : undefined;
            const finish = (value: { running: boolean; texts?: { title: string; body: string; quit: string; stay: string } } | undefined): void => {
                clearTimeout(timer); ipcMain.removeListener('nextmux:quit-check:reply', listener); resolve(value);
            };
            const listener = (event: Electron.IpcMainEvent, replyNonce: unknown, payload: unknown): void => {
                if (event.sender !== window.webContents || replyNonce !== nonce) return;
                const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
                const raw = record.texts && typeof record.texts === 'object' ? record.texts as Record<string, unknown> : {};
                const texts = { title: text(raw.title, 200), body: text(raw.body, 600), quit: text(raw.quit, 80), stay: text(raw.stay, 80) };
                finish({ running: record.running === true, ...(texts.title && texts.body && texts.quit && texts.stay ? { texts: texts as { title: string; body: string; quit: string; stay: string } } : {}) });
            };
            // A busy or crashed renderer must not hold up quitting.
            const timer = setTimeout(() => finish(undefined), 1_500);
            ipcMain.on('nextmux:quit-check:reply', listener);
            try { window.webContents.send('nextmux:quit-check', nonce); } catch { finish(undefined); }
        });
    }

    private async quitInOrder(): Promise<void> {
        try {
            // Keep the only durable history writer alive until every child has
            // acknowledged its save, passed Theia's vetoes and actually closed.
            await Promise.all([...this.openings]);
            while (true) {
                while (this.windows.size) {
                    const [windowId, entry] = this.windows.entries().next().value as [number, WindowEntry];
                    // A prior listener can interrupt delivery of `closed`. Never
                    // spin on a stale entry whose native window already vanished.
                    if (entry.window.isDestroyed()) { this.windows.delete(windowId); continue; }
                    clearTimeout(entry.reclaimTimer);
                    // A standby window holds no conversation and nothing to save: it closes without the handshake,
                    // which a page that is still starting could not answer.
                    if (entry.sessionId === WARM_DETACHED_SESSION_ID && !entry.running) {
                        this.windows.delete(windowId);
                        entry.window.destroy();
                        continue;
                    }
                    if (!await this.closeForQuit(entry.window)) return;
                }
                for (const [id, window] of this.workbenches) {
                    if (window.isDestroyed()) this.forgetWorkbench(id, window);
                }
                const next = [...this.workbenches.values()].find(window => window !== this.primary) || this.primary;
                if (!next) break;
                if (!await this.closeForQuit(next)) return;
                // An already-opening Theia workspace can register while an
                // earlier close awaits confirmation. Include it before quit.
            }
            // Torn-off app tabs have no save handshake. Preserve them until
            // every cancellable workbench close above has succeeded.
            const cleanupTabs = (app as unknown as Record<symbol, (() => void) | undefined>)[Symbol.for('nextmux.desktop.quit-tab-cleanup.v1')];
            cleanupTabs?.();
            this.quitCommitted = true;
            app.quit();
        } catch {
            // A failed renderer or save leaves remaining windows intact.
            this.quitting = false;
        }
    }
    private async closeForQuit(window: BrowserWindow): Promise<boolean> {
        if (window.isDestroyed()) return true;
        // Detached windows are normally hidden while they save.  Showing the
        // active window before asking Theia to close keeps its confirmation
        // dialog visible instead of waiting on an invisible renderer.
        const entry = this.windows.get(window.webContents.id);
        const hiddenRunningChild = Boolean(entry?.running && !window.isVisible());
        const hiddenRunningWorkbench = [...this.workbenchRuns.values()].includes(window.webContents.id) && !window.isVisible();
        if (hiddenRunningChild || hiddenRunningWorkbench) {
            if (window.isMinimized()) window.restore();
            window.show();
            window.focus();
        }
        const request = (window as unknown as Record<symbol, (() => Promise<boolean>) | undefined>)[conversationQuitRequestKey];
        if (!request) return false;
        this.quitTarget = window;
        return request();
    }
    private async open(sessionId: string, initialBounds?: ConversationWindowBounds): Promise<BrowserWindow> {
        if (sessionId === WARM_DETACHED_SESSION_ID) {
            // One standby window loads at a time.
            const loading = this.opening.get(sessionId);
            if (loading) return loading;
            const creating = this.create(sessionId, initialBounds);
            this.opening.set(sessionId, creating);
            try { return await creating; } finally { if (this.opening.get(sessionId) === creating) this.opening.delete(sessionId); }
        }
        const existing = [...this.windows.values()].find(entry => entry.sessionId === sessionId && !entry.window.isDestroyed());
        if (existing) {
            clearTimeout(existing.reclaimTimer);
            existing.reclaimTimer = undefined;
            if (!existing.window.isVisible() && initialBounds) {
                if (existing.window.isFullScreen()) existing.window.setFullScreen(false);
                if (existing.window.isMaximized()) existing.window.unmaximize();
                this.applyProgrammaticBounds(existing, initialBounds);
            }
            if (existing.window.isMinimized()) existing.window.restore();
            existing.window.show();
            existing.window.focus();
            return existing.window;
        }
        // A second request while the first window is still being created shares it instead of opening a copy (audit A07-06).
        const pending = this.opening.get(sessionId);
        if (pending) {
            const window = await pending;
            if (!window.isDestroyed() && !this.quitting) { window.show(); window.focus(); }
            return window;
        }
        const opening = this.openSession(sessionId, initialBounds);
        this.opening.set(sessionId, opening);
        try { return await opening; } finally { if (this.opening.get(sessionId) === opening) this.opening.delete(sessionId); }
    }

    /**
     * Each tile used to start a whole workbench page (create, load, wait until ready) and the page was closed again
     * on release, so tiling was slow, most of all on Windows. A standby window whose page already loaded takes the
     * conversation at once; only without one does a new window start, and the pool refills behind it.
     */
    private async openSession(sessionId: string, initialBounds?: ConversationWindowBounds): Promise<BrowserWindow> {
        const standby = this.idleStandbyEntry();
        if (standby) return this.assignStandby(standby, sessionId, initialBounds);
        const loading = this.opening.get(WARM_DETACHED_SESSION_ID);
        if (loading) {
            const window = await loading.catch(() => undefined);
            const entry = window && !window.isDestroyed() ? this.windows.get(window.webContents.id) : undefined;
            // Another tile may have taken it while it loaded.
            const available = entry?.sessionId === WARM_DETACHED_SESSION_ID ? entry : this.idleStandbyEntry();
            if (available && !this.quitting) return this.assignStandby(available, sessionId, initialBounds);
        }
        const window = await this.create(sessionId, initialBounds);
        this.scheduleWarmWindow(800);
        return window;
    }

    /** A hidden standby window whose page loaded and hydrated (`nextmux:conversation:state`). */
    private idleStandbyEntry(): WindowEntry | undefined {
        const idle = [...this.windows.values()].filter(entry => entry.sessionId === WARM_DETACHED_SESSION_ID && entry.loaded
            && entry.stateHydrated && !entry.running && !entry.window.isDestroyed() && !entry.window.isVisible());
        return idle.find(entry => !entry.ready) ?? idle[0];
    }

    /**
     * The standby page switches to the conversation in place (`assign`). A page that has not finished starting
     * reads it from `nextmux:conversation:state` instead, which answers with the assigned conversation.
     */
    private async assignStandby(entry: WindowEntry, sessionId: string, initialBounds?: ConversationWindowBounds): Promise<BrowserWindow> {
        const { window } = entry;
        clearTimeout(entry.reclaimTimer);
        entry.reclaimTimer = undefined;
        entry.sessionId = sessionId;
        const targetBounds = initialBounds
            ?? assignNonDestructiveTileSlots(this.orderedDisplays(this.primary), this.visibleWindowBounds(), 1, this.preferredTileWidth, this.preferredTileHeight)[0].bounds;
        if (window.isFullScreen()) window.setFullScreen(false);
        if (window.isMaximized()) window.unmaximize();
        if (window.isMinimized()) window.restore();
        this.applyProgrammaticBounds(entry, targetBounds);
        // A hidden page renders the conversation while hidden and only then shows, so a reused window never flashes
        // the conversation it had before. Background throttling stays disabled so hidden/inactive tiles never freeze.
        this.standbyFailures = 0;
        const contents = window.webContents;
        const throttled = typeof contents.getBackgroundThrottling === 'function' && typeof contents.setBackgroundThrottling === 'function'
            && contents.getBackgroundThrottling();
        if (throttled) contents.setBackgroundThrottling(false);
        const session = this.sessions.get(sessionId);
        contents.send('nextmux:conversation:event',
            { type: 'assign', sessionId, sessions: session ? [session] : [], windows: this.entries() } satisfies ConversationWindowEvent);
        if (throttled) await new Promise<void>(resolve => setTimeout(resolve, 100));
        if (!window.isDestroyed()) {
            if (!this.quitting && entry.sessionId === sessionId) { window.show(); window.focus(); }
        }
        this.scheduleWarmWindow(400);
        return window;
    }

    /** Theia's own window defaults (preload, frame, web preferences) without its show-on-first-paint or background throttling. */
    private detachedWindowOptions(_standby: boolean): TheiaBrowserWindowOptions | undefined {
        const defaults = (this.application as unknown as { getDefaultTheiaWindowOptions?: () => TheiaBrowserWindowOptions }).getDefaultTheiaWindowOptions;
        if (typeof defaults !== 'function') return undefined;
        try {
            const base = defaults.call(this.application);
            return {
                ...base,
                show: false,
                preventAutomaticShow: true,
                webPreferences: { ...(base.webPreferences || {}), backgroundThrottling: false }
            };
        } catch {
            return undefined;
        }
    }

    private standbyWindowOptions(): TheiaBrowserWindowOptions | undefined {
        return this.detachedWindowOptions(true);
    }

    /** Load one standby window in the background unless one exists or is loading (at most one at a time). */
    private scheduleWarmWindow(delayMs = 1200): void {
        if (!this.warmPoolEnabled || this.quitting || this.warmTimer || this.standbyFailures >= 3 || !this.primary || this.primary.isDestroyed()
            || typeof this.application?.createWindow !== 'function' || !this.standbyWindowOptions()) return;
        this.warmTimer = setTimeout(() => {
            this.warmTimer = undefined;
            const primary = this.primary;
            if (this.quitting || !primary || primary.isDestroyed()) return;
            // A main window that is still (re)loading gets the processor first.
            if (primary.webContents.isLoading()) { this.scheduleWarmWindow(1200); return; }
            const standing = [...this.windows.values()].some(entry => entry.sessionId === WARM_DETACHED_SESSION_ID && !entry.window.isDestroyed());
            if (standing || this.opening.has(WARM_DETACHED_SESSION_ID)) return;
            void this.open(WARM_DETACHED_SESSION_ID).catch(() => {
                if (!this.quitting) this.standbyFailures++;
            });
        }, delayMs);
        this.warmTimer.unref?.();
    }

    private visibleWindowBounds(): ConversationWindowBounds[] {
        return [...this.windows.values()]
            .filter(entry => !entry.window.isDestroyed() && entry.window.isVisible())
            .map(entry => entry.window.getBounds());
    }

    private applyProgrammaticBounds(entry: WindowEntry, bounds: ConversationWindowBounds, animate = false): void {
        // An animated frame change on macOS lasts a fraction of a second per 150px moved; its resize events are ours too.
        entry.programmaticBoundsUntil = Date.now() + (animate ? 1500 : 400);
        entry.lastProgrammaticWidth = bounds.width;
        entry.lastProgrammaticHeight = bounds.height;
        entry.window.setBounds(bounds, animate);
    }

    /** A width or height set by hand becomes the size of every later tile, also after a restart. */
    private recordUserResizedBounds(entry: WindowEntry, rawWidth?: number, rawHeight?: number): void {
        let changed = false;
        if (rawWidth !== undefined && Number.isFinite(rawWidth)) {
            const width = Math.max(MIN_CONVERSATION_TILE_WIDTH, Math.min(MAX_CONVERSATION_TILE_WIDTH, Math.round(rawWidth)));
            if (width !== entry.lastProgrammaticWidth) {
                entry.lastProgrammaticWidth = width;
                if (width !== this.preferredTileWidth) {
                    this.preferredTileWidth = width;
                    changed = true;
                }
            }
        }
        if (rawHeight !== undefined && Number.isFinite(rawHeight)) {
            const height = Math.max(MIN_CONVERSATION_TILE_HEIGHT, Math.min(MAX_CONVERSATION_TILE_HEIGHT, Math.round(rawHeight)));
            if (height !== entry.lastProgrammaticHeight) {
                entry.lastProgrammaticHeight = height;
                if (height !== this.preferredTileHeight) {
                    this.preferredTileHeight = height;
                    changed = true;
                }
            }
        }
        if (changed) this.savePreferredTileWidth();
    }

    private async loadPreferredTileWidth(): Promise<void> {
        try {
            const [{ readFile }, { join }] = await Promise.all([import('node:fs/promises'), import('node:path')]);
            const saved = JSON.parse(await readFile(join(app.getPath('userData'), tilePreferencesFile), 'utf8')) as { preferredTileWidth?: unknown; preferredTileHeight?: unknown } | null;
            const width = saved?.preferredTileWidth;
            const height = saved?.preferredTileHeight;
            // A size set by hand while the file was read is newer.
            if (this.preferredTileWidth === undefined && typeof width === 'number' && Number.isInteger(width)
                && width >= MIN_CONVERSATION_TILE_WIDTH && width <= MAX_CONVERSATION_TILE_WIDTH) this.preferredTileWidth = width;
            if (this.preferredTileHeight === undefined && typeof height === 'number' && Number.isInteger(height)
                && height >= MIN_CONVERSATION_TILE_HEIGHT && height <= MAX_CONVERSATION_TILE_HEIGHT) this.preferredTileHeight = height;
        } catch { /* Nothing saved yet, an unreadable file, or no user data directory (unit tests): tiles keep the compact default. */ }
    }

    private savePreferredTileWidth(): void {
        clearTimeout(this.preferredTileWidthTimer);
        this.preferredTileWidthTimer = setTimeout(() => {
            this.preferredTileWidthTimer = undefined;
            void this.writePreferredTileWidth();
        }, 250);
        this.preferredTileWidthTimer.unref?.();
    }

    /** Quitting writes a size that is still waiting for its debounce. */
    private flushPreferredTileWidth(): void {
        if (!this.preferredTileWidthTimer) return;
        clearTimeout(this.preferredTileWidthTimer);
        this.preferredTileWidthTimer = undefined;
        if (this.preferredTileWidth !== undefined || this.preferredTileHeight !== undefined) void this.writePreferredTileWidth();
    }

    private async writePreferredTileWidth(): Promise<void> {
        try {
            const [{ rename, rm, writeFile }, { join }] = await Promise.all([import('node:fs/promises'), import('node:path')]);
            const file = join(app.getPath('userData'), tilePreferencesFile);
            const prefs: { preferredTileWidth?: number; preferredTileHeight?: number } = {};
            if (this.preferredTileWidth !== undefined) prefs.preferredTileWidth = this.preferredTileWidth;
            if (this.preferredTileHeight !== undefined) prefs.preferredTileHeight = this.preferredTileHeight;
            const body = `${JSON.stringify(prefs)}\n`;
            // Written beside the file and renamed over it, so a crash mid-write never leaves a cut-off file.
            const temporary = `${file}.${process.pid}.tmp`;
            try {
                await writeFile(temporary, body, 'utf8');
                await rename(temporary, file);
            } catch {
                await rm(temporary, { force: true }).catch(() => undefined);
                await writeFile(file, body, 'utf8');
            }
        } catch { /* Best effort: the size still applies until the app quits. */ }
    }

    private async create(sessionId: string, initialBounds?: ConversationWindowBounds): Promise<BrowserWindow> {
        const standby = sessionId === WARM_DETACHED_SESSION_ID;
        const primary = this.primaryWindow;
        if (!primary) throw new Error('NEXTMUX_CONVERSATION_PRIMARY_UNAVAILABLE');
        const url = new URL(primary.webContents.getURL());
        url.searchParams.set('nextmuxConversation', sessionId);
        const targetBounds = initialBounds
            ?? assignNonDestructiveTileSlots(this.orderedDisplays(this.primary), this.visibleWindowBounds(), 1, this.preferredTileWidth, this.preferredTileHeight)[0].bounds;
        // Theia shows a new window as soon as it can paint; detached windows stay hidden until bounds/session are ready.
        const windowOptions = this.detachedWindowOptions(standby);
        if (standby && !windowOptions) throw new Error('NEXTMUX_STANDBY_WINDOW_UNAVAILABLE');
        const window = await (windowOptions ? this.application.createWindow(windowOptions) : this.application.createWindow());
        (window as unknown as Record<symbol, unknown>)[detachedConversationWindowKey] = true;
        if (standby && this.quitting) {
            window.destroy();
            throw new Error('NEXTMUX_CONVERSATION_QUITTING');
        }
        window.hide();
        window.setMinimumSize(MIN_CONVERSATION_TILE_WIDTH, MIN_CONVERSATION_TILE_HEIGHT);
        window.setResizable(true);
        const entry: WindowEntry = { window, sessionId, running: false };
        this.applyProgrammaticBounds(entry, targetBounds);
        let readyTimer: ReturnType<typeof setTimeout>;
        const ready = new Promise<void>(resolve => {
            const done = (): void => { clearTimeout(readyTimer); resolve(); };
            entry.ready = done;
            window.once('ready-to-show', done);
            window.once('closed', done);
            readyTimer = setTimeout(done, 15_000);
        });
        const windowId = window.webContents.id;
        this.windows.set(windowId, entry);
        (window as unknown as Record<symbol, unknown>)[conversationCloseKey] = () => {
            if (this.quitting) return window !== this.quitTarget;
            clearTimeout(entry.reclaimTimer);
            entry.reclaimTimer = undefined;
            // The conversation this window shows now: a standby window is reassigned in place.
            const activeSessionId = entry.sessionId;
            window.hide();
            if (activeSessionId === WARM_DETACHED_SESSION_ID) return true;
            window.webContents.send('nextmux:conversation:event', { type: 'hidden' });
            this.send({ type: 'windows', windows: this.entries() });
            const primaryWindow = this.primaryWindow;
            if (primaryWindow && !primaryWindow.isDestroyed()) {
                primaryWindow.webContents.send('nextmux:conversation:event', { type: 'reveal', sessionId: activeSessionId } satisfies ConversationWindowEvent);
            }
            return true;
        };
        // Resizing by hand sets the size of later tiles. macOS and Windows announce it (will-resize, never sent for
        // setBounds); a snap, zoom or full screen there is not a chosen size. Elsewhere any resize not made here counts.
        window.on('will-resize', (_event, newBounds) => {
            if (this.quitting || !newBounds || Date.now() <= (entry.programmaticBoundsUntil ?? 0)) return;
            entry.manualResizeUntil = Date.now() + 1000;
            this.recordUserResizedBounds(
                entry,
                typeof newBounds.width === 'number' ? newBounds.width : undefined,
                typeof newBounds.height === 'number' ? newBounds.height : undefined
            );
        });
        window.on('resize', () => {
            if (this.quitting || window.isDestroyed() || !window.isVisible() || window.isMaximized() || window.isFullScreen() || window.isMinimized()) return;
            const now = Date.now();
            if (now <= (entry.programmaticBoundsUntil ?? 0)) return;
            const announced = process.platform === 'darwin' || process.platform === 'win32';
            if (announced && now >= (entry.manualResizeUntil ?? 0)) return;
            const { width, height } = window.getBounds();
            this.recordUserResizedBounds(entry, width, height);
        });
        // A standby page that died cannot take a conversation; a fresh one replaces it.
        window.webContents.on('render-process-gone', () => {
            if (entry.sessionId !== WARM_DETACHED_SESSION_ID || window.isDestroyed()) return;
            // One still loading also fails its open(), which counts it.
            if (entry.loaded) this.standbyFailures++;
            window.destroy();
            this.scheduleWarmWindow(1200);
        });
        window.on('closed', () => {
            clearTimeout(entry.reclaimTimer);
            this.windows.delete(windowId);
            for (const [id, owner] of this.runOwners) if (owner === windowId) this.runOwners.delete(id);
            this.send({ type: 'windows', windows: this.entries() });
        });
        this.applyProgrammaticBounds(entry, targetBounds);
        await window.loadURL(url.toString());
        await ready;
        if (standby && !entry.stateHydrated && !window.isDestroyed()) {
            this.standbyFailures++;
            window.destroy();
            throw new Error('NEXTMUX_STANDBY_WINDOW_TIMEOUT');
        }
        entry.loaded = true;
        // A standby window stays hidden until a conversation is assigned to it.
        if (!window.isDestroyed() && !this.quitting && entry.sessionId !== WARM_DETACHED_SESSION_ID) { window.show(); window.focus(); }
        return window;
    }
}
