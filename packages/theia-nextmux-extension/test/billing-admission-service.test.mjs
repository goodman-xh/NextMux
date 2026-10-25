import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { canRecoverBilling } from '../lib/node/nextmux-billing-recovery.js';

const codes = ['wallet_no_hold_control_unavailable', 'platform_quantity_tariff_required'];
const details = { providerAccepted: false, notDispatched: true, localPolicy: true, retrySafe: false, retryable: false };
const ndjson = rows => new Response(rows.map(row => JSON.stringify(row)).join('\n'), { headers: { 'content-type': 'application/x-ndjson' } });
class Service extends NextMuxPlatformServiceImpl {
  nextmuxDataRoot() { return this.root; }
  async getPrivacySettings() { return {}; }
  async deviceId() { return 'billing-admission-device'; }
  managedSessionPool() { return undefined; }
  stream() { return this.completeManagedGatewayWithEvents({ mode: 'fixed', offeringId: 'fixture' },
    { messages: [], tools: [], workbench: 'coding' }, 'billing-admission-request', undefined, {}); }
  consume(response) { return this.consumeManagedGatewayStream(response, {}, true); }
}
async function fixture(t) {
  const service = new Service();
  service.root = await realpath(await mkdtemp(join(tmpdir(), 'billing-admission-client-')));
  service.baseUrl = 'https://billing-admission.invalid'; service.mediaDeliveryAccountId = 'fixture-owner';
  t.after(() => rm(service.root, { recursive: true, force: true }));
  return service;
}

for (const code of codes) for (const streaming of [false, true])
  test(`${code} via ${streaming ? 'NDJSON' : 'JSON'} preserves local refusal without retry or billing recovery`, async t => {
    const service = await fixture(t), urls = [];
    service.networkFetch = async url => {
      urls.push(new URL(url).pathname);
      return streaming ? ndjson([{ type: 'error', error: { code, status: 503, ...details } }])
        : Response.json({ code, message: 'Configuration required', details }, { status: 503 });
    };
    await assert.rejects(service.stream(), error => {
      assert.equal(error.code, code); assert.equal(error.status, 503);
      assert.equal(error.localPolicy, true); assert.equal(error.providerAccepted, false);
      assert.equal(error.notDispatched, true); assert.equal(error.retrySafe, false); assert.equal(error.retryable, false);
      assert.equal(error.partial, false); assert.equal(error.settled, false); assert.equal(error.resumable, false);
      assert.equal(canRecoverBilling(error), false);
      return true;
    });
    assert.deepEqual(urls, ['/api/gateway/responses']);
  });

for (const code of codes) test(`${code} cannot erase prior output or accepted provider evidence`, async t => {
  const service = await fixture(t);
  await assert.rejects(service.consume(ndjson([{ type: 'response.started' }, { type: 'content.delta', delta: 'paid partial' },
    { type: 'error', error: { code, status: 503, ...details } }])), error => {
    assert.equal(error.localPolicy, undefined); assert.equal(error.providerAccepted, true);
    assert.equal(error.partial, true); assert.equal(error.retrySafe, false); assert.equal(error.retryable, false);
    return true;
  });
});

for (const code of codes) test(`${code} needs explicit non-dispatch evidence before marking a local refusal`, async t => {
  const service = await fixture(t);
  await assert.rejects(service.consume(Response.json({ code, details: { ...details, notDispatched: undefined } }, { status: 503 })), error => {
    assert.equal(error.localPolicy, undefined); assert.equal(error.retrySafe, false); assert.equal(error.retryable, false);
    return true;
  });
});
