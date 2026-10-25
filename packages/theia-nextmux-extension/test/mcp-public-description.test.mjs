import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { NextMuxMcpServerManager } from '../lib/node/nextmux-mcp-server-manager.js';
const { MCPServerManagerServerImpl } = createRequire(import.meta.url)('@theia/ai-mcp/lib/node/mcp-server-manager-server');

const tool = { name: 'lookup', description: 'Read a fixture', inputSchema: { type: 'object', additionalProperties: false } };
const secretValues = ['fixture-env-value', 'fixture-arg-value', 'fixture-header-value', 'fixture-url-value', 'fixture-token-value', 'fixture-oauth-value'];
const local = () => ({ name: 'fixture', command: '/private/fixture-env-value/bin/runner', args: ['--password', secretValues[1], 'plain-secret-no-prefix'],
    env: { [secretValues[0]]: secretValues[0] }, autostart: false, deferLoading: true });
const remote = () => ({ name: 'fixture', serverUrl: `https://user:${secretValues[3]}@mcp.example.invalid/${secretValues[3]}?token=${secretValues[3]}#${secretValues[3]}`,
    headers: { [secretValues[2]]: secretValues[2] }, serverAuthToken: secretValues[4], serverAuthTokenHeader: secretValues[2],
    oauth: { clientSecret: secretValues[5], clientId: secretValues[5], resource: secretValues[5], scopes: [secretValues[5]], authorizationServer: secretValues[5] },
    autostart: true, deferLoading: true });

function fixture(initial = local()) {
    const manager = new NextMuxMcpServerManager();
    manager.credentialStore = { clear: async () => {} };
    let description = initial; let running = false; const calls = [];
    const server = {
        getCachedDescription: () => ({ ...description, status: running ? 'Running' : 'Not Running', error: description.error }),
        getDescription: async () => { throw new Error('description must not fetch tools or raw upstream diagnostics'); },
        isRunning: () => running, isInFlight: () => false, isStopped: () => !running,
        start: async () => { calls.push({ start: description }); running = true; },
        stop: async () => { running = false; },
        update: value => { description = value; }, setWorkspaceRoots() {},
        getTools: async () => ({ tools: [tool] }),
        callTool: async () => { calls.push({ dispatch: description }); return { content: [{ type: 'text', text: 'ok' }] }; }
    };
    manager.servers.set('fixture', server);
    return { manager, server, calls, raw: () => description, replace: value => { description = value; },
        async start() { const [state] = await manager.accessState(); return manager.changeAccess({ serverName: 'fixture', fingerprint: state.fingerprint, action: 'start' }); },
        async approve() { const [state] = await manager.accessState(); return manager.changeAccess({ serverName: 'fixture', fingerprint: state.fingerprint,
            action: 'tools', tools: state.tools.map(({ name, fingerprint }) => ({ name, fingerprint })) }); }
    };
}

function noConfigurationValues(output) {
    const text = JSON.stringify(output);
    for (const value of [...secretValues, 'plain-secret-no-prefix']) assert.equal(text.includes(value), false, 'configuration value must not be public');
}

test('actual manager public description and access state hide every legacy argument/environment/header/token/OAuth/URL value', async () => {
    for (const initial of [local(), remote()]) {
        const f = fixture({ ...initial, error: secretValues.join(' '), registryMetadata: { serverId: secretValues[4] }, unknown: secretValues[4] });
        const before = f.raw();
        const d = await f.manager.getServerDescription('fixture'); const [access] = await f.manager.accessState();
        noConfigurationValues([d, access]); assert.equal(d.nextmuxDisplayOnly, true); assert.equal(d.error, 'MCP_CONNECTION_FAILED');
        for (const key of ['args', 'env', 'headers', 'serverAuthToken', 'serverAuthTokenHeader', 'registryMetadata', 'unknown', 'tools', 'resolve']) assert.equal(key in d, false);
        assert.equal(d.name, 'fixture'); assert.equal(d.deferLoading, true); assert.strictEqual(f.raw(), before);
        if ('command' in initial) {
            assert.equal(d.command, 'Local process'); assert.deepEqual(JSON.parse(access.details), { arguments: 3, environment: 1 });
        } else {
            assert.equal(d.serverUrl, 'https://mcp.example.invalid'); assert.deepEqual(d.oauth, {});
            assert.deepEqual(JSON.parse(access.details), { headers: 1, oauth: true, staticToken: true });
        }
        assert.equal(await f.manager.getServerDescription('absent'), undefined); assert.deepEqual(f.calls, []);
    }
});

test('projection is detached, uses registry lookup names, and never echoes an unresolved or malformed URL', async () => {
    const f = fixture({ ...remote(), name: 'mismatched-cache-name' });
    const d = await f.manager.getServerDescription('fixture'); assert.equal(d.name, 'fixture');
    d.oauth.clientSecret = 'changed'; d.serverUrl = 'https://other.invalid'; d.name = 'other';
    assert.equal(f.raw().oauth.clientSecret, secretValues[5]); assert.equal((await f.manager.getServerDescription('fixture')).name, 'fixture');
    for (const serverUrl of ['not-a-url fixture-url-value', 'file:///fixture-url-value', 'data:text/plain,fixture-url-value']) {
        f.replace({ name: 'fixture', serverUrl });
        const result = [await f.manager.getServerDescription('fixture'), await f.manager.accessState()];
        noConfigurationValues(result); assert.equal(result[0].serverUrl, 'Remote endpoint');
    }
});

