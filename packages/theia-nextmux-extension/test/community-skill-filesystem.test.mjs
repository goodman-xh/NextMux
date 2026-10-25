import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { COMMUNITY_SKILL_TEMP_MAX_AGE_MS, communitySkillPathInside, communitySkillPathKey,
    removeCommunitySkillTemp, renameCommunitySkillDirectory } from '../lib/node/nextmux-community-skill-filesystem.js';
import { assertCommunitySkillRelativePath } from '../lib/node/nextmux-community-skill-integrity.js';

// In-memory pinned Git blobs exercise the real installer with real, isolated filesystem operations.
const id = 'anthropic:skills/sample/SKILL.md';
const sourceRevision = 'a'.repeat(40);
const version = 'b'.repeat(40);
const skillBody = '---\nname: sample\ndescription: Filesystem fixture\n---\nUse the reference.';
const sha = bytes => createHash('sha1').update(`blob ${Buffer.byteLength(bytes)}\0`).update(bytes).digest('hex');

async function fixture(t) {
    const directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'nextmux-skill-filesystem-')));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    class Service extends NextMuxPlatformServiceImpl {
        contents = { 'SKILL.md': skillBody, 'scripts/main.js': 'complete script' };
        skill = { id, sourceId: 'anthropic', repository: 'anthropics/skills', path: 'skills/sample/SKILL.md',
            name: 'sample', description: 'Filesystem fixture', sourceRevision, version };
        communitySkillsInstallRoot() { return join(directory, 'skills'); }
        async getCommunitySkills() { return { skills: [this.skill] }; }
        async fetchCommunityTree() {
            return { tree: [{ path: 'skills/sample', type: 'tree', sha: version },
                ...Object.entries(this.contents).map(([path, content]) => ({ path: `skills/sample/${path}`, type: 'blob',
                    mode: '100644', sha: sha(content), size: Buffer.byteLength(content) }))] };
        }
        async downloadCommunitySkillFile(_source, file) {
            await this.beforeDownload?.(file);
            return Buffer.from(this.contents[file.path.slice('skills/sample/'.length)]);
        }
    }
    const service = new Service();
    const root = service.communitySkillsInstallRoot();
    return { service, directory, root, target: join(root, 'sample') };
}

const missing = path => assert.rejects(fs.lstat(path), { code: 'ENOENT' });
const age = async path => {
    const old = new Date(Date.now() - COMMUNITY_SKILL_TEMP_MAX_AGE_MS - 60_000);
    await fs.utimes(path, old, old);
};

test('path boundaries handle POSIX, Windows drive letters, slash variants, case and UNC shares', () => {
    for (const [paths, root, candidate, inside] of [
        [posix, '/skills', '/skills/sample/SKILL.md', true],
        [posix, '/', '/skills/sample', true],
        [posix, '/skills', '/skills-other/sample', false],
        [posix, '/skills', '/skills/../outside', false],
        [posix, '/skills', '/Skills/sample', false],
        [posix, '/skills', '/skills', false],
        [win32, 'C:\\Users\\Test\\Skills', 'c:/users/test/skills/sample/SKILL.md', true],
        [win32, 'C:\\', 'c:\\skills\\sample', true],
        [win32, 'C:\\skills', 'D:\\skills\\sample', false],
        [win32, 'C:\\skills', 'c:\\skills-other\\sample', false],
        [win32, 'C:\\skills', 'C:\\skills\\..\\outside', false],
        [win32, 'C:\\skills', 'c:\\SKILLS', false],
        [win32, '\\\\Server\\Share\\skills', '\\\\server\\share\\SKILLS\\sample', true],
        [win32, '\\\\server\\share\\skills', '\\\\server\\other\\skills\\sample', false],
        [win32, '\\\\server\\share\\skills', '\\\\other\\share\\skills\\sample', false],
        [win32, '\\\\?\\C:\\skills', '\\\\?\\c:\\skills\\sample', true],
    ]) assert.equal(communitySkillPathInside(root, candidate, paths), inside, `${root} -> ${candidate}`);
    assert.equal(communitySkillPathKey('C:/Users/TEST/skills/', win32), communitySkillPathKey('c:\\users\\test\\skills', win32));
    assert.notEqual(communitySkillPathKey('/Skills', posix), communitySkillPathKey('/skills', posix));
});

