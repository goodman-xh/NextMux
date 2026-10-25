import assert from "node:assert/strict";
import test from "node:test";
import { hasSafeImageDimensions } from "../lib/image-dimensions.js";
import { OfficialModelError, OrderedModelOutput } from "../lib/index.js";
import { bytesFor, imageMime, smallImages, withDimensions } from "./fixtures/output-images.mts";

// Independent container/segment tests. These never invoke a codec, external
// service or a full decoder for the deliberately huge dimension declarations.
const usage = { inputTokens: 3, outputTokens: 5 };

function rejected(bytes: Buffer, mime: string): void {
  assert.equal(hasSafeImageDimensions(bytes, mime), false);
  const output = new OrderedModelOutput(true);
  output.media(mime, () => bytes.toString("base64"));
  assert.throws(() => output.finish(usage, true), (error: unknown) => {
    assert.ok(error instanceof OfficialModelError);
    assert.equal(error.code, "INVALID_OUTPUT");
    assert.equal(error.retrySafe, false);
    assert.equal(error.usageKnown, true);
    assert.deepEqual(error.usage, usage);
    return true;
  });
}

function jpegSegment(marker: number, payload: Buffer): Buffer {
  const header = Buffer.from([0xff, marker, 0, 0]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

function genuineSof(bytes = bytesFor("jpeg")): Buffer {
  const offset = bytes.indexOf(Buffer.from([0xff, 0xc0]));
  assert.ok(offset > 1, "the independently decoded fixture has a baseline SOF");
  return bytes.subarray(offset, offset + 2 + bytes.readUInt16BE(offset + 2));
}

function riff(...chunks: Buffer[]): Buffer {
  const payload = Buffer.concat([Buffer.from("WEBP"), ...chunks]);
  const header = Buffer.from("RIFF\0\0\0\0", "ascii");
  header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

function chunk(name: string, payload: Buffer, padding = true): Buffer {
  const header = Buffer.alloc(8);
  header.write(name, 0, "ascii");
  header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, payload, ...(padding && (payload.length & 1) ? [Buffer.alloc(1)] : [])]);
}

test("APP contents cannot supply or override a JPEG SOF dimension declaration", () => {
  const safe = genuineSof();
  const huge = genuineSof(withDimensions("jpeg", 8_000, 8_000));
  const start = Buffer.from([0xff, 0xd8]);
  const end = Buffer.from([0xff, 0xd9]);
  rejected(Buffer.concat([start, jpegSegment(0xe1, safe), end]), "image/jpeg");
  rejected(Buffer.concat([start, jpegSegment(0xe1, safe), huge, end]), "image/jpeg");
  // A false huge declaration inside APP must not reject a genuine safe image.
  const valid = bytesFor("jpeg");
  assert.equal(hasSafeImageDimensions(Buffer.concat([start, jpegSegment(0xe1, huge), valid.subarray(2)]), "image/jpeg"), true);
});

test("JPEG marker lengths cannot skip beyond the input or fail to advance", { timeout: 5_000 }, () => {
  for (const size of [0, 1, 65_535]) {
    const bad = Buffer.from([0xff, 0xd8, 0xff, 0xe1, size >>> 8, size & 255, 0xff, 0xd9]);
    rejected(bad, "image/jpeg");
  }
  const fill = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(200_000, 0xff)]);
  rejected(fill, "image/jpeg");
  // A long but bounded sequence of minimum-sized APP segments, no SOF.
  const many = Buffer.alloc(4 * 20_000);
  for (let offset = 0; offset < many.length; offset += 4) many.set([0xff, 0xe1, 0, 2], offset);
  rejected(Buffer.concat([Buffer.from([0xff, 0xd8]), many, Buffer.from([0xff, 0xd9])]), "image/jpeg");
});

test("WebP RIFF length must cover exactly the available chunks, not a prefix or trailing image", () => {
  const valid = bytesFor("webp");
  for (const length of [0, 4, valid.length - 9, valid.length - 7, 0xffffffff]) {
    const malformed = Buffer.from(valid); malformed.writeUInt32LE(length, 4);
    rejected(malformed, "image/webp");
  }
  rejected(Buffer.concat([valid, Buffer.from([0])]), "image/webp");
  rejected(Buffer.concat([valid, valid]), "image/webp");
  const invalidChunk = Buffer.from(valid); invalidChunk.writeUInt32LE(0xffffffff, 16);
  rejected(invalidChunk, "image/webp");
});

