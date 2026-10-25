import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { McpCredentialStore, createAuthenticatedMcpFetch, credentialMcpDescription, mcpCredentialEndpoint } from '../lib/node/nextmux-mcp-credentials.js';
import { NextMuxMcpServerManager } from '../lib/node/nextmux-mcp-server-manager.js';
import { McpAccessStore } from '../lib/node/nextmux-mcp-access-store.js';
import { parseMcpCredentialReference } from '../lib/common/nextmux-mcp-access.js';
import { McpToolPreflightError, mcpFingerprint } from '../lib/node/nextmux-mcp-permissions.js';
import { createRequire } from 'node:module';
const { StreamableHTTPClientTransport } = createRequire(import.meta.url)('@modelcontextprotocol/sdk/client/streamableHttp.js');

const token = 'fixture-secret-never-use-on-network';
const description = () => ({ name: 'fixture', serverUrl: 'https://mcp.example.invalid/mcp', autostart: false });
const deferred = () => { let resolve; const promise = new Promise(value => { resolve = value; }); return { promise, resolve }; };
function fixture() {
    const records = new Map(); const writes = []; const deletes = [];
    const secrets = {
        async getPassword(service, id) { return records.get(`${service}/${id}`) ?? null; },
        async setPassword(service, id, value) { writes.push({ service, id, value }); records.set(`${service}/${id}`, value); },
        async deletePassword(service, id) { deletes.push(id); return records.delete(`${service}/${id}`); }
    };
    const mutations = new Map();
    const store = new McpCredentialStore(secrets, mutations);
    return { records, writes, deletes, secrets, store, mutations,
        async save(value = token, base = description(), kind = 'bearer') {
            const ref = await store.replace(base, kind, value);
            return { ...base, nextmuxCredential: ref };
        } };
}

test('keychain-only storage returns a bounded nonsecret reference and binds the complete canonical endpoint', async () => {
    const f = fixture(); const d = await f.save(token, { ...description(), serverUrl: 'https://MCP.example.invalid:443/mcp' });
    assert.deepEqual(Object.keys(d.nextmuxCredential).sort(), ['id', 'kind', 'revision']);
    assert.equal(JSON.stringify(d).includes(token), false);
    assert.equal(f.writes[0].service, 'NextMux');
    assert.match(f.writes[0].id, /^mcp-credential:/);
    assert.equal(JSON.parse(f.writes[0].value).endpoint, 'https://mcp.example.invalid/mcp');
    const originalRecord = f.writes[0].value;
    assert.equal((await f.store.read({ ...d, serverUrl: 'https://mcp.example.invalid/mcp' })).value, token);
    for (const base of [{ ...d, name: 'other' }, { ...d, serverUrl: 'https://mcp.example.invalid/other' },
        { ...d, nextmuxCredential: { ...d.nextmuxCredential, revision: randomUUID() } },
        { ...d, nextmuxCredential: { ...d.nextmuxCredential, kind: 'api-key' } }]) {
        await assert.rejects(new McpCredentialStore(f.secrets, new Map()).read(base), /MCP_CREDENTIAL_UNAVAILABLE/);
        const replacement = await f.store.replace(base, 'bearer', 'replacement');
        assert.notEqual(replacement.id, d.nextmuxCredential.id);
        assert.equal(f.records.get(`NextMux/mcp-credential:${d.nextmuxCredential.id}`), originalRecord);
    }
    assert.equal(f.writes.length, 5);
});

