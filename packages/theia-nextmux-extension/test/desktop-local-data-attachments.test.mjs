import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { desktopDomainErrorText } from '../lib/browser/nextmux-domain-error-locale.js';
import { componentDomainMessage } from '../lib/browser/nextmux-component-domain-locale.js';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { clearAttachmentCacheRoot, measureAttachmentCacheRoot, resolveAttachmentCacheRoots } from '../lib/node/nextmux-attachment-cache-roots.js';

class LocalDataFixture extends NextMuxPlatformServiceImpl {
    constructor(dataRoot, project) {
        super(); this.dataRoot = dataRoot;
        this.workspaceServer = {
            getMostRecentlyUsedWorkspace: async () => project ? pathToFileURL(project).href : undefined,
            getRecentWorkspaces: async () => project ? [pathToFileURL(project).href] : []
        };
    }
    nextmuxDataRoot() { return this.dataRoot; }
}

async function fixture(t) {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'nextmux-local-attachments-')));
    t.after(() => rm(root, { recursive: true, force: true }));
    const project = join(root, 'project'), dataRoot = join(root, 'profile');
    await mkdir(project);
    return { project, dataRoot, service: new LocalDataFixture(dataRoot, project) };
}
const cache = (service, content, scope = {}) => service.cacheDesktopAttachment({
    name: 'fixture.txt', mimeType: 'text/plain', dataBase64: Buffer.from(content).toString('base64'), ...scope
});
const attachments = state => state.entries.find(entry => entry.category === 'conversation_attachments');
const conversationId = '00000000-0000-4000-8000-000000000041';

test('local-data counts five project attachment copies together with the global cache', async t => {
    const f = await fixture(t);
    for (let i = 0; i < 5; i++) await cache(f.service, `copy-${i}`, { workspaceRoot: f.project, conversationId, unique: true });
    await cache(f.service, 'global');
    assert.equal((await readdir(join(f.project, '.nextmux', 'conversation-attachments'))).length, 5);
    assert.deepEqual(attachments(await f.service.getDesktopLocalDataState(f.project)), {
        category: 'conversation_attachments', files: 6, bytes: 36
    });
});

test('local-data discovers orphaned app-owned conversation caches after history clearing and service recreation', async t => {
    const f = await fixture(t);
    await cache(f.service, 'owned', { conversationId, unique: true });
    await f.service.saveConversationHistory([{ id: conversationId, title: 'Fixture', workspacePath: '', createdAt: 1, updatedAt: 2,
        turns: [{ id: 'turn', prompt: 'Fixture only', response: '', stage: 'complete', createdAt: 1 }] }]);
    // Only the disposable test profile is cleared. No desktop profile is used.
    await f.service.clearConversationHistory();
    await rm(join(f.dataRoot, 'attachment-cache-roots-v1'), { recursive: true, force: true });
    const restarted = new LocalDataFixture(f.dataRoot);
    assert.deepEqual(attachments(await restarted.getDesktopLocalDataState('')), {
        category: 'conversation_attachments', files: 1, bytes: 5
    });
});

test('same-SHA import adopts an authorized legacy root, but history and selected paths alone do not', async t => {
    const f = await fixture(t), directory = join(f.project, '.nextmux', 'conversation-attachments');
    await mkdir(directory, { recursive: true });
    const content = 'existing legacy file';
    const name = `${createHash('sha256').update(content).digest('hex')}.txt`;
    await writeFile(join(directory, name), content);
    await f.service.saveConversationHistory([{ id: conversationId, title: 'Legacy', workspacePath: f.project,
        createdAt: 1, updatedAt: 2, turns: [] }]);
    const before = await f.service.getDesktopLocalDataState(f.project);
    assert.equal(attachments(before).files, 0, 'history strings must not confer deletion authority');
    assert.deepEqual(before.attachmentCoverage, { scope: 'registered_and_owned', unavailableRoots: 0, pendingStagingRoots: 0 });
    const saved = await cache(f.service, content, { workspaceRoot: f.project, conversationId });
    assert.equal(saved.uri, pathToFileURL(join(directory, name)).href);
    assert.deepEqual(await readdir(directory), [name], 'deduplication must not manufacture another copy');
    assert.equal((await readdir(join(f.dataRoot, 'attachment-cache-roots-v1'))).length, 1);
    await f.service.clearConversationHistory();
    const restarted = new LocalDataFixture(f.dataRoot);
    assert.equal(attachments(await restarted.getDesktopLocalDataState('')).files, 1);
    assert.equal(attachments(await f.service.getDesktopLocalDataState(f.project)).files, 1, 'the same root is counted once');
});

