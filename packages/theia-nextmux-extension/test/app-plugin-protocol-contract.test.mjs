import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { appPluginModelChoices, decideAppPlugin, describeAppPluginFrame } from '../lib/node/nextmux-app-plugin-decisions.js';
const frame = 'data:image/png;base64,iVBORw0KGgo=';
const model = { id: 'vision-fixture', inputModalities: ['text', 'image'], outputModalities: ['text'] };
function host(protocol, response) {
  const calls = [];
  const connection = { id: 'c', label: protocol, providerName: protocol, protocol, baseUrl: 'https://provider.example/v1', models: [model] };
  return { calls, baseUrl: 'https://platform.example', deviceId: async () => 'device', connectionKey: async () => 'test-key', connections: async () => [connection],
    localFetch: async () => Response.json({}, { status: 404 }), fetch: async (url, init) => { calls.push({ url: String(url), body: JSON.parse(init?.body || '{}'), headers: new Headers(init?.headers) }); return response(); } };
}
const request = { vision: { source: 'connection', connectionId: 'c', model: model.id }, image: frame };
test('the platform RPC forwards an optional connection-only preflight without changing old calls', async () => {
  const file = ts.createSourceFile('service.ts', readFileSync(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = file.statements.find(node => ts.isClassDeclaration(node) && node.members.some(member => member.name?.getText(file) === 'appPluginModelChoices'));
  const method = declaration.members.find(member => member.name?.getText(file) === 'appPluginModelChoices');
  const script = ts.transpile(`class Probe { appPluginHost() { return 'host-fixture'; } ${method.getText(file)} }`, { target: ts.ScriptTarget.ES2022 });
  const calls = [];
  const service = new Function('appPluginModelChoices', `${script};return new Probe();`)(async (host, query) => { calls.push({ host, query }); return { connections: [] }; });
  await service.appPluginModelChoices();
  await service.appPluginModelChoices({ connectionId: 'keep-this-connection' });
  assert.deepEqual(calls, [{ host: 'host-fixture', query: undefined }, { host: 'host-fixture', query: { connectionId: 'keep-this-connection' } }]);
});
test('plugin Responses vision uses native input_image and decodes Responses events', async () => {
  const events = [
    { type: 'response.created', response: { id: 'r', created_at: 1, model: model.id, service_tier: null } },
    { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'm', phase: 'final_answer' } },
    { type: 'response.output_text.delta', item_id: 'm', output_index: 0, content_index: 0, delta: 'A coin at the left.' },
    { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'm', phase: 'final_answer' } },
    { type: 'response.completed', response: { usage: { input_tokens: 8, input_tokens_details: null, output_tokens: 6, output_tokens_details: { reasoning_tokens: 0 } }, service_tier: 'default' } },
  ];
  const backend = host('openai_responses', () => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } }));
  const result = await describeAppPluginFrame(backend, request);
  assert.equal(result.ok, true); assert.equal(result.text, 'A coin at the left.');
  assert.equal(backend.calls[0].url, 'https://provider.example/v1/responses');
  assert.equal(backend.calls[0].body.input[0].content.find(part => part.type === 'input_image').image_url, frame);
  assert.equal(backend.calls[0].body.max_output_tokens, 120);
});
test('plugin Anthropic and Gemini vision use native image formats and authentication', async () => {
  const cases = [
    ['anthropic_messages', { content: [{ type: 'text', text: 'A coin.' }], usage: { input_tokens: 2, output_tokens: 3 } }, call => {
      assert.match(call.url, /\/messages$/); assert.equal(call.headers.get('x-api-key'), 'test-key');
      assert.equal(call.body.messages[0].content.find(part => part.type === 'image').source.data, frame.split(',')[1]);
    }],
    ['gemini_generate_content', { candidates: [{ content: { role: 'model', parts: [{ text: 'A coin.' }] } }], usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3 } }, call => {
      assert.match(call.url, /:generateContent/); assert.equal(call.headers.get('x-goog-api-key'), 'test-key');
      assert.equal(call.body.contents[0].parts.find(part => part.inlineData).inlineData.data, frame.split(',')[1]);
    }],
  ];
  for (const [protocol, response, verify] of cases) {
    const backend = host(protocol, () => Response.json(response));
    assert.equal((await describeAppPluginFrame(backend, request)).text, 'A coin.'); verify(backend.calls[0]);
  }
});
test('unexecutable plugin protocols are excluded with an explicit reason', async () => {
  const backend = host('async_media_template', () => Response.json({ data: [] }));
  const choices = await appPluginModelChoices(backend);
  assert.deepEqual(choices.connections, []);
  assert.deepEqual(choices.errors, ['c: vision_protocol_unsupported (async_media_template)']);
  const result = await describeAppPluginFrame(backend, request);
  assert.equal(result.error, 'vision_protocol_unsupported');
  const native = host('anthropic_messages', () => Response.json({ data: [] }));
  assert.equal((await appPluginModelChoices(native)).connections[0].vision[0].model, model.id);
});


