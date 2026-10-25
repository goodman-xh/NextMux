import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { productionStylesheets } from './coding-sidebar-fixture-harness.mjs';

const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const widgetUrl = new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url);

// Production coding workbench (conversation + composer + its popovers and
// dialogs) extracted from the widget and mounted with every production
// stylesheet. Host services, model routing and the transcript renderers that
// other suites own are small stubs; unknown action methods become no-ops that
// are recorded, so a click on any control is observable without RPC.
const METHODS = ['renderModelFailureAction', 'renderCodingWorkbench', 'renderAttachmentPopoverPortal', 'renderFullAccessConfirmation', 'renderCodingSessionDialogs',
    'renderTurnMessageMenuItems', 'permissionLabel', 'composerRows', 'calculateModelPickerPlacement', 'projectQuestion', 'renderBrandMark',
    'setPermissionMode', 'toggleCodingPopover', 'closeNavigationSurface', 'completeNavigationSurface', 'dismissTopSurface', 'hasDismissibleSurface',
    'hasTransientNavigationSurface', 'sameNavigationLocation', 'handleSurfaceEscape', 'rememberNavigation', 'clearNavigationSurfaces',
    'navigationSurface', 'navigationSnapshot', 'navigationSnapshotKey', 'navigationSurfaceKey', 'trapDialogFocus', 'localizeRenderedSurface', 'tx',
    'confirmFullAccess', 'handleComposerKeyDown', 'composerInputOwner', 'composerInputKey', 'ownsComposerInput', 'toggleTurnMessageMenu', 'closeTurnMessageMenu', 'handleTurnMessageMenuKeyDown',
    'runningDirectionBlocker', 'runningComposerShortcut', 'composerApps', 'composerAppPicking', 'composerApp', 'pickComposerApp', 'setComposerApp', 'rememberAppIcon', 'removeComposerApp', 'appControlAvailable',
    'reasoningDepthChoicesForRoute', 'activeReasoningDepthId', 'reasoningDepthLabel', 'rememberedRouteLabel'];

