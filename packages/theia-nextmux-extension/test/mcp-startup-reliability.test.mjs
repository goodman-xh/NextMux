import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { NextMuxMcpServer } from '../lib/node/nextmux-mcp-server.js';
import { NextMuxMcpServerManager } from '../lib/node/nextmux-mcp-server-manager.js';
import { mcpChildEnvironment, mcpLocalCommand } from '../lib/node/nextmux-mcp-launch.js';
const require = createRequire(import.meta.url);
const { MCPServerStatus: Status } = require('@theia/ai-mcp/lib/common/mcp-server-manager');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { UnauthorizedError } = require('@modelcontextprotocol/sdk/client/auth.js');
const { mcpStartupPending, mcpStatus } = require('../lib/browser/nextmux-mcp-access-panel.js');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const never = () => new Promise(() => {});
const local = { name: 'fixture', command: 'fixture-never-spawned', autostart: false };
const remote = { name: 'fixture', serverUrl: 'https://example.invalid/mcp', autostart: false };
class FastServer extends NextMuxMcpServer {
    startupTimeoutMs() { return 60; }
    cleanupTimeoutMs() { return 100; }
}
const fixture = (description = local, factory = {}) => new FastServer(description, factory, {}, () => () => {});
const fakeClient = (connect = async () => {}) => ({ connect, close: async () => {}, listTools: async () => ({ tools: [] }) });
function managerFor(server) {
    const manager = new NextMuxMcpServerManager();
    manager.servers.set('fixture', server);
    manager.credentialStore = { clear: async () => {} };
    return manager;
}
async function approvedStart(manager) {
    const [state] = await manager.accessState();
    return manager.changeAccess({ action: 'start', serverName: 'fixture', fingerprint: state.fingerprint });
}

test('setup exceptions leave a terminal failure and a corrected configuration can retry', async () => {
    const server = fixture(); const manager = managerFor(server);
    server.createClient = () => { throw new Error('fixture setup failure'); };
    await assert.rejects(approvedStart(manager), /MCP_START_FAILED_CONNECTION/);
    const [failed] = await manager.accessState();
    assert.equal(failed.status, Status.Errored);
    assert.equal(failed.failure.stage, 'startup');
    server.createClient = () => fakeClient();
    assert.equal((await approvedStart(manager))[0].running, true);
    await server.stop();
});

test('concurrent/reentrant starts share one initialization and repeated stops share cleanup', async () => {
    const server = fixture(); const handshake = deferred(); let created = 0, closed = 0;
    server.createClient = () => { created++; return { ...fakeClient(() => handshake.promise), close: async () => { closed++; } }; };
    let reentrant;
    server.onDidUpdateStatus(status => { if (status === Status.Starting) reentrant = server.start(); });
    const first = server.start(); const second = server.start();
    assert.equal(first, second);
    await tick(); assert.equal(first, reentrant); assert.equal(created, 1);
    handshake.resolve(); await first;
    await server.start(); assert.equal(created, 1);
    const stop1 = server.stop(), stop2 = server.stop(); assert.equal(stop1, stop2);
    await stop1; await server.stop(); assert.equal(closed, 1);
    assert.equal(server.getStatus(), Status.NotRunning);
});

test('a hung initialize times out, reports a readable reason, and permits one clean retry', async () => {
    const server = fixture(); let count = 0, closed = 0;
    server.createClient = () => ({ ...fakeClient(++count === 1 ? never : async () => {}), close: async () => { closed++; } });
    await assert.rejects(server.start(), /TIMEOUT/);
    assert.equal(server.getStatus(), Status.Errored);
    assert.equal(server.failureEvidence().code, 'timeout');
    assert.match(mcpStatus('zh-CN', { local: true, status: server.getStatus(), failure: server.failureEvidence() }).label, /超时/);
    await Promise.all([server.start(), server.start()]);
    assert.equal(count, 2); assert.equal(closed, 1); assert.equal(server.isRunning(), true);
    await server.stop();
});

test('stop releases a hung start immediately; late completion cannot close or relabel its replacement', async () => {
    const server = fixture(); const handshake = deferred(); const closing = deferred(); let count = 0, closed = 0;
    server.createClient = () => ++count === 1 ? { ...fakeClient(() => handshake.promise), close: () => closing.promise }
        : { ...fakeClient(), close: async () => { closed++; } };
    const starting = server.start(); await tick();
    const stopping = server.stop();
    const restarting = server.start();
    await starting; await tick(); assert.equal(count, 1, 'no duplicate while old cleanup is pending');
    closing.resolve(); await stopping; await restarting;
    handshake.resolve(); await tick();
    assert.equal(server.isRunning(), true); assert.equal(count, 2); assert.equal(closed, 0);
    await server.stop();
});

