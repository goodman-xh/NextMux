import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentToolRegistry, ToolExecutionLedger } from '@nextmux/agent-runtime';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { createRequire } from 'node:module';
import { NextMuxMcpServerManager } from '../lib/node/nextmux-mcp-server-manager.js';
import { compileMcpInputSchema, mcpFingerprint, McpToolPreflightError } from '../lib/node/nextmux-mcp-permissions.js';

const tool = () => ({ name: 'lookup', description: 'Read a project item', inputSchema: { type: 'object', properties: { id: { type: 'string', minLength: 1 } }, required: ['id'], additionalProperties: false } });
function fixture() {
    const manager = new NextMuxMcpServerManager();
    let description = { name: 'fixture', command: 'never-spawned', args: ['--fixture'], autostart: true };
    let running = false;
    let tools = [tool()];
    const calls = [];
    const server = {
        getCachedDescription: () => description,
        getDescription: async () => description,
        isRunning: () => running, isInFlight: () => false, isStopped: () => !running,
        start: async () => { calls.push('start'); running = true; },
        stop: async () => { calls.push('stop'); running = false; },
        update: value => { description = value; }, setWorkspaceRoots() {},
        getTools: async () => ({ tools }),
        callTool: async (name, args) => { calls.push({ name, args }); return { content: [{ type: 'text', text: 'done' }] }; }
    };
    manager.servers.set('fixture', server);
    return { manager, server, calls, setTools: value => { tools = value; }, setDescription: value => { description = value; },
        async start() { const [state] = await manager.accessState(); return manager.changeAccess({ serverName: 'fixture', fingerprint: state.fingerprint, action: 'start' }); },
        async approve() { const [state] = await manager.accessState(); return manager.changeAccess({ serverName: 'fixture', fingerprint: state.fingerprint, action: 'tools', tools: state.tools.map(item => ({ name: item.name, fingerprint: item.fingerprint })) }); }
    };
}

test('MCP autostart, interactive legacy entry, raw tools and resources cannot self-authorize', async () => {
    const f = fixture();
    await assert.rejects(f.manager.startServer('fixture'), /MCP_START_APPROVAL_REQUIRED/);
    await assert.rejects(f.manager.startServer('fixture', { interactive: true }), /MCP_START_APPROVAL_REQUIRED/);
    await assert.rejects(f.manager.callTool('fixture', 'lookup', '{"id":"x"}'), /MCP_START_APPROVAL_REQUIRED/);
    await assert.rejects(f.manager.readResource('fixture', 'file:///secret'), /MCP_RESOURCE_APPROVAL_UNSUPPORTED/);
    assert.deepEqual(f.calls, []);
    await f.start();
    await assert.rejects(f.manager.callTool('fixture', 'lookup', '{"id":"x"}'), /MCP_TOOL_APPROVAL_REQUIRED/);
    assert.deepEqual(f.calls, ['start']);
    await f.approve();
    await f.manager.callTool('fixture', 'lookup', '{"id":"x"}');
    assert.equal(f.calls.length, 2);
});

test('tool schema validates types and required fields without mutation or permissive fallback', async () => {
    const f = fixture(); await f.start(); await f.approve();
    for (const args of ['{}', '{"id":1}', '{"id":""}', '{"id":"x","delete":true}', '[]', 'null']) {
        await assert.rejects(f.manager.callTool('fixture', 'lookup', args), /MCP_ARGUMENTS_INVALID/);
    }
    assert.deepEqual(f.calls, ['start']);
    for (const schema of [null, [], {}, { type: 'object', mysteryKeyword: true }, { type: 'object', $ref: 'https://evil.invalid/schema' }, { type: 'object', properties: { id: { type: 'string', pattern: '(a+)\\1' } } }]) {
        assert.throws(() => compileMcpInputSchema(schema));
    }
    assert.equal(compileMcpInputSchema(tool().inputSchema).validate({ id: 'x' }), true);
});

test('maintained MCP servers using Draft 2020-12 metadata remain callable', () => {
    const compiled = compileMcpInputSchema({
        type: 'object', properties: { action: { type: 'string', enum: ['list', 'new'] } }, required: ['action'],
        additionalProperties: false, $schema: 'https://json-schema.org/draft/2020-12/schema'
    });
    assert.equal(compiled.validate({ action: 'list' }), true);
    assert.equal(compiled.validate({ action: 'close' }), false);
});