test('registry failure rejects import, retains the copy, and same-SHA retry registers it', async t => {
    const f = await fixture(t);
    await mkdir(f.dataRoot, { recursive: true });
    const registry = join(f.dataRoot, 'attachment-cache-roots-v1');
    await writeFile(registry, 'not a directory');
    await assert.rejects(cache(f.service, 'retry me', { workspaceRoot: f.project, conversationId }));
    const directory = join(f.project, '.nextmux', 'conversation-attachments');
    const [name] = await readdir(directory);
    assert.equal(await readFile(join(directory, name), 'utf8'), 'retry me');
    await rm(registry);
    const result = await cache(f.service, 'retry me', { workspaceRoot: f.project, conversationId });
    assert.equal(result.uri, pathToFileURL(join(directory, name)).href);
    assert.equal(attachments(await new LocalDataFixture(f.dataRoot).getDesktopLocalDataState('')).files, 1);
});

test('stats and clear share global, registered and private roots even when history is cleared first', async t => {
    const f = await fixture(t);
    await cache(f.service, 'global');
    await cache(f.service, 'project', { workspaceRoot: f.project, conversationId });
    await cache(f.service, 'private', { conversationId });
    const source = join(f.project, 'source.txt'); await writeFile(source, 'keep source');
    const unrelated = join(f.project, 'another-project', '.nextmux', 'conversation-attachments');
    await mkdir(unrelated, { recursive: true }); await writeFile(join(unrelated, 'unregistered.txt'), 'keep old cache');
    const restarted = new LocalDataFixture(f.dataRoot, f.project);
    assert.equal(attachments(await restarted.getDesktopLocalDataState('')).files, 3, 'private enumeration and registry must deduplicate');
    const cleared = await restarted.clearDesktopLocalData({ workspaceRoot: '', categories: ['conversation_history', 'conversation_attachments'] });
    assert.equal(attachments(cleared).files, 0);
    assert.equal(await readFile(source, 'utf8'), 'keep source');
    assert.equal(await readFile(join(unrelated, 'unregistered.txt'), 'utf8'), 'keep old cache');
    assert.equal((await readdir(join(f.dataRoot, 'attachment-cache-roots-v1'))).length, 2, 'history and cache clear retain registration records');
    await cache(restarted, 'new cache identity', { workspaceRoot: f.project, conversationId });
    assert.equal(attachments(await restarted.getDesktopLocalDataState('')).files, 1);
});

test('fixed private-fork discovery counts copied roots and never follows sourceWorkspaceRoot', async t => {
    const f = await fixture(t), container = join(f.dataRoot, 'conversation-workspaces', conversationId);
    const privateRoot = join(container, 'roots', 'project');
    await mkdir(join(privateRoot, '.nextmux', 'conversation-attachments'), { recursive: true });
    await writeFile(join(privateRoot, '.nextmux', 'conversation-attachments', 'owned.txt'), 'owned');
    const outside = join(f.project, '.nextmux', 'conversation-attachments');
    await mkdir(outside, { recursive: true }); await writeFile(join(outside, 'outside.txt'), 'outside');
    await writeFile(join(container, '.nextmux-fork-layout.json'), JSON.stringify({ version: 1, phase: 'complete',
        primary: 'roots/project', workspaces: [{ path: 'roots/project', sourceWorkspaceRoot: f.project }] }));
    assert.equal(attachments(await f.service.getDesktopLocalDataState('')).files, 1);
    await f.service.clearDesktopLocalData({ workspaceRoot: '', categories: ['conversation_attachments'] });
    assert.equal(await readFile(join(outside, 'outside.txt'), 'utf8'), 'outside');
});

test('new cache writes reject symlinks at the project, .nextmux and cache directory', async t => {
    for (const level of ['project', '.nextmux', 'cache']) {
        const f = await fixture(t), outside = join(f.project, 'outside');
        await mkdir(outside);
        if (level === 'project') {
            const alias = join(f.project, 'alias'); await symlink(outside, alias, 'dir');
            f.service.workspaceServer.getMostRecentlyUsedWorkspace = async () => pathToFileURL(alias).href;
            await assert.rejects(cache(f.service, 'blocked', { workspaceRoot: alias, conversationId }));
        } else if (level === '.nextmux') {
            await symlink(outside, join(f.project, '.nextmux'), 'dir');
            await assert.rejects(cache(f.service, 'blocked', { workspaceRoot: f.project, conversationId }));
        } else {
            await mkdir(join(f.project, '.nextmux'));
            await symlink(outside, join(f.project, '.nextmux', 'conversation-attachments'), 'dir');
            await assert.rejects(cache(f.service, 'blocked', { workspaceRoot: f.project, conversationId }));
        }
        assert.deepEqual(await readdir(outside), [], `${level} must not receive a cache write`);
    }
});

