import { AgentToolRegistry } from '../packages/agent-runtime/lib/index.js';
import { NextMuxPlatformServiceImpl } from '../packages/theia-nextmux-extension/lib/node/nextmux-platform-service.js';
import { NextMuxMcpServerManager } from '../packages/theia-nextmux-extension/lib/node/nextmux-mcp-server-manager.js';

/** Run the same approval -> registry -> tool path used by a model turn. */
class LiveService extends NextMuxPlatformServiceImpl {
  exposeMcpTools(registry) { return this.registerMcpTools(registry); }
}

const checks = [
  { id: 'playwright-live', label: 'Playwright MCP', args: ['-y', '@playwright/mcp@latest'], tool: 'browser_tabs', input: { action: 'list' } },
  { id: 'chrome-devtools-live', label: 'Chrome DevTools MCP', args: ['-y', 'chrome-devtools-mcp@latest', '--no-usage-statistics'], tool: 'list_pages', input: {} },
  { id: 'qwen-computer-live', label: 'Qwen Computer Use', command: 'npx', args: ['-y', '@qwen-code/open-computer-use', 'mcp'], tool: 'list_apps', input: {} }
];
if (process.platform === 'darwin') checks.push({
  id: 'macos-automator-live', label: 'macOS Automator MCP', command: 'npx',
  args: ['-y', '--package', '@steipete/macos-automator-mcp', 'macos-automator-mcp'],
  tool: 'get_scripting_tips', input: { search_term: 'open an application', limit: 2 }
});
if (process.platform === 'win32') checks.push({
  id: 'windows-computer-live', label: 'Windows-MCP', command: 'uvx',
  args: ['windows-mcp', 'serve'], tool: 'get_windows_info', input: {}
});

for (const check of checks) {
  const manager = new NextMuxMcpServerManager();
  try {
    await manager.addOrUpdateServer({ name: check.id, command: check.command || 'npx', args: check.args, autostart: false });
    let [state] = await manager.accessState();
    await manager.changeAccess({ serverName: check.id, fingerprint: state.fingerprint, action: 'start' });
    [state] = await manager.accessState();
    await manager.changeAccess({
      serverName: check.id,
      fingerprint: state.fingerprint,
      action: 'tools',
      tools: state.tools.filter(tool => tool.supported).map(tool => ({ name: tool.name, fingerprint: tool.fingerprint }))
    });
    const service = new LiveService();
    service.mcpServerManager = manager;
    const registry = new AgentToolRegistry();
    await service.exposeMcpTools(registry);
    const descriptor = registry.descriptors('full_access').find(item => item.name.endsWith(`.${check.tool}`));
    if (!descriptor) throw new Error(`tool not registered: ${check.tool}`);
    const result = await registry.execute({ id: `live-${check.id}`, name: descriptor.name, arguments: check.input }, 'full_access', {
      runId: 'mcp-live-verification', executionScopeId: check.id
    });
    if (!result.ok) throw new Error(`tool call failed: ${JSON.stringify(result.error)}`);
    console.log(JSON.stringify({ label: check.label, tool: descriptor.name, ok: true }));
  } catch (error) {
    console.error(JSON.stringify({ label: check.label, ok: false, error: String(error?.message || error) }));
    process.exitCode = 1;
  } finally {
    try { await manager.stopServer(check.id); } catch { /* already stopped */ }
  }
}
