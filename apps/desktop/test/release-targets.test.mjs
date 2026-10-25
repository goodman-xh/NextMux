import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  DESKTOP_RELEASE_TARGETS,
  desktopReleaseMatrix,
} from '../../../scripts/desktop-release-targets.mjs';

const workflow = await readFile(new URL('../../../.github/workflows/desktop-release.yml', import.meta.url), 'utf8');
const targetScript = await readFile(new URL('../../../scripts/desktop-release-targets.mjs', import.meta.url), 'utf8');

test('the release target manifest contains exactly the supported desktop architectures', () => {
  assert.deepEqual(
    DESKTOP_RELEASE_TARGETS.map(target => `${target.platform}-${target.arch}`),
    ['windows-x64', 'windows-arm64', 'macos-x64', 'macos-arm64'],
  );
  assert.equal(new Set(DESKTOP_RELEASE_TARGETS.map(target => target.id)).size, DESKTOP_RELEASE_TARGETS.length);
  assert.deepEqual(desktopReleaseMatrix('windows').include.map(target => target.arch), ['x64', 'arm64']);
  assert.deepEqual(desktopReleaseMatrix('macos').include.map(target => target.arch), ['x64', 'arm64']);
});

test('native release jobs consume the validated matrix instead of duplicating runner labels', () => {
  assert.match(targetScript, /config[\\/]desktop-release-targets\.json/);
  assert.match(workflow, /scripts\/desktop-release-targets\.mjs/);
  assert.match(workflow, /release-targets:/);
  assert.match(workflow, /windows:\s*\$\{\{\s*steps\.matrix\.outputs\.windows\s*\}\}/);
  assert.match(workflow, /macos:\s*\$\{\{\s*steps\.matrix\.outputs\.macos\s*\}\}/);
  assert.match(workflow, /matrix:\s*\$\{\{\s*fromJSON\(needs\.release-targets\.outputs\.windows\)\s*\}\}/);
  assert.match(workflow, /matrix:\s*\$\{\{\s*fromJSON\(needs\.release-targets\.outputs\.macos\)\s*\}\}/);
  assert.doesNotMatch(workflow, /runner:\s+(?:windows-2025|windows-11-arm|macos-26-intel|macos-26)\b/);
});
