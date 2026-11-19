import type {
    PlatformAccountNotification,
    PlatformAccountNotificationSeverity
} from '../common/nextmux-platform-protocol';

export type DesktopNotificationCategory = 'platform' | 'billing' | 'async_job' | 'critical_system' | 'transient';
export type DesktopNotificationSource = 'local' | 'platform';
export type DesktopNotificationKind = 'info' | 'success' | 'warning' | 'error';

export interface DesktopNotificationOptions {
    readonly persist?: boolean;
    readonly category?: DesktopNotificationCategory;
}

export interface StoredDesktopNotificationLike {
    readonly id: string;
    readonly kind: DesktopNotificationKind;
    readonly title: string;
    readonly body: string;
    readonly createdAt: number;
    readonly read: boolean;
    readonly conversationId?: string;
    readonly incognitoSessionId?: string;
    readonly managedPrice?: unknown;
    readonly source?: DesktopNotificationSource;
    readonly category?: DesktopNotificationCategory;
    readonly platformNotificationId?: string;
    readonly severity?: PlatformAccountNotificationSeverity;
    readonly actionUrl?: string;
    readonly expiresAt?: number | null;
}

export const DEFAULT_PLATFORM_NOTIFICATION_ORIGIN = 'https://nextmux.app';

export const PERSISTENT_NOTIFICATION_CATEGORIES: ReadonlySet<DesktopNotificationCategory> = new Set([
    'platform',
    'billing',
    'async_job',
    'critical_system'
]);

/**
 * By default, `addNotification()` is transient (composer/in-app toast only) and NEVER
 * enters the persistent top-left notification bell list or unread badge.
 * Only explicit `{ persist: true }` calls with a persistent category persist into the bell.
 */
export function shouldPersistNotification(options?: DesktopNotificationOptions): boolean {
    if (!options || options.persist !== true) return false;
    if (options.category && !PERSISTENT_NOTIFICATION_CATEGORIES.has(options.category)) return false;
    return true;
}

/**
 * Legacy pre-v0.1.32 stored records had no `category` / `source` field and accumulated
 * noisy UI feedback (clipboard, file open/save, terminal, drag-drop, etc.).
 * Only retain legacy records matching genuine billing, async job, or critical system notices.
 */
const LEGACY_PERSISTENT_TITLE_PATTERNS: readonly RegExp[] = [
    // Billing: low balance / top-up credited / call price change
    /余额不足|餘額不足|low balance|残高不足|잔액 부족|saldo insuficiente|solde insuffisant|niedriges guthaben/i,
    /充值已到账|充值成功|儲值已到帳|top[- ]?up credited|balance credited|wallet credited/i,
    /本次调用价格|本次呼叫價格|price for this call/i,
    // Async jobs: comic export, scheduled tasks, goal completion/pause, app plugin review/events
    /漫剧成片已导出|漫剧成片导出失败|成片已导出|成片导出失败|film export|comic export/i,
    /计划任务已完成|计划任务需要处理|计划任务失败|scheduled task|排程任務|スケジュールタスク/i,
    /目标已完成|goal completed|已暂停.*目标|预算.*暂停|budget.*paused|attempts.*paused/i,
    /插件审核|我的插件|plugin review|plugin listed|plugin rejected/i,
    // Critical system: route failover, saved relay unavailable/delisted, workspace folder missing/restored
    /线路已自动切换|route failover|route switched|failover/i,
    /已保存的中转商不可用|中转商不可用|无可用编程模型|saved relay unavailable|relay unavailable|no coding models|merchant api deleted|商家.*已删除|线路已下架/i,
    /项目文件夹不存在|项目文件夹已恢复|project folder missing|project folder restored|workspace.*missing|workspace.*restored/i
];

export function shouldRetainStoredNotification(
    record: StoredDesktopNotificationLike | null | undefined,
    now = Date.now()
): boolean {
    if (!record || typeof record !== 'object') return false;
    if (typeof record.id !== 'string' || !record.id.trim()) return false;
    if (typeof record.title !== 'string' || typeof record.body !== 'string') return false;
    if (typeof record.createdAt !== 'number' || !Number.isFinite(record.createdAt)) return false;
    if (typeof record.read !== 'boolean') return false;
    if (!['info', 'success', 'warning', 'error'].includes(record.kind)) return false;
    if (typeof record.expiresAt === 'number' && Number.isFinite(record.expiresAt) && record.expiresAt > 0 && record.expiresAt <= now) {
        return false;
    }
    if (record.source === 'platform' || (typeof record.platformNotificationId === 'string' && record.platformNotificationId.trim().length > 0)) {
        return true;
    }
    if (record.managedPrice) {
        return true;
    }
    if (record.category !== undefined) {
        return PERSISTENT_NOTIFICATION_CATEGORIES.has(record.category);
    }
    // Pre-v0.1.32 legacy local record without category: keep ONLY genuine persistent notifications.
    const title = record.title.trim();
    const body = record.body.trim();
    if (!title && !body) return false;
    return LEGACY_PERSISTENT_TITLE_PATTERNS.some(pattern => pattern.test(title) || (title.length < 40 && pattern.test(body)));
}

/**
 * Resolves a notification actionUrl safely:
 * - Safe internal relative paths `/...` (excluding `//`, `/\`, or any backslash/control char) resolve against `https://nextmux.app`.
 * - External URLs must use `https:` exclusively and must NOT contain embedded URL credentials (`username` / `password`).
 * - Rejects `javascript:`, `data:`, `file:`, `http:`, embedded credentials, protocol-relative `//`, `/\`, and malformed URLs.
 */