export async function workbenchFixtureBundle() {
    const source = await readFile(widgetUrl, 'utf8');
    const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
    const methods = METHODS.map(name => {
        const member = widget.members.find(node => (ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node)) && node.name.getText(file) === name);
        assert.ok(member, name);
        return member.getText(file);
    }).join('\n');
    const helper = name => file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(file);
    const entry = `import * as React from 'react'; import * as ReactDOM from 'react-dom'; import { createRoot } from 'react-dom/client'; import { flushSync } from 'react-dom';
import { Virtuoso } from 'react-virtuoso';
import { desktopText } from './nextmux-locale';
import { localizeDesktopSurface } from './nextmux-surface-locale';
import { ImeInput, ImeTextarea } from './nextmux-ime-field';
import { SurfaceTooltips } from './nextmux-surface-tooltips';
import { formatBalanceMicros } from './nextmux-money-format';
import { ThemePreferenceIcon } from './nextmux-theme-icons';
import { DeviceLinkActions, deviceLinkState, deviceLinkText } from './nextmux-device-link-status';
import { comicCountText, pluginSummaryText } from './nextmux-shell-surface-locale';
import { officialConnectionRelayKey, partitionModelPickerCandidates } from './nextmux-model-route-selection';
import { normalizeModelCitations } from '@nextmux/agent-runtime/citations';
import { narrowAgentPermission } from '@nextmux/agent-runtime/permission';
import { userQueuedPrompts, appendAgentActivityEvents, userCancelledActivityEvents, finalTextAlreadyInActivity } from './nextmux-agent-activity';
import { activeRunBelongsToSession, agentManualResumeStrategy } from './nextmux-agent-task-queue';
import { runningTaskText } from './nextmux-running-task-locale';
import { runningPermissionTiming } from './nextmux-permission-timing';
import { modelPickerEvidenceText, modelPickerListText, relayMultiplierTag, relayMultiplierText, relayPercentText } from './nextmux-relay-picker';
import { reasoningDepthChoices } from '../common/nextmux-model-controls';
import { reasoningOptionKey } from '@nextmux/model-runtime/reasoning-evidence';
import { reasoningControlText } from './nextmux-reasoning-controls-locale';
import { reasoningDepthChoicesForDisplay } from './nextmux-reasoning-depth-presentation';
import { measuredModelFidelity, measuredRelayAuthenticity, measuredRelayQuality } from '../common/nextmux-relay-evidence';
import { relayText } from './nextmux-relay-locale';
import { contextBudgetText } from './nextmux-context-budget-locale';
import { contextWindowTokenLabel } from '../common/nextmux-context-budget';
import { agentChildText } from './nextmux-agent-child-locale';
import { historyReadinessText } from './nextmux-history-readiness-locale';
import { goalScheduleText } from './nextmux-goal-schedule-locale';
import { forEachSurfaceTextNode, isSurfaceLiteral } from './nextmux-surface-walk';
import { filesChangedLabel } from './nextmux-files-changed-label';
import { hasRunningAgentCommand } from './nextmux-agent-command-log';
import { TurnDuration } from './nextmux-turn-duration';
import { conversationErrorText, conversationErrorDetail } from './nextmux-conversation-stream-model';
import { modelFailure, modelFailureSource } from './nextmux-model-errors';
import { goalTurnPresentation } from './nextmux-goal-presentation';
import { answerCitations, CitationList, ArchivedChildCitations } from './nextmux-citations';
import { agentRouteEvidencePresentation } from './nextmux-agent-route-evidence';
import { conversationText } from './nextmux-conversation-locale';
import { conversationMessageId, conversationCheckpointIdsToRestore, withoutReplayedContextNote } from './nextmux-conversation-branch';
import { StreamNotice, StreamStatusRow } from './nextmux-conversation-stream';
import { agentOutcomeText, runtimeFinalText } from './nextmux-agent-outcome-locale';
import { conversationStreamText } from './nextmux-conversation-stream-locale';
import { NextMuxChangeReview } from './nextmux-change-review';
import { AppControlGlyph, AppControlIcon, ComposerAppChip, TurnAppChip, appControlText } from './nextmux-app-control';
import { relayMarketplaceText } from './nextmux-relay-marketplace-locale';
import { AgentQuestionPanel } from './nextmux-agent-question-panel';
import { relaySwitchCopy, automaticOptimalText } from './nextmux-relay-switch-control';
import { modelVisibilityCopy } from './nextmux-model-visibility-settings';
import { workbenchText } from './nextmux-workbench-locale';
import { ComposerClearance } from './nextmux-composer-clearance';
import { ComposerInputScope } from './nextmux-composer-input-scope';
import { SystemDictationHint, systemDictationCopy, shouldSubmitComposerKey } from './nextmux-system-dictation';
import { DictationButton } from './nextmux-dictation-button';
import { managedPriceText } from './nextmux-managed-price-text';
import { councilModeText } from './nextmux-council-mode-locale';
import { pastedTextReferencesInDocument } from './nextmux-composer-long-paste';
import { removeAdjacentComposerLink } from './nextmux-markdown';
import { imageLightboxText, imageLightboxPercentage } from './nextmux-image-lightbox';
import { linkOpeningText } from './nextmux-link-opening-locale';
import { RunHistoryPanel } from './nextmux-run-history-panel';
import { placeAnchoredFloatingPanel, placeModelPickerPanels } from './nextmux-floating-panel';
import { codingSidebarProjects } from './nextmux-sidebar-projects';
import { projectMenuText } from './nextmux-project-menu';
${helper('isInsufficientBalanceFailure')}
const ROUTE_LABELS_STORAGE_KEY = 'nextmux.desktop.routeLabels.v1';
import { projectFolderOpenText, projectPathLabel } from './nextmux-project-path';
const params = new URLSearchParams(location.search), now = Date.UTC(2026, 8, 24, 9, 0);
const turn = (id, prompt, response, extra = {}) => ({ id, prompt, response, stage: 'complete', createdAt: now - 60_000, completedAt: now - 30_000,
  routeLabel: '', executionLabel: '', usageLabel: '', events: [], ...extra });
const route = { id: 'r1', kind: 'official_connection', connection: { id: 'c1', label: 'OpenAI', model: 'gpt-5', modelFamily: 'gpt' } };
class FixtureWidget {
  desktopLocale = params.get('locale') || 'zh-CN'; activeSection = 'coding'; codingPanel = 'thread'; node = document.getElementById('fixture-root');
  localizedTextNodes = new WeakMap(); localizedAttributes = new WeakMap(); localizationMutationSuppressionGeneration = 0; localizationMutationSuppressed = false;
  codingSessions = params.has('empty') ? [] : [{ id: 's1', title: '修复侧栏拖动排序', workspacePath: '/work/nextmux', createdAt: now - 90_000, updatedAt: now,
    turns: [turn('t1', '侧栏拖动排序后，新消息的对话没有排到最前面。', '已定位：拖动后顺序被完全固定。我会让拖动后有新消息的对话重新浮到顶部。'),
      turn('t2', 'Also check the Arabic layout of the row menu.', 'Done — the menu now opens toward the inline end in RTL.')] }];
  activeCodingSessionId = params.has('empty') ? '' : 's1'; globalCodingDraft = params.has('empty'); draftWorkspaceRoot = '/work/nextmux';
  workspaceOptions = [{ path: '/work/nextmux', label: 'nextmux' }]; codingHistoryProjects = []; agentWorkbench = 'coding'; agentStage = params.get('stage') || 'idle';
  activeAgentSessionId = params.get('stage') === 'running' ? 's1' : ''; activeAgentTurnId = params.get('stage') === 'running' ? 't2' : ''; activeAgentRunId = '';
  agentResult = undefined; agentError = ''; submittedPrompt = ''; agentStopping = false; agentCancelRequested = false; runningMessageSubmitting = false;
  lastRunPermissionMode = 'workspace_write'; permissionMode = params.get('permission') || 'workspace_write'; defaultPermissionMode = 'full_access';
  activeModelRouteId = 'r1'; activeRelayKey = 'official:c1'; reasoningEffort = 'medium'; automaticRouting = false; selectedModelIds = { coding: 'gpt-5' };
  merchantCatalogStatus = 'ready'; merchantCatalogError = ''; catalogLoading = false; catalogRestLoading = false; platformCatalog = { online: true, offerings: [] }; officialModels = { connections: [], providers: [] };
  officialPickerValidations = new Set(); officialPickerValidationFailures = new Set(); officialBusyConnectionId = ''; officialConnectionStage = 'idle';
  modelPickerRelayOpen = false; modelPickerEffortModelId = ''; modelPickerEffortPlacement = undefined; codingPopover = ''; followUpTaskMenuId = '';
  prompt = params.get('prompt') || ''; composerComposing = false; composerDragActive = false; composerUiUpdateTimer = undefined;
  composerInputScope = new ComposerInputScope(); composerTextareaRef = React.createRef(); composerMarkdownOverlayRef = React.createRef(); threadVirtuosoRef = React.createRef();
  attachments = []; pastedTextReferences = []; attachmentError = ''; balanceNoticeDismissedTurnId = ''; voiceError = ''; composerNotifications = []; systemDictationHelpOpen = false;
  systemDictationTarget = 'unavailable'; nativeDictation = undefined; nativeDictationPhase = 'idle'; microphoneSystemPermission = undefined;
  attachmentLightbox = { isOpen: false }; pendingConversationLinkTarget = ''; rememberConversationLinkChoice = false; codingSessionRunHistoryId = '';
  scheduledAgentRuns = new Map(); relayFeedbackSubmittingVotes = new Map(); turnAttachmentPayloads = new Map(); tiledCodingSessionIds = new Set();
  liveAgentEvents = []; liveAgentChildren = []; scheduledTasks = []; runningMcpServers = []; activeScheduledTaskId = ''; restoringCheckpointId = '';
  threadAwayFromBottom = false; threadUnseenUpdates = 0; threadFocusActive = false; terminalDrawerOpen = false; workContextOpen = false; workContextMode = 'browser';
  editingTurnId = ''; editingTurnValue = ''; turnCopyMenuId = ''; turnMessageMenuTrigger = undefined; copiedIndicatorKey = ''; goalComposerActive = false; goalComposerSessionId = '';
  conversationHistoryLoadFailed = false; conversationHistoryLoadPromise = undefined; detachedConversationId = ''; navigationBackStack = []; navigationForwardStack = [];
  fullAccessConfirmationOpen = false; fullAccessConfirmationTarget = 'current'; pendingTurnEdit = undefined; turnEditRestorePreview = { status: 'idle' };
  turnEditRestoreWorkspace = false; turnEditSubmitting = false; turnEditError = ''; codingSessionRenameId = ''; codingSessionDeleteId = ''; codingSessionMenuId = '';
  projectDeletePath = ''; projectMenuPath = ''; accountMenuOpen = false; codingSearchOpen = false; conversationWindowMenuOpen = false; hiddenProjectPaths = new Set();
  conversationDirectoriesSessionId = ''; conversationDirectoriesBusy = false; conversationDirectoriesError = ''; calls = [];
  modelRoutes() { return [route]; } routesForRelay() { return [route]; } codingModelOptions() { return []; } modelKeyForRoute() { return 'gpt-5'; }
  relayOption(key) { return key ? { key, kind: 'official', label: 'OpenAI' } : undefined; } selectedModelOption() { return { id: 'gpt-5', label: 'GPT-5' }; }
  modelReasoningContract() { return undefined; } localReasoningEvidence() { return undefined; } reasoningSettingsForRoute() { return {}; } modelListedAsMore() { return false; } fitModelEffortMenu() {}
  reasoningEffortLevels() { return ['low', 'medium', 'high']; } reasoningEffortLabel(level) { return ({ low: '低', medium: '中', high: '高' })[level] || level; }
  activeCodingSession() { return this.codingSessions.find(s => s.id === this.activeCodingSessionId); } activeCodingGoal() { return undefined; }
  activeWorkspace() { return this.workspaceOptions[0]; } workspaceRootIsOpen() { return true; } conversationHistoryReady() { return true; }
  currentAgentQuestionState() { return { runId: '', questions: { visible: () => undefined, draft: undefined, isSubmitting: () => false, edit: () => false } }; }
  hasPendingAttachmentImports() { return false; } hasPendingDraftAttachments() { return false; } hasUnresolvedDraftAttachments() { return false; }
  unsupportedAttachments() { return []; } routeSupportsAttachment() { return true; } isModelVisible() { return true; } workspaceSkills() { return []; }
  isCheckpointRestored() { return false; } formatConversationTime() { return '09:00'; } assistantMessageCopyText(stage, response) { return response; }
  completedAgentSummary() { return ''; } resolvedDesktopTheme() { return params.get('theme') || 'dark'; } modelContextWindowTokens() { return undefined; }
  reasoningEffortForRoute() { return 'medium'; } conversationDirectoryMutationBlocked() { return false; } conversationWorkspaceBindings() { return []; }
  renderAgentActivity() { return null; } renderAgentChildLinks() { return null; } renderAgentTaskProgress() { return null; } renderThreadNavigator() { return null; }
  renderThreadFileNavigator() { return null; } renderConversationTabs() { return null; } activeVisualTab() { return undefined; } renderThreadFindControl() { return null; } renderRelayPickerPortal() { return null; } renderTerminalDrawer() { return null; }
  renderScheduleDialog() { return null; } renderAppPluginDialogs() { return null; } guard(_name, render) { return render(); } appPluginTabParts() { return undefined; } renderUnresolvedDraftAttachments() { return null; } renderComposerMarkdownOverlay() { return null; }
  renderThreadText(value) { return value; } renderUserMessage(value) { return <div className='nmx-user-markdown' data-nmx-literal><p>{value}</p></div>; }
  renderAssistantOutput(response) { return <div className='nmx-assistant-markdown' data-nmx-literal><p>{response}</p></div>; }
  scheduleComposerUiUpdate() { this.update(); } scheduleComposerDraftPersist() {} syncComposerDomControls() {} recordConversationSyncDiagnostic() {}
  persistActiveCodingSessionState() { this.calls.push(['persistPermission', this.permissionMode]); } closeModelEffortPickerImmediately() {}
  resetWalletTopupSurface() {} clearOfficialProviderSurface() {} currentCodingSessionViewState() { return {}; } focusTurnEditor() {}
  dismissComposerPicker() { this.codingPopover = ''; this.update(); } loadSelectedMerchantCatalog() {} focusModelPickerFirstOption() {}
  submitPrompt() { this.calls.push(['submitPrompt', this.prompt]); } stopAgentRun() { this.calls.push(['stopAgentRun']); this.agentStopping = true; this.update(); }
  update() { flushSync(() => root.render(<div className={'nmx-shell fixture-shell nmx-theme-' + this.resolvedDesktopTheme()}>
    <section className='nmx-workspace' id='nmx-workspace'>{this.renderCodingWorkbench()}</section></div>)); this.localizeRenderedSurface(); }
  ${methods}
}
const root = createRoot(document.getElementById('fixture-root'));
const target = new FixtureWidget();
// Any other action is recorded instead of reaching RPC or the file system.
const instance = new Proxy(target, { get(object, key, receiver) {
  if (key in object || typeof key !== 'string') return Reflect.get(object, key, receiver);
  if (/^(open|close|toggle|set|select|load|submit|stop|start|remove|cancel|confirm|begin|schedule|copy|preview|resume|restore|apply|edit|direct|answer|zoom|request|refresh|delete|scroll|show|choose|handle|on|unlink|dismiss|record)/.test(key)) return (...args) => { object.calls.push([key, ...args.filter(arg => typeof arg !== 'object')]); };
  return undefined; } });
window.fixture = instance; instance.update();
window.addEventListener('keydown', instance.handleSurfaceEscape);`;
    const { outputFiles } = await desktop('esbuild').build({ stdin: { contents: entry, loader: 'tsx', resolveDir: dirname(fileURLToPath(widgetUrl)), sourcefile: 'coding-workbench-fixture.tsx' },
        bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'silent', loader: { '.css': 'empty' },
        alias: { react: core.resolve('react'), 'react/jsx-runtime': core.resolve('react/jsx-runtime'), 'react-dom': core.resolve('react-dom'), 'react-dom/client': core.resolve('react-dom/client'),
            '@theia/core/shared/react': core.resolve('react'), '@theia/core/shared/react-dom': core.resolve('react-dom') } });
    return outputFiles[0].contents;
}

export async function startWorkbenchFixture() {
    const css = await productionStylesheets();
    const assets = {
        '/fixture.js': ['text/javascript', await workbenchFixtureBundle()],
        '/icons.css': ['text/css', await readFile(core.resolve('@vscode/codicons/dist/codicon.css'))], '/codicon.ttf': ['font/ttf', await readFile(core.resolve('@vscode/codicons/dist/codicon.ttf'))],
        '/': ['text/html', `<!doctype html><html><head><meta charset='utf-8'><link rel='stylesheet' href='/icons.css'>${css.map(name => `<link rel='stylesheet' href='/${name}'>`).join('')}
<style>html,body,.nmx-desktop-widget{margin:0;width:100%;height:100%;font:13px system-ui}#fixture-root{height:100%}*{box-sizing:border-box}.fixture-shell{display:grid!important;grid-template-columns:minmax(0,1fr)!important;height:100%}.fixture-shell .nmx-workspace{min-height:0;position:relative;display:flex;flex-direction:column}</style></head>
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
