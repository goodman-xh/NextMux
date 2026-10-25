import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

// Idle CPU (REQUIREMENTS §12-1): once a conversation stops using computer or
// browser control, the native driver / CDP attachment must be released without
// relying on the renderer's run-completion release.
const require = createRequire(import.meta.url);
const { ComputerAutomation, registerComputerAutomation } = require('../computer-automation.cjs');
const { GuestAutomation, registerBrowserAutomation } = require('../browser-automation.cjs');

const request = (action, conversationId = 'conversation-a') => ({ id: `${action}-${crypto.randomUUID()}`, conversationId, expiresAt: Date.now() + 10_000, action, input: {} });

function computerFixture(idleReleaseMs) {
    const lifecycle = [];
    let release;
    const engine = new ComputerAutomation({ platform: 'darwin', idleReleaseMs, sdkLoader: async () => ({ create: async id => ({
        listApps: async () => { if (release) await release; return [{ id }]; },
        close: async () => { lifecycle.push(['close', id]); }
    }) }) });
    // The container is Linux; capability gating is covered by computer-automation.test.mjs.
    engine.capability = () => ({ available: true });
    const hold = () => { let open; release = new Promise(resolve => { open = resolve; }); return () => { release = undefined; open(); }; };
    return { engine, lifecycle, hold };
}

test('computer session idle lease closes the client and stops the native host when the conversation goes quiet', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { engine, lifecycle } = computerFixture(60_000);
    assert.equal((await engine.run(request('listApps'), 1)).ok, true);
    const host = { stop: async () => { lifecycle.push(['stop']); }, uniffiDestroy: () => lifecycle.push(['destroy']) };
    engine.host = host;
    assert.ok(engine.sessions.get('conversation-a').idleTimer, 'a quiet session holds exactly one idle lease');
    t.mock.timers.tick(59_999);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(lifecycle, [], 'recent activity keeps the session');
    t.mock.timers.tick(1);
    for (let index = 0; index < 5; index++) await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(lifecycle, [['close', 'conversation-a'], ['stop'], ['destroy']]);
    assert.equal(engine.sessions.size, 0);
    assert.equal(engine.host, undefined);
    await engine.dispose();
});

test('computer idle lease never fires during a long action and restarts after the last one settles', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { engine, lifecycle, hold } = computerFixture(1_000);
    await engine.run(request('listApps'), 1);
    const open = hold();
    const long = engine.run(request('listApps'), 1);
    for (let index = 0; index < 3; index++) await new Promise(resolve => setImmediate(resolve));
    const session = engine.sessions.get('conversation-a');
    assert.equal(session.active, 1);
    assert.equal(session.idleTimer, undefined, 'no idle lease while native work is in flight');
    t.mock.timers.tick(5_000);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(lifecycle, []);
    open();
    assert.equal((await long).ok, true);
    assert.ok(session.idleTimer, 'the lease re-arms after completion');
    t.mock.timers.tick(1_000);
    for (let index = 0; index < 5; index++) await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(lifecycle, [['close', 'conversation-a']]);
    await engine.dispose();
});

test('explicit release and dispose leave no computer idle timers behind', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { engine } = computerFixture(1_000);
    await engine.run(request('listApps'), 1);
    await engine.run(request('listApps', 'conversation-b'), 1);
    const sessions = [...engine.sessions.values()];
    assert.equal(await engine.release('conversation-a', 1), true);
    assert.equal(sessions[0].idleTimer, undefined);
    await engine.dispose();
    assert.ok(sessions.every(session => session.idleTimer === undefined));
    assert.equal(engine.sessions.size, 0);
});

