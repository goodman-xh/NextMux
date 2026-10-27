/** Applicability and portable name rules for the current conversation's file list. */
export type ContextFileAction = 'open' | 'toggle' | 'openFolder' | 'reveal' | 'copyName' | 'copyPath' | 'copyRelativePath'
    | 'newFile' | 'newFolder' | 'rename' | 'trash' | 'copy' | 'cut' | 'paste' | 'attach' | 'refresh';

export interface ContextFileActionItem {
    readonly id: ContextFileAction;
    readonly disabled?: boolean;
    readonly separatorBefore?: boolean;
}

export class ContextFileActionError extends Error {
    constructor(readonly key: 'outside' | 'readOnly' | 'pasteIntoSelf' | 'exists' | 'invalidName' | 'busy' | 'failed') {
        super(key);
    }
}

export function contextFileActionItems(value: {
    readonly root: boolean; readonly directory: boolean; readonly ready: boolean;
    readonly readonly: boolean; readonly parentReadonly: boolean; readonly trash: boolean;
    readonly paste: boolean; readonly busy: boolean;
}): readonly ContextFileActionItem[] {
    const unavailable = !value.ready || value.busy;
    const write = unavailable || value.readonly;
    const change = write || value.parentReadonly;
    const items: ContextFileActionItem[] = [];
    if (!value.root) items.push({ id: value.directory ? 'toggle' : 'open', disabled: unavailable });
    if (value.directory) items.push({ id: 'openFolder', disabled: unavailable });
    items.push({ id: 'reveal', disabled: unavailable }, { id: 'copyName', disabled: unavailable, separatorBefore: true },
        { id: 'copyPath', disabled: unavailable }, { id: 'copyRelativePath', disabled: unavailable });
    if (!value.directory) items.push({ id: 'attach', disabled: unavailable });
    if (value.directory) items.push({ id: 'newFile', disabled: write, separatorBefore: true }, { id: 'newFolder', disabled: write });
    if (!value.root) items.push({ id: 'copy', disabled: unavailable, separatorBefore: true }, { id: 'cut', disabled: change });
    items.push({ id: 'paste', disabled: (value.directory ? write : unavailable || value.parentReadonly) || !value.paste, separatorBefore: value.root });
    if (!value.root) items.push({ id: 'rename', disabled: change, separatorBefore: true }, { id: 'trash', disabled: change || !value.trash });
    items.push({ id: 'refresh', disabled: unavailable, separatorBefore: true });
    return items;
}

/** A single child name, never an absolute path or a traversal expression. */
export function validContextFileName(value: string, windows: boolean): boolean {
    if (!value || value.length > 255 || !value.trim() || value === '.' || value === '..' || /[\\/\u0000-\u001f\u007f]/u.test(value)) return false;
    return !windows || !(/[<>:"|?*]/u.test(value) || /[ .]$/u.test(value)
        || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(value));
}
