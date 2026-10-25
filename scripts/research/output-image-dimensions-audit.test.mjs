// Deliberately outside every product test/*.test.* glob. The original failing
// assertions remain as an audit and are now also covered by formal product tests.
// Decoder integrity and animation resource limits remain separate boundaries.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { animatedImages, smallImages, bytesFor, imageMime, withDimensions } from '../../packages/model-runtime/test/fixtures/output-images.mts';

const require = createRequire(import.meta.url);
const sourceUrl = new URL('../../packages/model-runtime/src/output-parts.ts', import.meta.url);
const source = readFileSync(sourceUrl, 'utf8');
const module = { exports: {} };
const http = require('../../packages/model-runtime/lib/http.js');
const dimensionsModule = { exports: {} };
new Function('exports', 'module', ts.transpileModule(readFileSync(new URL('../../packages/model-runtime/src/image-dimensions.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText)(dimensionsModule.exports, dimensionsModule);
new Function('exports', 'module', 'require', ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText)(module.exports, module, name => {
  if (name === './image-dimensions.js') return dimensionsModule.exports;
  assert.equal(name, './http.js'); return http;
});
const { OrderedModelOutput } = module.exports;
const usage = { inputTokens: 3, outputTokens: 5 };
function collect(mime, bytes) {
  const output = new OrderedModelOutput(true);
  output.media(mime, () => bytes.toString('base64'));
  return output.finish(usage, true);
}
function rejected(mime, bytes) {
  assert.throws(() => collect(mime, bytes), error => {
    assert.equal(error.code, 'INVALID_OUTPUT');
    assert.equal(error.usageKnown, true); assert.deepEqual(error.usage, usage);
    assert.equal(error.retrySafe, false); return true;
  });
}

for (const [kind, base64] of Object.entries(smallImages)) {
  test(`real 2x3 ${kind} fixture is accepted byte-for-byte`, () => {
    const parts = collect(imageMime(kind), Buffer.from(base64, 'base64'));
    assert.equal(parts.length, 1); assert.equal(parts[0].dataBase64, base64);
  });
}

// No huge fixture is decoded: only the small constants above are used by this
// optional audit oracle, which is already installed for Miniflare, not production.
test('installed decoder confirms six actual small images and two real 2-frame images', async () => {
  const sharp = require('../../node_modules/.pnpm/sharp@0.35.2/node_modules/sharp');
  for (const base64 of Object.values(smallImages)) {
    const { info } = await sharp(Buffer.from(base64, 'base64'), { limitInputPixels: 64 }).raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 2); assert.equal(info.height, 3);
  }
  for (const base64 of Object.values(animatedImages)) {
    const input = Buffer.from(base64, 'base64');
    const metadata = await sharp(input, { animated: true, limitInputPixels: 64 }).metadata();
    const { info } = await sharp(input, { animated: true, limitInputPixels: 64 }).raw().toBuffer({ resolveWithObject: true });
    assert.equal(metadata.pages, 2); assert.equal(metadata.pageHeight, 3);
    assert.equal(info.width, 2); assert.equal(info.height, 6);
  }
});

for (const [kind, width, height] of [['png', 16_385, 1], ['png', 8_000, 8_000], ['gif', 8_000, 8_000]]) {
  test(`existing size protection rejects ${kind} ${width}x${height}`, () => rejected(imageMime(kind), withDimensions(kind, width, height)));
}

for (const [kind, width, height] of [
  ['jpeg', 16_385, 1], ['jpeg', 8_000, 8_000], ['jpeg', 0, 3],
  ['webp', 8_000, 8_000], ['webp', 0, 3], ['webpLossless', 8_000, 8_000],
  ['webpExtended', 16_385, 1], ['webpExtended', 8_000, 8_000], ['gif', 16_385, 1],
]) {
  test(`size guard now rejects ${kind} ${width}x${height}`, () => rejected(imageMime(kind), withDimensions(kind, width, height)));
}

for (const [kind, length] of [['png', 24], ['jpeg', 4], ['webp', 16], ['gif', 10]]) {
  test(`necessary dimension header now rejects truncated ${kind} at ${length} bytes`,
    () => rejected(imageMime(kind), bytesFor(kind).subarray(0, length)));
}

test('old indirect image-size is not a strict safety validator', () => {
  const dimensions = require('../../node_modules/.pnpm/image-size@0.5.5/node_modules/image-size');
  for (const kind of ['png', 'gif']) assert.deepEqual(
    dimensions(bytesFor(kind).subarray(0, kind === 'png' ? 24 : 10)),
    { width: 2, height: 3, type: kind },
  );
  const incomplete = Buffer.alloc(21);
  incomplete.write('RIFF'); incomplete.writeUInt32LE(13, 4);
  incomplete.write('WEBPVP8L', 8); incomplete[20] = 0x2f;
  assert.deepEqual(dimensions(incomplete), { width: 1, height: 1, type: 'webp' },
    'missing VP8L size bytes are silently coerced into a fake 1x1 size');
});

test('diagnostic only: current canvas validation does not bound animation frame count', () => {
  for (const [kind, base64] of Object.entries(animatedImages)) {
    assert.equal(collect(imageMime(kind), Buffer.from(base64, 'base64')).length, 1);
  }
  // Two valid small frames are not themselves dangerous. This records that no
  // frame-count or cumulative decoded-pixel claim can be made for this code.
  assert.doesNotMatch(source, /MAX_(?:ANIMATION_)?FRAMES|MAX_DECODED_PIXELS/);
});