test('portable package paths reject traversal, drive-relative paths, UNC, ADS and Windows devices', () => {
    for (const value of ['../outside', 'a/../../outside', 'C:escape', 'C:/escape', 'C:\\escape', '\\\\server\\share\\x',
        'a\\..\\b', 'a:stream', 'CONIN$', 'conout$.txt', 'COM¹.txt', 'lpt²', 'LPT³.log', 'a/trailing.', 'a/trailing ']) {
        assert.throws(() => assertCommunitySkillRelativePath(value), error => error.domainError?.code === 'SKILL_PATH_UNSAFE', value);
    }
    assert.doesNotThrow(() => assertCommunitySkillRelativePath('参考/scripts/run.sh'));
});

test('fresh and updated installs publish complete directories and remove every staging/backup directory', async t => {
    const { service, root, target } = await fixture(t);
    let downloads = 0;
    service.beforeDownload = async () => { downloads++; await missing(target); };
    assert.equal((await service.installCommunitySkill(id)).location, target);
    assert.equal(downloads, 2);
    assert.equal(await fs.readFile(join(target, 'scripts/main.js'), 'utf8'), 'complete script');
    service.contents['scripts/main.js'] = 'updated script';
    service.beforeDownload = async () => assert.equal(await fs.readFile(join(target, 'scripts/main.js'), 'utf8'), 'complete script');
    await service.installCommunitySkill(id);
    assert.equal(await fs.readFile(join(target, 'scripts/main.js'), 'utf8'), 'updated script');
    assert.deepEqual(await fs.readdir(root), ['sample']);
});

for (const name of ['AbortError', 'TimeoutError', 'Error']) {
    test(`${name} after a partial download cleans staging, preserves the old skill and releases the mutation lock`, async t => {
        const { service, root, target } = await fixture(t);
        await service.installCommunitySkill(id);
        const failure = name === 'Error' ? new Error('download failed') : new DOMException('download interrupted', name);
        service.beforeDownload = async file => { if (file.path.endsWith('.js')) throw failure; };
        await assert.rejects(service.installCommunitySkill(id), error => error === failure);
        assert.deepEqual(await fs.readdir(root), ['sample']);
        assert.equal(await fs.readFile(join(target, 'scripts/main.js'), 'utf8'), 'complete script');
        service.beforeDownload = undefined;
        await service.installCommunitySkill(id);
    });
}

test('metadata and permission review rejection clean staging without publishing a partial skill', async t => {
    const { service, root, target } = await fixture(t);
    service.contents['SKILL.md'] = skillBody.replace('name: sample', 'name: mismatch');
    await assert.rejects(service.installCommunitySkill(id), error => error.code === 'SKILL_SOURCE_INVALID');
    await missing(target);
    assert.deepEqual(await fs.readdir(root), []);
    service.contents['SKILL.md'] = skillBody;
    await assert.rejects(service.installCommunitySkill(id, { reviewToken: 'stale', permissionChangeAcknowledged: true }),
        error => error.code === 'SKILL_UPDATE_REVIEW_STALE');
    assert.deepEqual(await fs.readdir(root), []);
});

test('stale cleanup only removes old recognized staging directories, including after validation rejection', async t => {
    const { service, root, directory } = await fixture(t);
    await fs.mkdir(root);
    const stale = join(root, `.nextmux-install-${randomUUID()}`);
    const fresh = join(root, '.nextmux-install-ABC123');
    const unknown = join(root, '.nextmux-install-user-data');
    const outside = join(directory, 'outside');
    const link = join(root, `.nextmux-install-${randomUUID()}`);
    for (const path of [stale, fresh, unknown, outside]) await fs.mkdir(path);
    await fs.writeFile(join(outside, 'keep'), 'outside');
    await fs.symlink(outside, link, 'junction');
    await fs.symlink(outside, join(stale, 'escape'), 'junction');
    await age(stale);
    await age(unknown);
    // A listing must not mutate storage or race another installer.
    await service.readInstalledCommunitySkills();
    await fs.lstat(stale);
    await assert.rejects(service.installCommunitySkill('invalid'), error => error.code === 'INVALID_SKILL_ID');
    await missing(stale);
    for (const path of [fresh, unknown, link]) await fs.lstat(path);
    assert.equal(await fs.readFile(join(outside, 'keep'), 'utf8'), 'outside');
});

