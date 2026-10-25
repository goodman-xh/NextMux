// Isolated E2E only. Decode the existing Theia multiplexer with its maintained
// MsgPack decoder; never invent a request, response or permission grant.
export function attachmentCacheRequest(data, unpack) {
  try {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data)
      : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : undefined;
    if (!bytes || bytes.length > 256 * 1024 || bytes.length < 8 || bytes[0] !== 4) return;
    const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(1);
    let offset = 5 + length;
    if (offset >= bytes.length || new TextDecoder().decode(bytes.subarray(5, offset)) !== '/services/nextmux-platform') return;
    let payloadLength = 0, shift = 0;
    for (;;) {
      if (offset >= bytes.length || shift > 28) return;
      const byte = bytes[offset++]; payloadLength += (byte & 127) * 2 ** shift;
      if (byte <= 127) break;
      shift += 7;
    }
    if (offset + payloadLength !== bytes.length) return;
    const message = unpack(bytes.subarray(offset));
    if (message?.type !== 1 || message.method !== 'cacheDesktopAttachment' || !Array.isArray(message.args)) return;
    return message.args[0];
  } catch { /* Unrelated frames continue unchanged. */ }
}

export function installAttachmentCacheGate({ socketClass, unpack, expected, setTimer = setTimeout, clearTimer = clearTimeout }) {
  if (!expected || !/^[0-9a-f-]{36}$/.test(expected.conversationId || '')
    || typeof expected.dataBase64 !== 'string' || expected.dataBase64.length < 24 || expected.dataBase64.length > 128 * 1024) {
    throw new Error('ATTACHMENT_GATE_REQUIRES_EXACT_SYNTHETIC_FIXTURE');
  }
  const original = socketClass.prototype.send;
  let held, timer, disposed = false;
  const status = { held: 0, released: 0, extraMatches: 0, expired: false, sendFailed: false };
  const release = () => {
    const frame = held; held = undefined;
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
    if (frame) {
      status.released++;
      try { original.call(frame.socket, frame.data); }
      catch { status.sendFailed = true; }
    }
  };
  const wrapper = function (data) {
    const request = attachmentCacheRequest(data, unpack);
    const matches = request?.conversationId === expected.conversationId && request?.dataBase64 === expected.dataBase64
      && (!expected.name || request.name === expected.name);
    if (!disposed && matches && status.held === 0) {
      held = { socket: this, data }; status.held++;
      timer = setTimer(() => { status.expired = true; release(); }, 20_000);
      return;
    }
    if (matches) status.extraMatches++;
    return original.call(this, data);
  };
  socketClass.prototype.send = wrapper;
  return {
    status: () => ({ ...status }),
    release,
    dispose() {
      disposed = true;
      if (socketClass.prototype.send === wrapper) socketClass.prototype.send = original;
      release();
    },
  };
}
