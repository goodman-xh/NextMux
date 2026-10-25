import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConversationStore } from '../lib/node/nextmux-conversation-store.js';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const { automaticRelaySource, relaySourceSelected, sameModelRelayPolicy } = require('../lib/common/nextmux-relay-switch.js');
const { modelSwitchRouteKey } = require('../lib/common/nextmux-model-switch-policy.js');
const { ModelSwitchSettings } = require('../lib/browser/nextmux-model-switch-settings.js');
const { validateModelSwitchPolicy } = require('../lib/common/nextmux-model-switch-policy.js');
const { relaySwitchCopy, modelSwitchSaveError, modelSwitchSettingCopy } = require('../lib/browser/nextmux-relay-switch-control.js');

test('legacy per-session selection migrates conservatively; explicit off is not re-enabled by restore', () => {
    for (const key of ['', 'managed:vendor', 'official:own']) assert.equal(automaticRelaySource(undefined, key), 'off');
    for (const key of ['auto', 'managed:auto:model']) assert.equal(automaticRelaySource(undefined, key), 'auto_best');
    assert.equal(automaticRelaySource('off', 'auto'), 'off');
    assert.equal(automaticRelaySource('user', 'managed:vendor'), 'user');
    assert.equal(automaticRelaySource({ enabled: true }, 'managed:vendor'), 'off');
});

test('manual enable survives merchant changes; system auto enable alone is removed', () => {
    for (const key of ['auto', 'managed:a', 'managed:b', 'official:own']) assert.equal(relaySourceSelected('user', key), 'user');
    assert.equal(relaySourceSelected('off', 'auto'), 'auto_best');
    assert.equal(relaySourceSelected('auto_best', 'managed:a'), 'off');
    assert.equal(relaySourceSelected('off', 'managed:a'), 'off');
});
test('durable conversation, turn and queued-task intent survive restart independently', async t => {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-relay-intent-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const sessions = ['off', 'user', 'auto_best'].map((intent, index) => ({ id: `intent-${index}`, workspacePath: '/synthetic', title: intent,
        createdAt: 1, updatedAt: 2, automaticRelaySource: intent, relayKey: 'auto',
        turns: [{ id: `turn-${index}`, prompt: 'synthetic', response: '', stage: 'complete', createdAt: 1, automaticRelaySource: 'off' }],
        followUpQueue: [{ id: `queued-${index}`, automaticRelaySource: 'user', relayKey: 'managed:another' }] }));
    await new ConversationStore(root).save(sessions);
    assert.deepEqual((await new ConversationStore(root).load()).sessions, sessions);
});

test('new wire authorization never includes old cross-model allowlists and validates for fixed/automatic sources', () => {
    for (const route of [{ mode: 'fixed', offeringId: 'vendor-model' }, { mode: 'automatic', registryModelId: 'model' }]) {
        for (const source of ['off', 'user', 'auto_best']) {
            const value = sameModelRelayPolicy(route, source, { revision: 9, mode: 'allowlisted_models', fallbackRegistryModelIds: ['unapproved-model'], maxRequestChargeMicros: 123 });
            assert.equal(value.mode, source === 'off'
                ? route.mode === 'fixed' ? 'same_model' : 'single_route'
                : 'same_model_relays');
            assert.deepEqual(value.fallbackRegistryModelIds, []);
            assert.equal(value.maxRequestChargeMicros, 123);
            assert.deepEqual(validateModelSwitchPolicy(value, route), value);
        }
    }
});

test('damaged persisted revision or price cap cannot poison a fresh dispatch policy', () => {
    const fixed = { mode: 'fixed', offeringId: 'vendor-model' };
    for (const previous of [
        { revision: -1, maxRequestChargeMicros: -1 },
        { revision: '9', maxRequestChargeMicros: '123' },
        { revision: Number.MAX_SAFE_INTEGER + 1, maxRequestChargeMicros: Number.NaN }
    ]) {
        const value = sameModelRelayPolicy(fixed, 'off', previous);
        assert.deepEqual(value, {
            version: 1, revision: 0, mode: 'same_model',
            fallbackRegistryModelIds: [], merchantScope: 'selected_merchant'
        });
        assert.deepEqual(validateModelSwitchPolicy(value, fixed), value);
    }
});

