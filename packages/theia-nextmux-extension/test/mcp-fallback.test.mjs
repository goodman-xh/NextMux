import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(join(root, 'src/node/nextmux-mcp-fallback.ts'), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const data = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);

const { readMcpFallbackConfig, mcpFallbackCandidates, mcpFallbackErrorRetryable, mcpFallbackToolKey } = data;

test('MCP fallback metadata is opt-in and sanitised', () => {
  assert.deepEqual(readMcpFallbackConfig({ nextmuxFallbackGroup: 'browser', nextmuxFallbackPriority: 2, nextmuxRetrySafeTools: ['tabs', 'tabs', 1, 'bad name'] }), {
    group: 'browser', priority: 2, retrySafeTools: ['tabs']
  });
  assert.deepEqual(readMcpFallbackConfig({ nextmuxFallbackGroup: '../secrets', nextmuxFallbackPriority: 9999, nextmuxRetrySafeTools: [] }), { priority: 1000 });
  assert.deepEqual(readMcpFallbackConfig({}), { priority: 100 });
});

test('MCP fallback keeps primary first and only includes explicitly safe backups', () => {
  const result = mcpFallbackCandidates([
    { serverName: 'backup', toolName: 'tabs', priority: 20, retrySafe: true },
    { serverName: 'primary', toolName: 'tabs', priority: 50, retrySafe: false },
    { serverName: 'unsafe', toolName: 'tabs', priority: 1, retrySafe: false }
  ], 'primary');
  assert.deepEqual(result.map(item => item.serverName), ['primary', 'backup']);
});

test('MCP fallback rejects errors with unknown or visible side effects', () => {
  assert.equal(mcpFallbackErrorRetryable(new Error('MCP_SECURE_TOOL_REQUEST_FAILED')), false);
  assert.equal(mcpFallbackErrorRetryable(new Error('MCP_TOOL_RESULT_STALE')), false);
  assert.equal(mcpFallbackErrorRetryable(new Error('MCP_TOOL_ERROR')), false);
  assert.equal(mcpFallbackErrorRetryable(new Error('MCP_SECURE_CONNECTION_FAILED')), true);
  assert.equal(mcpFallbackErrorRetryable(new Error('provider rejected the operation after execution')), false);
});

test('MCP fallback key separates groups, tools and schemas', () => {
  assert.notEqual(mcpFallbackToolKey('browser', 'tabs', { type: 'object' }), mcpFallbackToolKey('desktop', 'tabs', { type: 'object' }));
  assert.notEqual(mcpFallbackToolKey('browser', 'tabs', { type: 'object' }), mcpFallbackToolKey('browser', 'tabs', { type: 'string' }));
});
