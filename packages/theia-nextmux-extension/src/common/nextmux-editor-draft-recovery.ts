/** Local editor backups only: these records never authorize writes to the source file. */
export const EDITOR_RECOVERY_MAX_BYTES = 1024 * 1024;
export const EDITOR_RECOVERY_MAX_COUNT = 32;
export const EDITOR_RECOVERY_TOTAL_BYTES = 32 * 1024 * 1024;

export type EditorDraftRecoveryErrorCode = `EDITOR_RECOVERY_${'DISABLED' | 'CONFLICT' | 'NOT_FOUND'
    | 'TOO_LARGE' | 'QUOTA_EXCEEDED' | 'CORRUPT' | 'UNSAFE_PATH' | 'UNAVAILABLE' | 'UNSUPPORTED_VERSION'}`;

export interface EditorDraftRecoverySnapshot {
    readonly sessionId?: string;
    readonly sourceUri: string;
    readonly name: string;
    readonly baseline: { readonly current: string; readonly before?: string };
    readonly drafts: { readonly current?: string; readonly before?: string };
}

export type EditorDraftRecoverySourceStatus = 'matching' | 'changed' | 'missing' | 'read_only' | 'unverified';
export interface EditorDraftRecoverySource {
    readonly status: EditorDraftRecoverySourceStatus;
    /** Advisory evidence, never a new permission or automatic write instruction. */
    readonly canWriteSource: boolean;
}
export interface EditorDraftRecoveryAck {
    readonly id: string;
    readonly revision: number;
    readonly mutationId: string;
    readonly snapshotSha256: string;
    readonly updatedAt: string;
    readonly source: EditorDraftRecoverySource;
}
export interface EditorDraftRecoveryRecord extends EditorDraftRecoveryAck {
    readonly version: 1;
    readonly snapshot: EditorDraftRecoverySnapshot;
}
export interface EditorDraftRecoverySummary {
    readonly id: string;
    readonly revision: number;
    readonly sessionId?: string;
    readonly sourceUri: string;
    readonly name: string;
    readonly updatedAt: string;
    readonly bytes: number;
}
export interface EditorDraftRecoveryState {
    readonly enabled: boolean;
    readonly settingsRevision: number;
    readonly entries: readonly EditorDraftRecoverySummary[];
    readonly totalBytes: number;
}
export interface EditorDraftRecoveryRequest { readonly id?: string; readonly sessionId?: string; }
export type EditorDraftRecoveryOpenResult =
    | { readonly kind: 'allocated'; readonly id: string; readonly revision: 0 }
    | { readonly kind: 'record'; readonly record: EditorDraftRecoveryRecord };
export interface EditorDraftRecoverySaveRequest {
    readonly id: string;
    readonly expectedRevision: number;
    readonly mutationId: string;
    readonly snapshot: EditorDraftRecoverySnapshot;
    /** First save checks implicitly; subsequent refreshes must follow an explicit source save. */
    readonly refreshSourceBaseline?: true;
}
export interface EditorDraftRecoveryDiscardRequest {
    readonly id: string;
    readonly expectedRevision: number;
}