test('plugin vision choices respect a native explicit image-input rejection', async () => {
  const backend = host('anthropic_messages', () => Response.json({ data: [] }));
  const connection = (await backend.connections())[0];
  backend.connections = async () => [{ ...connection, models: [{ ...model, capabilityDeclarations: { 'input:image': { support: 'unsupported', source: 'provider_metadata', scope: 'route' } } }] }];
  assert.deepEqual((await appPluginModelChoices(backend)).connections, []);
});

test('own API preflight reads only the chosen connection and refuses generic OpenAI native decisions before dispatch', async () => {
  for (const protocol of ['openai_chat_completions', 'openrouter']) {
    const backend = host(protocol, () => Response.json({ answers: { next: { choice: 'wait', confidence: 0.8 } }, usage: { input_tokens: 5 } }));
    const connection = (await backend.connections())[0];
    backend.connections = async () => [{ ...connection, models: [{ id: 'typesafe/jev-1.13', outputModalities: ['decisions'] }] }];
    backend.localFetch = async () => assert.fail('connection-only preflight must not probe local servers');
    const choices = await appPluginModelChoices(backend, { connectionId: 'c' });
    assert.equal(backend.calls.length, 0, 'preflight must not fetch relay inventory or make paid requests');
    const result = await decideAppPlugin(backend, { model: { source: 'connection', connectionId: 'c', model: 'typesafe/jev-1.13' }, state: 'ready',
      questions: { next: { type: 'choice', criteria: { wait: 'Wait', go: 'Go' } } } });
    if (protocol === 'openrouter') {
      assert.equal(choices.connections[0].decisions[0].model, 'typesafe/jev-1.13');
      assert.equal(result.ok, true); assert.match(backend.calls[0].url, /\/api\/alpha\/decisions$/);
    } else {
      assert.equal(choices.connections.length, 0); assert.equal(choices.excluded[0].reason, 'unsupported_transport');
      assert.equal(result.error, 'decision_protocol_unsupported'); assert.equal(backend.calls.length, 0);
    }
  }
});

test('Tev own API uses Chat and relay inventory cannot reinstate stale image support', async () => {
  const backend = host('openai_chat_completions', () => Response.json({ choices: [{ message: { content: 'A' } }], usage: { prompt_tokens: 4, completion_tokens: 1, cost: 0.01 } }));
  const connection = (await backend.connections())[0], tev = 'togethercomputer/tev1-4b-experimental';
  backend.connections = async () => [{ ...connection, models: [{ id: tev, outputModalities: ['decisions'] }] }];
  assert.equal((await appPluginModelChoices(backend, { connectionId: 'c' })).connections[0].decisions[0].model, tev);
  const result = await decideAppPlugin(backend, { model: { source: 'connection', connectionId: 'c', model: tev }, state: 'ready',
    questions: { next: { type: 'choice', criteria: { wait: 'Wait', go: 'Go' } } } });
  assert.equal(result.ok, true); assert.equal(result.costUsd, 0.01);
  assert.match(backend.calls[0].url, /\/v1\/chat\/completions$/);
  assert.deepEqual(result.payload.answers, { next: { type: 'choice', choice: 'wait' } });
  const inventory = host('openrouter', () => Response.json({ data: [{ id: tev, display_name: 'Tev1', input_modalities: ['text', 'image'],
    decision_transport: 'tev1_chat', decision_capabilities: { images: false, question_types: ['choice'], max_questions: 1, min_choices: 2, max_choices: 24, confidence: false },
    routes: [{ id: 'offering-a', merchant_name: 'Merchant', input_price_per_million_tokens: 0.042 }] }] }));
  inventory.connections = async () => [];
  const choices = await appPluginModelChoices(inventory);
  assert.equal(choices.relays[0].images, false);
  assert.equal(choices.relays[0].routes[0].offeringId, 'offering-a');
});
