import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { NextMuxMcpServer } from '../lib/node/nextmux-mcp-server.js';
import { NextMuxMcpServerManager } from '../lib/node/nextmux-mcp-server-manager.js';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { MCPServerStatus } = createRequire(import.meta.url)('@theia/ai-mcp/lib/common/mcp-server-manager');
const definition = name => ({ name, inputSchema: { type: 'object' } });
function connected() {
  const server = new NextMuxMcpServer({ name: 'fixture', command: 'never-spawned', autostart: false }, {}, {}, () => () => {});
  server.setStatus(MCPServerStatus.Running);
  return server;
}

test('tools/list consumes cursors and refuses a repeated cursor instead of looping', async () => {
  const server = connected();
  const calls = [];
  server.client = { listTools: async params => {
    calls.push(params?.cursor);
    return params?.cursor ? { tools: [definition('second')] } : { tools: [definition('first')], nextCursor: 'page-2' };
  } };
  assert.deepEqual((await server.getTools()).tools.map(tool => tool.name), ['first', 'second']);
  assert.deepEqual(calls, [undefined, 'page-2']);
  server.client.listTools = async () => ({ tools: [], nextCursor: 'same-page' });
  await assert.rejects(server.getTools(), /MCP_TOOL_LIST_CURSOR_REPEATED/);
});

test('cancellation reaches the SDK request and is not rewritten as a server failure', async () => {
  const server = connected(); const controller = new AbortController();
  let signal;
  server.client = { callTool: async (_request, _schema, options) => new Promise((_resolve, reject) => {
    signal = options.signal;
    signal.addEventListener('abort', () => reject(new Error('transport closed')), { once: true });
  }) };
  const call = server.callTool('read', '{}', controller.signal);
  // The SDK request carries a composite signal (call deadline + caller + server stop) so every stop
  // reason cancels it; the caller's abort must still reach that request.
  assert.notEqual(signal, controller.signal);
  assert.equal(signal.aborted, false);
  const reached = new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
  controller.abort();
  await reached;
  assert.equal(signal.reason.name, 'AbortError');
  await assert.rejects(call, { name: 'AbortError' });
  await assert.rejects(server.getTools(controller.signal), { name: 'AbortError' });
});

test('a resolved failed handshake is classified and never reported as ready', async () => {
  const manager = new NextMuxMcpServerManager(); const server = connected();
  server.setStatus(MCPServerStatus.NotRunning);
  server.start = async () => { server.error = 'spawn /private/token-secret ENOENT'; server.setStatus(MCPServerStatus.Errored); };
  manager.servers.set('fixture', server);
  const [before] = await manager.accessState();
  await assert.rejects(manager.changeAccess({ action: 'start', serverName: 'fixture', fingerprint: before.fingerprint }), /MCP_START_FAILED_RUNTIME_MISSING/);
  const [after] = await manager.accessState();
  assert.equal(after.running, false); assert.equal(after.approved, true, 'connection failure must not erase the user enable choice');
  assert.equal(after.diagnostic, 'dependency');
  assert.deepEqual(after.failure, { stage: 'startup', code: 'runtime_missing' });
  assert.equal(JSON.stringify(after).includes('token-secret'), false);
});

test('stopping during initialize closes the transport without awaiting initialize timeout', async () => {
  const manager = new NextMuxMcpServerManager(); const server = connected();
  server.setStatus(MCPServerStatus.NotRunning);
  let started; const inStartup = new Promise(resolve => { started = resolve; });
  let close; server.start = () => { server.setStatus(MCPServerStatus.Starting); started(); return new Promise(resolve => { close = resolve; }); };
  let stopped = 0;
  server.stop = async () => { stopped++; server.setStatus(MCPServerStatus.NotRunning); close?.(); };
  manager.servers.set('fixture', server);
  const [before] = await manager.accessState();
  const starting = manager.changeAccess({ action: 'start', serverName: 'fixture', fingerprint: before.fingerprint });
  await inStartup;
  const stopping = manager.changeAccess({ action: 'revoke', serverName: 'fixture', fingerprint: before.fingerprint });
  assert.ok(stopped > 0, 'Stop must reach the initializing transport immediately');
  await assert.rejects(starting, /MCP_APPROVAL_STALE/);
  const [after] = await stopping;
  assert.equal(after.approved, false); assert.equal(after.diagnostic, 'authorization');
  assert.equal(after.failure, undefined);
});

