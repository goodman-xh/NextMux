import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const helperSource = readFileSync(new URL('../src/browser/nextmux-balance-notice-recovery.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(helperSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const helpers = {};
new Function('exports', compiled)(helpers);
const { shouldClearBalanceNotice } = helpers;
const wallet = patch => ({ currency: 'USD', availableMicros: 0, reservedMicros: 0, usageDebtMicros: 0, usageInFlightMicros: 0, updatedAt: 100, ...patch });
const input = patch => ({ insufficient: true, failedAt: 150, currency: 'USD', before: [wallet()], after: [wallet({ availableMicros: 1000, updatedAt: 200 })], ...patch });

test('fresh authoritative recovery clears an old depletion notice and leaves wallet values intact', () => {
    const value = input();
    const before = structuredClone(value);
    assert.equal(shouldClearBalanceNotice(value), true);
    assert.deepEqual(value, before);
    assert.equal(shouldClearBalanceNotice(input({ before: [wallet({ usageDebtMicros: 50 })] })), true);
});

test('zero funds, held funds alone, debt, in-flight use and a negative authoritative net never clear', () => {
    for (const patch of [
        { availableMicros: 0 }, { availableMicros: 0, reservedMicros: 5000 },
        { usageDebtMicros: 1 }, { usageInFlightMicros: 1 }, { netBalanceMicros: -1 }
    ]) assert.equal(shouldClearBalanceNotice(input({ after: [wallet({ availableMicros: 1000, updatedAt: 200, ...patch })] })), false);
});

test('stale or missing recovery fields, duplicate currencies and another currency fail closed', () => {
    for (const value of [
        input({ failedAt: undefined }), input({ currency: undefined }), input({ insufficient: false }),
        input({ after: [wallet({ availableMicros: 1000, updatedAt: 140 })] }),
        input({ after: [wallet({ availableMicros: 1000, updatedAt: 100 })] }),
        input({ after: [wallet({ availableMicros: 1000, updatedAt: 200, currency: 'EUR' })] }),
        input({ after: [wallet({ availableMicros: 1000, updatedAt: 200, usageDebtMicros: undefined })] }),
        input({ after: [wallet({ availableMicros: NaN, updatedAt: 200 })] }),
        input({ after: [wallet({ availableMicros: 1000, updatedAt: 200 }), wallet({ updatedAt: 200 })] })
    ]) assert.equal(shouldClearBalanceNotice(value), false);
});

test('already-positive legacy quote failures require their known admission amount', () => {
    const value = input({ before: [wallet({ availableMicros: 100 })] });
    assert.equal(shouldClearBalanceNotice(value), false);
    assert.equal(shouldClearBalanceNotice({ ...value, requiredMicros: 1001 }), false);
    assert.equal(shouldClearBalanceNotice({ ...value, requiredMicros: 1000 }), true);
    assert.equal(shouldClearBalanceNotice({ ...value, requiredMicros: NaN }), false);
});

const widgetSource = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('widget.tsx', widgetSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widgetClass = parsed.statements.find(node => ts.isClassDeclaration(node) && node.members.some(member => member.name?.getText(parsed) === 'loadAccountOverview'));
const method = widgetClass.members.find(member => member.name?.getText(parsed) === 'loadAccountOverview');
const classSource = ts.transpileModule(`class Subject { ${method.getText(parsed)} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const load = new Function('shouldClearBalanceNotice', 'isInsufficientBalanceFailure', 'walletNetBalanceMicros', 'walletBalanceText', 'desktopFailureMessage', `${classSource}; return Subject.prototype.loadAccountOverview;`)(
    shouldClearBalanceNotice, failure => failure?.code === 'wallet_balance_insufficient', w => w.availableMicros + w.reservedMicros - w.usageDebtMicros - w.usageInFlightMicros, () => '', () => 'error');
function subject(patch = {}) {
    const turn = { id: 'failed-turn', completedAt: 150, routeId: 'managed:fixed:model', failure: { code: 'wallet_balance_insufficient' } };
    let modelCalls = 0;
    return {
        platformSession: { linked: true, user: { id: 'customer' } }, accountOverviewRevision: 0,
        accountOverviewLoading: false, accountOverview: { wallets: [wallet()] }, balanceNoticeDismissedTurnId: '',
        platformService: { getAccountOverview: async () => ({ wallets: [wallet({ availableMicros: 1000, updatedAt: 200 })] }), runAgent: () => { modelCalls++; } },
        activeCodingSession: () => ({ turns: [turn] }), allModelRoutes: () => [{ id: turn.routeId, kind: 'managed_gateway', offering: { price: { currency: 'USD' } } }],
        update() {}, addNotification() {}, desktopLocale: 'en', turn, modelCalls: () => modelCalls, ...patch
    };
}

test('real account-refresh method clears active notice without rewriting failure or running a model', async () => {
    const value = subject(), historicalFailure = structuredClone(value.turn.failure);
    await load.call(value, true);
    assert.equal(value.balanceNoticeDismissedTurnId, 'failed-turn');
    assert.deepEqual(value.turn.failure, historicalFailure);
    assert.equal(value.modelCalls(), 0);
    assert.equal(value.platformSession.wallets[0].availableMicros, 1000);
});

test('real account-refresh method preserves manual dismiss and cannot clear an own API or unresolved debt', async () => {
    const value = subject({ balanceNoticeDismissedTurnId: 'manual-dismiss' });
    value.turn.routeId = 'official:own:glm'; value.allModelRoutes = () => [];
    await load.call(value, true);
    assert.equal(value.balanceNoticeDismissedTurnId, 'manual-dismiss');
    const debtor = subject();
    debtor.platformService.getAccountOverview = async () => ({ wallets: [wallet({ availableMicros: 1000, updatedAt: 200, usageDebtMicros: 1 })] });
    await load.call(debtor, true);
    assert.equal(debtor.balanceNoticeDismissedTurnId, '');
});

test('an account switch while the refresh waits discards the old balance recovery', async () => {
    let resolve;
    const value = subject();
    value.platformService.getAccountOverview = () => new Promise(done => { resolve = done; });
    const pending = load.call(value, true);
    value.platformSession = { linked: true, user: { id: 'another-customer' } };
    resolve({ wallets: [wallet({ availableMicros: 1000, updatedAt: 200 })] });
    await pending;
    assert.equal(value.balanceNoticeDismissedTurnId, '');
    assert.equal(value.accountOverview.wallets[0].availableMicros, 0);
});
