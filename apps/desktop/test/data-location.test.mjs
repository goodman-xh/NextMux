import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, openSync, writeSync, closeSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const location = require('../data-location.cjs');

const scratch = () => mkdtempSync(join(tmpdir(), 'nm-data-location-'));
const fakeApp = userData => { const paths = { userData }; return { paths, getPath: name => paths[name], setPath: (name, value) => { paths[name] = value; } }; };
const fakeShell = () => { const trashed = []; return { trashed, trashItem: async item => { trashed.push(item); } }; };

test('only NextMux\'s own entries move; Chromium\'s profile and Electron files stay', () => {
    for (const name of ['conversation-history-v1', 'conversation-workspaces', 'agent-checkpoints', 'catalogs', 'media-jobs', 'official-connections-v1.json', 'conversation-receipts.sqlite']) assert.ok(location.isDataEntry(name), name);
    for (const name of ['Cache', 'Local Storage', 'Cookies', 'SingletonLock', 'blob_storage', 'shared_proto_db', 'databases', 'databases-journal', 'optimization_guide_model_store', 'segmentation_platform', 'IndexedDB', 'Network', 'Partitions', 'config.json', 'window-state.json', 'app-plugins', location.POINTER, 'NextMux old data 2026']) assert.ok(!location.isDataEntry(name), name);
});

test('the data folder: portable next to the exe on Windows, a launch override, the user\'s choice, or the default', () => {
    const exe = scratch();
    const app = fakeApp(join(scratch(), 'userData'));
    const env = { PORTABLE_EXECUTABLE_DIR: exe };
    assert.deepEqual(location.resolveDataLocation({ app, env, platform: 'win32' }), { mode: 'portable', root: join(exe, 'NextMux Data', 'data') });
    assert.equal(app.paths.userData, join(exe, 'NextMux Data', 'electron'), 'Electron\'s profile travels with the program too');
    assert.equal(env.NEXTMUX_DESKTOP_STATE_DIR, join(exe, 'NextMux Data', 'data'));

    assert.deepEqual(location.resolveDataLocation({ app: fakeApp(scratch()), env: { NEXTMUX_DESKTOP_STATE_DIR: '/tmp/test-state' }, platform: 'darwin' }), { mode: 'override', root: '/tmp/test-state' });

    const userData = scratch(), custom = join(scratch(), 'D-drive NextMux');
    mkdirSync(custom);
    location.writePointer(userData, { path: custom });
    const customEnv = {};
    assert.equal(location.resolveDataLocation({ app: fakeApp(userData), env: customEnv, platform: 'darwin' }).mode, 'custom');
    assert.equal(customEnv.NEXTMUX_DESKTOP_STATE_DIR, custom);

    // A chosen folder that is missing (an unplugged drive) is reported, never recreated empty (audit DS-01).
    const offlineUserData = scratch(), offline = join(scratch(), 'Unplugged', 'NextMux');
    location.writePointer(offlineUserData, { path: offline, pending: { from: offline, to: join(scratch(), 'new') } });
    const offlineEnv = {};
    assert.deepEqual(location.resolveDataLocation({ app: fakeApp(offlineUserData), env: offlineEnv, platform: 'darwin' }), { mode: 'custom_unavailable', root: offline });
    assert.equal(existsSync(offline), false);
    assert.equal(offlineEnv.NEXTMUX_DESKTOP_STATE_DIR, undefined);

    const plain = location.resolveDataLocation({ app: fakeApp(scratch()), env: { LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }, platform: 'win32' });
    assert.equal(plain.mode, 'default');
    assert.match(plain.root, /NextMux$/);
});

test('a new folder must be absolute, empty, writable, not inside the old one, with room to spare', () => {
    const current = scratch();
    assert.equal(location.checkTarget('relative/path', current), 'not_absolute');
    assert.equal(location.checkTarget(current, current), 'same_folder');
    assert.equal(location.checkTarget(join(current, 'inside'), current), 'nested_folder');
    const full = scratch(); writeFileSync(join(full, 'someone-else.txt'), 'x');
    assert.equal(location.checkTarget(full, current), 'not_empty');
    assert.equal(location.checkTarget(join(scratch(), 'new'), current, { freeBytes: 10, neededBytes: 1_000 }), 'not_enough_space');
    assert.equal(location.checkTarget(join(scratch(), 'new'), current, { freeBytes: 10 * 1024 ** 3, neededBytes: 1_000 }), undefined);
});

