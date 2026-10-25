import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { normalizeContextWindowTokens } from '../lib/common/nextmux-context-budget.js';
const source = ts.createSourceFile('widget.tsx', readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const names = ['savedFixedOfferingKey', 'savedFixedOfferingsForMerchant', 'loadSavedFixedOffering', 'savedRouteOffering', 'waitForCatalogRoute',
    'restoreCodingSourceSelection', 'managedOfferings', 'managedModelRoutes', 'routesForRelay', 'modelRoutes'];
const methods = names.map(name => widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === name).getText(source)).join('\n');
const fields = widget.members.filter(node => ts.isPropertyDeclaration(node) && /^savedFixed/.test(node.name.getText(source))).map(node => node.getText(source)).join('\n');
const Harness = Function('window', 'automaticRelaySource', 'optionalKeyPriceQuoteId', 'normalizeContextWindowTokens', ts.transpile(`class Harness { ${fields}\n${methods} }; return Harness;`, { target: ts.ScriptTarget.ES2022 }))(
    { setTimeout: (fn, delay) => setTimeout(fn, Math.min(delay, 5)) }, value => value, value => value, normalizeContextWindowTokens);
const row = (id = 'fixed-a', merchantId = 'a') => ({ id, merchantId, status: 'active', available: true, workbenches: ['coding'], category: 'coding',
    canonicalModel: 'vendor/model', registryModelId: 'model', input: ['text'], output: ['text'], capabilities: ['tools', 'coding'] });
