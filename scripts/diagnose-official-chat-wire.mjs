/** Raw-byte replay support. No Runner, tool handlers, retries, or automatic execution. */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdtemp, open, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { analyzeCapturedResponse, validateProbeInput, withProbeDeadline } from './diagnose-official-chat-failure.mjs';

const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 512 * 1024;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error(code); };

export async function readPrivateWireFile(filename, maximum = MAX_REQUEST_BYTES) {
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || (process.getuid && stat.uid !== process.getuid()) || stat.size > maximum) fail('PROBE_PRIVATE_FILE_REQUIRED');
    const bytes = await file.readFile();
    if (bytes.length > maximum) fail('PROBE_FILE_TOO_LARGE');
    return bytes;
  } finally { await file.close(); }
}

export function validateWireCapture(connection, model, bytes, capture) {
  validateProbeInput(connection, model, { messages: [{ role: 'user', content: 'validation only' }], tools: [] });
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_REQUEST_BYTES) fail('PROBE_INVALID_WIRE_BYTES');
  const endpoint = new URL(connection.baseUrl.replace(/\/+$/, '') + '/chat/completions').href;
  let request;
  try { request = JSON.parse(bytes.toString('utf8')); } catch { fail('PROBE_INVALID_WIRE_JSON'); }
  if (model !== 'gpt-5.6-luna' || request?.model !== model || request.stream !== true || !Array.isArray(request.messages) || !request.messages.length
    || (request.tools !== undefined && !Array.isArray(request.tools))) fail('PROBE_INVALID_WIRE_REQUEST');
  const lastUser = request.messages.filter(message => message?.role === 'user').at(-1);
  const text = typeof lastUser?.content === 'string' ? lastUser.content : Array.isArray(lastUser?.content)
    ? lastUser.content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n') : '';
  const markers = text.split(/\r?\n/).map(line => line.trim()).filter(line => /^NM_(?:WIRE_QA_[A-F0-9]{32}|LUNA_WIRE_QA_[0-9]{8}_[1-9][0-9]{0,5})$/.test(line));
  if (markers.length !== 1 || capture?.schemaVersion !== 1 || capture.status !== 'captured_without_dispatch'
    || capture.model !== model || capture.bodyBytes !== bytes.length || capture.sha256 !== sha256(bytes)
    || capture.endpointSha256 !== sha256(endpoint) || capture.nonceSha256 !== sha256(markers[0])
    || capture.targetUpstreamRequestCount !== 0 || capture.returnedModelResponseCount !== 0) fail('PROBE_CAPTURE_BINDING_MISMATCH');
  return { endpoint, request };
}

export async function loadWireCapture(filename, connection, model) {
  const directory = await lstat(dirname(filename));
  if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o777) !== 0o700
    || (process.getuid && directory.uid !== process.getuid())) fail('PROBE_PRIVATE_DIRECTORY_REQUIRED');
  const bytes = await readPrivateWireFile(filename);
  const capture = JSON.parse((await readPrivateWireFile(join(dirname(filename), 'capture-report.json'), 16 * 1024)).toString('utf8'));
  validateWireCapture(connection, model, bytes, capture);
  return { bytes, capture };
}

export async function claimWireReplay(filename) {
  await writeFile(join(dirname(filename), 'replay-claim'), '', { flag: 'wx', mode: 0o600 });
}

/** Let the installed SDK construct current protocol headers in memory, without dispatching them. */
export async function prepareWireTransport(connection, model, apiKey, expectedEndpoint, createClient) {
  createClient ??= (await import('../packages/model-runtime/lib/index.js')).createPreferredOfficialModelClient;
  let prepared, calls = 0;
  const client = createClient({ providerId: 'custom_openai', protocol: 'openai_chat_completions',
    baseUrl: connection.baseUrl, apiKey, model, timeoutMs: 0,
    fetchImpl: async (input, init) => {
      if (++calls !== 1 || String(input) !== expectedEndpoint || init?.method !== 'POST') fail('PROBE_TRANSPORT_MISMATCH');
      prepared = { url: String(input), headers: new Headers(init.headers) };
      // No real fetch: the normal SDK error exit is intentionally consumed below.
      fail('PROBE_TRANSPORT_PREPARED_WITHOUT_DISPATCH');
    } });
  try { await client.complete({ messages: [{ role: 'user', content: 'Prepare transport locally.' }], tools: [] }); }
  catch { /* Neither the SDK exception nor its body/headers is public output. */ }
  if (!prepared || calls !== 1 || prepared.headers.get('authorization') !== `Bearer ${apiKey}`
    || prepared.headers.get('content-type') !== 'application/json') fail('PROBE_TRANSPORT_PREPARATION_FAILED');
  return prepared;
}

