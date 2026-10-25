import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, realpath, mkdir, readFile, writeFile, lstat, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {service} from './helpers/editor-recovery-source-loader.mjs';

class Host extends service.NextMuxPlatformServiceImpl {
    constructor(root) { super(); this.root = root; }
    nextmuxDataRoot() { return this.root; }
}
async function fixture(t) {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'nmx-oneway-project-')));
    const a = new Host(root), b = new Host(root);
    const project = join(root, 'user-project'); await mkdir(project); await writeFile(join(project, 'user.txt'), 'external user file');
    t.after(() => rm(root, {recursive: true, force: true}));
    return {root, a, b, project};
}
function draft(id, extra = {}) { return {id, workspacePath: '', title: 'project draft', turns: [], createdAt: 1, updatedAt: 2, ...extra}; }
async function retained(a, extra = {}) {
    const created = await a.createIncognitoConversation();
    await a.patchConversationHistory({upserts: [draft(created.id, {incognito: true, incognitoOrigin: true, incognitoRevision: 0, ownedWorkspace: true, ...extra})], removedSessionIds: []});
    const normal = await a.setConversationIncognito({id: created.id, incognito: false, expectedRevision: 0});
    return {...created, session: normal.session};
}
function binding(session, workspacePath) { return {id: session.id, workspacePath, expectedUpdatedAt: session.updatedAt, ...(session.incognitoOrigin ? {expectedRevision: session.incognitoRevision} : {})}; }

test('retained normal draft binds a project as the real run root while preserving owned attachment bytes and generated files', async t => {
    const {a, b, project} = await fixture(t), c = await a.createIncognitoConversation();
    const attachment = await a.cacheDesktopAttachment({conversationId: c.id, name: 'before.txt', mimeType: 'text/plain', dataBase64: Buffer.from('owned attachment').toString('base64')});
    await writeFile(join(c.workspaceRoot, 'generated.txt'), 'retain generated file');
    await a.patchConversationHistory({upserts: [draft(c.id, {incognito: true, incognitoRevision: 0, draftPrompt: 'retain words', draftAttachments: [{...attachment, id: 'attachment', kind: 'file', name: 'before.txt', mimeType: 'text/plain'}]})], removedSessionIds: []});
    const normal = await a.setConversationIncognito({id: c.id, incognito: false, expectedRevision: 0});
    const selected = await a.bindConversationDraftWorkspace(binding(normal.session, project));
    assert.equal(selected.session.id, c.id); assert.equal(selected.workspaceRoot, project);
    assert.equal(selected.session.incognitoOrigin, true); assert.equal(selected.session.incognito, false);
    assert.equal(selected.session.ownedWorkspace, false); assert.equal(selected.session.privateWorkspacePath, undefined);
    assert.equal(selected.session.draftPrompt, 'retain words'); assert.equal(await a.getConversationWorkspace(c.id), c.workspaceRoot);
    assert.equal((await a.readDesktopAttachment({...selected.session.draftAttachments[0], conversationId: c.id})).dataBase64, Buffer.from('owned attachment').toString('base64'));
    const next = await a.cacheDesktopAttachment({conversationId: c.id, workspaceRoot: project, name: 'after.txt', mimeType: 'text/plain', dataBase64: Buffer.from('new project attachment').toString('base64')});
    assert.ok(new URL(next.uri).pathname.startsWith(project + '/.nextmux/conversation-attachments/'));
    assert.equal((await a.readDesktopAttachment({...next, name: 'after.txt', workspaceRoot: project, conversationId: c.id})).dataBase64, Buffer.from('new project attachment').toString('base64'));
    let started; a.startAgentRunForProject = async request => { started = request; await writeFile(join(request.workspaceRoot, 'tool-output.txt'), 'tool wrote selected root'); return {runId: 'local-no-model'}; };
    await a.startAgentRun({conversationId: c.id, workspaceRoot: c.workspaceRoot});
    assert.equal(started.workspaceRoot, project); assert.equal(await readFile(join(project, 'tool-output.txt'), 'utf8'), 'tool wrote selected root');
    assert.equal((await b.readConversationHistorySession(c.id)).workspacePath, project);
    await a.closeIncognitoConversations([], true);
    assert.equal(await readFile(join(c.workspaceRoot, 'generated.txt'), 'utf8'), 'retain generated file');
    await a.closeIncognitoConversations([c.id]);
    await assert.rejects(lstat(dirname(c.workspaceRoot)), {code: 'ENOENT'});
    assert.equal(await readFile(join(project, 'user.txt'), 'utf8'), 'external user file');
    assert.equal(await readFile(new URL(next.uri), 'utf8'), 'new project attachment');
});

