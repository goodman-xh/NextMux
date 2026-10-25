import type { AgentRunEvent } from '@nextmux/agent-runtime';
import type { DesktopAgentRunHistoryDetail, DesktopAgentRunHistoryPage, DesktopAgentRunHistoryRecord } from '../common/nextmux-platform-protocol';

/** A read-only projection of existing conversation data; no second history store. */
function historyTurns(session: Record<string, unknown> | undefined, conversationId: string): Record<string, unknown>[] {
    if (!session || session.id !== conversationId || !Array.isArray(session.turns)) return [];
    return session.turns.filter((turn): turn is Record<string, unknown> => Boolean(turn) && typeof turn === 'object'
        && !Array.isArray(turn) && typeof turn.id === 'string' && Number.isFinite(turn.createdAt) && !turn.branchUserOnly);
}

function record(turn: Record<string, unknown>, conversationId: string): DesktopAgentRunHistoryRecord {
    // A turn ID remains stable across automatic continuations. Scope it by its
    // conversation so inherited branch messages cannot select another branch.
    const status = turn.stage === 'complete' ? 'completed'
        : turn.stage === 'running' ? 'interrupted'
            : turn.stage === 'paused' ? 'paused'
                : turn.stage === 'cancelled' ? 'cancelled' : 'error';
    return {
        runId: turn.id as string, conversationId, status, workbench: 'coding',
        startedAt: turn.createdAt as number,
        updatedAt: typeof turn.completedAt === 'number' ? turn.completedAt : turn.createdAt as number,
        ...(typeof turn.completedAt === 'number' ? { finishedAt: turn.completedAt } : {}),
        ...(typeof turn.error === 'string' && turn.error ? { error: { code: 'RUN_ERROR', message: turn.error } } : {})
    };
}

export function conversationRunHistoryPage(session: Record<string, unknown> | undefined, conversationId: string,
    cursor?: string, limit = 20): DesktopAgentRunHistoryPage {
    const turns = historyTurns(session, conversationId).reverse();
    const previous = cursor ? turns.findIndex(turn => turn.id === cursor) : -1;
    if (cursor && previous < 0) return { runs: [] };
    const offset = previous + 1;
    const page = turns.slice(offset, offset + Math.max(1, Math.min(100, Math.trunc(limit) || 20)));
    return { runs: page.map(turn => record(turn, conversationId)),
        ...(offset + page.length < turns.length ? { nextCursor: page.at(-1)!.id as string } : {}) };
}

export function conversationRunHistoryDetail(session: Record<string, unknown> | undefined, conversationId: string,
    turnId: string): DesktopAgentRunHistoryDetail | undefined {
    const turn = historyTurns(session, conversationId).find(turn => turn.id === turnId);
    if (!turn) return undefined;
    return { ...record(turn, conversationId), events: Array.isArray(turn.events) ? turn.events as AgentRunEvent[] : [] };
}
