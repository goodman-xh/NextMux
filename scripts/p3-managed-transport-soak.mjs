#!/usr/bin/env node
/**
 * Zero-billing transport soak for the managed gateway session.
 *
 * This script only opens the authenticated `/api/gateway/session` WebSocket
 * and sends protocol `ping` frames. It never sends a `start` frame, therefore
 * it cannot dispatch a model request, reserve balance, or create a billable
 * inference attempt. A pong renews the server-side lease. The report records
 * transport/lease evidence only; it is not evidence that a provider stream
 * survived for the requested duration or that a provider can be resumed.
 *
 * The CLI defaults to a ten-minute local run. Durations of `1h` and `72h` are
 * accepted only with explicit production opt-in (`--production` plus
 * `P3_ALLOW_PRODUCTION_SOAK=yes`) so a copied command cannot start a costly
 * long-running operation accidentally. Use `--production --origin=...` for a
 * real endpoint. No key, device id, prompt, response, or cookie is written.
 */
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { WebSocket as UndiciWebSocket } from '../packages/theia-nextmux-extension/node_modules/undici/index.js';
import { deviceId, sessionUrl } from './managed-session-client.mjs';

const DEFAULT_DURATION = '10m';
const DEFAULT_PING_INTERVAL_MS = 30_000;
const CONNECT_TIMEOUT_MS = 45_000;
const MAX_DURATION_MS = 72 * 60 * 60 * 1_000;

export function parseDuration(value) {
  const match = /^(10m|1h|72h)$/.exec(String(value || '').trim());
  if (!match) throw new Error('duration_must_be_10m_1h_or_72h');
  return match[1].endsWith('m') ? Number(match[1].slice(0, -1)) * 60_000 : Number(match[1].slice(0, -1)) * 60 * 60_000;
}

function parseArgs(argv = []) {
  const args = new Map();
  let production = false;
  for (const value of argv) {
    if (value === '--production') { production = true; continue; }
    const match = /^--([^=]+)=(.*)$/.exec(value);
    if (match) args.set(match[1], match[2]);
    else if (value.startsWith('--')) args.set(value.slice(2), 'true');
  }
  const durationName = args.get('duration') || DEFAULT_DURATION;
  const durationMs = parseDuration(durationName);
  const origin = String(args.get('origin') || process.env.P3_SOAK_ORIGIN || (production ? 'https://nextmux.app' : 'http://127.0.0.1:4173')).replace(/\/+$/, '');
  const pingIntervalMs = Math.max(1_000, Math.min(60_000, Number(args.get('ping-interval') || DEFAULT_PING_INTERVAL_MS)));
  if (!Number.isSafeInteger(pingIntervalMs) || pingIntervalMs < 1_000) throw new Error('ping_interval_invalid');
  if (production && process.env.P3_ALLOW_PRODUCTION_SOAK !== 'yes') throw new Error('production_opt_in_required');
  if (durationMs > parseDuration('10m') && !production) throw new Error('long_duration_requires_production_opt_in');
  return {
    production,
    durationName,
    durationMs,
    origin,
    pingIntervalMs,
    output: args.get('output') ? resolve(args.get('output')) : undefined,
    deviceOverride: process.env.P3_SOAK_DEVICE_ID || process.env.NEXTMUX_CANARY_DEVICE_ID || '',
  };
}

function wait(milliseconds) { return new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds)); }
function safeHost(origin) {
  try { return new URL(origin).host; } catch { return 'invalid'; }
}
function shortId(value) { return `${String(value).slice(0, 8)}…`; }

/** Connect one socket and resolve only after the WebSocket handshake. */
function connectSocket({ WebSocketCtor, origin, sessionId, rawDevice, timeoutMs, counters }) {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    let timer;
    let socket;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      error ? reject(error) : resolvePromise(value);
    };
    try {
      socket = new WebSocketCtor(sessionUrl(origin, sessionId), {
        headers: { 'x-nextmux-device-id': rawDevice, 'x-nextmux-session-id': sessionId },
      });
    } catch (error) { finish(error instanceof Error ? error : new Error('websocket_create_failed')); return; }
    const closed = new Promise(resolveClose => {
      socket.addEventListener('close', event => {
        counters.close += 1;
        resolveClose({ kind: 'close', code: Number(event?.code) || 0 });
      });
    });
    socket.addEventListener('open', () => { counters.open += 1; finish(undefined, { socket, closed }); });
    socket.addEventListener('message', event => {
      let frame;
      try { frame = JSON.parse(String(event?.data || '')); } catch { counters.malformed += 1; return; }
      if (frame?.type === 'pong') counters.pong += 1;
      else if (frame?.type === 'session.error') counters.sessionErrors += 1;
    });
    socket.addEventListener('error', () => { counters.errors += 1; });
    timer = setTimeout(() => {
      try { socket.close(1000, 'handshake_timeout'); } catch {}
      finish(new Error('websocket_handshake_timeout'));
    }, timeoutMs);
  });
}

