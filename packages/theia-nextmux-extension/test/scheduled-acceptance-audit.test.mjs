import { runtimeFinalText } from '../lib/browser/nextmux-agent-outcome-locale.js';
import { desktopStatus } from '../lib/common/nextmux-desktop-status.js';
import { domainMessageFromError, DesktopDomainError } from '../lib/common/nextmux-domain-errors.js';
import { desktopDomainMessage, desktopDomainErrorText } from '../lib/browser/nextmux-domain-error-locale.js';
import { declaredReasoningEfforts, declaredReasoningSettings } from '../lib/common/nextmux-model-controls.js';
import assert from 'node:assert/strict';
import { goalTurnPresentation, goalRequestObjective } from '../lib/browser/nextmux-goal-presentation.js';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { bindPriceQuote, optionalKeyPriceQuoteId, priceAuthorizationErrorCode } from '../lib/common/nextmux-price-quote.js';
import { automaticRelaySource, sameModelRelayPolicy } from '../lib/common/nextmux-relay-switch.js';
import { effectiveContextWindowTokens, modelContextWindowTokens, normalizeContextWindowTokens } from '../lib/common/nextmux-context-budget.js';
import { officialConnectionRelayKey, managedRelayKey } from '../lib/browser/nextmux-model-route-selection.js';
import { serializePastedTextReferences } from '../lib/browser/nextmux-composer-long-paste.js';
import { localScheduleDateTime, scheduledOccurrenceDue, scheduledTaskNeedsAttention, validScheduleTime } from '../lib/common/nextmux-schedule.js';
import { AgentQuestionController } from '../lib/browser/nextmux-agent-question.js';
import { conversationAgentRunActive } from '../lib/browser/nextmux-conversation-agent-run.js';
import { mergeAgentEventPollSnapshot } from '../lib/browser/nextmux-agent-event-poll.js';
import { codingSidebarProjects } from '../lib/browser/nextmux-sidebar-projects.js';
import { protocolSupportsReasoningEffort } from '@nextmux/model-runtime/capabilities';

import { stableUuid } from '../lib/common/nextmux-stable-id.js';
const require = createRequire(import.meta.url);
const URI = require('@theia/core/lib/common/uri').default;
const { FileType } = require('@theia/filesystem/lib/common/files');

const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const klass = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
function productionHarness(names) {
    // Saving a schedule records the route's real context window ceiling.
    const methods = [...new Set([...names, 'modelContextWindowTokens'])].map(name => {
        const method = klass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name);
        assert.ok(method, `production method ${name}`);
        return method.getText(file);
    });
    const dependencies = { runtimeFinalText, DesktopDomainError, desktopStatus, domainMessageFromError, desktopDomainMessage, desktopDomainErrorText, declaredReasoningEfforts, declaredReasoningSettings, bindPriceQuote, optionalKeyPriceQuoteId, priceAuthorizationErrorCode, sameModelRelayPolicy, scheduledOccurrenceDue, scheduledTaskNeedsAttention,
        automaticRelaySource, normalizeContextWindowTokens, effectiveContextWindowTokens, modelContextWindowTokens, officialConnectionRelayKey, managedRelayKey,
        serializePastedTextReferences,
        AgentQuestionController, conversationAgentRunActive, mergeAgentEventPollSnapshot, codingSidebarProjects, URI, FileType, protocolSupportsReasoningEffort,
        validScheduleTime, normalizeModelCitations: value => value || [], goalTurnPresentation, goalRequestObjective,
        window: { localStorage: { setItem() {} } }, stableUuid };
    // scheduleRouteModelLabel formats managed labels through the widget's display-name helper; a plain name is enough here.
    const displayStub = names.includes('modelOnlyDisplayName') ? '' : 'modelOnlyDisplayName(displayName) { return displayName; }';
    return new Function(...Object.keys(dependencies), ts.transpile(`class Harness { desktopLocale = 'zh-CN'; reasoningSettingsForRoute() { return {}; } activeModelRoute() { return undefined; } ${methods.join('\n')}\n${displayStub} }; return Harness;`, {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    }))(...Object.values(dependencies));
}

const QuoteHarness = productionHarness(['managedModelRoutes', 'managedModelRoute', 'scheduledTaskWorkspaceOptions', 'selectedScheduleModelRoute', 'saveScheduledTask', 'scheduleRouteModelLabel',
    'scheduledTaskDueAt', 'scheduledTaskSession', 'executeScheduledTask', 'pollScheduledAgentRun', 'runDueScheduledTasks',
    'normalizedModelId', 'modelKeyForOffering', 'modelKeyForConnection', 'modelKeyForRoute', 'appendCodingTurn', 'codingSessionTitle', 'createCodingTurn',
    'codingSessionRelayKey', 'restoreCodingSourceSelection', 'reasoningEffortLevels', 'modelReasoningContract']);
