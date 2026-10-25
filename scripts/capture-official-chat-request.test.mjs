import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import captureTools from './capture-official-chat-request.cjs';
import { main } from './diagnose-official-chat-failure.mjs';
import { analyzeWireCompletion, claimWireReplay, loadWireCapture, readPrivateWireFile, runPrivateWireProbe, validateWireCapture } from './diagnose-official-chat-wire.mjs';

const { createCaptureFetch, readPrivateFile } = captureTools;
const model = 'gpt-5.6-luna';
const endpoint = 'https://example.invalid/v1/chat/completions';
const nonce = 'NM_LUNA_WIRE_QA_20260923_1';
const secret = 'fixture-credential-exact';
const connection = { id: 'fixture', providerId: 'custom_openai', protocol: 'openai_chat_completions', baseUrl: 'https://example.invalid/v1/' };
const body = Buffer.from('{\n  "model":"gpt-5.6-luna", "stream":true, "messages":[{"role":"system","content":"private system text"},{"role":"user","content":"Observe only.\\n' + nonce + '"}],"tools":[{"type":"function","function":{"name":"fixture_tool","description":"private schema text","parameters":{"type":"object","properties":{}}}}]\n}\n');
const hash = value => createHash('sha256').update(value).digest('hex');

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'nextmux-wire-offline-test-'));
  await chmod(directory, 0o700);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = { enabled: true, version: 1, endpoint, model, nonce, outputDirectory: directory };
  let calls = 0;
  const fetch = createCaptureFetch(async () => { calls += 1; return new Response('passthrough'); }, config);
  return { directory, config, fetch, calls: () => calls };
}
async function captured(t) {
  const item = await fixture(t);
  await assert.rejects(item.fetch(endpoint, { method: 'POST', body, headers: { authorization: 'Bearer ' + secret } }), /PRIVATE_CAPTURE_COMPLETE_NO_DISPATCH/);
  return { ...item, ...(await loadWireCapture(join(item.directory, 'request.bin'), connection, model)) };
}

test('preload and raw CLI remain inert by default', async () => {
  const result = spawnSync(process.execPath, ['-e', `const before=globalThis.fetch; require(${JSON.stringify(new URL('./capture-official-chat-request.cjs', import.meta.url).pathname)}); process.stdout.write(String(before===globalThis.fetch));`],
    { encoding: 'utf8', env: { ...process.env, NEXTMUX_PRIVATE_CAPTURE_CONFIG: '' } });
  assert.equal(result.status, 0); assert.equal(result.stdout, 'true'); assert.equal(result.stderr, '');
  assert.equal((await main(['--wire-request-file', '/not-read'])).networkRequests, 0);
});

test('unmatched endpoints and models pass through original fetch arguments', async t => {
  const { config } = await fixture(t);
  const input = new URL('https://other.invalid/request');
  const init = { method: 'POST', body: secret };
  let calls = 0;
  const wrapped = createCaptureFetch(async (actualInput, actualInit) => {
    calls += 1;
    if (calls === 1) { assert.equal(actualInput, input); assert.equal(actualInit, init); }
    return new Response('ok');
  }, config);
  await wrapped(input, init);
  await wrapped(endpoint, { method: 'POST', body: '{"model":"another-model"}' });
  assert.equal(calls, 2);
});

test('matching capture preserves original bytes and dispatches nothing; reports contain no headers or message text', async t => {
  const item = await captured(t);
  assert.equal(item.calls(), 0); assert.deepEqual(item.bytes, body);
  assert.equal(item.capture.sha256, hash(body)); assert.equal(item.capture.bodyBytes, body.length);
  assert.equal(item.capture.toolDefinitionCount, 1); assert.equal(item.capture.systemMessageCount, 1);
  assert.doesNotMatch(JSON.stringify(item.capture), /private system|private schema|fixture-credential|authorization|example.invalid/);
  for (const name of ['request.bin', 'capture-report.json', 'capture-claim']) assert.equal((await stat(join(item.directory, name))).mode & 0o777, 0o600);
  assert.equal((await stat(item.directory)).mode & 0o777, 0o700);
});

test('cross-wrapper atomic capture claim blocks repeated target requests permanently', async t => {
  const item = await captured(t);
  const second = createCaptureFetch(async () => { throw new Error('network forbidden'); }, item.config);
  await assert.rejects(second(endpoint, { method: 'POST', body }), /PRIVATE_CAPTURE_ALREADY_CLAIMED/);
  assert.deepEqual(await readFile(join(item.directory, 'request.bin')), body);
});

