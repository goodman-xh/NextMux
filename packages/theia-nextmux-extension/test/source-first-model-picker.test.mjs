import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const method = name => {
    const value = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name);
    assert.ok(value, name); return value.getText(file);
};
const compile = (text, values = {}) => new Function(...Object.keys(values), ts.transpile(text, {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React
}))(...Object.values(values));
const routeModule = { exports: {} };
compile(readFileSync(new URL('../src/browser/nextmux-model-route-selection.ts', import.meta.url), 'utf8'),
    { module: routeModule, exports: routeModule.exports, require: createRequire(new URL('../lib/browser/nextmux-model-route-selection.js', import.meta.url)) });
const storage = new Map();
const names = ['relayOptionIsFull', 'setComposerPrompt', 'codingSessionRelayKey', 'restoreCodingSourceSelection', 'recentCodingSource', 'syncActiveRelay', 'syncModelRoute', 'recoverDeletedOfficialRelay',
    'activeModelRoute', 'persistActiveRouteSelection', 'applyRelaySelection', 'selectRelay', 'confirmRelaySwitch',
    'matchingModelRoute', 'modelReasoningContract', 'reasoningEffortLevels', 'reasoningDepthChoicesForRoute', 'reasoningSettingsForRoute', 'selectModelOption', 'selectModelOptionOnRelay', 'startNewCodingTask', 'createCodingSessionForWorkspace',
    'restoreCodingSessionState', 'loadOfficialModels', 'codingModelOptions', 'relayOptions', 'relayPickerOptions', 'setRelaySortMode', 'setRelaySourceTab', 'loadPublicMerchantPage', 'loadSelectedMerchantCatalog', 'managedOfferings', 'managedModelRoutes', 'routesForRelay', 'modelKeyForRoute', 'toggleCodingPopover', 'applyPlatformSession',
    // A route's context window ceiling (the session keeps a chosen tier only within it).
    'modelContextWindowTokens'];
const Widget = compile(`class Harness { ${names.map(method).join('\n')} }; return Harness;`, {
    ...require('../lib/common/nextmux-context-budget.js'),
    ...require('@nextmux/model-runtime/presets'),
    ...require('@nextmux/model-runtime/capabilities'),
    ...require('../lib/common/nextmux-price-quote.js'),
    ...require('../lib/common/nextmux-model-controls.js'),
    ...require('../lib/browser/nextmux-reasoning-depth-presentation.js'),
    ...require('../lib/common/nextmux-relay-switch.js'), ...require('../lib/common/nextmux-relay-capacity.js'),
    ...routeModule.exports, ...require('../lib/common/nextmux-relay-evidence.js'),
    ...require('../lib/browser/nextmux-relay-picker.js'), relayText: (_locale, key) => key,
    ...require('../lib/browser/nextmux-offering-price.js'),
    ...require('../lib/browser/nextmux-model-switch-settings.js'), EMPTY_ACCOUNT_OVERVIEW: Object.freeze({}),
    ...require('../lib/browser/nextmux-model-visibility.js'), ...require('../lib/browser/nextmux-own-model-kind.js'), ...require('../lib/browser/nextmux-own-model-match.js'),
    window: { clearTimeout() {}, localStorage: {
        getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)
    } }, requestAnimationFrame() {}, crypto: globalThis.crypto || webcrypto,
    normalizeAgentChildScrollStates: value => value || {},
    officialInvokableModelIds: connection => [connection.model, ...(connection.discoveredModels || []).map(row => row.id)],
    officialDiscoveredModelIds: connection => [connection.model, ...(connection.discoveredModels || []).map(row => row.id)],
    invokableOfficialDiscovery: connection => connection.discoveredModels || []
});
const offerings = [
    { id: 'a-one', merchantId: 'merchant-a', canonicalModel: 'provider/shared', providerName: 'A', registryModelId: 'shared', input: ['text'], output: ['text'], capabilities: ['coding', 'tools'] },
    { id: 'a-two', merchantId: 'merchant-a', canonicalModel: 'provider/unique', providerName: 'A', registryModelId: 'unique', input: ['text'], output: ['text'], capabilities: ['coding', 'tools'] },
    { id: 'b-one', merchantId: 'merchant-b', canonicalModel: 'other/shared', providerName: 'B', registryModelId: 'other-shared', input: ['text'], output: ['text'], capabilities: ['coding', 'tools'] }
];
const fixed = offering => ({ id: `managed:fixed:${offering.id}`, kind: 'managed_gateway', offering, modelId: offering.canonicalModel });
const routeMap = {
    'managed:merchant-a': offerings.slice(0, 2).map(fixed),
    'managed:merchant-b': [fixed(offerings[2])],
    auto: offerings.map(offering => ({ ...fixed(offering), id: `managed:auto:${offering.registryModelId}`, automatic: true }))
};
function fixture(sessionPatch = {}) {
    const instance = new Widget();
    const session = { id: 'session-a', workspacePath: '/synthetic', title: 'Task', turns: [], routeId: '', relayKey: '', modelId: '',
        draftPrompt: 'keep this draft', draftAttachments: [{ id: 'attachment' }], followUpQueue: [{ id: 'queued' }], ...sessionPatch };
    Object.assign(instance, { activeSection: 'coding', activeCodingSessionId: session.id, codingSessions: [session],
        disconnectInactiveConversationTabs() {}, hasActiveOrPendingCouncilMode: () => false,
        privacySettings: { requireZeroDataRetention: false, denyDataCollection: true, saveConversationHistory: true },
        activeRelayKey: '', activeModelRouteId: '', selectedModelIds: { coding: '', comic: '' }, activeWorkspaceRoot: '/synthetic',
        automaticRelaySource: 'off',
        // Background own-API model list refresh (tested in model-list-refresh.test.mjs) stays inert here.
        scheduleOwnApiModelListRefresh() {}, noteModelCatalogForListRefresh() {},
        platformCatalog: { offerings }, registryModels: [], officialModels: { connections: [], providers: [] },
        officialModelsLoading: false, officialModelsError: '', officialModelsRequestToken: 0, catalogLoading: false,
        disabledCodingModelIds: new Set(), disabledComicModelIds: new Set(), reasonEffort: 'medium', reasoningSettingsByModel: {}, permissionMode: 'read_only',
        favoriteMerchantLabels: new Map(), updates: 0, persistCount: 0, prompt: session.draftPrompt, attachments: session.draftAttachments,
        publicMerchantPageRequest: 0, relaySourceQuery: '', relaySourceTab: 'merchant', relaySortMode: 'quality', platformSession: { linked: false },
        merchantCatalogRequest: 0, merchantCatalogStatus: 'idle', merchantPickerSnapshots: new Map(), merchantDiscoveredModels: new Map(),
        catalogSnapshotRevision: 0, catalogSnapshotRefresh: { reset() {} }, pendingCatalogMerchants: new Set(), pendingComicDirectories: new Set(),
        catalogSourceRetries: new Map(), catalogRemovedMerchants: new Set(), checkModelCatalogVersion: async () => {},
        accountOverviewRevision: 0, originalReceiptChecks: new Map(), modelSwitchStorageKey: () => 'isolated-model-switch-settings', loadAccountOverview: async () => {},
        workspaceOptions: [{ path: '/synthetic' }], expandedCodingProjects: new Set(), agentStage: 'idle', defaultPermissionMode: 'read_only',
        activeCodingSession() { return this.codingSessions.find(item => item.id === this.activeCodingSessionId); },
        relayOptions() { return Object.keys(routeMap).map(key => ({ key, kind: key === 'auto' ? 'automatic' : 'managed', label: key,
            ...(key.startsWith('managed:') ? { merchantId: key.slice('managed:'.length) } : {}) })); },
        relayOption() { return this.relayOptions().find(option => option.key === this.activeRelayKey); },
        officialRelayConnectionReferences() { return this.officialModels.connections.map(connection => ({ connectionId: connection.id, providerId: connection.providerId })); },
        migrateManagedRelaySelection: value => value,
        routesForRelay: key => routeMap[key] || [],
        modelRoutes() { return this.routesForRelay(this.activeRelayKey); },
        modelKeyForRoute: route => route.modelId,
        modelKeyForOffering: offering => offering.canonicalModel,
        modelKeyForConnection: connection => `${connection.providerId}/${connection.model}`,
        normalizedModelId: value => value.toLowerCase(),
        offeringMerchantId: offering => offering.merchantId,
        modelDisplayName: value => value, modelOnlyDisplayName: (_label, _provider, model) => model,
        managedOfferings: () => offerings, officialModelRoutes: () => [],
        registryModelSupportsWorkbench: () => true, registryModelOption: row => row,
        connectionForDiscoveredModel: (connection, model) => ({ ...connection, model }),
        connectionInputModalities: () => ['text'], connectionCapabilityLabels: () => [],
        update() { this.updates++; }, persistCodingSessions() { this.persistCount++; },
        clearNavigationSurfaces() { this.codingPopover = ''; }, closeNavigationSurface() { this.codingPopover = ''; },
        focusModelPickerFirstOption() {}, closeModelEffortPickerImmediately() {}, verifyEnabledOfficialModels: async () => {},
        workspaceRootIsOpen(path) { return this.workspaceOptions.some(option => option.path === path); },
        syncReasoningEffort() {}, localReasoningEvidence() { return undefined; }, addNotification() {}, persistDesktopRestoreState() {},
        detachContextEditorRecovery: () => true, flushComposerDraft() {}, persistActiveCodingSessionState() {}, rememberNavigation() {},
        currentCodingSessionViewState: () => ({}), restoreComposerDraft() {},
        restoreCodingViewState: async () => {}, hydrateDelegationLedgersForSession() {}, reconcileInterruptedAgentRun: async () => {}
    });
    return instance;
}
test('source-first resolution never adopts catalog order, auto, or another removed source', () => {
    const { resolveModelRelay } = routeModule.exports;
    assert.deepEqual(resolveModelRelay({ availableRelayKeys: ['auto', 'managed:a'], selectFallback: false }), { relayKey: '', status: 'ready' });
    assert.deepEqual(resolveModelRelay({ availableRelayKeys: ['auto'], activeRelayKey: 'managed:removed', selectFallback: false }), { relayKey: 'managed:removed', status: 'unavailable' });
    assert.deepEqual(resolveModelRelay({ availableRelayKeys: ['auto'], activeRelayKey: 'auto', selectFallback: false }), { relayKey: 'auto', status: 'ready' });
});

