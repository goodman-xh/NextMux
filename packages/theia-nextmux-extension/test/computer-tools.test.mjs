import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const toolSource = new URL('../src/node/nextmux-computer-tools.ts', import.meta.url);
const toolModule = { exports: {} };
// The transpiled source is required as CommonJS from src/, where a sibling `../common/*.ts` import has no
// compiled file: resolve that one module from the compiled lib/ tree the package actually ships.
const sourceRequire = createRequire(toolSource);
const libRequire = createRequire(new URL('../lib/node/nextmux-computer-tools.js', import.meta.url));
const toolRequire = id => id === '../common/nextmux-computer-automation' ? libRequire(id) : sourceRequire(id);
new Function('require', 'module', 'exports', ts.transpile(readFileSync(toolSource, 'utf8'), {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true
}))(toolRequire, toolModule, toolModule.exports);
const { DesktopComputerTools, computerActionInputs, COMPUTER_USER_ESC_OBSERVATION, computerFailureMessage } = toolModule.exports;
const { computerActionFields } = require('../../../apps/desktop/computer-automation.cjs');
const { AgentToolRegistry } = require('@nextmux/agent-runtime');
const capability = { available: true, platform: 'darwin', delivery: 'background', version: '0.20.9' };
function fixture(t, override = capability) {
    const bridge = new DesktopComputerTools();
    bridge.setCapability(override);
    const registry = new AgentToolRegistry();
    bridge.register(registry, 'owner-a');
    t.after(() => bridge.dispose());
    const execute = (name = 'computer.list_apps', input = {}, signal, permission = 'full_access') => registry.execute(
        { id: `call-${Math.random()}`, name, arguments: input }, permission,
        { runId: 'host-run', workspaceRoot: '/fixture', signal });
    return { bridge, registry, execute };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('native host and advertised action fields stay aligned', () => {
    assert.deepEqual(computerActionInputs, computerActionFields);
});
test('missing runtime tools are absent but first-use permission tools can be offered', t => {
    for (const [reason, offered] of [['runtime_missing', false], ['unsupported_system', false], ['permission_required', true], ['worker_install_required', true]]) {
        const { registry } = fixture(t, { ...capability, available: false, reason });
        assert.equal(registry.descriptors('full_access').some(tool => tool.name === 'computer.list_apps'), offered);
    }
});
test('workspace and read-only permissions cannot dispatch native operations', async t => {
    const { bridge, registry, execute } = fixture(t);
    for (const permission of ['workspace_write', 'read_only']) {
        assert.equal(registry.descriptors(permission).some(tool => tool.name.startsWith('computer.')), false);
        assert.equal((await execute('computer.list_apps', {}, undefined, permission)).ok, false);
    }
    assert.deepEqual(bridge.requests(), []);
});
test('request ownership comes from host context and successful results settle exactly once', async t => {
    const { bridge, execute } = fixture(t);
    const running = execute(); await tick();
    const [request] = bridge.requests();
    assert.ok(request.id.startsWith('computer-'));
    assert.equal(request.conversationId, 'owner-a'); assert.equal(request.runId, 'host-run');
    assert.equal(request.action, 'listApps'); assert.ok(request.expiresAt > Date.now());
    assert.equal(bridge.resolve({ requestId: request.id, ok: true, output: { apps: [] } }), true);
    assert.equal(bridge.resolve({ requestId: request.id, ok: true }), false);
    assert.equal((await running).ok, true); assert.deepEqual(bridge.requests(), []);
});
test('untrusted ownership fields and missing snapshot are rejected before dispatch', async t => {
    const { bridge, execute } = fixture(t);
    assert.equal((await execute('computer.list_apps', { conversationId: 'other' })).ok, false);
    assert.equal((await execute('computer.click', { pid: 1, windowId: 2, x: 2, y: 3 })).ok, false);
    assert.deepEqual(bridge.requests(), []);
});

test('verification exposes and validates CUA predicates instead of passing arbitrary guesses to the driver', async t => {
    const { bridge, registry, execute } = fixture(t);
    const base = { pid: 1, windowId: 2, snapshotId: 'observed' };
    const descriptor = registry.descriptors('full_access').find(tool => tool.name === 'computer.verify_state');
    assert.match(descriptor.description, /status=satisfied with stable=true/);
    // The driver cannot prove an element absent (partial snapshots): the model is told what to check instead (audit APP-04).
    assert.match(descriptor.description, /use window\.exists:false on that window/);
    for (const expect of [
        [{ text: 'Save' }], [{}], [{ element: { selector: {} } }],
        [{ element: { selector: { label_contains: 'Save' }, exists: false } }],
        Array.from({ length: 9 }, () => ({ window: { exists: true } }))
    ]) {
        const result = await execute('computer.verify_state', { ...base, expect });
        assert.equal(result.ok, false);
        assert.equal(result.error.code, 'INVALID_COMPUTER_INPUT');
        assert.deepEqual(bridge.requests(), []);
    }
    for (const expect of [
        [{ window: { exists: true } }],
        [{ element: { selector: { label_contains: 'Save' }, exists: true } }],
        [{ element: { selector: { role: 'AXTextField', label_contains: 'QA input' }, value_equals: 'QA' } }]
    ]) {
        const running = execute('computer.verify_state', { ...base, expect }); await tick();
        const [request] = bridge.requests();
        assert.deepEqual(request.input.expect, expect);
        const output = { verification: { status: 'unknown', stable: false, predicates: [] } };
        bridge.resolve({ requestId: request.id, ok: true, output });
        const result = await running;
        assert.equal(result.ok, true); // The read ran; its predicate is still unknown.
        assert.deepEqual(result.output, output);
    }
});
test('cancelling one owner does not cancel another and late completion is discarded', async t => {
    const { bridge, registry, execute } = fixture(t);
    const secondRegistry = new AgentToolRegistry(); bridge.register(secondRegistry, 'owner-b');
    const controller = new AbortController();
    const first = execute('computer.list_apps', {}, controller.signal);
    const second = secondRegistry.execute({ id: 'b', name: 'computer.list_apps', arguments: {} }, 'full_access', { runId: 'run-b', workspaceRoot: '/fixture' });
    await tick(); const requests = bridge.requests(); assert.equal(requests.length, 2);
    controller.abort(); assert.equal((await first).ok, false);
    assert.equal(bridge.resolve({ requestId: requests[0].id, ok: true }), false);
    assert.equal(bridge.requests().length, 1);
    bridge.resolve({ requestId: requests[1].id, ok: true, output: 'b' }); assert.equal((await second).ok, true);
});
test('at most eight native requests can wait; disposing cancels them all', async t => {
    const { bridge, execute } = fixture(t);
    const pending = Array.from({ length: 8 }, () => execute()); await tick();
    assert.equal(bridge.requests().length, 8);
    assert.equal((await execute()).ok, false);
    bridge.dispose(); assert.ok((await Promise.all(pending)).every(result => !result.ok));
    assert.deepEqual(bridge.requests(), []); assert.equal((await execute()).ok, false);
});
test('failed effects return uncertainty instead of a fabricated success or replay', async t => {
    const { bridge, execute } = fixture(t);
    const running = execute('computer.click', { pid: 1, windowId: 2, snapshotId: 'observed', x: 2, y: 3 }); await tick();
    const [request] = bridge.requests();
    bridge.resolve({ requestId: request.id, ok: false, error: 'Action outcome uncertain; observe before retry' });
    const result = await running; assert.equal(result.ok, false);
    assert.match(result.error.message, /uncertain/); assert.deepEqual(bridge.requests(), []);
});

test('native diagnostics reach the model as bounded facts with observe-before-action guidance', async t => {
    const { bridge, execute } = fixture(t);
    for (const completion of ['not_started', 'completed', 'unknown']) {
        const running = execute('computer.click', { pid: 1, windowId: 2, snapshotId: 'observed', x: 2, y: 3 }); await tick();
        const [request] = bridge.requests();
        bridge.resolve({ requestId: request.id, ok: false, error: 'computer_action_interrupted', diagnostic: {
            source: 'driver', phase: 'native_call', driverTag: 'ActionInterrupted', completion,
            operation: { dispatched: true, committed: false, cancellationRequested: true, title: 'PRIVATE_WINDOW_TEXT' },
            reason: 'PRIVATE_WINDOW_TEXT', inner: { text: 'PRIVATE_WINDOW_TEXT' }, nextAction: 'observe_before_action'
        } });
        const result = await running;
        assert.equal(result.ok, false); assert.equal(result.error.code, 'COMPUTER_OPERATION_FAILED');
        assert.match(result.error.message, /computer_action_interrupted/);
        assert.match(result.error.message, /computer\.observe_window/); assert.match(result.error.message, /do not replay the action/);
        assert.match(result.error.message, /"dispatched":true/); assert.match(result.error.message, /"committed":false/);
        assert.ok(result.error.message.includes(`"completion":"${completion}"`));
        assert.doesNotMatch(JSON.stringify(result), /PRIVATE_WINDOW_TEXT/); assert.deepEqual(bridge.requests(), []);
    }
});

test('malformed diagnostic fields cannot promote raw host text into model output', async t => {
    const { bridge, execute } = fixture(t);
    const running = execute(); await tick(); const [request] = bridge.requests();
    bridge.resolve({ requestId: request.id, ok: false, error: 'PRIVATE_WINDOW_TEXT secret://window', diagnostic: {
        source: 'PRIVATE_WINDOW_TEXT', phase: 'PRIVATE_WINDOW_TEXT', driverTag: 'PRIVATE_WINDOW_TEXT', completion: 'PRIVATE_WINDOW_TEXT',
        nativeCode: 'PRIVATE_WINDOW_TEXT', nativeAction: 'PRIVATE_WINDOW_TEXT',
        operation: { dispatched: 'PRIVATE_WINDOW_TEXT', committed: { text: 'PRIVATE_WINDOW_TEXT' } }
    } });
    const result = await running;
    assert.equal(result.ok, false); assert.match(result.error.message, /computer_operation_failed/);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_WINDOW_TEXT|secret:/); assert.deepEqual(bridge.requests(), []);
});

