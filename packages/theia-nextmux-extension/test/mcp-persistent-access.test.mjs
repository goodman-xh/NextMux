import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { AgentToolRegistry } from '@nextmux/agent-runtime';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { McpAccessStore } from '../lib/node/nextmux-mcp-access-store.js';
import { NextMuxMcpServerManager } from '../lib/node/nextmux-mcp-server-manager.js';
import { NEXTMUX_OPEN_SOURCE_MCP_PRESETS, isLegacyBuiltInMcpConfiguration, isHiddenPresetConfiguration } from '../lib/browser/nextmux-open-source-mcp-presets.js';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const fixturePath = fileURLToPath(new URL('./fixtures/mcp-echo-server.mjs', import.meta.url));
const configuration = { name: 'echo-persisted', command: process.execPath, args: [fixturePath], autostart: false };
async function setup(t) {
    const directory = await mkdtemp(join(tmpdir(), 'nextmux-mcp-persist-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    return join(directory, 'approvals.json');
}
async function manager(store, description = configuration) {
    const value = new NextMuxMcpServerManager();
    value.configureAccessStore(store);
    value.credentialStore = { clear: async () => {} };
    const client = { didUpdateMCPServers() {} };
    value.setClient(client);
    await value.addOrUpdateServer(description);
    return { value, client, async close() { value.disconnectClient(client); await value.stopServersAfterDisconnect(); } };
}
async function allow(value) {
    let [state] = await value.accessState();
    [state] = await value.changeAccess({ action: 'start', serverName: state.name, fingerprint: state.fingerprint });
    await value.changeAccess({ action: 'tools', serverName: state.name, fingerprint: state.fingerprint,
        tools: state.tools.map(({ name, fingerprint }) => ({ name, fingerprint })) });
}

test('actual backend process restart restores enabled stdio MCP and selected tools without storing command or credentials', async t => {
    const path = await setup(t);
    const managerModule = new URL('../lib/node/nextmux-mcp-server-manager.js', import.meta.url).href;
    const storeModule = new URL('../lib/node/nextmux-mcp-access-store.js', import.meta.url).href;
    const code = `import {NextMuxMcpServerManager} from ${JSON.stringify(managerModule)};
      import {McpAccessStore} from ${JSON.stringify(storeModule)};
      const store = new McpAccessStore(process.argv[1]); const m = new NextMuxMcpServerManager(); m.configureAccessStore(store);
      const client={didUpdateMCPServers(){}}; m.setClient(client); await m.addOrUpdateServer(${JSON.stringify(configuration)});
      let [s]=await m.accessState();
      if(process.argv[2]==='enable'){[s]=await m.changeAccess({serverName:s.name,fingerprint:s.fingerprint,action:'start'});
        await m.changeAccess({serverName:s.name,fingerprint:s.fingerprint,action:'tools',tools:s.tools.map(({name,fingerprint})=>({name,fingerprint}))});}
      [s]=await m.accessState(); if(!s.running||!s.approved||!s.tools.every(t=>t.approved)) throw Error('NOT_RESTORED');
      const result=await m.callApprovedTool(s.name,'echo','{"text":"restart"}',undefined,{conversationId:'restart'});
      if(result.content[0].text!=='NextMux MCP echo: restart') throw Error('CALL_FAILED');
      m.disconnectClient(client); await m.stopServersAfterDisconnect(); await store.flush(); process.stdout.write('RESTORED_OK');`;
    for (const stage of ['enable', 'restore']) {
        const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code, path, stage], { timeout: 20_000 });
        assert.match(stdout, /RESTORED_OK/);
    }
    const saved = await readFile(path, 'utf8');
    assert.equal(saved.includes(fixturePath), false);
    assert.equal(saved.includes('echo-persisted'), false);
    assert.match(saved, /"echo"/);
});

