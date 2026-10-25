import assert from 'node:assert/strict';
import test from 'node:test';
import { createAiSdkModelClient, createOfficialModelClient, createPreferredOfficialModelClient, messagesWithToolImages } from '../lib/index.js';
import type { AgentModelMessage, AgentToolDescriptor } from '@nextmux/agent-runtime';
import type { OfficialProviderProtocol } from '../lib/index.js';

const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=';
const image = { kind: 'image' as const, name: 'screen', mimeType: 'image/png' as const, dataBase64: data };
const tool: AgentToolDescriptor = { name: 'mcp.screen', description: 'Inspect the screen', inputSchema: { type: 'object' }, requiredPermission: 'full_access', source: 'mcp' };
const messages: AgentModelMessage[] = [
  { role: 'user', content: 'Inspect both screens' },
  { role: 'assistant', content: '', toolCalls: ['one', 'two'].map(id => ({ id, name: tool.name, arguments: {} })) },
  { role: 'tool', content: '{"ok":true}', toolCallId: 'one', attachments: [image] },
  { role: 'tool', content: '{"ok":true}', toolCallId: 'two', attachments: [image] },
];

test('parallel tool receipts stay adjacent and original replay indices remain stable', () => {
  const mapped = messagesWithToolImages(messages);
  assert.deepEqual(mapped.map(entry => entry.sourceIndex), [0, 1, 2, 3, -1]);
  assert.deepEqual(mapped.map(entry => entry.message.role), ['user', 'assistant', 'tool', 'tool', 'user']);
  assert.equal(mapped[2].message.attachments, undefined);
  assert.equal(mapped[4].message.attachments?.length, 2);
  assert.match(mapped[4].message.content, /one: attachments 1–1, two: attachments 2–2/);
  assert.equal(messages[2].attachments?.[0], image, 'canonical history is not mutated');
  const many = messagesWithToolImages([{ role: 'tool', toolCallId: 'many', content: '{}', attachments: Array(17).fill(image) }]);
  assert.deepEqual(many.slice(1).map(entry => entry.message.attachments?.length), [8, 8, 1], 'gateway per-message limits remain respected');
});

for (const sdk of [false, true]) for (const protocol of ['openai_chat_completions', 'anthropic_messages', 'gemini_generate_content', 'cohere_chat', ...(sdk ? ['openai_responses'] : [])]) {
  test(`${sdk ? 'AI SDK' : 'native'} ${protocol} transmits MCP pixels as provider image blocks`, async () => {
    let sent: any;
    const factory = sdk ? createAiSdkModelClient : createOfficialModelClient;
    const client = factory({ protocol: protocol as OfficialProviderProtocol, baseUrl: 'https://fixture.example.test/v1', apiKey: 'fixture-only', model: 'fixture-model',
      fetchImpl: async (_url, init) => { sent = JSON.parse(String(init?.body)); throw new Error('fixture stops before network'); } });
    await assert.rejects(client.complete({ messages, tools: [tool] }));
    assert.ok(sent, 'request must reach the fixture transport');
    const flattened = JSON.stringify(sent);
    assert.ok(flattened.includes(data), 'pixels must reach the transport');
    const visit = (value: any): any[] => value && typeof value === 'object' ? [value, ...Object.values(value).flatMap(visit)] : [];
    const blocks = visit(sent);
    assert.ok(blocks.some(block => block.type === 'image_url' || block.type === 'input_image' || block.type === 'image' || block.inlineData?.mimeType === 'image/png'), 'pixels belong to an image block, never JSON tool text');
    if (protocol === 'openai_chat_completions' || protocol === 'cohere_chat') {
      const roles = sent.messages.map((message: any) => message.role);
      assert.deepEqual(roles.slice(-3), ['tool', 'tool', 'user']);
    }
  });
}

test('an adapter without verified vision refuses tool images before dispatch', async () => {
  let calls = 0;
  const client = createPreferredOfficialModelClient({ providerId: 'deepseek', protocol: 'openai_chat_completions', enablePreviewProviderAdapter: true,
    baseUrl: 'https://fixture.example.test/v1', apiKey: 'fixture-only', model: 'fixture-model', fetchImpl: async () => { calls++; throw new Error('must not dispatch'); } });
  await assert.rejects(client.complete({ messages, tools: [] }), (error: any) => error.code === 'UNSUPPORTED_CAPABILITY');
  assert.equal(calls, 0);
});
