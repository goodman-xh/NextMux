import { ContainerModule, inject, injectable, optional } from '@theia/core/shared/inversify';
import { fork, type ForkOptions } from 'child_process';
import { StopReason } from '@theia/core/lib/common/frontend-application-state';
import { createDisposableListener } from '@theia/core/lib/electron-main/event-utils';
import { TheiaElectronWindow } from '@theia/core/lib/electron-main/theia-electron-window';
import type { Event, WebContents } from '@theia/core/electron-shared/electron';
import { ElectronMainApplication, ElectronMainApplicationContribution, type ElectronMainCommandOptions } from '@theia/core/lib/electron-main/electron-main-application';
import type { TheiaBrowserWindowOptions } from '@theia/core/lib/electron-main/theia-electron-window';
import type { WindowSearchParams } from '@theia/core/lib/common/window';
import { app, BrowserWindow, dialog, powerSaveBlocker, screen, session } from '@theia/core/electron-shared/electron';
import { NEXTMUX_PROXY_RESOLVER_PATH_ENV, NEXTMUX_PROXY_RESOLVER_TOKEN_ENV } from '../common/nextmux-proxy-resolver-protocol';
import { startProxyResolverHost, type ProxyResolverHost } from './nextmux-proxy-resolver-host';
import { NEXTMUX_POWER_SAVE_PATH_ENV, NEXTMUX_POWER_SAVE_TOKEN_ENV } from '../common/nextmux-power-save-protocol';
import { startPowerSaveHost, type PowerSaveHost } from './nextmux-power-save-host';
import { defaultMainWindowBounds, fitWindowToWorkArea, mainWindowMinimumSize } from './nextmux-window-bounds';
import {
    NextMuxConversationWindows, conversationCloseKey, conversationQuitCancelledKey, conversationQuitRequestKey, isDetachedConversationWindow,
    isRestorableWorkbenchWindowState, showMainWindowKey, WORKBENCH_WINDOW_STATE_ROLE
} from './nextmux-conversation-windows';
import { backendRestartArguments, NextMuxBackendProcessLifecycle } from './nextmux-backend-process-lifecycle';

const coordinatorKey = Symbol.for('nextmux.desktop.close-coordinator.v1');
/** Theia's saved window state, with the mark a workbench window adds (NextMuxElectronMainApplication.saveWindowState). */
type SavedWindowState = TheiaBrowserWindowOptions & { readonly nextmuxWindowRole?: unknown };
let backgroundScheduledWindow = process.argv.includes('--nextmux-scheduled');
interface CloseCoordinator {
    managed: boolean;
    prepare(): Promise<string | undefined>;
    isApproved(token: string): boolean;
    cancel(token: string): void;
    cancelPending(): void;
}

/** One close flow: durable product state first, then Theia vetoes and cleanup. */
@injectable()
export class NextMuxElectronWindow extends TheiaElectronWindow {
    private stopRequest: Promise<boolean> | undefined;
    private quitRequest: Promise<boolean> | undefined;

    protected override attachReadyToShow(): void {
        if (!backgroundScheduledWindow) return super.attachReadyToShow();
        backgroundScheduledWindow = false;
        // Only the initial scheduled launch is inactive. Later windows opened
        // explicitly by the user retain Theia's ordinary activation behavior.
        this.window.once('ready-to-show', () => this.window.showInactive());
    }

    private coordinator(): CloseCoordinator {
        const coordinator = (this.window as unknown as Record<symbol, CloseCoordinator>)[coordinatorKey];
        if (!coordinator) throw new Error('NEXTMUX_CLOSE_COORDINATOR_UNAVAILABLE');
        return coordinator;
    }

    protected override attachCloseListeners(): void {
        this.coordinator().managed = true;
        (this.window as unknown as Record<symbol, unknown>)[conversationQuitRequestKey] = () => this.closeForQuit();
        createDisposableListener(this.window, 'closed', () => {
            this.onDidCloseEmitter.fire();
            this.dispose();
        }, this.toDispose);
        createDisposableListener(this.window, 'close', (event: Event) => {
            if (this.closeIsConfirmed) return;
            event.preventDefault();
            const closeConversation = (this.window as unknown as Record<symbol, (() => boolean) | undefined>)[conversationCloseKey];
            if (closeConversation?.()) return;
            void this.close();
        }, this.toDispose);
    }

