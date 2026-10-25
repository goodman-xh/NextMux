import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { AgentToolError, AgentToolRegistry, AgentVerificationTracker, DelegatedWorkspaceManager } from '@nextmux/agent-runtime';

// Execute the production helper directly; no Electron/browser environment needed.
const require = createRequire(import.meta.url);
const helperSource = readFileSync(new URL('../src/node/nextmux-delegated-workspace-tools.ts', import.meta.url), 'utf8');
const module = { exports: {} };
new Function('require', 'module', 'exports', ts.transpileModule(helperSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(require, module, module.exports);
const { registerDelegatedWorkspaceTools, writeDelegatedWorkspaceReviewArtifact } = module.exports;

async function fixture(t) {
    const home = await realpath(await mkdtemp(join(tmpdir(), 'nm-delegation-tools-')));
    const root = join(home, 'source'); await mkdir(root); await writeFile(join(root, 'a.txt'), 'before');
    t.after(() => rm(home, { recursive: true, force: true }));
    const manager = new DelegatedWorkspaceManager({ storageRoot: join(home, 'children'), checkpointRootForWorkspace: path => join(home, 'checkpoints', createHash('sha256').update(path).digest('hex')) });
    const child = await manager.prepare({ childRunId: `child-${randomUUID()}`, parentRunId: 'parent-a', rootRunId: 'root-a', conversationId: 'conversation-a', workspaceRoot: root, permissionMode: 'workspace_write' });
    await writeFile(join(child.workspaceRoot, 'a.txt'), 'after'); const review = await child.review();
    const registry = new AgentToolRegistry(); registerDelegatedWorkspaceTools(registry, { manager, workspaceRoot: root, conversationId: 'conversation-a' });
    const call = (name, args, permission = 'workspace_write') => registry.execute({ id: randomUUID(), name, arguments: args }, permission, { runId: 'review-run', workspaceRoot: root });
    return { home, root, manager, child, review, registry, call };
}

test('review opens an actual project-relative diff and only explicit merge invalidates existing verification', async t => {
    const f = await fixture(t);
    const blocked = await f.call('agent.merge_changes', { childRunId: f.review.childRunId, reviewId: f.review.reviewId });
    assert.equal(blocked.ok, false); assert.equal(blocked.error.code, 'CHILD_REVIEW_REQUIRED');
    const reviewed = await f.call('agent.review_changes', { childRunId: f.review.childRunId }, 'read_only');
    assert.equal(reviewed.ok, true); assert.equal(reviewed.summary.checkpointId, undefined); assert.equal(reviewed.summary.checkpointIds, undefined);
    assert.deepEqual([reviewed.summary.kind, reviewed.summary.title], ['agent.review_changes', 'Child task changes await review']);
    const resource = reviewed.summary.resource;
    assert.match(resource.path, /^\.nextmux\/reviews\/child-[a-f0-9-]+\/[a-f0-9]+\.diff$/);
    assert.match(await readFile(join(f.root, resource.path), 'utf8'), /-before[\s\S]*\+after/);
    const verification = new AgentVerificationTracker({ status: 'passed', revision: 1, changedPaths: ['previous.txt'], checks: [{ callId: 'check', command: 'node --test', status: 'passed', exitCode: 0, revision: 1, afterLastChange: true }] });
    verification.observe({ id: 'review', name: 'agent.review_changes', arguments: {} }, reviewed);
    assert.equal(verification.snapshot().status, 'passed');
    const merged = await f.call('agent.merge_changes', { childRunId: f.review.childRunId, reviewId: reviewed.output.reviewId });
    assert.equal(merged.ok, true); assert.deepEqual(merged.summary.changedPaths, ['a.txt']); assert.equal(merged.summary.checkpointIds.length, 1);
    assert.deepEqual([merged.summary.kind, merged.summary.title], ['agent.merge_changes', 'Merged child task; run validation again']);
    verification.observe({ id: 'merge', name: 'agent.merge_changes', arguments: {} }, merged);
    assert.equal(verification.snapshot().status, 'unverified'); assert.equal(verification.snapshot().checks[0].afterLastChange, false);
    assert.equal(await readFile(join(f.root, 'a.txt'), 'utf8'), 'after');
});

test('foreign conversation, read-only merge, symlink artifact and user-edited review are rejected', async t => {
    const f = await fixture(t), foreign = new AgentToolRegistry();
    registerDelegatedWorkspaceTools(foreign, { manager: f.manager, workspaceRoot: f.root, conversationId: 'conversation-b' });
    for (const name of ['agent.review_changes', 'agent.merge_changes']) {
        const result = await foreign.execute({ id: randomUUID(), name, arguments: { childRunId: f.review.childRunId, reviewId: f.review.reviewId } }, 'workspace_write', { runId: 'foreign' });
        assert.equal(result.ok, false); assert.equal(result.error.code, 'CHILD_WORKSPACE_OWNER_MISMATCH');
    }
    assert.equal((await f.call('agent.merge_changes', { childRunId: f.review.childRunId, reviewId: f.review.reviewId }, 'read_only')).ok, false);
    const outside = join(f.home, 'outside'); await mkdir(outside); await symlink(outside, join(f.root, '.nextmux'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(writeDelegatedWorkspaceReviewArtifact(f.root, f.review), { code: 'INVALID_REVIEW_PATH' });
    await rm(join(f.root, '.nextmux'));
    const path = await writeDelegatedWorkspaceReviewArtifact(f.root, f.review);
    await writeFile(join(f.root, path), 'user annotation');
    await assert.rejects(writeDelegatedWorkspaceReviewArtifact(f.root, f.review), { code: 'REVIEW_ARTIFACT_CONFLICT' });
    assert.equal(await readFile(join(f.root, path), 'utf8'), 'user annotation');
    await assert.rejects(writeDelegatedWorkspaceReviewArtifact(f.root, { ...f.review, childRunId: '../../outside' }), { code: 'INVALID_CHILD_WORKSPACE' });
});

const sourceFiles = new Map();
function sourceMethod(sourcePath, name) {
    let file = sourceFiles.get(sourcePath);
    if (!file) {
        const source = readFileSync(new URL(sourcePath, import.meta.url), 'utf8');
        file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        sourceFiles.set(sourcePath, file);
    }
    let found;
    const visit = node => { if (ts.isMethodDeclaration(node) && node.name.getText(file) === name) found = node; ts.forEachChild(node, visit); };
    visit(file); assert.ok(found, `production method ${name} exists`);
    return { node: found, file };
}

test('existing file activity opens the review in the file drawer without broadening the read root', async t => {
    const f = await fixture(t), reviewed = await f.call('agent.review_changes', { childRunId: f.review.childRunId });
    const methods = ['openToolFileActivity', 'codingSessionStoredWorkspaceRoots', 'resolveConversationTarget', 'beginContextFileOpen', 'finishContextFileOpen'].map(name => {
        const { node, file } = sourceMethod('../src/browser/nextmux-desktop-widget.tsx', name); return node.getText(file);
    });
    const URI = require('@theia/core/lib/common/uri').default;
    const { FileUri } = require('@theia/core/lib/common/file-uri');
    const { toFileOperationResult } = require('@theia/filesystem/lib/common/files');
    const { DiskFileSystemProvider } = require('@theia/filesystem/lib/node/disk-file-system-provider');
    const provider = new DiskFileSystemProvider(); t.after(() => provider.dispose());
    const bindings = { URI, FileUri, toFileOperationResult, FileOperationResult: { FILE_NOT_FOUND: 1 },
        ...require('../lib/browser/nextmux-conversation-file-target.js'),
        ...require('../lib/browser/nextmux-conversation-media.js'),
        localizeDesktopSurface: (_locale, text) => text, filePreviewErrorText: (_locale, key) => key };
    const Fixture = new Function(...Object.keys(bindings), ts.transpile(`class Fixture { ${methods.join('\n')} }; return Fixture;`,
        { target: ts.ScriptTarget.ES2022 }))(...Object.values(bindings));
    const widget = new Fixture(), resolved = [], notices = [];
    const session = { id: 'conversation-a', workspacePath: f.root, turns: [],
        workspaceBindings: [{ id: 'project', path: f.root, kind: 'project', status: 'available' }] };
    let opened;
    Object.assign(widget, { activeCodingSessionId: session.id, activeCodingSession: () => session, codingSessionWorkspaceRoot: () => f.root,
        contextFilePreviewRequestToken: 0, contextFilePreviewLoading: false, workContextOpen: false, workContextMode: 'file',
        detachContextEditorRecovery: () => true,
        fileService: { async resolve(uri) {
            resolved.push(FileUri.fsPath(uri)); const stat = await provider.stat(uri);
            return { resource: uri, isDirectory: Boolean(stat.type & 2) };
        } },
        rememberNavigation() {}, async loadContextFiles() {}, async previewContextFile(item) {
            opened = item; this.contextFilePreview = { ...item, content: (await provider.readFile(new URI(item.uri))).toString('utf8'), error: '' };
            this.finishContextFileOpen();
        },
        rememberContextFileTab() {}, persistActiveCodingSessionState() {}, update() {}, addNotification(...notice) { notices.push(notice); } });
    await widget.openToolFileActivity(reviewed.summary);
    assert.deepEqual(notices, [], 'resolver errors must not be swallowed by the fixture');
    assert.equal(opened.path, join(f.root, reviewed.summary.resource.path));
    assert.deepEqual(resolved, [opened.path]);
    assert.match(widget.contextFilePreview.content, /\+after/);
    assert.equal(widget.contextFilePreview.readOnly, true);
    opened = undefined; await widget.openToolFileActivity({ resource: { kind: 'file', path: '../outside.txt', action: 'read' } });
    assert.equal(opened, undefined);
    assert.equal(resolved.length, 1, 'path traversal is rejected before reaching the disk provider');
    assert.equal(notices.length, 1);
});

test('production child-resume normalization resolves owning workspace, clears parent PTY, and rejects foreign owners', async t => {
    const f = await fixture(t);
    const { node, file } = sourceMethod('../src/node/nextmux-platform-service.ts', 'startAgentRunForProject');
    const childNormalization = node.body.statements.find(statement => statement.getText(file).includes('request.childContinuation && request.conversationId'));
    assert.ok(childNormalization, 'startAgentRunForProject normalizes a resuming child run');
    const normalize = new Function('AgentToolError', ts.transpile(`return async function(request) { ${childNormalization.getText(file)}; return request; };`, { target: ts.ScriptTarget.ES2022 }))(AgentToolError);
    const host = { createDelegatedWorkspaceManager: () => f.manager };
    const request = { workspaceRoot: f.root, conversationId: 'conversation-a', terminalId: 42, permissionMode: 'read_only',
        childContinuation: { childRunId: f.review.childRunId, parentRunId: 'parent-a', rootRunId: 'root-a' } };
    const normalized = await normalize.call(host, request);
    assert.equal(normalized.workspaceRoot, f.child.workspaceRoot); assert.equal(normalized.terminalId, undefined);
    assert.equal(normalized.permissionMode, 'read_only'); assert.equal(request.workspaceRoot, f.root);
    await assert.rejects(normalize.call(host, { ...request, conversationId: 'conversation-b' }), { code: 'CHILD_WORKSPACE_OWNER_MISMATCH' });
    await assert.rejects(normalize.call(host, { ...request, childContinuation: { ...request.childContinuation, rootRunId: 'wrong-root' } }), { code: 'CHILD_WORKSPACE_OWNER_MISMATCH' });
});
