import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { withCharacterLibraryLock, replaceCharacterLibraryBundle, recoverCharacterLibrarySwaps } from '../lib/node/nextmux-character-library-swap.js';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
const fs = createRequire(import.meta.url)('node:fs/promises');
const id = 'bundle-00000000-0000-4000-8000-000000000001';
const prepare = value => async path => { await mkdir(path, { recursive: true }); await writeFile(join(path, 'bundle.json'), value); };
const validate = async path => { assert.ok(['old', 'new'].includes(await readFile(join(path, 'bundle.json'), 'utf8'))); };
const value = path => readFile(join(path, 'bundle.json'), 'utf8');
async function fixture(t) {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-character-swap-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const target = join(root, id), backup = join(root, `.backup-${id}`), staging = join(root, `.staging-${id}`);
    await prepare('old')(target);
    return { root, target, backup, staging };
}

for (const point of ['old-rename', 'new-rename', 'new-read', 'rollback-locked', 'cleanup-locked']) {
    test(`A-002 Windows file lock at ${point} preserves a complete version and startup recovery`, async t => {
        const f = await fixture(t);
        const rename = fs.rename, remove = fs.rm;
        const locked = () => Object.assign(new Error('Windows sharing violation'), { code: 'EPERM' });
        fs.rename = async (from, to) => {
            if (point === 'old-rename' && from === f.target || ['new-rename', 'rollback-locked'].includes(point) && from === f.staging
                || point === 'rollback-locked' && from === f.backup) throw locked();
            return rename(from, to);
        };
        fs.rm = async (path, options) => { if (point === 'cleanup-locked' && path === f.backup) throw locked(); return remove(path, options); };
        let validatedNew = 0;
        const check = async path => {
            await validate(path);
            if (point === 'new-read' && await value(path) === 'new' && ++validatedNew === 2) throw locked();
        };
        try {
            const operation = withCharacterLibraryLock(f.root, () => replaceCharacterLibraryBundle(f.root, id, prepare('new'), check));
            if (point === 'cleanup-locked') await operation; else await assert.rejects(operation, /sharing violation/);
        } finally { fs.rename = rename; fs.rm = remove; }
        assert.ok(await value(f.target).catch(() => '') || await value(f.backup).catch(() => ''), 'never deletes both old and new');
        await withCharacterLibraryLock(f.root, () => recoverCharacterLibrarySwaps(f.root, validate));
        assert.equal(await value(f.target), point === 'cleanup-locked' ? 'new' : 'old');
        await assert.rejects(access(f.backup), { code: 'ENOENT' });
    });
}

test('A-002 process interruption between directory renames restores old entry on first library read', async t => {
    const f = await fixture(t);
    await prepare('new')(f.staging);
    await fs.rename(f.target, f.backup); // abrupt process death; no catch/finally ran
    class Service extends NextMuxPlatformServiceImpl {
        characterLibraryRoot() { return f.root; }
        validateCharacterLibraryDirectory(path) { return validate(path); }
        async readComicCharacterLibrary() { return [{ name: await value(f.target) }]; }
    }
    assert.deepEqual(await new Service().listComicCharacterLibrary(), [{ name: 'old' }]);
});

test('A-002 concurrent bundle replacements serialize lookup through publication', async t => {
    const f = await fixture(t);
    let active = 0, peak = 0;
    await Promise.all([1, 2].map(() => withCharacterLibraryLock(f.root, async () => {
        active++; peak = Math.max(peak, active);
        await recoverCharacterLibrarySwaps(f.root, validate);
        await replaceCharacterLibraryBundle(f.root, id, prepare('new'), validate);
        active--;
    })));
    assert.equal(peak, 1); assert.equal(await value(f.target), 'new');
});

test('A-002 actual character upsert restores the independently edited library entry after commit failure', async t => {
    const f = await fixture(t);
    const workspace = join(f.root, 'comic'); await mkdir(workspace);
    class Service extends NextMuxPlatformServiceImpl { nextmuxDataRoot() { return join(f.root, 'state'); } }
    const service = new Service();
    const initial = await service.createComicProject({ workspaceRoot: workspace, title: 'Fixture', frameRate: 24,
        canvas: { aspectRatio: '16:9', width: 1920, height: 1080 }, starter: 'empty' });
    const state = await service.applyComicCommand({ workspaceRoot: workspace, command: { type: 'character.add',
        expectedRevision: initial.project.revision, character: { name: 'Project character' } } });
    const characterId = state.project.characters[0].id;
    const entry = await service.saveComicCharacterToLibrary({ workspaceRoot: workspace, characterId });
    await service.updateComicCharacterInLibrary({ bundleId: entry.bundleId, name: 'Library-only edit', description: 'Must survive a failed replacement' });
    const rename = fs.rename;
    fs.rename = async (from, to) => {
        if (String(from).endsWith(`.staging-${entry.bundleId}`)) throw Object.assign(new Error('locked'), { code: 'EPERM' });
        return rename(from, to);
    };
    try { await assert.rejects(service.saveComicCharacterToLibrary({ workspaceRoot: workspace, characterId })); }
    finally { fs.rename = rename; }
    const recovered = await new Service().listComicCharacterLibrary();
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].name, 'Library-only edit');
    assert.equal(recovered[0].description, 'Must survive a failed replacement');
});