test('an explicit model selection owns its quote across catalog refresh, queue snapshots and session restoration', () => {
    const state = fixture();
    const a = `kq1_${'a'.repeat(64)}`, b = `kq1_${'b'.repeat(64)}`;
    const offering = offerings[0], previous = offering.keyPriceQuoteId;
    try {
        offering.keyPriceQuoteId = a;
        state.selectRelay('managed:merchant-a'); state.selectModelOption('provider/shared', 'coding');
        assert.equal(state.activeModelRoute().keyPriceQuoteId, a);
        assert.equal(state.activeCodingSession().keyPriceQuoteId, a);
        const dispatchSnapshot = state.activeModelRoute();
        offering.keyPriceQuoteId = b;
        state.syncModelRoute();
        assert.equal(state.activeModelRoute().keyPriceQuoteId, a, 'refresh cannot authorize a price');
        state.restoreCodingSourceSelection(state.activeCodingSession());
        assert.equal(state.activeModelRoute().keyPriceQuoteId, a);
        state.selectModelOptionOnRelay('provider/shared', 'coding', 'managed:merchant-a', { id: a });
        assert.equal(state.activeModelRoute().keyPriceQuoteId, a, 'stale rendered price is not accepted');
        state.selectModelOptionOnRelay('provider/shared', 'coding', 'managed:merchant-a', { id: b });
        assert.equal(state.activeModelRoute().keyPriceQuoteId, b);
        assert.equal(dispatchSnapshot.keyPriceQuoteId, a, 'in-flight/queued copies stay at the original quote');
        state.restoreCodingSourceSelection(); assert.equal(state.activeKeyPriceQuoteId, undefined);
    } finally { offering.keyPriceQuoteId = previous; }
});

test('composer display and click use the same first route when one merchant has multiple endpoints for a canonical model', () => {
    const render = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === 'renderCodingWorkbench');
    const declaration = render.body.statements.flatMap(statement => ts.isVariableStatement(statement)
        ? [...statement.declarationList.declarations] : []).find(node => node.name.getText(file) === 'modelRouteById');
    assert.ok(declaration, 'extract the actual renderer route lookup, not a test implementation');
    const displayRoutes = compile(`return function () { const modelPickerRelayKey = this.activeRelayKey; return ${declaration.initializer.getText(file)}; };`);
    const quoteA = `kq1_${'a'.repeat(64)}`, quoteB = `kq1_${'b'.repeat(64)}`, quoteC = `kq1_${'c'.repeat(64)}`;
    const first = fixed({ ...offerings[0], id: 'same-model-endpoint-a', keyPriceQuoteId: quoteA });
    const second = fixed({ ...offerings[0], id: 'same-model-endpoint-b', keyPriceQuoteId: quoteB });
    let routes = [first, second];
    const state = fixture({ relayKey: 'managed:merchant-a' }); state.activeRelayKey = 'managed:merchant-a';
    state.routesForRelay = key => key === state.activeRelayKey ? routes : [];
    const displayed = displayRoutes.call(state).get('provider/shared');
    assert.equal(displayed, first, 'duplicate canonical IDs cannot overwrite the first route chosen by the real handlers');
    state.selectModelOptionOnRelay('provider/shared', 'coding', state.activeRelayKey, { id: displayed.offering.keyPriceQuoteId });
    assert.equal(state.activeModelRouteId, first.id); assert.equal(state.activeModelRoute().keyPriceQuoteId, quoteA);
    const persisted = state.persistCount;
    routes = [{ ...first, offering: { ...first.offering, keyPriceQuoteId: quoteC } }, second];
    state.selectModelOptionOnRelay('provider/shared', 'coding', state.activeRelayKey, { id: quoteA });
    assert.equal(state.activeKeyPriceQuoteId, quoteA); assert.equal(state.persistCount, persisted, 'old rendered quote must not authorize a refreshed price');
    const refreshed = displayRoutes.call(state).get('provider/shared');
    state.selectModelOptionOnRelay('provider/shared', 'coding', state.activeRelayKey, { id: refreshed.offering.keyPriceQuoteId });
    assert.equal(state.activeModelRouteId, first.id); assert.equal(state.activeModelRoute().keyPriceQuoteId, quoteC);
    routes = [second, routes[0]];
    state.selectModelOptionOnRelay('provider/shared', 'coding', state.activeRelayKey, { id: quoteC });
    assert.equal(state.activeModelRouteId, first.id, 'a stale row cannot select a different endpoint after reordering');
    const reordered = displayRoutes.call(state).get('provider/shared');
    assert.equal(reordered, second);
    state.selectModelOptionOnRelay('provider/shared', 'coding', state.activeRelayKey, { id: reordered.offering.keyPriceQuoteId });
    assert.equal(state.activeModelRouteId, second.id); assert.equal(state.activeModelRoute().keyPriceQuoteId, quoteB);
});

