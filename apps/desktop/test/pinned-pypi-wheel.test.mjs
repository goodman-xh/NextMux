import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pinnedPypiWheelBasename, verifyPinnedPypiWheel } from '../../../scripts/pinned-pypi-wheel.mjs';

const name = 'windows_mcp-0.8.5-py3-none-any.whl';
const bytes = Buffer.from('isolated primary wheel fixture');
const source = { url: `https://files.pythonhosted.org/packages/pinned/${name}`, sha256: createHash('sha256').update(bytes).digest('hex') };
const fixture = async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'nextmux-wheel-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
};

test('selects the exact primary wheel among downloaded dependencies', async t => {
  const directory = await fixture(t);
  await writeFile(path.join(directory, 'annotated_types-0.7.0-py3-none-any.whl'), 'dependency');
  await writeFile(path.join(directory, name), bytes);
  await writeFile(path.join(directory, 'zipp-3.23.0-py3-none-any.whl'), 'dependency');
  assert.notEqual((await readdir(directory)).sort().find(file => file.endsWith('.whl')), name);
  assert.equal(await verifyPinnedPypiWheel(source, directory), path.join(directory, name));
});

test('decodes only the URL basename and permits a signed URL query', () => {
  assert.equal(pinnedPypiWheelBasename({ url: source.url.replace('windows_', '%77indows_') + '?download=1#file' }), name);
});

test('rejects unsafe, malformed, non-HTTPS and credentialed URLs', () => {
  for (const url of [
    'https://example.com/%2e%2e%2foutside.whl', 'https://example.com/a%5cb.whl',
    'https://example.com/a%00.whl', 'https://example.com/a%3ab.whl',
    'https://example.com/%ZZ.whl', 'http://example.com/a.whl',
    'https://user:secret@example.com/a.whl', 'https://example.com/download?file=a.whl',
  ]) assert.throws(() => pinnedPypiWheelBasename({ url }));
});

test('a matching dependency hash cannot replace a missing primary wheel', async t => {
  const directory = await fixture(t);
  await writeFile(path.join(directory, 'dependency-1.0-py3-none-any.whl'), bytes);
  await assert.rejects(verifyPinnedPypiWheel(source, directory), { code: 'ENOENT' });
});

test('rejects a corrupt primary wheel and missing pinned checksum', async t => {
  const directory = await fixture(t);
  await writeFile(path.join(directory, name), 'corrupt primary');
  await assert.rejects(verifyPinnedPypiWheel(source, directory), /integrity mismatch/);
  await assert.rejects(verifyPinnedPypiWheel({ ...source, sha256: '' }, directory), /SHA-256 is invalid/);
});

test('rejects a directory at the pinned filename', async t => {
  const directory = await fixture(t);
  await mkdir(path.join(directory, name));
  await assert.rejects(verifyPinnedPypiWheel(source, directory), /regular file/);
});

test('rejects a symlink at the pinned filename', async t => {
  const directory = await fixture(t);
  await writeFile(path.join(directory, 'outside.whl'), bytes);
  try {
    await symlink(path.join(directory, 'outside.whl'), path.join(directory, name));
  } catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') {
      t.skip('This Windows account has no symlink creation privilege.');
      return;
    }
    throw error;
  }
  await assert.rejects(verifyPinnedPypiWheel(source, directory), /regular file/);
});
