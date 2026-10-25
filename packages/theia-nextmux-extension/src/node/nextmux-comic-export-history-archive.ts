import { createHash } from 'crypto';
import { archiveMediaMessage } from '../common/nextmux-media-archive-messages';
import type { DesktopComicExportQuality, DesktopComicExportState, DesktopComicExportStatus, DesktopComicSubtitleMode } from '../common/nextmux-platform-protocol';

export const COMIC_EXPORT_ARCHIVE_MAX_RECORDS = 100;
export const COMIC_EXPORT_ARCHIVE_MAX_BYTES = 128_000;
const FORMAT = 'nextmux-comic-export-records';
const STATUSES: readonly DesktopComicExportStatus[] = ['completed', 'failed', 'cancelled'];
const QUALITIES: readonly DesktopComicExportQuality[] = ['draft', 'balanced', 'high'];
const SUBTITLES: readonly DesktopComicSubtitleMode[] = ['none', 'sidecar', 'embedded', 'burned'];
const RECORD_KEYS = ['completedShots', 'finishedAt', 'id', 'projectRevision', 'quality', 'startedAt', 'status', 'subtitleMode', 'totalShots', 'updatedAt'];
const ARCHIVE_KEYS = ['contentSha256', 'exportedAt', 'format', 'mediaFilesIncluded', 'recordCount', 'records', 'schemaVersion', 'workspaceBinding'];

export class ComicExportHistoryArchiveError extends Error {
    constructor(readonly code: 'COMIC_EXPORT_HISTORY_ARCHIVE_INVALID' | 'COMIC_EXPORT_HISTORY_WORKSPACE_MISMATCH', message: string) {
        super(message);
        this.name = 'ComicExportHistoryArchiveError';
    }
}

export interface ComicExportArchiveRecord {
    readonly id: string;
    readonly projectRevision: number;
    readonly status: 'completed' | 'failed' | 'cancelled';
    readonly quality: DesktopComicExportQuality;
    readonly subtitleMode: DesktopComicSubtitleMode;
    readonly completedShots: number;
    readonly totalShots: number;
    readonly startedAt: string;
    readonly updatedAt: string;
    readonly finishedAt: string;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
    return Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');
}

function iso(value: unknown): value is string {
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return false;
    return !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

export function comicExportArchiveRecord(value: unknown): value is ComicExportArchiveRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const item = value as Record<string, unknown>;
    return exactKeys(item, RECORD_KEYS)
        && typeof item.id === 'string' && /^comic-export-[0-9a-f-]{36}$/.test(item.id)
        && Number.isSafeInteger(item.projectRevision) && (item.projectRevision as number) >= 0
        && STATUSES.includes(item.status as DesktopComicExportStatus)
        && QUALITIES.includes(item.quality as DesktopComicExportQuality)
        && SUBTITLES.includes(item.subtitleMode as DesktopComicSubtitleMode)
        && Number.isSafeInteger(item.completedShots) && (item.completedShots as number) >= 0
        && Number.isSafeInteger(item.totalShots) && (item.totalShots as number) >= 1
        && (item.completedShots as number) <= (item.totalShots as number)
        && iso(item.startedAt) && iso(item.updatedAt) && iso(item.finishedAt);
}

export function comicExportArchiveProjection(state: DesktopComicExportState): ComicExportArchiveRecord | undefined {
    if (!STATUSES.includes(state.status) || !state.finishedAt) return undefined;
    const record: ComicExportArchiveRecord = {
        id: state.id,
        projectRevision: state.projectRevision,
        status: state.status as ComicExportArchiveRecord['status'],
        quality: state.quality,
        subtitleMode: state.subtitleMode,
        completedShots: state.completedShots,
        totalShots: state.totalShots,
        startedAt: state.startedAt,
        updatedAt: state.updatedAt,
        finishedAt: state.finishedAt
    };
    return comicExportArchiveRecord(record) ? record : undefined;
}

export function createComicExportHistoryArchive(workspaceBinding: string, records: readonly ComicExportArchiveRecord[]): string {
    const contentSha256 = createHash('sha256').update(JSON.stringify(records)).digest('hex');
    return JSON.stringify({ format: FORMAT, schemaVersion: 1, workspaceBinding, exportedAt: new Date().toISOString(),
        mediaFilesIncluded: false, recordCount: records.length, contentSha256, records });
}

export function parseComicExportHistoryArchive(raw: string, workspaceBinding: string): readonly ComicExportArchiveRecord[] {
    if (Buffer.byteLength(raw, 'utf8') > COMIC_EXPORT_ARCHIVE_MAX_BYTES) throw new ComicExportHistoryArchiveError('COMIC_EXPORT_HISTORY_ARCHIVE_INVALID', 'The archive exceeds the size limit');
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { throw new ComicExportHistoryArchiveError('COMIC_EXPORT_HISTORY_ARCHIVE_INVALID', 'The archive is not valid JSON'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ComicExportHistoryArchiveError('COMIC_EXPORT_HISTORY_ARCHIVE_INVALID', 'The archive must be an object');
    const archive = parsed as Record<string, unknown>;
    if (!exactKeys(archive, ARCHIVE_KEYS) || archive.format !== FORMAT || archive.schemaVersion !== 1
        || archive.mediaFilesIncluded !== false || !iso(archive.exportedAt)
        || typeof archive.workspaceBinding !== 'string' || !/^[a-f0-9]{64}$/.test(archive.workspaceBinding)
        || typeof archive.contentSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(archive.contentSha256)
        || !Number.isSafeInteger(archive.recordCount) || !Array.isArray(archive.records)
        || archive.records.length < 1 || archive.records.length > COMIC_EXPORT_ARCHIVE_MAX_RECORDS
        || archive.recordCount !== archive.records.length || !archive.records.every(comicExportArchiveRecord)
        || new Set(archive.records.map(record => record.id)).size !== archive.records.length
        || createHash('sha256').update(JSON.stringify(archive.records)).digest('hex') !== archive.contentSha256) {
        throw new ComicExportHistoryArchiveError('COMIC_EXPORT_HISTORY_ARCHIVE_INVALID', 'The archive failed validation');
    }
    if (archive.workspaceBinding !== workspaceBinding) throw new ComicExportHistoryArchiveError('COMIC_EXPORT_HISTORY_WORKSPACE_MISMATCH', 'The archive belongs to another workspace');
    return archive.records;
}

export function restoreComicExportHistoryRecord(record: ComicExportArchiveRecord): DesktopComicExportState {
    const notice = archiveMediaMessage('restored_notice');
    return {
        id: record.id,
        projectId: 'restored-history',
        projectRevision: record.projectRevision,
        projectTitle: archiveMediaMessage('restored_title').message,
        status: record.status,
        quality: record.quality,
        subtitleMode: record.subtitleMode,
        progress: record.status === 'completed' ? 100 : 0,
        completedShots: record.completedShots,
        totalShots: record.totalShots,
        message: notice.message,
        messageInfo: notice,
        warnings: [],
        cancelRequested: false,
        cancellable: false,
        startedAt: record.startedAt,
        updatedAt: record.updatedAt,
        finishedAt: record.finishedAt,
        restoredHistoryOnly: true
    };
}