test('cleanup timeout is terminal, and retry never creates a process until old cleanup settles', async () => {
    const server = fixture(); const closing = deferred(); let created = 0;
    server.createClient = () => { created++; return { ...fakeClient(), close: () => closing.promise }; };
    await server.start();
    await assert.rejects(server.stop(), /cleanup timed out/);
    assert.equal(server.getStatus(), Status.Errored);
    await assert.rejects(server.start(), /TIMEOUT/);
    assert.equal(created, 1);
    closing.resolve(); await tick();
    server.createClient = () => { created++; return fakeClient(); };
    await server.start(); assert.equal(created, 2); await server.stop();
});

test('remote HTTP and SSE initialization both have an overall deadline with no late fallback', async () => {
    for (const fallback of [false, true]) {
        const server = fixture(remote); const late = deferred(); let connections = 0, closed = 0;
        server.createClient = () => ({ ...fakeClient(async () => {
            connections++;
            if (fallback && connections === 1) throw new Error('HTTP not supported');
            return late.promise;
        }), close: async () => { closed++; } });
        await assert.rejects(server.start(), /TIMEOUT/);
        assert.equal(server.failureEvidence().code, 'timeout');
        assert.equal(server.getStatus(), Status.Errored);
        const attempts = connections; late.reject(new Error('late failure')); await tick();
        assert.equal(connections, attempts); assert.equal(closed, attempts);
        server.createClient = () => fakeClient();
        await server.start(); assert.equal(server.isRunning(), true); await server.stop();
    }
});

test('OAuth provider setup is bounded and a provider returned after stop is cancelled', async () => {
    const pending = deferred(); let cancelled = 0;
    const server = fixture({ ...remote, oauth: {} }, { create: () => pending.promise });
    await assert.rejects(server.start(), /TIMEOUT/);
    assert.equal(server.getStatus(), Status.Errored);
    pending.resolve({ cancel: () => { cancelled++; } }); await tick();
    assert.equal(cancelled, 1);
    await server.stop();
});

test('OAuth wait can be stopped without SSE fallback or revival by a late authorization code', async () => {
    const code = deferred(); const entered = deferred(); let cancelled = 0, connections = 0;
    const provider = { cancel() { cancelled++; }, waitForAuthorization() { entered.resolve(); return code.promise; } };
    const server = fixture({ ...remote, oauth: {} }, { create: async () => provider });
    server.createClient = () => fakeClient(async () => { connections++; throw new UnauthorizedError(); });
    const starting = server.start({ interactive: true }); await entered.promise;
    await server.stop(); await starting;
    code.resolve('late-code'); await tick();
    assert.equal(server.getStatus(), Status.NotConnected); assert.equal(connections, 1); assert.ok(cancelled > 0);
});

test('early clean remote close cannot report Connected even if connect resolves', async () => {
    const server = fixture(remote);
    server.createClient = () => { const client = fakeClient(async () => client.onclose?.()); return client; };
    await assert.rejects(server.start(), /START_FAILED/);
    assert.equal(server.isRunning(), false); assert.equal(server.getStatus(), Status.Errored);
    await server.stop();
});

test('remote cleanup does not await a permanently hung session DELETE', async () => {
    const server = fixture(remote); let closed = 0;
    server.client = { close: async () => { closed++; } };
    server.transport = Object.assign(Object.create(StreamableHTTPClientTransport.prototype), { terminateSession: never });
    server.cleanupTimeoutMs = () => 1500;
    await server.stop(); assert.equal(closed, 1); assert.equal(server.getStatus(), Status.NotConnected);
});

test('tools/list has a total deadline, publishes a tools failure, and supports retry', async () => {
    const server = fixture(remote);
    server.createClient = () => ({ ...fakeClient(), listTools: never });
    await server.start();
    await assert.rejects(server.getTools(), /timed out/);
    assert.equal(server.getStatus(), Status.Errored);
    assert.deepEqual(server.failureEvidence(), { stage: 'tools', code: 'timeout' });
    server.createClient = () => fakeClient(); await server.start();
    assert.deepEqual(await server.getTools(), { tools: [] }); await server.stop();
});

test('configuration changes and removal interrupt initialization before the mutation queue', async () => {
    for (const action of ['update', 'remove']) {
        const server = fixture(); const entered = deferred();
        server.createClient = () => fakeClient(() => { entered.resolve(); return never(); });
        const manager = managerFor(server);
        const starting = approvedStart(manager); const rejected = assert.rejects(starting, /MCP_APPROVAL_STALE/);
        await entered.promise;
        const mutation = action === 'remove' ? manager.removeServer('fixture')
            : manager.addOrUpdateServer({ ...local, args: ['new-config'] });
        await mutation; await rejected;
        if (action === 'remove') assert.deepEqual(await manager.accessState(), []);
        else {
            const [state] = await manager.accessState();
            assert.equal(state.approved, false); assert.equal(state.status, Status.NotRunning); assert.equal(state.failure, undefined);
            assert.deepEqual(server.getCachedDescription().args, ['new-config']);
        }
    }
});

