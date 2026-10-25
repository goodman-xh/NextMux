import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { ConversationStore, ConversationStoreError, conversationIdsDigest } from '../lib/node/nextmux-conversation-store.js';
import { HIDDEN_PROJECTS_STORAGE_KEY, projectMenuText, readHiddenProjects } from '../lib/browser/nextmux-project-menu.js';
import { codingProjectPathKey } from '../lib/browser/nextmux-sidebar-projects.js';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { desktopDomainErrorText } from '../lib/browser/nextmux-domain-error-locale.js';
import { DesktopDomainError } from '../lib/common/nextmux-domain-errors.js';
import { conversationAgentRunActive } from '../lib/browser/nextmux-conversation-agent-run.js';

const fixture = (id, workspacePath = '/workspace/project') => ({ id, workspacePath, title: `Private ${id}`, turns: [{ id: 'turn', prompt: `secret ${id}`, response: 'response' }], createdAt: 1, updatedAt: 2 });
async function makeStore(t) {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-project-delete-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    return new ConversationStore(root);
}

async function projectRemovalHarness() {
    const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
    const methods = ['confirmProjectRemoval', 'codingSessionDeletionBlocked', 'conversationHasActiveRun']
        .map(name => widget.members.find(node => node.name?.getText(file) === name).getText(file)).join('\n');
    return new Function('desktopDomainErrorText', 'projectMenuText', 'DesktopDomainError', 'codingProjectPathKey', 'conversationAgentRunActive', ts.transpile(
        `class Harness { conversationAgentRuns = new Map(); conversationWindows = []; scheduledAgentRuns = new Map(); agentChildContinuationStates = new Map(); ${methods} }; return Harness;`, { target: ts.ScriptTarget.ES2022 }
    ))(desktopDomainErrorText, projectMenuText, DesktopDomainError, codingProjectPathKey, conversationAgentRunActive);
}

test('hidden projects persist as UI preferences without changing project paths or conversations', () => {
    assert.equal(HIDDEN_PROJECTS_STORAGE_KEY, 'nextmux.desktop.hiddenProjects.v1');
    const projects = ['/Users/test/My Project', 'C:\\Users\\User\\项目'];
    assert.deepEqual([...readHiddenProjects(JSON.stringify(projects))], projects);
    assert.deepEqual([...readHiddenProjects(JSON.stringify([projects[0], projects[0], null, 3, '', 'bad\0path']))], [projects[0]]);
    assert.equal(readHiddenProjects('corrupt').size, 0);
});

test('project plus starts a conversation for that project and the agent drawer has no duplicate browser entry', async () => {
    const widget = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    assert.match(widget, /className='nmx-project-add'[\s\S]*?openCodingSessionForWorkspace\(workspace\.path\)/);
    assert.match(widget, /className='nmx-project-add'[\s\S]*?onPointerDown=\{event => \{ event\.stopPropagation\(\); \}\}/);
    assert.match(widget, /event\.nativeEvent\.stopImmediatePropagation\?\.\(\)/);
    assert.equal((widget.match(/nmx-agent-open-browser/g) || []).length, 1);
    const stopStart = widget.indexOf('protected async stopAgentRun(): Promise<void>');
    const stopEnd = widget.indexOf('protected completedAgentSummary', stopStart);
    assert.ok(stopStart >= 0 && stopEnd > stopStart);
    const stop = widget.slice(stopStart, stopEnd);
    assert.match(stop, /run\.agentStage = 'cancelled'/);
    assert.match(stop, /run\.agentStartController\?\.abort\(\)/);
});

test('project menu warns accurately in every supported locale', () => {
    for (const locale of ['zh-CN', 'zh-TW', 'en-US', 'de', 'fr', 'es', 'it', 'pt-BR', 'ja', 'ko', 'ru', 'ar', 'hi']) {
        for (const key of ['delete', 'title', 'hint', 'erase', 'warning', 'busy', 'failed', 'cancel', 'saving']) {
            assert.ok(projectMenuText(locale, key).length > 0);
            if (locale === 'hi') assert.match(projectMenuText(locale, key), /\p{Script=Devanagari}/u);
        }
    }
    assert.match(projectMenuText('zh-CN', 'hint'), /保留对话和文件/);
    assert.match(projectMenuText('zh-CN', 'warning'), /不会删除磁盘/);
});

