import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { APP_PLUGIN_RECEIPT_LIMIT, recordAppPluginReceipt } from '../lib/node/nextmux-app-plugin-receipts.js';

test('backend retains late decision and vision charges after the renderer connection is disposed', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-plugin-receipts-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const kind of ['decision', 'vision']) {
    let finish, signal, started;
    const dispatched = new Promise(resolve => { started = resolve; });
    class ReceiptService extends NextMuxPlatformServiceImpl {
      nextmuxDataRoot() { return root; }
      appPluginHost() {
        return { requestScope: this.appPluginRequestScope, baseUrl: 'https://fixture.invalid', deviceId: async () => 'fixture',
          connections: async () => [{ id: 'fixture', protocol: 'openai_chat_completions', baseUrl: 'https://fixture.invalid/v1', models: [] }],
          connectionKey: async () => 'fixture-key',
          fetch: async (_url, init) => { signal = init.signal; started(); return new Promise(resolve => { finish = resolve; }); } };
      }
    }
    const service = new ReceiptService();
    const result = kind === 'decision'
      ? service.decideAppPlugin({ requestId: 'receipt-decision', model: { source: 'nextmux', model: 'fixture' }, state: 'private-state-do-not-store',
          questions: { next: { type: 'choice', criteria: { wait: 'private-answer' } } } })
      : service.describeAppPluginFrame({ requestId: 'receipt-vision', vision: { source: 'connection', connectionId: 'fixture', model: 'fixture' },
          image: 'data:image/png;base64,AAAA', hints: 'private-hints-do-not-store' });
    await Promise.race([dispatched, result.then(value => { throw new Error(`Receipt fixture returned before dispatch: ${value.error || 'unexpected result'}`); })]);
    await service.disposeConnectionResources();
    assert.equal(signal.aborted, true);
    finish(Response.json({ answers: { next: 'wait' }, choices: [{ message: { content: 'private-answer' } }], usage: { cost: 0.125 } }));
    const received = await result;
    assert.equal(received.error, `${kind === 'decision' ? 'decision' : 'vision'}_cancelled`);
    assert.equal(received.costUsd, 0.125);
  }
  const directory = join(root, 'app-plugin-receipts'), files = await readdir(directory);
  assert.equal(files.length, 2);
  for (const file of files) {
    const text = await readFile(join(directory, file), 'utf8'), receipt = JSON.parse(text);
    assert.equal(receipt.costUsd, 0.125); assert.equal(receipt.costStatus, 'known'); assert.equal(receipt.ok, false);
    assert.match(receipt.requestId, /^receipt-(decision|vision)$/);
    assert.deepEqual(Object.keys(receipt).sort(), ['at', 'costStatus', 'costUsd', 'error', 'kind', 'ok', 'requestId']);
    assert.doesNotMatch(text, /private-|AAAA|fixture\.invalid|authorization|Bearer/);
    if (process.platform !== 'win32') assert.equal((await stat(join(directory, file))).mode & 0o777, 0o600);
  }
});

test('atomic receipts preserve concurrent completions and retain at most the newest 1000 without storing provider error text', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-plugin-receipts-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'app-plugin-receipts');
  await mkdir(directory);
  await Promise.all(Array.from({ length: APP_PLUGIN_RECEIPT_LIMIT + 2 }, (_, index) =>
    writeFile(join(directory, `${String(index + 1).padStart(13, '0')}-${randomUUID()}.json`), '{}')));
  await Promise.all([
    recordAppPluginReceipt(root, 'paid', 'decision', { ok: false, costStatus: 'known', costUsd: 0.001, error: 'decision_http_500: private-provider-detail' }),
    recordAppPluginReceipt(root, 'unpriced', 'vision', { ok: true, costStatus: 'unknown', costUsd: Infinity, text: 'private-answer' })
  ]);
  const files = await readdir(directory);
  assert.equal(files.length, APP_PLUGIN_RECEIPT_LIMIT);
  const latest = files.sort().slice(-2);
  const receipts = await Promise.all(latest.map(file => readFile(join(directory, file), 'utf8').then(JSON.parse)));
  assert.deepEqual(receipts.map(receipt => receipt.requestId).sort(), ['paid', 'unpriced']);
  assert.equal(receipts.find(receipt => receipt.requestId === 'paid').error, 'decision_http_500');
  assert.equal(receipts.find(receipt => receipt.requestId === 'unpriced').costUsd, undefined);
  assert.doesNotMatch(JSON.stringify(receipts), /private-/);
  await recordAppPluginReceipt(root, '../outside', 'decision', { ok: true, costUsd: 1, costStatus: 'known' });
  assert.equal((await readdir(directory)).length, APP_PLUGIN_RECEIPT_LIMIT);
});
