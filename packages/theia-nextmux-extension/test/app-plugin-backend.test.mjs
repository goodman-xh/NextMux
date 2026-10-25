import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const decisions = require('../lib/node/nextmux-app-plugin-decisions.js');
const market = require('../lib/node/nextmux-app-plugin-market.js');

function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : undefined });
    const handler = routes.find(([pattern]) => String(url).includes(pattern))?.[1];
    if (!handler) return new Response('{}', { status: 404 });
    return handler(String(url), init);
  };
  return { fetch, calls };
}
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
const request = (model, extra = {}) => ({ model, state: 'Goal: catch coins\nScreen now: coin 1 found', questions: { next: { type: 'choice', instructions: 'Which way?', criteria: { left: 'Left', right: 'Right' } } }, ...extra });

const RELAY = { id: 'conn-relay', label: 'My relay', providerName: 'Some relay', protocol: 'openrouter', baseUrl: 'https://relay.example/api/v1',
  models: [
    { id: 'typesafe/jev-1.13', label: 'Jev 1.13', inputModalities: ['text'], outputModalities: ['decisions'] },
    { id: 'typesafe/jev-router', label: 'Jev Router', inputModalities: ['text', 'image'], outputModalities: ['text'] },
    { id: 'vendor/vision-chat', label: 'Vision chat', inputModalities: ['text', 'image'], outputModalities: ['text'] },
    { id: 'vendor/text-chat', label: 'Text chat', inputModalities: ['text'], outputModalities: ['text'] }
  ] };
const host = (fetch, { key = 'sk-test-not-real', connections = [RELAY] } = {}) => ({ baseUrl: 'https://platform.example', deviceId: async () => 'device-1', fetch, localFetch: fetch,
  connections: async () => connections, connectionKey: async id => id === 'conn-relay' ? key : undefined });

test('decisions go to the chosen source with its own credentials; cost comes from the platform or the provider', async () => {
  const platform = fakeFetch([['/v1/decisions', () => json({ answers: { next: { choice: 'left', confidence: 0.8 } }, nextmux: { charged_micros: 42 } })]]);
  const relay = fakeFetch([['/api/alpha/decisions', () => json({ next: { choice: 'right' }, usage: { cost: 0.00005 } })]]);
  const local = fakeFetch([['/v1/systemone', () => json({ answers: { next: { choice: 'left' } } })]]);

  const viaPlatform = await decisions.decideAppPlugin(host(platform.fetch), request({ source: 'nextmux', model: 'typesafe/jev-1.13', offeringId: 'offer-1' }));
  assert.equal(viaPlatform.ok, true);
  assert.equal(viaPlatform.costUsd, 0.000042);
  assert.equal(platform.calls[0].url, 'https://platform.example/v1/decisions');
  assert.equal(new Headers(platform.calls[0].init.headers).get('x-nextmux-device-id'), 'device-1');
  assert.equal(new Headers(platform.calls[0].init.headers).get('x-nextmux-offering-id'), 'offer-1');
  assert.match(new Headers(platform.calls[0].init.headers).get('idempotency-key'), /^plugin-/);
  assert.deepEqual(Object.keys(platform.calls[0].body), ['model', 'state', 'questions'], 'the platform never receives screenshots');

  const viaConnection = await decisions.decideAppPlugin(host(relay.fetch), request({ source: 'connection', connectionId: 'conn-relay', model: 'typesafe/jev-1.13' }, { images: ['data:image/jpeg;base64,AAAA'] }));
  assert.equal(viaConnection.costUsd, 0.00005);
  assert.equal(relay.calls[0].url, 'https://relay.example/api/alpha/decisions', 'the Decisions API sits beside the connection API base');
  assert.equal(new Headers(relay.calls[0].init.headers).get('authorization'), 'Bearer sk-test-not-real');
  assert.equal(relay.calls[0].body.images, undefined, 'a decision model that cannot see gets no frames');
  assert.equal((await decisions.decideAppPlugin(host(relay.fetch), request({ source: 'connection', connectionId: 'gone', model: 'typesafe/jev-1.13' }))).error, 'connection_missing');
  assert.equal(decisions.decisionsUrl('https://openrouter.ai/api/v1'), 'https://openrouter.ai/api/alpha/decisions');
  assert.equal(decisions.decisionsUrl('https://gateway.example/v1'), 'https://gateway.example/api/alpha/decisions');
  assert.equal(decisions.decisionsUrl('http://gateway.example/v1'), undefined, 'keys only travel over HTTPS');

  const viaLocal = await decisions.decideAppPlugin(host(local.fetch), request({ source: 'local', model: 'openjev-latest', endpoint: 'http://127.0.0.1:8080', images: true }, { images: ['data:image/jpeg;base64,AAAA'] }));
  assert.equal(viaLocal.ok, true);
  assert.equal(viaLocal.costUsd, 0);
  assert.equal(local.calls[0].url, 'http://127.0.0.1:8080/v1/systemone');
  assert.deepEqual(local.calls[0].body.images, ['data:image/jpeg;base64,AAAA'], 'a local model that can see gets the frame');
  for (const endpoint of ['http://192.168.1.5:8080', 'http://example.com', 'file:///etc/passwd', 'http://user:pass@127.0.0.1:8080']) {
    assert.equal((await decisions.decideAppPlugin(host(local.fetch), request({ source: 'local', model: 'm', endpoint }))).error, 'local_endpoint_invalid', endpoint);
  }
  assert.equal((await decisions.decideAppPlugin(host(local.fetch), request({ source: 'nextmux', model: 'x' }, { state: 'x'.repeat(70_000) }))).error, 'decision_state_invalid');
  assert.equal((await decisions.decideAppPlugin(host(local.fetch), request({ source: 'nextmux', model: 'x' }, { questions: {} }))).error, 'decision_questions_invalid');
  const failing = fakeFetch([['/v1/decisions', () => json({ error: { code: 'insufficient_balance' } }, 402)]]);
  assert.equal((await decisions.decideAppPlugin(host(failing.fetch), request({ source: 'nextmux', model: 'x' }))).error, 'decision_balance');
  const timeout = host(async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); });
  assert.equal((await decisions.decideAppPlugin(timeout, request({ source: 'nextmux', model: 'x' }))).error, 'decision_timeout');
});

