import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

function eventStream(chunks) {
  return new Response(
    `${chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`,
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

test('official OpenAI connection validation uses Responses and verifies tool calling', async () => {
  let capturedUrl = '';
  let capturedBody;

  class TestPlatformService extends NextMuxPlatformServiceImpl {
    networkFetch = async (input, init) => {
      capturedUrl = String(input);
      capturedBody = JSON.parse(String(init?.body));
      const toolName = capturedBody.tools[0].name;
      return eventStream([
        { type: 'response.created', response: { id: 'resp-validation', created_at: 1, model: 'gpt-5.6-terra', service_tier: null } },
        { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', id: 'fc-item', call_id: 'call-validation', name: toolName, arguments: '', status: 'in_progress' } },
        { type: 'response.function_call_arguments.delta', item_id: 'fc-item', output_index: 0, delta: '{"code":"OK"}' },
        { type: 'response.output_item.done', output_index: 0, item: { type: 'function_call', id: 'fc-item', call_id: 'call-validation', name: toolName, arguments: '{"code":"OK"}', status: 'completed' } },
        { type: 'response.completed', response: { usage: { input_tokens: 12, input_tokens_details: null, output_tokens: 4, output_tokens_details: { reasoning_tokens: 0 } }, service_tier: 'default' } },
      ]);
    };
  }

  const service = new TestPlatformService();
  const result = await service.validateOfficialModelConnection({
    providerId: 'openai',
    protocol: 'openai_responses',
    baseUrl: 'https://api.openai.test/v1',
    apiKey: 'secret-openai',
    model: 'gpt-5.6-terra',
    allowInsecure: false,
  });

  assert.equal(capturedUrl, 'https://api.openai.test/v1/responses');
  assert.equal(capturedBody.stream, true);
  assert.equal(result.resolvedModel, 'gpt-5.6-terra');
  assert.equal(result.toolCalling, true);
});

test('official native connections can use environment credentials without keychain residue', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-native-credential-source-'));
  try {
    class TestPlatformService extends NextMuxPlatformServiceImpl {
      credentials = new Map();
      networkFetch = async (_input, init) => {
        assert.equal(init.method, 'GET', 'saving without validation must only read metadata');
        return Response.json({ data: [] });
      };
      nextmuxDataRoot() { return root; }
      readOfficialCredential(connectionId) { return Promise.resolve(this.credentials.get(connectionId) || null); }
      writeOfficialCredential(connectionId, secret) { this.credentials.set(connectionId, secret); return Promise.resolve(); }
      deleteOfficialCredential(connectionId) { this.credentials.delete(connectionId); return Promise.resolve(); }
    }

    const service = new TestPlatformService();
    const environmentResult = await service.saveOfficialModelConnection({
      providerId: 'azure_openai',
      model: 'deployment-from-environment',
      baseUrl: 'https://resource.openai.azure.com/openai/v1',
      providerSettings: { credentialSource: 'environment', apiVersion: 'v1' },
      validate: false,
    });
    assert.equal(environmentResult.connection.providerSettings.credentialSource, 'environment');
    assert.equal(environmentResult.connection.credentialSource, 'environment');
    assert.equal(environmentResult.connection.keyHint, 'System environment credentials');
    assert.equal(service.credentials.size, 0);

    const apiKeyResult = await service.saveOfficialModelConnection({
      connectionId: environmentResult.connection.id,
      providerId: 'azure_openai',
      model: 'deployment-from-keychain',
      baseUrl: 'https://resource.openai.azure.com/openai/v1',
      providerSettings: { credentialSource: 'api_key', apiVersion: 'v1' },
      apiKey: 'azure-local-secret',
      validate: false,
    });
    assert.equal(apiKeyResult.connection.providerSettings.credentialSource, 'api_key');
    assert.equal(apiKeyResult.connection.credentialSource, 'api_key');
    assert.equal(service.credentials.get(environmentResult.connection.id), 'azure-local-secret');

    const backToEnvironment = await service.saveOfficialModelConnection({
      connectionId: environmentResult.connection.id,
      providerId: 'azure_openai',
      model: 'deployment-from-environment-again',
      baseUrl: 'https://resource.openai.azure.com/openai/v1',
      providerSettings: { credentialSource: 'environment', apiVersion: 'v1' },
      validate: false,
    });
    assert.equal(backToEnvironment.connection.providerSettings.credentialSource, 'environment');
    assert.equal(backToEnvironment.connection.credentialSource, 'environment');
    assert.equal(backToEnvironment.connection.keyHint, 'System environment credentials');
    assert.equal(service.credentials.size, 0, 'switching to environment credentials must remove the old key');

    await assert.rejects(
      service.saveOfficialModelConnection({
        providerId: 'custom_openai',
        model: 'custom-model',
        baseUrl: 'https://custom.example/v1',
        providerSettings: { credentialSource: 'environment' },
        validate: false,
      }),
      error => error?.code === 'CREDENTIAL_SOURCE_UNSUPPORTED',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Azure validation accepts an environment credential with an empty API-key field', async () => {
  let capturedHeaders;
  class TestPlatformService extends NextMuxPlatformServiceImpl {
    networkFetch = async (_input, init) => {
      capturedHeaders = Object.fromEntries(new Headers(init?.headers).entries());
      const body = JSON.parse(String(init?.body));
      const toolName = body.tools[0].name;
      return eventStream([
        { type: 'response.created', response: { id: 'resp-env', created_at: 1, model: 'deployment', service_tier: null } },
        { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', id: 'fc-env', call_id: 'call-env', name: toolName, arguments: '', status: 'in_progress' } },
        { type: 'response.function_call_arguments.delta', item_id: 'fc-env', output_index: 0, delta: '{"code":"OK"}' },
        { type: 'response.output_item.done', output_index: 0, item: { type: 'function_call', id: 'fc-env', call_id: 'call-env', name: toolName, arguments: '{"code":"OK"}', status: 'completed' } },
        { type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 1 }, service_tier: 'default' } },
      ]);
    };
  }
  const previous = process.env.AZURE_API_KEY;
  process.env.AZURE_API_KEY = 'azure-env-validation-secret';
  try {
    const service = new TestPlatformService();
    const result = await service.validateOfficialModelConnection({
      providerId: 'azure_openai',
      protocol: 'openai_responses',
      baseUrl: 'https://resource.openai.azure.com/openai/v1',
      apiKey: '',
      model: 'deployment',
      allowInsecure: false,
      providerSettings: { credentialSource: 'environment' },
    });
    assert.equal(result.toolCalling, true);
    assert.equal(capturedHeaders['api-key'], 'azure-env-validation-secret');
  } finally {
    if (previous === undefined) delete process.env.AZURE_API_KEY;
    else process.env.AZURE_API_KEY = previous;
  }
});

test('legacy direct-connection evidence is compacted instead of invalidating the whole catalog', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-official-index-'));
  try {
    const now = '2026-08-30T08:00:00.000Z';
    const capabilityEvidence = Array.from({ length: 80 }, (_, index) => ({
      capability: 'tools',
      support: index === 79 ? 'supported' : 'unsupported',
      confidence: 'verified',
      source: 'live_probe',
      observedAt: new Date(Date.parse(now) - (79 - index) * 1000).toISOString(),
    }));
    await writeFile(join(root, 'official-connections-v1.json'), JSON.stringify([{
      id: 'official-1d2a8788-98c3-4670-bc3c-69cdeacf8a5c',
      providerId: 'custom_openai',
      providerName: 'Compatible API',
      modelFamily: 'Custom',
      protocol: 'openai_chat_completions',
      label: 'Legacy QA',
      model: 'gpt-nextmux-qa-model',
      baseUrl: 'http://127.0.0.1:4181/v1',
      keyHint: '•••• cret',
      status: 'verified',
      toolCapability: 'verified',
      capabilityEvidence,
      discoveredModels: [],
      modelDiscoveryStatus: 'untested',
      createdAt: now,
      updatedAt: now,
      lastCheckedAt: now,
      lastLatencyMs: 9,
    }]));

    class TestPlatformService extends NextMuxPlatformServiceImpl {
      nextmuxDataRoot() { return root; }
    }
    const service = new TestPlatformService();
    const connections = await service.readOfficialConnectionIndex();
    const persisted = JSON.parse(await readFile(join(root, 'official-connections-v1.json'), 'utf8'));

    assert.equal(connections.length, 1);
    assert.ok(connections[0].capabilityEvidence.length < 20);
    assert.equal(connections[0].capabilityEvidence.find(item => item.capability === 'tools')?.support, 'supported');
    assert.ok(persisted[0].capabilityEvidence.length < 20);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('legacy ChatGPT direct connections migrate into the single OpenAI provider without changing connection identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-openai-provider-alias-'));
  try {
    const timestamp = '2026-09-06T08:00:00.000Z';
    const records = [
      {
        id: 'official-11111111-1111-4111-8111-111111111111',
        providerId: 'chatgpt', providerName: 'ChatGPT', modelFamily: 'ChatGPT', protocol: 'openai_chat_completions',
        label: 'Existing ChatGPT key', model: 'gpt-5.4-mini', baseUrl: 'https://api.openai.com/v1',
        keyHint: '•••• kept', status: 'verified', toolCapability: 'verified', createdAt: timestamp, updatedAt: timestamp
      },
      {
        id: 'official-22222222-2222-4222-8222-222222222222',
        providerId: 'openai', providerName: 'OpenAI', modelFamily: 'GPT', protocol: 'openai_responses',
        label: 'Existing OpenAI key', model: 'gpt-5.6-terra', baseUrl: 'https://api.openai.com/v1',
        keyHint: '•••• kept', status: 'verified', toolCapability: 'verified', createdAt: timestamp, updatedAt: timestamp
      }
    ];
    await writeFile(join(root, 'official-connections-v1.json'), JSON.stringify(records));
    class TestPlatformService extends NextMuxPlatformServiceImpl {
      nextmuxDataRoot() { return root; }
      readOfficialCredential() { assert.fail('display migration must not read or replace keychain data'); }
    }
    const service = new TestPlatformService();
    const state = await service.getOfficialModelConnections();
    const persisted = JSON.parse(await readFile(join(root, 'official-connections-v1.json'), 'utf8'));

    assert.equal(state.providers.filter(provider => provider.id === 'openai').length, 1);
    assert.equal(state.providers.some(provider => String(provider.id).toLowerCase() === 'chatgpt'), false);
    assert.deepEqual(state.connections.map(connection => connection.id), records.map(connection => connection.id));
    assert.deepEqual(state.connections.map(connection => connection.providerId), ['openai', 'openai']);
    assert.deepEqual(persisted.map(connection => connection.providerId), ['openai', 'openai']);
    assert.equal(persisted[0].providerName, 'OpenAI');
    assert.equal(persisted[0].modelFamily, 'GPT');
    assert.equal(persisted[0].protocol, 'openai_responses');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('saveOfficialModelConnection auto-selects a discovered model when model is omitted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-auto-discover-model-'));
  try {
    class TestPlatformService extends NextMuxPlatformServiceImpl {
      credentials = new Map();
      networkFetch = async (input) => {
        if (String(input).endsWith('/models')) {
          return Response.json({
            data: [
              { id: 'text-embedding-3-small', object: 'model' },
              { id: 'claude-sonnet-4-5', object: 'model' },
            ],
          });
        }
        throw new Error(`Unexpected fetch: ${String(input)}`);
      };
      nextmuxDataRoot() { return root; }
      readOfficialCredential(connectionId) { return Promise.resolve(this.credentials.get(connectionId) || null); }
      writeOfficialCredential(connectionId, secret) { this.credentials.set(connectionId, secret); return Promise.resolve(); }
      deleteOfficialCredential(connectionId) { this.credentials.delete(connectionId); return Promise.resolve(); }
    }

    const service = new TestPlatformService();
    const saved = await service.saveOfficialModelConnection({
      providerId: 'custom_openai',
      baseUrl: 'https://relay.example.invalid/v1',
      apiKey: 'sk-relay-key',
      model: '',
      validate: false,
    });
    assert.equal(saved.connection.model, 'claude-sonnet-4-5');
    assert.equal(saved.connection.discoveredModels.length, 2);
    assert.equal(await service.getOfficialConnectionApiKey(saved.connection.id), 'sk-relay-key');
    assert.equal(await service.getOfficialConnectionApiKey('invalid-id'), '');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('validateOfficialModelConnection falls back to plain-text completion when relay rejects tool schema', async () => {
  const bodies = [];
  class TestPlatformService extends NextMuxPlatformServiceImpl {
    networkFetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      if (Array.isArray(body.tools) && body.tools.length > 0) {
        return Response.json({
          error: { message: 'This model does not support tool_choice or function_call parameters', type: 'invalid_request_error' }
        }, { status: 400 });
      }
      return eventStream([
        { id: 'chatcmpl-plain', object: 'chat.completion.chunk', created: 1, model: 'deepseek-v3', choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null }] },
        { id: 'chatcmpl-plain', object: 'chat.completion.chunk', created: 1, model: 'deepseek-v3', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }
      ]);
    };
  }
  const service = new TestPlatformService();
  const result = await service.validateOfficialModelConnection({
    providerId: 'custom_openai',
    protocol: 'openai_chat_completions',
    baseUrl: 'https://relay.example.invalid/v1',
    apiKey: 'sk-test',
    model: 'deepseek-v3',
    allowInsecure: false,
  });
  assert.equal(bodies.length, 2);
  assert.equal(result.resolvedModel, 'deepseek-v3');
  assert.equal(result.toolCalling, false);
});

test('re-validating an existing image model connection preserves the configured image model', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-revalidate-image-model-'));
  try {
    const chatRequests = [];
    class TestPlatformService extends NextMuxPlatformServiceImpl {
      credentials = new Map();
      networkFetch = async (input, init) => {
        const url = String(input);
        const method = String(init?.method || 'GET').toUpperCase();
        if (method === 'GET' && url.endsWith('/models')) {
          return Response.json({
            data: [
              { id: 'doubao-seedream-4-5-251128', object: 'model' },
              { id: 'gpt-4o-mini', object: 'model' },
            ],
          });
        }
        if (method === 'POST' && url.endsWith('/chat/completions')) {
          const body = JSON.parse(String(init?.body));
          chatRequests.push(body.model);
          return eventStream([
            { id: 'chatcmpl-1', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: { role: 'assistant', content: null, tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'nextmux_connection_check', arguments: '{"code":"OK"}' } }] }, finish_reason: null }] },
            { id: 'chatcmpl-1', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
          ]);
        }
        throw new Error(`Unexpected request: ${method} ${url}`);
      };
      nextmuxDataRoot() { return root; }
      readOfficialCredential(connectionId) { return Promise.resolve(this.credentials.get(connectionId) || null); }
      writeOfficialCredential(connectionId, secret) { this.credentials.set(connectionId, secret); return Promise.resolve(); }
      deleteOfficialCredential(connectionId) { this.credentials.delete(connectionId); return Promise.resolve(); }
    }
    const service = new TestPlatformService();
    const saved = await service.saveOfficialModelConnection({
      providerId: 'custom_openai',
      baseUrl: 'https://relay.example.invalid/v1',
      apiKey: 'sk-image-key',
      model: 'doubao-seedream-4-5-251128',
      validate: false,
    });
    const revalidated = await service.saveOfficialModelConnection({
      connectionId: saved.connection.id,
      providerId: 'custom_openai',
      baseUrl: 'https://relay.example.invalid/v1',
      model: 'doubao-seedream-4-5-251128',
      validate: true,
    });
    assert.equal(revalidated.connection.model, 'doubao-seedream-4-5-251128');
    assert.deepEqual(chatRequests, ['gpt-4o-mini']);
    assert.equal(revalidated.connection.status, 'verified');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