test('cleanup rejects a linked root and cannot delete a sibling or outside directory', async t => {
    const { service, root, directory } = await fixture(t);
    const outside = join(directory, 'outside');
    await fs.mkdir(outside);
    const stale = join(outside, `.nextmux-install-${randomUUID()}`);
    await fs.mkdir(stale);
    await age(stale);
    await fs.symlink(outside, root, 'junction');
    await service.cleanupStaleCommunitySkillTempDirs(root);
    await fs.lstat(stale);
    await assert.rejects(removeCommunitySkillTemp(root, stale), error => error.domainError?.code === 'SKILL_PATH_ESCAPE');
    await fs.lstat(stale);
});

test('a missing parent beneath a symlink is rejected before any directory creation', async t => {
    const { service, directory } = await fixture(t);
    const outside = join(directory, 'outside');
    const link = join(directory, 'link');
    await fs.mkdir(outside);
    await fs.symlink(outside, link, 'junction');
    service.communitySkillsInstallRoot = () => join(link, 'missing', 'skills');
    await assert.rejects(service.installCommunitySkill(id), error => error.code === 'SKILL_LOCATION_CONFLICT');
    assert.deepEqual(await fs.readdir(outside), []);
});

for (const injection of ['directory', 'file', 'hardlink', 'commit']) {
    test(`rejects an injected ${injection} link without writing outside staging or publishing it`, async t => {
        const { service, root, directory, target } = await fixture(t);
        const outside = join(directory, 'outside');
        await fs.mkdir(outside);
        await fs.writeFile(join(outside, 'keep'), 'untouched');
        service.beforeDownload = async file => {
            if (!file.path.endsWith('.js')) return;
            const stage = join(root, (await fs.readdir(root)).find(name => name.startsWith('.nextmux-install-')));
            if (injection === 'directory') await fs.symlink(outside, join(stage, 'scripts'), 'junction');
            if (injection === 'file') {
                await fs.mkdir(join(stage, 'scripts'));
                await fs.symlink(join(outside, 'keep'), join(stage, 'scripts/main.js'));
            }
            if (injection === 'hardlink') await fs.link(join(outside, 'keep'), join(stage, 'extra'));
            if (injection === 'commit') await fs.symlink(outside, join(stage, 'extra'), 'junction');
        };
        await assert.rejects(service.installCommunitySkill(id));
        assert.equal(await fs.readFile(join(outside, 'keep'), 'utf8'), 'untouched');
        assert.deepEqual(await fs.readdir(outside), ['keep']);
        assert.deepEqual(await fs.readdir(root), []);
        await missing(target);
    });
}

for (const code of ['EXDEV', 'EPERM', 'EACCES', 'EBUSY']) {
    test(`publication rejects ${code} without falling back to a visible partial copy`, async t => {
        const { directory } = await fixture(t);
        const from = join(directory, 'stage');
        const to = join(directory, 'published');
        await fs.mkdir(from);
        await fs.writeFile(join(from, 'SKILL.md'), skillBody);
        let attempts = 0;
        t.mock.method(fs, 'rename', async () => { attempts++; throw Object.assign(new Error(code), { code }); });
        await assert.rejects(renameCommunitySkillDirectory(from, to), { code });
        assert.equal(attempts, code === 'EXDEV' ? 1 : 4);
        await missing(to);
        assert.equal(await fs.readFile(join(from, 'SKILL.md'), 'utf8'), skillBody);
    });
}

test('a transient Windows sharing violation retries the atomic rename', async t => {
    const { directory } = await fixture(t);
    const from = join(directory, 'stage');
    const to = join(directory, 'published');
    await fs.mkdir(from);
    const rename = fs.rename;
    let attempts = 0;
    t.mock.method(fs, 'rename', async (...args) => {
        if (++attempts === 1) throw Object.assign(new Error('locked'), { code: 'EBUSY' });
        return rename(...args);
    });
    await renameCommunitySkillDirectory(from, to);
    assert.equal(attempts, 2);
    await missing(from);
    assert.equal((await fs.lstat(to)).isDirectory(), true);
});

