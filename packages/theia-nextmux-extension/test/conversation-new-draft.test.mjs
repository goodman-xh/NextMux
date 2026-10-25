import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
// The draft factory and the reuse predicate it consults (both real).
const methods = ['createCodingSessionForWorkspace', 'emptyCodingDraftCandidate'].map(name => {
    const method = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name);
    assert.ok(method, name);
    return method.getText(file);
});
const Harness = new Function('normalizeAgentChildScrollStates', 'requestAnimationFrame',
    ts.transpile(`class Harness { ${methods.join('\n')} }; return Harness;`, { target: ts.ScriptTarget.ES2022 }))(
    value => value || {}, () => 0);

function fixture(sessions) {
    return Object.assign(new Harness(), {
        workspaceOptions: [{ path: '/project' }], activeWorkspaceRoot: '/project',
        codingSessionNavigationGeneration: 3, codingSessions: sessions, expandedCodingProjects: new Set(),
        defaultPermissionMode: 'full_access', permissionMode: 'read_only',
        flushComposerDraft() {}, rememberNavigation() {}, setComposerPrompt(value) { this.prompt = value; },
        currentCodingSessionViewState: () => ({}), activeModelRoute: () => undefined, reasoningSettingsForRoute: () => ({}), restoreCodingSourceSelection() {}, recentCodingSource: () => undefined,
        restoreComposerDraft() {}, restoreCodingSessionState: async () => undefined,
        persistCodingSessions() {}, persistDesktopRestoreState() {}, update() {},
        // Nothing else holds the fixture conversations: no tiles, goal drafts, apps, tabs, terminals or pending imports.
        prompt: '', attachments: [], pastedTextReferences: [], tiledCodingSessionIds: new Set(), goalDraftsBySession: new Map(),
        composerApps: new Map(), conversationTabs: { tabs: {} }, terminalRecords: [],
        incognitoModeIsBusy: () => false, hasPendingAttachmentImports: () => false, hasPendingDraftAttachments: () => false
    });
}

test('new project conversation does not reuse a lazy history row as an empty draft', () => {
    const old = { id: 'old', workspacePath: '/project', title: '新对话', turns: [], historyLoaded: false,
        turnCount: 8, latestTurn: { id: 'last', stage: 'complete' }, createdAt: 1 };
    const state = fixture([old]);
    const created = state.createCodingSessionForWorkspace('/project');
    assert.notEqual(created.id, old.id);
    assert.equal(state.activeCodingSessionId, created.id);
    assert.equal(created.permissionMode, 'full_access');
    assert.equal(state.codingSessionNavigationGeneration, 4, 'late old opens must no longer own navigation');
    assert.equal(state.codingSessions.find(session => session.id === old.id), old, 'the original header remains intact');
});

test('new project conversation keeps named empty conversations and saved goals independent', () => {
    const sessions = [
        { id: 'named', workspacePath: '/project', title: 'Model created task', turns: [] },
        { id: 'goal', workspacePath: '/project', title: '新对话', turns: [], goal: { status: 'active' } },
        { id: 'queued', workspacePath: '/project', title: '新对话', turns: [], followUpQueue: [{ id: 'pending' }] }
    ];
    const state = fixture(sessions);
    const created = state.createCodingSessionForWorkspace('/project');
    assert.ok(!sessions.some(session => session.id === created.id));
    assert.deepEqual(state.codingSessions.slice(1), sessions);
});

test('repeated new-project clicks reuse a confirmed empty untitled draft', () => {
    const empty = { id: 'empty', workspacePath: '/project', title: 'New conversation', titleOrigin: 'default', turns: [], historyLoaded: true, turnCount: 0 };
    const state = fixture([empty]);
    assert.equal(state.createCodingSessionForWorkspace('/project'), empty);
    assert.equal(state.createCodingSessionForWorkspace('/project'), empty);
    assert.equal(state.codingSessions.length, 1);
});

test('a user title identical to a translated default remains an independent draft', () => {
    const user = { id: 'user', workspacePath: '/project', title: '新对话', turns: [], historyLoaded: true, turnCount: 0 };
    const state = fixture([user]);
    const created = state.createCodingSessionForWorkspace('/project');
    assert.notEqual(created.id, user.id);
    assert.equal(created.titleOrigin, 'default');
    assert.equal(user.title, '新对话');
});

test('first submission preserves a manual rename made while preparation awaited', () => {
    const append = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === 'appendCodingTurn');
    const AppendHarness = new Function('goalTurnPresentation',
        ts.transpile(`class Harness { ${append.getText(file)} }; return Harness;`, { target: ts.ScriptTarget.ES2022 }))(value => value);
    const stale = { id: 'draft', title: 'New conversation', titleOrigin: 'default', turns: [] };
    const renamed = { ...stale, title: '用户手动标题', titleOrigin: undefined };
    const state = Object.assign(new AppendHarness(), {
        codingSessions: [renamed], activeCodingSessionId: '',
        createCodingTurn: () => ({ id: 'turn', createdAt: 2 }),
        codingSessionTitle: value => value, persistCodingSessions() {}
    });
    state.appendCodingTurn(stale, 'First task', 'read_only', '', '');
    assert.equal(state.codingSessions[0].title, '用户手动标题');
    assert.equal(state.codingSessions[0].titleOrigin, undefined);
});