test('chat models answer as decision models: Ollama with a JSON schema, OpenAI-compatible servers with response_format', async () => {
  const questions = { move: { type: 'choice', instructions: 'Which way?', criteria: { left: 'Left', right: 'Right' } }, danger: { type: 'noul', instructions: 'Is a bomb close?' } };
  const ollama = fakeFetch([['/api/chat', () => json({ done: true, message: { content: '{"move":{"choice":"right","confidence":0.7},"danger":{"yes":0.2}}' } })]]);
  const result = await decisions.decideAppPlugin(host(ollama.fetch), request({ source: 'local', protocol: 'ollama', model: 'qwen2.5vl:7b', endpoint: 'http://127.0.0.1:11434', images: true },
    { questions, images: ['data:image/png;base64,QUJD'] }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.payload, { answers: { move: { choice: 'right', confidence: 0.7 }, danger: { noul: 0.2 } } });
  const sent = ollama.calls.find(call => call.url.endsWith('/api/chat')).body;
  assert.equal(ollama.calls.find(call => call.url.endsWith('/api/chat')).url, 'http://127.0.0.1:11434/api/chat');
  assert.equal(sent.stream, true);
  assert.deepEqual(sent.format.required, ['move', 'danger']);
  assert.deepEqual(sent.format.properties.move.properties.choice.enum, ['left', 'right']);
  assert.deepEqual(sent.messages[1].images, ['QUJD'], 'Ollama takes bare base64 images');
  assert.match(sent.messages[1].content, /Which way\? Options: "left" \(Left\); "right" \(Right\)/);

  const openai = fakeFetch([['/v1/chat/completions', () => json({ choices: [{ message: { content: '```json\n{"move":{"choice":"up","confidence":1},"danger":{"yes":true}}\n```' } }] })]]);
  const other = await decisions.decideAppPlugin(host(openai.fetch), request({ source: 'local', protocol: 'openai', model: 'local-model', endpoint: 'http://localhost:1234' }, { questions }));
  assert.deepEqual(other.payload, { answers: { danger: { noul: 1 } } }, 'an option the plugin did not offer is dropped');
  assert.equal(openai.calls.find(call => call.url.endsWith('/chat/completions')).body.response_format.type, 'json_schema');
  const unreadable = fakeFetch([['/api/chat', () => json({ done: true, message: { content: 'I think you should go left.' } })]]);
  assert.equal((await decisions.decideAppPlugin(host(unreadable.fetch), request({ source: 'local', protocol: 'ollama', model: 'm', endpoint: 'http://127.0.0.1:11434' }, { questions }))).error, 'decision_answer_unreadable');
});

test('model choices: relay models with every merchant, own API connections by what they list, servers found on this computer', async () => {
  const routes = fakeFetch([
    ['/v1/decision-models', () => json({ data: [{ id: 'typesafe/jev-1.13', display_name: 'Jev 1.13', context_length: 32000, input_modalities: ['text'],
      routes: [{ id: 'offer-b', merchant_name: 'Relay B', input_price_per_million_tokens: 0.05 }, { id: 'offer-a', merchant_name: 'Relay A', input_price_per_million_tokens: 0.042 }] }] })],
    ['11434/api/tags', () => json({ models: [{ name: 'qwen2.5vl:7b' }, { name: 'llama3.2:3b' }, { name: 'nomic-embed-text' }] })],
    ['11434/api/show', (url, init) => {
      const model = JSON.parse(init.body).model;
      return json({ capabilities: model === 'qwen2.5vl:7b' ? ['completion', 'vision'] : model === 'nomic-embed-text' ? ['embedding'] : ['completion', 'tools'] });
    }],
    ['8080/v1/models', () => json({ data: [{ id: 'openjev-latest' }, { id: 'bad id with spaces' }] })],
    ['8080/v1/systemone', () => json({ error: 'bad_request' }, 400)],
    ['/api/v1/chat/completions', () => json({ choices: [{ message: { content: 'Two coins top right; the basket is at the left.' } }], usage: { cost: 0.0003 } })]
  ]);
  const choices = await decisions.appPluginModelChoices(host(routes.fetch));
  assert.deepEqual(choices.relays, [{ model: 'typesafe/jev-1.13', label: 'Jev 1.13', contextTokens: 32000, images: false,
    routes: [{ offeringId: 'offer-a', merchant: 'Relay A', inputPricePerMillion: 0.042 }, { offeringId: 'offer-b', merchant: 'Relay B', inputPricePerMillion: 0.05 }] }]);
  assert.deepEqual(choices.connections, [{ connectionId: 'conn-relay', label: 'My relay', provider: 'Some relay',
    decisions: [{ model: 'typesafe/jev-1.13', label: 'Jev 1.13', images: false }], vision: [{ model: 'typesafe/jev-router', label: 'Jev Router' }, { model: 'vendor/vision-chat', label: 'Vision chat' }] }],
  'decision models are known by their output, not by name; a router that chats is not one');
  assert.deepEqual(choices.local, [
    { endpoint: 'http://127.0.0.1:11434', protocol: 'ollama', name: 'Ollama', models: [{ model: 'qwen2.5vl:7b', images: true }, { model: 'llama3.2:3b' }] },
    { endpoint: 'http://127.0.0.1:8080', protocol: 'systemone', name: 'OpenJev', models: [{ model: 'openjev-latest', images: true }] }
  ]);
  assert.equal((await decisions.appPluginModelChoices(host(routes.fetch, { connections: [] }))).connections.length, 0);
  assert.equal((await decisions.probeAppPluginServer(host(routes.fetch), 'http://10.0.0.1:8080')).error, 'local_endpoint_invalid');

  const described = await decisions.describeAppPluginFrame(host(routes.fetch), { vision: { source: 'connection', connectionId: 'conn-relay', model: 'vendor/vision-chat' }, image: 'data:image/jpeg;base64,AAAA', hints: 'Coins are yellow.' });
  assert.equal(described.ok, true);
  assert.match(described.text, /basket is at the left/);
  const call = routes.calls.find(item => item.url.includes('/chat/completions'));
  assert.equal(call.url, 'https://relay.example/api/v1/chat/completions');
  assert.equal(call.body.messages[0].content[1].image_url.url, 'data:image/jpeg;base64,AAAA');
  assert.match(call.body.messages[0].content[0].text, /Coins are yellow/);
});

test('BYOK token costs use discovered input/output/cache prices and remain unknown when any evidence is missing', async () => {
  const priced = { ...RELAY, models: RELAY.models.map(model => ({ ...model, inputPricePerMillion: 2, outputPricePerMillion: 8,
    cachedInputPricePerMillion: 0.5, cacheWritePricePerMillion: 3 })) };
  const model = { source: 'connection', connectionId: 'conn-relay', model: 'typesafe/jev-1.13' };
  const result = async (usage, connections = [priced]) => decisions.decideAppPlugin(host(async () => json({ answers: {}, usage }), { connections }), request(model));
  const calculated = await result({ prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 200, cache_write_tokens: 100 } });
  assert.equal(calculated.costStatus, 'known');
  assert.equal(calculated.costUsd, 0.0026);
  const anthropic = await result({ input_tokens: 700, output_tokens: 100, cache_read_input_tokens: 200, cache_creation_input_tokens: 100 });
  assert.equal(anthropic.costUsd, 0.0026);
  assert.equal((await result({ input_tokens: 1000 })).costUsd, 0.002, 'Decisions API bills input only when no output is reported');
  for (const value of [undefined, {}, { input_tokens: -1 }, { input_tokens: 100, cached_input_tokens: 101 }]) {
    const unknown = await result(value);
    assert.equal(unknown.costStatus, 'unknown'); assert.equal(unknown.costUsd, undefined);
  }
  assert.equal((await result({ input_tokens: 1000 }, [RELAY])).costStatus, 'unknown');
  assert.equal((await result({ input_tokens: 0, output_tokens: 0 }, [RELAY])).costStatus, 'unknown', 'No advertised price is never inferred to be free');
  assert.equal((await result({ input_tokens: 1000, output_tokens: 1 }, [{ ...priced, models: [{ id: model.model, inputPricePerMillion: 2 }] }])).costStatus, 'unknown');
  assert.equal((await result({ cost: -1 }, [RELAY])).costStatus, 'unknown');
  const loopback = { ...priced, baseUrl: 'http://127.0.0.1:1234/v1' };
  assert.equal((await result({ input_tokens: 1000 }, [loopback])).costUsd, 0.002, 'A loopback BYOK proxy may still bill a remote provider');
  assert.equal((await result(undefined, [loopback])).costStatus, 'unknown');
  assert.equal((await result({ cost: 0.4 }, [loopback])).costUsd, 0.4);
  const described = await decisions.describeAppPluginFrame(host(async () => json({ choices: [{ message: { content: 'A coin.' } }],
    usage: { prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 200, cache_write_tokens: 100 } } }), { connections: [priced] }),
    { vision: { source: 'connection', connectionId: 'conn-relay', model: 'vendor/vision-chat' }, image: 'data:image/png;base64,AAAA' });
  assert.equal(described.costUsd, 0.0026); assert.equal(described.costStatus, 'known');
  const loopbackVision = await decisions.describeAppPluginFrame(host(async () => json({ choices: [{ message: { content: 'A coin.' } }], usage: { cost: 0.7 } }), { connections: [loopback] }),
    { vision: { source: 'connection', connectionId: 'conn-relay', model: 'vendor/vision-chat' }, image: 'data:image/png;base64,AAAA' });
  assert.equal(loopbackVision.costUsd, 0.7);
  const choices = await decisions.appPluginModelChoices(host(async () => json({}), { connections: [priced] }));
  assert.equal(choices.connections[0].decisions[0].inputPricePerMillion, 2);
  assert.equal(choices.connections[0].vision[0].cacheWritePricePerMillion, 3);
});

