/**
 * Conversation tabs.
 *
 * Every conversation shows its own title as the first tab. Further tabs are
 * created only by the AI — for example when it connects to a visual desktop
 * (a remote Windows or macOS machine, or a VM) — never by the user. Tabs are
 * keyed by conversation id, so a tab can never appear in another conversation.
 * Linux shells stay in the terminal drawer; tabs are reserved for visual
 * surfaces.
 */

export type ConversationVisualTabKind = 'remote-desktop' | 'local-desktop' | 'virtual-machine';
export type ConversationVisualTabStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface ConversationTabWindowItem {
    readonly pid: number;
    readonly windowId: number;
    readonly title: string;
    readonly app?: string;
    readonly followed?: boolean;
    readonly role?: 'launcher' | 'client' | 'game' | 'app';
    readonly alive?: boolean;
}

export interface ConversationVisualTab {
    readonly id: string;
    readonly kind: ConversationVisualTabKind;
    /** Short label, e.g. "Windows 11 · build-agent-02". */
    readonly title: string;
    /** Host, VM name or connection description shown on hover. */
    readonly target: string;
    readonly platform?: 'windows' | 'macos' | 'linux';
    readonly status: ConversationVisualTabStatus;
    readonly createdAt: number;
    /** Latest frame (data: or blob: URL) of the desktop, when a stream provides one. */
    readonly frameUrl?: string;
    /**
     * The app window the AI observed (this computer only). The tab shows it live and can move it between the
     * tab and the desktop; valid for this app session only, so it is never saved.
     */
    readonly windowRef?: { readonly pid: number; readonly windowId: number };
    /**
     * Ordered window history belonging to this app tab (e.g., WeGame → LeagueClientUx → League of Legends).
     * When multiple active windows exist, the latest formal window is displayed by default, and the user can
     * switch the active window from the dropdown next to "实时".
     */
    readonly windows?: readonly ConversationTabWindowItem[];
    /** Main-process chain identity; stable across launcher/client/game window changes. */
    readonly familyId?: string;
    /** Opened by its app later (a popped-out window, a game its launcher started): closes when that window closes. */
    readonly followed?: boolean;
    /** The app's bundle id (macOS) or program name (Windows), so the AI finds the tab of the app the user picked. */
    readonly appId?: string;
    /**
     * Windows program names (file name without .exe) of the window's process and of the program launched for it
     * (e.g. "Notepad", "LeagueClientUx"): what skill plugins declare as `program`.
     */
    readonly programs?: readonly string[];
}

export interface ConversationTabsState {
    /** Visual tabs per conversation id. */
    readonly tabs: Readonly<Record<string, readonly ConversationVisualTab[]>>;
    /** The selected tab per conversation id; absent means the conversation itself. */
    readonly active: Readonly<Record<string, string>>;
}

export const CONVERSATION_TAB_ID = 'conversation';
export const CONVERSATION_TABS_STORAGE_KEY = 'nextmux.desktop.conversationTabs.v1';
// Many tabs keep a readable width and the strip scrolls sideways (the mouse wheel moves it).
const MAX_TABS_PER_CONVERSATION = 20;

export function emptyConversationTabs(): ConversationTabsState {
    return { tabs: {}, active: {} };
}

export function visualTabsFor(state: ConversationTabsState, conversationId: string): readonly ConversationVisualTab[] {
    return conversationId ? state.tabs[conversationId] || [] : [];
}

export function activeTabFor(state: ConversationTabsState, conversationId: string): string {
    const active = state.active[conversationId];
    return active && visualTabsFor(state, conversationId).some(tab => tab.id === active) ? active : CONVERSATION_TAB_ID;
}

