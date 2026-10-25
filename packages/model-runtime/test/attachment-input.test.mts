import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentMessageAttachment, AgentModelMessage } from '@nextmux/agent-runtime';
import { createOfficialModelClient, createAiSdkModelClient, discoverOfficialModels, OfficialModelError } from '../lib/index.js';
import { cohereAttachmentMessages } from '../lib/cohere-attachments.js';

const file = (mimeType: string, data: Uint8Array | string, name = 'attachment.txt'): AgentMessageAttachment => ({
  kind: 'file', name, mimeType, dataBase64: Buffer.from(data).toString('base64'),
});
const messages = (attachment: AgentMessageAttachment): readonly AgentModelMessage[] => [{ role: 'user', content: 'Read this file', attachments: [attachment] }];
const cohereResponse = () => new Response([
  { type: 'message-start', id: 'attachment-generation' },
  { type: 'content-start', index: 0, delta: { message: { content: { type: 'text', text: '' } } } },
  { type: 'content-delta', index: 0, delta: { message: { content: { text: 'Read successfully' } } } },
  { type: 'content-end', index: 0 },
  { type: 'message-end', delta: { finish_reason: 'COMPLETE', usage: { tokens: { input_tokens: 4, output_tokens: 2 } } } },
].map(value => `event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });

for (const [name, create, streamed] of [
  ['native', createOfficialModelClient, false], ['SDK', createAiSdkModelClient, true],
] as const) {
  test(`${name} Cohere sends decoded text and preserves image attachments`, async () => {
    let sent: any;
    const client = create({ providerId: 'cohere', protocol: 'cohere_chat', baseUrl: 'https://cohere.example.test/v2', apiKey: 'synthetic-key', model: 'command-test',
      fetchImpl: async (_input, init) => {
        sent = JSON.parse(String(init?.body));
        return streamed ? cohereResponse() : Response.json({ message: { content: [{ type: 'text', text: 'Read successfully' }] }, usage: { tokens: { input_tokens: 4, output_tokens: 2 } } });
      },
    });
    const original: readonly AgentModelMessage[] = [{ role: 'user', content: 'Read this file', attachments: [
      file('text/markdown', '# 中文\nprecise content'),
      { kind: 'image', name: 'image.png', mimeType: 'image/png', dataBase64: 'aW1hZ2U=' },
    ] }];
    const before = JSON.stringify(original);
    const result = await client.complete({ messages: original, tools: [] });
    assert.equal(result.content, 'Read successfully');
    assert.match(JSON.stringify(sent), /# 中文/);
    assert.doesNotMatch(JSON.stringify(sent), new RegExp(Buffer.from('# 中文\nprecise content').toString('base64')));
    assert.match(JSON.stringify(sent), /data:image\/png;base64,aW1hZ2U=/);
    assert.equal(JSON.stringify(original), before, 'conversation history must not be mutated');
  });

  test(`${name} Cohere rejects binary documents and malformed text before any request`, async () => {
    let requests = 0;
    const client = create({ providerId: 'cohere', protocol: 'cohere_chat', baseUrl: 'https://cohere.example.test/v2', apiKey: 'synthetic-key', model: 'command-test',
      fetchImpl: async () => { requests++; throw new Error('must not send'); },
    });
    for (const attachment of [
      file('application/pdf', '%PDF binary', 'notes.pdf'),
      file('application/vnd.openxmlformats-officedocument.wordprocessingml.document', Buffer.from([0x50, 0x4b, 0, 1]), 'report.docx'),
      file('text/plain', Buffer.from([0xff, 0xff, 0, 0])),
      file('text/plain', Buffer.from('binary\0content')),
      { ...file('text/plain', 'text'), dataBase64: 'invalid:base64' },
    ]) {
      await assert.rejects(client.complete({ messages: messages(attachment), tools: [] }), error => error instanceof OfficialModelError
        && ['UNSUPPORTED_CAPABILITY', 'INVALID_REQUEST'].includes(error.code) && error.retrySafe === true);
    }
    assert.equal(requests, 0);
  });
}

test('Cohere text conversion accepts strict UTF-8 and BOM UTF-16, bounds bytes and characters', () => {
  const text = '中文test';
  const utf16le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  const utf16be = Buffer.from(utf16le).swap16();
  for (const bytes of [Buffer.from(text), utf16le, utf16be]) {
    const result = cohereAttachmentMessages(messages(file('text/plain; charset=utf-8', bytes)))[0].attachments?.[0];
    assert.equal(result?.kind, 'text');
    if (result?.kind === 'text') assert.equal(result.content, text);
  }
  for (const value of [Buffer.alloc(512 * 1024 + 1, 0x61), Buffer.from('a'.repeat(120_001))]) {
    assert.throws(() => cohereAttachmentMessages(messages(file('text/plain', value))), error => error instanceof OfficialModelError && error.code === 'REQUEST_TOO_LARGE');
  }
  assert.equal(cohereAttachmentMessages(messages(file('application/json', '{}')))[0].attachments?.[0].kind, 'text');
});

test('model discovery retains explicit input metadata without copying outputs or inferring from names', async () => {
  const models = await discoverOfficialModels({ protocol: 'openai_chat_completions', baseUrl: 'https://models.example.test/v1', apiKey: 'synthetic-key',
    fetchImpl: async () => Response.json({ data: [
      { id: 'declared', architecture: { input_modalities: ['text', 'IMAGE', 'file', 'file'], output_modalities: ['video'] }, input_mime_types: ['application/pdf'] },
      { id: 'vision-video-file-in-name', architecture: { output_modalities: ['image', 'video'] } },
      { id: 'empty', input_modalities: [] },
    ] }),
  });
  assert.deepEqual(models.find(item => item.id === 'declared')?.inputModalities, ['text', 'image', 'file']);
  assert.deepEqual(models.find(item => item.id === 'declared')?.inputMimeTypes, ['application/pdf']);
  assert.deepEqual(models.find(item => item.id === 'empty')?.inputModalities, []);
  assert.equal(models.find(item => item.id === 'vision-video-file-in-name')?.inputModalities, undefined);
});

test('Responses native document bytes are preserved rather than decoded as text or omitted', async () => {
  let sent: any;
  const client = createAiSdkModelClient({ providerId: 'openai', protocol: 'openai_responses', baseUrl: 'https://responses.example.test/v1', apiKey: 'synthetic-key', model: 'test-model',
    fetchImpl: async (_input, init) => {
      sent = JSON.parse(String(init?.body));
      const chunks = [
        { type: 'response.created', response: { id: 'resp-file', created_at: 1, model: 'test-model', service_tier: null } },
        { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg-file', phase: 'final_answer' } },
        { type: 'response.output_text.delta', item_id: 'msg-file', output_index: 0, delta: 'Native file preserved' },
        { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'msg-file', phase: 'final_answer' } },
        { type: 'response.completed', response: { usage: { input_tokens: 4, input_tokens_details: null, output_tokens: 2, output_tokens_details: { reasoning_tokens: 0 } }, service_tier: 'default' } },
      ];
      return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  const bytes = Buffer.from([0x50, 0x4b, 3, 4, 0, 255]);
  const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const result = await client.complete({ messages: messages(file(mime, bytes, 'report.docx')), tools: [], promptCacheKey: 'cache-preserved' });
  assert.equal(result.content, 'Native file preserved');
  const part = sent.input[0].content.find((item: any) => item.type === 'input_file');
  assert.equal(part.filename, 'report.docx');
  assert.equal(part.file_data, `data:${mime};base64,${bytes.toString('base64')}`);
  assert.equal(sent.prompt_cache_key, 'cache-preserved');
});
