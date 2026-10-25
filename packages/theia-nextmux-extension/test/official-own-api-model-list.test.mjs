import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { effectiveModelCapabilityEvidence, modelCapabilityHasVerifiedSupport } from '@nextmux/model-runtime/capabilities';

import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

const BASE_URL = 'https://api.supergpt.test/v1';
const API_KEY = 'sk-test-0123456789abcdef';

// The own API lists picture, utility and chat models together, in the order its /models endpoint returns them.
const LISTED_MODELS = [
  'codex-auto-review',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-6-astra',
  'gpt-6-sol',
  'gpt-6.1-sol',
  'gpt-image-1',
  'gpt-image-1.5',
  'gpt-image-2',
  'gpt-image-2.5-flare',
  'gpt-image-2.5-sunburst',
];

/** A passing connection check: one streamed OpenAI Chat Completions tool call for nextmux_connection_check. */
function passingCheck(model) {
  const base = { id: `chatcmpl-${model}`, object: 'chat.completion.chunk', created: 1, model };
  const chunks = [
    { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: null, tool_calls: [{ index: 0, id: 'call-nextmux-connection-check', type: 'function', function: { name: 'nextmux_connection_check', arguments: '' } }] }, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"code":"OK"}' } }] }, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
  ];
  return new Response(`${chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  });
}

/** This key cannot call the model: a model-specific refusal, not an API failure. */
function modelRefusal(model) {
  return Response.json({
    error: {
      message: `The model \`${model}\` does not exist`,
      type: 'invalid_request_error',
      code: 'model_not_found',
    },
  }, { status: 404 });
}

/** The key exists but is not entitled to this model: also a model-specific refusal. */
function modelForbidden(model) {
  return Response.json({
    error: {
      message: `You do not have permission to access the model \`${model}\``,
      type: 'permission_error',
      code: 'permission_denied',
    },
  }, { status: 403 });
}

/** The API itself refused the request (rate limit): nothing is learned about the model. */
function rateLimited() {
  return Response.json({
    error: { message: 'Rate limit reached for requests', type: 'rate_limit_error', code: 'rate_limit_exceeded' },
  }, { status: 429 });
}

