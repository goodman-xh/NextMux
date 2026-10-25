import { AbstractViewContribution, CommonMenus, KeybindingRegistry } from '@theia/core/lib/browser';
import { isOSX } from '@theia/core/lib/common/os';
import { FrontendApplicationStateService } from '@theia/core/lib/browser/frontend-application-state';
import { Command, CommandRegistry } from '@theia/core/lib/common/command';
import { MAIN_MENU_BAR, MenuModelRegistry, MutableCompoundMenuNode } from '@theia/core/lib/common/menu';
import { inject, injectable } from '@theia/core/shared/inversify';
import { canvasKeyboardOwnsTarget } from './nextmux-comic-canvas-keyboard';
import { NextMuxDesktopWidget } from './nextmux-desktop-widget';
import { desktopText, normalizeDesktopLocale, readDesktopLocale } from './nextmux-locale';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { productMenuText } from './nextmux-product-menu-locale';
import type { ProductMenuTextKey } from './nextmux-product-menu-locale';
import { localizeDesktopSurface } from './nextmux-surface-locale';
import { workbenchText } from './nextmux-workbench-locale';
import { quitConfirmTexts } from './nextmux-quit-confirm-locale';

export const NextMuxDesktopCommand: Command = {
    id: 'nextmux.desktop.open',
    label: desktopText(readDesktopLocale(), 'workbench')
};

const NextMuxCommands = {
    navigateBack: { id: 'nextmux.desktop.navigateBack' },
    navigateForward: { id: 'nextmux.desktop.navigateForward' },
    newConversation: { id: 'nextmux.desktop.newConversation' },
    openFolder: { id: 'nextmux.desktop.openFolder' },
    saveFile: { id: 'nextmux.desktop.saveFile' },
    undo: { id: 'nextmux.desktop.undo' },
    redo: { id: 'nextmux.desktop.redo' },
    cut: { id: 'nextmux.desktop.cut' },
    copy: { id: 'nextmux.desktop.copy' },
    paste: { id: 'nextmux.desktop.paste' },
    selectAll: { id: 'nextmux.desktop.selectAll' },
    settings: { id: 'nextmux.desktop.settings' },
    findConversation: { id: 'nextmux.desktop.findConversation' },
    findAll: { id: 'nextmux.desktop.findAll' },
    terminal: { id: 'nextmux.desktop.terminal' },
    browser: { id: 'nextmux.desktop.browser' },
    modelCenter: { id: 'nextmux.desktop.modelCenter' },
    coding: { id: 'nextmux.desktop.coding' },
    comic: { id: 'nextmux.desktop.comic' },
    updates: { id: 'nextmux.desktop.updates' },
    website: { id: 'nextmux.desktop.website' },
    minimizeWindow: { id: 'nextmux.window.minimize' },
    zoomWindow: { id: 'nextmux.window.zoom' }
} as const;

/** Native Window menu, between View and Help. */
const WINDOW_MENU = [...MAIN_MENU_BAR, '8_window'];
const WINDOW_MENU_SIZE = [...WINDOW_MENU, '1_size'];

interface DesktopCloseAttempt {
    readonly token: string;
    readonly controller: AbortController;
    cancelled: boolean;
    saved: boolean;
    widget?: NextMuxDesktopWidget;
    promise?: Promise<void>;
}

@injectable()
export class NextMuxDesktopContribution extends AbstractViewContribution<NextMuxDesktopWidget> {
    @inject(FrontendApplicationStateService)
    protected readonly applicationState!: FrontendApplicationStateService;

    @inject(MenuModelRegistry)
    protected readonly menuRegistry!: MenuModelRegistry;

    protected productMenusConfigured = false;
    protected closePreparation: Promise<void> | undefined;
    protected closeBridgeDisposable: { dispose(): void } | undefined;
    /** When the main process last confirmed quitting over a running task (native dialog). */
    protected quitConfirmedAt = 0;
    protected activeCloseAttempt: DesktopCloseAttempt | undefined;
    protected readonly closeAttempts = new Map<string, DesktopCloseAttempt>();
    /** Registrations owned by the product projection and replaced on locale changes. */
    protected readonly productMenuRegistrations: Array<{ dispose(): void }> = [];

