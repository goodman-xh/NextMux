import type { DomainMessage } from './nextmux-domain-errors';
/** Importing conversations from other coding tools (see node/nextmux-conversation-import.ts). */
export type ConversationImportSource = 'claude-code' | 'claude-cowork' | 'codex' | 'cursor';

/**
 * new: never imported. imported: already in NextMux and unchanged since.
 * updated: imported before, the source has newer messages (re-import updates it in place).
 * deleted: imported before and then deleted in NextMux (re-import adds it as a new conversation).
 */
export type ConversationImportStatus = 'new' | 'imported' | 'updated' | 'deleted';

export interface ConversationImportCandidate {
    readonly source: ConversationImportSource;
    readonly externalId: string;
    readonly sessionId: string;
    readonly title: string;
    /** The project folder the conversation belonged to; it may no longer exist, and that is fine. */
    readonly workspacePath: string;
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly bytes: number;
    readonly status: ConversationImportStatus;
}

export interface ConversationImportSourceSummary {
    readonly source: ConversationImportSource;
    readonly roots: readonly { readonly path: string; readonly found: boolean; readonly readable: boolean; readonly custom: boolean }[];
    readonly total: number;
    /** new + updated + deleted */
    readonly importable: number;
    readonly imported: number;
    readonly candidates: readonly ConversationImportCandidate[];
    /** Raw diagnostics; UI renders this only in details. */
    readonly error?: string;
    readonly domainError?: DomainMessage;
}

export interface ConversationImportScan {
    readonly sources: readonly ConversationImportSourceSummary[];
    readonly scannedAt: number;
}

export interface ConversationImportRequest {
    readonly source: ConversationImportSource;
    /** Omitted: everything not yet imported or changed since. */
    readonly externalIds?: readonly string[];
}

export interface ConversationImportResult {
    readonly source: ConversationImportSource;
    readonly imported: number;
    readonly updated: number;
    readonly sessionIds: readonly string[];
    readonly failed: readonly { readonly externalId: string; readonly title: string; readonly reason: string; readonly domainError?: DomainMessage }[];
}
