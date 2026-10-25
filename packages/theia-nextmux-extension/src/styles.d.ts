declare module '*.css';
declare module '*.svg' {
    const assetUrl: string;
    export default assetUrl;
}

interface NextMuxDesktopUpdateState {
    readonly phase: 'idle' | 'checking' | 'available' | 'downloading' | 'current' | 'ready' | 'error' | 'unsupported';
    readonly revision?: number;
    readonly preparing?: boolean;
    readonly restartRequired?: boolean;
    readonly currentVersion: string;
    readonly version: string;
    readonly progress: number;
    readonly packaged: boolean;
    readonly portable: boolean;
    readonly checkedAt: number;
    readonly nextCheckAt: number;
    readonly transferred?: number;
    readonly total?: number;
    readonly reason?: 'portable' | 'development';
    readonly errorCode?: string;
    readonly targetRevision?: number;
    readonly updateDirection?: 'upgrade' | 'downgrade' | 'current';
    readonly rollbackAuthorized?: boolean;
}

/** Which plugin runs an option change reaches: one tab's run (runId/tabId/conversationId) or only the saved defaults. */
interface AppPluginParamScope {
    readonly scope?: 'defaults';
    readonly runId?: string;
    readonly conversationId?: string;
    readonly tabId?: string;
    readonly ephemeral?: boolean;
}

