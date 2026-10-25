import { normalizeReasoningSettings } from '../common/nextmux-model-controls';
import { capacityReasonMetadata } from '@nextmux/model-runtime/capacity-reasons';
import { normalizeRuntimeFinalMessage } from './nextmux-agent-outcome-locale';
import { classifyModelError } from '@nextmux/model-runtime/errors';
import { isLowLevelTaskPlanTitle, isUserFollowUpRecord, normalizeQueuedTaskDispatch } from './nextmux-agent-task-queue';
import { normalizeContextFileScrollPositions } from './nextmux-file-editor-scroll';
import { normalizeAgentTokenBudgetSnapshot } from '@nextmux/agent-runtime/token-budget';
import { normalizeModelCitations } from '@nextmux/agent-runtime/citations';
import { normalizeAgentOutputParts } from '@nextmux/agent-runtime/output-parts';
import { normalizeAgentRunVerification } from '@nextmux/agent-runtime/run-verification';
import { normalizeModelErrorDiagnostic } from '@nextmux/agent-runtime/model-error-signals';
import { normalizeArchivedChildResults } from '../common/nextmux-citation-display';
import type { AgentContextMemoryItem } from '@nextmux/agent-runtime';
import type { AgentCouncilRouteSource } from '@nextmux/agent-runtime/council';
import { AgentChildDraft, agentChildDraftClock, normalizeAgentChildDrafts } from '../common/nextmux-agent-child-drafts';
import { optionalKeyPriceQuoteId } from '../common/nextmux-price-quote';
import { normalizeRelayFeedbackRequestIds } from '../common/nextmux-relay-feedback';
import { normalizeManagedPriceUpdate } from './nextmux-managed-price-notice';
import { goalUpdateObjective } from './nextmux-goal-presentation';

/**
 * Council child route sources as emitted by the runtime, plus names older or
 * briefly written history used (role_slot -> role_match; lead_random_fallback and
 * lead_fallback -> random_fallback), so persisted conversations keep their labels.
 */
const COUNCIL_ROUTE_SOURCES: Readonly<Record<string, AgentCouncilRouteSource>> = {
    explicit_slot: 'explicit_slot', role_match: 'role_match', generalist_fallback: 'generalist_fallback',
    random_fallback: 'random_fallback',
    role_slot: 'role_match', lead_random_fallback: 'random_fallback', lead_fallback: 'random_fallback'
};

export function normalizeCouncilRouteSource(value: unknown): AgentCouncilRouteSource | undefined {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(COUNCIL_ROUTE_SOURCES, value) ? COUNCIL_ROUTE_SOURCES[value] : undefined;
}

export const CONVERSATION_HISTORY_MIRROR_VERSION = 2 as const;

export interface ConversationHistoryTurnLike {
    readonly id: string;
    readonly createdAt?: number;
}

export interface ConversationHistorySessionLike<TTurn extends ConversationHistoryTurnLike = ConversationHistoryTurnLike> {
    readonly id: string;
    readonly updatedAt: number;
    /**
     * Monotonic generation of the ordered turn history. Increment this only when an existing
     * history is destructively rewritten (for example, edit-and-resend truncates its old tail).
     * Sessions in the same generation may still be incrementally merged.
     */
    readonly historyRevision?: number;
    /**
     * Renderer-owned state changes independently from turn history. Keeping a separate clock
     * prevents a pane resize or scroll restore from reordering the conversation list while still
     * allowing an immediate reload to beat a slightly stale durable snapshot.
     */
    readonly viewStateUpdatedAt?: number;
    readonly viewState?: unknown;
    readonly agentChildDrafts?: readonly AgentChildDraft[];
    readonly agentChildDraftsUpdatedAt?: number;
    readonly turns: readonly TTurn[];
}

export interface ConversationHistoryMirrorReadResult {
    readonly sessions: readonly unknown[];
    readonly legacy: boolean;
    readonly complete: boolean;
}

export interface ConversationHistoryMirrorLimits {
    readonly sessions: number;
    readonly turnsPerSession: number;
    readonly promptCharacters: number;
    readonly responseCharacters: number;
    readonly errorCharacters: number;
}

export interface ConversationHistoryMergeOptions {
    readonly mutatedDuringLoad: boolean;
    readonly initialSessionIds: ReadonlySet<string>;
    /** Provenance of the immutable renderer snapshot taken before startup interaction. */
    readonly initialSnapshot?: {
        readonly complete: boolean;
        readonly sessions: readonly ConversationHistorySessionLike[];
    };
}

export interface ConversationHistoryMergeResult<TSession> {
    readonly sessions: readonly TSession[];
    readonly changedFromDurable: boolean;
}

export interface OwnedConversationWorkspaceBinding {
    readonly id: string;
    readonly ownedWorkspace?: boolean;
    /** A legacy absolute path may be present, but is never passed to the resolver. */
    readonly privateWorkspacePath?: string;
}

/** Keep the current conversation when its original project is not mounted on this machine. */
export function reusableConversationForWorkspace<TSession extends { readonly workspacePath: string }>(
    current: TSession | undefined,
    activeWorkspaceRoot: string,
    isWorkspaceOpen: (workspacePath: string) => boolean
): TSession | undefined {
    if (!current) return undefined;
    return (current.workspacePath === activeWorkspaceRoot
        || !activeWorkspaceRoot && Boolean(current.workspacePath) && !isWorkspaceOpen(current.workspacePath))
        ? current : undefined;
}

/** Remove machine-local workspace bindings only at persistence boundaries. */
export function portableConversationHistorySessions<TSession extends OwnedConversationWorkspaceBinding>(
    sessions: readonly TSession[]
): readonly Omit<TSession, 'privateWorkspacePath'>[] {
    return sessions.map(session => {
        if (!Object.prototype.hasOwnProperty.call(session, 'privateWorkspacePath')) return session;
        const { privateWorkspacePath: _machineLocalPath, ...portable } = session;
        return portable;
    });
}

/** Resolve backend-owned workspaces on this machine without trusting persisted absolute paths. */
export async function resolveOwnedConversationWorkspacePaths(
    sessions: readonly OwnedConversationWorkspaceBinding[],
    resolve: (conversationId: string) => Promise<string>
): Promise<ReadonlyMap<string, string>> {
    const ids = [...new Set(sessions.filter(session => session.ownedWorkspace === true).map(session => session.id))];
    const entries = await Promise.all(ids.map(async id => {
        try {
            const path = await resolve(id);
            return path && !/[\r\n\0]/.test(path) ? [id, path] as const : undefined;
        } catch {
            return undefined;
        }
    }));
    return new Map(entries.filter((entry): entry is readonly [string, string] => entry !== undefined));
}

export function selectConversationWorkspaceForkSource(
    session: OwnedConversationWorkspaceBinding,
    localWorkspaceRoot: string
): { readonly kind: 'owned' } | { readonly kind: 'project'; readonly workspaceRoot: string } {
    return session.ownedWorkspace === true || !localWorkspaceRoot
        ? { kind: 'owned' }
        : { kind: 'project', workspaceRoot: localWorkspaceRoot };
}

const DEFAULT_MIRROR_LIMITS: ConversationHistoryMirrorLimits = {
    sessions: 80,
    turnsPerSession: 4,
    promptCharacters: 2_000,
    responseCharacters: 4_000,
    errorCharacters: 1_000
};