test('plugin cancellations abort fetches within their owner scope and still account a late paid response', async () => {
  const scope = {}, peerScope = {}, signals = [];
  let resolveLate;
  const late = new Promise(resolve => { resolveLate = resolve; });
  const fetcher = async (_url, init) => { signals.push(init.signal); return (await late).clone(); };
  const makeHost = requestScope => ({ ...host(fetcher), requestScope });
  const model = { source: 'nextmux', model: 'typesafe/jev-1.13' };
  const stopped = decisions.decideAppPlugin(makeHost(scope), request(model, { requestId: 'scope-request' }));
  const peer = decisions.decideAppPlugin(makeHost(peerScope), request(model, { requestId: 'scope-request' }));
  await new Promise(resolve => setImmediate(resolve));
  decisions.cancelAppPluginRequest('scope-request', scope);
  assert.equal(signals[0].aborted, true); assert.equal(signals[1].aborted, false);
  resolveLate(json({ answers: { next: { choice: 'left' } }, nextmux: { charged_micros: 42 } }));
  const cancelled = await stopped;
  assert.equal(cancelled.error, 'decision_cancelled'); assert.equal(cancelled.payload, undefined);
  assert.equal(cancelled.costUsd, 0.000042); assert.equal(cancelled.costStatus, 'known');
  assert.equal((await peer).ok, true);
  let calls = 0;
  decisions.cancelAppPluginRequest('early-cancel', scope);
  assert.equal((await decisions.decideAppPlugin({ ...host(async () => { calls++; return json({}); }), requestScope: scope }, request(model, { requestId: 'early-cancel' }))).error, 'decision_cancelled');
  assert.equal(calls, 0, 'Cancellation that overtakes request delivery must not issue a provider call');
  let releaseKey;
  const key = new Promise(resolve => { releaseKey = resolve; });
  const delayedKey = decisions.decideAppPlugin({ ...host(async () => { calls++; return json({}); }), requestScope: scope, connectionKey: () => key },
    request({ source: 'connection', connectionId: 'conn-relay', model: 'typesafe/jev-1.13' }, { requestId: 'cancel-during-key' }));
  await new Promise(resolve => setImmediate(resolve));
  decisions.cancelAppPluginRequest('cancel-during-key', scope);
  releaseKey(undefined);
  assert.equal((await delayedKey).error, 'decision_cancelled'); assert.equal(calls, 0, 'Cancellation during credential lookup is checked before fetch');
});