function quoteFixture(automatic, authorizedQuote) {
    const requests = [];
    const catalogQuote = `kq1_${'b'.repeat(64)}`;
    const offering = { id: 'listing-a', registryModelId: 'registry-a', canonicalModel: 'model-a',
        modelFamily: 'Model A', providerName: 'Provider A', routeScore: 10, keyPriceQuoteId: catalogQuote,
        reasoningEfforts: ['low', 'high'] };
    const state = Object.assign(new QuoteHarness(), {
        managedOfferings: () => [offering], offeringMerchantId: () => 'merchant-a', activeKeyPriceQuoteId: authorizedQuote,
        activeRelayKey: automatic ? 'auto' : 'managed:merchant-a',
        scheduleDraft: { title: 'Quote audit', prompt: 'Check the project', workspacePath: '/audit-project',
            cadence: 'once', runAt: localScheduleDateTime(Date.now() + 120_000) },
        workspaceOptions: [{ path: '/audit-project', label: 'Audit project' }],
        scheduledTasks: [], scheduleDialogOpen: true, scheduledTasksReady: true, scheduledTasksPersistence: Promise.resolve(),
        scheduledTasksPersistenceError: '', runningScheduledTaskIds: new Set(), scheduledAgentRuns: new Map(),
        syncSavedScheduledTasks: async () => {}, scheduledTasksPersisted: new Map(), setProjectVisible() {},
        pendingAgentSubmissions: new Set(), codingSessions: [], codingHistoryProjects: [], modelSwitchSettings: new Map(),
        fileService: { activateProvider: async () => ({ stat: async () => ({ type: FileType.Directory }) }) },
        automaticRelaySource: automatic ? 'auto_best' : 'off', permissionMode: 'read_only',
        contextWindowTokens: 16000, reasoningEffortForRoute: () => 'low',
        persistScheduledTasks() {}, persistCodingSessions() {}, completeNavigationSurface() {}, update() {},
        registerScheduledTask: async () => {}, conversationHistoryReady: () => true,
        hydrateCodingSession: async id => state.codingSessions.find(session => session.id === id),
        codingConversationHistory: () => [], flushConversationHistory: async () => {},
        updateScheduledTask(id, patch) {
            state.scheduledTasks = state.scheduledTasks.map(task => task.id === id ? { ...task, ...patch } : task);
        },
        appendCodingTurn: () => ({ id: 'turn-a' }), updateCodingTurn() {},
        prepareAgentSkills: async () => [], addNotification() {}, notifySystemTask() {}, codingSessionTitle: text => text, agentBillingLabel: () => '', loadAccountOverview() {},
        pollScheduledAgentRun: async () => ({ status: 'completed', finalText: 'Checked', events: [],
            route: { modelFamily: 'Model A', providerName: 'Provider A' }, usage: { inputTokens: 1, outputTokens: 1 },
            billing: { kind: 'platform' }, failoverCount: 0, changes: [], turns: 1, toolCalls: 0 }),
        platformService: {
            upsertDesktopScheduledTask: async task => ({ ...task, definitionRevision: 1 }),
            claimDesktopScheduledTaskRun: async () => ({ claimed: true }),
            startAgentRun: async request => { requests.push(request); return { runId: 'scheduled-audit-run' }; },
            removeDesktopScheduledTask: async () => {},
        },
    });
    state.allModelRoutes = () => state.managedModelRoutes('coding', automatic);
    state.activeModelRouteId = state.allModelRoutes()[0].id;
    state.scheduleModelRoutes = state.allModelRoutes;
    Object.assign(state.scheduleDraft, { routeId: state.activeModelRouteId, relayKey: state.activeRelayKey, keyPriceQuoteId: authorizedQuote, reasoningEffort: 'low', contextWindowTokens: 16000, permissionMode: 'read_only', automaticRelaySource: state.automaticRelaySource });
    return { state, requests, catalogQuote };
}

