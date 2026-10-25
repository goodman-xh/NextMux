import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

const sourceId = '00000000-0000-4000-8000-000000000001';
const branchId = '00000000-0000-4000-8000-000000000002';
// The durable history both ways the service reads it: the whole list, and one conversation (root authorization).
const historyStore = sessions => () => ({
    async load() { return { sessions }; },
    async readSession(id) { return sessions.find(session => session.id === id); }
});

test('host-owned multi-root branch survives host reopen, authorizes each root and cleans every store', async t => {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'nm-fork-rpc-')));
    const stateRoot = join(base, 'state'), a = join(base, 'a'), b = join(base, 'b');
    await mkdir(a); await mkdir(b); await writeFile(join(a, 'a.txt'), 'a0'); await writeFile(join(b, 'b.txt'), 'b0');
    const createService = () => {
        const service = new NextMuxPlatformServiceImpl();
        service.nextmuxDataRoot = () => stateRoot;
        // A projectless conversation can bind roots without a workspacePath.
        service.conversationStore = historyStore([{ id: sourceId, workspaceBindings: [{ path: a }, { path: b }] }]);
        return service;
    };
    const service = createService();
    t.after(async () => { await service.disposeConnectionResources(); await rm(base, { recursive: true, force: true }); });
    const before = await service.getAgentFileState({ workspaceRoot: a, path: 'a.txt', conversationId: sourceId });
    const saved = await service.saveAgentFileVersion({ workspaceRoot: a, path: 'a.txt', content: 'a1', expectedSha256: before.sha256, conversationId: sourceId, turnId: 'turn1' });
    const messageRestore = await service.restoreAgentCheckpointGroups([{ workspaceRoot: a, checkpointIds: [saved.checkpointId],
        targets: [{ checkpointId: saved.checkpointId, side: 'before' }] }], { conversationId: sourceId, turnId: 'replacement' });
    assert.equal(await readFile(join(a, 'a.txt'), 'utf8'), 'a0');
    const timeline = await service.listAgentFileVersions({ workspaceRoot: a, path: 'a.txt', conversationId: sourceId });
    assert.equal(timeline.versions.find(version => version.checkpointId === messageRestore.versions[0].checkpointId).turnId, 'replacement');
    await service.restoreAgentFileVersion({ workspaceRoot: a, checkpointId: saved.checkpointId, side: 'after',
        expectedSha256: before.sha256, conversationId: sourceId, turnId: 'replacement' });
    assert.equal(await readFile(join(a, 'a.txt'), 'utf8'), 'a1');
    const branch = await service.forkConversationWorkspaces({ sourceConversationId: sourceId, targetConversationId: branchId,
        primaryWorkspaceRoot: a, groups: [
            { workspaceRoot: a, inheritedCheckpointIds: [saved.checkpointId], checkpointIds: [saved.checkpointId], targets: [{ checkpointId: saved.checkpointId, side: 'before' }] },
            { workspaceRoot: b, inheritedCheckpointIds: [], checkpointIds: [], targets: [] }
        ] });
    const reopened = createService();
    t.after(() => reopened.disposeConnectionResources());
    const bindings = await reopened.getConversationWorkspaceBindings(branchId, true);
    assert.deepEqual(bindings.workspaces, branch.workspaces);
    assert.equal(await reopened.getConversationWorkspace(branchId), branch.workspaceRoot);
    const branchB = bindings.workspaces.find(item => item.sourceWorkspaceRoot === b).workspaceRoot;
    const resumed = await reopened.resolveConversationForkRequest({ conversationId: branchId,
        workspaceRoot: reopened.conversationWorkspacePath(branchId), permissionMode: 'workspace_write' });
    assert.equal(resumed.workspaceRoot, branch.workspaceRoot);
    assert.deepEqual(resumed.workspaceBindings.map(item => item.path).sort(), bindings.workspaces.map(item => item.workspaceRoot).sort());
    const bState = await reopened.getAgentFileState({ workspaceRoot: branchB, path: 'b.txt', conversationId: branchId });
    await reopened.saveAgentFileVersion({ workspaceRoot: branchB, path: 'b.txt', content: 'private b', expectedSha256: bState.sha256, conversationId: branchId });
    assert.equal(await readFile(join(b, 'b.txt'), 'utf8'), 'b0');
    assert.equal(await readFile(join(a, 'a.txt'), 'utf8'), 'a1');
    assert.equal(await readFile(join(branch.workspaceRoot, 'a.txt'), 'utf8'), 'a0');
    const stores = bindings.workspaces.map(item => reopened.agentCheckpointRoot(item.workspaceRoot));
    await reopened.discardConversationWorkspace(branchId);
    for (const path of [reopened.conversationWorkspacePath(branchId), ...stores]) await assert.rejects(stat(path), { code: 'ENOENT' });
    assert.equal(await readFile(join(a, 'a.txt'), 'utf8'), 'a1');
});

