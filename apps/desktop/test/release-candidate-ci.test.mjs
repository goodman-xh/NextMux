import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { claimCandidate, renewCandidate, finishCandidate, validateCandidate, downloadCandidate, fileDigest } from '../../../scripts/release-candidate-ci.mjs';
import { executableArchitectures, validateDownloadedTarget } from '../../../scripts/verify-release-candidate.mjs';
import { preflightArchive, readArchiveObject } from '../../../scripts/archive-release-candidate.mjs';
import { releaseCandidateFiles } from '../../cloudflare-platform/src/release-candidates.js';

const root = new URL('../../../', import.meta.url);
const hash = value => createHash('sha256').update(value).digest('hex');
async function temporary(t) { const dir = await mkdtemp(join(tmpdir(), 'nm-candidate-test-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
function row() {
  const id = randomUUID(), version = '1.2.3';
  const files = releaseCandidateFiles(version).map((file, index) => ({ ...file, id: `f${index}`, size: 3,
    parts: { 1: { size: 3, sha256: hash('abc'), key: `release-candidates/${id}/f${index}/1/${randomUUID()}` } } }));
  return { id, version, files_json: JSON.stringify(files), manifest_sha256: hash(JSON.stringify({ schemaVersion: 1, id, version, files })) };
}
test('claims are exclusive, expired claims can be recovered, stale workers cannot finish, and verified versions stay immutable', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  for (const name of (await readdir(new URL('apps/cloudflare-platform/migrations/', root))).filter(name => name.endsWith('.sql')).sort()) db.exec(await readFile(new URL(`apps/cloudflare-platform/migrations/${name}`, root), 'utf8'));
  db.exec("INSERT INTO users(id,email,status,created_at,updated_at) VALUES('owner','owner@example.test','active',1,1)");
  const first = row(), second = row(), now = Date.now();
  for (const item of [first, second]) db.prepare("INSERT INTO release_candidates(id,owner_user_id,version,status,files_json,manifest_sha256,created_at,updated_at,expires_at) VALUES(?,'owner',?,'pending_verification',?,?,1,1,?)")
    .run(item.id, item.version, item.files_json, item.manifest_sha256, now + 86400000);
  const query = async (sql, args) => sql.startsWith('SELECT') ? { results: db.prepare(sql).all(...args) } : { meta: { changes: Number(db.prepare(sql).run(...args).changes) } };
  const outcomes = await Promise.allSettled([claimCandidate(query, first.id, now), claimCandidate(query, first.id, now)]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  const winner = outcomes.find(item => item.status === 'fulfilled').value;
  const metadata = { id: first.id, claim: winner.verification_claim, manifestSha256: first.manifest_sha256 };
  await assert.rejects(claimCandidate(query, second.id, now), /locked/);
  await renewCandidate(query, metadata, now + 100);
  await assert.rejects(finishCandidate(query, { ...metadata, claim: randomUUID() }, { status: 'verified' }, now + 101), /ownership/);
  await finishCandidate(query, metadata, { status: 'verification_failed' }, now + 101);
  const replacement = await claimCandidate(query, first.id, now + 102);
  await assert.rejects(finishCandidate(query, metadata, { status: 'verified' }, now + 103), /ownership/);
  const current = { ...metadata, claim: replacement.verification_claim };
  db.prepare('UPDATE release_candidates SET verification_lease_until=? WHERE id=?').run(now + 102, first.id);
  await assert.rejects(renewCandidate(query, current, now + 104), /ownership/);
  const recovered = await claimCandidate(query, first.id, now + 105);
  await finishCandidate(query, { ...metadata, claim: recovered.verification_claim }, { status: 'verified' }, now + 106);
  await assert.rejects(claimCandidate(query, second.id, now + 107), /locked/);
});
test('locked manifest rejects changed bytes, part namespace escapes and untrusted filenames', () => {
  const valid = row(); assert.equal(validateCandidate(valid).length, 20);
  for (const mutate of [files => { files[0].fileName = '../evil.exe'; }, files => { files[0].parts[1].key = 'updates/private'; }, files => { files[0].size++; }]) {
    const files = JSON.parse(valid.files_json); mutate(files);
    assert.throws(() => validateCandidate({ ...valid, files_json: JSON.stringify(files) }));
  }
});
test('download assembles verified parts, renews ownership, never overwrites a destination and removes corrupt temporary parts', async t => {
  const dir = await temporary(t), candidate = { ...row(), verification_claim: randomUUID() }; let renewed = 0;
  const metadata = await downloadCandidate(candidate, join(dir, 'good'), async (_key, path) => writeFile(path, 'abc'), {}, async () => { renewed++; });
  assert.equal(metadata.files.length, 20); assert.equal(renewed, 20);
  assert.equal(await fileDigest(join(dir, 'good/nextmux-windows-x64/NextMux-1.2.3-x64-setup.exe')), hash('abc'));
  await assert.rejects(downloadCandidate(candidate, join(dir, 'good')), /EEXIST/);
  await assert.rejects(downloadCandidate(candidate, join(dir, 'bad'), async (_key, path) => writeFile(path, 'xyz')), /hash changed/);
  assert.equal((await readdir(join(dir, 'bad'))).some(name => name.startsWith('.part-')), false);
});
test('archive preflight rejects a late conflict before allowing upload and distinguishes missing objects from access failures', async t => {
  const dir = await temporary(t); await writeFile(join(dir, 'a'), 'abc'); await writeFile(join(dir, 'b'), 'abc');
  const operations = ['a', 'b'].map(name => ({ key: `updates/releases/v1.2.3/${name}`, file: join(dir, name) }));
  await assert.rejects(preflightArchive(operations, async key => key.endsWith('/a') ? null : { size: 3, sha256: hash('xyz') }), /different bytes/);
  assert.equal((await preflightArchive(operations, async () => ({ size: 3, sha256: hash('abc') }))).size, 2);
  const env = { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_API_TOKEN: 'fixture' };
  assert.equal(await readArchiveObject('test', 3, env, async () => new Response(null, { status: 404 })), null);
  await assert.rejects(readArchiveObject('test', 3, env, async () => new Response(null, { status: 403 })), /403/);
  await assert.rejects(readArchiveObject('test', 2, env, async () => new Response('abc')), /exceeds/);
});
test('PE and Mach-O architecture are read from executable headers, not file labels', async t => {
  const dir = await temporary(t), pe = Buffer.alloc(128), mach = Buffer.alloc(64);
  pe.writeUInt16LE(0x5a4d); pe.writeUInt32LE(64, 60); pe.writeUInt32LE(0x4550, 64); pe.writeUInt16LE(0xaa64, 68);
  mach.writeUInt32LE(0xfeedfacf); mach.writeUInt32LE(0x01000007, 4);
  await writeFile(join(dir, 'x64.exe'), pe); await writeFile(join(dir, 'arm64'), mach);
  assert.deepEqual(executableArchitectures(join(dir, 'x64.exe')), ['arm64']); assert.deepEqual(executableArchitectures(join(dir, 'arm64')), ['x64']);
});
test('downloaded target requires matching update SHA512 and SHA256SUMS, independently of upload receipts', async t => {
  const dir = await temporary(t), files = releaseCandidateFiles('1.2.3').filter(file => file.platform === 'windows' && file.arch === 'x64');
  const name = 'NextMux-1.2.3-x64-setup.exe', bytes = new Map(files.map(file => [file.fileName, Buffer.from('abc')]));
  bytes.set('latest.yml', Buffer.from(`version: 1.2.3\nfiles:\n  - url: ${name}\n    sha512: ${createHash('sha512').update('abc').digest('base64')}\n    size: 3\n`));
  bytes.set('SHA256SUMS-windows-x64.txt', Buffer.from([...bytes].filter(([name]) => !name.startsWith('SHA256SUMS-')).map(([name, value]) => `${hash(value)} *${name}`).join('\n')));
  const metadata = { version: '1.2.3', files: files.map(file => ({ ...file, size: bytes.get(file.fileName).length, sha256: hash(bytes.get(file.fileName)) })) };
  for (const [name, value] of bytes) await writeFile(join(dir, name), value);
  assert.equal((await validateDownloadedTarget(metadata, 'windows', 'x64', dir)).length, 5);
  await writeFile(join(dir, name), 'xyz'); await assert.rejects(validateDownloadedTarget(metadata, 'windows', 'x64', dir), /digest changed/);
});
test('ZIP extraction rejects traversal and symlink escapes before writing application files', async t => {
  const dir = await temporary(t);
  const script = `import zipfile,stat,sys,importlib.util\nfrom pathlib import Path\nspec=importlib.util.spec_from_file_location('extract',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\nroot=Path(sys.argv[2])\nfor n,name,target in [(0,'../bad',None),(1,'NextMux.app/link','../../escape'),(2,'NextMux.app/Contents/MacOS/NextMux',None)]:\n p=root/(str(n)+'.zip')\n with zipfile.ZipFile(p,'w') as z:\n  i=zipfile.ZipInfo(name);i.external_attr=((stat.S_IFLNK|0o777) if target else (stat.S_IFREG|0o755))<<16;z.writestr(i,target or 'abc')\n try:m.extract(p,root/str(n))\n except ValueError:\n  assert n<2;assert not (root/str(n)).exists()\n else:assert n==2;assert (root/str(n)/name).read_bytes()==b'abc'\n`;
  const result = spawnSync('python3', ['-c', script, new URL('scripts/extract-release-zip.py', root).pathname, dir], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
test('candidate workflow confines credentials to transfer jobs and only trusts the default branch', async () => {
  const source = await readFile(new URL('.github/workflows/desktop-candidate.yml', root), 'utf8');
  const native = source.slice(source.indexOf('  verify:'), source.indexOf('  archive:'));
  assert.doesNotMatch(native, /secrets\.|CLOUDFLARE_API_TOKEN|AWS_SECRET/);
  assert.match(source, /github\.event\.repository\.default_branch/); assert.match(source, /persist-credentials: false/);
  assert.match(source, /needs: \[download, verify\]/); assert.match(source, /nextmux-desktop-production-feed/);
  assert.match(source, /Commit verified status only after archive readback/);
});
