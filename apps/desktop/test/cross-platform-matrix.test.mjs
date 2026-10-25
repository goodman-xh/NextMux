import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCrossPlatformReport } from '../../../scripts/desktop-cross-platform-matrix.mjs';

test('offline cross-platform matrix reports all four targets without inventing native evidence', () => {
  const report = buildCrossPlatformReport();
  assert.equal(report.schemaVersion, 1);
  assert.deepEqual(report.targets.map(target => target.id), [
    'windows-x64', 'windows-arm64', 'macos-x64', 'macos-arm64',
  ]);
  assert.ok(report.targets.every(target => target.runnerConfigured));
  assert.ok(report.targets.every(target => target.hardwareQualification === 'pending'));
  assert.ok(report.targets.every(target => ['not_run', 'host_verified_for_offline_contracts'].includes(target.status)));
  assert.equal(report.storage.status, 'passed');
  assert.equal(report.persistence.status, 'passed');
  assert.equal(report.persistence.scope, 'offline_contract_only');
  assert.equal(report.persistence.nativeEvidenceRequired, true);
  assert.equal(report.shortcuts.status, 'passed');
  assert.equal(report.windowGeometry.status, 'passed');
  assert.equal(report.windowGeometry.cases, 189);
  assert.match(report.scope, /offline/);
});
