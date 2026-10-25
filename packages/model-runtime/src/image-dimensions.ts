// Header/size admission only, not image decoding or an animation resource limit.
// Written from format specifications; no third-party parser implementation copied.
type Dimensions = readonly [width: number, height: number];
const MAX_METADATA_BLOCKS = 4096;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function safeSize(width: number, height: number): boolean {
  return width > 0 && height > 0 && width <= 16_384 && height <= 16_384 && width * height <= 40_000_000;
}

function jpegDimensions(bytes: Buffer): Dimensions | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return;
  let offset = 2;
  for (let blocks = 0; blocks < MAX_METADATA_BLOCKS && offset < bytes.length; blocks++) {
    if (bytes[offset++] !== 0xff) return;
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) return;
    const marker = bytes[offset++];
    if (marker === 0x01) continue; // Standalone TEM; no length field.
    if (marker === 0 || (marker >= 0xd0 && marker <= 0xda)) return; // No SOF before scan/end, or invalid restart/SOI.
    if (offset + 2 > bytes.length) return;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || length > bytes.length - offset) return;
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (length < 11) return;
      const precision = bytes[offset + 2], components = bytes[offset + 7];
      if ((precision !== 8 && precision !== 12) || !components || components > 4 || length !== 8 + 3 * components) return;
      return [bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)];
    }
    // Other SOF modes are not proved by this small parser; do not skip to a later fake SOF.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return;
    offset += length;
  }
}

function webpBitstreamSize(bytes: Buffer, tag: string, start: number, length: number): Dimensions | undefined {
  if (tag === 'VP8 ') {
    if (length < 10 || (bytes[start] & 1) || ((bytes[start] >> 1) & 7) > 3
      || bytes[start + 3] !== 0x9d || bytes[start + 4] !== 1 || bytes[start + 5] !== 0x2a) return;
    return [bytes.readUInt16LE(start + 6) & 0x3fff, bytes.readUInt16LE(start + 8) & 0x3fff];
  }
  if (length < 5 || bytes[start] !== 0x2f || (bytes[start + 4] >> 5) !== 0) return;
  const bits = bytes.readUInt32LE(start + 1);
  return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
}

function webpDimensions(bytes: Buffer): Dimensions | undefined {
  if (bytes.length < 20 || bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WEBP'
    || bytes.readUInt32LE(4) !== bytes.length - 8 || bytes.length % 2) return;
  if (!['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('latin1', 12, 16))) return;
  let offset = 12, canvas: Dimensions | undefined, image: Dimensions | undefined;
  let animated = false, animationHeader = false, frame = false;
  for (let blocks = 0; offset < bytes.length; blocks++) {
    if (blocks >= MAX_METADATA_BLOCKS || offset + 8 > bytes.length) return;
    const tag = bytes.toString('latin1', offset, offset + 4), length = bytes.readUInt32LE(offset + 4);
    const start = offset + 8, end = start + length, next = end + (length % 2);
    if (next > bytes.length || (length % 2 && bytes[end] !== 0)) return;
    if (tag === 'VP8X') {
      if (offset !== 12 || length !== 10 || (bytes[start] & 0xc1) || bytes[start + 1] || bytes[start + 2] || bytes[start + 3]) return;
      canvas = [bytes.readUIntLE(start + 4, 3) + 1, bytes.readUIntLE(start + 7, 3) + 1];
      if (!safeSize(...canvas)) return;
      animated = Boolean(bytes[start] & 2);
    } else if (tag === 'VP8 ' || tag === 'VP8L') {
      if (image || animated) return;
      image = webpBitstreamSize(bytes, tag, start, length);
      if (!image || !safeSize(...image)) return;
    } else if (tag === 'ANIM') {
      if (!animated || animationHeader || frame || length !== 6) return;
      animationHeader = true;
    } else if (tag === 'ANMF') {
      if (!animated || !animationHeader || length < 16) return;
      frame = true; // Nested frame codecs/count/decoded-pixel totals are deliberately not certified here.
    }
    offset = next;
  }
  if (animated) return animationHeader && frame ? canvas : undefined;
  if (canvas && (!image || image[0] !== canvas[0] || image[1] !== canvas[1])) return;
  return image;
}

/** Reject missing/oversized dimensions before rendering; does not certify full compressed data. */
export function hasSafeImageDimensions(bytes: Buffer, mimeType: string): boolean {
  let size: Dimensions | undefined;
  if (mimeType === 'image/png') {
    if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.readUInt32BE(8) !== 13
      || bytes.toString('latin1', 12, 16) !== 'IHDR') return false;
    size = [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  } else if (mimeType === 'image/gif') {
    if (bytes.length < 13 || !/^GIF8[79]a$/.test(bytes.toString('latin1', 0, 6))) return false;
    size = [bytes.readUInt16LE(6), bytes.readUInt16LE(8)];
  } else if (mimeType === 'image/jpeg') size = jpegDimensions(bytes);
  else if (mimeType === 'image/webp') size = webpDimensions(bytes);
  return Boolean(size && safeSize(...size));
}
