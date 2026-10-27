import { canonicalToolSummary } from '@nextmux/agent-runtime/semantic-messages';
import { runtimeFinalText, type RuntimeFinalMessage } from './nextmux-agent-outcome-locale';
import type { AgentOutputPart, AgentRunEvent, AgentUserQuestion } from '@nextmux/agent-runtime';
import { agentQuestionKey } from './nextmux-agent-question';
import { completedNarrationSourceIndexes } from './nextmux-agent-activity';

export interface ConversationTurnLike {
    readonly id: string;
    readonly userMessageId?: string;
    readonly assistantMessageId?: string;
    readonly prompt: string;
    /** Stable prompt sent to the model when the visible prompt contains inline attachment anchors. */
    readonly modelPrompt?: string;
    readonly response: string;
    readonly finalMessage?: RuntimeFinalMessage;
    readonly stopReason?: string;
    readonly outputParts?: readonly AgentOutputPart[];
    readonly outputAssetOwnerId?: string;
    readonly stage: string;
    /** A branch that stops after the user message, before the assistant reply. */
    readonly branchUserOnly?: boolean;
    /** Assistant-only presentation/accounting metadata must not survive a prompt-only branch. */
    readonly executionLabel?: string;
    readonly usageLabel?: string;
    readonly billingLabel?: string;
    readonly events?: readonly AgentRunEvent[];
    readonly steeringMessages?: readonly {
        readonly id: string;
        readonly content: string;
        readonly status: 'accepted' | 'applied' | 'requeued';
    }[];
    readonly pinned?: boolean;
    readonly excludedFromContext?: boolean;
    readonly relayFeedback?: 'up' | 'down' | null;
    readonly attachmentDocuments?: readonly TurnAttachmentDocument[];
}

/** An attachment of a turn that was too long to send whole and was saved for the agent to read in parts. */
export interface TurnAttachmentDocument {
    readonly attachmentId: string;
    readonly name: string;
    readonly path: string;
    readonly lines: number;
    readonly characters: number;
}

/** Saved-document records restored from history: well-formed entries only, at most 20. */
export function normalizeTurnAttachmentDocuments(value: unknown): readonly TurnAttachmentDocument[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const text = (item: unknown, maximum: number): string | undefined => typeof item === 'string' && item.length > 0 && item.length <= maximum && !/[\u0000-\u001f\u007f]/.test(item) ? item : undefined;
    const count = (item: unknown): number | undefined => Number.isSafeInteger(item) && Number(item) >= 0 ? Number(item) : undefined;
    const documents = value.slice(0, 20).flatMap(item => {
        const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
        const attachmentId = text(record.attachmentId, 200), name = text(record.name, 240), path = text(record.path, 4096);
        const lines = count(record.lines), characters = count(record.characters);
        return attachmentId && name && path && lines !== undefined && characters !== undefined ? [{ attachmentId, name, path, lines, characters }] : [];
    });
    return documents.length ? documents : undefined;
}

/** How a later request is told about a turn's saved documents (the file stays readable for its conversation). */
function attachmentDocumentNote(turn: ConversationTurnLike): string {
    const documents = turn.attachmentDocuments || [];
    if (!documents.length) return '';
    const list = documents.map(document => `"${document.name}" at ${document.path} (${document.lines.toLocaleString('en-US')} lines)`).join('; ');
    return `\n\n[Attached to this message and saved for reading in parts: ${list}. Read it again with workspace.read_file (startLine/endLine) or workspace.search_text when the user asks about it; if the file is gone, ask them to attach it again.]`;
}

export interface ConversationCheckpointLike {
    readonly checkpointId: string;
    readonly createdAt?: string;
    readonly workspaceRoot?: string;
    readonly path?: string;
    readonly externalTarget?: string;
}

/** Durable references are saved before optional diff/preview RPCs complete. */
export interface ConversationWorkspaceVersion extends ConversationCheckpointLike {
    readonly workspaceRoot: string;
}