test('actual managed route creation and due dispatch retain the chosen quote for fixed and automatic listings', async () => {
    for (const automatic of [false, true]) {
        const chosenQuote = `kq1_${'a'.repeat(64)}`;
        const { state, requests, catalogQuote } = quoteFixture(automatic, chosenQuote);
        // Production catalog routes carry a displayed quote on offering, not an authorization on route.
        assert.equal(state.allModelRoutes()[0].keyPriceQuoteId, undefined);
        assert.equal(state.allModelRoutes()[0].offering.keyPriceQuoteId, catalogQuote);
        await state.saveScheduledTask();
        const saved = JSON.parse(JSON.stringify(state.scheduledTasks[0]));
        assert.equal(saved.keyPriceQuoteId, chosenQuote);
        assert.equal(saved.modelRoute.route.keyPriceQuoteId, chosenQuote);
        assert.equal(saved.modelRoute.route.mode, automatic ? 'automatic' : 'fixed');
        assert.equal(saved.switchPolicy.mode, automatic ? 'same_model_relays' : 'same_model');
        // The schedule keeps the context window tier chosen for it (clamped to the route ceiling when one is known).
        assert.equal(saved.contextWindowTokens, 16000, 'the chosen context window tier is saved with the schedule');
        assert.equal(saved.permissionMode, 'read_only');
        assert.equal(saved.reasoningEffort, 'low');

        state.scheduledTasks = [{ ...saved, runAt: localScheduleDateTime(Date.now() - 60_000) }];
        state.activeKeyPriceQuoteId = `kq1_${'c'.repeat(64)}`;
        state.allModelRoutes = () => []; // An unrelated foreground conversation cannot replace the saved route.
        await state.runDueScheduledTasks();
        assert.equal(requests.length, 1);
        assert.equal(requests[0].route.route.keyPriceQuoteId, chosenQuote);
        assert.equal(requests[0].route.conversationId, state.codingSessions[0].id);
        assert.deepEqual(requests[0].switchPolicy, saved.switchPolicy);
        assert.equal(requests[0].contextWindowTokens, saved.contextWindowTokens, 'the scheduled run uses its own saved tier');
        assert.equal(state.scheduledTasks[0].lastStatus, 'complete');
        assert.equal(state.scheduledTasks[0].enabled, false);
        await state.runDueScheduledTasks();
        assert.equal(requests.length, 1, 'the consumed one-shot is never dispatched again');
    }
});

test('creating a schedule without price authorization does not adopt a newly displayed catalog quote', async () => {
    const { state } = quoteFixture(false, undefined);
    await state.saveScheduledTask();
    assert.equal(state.scheduledTasks[0].modelRoute.route.keyPriceQuoteId, undefined);
    assert.equal(state.scheduledTasks[0].keyPriceQuoteId, undefined);
});

test('scheduled reasoning is saved only when the selected API model declares that level', async () => {
    for (const kind of ['managed-unknown', 'managed-unsupported', 'official-unknown', 'official-other-model']) {
        const { state } = quoteFixture(false, undefined);
        if (kind.startsWith('managed')) {
            state.managedOfferings()[0].reasoningEfforts = kind === 'managed-unknown' ? undefined : ['high'];
        } else {
            const route = { id: 'official:byok:model-a', kind: 'official_connection', connection: {
                id: 'byok', providerId: 'provider-a', model: 'model-a', modelFamily: 'Model A', providerName: 'Provider A',
                protocol: 'openai_chat_completions', discoveredModels: kind === 'official-other-model'
                    ? [{ id: 'another-model', reasoningEfforts: ['low'] }] : []
            } };
            state.scheduleModelRoutes = () => [route];
            Object.assign(state.scheduleDraft, { routeId: route.id, relayKey: 'official:byok' });
        }
        await state.saveScheduledTask();
        assert.equal(state.scheduledTasks.length, 1, kind);
        assert.equal(state.scheduledTasks[0].reasoningEffort, undefined, kind);
    }
});

