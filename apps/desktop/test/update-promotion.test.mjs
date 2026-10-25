import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { archiveCandidate } from '../../../scripts/archive-release-candidate.mjs';
import {
  parseUpdateManifest,
  publishRelease,
  releaseChannel,
  updateManifestName,
} from '../../../scripts/promote-desktop-updates.mjs';

async function writeEvidence(root, platform, arch, files) {
  const directory = join(root, `${platform}-${arch}`);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'runner.json'), JSON.stringify({
    schemaVersion: 1, generatedAt: '2026-09-06T00:00:00.000Z', commit: 'a'.repeat(40),
    declared: { platform, architecture: arch },
    artifacts: [...files].map(([path, bytes]) => ({
      path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    })),
  }));
  const checks = platform === 'windows'
    ? [...files].filter(([name]) => name.endsWith('.exe')).map(([artifact]) => ({
        artifact, kind: 'authenticode', status: 'Valid', timestamp: 'CN=Timestamp',
      }))
    : [{ artifact: 'NextMux.app', kind: 'application' },
      { artifact: `NextMux-1.2.3-${arch}.dmg`, kind: 'disk-image',
        commands: [{ command: '/usr/bin/hdiutil', args: ['attach', '-readonly'], status: 0 }],
        mountedApplications: [{ application: 'NextMux.app', commands: [
          ['/usr/bin/codesign', '--verify', '--deep', '--strict'],
          ['/usr/bin/codesign', '-d', '--verbose=4'],
          ['/usr/sbin/spctl', '--assess', '--type', 'execute'],
          ['/usr/bin/xcrun', 'stapler', 'validate'],
        ].map(([command, ...args]) => ({ command, args: [...args, '/Volumes/NextMux/NextMux.app'], status: 0 })) }],
      }];
  await writeFile(join(directory, 'signing-verifier.json'), JSON.stringify({
    schemaVersion: 1, platform: platform === 'windows' ? 'win32' : 'darwin', architecture: arch,
    signedRequired: true, status: 'verified', checks,
  }));
}

test('update manifests follow electron-builder stable and prerelease channel names', () => {
  assert.equal(releaseChannel('1.2.3'), 'latest');
  assert.equal(releaseChannel('1.2.3-alpha.5'), 'alpha');
  assert.equal(updateManifestName('windows', '1.2.3-alpha.5'), 'alpha.yml');
  assert.equal(updateManifestName('macos', '1.2.3-alpha.5'), 'alpha-mac.yml');
  assert.equal(updateManifestName('macos', '1.2.3'), 'latest-mac.yml');
});

test('update promotion parser requires versioned files with sha512', () => {
  const parsed = parseUpdateManifest(`version: 1.2.3
files:
  - url: NextMux-1.2.3-x64-setup.exe
    sha512: YWJjZA==
    size: 123
path: NextMux-1.2.3-x64-setup.exe
sha512: YWJjZA==
`);
  assert.equal(parsed.version, '1.2.3');
  assert.deepEqual(parsed.files, [{ url: 'NextMux-1.2.3-x64-setup.exe', sha512: 'YWJjZA==', size: 123 }]);
});

test('update promotion parser rejects path traversal and missing digests', () => {
  assert.throws(() => parseUpdateManifest(`version: 1.2.3
files:
  - url: ../NextMux.exe
    sha512: YWJjZA==
`), /Unsafe update filename/);
  assert.throws(() => parseUpdateManifest(`version: 1.2.3
files:
  - url: NextMux.exe
`), /Missing or invalid sha512/);
});