    protected readonly handleProductMenuLocaleChange = (event: Event): void => {
        const locale = event instanceof CustomEvent ? normalizeDesktopLocale(String(event.detail)) : readDesktopLocale();
        this.configureProductMenus(locale, true);
    };

    protected canHandleNavigationShortcut(target: EventTarget | null): boolean {
        const element = target instanceof Element ? target : undefined;
        return !element?.closest('.xterm, .monaco-editor, .nmx-terminal-host, .nmx-context-browser, webview, iframe, input, textarea, select')
            && !(element instanceof HTMLElement && element.isContentEditable);
    }

    protected readonly handleProductWorkbenchShortcut = (event: KeyboardEvent): void => {
        const key = event.key.toLocaleLowerCase();
        const primary = event.ctrlKey || event.metaKey;
        const plainPrimary = primary && !event.shiftKey && !event.altKey;
        const shiftedPrimary = primary && event.shiftKey && !event.altKey;
        const stockWorkspaceShortcut = primary && event.altKey && !event.shiftKey && (key === 'w' || key === 'r');
        const stockViewShortcut = shiftedPrimary && ['e', 'g', 'd', 'x', 'm', 'y', 'h'].includes(key);
        // The canvas owns Shift+Cmd/Ctrl+G (ungroup); this window listener runs before its capture handler.
        if (stockViewShortcut && key === 'g' && !event.isComposing && event.keyCode !== 229 && canvasKeyboardOwnsTarget(event.target)) return;
        const stockOverlayShortcut = event.key === 'F1'
            || (shiftedPrimary && key === 'p')
            || (plainPrimary && key === 'p');
        // Codex-style app shortcuts. ⌘N / ⌘B stay with terminals, editors and
        // the embedded browser, where Ctrl+N / Ctrl+B already mean something.
        const target = event.target instanceof Element ? event.target : undefined;
        const ownsKeys = Boolean(target?.closest('.xterm, .monaco-editor, .nmx-terminal-host, .nmx-context-browser, webview, iframe'));
        const navigationModifier = !event.shiftKey && !event.ctrlKey && (isOSX ? event.metaKey : event.altKey && !event.metaKey);
        const navigationAction = navigationModifier
            ? isOSX && !event.altKey && key === '[' ? 'back'
                : isOSX && !event.altKey && key === ']' ? 'forward'
                    : event.altKey && key === 'arrowleft' ? 'back'
                        : event.altKey && key === 'arrowright' ? 'forward'
                            : undefined
            : undefined;
        if (navigationAction && !ownsKeys && !event.defaultPrevented && !event.isComposing && event.keyCode !== 229 && this.canHandleNavigationShortcut(event.target)) {
            // Even at the end of app history, never let the browser navigate the renderer away.
            event.preventDefault();
            event.stopImmediatePropagation();
            const widget = this.tryGetWidget();
            if (navigationAction === 'back' && widget?.canNavigateBack()) widget.commandNavigateBack();
            else if (navigationAction === 'forward' && widget?.canNavigateForward()) widget.commandNavigateForward();
            return;
        }
        const productAction = plainPrimary && key === ',' ? 'settings'
            : shiftedPrimary && key === 'f' ? 'search'
                : plainPrimary && key === 'o' ? 'openFolder'
                    : plainPrimary && key === 'n' && !ownsKeys ? 'newConversation'
                        : plainPrimary && key === 'b' && !ownsKeys ? 'toggleSidebar'
                            : undefined;
        if (!stockWorkspaceShortcut && !stockViewShortcut && !stockOverlayShortcut && !productAction) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!productAction) return;
        void this.openView({ activate: true, reveal: true }).then(widget => {
            if (productAction === 'settings') widget.commandOpenSettings();
            else if (productAction === 'search') widget.commandFindAllConversations();
            else if (productAction === 'newConversation') widget.commandNewConversation();
            else if (productAction === 'toggleSidebar') widget.commandToggleSidebar();
            else widget.commandOpenFolder();
        });
    };

    constructor() {
        super({
            widgetId: NextMuxDesktopWidget.ID,
            widgetName: NextMuxDesktopWidget.LABEL,
            defaultWidgetOptions: { area: 'main' },
            toggleCommandId: NextMuxDesktopCommand.id
        });
    }

    initialize(): void {
        window.addEventListener('nextmux:desktop-locale-changed', this.handleProductMenuLocaleChange);
        window.addEventListener('keydown', this.handleProductWorkbenchShortcut, true);
        const closeBridge = window.nextmuxDesktop?.onPrepareClose?.(token => this.prepareApplicationClose(token));
        const cancelBridge = window.nextmuxDesktop?.onPrepareCloseCancelled?.((token, reason) => this.cancelApplicationClose(token, reason));
        // Quit with a running task is confirmed once, by the main process's native dialog.
        const quitCheck = window.nextmuxDesktop?.onQuitCheck?.(() => {
            const widget = this.tryGetWidget();
            return { running: Boolean(widget?.hasRunningConversationForExit?.()), texts: quitConfirmTexts(readDesktopLocale()) };
        });
        const quitConfirmed = window.nextmuxDesktop?.onQuitConfirmed?.(() => { this.quitConfirmedAt = Date.now(); });
        this.closeBridgeDisposable = { dispose: () => { closeBridge?.(); cancelBridge?.(); quitCheck?.(); quitConfirmed?.(); } };
        for (let index = 0; index < window.localStorage.length; index += 1) {
            const key = window.localStorage.key(index);
            if (!key?.endsWith(':layout')) continue;
            const raw = window.localStorage.getItem(key);
            if (!raw) continue;
            try {
                const serialized = JSON.parse(raw);
                if (typeof serialized !== 'string') continue;
                const layout = JSON.parse(serialized);
                let changed = false;
                const migrate = (value: unknown): unknown => {
                    if (Array.isArray(value)) {
                        const next = value.map(migrate).filter(item => item !== undefined);
                        if (next.length !== value.length) changed = true;
                        return next;
                    }
                    if (!value || typeof value !== 'object') return value;
                    const record = value as Record<string, unknown>;
                    const constructionOptions = record.constructionOptions as Record<string, unknown> | undefined;
                    if (constructionOptions?.factoryId === 'terminal') {
                        changed = true;
                        return undefined;
                    }
                    const migratedRecord = Object.fromEntries(Object.entries(record).map(([name, child]) => [name, migrate(child)]));
                    if (Array.isArray(migratedRecord.widgets) && typeof migratedRecord.currentIndex === 'number') {
                        migratedRecord.currentIndex = Math.min(migratedRecord.currentIndex, migratedRecord.widgets.length - 1);
                    }
                    return migratedRecord;
                };
                const migrated = migrate(layout);
                if (changed) window.localStorage.setItem(key, JSON.stringify(JSON.stringify(migrated)));
            } catch {
                continue;
            }
        }
    }

    protected prepareApplicationClose(token: string): Promise<void> {
        const existing = this.closeAttempts.get(token)?.promise;
        if (existing) return existing;
        const attempt: DesktopCloseAttempt = { token, controller: new AbortController(), cancelled: false, saved: false };
        this.closeAttempts.set(token, attempt);
        const operation = this.runApplicationClose(attempt).finally(() => {
            if (this.closeAttempts.get(token) === attempt) this.closeAttempts.delete(token);
        });
        attempt.promise = operation;
        return operation;
    }

    protected cancelApplicationClose(token: string, reason: 'timeout' | 'failed' | 'navigated'): void {
        const attempt = this.closeAttempts.get(token) || (this.activeCloseAttempt?.token === token ? this.activeCloseAttempt : undefined);
        if (!attempt || attempt.cancelled) return;
        attempt.cancelled = true;
        attempt.saved = false;
        attempt.controller.abort();
        if (this.activeCloseAttempt === attempt) {
            this.activeCloseAttempt = undefined;
            attempt.widget?.cancelApplicationExit(reason);
        }
    }

    protected async runApplicationClose(attempt: DesktopCloseAttempt): Promise<void> {
        const bridge = window.nextmuxDesktop;
        const wait = <T,>(work: PromiseLike<T> | T): Promise<T> => new Promise<T>((resolve, reject) => {
            const cancel = (): void => { attempt.controller.signal.removeEventListener('abort', cancel); reject(new Error('APPLICATION_EXIT_CANCELLED')); };
            if (attempt.controller.signal.aborted) return cancel();
            attempt.controller.signal.addEventListener('abort', cancel, { once: true });
            Promise.resolve(work).then(value => { attempt.controller.signal.removeEventListener('abort', cancel); resolve(value); }, error => {
                attempt.controller.signal.removeEventListener('abort', cancel); reject(error);
            });
        });
        try {
            if (!bridge || await wait(bridge.beginPrepareClose(attempt.token)) !== true || attempt.cancelled) return;
            attempt.widget = this.tryGetWidget();
            this.activeCloseAttempt = attempt;
            // The native quit dialog already asked (valid for this quit only).
            const quitAlreadyConfirmed = Date.now() - this.quitConfirmedAt < 60_000;
            if (!quitAlreadyConfirmed && attempt.widget?.hasRunningConversationForExit?.() && !await wait(bridge.confirmRunningQuit
                ? bridge.confirmRunningQuit(quitConfirmTexts(readDesktopLocale())) : Promise.resolve(attempt.widget.confirmApplicationExit?.() ?? true))) {
                await bridge.completePrepareClose(attempt.token, 'failed');
                this.cancelApplicationClose(attempt.token, 'failed');
                return;
            }
            // Cancellation releases the previous wait. Its durable writes may
            // still finish, but this nonce always performs its own current flush.
            if (this.closePreparation) await wait(this.closePreparation.catch(() => undefined));
            if (attempt.cancelled || this.activeCloseAttempt !== attempt) return;
            if (attempt.widget !== this.tryGetWidget()) {
                this.cancelApplicationClose(attempt.token, 'navigated');
                await bridge.completePrepareClose(attempt.token, 'failed');
                return;
            }
            attempt.widget?.beginApplicationExit();
            // The normal shutdownForApplicationExit() path is acknowledged by
            // completePrepareClose only after its bounded save has settled.
            const save = wait(Promise.resolve().then(() => attempt.widget?.shutdownForApplicationExit(attempt.controller.signal)));
            this.closePreparation = save;
            try { await save; }
            finally { if (this.closePreparation === save) this.closePreparation = undefined; }
            if (attempt.cancelled || this.activeCloseAttempt !== attempt) return;
            attempt.saved = true;
            if (await wait(bridge.completePrepareClose(attempt.token, 'saved')) !== true) {
                this.cancelApplicationClose(attempt.token, 'failed');
            }
        } catch {
            if (attempt.cancelled) return;
            // Failure details can contain user content. Keep them out of IPC/logs.
            try { await bridge?.completePrepareClose(attempt.token, 'failed'); } catch { /* main timeout also cancels */ }
            this.cancelApplicationClose(attempt.token, 'failed');
        }
    }

    async onStop(): Promise<void> {
        try {
            if (this.closePreparation) await this.closePreparation;
            else if (!this.activeCloseAttempt?.saved) await this.tryGetWidget()?.shutdownForApplicationExit();
        } finally {
            this.closeBridgeDisposable?.dispose();
            this.closeBridgeDisposable = undefined;
            for (const registration of this.productMenuRegistrations.splice(0)) registration.dispose();
            window.removeEventListener('nextmux:desktop-locale-changed', this.handleProductMenuLocaleChange);
            window.removeEventListener('keydown', this.handleProductWorkbenchShortcut, true);
        }
    }

    override registerCommands(commands: CommandRegistry): void {
        const locale = readDesktopLocale();
        commands.registerCommand({ ...NextMuxDesktopCommand, label: desktopText(locale, 'workbench') }, {
            execute: () => this.openView({ activate: true, reveal: true })
        });
        const withWidget = (action: (widget: NextMuxDesktopWidget) => void | Promise<void>) => async (): Promise<void> => {
            const widget = await this.openView({ activate: true, reveal: true });
            await action(widget);
        };
        const enabledWithWidget = (predicate: (widget: NextMuxDesktopWidget) => boolean) => (): boolean => {
            const widget = this.tryGetWidget();
            return Boolean(widget && predicate(widget));
        };
        // Keybinding args keep the registry fallback from reclaiming keys that the capture handler leaves to an editor.
        const navigationEnabledWithWidget = (predicate: (widget: NextMuxDesktopWidget) => boolean) => (fromKeybinding?: boolean): boolean =>
            (!fromKeybinding || this.canHandleNavigationShortcut(document.activeElement)) && enabledWithWidget(predicate)();
        commands.registerCommand({ ...NextMuxCommands.navigateBack, label: localizeDesktopSurface(locale, '返回上一页') }, {
            execute: withWidget(widget => widget.commandNavigateBack()),
            isEnabled: navigationEnabledWithWidget(widget => widget.canNavigateBack())
        });
        commands.registerCommand({ ...NextMuxCommands.navigateForward, label: localizeDesktopSurface(locale, '前进到下一页') }, {
            execute: withWidget(widget => widget.commandNavigateForward()),
            isEnabled: navigationEnabledWithWidget(widget => widget.canNavigateForward())
        });
        commands.registerCommand({ ...NextMuxCommands.newConversation, label: desktopText(locale, 'newTask') }, { execute: withWidget(widget => widget.commandNewConversation()) });
        commands.registerCommand({ ...NextMuxCommands.openFolder, label: desktopText(locale, 'openLocalProject') }, { execute: withWidget(widget => widget.commandOpenFolder()) });
        commands.registerCommand({ ...NextMuxCommands.saveFile, label: productMenuText(locale, 'save') }, {
            execute: withWidget(widget => widget.commandSaveCurrentFile()),
            isEnabled: enabledWithWidget(widget => widget.canRunDesktopContextCommand('saveFile'))
        });
        for (const [key, command] of [
            ['undo', NextMuxCommands.undo], ['redo', NextMuxCommands.redo], ['cut', NextMuxCommands.cut],
            ['copy', NextMuxCommands.copy], ['paste', NextMuxCommands.paste], ['selectAll', NextMuxCommands.selectAll]
        ] as const) {
            commands.registerCommand({ ...command, label: productMenuText(locale, key) }, {
                execute: withWidget(widget => widget.commandRunEditingCommand(key)),
                isEnabled: enabledWithWidget(widget => widget.canRunEditingCommand(key))
            });
        }
        commands.registerCommand({ ...NextMuxCommands.settings, label: productMenuText(locale, 'preferences') }, { execute: withWidget(widget => widget.commandOpenSettings()) });
        commands.registerCommand({ ...NextMuxCommands.findConversation, label: localizeDesktopSurface(locale, '搜索当前对话') }, {
            execute: withWidget(widget => widget.commandFindCurrentConversation()),
            isEnabled: enabledWithWidget(widget => widget.canRunDesktopContextCommand('findConversation'))
        });
        commands.registerCommand({ ...NextMuxCommands.findAll, label: localizeDesktopSurface(locale, '搜索全局对话') }, { execute: withWidget(widget => widget.commandFindAllConversations()) });
        commands.registerCommand({ ...NextMuxCommands.terminal, label: productMenuText(locale, 'terminal') }, {
            execute: withWidget(widget => widget.commandToggleTerminal()),
            isEnabled: enabledWithWidget(widget => widget.canRunDesktopContextCommand('terminal'))
        });
        commands.registerCommand({ ...NextMuxCommands.browser, label: workbenchText(locale, 'browser') }, {
            execute: withWidget(widget => widget.commandToggleBrowser()),
            isEnabled: enabledWithWidget(widget => widget.canRunDesktopContextCommand('browser'))
        });
        commands.registerCommand({ ...NextMuxCommands.modelCenter, label: desktopText(locale, 'modelCenter') }, { execute: withWidget(widget => widget.commandSelectSection('models')) });
        commands.registerCommand({ ...NextMuxCommands.coding, label: desktopText(locale, 'coding') }, { execute: withWidget(widget => widget.commandSelectSection('coding')) });
        commands.registerCommand({ ...NextMuxCommands.comic, label: desktopText(locale, 'comic') }, { execute: withWidget(widget => widget.commandSelectSection('comic')) });
        commands.registerCommand({ ...NextMuxCommands.updates, label: productMenuText(locale, 'checkUpdates') }, { execute: withWidget(widget => widget.commandOpenUpdates()) });
        commands.registerCommand({ ...NextMuxCommands.website, label: productMenuText(locale, 'website') }, { execute: withWidget(widget => widget.commandOpenWebsite()) });
        commands.registerCommand({ ...NextMuxCommands.minimizeWindow, label: productMenuText(locale, 'minimize') }, { execute: () => void window.nextmuxDesktop?.minimizeDesktopWindow?.() });
        commands.registerCommand({ ...NextMuxCommands.zoomWindow, label: productMenuText(locale, 'zoom') }, { execute: () => void window.nextmuxDesktop?.zoomDesktopWindow?.() });
    }

    override registerKeybindings(keybindings: KeybindingRegistry): void {
        super.registerKeybindings(keybindings);
        // The widget also handles these in a capture listener so they win over stock Theia bindings;
        // registering them here puts the shortcut next to the menu item.
        if (isOSX) keybindings.registerKeybinding({ command: NextMuxCommands.minimizeWindow.id, keybinding: 'cmd+m' });
        keybindings.registerKeybinding({ command: NextMuxCommands.newConversation.id, keybinding: 'ctrlcmd+n' });
        keybindings.registerKeybinding({ command: NextMuxCommands.settings.id, keybinding: 'ctrlcmd+,' });
        for (const keybinding of isOSX ? ['cmd+[', 'cmd+alt+left'] : ['alt+left']) {
            keybindings.registerKeybinding({ command: NextMuxCommands.navigateBack.id, keybinding, args: true });
        }
        for (const keybinding of isOSX ? ['cmd+]', 'cmd+alt+right'] : ['alt+right']) {
            keybindings.registerKeybinding({ command: NextMuxCommands.navigateForward.id, keybinding, args: true });
        }
    }

    override registerMenus(menus: MenuModelRegistry): void {
        // Menu contributions are collected synchronously. Defer the final
        // product-only projection until every stock contribution has had its
        // registration turn, but still before the menu bar is rendered.
        queueMicrotask(() => this.configureProductMenus());
    }

    /**
     * The desktop shell is a focused product surface rather than a stock Theia
     * IDE. Keep the native menu bar, but only expose commands that have a real
     * counterpart in the NextMux workbench. This also prevents the very tall
     * default View menu from pushing the titlebar interaction area around.
     */
    protected registerProductMenuAction(
        menus: MenuModelRegistry,
        path: string[],
        item: Parameters<MenuModelRegistry['registerMenuAction']>[1]
    ): void {
        this.productMenuRegistrations.push(menus.registerMenuAction(path, item));
    }

    protected registerProductMenuActions(menus: MenuModelRegistry, locale: NextMuxDesktopLocale): void {
        this.registerProductMenuAction(menus, CommonMenus.FILE_NEW, { commandId: NextMuxCommands.newConversation.id, label: desktopText(locale, 'newTask'), order: 'a10' });
        this.registerProductMenuAction(menus, CommonMenus.FILE_OPEN, { commandId: NextMuxCommands.openFolder.id, label: desktopText(locale, 'openLocalProject'), order: 'a10' });
        this.registerProductMenuAction(menus, CommonMenus.FILE_SAVE, { commandId: NextMuxCommands.saveFile.id, label: productMenuText(locale, 'save'), order: 'a10' });
        this.registerProductMenuAction(menus, CommonMenus.FILE_SETTINGS, { commandId: NextMuxCommands.settings.id, label: productMenuText(locale, 'preferences'), order: 'a10' });
        this.registerProductMenuAction(menus, CommonMenus.FILE_CLOSE, { commandId: 'close.window', label: productMenuText(locale, 'closeWindow'), order: 'z10' });
        this.registerProductMenuAction(menus, CommonMenus.EDIT_UNDO, { commandId: NextMuxCommands.undo.id, label: productMenuText(locale, 'undo'), order: 'a10' });
        this.registerProductMenuAction(menus, CommonMenus.EDIT_UNDO, { commandId: NextMuxCommands.redo.id, label: productMenuText(locale, 'redo'), order: 'a20' });
        this.registerProductMenuAction(menus, CommonMenus.EDIT_CLIPBOARD, { commandId: NextMuxCommands.cut.id, label: productMenuText(locale, 'cut'), order: 'a10' });
        this.registerProductMenuAction(menus, CommonMenus.EDIT_CLIPBOARD, { commandId: NextMuxCommands.copy.id, label: productMenuText(locale, 'copy'), order: 'a20' });
        this.registerProductMenuAction(menus, CommonMenus.EDIT_CLIPBOARD, { commandId: NextMuxCommands.paste.id, label: productMenuText(locale, 'paste'), order: 'a30' });
        this.registerProductMenuAction(menus, CommonMenus.EDIT_CLIPBOARD, { commandId: NextMuxCommands.selectAll.id, label: productMenuText(locale, 'selectAll'), order: 'a40' });
        this.registerProductMenuAction(menus, CommonMenus.EDIT_FIND, { commandId: NextMuxCommands.findConversation.id, label: localizeDesktopSurface(locale, '搜索当前对话'), order: 'a10' });
        this.registerProductMenuAction(menus, CommonMenus.EDIT_FIND, { commandId: NextMuxCommands.findAll.id, label: localizeDesktopSurface(locale, '搜索全局对话'), order: 'a20' });
        this.registerProductMenuAction(menus, CommonMenus.VIEW_VIEWS, { commandId: NextMuxCommands.terminal.id, label: productMenuText(locale, 'terminal'), order: 'a10' });
        this.registerProductMenuAction(menus, CommonMenus.VIEW_VIEWS, { commandId: NextMuxCommands.browser.id, label: workbenchText(locale, 'browser'), order: 'a20' });
        this.registerProductMenuAction(menus, CommonMenus.VIEW_PRIMARY, { commandId: NextMuxCommands.modelCenter.id, label: desktopText(locale, 'modelCenter'), order: 'a10' });
        this.registerProductMenuAction(menus, CommonMenus.VIEW_PRIMARY, { commandId: NextMuxCommands.coding.id, label: desktopText(locale, 'coding'), order: 'a20' });
        this.registerProductMenuAction(menus, CommonMenus.VIEW_PRIMARY, { commandId: NextMuxCommands.comic.id, label: desktopText(locale, 'comic'), order: 'a30' });
        this.registerProductMenuAction(menus, WINDOW_MENU_SIZE, { commandId: NextMuxCommands.minimizeWindow.id, label: productMenuText(locale, 'minimize'), order: 'a10' });
        this.registerProductMenuAction(menus, WINDOW_MENU_SIZE, { commandId: NextMuxCommands.zoomWindow.id, label: productMenuText(locale, 'zoom'), order: 'a20' });
        this.registerProductMenuAction(menus, WINDOW_MENU_SIZE, { commandId: 'workbench.action.toggleFullScreen', label: productMenuText(locale, 'fullScreen'), order: 'a30' });
        this.registerProductMenuAction(menus, CommonMenus.HELP, { commandId: NextMuxCommands.updates.id, label: productMenuText(locale, 'checkUpdates'), order: 'z10' });
        this.registerProductMenuAction(menus, CommonMenus.HELP, { commandId: NextMuxCommands.website.id, label: productMenuText(locale, 'website'), order: 'z20' });
    }

    protected configureProductMenus(locale = readDesktopLocale(), force = false): void {
        if (this.productMenusConfigured && !force) return;
        this.productMenusConfigured = true;
        for (const registration of this.productMenuRegistrations.splice(0)) registration.dispose();
        const menuBar = this.menuRegistry.getMenu(MAIN_MENU_BAR);
        if (menuBar && MutableCompoundMenuNode.is(menuBar)) {
            for (const child of [...menuBar.children]) menuBar.removeNode(child);
        }
        // Populate the action groups before promoting the four top-level groups
        // to rendered submenus. `registerMenuAction` does not emit a model-change
        // event when an action is added, while `registerSubmenu` does. Registering
        // labels first therefore leaves an already-mounted Lumino menu bar with
        // four visible but empty (and consequently unclickable) menus after a
        // locale switch. Promoting the populated groups last rebuilds each menu
        // with its real actions and keeps the menu bar interactive.
        this.registerProductMenuActions(this.menuRegistry, locale);
        this.registerProductMenuLabels(this.menuRegistry, locale);
    }

    protected registerProductMenuLabels(menus: MenuModelRegistry, locale: NextMuxDesktopLocale): void {
        const productMenus: readonly [readonly string[], ProductMenuTextKey][] = [
            [CommonMenus.FILE, 'file'],
            [CommonMenus.EDIT, 'edit'],
            [CommonMenus.VIEW, 'view'],
            [WINDOW_MENU, 'window'],
            [CommonMenus.HELP, 'help']
        ];
        for (const [path, key] of productMenus) {
            this.productMenuRegistrations.push(menus.registerSubmenu([...path], productMenuText(locale, key)));
        }
    }

    async initializeLayout(): Promise<void> {
        this.configureProductMenus();
        await this.openView({ activate: false, reveal: true });
    }

    onDidInitializeLayout(): void {
        void this.restoreWorkbenchAfterStartup();
    }

    protected async restoreWorkbenchAfterStartup(): Promise<void> {
        await this.applicationState.reachedState('ready');
        await this.openView({ activate: false, reveal: true });
    }
}
