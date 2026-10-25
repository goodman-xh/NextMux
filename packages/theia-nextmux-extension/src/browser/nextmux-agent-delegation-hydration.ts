import type {
    AgentChildReceipt,
    AgentDelegationLedger,
    AgentDelegationLedgerChild,
    AgentPermissionMode,
    AgentTaskContext
} from '@nextmux/agent-runtime';
import { createAgentTaskContext, validateAgentTaskContext } from '@nextmux/agent-runtime/task-context';
import type {
    DesktopAgentChildSnapshot,
    DesktopAgentRunFailure
} from '../common/nextmux-platform-protocol';

/**
 * The renderer's durable conversation record is intentionally described
 * structurally here.  Keeping this adapter independent from the widget makes
 * restart recovery testable without mounting Theia or React.
 */
export interface AgentDelegationHydrationTurn {
    readonly id: string;
    readonly agentRootRunId?: string;
    readonly childAgents?: readonly DesktopAgentChildSnapshot[];
}

export interface AgentDelegationHydrationOptions {
    readonly sessionId: string;
    readonly workspaceRoot: string;
    readonly permissionMode: AgentPermissionMode;
    readonly now?: number;
}

export interface AgentDelegationHydrationResult<T extends AgentDelegationHydrationTurn> {
    readonly turns: readonly T[];
    readonly changed: boolean;
}

const MAX_CHILDREN = 32;
const MAX_EVENTS = 2_048;
const SAFE_ROOT_ID = /^[A-Za-z0-9._:-]{8,180}$/;