test('approved descriptor is bound to config, secrets and tools while workspace discovery roots do not revoke it', async () => {
    const f = fixture(); await f.start(); await f.approve();
    const pinned = await f.manager.approvedToolIdentity('fixture', 'lookup');
    f.setTools([{ ...tool(), description: 'Now performs writes' }]);
    await assert.rejects(f.manager.callApprovedTool('fixture', 'lookup', '{"id":"x"}', pinned), /MCP_TOOL_APPROVAL_REQUIRED/);
    await f.approve();
    await assert.rejects(f.manager.callApprovedTool('fixture', 'lookup', '{"id":"x"}', pinned), /MCP_TOOL_IDENTITY_CHANGED/);
    f.setDescription({ name: 'fixture', command: 'never-spawned', args: ['--fixture'], autostart: true, env: { TOKEN: 'changed' } });
    await assert.rejects(f.manager.callTool('fixture', 'lookup', '{"id":"x"}'), /MCP_START_APPROVAL_REQUIRED/);
    await f.start(); await f.approve();
    const beforeRoots = (await f.manager.accessState())[0].fingerprint;
    f.manager.setWorkspaceRoots(['file:///different-workspace']);
    assert.equal((await f.manager.accessState())[0].fingerprint, beforeRoots);
    await f.manager.callTool('fixture', 'lookup', '{"id":"x"}');
    assert.equal(f.calls.filter(value => typeof value === 'object').length, 1);
});

test('literal tool fields named format/pattern/ref stay usable while nested executable schema features remain blocked', () => {
    const compiled = compileMcpInputSchema({ type: 'object', properties: {
        format: { type: 'string', enum: ['json', 'text'] }, pattern: { type: 'string' }, $ref: { type: 'string' },
        data: { type: 'object', enum: [{ format: 'literal', $ref: 'not-a-schema' }] }
    }, additionalProperties: false });
    assert.equal(compiled.validate({ format: 'json', pattern: 'literal', $ref: 'literal', data: { format: 'literal', $ref: 'not-a-schema' } }), true);
    assert.equal(compiled.validate({ format: 'xml' }), false);
    for (const branch of [
        { properties: { format: { format: 'unsupported-custom-format' } } },
        { definitions: { unused: { pattern: '(a+)\\1' } } },
        { dependencies: { field: { properties: { nested: { $ref: 'https://invalid.test' } } } } },
        { allOf: [{ properties: { nested: { items: { pattern: '(a+)\\1' } } } }] },
        { additionalProperties: { propertyNames: { pattern: '(a+)\\1' } } }
    ]) assert.throws(() => compileMcpInputSchema({ type: 'object', ...branch }), /MCP_SCHEMA_UNSUPPORTED|unknown format/);
});

test('variable resolution is reviewed before startup and approval is not reusable against stale config', async () => {
    const f = fixture(); let resolutions = 0;
    f.setDescription({ name: 'fixture', command: '${command}', resolve: async () => { resolutions++; return { name: 'fixture', command: 'resolved-command', args: ['--review-me'] }; } });
    const [before] = await f.manager.accessState();
    assert.equal(before.needsReview, true);
    await assert.rejects(f.manager.startServer('fixture'), /MCP_CONFIGURATION_REVIEW_REQUIRED/);
    assert.equal(resolutions, 0);
    const [reviewed] = await f.manager.reviewAccess('fixture');
    assert.equal(resolutions, 1); assert.equal(reviewed.connection, 'Local process');
    assert.deepEqual(JSON.parse(reviewed.details), { arguments: 1, environment: 0 });
    assert.equal(f.server.getCachedDescription().command, 'resolved-command');
    assert.deepEqual(f.server.getCachedDescription().args, ['--review-me']);
    await assert.rejects(f.manager.changeAccess({ serverName: 'fixture', fingerprint: before.fingerprint, action: 'start' }), /MCP_APPROVAL_STALE/);
    await f.start();
    assert.equal(resolutions, 1);
});

