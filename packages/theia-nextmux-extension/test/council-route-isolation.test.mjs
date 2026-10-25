import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const names = ['councilRoutesForRelay', 'councilCandidateModelsForRelay', 'syncCouncilModalSlotsWithRelay',
    'selectCouncilSlotModel', 'openCouncilConfigModal', 'selectCouncilModalRelay', 'saveCouncilConfigModal', 'closeCouncilConfigModal'];
const methods = names.map(name => widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === name).getText(ast)).join('\n');
const js = ts.transpileModule(`class Harness { ${methods} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const councilModule = { exports: {} };
const councilJs = ts.transpileModule(readFileSync(new URL('../../agent-runtime/src/council.ts', import.meta.url), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
Function('require', 'module', 'exports', councilJs)(createRequire(import.meta.url), councilModule, councilModule.exports);
const viewSource = readFileSync(new URL('../src/browser/nextmux-council-mode-view.tsx', import.meta.url), 'utf8');
const viewAst = ts.createSourceFile('view.tsx', viewSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const defaultsSource = viewAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'createDefaultCouncilDraftSlots').getText(viewAst).replace(/^export /, '');
const defaultsJs = ts.transpileModule(defaultsSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const createDefaults = Function('MIN_COUNCIL_SLOTS', 'normalizeAgentCouncilRoleId', `${defaultsJs}; return createDefaultCouncilDraftSlots;`)(3, councilModule.exports.normalizeAgentCouncilRoleId);
const Harness = Function('createDefaultCouncilDraftSlots', 'validateAgentCouncilConfig', 'normalizeAgentCouncilRoleId', 'councilValidationMessage', 'offeringMultiplierBps', 'offeringIsOwnPriced', `${js}; return Harness;`)
    (createDefaults, councilModule.exports.validateAgentCouncilConfig, councilModule.exports.normalizeAgentCouncilRoleId, (_locale, error) => error, () => undefined, () => false);
const route = (id, model = 'same-model', merchant = 'a') => ({ id, kind: 'managed_gateway', model,
    offering: { merchantId: merchant, providerName: merchant } });
function fixture(routes = []) {
    const host = new Harness();
    Object.assign(host, {
        councilModalRelayKey: 'managed:a', activeRelayKey: 'official:other', activeCodingSessionId: 'session',
        councilModalRouteError: false, councilConfigModalOpen: true,
        councilConfigsBySession: new Map(), pendingCouncilConfigsBySession: new Map(),
        invalidCouncilConfigsBySession: new Map(), invalidCouncilConfigEntry: () => undefined,
        invalidCouncilConfigMessage: () => '', councilConfigForEditing() { return this.effectiveCouncilConfig(); },
        councilModalSlots: [], routesForRelay: () => routes, managedModelRoutes: () => [],
        publicMerchantPage: {}, closeNavigationSurface() {}, loadSelectedMerchantCatalog: async () => {},
        modelRoutes: () => { throw Error('must not use the composer’s unrelated provider'); },
        offeringMerchantId: offering => offering.merchantId, modelKeyForRoute: candidate => candidate.model,
        scheduleRouteModelLabel: candidate => candidate.id, relayPickerOptions: () => [], relayOption: () => ({ label: 'A' }),
        sessionCouncilKey: () => 'session', effectiveCouncilConfig: () => undefined, isCodingSessionRunning: () => false,
        managedModelRoute: candidate => ({ offeringId: candidate.id }), persistCouncilConfigs() {}, update() {}
    });
    return host;
}
const slots = routeId => [
    { slotId: 'lead', routeId, modelId: 'same-model', roles: ['lead'] },
    { slotId: 'ui', routeId, modelId: 'same-model', roles: ['frontend'] },
    { slotId: 'other', routeId, modelId: 'same-model', roles: ['generalist'] }
];

test('an empty selected provider never borrows another provider’s routes', () => {
    const host = fixture();
    host.managedModelRoutes = () => [route('foreign', 'same-model', 'b')];
    assert.deepEqual(host.councilRoutesForRelay('managed:a'), []);
    assert.deepEqual(host.councilRoutesForRelay('official:deleted'), []);
    assert.deepEqual(host.councilRoutesForRelay(''), []);
    host.managedModelRoutes = () => [route('a1'), route('foreign', 'same-model', 'b')];
    assert.deepEqual(host.councilRoutesForRelay('managed:a').map(item => item.id), ['a1']);
});

test('new Council configuration stays empty until an explicit source is selected', () => {
    const host = fixture([route('a1'), route('a2')]);
    host.relayPickerOptions = () => [{ key: 'managed:a', kind: 'managed', label: 'A' }];
    host.openCouncilConfigModal();
    assert.equal(host.councilModalRelayKey, '');
    assert.deepEqual(host.councilModalSlots, []);
    host.syncCouncilModalSlotsWithRelay('');
    assert.deepEqual(host.councilModalSlots, []);
    host.selectCouncilModalRelay('managed:a');
    assert.equal(host.councilModalRelayKey, 'managed:a');
    assert.equal(host.councilModalSlots.length, 3);
    assert.equal(host.councilModalSlots[0].routeId, 'a1');
    host.selectCouncilModalRelay('');
    assert.deepEqual(host.councilModalSlots, []);
});

test('opening saved configuration preserves exact variants and never guesses ambiguous legacy routes', () => {
    const host = fixture([route('a1'), route('a2')]);
    const saved = { relayKey: 'managed:a', slots: slots('a2') };
    host.effectiveCouncilConfig = () => saved;
    host.openCouncilConfigModal();
    assert.equal(host.councilModalRelayKey, 'managed:a');
    assert.ok(host.councilModalSlots.every(slot => slot.routeId === 'a2' && slot.label === 'a2'));
    saved.slots = slots('');
    host.openCouncilConfigModal();
    assert.ok(host.councilModalSlots.every(slot => slot.routeId === '' && slot.modelId === 'same-model'));
    host.saveCouncilConfigModal();
    assert.equal(host.councilConfigsBySession.size, 0);
    assert.equal(host.councilModalRouteError, true);
});

test('same-model variants select and persist the exact route identity', () => {
    const host = fixture([route('a1'), route('a2')]);
    host.councilModalSlots = slots('a1');
    host.selectCouncilSlotModel('ui', 'a2');
    assert.equal(host.councilModalSlots[1].routeId, 'a2');
    assert.equal(host.councilModalSlots[1].modelId, 'same-model');
    host.saveCouncilConfigModal();
    const saved = host.councilConfigsBySession.get('session');
    assert.equal(saved.slots[1].route.route.offeringId, 'a2');
    assert.equal(saved.slots[1].relayKey, 'managed:a');
});

test('stale, foreign and ambiguous routes cannot silently save a replacement model', () => {
    for (const missingRoute of ['removed', 'foreign', '']) {
        const host = fixture([route('a1'), route('a2')]);
        host.councilModalSlots = slots('a1');
        host.councilModalSlots[1].routeId = missingRoute;
        host.saveCouncilConfigModal();
        assert.equal(host.councilConfigsBySession.size, 0);
        assert.equal(host.councilModalRouteError, true);
        assert.equal(host.councilConfigModalOpen, true);
    }
    const host = fixture([route('a1')]);
    host.councilModalSlots = slots('a1');
    host.councilModalSlots[1].modelId = 'different-model';
    host.saveCouncilConfigModal();
    assert.equal(host.councilConfigsBySession.size, 0);
    assert.equal(host.councilModalRouteError, true);
});

test('catalog refresh preserves unavailable identities for validation instead of choosing a different variant', () => {
    const host = fixture([route('replacement')]);
    host.councilModalSlots = slots('removed');
    host.syncCouncilModalSlotsWithRelay('managed:a');
    assert.ok(host.councilModalSlots.every(slot => slot.modelId === 'same-model' && slot.routeId === 'removed'));
    host.saveCouncilConfigModal();
    assert.equal(host.councilConfigsBySession.size, 0);
    assert.equal(host.councilModalRouteError, true);
    host.routesForRelay = () => [];
    host.councilModalSlots = slots('old');
    host.syncCouncilModalSlotsWithRelay('managed:a');
    assert.ok(host.councilModalSlots.every(slot => slot.modelId === 'same-model' && slot.routeId === 'old'));
});

test('selecting an unknown route leaves the previous selection intact and reports an error', () => {
    const host = fixture([route('a1')]);
    host.councilModalSlots = slots('a1');
    host.selectCouncilSlotModel('ui', 'foreign');
    assert.equal(host.councilModalSlots[1].routeId, 'a1');
    assert.equal(host.councilModalRouteError, true);
});

test('Batch 4 + Domain 3/7/10 fixes: safe prompt truncation, pasted reference queue restore, comic thinking stream/cancel, and route reconciliation', async () => {
    const serviceSource = readFileSync(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
    // D10-B1 / C1: both managed_gateway and official_connection model.complete adapt messages for non-vision routes
    assert.match(serviceSource, /const adaptedGatewayMessages = typeof this\.adaptMessagesForCouncilSlot === 'function'/);
    assert.match(serviceSource, /const adaptedMessages = typeof this\.adaptMessagesForCouncilSlot === 'function'/);
    // D3-13: planComicText strips inline <think> blocks
    assert.match(serviceSource, /async planComicText[\s\S]{1,800}replace\(\/<think\(\?:ing\)\?>\[\\s\\S\]\*\?<\\\/think\(\?:ing\)\?>\/gi, ''\)/);

    // D3-12: CouncilRoleConversationStage avoids duplicate final prose when child.result.finalText exists
    assert.match(source, /child\.status === 'running',\s*!child\.result\?\.finalText\?\.trim\(\)/);
    // D7-05: cross-window storage listener for CONVERSATION_TABS_STORAGE_KEY
    assert.match(source, /event\.key === CONVERSATION_TABS_STORAGE_KEY[\s\S]{1,120}this\.syncConversationTabsFromStorage\(event\.newValue\)/);
    // D7-09: smart paste shifts anchors, prunes pasted references, and schedules draft persist
    // Only a paste into the message box itself is rewritten (a question's answer field in the same area pastes as typed).
    assert.match(source, /if \(\(tableMarkdown \|\| hasAnsi\) && textarea\) \{[\s\S]{1,900}this\.shiftComposerAnchors\?\.\(basePrompt, nextValue\)[\s\S]{1,500}this\.scheduleComposerDraftPersist\?\.\(\)/);
    assert.match(source, /const textarea = event\.target instanceof HTMLTextAreaElement && this\.ownsComposerInput\(event\.target\) \? event\.target : undefined;/);
    // D7-10c: ThreadNotes onNoteChange triggers widget update
    assert.match(source, /<ThreadNotes[\s\S]{1,260}onNoteChange=\{\(\) => this\.update\(\)\}/);
    // D3-13: Comic Chat onStop immediately invokes cancelAgentRun and runComicChatAgent preserves partial output on cancel
    assert.match(source, /onStop=\{\(\)\s*=>\s*\{\s*if\s*\(ui\.agent\)\s*\{\s*ui\.agent\.cancel\s*=\s*true;\s*if\s*\(ui\.agent\.runId\)\s*void\s*this\.platformService\.cancelAgentRun\(ui\.agent\.runId\)/);
    // (The cancelled branch also keeps the relay request IDs a partial reply can be rated by.)
    assert.match(source, /if \(snapshot\.status === 'cancelled'\) \{[\s\S]{1,1200}this\.patchComicChatTurn\(chatId, turnId/);
    // D3-14: Comic adaptation/planning captures thinking and renders collapsible thought block
    assert.match(source, /nmx-comic-chat-thought/);

    // D7-06: truncateComposerPromptSafely never slices inside ⟦...⟧ or [Attached ...] tokens or surrogate pairs
    const batch4Methods = ['truncateComposerPromptSafely', 'reconcileComicChatParamsAndReferences', 'syncMediaSheetToStep']
        .map(name => widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === name).getText(ast)).join('\n');
    const Batch4Harness = Function(
        'COMIC_CHAT_MODES',
        'canvasNodeBusy',
        `${ts.transpileModule(`class Batch4Harness { ${batch4Methods} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText}; return Batch4Harness;`
    )(['agent', 'image', 'video', 'speech', 'music'], () => false);
    const b4 = new Batch4Harness();
    const prefix = 'a'.repeat(90);
    const token = '⟦Pasted text #1 · 12 lines⟧';
    const truncated = b4.truncateComposerPromptSafely(`${prefix}${token} tail`, 100);
    assert.equal(truncated, prefix, 'must truncate before an inline token rather than slicing inside it');

    // Batch 4 Task 3 & D3-15: reconcileComicChatParamsAndReferences clamps unsupported params & references
    const chatUi = {
        mode: 'video', notice: '',
        params: { video: { aspect: '21:9', seconds: 10, sound: true } },
        references: [{ id: 'ref-1' }, { id: 'ref-2' }, { id: 'ref-3' }]
    };
    let policy = { limit: 1, firstFrame: true };
    Object.assign(b4, {
        comicChatUi: () => chatUi,
        comicChatCandidate: () => ({ routeId: 'r1', model: 'veo-2' }),
        comicChatReferencePolicy: () => policy,
        comicChatT: (key, values) => `${key}:${values?.limit}:${values?.n}`,
        comicChatParams: (mode, _cand, refCount) => ({ aspect: '16:9', seconds: 8, sound: false, refCount })
    });
    b4.reconcileComicChatParamsAndReferences();
    // LobeChat #14: a first-frame model takes the first picture; the others wait, in order, and the user is told.
    assert.deepEqual(chatUi.references.map(item => item.id), ['ref-1']);
    assert.deepEqual(chatUi.stashedReferences.map(item => item.id), ['ref-2', 'ref-3']);
    assert.equal(chatUi.notice, 'referencesSetAside:1:2');
    assert.equal(chatUi.params.video.aspect, '16:9');
    assert.equal(chatUi.params.video.seconds, 8);
    assert.equal(chatUi.params.video.sound, false);
    assert.equal(chatUi.params.video.refCount, 1);
    // A model that takes four pictures gets them back in their order, and the notice goes away.
    policy = { limit: 4, firstFrame: false };
    b4.reconcileComicChatParamsAndReferences();
    assert.deepEqual(chatUi.references.map(item => item.id), ['ref-1', 'ref-2', 'ref-3']);
    assert.deepEqual(chatUi.stashedReferences, []);
    assert.equal(chatUi.notice, '');

    // D3-15: syncMediaSheetToStep refreshes comicDesk factsKey and reconciles unpinned comicCanvas nodes
    let deskFactsRefreshed = 0;
    let canvasChanged = 0;
    const reconciledNodes = new Set();
    Object.assign(b4, {
        mediaDraft: { kind: 'video', connectionId: 'old', model: 'old', voice: '' },
        comicStepMediaRoute: () => ({ id: 'conn-new', model: 'seedance-2', connection: { id: 'conn-new' } }),
        comicMediaVoice: () => '',
        comicDesk: { factsKey: 'stale-key' },
        deskVideoFacts: async () => { deskFactsRefreshed++; },
        comicCanvas: {
            reconcile: reconciledNodes,
            doc: {
                nodes: [{ id: 'n1', kind: 'videoGen', payload: {} }, { id: 'n2', kind: 'videoGen', payload: {} }],
                settings: { nodeRoutes: { n2: { key: 'pinned', modelId: 'pinned-model' } } }
            }
        },
        canvasRouteOf: () => ({ id: 'conn-new', model: 'seedance-2' }),
        canvasCapabilityOf: () => ({ capability: { video: true } }),
        reconcileComicCanvasRoutes: () => { canvasChanged++; }
    });
    b4.syncMediaSheetToStep('video');
    assert.equal(b4.comicDesk.factsKey, undefined);
    assert.equal(deskFactsRefreshed, 1);
    assert.equal(canvasChanged, 1);
    assert.deepEqual([...reconciledNodes], ['n1']);
});

