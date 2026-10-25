// 付费插件 on the desktop: prices, purchases, licenses (checked with the platform's public key) and the upload price.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { generateKeyPairSync, sign } from 'node:crypto';
const require = createRequire(import.meta.url);
const market = require('../lib/node/nextmux-app-plugin-market.js');
const { licenseValid } = require('../../../apps/desktop/app-plugins.cjs');
const { mediaModelTakesText } = require('../lib/common/nextmux-media-text-input.js');

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const rawPublic = publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('base64');
const now = Date.now();
const signed = (fields) => ({ ...fields, signature: sign(null, Buffer.from(market.appPluginLicensePayload(fields), 'utf8'), privateKey).toString('base64') });
const license = signed({ userId: 'user-7', pluginId: 'com.example.paid', issuedAt: now - 1000, expiresAt: now + 7 * 86_400_000 });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

test('a license holds only for its plugin, unchanged and unexpired, in the backend and in the app process alike', () => {
  for (const check of [(value, id, at) => market.verifyAppPluginLicense(value, id, at, rawPublic), (value, id, at) => licenseValid(value, id, at, rawPublic)]) {
    assert.equal(check(license, 'com.example.paid', now), true);
    assert.equal(check(license, 'com.example.other', now), false, 'another plugin');
    assert.equal(check({ ...license, userId: 'user-8' }, 'com.example.paid', now), false, 'another buyer');
    assert.equal(check({ ...license, expiresAt: license.expiresAt + 1 }, 'com.example.paid', now), false, 'a longer life than signed');
    assert.equal(check(license, 'com.example.paid', license.expiresAt + 1), false, 'expired');
    assert.equal(check(undefined, 'com.example.paid', now), false);
  }
  // The key built into the app is not the test key: a test license never passes the real check.
  assert.equal(market.verifyAppPluginLicense(license, 'com.example.paid', now), false);
});

test('market prices are read as cents within $0.99–$999.99, and reads carry the device', async () => {
  const seen = [];
  const host = { baseUrl: 'https://fixture.invalid', deviceId: async () => 'desktop-1', fetch: async (url, init) => {
    seen.push(init?.headers?.['x-nextmux-device-id']);
    return json({ plugins: [
      { id: 'com.example.paid', priceCents: 499, owned: false }, { id: 'com.example.free', priceCents: 0 }, { id: 'com.example.odd', priceCents: 50 }, { id: 'com.example.big', priceCents: 1e9 }
    ] });
  } };
  const list = await market.listAppPluginMarket(host);
  assert.deepEqual(list.plugins.map(plugin => [plugin.id, plugin.priceCents, plugin.owned]), [
    ['com.example.paid', 499, false], ['com.example.free', 0, undefined], ['com.example.odd', 0, undefined], ['com.example.big', 0, undefined]]);
  assert.deepEqual(seen, ['desktop-1']);
});

test('buying sends the price the buyer saw with an idempotency key, and reads refusals', async () => {
  const requests = [];
  let reply = json({ ok: true, owned: true });
  const host = { baseUrl: 'https://fixture.invalid', deviceId: async () => 'desktop-1', fetch: async (url, init) => { requests.push({ url, init }); return reply; } };
  assert.deepEqual(await market.purchaseAppPlugin(host, 'com.example.paid', 499, 'buy-0123456789ab'), { ok: true, owned: true });
  assert.equal(requests[0].url, 'https://fixture.invalid/api/plugins/com.example.paid/purchase');
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(requests[0].init.headers['idempotency-key'], 'buy-0123456789ab');
  assert.equal(requests[0].init.headers['x-nextmux-device-id'], 'desktop-1');
  assert.deepEqual(JSON.parse(requests[0].init.body), { idempotencyKey: 'buy-0123456789ab', expectedPriceCents: 499 });
  reply = json({ ok: false, code: 'insufficient_balance', details: { availableMicros: 1_200_000, priceMicros: 4_990_000 } }, 402);
  assert.deepEqual(await market.purchaseAppPlugin(host, 'com.example.paid', 499, 'buy-0123456789ab'), { ok: false, error: 'insufficient_balance', availableMicros: 1_200_000 });
  reply = json({ ok: false, code: 'plugin_price_changed', details: { priceCents: 699 } }, 409);
  assert.deepEqual(await market.purchaseAppPlugin(host, 'com.example.paid', 499, 'buy-0123456789ab'), { ok: false, error: 'plugin_price_changed', priceCents: 699 });
  assert.deepEqual(await market.purchaseAppPlugin(host, 'com.example.paid', 499, 'short'), { ok: false, error: 'request_invalid' }, 'a weak key is refused before any request');
  assert.equal(requests.length, 3);
});

