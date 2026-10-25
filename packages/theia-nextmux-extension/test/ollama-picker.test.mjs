import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

// Exercise the actual picker and Settings methods without starting Theia or
// contacting a model server. These fixtures contain no stored credentials.
const modules = new Map();
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
const src = fileURLToPath(new URL('../src/', import.meta.url));
const discovery = load(resolve(src, 'browser/nextmux-official-discovery.tsx'));
const selection = load(resolve(src, 'browser/nextmux-model-route-selection.ts'));
const require = createRequire(import.meta.url);
const capabilities = require('@nextmux/model-runtime/capabilities');
const source = readFileSync(resolve(src, 'browser/nextmux-desktop-widget.tsx'), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const names = ['officialModelRoutes', 'connectionForDiscoveredModel', 'codingModelOptions',
    'normalizedModelId', 'modelKeyForConnection', 'connectionInputModalities', 'connectionCapabilityLabels',
    'saveOfficialConnection', 'validateExistingOfficialConnection', 'officialConnectionRequestIsCurrent', 'comicConnectionMetadata'];
const methods = names.map(name => {
    const method = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name);
    assert.ok(method, `production method ${name}`); return method.getText(file);
});
const dependencies = { ...discovery, ...selection, ...capabilities, ...require('@nextmux/model-runtime/presets'),
    ...load(resolve(src, 'browser/nextmux-model-visibility.ts')),
    ...load(resolve(src, 'browser/nextmux-own-model-kind.ts')),
    ...load(resolve(src, 'browser/nextmux-own-model-match.ts')) };