    private closeForQuit(): Promise<boolean> {
        if (this.window.isDestroyed()) return Promise.resolve(true);
        if (this.quitRequest) return this.quitRequest;
        const wasVisible = this.window.isVisible();
        // BrowserWindow.webContents is a native getter and throws after the
        // window emits `closed`. Keep the emitter captured while it exists.
        const contents = this.window.webContents;
        const operation = new Promise<boolean>(resolve => {
            let finished = false;
            const finish = (closed: boolean) => {
                if (finished) return;
                finished = true;
                this.window.removeListener('closed', onClosed);
                this.window.removeListener('close', onClose);
                contents.removeListener('will-prevent-unload', onUnloadVeto);
                contents.removeListener('render-process-gone', onRendererGone);
                if (!closed && !this.window.isDestroyed()) {
                    this.closeIsConfirmed = false;
                    this.coordinator().cancelPending();
                    if (wasVisible) this.window.show();
                }
                resolve(closed);
            };
            const onClosed = () => finish(true);
            // A saved receipt or Theia's resolved promise alone does not prove
            // Electron closed the window: later native/page vetoes still apply.
            const onClose = (event: Event) => {
                if (this.closeIsConfirmed) queueMicrotask(() => { if (event.defaultPrevented) finish(false); });
            };
            const onUnloadVeto = (event: Event) => queueMicrotask(() => { if (!event.defaultPrevented) finish(false); });
            const onRendererGone = () => finish(false);
            this.window.once('closed', onClosed);
            this.window.on('close', onClose);
            contents.on('will-prevent-unload', onUnloadVeto);
            contents.once('render-process-gone', onRendererGone);
            void this.close().then(stopped => { if (!stopped) finish(false); }, () => finish(false));
        }).finally(() => {
            if (this.quitRequest === operation) this.quitRequest = undefined;
        });
        this.quitRequest = operation;
        return operation;
    }

    protected override handleStopRequest(onSafeCallback: () => Promise<unknown>, reason: StopReason): Promise<boolean> {
        const closeConversation = (this.window as unknown as Record<symbol, (() => boolean) | undefined>)[conversationCloseKey];
        if (reason === StopReason.Close && closeConversation?.()) return Promise.resolve(true);
        // Native close, menu close and reload share this one in-flight attempt.
        if (this.stopRequest) return this.stopRequest;
        const operation = this.prepareThenStop(onSafeCallback, reason).finally(() => {
            if (this.stopRequest === operation) this.stopRequest = undefined;
        });
        this.stopRequest = operation;
        return operation;
    }

    private async prepareThenStop(onSafeCallback: () => Promise<unknown>, reason: StopReason): Promise<boolean> {
        const coordinator = this.coordinator();
        const token = await coordinator.prepare();
        const cancelled = () => (this.window as unknown as Record<symbol, (() => void) | undefined>)[conversationQuitCancelledKey]?.();
        if (!token) { cancelled(); return false; }
        let stopped = false;
        try {
            stopped = await super.handleStopRequest(async () => {
                // Navigation/crash can invalidate a saved receipt during Theia's
                // async checks. Do not hide or close using the old document.
                if (!coordinator.isApproved(token)) throw new Error('NEXTMUX_CLOSE_RECEIPT_EXPIRED');
                return onSafeCallback();
            }, reason);
            return stopped;
        } finally {
            if (!stopped) { coordinator.cancel(token); cancelled(); }
        }
    }
}

@injectable()
export class NextMuxElectronMainApplication extends ElectronMainApplication {
    @inject(NextMuxConversationWindows) @optional()
    private readonly conversationWindows: NextMuxConversationWindows | undefined;
    private proxyResolverHost: Promise<ProxyResolverHost | undefined> | undefined;
    private powerSaveHost: Promise<PowerSaveHost | undefined> | undefined;
    private backendLifecycle: NextMuxBackendProcessLifecycle | undefined;