test('project deletion presents a localized RPC reason and keeps the project and conversation after failure', async () => {
    const Harness = await projectRemovalHarness();
    const failure = new ConversationStoreError('STORE_UNAVAILABLE', 'store_write_lock_unavailable', { cause: new Error('RAW_LOCK_DIAGNOSTIC') });
    const rpcFailure = JSON.parse(JSON.stringify({ code: failure.code, message: failure.message, data: failure.data }));
    let released = 0, requests = 0;
    const session = fixture('one');
    const state = Object.assign(new Harness(), {
        desktopLocale: 'ja', projectDeletePath: session.workspacePath, projectMenuPath: session.workspacePath,
        projectDeleteConversations: true, projectDeleteBusy: false, codingSessions: [session], scheduledTasks: [],
        runningScheduledTaskIds: new Set(), agentChildContinuationStates: new Map(),
        conversationHistoryReady: () => true, conversationHistoryPersistDirty: false,
        conversationMutations: { tryAcquire: () => () => { released++; } },
        flushComposerDraft() {}, async flushConversationHistory() {}, update() {},
        setProjectVisible() { assert.fail('failed deletion must not hide the project'); },
        platformService: { async deleteProjectConversationHistory() { requests++; throw rpcFailure; } }
    });
    await state.confirmProjectRemoval();
    assert.equal(requests, 1); assert.equal(released, 1); assert.equal(state.projectDeleteBusy, false);
    assert.equal(state.projectDeletePath, session.workspacePath); assert.equal(state.codingSessions[0], session);
    assert.equal(state.projectDeleteError, desktopDomainErrorText('ja', rpcFailure));
    assert.match(state.projectDeleteError, /[\p{Script=Hiragana}\p{Script=Katakana}]/u);
    assert.doesNotMatch(state.projectDeleteError, /RAW_LOCK_DIAGNOSTIC|Cannot acquire|model|モデル/i);
});

test('project deletion guards preserve their exact busy or history reason in all 12 locales without deleting anything', async () => {
    const Harness = await projectRemovalHarness();
    for (const locale of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
        for (const [guard, code] of [
            ['history', 'PROJECT_HISTORY_NOT_READY'],
            ['running', 'PROJECT_CONVERSATIONS_BUSY'],
            ['mutation', 'PROJECT_CONVERSATIONS_BUSY'],
            ['unsaved', 'PROJECT_HISTORY_NOT_SAVED']
        ]) {
            const session = fixture('guarded');
            if (guard === 'running') session.turns[0].stage = 'running';
            let requests = 0, flushes = 0, releases = 0;
            const state = Object.assign(new Harness(), {
                desktopLocale: locale, projectDeletePath: session.workspacePath, projectMenuPath: session.workspacePath,
                projectDeleteConversations: true, projectDeleteBusy: false, codingSessions: [session], scheduledTasks: [],
                runningScheduledTaskIds: new Set(), agentChildContinuationStates: new Map(),
                conversationHistoryReady: () => guard !== 'history', conversationHistoryPersistDirty: guard === 'unsaved',
                conversationMutations: { tryAcquire: () => guard === 'mutation' ? undefined : () => { releases++; } },
                flushComposerDraft() { flushes++; }, async flushConversationHistory() { flushes++; }, update() {},
                setProjectVisible() { assert.fail('a guarded project remains visible'); },
                platformService: { async deleteProjectConversationHistory() { requests++; throw new Error('UNEXPECTED_DELETE'); } }
            });
            await state.confirmProjectRemoval();
            const expected = desktopDomainErrorText(locale, new DesktopDomainError(code, 'Canonical guard diagnostic'));
            const label = `${locale}: ${guard}`;
            assert.equal(state.projectDeleteError, expected, label);
            assert.notEqual(state.projectDeleteError, desktopDomainErrorText(locale, new Error('UNKNOWN_FAILURE')), label);
            if (locale !== 'en') assert.notEqual(state.projectDeleteError, desktopDomainErrorText('en', new DesktopDomainError(code, 'Canonical guard diagnostic')), label);
            assert.equal(requests, 0, label); assert.equal(flushes, guard === 'unsaved' ? 2 : 0, label);
            assert.equal(releases, guard === 'unsaved' ? 1 : 0, label); assert.equal(state.projectDeleteBusy, false, label);
            assert.equal(state.projectDeletePath, session.workspacePath, label); assert.equal(state.codingSessions[0], session, label);
            assert.doesNotMatch(state.projectDeleteError, /Canonical guard diagnostic|UNEXPECTED_DELETE|模型|model failure/i, label);
        }
    }
});