function browserFixture(idleReleaseMs) {
    const handlers = new Map(), partition = {}, sender = {}, lifecycle = [];
    const guest = Object.assign(new EventEmitter(), { isDestroyed: () => false, getType: () => 'webview', hostWebContents: sender, session: partition });
    const original = GuestAutomation.create;
    let created = 0;
    GuestAutomation.create = async () => { const index = ++created; lifecycle.push(['attach', index]);
        return { run: async value => ({ requestId: value.id, ok: true }), cancel() {}, dispose: async () => { lifecycle.push(['detach', index]); } }; };
    const registry = registerBrowserAutomation({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
        webContents: { fromId: id => id === 7 ? guest : undefined }, session: { fromPartition: () => partition },
        trustedMainFrame: event => event.trusted === true, idleReleaseMs });
    const event = { trusted: true, sender };
    const action = (conversationId = 'conversation') => handlers.get('nextmux:browser:action')(event, 7,
        { id: crypto.randomUUID(), action: 'snapshot', conversationId, browserId: 'tab', workspaceRoot: '/workspace', expiresAt: Date.now() + 5_000 });
    return { handlers, guest, event, lifecycle, registry, action, restore: () => { GuestAutomation.create = original; } };
}

test('browser CDP attachment detaches after idle, re-attaches on demand and keeps tab ownership', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const fixture = browserFixture(60_000);
    t.after(fixture.restore);
    assert.equal((await fixture.action()).ok, true);
    t.mock.timers.tick(59_000);
    assert.equal((await fixture.action()).ok, true, 'activity renews the lease');
    t.mock.timers.tick(59_000);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(fixture.lifecycle, [['attach', 1]]);
    t.mock.timers.tick(1_000);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(fixture.lifecycle, [['attach', 1], ['detach', 1]]);
    const record = fixture.registry.guests.get(7);
    assert.equal(record.engine, undefined);
    assert.equal(record.idleTimer, undefined, 'a detached guest keeps no timer');
    assert.equal((await fixture.action('another-conversation')).ok, false, 'ownership survives the idle detach');
    assert.equal((await fixture.action()).ok, true);
    assert.deepEqual(fixture.lifecycle.at(-1), ['attach', 2]);
    fixture.guest.emit('destroyed');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(fixture.lifecycle.at(-1), ['detach', 2]);
    assert.equal(fixture.registry.guests.size, 0);
});

test('conversation release detaches only that renderer and conversation, immediately', async t => {
    const fixture = browserFixture(60_000);
    t.after(fixture.restore);
    await fixture.action();
    const release = fixture.handlers.get('nextmux:browser:release');
    assert.equal(await release({ ...fixture.event, trusted: false }, 'conversation'), false);
    assert.equal(await release({ ...fixture.event, sender: {} }, 'conversation'), false);
    assert.equal(await release(fixture.event, 'another'), false);
    assert.equal(await release(fixture.event, 'conversation'), true);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(fixture.lifecycle, [['attach', 1], ['detach', 1]]);
    assert.equal(fixture.registry.guests.get(7).idleTimer, undefined);
});

const flush = async (count = 6) => { for (let index = 0; index < count; index++) await new Promise(resolve => setImmediate(resolve)); };
const MINUTE = 60_000;