test('AX unconfirmed actions retain their category while stale host snapshots explicitly remain undispatched', async t => {
    const { bridge, execute } = fixture(t);
    for (const [error, diagnostic, expected] of [
        ['computer_ax_action_unconfirmed', { phase: 'native_call', source: 'computer_use', nativeCode: -25204, nativeAction: 'AXPress',
            operation: { dispatched: true, committed: false, cancellationRequested: false } }, 'COMPUTER_AX_ACTION_UNCONFIRMED'],
        ['computer_snapshot_stale', { phase: 'host', source: 'host' }, 'COMPUTER_SNAPSHOT_STALE'],
        ['computer_element_stale', { phase: 'host', source: 'host' }, 'COMPUTER_ELEMENT_STALE'],
        ['computer_snapshot_stale', { phase: 'native_call', source: 'computer_use' }, 'COMPUTER_OPERATION_FAILED'],
    ]) {
        const running = execute('computer.click', { pid: 1, windowId: 2, snapshotId: 'observed', x: 2, y: 3 }); await tick();
        const [request] = bridge.requests(); bridge.resolve({ requestId: request.id, ok: false, error, diagnostic });
        const result = await running;
        assert.equal(result.ok, false); assert.equal(result.error.code, expected);
        assert.match(result.error.message, /computer\.observe_window/);
        if (diagnostic.phase === 'host') {
            assert.match(result.error.message, /The action was not sent/); assert.doesNotMatch(result.error.message, /The result is not verified/);
        } else {
            assert.match(result.error.message, /do not replay the action/); assert.doesNotMatch(result.error.message, /The action was not sent/);
        }
        if (expected === 'COMPUTER_AX_ACTION_UNCONFIRMED') {
            assert.match(result.error.message, /did not confirm whether the click happened/);
            assert.match(result.error.message, /"nativeCode":-25204/); assert.match(result.error.message, /"nativeAction":"AXPress"/);
        }
        assert.deepEqual(bridge.requests(), []);
    }
});
test('skill plugin tools: listing and status are read-only, starting waits for the user, and inputs are strict', async t => {
    const { bridge, registry, execute } = fixture(t);
    assert.deepEqual(registry.descriptors('full_access').map(tool => tool.name).filter(name => name.startsWith('plugins.')).sort(),
        ['plugins.command', 'plugins.list', 'plugins.start', 'plugins.status', 'plugins.stop']);
    assert.deepEqual(registry.descriptors('read_only').map(tool => tool.name).filter(name => name.startsWith('plugins.')).sort(), ['plugins.list', 'plugins.status']);
    assert.match(registry.descriptors('full_access').find(tool => tool.name === 'plugins.start').description, /user confirms in a dialog.*do not click or press keys in that tab yourself/s);
    assert.equal((await execute('plugins.start', { tabId: 't' })).ok, false, 'a plugin is required');
    assert.equal((await execute('plugins.status', { runId: 'r', waitMs: 120_000 })).ok, false, 'waits at most a minute');
    assert.equal((await execute('plugins.start', { tabId: 't', plugin: 'app.x.y', maxCostUsd: 1000 })).ok, false, 'spending is capped');
    assert.deepEqual(bridge.requests(), []);
    const starting = execute('plugins.start', { tabId: 'window:1:2', plugin: 'app.nextmux.example.coin-catcher', goal: 'catch 20 coins' }); await tick();
    const [request] = bridge.requests();
    assert.equal(request.action, 'pluginStart');
    assert.ok(request.expiresAt - Date.now() > 200_000, 'the user has minutes to answer the start dialog');
    bridge.resolve({ requestId: request.id, ok: false, error: 'The user did not start the plugin.' });
    const refused = await starting;
    assert.equal(refused.ok, false);
    assert.equal(refused.error.code, 'PLUGIN_OPERATION_FAILED');
});

