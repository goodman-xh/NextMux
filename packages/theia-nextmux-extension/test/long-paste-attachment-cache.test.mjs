import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import { AgentToolRegistry, WorkspaceToolRuntime } from '@nextmux/agent-runtime';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

const attachmentReason = (code, reason) => error => error?.code === code && error?.data?.domainError?.code === reason;

async function isWithin(parent, child) {
    const [parentRoot, childPath] = await Promise.all([realpath(resolve(parent)), realpath(resolve(child))]);
    const delta = relative(parentRoot, childPath);
    return delta !== '..' && !delta.startsWith(`..${sep}`) && !delta.includes(`..${sep}`);
}

function request(name, content, options = {}) {
    return {
        name,
        mimeType: 'text/plain',
        dataBase64: Buffer.from(content, 'utf8').toString('base64'),
        ...options
    };
}

function authorizeWorkspace(service, workspaceRoot) {
    service.workspaceServer = {
        getMostRecentlyUsedWorkspace: async () => pathToFileURL(workspaceRoot).toString(),
        getRecentWorkspaces: async () => [pathToFileURL(workspaceRoot).toString()]
    };
}

async function createFileCheckpoint(workspaceRoot, checkpointRoot, path, before, after) {
    await writeFile(join(workspaceRoot, path), before, 'utf8');
    const runtime = await WorkspaceToolRuntime.create({
        workspaceRoot,
        checkpointRoot,
        permissionMode: 'workspace_write'
    });
    const registry = new AgentToolRegistry();
    runtime.registerTools(registry);
    try {
        const read = await registry.execute({
            id: 'read-checkpoint-source', name: 'workspace.read_file', arguments: { path }
        }, 'read_only', { runId: 'run-checkpoint-fork' });
        const written = await registry.execute({
            id: 'write-checkpoint-source', name: 'workspace.write_file',
            arguments: { path, content: after, expectedSha256: read.output.sha256 }
        }, 'workspace_write', { runId: 'run-checkpoint-fork' });
        return written.summary.checkpointId;
    } finally {
        await runtime.dispose();
    }
}

