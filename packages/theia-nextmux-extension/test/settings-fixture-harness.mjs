import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const widgetUrl = new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url);

// Production Settings fixture: renderSettings + the settings navigation are
// extracted from the widget source and mounted with every production
// stylesheet; widget services are replaced by in-memory stubs that record calls.
export async function fixtureBundle() {
    const source = await readFile(widgetUrl, 'utf8');
    const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
    const method = name => widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name);
    const statements = method('renderContextPanel').body.statements;
    const buttonIndex = statements.findIndex(statement => ts.isVariableStatement(statement) && statement.getText(file).includes('const settingsButton'));
    assert.ok(buttonIndex > 0, 'settings navigation');
    const nav = statements.slice(buttonIndex).map(statement => statement.getText(file)).join('\n');
    const helpers = ['usageRecordPromptTokens', 'usageRecordTotalTokens'].map(name => file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(file)).join('\n');
    const entry = `import * as React from 'react'; import * as ReactDOM from 'react-dom'; import { createRoot } from 'react-dom/client';
import { NEXTMUX_DESKTOP_LOCALES, desktopText } from './nextmux-locale';
import { localizeDesktopSurface } from './nextmux-surface-locale';
import { ImeInput, ImeTextarea } from './nextmux-ime-field';
import { formatBalanceMicros, walletNetBalanceMicros } from './nextmux-money-format';
import { walletBalanceText } from './nextmux-wallet-balance-text';
import { dynamicLabel } from './nextmux-dynamic-label-locale';
import { incognitoText } from './nextmux-incognito-text';
import { DataLocationSection } from './nextmux-data-location';
import { conversationDisplayTitle } from './nextmux-conversation-domain-locale';
import { ThemePreferenceIcon } from './nextmux-theme-icons';
import { DeviceLinkActions, deviceLinkState, deviceLinkText } from './nextmux-device-link-status';
import { comicCountText, pluginSummaryText } from './nextmux-shell-surface-locale';
import { AnonymousModelsToggle, ModelVisibilitySettings, modelVisibilityCopy } from './nextmux-model-visibility-settings';
import { parseModelVisibilityPreferences, createModelVisibilityCatalog } from './nextmux-model-visibility';
import { linkOpeningText } from './nextmux-link-opening-locale';
import { terminalSurfaceText } from './nextmux-terminal-locale';
import { desktopAccountIdentity } from './nextmux-account-identity';
import { modelUsageText } from './nextmux-model-usage-locale';
import { UsageAnalytics } from './nextmux-usage-analytics';
import { usageAnalyticsText } from './nextmux-usage-analytics-locale';
import { microphoneText } from './nextmux-microphone-locale';
import { CommunitySkillCard } from './nextmux-community-skill-card';
import { InstalledSkillsDialog, InstalledSkillsSummary, SkillLoadErrors } from './nextmux-installed-skills';
import { GitHubAccountSettings } from './nextmux-github-account-panel';
import { communitySkillInstalledLabel, communitySkillListText } from './nextmux-community-skill-locale';
import { skillReadinessText } from './nextmux-skill-readiness-locale';
import { McpAccessPanel } from './nextmux-mcp-access-panel';
import { editorRecoveryText } from './nextmux-editor-recovery-locale';
import { ConversationArchivePanel } from './nextmux-conversation-archive-panel';
import { ComicHistoryArchiveActions, LocalDataDiagnosticAction } from './nextmux-comic-history-archive-actions';
import { MediaHistoryArchiveActions } from './nextmux-media-history-archive-actions';
import { comicExportArchiveText } from './nextmux-comic-export-archive-locale';
import { comicMediaFilesArchiveText } from './nextmux-comic-media-files-archive-locale';
import { archiveUiProjectGroups, localDataActionText } from './nextmux-archive-project-ui';
import { desktopUpdateText } from './nextmux-update-action';
import { RelaySwitchControl, relaySwitchCopy, automaticOptimalText } from './nextmux-relay-switch-control';
import { modelSwitchRouteKey } from '../common/nextmux-model-switch-policy';
import { AgentInstructionsSettings, agentInstructionsText } from './nextmux-agent-instructions-panel';
import { SystemPermissionsSettings, systemPermissionsText } from './nextmux-system-permissions-panel';
import { ConversationImportPanel, importText } from './nextmux-conversation-import-panel';
import { codingSidebarProjects } from './nextmux-sidebar-projects';
import { SYSTEM_NOTIFICATIONS_KEY, systemNotificationsEnabled, taskNotificationText } from './nextmux-task-notification-text';
import { AppPluginsSettings } from './nextmux-app-plugins-view';
import { appPluginText } from './nextmux-app-plugins-locale';
import { appControlText } from './nextmux-app-control';
import { privacyText } from './nextmux-privacy-text';
const APP_PLUGIN_DOCS_URL = 'https://nextmux.app/docs/plugins', APP_PLUGIN_PUBLISH_URL = 'https://nextmux.app/plugins/publish';
const URI = { fromFilePath: path => ({ toString: () => 'file://' + path }) };
const MCP_SERVERS_PREF = 'ai-features.mcp.mcpServers';
const mcpUserCredentialConfigurable = () => true;
${helpers}
const params = new URLSearchParams(location.search), now = Date.now();
const mcpServers = [
  { name: 'filesystem', fingerprint: 'f1', connection: 'npx @modelcontextprotocol/server-filesystem', details: '', local: true, running: true, approved: true, needsReview: false, diagnostic: 'ready', status: 'Running',
    tools: [{ name: 'read_file', description: 'Read a file', fingerprint: 't1', approved: true, supported: true }, { name: 'write_file', description: 'Write a file', fingerprint: 't2', approved: false, supported: true }] },
  { name: 'remote-search', fingerprint: 'f2', connection: 'https://mcp.example.test/sse', details: '', local: false, running: false, approved: true, needsReview: false, diagnostic: 'connection', status: 'Errored',
    failure: { stage: 'connection', code: 'timeout' }, tools: [] },
  { name: 'new-server', fingerprint: 'f3', connection: 'uvx new-server', details: '', local: true, running: false, approved: false, needsReview: true, diagnostic: 'authorization', tools: [] }
];
const platformService = {
  async getAgentInstructions(root) { const file = scope => ({ scope, path: scope === 'personal' ? '/Users/reader/.nextmux/AGENTS.md' : '/work/project/AGENTS.md', exists: scope === 'project', content: scope === 'project' ? '# Project conventions\\n- Use pnpm\\n' : '', sha256: scope, updatedAt: scope === 'project' ? 1790000000000 : null }); return { personal: file('personal'), ...(root ? { project: file('project') } : {}) }; },
  async saveAgentInstructions(request) { return { scope: request.scope, path: '/tmp/AGENTS.md', exists: true, content: request.content, sha256: 'saved', updatedAt: Date.now() }; },
  async getMerchantUsageOverview(q) { return { items: [], range: { since: q.since, until: q.until }, refreshedAt: now }; },
  async getUsageHistory(q) { return { items: [], range: { since: q.since, until: q.until } }; },
  async getMcpAccess() { return mcpServers; }, async reviewMcpAccess() { return mcpServers; }, async changeMcpAccess() { return mcpServers; },
  async exportConversationArchive() { return { status: 'cancelled' }; }, async previewConversationArchive() { return undefined; },
  async prepareConversationArchiveBindings() { return []; }, async importConversationArchive() { return { imported: 0 }; },
  async getGitHubAccount() { return { connected: false, allowAgent: true }; }, async connectGitHubAccount() { return { connected: false, allowAgent: true }; },
  async disconnectGitHubAccount() { return { connected: false, allowAgent: true }; }, async setGitHubAgentAccess() { return { connected: false, allowAgent: true }; }
};
const option = (id, label, output = ['text']) => ({ id, label, providerName: 'Synthetic', output, capabilities: [], popularity: { rank: 1 } });
const skill = (id, name) => ({ id, name, description: 'Review pull requests and summarize risky changes.', repository: 'example/skills', path: 'skills/' + id, sourceId: 'anthropic', sourceName: 'Anthropic',
  homepage: 'https://example.test', version: 'v1', installed: id === 'a', updateAvailable: false,
  metadata: { schemaVersion: 1, license: { status: 'declared', value: 'MIT' }, compatibility: { operatingSystems: { status: 'declared', values: ['darwin', 'linux', 'windows'] }, architectures: { status: 'declared', values: ['arm64', 'x64'] } },
    dependencies: { status: 'unknown', items: [] }, tools: { mode: 'inherit', allowedToolNames: [] }, source: { status: 'verified', repository: 'example/skills', path: 'skills/' + id, revision: 'a'.repeat(40), treeSha: 'b'.repeat(40), blobSha: 'c'.repeat(40), sha256: 'd'.repeat(64) }, issues: [] } });
class FixtureWidget {
  deviceLink = undefined; deviceLinkStarting = false;
  currentDeviceLinkState() { return deviceLinkState({ linked: this.platformSession.linked, starting: this.deviceLinkStarting, expiresAt: this.deviceLink?.expiresAt }); }
  cancelDeviceLink() { (this.calls || []).push(['cancelLink']); this.deviceLink = undefined; this.update(); }
  desktopLocale = params.get('locale') || 'zh-CN'; settingsPanel = params.get('panel') || 'profile'; themePreference = 'system'; calls = [];
  platformSession = { linked: true, user: { id: 'user-1', email: 'reader@example.com', displayName: 'Synthetic Reader' }, wallets: [] };
  platformCatalog = { online: false, offerings: [] };
  deviceLinkError = ''; modelSwitchError = ''; accountOverviewError = ''; accountOverviewLoading = false; billingTab = 'usage';
  accountOverview = { wallets: [{ currency: 'USD', availableMicros: 100000000, reservedMicros: 0, lifetimeSpentMicros: 0, lifetimeCreditedMicros: 100000000 }], topups: [], movements: [], usage: [], refreshedAt: 1 };
  linkOpeningPolicy = { getPreference: () => '' }; terminalRuntime = { profiles: [{ id: 'zsh', label: 'zsh' }], supportStatus: 'supported', platform: 'macos', wslStatus: 'not_applicable' }; terminalRuntimeLoading = false;
  automaticRouting = false; walletTopupStage = 'idle'; modelSwitchDefaultEnabled = false;
  modelSwitchSettings = { get: () => ({ version: 1, revision: 0, mode: 'same_model', fallbackRegistryModelIds: [], merchantScope: 'selected_merchant' }) };
  platformService = platformService; mcpNotificationService = undefined; preferenceService = { get: (_k, d) => d };
  modelVisibility = parseModelVisibilityPreferences(null, {}); globalModels = []; modelVisibilityCatalog = createModelVisibilityCatalog([]);
  globalModelsLoading = false; globalModelsError = ''; modelVisibilityError = '';
  microphonePermission = 'granted'; microphones = [{ deviceId: 'default', label: 'MacBook Pro Microphone' }, { deviceId: 'usb', label: 'USB Audio' }];
  selectedMicrophoneId = 'default'; voiceLevel = 0.35; microphoneTestSession = undefined; voiceError = '';
  communitySkills = { sources: [{ id: 'anthropic', name: 'Anthropic' }], skills: [skill('a', 'code-review'), skill('b', 'pdf-tools'), skill('c', 'frontend-design')], refreshedAt: now, stale: false, message: '' };
  communitySkillQuery = ''; communitySkillSource = 'all'; communitySkillVisibleLimit = 120; communitySkillsLoading = false; communitySkillUrl = ''; communitySkillActionId = '';
  communitySkillsError = ''; skillsError = ''; skillsReady = true; runningMcpServers = [{}]; skillService = { getSkillErrors: () => [] };
  defaultPermissionMode = 'full_access';
  conversationImportScanning = false; conversationImportResults = {}; scanConversationImports() {}
  conversationImportScan = { scannedAt: 1790300000000, sources: [
    { source: 'claude-code', roots: [{ path: '/Users/me/.claude/projects', found: true, readable: true, custom: false }], total: 0, importable: 0, imported: 0, candidates: [] },
    { source: 'claude-cowork', roots: [{ path: '/Users/me/Library/Application Support/Claude/local-agent-mode-sessions', found: false, readable: false, custom: false }], total: 0, importable: 0, imported: 0, candidates: [] },
    { source: 'codex', roots: [{ path: '/Users/me/.codex', found: true, readable: true, custom: false }, { path: '/Volumes/Data/codex-home', found: true, readable: true, custom: true }], total: 3, importable: 2, imported: 1, candidates: [
      { source: 'codex', externalId: 'a', sessionId: 'import-codex-a', title: 'Add rate limiting to the public API', workspacePath: '/Users/me/work/api', createdAt: 1790200000000, updatedAt: 1790290000000, bytes: 1, status: 'new' },
      { source: 'codex', externalId: 'b', sessionId: 'import-codex-b', title: 'Fix flaky login test', workspacePath: '', createdAt: 1790100000000, updatedAt: 1790190000000, bytes: 1, status: 'updated' },
      { source: 'codex', externalId: 'c', sessionId: 'import-codex-c', title: 'Migrate to pnpm workspaces', workspacePath: '/Users/me/work/web', createdAt: 1790000000000, updatedAt: 1790090000000, bytes: 1, status: 'imported' }] },
    { source: 'cursor', roots: [{ path: '/Users/me/Library/Application Support/Cursor/User', found: true, readable: false, custom: false }], total: 0, importable: 0, imported: 0, candidates: [] }] };
  privacySettings = { requireZeroDataRetention: false, denyDataCollection: false, saveConversationHistory: true, saveFileEditorRecovery: true }; privacyDraft = this.privacySettings; privacyStage = 'idle'; privacyError = ''; privacyMessage = '';
  localDataState = { entries: [{ category: 'agent_checkpoints', bytes: 2048, files: 2 }, { category: 'conversation_history', bytes: 409600, files: 12 }, { category: 'conversation_attachments', bytes: 0, files: 0 },
    { category: 'comic_history', bytes: 0, files: 0 }, { category: 'media_jobs', bytes: 0, files: 0 }, { category: 'comic_exports', bytes: 0, files: 0 }] };
  localDataStage = 'idle'; localDataConfirmAction = ''; localDataModalKind = ''; localDataError = ''; localDataMessage = ''; activeWorkspaceRoot = '/Users/me/project'; workspaceOptions = [{ path: '/Users/me/project', label: 'project' }]; instructionsProjectPath = ''; codingSessions = []; codingHistoryProjects = []; activeCodingSessionId = ''; agentStage = 'idle';
  updateState = { phase: 'available', currentVersion: '1.4.0', version: '1.5.0', progress: 0, packaged: true, portable: false, checkedAt: now, nextCheckAt: 0 }; updateBusy = false; updateError = ''; updateMessage = '';
  officialProviderSheet = undefined;
  // Settings → 技能插件 and the 工具权限 close-behavior row (renderSettings reads them).
  appPlugins = []; appPluginsLoading = false; appPluginsError = ''; appPluginsBusy = ''; appPluginsExpanded = ''; appPluginTests = {}; appPluginUninstall = '';
  appPluginsTab = 'installed'; appPluginMarket = { plugins: [], loading: false, error: '', query: '', busy: '', loaded: false }; computerTabCloseBehavior = 'quit';
  appControlAvailable() { return true; } renderAppPluginDialogs() { return null; } guard(_name, render) { return render(); } tabAppCloseBehavior() { return 'desktop'; } setTabAppCloseBehavior() {} loadAppPlugins() {} loadAppPluginMarket() {} getAppPluginFromMarket() {} uploadAppPlugin() {} addAppPluginFolder() {}
  toggleAppPlugin() {} openAppPluginModel() {} requestAppPluginUninstall() {} reloadAppPlugin() {} testAppPlugin() {} setComputerTabCloseBehavior() {}
  tx(key) { return desktopText(this.desktopLocale, key); }
  workspaceSkills() { return [{ name: 'code-review', description: 'Review pull requests', location: '/Users/me/.agents/skills/code-review/SKILL.md' }]; }
  selectedTerminalProfile() { return this.terminalRuntime.profiles[0]; }
  formatMoneyMicros(currency, value) { return new Intl.NumberFormat(this.desktopLocale, { style: 'currency', currency, maximumFractionDigits: 6 }).format(value / 1e6); }
  formatMediaSize(bytes) { return bytes + ' B'; } localStorageSize() { return 1024; }
  settingsModelOptions(workbench) { return workbench === 'coding' ? [option('openai/gpt-5.1', 'GPT-5.1'), option('anthropic/claude-sonnet-4.5', 'Claude Sonnet 4.5')] : [option('google/veo-3.1', 'Veo 3.1', ['video'])]; }
  openSettingsPanel(panel) { this.calls.push(['panel', panel]); this.settingsPanel = panel; this.update(); }
  setDesktopTheme(value) { this.calls.push(['theme', value]); this.themePreference = value; this.update(); }
  setDesktopLocale(value) { this.calls.push(['locale', value]); }
  setDefaultPermissionMode(mode) { this.calls.push(['permission', mode]); this.defaultPermissionMode = mode; this.update(); }
  setPrivacyDraft(patch) { this.privacyDraft = { ...this.privacyDraft, ...patch }; this.update(); }
  savePrivacySettings() { this.calls.push(['privacy']); }
  loadMicrophones(force) { this.calls.push(['microphones', force]); } toggleMicrophoneTest() { this.calls.push(['micTest']); } stopVoiceInput() {} openMicrophonePermissionSettings() {}
  loadCommunitySkills(force) { this.calls.push(['skills', force]); } installCommunitySkillFromUrl() { this.calls.push(['installUrl', this.communitySkillUrl]); }
  installCommunitySkill(id) { this.calls.push(['install', id]); return Promise.resolve(true); } removeCommunitySkill(id) { this.calls.push(['remove', id]); } refreshSkills() {} openContextFile(uri) { this.calls.push(['open', uri]); }
  addMcpServer() { return Promise.resolve(); } editableMcpConfiguration() { return undefined; } updateMcpServer() { return Promise.resolve(); } saveMcpCredential() { return Promise.resolve(mcpServers); }
  mcpUserConfiguration() { return {}; } refreshMcpServers() {}
  setVisibleModels(ids, group, enabled) { this.calls.push(['visible', group, enabled, ids.length]); } loadGlobalModels() {}
  conversationArchiveBusy() { return false; } chooseConversationArchiveDirectory() { return Promise.resolve(undefined); } chooseConversationArchiveFile() { return Promise.resolve(undefined); }
  prepareConversationArchive() { return Promise.resolve(true); } finishConversationArchiveImport() {}
  openLocalDataModal(kind) { this.calls.push(['openModal', kind]); this.localDataModalKind = kind; this.update(); }
  closeLocalDataModal() { this.calls.push(['closeModal']); this.localDataModalKind = ''; this.update(); }
  confirmLocalDataModal() { this.calls.push(['clear', this.localDataModalKind]); this.localDataModalKind = ''; this.update(); }
  clearDesktopDataCategory(category) { this.calls.push(['clear', category]); this.localDataConfirmAction = 'category:' + category; this.update(); }
  clearRendererData(kind) { this.calls.push(['clearRenderer', kind]); } clearDesktopCache() { this.calls.push(['cache']); } loadLocalDataState() { this.calls.push(['localData']); } exportDesktopDiagnostics() { this.calls.push(['diagnostics']); }
  checkForDesktopUpdates() { this.calls.push(['checkUpdate']); } openDesktopDownloadPage() { this.calls.push(['downloadPage']); } downloadDesktopUpdate() { this.calls.push(['downloadUpdate']); }
  renderEditorRecoveryPanel() { return null; }
  setConversationLinkPreference() {} selectTerminalProfile() {} loadTerminalRuntime() {} openAccountPortal() { this.calls.push(['portal']); } openExternalUrl() {} loadAccountOverview() { this.calls.push(['refresh']); }
  selectBillingTab(tab) { this.billingTab = tab; this.update(); } openWalletTopup() { this.calls.push(['topup']); } startDeviceLink() {} setAutomaticRouting(value) { this.calls.push(['auto', value]); this.automaticRouting = value; this.update(); } changeModelSwitchPolicy() {}
  setModelSwitchDefault(value) { this.calls.push(['globalAuto', value]); this.modelSwitchDefaultEnabled = value; this.update(); }
  activeModelRoute() { return undefined; } modelOnlyDisplayName(value) { return value; }
  renderFullAccessConfirmation() { return null; } renderContextAccountDock() { return null; }
  resolvedDesktopTheme() { return params.get('theme') || 'dark'; }
  ${method('renderAutomaticRelaySwitch').getText(file)}
  ${method('renderSettings').getText(file)}
  ${['renderSkillsPanel', 'renderMcpPanel', 'renderAppPluginsPanel'].map(name => method(name).getText(file)).join('\n  ')}
  renderNav() { ${nav} }
  update() { ReactDOM.flushSync(() => root.render(<div className='nmx-desktop-widget' dir={this.desktopLocale === 'ar' ? 'rtl' : 'ltr'} lang={this.desktopLocale}><div className={'nmx-shell fixture-shell nmx-theme-' + this.resolvedDesktopTheme()}>
    {this.renderNav()}<section id='nmx-workspace' className='nmx-workspace'>{this.renderSettings()}</section></div></div>));
    requestAnimationFrame(() => localize(this.desktopLocale)); }
}
function localize(locale) {
  const node = document.querySelector('.nmx-desktop-widget'), walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    if (current.parentElement?.closest('[data-nmx-literal]')) continue;
    const rendered = localizeDesktopSurface(locale, current.data); if (rendered !== current.data) current.data = rendered;
  }
  for (const element of node.querySelectorAll('[placeholder],[title],[aria-label]')) for (const name of ['placeholder', 'title', 'aria-label']) {
    const value = element.getAttribute(name); if (value) { const rendered = localizeDesktopSurface(locale, value); if (rendered !== value) element.setAttribute(name, rendered); }
  }
  document.body.dataset.localized = String(Number(document.body.dataset.localized || 0) + 1);
}
const root = createRoot(document.getElementById('fixture')); const instance = new FixtureWidget(); window.fixture = instance; instance.update();`;
    const { outputFiles } = await desktop('esbuild').build({ stdin: { contents: entry, loader: 'tsx', resolveDir: dirname(fileURLToPath(widgetUrl)), sourcefile: 'settings-all-fixture.tsx' },
        bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'silent',
        alias: { react: core.resolve('react'), 'react/jsx-runtime': core.resolve('react/jsx-runtime'), 'react-dom': core.resolve('react-dom'), 'react-dom/client': core.resolve('react-dom/client'),
            '@theia/core/shared/react': core.resolve('react') } });
    return outputFiles[0].contents;
}

