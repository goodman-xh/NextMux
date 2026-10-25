import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { assertCommunitySkillFiles, assertCommunitySkillRelativePath, readBoundedCommunitySkillBody, verifyCommunitySkillBlob } from '../lib/node/nextmux-community-skill-integrity.js';
import { localizeDesktopSurface } from '../lib/browser/nextmux-surface-locale.js';

const revisionA = 'a'.repeat(40);
const revisionB = 'b'.repeat(40);
const id = 'anthropic:skills/sample/SKILL.md';
const blobSha = bytes => createHash('sha1').update(`blob ${Buffer.byteLength(bytes)}\0`).update(bytes).digest('hex');
function snapshot(revision, script = 'first script', skillContent) {
    const contents = {
        'skills/sample/SKILL.md': skillContent || '---\nname: sample\ndescription: Test skill\n---\nRead the supplied reference.',
        'skills/sample/scripts/main.js': script,
    };
    const version = createHash('sha1').update(JSON.stringify(contents)).digest('hex');
    return { revision, version, contents, tree: {
        sha: createHash('sha1').update(revision).digest('hex'),
        tree: [
            { path: 'skills/sample', type: 'tree', mode: '040000', sha: version },
            ...Object.entries(contents).map(([path, bytes]) => ({ path, type: 'blob', mode: '100644', sha: blobSha(bytes), size: Buffer.byteLength(bytes) })),
        ],
    } };
}

async function fixture(t) {
    const directory = await mkdtemp(join(tmpdir(), 'nextmux-community-skill-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    class TestService extends NextMuxPlatformServiceImpl {
        snapshots = new Map([[revisionA, snapshot(revisionA)], [revisionB, snapshot(revisionB, 'changed script')]]);
        currentRevision = revisionA;
        requests = [];
        corruptPath;
        onRequest;
        communitySkillsInstallRoot() { return join(directory, 'skills'); }
        communitySkillsDataRoot() { return join(directory, 'catalog'); }
        networkFetch = async input => {
            const url = new URL(input);
            this.requests.push(url.href);
            await this.onRequest?.(url);
            if (url.host === 'api.github.com' && url.pathname.startsWith('/repos/anthropics/skills/')) {
                if (url.pathname.endsWith('/commits/main')) return Response.json({ sha: this.currentRevision });
                const revision = url.pathname.split('/').at(-1);
                if (url.pathname.includes('/git/trees/') && this.snapshots.has(revision)) return Response.json(this.snapshots.get(revision).tree);
            }
            if (url.host === 'raw.githubusercontent.com' && url.pathname.startsWith('/anthropics/skills/')) {
                const [, , , revision, ...segments] = url.pathname.split('/');
                const path = segments.map(decodeURIComponent).join('/');
                const content = this.snapshots.get(revision)?.contents[path];
                if (content !== undefined) return new Response(path === this.corruptPath ? 'tampered response' : content);
            }
            return new Response('fixture: not found', { status: 404 });
        };
    }
    const service = new TestService();
    return { directory, service, target: join(directory, 'skills', 'sample') };
}

test('catalog and fresh install pin the same immutable commit even after upstream main moves', async t => {
    const { service, target } = await fixture(t);
    const catalog = await service.getCommunitySkills(true);
    const item = catalog.skills[0];
    assert.equal(item.sourceRevision, revisionA);
    assert.equal(item.version, service.snapshots.get(revisionA).version);
    assert.match(item.homepage, new RegExp(`/tree/${revisionA}/skills/sample$`));
    service.currentRevision = revisionB;
    const requestStart = service.requests.length;
    const installed = await service.installCommunitySkill(id);
    assert.equal(installed.installed, true);
    assert.equal(await readFile(join(target, 'scripts/main.js'), 'utf8'), 'first script');
    assert.ok(service.requests.slice(requestStart).every(url => !url.includes('/main/') && !url.includes('/commits/main') && !url.includes(revisionB)));
    const manifest = JSON.parse(await readFile(join(target, '.nextmux-skill.json'), 'utf8'));
    assert.equal(manifest.sourceRevision, revisionA);
    assert.equal(manifest.version, item.version);
    assert.equal(manifest.files.length, 2);
    assert.equal(manifest.files.find(file => file.path === 'scripts/main.js').sha256, createHash('sha256').update('first script').digest('hex'));
    assert.equal(manifest.repository, 'anthropics/skills');
});

test('script-only changes create an update and a verified replacement; uninstall only removes the managed package', async t => {
    const { service, target } = await fixture(t);
    await service.installCommunitySkill(id);
    const old = service.snapshots.get(revisionA);
    const next = service.snapshots.get(revisionB);
    assert.equal(old.tree.tree[1].sha, next.tree.tree[1].sha, 'SKILL.md remains identical');
    service.currentRevision = revisionB;
    const catalog = await service.getCommunitySkills(true);
    assert.equal(catalog.skills[0].updateAvailable, true);
    await service.installCommunitySkill(id);
    assert.equal(await readFile(join(target, 'scripts/main.js'), 'utf8'), 'changed script');
    assert.deepEqual(await readdir(service.communitySkillsInstallRoot()), ['sample']);
    await service.removeCommunitySkill(id);
    assert.deepEqual(await readdir(service.communitySkillsInstallRoot()), []);
});

test('bad upstream bytes fail closed and leave the existing installation intact', async t => {
    const { service, target } = await fixture(t);
    await service.installCommunitySkill(id);
    service.currentRevision = revisionB;
    await service.getCommunitySkills(true);
    service.corruptPath = 'skills/sample/scripts/main.js';
    await assert.rejects(service.installCommunitySkill(id), error => error.domainError?.code === 'SKILL_HASH_MISMATCH');
    assert.equal(await readFile(join(target, 'scripts/main.js'), 'utf8'), 'first script');
    assert.deepEqual(await readdir(service.communitySkillsInstallRoot()), ['sample']);
    service.corruptPath = undefined;
    await service.installCommunitySkill(id);
});

test('an unmanaged directory or symbolic-link target is never replaced or removed', async t => {
    const { service, target, directory } = await fixture(t);
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'user.txt'), 'keep me');
    await assert.rejects(service.installCommunitySkill(id), error => error.code === 'SKILL_LOCATION_CONFLICT');
    assert.equal(await readFile(join(target, 'user.txt'), 'utf8'), 'keep me');
    await service.removeCommunitySkill(id);
    assert.equal(await readFile(join(target, 'user.txt'), 'utf8'), 'keep me');
    await rm(target, { recursive: true });
    const outside = join(directory, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'user.txt'), 'outside');
    await symlink(outside, target, 'junction');
    await assert.rejects(service.installCommunitySkill(id), error => error.code === 'SKILL_LOCATION_CONFLICT');
    assert.equal(await readFile(join(outside, 'user.txt'), 'utf8'), 'outside');
});