test('all display DTOs are refused as configuration without changing original startup configuration or grants', async () => {
    for (const initial of [local(), remote(), { name: 'fixture', serverUrl: 'https://mcp.example.invalid/mcp' }]) {
        const f = fixture(initial); await f.start(); await f.approve();
        const before = f.raw(); const [state] = await f.manager.accessState(); const d = await f.manager.getServerDescription('fixture');
        for (const value of [d, { ...d, nextmuxDisplayOnly: false }, JSON.parse(JSON.stringify(d))]) {
            assert.throws(() => f.manager.addOrUpdateServer(value), /MCP_DISPLAY_DESCRIPTION_NOT_CONFIGURATION/);
        }
        assert.strictEqual(f.raw(), before); assert.equal((await f.manager.accessState())[0].fingerprint, state.fingerprint);
        await f.manager.callTool('fixture', 'lookup', '{}'); assert.strictEqual(f.calls[0].start, before); assert.strictEqual(f.calls.at(-1).dispatch, before);
        noConfigurationValues([await f.manager.getServerDescription('fixture'), await f.manager.accessState()]);
    }
});

test('hidden configuration changes still invalidate original identity and old tool/start approvals', async () => {
    for (const [initial, change] of [[local(), d => ({ ...d, args: ['changed'] })], [local(), d => ({ ...d, env: { SECRET: 'changed' } })],
        [remote(), d => ({ ...d, serverUrl: `${d.serverUrl}&changed=yes` })], [remote(), d => ({ ...d, serverAuthToken: 'changed' })],
        [remote(), d => ({ ...d, headers: { SECRET: 'changed' } })]]) {
        const f = fixture(initial);
        await f.start(); await f.approve(); const [before] = await f.manager.accessState();
        f.replace(change(f.raw())); const [after] = await f.manager.accessState();
        assert.notEqual(after.fingerprint, before.fingerprint); assert.equal(after.approved, false); assert.deepEqual(after.tools, []);
        await assert.rejects(f.manager.callTool('fixture', 'lookup', '{}'), /MCP_START_APPROVAL_REQUIRED/);
        await assert.rejects(f.manager.changeAccess({ serverName: 'fixture', fingerprint: before.fingerprint, action: 'start' }), /MCP_APPROVAL_STALE/);
        assert.equal(f.calls.length, 1);
    }
});

test('removing a DTO marker cannot reuse the raw configuration grant for a sanitized replacement', async () => {
    const f = fixture(); await f.start(); await f.approve(); const [before] = await f.manager.accessState();
    const { nextmuxDisplayOnly: _display, ...replacement } = await f.manager.getServerDescription('fixture');
    await f.manager.addOrUpdateServer(replacement);
    assert.equal((await f.manager.accessState())[0].approved, false);
    await assert.rejects(f.manager.changeAccess({ serverName: 'fixture', fingerprint: before.fingerprint, action: 'start' }), /MCP_APPROVAL_STALE/);
    await assert.rejects(f.manager.callTool('fixture', 'lookup', '{}'), /MCP_START_APPROVAL_REQUIRED/);
    assert.equal(f.calls.length, 1);
});

test('display calls never execute resolvers; a resolver returning public DTO cannot replace original configuration', async () => {
    const f = fixture(); let resolved = 0;
    f.replace({ ...local(), resolve: async () => { resolved++; return f.manager.getServerDescription('fixture'); } });
    const original = f.raw(); await f.manager.getServerDescription('fixture'); assert.equal((await f.manager.accessState())[0].needsReview, true);
    assert.equal(resolved, 0);
    await assert.rejects(f.manager.reviewAccess('fixture'), /MCP_DISPLAY_DESCRIPTION_NOT_CONFIGURATION/);
    assert.equal(resolved, 1); assert.strictEqual(f.raw(), original); assert.deepEqual(f.calls, []);
});

test('actual upstream resolver RPC bridge preserves the display marker and cannot write the DTO back', async () => {
    const f = fixture(remote()); const original = f.raw(); const bridge = new MCPServerManagerServerImpl();
    bridge.mcpServerManager = f.manager;
    const d = await f.manager.getServerDescription('fixture');
    await assert.rejects(bridge.addOrUpdateServer({ ...JSON.parse(JSON.stringify(d)), resolveId: 'fixture-resolver' }), /MCP_DISPLAY_DESCRIPTION_NOT_CONFIGURATION/);
    assert.strictEqual(f.raw(), original); assert.deepEqual(f.calls, []);
});

test('configuration change while access tool listing waits cannot attach old tool approvals to fresh public state', async () => {
    const f = fixture(remote()); await f.start(); await f.approve(); let release;
    f.server.getTools = () => new Promise(resolve => { release = resolve; });
    const pending = f.manager.accessState(); f.replace({ ...f.raw(), serverAuthToken: 'changed' });
    release({ tools: [tool] }); const [state] = await pending;
    assert.equal(state.approved, false); assert.deepEqual(state.tools, []); noConfigurationValues(state);
});
