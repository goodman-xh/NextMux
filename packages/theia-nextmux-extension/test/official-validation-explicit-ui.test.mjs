import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { isOfficialMediaProtocol } from '@nextmux/model-runtime/presets';
import * as visibility from '../lib/browser/nextmux-model-visibility.js';
import { officialInvokableModelIds } from '../lib/browser/nextmux-official-discovery.js';
import { isVerifiedModelRoute } from '../lib/browser/nextmux-model-route-selection.js';
import { hasFreshOfficialPickerValidation, isOfficialPickerCredentialFailure } from '../lib/browser/nextmux-official-picker-validation.js';

// Execute the real widget methods. Synthetic RPC counters are the effect boundary;
// no Electron, real credentials, network, profile or timers are used.
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const methods = ['loadOfficialModels', 'loadGlobalModels', 'refreshOfficialModelsAfterMutation',
    'officialConnectionRequestIsCurrent', 'saveOfficialConnection', 'validateExistingOfficialConnection',
    'refreshOfficialConnectionModels', 'refreshAllModelLists', 'refreshOwnApiModelLists', 'setVisibleModels', 'removeOfficialConnection'];
const found = new Map();
const visit = node => { if (ts.isMethodDeclaration(node) && methods.includes(node.name.getText(ast))) found.set(node.name.getText(ast), node.getText(ast)); ts.forEachChild(node, visit); };
visit(ast); assert.equal(found.size, methods.length);
// Keep the former worker executable in baseline negative controls, so a failure
// proves forbidden RPC effects rather than merely a missing fixture method.
const optional = node => { if (ts.isMethodDeclaration(node) && node.name.getText(ast) === 'verifyEnabledOfficialModels') found.set('verifyEnabledOfficialModels', node.getText(ast)); ts.forEachChild(node, optional); };
optional(ast);
const storage = new Map();
const deps = { ...Object.fromEntries(Object.entries(visibility).filter(([key]) => /^[A-Za-z_$][\w$]*$/.test(key) && key !== 'default')), isOfficialMediaProtocol,
    officialInvokableModelIds, isVerifiedModelRoute, hasFreshOfficialPickerValidation, isOfficialPickerCredentialFailure,
    localizeDesktopSurface: (_locale, text) => text, modelFailureText: () => 'test failed', modelFailure: () => ({ detail: 'synthetic failure' }),
    officialDiscoverySummary: () => 'metadata', connectionCheckText: (_locale, key) => key,
    parseModelListWatermark: () => undefined, staleModelListConnections: connections => connections.map(x => x.id),
    window: { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }, setTimeout: (callback, ms) => { if (ms === 3000) callback(); return 0; } },
    setTimeout: callback => { callback(); return 0; }
};
const emitted = ts.transpileModule(`class Widget { ${[...found.values()].join('\n')} }; return Widget;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const Widget = new Function(...Object.keys(deps), emitted)(...Object.values(deps));
const connection = (id, protocol = 'openai_chat_completions') => ({ id, providerId: protocol === 'async_media_template' ? 'custom_media' : 'custom_openai', protocol,
    label: id, model: `${id}-primary`, baseUrl: 'https://fixture.invalid/v1', status: 'unverified', toolCapability: 'untested', discoveredModels: [{ id: `${id}-primary` }, { id: `${id}-other` }], capabilityEvidence: [] });
function fixture() {
    storage.clear();
    const w = new Widget(), effects = { save: [], selectionProbe: [], mediaProbe: [], discovery: [], removed: [] };
    let connections = [connection('api-a'), connection('api-b'), connection('media', 'async_media_template')];
    Object.assign(w, { isDisposed: false, officialModels: { providers: [], connections: structuredClone(connections) }, officialModelsRequestToken: 0,
        officialModelsLoading: false, globalModelsLoading: false, catalogSnapshotRevision: 0, officialConnectionRequestToken: 0, officialConnectionStage: 'idle',
        desktopLocale: 'en', globalModels: [], modelVisibility: visibility.parseModelVisibilityPreferences(null), modelVisibilityCatalog: visibility.createModelVisibilityCatalog([]),
        officialMediaChecks: new Set(), officialPickerValidations: new Map(), officialPickerValidationAttempts: new Map(), officialPickerValidationFailures: new Set(), officialPickerAuthFailures: new Set(),
        isModelVisible: () => true, connectionForDiscoveredModel: connection => connection,
        catalogRemovedMerchants: new Set(), modelListRefreshAttempts: new Map(), modelCenterRefreshToken: 0,
        update() {}, syncModelRoute() {}, recoverDeletedOfficialRelay() {}, scheduleOwnApiModelListRefresh() {}, noteModelCatalogForListRefresh() {}, addNotification() {},
        officialConnectionsFor: () => connections, defaultOfficialProviderSettings: () => undefined, catalogMerchantSources: () => [],
        loadCatalog: async () => true, loadVideoProfiles: async () => true, loadComicStepDirectory: async () => true,
        closeNavigationSurface() { this.officialProviderSheet = undefined; } });
    w.platformService = {
        getOfficialModelConnections: async () => ({ providers: [], connections: structuredClone(connections) }),
        getGlobalModelCatalog: async () => ({ models: [], stale: false }),
        validateOfficialModelSelection: async (...args) => { effects.selectionProbe.push(args); throw new Error('implicit inference forbidden'); },
        verifyOfficialMediaConnection: async (...args) => { effects.mediaProbe.push(args); throw new Error('implicit media check forbidden'); },
        refreshOfficialModelDiscovery: async id => { effects.discovery.push(id); return connections.find(x => x.id === id); },
        saveOfficialModelConnection: async request => {
            effects.save.push(structuredClone(request));
            const saved = { ...connections.find(x => x.id === request.connectionId) || connections[0], model: request.model };
            return { connection: saved, ...(request.validate ? { validation: { toolCalling: true, latencyMs: 1 } } : {}) };
        },
        removeOfficialModelConnection: async id => { effects.removed.push(id); connections = connections.filter(x => x.id !== id); return { removed: true }; }
    };
    return { w, effects };
}
const noImplicit = effects => { assert.deepEqual(effects.selectionProbe, []); assert.deepEqual(effects.mediaProbe, []); };

for (const operation of ['loadOfficialModels', 'loadGlobalModels', 'refreshOfficialModelsAfterMutation', 'refreshAllModelLists', 'refreshOwnApiModelLists']) {
    test(`${operation} reads state and directories without text inference or custom media checks`, async () => {
        const { w, effects } = fixture(); const before = structuredClone(w.officialModels.connections);
        await w[operation](); await Promise.resolve(); await w.officialModelValidationTask;
        noImplicit(effects); assert.deepEqual(effects.save, []);
        assert.deepEqual(w.officialModels.connections, before, 'metadata reads must not manufacture validation');
    });
}
test('single directory refresh and visibility changes never validate a model', async () => {
    const { w, effects } = fixture(); await w.refreshOfficialConnectionModels(w.officialModels.connections[0]);
    w.setVisibleModels(['api-a-primary', 'api-b-other'], 'language', true);
    w.setVisibleModels(['api-a-primary'], 'language', false);
    assert.deepEqual(effects.discovery, ['api-a']); noImplicit(effects); assert.deepEqual(effects.save, []);
});
test('removing one connection never probes another connection', async () => {
    const { w, effects } = fixture(); await w.removeOfficialConnection('api-a');
    assert.deepEqual(effects.removed, []); await w.removeOfficialConnection('api-a');
    assert.deepEqual(effects.removed, ['api-a']); noImplicit(effects); assert.deepEqual(effects.save, []);
    assert.deepEqual(w.officialModels.connections.map(x => x.id), ['api-b', 'media']);
});
for (const validate of [false, true]) test(`save validate=${validate} sends only the configured model request and never fans out`, async () => {
    const { w, effects } = fixture(); w.officialProviderSheet = { id: 'custom_openai', protocol: 'openai_chat_completions', defaultModel: '', defaultBaseUrl: '' };
    w.officialDraft = { connectionId: 'api-a', label: 'A', model: 'api-a-other', baseUrl: 'https://fixture.invalid/v1', apiKey: '' };
    await w.saveOfficialConnection(validate); noImplicit(effects);
    assert.equal(effects.save.length, 1); assert.equal(effects.save[0].connectionId, 'api-a'); assert.equal(effects.save[0].model, 'api-a-other'); assert.equal(effects.save[0].validate, validate);
    assert.equal(w.officialConnectionStage, 'idle');
});
test('explicit existing-connection test validates only that primary model once', async () => {
    const { w, effects } = fixture(); await w.validateExistingOfficialConnection(w.officialModels.connections[1]);
    assert.equal(effects.save.length, 1); assert.equal(effects.save[0].connectionId, 'api-b'); assert.equal(effects.save[0].model, 'api-b-primary'); assert.equal(effects.save[0].validate, true); noImplicit(effects);
});
test('failed explicit test surfaces failure and never retries or checks other models', async () => {
    const { w, effects } = fixture(); w.platformService.saveOfficialModelConnection = async request => { effects.save.push(request); throw new Error('synthetic failure'); };
    await w.validateExistingOfficialConnection(w.officialModels.connections[0]);
    assert.equal(effects.save.length, 1); assert.equal(w.officialConnectionError, 'test failed'); assert.equal(w.officialConnectionStage, 'idle'); noImplicit(effects);
});

// Media poll success is represented by the returned connection status, not a
// text/tool-call validation object. Only the explicit test may describe it.
for (const entry of ['save', 'existing']) for (const [protocol, status, expected] of [
    ['async_media_template', 'verified', 'mediaReachable'],
    ['async_media_template', 'unverified', 'notChecked'],
    ['elevenlabs_music', 'verified', 'notChecked']
]) test(`${entry} explicit media check reports ${protocol}/${status} without claiming generation`, async () => {
    const { w, effects } = fixture(); const media = { ...connection('media', protocol), status };
    w.platformService.saveOfficialModelConnection = async request => { effects.save.push(request); return { connection: media }; };
    if (entry === 'save') {
        w.officialProviderSheet = { id: media.providerId, protocol, defaultModel: '', defaultBaseUrl: '' };
        w.officialDraft = { connectionId: media.id, label: media.label, model: media.model, baseUrl: media.baseUrl, apiKey: '' };
        await w.saveOfficialConnection(true);
    } else await w.validateExistingOfficialConnection(media);
    assert.equal(effects.save.length, 1); assert.equal(effects.save[0].validate, true);
    assert.equal(w.officialConnectionMessage, expected); noImplicit(effects);
});
test('save-only media metadata never presents a retained verified status as a new check', async () => {
    const { w, effects } = fixture(); const media = { ...connection('media', 'async_media_template'), status: 'verified' };
    w.platformService.saveOfficialModelConnection = async request => { effects.save.push(request); return { connection: media }; };
    w.officialProviderSheet = { id: media.providerId, protocol: media.protocol, defaultModel: '', defaultBaseUrl: '' };
    w.officialDraft = { connectionId: media.id, label: media.label, model: media.model, baseUrl: media.baseUrl, apiKey: '' };
    await w.saveOfficialConnection(false);
    assert.equal(effects.save.length, 1); assert.equal(effects.save[0].validate, false);
    assert.equal(w.officialConnectionMessage, '已保存模型'); noImplicit(effects);
});

test('own_api network failures use concise copy and My APIs cards omit inline red discovery error text in favor of MyApisErrorToast', async () => {
    const { modelFailureText } = await import('../lib/browser/nextmux-model-errors.js');
    const { myApisText } = await import('../lib/browser/nextmux-my-apis.js');
    const myApisSource = readFileSync(new URL('../src/browser/nextmux-my-apis.tsx', import.meta.url), 'utf8');
    const polishCss = readFileSync(new URL('../src/browser/style/nextmux-shell-polish.css', import.meta.url), 'utf8');
    assert.equal(modelFailureText('zh-CN', new Error('fetch failed ECONNREFUSED'), { source: 'own_api' }), '无法连接模型服务。');
    assert.equal(modelFailureText('zh-TW', new Error('fetch failed ECONNREFUSED'), { source: 'own_api' }), '無法連線模型服務。');
    assert.equal(myApisText('zh-CN', 'lead'), '你的密钥只存放在本地，对话不经过 NextMux 平台。');
    assert.match(source, /summary:\s*connection\.modelDiscoveryError\s*\?\s*''\s*:/);
    assert.match(source, /<MyApisErrorToast\s+locale=\{this\.desktopLocale\}/);
    assert.match(myApisSource, /onMouseEnter=\{\(\) => lifetime\.current\?\.pause\(\)\}/);
    assert.match(myApisSource, /onMouseLeave=\{event => \{ if \(!event\.currentTarget\.contains\(document\.activeElement\)\) lifetime\.current\?\.resume\(\); \}\}/);
    assert.match(polishCss, /\.nmx-shell \.nmx-my-apis-list > li:hover:not\(\.is-highlighted\)\s*\{\s*background:\s*var\(--nmx-panel\);/);
    assert.match(polishCss, /\.nmx-shell \.nmx-my-apis-error-toast\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?right:\s*24px;[\s\S]*?bottom:\s*24px;/);
});