const HISTORY_READ_LIMITS: ConversationHistoryMirrorLimits = {
    sessions: Number.MAX_SAFE_INTEGER,
    turnsPerSession: Number.MAX_SAFE_INTEGER,
    promptCharacters: Number.MAX_SAFE_INTEGER,
    responseCharacters: Number.MAX_SAFE_INTEGER,
    errorCharacters: Number.MAX_SAFE_INTEGER
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function boundedString(value: unknown, maximum: number): string {
    return typeof value === 'string' ? value.slice(0, maximum) : '';
}

function durableAttachmentUri(value: unknown): string {
    const uri = boundedString(value, 32_768);
    return /^file:/i.test(uri) ? uri : '';
}

function controlledAttachmentPath(value: unknown): string {
    return typeof value === 'string'
        && /^\.nextmux\/conversation-attachments\/[a-f0-9]{64}(?:-[0-9a-f-]{36})?\.[a-z0-9]{1,12}$/i.test(value)
        ? value : '';
}

function compactAttachmentReferences(value: unknown, includeSize: boolean): readonly unknown[] | undefined {
    if (!Array.isArray(value)) return undefined;
    return value.filter(item => isRecord(item)
        && typeof item.id === 'string'
        && typeof item.uri === 'string'
        && typeof item.name === 'string'
        && ['text', 'image', 'file'].includes(String(item.kind))).slice(0, 20).map(item => ({
            id: boundedString(item.id, 100),
            uri: durableAttachmentUri(item.uri),
            ...(includeSize && typeof item.size === 'number' && Number.isFinite(item.size)
                ? { size: Math.max(0, item.size) } : {}),
            name: boundedString(item.name, 240),
            kind: item.kind,
            ...(typeof item.mimeType === 'string' ? { mimeType: boundedString(item.mimeType, 127) } : {}),
            ...(typeof item.inlineReference === 'string'
                ? { inlineReference: boundedString(item.inlineReference, 500) } : {}),
            ...(controlledAttachmentPath(item.workspaceRelativePath)
                ? { workspaceRelativePath: controlledAttachmentPath(item.workspaceRelativePath) } : {}),
            // A small thumbnail kept with the message (only a bounded JPEG data URL).
            ...(typeof item.thumbnail === 'string' && item.thumbnail.length <= 60_000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(item.thumbnail)
                ? { thumbnail: item.thumbnail } : {})
        }));
}

function optionalString(record: Record<string, unknown>, key: string, maximum: number): Record<string, string> {
    return typeof record[key] === 'string' ? { [key]: boundedString(record[key], maximum) } : {};
}

function optionalFiniteNumber(record: Record<string, unknown>, key: string): Record<string, number> {
    return typeof record[key] === 'number' && Number.isFinite(record[key]) ? { [key]: record[key] } : {};
}

function optionalBoundedFiniteNumber(record: Record<string, unknown>, key: string, maximum: number): Record<string, number> {
    return typeof record[key] === 'number' && Number.isFinite(record[key])
        ? { [key]: Math.max(0, Math.min(maximum, record[key])) } : {};
}

function historyRevision(value: unknown): number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function optionalHistoryRevision(record: Record<string, unknown>): Record<string, number> {
    return Number.isSafeInteger(record.historyRevision) && Number(record.historyRevision) >= 0
        ? { historyRevision: Number(record.historyRevision) }
        : {};
}

function optionalBoolean(record: Record<string, unknown>, key: string): Record<string, boolean> {
    return typeof record[key] === 'boolean' ? { [key]: record[key] } : {};
}

function compactOutputParts(value: unknown): readonly unknown[] | undefined {
    if (value === undefined) return undefined;
    try { return normalizeAgentOutputParts(value); } catch { return undefined; }
}

function compactFileResource(value: unknown): unknown | undefined {
    if (!isRecord(value) || value.kind !== 'file' || typeof value.path !== 'string'
        || !['read', 'created', 'updated'].includes(String(value.action))) return undefined;
    return {
        kind: 'file',
        path: boundedString(value.path, 32_768),
        action: value.action,
        ...optionalFiniteNumber(value, 'startLine'),
        ...optionalFiniteNumber(value, 'endLine')
    };
}

function compactBrowserResource(value: unknown): unknown | undefined {
    if (!isRecord(value) || value.kind !== 'browser' || typeof value.url !== 'string') return undefined;
    let url: URL;
    try {
        url = new URL(value.url);
    } catch {
        return undefined;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return {
        kind: 'browser',
        url: boundedString(url.toString(), 2_000),
        ...(typeof value.title === 'string' && value.title.trim() ? { title: boundedString(value.title, 300) } : {})
    };
}

function compactToolSummary(value: unknown): unknown | undefined {
    if (!isRecord(value) || typeof value.title !== 'string') return undefined;
    const resource = compactFileResource(value.resource) || compactBrowserResource(value.resource);
    return {
        title: boundedString(value.title, 2_000),
        ...optionalString(value, 'kind', 100),
        ...(isRecord(value.params) ? { params: Object.fromEntries(Object.entries(value.params).slice(0, 32)
            .filter(([key, val]) => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) && (typeof val === 'string' || typeof val === 'boolean' || typeof val === 'number' && Number.isFinite(val)))
            .map(([key, val]) => [key, typeof val === 'string' ? boundedString(val, 4096) : val])) } : {}),
        ...optionalString(value, 'commandLine', 8_000),
        ...(Array.isArray(value.details)
            ? { details: value.details.filter((detail): detail is string => typeof detail === 'string').slice(0, 100).map(detail => detail.slice(0, 2_000)) }
            : {}),
        ...(['succeeded', 'failed'].includes(String(value.outcome)) ? { outcome: value.outcome } : {}),
        ...optionalString(value, 'checkpointId', 200),
        ...(Array.isArray(value.checkpointIds) ? { checkpointIds: [...new Set(value.checkpointIds
            .filter((id): id is string => typeof id === 'string' && Boolean(id.trim()) && !id.includes('\0'))
            .slice(0, 10_000).map(id => boundedString(id, 200)))] } : {}),
        ...(Array.isArray(value.changedPaths) ? { changedPaths: [...new Set(value.changedPaths
            .filter((path): path is string => typeof path === 'string' && Boolean(path.trim()) && !path.includes('\0'))
            .slice(0, 10_000).map(path => boundedString(path, 32_768)))] } : {}),
        ...(resource ? { resource } : {})
    };
}

function compactModelFailure(value: unknown): unknown | undefined {
    if (!isRecord(value) || typeof value.code !== 'string' || typeof value.reason !== 'string') return undefined;
    const diagnostic = normalizeModelErrorDiagnostic(value.diagnostic);
    return {
        code: boundedString(value.code, 200),
        ...optionalString(value, 'stage', 40),
        ...optionalString(value, 'category', 40),
        reason: boundedString(value.reason, 2_000),
        retryable: value.retryable === true,
        retrySafe: value.retrySafe === true,
        ...optionalFiniteNumber(value, 'httpStatus'),
        ...optionalString(value, 'requestId', 500),
        ...optionalString(value, 'providerAttemptId', 500),
        ...optionalString(value, 'providerCode', 500),
        ...optionalString(value, 'networkCode', 500),
        ...(diagnostic ? { diagnostic } : {})
    };
}

function compactSteeringMessage(value: unknown, includeStatus: boolean): unknown | undefined {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.content !== 'string'
        || typeof value.createdAt !== 'string') return undefined;
    return {
        id: boundedString(value.id, 200),
        // Preserve the exact update envelope and native kind so restored updates remain short notes.
        content: boundedString(value.content, value.kind === 'goal_update' || goalUpdateObjective(value.content) !== undefined ? 200_000 : 2_000),
        ...(value.kind === 'goal_update' ? { kind: 'goal_update' } : {}),
        createdAt: boundedString(value.createdAt, 100),
        ...(includeStatus && ['accepted', 'applied', 'requeued'].includes(String(value.status)) ? { status: value.status } : {}),
        ...(includeStatus ? optionalString(value, 'appliedAt', 100) : {})
    };
}

