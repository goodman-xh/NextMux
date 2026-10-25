import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Exercise the actual widget methods without loading Electron, credentials, or any network service.
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['openOfficialProvider', 'clearOfficialProviderSurface', 'officialConnectionRequestIsCurrent',
    'saveOfficialConnection', 'validateExistingOfficialConnection', 'refreshOfficialConnectionModels',
    'discoverLocalDraftModels', 'removeOfficialConnection'];
const members = new Map();
const visit = node => {
    if (ts.isMethodDeclaration(node) && names.includes(node.name.getText(ast))) members.set(node.name.getText(ast), node.getText(ast));
    ts.forEachChild(node, visit);
};
visit(ast);
assert.equal(members.size, names.length);
const emitted = ts.transpileModule(`class Widget { ${[...members.values()].join('\n')} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const Widget = new Function('document', 'HTMLElement', 'requestAnimationFrame', 'nativeWebResearchDraft',
    'isOfficialMediaProtocol', 'modelFailureText', 'modelFailure', 'localizeDesktopSurface',
    'officialDiscoverySummary', 'connectionCheckText', 'officialModelSurfaceText', `${emitted}\nreturn Widget;`)(
    { activeElement: null }, class {}, () => {}, value => value, () => false, () => 'synthetic error',
    () => ({ detail: 'synthetic detail' }), (_locale, text) => text, () => 'refreshed', () => 'checked', () => 'discovered');
const provider = id => ({ id, protocol: 'openai', defaultModel: `${id}-model`, defaultBaseUrl: `https://${id}.example.invalid` });
const connection = id => ({ id, providerId: 'a', protocol: 'openai', label: id, model: 'model', baseUrl: 'https://a.example.invalid' });
const result = id => ({ connection: connection(id) });
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture() {
    const widget = new Widget();
    Object.assign(widget, { officialConnectionRequestToken: 0, officialConnectionStage: 'idle',
        officialDraft: { label: '', model: '', baseUrl: '', apiKey: '' }, node: { querySelector() {} }, globalModels: [{}],
        desktopLocale: 'en', isDisposed: false, update() {}, rememberNavigation() {}, defaultOfficialProviderSettings() {},
        clearNavigationSurfaces() { this.clearOfficialProviderSurface(); }, closeNavigationSurface() { this.clearOfficialProviderSurface(); },
        async refreshOfficialModelsAfterMutation() {}, officialConnectionsFor: () => [], addNotification() {} });
    widget.openOfficialProvider(provider('a'));
    widget.officialDraft.apiKey = 'SYNTHETIC_KEY_A';
    return widget;
}
function assertB(widget, stage = 'saving') {
    assert.equal(widget.officialProviderSheet.id, 'b');
    assert.equal(widget.officialDraft.apiKey, 'SYNTHETIC_KEY_B');
    assert.equal(widget.officialDraft.model, 'b-model');
    assert.equal(widget.officialConnectionEditorOpen, true);
    assert.equal(widget.officialConnectionStage, stage);
    assert.equal(widget.officialConnectionError, '');
    assert.equal(widget.officialConnectionMessage, '');
}

for (const outcome of ['failure', 'success', 'refresh-failure']) {
    test(`pending save ${outcome} cannot fill, clear, close or unlock another provider's new save`, async () => {
        const w = fixture(), a = deferred(), b = deferred();
        w.platformService = { saveOfficialModelConnection: input => input.providerId === 'a' ? a.promise : b.promise };
        if (outcome === 'refresh-failure') w.refreshOfficialModelsAfterMutation = async () => { throw new Error('refresh failed'); };
        const old = w.saveOfficialConnection(false);
        w.openOfficialProvider(provider('b'));
        w.officialDraft.apiKey = 'SYNTHETIC_KEY_B';
        const current = w.saveOfficialConnection(false);
        if (outcome === 'failure') a.reject(new Error('save failed')); else a.resolve(result('a'));
        await old;
        assertB(w);
        b.reject(new Error('same owner failure'));
        await current;
        assert.equal(w.officialDraft.apiKey, 'SYNTHETIC_KEY_B', 'the current owner keeps its typed key for retry');
        assert.equal(w.officialConnectionStage, 'idle');
    });
}

test('navigation during the catalog refresh and reopening the same provider creates a new owner', async () => {
    const w = fixture(), refresh = deferred();
    w.platformService = { async saveOfficialModelConnection() { return result('a'); } };
    w.refreshOfficialModelsAfterMutation = () => refresh.promise;
    const pending = w.saveOfficialConnection(false);
    await Promise.resolve();
    w.clearOfficialProviderSurface();
    w.openOfficialProvider(provider('a'));
    w.officialDraft.apiKey = 'SYNTHETIC_REOPENED_A';
    refresh.resolve();
    await pending;
    assert.equal(w.officialDraft.apiKey, 'SYNTHETIC_REOPENED_A');
    assert.equal(w.officialConnectionEditorOpen, true);
    assert.equal(w.officialConnectionMessage, '');
});

test('leaving for a non-provider surface prevents an old failure from restoring a secret', async () => {
    const w = fixture(), pending = deferred();
    w.platformService = { saveOfficialModelConnection: () => pending.promise };
    const work = w.saveOfficialConnection(false);
    w.clearOfficialProviderSurface();
    pending.reject(new Error('failure after navigation'));
    await work;
    assert.equal(w.officialProviderSheet, undefined);
    assert.equal(w.officialDraft.apiKey, '');
    assert.equal(w.officialConnectionError, '');
});

test('current owner success still clears the key and returns to its saved connection', async () => {
    const w = fixture();
    w.platformService = { async saveOfficialModelConnection() { return result('saved-a'); } };
    await w.saveOfficialConnection(false);
    assert.equal(w.officialDraft.apiKey, '');
    assert.equal(w.myApisHighlight, 'saved-a');
    assert.equal(w.officialConnectionStage, 'idle');
});

for (const operation of ['validateExistingOfficialConnection', 'refreshOfficialConnectionModels', 'discoverLocalDraftModels', 'removeOfficialConnection']) {
    for (const outcome of ['success', 'failure']) {
        test(`${operation} ${outcome} cannot overwrite the next drawer or its pending save`, async () => {
            const w = fixture(), old = deferred(), current = deferred();
            if (operation === 'discoverLocalDraftModels') w.officialProviderSheet = provider('ollama');
            w.officialDeleteConfirmId = 'old';
            w.platformService = { saveOfficialModelConnection: input => input.providerId === 'b' ? current.promise : old.promise,
                refreshOfficialModelDiscovery: () => old.promise, discoverLocalModels: () => old.promise, removeOfficialModelConnection: () => old.promise };
            const pending = w[operation](operation === 'removeOfficialConnection' ? 'old' : connection('old'));
            w.openOfficialProvider(provider('b'));
            w.officialDraft.apiKey = 'SYNTHETIC_KEY_B';
            const save = w.saveOfficialConnection(false);
            if (outcome === 'failure') old.reject(new Error('old failure'));
            else old.resolve(operation === 'discoverLocalDraftModels' ? [] : operation === 'validateExistingOfficialConnection' ? result('old') : connection('old'));
            await pending;
            assertB(w);
            current.reject(new Error('current failure'));
            await save;
        });
    }
}
