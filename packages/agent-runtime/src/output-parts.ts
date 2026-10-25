import type { AgentOutputPart } from './types.js';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const AUDIO_TYPES = ['audio/wav', 'audio/mpeg', 'audio/ogg', 'audio/flac'];
const MiB = 1024 * 1024;
const encoder = new TextEncoder();

/** Fixed public error; input values, local paths and provider bytes never enter it. */
export class AgentOutputPartsError extends Error {
  readonly retrySafe = false;
  readonly retryable = false;
  constructor(readonly code: 'INVALID_OUTPUT_PARTS' | 'OUTPUT_PARTS_UNSUPPORTED' = 'INVALID_OUTPUT_PARTS') {
    super(code === 'OUTPUT_PARTS_UNSUPPORTED' ? 'The host does not accept ordered output references' : 'Ordered output references are invalid or exceed the safe limits');
    this.name = 'AgentOutputPartsError';
  }
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![null, Object.prototype].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !keys.includes(key))) throw new AgentOutputPartsError();
  const result: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!('value' in descriptor) || !descriptor.enumerable) throw new AgentOutputPartsError();
    result[key] = descriptor.value;
  }
  return result;
}

/** Strict all-or-nothing canonical projection. Shape validation is never asset authorization. */
export function normalizeAgentOutputParts(value: unknown): readonly AgentOutputPart[] | undefined {
  try { return normalize(value); }
  catch { throw new AgentOutputPartsError(); }
}

function normalize(value: unknown): readonly AgentOutputPart[] | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > 64) throw new AgentOutputPartsError();
  // Reject holes, custom properties and accessors instead of invoking host
  // objects or preserving sparse slots that are not valid output parts.
  if (Reflect.ownKeys(value).length !== value.length + 1) throw new AgentOutputPartsError();
  let textBytes = 0, mediaBytes = 0, mediaCount = 0;
  const parts = Array.from({ length: value.length }, (_, index): AgentOutputPart => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new AgentOutputPartsError();
    const part = record(descriptor.value, ['type', 'text', 'asset']);
    if (part.type === 'text') {
      if (part.asset !== undefined || typeof part.text !== 'string' || part.text.includes('\0') || part.text.length > 2 * MiB) throw new AgentOutputPartsError();
      textBytes += encoder.encode(part.text).byteLength;
      if (textBytes > 2 * MiB) throw new AgentOutputPartsError();
      return Object.freeze({ type: 'text', text: part.text });
    }
    if ((part.type !== 'image' && part.type !== 'audio') || part.text !== undefined || ++mediaCount > 16) throw new AgentOutputPartsError();
    const asset = record(part.asset, ['sha256', 'mimeType', 'sizeBytes']);
    const maximum = (part.type === 'image' ? 10 : 24) * MiB;
    if (typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256)
      || typeof asset.mimeType !== 'string' || !(part.type === 'image' ? IMAGE_TYPES : AUDIO_TYPES).includes(asset.mimeType)
      || !Number.isSafeInteger(asset.sizeBytes) || Number(asset.sizeBytes) <= 0 || Number(asset.sizeBytes) > maximum) throw new AgentOutputPartsError();
    mediaBytes += Number(asset.sizeBytes);
    if (mediaBytes > 32 * MiB) throw new AgentOutputPartsError();
    return Object.freeze({ type: part.type, asset: Object.freeze({ sha256: asset.sha256, mimeType: asset.mimeType, sizeBytes: Number(asset.sizeBytes) }) });
  });
  return Object.freeze(parts);
}