function compactRunEvent(value: unknown): unknown | undefined {
    if (!isRecord(value) || typeof value.type !== 'string' || typeof value.at !== 'string') return undefined;
    const at = boundedString(value.at, 100);
    const turn = Number.isFinite(value.turn) ? Number(value.turn) : 0;
    switch (value.type) {
        case 'user_input_requested': {
            const question = value.question;
            if (!isRecord(question) || !question.questionId || !question.runId || !question.taskId || typeof question.prompt !== 'string') return undefined;
            return { type: value.type, at, question: {
                questionId: boundedString(question.questionId, 200), runId: boundedString(question.runId, 200), taskId: boundedString(question.taskId, 200),
                prompt: boundedString(question.prompt, 4_000), allowFreeText: question.kind !== "permission",
                ...(question.kind === "permission" && isRecord(question.approval) ? { kind: "permission", approval: {
                    toolName: boundedString(question.approval.toolName, 180), scope: boundedString(question.approval.scope, 80),
                    target: boundedString(question.approval.target, 24_000), ...optionalString(question.approval, "detail", 8_192),
                    ...(question.approval.outOfWorkspaceWrite === true ? { outOfWorkspaceWrite: true } : {}),
                    ...(Array.isArray(question.approval.outOfWorkspacePaths) ? { outOfWorkspacePaths: question.approval.outOfWorkspacePaths.filter((p): p is string => typeof p === 'string').slice(0, 16).map(p => boundedString(p, 500)) } : {}),
                    ...(question.approval.compoundCommand === true ? { compoundCommand: true } : {}),
                    ...(typeof question.approval.autoIgnoreAfterMs === 'number' && Number.isFinite(question.approval.autoIgnoreAfterMs) ? { autoIgnoreAfterMs: question.approval.autoIgnoreAfterMs } : {})
                } } : {}),
                createdAt: boundedString(question.createdAt, 100), expiresAt: boundedString(question.expiresAt, 100),
                options: Array.isArray(question.options) ? question.options.filter(item => isRecord(item) && typeof item.id === 'string' && typeof item.label === 'string')
                    .slice(0, 6).map(item => ({ id: boundedString(item.id, 200), label: boundedString(item.label, 500), ...optionalString(item, 'description', 1_000) })) : []
            } };
        }
        case 'user_input_resolved': {
            if (!value.questionId || !value.runId || !value.taskId || !['answered', 'cancelled', 'expired'].includes(String(value.status))) return undefined;
            return { type: value.type, at, questionId: boundedString(value.questionId, 200), runId: boundedString(value.runId, 200), taskId: boundedString(value.taskId, 200), status: value.status,
                ...(value.status === 'answered' && isRecord(value.answer) ? { answer: {
                    ...optionalString(value.answer, 'optionId', 200), ...optionalString(value.answer, 'optionLabel', 500), ...optionalString(value.answer, 'text', 10_000)
                } } : {}) };
        }
        case 'backend_selected':
            return { type: value.type, backendId: boundedString(value.backendId, 500), attempt: Number(value.attempt) || 0, at };
        case 'backend_fallback':
            return {
                type: value.type,
                fromBackendId: boundedString(value.fromBackendId, 500),
                toBackendId: boundedString(value.toBackendId, 500),
                reason: boundedString(value.reason, 2_000),
                at
            };
        case 'model_started':
            // A continuation joins the previous text of the reply (the stream projection keeps it one block).
            return { type: value.type, turn, ...(value.continuation === 'output_limit' || value.continuation === 'stream_resume'
                ? { continuation: value.continuation } : {}), at };
        case 'model_phase': {
            const phase = ['thinking', 'responding', 'tool_calling', 'settling', 'waiting_capacity', 'failed'].includes(String(value.phase))
                ? value.phase : undefined;
            if (!phase) return undefined;
            return {
                type: value.type,
                turn,
                phase,
                ...(phase === 'waiting_capacity' ? capacityReasonMetadata(value.capacityReasons) : {}),
                ...optionalString(value, 'attemptId', 500),
                at
            };
        }
        case 'provider_reasoning': {
            // Persist only adapter-marked, provider-visible summaries. Hidden
            // chain-of-thought must never enter a durable conversation mirror.
            if (value.visibility !== 'visible'
                || !['streaming', 'complete'].includes(String(value.status))
                || typeof value.content !== 'string') return undefined;
            const content = boundedString(value.content, 8_000).trim();
            if (!content) return undefined;
            return {
                type: value.type,
                turn,
                visibility: 'visible',
                content,
                status: value.status,
                ...optionalString(value, 'itemId', 500),
                at
            };
        }
        case 'model_attempt_completed': {
            const failure = compactModelFailure(value.failure);
            const outputTokens = typeof value.outputTokens === 'number' && Number.isFinite(value.outputTokens) && value.outputTokens > 0
                ? Math.trunc(value.outputTokens)
                : undefined;
            const generationDurationMs = typeof value.generationDurationMs === 'number' && Number.isFinite(value.generationDurationMs) && value.generationDurationMs > 0
                ? Math.trunc(value.generationDurationMs)
                : undefined;
            return {
                type: value.type,
                turn,
                attempt: Number(value.attempt) || 0,
                outcome: value.outcome === 'failed' ? 'failed' : 'succeeded',
                startedAt: boundedString(value.startedAt, 100),
                at,
                durationMs: Number(value.durationMs) || 0,
                retryScheduled: value.retryScheduled === true,
                ...(outputTokens !== undefined ? { outputTokens } : {}),
                ...(generationDurationMs !== undefined ? { generationDurationMs } : {}),
                ...(failure ? { failure } : {})
            };
        }
        case 'model_completed':
            return { type: value.type, turn, toolCallCount: Number(value.toolCallCount) || 0, at,
                ...(normalizeModelCitations(value.citations).length ? { citations: normalizeModelCitations(value.citations) } : {}) };
        case 'task_plan_updated': {
            // Retired builds persisted synthetic runtime plans. They are migration
            // input only and must not re-enter the live model-plan event stream.
            if (value.source === 'runtime'
                || value.source !== undefined && value.source !== 'model') return undefined;
            const steps = Array.isArray(value.steps) ? value.steps.filter(step => isRecord(step)
                && typeof step.id === 'string' && typeof step.title === 'string'
                && ['pending', 'in_progress', 'completed'].includes(String(step.status))).slice(0, 100).map(step => ({
                    id: boundedString(step.id, 200),
                    title: boundedString(step.title, 2_000),
                    status: step.status
                })).filter(step => !isLowLevelTaskPlanTitle(step.title)) : [];
            return {
                type: value.type,
                steps,
                source: 'model',
                at
            };
        }
        case 'assistant_progress':
            return {
                type: value.type,
                turn,
                content: boundedString(value.content, 8_000),
                ...(['model', 'runtime'].includes(String(value.origin)) ? { origin: value.origin } : {}),
                at
            };
        case 'assistant_delta':
            return { type: value.type, turn, delta: boundedString(value.delta, 8_000), at };
        case 'tool_started': {
            const summary = compactToolSummary(value.summary);
            return {
                type: value.type,
                callId: boundedString(value.callId, 200),
                toolName: boundedString(value.toolName, 500),
                source: boundedString(value.source, 40),
                ...(summary ? { summary } : {}),
                at
            };
        }
        case 'tool_output':
            return {
                type: value.type,
                callId: boundedString(value.callId, 200),
                toolName: boundedString(value.toolName, 500),
                source: boundedString(value.source, 40),
                ...optionalString(value, 'processId', 200),
                stream: ['stdout', 'stderr', 'pty'].includes(String(value.stream)) ? value.stream : 'stdout',
                chunk: boundedString(value.chunk, 8_000),
                sequence: Number(value.sequence) || 0,
                at
            };
        case 'tool_process_started':
            return {
                type: value.type,
                callId: boundedString(value.callId, 200),
                toolName: boundedString(value.toolName, 500),
                source: boundedString(value.source, 40),
                processId: boundedString(value.processId, 200),
                commandLine: boundedString(value.commandLine, 8_000),
                interactive: value.interactive === true,
                at
            };
        case 'tool_process_exited':
            return {
                type: value.type,
                callId: boundedString(value.callId, 200),
                toolName: boundedString(value.toolName, 500),
                source: boundedString(value.source, 40),
                processId: boundedString(value.processId, 200),
                exitCode: typeof value.exitCode === 'number' && Number.isFinite(value.exitCode) ? value.exitCode : null,
                signal: typeof value.signal === 'string' ? boundedString(value.signal, 40) : null,
                ...optionalString(value, 'failure', 2_000),
                ...optionalString(value, 'terminationReason', 40),
                at
            };
        case 'tool_completed': {
            const summary = compactToolSummary(value.summary);
            if (!summary) return undefined;
            return {
                type: value.type,
                callId: boundedString(value.callId, 200),
                toolName: boundedString(value.toolName, 500),
                ok: value.ok === true,
                summary,
                durationMs: Number(value.durationMs) || 0,
                at
            };
        }
        case 'context_compaction_started':
            return { type: value.type, turn, segment: Number(value.segment) || 0, at };
        case 'context_compaction_completed':
            return {
                type: value.type,
                turn,
                segment: Number(value.segment) || 0,
                messagesBefore: Number(value.messagesBefore) || 0,
                messagesAfter: Number(value.messagesAfter) || 0,
                at
            };
        case 'model_route_switched':
            return { type: value.type, turn, route: typeof value.route === 'string' ? boundedString(value.route, 200) : '',
                reason: value.reason === 'busy' || value.reason === 'timeout' || value.reason === 'unavailable' ? value.reason : 'failed', at };
        case 'model_price_changed': {
            const pricingUpdate = normalizeManagedPriceUpdate(value.pricingUpdate);
            if (!pricingUpdate || typeof value.runId !== 'string' || !value.runId.trim()) return undefined;
            return { type: value.type, runId: boundedString(value.runId, 512),
                ...optionalString(value, 'sessionId', 512), pricingUpdate, at };
        }
        case 'model_retry_scheduled':
            return {
                type: value.type,
                turn,
                attempt: Number(value.attempt) || 0,
                delayMs: Number(value.delayMs) || 0,
                reason: boundedString(value.reason, 2_000),
                at
            };
        case 'steering_accepted':
        case 'steering_applied': {
            const message = compactSteeringMessage(value.message, false);
            if (!message) return undefined;
            return {
                type: value.type,
                message,
                ...(value.type === 'steering_applied' ? { turn } : {}),
                at
            };
        }
        default:
            return undefined;
    }
}