test('project and projectless long pastes write unique UTF-8 files only in controlled roots', async t => {
    const sandbox = await mkdtemp(join(tmpdir(), 'nextmux-long-paste-'));
    const stateRoot = join(sandbox, 'state');
    const projectRoot = join(sandbox, 'project');
    await mkdir(projectRoot, { recursive: true });
    const previousStateRoot = process.env.NEXTMUX_DESKTOP_STATE_DIR;
    process.env.NEXTMUX_DESKTOP_STATE_DIR = stateRoot;
    t.after(async () => {
        if (previousStateRoot === undefined) delete process.env.NEXTMUX_DESKTOP_STATE_DIR;
        else process.env.NEXTMUX_DESKTOP_STATE_DIR = previousStateRoot;
        await rm(sandbox, { recursive: true, force: true });
    });

    const service = new NextMuxPlatformServiceImpl();
    authorizeWorkspace(service, projectRoot);
    const conversationId = '00000000-0000-4000-8000-000000000001';
    const conversationRoot = await service.getConversationWorkspace(conversationId);
    const sameContent = 'same content\n第二行\n';
    const [projectFirst, projectSecond, projectOther, projectConcurrent] = await Promise.all([
        service.cacheDesktopAttachment(request('first.txt', sameContent, { workspaceRoot: projectRoot, conversationId, unique: true })),
        service.cacheDesktopAttachment(request('second.txt', sameContent, { workspaceRoot: projectRoot, conversationId, unique: true })),
        service.cacheDesktopAttachment(request('third.txt', 'third content\n', { workspaceRoot: projectRoot, conversationId, unique: true })),
        service.cacheDesktopAttachment(request('fourth.txt', 'fourth content\n', { workspaceRoot: projectRoot, conversationId, unique: true }))
    ]);
    const [conversationFirst, conversationSecond] = await Promise.all([
        service.cacheDesktopAttachment(request('conversation-a.txt', sameContent, { conversationId, unique: true })),
        service.cacheDesktopAttachment(request('conversation-b.txt', sameContent, { conversationId, unique: true }))
    ]);

    const projectRecords = [projectFirst, projectSecond, projectOther, projectConcurrent];
    assert.equal(new Set(projectRecords.map(record => record.uri)).size, projectRecords.length);
    assert.notEqual(conversationFirst.uri, conversationSecond.uri);
    for (const record of projectRecords) {
        const path = fileURLToPath(record.uri);
        assert.equal(await isWithin(projectRoot, path), true);
        assert.match(record.workspaceRelativePath, /^\.nextmux\/conversation-attachments\/[a-f0-9]{64}-[0-9a-f-]{36}\.txt$/i);
    }
    for (const record of [conversationFirst, conversationSecond]) {
        const path = await realpath(fileURLToPath(record.uri));
        assert.equal(await isWithin(conversationRoot, path), true);
        assert.equal(await isWithin(stateRoot, path), true);
        assert.match(record.workspaceRelativePath, /^\.nextmux\/conversation-attachments\/[a-f0-9]{64}-[0-9a-f-]{36}\.txt$/i);
    }
    assert.equal(await readFile(fileURLToPath(projectFirst.uri), 'utf8'), sameContent);
    assert.equal(await readFile(fileURLToPath(projectSecond.uri), 'utf8'), sameContent);
    assert.equal(await readFile(fileURLToPath(conversationFirst.uri), 'utf8'), sameContent);
    assert.equal(
        await realpath(dirname(fileURLToPath(conversationFirst.uri))),
        await realpath(join(conversationRoot, '.nextmux', 'conversation-attachments'))
    );
});

test('attachment cache and reads stay inside an authorized controlled root with verified bytes', async t => {
    const sandbox = await mkdtemp(join(tmpdir(), 'nextmux-attachment-boundary-'));
    const stateRoot = join(sandbox, 'state');
    const projectRoot = join(sandbox, 'project');
    const otherRoot = join(sandbox, 'other');
    await Promise.all([mkdir(projectRoot, { recursive: true }), mkdir(otherRoot, { recursive: true })]);
    const previousStateRoot = process.env.NEXTMUX_DESKTOP_STATE_DIR;
    process.env.NEXTMUX_DESKTOP_STATE_DIR = stateRoot;
    t.after(async () => {
        if (previousStateRoot === undefined) delete process.env.NEXTMUX_DESKTOP_STATE_DIR;
        else process.env.NEXTMUX_DESKTOP_STATE_DIR = previousStateRoot;
        await rm(sandbox, { recursive: true, force: true });
    });

    const service = new NextMuxPlatformServiceImpl();
    authorizeWorkspace(service, projectRoot);
    const conversationId = '00000000-0000-4000-8000-000000000020';
    await assert.rejects(
        service.cacheDesktopAttachment(request('outside.txt', 'blocked', { workspaceRoot: otherRoot, conversationId })),
        attachmentReason('ATTACHMENT_WORKSPACE_UNAUTHORIZED', 'ATTACHMENT_WORKSPACE_UNAUTHORIZED')
    );

    const cached = await service.cacheDesktopAttachment(request('safe.txt', 'verified text', {
        workspaceRoot: projectRoot, conversationId
    }));
    const recovered = await service.readDesktopAttachment({
        uri: cached.uri,
        name: 'safe.txt',
        size: cached.size,
        workspaceRelativePath: cached.workspaceRelativePath,
        workspaceRoot: projectRoot,
        conversationId
    });
    assert.equal(Buffer.from(recovered.dataBase64, 'base64').toString('utf8'), 'verified text');

    const outside = join(otherRoot, 'outside.txt');
    await writeFile(outside, 'same length!!!', 'utf8');
    await assert.rejects(service.readDesktopAttachment({
        uri: pathToFileURL(outside).toString(), name: 'outside.txt', size: 14,
        workspaceRoot: projectRoot, conversationId
    }), attachmentReason('ATTACHMENT_READ_UNSAFE', 'ATTACHMENT_OUTSIDE_CACHE'));
    await assert.rejects(service.readDesktopAttachment({
        uri: 'file://remote-host/share/file.txt', name: 'file.txt', size: 1,
        workspaceRoot: projectRoot, conversationId
    }), attachmentReason('ATTACHMENT_READ_UNSAFE', 'ATTACHMENT_REMOTE_UNSAFE'));

    await writeFile(fileURLToPath(cached.uri), 'tampered text', 'utf8');
    await assert.rejects(service.readDesktopAttachment({
        uri: cached.uri, name: 'safe.txt', size: cached.size,
        workspaceRelativePath: cached.workspaceRelativePath,
        workspaceRoot: projectRoot, conversationId
    }), attachmentReason('ATTACHMENT_CACHE_MISMATCH', 'ATTACHMENT_DIGEST_MISMATCH'));
});