function fixture() {
    const calls = [], updates = [];
    const instance = Object.assign(new Harness(), {
        platformSession: { linked: true, user: { id: 'owner' } }, catalogSnapshotRevision: 1, catalogRemovedMerchants: new Set(),
        merchantPickerSnapshots: new Map(), platformCatalog: { offerings: [] }, selectedModelIds: {}, permissionMode: 'workspace_write',
        activeSection: 'coding', activeCodingSessionId: 'A', activeRelayKey: '', activeModelRouteId: '',
        offeringMerchantId: offering => offering.merchantId, offeringMeetsPrivacy: () => true,
        codingSessionRelayKey: session => session.relayKey, recentCodingSource: () => undefined,
        update() { updates.push(this.activeCodingSessionId); },
        platformService: { async getCatalogOffering(id) { calls.push(id); return row(id); } }
    });
    const session = { id: 'A', relayKey: 'managed:a', routeId: 'managed:fixed:fixed-a', modelId: 'vendor/model', keyPriceQuoteId: 'chosen-price', automaticRelaySource: 'user' };
    instance.activeCodingSession = () => session;
    return { instance, calls, updates, session };
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('cold restore and immediate send resolve exactly the saved offering without opening a picker', async () => {
    const { instance, calls, session } = fixture();
    instance.restoreCodingSourceSelection(session);
    await instance.waitForCatalogRoute('coding', session.routeId, 1000, session.relayKey);
    assert.deepEqual(calls, ['fixed-a']);
    assert.equal(instance.modelRoutes('coding')[0].id, session.routeId);
    assert.equal(instance.activeKeyPriceQuoteId, 'chosen-price');
    assert.equal(instance.automaticRelaySource, 'user');
    assert.equal(instance.permissionMode, 'workspace_write');
    assert.equal(instance.merchantPickerSnapshots.size, 0);
    assert.equal(instance.selectedMerchantCatalog, undefined);
    assert.equal(instance.platformCatalog.offerings.length, 0, 'single saved offering does not modify automatic selection');
});

test('A lookup and captured send survive switching to B without overwriting B source, quote or permission', async () => {
    const { instance, session, updates } = fixture(); const a = deferred(), b = deferred(), calls = [];
    instance.platformService.getCatalogOffering = id => { calls.push(id); return id === 'fixed-a' ? a.promise : b.promise; };
    instance.restoreCodingSourceSelection(session);
    const sendA = instance.waitForCatalogRoute('coding', session.routeId, 1000, session.relayKey);
    instance.activeCodingSessionId = 'B'; instance.permissionMode = 'read_only';
    instance.restoreCodingSourceSelection({ ...session, id: 'B', relayKey: 'managed:b', routeId: 'managed:fixed:fixed-b', keyPriceQuoteId: 'B-price', automaticRelaySource: 'off' });
    a.resolve(row()); await sendA;
    assert.equal(instance.routesForRelay('managed:a', 'coding')[0].id, session.routeId);
    assert.equal(instance.activeRelayKey, 'managed:b'); assert.equal(instance.activeModelRouteId, 'managed:fixed:fixed-b');
    assert.equal(instance.activeKeyPriceQuoteId, 'B-price'); assert.equal(instance.permissionMode, 'read_only'); assert.equal(instance.automaticRelaySource, 'off');
    assert.deepEqual(updates, []);
    b.resolve(row('fixed-b', 'b'));
    await instance.waitForCatalogRoute('coding', 'managed:fixed:fixed-b', 1000, 'managed:b');
    assert.equal(instance.modelRoutes('coding')[0].id, 'managed:fixed:fixed-b');
    assert.deepEqual(calls, ['fixed-a', 'fixed-b']);
});

for (const invalid of [undefined, row('other'), row('fixed-a', 'wrong'), { ...row(), status: 'inactive' }, { ...row(), available: false }]) {
    test(`missing/invalid saved route is not replaced: ${JSON.stringify(invalid)}`, async () => {
        const { instance, session } = fixture(); instance.platformService.getCatalogOffering = async () => invalid;
        instance.restoreCodingSourceSelection(session);
        await instance.waitForCatalogRoute('coding', session.routeId, 1000, session.relayKey);
        assert.deepEqual(instance.routesForRelay(session.relayKey, 'coding'), []);
        assert.equal(instance.activeModelRouteId, session.routeId);
    });
}

for (const change of ['account', 'linked', 'revision', 'removed', 'disposed']) {
    test(`in-flight result is rejected after ${change} changes`, async () => {
        const { instance } = fixture(), request = deferred();
        instance.platformService.getCatalogOffering = () => request.promise;
        const pending = instance.loadSavedFixedOffering('managed:a', 'managed:fixed:fixed-a');
        await Promise.resolve();
        if (change === 'account') instance.platformSession.user.id = 'other';
        if (change === 'linked') instance.platformSession.linked = false;
        if (change === 'revision') instance.catalogSnapshotRevision++;
        if (change === 'removed') instance.catalogRemovedMerchants.add('a');
        if (change === 'disposed') instance.isDisposed = true;
        request.resolve(row()); assert.equal(await pending, undefined); assert.equal(instance.savedFixedOfferings.size, 0);
    });
}

test('partial catalog can merge saved metadata but authoritative deletion removes it permanently', async () => {
    const { instance } = fixture();
    await instance.loadSavedFixedOffering('managed:a', 'managed:fixed:fixed-a');
    instance.merchantPickerSnapshots.set('a', { catalog: { merchantId: 'a', offerings: [row('other')], nextCursor: 'more' } });
    assert.deepEqual(instance.routesForRelay('managed:a', 'coding').map(route => route.id), ['managed:fixed:other', 'managed:fixed:fixed-a']);
    instance.merchantPickerSnapshots.set('a', { catalog: { merchantId: 'a', offerings: [row('other')] } });
    assert.deepEqual(instance.routesForRelay('managed:a', 'coding').map(route => route.id), ['managed:fixed:other']);
    instance.merchantPickerSnapshots.clear();
    assert.deepEqual(instance.routesForRelay('managed:a', 'coding'), [], 'eviction cannot resurrect the deleted cached route');
});

test('a complete snapshot received during a slow lookup wins, including removed and inactive offerings', async () => {
    for (const offerings of [[], [{ ...row(), status: 'inactive' }]]) {
        const { instance } = fixture(), request = deferred(); instance.platformService.getCatalogOffering = () => request.promise;
        const pending = instance.loadSavedFixedOffering('managed:a', 'managed:fixed:fixed-a');
        await Promise.resolve();
        instance.merchantPickerSnapshots.set('a', { catalog: { merchantId: 'a', offerings } });
        request.resolve(row()); await pending;
        assert.deepEqual(instance.routesForRelay('managed:a', 'coding'), []);
        assert.equal(instance.savedFixedOfferings.size, 0);
    }
});

test('send wait is bounded; timeout does not duplicate the still-pending lookup', async () => {
    const { instance, session } = fixture(), request = deferred(); let calls = 0;
    instance.platformService.getCatalogOffering = () => { calls++; return request.promise; };
    instance.restoreCodingSourceSelection(session);
    const start = Date.now();
    await instance.waitForCatalogRoute('coding', session.routeId, 20, session.relayKey);
    assert(Date.now() - start < 300);
    await instance.waitForCatalogRoute('coding', session.routeId, 20, session.relayKey);
    assert.equal(calls, 1);
    request.resolve(row()); await instance.loadSavedFixedOffering(session.relayKey, session.routeId);
});

test('global saved-route lookup shares the merchant restore request; automatic routes do not use it', async () => {
    const { instance, session, calls } = fixture(); instance.restoreCodingSourceSelection(session);
    await instance.savedRouteOffering();
    assert.deepEqual(calls, ['fixed-a']);
    await instance.waitForCatalogRoute('coding', 'managed:auto:model', 20, 'auto');
    assert.deepEqual(calls, ['fixed-a']);
});
