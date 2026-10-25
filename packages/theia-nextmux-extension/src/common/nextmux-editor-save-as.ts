/** Explicit export to a NEW local file; this does not acknowledge/discard a recovery record. */
export const EDITOR_SAVE_AS_MAX_BYTES = 16 * 1024 * 1024;
export type EditorDraftSaveAsErrorCode = `EDITOR_SAVE_AS_${'INVALID_REQUEST' | 'INVALID_URI' | 'SAME_SOURCE'
    | 'TARGET_EXISTS' | 'TOO_LARGE' | 'UNSAFE_PATH' | 'UNAVAILABLE' | 'CANCELLED' | 'UNSUPPORTED_FILESYSTEM'}`;
export interface EditorDraftSaveAsRequest {
    readonly sourceUri: string;
    readonly destinationUri: string;
    readonly content: string;
}
export interface EditorDraftSaveAsResult {
    readonly created: true;
    /** Canonical local destination actually published, not a source-write permission. */
    readonly destinationUri: string;
    readonly bytes: number;
}