test('a replaced registered root reports partial coverage and prevents clearing any selected category', async t => {
    const f = await fixture(t);
    await cache(f.service, 'registered', { workspaceRoot: f.project, conversationId });
    await f.service.saveConversationHistory([{ id: conversationId, title: 'Keep history', workspacePath: f.project, createdAt: 1, updatedAt: 2, turns: [] }]);
    const nextmux = join(f.project, '.nextmux');
    await rename(nextmux, join(f.project, 'original-cache'));
    const outside = join(f.project, 'outside'); await mkdir(join(outside, 'conversation-attachments'), { recursive: true });
    await writeFile(join(outside, 'conversation-attachments', 'foreign.txt'), 'foreign');
    await symlink(outside, nextmux, 'dir');
    const state = await f.service.getDesktopLocalDataState('');
    assert.equal(attachments(state).files, 0); assert.ok(state.attachmentCoverage.unavailableRoots > 0);
    await assert.rejects(f.service.clearDesktopLocalData({ workspaceRoot: '', categories: ['conversation_history', 'conversation_attachments'] }), { code: 'LOCAL_DATA_UNSAFE' });
    assert.equal((await f.service.loadConversationHistory()).sessions.length, 1);
    assert.equal(await readFile(join(outside, 'conversation-attachments', 'foreign.txt'), 'utf8'), 'foreign');
});

test('a stale selection cannot measure or delete a replacement directory with the same path', async t => {
    const f = await fixture(t);
    await cache(f.service, 'original', { workspaceRoot: f.project, conversationId });
    const { roots } = await resolveAttachmentCacheRoots(f.dataRoot);
    assert.equal(roots.length, 1);
    const root = roots[0];
    await rename(root.path, `${root.path}-original`);
    await mkdir(root.path); await writeFile(join(root.path, 'replacement.txt'), 'leave this');
    await assert.rejects(measureAttachmentCacheRoot(root), { code: 'LOCAL_DATA_UNSAFE' });
    await assert.rejects(clearAttachmentCacheRoot(f.dataRoot, root), { code: 'LOCAL_DATA_UNSAFE' });
    assert.equal(await readFile(join(root.path, 'replacement.txt'), 'utf8'), 'leave this');
});

test('cache children that are symlinks are not counted as files or removed through recursive clear', async t => {
    const f = await fixture(t);
    await cache(f.service, 'real', { workspaceRoot: f.project, conversationId });
    const outside = join(f.project, 'source.txt'); await writeFile(outside, 'keep');
    await symlink(outside, join(f.project, '.nextmux', 'conversation-attachments', 'link.txt'));
    const state = await f.service.getDesktopLocalDataState('');
    assert.ok(state.attachmentCoverage.unavailableRoots > 0);
    await assert.rejects(f.service.clearDesktopLocalData({ workspaceRoot: '', categories: ['conversation_attachments'] }), { code: 'LOCAL_DATA_UNSAFE' });
    assert.equal(await readFile(outside, 'utf8'), 'keep');
});

test('a clear waits for an in-flight cache write across service instances using the same root', async t => {
    const f = await fixture(t);
    await cache(f.service, 'first', { workspaceRoot: f.project, conversationId });
    let entered, resume;
    const started = new Promise(done => { entered = done; });
    const gate = new Promise(done => { resume = done; });
    const capacity = f.service.assertAttachmentRootCapacity.bind(f.service);
    f.service.assertAttachmentRootCapacity = async (...args) => { entered(); await gate; return capacity(...args); };
    const writing = cache(f.service, 'in flight', { workspaceRoot: f.project, conversationId });
    await started;
    const other = new LocalDataFixture(f.dataRoot);
    let clearingDone = false;
    const clearing = other.clearDesktopLocalData({ workspaceRoot: '', categories: ['conversation_attachments'] })
        .then(result => { clearingDone = true; return result; });
    // Observe the real root lock rather than relying on a fixed timeout.
    await new Promise(done => setImmediate(done));
    assert.equal(clearingDone, false);
    resume();
    await writing;
    const cleared = await clearing;
    assert.equal(attachments(cleared).files, 0);
    assert.equal(cleared.attachmentCoverage.unavailableRoots, 0);
});