test('scheduled dispatch preserves its model picker and permission without adopting a foreground context override', async () => {
    for (const kind of ['official', 'managed-fixed', 'managed-auto']) {
        for (const viewed of [false, true]) {
            const { state, requests } = quoteFixture(kind === 'managed-auto', `kq1_${'a'.repeat(64)}`);
            if (kind === 'official') {
                const route = { id: 'official:byok:model-a', kind: 'official_connection',
                    connection: { id: 'byok', providerId: 'provider-a', model: 'model-a', modelFamily: 'Model A', providerName: 'Provider A',
                        protocol: 'openai_chat_completions', discoveredModels: [{ id: 'model-a', reasoningEfforts: ['low', 'high'] }] } };
                state.allModelRoutes = () => [route];
                state.scheduleModelRoutes = state.allModelRoutes;
                state.activeModelRouteId = route.id;
                state.activeRelayKey = 'official:byok';
                Object.assign(state.scheduleDraft, { routeId: route.id, relayKey: state.activeRelayKey });
            }
            await state.saveScheduledTask();
            const saved = JSON.parse(JSON.stringify(state.scheduledTasks[0]));
            assert.equal(saved.modelRoute.kind, kind === 'official' ? 'official_connection' : 'managed_gateway');
            assert.equal(saved.reasoningEffort, 'low');
            const created = state.scheduledTaskSession(saved);
            const session = { ...created, draftPrompt: 'Keep my unfinished follow-up', viewState: { marker: 'scheduled' } };
            state.codingSessions = [session];
            state.scheduledTasks = [{ ...saved, sessionId: session.id, runAt: localScheduleDateTime(Date.now() - 60_000) }];
            delete state.appendCodingTurn;
            // Deliberately use an empty or unrelated foreground picker, as in the live regression.
            state.activeCodingSessionId = viewed ? session.id : 'unrelated-foreground';
            state.activeRelayKey = '';
            state.activeModelRouteId = 'official:unrelated';
            state.activeModelRoute = () => undefined;
            state.reasoningEffort = 'high';
            state.contextWindowTokens = 128000;
            state.permissionMode = 'full_access';
            state.activeThreadTurnId = 'foreground-turn';
            state.threadAwayFromBottom = true;
            state.threadUnseenUpdates = 3;
            state.currentCodingSessionViewState = () => ({ marker: 'foreground' });
            state.allModelRoutes = () => []; // Persisted snapshot works while catalogs are unavailable.
            await state.runDueScheduledTasks();
            assert.equal(requests.length, 1, kind);
            assert.equal(requests[0].route.kind, saved.modelRoute.kind);
            assert.equal(requests[0].reasoningEffort, 'low');
            if (kind === 'official') assert.equal(requests[0].route.connectionId, 'byok');
            assert.equal(requests[0].contextWindowTokens, saved.contextWindowTokens, `${kind}: the scheduled run sends its own saved tier`);
            assert.notEqual(requests[0].contextWindowTokens, 128000, `${kind}: foreground context override never enters the request`);
            const persisted = JSON.parse(JSON.stringify(state.codingSessions[0]));
            for (const field of ['routeId', 'relayKey', 'modelId', 'reasoningEffort', 'contextWindowTokens', 'permissionMode', 'automaticRelaySource', 'keyPriceQuoteId']) {
                assert.equal(persisted[field], saved[field], `${kind}/${viewed}/${field}`);
            }
            assert.equal(persisted.turns[0].routeId, saved.routeId);
            assert.equal(persisted.turns[0].permissionMode, 'read_only');
            assert.equal(persisted.draftPrompt, session.draftPrompt);
            assert.deepEqual(persisted.viewState, session.viewState);
            assert.equal(state.activeThreadTurnId, 'foreground-turn');
            assert.equal(state.threadAwayFromBottom, true);
            assert.equal(state.threadUnseenUpdates, 3);
            state.restoreCodingSourceSelection(persisted);
            assert.equal(state.activeRelayKey, saved.relayKey);
            assert.equal(state.activeModelRouteId, saved.routeId);
            assert.equal(state.selectedModelIds.coding, saved.modelId);
            assert.equal(state.contextWindowTokens, saved.contextWindowTokens, 'opening the conversation restores its own tier');
        }
    }
});

test('normal composer append still adopts its selected settings and clears only its own draft', () => {
    const { state } = quoteFixture(false, `kq1_${'a'.repeat(64)}`);
    delete state.appendCodingTurn;
    const route = state.allModelRoutes()[0];
    const session = { id: 'active', turns: [], routeId: 'old', draftPrompt: 'submitted', permissionMode: 'full_access' };
    Object.assign(state, { activeCodingSessionId: session.id, activeModelRoute: () => route,
        reasoningEffort: 'low', currentCodingSessionViewState: () => ({ marker: 'active' }),
        activeThreadTurnId: 'old-turn', threadAwayFromBottom: true, threadUnseenUpdates: 3 });
    const turn = state.appendCodingTurn(session, 'Check this', 'read_only', route.id, 'Model A');
    const updated = state.codingSessions[0];
    assert.equal(updated.routeId, route.id);
    assert.equal(updated.relayKey, 'managed:merchant-a');
    assert.equal(updated.modelId, 'model-a');
    assert.equal(updated.permissionMode, 'read_only');
    assert.equal(updated.draftPrompt, undefined);
    assert.equal(state.activeThreadTurnId, turn.id);
    assert.equal(state.threadAwayFromBottom, false);
    assert.equal(state.threadUnseenUpdates, 0);
});

