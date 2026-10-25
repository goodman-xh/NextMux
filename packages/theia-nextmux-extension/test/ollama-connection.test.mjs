import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatModelError } from '@nextmux/model-runtime/errors';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { isDiscoveredInvocationAllowed, mergeOfficialDiscoveryCache } from '../lib/node/nextmux-official-discovery.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-native-ollama-'));
  const requests = [];
  const state = { digest: 'sha256:tools-v1', tools: true };
  const server = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    const body = raw ? JSON.parse(raw) : undefined;
    requests.push({ path: request.url, method: request.method, headers: request.headers, body });
    response.setHeader('content-type', 'application/json');
    if (request.url === '/api/version') return response.end(JSON.stringify({ version: '0.18.0' }));
    if (request.url === '/api/tags') return response.end(JSON.stringify({ models: [
      { name: 'code:latest', model: 'code:latest', digest: state.digest, details: { parameter_size: '8B', quantization_level: 'Q4_K_M' } },
      { name: 'text:latest', model: 'text:latest', digest: 'sha256:text' },
      { name: 'embed:latest', model: 'embed:latest', digest: 'sha256:embedding' }
    ] }));
    if (request.url === '/api/show') return response.end(JSON.stringify({
      capabilities: body.model === 'code:latest' ? ['completion', 'vision', 'thinking', ...(state.tools ? ['tools'] : [])]
        : body.model === 'text:latest' ? ['completion'] : ['embedding'],
      model_info: { 'general.architecture': 'qwen3', 'qwen3.context_length': 131072 },
      details: { parameter_size: '8B', quantization_level: 'Q4_K_M' }
    }));
    if (request.url === '/api/chat') {
      response.setHeader('content-type', 'application/x-ndjson');
      response.write(JSON.stringify({ model: body.model, message: { role: 'assistant', thinking: 'Checking the connection.' }, done: false }) + '\n');
      response.write(JSON.stringify({ model: body.model, message: { role: 'assistant', content: '', tool_calls: [
        { function: { name: body.tools[0].function.name, arguments: { code: 'OK' } } }
      ] }, done: false }) + '\n');
      return response.end(JSON.stringify({ model: body.model, message: { role: 'assistant', content: '' }, done: true,
        done_reason: 'stop', prompt_eval_count: 40, eval_count: 8 }) + '\n');
    }
    response.writeHead(404); response.end('404 page not found');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://localhost:${server.address().port}/v1`;
  class Service extends NextMuxPlatformServiceImpl {
    nextmuxDataRoot() { return root; }
    networkFetch = async () => { throw new Error('Ollama must stay on the direct local transport'); };
    readOfficialCredential() { assert.fail('local connections must not read credentials'); }
    writeOfficialCredential() { assert.fail('local connections must not write credentials'); }
    deleteOfficialCredential() { assert.fail('local connections must not touch credentials'); }
  }
  const service = new Service();
  t.after(async () => {
    await service.localModelTransport.close();
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  return { root, service, baseUrl, requests, state };
}

test('native Ollama Settings save/test persists context and capabilities, reports server status and keeps traffic local', async t => {
  const { root, service, baseUrl, requests } = await fixture(t);
  const saved = await service.saveOfficialModelConnection({ providerId: 'ollama', baseUrl,
    model: 'code:latest', providerSettings: { ollamaContextTokens: 32768 }, validate: true });
  assert.equal(saved.validation.toolCalling, true);
  assert.deepEqual(saved.connection.ollamaStatus, { version: '0.18.0', modelCount: 3, toolsModelCount: 1 });
  const code = saved.connection.discoveredModels.find(model => model.id === 'code:latest');
  assert.equal(code.contextTokens, 32768);
  assert.equal(code.maxContextTokens, 131072);
  assert.equal(code.toolsSupported, true);
  assert.ok(code.inputModalities.includes('image'));
  assert.equal(code.parameterSize, '8B'); assert.equal(code.quantizationLevel, 'Q4_K_M');
  assert.equal(saved.connection.discoveredModels.find(model => model.id === 'text:latest').toolsSupported, false);
  const embedding = saved.connection.discoveredModels.find(model => model.id === 'embed:latest');
  assert.equal(embedding.interfaceSupport, 'unsupported');
  assert.equal(isDiscoveredInvocationAllowed(saved.connection, 'text:latest'), false);
  assert.equal(isDiscoveredInvocationAllowed({ ...saved.connection, model: 'embed:latest' }, 'embed:latest'), false);
  const chat = requests.find(request => request.path === '/api/chat');
  assert.equal(chat.body.stream, true); assert.equal(chat.body.options.num_ctx, 16384);
  assert.equal(chat.body.keep_alive, '5m');
  assert.ok(requests.every(request => !request.path.startsWith('/v1/') && !request.headers.authorization && !request.headers.cookie));
  assert.deepEqual(service.contextLimitsForRequest({ route: { kind: 'official_connection', model: 'code:latest' } }, saved.connection),
    { contextWindowTokens: 32768 });
  const disk = JSON.parse(await readFile(join(root, 'official-connections-v1.json'), 'utf8'))[0];
  assert.deepEqual(disk.providerSettings, { ollamaContextTokens: 32768 });
  assert.deepEqual(disk.ollamaStatus, saved.connection.ollamaStatus);
  assert.equal(disk.discoveredModels.find(model => model.id === 'code:latest').digest, code.digest);
  const loaded = (await service.getOfficialModelConnections()).connections[0];
  assert.equal(loaded.discoveredModels.find(model => model.id === 'code:latest').contextTokens, 32768);
  for (const bad of [0, -1, 1023, 1.5, '32768', null, 10000001]) {
    await assert.rejects(service.saveOfficialModelConnection({ providerId: 'ollama', baseUrl, model: 'code:latest',
      providerSettings: { ollamaContextTokens: bad }, validate: false }), { code: 'INVALID_CONNECTION' });
  }
  const reset = await service.saveOfficialModelConnection({ connectionId: saved.connection.id, providerId: 'ollama', baseUrl,
    model: 'code:latest', providerSettings: {}, validate: false });
  assert.equal(reset.connection.providerSettings, undefined, 'an empty settings object resets automatic context');
  assert.equal(reset.connection.discoveredModels.find(model => model.id === 'code:latest').contextTokens, 131072);
});

test('discovery is digest cached; replacing a tag clears obsolete live proof and blocks non-tool selection', async t => {
  const { service, baseUrl, requests, state } = await fixture(t);
  const { connection } = await service.saveOfficialModelConnection({ providerId: 'ollama', baseUrl, model: 'code:latest', validate: true });
  const showCount = requests.filter(request => request.path === '/api/show').length;
  await service.refreshOfficialModelDiscovery(connection.id);
  assert.equal(requests.filter(request => request.path === '/api/show').length, showCount);
  state.digest = 'sha256:tools-v2'; state.tools = false;
  const changed = await service.refreshOfficialModelDiscovery(connection.id);
  assert.equal(requests.filter(request => request.path === '/api/show').length, showCount + 1);
  assert.equal(changed.status, 'unverified');
  assert.equal(changed.toolCapability, 'untested');
  assert.equal(changed.discoveredModels.find(model => model.id === 'code:latest').validation, undefined);
  assert.equal(isDiscoveredInvocationAllowed(changed, 'code:latest'), false);
  const before = requests.length;
  await assert.rejects(service.readAndValidateOfficialModelSelection(connection.id, 'code:latest'), { code: 'MODEL_NOT_DISCOVERED' });
  assert.equal(requests.length, before, 'unsupported tool models must never be probed with tools');
});

test('a running text-only Ollama connection can be checked without a failing tool generation', async t => {
  const { service, baseUrl, requests } = await fixture(t);
  const result = await service.saveOfficialModelConnection({ providerId: 'ollama', baseUrl, model: 'text:latest', validate: true });
  assert.equal(result.validation, undefined);
  assert.equal(result.connection.ollamaStatus.modelCount, 3);
  assert.equal(requests.some(request => request.path === '/api/chat'), false);
});

test('Ollama directory failures preserve local startup advice and do not claim a running server', async () => {
  class OfflineService extends NextMuxPlatformServiceImpl {
    connections = [];
    async readOfficialConnectionIndex() { return this.connections; }
    async writeOfficialConnectionIndex(value) { this.connections = value; }
    modelConnectionNetwork() { return { allowInsecure: true, fetchImpl: async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }); } }; }
  }
  const service = new OfflineService();
  const saved = await service.saveOfficialModelConnection({ providerId: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'code:latest', validate: false });
  assert.equal(saved.connection.modelDiscoveryStatus, 'failed');
  assert.equal(saved.connection.ollamaStatus, undefined);
  assert.match(formatModelError(saved.connection.modelDiscoveryError, 'zh-CN').text, /启动本地模型服务/);
});

test('a changed model digest cannot inherit exact-model validation from the previous catalog', () => {
  const previous = { modelDiscoveryStatus: 'verified', discoveredModels: [{ id: 'code', label: 'code', digest: 'a',
    validation: { toolCalling: true } }] };
  const result = mergeOfficialDiscoveryCache(previous, { modelDiscoveryStatus: 'verified',
    discoveredModels: [{ id: 'code', label: 'code', digest: 'b', toolsSupported: true }] }, new Date().toISOString());
  assert.equal(result.discoveredModels[0].validation, undefined);
});
