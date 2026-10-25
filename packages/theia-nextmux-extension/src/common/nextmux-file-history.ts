/** Local saved-file versions. Listing is metadata-only; contents are loaded on selection. */
export const FILE_HISTORY_MAX_VERSION_BYTES = 16 * 1024 * 1024;
export const FILE_HISTORY_MAX_ENTRIES = 100;
export const FILE_HISTORY_MAX_FILE_BYTES = 128 * 1024 * 1024;
export const FILE_HISTORY_MAX_TOTAL_BYTES = 512 * 1024 * 1024;
export type FileHistoryKind = 'original' | 'saved' | 'restored';
export interface FileHistoryEntry {
    readonly id: string;
    readonly sourceUri: string;
    readonly createdAt: string;
    readonly kind: FileHistoryKind;
    readonly bytes: number;
}
export interface FileHistoryVersion extends FileHistoryEntry { readonly content: string; }
export interface FileHistoryRecordRequest {
    readonly sourceUri: string;
    readonly content: string;
    readonly kind: FileHistoryKind;
}
export type FileHistoryErrorCode = `FILE_HISTORY_${'INVALID_REQUEST' | 'TOO_LARGE' | 'QUOTA_EXCEEDED' | 'NOT_FOUND' | 'CORRUPT' | 'UNSAFE_PATH' | 'UNAVAILABLE'}`;
