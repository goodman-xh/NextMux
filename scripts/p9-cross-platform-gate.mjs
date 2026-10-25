#!/usr/bin/env node
/** P9 release acceptance gate. Native targets are evidence-driven: this gate
 * validates the four-target contract and runs only deterministic local probes. */
import assert from 'node:assert/strict';
import { buildCrossPlatformReport } from './desktop-cross-platform-matrix.mjs';

const report = buildCrossPlatformReport();
assert.deepEqual(report.targets.map(t => t.id).sort(), [
  'macos-arm64', 'macos-x64', 'windows-arm64', 'windows-x64',
]);
assert.equal(report.storage.status, 'passed');
assert.equal(report.persistence.status, 'passed');
assert.equal(report.shortcuts.status, 'passed');
assert.equal(report.windowGeometry.status, 'passed');
for (const target of report.targets) {
  assert.equal(target.runnerConfigured, true, `${target.id}: runner missing`);
  // A host can only attest to itself. CI must attach native evidence separately.
  if (target.status === 'not_run') assert.equal(target.hardwareQualification, 'pending');
}
process.stdout.write(JSON.stringify({ gate: 'passed', scope: report.scope, targets: report.targets }, null, 2) + '\n');
