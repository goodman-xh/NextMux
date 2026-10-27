import type { NextMuxDesktopLocale } from './nextmux-locale';
import type { McpServerConfiguration } from '../common/nextmux-mcp-access';

export type NextMuxOpenSourceMcpPreset = {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly sourceUrl: string;
    /** OS where the upstream server can actually control native applications. */
    readonly platforms?: readonly ('darwin' | 'win32' | 'linux')[];
    readonly license: 'MIT' | 'Apache-2.0';
    readonly configuration: McpServerConfiguration;
    readonly fallback?: {
        readonly nextmuxFallbackGroup: string;
        readonly nextmuxFallbackPriority: number;
        readonly nextmuxRetrySafeTools: readonly string[];
    };
};

/**
 * Curated configurations for maintained, open-source MCP servers. They are
 * added as stopped servers and still pass through NextMux's fingerprint,
 * approval, and per-tool permission gates before any process is started.
 */
export const NEXTMUX_OPEN_SOURCE_MCP_PRESETS: readonly NextMuxOpenSourceMcpPreset[] = [
    {
        id: 'playwright', name: 'Microsoft Playwright MCP',
        description: '浏览器自动化与可访问性快照（模型无关） · Apache-2.0，可商用',
        sourceUrl: 'https://github.com/microsoft/playwright-mcp',
        license: 'Apache-2.0',
        configuration: { command: 'npx', args: ['-y', '@playwright/mcp@0.0.80'], nextmuxRuntimePreset: 'playwright' },
        fallback: { nextmuxFallbackGroup: 'browser', nextmuxFallbackPriority: 10, nextmuxRetrySafeTools: ['browser_snapshot', 'browser_tabs', 'snapshot', 'tabs'] }
    },
    {
        id: 'chrome-devtools', name: 'Chrome DevTools MCP',
        description: 'Chrome 调试、网络、性能追踪与页面自动化 · Apache-2.0，可商用',
        sourceUrl: 'https://github.com/ChromeDevTools/chrome-devtools-mcp',
        license: 'Apache-2.0',
        configuration: { command: 'npx', args: ['-y', 'chrome-devtools-mcp@1.9.0', '--no-usage-statistics'], nextmuxRuntimePreset: 'chrome-devtools' },
        fallback: { nextmuxFallbackGroup: 'browser', nextmuxFallbackPriority: 20, nextmuxRetrySafeTools: ['browser_snapshot', 'browser_tabs', 'snapshot', 'tabs'] }
    },
    {
        id: 'qwen-computer-use', name: 'Qwen Open Computer Use',
        description: '跨平台屏幕、窗口与应用控制；支持 macOS、Windows、Linux · MIT，可商用',
        sourceUrl: 'https://github.com/QwenLM/open-computer-use',
        license: 'MIT',
        configuration: { command: 'npx', args: ['-y', '@qwen-code/open-computer-use@0.2.3', 'mcp'], nextmuxRuntimePreset: 'qwen-computer-use' },
        fallback: { nextmuxFallbackGroup: 'desktop', nextmuxFallbackPriority: 10, nextmuxRetrySafeTools: ['get_screen', 'screen', 'list_windows'] }
    },
    {
        id: 'windows-computer-use', name: 'Windows-MCP',
        description: 'Windows 原生 UI、窗口、文件与应用自动化（UI Automation） · MIT，可商用',
        sourceUrl: 'https://github.com/CursorTouch/Windows-MCP',
        platforms: ['win32'],
        license: 'MIT',
        configuration: { command: 'uvx', args: ['windows-mcp', 'serve'], nextmuxRuntimePreset: 'windows-computer-use' },
        fallback: { nextmuxFallbackGroup: 'desktop', nextmuxFallbackPriority: 20, nextmuxRetrySafeTools: ['get_screen', 'screen', 'list_windows'] }
    },
    {
        id: 'macos-automator', name: 'macOS Automator MCP',
        description: 'macOS AppleScript/JXA 应用与系统自动化 · MIT，可商用',
        sourceUrl: 'https://github.com/steipete/macos-automator-mcp',
        platforms: ['darwin'],
        license: 'MIT',
        configuration: { command: 'npx', args: ['-y', '--package', '@steipete/macos-automator-mcp@0.4.7', 'macos-automator-mcp'], nextmuxRuntimePreset: 'macos-automator' },
        fallback: { nextmuxFallbackGroup: 'desktop', nextmuxFallbackPriority: 30, nextmuxRetrySafeTools: ['get_screen', 'screen', 'list_windows'] }
    }
];