test("odd WebP chunk lengths require an actual zero padding byte", () => {
  const imageChunk = bytesFor("webp").subarray(12);
  const oddChunk = chunk("JUNK", Buffer.from([0x42]));
  assert.equal(hasSafeImageDimensions(riff(imageChunk, oddChunk), "image/webp"), true);
  rejected(riff(imageChunk, chunk("JUNK", Buffer.from([0x42]), false)), "image/webp");
  const nonzeroPadding = Buffer.from(oddChunk); nonzeroPadding[nonzeroPadding.length - 1] = 1;
  rejected(riff(imageChunk, nonzeroPadding), "image/webp");
});

test("WebP cannot offer multiple alternative bitstreams or duplicate extended canvases", () => {
  const lossy = bytesFor("webp").subarray(12);
  const lossless = bytesFor("webpLossless").subarray(12);
  rejected(riff(lossy, lossy), "image/webp");
  rejected(riff(lossy, lossless), "image/webp");
  rejected(riff(lossless, lossless), "image/webp");
  const extended = bytesFor("webpExtended");
  const canvas = extended.subarray(12, 30);
  rejected(riff(canvas, canvas, extended.subarray(30)), "image/webp");
});

test("WebP extended canvas cannot disagree with its embedded static bitstream", () => {
  for (const [width, height] of [[1, 3], [2, 4], [8_000, 8_000]]) {
    rejected(withDimensions("webpExtended", width!, height!), "image/webp");
  }
});

test("magic and chunk tags compare exact bytes, not ASCII with the high bit masked", () => {
  for (const [kind, offsets] of [["png", [1, 12, 13, 14, 15]], ["gif", [0, 1, 2, 3, 4, 5]],
    ["webp", [0, 1, 2, 3, 8, 9, 10, 11, 12, 13, 14, 15]],
    ["webpLossless", [12, 13, 14, 15]], ["webpExtended", [12, 13, 14, 15]]] as const) {
    for (const offset of offsets) {
      const bytes = bytesFor(kind);
      bytes[offset] |= 0x80;
      rejected(bytes, imageMime(kind));
    }
  }
});

test("JPEG, WebP and GIF reject huge declarations without attempting to decode pixels", () => {
  for (const kind of ["jpeg", "webp", "webpLossless", "webpExtended", "gif"] as const) {
    rejected(withDimensions(kind, 8_000, 8_000), imageMime(kind));
  }
  for (const kind of ["jpeg", "webpExtended", "gif"] as const) {
    rejected(withDimensions(kind, 16_385, 1), imageMime(kind));
  }
});

test("truncated necessary headers reject without Buffer range errors", () => {
  for (const [kind, minimum] of [["png", 33], ["gif", 13], ["webp", bytesFor("webp").length],
    ["webpLossless", bytesFor("webpLossless").length], ["webpExtended", bytesFor("webpExtended").length]] as const) {
    const valid = bytesFor(kind);
    for (let length = 0; length < minimum; length++) assert.equal(hasSafeImageDimensions(valid.subarray(0, length), imageMime(kind)), false);
  }
  const jpeg = bytesFor("jpeg");
  const sof = jpeg.indexOf(Buffer.from([0xff, 0xc0]));
  const end = sof + 2 + jpeg.readUInt16BE(sof + 2);
  for (let length = 0; length < end; length++) assert.equal(hasSafeImageDimensions(jpeg.subarray(0, length), "image/jpeg"), false);
});

test("controlled small random prefixes and mutations always return a boolean, never RangeError", { timeout: 5_000 }, () => {
  let state = 0x17c0de;
  const next = () => { state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0; return state; };
  for (let index = 0; index < 1_024; index++) {
    const bytes = Buffer.alloc(next() % 129);
    for (let offset = 0; offset < bytes.length; offset++) bytes[offset] = next() & 255;
    for (const mime of ["image/png", "image/jpeg", "image/webp", "image/gif"]) {
      assert.equal(typeof hasSafeImageDimensions(bytes, mime), "boolean");
    }
  }
  for (const kind of Object.keys(smallImages) as (keyof typeof smallImages)[]) {
    for (let iteration = 0; iteration < 128; iteration++) {
      const bytes = bytesFor(kind);
      for (let count = 0; count < 3; count++) bytes[next() % bytes.length] = next() & 255;
      assert.equal(typeof hasSafeImageDimensions(bytes.subarray(0, next() % (bytes.length + 1)), imageMime(kind)), "boolean");
    }
  }
});
