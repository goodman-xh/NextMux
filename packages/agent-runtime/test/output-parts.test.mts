import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentOutputPartsError, normalizeAgentOutputParts } from '../lib/output-parts.js';

const asset = { sha256: 'a'.repeat(64), mimeType: 'image/png', sizeBytes: 100 };
const image = { type: 'image', asset };
const invalid = (value: unknown) => assert.throws(() => normalizeAgentOutputParts(value), error =>
  error instanceof AgentOutputPartsError && error.code === 'INVALID_OUTPUT_PARTS'
    && error.retrySafe === false && error.retryable === false && !error.message.includes('sentinel'));

test('ordered reference normalizer clones, freezes, and preserves repeated positions and whitespace', () => {
  const input = [{ type: 'text', text: ' before\n' }, image, image, { type: 'text', text: '' }];
  const result = normalizeAgentOutputParts(input)!;
  assert.deepEqual(result, input); assert.notEqual(result, input); assert.notEqual(result[1], image);
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result[1]));
  assert.ok(result[1].type === 'image' && Object.isFrozen(result[1].asset));
  assert.equal(normalizeAgentOutputParts(undefined), undefined); assert.deepEqual(normalizeAgentOutputParts([]), []);
});

test('sparse arrays, accessors, inherited fields and proxy failures have one fixed error', () => {
  invalid(Array(1)); const removed = [image, image]; delete removed[0]; invalid(removed);
  invalid(Object.assign([image], { hidden: 'sentinel' }));
  invalid([Object.create(image)]);
  invalid([{ type: 'text', get text() { throw new Error('sentinel'); } }]);
  invalid(new Proxy([], { ownKeys() { throw new Error('sentinel'); } }));
  invalid([new Proxy(image, { getPrototypeOf() { throw new Error('sentinel'); } })]);
  const accessed = [image]; Object.defineProperty(accessed, '0', { get() { throw new Error('sentinel'); } }); invalid(accessed);
});

test('references reject raw bytes, owner claims, URLs, unknown keys and incorrect MIME/type pairs', () => {
  for (const value of [null, {}, 'sentinel', [{ ...image, data: 'sentinel' }], [{ ...image, owner: 'sentinel' }],
    [{ ...image, asset: { ...asset, path: '/sentinel' } }], [{ ...image, asset: { ...asset, url: 'https://sentinel.invalid' } }],
    [{ ...image, asset: { ...asset, sha256: 'A'.repeat(64) } }], [{ ...image, asset: { ...asset, mimeType: 'audio/wav' } }],
    [{ ...image, asset: { ...asset, sizeBytes: 0 } }], [{ type: 'text', text: 'a\0sentinel' }]]) invalid(value);
});

test('per-part and aggregate byte/position limits include repeated assets', () => {
  const sized = (sizeBytes: number) => ({ ...image, asset: { ...asset, sizeBytes } });
  normalizeAgentOutputParts([sized(10 * 1024 * 1024)]); invalid([sized(10 * 1024 * 1024 + 1)]);
  invalid(Array(17).fill(image)); invalid(Array(65).fill({ type: 'text', text: '' }));
  invalid(Array(4).fill(sized(10 * 1024 * 1024)));
  invalid([{ type: 'text', text: '你'.repeat(700_000) }]);
  normalizeAgentOutputParts([{ type: 'audio', asset: { ...asset, mimeType: 'audio/wav', sizeBytes: 24 * 1024 * 1024 } }]);
});
