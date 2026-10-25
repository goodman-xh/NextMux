import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as discovery from '../lib/browser/nextmux-official-discovery.js';
import * as errors from '../lib/browser/nextmux-model-errors.js';
import { OwnModelsDrawer } from '../lib/browser/nextmux-own-models-drawer.js';
import { MyApisErrorToast } from '../lib/browser/nextmux-my-apis.js';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = createRequire(require.resolve('@theia/core/package.json'))('react-dom/server');
const presets = require('@nextmux/model-runtime/presets');
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const names = ['officialProviderPresets', 'myApiRows', 'refreshOfficialModelsAfterMutation', 'refreshOfficialConnectionModels',
    'officialConnectionRequestIsCurrent', 'renderOwnModelListDrawer', 'renderOfficialConnectionSheet', 'openAddOfficialApi', 'switchOfficialPresetInSheet', 'saveOfficialConnection'];
const methods = names.map(name => widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === name).getText(ast));
const deps = { React, ...discovery, ...errors, ...presets, OwnModelsDrawer, MyApisErrorToast,
    localizeDesktopSurface: (_locale, value) => value, myApisText: (_locale, key) => key,
    credentialStoreName: () => 'Keychain', localModelText: (_locale, key) => key,
    officialModelSurfaceText: (_locale, key) => key, desktopDomainMessage: () => 'API Key',
    desktopDomainErrorText: (_locale, error) => String(error?.message || error || ''), desktopStatus: value => value,
    ImeInput: props => React.createElement('input', props), MediaTemplateAdvanced: () => null, NativeWebResearchFields: () => null,
    mediaTemplateProblem: () => undefined, mediaTemplateFromPreset: () => ({}) };