test('plugin owner disposal and deadline propagate to fetch, while late vision charges survive cancellation', async () => {
  const scope = {}, signals = [];
  let finish;
  const result = decisions.describeAppPluginFrame({ ...host(async (_url, init) => { signals.push(init.signal); return new Promise(resolve => { finish = resolve; }); }), requestScope: scope },
    { requestId: 'owner-vision', vision: { source: 'connection', connectionId: 'conn-relay', model: 'vendor/vision-chat' }, image: 'data:image/png;base64,AAAA' });
  await new Promise(resolve => setImmediate(resolve));
  decisions.disposeAppPluginRequests(scope);
  assert.equal(signals[0].aborted, true);
  finish(json({ choices: [{ message: { content: 'Late description' } }], usage: { cost: 0.02 } }));
  const cancelled = await result;
  assert.equal(cancelled.error, 'vision_cancelled'); assert.equal(cancelled.text, undefined); assert.equal(cancelled.costUsd, 0.02);
  const aborting = async (_url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const timed = await decisions.decideAppPlugin(host(aborting), request({ source: 'nextmux', model: 'x' }, { requestId: 'short-deadline', deadlineAt: Date.now() + 20 }));
    assert.equal(timed.error, 'decision_timeout'); assert.equal(timed.costStatus, 'unknown');
  } finally { clearTimeout(keepAlive); }
});