export async function runTransportSoak({
  origin,
  durationMs,
  durationName,
  production = false,
  rawDevice,
  WebSocketCtor = UndiciWebSocket,
  pingIntervalMs = DEFAULT_PING_INTERVAL_MS,
  now = () => Date.now(),
} = {}) {
  if (!origin || !Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > MAX_DURATION_MS) throw new Error('soak_options_invalid');
  if (!rawDevice || !/^[A-Za-z0-9:_-]{16,180}$/.test(String(rawDevice))) throw new Error('device_id_invalid');
  const startedAtMs = now();
  const deadline = startedAtMs + durationMs;
  const sessionId = randomUUID();
  const counters = { open: 0, close: 0, reconnect: 0, ping: 0, pong: 0, errors: 0, sessionErrors: 0, malformed: 0, startFrames: 0 };
  let socket;
  let closeSignal;
  let lastError = '';
  try {
    while (now() < deadline) {
      try {
        const connected = await connectSocket({ WebSocketCtor, origin, sessionId, rawDevice: String(rawDevice), timeoutMs: CONNECT_TIMEOUT_MS, counters });
        socket = connected.socket;
        closeSignal = connected.closed;
      } catch (error) {
        lastError = String(error?.message || 'connect_failed').slice(0, 100);
        counters.errors += 1;
        if (now() >= deadline) break;
        counters.reconnect += 1;
        await wait(Math.min(2_000, Math.max(100, pingIntervalMs)));
        continue;
      }
      while (socket?.readyState === 1 && now() < deadline) {
        try { socket.send(JSON.stringify({ type: 'ping' })); counters.ping += 1; }
        catch (error) { lastError = String(error?.message || 'ping_failed').slice(0, 100); break; }
        const remaining = Math.max(1, deadline - now());
        const result = await Promise.race([wait(Math.min(pingIntervalMs, remaining)), closeSignal]);
        if (result?.kind === 'close') break;
      }
      if (now() >= deadline) break;
      counters.reconnect += 1;
      try { socket?.close(1000, 'soak_reconnect'); } catch {}
      socket = undefined;
      closeSignal = undefined;
    }
  } finally {
    try { socket?.close(1000, 'soak_complete'); } catch {}
  }
  const finishedAtMs = now();
  const durationReached = finishedAtMs >= deadline;
  return {
    version: 1,
    stage: 'P3',
    mode: 'authenticated-transport-heartbeat-soak',
    status: durationReached && counters.open > 0 && counters.ping > 0 && counters.pong > 0 && counters.startFrames === 0 ? 'passed' : 'failed',
    productionData: Boolean(production),
    origin: safeHost(origin),
    sessionId: shortId(sessionId),
    durationRequested: durationName || `${Math.round(durationMs / 60_000)}m`,
    durationMs: Math.max(0, finishedAtMs - startedAtMs),
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: new Date(finishedAtMs).toISOString(),
    counters,
    durationReached,
    lastError: lastError || undefined,
    billing: { startFrames: 0, providerRequests: 0, inferenceRequests: 0, chargedMicros: 0, merchantCostMicros: 0 },
    limitations: [
      'Zero-billing transport evidence only: no start frame, provider request, model generation, reservation, or billable attempt was sent.',
      'Pongs prove that the authenticated DO WebSocket and lease renewal stayed reachable; they do not prove a provider stream ran for this duration.',
      'Provider-owned 1h/72h resumable task evidence remains required. Generic routes recover billing metadata only after a transport loss.',
    ],
    references: {
      workersLimits: 'https://developers.cloudflare.com/workers/platform/limits/',
      durableObjectWebSockets: 'https://developers.cloudflare.com/durable-objects/best-practices/websockets/',
      durableObjectLimits: 'https://developers.cloudflare.com/durable-objects/platform/limits/',
    },
  };
}

async function writeReport(path, report) {
  if (!path) return;
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const rawDevice = options.deviceOverride || deviceId();
  const report = await runTransportSoak({ ...options, rawDevice, WebSocketCtor: UndiciWebSocket });
  await writeReport(options.output || resolve(`docs/reports/p3-transport-soak-${options.durationName}-${new Date().toISOString().slice(0, 10)}.json`), report);
  process.stdout.write(`${JSON.stringify({ status: report.status, durationRequested: report.durationRequested, durationReached: report.durationReached, counters: report.counters, billing: report.billing })}\n`);
  if (report.status !== 'passed') process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) await main().catch(error => { process.stderr.write(`${JSON.stringify({ status: 'blocked', code: String(error?.message || 'soak_failed') })}\n`); process.exitCode = 2; });
