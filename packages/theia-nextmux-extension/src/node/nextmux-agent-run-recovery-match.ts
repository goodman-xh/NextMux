import { resolve } from 'path';
import type { DesktopAgentRunRecoveryOwnerHint } from '../common/nextmux-platform-protocol';
import type { AgentRunJournalRecord } from './nextmux-agent-run-journal';
import type { AgentRunStateOwner } from './nextmux-agent-run-state-store';

export function sameRecoveryWorkspace(left: string, right: string): boolean {
    const normalized = (value: string): string => process.platform === 'win32'
        ? resolve(value).replace(/[\\/]+/g, '\\').toLocaleLowerCase() : resolve(value);
    return normalized(left) === normalized(right);
}

export function exactRecoveryToolCallIds(value: unknown): readonly string[] | undefined {
    if (!Array.isArray(value) || value.length < 1 || value.length > 8_192
        || value.some(id => typeof id !== 'string' || !id || id.length > 500 || /[\0\r\n]/.test(id))) return undefined;
    const ids = value as string[];
    return new Set(ids).size === ids.length ? [...ids] : undefined;
}

export function sameRecoveryToolCallIds(left: readonly string[], right: readonly string[]): boolean {
    const rightIds = new Set(right);
    return left.length === right.length && new Set(left).size === left.length
        && rightIds.size === right.length && left.every(id => rightIds.has(id));
}

export interface InterruptedRootRecoveryCandidate {
    readonly journal: AgentRunJournalRecord;
    readonly journalToolCallIds: readonly string[];
    readonly journalEvents?: readonly { readonly type: string; readonly callId?: string }[];
    readonly checkpointOwner?: AgentRunStateOwner;
    readonly checkpoint: {
        readonly runId: string;
        readonly seenToolCallIds: readonly string[];
        readonly taskContext?: {
            readonly workspaceRoot: string;
            readonly conversationId?: string;
            readonly rootRunId?: string;
            readonly parentRunId?: string;
            readonly depth: number;
        };
    };
}

function journalMatchesCheckpointBoundary(ids: readonly string[], candidate: InterruptedRootRecoveryCandidate): boolean {
    if (sameRecoveryToolCallIds(ids, candidate.journalToolCallIds)) return true;
    const seen = new Set(candidate.checkpoint.seenToolCallIds);
    const covered = candidate.journalToolCallIds.filter(id => seen.has(id));
    if (!sameRecoveryToolCallIds(ids, covered)) return false;
    const extras = new Set(candidate.journalToolCallIds.filter(id => !seen.has(id)));
    const events = candidate.journalEvents;
    if (!extras.size || !events) return false;
    const settled = new Set(ids);
    let lastCoveredEvent = -1;
    const starts = new Map<string, number>();
    for (let index = 0; index < events.length; index++) {
        const event = events[index];
        if (!event.callId) continue;
        if (settled.has(event.callId) && ['tool_started', 'tool_completed', 'tool_process_started', 'tool_process_exited'].includes(event.type)) lastCoveredEvent = index;
        if (!extras.has(event.callId)) continue;
        // An abandoned start identifies the host; it is not a result or
        // evidence that its side effect did not happen. Never replay it here.
        if (event.type !== 'tool_started' || starts.has(event.callId)) return false;
        starts.set(event.callId, index);
    }
    return lastCoveredEvent >= 0 && starts.size === extras.size
        && [...starts.values()].every(index => index > lastCoveredEvent);
}

/** Legacy host IDs are recovered only from one exact, already-owned tool lineage. */
export function matchingInterruptedRootRunId(
    requestedRunId: string,
    hint: DesktopAgentRunRecoveryOwnerHint,
    candidates: readonly InterruptedRootRecoveryCandidate[]
): string | undefined {
    const ids = exactRecoveryToolCallIds(hint.toolCallIds);
    const logicalRoot = hint.logicalRootRunId || requestedRunId;
    if (!ids || !/^[A-Za-z0-9._:-]{8,180}$/.test(logicalRoot)) return undefined;
    const matched = new Set<string>();
    for (const candidate of candidates) {
        const { journal, checkpoint, checkpointOwner: owner } = candidate;
        const context = checkpoint.taskContext;
        const seen = new Set(checkpoint.seenToolCallIds);
        if (journal.workbench !== 'coding' || journal.childContinuation || journal.owner.depth !== 0
            || journal.owner.parentRunId !== undefined || journal.owner.rootRunId !== journal.runId
            || journal.owner.conversationId !== hint.conversationId || !sameRecoveryWorkspace(journal.owner.workspaceRoot, hint.workspaceRoot)
            || !owner || owner.depth !== 0 || owner.parentRunId !== undefined || owner.rootRunId !== journal.runId
            || owner.conversationId !== hint.conversationId || !sameRecoveryWorkspace(owner.workspaceRoot, hint.workspaceRoot)
            || owner.workspaceBindingsKey !== journal.owner.workspaceBindingsKey
            || checkpoint.runId !== journal.runId || !context || context.depth !== 0 || context.parentRunId !== undefined
            || context.rootRunId !== logicalRoot || context.conversationId !== hint.conversationId
            || !sameRecoveryWorkspace(context.workspaceRoot, hint.workspaceRoot)
            || !journalMatchesCheckpointBoundary(ids, candidate)
            || !ids.every(id => seen.has(id))) continue;
        matched.add(journal.runId);
    }
    return matched.size === 1 ? [...matched][0] : undefined;
}
