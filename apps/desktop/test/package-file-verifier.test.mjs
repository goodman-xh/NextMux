import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { verifyPackageFileBoundary } from '../../../scripts/verify-package-file-boundary.mjs';

const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('electron-builder/package.json'));
const asar = builderRequire('@electron/asar');

async function fixture(t, path, physical = false) {
  const directory = await mkdtemp(join(tmpdir(), 'nextmux-package-verifier-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const stage = join(directory, 'stage'), resources = join(directory, 'Resources');
  await mkdir(stage); await mkdir(resources);
  await writeFile(join(stage, 'index.js'), 'module.exports = {};');
  if (path) {
    const target = join(physical ? resources : stage, path);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, 'SYNTHETIC_VALUE_MUST_NOT_BE_IN_ERROR');
  }
  await asar.createPackage(stage, join(resources, 'app.asar'));
  return resources;
}

test('final archive filename scan fails closed without reading or printing secret values', async t => {
  for (const path of ['node_modules/vendor/.env', 'lib/.ENV.production', 'lib/.npmrc', 'lib/.dev.vars.local', 'windows-codex-backup/rollout.jsonl']) {
    await assert.rejects(verifyPackageFileBoundary(await fixture(t, path)), error => {
      assert.match(error.message, /sensitive configuration\/history entries/);
      assert.doesNotMatch(error.message, /SYNTHETIC|rollout|vendor/);
      return true;
    });
  }
});

test('physical unpacked and extra resources cannot bypass the archive scan', async t => {
  for (const path of ['app.asar.unpacked/node_modules/vendor/.env', 'native/.dev.vars', 'windows-codex-backup/history.jsonl']) {
    await assert.rejects(verifyPackageFileBoundary(await fixture(t, path, true)), /Package file boundary rejected/);
  }
});

test('a clean archive reports only bounded counts and native CI verification invokes this gate', async t => {
  const report = await verifyPackageFileBoundary(await fixture(t, 'lib/LICENSE.txt'));
  assert.equal(report.forbiddenEntries, 0);
  assert.equal(report.scansFileContents, false);
  assert.equal(report.followsSymbolicLinks, false);
  const source = await readFile(new URL('../../../scripts/verify-desktop-native-artifacts.mjs', import.meta.url), 'utf8');
  assert.match(source, /async function packagedArtifacts[\s\S]*?await verifyPackageFileBoundary\(resourcesDirectory\)/);
});