function timestamp(value: string | undefined, fallback: number): number {
    const parsed = value ? Date.parse(value) : Number.NaN;
    return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function eventCount(child: Pick<DesktopAgentChildSnapshot, 'eventCount' | 'events' | 'nextEventIndex'>): number {
    const declared = typeof child.eventCount === 'number' && Number.isSafeInteger(child.eventCount)
        ? child.eventCount : 0;
    return Math.min(MAX_EVENTS, Math.max(child.events.length, declared, child.nextEventIndex));
}

function stableStatus(status: DesktopAgentChildSnapshot['status']): boolean {
    return status !== 'running' && status !== 'interrupted';
}

function safeTaskContext(
    child: AgentDelegationLedgerChild,
    options: AgentDelegationHydrationOptions,
    now: number
): AgentTaskContext {
    const candidate = child.taskContext;
    try {
        const validated = candidate ? validateAgentTaskContext(candidate) : createAgentTaskContext({
            workspaceRoot: options.workspaceRoot,
            conversationId: options.sessionId,
            goal: child.task,
            parentRunId: child.parentRunId,
            rootRunId: child.rootRunId,
            depth: child.depth,
            permissionMode: options.permissionMode,
            allowedToolNames: []
        });
        // The ledger is diagnostic state crossing into the renderer.  Keep the
        // operational boundary, but do not expose explicitly selected memory
        // excerpts merely because a restart needed to rebuild a child tab.
        return validateAgentTaskContext({
            ...validated,
            workspaceRoot: options.workspaceRoot || validated.workspaceRoot,
            conversationId: options.sessionId || validated.conversationId,
            goal: validated.goal || child.task,
            parentRunId: child.parentRunId,
            rootRunId: child.rootRunId,
            depth: child.depth,
            permissionMode: options.permissionMode,
            selectedMemory: []
        });
    } catch {
        // A malformed diagnostic must never prevent the conversation from
        // opening.  The fallback still gives the child continuation the
        // identity and workspace boundary it needs; the opaque checkpoint is
        // authoritative for actual continuation data.
        try {
            return createAgentTaskContext({
                workspaceRoot: options.workspaceRoot,
                conversationId: options.sessionId,
                goal: child.task || 'Resume child task',
                parentRunId: child.parentRunId,
                rootRunId: child.rootRunId,
                depth: child.depth,
                permissionMode: options.permissionMode,
                allowedToolNames: [],
                recentOperations: [`Recovered diagnostic record: ${now}`], recentOperationsCanonical: true
            });
        } catch {
            // createAgentTaskContext only rejects impossible identity input;
            // returning a minimal validated-looking object keeps this adapter
            // total even for corrupt local data.
            return {
                version: 1,
                workspaceRoot: options.workspaceRoot,
                conversationId: options.sessionId,
                goal: child.task || 'Resume child task',
                constraints: [],
                relevantPaths: [],
                recentOperations: [],
                parentRunId: child.parentRunId,
                rootRunId: child.rootRunId,
                depth: Math.max(1, Math.min(4, child.depth)),
                permissionMode: options.permissionMode,
                allowedToolNames: [],
                selectedMemory: []
            };
        }
    }
}

function childFailure(child: AgentDelegationLedgerChild, status: DesktopAgentChildSnapshot['status']): DesktopAgentRunFailure | undefined {
    if (child.error) {
        return {
            code: child.error.code,
            message: child.error.message,
            kind: 'failed',
            retryable: false,
            resumable: Boolean(child.resumeCheckpointId),
            ...(child.resumeCheckpointId ? { resumeCheckpointId: child.resumeCheckpointId } : {})
        };
    }
    if (status === 'interrupted') {
        return {
            code: 'AGENT_RUN_INTERRUPTED',
            message: '应用重启前子任务尚未完成，可以从检查点继续。',
            kind: 'failed',
            retryable: false,
            resumable: Boolean(child.resumeCheckpointId),
            ...(child.resumeCheckpointId ? { resumeCheckpointId: child.resumeCheckpointId } : {})
        };
    }
    return undefined;
}

function diagnosticSnapshot(
    child: AgentDelegationLedgerChild,
    options: AgentDelegationHydrationOptions
): DesktopAgentChildSnapshot {
    const now = options.now ?? Date.now();
    const startedAt = timestamp(child.startedAt, now);
    const updatedAt = Math.max(startedAt, timestamp(child.updatedAt, startedAt));
    // A ledger is only consulted after the live host job is gone.  A child
    // persisted as running is therefore an interrupted child, never a fake
    // live spinner that could make the UI look stuck forever.
    const status: DesktopAgentChildSnapshot['status'] = child.status === 'running'
        ? 'interrupted'
        : child.status === 'failed' ? 'error' : child.status;
    const count = Math.min(MAX_EVENTS, Math.max(0, child.eventCount));
    const failure = childFailure(child, status);
    return {
        childRunId: child.childRunId,
        parentRunId: child.parentRunId,
        rootRunId: child.rootRunId,
        depth: child.depth,
        task: child.task,
        status,
        events: [],
        eventCount: count,
        firstEventIndex: 0,
        nextEventIndex: count,
        startedAt,
        updatedAt,
        finishedAt: Math.max(updatedAt, timestamp(child.finishedAt, updatedAt)),
        taskContext: safeTaskContext(child, options, now),
        ...(child.receipt ? { receipt: child.receipt as AgentChildReceipt } : {}),
        ...(child.role ? { role: child.role } : {}),
        ...(child.slotId ? { slotId: child.slotId } : {}),
        ...(child.acceptanceCriteria?.length ? { acceptanceCriteria: [...child.acceptanceCriteria] } : {}),
        ...(child.routeSource ? { routeSource: child.routeSource } : {}),
        ...(child.invocationKey ? { invocationKey: child.invocationKey } : {}),
        ...(child.checkpointError ? { checkpointError: { ...child.checkpointError } } : {}),
        ...(failure ? { error: failure } : {}),
        // Paused or stopped at a limit is not a failure, but it can still continue (audit A09-06).
        ...(!failure && child.resumeCheckpointId && (status === 'paused' || status === 'limit_reached') ? { resumeCheckpointId: child.resumeCheckpointId } : {})
    };
}

function mergeChild(
    current: DesktopAgentChildSnapshot,
    incoming: DesktopAgentChildSnapshot
): DesktopAgentChildSnapshot {
    const incomingIsNewer = incoming.updatedAt >= current.updatedAt;
    const shouldAdoptStatus = current.status === 'running' || incomingIsNewer && (
        stableStatus(incoming.status) || !stableStatus(current.status)
    );
    const count = Math.max(eventCount(current), eventCount(incoming));
    return {
        ...current,
        ...(shouldAdoptStatus ? { status: incoming.status } : {}),
        updatedAt: Math.max(current.updatedAt, incoming.updatedAt),
        ...(incoming.finishedAt !== undefined && (current.finishedAt === undefined || current.status === 'running' || incomingIsNewer)
            ? { finishedAt: incoming.finishedAt } : {}),
        eventCount: count,
        nextEventIndex: Math.max(current.nextEventIndex, incoming.nextEventIndex, count),
        ...(incoming.role && !current.role ? { role: incoming.role } : {}),
        ...(incoming.slotId && !current.slotId ? { slotId: incoming.slotId } : {}),
        ...(incoming.acceptanceCriteria?.length && !current.acceptanceCriteria?.length ? { acceptanceCriteria: incoming.acceptanceCriteria } : {}),
        ...(incoming.routeSource && !current.routeSource ? { routeSource: incoming.routeSource } : {}),
        ...(incoming.invocationKey && !current.invocationKey ? { invocationKey: incoming.invocationKey } : {}),
        ...(incoming.receipt && (!current.receipt || incomingIsNewer) ? { receipt: incoming.receipt } : {}),
        ...(incoming.checkpointError && (!current.checkpointError || incomingIsNewer)
            ? { checkpointError: incoming.checkpointError } : {}),
        ...(incoming.error && (!current.error || current.status === 'running' || incomingIsNewer) ? { error: incoming.error } : {}),
        ...(incoming.resumeCheckpointId && !current.result?.resumeCheckpointId && (!current.resumeCheckpointId || incomingIsNewer)
            ? { resumeCheckpointId: incoming.resumeCheckpointId } : {})
    };
}

/** Return root IDs that can be safely used for an owner-scoped ledger read. */
export function agentDelegationRootIds(turns: readonly AgentDelegationHydrationTurn[]): readonly string[] {
    const roots = new Set<string>();
    for (const turn of turns) {
        if (turn.agentRootRunId && SAFE_ROOT_ID.test(turn.agentRootRunId)) roots.add(turn.agentRootRunId);
        for (const child of turn.childAgents || []) {
            if (SAFE_ROOT_ID.test(child.rootRunId)) roots.add(child.rootRunId);
        }
    }
    return [...roots];
}

/**
 * Merge a backend ledger into the owning conversation without importing child
 * transcripts.  Existing event streams/results always win; the ledger only
 * fills missing children and reconciles bounded terminal diagnostics.
 */
export function hydrateAgentDelegationLedger<T extends AgentDelegationHydrationTurn>(
    turns: readonly T[],
    ledger: AgentDelegationLedger,
    options: AgentDelegationHydrationOptions
): AgentDelegationHydrationResult<T> {
    if (!ledger || ledger.schemaVersion !== 1 || !SAFE_ROOT_ID.test(ledger.rootRunId)) return { turns, changed: false };
    const next = turns.map(turn => ({ ...turn })) as Array<T & { childAgents?: readonly DesktopAgentChildSnapshot[] }>;
    let changed = false;

    for (const ledgerChild of ledger.children.slice(0, MAX_CHILDREN)) {
        if (ledgerChild.rootRunId !== ledger.rootRunId) continue;
        const incoming = diagnosticSnapshot(ledgerChild, options);
        let ownerIndex = next.findIndex(turn => (turn.childAgents || []).some(child => child.childRunId === incoming.childRunId));
        if (ownerIndex < 0) ownerIndex = next.findIndex(turn => turn.agentRootRunId === ledger.rootRunId);
        if (ownerIndex < 0) continue;
        const owner = next[ownerIndex];
        const children = [...(owner.childAgents || [])];
        const childIndex = children.findIndex(child => child.childRunId === incoming.childRunId);
        if (childIndex >= 0) {
            const merged = mergeChild(children[childIndex], incoming);
            if (JSON.stringify(merged) !== JSON.stringify(children[childIndex])) {
                children[childIndex] = merged;
                next[ownerIndex] = { ...owner, childAgents: children };
                changed = true;
            }
            continue;
        }
        if (children.length >= MAX_CHILDREN) continue;
        children.push(incoming);
        next[ownerIndex] = { ...owner, childAgents: children };
        changed = true;
    }

    return { turns: changed ? next : turns, changed };
}
