import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, writeFile, readFile, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { service } from './helpers/editor-recovery-source-loader.mjs';
const { createIncognitoNativeRegistry } = createRequire(import.meta.url)('../../../apps/desktop/incognito-native.cjs');

class Host extends service.NextMuxPlatformServiceImpl {
    constructor(root) { super(); this.root = root; }
    nextmuxDataRoot() { return this.root; }
}
const record = (id, incognito) => ({ id, incognito, ...(incognito ? { incognitoOrigin: true, incognitoRevision: 0 } : {}),
    ownedWorkspace: true, workspacePath: '', title: 'Synthetic branch', turns: [], createdAt: 1, updatedAt: 2 });
const forks = {
    single: (host, source, target) => host.forkConversationWorkspace(source.id, target),
    project: (host, source, target) => host.forkProjectConversationWorkspace(source.id, target, source.workspaceRoot),
    grouped: (host, source, target) => host.forkConversationWorkspaces({ sourceConversationId: source.id, targetConversationId: target,
        primaryWorkspaceRoot: source.workspaceRoot, groups: [{ workspaceRoot: source.workspaceRoot, inheritedCheckpointIds: [], checkpointIds: [] }] })
};

for (const [kind, fork] of Object.entries(forks)) test(`actual ${kind} fork inherits current private mode with independent files; parent mode changes never change its child`, async t => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'nmx-private-branch-')));
    t.after(() => rm(root, { recursive: true, force: true }));
    const host = new Host(root), parent = await host.createIncognitoConversation();
    await host.patchConversationHistory({ upserts: [record(parent.id, true)], removedSessionIds: [] });
    await writeFile(join(parent.workspaceRoot, 'created.txt'), 'PARENT_FILE');
    const childId = randomUUID(), child = await fork(host, parent, childId);
    await host.patchConversationHistory({ upserts: [record(childId, true)], removedSessionIds: [] });
    assert.equal((await host.readConversationHistorySession(childId)).incognito, true);
    assert.equal(host.incognitoSessions().has(childId), true);
    assert.equal(host.incognitoSessions().sessionForPath(child.workspaceRoot), childId);
    assert.notEqual(dirname(host.conversationWorkspacePath(childId)), dirname(parent.workspaceRoot));
    assert.equal(await readFile(join(child.workspaceRoot, 'created.txt'), 'utf8'), 'PARENT_FILE');
    await writeFile(join(child.workspaceRoot, 'created.txt'), 'CHILD_FILE');
    assert.equal(await readFile(join(parent.workspaceRoot, 'created.txt'), 'utf8'), 'PARENT_FILE');
    // Run/queue preparation retains the child owner, never its parent workspace.
    const request = await host.resolveConversationForkRequest({ conversationId: childId, permissionMode: 'workspace_write' });
    assert.equal(host.incognitoSessions().sessionForPath(request.workspaceRoot), childId);
    assert.ok(host.localConversationDataRoot(childId).startsWith(dirname(host.conversationWorkspacePath(childId))));
    await assert.rejects(host.resolveConversationForkRequest({ conversationId: childId, workspaceRoot: parent.workspaceRoot }), { code: 'INCOGNITO_PRIVATE_WORKSPACE_REQUIRED' });

    await host.setConversationIncognito({ id: parent.id, incognito: false, expectedRevision: 0 });
    assert.equal((await host.readConversationHistorySession(childId)).incognito, true, 'child mode is independent of its parent');
    const normalId = randomUUID(), normal = await fork(host, parent, normalId);
    await host.patchConversationHistory({ upserts: [record(normalId, false)], removedSessionIds: [] });
    assert.equal(host.incognitoSessions().owns(normalId), false, 'a retained normal parent creates an ordinary branch');
    assert.equal((await host.readConversationHistorySession(normalId)).incognitoOrigin, undefined);
    await host.closeIncognitoConversations([], true);
    await assert.rejects(lstat(host.incognitoSessions().workspace(childId) || child.workspaceRoot), { code: 'ENOENT' });
    assert.equal(await readFile(join(parent.workspaceRoot, 'created.txt'), 'utf8'), 'PARENT_FILE');
    assert.equal(await readFile(join(normal.workspaceRoot, 'created.txt'), 'utf8'), 'PARENT_FILE');
    assert.ok(await host.readConversationHistorySession(normalId));
});