test('transport close updates lifecycle while deliberate stop and old clients cannot overwrite a replacement', async () => {
  const server = connected();
  server.transport = {};
  const firstTransport = server.transport;
  const first = { close: async () => first.onclose?.() }; server.client = first;
  server.configureErrorHandlers();
  first.onclose();
  assert.equal(server.getCachedDescription().status, MCPServerStatus.Errored);
  assert.equal(server.getCachedDescription().error, 'MCP_CONNECTION_CLOSED');
  const manager = new NextMuxMcpServerManager(); manager.servers.set('fixture', server);
  const [before] = await manager.accessState();
  manager.grants.set('fixture', { fingerprint: before.fingerprint, tools: new Map() });
  const [failed] = await manager.accessState();
  assert.deepEqual(failed.failure, { stage: 'connection', code: 'process_exit' });
  const second = { close: async () => second.onclose?.() }; server.client = second;
  server.transport = {};
  server.configureErrorHandlers(); server.setStatus(MCPServerStatus.Running);
  first.onclose();
  first.onerror(new Error('old client failure'));
  firstTransport.onerror(new Error('old transport failure'));
  assert.equal(server.isRunning(), true);
  await server.stop();
  assert.equal(server.getCachedDescription().status, MCPServerStatus.NotRunning);
});

test('late stop and tools/list rejection cannot overwrite a replacement connection', async () => {
  const server = connected();
  let closeOld; let rejectList;
  const first = { close: () => new Promise(resolve => { closeOld = resolve; }),
    listTools: () => new Promise((_resolve, reject) => { rejectList = reject; }) };
  server.client = first;
  const oldList = server.getTools();
  const stopping = server.stop();
  server.client = { listTools: async () => ({ tools: [definition('replacement')] }) };
  server.setStatus(MCPServerStatus.Running);
  rejectList(new Error('late tools/list failure'));
  await assert.rejects(oldList, /late tools\/list failure/);
  closeOld(); await stopping;
  assert.equal(server.isRunning(), true);
  assert.equal(server.failureEvidence(), undefined);
  assert.deepEqual((await server.getTools()).tools.map(tool => tool.name), ['replacement']);
});

test('real local stdio MCP lifecycle reports initialize, tools/list, call and stop', async t => {
  const serverPath = fileURLToPath(new URL('./fixtures/mcp-echo-server.mjs', import.meta.url));
  const manager = new NextMuxMcpServerManager();
  const server = new NextMuxMcpServer({ name: 'echo-real', command: process.execPath, args: [serverPath], autostart: false }, {}, {}, () => () => {});
  manager.servers.set('echo-real', server);
  t.after(async () => { await manager.stopServer('echo-real').catch(() => undefined); });
  let [state] = await manager.accessState();
  state = (await manager.changeAccess({ serverName: 'echo-real', fingerprint: state.fingerprint, action: 'start' }))[0];
  assert.equal(state.running, true);
  assert.equal(state.status, MCPServerStatus.Running);
  assert.deepEqual(state.tools.map(tool => tool.name), ['echo']);
  state = (await manager.changeAccess({ serverName: 'echo-real', fingerprint: state.fingerprint, action: 'tools', tools: state.tools.map(tool => ({ name: tool.name, fingerprint: tool.fingerprint })) }))[0];
  assert.equal(state.diagnostic, 'ready');
  for (const conversationId of ['conversation-a', 'conversation-b']) {
    const result = await manager.callApprovedTool('echo-real', 'echo', JSON.stringify({ text: conversationId }), undefined, { conversationId });
    assert.equal(result.content[0].text, `NextMux MCP echo: ${conversationId}`);
  }
  await manager.stopServer('echo-real');
  [state] = await manager.accessState();
  assert.equal(state.running, false);
  assert.equal(state.diagnostic, 'authorization');
  assert.equal(state.failure, undefined);
  await assert.rejects(manager.callApprovedTool('echo-real', 'echo', '{"text":"after stop"}', undefined,
    { conversationId: 'conversation-b' }), /MCP_START_APPROVAL_REQUIRED/);
});

test('real local stdio startup exposes a redacted process exit diagnostic', async () => {
  const manager = new NextMuxMcpServerManager();
  const server = new NextMuxMcpServer({ name: 'exit-real', command: process.execPath,
    args: ['-e', "process.stderr.write('token=fixture-secret /Users/private/file.js\\nAuthorization: Bearer fixture-bearer-secret\\nCookie: session=fixture-cookie; other=fixture-other\\n{\"access_token\":\"fixture-access-token\"}\\n'); process.exit(42)"], autostart: false }, {}, {}, () => () => {});
  manager.servers.set('exit-real', server);
  let [state] = await manager.accessState();
  await assert.rejects(manager.changeAccess({ serverName: 'exit-real', fingerprint: state.fingerprint, action: 'start' }), /MCP_START_FAILED_(?:PROCESS_EXIT|CONNECTION)/);
  [state] = await manager.accessState();
  assert.equal(state.running, false);
  assert.equal(state.failure?.stage, 'startup');
  assert.equal(state.failure?.exitCode, 42);
  assert.doesNotMatch(JSON.stringify(state), /fixture-(?:secret|bearer-secret|cookie|other|access-token)|\/Users\/private/);
});

