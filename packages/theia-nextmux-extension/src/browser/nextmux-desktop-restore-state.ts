export const DESKTOP_RESTORE_STATE_KEY = 'nextmux.desktop.restoreState.v1';
export const DESKTOP_RESTORE_STATE_VERSION = 1 as const;

/** Appearance and language live on the account page; microphone lives in System Permissions; the proxy page is retired (system proxy is followed). */
export type DesktopSettingsPanel = 'profile' | 'billing' | 'instructions' | 'models' | 'skills' | 'mcp' | 'plugins'
    | 'permissions' | 'system' | 'privacy' | 'data' | 'import' | 'updates' | 'downloads';

export interface DesktopRestoreState {
    readonly version: typeof DESKTOP_RESTORE_STATE_VERSION;
    readonly section: 'models' | 'coding' | 'comic' | 'settings';
    readonly workspace: string;
    readonly codingPanel: 'thread' | 'pull_requests' | 'sites' | 'scheduled' | 'extensions';
    readonly activeCodingSessionId: string;
    readonly newConversation: boolean;
    readonly settingsPanel: DesktopSettingsPanel;
    readonly billingTab: 'usage' | 'topups' | 'movements';
    readonly modelCenterView: 'all' | 'official' | 'capability' | 'usage' | 'favorites';
    readonly modelCapabilityFilter: 'all' | 'coding' | 'reasoning' | 'image' | 'video' | 'audio' | '3d';
    readonly comicView: 'script' | 'storyboard' | 'workflow' | 'assets' | 'timeline' | 'images' | 'lyrics' | 'song' | 'mv' | 'output';
}

/**
 * Keep a delayed workspace restore from overwriting navigation the user has
 * already changed while startup data is still loading. A missing pending
 * restore stays missing so ordinary persistence cannot create a second
 * restore pass.
 */
export function refreshPendingDesktopRestoreState(
    pending: DesktopRestoreState | undefined,
    current: DesktopRestoreState
): DesktopRestoreState | undefined {
    return pending ? current : undefined;
}

const SECTIONS = ['models', 'coding', 'comic', 'settings'] as const;
const CODING_PANELS = ['thread', 'pull_requests', 'sites', 'scheduled', 'extensions'] as const;
const SETTINGS_PANELS = ['profile', 'billing', 'models', 'skills', 'mcp', 'plugins',
    'permissions', 'system', 'privacy', 'data', 'import', 'updates', 'instructions', 'downloads'] as const;
const BILLING_TABS = ['usage', 'topups', 'movements'] as const;
// Retired ranking/verification pages restore to the public merchant directory.
const MODEL_CENTER_VIEWS = ['all', 'official', 'capability', 'usage', 'favorites'] as const;
const MODEL_CAPABILITY_FILTERS = ['all', 'coding', 'reasoning', 'image', 'video', 'audio', '3d'] as const;
const COMIC_VIEWS = ['script', 'storyboard', 'workflow', 'assets', 'timeline', 'images', 'lyrics', 'song', 'mv', 'output'] as const;

/** Retired provider/media/proxy settings and the merged appearance page open the account page; retired audio settings open System Permissions. */
export function normalizeDesktopSettingsPanel(panel: unknown): DesktopSettingsPanel {
    if (panel === 'audio' || panel === 'voice') return 'system';
    return typeof panel === 'string' && (SETTINGS_PANELS as readonly string[]).includes(panel)
        ? panel as DesktopSettingsPanel
        : 'profile';
}

function valueFrom<const T extends readonly string[]>(values: T, value: unknown, fallback: T[number]): T[number] {
    return typeof value === 'string' && (values as readonly string[]).includes(value) ? value as T[number] : fallback;
}

function boundedString(value: unknown): string {
    return typeof value === 'string' ? value.slice(0, 4_096) : '';
}

function parseObject(raw: string | unknown): Record<string, unknown> | undefined {
    try {
        const value = typeof raw === 'string' ? JSON.parse(raw) as unknown : raw;
        return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
    } catch {
        return undefined;
    }
}

/** Parse the durable v1 state. Unknown versions and malformed records are ignored. */
export function parseDesktopRestoreState(raw: string | unknown): DesktopRestoreState | undefined {
    const value = parseObject(raw);
    if (!value || value.version !== DESKTOP_RESTORE_STATE_VERSION) return undefined;
    const activeCodingSessionId = boundedString(value.activeCodingSessionId);
    return {
        version: DESKTOP_RESTORE_STATE_VERSION,
        section: valueFrom(SECTIONS, value.section, 'coding'),
        workspace: boundedString(value.workspace),
        codingPanel: valueFrom(CODING_PANELS, value.codingPanel, 'thread'),
        activeCodingSessionId,
        newConversation: value.newConversation === true || !activeCodingSessionId,
        settingsPanel: normalizeDesktopSettingsPanel(value.settingsPanel),
        billingTab: valueFrom(BILLING_TABS, value.billingTab, 'usage'),
        modelCenterView: valueFrom(MODEL_CENTER_VIEWS, value.modelCenterView, 'all'),
        modelCapabilityFilter: valueFrom(MODEL_CAPABILITY_FILTERS, value.modelCapabilityFilter, 'all'),
        comicView: valueFrom(COMIC_VIEWS, value.comicView, 'storyboard')
    };
}

/** Normalize the one-shot state written before a locale reload. */
export function parseDesktopReloadState(raw: string | unknown): DesktopRestoreState | undefined {
    const value = parseObject(raw);
    if (!value) return undefined;
    const activeCodingSessionId = boundedString(value.codingSessionId ?? value.activeCodingSessionId);
    return parseDesktopRestoreState({
        version: DESKTOP_RESTORE_STATE_VERSION,
        section: value.section,
        workspace: value.workspaceRoot ?? value.workspace,
        codingPanel: value.codingPanel,
        activeCodingSessionId,
        newConversation: value.newConversation === true || !activeCodingSessionId,
        settingsPanel: value.settingsPanel,
        billingTab: value.billingTab,
        modelCenterView: value.modelCenterView,
        modelCapabilityFilter: value.modelCapabilityFilter,
        comicView: value.comicView
    });
}
