import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentRunInterruptedError } from '@nextmux/agent-runtime';
import { OfficialModelError } from '@nextmux/model-runtime';
import { classifyModelError, formatModelError } from '@nextmux/model-runtime/errors';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { decideAppPlugin, describeAppPluginFrame } from '../lib/node/nextmux-app-plugin-decisions.js';
import { discoverConnectionModels } from '../lib/node/nextmux-official-discovery.js';

class BoundaryService extends NextMuxPlatformServiceImpl {
  classify(error) { return this.stableAgentRunError(error); }
  media(error) { return this.mediaFailure(error); }
  video(response) { return this.videoUpstreamError(response); }
  json(response) { return this.managedJson(response); }
}
// A decision call now needs the connection to list the model with decision capability
// (nextmux-app-plugin-decisions.ts:370-378); the transport itself is still inferred from the protocol.
const connection = { id: 'own', label: 'Fixture', providerName: 'Fixture', protocol: 'openrouter', baseUrl: 'https://provider.invalid/api/v1',
  models: [{ id: 'typesafe/jev-1.13' }, { id: 'decision-fixture', output: ['decisions'] }] };
const host = response => ({ baseUrl: 'https://relay.invalid', fetch: async () => response(), localFetch: async () => response(),
  deviceId: async () => 'fixture-device', connections: async () => [connection], connectionKey: async () => 'fixture-only' });
const question = model => ({ model, state: 'Fixture', questions: { next: { type: 'noul', instructions: 'Continue?' } } });

test('coding errors retain provider classification, detail and legacy replay barrier through interrupted runs', () => {
  const readableError = classifyModelError({ status: 400, error: { code: 'context_length_exceeded', message: 'Maximum context length is 32768 tokens.' } }, { source: 'own_api' });
  const original = new OfficialModelError('REQUEST_REJECTED', 'Provider rejected the request', { httpStatus: 400, retrySafe: false, readableError });
  const result = new BoundaryService().classify(new AgentRunInterruptedError(original, {}, []));
  assert.equal(result.readableError.kind, 'context_too_long');
  assert.match(result.readableError.detail, /32768/);
  assert.match(formatModelError(result.readableError, 'zh-CN').text, /上下文/);
  assert.equal(result.retryable, false);
  assert.equal(result.resumable, false);
});

test('video HTTP errors retain permission distinction, provider metadata and retry-after over RPC data', async () => {
  const error = await new BoundaryService().video(Response.json({ error: { code: 'content_policy_violation', message: 'Reference rejected',
    metadata: { provider_name: 'Fixture', raw: JSON.stringify({ message: 'Reference blocked by safety policy' }) } } }, { status: 403, headers: { 'retry-after': '7' } }));
  assert.equal(error.readableError.kind, 'content_refused');
  assert.equal(error.readableError.source, 'own_api');
  assert.equal(error.data.readableError.kind, 'content_refused');
  assert.match(error.data.readableError.detail, /Reference blocked/);
  assert.equal(error.data.retryAfterMs, 7000);
  assert.equal(new BoundaryService().media(error).readableError.kind, 'content_refused');
});

test('managed video RPC retains NextMux balance classification and useful upstream explanation', async () => {
  await assert.rejects(new BoundaryService().json(Response.json({ code: 'insufficient_balance', message: 'NextMux wallet balance is insufficient' }, { status: 402 })), error => {
    assert.equal(error.data.readableError.kind, 'balance_insufficient');
    assert.equal(error.data.readableError.source, 'relay');
    return true;
  });
});

test('decisions distinguish own-provider quota, relay balance and retry delay without changing legacy result codes', async () => {
  const own = await decideAppPlugin(host(() => Response.json({ error: { code: 402, message: 'Insufficient credits' } }, { status: 402 })),
    question({ source: 'connection', connectionId: 'own', model: 'typesafe/jev-1.13' }));
  assert.equal(own.error, 'decision_balance');
  assert.equal(own.readableError.kind, 'provider_quota_exhausted');
  const relay = await decideAppPlugin(host(() => Response.json({ code: 'insufficient_balance', message: 'NextMux balance insufficient' }, { status: 402 })),
    question({ source: 'nextmux', model: 'typesafe/jev-1.13' }));
  assert.equal(relay.readableError.kind, 'balance_insufficient');
  const limit = await decideAppPlugin(host(() => Response.json({ error: { code: 429, message: 'Rate limit exceeded' } }, { status: 429, headers: { 'retry-after': '11' } })),
    question({ source: 'connection', connectionId: 'own', model: 'typesafe/jev-1.13' }));
  assert.equal(limit.readableError.retryAfterSeconds, 11);
  assert.equal(limit.readableError.kind, 'rate_limited');
});

test('local systemone preserves plain-text unknown-model and FastAPI field validation details', async () => {
  const model = { source: 'local', model: 'missing-model', endpoint: 'http://127.0.0.1:8080', protocol: 'systemone' };
  const unknown = await decideAppPlugin(host(() => new Response('Unknown model: missing-model', { status: 400 })), question(model));
  assert.equal(unknown.readableError.kind, 'model_not_found');
  assert.match(unknown.readableError.detail, /missing-model/);
  const invalid = await decideAppPlugin(host(() => Response.json({ detail: [{ loc: ['body', 'questions'], msg: 'Input should be a valid dictionary', type: 'dict_type' }] }, { status: 422 })), question(model));
  assert.equal(invalid.readableError.kind, 'invalid_request');
  assert.match(invalid.readableError.parameter, /questions/);
  assert.equal(invalid.readableError.source, 'local');
});

test('vision error metadata reaches the widget for HTTP-200 error envelopes', async () => {
  const result = await describeAppPluginFrame(host(() => Response.json({ error: { code: 'content_policy_violation', message: 'Image rejected by content policy' } })),
    { vision: { source: 'connection', connectionId: 'own', model: 'vision-fixture' }, image: 'data:image/png;base64,AAAA' });
  assert.equal(result.ok, false);
  assert.equal(result.readableError.kind, 'content_refused');
  assert.equal(result.readableError.source, 'own_api');
});


test('opaque provider numeric codes keep provider identity through discovery and plugin RPC paths', async () => {
  const response = () => Response.json({ error: { code: '1113', message: 'Rejected' } }, { status: 429 });
  const providerHost = host(response);
  providerHost.connections = async () => [{ ...connection, providerId: 'zhipu' }];
  const decision = await decideAppPlugin(providerHost, question({ source: 'connection', connectionId: 'own', model: 'decision-fixture' }));
  assert.equal(decision.readableError.kind, 'provider_quota_exhausted');
  const discovery = await discoverConnectionModels({ providerId: 'zhipu', protocol: 'openai_chat_completions', baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: 'fixture-only', fetchImpl: async () => response() });
  assert.equal(discovery.modelDiscoveryError.kind, 'provider_quota_exhausted');
});


test('Settings missing own-API credentials point to Own API rather than switching a platform relay', async () => {
  class SettingsFixture extends BoundaryService {
    async readOfficialConnectionIndex() { return []; }
  }
  await assert.rejects(new SettingsFixture().saveOfficialModelConnection({ providerId: 'custom_openai', model: 'fixture-model',
    baseUrl: 'https://fixture.invalid/v1', validate: false }), error => {
    assert.equal(error.code, 'API_KEY_REQUIRED');
    assert.equal(error.data.readableError.kind, 'auth_missing');
    assert.equal(error.data.readableError.source, 'own_api');
    assert.equal(formatModelError(error.data.readableError, 'zh-CN').action, 'settings');
    return true;
  });
});
