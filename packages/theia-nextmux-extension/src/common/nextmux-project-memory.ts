/** Project-scoped knowledge. Content is evidence, never an implicit instruction. */
export interface ProjectMemorySource {
    readonly kind: 'user' | 'conversation' | 'file' | 'tool';
    readonly reference: string;
}

export interface ProjectMemoryEntry {
    readonly id: string;
    readonly kind: 'fact' | 'experience';
    readonly title: string;
    readonly content: string;
    readonly sources: readonly ProjectMemorySource[];
    readonly revision: number;
    readonly updatedAt: string;
    /** Only a person reviewing the exact revision can create this receipt. */
    readonly adoption?: {
        readonly skillPath: string;
        readonly sourceSha256: string;
        readonly verifiedByUser: string;
        readonly adoptedAt: string;
    };
}

export interface ProjectMemoryDocument {
    readonly schemaVersion: 1;
    readonly revision: number;
    readonly entries: readonly ProjectMemoryEntry[];
}

export interface ProjectMemoryDraft {
    readonly id?: string;
    readonly kind: ProjectMemoryEntry['kind'];
    readonly title: string;
    readonly content: string;
    readonly sources: readonly ProjectMemorySource[];
}

export interface ProjectKnowledgeSnapshot {
    readonly memory: ProjectMemoryDocument;
    readonly memoryPath: string;
    readonly design?: { readonly path: string; readonly sha256: string; readonly content: string };
}

/** Stable content reviewed by the user, independent of object key order on disk. */
export function projectMemoryReviewText(entry: ProjectMemoryEntry): string {
    return JSON.stringify({ id: entry.id, kind: entry.kind, title: entry.title, content: entry.content,
        sources: entry.sources.map(source => ({ kind: source.kind, reference: source.reference })), revision: entry.revision, updatedAt: entry.updatedAt });
}