test('a symbolic-link installation root is rejected before staging', async t => {
    const { service, directory } = await fixture(t);
    const outside = join(directory, 'outside');
    await mkdir(outside);
    await symlink(outside, service.communitySkillsInstallRoot(), 'junction');
    await assert.rejects(service.installCommunitySkill(id), error => error.code === 'SKILL_LOCATION_CONFLICT');
    assert.deepEqual(await readdir(outside), []);
});

test('a failed final rename restores the previous managed directory', async t => {
    const { service, target } = await fixture(t);
    await service.installCommunitySkill(id);
    await assert.rejects(service.replaceCommunitySkillDirectory(service.communitySkillsInstallRoot(), join(service.communitySkillsInstallRoot(), 'missing-stage'), target, id), { code: 'ENOENT' });
    assert.equal(await readFile(join(target, 'scripts/main.js'), 'utf8'), 'first script');
    assert.deepEqual(await readdir(service.communitySkillsInstallRoot()), ['sample']);
});

test('a symbolic-link parent cannot create a skills folder outside the installation location', async t => {
    const { service, directory } = await fixture(t);
    const outside = join(directory, 'outside');
    const parentLink = join(directory, 'parent-link');
    await mkdir(outside);
    await symlink(outside, parentLink, 'junction');
    service.communitySkillsInstallRoot = () => join(parentLink, 'skills');
    await assert.rejects(service.installCommunitySkill(id), error => error.code === 'SKILL_LOCATION_CONFLICT');
    assert.deepEqual(await readdir(outside), []);
});