test('reference, endpoint and credential inputs reject ambiguity, injected headers and mixed legacy auth', async () => {
    const f = fixture(); const d = await f.save(); const ref = d.nextmuxCredential;
    for (const value of [null, [], {}, { ...ref, value: token }, { ...ref, kind: ['bearer'] }, { ...ref, id: '../escape' }, { ...ref, kind: 'Cookie' }]) {
        assert.throws(() => parseMcpCredentialReference(value), /MCP_CREDENTIAL_REFERENCE_INVALID/);
    }
    for (const url of ['http://mcp.example.invalid/mcp', 'https://user:secret@mcp.example.invalid/mcp',
        'https://mcp.example.invalid/mcp?key=x', 'https://mcp.example.invalid/mcp#frag', 'https://mcp.example.invalid/mcp?', 'https://mcp.example.invalid/mcp#', 'https://mcp.example.invalid/\nmcp']) {
        assert.throws(() => mcpCredentialEndpoint(url), /MCP_CREDENTIAL_ENDPOINT_INVALID/);
    }
    for (const base of [{ ...d, oauth: {} }, { ...d, headers: { Accept: 'application/json' } }, { ...d, serverAuthToken: 'legacy' },
        { name: 'local', command: 'never-start', nextmuxCredential: ref }]) {
        assert.throws(() => credentialMcpDescription(base), /MCP_CREDENTIAL_CONFIGURATION_CONFLICT/);
    }
    for (const value of ['', 'token\r\nHost: evil', 'Bearer token', 'x'.repeat(8193)]) await assert.rejects(f.store.replace(description(), 'bearer', value), /MCP_CREDENTIAL_VALUE_INVALID/);
    await assert.rejects(f.store.replace(description(), 'host', token), /MCP_CREDENTIAL_KIND_INVALID/);
    assert.equal(f.writes.length, 1);
});

test('authenticated fetch injects only the selected header at dispatch, pins URL and refuses credential-bearing redirects', async () => {
    for (const kind of ['bearer', 'x-api-key', 'api-key']) {
        const f = fixture(); const d = await f.save(token, description(), kind); const calls = [];
        const send = createAuthenticatedMcpFetch({ description: d, store: f.store, assertAccess() {}, fetchImpl: async (input, init) => {
            calls.push({ url: String(input), init }); return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
        } });
        await send('https://MCP.example.invalid:443/mcp', { method: 'POST', headers: { 'mcp-session-id': 'session' }, body: '{}' });
        assert.equal(calls[0].init.headers.get(kind === 'bearer' ? 'authorization' : kind), kind === 'bearer' ? `Bearer ${token}` : token);
        assert.equal(calls[0].init.headers.get('mcp-session-id'), 'session');
        assert.equal(calls[0].init.redirect, 'error'); assert.equal(calls[0].init.credentials, 'omit');
        for (const url of ['https://other.example.invalid/mcp', 'https://mcp.example.invalid/other', 'https://mcp.example.invalid/mcp?next=1', 'http://mcp.example.invalid/mcp']) await assert.rejects(send(url), /MCP_CREDENTIAL_ENDPOINT/);
        for (const header of ['Host', 'Cookie', 'Proxy-Authorization', 'Authorization', 'api-key', 'x-api-key']) await assert.rejects(send(d.serverUrl, { headers: { [header]: 'conflict' } }), /MCP_CREDENTIAL_HEADER_CONFLICT/);
        await assert.rejects(send(d.serverUrl, { method: 'PUT' }), /MCP_CREDENTIAL_ENDPOINT_CHANGED/);
        assert.equal(calls.length, 1);
    }
});

test('transport error bodies and thrown request diagnostics never escape; there is no retry', async () => {
    const f = fixture(); const d = await f.save(); let calls = 0;
    for (const failure of ['http', 'network']) {
        const send = createAuthenticatedMcpFetch({ description: d, store: f.store, assertAccess() {}, fetchImpl: async () => {
            calls++; if (failure === 'network') throw new Error(token); return new Response(token, { status: 401, statusText: token });
        } });
        if (failure === 'http') { const result = await send(d.serverUrl); assert.equal(result.status, 401); assert.equal(await result.text(), ''); assert.equal(result.statusText.includes(token), false); }
        else await assert.rejects(send(d.serverUrl), error => error.message === 'MCP_HTTPS_REQUEST_FAILED' && !String(error).includes(token));
    }
    assert.equal(calls, 2);
});

