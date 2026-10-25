import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { analyzeCapturedResponse, main, publicErrorFields, redactDiagnosticText, runPrivateChatProbe, runProbeCli, withProbeDeadline } from './diagnose-official-chat-failure.mjs';

const connection = { id: 'fixture-connection', providerId: 'custom_openai', protocol: 'openai_chat_completions', baseUrl: 'https://example.invalid/v1' };
const request = { messages: [{ role: 'user', content: 'Reply FIXTURE_OK only.' }], tools: [], reasoningEffort: 'medium' };
const secret = 'fixture-secret-exact';

test('default CLI is inert and neither reads credentials nor dispatches', async () => {
  assert.deepEqual(await main([]), { status: 'not-executed', required: '--execute --connection-id ID --model MODEL --request-file PRIVATE_JSON', networkRequests: 0, credentialReads: 0 });
});

test('fixed provider fields preserve timeout mechanism and remove secrets, URLs and random tokens', () => {
  const text = 'upstream request timed out; https://user:pass@example.test/v1?key=x Authorization: Bearer hidden-token api_key="hidden key" token=short-private key=key-private sk-abcdef123456 abcdefghijklmnopqrstuvwxyz123456 ' + secret + ' ' + Buffer.from(secret).toString('base64');
  const visible = redactDiagnosticText(text, [secret]);
  assert.match(visible, /upstream request timed out/);
  assert.doesNotMatch(visible, /example\.test|user:pass|hidden|short-private|key-private|sk-abcdef|abcdefghijklmnopqrstuvwxyz|fixture-secret/);
  const fields = publicErrorFields({ message: text, type: 'upstream_error', code: 502, param: { authorization: secret }, privateUnknown: secret }, [secret]);
  assert.equal(fields.type, 'upstream_error'); assert.equal(fields.code, 502);
  assert.equal('param' in fields, false); assert.equal('privateUnknown' in fields, false);
});

test('wire analysis ignores assistant content and only extracts Chat Completions error envelopes', () => {
  const raw = 'data: ' + JSON.stringify({ choices: [{ delta: { content: secret } }] }) + '\n\n'
    + 'data: ' + JSON.stringify({ error: { message: 'server rejected request', code: 'custom_failure' } }) + '\n\ndata: [DONE]\n\n';
  const analysis = analyzeCapturedResponse(raw, [secret]);
  assert.equal(analysis.parsedFrames, 2); assert.equal(analysis.errors.length, 1);
  assert.equal(analysis.errors[0].code, 'custom_failure'); assert.doesNotMatch(JSON.stringify(analysis), /fixture-secret/);
});