/** AI-only entry point: add or refresh a visual tab in one conversation and select it. */
export function openVisualTab(state: ConversationTabsState, conversationId: string, tab: ConversationVisualTab, select = true): ConversationTabsState {
    if (!conversationId || !tab.id || tab.id === CONVERSATION_TAB_ID) return state;
    const current = visualTabsFor(state, conversationId);
    const existing = current.findIndex(item => item.id === tab.id);
    const next = existing >= 0
        ? current.map((item, index) => index === existing ? { ...item, ...tab, createdAt: item.createdAt } : item)
        : [...current, tab].slice(-MAX_TABS_PER_CONVERSATION);
    return {
        tabs: { ...state.tabs, [conversationId]: next },
        active: select ? { ...state.active, [conversationId]: tab.id } : state.active
    };
}

export function updateVisualTab(state: ConversationTabsState, conversationId: string, id: string, patch: Partial<Omit<ConversationVisualTab, 'id' | 'createdAt'>>): ConversationTabsState {
    const current = visualTabsFor(state, conversationId);
    if (!current.some(tab => tab.id === id)) return state;
    return { ...state, tabs: { ...state.tabs, [conversationId]: current.map(tab => tab.id === id ? { ...tab, ...patch } : tab) } };
}

export function selectTab(state: ConversationTabsState, conversationId: string, id: string): ConversationTabsState {
    if (!conversationId) return state;
    const active = { ...state.active };
    if (id === CONVERSATION_TAB_ID || !visualTabsFor(state, conversationId).some(tab => tab.id === id)) delete active[conversationId];
    else active[conversationId] = id;
    return { ...state, active };
}

/** Close a visual tab; the conversation tab itself is closed by leaving the conversation. */
export function closeVisualTab(state: ConversationTabsState, conversationId: string, id: string): ConversationTabsState {
    const current = visualTabsFor(state, conversationId);
    if (!current.some(tab => tab.id === id)) return state;
    const remaining = current.filter(tab => tab.id !== id);
    const tabs = { ...state.tabs };
    if (remaining.length) tabs[conversationId] = remaining; else delete tabs[conversationId];
    const active = { ...state.active };
    if (active[conversationId] === id) delete active[conversationId];
    return { tabs, active };
}

/** Drop tabs of conversations that no longer exist (deleted or archived away). */
export function pruneConversationTabs(state: ConversationTabsState, liveConversationIds: ReadonlySet<string>): ConversationTabsState {
    const tabs: Record<string, readonly ConversationVisualTab[]> = {};
    const active: Record<string, string> = {};
    for (const [id, list] of Object.entries(state.tabs)) if (liveConversationIds.has(id)) tabs[id] = list;
    for (const [id, tab] of Object.entries(state.active)) if (tabs[id]) active[id] = tab;
    return { tabs, active };
}

/** Frames are live-only; persisted tabs come back disconnected until the AI reconnects. */
export function serializeConversationTabs(state: ConversationTabsState): string {
    const tabs: Record<string, ConversationVisualTab[]> = {};
    for (const [id, list] of Object.entries(state.tabs)) {
        // A followed window's tab lives only as long as that window, so it is not kept across restarts.
        tabs[id] = list.filter(tab => !tab.followed).map(({ frameUrl: _frame, windowRef: _window, windows: _windows, familyId: _family, ...tab }) => ({ ...tab, status: tab.status === 'error' ? 'error' : 'disconnected' }));
    }
    return JSON.stringify({ version: 1, tabs, active: state.active });
}

export function parseConversationTabs(raw: string | null | undefined): ConversationTabsState {
    if (!raw) return emptyConversationTabs();
    try {
        const value = JSON.parse(raw) as { version?: number; tabs?: Record<string, unknown>; active?: Record<string, unknown> };
        if (value?.version !== 1 || typeof value.tabs !== 'object' || !value.tabs) return emptyConversationTabs();
        const tabs: Record<string, ConversationVisualTab[]> = {};
        for (const [id, list] of Object.entries(value.tabs)) {
            if (!Array.isArray(list)) continue;
            const valid = list.filter((tab): tab is ConversationVisualTab => Boolean(tab) && typeof tab.id === 'string' && tab.id !== CONVERSATION_TAB_ID
                && typeof tab.title === 'string' && typeof tab.target === 'string'
                && ['remote-desktop', 'local-desktop', 'virtual-machine'].includes(tab.kind)).slice(-MAX_TABS_PER_CONVERSATION);
            if (valid.length) tabs[id] = valid.map(({ windowRef: _window, windows: _windows, familyId: _family, ...tab }) => ({ ...tab, status: tab.status === 'error' ? 'error' : 'disconnected', frameUrl: undefined }));
        }
        const active: Record<string, string> = {};
        for (const [id, tab] of Object.entries(value.active || {})) if (typeof tab === 'string' && tabs[id]?.some(item => item.id === tab)) active[id] = tab;
        return { tabs, active };
    } catch {
        return emptyConversationTabs();
    }
}