test('real initialized stdio process exit is a connection failure, not a startup failure', async t => {
  const serverPath = fileURLToPath(new URL('./fixtures/mcp-echo-server.mjs', import.meta.url));
  const manager = new NextMuxMcpServerManager();
  const server = new NextMuxMcpServer({ name: 'exit-connected', command: process.execPath, args: [serverPath], autostart: false }, {}, {}, () => () => {});
  manager.servers.set('exit-connected', server);
  t.after(() => server.stop());
  const [before] = await manager.accessState();
  const [ready] = await manager.changeAccess({ serverName: 'exit-connected', fingerprint: before.fingerprint, action: 'start' });
  assert.equal(ready.running, true);
  assert.deepEqual(ready.tools.map(tool => tool.name), ['echo']);
  const child = server.transport._process;
  const closed = once(child, 'close');
  child.kill('SIGTERM');
  await closed;
  const [after] = await manager.accessState();
  assert.equal(after.running, false);
  assert.equal(after.failure?.stage, 'connection');
  assert.equal(after.failure?.code, 'process_exit');
  assert.equal(after.failure?.signal, 'SIGTERM');
});

test('real tools/list rejection reports discovery failure with no usable tools', async t => {
  const serverPath = fileURLToPath(new URL('./fixtures/mcp-echo-server.mjs', import.meta.url));
  const manager = new NextMuxMcpServerManager();
  const server = new NextMuxMcpServer({ name: 'list-failed', command: process.execPath, args: [serverPath, '--fail-tools-list'], autostart: false }, {}, {}, () => () => {});
  manager.servers.set('list-failed', server);
  t.after(() => server.stop());
  const [before] = await manager.accessState();
  const [state] = await manager.changeAccess({ serverName: 'list-failed', fingerprint: before.fingerprint, action: 'start' });
  assert.equal(state.running, false);
  assert.equal(state.status, MCPServerStatus.Errored);
  assert.equal(state.failure?.stage, 'tools');
  assert.notEqual(state.diagnostic, 'ready');
  assert.deepEqual(state.tools, []);
  await assert.rejects(manager.callApprovedTool('list-failed', 'echo', '{"text":"must not run"}'), /MCP_TOOL_APPROVAL_REQUIRED/);
  const failedChild = server.transport._process;
  assert.equal(failedChild.exitCode, null, 'A discovery failure need not terminate the child');
  const closed = once(failedChild, 'close');
  await server.start();
  await closed;
  assert.notEqual(server.transport._process.pid, failedChild.pid);
  assert.equal(server.isRunning(), true, 'The replacement handshake can finish before discovery is retried');
});

test('tools/list is cached per running client and invalidated on ToolListChanged, and callTool enforces timeout and head+tail truncation', async () => {
  const server = connected();
  let listCalls = 0;
  const listToolsFn = async () => {
    listCalls++;
    return { tools: [definition('cached-tool')] };
  };
  server.client = {
    listTools: listToolsFn,
    callTool: async (_req, _schema, _options) => ({
      content: [{ type: 'text', text: 'START_' + 'x'.repeat(50_000) + 'y'.repeat(20_000) + '_END' }]
    })
  };
  const first = await server.getTools();
  const second = await server.getTools();
  assert.equal(listCalls, 1);
  assert.deepEqual(first.tools.map(t => t.name), ['cached-tool']);
  assert.deepEqual(second.tools.map(t => t.name), ['cached-tool']);

  const callResult = await server.callTool('cached-tool', '{}');
  assert.ok(callResult.content[0].text.startsWith('START_'));
  assert.ok(callResult.content[0].text.endsWith('_END'));
  assert.match(callResult.content[0].text, /\[truncated:/);

  server.callTimeoutMs = () => 50;
  server.client.callTool = async (_req, _schema, options) => new Promise((_resolve, reject) => {
    options.signal?.addEventListener('abort', () => reject(options.signal.reason || new Error('timed out')), { once: true });
  });
  await assert.rejects(server.callTool('cached-tool', '{}'), /MCP tools\/call timed out/);
});