test('an observer rejecting notifications cannot reject successful startup or leak an unhandled rejection', async () => {
    const server = fixture(); server.createClient = () => fakeClient();
    const manager = managerFor(server);
    manager.client = { didUpdateMCPServers: async () => { throw new Error('observer unavailable'); } };
    assert.equal((await approvedStart(manager))[0].running, true); await tick(); await server.stop();
});

test('real ENOENT and early process exit retain specific startup diagnostics', async t => {
    for (const description of [{ ...local, command: '/nextmux-missing-fixture-executable' },
        { ...local, command: process.execPath, args: ['-e', 'process.exit(23)'] }]) {
        const server = new NextMuxMcpServer(description, {}, {}, () => () => {});
        t.after(() => server.stop());
        await assert.rejects(server.start());
        assert.equal(server.getStatus(), Status.Errored); assert.equal(server.failureEvidence().stage, 'startup');
        if (description.args) assert.equal(server.failureEvidence().exitCode, 23);
        else assert.equal(server.failureEvidence().code, 'runtime_missing');
    }
});

test('real nonresponsive child is closed on timeout and real retries do not duplicate processes', async t => {
    const server = fixture({ ...local, command: process.execPath, args: ['-e', 'process.stdin.resume();'] });
    server.cleanupTimeoutMs = () => 10_000; // Real process teardown uses the production budget, not the fake-client budget.
    t.after(() => server.stop());
    await assert.rejects(server.start(), /TIMEOUT/);
    assert.equal(server.transport.pid, null);
    server.update({ ...local, command: process.execPath, args: [fileURLToPath(new URL('./fixtures/mcp-echo-server.mjs', import.meta.url))] });
    server.startupTimeoutMs = () => 15_000;
    await Promise.all([server.start(), server.start()]);
    const child = server.transport._process;
    assert.equal(server.isRunning(), true); assert.ok(child.pid);
    await server.start(); assert.equal(server.transport._process.pid, child.pid);
    const closed = once(child, 'close'); await server.stop(); await closed;
});

test('Windows environment overlays collapse PATH/Path, preserve configured values and omit unrelated secrets', () => {
    const env = mcpChildEnvironment({ Path: 'C:\\custom tools', systemRoot: 'D:\\Windows', api_key: 'explicit' }, 'win32',
        { PATH: 'C:\\default', Path: 'C:\\other', SystemRoot: 'C:\\Windows', ComSpec: 'C:\\Windows\\System32\\cmd.exe', NEXTMUX_SECRET: 'never inherit' });
    assert.equal(env.PATH, 'C:\\custom tools'); assert.equal(env.SYSTEMROOT, 'D:\\Windows');
    assert.equal(env.COMSPEC, 'C:\\Windows\\System32\\cmd.exe'); assert.equal(env.API_KEY, 'explicit');
    assert.equal(env.NEXTMUX_SECRET, undefined); assert.equal(env.Path, undefined); assert.equal(env.SystemRoot, undefined);
    assert.equal(env.NPM_CONFIG_YES, 'true'); assert.match(env.PATHEXT, /\.CMD/);
    assert.equal(mcpLocalCommand(' npx ', 'win32'), 'npx');
    assert.equal(mcpLocalCommand('"C:\\Program Files\\nodejs\\npx.cmd"', 'win32'), 'C:\\Program Files\\nodejs\\npx.cmd');
    assert.equal(mcpLocalCommand('tool.bat', 'win32'), 'tool.bat');
    assert.equal(mcpLocalCommand('npm.exe', 'win32'), 'npm.exe');
});

test('POSIX PATH fallback and explicit child environment overrides stay compatible', () => {
    const env = mcpChildEnvironment({}, 'darwin', { HOME: '/fixture', PATH: '/custom', SECRET: 'omit' });
    assert.ok(env.PATH.startsWith('/custom:')); assert.ok(env.PATH.includes('/opt/homebrew/bin'));
    assert.equal(env.SECRET, undefined); assert.equal(env.npm_config_yes, 'true');
    assert.equal(mcpChildEnvironment({ PATH: '/only' }, 'darwin', {}).PATH, '/only');
});

test('background Starting/Connecting services offer Stop even without a panel-owned request', () => {
    for (const status of [Status.Starting, Status.Connecting]) assert.equal(mcpStartupPending({ status }, false), true);
    assert.equal(mcpStartupPending({ status: Status.Errored }, false), false);
    assert.equal(mcpStartupPending({ status: Status.NotRunning }, true), true);
});