function computerPlatform(platform: string): ConversationVisualTab['platform'] {
    return /^mac|darwin/i.test(platform) ? 'macos' : /^win/i.test(platform) ? 'windows' : /linux/i.test(platform) ? 'linux' : undefined;
}

/** The id of the tab that holds one app window. */
export function appWindowTabId(pid: number, windowId: number): string {
    return `window:${pid}:${windowId}`;
}

/** Helper processes (embedded browser popups, anti-cheat, downloaders) that are not formal app/game windows. */
const NON_FORMAL_WINDOW_APPS = new Set([
    'crossproxy', 'teniodl', 'tphelper', 'taslogin', 'sguard64', 'sguardsvc64',
    'cef_frame_render', 'crashpad_handler', 'wegamehelper', 'riotclientcrashhandler', 'pallas',
    'gameoverlayui', 'steamwebhelper', 'crashreporter', 'werfault', 'textinputhost', 'ctfmon', 'applicationframehost'
]);

/** Returns true when a window belongs to a formal app/client/game surface rather than an auxiliary helper popup. */
export function isFormalTabWindow(opened: { readonly app?: string; readonly title?: string }): boolean {
    const bareApp = (opened.app || '').trim().toLowerCase().replace(/\.exe$/i, '');
    if (bareApp && NON_FORMAL_WINDOW_APPS.has(bareApp)) return false;
    return true;
}

/** Ordered list of active formal windows inside a tab (oldest first, latest formal window last). */
export function tabWindows(tab: Pick<ConversationVisualTab, 'windowRef' | 'windows' | 'title' | 'target' | 'programs'>): readonly ConversationTabWindowItem[] {
    if (tab.windows?.length) {
        if (tab.windowRef && !tab.windows.some(item => item.pid === tab.windowRef!.pid && item.windowId === tab.windowRef!.windowId)) {
            return [...tab.windows.filter(item => item.alive !== false), {
                pid: tab.windowRef.pid,
                windowId: tab.windowRef.windowId,
                title: (tab.target || tab.title || `PID ${tab.windowRef.pid}`).slice(0, 120),
                ...(tab.programs?.[0] ? { app: tab.programs[0] } : {})
            }];
        }
        return tab.windows.filter(item => item.alive !== false);
    }
    if (tab.windowRef) {
        return [{
            pid: tab.windowRef.pid,
            windowId: tab.windowRef.windowId,
            title: (tab.target || tab.title || `PID ${tab.windowRef.pid}`).slice(0, 120),
            ...(tab.programs?.[0] ? { app: tab.programs[0] } : {})
        }];
    }
    return [];
}

/** Display label for a window entry in the active window switcher dropdown next to "实时". */
export function tabWindowItemLabel(item: ConversationTabWindowItem): string {
    const title = item.title?.trim() || '';
    const app = item.app?.trim() || '';
    if (app && title && app.toLowerCase() !== title.toLowerCase() && !title.toLowerCase().includes(app.toLowerCase())) {
        return `${app} · ${title}`;
    }
    return title || app || `PID ${item.pid}`;
}

