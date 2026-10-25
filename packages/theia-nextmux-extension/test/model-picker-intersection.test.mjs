import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

// Run production picker methods against isolated directories. No network,
// credentials, user profile or generated application bundle is involved.
const src = fileURLToPath(new URL('../src/', import.meta.url)), modules = new Map();
function load(path) {
    if (modules.has(path)) return modules.get(path).exports;
    const module = { exports: {} }; modules.set(path, module);
    const require = createRequire(path);
    const localRequire = name => {
        if (name.startsWith('.')) {
            const base = resolve(dirname(path), name);
            const candidate = [base, `${base}.ts`, `${base}.tsx`].find(existsSync);
            if (/\.tsx?$/.test(candidate || '')) return load(candidate);
        }
        return require(name);
    };
    new Function('require', 'module', 'exports', ts.transpileModule(readFileSync(path, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React }
    }).outputText)(localRequire, module, module.exports);
    return module.exports;
}
const visibility = load(join(src, 'browser/nextmux-model-visibility.ts'));
const selection = load(join(src, 'browser/nextmux-model-route-selection.ts'));
const discovery = load(join(src, 'browser/nextmux-official-discovery.tsx'));
const pickerValidation = load(join(src, 'browser/nextmux-official-picker-validation.ts'));
const require = createRequire(import.meta.url);
const presets = require('@nextmux/model-runtime/presets');
const capabilities = require('@nextmux/model-runtime/capabilities');
const source = readFileSync(join(src, 'browser/nextmux-desktop-widget.tsx'), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const method = name => {
    const found = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === name);
    assert.ok(found, `production method ${name}`); return found;
};
function initializer(methodName, variable) {
    let found;
    const visit = node => {
        if (ts.isVariableDeclaration(node) && node.name.getText(ast) === variable) found = node.initializer;
        ts.forEachChild(node, visit);
    };
    visit(method(methodName)); assert.ok(found, `${methodName}.${variable}`); return found.getText(ast);
}
const methodNames = ['managedOfferings', 'normalizedModelId', 'modelKeyForOffering', 'modelKeyForConnection', 'modelKeyForRoute',
    'officialModelRoutes', 'connectionForDiscoveredModel', 'managedModelRoutes', 'routesForRelay', 'allModelRoutes',
    'codingModelOptions', 'settingsModelOptions', 'registryModelOption', 'registryModelSupportsWorkbench', 'offeringMerchantId',
    'scheduleModelRoutes', 'selectedScheduleModelRoute', 'comicOfficialModelRoutes', 'comicConnectionMetadata',
    'comicMediaSupportsKind', 'mediaCompatibleConnections', 'comicMediaRouteGroups', 'comicMediaRoute', 'comicMediaLocalRoute',
    'comicStepCandidates', 'comicStepCandidatesByRoute', 'comicStepResolution', 'comicStepAuto', 'comicStepChoice', 'comicStepMediaRoute', 'comicStepRank', 'comicStepSource',
    'comicStepExtraRelayKeys', 'comicCatalogMediaRoutes', 'comicCatalogTextRoutes', 'comicTextRouteChoices', 'comicTranscriptionRoutes', 'cachedComicRoutes', 'comicRouteCacheKey', 'computeComicMediaRouteGroups',
    'computeComicOfficialModelRoutes', 'registryIndex',
    'openMediaSheet', 'setMediaKind', 'confirmComicVoiceCommand', 'isModelVisible', 'setVisibleModels',
    'comicMediaPrompt', 'comicVideoMakesSound', 'comicSoundFromVideo', 'comicShotSoundPrompt'];
