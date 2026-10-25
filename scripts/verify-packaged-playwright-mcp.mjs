#!/usr/bin/env node
/** Real release-payload check; no model API, external page or user browser profile is used. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { NextMuxMcpServerManager } from '../packages/theia-nextmux-extension/lib/node/nextmux-mcp-server-manager.js';

const root = fileURLToPath(new URL('../', import.meta.url));
process.env.NEXTMUX_PACKAGED_RUNTIME = '1';
process.env.NEXTMUX_RESOURCES_PATH ||= resolve(root, 'apps/desktop/build-resources');
// The verifier points Electron's real embedded Node at the exact release-input
// resources without writing into or repackaging the developer's Electron.app.
if (process.versions.electron) Object.defineProperty(process, 'resourcesPath', { value: process.env.NEXTMUX_RESOURCES_PATH, configurable: true });
const manager = new NextMuxMcpServerManager();
const serverName = 'nextmux-release-playwright-check';
const outputDir = await mkdtemp(resolve(tmpdir(), 'nextmux-playwright-check-'));
let slowNavigation;
const fixture = createServer((request, response) => {
  if (request.url === '/slow') { slowNavigation?.(); return; }
  const session = request.url === '/b' ? 'Session B' : 'Session A';
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(`<!doctype html><html><head><title>NextMux MCP fixture ${session}</title></head><body><h1>${session}</h1><button onclick="this.textContent='Confirmed'">Confirm tool call</button></body></html>`);
});
const deadline = setTimeout(() => { console.error('Playwright MCP verification exceeded 90 seconds.'); process.exitCode = 1; void manager.stopServer(serverName); fixture.close(); }, 90_000);
const summary = { platform: process.platform, architecture: process.arch, electron: process.versions.electron || null,
  runtime: 'release-payload', rounds: [] };
try {
  fixture.listen(0, '127.0.0.1');
  await once(fixture, 'listening');
  await manager.addOrUpdateServer({ name: serverName, command: 'npx', args: ['-y', '@playwright/mcp@0.0.80'],
    nextmuxRuntimePreset: 'playwright', autostart: false,
    env: { PLAYWRIGHT_MCP_HEADLESS: 'true', PLAYWRIGHT_MCP_ISOLATED: 'true', PLAYWRIGHT_MCP_OUTPUT_DIR: outputDir } });
  for (let round = 1; round <= 2; round++) {
    let [state] = await manager.accessState();
    [state] = await manager.changeAccess({ serverName, fingerprint: state.fingerprint, action: 'start' });
    assert.equal(state.running, true, JSON.stringify(state));
    const required = ['browser_navigate', 'browser_click', 'browser_snapshot', 'browser_close'];
    for (const name of required) assert.ok(state.tools.some(tool => tool.name === name && tool.supported), `${name} missing or unsupported`);
    const toolCount = state.tools.length;
    [state] = await manager.changeAccess({ serverName, fingerprint: state.fingerprint, action: 'tools',
      tools: state.tools.filter(tool => required.includes(tool.name)).map(({ name, fingerprint }) => ({ name, fingerprint })) });
    const call = async (name, args, conversationId = 'mcp-release-a', signal) => {
      const result = await manager.callApprovedTool(serverName, name, JSON.stringify(args), undefined,
        { conversationId, runId: `round-${round}`, signal });
      assert.notEqual(result.isError, true, JSON.stringify(result));
      return result.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
    };
    await call('browser_navigate', { url: `http://127.0.0.1:${fixture.address().port}/` });
    const navigation = await call('browser_snapshot', {});
    const button = navigation.match(/button "Confirm tool call" \[ref=([^\]]+)\]/);
    assert.ok(button, navigation);
    await call('browser_click', { target: button[1], element: 'Confirm tool call button' });
    const snapshot = await call('browser_snapshot', {});
    assert.match(snapshot, /button "Confirmed"/);
    const base = `http://127.0.0.1:${fixture.address().port}`;
    await call('browser_navigate', { url: `${base}/b` }, 'mcp-release-b');
    assert.match(await call('browser_snapshot', {}, 'mcp-release-b'), /Session B/);
    assert.match(await call('browser_snapshot', {}), /Session A/);
    assert.doesNotMatch(await call('browser_snapshot', {}), /Session B/);
    await manager.releaseConversationSessions('mcp-release-b');
    assert.match(await call('browser_snapshot', {}), /Session A/);

    // Cancel only after the independent local server observes a real dispatched
    // browser navigation. A pre-aborted signal would not exercise MCP cancellation.
    const controller = new AbortController();
    const reached = new Promise(resolveReached => { slowNavigation = resolveReached; });
    const pending = call('browser_navigate', { url: `${base}/slow` }, 'mcp-release-a', controller.signal);
    const cancelled = assert.rejects(pending, { name: 'AbortError' });
    let reachTimeout;
    try {
      await Promise.race([reached, new Promise((_, reject) => { reachTimeout = setTimeout(() => reject(Error('Navigation never reached the fixture')), 15_000); })]);
      controller.abort();
      await cancelled;
    } finally { clearTimeout(reachTimeout); slowNavigation = undefined; controller.abort(); }
    await manager.releaseConversationSessions('mcp-release-a');
    await call('browser_navigate', { url: `${base}/` });
    assert.match(await call('browser_snapshot', {}), /Session A/);

    // Close the real SDK transport, retaining authorization. The next call must
    // initialize a fresh conversation client rather than reuse a dead transport.
    const sessionKey = `${serverName}\0mcp-release-a`;
    const previousSession = manager.browserSessions.get(sessionKey);
    assert.ok(previousSession?.server.client);
    await previousSession.server.client.close();
    await call('browser_navigate', { url: `${base}/` });
    assert.notEqual(manager.browserSessions.get(sessionKey), previousSession);
    assert.match(await call('browser_snapshot', {}), /Session A/);
    await call('browser_close', {});
    await manager.stopServer(serverName);
    [state] = await manager.accessState();
    assert.equal(state.running, false);
    await assert.rejects(manager.callTool(serverName, 'browser_snapshot', '{}'), /MCP_START_APPROVAL_REQUIRED/);
    summary.rounds.push({ round, tools: toolCount, initialize: true, list: true, navigate: true, click: true,
      snapshot: true, conversationIsolation: true, cancelAfterDispatch: true, reconnect: true, stopped: true });
  }
  console.log(JSON.stringify({ ...summary, passed: true }, null, 2));
} finally {
  clearTimeout(deadline);
  await manager.stopServer(serverName).catch(() => {});
  fixture.closeAllConnections();
  await new Promise(resolveClose => fixture.close(resolveClose));
  await rm(outputDir, { recursive: true, force: true });
}