for (const occupied of [false, true]) {
    test(`failed update ${occupied ? 'preserves a concurrently occupied target and recovery backup' : 'restores the previous skill'}`, async t => {
        const { service, root, target } = await fixture(t);
        await service.installCommunitySkill(id);
        service.contents['scripts/main.js'] = 'new script';
        const rename = fs.rename;
        t.mock.method(fs, 'rename', async (from, to) => {
            if (from.includes('.nextmux-install-') && to === target) {
                if (occupied) {
                    await fs.mkdir(target);
                    await fs.writeFile(join(target, 'user.txt'), 'keep');
                }
                throw Object.assign(new Error('publication failed'), { code: 'EIO' });
            }
            return rename(from, to);
        });
        await assert.rejects(service.installCommunitySkill(id), { code: 'EIO' });
        const names = await fs.readdir(root);
        assert.equal(names.some(name => name.startsWith('.nextmux-install-')), false);
        if (occupied) {
            assert.equal(await fs.readFile(join(target, 'user.txt'), 'utf8'), 'keep');
            const backup = join(root, names.find(name => name.startsWith('.nextmux-backup-')));
            await age(backup);
            await service.cleanupStaleCommunitySkillTempDirs(root);
            assert.equal(await fs.readFile(join(backup, 'scripts/main.js'), 'utf8'), 'complete script');
        } else {
            assert.deepEqual(names, ['sample']);
            assert.equal(await fs.readFile(join(target, 'scripts/main.js'), 'utf8'), 'complete script');
        }
    });
}

test('old verified backups recover absent targets and are removed only beside a verified installation of the same skill', async t => {
    const { service, root, target } = await fixture(t);
    await service.installCommunitySkill(id);
    const backup = join(root, `.nextmux-backup-sample--${randomUUID()}`);
    await fs.rename(target, backup);
    await age(backup);
    await service.cleanupStaleCommunitySkillTempDirs(root);
    await missing(backup);
    assert.equal(await fs.readFile(join(target, 'scripts/main.js'), 'utf8'), 'complete script');
    await fs.cp(target, backup, { recursive: true });
    await age(backup);
    // Even a manifest plus SKILL.md is insufficient proof of a complete older copy-fallback install.
    await fs.rm(join(target, 'scripts/main.js'));
    await service.cleanupStaleCommunitySkillTempDirs(root);
    await fs.lstat(backup);
    await fs.writeFile(join(target, 'scripts/main.js'), 'complete script');
    await service.cleanupStaleCommunitySkillTempDirs(root);
    await missing(backup);
});

for (const mutation of ['changed', 'extra']) {
    test(`publication rejects ${mutation} staging bytes after download verification`, async t => {
        const { service, root, target } = await fixture(t);
        await service.installCommunitySkill(id);
        service.beforeDownload = async file => {
            if (!file.path.endsWith('.js')) return;
            const stage = join(root, (await fs.readdir(root)).find(name => name.startsWith('.nextmux-install-')));
            await fs.writeFile(join(stage, mutation === 'changed' ? 'SKILL.md' : 'unverified.js'),
                mutation === 'changed' ? skillBody.replace('Use the reference.', 'Unverified instructions.') : 'unverified script');
        };
        await assert.rejects(service.installCommunitySkill(id), error => error.domainError?.code === 'SKILL_HASH_MISMATCH');
        assert.deepEqual(await fs.readdir(root), ['sample']);
        assert.equal(await fs.readFile(join(target, 'SKILL.md'), 'utf8'), skillBody);
    });
}

test('cleanup refuses a canonical root whose higher ancestor was replaced by a junction', async t => {
    const { directory } = await fixture(t);
    const ancestor = join(directory, 'ancestor');
    const root = join(ancestor, 'parent', 'skills');
    const outside = join(directory, 'outside');
    const name = `.nextmux-install-${randomUUID()}`;
    await fs.mkdir(join(root, name), { recursive: true });
    await fs.mkdir(join(outside, 'parent', 'skills', name), { recursive: true });
    await fs.writeFile(join(outside, 'parent', 'skills', name, 'keep'), 'outside');
    await fs.rename(ancestor, join(directory, 'original'));
    await fs.symlink(outside, ancestor, 'junction');
    await assert.rejects(removeCommunitySkillTemp(root, join(root, name)),
        error => error.domainError?.code === 'SKILL_INSTALL_PATH_UNSAFE');
    await assert.rejects(renameCommunitySkillDirectory(join(root, name), join(root, 'visible')),
        error => error.domainError?.code === 'SKILL_INSTALL_PATH_UNSAFE');
    assert.equal(await fs.readFile(join(outside, 'parent', 'skills', name, 'keep'), 'utf8'), 'outside');
});