test('read-only fork lookup never creates a missing directory or treats an empty directory as a restored layout', async t => {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'nm-fork-readonly-')));
    const service = new NextMuxPlatformServiceImpl(); service.nextmuxDataRoot = () => base;
    t.after(async () => { await service.disposeConnectionResources(); await rm(base, { recursive: true, force: true }); });
    const target = service.conversationWorkspacePath(branchId);
    await assert.rejects(service.getConversationWorkspaceBindings(branchId, true));
    await assert.rejects(stat(target), { code: 'ENOENT' });
    await mkdir(target, { recursive: true });
    await assert.rejects(service.getConversationWorkspaceBindings(branchId, true), { code: 'INVALID_FORK_LAYOUT' });
    await assert.rejects(stat(join(target, '.nextmux-fork-layout.json')), { code: 'ENOENT' });
});

// 2026-09-29: a branch of a branch of a projectless conversation failed every message with
// "ENOENT: realpath ''": private bindings are stored without a path and the renderer sent them as-is.
test('private bindings sent without a path resolve to the host layout, for a branch and for a plain conversation', async t => {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'nm-fork-empty-')));
    const stateRoot = join(base, 'state'), a = join(base, 'a'), b = join(base, 'b');
    await mkdir(a); await mkdir(b);
    const service = new NextMuxPlatformServiceImpl();
    service.nextmuxDataRoot = () => stateRoot;
    service.conversationStore = historyStore([{ id: sourceId, workspaceBindings: [{ path: a }, { path: b }] }]);
    t.after(async () => { await service.disposeConnectionResources(); await rm(base, { recursive: true, force: true }); });
    const branch = await service.forkConversationWorkspaces({ sourceConversationId: sourceId, targetConversationId: branchId, primaryWorkspaceRoot: a,
        groups: [{ workspaceRoot: a, inheritedCheckpointIds: [], checkpointIds: [], targets: [] }, { workspaceRoot: b, inheritedCheckpointIds: [], checkpointIds: [], targets: [] }] });
    const resolved = await service.resolveConversationForkRequest({ conversationId: branchId, workspaceRoot: service.conversationWorkspacePath(branchId),
        permissionMode: 'workspace_write', workspaceBindings: [{ id: 'private-0', path: '', permissionMode: 'full_access' }, { id: 'private-1', path: '', permissionMode: 'read_only' }] });
    assert.equal(resolved.workspaceRoot, branch.workspaceRoot);
    assert.deepEqual(resolved.workspaceBindings.map(item => item.path).sort(), branch.workspaces.map(item => item.workspaceRoot).sort());
    assert.deepEqual(resolved.workspaceBindings.map(item => item.permissionMode).sort(), ['full_access', 'read_only'], 'each private root keeps its permission');
    await assert.rejects(service.resolveConversationForkRequest({ conversationId: branchId, workspaceRoot: service.conversationWorkspacePath(branchId),
        permissionMode: 'workspace_write', workspaceBindings: [{ id: 'private-7', path: '', permissionMode: 'full_access' }] }), error => error.code === 'INVALID_WORKSPACE_BINDINGS');
    await assert.rejects(service.resolveConversationForkRequest({ conversationId: branchId, workspaceRoot: service.conversationWorkspacePath(branchId),
        permissionMode: 'workspace_write', workspaceBindings: [{ id: 'project-x', path: '', permissionMode: 'full_access' }] }), error => error.code === 'INVALID_WORKSPACE_BINDINGS',
        'a project binding without a path is a clear error, not realpath("")');
    // A plain projectless conversation (no branch layout): its only private root is its own folder.
    const plainId = '00000000-0000-4000-8000-000000000003';
    await service.getConversationWorkspaceBindings(plainId);
    const plain = await service.resolveConversationForkRequest({ conversationId: plainId, workspaceRoot: service.conversationWorkspacePath(plainId), permissionMode: 'workspace_write',
        workspaceBindings: [{ id: 'private-0', path: '', permissionMode: 'workspace_write' }] });
    assert.deepEqual(plain.workspaceBindings.map(item => item.path), [await realpath(service.conversationWorkspacePath(plainId))]);
});