test('a paid download needs a sign-in (401) or a purchase (402)', async () => {
  let status = 401;
  const host = { baseUrl: 'https://fixture.invalid', fetch: async url => url.includes('/download') ? new Response('no', { status })
    : json({ plugin: { id: 'com.example.paid', latestApprovedVersion: '1.0.0', priceCents: 499 }, versions: [{ version: '1.0.0', sha256: 'a'.repeat(64) }] }) };
  assert.equal((await market.downloadAppPluginFromMarket(host, 'com.example.paid', '1.0.0')).error, 'plugin_login_required');
  status = 402;
  assert.equal((await market.downloadAppPluginFromMarket(host, 'com.example.paid', '1.0.0')).error, 'plugin_purchase_required');
});

test('the license check tells paid from free, without an account too, and only trusts a valid signature', async () => {
  const replies = new Map();
  const host = { baseUrl: 'https://fixture.invalid', deviceId: async () => 'desktop-1', fetch: async url => replies.get(new URL(url).pathname) || json({}, 404) };
  replies.set('/api/plugins/com.example.paid/license', json({ ok: true, paid: true, priceCents: 499, owned: false }));
  assert.deepEqual(await market.appPluginLicense(host, 'com.example.paid'), { ok: true, paid: true, priceCents: 499, owned: false });
  replies.set('/api/plugins/com.example.paid/license', json({ ok: true, paid: true, priceCents: 499, owned: true, license }));
  const forged = await market.appPluginLicense(host, 'com.example.paid');
  assert.equal(forged.license, undefined, 'a license the built-in key does not verify is not handed on');
  assert.equal(forged.error, 'license_invalid');
  replies.set('/api/plugins/com.example.paid/license', json({ ok: false, code: 'plugin_login_required' }, 401));
  replies.set('/api/plugins/com.example.paid', json({ plugin: { id: 'com.example.paid', priceCents: 499 } }));
  assert.deepEqual(await market.appPluginLicense(host, 'com.example.paid'), { ok: true, paid: true, priceCents: 499, owned: false });
  assert.deepEqual(await market.appPluginLicense(host, 'com.example.local'), { ok: true, paid: false, owned: true }, 'never listed: nothing to buy');
});

test('the upload price travels as cents and is checked before anything is sent', async () => {
  const requests = [];
  const host = { baseUrl: 'https://fixture.invalid', deviceId: async () => 'desktop-1', fetch: async (url, init) => { requests.push(init); return json({ ok: true, pluginId: 'com.example.paid', version: '1.0.0', status: 'approved' }, 201); } };
  const bytes = Buffer.from('package');
  assert.equal((await market.uploadAppPluginToMarket(host, bytes, 'paid.nmxplugin', 'Ada', 499)).status, 'approved');
  assert.equal(requests[0].headers['x-nextmux-plugin-price'], '499');
  assert.equal(requests[0].headers['x-nextmux-plugin-author'], 'Ada');
  assert.equal((await market.uploadAppPluginToMarket(host, bytes, 'free.nmxplugin', '', 0)).ok, true);
  assert.equal(requests[1].headers['x-nextmux-plugin-price'], '0');
  for (const price of [50, 100_000, 4.5]) assert.equal((await market.uploadAppPluginToMarket(host, bytes, 'x.nmxplugin', '', price)).problem.code, 'plugin_price_invalid');
  assert.equal(requests.length, 2);
  // An update where the author did not touch the price sends none: the platform keeps the plugin's current price.
  await market.uploadAppPluginToMarket(host, bytes, 'update.nmxplugin', 'Ada');
  assert.equal('x-nextmux-plugin-price' in requests[2].headers, false);
});

test('漫剧对话 lists only models that make a picture, clip or song from text alone', () => {
  const takes = (kind, id, extra = {}) => mediaModelTakesText(kind, { id, ...extra });
  for (const id of ['google/veo-3.1', 'openai/sora-2', 'minimax/hailuo-02', 'wan/wan2.2-t2v-plus', 'kling-v2.1-master']) assert.equal(takes('video', id), true, id);
  for (const id of ['kling-v2.1-i2v', 'bytedance/seedance-1-0-lite-i2v', 'wan2.2-flf2v', 'kling-lip-sync', 'vidu-q1-reference-to-video', 'runway/video-extend']) assert.equal(takes('video', id), false, id);
  assert.equal(takes('video', 'some-model', { capabilities: ['video_generation', 'image_to_video'] }), false, 'classified as needing a picture only');
  assert.equal(takes('video', 'some-model', { capabilities: ['video_generation', 'image_to_video', 'text_to_video'] }), true);
  for (const id of ['openai/gpt-image-1', 'google/gemini-2.5-flash-image', 'black-forest-labs/flux.2-flex', 'bytedance-seed/seedream-4.5']) assert.equal(takes('image', id, { input: ['text', 'image'] }), true, id);
  for (const id of ['black-forest-labs/flux-kontext-pro', 'qwen/qwen-image-edit', 'stability/upscaler', 'recraft/remove-bg']) assert.equal(takes('image', id), false, id);
  assert.equal(takes('image', 'some-model', { input: ['image'] }), false, 'no text input');
  for (const id of ['suno-v5', 'minimax-music-2.0', 'elevenlabs/music-v1']) assert.equal(takes('music', id), true, id);
  for (const id of ['suno-v5-cover', 'suno/extend', 'demucs-stems']) assert.equal(takes('music', id), false, id);
});