test('content-addressed EEXIST never trusts a symlink or mismatched regular file', async t => {
    const sandbox = await mkdtemp(join(tmpdir(), 'nextmux-attachment-eexist-'));
    const stateRoot = join(sandbox, 'state');
    const previousStateRoot = process.env.NEXTMUX_DESKTOP_STATE_DIR;
    process.env.NEXTMUX_DESKTOP_STATE_DIR = stateRoot;
    t.after(async () => {
        if (previousStateRoot === undefined) delete process.env.NEXTMUX_DESKTOP_STATE_DIR;
        else process.env.NEXTMUX_DESKTOP_STATE_DIR = previousStateRoot;
        await rm(sandbox, { recursive: true, force: true });
    });
    const service = new NextMuxPlatformServiceImpl();
    const first = await service.cacheDesktopAttachment(request('same.txt', 'expected bytes'));
    await writeFile(fileURLToPath(first.uri), 'tampered bytes', 'utf8');
    await assert.rejects(service.cacheDesktopAttachment(request('same.txt', 'expected bytes')), attachmentReason('ATTACHMENT_CACHE_MISMATCH', 'ATTACHMENT_DIGEST_MISMATCH'));

    await rm(fileURLToPath(first.uri), { force: true });
    const outside = join(sandbox, 'outside.txt');
    await writeFile(outside, 'expected bytes', 'utf8');
    try {
        await symlink(outside, fileURLToPath(first.uri), 'file');
        await assert.rejects(service.cacheDesktopAttachment(request('same.txt', 'expected bytes')), attachmentReason('ATTACHMENT_CACHE_UNSAFE', 'ATTACHMENT_FILE_INVALID'));
    } catch (error) {
        if (error?.code !== 'EPERM') throw error;
    }
});