function compactRunEvents(value: unknown): readonly unknown[] | undefined {
    if (!Array.isArray(value)) return undefined;
    return value.slice(-500).map(compactRunEvent).filter((event): event is unknown => event !== undefined);
}

function compactCheckpointChanges(value: unknown): readonly unknown[] | undefined {
    if (!Array.isArray(value)) return undefined;
    return value.filter(change => isRecord(change) && typeof change.checkpointId === 'string'
        && typeof change.path === 'string' && ['created', 'modified', 'deleted'].includes(String(change.kind))).map((change, index) => ({
            checkpointId: boundedString(change.checkpointId, 200),
            path: boundedString(change.path, 32_768),
            ...optionalString(change, 'workspaceRoot', 32_768),
            ...optionalString(change, 'externalTarget', 32_768),
            kind: change.kind,
            binary: change.binary === true,
            additions: Number(change.additions) || 0,
            deletions: Number(change.deletions) || 0,
            patch: index < 100 ? boundedString(change.patch, 20_000) : '',
            truncated: index >= 100 || change.truncated === true,
            createdAt: boundedString(change.createdAt, 100),
            ...optionalFiniteNumber(change, 'startLine'),
            ...optionalFiniteNumber(change, 'endLine'),
            ...(index < 100 ? optionalString(change, 'beforeContent', 20_000) : {}),
            ...(index < 100 ? optionalString(change, 'afterContent', 20_000) : {})
        }));
}

function compactWorkspaceVersions(value: unknown): readonly unknown[] | undefined {
    if (!Array.isArray(value)) return undefined;
    return value.filter(item => isRecord(item) && typeof item.checkpointId === 'string' && typeof item.workspaceRoot === 'string')
        .map(item => ({ checkpointId: boundedString(item.checkpointId, 200), workspaceRoot: boundedString(item.workspaceRoot, 32_768),
            ...optionalString(item, 'path', 32_768), ...optionalString(item, 'externalTarget', 32_768) }));
}

function compactTurnFailure(value: unknown): unknown | undefined {
    if (!isRecord(value) || typeof value.code !== 'string' || typeof value.message !== 'string') return undefined;
    return {
        code: boundedString(value.code, 200),
        message: boundedString(value.message, 2_000),
        ...(value.readableError ? { readableError: classifyModelError(value.readableError) } : {}),
        ...optionalString(value, 'kind', 40),
        retryable: value.retryable === true,
        ...optionalBoolean(value, 'retrySafe'),
        resumable: value.resumable === true,
        ...optionalFiniteNumber(value, 'httpStatus'),
        ...optionalFiniteNumber(value, 'retryAfterMs'),
        ...optionalString(value, 'resumeCheckpointId', 200)
    };
}

function compactBrowserRecords(value: unknown): readonly unknown[] | undefined {
    if (!Array.isArray(value)) return undefined;
    return value.filter(browser => isRecord(browser) && typeof browser.id === 'string'
        && typeof browser.url === 'string' && typeof browser.title === 'string').slice(0, 8).map(browser => ({
            id: boundedString(browser.id, 200),
            url: boundedString(browser.url, 32_768),
            title: boundedString(browser.title, 2_000),
            ...optionalString(browser, 'source', 40),
            ...optionalString(browser, 'processId', 200),
            ...optionalFiniteNumber(browser, 'createdAt'),
            ...optionalFiniteNumber(browser, 'updatedAt')
        }));
}

function compactAgentChildScrollStates(value: unknown): unknown | undefined {
    if (!isRecord(value)) return undefined;
    const result: Record<string, unknown> = {};
    for (const [childRunId, candidate] of Object.entries(value).slice(0, 32)) {
        if (!/^[A-Za-z0-9._:-]{1,200}$/.test(childRunId)
            || childRunId === '__proto__' || childRunId === 'constructor' || childRunId === 'prototype'
            || !isRecord(candidate)) continue;
        const finiteNonNegative = (input: unknown): number =>
            typeof input === 'number' && Number.isFinite(input) ? Math.max(0, input) : 0;
        result[childRunId] = {
            top: Math.min(50_000_000, finiteNonNegative(candidate.top)),
            wasAtBottom: candidate.wasAtBottom !== false,
            unseenUpdates: Math.min(99, Math.floor(finiteNonNegative(candidate.unseenUpdates))),
            ...optionalString(candidate, 'contentRevision', 300)
        };
    }
    return Object.keys(result).length ? result : undefined;
}

function compactViewState(value: unknown): unknown | undefined {
    if (!isRecord(value)) return undefined;
    const agentChildScroll = compactAgentChildScrollStates(value.agentChildScroll);
    const contextFileScrollPositions = normalizeContextFileScrollPositions(value.contextFileScrollPositions);
    return {
        workContextOpen: value.workContextOpen === true,
        workContextMode: value.workContextMode === 'file' || value.workContextMode === 'agent'
            ? value.workContextMode : 'browser',
        ...optionalString(value, 'activeBrowserId', 200),
        ...optionalString(value, 'activeAgentChildId', 200),
        ...optionalString(value, 'contextFileUri', 32_768),
        contextFileMaximized: value.contextFileMaximized === true,
        terminalDrawerOpen: value.terminalDrawerOpen === true,
        terminalScope: value.terminalScope === 'all' ? 'all' : 'current',
        ...optionalFiniteNumber(value, 'workContextWidth'),
        ...optionalFiniteNumber(value, 'contextFileListWidth'),
        ...optionalFiniteNumber(value, 'terminalDrawerHeight'),
        ...optionalFiniteNumber(value, 'terminalListWidth'),
        ...optionalBoundedFiniteNumber(value, 'contextFileListScrollTop', 50_000_000),
        ...(Object.keys(contextFileScrollPositions).length ? { contextFileScrollPositions } : {}),
        ...optionalFiniteNumber(value, 'threadScrollTop'),
        ...optionalBoolean(value, 'threadWasAtBottom'),
        ...optionalString(value, 'threadAnchorTurnId', 200),
        ...optionalFiniteNumber(value, 'threadAnchorOffset'),
        ...(agentChildScroll ? { agentChildScroll } : {})
    };
}

