import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('MCP QA fixture exposes a bounded echo tool over stdio', async t => {
  const serverPath = fileURLToPath(new URL('./fixtures/mcp-echo-server.mjs', import.meta.url));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    stderr: 'pipe',
  });
  const client = new Client({ name: 'nextmux-test-client', version: '1.0.0' });
  t.after(async () => {
    await client.close();
  });
  await client.connect(transport);
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map(tool => tool.name), ['echo']);
  const result = await client.callTool({ name: 'echo', arguments: { text: 'bridge verified' } });
  assert.equal(result.isError, undefined);
  assert.equal(result.content[0].type, 'text');
  assert.equal(result.content[0].text, 'NextMux MCP echo: bridge verified');
});
