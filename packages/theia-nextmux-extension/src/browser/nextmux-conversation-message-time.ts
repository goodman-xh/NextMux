/** Visible message time is independent of saved preferences, drafts and goals. */
export interface ConversationMessageTimeTurn {
    readonly createdAt: number;
    readonly completedAt?: number;
    readonly branchUserOnly?: boolean;
}

const validTime = (value: number | undefined): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

export function conversationMessageTime(turn: ConversationMessageTimeTurn): number | undefined {
    if (!turn.branchUserOnly && validTime(turn.completedAt) && (!validTime(turn.createdAt) || turn.completedAt >= turn.createdAt)) return turn.completedAt;
    return validTime(turn.createdAt) ? turn.createdAt : undefined;
}

export function latestConversationMessageTime(session: {
    readonly historyLoaded?: boolean;
    readonly turns: readonly ConversationMessageTimeTurn[];
    readonly latestTurn?: ConversationMessageTimeTurn;
}): number | undefined {
    // A hydrated body is authoritative, including an explicitly empty history.
    // Header-only lists already carry the exact final turn's timestamps.
    const latest = session.historyLoaded === false ? session.latestTurn : session.turns.at(-1);
    return latest ? conversationMessageTime(latest) : undefined;
}