test('two live connections share enablement without disconnect or workspace changes stealing each other authority', async t => {
    const store = new McpAccessStore(await setup(t));
    const first = await manager(store); const second = await manager(store);
    t.after(async () => { await first.close(); await second.close(); });
    await allow(first.value); await second.value.mutation;
    const before = (await second.value.accessState())[0].fingerprint;
    first.value.setWorkspaceRoots(['file:///one']); second.value.setWorkspaceRoots(['file:///two']);
    await first.close();
    const [state] = await second.value.accessState();
    assert.equal(state.fingerprint, before); assert.equal(state.running, true); assert.equal(state.approved, true);
    assert.equal(state.tools[0].approved, true);
    const result = await second.value.callApprovedTool(state.name, 'echo', '{"text":"second"}', undefined, { conversationId: 'second' });
    assert.equal(result.content[0].text, 'NextMux MCP echo: second');
    const registry = new AgentToolRegistry();
    const platform = Object.create(NextMuxPlatformServiceImpl.prototype); platform.mcpServerManager = second.value;
    await platform.registerMcpTools(registry, 'second');
    const mcpTools = registry.descriptors('full_access').filter(tool => tool.source === 'mcp');
    assert.equal(mcpTools.length, 1);
    for (const permission of ['read_only', 'workspace_write']) {
        assert.deepEqual(registry.descriptors(permission).filter(tool => tool.source === 'mcp'), []);
        const denied = await registry.execute({ id: `denied-${permission}`, name: mcpTools[0].name,
            arguments: { text: 'must not dispatch' } }, permission, { runId: `run-${permission}` });
        assert.equal(denied.ok, false); assert.equal(denied.error.code, 'PERMISSION_DENIED');
    }
    const reopened = await manager(store); t.after(() => reopened.close());
    assert.equal((await reopened.value.accessState())[0].tools[0].approved, true);
    await second.value.stopServer(state.name);
    assert.equal((await reopened.value.accessState())[0].approved, false, 'explicit stop must revoke every connection');
    await store.flush();
    const restarted = await manager(new McpAccessStore(store.path)); t.after(() => restarted.close());
    assert.equal((await restarted.value.accessState())[0].approved, false);
});

test('same-name command changes, deletion and changed tool schemas cannot reuse persisted grants', async t => {
    const store = new McpAccessStore(await setup(t));
    const first = await manager(store); t.after(() => first.close());
    await allow(first.value);
    const other = await manager(store, { ...configuration, args: [...configuration.args, '--different'] }); t.after(() => other.close());
    assert.equal((await other.value.accessState())[0].approved, false);
    assert.equal((await other.value.accessState())[0].running, false);
    const server = first.value.servers.get(configuration.name);
    const original = server.getTools.bind(server);
    server.getTools = async () => ({ tools: (await original()).tools.map(tool => ({ ...tool, description: 'changed capability' })) });
    assert.equal((await first.value.accessState())[0].tools[0].approved, false);
    await assert.rejects(first.value.callTool(configuration.name, 'echo', '{"text":"blocked"}'), /MCP_TOOL_APPROVAL_REQUIRED/);
    await first.value.addOrUpdateServer({ ...configuration, args: [...configuration.args, '--new'] });
    await first.value.addOrUpdateServer(configuration);
    assert.equal((await first.value.accessState())[0].approved, false, 'reverting config must not resurrect revoked approval');
    await allow(first.value);
    await first.value.removeServer(configuration.name);
    const fresh = await manager(new McpAccessStore(store.path)); t.after(() => fresh.close());
    assert.equal((await fresh.value.accessState())[0].approved, false);
});

test('malformed local grants fail closed and stop during initial load cannot resurrect a stored approval', async t => {
    const path = await setup(t);
    await writeFile(path, '{broken');
    const invalid = new McpAccessStore(path);
    await assert.rejects(invalid.ready(), /MCP_APPROVAL_STORE_INVALID/);
    const key = 'a'.repeat(64);
    await writeFile(path, JSON.stringify({ version: 1, approvals: [[key, [['echo', 'b'.repeat(64)]]]] }));
    const store = new McpAccessStore(path);
    const loading = store.ready();
    await store.set(key, undefined, {}); await loading;
    assert.equal(store.get(key), undefined);
    assert.equal((await new McpAccessStore(path).ready()), undefined);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')).approvals, []);
});

