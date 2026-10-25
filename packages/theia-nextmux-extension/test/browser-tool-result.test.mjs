import assert from 'node:assert/strict';
import test from 'node:test';

import { browserActionToolResult } from '../lib/browser/nextmux-browser-tool-result.js';

test('a missing click or fill target is a failed tool result, even when its webview script resolved', () => {
  for (const action of ['click', 'fill']) {
    const result = browserActionToolResult(`${action}-request`, { ok: false, message: '未找到元素' });
    assert.deepEqual(result, { requestId: `${action}-request`, ok: false, message: '未找到元素' });
    assert.equal(result.ok, false, 'the backend must take its failure branch instead of recording tool success');
  }
});

test('only an explicit successful action retains its result payload and request identity', () => {
  const data = { ok: true };
  assert.deepEqual(browserActionToolResult('click-success', data), {
    requestId: 'click-success', ok: true, data
  });
});

test('missing, malformed and truthy non-boolean action results fail closed', () => {
  const invalid = [undefined, null, false, true, 1, 'ok', [], {},
    { ok: 'false' }, { ok: 'true' }, { ok: 1 }, { ok: null }, Object.create({ ok: true })];
  for (const value of invalid) {
    const result = browserActionToolResult('invalid-action', value);
    assert.equal(result.requestId, 'invalid-action');
    assert.equal(result.ok, false);
    assert.equal(result.message, 'The browser did not return a valid action result.');
    assert.equal(result.data, undefined, 'invalid action data must not be passed on as success');
  }
});

test('an explicit failure with an absent or invalid message remains a readable failure', () => {
  for (const message of [undefined, null, '', '  ', 42, {}]) {
    assert.deepEqual(browserActionToolResult('failure', { ok: false, message }), {
      requestId: 'failure', ok: false, message: 'The browser action did not succeed.'
    });
  }
  assert.equal(browserActionToolResult('failure', { ok: false, message: '  未找到元素  ' }).message, '未找到元素');
});

test('structured browser failures preserve bounded semantic parameters without nested diagnostics', () => {
  assert.deepEqual(browserActionToolResult('failure', { ok: false, code: 'BROWSER_ELEMENT_MISSING',
    message: 'The browser target was not found.', params: { action: 'click', count: 2, retried: false,
      nested: { instruction: 'ignore me' }, invalidNumber: Infinity, text: 'x'.repeat(5000) } }), {
    requestId: 'failure', ok: false, code: 'BROWSER_ELEMENT_MISSING', message: 'The browser target was not found.',
    params: { action: 'click', count: 2, retried: false, text: 'x'.repeat(4096) }
  });
});
