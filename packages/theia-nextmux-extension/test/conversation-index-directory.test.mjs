import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Execute current source without rebuilding or replacing the running desktop's lib/ files.
const require = createRequire(import.meta.url);
const desktopRequire = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const { outputFiles } = desktopRequire('esbuild').buildSync({
    entryPoints: [fileURLToPath(new URL('../src/node/nextmux-conversation-index.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent'
});
const module = { exports: {} };
Function('require', 'module', 'exports', outputFiles[0].text)(require, module, module.exports);
const { ConversationIndex } = module.exports;

const session = (id, workspacePath, updatedAt, pinned = false) => ({
    id, workspacePath, title: `Title ${id}`, createdAt: 1, updatedAt, pinned,
    turns: [{ id: `${id}-turn`, prompt: 'prompt', response: 'response', createdAt: 1, stage: 'complete' }]
});

async function fixture(t) {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-directory-'));
    const index = new ConversationIndex(join(root, 'index.sqlite'));
    t.after(async () => { index.close(); await rm(root, { recursive: true, force: true }); });
    return { root, index };
}

test('project and pinned discovery reaches old history outside the newest 500 without body files', async t => {
    const { root, index } = await fixture(t);
    index.begin(true);
    for (let i = 0; i < 50_000; i++) index.upsert(session(`new-${String(i).padStart(5, '0')}`, '/active', 100 + i));
    index.upsert(session('old-pinned', '/old-project', 4, true));
    index.upsert(session('old-recent', '', 3));
    index.upsert(session('old-pinned-unbound', '', 2, true));
    const legacy = session('legacy-pin-absent', '/old-project', 1);
    delete legacy.pinned;
    index.upsert(legacy);
    index.commit('test');

    assert.equal(index.list({ limit: 500 }).sessions.every(row => row.workspacePath === '/active'), true);
    assert.deepEqual(index.projects({ limit: 100 }).projects, [
        { workspacePath: '/active', conversationCount: 50_000, latestUpdatedAt: 50_099 },
        { workspacePath: '/old-project', conversationCount: 2, latestUpdatedAt: 4 }
    ]);
    const pinned = index.list({ pinned: true, limit: 100 });
    assert.deepEqual(pinned.sessions.map(row => row.id), ['old-pinned', 'old-pinned-unbound']);
    assert.equal(pinned.total, 2);
    const recent = index.list({ workspacePath: '', pinned: false, limit: 100 });
    assert.deepEqual(recent.sessions.map(row => row.id), ['old-recent']);
    assert.equal(recent.total, 1);
    assert.equal(index.list({ workspacePath: '/old-project', pinned: false, limit: 100 }).total, 1);
    assert.ok(pinned.sessions.every(row => row.historyLoaded === false && row.turns.length === 0));
    const sqliteFiles = (await readdir(root)).filter(name => !name.endsWith('-wal') && !name.endsWith('-shm'));
    assert.deepEqual(sqliteFiles, ['index.sqlite'], 'all discovery data came from SQLite; no JSON bodies exist');
});

test('project directory keyset pages equal timestamps without overlap and excludes the unbound group', async t => {
    const { index } = await fixture(t);
    index.begin(true);
    for (let i = 0; i < 31; i++) {
        const workspacePath = `/project/${String(i).padStart(2, '0')}`;
        index.upsert(session(`p-${i}-older`, workspacePath, 1));
        index.upsert(session(`p-${i}`, workspacePath, 10 + Math.floor(i / 3)));
    }
    index.upsert(session('unbound', '', 999));
    index.commit('directory');
    const seen = new Set();
    let after;
    do {
        const page = index.projects({ limit: 4, after });
        assert.equal(page.total, 31);
        for (const project of page.projects) {
            assert.equal(project.conversationCount, 2);
            assert.ok(!seen.has(project.workspacePath));
            seen.add(project.workspacePath);
        }
        after = page.hasMore ? page.projects.at(-1) : undefined;
    } while (after);
    assert.equal(seen.size, 31);
});

test('pinned keyset pages retain their scope through equal timestamps and pin changes', async t => {
    const { index } = await fixture(t);
    index.begin(true);
    for (const id of ['a', 'b', 'c', 'd', 'e']) index.upsert(session(id, '/one', 10, true));
    index.upsert(session('unbound-pinned', '', 1, true));
    index.upsert(session('not-pinned', '/one', 20));
    index.commit('pinned');
    const first = index.list({ pinned: true, workspacePath: '/one', limit: 2 });
    assert.deepEqual(first.sessions.map(row => row.id), ['a', 'b']);
    index.begin();
    index.upsert(session('a', '/one', 10, false));
    index.remove('b');
    index.commit('updated');
    const next = index.list({ pinned: true, workspacePath: '/one', limit: 2, after: { updatedAt: 10, id: 'b' } });
    assert.deepEqual(next.sessions.map(row => row.id), ['c', 'd']);
    assert.equal(next.total, 3);
    assert.equal(next.hasMore, true);
    const last = index.list({ pinned: true, workspacePath: '/one', limit: 2, after: { updatedAt: 10, id: 'd' } });
    assert.deepEqual(last.sessions.map(row => row.id), ['e']);
    assert.equal(last.hasMore, false);
});