delete deps.default;
delete deps.__esModule;
delete deps['module.exports'];
const Harness = new Function(...Object.keys(deps), ts.transpileModule(`class Harness { ${methods.join('\n')} }; return Harness;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React }
}).outputText)(...Object.values(deps));
const model = id => ({ id, label: id, capabilities: ['completion'], selectionMode: 'invokable' });
const connection = (patch = {}) => ({ id: 'connection-a', providerId: 'custom_openai', protocol: 'openai_chat_completions',
    label: 'Test API', providerName: 'Compatible', baseUrl: 'https://example.invalid/v1', model: 'chat-0',
    discoveredModels: Array.from({ length: 11 }, (_, i) => model(`chat-${i}`)), modelDiscoveryStatus: 'verified', ...patch });
function fixture(saved = connection()) {
    return Object.assign(new Harness(), { desktopLocale: 'zh-CN', officialModels: { providers: [], connections: [saved] },
        officialModelListOpenId: saved.id, officialModelsRequestToken: 0, officialConnectionRequestToken: 0, officialConnectionStage: 'idle',
        officialBusyConnectionId: '', officialConnectionMessage: '', officialConnectionError: '', globalModels: [],
        update() {}, syncModelRoute() {}, renderOfficialProviderLogo: () => null,
        verifyEnabledOfficialModels() { this.verificationCalls = (this.verificationCalls || 0) + 1; },
        officialProviderModels: () => [], officialConnectionsFor: () => [], renderProviderQuickGuide: () => null,
        renderOfficialProviderQuickGuide: () => null });
}
const listHtml = (saved, catalog) => renderToStaticMarkup(React.createElement(discovery.OwnModelList, { locale: 'zh-CN', connection: saved, catalog }));
function descendants(element) {
    if (!React.isValidElement(element)) return [];
    return [element, ...React.Children.toArray(element.props.children).flatMap(descendants)];
}

test('all 11 chat models and every mixed category are immediately expanded', () => {
    const saved = connection();
    const html = listHtml(saved);
    assert.equal((html.match(/<li>/g) || []).length, 11);
    assert.match(html, /<details open="" data-kind="llm">/);
    const mixed = listHtml(connection({ discoveredModels: [...saved.discoveredModels.slice(0, 10),
        { id: 'embedding-one', label: 'Embedding', capabilities: ['embedding'] }] }));
    const groups = mixed.match(/<details[^>]*>/g);
    assert.equal(groups.length, 2);
    assert.ok(groups.every(group => group.includes('open=""')));
    assert.equal((mixed.match(/<li>/g) || []).length, 11);
});

test('row count and drawer share unique discovered IDs plus manual default, including embeddings', () => {
    for (const saved of [connection(), connection({ model: 'manual-chat' }),
        connection({ model: 'manual-chat', discoveredModels: [] }),
        connection({ model: '', discoveredModels: [] }),
        connection({ discoveredModels: [model('chat-0'), model('chat-0'), { id: 'embed', label: 'embed', capabilities: ['embedding'] }] })]) {
        const entries = discovery.ownModelListModels(saved);
        assert.equal(fixture(saved).myApiRows()[0].modelCount, entries.length);
        assert.equal((listHtml(saved).match(/<li>/g) || []).length, entries.length);
        assert.equal(new Set(entries.map(item => item.id)).size, entries.length);
    }
    assert.equal(discovery.ownModelListModels(connection({ model: 'manual-chat' })).length, 12);
});

test('refresh updates this drawer in place, reports progress/result, and never verifies the API list', async () => {
    const saved = connection(), state = fixture(saved), calls = [];
    const updated = { ...saved, discoveredModels: [model('new-chat')], model: 'new-chat', lastModelDiscoveryAt: '2026-10-14T12:00:00Z' };
    let finish;
    state.platformService = { refreshOfficialModelDiscovery: id => { calls.push(id); return new Promise(resolve => { finish = resolve; }); },
        getOfficialModelConnections: async () => ({ providers: [], connections: [updated] }) };
    const before = descendants(state.renderOwnModelListDrawer()).find(item => item.type === discovery.OwnModelList);
    const pending = state.refreshOfficialConnectionModels(saved);
    assert.equal(state.officialConnectionStage, 'discovering');
    const refreshButton = descendants(state.renderOwnModelListDrawer()).find(item => item.type === 'button');
    assert.equal(refreshButton.props.disabled, true);
    await state.refreshOfficialConnectionModels(saved);
    assert.deepEqual(calls, [saved.id]);
    finish(updated); await pending;
    assert.equal(state.verificationCalls || 0, 0);
    assert.equal(state.officialModelListOpenId, saved.id);
    assert.equal(state.officialConnectionStage, 'idle');
    const drawer = state.renderOwnModelListDrawer();
    const after = descendants(drawer).find(item => item.type === discovery.OwnModelList);
    assert.equal(after.props.connection, updated);
    assert.notEqual(after.key, before.key);
    assert.match(renderToStaticMarkup(drawer), /role="status"/);
    assert.match(renderToStaticMarkup(drawer), /new-chat/);
    assert.doesNotMatch(renderToStaticMarkup(drawer), /chat-10/);
});

test('refresh failures retain models and display an alert only in the matching drawer', async () => {
    const saved = connection(), state = fixture(saved);
    state.platformService = { refreshOfficialModelDiscovery: async () => { throw new Error('network failed'); } };
    await state.refreshOfficialConnectionModels(saved);
    assert.ok(state.officialConnectionError);
    assert.equal(state.verificationCalls || 0, 0);
    assert.equal(state.officialModels.connections[0], saved);
    assert.match(renderToStaticMarkup(state.renderOwnModelListDrawer()), /role="alert"/);
    const other = connection({ id: 'connection-b' });
    state.officialModels.connections.push(other); state.officialModelListOpenId = other.id;
    assert.doesNotMatch(renderToStaticMarkup(state.renderOwnModelListDrawer()), /role="alert"/);
});

test('provider selector stays complete during cold start and is locked while editing', () => {
    for (const editing of [false, true]) {
        const state = fixture();
        state.officialProviderSheet = presets.OFFICIAL_PROVIDER_PRESETS.find(item => item.id === 'custom_openai');
        state.officialDraft = { model: 'chat', baseUrl: 'https://example.invalid/v1', apiKey: '', label: '', ...(editing ? { connectionId: 'saved' } : {}) };
        const label = descendants(state.renderOfficialConnectionSheet()).find(item => item.props['data-official-field'] === 'provider-preset');
        assert.ok(label);
        const select = descendants(label).find(item => item.type === 'select');
        assert.equal(select.props.disabled, editing);
        assert.equal(select.props.value, 'custom_openai');
        const options = descendants(select).filter(item => item.type === 'option').map(item => item.props.value);
        assert.deepEqual([...options].sort(), presets.OFFICIAL_PROVIDER_PRESETS.map(item => item.id).sort());
    }
});

test('fallback presets also power add and switch actions while preserving entered name and key', () => {
    const state = fixture(); let opened;
    state.openOfficialProviderFromMyApis = provider => { opened = provider; };
    state.openAddOfficialApi(); assert.equal(opened.id, 'custom_openai');
    state.officialDraft = { label: 'My name', apiKey: 'fixture-only-key' };
    state.openOfficialProvider = provider => { opened = provider; state.officialDraft = {}; state.myApisReturn = false; };
    state.setOfficialDraft = patch => Object.assign(state.officialDraft, patch);
    state.myApisReturn = true;
    state.switchOfficialPresetInSheet('anthropic');
    assert.equal(opened.id, 'anthropic'); assert.equal(state.myApisReturn, true);
    assert.deepEqual(state.officialDraft, { label: 'My name', apiKey: 'fixture-only-key' });
    state.officialDraft.connectionId = 'saved';
    state.switchOfficialPresetInSheet('openai'); assert.equal(opened.id, 'anthropic');
    state.officialModels.providers = [presets.OFFICIAL_PROVIDER_PRESETS[0]];
    assert.equal(state.officialProviderPresets(), state.officialModels.providers);
});

test('OwnModelList falls back to catalog referencePrice when discovered model omits inline pricing', () => {
    const saved = connection({ model: 'claude-sonnet-4-5', discoveredModels: [model('claude-sonnet-4-5')] });
    const catalog = [{
        id: 'anthropic/claude-sonnet-4.5',
        canonicalModel: 'anthropic/claude-sonnet-4.5',
        provider: 'anthropic',
        aliases: ['claude-sonnet-4-5'],
        output: ['text'],
        capabilities: ['tools'],
        contextTokens: 200000,
        maximumOutputTokens: 8192,
        referencePrice: { currency: 'USD', unit: 'per_million_tokens', input: 3, output: 15, source: 'Models.dev' }
    }];
    const html = listHtml(saved, catalog);
    assert.match(html, /输入 \$3 · 输出 \$15 \/ 百万 token<em>官方参考价<\/em>/);
    assert.doesNotMatch(html, /价格未提供/);
});

test('new OpenAI-compatible connection sheet can save with only URL and API Key, and failed save keeps typed API Key', async () => {
    const state = fixture();
    state.officialProviderSheet = presets.OFFICIAL_PROVIDER_PRESETS.find(item => item.id === 'custom_openai');
    state.officialDraft = { model: '', baseUrl: 'https://example.invalid/v1', apiKey: 'sk-keep-me', label: '' };
    const sheet = state.renderOfficialConnectionSheet();
    const advanced = descendants(sheet).find(item => item.props?.['data-official-advanced-model'] === 'true');
    assert.ok(advanced, 'manual model ID should be tucked under advanced details');
    const remarkInForm = descendants(sheet).find(item => item.props?.['data-official-field'] === 'label');
    assert.ok(remarkInForm, 'remark/name field must be visible at top level in the drawer');
    assert.equal(descendants(advanced).some(item => item.props?.['data-official-field'] === 'label'), false, 'remark/name field must not be buried inside collapsed advanced details');
    const saveButtons = descendants(sheet).filter(item => item.type === 'button' && String(item.props.className || '').includes('nmx-primary-button'));
    assert.equal(saveButtons.length, 1);
    assert.equal(saveButtons[0].props.disabled, false, 'URL + API Key should be sufficient to enable saving');

    state.platformService = {
        saveOfficialModelConnection: async () => { throw new Error('connection refused'); }
    };
    await state.saveOfficialConnection(false);
    assert.equal(state.officialDraft.apiKey, 'sk-keep-me', 'failed save must not wipe out the typed API Key');
});