test('a manifest write failure cleans all staging and leaves no visible skill', async t => {
    const { service, root, target } = await fixture(t);
    const write = fs.writeFile;
    t.mock.method(fs, 'writeFile', async (path, ...args) => {
        if (path.endsWith('.nextmux-skill.json')) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
        return write(path, ...args);
    });
    await assert.rejects(service.installCommunitySkill(id), { code: 'ENOSPC' });
    assert.deepEqual(await fs.readdir(root), []);
    await missing(target);
});

test('an ancestor replacement during a rename retry cannot publish outside the pinned root', async t => {
    const { directory } = await fixture(t);
    const root = join(directory, 'parent');
    const outside = join(directory, 'outside');
    await fs.mkdir(join(root, 'stage'), { recursive: true });
    await fs.mkdir(join(outside, 'stage'), { recursive: true });
    await fs.writeFile(join(outside, 'stage', 'keep'), 'outside');
    const rename = fs.rename;
    let attempts = 0;
    t.mock.method(fs, 'rename', async () => {
        attempts++;
        await rename(root, join(directory, 'original'));
        await fs.symlink(outside, root, 'junction');
        throw Object.assign(new Error('busy'), { code: 'EBUSY' });
    });
    await assert.rejects(renameCommunitySkillDirectory(join(root, 'stage'), join(root, 'published')),
        error => error.domainError?.code === 'SKILL_INSTALL_PATH_UNSAFE');
    assert.equal(attempts, 1);
    assert.equal(await fs.readFile(join(outside, 'stage', 'keep'), 'utf8'), 'outside');
    await missing(join(outside, 'published'));
});

test('staging creation failure releases the lock and a later install can proceed', async t => {
    const { service, root } = await fixture(t);
    const create = fs.mkdtemp;
    const mock = t.mock.method(fs, 'mkdtemp', async () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); });
    await assert.rejects(service.installCommunitySkill(id), { code: 'ENOSPC' });
    assert.deepEqual(await fs.readdir(root), []);
    mock.mock.restore();
    assert.equal(fs.mkdtemp, create);
    await service.installCommunitySkill(id);
    assert.deepEqual(await fs.readdir(root), ['sample']);
});

test('cleanup uses the normalized direct child instead of following a link before dot-dot', async t => {
    const { directory, root } = await fixture(t);
    const outside = join(directory, 'outside');
    const name = `.nextmux-install-${randomUUID()}`;
    await fs.mkdir(join(root, name), { recursive: true });
    await fs.mkdir(join(outside, 'nested'), { recursive: true });
    await fs.mkdir(join(outside, name));
    await fs.writeFile(join(outside, name, 'keep'), 'outside');
    await fs.symlink(join(outside, 'nested'), join(root, 'link'), 'junction');
    // Keep the literal '..' here: path.join would normalize away the attack before the helper sees it.
    await removeCommunitySkillTemp(root, `${root}/link/../${name}`);
    await missing(join(root, name));
    assert.equal(await fs.readFile(join(outside, name, 'keep'), 'utf8'), 'outside');
});

test('a trusted home alias keeps the returned installation path usable by the remove action', async t => {
    const { service, directory } = await fixture(t);
    const home = join(directory, 'home');
    const alias = join(directory, 'alias');
    await fs.mkdir(join(home, '.agents'), { recursive: true });
    await fs.symlink(home, alias, 'junction');
    service.communitySkillsInstallRoot = () => join(alias, '.agents', 'skills');
    const installed = await service.installCommunitySkill(id);
    assert.equal(installed.location, join(alias, '.agents', 'skills', 'sample'));
    assert.equal(await fs.readFile(join(home, '.agents', 'skills', 'sample', 'SKILL.md'), 'utf8'), skillBody);
    assert.deepEqual(await service.removeInstalledSkill(join(installed.location, 'SKILL.md')), { removed: true });
    await missing(join(home, '.agents', 'skills', 'sample'));
});
