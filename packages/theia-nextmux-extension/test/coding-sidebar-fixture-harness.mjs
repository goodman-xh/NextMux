import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const widgetUrl = new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url);
const frontendModuleUrl = new URL('../src/browser/nextmux-frontend-module.ts', import.meta.url);

// Production coding sidebar: renderContextPanel (coding branch), the session
// dialogs, ordering, drag sorting, surface dismissal and the DOM localization
// pass are extracted from the widget source and mounted with every production
// stylesheet. Services are in-memory stubs; no RPC, profile or model runs.
const METHODS = ['renderContextPanel', 'conversationNotice', 'renderCodingSessionDialogs', 'renderBrandMark', 'orderedCodingSessions', 'codingSessionActivityAt', 'codingSessionRunStartedAt',
    'codingSessionHoverText', 'handleCodingSessionDragOver', 'reorderCodingSession', 'toggleCodingSessionMenu', 'beginCodingSessionRename',
    'closeNavigationSurface', 'completeNavigationSurface', 'dismissTopSurface', 'hasDismissibleSurface', 'hasTransientNavigationSurface',
    'sameNavigationLocation', 'handleSurfaceEscape', 'rememberNavigation', 'clearNavigationSurfaces', 'navigationSurface', 'navigationSnapshot',
    'navigationSnapshotKey', 'navigationSurfaceKey', 'trapDialogFocus', 'localizeRenderedSurface', 'tx'];

