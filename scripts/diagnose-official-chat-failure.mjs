#!/usr/bin/env node
/** Explicit, one-request developer probe. Nothing runs when this module is imported. */
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, open, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_CAPTURE_BYTES = 512 * 1024;
const MAX_REQUEST_BYTES = 1024 * 1024;
const EVENT_TYPES = new Set(['response.started', 'content.started', 'content.delta', 'content.completed',
  'reasoning.started', 'reasoning.delta', 'reasoning.completed', 'tool_call.started', 'tool_call.arguments_delta',
  'tool_call.completed', 'response.completed', 'response.failed', 'usage']);
const PHASES = new Set(['setup', 'service_import', 'credential', 'network_setup', 'capture_setup', 'adapter_setup', 'request', 'cleanup']);

class ProbeStageTimeout extends Error {
  constructor(phase) { super('Private probe stage timed out'); this.phase = phase; }
}

/** Racing a native Keychain worker bounds the caller, but cannot cancel that worker. */
export async function withProbeDeadline(operation, milliseconds, phase) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new ProbeStageTimeout(phase)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

/** Never return provider headers/param/unknown fields. Actual credential is removed before other heuristics. */
export function redactDiagnosticText(value, secrets = [], maximum = 1200) {
  if (typeof value !== 'string') return undefined;
  let text = value;
  for (const secret of secrets) if (typeof secret === 'string' && secret) {
    for (const variant of new Set([secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64')])) {
      text = text.split(variant).join('[credential]');
    }
  }
  text = text
    .replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/gi, '[url]')
    .replace(/\b(?:Bearer|Basic)\s+[^\s"'<>]+/gi, '[credential]')
    .replace(/\b(?:authorization|proxy-authorization|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|token|key|credential|cookie|set-cookie|secret|password)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '[credential]')
    .replace(/\b(?:sk-|gsk_|rk_|AIza)[A-Za-z0-9_-]{6,}/g, '[credential]')
    .replace(/\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[token]')
    .replace(/[A-Za-z0-9_+/=-]{24,}/g, '[token]')
    .replace(/\b\d{12,}\b/g, '[number]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ');
  return text.slice(0, maximum);
}

const valueType = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;

export function publicErrorFields(error, secrets = []) {
  if (!error || typeof error !== 'object' || Array.isArray(error)) return { kind: valueType(error) };
  return {
    kind: 'object',
    messageType: valueType(error.message),
    ...(typeof error.message === 'string' ? { messageLength: error.message.length, message: redactDiagnosticText(error.message, secrets) } : {}),
    typeType: valueType(error.type),
    ...(typeof error.type === 'string' ? { type: redactDiagnosticText(error.type, secrets, 120) } : {}),
    codeType: valueType(error.code),
    ...(typeof error.code === 'string' ? { code: redactDiagnosticText(error.code, secrets, 120) }
      : Number.isFinite(error.code) ? { code: error.code >= 100 && error.code <= 599 ? error.code : '[number]' } : {}),
  };
}

/** Inspect only protocol-defined error locations. Ordinary assistant content is not printed. */
export function analyzeCapturedResponse(raw, secrets = []) {
  const text = typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8');
  const errors = [];
  let parsedFrames = 0;
  let invalidFrames = 0;
  const observe = (payload, frame) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
    if (Object.hasOwn(payload, 'error') && errors.length < 4) errors.push({ frame, ...publicErrorFields(payload.error, secrets) });
  };
  if (text.trimStart().startsWith('{')) {
    try { observe(JSON.parse(text), 'json'); parsedFrames += 1; } catch { invalidFrames += 1; }
  } else {
    for (const block of text.replace(/\r\n/g, '\n').split('\n\n')) {
      const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (!data || data.trim() === '[DONE]') continue;
      try { observe(JSON.parse(data), 'sse'); parsedFrames += 1; } catch { invalidFrames += 1; }
    }
  }
  return { parsedFrames, invalidFrames, errors };
}

export function validateProbeInput(connection, model, request) {
  if (connection?.providerId !== 'custom_openai' || connection?.protocol !== 'openai_chat_completions') throw new Error('PROBE_REQUIRES_CUSTOM_CHAT_COMPLETIONS');
  if (typeof model !== 'string' || !/^[A-Za-z0-9._/-]{1,160}$/.test(model)) throw new Error('PROBE_INVALID_MODEL');
  const url = new URL(connection.baseUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('PROBE_REQUIRES_SAVED_HTTPS_ENDPOINT');
  if (!request || typeof request !== 'object' || !Array.isArray(request.messages) || !request.messages.length || !Array.isArray(request.tools)) throw new Error('PROBE_INVALID_REQUEST');
  if (Buffer.byteLength(JSON.stringify(request)) > MAX_REQUEST_BYTES) throw new Error('PROBE_REQUEST_TOO_LARGE');
  if (Object.keys(request).some(key => !['messages', 'tools', 'instructions', 'reasoningEffort', 'maxOutputTokens'].includes(key))) throw new Error('PROBE_UNKNOWN_REQUEST_FIELD');
  return request;
}

/** Dependency seams allow offline tests. Credentials are never accepted as CLI arguments or env vars. */
export async function runPrivateChatProbe({ connection, model, request }, { readCredential, fetchImpl, createClient,
  prepareNetwork, timeoutMs = 90_000, setupTimeoutMs = 15_000, onPhase = () => {} } = {}) {
  validateProbeInput(connection, model, request);
  if (typeof readCredential !== 'function' || typeof fetchImpl !== 'function') throw new Error('PROBE_DEPENDENCIES_REQUIRED');
  onPhase('credential');
  const apiKey = await withProbeDeadline(() => readCredential(connection.id), setupTimeoutMs, 'credential');
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('PROBE_CREDENTIAL_UNAVAILABLE');
  if (prepareNetwork) {
    onPhase('network_setup');
    await withProbeDeadline(prepareNetwork, setupTimeoutMs, 'network_setup');
  }
  onPhase('capture_setup');
  const privateDirectory = await mkdtemp(join(tmpdir(), 'nextmux-model-private-'));
  await chmod(privateDirectory, 0o700);
  const rawPath = join(privateDirectory, 'response.bin');
  const handle = await open(rawPath, 'wx', 0o600);
  const capturedChunks = [];
  let capturedBytes = 0, receivedBytes = 0, requests = 0, httpStatus, eventStream = false;
  const events = {};
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let outcome = 'failed', failure;
  try {
    onPhase('adapter_setup');
    createClient ??= (await import('../packages/model-runtime/lib/index.js')).createPreferredOfficialModelClient;
    const client = createClient({ providerId: 'custom_openai', protocol: 'openai_chat_completions',
      baseUrl: connection.baseUrl, apiKey, model, timeoutMs: 0,
      fetchImpl: async (input, init) => {
        if (++requests > 1) throw new Error('PROBE_MULTIPLE_REQUESTS_REFUSED');
        onPhase('request');
        const response = await fetchImpl(input, { ...init, redirect: 'error' });
        httpStatus = response.status;
        eventStream = Boolean(response.headers.get('content-type')?.includes('text/event-stream'));
        if (!response.body) return response;
        const body = response.body.pipeThrough(new TransformStream({
          transform(chunk, output) {
            receivedBytes += chunk.byteLength;
            const allowed = Math.min(chunk.byteLength, MAX_CAPTURE_BYTES - capturedBytes);
            if (allowed > 0) { capturedChunks.push(Buffer.from(chunk).subarray(0, allowed)); capturedBytes += allowed; }
            output.enqueue(chunk);
          },
        }));
        return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      },
    });
    await client.complete({ ...request, signal: controller.signal, onModelEvent: event => {
      const type = EVENT_TYPES.has(event.type) ? event.type : 'other'; events[type] = (events[type] || 0) + 1;
    } });
    outcome = 'completed';
  } catch (error) {
    // The official normalized object is already public-safe. Pick fixed
    // fields anyway; never stringify the raw exception or its stack.
    failure = { code: redactDiagnosticText(error?.code, [apiKey], 120),
      stage: redactDiagnosticText(error?.stage, [apiKey], 40), category: redactDiagnosticText(error?.category, [apiKey], 40),
      retrySafe: error?.retrySafe === true, retryable: error?.retryable === true };
  } finally {
    clearTimeout(timer);
    controller.abort();
    await handle.write(Buffer.concat(capturedChunks));
    await handle.close();
  }
  const raw = await readFile(rawPath);
  const report = { schemaVersion: 1, outcome, startedAt, elapsedMs: Math.round(performance.now() - started),
    model, protocol: 'openai_chat_completions', requestCount: requests, toolExecutionCount: 0,
    messageCount: request.messages.length, toolDefinitionCount: request.tools.length,
    ...(httpStatus === undefined ? {} : { httpStatus }), eventStream, events, ...(failure ? { failure } : {}),
    capture: { privateDirectory, rawPath, capturedBytes, truncated: receivedBytes > capturedBytes, sha256: createHash('sha256').update(raw).digest('hex') },
    wire: analyzeCapturedResponse(raw, [apiKey]),
  };
  await writeFile(join(privateDirectory, 'redacted-report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return report;
}

export async function main(args = process.argv.slice(2), { onPhase = () => {} } = {}) {
  onPhase('setup');
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--execute') options.execute = true;
    else if (['--connection-id', '--model', '--request-file', '--wire-request-file'].includes(arg) && args[i + 1]) options[arg.slice(2)] = args[++i];
    else throw new Error('PROBE_INVALID_ARGUMENT');
  }
  if (!options.execute) return { status: 'not-executed', required: '--execute --connection-id ID --model MODEL --request-file PRIVATE_JSON', networkRequests: 0, credentialReads: 0 };
  if (!options['connection-id'] || !options.model || Boolean(options['request-file']) === Boolean(options['wire-request-file'])) throw new Error('PROBE_MISSING_OR_CONFLICTING_ARGUMENT');
  if (options['wire-request-file'] && process.env.NEXTMUX_PRIVATE_CAPTURE_CONFIG) throw new Error('PROBE_REMOVE_CAPTURE_PRELOAD_BEFORE_REPLAY');
  const dataRoot = join(homedir(), 'Library', 'Application Support', 'NextMux');
  const saved = JSON.parse(await readFile(join(dataRoot, 'official-connections-v1.json'), 'utf8'));
  const connections = Array.isArray(saved) ? saved : saved.connections;
  const connection = connections?.find(item => item.id === options['connection-id']);
  if (!connection) throw new Error('PROBE_CONNECTION_NOT_FOUND');
  let request, wireCapture, runWireProbe;
  if (options['wire-request-file']) {
    const wire = await import('./diagnose-official-chat-wire.mjs');
    const filename = resolve(options['wire-request-file']);
    wireCapture = await wire.loadWireCapture(filename, connection, options.model);
    // Claim before credentials/import/network, across CLI processes. Keep the claim on all failures.
    await wire.claimWireReplay(filename);
    runWireProbe = wire.runPrivateWireProbe;
  } else {
    request = JSON.parse(await readFile(resolve(options['request-file']), 'utf8'));
    validateProbeInput(connection, options.model, request);
  }
  onPhase('service_import');
  const { NextMuxPlatformServiceImpl } = await withProbeDeadline(
    () => import('../packages/theia-nextmux-extension/lib/node/nextmux-platform-service.js'), 15_000, 'service_import');
  const service = new NextMuxPlatformServiceImpl();
  service.nextmuxDataRoot = () => dataRoot;
  try {
    const dependencies = {
      readCredential: id => service.readOfficialCredential(id), fetchImpl: service.networkFetch,
      prepareNetwork: () => service.ensureNetworkConfigured(), onPhase,
    };
    return runWireProbe ? await runWireProbe({ connection, model: options.model, ...wireCapture }, dependencies)
      : await runPrivateChatProbe({ connection, model: options.model, request }, dependencies);
  } finally {
    if (service.networkDispatcher) {
      onPhase('cleanup');
      await withProbeDeadline(() => service.networkDispatcher.close(), 5_000, 'cleanup').catch(() => undefined);
    }
  }
}

/** Force CLI exit after flushing safe output: a timed-out native worker may still own a libuv handle. */
export async function runProbeCli(args = process.argv.slice(2), {
  mainImpl = main, write = value => new Promise(resolve => process.stdout.write(value, resolve)),
  exit = code => process.exit(code), watchdogMs = 150_000,
} = {}) {
  let phase = 'setup';
  let modelRequestStarted = false;
  let finished = false;
  const finish = async (report, code) => {
    if (finished) return;
    finished = true;
    clearTimeout(watchdog);
    // Ensure a blocked stdout cannot keep the native worker alive forever.
    const flushLimit = setTimeout(() => exit(code), 1_000);
    try { await write(JSON.stringify(report, null, 2) + '\n'); }
    finally { clearTimeout(flushLimit); exit(code); }
  };
  const watchdog = setTimeout(() => void finish({ status: 'probe_watchdog_timeout', phase,
    modelRequestStarted }, 124), watchdogMs);
  try {
    const report = await mainImpl(args, { onPhase: next => {
      if (PHASES.has(next)) phase = next;
      if (next === 'request') modelRequestStarted = true;
    } });
    await finish(report, 0);
  } catch (error) {
    await finish({ status: error instanceof ProbeStageTimeout ? 'probe_stage_timeout' : 'probe_setup_failed',
      phase: error instanceof ProbeStageTimeout && PHASES.has(error.phase) ? error.phase : phase,
      modelRequestStarted }, error instanceof ProbeStageTimeout ? 124 : 1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runProbeCli();
}