    protected override onWebContentsCreated(event: Event, contents: WebContents): void {
        // Theia's handler only installs its shell-page navigation veto and
        // native external-window opener. The dedicated browser guest already
        // has HTTP(S)/redirect checks and a deny-only popup handler in updater.
        // Applying the shell veto here would cancel every ordinary link click
        // and replace the guest's deny handler with an external-browser launch.
        const ownedBrowserPredicate = (globalThis as unknown as Record<symbol, ((contents: WebContents) => boolean) | undefined>)[Symbol.for('nextmux.owned-browser.isRegistered.v1')];
        if (ownedBrowserPredicate?.(contents)) return;
        if (contents.getType() === 'webview' && contents.session === session.fromPartition('persist:nextmux-browser')) return;
        super.onWebContentsCreated(event, contents);
    }

    protected override async startBackend(): Promise<number> {
        if (process.argv.includes('--no-cluster')) return super.startBackend();
        process.env.THEIA_ELECTRON_VERSION = process.versions.electron;
        if (!this.backendLifecycle) {
            const lifecycle = new NextMuxBackendProcessLifecycle({
                fork: async port => fork(this.globals.THEIA_BACKEND_MAIN_PATH,
                    backendRestartArguments(this.processArgv.getProcessArgvWithoutBin(), port), await this.getForkOptions()),
                onFailure: failure => {
                    console.error('NextMux backend recovery stopped', failure);
                    const chinese = app.getLocale().toLowerCase().startsWith('zh');
                    dialog.showErrorBox('NextMux', chinese
                        ? '后台服务已停止。已保存的任务检查点会保留，请重新启动 NextMux 后继续任务。'
                        : 'The background service stopped. Saved task checkpoints are retained. Restart NextMux to continue the task.');
                }
            });
            this.backendLifecycle = lifecycle;
            // A cancelled before-quit is still a live application. Only the
            // final quit event disposes the backend and disables recovery.
            app.once('quit', () => lifecycle.dispose());
        }
        return this.backendLifecycle.start();
    }

    protected startPowerSaveBlocker(): Promise<PowerSaveHost | undefined> {
        this.powerSaveHost ??= app.whenReady().then(() => startPowerSaveHost(powerSaveBlocker)).then(host => {
            app.once('quit', () => host.close());
            return host;
        }, () => undefined);
        return this.powerSaveHost;
    }

    /** Chromium's proxy resolver (PAC/WPAD/system/SOCKS) served to the forked backend. */
    protected startProxyResolver(): Promise<ProxyResolverHost | undefined> {
        this.proxyResolverHost ??= startProxyResolverHost(async url => {
            await app.whenReady();
            return session.defaultSession.resolveProxy(url);
        }).then(host => {
            app.once('quit', () => host.close());
            return host;
        }, () => undefined);
        return this.proxyResolverHost;
    }

    protected override async getForkOptions(): Promise<ForkOptions> {
        const options = await super.getForkOptions();
        const resolver = await this.startProxyResolver();
        if (resolver) options.env = { ...options.env, [NEXTMUX_PROXY_RESOLVER_PATH_ENV]: resolver.path, [NEXTMUX_PROXY_RESOLVER_TOKEN_ENV]: resolver.token };
        const power = await this.startPowerSaveBlocker();
        if (power) options.env = { ...options.env, [NEXTMUX_POWER_SAVE_PATH_ENV]: power.path, [NEXTMUX_POWER_SAVE_TOKEN_ENV]: power.token };
        // Theia detaches the backend on Unix. Its existing parent watchdog is
        // only enabled when this PID is supplied, including after a main-process
        // crash where Electron cannot emit the ordinary quit event.
        return { ...options, env: { ...options.env, THEIA_PARENT_PID: String(process.pid) } };
    }

    /** First launch: size the window to the display work area (see nextmux-window-bounds). */
    protected override getDefaultTheiaWindowBounds(): TheiaBrowserWindowOptions {
        return defaultMainWindowBounds(this.getDisplayForNewWindow().workArea);
    }