test('tab tools open an app in its own tab and find, show or close tabs through the same host-owned channel', async t => {
    const { bridge, registry, execute } = fixture(t);
    const names = registry.descriptors('full_access').map(tool => tool.name).filter(name => name.startsWith('tabs.'));
    assert.deepEqual(names.sort(), ['tabs.click', 'tabs.close', 'tabs.drag', 'tabs.key', 'tabs.list', 'tabs.open_app', 'tabs.screenshot', 'tabs.scroll', 'tabs.set', 'tabs.show', 'tabs.type']);
    assert.match(registry.descriptors('full_access').find(tool => tool.name === 'tabs.open_app').description, /apart from their desktop.*never opens a tab/s);
    assert.deepEqual(registry.descriptors('read_only').map(tool => tool.name).filter(name => name.startsWith('tabs.')).sort(), ['tabs.list', 'tabs.screenshot'], 'only looking is read-only');
    assert.equal((await execute('tabs.key', { tabId: 't', key: 'w', modifiers: ['hyper'] })).ok, false, 'modifiers are a closed set');
    assert.equal((await execute('tabs.key', { tabId: 't', key: 'w', holdMs: 60_000 })).ok, false, 'a key is held for at most 3 s');
    assert.equal((await execute('tabs.open_app', {})).ok, false, 'an app is required');
    assert.equal((await execute('tabs.open_app', { app: 'WeChat', pid: 1 })).ok, false, 'no host-owned fields from the model');
    assert.deepEqual(bridge.requests(), []);
    const running = execute('tabs.open_app', { app: 'WeChat' }); await tick();
    const [request] = bridge.requests();
    assert.equal(request.action, 'tabOpenApp'); assert.equal(request.conversationId, 'owner-a'); assert.deepEqual(request.input, { app: 'WeChat' });
    bridge.resolve({ requestId: request.id, ok: true, output: { tabId: 'window:10:77', pid: 10, windowId: 77 } });
    const result = await running;
    assert.equal(result.ok, true);
    // A tab screenshot comes back to the model as an image.
    const shooting = execute('tabs.screenshot', { tabId: 'window:10:77' }); await tick();
    const shot = bridge.requests()[0];
    assert.equal(shot.action, 'tabScreenshot');
    bridge.resolve({ requestId: shot.id, ok: true, output: { tabId: 'window:10:77', width: 4, height: 3 }, images: [{ mimeType: 'image/jpeg', data: 'AAAA' }] });
    const pictured = await shooting;
    assert.equal(pictured.ok, true);
    assert.deepEqual(pictured.attachments?.map(item => [item.kind, item.mimeType, item.dataBase64]), [['image', 'image/jpeg', 'AAAA']]);
    const closing = execute('tabs.close', { tabId: 'window:10:77' }); await tick();
    bridge.resolve({ requestId: bridge.requests()[0].id, ok: false, error: '没有这个标签：window:10:77' });
    assert.equal((await closing).ok, false);
});

