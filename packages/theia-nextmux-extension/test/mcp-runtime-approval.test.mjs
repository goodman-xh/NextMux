import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { NextMuxMcpServerManager } from '../lib/node/nextmux-mcp-server-manager.js';
import { NextMuxMcpServer } from '../lib/node/nextmux-mcp-server.js';

const { MCPServerStatus } = createRequire(import.meta.url)('@theia/ai-mcp/lib/common/mcp-server-manager');

for (const packaged of [true, false]) test(`${packaged ? 'packaged' : 'prepared development'} MCP runtime rewrite does not revoke the approval made from the user locator`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-mcp-approval-'));
  t.after(async () => {
    delete process.env.NEXTMUX_PACKAGED_RUNTIME;
    delete process.env.NEXTMUX_RESOURCES_PATH;
    await rm(root, { recursive: true, force: true });
  });
  const runtimeRoot = join(root, 'mcp-runtime');
  await mkdir(join(runtimeRoot, 'runtimes', 'fixture'), { recursive: true });
  await writeFile(join(runtimeRoot, 'manifest.json'), JSON.stringify({ version: 1, runtimes: {
    fixture: { entry: 'runtimes/fixture/server.cjs', platforms: [process.platform], architectures: [process.arch] }
  }}));
  await writeFile(join(runtimeRoot, 'nextmux-mcp-runtime-launcher.cjs'), '');
  await writeFile(join(runtimeRoot, 'runtimes', 'fixture', 'server.cjs'), '');
  process.env.NEXTMUX_PACKAGED_RUNTIME = packaged ? '1' : '0';
  process.env.NEXTMUX_RESOURCES_PATH = root;

  const original = { name: 'fixture', command: 'npx', args: ['fixture'], nextmuxRuntimePreset: 'fixture', autostart: false };
  const manager = new NextMuxMcpServerManager();
  const server = new NextMuxMcpServer(original, {}, { version: () => undefined }, () => () => {});
  // Model the packaged startup path: the transport receives the effective
  // Electron launcher description after the grant was created from `original`.
  const effective = server.approvalDescription();
  let running = false;
  server.start = async () => {
    server.update(effective, false);
    server.setStatus(MCPServerStatus.Running);
    running = true;
  };
  server.stop = async () => { running = false; server.setStatus(MCPServerStatus.NotRunning); };
  server.isRunning = () => running;
  server.getTools = async () => ({ tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object' } }] });
  manager.servers.set('fixture', server);

  let [state] = await manager.accessState();
  const after = await manager.changeAccess({ serverName: 'fixture', fingerprint: state.fingerprint, action: 'start' });
  state = after[0];
  assert.equal(state.running, true);
  assert.equal(state.approved, true);
  assert.equal(state.diagnostic, 'tools');
  assert.equal(state.status, MCPServerStatus.Running);
});