/** A private branch must not reopen the source conversation's editor URI. */
export function rebaseConversationBranchFileView<T extends {
    readonly contextFileUri?: string;
    readonly contextFileMaximized?: boolean;
    readonly contextFileScrollPositions?: Readonly<Record<string, { readonly top: number; readonly left: number }>>;
}>(view: T | undefined, mappings: readonly { readonly sourceUri: string; readonly targetUri: string; readonly directory?: boolean }[]): T | undefined {
    if (!view) return undefined;
    const fileKey = (uri: string): { key: string; insensitive: boolean } | undefined => {
        try {
            const value = new URL(uri);
            if (value.protocol !== 'file:' || value.search || value.hash) return undefined;
            const path = decodeURIComponent(value.pathname);
            return { key: `${value.hostname}${path}`.replace(/\/$/, ''),
                insensitive: Boolean(value.hostname) || /^\/[a-z]:\//i.test(path) };
        } catch { return undefined; }
    };
    const ordered = mappings.flatMap(mapping => {
        const source = fileKey(mapping.sourceUri);
        return source && fileKey(mapping.targetUri) ? [{ ...mapping, ...source }] : [];
    }).sort((a, b) => Number(Boolean(a.directory)) - Number(Boolean(b.directory)) || b.key.length - a.key.length);
    const rebase = (uri: string): string | undefined => {
        const file = fileKey(uri);
        if (!file) return undefined;
        for (const mapping of ordered) {
            const source = mapping.insensitive ? mapping.key.toLowerCase() : mapping.key;
            const target = mapping.insensitive ? file.key.toLowerCase() : file.key;
            if (target === source) return mapping.targetUri;
            if (!mapping.directory || !target.startsWith(`${source}/`)) continue;
            const relative = file.key.slice(mapping.key.length + 1).split('/').map(encodeURIComponent).join('/');
            return `${mapping.targetUri.replace(/\/?$/, '/')}${relative}`;
        }
        return undefined;
    };
    const contextFileUri = view.contextFileUri ? rebase(view.contextFileUri) : undefined;
    const positions = Object.fromEntries(Object.entries(view.contextFileScrollPositions || {}).flatMap(([uri, position]) => {
        const mapped = rebase(uri);
        return mapped ? [[mapped, { ...position }]] : [];
    }));
    return { ...view, contextFileUri, contextFileMaximized: Boolean(contextFileUri && view.contextFileMaximized),
        contextFileScrollPositions: Object.keys(positions).length ? positions : undefined };
}

export interface ConversationTurnWithCheckpoints extends ConversationTurnLike {
    readonly changes?: readonly ConversationCheckpointLike[];
    /** Immutable versions after the preparatory restore, before this prompt. */
    readonly workspaceBaselines?: readonly ConversationWorkspaceVersion[];
    /** Editor/timeline writes whose previews may not yet have been loaded. */
    readonly fileVersionReceipts?: readonly ConversationWorkspaceVersion[];
    readonly attachments?: readonly { readonly workspaceRelativePath?: string }[];
}

/**
 * Whether a branch needs a private workspace copy.  A conversation can have
 * plenty of turns without ever touching its workspace; copying the entire
 * project in that case is both wasteful and, for projectless conversations,
 * can fail on an unrelated large file.  Keep this decision next to the
 * checkpoint traversal so the edit and branch paths use the same rule.
 */
export function conversationTurnsHaveWorkspaceState<T extends ConversationTurnWithCheckpoints>(
    turns: readonly T[]
): boolean {
    return turns.some(turn => [...(turn.changes || []), ...(turn.workspaceBaselines || []), ...(turn.fileVersionReceipts || [])].some(change => Boolean(change.checkpointId.trim()))
        || (turn.attachments || []).some(attachment => Boolean(attachment.workspaceRelativePath?.trim())));
}

export interface ConversationHistoryMessage {
    readonly role: 'user' | 'assistant';
    readonly content: string;
}

export interface ConversationAttachmentLike {
    readonly id: string;
    readonly name?: string;
}

function cloneConversationValue<T>(value: T): T {
    if (Array.isArray(value)) return value.map(item => cloneConversationValue(item)) as T;
    if (value && typeof value === 'object') return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, cloneConversationValue(item)])
    ) as T;
    return value;
}

export function conversationCheckpointRestoreKey(
    conversationId: string,
    workspacePath: string,
    checkpointId: string
): string {
    const normalizedWorkspace = workspacePath.trim().replace(/\\/g, '/').replace(/\/+$/, '');
    const scope = normalizedWorkspace
        ? `conversation:${conversationId.trim()}::workspace:${normalizedWorkspace}`
        : `conversation:${conversationId.trim()}`;
    return `${scope}::${checkpointId.trim()}`;
}

function targetIndex<T extends ConversationTurnLike>(turns: readonly T[], targetTurnId: string): number {
    const index = turns.findIndex(turn => turn.id === targetTurnId);
    if (index < 0) throw new Error(`Unknown conversation turn: ${targetTurnId}`);
    return index;
}

export function conversationTurnsBefore<T extends ConversationTurnLike>(
    turns: readonly T[], targetTurnId: string
): readonly T[] {
    return turns.slice(0, targetIndex(turns, targetTurnId));
}

export function inheritConversationTurns<T extends ConversationTurnLike>(turns: readonly T[]): readonly T[] {
    return turns.map(turn => cloneConversationValue(turn));
}

export function inheritConversationTurnsBefore<T extends ConversationTurnLike>(
    turns: readonly T[], targetTurnId: string
): readonly T[] {
    return inheritConversationTurns(conversationTurnsBefore(turns, targetTurnId));
}

/** Clone the immutable conversation prefix ending at `targetTurnId`. */
export function inheritConversationTurnsThrough<T extends ConversationTurnLike>(
    turns: readonly T[], targetTurnId: string
): readonly T[] {
    return inheritConversationTurns(turns.slice(0, targetIndex(turns, targetTurnId) + 1));
}

export type ConversationBranchMessageRole = 'user' | 'assistant';

/** Return the persisted visible-message identity, with a stable legacy fallback. */
export function conversationMessageId(
    turn: Pick<ConversationTurnLike, 'id' | 'userMessageId' | 'assistantMessageId'>,
    role: ConversationBranchMessageRole
): string {
    const persisted = role === 'user' ? turn.userMessageId : turn.assistantMessageId;
    return persisted?.trim() || `${turn.id.trim()}:${role}`;
}

