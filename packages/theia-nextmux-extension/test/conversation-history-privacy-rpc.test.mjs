import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

const makeSession = id => ({ id, title: 'isolated privacy fixture', workspacePath: '', createdAt: 1, updatedAt: 2, turns: [] });
const first = makeSession('00000000-0000-4000-8000-000000000511');
const second = makeSession('00000000-0000-4000-8000-000000000512');
const third = makeSession('00000000-0000-4000-8000-000000000513');
const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

class IsolatedService extends NextMuxPlatformServiceImpl {
    constructor(root) { super(); this.root = root; }
    nextmuxDataRoot() { return this.root; }
    conversationStore() {
        const store = super.conversationStore();
        if (!this.patchGate && !this.clearGate) return store;
        return new Proxy(store, { get: (target, name) => name === 'patch' && this.patchGate
            ? async (...args) => { this.patchGate.entered.resolve(); await this.patchGate.release.promise; return target.patch(...args); }
            : name === 'clear' && this.clearGate
                ? async (...args) => { this.clearGate.entered.resolve(); return target.clear(...args); }
                : Reflect.get(target, name) });
    }
    async writePrivacySettings(value) {
        if (this.privacyGate) { this.privacyGate.entered.resolve(); await this.privacyGate.release.promise; }
        return super.writePrivacySettings(value);
    }
}

async function fixture(t) {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'nextmux-history-privacy-')));
    t.after(() => rm(root, { recursive: true, force: true }));
    return { a: new IsolatedService(root), b: new IsolatedService(root) };
}
const setHistory = async (service, enabled) => service.savePrivacySettings({
    ...(await service.getPrivacySettings()), saveConversationHistory: enabled
});
const sessionIds = async service => (await service.loadConversationHistory()).sessions.map(item => item.id);
const afterDelay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('normal history is mandatory even for old clients sending false; explicit deletion remains available', async t => {
    const { a, b } = await fixture(t);
    await a.saveConversationHistory([first]);
    assert.equal((await setHistory(b, false)).saveConversationHistory, true);
    await a.saveConversationHistory([first, second]);
    await a.patchConversationHistory({ upserts: [third], removedSessionIds: [first.id] });
    assert.deepEqual((await sessionIds(b)).sort(), [second.id, third.id].sort());
    await a.saveConversationHistory([]);
    assert.deepEqual(await sessionIds(b), [], 'empty full snapshot remains an explicit destructive clear');
});

test('legacy false settings remain serialized behind an in-flight normal history write', async t => {
    const { a, b } = await fixture(t);
    a.patchGate = { entered: deferred(), release: deferred() };
    const writing = a.patchConversationHistory({ upserts: [first], removedSessionIds: [] });
    await a.patchGate.entered.promise;
    const disabling = setHistory(b, false);
    let settled = false;
    void disabling.then(() => { settled = true; }, () => { settled = true; });
    await nextTurn();
    try {
        assert.equal(settled, false, 'disable must not return before the earlier write is durable');
    } catch (error) {
        a.patchGate.release.resolve();
        await Promise.allSettled([writing, disabling]);
        throw error;
    }
    a.patchGate.release.resolve();
    await writing;
    assert.equal((await disabling).saveConversationHistory, true);
    assert.deepEqual(await sessionIds(b), [first.id]);
    a.patchGate = undefined;
    await a.patchConversationHistory({ upserts: [second], removedSessionIds: [] });
    assert.deepEqual((await sessionIds(b)).sort(), [first.id, second.id].sort());
});

test('a queued normal history write succeeds after another window submits legacy false', async t => {
    const { a, b } = await fixture(t);
    b.privacyGate = { entered: deferred(), release: deferred() };
    const disabling = setHistory(b, false);
    await b.privacyGate.entered.promise;
    const writing = a.patchConversationHistory({ upserts: [first], removedSessionIds: [] });
    let settled = false;
    void writing.then(() => { settled = true; }, () => { settled = true; });
    await nextTurn();
    try {
        assert.equal(settled, false, 'new writer must wait for the preference commit');
    } catch (error) {
        b.privacyGate.release.resolve();
        await Promise.allSettled([writing, disabling]);
        throw error;
    }
    b.privacyGate.release.resolve();
    await disabling;
    await writing;
    assert.deepEqual(await sessionIds(b), [first.id]);
});

for (const [name, clear] of [
    ['local-data conversation history clear', service => service.clearDesktopLocalData({ workspaceRoot: '', categories: ['conversation_history'] })],
    ['legacy conversation history clear', service => service.clearConversationHistory()]
]) {
    test(`${name} waits for an already accepted history write before deleting`, async t => {
        const { a, b } = await fixture(t);
        a.patchGate = { entered: deferred(), release: deferred() };
        b.clearGate = { entered: deferred() };
        const writing = a.patchConversationHistory({ upserts: [first], removedSessionIds: [] });
        await a.patchGate.entered.promise;
        const clearing = clear(b);
        try {
            const reachedClear = await Promise.race([
                b.clearGate.entered.promise.then(() => true), afterDelay(250).then(() => false)
            ]);
            assert.equal(reachedClear, false, 'deletion must wait for the earlier accepted write');
        } finally {
            a.patchGate.release.resolve();
            await Promise.allSettled([writing, clearing]);
        }
        assert.deepEqual(await sessionIds(a), [], 'the explicit deletion wins over the earlier write');
    });
}

test('project history deletion waits for an already accepted project write', async t => {
    const { a, b } = await fixture(t);
    const workspacePath = '/isolated-project';
    const projectSession = { ...first, workspacePath };
    a.patchGate = { entered: deferred(), release: deferred() };
    const writing = a.patchConversationHistory({ upserts: [projectSession], removedSessionIds: [] });
    await a.patchGate.entered.promise;
    const deleting = b.deleteProjectConversationHistory(workspacePath);
    let settled = false;
    void deleting.then(() => { settled = true; }, () => { settled = true; });
    try {
        await afterDelay(250);
        assert.equal(settled, false, 'project deletion must wait for the earlier accepted write');
    } finally {
        a.patchGate.release.resolve();
        await Promise.allSettled([writing, deleting]);
    }
    assert.deepEqual(await sessionIds(a), []);
});

test('legacy false setting does not disable the normal compatibility index or explicit clear', async t => {
    const { a, b } = await fixture(t);
    await setHistory(a, false);
    const record = { id: first.id, title: 'legacy secret', workspacePath: '', messages: [{
        id: 'message-1', prompt: 'private prompt', response: 'private response', createdAt: 1
    }], createdAt: 1, updatedAt: 2 };
    assert.deepEqual(await b.syncConversationIndex([record]), { conversations: 1, messages: 1 });
    assert.equal((await b.readConversationIndex())[0].id, first.id);
    await setHistory(a, true);
    assert.deepEqual(await b.syncConversationIndex([record]), { conversations: 1, messages: 1 });
    await b.clearConversationHistory();
    assert.deepEqual(await b.readConversationIndex(), []);
});
