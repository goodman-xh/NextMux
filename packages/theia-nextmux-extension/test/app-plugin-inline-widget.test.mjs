import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = ts.createSourceFile('widget.tsx', readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const names = ['startAppPluginGoal', 'sendAppPluginGoal', 'rememberAppPluginRun', 'requestAppPluginStart', 'confirmAppPluginStart', 'saveInlineAppPluginModel', 'loadAppPlugins', 'startAppPluginClock'];
const methods = names.map(name => {
    const method = widget.members.find(node => node.name?.getText(source) === name);
    assert.ok(method, name);
    return method.getText(source);
});
const code = ts.transpile(`class Harness { ${methods.join('\n')} }`, { target: ts.ScriptTarget.ES2022 });
function fixture(bridge = {}) {
    const Harness = new Function('window', 'appPluginError', `${code}; return Harness;`)({ nextmuxDesktop: bridge, setInterval: () => 1, clearInterval() {} }, (_locale, key) => key);
    return Object.assign(new Harness(), {
        appPlugins: [{ id: 'plugin', summary: { maxRunMinutes: 60 }, model: { source: 'nextmux', model: 'jev' } }],
        appPluginRuns: new Map(), appPluginGoalRequests: new Map(), appPluginOverlays: new Set(), appPluginStartBusy: false, toDispose: [],
        update() {}, activeAppPluginRun() {}, async initComputerWindowView() {},
        async appPluginRunGate() { return {}; }, startAppPluginClock() {}, bindAppPluginEvents() {},
        platformService: { async appPluginModelChoices() { return { connections: [] }; } }
    });
}
const request = { pluginId: 'plugin', conversationId: 'owner', tabId: 'tab', pid: 12, windowId: 34, title: 'Notepad', byAi: false, goal: '  Check spelling  ' };

test('inline preset starts with its goal through the existing license and input start chain', async () => {
    const calls = [];
    const h = fixture({ startAppPlugin: async value => { calls.push(value); return { ok: true, runId: 'run' }; } });
    h.appPluginRunGate = async id => { calls.push(id); return { gate: 'license' }; };
    await h.startAppPluginGoal(request);
    assert.equal(calls[0], 'plugin');
    assert.equal(calls[1].goal, 'Check spelling');
    assert.equal(calls[1].tabId, 'tab');
    assert.equal(calls[1].gate, 'license');
    assert.equal(calls[1].maxMinutes, 30);
    assert.equal(calls[1].dryRun, false);
    assert.equal(h.appPluginStart, undefined);
    assert.equal(h.appPluginStartBusy, false);
});

test('preset on the current run sends a goal and never starts another plugin on the occupied tab', async () => {
    const calls = [];
    const h = fixture({ commandAppPlugin: async (...args) => { calls.push(args); return { ok: true }; } });
    const run = { runId: 'run', pluginId: 'plugin', goal: 'old' };
    h.appPluginRuns.set('run', run);
    h.activeAppPluginRun = () => run;
    await h.startAppPluginGoal(request);
    assert.deepEqual(calls, [['run', { goal: 'Check spelling' }]]);
    await h.startAppPluginGoal({ ...request, pluginId: 'other' });
    assert.equal(calls.length, 1);
    assert.equal(h.appPluginRuns.get('run').goal, 'Check spelling');
});

test('one-click start retains errors in the existing dialog and honors the license gate', async () => {
    let starts = 0;
    const h = fixture({ startAppPlugin: async () => { starts++; return { ok: true }; } });
    h.appPluginRunGate = async () => ({ error: 'license_missing', message: 'license required' });
    await h.startAppPluginGoal(request);
    assert.equal(starts, 0);
    assert.equal(h.appPluginStartError, 'license required');
    assert.equal(h.appPluginStart.goal, request.goal);
    h.appPluginRunGate = async () => { throw Error('offline'); };
    await h.startAppPluginGoal(request);
    assert.equal(h.appPluginStartError, 'plugin_invalid');
    assert.equal(h.appPluginStartBusy, false);
});

test('saved API connection is checked again before a preset can start', async () => {
    let starts = 0;
    const h = fixture({ startAppPlugin: async () => { starts++; return { ok: true }; } });
    h.appPlugins[0].model = { source: 'connection', connectionId: 'private', model: 'jev' };
    await h.startAppPluginGoal(request);
    assert.equal(starts, 0);
    assert.equal(h.appPluginStartError, 'decision_protocol_unsupported');
});

test('inline model changes save immediately and release busy state after failure', async () => {
    const h = fixture();
    const calls = [];
    h.configureAppPlugin = async (...args) => calls.push(args);
    const model = { source: 'local', endpoint: 'http://localhost:1234', model: 'jev', protocol: 'systemone' };
    await h.saveInlineAppPluginModel('plugin', model, null);
    assert.deepEqual(calls, [['plugin', { model, vision: null }]]);
    h.configureAppPlugin = async () => { throw Error('write failed'); };
    await h.saveInlineAppPluginModel('plugin', model, null);
    assert.equal(h.appPluginModelBusy, false);
    assert.equal(h.appPluginsError, 'model_invalid');
});

test('goal acknowledgement preserves newer run telemetry and a rejected command preserves the old goal', async () => {
    let finish;
    const h = fixture({ commandAppPlugin: () => new Promise(resolve => { finish = resolve; }) });
    h.appPluginRuns.set('run', { runId: 'run', goal: 'old', costUsd: 0 });
    const sending = h.sendAppPluginGoal('run', 'new');
    h.appPluginRuns.set('run', { runId: 'run', goal: 'old', costUsd: 2 });
    finish({ ok: true }); await sending;
    assert.equal(h.appPluginRuns.get('run').costUsd, 2);
    assert.equal(h.appPluginRuns.get('run').goal, 'new');
    const rejected = h.sendAppPluginGoal('run', 'rejected');
    finish({ ok: false, error: 'run_ended' }); await rejected;
    assert.equal(h.appPluginRuns.get('run').goal, 'new');
    assert.equal(h.appPluginsError, 'run_ended');
});

test('saving during an old list request waits for a fresh list instead of showing the old model', async () => {
    const requests = [];
    const h = fixture({ listAppPlugins: () => new Promise(resolve => requests.push(resolve)) });
    const initial = h.loadAppPlugins(true);
    const afterSave = h.loadAppPlugins(true);
    assert.equal(requests.length, 1);
    requests.shift()([{ id: 'plugin', model: 'old' }]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, 1);
    assert.notEqual(h.appPlugins[0].model, 'old');
    requests.shift()([{ id: 'plugin', model: 'new' }]);
    await Promise.all([initial, afterSave]);
    assert.equal(h.appPlugins[0].model, 'new');
    assert.equal(h.appPluginsLoading, false);
});

test('a run bar created without opening the hub loads model choices', () => {
    const h = fixture();
    delete h.startAppPluginClock;
    let reads = 0;
    h.loadAppPluginChoices = async () => { reads++; h.appPluginChoices = { relays: [], connections: [], local: [] }; };
    h.startAppPluginClock();
    h.startAppPluginClock();
    assert.equal(reads, 1);
    assert.equal(h.appPluginClock, 1);
});