test('a move copies and verifies every file, switches, and puts the old copies in the Trash as one folder', async () => {
    const from = scratch(), to = join(scratch(), 'NextMux'), userData = scratch();
    mkdirSync(join(from, 'conversation-history-v1'), { recursive: true });
    writeFileSync(join(from, 'conversation-history-v1', 'manifest-v1.json'), '{"sessions":[1,2]}');
    mkdirSync(join(from, 'conversation-workspaces', 'abc'), { recursive: true });
    writeFileSync(join(from, 'conversation-workspaces', 'abc', 'clip.mp4'), Buffer.alloc(300_000, 7));
    writeFileSync(join(from, 'official-connections-v1.json'), '[]');
    mkdirSync(join(from, 'Local Storage')); writeFileSync(join(from, 'Cookies'), 'chromium');
    location.writePointer(userData, { pending: { from, to } });
    const shell = fakeShell(), env = {}, progress = [];
    const result = await location.performPendingMove({ app: fakeApp(userData), shell, env, platform: 'darwin', onProgress: step => progress.push(step.phase) });
    assert.equal(result.ok, true);
    assert.equal(env.NEXTMUX_DESKTOP_STATE_DIR, to);
    assert.equal(readFileSync(join(to, 'conversation-history-v1', 'manifest-v1.json'), 'utf8'), '{"sessions":[1,2]}');
    assert.equal(readFileSync(join(to, 'conversation-workspaces', 'abc', 'clip.mp4')).length, 300_000);
    assert.ok(!existsSync(join(to, 'Cookies')) && !existsSync(join(to, 'Local Storage')), 'Chromium files are not copied');
    assert.deepEqual(readdirSync(from).filter(name => !name.startsWith('NextMux old data')).sort(), ['Cookies', 'Local Storage'], 'Chromium files stay where Electron expects them');
    assert.equal(shell.trashed.length, 1);
    assert.match(shell.trashed[0], /NextMux old data /);
    const pointer = location.readPointer(userData);
    assert.equal(pointer.path, to);
    assert.equal(pointer.pending, undefined);
    assert.equal(pointer.lastMove.files, 3);
    assert.ok(progress.includes('copy') && progress.includes('verify'));
});

test('a failed move keeps the old folder in use, records why, and trashes only its own half copy', async () => {
    const from = scratch(), to = join(scratch(), 'NextMux'), userData = scratch();
    mkdirSync(join(from, 'agent-checkpoints')); writeFileSync(join(from, 'agent-checkpoints', 'a.json'), 'a');
    mkdirSync(join(from, 'catalogs')); writeFileSync(join(from, 'catalogs', 'b.json'), 'b');
    mkdirSync(to, { recursive: true }); mkdirSync(join(to, 'catalogs')); // appeared after the check: the copy must stop
    location.writePointer(userData, { path: from, pending: { from, to } });
    const shell = fakeShell(), env = {};
    const result = await location.performPendingMove({ app: fakeApp(userData), shell, env, platform: 'darwin' });
    assert.equal(result.ok, false);
    assert.equal(result.root, from);
    assert.equal(env.NEXTMUX_DESKTOP_STATE_DIR, undefined);
    assert.ok(existsSync(join(from, 'agent-checkpoints', 'a.json')) && existsSync(join(from, 'catalogs', 'b.json')), 'nothing left the old folder');
    const pointer = location.readPointer(userData);
    assert.equal(pointer.path, from);
    assert.equal(pointer.pending, undefined, 'it is not retried at every launch');
    assert.ok(pointer.lastError.code);
});