const code = ts.transpileModule(`class Harness { ${methodNames.map(name => method(name).getText(ast)).join('\n')}
    codingPickerRows() {
        const modelOptions = this.codingModelOptions(this.activeRelayKey), modelPickerRelayKey = this.activeRelayKey;
        const modelRouteById = ${initializer('renderCodingWorkbench', 'modelRouteById')};
        const modelPickerIdentity = ${initializer('renderCodingWorkbench', 'modelPickerIdentity')};
        const pickerPartition = ${initializer('renderCodingWorkbench', 'pickerPartition')};
        return ${initializer('renderCodingWorkbench', 'visibleModelOptions')};
    }
    schedulePickerRows() { const availableRoutes = this.scheduleModelRoutes(); const route = this.selectedScheduleModelRoute(availableRoutes); return ${initializer('renderScheduleDialog', 'routes')}; }
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const outcome = await import('../lib/browser/nextmux-agent-outcome-locale.js');
const stepModels = await import('../lib/browser/nextmux-comic-step-models.js');
const modelSound = await import('../lib/common/nextmux-model-sound.js');
const ownModelKind = await import('../lib/browser/nextmux-own-model-kind.js');
const ownModelMatch = await import('../lib/browser/nextmux-own-model-match.js');
const decisionModels = await import('../lib/common/nextmux-decision-models.js');
const quotes = await import('../lib/common/nextmux-price-quote.js');
const dependencies = { normalizeDesktopFailure: outcome.normalizeDesktopFailure, ...visibility, ...selection, ...discovery, ...pickerValidation, ...presets, ...capabilities,
    matchCatalogModel: ownModelMatch.matchCatalogModel,
    resolveComicStep: stepModels.resolveComicStep, dedupeComicPriceVariants: stepModels.dedupeComicPriceVariants, videoModelMakesSound: modelSound.videoModelMakesSound,
    ownModelKind: ownModelKind.ownModelKind, ownModelCategories: ownModelKind.ownModelCategories, ownModelMediaFacts: ownModelKind.ownModelMediaFacts,
    modelTaskCategories: require('@nextmux/model-runtime/model-task-capabilities').modelTaskCategories,
    optionalKeyPriceQuoteId: quotes.optionalKeyPriceQuoteId, comicStepText: stepModels.comicStepText,
    modelVisible: visibility.isModelVisible, isDecisionModel: decisionModels.isDecisionModel, localizeDesktopSurface: (_locale, value) => value,
    window: { localStorage: { setItem() {} } }, document: { body: {} },
    React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) },
    ReactDOM: { createPortal: element => element }, ImeInput: 'input', ImeTextarea: 'textarea'
};
const Harness = new Function(...Object.keys(dependencies), `${code}; return Harness;`)(...Object.values(dependencies));
const globalModels = [
    { canonicalModel: 'aurora/orbit-1', provider: 'aurora', kind: 'llm', input: ['text'], output: ['text'], capabilities: ['tools'], aliases: ['orbit-1-api'] },
    { canonicalModel: 'other/orbit-1', provider: 'other', kind: 'llm', input: ['text'], output: ['text'], capabilities: ['tools'], aliases: [] },
    { canonicalModel: 'aurora/not-supported', provider: 'aurora', kind: 'llm', input: ['text'], output: ['text'], capabilities: ['tools'], aliases: [] },
    { canonicalModel: 'aurora/media-1', provider: 'aurora', kind: 'speech', input: ['text'], output: ['speech'], capabilities: ['tts'], aliases: ['media-1-api'] },
    { canonicalModel: 'other/media-1', provider: 'other', kind: 'speech', input: ['text'], output: ['speech'], capabilities: ['tts'], aliases: [] }
];
const evidence = ['model:generatable', 'tools'].map(capability => ({ capability, support: 'supported', confidence: 'verified',
    source: 'live_probe', observedAt: '2026-09-20T00:00:00.000Z' }));
const connection = (id, model) => ({ id, model, providerId: 'custom_openai', providerName: 'Test API', protocol: 'openai',
    label: model, modelFamily: model, status: 'verified', toolCapability: 'verified', discoveredModels: [], capabilityEvidence: evidence });
const offering = (merchantId, canonicalModel, media = false) => ({ id: `${merchantId}:${canonicalModel}`, merchantId,
    canonicalModel, registryModelId: canonicalModel, providerName: 'Test merchant', modelFamily: canonicalModel,
    displayName: canonicalModel, status: 'active', workbenches: [media ? 'comic' : 'coding'], routeScore: 50,
    input: ['text'], output: [media ? 'speech' : 'text'], category: media ? 'audio' : 'coding', capabilities: media ? ['tts'] : ['coding', 'tools'] });
function fixture() {
    const state = new Harness(), queued = [];
    const offerings = [offering('merchant-a', 'aurora/orbit-1'), offering('merchant-a', 'other/orbit-1'),
        offering('merchant-b', 'other/orbit-1'), offering('merchant-a', 'aurora/media-1', true), offering('merchant-a', 'other/media-1', true)];
    const catalog = visibility.createModelVisibilityCatalog(globalModels);
    let preferences = visibility.newModelVisibilityPreferences(catalog);
    preferences = visibility.setModelsVisible(preferences, ['aurora/orbit-1', 'aurora/not-supported'], 'language', true, catalog);
    preferences = visibility.setModelsVisible(preferences, ['aurora/media-1'], 'media', true, catalog);
    preferences = visibility.setModelsVisible(preferences, ['other/orbit-1'], 'language', false, catalog);
    preferences = visibility.setModelsVisible(preferences, ['other/media-1'], 'media', false, catalog);
    Object.assign(state, {
        modelVisibilityCatalog: catalog, modelVisibility: preferences, platformSession: { linked: false, wallets: [] },
        privacySettings: { requireZeroDataRetention: false, denyDataCollection: true, saveConversationHistory: true },
        activeSection: 'coding', officialPickerValidations: new Map(), officialPickerValidationAttempts: new Map(), officialPickerValidationFailures: new Set(), officialPickerAuthFailures: new Set(),
        activeRelayKey: 'managed:merchant-a', activeModelRouteId: '', desktopLocale: 'en',
        registryModels: [{ canonicalModel: 'aurora/media-1', provider: 'aurora', input: ['text'], output: ['speech'], capabilities: ['tts'] },
            { canonicalModel: 'other/media-1', provider: 'other', input: ['text'], output: ['speech'], capabilities: ['tts'] }],
        officialModels: { providers: [], connections: [connection('api-a', 'orbit-1-api'), connection('api-b', 'other/orbit-1'),
            // Own APIs are classified locally from their own model list: this one reported a speech model.
            { ...connection('api-media', 'aurora/media-1'), discoveredModels: [{ id: 'aurora/media-1', outputModalities: ['speech'] }] }] },
        platformCatalog: { offerings },
        selectedMerchantCatalog: { merchantId: 'merchant-a', offerings: offerings.filter(row => row.merchantId === 'merchant-a') },
        merchantPickerSnapshots: new Map([['merchant-b', { catalog: { merchantId: 'merchant-b', offerings: offerings.filter(row => row.merchantId === 'merchant-b') } }]]),
        merchantDiscoveredModels: new Map(),
        scheduledTasks: [], scheduleDraft: { relayKey: 'managed:merchant-a' },
        mediaDraft: { kind: 'speech', connectionId: '', model: '', format: 'mp3' }, mediaState: { runtime: { comfyUi: { available: false } } },
        codingPopover: 'routes', modelPickerRelayOpen: false,
        comicStepPrefs: { choices: {}, advanced: {}, relays: {} }, comicModelKind: () => 'novel', comicPlatformDefaults: [], comicTextRouteId: '', comicStepDirectory: new Map(), globalModels, favoriteMerchantLabels: new Map(),
        formatManagedMediaPrice: () => '',
        modelOnlyDisplayName: (label, _provider, model) => label || model,
        modelDisplayName: model => model, connectionInputModalities: () => ['text'], connectionCapabilityLabels: () => ['tools'],
        relayOptions: () => [{ key: 'managed:merchant-a', kind: 'managed', merchantId: 'merchant-a', label: 'Merchant A' },
            { key: 'managed:merchant-b', kind: 'managed', merchantId: 'merchant-b', label: 'Merchant B' },
            { key: 'official:api-a', kind: 'official', label: 'API A' }, { key: 'official:api-b', kind: 'official', label: 'API B' },
            { key: 'official:api-media', kind: 'official', label: 'API media' }],
        comicProject: () => ({ id: 'project', frameRate: 24 }), comicProjectKind: () => 'novel', comicTopicSettings: () => undefined, activeComicScene: () => ({ id: 'scene' }),
        activeComicShot: () => ({ id: 'shot', dialogueCues: [{ text: 'hello' }] }),
        comicHasDirtyDraft: () => false, rememberNavigation() {}, clearNavigationSurfaces() {}, update() {},
        buildComicVisualPrompt: () => 'shot', buildComicStillPrompt: () => 'shot', buildComicSpeechText: () => 'hello', loadMediaState: async () => {},
        speakComicReply() {}, mediaDraftReady: () => true,
        queueMediaJob() { queued.push(structuredClone(this.mediaDraft)); },
        calculateModelPickerPlacement: () => ({}), resolvedDesktopTheme: () => 'dark'
    });
    return { state, queued };
}
const models = rows => rows.map(row => row.model);
function optionNames(tree) {
    if (!tree || typeof tree !== 'object') return [];
    if (Array.isArray(tree)) return tree.flatMap(optionNames);
    return (tree.props?.role === 'option' ? [tree.children[0].children[0].children[0]] : []).concat((tree.children || []).flatMap(optionNames));
}

test('coding picker intersects the selected API directory with global canonical choices and unambiguous aliases', () => {
    const { state } = fixture();
    assert.deepEqual(models(state.codingPickerRows()), ['aurora/orbit-1']);
    assert.equal(state.codingPickerRows().some(row => row.model === 'aurora/not-supported'), false,
        'checking a global model does not add it to a merchant API that does not support it');
    state.activeRelayKey = 'managed:merchant-b'; assert.deepEqual(state.codingPickerRows(), []);
    state.activeRelayKey = 'official:api-a';
    assert.deepEqual(models(state.codingPickerRows()), ['orbit-1-api'], 'the request retains the provider raw model ID');
    state.activeRelayKey = 'official:api-b'; assert.deepEqual(state.codingPickerRows(), [], 'a different author sharing the same leaf stays hidden');
    state.activeRelayKey = 'official:api-a';
    const historical = state.routesForRelay(state.activeRelayKey, 'coding')[0];
    state.activeModelRouteId = historical.id;
    const before = structuredClone(historical);
    state.setVisibleModels(['aurora/orbit-1'], 'language', false);
    assert.deepEqual(state.codingPickerRows(), []);
    assert.equal(state.activeModelRouteId, before.id);
    assert.deepEqual(state.routesForRelay(state.activeRelayKey, 'coding')[0], before,
        'display preferences do not rewrite or delete an existing executable conversation route');
});

test('schedule picker respects API intersection while retaining its exact saved historical route', () => {
    const { state } = fixture();
    assert.deepEqual(state.schedulePickerRows().map(row => row.offering.canonicalModel), ['aurora/orbit-1']);
    state.scheduleDraft = { relayKey: 'official:api-a' };
    assert.deepEqual(state.schedulePickerRows().map(row => row.connection.model), ['orbit-1-api']);
    state.scheduleDraft = { id: 'plan', relayKey: 'official:api-b', routeId: 'official:api-b:other%2Forbit-1' };
    state.scheduledTasks = [{ ...state.scheduleDraft, modelRoute: { kind: 'official_connection', connectionId: 'api-b', model: 'other/orbit-1' } }];
    const before = structuredClone(state.scheduledTasks);
    assert.deepEqual(state.schedulePickerRows().map(row => row.connection.model), ['other/orbit-1']);
    assert.deepEqual(state.scheduledTasks, before);
    state.scheduleDraft = { relayKey: 'official:api-b' };
    assert.deepEqual(state.schedulePickerRows(), [], 'the saved-route exception cannot enable a new selection');
});

test('comic step menus drop an unchecked relay model, and a fresh media sheet never picks one', () => {
    const { state } = fixture();
    const speech = () => state.comicStepCandidates('speech').map(row => `${row.source.key} ${row.model}`);
    // Only sources that can do this step are offered: merchant B has no voice model.
    assert.deepEqual(speech(), ['managed:merchant-a aurora/media-1', 'official:api-media aurora/media-1']);
    // “AI 模型” set to merchant A: the step uses its model.
    state.comicStepPrefs = { ...state.comicStepPrefs, global: 'managed:merchant-a' };
    state.openMediaSheet('speech');
    assert.equal(state.mediaDraft.connectionId, `managed:fixed:merchant-a:aurora/media-1`);
    // The checked public model controls both relay and own-API copies.
    state.setVisibleModels(['aurora/media-1'], 'media', false);
    assert.deepEqual(speech(), []);
    assert.equal(state.comicStepResolution('speech').globalUnsupported, true);
    state.openMediaSheet('speech');
    assert.equal(state.mediaDraft.connectionId, '', 'unchecked copies cannot become the fallback model');
});

test('voice confirmation never silently falls back to an unchecked remote model', async () => {
    const { state, queued } = fixture();
    state.officialModels = { ...state.officialModels, connections: state.officialModels.connections.filter(item => item.id !== 'api-media') };
    state.setVisibleModels(['aurora/media-1'], 'media', false);
    state.comicVoicePending = { transcript: '重新配音', command: { type: 'regenerate_audio' } };
    await state.confirmComicVoiceCommand();
    assert.equal(queued.length, 0); assert.equal(state.mediaDraft.connectionId, '');
    assert.equal(state.mediaSheetOpen, true, 'the user may explicitly review a model instead of being charged on a hidden fallback');
    // Checked again, the relay model is used and the spoken confirmation is the approval.
    state.setVisibleModels(['aurora/media-1'], 'media', true);
    state.comicVoicePending = { transcript: '重新配音', command: { type: 'regenerate_audio' } };
    await state.confirmComicVoiceCommand();
    assert.equal(queued.length, 1); assert.equal(queued[0].connectionId, 'managed:fixed:merchant-a:aurora/media-1');
});


test('API directory models require their own proof, never borrow the connection main model proof', () => {
    const { state } = fixture();
    // A probe result replaces the whole connection, as the widget does (the picker rows are cached per connections array).
    const probed = (validation) => {
        const [api, ...rest] = state.officialModels.connections;
        state.officialModels = { ...state.officialModels, connections: [{ ...api, discoveredModels: [
            { id: 'aurora/not-supported', label: 'Unverified', ...(validation ? { validation } : {}) },
            { id: 'other/orbit-1', label: 'Hidden', validation: { checkedAt: '2026-09-20T00:00:00.000Z', latencyMs: 1, resolvedModel: 'other/orbit-1', toolCalling: true } }
        ] }, ...rest] };
    };
    probed(undefined);
    state.activeRelayKey = 'official:api-a';
    assert.deepEqual(models(state.codingPickerRows()), ['orbit-1-api']);
    probed({ checkedAt: '2026-09-20T00:00:00.000Z', latencyMs: 1, resolvedModel: 'aurora/not-supported', toolCalling: false });
    assert.deepEqual(models(state.codingPickerRows()), ['orbit-1-api'], 'a text response is not a successful tool probe');
    probed({ checkedAt: '2026-09-20T00:00:00.000Z', latencyMs: 1, resolvedModel: 'aurora/not-supported', toolCalling: true });
    assert.deepEqual(new Set(models(state.codingPickerRows())), new Set(['orbit-1-api', 'aurora/not-supported']));
    assert.ok(state.codingPickerRows().every(row => row.available && state.routesForRelay(state.activeRelayKey, 'coding').some(route => state.modelKeyForRoute(route) === row.id)));
    state.setVisibleModels(['aurora/not-supported'], 'language', false);
    assert.deepEqual(models(state.codingPickerRows()), ['orbit-1-api']);
    state.activeRelayKey = 'official:api-b';
    assert.deepEqual(state.codingPickerRows(), [], 'proof never crosses connection IDs');
});

test('merchant catalog-only rows cannot appear as unclickable options even when globally enabled', () => {
    const { state } = fixture();
    state.merchantDiscoveredModels.set('merchant-a', [{ id: 'aurora/not-supported', input: ['text'], output: ['text'], capabilities: ['tools'], execution: { state: 'pending' } }]);
    assert.deepEqual(models(state.codingPickerRows()), ['aurora/orbit-1']);
});

test('coding choices and price variants exclude routes rejected by the desktop coding contract', () => {
    const { state } = fixture();
    const base = state.platformCatalog.offerings[0];
    const blocked = [
        { ...base, id: 'no-tools', capabilities: ['coding'] },
        { ...base, id: 'text-only-contract', category: 'text', capabilities: ['tools'] },
        { ...base, id: 'no-text-input', input: ['image'] },
        { ...base, id: 'embedding-output', output: ['text', 'embedding'] },
        { ...base, id: 'coding-unavailable', codingAvailability: { available: false, unavailableReason: 'context_window_exceeded', minimumInputTokens: 25000, maximumOutputTokens: 4096 } }
    ].map(row => ({ ...row, routeScore: 99 }));
    state.platformCatalog = { offerings: [base, ...blocked] };
    state.selectedMerchantCatalog = { merchantId: 'merchant-a', offerings: state.platformCatalog.offerings };
    assert.deepEqual(state.routesForRelay('managed:merchant-a', 'coding').map(row => row.offering.id), [base.id],
        'every price variant is gated before a model row is constructed');
    assert.deepEqual(state.routesForRelay('auto', 'coding').map(row => row.offering.id), [base.id],
        'a high-ranked unavailable route cannot become the automatic model route');
    assert.deepEqual(models(state.codingPickerRows()), [base.canonicalModel]);
    state.selectedMerchantCatalog = { merchantId: 'merchant-a', offerings: blocked };
    assert.deepEqual(state.codingPickerRows(), [], 'a directory model alone cannot manufacture a working route');
});

test('comic text fallback uses the same tools and coding availability contract as the loaded relay picker', () => {
    const { state } = fixture();
    const base = { ...state.platformCatalog.offerings[0], capabilities: ['coding', 'tools', 'reasoning'] };
    const reasoningCategory = { ...base, id: 'reasoning-category', category: 'reasoning', capabilities: ['coding', 'tools'] };
    state.officialModels = { providers: [], connections: [] };
    state.platformCatalog = { offerings: [base, reasoningCategory,
        { ...base, id: 'text-no-tools', capabilities: ['coding'] },
        { ...base, id: 'text-no-coding', category: 'text', capabilities: ['tools'] },
        { ...base, id: 'coding-only', capabilities: ['coding', 'tools'] },
        { ...base, id: 'text-unavailable', codingAvailability: { available: false, unavailableReason: 'credential_token_limit', minimumInputTokens: 25000, maximumOutputTokens: 4096 } }
    ] };
    state.selectedMerchantCatalog = { merchantId: 'merchant-a', offerings: state.platformCatalog.offerings };
    assert.deepEqual(state.comicCatalogTextRoutes('merchant-a').map(row => row.offering.id), [base.id, reasoningCategory.id]);
    assert.deepEqual(state.comicTextRouteChoices().map(row => row.route.offering.id), [base.id, reasoningCategory.id]);
});

test('comic transcription choices require audio category and transcription capability', () => {
    const { state } = fixture();
    const base = { ...state.platformCatalog.offerings[0], id: 'transcription', category: 'audio',
        input: ['audio'], output: ['transcription'], capabilities: ['speech_to_text'], keyPriceQuoteId: `kq1_${'a'.repeat(64)}`,
        price: { mode: 'reference_multiplier', audioSecondMicros: 10 } };
    state.platformCatalog = { offerings: [base,
        { ...base, id: 'text-transcription', category: 'text' },
        { ...base, id: 'video-transcription', category: 'video' },
        { ...base, id: 'speech-only', output: ['speech'], capabilities: ['tts'] }
    ] };
    state.selectedMerchantCatalog = undefined;
    state.merchantPickerSnapshots = new Map();
    state.catalogRemovedMerchants = new Set();
    state.isModelVisible = () => true;
    assert.deepEqual(state.comicTranscriptionRoutes().map(route => route.id), ['transcription:local', 'managed:fixed:transcription']);
});

test('directory-only metadata never creates callable models while exact existing proof remains usable', () => {
    const { state } = fixture(); state.activeRelayKey = 'official:api-a';
    const api = state.officialModels.connections[0];
    api.discoveredModels = [{ id: 'aurora/not-supported', label: 'Enabled' }, { id: 'catalog-only', selectionMode: 'catalog_only' }];
    const before = JSON.stringify(state.officialModels);
    assert.deepEqual(models(state.codingPickerRows()), ['orbit-1-api']);
    assert.equal(state.codingModelOptions(state.activeRelayKey).find(row => row.model === 'aurora/not-supported').available, false);
    assert.equal(JSON.stringify(state.officialModels), before);
});


test('an unknown own-API ID is visible but needs exact live proof before becoming selectable', () => {
    const { state } = fixture(); const customId = 'private-coder-deployment';
    const api = { ...state.officialModels.connections[0], model: customId, status: 'unverified', toolCapability: 'untested', capabilityEvidence: [], discoveredModels: [{ id: customId, outputModalities: ['text'] }] };
    state.officialModels = { providers: [], connections: [api] }; state.activeRelayKey = 'official:api-a';
    assert.equal(state.isModelVisible(customId), true);
    assert.equal(state.settingsModelOptions('coding').some(row => row.model === customId), false);
    assert.deepEqual(models(state.codingPickerRows()), []);
    state.officialModels = { providers: [], connections: [{ ...api, status: 'verified', toolCapability: 'verified', capabilityEvidence: evidence }] };
    assert.deepEqual(models(state.codingPickerRows()), [customId]);
});


test('the coding picker shows checked language models and never exposes unchecked defaults through More models', () => {
    const { state } = fixture();
    const rows = Array.from({ length: 42 }, (_, index) => ({ canonicalModel: `vendor/coder-${String(index).padStart(2, '0')}`,
        provider: 'vendor', kind: 'llm', input: ['text'], output: ['text'], capabilities: ['tools'] }));
    const image = { canonicalModel: 'vendor/image-utility', provider: 'vendor', kind: 'image', input: ['text'], output: ['image'], capabilities: ['image_generation'] };
    const utility = { canonicalModel: 'vendor/embed-utility', provider: 'vendor', kind: 'embedding', input: ['text'], output: ['text'], capabilities: ['tools'] };
    state.globalModels = [...rows, image, utility];
    state.modelVisibilityCatalog = visibility.createModelVisibilityCatalog(state.globalModels);
    state.modelVisibility = visibility.newModelVisibilityPreferences(state.modelVisibilityCatalog);
    state.selectedMerchantCatalog = { merchantId: 'merchant-a', offerings: [...rows, image, utility].map(row =>
        // Even a wrongly advertised coding route cannot promote the public media/utility kind.
        ({ ...offering('merchant-a', row.canonicalModel), kind: row.kind, output: row.output })) };
    const shown = models(state.codingPickerRows());
    assert.deepEqual(shown, rows.slice(0, 40).map(row => row.canonicalModel));
    assert.equal(state.codingModelOptions(state.activeRelayKey).length, rows.length);
    assert.equal(initializer('renderCodingWorkbench', 'moreModelOptions'), '[]');
});

test('Settings and comic steps use all public categories including 3D and exclude utility kinds', () => {
    const { state } = fixture();
    const rows = [
        { kind: 'llm', output: ['text'], capabilities: ['tools'] },
        { kind: '3d', output: ['3d'], capabilities: ['3d'] },
        { kind: 'image', output: ['image'], capabilities: ['image_generation'] },
        { kind: 'video', output: ['video', 'audio'], capabilities: ['text_to_video'] },
        { kind: 'speech', output: ['audio'], capabilities: ['tts'] },
        { kind: 'music', output: ['audio'], capabilities: ['music_generation'] },
        { kind: 'audio', output: ['audio'], capabilities: ['sound_effect_generation'] },
        { kind: 'transcription', output: ['text'], capabilities: ['speech_to_text'] },
        ...['embedding', 'rerank', 'moderation'].map(kind => ({ kind, output: ['text'], capabilities: [] }))
    ].map((row, index) => ({ ...row, canonicalModel: `vendor/category-${index}`, provider: 'vendor', input: ['text'] }));
    state.globalModels = rows;
    state.modelVisibilityCatalog = visibility.createModelVisibilityCatalog(rows);
    state.modelVisibility = visibility.newModelVisibilityPreferences(state.modelVisibilityCatalog);
    assert.deepEqual(state.settingsModelOptions('coding').map(row => row.model), [rows[0].canonicalModel]);
    assert.deepEqual(state.settingsModelOptions('comic').map(row => row.model), rows.slice(1, 8).map(row => row.canonicalModel));
    const categories = ['language', '3d', 'image', 'video', 'speech', 'music', 'soundEffect', 'transcription'];
    for (const [index, category] of categories.entries()) {
        assert.equal(state.isModelVisible(rows[index].canonicalModel, category), true);
        const other = categories[(index + 1) % categories.length];
        assert.equal(state.isModelVisible(rows[index].canonicalModel, other), false);
    }
    assert.equal(state.isModelVisible(rows[8].canonicalModel), false);
    state.setVisibleModels([rows[6].canonicalModel], 'media', false);
    assert.equal(state.isModelVisible(rows[6].canonicalModel, 'soundEffect'), false);
});

test('directory timestamps cannot turn an unverified API model into a callable route', () => {
    const { state } = fixture(); state.activeRelayKey = 'official:api-a'; const api = state.officialModels.connections[0];
    api.discoveredModels = [{ id: 'aurora/not-supported', label: 'Enabled' }];
    for (const timestamp of ['2026-09-20T00:00:01.000Z', '2026-09-20T00:01:01.000Z']) {
        state.officialModels = { ...state.officialModels, connections: state.officialModels.connections.map(item => item.id === api.id ? { ...item, lastModelDiscoveryAt: timestamp } : item) };
        assert.deepEqual(models(state.codingPickerRows()), ['orbit-1-api']);
        assert.equal(state.codingModelOptions(state.activeRelayKey).find(row => row.model === 'aurora/not-supported').available, false);
    }
});


test('picker and state refresh methods have no implicit inference validation entry point', () => {
    for (const name of ['toggleCodingPopover', 'loadOfficialModels', 'loadGlobalModels', 'refreshOfficialModelsAfterMutation', 'setVisibleModels'])
        assert.doesNotMatch(method(name).getText(ast), /verifyEnabledOfficialModels|validateOfficialModelSelection|verifyOfficialMediaConnection/);
});


test('multiple unverified API directories remain unmodified and nonselectable', () => {
    const { state } = fixture(); const model = 'aurora/not-supported'; const base = state.officialModels.connections[0];
    state.officialModels.connections = [0, 1, 2, 3, 4].map(index => ({ ...base, id: `batch-${index}`, model, status: 'unverified', toolCapability: 'untested', capabilityEvidence: [], discoveredModels: [{ id: model, label: model }] }));
    const before = JSON.stringify(state.officialModels);
    for (const entry of state.officialModels.connections) { state.activeRelayKey = `official:${entry.id}`; assert.deepEqual(models(state.codingPickerRows()), []); }
    assert.equal(JSON.stringify(state.officialModels), before);
});