export function analyzeWireCompletion(bytes, secrets) {
  const analysis = analyzeCapturedResponse(bytes, secrets);
  let done = false, contentFrameCount = 0, toolCallFragmentCount = 0;
  const finishReasons = new Set();
  const observe = payload => {
    for (const choice of Array.isArray(payload?.choices) ? payload.choices : []) {
      if ((typeof choice?.delta?.content === 'string' && choice.delta.content.length > 0)
        || (typeof choice?.message?.content === 'string' && choice.message.content.length > 0)) contentFrameCount += 1;
      for (const value of [choice?.delta?.tool_calls, choice?.message?.tool_calls]) if (Array.isArray(value)) toolCallFragmentCount += value.length;
      if (['stop', 'length', 'tool_calls', 'content_filter', 'function_call'].includes(choice?.finish_reason)) finishReasons.add(choice.finish_reason);
    }
  };
  const text = bytes.toString('utf8');
  if (text.trimStart().startsWith('{')) { try { observe(JSON.parse(text)); } catch {} }
  else for (const block of text.replace(/\r\n/g, '\n').split('\n\n')) {
    const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (data.trim() === '[DONE]') { done = true; continue; }
    if (data) try { observe(JSON.parse(data)); } catch {}
  }
  return { ...analysis, done, contentFrameCount, toolCallFragmentCount, finishReasons: [...finishReasons] };
}

export async function runPrivateWireProbe({ connection, model, bytes, capture }, {
  readCredential, fetchImpl, prepareNetwork, createClient, timeoutMs = 90_000, setupTimeoutMs = 15_000, onPhase = () => {},
} = {}) {
  const { endpoint, request } = validateWireCapture(connection, model, bytes, capture);
  if (typeof readCredential !== 'function' || typeof fetchImpl !== 'function') fail('PROBE_DEPENDENCIES_REQUIRED');
  onPhase('credential');
  const apiKey = await withProbeDeadline(() => readCredential(connection.id), setupTimeoutMs, 'credential');
  if (typeof apiKey !== 'string' || !apiKey.trim()) fail('PROBE_CREDENTIAL_UNAVAILABLE');
  if (prepareNetwork) { onPhase('network_setup'); await withProbeDeadline(prepareNetwork, setupTimeoutMs, 'network_setup'); }
  onPhase('adapter_setup');
  const transport = await withProbeDeadline(() => prepareWireTransport(connection, model, apiKey, endpoint, createClient), setupTimeoutMs, 'adapter_setup');
  onPhase('capture_setup');
  const privateDirectory = await mkdtemp(join(tmpdir(), 'nextmux-model-wire-private-'));
  await chmod(privateDirectory, 0o700);
  const rawPath = join(privateDirectory, 'response.bin');
  const file = await open(rawPath, 'wx', 0o600);
  const controller = new AbortController();
  const chunks = [];
  let received = 0, truncated = false, httpStatus, eventStream = false, reader, requests = 0, localFailure;
  const startedAt = new Date().toISOString(), started = performance.now();
  try {
    await withProbeDeadline(async () => {
      onPhase('request'); requests += 1;
      const response = await fetchImpl(transport.url, { method: 'POST', headers: transport.headers, body: bytes,
        redirect: 'error', signal: controller.signal });
      if (controller.signal.aborted) fail('PROBE_REQUEST_ALREADY_ENDED');
      httpStatus = response.status; eventStream = Boolean(response.headers.get('content-type')?.includes('text/event-stream'));
      if (!response.body) return;
      reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (controller.signal.aborted) fail('PROBE_REQUEST_ALREADY_ENDED');
        if (done) break;
        const remaining = MAX_RESPONSE_BYTES - received;
        chunks.push(Buffer.from(value).subarray(0, remaining));
        received += Math.min(remaining, value.byteLength);
        if (value.byteLength > remaining) { truncated = true; controller.abort(); void reader.cancel().catch(() => {}); break; }
      }
    }, timeoutMs, 'request');
  } catch (error) { localFailure = error?.phase === 'request' ? 'request_deadline' : 'transport_or_read_failure'; }
  finally {
    controller.abort();
    if (reader) void reader.cancel().catch(() => {});
    try { await file.writeFile(Buffer.concat(chunks)); } finally { await file.close(); }
  }
  const raw = await readFile(rawPath);
  const wire = analyzeWireCompletion(raw, [apiKey]);
  const outcome = localFailure ? 'local_failure' : truncated ? 'response_limit' : httpStatus < 200 || httpStatus >= 300 ? 'http_error'
    : wire.errors.length ? 'stream_error' : wire.invalidFrames ? 'invalid_response'
    : !(wire.done || wire.finishReasons.length) ? 'incomplete_response'
    : !wire.contentFrameCount && !wire.toolCallFragmentCount ? 'empty_response' : 'completed';
  const report = { schemaVersion: 1, mode: 'raw_wire_body', outcome, startedAt, elapsedMs: Math.round(performance.now() - started),
    model, protocol: 'openai_chat_completions', requestCount: requests, toolExecutionCount: 0,
    requestBodyBytes: bytes.length, requestBodySha256: sha256(bytes), originalCaptureSha256: capture.sha256,
    messageCount: request.messages.length, toolDefinitionCount: request.tools?.length || 0,
    ...(httpStatus === undefined ? {} : { httpStatus }), eventStream, ...(localFailure ? { localFailure } : {}),
    capture: { privateDirectory, rawPath, capturedBytes: raw.length, truncated, sha256: sha256(raw) }, wire };
  await writeFile(join(privateDirectory, 'redacted-report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return report;
}
