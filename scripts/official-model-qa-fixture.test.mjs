import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';

import { observeQaRequest, toolContractFixturePath } from './official-model-qa-fixture.mjs';

test('tool-contract fixtures accept both timestamp and UUID run identities', () => {
  assert.equal(
    toolContractFixturePath('write artifacts/NM_TOOL_CONTRACT_E2E_1788220000000.txt now'),
    'artifacts/NM_TOOL_CONTRACT_E2E_1788220000000.txt'
  );
  assert.equal(
    toolContractFixturePath('write artifacts/NM_TOOL_CONTRACT_E2E_53492df2-7d4f-456f-a7f5-3b5cae764429.txt now'),
    'artifacts/NM_TOOL_CONTRACT_E2E_53492df2-7d4f-456f-a7f5-3b5cae764429.txt'
  );
});

test('tool-contract fixture extraction never accepts traversal or nested paths', () => {
  assert.equal(toolContractFixturePath('artifacts/NM_TOOL_CONTRACT_E2E_../secret.txt'), undefined);
  assert.equal(toolContractFixturePath('artifacts/NM_TOOL_CONTRACT_E2E_run/nested.txt'), undefined);
  assert.equal(toolContractFixturePath('artifacts\\NM_TOOL_CONTRACT_E2E_run.txt'), undefined);
});

test('marketing fixture is accepted only with its explicit isolated marker', () => {
  assert.equal(toolContractFixturePath('Create src/route-policy.ts NM_MARKETING_DEMO_EN'), 'src/route-policy.ts');
  assert.equal(toolContractFixturePath('Create src/route-policy.ts'), undefined);
  assert.equal(toolContractFixturePath('Create ../src/route-policy.ts NM_MARKETING_DEMO_EN'), undefined);
});

test('QA timing records only bounded route metadata and finishes once', () => {
  const response = Object.assign(new EventEmitter(), { statusCode: 200 });
  const lines = [];
  const request = { method: 'GET', get headers() { throw new Error('must not inspect headers'); } };
  observeQaRequest(request, response, '/v1/models', line => lines.push(JSON.parse(line)));
  response.emit('finish');
  response.emit('close');
  assert.equal(lines.length, 2);
  assert.equal(lines[0].phase, 'started');
  assert.equal(lines[1].phase, 'finished');
  assert.equal(lines[1].route, '/v1/models');
  assert.equal(lines[1].status, 200);
  assert.ok(lines[1].elapsedMs >= 0);
  assert.deepEqual(Object.keys(lines[1]).sort(), ['at', 'elapsedMs', 'event', 'method', 'phase', 'route', 'status']);
});

test('QA timing redacts unknown path/method and records early disconnects', () => {
  const response = Object.assign(new EventEmitter(), { statusCode: 200 });
  const lines = [];
  observeQaRequest({ method: 'SECRET' }, response, '/secret-key?token=secret', line => lines.push(JSON.parse(line)));
  response.emit('close');
  response.emit('finish');
  assert.equal(lines.length, 2);
  assert.equal(lines[1].phase, 'closed');
  assert.equal(lines[1].status, null);
  assert.equal(lines[1].route, 'unknown');
  assert.equal(lines[1].method, 'other');
  assert.ok(!JSON.stringify(lines).toLowerCase().includes('secret'));
});