test('actual compatible SDK exposes plain error object while private wire capture explains it without executing a tool', async () => {
  let credentialReads = 0, requests = 0;
  const raw = 'data: ' + JSON.stringify({ error: { message: `upstream connection timeout; Bearer ${secret}; https://private.example.test/request`, type: 'upstream_error', code: 502, param: secret } }) + '\n\ndata: [DONE]\n\n';
  const report = await runPrivateChatProbe({ connection, model: 'fixture-model', request }, {
    readCredential: async id => { assert.equal(id, connection.id); credentialReads += 1; return secret; },
    fetchImpl: async (_input, init) => {
      requests += 1; assert.equal(init.redirect, 'error');
      const body = JSON.parse(init.body); assert.equal(body.stream, true); assert.equal(body.model, 'fixture-model');
      return new Response(raw, { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  try {
    assert.equal(credentialReads, 1); assert.equal(requests, 1); assert.equal(report.requestCount, 1);
    assert.equal(report.outcome, 'failed'); assert.equal(report.failure.code, 'MODEL_CALL_FAILED');
    assert.equal(report.failure.category, 'unknown'); assert.equal(report.failure.retryable, false);
    assert.equal(report.toolExecutionCount, 0); assert.equal(report.httpStatus, 200); assert.equal(report.eventStream, true);
    assert.equal(report.wire.errors[0].code, 502); assert.match(report.wire.errors[0].message, /upstream connection timeout/);
    assert.doesNotMatch(JSON.stringify(report), /fixture-secret|private\.example|Bearer/);
    assert.equal((await stat(report.capture.privateDirectory)).mode & 0o777, 0o700);
    assert.equal((await stat(report.capture.rawPath)).mode & 0o777, 0o600);
    assert.equal(await readFile(report.capture.rawPath, 'utf8'), raw);
  } finally { await rm(report.capture.privateDirectory, { recursive: true, force: true }); }
});

test('successful diagnostic does not print model content or execute returned calls', async () => {
  const chunks = [{ id: 'fixture', model: 'fixture-model', choices: [{ index: 0, delta: { content: secret }, finish_reason: null }] },
    { id: 'fixture', model: 'fixture-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }];
  const report = await runPrivateChatProbe({ connection, model: 'fixture-model', request }, {
    readCredential: async () => secret,
    fetchImpl: async () => new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }),
  });
  try {
    assert.equal(report.outcome, 'completed'); assert.equal(report.toolExecutionCount, 0);
    assert.equal(report.wire.errors.length, 0); assert.doesNotMatch(JSON.stringify(report), /fixture-secret/);
  } finally { await rm(report.capture.privateDirectory, { recursive: true, force: true }); }
});

test('invalid protocol fails before credential access or network', async () => {
  let reads = 0;
  await assert.rejects(runPrivateChatProbe({ connection: { ...connection, protocol: 'openai_responses' }, model: 'fixture-model', request }, {
    readCredential: async () => { reads += 1; return secret; }, fetchImpl: async () => { throw new Error('network must not run'); },
  }), /PROBE_REQUIRES_CUSTOM_CHAT_COMPLETIONS/);
  assert.equal(reads, 0);
});

test('credential deadline prevents a late native result from ever dispatching a request', async () => {
  let resolveCredential, requests = 0, reads = 0;
  const phases = [];
  await assert.rejects(runPrivateChatProbe({ connection, model: 'fixture-model', request }, {
    setupTimeoutMs: 10, onPhase: phase => phases.push(phase),
    readCredential: () => { reads += 1; return new Promise(resolve => { resolveCredential = resolve; }); },
    fetchImpl: async () => { requests += 1; throw new Error('must not run'); },
  }), error => error.phase === 'credential');
  resolveCredential(secret);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 1); assert.equal(requests, 0); assert.deepEqual(phases, ['credential']);
});

test('network setup deadline is separate from model transport and sends nothing', async () => {
  let requests = 0;
  const phases = [];
  await assert.rejects(runPrivateChatProbe({ connection, model: 'fixture-model', request }, {
    setupTimeoutMs: 10, onPhase: phase => phases.push(phase), readCredential: async () => secret,
    prepareNetwork: () => new Promise(() => {}), fetchImpl: async () => { requests += 1; throw new Error('must not run'); },
  }), error => error.phase === 'network_setup');
  assert.equal(requests, 0); assert.deepEqual(phases, ['credential', 'network_setup']);
});

test('CLI watchdog reports setup identity without leaking exceptions or claiming model timeout', async () => {
  let output = '', exitCode;
  const pending = runProbeCli([], { watchdogMs: 15, mainImpl: async (_args, { onPhase }) => {
    onPhase('credential'); return new Promise(() => {});
  }, write: async text => { output += text; }, exit: code => { exitCode = code; } });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(exitCode, 124);
  assert.deepEqual(JSON.parse(output), { status: 'probe_watchdog_timeout', phase: 'credential', modelRequestStarted: false });
  void pending;
});

test('CLI exits even when a timed-out native-like worker leaves an active handle', () => {
  const moduleUrl = new URL('./diagnose-official-chat-failure.mjs', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const {runProbeCli,withProbeDeadline} = await import(${JSON.stringify(moduleUrl)});
    await runProbeCli([], {watchdogMs: 200, mainImpl: async (_args,{onPhase}) => {
      onPhase('credential');
      return withProbeDeadline(() => new Promise(() => {setInterval(() => {},1000);}), 15, 'credential');
    }});
  `], { encoding: 'utf8', timeout: 2500 });
  assert.equal(child.error, undefined); assert.equal(child.status, 124); assert.equal(child.stderr, '');
  assert.deepEqual(JSON.parse(child.stdout), { status: 'probe_stage_timeout', phase: 'credential', modelRequestStarted: false });
});