test('revocation and a credential rotation while keychain read waits dispatch zero requests', async () => {
    for (const revoke of ['grant', 'credential']) {
        const f = fixture(); const d = await f.save(); let allowed = true; let requests = 0; const wait = deferred(); const entered = deferred();
        const get = f.secrets.getPassword; f.secrets.getPassword = async (...args) => { entered.resolve(); await wait.promise; return get(...args); };
        const send = createAuthenticatedMcpFetch({ description: d, store: f.store, assertAccess: () => { if (!allowed) throw new Error('MCP_APPROVAL_STALE'); }, fetchImpl: async () => { requests++; return new Response(); } });
        const pending = send(d.serverUrl).catch(error => error);
        await entered.promise;
        if (revoke === 'grant') allowed = false; else f.store.invalidate(d.nextmuxCredential);
        wait.resolve(); assert.match((await pending).message, /MCP_APPROVAL_STALE|MCP_CREDENTIAL_CHANGED/); assert.equal(requests, 0);
    }
});

test('rotated references and changed same-name endpoints fail closed without anonymous fallback, including a new process-state map', async () => {
    const f = fixture(); const old = await f.save(); const current = await f.save('replacement', old);
    assert.equal(current.nextmuxCredential.id, old.nextmuxCredential.id); assert.notEqual(current.nextmuxCredential.revision, old.nextmuxCredential.revision);
    let requests = 0; const restarted = new McpCredentialStore(f.secrets, new Map());
    for (const d of [old, { ...current, serverUrl: 'https://other.example.invalid/mcp' }]) {
        const send = createAuthenticatedMcpFetch({ description: d, store: restarted, assertAccess() {}, fetchImpl: async () => { requests++; return new Response(); } });
        await assert.rejects(send(d.serverUrl), /MCP_CREDENTIAL_UNAVAILABLE/);
    }
    assert.equal(requests, 0); assert.equal((await restarted.read(current)).value, 'replacement');
});

test('keychain write/read failures remain generic and leave existing transports blocked; clear deletes only the bound credential', async () => {
    const f = fixture(); const d = await f.save(); const live = await f.store.read(d);
    f.secrets.setPassword = async () => { throw new Error(token); };
    await assert.rejects(f.store.replace(d, 'api-key', 'replacement'), error => error.message === 'MCP_KEYCHAIN_UNAVAILABLE');
    assert.throws(live.assertCurrent, /MCP_CREDENTIAL_CHANGED/);
    await assert.rejects(f.store.read(d), /MCP_CREDENTIAL_CHANGED/);
    const clean = fixture(); const saved = await clean.save(); await clean.store.clear(saved);
    assert.equal(clean.records.size, 0); assert.equal(clean.deletes.length, 1);
    await assert.rejects(clean.store.read(saved), /MCP_CREDENTIAL_CHANGED/);
    const unavailable = fixture(); const ref = await unavailable.save(); unavailable.secrets.getPassword = async () => { throw new Error(token); };
    await assert.rejects(unavailable.store.read(ref), error => error.message === 'MCP_KEYCHAIN_UNAVAILABLE');
    await assert.rejects(unavailable.store.replace(ref, 'api-key', 'replacement'), error => error.message === 'MCP_KEYCHAIN_UNAVAILABLE');
    assert.equal(unavailable.writes.length, 1);
});

async function managerFixture(base = description()) {
    const f = fixture(); const manager = new NextMuxMcpServerManager(); manager.secureCredentials = f.store;
    manager.credentialStore = { clear: async () => {} };
    await manager.addOrUpdateServer(base);
    const [before] = await manager.accessState();
    const saved = await manager.changeCredential({ serverName: 'fixture', fingerprint: before.fingerprint, action: 'set', kind: 'bearer', value: token });
    return { ...f, manager, saved };
}