function compactAgentTaskContext(value: unknown): unknown | undefined {
    if (!isRecord(value) || value.version !== 1 || typeof value.workspaceRoot !== 'string'
        || typeof value.goal !== 'string' || !Number.isFinite(value.depth)) return undefined;
    const boundedList = (candidate: unknown, maximum: number, itemMaximum: number): readonly string[] =>
        Array.isArray(candidate)
            ? candidate.filter((item): item is string => typeof item === 'string')
                .slice(0, maximum).map(item => boundedString(item, itemMaximum))
            : [];
    const validPermission = value.permissionMode === 'read_only'
        || value.permissionMode === 'workspace_write' || value.permissionMode === 'full_access';
    const selectedMemory: readonly unknown[] = Array.isArray(value.selectedMemory)
        ? value.selectedMemory.filter(item => isRecord(item)
            && typeof item.id === 'string'
            && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,239}$/.test(item.id.trim())
            && ['summary', 'file_ref', 'checkpoint_ref', 'message_ref'].includes(String(item.kind)))
            .slice(0, 16)
            .map(item => {
                const maxCharacters = typeof item.maxCharacters === 'number' && Number.isSafeInteger(item.maxCharacters)
                    ? Math.max(1, Math.min(4_000, item.maxCharacters)) : 2_000;
                const text = typeof item.text === 'string'
                    ? boundedString(item.text, maxCharacters).replace(/[\u0000\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim()
                        .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[redacted]')
                        .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, 'Bearer [redacted]')
                    : '';
                const ref = typeof item.ref === 'string'
                    ? boundedString(item.ref, 2_000).replace(/[\u0000\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim()
                    : '';
                if (!text && !ref) return undefined;
                return {
                    id: item.id.trim().slice(0, 240),
                    kind: item.kind as AgentContextMemoryItem['kind'],
                    ...(text ? { text } : {}),
                    ...(ref ? { ref } : {}),
                    ...(typeof item.sourceRunId === 'string'
                        && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,239}$/.test(item.sourceRunId.trim())
                        ? { sourceRunId: item.sourceRunId.trim().slice(0, 240) } : {}),
                    maxCharacters
                };
            }).filter((item): item is AgentContextMemoryItem => Boolean(item))
        : [];
    return {
        version: 1,
        workspaceRoot: boundedString(value.workspaceRoot, 32_768),
        ...optionalString(value, 'conversationId', 200),
        goal: boundedString(value.goal, 8_000),
        ...optionalString(value, 'parentGoal', 8_000),
        constraints: boundedList(value.constraints, 32, 1_000),
        relevantPaths: boundedList(value.relevantPaths, 128, 32_768),
        recentOperations: boundedList(value.recentOperations, 128, 2_000),
        ...(value.recentOperationsCanonical === true ? { recentOperationsCanonical: true } : {}),
        ...optionalString(value, 'parentRunId', 200),
        ...optionalString(value, 'rootRunId', 200),
        depth: Math.max(0, Math.min(16, Math.floor(Number(value.depth)))),
        permissionMode: validPermission ? value.permissionMode : 'workspace_write',
        allowedToolNames: boundedList(value.allowedToolNames, 128, 500),
        ...optionalString(value, 'modelId', 500),
        ...optionalString(value, 'locale', 40),
        selectedMemory: selectedMemory.slice(0, 16)
    };
}

function compactAgentChildResult(value: unknown): unknown | undefined {
    if (!isRecord(value) || typeof value.runId !== 'string' || typeof value.finalText !== 'string'
        || !['completed', 'limit_reached', 'cancelled', 'paused'].includes(String(value.status))) return undefined;
    const usage = isRecord(value.usage) ? value.usage : {};
    const receipt = compactAgentChildReceipt(value.receipt);
    const tokenBudget = isRecord(value.tokenBudget)
        ? normalizeAgentTokenBudgetSnapshot(value.tokenBudget)
        : undefined;
    const outputParts = compactOutputParts(value.outputParts);
    return {
        runId: boundedString(value.runId, 200),
        status: value.status,
        finalText: boundedString(value.finalText, 20_000),
        ...(normalizeRuntimeFinalMessage(value.finalMessage) ? { finalMessage: normalizeRuntimeFinalMessage(value.finalMessage) } : {}),
        ...(outputParts ? { outputParts } : {}),
        ...optionalString(value, 'outputAssetOwnerId', 300),
        ...(normalizeModelCitations(value.citations).length ? { citations: normalizeModelCitations(value.citations) } : {}),
        usage: {
            inputTokens: Number.isFinite(usage.inputTokens) ? Math.max(0, Number(usage.inputTokens)) : 0,
            outputTokens: Number.isFinite(usage.outputTokens) ? Math.max(0, Number(usage.outputTokens)) : 0
        },
        turns: Number.isFinite(value.turns) ? Math.max(0, Number(value.turns)) : 0,
        toolCalls: Number.isFinite(value.toolCalls) ? Math.max(0, Number(value.toolCalls)) : 0,
        stopReason: typeof value.stopReason === 'string' && value.stopReason.length <= 80
            ? value.stopReason : value.status === 'cancelled' ? 'cancel_requested'
                : value.status === 'paused' ? 'pause_requested'
                    : value.status === 'limit_reached' ? 'turn_limit_reached' : 'completed',
        ...(tokenBudget ? { tokenBudget } : {}),
        ...optionalString(value, 'resumeCheckpointId', 200),
        ...(isRecord(value.checkpointError) && typeof value.checkpointError.code === 'string'
            && typeof value.checkpointError.message === 'string' ? {
                checkpointError: {
                    code: boundedString(value.checkpointError.code, 200),
                    message: boundedString(value.checkpointError.message, 2_000)
                }
            } : {}),
        ...(receipt ? { receipt } : {})
    };
}

function compactAgentChildReceipt(value: unknown): unknown | undefined {
    if (!isRecord(value) || !['completed', 'partial', 'cancelled', 'failed', 'unknown'].includes(String(value.outcome))) return undefined;
    const tokenBudget = isRecord(value.tokenBudget)
        ? normalizeAgentTokenBudgetSnapshot(value.tokenBudget)
        : undefined;
    const failure = isRecord(value.failure) && typeof value.failure.code === 'string' && typeof value.failure.message === 'string'
        ? {
            code: boundedString(value.failure.code, 160),
            message: boundedString(value.failure.message, 2_000)
                .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
                .replace(/\b(?:sk|rk|pk|nmxm|nmxu)[-_][A-Za-z0-9._-]{8,}\b/g, '[redacted]')
                .replace(/[\u0000\r\n]+/g, ' ')
        }
        : undefined;
    return {
        outcome: value.outcome,
        retrySafe: value.retrySafe === true,
        unknownSideEffect: value.unknownSideEffect === true,
        summary: boundedString(value.summary, 300),
        ...(tokenBudget ? { tokenBudget } : {}),
        ...(failure ? { failure } : {})
    };
}

function compactAgentChildSnapshots(value: unknown): readonly unknown[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const statuses = ['running', 'completed', 'limit_reached', 'cancelled', 'paused', 'interrupted', 'model_timeout',
        'rate_limited', 'model_unavailable', 'tool_failed', 'waiting_user', 'error'];
    const candidates = value.filter(child => isRecord(child)
        && typeof child.childRunId === 'string' && typeof child.parentRunId === 'string'
        && typeof child.rootRunId === 'string' && typeof child.task === 'string'
        && statuses.includes(String(child.status))
        && isRecord(child.taskContext)).filter((child, index, all) => {
            const id = boundedString(child.childRunId, 200).trim();
            return Boolean(id) && all.findIndex(other => boundedString(other.childRunId, 200).trim() === id) === index;
        }).slice(0, 32);
    return candidates.map(child => {
        if (!isRecord(child) || typeof child.childRunId !== 'string' || typeof child.parentRunId !== 'string'
            || typeof child.rootRunId !== 'string' || typeof child.task !== 'string'
            || !statuses.includes(String(child.status))) return undefined;
        const taskContext = compactAgentTaskContext(child.taskContext);
        if (!taskContext) return undefined;
        const events = compactRunEvents(child.events) || [];
        const firstEventIndex = typeof child.firstEventIndex === 'number' && Number.isFinite(child.firstEventIndex)
            ? Math.max(0, Math.floor(child.firstEventIndex)) : 0;
        const nextEventIndex = Math.max(firstEventIndex + events.length,
            typeof child.nextEventIndex === 'number' && Number.isFinite(child.nextEventIndex)
                ? Math.max(0, Math.floor(child.nextEventIndex)) : firstEventIndex + events.length);
        const result = compactAgentChildResult(child.result);
        const receipt = compactAgentChildReceipt(child.receipt);
        const tokenBudget = isRecord(child.tokenBudget)
            ? normalizeAgentTokenBudgetSnapshot(child.tokenBudget)
            : undefined;
        const error = compactTurnFailure(child.error);
        return {
            childRunId: boundedString(child.childRunId, 200).trim(),
            parentRunId: boundedString(child.parentRunId, 200).trim(),
            rootRunId: boundedString(child.rootRunId, 200).trim(),
            depth: Number.isFinite(child.depth) ? Math.max(0, Math.min(4, Math.floor(Number(child.depth)))) : 0,
            task: boundedString(child.task, 200_000),
            ...(typeof child.role === 'string' && child.role.trim()
                ? { role: boundedString(child.role.trim(), 64) } : {}),
            ...(typeof child.slotId === 'string' && child.slotId.trim()
                ? { slotId: boundedString(child.slotId.trim(), 120) } : {}),
            ...(Array.isArray(child.acceptanceCriteria)
                ? { acceptanceCriteria: child.acceptanceCriteria.filter((item): item is string => typeof item === 'string').slice(0, 12).map(item => boundedString(item, 600)) } : {}),
            ...((source => source ? { routeSource: source } : {})(normalizeCouncilRouteSource(child.routeSource))),
            ...(typeof child.invocationKey === 'string' && child.invocationKey.trim()
                ? { invocationKey: boundedString(child.invocationKey.trim(), 128) } : {}),
            status: child.status,
            events,
            firstEventIndex,
            nextEventIndex,
            startedAt: Number.isFinite(child.startedAt) ? Number(child.startedAt) : 0,
            updatedAt: Number.isFinite(child.updatedAt) ? Number(child.updatedAt) : 0,
            ...optionalFiniteNumber(child, 'finishedAt'),
            ...optionalString(child, 'resumeCheckpointId', 200),
            taskContext,
            ...(result ? { result } : {}),
            ...(receipt ? { receipt } : {}),
            ...(tokenBudget ? { tokenBudget } : {}),
            ...(error ? { error } : {}),
            ...(isRecord(child.checkpointError) && typeof child.checkpointError.code === 'string'
                && typeof child.checkpointError.message === 'string' ? {
                    checkpointError: {
                        code: boundedString(child.checkpointError.code, 200),
                        message: boundedString(child.checkpointError.message, 2_000)
                    }
                } : {})
        };
    }).filter(child => child !== undefined);
}

function compactUserFollowUpQueue(value: unknown): readonly unknown[] | undefined {
    if (!Array.isArray(value)) return undefined;
    return value.filter(item => isRecord(item)
        && typeof item.prompt === 'string'
        // Records created before the source field existed are user messages; tool/runtime activities never come back
        // as queued prompts, and a tagged user message is kept whatever its text (isUserFollowUpRecord).
        && isUserFollowUpRecord({ prompt: item.prompt, source: typeof item.source === 'string' ? item.source : undefined })).map(item => ({
            id: boundedString(item.id, 200),
            sessionId: boundedString(item.sessionId, 200),
            prompt: boundedString(item.prompt, 200_000),
            source: item.source === 'user' ? 'user' : undefined,
            workbench: item.workbench === 'comic' ? 'comic' : 'coding',
            routeId: boundedString(item.routeId, 500),
            ...(['off', 'user', 'auto_best'].includes(String(item.automaticRelaySource)) ? { automaticRelaySource: item.automaticRelaySource } : {}),
            ...(optionalKeyPriceQuoteId(item.keyPriceQuoteId) ? { keyPriceQuoteId: item.keyPriceQuoteId } : {}),
            relayKey: boundedString(item.relayKey, 500),
            modelLabel: boundedString(item.modelLabel, 500),
            ...optionalString(item, 'reasoningEffort', 40),
            ...(item.reasoningSettings ? { reasoningSettings: normalizeReasoningSettings(item.reasoningSettings) } : {}),
            ...optionalFiniteNumber(item, 'contextWindowTokens'),
            ...optionalString(item, 'permissionMode', 40),
            attachments: compactAttachmentReferences(item.attachments, true)
                || [],
            ...optionalString(item, 'pastedTextReferences', 40_000),
            ...optionalFiniteNumber(item, 'createdAt'),
            ...(normalizeQueuedTaskDispatch(item.dispatch) ? { dispatch: normalizeQueuedTaskDispatch(item.dispatch) } : {}),
            ...optionalString(item, 'error', 500)
        }));
}

function compactTurn(value: unknown, limits: ConversationHistoryMirrorLimits): unknown | undefined {
    if (!isRecord(value) || typeof value.id !== 'string') return undefined;
    const failure = compactTurnFailure(value.failure);
    const attachments = compactAttachmentReferences(value.attachments, false);
    const changes = compactCheckpointChanges(value.changes);
    const events = compactRunEvents(value.events);
    const childAgents = compactAgentChildSnapshots(value.childAgents);
    const steeringMessages = Array.isArray(value.steeringMessages)
        ? value.steeringMessages.slice(-10).map(message => compactSteeringMessage(message, true))
            .filter((message): message is unknown => message !== undefined)
        : undefined;
    const outputParts = value.branchUserOnly === true ? undefined : compactOutputParts(value.outputParts);
    const relayRequestIds = normalizeRelayFeedbackRequestIds(value.relayRequestIds, value.relayRequestId);
    return {
        id: boundedString(value.id, 200),
        ...optionalString(value, 'userMessageId', 240),
        ...optionalString(value, 'assistantMessageId', 240),
        prompt: boundedString(value.prompt, limits.promptCharacters),
        ...(value.goalPresentationOrigin !== undefined
            ? { goalPresentationOrigin: value.goalPresentationOrigin === 'automatic-v1' ? 'automatic-v1' : 'user' } : {}),
        ...optionalString(value, 'modelPrompt', 200_000),
        ...optionalString(value, 'pastedTextReferences', 40_000),
        ...optionalBoolean(value, 'branchUserOnly'),
        response: boundedString(value.response, limits.responseCharacters),
        ...(outputParts ? { outputParts, ...optionalString(value, 'outputAssetOwnerId', 300) } : {}),
        ...(value.branchUserOnly !== true && normalizeModelCitations(value.citations).length
            ? { citations: normalizeModelCitations(value.citations) } : {}),
        ...(value.branchUserOnly !== true && normalizeArchivedChildResults(value.archivedChildResults).length
            ? { archivedChildResults: normalizeArchivedChildResults(value.archivedChildResults) } : {}),
        error: boundedString(value.error, limits.errorCharacters),
        ...(failure ? { failure } : {}),
        ...optionalString(value, 'stage', 40),
        ...optionalFiniteNumber(value, 'createdAt'),
        ...optionalFiniteNumber(value, 'completedAt'),
        ...optionalString(value, 'permissionMode', 40),
        ...(value.reasoningSettings ? { reasoningSettings: normalizeReasoningSettings(value.reasoningSettings) } : {}),
        ...optionalString(value, 'routeLabel', 500),
        ...(['off', 'user', 'auto_best'].includes(String(value.automaticRelaySource)) ? { automaticRelaySource: value.automaticRelaySource } : {}),
        ...optionalString(value, 'routeId', 500),
        ...(optionalKeyPriceQuoteId(value.keyPriceQuoteId) ? { keyPriceQuoteId: value.keyPriceQuoteId } : {}),
        ...optionalString(value, 'executionLabel', 2_000),
        ...(Number.isSafeInteger(value.importedToolCalls) && Number(value.importedToolCalls) >= 0 ? { importedToolCalls: value.importedToolCalls } : {}),
        ...optionalString(value, 'usageLabel', 2_000),
        ...optionalString(value, 'billingLabel', 2_000),
        ...optionalFiniteNumber(value, 'failoverCount'),
        ...(relayRequestIds.length ? {
            relayRequestId: relayRequestIds.at(-1),
            relayRequestIds
        } : {}),
        ...(['up', 'down'].includes(String(value.relayFeedback)) ? { relayFeedback: value.relayFeedback } : {}),
        ...optionalString(value, 'resumeCheckpointId', 200),
        ...optionalString(value, 'stopReason', 80),
        ...(!value.branchUserOnly && normalizeRuntimeFinalMessage(value.finalMessage) ? { finalMessage: normalizeRuntimeFinalMessage(value.finalMessage) } : {}),
        ...optionalFiniteNumber(value, 'autoResumeAttempts'),
        ...(attachments ? { attachments } : {}),
        ...(changes ? { changes } : {}),
        ...(!value.branchUserOnly && compactWorkspaceVersions(value.workspaceBaselines) ? { workspaceBaselines: compactWorkspaceVersions(value.workspaceBaselines) } : {}),
        ...(!value.branchUserOnly && compactWorkspaceVersions(value.fileVersionReceipts) ? { fileVersionReceipts: compactWorkspaceVersions(value.fileVersionReceipts) } : {}),
        ...(!value.branchUserOnly && Array.isArray(value.restoredCheckpointIds) ? { restoredCheckpointIds: value.restoredCheckpointIds
            .filter((id): id is string => typeof id === 'string' && id.length <= 200) } : {}),
        ...(Array.isArray(value.checkpointWarnings) ? { checkpointWarnings: value.checkpointWarnings
            .filter((warning): warning is string => typeof warning === 'string').slice(0, 100).map(warning => warning.slice(0, 2000)) } : {}),
        ...(value.branchUserOnly !== true && normalizeAgentRunVerification(value.verification)
            ? { verification: normalizeAgentRunVerification(value.verification) } : {}),
        ...(events ? { events } : {}),
        ...(childAgents ? { childAgents } : {}),
        ...(steeringMessages ? { steeringMessages } : {})
    };
}

function compactSession(value: unknown, limits: ConversationHistoryMirrorLimits): unknown | undefined {
    if (!isRecord(value) || typeof value.id !== 'string' || !Array.isArray(value.turns)) return undefined;
    const viewState = compactViewState(value.viewState);
    const browsers = compactBrowserRecords(value.browsers);
    const followUpQueue = compactUserFollowUpQueue(value.followUpQueue);
    const draftAttachments = compactAttachmentReferences(value.draftAttachments, true);
    const childDrafts = normalizeAgentChildDrafts(value.agentChildDrafts, value.turns);
    const draftTurnIds = new Set(childDrafts.map(draft => draft.turnId));
    const recentTurns = new Set(value.turns.slice(-Math.max(0, limits.turnsPerSession)));
    // Keep the (at most 32) draft owners in the startup mirror, even outside the recent-turn window.
    const turns = value.turns.filter(turn => recentTurns.has(turn) || isRecord(turn) && draftTurnIds.has(String(turn.id)))
        .map(turn => compactTurn(turn, limits)).filter((turn): turn is unknown => turn !== undefined);
    return {
        id: boundedString(value.id, 200),
        workspacePath: boundedString(value.workspacePath, 32_768),
        ...optionalBoolean(value, 'ownedWorkspace'),
        ...optionalString(value, 'sourceConversationId', 200),
        ...optionalString(value, 'sourceMessageId', 200),
        title: boundedString(value.title, 2_000),
        ...(value.titleOrigin === 'default' || value.titleOrigin === 'draft' || value.titleOrigin === 'recoveredDraft' ? { titleOrigin: value.titleOrigin } : {}),
        turns,
        ...(browsers ? { browsers } : {}),
        ...optionalBoolean(value, 'pinned'),
        ...optionalString(value, 'routeId', 500),
        ...optionalString(value, 'relayKey', 500),
        ...(['off', 'user', 'auto_best'].includes(String(value.automaticRelaySource)) ? { automaticRelaySource: value.automaticRelaySource } : {}),
        ...(optionalKeyPriceQuoteId(value.keyPriceQuoteId) ? { keyPriceQuoteId: value.keyPriceQuoteId } : {}),
        ...optionalString(value, 'modelId', 500),
        ...optionalString(value, 'reasoningEffort', 40),
        ...optionalFiniteNumber(value, 'contextWindowTokens'),
        ...optionalString(value, 'permissionMode', 40),
        ...(value.reasoningSettings ? { reasoningSettings: normalizeReasoningSettings(value.reasoningSettings) } : {}),
        ...(isRecord(value.councilConfig) ? { councilConfig: value.councilConfig } : {}),
        ...(isRecord(value.pendingCouncilConfig) ? { pendingCouncilConfig: value.pendingCouncilConfig } : {}),
        ...(viewState ? { viewState } : {}),
        ...optionalFiniteNumber(value, 'viewStateUpdatedAt'),
        ...(followUpQueue ? { followUpQueue } : {}),
        ...optionalString(value, 'draftPrompt', 200_000),
        ...(value.agentChildDrafts !== undefined || value.agentChildDraftsUpdatedAt !== undefined ? {
            agentChildDrafts: normalizeAgentChildDrafts(childDrafts, turns),
            agentChildDraftsUpdatedAt: agentChildDraftClock(value.agentChildDraftsUpdatedAt)
        } : {}),
        ...optionalString(value, 'draftPastedTextReferences', 40_000),
        ...(draftAttachments ? { draftAttachments } : {}),
        ...optionalFiniteNumber(value, 'createdAt'),
        ...optionalFiniteNumber(value, 'updatedAt'),
        ...optionalHistoryRevision(value)
    };
}

export function readConversationHistoryMirror(raw: string | null): ConversationHistoryMirrorReadResult {
    if (!raw) return { sessions: [], legacy: false, complete: false };
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { sessions: [], legacy: false, complete: false };
    }
    if (Array.isArray(parsed)) {
        return {
            sessions: parsed.map(session => compactSession(session, HISTORY_READ_LIMITS))
                .filter((session): session is unknown => session !== undefined),
            legacy: true,
            complete: true
        };
    }
    if (!isRecord(parsed) || parsed.version !== CONVERSATION_HISTORY_MIRROR_VERSION
        || parsed.complete !== false || !Array.isArray(parsed.sessions)) {
        return { sessions: [], legacy: false, complete: false };
    }
    return {
        sessions: parsed.sessions.map(session => compactSession(session, HISTORY_READ_LIMITS))
            .filter((session): session is unknown => session !== undefined),
        legacy: false,
        complete: false
    };
}

