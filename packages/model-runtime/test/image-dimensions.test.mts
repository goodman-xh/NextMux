import assert from 'node:assert/strict';
import test from 'node:test';
import { hasSafeImageDimensions } from '../lib/image-dimensions.js';
import { OrderedModelOutput, OfficialModelError, createOfficialModelClient, createPreferredOfficialModelClient } from '../lib/index.js';
import { smallImages, animatedImages, bytesFor, imageMime, withDimensions } from './fixtures/output-images.mts';

const usage = { inputTokens: 3, outputTokens: 5 };
function rejected(mime: string, bytes: Buffer): void {
  assert.equal(hasSafeImageDimensions(bytes, mime), false);
  const output = new OrderedModelOutput(true);
  output.media(mime, () => bytes.toString('base64'));
  assert.throws(() => output.finish(usage, true), (error: unknown) => {
    assert.ok(error instanceof OfficialModelError); assert.equal(error.code, 'INVALID_OUTPUT');
    assert.equal(error.usageKnown, true); assert.deepEqual(error.usage, usage);
    assert.equal(error.retrySafe, false); assert.equal(error.retryable, false);
    assert.equal(JSON.stringify(error.toJSON()).includes(bytes.toString('base64')), false);
    return true;
  });
}

for (const [kind, base64] of Object.entries(smallImages)) {
  test(`size admission preserves real 2x3 ${kind} bytes`, () => {
    const bytes = Buffer.from(base64, 'base64'), mime = imageMime(kind);
    assert.equal(hasSafeImageDimensions(bytes, mime), true);
    const output = new OrderedModelOutput(true); output.media(mime, () => base64);
    assert.equal(output.finish(usage, true)?.[0]?.type, 'image');
    assert.equal(JSON.stringify(output.finish(usage, true)).includes(base64), true);
  });
}

for (const [kind, width, height] of [
  ['png', 16_385, 1], ['png', 8_000, 8_000], ['png', 0, 3],
  ['jpeg', 16_385, 1], ['jpeg', 8_000, 8_000], ['jpeg', 0, 3],
  ['webp', 8_000, 8_000], ['webp', 0, 3], ['webpLossless', 8_000, 8_000],
  ['webpExtended', 16_385, 1], ['webpExtended', 8_000, 8_000],
  ['gif', 16_385, 1], ['gif', 8_000, 8_000], ['gif', 0, 3],
] as const) {
  test(`uniform dimensions reject ${kind} ${width}x${height} without losing paid usage`, () => {
    rejected(imageMime(kind), withDimensions(kind, width, height));
  });
}

for (const [kind, length] of [['png', 24], ['jpeg', 4], ['webp', 16], ['gif', 10]] as const) {
  test(`necessary header rejects ${kind} truncated at ${length} bytes`, () => rejected(imageMime(kind), bytesFor(kind).subarray(0, length)));
}

test('PNG length must describe a complete IHDR and GIF must contain its logical screen descriptor', () => {
  const bad = bytesFor('png'); bad.writeUInt32BE(12, 8); rejected('image/png', bad);
  for (const [kind, length] of [['png', 32], ['gif', 12]] as const) rejected(imageMime(kind), bytesFor(kind).subarray(0, length));
});

test('JPEG dimensions support SOF1/SOF2 without reading fake SOF inside metadata', () => {
  for (const marker of [0xc1, 0xc2]) {
    const bytes = bytesFor('jpeg'); const sof = bytes.indexOf(Buffer.from([0xff, 0xc0])); bytes[sof + 1] = marker;
    assert.equal(hasSafeImageDimensions(bytes, 'image/jpeg'), true, 'dimension-header variation only, not complete codec validity');
  }
  const jpeg = bytesFor('jpeg'), sof = jpeg.indexOf(Buffer.from([0xff, 0xc0]));
  const segment = jpeg.subarray(sof, sof + 19), metadata = Buffer.alloc(segment.length + 4);
  metadata[0] = 0xff; metadata[1] = 0xe1; metadata.writeUInt16BE(segment.length + 2, 2); segment.copy(metadata, 4);
  const withoutRealSof = Buffer.concat([jpeg.subarray(0, sof), jpeg.subarray(sof + 19)]);
  rejected('image/jpeg', Buffer.concat([withoutRealSof.subarray(0, 2), metadata, withoutRealSof.subarray(2)]));
});