test('project deletion removes actual payloads, keeps adjacent and nested project histories, and survives restart', async t => {
    const store = await makeStore(t);
    const remove = [fixture('one'), fixture('two')];
    const keep = [fixture('neighbor', '/workspace/project-other'), fixture('nested', '/workspace/project/nested'), fixture('draft', '')];
    await store.save([...remove, ...keep]);
    const files = await readdir(store.root);
    const result = await store.deleteProject('/workspace/project');
    assert.deepEqual(new Set(result.removedSessionIds), new Set(['one', 'two']));
    const restarted = new ConversationStore(store.root);
    assert.deepEqual(new Set((await restarted.load()).sessions.map(item => item.id)), new Set(keep.map(item => item.id)));
    for (const id of ['one', 'two']) {
        const prefix = `session-${createHash('sha256').update(id).digest('hex')}-`;
        for (const file of files.filter(file => file.startsWith(prefix))) await assert.rejects(stat(join(store.root, file)), { code: 'ENOENT' });
    }
    assert.equal((await readdir(store.root)).filter(name => name.startsWith('session-')).length, keep.length);
    await restarted.patch(remove, []); // A delayed renderer write cannot resurrect deleted content.
    await restarted.save([...keep, ...remove]); // Nor can a full startup mirror or older window.
    assert.deepEqual(new Set((await restarted.load()).sessions.map(item => item.id)), new Set(keep.map(item => item.id)));
    assert.deepEqual(new Set((await restarted.load()).deletedSessionIds), new Set(['one', 'two']));
    const manifest = JSON.parse(await readFile(join(store.root, 'manifest-v1.json'), 'utf8'));
    assert.equal(manifest.minimumReaderVersion, 2, 'old readers must refuse to erase durable deletion markers');
});

test('project removal is ordered with concurrent updates and leaves a later new conversation usable', async t => {
    const store = await makeStore(t);
    await store.save([fixture('one'), fixture('other', '/other')]);
    await Promise.all([
        store.patch([fixture('two')], []),
        store.deleteProject('/workspace/project'),
        store.patch([fixture('one'), fixture('new')], [])
    ]);
    assert.deepEqual(new Set((await store.load()).sessions.map(item => item.id)), new Set(['other', 'new']));
});

test('failed project deletion keeps old manifest and payloads until retry commits', async t => {
    const store = await makeStore(t);
    await store.save([fixture('one'), fixture('other', '/other')]);
    const write = store.writeFile;
    store.writeFile = async (path, ...args) => {
        if (String(path).includes('manifest-v1.json.tmp-')) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
        return write(path, ...args);
    };
    await assert.rejects(store.deleteProject('/workspace/project'), { code: 'STORE_UNAVAILABLE' });
    assert.deepEqual(new Set((await store.load()).sessions.map(item => item.id)), new Set(['one', 'other']));
    store.writeFile = write;
    assert.deepEqual((await store.deleteProject('/workspace/project')).removedSessionIds, ['one']);
});

test('payload cleanup failures are surfaced and retry completes cleanup without restoring content', async t => {
    const store = await makeStore(t);
    await store.save([fixture('one'), fixture('other', '/other')]);
    const unlink = store.unlinkFile;
    store.unlinkFile = async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); };
    await assert.rejects(store.deleteProject('/workspace/project'), { code: 'STORE_UNAVAILABLE' });
    assert.deepEqual((await store.load()).sessions.map(item => item.id), ['other']);
    store.unlinkFile = unlink;
    await store.deleteProject('/workspace/project');
    assert.equal((await readdir(store.root)).filter(name => name.startsWith('session-')).length, 1);
    await store.patch([fixture('one')], []);
    assert.deepEqual((await store.load()).sessions.map(item => item.id), ['other']);
});