test('a large file changed in its middle cannot pass verified migration', async () => {
    const base = scratch();
    try {
        const from = join(base, 'from'), to = join(base, 'to'), userData = join(base, 'userData');
        const relative = join('conversation-workspaces', 'scene.mp4');
        mkdirSync(join(from, 'conversation-workspaces'), { recursive: true });
        mkdirSync(userData);
        const source = openSync(join(from, relative), 'w');
        try {
            // The old verifier sampled only the first and last MiB above 64 MiB.
            writeSync(source, Buffer.from([0x11]), 0, 1, 0);
            writeSync(source, Buffer.from([0x22]), 0, 1, 32 * 1024 * 1024);
            writeSync(source, Buffer.from([0x33]), 0, 1, 64 * 1024 * 1024 + 1);
        } finally { closeSync(source); }
        location.writePointer(userData, { path: from, pending: { from, to } });
        const env = {};
        let changed = false;
        const result = await location.performPendingMove({ app: fakeApp(userData), shell: fakeShell(), env, platform: 'darwin', onProgress: step => {
            if (step.phase !== 'copy' || changed) return;
            const copied = openSync(join(to, relative), 'r+');
            try { writeSync(copied, Buffer.from([0x44]), 0, 1, 32 * 1024 * 1024); }
            finally { closeSync(copied); }
            changed = true;
        } });
        assert.equal(changed, true);
        assert.equal(result.ok, false, 'a different middle byte must reject migration before switching');
        assert.equal(result.error, 'verify_failed');
        assert.equal(location.readPointer(userData).path, from);
        assert.equal(env.NEXTMUX_DESKTOP_STATE_DIR, undefined);
        assert.ok(existsSync(join(from, relative)), 'the original remains available');
    } finally { rmSync(base, { recursive: true, force: true }); }
});

test('moving back to the default folder is allowed although Electron\'s own files are already there', async () => {
    const home = scratch(), custom = scratch(), userData = scratch();
    const target = location.defaultDataRoot({ platform: 'darwin', home });
    mkdirSync(target, { recursive: true }); writeFileSync(join(target, 'Cookies'), 'chromium');
    mkdirSync(join(custom, 'media-jobs')); writeFileSync(join(custom, 'media-jobs', 'job.json'), '{}');
    location.writePointer(userData, { path: custom, pending: { from: custom, to: target } });
    const result = await location.performPendingMove({ app: fakeApp(userData), shell: fakeShell(), env: {}, platform: 'darwin', home });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(existsSync(join(target, 'media-jobs', 'job.json')));
    assert.equal(location.readPointer(userData).path, undefined, 'the default needs no pointer');
});

test('an offline source is never recorded as a finished zero-file move (audit DS-01)', async () => {
    const userData = scratch(), from = join(scratch(), 'offline'), to = join(scratch(), 'new');
    location.writePointer(userData, { path: from, pending: { from, to } });
    const result = await location.performPendingMove({ app: fakeApp(userData), shell: fakeShell(), env: {}, platform: 'darwin' });
    assert.deepEqual([result.ok, result.error], [false, 'source_unavailable']);
    assert.equal(location.readPointer(userData).path, from);
    assert.equal(existsSync(from), false);
});

test('once the verified copy is in use, a failure tidying the old folder never undoes the move (audit DS-02)', async () => {
    const userData = scratch(), from = scratch(), to = join(scratch(), 'new');
    for (const name of ['agent-checkpoints', 'catalogs']) { mkdirSync(join(from, name)); writeFileSync(join(from, name, 'marker.json'), name); }
    location.writePointer(userData, { path: from, pending: { from, to } });
    const shell = fakeShell();
    let raced = false;
    const result = await location.performPendingMove({ app: fakeApp(userData), shell, env: {}, platform: 'darwin', onProgress: ({ phase, done, total }) => {
        if (!raced && phase === 'verify' && done === total) { raced = true; require('node:fs').renameSync(join(from, 'catalogs'), join(from, '.catalogs-renamed')); }
    } });
    assert.equal(result.ok, true);
    assert.equal(location.readPointer(userData).path, to);
    for (const name of ['agent-checkpoints', 'catalogs']) assert.equal(readFileSync(join(to, name, 'marker.json'), 'utf8'), name, 'the new folder holds every verified entry');
    assert.equal(readFileSync(join(from, '.catalogs-renamed', 'marker.json'), 'utf8'), 'catalogs', 'nothing of the old folder was lost');
});