test('legacy persisted policy modes are replaced by a current wire-compatible intent before dispatch', () => {
    const fixed = { mode: 'fixed', offeringId: 'vendor-model' };
    // `single_route` was introduced by a newer Worker and `allowlisted_models`
    // belonged to the earlier cross-model experiment. Neither stale mode may
    // leak back into a fixed desktop request after a rolling upgrade.
    for (const mode of ['same_model', 'single_route', 'allowlisted_models', 'same_model_relays']) {
        const value = sameModelRelayPolicy(fixed, 'off', {
            revision: 12,
            mode,
            fallbackRegistryModelIds: ['stale-model'],
            maxRequestChargeMicros: 456
        });
        assert.deepEqual(value, {
            version: 1,
            revision: 12,
            mode: 'same_model',
            fallbackRegistryModelIds: [],
            merchantScope: 'selected_merchant',
            maxRequestChargeMicros: 456
        });
        assert.doesNotThrow(() => validateModelSwitchPolicy(value, fixed));
    }
});

test('all 12 languages interpolate the complete actual model label without fallback text', () => {
    const texts = new Set();
    for (const locale of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
        const value = relaySwitchCopy(locale, 'Kimi K3 / 长名称 0.025');
        assert.equal(Object.values(modelSwitchSettingCopy(locale)).filter(Boolean).length, 4);
        assert.ok(value.label.includes('Kimi K3 / 长名称 0.025')); assert.ok(value.hint.includes('Kimi K3 / 长名称 0.025'));
        assert.ok(!value.label.includes('{model}')); texts.add(value.label);
        const unselected = relaySwitchCopy(locale, '');
        assert.ok(unselected.label.length > 3);
        assert.ok(unselected.hint.length > unselected.label.length, 'an unselected model still explains automatic routing');
        assert.ok(!unselected.hint.includes('{model}'));
        assert.ok(!/higher price|价格更高|高于当前价格|下一次对话|next conversation/i.test(value.hint));
    }
    assert.equal(texts.size, 12);
    assert.equal(relaySwitchCopy('zh-CN', 'Kimi K3').label, '允许自动切换 Kimi K3');
    assert.match(relaySwitchCopy('zh-CN', 'Kimi K3').hint, /本次对话/);
    assert.match(relaySwitchCopy('en', 'Kimi K3').hint, /this conversation/);
});

const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const klass = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
function harness(names, browserWindow = { localStorage: { setItem() {}, removeItem() {} } }) {
    const methods = ['relayOptionIsFull', ...names].map(name => klass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name).getText(file));
    return new Function('relayMerchantIsFull', 'requestAnimationFrame', 'relaySourceSelected', 'sameModelRelayPolicy', 'window', 'document', 'managedRelayKey', 'optionalKeyPriceQuoteId', 'automaticRelaySource', 'modelSwitchSaveError', 'normalizeContextWindowTokens', ts.transpile(`class Harness { ${methods.join('\n')} } return Harness;`, { target: ts.ScriptTarget.ES2022 }))(require('../lib/common/nextmux-relay-capacity.js').relayMerchantIsFull, () => {}, relaySourceSelected, sameModelRelayPolicy, browserWindow, { activeElement: null }, id => `managed:${id}`, value => value, automaticRelaySource, modelSwitchSaveError,
        require('../lib/common/nextmux-context-budget.js').normalizeContextWindowTokens);
}

/** Extract only the policy-update methods for a deterministic browser-less
 * regression harness.  The real widget gets these dependencies from its
 * constructor; keeping them explicit here makes the rollback contract test
 * independent of Theia/React bootstrapping. */
