import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const packageRoot = process.env.NEXTMUX_MCP_PATCH_TEST_ROOT ?? dirname(require.resolve('@theia/ai-mcp/package.json'));
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const sentinel = 'fixture-private-value-9fb827a0';
const transportUrl = `https://mcp.example.invalid/private/${sentinel}?api_key=${sentinel}`;
const status = Object.fromEntries(['Running', 'Connected', 'NotRunning', 'NotConnected', 'Starting', 'Connecting', 'AuthenticationRequired', 'Errored'].map(key => [key, key]));

// Execute the installed upstream class, but replace every import and process.env in
// an isolated VM. No SDK subprocess, network, real environment or keychain is used.
function fixture() {
    const logs = []; const connections = []; const terminations = []; const calls = [];
    class UnauthorizedError extends Error {}
    class OAuthError extends Error {}
    class AuthorizationRequiredError extends Error {}
    class AuthorizationServerError extends Error {}
    class CancelledError extends Error {}
    class Emitter { event = () => ({ dispose() {} }); fire() {} }
    class Stdio { constructor(options) { this.options = options; } }
    class Streamable { constructor(url, options) { this.url = url; this.options = options; } async terminateSession() { terminations.push(this); throw new Error(sentinel); } }
    class SSE { constructor(url, options) { this.url = url; this.options = options; } }
    class Client {
        async connect(transport) { connections.push(transport); }
        async close() {}
        async listTools() { throw new Error(sentinel); }
        async callTool(value) { calls.push(value); return { content: [] }; }
    }
    const common = { MCPServerStatus: status, isLocalMCPServerDescription: d => typeof d.command === 'string', isRemoteMCPServerDescription: d => typeof d.serverUrl === 'string' };
    const modules = {
        '@modelcontextprotocol/sdk/client/auth.js': { UnauthorizedError },
        '@modelcontextprotocol/sdk/server/auth/errors.js': { OAuthError },
        '@modelcontextprotocol/sdk/client/stdio.js': { StdioClientTransport: Stdio },
        '@modelcontextprotocol/sdk/client/sse.js': { SSEClientTransport: SSE },
        '@modelcontextprotocol/sdk/client/streamableHttp.js': { StreamableHTTPClientTransport: Streamable },
        '@modelcontextprotocol/sdk/client/index.js': { Client },
        '@modelcontextprotocol/sdk/shared/auth-utils.js': {},
        '@modelcontextprotocol/sdk/types.js': {},
        '@theia/core/lib/common/event.js': { Emitter },
        '@theia/core/lib/common/nls': { nls: { localize: (_, message) => message } },
        '@theia/core/shared/inversify': { inject: () => () => {}, injectable: () => value => value },
        '@theia/core': {},
        tslib: { __decorate: (_, target) => target, __metadata: () => () => {} },
        '../common': common, '../common/mcp-server-manager': common,
        './mcp-oauth-errors': { MCPOAuthAuthorizationRequiredError: AuthorizationRequiredError, MCPOAuthAuthorizationServerError: AuthorizationServerError },
        './mcp-oauth-callback-service': { MCPOAuthCancelledError: CancelledError },
        './mcp-oauth-client-provider-factory': {}, './mcp-oauth-credential-store': {},
        './mcp-oauth-keystore': { normalizeOAuthUrl: value => new URL(value).toString(), mcpOAuthAccountPrefix: () => 'fixture-only', MCP_OAUTH_KEYSTORE_SERVICE: 'fixture-only' }
    };
    function load(name) {
        const exports = {};
        vm.runInNewContext(readFileSync(join(packageRoot, 'lib/node', `${name}.js`), 'utf8'), {
            exports, URL, Error, console: Object.fromEntries(['log', 'warn', 'error', 'debug'].map(level => [level, (...args) => logs.push({ level, args })])),
            process: { env: { FIXTURE_ENV: sentinel } },
            require(id) { assert.ok(id in modules, `Unexpected upstream dependency: ${id}`); return modules[id]; }
        }, { filename: `upstream-${name}.js` });
        return exports;
    }
    const { MCPServer } = load('mcp-server'); modules['./mcp-server'] = { MCPServer };
    const { MCPServerManagerImpl } = load('mcp-server-manager-impl');
    const { MCPOAuthClientProvider } = load('mcp-oauth-client-provider');
    function assertSafe() {
        assert.ok(logs.length > 0);
        for (const { args } of logs) {
            assert.equal(args.length, 1, 'No raw diagnostic object may accompany the status message');
            assert.equal(typeof args[0], 'string');
            assert.equal(args[0].includes(sentinel), false);
            assert.equal(args[0].includes('https://'), false);
        }
    }
    return { logs, connections, terminations, calls, MCPServer, MCPServerManagerImpl, MCPOAuthClientProvider, UnauthorizedError, assertSafe };
}