export function conversationHistoryStateToken(
    session: { readonly historyRevision?: number; readonly turns: readonly Pick<ConversationTurnLike, 'id'>[] }
): string {
    // Drafts and view metadata may be saved while a workspace restore is in flight.
    // Only history topology invalidates the edit; the commit merges all other fields
    // from the latest session snapshot.
    return JSON.stringify([session.historyRevision || 0, ...session.turns.map(turn => turn.id)]);
}

/** One in-flight history/workspace mutation per conversation. */
export class ConversationMutationLock {
    private readonly active = new Set<string>();

    tryAcquire(conversationId: string): (() => void) | undefined {
        const id = conversationId.trim();
        if (!id || this.active.has(id)) return undefined;
        this.active.add(id);
        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.active.delete(id);
        };
    }
}

/**
 * Clone a branch through one visible message rather than assuming that the
 * prompt and assistant response are always one indivisible UI item.
 */
export function inheritConversationTurnsThroughMessage<T extends ConversationTurnLike>(
    turns: readonly T[], targetTurnId: string, role: ConversationBranchMessageRole
): readonly T[] {
    if (role === 'assistant') return inheritConversationTurnsThrough(turns, targetTurnId);
    const index = targetIndex(turns, targetTurnId);
    const target = cloneConversationValue(turns[index]);
    const promptOnly = {
        ...target,
        response: '',
        finalMessage: undefined,
        outputParts: undefined,
        outputAssetOwnerId: undefined,
        citations: undefined,
        archivedChildResults: undefined,
        stage: 'complete',
        branchUserOnly: true,
        changes: undefined,
        workspaceBaselines: undefined,
        fileVersionReceipts: undefined,
        steeringMessages: [],
        executionLabel: undefined,
        usageLabel: undefined,
        billingLabel: undefined
    } as T;
    return [...inheritConversationTurns(turns.slice(0, index)), promptOnly];
}

/**
 * Recovered payloads may arrive from memory and disk in different orders. Use
 * the durable turn metadata as the authority and reject partial recovery.
 */
export function conversationAttachmentsInOriginalOrder<
    TAttachment extends ConversationAttachmentLike,
    TRecovered extends { readonly id: string }
>(
    original: readonly TAttachment[],
    recovered: readonly TRecovered[]
): readonly TRecovered[] {
    const recoveredById = new Map(recovered.map(item => [item.id, item]));
    const originalIds = new Set<string>();
    const ordered = original.map(attachment => {
        if (originalIds.has(attachment.id)) {
            throw new Error(`Duplicate attachment id: ${attachment.id}`);
        }
        originalIds.add(attachment.id);
        const item = recoveredById.get(attachment.id);
        if (!item) {
            throw new Error(`Unable to recover attachment: ${attachment.name || attachment.id}`);
        }
        return item;
    });
    return [...ordered, ...recovered.filter(item => !originalIds.has(item.id))];
}

/**
 * Return the checkpoint chain required to restore the workspace to the exact
 * point immediately before `targetTurnId` started. Checkpoints are applied in
 * reverse execution order so repeated writes to the same file unwind safely.
 */
export function conversationCheckpointIdsToRestore<T extends ConversationTurnWithCheckpoints>(
    turns: readonly T[], targetTurnId: string
): readonly string[] {
    const firstRemovedTurn = targetIndex(turns, targetTurnId);
    const checkpointIds: string[] = [];
    for (let turnIndex = turns.length - 1; turnIndex >= firstRemovedTurn; turnIndex -= 1) {
        const turn = turns[turnIndex];
        const changes = [...(turn.fileVersionReceipts || []).filter(receipt => !(turn.changes || []).some(change => change.checkpointId === receipt.checkpointId)), ...(turn.changes || [])];
        for (let changeIndex = changes.length - 1; changeIndex >= 0; changeIndex -= 1) {
            const checkpointId = changes[changeIndex].checkpointId.trim();
            if (checkpointId) checkpointIds.push(checkpointId);
        }
    }
    if (checkpointIds.length) for (let index = turns.length - 1; index >= firstRemovedTurn; index--) {
        for (const baseline of turns[index].workspaceBaselines || []) checkpointIds.push(baseline.checkpointId);
    }
    return checkpointIds;
}

/** Preserve concurrent editor receipts and resumed-run diffs when the model ends. */
export function mergeConversationCheckpointChanges<T extends ConversationCheckpointLike>(previous: readonly T[] = [], incoming: readonly T[] = []): readonly T[] {
    const merged = new Map(previous.map(change => [`${change.workspaceRoot || ''}\0${change.checkpointId}`, change]));
    for (const change of incoming) merged.set(`${change.workspaceRoot || ''}\0${change.checkpointId}`, change);
    return [...merged.values()];
}

