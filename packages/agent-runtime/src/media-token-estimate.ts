import type { AgentMediaMetadata } from './types.js';

export interface AgentTokenEstimateProfile {
  readonly providerId?: string;
  readonly protocol?: string;
  /** Provider/model declaration overrides the conservative fallback allowance. */
  readonly imageTokens?: number;
  readonly audioTokensPerSecond?: number;
  readonly videoTokensPerSecond?: number;
  readonly pdfTokensPerPage?: number;
}

export function normalizeAgentMediaMetadata(value: unknown): AgentMediaMetadata | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>, output: Record<string, number> = {};
  for (const [key, maximum] of Object.entries({ width: 100_000, height: 100_000, durationSeconds: 86_400, pageCount: 100_000 })) {
    const number = input[key];
    if (typeof number === 'number' && Number.isFinite(number) && number > 0 && number <= maximum) output[key] = Math.ceil(number);
  }
  return Object.keys(output).length ? output : undefined;
}

/** Browser-safe base64 decoding: token-budget is also used by renderer history. */
function cleanBase64(value: string): string {
  return value.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
}

function decodedBytes(value: string): Uint8Array {
  const clean = cleanBase64(value);
  const aligned = clean.length % 4 === 1 ? clean.slice(0, -1) : clean.padEnd(Math.ceil(clean.length / 4) * 4, '=');
  try { return Uint8Array.from(atob(aligned), character => character.charCodeAt(0)); }
  catch { return new Uint8Array(); }
}

/** Header-only inspection; compressed pixel bytes do not affect token estimates. */
function imageSize(rawData: string | undefined): { width: number; height: number } | undefined {
  if (!rawData) return undefined;
  const data = cleanBase64(rawData);
  if (!data) return undefined;
  const bytes = decodedBytes(data.slice(0, 131_072));
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  const be = (offset: number, size: number) => { let value = 0; for (let i = 0; i < size; i++) value = value * 256 + (bytes[offset + i] ?? 0); return value; };
  const le = (offset: number, size: number) => { let value = 0; for (let i = size - 1; i >= 0; i--) value = value * 256 + (bytes[offset + i] ?? 0); return value; };
  let width = 0, height = 0;
  if (bytes.length >= 24 && bytes[0] === 137 && ascii(1, 8) === 'PNG\r\n\x1a\n') {
    width = be(16, 4); height = be(20, 4);
  } else if (bytes.length >= 10 && /^GIF8[79]a$/.test(ascii(0, 6))) {
    width = le(6, 2); height = le(8, 2);
  } else if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    const kind = ascii(12, 16);
    if (kind === 'VP8X') { width = 1 + le(24, 3); height = 1 + le(27, 3); }
    else if (kind === 'VP8 ' && be(23, 3) === 0x9d012a) { width = le(26, 2) & 0x3fff; height = le(28, 2) & 0x3fff; }
    else if (kind === 'VP8L' && bytes[20] === 0x2f) { const bits = le(21, 4); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1; }
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    // APP/COM segments can legally put SOF past the prefix. Decode only the few
    // header bytes at each segment boundary, never pixels or a metadata payload.
    const totalBytes = Math.floor(data.length * 3 / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
    const read = (offset: number, count = 1): number => {
      if (offset + count <= bytes.length) return be(offset, count);
      const start = Math.floor(offset / 3) * 4;
      const segment = decodedBytes(data.slice(start, Math.ceil((offset + count) / 3) * 4));
      let value = 0;
      for (let i = 0; i < count; i++) value = value * 256 + (segment[offset % 3 + i] ?? 0);
      return value;
    };
    for (let offset = 2; offset + 8 < totalBytes;) {
      if (read(offset++) !== 0xff) break;
      while (offset < totalBytes && read(offset) === 0xff) offset++;
      const marker = read(offset++);
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > totalBytes) break;
      const length = read(offset, 2);
      if (length < 2 || offset + length > totalBytes) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 8) break;
        height = read(offset + 3, 2); width = read(offset + 5, 2); break;
      }
      offset += length;
    }
  }
  return width > 0 && height > 0 && width <= 100_000 && height <= 100_000 ? { width, height } : undefined;
}

/**
 * Admission estimates, never billing. Images use dimensions/tiles; opaque images
 * use fixed allowances (8192 Ollama, 16384 Anthropic/Gemini, 65536 compatible).
 * The compatible allowance covers the 48,169-token high tile-rate image case;
 * declarations can override it for encoders with a different upper bound.
 * Gemini audio/video: 32/263 tokens/sec (ai.google.dev/gemini-api/docs/tokens).
 * Images reserve at least 2240 for Gemini 3 ultra-high resolution, or the older
 * 768px tiled count when greater (ai.google.dev/gemini-api/docs/media-resolution).
 * Claude images: conservatively take max(area/750, 28px patches), without resize
 * discounts (platform.claude.com/docs/en/build-with-claude/vision).
 * Unknown duration/page count reserves 10 min audio, 5 min video or 100 PDF pages;
 * these are documented admission allowances, not claims about provider limits.
 * Hosts should supply observed media properties or provider-specific counts.
 */
export function estimateAgentMediaTokens(
  mimeType: string,
  dataBase64: string | undefined,
  metadata: AgentMediaMetadata | undefined,
  profile: AgentTokenEstimateProfile = {},
): number {
  const media = normalizeAgentMediaMetadata(metadata);
  const provider = profile.providerId ?? '', protocol = profile.protocol ?? '';
  const gemini = provider === 'gemini' || provider === 'vertex' || protocol === 'gemini_generate_content';
  const anthropic = provider === 'anthropic' || protocol === 'anthropic_messages';
  const ollama = provider === 'ollama' || protocol === 'ollama';
  if (mimeType.startsWith('image/')) {
    if (profile.imageTokens !== undefined && profile.imageTokens > 0) return Math.ceil(profile.imageTokens);
    if (ollama) return 8_192; // Local encoders vary; use the same bounded allowance in runner and num_ctx.
    const size = imageSize(dataBase64) ?? (media?.width && media.height ? { width: media.width, height: media.height } : undefined);
    if (!size) return anthropic || gemini ? 16_384 : 65_536;
    if (anthropic) return Math.max(Math.ceil(size.width * size.height / 750), Math.ceil(size.width / 28) * Math.ceil(size.height / 28));
    if (gemini) return Math.max(2_240, 258 * Math.ceil(size.width / 768) * Math.ceil(size.height / 768));
    // Conservative compatible-route envelope, including OpenAI's higher tile-rate
    // models; dimensions, not model-name regexes or compressed length, drive it.
    return 2_833 + 5_667 * Math.ceil(size.width / 512) * Math.ceil(size.height / 512);
  }
  if (mimeType.startsWith('audio/')) return Math.ceil((media?.durationSeconds ?? 600) * (profile.audioTokensPerSecond ?? (gemini ? 32 : 50)));
  if (mimeType.startsWith('video/')) return Math.ceil((media?.durationSeconds ?? 300) * (profile.videoTokensPerSecond ?? (gemini ? 263 : 1_000)));
  if (mimeType === 'application/pdf') return Math.ceil((media?.pageCount ?? 100) * (profile.pdfTokensPerPage ?? (anthropic ? 6_000 : 8_000)));
  if (/^(?:text\/|application\/(?:json|xml|javascript|x-yaml))/.test(mimeType) && dataBase64) {
    // Text files really are text input: decode before counting rather than count base64.
    return Math.ceil(new TextDecoder().decode(decodedBytes(dataBase64)).length / 2);
  }
  return 16_384; // Unknown binary modality remains an explicit conservative allowance.
}