export function createConversationHistoryMirror<TTurn extends ConversationHistoryTurnLike, TSession extends ConversationHistorySessionLike<TTurn>>(
    sessions: readonly TSession[],
    limits: ConversationHistoryMirrorLimits = DEFAULT_MIRROR_LIMITS
): {
    readonly version: typeof CONVERSATION_HISTORY_MIRROR_VERSION;
    readonly complete: false;
    readonly sessions: readonly unknown[];
} {
    const compact = sessions.filter(session => (session as unknown as { incognito?: boolean }).incognito !== true).slice(0, Math.max(0, limits.sessions)).map(session => compactSession(session, limits))
        .filter((session): session is unknown => session !== undefined);
    return {
        version: CONVERSATION_HISTORY_MIRROR_VERSION,
        complete: false,
        sessions: compact
    };
}

function sameStartupValue(left: unknown, right: unknown): boolean {
    return Object.is(left, right) || JSON.stringify(left) === JSON.stringify(right);
}

/** A compact mirror is not a replacement body. Apply only fields actually edited since it was read. */
function mergeStartupTurn<TTurn extends ConversationHistoryTurnLike>(
    current: TTurn, initial: ConversationHistoryTurnLike, durable: TTurn
): TTurn {
    const now = current as unknown as Record<string, unknown>;
    const before = initial as unknown as Record<string, unknown>;
    const saved = durable as unknown as Record<string, unknown>;
    let changed: Record<string, unknown> | undefined;
    for (const key of new Set([...Object.keys(before), ...Object.keys(now)])) {
        if (['id', '__proto__', 'constructor', 'prototype'].includes(key)) continue;
        const present = Object.hasOwn(now, key);
        if (present === Object.hasOwn(before, key) && sameStartupValue(now[key], before[key])) continue;
        if (present === Object.hasOwn(saved, key) && sameStartupValue(now[key], saved[key])) continue;
        changed ||= { ...saved };
        if (present) changed[key] = now[key];
        else delete changed[key];
    }
    return changed ? changed as unknown as TTurn : durable;
}

