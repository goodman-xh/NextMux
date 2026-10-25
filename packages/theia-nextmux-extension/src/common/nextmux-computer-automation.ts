/** Host-owned computer-use requests. These identifiers never come from model arguments. */
export type DesktopComputerAction = 'listApps' | 'listWindows' | 'openApp' | 'observeWindow' | 'verifyState'
    | 'click' | 'doubleClick' | 'rightClick' | 'scroll' | 'drag' | 'setValue' | 'typeText' | 'pressKey' | 'hotkey';
/**
 * The AI's own tabs above the conversation: an app opened in a tab is a surface of its own, apart from the user's
 * desktop (which computer.* also controls directly) and the built-in browser.
 */
export const DESKTOP_TAB_ACTIONS = ['tabOpenApp', 'tabList', 'tabShow', 'tabClose', 'tabSet', 'tabScreenshot', 'tabClick', 'tabDrag', 'tabScroll', 'tabKey', 'tabType'] as const;
/** Skill plugins run in a tab; the page handles them too, never the computer-use host. */
export const DESKTOP_PLUGIN_ACTIONS = ['pluginList', 'pluginStart', 'pluginCommand', 'pluginStatus', 'pluginStop'] as const;
export type DesktopTabAction = typeof DESKTOP_TAB_ACTIONS[number] | typeof DESKTOP_PLUGIN_ACTIONS[number];
/** One list routes a request to the page's tab handler, so a new tab tool cannot fall through to the host. */
export function isDesktopTabAction(action: string): action is typeof DESKTOP_TAB_ACTIONS[number] {
    return (DESKTOP_TAB_ACTIONS as readonly string[]).includes(action);
}
export function isDesktopPluginAction(action: string): action is typeof DESKTOP_PLUGIN_ACTIONS[number] {
    return (DESKTOP_PLUGIN_ACTIONS as readonly string[]).includes(action);
}
export const COMPUTER_USER_ESC_OBSERVATION = "interrupted_by_user_esc: The user pressed ESC to manually exit and forbid desktop/window control for the remainder of this turn. Do NOT call any computer.* or tabs.* desktop control tools again in this turn. Immediately switch to non-desktop-control methods (such as file system tools, terminal/CLI commands, browser/API tools, or direct code/text response) to continue and complete the user's request.";
export interface DesktopComputerToolRequest {
    readonly id: string;
    readonly conversationId: string;
    readonly runId?: string;
    readonly expiresAt: number;
    readonly action: DesktopComputerAction | DesktopTabAction;
    readonly input?: Readonly<Record<string, unknown>>;
}
export interface DesktopComputerToolResult {
    readonly requestId: string;
    readonly ok: boolean;
    readonly output?: unknown;
    readonly error?: string;
    readonly userInterrupted?: boolean;
    /** Content-free native error facts. Never includes driver messages or UI text. */
    readonly diagnostic?: {
        readonly phase: 'host' | 'native_call' | 'result_encoding';
        readonly source: 'host' | 'computer_use' | 'driver';
        readonly driverTag?: 'Configuration' | 'InvalidArguments' | 'Transport' | 'Protocol' | 'Tool' | 'Shutdown'
            | 'RuntimeAlreadyExists' | 'Worker' | 'Remote' | 'ActionInterrupted';
        readonly nativeCode?: -25204;
        readonly nativeAction?: 'AXPress';
        readonly completion?: 'not_started' | 'completed' | 'unknown';
        readonly operation?: { readonly dispatched?: boolean; readonly committed?: boolean; readonly cancellationRequested?: boolean };
        readonly nextAction?: 'observe_before_action';
    };
    readonly images?: readonly { readonly mimeType: string; readonly data: string }[];
}
export interface DesktopComputerCapability {
    readonly available: boolean;
    readonly platform: string;
    readonly delivery: 'background' | 'foreground' | 'unsupported';
    readonly reason?: 'unsupported_system' | 'runtime_missing' | 'permission_required' | 'worker_install_required';
    readonly version: string;
}
