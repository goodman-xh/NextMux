/** Maximum model calls that one assistant reply may attribute a rating to. */
export const RELAY_FEEDBACK_MAX_REQUEST_IDS = 128;
export const RELAY_FEEDBACK_MAX_REQUEST_ID_CHARACTERS = 16_384;

export function isRelayFeedbackRequestId(value: unknown): value is string {
    return typeof value === 'string'
        && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

/**
 * Sanitize and de-duplicate request lineage while retaining first-use order.
 * Arrays and legacy scalar IDs can be passed together during migration.
 */
export function normalizeRelayFeedbackRequestIds(...sources: readonly unknown[]): readonly string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    let characters = 0;
    const append = (candidate: unknown): void => {
        if (Array.isArray(candidate)) {
            for (const item of candidate) append(item);
            return;
        }
        if (!isRelayFeedbackRequestId(candidate)) return;
        const id = candidate;
        if (seen.has(id) || result.length >= RELAY_FEEDBACK_MAX_REQUEST_IDS
            || characters + id.length > RELAY_FEEDBACK_MAX_REQUEST_ID_CHARACTERS) return;
        seen.add(id);
        result.push(id);
        characters += id.length;
    };
    for (const source of sources) append(source);
    return result;
}

/**
 * Merchant ratings require completed managed requests. This controls where a
 * vote is submitted, not whether the reply footer displays feedback buttons.
 * Other settled replies retain feedback locally without changing rankings.
 */
export function canRateRelayReply(stage: string, ...requestIdSources: readonly unknown[]): boolean {
    return (stage === 'complete' || stage === 'paused' || stage === 'error' || stage === 'cancelled')
        && normalizeRelayFeedbackRequestIds(...requestIdSources).length > 0;
}
