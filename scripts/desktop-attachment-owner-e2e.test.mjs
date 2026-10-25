import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, lstat, rm, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { attachmentCacheRequest, installAttachmentCacheGate } from './desktop-attachment-owner-gate.mjs';
import { fixtureHash, hideFixtureAttachment, readAttachmentOwnerSession, verifiedFixtureAttachment } from './desktop-attachment-owner-files.mjs';

const require = createRequire(resolve('apps/desktop/package.json'));
const { defaultMsgPack } = require('@theia/core/lib/common/message-rpc/rpc-message-encoder');
const owner = '9ea15bab-2b42-4826-8c89-636ec49b099b';
const expected = { conversationId: owner, name: 'synthetic-owner.txt', dataBase64: Buffer.from('EXACT_SYNTHETIC_ATTACHMENT').toString('base64') };
function frame(request = expected, method = 'cacheDesktopAttachment', channel = '/services/nextmux-platform', type = 1) {
  const payload = defaultMsgPack.encode({ type, id: 1, method, args: [request] });
  const head = Buffer.alloc(5); head[0] = 4; head.writeUInt32BE(Buffer.byteLength(channel), 1);
  let length = payload.length; const variable = [];
  do { const value = length & 127; length = Math.floor(length / 128); variable.push(value | (length ? 128 : 0)); } while (length);
  return Buffer.concat([head, Buffer.from(channel), Buffer.from(variable), payload]);
}
function gateFixture() {
  const sent = [], timers = [];
  class Socket { send(data) { sent.push({ socket: this, data }); } }
  const original = Socket.prototype.send;
  const control = installAttachmentCacheGate({ socketClass: Socket, unpack: value => defaultMsgPack.decode(value), expected,
    setTimer(fn, delay) { timers.push({ fn, delay }); return timers.length; }, clearTimer() {} });
  return { Socket, original, control, sent, timers };
}

test('only the exact platform cache request/owner/body is delayed, with original bytes and socket preserved', () => {
  const f = gateFixture(), socket = new f.Socket();
  const unrelated = [frame(expected, 'cacheDesktopAttachmentExtra'), frame(expected, 'startAgentRun'),
    frame({ ...expected, conversationId: 'other-owner' }), frame({ ...expected, dataBase64: 'other' }),
    frame(expected, 'cacheDesktopAttachment', '/services/other'), frame(expected, 'cacheDesktopAttachment', undefined, 2)];
  for (const data of unrelated) socket.send(data);
  assert.equal(f.sent.length, unrelated.length);
  const target = frame(); socket.send(target);
  assert.equal(f.control.status().held, 1); assert.equal(f.sent.length, unrelated.length);
  assert.equal(f.timers[0].delay, 20000);
  f.control.release(); assert.equal(f.sent.at(-1).data, target); assert.equal(f.sent.at(-1).socket, socket);
  f.control.dispose(); assert.equal(f.Socket.prototype.send, f.original);
  assert.equal(f.control.status().released, 1);
});

test('delay timeout and disposal release at most once and never overwrite another wrapper', () => {
  const f = gateFixture(), socket = new f.Socket(), target = frame();
  socket.send(target); socket.send(target);
  assert.equal(f.control.status().extraMatches, 1); assert.equal(f.sent.length, 1);
  f.timers[0].fn(); assert.equal(f.sent.length, 2); assert.equal(f.control.status().expired, true);
  const foreign = () => {}; f.Socket.prototype.send = foreign;
  f.control.dispose(); f.control.release(); assert.equal(f.sent.length, 2); assert.equal(f.Socket.prototype.send, foreign);
  assert.equal(attachmentCacheRequest(Buffer.alloc(270000), value => defaultMsgPack.decode(value)), undefined);
  assert.throws(() => installAttachmentCacheGate({ socketClass: f.Socket, expected: {} }), /EXACT_SYNTHETIC_FIXTURE/);
});

test('releasing after an owned socket closes records failure instead of throwing from the timeout', () => {
  class Socket { send() { throw new Error('synthetic closed socket'); } }
  let timeout;
  const gate = installAttachmentCacheGate({ socketClass: Socket, unpack: value => defaultMsgPack.decode(value), expected,
    setTimer(fn) { timeout = fn; }, clearTimer() {} });
  new Socket().send(frame()); assert.doesNotThrow(timeout); assert.equal(gate.status().sendFailed, true); gate.dispose();
});

