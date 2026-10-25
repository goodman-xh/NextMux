/**
 * Shared, side-effect-free client helpers for the managed Gateway Session
 * WebSocket protocol.
 *
 * This module deliberately does not open a socket on import.  Callers must
 * pass a WebSocket constructor to connect(), which keeps local tests fully
 * offline and makes the transport dependency explicit.
 */
import { execFileSync } from 'node:child_process';

/**
 * Resolve the desktop device identity without ever logging its value.
 * Non-macOS callers must provide an injected identity because the keychain
 * command is intentionally macOS-specific.
 */
export function deviceId({
  env = process.env,
  platform = process.platform,
  exec = execFileSync,
} = {}) {
  if (env.NEXTMUX_CANARY_DEVICE_ID) return String(env.NEXTMUX_CANARY_DEVICE_ID).trim();
  if (platform !== 'darwin') throw new Error('device_id_required_on_non_macos');
  return exec('security', ['find-generic-password', '-s', 'NextMux', '-a', 'desktop-device-id', '-w'], { encoding: 'utf8' }).trim();
}

export function sessionUrl(origin, sessionId) {
  const url = new URL('/api/gateway/session', String(origin).replace(/\/+$/, ''));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('session', String(sessionId));
  return url.toString();
}

/**
 * Open one managed session and collect parseable JSON frames.  The helper is
 * intentionally transport-only: it never sends a start/resume frame.
 */
export function connect(sessionId, rawDevice, {
  origin = process.env.NEXTMUX_CANARY_ORIGIN || 'https://nextmux.app',
  WebSocket: WebSocketCtor,
  timeoutMs = 45_000,
} = {}) {
  if (typeof WebSocketCtor !== 'function') throw new Error('websocket_constructor_required');
  return new Promise((resolvePromise, reject) => {
    const socket = new WebSocketCtor(sessionUrl(origin, sessionId), {
      headers: { 'x-nextmux-device-id': rawDevice, 'x-nextmux-session-id': sessionId },
    });
    const events = [];
    let opened = false;
    let settled = false;
    const timer = setTimeout(() => {
      try { socket.close(); } catch {}
      if (!settled) {
        settled = true;
        reject(new Error('websocket_timeout'));
      }
    }, timeoutMs);
    socket.addEventListener('open', () => {
      opened = true;
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolvePromise({ socket, events });
      }
    });
    socket.addEventListener('message', event => {
      try { events.push(JSON.parse(String(event.data))); } catch { /* protocol evidence only */ }
    });
    socket.addEventListener('error', () => {
      if (!opened && !settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error('websocket_error'));
      }
    });
  });
}

export function waitFor(events, predicate, timeoutMs = 45_000) {
  if (!Array.isArray(events)) throw new TypeError('events_array_required');
  if (typeof predicate !== 'function') throw new TypeError('event_predicate_required');
  return new Promise((resolvePromise, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      const hit = events.find(predicate);
      if (hit) { resolvePromise(hit); return; }
      if (Date.now() >= deadline) { reject(new Error('websocket_event_timeout')); return; }
      setTimeout(check, 25);
    };
    check();
  });
}

/** Return protocol metadata only; never include prompts, response bodies, or credentials. */
export function safeEvent(event) {
  if (!event || typeof event !== 'object') return {};
  const value = { type: String(event.type || '') };
  if (event.taskId) value.taskId = String(event.taskId);
  if (Number.isSafeInteger(Number(event.sequence))) value.sequence = Number(event.sequence);
  if (event.duplicate === true) value.duplicate = true;
  if (event.status) value.status = String(event.status);
  if (event.event?.type) value.eventType = String(event.event.type);
  if (event.event?.requestId) value.requestId = String(event.event.requestId).slice(0, 160);
  if (event.event?.error?.code) value.errorCode = String(event.event.error.code).slice(0, 80);
  if (event.recoveryContract && typeof event.recoveryContract === 'object') {
    value.recoveryContract = {
      version: Number(event.recoveryContract.version) || 0,
      contentRetained: event.recoveryContract.contentRetained === true,
      replayable: event.recoveryContract.replayable === true,
      providerResume: String(event.recoveryContract.providerResume || '').slice(0, 40),
    };
  }
  if (event.code) value.code = String(event.code).slice(0, 80);
  return value;
}