test('new conversation keeps the latest conversation relay (like Codex) but never stale globals or a managed quote', () => {
    const instance = fixture({ relayKey: 'managed:merchant-a', routeId: 'managed:fixed:a-one', modelId: 'provider/shared' });
    storage.set('nextmux.desktop.activeRelay.v1', 'auto'); storage.set('nextmux.desktop.route.coding', 'managed:fixed:a-one');
    const original = instance.activeCodingSession(); instance.restoreCodingSourceSelection(original);
    instance.startNewCodingTask();
    // A managed relay carries over, its route/price quote belongs to the earlier conversation.
    assert.equal(instance.activeCodingSessionId, ''); assert.equal(instance.activeRelayKey, 'managed:merchant-a'); assert.equal(instance.selectedModelIds.coding, '');
    assert.equal(instance.activeModelRouteId, '');
    assert.equal(instance.codingSessions[0], original);
    instance.codingSessions = []; instance.activeRelayKey = 'auto'; instance.activeModelRouteId = 'managed:fixed:a-one';
    const created = instance.createCodingSessionForWorkspace('/synthetic');
    assert.equal(created.relayKey, ''); assert.equal(created.modelId, ''); assert.equal(created.routeId, '');
    assert.equal(instance.activeRelayKey, ''); assert.equal(instance.activeModelRouteId, '');
});
test('old conversation restores only its source/model, including unavailable routes; blank conversations stay blank', () => {
    const instance = fixture({ relayKey: 'managed:merchant-a', routeId: 'managed:fixed:a-two', modelId: 'provider/unique' });
    instance.activeRelayKey = 'managed:merchant-b'; instance.activeModelRouteId = 'managed:fixed:b-one'; instance.selectedModelIds.coding = 'other/shared';
    instance.syncModelRoute();
    assert.equal(instance.activeRelayKey, 'managed:merchant-a'); assert.equal(instance.activeModelRouteId, 'managed:fixed:a-two');
    assert.equal(instance.selectedModelIds.coding, 'provider/unique');
    instance.codingSessions = [{ ...instance.activeCodingSession(), relayKey: 'managed:removed', routeId: 'managed:fixed:removed', modelId: 'gone' }];
    instance.syncModelRoute(); assert.equal(instance.activeRelayKey, 'managed:removed'); assert.equal(instance.activeModelRouteId, 'managed:fixed:removed');
    instance.codingSessions = [{ ...instance.activeCodingSession(), relayKey: '', routeId: '', modelId: '' }];
    instance.syncModelRoute(); assert.equal(instance.activeRelayKey, ''); assert.equal(instance.activeModelRouteId, ''); assert.equal(instance.selectedModelIds.coding, '');
});
test('legacy missing-source history can derive its own exact route but explicit empty never resurrects old turns', () => {
    const instance = fixture({ relayKey: undefined, routeId: 'managed:fixed:a-one' });
    assert.equal(instance.codingSessionRelayKey(instance.activeCodingSession()), 'managed:merchant-a');
    assert.equal(instance.codingSessionRelayKey({ turns: [{ routeId: 'managed:auto:shared' }] }), 'auto');
    assert.equal(instance.codingSessionRelayKey({ relayKey: '', turns: [{ routeId: 'managed:auto:shared' }] }), '');
    assert.equal(instance.codingSessionRelayKey({ turns: [{ routeId: 'unrecognized' }] }), '');
    instance.officialModels.connections = [{ id: 'exact-connection', providerId: 'custom_openai' }];
    assert.equal(instance.codingSessionRelayKey({ routeId: 'official:exact-connection:model', turns: [] }), 'official:exact-connection');
});
test('source selection requires explicit model selection and preserves all draft/attachment/queue data', () => {
    const instance = fixture(), before = instance.activeCodingSession(), attachments = instance.attachments;
    instance.selectRelay('managed:merchant-a');
    instance.syncModelRoute();
    assert.equal(instance.activeRelayKey, 'managed:merchant-a'); assert.equal(instance.activeModelRouteId, ''); assert.equal(instance.selectedModelIds.coding, '');
    instance.selectModelOption('other/shared', 'coding'); assert.equal(instance.activeModelRouteId, '', 'foreign model rejected');
    instance.selectModelOption('provider/shared', 'coding'); assert.equal(instance.activeModelRouteId, 'managed:fixed:a-one');
    instance.syncModelRoute(); assert.equal(instance.activeModelRouteId, 'managed:fixed:a-one');
    assert.equal(instance.prompt, before.draftPrompt); assert.equal(instance.attachments, attachments);
    assert.equal(instance.activeCodingSession().followUpQueue, before.followUpQueue);
    assert.equal(instance.activeCodingSession().draftAttachments, before.draftAttachments);
});
test('every different source clears model and quote even when its canonical model is identical', () => {
    const instance = fixture({ relayKey: 'managed:merchant-a', routeId: 'managed:fixed:a-one', modelId: 'provider/shared' });
    instance.restoreCodingSourceSelection(instance.activeCodingSession());
    const compatible = { ...fixed(offerings[0]), id: 'managed:fixed:compatible', offering: { ...offerings[0], merchantId: 'merchant-b' } };
    instance.routesForRelay = key => key === 'managed:merchant-b' ? [compatible] : routeMap[key] || [];
    instance.selectRelay('managed:merchant-b'); instance.syncModelRoute();
    assert.equal(instance.pendingRelaySwitch, undefined);
    assert.equal(instance.activeRelayKey, 'managed:merchant-b'); assert.equal(instance.activeModelRouteId, '');
    assert.equal(instance.selectedModelIds.coding, ''); assert.equal(instance.activeKeyPriceQuoteId, undefined);
    instance.selectModelOption('provider/shared', 'coding');
    instance.selectRelay('managed:merchant-b');
    assert.equal(instance.activeModelRouteId, compatible.id, 'reopening the same source preserves its explicit model');
});
test('same suffix from another provider is incompatible; confirmed source switch clears old model only', () => {
    const instance = fixture({ relayKey: 'managed:merchant-a', routeId: 'managed:fixed:a-one', modelId: 'provider/shared' });
    instance.restoreCodingSourceSelection(instance.activeCodingSession());
    instance.merchantPickerSnapshots.set('merchant-b', { catalog: { merchantId: 'merchant-b', offerings: [offerings[2]] }, updatedAt: Date.now() });
    instance.selectRelay('managed:merchant-b');
    assert.ok(instance.pendingRelaySwitch); assert.equal(instance.activeRelayKey, 'managed:merchant-a');
    instance.confirmRelaySwitch(); instance.syncModelRoute();
    assert.equal(instance.activeRelayKey, 'managed:merchant-b'); assert.equal(instance.activeModelRouteId, ''); assert.equal(instance.selectedModelIds.coding, '');
    assert.equal(instance.prompt, 'keep this draft'); assert.equal(instance.activeCodingSession().followUpQueue.length, 1);
});

