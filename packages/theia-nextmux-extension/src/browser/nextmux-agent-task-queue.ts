import type { AgentPermissionMode } from '@nextmux/agent-runtime';
import { narrowAgentPermission } from '@nextmux/agent-runtime/permission';
import { isLowLevelTaskPlanTitle as isRuntimeLowLevelTaskPlanTitle } from '@nextmux/agent-runtime/task-plan';
import { questionPausePreservesQueue } from './nextmux-agent-question';

/** A pause requiring user action must not resume itself or consume the next queued task. */
export function agentPauseBlocksAutomaticDispatch(stopReason: string | undefined): boolean {
    return stopReason === 'cancel_requested' || stopReason === 'pause_requested' || stopReason === 'media_context_compaction_required' || stopReason === 'context_window_exceeded'
        // Automatic continuation resets segment usage; budget stops require an explicit fresh segment.
        || stopReason === 'input_token_limit_reached' || stopReason === 'output_token_limit_reached' || stopReason === 'token_usage_unknown'
        || stopReason === 'output_truncated'
        || stopReason === 'balance_insufficient' || stopReason === 'insufficient_balance' || stopReason === 'wallet_balance_insufficient'
        || stopReason === 'payment_required' || stopReason === 'billing_hold_failed'
        || questionPausePreservesQueue(stopReason);
}

/** Only a successful final response releases the next user message. */
export function agentCompletionAllowsAutomaticDispatch(stage: string, stopReason: string | undefined): boolean {
    return stage === 'complete' && stopReason === 'completed';
}

export interface QueuedTaskDispatch {
    readonly requestId: string;
    readonly turnId: string;
    readonly state: 'submitting' | 'unknown';
}

export function normalizeQueuedTaskDispatch(value: unknown): QueuedTaskDispatch | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    return typeof record.requestId === 'string' && /^[a-zA-Z0-9._:-]{8,180}$/.test(record.requestId)
        && typeof record.turnId === 'string' && record.turnId.length > 0 && record.turnId.length <= 200
        && (record.state === 'submitting' || record.state === 'unknown')
        ? { requestId: record.requestId, turnId: record.turnId, state: record.state } : undefined;
}

export interface AgentDispatchPermissionRequest {
    readonly historical?: AgentPermissionMode;
    readonly resumed?: AgentPermissionMode;
    readonly queued?: AgentPermissionMode;
    readonly currentConversation?: AgentPermissionMode;
    readonly selected: AgentPermissionMode;
}

/** Computes the immutable permission sent with one dispatch request. */
export function resolveAgentDispatchPermission(request: AgentDispatchPermissionRequest): AgentPermissionMode {
    const persisted = request.historical ?? request.resumed ?? request.queued;
    return persisted
        ? narrowAgentPermission(persisted, request.currentConversation ?? request.selected)
        : request.selected;
}

export interface AgentDispatchRouteRequest<T> {
    readonly historical?: T;
    readonly queued?: T;
    readonly selected?: T;
    readonly resumed?: T;
}

/** Captures the route for one dispatch; later selection changes affect only later dispatches. */
export function resolveAgentDispatchRoute<T>(request: AgentDispatchRouteRequest<T>): T | undefined {
    return request.historical ?? request.queued ?? request.selected ?? request.resumed;
}

export interface AgentManualResumeTurnLike {
    readonly stage: string;
    readonly stopReason?: string;
    readonly resumeCheckpointId?: string;
    readonly failure?: { readonly resumable?: boolean };
}

/**
 * A stopped run is resumed only by an explicit user action with an opaque checkpoint.
 * A media-context pause is resumable too: after the user switches to a larger-context
 * model (or trims the media) Continue proceeds; on the same model the runtime pauses
 * again before sending anything, so nothing is lost or billed.
 */