test('the app and the platform compute the same content fingerprint, and a renamed copy keeps it', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const core = require('../../../apps/desktop/app-plugin-core.cjs');
  const { fingerprintOf } = require('../../../apps/desktop/app-plugins.cjs');
  const { pluginContentFingerprint } = await import('../../../apps/cloudflare-platform/src/app-plugin-validation.js');
  const folder = new URL('../../../docs/examples/app-plugins/coin-catcher/plugin/', import.meta.url).pathname;
  const files = new Map();
  const walk = (directory, prefix) => { for (const name of readdirSync(directory)) {
    const path = join(directory, name), relative = prefix ? `${prefix}/${name}` : name;
    if (statSync(path).isDirectory()) walk(path, relative); else if (core.allowedFile(relative)) files.set(relative, readFileSync(path));
  } };
  walk(folder, '');
  const check = entries => { const raw = JSON.parse(entries.get('plugin.json').toString('utf8')); const checked = core.validateManifest(raw, { files: new Set(entries.keys()) }); assert.ok(checked.ok, JSON.stringify(checked.errors)); return checked.manifest; };
  const manifest = check(files);
  const desktop = fingerprintOf(manifest, files);
  assert.deepEqual(desktop, await pluginContentFingerprint(core.contentFingerprintInputs(manifest, files)));
  assert.match(desktop.images, /^[0-9a-f]{64}$/, 'the coin template counts');
  // Another id, name, description and author: the same plugin.
  const raw = JSON.parse(files.get('plugin.json').toString('utf8'));
  const renamed = new Map(files);
  renamed.set('plugin.json', Buffer.from(JSON.stringify({ ...raw, id: 'com.someone.renamed', name: { en: 'Brand new' }, description: { en: 'Nothing to see' }, author: { name: 'Else' } })));
  assert.deepEqual(fingerprintOf(check(renamed), renamed), desktop);
});

test('a bought plugin is stored sealed: its files open only with this computer’s keychain', () => {
  const { sealFiles, openSealed } = require('../../../apps/desktop/app-plugins.cjs');
  const keychain = secret => ({ encryptString: text => Buffer.from(`${secret}:${text}`), decryptString: buffer => { const value = buffer.toString(); if (!value.startsWith(`${secret}:`)) throw new Error('other keychain'); return value.slice(secret.length + 1); } });
  const files = new Map([['plugin.json', Buffer.from('{"id":"com.example.paid"}')], ['templates/coin.png', Buffer.from([137, 80, 78, 71])]]);
  const sealed = sealFiles(files, keychain('this-mac'));
  assert.equal(sealed.blob.includes(Buffer.from('com.example.paid')), false, 'nothing readable on disk');
  assert.deepEqual(openSealed(sealed.blob, sealed.key, keychain('this-mac')), files);
  assert.throws(() => openSealed(sealed.blob, sealed.key, keychain('another-mac')), error => error.code === 'package_locked');
  const tampered = Buffer.from(sealed.blob); tampered[tampered.length - 1] ^= 1;
  assert.throws(() => openSealed(tampered, sealed.key, keychain('this-mac')));
});

test('a plugin from disk is looked up by content; a platform without the lookup matches nothing', async () => {
  const print = { behavior: 'a'.repeat(64), images: '' };
  let reply = json({ ok: true, match: { pluginId: 'com.example.paid', priceCents: 499, name: { en: 'Paid one' } } });
  const host = { baseUrl: 'https://fixture.invalid', fetch: async url => { assert.match(url, /\/api\/plugins\/fingerprint\?behavior=a{64}&images=$/); return reply; } };
  assert.deepEqual(await market.appPluginFingerprintMatch(host, print), { ok: true, match: { pluginId: 'com.example.paid', priceCents: 499, name: { en: 'Paid one' } } });
  reply = json({ ok: true, match: null });
  assert.deepEqual(await market.appPluginFingerprintMatch(host, print), { ok: true });
  reply = new Response('not found', { status: 404 });
  assert.deepEqual(await market.appPluginFingerprintMatch(host, print), { ok: true });
  reply = new Response('down', { status: 503 });
  assert.equal((await market.appPluginFingerprintMatch(host, print)).ok, false);
  assert.equal((await market.appPluginFingerprintMatch(host, { behavior: 'nope', images: '' })).error, 'plugin_fingerprint_invalid');
});