export async function sidebarFixtureBundle() {
    const source = await readFile(widgetUrl, 'utf8');
    const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
    const methods = METHODS.map(name => {
        const member = widget.members.find(node => (ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node)) && node.name.getText(file) === name);
        assert.ok(member, name);
        return member.getText(file);
    }).join('\n');
    const entry = `import * as React from 'react'; import { createRoot } from 'react-dom/client'; import { flushSync } from 'react-dom';
import { Virtuoso } from 'react-virtuoso';
import { desktopText } from './nextmux-locale';
import { localizeDesktopSurface } from './nextmux-surface-locale';
import { ImeInput, ImeTextarea } from './nextmux-ime-field';
import { formatBalanceMicros } from './nextmux-money-format';
import { ThemePreferenceIcon } from './nextmux-theme-icons';
import { DeviceLinkActions, deviceLinkState, deviceLinkText } from './nextmux-device-link-status';
import { comicCountText, pluginSummaryText } from './nextmux-shell-surface-locale';
import { forEachSurfaceTextNode, isSurfaceLiteral } from './nextmux-surface-walk';
import { codingProjectPathKey, codingSidebarProjects } from './nextmux-sidebar-projects';
import { conversationAttentionLabel } from './nextmux-conversation-attention';
import { FadePresence } from './nextmux-conversation-stream';
import { terminalSurfaceText } from './nextmux-terminal-locale';
import { conversationText } from './nextmux-conversation-locale';
import { compactConversationId } from './nextmux-conversation-identity';
import { archiveProjectText } from './nextmux-archive-project-locale';
import { conversationTimeLabel } from './nextmux-conversation-time';
import { latestConversationMessageTime } from './nextmux-conversation-message-time';
import { conversationDisplayTitle } from './nextmux-conversation-domain-locale';
import { runHistoryLabel } from './nextmux-run-history-panel';
import { productMenuText } from './nextmux-product-menu-locale';
import { projectMemoryText } from './nextmux-project-memory-locale';
import { projectMenuText } from './nextmux-project-menu';
import { modelCenterText } from './nextmux-model-center-locale';
import { modelUsageText } from './nextmux-model-usage-locale';
import { modelVisibilityCopy } from './nextmux-model-visibility-settings';
import { incognitoText } from './nextmux-incognito-text';
import { agentInstructionsText } from './nextmux-agent-instructions-panel';
import { FlipList } from './nextmux-motion';
const CouncilSidebarSubConversations = () => null;
const conversationCheckpointIdsToRestore = () => [];
const params = new URLSearchParams(location.search), now = Date.UTC(2026, 8, 24, 9, 0);
const turn = (id, minutes, stage = 'complete') => ({ id, prompt: 'p', response: 'r', stage, createdAt: now - minutes * 60_000, completedAt: stage === 'running' ? undefined : now - minutes * 60_000 + 1000 });
const session = (id, title, workspacePath, minutes, extra = {}) => ({ id, title, workspacePath, createdAt: now - minutes * 60_000 - 5_000, updatedAt: now - minutes * 60_000,
  turns: [turn(id + '-t', minutes, extra.stage)], pinned: false, ...extra });
class FixtureWidget {
  desktopLocale = params.get('locale') || 'zh-CN'; activeSection = 'coding'; codingPanel = 'thread';
  node = document.getElementById('fixture-root'); localizedTextNodes = new WeakMap(); localizedAttributes = new WeakMap();
  localizationMutationSuppressionGeneration = 0; localizationMutationSuppressed = false;
  codingSessions = [
    session('s-run', '重构支付模块的回调重试逻辑', '/work/nextmux', 30, { stage: 'running' }),
    session('s-a', '修复侧栏拖动排序', '/work/nextmux', 5),
    session('s-b', 'Add Arabic RTL support to the settings page and verify every drawer', '/work/nextmux', 60),
    session('s-c', '检查终端输出乱码', '/work/nextmux', 180),
    session('s-pin', '发布前检查清单', '/work/site', 400, { pinned: true }),
    session('s-d', '首页性能优化', '/work/site', 20),
    session('s-r1', '随手问：正则表达式', '', 2),
    session('s-r2', 'Quick question about CSS grid', '', 90)
  ];
  activeCodingSessionId = 's-a'; workspaceOptions = [{ path: '/work/nextmux', label: 'nextmux' }, { path: '/work/site', label: 'site' }];
  codingHistoryProjects = []; hiddenProjectPaths = new Set(); expandedCodingProjects = new Set(['/work/nextmux', '/work/site']);
  expandedProjectConversationLists = new Set(); codingSessionPageCursors = new Map(); codingSessionPagesLoading = new Set();
  codingHistoryProjectsCursor = ''; codingHistoryProjectsLoading = false; codingSessionOrder = []; codingSessionOrderUpdatedAt = 0;
  removedCodingSessionIds = new Set(); codingSessionDragId = ''; codingSessionDragOver = undefined; projectDragActive = false;
  codingProjectDragPath = ''; codingProjectDragOver = undefined; activeCouncilChildId = ''; councilVisibilityController = undefined; instructionsProjectPath = '';
  projectHighlightPath = ''; projectMenuPath = ''; projectDeletePath = ''; projectDeleteBusy = false; projectDeleteConversations = false; projectDeleteError = '';
  codingSearchOpen = false; codingSearchQuery = ''; codingSearchResultQuery = ''; codingSearchMatches = new Map(); codingSearchRequestToken = 0;
  codingSessionMenuId = ''; codingSessionRenameId = ''; codingSessionRenameValue = ''; codingSessionDeleteId = ''; codingPopover = '';
  notifications = [{ id: 'n1', kind: 'success', title: '任务已完成', body: '修复侧栏拖动排序', createdAt: now, read: false }];
  scheduledTasks = []; activeScheduledTaskId = ''; runningMcpServers = []; accountMenuOpen = false; navigationBackStack = []; navigationForwardStack = [];
  pendingTurnEdit = undefined; turnEditRestorePreview = { status: 'idle' }; turnEditRestoreWorkspace = false; turnEditSubmitting = false; turnEditError = '';
  turnCopyMenuId = ''; conversationWindowMenuOpen = false; workContextOpen = false; calls = [];
  sidebarFlip = new FlipList({ selector: '.nmx-project-tree[data-project-tree], .nmx-session-row[data-session-id]',
    keyOf: el => el.dataset.projectTree ? 'project:' + el.dataset.projectTree : el.dataset.sessionId ? 'session:' + el.dataset.sessionId : undefined,
    ignoreWithin: '.nmx-session-virtual-list' });
  conversationReads = { notice: (id, latest) => id === 's-c' ? { kind: 'completed' } : id === 's-d' ? { kind: 'permission' } : undefined,
    unread: notice => notice?.kind === 'completed' };
  workspaceSkills() { return []; } activeCodingSession() { return this.codingSessions.find(s => s.id === this.activeCodingSessionId); }
  isCodingSessionTurnRunning(_session, turn) { return turn.stage === 'running'; } conversationHasActiveRun() { return false; }
  orderedCodingProjects(projects) { return projects; } sessionCouncilRoleChildren() { return []; } openCouncilRoleSubConversation() {}
  notificationPriceText() { return undefined; } handleCodingProjectDragOver() {} reorderCodingProject() {}
  requestNewCodingConversation(incognito) { if (incognito) this.createIncognitoCodingSession(); else this.startNewCodingTask(); }
  createIncognitoCodingSession() { this.record('createIncognitoCodingSession'); }
  conversationHistoryReady() { return true; } codingSessionListHasMore() { return false; }
  renderContextAccountDock() { return <footer className='nmx-context-account-dock'><button className='nmx-account-trigger'><span className='nmx-account-avatar is-linked'>R</span><span className='nmx-account-trigger-copy'><strong>reader@example.com</strong></span><i className='codicon codicon-settings-gear'></i></button></footer>; }
  projectDragContainsFolders(event) { return event.dataTransfer.types.includes('Files'); }
  record(name, ...args) { this.calls.push([name, ...args]); this.update(); }
  openCodingSession(id) { this.activeCodingSessionId = id; this.record('openCodingSession', id); }
  openCodingSearch() { this.rememberNavigation(); this.clearNavigationSurfaces(); this.codingSearchOpen = true; this.update(); }
  setCodingSearchQuery(q) { this.codingSearchQuery = q; const query = q.trim();
    // Synthetic index: case-insensitive title match, as the global search returns.
    this.codingSearchResultQuery = query; this.codingSearchMatches = new Map(this.codingSessions.filter(s => query && s.title.toLowerCase().includes(query.toLowerCase())).map(s => [s.id, { kind: 'content', snippet: s.title }]));
    this.update(); }
  toggleCodingSessionPin(id) { const menu = this.codingSessionMenuId; this.codingSessions = this.codingSessions.map(s => s.id === id ? { ...s, pinned: !s.pinned } : s); if (menu === id) this.completeNavigationSurface(); this.update(); }
  toggleCodingPopover(p) { if (this.codingPopover === p) { this.closeNavigationSurface(); return; } this.rememberNavigation(); this.clearNavigationSurfaces(); this.codingPopover = p; this.update(); }
  clearNotifications() { this.notifications = []; this.update(); }
  startNewCodingTask() { this.record('startNewCodingTask'); } selectCodingPanel(p) { this.codingPanel = p; this.update(); }
  openSettingsPanel(p) { this.record('openSettingsPanel', p); } commandOpenWebsite() { this.record('commandOpenWebsite'); }
  handleProjectDrop(event) { event.preventDefault(); this.projectDragActive = false; this.record('handleProjectDrop'); }
  openProjectMenu(path) { this.clearNavigationSurfaces(); this.projectMenuPath = path; this.update(); }
  closeProjectDialog() { this.projectMenuPath = ''; this.projectDeletePath = ''; this.update(); }
  selectWorkspaceRoot() {} toggleCodingProject(path) { if (this.expandedCodingProjects.has(path)) this.expandedCodingProjects.delete(path); else this.expandedCodingProjects.add(path); this.update(); }
  openCodingSessionForWorkspace(path) { this.record('openCodingSessionForWorkspace', path); }
  tileCodingSession(id) { this.record('tileCodingSession', id); } tileProjectConversations(path) { this.record('tileProjectConversations', path); }
  branchCodingSession(id) { this.record('branchCodingSession', id); } copyToClipboard(v) { this.record('copyToClipboard', v); }
  deleteCodingSession(id) { this.completeNavigationSurface(); this.codingSessions = this.codingSessions.filter(s => s.id !== id); this.update(); }
  confirmCodingSessionRename() { const title = this.codingSessionRenameValue.trim(); const id = this.codingSessionRenameId; this.codingSessions = this.codingSessions.map(s => s.id === id ? { ...s, title } : s); this.completeNavigationSurface(); this.update(); }
  setProjectConversationListExpanded(path, expanded) { if (expanded) this.expandedProjectConversationLists.add(path); else this.expandedProjectConversationLists.delete(path); this.update(); }
  loadNextCodingSessionsPage() {} loadNextCodingHistoryProjects() {} chooseDraftWorkspace() { this.record('chooseDraftWorkspace'); } persistCodingSessions() { this.calls.push(['persist']); }
  closeModelEffortPickerImmediately() {} resetWalletTopupSurface() {} clearOfficialProviderSurface() {} currentCodingSessionViewState() { return {}; }
  dismissComposerPicker() { this.codingPopover = ''; } focusTurnEditor() {} dismissTurnEditConfirmation() { this.pendingTurnEdit = undefined; this.update(); }
  closeContextFilePreview() {} navigateBack() { this.calls.push(['navigateBack']); }
  update() { flushSync(() => root.render(<div className={'nmx-shell fixture-shell nmx-theme-' + (params.get('theme') || 'dark')}>{this.renderContextPanel()}{this.renderCodingSessionDialogs()}<main className='nmx-workspace'></main></div>)); this.localizeRenderedSurface(); }
  ${methods}
}
const root = createRoot(document.getElementById('fixture-root'));
const instance = new FixtureWidget(); window.fixture = instance; instance.update();
window.addEventListener('keydown', instance.handleSurfaceEscape);`;
    const { outputFiles } = await desktop('esbuild').build({ stdin: { contents: entry, loader: 'tsx', resolveDir: dirname(fileURLToPath(widgetUrl)), sourcefile: 'coding-sidebar-fixture.tsx' },
        bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'silent',
        alias: { react: core.resolve('react'), 'react/jsx-runtime': core.resolve('react/jsx-runtime'), 'react-dom': core.resolve('react-dom'), 'react-dom/client': core.resolve('react-dom/client'),
            '@theia/core/shared/react': core.resolve('react'), '@theia/core/shared/react-dom': core.resolve('react-dom') } });
    return outputFiles[0].contents;
}