test('untrusted catalog repository and mismatched directory versions cannot redirect installation', async t => {
    const { service } = await fixture(t);
    const catalog = await service.getCommunitySkills(true);
    for (const changed of [{ repository: 'attacker/repo' }, { version: '0'.repeat(40) }, { path: '../outside/SKILL.md' }]) {
        service.communitySkillsCache = { ...catalog, skills: [{ ...catalog.skills[0], ...changed }] };
        const start = service.requests.length;
        await assert.rejects(service.installCommunitySkill(id), error => error.code === 'SKILL_SOURCE_INVALID');
        assert.ok(service.requests.slice(start).every(url => !url.includes('raw.githubusercontent.com')));
    }
});

test('truncated immutable trees fail closed rather than installing an incomplete package', async t => {
    const { service } = await fixture(t);
    await service.getCommunitySkills(true);
    service.communityTreeCache.clear();
    service.snapshots.get(revisionA).tree.truncated = true;
    await assert.rejects(service.installCommunitySkill(id), error => error.code === 'SKILL_SOURCE_INVALID' && error.data.domainError.code === 'SKILL_TREE_INCOMPLETE');
});

test('concurrent install/remove calls cannot race staging and the lock is released on completion', async t => {
    const { service } = await fixture(t);
    await service.getCommunitySkills(true);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let reached;
    const start = new Promise(resolve => { reached = resolve; });
    service.onRequest = async url => { if (url.host === 'raw.githubusercontent.com') { reached(); await gate; } };
    const first = service.installCommunitySkill(id);
    await start;
    await assert.rejects(service.installCommunitySkill(id), error => error.code === 'SKILL_OPERATION_BUSY');
    await assert.rejects(service.removeCommunitySkill(id), error => error.code === 'SKILL_OPERATION_BUSY');
    await assert.rejects(new service.constructor().installCommunitySkill(id), error => error.code === 'SKILL_OPERATION_BUSY');
    release();
    await first;
    await service.removeCommunitySkill(id);
});

test('legacy unpinned caches force a refresh and cannot install when no fixed revision is available', async t => {
    const { service } = await fixture(t);
    const catalog = await service.getCommunitySkills(true);
    service.communitySkillsCache = { ...catalog, skills: catalog.skills.map(({ sourceRevision, ...item }) => item) };
    service.currentRevision = 'not-a-commit';
    await assert.rejects(service.installCommunitySkill(id), error => error.code === 'SKILL_SOURCE_INVALID');
    await assert.rejects(readFile(join(service.communitySkillsInstallRoot(), 'sample', 'SKILL.md')), { code: 'ENOENT' });
});

test('cross-platform package paths reject traversal, Windows aliases, Git metadata and collisions', () => {
    for (const path of ['../escape', '/root', 'a//b', 'a/./b', 'a/../b', 'a\\b', 'C:stream', 'a\0b', 'a/CON.txt', 'a/nul', 'a/COM1.js', 'a/trailing.', 'a/trailing ', '.nextmux-skill.json', '.git/config']) {
        assert.throws(() => assertCommunitySkillRelativePath(path), error => error.domainError?.code === 'SKILL_PATH_UNSAFE', path);
    }
    assert.doesNotThrow(() => assertCommunitySkillRelativePath('资料/reference.md'));
    const file = path => ({ path: `skills/sample/${path}`, sha: 'c'.repeat(40), type: 'blob', mode: '100644', size: 1 });
    for (const pair of [['A.md', 'a.md'], ['é.md', 'é.md'], ['folder', 'folder/file'], ['Docs/a', 'docs/b']]) {
        assert.throws(() => assertCommunitySkillFiles(pair.map(file), 'skills/sample/'), error => ['SKILL_FILE_COLLISION', 'SKILL_DIRECTORY_COLLISION', 'SKILL_FILE_DIRECTORY_COLLISION'].includes(error.domainError?.code));
    }
    for (const fields of [{ mode: '120000' }, { type: 'commit', mode: '160000' }, { sha: 'no hash' }, { size: -1 }]) {
        assert.throws(() => assertCommunitySkillFiles([{ ...file('link'), ...fields }], 'skills/sample/'), error => error.domainError?.code === 'SKILL_FILE_IDENTITY_INVALID');
    }
});

test('unsafe package entries are rejected before any file download', async t => {
    const { service } = await fixture(t);
    await service.getCommunitySkills(true);
    const entry = { path: 'skills/sample/link', type: 'blob', sha: 'c'.repeat(40), size: 1, mode: '120000' };
    // Clear the immutable tree cache to simulate a fresh install from persisted catalog metadata.
    service.communityTreeCache.clear();
    service.snapshots.get(revisionA).tree.tree.push(entry);
    const start = service.requests.length;
    await assert.rejects(service.installCommunitySkill(id), error => error.domainError?.code === 'SKILL_FILE_IDENTITY_INVALID');
    assert.ok(service.requests.slice(start).every(url => !url.includes('raw.githubusercontent.com')));
});

