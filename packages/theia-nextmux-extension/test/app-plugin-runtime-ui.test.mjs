import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const React = core('react');
const { renderToStaticMarkup } = core('react-dom/server');
const { AppPluginStartDialog, AppPluginModelDialog, AppPluginRunBar, AppPluginInstallDialog } = require('../lib/browser/nextmux-app-plugins-view.js');
const { appPluginError, appPluginReason, appPluginText } = require('../lib/browser/nextmux-app-plugins-locale.js');
const { APP_PLUGIN_RUNTIME_TEXT } = require('../lib/browser/nextmux-app-plugin-runtime-locale.js');
const { findConversationTabByTarget, tabWindows } = require('../lib/browser/nextmux-conversation-tabs.js');

const widgetSource = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const widgetAst = ts.createSourceFile('widget.tsx', widgetSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widgetClass = widgetAst.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const runtimeMethodNames = ['appPluginRunFor', 'activeAppPluginRun', 'requestAppPluginStart', 'startAppPluginGoal',
    'sendAppPluginGoal', 'rememberAppPluginRun', 'stopAppPluginRun', 'confirmAppPluginStart', 'forgetConversationWindows', 'handleTabControlRequest',
    'handleAppPluginMessage', 'handOffAppPluginEvent'];
const runtimeMethods = runtimeMethodNames.map(name => {
    const method = widgetClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(widgetAst) === name);
    assert.ok(method, `real widget method ${name}`);
    return method.getText(widgetAst);
}).join('\n');

function runtimeFixture(overrides = {}) {
    const calls = [];
    const bridge = {
        async startAppPlugin(request) {
            calls.push(['start', request.pluginId, request.goal]);
            const runId = `run-${calls.length}`;
            widget.appPluginRuns.set(runId, { ...request, runId, startedAt: Date.now(), ended: false, paused: false });
            return { ok: true, runId };
        },
        async stopAppPlugin(runId) {
            calls.push(['stop', runId]);
            return { ...widget.appPluginRuns.get(runId), ok: true, ended: true, reason: 'stopped' };
        },
        async commandAppPlugin(runId, command) { calls.push(['command', runId, command]); return { ok: true }; },
        async setComputerWindowUserInput(...input) { calls.push(['user-input', ...input]); return { ok: true }; },
        async computerWindowPointer(_conversationId, input) { calls.push(['pointer', input]); return { ok: true }; },
        async computerWindowKeys(_conversationId, input) { calls.push(['keys', input]); return { ok: true }; },
        async computerWindowSnapshot() { calls.push(['screenshot']); return { ok: true, data: 'AAAA', width: 800, height: 400 }; },
        ...overrides
    };
    const Widget = new Function('window', 'appPluginError', 'appPluginText', 'appPluginReason', 'findConversationTabByTarget', 'visualTabsFor', 'tabWindows',
        ts.transpileModule(`class Widget { ${runtimeMethods} }; return Widget;`, {
            compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
        }).outputText)({ nextmuxDesktop: bridge }, appPluginError, appPluginText, appPluginReason, findConversationTabByTarget, (state, id) => state[id] || [], tabWindows);
    const widget = new Widget();
    Object.assign(widget, {
        appPluginRuns: new Map(), appPluginGoalRequests: new Map(), appPluginOverlays: new Set(), appPluginStartBusy: false,
        detachedComputerTabs: new Set(), computerWindowControls: new Map(),
        appPlugins: ['plugin.a', 'plugin.b', 'plugin.c'].map(id => ({ id, summary: { maxRunMinutes: 30 } })),
        desktopLocale: 'en', update() {}, startAppPluginClock() {}, async initComputerWindowView() {},
        addNotification(...args) { calls.push(['notification', ...args]); }, scheduleAppPluginRender() { calls.push(['render']); },
        announceTab(...args) { calls.push(['tab-toast', ...args]); },
        codingSessions: [{ id: 'conversation' }], directFollowUpDrainTaskIds: new Map(),
        enqueueFollowUpTask(...args) { calls.push(['follow-up', ...args]); return true; },
        requestFollowUpQueueDrain(...args) { calls.push(['drain', ...args]); },
        async appPluginRunGate() { return {}; }, loadConversationTabs() {}, updateConversationVisualTab() {},
        conversationTabs: { conversation: [{ id: 'tab', windowRef: { pid: 11, windowId: 22 } }] },
        tabShotSizes: new Map([['conversation\ntab', { width: 800, height: 400 }]]), tabInteractedIds: new Set()
    });
    const request = (pluginId = 'plugin.b', goal = 'New goal') => ({ pluginId, goal, conversationId: 'conversation', tabId: 'tab', pid: 11, windowId: 22, title: 'App', byAi: false });
    const addRun = (patch = {}) => {
        const run = { ...request('plugin.a', 'Old goal'), runId: 'old-run', name: 'Plugin A', startedAt: 1, ended: false, paused: false, events: [], ...patch };
        widget.appPluginRuns.set(run.runId, run);
        return run;
    };
    const control = (action, input = {}) => widget.handleTabControlRequest({ conversationId: 'conversation', action, input }, 'tab',
        output => ({ ok: true, output }), error => ({ ok: false, error }));
    return { widget, bridge, calls, request, addRun, control };
}