test('project selection survives a fresh manager and keeps native container separate from selected project', async t => {
    const {a, b, project} = await fixture(t), c = await retained(a, {draftPrompt: 'saved draft'});
    const result = await a.bindConversationDraftWorkspace(binding(c.session, project));
    const old = a.incognitoSessions();
    const restarted = new old.constructor(a.nextmuxDataRoot(), 800001, pid => pid === process.pid);
    await restarted.ready; b.incognitoSessions = () => restarted;
    const restored = await b.readConversationHistorySession(c.id);
    assert.equal(restored.workspacePath, project); assert.equal(restored.ownedWorkspace, false); assert.equal(restored.draftPrompt, 'saved draft');
    assert.equal(await b.getConversationWorkspace(c.id), c.workspaceRoot);
    assert.equal((await b.resolveConversationForkRequest({conversationId: c.id})).workspaceRoot, project);
    assert.equal((await b.listConversationHistory({workspacePath: project})).sessions[0].id, c.id);
    assert.equal((await b.listConversationHistory({workspacePath: ''})).total, 0);
    await assert.rejects(b.setConversationIncognito({id: c.id, incognito: true, expectedRevision: result.session.incognitoRevision}), {code: 'INCOGNITO_REENABLE_UNAVAILABLE'});
});

test('ordinary draft project selection, removal and lost-ACK replay retain ID, text and old attachment identity', async t => {
    const {a, project} = await fixture(t), id = randomUUID();
    const row = draft(id, {draftPrompt: 'ordinary text'}); await a.patchConversationHistory({upserts: [row], removedSessionIds: []});
    const request = binding(row, project), selected = await a.bindConversationDraftWorkspace(request);
    const replay = await a.bindConversationDraftWorkspace(request); assert.equal(replay.session.updatedAt, selected.session.updatedAt);
    const removed = await a.bindConversationDraftWorkspace(binding(selected.session, ''));
    assert.equal(removed.session.id, id); assert.equal(removed.session.workspacePath, ''); assert.equal(removed.session.ownedWorkspace, true);
    assert.equal(removed.session.draftPrompt, 'ordinary text'); assert.equal(removed.workspaceRoot, await a.getConversationWorkspace(id));
});

test('changing and removing a project preserves project-cached draft and pasted attachments without deleting originals', async t => {
    const {a, root, project} = await fixture(t), c = await retained(a);
    let selected = await a.bindConversationDraftWorkspace(binding(c.session, project));
    const file = await a.cacheDesktopAttachment({conversationId: c.id, workspaceRoot: project, name: 'project-file.txt', mimeType: 'text/plain', dataBase64: Buffer.from('project attachment bytes').toString('base64')});
    const paste = await a.cacheDesktopAttachment({conversationId: c.id, workspaceRoot: project, name: 'pasted.txt', mimeType: 'text/plain', dataBase64: Buffer.from('pasted bytes').toString('base64'), unique: true});
    const edited = {...selected.session, draftPrompt: 'keep text', draftAttachments: [{...file, id: 'file', name: 'project-file.txt', mimeType: 'text/plain', kind: 'file'}], draftPastedTextReferences: JSON.stringify([{id: 'paste', name: 'pasted.txt', attachment: paste}]), updatedAt: selected.session.updatedAt + 1};
    await a.patchConversationHistory({upserts: [edited], removedSessionIds: [], baseUpdatedAt: {[c.id]: selected.session.updatedAt}});
    const other = join(root, 'other-project'); await mkdir(other);
    selected = await a.bindConversationDraftWorkspace(binding(edited, other));
    assert.notEqual(selected.session.draftAttachments[0].uri, file.uri);
    assert.equal((await a.readDesktopAttachment({...selected.session.draftAttachments[0], conversationId: c.id})).dataBase64, Buffer.from('project attachment bytes').toString('base64'));
    const retainedPaste = JSON.parse(selected.session.draftPastedTextReferences)[0];
    assert.equal((await a.readDesktopAttachment({...retainedPaste.attachment, name: retainedPaste.name, conversationId: c.id})).dataBase64, Buffer.from('pasted bytes').toString('base64'));
    assert.equal(await readFile(new URL(file.uri), 'utf8'), 'project attachment bytes'); assert.equal(await readFile(new URL(paste.uri), 'utf8'), 'pasted bytes');
    const unbound = await a.bindConversationDraftWorkspace(binding(selected.session, ''));
    assert.equal(unbound.session.draftAttachments[0].uri, selected.session.draftAttachments[0].uri);
    assert.equal(unbound.session.draftPrompt, 'keep text'); assert.equal(unbound.workspaceRoot, c.workspaceRoot);
});