test('unfinished validated app-owned staging stays counted after restart and can finish clearing', async t => {
    const f = await fixture(t);
    await cache(f.service, 'pending staged copy', { workspaceRoot: f.project, conversationId });
    const { roots: [root] } = await resolveAttachmentCacheRoots(f.dataRoot);
    const staging = join(f.dataRoot, 'attachment-cache-staging-v1');
    await mkdir(staging);
    const staged = join(staging, '00000000-0000-4000-8000-000000000051');
    await writeFile(`${staged}.json`, JSON.stringify({ version: 1, identity: root.directories.at(-1) }));
    // Simulate a completed atomic move followed by host shutdown before deletion.
    await rename(root.path, staged);
    const restarted = new LocalDataFixture(f.dataRoot);
    const state = await restarted.getDesktopLocalDataState('');
    assert.equal(attachments(state).files, 1);
    assert.equal(attachments(state).bytes, Buffer.byteLength('pending staged copy'));
    assert.deepEqual(state.attachmentCoverage, { scope: 'registered_and_owned', unavailableRoots: 0, pendingStagingRoots: 1 });
    const cleared = await restarted.clearDesktopLocalData({ workspaceRoot: '', categories: ['conversation_attachments'] });
    assert.equal(attachments(cleared).files, 0);
    assert.equal(cleared.attachmentCoverage.pendingStagingRoots, 0);
    assert.deepEqual(await readdir(staging), []);
});

test('staging without a verifiable receipt is visible as incomplete and kept for recovery', async t => {
    const f = await fixture(t);
    const staged = join(f.dataRoot, 'attachment-cache-staging-v1', '00000000-0000-4000-8000-000000000052');
    await mkdir(staged, { recursive: true }); await writeFile(join(staged, 'recover.txt'), 'keep for recovery');
    const state = await f.service.getDesktopLocalDataState('');
    assert.equal(attachments(state).files, 0);
    assert.equal(state.attachmentCoverage.pendingStagingRoots, 1);
    assert.ok(state.attachmentCoverage.unavailableRoots > 0);
    await assert.rejects(f.service.clearDesktopLocalData({ workspaceRoot: '', categories: ['conversation_attachments'] }), { code: 'LOCAL_DATA_UNSAFE' });
    assert.equal(await readFile(join(staged, 'recover.txt'), 'utf8'), 'keep for recovery');
});


test('local-data load and clear preserve the changed-cache RPC reason in every UI language', async t => {
    const f = await fixture(t);
    await cache(f.service, 'original', { workspaceRoot: f.project, conversationId });
    const { roots: [root] } = await resolveAttachmentCacheRoots(f.dataRoot);
    await rename(root.path, `${root.path}-previous`);
    await mkdir(root.path);
    let reason;
    await assert.rejects(measureAttachmentCacheRoot(root), error => {
        reason = error;
        return error.code === 'LOCAL_DATA_UNSAFE' && error.data.domainError.code === 'ATTACHMENT_ROOT_CHANGED';
    });
    // Match the RPC boundary: preserve code/data, while never relying on the English message.
    const wire = JSON.parse(JSON.stringify({ code: reason.code, data: reason.data }));
    const rpcError = Object.assign(new Error('RAW_CACHE_DIAGNOSTIC'), wire);
    const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
    const methods = ['loadLocalDataState', 'clearDesktopDataCategory'].map(name => {
        const method = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name);
        assert.ok(method, name); return method.getText(file);
    });
    const Harness = new Function('desktopDomainErrorText', ts.transpile(`class Harness { ${methods.join('\n')} }; return Harness;`, {
        target: ts.ScriptTarget.ES2022
    }))(desktopDomainErrorText);
    for (const locale of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
        const state = Object.assign(new Harness(), {
            desktopLocale: locale, localDataStage: 'idle', activeWorkspaceRoot: '', update() {},
            platformService: { async getDesktopLocalDataState() { throw rpcError; }, async clearDesktopLocalData() { throw rpcError; } }
        });
        const expected = componentDomainMessage(locale, reason.domainError);
        await state.loadLocalDataState();
        assert.equal(state.localDataError, expected);
        state.localDataConfirmAction = 'category:conversation_attachments';
        await state.clearDesktopDataCategory('conversation_attachments');
        assert.equal(state.localDataError, expected);
        assert.doesNotMatch(state.localDataError, /RAW_CACHE_DIAGNOSTIC/);
        if (locale !== 'en') assert.notEqual(state.localDataError, reason.message);
    }
});