test('tab click, drag and held key inputs reach the host unchanged', async t => {
    const { bridge, execute } = fixture(t);
    for (const [name, action, input] of [
        ['tabs.click', 'tabClick', { tabId: 't', x: 0, y: 42, button: 'right', double: true }],
        ['tabs.drag', 'tabDrag', { tabId: 't', from: { x: 1, y: 2 }, to: { x: 399, y: 200 }, durationMs: 2000 }],
        ['tabs.drag', 'tabDrag', { tabId: 't', from: { x: 1, y: 2 }, to: { x: 1, y: 2 }, durationMs: 50 }],
        ...['ctrl', 'alt', 'shift', 'cmd'].map(key => ['tabs.key', 'tabKey', { tabId: 't', key, holdMs: 0 }]),
        ['tabs.key', 'tabKey', { tabId: 't', keys: ['left', 'alt', 'z', '1'], modifiers: ['shift'], holdMs: 3000 }],
        ['tabs.key', 'tabKey', { tabId: 't', key: 'left' }],
    ]) {
        const pending = execute(name, input); await tick();
        const request = bridge.requests()[0];
        assert.equal(request.action, action); assert.deepEqual(request.input, input);
        bridge.resolve({ requestId: request.id, ok: true, output: { sent: true } });
        const result = await pending; assert.equal(result.ok, true);
    }
    assert.deepEqual(bridge.requests(), []);
});