test('actual manager stores no secret in description/access/RPC and new credential revision withdraws startup and tool approvals synchronously', async () => {
    const f = await managerFixture({ ...description(), autostart: true }); const server = f.manager.servers.get('fixture'); const d = await f.manager.getServerDescription('fixture');
    for (const output of [d, f.saved, await f.manager.accessState()]) assert.equal(JSON.stringify(output).includes(token), false);
    assert.deepEqual(d.nextmuxCredential, f.saved.credential);
    assert.equal(d.autostart, false);
    const [state] = f.saved.servers;
    f.manager.grants.set('fixture', { fingerprint: state.fingerprint, tools: new Map([['lookup', 'approved']]) });
    const wait = deferred(); const entered = deferred(); const set = f.secrets.setPassword;
    f.secrets.setPassword = async (...args) => { entered.resolve(); await wait.promise; return set(...args); };
    const rotate = f.manager.changeCredential({ serverName: 'fixture', fingerprint: state.fingerprint, action: 'set', kind: 'api-key', value: 'replacement' });
    assert.equal(f.manager.grants.has('fixture'), false);
    await entered.promise;
    await assert.rejects(f.manager.callTool('fixture', 'lookup', '{}'), /MCP_START_APPROVAL_REQUIRED/);
    wait.resolve(); const next = await rotate;
    assert.notEqual(next.servers[0].fingerprint, state.fingerprint); assert.equal(next.servers[0].approved, false);
    await assert.rejects(f.manager.changeAccess({ serverName: 'fixture', fingerprint: state.fingerprint, action: 'start' }), /MCP_APPROVAL_STALE/);
    assert.equal(server.isRunning(), false);
    await f.manager.changeCredential({ serverName: 'fixture', fingerprint: next.servers[0].fingerprint, action: 'clear' });
    assert.equal((await f.manager.getServerDescription('fixture')).nextmuxCredential, undefined);
    assert.equal(f.records.size, 0);
});

test('configuration replacement, including an invalid locator, immediately revokes old scope; same-name rebind cannot use its old key', async () => {
    const f = await managerFixture(); const d = f.manager.servers.get('fixture').getCachedDescription(); const state = f.saved.servers[0];
    assert.equal(state.credentialEditable, true);
    f.manager.grants.set('fixture', { fingerprint: state.fingerprint, tools: new Map() });
    assert.throws(() => f.manager.addOrUpdateServer({ ...d, nextmuxCredential: { ...d.nextmuxCredential, value: token } }), /MCP_CREDENTIAL_REFERENCE_INVALID/);
    assert.equal(f.manager.grants.has('fixture'), false);
    await f.manager.addOrUpdateServer({ ...d, serverUrl: 'https://another.example.invalid/mcp' });
    const rebound = f.manager.servers.get('fixture').getCachedDescription(); let requests = 0;
    const send = createAuthenticatedMcpFetch({ description: rebound, store: f.store, assertAccess() {}, fetchImpl: async () => { requests++; return new Response(); } });
    await assert.rejects(send(rebound.serverUrl), /MCP_CREDENTIAL_UNAVAILABLE/); assert.equal(requests, 0);
    for (const [name, config] of [['plain-http', { serverUrl: 'http://example.invalid/mcp' }], ['local', { command: 'never-start' }],
        ['legacy', { serverUrl: 'https://example.invalid/mcp', serverAuthToken: 'user-owned-legacy' }], ['oauth', { serverUrl: 'https://example.invalid/mcp', oauth: {} }]]) {
        await f.manager.addOrUpdateServer({ name, ...config, autostart: false });
        assert.equal((await f.manager.accessState()).find(server => server.name === name).credentialEditable, false);
    }
});