test('a concurrent retained draft save during attachment copy wins; failed binding never overwrites it or deletes original bytes', async t => {
    const {a, project} = await fixture(t), c = await retained(a);
    const selected = await a.bindConversationDraftWorkspace(binding(c.session, project));
    const file = await a.cacheDesktopAttachment({conversationId: c.id, workspaceRoot: project, name: 'before-race.txt', mimeType: 'text/plain', dataBase64: Buffer.from('race bytes').toString('base64')});
    const edited = {...selected.session, draftPrompt: 'old text', draftAttachments: [{...file, id: 'file', name: 'before-race.txt', mimeType: 'text/plain', kind: 'file'}], updatedAt: selected.session.updatedAt + 1};
    await a.patchConversationHistory({upserts: [edited], removedSessionIds: [], baseUpdatedAt: {[c.id]: selected.session.updatedAt}});
    const read = a.readArchiveAttachment.bind(a); let once = false;
    a.readArchiveAttachment = async (...args) => {
        const bytes = await read(...args);
        if (!once) { once = true; await a.incognitoSessions().save({...edited, draftPrompt: 'concurrent winner', updatedAt: edited.updatedAt + 1}, edited.updatedAt); }
        return bytes;
    };
    await assert.rejects(a.bindConversationDraftWorkspace(binding(edited, '')), {code: 'INCOGNITO_MODE_CHANGED'});
    const current = await a.readConversationHistorySession(c.id);
    assert.equal(current.workspacePath, project); assert.equal(current.draftPrompt, 'concurrent winner'); assert.equal(current.draftAttachments[0].uri, file.uri);
    assert.equal(await readFile(new URL(file.uri), 'utf8'), 'race bytes');
    assert.equal((await a.readDesktopAttachment({...current.draftAttachments[0], workspaceRoot: project, conversationId: c.id})).dataBase64, Buffer.from('race bytes').toString('base64'));
});

test('stale changes, private sessions, sent turns, fork ancestry and running preparations cannot rebind', async t => {
    const {a, project} = await fixture(t), privateSession = await a.createIncognitoConversation();
    const row = draft(privateSession.id, {incognito: true, incognitoRevision: 0}); await a.patchConversationHistory({upserts: [row], removedSessionIds: []});
    await assert.rejects(a.bindConversationDraftWorkspace(binding(row, project)), {code: 'CONVERSATION_WORKSPACE_CHANGED'});
    for (const extra of [{turns: [{id: 'turn'}]}, {sourceConversationId: randomUUID()}, {goal: {text: 'goal'}}, {followUpQueue: [{id: 'queue'}]}]) {
        const source = draft(randomUUID(), extra); await a.patchConversationHistory({upserts: [source], removedSessionIds: []});
        await assert.rejects(a.bindConversationDraftWorkspace(binding(source, project)), {code: 'CONVERSATION_WORKSPACE_CHANGED'});
    }
    const c = await retained(a);
    await assert.rejects(a.patchConversationHistory({upserts: [{...c.session, workspacePath: project, updatedAt: c.session.updatedAt + 1}], removedSessionIds: [], baseUpdatedAt: {[c.id]: c.session.updatedAt}}), {code: 'INCOGNITO_PROJECT_BINDING_REQUIRED'});
    await a.patchConversationHistory({upserts: [{...c.session, draftPrompt: 'new edit', updatedAt: c.session.updatedAt + 1}], removedSessionIds: [], baseUpdatedAt: {[c.id]: c.session.updatedAt}});
    await assert.rejects(a.bindConversationDraftWorkspace(binding(c.session, project)), {code: 'INCOGNITO_MODE_CHANGED'});
    const current = await a.readConversationHistorySession(c.id), release = a.incognitoSessions().holdRunPreparation(c.id);
    await assert.rejects(a.bindConversationDraftWorkspace(binding(current, project)), {code: 'INCOGNITO_MODE_BUSY'}); release();
    const selected = await a.bindConversationDraftWorkspace(binding(current, project)); assert.equal(selected.session.draftPrompt, 'new edit');
});