test('a cold, expired or partial target catalog cannot prove a model is missing before source prefetch', async () => {
    for (const kind of ['cold', 'expired', 'partial', 'fresh-complete-missing']) {
        const instance = fixture({ relayKey: 'managed:merchant-a', routeId: 'managed:fixed:a-one', modelId: 'provider/shared' });
        delete instance.routesForRelay; delete instance.managedOfferings; delete instance.modelKeyForRoute;
        const currentOffering = { ...offerings[0], status: 'active', workbenches: ['coding'] };
        const targetOffering = { ...currentOffering, id: 'b-compatible', merchantId: 'merchant-b' };
        const currentCatalog = { merchantId: 'merchant-a', online: true, offerings: [currentOffering] };
        instance.selectedMerchantCatalog = currentCatalog;
        instance.merchantPickerSnapshots.set('merchant-a', { catalog: currentCatalog, updatedAt: Date.now() });
        // A global listing is deliberately present: it must not establish target completeness.
        instance.platformCatalog.offerings = [targetOffering];
        if (kind !== 'cold') instance.merchantPickerSnapshots.set('merchant-b', {
            catalog: { merchantId: 'merchant-b', online: true, offerings: [], ...(kind === 'partial' ? { nextCursor: 'b-page-1' } : {}) },
            updatedAt: Date.now() - (kind === 'expired' ? 30_001 : 0)
        });
        if (kind !== 'cold') instance.merchantDiscoveredModels.set('merchant-b', []);
        instance.restoreCodingSourceSelection(instance.activeCodingSession());
        const before = instance.activeCodingSession(), calls = [];
        instance.platformService = { getMerchantCatalog: async merchantId => {
            calls.push(merchantId); return { merchantId, online: true, offerings: [targetOffering] };
        } };
        instance.selectRelay('managed:merchant-b');
        if (kind === 'fresh-complete-missing') {
            assert.equal(instance.pendingRelaySwitch?.option.key, 'managed:merchant-b');
            assert.equal(instance.activeRelayKey, 'managed:merchant-a');
            assert.equal(instance.activeModelRouteId, 'managed:fixed:a-one');
            await Promise.resolve(); assert.deepEqual(calls, [], 'known missing-model confirmation waits for the user');
        } else {
            assert.equal(instance.pendingRelaySwitch, undefined, `${kind}: unknown coverage is not proof of absence`);
            assert.equal(instance.activeRelayKey, 'managed:merchant-b');
            assert.equal(instance.activeModelRouteId, ''); assert.equal(instance.selectedModelIds.coding, '');
            assert.equal(instance.activeKeyPriceQuoteId, undefined);
            if (kind === 'partial') {
                assert.equal(instance.merchantCatalogStatus, 'partial', 'fresh partial cache remains available with its continuation');
                assert.equal(instance.selectedMerchantCatalog.nextCursor, 'b-page-1');
            } else {
                assert.equal(instance.merchantCatalogStatus, 'loading');
                await instance.merchantCatalogInFlight.promise;
                assert.deepEqual(calls, ['merchant-b'], `${kind}: choosing the source itself initiates prefetch`);
                assert.deepEqual(instance.codingModelOptions('managed:merchant-b').map(model => model.id), ['provider/shared']);
                assert.equal(instance.activeModelRouteId, '', 'prefetch does not select even an exactly compatible model');
            }
        }
        assert.equal(instance.prompt, before.draftPrompt); assert.equal(instance.attachments, before.draftAttachments);
        assert.equal(instance.activeCodingSession().followUpQueue, before.followUpQueue);
    }
});
test('an old confirmation cannot change another conversation or choose a route removed by refresh', () => {
    const instance = fixture();
    instance.pendingRelaySwitch = { option: { key: 'managed:merchant-a' }, conversationId: 'another-session' };
    instance.confirmRelaySwitch(); assert.equal(instance.activeRelayKey, '');
    instance.pendingRelaySwitch = { option: { key: 'managed:removed' }, conversationId: 'session-a' };
    instance.confirmRelaySwitch(); assert.equal(instance.activeRelayKey, '');
});
test('stale model picker events cannot silently change the explicitly selected source', () => {
    const instance = fixture(); instance.selectRelay('managed:merchant-b');
    instance.selectModelOptionOnRelay('provider/shared', 'coding', 'managed:merchant-a');
    assert.equal(instance.activeRelayKey, 'managed:merchant-b'); assert.equal(instance.activeModelRouteId, '');
    instance.selectModelOptionOnRelay('other/shared', 'coding', 'managed:merchant-b');
    assert.equal(instance.activeModelRouteId, 'managed:fixed:b-one');
});
test('late official catalog response never selects its first route or reverts a newer explicit source', async () => {
    const instance = fixture(); let complete;
    instance.platformService = { getOfficialModelConnections: () => new Promise(resolve => { complete = resolve; }) };
    const loading = instance.loadOfficialModels();
    instance.selectRelay('managed:merchant-b');
    complete({ providers: [], connections: [] }); await loading;
    assert.equal(instance.activeRelayKey, 'managed:merchant-b'); assert.equal(instance.activeModelRouteId, '');
});
test('source-scoped model lists exclude global registry/suggestions/other merchants while full directory stays available', () => {
    const instance = fixture(); instance.registryModels = [{ id: 'registry-only', model: 'vendor/registry-only',
        label: 'Full directory', providerName: 'Vendor', available: false, input: ['text'], output: ['text'], capabilities: [] }];
    assert.deepEqual(instance.codingModelOptions('').map(model => model.id), []);
    assert.deepEqual(instance.codingModelOptions('managed:merchant-a').map(model => model.id), ['provider/shared', 'provider/unique']);
    assert.deepEqual(instance.codingModelOptions('managed:merchant-b').map(model => model.id), ['other/shared']);
    assert.ok(instance.codingModelOptions().some(model => model.id === 'registry-only'));
    assert.equal(instance.codingModelOptions('auto').length, 3);
});
test('personal API model discovery stays scoped to the explicitly selected connection, even for one provider', () => {
    const instance = fixture();
    const connection = (id, model) => ({ id, model, providerId: 'custom_openai', providerName: 'Compatible',
        discoveredModels: [{ id: `${model}-extra`, label: `${model} extra` }], capabilityEvidence: [] });
    instance.officialModels.connections = [connection('account-one', 'one'), connection('account-two', 'two')];
    assert.deepEqual(instance.codingModelOptions('official:account-one').map(model => model.id), ['custom_openai/one', 'custom_openai/one-extra']);
    assert.deepEqual(instance.codingModelOptions('official:account-two').map(model => model.id), ['custom_openai/two', 'custom_openai/two-extra']);
    assert.deepEqual(instance.codingModelOptions('').map(model => model.id), []);
    assert.deepEqual(instance.codingModelOptions('official:removed').map(model => model.id), []);
});
test('public merchants without quotations can be selected but cannot acquire an implicit model or send route', () => {
    const instance = fixture(); delete instance.relayOptions;
    instance.managedOfferings = () => [];
    instance.publicMerchantPage = { merchants: [{ id: 'no-quotes', name: 'Public, no quotations' }] };
    assert.equal(instance.relayPickerOptions()[0].directoryOnly, undefined, 'a public directory row remains selectable before quotations load');
    instance.selectRelay('managed:no-quotes'); instance.syncModelRoute();
    assert.equal(instance.activeRelayKey, 'managed:no-quotes'); assert.equal(instance.activeModelRouteId, '');
    assert.equal(instance.selectedModelIds.coding, ''); assert.equal(instance.activeModelRoute(), undefined);
    assert.equal(instance.activeCodingSession().relayKey, 'managed:no-quotes');
    assert.equal(instance.prompt, 'keep this draft'); assert.equal(instance.activeCodingSession().followUpQueue.length, 1);
    instance.publicMerchantPage = { merchants: [] };
    assert.deepEqual(instance.relayPickerOptions(), [], 'remembered selections are not a public listing authority');
    assert.equal(instance.activeRelayKey, 'managed:no-quotes', 'pagination cannot switch a selected source');
});
test('a favorite with stale local offerings is disabled only while absent from the refreshed directory', () => {
    const instance = fixture(); delete instance.relayOptions;
    instance.relaySourceTab = 'favorite';
    instance.favoriteMerchantLabels = new Map([['merchant-b', 'Merchant B']]);
    instance.managedOfferings = () => [{ ...offerings[2], network: { sampleCount: 0, availability: null, lastLatencyMs: null } }];
    instance.favoriteMerchantPage = { merchants: [] };
    const stale = instance.relayPickerOptions().find(option => option.merchantId === 'merchant-b');
    assert.ok(stale); assert.equal(stale.directoryOnly, true); assert.equal(stale.directoryStatus, 'unavailable');
    instance.favoriteMerchantPage = { merchants: [{ id: 'merchant-b', name: 'Merchant B' }] };
    const restored = instance.relayPickerOptions().find(option => option.merchantId === 'merchant-b');
    assert.ok(restored); assert.equal(restored.directoryOnly, undefined, 'directory recovery restores selection');
});
test('public drawer shows only the current public page, never other active quotations or remembered search results', () => {
    const instance = fixture();
    instance.publicMerchantPage = { merchants: [{ id: 'merchant-b', name: 'B' }] };
    assert.deepEqual(instance.relayPickerOptions().map(row => row.key), ['auto', 'managed:merchant-b']);
    instance.relaySourceQuery = 'merchant-b';
    assert.deepEqual(instance.relayPickerOptions().map(row => row.key), ['managed:merchant-b']);
});
test('public directory pagination and late search or account results never overwrite newer state or source selection', async () => {
    const instance = fixture(); const completions = [], requests = [];
    instance.selectRelay('managed:merchant-a');
    instance.platformService = { getPublicMerchantDirectory: request => {
        requests.push(request); return new Promise(resolve => completions.push(resolve));
    }, getMerchantDiscoveredModels: async merchantId => ({ merchantId, models: [], state: 'ready' }) };
    const first = instance.loadPublicMerchantPage();
    instance.relaySourceQuery = 'new'; const second = instance.loadPublicMerchantPage({ after: 'cursor-a' });
    completions[0]({ merchants: [{ id: 'old', name: 'Old' }] }); await first;
    assert.equal(instance.publicMerchantPage, undefined); assert.equal(instance.publicMerchantPageLoading, true);
    completions[1]({ merchants: [{ id: 'new', name: 'New' }] }); await second;
    assert.equal(instance.publicMerchantPage.merchants[0].id, 'new'); assert.equal(instance.publicMerchantPageLoading, false);
    assert.deepEqual(requests[1], { query: 'new', sort: 'quality', direction: 'desc', after: 'cursor-a' });
    const third = instance.loadPublicMerchantPage({ before: 'new' });
    instance.platformSession = { linked: true, user: { id: 'different-owner' } };
    completions[2]({ merchants: [{ id: 'old-owner', name: 'Old owner result' }] }); await third;
    assert.equal(instance.publicMerchantPage, undefined);
    assert.equal(instance.activeRelayKey, 'managed:merchant-a'); assert.equal(instance.activeModelRouteId, '');
    assert.equal(instance.prompt, 'keep this draft');
});
test('server sort scopes every page; changing sort drops stale cursor/results and preserves 150-row global order', async () => {
    const instance = fixture(); delete instance.relayOptions;
    instance.managedOfferings = () => [];
    const calls = [], rows = Array.from({ length: 150 }, (_, index) => ({ id: `sort-${index}`, name: `Name ${149 - index}`, metrics: { latencyMs: index } }));
    let releaseOld;
    instance.platformService = { getPublicMerchantDirectory: async request => {
        calls.push(request);
        if (request.sort === 'quality') return new Promise(resolve => { releaseOld = resolve; });
        return { merchants: request.after ? rows.slice(100) : rows.slice(0, 100), ...(request.after ? {} : { nextCursor: 'latency-scope' }) };
    } };
    const old = instance.loadPublicMerchantPage();
    instance.setRelaySortMode('latency');
    await new Promise(resolve => setImmediate(resolve));
    releaseOld({ merchants: [{ id: 'old-quality', name: 'Do not overwrite' }] }); await old;
    await instance.loadPublicMerchantPage({ after: instance.publicMerchantPage.nextCursor });
    assert.equal(instance.publicMerchantPage.merchants.length, 150);
    assert.deepEqual(instance.relayPickerOptions().filter(row => row.kind === 'managed').map(row => row.merchantId), rows.map(row => row.id));
    assert.deepEqual(calls.slice(1), [{ query: '', sort: 'latency', direction: 'asc' }, { query: '', sort: 'latency', direction: 'asc', after: 'latency-scope' }]);
    instance.setRelaySortMode('price'); await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.at(-1).sort, 'multiplier'); assert.equal(calls.at(-1).after, undefined);
});
test('favorites are refreshed in bounded public-ID chunks and never display banned or unrelated stale rows', async () => {
    const instance = fixture(); delete instance.relayOptions;
    instance.managedOfferings = () => [];
    instance.relaySourceTab = 'favorite';
    const ids = Array.from({ length: 256 }, (_, index) => `fav-${String(index).padStart(3, '0')}`);
    instance.favoriteMerchantLabels = new Map(ids.map(id => [id, `Remembered ${id}`]));
    instance.publicMerchantPage = { merchants: [{ id: 'unrelated', name: 'Must not leak' }] };
    const calls = [];
    instance.platformService = { getPublicMerchantDirectory: async request => {
        calls.push(request); return { merchants: request.merchantIds.filter(id => id !== ids[0]).map(id => ({ id, name: `Current ${id}`, metrics: { quality: 75, latencyMs: 123 } })) };
    } };
    await instance.loadPublicMerchantPage();
    assert.deepEqual(calls.map(call => call.merchantIds.length), [100, 100, 56]);
    assert.ok(calls.every(call => call.sort === 'quality' && call.direction === 'desc'));
    const options = instance.relayPickerOptions(); assert.equal(options.length, 256);
    const stale = options.find(option => option.merchantId === ids[0]);
    assert.ok(stale); assert.equal(stale.label, `Remembered ${ids[0]}`); assert.equal(stale.directoryOnly, true);
    assert.ok(options.filter(option => option.merchantId !== ids[0]).every(option => option.label.startsWith('Current ') && option.quality === 75 && option.latencyMs === 123));
    assert.ok(!options.some(option => option.merchantId === 'unrelated'));
    instance.platformService.getPublicMerchantDirectory = async () => { throw new Error('synthetic unavailable'); };
    await instance.loadPublicMerchantPage(); assert.equal(instance.publicMerchantPageError, true);
    const failedDirectory = instance.relayPickerOptions();
    assert.equal(failedDirectory.length, 256, 'a failed refresh keeps saved names visible');
    assert.ok(failedDirectory.every(option => option.directoryOnly !== true), 'a failed refresh never falsely disables a saved route');
});
test('selected merchant models beyond the global 500 limit load in bounded batches without selecting a model or changing the full model center catalog', async () => {
    const instance = fixture(); delete instance.managedOfferings;
    instance.activeRelayKey = 'managed:large';
    instance.codingSessions[0] = { ...instance.codingSessions[0], relayKey: 'managed:large' };
    const originalCatalog = instance.platformCatalog; const calls = [];
    instance.platformService = { getMerchantCatalog: async (merchantId, after) => {
        calls.push({ merchantId, after });
        const start = after ? Number(after.slice('model-'.length)) + 1 : 0;
        const rows = Array.from({ length: Math.min(100, 2201 - start) }, (_, offset) => {
            const index = start + offset;
            return { ...offerings[0], id: `model-${String(index).padStart(4, '0')}`, merchantId, canonicalModel: `provider/model-${index}`,
                registryModelId: `registry-${index}`, status: 'active', workbenches: ['coding'] };
        });
        return { online: true, merchantId, offerings: rows, ...(start + rows.length < 2201 ? { nextCursor: rows.at(-1).id } : {}) };
    }, getMerchantDiscoveredModels: async merchantId => ({ merchantId, models: [], state: 'ready' }) };
    await instance.loadSelectedMerchantCatalog('large');
    assert.equal(calls.length, 20); assert.equal(instance.merchantCatalogStatus, 'partial');
    assert.equal(instance.codingModelOptions('managed:large').length, 2000);
    await instance.loadSelectedMerchantCatalog('large', true);
    assert.equal(calls.length, 23); assert.equal(instance.merchantCatalogStatus, 'ready');
    assert.equal(instance.codingModelOptions('managed:large').length, 2201);
    assert.equal(instance.activeRelayKey, 'managed:large'); assert.equal(instance.activeModelRouteId, ''); assert.equal(instance.selectedModelIds.coding, '');
    assert.equal(instance.platformCatalog, originalCatalog); assert.equal(instance.prompt, 'keep this draft');
});
test('failed and stale scoped model reads are never labeled empty and cannot alter another selected source', async () => {
    const instance = fixture(); instance.activeRelayKey = 'managed:merchant-a';
    instance.codingSessions[0] = { ...instance.codingSessions[0], relayKey: 'managed:merchant-a' };
    instance.platformService = { getMerchantCatalog: async () => { throw new Error('PRIVATE_UPSTREAM_ERROR'); },
        getMerchantDiscoveredModels: async merchantId => ({ merchantId, models: [], state: 'ready' }) };
    await instance.loadSelectedMerchantCatalog('merchant-a');
    assert.equal(instance.merchantCatalogStatus, 'failed'); assert.equal(instance.selectedMerchantCatalog, undefined);
    let complete;
    instance.platformService.getMerchantCatalog = () => new Promise(resolve => { complete = resolve; });
    const loading = instance.loadSelectedMerchantCatalog('merchant-a');
    await Promise.resolve();
    instance.activeRelayKey = 'managed:merchant-b';
    complete({ merchantId: 'merchant-a', online: true, offerings: [offerings[0]] }); await loading;
    assert.equal(instance.selectedMerchantCatalog, undefined); assert.equal(instance.activeRelayKey, 'managed:merchant-b');
});