test('rotation invalidates another frontend manager synchronously before keychain write completes', async () => {
    const f = await managerFixture(); const d = f.manager.servers.get('fixture').getCachedDescription();
    const other = new NextMuxMcpServerManager(); other.secureCredentials = new McpCredentialStore(f.secrets, f.mutations);
    await other.addOrUpdateServer(d); const [before] = await other.accessState();
    other.grants.set('fixture', { fingerprint: before.fingerprint, tools: new Map([['lookup', 'approved']]) });
    const wait = deferred(); const entered = deferred(); const set = f.secrets.setPassword;
    f.secrets.setPassword = async (...args) => { entered.resolve(); await wait.promise; return set(...args); };
    const rotating = f.manager.changeCredential({ serverName: 'fixture', fingerprint: f.saved.servers[0].fingerprint, action: 'set', kind: 'bearer', value: 'replacement' });
    assert.equal((await other.accessState())[0].approved, false);
    await assert.rejects(other.callTool('fixture', 'lookup', '{}'), /MCP_START_APPROVAL_REQUIRED/);
    await entered.promise; wait.resolve(); await rotating;
    let requests = 0;
    const send = createAuthenticatedMcpFetch({ description: d, store: other.secureCredentials, assertAccess() {}, fetchImpl: async () => { requests++; return new Response(); } });
    await assert.rejects(send(d.serverUrl), /MCP_CREDENTIAL_UNAVAILABLE/); assert.equal(requests, 0);
});

test('cross-window invalidation notifies subscribers even when keychain/prefs fail, and disconnect removes subscriptions', async () => {
    const f = await managerFixture(); const d = f.manager.servers.get('fixture').getCachedDescription();
    const other = new NextMuxMcpServerManager(); other.secureCredentials = new McpCredentialStore(f.secrets, f.mutations);
    await other.addOrUpdateServer(d);
    let notifications = 0;
    const client = { didUpdateMCPServers: () => { notifications++; } }; other.setClient(client);
    const [before] = await other.accessState(); other.grants.set('fixture', { fingerprint: before.fingerprint, tools: new Map() });
    f.secrets.setPassword = async () => { throw new Error('synthetic-keychain-failure'); };
    await assert.rejects(f.manager.changeCredential({ serverName: 'fixture', fingerprint: f.saved.servers[0].fingerprint, action: 'set', kind: 'bearer', value: 'replacement' }), /MCP_KEYCHAIN_UNAVAILABLE/);
    assert.ok(notifications > 0); assert.equal(other.grants.has('fixture'), false); assert.equal((await other.accessState())[0].approved, false);
    other.disconnectClient(client); await new Promise(resolve => setImmediate(resolve));
    const completed = notifications; f.store.invalidate(d.nextmuxCredential);
    assert.equal(notifications, completed);
});

test('delayed cleanup of a revoked connection closes only its captured client and cannot reset a newer lifecycle', async () => {
    const f = await managerFixture(); const server = f.manager.servers.get('fixture');
    const entered = deferred(); const wait = deferred(); let oldClosed = 0; let newClosed = 0;
    server.client = { close: async () => { oldClosed++; } };
    server.transport = Object.assign(Object.create(StreamableHTTPClientTransport.prototype), {
        terminateSession: async () => { entered.resolve(); await wait.promise; }
    });
    const stopping = server.stop(); await entered.promise;
    // The next explicitly approved start has replaced the old lifecycle while cleanup waits.
    server.lifecycle++; server.client = { close: async () => { newClosed++; } }; server.setStatus('connected');
    wait.resolve(); await stopping;
    assert.equal(oldClosed, 1); assert.equal(newClosed, 0); assert.equal(server.getStatus(), 'connected');
});