test('streamed size limits cancel oversized bodies before buffering them all', async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array(4)); controller.enqueue(new Uint8Array(4)); },
        cancel() { cancelled = true; },
    }));
    await assert.rejects(readBoundedCommunitySkillBody(response, 6), error => error.domainError?.code === 'SKILL_BODY_TOO_LARGE');
    assert.equal(cancelled, true);
    await assert.rejects(readBoundedCommunitySkillBody(new Response('123', { headers: { 'content-length': '999' } }), 10), error => error.domainError?.code === 'SKILL_BODY_TOO_LARGE');
    assert.equal(Buffer.from(await readBoundedCommunitySkillBody(new Response('hello'), 5)).toString(), 'hello');
    assert.equal(verifyCommunitySkillBlob(Buffer.from('hello'), blobSha('hello')), createHash('sha256').update('hello').digest('hex'));
    assert.throws(() => verifyCommunitySkillBlob(Buffer.from('altered'), blobSha('hello')), error => error.domainError?.code === 'SKILL_HASH_MISMATCH');
});

test('the security notice is translated in all desktop locales and never claims a content audit', () => {
    const notice = '固定来源与哈希校验不等于内容安全审核；安装不会自动授权执行。';
    for (const locale of ['en', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
        assert.notEqual(localizeDesktopSurface(locale, notice), notice, locale);
    }
    assert.match(localizeDesktopSurface('en', notice), /not a content security review/);
});

const declaredSkill = tools => `---\nname: sample\ndescription: Test skill\nlicense: MIT\nallowed-tools: [${tools.join(', ')}]\nmetadata:\n  nextmux:\n    schemaVersion: 1\n    operatingSystems: [win32, darwin]\n    architectures: [x64, arm64]\n    dependencies: ['node >= 20']\n---\nDo not execute during installation.`;

test('catalog and installed manifest expose the same versioned declarations and verified source evidence', async t => {
    const { service, target } = await fixture(t);
    service.snapshots.set(revisionA, snapshot(revisionA, 'script', declaredSkill(['fs.read'])));
    const skill = (await service.getCommunitySkills(true)).skills[0];
    assert.equal(skill.metadata.license.value, 'MIT');
    assert.equal(skill.metadata.source.status, 'verified');
    assert.deepEqual(skill.metadata.compatibility.architectures.values, ['arm64', 'x64']);
    assert.equal(skill.permissionChange.state, 'not_installed');
    await service.installCommunitySkill(id);
    const manifest = JSON.parse(await readFile(join(target, '.nextmux-skill.json'), 'utf8'));
    assert.equal(manifest.schemaVersion, 1);
    assert.deepEqual(manifest.metadata, skill.metadata);
    assert.equal(manifest.metadata.source.sha256, manifest.files.find(file => file.path === 'SKILL.md').sha256);
    const current = (await service.getCommunitySkills()).skills[0];
    assert.equal(current.permissionChange.state, 'unchanged');
    assert.equal(current.permissionChange.requiresReview, false);
});

test('an expanding update requires explicit fixed-snapshot review and a failed attempt keeps the old installation', async t => {
    const { service, target } = await fixture(t);
    service.snapshots.set(revisionA, snapshot(revisionA, 'old', declaredSkill(['fs.read'])));
    service.snapshots.set(revisionB, snapshot(revisionB, 'new', declaredSkill(['fs.read', 'terminal.run'])));
    await service.installCommunitySkill(id);
    service.currentRevision = revisionB;
    const next = (await service.getCommunitySkills(true)).skills[0];
    assert.deepEqual(next.permissionChange.added, ['terminal.run']);
    await assert.rejects(service.installCommunitySkill(id), error => error.code === 'SKILL_UPDATE_REVIEW_REQUIRED');
    await assert.rejects(service.installCommunitySkill(id, { reviewToken: 'wrong', permissionChangeAcknowledged: true }), error => error.code === 'SKILL_UPDATE_REVIEW_REQUIRED');
    assert.equal(await readFile(join(target, 'scripts/main.js'), 'utf8'), 'old');
    assert.deepEqual(await readdir(service.communitySkillsInstallRoot()), ['sample']);
    await service.installCommunitySkill(id, { reviewToken: next.permissionChange.reviewToken, permissionChangeAcknowledged: true });
    assert.equal(await readFile(join(target, 'scripts/main.js'), 'utf8'), 'new');
    assert.equal((await service.getCommunitySkills()).skills[0].permissionChange.requiresReview, false);
});

test('narrowing is not an expansion, but deleting an explicit tool restriction requires review', async t => {
    const { service } = await fixture(t);
    service.snapshots.set(revisionA, snapshot(revisionA, 'old', declaredSkill(['fs.read', 'terminal.run'])));
    service.snapshots.set(revisionB, snapshot(revisionB, 'new', declaredSkill([])));
    await service.installCommunitySkill(id);
    service.currentRevision = revisionB;
    const narrow = (await service.getCommunitySkills(true)).skills[0];
    assert.equal(narrow.permissionChange.requiresReview, false);
    assert.deepEqual(narrow.permissionChange.removed, ['fs.read', 'terminal.run']);
    await service.installCommunitySkill(id);
    const revisionC = 'c'.repeat(40);
    service.snapshots.set(revisionC, snapshot(revisionC, 'inherit'));
    service.currentRevision = revisionC;
    const inherit = (await service.getCommunitySkills(true)).skills[0];
    assert.equal(inherit.permissionChange.nextMode, 'inherit');
    assert.equal(inherit.permissionChange.requiresReview, true);
    await assert.rejects(service.installCommunitySkill(id), error => error.code === 'SKILL_UPDATE_REVIEW_REQUIRED');
});

test('stale previews and modified installed bytes cannot authorize a different permission update', async t => {
    const { service, target } = await fixture(t);
    service.snapshots.set(revisionA, snapshot(revisionA, 'old', declaredSkill([])));
    service.snapshots.set(revisionB, snapshot(revisionB, 'new', declaredSkill(['terminal.run'])));
    await service.installCommunitySkill(id);
    service.currentRevision = revisionB;
    const next = (await service.getCommunitySkills(true)).skills[0];
    const review = { reviewToken: next.permissionChange.reviewToken, permissionChangeAcknowledged: true };
    await writeFile(join(target, 'SKILL.md'), declaredSkill(['fs.read']));
    await assert.rejects(service.installCommunitySkill(id, review), error => error.code === 'SKILL_UPDATE_REVIEW_REQUIRED');
    assert.equal(await readFile(join(target, 'SKILL.md'), 'utf8'), declaredSkill(['fs.read']));
    const changed = (await service.getCommunitySkills()).skills[0];
    assert.equal(changed.permissionChange.state, 'unknown');
    assert.notEqual(changed.permissionChange.reviewToken, review.reviewToken);
    await writeFile(join(target, 'SKILL.md'), declaredSkill(['fs.write']));
    await assert.rejects(service.installCommunitySkill(id, { reviewToken: changed.permissionChange.reviewToken, permissionChangeAcknowledged: true }), error => error.code === 'SKILL_UPDATE_REVIEW_REQUIRED');
});

test('legacy manifest without verified file evidence stays installable only after an explicit unknown update review', async t => {
    const { service, target } = await fixture(t);
    await service.installCommunitySkill(id);
    const manifestPath = join(target, '.nextmux-skill.json');
    const { files, metadata, ...legacy } = JSON.parse(await readFile(manifestPath, 'utf8'));
    await writeFile(manifestPath, JSON.stringify(legacy));
    service.currentRevision = revisionB;
    const next = (await service.getCommunitySkills(true)).skills[0];
    assert.equal(next.installed, true);
    assert.equal(next.permissionChange.state, 'unknown');
    await assert.rejects(service.installCommunitySkill(id), error => error.code === 'SKILL_UPDATE_REVIEW_REQUIRED');
    await service.installCommunitySkill(id, { reviewToken: next.permissionChange.reviewToken, permissionChangeAcknowledged: true });
    assert.ok(JSON.parse(await readFile(manifestPath, 'utf8')).files.length);
});

test('malformed local file evidence cannot crash the catalog or become verified update permission evidence', async t => {
    const { service, target } = await fixture(t);
    await service.installCommunitySkill(id);
    const manifestPath = join(target, '.nextmux-skill.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    for (const files of [{ invalid: true }, [null], [{ path: 'SKILL.md', sourceBlob: '*', sha256: '*' }], [manifest.files[0], manifest.files[0]]]) {
        await writeFile(manifestPath, JSON.stringify({ ...manifest, files }));
        const entry = (await service.getCommunitySkills()).skills[0];
        assert.equal(entry.installed, true);
        assert.equal(entry.permissionChange.state, 'unknown');
        assert.equal(entry.permissionChange.requiresReview, true);
    }
});

test('a manipulated cached permission projection cannot authorize the actual downloaded expansion', async t => {
    const { service, target } = await fixture(t);
    service.snapshots.set(revisionA, snapshot(revisionA, 'old', declaredSkill([])));
    service.snapshots.set(revisionB, snapshot(revisionB, 'new', declaredSkill(['terminal.run'])));
    await service.installCommunitySkill(id);
    service.currentRevision = revisionB;
    await service.getCommunitySkills(true);
    service.communitySkillsCache.skills[0].metadata.tools = { mode: 'restricted', allowedToolNames: [] };
    const manipulated = (await service.getCommunitySkills()).skills[0];
    assert.equal(manipulated.permissionChange.requiresReview, false);
    await assert.rejects(service.installCommunitySkill(id, { reviewToken: manipulated.permissionChange.reviewToken, permissionChangeAcknowledged: true }), error => error.code === 'SKILL_UPDATE_REVIEW_REQUIRED');
    assert.equal(await readFile(join(target, 'scripts/main.js'), 'utf8'), 'old');
    assert.deepEqual(await readdir(service.communitySkillsInstallRoot()), ['sample']);
});

test('a legacy pinned catalog refreshes missing metadata instead of creating an unusable unknown review token', async t => {
    const { service } = await fixture(t);
    await service.installCommunitySkill(id);
    service.currentRevision = revisionB;
    await service.getCommunitySkills(true);
    service.communitySkillsCache = { ...service.communitySkillsCache, skills: service.communitySkillsCache.skills.map(({ metadata, ...entry }) => entry) };
    const start = service.requests.length;
    const catalog = await service.getCommunitySkills();
    assert.ok(service.requests.slice(start).some(url => url.endsWith('/commits/main')));
    assert.equal(catalog.skills[0].metadata.source.status, 'verified');
    assert.equal(catalog.skills[0].permissionChange.requiresReview, false);
    await service.installCommunitySkill(id);
});

test('body-only source changes with unchanged tool scope still use the ordinary explicit update action', async t => {
    const { service, target } = await fixture(t);
    const body = declaredSkill(['fs.read']);
    service.snapshots.set(revisionA, snapshot(revisionA, 'same script', body));
    service.snapshots.set(revisionB, snapshot(revisionB, 'same script', `${body}\nUpdated reference instructions.`));
    await service.installCommunitySkill(id);
    const old = (await service.getCommunitySkills()).skills[0];
    service.currentRevision = revisionB;
    const next = (await service.getCommunitySkills(true)).skills[0];
    assert.equal(next.updateAvailable, true);
    assert.notEqual(next.metadata.source.sha256, old.metadata.source.sha256);
    assert.equal(next.permissionChange.state, 'unchanged');
    assert.equal(next.permissionChange.requiresReview, false);
    await service.installCommunitySkill(id, undefined);
    assert.match(await readFile(join(target, 'SKILL.md'), 'utf8'), /Updated reference instructions/);
});

test('partial and offline catalogs carry structured status without putting source details in the primary message', async t => {
    const { service } = await fixture(t);
    const partial = await service.getCommunitySkills(true);
    assert.equal(partial.statusMessage.code, 'SKILL_CATALOG_PARTIAL');
    assert.equal(partial.statusMessage.params.count, partial.sourceFailures.length);
    assert.ok(partial.sourceFailures.every(failure => failure.reason.code === 'GITHUB_UNAVAILABLE'));
    assert.doesNotMatch(partial.message, /GitHub|HTTP|[\u4e00-\u9fff]/);
    service.networkFetch = async () => { throw new Error('RAW NETWORK FAILURE'); };
    const offline = await service.getCommunitySkills(true);
    assert.equal(offline.statusMessage.code, 'SKILL_CATALOG_CACHED');
    assert.equal(offline.skills.length, partial.skills.length);
    assert.doesNotMatch(offline.message, /RAW NETWORK FAILURE|GitHub/);
});
