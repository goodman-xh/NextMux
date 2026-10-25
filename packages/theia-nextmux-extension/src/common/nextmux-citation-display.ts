import { normalizeModelCitations } from '@nextmux/agent-runtime/citations';
import type { ModelCitation } from '@nextmux/agent-runtime';

/** Read-only imported child answer excerpts, never task handles or model context. */
export interface ArchivedChildResult {
    readonly childId: string;
    readonly task: string;
    readonly finalText: string;
    readonly citations: readonly ModelCitation[];
    readonly truncated?: boolean;
}

export function normalizeArchivedChildResults(value: unknown): readonly ArchivedChildResult[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const results: ArchivedChildResult[] = [];
    for (const item of value.slice(0, 32)) {
        if (!item || typeof item !== 'object' || typeof item.childId !== 'string' || !/^archive-[a-f0-9]{32}$/.test(item.childId)
            || seen.has(item.childId) || typeof item.task !== 'string' || typeof item.finalText !== 'string') continue;
        const citations = normalizeModelCitations(item.citations);
        if (!citations.length) continue;
        seen.add(item.childId);
        results.push({ childId: item.childId, task: item.task.slice(0, 20_000), finalText: item.finalText.slice(0, 20_000), citations,
            ...(item.truncated === true || item.task.length > 20_000 || item.finalText.length > 20_000 ? { truncated: true } : {}) });
    }
    return results;
}
