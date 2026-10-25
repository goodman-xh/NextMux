import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getGlobalDispatcher, setGlobalDispatcher, MockAgent } from 'undici';
import { validatedBaseUrl, validatedLocalModelBaseUrl, officialProviderSupportsCredentialSource } from '@nextmux/model-runtime';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { LocalModelTransport } from '../lib/node/nextmux-local-model-transport.js';
import { localModelText } from '../lib/browser/nextmux-local-model-locale.js';

test('local mode permits pinned loopback native roots and /v1; cloud and LAN policies stay separate', () => {
  assert.equal(validatedLocalModelBaseUrl('http://localhost:11434/v1').hostname, '127.0.0.1');
  assert.equal(validatedLocalModelBaseUrl('http://localhost:11434').pathname, '/');
  assert.equal(validatedLocalModelBaseUrl('http://[::1]:11434/v1/').hostname, '[::1]');
  for (const url of ['http://192.168.1.1:11434/v1', 'http://169.254.169.254/v1', 'https://api.example/v1',
    'http://0.0.0.0/v1', 'http://localhost.example/v1', 'http://127.0.0.1/admin', 'http://u:p@127.0.0.1/v1',
    'http://127.0.0.1/v1?secret=x', 'http://127.0.0.1/v1#fragment']) {
    assert.throws(() => validatedLocalModelBaseUrl(url));
  }
  assert.throws(() => validatedBaseUrl('http://127.0.0.1:11434/v1', false));
  assert.equal(officialProviderSupportsCredentialSource('ollama', 'none'), true);
  assert.equal(officialProviderSupportsCredentialSource('ollama', 'api_key'), false);
  assert.equal(officialProviderSupportsCredentialSource('custom_openai', 'none'), false);
});