test('local chat and remote vision accept answers after twelve seconds within their requested deadlines', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100_000 });
  for (const kind of ['chat', 'vision', 'vision-timeout']) {
    let signal, finish;
    const backend = host(async (_url, init) => { if (String(_url).endsWith('/api/show')) return json({ capabilities: ['completion'] }); signal = init.signal; return new Promise(resolve => { finish = resolve; }); });
    const pending = kind === 'chat'
      ? decisions.decideAppPlugin(backend, request({ source: 'local', endpoint: 'http://localhost:11434', protocol: 'ollama', model: 'm' }, { deadlineAt: Date.now() + 30_000 }))
      : decisions.describeAppPluginFrame(backend, { deadlineAt: Date.now() + 20_000, vision: { source: 'connection', connectionId: 'conn-relay', model: 'vendor/vision-chat' }, image: 'data:image/png;base64,AAAA' });
    await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(kind === 'vision-timeout' ? 20_000 : 15_000);
    assert.equal(signal.aborted, kind === 'vision-timeout');
    finish(kind === 'chat' ? json({ done: true, message: { content: '{"next":{"choice":"left","confidence":1}}' } }) : json({ choices: [{ message: { content: 'A coin' } }], usage: { cost: 0.01 } }));
    const result = await pending;
    assert.equal(result.ok, kind !== 'vision-timeout');
    if (kind === 'vision-timeout') { assert.equal(result.error, 'vision_timeout'); assert.equal(result.text, undefined); assert.equal(result.costUsd, 0.01); }
  }
});