test('switching a preset to another plugin stops the old run before starting the requested plugin', async () => {
    const { widget, calls, request, addRun } = runtimeFixture();
    addRun();
    await widget.startAppPluginGoal(request());
    assert.deepEqual(calls, [['stop', 'old-run'], ['start', 'plugin.b', 'New goal']]);
});

test('switching a preset retires a run in another tab that still targets the same physical window', async () => {
    const { widget, calls, request, addRun } = runtimeFixture();
    addRun({ conversationId: 'another-conversation', tabId: 'another-tab' });
    await widget.startAppPluginGoal(request());
    assert.deepEqual(calls, [['stop', 'old-run'], ['start', 'plugin.b', 'New goal']]);
    assert.equal(widget.appPluginRuns.get('old-run').ended, true);
    assert.equal(widget.activeAppPluginRun('conversation', 'tab').pluginId, 'plugin.b');
});

test('tab click, drag, scroll, key and type remain available while the plugin continues running', async () => {
    const { widget, calls, addRun, control } = runtimeFixture();
    const run = addRun();
    const inputs = [['tabClick', { x: 10, y: 20 }], ['tabDrag', { from: { x: 1, y: 2 }, to: { x: 3, y: 4 } }],
        ['tabScroll', { x: 10, y: 20 }], ['tabKey', { key: 'enter' }], ['tabType', { text: 'resolve blocker' }]];
    for (const [action, input] of inputs) assert.equal((await control(action, input)).ok, true, action);
    assert.equal(calls.filter(([kind]) => kind === 'pointer').length, 3);
    assert.equal(calls.filter(([kind]) => kind === 'keys').length, 2);
    assert.equal(widget.appPluginRuns.get(run.runId).paused, false);
    assert.equal(widget.appPluginRuns.get(run.runId).ended, false);
    assert.equal(calls.some(([kind]) => kind === 'command' || kind === 'stop'), false);
    assert.equal((await control('tabScreenshot')).ok, true);
    widget.appPluginRuns.set(run.runId, { ...run, paused: true });
    for (const [action, input] of inputs) assert.equal((await control(action, input)).ok, true, action);
    assert.equal(calls.filter(([kind]) => kind === 'pointer').length, 6);
    assert.equal(calls.filter(([kind]) => kind === 'keys').length, 4);
});

test('user-input tips notify and announce a tab toast without pausing, stopping or queuing a conversation follow-up even with handOff enabled', async () => {
    const { widget, calls, addRun } = runtimeFixture();
    const run = addRun();
    widget.desktopLocale = 'zh-CN';
    const tip = '键鼠已开启，你可随时介入操作，插件将继续运行';
    await widget.handleAppPluginMessage({ type: 'event', id: 'user_input', runId: run.runId,
        conversationId: run.conversationId, tabId: run.tabId, pluginId: run.pluginId, name: run.name,
        message: tip, handOff: true, pause: false, stop: false, at: 123 });
    const current = widget.appPluginRuns.get(run.runId);
    assert.equal(current.paused, false);
    assert.equal(current.ended, false);
    assert.equal(widget.activeAppPluginRun(run.conversationId, run.tabId), current);
    assert.deepEqual(current.events, [{ id: 'user_input', message: tip, modelMessage: undefined, pause: false, stop: false, at: 123 }]);
    const notification = calls.find(([kind]) => kind === 'notification');
    assert.ok(notification, 'the intervention tip is surfaced through the notification UI');
    assert.equal(notification[1], 'info');
    assert.ok(notification[2].includes(tip));
    assert.deepEqual(calls.find(([kind]) => kind === 'tab-toast'), ['tab-toast', run.conversationId, run.tabId, tip],
        'the exact intervention tip is forwarded to the addressed tab floating toast');
    assert.deepEqual(calls.map(([kind]) => kind), ['notification', 'tab-toast', 'render'],
        'no follow-up enqueue/drain, plugin command/stop, or user-input switch write');
});