function tabWindowStageRank(item: Pick<ConversationTabWindowItem, 'app' | 'title' | 'role'>): number {
    if (item.role) return { launcher: 1, client: 2, game: 3, app: 2 }[item.role];
    const app = (item.app || '').trim().toLowerCase().replace(/\.exe$/i, '');
    const title = (item.title || '').trim().toLowerCase();
    if (app === 'wegame' || app === 'launcher' || title === 'wegame') return 1;
    if (app === 'leagueclientux' || app === 'riotclientux') return 2;
    if (app === 'league of legends' || title.includes('league of legends (tm) client')) return 3;
    return 2;
}

/**
 * Attach a newly opened or re-detected formal window into an existing app tab and switch the displayed
 * surface (`windowRef`) to the latest formal window (`最后一个正式的窗口`).
 */
export function attachTabWindow(
    tab: ConversationVisualTab,
    opened: { readonly pid: number; readonly windowId: number; readonly app?: string; readonly title?: string; readonly followed?: boolean; readonly appId?: string; readonly programs?: readonly string[]; readonly familyId?: string; readonly role?: ConversationTabWindowItem['role']; readonly windows?: readonly ConversationTabWindowItem[] },
    activate = true
): ConversationVisualTab {
    const current = opened.windows || tab.windows || tabWindows(tab);
    const appName = opened.app?.trim().slice(0, 80) || undefined;
    const itemTitle = (opened.title?.trim() || appName || tab.target || tab.title || `PID ${opened.pid}`).slice(0, 120);
    const entry: ConversationTabWindowItem = {
        ...current.find(item => item.pid === opened.pid && item.windowId === opened.windowId),
        pid: opened.pid,
        windowId: opened.windowId,
        title: itemTitle,
        alive: true,
        ...(opened.role ? { role: opened.role } : {}),
        ...(appName ? { app: appName } : {}),
        ...(opened.followed ? { followed: true } : {})
    };
    const withoutTarget = current.filter(item => !(item.pid === opened.pid && item.windowId === opened.windowId));
    const nextWindows = [...withoutTarget, entry].sort((a, b) => tabWindowStageRank(a) - tabWindowStageRank(b));
    const liveWindows = nextWindows.filter(item => item.alive !== false);
    const latestFormal = liveWindows[liveWindows.length - 1] || entry;
    const activeEntry = activate && tabWindowStageRank(entry) >= tabWindowStageRank(latestFormal) ? entry : latestFormal;
    const mergedPrograms = [...new Set([
        ...(tab.programs || []),
        ...(appName ? [appName] : []),
        ...((opened.programs || []).filter(item => typeof item === 'string' && item.trim()).map(item => item.trim().slice(0, 80)))
    ])].filter(item => !NON_FORMAL_WINDOW_APPS.has(item.trim().toLowerCase().replace(/\.exe$/i, ''))).slice(0, 8);
    return {
        ...tab,
        status: 'connected',
        windowRef: { pid: activeEntry.pid, windowId: activeEntry.windowId },
        target: activeEntry.title.slice(0, 200),
        windows: nextWindows,
        ...(opened.familyId ? { familyId: opened.familyId } : {}),
        ...(opened.appId?.trim() && !tab.appId ? { appId: opened.appId.trim().slice(0, 160) } : {}),
        ...(mergedPrograms.length ? { programs: mergedPrograms } : {})
    };
}

/**
 * Remove a closed window from an app tab. If other formal windows remain open in the tab, automatically
 * fall back `windowRef` to the last formal window (`最后一个正式的窗口`) and keep the tab connected.
 */
export function removeTabWindow(tab: ConversationVisualTab, pid: number, windowId: number): ConversationVisualTab {
    const history = (tab.windows || tabWindows(tab)).map(item => item.pid === pid && item.windowId === windowId ? { ...item, alive: false } : item);
    const remaining = history.filter(item => item.alive !== false);
    if (!remaining.length) {
        return { ...tab, status: 'disconnected', windowRef: undefined, windows: history };
    }
    const lastFormal = remaining[remaining.length - 1];
    const nextActive = (tab.windowRef && !(tab.windowRef.pid === pid && tab.windowRef.windowId === windowId)
        && remaining.find(item => item.pid === tab.windowRef!.pid && item.windowId === tab.windowRef!.windowId))
        || lastFormal;
    return {
        ...tab,
        status: 'connected',
        windowRef: { pid: nextActive.pid, windowId: nextActive.windowId },
        target: nextActive.title.slice(0, 200),
        windows: history
    };
}