test('forking a projectless conversation preserves its private workspace without sharing mutable files', async t => {
    const sandbox = await mkdtemp(join(tmpdir(), 'nextmux-conversation-fork-'));
    const stateRoot = join(sandbox, 'state');
    const previousStateRoot = process.env.NEXTMUX_DESKTOP_STATE_DIR;
    process.env.NEXTMUX_DESKTOP_STATE_DIR = stateRoot;
    t.after(async () => {
        if (previousStateRoot === undefined) delete process.env.NEXTMUX_DESKTOP_STATE_DIR;
        else process.env.NEXTMUX_DESKTOP_STATE_DIR = previousStateRoot;
        await rm(sandbox, { recursive: true, force: true });
    });

    const service = new NextMuxPlatformServiceImpl();
    const sourceConversationId = '00000000-0000-4000-8000-000000000010';
    const targetConversationId = '00000000-0000-4000-8000-000000000011';
    const sourceRoot = await service.getConversationWorkspace(sourceConversationId);
    const attachment = await service.cacheDesktopAttachment(request('history.txt', 'branch memory\n', {
        conversationId: sourceConversationId,
        unique: true
    }));
    await writeFile(join(sourceRoot, 'created-by-agent.txt'), 'source state\n', 'utf8');

    const forked = await service.forkConversationWorkspace(sourceConversationId, targetConversationId);
    const targetRoot = await realpath(forked.workspaceRoot);
    assert.equal(targetRoot, await realpath(await service.getConversationWorkspace(targetConversationId)));
    assert.equal(forked.filesCopied >= 2, true);
    assert.equal(await readFile(join(targetRoot, 'created-by-agent.txt'), 'utf8'), 'source state\n');
    assert.equal(await readFile(join(targetRoot, attachment.workspaceRelativePath), 'utf8'), 'branch memory\n');

    await writeFile(join(targetRoot, 'created-by-agent.txt'), 'branch state\n', 'utf8');
    assert.equal(await readFile(join(sourceRoot, 'created-by-agent.txt'), 'utf8'), 'source state\n');
    await assert.rejects(
        service.forkConversationWorkspace(sourceConversationId, sourceConversationId),
        /不同的对话/
    );
});

test('projectless fork rebinds and restores real checkpoints only in the target workspace', async t => {
    const sandbox = await mkdtemp(join(tmpdir(), 'nextmux-conversation-checkpoint-fork-'));
    const stateRoot = join(sandbox, 'state');
    const previousStateRoot = process.env.NEXTMUX_DESKTOP_STATE_DIR;
    process.env.NEXTMUX_DESKTOP_STATE_DIR = stateRoot;
    t.after(async () => {
        if (previousStateRoot === undefined) delete process.env.NEXTMUX_DESKTOP_STATE_DIR;
        else process.env.NEXTMUX_DESKTOP_STATE_DIR = previousStateRoot;
        await rm(sandbox, { recursive: true, force: true });
    });

    const service = new NextMuxPlatformServiceImpl();
    const sourceId = '00000000-0000-4000-8000-000000000012';
    const targetId = '00000000-0000-4000-8000-000000000013';
    const sourceRoot = await service.getConversationWorkspace(sourceId);
    const checkpointId = await createFileCheckpoint(
        sourceRoot,
        service.agentCheckpointRoot(sourceRoot),
        'timeline.txt',
        'turn-59\n',
        'turn-60\n'
    );

    const forked = await service.forkConversationWorkspace(sourceId, targetId, [checkpointId]);
    assert.equal(await readFile(join(forked.workspaceRoot, 'timeline.txt'), 'utf8'), 'turn-59\n');
    assert.equal(await readFile(join(sourceRoot, 'timeline.txt'), 'utf8'), 'turn-60\n');
});

test('project branch rollback uses a private workspace and never mutates the source project', async t => {
    const sandbox = await mkdtemp(join(tmpdir(), 'nextmux-project-checkpoint-fork-'));
    const stateRoot = join(sandbox, 'state');
    const projectRoot = join(sandbox, 'project');
    const previousStateRoot = process.env.NEXTMUX_DESKTOP_STATE_DIR;
    process.env.NEXTMUX_DESKTOP_STATE_DIR = stateRoot;
    await mkdir(projectRoot, { recursive: true });
    t.after(async () => {
        if (previousStateRoot === undefined) delete process.env.NEXTMUX_DESKTOP_STATE_DIR;
        else process.env.NEXTMUX_DESKTOP_STATE_DIR = previousStateRoot;
        await rm(sandbox, { recursive: true, force: true });
    });

    const service = new NextMuxPlatformServiceImpl();
    authorizeWorkspace(service, projectRoot);
    const sourceId = '00000000-0000-4000-8000-000000000014';
    const targetId = '00000000-0000-4000-8000-000000000015';
    const checkpointId = await createFileCheckpoint(
        projectRoot,
        service.agentCheckpointRoot(projectRoot),
        'timeline.txt',
        'turn-59\n',
        'turn-60\n'
    );

    const forked = await service.forkProjectConversationWorkspace(
        sourceId,
        targetId,
        projectRoot,
        [checkpointId]
    );
    assert.notEqual(await realpath(forked.workspaceRoot), await realpath(projectRoot));
    assert.equal(await isWithin(stateRoot, forked.workspaceRoot), true);
    assert.equal(await readFile(join(forked.workspaceRoot, 'timeline.txt'), 'utf8'), 'turn-59\n');
    assert.equal(await readFile(join(projectRoot, 'timeline.txt'), 'utf8'), 'turn-60\n');

    await writeFile(join(forked.workspaceRoot, 'timeline.txt'), 'branch-only\n', 'utf8');
    assert.equal(await readFile(join(projectRoot, 'timeline.txt'), 'utf8'), 'turn-60\n');
});