test('unpriced discovery stays visible but unavailable in the model drawer and cannot acquire a dispatch route', () => {
    const instance = fixture();
    instance.merchantDiscoveredModels.set('merchant-a', [
        { id: 'provider/shared', displayName: 'Shared', execution: { state: 'executable', listingIds: ['a-one'] }, input: ['text'], output: ['text'], capabilities: ['tools'] },
        { id: 'provider/new-model', displayName: 'New model', execution: { state: 'pending', listingIds: [] }, multiplierBps: 12500, input: ['text'], output: ['text'], capabilities: [] }
    ]);
    const models = instance.codingModelOptions('managed:merchant-a');
    assert.equal(models.filter(model => model.id === 'provider/shared').length, 1);
    const unpriced = models.find(model => model.id === 'provider/new-model');
    assert.ok(unpriced, 'authenticated discovery remains visible');
    assert.equal(unpriced.available, false); assert.equal(unpriced.listingPending, true);
    assert.equal(unpriced.discoveredMultiplierBps, 12500);
    assert.ok(!instance.codingModelOptions('managed:merchant-b').some(model => model.id === 'provider/new-model'));
    instance.activeRelayKey = 'managed:merchant-a';
    instance.selectModelOptionOnRelay('provider/new-model', 'coding', 'managed:merchant-a');
    assert.equal(instance.activeModelRouteId, '', 'an discovered model does not bypass listing, capability or billing authorization');
});

