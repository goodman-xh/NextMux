import { ConversationDomainError } from '../common/nextmux-conversation-domain-errors';
import type { ConversationArchiveExportOptions } from '../common/nextmux-conversation-archive';

export interface ArchivedProjectLabel { readonly sourceSha256: string; readonly ref: string; readonly label: string; }
export interface ArchiveUiProjectGroup { readonly id: string; readonly label?: string; readonly sessionIds: readonly string[]; readonly titles: readonly string[]; }
export const validArchiveProjectLabel = (value: string): boolean => value.trim().length > 0 && value.length <= 160
    && !/[\\/\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(value) && !/^[a-z]:/i.test(value.trim());

export function normalizeArchivedProjectLabel(value: unknown): ArchivedProjectLabel | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const item = value as Record<string, unknown>;
    return typeof item.sourceSha256 === 'string' && /^[a-f0-9]{64}$/.test(item.sourceSha256)
        && typeof item.ref === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(item.ref)
        && typeof item.label === 'string' && validArchiveProjectLabel(item.label)
        ? { sourceSha256: item.sourceSha256, ref: item.ref, label: item.label } : undefined;
}

/** Paths are grouping inputs on this machine only, never exported labels or IDs. */
export function archiveUiProjectGroups(sessions: readonly { readonly id: string; readonly title: string; readonly workspacePath: string; readonly ownedWorkspace?: boolean; readonly archiveProject?: unknown }[]): readonly ArchiveUiProjectGroup[] {
    const groups = new Map<string, { id: string; label?: string; sessionIds: string[]; titles: string[] }>();
    for (const session of sessions) {
        const archived = normalizeArchivedProjectLabel(session.archiveProject);
        const key = archived ? `archive:${archived.sourceSha256}:${archived.ref}` : !session.ownedWorkspace && session.workspacePath ? `local:${session.workspacePath}` : undefined;
        if (!key) continue;
        const folderName = !archived && session.workspacePath ? session.workspacePath.split(/[\\/]/).filter(Boolean).at(-1) : undefined;
        const label = archived ? archived.label : (folderName && validArchiveProjectLabel(folderName) ? folderName : undefined);
        let group = groups.get(key);
        if (!group) { group = { id: session.id, ...(label ? { label } : {}), sessionIds: [], titles: [] }; groups.set(key, group); }
        group.sessionIds.push(session.id); group.titles.push(session.title);
    }
    return [...groups.values()];
}

export function archiveProjectExportOptions(groups: readonly ArchiveUiProjectGroup[], selectedIds: readonly string[], labels: Readonly<Record<string, string>>): ConversationArchiveExportOptions {
    const selected = new Set(selectedIds);
    const projects = groups.flatMap(group => {
        const sessionIds = group.sessionIds.filter(id => selected.has(id));
        if (!sessionIds.length) return [];
        const label = labels[group.id]?.trim() || '';
        if (!validArchiveProjectLabel(label)) throw new ConversationDomainError('ARCHIVE_PROJECT_LABEL_INVALID', 'archive_project_label_invalid');
        return [{ label, sessionIds }];
    });
    if (projects.length > 128) throw new ConversationDomainError('ARCHIVE_PROJECT_LIMIT', 'archive_project_group_limit', undefined, { limit: 128 });
    return { projects };
}

export type LocalDataActionTextKey =
    | 'clearCacheButton'
    | 'deleteConversationsButton'
    | 'clearCacheTitle'
    | 'clearCacheDescription'
    | 'clearCacheItems'
    | 'clearCacheConfirm'
    | 'deleteConversationsTitle'
    | 'deleteConversationsDescription'
    | 'deleteConversationsConfirm'
    | 'cancel'
    | 'cacheCleared'
    | 'cacheClearFailed';

const LOCAL_DATA_ACTION_ZH_CN: Readonly<Record<LocalDataActionTextKey, string>> = {
    clearCacheButton: '清理缓存数据',
    deleteConversationsButton: '删除所有对话',
    clearCacheTitle: '确认清理缓存数据',
    clearCacheDescription: '将清理以下所有缓存与临时数据。所有完整对话记录均受保护，绝对不会被删除。',
    clearCacheItems: '清理范围：任务检查点、对话附件（受控缓存）、当前项目漫剧编辑历史、媒体任务记录、成片导出记录、漫剧生成媒体文件、启动快照、通知记录、网络缓存',
    clearCacheConfirm: '确认清理缓存数据',
    deleteConversationsTitle: '确认删除所有对话',
    deleteConversationsDescription: '将永久删除本机所有项目的持久化会话与完整对话记录。此操作不可恢复，如需保留请先在上方“会话迁移”中导出备份。',
    deleteConversationsConfirm: '确认删除所有对话',
    cancel: '取消',
    cacheCleared: '缓存与临时数据已清理；所有完整对话记录均未受影响',
    cacheClearFailed: '部分缓存数据清理失败，请重试'
};

const LOCAL_DATA_ACTION_ZH_TW: Readonly<Record<LocalDataActionTextKey, string>> = {
    clearCacheButton: '清理快取資料',
    deleteConversationsButton: '刪除所有對話',
    clearCacheTitle: '確認清理快取資料',
    clearCacheDescription: '將清理以下所有快取與暫存資料。所有完整對話記錄均受保護，絕對不會被刪除。',
    clearCacheItems: '清理範圍：任務檢查點、對話附件（受控快取）、目前專案漫劇編輯歷史、媒體任務記錄、成片匯出記錄、漫劇產生媒體檔案、啟動快照、通知記錄、網路快取',
    clearCacheConfirm: '確認清理快取資料',
    deleteConversationsTitle: '確認刪除所有對話',
    deleteConversationsDescription: '將永久刪除本機所有專案的持久化工作階段與完整對話記錄。此操作無法復原，如需保留請先在上方「工作階段遷移」中匯出備份。',
    deleteConversationsConfirm: '確認刪除所有對話',
    cancel: '取消',
    cacheCleared: '快取與暫存資料已清理；所有完整對話記錄均未受影響',
    cacheClearFailed: '部分快取資料清理失敗，請重試'
};

const LOCAL_DATA_ACTION_EN: Readonly<Record<LocalDataActionTextKey, string>> = {
    clearCacheButton: 'Clear cached data',
    deleteConversationsButton: 'Delete all conversations',
    clearCacheTitle: 'Confirm clearing cached data',
    clearCacheDescription: 'This clears all cached and temporary data listed below. Your full conversation history is protected and will never be deleted.',
    clearCacheItems: 'Included: task checkpoints, conversation attachments (managed cache), comic edit history, media job history, comic export history, generated comic media files, startup snapshot, notifications, network cache',
    clearCacheConfirm: 'Clear cached data',
    deleteConversationsTitle: 'Confirm deleting all conversations',
    deleteConversationsDescription: 'This permanently deletes all persisted sessions and full conversation history across all projects on this device. This action cannot be undone; export a backup in Conversation Migration above first if needed.',
    deleteConversationsConfirm: 'Delete all conversations',
    cancel: 'Cancel',
    cacheCleared: 'Cached and temporary data cleared; full conversation history was not affected',
    cacheClearFailed: 'Failed to clear some cached data; please try again'
};

export function localDataActionText(locale: string, key: LocalDataActionTextKey): string {
    if (locale === 'zh-TW') return LOCAL_DATA_ACTION_ZH_TW[key] ?? String(key);
    if (locale === 'zh-CN') return LOCAL_DATA_ACTION_ZH_CN[key] ?? String(key);
    return LOCAL_DATA_ACTION_EN[key] ?? String(key);
}

