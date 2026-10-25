#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  assertExactQaComposerRoute,
  exactQaRouteExpectation,
  officialQaRouteConfig,
  qaConnectionMatches
} from './desktop-official-qa-route.mjs';
import {
  assertExactAgentRunRpc,
  assertDisposableDesktopE2E,
  extractAgentRunRpcRequests,
  normalizeEndpointForComparison,
  throwPrimaryOrCleanupErrors,
  uniqueNewResourceId
} from './desktop-e2e-state.mjs';

const desktopRequire = createRequire(pathToFileURL(resolve('apps/desktop/package.json')));
const { defaultMsgPack } = desktopRequire('@theia/core/lib/common/message-rpc/rpc-message-encoder');

function encodeLength(value) {
  const bytes = [];
  let remaining = value;
  do {
    const next = remaining & 127;
    remaining >>= 7;
    bytes.push(remaining ? 128 + next : next);
  } while (remaining);
  return Buffer.from(bytes);
}

function theiaRpcFrame(message) {
  const channel = Buffer.from('/services/nextmux-platform');
  const channelLength = Buffer.alloc(4);
  channelLength.writeUInt32BE(channel.length);
  const payload = Buffer.from(defaultMsgPack.encode(message));
  return {
    kind: 'binary',
    data: Buffer.concat([Buffer.from([4]), channelLength, channel, encodeLength(payload.length), payload]).toString('base64')
  };
}

test('the default QA model is the dedicated localhost fixture model', () => {
  const config = officialQaRouteConfig({});
  assert.equal(config.modelId, 'custom_openai/gpt-nextmux-qa-model');
  assert.equal(config.providerModelId, 'gpt-nextmux-qa-model');
  assert.equal(config.endpoint, 'http://127.0.0.1:4181/v1');
});

test('environment overrides keep the provider model and localhost port aligned', () => {
  const config = officialQaRouteConfig({
    NEXTMUX_E2E_MODEL_ID: 'custom_openai/qa-override-model',
    NEXTMUX_OFFICIAL_QA_PORT: '4191',
    NEXTMUX_E2E_CONNECTION_LABEL: 'NextMux duplicate route QA'
  }, 'route-isolation-1234');
  assert.equal(config.modelId, 'custom_openai/qa-override-model');
  assert.equal(config.providerModelId, 'qa-override-model');
  assert.equal(config.endpoint, 'http://127.0.0.1:4191/v1');
  assert.equal(config.connectionLabel, 'NextMux duplicate route QA · route-isolat');
  assert.equal(config.connectionLabelPrefix, 'NextMux duplicate route QA');
  assert.equal(config.localSecret, 'nextmux-qa-secret');
});

test('every QA run receives an isolated temporary connection name', () => {
  const first = officialQaRouteConfig({}, 'first-run-0001');
  const second = officialQaRouteConfig({}, 'second-run-0002');
  assert.notEqual(first.connectionLabel, second.connectionLabel);
  assert.match(first.connectionLabel, /^NextMux E2E QA · first-run-00/);
});

test('temporary resource recovery only accepts one ID absent from the baseline', () => {
  assert.equal(uniqueNewResourceId(['existing-a'], ['existing-a'], 'QA resource'), '');
  assert.equal(uniqueNewResourceId(['existing-a'], ['existing-a', 'temporary-b'], 'QA resource'), 'temporary-b');
  assert.throws(
    () => uniqueNewResourceId(['existing-a'], ['existing-a', 'temporary-b', 'temporary-c'], 'QA resource'),
    /Refusing to guess.*2 new IDs/
  );
});

test('mutating desktop E2E state and agent checkpoints must stay inside the disposable profile', () => {
  const profile = resolve('.tmp-nextmux-e2e-profile');
  assert.deepEqual(assertDisposableDesktopE2E({
    NEXTMUX_DESKTOP_E2E_ISOLATED: '1',
    NEXTMUX_DESKTOP_E2E_PROFILE_DIR: profile,
    NEXTMUX_DESKTOP_STATE_DIR: join(profile, 'state'),
    NEXTMUX_AGENT_STATE_DIR: join(profile, 'agent-state')
  }), {
    agentState: join(profile, 'agent-state'),
    profile,
    state: join(profile, 'state')
  });
  assert.throws(() => assertDisposableDesktopE2E({
    NEXTMUX_DESKTOP_E2E_ISOLATED: '1',
    NEXTMUX_DESKTOP_E2E_PROFILE_DIR: profile,
    NEXTMUX_DESKTOP_STATE_DIR: join(profile, 'state'),
    NEXTMUX_AGENT_STATE_DIR: resolve('.outside-agent-state')
  }), /agent state directory must be a child/);
});

test('a cleanup failure never hides the primary E2E failure', () => {
  const primary = new Error('primary failure');
  const cleanup = new Error('cleanup failure');
  assert.throws(() => throwPrimaryOrCleanupErrors(primary, [], 'fixture'), error => error === primary);
  assert.throws(() => throwPrimaryOrCleanupErrors(undefined, [cleanup], 'fixture'), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [cleanup]);
    return true;
  });
  assert.throws(() => throwPrimaryOrCleanupErrors(primary, [cleanup], 'fixture'), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.cause, primary);
    assert.deepEqual(error.errors, [primary, cleanup]);
    return true;
  });
});