test('returning to a source paints cached models immediately and a successful refresh removes revoked models', async () => {
    const instance = fixture(); instance.activeRelayKey = 'managed:merchant-a';
    instance.codingSessions[0] = { ...instance.codingSessions[0], relayKey: 'managed:merchant-a' };
    const catalog = { merchantId: 'merchant-a', online: true, offerings: [offerings[0]] };
    instance.merchantPickerSnapshots.set('merchant-a', { catalog, updatedAt: 0 });
    let finishCatalog;
    instance.platformService = {
        getMerchantCatalog: () => new Promise(resolve => { finishCatalog = resolve; }),
        getMerchantDiscoveredModels: () => { throw new Error('Composer must not depend on raw discovery'); }
    };
    const loading = instance.loadSelectedMerchantCatalog('merchant-a');
    assert.equal(instance.selectedMerchantCatalog, catalog);
    // Stale-while-revalidate: the known list stays usable, with no “loading” state, while it refreshes.
    assert.equal(instance.merchantCatalogStatus, 'ready');
    await Promise.resolve();
    finishCatalog({ ...catalog, offerings: [] });
    await loading;
    assert.deepEqual(instance.selectedMerchantCatalog.offerings, []);
    assert.equal(instance.merchantCatalogStatus, 'ready');
    assert.deepEqual(instance.merchantPickerSnapshots.get('merchant-a').catalog.offerings, []);
});

test('composer merchant listings never borrow the truncated global catalog or another merchant snapshot', () => {
    const instance = fixture(); delete instance.managedOfferings;
    instance.platformCatalog.offerings = offerings.map(row => ({ ...row, status: 'active', workbenches: ['coding'] }));
    assert.equal(instance.managedOfferings('coding').length, 3, 'Model Center retains the public full-directory entry point');
    assert.deepEqual(instance.managedOfferings('coding', 'merchant-a'), [], 'initial composer rows cannot masquerade as a source cache');
    instance.merchantPickerSnapshots.set('merchant-a', { catalog: { merchantId: 'merchant-b', offerings: instance.platformCatalog.offerings }, updatedAt: Date.now() });
    assert.deepEqual(instance.managedOfferings('coding', 'merchant-a'), []);
    instance.merchantPickerSnapshots.set('merchant-a', { catalog: { merchantId: 'merchant-a', offerings: instance.platformCatalog.offerings }, updatedAt: Date.now() });
    assert.deepEqual(instance.managedOfferings('coding', 'merchant-a').map(row => row.id), ['a-one', 'a-two']);
});

test('selecting a merchant prefetches before opening the model drawer; opening and reopening reuse in-flight work and fresh cache', async () => {
    const instance = fixture(); let finish; const calls = [];
    instance.platformService = { getMerchantCatalog: (merchantId, after) => {
        calls.push({ merchantId, after }); return new Promise(resolve => { finish = resolve; });
    }, getMerchantDiscoveredModels: () => { throw new Error('Raw discovery is not required to use a model'); } };
    instance.selectRelay('managed:merchant-a');
    assert.equal(instance.codingPopover, ''); assert.equal(instance.merchantCatalogStatus, 'loading');
    assert.equal(instance.activeModelRouteId, ''); assert.equal(instance.selectedModelIds.coding, '');
    const prefetch = instance.merchantCatalogInFlight.promise;
    await Promise.resolve(); assert.equal(calls.length, 1, 'selection alone started loading');
    instance.toggleCodingPopover('routes');
    assert.equal(instance.merchantCatalogInFlight.promise, prefetch);
    finish({ merchantId: 'merchant-a', online: true, offerings: [offerings[0]] }); await prefetch;
    instance.toggleCodingPopover('routes'); instance.toggleCodingPopover('routes');
    await Promise.resolve(); assert.equal(calls.length, 1, 'close/reopen must not refetch or select a model');
    assert.equal(instance.merchantCatalogStatus, 'ready'); assert.equal(instance.activeModelRouteId, '');
    instance.merchantPickerSnapshots.get('merchant-a').updatedAt = 0;
    instance.toggleCodingPopover('routes'); instance.toggleCodingPopover('routes');
    assert.equal(instance.selectedMerchantCatalog.offerings[0].id, 'a-one', 'stale cache paints while refreshing');
    const refresh = instance.merchantCatalogInFlight.promise; await Promise.resolve(); assert.equal(calls.length, 2);
    finish({ merchantId: 'merchant-a', online: true, offerings: [offerings[1]] }); await refresh;
    assert.deepEqual(instance.selectedMerchantCatalog.offerings.map(row => row.id), ['a-two']);
});

test('pending supplementary discovery does not repeatedly scan or discard executable priced listings', async () => {
    const instance = fixture({ relayKey: 'managed:merchant-a' }); instance.activeRelayKey = 'managed:merchant-a';
    let catalogCalls = 0, discoveryCalls = 0;
    instance.platformService = { getMerchantCatalog: async merchantId => {
        catalogCalls++; return { merchantId, online: true, offerings: [offerings[0]], discoveryPending: true };
    }, getMerchantDiscoveredModels: async () => { discoveryCalls++; throw new Error('supplementary discovery unavailable'); } };
    instance.managedOfferings = (_workbench, merchantId) => merchantId === 'merchant-a' ? (instance.selectedMerchantCatalog?.offerings || []) : [];
    await instance.loadSelectedMerchantCatalog('merchant-a');
    assert.equal(catalogCalls, 1, 'pending supplementary metadata must not cause repeated complete catalog scans');
    assert.equal(discoveryCalls, 1, 'supplementary evidence has an independent bounded attempt');
    assert.equal(instance.merchantCatalogStatus, 'ready', 'priced usable listings survive supplementary discovery failure');
    assert.equal(instance.selectedMerchantCatalog.discoveryPending, true);
    assert.deepEqual(instance.codingModelOptions('managed:merchant-a').map(model => model.id), ['provider/shared']);
    assert.equal(instance.activeModelRouteId, '', 'prefetch does not select or dispatch a priced model');
});

test('an empty pending discovery finishes its read without inventing executable routes', async () => {
    const instance = fixture({ relayKey: 'managed:merchant-a' }); instance.activeRelayKey = 'managed:merchant-a';
    delete instance.managedOfferings; delete instance.routesForRelay;
    let catalogCalls = 0, discoveryCalls = 0;
    instance.platformService = { getMerchantCatalog: async merchantId => {
        catalogCalls++; return { merchantId, online: true, offerings: [], discoveryPending: true };
    }, getMerchantDiscoveredModels: async merchantId => {
        discoveryCalls++; return { merchantId, models: [], state: 'pending' };
    } };
    await instance.loadSelectedMerchantCatalog('merchant-a');
    assert.equal(catalogCalls, 1); assert.equal(discoveryCalls, 1);
    assert.notEqual(instance.merchantCatalogStatus, 'loading', 'a completed bounded read cannot leave a permanent spinner');
    assert.equal(instance.selectedMerchantCatalog.discoveryPending, true);
    assert.deepEqual(instance.codingModelOptions('managed:merchant-a'), []);
    assert.deepEqual(instance.routesForRelay('managed:merchant-a', 'coding'), [], 'pending discovery creates no priced dispatch route');
});