test('installed pinned package patch applies cleanly, and touches only six paired diagnostic sources', () => {
    assert.equal(JSON.parse(readFileSync(join(packageRoot, 'package.json'))).version, '1.74.1');
    const workspace = readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8');
    const entry = workspace.match(/['"]?@theia\/ai-mcp@1\.74\.1['"]?:\s*(patches\/[^\s]+\.patch)/);
    assert.ok(entry, 'Version-locked patch must be wired through pnpm');
    const patchPath = resolve(repoRoot, entry[1]); const patch = readFileSync(patchPath, 'utf8');
    const files = [...patch.matchAll(/^diff --git a\/(\S+) b\/\1$/gm)].map(match => match[1]);
    assert.deepEqual(files.sort(), ['lib/node/mcp-oauth-client-provider.js', 'lib/node/mcp-server-manager-impl.js', 'lib/node/mcp-server.js',
        'src/node/mcp-oauth-client-provider.ts', 'src/node/mcp-server-manager-impl.ts', 'src/node/mcp-server.ts'].sort());
    const scratch = mkdtempSync(join(tmpdir(), 'nextmux-mcp-patch-check-'));
    try {
        for (const file of files) { const destination = join(scratch, file); mkdirSync(dirname(destination), { recursive: true }); cpSync(join(packageRoot, file), destination); }
        execFileSync('git', ['apply', '--reverse', '--check', patchPath], { cwd: scratch });
        execFileSync('git', ['apply', '--reverse', patchPath], { cwd: scratch });
        execFileSync('git', ['apply', '--check', patchPath], { cwd: scratch });
        execFileSync('git', ['apply', patchPath], { cwd: scratch });
        for (const file of files) assert.equal(readFileSync(join(scratch, file), 'utf8'), readFileSync(join(packageRoot, file), 'utf8'));
    } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test('actual upstream local startup forwards synthetic config but never logs command, args, env or tool input', async () => {
    const f = fixture(); const server = new f.MCPServer({ name: 'fixture-local', command: `fixture-command-${sentinel}`, args: [sentinel], env: { FIXTURE: sentinel } });
    await server.start(); assert.equal(server.getStatus(), status.Running);
    assert.equal(f.connections[0].options.args[0], sentinel);
    assert.equal(f.connections[0].options.env.FIXTURE_ENV, sentinel);
    await server.getDescription(); // Raw failed listTools error must not be logged.
    await server.callTool('fixture-tool', `${sentinel}{`);
    assert.equal(f.calls.length, 1, 'Diagnostic patch preserves upstream call semantics');
    server.handleSteadyStateError(new Error(sentinel), `prefix-${sentinel}`);
    assert.equal(server.getStatus(), status.Errored);
    await server.stop(); assert.equal(server.getStatus(), status.NotRunning);
    f.assertSafe();
});

test('actual remote success and cleanup omit endpoint/query and raw termination errors', async () => {
    const f = fixture(); const server = new f.MCPServer({ name: 'fixture-remote', serverUrl: transportUrl, serverAuthToken: sentinel });
    await server.start(); assert.equal(server.getStatus(), status.Connected);
    assert.equal(String(f.connections[0].url), transportUrl);
    assert.equal(f.connections[0].options.requestInit.headers.Authorization, `Bearer ${sentinel}`);
    await server.stop(); assert.equal(server.getStatus(), status.NotConnected);
    assert.equal(f.terminations.length, 1); f.assertSafe();
});

test('actual Streamable-to-SSE fallback retains its behavior but never logs the upstream error', async () => {
    const f = fixture(); const server = new f.MCPServer({ name: 'fixture-fallback', serverUrl: transportUrl });
    let count = 0; const connect = server.connectTransport.bind(server);
    server.connectTransport = async (...args) => { if (++count === 1) throw new Error(sentinel); return connect(...args); };
    await server.start(); assert.equal(server.getStatus(), status.Connected);
    assert.equal(count, 2); assert.equal(f.terminations.length, 1);
    server.client.close = async () => { throw new Error(sentinel); };
    server.handleSteadyStateError(new f.UnauthorizedError(sentinel), 'auth');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(server.getStatus(), status.AuthenticationRequired); f.assertSafe();
});

test('actual manager sign-out/removal/disconnect notification failures log no raw causes', async () => {
    const f = fixture(); const manager = new f.MCPServerManagerImpl(); let cleared = 0;
    manager.credentialStore = { async clear() { cleared++; } };
    manager.client = { didUpdateMCPServers() { throw new Error(sentinel); } };
    const server = { isStopped: () => false, async stop() { throw new Error(sentinel); } };
    manager.servers.set('fixture', server);
    await manager.signOut('fixture'); assert.equal(cleared, 1);
    await manager.stopServersAfterDisconnect();
    await manager.removeServer('fixture'); assert.equal(manager.servers.size, 0);
    manager.stopServersAfterDisconnect = async () => { throw new Error(sentinel); };
    manager.disconnectClient(manager.client);
    await new Promise(resolve => setImmediate(resolve)); f.assertSafe();
});

test('actual OAuth diagnostic failures omit authorization URLs and corrupt synthetic token JSON', async () => {
    const f = fixture(); const deleted = [];
    const provider = new f.MCPOAuthClientProvider({ serverName: 'fixture-oauth', config: { authorizationServer: transportUrl },
        credentialScope: 'fixture', interactive: true, keyStore: {
            async getPassword() { return `{"access_token":"${sentinel}" invalid}`; },
            async deletePassword(service, account) { deleted.push({ service, account }); }
        }, frontendDelegate: { async openExternal() { throw new Error(sentinel); } } });
    await assert.rejects(provider.redirectToAuthorization(new URL(transportUrl)));
    assert.equal(await provider.read('tokens'), undefined); assert.equal(deleted.length, 1);
    provider.read = async () => ({ authorizationServerUrl: `${transportUrl}&different=1` });
    assert.equal(await provider.discoveryState(), undefined); f.assertSafe();
});
