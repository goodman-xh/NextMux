import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Execute the actual widget methods without importing Electron, DOM or services.
const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const method = name => {
    const start = source.search(new RegExp(`    protected (?:async )?${name}\\(`));
    assert.ok(start >= 0); const end = source.indexOf('\n    protected ', start + 20);
    return source.slice(start, end);
};
const compiled = ts.transpileModule(`class Fixture { ${method('applyPlatformSession')} ${method('loadAccountOverview')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const empty = () => ({ wallets: [], usage: [], movements: [], topups: [] });
const WidgetMethods = Function('EMPTY_ACCOUNT_OVERVIEW', 'ModelSwitchSettings', 'window', 'desktopFailureMessage', `${compiled};return Fixture;`)(empty(), class {}, { clearTimeout() {}, localStorage: { getItem: () => null } },
    (locale, error) => `localized:${locale}:${error?.code ?? 'unknown'}`);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const overview = owner => ({ wallets: [{ currency: 'USD', availableMicros: owner === 'A' ? 50000 : 90000 }], usage: [{ id: `${owner}-private-request`, recoveryState: 'available' }], topups: [], movements: [] });
function fixture() {
    const widget = new WidgetMethods(); const requests = []; const notifications = [];
    Object.assign(widget, { accountOverview: empty(), accountOverviewRevision: 0, accountOverviewLoading: false, accountOverviewError: '',
        desktopLocale: 'ar', platformSession: { linked: true, user: { id: 'A' }, wallets: [] }, merchantPickerSnapshots: new Map(), originalReceiptChecks: new Map(),
        merchantDiscoveredModels: new Map(), publicMerchantPageRequest: 0, merchantCatalogRequest: 0,
        catalogSnapshotRevision: 0, catalogSnapshotRefresh: { reset() {} }, pendingCatalogMerchants: new Set(), pendingComicDirectories: new Set(),
        catalogSourceRetries: new Map(), catalogRemovedMerchants: new Set(), checkModelCatalogVersion: async () => {},
        platformService: { getAccountOverview: () => { const pending = deferred(); requests.push(pending); return pending.promise; } },
        update() {}, syncModelRoute() {}, modelSwitchStorageKey: () => 'fixture', addNotification: (...args) => notifications.push(args)
    });
    return { widget, requests, notifications };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test('A response arriving after switch to B cannot populate B usage, wallets, error or loading state', async () => {
    const { widget, requests, notifications } = fixture();
    const first = widget.loadAccountOverview();
    widget.applyPlatformSession({ linked: true, user: { id: 'B' }, wallets: [] });
    assert.deepEqual(widget.accountOverview, empty()); assert.equal(requests.length, 2);
    requests[0].resolve(overview('A')); await first;
    assert.deepEqual(widget.accountOverview, empty()); assert.deepEqual(widget.platformSession.wallets, []);
    assert.equal(widget.accountOverviewLoading, true, 'old finally must not release B loading lock');
    await widget.loadAccountOverview(); assert.equal(requests.length, 2);
    requests[1].resolve(overview('B')); await flush();
    assert.equal(widget.accountOverview.usage[0].id, 'B-private-request'); assert.equal(widget.platformSession.wallets[0].availableMicros, 90000);
    assert.equal(widget.accountOverviewLoading, false); assert.deepEqual(notifications, []);
});

test('logout clears private records immediately and old error cannot reappear after login', async () => {
    const { widget, requests } = fixture(); widget.accountOverview = overview('A'); widget.accountOverviewError = 'old-account-error';
    const first = widget.loadAccountOverview(); widget.applyPlatformSession({ linked: false, wallets: [] });
    assert.deepEqual(widget.accountOverview, empty()); assert.equal(widget.accountOverviewError, ''); assert.equal(widget.accountOverviewLoading, false);
    widget.applyPlatformSession({ linked: true, user: { id: 'B' }, wallets: [] });
    requests[0].reject(new Error('A-private-server-error')); await first;
    assert.equal(widget.accountOverviewError, ''); assert.equal(widget.accountOverviewLoading, true);
    requests[1].resolve(overview('B')); await flush(); assert.equal(widget.accountOverview.usage[0].id, 'B-private-request');
});

test('A -> logout -> A uses a new revision, not only matching user ID', async () => {
    const { widget, requests } = fixture(); const first = widget.loadAccountOverview();
    widget.applyPlatformSession({ linked: false, wallets: [] }); widget.applyPlatformSession({ linked: true, user: { id: 'A' }, wallets: [] });
    requests[0].resolve(overview('A')); await first;
    assert.deepEqual(widget.accountOverview, empty()); assert.equal(widget.accountOverviewLoading, true);
    requests[1].resolve({ ...overview('A'), usage: [{ id: 'new-A-request' }] }); await flush(); assert.equal(widget.accountOverview.usage[0].id, 'new-A-request');
});

test('same-owner refresh does not reset its active request or allow duplicate loads', async () => {
    const { widget, requests } = fixture(); const first = widget.loadAccountOverview();
    widget.applyPlatformSession({ linked: true, user: { id: 'A' }, wallets: [] }); await widget.loadAccountOverview();
    assert.equal(requests.length, 1); requests[0].resolve(overview('A')); await first;
    assert.equal(widget.accountOverview.usage[0].id, 'A-private-request'); assert.equal(widget.accountOverviewLoading, false);
});

test('a current failure shows the localized service message, not the platform English text (B20-04)', async () => {
    const { widget, requests } = fixture(); const first = widget.loadAccountOverview();
    requests[0].reject(Object.assign(new Error('The platform is temporarily undergoing maintenance'), { code: 'platform_maintenance' })); await first;
    assert.equal(widget.accountOverviewError, 'localized:ar:platform_maintenance'); assert.equal(widget.accountOverviewLoading, false);
});