/** Switch the currently displayed active window inside a multi-window tab. */
export function selectTabWindow(tab: ConversationVisualTab, pid: number, windowId: number): ConversationVisualTab {
    const current = tabWindows(tab);
    const picked = current.find(item => item.pid === pid && item.windowId === windowId);
    if (!picked) return tab;
    return {
        ...tab,
        status: 'connected',
        windowRef: { pid: picked.pid, windowId: picked.windowId },
        target: picked.title.slice(0, 200),
        windows: tab.windows || current
    };
}

/** Find a tab in a conversation by its tab id or by any `(pid, windowId)` in `tab.windowRef` / `tab.windows`. */
export function findConversationTabByTarget(
    tabs: readonly ConversationVisualTab[],
    tabId?: string,
    pid?: number,
    windowId?: number
): ConversationVisualTab | undefined {
    if (tabId) {
        const direct = tabs.find(tab => tab.id === tabId);
        if (direct) return direct;
        const byWindowId = tabs.find(tab =>
            (tab.windowRef && appWindowTabId(tab.windowRef.pid, tab.windowRef.windowId) === tabId)
            || tabWindows(tab).some(item => appWindowTabId(item.pid, item.windowId) === tabId)
        );
        if (byWindowId) return byWindowId;
    }
    if (pid !== undefined && windowId !== undefined) {
        return tabs.find(tab =>
            (tab.windowRef?.pid === pid && tab.windowRef.windowId === windowId)
            || tabWindows(tab).some(item => item.pid === pid && item.windowId === windowId)
        );
    }
    if (pid !== undefined) {
        return tabs.find(tab =>
            tab.windowRef?.pid === pid
            || tabWindows(tab).some(item => item.pid === pid)
        );
    }
    return undefined;
}

/**
 * The tab for an app the AI opened with tabs.open_app. Tabs are the AI's own surfaces, apart from the user's
 * desktop: controlling a desktop window with computer.* never opens one.
 */
export function appWindowTab(opened: { readonly pid: number; readonly windowId: number; readonly app: string; readonly title?: string; readonly followed?: boolean; readonly appId?: string;
    readonly programs?: readonly string[]; readonly familyId?: string; readonly role?: ConversationTabWindowItem['role']; readonly windows?: readonly ConversationTabWindowItem[] }, platform: string): Omit<ConversationVisualTab, 'createdAt'> {
    const name = opened.app.trim().slice(0, 120) || `PID ${opened.pid}`;
    // A followed window is named by its own title when it has one ("微信 · 张三", a game's name).
    const title = opened.followed && opened.title?.trim() && opened.title.trim() !== name ? `${name} · ${opened.title.trim()}` : name;
    const programs = [...new Set((opened.programs || []).filter(item => typeof item === 'string' && item.trim()).map(item => item.trim().slice(0, 80)))].slice(0, 4);
    return { id: appWindowTabId(opened.pid, opened.windowId), kind: 'local-desktop', title: title.slice(0, 120), target: (opened.title?.trim() || name).slice(0, 200),
        platform: computerPlatform(platform), status: 'connected', windowRef: { pid: opened.pid, windowId: opened.windowId }, ...(opened.followed ? { followed: true } : {}),
        ...(opened.familyId ? { familyId: opened.familyId } : {}),
        windows: opened.windows?.length ? opened.windows : [{ pid: opened.pid, windowId: opened.windowId, app: name, title: opened.title || name, alive: true, ...(opened.role ? { role: opened.role } : {}) }],
        ...(opened.appId?.trim() ? { appId: opened.appId.trim().slice(0, 160) } : {}), ...(programs.length ? { programs } : {}) };
}

/**
 * Every name a skill plugin may use for a tab's app: its bundle id / Start-menu app id, the Windows program names of
 * its window and of the program launched for it, and the file name of an app id that is a path. Lower-case.
 */