/** Explicit, paired answers remain context across turns/models, never queued work. */
export function answeredQuestionMemory(turn: ConversationTurnLike, maximumCharacters = 8_000): string {
    if (turn.branchUserOnly) return '';
    const pending = new Map<string, AgentUserQuestion>();
    const seen = new Set<string>();
    const answers: { question: string; answer: string }[] = [];
    for (const event of turn.events || []) {
        if (event.type === 'user_input_requested') pending.set(agentQuestionKey(event.question), event.question);
        if (event.type !== 'user_input_resolved') continue;
        const key = agentQuestionKey(event);
        const question = pending.get(key);
        if (!question || seen.has(key)) continue;
        seen.add(key);
        if (event.status !== 'answered' || !event.answer) continue;
        const option = event.answer.optionId ? question.options.find(item => item.id === event.answer?.optionId) : undefined;
        if (event.answer.optionId && !option) continue;
        const answer = [option?.label, event.answer.text?.trim()].filter(Boolean).join(' · ');
        if (!answer) continue;
        answers.push({ question: question.prompt, answer });
    }
    const retained = answers.slice(-16);
    if (!retained.length) return '';
    const budget = Math.max(64, Math.min(8_000, maximumCharacters));
    const perAnswer = Math.max(16, Math.floor(budget / retained.length) - 10);
    return retained.map(item => `Q: ${item.question.slice(0, Math.floor(perAnswer * .3))}\nA: ${item.answer.slice(0, Math.floor(perAnswer * .7))}`)
        .join('\n').slice(0, budget);
}

/**
 * Portable evidence, not provider-private replay. Only explicitly public
 * summaries/progress and observed tool receipts cross model boundaries; never
 * serialize an event object, tool arguments, attachments, or provider state.
 */
/**
 * Earlier builds sent a reply's tool evidence inside the assistant message, and some models copied that note into
 * their own answers. The copied note is scaffolding, not the answer: it is hidden and never sent back to a model.
 */