test('project and conversation pagination merge retained and ordinary identities without duplicates or wrong counts', async t => {
    const {a, root} = await fixture(t); const groups = [];
    for (let i = 0; i < 4; i++) {
        const project = join(root, `project-${i}`); await mkdir(project); groups.push(project);
        const c = await retained(a); await a.bindConversationDraftWorkspace(binding(c.session, project));
        const normal = draft(randomUUID(), {workspacePath: project, updatedAt: Date.now() + i}); await a.patchConversationHistory({upserts: [normal], removedSessionIds: []});
    }
    const only = join(root, 'retained-only'); await mkdir(only); groups.push(only);
    const last = await retained(a); await a.bindConversationDraftWorkspace(binding(last.session, only));
    const projects = []; let cursor;
    do { const page = await a.listConversationHistoryProjects({limit: 1, cursor}); assert.equal(page.total, 5); projects.push(...page.projects); cursor = page.nextCursor; } while (cursor);
    assert.deepEqual(projects.map(x => x.workspacePath).sort(), groups.sort()); assert.equal(new Set(projects.map(x => x.workspacePath)).size, 5);
    for (const p of projects) {
        assert.equal(p.conversationCount, p.workspacePath === only ? 1 : 2);
        const ids = []; let c;
        do { const page = await a.listConversationHistory({workspacePath: p.workspacePath, limit: 1, cursor: c}); ids.push(...page.sessions.map(s => s.id)); c = page.nextCursor; } while (c);
        assert.equal(ids.length, p.conversationCount); assert.equal(new Set(ids).size, p.conversationCount);
    }
});

test('project history removal forgets retained messages but never deletes the owned files or external project', async t => {
    const {a, project} = await fixture(t), c = await retained(a);
    await writeFile(join(c.workspaceRoot, 'keep.txt'), 'owned generated file'); await a.bindConversationDraftWorkspace(binding(c.session, project));
    const removed = await a.deleteProjectConversationHistory(project); assert.deepEqual(removed.removedSessionIds, [c.id]);
    assert.equal(await a.readConversationHistorySession(c.id), undefined); assert.equal((await a.listConversationHistoryProjects()).total, 0);
    assert.equal(await readFile(join(c.workspaceRoot, 'keep.txt'), 'utf8'), 'owned generated file'); assert.equal(await readFile(join(project, 'user.txt'), 'utf8'), 'external user file');
});

test('normal-origin forks stay normal and selected secondary roots are accepted without changing ownership', async t => {
    const {a, project} = await fixture(t), c = await retained(a);
    await a.bindConversationDraftWorkspace(binding(c.session, project));
    const current = await a.readConversationHistorySession(c.id);
    await a.patchConversationHistory({upserts: [{...current, workspaceBindings: [{id: 'selected', path: project, kind: 'selected', status: 'available'}], updatedAt: current.updatedAt + 1}], removedSessionIds: [], baseUpdatedAt: {[c.id]: current.updatedAt}});
    assert.equal((await a.readConversationHistorySession(c.id)).workspaceBindings[0].path, project);
    const resolved = await a.resolveConversationForkRequest({conversationId: c.id, workspaceRoot: project, workspaceBindings: [{id: 'selected', path: project}]}); assert.equal(resolved.workspaceRoot, project);
    const child = randomUUID(); await a.forkConversationWorkspace(c.id, child); assert.equal(a.incognitoSessions().owns(child), false);
});