export function appTabIdentity(tab: Pick<ConversationVisualTab, 'appId' | 'programs' | 'title' | 'target' | 'windows'>): string[] {
    const names = new Set<string>();
    const add = (value: string | undefined) => {
        const text = value?.trim().toLowerCase();
        if (!text) return;
        names.add(text);
        const bare = text.replace(/\.exe$/i, '');
        if (bare) names.add(bare);
    };
    add(tab.appId);
    for (const program of tab.programs || []) add(program);
    for (const win of tab.windows || []) { add(win.app); add(win.title); }
    // "C:\\…\\launcher.exe" or "{GUID}\\WeGame\\wegame.exe": its program name.
    if (tab.appId && /[\\/]/.test(tab.appId)) add(tab.appId.split(/[\\/]/).pop());
    add(tab.target);
    add(tab.title);
    return [...names];
}

const APP_CHAIN_NAMES: readonly (readonly string[])[] = [
    ['wegame', 'leagueclient', 'leagueclientux', 'riotclientservices', 'riotclientux', 'league of legends'],
    ['steam'], ['battle.net', 'battle.net launcher'], ['epicgameslauncher']
];

/** Main-process chain IDs take precedence; names only support legacy events without chain metadata. */
export function isSameTabAppFamily(
    tab: Pick<ConversationVisualTab, 'appId' | 'programs' | 'title' | 'target' | 'windows' | 'familyId'>,
    candidate: { readonly app?: string; readonly title?: string; readonly appId?: string; readonly programs?: readonly string[]; readonly familyId?: string; readonly root?: number }
): boolean {
    if (tab.familyId && candidate.familyId) return tab.familyId === candidate.familyId;
    if (candidate.root && tab.windows?.some(item => item.pid === candidate.root)) return true;
    const identities = (appId: string | undefined, programs: readonly string[], fallback: string) => {
        const values = [appId, ...programs].filter((item): item is string => Boolean(item?.trim()));
        return (values.length ? values : [fallback]).map(item => item.trim().toLowerCase().replace(/\.exe$/i, ''))
            .filter(item => item && !NON_FORMAL_WINDOW_APPS.has(item) && item !== 'launcher');
    };
    const left = identities(tab.appId, [...(tab.programs || []), ...(tab.windows || []).map(item => item.app || '')], tab.title);
    const right = identities(candidate.appId, [...(candidate.programs || []), candidate.app || ''], candidate.title || '');
    if (right.some(item => left.includes(item))) return true;
    return APP_CHAIN_NAMES.some(names => left.some(item => names.includes(item)) && right.some(item => names.includes(item)));
}

/**
 * A computer call that looked at a window shown in a tab refreshes that tab's last frame (shown until the live view
 * starts, and after it ends). Anything else leaves tabs alone.
 */
export function computerTabRefresh(action: string, input: Readonly<Record<string, unknown>> | undefined, result: {
    readonly ok: boolean; readonly images?: readonly { readonly mimeType: string; readonly data: string }[]
}): { readonly pid: number; readonly windowId: number; readonly frameUrl?: string } | undefined {
    if (!result.ok || action !== 'observeWindow') return undefined;
    const pid = Number(input?.pid), windowId = Number(input?.windowId);
    if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(windowId) || windowId <= 0) return undefined;
    const frame = result.images?.find(image => /^image\/(png|jpeg)$/.test(image.mimeType) && image.data);
    return { pid, windowId, ...(frame ? { frameUrl: `data:${frame.mimeType};base64,${frame.data}` } : {}) };
}

export type AppTabKind = 'messaging' | 'email' | 'browser' | 'meeting' | 'music' | 'video' | 'documents' | 'game' | 'finance' | 'other';