test('JPEG rejects partial/zero-length segments, unsupported SOF and missing dimensions', () => {
  for (const bytes of [Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff]),
    Buffer.from([0xff, 0xd8, 0xff, 0xda]), Buffer.from([0xff, 0xd8, 0xff, 0xd9])]) rejected('image/jpeg', bytes);
  const jpeg = bytesFor('jpeg'), sof = jpeg.indexOf(Buffer.from([0xff, 0xc0]));
  const unsupported = Buffer.from(jpeg); unsupported[sof + 1] = 0xc3; rejected('image/jpeg', unsupported);
  const badComponents = Buffer.from(jpeg); badComponents[sof + 9] = 4; rejected('image/jpeg', badComponents);
});

test('WebP refuses short size fields, RIFF mismatch, bad signature/version and static canvas mismatch', () => {
  for (const kind of ['webp', 'webpLossless', 'webpExtended']) {
    const bytes = bytesFor(kind); bytes.writeUInt32LE(bytes.length, 4); rejected('image/webp', bytes);
  }
  const lossy = bytesFor('webp'); lossy[23] = 0; rejected('image/webp', lossy);
  const lossless = bytesFor('webpLossless'); lossless[24] |= 0x20; rejected('image/webp', lossless);
  rejected('image/webp', withDimensions('webpExtended', 3, 3));
  const incomplete = Buffer.alloc(22); incomplete.write('RIFF'); incomplete.writeUInt32LE(14, 4);
  incomplete.write('WEBPVP8L', 8); incomplete.writeUInt32LE(1, 16); incomplete[20] = 0x2f;
  rejected('image/webp', incomplete);
});

test('dimension admission does not claim full compression integrity or total animation frames', () => {
  assert.equal(hasSafeImageDimensions(bytesFor('png').subarray(0, 33), 'image/png'), true, 'no IDAT/CRC decoder here');
  assert.equal(hasSafeImageDimensions(bytesFor('gif').subarray(0, 13), 'image/gif'), true, 'not a GIF block/LZW decoder');
  for (const [kind, base64] of Object.entries(animatedImages)) {
    assert.equal(hasSafeImageDimensions(Buffer.from(base64, 'base64'), imageMime(kind)), true,
      'real two-frame fixture is compatible, not proof of a frame-count/cumulative-pixel cap');
  }
});

for (const [name, make] of [['legacy', createOfficialModelClient], ['preferred SDK', createPreferredOfficialModelClient]] as const) {
  test(`${name} oversized image fails with final usage and one paid request, no completed event`, async () => {
    let dispatches = 0; const events: string[] = [];
    const bytes = withDimensions('webp', 8000, 8000);
    const client = make({ providerId: 'gemini', protocol: 'gemini_generate_content', baseUrl: 'https://image-dimensions.example.test/v1beta',
      apiKey: 'synthetic-not-a-real-key', model: 'synthetic-image-output', acceptOrderedOutput: true,
      fetchImpl: async input => {
        dispatches++;
        const data = { candidates: [{ index: 0, content: { role: 'model', parts: [{ inlineData: { mimeType: 'image/webp', data: bytes.toString('base64') } }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 5, totalTokenCount: 8 } };
        return String(input).includes(':streamGenerateContent')
          ? new Response(`data: ${JSON.stringify(data)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
          : new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
      },
    });
    await assert.rejects(client.complete({ messages: [{ role: 'user', content: 'synthetic fixture' }], tools: [], onModelEvent: event => { events.push(event.type); } }), (error: unknown) => {
      assert.ok(error instanceof OfficialModelError); assert.equal(error.code, 'INVALID_OUTPUT');
      assert.equal(error.usageKnown, true); assert.deepEqual(error.usage, usage); assert.equal(error.retrySafe, false); return true;
    });
    assert.equal(dispatches, 1); assert.equal(events.includes('response.completed'), false);
    assert.equal(events.at(-1), 'response.failed');
  });
}