test('links move only when they keep working; one that would dangle stops the move (audit DS-03)', async () => {
    const { symlinkSync, readlinkSync } = require('node:fs');
    const inside = scratch(), insideUser = scratch(), insideTo = join(scratch(), 'new');
    mkdirSync(join(inside, 'conversation-workspaces', 'app', 'node_modules', '.bin'), { recursive: true });
    writeFileSync(join(inside, 'conversation-workspaces', 'app', 'node_modules', 'tool.js'), 'tool');
    symlinkSync('../tool.js', join(inside, 'conversation-workspaces', 'app', 'node_modules', '.bin', 'tool'));
    location.writePointer(insideUser, { path: inside, pending: { from: inside, to: insideTo } });
    assert.equal((await location.performPendingMove({ app: fakeApp(insideUser), shell: fakeShell(), env: {}, platform: 'darwin' })).ok, true);
    assert.equal(readFileSync(join(insideTo, 'conversation-workspaces', 'app', 'node_modules', '.bin', 'tool'), 'utf8'), 'tool');

    const outside = scratch(), outsideUser = scratch(), outsideTo = join(scratch(), 'new');
    mkdirSync(join(outside, 'agent-checkpoints'));
    writeFileSync(join(outside, '.external-state'), 'kept');
    symlinkSync('../.external-state', join(outside, 'agent-checkpoints', 'state-link'));
    // NTFS exposes the same relative target with backslashes. Assert that the
    // refused migration preserves the actual link, rather than POSIX spelling.
    const originalTarget = readlinkSync(join(outside, 'agent-checkpoints', 'state-link'));
    location.writePointer(outsideUser, { path: outside, pending: { from: outside, to: outsideTo } });
    const refused = await location.performPendingMove({ app: fakeApp(outsideUser), shell: fakeShell(), env: {}, platform: 'darwin' });
    assert.deepEqual([refused.ok, refused.error], [false, 'unsupported_link']);
    assert.equal(location.readPointer(outsideUser).path, outside);
    assert.equal(readlinkSync(join(outside, 'agent-checkpoints', 'state-link')), originalTarget);
    assert.equal(readFileSync(join(outside, 'agent-checkpoints', 'state-link'), 'utf8'), 'kept');
});


test('portable upgrades retain both session and user data; an unavailable profile never silently changes identity', t => {
    const base = scratch(); t.after(() => rmSync(base, { recursive: true, force: true }));
    const profile = join(base, 'NextMux Data', 'electron');
    mkdirSync(profile, { recursive: true }); writeFileSync(join(profile, 'Cookies'), 'existing login');
    for (const version of ['1.0.0', '2.0.0']) {
        const app = fakeApp(join(base, 'Roaming', 'NextMux'));
        app.getVersion = () => version;
        location.resolveDataLocation({ app, env: { PORTABLE_EXECUTABLE_DIR: base }, platform: 'win32' });
        assert.equal(app.paths.userData, profile); assert.equal(app.paths.sessionData, profile);
        assert.equal(readFileSync(join(app.paths.sessionData, 'Cookies'), 'utf8'), 'existing login');
    }
    const blocked = join(base, 'blocked'); mkdirSync(join(blocked, 'NextMux Data'), { recursive: true });
    writeFileSync(join(blocked, 'NextMux Data', 'electron'), 'cannot replace this file');
    const app = fakeApp(join(base, 'original')), env = { PORTABLE_EXECUTABLE_DIR: blocked };
    assert.throws(() => location.resolveDataLocation({ app, env, platform: 'win32' }), { code: 'portable_profile_unavailable' });
    assert.equal(app.paths.userData, join(base, 'original')); assert.equal(env.NEXTMUX_DESKTOP_STATE_DIR, undefined);
});

