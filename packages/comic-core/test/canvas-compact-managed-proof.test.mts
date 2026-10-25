import assert from 'node:assert/strict';
import test from 'node:test';
import { canvasVideoOutputDimensions, decodeCanvasProvenVideoShapes, type CanvasProvenVideoShapeGroups } from '../lib/canvas-capabilities.js';

const output = (resolution = '720p', aspectRatio = '16:9') => ({ resolution, aspectRatio, ...canvasVideoOutputDimensions(resolution, aspectRatio)! });
const proof = (): CanvasProvenVideoShapeGroups => ({ version: 1,
  outputs: [output(), output('720p', '9:16')], durations: [4, 6, 8], rules: [
    { outputs: [0, 1], firstFrame: true, lastFrame: false, requestAudio: false, referenceCounts: [0, 2], minDurationSeconds: 6 },
    { outputs: [0], firstFrame: true, lastFrame: true, requestAudio: false, referenceCounts: [1], durationSeconds: [4, 8] },
  ] });

test('compact suffix rules expand only listed durations and explicit reference counts', () => {
  const result = decodeCanvasProvenVideoShapes({ provenShapeGroups: proof() });
  assert.equal(result.error, undefined);
  assert.equal(result.shapes?.length, 10);
  assert.deepEqual(result.shapes?.filter(row => !row.lastFrame).map(row => [row.aspectRatio, row.durationSeconds, row.referenceImages]), [
    ['16:9', 6, 0], ['16:9', 6, 2], ['16:9', 8, 0], ['16:9', 8, 2],
    ['9:16', 6, 0], ['9:16', 6, 2], ['9:16', 8, 0], ['9:16', 8, 2],
  ]);
  assert.deepEqual(result.shapes?.filter(row => row.lastFrame).map(row => row.durationSeconds), [4, 8]);
  assert.deepEqual(decodeCanvasProvenVideoShapes({ provenShapes: result.shapes }).shapes, result.shapes);
});

test('proof generations cannot coexist and empty or missing evidence never grants a shape', () => {
  assert.equal(decodeCanvasProvenVideoShapes(undefined).error, 'missing');
  assert.equal(decodeCanvasProvenVideoShapes({ provenShapes: [] }).error, 'empty');
  assert.equal(decodeCanvasProvenVideoShapes({ provenShapeGroups: { version: 1, outputs: [], durations: [], rules: [] } }).error, 'empty');
  assert.equal(decodeCanvasProvenVideoShapes({ provenShapes: [], provenShapeGroups: proof() }).error, 'ambiguous');
});

test('any malformed compact member rejects the complete certificate', () => {
  const changes: ((value: any) => void)[] = [
    value => { value.version = 2; }, value => { value.extra = true; },
    value => { value.outputs[0].extra = true; }, value => { value.rules[0].extra = true; },
    value => { value.outputs[0].width = 1278; }, value => { value.outputs[0].height = 718; },
    value => { value.outputs[0].resolution = 'auto'; }, value => { value.outputs[0].aspectRatio = 'auto'; },
    value => { value.outputs.push(value.outputs[0]); }, value => { value.outputs[0] = { resolution: '4k', aspectRatio: '21:9', width: 5040, height: 2160 }; },
    value => { value.durations = [6, 4]; }, value => { value.durations = [4, 4, 8]; },
    value => { value.durations = [0, 6, 8]; }, value => { value.durations = [4, 6, 301]; },
    value => { value.durations = [4, 6.5, 8]; }, value => { value.rules[0].outputs = [0, 0]; },
    value => { value.rules[0].outputs = [-1]; }, value => { value.rules[0].outputs = [2]; },
    value => { value.rules[0].outputs = [0.5]; }, value => { value.rules[0].outputs = []; },
    value => { value.rules[0].referenceCounts = [2, 0]; }, value => { value.rules[0].referenceCounts = [0, 0]; },
    value => { value.rules[0].referenceCounts = [-1]; }, value => { value.rules[0].referenceCounts = [5]; },
    value => { value.rules[0].referenceCounts = [0.5]; }, value => { value.rules[0].referenceCounts = []; },
    value => { value.rules[0].firstFrame = false; value.rules[0].lastFrame = true; },
    value => { value.rules[0].requestAudio = 'false'; }, value => { value.rules[0].firstFrame = 1; },
    value => { value.rules[0].minDurationSeconds = 5; },
    value => { value.rules[0].durationSeconds = [6]; }, value => { delete value.rules[0].minDurationSeconds; },
    value => { value.rules[1].durationSeconds = [5]; }, value => { value.rules[1].durationSeconds = [8, 4]; },
    value => { value.rules[1].durationSeconds = []; }, value => { value.rules.push(value.rules[0]); },
    value => { value.outputs = new Array(1); }, value => { value.rules[0].outputs = new Array(1); },
    value => { value.rules[0].referenceCounts = new Array(1); }, value => { value.durations = new Array(1); },
  ];
  for (const change of changes) {
    const value = structuredClone(proof());
    change(value);
    assert.equal(decodeCanvasProvenVideoShapes({ provenShapeGroups: value }).error, 'invalid', String(change));
  }
});

test('compact byte, dictionary, rule and expansion limits fail closed', () => {
  const outputs = Array.from({ length: 63 }, (_, index) => output(`${64 + index * 2}p`));
  const large: any = { version: 1, outputs, durations: Array.from({ length: 300 }, (_, index) => index + 1), rules: [
    { outputs: outputs.map((_, index) => index), firstFrame: true, lastFrame: false, requestAudio: false, referenceCounts: [0, 1, 2, 3, 4], minDurationSeconds: 1 }
  ] };
  assert.ok(new TextEncoder().encode(JSON.stringify(large)).byteLength < 8192, 'the expansion bound is independent of the byte bound');
  assert.equal(decodeCanvasProvenVideoShapes({ provenShapeGroups: large }).error, 'invalid');
  const excessOutputs = { ...proof(), outputs: [...outputs, output('200p')] };
  assert.equal(decodeCanvasProvenVideoShapes({ provenShapeGroups: excessOutputs }).error, 'invalid');
  const excessRules = { ...proof(), rules: Array(257).fill(proof().rules[0]) };
  assert.equal(decodeCanvasProvenVideoShapes({ provenShapeGroups: excessRules }).error, 'invalid');
  const excessBytes = { ...large, durations: [6], rules: Array(40).fill({ ...large.rules[0], minDurationSeconds: 6 }) };
  assert.ok(new TextEncoder().encode(JSON.stringify(excessBytes)).byteLength > 8192);
  assert.equal(decodeCanvasProvenVideoShapes({ provenShapeGroups: excessBytes }).error, 'invalid');
});

test('legacy rows use the same exact dimensions, explicit audio and bounded uniqueness checks', () => {
  const rows = decodeCanvasProvenVideoShapes({ provenShapeGroups: proof() }).shapes!;
  for (const row of [{ ...rows[0], width: 1278 }, { ...rows[0], requestAudio: undefined }, { ...rows[0], extra: true }])
    assert.equal(decodeCanvasProvenVideoShapes({ provenShapes: [row] }).error, 'invalid');
  assert.equal(decodeCanvasProvenVideoShapes({ provenShapes: [rows[0], rows[0]] }).error, 'invalid');
  assert.equal(decodeCanvasProvenVideoShapes({ provenShapes: Array(32_769).fill(rows[0]) }).error, 'invalid');
  const audio = { ...rows[0], requestAudio: true };
  assert.deepEqual(decodeCanvasProvenVideoShapes({ provenShapes: [audio] }).shapes, [audio], 'native soundtrack and actual audio control are not conflated');
});
