import assert from 'node:assert/strict';
import test from 'node:test';
import { NEXTMUX_OPEN_SOURCE_MCP_PRESETS } from '../lib/browser/nextmux-open-source-mcp-presets.js';

test('curated open-source MCP presets use their published executable entrypoints', () => {
  const byId = new Map(NEXTMUX_OPEN_SOURCE_MCP_PRESETS.map(preset => [preset.id, preset]));
  const playwright = byId.get('playwright');
  assert.deepEqual(playwright?.configuration, { command: 'npx', args: ['-y', '@playwright/mcp@0.0.80'], nextmuxRuntimePreset: 'playwright' });
  assert.match(playwright?.sourceUrl ?? '', /^https:\/\/github\.com\/microsoft\/playwright-mcp/);

  const chromeDevtools = byId.get('chrome-devtools');
  assert.deepEqual(chromeDevtools?.configuration, {
    command: 'npx', args: ['-y', 'chrome-devtools-mcp@1.9.0', '--no-usage-statistics'], nextmuxRuntimePreset: 'chrome-devtools'
  });
  assert.match(chromeDevtools?.sourceUrl ?? '', /^https:\/\/github\.com\/ChromeDevTools\/chrome-devtools-mcp/);

  const computerUse = byId.get('qwen-computer-use');
  assert.deepEqual(computerUse?.configuration, {
    command: 'npx', args: ['-y', '@qwen-code/open-computer-use@0.2.3', 'mcp'], nextmuxRuntimePreset: 'qwen-computer-use'
  });
  assert.match(computerUse?.sourceUrl ?? '', /^https:\/\/github\.com\/QwenLM\/open-computer-use/);
  assert.equal(byId.has('open-computer-use'), false);

  const windows = byId.get('windows-computer-use');
  assert.deepEqual(windows?.configuration, { command: 'uvx', args: ['windows-mcp', 'serve'], nextmuxRuntimePreset: 'windows-computer-use' });
  assert.deepEqual(windows?.platforms, ['win32']);
  assert.equal(windows?.license, 'MIT');

  const mac = byId.get('macos-automator');
  assert.deepEqual(mac?.configuration, {
    command: 'npx', args: ['-y', '--package', '@steipete/macos-automator-mcp@0.4.7', 'macos-automator-mcp'], nextmuxRuntimePreset: 'macos-automator'
  });
  assert.deepEqual(mac?.platforms, ['darwin']);
  assert.equal(mac?.license, 'MIT');
});
