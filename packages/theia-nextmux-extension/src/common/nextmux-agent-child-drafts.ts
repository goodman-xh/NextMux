/** User-owned, unsent text only. Never a checkpoint, permission or dispatch instruction. */
export interface AgentChildDraft {
    readonly turnId: string;
    readonly rootRunId: string;
    readonly childRunId: string;
    readonly text: string;
}

export const AGENT_CHILD_DRAFT_MAX_LENGTH = 120_000;
export const AGENT_CHILD_DRAFT_MAX_COUNT = 32;
export const AGENT_CHILD_DRAFT_TOTAL_LENGTH = 512_000;

function record(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function id(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\u0000-\u0020\u007f]/.test(value);
}
export function agentChildDraftKey(value: Pick<AgentChildDraft, 'turnId' | 'rootRunId' | 'childRunId'>): string {
    return JSON.stringify([value.turnId, value.rootRunId, value.childRunId]);
}
export function agentChildDraftClock(value: unknown): number {
    return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

/** Discard malformed/unbound records, but never turn truncated text into a complete draft. */
export function normalizeAgentChildDrafts(value: unknown, turns: unknown): readonly AgentChildDraft[] {
    if (!Array.isArray(value) || !Array.isArray(turns)) return [];
    const owners = new Set<string>();
    for (const turn of turns) {
        if (!record(turn) || !id(turn.id) || turn.branchUserOnly === true || !Array.isArray(turn.childAgents)) continue;
        for (const child of turn.childAgents) {
            if (record(child) && id(child.childRunId) && id(child.rootRunId)) {
                owners.add(agentChildDraftKey({ turnId: turn.id, rootRunId: child.rootRunId, childRunId: child.childRunId }));
            }
        }
    }
    const result: AgentChildDraft[] = [], seen = new Set<string>();
    let size = 0;
    for (const candidate of value.slice(0, AGENT_CHILD_DRAFT_MAX_COUNT)) {
        if (!record(candidate) || !id(candidate.turnId) || !id(candidate.rootRunId) || !id(candidate.childRunId)
            || typeof candidate.text !== 'string' || !candidate.text.length || candidate.text.length > AGENT_CHILD_DRAFT_MAX_LENGTH
            || candidate.text.includes('\0')) continue;
        const draft = { turnId: candidate.turnId, rootRunId: candidate.rootRunId, childRunId: candidate.childRunId, text: candidate.text };
        const key = agentChildDraftKey(draft);
        if (!owners.has(key) || seen.has(key) || size + draft.text.length > AGENT_CHILD_DRAFT_TOTAL_LENGTH) continue;
        result.push(draft); seen.add(key); size += draft.text.length;
    }
    return result;
}

/** Admission check at input time; a rejected edit must leave the previous text visible. */
export function replaceAgentChildDraft(
    drafts: readonly AgentChildDraft[], owner: Omit<AgentChildDraft, 'text'>, text: string
): readonly AgentChildDraft[] | undefined {
    if (text.length > AGENT_CHILD_DRAFT_MAX_LENGTH || text.includes('\0')) return undefined;
    const key = agentChildDraftKey(owner), next = drafts.filter(draft => agentChildDraftKey(draft) !== key);
    if (text) next.push({ turnId: owner.turnId, rootRunId: owner.rootRunId, childRunId: owner.childRunId, text });
    return next.length <= AGENT_CHILD_DRAFT_MAX_COUNT
        && next.reduce((sum, draft) => sum + draft.text.length, 0) <= AGENT_CHILD_DRAFT_TOTAL_LENGTH ? next : undefined;
}