test('explicit archive import cannot accidentally reuse a permanently deleted ID', async t => {
    const store = await makeStore(t);
    await store.save([fixture('one')]);
    await store.deleteProject('/workspace/project');
    const options = { archiveSha256: 'a'.repeat(64), conflictPolicy: 'copy', expectedIdsDigest: conversationIdsDigest([]) };
    const result = await store.insertArchiveSessions([fixture('one')], options, async sessions => sessions);
    assert.equal(result.imported, 1);
    assert.notEqual(result.idMap.one, 'one');
    assert.equal((await store.load()).sessions.length, 1);
});

test('deleting an empty or unknown project is idempotent', async t => {
    const store = await makeStore(t);
    assert.deepEqual(await store.deleteProject('/empty'), { removedSessionIds: [] });
    await store.save([fixture('other', '/other')]);
    assert.deepEqual(await store.deleteProject('/empty'), { removedSessionIds: [] });
    assert.deepEqual((await store.load()).sessions.map(item => item.id), ['other']);
});

test('real project RPC blocks running, preparing and synchronous runs; never starts a model during deletion', async t => {
    const store = await makeStore(t);
    class Service extends NextMuxPlatformServiceImpl {
        nextmuxDataRoot() { return store.root; }
        async startAgentRunForProject() { return this.started(); }
        async executeAgentRun() { return this.started(); }
    }
    const service = new Service();
    await service.saveConversationHistory([fixture('one'), fixture('other', '/other')]);
    service.agentJobs.set('running', { status: 'running', recoveryRecord: { owner: { workspaceRoot: '/workspace/project' } } });
    await assert.rejects(service.deleteProjectConversationHistory('/workspace/project'), error => {
        assert.equal(error.code, 'PROJECT_BUSY');
        assert.equal(error.data?.domainError?.code, 'PROJECT_CONVERSATIONS_BUSY');
        assert.doesNotMatch(error.message, /\p{Script=Han}/u);
        return true;
    });
    service.agentJobs.clear();
    for (const method of ['startAgentRun', 'runAgent']) {
        const scope = method === 'runAgent' ? { toolScope: 'comic-json' } : {};
        let release;
        let notifyStarted;
        const entered = new Promise(resolve => { notifyStarted = resolve; });
        service.started = () => {
            const pending = new Promise(resolve => { release = resolve; });
            notifyStarted();
            return pending;
        };
        const run = service[method]({ workspaceRoot: '/workspace/project', ...scope });
        await assert.rejects(service.deleteProjectConversationHistory('/workspace/project'), { code: 'PROJECT_BUSY' });
        await Promise.race([entered, run.then(() => { throw new Error('run completed before entering the test callback'); })]);
        release({ runId: 'test-only', status: 'completed' });
        await run;
    }
    let releaseDelete;
    const original = service.conversationStore().deleteProject.bind(service.conversationStore());
    service.conversationStore().deleteProject = async path => {
        await new Promise(resolve => { releaseDelete = resolve; });
        return original(path);
    };
    const deletion = service.deleteProjectConversationHistory('/workspace/project');
    for (const method of ['startAgentRun', 'runAgent']) await assert.rejects(service[method]({ workspaceRoot: '/workspace/project', ...(method === 'runAgent' ? { toolScope: 'comic-json' } : {}) }), { code: 'PROJECT_BUSY' });
    while (!releaseDelete) await new Promise(resolve => setImmediate(resolve));
    releaseDelete();
    assert.deepEqual((await deletion).removedSessionIds, ['one']);
    assert.deepEqual((await service.loadConversationHistory()).sessions.map(session => session.id), ['other']);
    let executions = 0;
    service.started = async () => { executions += 1; return { status: 'completed' }; };
    for (const method of ['startAgentRun', 'runAgent']) {
        await assert.rejects(service[method]({ workspaceRoot: '/workspace/project', conversationId: 'one', resumeCheckpointId: 'old-checkpoint', ...(method === 'runAgent' ? { toolScope: 'comic-json' } : {}) }), { code: 'CONVERSATION_DELETED' });
    }
    assert.equal(executions, 0, 'a saved checkpoint cannot start a deleted conversation again');
});

