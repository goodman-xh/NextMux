export const NEXTMUX_TERMINAL_SCROLLBACK_LINES = 10_000;

export type NextMuxTerminalPlatform = 'windows' | 'macos' | 'linux';

export type NextMuxTerminalShortcutAction = 'copy' | 'paste' | 'terminal';

export interface NextMuxTerminalKeyEvent {
    readonly key: string;
    readonly ctrlKey: boolean;
    readonly shiftKey: boolean;
    readonly altKey: boolean;
    readonly metaKey: boolean;
}

/**
 * Resolves only the clipboard shortcuts owned by the terminal surface. All
 * other keys stay with xterm so control sequences such as Ctrl+C still reach
 * the active PTY when there is no selection.
 */
export function terminalShortcutAction(
    event: NextMuxTerminalKeyEvent,
    platform: NextMuxTerminalPlatform,
    hasSelection: boolean
): NextMuxTerminalShortcutAction {
    const key = event.key.toLowerCase();
    if (event.altKey) return 'terminal';

    if (platform === 'macos') {
        if (event.metaKey && !event.ctrlKey && !event.shiftKey && key === 'v') return 'paste';
        if (event.metaKey && !event.ctrlKey && !event.shiftKey && key === 'c' && hasSelection) return 'copy';
        return 'terminal';
    }

    if (platform === 'linux') {
        if (event.ctrlKey && event.shiftKey && !event.metaKey && key === 'v') return 'paste';
        if (event.ctrlKey && event.shiftKey && !event.metaKey && key === 'c' && hasSelection) return 'copy';
        if (!event.ctrlKey && event.shiftKey && !event.metaKey && key === 'insert') return 'paste';
        return 'terminal';
    }

    if (event.ctrlKey && !event.shiftKey && !event.metaKey && key === 'v') return 'paste';
    if (event.ctrlKey && !event.shiftKey && !event.metaKey && key === 'c' && hasSelection) return 'copy';
    if (event.ctrlKey && !event.shiftKey && !event.metaKey && key === 'insert' && hasSelection) return 'copy';
    if (!event.ctrlKey && event.shiftKey && !event.metaKey && key === 'insert') return 'paste';
    return 'terminal';
}