test('a first portable launch from a read-only directory keeps the normal profile without throwing', t => {
    if (process.getuid?.() === 0) return t.skip('root bypasses directory write permissions');
    if (process.platform === 'win32') return t.skip('requires POSIX directory permissions');
    const { chmodSync, accessSync, constants } = require('node:fs');
    const base = scratch(), portable = join(base, 'portable');
    mkdirSync(portable);
    t.after(() => {
        chmodSync(portable, 0o700);
        rmSync(base, { recursive: true, force: true });
    });
    const portableRoot = join(portable, 'NextMux Data');
    const app = fakeApp(join(base, 'userData'));
    app.setPath('sessionData', join(base, 'sessionData'));
    const originalPaths = { ...app.paths };
    const env = { PORTABLE_EXECUTABLE_DIR: portable, LOCALAPPDATA: join(base, 'LocalAppData') };
    assert.equal(existsSync(portableRoot), false);
    chmodSync(portable, 0o500);
    assert.throws(() => accessSync(portable, constants.W_OK), { code: 'EACCES' });

    let resolved;
    assert.doesNotThrow(() => { resolved = location.resolveDataLocation({ app, env, platform: 'win32' }); });
    assert.notEqual(resolved.mode, 'portable');
    assert.equal(resolved.mode, 'default');
    assert.equal(resolved.root, join(env.LOCALAPPDATA, 'NextMux'));
    assert.deepEqual(app.paths, originalPaths);
    assert.equal(env.NEXTMUX_DESKTOP_STATE_DIR, undefined);
    assert.equal(existsSync(portableRoot), false);
});

test('backend data migration keeps every browser login store at the Electron profile', async t => {
    const base = scratch(); t.after(() => rmSync(base, { recursive: true, force: true }));
    const from = join(base, 'profile'), to = join(base, 'new-data'); mkdirSync(from);
    const stores = ['Cookies', 'Network', 'Local Storage', 'IndexedDB', 'Partitions', 'databases', 'blob_storage', 'shared_proto_db'];
    for (const name of stores) { mkdirSync(join(from, name)); writeFileSync(join(from, name, 'login'), name); }
    mkdirSync(join(from, 'conversations')); writeFileSync(join(from, 'conversations', 'one'), 'conversation');
    location.writePointer(from, { pending: { from, to } });
    const app = fakeApp(from), env = {};
    assert.equal((await location.performPendingMove({ app, shell: fakeShell(), env, platform: 'darwin' })).ok, true);
    assert.equal(app.paths.userData, from);
    for (const name of stores) {
        assert.equal(readFileSync(join(from, name, 'login'), 'utf8'), name);
        assert.equal(existsSync(join(to, name)), false);
    }
});


test('an unreadable verification directory aborts the migration before the pointer changes', async t => {
    const base = scratch(); t.after(() => rmSync(base, { recursive: true, force: true }));
    const from = join(base, 'from'), to = join(base, 'to'), userData = join(base, 'profile');
    mkdirSync(join(from, 'conversations'), { recursive: true });
    writeFileSync(join(from, 'conversations', 'saved'), 'must survive');
    location.writePointer(userData, { path: from, pending: { from, to } });
    const fsPromises = require('node:fs/promises'), original = fsPromises.readdir;
    let copyingComplete = false;
    fsPromises.readdir = async (...args) => {
        if (copyingComplete && args[0] === join(from, 'conversations')) throw Object.assign(new Error('unreadable'), { code: 'EACCES' });
        return original(...args);
    };
    try {
        const result = await location.performPendingMove({ app: fakeApp(userData), env: {}, shell: fakeShell(), onProgress: step => { if (step.phase === 'copy') copyingComplete = true; } });
        assert.equal(result.ok, false); assert.equal(result.error, 'EACCES');
        assert.equal(location.readPointer(userData).path, from);
        assert.equal(readFileSync(join(from, 'conversations', 'saved'), 'utf8'), 'must survive');
    } finally { fsPromises.readdir = original; }
});