export function agentManualResumeStrategy(turn: AgentManualResumeTurnLike): 'continue' | 'retry' | undefined {
    if (!turn.resumeCheckpointId) return undefined;
    if (turn.stage === 'paused' || turn.stage === 'cancelled') return 'continue';
    return turn.stage === 'error' && turn.failure?.resumable ? 'retry' : undefined;
}

export interface FollowUpTaskLike {
    readonly id: string;
    readonly prompt: string;
    readonly sessionId?: string;
}

export interface FollowUpDrainRequest {
    readonly finishedSessionId: string;
    /** True only when the owning run reached a real terminal state. */
    readonly finished: boolean;
    /** Explicit direct-send requests, in the order in which users armed them. */
    readonly directSessionIds: readonly string[];
}

export interface AutomaticResumeOwnershipRequest {
    readonly turnId: string;
    readonly latestTurnId: string;
    readonly queuedUserPromptCount: number;
}

export type AgentTaskQueuePlanStatus = 'pending' | 'in_progress' | 'completed';

export interface AgentTaskQueuePlanStepLike {
    readonly id: string;
    readonly title: string;
    readonly status: AgentTaskQueuePlanStatus;
}

export interface AgentTaskQueueEventLike {
    readonly type: string;
    readonly steps?: readonly AgentTaskQueuePlanStepLike[];
}

