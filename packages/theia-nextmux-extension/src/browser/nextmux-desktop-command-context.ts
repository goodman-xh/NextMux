export type NextMuxDesktopContextCommand = 'saveFile' | 'findConversation' | 'terminal' | 'browser';

export interface NextMuxDesktopCommandContext {
    readonly section: 'models' | 'coding' | 'comic' | 'settings';
    readonly codingPanel: 'thread' | 'pull_requests' | 'sites' | 'scheduled' | 'extensions';
    readonly hasConversation: boolean;
    readonly hasWorkspace: boolean;
    readonly filePreviewOpen: boolean;
    readonly fileDirty: boolean;
    readonly fileSaving: boolean;
    readonly visualTabOpen?: boolean;
}

/**
 * Keeps title-bar commands honest: a visible menu item may stay discoverable,
 * but it is only enabled when the corresponding workbench surface can handle it.
 */
export function desktopContextCommandEnabled(
    command: NextMuxDesktopContextCommand,
    context: NextMuxDesktopCommandContext
): boolean {
    const inConversation = context.section === 'coding'
        && context.codingPanel === 'thread'
        && context.hasConversation;
    switch (command) {
        case 'saveFile':
            return inConversation && context.filePreviewOpen && context.fileDirty && !context.fileSaving;
        case 'findConversation':
            return inConversation && !context.visualTabOpen;
        case 'terminal':
            return inConversation && context.hasWorkspace;
        case 'browser':
            return inConversation;
    }
}