function policyHarness(browserWindow) {
    const names = ['changeModelSwitchPolicy', 'modelSwitchStorageKey', 'persistActiveRouteSelection'];
    const methods = names.map(name => klass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name).getText(file));
    return new Function('window', 'modelSwitchRouteKey', 'ModelSwitchSettings', 'modelSwitchSaveError', 'MODEL_SWITCH_DEFAULT_STORAGE_KEY', ts.transpile(`class Harness { conversationAgentRun() { return this; } ${methods.join('\n')} } return Harness;`, { target: ts.ScriptTarget.ES2022 }))(
        browserWindow, modelSwitchRouteKey, ModelSwitchSettings, modelSwitchSaveError, 'nextmux.desktop.modelSwitchDefault.v1'
    );
}
test('actual widget selection and manual toggles persist system/user intent without choosing a model', () => {
    const Widget = harness(['selectRelay', 'applyRelaySelection', 'setAutomaticRouting', 'setModelSwitchDefault']);
    const widget = new Widget(), merchant = { key: 'managed:a', merchantId: 'a', label: 'A', kind: 'managed' }, auto = { key: 'auto', kind: 'automatic', label: 'Auto' };
    const persisted = [], policies = [], prefetched = [];
    Object.assign(widget, { activeRelayKey: '', activeSection: 'coding', automaticRelaySource: 'off', codingSessions: [], merchantPickerSnapshots: new Map(),
        selectedModelIds: { coding: '' }, modelSwitchSettings: { get: () => ({ revision: 0 }) },
        relayOption() { return undefined; }, relayOptions: () => [merchant, auto], activeModelRoute: () => undefined, routesForRelay: () => [],
        persistActiveRouteSelection() { persisted.push(this.automaticRelaySource); }, addNotification() {}, loadSelectedMerchantCatalog(id) { prefetched.push(id); }, update() {} });
    assert.equal(widget.selectRelay('auto'), true); assert.equal(widget.automaticRelaySource, 'auto_best');
    assert.equal(widget.selectRelay('managed:a'), true); assert.equal(widget.automaticRelaySource, 'off');
    widget.activeModelRoute = () => ({ id: 'same-model', kind: 'managed_gateway' });
    widget.managedModelRoute = () => ({ mode: 'fixed', offeringId: 'a-model' });
    widget.changeModelSwitchPolicy = (_route, policy) => policies.push(policy);
    widget.setAutomaticRouting(true); assert.equal(widget.automaticRelaySource, 'user');
    widget.activeModelRoute = () => undefined;
    assert.equal(widget.selectRelay('auto'), true); assert.equal(widget.automaticRelaySource, 'user');
    assert.equal(widget.selectRelay('managed:a'), true); assert.equal(widget.automaticRelaySource, 'user');
    assert.equal(widget.selectRelay('managed:a'), true); assert.equal(widget.automaticRelaySource, 'user');
    assert.deepEqual(widget.selectedModelIds, { coding: '' });
    assert.deepEqual(prefetched, ['a', 'a', 'a']);
    assert.deepEqual(persisted, ['auto_best', 'off', 'user', 'user', 'user', 'user']);
    assert.equal(policies[0].mode, 'same_model_relays');
    assert.deepEqual(widget.selectedPublicMerchant, { id: 'a', name: 'A' });
});

test('settings default synchronizes the active managed conversation while preserving explicit policy provenance', () => {
    const Widget = harness(['setModelSwitchDefault']);
    const widget = new Widget();
    const persisted = [], policies = [];
    Object.assign(widget, {
        modelSwitchDefaultEnabled: false,
        codingSessions: [],
        automaticRelaySource: 'off',
        activeModelRoute: () => ({ kind: 'managed_gateway', offering: { id: 'offering-a' } }),
        managedModelRoute: () => ({ mode: 'fixed', offeringId: 'offering-a' }),
        modelSwitchSettings: { get: () => ({ revision: 2 }) },
        persistActiveRouteSelection() { persisted.push(this.automaticRelaySource); },
        changeModelSwitchPolicy(_route, policy) { policies.push(policy); },
        update() {},
    });
    widget.setModelSwitchDefault(true);
    assert.equal(widget.modelSwitchDefaultEnabled, true);
    assert.equal(widget.automaticRelaySource, 'user');
    assert.deepEqual(persisted, ['user']);
    assert.equal(policies[0].mode, 'same_model_relays');
    widget.setModelSwitchDefault(false);
    assert.equal(widget.automaticRelaySource, 'off');
    assert.equal(policies[1].mode, 'same_model');
    assert.equal(policies[1].merchantScope, 'selected_merchant');
});

test('new-session default is persisted separately from per-conversation source', () => {
    assert.match(source, /modelSwitchDefaultEnabled = false/);
    assert.match(source, /modelSwitchDefaultEnabled = window\.localStorage\.getItem\(MODEL_SWITCH_DEFAULT_STORAGE_KEY\) === '1'/);
    assert.match(source, /automaticRelaySource: this\.modelSwitchDefaultEnabled \? 'user' : 'off'/);
    assert.match(source, /setModelSwitchDefault\(enabled: boolean\)/);
});