for (const [kind, fork] of Object.entries(forks)) test(`actual ${kind} private branch can retain only itself; exit removes private parent and preserves the child history and files`, async t => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'nmx-retained-branch-')));
    t.after(() => rm(root, { recursive: true, force: true }));
    const host = new Host(root), parent = await host.createIncognitoConversation();
    await host.patchConversationHistory({ upserts: [record(parent.id, true)], removedSessionIds: [] });
    await writeFile(join(parent.workspaceRoot, 'created.txt'), 'COPIED_FILE');
    const id = randomUUID(), child = await fork(host, parent, id);
    await host.patchConversationHistory({ upserts: [record(id, true)], removedSessionIds: [] });
    const native = createIncognitoNativeRegistry(), nativeOwner = 101;
    assert.equal(native.register({ id: parent.id, workspaceRoot: parent.workspaceRoot }, nativeOwner), true);
    assert.equal(native.register({ id, workspaceRoot: child.workspaceRoot }, nativeOwner), true);
    const retained = await host.setConversationIncognito({ id, incognito: false, expectedRevision: 0 });
    assert.equal(retained.session.id, id);
    assert.equal(retained.session.incognito, false);
    assert.equal(retained.session.incognitoOrigin, true, 'the child keeps independent toggle eligibility');
    assert.equal(retained.session.incognitoRevision, 1);
    assert.equal((await host.readConversationHistorySession(parent.id)).incognito, true);
    assert.equal(native.setMode({ id, workspaceRoot: child.workspaceRoot, enabled: false }, nativeOwner), true);
    let stopped;
    assert.equal(await native.finish([parent.id, id], nativeOwner, async ids => { stopped = ids; }, { applicationQuit: true }), true);
    assert.deepEqual(stopped, [parent.id], 'native quit reads each branch own mode marker');
    assert.equal(native.closed(id), false);
    await writeFile(join(child.workspaceRoot, 'child-created.txt'), 'CHILD_GENERATED_KEEP');
    await host.closeIncognitoConversations([], true);
    await assert.rejects(lstat(dirname(parent.workspaceRoot)), { code: 'ENOENT' });
    assert.equal(await readFile(join(child.workspaceRoot, 'created.txt'), 'utf8'), 'COPIED_FILE');
    assert.equal(await readFile(join(child.workspaceRoot, 'child-created.txt'), 'utf8'), 'CHILD_GENERATED_KEEP');
    const freshConnection = new Host(root), saved = await freshConnection.readConversationHistorySession(id);
    assert.equal(saved.incognito, false); assert.equal(saved.incognitoOrigin, true); assert.equal(saved.incognitoRevision, 1);
});

test('actual forked private child is removed after owner SIGKILL while its retained parent and external files survive', async t => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'nmx-private-fork-crash-')));
    t.after(() => rm(root, { recursive: true, force: true }));
    const external = join(root, 'external-user.txt');
    await writeFile(external, 'USER_FILE_KEEP');
    const script = `import {service} from ${JSON.stringify(new URL('./helpers/editor-recovery-source-loader.mjs', import.meta.url).href)};
        import {writeFile} from 'node:fs/promises';import {join} from 'node:path';import {randomUUID} from 'node:crypto';
        class Host extends service.NextMuxPlatformServiceImpl {nextmuxDataRoot(){return process.argv[1]}}
        const host=new Host(),parent=await host.createIncognitoConversation();
        const row=id=>({id,incognito:true,incognitoOrigin:true,incognitoRevision:0,workspacePath:'',ownedWorkspace:true,title:'synthetic',turns:[],createdAt:1,updatedAt:2});
        await host.patchConversationHistory({upserts:[row(parent.id)],removedSessionIds:[]});
        await writeFile(join(parent.workspaceRoot,'created.txt'),'PARENT_FILE');
        const childId=randomUUID(),child=await host.forkConversationWorkspace(parent.id,childId);
        await host.patchConversationHistory({upserts:[row(childId)],removedSessionIds:[]});
        await host.setConversationIncognito({id:parent.id,incognito:false,expectedRevision:0});
        process.stdout.write(JSON.stringify({parent,child:{id:childId,...child}})+'\\n');setInterval(()=>{},1000);`;
    const childProcess = spawn(process.execPath, ['--input-type=module', '-e', script, root], { stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => { if (childProcess.exitCode === null && !childProcess.killed) childProcess.kill('SIGKILL'); });
    const created = await new Promise((resolve, reject) => {
        let output = '', errors = '';
        childProcess.stderr.on('data', bytes => { errors += bytes; });
        childProcess.stdout.on('data', bytes => { output += bytes; if (output.includes('\n')) resolve(JSON.parse(output.trim())); });
        childProcess.once('error', reject);
        childProcess.once('exit', code => { if (!output) reject(Error(`child exited ${code}: ${errors}`)); });
    });
    const exited = once(childProcess, 'exit'); childProcess.kill('SIGKILL'); await exited;
    const restarted = new Host(root), history = await restarted.loadConversationHistory();
    assert.equal(history.sessions.find(session => session.id === created.parent.id)?.incognito, false);
    assert.equal(history.sessions.some(session => session.id === created.child.id), false);
    await assert.rejects(lstat(dirname(created.child.workspaceRoot)), { code: 'ENOENT' });
    assert.equal(await readFile(join(created.parent.workspaceRoot, 'created.txt'), 'utf8'), 'PARENT_FILE');
    assert.equal(await readFile(external, 'utf8'), 'USER_FILE_KEEP');
});
