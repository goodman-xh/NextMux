import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentRunInterruptedError } from '@nextmux/agent-runtime';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

class ProbePlatformService extends NextMuxPlatformServiceImpl {
  classify(error) {
    return this.stableAgentRunError(error);
  }

  status(error) {
    return this.terminalAgentStatus(this.classify(error));
  }
}

test('the desktop service keeps an SDK-wrapped 429 resumable instead of a generic failure', () => {
  const failure = new ProbePlatformService().classify(new Error(
    'exceeded retry limit, last status: 429 Too Many Requests, request id: desktop-wrapped-429-001',
  ));

  assert.equal(failure.readableError.kind, 'rate_limited');
  assert.match(failure.readableError.detail, /exceeded retry limit/);
  const { readableError, ...lifecycleFailure } = failure;
  assert.deepEqual(lifecycleFailure, {
    code: 'RATE_LIMITED',
    message: '官方模型正在限流，请稍后重试',
    kind: 'rate_limited',
    retryable: true,
    resumable: true,
    httpStatus: 429,
  });
  assert.equal(new ProbePlatformService().status(new Error(
    'exceeded retry limit, last status: 429 Too Many Requests, request id: desktop-wrapped-429-001',
  )), 'rate_limited');
});

test('the desktop service does not turn an unrelated retry limit into rate limiting', () => {
  const failure = new ProbePlatformService().classify(new Error(
    'exceeded retry limit while parsing a local workflow',
  ));

  assert.equal(failure.kind, 'failed');
  assert.equal(failure.code, 'AGENT_RUN_FAILED');
  assert.equal(failure.resumable, false);
});

test('the desktop service preserves an explicit unsafe retry signal on a resumable 429', () => {
  const providerError = Object.assign(new Error('429 Too Many Requests'), {
    code: 'RATE_LIMITED',
    status: 429,
    retryable: true,
    retrySafe: false,
  });
  const interrupted = new AgentRunInterruptedError(providerError, {}, []);
  const failure = new ProbePlatformService().classify(interrupted);

  assert.equal(failure.kind, 'rate_limited');
  assert.equal(failure.resumable, true);
  assert.equal(failure.retrySafe, false);
});

test('legacy ROUTE_PRIVACY_UNAVAILABLE is treated as a retryable model route outage instead of blocking on privacy settings', () => {
  const providerError = Object.assign(new Error('No available route meets your privacy settings'), {
    code: 'ROUTE_PRIVACY_UNAVAILABLE', status: 400, retryable: false, retrySafe: false,
  });
  const interrupted = new AgentRunInterruptedError(providerError, {}, []);
  const service = new ProbePlatformService();
  const failure = service.classify(interrupted);
  assert.equal(failure.code, 'ROUTE_PRIVACY_UNAVAILABLE');
  assert.equal(failure.kind, 'model_unavailable');
  assert.equal(failure.retryable, true);
  assert.equal(service.status(interrupted), 'model_unavailable');
});