test('explicit toggle reaches same-route live/checkpoint continuation without rewriting completed turns or queued tasks', () => {
    const Widget = harness(['setModelSwitchDefault']);
    for (const stage of ['running', 'paused', 'error', 'complete']) {
        const turn = { id: 'turn', routeId: 'route', stage, resumeCheckpointId: 'checkpoint', automaticRelaySource: 'user' };
        const queue = [{ automaticRelaySource: 'user' }];
        const widget = new Widget(), updates = [];
        Object.assign(widget, { activeCodingSessionId: 'owner', codingSessions: [{ id: 'owner', turns: [turn], followUpQueue: queue }],
            activeModelRoute: () => ({ id: 'route', kind: 'managed_gateway' }), managedModelRoute: () => ({ mode: 'fixed', offeringId: 'a' }),
            modelSwitchSettings: { get: () => ({ revision: 0 }) }, persistActiveRouteSelection() {}, changeModelSwitchPolicy() {}, update() {},
            updateCodingTurn(owner, id, patch) { updates.push({ owner, id, patch }); } });
        widget.setModelSwitchDefault(false);
        assert.equal(updates.length, stage === 'complete' ? 0 : 1);
        if (updates.length) assert.deepEqual(updates[0], { owner: 'owner', id: 'turn', patch: { automaticRelaySource: 'off' } });
        assert.deepEqual(queue, [{ automaticRelaySource: 'user' }]);
    }
});

test('new empty draft adopts the explicit default but restored conversations never inherit it retroactively', () => {
    const Widget = harness(['restoreCodingSourceSelection', 'recentCodingSource']);
    const widget = new Widget();
    Object.assign(widget, { modelSwitchDefaultEnabled: true, selectedModelIds: {}, codingSessionRelayKey: session => session.relayKey });
    widget.restoreCodingSourceSelection();
    assert.equal(widget.automaticRelaySource, 'user');
    widget.restoreCodingSourceSelection({ relayKey: 'managed:a', automaticRelaySource: 'off', turns: [] });
    assert.equal(widget.automaticRelaySource, 'off');
    widget.restoreCodingSourceSelection({ relayKey: 'auto', automaticRelaySource: 'auto_best', turns: [] });
    assert.equal(widget.automaticRelaySource, 'auto_best');
});

test('an individually enabled conversation survives restart after the global switch is off', () => {
    const Widget = harness(['restoreCodingSourceSelection', 'recentCodingSource']);
    const widget = new Widget();
    Object.assign(widget, {
        // Global off means existing conversations were cleared at the time the
        // user switched it off. It must not act as a permanent runtime gate.
        modelSwitchDefaultEnabled: false,
        selectedModelIds: {},
        codingSessionRelayKey: session => session.relayKey
    });
    widget.restoreCodingSourceSelection({ relayKey: 'managed:a', automaticRelaySource: 'user', turns: [] });
    assert.equal(widget.automaticRelaySource, 'user');
    widget.restoreCodingSourceSelection({ relayKey: 'managed:a', automaticRelaySource: 'off', turns: [] });
    assert.equal(widget.automaticRelaySource, 'off');
});

test('failed default persistence cannot silently change consent and is visible to the user', () => {
    const Widget = harness(['setModelSwitchDefault'], { localStorage: { setItem() { throw new Error('quota'); } } });
    const widget = new Widget();
    Object.assign(widget, { desktopLocale: 'en', modelSwitchDefaultEnabled: false, automaticRelaySource: 'off', update() {},
        persistActiveRouteSelection() { assert.fail('must not change consent'); } });
    widget.setModelSwitchDefault(true);
    assert.equal(widget.modelSwitchDefaultEnabled, false);
    assert.equal(widget.automaticRelaySource, 'off');
    assert.equal(widget.modelSwitchError, modelSwitchSaveError('en'));
    assert.match(source, /role='status'>\{this\.modelSwitchError\}/);
});