test('projectless fork enforces copy quotas and removes every orphan after failure', async t => {
    const sandbox = await mkdtemp(join(tmpdir(), 'nextmux-conversation-fork-limits-'));
    const stateRoot = join(sandbox, 'state');
    const previousStateRoot = process.env.NEXTMUX_DESKTOP_STATE_DIR;
    process.env.NEXTMUX_DESKTOP_STATE_DIR = stateRoot;
    t.after(async () => {
        if (previousStateRoot === undefined) delete process.env.NEXTMUX_DESKTOP_STATE_DIR;
        else process.env.NEXTMUX_DESKTOP_STATE_DIR = previousStateRoot;
        await rm(sandbox, { recursive: true, force: true });
    });
    const service = new NextMuxPlatformServiceImpl();
    service.conversationForkLimits = () => ({ maxFiles: 10, maxSingleFileBytes: 8, maxTotalBytes: 12, reserveBytes: 1 });
    const sourceId = '00000000-0000-4000-8000-000000000030';
    const targetId = '00000000-0000-4000-8000-000000000031';
    const sourceRoot = await service.getConversationWorkspace(sourceId);
    await writeFile(join(sourceRoot, 'too-large.txt'), '123456789', 'utf8');
    await assert.rejects(service.forkConversationWorkspace(sourceId, targetId), /限制|过大|limit/i);
    const targetRoot = join(stateRoot, 'conversation-workspaces', targetId);
    await assert.rejects(realpath(targetRoot), /ENOENT/);

    const secondTargetId = '00000000-0000-4000-8000-000000000032';
    await rm(join(sourceRoot, 'too-large.txt'));
    await writeFile(join(sourceRoot, 'a.txt'), '1234567', 'utf8');
    await writeFile(join(sourceRoot, 'b.txt'), '1234567', 'utf8');
    await assert.rejects(service.forkConversationWorkspace(sourceId, secondTargetId), /限制|总大小|limit/i);
    await assert.rejects(realpath(join(stateRoot, 'conversation-workspaces', secondTargetId)), /ENOENT/);

    const thirdTargetId = '00000000-0000-4000-8000-000000000033';
    await Promise.all([rm(join(sourceRoot, 'a.txt')), rm(join(sourceRoot, 'b.txt'))]);
    await writeFile(join(sourceRoot, 'workspace.txt'), '1234567', 'utf8');
    const checkpointRoot = service.agentCheckpointRoot(sourceRoot);
    await mkdir(checkpointRoot, { recursive: true });
    await writeFile(join(checkpointRoot, 'checkpoint.txt'), '7654321', 'utf8');
    await assert.rejects(service.forkConversationWorkspace(sourceId, thirdTargetId), /限制|总大小|limit/i);
    await assert.rejects(realpath(join(stateRoot, 'conversation-workspaces', thirdTargetId)), /ENOENT/);
});