test('revocation while tools/list is pending prevents dispatch; new manager never inherits grants', async () => {
    const f = fixture(); await f.start(); await f.approve();
    let release; f.server.getTools = () => new Promise(resolve => { release = resolve; });
    const pending = f.manager.callTool('fixture', 'lookup', '{"id":"x"}');
    await f.manager.stopServer('fixture');
    release({ tools: [tool()] });
    await assert.rejects(pending, /MCP_START_APPROVAL_REQUIRED|MCP_APPROVAL_STALE/);
    assert.equal(f.calls.some(value => typeof value === 'object'), false);
    assert.equal(new NextMuxMcpServerManager().grants.size, 0);
});

test('canonical fingerprint is order independent but includes every effective credential value', () => {
    assert.equal(mcpFingerprint({ a: 1, b: { c: 2 } }), mcpFingerprint({ b: { c: 2 }, a: 1 }));
    assert.notEqual(mcpFingerprint({ token: 'first' }), mcpFingerprint({ token: 'second' }));
    assert.throws(() => mcpFingerprint({ value: 'x'.repeat(80_001) }));
});

test('real connection binding gates upstream MCP RPC as well as NextMux, and settings replace native add command', async () => {
    const module = await readFile(new URL('../src/node/nextmux-backend-module.ts', import.meta.url), 'utf8');
    const generated = await readFile(new URL('../../../apps/desktop/src-gen/backend/server.js', import.meta.url), 'utf8');
    const widget = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    assert.match(module, /rebind\(MCPServerManager\).*NextMuxMcpServerManager/);
    assert.ok(generated.indexOf('@theia/ai-mcp/lib/node/mcp-backend-module') < generated.indexOf('@nextmux/theia-extension/lib/node/nextmux-backend-module'));
    assert.doesNotMatch(widget, /executeCommand\('aiConfiguration\.mcp\.addServer'/);
    assert.match(widget, /autostart: false/);
});

test('revoke intent immediately blocks dispatch and invalidates older queued approvals', async () => {
    const f = fixture(); await f.start(); await f.approve();
    const [state] = await f.manager.accessState();
    const approval = { serverName: 'fixture', fingerprint: state.fingerprint, action: 'tools', tools: state.tools.map(({ name, fingerprint }) => ({ name, fingerprint })) };
    let release; let first = true;
    f.server.getTools = () => first ? (first = false, new Promise(resolve => { release = resolve; })) : Promise.resolve({ tools: [tool()] });
    const editing = f.manager.changeAccess(approval).catch(error => error);
    await new Promise(resolve => setImmediate(resolve));
    const queuedStart = f.manager.changeAccess({ serverName: 'fixture', fingerprint: state.fingerprint, action: 'start' }).catch(error => error);
    const revoking = f.manager.changeAccess({ serverName: 'fixture', fingerprint: state.fingerprint, action: 'revoke' });
    assert.equal(f.manager.grants.has('fixture'), false);
    await assert.rejects(f.manager.callTool('fixture', 'lookup', '{"id":"x"}'), error => error instanceof McpToolPreflightError);
    release({ tools: [tool()] });
    assert.match((await editing).message, /MCP_START_APPROVAL_REQUIRED|MCP_APPROVAL_STALE/);
    assert.match((await queuedStart).message, /MCP_APPROVAL_STALE/);
    await revoking;
    assert.equal(f.calls.filter(value => value === 'start').length, 1);
    assert.equal(f.calls.some(value => typeof value === 'object'), false);
    assert.equal(f.manager.grants.has('fixture'), false);
});

test('revoke during startup prevents a delayed handshake from retaining authority', async () => {
    const f = fixture(); const [state] = await f.manager.accessState();
    let release;
    f.server.start = () => new Promise(resolve => { release = () => { f.calls.push('delayed-start'); resolve(); }; });
    const starting = f.manager.changeAccess({ serverName: 'fixture', fingerprint: state.fingerprint, action: 'start' }).catch(error => error);
    await new Promise(resolve => setImmediate(resolve));
    const revoking = f.manager.changeAccess({ serverName: 'fixture', fingerprint: state.fingerprint, action: 'revoke' });
    assert.equal(f.manager.grants.has('fixture'), false);
    release();
    assert.match((await starting).message, /MCP_START_APPROVAL_REQUIRED|MCP_APPROVAL_STALE/);
    await revoking;
    assert.ok(f.calls.includes('stop'));
    assert.equal(f.manager.grants.has('fixture'), false);
    assert.equal((await f.manager.accessState())[0].diagnostic, 'authorization');
});

test('unchecking a tool withdraws it immediately and an older pending approval cannot restore it', async () => {
    const f = fixture(); await f.start(); await f.approve();
    const [state] = await f.manager.accessState();
    let release; let first = true;
    f.server.getTools = () => first ? (first = false, new Promise(resolve => { release = resolve; })) : Promise.resolve({ tools: [tool()] });
    const oldApproval = f.manager.changeAccess({ serverName: 'fixture', fingerprint: state.fingerprint, action: 'tools', tools: state.tools.map(({ name, fingerprint }) => ({ name, fingerprint })) }).catch(error => error);
    await new Promise(resolve => setImmediate(resolve));
    const unchecking = f.manager.changeAccess({ serverName: 'fixture', fingerprint: state.fingerprint, action: 'tools', tools: [] });
    assert.equal(f.manager.grants.get('fixture').tools.size, 0);
    await assert.rejects(f.manager.callTool('fixture', 'lookup', '{"id":"x"}'), error => error instanceof McpToolPreflightError);
    release({ tools: [tool()] });
    assert.match((await oldApproval).message, /MCP_APPROVAL_STALE/);
    await unchecking;
    assert.equal(f.manager.grants.get('fixture').tools.size, 0);
    assert.equal(f.calls.some(value => typeof value === 'object'), false);
});

test('only genuine local preflight failures are retryable in the actual Node execution ledger', async t => {
    const f = fixture(); await f.start(); await f.approve();
    const root = await mkdtemp(join(tmpdir(), 'nextmux-mcp-preflight-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const registry = new AgentToolRegistry({ executionLedger: await ToolExecutionLedger.open({ journalPath: join(root, 'ledger.ndjson') }) });
    const service = new NextMuxPlatformServiceImpl(); service.mcpServerManager = f.manager;
    await service.registerMcpTools(registry);
    const name = registry.descriptors('full_access')[0].name;
    const context = { runId: 'run-preflight-ledger', executionScopeId: 'scope-preflight-ledger' };
    const invoke = (id, value = 'retry') => registry.execute({ id, name, arguments: { id: value } }, 'full_access', context);
    await f.manager.stopServer('fixture');
    const refused = await invoke('refused');
    assert.equal(refused.error.code, 'TOOL_NOT_ALLOWED');
    assert.equal(refused.ledger.state, 'failed');
    assert.equal(f.calls.some(value => typeof value === 'object'), false);
    await f.start(); await f.approve();
    const retried = await invoke('after-approval');
    assert.equal(retried.ok, true); assert.equal(retried.ledger.state, 'committed');

    f.setTools([{ ...tool(), description: 'Changed semantics' }]);
    const stale = await invoke('stale-schema', 'changed');
    assert.equal(stale.error.code, 'TOOL_NOT_ALLOWED'); assert.equal(stale.ledger.state, 'failed');
    f.setTools([tool()]);
    let remoteCalls = 0;
    f.server.callTool = async () => { remoteCalls++; throw new Error('MCP_START_APPROVAL_REQUIRED'); };
    const remote = await invoke('remote-same-text', 'remote');
    assert.equal(remote.error.code, 'TOOL_EXECUTION_FAILED'); assert.equal(remote.ledger.state, 'unknown');
    const duplicate = await invoke('remote-retry', 'remote');
    assert.equal(duplicate.error.code, 'TOOL_EXECUTION_UNKNOWN');
    assert.equal(remoteCalls, 1);
});

test('connection container actually replaces the upstream manager with one session-scoped gate', () => {
    const require = createRequire(import.meta.url);
    const { Container } = require('@theia/core/shared/inversify');
    const { ConnectionContainerModule } = require('@theia/core/lib/node/messaging/connection-container-module');
    const { MCPServerManager } = require('@theia/ai-mcp/lib/common/mcp-server-manager');
    const { MCPOAuthClientProviderFactory } = require('@theia/ai-mcp/lib/node/mcp-oauth-client-provider-factory');
    const { MCPOAuthCredentialStore } = require('@theia/ai-mcp/lib/node/mcp-oauth-credential-store');
    const outer = new Container();
    outer.load(require('../lib/node/nextmux-backend-module.js').default);
    const connection = new Container();
    connection.bind(MCPServerManager).toConstantValue({ unsafe: true });
    connection.bind(MCPOAuthClientProviderFactory).toConstantValue({});
    connection.bind(MCPOAuthCredentialStore).toConstantValue({});
    connection.load(...outer.getAll(ConnectionContainerModule));
    const manager = connection.get(MCPServerManager);
    assert.ok(manager instanceof NextMuxMcpServerManager);
    assert.equal(connection.get(MCPServerManager), manager);
    assert.equal(manager.oauthClientProviderFactory, connection.get(MCPOAuthClientProviderFactory));
});

test('large MCP catalogs remain authorizable and use one catalog read per registration', async () => {
    const f = fixture();
    f.setTools(Array.from({length:120}, (_,i) => ({...tool(),name:`lookup_${i}`})));
    await f.start();
    let [state] = await f.manager.accessState();
    assert.equal(state.tools.length,120);
    assert.equal(state.diagnostic,'tools');
    await f.approve();
    [state] = await f.manager.accessState();
    assert.equal(state.diagnostic,'ready');
    const original = f.server.getTools;
    let reads = 0;
    f.server.getTools = async () => { reads++; return original(); };
    const catalog = await f.manager.approvedToolCatalog('fixture');
    assert.equal(reads,1);
    assert.equal(catalog.length,120);
    const service = Object.create(NextMuxPlatformServiceImpl.prototype);
    service.mcpServerManager = f.manager;
    const registry = new AgentToolRegistry();
    await service.registerMcpTools(registry);
    assert.equal(registry.descriptors('full_access').filter(tool => tool.source === 'mcp').length,120);
    const discovered = await registry.execute({id:'discover-last',name:'tool.search',arguments:{query:'lookup_119'}},'full_access',{runId:'large-mcp-catalog'});
    assert.equal(discovered.ok,true);
    assert.ok(discovered.output.tools.some(tool=>tool.name.endsWith('lookup_119')));
    await f.manager.callApprovedTool('fixture','lookup_119','{"id":"last"}',catalog[119].identity);
    assert.ok(f.calls.some(call=>call?.name==='lookup_119'));
});

test('MCP diagnostics distinguish authorization, missing runtime and connection without exposing raw errors', async () => {
    const f = fixture();
    assert.equal((await f.manager.accessState())[0].diagnostic,'authorization');
    f.server.start = async () => {throw new Error('spawn /private/secret/command ENOENT token=secret');};
    await assert.rejects(f.start(),/^Error: MCP_START_FAILED_RUNTIME_MISSING$/);
    const [failed] = await f.manager.accessState();
    assert.equal(failed.diagnostic,'dependency');
    assert.deepEqual(failed.failure, { stage: 'startup', code: 'runtime_missing' });
    assert.equal(JSON.stringify(failed).includes('token=secret'),false);
    const g=fixture(); await g.start();
    g.server.getTools=async()=>{throw new Error('connection lost');};
    assert.equal((await g.manager.accessState())[0].diagnostic,'connection');
});

test('compileMcpInputSchema normalizes modelSchema by inlining local $ref, stripping $schema/$defs/definitions and defaulting array items', () => {
    const rawSchema = {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        $defs: {
            tagList: { type: 'array' },
            filterObj: {
                type: 'object',
                properties: {
                    tags: { $ref: '#/$defs/tagList' },
                    $ref: { type: 'string' }
                }
            }
        },
        definitions: {
            legacy: { type: 'string' }
        },
        properties: {
            filter: { $ref: '#/$defs/filterObj' },
            itemsWithoutSchema: { type: 'array' },
            tupleItems: { type: 'array', prefixItems: [{ type: 'string' }] },
            $ref: { type: 'string' }
        }
    };
    const compiled = compileMcpInputSchema(rawSchema);
    assert.equal('$schema' in compiled.modelSchema, false);
    assert.equal('$defs' in compiled.modelSchema, false);
    assert.equal('definitions' in compiled.modelSchema, false);
    assert.deepEqual(compiled.modelSchema.properties.itemsWithoutSchema, { type: 'array', items: {} });
    assert.equal('items' in compiled.modelSchema.properties.tupleItems, false);
    assert.deepEqual(compiled.modelSchema.properties.$ref, { type: 'string' });
    assert.deepEqual(compiled.modelSchema.properties.filter, {
        type: 'object',
        properties: {
            tags: { type: 'array', items: {} },
            $ref: { type: 'string' }
        }
    });
});