test('real project RPC removes stale plaintext search cache while keeping unrelated durable history', async t => {
    const store = await makeStore(t);
    class Service extends NextMuxPlatformServiceImpl { nextmuxDataRoot() { return store.root; } }
    const service = new Service();
    await service.saveConversationHistory([fixture('one'), fixture('other', '/other')]);
    await writeFile(join(store.root, 'conversation-index-v1.json'), JSON.stringify([fixture('one')]));
    await service.deleteProjectConversationHistory('/workspace/project');
    await assert.rejects(readFile(join(store.root, 'conversation-index-v1.json')), { code: 'ENOENT' });
    assert.deepEqual((await service.searchConversationHistory({ query: 'one' })).matches, []);
    assert.equal((await service.searchConversationHistory({ query: 'other' })).matches.length, 1);
});

test('run preparation protects requested roots across fork resolution and releases every resolved root', async t => {
    const store = await makeStore(t);
    let resolveFork;
    let resolveRun;
    class Service extends NextMuxPlatformServiceImpl {
        nextmuxDataRoot() { return store.root; }
        resolveConversationForkRequest(request) {
            return new Promise(resolve => { resolveFork = () => resolve({ ...request,
                workspaceRoot: '/private/primary',
                workspaceBindings: [{ id: 'secondary', path: '/private/secondary' }]
            }); });
        }
        startAgentRunForProject() { return new Promise(resolve => { resolveRun = resolve; }); }
        executeAgentRun() { return new Promise(resolve => { resolveRun = resolve; }); }
    }
    const service = new Service();
    for (const method of ['startAgentRun', 'runAgent']) {
        resolveRun = undefined;
        const pending = service[method]({ workspaceRoot: '/requested', ...(method === 'runAgent' ? { toolScope: 'comic-json' } : {}) });
        assert.equal(service.pendingProjectRuns.get('/requested'), 1,
            'the request is protected synchronously before the first filesystem await');
        await assert.rejects(service.deleteProjectConversationHistory('/requested'), { code: 'PROJECT_BUSY' });
        resolveFork();
        while (!resolveRun) await new Promise(resolve => setImmediate(resolve));
        for (const path of ['/requested', '/private/primary', '/private/secondary']) {
            await assert.rejects(service.deleteProjectConversationHistory(path), { code: 'PROJECT_BUSY' });
        }
        resolveRun({ runId: 'test-only', status: 'completed' });
        await pending;
        assert.equal(service.pendingProjectRuns.size, 0);
    }
    service.resolveConversationForkRequest = async () => { throw new Error('invalid fork layout'); };
    for (const method of ['startAgentRun', 'runAgent']) {
        await assert.rejects(service[method]({ workspaceRoot: '/requested', ...(method === 'runAgent' ? { toolScope: 'comic-json' } : {}) }), /invalid fork layout/);
        assert.equal(service.pendingProjectRuns.size, 0, 'failed preparation must not leave a stuck project lock');
    }
});

test('project UI defaults to hide, blocks running mutations, awaits persistence, and centers only the root folder icon', async () => {
    const widget = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    const service = await readFile(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/browser/style/nextmux.css', import.meta.url), 'utf8');
    assert.match(widget, /projectDeleteConversations = false/);
    assert.match(widget, /onContextMenu=\{event => \{ event\.preventDefault\(\); event\.stopPropagation\(\); this\.openProjectMenu\(workspace\.path\)/);
    assert.match(widget, /window\.getSelection\(\)\?\.removeAllRanges\(\)/);
    assert.match(widget, /role='menuitem'/);
    assert.match(widget, /await this\.flushConversationHistory\(\);[\s\S]{0,400}await this\.platformService\.deleteProjectConversationHistory\(path\)/);
    assert.match(widget, /conversationMutations\.tryAcquire\(session\.id\)/);
    assert.match(widget, /discardSessionFollowUpQueue\(session\)/);
    assert.match(widget, /result\.deletedSessionIds/);
    assert.match(service, /pendingProjectRuns\.has\(workspacePath\)/);
    assert.match(service, /job\.status === 'running' && job\.recoveryRecord\.owner\.workspaceRoot === workspacePath/);
    assert.match(service, /holdProjectRun\(request\.workspaceRoot\)/);
    assert.match(css, /\.nmx-project-header \.nmx-project-row \*\s*\{[^}]*user-select: none/);
    assert.match(css, /\.nmx-project-root-label > \.codicon\s*\{[^}]*align-items: center;[^}]*height: 20px;/);
});
