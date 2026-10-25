export type DesktopEditCommand = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll';
export type DesktopEditingTarget = 'none' | 'native' | 'selection';

export interface DesktopEditingContext {
    readonly target: DesktopEditingTarget;
    readonly editable?: boolean;
    readonly hasSelection: boolean;
    readonly hasContent?: boolean;
}

/**
 * Describes the smallest permission needed by each title-bar editing command.
 * A read-only native control is still selectable for copy, but never a valid
 * target for commands that mutate its value or its history.
 */
export function editingCommandEnabled(command: DesktopEditCommand, context: DesktopEditingContext): boolean {
    if (context.target === 'selection') return command === 'copy' && context.hasSelection;
    if (context.target !== 'native') return false;
    if (command === 'selectAll') return Boolean(context.editable || context.hasContent);
    if (command === 'copy') return context.hasSelection;
    if (!context.editable) return false;
    if (command === 'cut') return context.hasSelection;
    return command === 'undo' || command === 'redo' || command === 'paste';
}