test('a matching label never hides an endpoint or model mismatch', () => {
  const config = officialQaRouteConfig({ NEXTMUX_OFFICIAL_QA_PORT: '4189' });
  assert.equal(qaConnectionMatches({ label: config.connectionLabel, model: 'gpt-nextmux-qa-model', endpoint: 'HTTP://127.0.0.1:4189/v1/' }, config), true);
  assert.equal(qaConnectionMatches({ label: config.connectionLabel, model: 'gpt-nextmux-qa-model', endpoint: 'http://127.0.0.1:4189/V1' }, config), false);
  assert.equal(qaConnectionMatches({ label: config.connectionLabel, model: 'gpt-nextmux-qa-model', endpoint: 'https://relay.invalid/v1' }, config), false);
  assert.equal(qaConnectionMatches({ label: config.connectionLabel, model: 'another-model', endpoint: 'http://127.0.0.1:4189/v1' }, config), false);
});

test('endpoint comparison folds scheme and host but preserves path case', () => {
  assert.equal(
    normalizeEndpointForComparison('HTTP://LOCALHOST:4181/v1/'),
    normalizeEndpointForComparison('http://localhost:4181/v1')
  );
  assert.notEqual(
    normalizeEndpointForComparison('http://localhost:4181/V1'),
    normalizeEndpointForComparison('http://localhost:4181/v1')
  );
});

test('structured JSON-RPC assertions inspect the request route instead of string inclusion', () => {
  const expected = exactQaRouteExpectation('qa-connection-b', officialQaRouteConfig({}, 'rpc-test'));
  const frames = [
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'unrelated', params: [{ connectionId: expected.connectionId }] }),
    JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'startAgentRun',
      params: [{
        prompt: 'RPC_MARKER',
        route: { kind: 'official_connection', connectionId: expected.connectionId, model: expected.providerModelId }
      }]
    })
  ];
  assert.equal(extractAgentRunRpcRequests(frames).length, 1);
  assert.equal(assertExactAgentRunRpc(frames, expected, { marker: 'RPC_MARKER' }).method, 'startAgentRun');
  assert.equal(assertExactAgentRunRpc([
    JSON.stringify({
      jsonrpc: '2.0', id: 4, method: 'service/runAgent', params: { request: {
        prompt: 'SCHEDULED_RPC_MARKER',
        route: { kind: 'official_connection', connectionId: expected.connectionId, model: expected.providerModelId }
      } }
    })
  ], expected, { marker: 'SCHEDULED_RPC_MARKER' }).method, 'service/runAgent');
  assert.throws(() => assertExactAgentRunRpc([
    JSON.stringify({
      jsonrpc: '2.0', id: 3, method: 'startAgentRun', params: [{
        prompt: `RPC_MARKER ${expected.connectionId}`,
        route: { kind: 'managed_gateway', connectionId: expected.connectionId, model: expected.providerModelId }
      }]
    })
  ], expected, { marker: 'RPC_MARKER' }), /No matching JSON-RPC request/);
  assert.throws(() => assertExactAgentRunRpc([
    JSON.stringify({
      jsonrpc: '2.0', id: 5, method: 'startAgentRun', params: [{
        prompt: 'DIFFERENT_PROMPT',
        telemetry: { staleText: 'RPC_MARKER' },
        route: { kind: 'official_connection', connectionId: expected.connectionId, model: expected.providerModelId }
      }]
    })
  ], expected, { marker: 'RPC_MARKER' }), /No structured startAgentRun\/runAgent/,
  'a marker outside request.prompt must never associate a stale RPC with the current task');
});

test('the actual Theia Socket.IO binary RPC frame is decoded without patching the model call', () => {
  const expected = exactQaRouteExpectation('qa-binary-connection', officialQaRouteConfig({}, 'binary-rpc'));
  const request = {
    prompt: 'THEIA_BINARY_MARKER',
    route: { kind: 'official_connection', connectionId: expected.connectionId, model: expected.providerModelId }
  };
  const frames = [
    { kind: 'text', data: '451-["message",{"_placeholder":true,"num":0}]' },
    theiaRpcFrame({ type: 1, id: 19, method: 'startAgentRun', args: [request] })
  ];
  const captured = assertExactAgentRunRpc(frames, expected, { marker: 'THEIA_BINARY_MARKER' });
  assert.equal(captured.method, 'startAgentRun');
  assert.deepEqual(captured.request.route, request.route);
});

test('the same model ID on another compatible connection is rejected', () => {
  const config = officialQaRouteConfig({});
  const expected = exactQaRouteExpectation('qa-connection-b', config);
  assert.throws(() => assertExactQaComposerRoute({
    modelId: config.modelId,
    routeId: 'official:qa-connection-a',
    persistedRouteId: 'official:qa-connection-a',
    relayKey: 'official:qa-connection-a'
  }, expected), /not bound to the exact local QA connection/);
  assert.throws(() => assertExactQaComposerRoute({
    modelId: expected.modelId,
    routeId: expected.routeId,
    persistedRouteId: expected.routeId,
    relayKey: expected.relayKey,
    session: { routeId: 'official:qa-connection-a', relayKey: 'official:qa-connection-a' }
  }, expected), /session\.routeId/);
  assert.throws(() => assertExactQaComposerRoute({
    modelId: config.modelId,
    routeId: expected.routeId,
    persistedRouteId: expected.routeId,
    relayKey: expected.relayKey
  }, expected), /active session/i);
  assert.throws(() => assertExactQaComposerRoute({
    modelId: config.modelId,
    routeId: expected.routeId,
    persistedRouteId: expected.routeId,
    relayKey: expected.relayKey,
    session: { routeId: expected.routeId, relayKey: expected.relayKey, modelId: 'custom_openai/wrong-model' }
  }, expected), /session\.modelId/);
  assert.doesNotThrow(() => assertExactQaComposerRoute({
    modelId: config.modelId,
    routeId: expected.routeId,
    persistedRouteId: expected.routeId,
    relayKey: expected.relayKey,
    session: { id: 'temporary-session', routeId: expected.routeId, relayKey: expected.relayKey, modelId: expected.modelId }
  }, expected));
});