test('plugin events without a target tab or message keep notifications without announcing a tab toast', async () => {
    for (const missing of ['conversationId', 'tabId', 'message']) {
        const { widget, calls, addRun } = runtimeFixture();
        const run = addRun();
        await widget.handleAppPluginMessage({ type: 'event', id: 'user_input', runId: run.runId,
            conversationId: run.conversationId, tabId: run.tabId, pluginId: run.pluginId, name: run.name,
            message: 'Plugin tip', handOff: false, pause: false, stop: false, at: 123, [missing]: '' });
        assert.deepEqual(calls.map(([kind]) => kind), ['notification', 'render'], missing);
    }
});

test('rapid preset switches retire an obsolete start before starting the latest plugin', async () => {
    const started = Promise.withResolvers(), finish = Promise.withResolvers();
    const { widget, bridge, calls, request, addRun } = runtimeFixture();
    addRun();
    const start = bridge.startAppPlugin;
    bridge.startAppPlugin = async request => {
        const result = await start(request);
        if (request.pluginId === 'plugin.b') { started.resolve(result.runId); await finish.promise; }
        return result;
    };
    const first = widget.startAppPluginGoal(request('plugin.b', 'Superseded'));
    const obsoleteRun = await started.promise;
    await widget.startAppPluginGoal(request('plugin.c', 'Latest'));
    finish.resolve();
    await first;
    assert.deepEqual(calls, [['stop', 'old-run'], ['start', 'plugin.b', 'Superseded'],
        ['stop', obsoleteRun], ['start', 'plugin.c', 'Latest']]);
    assert.equal(widget.activeAppPluginRun('conversation', 'tab').pluginId, 'plugin.c');
    assert.equal(widget.appPluginStartBusy, false);
});

test('late goal acknowledgements cannot replace the latest preset goal or its result', async () => {
    const responses = [];
    const { widget, request, addRun } = runtimeFixture({
        commandAppPlugin: async () => { const response = Promise.withResolvers(); responses.push(response); return response.promise; }
    });
    addRun();
    const first = widget.startAppPluginGoal(request('plugin.a', 'Superseded'));
    const second = widget.startAppPluginGoal(request('plugin.a', 'Latest'));
    responses[1].resolve({ ok: true });
    await second;
    responses[0].resolve({ ok: true });
    await first;
    assert.equal(widget.appPluginRuns.get('old-run').goal, 'Latest');
    const staleFailure = widget.sendAppPluginGoal('old-run', 'Stale failure');
    const newest = widget.sendAppPluginGoal('old-run', 'Newest');
    responses[3].resolve({ ok: true });
    await newest;
    responses[2].reject(new Error('obsolete failure'));
    await staleFailure;
    assert.equal(widget.appPluginRuns.get('old-run').goal, 'Newest');
    assert.equal(widget.appPluginsError, '');
    assert.equal(widget.appPluginGoalRequests.size, 0);
});

test('closing a tab cancels pending and queued starts and retires an already submitted start', async () => {
    const started = Promise.withResolvers(), finish = Promise.withResolvers();
    const { widget, bridge, calls, request } = runtimeFixture();
    const start = bridge.startAppPlugin;
    bridge.startAppPlugin = async request => {
        const result = await start(request);
        started.resolve(result.runId);
        await finish.promise;
        return result;
    };
    const starting = widget.startAppPluginGoal(request('plugin.b'));
    const obsoleteRun = await started.promise;
    await widget.startAppPluginGoal(request('plugin.c'));
    widget.forgetConversationWindows('conversation', widget.conversationTabs.conversation);
    finish.resolve();
    await starting;
    assert.deepEqual(calls, [['start', 'plugin.b', 'New goal'], ['stop', obsoleteRun]]);
    assert.equal(widget.appPluginStart, undefined);
    assert.equal(widget.appPluginQueuedGoal, undefined);
    assert.equal(widget.appPluginStartBusy, false);
    assert.equal(widget.activeAppPluginRun('conversation', 'tab'), undefined);
});