test('a failed later refresh page keeps its accepted rows and explicit continuation resumes past the accepted cursor', async () => {
    const instance = fixture({ relayKey: 'managed:merchant-a' }); instance.activeRelayKey = 'managed:merchant-a';
    const catalog = { merchantId: 'merchant-a', online: true, offerings: [...offerings.slice(0, 2)] };
    instance.selectedMerchantCatalog = catalog;
    instance.merchantPickerSnapshots.set('merchant-a', { catalog, updatedAt: 0 });
    const calls = []; let fail = true;
    instance.platformService = { getMerchantCatalog: async (_merchantId, after) => {
        calls.push(after);
        if (after) { if (fail) throw new Error('temporary network failure'); return { ...catalog, offerings: [offerings[1]] }; }
        return { ...catalog, offerings: [offerings[0]], nextCursor: 'a-one' };
    } };
    // A quiet background refresh that fails part-way keeps the complete known list, without an error.
    await instance.loadSelectedMerchantCatalog('merchant-a');
    assert.equal(instance.merchantCatalogStatus, 'ready');
    assert.ok(!instance.merchantCatalogError);
    assert.deepEqual(instance.selectedMerchantCatalog.offerings.map(row => row.id), ['a-one', 'a-two']);
    calls.length = 0;
    // An explicit refresh shows each accepted page and offers continuation.
    await instance.loadSelectedMerchantCatalog('merchant-a', false, true);
    assert.equal(instance.merchantCatalogStatus, 'partial');
    assert.deepEqual(instance.selectedMerchantCatalog.offerings.map(row => row.id), ['a-one']);
    assert.equal(instance.selectedMerchantCatalog.nextCursor, 'a-one');
    assert.equal(instance.merchantPickerSnapshots.get('merchant-a').catalog, instance.selectedMerchantCatalog);
    instance.merchantPickerSnapshots.get('merchant-a').updatedAt = Date.now(); fail = false;
    await instance.loadSelectedMerchantCatalog('merchant-a', true);
    assert.deepEqual(calls, [undefined, 'a-one', 'a-one']);
    assert.equal(instance.merchantCatalogStatus, 'ready'); assert.equal(instance.selectedMerchantCatalog.offerings.length, 2);
});

test('official variant prices survive service normalization and a forced merchant refresh replaces stale models across pages', async () => {
    const quotes = JSON.parse(readFileSync(new URL('./fixtures/public-official-variant-prices.json', import.meta.url), 'utf8'));
    const instance = fixture({ relayKey: 'managed:merchant-a' }); instance.activeRelayKey = 'managed:merchant-a';
    delete instance.managedOfferings;
    const globalBefore = instance.platformCatalog;
    const old = { ...offerings[0], id: 'old-model', canonicalModel: 'vendor/delisted', status: 'active', workbenches: ['coding'] };
    const rows = quotes.map((quote, index) => ({ ...old, ...quote, id: index ? 'a-astra' : 'b-haiku', registryModelId: `new-${index}` })).sort((a, b) => a.id.localeCompare(b.id));
    const discovered = row => ({ id: row.canonicalModel, canonicalModel: row.canonicalModel, displayName: row.canonicalModel,
        input: ['text'], output: ['text'], capabilities: ['tools'], discoveredAt: 1, multiplierBps: 10000, listingIds: [row.id],
        execution: { state: 'executable', listingIds: [row.id] }, ...(row.pricingDetails ? { pricing: [{ ...row.pricingDetails, listingId: row.id }] } : {}) });
    class PublicFixture extends NextMuxPlatformServiceImpl {
        phase = 0; requests = [];
        async request(path) {
            this.requests.push(path);
            const url = new URL(path, 'https://fixture.invalid');
            if (url.pathname === '/api/catalog') {
                assert.equal(url.searchParams.get('merchantId'), 'merchant-a', 'never fetch the unrelated global catalog');
                return this.phase === 0 ? { offerings: [old] } : this.phase === 2 ? { offerings: [] }
                    : url.searchParams.get('after') ? { offerings: [rows[1]] } : { offerings: [rows[0]], nextCursor: rows[0].id };
            }
            assert.equal(url.pathname, '/api/merchants/public/merchant-a/models');
            return { merchantId: 'merchant-a', state: 'ready', measuredAt: '2026-09-20T00:00:00.000Z',
                models: (this.phase === 0 ? [old] : this.phase === 1 ? rows : []).map(discovered).sort((a, b) => a.id.localeCompare(b.id)) };
        }
    }
    const service = instance.platformService = new PublicFixture();
    await instance.loadSelectedMerchantCatalog('merchant-a');
    assert.deepEqual(instance.codingModelOptions('managed:merchant-a').map(row => row.id), ['vendor/delisted']);
    service.phase = 1;
    await instance.loadSelectedMerchantCatalog('merchant-a', false, true);
    assert.equal(instance.merchantCatalogStatus, 'ready');
    assert.deepEqual(new Set(instance.codingModelOptions('managed:merchant-a').map(row => row.id)), new Set(quotes.map(row => row.canonicalModel)));
    assert.equal(instance.selectedMerchantCatalog.offerings.length, 2);
    assert.equal(instance.platformCatalog, globalBefore, 'merchant refresh neither needs nor mutates global catalog cache');
    const calls = service.requests.length;
    await instance.loadSelectedMerchantCatalog('merchant-a');
    await instance.loadSelectedMerchantCatalog('merchant-a', true);
    assert.equal(service.requests.length, calls, 'fresh reopened/complete pages do not redownload a full directory');
    service.phase = 2;
    await instance.loadSelectedMerchantCatalog('merchant-a', false, true);
    assert.deepEqual(instance.codingModelOptions('managed:merchant-a'), [], 'a successful refresh removes listings and discovery rows together');
    assert.equal(instance.merchantCatalogStatus, 'ready');
    assert.equal(instance.activeModelRouteId, '', 'directory reads never select a route or authorize a request');
});

test('reselecting a restored merchant starts missing prefetch without resetting its selected model or quote', async () => {
    const instance = fixture({ relayKey: 'managed:merchant-a', routeId: 'managed:fixed:a-one', modelId: 'provider/shared' });
    instance.activeRelayKey = 'managed:merchant-a'; instance.activeModelRouteId = 'managed:fixed:a-one';
    instance.selectedModelIds.coding = 'provider/shared'; const calls = []; let finish;
    instance.platformService = { getMerchantCatalog: merchantId => {
        calls.push(merchantId); return new Promise(resolve => { finish = resolve; });
    } };
    instance.selectRelay('managed:merchant-a'); const first = instance.merchantCatalogInFlight.promise;
    instance.selectRelay('managed:merchant-a');
    assert.equal(instance.merchantCatalogInFlight.promise, first);
    assert.equal(instance.activeModelRouteId, 'managed:fixed:a-one');
    assert.equal(instance.selectedModelIds.coding, 'provider/shared');
    assert.equal(instance.activeCodingSession().routeId, 'managed:fixed:a-one');
    await Promise.resolve(); assert.deepEqual(calls, ['merchant-a']);
    finish({ merchantId: 'merchant-a', offerings: [offerings[0]] }); await first;
    instance.selectRelay('managed:merchant-a'); await Promise.resolve();
    assert.deepEqual(calls, ['merchant-a'], 'reselecting again reuses the fresh source cache');
    assert.equal(instance.activeModelRouteId, 'managed:fixed:a-one');
    assert.equal(instance.selectedModelIds.coding, 'provider/shared');
});

test('first-load pagination failures retain successful rows and retry continues at the last accepted cursor', async () => {
    const instance = fixture({ relayKey: 'managed:merchant-a' }); instance.activeRelayKey = 'managed:merchant-a'; const calls = []; let fail = true;
    instance.platformService = { getMerchantCatalog: async (merchantId, after) => {
        calls.push(after);
        if (!after) return { merchantId, offerings: [offerings[0]], nextCursor: 'a-one' };
        if (fail) throw new Error('temporary network failure');
        return { merchantId, offerings: [offerings[1]] };
    } };
    await instance.loadSelectedMerchantCatalog('merchant-a');
    assert.equal(instance.merchantCatalogStatus, 'partial'); assert.equal(instance.selectedMerchantCatalog.nextCursor, 'a-one');
    assert.deepEqual(instance.selectedMerchantCatalog.offerings.map(row => row.id), ['a-one']);
    fail = false; await instance.loadSelectedMerchantCatalog('merchant-a', true);
    assert.deepEqual(calls, [undefined, 'a-one', 'a-one']);
    assert.deepEqual(instance.selectedMerchantCatalog.offerings.map(row => row.id), ['a-one', 'a-two']);
    assert.equal(instance.merchantCatalogStatus, 'ready');
});