test('active-run policy rejection rolls back the optimistic route and consent', async () => {
    const values = new Map([['nextmux.desktop.modelSwitchDefault.v1', '1']]);
    const browserWindow = { localStorage: {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); },
        removeItem(key) { values.delete(key); }
    } };
    const Widget = policyHarness(browserWindow);
    const widget = new Widget();
    const route = { mode: 'fixed', offeringId: 'offering-a' };
    const baseline = { version: 1, revision: 0, mode: 'same_model', fallbackRegistryModelIds: [], merchantScope: 'selected_merchant' };
    const routeStorageKey = 'nextmux.desktop.modelSwitch.v1:unlinked';
    const baselineStorage = JSON.stringify({ [modelSwitchRouteKey(route)]: baseline });
    values.set(routeStorageKey, baselineStorage);
    Object.assign(widget, {
        modelSwitchSettings: new ModelSwitchSettings(baselineStorage),
        modelSwitchError: '',
        platformSession: { user: undefined },
        activeAgentRunId: 'run-a', activeAgentSessionId: 'session-a', activeCodingSessionId: 'session-a',
        activeAgentManagedRoute: route, automaticRelaySource: 'user', modelSwitchDefaultEnabled: true,
        platformService: { updateAgentRunSwitchPolicy: async () => { throw Object.assign(new Error('old Worker'), { code: 'MODEL_SWITCH_POLICY_INVALID' }); } },
        desktopLocale: 'en', update() {}, persistActiveRouteSelection() {}
    });
    await widget.changeModelSwitchPolicy(route, { mode: 'same_model_relays', merchantScope: 'eligible_marketplace', fallbackRegistryModelIds: [] }, {
        previousAutomaticRelaySource: 'off', attemptedAutomaticRelaySource: 'user',
        previousDefaultEnabled: false, attemptedDefaultEnabled: true,
        previousDefaultStorageValue: null, attemptedDefaultStorageValue: '1'
    });
    assert.deepEqual(widget.modelSwitchSettings.get(route), baseline);
    assert.equal(values.get(routeStorageKey), baselineStorage);
    assert.equal(widget.automaticRelaySource, 'off');
    assert.equal(widget.modelSwitchDefaultEnabled, false);
    assert.equal(values.has('nextmux.desktop.modelSwitchDefault.v1'), false);
    assert.equal(widget.modelSwitchError, modelSwitchSaveError('en'));
});

test('a failed older update cannot clobber a newer queued policy', async () => {
    const values = new Map();
    const browserWindow = { localStorage: {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); },
        removeItem(key) { values.delete(key); }
    } };
    const Widget = policyHarness(browserWindow);
    const widget = new Widget();
    const route = { mode: 'fixed', offeringId: 'offering-a' };
    const baseline = { version: 1, revision: 0, mode: 'same_model', fallbackRegistryModelIds: [], merchantScope: 'selected_merchant' };
    const routeStorageKey = 'nextmux.desktop.modelSwitch.v1:unlinked';
    const baselineStorage = JSON.stringify({ [modelSwitchRouteKey(route)]: baseline });
    values.set(routeStorageKey, baselineStorage);
    let calls = 0;
    let releaseFirst;
    const firstGate = new Promise(resolve => { releaseFirst = resolve; });
    Object.assign(widget, {
        modelSwitchSettings: new ModelSwitchSettings(baselineStorage),
        modelSwitchError: '',
        platformSession: { user: undefined },
        activeAgentRunId: 'run-a', activeAgentSessionId: 'session-a', activeCodingSessionId: 'session-a',
        activeAgentManagedRoute: route, automaticRelaySource: 'user',
        platformService: { updateAgentRunSwitchPolicy: async (_run, _task, _route, policy) => {
            calls++;
            if (calls === 1) { await firstGate; throw Object.assign(new Error('old Worker'), { code: 'MODEL_SWITCH_POLICY_INVALID' }); }
            return { revision: policy.revision, applies: 'next_model_turn' };
        } },
        desktopLocale: 'en', update() {}, persistActiveRouteSelection() {}
    });
    const first = widget.changeModelSwitchPolicy(route, { mode: 'same_model_relays', merchantScope: 'eligible_marketplace', fallbackRegistryModelIds: [] });
    await new Promise(resolve => setTimeout(resolve, 0));
    // Simulate a newer user choice while the first request is still pending.
    widget.automaticRelaySource = 'off';
    const second = widget.changeModelSwitchPolicy(route, { mode: 'same_model', merchantScope: 'selected_merchant', fallbackRegistryModelIds: [] });
    releaseFirst();
    await Promise.all([first, second]);
    assert.equal(calls, 2);
    const finalPolicy = widget.modelSwitchSettings.get(route);
    assert.equal(finalPolicy.mode, 'same_model');
    assert.equal(finalPolicy.revision, 1);
    assert.deepEqual(JSON.parse(values.get(routeStorageKey)), { [modelSwitchRouteKey(route)]: finalPolicy });
});

test('actual composer close/complete never consumes the page back stack', () => {
    const Widget = harness(['dismissComposerPicker', 'closeNavigationSurface', 'completeNavigationSurface']);
    for (const close of ['closeNavigationSurface', 'completeNavigationSurface']) {
        const widget = new Widget(); const back = [{ section: 'models' }], forward = [{ section: 'settings' }];
        Object.assign(widget, { codingPopover: 'routes', modelPickerRelayOpen: true, navigationBackStack: back, navigationForwardStack: forward,
            node: { querySelector: () => null },
            update() {}, closeModelEffortPickerImmediately() {}, navigateBack() { assert.fail('must not navigate'); } });
        widget[close]();
        assert.equal(widget.codingPopover, ''); assert.equal(widget.modelPickerRelayOpen, false);
        assert.equal(widget.navigationBackStack, back); assert.equal(widget.navigationForwardStack, forward);
    }
});

