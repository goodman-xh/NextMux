import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { AgentRunner, AgentToolRegistry } from '@nextmux/agent-runtime';

test('MCP and browser tools share one registry across the built-in and ACP model paths', async () => {
  const source = await readFile(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
  const registration = source.search(/await this\.registerMcpTools\(tools,\s*stateConversationId \|\| request\.conversationId\);/);
  const builtin = source.indexOf('new BuiltinAgentBackend({\n            model,\n            tools');
  const acp = source.indexOf('host: createToolRegistryAcpHost({ tools })');
  assert.ok(registration > 0 && builtin > registration, 'MCP registration must happen before the builtin backend is created');
  assert.ok(acp > registration, 'ACP must receive the same registry after MCP registration');
  assert.match(source, /callApprovedTool\(candidate\.serverName, candidate\.toolName, argumentsJson, candidate\.identity, \{ conversationId, runId: context\.runId, signal: context\.signal \}\)/,
    'Conversation ownership and cancellation must originate in the runner context, not model arguments');
  assert.match(source, /!tools\.descriptors\('full_access'\)\.some\(tool => tool\.source === 'mcp'\)/,
    'An ACP run with MCP tools must not escape the scoped registry');
  assert.match(source, /allowedToolNames: request\.toolScope === 'comic-json' \? \[\] : externalUnscoped \? undefined : childContinuation \? taskContext\.allowedToolNames : \[/);
  assert.match(source, /\.\.\.tools\.descriptors\(effectivePermissionMode\)\.map\(tool => tool\.name\)/,
    'Root runs must include registered MCP and browser tool names in their allowed scope');
  assert.match(source, /name: 'browser\.open_external'/);
  assert.match(source, /const groupHasFallback = Boolean\(primary\.group && primary\.fallback\.retrySafe && fallbackPlan\.length > 1\)/);
  assert.match(source, /const attempts = groupHasFallback \? fallbackPlan : \[primary\]/);
  assert.match(source, /advertisedReadOnly/);
  assert.match(source, /mcpFallbackErrorRetryable/);
});

test('a model tool call reaches an MCP-sourced descriptor through the shared registry', async () => {
  const registry = new AgentToolRegistry();
  let calls = 0;
  registry.register({
    name: 'mcp.fixture.browser_tabs',
    description: 'fixture MCP browser tool',
    requiredPermission: 'read_only',
    source: 'mcp',
    executionKind: 'read',
    inputSchema: { type: 'object', additionalProperties: false }
  }, async input => {
    calls += 1;
    assert.deepEqual(input, { action: 'list' });
    return { modelOutput: { tabs: [{ id: 'tab-1' }] }, summary: { title: 'fixture tabs' } };
  });
  let turn = 0;
  const result = await new AgentRunner({
    tools: registry,
    permissionMode: 'read_only',
    model: { async complete() {
      return turn++ === 0
        ? { toolCalls: [{ id: 'fixture-call', name: 'mcp.fixture.browser_tabs', arguments: { action: 'list' } }] }
        : { content: '工具结果已收到' };
    } }
  }).run({ prompt: '列出浏览器标签' });
  assert.equal(calls, 1);
  assert.equal(result.finalText, '工具结果已收到');
  assert.equal(result.toolCalls, 1);
});