test('fallback lease is 15 minutes, renewed by the renderer while the run is active; run end still releases at once', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const lifecycle = [];
    const engine = new ComputerAutomation({ platform: 'darwin', sdkLoader: async () => ({ create: async id => ({
        observeWindow: async () => ({ elements: [{ element_token: 'button-1' }] }),
        setValue: async () => ({ effect: 'confirmed' }),
        close: async () => { lifecycle.push(['close', id]); }
    }) }) });
    engine.capability = () => ({ available: true });
    assert.equal(engine.idleReleaseMs, 15 * MINUTE, 'default lease');
    const handlers = new Map();
    registerComputerAutomation({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, trustedMainFrame: () => true, automation: engine });
    const event = { sender: { id: 1, isDestroyed: () => false, once() {} } };
    const run = (action, input) => handlers.get('nextmux:computer:action')(event, { id: `${action}-${crypto.randomUUID()}`, conversationId: 'conversation-a',
        expiresAt: Date.now() + 10_000, action, input });
    const observed = await run('observeWindow', { pid: 7, windowId: 9 });
    assert.equal(observed.ok, true);
    // The model thinks for 20 minutes between observe and a semantic write; the renderer
    // renews once a minute because the run is still active.
    for (let minute = 0; minute < 20; minute++) {
        t.mock.timers.tick(MINUTE);
        assert.equal(await handlers.get('nextmux:computer:keepalive')(event, ['conversation-a', 'not-a-session']), 1);
        await flush(2);
    }
    assert.deepEqual(lifecycle, [], 'an active run keeps its session');
    const clicked = await run('setValue', { pid: 7, windowId: 9, snapshotId: observed.output.snapshotId, elementToken: 'button-1', value: 'fixture' });
    assert.equal(clicked.ok, true, 'snapshot and element tokens survived the long gap');
    // Keepalive from another renderer cannot extend this renderer's session.
    assert.equal(await handlers.get('nextmux:computer:keepalive')({ sender: { id: 2, isDestroyed: () => false, once() {} } }, ['conversation-a']), 0);
    assert.equal(await handlers.get('nextmux:computer:release')(event, 'conversation-a'), true);
    assert.deepEqual(lifecycle, [['close', 'conversation-a']], 'run end releases immediately');
    // No renderer at all: the lease alone releases after 15 minutes.
    await run('observeWindow', { pid: 7, windowId: 9 });
    t.mock.timers.tick(15 * MINUTE - 1); await flush();
    assert.equal(lifecycle.length, 1);
    t.mock.timers.tick(1); await flush();
    assert.deepEqual(lifecycle.at(-1), ['close', 'conversation-a']);
    assert.equal(engine.sessions.size, 0);
    await engine.dispose();
});

test('browser keepalive renews only the calling renderer and conversation; without it the 15-minute lease detaches', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const fixture = browserFixture(15 * MINUTE);
    t.after(fixture.restore);
    await fixture.action();
    const keepalive = fixture.handlers.get('nextmux:browser:keepalive');
    for (let minute = 0; minute < 20; minute++) {
        t.mock.timers.tick(MINUTE);
        assert.equal(await keepalive(fixture.event, ['conversation']), 1);
    }
    assert.equal(await keepalive({ ...fixture.event, sender: {} }, ['conversation']), 0);
    assert.equal(await keepalive(fixture.event, ['another']), 0);
    await flush(2);
    assert.deepEqual(fixture.lifecycle, [['attach', 1]], 'refs survive an active run');
    t.mock.timers.tick(15 * MINUTE); await flush(2);
    assert.deepEqual(fixture.lifecycle, [['attach', 1], ['detach', 1]]);
});

test('re-attach waits for the previous CDP disposal to finish', async t => {
    const handlers = new Map(), partition = {}, sender = {}, lifecycle = [];
    const guest = Object.assign(new EventEmitter(), { isDestroyed: () => false, getType: () => 'webview', hostWebContents: sender, session: partition });
    let attached = false, finishDispose;
    const original = GuestAutomation.create;
    t.after(() => { GuestAutomation.create = original; });
    GuestAutomation.create = async () => {
        // Mirrors GuestAutomation.create: a still-attached debugger is refused.
        if (attached) throw Error('此标签正在调试，请关闭开发者工具后重试。');
        attached = true; lifecycle.push('attach');
        return { run: async value => ({ requestId: value.id, ok: true }), cancel() {},
            dispose: () => new Promise(resolve => { finishDispose = () => { attached = false; lifecycle.push('detached'); resolve(); }; }) };
    };
    registerBrowserAutomation({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
        webContents: { fromId: id => id === 7 ? guest : undefined }, session: { fromPartition: () => partition }, trustedMainFrame: () => true });
    const event = { sender };
    const action = () => handlers.get('nextmux:browser:action')(event, 7,
        { id: crypto.randomUUID(), action: 'snapshot', conversationId: 'conversation', browserId: 'tab', workspaceRoot: '/workspace', expiresAt: Date.now() + 5_000 });
    assert.equal((await action()).ok, true);
    assert.equal(await handlers.get('nextmux:browser:release')(event, 'conversation'), true);
    await flush(2);
    const next = action();
    await flush(4);
    assert.deepEqual(lifecycle, ['attach'], 'no re-attach while the old debugger is still detaching');
    finishDispose();
    const result = await next;
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(lifecycle, ['attach', 'detached', 'attach']);
});