test('saved Ollama connections discover and test real local HTTP without credentials, platform or global proxy', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-local-model-'));
  const requests = [];
  const server = createServer(async (request, response) => {
    requests.push({ path: request.url, headers: request.headers });
    if (request.url.startsWith('/api/')) {
      response.writeHead(404); response.end('404 page not found'); return;
    }
    if (request.url === '/v1/models') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ data: [{ id: 'local-tools:small' }, { id: 'local-text:small' }] }));
      return;
    }
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const name = body.tools[0].function.name;
    response.setHeader('content-type', 'text/event-stream');
    response.end([
      { id: 'local-check', model: body.model, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call-local', type: 'function', function: { name, arguments: '{"code":"OK"}' } }] }, finish_reason: null }] },
      { id: 'local-check', model: body.model, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 } }
    ].map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://localhost:${server.address().port}/v1`;
  const originalDispatcher = getGlobalDispatcher();
  const offline = new MockAgent(); offline.disableNetConnect(); setGlobalDispatcher(offline);
  class LocalService extends NextMuxPlatformServiceImpl {
    nextmuxDataRoot() { return root; }
    networkFetch = async () => { throw new Error('Local model leaked into cloud/proxy path'); };
    readOfficialCredential() { throw new Error('Local model read keychain'); }
    writeOfficialCredential() { throw new Error('Local model wrote keychain'); }
    deleteOfficialCredential() { throw new Error('Local model touched keychain'); }
  }
  const service = new LocalService();
  t.after(async () => {
    setGlobalDispatcher(originalDispatcher);
    await service.localModelTransport.close();
    await offline.close();
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const result = await service.saveOfficialModelConnection({ providerId: 'ollama', baseUrl,
    model: 'local-tools:small', validate: true });
  assert.equal(result.validation.toolCalling, true);
  assert.equal(result.connection.discoveredModels.length, 2);
  assert.equal(result.connection.status, 'verified');
  assert.equal(result.connection.keyHint, 'Local service · no key required');
  assert.equal(result.connection.credentialSource, 'none');
  assert.equal(requests.filter(item => item.path === '/v1/models').length, 1);
  assert.equal(requests.filter(item => item.path === '/v1/chat/completions').length, 1);
  assert.ok(requests.some(item => item.path.startsWith('/api/')), 'native availability is checked before compatible fallback');
  assert.ok(requests.every(item => !item.headers.authorization && !item.headers.cookie));
  const listed = await service.discoverLocalModels(baseUrl);
  assert.equal(listed.length, 2);
  assert.ok(listed.every(model => model.interfaceSupport === undefined || model.interfaceSupport === 'unknown'), 'listing does not certify generation');
  await assert.rejects(service.discoverLocalModels('http://169.254.169.254/v1'), { code: 'LOCAL_MODEL_URL_REQUIRED' });
  const persisted = await readFile(join(root, 'official-connections-v1.json'), 'utf8');
  assert.doesNotMatch(persisted, /"apiKey"|Bearer /);
  const refresh = await service.refreshOfficialModelDiscovery(result.connection.id);
  assert.equal(refresh.discoveredModels.length, 2);
  await service.saveOfficialModelConnection({ connectionId: result.connection.id, providerId: 'ollama', baseUrl,
    model: 'local-tools:small', validate: false });
  await assert.rejects(service.saveOfficialModelConnection({ providerId: 'ollama', baseUrl,
    model: 'local', apiKey: 'must-not-leak', validate: false }), { code: 'API_KEY_NOT_ALLOWED' });
  await service.removeOfficialModelConnection(result.connection.id);
  assert.equal((await service.getOfficialModelConnections()).connections.length, 0);
});

test('local requests cannot redirect, leak keys, execute non-model endpoints or ignore cancellation', async t => {
  let headers;
  const server = createServer((request, response) => {
    headers = request.headers;
    response.writeHead(302, { location: 'https://example.invalid/collect' }); response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const transport = new LocalModelTransport();
  t.after(async () => { await transport.close(); await new Promise(resolve => server.close(resolve)); });
  await assert.rejects(transport.fetch(`${origin}/v1/models`, { headers: { authorization: 'Bearer cloud-secret', cookie: 'session=secret' } }));
  assert.equal(headers.authorization, undefined); assert.equal(headers.cookie, undefined);
  await assert.rejects(transport.fetch(`${origin}/api/pull`, { method: 'POST' }), { code: 'LOCAL_MODEL_URL_REQUIRED' });
  // The download door takes only /api/pull, so neither door reaches the other's endpoints.
  await assert.rejects(transport.pullFetch(`${origin}/v1/chat/completions`, { method: 'POST', body: '{}' }), { code: 'LOCAL_MODEL_URL_REQUIRED' });
  await assert.rejects(transport.pullFetch(`${origin}/api/pull?x=1`, { method: 'POST' }), { code: 'LOCAL_MODEL_URL_REQUIRED' });
  await assert.rejects(transport.fetch(`${origin}/v1/models`, { signal: AbortSignal.abort() }));
});

test('Request-object calls retain method, body and signal while removing credentials', async t => {
  let received;
  const server = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    received = { method: request.method, body: Buffer.concat(chunks).toString(), headers: request.headers };
    response.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/v1/chat/completions`;
  const transport = new LocalModelTransport();
  t.after(async () => { await transport.close(); await new Promise(resolve => server.close(resolve)); });
  const request = new Request(url, { method: 'POST', body: '{"model":"local"}',
    headers: { 'content-type': 'application/json', authorization: 'Bearer private-cloud-key' } });
  await (await transport.fetch(request)).text();
  assert.equal(received.method, 'POST');
  assert.equal(received.body, '{"model":"local"}');
  assert.equal(received.headers.authorization, undefined);
  await assert.rejects(transport.fetch(new Request(url, { method: 'POST', body: '{}', signal: AbortSignal.abort() })));
});

test('local connection copy covers all locales and the UI does not ask for a cloud key', async () => {
  for (const locale of ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
    for (const key of ['title', 'address', 'note', 'test']) assert.ok(localModelText(locale, key).length > 2);
  }
  const widget = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
  assert.match(widget, /onAddLocal: \(\) => this\.openOfficialProviderFromMyApis\(local\)/);
  assert.match(widget, /local \? null : credentialSource === 'environment'/);
  assert.match(widget, /modelConnectionNetwork|localModelText/);
});
