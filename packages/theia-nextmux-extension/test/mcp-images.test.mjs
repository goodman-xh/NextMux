import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentToolRegistry, AgentRunner, ToolExecutionLedger } from '@nextmux/agent-runtime';
import { createOfficialModelClient, messagesWithToolImages } from '@nextmux/model-runtime';
import { NextMuxMcpServerManager } from '../lib/node/nextmux-mcp-server-manager.js';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { AgentRunStateStore } from '../lib/node/nextmux-agent-run-state-store.js';
import { mcpImageAttachments, MCP_IMAGE_TOTAL_BYTES, MCP_TEXT_MAX_CHARS, truncateMcpToolTextHeadTail } from '../lib/node/nextmux-mcp-images.js';
import { compileMcpInputSchema } from '../lib/node/nextmux-mcp-permissions.js';

const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=';
const image = { type: 'image', mimeType: 'image/png', data };

test('registered MCP ImageContent reaches the next provider request and saved checkpoint', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nm-mcp-image-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manager = new NextMuxMcpServerManager(); let running = false, rpcCalls = 0;
  const description = { name: 'fixture', command: 'never-spawned', args: [], autostart: false };
  const descriptors = [{ name: 'screen', description: 'Read the screen', inputSchema: { type: 'object', properties: { url: { $ref: '#/$defs/address' } }, $defs: { address: { type: 'string', format: 'uri' } }, required: ['url'] } }];
  manager.servers.set('fixture', { getCachedDescription: () => description, getDescription: async () => description,
    isRunning: () => running, isInFlight: () => false, isStopped: () => !running, start: async () => { running = true; }, stop: async () => { running = false; }, setWorkspaceRoots() {},
    getTools: async () => ({ tools: descriptors }), callTool: async () => { rpcCalls++; return { content: [{ type: 'text', text: 'Screenshot captured' }, image] }; } });
  let [state] = await manager.accessState();
  await manager.changeAccess({ serverName: 'fixture', fingerprint: state.fingerprint, action: 'start' });
  [state] = await manager.accessState(); assert.equal(state.tools[0].supported, true);
  await manager.changeAccess({ serverName: 'fixture', fingerprint: state.fingerprint, action: 'tools', tools: state.tools.map(({name, fingerprint}) => ({name, fingerprint})) });
  const registry = new AgentToolRegistry({ executionLedger: await ToolExecutionLedger.open({ journalPath: join(root, 'ledger.jsonl') }) });
  const service = new NextMuxPlatformServiceImpl(); service.mcpServerManager = manager; await service.registerMcpTools(registry);
  const tool = registry.descriptors('full_access').find(item => item.source === 'mcp');
  let requests = 0, captured, checkpoint;
  const client = createOfficialModelClient({ protocol: 'openai_chat_completions', baseUrl: 'https://fixture.example.test/v1', apiKey: 'fixture-only', model: 'fixture-model',
    fetchImpl: async (_url, init) => { captured = JSON.parse(String(init.body)); return Response.json({ choices: [{ message: { role: 'assistant', content: 'Screen inspected' } }], usage: { prompt_tokens: 20, completion_tokens: 3 } }); } });
  await new AgentRunner({ tools: registry, permissionMode: 'full_access', onCheckpoint: value => { checkpoint = value; }, model: { complete: async request => {
    if (requests++ === 0) return { toolCalls: [{ id: 'screen-1', name: tool.name, arguments: { url: 'https://fixture.example.test' } }] };
    assert.equal(request.messages.find(message => message.role === 'tool').attachments[0].dataBase64, data);
    // This is also the managed gateway serialization boundary: only user messages have attachments.
    assert.ok(messagesWithToolImages(request.messages).every(({message}) => !message.attachments || message.role === 'user'));
    return client.complete(request);
  } } }).run({ prompt: 'Inspect the fixture screen' });
  assert.equal(rpcCalls, 1);
  const toolResult = captured.messages.find(message => message.role === 'tool');
  assert.ok(!toolResult.content.includes(data)); assert.match(toolResult.content, /"attached":true/);
  assert.equal(captured.messages.at(-1).content.find(part => part.type === 'image_url').image_url.url, `data:image/png;base64,${data}`);
  assert.ok(checkpoint);
  const store = new AgentRunStateStore(root), id = await store.save(checkpoint);
  const recovered = await new AgentRunStateStore(root).load(id);
  assert.equal(recovered.messages.find(message => message.role === 'tool').attachments[0].dataBase64, data);
  await new AgentRunner({ tools: registry, permissionMode: 'full_access', model: { complete: async request => {
    assert.equal(request.messages.find(message => message.role === 'tool').attachments[0].dataBase64, data);
    return { content: 'Continued from the observed screenshot' };
  } } }).run({ prompt: 'Inspect the fixture screen', checkpoint: recovered });
  assert.equal(rpcCalls, 1, 'continuation must not request a second screenshot');
});

