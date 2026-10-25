#!/usr/bin/env node
// Trusted CI only. The website cannot call this adapter or supply its results.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { releaseCandidateFiles, RELEASE_CANDIDATE_PART_SIZE } from '../apps/cloudflare-platform/src/release-candidates.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const leaseMs = 3 * 60 * 60 * 1000;
export async function fileDigest(path) {
  const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex');
}
export function validateCandidate(row) {
  assert.match(row?.id || '', uuid, 'Invalid candidate identity');
  const files = JSON.parse(row.files_json), required = releaseCandidateFiles(row.version);
  assert.equal(files.length, 20, 'A complete four-target release is required');
  let total = 0;
  for (const [index, file] of files.entries()) {
    assert.equal(file.id, `f${index}`, 'Unexpected candidate file identity');
    for (const key of ['platform', 'arch', 'fileName']) assert.equal(file[key], required[index][key], 'Unexpected candidate file');
    assert.ok(Number.isSafeInteger(file.size) && file.size > 0 && file.size <= 2 * 1024 ** 3, 'Candidate file size invalid');
    total += file.size;
    const count = Math.ceil(file.size / RELEASE_CANDIDATE_PART_SIZE);
    assert.equal(Object.keys(file.parts).length, count, 'Incomplete candidate upload');
    for (let part = 1; part <= count; part++) {
      const record = file.parts[part];
      assert.ok(record, 'Candidate part missing');
      const prefix = `release-candidates/${row.id}/${file.id}/${part}/`;
      assert.ok(record.key?.startsWith(prefix) && uuid.test(record.key.slice(prefix.length)), 'Candidate object escapes its isolated namespace');
      assert.equal(record.size, Math.min(RELEASE_CANDIDATE_PART_SIZE, file.size - (part - 1) * RELEASE_CANDIDATE_PART_SIZE), 'Candidate part size mismatch');
      assert.match(record.sha256 || '', /^[0-9a-f]{64}$/, 'Candidate part hash missing');
    }
  }
  assert.ok(total <= 8 * 1024 ** 3, 'Candidate release exceeds size limit');
  assert.equal(digest(JSON.stringify({ schemaVersion: 1, id: row.id, version: row.version, files })), row.manifest_sha256, 'Candidate manifest changed');
  return files;
}

export async function claimCandidate(query, id, now = Date.now(), claim = randomUUID()) {
  assert.match(id || '', uuid); assert.match(claim, uuid);
  const row = (await query('SELECT * FROM release_candidates WHERE id=?', [id])).results?.[0];
  assert.ok(row, 'Candidate not found'); validateCandidate(row);
  const changed = await query(`UPDATE release_candidates SET status='verifying',verification_claim=?,verification_lease_until=?,verification_result_json=NULL,updated_at=?
    WHERE id=? AND manifest_sha256=? AND expires_at>? AND (status IN ('pending_verification','verification_failed') OR (status='verifying' AND verification_lease_until<=?))
    AND NOT EXISTS(SELECT 1 FROM release_candidates other WHERE other.id<>? AND other.version=release_candidates.version
      AND (other.status='verified' OR (other.status='verifying' AND other.verification_lease_until>?)))`,
  [claim, now + leaseMs, now, id, row.manifest_sha256, now, now, id, now]);
  assert.equal(Number(changed.meta?.changes), 1, 'Candidate is expired, locked or already verified');
  return { ...row, verification_claim: claim, verification_lease_until: now + leaseMs };
}
export async function renewCandidate(query, metadata, now = Date.now()) {
  const result = await query(`UPDATE release_candidates SET verification_lease_until=?,updated_at=? WHERE id=? AND status='verifying'
    AND verification_claim=? AND manifest_sha256=? AND verification_lease_until>?`,
  [now + leaseMs, now, metadata.id, metadata.claim, metadata.manifestSha256, now]);
  assert.equal(Number(result.meta?.changes), 1, 'Candidate verification ownership was lost');
}
export async function finishCandidate(query, metadata, result, now = Date.now()) {
  assert.ok(result?.status === 'verified' || result?.status === 'verification_failed');
  const response = await query(`UPDATE release_candidates SET status=?,verification_result_json=?,verified_at=?,verification_lease_until=NULL,updated_at=?
    WHERE id=? AND status='verifying' AND verification_claim=? AND manifest_sha256=? AND verification_lease_until>?`,
  [result.status, JSON.stringify(result), result.status === 'verified' ? now : null, now, metadata.id, metadata.claim, metadata.manifestSha256, now]);
  assert.equal(Number(response.meta?.changes), 1, 'Candidate verification ownership was lost');
}