test('closing a tab during initialization prevents a later start without affecting other tabs', async () => {
    const initialized = Promise.withResolvers();
    const { widget, calls, request } = runtimeFixture();
    widget.initComputerWindowView = () => initialized.promise;
    const starting = widget.startAppPluginGoal(request());
    widget.forgetConversationWindows('other-conversation', [{ id: 'tab' }]);
    assert.ok(widget.appPluginStart);
    widget.forgetConversationWindows('conversation', [{ id: 'other-tab' }]);
    assert.ok(widget.appPluginStart);
    widget.forgetConversationWindows('conversation', [{ id: 'tab' }]);
    initialized.resolve();
    await starting;
    assert.deepEqual(calls, []);
    assert.equal(widget.appPluginStart, undefined);
});

const plugin = { id: 'example.plugin', ok: true, ready: true, enabled: true, budgetEnforceable: true, inputErrors: [],
    summary: { name: 'Example', goals: { default: 'Run', examples: [] }, maxRunMinutes: 60, modes: ['background'], risk: [] } };
const start = (patch = {}) => renderToStaticMarkup(React.createElement(AppPluginStartDialog, {
    locale: 'en', plugin: { ...plugin, ...patch }, tabTitle: 'Example app', byAi: false, initialGoal: '', busy: false, error: '', shortcut: 'Esc', onStart() {}, onCancel() {}
}));
const runbar = (patch = {}) => renderToStaticMarkup(React.createElement(AppPluginRunBar, {
    locale: 'en', now: 1000, run: { name: 'Example', elapsedMs: 1000, startedAt: 0, costUsd: 0, costStatus: 'known', ...patch },
    overlay: false, onStop() {}, onResume() {}, onToggleOverlay() {}
}));

test('Tev incompatibility is visible and blocks save/start without changing the plugin confidence requirement', () => {
    const model = 'togethercomputer/tev1-4b-experimental';
    const render = minConfidence => renderToStaticMarkup(React.createElement(AppPluginModelDialog, {
        locale: 'en', plugin: { ...plugin, model: { source: 'nextmux', model },
            summary: { ...plugin.summary, vision: 'none', decisions: [{ id: 'next', type: 'choice', optionCount: 2, minConfidence }] } },
        choices: { relays: [{ model, label: 'Tev1', routes: [{ offeringId: 'a', merchant: 'Seller', inputPricePerMillion: 0.042 }] }], connections: [], local: [] },
        loading: false, busy: false, error: '', onProbe() {}, onRescan() {}, onSave() {}, onCancel() {}
    }));
    const incompatible = render(0.3);
    assert.match(incompatible, /one Choice question with 2–24 options and no confidence score/);
    assert.match(incompatible, /class="is-primary" disabled=""[^>]*>Save/);
    assert.doesNotMatch(render(0), /class="is-primary" disabled=""/);
    const blockedStart = start({ ready: false, modelCompatibilityError: 'decision_choice_only' });
    assert.match(blockedStart, /no confidence score/);
    assert.match(blockedStart, /class="is-primary"[^>]*disabled=""/);
    const translations = new Set(['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'].map(locale => appPluginError(locale, 'decision_choice_only')));
    assert.equal(translations.size, 12);
});

test('unknown plugin costs disclose unenforceable dollar budgets in start dialog and run bar', () => {
    const startHtml = start({ budgetEnforceable: false });
    assert.match(startHtml, /dollar budget cannot be enforced/);
    assert.match(startHtml, /Time and request limits still apply/);
    assert.match(startHtml, /<input[^>]*min="0.01"[^>]*disabled=""/);
    assert.doesNotMatch(startHtml, /class="is-primary"[^>]*disabled/);
    assert.doesNotMatch(startHtml, /<input[^>]*min="1"[^>]*disabled/);
    const runHtml = runbar({ costStatus: 'unknown', budgetEnforceable: false });
    assert.match(runHtml, /Cost unknown · dollar budget not enforced/);
    assert.doesNotMatch(runHtml, /Spent \$0/);
    assert.match(runHtml, />Stop<\/button>/, 'unknown costs never hide the stop control');
});