test('release promotion validates all four manifests and writes live manifests last', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-promotion-test-'));
  const evidence = join(root, 'evidence');
  const layouts = [
    ['windows', 'x64'],
    ['windows', 'arm64'],
    ['macos', 'x64'],
    ['macos', 'arm64'],
  ];
  try {
    for (const [platform, arch] of layouts) {
      const directory = join(root, `nextmux-${platform}-${arch}`);
      await mkdir(directory, { recursive: true });
      const artifact = platform === 'windows' ? `NextMux-1.2.3-${arch}-setup.exe` : `NextMux-1.2.3-${arch}.zip`;
      const companion = platform === 'windows' ? `NextMux-1.2.3-${arch}-portable.exe` : `NextMux-1.2.3-${arch}.dmg`;
      const manifestName = updateManifestName(platform, '1.2.3');
      const blockmap = `${artifact}.blockmap`;
      const bytes = Buffer.from(`${platform}-${arch}-signed-artifact`);
      const digest = createHash('sha512').update(bytes).digest('base64');
      const files = new Map([
        [artifact, bytes],
        [blockmap, Buffer.from(`blockmap-${platform}-${arch}`)],
        [companion, Buffer.from(`${platform}-${arch}-companion`)],
        [manifestName, Buffer.from(`version: 1.2.3
files:
  - url: ${artifact}
    sha512: ${digest}
    size: ${bytes.length}
`)],
      ]);
      const checksumName = `SHA256SUMS-${platform}-${arch}.txt`;
      const checksum = Buffer.from([...files].map(([name, contents]) =>
        `${createHash('sha256').update(contents).digest('hex')} *${name}`).join('\n') + '\n');
      files.set(checksumName, checksum);
      for (const [name, contents] of files) await writeFile(join(directory, name), contents);
      await writeEvidence(evidence, platform, arch, files);
    }

    const operations = await publishRelease({
      tag: 'v1.2.3',
      dist: root,
      evidence,
      bucket: 'test-bucket',
      prefix: 'updates',
      dryRun: true,
    });
    assert.equal(operations.length, 36);
    const archive = await publishRelease({ tag: 'v1.2.3', dist: root, evidence, bucket: 'test-bucket', prefix: 'updates', dryRun: true, archiveOnly: true });
    assert.equal(archive.length, 24);
    assert.ok(archive.every(operation => operation.key.startsWith('updates/releases/v1.2.3/')),
      'candidate verification must not publish any live feed before explicit D1 target selection');
    const metadata = { id: '12345678-1234-1234-1234-123456789abc', version: '1.2.3', manifestSha256: 'd'.repeat(64) };
    const provenance = { kind: 'candidate-import', candidateId: metadata.id, manifestSha256: metadata.manifestSha256,
      verificationCommit: 'a'.repeat(40), sourceBuildCommit: null, sourceQualityGate: 'not_run' };
    for (const [platform, arch] of layouts) {
      const directory = join(evidence, `${platform}-${arch}`), runnerPath = join(directory, 'runner.json');
      const runner = JSON.parse(await readFile(runnerPath, 'utf8')); runner.provenance = provenance;
      await writeFile(runnerPath, JSON.stringify(runner));
      const checks = [];
      for (const label of platform === 'windows' ? ['installed', 'portable'] : ['zip', 'dmg']) {
        const results = [{ kind: 'packaged-desktop-e2e', status: 'passed' }];
        if (label === 'portable') results.push({ kind: 'portable-launcher-e2e', status: 'passed' });
        for (const kind of ['native', 'terminal']) {
          const report = `${label}-${kind}.json`, bytes = Buffer.from('{"fixture":true}');
          await writeFile(join(directory, report), bytes);
          results.push({ kind, status: 'passed', report, sha256: createHash('sha256').update(bytes).digest('hex') });
        }
        checks.push({ label, status: 'passed', architecture: arch, productVersion: '1.2.3', checks: results });
      }
      await writeFile(join(directory, 'candidate-verifier.json'), JSON.stringify({ schemaVersion: 1, status: 'verified', platform, arch, version: '1.2.3', provenance, checks }));
    }
    const objects = new Map(); let renewals = 0;
    const args = { metadata, dist: root, evidence, environment: { NEXTMUX_UPDATE_BUCKET: 'test-bucket', GITHUB_SHA: 'a'.repeat(40) },
      renew: async () => { renewals++; },
      read: async key => { const bytes = objects.get(key); return bytes ? { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), text: bytes.toString() } : null; },
      upload: async (_bucket, key, file) => { assert.ok(!objects.has(key)); objects.set(key, await readFile(file)); } };
    const receipt = await archiveCandidate(args);
    assert.equal(receipt.status, 'verified'); assert.equal(receipt.sourceBuildCommit, null); assert.equal(objects.size, 24);
    assert.ok([...objects.keys()].every(key => key.startsWith('updates/releases/v1.2.3/'))); assert.ok(renewals >= 25);
    await archiveCandidate(args); assert.equal(objects.size, 24, 'retries reuse identical immutable archive bytes');
    for (const [platform, arch] of layouts) {
      const liveBase = `updates/${platform}/${arch}`;
      const immutableBase = `updates/releases/v1.2.3/${platform}/${arch}`;
      const relevant = operations.filter(operation => operation.key.startsWith(liveBase));
      assert.equal(relevant.at(-1).key, `${liveBase}/${updateManifestName(platform, '1.2.3')}`,
        'the live manifest must be the final write for each architecture');
      const companion = platform === 'windows' ? `NextMux-1.2.3-${arch}-portable.exe` : `NextMux-1.2.3-${arch}.dmg`;
      assert.ok(operations.some(operation => operation.key === `${immutableBase}/${companion}`),
        'the immutable archive must retain the user-facing installer or portable companion');
      assert.ok(operations.some(operation => operation.key === `${immutableBase}/SHA256SUMS-${platform}-${arch}.txt`));
      assert.ok(!operations.some(operation => operation.key === `${liveBase}/${companion}`),
        'non-updater downloads stay immutable instead of being overwritten in the live feed');
    }

    const signingPath = join(evidence, 'macos-x64', 'signing-verifier.json');
    const signingSource = await readFile(signingPath, 'utf8');
    const incompleteSigning = JSON.parse(signingSource);
    const dmg = incompleteSigning.checks.find(check => check.kind === 'disk-image');
    const applications = dmg.mountedApplications;
    delete dmg.mountedApplications;
    await writeFile(signingPath, JSON.stringify(incompleteSigning));
    await assert.rejects(() => publishRelease({
      tag: 'v1.2.3', dist: root, evidence, bucket: 'test-bucket', prefix: 'updates', dryRun: true,
    }), /Mounted application signing evidence is missing/);
    dmg.mountedApplications = applications;
    applications[0].commands[0].status = 1;
    await writeFile(signingPath, JSON.stringify(incompleteSigning));
    await assert.rejects(() => publishRelease({
      tag: 'v1.2.3', dist: root, evidence, bucket: 'test-bucket', prefix: 'updates', dryRun: true,
    }), /Mounted application codesign evidence is missing or failed/);
    await writeFile(signingPath, signingSource);

    await rm(join(root, 'nextmux-windows-x64', 'NextMux-1.2.3-x64-portable.exe'));
    await assert.rejects(() => publishRelease({
      tag: 'v1.2.3', dist: root, evidence, bucket: 'test-bucket', prefix: 'updates', dryRun: true,
    }), /Required update file is missing:.*portable\.exe/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('release promotion fails closed when an updater blockmap is missing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-promotion-blockmap-test-'));
  try {
    const directory = join(root, 'nextmux-windows-x64');
    await mkdir(directory, { recursive: true });
    const artifact = 'NextMux-1.2.3-x64-setup.exe';
    const bytes = Buffer.from('signed-artifact-without-blockmap');
    const digest = createHash('sha512').update(bytes).digest('base64');
    await writeFile(join(directory, artifact), bytes);
    await writeFile(join(directory, 'latest.yml'), `version: 1.2.3
files:
  - url: ${artifact}
    sha512: ${digest}
    size: ${bytes.length}
`);
    await assert.rejects(() => publishRelease({
      tag: 'v1.2.3',
      dist: root,
      evidence: join(root, 'evidence'),
      bucket: 'test-bucket',
      prefix: 'updates',
      dryRun: true,
    }), /Required update blockmap is missing/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
