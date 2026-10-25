import type { AgentCheckpointDiff } from '@nextmux/agent-runtime';

export type GroupedChange = AgentCheckpointDiff & {
    readonly rootLabel?: string;
    readonly checkpointIds?: readonly string[];
    readonly lastCheckpointId?: string;
};

const GENERATED_RESTORE_VERSION_ID = /^restore-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isGeneratedRestoreCheckpointId(checkpointId: string): boolean {
    return GENERATED_RESTORE_VERSION_ID.test(checkpointId);
}

export function changeFileGroupKey(change: Pick<AgentCheckpointDiff, 'externalTarget' | 'workspaceRoot' | 'path'>): string {
    return change.externalTarget || `${change.workspaceRoot || ''}\u0000${change.path}`;
}

/** Collapse a turn's checkpoints to one entry per file, keeping the earliest checkpoint for restore. */
export function groupChangesByFile(changes: readonly AgentCheckpointDiff[]): readonly GroupedChange[] {
    const filtered = changes.filter(change => !isGeneratedRestoreCheckpointId(change.checkpointId));
    const source = filtered.length > 0 || changes.length === 0 ? filtered : [];
    const groups = new Map<string, AgentCheckpointDiff[]>();
    for (const change of source) {
        const groupKey = changeFileGroupKey(change);
        const list = groups.get(groupKey);
        if (list) list.push(change); else groups.set(groupKey, [change]);
    }
    // The same relative path in two project folders needs the folder name to tell them apart.
    const roots = new Map<string, Set<string>>();
    for (const change of source) roots.set(change.path, (roots.get(change.path) || new Set()).add(change.workspaceRoot || ''));
    return [...groups.values()].map(list => {
        const first = list[0];
        const last = list[list.length - 1];
        const additions = list.reduce((total, item) => total + (item.additions || 0), 0);
        const deletions = list.reduce((total, item) => total + (item.deletions || 0), 0);
        const ambiguous = (roots.get(first.path)?.size || 0) > 1;
        return {
            ...last,
            checkpointId: first.checkpointId,
            lastCheckpointId: last.checkpointId,
            checkpointIds: list.map(item => item.checkpointId),
            beforeMode: first.beforeMode,
            afterMode: last.afterMode,
            additions,
            deletions,
            kind: last.kind === 'deleted' ? 'deleted' : first.kind === 'created' ? 'created' : 'modified',
            beforeContent: first.beforeContent,
            afterContent: last.afterContent,
            patch: list.map(item => item.patch).filter(Boolean).join('\n'),
            truncated: list.some(item => item.truncated),
            ...(ambiguous && first.workspaceRoot ? { rootLabel: first.workspaceRoot.split(/[\\/]/).filter(Boolean).pop() } : {})
        };
    });
}

