import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const desktopRequire = createRequire(pathToFileURL(resolve('apps/desktop/package.json')));
const { defaultMsgPack } = desktopRequire('@theia/core/lib/common/message-rpc/rpc-message-encoder');
const textDecoder = new TextDecoder();

export const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export function uniqueNewResourceId(beforeIds, afterIds, resourceLabel) {
  const before = new Set((beforeIds || []).filter(id => typeof id === 'string' && id));
  const candidates = [...new Set((afterIds || []).filter(id => typeof id === 'string' && id))]
    .filter(id => !before.has(id));
  if (candidates.length > 1) {
    throw new Error(`Refusing to guess which ${resourceLabel} is temporary; found ${candidates.length} new IDs: ${candidates.join(', ')}.`);
  }
  return candidates[0] || '';
}

export function throwPrimaryOrCleanupErrors(primaryError, cleanupErrors, label) {
  const cleanup = (cleanupErrors || []).filter(Boolean);
  if (primaryError && cleanup.length) {
    throw new AggregateError(
      [primaryError, ...cleanup],
      `${label} failed and ${cleanup.length} cleanup operation${cleanup.length === 1 ? '' : 's'} also failed.`,
      { cause: primaryError }
    );
  }
  if (primaryError) throw primaryError;
  if (cleanup.length) throw new AggregateError(cleanup, `${label} cleanup failed.`);
}

export function assertDisposableDesktopE2E(environment = process.env) {
  if (environment.NEXTMUX_DESKTOP_E2E_ISOLATED !== '1') {
    throw new Error('Refusing to run a mutating desktop E2E outside the disposable Electron profile runner.');
  }
  const profile = resolve(String(environment.NEXTMUX_DESKTOP_E2E_PROFILE_DIR || ''));
  const state = resolve(String(environment.NEXTMUX_DESKTOP_STATE_DIR || ''));
  const stateRelative = relative(profile, state);
  if (!environment.NEXTMUX_DESKTOP_E2E_PROFILE_DIR || !environment.NEXTMUX_DESKTOP_STATE_DIR
    || !stateRelative || stateRelative.startsWith('..') || isAbsolute(stateRelative)) {
    throw new Error('The disposable desktop E2E state directory must be a child of its unique profile directory.');
  }
  const agentState = environment.NEXTMUX_AGENT_STATE_DIR
    ? resolve(String(environment.NEXTMUX_AGENT_STATE_DIR))
    : state;
  const agentStateRelative = relative(profile, agentState);
  if (!agentStateRelative || agentStateRelative.startsWith('..') || isAbsolute(agentStateRelative)) {
    throw new Error('The desktop E2E agent state directory must be a child of its unique profile directory.');
  }
  return { agentState, profile, state };
}

