import type { AgentRunEvent } from '@nextmux/agent-runtime';

/** A receipt identifies a visible event, never a sidebar selection or message chunk. */
export interface ConversationReadReceipt {
    readonly sessionId: string;
    readonly noticeId: string;
    readonly noticedAt: number;
    /** Acknowledgement time for this exact notice. Different notices never use it as event order. */
    readonly readAt?: number;
}

export interface ConversationAttention extends ConversationReadReceipt {
    readonly kind: 'complete' | 'error' | 'paused' | 'question' | 'permission' | 'cancelled';
    readonly expiresAt?: number;
}

export function validConversationReceipt(value: unknown): value is ConversationReadReceipt {
    if (!value || typeof value !== 'object') return false;
    const item = value as ConversationReadReceipt;
    return typeof item.sessionId === 'string' && /^[A-Za-z0-9._:-]{1,300}$/.test(item.sessionId)
        && typeof item.noticeId === 'string' && item.noticeId.length > 0 && item.noticeId.length <= 1_500
        && !/[\r\n\0]/.test(item.noticeId) && Number.isSafeInteger(item.noticedAt) && item.noticedAt >= 0
        && (item.readAt === undefined || Number.isSafeInteger(item.readAt) && item.readAt >= 0);
}

export interface AttentionTurn {
    readonly id: string;
    readonly stage: string;
    readonly createdAt: number;
    readonly completedAt?: number;
    readonly branchUserOnly?: boolean;
    readonly events?: readonly AgentRunEvent[];
    readonly attention?: ConversationAttention;
}

/**
 * Date.now() has millisecond precision. Keep terminal notice timestamps
 * strictly ordered without changing the persisted turn shape or relying on a
 * random UUID as a chronology signal.
 */
export function monotonicConversationCompletionAt(
    requestedAt: number,
    persistedHighWater: number,
    previousHighWater: number
): number {
    const requested = Number.isSafeInteger(requestedAt) && requestedAt >= 0 ? requestedAt : Date.now();
    const persisted = Number.isSafeInteger(persistedHighWater) && persistedHighWater >= 0 ? persistedHighWater : 0;
    const previous = Number.isSafeInteger(previousHighWater) && previousHighWater >= 0 ? previousHighWater : 0;
    return Math.max(requested, persisted + 1, previous + 1);
}

export function conversationAttention(sessionId: string, turn: AttentionTurn | undefined, now = Date.now()): ConversationAttention | undefined {
    if (!turn || turn.branchUserOnly) return undefined;
    if (turn.stage !== 'running') {
        if (!['complete', 'error', 'paused', 'cancelled'].includes(turn.stage)) return undefined;
        return { sessionId, noticeId: `${turn.id}:${turn.stage}:${turn.completedAt || turn.createdAt}`,
            noticedAt: turn.completedAt || turn.createdAt, kind: turn.stage as ConversationAttention['kind'] };
    }
    if (!turn.events && turn.attention && (turn.attention.kind === 'question' || turn.attention.kind === 'permission')
        && (turn.attention.expiresAt || 0) > now) return { ...turn.attention, sessionId };
    const resolved = new Set<string>();
    // Only the current turn is inspected; no history reads or periodic scans.
    for (let index = (turn.events?.length || 0) - 1; index >= 0; index--) {
        const event = turn.events![index];
        if (event.type === 'user_input_resolved') resolved.add(event.questionId);
        if (event.type === 'user_input_requested' && !resolved.has(event.question.questionId)
            && Date.parse(event.question.expiresAt) > now) {
            const permission = (event.question as { kind?: string }).kind === 'permission';
            return { sessionId, noticeId: `question:${event.question.runId}:${event.question.questionId}`,
                noticedAt: Date.parse(event.question.createdAt), expiresAt: Date.parse(event.question.expiresAt), kind: permission ? 'permission' : 'question' };
        }
    }
    return undefined;
}