export const PANELS = ['profile', 'billing', 'instructions', 'skills', 'mcp', 'permissions', 'privacy', 'data', 'import', 'models', 'system', 'updates'];
// Production stylesheet order: the widget's own import (model center, loaded
// with the widget module first), then the frontend module's imports.
const frontendModule = await readFile(new URL('../src/browser/nextmux-frontend-module.ts', import.meta.url), 'utf8');
export const CSS = ['nextmux-model-center.css', ...[...frontendModule.matchAll(/import '\.\.\/\.\.\/src\/browser\/style\/([^']+\.css)';/g)].map(match => match[1])];
// Theia paints its own theme variables at runtime (default Dark/Light
// Modern); several settings components consume them, so the fixture supplies
// Theia's default values for the resolved theme.
const THEIA_THEME = {
    dark: { foreground: '#cccccc', descriptionForeground: '#9d9d9d', 'widget-border': '#313131', 'editor-background': '#1f1f1f', 'editorWidget-background': '#202020',
        'input-background': '#313131', 'input-foreground': '#cccccc', 'input-border': '#3c3c3c', 'button-background': '#0078d4', 'button-foreground': '#ffffff',
        'list-hoverBackground': '#2a2d2e', 'panel-border': '#2b2b2b', errorForeground: '#f85149', focusBorder: '#0078d4', 'textLink-foreground': '#4daafc' },
    light: { foreground: '#3b3b3b', descriptionForeground: '#3b3b3b', 'widget-border': '#e5e5e5', 'editor-background': '#ffffff', 'editorWidget-background': '#f8f8f8',
        'input-background': '#ffffff', 'input-foreground': '#3b3b3b', 'input-border': '#cecece', 'button-background': '#005fb8', 'button-foreground': '#ffffff',
        'list-hoverBackground': '#f2f2f2', 'panel-border': '#e5e5e5', errorForeground: '#f85149', focusBorder: '#005fb8', 'textLink-foreground': '#005fb8' }
};
export const THEIA_THEME_CSS = Object.entries(THEIA_THEME).map(([theme, values]) =>
    `body.theia-${theme}{${Object.entries(values).map(([name, value]) => `--theia-${name}:${value}`).join(';')}}`).join('\n');


/** Serves the production settings fixture with every production stylesheet. */
export async function startSettingsFixture() {
    const assets = {
        '/fixture.js': ['text/javascript', await fixtureBundle()],
        '/icons.css': ['text/css', await readFile(core.resolve('@vscode/codicons/dist/codicon.css'))], '/codicon.ttf': ['font/ttf', await readFile(core.resolve('@vscode/codicons/dist/codicon.ttf'))],
        '/': ['text/html', `<!doctype html><html><head><meta charset='utf-8'><link rel='stylesheet' href='/icons.css'>${CSS.map(name => `<link rel='stylesheet' href='/${name}'>`).join('')}
<style>${THEIA_THEME_CSS}
html,body,#fixture,.nmx-desktop-widget{margin:0;width:100%;height:100%;font:13px system-ui}*{box-sizing:border-box}.fixture-shell{display:grid!important;grid-template-columns:minmax(180px,240px) minmax(0,1fr);height:100%}.fixture-shell .nmx-workspace{min-height:0}</style></head><body><div id='fixture'></div><script>document.body.className = 'theia-' + (new URLSearchParams(location.search).get('theme') || 'dark');</script><script src='/fixture.js'></script></body></html>`]
    };
    for (const name of CSS) assets['/' + name] = ['text/css', await readFile(new URL(`../src/browser/style/${name}`, import.meta.url))];
    const server = createServer((request, response) => {
        const asset = assets[new URL(request.url, 'http://127.0.0.1').pathname];
        response.writeHead(asset ? 200 : 404, { 'content-type': asset?.[0] || 'text/plain' }); response.end(asset?.[1] || 'Not found');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const puppeteer = (await import(platform.resolve('puppeteer'))).default;
    return { origin: `http://127.0.0.1:${server.address().port}`, server, puppeteer };
}
