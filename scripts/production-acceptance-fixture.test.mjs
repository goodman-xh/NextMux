import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inflateSync } from 'node:zlib';
import test from 'node:test';
import { acceptanceChartPng, createAcceptanceFixture } from './production-acceptance-fixture.mjs';

test('the acceptance image has three real RGB bars with blue tallest', () => {
  const image = acceptanceChartPng();
  assert.equal(image.subarray(1, 4).toString(), 'PNG');
  let offset = 8, raw;
  while (offset < image.length) {
    const length = image.readUInt32BE(offset), type = image.subarray(offset + 4, offset + 8).toString();
    if (type === 'IDAT') raw = inflateSync(image.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  assert.equal(raw.length, 180 * (240 * 3 + 1));
  const pixel = (x, y) => [...raw.subarray(y * 721 + x * 3 + 1, y * 721 + x * 3 + 4)];
  assert.deepEqual(pixel(40, 70), [220, 45, 55]);
  assert.deepEqual(pixel(110, 70), [255, 255, 255]);
  assert.deepEqual(pixel(180, 45), [45, 95, 220]);
});

test('fixtures are repeatable but never overwrite edited test inputs or model deliverables', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'nextmux-acceptance-fixture-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = await createAcceptanceFixture(directory);
  assert.equal(first.expected.totalRevenueUsd, 360);
  await createAcceptanceFixture(directory);
  await writeFile(join(directory, 'report.md'), 'Keep this real model result');
  await writeFile(join(directory, 'sales.csv'), 'user edited input');
  await assert.rejects(createAcceptanceFixture(directory), { code: 'EEXIST' });
  assert.equal(await readFile(join(directory, 'sales.csv'), 'utf8'), 'user edited input');
  assert.equal(await readFile(join(directory, 'report.md'), 'utf8'), 'Keep this real model result');
});
