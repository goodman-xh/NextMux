import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const refreshModule = {};
new Function('exports', ts.transpileModule(readFileSync(new URL('../src/browser/nextmux-catalog-refresh.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(refreshModule);
const { CatalogSnapshotRefresh, merchantSnapshotRemoved } = refreshModule;

const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const names = ['applyPlatformSession', 'checkModelCatalogVersion', 'loadCatalog', 'loadCatalogSource', 'loadPlatformCatalog', 'loadRegistryModels',
    'reloadMerchantCatalogSnapshot', 'reloadMerchantDiscoverySnapshot', 'forgetMerchantCatalogSnapshot', 'loadComicStepDirectory', 'catalogMerchantSources', 'savedRouteOffering', 'savedFixedOfferingKey', 'loadSavedFixedOffering'];
const code = names.map(name => widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === name).getText(ast)).join('\n');
const capabilities = ['text', 'image', 'video', 'speech', 'music', 'sound_effect'];
function fixture() {
    const timers = new Map(); let nextTimer = 0;
    const storage = [];
    const window = { clearTimeout(id) { timers.delete(id); }, setTimeout(fn, delay) { timers.set(++nextTimer, { fn, delay }); return nextTimer; },
        localStorage: { setItem(...args) { storage.push(args); }, getItem() { return null; } } };
    const Harness = new Function('window', 'COMIC_STEP_CAPABILITIES', 'managedRelayKey', 'merchantSnapshotRemoved', 'EMPTY_ACCOUNT_OVERVIEW', 'ModelSwitchSettings',
        ts.transpile(`class Harness { ${code} }; return Harness;`, { target: ts.ScriptTarget.ES2022 }))(window, capabilities, id => `managed:${id}`, merchantSnapshotRemoved, {}, class {});
    const instance = Object.assign(new Harness(), {
        savedFixedOfferings: new Map(), savedFixedOfferingRequests: new Map(), savedFixedOfferingRevision: 0,
        catalogSnapshotRefresh: new CatalogSnapshotRefresh(), catalogSnapshotRevision: 0, pendingCatalogVersion: '', publicMerchantDirectoryVersion: 'old',
        pendingCatalogMerchants: new Set(), catalogRemovedMerchants: new Set(), pendingComicDirectories: new Set(), catalogVersionRetryAttempts: 0, catalogSourceRetries: new Map(),
        originalReceiptChecks: new Map(), accountOverview: {}, publicMerchantPage: undefined, favoriteMerchantPage: undefined, selectedPublicMerchant: undefined,
        codingSessions: [], activeRelayKey: '', activeModelRouteId: '', activeCodingSession() { return this.codingSessions[0]; }, comicStepPrefs: { relays: {}, choices: {} }, comicStepChoice() {}, codingSessionRelayKey: session => session.relayKey,
        merchantPickerSnapshots: new Map(), merchantDiscoveredModels: new Map(), comicStepDirectory: new Map(),
        platformSession: { linked: true, user: { id: 'owner' } }, merchantCatalogRequest: 0, scheduleCatalogRequest: 0, publicMerchantPageRequest: 0,
        platformCatalog: { online: true, offerings: [{ id: 'old' }] }, registryModels: [{ id: 'old-registry' }], globalModels: [{ id: 'old-global' }],
        update() {}, syncModelRoute() {}, recoverDeletedOfficialRelay() {}, loadModelCenterMerchantCount() {}, applyCatalog(value) { this.platformCatalog = value; },
        accountOverviewRevision: 0, loadAccountOverview: async () => {}, modelSwitchStorageKey: () => 'fixture',
        offeringMerchantId: row => row.merchantId,
        platformService: { getModelCatalogVersion: async () => ({ version: 'new' }), getCatalog: async () => ({ online: true, offerings: [] }),
            getModelRegistry: async () => [], getPublicMerchantDirectory: async () => ({ merchants: [] }),
            getMerchantCatalog: async id => ({ merchantId: id, online: true, offerings: [] }),
            getMerchantDiscoveredModels: async id => ({ merchantId: id, models: [] }), getCatalogOffering: async () => undefined },
        loadGlobalModels: async () => true
    });
    return { instance, timers, storage };
}

test('a revision commits only after every required source succeeds and retries only failed sources', async () => {
    const { instance, storage, timers } = fixture();
    const calls = { catalog: 0, registry: 0, global: 0 };
    let registryReady = false, globalReady = false;
    instance.platformService.getCatalog = async () => { calls.catalog++; return { online: true, offerings: [{ id: 'new' }] }; };
    instance.platformService.getModelRegistry = async () => { calls.registry++; if (!registryReady) throw Error('registry unavailable'); return [{ id: 'new-registry' }]; };
    instance.loadGlobalModels = async () => { calls.global++; return globalReady; };
    await instance.checkModelCatalogVersion();
    assert.equal(instance.publicMerchantDirectoryVersion, 'old'); assert.deepEqual(storage, []);
    assert.deepEqual(instance.registryModels, [{ id: 'old-registry' }]);
    assert.equal(timers.size, 1); assert.equal([...timers.values()][0].delay, 5000);
    registryReady = true;
    await instance.checkModelCatalogVersion();
    assert.equal(instance.publicMerchantDirectoryVersion, 'old'); assert.deepEqual(calls, { catalog: 1, registry: 2, global: 2 });
    globalReady = true;
    await instance.checkModelCatalogVersion();
    assert.equal(instance.publicMerchantDirectoryVersion, 'new'); assert.deepEqual(calls, { catalog: 1, registry: 2, global: 3 });
    assert.deepEqual(storage, [['nextmux.desktop.modelCatalogVersion.v1', 'new']]);
    assert.equal(instance.publicMerchantPageRequest, 1); assert.equal(timers.size, 0);
    await instance.checkModelCatalogVersion(); assert.deepEqual(calls, { catalog: 1, registry: 2, global: 3 });
});

for (const partiallyReady of [true, false]) test(`account switching refreshes the same version after ${partiallyReady ? 'partial' : 'complete'} success`, async () => {
    const { instance, storage } = fixture(); const owners = [];
    instance.platformService.getCatalog = async () => {
        const owner = instance.platformSession.user.id; owners.push(owner);
        return { online: true, offerings: [{ id: owner }] };
    };
    instance.platformService.getModelRegistry = async () => {
        if (partiallyReady && instance.platformSession.user.id === 'owner') throw Error('temporary');
        return [];
    };
    await instance.checkModelCatalogVersion();
    assert.deepEqual(owners, ['owner']);
    instance.applyPlatformSession({ linked: true, user: { id: 'next-owner' } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(instance.catalogVersionChecking, false);
    assert.deepEqual(owners, ['owner', 'next-owner']);
    assert.deepEqual(instance.platformCatalog.offerings, [{ id: 'next-owner' }]);
    assert.equal(instance.publicMerchantDirectoryVersion, 'new');
    assert.equal(storage.length, partiallyReady ? 1 : 2);
    instance.applyPlatformSession({ linked: true, user: { id: 'next-owner' } });
    await instance.checkModelCatalogVersion();
    assert.deepEqual(owners, ['owner', 'next-owner'], 'same-owner session updates retain completed sources');
});

for (const phase of ['version', 'snapshot']) test(`switching accounts while the ${phase} request is pending cannot commit the old refresh`, async () => {
    const { instance, storage, timers } = fixture(); let finish;
    if (phase === 'version') instance.platformService.getModelCatalogVersion = () => new Promise(resolve => { finish = () => resolve({ version: 'new' }); });
    else instance.platformService.getCatalog = () => new Promise(resolve => { finish = () => resolve({ online: true, offerings: [{ id: 'old-owner' }] }); });
    const pending = instance.checkModelCatalogVersion();
    while (!finish) await new Promise(resolve => setImmediate(resolve));
    instance.applyPlatformSession({ linked: true, user: { id: 'next-owner' } });
    finish(); await pending;
    assert.deepEqual(storage, []);
    assert.equal(instance.publicMerchantDirectoryVersion, '');
    assert.deepEqual(instance.platformCatalog.offerings, [{ id: 'old' }]);
    assert.equal(timers.size, 1, 'an invalidated check schedules a fresh account request');
    instance.platformService.getModelCatalogVersion = async () => ({ version: 'new' });
    instance.platformService.getCatalog = async () => ({ online: true, offerings: [{ id: 'next-owner' }] });
    await instance.checkModelCatalogVersion();
    assert.equal(instance.publicMerchantDirectoryVersion, 'new');
    assert.deepEqual(instance.platformCatalog.offerings, [{ id: 'next-owner' }]);
    assert.equal(storage.length, 1);
});

test('coordinator reset rejects an earlier in-flight refresh even if the new account uses the same version', async () => {
    const refresh = new CatalogSnapshotRefresh(); let finish;
    const old = refresh.refresh('same-version', [{ key: 'catalog', load: () => new Promise(resolve => { finish = resolve; }) }]);
    await Promise.resolve();
    refresh.reset();
    assert.equal(await refresh.refresh('same-version', [{ key: 'catalog', load: async () => true }]), true);
    finish(true);
    assert.equal(await old, false);
});

test('version refresh expires comic directories and reloads foreground, background and every comic merchant', async () => {
    const { instance } = fixture(); const merchants = [], directories = [];
    instance.activeRelayKey = 'managed:foreground';
    instance.codingSessions = [{ relayKey: 'managed:background', turns: [{ stage: 'running' }] }, { relayKey: 'managed:idle', turns: [{ stage: 'complete' }] }];
    instance.comicStepPrefs.relays = { image: 'managed:images', speech: 'managed:voices' };
    instance.comicStepChoice = kind => kind === 'video' ? { source: { key: 'managed:movies' } } : undefined;
    instance.comicStepDirectory.set('image', { loading: false, revision: 0, relays: [{ key: 'managed:old' }] });
    instance.comicStepDirectory.set('speech', { loading: false, revision: 0, relays: [{ key: 'managed:old' }] });
    instance.platformService.getMerchantCatalog = async id => { merchants.push(id); return { merchantId: id, online: true, offerings: [{ id: `new-${id}`, merchantId: id }] }; };
    instance.platformService.getPublicMerchantDirectory = async query => { directories.push(query.capability); return { merchants: [{ id: `new-${query.capability}`, name: 'Fresh' }] }; };
    await instance.checkModelCatalogVersion();
    assert.deepEqual(merchants.sort(), ['background', 'foreground', 'images', 'movies', 'voices']);
    assert.deepEqual(directories.sort(), ['audio', 'image']);
    assert.equal(instance.comicStepDirectory.get('speech').relays[0].key, 'managed:new-audio');
    assert.equal(instance.publicMerchantDirectoryVersion, 'new');
});

test('startup failures retry registry and global independently without reloading the successful main catalog', async () => {
    const { instance, timers } = fixture(); let catalogs = 0, registries = 0, globals = 0;
    instance.platformService.getCatalog = async () => { catalogs++; return { online: true, offerings: [] }; };
    instance.platformService.getModelRegistry = async () => { if (++registries === 1) throw Error('temporary'); return []; };
    instance.loadGlobalModels = async () => ++globals > 1;
    assert.equal(await instance.loadCatalog(), false); assert.equal(timers.size, 2);
    for (const timer of [...timers.values()]) timer.fn();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual([catalogs, registries, globals], [1, 2, 2]); assert.equal(timers.size, 0);
});

test('a failed later merchant page keeps the complete old snapshot until all new pages succeed', async () => {
    const { instance } = fixture(); const old = { merchantId: 'merchant', online: true, offerings: [{ id: 'old', merchantId: 'merchant' }] };
    instance.merchantPickerSnapshots.set('merchant', { catalog: old, updatedAt: 123 });
    let fail = true;
    instance.platformService.getMerchantCatalog = async (id, after) => {
        if (!after) return { merchantId: id, online: true, offerings: [{ id: 'a', merchantId: id }], nextCursor: 'a' };
        if (fail) throw Error('503');
        return { merchantId: id, online: true, offerings: [{ id: 'b', merchantId: id }] };
    };
    assert.equal(await instance.reloadMerchantCatalogSnapshot('merchant'), false);
    assert.equal(instance.merchantPickerSnapshots.get('merchant').catalog, old);
    fail = false; assert.equal(await instance.reloadMerchantCatalogSnapshot('merchant'), true);
    assert.deepEqual(instance.merchantPickerSnapshots.get('merchant').catalog.offerings.map(row => row.id), ['a', 'b']);
});

test('a first merchant load shows each page as it arrives, with the saved model first', async () => {
    const { instance } = fixture();
    instance.codingSessions = [{ id: 'session', routeId: 'managed:fixed:saved' }];
    instance.activeRelayKey = 'managed:merchant';
    instance.platformService.getCatalogOffering = async id => ({ id, merchantId: 'merchant', status: 'active' });
    const seen = [];
    instance.syncModelRoute = () => seen.push(instance.merchantPickerSnapshots.get('merchant')?.catalog.offerings.map(row => row.id));
    instance.platformService.getMerchantCatalog = async (id, after) => {
        await new Promise(resolve => setImmediate(resolve));
        if (!after) return { merchantId: id, online: true, offerings: [{ id: 'a', merchantId: id }], nextCursor: 'a' };
        return { merchantId: id, online: true, offerings: [{ id: 'b', merchantId: id }, { id: 'saved', merchantId: id }] };
    };
    assert.equal(await instance.reloadMerchantCatalogSnapshot('merchant'), true);
    assert.deepEqual(seen, [['a', 'saved'], ['a', 'b', 'saved']]);
    assert.equal(instance.selectedMerchantCatalog.offerings.length, 3); assert.equal(instance.merchantCatalogStatus, 'ready');
});

test('an earlier comic directory response cannot overwrite the new revision', async () => {
    const { instance } = fixture(); let finish;
    instance.platformService.getPublicMerchantDirectory = () => new Promise(resolve => { finish = resolve; });
    const pending = instance.loadComicStepDirectory('image');
    instance.catalogSnapshotRevision++;
    instance.comicStepDirectory.set('image', { loading: false, revision: 1, relays: [{ key: 'managed:fresh' }] });
    finish({ merchants: [{ id: 'stale', name: 'Stale' }] });
    assert.equal(await pending, false);
    assert.equal(instance.comicStepDirectory.get('image').relays[0].key, 'managed:fresh');
});

test('new revisions and newly required sources are never satisfied by earlier coordinator successes', async () => {
    const refresh = new CatalogSnapshotRefresh(); let calls = 0;
    const source = { key: 'catalog', load: async () => { calls++; return true; } };
    assert.equal(await refresh.refresh('one', [source]), true);
    assert.equal(await refresh.refresh('one', [source, { key: 'merchant', load: async () => false }]), false);
    assert.equal(calls, 1);
    assert.equal(await refresh.refresh('two', [source]), true); assert.equal(calls, 2);
});


test('explicit merchant removal clears obsolete snapshots and cannot block a revision or be resurrected by a late success', async () => {
    const { instance } = fixture(); let finish;
    instance.activeRelayKey = 'managed:removed';
    const old = { merchantId: 'removed', online: true, offerings: [{ id: 'old', merchantId: 'removed' }] };
    instance.selectedMerchantCatalog = old;
    instance.merchantPickerSnapshots.set('removed', { catalog: old, updatedAt: 123 });
    instance.merchantDiscoveredModels.set('removed', [{ id: 'old' }]);
    instance.platformService.getMerchantCatalog = () => new Promise(resolve => { finish = resolve; });
    instance.platformService.getMerchantDiscoveredModels = async () => { throw Object.assign(Error('removed'), { code: 'merchant_not_found', data: { httpStatus: 404 } }); };
    const refresh = instance.checkModelCatalogVersion();
    while (!finish || !instance.catalogRemovedMerchants.has('removed')) await new Promise(resolve => setImmediate(resolve));
    finish(old);
    await refresh;
    assert.equal(instance.publicMerchantDirectoryVersion, 'new');
    assert.equal(instance.selectedMerchantCatalog, undefined);
    assert.equal(instance.merchantPickerSnapshots.has('removed'), false);
    assert.equal(instance.merchantDiscoveredModels.has('removed'), false);
});

test('transient merchant failures retain old snapshots and leave the revision retryable', async () => {
    const { instance } = fixture();
    const old = { merchantId: 'temporary', online: true, offerings: [{ id: 'old', merchantId: 'temporary' }] };
    instance.merchantPickerSnapshots.set('temporary', { catalog: old, updatedAt: 123 });
    instance.platformService.getMerchantCatalog = async () => { throw Object.assign(Error('temporary'), { data: { httpStatus: 503 } }); };
    await instance.checkModelCatalogVersion();
    assert.equal(instance.publicMerchantDirectoryVersion, 'old');
    assert.equal(instance.merchantPickerSnapshots.get('temporary').catalog, old);
    assert.equal(instance.merchantPickerSnapshots.get('temporary').updatedAt, 0);
    assert.equal(instance.catalogRemovedMerchants.size, 0);
});

test('a saved model outside the first catalog slice resolves with that slice, not when its own slice arrives', async () => {
    const { instance } = fixture();
    instance.codingSessions = [{ id: 'session', routeId: 'managed:fixed:saved-offering' }];
    const requested = [];
    instance.platformService.getCatalog = async () => ({ online: true, offerings: [{ id: 'frontier' }], nextCursor: 'gc1_next' });
    instance.platformService.getCatalogOffering = async id => { requested.push(id); return { id, canonicalModel: 'deepseek/deepseek-v3.2' }; };
    instance.loadRestOfPlatformCatalog = async () => {};
    assert.equal(await instance.loadPlatformCatalog(), true);
    assert.deepEqual(requested, ['saved-offering']);
    assert.deepEqual(instance.platformCatalog.offerings.map(offering => offering.id), ['frontier', 'saved-offering']);
    instance.platformService.getCatalog = async () => ({ online: true, offerings: [{ id: 'saved-offering' }] });
    assert.equal(await instance.loadPlatformCatalog(), true);
    assert.deepEqual(instance.platformCatalog.offerings.map(offering => offering.id), ['saved-offering'], 'an offering already in the slice is not added twice');
});