test('armed target fails closed on absent, misplaced or duplicate nonce and malformed body', async t => {
  const item = await fixture(t);
  for (const request of [
    { model, stream: true, messages: [{ role: 'user', content: 'no marker' }] },
    { model, stream: true, messages: [{ role: 'user', content: nonce }, { role: 'user', content: 'last without marker' }] },
    { model, stream: true, messages: [{ role: 'user', content: nonce + '\n' + nonce }] },
    { model: 'another-model', stream: true, messages: [{ role: 'user', content: nonce }] },
  ]) await assert.rejects(item.fetch(endpoint, { method: 'POST', body: JSON.stringify(request) }), /PRIVATE_CAPTURE_TARGET/);
  await assert.rejects(item.fetch(endpoint, { method: 'POST', body: '{' }), /PRIVATE_CAPTURE_INVALID_JSON/);
  await assert.rejects(item.fetch(endpoint, { method: 'POST', body: new ReadableStream() }), /PRIVATE_CAPTURE_UNSUPPORTED_BODY/);
  await assert.rejects(item.fetch(endpoint, { method: 'POST', body: 'x'.repeat(1024 * 1024 + 1) }), /PRIVATE_CAPTURE_BODY_TOO_LARGE/);
  assert.equal(item.calls(), 0);
});

test('private file and directory checks reject broad permissions and symlinks', async t => {
  const item = await captured(t), filename = join(item.directory, 'request.bin');
  await chmod(filename, 0o644);
  await assert.rejects(readPrivateWireFile(filename), /PROBE_PRIVATE_FILE_REQUIRED/);
  assert.throws(() => readPrivateFile(filename), /PRIVATE_CAPTURE_FILE_REQUIRED/);
  await chmod(filename, 0o600);
  const alias = join(item.directory, 'alias'); await symlink(filename, alias);
  await assert.rejects(readPrivateWireFile(alias)); assert.throws(() => readPrivateFile(alias));
  await chmod(item.directory, 0o755);
  assert.throws(() => createCaptureFetch(async () => {}, item.config), /PRIVATE_CAPTURE_DIRECTORY_REQUIRED/);
  await assert.rejects(loadWireCapture(filename, connection, model), /PROBE_PRIVATE_DIRECTORY_REQUIRED/);
  await chmod(item.directory, 0o700);
});

test('wire validation binds exact bytes, model, saved endpoint and final user nonce before credential access', async t => {
  const item = await captured(t);
  for (const capture of [{ ...item.capture, sha256: '0'.repeat(64) }, { ...item.capture, endpointSha256: '0'.repeat(64) },
    { ...item.capture, nonceSha256: '0'.repeat(64) }]) {
    let reads = 0;
    await assert.rejects(runPrivateWireProbe({ connection, model, bytes: item.bytes, capture }, {
      readCredential: async () => { reads += 1; return secret; }, fetchImpl: async () => { throw new Error('forbidden'); },
    }), /PROBE_CAPTURE_BINDING_MISMATCH/);
    assert.equal(reads, 0);
  }
  assert.throws(() => validateWireCapture(connection, model, Buffer.concat([body, Buffer.from(' ')]), item.capture), /PROBE_CAPTURE_BINDING/);
  assert.throws(() => validateWireCapture(connection, 'other-model', body, item.capture), /PROBE_INVALID_WIRE_REQUEST/);
});

test('replay claim is atomic and retained across a second invocation', async t => {
  const item = await captured(t), filename = join(item.directory, 'request.bin');
  await claimWireReplay(filename);
  await assert.rejects(claimWireReplay(filename), error => error.code === 'EEXIST');
  assert.equal((await stat(join(item.directory, 'replay-claim'))).mode & 0o777, 0o600);
});