test('dispatch snapshots routing intent before its first await, including queued and resumed ownership', () => {
    const method = klass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === 'executePromptSubmission').getText(file);
    assert.ok(method.indexOf('const submittedRelaySource') < method.indexOf('await '));
    assert.match(method, /queuedExecution\.task\.automaticRelaySource/);
    assert.match(method, /resumedExecution\.turn\.automaticRelaySource/);
    assert.match(method, /const requestedSwitchPolicy = requestedManagedRoute\s*\? sameModelRelayPolicy/);
    assert.match(method, /\.\.\.\(requestedSwitchPolicy \? \{ switchPolicy: requestedSwitchPolicy \} : \{\}\)/);
    assert.match(method, /sameModelRelayPolicy\(requestedManagedRoute, submittedRelaySource/);
});
test('all new scheduled and child dispatches sanitize historical allowlists with their own owner snapshot', () => {
    for (const [name, owner] of [['executeScheduledTask', 'task.automaticRelaySource'], ['executeAgentChildContinuation', 'turn.automaticRelaySource']]) {
        const method = klass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name).getText(file);
        assert.match(method, /switchPolicy: sameModelRelayPolicy/); assert.ok(method.includes(owner));
        assert.doesNotMatch(method, /switchPolicy: this\.modelSwitchSettings\.get|this\.automaticRelaySource/);
    }
    const media = klass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === 'mediaCompatibleConnections').getText(file);
    assert.doesNotMatch(media, /this\.automaticRouting|this\.automaticRelaySource/);
    assert.match(media, /automaticMediaSource = this\.activeRelayKey === 'auto'/);
});
test('choosing a different model cannot re-enable a manually disabled automatic source', () => {
    const Widget = harness(['activateAutomaticModel', 'activateOffering']);
    for (const method of ['activateAutomaticModel', 'activateOffering']) {
        const widget = new Widget();
        Object.assign(widget, { automaticRelaySource: 'off', selectedModelIds: { coding: '' }, offeringMerchantId: row => row.merchantId,
            modelKeyForOffering: () => 'model', persistActiveRouteSelection() {}, syncReasoningEffort() {}, activeModelRoute() {}, addNotification() {}, closeOffering() {}, update() {} });
        // Model-only methods must not contain a provenance transition, even if
        // legacy entry points also set their source key as a compatibility aid.
        const body = klass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === method).getText(file);
        assert.doesNotMatch(body, /automaticRelaySource\s*=|relaySourceSelected/);
        widget[method]({ id: 'offering', registryModelId: 'model', merchantId: 'a' });
        assert.equal(widget.automaticRelaySource, 'off');
        assert.equal(widget.selectedModelIds.coding, 'model');
    }
});


test('queued policy update keeps its clicked run owner when another conversation becomes visible', async () => {
    const values = new Map(), browserWindow = { localStorage: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) } };
    const Widget = policyHarness(browserWindow), widget = new Widget(), route = { mode: 'fixed', offeringId: 'owned-a' };
    const a = { activeAgentRunId: 'run-a', activeAgentSessionId: 'a', activeAgentManagedRoute: route };
    const b = { activeAgentRunId: 'run-b', activeAgentSessionId: 'b', activeAgentManagedRoute: route };
    let unblock; const gate = new Promise(resolve => { unblock = resolve; }), calls = [];
    Object.assign(widget, { activeCodingSessionId: 'a', conversationAgentRun: () => widget.activeCodingSessionId === 'a' ? a : b,
        modelSwitchSettings: new ModelSwitchSettings(null), modelSwitchPolicyUpdateQueues: new Map([[modelSwitchRouteKey(route), gate]]),
        platformSession: {}, automaticRelaySource: 'off', update() {}, platformService: { updateAgentRunSwitchPolicy: async (...args) => calls.push(args) } });
    const pending = widget.changeModelSwitchPolicy(route, { mode: 'same_model_relays', merchantScope: 'eligible_marketplace', fallbackRegistryModelIds: [] });
    widget.activeCodingSessionId = 'b'; unblock(); await pending;
    assert.equal(calls.length, 1); assert.deepEqual(calls[0].slice(0, 2), ['run-a', 'a']);
});