export function resolveSafeNotificationActionUrl(
    rawUrl: string | null | undefined,
    platformOrigin = DEFAULT_PLATFORM_NOTIFICATION_ORIGIN
): string | undefined {
    if (typeof rawUrl !== 'string') return undefined;
    const trimmed = rawUrl.trim();
    if (!trimmed || trimmed.length > 2048) return undefined;
    if (/[\u0000-\u001f\u007f]/.test(trimmed)) return undefined;
    if (trimmed.startsWith('/')) {
        if (trimmed.startsWith('//') || trimmed.startsWith('/\\') || trimmed.includes('\\')) return undefined;
        try {
            const base = new URL(platformOrigin);
            if (base.protocol !== 'https:' || base.username || base.password) return undefined;
            const resolved = new URL(trimmed, base.origin);
            if (resolved.protocol !== 'https:' || resolved.origin !== base.origin || resolved.username || resolved.password) return undefined;
            return resolved.toString();
        } catch {
            return undefined;
        }
    }
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) return undefined;
        return parsed.toString();
    } catch {
        return undefined;
    }
}

export function platformSeverityToNotificationKind(
    severity: PlatformAccountNotificationSeverity | string | undefined
): DesktopNotificationKind {
    if (severity === 'critical') return 'error';
    if (severity === 'warning') return 'warning';
    return 'info';
}

export function toDesktopPlatformNotification(
    item: PlatformAccountNotification,
    platformOrigin = DEFAULT_PLATFORM_NOTIFICATION_ORIGIN
): StoredDesktopNotificationLike {
    const safeUrl = resolveSafeNotificationActionUrl(item.actionUrl, platformOrigin);
    const severity: PlatformAccountNotificationSeverity =
        item.severity === 'critical' || item.severity === 'warning' ? item.severity : 'info';
    return {
        id: `platform:${item.id}`,
        source: 'platform',
        category: 'platform',
        platformNotificationId: item.id,
        severity,
        kind: platformSeverityToNotificationKind(severity),
        title: String(item.title || '').trim().slice(0, 120),
        body: String(item.body || '').trim().slice(0, 2000),
        ...(safeUrl ? { actionUrl: safeUrl } : {}),
        ...(typeof item.expiresAt === 'number' && Number.isFinite(item.expiresAt) ? { expiresAt: item.expiresAt } : {}),
        createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
        read: item.status === 'read'
    };
}

/**
 * Merges active, non-resolved, non-expired platform notifications into the desktop bell list,
 * replacing stale platform entries while preserving local persistent notifications and any
 * in-flight optimistic read/resolved overlays until their remote POST commits.
 */
export function mergePlatformNotifications<T extends StoredDesktopNotificationLike>(
    existing: readonly T[],
    remote: readonly PlatformAccountNotification[],
    options?: {
        readonly now?: number;
        readonly limit?: number;
        readonly platformOrigin?: string;
        readonly pendingStates?: ReadonlyMap<string, 'read' | 'resolved'>;
        readonly pendingMarkAll?: { readonly action: 'read' | 'resolved'; readonly at: number };
    }
): readonly T[] {
    const now = options?.now ?? Date.now();
    const limit = options?.limit ?? 50;
    const platformOrigin = options?.platformOrigin ?? DEFAULT_PLATFORM_NOTIFICATION_ORIGIN;
    const pendingStates = options?.pendingStates;
    const pendingMarkAll = options?.pendingMarkAll;
    const localOnly = existing.filter(item => item.source !== 'platform' && !item.platformNotificationId);
    const seenPlatformIds = new Set<string>();
    const activePlatform: T[] = [];
    for (const item of remote) {
        if (!item || typeof item.id !== 'string' || !item.id.trim()) continue;
        if (item.status === 'resolved') continue;
        if (typeof item.expiresAt === 'number' && Number.isFinite(item.expiresAt) && item.expiresAt > 0 && item.expiresAt <= now) continue;
        if (seenPlatformIds.has(item.id)) continue;
        seenPlatformIds.add(item.id);
        const pendingItem = pendingStates?.get(item.id);
        const itemCreatedAt = Number.isFinite(item.createdAt) ? item.createdAt : now;
        const coveredByMarkAll = Boolean(pendingMarkAll && itemCreatedAt <= pendingMarkAll.at);
        if (pendingItem === 'resolved' || (coveredByMarkAll && pendingMarkAll!.action === 'resolved')) continue;
        const effectiveItem: PlatformAccountNotification =
            pendingItem === 'read' || (coveredByMarkAll && pendingMarkAll!.action === 'read')
                ? { ...item, status: 'read' }
                : item;
        activePlatform.push(toDesktopPlatformNotification(effectiveItem, platformOrigin) as T);
    }
    activePlatform.sort((left, right) => right.createdAt - left.createdAt);
    const boundedPlatform = activePlatform.slice(0, limit);
    const remainingLocalSlots = Math.max(0, limit - boundedPlatform.length);
    const boundedLocal = [...localOnly]
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, remainingLocalSlots);
    return [...boundedPlatform, ...boundedLocal].sort((left, right) => right.createdAt - left.createdAt);
}

export function removePlatformNotifications<T extends StoredDesktopNotificationLike>(
    notifications: readonly T[]
): readonly T[] {
    return notifications.filter(item => item.source !== 'platform' && !item.platformNotificationId);
}

export function countUnreadNotifications(notifications: readonly StoredDesktopNotificationLike[]): number {
    let unread = 0;
    for (const item of notifications) {
        if (!item.read) unread++;
    }
    return unread;
}