/** Hide only explicitly app-owned defaults. Matching a preset does not establish the source of a user's configuration. */
export function isLegacyBuiltInMcpConfiguration(name: string, value: unknown): boolean {
    const preset = NEXTMUX_OPEN_SOURCE_MCP_PRESETS.find(candidate => candidate.id === name);
    if (!preset || !value || typeof value !== 'object' || Array.isArray(value)) return false;
    if ((value as Record<string, unknown>).nextmuxSource !== 'builtin') return false;
    const stable = (input: unknown): string => JSON.stringify(input, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
    return stable(value) === stable({ ...preset.configuration, ...preset.fallback, autostart: false, nextmuxSource: 'builtin' });
}

/**
 * Browser control and computer control are built into NextMux natively, so a
 * curated preset that was placed in the MCP list without the user adding it
 * (no `nextmuxAddedAt`) duplicates a built-in feature. It stays dormant and is
 * hidden; adding the preset explicitly from the catalogue shows it again.
 */
export function isRetiredPresetConfiguration(name: string, value: unknown): boolean {
    const preset = NEXTMUX_OPEN_SOURCE_MCP_PRESETS.find(candidate => candidate.id === name);
    if (!preset || !value || typeof value !== 'object' || Array.isArray(value)) return false;
    const { nextmuxSource: _source, ...record } = value as Record<string, unknown>;
    if (_source !== undefined && _source !== 'user' && _source !== 'builtin') return false;
    const stable = (input: unknown): string => JSON.stringify(input, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
    // Exactly the curated template (any edit, env, credential or autostart makes it the user's own).
    return stable(record) === stable({ ...preset.configuration, ...preset.fallback, autostart: false })
        || stable(record) === stable({ ...preset.configuration, autostart: false });
}

export function isHiddenPresetConfiguration(name: string, value: unknown): boolean {
    return isLegacyBuiltInMcpConfiguration(name, value) || isRetiredPresetConfiguration(name, value);
}

export function openSourceMcpPresetText(locale: NextMuxDesktopLocale): { title: string; body: string; add: string; added: string } {
    if (locale === 'zh-CN') return { title: '可选的开源 MCP', body: '浏览器控制和电脑控制已内置并默认可用，无需添加。下面是可选的扩展：添加后会出现在列表中，由你启动或停止，工具权限仍需逐项允许。', add: '添加', added: '已添加' };
    if (locale === 'zh-TW') return { title: '選用的開源 MCP', body: '瀏覽器控制與電腦控制已內建並預設可用，不需新增。以下為選用擴充：新增後會出現在列表中，由你啟動或停止，工具權限仍需逐項允許。', add: '新增', added: '已新增' };
    if (locale === 'ja') return { title: '公式オープンソース MCP', body: 'オープンソースサーバーを追加します。起動とツール権限は個別に許可します。', add: '追加', added: '設定済み' };
    if (locale === 'ko') return { title: '공식 오픈 소스 MCP', body: '오픈 소스 서버를 추가합니다. 시작과 도구 권한은 별도로 승인합니다.', add: '추가', added: '구성됨' };
    return { title: 'Optional open-source MCP', body: 'Browser control and computer control are built in and always available. These are optional extras: once added they appear in your list, where you start and stop them, and each tool still needs your approval.', add: 'Add', added: 'Added' };
}