const Harness = new Function(...Object.keys(dependencies), ts.transpileModule(`class Harness { ${methods.join('\n')} }; return Harness;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React }
}).outputText)(...Object.values(dependencies));
const now = '2026-09-28T10:00:00.000Z';
const verified = ['model:generatable', 'tools'].map(capability => ({
    capability, support: 'supported', confidence: 'verified', source: 'live_probe', observedAt: now
}));
const validation = { checkedAt: now, latencyMs: 5, toolCalling: true };
function model(id, capabilities, patch = {}) {
    return { id, label: id, capabilities, toolsSupported: capabilities.includes('tools'),
        interfaceSupport: capabilities.includes('completion') ? 'supported' : 'unsupported',
        inputModalities: capabilities.includes('vision') ? ['text', 'image'] : ['text'],
        contextTokens: 32768, ...patch };
}
function connection(patch = {}) {
    return { id: 'local-fixture', providerId: 'ollama', protocol: 'openai_chat_completions',
        providerName: 'Ollama', modelFamily: 'Local', model: 'coder', label: 'Local server',
        baseUrl: 'http://127.0.0.1:11434/v1', keyHint: '', status: 'verified', toolCapability: 'verified',
        capabilityEvidence: verified, modelDiscoveryStatus: 'verified',
        discoveredModels: [model('coder', ['completion', 'tools'])],
        ollamaStatus: { version: '0.12.1', modelCount: 4, toolsModelCount: 2 },
        lastSuccessfulModelDiscoveryAt: now, lastModelDiscoveryAt: now, updatedAt: now, createdAt: now, ...patch };
}
function fixture(connections) {
    const state = new Harness();
    Object.assign(state, {
        platformSession: { linked: false }, officialConnectionRequestToken: 0,
        officialModels: { providers: [], connections }, registryModels: [], globalModels: [], platformCatalog: { offerings: [] },
        merchantPickerSnapshots: new Map(), merchantDiscoveredModels: new Map(),
        officialMediaChecks: new Set(), officialPickerValidationAttempts: new Map(), officialPickerValidations: new Map(),
        officialPickerValidationFailures: new Set(), officialPickerAuthFailures: new Set(),
        managedOfferings: () => [], isModelVisible: () => true, isDisposed: false, officialModelsLoading: false,
        globalModelsLoading: false, modelOnlyDisplayName: (_label, _provider, id) => id, update() {},
        desktopLocale: 'en', officialConnectionStage: 'idle',
        refreshOfficialModelsAfterMutation: async () => {}, defaultOfficialProviderSettings: () => undefined,
        closeNavigationSurface() { this.navigationCloseCount = (this.navigationCloseCount || 0) + 1; this.officialProviderSheet = undefined; }
    });
    return state;
}

test('native no-tools declaration blocks stale positive proof even for the saved default model', () => {
    const entry = model('coder', ['completion'], { validation });
    for (const providerId of ['ollama', 'custom_openai']) {
        const saved = connection({ providerId, discoveredModels: [entry] });
        const before = JSON.stringify(saved), state = fixture([saved]);
        assert.deepEqual(state.officialModelRoutes(), []);
        const [option] = state.codingModelOptions('official:local-fixture');
        assert.equal(option.available, false);
        assert.equal(option.availabilityReason, 'tools_unsupported');
        assert.ok(!option.capabilities.includes('tools'));
        assert.equal(JSON.stringify(saved), before, 'selection never mutates saved proof');
    }
});

test('vision, reasoning and effective context reach the picker while unprobed tools remain unavailable', () => {
    const saved = connection({ discoveredModels: [model('coder', ['completion', 'tools']),
        model('multimodal', ['completion', 'tools', 'vision', 'thinking'], { validation, contextTokens: 16384 }),
        model('unprobed', ['completion', 'tools'])] });
    const state = fixture([saved]);
    const routes = state.officialModelRoutes();
    assert.deepEqual(routes.map(route => route.connection.model), ['coder', 'multimodal']);
    assert.equal(routes[0].connection.label, 'Local server');
    const options = state.codingModelOptions('official:local-fixture');
    const vision = options.find(option => option.model === 'multimodal');
    assert.equal(vision.available, true);
    assert.deepEqual(vision.input, ['text', 'image']);
    assert.ok(vision.capabilities.includes('reasoning'));
    assert.equal(vision.contextTokens, 16384);
    assert.equal(options.find(option => option.model === 'unprobed').available, false);
    const evidence = state.connectionForDiscoveredModel(saved, 'unprobed').capabilityEvidence;
    assert.equal(capabilities.modelCapabilitySupport(evidence, 'tools'), 'supported');
    assert.equal(capabilities.modelCapabilityHasVerifiedSupport(evidence, 'tools'), false);
});

test('embedding-only models are hidden from chat candidates and routes including manually configured defaults', () => {
    const embedding = model('embed', ['embedding'], { validation });
    const saved = connection({ model: 'embed', discoveredModels: [embedding, model('chat', ['completion', 'tools'], { validation })] });
    assert.deepEqual(discovery.officialInvokableModelIds(saved), ['chat']);
    assert.deepEqual(discovery.officialDiscoveredModelIds(saved), ['chat']);
    assert.deepEqual(fixture([saved]).codingModelOptions('official:local-fixture').map(option => option.model), ['chat']);
    assert.deepEqual(fixture([saved]).officialModelRoutes().map(route => route.connection.model), ['chat']);
    assert.equal(saved.discoveredModels.length, 2, 'Settings can still inspect every installed model');
});

test('positive Ollama tool metadata alone never authorizes inference', () => {
    const saved = connection({ model: 'plain', capabilityEvidence: [], status: 'unverified',
        discoveredModels: [model('plain', ['completion']), model('embed', ['embedding']), model('coder', ['completion', 'tools'])] });
    const state = fixture([saved]); const before = JSON.stringify(saved);
    assert.deepEqual(state.officialModelRoutes(), []);
    assert.equal(state.codingModelOptions('official:local-fixture').find(row => row.model === 'coder').available, false);
    assert.equal(JSON.stringify(saved), before);
});


test('non-Ollama routes without native metadata keep their existing default proof', () => {
    const saved = connection({ providerId: 'openai', ollamaStatus: undefined, discoveredModels: [] });
    const state = fixture([saved]);
    assert.equal(state.officialModelRoutes().length, 1);
    assert.deepEqual(state.officialModelRoutes()[0].connection.capabilityEvidence, verified);
    assert.equal(state.codingModelOptions('official:local-fixture')[0].available, true);
});

test('Settings reports live Ollama version and total/tool counts in English and Chinese', async () => {
    const saved = connection();
    assert.equal(discovery.officialDiscoverySummary('en', saved), 'Ollama 0.12.1 running, 4 models, 2 with tools');
    assert.equal(discovery.officialDiscoverySummary('zh-CN', saved), 'Ollama 0.12.1 正在运行，4 个模型，2 个支持工具调用');
    assert.doesNotMatch(discovery.officialDiscoverySummary('en', { ...saved, modelDiscoveryStatus: 'unsupported' }), /running/);
    assert.doesNotMatch(discovery.officialDiscoverySummary('en', { ...saved, modelDiscoveryFailure: 'network_error' }), /running/);
    const state = fixture([saved]);
    state.platformService = { saveOfficialModelConnection: async () => ({ connection: saved }) };
    await state.validateExistingOfficialConnection(saved);
    assert.equal(state.officialConnectionMessage, 'Ollama 0.12.1 running, 4 models, 2 with tools');
    state.officialProviderSheet = { id: 'ollama', defaultModel: 'coder', defaultBaseUrl: saved.baseUrl };
    state.officialDraft = { model: 'coder', baseUrl: saved.baseUrl, apiKey: '', label: '' };
    await state.saveOfficialConnection(true);
    assert.equal(state.officialConnectionMessage, 'Ollama 0.12.1 running, 4 models, 2 with tools');
    assert.equal(state.navigationCloseCount, 1, 'saving an Ollama connection returns to My APIs');
    assert.equal(state.myApisHighlight, saved.id);
});