/** Every stylesheet the production frontend module imports, in its order. */
export async function productionStylesheets() {
    const moduleSource = await readFile(frontendModuleUrl, 'utf8');
    return [...moduleSource.matchAll(/import '\.\.\/\.\.\/src\/browser\/style\/([\w.-]+\.css)';/g)].map(match => match[1]);
}

export async function startSidebarFixture() {
    const css = await productionStylesheets();
    const assets = {
        '/fixture.js': ['text/javascript', await sidebarFixtureBundle()],
        '/icons.css': ['text/css', await readFile(core.resolve('@vscode/codicons/dist/codicon.css'))], '/codicon.ttf': ['font/ttf', await readFile(core.resolve('@vscode/codicons/dist/codicon.ttf'))],
        '/': ['text/html', `<!doctype html><html><head><meta charset='utf-8'><link rel='stylesheet' href='/icons.css'>${css.map(name => `<link rel='stylesheet' href='/${name}'>`).join('')}
<style>html,body,.nmx-desktop-widget{margin:0;width:100%;height:100%;font:13px system-ui}#fixture-root{height:100%}*{box-sizing:border-box}.fixture-shell{display:grid!important;grid-template-columns:276px minmax(0,1fr)!important;height:100%}.fixture-shell .nmx-context-panel{position:relative}</style></head>
<body><div class='nmx-desktop-widget'><div id='fixture-root'></div></div><script src='/fixture.js'></script></body></html>`]
    };
    for (const name of css) assets['/' + name] = ['text/css', await readFile(new URL(`../src/browser/style/${name}`, import.meta.url))];
    const server = createServer((request, response) => {
        const asset = assets[new URL(request.url, 'http://127.0.0.1').pathname];
        response.writeHead(asset ? 200 : 404, { 'content-type': asset?.[0] || 'text/plain' }); response.end(asset?.[1] || 'Not found');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const puppeteer = (await import(platform.resolve('puppeteer'))).default;
    return { origin: `http://127.0.0.1:${server.address().port}`, server, puppeteer };
}
