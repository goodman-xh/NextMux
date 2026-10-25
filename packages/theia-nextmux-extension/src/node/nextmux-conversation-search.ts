import { canonicalRuntimeFinal, legacyRuntimeFinalMessage, normalizeRuntimeFinalMessage } from '@nextmux/agent-runtime/semantic-messages';
import type {
    DesktopConversationIndexMessage,
    DesktopConversationIndexRecord,
    DesktopConversationSearchRequest,
    DesktopConversationSearchResult
} from '../common/nextmux-platform-protocol';

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function text(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

// Limits are UTF-16 code units. Clip before trimming, joining or case folding.
// Separate budgets keep a large tool log from displacing assistant prose.
export const CONVERSATION_ACTIVITY_TEXT_LIMIT = 20 * 1024 + 2;
export const CONVERSATION_ACTIVITY_ENTRY_LIMIT = 2048;

function activityText(turn: Record<string, unknown>): string {
    const response = text(turn.response).slice(0, CONVERSATION_ACTIVITY_TEXT_LIMIT);
    const bucket = (limit: number) => {
        const blocks: string[] = [];
        let remaining = limit;
        let previousKey: string | undefined;
        return {
            add(value: unknown, key?: string): void {
                if (typeof value !== 'string' || !value || remaining <= 0) return;
                const continuation = key !== undefined && key === previousKey && blocks.length > 0;
                const separator = !continuation && blocks.length > 0 ? 1 : 0;
                const clipped = value.slice(0, Math.max(0, remaining - separator));
                remaining -= clipped.length + separator;
                if (continuation) blocks[blocks.length - 1] += clipped;
                else blocks.push(clipped);
                previousKey = key;
            },
            finish(): string {
                const seen = new Set<string>();
                return blocks.map(block => block.trim()).filter(block => {
                    if (!block || response.includes(block) || seen.has(block)) return false;
                    seen.add(block);
                    return true;
                }).join('\n');
            }
        };
    };
    const parts = bucket(8 * 1024), assistant = bucket(8 * 1024), tools = bucket(4 * 1024);
    if (Array.isArray(turn.outputParts)) {
        for (let i = 0; i < Math.min(turn.outputParts.length, CONVERSATION_ACTIVITY_ENTRY_LIMIT); i++) {
            const part = turn.outputParts[i];
            if (isRecord(part) && part.type === 'text') parts.add(part.text);
        }
    }
    if (Array.isArray(turn.events)) {
        for (let i = 0; i < Math.min(turn.events.length, CONVERSATION_ACTIVITY_ENTRY_LIMIT); i++) {
            const event = turn.events[i];
            if (!isRecord(event)) continue;
            switch (event.type) {
                // Concatenate chunks without introducing spaces inside streamed words.
                case 'assistant_delta': assistant.add(event.delta, `delta:${typeof event.turn === 'number' ? event.turn : ''}`); break;
                case 'assistant_progress': assistant.add(event.content); break;
                case 'tool_output': tools.add(event.chunk, `tool:${text(event.callId).slice(0, 160)}:${text(event.stream).slice(0, 16)}`); break;
                case 'tool_completed':
                    if (isRecord(event.summary)) {
                        tools.add(event.summary.title);
                        if (Array.isArray(event.summary.details)) {
                            for (let j = 0; j < Math.min(event.summary.details.length, 32); j++) tools.add(event.summary.details[j]);
                        }
                    }
                    break;
            }
        }
    }
    const extra: string[] = [];
    for (const value of [parts.finish(), assistant.finish(), tools.finish()]) {
        if (value && !extra.some(existing => existing.includes(value))) extra.push(value);
    }
    return extra.join('\n');
}

/** Shared by the in-memory matcher and SQLite candidate index, including legacy records. */
export function conversationMessageSearchTexts(message: DesktopConversationIndexMessage): readonly string[] {
    return [message.prompt, message.response, message.error,
        text(message.activityText).slice(0, CONVERSATION_ACTIVITY_TEXT_LIMIT)];
}

function timestamp(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function compactSnippet(value: string, terms: readonly string[] = []): string {
    const compact = value.replace(/\s+/g, ' ').trim();
    const normalized = compact.toLocaleLowerCase();
    const positions = terms.map(term => normalized.indexOf(term)).filter(position => position >= 0);
    const start = positions.length ? Math.max(0, Math.min(...positions) - 48) : 0;
    const prefix = start > 0 ? '…' : '';
    const available = 160 - prefix.length;
    const truncated = start + available < compact.length;
    return prefix + compact.slice(start, start + available - (truncated ? 1 : 0)) + (truncated ? '…' : '');
}

function indexedFailure(value: unknown): DesktopConversationIndexMessage['failure'] {
    if (!isRecord(value) || typeof value.code !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(value.code)) return undefined;
    const kinds = ['model_timeout', 'rate_limited', 'model_unavailable', 'model_auth', 'tool_failed', 'waiting_user', 'failed'];
    return { code: value.code, kind: kinds.includes(String(value.kind)) ? value.kind as NonNullable<DesktopConversationIndexMessage['failure']>['kind'] : 'failed' };
}

/** Project system state only at the model boundary; UI search retains the original stored text. */
export function conversationMessageModelProjection(message: DesktopConversationIndexMessage): {
    readonly response: string; readonly error: string; readonly errorCode?: string; readonly stopReason?: string;
} {
    const finalMessage = normalizeRuntimeFinalMessage(message.finalMessage)
        ?? legacyRuntimeFinalMessage(message.response, message.stopReason);
    const stopReason = normalizeRuntimeFinalMessage({ origin: 'runtime', stopReason: message.stopReason })?.stopReason;
    const failure = indexedFailure(message.failure);
    return {
        response: finalMessage ? canonicalRuntimeFinal(finalMessage) : message.response,
        // `error` is persisted presentation text; never replay it as a model diagnostic.
        error: failure ? `Task failed (${failure.code}).` : message.error ? 'Task failed.' : '',
        ...(failure ? { errorCode: failure.code } : {}),
        ...(stopReason ? { stopReason } : {})
    };
}

/** Convert the durable records without session/message count truncation. */
export function conversationHistorySearchRecords(sessions: readonly unknown[]): readonly DesktopConversationIndexRecord[] {
    const records: DesktopConversationIndexRecord[] = [];
    for (const session of sessions) {
        if (!isRecord(session) || !text(session.id) || !Array.isArray(session.turns)) continue;
        const messages: DesktopConversationIndexMessage[] = [];
        for (const candidate of session.turns) {
            if (!isRecord(candidate) || !text(candidate.id)) continue;
            const turnId = text(candidate.id);
            const createdAt = timestamp(candidate.createdAt);
            const finalMessage = normalizeRuntimeFinalMessage(candidate.finalMessage);
            const stopReason = normalizeRuntimeFinalMessage({ origin: 'runtime', stopReason: candidate.stopReason })?.stopReason;
            const failure = indexedFailure(candidate.failure);
            const activity = candidate.branchUserOnly === true ? '' : activityText(candidate);
            messages.push({
                id: text(candidate.userMessageId) || `${turnId}:user`,
                turnId,
                prompt: text(candidate.prompt),
                response: '',
                error: '',
                createdAt,
                ...(timestamp(candidate.completedAt, -1) >= 0 ? { completedAt: timestamp(candidate.completedAt) } : {})
            });
            if (candidate.branchUserOnly !== true) messages.push({
                id: text(candidate.assistantMessageId) || `${turnId}:assistant`,
                turnId,
                prompt: '',
                response: text(candidate.response),
                ...(activity ? { activityText: activity } : {}),
                error: text(candidate.error),
                ...(finalMessage ? { finalMessage } : {}),
                ...(stopReason ? { stopReason } : {}),
                ...(failure ? { failure } : {}),
                createdAt,
                ...(timestamp(candidate.completedAt, -1) >= 0 ? { completedAt: timestamp(candidate.completedAt) } : {})
            });
            if (!Array.isArray(candidate.steeringMessages)) continue;
            for (const steering of candidate.steeringMessages) {
                if (!isRecord(steering) || !text(steering.id)) continue;
                const steeringCreatedAt = Date.parse(text(steering.createdAt));
                const steeringCompletedAt = Date.parse(text(steering.appliedAt));
                messages.push({
                    id: text(steering.id),
                    turnId,
                    prompt: text(steering.content),
                    response: '',
                    error: '',
                    createdAt: Number.isFinite(steeringCreatedAt) ? steeringCreatedAt : createdAt,
                    ...(Number.isFinite(steeringCompletedAt) ? { completedAt: steeringCompletedAt } : {})
                });
            }
        }
        records.push({
            id: text(session.id),
            ...(text(session.sourceConversationId) ? { sourceConversationId: text(session.sourceConversationId) } : {}),
            ...(text(session.sourceMessageId) ? { sourceMessageId: text(session.sourceMessageId) } : {}),
            workspacePath: text(session.workspacePath),
            title: text(session.title),
            ...(session.titleOrigin === 'default' || session.titleOrigin === 'draft' || session.titleOrigin === 'recoveredDraft' ? { titleOrigin: session.titleOrigin as 'default' | 'draft' | 'recoveredDraft' } : {}),
            messages,
            createdAt: timestamp(session.createdAt),
            updatedAt: timestamp(session.updatedAt)
        });
    }
    return records.sort((left, right) => right.updatedAt - left.updatedAt);
}

export function searchConversationHistoryRecords(
    records: readonly DesktopConversationIndexRecord[],
    request: DesktopConversationSearchRequest
): DesktopConversationSearchResult {
    let query = text(request.query).trim().toLocaleLowerCase();
    let conversationId = text(request.conversationId).trim().toLocaleLowerCase();
    let messageId = text(request.messageId).trim().toLocaleLowerCase();
    const locator = /^nextmux:\/\/conversation\/([^/\s]+)\/message\/([^/\s]+)$/i.exec(query);
    if (locator) {
        try {
            conversationId = decodeURIComponent(locator[1]).toLocaleLowerCase();
            messageId = decodeURIComponent(locator[2]).toLocaleLowerCase();
            query = '';
        } catch {
            return { matches: [] };
        }
    }
    const limit = Math.max(1, Math.min(500, Math.trunc(Number(request.limit) || 50)));
    const terms = query.split(/\s+/).filter(Boolean);
    const matches: DesktopConversationSearchResult['matches'][number][] = [];
    for (const record of records) {
        const normalizedConversationId = record.id.toLocaleLowerCase();
        if (conversationId && normalizedConversationId !== conversationId) continue;
        const requestedMessage = messageId
            ? record.messages.find(message => message.id.toLocaleLowerCase() === messageId)
                || record.messages.find(message => message.turnId?.toLocaleLowerCase() === messageId)
            : undefined;
        if (messageId && !requestedMessage) continue;

        let matchedMessage = requestedMessage;
        let kind: 'conversation_id' | 'message_id' | 'content' = requestedMessage ? 'message_id' : 'content';
        let snippet = record.title || record.workspacePath || record.id;
        if (!matchedMessage && query) {
            if (normalizedConversationId.includes(query)) {
                kind = 'conversation_id';
                snippet = record.id;
            } else {
                for (let i = record.messages.length - 1; i >= 0; i--) {
                    const message = record.messages[i];
                    const searchable = conversationMessageSearchTexts(message).join('\n').toLocaleLowerCase();
                    if (message.id.toLocaleLowerCase().includes(query) || terms.every(term => searchable.includes(term))) {
                        matchedMessage = message;
                        break;
                    }
                }
                if (matchedMessage) {
                    kind = matchedMessage.id.toLocaleLowerCase().includes(query) ? 'message_id' : 'content';
                    snippet = compactSnippet(conversationMessageSearchTexts(matchedMessage)
                        .find(value => terms.some(term => value.toLocaleLowerCase().includes(term))) || matchedMessage.id, terms);
                } else {
                    const conversationText = [record.id, record.sourceConversationId, record.sourceMessageId,
                        record.title, record.workspacePath].join('\n').toLocaleLowerCase();
                    if (!terms.every(term => conversationText.includes(term))) continue;
                    snippet = record.workspacePath || record.title || record.id;
                }
            }
        }
        matches.push({
            conversationId: record.id,
            ...(matchedMessage ? { messageId: matchedMessage.id, turnId: matchedMessage.turnId || matchedMessage.id } : {}),
            title: record.title,
            ...(record.titleOrigin === 'default' || record.titleOrigin === 'draft' || record.titleOrigin === 'recoveredDraft' ? { titleOrigin: record.titleOrigin as 'default' | 'draft' | 'recoveredDraft' } : {}),
            workspacePath: record.workspacePath,
            kind,
            snippet,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt
        });
        if (matches.length >= limit) break;
    }
    return { matches };
}