async function createHarness({ respond = model => passingCheck(model) } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-own-api-models-'));
  const requests = [];
  const state = {
    models: [...LISTED_MODELS],
    respond,
  };
  class TestPlatformService extends NextMuxPlatformServiceImpl {
    credentials = new Map();
    networkFetch = async (input, init) => {
      const url = String(input);
      const method = String(init?.method || 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      requests.push({ method, url, model: body?.model });
      if (method === 'GET' && url.endsWith('/models')) {
        return Response.json({
          object: 'list',
          data: state.models.map(id => ({ id, object: 'model', created: 0, owned_by: 'supergpt' })),
        });
      }
      if (method === 'POST' && url.endsWith('/chat/completions')) return state.respond(body?.model);
      throw new Error(`Unexpected request: ${method} ${url}`);
    };
    nextmuxDataRoot() { return root; }
    readOfficialCredential(connectionId) { return Promise.resolve(this.credentials.get(connectionId) || null); }
    writeOfficialCredential(connectionId, secret) { this.credentials.set(connectionId, secret); return Promise.resolve(); }
    deleteOfficialCredential(connectionId) { this.credentials.delete(connectionId); return Promise.resolve(); }
  }
  return {
    service: new TestPlatformService(),
    requests,
    state,
    async close() { await rm(root, { recursive: true, force: true }); },
  };
}

function saveRequest(overrides = {}) {
  return {
    providerId: 'custom_openai',
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    model: '',
    validate: true,
    ...overrides,
  };
}

/** The models a paid connection check was spent on, in order. */
function checkedModels(requests) {
  return requests
    .filter(request => request.method === 'POST' && request.url.endsWith('/chat/completions'))
    .map(request => request.model);
}

function assertVerifiedGeneratableEvidence(connection) {
  const generatable = effectiveModelCapabilityEvidence(connection.capabilityEvidence, 'model:generatable');
  assert.equal(generatable?.support, 'supported', 'the configured model must be generatable');
  assert.equal(generatable?.confidence, 'verified', 'generatable support must be verified, not merely inferred');
  assert.equal(modelCapabilityHasVerifiedSupport(connection.capabilityEvidence, 'model:generatable'), true);

  const tools = effectiveModelCapabilityEvidence(connection.capabilityEvidence, 'tools');
  assert.equal(tools?.support, 'supported', 'the configured model must support tool calls');
  assert.equal(tools?.confidence, 'verified', 'tool support must be verified, not merely inferred');
  assert.equal(modelCapabilityHasVerifiedSupport(connection.capabilityEvidence, 'tools'), true);
}

test('an empty model auto-picks the first listed chat model and pays for exactly one check', async () => {
  const harness = await createHarness();
  try {
    const result = await harness.service.saveOfficialModelConnection(saveRequest());

    assert.equal(result.connection.model, 'gpt-5.6-sol');
    assert.deepEqual(checkedModels(harness.requests), ['gpt-5.6-sol'],
      'only the auto-picked chat model may be checked; utility and picture models are never sent a chat request');
    assert.equal(result.connection.status, 'verified');
    assert.equal(result.connection.toolCapability, 'verified');
    assert.ok(result.validation, 'a successful check must be reported to the caller');
    assert.equal(result.validation.toolCalling, true);
    assertVerifiedGeneratableEvidence(result.connection);
  } finally {
    await harness.close();
  }
});

test('a refused auto-pick falls back to the next listed chat model and keeps the one that passes', async () => {
  const harness = await createHarness({
    respond: model => model === 'gpt-5.6-sol' ? modelRefusal(model) : passingCheck(model),
  });
  try {
    const result = await harness.service.saveOfficialModelConnection(saveRequest());

    assert.equal(result.connection.model, 'gpt-5.6-terra');
    assert.deepEqual(checkedModels(harness.requests), ['gpt-5.6-sol', 'gpt-5.6-terra'],
      'the fallback must walk the list in order and stop at the first passing model');
    assert.equal(result.connection.status, 'verified');
    assert.equal(result.connection.toolCapability, 'verified');
    assertVerifiedGeneratableEvidence(result.connection);
  } finally {
    await harness.close();
  }
});

test('an auto-pick refused everywhere stops after two fallbacks and saves the connection unverified', async () => {
  const harness = await createHarness({ respond: model => modelRefusal(model) });
  try {
    const result = await harness.service.saveOfficialModelConnection(saveRequest());

    assert.deepEqual(checkedModels(harness.requests), ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-6-astra'],
      'a model-specific refusal tries at most two more listed chat models');
    assert.equal(result.connection.model, 'gpt-5.6-sol', 'the connection keeps its configured model');
    assert.equal(result.connection.status, 'unverified');
    assert.equal(result.validation, undefined, 'no check passed, so there is no validation result');
    assert.equal(harness.requests.filter(request => request.method === 'GET' && request.url.endsWith('/models')).length, 1,
      'the model list is read once per save');
  } finally {
    await harness.close();
  }
});

test('a permission refusal of the auto-pick also falls back instead of ending the save', async () => {
  const harness = await createHarness({
    respond: model => model === 'gpt-5.6-sol' ? modelForbidden(model) : passingCheck(model),
  });
  try {
    const result = await harness.service.saveOfficialModelConnection(saveRequest());

    assert.deepEqual(checkedModels(harness.requests), ['gpt-5.6-sol', 'gpt-5.6-terra'],
      'a model the key may not use is a model-specific refusal, like a missing model');
    assert.equal(result.connection.model, 'gpt-5.6-terra');
    assert.equal(result.connection.status, 'verified');
    assertVerifiedGeneratableEvidence(result.connection);
  } finally {
    await harness.close();
  }
});

test('an API failure during the check stops after one request and the authenticated list stands in', async () => {
  const harness = await createHarness({ respond: () => rateLimited() });
  try {
    const result = await harness.service.saveOfficialModelConnection(saveRequest());

    assert.deepEqual(checkedModels(harness.requests), ['gpt-5.6-sol'],
      'a rate limit says nothing about the model, so no further paid checks are made');
    assert.equal(result.connection.model, 'gpt-5.6-sol');
    assert.equal(result.connection.status, 'verified');
    assert.equal(result.connection.toolCapability, 'verified');
    assertVerifiedGeneratableEvidence(result.connection);
  } finally {
    await harness.close();
  }
});

test('saving without validation only reads the model list and still verifies a listed chat model', async () => {
  const harness = await createHarness();
  try {
    const result = await harness.service.saveOfficialModelConnection(saveRequest({ validate: false }));

    assert.deepEqual(checkedModels(harness.requests), [], 'validate: false must never send a paid chat request');
    assert.deepEqual(harness.requests.map(request => `${request.method} ${request.url}`), [`GET ${BASE_URL}/models`]);
    assert.equal(result.connection.model, 'gpt-5.6-sol');
    assert.equal(result.connection.status, 'verified');
    assert.equal(result.connection.toolCapability, 'verified');
    assert.equal(result.validation, undefined);
    assertVerifiedGeneratableEvidence(result.connection);
  } finally {
    await harness.close();
  }
});

test('a typed model is checked alone and its refusal rejects the save', async () => {
  const harness = await createHarness({ respond: model => modelRefusal(model) });
  try {
    await assert.rejects(harness.service.saveOfficialModelConnection(saveRequest({ model: 'gpt-6-sol' })));

    assert.deepEqual(checkedModels(harness.requests), ['gpt-6-sol'],
      'a typed model gets one check and no automatic fallback');
    const state = await harness.service.getOfficialModelConnections();
    assert.deepEqual(state.connections, [], 'a rejected save must not persist a connection');
  } finally {
    await harness.close();
  }
});

test('re-listing a catalog without the configured model drops its models_endpoint evidence', async () => {
  const harness = await createHarness({ respond: model => modelRefusal(model) });
  try {
    const saved = await harness.service.saveOfficialModelConnection(saveRequest());
    const connection = saved.connection;
    assert.equal(connection.status, 'unverified');
    assert.equal(connection.model, 'gpt-5.6-sol');
    assert.ok(connection.capabilityEvidence.some(item =>
      item.capability === 'model:generatable' && item.source === 'models_endpoint' && item.support === 'supported'),
    'while the model is listed, the model list is its generatable evidence');
    assert.ok(connection.capabilityEvidence.some(item =>
      item.capability === 'tools' && item.source === 'models_endpoint' && item.support === 'supported'),
    'while the model is listed, the model list is its tool-calling evidence');

    harness.state.models = LISTED_MODELS.filter(model => model !== 'gpt-5.6-sol');
    const refreshed = await harness.service.refreshOfficialModelDiscovery(connection.id);

    assert.equal(refreshed.model, 'gpt-5.6-sol', 'refreshing the catalog must not rename the configured model');
    assert.equal(harness.requests.filter(request => request.method === 'GET' && request.url.endsWith('/models')).length, 2,
      'the refresh must re-read the model list');
    assert.deepEqual(refreshed.discoveredModels.map(item => item.id).filter(id => id === 'gpt-5.6-sol'), [],
      'the refreshed catalog no longer lists the configured model');
    assert.deepEqual(refreshed.capabilityEvidence.filter(item =>
      item.capability === 'model:generatable' && item.source === 'models_endpoint'), [],
    'evidence derived from the model list must not outlive the listing');
    assert.equal(modelCapabilityHasVerifiedSupport(refreshed.capabilityEvidence, 'model:generatable'), false);

    const reread = (await harness.service.getOfficialModelConnections()).connections.find(item => item.id === connection.id);
    assert.ok(reread, 'the connection stays readable');
    assert.deepEqual(reread.capabilityEvidence.filter(item =>
      item.capability === 'model:generatable' && item.source === 'models_endpoint'), [],
    'reading the connection re-derives the same evidence');
    assert.equal(modelCapabilityHasVerifiedSupport(reread.capabilityEvidence, 'model:generatable'), false);
  } finally {
    await harness.close();
  }
});

test('an unverified connection saved again unchanged is verified by the list, while a kept check result wins', async () => {
  const harness = await createHarness({ respond: model => modelRefusal(model) });
  try {
    const { connection } = await harness.service.saveOfficialModelConnection(saveRequest());
    assert.equal(connection.status, 'unverified');
    // Saved again without a check ("仅保存"): a kept 'unverified' says less than the API's own list.
    const resaved = await harness.service.saveOfficialModelConnection(saveRequest({ connectionId: connection.id, apiKey: undefined, validate: false }));
    assert.equal(resaved.connection.model, 'gpt-5.6-sol');
    assert.deepEqual([resaved.connection.status, resaved.connection.toolCapability], ['verified', 'verified']);

    // A kept check result is more specific than the list: an older save that verified the model but saw no tool
    // call (recorded on the connection only, without a per-model validation entry) stays 'failed'.
    harness.state.respond = model => passingCheck(model);
    await harness.service.saveOfficialModelConnection(saveRequest({ connectionId: connection.id, apiKey: undefined, model: 'gpt-6-sol' }));
    const stored = (await harness.service.getOfficialModelConnections()).connections[0];
    await harness.service.writeOfficialConnectionIndex([{ ...stored, toolCapability: 'failed',
      discoveredModels: stored.discoveredModels.map(({ validation, ...entry }) => entry) }]);
    const kept = await harness.service.saveOfficialModelConnection(saveRequest({ connectionId: connection.id, apiKey: undefined, model: 'gpt-6-sol', validate: false }));
    assert.deepEqual([kept.connection.status, kept.connection.toolCapability], ['verified', 'failed']);
  } finally {
    await harness.close();
  }
});