    /** Static config sizes would override the adaptive bounds; minimums never exceed a small screen. */
    protected override getDefaultOptions(): TheiaBrowserWindowOptions {
        const { width: _width, height: _height, ...options } = super.getDefaultOptions();
        return {
            ...options,
            ...mainWindowMinimumSize(this.getDisplayForNewWindow().workArea),
            webPreferences: { ...options.webPreferences, backgroundThrottling: false }
        };
    }

    /** A restored window is fitted to the display it reopens on, and never reopens at a detached tile's size. */
    override async getLastWindowOptions(): Promise<TheiaBrowserWindowOptions> {
        const { nextmuxWindowRole, ...options } = await super.getLastWindowOptions() as SavedWindowState;
        if (typeof options.x !== 'number' || typeof options.y !== 'number' || !options.width || !options.height) return options;
        // A state saved before detached windows stopped saving it can still be a tile's (see saveWindowState).
        if (!isRestorableWorkbenchWindowState({ width: options.width, height: options.height, nextmuxWindowRole })) return this.getDefaultTheiaWindowOptions();
        const workArea = screen.getDisplayMatching({ x: options.x, y: options.y, width: options.width, height: options.height }).workArea;
        const fitted = fitWindowToWorkArea(options, workArea);
        return fitted ? { ...options, ...fitted, ...mainWindowMinimumSize(workArea) } : this.getDefaultTheiaWindowOptions();
    }

    /**
     * Theia keeps one saved window state, the one the next main window reopens with, and saves it from every window
     * it created: on move, resize and close, and when a page reports its theme or title bar (setBackgroundColor,
     * setTitleBarStyle). A detached conversation window (a 380×540 tile, or a hidden standby window) would leave its
     * size as the main window's. Only workbench windows save it, marked so an earlier version's state is told apart.
     */
    protected override saveWindowState(electronWindow: BrowserWindow): void {
        // A destroyed window has no bounds (a resize debounced before it closed): nothing to save.
        if (!electronWindow || isDetachedConversationWindow(electronWindow) || electronWindow.isDestroyed()) return;
        super.saveWindowState(electronWindow);
        let bounds: ReturnType<BrowserWindow['getBounds']>;
        try { bounds = electronWindow.getBounds(); } catch { return; }
        const saved = this.electronStore.get('windowstate') as SavedWindowState | undefined;
        // Mark only the state Theia has just saved from this window, never one it failed to replace.
        if (saved && saved.nextmuxWindowRole !== WORKBENCH_WINDOW_STATE_ROLE && saved.x === bounds.x && saved.y === bounds.y
            && saved.width === bounds.width && saved.height === bounds.height) {
            this.electronStore.set('windowstate', { ...saved, nextmuxWindowRole: WORKBENCH_WINDOW_STATE_ROLE } as SavedWindowState);
        }
    }

    protected override isShowWindowEarly(): boolean {
        return !process.argv.includes('--nextmux-scheduled') && super.isShowWindowEarly();
    }

    private isWorkbenchWindow(candidate: BrowserWindow | undefined, allowEmptyUrl = false): boolean {
        if (!candidate || candidate.isDestroyed()) return false;
        if ((candidate as unknown as Record<symbol, unknown>)[Symbol.for('nextmux.conversation-window.detached.v1')]) return false;
        const ownedBrowserPredicate = (globalThis as unknown as Record<symbol, ((contents: WebContents) => boolean) | undefined>)[Symbol.for('nextmux.owned-browser.isRegistered.v1')];
        if (candidate.webContents && ownedBrowserPredicate?.(candidate.webContents)) return false;
        try {
            const rawUrl = candidate.webContents?.getURL?.() || '';
            if (!rawUrl) return allowEmptyUrl;
            const parsed = new URL(rawUrl);
            if (parsed.protocol !== 'file:') return false;
            if (!parsed.pathname.endsWith('/index.html')) return false;
            return !parsed.searchParams.has('nextmuxConversation');
        } catch {
            return false;
        }
    }