export function cloudflareQuery(environment = process.env, fetcher = fetch) {
  const account = environment.CLOUDFLARE_ACCOUNT_ID, database = environment.NEXTMUX_D1_DATABASE_ID, token = environment.CLOUDFLARE_API_TOKEN;
  assert.match(account || '', /^[a-f0-9]{32}$/i, 'CLOUDFLARE_ACCOUNT_ID is required');
  assert.match(database || '', uuid, 'NEXTMUX_D1_DATABASE_ID is required'); assert.ok(token, 'CLOUDFLARE_API_TOKEN is required');
  return async (sql, params = []) => {
    const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ sql, params }), signal: AbortSignal.timeout(30_000), redirect: 'error',
    });
    assert.equal(response.ok, true, `D1 query failed (HTTP ${response.status})`);
    const body = await response.json();
    assert.ok(body.success && body.result?.[0]?.success !== false, 'D1 query failed'); return body.result[0];
  };
}
function downloadObject(key, file, environment) {
  const bucket = environment.NEXTMUX_UPDATE_BUCKET || 'nextmux-platform-assets';
  assert.match(bucket, /^[a-z0-9][a-z0-9-]{1,62}$/);
  const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', 'wrangler@4.126.0', 'r2', 'object', 'get', `${bucket}/${key}`, '--file', file, '--remote'],
    { encoding: 'utf8', timeout: 300_000, windowsHide: true, env: environment });
  // Wrangler errors can include account/config details. CI only needs a code.
  assert.equal(result.status, 0, 'Candidate object download failed');
}
export async function downloadCandidate(row, directory, download = downloadObject, environment = process.env, renew = async () => {}) {
  const files = validateCandidate(row); await mkdir(directory); const entries = [];
  for (const file of files) {
    const targetDirectory = join(directory, `nextmux-${file.platform}-${file.arch}`); await mkdir(targetDirectory, { recursive: true });
    const target = join(targetDirectory, file.fileName), handle = await open(target, 'wx', 0o600);
    try {
      for (let number = 1; number <= Object.keys(file.parts).length; number++) {
        const record = file.parts[number], part = join(directory, `.part-${randomUUID()}`);
        try {
          await download(record.key, part, environment);
          await renew();
          assert.equal((await stat(part)).size, record.size, 'Candidate part size changed');
          const bytes = await readFile(part); assert.equal(digest(bytes), record.sha256, 'Candidate part hash changed');
          await handle.writeFile(bytes);
        } finally { await rm(part, { force: true }); }
      }
    } finally { await handle.close(); }
    assert.equal((await stat(target)).size, file.size, 'Candidate file incomplete');
    entries.push({ platform: file.platform, arch: file.arch, fileName: file.fileName, size: file.size, sha256: await fileDigest(target) });
  }
  return { schemaVersion: 1, id: row.id, version: row.version, claim: row.verification_claim, manifestSha256: row.manifest_sha256, files: entries };
}

async function main() {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'This mutation adapter runs only in trusted CI');
  assert.equal(process.env.GITHUB_REF, `refs/heads/${process.env.NEXTMUX_TRUSTED_DEFAULT_BRANCH}`, 'Candidate verification must run on the trusted default branch');
  const [command, ...args] = process.argv.slice(2), options = Object.fromEntries(Array.from({ length: args.length / 2 }, (_, i) => [args[i * 2], args[i * 2 + 1]]));
  const query = cloudflareQuery();
  if (command === 'download') {
    const row = await claimCandidate(query, options['--candidate']);
    const metadata = { id: row.id, claim: row.verification_claim, manifestSha256: row.manifest_sha256 };
    try {
      const downloaded = await downloadCandidate(row, resolve(options['--dist']), downloadObject, process.env, () => renewCandidate(query, metadata));
      await writeFile(resolve(options['--metadata']), JSON.stringify(downloaded) + '\n', { flag: 'wx', mode: 0o600 });
    } catch (error) {
      await finishCandidate(query, metadata, { status: 'verification_failed', code: 'candidate_download_failed' }).catch(() => {}); throw error;
    }
  } else {
    const metadata = JSON.parse(await readFile(resolve(options['--metadata']), 'utf8'));
    if (command === 'renew') await renewCandidate(query, metadata);
    else if (command === 'fail') await finishCandidate(query, metadata, { status: 'verification_failed', code: 'native_verification_failed' });
    else if (command === 'finish') {
      const evidence = JSON.parse(await readFile(resolve(options['--result']), 'utf8'));
      assert.equal(evidence.candidateId, metadata.id); assert.equal(evidence.manifestSha256, metadata.manifestSha256);
      assert.equal(evidence.status, 'verified'); assert.equal(evidence.archiveOnly, true); assert.equal(evidence.targets?.length, 4);
      await finishCandidate(query, metadata, evidence);
    } else throw new Error('Unknown candidate CI operation');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