test('repeated scheduled runs never replace user changes made in their result conversation', () => {
    const { state } = quoteFixture(false, undefined);
    const session = { id: 'result', turns: [], relayKey: '', modelId: '', permissionMode: 'workspace_write' };
    state.codingSessions = [session];
    assert.equal(state.scheduledTaskSession({ sessionId: 'result', routeId: 'saved-plan-route' }), session);
});

test('historical coding projects are selectable once, remain separate from comic projects, and save after a real directory stat', async t => {
    const root = await mkdtemp(join(tmpdir(), 'schedule-project-audit-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const history = join(root, 'history-project');
    await mkdir(history);
    const { state } = quoteFixture(false, `kq1_${'a'.repeat(64)}`);
    state.codingHistoryProjects = [{ workspacePath: '/audit-project' }, { workspacePath: history }, { workspacePath: history }];
    state.codingSessions = [{ id: 'history-session', workspacePath: history, turns: [] }];
    state.comicWorkspaceOptions = [{ path: join(root, 'comic-only'), label: 'Comic only' }];
    state.activeComicWorkspaceRoot = state.comicWorkspaceOptions[0].path;
    assert.deepEqual(state.scheduledTaskWorkspaceOptions().map(option => option.path), ['/audit-project', history]);
    const reads = [];
    state.fileService.activateProvider = async scheme => {
        assert.equal(scheme, 'file');
        return { async stat(uri) {
            const path = uri.path.fsPath(); reads.push(path);
            const metadata = await stat(path);
            return { type: metadata.isDirectory() ? FileType.Directory : FileType.File };
        } };
    };
    state.scheduleDraft.workspacePath = history;
    await state.saveScheduledTask();
    assert.equal(state.scheduledTasks[0].workspacePath, history);
    assert.deepEqual(reads, [history], 'only the chosen directory is inspected');
    assert.equal(state.activeComicWorkspaceRoot, state.comicWorkspaceOptions[0].path);
});

test('a missing or non-directory historical project shows an error without saving or registering a schedule', async t => {
    const root = await mkdtemp(join(tmpdir(), 'schedule-missing-project-audit-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const ordinaryFile = join(root, 'ordinary-file');
    await writeFile(ordinaryFile, 'fixture');
    for (const path of [join(root, 'missing'), ordinaryFile]) {
        const { state } = quoteFixture(false, `kq1_${'a'.repeat(64)}`);
        let registered = false;
        state.codingHistoryProjects = [{ workspacePath: path }];
        state.scheduleDraft.workspacePath = path;
        state.registerScheduledTask = async () => { registered = true; };
        state.fileService.activateProvider = async () => ({ async stat(uri) {
            const metadata = await stat(uri.path.fsPath());
            return { type: metadata.isDirectory() ? FileType.Directory : FileType.File };
        } });
        await state.saveScheduledTask();
        assert.equal(state.scheduledTasks.length, 0);
        assert.equal(registered, false);
        assert.equal(state.scheduleSaving, false);
        assert.match(state.scheduleDraftError, /项目文件夹/);
    }
});

test('actual scheduled polling retains terminal price error codes so recurring plans pause for new authorization', async () => {
    for (const code of ['PRICE_AUTHORIZATION_REQUIRED', 'PRICE_QUOTE_CHANGED', 'PRICE_QUOTE_INVALID']) {
        const { state, requests } = quoteFixture(false, `kq1_${'a'.repeat(64)}`);
        const turns = [], removed = [];
        await state.saveScheduledTask();
        const saved = state.scheduledTasks[0];
        state.scheduledTasks = [{ ...saved, cadence: 'daily',
            runAt: localScheduleDateTime(Date.now() - 60_000).split('T')[1], createdAt: Date.now() - 86_400_000 }];
        delete state.pollScheduledAgentRun;
        state.updateCodingTurn = (_sessionId, _turnId, patch) => turns.push(patch);
        const failure = { code, message: '模型报价需要重新确认。请刷新模型目录，查看新价格并重新选择模型后再发送。',
            kind: 'waiting_user', retryable: false, resumable: false, retrySafe: false };
        state.platformService.getAgentRunSnapshot = async runId => ({ runId, status: 'waiting_user',
            events: [], nextEventIndex: 0, error: failure });
        state.platformService.removeDesktopScheduledTask = async id => removed.push(id);
        await state.runDueScheduledTasks();
        assert.equal(requests.length, 1);
        assert.equal(state.scheduledTasks[0].enabled, false, code);
        assert.equal(state.scheduledTasks[0].lastStatus, 'error');
        assert.equal(turns.find(patch => patch.failure)?.failure.code, code);
        assert.deepEqual(removed, [saved.id]);
    }
});

const ExitHarness = productionHarness(['persistScheduledTasks', 'updateScheduledTask', 'shutdownForApplicationExit']);
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

test('quitting during selected-folder validation prevents late schedule creation or registration', async () => {
    const { state } = quoteFixture(false, `kq1_${'a'.repeat(64)}`);
    const validation = deferred();
    let registered = false;
    state.fileService.activateProvider = async () => ({ stat: () => validation.promise });
    state.registerScheduledTask = async () => { registered = true; };
    const creation = state.saveScheduledTask();
    await tick();
    state.applicationExitPreparing = true;
    validation.resolve({ type: FileType.Directory });
    await creation;
    assert.equal(state.scheduledTasks.length, 0);
    assert.equal(state.scheduleSaving, false);
    assert.equal(registered, false);
});

function exitFixture() {
    const result = deferred(), write = deferred(), events = [];
    const task = { id: 'scheduled-audit', lastStatus: 'running' };
    const state = Object.assign(new ExitHarness(), {
        applicationExitGeneration: 1, applicationExitPreparing: true,
        pastedTextPersistence: new Map(), pendingContextFileWrites: new Set(), pendingAttachmentImports: new Map(),
        pendingDraftAttachmentRestores: () => [], agentChildContinuationStates: new Map(), conversationAgentRuns: new Map(),
        scheduledAgentRuns: new Map([['session-a', { runId: 'run-a' }]]),
        scheduledTasks: [task], scheduledTasksReady: true, scheduledTasksPersistence: Promise.resolve(),
        scheduledTasksPersisted: new Map([[task.id, JSON.stringify(task)]]),
        scheduledTasksPersistenceError: '', terminalRecords: [{ id: 'terminal-a' }],
        flushComposerDraft() {}, flushConversationHistory: async () => { events.push('history'); },
        workspaceConfigurationSaver: { flush: async () => {} }, captureContextEditorRecovery: () => true,
        assertApplicationExitSaved() {}, persistTerminalRecords() {}, update() {},
        terminateAndDisposeConversationTerminal: async () => { events.push('terminal-disposed'); },
        platformService: {
            cancelAgentRun: async id => { events.push(`cancel:${id}`); },
            saveDesktopScheduledTasks: async patch => {
                assert.equal(patch.upsert[0].lastStatus, 'error');
                events.push('schedule-save-started');
                await write.promise;
                events.push('schedule-durable');
            },
        },
    });
    // The real result-update and persistence methods run only after the initial shutdown flush.
    const run = result.promise.then(() => {
        state.updateScheduledTask(task.id, { lastStatus: 'error', lastMessage: 'Cancelled while quitting' });
        events.push('late-result');
        return true;
    });
    state.pendingAgentSubmissions = new Set([run]);
    return { state, result, write, events };
}

test('quitting awaits a scheduled result save created after cancelling and joining its backend job', async () => {
    const { state, result, write, events } = exitFixture();
    let closed = false;
    const closing = state.shutdownForApplicationExit().then(() => { closed = true; });
    await tick();
    assert.ok(events.includes('cancel:run-a'));
    result.resolve(); await tick();
    assert.ok(events.includes('schedule-save-started'));
    assert.equal(closed, false);
    assert.equal(events.includes('terminal-disposed'), false);
    write.resolve(); await closing;
    assert.ok(events.indexOf('schedule-durable') < events.indexOf('terminal-disposed'));
    assert.ok(events.lastIndexOf('history') > events.indexOf('late-result'));
});

test('a failed late scheduled result save rejects close before terminal disposal', async () => {
    const { state, result, write, events } = exitFixture();
    const closing = state.shutdownForApplicationExit();
    const rejects = assert.rejects(closing, /SCHEDULE_SAVE_FAILED/);
    await tick(); result.resolve(); await tick();
    write.reject(new Error('SCHEDULE_SAVE_FAILED'));
    await rejects;
    assert.equal(events.includes('terminal-disposed'), false);
    assert.equal(state.terminalRecords.length, 1);
});
