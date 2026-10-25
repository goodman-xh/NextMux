import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ConversationStore } from '../lib/node/nextmux-conversation-store.js';

const session = (id, workspacePath, pinned = false) => ({
    id, workspacePath, pinned, title: id, createdAt: 1, updatedAt: 2,
    turns: [{ id: 'turn-1', prompt: 'question', response: 'answer', createdAt: 1, stage: 'complete' }],
});
async function storeFor(t, data) {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-store-directory-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const store = new ConversationStore(root);
    await store.save(data);
    store.readFile = async (path, ...args) => {
        assert.ok(!String(path).split('/').pop().startsWith('session-'), 'directory pagination cannot hydrate unrelated bodies');
        return readFile(path, ...args);
    };
    return store;
}

test('pinned pagination binds cursor to its filter and preserves the empty workspace scope', async t => {
    const store = await storeFor(t, [
        session('a', '/project/a', true), session('b', '/project/b', true),
        session('c', '', true), session('d', ''), session('e', '/project/a'),
    ]);
    const first = await store.list({ pinned: true, limit: 1 });
    assert.equal(first.total, 3);
    assert.deepEqual(first.sessions.map(value => value.id), ['a']);
    assert.deepEqual((await store.list({ pinned: true, limit: 3, cursor: first.nextCursor })).sessions.map(value => value.id), ['b', 'c']);
    for (const options of [{}, { pinned: false }, { pinned: true, workspacePath: '' }]) {
        await assert.rejects(() => store.list({ ...options, cursor: first.nextCursor }), error => error.domainError?.params.reason === 'store_conversation_cursor_invalid');
    }
    const unbound = await store.list({ workspacePath: '', limit: 1 });
    assert.equal(unbound.total, 2);
    assert.deepEqual(unbound.sessions.map(value => value.id), ['c']);
    assert.deepEqual((await store.list({ workspacePath: '', cursor: unbound.nextCursor })).sessions.map(value => value.id), ['d']);
    await assert.rejects(() => store.list({ cursor: unbound.nextCursor }), error => error.domainError?.params.reason === 'store_conversation_cursor_invalid');
    assert.equal((await store.list()).total, 5);
    assert.equal((await store.list({ pinned: false })).total, 2);
    await assert.rejects(() => store.list({ pinned: 'true' }), error => error.domainError?.params.reason === 'store_pinned_filter_invalid');
});

test('project directory paginates equal-time projects without loading conversation bodies', async t => {
    const store = await storeFor(t, [
        ...Array.from({ length: 7 }, (_, index) => session(`project-${index}`, `/project/${index}`)),
        session('second-in-first-project', '/project/0'), session('unbound', ''),
    ]);
    const projects = [];
    let cursor;
    let firstCursor;
    do {
        const page = await store.listProjects({ limit: 2, cursor });
        assert.equal(page.total, 7);
        assert.equal(page.status, 'ok');
        projects.push(...page.projects);
        cursor = page.nextCursor;
        firstCursor ||= cursor;
    } while (cursor);
    assert.deepEqual(projects.map(value => value.workspacePath), Array.from({ length: 7 }, (_, index) => `/project/${index}`));
    assert.equal(projects[0].conversationCount, 2);
    assert.equal(projects[0].latestUpdatedAt, 2);
    assert.ok(projects.slice(1).every(value => value.conversationCount === 1));
    await assert.rejects(() => store.list({ cursor: firstCursor }), error => error.domainError?.params.reason === 'store_conversation_cursor_invalid');
    const conversationCursor = (await store.list({ limit: 1 })).nextCursor;
    await assert.rejects(() => store.listProjects({ cursor: conversationCursor }), error => error.domainError?.params.reason === 'store_project_cursor_invalid');
    await assert.rejects(() => store.listProjects({ cursor: 'not-json' }), error => error.domainError?.params.reason === 'store_project_cursor_invalid');
});