interface NextMuxDesktopBridge {
    readonly ownedBrowser?: import('./common/nextmux-owned-browser').OwnedBrowserBridge;
    setAppLocale?(locale: string): Promise<boolean>;
    getConversationWindowState(): Promise<import('./common/nextmux-conversation-window').ConversationWindowState | false>;
    reportConversationSyncDiagnostic(payload: import('./common/nextmux-conversation-window').ConversationSyncDiagnostic): Promise<boolean>;
    publishConversationWindows(deltas: import('./common/nextmux-conversation-window').ConversationWindowDelta[], removed?: string[]): Promise<boolean>;
    openConversationWindows(ids: string[], origin?: { readonly x: number; readonly y: number }): Promise<boolean>;
    focusConversationWindow(id: string): Promise<boolean>;
    reclaimConversationWindows(): Promise<boolean>;
    setConversationWindowRunning(sessionId: string, running: boolean): Promise<boolean>;
    flushConversationWindows(): Promise<boolean | 'unavailable' | 'primary'>;
    acknowledgeConversationWindowFlush(id: string, saved: boolean): Promise<void>;
    releaseConversationWindow(): Promise<boolean>;
    claimConversationRun(id: string, release?: boolean): Promise<boolean>;
    closeDesktopWindow(): Promise<boolean>;
    minimizeDesktopWindow?(): Promise<boolean>;
    onQuitCheck?(callback: () => { readonly running: boolean; readonly texts?: { readonly title: string; readonly body: string; readonly quit: string; readonly stay: string } }): () => void;
    onQuitConfirmed?(callback: () => void): () => void;
    /** The native “a task is still running” dialog (never a blocking in-page confirm); true to quit. */
    confirmRunningQuit?(texts: { readonly title: string; readonly body: string; readonly quit: string; readonly stay: string }): Promise<boolean>;
    zoomDesktopWindow?(): Promise<boolean>;
    showMainWindow(): Promise<boolean>;
    /** Hides native window buttons (macOS) while a modal covers the window. */
    setModalChrome?(open: boolean): Promise<boolean>;
    onConversationWindowEvent(callback: (event: import('./common/nextmux-conversation-window').ConversationWindowEvent) => void): () => void;
    onConversationWindowHighlight(callback: () => void): () => void;
    getSpeechCapability?: import('./common/nextmux-native-dictation').NativeDictationBridge['getSpeechCapability'];
    startSpeech?: import('./common/nextmux-native-dictation').NativeDictationBridge['startSpeech'];
    finishSpeech?: import('./common/nextmux-native-dictation').NativeDictationBridge['finishSpeech'];
    cancelSpeech?: import('./common/nextmux-native-dictation').NativeDictationBridge['cancelSpeech'];
    onSpeechEvent?: import('./common/nextmux-native-dictation').NativeDictationBridge['onSpeechEvent'];
    getUpdateState(): Promise<NextMuxDesktopUpdateState>;
    checkForUpdates(): Promise<NextMuxDesktopUpdateState>;
    downloadUpdate(): Promise<boolean>;
    installUpdate(): Promise<boolean>;
    openDownloadPage(): Promise<boolean>;
    openExternal(url: string): Promise<boolean>;
    performBrowserAction?(guestId: number, request: import('./common/nextmux-platform-protocol').DesktopBrowserToolRequest): Promise<import('./common/nextmux-platform-protocol').DesktopBrowserToolResult>;
    cancelBrowserAction?(guestId: number, requestId: string): Promise<boolean>;
    releaseBrowserAutomation?(conversationId: string): Promise<boolean>;
    getComputerCapability?(): Promise<import('./common/nextmux-computer-automation').DesktopComputerCapability>;
    requestComputerPermission?(): Promise<import('./common/nextmux-computer-automation').DesktopComputerCapability>;
    performComputerAction?(request: import('./common/nextmux-computer-automation').DesktopComputerToolRequest): Promise<import('./common/nextmux-computer-automation').DesktopComputerToolResult>;
    cancelComputerAction?(conversationId: string, requestId: string): Promise<boolean>;
    releaseComputerSession?(conversationId: string): Promise<boolean>;
    getComputerViewCapability?(): Promise<import('./browser/nextmux-conversation-tabs-view').ComputerViewCapability>;
    setComputerViewPreference?(value: 'tab' | 'desktop'): Promise<import('./browser/nextmux-conversation-tabs-view').ComputerViewCapability>;
    startComputerWindowView?(conversationId: string, pid: number, windowId: number): Promise<{ readonly ok: boolean; readonly placement?: 'tab' | 'desktop'; readonly sound?: boolean; readonly error?: string }>;
    openComputerTabWindow?(request: { readonly conversationId: string; readonly tabId: string; readonly pid: number; readonly windowId: number; readonly title: string;
        readonly point: { readonly x: number; readonly y: number }; readonly theme: 'light' | 'dark'; readonly dir: 'ltr' | 'rtl'; readonly labels: Readonly<Record<string, string>> }): Promise<boolean>;
    closeComputerTabWindow?(conversationId: string, tabId: string, merge?: boolean): Promise<boolean>;
    focusComputerTabWindow?(conversationId: string, tabId: string): Promise<boolean>;
    onComputerTabWindowEvent?(callback: (event: { readonly type: 'closed'; readonly conversationId: string; readonly tabId: string; readonly merged?: boolean }) => void): () => void;
    onComputerTabEvent?(callback: (event: { readonly type: 'window-added' | 'window-closed' | 'input-blocked' | 'state' | 'user-stop'; readonly conversationId: string; readonly pid: number; readonly windowId: number;
        readonly root?: number; readonly familyId?: string; readonly role?: 'launcher' | 'client' | 'game' | 'app'; readonly windows?: readonly import('./browser/nextmux-conversation-tabs').ConversationTabWindowItem[]; readonly title?: string; readonly app?: string; readonly placement?: 'tab' | 'desktop'; readonly sound?: boolean; readonly keyboardMouse?: boolean }) => void): () => void;
    openAppInTab?(conversationId: string, selector: string, options?: { readonly onlyIfRunning?: boolean; readonly probeOnly?: boolean; readonly checkOrOpen?: boolean; readonly restartIfRunning?: boolean;
        /** Who opens it: only 'agent' and 'plugin' light the "controlling the computer" frame (and are refused after Esc). */
        readonly source?: 'agent' | 'plugin' | 'user' | 'passive' }): Promise<{ readonly ok: boolean; readonly running?: boolean; readonly requiresRestart?: boolean; readonly root?: number; readonly familyId?: string; readonly role?: 'launcher' | 'client' | 'game' | 'app'; readonly windows?: readonly import('./browser/nextmux-conversation-tabs').ConversationTabWindowItem[]; readonly pid?: number; readonly windowId?: number; readonly app?: string; readonly appId?: string; readonly programs?: readonly string[]; readonly launched?: boolean; readonly title?: string; readonly placement?: 'tab' | 'desktop'; readonly error?: string }>;
    computerWindowSnapshot?(conversationId: string, pid: number, windowId: number, maxSize?: number, options?: { readonly source?: 'agent' | 'user' }): Promise<{ readonly ok: boolean; readonly mimeType?: string; readonly data?: string; readonly width?: number; readonly height?: number; readonly error?: string; readonly userInterrupted?: boolean }>;
    computerWindowKeys?(conversationId: string, input: { readonly pid: number; readonly windowId: number; readonly text?: string; readonly key?: string; readonly keys?: readonly string[]; readonly modifiers?: readonly string[]; readonly holdMs?: number; readonly restore?: boolean; readonly delivery?: 'auto' | 'background' | 'foreground'; readonly source?: 'agent' | 'user' }): Promise<{ readonly ok: boolean; readonly delivery?: 'background' | 'foreground'; readonly error?: string }>;
    /** delivery: the AI's and plugins' input goes to the window in the background first ('auto'); the user's own clicks omit it (foreground). */
    computerWindowPointer?(conversationId: string, input: { readonly pid: number; readonly windowId: number; readonly restore?: boolean; readonly delivery?: 'auto' | 'background' | 'foreground'; readonly source?: 'agent' | 'user' } & (
        { readonly kind: 'click' | 'doubleClick' | 'scroll'; readonly x: number; readonly y: number; readonly button?: 'left' | 'right'; readonly direction?: 'up' | 'down' | 'left' | 'right'; readonly amount?: number; readonly whole?: boolean }
        | { readonly kind: 'drag'; readonly from: { readonly x: number; readonly y: number }; readonly to: { readonly x: number; readonly y: number }; readonly durationMs?: number }
    )): Promise<{ readonly ok: boolean; readonly delivery?: 'background' | 'foreground'; readonly error?: string }>;
    clearComputerUserEsc?(conversationId: string): Promise<boolean>;
    setComputerWindowSound?(conversationId: string, pid: number, windowId: number, on: boolean): Promise<{ readonly ok: boolean; readonly sound?: boolean; readonly error?: string }>;
    setComputerWindowUserInput?(conversationId: string, pid: number, windowId: number, on: boolean): Promise<{ readonly ok: boolean; readonly on?: boolean; readonly locks?: boolean; readonly error?: string }>;
    getDataLocation?(): Promise<import('./browser/nextmux-data-location').DesktopDataLocation | undefined>;
    chooseDataLocation?(): Promise<string | undefined>;
    moveDataLocation?(target: string, locale: string): Promise<{ readonly ok: boolean; readonly error?: string; readonly bytes?: number }>;
    revealDataLocation?(): Promise<boolean>;
    computerWindowState?(conversationId: string, pid: number, windowId: number): Promise<{ readonly ok: boolean; readonly alive?: boolean; readonly placement?: 'tab' | 'desktop'; readonly sound?: boolean; readonly keyboardMouse?: boolean; readonly canPark?: boolean; readonly parkReason?: string; readonly lock?: boolean; readonly soundScope?: 'process'; readonly error?: string }>;
    placeComputerWindow?(conversationId: string, pid: number, windowId: number, placement: 'tab' | 'desktop', activate: boolean): Promise<{ readonly ok: boolean; readonly placement?: 'tab' | 'desktop'; readonly error?: string }>;
    forgetComputerWindow?(conversationId: string, pid?: number, windowId?: number, close?: boolean): Promise<boolean>;
    terminateComputerWindow?(conversationId: string, pid: number, windowId: number): Promise<{ readonly ok: boolean; readonly error?: string }>;
    systemNotificationsSupported?(): Promise<boolean>;
    showSystemNotification?(request: { readonly title: string; readonly body: string; readonly target?: string; readonly silent?: boolean }): Promise<boolean>;
    onSystemNotificationClick?(callback: (target: string) => void): () => void;
    renewAutomationLeases?(conversationIds: readonly string[]): Promise<boolean>;
    openLocalPath(path: string): Promise<boolean>;
    /** Moves a comic project or library character folder to the system Trash (main checks it is one). */
    trashFolder?(path: string): Promise<boolean>;
    /** 应用操控: the system's app picker (Applications on macOS, the Start menu's programs on Windows). */
    pickApplication?(title?: string): Promise<{ name: string; id: string; path: string; icon: string } | undefined>;
    /** An app dragged in (.app on macOS; .exe/.lnk on Windows), described like a picked one; undefined when the path is not an app. */
    describeApplication?(path: string): Promise<{ name: string; id: string; path: string; icon: string } | undefined>;
    /** The icon (data URL, '' when unknown) of the app with this bundle id / program name. */
    applicationIcon?(id: string): Promise<string>;
    // Skill plugins (技能插件, apps/desktop/app-plugins.cjs).
    listAppPlugins?(locale: string): Promise<import('./common/nextmux-app-plugins').AppPluginInfo[]>;
    inspectAppPlugin?(locale: string, title?: string): Promise<import('./common/nextmux-app-plugins').AppPluginInspection>;
    inspectAppPluginBytes?(locale: string, dataBase64: string, origin: import('./common/nextmux-app-plugins').AppPluginTrust & { id: string; version: string; verified: boolean }): Promise<import('./common/nextmux-app-plugins').AppPluginInspection>;
    installAppPlugin?(token: string, gate?: { readonly paid: boolean; readonly license?: import('./common/nextmux-app-plugins').AppPluginLicense }): Promise<{ ok: boolean; id?: string; error?: string }>;
    addAppPluginFolder?(title?: string): Promise<{ ok: boolean; id?: string; cancelled?: boolean; errors?: string[]; diagnostics?: import('./common/nextmux-app-plugins').AppPluginDiagnostic[]; error?: string }>;
    reloadAppPlugin?(id: string): Promise<{ ok: boolean; errors?: string[]; diagnostics?: import('./common/nextmux-app-plugins').AppPluginDiagnostic[]; error?: string }>;
    uninstallAppPlugin?(id: string): Promise<{ ok: boolean; error?: string }>;
    configureAppPlugin?(id: string, settings: { enabled?: boolean; model?: import('./common/nextmux-app-plugins').AppPluginModel | null; vision?: import('./common/nextmux-app-plugins').AppPluginVisionModel | null; params?: Readonly<Record<string, unknown>> } & AppPluginParamScope): Promise<{ ok: boolean; params?: Readonly<Record<string, import('./common/nextmux-app-plugins').AppPluginParamValue>>; error?: string }>;
    pickAppPluginParamFile?(id: string, paramId: string, filePath?: string, options?: AppPluginParamScope): Promise<{ ok: boolean; cancelled?: boolean; param?: import('./common/nextmux-app-plugins').AppPluginParamFileValue; params?: Readonly<Record<string, import('./common/nextmux-app-plugins').AppPluginParamValue>>; error?: string }>;
    pickAppPluginFolder?(initialPath?: string): Promise<{ canceled: boolean; path: string }>;
    testAppPlugin?(id: string): Promise<{ ok: boolean; results?: { name: string; ok: boolean; failures: string[]; diagnostics?: import('./common/nextmux-app-plugins').AppPluginDiagnostic[]; defaultName?: boolean }[]; errors?: string[]; diagnostics?: import('./common/nextmux-app-plugins').AppPluginDiagnostic[]; error?: string }>;
    startAppPlugin?(request: import('./common/nextmux-app-plugins').AppPluginStartRequest): Promise<{ ok: boolean; runId?: string; mode?: string; maxMinutes?: number; maxCostUsd?: number; stopShortcut?: string; error?: string; app?: string; errors?: string[]; diagnostics?: import('./common/nextmux-app-plugins').AppPluginDiagnostic[] }>;
    commandAppPlugin?(runId: string, command: { goal?: string; resume?: boolean; pause?: boolean; overlay?: boolean; params?: Readonly<Record<string, unknown>> }): Promise<{ ok: boolean; error?: string } & Partial<import('./common/nextmux-app-plugins').AppPluginRunSnapshot>>;
    appPluginStatus?(runId: string): Promise<{ ok: boolean; error?: string } & Partial<import('./common/nextmux-app-plugins').AppPluginRunSnapshot>>;
    stopAppPlugin?(runId: string): Promise<{ ok: boolean; error?: string } & Partial<import('./common/nextmux-app-plugins').AppPluginRunSnapshot>>;
    appPluginRuns?(): Promise<import('./common/nextmux-app-plugins').AppPluginRunSnapshot[]>;
    answerAppPlugin?(requestId: string, result: unknown): Promise<boolean>;
    onAppPluginEvent?(callback: (message: import('./common/nextmux-app-plugins').AppPluginMessage) => void): () => void;
    /** Apps NextMux opened for tabs: quit with their tab and with NextMux ("quit", default), or go back to the desktop. */
    setComputerTabCloseBehavior?(value: 'quit' | 'desktop'): Promise<'quit' | 'desktop'>;
    openMicrophoneSettings(): Promise<boolean>;
    getMicrophonePermission(): Promise<{
        readonly status: 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown';
        readonly requested: boolean;
        readonly restartRequired: boolean;
        readonly platform: string;
        readonly osRelease: string;
        readonly arch: string;
        readonly scope: 'application' | 'desktop-apps' | 'unsupported';
    }>;
    requestMicrophonePermission(): ReturnType<NextMuxDesktopBridge['getMicrophonePermission']>;
    clearCache(): Promise<{ readonly cleared: true; readonly at: number }>;
    getCacheSize?(): Promise<number>;
    takePendingDeepLinks(): Promise<readonly string[]>;
    getPathForFile(file: File): string;
    onUpdateState(callback: (state: NextMuxDesktopUpdateState) => void): () => void;
    onNavigationCommand(callback: (direction: 'back' | 'forward') => void): () => void;
    onPrepareClose(callback: (token: string) => void | Promise<void>): () => void;
    registerIncognitoConversation?(request: { id: string; workspaceRoot: string }): Promise<boolean>;
    setIncognitoConversationMode?(request: { id: string; workspaceRoot: string; enabled: boolean }): Promise<boolean>;
    finishIncognitoConversations?(ids: readonly string[]): Promise<boolean>;
    isApplicationQuitting?(): Promise<boolean>;
    beginPrepareClose(token: string): Promise<boolean>;
    completePrepareClose(token: string, outcome: 'saved' | 'failed'): Promise<boolean>;
    onPrepareCloseCancelled(callback: (token: string, reason: 'timeout' | 'failed' | 'navigated') => void | Promise<void>): () => void;
    onDeepLink(callback: (url: string) => void): () => void;
}

interface NextMuxBrowserController {
    list(): readonly { readonly id: string; readonly url: string; readonly title: string; readonly active: boolean }[];
    open(url?: string): string | undefined;
    activate(id: string): boolean;
    close(id: string): boolean;
    navigate(id: string, url: string): boolean;
    back(id: string): boolean;
    forward(id: string): boolean;
    reload(id: string): boolean;
    execute(id: string, source: string): Promise<unknown>;
}

interface Window {
    readonly nextmuxDesktop?: NextMuxDesktopBridge;
    readonly nextmuxBrowserController?: NextMuxBrowserController;
}