export interface QueuedUserTaskLike extends FollowUpTaskLike {
    /** Missing means a persisted user message from before source tagging. */
    readonly source?: 'user' | 'tool';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/**
 * Older desktop builds stored rendered tool summaries in followUpQueue without
 * a source field.  Do not treat every untagged record as a tool (old user
 * prompts are valid data), but recognise the stable result-shaped summaries
 * emitted by those builds so they are removed during the next read/migration.
 */
export function isLikelyLegacyToolActivityPrompt(prompt: string): boolean {
    const value = prompt.replace(/\s+/g, ' ').trim();
    if (!value) return false;
    // Keep persisted-queue migration in lockstep with the runtime plan
    // classifier. Providers vary the wording of counts (处匹配/个匹配/项),
    // and a desktop-only copy of the first regex had already drifted from it.
    return isRuntimeLowLevelTaskPlanTitle(value)
        || /^(?:找到\s+\d+\s*处匹配|列出\s+\d+\s*个工作区条目|工具执行失败|工具调用失败|正在运行\s+.+\s*>|正在读取\s+.+\s*>|正在搜索\s+.+\s*>|正在执行\s+.+\s*>|执行了命令\s*>|执行了\s+.+\s*>|读取\s+(?:文件\s+)?(?:[A-Za-z]:|\.{0,2}|(?:packages|apps|src|test|docs|artifacts|output|scripts)\b|[^\s]+\.(?:c|cc|cpp|cs|css|go|h|hpp|html?|ini|java|js|json|jsx|log|md|mjs|mts|php|py|rb|rs|scss|sh|sql|srt|svg|ts|tsx|txt|toml|vtt|vue|xml|yaml|yml)))/iu.test(value)
        || /^(?:rg|grep|findstr|node|pnpm|npm|yarn|git|powershell|pwsh|cmd)(?:\s+.+)?\s+(?:退出码|exit\s+code)\s*-?\d+(?:\s|$)/iu.test(value)
        // "Read file src/a.ts" / "Reading ./x.json": only a path-like target is a rendered summary; "Read the README
        // and fix it" is an ordinary instruction.
        || /^(?:found\s+\d+\s+matches|listed\s+\d+\s+workspace\s+(?:entries|items)|tool\s+(?:execution|call)\s+failed|read(?:ing)?\s+(?:file\s+)?(?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|\S*[\\/]\S*|\S+\.[A-Za-z0-9]{1,8})(?=\s|$)|process\s+exited(?:\s+with\s+code)?\s*-?\d+)/iu.test(value);
}

/**
 * Task plans are a semantic surface, not a second activity transcript. Some
 * providers incorrectly put their raw search/read/command result labels in a
 * task.update_plan call. Keep that noise out of both the queue and plan chip,
 * while leaving ordinary user-authored plans untouched.
 */
export function isLowLevelTaskPlanTitle(title: string): boolean {
    return isRuntimeLowLevelTaskPlanTitle(title);
}

/**
 * Detect queue records written by pre-separation builds.  The renderer can
 * filter these records for display, but a one-time full upsert is also needed
 * so a restart does not keep loading the same tool rows from the durable store.
 */
export function hasLegacyToolActivityQueueRecords(sessions: readonly unknown[]): boolean {
    return sessions.some(session => isRecord(session) && Array.isArray(session.followUpQueue)
        && session.followUpQueue.some(task => isRecord(task)
            && (task.source !== undefined && task.source !== 'user'
                || task.source === undefined && typeof task.prompt === 'string'
                    && isLikelyLegacyToolActivityPrompt(task.prompt))));
}

export type AgentTaskQueueItem =
    | {
        readonly kind: 'plan_step';
        readonly id: string;
        readonly title: string;
        readonly status: AgentTaskQueuePlanStatus;
    }
    | {
        readonly kind: 'queued_message';
        readonly id: string;
        readonly title: string;
        readonly status: 'queued';
    };

function singleLineTaskText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

/**
 * Read the latest structured plan once for every desktop presentation.  Plan
 * updates replace one another; replaying every update would make the activity
 * stream and the task queue disagree about which work is current.  Keeping the
 * normalization here also means imported histories and live events use the
 * same low-level-activity boundary.
 */
export function latestSemanticTaskPlanSteps(
    events: readonly AgentTaskQueueEventLike[]
): readonly AgentTaskQueuePlanStepLike[] {
    const latestPlan = [...events].reverse().find(event => event.type === 'task_plan_updated');
    return (latestPlan?.steps || []).flatMap(step => {
        const id = singleLineTaskText(step.id);
        const title = singleLineTaskText(step.title);
        return id && title && !isLowLevelTaskPlanTitle(title)
            ? [{ id, title, status: step.status }]
            : [];
    });
}

function isUserQueuedTask(task: QueuedUserTaskLike): boolean {
    return isUserFollowUpRecord(task);
}

/**
 * A queued follow-up the user wrote. A record tagged `source: 'user'` is kept whatever its text says: a real
 * instruction such as "Read file artifacts/report.txt and explain the failure" must never vanish (audit C35-05).
 * Only untagged records from before source tagging are screened for the tool summaries old builds stored there;
 * any other source is runtime/tool data.
 */
export function isUserFollowUpRecord(task: { readonly prompt: string; readonly source?: string }): boolean {
    if (!task.prompt.trim()) return false;
    // A few pre-separation builds tagged rendered tool summaries as user messages. Only their exact, unambiguous
    // label shapes (match counts, workspace listings, exit codes, tool failures) are removed from tagged records.
    if (task.source === 'user') return !isExactLegacyToolLabel(task.prompt);
    return task.source === undefined && !isLikelyLegacyToolActivityPrompt(task.prompt);
}

/** Whole-string tool labels that no user types as an instruction ("找到 57 处匹配", "pnpm 退出码 1"). */
export function isExactLegacyToolLabel(prompt: string): boolean {
    const value = prompt.replace(/\s+/g, ' ').trim();
    return /^(?:找到\s*\d+\s*(?:处|个|项)匹配|列出\s*\d+\s*个工作区条目|工具(?:执行|调用)失败|found \d+ matches|listed \d+ workspace (?:entries|items)|tool (?:execution|call) failed|process exited(?: with code)? ?-?\d+)$/iu.test(value)
        || /^(?:rg|grep|findstr|node|pnpm|npm|yarn|git|powershell|pwsh|cmd)(?: \S+)* (?:退出码|exit code) ?-?\d+$/iu.test(value);
}

/**
 * Stable semantic projection for the task-queue surface. Only an explicit
 * structured plan and user-authored follow-ups may create rows. Tool activity,
 * narration and rendering concerns (clipping/fades) are intentionally absent.
 */
export function projectAgentTaskQueue(
    events: readonly AgentTaskQueueEventLike[],
    queuedTasks: readonly QueuedUserTaskLike[],
    maximum = 20
): readonly AgentTaskQueueItem[] {
    const limit = Math.max(1, Math.min(20, Math.floor(maximum) || 20));
    const planItems: AgentTaskQueueItem[] = latestSemanticTaskPlanSteps(events).map(step => ({
            kind: 'plan_step',
            id: `plan:${step.id}`,
            title: step.title,
            status: step.status
        }));
    const queuedItems: AgentTaskQueueItem[] = queuedTasks.flatMap(task => {
        const title = singleLineTaskText(task.prompt);
        return isUserQueuedTask(task) && task.id && title ? [{
            kind: 'queued_message',
            id: `message:${task.id}`,
            title,
            status: 'queued'
        }] : [];
    });
    return [...planItems, ...queuedItems].slice(0, limit);
}

export function appendFollowUpTask<T extends FollowUpTaskLike>(queue: readonly T[], task: T, maximum = 20): readonly T[] {
    const limit = Math.max(1, Math.min(20, Math.floor(maximum) || 20));
    if (!task.id || !task.prompt.trim()) throw new Error('Queued task is invalid');
    if (queue.some(item => item.id === task.id)) throw new Error('Queued task identifier is duplicated');
    if (queue.length >= limit) throw new Error('Follow-up queue is full');
    return [...queue, task];
}

export function removeFollowUpTask<T extends FollowUpTaskLike>(queue: readonly T[], taskId: string): readonly T[] {
    return queue.filter(task => task.id !== taskId);
}

export function replaceFollowUpTask<T extends FollowUpTaskLike>(queue: readonly T[], task: T): readonly T[] {
    return queue.map(item => item.id === task.id ? task : item);
}

/**
 * Restore a task after dispatch preparation or start failed. The operation is
 * idempotent so a late retry cannot duplicate the same user prompt.
 */
export function restoreFollowUpTask<T extends FollowUpTaskLike>(
    queue: readonly T[],
    task: T,
    index = 0
): readonly T[] {
    if (!task.id || queue.some(item => item.id === task.id)) return queue;
    const insertionIndex = Math.max(0, Math.min(queue.length, Math.floor(index) || 0));
    return [...queue.slice(0, insertionIndex), task, ...queue.slice(insertionIndex)];
}

export function followUpTaskBelongsToSession(task: FollowUpTaskLike, sessionId: string): boolean {
    return Boolean(sessionId && task.sessionId === sessionId);
}

/** A conversation may only steer or interrupt the run that it owns. */
export function activeRunBelongsToSession(activeSessionId: string, requestedSessionId: string): boolean {
    return Boolean(activeSessionId && requestedSessionId && activeSessionId === requestedSessionId);
}

/**
 * Automatic checkpoint continuation may only resume the conversation's
 * current tail. A newer turn or a queued user prompt supersedes an older
 * checkpoint and must never allow that old task to wake up later.
 */
export function automaticResumeOwnsLatestTurn(request: AutomaticResumeOwnershipRequest): boolean {
    return Boolean(request.turnId
        && request.latestTurnId === request.turnId
        && Math.max(0, Math.floor(request.queuedUserPromptCount) || 0) === 0);
}

/**
 * Select only conversations whose own lifecycle explicitly armed a drain.
 * The currently visible conversation is intentionally not an input: finishing
 * work in one conversation must never wake a stale queue in another one.
 */
export function followUpDrainSessionIds(request: FollowUpDrainRequest): readonly string[] {
    const result: string[] = [];
    if (request.finished && request.finishedSessionId) result.push(request.finishedSessionId);
    for (const sessionId of request.directSessionIds) {
        if (sessionId && !result.includes(sessionId)) result.push(sessionId);
    }
    return result;
}