test('forced refresh supersedes stale success without allowing an older finally to clear the new request', async () => {
    const instance = fixture({ relayKey: 'managed:merchant-a' }); instance.activeRelayKey = 'managed:merchant-a'; const completions = [];
    instance.platformService = { getMerchantCatalog: () => new Promise(resolve => completions.push(resolve)) };
    const stale = instance.loadSelectedMerchantCatalog('merchant-a'); await Promise.resolve();
    const fresh = instance.loadSelectedMerchantCatalog('merchant-a', false, true); await Promise.resolve();
    const freshInFlight = instance.merchantCatalogInFlight;
    completions[0]({ merchantId: 'merchant-a', offerings: [offerings[0]] }); await stale;
    assert.equal(instance.selectedMerchantCatalog, undefined); assert.equal(instance.merchantCatalogInFlight, freshInFlight);
    completions[1]({ merchantId: 'merchant-a', offerings: [offerings[1]] }); await fresh;
    assert.deepEqual(instance.selectedMerchantCatalog.offerings.map(row => row.id), ['a-two']);
    assert.equal(instance.merchantCatalogInFlight, undefined);
});

test('merchant changes and account changes invalidate pending results and never populate another source cache', async () => {
    const instance = fixture(); instance.activeRelayKey = 'managed:merchant-a'; const completions = [];
    instance.platformService = { getMerchantCatalog: () => new Promise(resolve => completions.push(resolve)) };
    const oldSource = instance.loadSelectedMerchantCatalog('merchant-a'); await Promise.resolve();
    instance.activeRelayKey = 'managed:merchant-b';
    const newSource = instance.loadSelectedMerchantCatalog('merchant-b'); await Promise.resolve();
    completions[0]({ merchantId: 'merchant-a', offerings: [offerings[0]] }); await oldSource;
    assert.equal(instance.selectedMerchantCatalog, undefined); assert.equal(instance.merchantPickerSnapshots.size, 0);
    instance.platformSession = { linked: true, user: { id: 'new-owner' } };
    completions[1]({ merchantId: 'merchant-b', offerings: [offerings[2]] }); await newSource;
    assert.equal(instance.selectedMerchantCatalog, undefined); assert.equal(instance.merchantPickerSnapshots.size, 0);
});

test('returning to the original account never deduplicates against its invalidated previous request', async () => {
    for (const intermediate of [{ linked: true, user: { id: 'owner-b' } }, { linked: false }]) {
        const instance = fixture({ relayKey: 'managed:merchant-a' }); instance.activeRelayKey = 'managed:merchant-a';
        const owner = { linked: true, user: { id: 'owner-a' } }, completions = [];
        instance.platformService = { getMerchantCatalog: () => new Promise(resolve => completions.push(resolve)) };
        instance.applyPlatformSession(owner);
        const old = instance.loadSelectedMerchantCatalog('merchant-a'); await Promise.resolve();
        instance.applyPlatformSession(intermediate); instance.applyPlatformSession(owner);
        const fresh = instance.loadSelectedMerchantCatalog('merchant-a'); await Promise.resolve();
        assert.equal(completions.length, 2, 'returning owner needs a new request even when the old promise is still pending');
        const freshInFlight = instance.merchantCatalogInFlight;
        completions[0]({ merchantId: 'merchant-a', offerings: [offerings[0]] }); await old;
        assert.equal(instance.merchantCatalogInFlight, freshInFlight, 'invalidated finally cannot clear the new request');
        assert.equal(instance.selectedMerchantCatalog, undefined); assert.equal(instance.merchantPickerSnapshots.size, 0);
        completions[1]({ merchantId: 'merchant-a', offerings: [offerings[1]] }); await fresh;
        assert.equal(instance.merchantCatalogInFlight, undefined); assert.equal(instance.merchantCatalogStatus, 'ready');
        assert.deepEqual(instance.selectedMerchantCatalog.offerings.map(row => row.id), ['a-two']);
        assert.deepEqual(instance.merchantPickerSnapshots.get('merchant-a').catalog.offerings.map(row => row.id), ['a-two']);
    }
});

test('wrong-source responses and repeated cursors fail closed instead of looping or polluting cache', async () => {
    for (const response of [
        { merchantId: 'merchant-b', offerings: [offerings[2]] },
        { merchantId: 'merchant-a', offerings: [offerings[2]] }
    ]) {
        const instance = fixture(); instance.activeRelayKey = 'managed:merchant-a';
        instance.platformService = { getMerchantCatalog: async () => response };
        await instance.loadSelectedMerchantCatalog('merchant-a');
        assert.equal(instance.merchantCatalogStatus, 'failed'); assert.equal(instance.merchantPickerSnapshots.size, 0);
    }
    const instance = fixture({ relayKey: 'managed:merchant-a' }); instance.activeRelayKey = 'managed:merchant-a'; let calls = 0;
    instance.platformService = { getMerchantCatalog: async merchantId => { calls++; return { merchantId, offerings: [offerings[0]], nextCursor: 'a-one' }; } };
    await instance.loadSelectedMerchantCatalog('merchant-a');
    assert.equal(calls, 2, 'a repeated cursor terminates pagination immediately'); assert.equal(instance.merchantCatalogStatus, 'partial');
    assert.deepEqual(instance.selectedMerchantCatalog.offerings.map(row => row.id), ['a-one']);
});

test('model display preferences filter the picker without removing saved dispatch routes', () => {
    const render = method('renderCodingWorkbench');
    assert.match(render, /const visibleModelOptions = pickerPartition\.selectable/);
    assert.match(render, /model\.available && this\.isModelVisible\(model\.model\)/);
    assert.match(render, /renderModelPickerOption\(model, modelRouteById\.has\(model\.variantOf \?\? model\.id\)\)/);
    assert.doesNotMatch(render, /modelOptions\.filter\(model => !modelRouteById\.has/);
});
test('model center layout does not call the composer drawer; only its model picker passes a source scope', () => {
    assert.doesNotMatch(method('renderModelCenter'), /renderRelayPopover|renderRelayPickerPortal|nmx-relay-source-tabs/);
    // One drawer: the coding composer's, reused as is by the 漫剧 conversation (its own portal and anchor).
    assert.equal((source.match(/this\.renderRelayPopover\(\)/g) || []).length, 2);
    assert.match(method('renderComicRelayPickerPortal'), /this\.renderRelayPopover\(\)/);
    assert.match(method('renderCodingWorkbench'), /this\.codingModelOptions\(this\.activeRelayKey\)/);
    assert.doesNotMatch(method('renderCodingWorkbench'), /merchantOfferingMatch/);
    const css = readFileSync(new URL('../src/browser/style/nextmux.css', import.meta.url), 'utf8');
    for (const selector of css.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
        if (/nmx-relay-source-tabs|nmx-relay-source-search|nmx-relay-merchant-id/.test(selector[1])) {
            for (const part of selector[1].split(',')) {
                // The shared composer focus treatment is still nested beneath
                // its picker surface; do not permit unscoped source controls.
                if (part.trim() === '.nmx-shell .nmx-model-picker-popover .nmx-relay-source-search:focus-within') continue;
                assert.match(part, /\.nmx-model-picker-relay-view /);
            }
        }
    }
});
test('a new chat saved on a deleted own API moves to one that answers chat; a chat that already ran keeps its source', async () => {
    const connection = { id: 'account-left', model: 'one', providerId: 'openrouter', providerName: 'OpenRouter', label: 'OpenRouter', discoveredModels: [], capabilityEvidence: [] };
    const media = { id: 'account-video', model: 'video_x', providerId: 'custom_media', providerName: 'Media', label: 'Media', discoveredModels: [], capabilityEvidence: [] };
    const run = async turns => {
        const instance = fixture({ turns, relayKey: 'official:account-removed' });
        const baseOptions = instance.relayOptions.bind(instance);
        instance.relayOptions = () => [...baseOptions(), { key: 'official:account-video', kind: 'official', label: 'Media', modelCount: 1 },
            { key: 'official:account-left', kind: 'official', label: 'OpenRouter', modelCount: 0 }];
        instance.activeRelayKey = 'official:account-removed';
        instance.platformService = { getOfficialModelConnections: async () => ({ providers: [], connections: [media, connection] }) };
        await instance.loadOfficialModels();
        return instance.activeRelayKey;
    };
    // The model count from the cloud list is not needed; a video-only API is never picked for chat.
    assert.equal(await run([]), 'official:account-left');
    assert.equal(await run([{ id: 'turn' }]), 'official:account-removed');
});