test('one raw replay uses actual SDK headers locally and identical Buffer bytes; returned tools are never executed', async t => {
  const item = await captured(t);
  let reads = 0, requests = 0;
  const raw = 'data: ' + JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'private-id', type: 'function', function: { name: 'fixture_tool', arguments: secret } }] }, finish_reason: 'tool_calls' }] }) + '\n\ndata: [DONE]\n\n';
  const report = await runPrivateWireProbe({ connection, model, bytes: item.bytes, capture: item.capture }, {
    readCredential: async () => { reads += 1; return secret; }, fetchImpl: async (url, init) => {
      requests += 1; assert.equal(url, endpoint); assert.equal(init.body, item.bytes); assert.deepEqual(init.body, body);
      assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error'); assert.equal(init.headers.get('authorization'), 'Bearer ' + secret);
      assert.match(init.headers.get('user-agent'), /ai-sdk\/openai-compatible\//);
      return new Response(raw, { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  t.after(() => rm(report.capture.privateDirectory, { recursive: true, force: true }));
  assert.equal(reads, 1); assert.equal(requests, 1); assert.equal(report.requestCount, 1); assert.equal(report.toolExecutionCount, 0);
  assert.equal(report.requestBodySha256, hash(body)); assert.equal(report.outcome, 'completed');
  assert.equal(report.wire.toolCallFragmentCount, 1); assert.doesNotMatch(JSON.stringify(report), /fixture-credential|private-id|fixture_tool|private system/);
  assert.equal((await stat(report.capture.rawPath)).mode & 0o777, 0o600);
  assert.equal((await stat(report.capture.privateDirectory)).mode & 0o777, 0o700);
});

test('wire response errors preserve sanitized mechanism without changing classification or retrying', async t => {
  const item = await captured(t); let requests = 0;
  const raw = 'data: ' + JSON.stringify({ error: { message: `upstream deadline exceeded ${secret} https://private.invalid/a Bearer hidden-value`, type: 'upstream_error', code: 502, param: secret } }) + '\n\ndata: [DONE]\n\n';
  const report = await runPrivateWireProbe({ connection, model, bytes: item.bytes, capture: item.capture }, {
    readCredential: async () => secret, fetchImpl: async () => { requests += 1; return new Response(raw, { headers: { 'content-type': 'text/event-stream' } }); },
  });
  t.after(() => rm(report.capture.privateDirectory, { recursive: true, force: true }));
  assert.equal(requests, 1); assert.equal(report.outcome, 'stream_error'); assert.equal(report.wire.errors[0].code, 502);
  assert.match(report.wire.errors[0].message, /upstream deadline exceeded/);
  assert.doesNotMatch(JSON.stringify(report), /fixture-credential|private.invalid|hidden-value|Bearer/);
  assert.equal('retryable' in report, false);
});

test('raw response capture and request duration are bounded', async t => {
  const item = await captured(t);
  const large = await runPrivateWireProbe({ connection, model, bytes: item.bytes, capture: item.capture }, {
    readCredential: async () => secret, fetchImpl: async () => new Response('x'.repeat(512 * 1024 + 1)),
  });
  t.after(() => rm(large.capture.privateDirectory, { recursive: true, force: true }));
  assert.equal(large.outcome, 'response_limit'); assert.equal(large.capture.capturedBytes, 512 * 1024); assert.equal(large.capture.truncated, true);
  const timed = await runPrivateWireProbe({ connection, model, bytes: item.bytes, capture: item.capture }, {
    timeoutMs: 10, readCredential: async () => secret, fetchImpl: async () => new Promise(() => {}),
  });
  t.after(() => rm(timed.capture.privateDirectory, { recursive: true, force: true }));
  assert.equal(timed.outcome, 'local_failure'); assert.equal(timed.localFailure, 'request_deadline'); assert.equal(timed.requestCount, 1);
});

test('malformed or unfinished wire response is not called completed', () => {
  const result = analyzeWireCompletion(Buffer.from('data: {broken}\n\n'), [secret]);
  assert.equal(result.done, false); assert.equal(result.invalidFrames, 1); assert.deepEqual(result.finishReasons, []);
});

test('DONE cannot turn malformed or empty response into a completed model answer', async t => {
  const item = await captured(t);
  for (const [raw, expected] of [
    ['data: not-json\n\ndata: [DONE]\n\n', 'invalid_response'],
    ['data: [DONE]\n\n', 'empty_response'],
    ['data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', 'empty_response'],
  ]) {
    const report = await runPrivateWireProbe({ connection, model, bytes: item.bytes, capture: item.capture }, {
      readCredential: async () => secret, fetchImpl: async () => new Response(raw, { headers: { 'content-type': 'text/event-stream' } }),
    });
    t.after(() => rm(report.capture.privateDirectory, { recursive: true, force: true }));
    assert.equal(report.outcome, expected); assert.equal(report.toolExecutionCount, 0);
  }
});

test('opt-in Node preload reads private config and intercepts actual global fetch without invoking it', async t => {
  const item = await fixture(t), configPath = join(item.directory, 'config.json');
  await writeFile(configPath, JSON.stringify(item.config), { mode: 0o600 });
  const child = spawnSync(process.execPath, ['--input-type=commonjs', '-e', `
    globalThis.fetch=async()=>{throw new Error('NETWORK_MUST_NOT_RUN');};
    require(${JSON.stringify(new URL('./capture-official-chat-request.cjs', import.meta.url).pathname)});
    globalThis.fetch(${JSON.stringify(endpoint)},{method:'POST',body:Buffer.from(${JSON.stringify(body.toString('base64'))},'base64')})
      .then(()=>process.exit(2),error=>process.stdout.write(error.message));
  `], { encoding: 'utf8', timeout: 3000, env: { ...process.env, NEXTMUX_PRIVATE_CAPTURE_CONFIG: configPath } });
  assert.equal(child.status, 0); assert.equal(child.stderr, ''); assert.equal(child.stdout, 'PRIVATE_CAPTURE_COMPLETE_NO_DISPATCH');
  assert.deepEqual(await readFile(join(item.directory, 'request.bin')), body);
});