test('late tool results, tool lists and access snapshots cannot revive a rotated credential grant', async () => {
    for (const phase of ['call', 'list', 'snapshot']) {
        const f = await managerFixture(); const server = f.manager.servers.get('fixture'); const d = await f.manager.getServerDescription('fixture');
        const tool = { name: 'lookup', inputSchema: { type: 'object', additionalProperties: false } };
        f.manager.grants.set('fixture', { fingerprint: f.saved.servers[0].fingerprint, tools: new Map([['lookup', mcpFingerprint(tool)]]) });
        server.isRunning = () => true;
        const wait = deferred(); const entered = deferred(); let effects = 0;
        server.getTools = async () => { if (phase !== 'call') { entered.resolve(); await wait.promise; } return { tools: [tool] }; };
        server.callTool = async () => { effects++; entered.resolve(); await wait.promise; return { content: [{ type: 'text', text: 'late-result' }] }; };
        const pending = (phase === 'call' ? f.manager.callTool('fixture', 'lookup', '{}') : phase === 'list' ? f.manager.getTools('fixture') : f.manager.accessState()).catch(error => error);
        await entered.promise; f.store.invalidate(d.nextmuxCredential); wait.resolve();
        const result = await pending;
        if (phase === 'snapshot') { assert.equal(result[0].approved, false); assert.deepEqual(result[0].tools, []); }
        else {
            assert.ok(result instanceof Error);
            assert.equal(result instanceof McpToolPreflightError, false);
            assert.match(result.message, phase === 'call' ? /MCP_TOOL_RESULT_STALE/ : /MCP_START_APPROVAL_REQUIRED/);
        }
        assert.equal(effects, phase === 'call' ? 1 : 0);
    }
});

test('cancelling during keychain lookup never dispatches, and local fetch preflight errors retain their private type', async () => {
    const f = fixture(); const d = await f.save(); const wait = deferred(); const entered = deferred(); const get = f.secrets.getPassword;
    f.secrets.getPassword = async (...args) => { entered.resolve(); await wait.promise; return get(...args); };
    let requests = 0; const controller = new AbortController();
    const send = createAuthenticatedMcpFetch({ description: d, store: f.store, assertAccess() {}, fetchImpl: async () => { requests++; return new Response(); } });
    const pending = send(d.serverUrl, { signal: controller.signal }).catch(error => error);
    await entered.promise; controller.abort(); wait.resolve();
    assert.equal((await pending).reason, 'MCP_REQUEST_CANCELLED'); assert.equal(requests, 0);
    const m = await managerFixture(); const server = m.manager.servers.get('fixture');
    m.manager.grants.set('fixture', { fingerprint: m.saved.servers[0].fingerprint, tools: new Map() });
    server.setStatus('connected');
    const local = new McpToolPreflightError('MCP_CREDENTIAL_CHANGED');
    server.client = { callTool: async () => { throw local; } };
    await assert.rejects(server.callTool('lookup', '{}'), error => error === local);
    server.client = { callTool: async () => { throw new Error('MCP_CREDENTIAL_CHANGED'); } };
    await assert.rejects(server.callTool('lookup', '{}'), error => !(error instanceof McpToolPreflightError) && error.message === 'MCP_SECURE_TOOL_REQUEST_FAILED');
});