// Whole app names (lower case) as the system shows them, in any of the languages users run. Checked in this order.
const APP_KIND_NAMES: readonly (readonly [AppTabKind, readonly string[]])[] = [
    ['meeting', ['zoom', 'zoom.us', '腾讯会议', 'tencent meeting', 'voov meeting', 'webex', 'google meet', 'facetime', 'facetime通话', 'facetime 通话']],
    ['messaging', ['wechat', 'weixin', '微信', 'qq', 'tim', 'telegram', 'whatsapp', 'signal', 'line', 'messages', '信息', 'slack', 'discord', 'teams',
        'microsoft teams', 'lark', '飞书', 'feishu', 'dingtalk', '钉钉', 'wecom', '企业微信', 'messenger', 'skype', 'kakaotalk', 'viber', 'zalo']],
    ['email', ['mail', '邮件', 'outlook', 'microsoft outlook', 'spark', 'thunderbird', 'foxmail', 'airmail', 'newton', 'gmail', '网易邮箱大师', 'qq邮箱']],
    ['browser', ['safari', 'safari浏览器', 'chrome', 'google chrome', 'firefox', 'edge', 'microsoft edge', 'arc', 'brave', 'opera', 'vivaldi', 'qq浏览器', '360浏览器', '夸克']],
    ['music', ['music', '音乐', 'apple music', 'spotify', 'qq音乐', '网易云音乐', '酷狗音乐', '酷我音乐', '汽水音乐', '全民k歌']],
    ['video', ['tv', 'youtube', 'bilibili', '哔哩哔哩', '哔哩哔哩hd', '优酷', '爱奇艺', '腾讯视频', '芒果tv', '抖音', 'netflix', 'quicktime player', 'iina', 'vlc', 'potplayer',
        '斗鱼 hd', '虎牙直播', '剪映专业版']],
    ['documents', ['word', 'microsoft word', 'excel', 'microsoft excel', 'powerpoint', 'microsoft powerpoint', 'wps office', 'pages', 'numbers', 'keynote', '文稿', '表格',
        '幻灯片', 'notes', '备忘录', 'notion', 'obsidian', 'onenote', 'microsoft onenote', 'textedit', '文本编辑', '腾讯文档', '石墨文档', '便笺', 'stickies']],
    ['game', ['steam', 'wegame', 'epic games launcher', 'battle.net', 'ea app', 'origin', 'games', '游戏', 'qq游戏', '欢乐斗地主', '欢乐麻将', 'playcover', 'chess', '国际象棋']],
    ['finance', ['alipay', '支付宝', 'paypal', 'stocks', '股市', '同花顺', '东方财富', '富途牛牛', 'futu', 'moomoo', '雪球', '招商银行', '工商银行', '建设银行', '中国银行', '农业银行']]
];
// Name parts that give the kind away when the whole name is not listed (QQ音乐, 某某银行, XX Video).
const APP_KIND_HINTS: readonly (readonly [AppTabKind, RegExp])[] = [
    ['meeting', /会议|meeting/], ['music', /音乐|music/], ['video', /视频|影视|video|直播/], ['game', /游戏|game/],
    ['finance', /银行|证券|bank|stock|trading|wallet|钱包/], ['email', /邮箱|邮件|mail/], ['browser', /浏览器|browser/]
];

/**
 * What kind of app a tab holds, from its app name, so the AI can tell when a request names a kind of app rather
 * than an app ("send Xu a message", "play some music") and more than one tab could do it: then it asks which.
 * Messaging names are matched whole (QQ, not QQ音乐).
 */
export function appTabKind(title: string): AppTabKind {
    const name = title.split(' · ')[0].trim().toLowerCase();
    const words = name.split(/[\s._-]+/).filter(Boolean);
    for (const [kind, names] of APP_KIND_NAMES) if (names.some(item => name === item || !item.includes(' ') && item.length > 3 && words.includes(item))) return kind;
    for (const [kind, hint] of APP_KIND_HINTS) if (hint.test(name)) return kind;
    // Short names (QQ, TIM, Line) only as a whole word of a longer name ("QQ · 张三" is handled above by the split).
    for (const [kind, names] of APP_KIND_NAMES) if (names.some(item => item.length <= 3 && words.includes(item))) return kind;
    return 'other';
}