test('marketplace downloads are checked: the listed digest, then the review signature against the built-in key', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('base64');
  const bytes = Buffer.from('a plugin package');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const signature = sign(null, Buffer.from(`nextmux-app-plugin/1\ncom.example.coin\n1.0.0\n${sha256}`), privateKey).toString('base64');
  assert.equal(market.verifyAppPluginSignature('com.example.coin', '1.0.0', sha256, signature, raw), true);
  assert.equal(market.verifyAppPluginSignature('com.example.coin', '1.0.1', sha256, signature, raw), false, 'bound to the version');
  assert.equal(market.verifyAppPluginSignature('com.example.coin', '1.0.0', sha256, signature), false, 'a key other than NextMux\'s never verifies');
  const routes = (body, listed = sha256) => fakeFetch([
    ['/download', () => new Response(body, { status: 200, headers: { 'x-nextmux-plugin-sha256': sha256, 'x-nextmux-plugin-signature': signature } })],
    ['/api/plugins/com.example.coin', () => json({ ok: true, plugin: { id: 'com.example.coin', name: { en: 'Coin' }, description: {}, author: { name: 'A' }, apps: [], latestApprovedVersion: '1.0.0', downloads: 3 },
      versions: [{ version: '1.0.0', sha256: listed, signature }] })],
    ['/api/plugins?', () => json({ ok: true, plugins: [{ id: 'com.example.coin', name: { en: 'Coin' }, description: { 'zh-CN': '接金币' }, author: { name: 'A' }, apps: [{ platform: 'macos', bundleId: 'x.y' }], latestApprovedVersion: '1.0.0', downloads: 3 }, { id: 'Not Valid' }], nextCursor: 'abc' })]
  ]);
  const good = routes(bytes);
  const listed = await market.listAppPluginMarket({ baseUrl: 'https://p', fetch: good.fetch }, { q: 'coin' });
  assert.equal(listed.plugins.length, 1, 'invalid entries are dropped');
  assert.equal(listed.nextCursor, 'abc');
  assert.match(good.calls[0].url, /q=coin/);
  const download = await market.downloadAppPluginFromMarket({ baseUrl: 'https://p', fetch: good.fetch }, 'com.example.coin', '1.0.0');
  assert.equal(download.ok, true);
  assert.equal(Buffer.from(download.dataBase64, 'base64').toString(), 'a plugin package');
  assert.equal(download.verified, false, 'signed with a test key, not NextMux\'s');
  const tampered = await market.downloadAppPluginFromMarket({ baseUrl: 'https://p', fetch: routes(Buffer.from('something else')).fetch }, 'com.example.coin', '1.0.0');
  assert.equal(tampered.error, 'package_digest_mismatch');
  assert.equal((await market.downloadAppPluginFromMarket({ baseUrl: 'https://p', fetch: good.fetch }, '../etc', '1.0.0')).error, 'plugin_id_invalid');
});

test('plugin trust is rendered from its four facts: a reviewed version is never shown as a local file', async () => {
    const { appPluginTrustBadge } = await import('../lib/browser/nextmux-app-plugins-view.js');
    const badge = trust => { const value = appPluginTrustBadge(trust); return [value.label, value.hint, value.tone]; };
    assert.deepEqual(badge({ source: 'marketplace', reviewStatus: 'approved', signaturePresent: true, signatureVerified: true }), ['verified', 'verifiedHint', 'is-ok']);
    assert.deepEqual(badge({ source: 'marketplace', reviewStatus: 'approved', signaturePresent: false, signatureVerified: false }), ['verified', 'reviewedUnsignedHint', 'is-ok']);
    assert.deepEqual(badge({ source: 'marketplace', reviewStatus: 'approved', signaturePresent: true, signatureVerified: false }), ['verified', 'reviewedSignedHint', 'is-ok']);
    assert.deepEqual(badge({ source: 'marketplace', reviewStatus: 'pending', signaturePresent: false, signatureVerified: false }), ['trustPending', 'pendingHint', 'is-warning']);
    assert.deepEqual(badge({ source: 'marketplace', reviewStatus: 'rejected', signaturePresent: true, signatureVerified: true }), ['trustRejected', 'rejectedHint', 'is-danger']);
    assert.deepEqual(badge({ source: 'local-file', reviewStatus: 'unreviewed', signaturePresent: false, signatureVerified: false }), ['trustLocal', 'unverifiedHint', 'is-muted']);
    assert.deepEqual(badge({ source: 'development', reviewStatus: 'unreviewed', signaturePresent: false, signatureVerified: false }), ['dev', 'unverifiedHint', 'is-muted']);
    assert.deepEqual(badge({ verified: true }), ['verified', 'verifiedHint', 'is-ok'], 'older records keep their meaning');
});