test('actual frontend rehydration retains valid and malformed refs instead of silently stripping authentication', async () => {
    const source = await readFile(new URL('../src/browser/nextmux-mcp-contribution.ts', import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
    const exports = {};
    const Base = class { convertToMap(servers) { return new Map(Object.entries(servers).map(([name, config]) => [name, 'serverUrl' in config ? { name, serverUrl: config.serverUrl } : { name, command: config.command }])); } };
    const presets = await import('../lib/browser/nextmux-open-source-mcp-presets.js');
    Function('require', 'exports', compiled)(name => name.includes('inversify') ? { injectable: () => value => value }
        : name.includes('open-source-mcp-presets') ? presets : { McpFrontendApplicationContribution: Base }, exports);
    const f = fixture(); const d = await f.save(); const instance = new exports.NextMuxMcpContribution();
    for (const ref of [d.nextmuxCredential, null, { ...d.nextmuxCredential, value: token }]) {
        for (const base of [description(), { name: 'fixture', command: 'never-start' }]) {
            const map = instance.convertToMap({ fixture: { ...base, nextmuxCredential: ref } });
            assert.deepEqual(map.get('fixture').nextmuxCredential, ref);
        }
    }
    assert.equal(instance.convertToMap({ fixture: description() }).get('fixture').nextmuxCredential, undefined);
});

test('failed reference persistence then restart is repaired only by explicit new input in a fresh keychain slot', async () => {
    // Preferences contain the internal locator/configuration, never a public display DTO.
    const f = await managerFixture(); const persisted = f.manager.servers.get('fixture').getCachedDescription();
    await f.manager.changeCredential({ serverName: 'fixture', fingerprint: f.saved.servers[0].fingerprint, action: 'set', kind: 'api-key', value: 'new-before-pref-write' });
    // Simulate the app closing after keytar succeeded but before User prefs wrote its new revision.
    const orphanKey = `NextMux/mcp-credential:${persisted.nextmuxCredential.id}`;
    const orphanBytes = f.records.get(orphanKey);
    const restarted = new NextMuxMcpServerManager(); restarted.secureCredentials = new McpCredentialStore(f.secrets, new Map());
    await restarted.addOrUpdateServer(persisted);
    let requests = 0;
    const oldFetch = createAuthenticatedMcpFetch({ description: persisted, store: restarted.secureCredentials, assertAccess() {}, fetchImpl: async () => { requests++; return new Response(); } });
    await assert.rejects(oldFetch(persisted.serverUrl), /MCP_CREDENTIAL_UNAVAILABLE/);
    const [state] = await restarted.accessState();
    const result = await restarted.changeCredential({ serverName: 'fixture', fingerprint: state.fingerprint, action: 'set', kind: 'x-api-key', value: 'explicit-user-reentry' });
    assert.notEqual(result.credential.id, persisted.nextmuxCredential.id);
    assert.equal(f.records.get(orphanKey), orphanBytes);
    assert.equal(f.deletes.length, 0);
    assert.equal(JSON.parse(f.records.get(`NextMux/mcp-credential:${result.credential.id}`)).value, 'explicit-user-reentry');
    assert.equal(JSON.stringify(result).includes('explicit-user-reentry'), false);
    assert.equal(JSON.stringify(result).includes('new-before-pref-write'), false);
    assert.equal(result.servers[0].approved, false);
    assert.equal((await restarted.getServerDescription('fixture')).autostart, false);
    await assert.rejects(oldFetch(persisted.serverUrl), /MCP_CREDENTIAL_CHANGED|MCP_CREDENTIAL_UNAVAILABLE/);
    assert.equal(requests, 0);
});

test('actual official SDK uses the scoped credential fetch for handshake/list/tool and denies legacy fallback without logging server diagnostics', async t => {
    const f = await managerFixture(); const requests = []; const originalFetch = globalThis.fetch;
    const logs = []; const originalLog = console.log; const originalError = console.error; const originalWarn = console.warn;
    console.log = console.error = console.warn = (...args) => { logs.push(args.map(String).join(' ')); };
    t.after(() => { globalThis.fetch = originalFetch; console.log = originalLog; console.error = originalError; console.warn = originalWarn; });
    let failure = false;
    globalThis.fetch = async (input, init) => {
        assert.equal(String(input), description().serverUrl); assert.equal(init.redirect, 'error');
        assert.equal(init.headers.get('authorization'), `Bearer ${token}`); requests.push(init.method);
        if (failure) return new Response(token, { status: 500, statusText: token });
        if (init.method === 'GET') return new Response(null, { status: 405 });
        if (init.method === 'DELETE') return new Response(null, { status: 204 });
        const body = JSON.parse(init.body);
        if (!('id' in body)) return new Response(null, { status: 202 });
        const result = body.method === 'initialize' ? { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fake-mcp', version: '1' } }
            : body.method === 'tools/list' ? { tools: [{ name: 'lookup', inputSchema: { type: 'object', additionalProperties: false } }] }
            : { content: [{ type: 'text', text: 'fixture-result' }] };
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), { headers: { 'content-type': 'application/json', 'mcp-session-id': 'fixture-session' } });
    };
    const state = f.saved.servers[0];
    await f.manager.changeAccess({ serverName: 'fixture', fingerprint: state.fingerprint, action: 'start' });
    const [started] = await f.manager.accessState();
    await f.manager.changeAccess({ serverName: 'fixture', fingerprint: started.fingerprint, action: 'tools', tools: started.tools.map(({ name, fingerprint }) => ({ name, fingerprint })) });
    assert.equal((await f.manager.callTool('fixture', 'lookup', '{}')).content[0].text, 'fixture-result');
    await f.manager.stopServer('fixture');
    const before = requests.length; failure = true;
    await assert.rejects(f.manager.changeAccess({ serverName: 'fixture', fingerprint: state.fingerprint, action: 'start' }), /MCP_SECURE_CONNECTION_FAILED/);
    assert.deepEqual(requests.slice(before), ['POST']);
    assert.equal(f.manager.grants.has('fixture'), true, 'failed reconnect retains enablement but exposes no callable tools');
    assert.equal((await f.manager.accessState())[0].running, false);
    assert.equal(logs.join('\n').includes(token), false);
    assert.equal(JSON.stringify(await f.manager.getServerDescription('fixture')).includes(token), false);
    assert.equal((await f.manager.getServerDescription('fixture')).error, 'MCP_SECURE_CONNECTION_FAILED');
});

test('persisted enablement uses the credential reference revision, not the process epoch, and clearing it revokes on disk before returning', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'nextmux-mcp-credential-approval-'));
    const path = join(directory, 'approvals.json');
    const f = await managerFixture(); const originalFetch = globalThis.fetch;
    const managers = [f.manager];
    t.after(async () => {
        for (const manager of managers) { manager.disconnectClient(manager.client); await manager.stopServersAfterDisconnect(); }
        globalThis.fetch = originalFetch;
        await rm(directory, { recursive: true, force: true });
    });
    globalThis.fetch = async (_input, init) => {
        assert.equal(init.headers.get('authorization'), `Bearer ${token}`);
        if (init.method === 'GET') return new Response(null, { status: 405 });
        if (init.method === 'DELETE') return new Response(null, { status: 204 });
        const request = JSON.parse(init.body);
        if (!('id' in request)) return new Response(null, { status: 202 });
        const result = request.method === 'initialize' ? { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }
            : request.method === 'tools/list' ? { tools: [{ name: 'lookup', inputSchema: { type: 'object', additionalProperties: false } }] }
                : { content: [{ type: 'text', text: 'scoped-result' }] };
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), { headers: { 'content-type': 'application/json', 'mcp-session-id': 'fixture' } });
    };
    f.manager.setClient({ didUpdateMCPServers() {} }); f.manager.configureAccessStore(new McpAccessStore(path));
    let [state] = await f.manager.accessState();
    [state] = await f.manager.changeAccess({ serverName: state.name, fingerprint: state.fingerprint, action: 'start' });
    await f.manager.changeAccess({ serverName: state.name, fingerprint: state.fingerprint, action: 'tools', tools: state.tools });
    const persistedConfig = f.manager.servers.get('fixture').getCachedDescription();
    assert.ok(f.store.version(persistedConfig.nextmuxCredential) > 0);
    f.manager.disconnectClient(f.manager.client); await f.manager.stopServersAfterDisconnect();
    const restarted = new NextMuxMcpServerManager(); managers.push(restarted);
    restarted.secureCredentials = new McpCredentialStore(f.secrets, new Map());
    restarted.credentialStore = { clear: async () => {} }; restarted.setClient({ didUpdateMCPServers() {} });
    restarted.configureAccessStore(new McpAccessStore(path));
    await restarted.addOrUpdateServer(persistedConfig);
    assert.equal(restarted.secureCredentials.version(persistedConfig.nextmuxCredential), 0);
    [state] = await restarted.accessState();
    assert.equal(state.approved, true); assert.equal(state.tools[0].approved, true);
    assert.equal((await restarted.callTool('fixture', 'lookup', '{}')).content[0].text, 'scoped-result');
    await restarted.changeCredential({ serverName: 'fixture', fingerprint: state.fingerprint, action: 'clear' });
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')).approvals, []);
    const noSecret = await readFile(path, 'utf8'); assert.equal(noSecret.includes(token), false);
});