export function normalizeEndpointForComparison(value) {
  const parsed = new URL(String(value || '').trim());
  const pathname = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, '') : parsed.pathname;
  return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${pathname}${parsed.search}`;
}

export function parseJsonRpcFrames(frames) {
  const messages = [];
  const visit = value => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === 'object') messages.push(value);
  };
  for (const frame of frames || []) {
    const text = typeof frame === 'string' ? frame : frame?.kind === 'text' ? frame.data : '';
    if (!text.trim()) continue;
    try {
      visit(JSON.parse(text));
    } catch {
      // CDP may observe non-JSON WebSocket traffic from unrelated services.
    }
  }
  return messages;
}

function readUint32(bytes, offset) {
  if (offset + 4 > bytes.length) throw new Error('Truncated Theia channel string length.');
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);
}

function readVariableLength(bytes, start) {
  let offset = start;
  let shift = 0;
  let value = 0;
  while (offset < bytes.length) {
    const byte = bytes[offset++];
    value += (byte & 127) * (2 ** shift);
    if (byte <= 127) return { length: value, offset };
    shift += 7;
    if (shift > 49) throw new Error('Invalid Theia message length.');
  }
  throw new Error('Truncated Theia message length.');
}

/** Decode the maintained Theia channel multiplexer and MsgPack RPC protocol used by the desktop. */
export function parseTheiaRpcFrames(frames) {
  const messages = [];
  for (const frame of frames || []) {
    if (!frame || typeof frame !== 'object' || frame.kind !== 'binary' || typeof frame.data !== 'string') continue;
    try {
      const bytes = Buffer.from(frame.data, 'base64');
      // ChannelMultiplexer.MessageTypes.Data. Socket.IO sends the binary attachment unchanged.
      if (bytes[0] !== 4) continue;
      const channelLength = readUint32(bytes, 1);
      const channelStart = 5;
      const channelEnd = channelStart + channelLength;
      if (channelEnd > bytes.length) continue;
      const channel = textDecoder.decode(bytes.subarray(channelStart, channelEnd));
      if (channel !== '/services/nextmux-platform') continue;
      const payload = readVariableLength(bytes, channelEnd);
      const payloadEnd = payload.offset + payload.length;
      if (payloadEnd !== bytes.length) continue;
      const message = defaultMsgPack.decode(bytes.subarray(payload.offset, payloadEnd));
      if (message && typeof message === 'object') messages.push(message);
    } catch {
      // Unrelated Socket.IO binary events are expected on the shared transport.
    }
  }
  return messages;
}

export function extractAgentRunRpcRequests(frames) {
  return [...parseJsonRpcFrames(frames), ...parseTheiaRpcFrames(frames)].flatMap(message => {
    const method = typeof message.method === 'string' ? message.method : '';
    if (!/(?:^|[/.])(startAgentRun|runAgent)$/.test(method)) return [];
    const params = message.type === 1 && Array.isArray(message.args) ? message.args : message.params;
    const request = Array.isArray(params) ? params[0]
      : params && typeof params === 'object' && params.request && typeof params.request === 'object' ? params.request
        : params;
    return request && typeof request === 'object' ? [{ method, request, message }] : [];
  });
}

export function assertExactAgentRunRpc(frames, expected, options = {}) {
  const marker = String(options.marker || '');
  const requests = extractAgentRunRpcRequests(frames);
  const matching = marker
    ? requests.filter(entry => typeof entry.request?.prompt === 'string' && entry.request.prompt.includes(marker))
    : requests;
  assert.ok(matching.length > 0, `No structured startAgentRun/runAgent JSON-RPC request contained marker ${JSON.stringify(marker)}.`);
  const exact = matching.find(entry => entry.request?.route?.kind === 'official_connection'
    && entry.request.route.connectionId === expected.connectionId
    && entry.request.route.model === expected.providerModelId);
  assert.ok(exact, `No matching JSON-RPC request used official connection ${expected.connectionId} and model ${expected.providerModelId}.`);
  return exact;
}

export async function installWebSocketJsonRpcCapture(evaluate, captureKey) {
  await evaluate(`(() => {
    const key = ${JSON.stringify(captureKey)};
    const previous = window[key];
    if (previous?.wrapper && WebSocket.prototype.send === previous.wrapper) {
      previous.frames.length = 0;
      return true;
    }
    const original = WebSocket.prototype.send;
    const state = { frames: [], original, wrapper: undefined, pending: 0 };
    const bytesToBase64 = bytes => {
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
      }
      return btoa(binary);
    };
    const recordBytes = bytes => state.frames.push({ kind: 'binary', data: bytesToBase64(bytes), byteLength: bytes.byteLength });
    const wrapper = function(data) {
      try {
        if (typeof data === 'string') state.frames.push({ kind: 'text', data });
        else if (data instanceof ArrayBuffer) recordBytes(new Uint8Array(data));
        else if (ArrayBuffer.isView(data)) recordBytes(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        else if (data instanceof Blob) {
          state.pending += 1;
          data.arrayBuffer().then(buffer => recordBytes(new Uint8Array(buffer))).finally(() => { state.pending -= 1; });
        }
      } catch {}
      return original.call(this, data);
    };
    state.wrapper = wrapper;
    window[key] = state;
    WebSocket.prototype.send = wrapper;
    return true;
  })()`);
}

export async function readCapturedJsonRpcFrames(evaluate, captureKey) {
  return evaluate(`(async () => {
    const state = window[${JSON.stringify(captureKey)}];
    if (!state) return [];
    const deadline = Date.now() + 2_000;
    while (state.pending > 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    return Array.isArray(state.frames) ? [...state.frames] : [];
  })()`);
}

export async function uninstallWebSocketJsonRpcCapture(evaluate, captureKey) {
  await evaluate(`(() => {
    const key = ${JSON.stringify(captureKey)};
    const state = window[key];
    if (state?.wrapper && WebSocket.prototype.send === state.wrapper && typeof state.original === 'function') {
      WebSocket.prototype.send = state.original;
    }
    delete window[key];
    return true;
  })()`);
}

export async function snapshotBrowserState(evaluate) {
  return evaluate(`(() => ({
    local: Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])),
    session: Object.fromEntries(Object.keys(sessionStorage).map(key => [key, sessionStorage.getItem(key)])),
    scrollX,
    scrollY
  }))()`);
}

export async function readConversationSessionIds(evaluate) {
  return evaluate(`(() => {
    const stored = JSON.parse(localStorage.getItem('nextmux.desktop.codingSessions.v1') || '{}');
    const sessions = Array.isArray(stored) ? stored : Array.isArray(stored.sessions) ? stored.sessions : [];
    return [...new Set(sessions.map(session => typeof session?.id === 'string' ? session.id : '').filter(Boolean))].sort();
  })()`);
}

export async function resolveUniqueNewConversationId(evaluate, beforeSessionIds) {
  const afterSessionIds = await readConversationSessionIds(evaluate);
  return uniqueNewResourceId(beforeSessionIds, afterSessionIds, 'conversation session');
}

export async function restoreBrowserState({ evaluate, snapshot, reload }) {
  if (!snapshot) return;
  await evaluate(`(() => {
    localStorage.clear();
    for (const [key, value] of Object.entries(${JSON.stringify(snapshot.local)})) localStorage.setItem(key, value);
    sessionStorage.clear();
    for (const [key, value] of Object.entries(${JSON.stringify(snapshot.session)})) sessionStorage.setItem(key, value);
    return true;
  })()`);
  await reload();
  await evaluate(`scrollTo(${Number(snapshot.scrollX || 0)}, ${Number(snapshot.scrollY || 0)})`);
}

export async function deleteActiveTemporaryConversation({ evaluate, sessionId, waitFor }) {
  if (!sessionId) return;
  const active = await evaluate(`(() => {
    let stored = {};
    let restore = {};
    try { stored = JSON.parse(localStorage.getItem('nextmux.desktop.codingSessions.v1') || '{}'); } catch {}
    try { restore = JSON.parse(localStorage.getItem('nextmux.desktop.restoreState.v1') || '{}'); } catch {}
    return restore.activeCodingSessionId || stored.activeCodingSessionId || '';
  })()`);
  if (active !== sessionId) throw new Error(`Refusing to delete non-active temporary conversation ${sessionId}; active is ${active || '<none>'}.`);
  const opened = await evaluate(`(() => {
    const button = document.querySelector('.nmx-session-row.is-current .nmx-session-more');
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`);
  if (!opened) throw new Error(`Temporary conversation ${sessionId} has no current-session menu.`);
  await waitFor(`Boolean(document.querySelector('.nmx-session-row.is-current .nmx-session-menu button.is-danger'))`, 'temporary conversation delete action');
  await evaluate(`document.querySelector('.nmx-session-row.is-current .nmx-session-menu button.is-danger')?.click()`);
  await waitFor(`Boolean(document.querySelector('.nmx-thread-dialog button.is-danger'))`, 'temporary conversation delete confirmation');
  await evaluate(`document.querySelector('.nmx-thread-dialog button.is-danger')?.click()`);
  await waitFor(`(() => {
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem('nextmux.desktop.codingSessions.v1') || '{}'); } catch {}
    const sessions = Array.isArray(stored) ? stored : Array.isArray(stored.sessions) ? stored.sessions : [];
    return !sessions.some(session => session?.id === ${JSON.stringify(sessionId)});
  })()`, 'temporary conversation removal');
}