const REPLAYED_CONTEXT_NOTE = /\n*(?:Prior visible progress and tool evidence \(context only; do not re-execute\):|\[Context for the reply that follows: progress and tool results it already produced)[\s\S]*$/;
export function withoutReplayedContextNote(text: string): string {
    return text.replace(REPLAYED_CONTEXT_NOTE, '');
}

function conversationEvidenceMemory(turn: ConversationTurnLike, maximumCharacters = 4_000): string {
    if (turn.branchUserOnly) return '';
    const budget = Math.max(64, Math.min(4_000, maximumCharacters));
    const clip = (text: string, limit: number): string => text.length <= limit ? text
        : `${text.slice(0, Math.max(0, limit - 32))} … [truncated] ${text.slice(-16)}`.slice(0, limit);
    const clean = (value: string): string => value.replace(/data:[^\s]+/gi, '[media omitted]')
        .replace(/[A-Za-z0-9+/=]{256,}/g, '[binary omitted]').replace(/\u001b\[[0-9;]*m/g, '').trim();
    const events = turn.events || [];
    const narration = completedNarrationSourceIndexes(events);
    const evidence = new Map<string, string>();
    const output = new Map<string, string>();
    const pendingTools = new Map<string, { name: string; commandLine?: string }>();
    const pendingProcesses = new Map<string, { name: string; callId: string; commandLine: string }>();
    const completedTools = new Set<string>();
    const interrupted = turn.stage === 'error' || turn.stage === 'cancelled' || turn.stage === 'paused';
    let omitted = false, segment = 0, modelNarration = '';
    const put = (key: string, value: string): void => {
        const text = clean(value);
        if (!text || turn.response.includes(text)) { evidence.delete(key); return; }
        evidence.set(key, clip(text, 800));
        if (evidence.size > 32) { evidence.delete(evidence.keys().next().value!); omitted = true; }
    };
    for (const [index, event] of events.entries()) {
        if (event.type === 'model_started' || event.type === 'backend_selected') { segment++; modelNarration = ''; }
        else if (event.type === 'provider_reasoning' && event.visibility === 'visible') {
            // These events contain cumulative snapshots: replace, do not append.
            put(`reason:${segment}:${event.itemId || event.turn}`, event.content);
        } else if (event.type === 'assistant_delta' && (narration.has(index) || interrupted)) {
            const key = `narration:${segment}`;
            modelNarration = clip(modelNarration + event.delta, 2_000);
            put(key, modelNarration);
        } else if (event.type === 'assistant_progress' && event.origin !== 'runtime') {
            // The runtime's own progress lines are UI text in the user's language; the model gets the tool facts below.
            put(`progress:${index}`, event.content);
        } else if (event.type === 'tool_started') {
            pendingTools.set(event.callId, { name: event.toolName, commandLine: event.summary?.commandLine });
            completedTools.delete(event.callId);
        } else if (event.type === 'tool_process_started') {
            pendingProcesses.set(`${event.callId}:${event.processId}`, { name: event.toolName, callId: event.callId, commandLine: event.commandLine });
        } else if (event.type === 'tool_output') {
            if (!pendingTools.has(event.callId) && !completedTools.has(event.callId)) pendingTools.set(event.callId, { name: event.toolName });
            output.set(event.callId, (output.get(event.callId) || '') + clean(event.chunk).slice(-600));
            output.set(event.callId, output.get(event.callId)!.slice(-600));
            if (output.size > 32) output.delete(output.keys().next().value!);
        } else if (event.type === 'tool_completed') {
            pendingTools.delete(event.callId);
            completedTools.add(event.callId);
            // Identity receipts must outlive the bounded text buffers: a late
            // background chunk must not turn a completed call back into unknown.
            const summary = event.summary;
            const completionStatus = event.ok ? 'succeeded' : 'failed';
            // The tool's display title is UI text; its name and status already say what ran.
            put(`tool:${event.callId}`, [
                `[${event.toolName}: ${event.status || completionStatus}]`,
                canonicalToolSummary(summary, event.toolName), summary.commandLine,
                event.failure ? `Error code: ${event.failure.code}` : '',
                output.get(event.callId)
            ].filter(Boolean).map(value => clip(clean(String(value)), 600)).join(' · '));
            output.delete(event.callId);
        } else if (event.type === 'tool_process_exited') {
            pendingProcesses.delete(`${event.callId}:${event.processId}`);
            put(`exit:${event.callId}`, `[${event.toolName}] exit=${event.exitCode}, signal=${event.signal || 'none'} ${output.get(event.callId) || ''}`);
            output.delete(event.callId);
        }
        for (const pending of [pendingTools, pendingProcesses]) if (pending.size > 32) {
            pending.delete(pending.keys().next().value!);
            omitted = true;
        }
    }
    // Starting a tool or child process may already have side effects. Missing a
    // receipt means unknown, not success or non-execution; do not emit synthetic
    // tool calls/results that a different model might replay as completed work.
    for (const [callId, tool] of pendingTools) put(`pending-tool:${callId}`, [
        `[${tool.name}: started; result unknown; completion not recorded; verify before retrying]`,
        tool.commandLine, output.get(callId)
    ].filter(Boolean).map(value => clip(clean(String(value)), 600)).join(' · '));
    for (const [processId, process] of pendingProcesses) put(`pending-process:${processId}`, [
        `[${process.name} process: started; result unknown; exit not recorded; verify before retrying]`,
        process.commandLine, output.get(process.callId)
    ].filter(Boolean).map(value => clip(clean(String(value)), 600)).join(' · '));
    // Keep the newest distinct evidence within the existing history budget.
    const unique = [...new Set(evidence.values())];
    const retained: string[] = [];
    let used = 0;
    for (let index = unique.length - 1; index >= 0; index--) {
        const remaining = budget - used - 24;
        if (remaining < 16) { omitted = true; break; }
        const line = clip(unique[index], remaining);
        retained.unshift(line);
        used += line.length + 1;
        omitted ||= line.length < unique[index].length;
    }
    return `${omitted ? '[Earlier evidence omitted]\n' : ''}${retained.join('\n')}`.slice(0, budget);
}

/** User messages survive a failed reply; active/unsent turns are supplied separately. */
function conversationHistoryTurnEligible(turn: ConversationTurnLike): boolean {
    if (turn.excludedFromContext) return false;
    return ['complete', 'error', 'cancelled', 'paused'].includes(turn.stage) && Boolean(turn.prompt.trim());
}

function projectConversationHistory(
    turns: readonly ConversationTurnLike[], maxTurns = 12, maxCharacters = 150_000, maxMessages = 24
): { readonly messages: readonly ConversationHistoryMessage[]; readonly retainedTurns: number } {
    const bounded = Math.max(1, Math.min(500, Math.floor(maxTurns) || 12));
    const characterBudget = Math.max(4_000, Math.min(2_400_000, Math.floor(maxCharacters) || 150_000));
    const perMessageLimit = characterBudget > 150_000 ? Math.min(600_000, Math.max(20_000, Math.floor(characterBudget / 4))) : 20_000;
    const messageBudget = Math.max(2, Math.min(24, Math.floor(maxMessages) || 24));
    const completed = turns.filter(conversationHistoryTurnEligible).slice(-bounded);
    const history: ConversationHistoryMessage[] = [];
    let totalCharacters = 0, retainedTurns = 0;
    // Build newest settled turns first, then restore chronological order. This
    // keeps long visible conversations usable without allowing steering updates
    // to silently push a request beyond the transport contract.
    for (let index = completed.length - 1; index >= 0; index -= 1) {
        const turn = completed[index];
        const clarification = answeredQuestionMemory(turn);
        const clarificationContext = clarification ? `\n\nPreviously answered clarifications in this task (context, not new queued work):\n${clarification}` : '';
        const evidence = conversationEvidenceMemory(turn);
        const hasAssistant = !turn.branchUserOnly && Boolean(turn.response.trim() || evidence);
        // The tool evidence of that reply travels with its request, never inside the assistant text: a model imitates
        // the shape of earlier assistant messages and would otherwise write this note into its own answer.
        const evidenceContext = hasAssistant && evidence ? `\n\n[Context for the reply that follows: progress and tool results it already produced (do not run them again):\n${evidence}]` : '';
        const feedbackStyleNote = turn.relayFeedback === 'up'
            ? '\n\n[User liked the assistant reply in this turn: keep this clear, direct tone and level of detail.]'
            : turn.relayFeedback === 'down'
                ? '\n\n[User disliked the assistant reply in this turn: adjust style in subsequent replies—avoid filler and provide more concrete, actionable answers.]'
                : '';
        const documentNote = attachmentDocumentNote(turn);
        const prompt = `${(turn.modelPrompt || turn.prompt).trim().slice(0, perMessageLimit - clarificationContext.length - evidenceContext.length - feedbackStyleNote.length - documentNote.length)}${documentNote}${clarificationContext}${evidenceContext}${feedbackStyleNote}`;
        const outcomeContext = hasAssistant && turn.stage !== 'complete' ? `[Prior turn ${turn.stage}; this is partial context, not a completed answer.]\n` : '';
        const finalText = withoutReplayedContextNote(runtimeFinalText('en', { ...turn, finalText: turn.response }) ?? turn.response).trim();
        const response = `${outcomeContext}${finalText.slice(0, perMessageLimit - outcomeContext.length) || '[No visible reply; see the tool results noted with the request.]'}`;
        const directions = (turn.steeringMessages || [])
            .filter(message => message.status === 'applied' && message.content.trim())
            .slice(-16)
            .map(message => ({ role: 'user' as const, content: message.content.trim().slice(0, perMessageLimit) }));
        const candidate: ConversationHistoryMessage[] = [
            { role: 'user', content: prompt },
            ...directions,
            ...(hasAssistant ? [{ role: 'assistant' as const, content: response }] : [])
        ];
        const minimumMessages = hasAssistant ? 2 : 1;
        while (candidate.length > minimumMessages && history.length + candidate.length > messageBudget) candidate.splice(1, 1);
        let candidateCharacters = candidate.reduce((sum, message) => sum + message.content.length, 0);
        while (candidate.length > minimumMessages && totalCharacters + candidateCharacters > characterBudget) {
            candidateCharacters -= candidate[1].content.length;
            candidate.splice(1, 1);
        }
        if (history.length + candidate.length > messageBudget || totalCharacters + candidateCharacters > characterBudget) break;
        history.unshift(...candidate);
        totalCharacters += candidateCharacters;
        retainedTurns++;
    }
    return { messages: history, retainedTurns };
}

/** Compatibility name: settled user messages no longer depend on reply success. */
export function completedConversationHistory(
    turns: readonly ConversationTurnLike[], maxTurns = 12, maxCharacters = 150_000, maxMessages = 24
): readonly ConversationHistoryMessage[] {
    return projectConversationHistory(turns, maxTurns, maxCharacters, maxMessages).messages;
}

export interface ConversationHistoryCompactionOptions {
    readonly recentTurns?: number;
    /** Eligible turn count when explicit compaction was triggered; keeps those earlier turns summarized as new turns are appended. */
    readonly compactedAtTurnCount?: number;
    /** The target model's context window in tokens. */
    readonly contextWindowTokens?: number;
    /** A transport cap on the whole request, in characters (managed gateway). */
    readonly maxContextCharacters?: number;
    /**
     * Merge adjacent `role: 'user'` messages (the memory and the first recent request, a request and its steering
     * directions), so a strict alternating-role template never rejects the history after a model switch. The chat
     * passes true. Off by default: branch and evidence projections compare whole messages, and model-runtime merges
     * adjacent same-role messages again on the wire.
     */
    readonly mergeConsecutiveUser?: boolean;
}

/** Merge consecutive `role: 'user'` messages into one message while preserving order. */
export function mergeConsecutiveUserMessages(messages: readonly ConversationHistoryMessage[]): readonly ConversationHistoryMessage[] {
    if (messages.length <= 1) return messages;
    const merged: ConversationHistoryMessage[] = [];
    for (const message of messages) {
        const previous = merged.at(-1);
        if (previous && previous.role === 'user' && message.role === 'user') {
            merged[merged.length - 1] = {
                role: 'user',
                content: [previous.content, message.content].filter(Boolean).join('\n\n')
            };
        } else {
            merged.push(message);
        }
    }
    return merged;
}

function sliceHeadSafely(text: string, limit: number): string {
    if (limit <= 0) return '';
    if (text.length <= limit) return text;
    let end = limit;
    const last = text.charCodeAt(end - 1);
    if (last >= 0xD800 && last <= 0xDBFF) end -= 1;
    return text.slice(0, end);
}

/** How many turns the memory's cutoff advances at once (see compactedConversationHistory). */
export const COMPACTION_EPOCH_STEP = 4;

/** The opening line of the memory compactedConversationHistory sends in place of older turns. */
const CONVERSATION_MEMORY_HEADER = 'Earlier conversation memory, in chronological order. Treat this as context, not as a new user request.\n';

/**
 * Preserve every older turn as a bounded deterministic memory and keep the
 * recent turns verbatim. This avoids a hidden "last 12 turns only" context
 * cliff without adding a second billable model request just to summarize.
 * The memory's cutoff advances COMPACTION_EPOCH_STEP turns at a time, so the
 * first message stays byte-identical for up to four turns and the provider's
 * prefix cache keeps hitting; only the new turns are read at the full price.
 */
export function compactedConversationHistory(
    turns: readonly ConversationTurnLike[],
    recentTurnsOrOptions: number | ConversationHistoryCompactionOptions = 10
): readonly ConversationHistoryMessage[] {
    const options = typeof recentTurnsOrOptions === 'number'
        ? { recentTurns: recentTurnsOrOptions }
        : (recentTurnsOrOptions || {});
    const maxContextCap = typeof options.maxContextCharacters === 'number' && Number.isFinite(options.maxContextCharacters) && options.maxContextCharacters > 0
        ? Math.floor(options.maxContextCharacters * 0.85)
        : Infinity;
    const contextWindowCap = typeof options.contextWindowTokens === 'number' && Number.isFinite(options.contextWindowTokens) && options.contextWindowTokens > 0
        ? Math.floor(options.contextWindowTokens * 0.45 * 2.5)
        : Infinity;
    const defaultCap = options.contextWindowTokens !== undefined || options.maxContextCharacters !== undefined ? 2_400_000 : 150_000;
    const totalBudget = Math.max(8_000, Math.min(defaultCap, maxContextCap, contextWindowCap));
    const recentBudget = Math.max(4_000, Math.floor((totalBudget * 100_000) / 150_000));

    const eligible = turns.filter(conversationHistoryTurnEligible);
    const recentCount = Math.max(1, Math.min(10, Math.floor(options.recentTurns ?? 10) || 10));
    const rawOlderCount = Math.max(0, eligible.length - recentCount);
    const compactedTurnCount = typeof options.compactedAtTurnCount === 'number' && Number.isFinite(options.compactedAtTurnCount) && options.compactedAtTurnCount > 0
        ? Math.floor(options.compactedAtTurnCount)
        : 0;
    const explicitCompactedOlderCount = compactedTurnCount === 2 ? 1 : Math.max(0, compactedTurnCount - 2);
    // Rounding the cutoff up keeps the verbatim tail between recentCount - 3 and recentCount turns. A short tail cannot
    // absorb that (an explicit compaction keeps exactly 2), so it is cut where it was asked to be.
    const baseOlderCount = rawOlderCount > 0 && recentCount > COMPACTION_EPOCH_STEP
        ? Math.min(eligible.length - 1, Math.ceil(rawOlderCount / COMPACTION_EPOCH_STEP) * COMPACTION_EPOCH_STEP)
        : rawOlderCount === 0 && recentCount <= 2 && eligible.length === 2
            ? 1
            : rawOlderCount;
    const olderCount = eligible.length > 1
        ? Math.min(eligible.length - 1, Math.max(baseOlderCount, explicitCompactedOlderCount))
        : 0;
    const recentTail = eligible.slice(olderCount);
    const recentTailSet = new Set(recentTail);
    const recentSource = eligible.filter(turn => Boolean(turn.pinned) || recentTailSet.has(turn));
    const projection = projectConversationHistory(recentSource, Math.max(recentCount, recentSource.length), recentBudget, 22);
    const recent = projection.messages;
    // The projection keeps the newest turns of recentSource word for word. Every other turn, a pinned one that did not
    // fit included, goes into the memory, so nothing is dropped and nothing is sent twice.
    const verbatim = new Set(recentSource.slice(recentSource.length - projection.retainedTurns));
    const older = eligible.filter(turn => !verbatim.has(turn));
    const alternating = (messages: readonly ConversationHistoryMessage[]) => options.mergeConsecutiveUser ? mergeConsecutiveUserMessages(messages) : messages;
    if (!older.length) return alternating(recent);

    const recentCharacters = recent.reduce((sum, message) => sum + message.content.length, 0);
    const header = CONVERSATION_MEMORY_HEADER;
    const minSummaryBudget = Math.max(1_000, Math.floor((totalBudget * 4_000) / 150_000));
    const maxSummaryBudget = Math.max(minSummaryBudget, Math.floor((totalBudget * 48_000) / 150_000));
    const summaryBudget = Math.min(
        Math.max(0, totalBudget - recentCharacters),
        Math.max(minSummaryBudget, Math.min(maxSummaryBudget, totalBudget - recentCharacters))
    );
    // No room for one memory line: send the recent turns alone rather than a cut header or an empty message,
    // which the runtime rejects as invalid history.
    if (summaryBudget < header.length + 64) return alternating(recent);
    const available = Math.max(64, summaryBudget - header.length);
    const explicitCompaction = recentCount <= 2 || compactedTurnCount > 0;
    const firstSlotCap = explicitCompaction ? 1_200 : 2_400;
    const otherSlotCap = explicitCompaction ? 640 : 1_200;
    const firstSlotBudget = older.length === 1
        ? Math.min(firstSlotCap, available)
        : Math.max(64, Math.min(firstSlotCap, Math.floor(available * 0.4), Math.floor((available * 2.5) / (older.length + 1.5))));
    const otherSlotBudget = older.length <= 1
        ? Math.min(otherSlotCap, available)
        : Math.max(64, Math.min(otherSlotCap, Math.floor(firstSlotBudget * 0.75), Math.floor(Math.max(0, available - firstSlotBudget) / (older.length - 1))));
    const compact = (value: string, limit: number): string => {
        const normalized = value.replace(/\s+/g, ' ').trim();
        if (normalized.length <= limit) return normalized;
        if (limit <= 4) return `${sliceHeadSafely(normalized, Math.max(1, limit - 1))}…`;
        const ellipsis = ' … ';
        const excerptBudget = limit - ellipsis.length;
        let headEnd = Math.max(1, Math.round(excerptBudget * 0.55));
        const headLast = normalized.charCodeAt(headEnd - 1);
        if (headLast >= 0xD800 && headLast <= 0xDBFF) headEnd -= 1;
        let tailStart = normalized.length - Math.max(1, excerptBudget - headEnd);
        const tailFirst = normalized.charCodeAt(tailStart);
        if (tailFirst >= 0xDC00 && tailFirst <= 0xDFFF) tailStart += 1;
        return `${normalized.slice(0, headEnd).trimEnd()}${ellipsis}${normalized.slice(tailStart).trimStart()}`;
    };
    const lines = older.map((turn, index) => {
        const slotBudget = index === 0 ? firstSlotBudget : otherSlotBudget;
        const hasResponse = !turn.branchUserOnly && Boolean(turn.response.trim());
        const outcome = !turn.branchUserOnly && turn.stage !== 'complete' ? ` | Prior turn ${turn.stage}; incomplete` : '';
        const baseOverhead = `#${index + 1} user: `.length + outcome.length + (hasResponse ? ' | assistant: '.length : 0) + 1;
        const perTurnBudget = Math.max(64, slotBudget - baseOverhead);
        const clarification = answeredQuestionMemory(turn, Math.max(64, Math.floor(perTurnBudget * .5)));
        const evidence = conversationEvidenceMemory(turn, Math.max(64, Math.floor(perTurnBudget * .25)));
        const clarificationPart = clarification ? ` | answered clarification: ${clarification.replace(/\n/g, ' ')}` : '';
        const evidencePart = evidence ? ` | evidence: ${evidence.replace(/\n/g, ' ')}` : '';
        // A saved document stays findable from the memory: its path is kept whole, never shortened.
        const documentsPart = (turn.attachmentDocuments || []).map(document => ` | document "${document.name}" saved at ${document.path} (${document.lines} lines)`).join('');
        const responseBudget = !hasResponse ? 0 : Math.max(24, Math.floor(perTurnBudget * (clarification ? .2 : .45)) - Math.floor(evidencePart.length / 2));
        const promptBudget = Math.max(24, perTurnBudget - responseBudget - clarificationPart.length - evidencePart.length - documentsPart.length);
        const prompt = compact(turn.modelPrompt || turn.prompt, promptBudget);
        const response = responseBudget ? compact(runtimeFinalText('en', { ...turn, finalText: turn.response }) ?? turn.response, responseBudget) : '';
        return `#${index + 1} user: ${prompt}${documentsPart}${outcome}${clarificationPart}${response ? ` | assistant: ${response}` : ''}${evidencePart}`;
    });
    let summaryBody = lines.join('\n');
    if (header.length + summaryBody.length > summaryBudget && lines.length > 1) {
        const firstLine = lines[0];
        const keptTail: string[] = [];
        let tailChars = 0;
        for (let index = lines.length - 1; index >= 1; index -= 1) {
            const candidateLine = lines[index];
            const nextTailChars = tailChars + (keptTail.length > 0 ? 1 : 0) + candidateLine.length;
            const omittedCount = index - 1;
            const marker = omittedCount > 0 ? `\n... (${omittedCount} intermediate turns omitted) ...\n` : '\n';
            if (header.length + firstLine.length + marker.length + nextTailChars <= summaryBudget) {
                keptTail.unshift(candidateLine);
                tailChars = nextTailChars;
            } else {
                break;
            }
        }
        if (keptTail.length > 0) {
            const omittedCount = lines.length - 1 - keptTail.length;
            const marker = omittedCount > 0 ? `\n... (${omittedCount} intermediate turns omitted) ...\n` : '\n';
            summaryBody = `${firstLine}${marker}${keptTail.join('\n')}`;
        }
    }
    const summary = sliceHeadSafely(`${header}${summaryBody}`, summaryBudget);
    return alternating([{ role: 'user', content: summary }, ...recent]);
}

/**
 * The position in `history` (as compactedConversationHistory built it from `turns`) of the user message that still
 * carries the request of turn `turnId` word for word, or -1 once that turn went into the memory.
 * - A request opens its message. With mergeConsecutiveUser the memory comes first, then the request after a blank line.
 * - Its notes (documents, clarifications, tool evidence, feedback, steering) follow after a blank line.
 * - A request asked again later ("继续", "ok") is told apart by counting the later identical requests from the newest.
 * - Anything else (a request merged behind an earlier user-only turn) reads as gone, so the caller sends it again.
 */
export function historyIndexOfTurnRequest(
    history: readonly { readonly role: string; readonly content: string }[], turns: readonly ConversationTurnLike[], turnId: string
): number {
    const index = turns.findIndex(turn => turn.id === turnId);
    const request = index >= 0 ? (turns[index].modelPrompt || turns[index].prompt).trim() : '';
    if (!request || !conversationHistoryTurnEligible(turns[index])) return -1;
    // A very long request is sent cut to the message limit; its opening words still identify it.
    const probe = request.slice(0, 4_000);
    const opensAt = (content: string, at: number): boolean => content.startsWith(probe, at)
        && (probe.length < request.length || content.length === at + probe.length || content.startsWith('\n\n', at + probe.length));
    let later = turns.slice(index + 1).filter(turn => conversationHistoryTurnEligible(turn) && (turn.modelPrompt || turn.prompt).trim() === request).length;
    for (let position = history.length - 1; position >= 0; position--) {
        const { role, content } = history[position];
        if (role !== 'user') continue;
        // The memory's own lines never hold a blank line, so its first one ends it.
        const afterMemory = content.startsWith(CONVERSATION_MEMORY_HEADER) ? content.indexOf('\n\n') : -1;
        if (!opensAt(content, 0) && !(afterMemory >= 0 && opensAt(content, afterMemory + 2))) continue;
        if (later === 0) return position;
        later--;
    }
    return -1;
}