function mergeTurns<TTurn extends ConversationHistoryTurnLike>(
    current: readonly TTurn[],
    durable: readonly TTurn[],
    initial?: readonly ConversationHistoryTurnLike[]
): readonly TTurn[] {
    const currentById = new Map(current.map(turn => [turn.id, turn]));
    const initialById = initial && new Map(initial.map(turn => [turn.id, turn]));
    const durableIds = new Set(durable.map(turn => turn.id));
    const merged = durable.map(turn => {
        const renderer = currentById.get(turn.id);
        if (!renderer) return turn;
        if (!initialById) return renderer;
        const baseline = initialById.get(turn.id);
        return baseline ? mergeStartupTurn(renderer, baseline, turn) : turn;
    });
    const additions = current.filter(turn => !durableIds.has(turn.id));
    return [...merged, ...additions].sort((left, right) =>
        (Number(left.createdAt) || 0) - (Number(right.createdAt) || 0));
}

function startupSessionChanged<TSession extends ConversationHistorySessionLike>(
    current: TSession, initial: ConversationHistorySessionLike
): boolean {
    const keys = new Set([...Object.keys(initial as object), ...Object.keys(current as object)]);
    keys.delete('turns');
    return [...keys].some(key => !sameStartupValue(
        (current as unknown as Record<string, unknown>)[key],
        (initial as unknown as Record<string, unknown>)[key]
    ));
}