test('app-owned templates and unrequested preset duplicates are hidden; deliberately added and changed services remain visible', async () => {
    const source = await readFile(new URL('../src/browser/nextmux-mcp-contribution.ts', import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
    const Base = class { convertToMap(servers) { return new Map(Object.entries(servers).map(([name, config]) => [name, { name, ...config }])); } };
    const exports = {};
    Function('require', 'exports', compiled)(name => name.includes('inversify') ? { injectable: () => value => value }
        : name.includes('open-source-mcp-presets') ? { isHiddenPresetConfiguration } : { McpFrontendApplicationContribution: Base }, exports);
    const contribution = new exports.NextMuxMcpContribution();
    for (const preset of NEXTMUX_OPEN_SOURCE_MCP_PRESETS) {
        const unmarked = { ...preset.configuration, ...preset.fallback, autostart: false };
        // A preset nobody added on purpose duplicates built-in browser/computer control: hidden.
        assert.equal(contribution.convertToMap({ [preset.id]: unmarked }).has(preset.id), false);
        assert.equal(contribution.convertToMap({ [preset.id]: { ...unmarked, nextmuxSource: 'user', nextmuxAddedAt: 1 } }).has(preset.id), true, 'a deliberate add stays visible');
        const legacy = { ...unmarked, nextmuxSource: 'builtin' };
        assert.equal(contribution.convertToMap({ [preset.id]: legacy }).size, 0);
        for (const edited of [{ ...legacy, nextmuxSource: 'user', nextmuxAddedAt: 2 }, { ...legacy, command: 'untrusted-command' }, { ...legacy, env: { EXTRA: 'value' } },
            { ...legacy, args: [...legacy.args, '--other'] }, { ...legacy, autostart: true }]) {
            assert.equal(contribution.convertToMap({ [preset.id]: edited }).has(preset.id), true);
        }
    }
});

test('the real add handler can explicitly replace an invisible legacy template and tags it as a user service', async () => {
    const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const klass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
    const methods = klass.members.filter(node => ts.isMethodDeclaration(node) && ['addMcpServer', 'mcpUserConfiguration'].includes(node.name.getText(ast)));
    const compiled = ts.transpileModule(`class Harness { ${methods.map(node => node.getText(ast)).join('\n')} }; exports.Harness=Harness;`,
        { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const exports = {};
    Function('exports', 'MCP_SERVERS_PREF', 'PreferenceScope', 'isHiddenPresetConfiguration', compiled)(exports, 'mcp', { User: 1 }, isHiddenPresetConfiguration);
    const preset = NEXTMUX_OPEN_SOURCE_MCP_PRESETS[0];
    let settings = { [preset.id]: { ...preset.configuration, ...preset.fallback, autostart: false } };
    const registered = [];
    const value = new exports.Harness();
    value.preferenceService = { get: () => settings, inspect: () => ({ globalValue: settings }), set: async (_key, next) => { settings = next; } };
    value.mcpFrontendService = { hasServer: async () => false, addOrUpdateServer: async entry => { registered.push(entry); } };
    // An unrequested exact preset is hidden (it duplicates built-in control); adding it on purpose replaces it visibly.
    await value.addMcpServer(preset.id, preset.configuration);
    assert.equal(settings[preset.id].nextmuxSource, 'user');
    assert.equal(typeof settings[preset.id].nextmuxAddedAt, 'number');
    assert.equal(isHiddenPresetConfiguration(preset.id, settings[preset.id]), false);
    assert.equal(registered.length, 1);
    registered.length = 0;
    settings = { [preset.id]: { ...preset.configuration, ...preset.fallback, autostart: false, nextmuxSource: 'builtin' } };
    await value.addMcpServer(preset.id, preset.configuration);
    assert.equal(settings[preset.id].nextmuxSource, 'user');
    assert.equal(isLegacyBuiltInMcpConfiguration(preset.id, settings[preset.id]), false);
    assert.equal(registered.length, 1);
    await assert.rejects(value.addMcpServer(preset.id, preset.configuration), /MCP_NAME_EXISTS/);
});