test('known zero costs remain numeric and do not disable a configured budget', () => {
    assert.match(runbar(), /Spent \$0\.0000/);
    const html = start();
    assert.doesNotMatch(html, /dollar budget cannot be enforced/);
    assert.doesNotMatch(html, /<input[^>]*min="0.01"[^>]*disabled/);
});

test('unsupported holds block start with a localized action location and no model-selection detour', () => {
    const html = start({ ready: false, inputErrors: ['move[0]: computer_key_hold_unsupported'] });
    assert.match(html, /class="is-primary"[^>]*disabled=""/);
    assert.match(html, /move\[0\]: This computer cannot hold keys/);
    assert.doesNotMatch(html, /Choose a decision model|computer_key_hold_unsupported/);
    assert.match(appPluginError('zh-CN', 'jump[2]: computer_key_chord_unsupported'), /jump\[2\].*按键组合/);
    assert.match(appPluginError('en', 'computer_modifier_key_unsupported'), /modifier key on its own/);
    assert.match(appPluginError('zh-CN', 'skillshot[0]: computer_pointer_move_unsupported'), /skillshot\[0\].*鼠标指针.*先瞄准再按键/);
    assert.match(appPluginError('en', 'computer_pointer_move_unsupported'), /move the pointer without clicking/);
});

test('runtime notices cover all 12 locales and request limits have a localized stopping reason', () => {
    assert.equal(Object.keys(APP_PLUGIN_RUNTIME_TEXT).length, 12);
    const keys = Object.keys(APP_PLUGIN_RUNTIME_TEXT.en).sort();
    for (const [locale, values] of Object.entries(APP_PLUGIN_RUNTIME_TEXT)) {
        assert.deepEqual(Object.keys(values).sort(), keys, locale);
        assert.ok(Object.values(values).every(value => typeof value === 'string' && value.trim()), locale);
        assert.equal(appPluginReason(locale, 'request_limit'), values.requestLimit);
        assert.equal(appPluginError(locale, 'computer_pointer_move_unsupported'), values.pointerMoveUnsupported);
    }
});


test('plugin validation dialogs format structured diagnostics at the display edge in all twelve locales', () => {
    const rendered = new Set();
    for (const locale of Object.keys(APP_PLUGIN_RUNTIME_TEXT)) {
        const html = renderToStaticMarkup(React.createElement(AppPluginInstallDialog, {
            locale, inspection: { ok: false, errors: ['legacy English diagnostic must not appear'],
                diagnostics: [{ code: 'plugin.length', path: 'description', params: { min: 1, max: 400 } }] },
            busy: false, error: '', onCancel() {}, onInstall() {}
        }));
        assert.match(html, /description:/);
        assert.match(html, /400/);
        assert.doesNotMatch(html, /legacy English|plugin.length|\{min\}|\{max\}/);
        rendered.add(html);
    }
    assert.equal(rendered.size, 12);
});

test('purchase and marketplace codes read as localized reasons, never raw codes (B20-03)', () => {
    const codes = ['plugin_not_listed', 'plugin_not_found', 'plugin_free', 'plugin_purchase_idempotency_conflict', 'plugin_purchase_invalid',
        'request_invalid', 'market_network', 'market_http_503', 'market_http_404', 'market_failed',
        'param_path_invalid', 'param_file_empty', 'text_empty', 'some_future_code'];
    for (const locale of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
        for (const code of codes) {
            const text = appPluginError(locale, code);
            assert.ok(text && !text.includes(code) && !/[a-z]+_[a-z]+/.test(text), `${locale} ${code}: ${text}`);
        }
    }
    assert.equal(appPluginError('zh-CN', 'plugin_not_listed'), '这个插件已下架，暂时不能购买');
    assert.equal(appPluginError('zh-CN', 'market_http_502'), '插件市场暂时不可用，请稍后重试');
});
