#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cloudflareQuery, renewCandidate, fileDigest } from './release-candidate-ci.mjs';
import { publishRelease } from './promote-desktop-updates.mjs';

export async function readArchiveObject(key, maximum, environment = process.env, fetcher = fetch) {
  const bucket = environment.NEXTMUX_UPDATE_BUCKET || 'nextmux-platform-assets', account = environment.CLOUDFLARE_ACCOUNT_ID;
  assert.match(bucket, /^[a-z0-9][a-z0-9-]{1,62}$/); assert.match(account || '', /^[a-f0-9]{32}$/i);
  assert.ok(environment.CLOUDFLARE_API_TOKEN, 'Cloudflare read credential is required');
  const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${bucket}/objects/${key.split('/').map(encodeURIComponent).join('/')}`, {
    headers: { authorization: `Bearer ${environment.CLOUDFLARE_API_TOKEN}` }, redirect: 'error', signal: AbortSignal.timeout(15 * 60_000),
  });
  if (response.status === 404) { await response.body?.cancel(); return null; }
  assert.equal(response.status, 200, `Archive read failed (HTTP ${response.status})`);
  const hash = createHash('sha256'); let size = 0; const text = [];
  for await (const bytes of response.body) {
    size += bytes.length; assert.ok(size <= maximum, 'Existing archive exceeds expected size'); hash.update(bytes);
    if (key.endsWith('/release-attestation.json')) text.push(Buffer.from(bytes));
  }
  return { size, sha256: hash.digest('hex'), ...(text.length ? { text: Buffer.concat(text).toString('utf8') } : {}) };
}
function reusableAttestation(existing, expected) {
  let a, b; try { a = JSON.parse(existing); b = JSON.parse(expected); } catch { return false; }
  // Retain earlier genuine CI evidence for identical bytes rather than
  // rewriting immutable timestamps or pretending the verifier was a builder.
  return a.schemaVersion === 1 && a.version === b.version && a.platform === b.platform && a.arch === b.arch && a.channel === b.channel
    && /^[a-f0-9]{40}$/i.test(a.commit || '') && !Number.isNaN(Date.parse(a.generatedAt || ''))
    && JSON.stringify(a.manifest) === JSON.stringify(b.manifest) && JSON.stringify(a.artifact) === JSON.stringify(b.artifact)
    && a.nativeSignature?.status === 'verified' && a.nativeSignature?.kind === b.nativeSignature?.kind
    && /^[a-f0-9]{64}$/i.test(a.nativeSignature?.evidenceSha256 || '');
}
export async function preflightArchive(operations, read = readArchiveObject) {
  const existing = new Set();
  // Inspect the ENTIRE plan before the first upload. A late conflict cannot
  // leave a different release partially overlaid on an existing version.
  for (const operation of operations) {
    const size = (await stat(operation.file)).size;
    const remote = await read(operation.key, operation.key.endsWith('/release-attestation.json') ? 32 * 1024 : size);
    if (!remote) continue;
    const same = remote.size === size && remote.sha256 === await fileDigest(operation.file);
    assert.ok(same || operation.key.endsWith('/release-attestation.json') && reusableAttestation(remote.text, await readFile(operation.file, 'utf8')),
      'An immutable release with different bytes already exists');
    existing.add(operation.key);
  }
  return existing;
}
function uploadMultipart(bucket, key, file, environment = process.env) {
  assert.ok(environment.AWS_ACCESS_KEY_ID && environment.AWS_SECRET_ACCESS_KEY, 'Protected R2 S3 credentials are required');
  assert.match(environment.CLOUDFLARE_ACCOUNT_ID || '', /^[a-f0-9]{32}$/i);
  // Official AWS CLI performs bounded-memory multipart upload for large files.
  const result = spawnSync('aws', ['s3', 'cp', file, `s3://${bucket}/${key}`, '--endpoint-url',
    `https://${environment.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`, '--region', 'auto', '--no-progress', '--only-show-errors'],
  { env: environment, timeout: 60 * 60_000, encoding: 'utf8' });
  assert.equal(result.status, 0, 'R2 multipart archive upload failed');
}
export async function archiveCandidate({ metadata, dist, evidence, environment = process.env, read = readArchiveObject, upload = uploadMultipart, renew }) {
  const bucket = environment.NEXTMUX_UPDATE_BUCKET || 'nextmux-platform-assets', prefix = environment.NEXTMUX_UPDATE_PREFIX || 'updates';
  assert.equal(prefix, 'updates', 'Candidate archives must use the existing update namespace');
  const options = { tag: `v${metadata.version}`, dist, evidence, bucket, prefix, archiveOnly: true };
  const operations = await publishRelease({ ...options, dryRun: true });
  assert.equal(operations.length, 24);
  for (const operation of operations.filter(item => item.key.endsWith('/release-attestation.json'))) {
    const attestation = JSON.parse(await readFile(operation.file, 'utf8'));
    assert.equal(attestation.provenance?.kind, 'candidate-import'); assert.equal(attestation.provenance.candidateId, metadata.id);
    assert.equal(attestation.provenance.manifestSha256, metadata.manifestSha256);
  }
  await renew();
  const existing = await preflightArchive(operations, (key, maximum) => read(key, maximum, environment));
  await publishRelease({ ...options, dryRun: false, archiveWriter: async (bucket, key, file) => {
    await renew();
    if (existing.has(key)) return;
    await upload(bucket, key, file, environment);
    const remote = await read(key, (await stat(file)).size, environment);
    assert.ok(remote && remote.size === (await stat(file)).size && remote.sha256 === await fileDigest(file), 'Archived bytes could not be verified');
  } });
  return { status: 'verified', candidateId: metadata.id, manifestSha256: metadata.manifestSha256, archiveOnly: true,
    verificationCommit: environment.GITHUB_SHA, sourceBuildCommit: null, sourceQualityGate: 'not_run',
    targets: ['windows-x64', 'windows-arm64', 'macos-x64', 'macos-arm64'], completedAt: Date.now() };
}
async function main() {
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.GITHUB_REF, `refs/heads/${process.env.NEXTMUX_TRUSTED_DEFAULT_BRANCH}`);
  const args = process.argv.slice(2), options = Object.fromEntries(Array.from({ length: args.length / 2 }, (_, i) => [args[i * 2], args[i * 2 + 1]]));
  const metadata = JSON.parse(await readFile(resolve(options['--metadata']), 'utf8')), query = cloudflareQuery();
  const result = await archiveCandidate({ metadata, dist: resolve(options['--dist']), evidence: resolve(options['--evidence']), renew: () => renewCandidate(query, metadata) });
  await writeFile(resolve(options['--result']), JSON.stringify(result) + '\n', { flag: 'wx', mode: 0o600 });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