test('invalid button, drag bounds and mutually exclusive key payloads never dispatch', async t => {
    const { bridge, execute } = fixture(t);
    for (const input of [
        { tabId: 't' }, { tabId: 't', key: 'a', keys: ['b'] }, { tabId: 't', keys: [] },
        { tabId: 't', keys: ['a', 'a'] }, { tabId: 't', keys: ['a', 'b', 'c', 'd', 'e'] },
        { tabId: 't', keys: ['a', 1] }, { tabId: 't', keys: [''] },
        { tabId: 't', key: 'alt', holdMs: -1 }, { tabId: 't', key: 'alt', holdMs: 3001 },
        { tabId: 't', key: 'alt', holdMs: 1.5 }, { tabId: 't', key: 'alt', modifiers: ['alt', 'alt'] },
    ]) assert.equal((await execute('tabs.key', input)).ok, false, JSON.stringify(input));
    assert.equal((await execute('tabs.click', { tabId: 't', x: 1, y: 2, button: 'middle' })).ok, false);
    const drag = { tabId: 't', from: { x: 1, y: 2 }, to: { x: 3, y: 4 } };
    for (const invalid of [
        { durationMs: 49 }, { durationMs: 2001 }, { durationMs: 60.5 },
        { from: { x: -1, y: 2 } }, { to: { x: 1 } }, { to: { x: 1, y: 2, pressure: 1 } },
    ]) assert.equal((await execute('tabs.drag', { ...drag, ...invalid })).ok, false, JSON.stringify(invalid));
    assert.equal((await execute('tabs.drag', drag, undefined, 'read_only')).ok, false);
    assert.deepEqual(bridge.requests(), []);
});

test('every tab and plugin tool action is routed to the page, never to the computer-use host', async () => {
    const { DESKTOP_TAB_ACTIONS, DESKTOP_PLUGIN_ACTIONS } = await import('../lib/common/nextmux-computer-automation.js');
    const source = (await import('node:fs')).readFileSync(new URL('../src/node/nextmux-computer-tools.ts', import.meta.url), 'utf8');
    const declared = [...source.matchAll(/action: '((?:tab|plugin)[A-Za-z]+)'/g)].map(match => match[1]);
    assert.ok(declared.includes('tabSet'), 'tabs.set is declared');
    assert.deepEqual(declared.filter(action => ![...DESKTOP_TAB_ACTIONS, ...DESKTOP_PLUGIN_ACTIONS].includes(action)), []);
});