test('image bounds reject oversized, corrupt and dangerous images with explicit reasons', () => {
  const excessive = { ...image, data: Buffer.alloc(MCP_IMAGE_TOTAL_BYTES + 1).toString('base64') };
  const hugeDimensions = Buffer.from(data, 'base64'); hugeDimensions.writeUInt32BE(100_000, 16);
  for (const invalid of [excessive, { ...image, data: '!!!!' }, { ...image, mimeType: 'image/svg+xml' }, { ...image, data: hugeDimensions.toString('base64') }]) {
    const result = mcpImageAttachments([invalid]);
    assert.equal(result.attachments.length, 0); assert.equal(result.descriptions.get(0).omitted, true); assert.ok(result.descriptions.get(0).reason);
  }
  const many = mcpImageAttachments(Array(9).fill(image));
  assert.equal(many.attachments.length, 8); assert.equal(many.descriptions.get(8).omitted, true);
});

test('schema dialects, local references, formats and linear-time regex are validated without coercion', () => {
  const compiled = compileMcpInputSchema({ type: 'object', $schema: 'https://json-schema.org/draft/2020-12/schema',
    $defs: { url: { type: 'string', format: 'uri' } }, properties: { url: { $ref: '#/$defs/url' }, point: { type: 'array', prefixItems: [{ type: 'number' }, { type: 'number' }], minItems: 2, items: false },
      name: { type: 'string', pattern: '^(a+)+$' } }, required: ['url', 'point'] });
  assert.equal(compiled.validate({ url: 'https://example.test', point: [1, 2], name: 'aaa' }), true);
  assert.equal(compiled.validate({ url: 'invalid uri', point: [1, 2] }), false);
  assert.equal(compiled.validate({ url: 'https://example.test', point: ['1', 2] }), false);
  assert.equal(compiled.validate({ url: 'https://example.test', point: [1, 2, 3] }), false);
  const before = performance.now(); assert.equal(compiled.validate({ url: 'https://example.test', point: [1, 2], name: 'a'.repeat(50_000) + '!' }), false);
  assert.ok(performance.now() - before < 1000, 'a nested-quantifier pattern must not block the host');
  assert.equal(compileMcpInputSchema({ type: 'object', properties: { value: { type: 'array', items: [{ type: 'string' }], additionalItems: false } } }).validate({ value: ['x'] }), true);
  const pointerSchema = { type: 'object', $defs: { 'a/b': { type: 'string' } }, properties: { value: { $ref: '#/$defs/a~1b' } } };
  assert.equal(compileMcpInputSchema(pointerSchema).validate({ value: 'ok' }), true);
  assert.equal(compileMcpInputSchema(pointerSchema).validate({ value: 1 }), false);
  for (const $schema of ['http://json-schema.org/draft-07/schema', 'https://json-schema.org/draft-07/schema#', 'http://json-schema.org/draft/2019-09/schema#']) {
    assert.equal(compileMcpInputSchema({ type: 'object', $schema, properties: { name: { type: 'string' } } }).validate({ name: 1 }), false);
  }
  const patterned = compileMcpInputSchema({ type: 'object', patternProperties: { '^value-': { type: 'number' } }, additionalProperties: false });
  assert.equal(patterned.validate({ 'value-a': 2 }), true); assert.equal(patterned.validate({ 'value-a': '2' }), false);
  for (const unsupported of [
    { $ref: 'https://external.invalid/schema' }, { $ref: '#/$defs/cycle', $defs: { cycle: { $ref: '#/$defs/cycle' } } },
    { properties: { name: { type: 'string', pattern: '(a)\\1' } } },
    { properties: { name: { type: 'string', format: 'unknown-format' } } },
  ]) assert.throws(() => compileMcpInputSchema({ type: 'object', ...unsupported }));
});

test('resource blob images and head+tail text truncation preserve multimodal and diagnostic tails', () => {
  const resourceImage = {
    type: 'resource',
    resource: {
      uri: 'file:///tmp/capture.png',
      mimeType: 'image/png',
      blob: data
    }
  };
  const extracted = mcpImageAttachments([image, resourceImage]);
  assert.equal(extracted.attachments.length, 2);
  assert.equal(extracted.attachments[1].mimeType, 'image/png');
  assert.equal(extracted.attachments[1].dataBase64, data);
  assert.equal(extracted.descriptions.get(1).type, 'resource');
  assert.equal(extracted.descriptions.get(1).attached, true);
  assert.equal(extracted.descriptions.get(1).uri, 'file:///tmp/capture.png');

  const head = 'HEAD_MARKER_' + 'a'.repeat(45_000);
  const tail = 'b'.repeat(25_000) + '_TAIL_ERROR_SUMMARY';
  const oversized = head + tail;
  const truncated = truncateMcpToolTextHeadTail(oversized);
  assert.equal(truncated.truncated, true);
  assert.equal(truncated.originalLength, oversized.length);
  assert.ok(truncated.text.length <= MCP_TEXT_MAX_CHARS);
  assert.ok(truncated.text.startsWith('HEAD_MARKER_'));
  assert.ok(truncated.text.endsWith('_TAIL_ERROR_SUMMARY'));
  assert.match(truncated.text, /\[truncated: \d+ of \d+ characters not shown\]/);
});