    private findExistingWorkbenchWindow(): BrowserWindow | undefined {
        if (this.initialWindow && !this.initialWindow.isDestroyed() && this.isWorkbenchWindow(this.initialWindow, true)) return this.initialWindow;
        let loadingCandidate: BrowserWindow | undefined;
        let emptyUrlCandidate: BrowserWindow | undefined;
        const seen = new Set<BrowserWindow>();
        const inspect = (candidate: BrowserWindow | undefined, allowEmptyUrl: boolean): BrowserWindow | undefined => {
            if (!candidate || seen.has(candidate)) return undefined;
            seen.add(candidate);
            if (!this.isWorkbenchWindow(candidate, allowEmptyUrl)) return undefined;
            const rawUrl = candidate.webContents?.getURL?.() || '';
            const isLoading = Boolean(candidate.webContents?.isLoading?.());
            if (rawUrl && !isLoading) return candidate;
            if (rawUrl) loadingCandidate ??= candidate;
            else emptyUrlCandidate ??= candidate;
            return undefined;
        };
        for (const entry of this.windows.values()) {
            const loaded = inspect(entry.window, true);
            if (loaded) return loaded;
        }
        for (const candidate of BrowserWindow.getAllWindows()) {
            const loaded = inspect(candidate, false);
            if (loaded) return loaded;
        }
        return loadingCandidate ?? emptyUrlCandidate;
    }

    private focusExistingWorkbenchWindow(): BrowserWindow | undefined {
        const showMain = (app as unknown as Record<symbol, (() => boolean) | undefined>)[showMainWindowKey];
        const shownByPrimary = Boolean(showMain?.());
        const getPrimary = (app as unknown as Record<symbol, (() => BrowserWindow | undefined) | undefined>)[Symbol.for('nextmux.desktop.primary-main-window.v1')];
        const primary = this.conversationWindows?.primaryWindow ?? getPrimary?.();
        const existing = this.findExistingWorkbenchWindow() ?? (primary && !primary.isDestroyed() ? primary : undefined);
        if (!shownByPrimary && !existing) return undefined;
        if (existing && !existing.isDestroyed()) {
            if (existing.isMinimized()) existing.restore();
            existing.show();
            existing.focus();
        }
        app.focus?.({ steal: true });
        return existing;
    }

    override async openDefaultWindow(params?: WindowSearchParams): Promise<BrowserWindow> {
        if (!this.initialWindow) {
            const existing = this.focusExistingWorkbenchWindow();
            if (existing) return existing;
        }
        return super.openDefaultWindow(params);
    }

    protected override async openWindowWithWorkspace(workspacePath: string): Promise<BrowserWindow> {
        if (!this.initialWindow) {
            const existing = this.focusExistingWorkbenchWindow();
            if (existing) return existing;
        }
        return super.openWindowWithWorkspace(workspacePath);
    }

    protected override async handleMainCommand(options: ElectronMainCommandOptions): Promise<void> {
        if (options.secondInstance) {
            if (this.focusExistingWorkbenchWindow()) return;
            const showMain = (app as unknown as Record<symbol, (() => boolean) | undefined>)[showMainWindowKey];
            if (showMain?.()) return;
        }
        await super.handleMainCommand(options);
    }

    protected override async onSecondInstance(event: Event, argv: string[], cwd: string, originalArgv: string[]): Promise<void> {
        // The existing renderer already checks due schedules. A scheduler
        // wake-up must neither open another workbench nor select its project.
        if (argv.includes('--nextmux-scheduled') || originalArgv?.includes('--nextmux-scheduled')) return;
        if (originalArgv?.includes('--open-url')) {
            await this.openUrl(originalArgv[originalArgv.length - 1]);
        }
        if (this.focusExistingWorkbenchWindow()) return;
        const showMain = (app as unknown as Record<symbol, (() => boolean) | undefined>)[showMainWindowKey];
        if (showMain?.()) return;
        await super.onSecondInstance(event, argv, cwd, originalArgv);
    }
}

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    rebind(ElectronMainApplication).to(NextMuxElectronMainApplication).inSingletonScope();
    rebind(TheiaElectronWindow).to(NextMuxElectronWindow);
    bind(NextMuxConversationWindows).toSelf().inSingletonScope();
    bind(ElectronMainApplicationContribution).toService(NextMuxConversationWindows);
});