function startupTurnsChanged<TTurn extends ConversationHistoryTurnLike>(
    current: readonly TTurn[], initial: readonly ConversationHistoryTurnLike[]
): boolean {
    const initialById = new Map(initial.map(turn => [turn.id, turn]));
    return current.some(turn => !sameStartupValue(turn, initialById.get(turn.id)));
}

function sessionFingerprint(session: ConversationHistorySessionLike): string {
    const last = session.turns.at(-1);
    return `${session.id}:${session.updatedAt}:${historyRevision(session.historyRevision)}:${session.viewStateUpdatedAt || 0}:${agentChildDraftClock(session.agentChildDraftsUpdatedAt)}:${session.turns.length}:${last?.id || ''}`;
}

function mergeRendererViewState<
    TTurn extends ConversationHistoryTurnLike,
    TSession extends ConversationHistorySessionLike<TTurn>
>(base: TSession, current: TSession, durable: TSession): TSession {
    const currentUpdatedAt = Number.isFinite(current.viewStateUpdatedAt) ? Math.max(0, Number(current.viewStateUpdatedAt)) : 0;
    const durableUpdatedAt = Number.isFinite(durable.viewStateUpdatedAt) ? Math.max(0, Number(durable.viewStateUpdatedAt)) : 0;
    const renderer = currentUpdatedAt > durableUpdatedAt ? current
        : durableUpdatedAt > currentUpdatedAt ? durable
            : base;
    const viewStateUpdatedAt = Math.max(currentUpdatedAt, durableUpdatedAt);
    const currentDraftClock = agentChildDraftClock(current.agentChildDraftsUpdatedAt);
    const durableDraftClock = agentChildDraftClock(durable.agentChildDraftsUpdatedAt);
    // Preserve the acknowledged object when recovery contributes no newer
    // state. Otherwise an unrelated new draft would rewrite every mirror row.
    if (base === durable && currentUpdatedAt <= durableUpdatedAt && currentDraftClock <= durableDraftClock) return durable;
    const draftOwner = currentDraftClock > durableDraftClock ? current : durableDraftClock > currentDraftClock ? durable : base;
    const draftClock = Math.max(currentDraftClock, durableDraftClock);
    return {
        ...base,
        viewState: renderer.viewState,
        ...(draftClock > 0 || draftOwner.agentChildDrafts !== undefined ? {
            agentChildDrafts: normalizeAgentChildDrafts(draftOwner.agentChildDrafts, base.turns),
            agentChildDraftsUpdatedAt: draftClock
        } : {}),
        ...(viewStateUpdatedAt > 0 ? { viewStateUpdatedAt } : {})
    };
}

export function mergeConversationHistorySessions<
    TTurn extends ConversationHistoryTurnLike,
    TSession extends ConversationHistorySessionLike<TTurn>
>(
    current: readonly TSession[],
    durable: readonly TSession[],
    options: ConversationHistoryMergeOptions
): ConversationHistoryMergeResult<TSession> {
    const currentById = new Map(current.map(session => [session.id, session]));
    const durableById = new Map(durable.map(session => [session.id, session]));
    const incompleteInitialById = options.initialSnapshot?.complete === false
        ? new Map(options.initialSnapshot.sessions.map(session => [session.id, session])) : undefined;
    const merged: TSession[] = [];
    let startupFieldsChanged = false;

    for (const durableSession of durable) {
        const currentSession = currentById.get(durableSession.id);
        if (!currentSession) {
            if (options.mutatedDuringLoad && options.initialSessionIds.has(durableSession.id)) continue;
            merged.push(durableSession);
            continue;
        }
        const currentHistoryRevision = historyRevision(currentSession.historyRevision);
        const durableHistoryRevision = historyRevision(durableSession.historyRevision);
        if (currentHistoryRevision !== durableHistoryRevision) {
            const winner = currentHistoryRevision > durableHistoryRevision ? currentSession : durableSession;
            merged.push(mergeRendererViewState(winner, currentSession, durableSession));
            continue;
        }
        const initial = incompleteInitialById?.get(currentSession.id);
        if (initial && historyRevision(initial.historyRevision) === currentHistoryRevision) {
            const turns = mergeTurns(currentSession.turns, durableSession.turns, initial.turns);
            // The startup mirror can contain only the newest turns. Compare
            // with that renderer baseline so a durable full body is restored
            // even when the merged entries are the same durable references.
            const turnsChanged = turns.length !== currentSession.turns.length
                || turns.some((turn, index) => turn !== currentSession.turns[index]);
            // A compact mirror can legitimately differ from the durable body
            // without any user mutation. Only mark the session dirty when a
            // top-level field or turn was edited after the mirror was read.
            const startupChanged = startupSessionChanged(currentSession, initial)
                || startupTurnsChanged(currentSession.turns, initial.turns);
            startupFieldsChanged ||= startupChanged;
            // `turnsChanged` is also true when a compact startup mirror is
            // replaced by its full durable body. In that case the durable
            // object is already the acknowledged persistence baseline; keep
            // its identity so a recovery read does not create a spurious
            // upsert (or rewrite a session that the user never edited).
            if (!startupChanged) {
                merged.push(mergeRendererViewState(durableSession, currentSession, durableSession));
                continue;
            }
            const base = currentSession.updatedAt > durableSession.updatedAt
                ? { ...durableSession, ...currentSession } : durableSession;
            merged.push(mergeRendererViewState(turnsChanged ? { ...base, turns } : base, currentSession, durableSession));
            continue;
        }
        if (currentSession.updatedAt <= durableSession.updatedAt) {
            merged.push(mergeRendererViewState(durableSession, currentSession, durableSession));
            continue;
        }
        merged.push(mergeRendererViewState({
            ...durableSession,
            ...currentSession,
            turns: mergeTurns(currentSession.turns, durableSession.turns)
        }, currentSession, durableSession));
    }
    for (const currentSession of current) {
        if (!durableById.has(currentSession.id)) merged.push(currentSession);
    }

    merged.sort((left, right) => right.updatedAt - left.updatedAt);
    const durableFingerprint = durable.map(sessionFingerprint).sort().join('|');
    const mergedFingerprint = merged.map(sessionFingerprint).sort().join('|');
    return {
        sessions: merged,
        changedFromDurable: startupFieldsChanged || durableFingerprint !== mergedFingerprint
    };
}
