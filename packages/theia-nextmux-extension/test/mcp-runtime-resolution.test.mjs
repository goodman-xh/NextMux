import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePackagedMcpRuntime, defaultPackagedMcpRuntimeOptions } from '../lib/node/nextmux-mcp-runtime.js';

const base = {
  name: 'playwright', command: 'npx', args: ['-y', '@playwright/mcp@latest'],
  nextmuxRuntimePreset: 'playwright',
};

function fixture({ payload = true, manifest = true, source, args } = {}) {
  const files = new Set(['/app/resources/mcp-runtime/nextmux-mcp-runtime-launcher.cjs']);
  if (payload) files.add('/app/resources/mcp-runtime/runtimes/playwright/server.cjs');
  const reads = new Map([['/app/resources/mcp-runtime/manifest.json', JSON.stringify({ version: 1, runtimes: {
    playwright: { entry: 'runtimes/playwright/server.cjs', platforms: ['darwin'], architectures: ['arm64'], source, args },
  } })]]);
  return {
    packaged: true, platform: 'darwin', architecture: 'arm64', resourcesPath: '/app/resources', execPath: '/app/NextMux',
    exists: value => files.has(value), readFile: value => {
      if (!manifest) throw new Error('missing');
      return reads.get(value);
    },
  };
}

test('packaged curated preset resolves to Electron Node plus immutable payload launcher', () => {
  const result = resolvePackagedMcpRuntime(base, fixture());
  assert.ok('description' in result);
  assert.equal(result.description.command, '/app/NextMux');
  assert.deepEqual(result.description.args, ['/app/resources/mcp-runtime/nextmux-mcp-runtime-launcher.cjs', '--preset', 'playwright']);
  assert.equal(result.description.env.ELECTRON_RUN_AS_NODE, '1');
});

test('packaged preset is unavailable when release payload is absent', () => {
  const result = resolvePackagedMcpRuntime(base, fixture({ payload: false }));
  assert.deepEqual(result, { error: 'MCP_RUNTIME_UNAVAILABLE', detail: 'MCP payload "playwright" is not included in this build.' });
});

test('development leaves user-installed npx command unchanged', () => {
  const result = resolvePackagedMcpRuntime(base, { ...fixture(), packaged: false });
  assert.deepEqual(result, { description: base });
});

test('prepared desktop development resolves the preset with embedded Node, never ambient npx', () => {
  const result = resolvePackagedMcpRuntime(base, { ...fixture(), packaged: false, prepared: true });
  assert.ok('description' in result);
  assert.equal(result.description.command, '/app/NextMux');
  assert.equal(result.description.env.ELECTRON_RUN_AS_NODE, '1');
  assert.deepEqual(result.description.args, ['/app/resources/mcp-runtime/nextmux-mcp-runtime-launcher.cjs', '--preset', 'playwright']);
});

test('prepared development without payload or manifest fails closed without downloading a substitute', () => {
  for (const state of [{ payload: false }, { manifest: false }]) {
    const result = resolvePackagedMcpRuntime(base, { ...fixture(state), packaged: false, prepared: true });
    assert.ok('error' in result);
    assert.equal('description' in result, false);
  }
});

test('prepared development leaves explicit custom commands unchanged even when its preset payload is missing', () => {
  const custom = { name: 'playwright', command: '/custom/node', args: ['/custom/server.mjs'], env: { CUSTOM_OPTION: 'kept' } };
  const result = resolvePackagedMcpRuntime(custom, { ...fixture({ payload: false }), packaged: false, prepared: true });
  assert.equal(result.description, custom);
});

test('development resource selection uses the host prepared tree rather than Electron framework resources', () => {
  const oldPackaged = process.env.NEXTMUX_PACKAGED_RUNTIME, oldResources = process.env.NEXTMUX_RESOURCES_PATH;
  const oldDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
  try {
    Object.defineProperty(process, 'resourcesPath', { value: '/electron/resources', configurable: true });
    process.env.NEXTMUX_PACKAGED_RUNTIME = '0'; process.env.NEXTMUX_RESOURCES_PATH = '/nextmux/build-resources';
    assert.equal(defaultPackagedMcpRuntimeOptions().prepared, true);
    assert.equal(defaultPackagedMcpRuntimeOptions().resourcesPath, '/nextmux/build-resources');
    process.env.NEXTMUX_PACKAGED_RUNTIME = '1';
    assert.equal(defaultPackagedMcpRuntimeOptions().resourcesPath, '/electron/resources');
    process.env.NEXTMUX_PACKAGED_RUNTIME = '0'; delete process.env.NEXTMUX_RESOURCES_PATH;
    assert.equal(defaultPackagedMcpRuntimeOptions().prepared, false);
  } finally {
    if (oldPackaged === undefined) delete process.env.NEXTMUX_PACKAGED_RUNTIME; else process.env.NEXTMUX_PACKAGED_RUNTIME = oldPackaged;
    if (oldResources === undefined) delete process.env.NEXTMUX_RESOURCES_PATH; else process.env.NEXTMUX_RESOURCES_PATH = oldResources;
    if (oldDescriptor) Object.defineProperty(process, 'resourcesPath', oldDescriptor); else delete process.resourcesPath;
  }
});

test('packaged custom commands remain unchanged; only curated presets are rewritten', () => {
  const result = resolvePackagedMcpRuntime({ name: 'custom', command: 'uvx', args: ['x'] }, fixture());
  assert.deepEqual(result, { description: { name: 'custom', command: 'uvx', args: ['x'] } });
});

test('packaged preset preserves upstream browser options and resolves identically on restart', () => {
  const options = fixture({ source: { package: '@playwright/mcp' } });
  const configured = { ...base, args: [...base.args, '--headless', '--isolated', '--browser', 'msedge'] };
  const first = resolvePackagedMcpRuntime(configured, options);
  assert.ok('description' in first);
  assert.deepEqual(first.description.args.slice(3), ['--headless', '--isolated', '--browser', 'msedge']);
  assert.deepEqual(resolvePackagedMcpRuntime(first.description, options), first);
});

test('npx --package syntax removes the package and binary, keeping only upstream CLI options', () => {
  const options = fixture({ source: { package: '@playwright/mcp' } });
  const result = resolvePackagedMcpRuntime({ ...base,
    args: ['-y', '--package', '@playwright/mcp@0.0.80', 'playwright-mcp', '--headless'] }, options);
  assert.deepEqual(result.description.args.slice(3), ['--headless']);
});

test('manifest source arguments supply required Python subcommands without duplication', () => {
  const options = fixture({ source: { package: 'windows-mcp', args: ['serve'] } });
  const result = resolvePackagedMcpRuntime({ ...base, command: 'uvx', args: ['windows-mcp', 'serve'] }, options);
  assert.deepEqual(result.description.args.slice(3), ['serve']);
  assert.deepEqual(resolvePackagedMcpRuntime(result.description, options), result);
});