test('user Esc interruption, closed window, and unlocatable element observations are clear and non-retried', async t => {
    const { bridge, registry, execute } = fixture(t);
    assert.equal(
        computerFailureMessage({ requestId: 'r', ok: false, error: 'interrupted_by_user_esc' }),
        COMPUTER_USER_ESC_OBSERVATION
    );
    assert.equal(
        computerFailureMessage({ requestId: 'r', ok: false, error: 'interrupted_by_user_esc', diagnostic: { phase: 'host', source: 'host' } }),
        COMPUTER_USER_ESC_OBSERVATION
    );
    const closedMsg = computerFailureMessage({ requestId: 'r', ok: false, error: 'computer_window_closed', diagnostic: { phase: 'host', source: 'host' } });
    assert.match(closedMsg, /computer_window_closed: The target window or its app closed while the action ran\. Do not retry clicks on the closed window\. Check with computer\.list_windows \(or tabs\.list\)/);
    assert.doesNotMatch(closedMsg, /Call computer\.observe_window again/);

    const unlocatableMsg = computerFailureMessage({ requestId: 'r', ok: false, error: 'computer_element_unlocatable', diagnostic: { phase: 'host', source: 'host' } });
    assert.match(unlocatableMsg, /computer_element_unlocatable: The element token has no usable on-window bounds/);
    assert.match(unlocatableMsg, /Use x\/y from a fresh computer\.observe_window screenshot/);

    for (const [toolName, input] of [
        ['computer.click', { pid: 1, windowId: 2, snapshotId: 'snap', x: 10, y: 20 }],
        ['tabs.click', { tabId: 'window:1:2', x: 10, y: 20 }],
    ]) {
        const pending = execute(toolName, input); await tick();
        const [request] = bridge.requests();
        bridge.resolve({ requestId: request.id, ok: false, error: 'interrupted_by_user_esc', userInterrupted: true });
        const result = await pending;
        assert.equal(result.ok, false);
        assert.equal(result.error.message, COMPUTER_USER_ESC_OBSERVATION);
    }

    for (const toolName of ['computer.click', 'computer.double_click', 'computer.right_click', 'computer.scroll', 'computer.type_text', 'computer.press_key', 'computer.hotkey']) {
        const desc = registry.descriptors('full_access').find(tool => tool.name === toolName)?.description || '';
        assert.match(desc, /elementToken/i, `${toolName} documents elementToken resolution`);
    }
});

test('concurrent mutating tabs.* actions on the same tabId are serialized while different tabIds dispatch in parallel', async t => {
    const { bridge, execute } = fixture(t);
    const firstSameTab = execute('tabs.click', { tabId: 'window:1:2', x: 10, y: 20 });
    const secondSameTab = execute('tabs.type', { tabId: 'window:1:2', text: 'hello' });
    const otherTab = execute('tabs.click', { tabId: 'window:3:4', x: 5, y: 5 });
    await tick();
    const active = bridge.requests();
    assert.equal(active.length, 2, 'second action on window:1:2 waits behind the first while window:3:4 dispatches in parallel');
    assert.deepEqual(active.map(r => r.input.tabId).sort(), ['window:1:2', 'window:3:4']);
    const firstReq = active.find(r => r.input.tabId === 'window:1:2');
    const otherReq = active.find(r => r.input.tabId === 'window:3:4');
    bridge.resolve({ requestId: otherReq.id, ok: true, output: { ok: true } });
    assert.equal((await otherTab).ok, true);
    assert.equal(bridge.requests().length, 1);
    bridge.resolve({ requestId: firstReq.id, ok: true, output: { ok: true } });
    assert.equal((await firstSameTab).ok, true);
    await tick();
    const [secondReq] = bridge.requests();
    assert.equal(secondReq.action, 'tabType');
    assert.equal(secondReq.input.tabId, 'window:1:2');
    bridge.resolve({ requestId: secondReq.id, ok: true, output: { ok: true } });
    assert.equal((await secondSameTab).ok, true);
});