test('fixture validation confines ordinary regular files, hash and size to the exact profile', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'nmx-owner-file-'));
  try {
    const folder = join(profile, 'cache'); await mkdir(folder);
    const bytes = Buffer.from('synthetic fixture bytes'), file = join(folder, `${fixtureHash(bytes)}.txt`);
    await writeFile(file, bytes, { flag: 'wx' });
    const reference = { uri: pathToFileURL(file).href, size: bytes.length };
    assert.equal((await verifiedFixtureAttachment(profile, reference, bytes)).sha256, fixtureHash(bytes));
    await assert.rejects(verifiedFixtureAttachment(profile, reference, Buffer.from('different')), /SIZE|HASH/);
    await assert.rejects(verifiedFixtureAttachment(profile, { ...reference, size: 1 }, bytes));
    await assert.rejects(verifiedFixtureAttachment(folder, { uri: pathToFileURL(join(profile, 'other')).href, size: 1 }, bytes), /OUTSIDE_PROFILE/);
    const alias = join(folder, 'alias'); await symlink(file, alias);
    await assert.rejects(verifiedFixtureAttachment(profile, { ...reference, uri: pathToFileURL(alias).href }, bytes), /SYMLINK/);
  } finally { await rm(profile, { recursive: true }); }
});

test('missing-cache injection is recoverable and restore atomically refuses to overwrite an unexpected file', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'nmx-owner-missing-'));
  try {
    const bytes = Buffer.from('synthetic removable fixture'), file = join(profile, 'fixture.txt');
    await writeFile(file, bytes, { flag: 'wx' });
    const restore = await hideFixtureAttachment(profile, { uri: pathToFileURL(file).href, size: bytes.length }, bytes);
    await assert.rejects(lstat(file), { code: 'ENOENT' });
    await writeFile(file, 'do not overwrite', { flag: 'wx' });
    await assert.rejects(restore(), { code: 'EEXIST' });
    assert.equal(await readFile(file, 'utf8'), 'do not overwrite');
    await unlink(file); await restore(); await restore();
    assert.deepEqual(await readFile(file), bytes);
  } finally { await rm(profile, { recursive: true }); }
});

test('durable fixture reader rejects traversal and does not read arbitrary manifest paths', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'nmx-owner-manifest-'));
  try {
    const directory = join(profile, 'conversation-history-v1'); await mkdir(directory);
    await writeFile(join(directory, 'manifest-v1.json'), JSON.stringify({ sessions: [{ id: owner, file: '../secret.json' }] }), { flag: 'wx' });
    await assert.rejects(readAttachmentOwnerSession(profile, owner));
  } finally { await rm(profile, { recursive: true }); }
});

test('real browser bundle uses installed MsgPack to match the synthetic request without Node APIs', async () => {
  const { gateBundle } = await import('./desktop-attachment-owner-e2e.mjs');
  const f = gateFixture(); f.control.dispose();
  const context = { WebSocket: f.Socket, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer, DataView,
    setTimeout() { return 1; }, clearTimeout() {} };
  runInNewContext(await gateBundle('__fixtureGate'), context);
  context.__fixtureGate.arm(expected);
  new f.Socket().send(frame()); assert.equal(context.__fixtureGate.status().held, 1);
  context.__fixtureGate.dispose(); assert.equal(f.sent.length, 1); assert.equal(context.__fixtureGate, undefined);
});

test('CLI requires a package before profile allocation and keeps the native close and ownership assertions', async () => {
  const script = fileURLToPath(new URL('./desktop-attachment-owner-e2e.mjs', import.meta.url));
  const result = await promisify(execFile)(process.execPath, [script], { env: { PATH: process.env.PATH }, timeout: 10000 })
    .then(() => assert.fail('must reject before launch'), error => error);
  assert.match(result.stderr, /REQUIRES_ABSOLUTE_PACKAGED_EXECUTABLE/);
  assert.doesNotMatch(result.stdout, /attachment_owner_profile/);
  const source = await readFile(script, 'utf8');
  assert.match(source, /assertDisposableDesktopE2E\(env\)/);
  assert.equal((source.match(/await requestQuit\(/g) || []).length, 2);
  assert.doesNotMatch(source, /window\.close\(|beginPrepareClose|completePrepareClose/);
  assert.match(source, /current\.id, b/); assert.match(source, /current\.prompt, other/);
  assert.match(source, /await modelRequests\(\), before/);
  assert.ok(source.indexOf('assert.equal(first.child.signalCode, null)') < source.indexOf('await terminateTree(first.child)'));
  assert.ok(source.indexOf('await terminateTree(first.child)') < source.indexOf('const second = await launch(2)'));
  assert.ok(source.indexOf("'ordinary restored before testing missing paste'") < source.indexOf("await click(resumed, '.nmx-send-button:not(:disabled)')"));
  assert.match(source, /!value\.disabled && !value\.error && !value\.unresolved/);
  assert.match(source, /for \(const \{ client, key \} of gates\)/);
});