test('a second stop cancels a restart queued behind the first cleanup', async () => {
    const server = fixture(); const closing = deferred(); let created = 0;
    server.createClient = () => { created++; return { ...fakeClient(), close: () => closing.promise }; };
    await server.start();
    const firstStop = server.stop();
    const restart = server.start();
    const finalStop = server.stop();
    closing.resolve(); await Promise.all([firstStop, restart, finalStop]);
    assert.equal(created, 1); assert.equal(server.getStatus(), Status.NotRunning);
});

test('credential replacement interrupts a hung handshake before waiting for the manager queue', async () => {
    const server = fixture(remote); const entered = deferred();
    server.startupTimeoutMs = () => 10_000;
    server.createClient = () => fakeClient(() => { entered.resolve(); return never(); });
    const manager = managerFor(server);
    const [before] = await manager.accessState();
    const starting = approvedStart(manager); const rejected = assert.rejects(starting, /MCP_APPROVAL_STALE/);
    await entered.promise;
    const changed = await manager.changeCredential({ action: 'clear', serverName: 'fixture', fingerprint: before.fingerprint });
    await rejected;
    assert.equal(changed.servers[0].approved, false); assert.equal(server.getStatus(), Status.NotConnected);
});

test('configuration edits and remove/re-add clear cached diagnostics and old approvals', async () => {
    const server = fixture(); const manager = managerFor(server);
    server.createClient = () => { throw new Error('ENOENT'); };
    await assert.rejects(approvedStart(manager));
    assert.equal((await manager.accessState())[0].failure.code, 'runtime_missing');
    await manager.addOrUpdateServer({ ...local, cwd: '/new-working-directory' });
    let [state] = await manager.accessState();
    assert.equal(state.failure, undefined); assert.equal(state.approved, false); assert.equal(state.status, Status.NotRunning);
    await assert.rejects(approvedStart(manager));
    await manager.removeServer('fixture'); await manager.addOrUpdateServer(local);
    [state] = await manager.accessState();
    assert.equal(state.failure, undefined); assert.equal(state.approved, false); assert.equal(state.status, Status.NotRunning);
    await manager.removeServer('fixture');
});

test('compiled frontend conversion preserves a local cwd through Theia filtering', () => {
    const compiled = readFileSync(new URL('../lib/browser/nextmux-mcp-contribution.js', import.meta.url), 'utf8');
    const exports = {};
    const Base = class { convertToMap(servers) {
        return new Map(Object.entries(servers).map(([name, config]) => [name,
            'command' in config ? { name, command: config.command } : { name, serverUrl: config.serverUrl }]));
    } };
    Function('require', 'exports', compiled)(name => name.includes('inversify') ? { injectable: () => value => value }
        : name.includes('open-source-mcp-presets') ? { isHiddenPresetConfiguration: () => false }
            : { McpFrontendApplicationContribution: Base }, exports);
    const contribution = new exports.NextMuxMcpContribution();
    assert.equal(contribution.convertToMap({ fixture: { ...local, cwd: '/project with spaces' } }).get('fixture').cwd, '/project with spaces');
    assert.equal(contribution.convertToMap({ fixture: { ...remote, cwd: '/ignored' } }).get('fixture').cwd, undefined);
});

test('real HTTP transport aborts stalled initialization and late results never revive it', async t => {
    const original = globalThis.fetch; const response = deferred(); let signal;
    globalThis.fetch = (_input, init) => { signal = init.signal; return response.promise; };
    const server = fixture(remote);
    t.after(async () => { await server.stop(); globalThis.fetch = original; });
    await assert.rejects(server.start(), /TIMEOUT/);
    assert.equal(signal.aborted, true); assert.equal(server.getStatus(), Status.Errored);
    response.reject(new Error('late network error')); await tick();
    assert.equal(server.getStatus(), Status.Errored);
});

test('Windows SDK launches PATH-resolved npx.cmd and quoted .bat paths with literal arguments', { skip: process.platform !== 'win32' }, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'nextmux mcp shim '));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const argument = 'path with spaces & (literal)';
    const script = join(directory, 'server.mjs');
    await writeFile(script, `if (process.argv[2] !== ${JSON.stringify(argument)}) process.exit(42);\nawait import(${JSON.stringify(new URL('./fixtures/mcp-echo-server.mjs', import.meta.url).href)});\n`);
    for (const name of ['npx.cmd', 'local server.bat']) {
        await writeFile(join(directory, name), `@"${process.execPath}" "${script}" %*\r\n`);
        const server = new NextMuxMcpServer({ ...local, command: name === 'npx.cmd' ? 'npx' : `"${join(directory, name)}"`,
            args: [argument], env: { Path: `${directory};${dirname(process.execPath)};${process.env.PATH}` } }, {}, {}, () => () => {});
        t.after(() => server.stop());
        await server.start(); assert.equal(server.isRunning(), true);
        assert.equal((await server.getTools()).tools[0].name, 'echo'); await server.stop();
    }
});
