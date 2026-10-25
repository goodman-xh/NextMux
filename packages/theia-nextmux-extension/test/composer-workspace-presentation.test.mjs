import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { randomUUID } from 'node:crypto';
import { goalTurnPresentation } from '../lib/browser/nextmux-goal-presentation.js';
import { reusableConversationForWorkspace } from '../lib/browser/nextmux-conversation-history.js';
import { codingProjectPathKey } from '../lib/browser/nextmux-sidebar-projects.js';

const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const style = readFileSync(new URL('../src/browser/style/nextmux.css', import.meta.url), 'utf8');

test('a selected draft project is mounted and the empty selector has no duplicate add icon', () => {
  // Only a chosen-but-unmounted draft folder warns; a folderless new conversation is the normal "Recent" case.
  assert.match(source, /workspaceUnavailable \|\| \(showDraftWorkspace && !workspace && Boolean\(this\.draftWorkspaceRoot\)\)/);
  assert.match(source, /if \(this\.globalCodingDraft\) \{[\s\S]*?this\.activeWorkspaceRoot = workspaceRoot;[\s\S]*?this\.globalCodingDraft = false;[\s\S]*?this\.draftWorkspaceRoot = '';/);
  assert.doesNotMatch(source, /nmx-composer-project-select[^\n]+codicon-add/);
  assert.match(style, /\.nmx-composer-project-select \{\s*grid-template-columns: 16px minmax\(0, 1fr\);/);
});

test('a restored draft displays its saved project even when Theia mounts another root', () => {
  const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
  const method = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === 'composerWorkspaceOption');
  const Harness = Function(ts.transpile(`class Harness { ${method.getText(file)} }; return Harness;`, { target: ts.ScriptTarget.ES2022 }))();
  const state = Object.assign(new Harness(), {
    workspaceOptions: [{ path: '/app/desktop', label: 'desktop' }, { path: '/known/project', label: 'Custom label' }],
    activeWorkspaceRoot: '/previous-project', draftWorkspaceRoot: ''
  });
  for (const incognitoOrigin of [false, true]) {
    const draft = { workspacePath: '/restored/selected-project', ownedWorkspace: false, incognitoOrigin };
    assert.deepEqual(state.composerWorkspaceOption(draft, true), { path: draft.workspacePath, label: 'selected-project' });
    assert.deepEqual(state.composerWorkspaceOption({ ...draft, workspacePath: 'C:\\work\\selected-project' }, true), { path: 'C:\\work\\selected-project', label: 'selected-project' });
  }
  assert.deepEqual(state.composerWorkspaceOption({ workspacePath: '/known/project' }, true), { path: '/known/project', label: 'Custom label' });
  assert.equal(state.composerWorkspaceOption({ workspacePath: '' }, true), undefined, 'a folderless session never borrows the last active project');
  assert.equal(state.composerWorkspaceOption(undefined, true), undefined, 'a new global draft stays folderless');
  state.draftWorkspaceRoot = '/chosen/project';
  assert.deepEqual(state.composerWorkspaceOption(undefined, true), { path: '/chosen/project', label: 'project' });
  assert.match(source, /const workspace = this\.composerWorkspaceOption\(codingSession, showDraftWorkspace\)/);
  assert.match(source, /<h2>\{workspace \? this\.projectQuestion\(workspace\.label\)/);
});

test('submitting a new draft uses only its chosen folder, including an explicitly removed folder', () => {
  const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
  const method = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === 'ensureCodingSession');
  const Harness = Function('reusableConversationForWorkspace', 'crypto', ts.transpile(
    `class Harness { ${method.getText(file)} }; return Harness;`, { target: ts.ScriptTarget.ES2022, removeComments: true }
  ))(reusableConversationForWorkspace, { randomUUID });
  for (const [globalCodingDraft, draftWorkspaceRoot, expected] of [
    [true, '', ''], [true, '/chosen-project', '/chosen-project'], [false, '', '/previous-project']
  ]) {
    let persisted;
    const state = Object.assign(new Harness(), {
      globalCodingDraft, draftWorkspaceRoot, activeWorkspaceRoot: '/previous-project', codingSessions: [],
      activeCodingSession() {}, workspaceRootIsOpen: () => true, codingSessionTitle: prompt => prompt,
      activeModelRoute() {}, reasoningSettingsForRoute: () => ({}), currentCodingSessionViewState: () => ({}), expandedCodingProjects: new Set(),
      composerApps: new Map(),
      persistCodingSessions() { persisted = this.codingSessions; }, persistDesktopRestoreState() {}
    });
    const session = state.ensureCodingSession('A new task');
    assert.equal(session.workspacePath, expected);
    assert.equal(persisted[0], session);
    assert.equal(state.activeCodingSessionId, session.id);
    assert.equal(state.globalCodingDraft, false);
  }
});

test('floating project folder icons are explicitly centered', () => {
  assert.match(style, /\.nmx-thread-files header > i \{[\s\S]*?place-items: center;[\s\S]*?align-self: center;[\s\S]*?line-height: 1;/);
  assert.match(style, /\.nmx-context-file-list > header i \{[\s\S]*?align-self: center;[\s\S]*?line-height: 1;/);
});

test('first submission names project-plus conversations and preserves explicit titles', () => {
  const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
  const method = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === 'appendCodingTurn');
  const Harness = Function('goalTurnPresentation', ts.transpile(`class Harness { ${method.getText(file)} }; return Harness;`, {
    target: ts.ScriptTarget.ES2022, removeComments: true
  }))(goalTurnPresentation);
  for (const [passedTitle, currentTitle, expected, passedOrigin, currentOrigin] of [
    ['New conversation', 'New conversation', 'Inspect the fixture', 'default', 'default'],
    ['新对话', '新对话', '新对话'],
    ['New conversation', 'New conversation', 'New conversation'],
    ['My named task', 'My named task', 'My named task'],
    ['Inspect', 'Inspect', 'Inspect'],
    ['New conversation', 'Renamed during preparation', 'Renamed during preparation', 'default'],
    // Draft titles saved mid-typing ("Insp") are provisional and follow the submitted message.
    ['Insp', 'Insp', 'Inspect the fixture', 'draft', 'draft'],
    ['Inspect the…', 'Inspect the…', 'Inspect the fixture', 'draft', 'draft'],
    ['Recovered draft', 'Recovered draft', 'Inspect the fixture', 'recoveredDraft', 'recoveredDraft']
  ]) {
    const session = { id: 'project-plus', title: passedTitle, titleOrigin: passedOrigin, turns: [], workspacePath: '/fixture' };
    let persisted;
    const state = Object.assign(new Harness(), {
      codingSessions: [{ ...session, title: currentTitle, titleOrigin: currentOrigin }], activeCodingSessionId: 'other',
      createCodingTurn: (_id, prompt) => ({ id: 'first', prompt, createdAt: 1 }),
      codingSessionTitle: prompt => prompt,
      persistCodingSessions() { persisted = this.codingSessions; }
    });
    state.appendCodingTurn(session, 'Inspect the fixture', 'read_only', 'model', 'Model', [], undefined, [], undefined, true);
    assert.equal(persisted[0].title, expected);
    assert.equal(persisted[0].turns.length, 1);
    state.appendCodingTurn(persisted[0], 'A later task', 'read_only', 'model', 'Model', [], undefined, [], undefined, true);
    assert.equal(persisted[0].title, expected, 'later messages do not rename the conversation');
  }
});

test('expanded floating file rail aligns folder, name, and refresh action', () => {
  assert.match(style, /\.nmx-thread-files header > i \{[\s\S]*?height: 20px;[\s\S]*?display: flex;[\s\S]*?align-items: center;[\s\S]*?line-height: 20px;/);
  assert.match(style, /\.nmx-thread-files:hover header strong,[\s\S]*?\.nmx-thread-files:focus-within header strong \{[\s\S]*?height: 20px;[\s\S]*?display: flex;[\s\S]*?align-items: center;[\s\S]*?line-height: 20px;/);
  assert.match(style, /\.nmx-thread-files:hover header button,[\s\S]*?\.nmx-thread-files:focus-within header button \{[\s\S]*?align-self: center;/);
});

test('new conversation body drop replaces or sets the project folder and shows project drop overlay copy', async () => {
  const { composerAttachmentUiText } = await import('../lib/browser/nextmux-composer-attachments.js');
  assert.equal(composerAttachmentUiText('zh-CN', 'dropProjectTitle'), '松开将文件夹设为项目文件夹');
  assert.match(composerAttachmentUiText('zh-CN', 'dropProjectHint'), /项目目录/);
  assert.match(source, /<ComposerDropOverlay locale=\{this\.desktopLocale\} variant='thread' asProject=\{this\.canDropFolderAsProject\(\)\} \/>/);
  const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
  const methods = ['canDropFolderAsProject', 'draftWorkspaceCanChange', 'unstartedCodingDraft', 'useDraftWorkspaceFolder', 'removeDraftWorkspace']
    .map(name => widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name).getText(file))
    .join('\n');
  const Harness = Function('desktopDomainErrorText', 'codingProjectPathKey', 'requestAnimationFrame', ts.transpile(`class Harness { ${methods} }; return Harness;`, { target: ts.ScriptTarget.ES2022, removeComments: true }))(() => '', codingProjectPathKey, () => 0);
  const bound = [];
  const state = Object.assign(new Harness(), {
    mode: 'coding',
    activeSection: 'coding',
    codingPanel: 'thread',
    applicationExitPreparing: false,
    codingSessionNavigationGeneration: 1,
    globalCodingDraft: false,
    draftWorkspaceRoot: '',
    activeWorkspaceRoot: '/initial-project',
    activeCodingSessionId: 'draft-1',
    workspaceOptions: [{ path: '/initial-project', label: 'initial-project' }, { path: '/dropped-second-project', label: 'dropped-second-project' }],
    codingSessions: [{ id: 'draft-1', title: '新对话', workspacePath: '/initial-project', ownedWorkspace: true, turns: [] }],
    expandedCodingProjects: new Set(),
    fileService: { resolve: async () => ({ isDirectory: true }) },
    setProjectVisible() {},
    node: { querySelector: () => undefined },
    leaveCouncilRoleSubConversationToConversation() {},
    activeCodingSession() { return this.codingSessions.find(s => s.id === this.activeCodingSessionId); },
    incognitoModeIsBusy() { return false; },
    async bindCodingDraftWorkspace(sessionId, path) {
      bound.push([sessionId, path]);
      const target = this.codingSessions.find(s => s.id === sessionId);
      if (target) target.workspacePath = path;
      this.activeWorkspaceRoot = path;
      return true;
    },
    persistCodingSessions() {},
    persistDesktopRestoreState() {},
    update() {}
  });
  assert.equal(state.canDropFolderAsProject(), true, 'unstarted session with existing folder still accepts dropped folder as replacement project');
  const accepted = await state.useDraftWorkspaceFolder({ path: { fsPath: () => '/dropped-second-project' } }, true);
  assert.equal(accepted, true);
  assert.equal(state.codingSessions[0].workspacePath, '/dropped-second-project');
  assert.equal(state.activeWorkspaceRoot, '/dropped-second-project');
  await state.removeDraftWorkspace();
  assert.equal(state.codingSessions[0].workspacePath, '');
  assert.deepEqual(bound, [['draft-1', '/dropped-second-project'], ['draft-1', '']]);
  assert.equal(state.canDropFolderAsProject(), true, 'unstarted session after removing folder also accepts dropped folder as project');
  state.codingSessions[0].turns = [{ id: 't1', prompt: 'started', createdAt: 1 }];
  assert.equal(state.canDropFolderAsProject(), false, 'started conversation keeps dropped folders as attachments');
});

test('sidebar reorders project folders, forbids cross-folder session drops, and sorts running sessions by latest run start', () => {
  const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
  const methods = [
    'codingSessionActivityAt',
    'codingSessionRunStartedAt',
    'orderedCodingSessions',
    'sameCodingSessionDragBucket',
    'orderedCodingProjects',
    'reorderCodingProject',
    'reorderCodingSession'
  ].map(name => widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name).getText(file)).join('\n');
  const Harness = Function('codingProjectPathKey', ts.transpile(`class Harness { ${methods} }; return Harness;`, { target: ts.ScriptTarget.ES2022, removeComments: true }))(codingProjectPathKey);
  const state = Object.assign(new Harness(), {
    codingProjectOrder: [],
    codingSessionOrder: [],
    codingSessionDragPinned: false,
    removedCodingSessionIds: new Set(),
    codingSessions: [
      { id: 'idle-pinned', workspacePath: '/proj-a', pinned: false, createdAt: 100, updatedAt: 500, turns: [{ id: '1', createdAt: 500, stage: 'completed' }] },
      { id: 'run-older', workspacePath: '/proj-a', pinned: false, createdAt: 200, updatedAt: 200, turns: [{ id: '2', createdAt: 200, stage: 'running' }] },
      { id: 'run-newer', workspacePath: '/proj-a', pinned: false, createdAt: 300, updatedAt: 300, turns: [{ id: '3', createdAt: 400, stage: 'running' }] },
      { id: 'other-proj', workspacePath: '/proj-b', pinned: false, createdAt: 600, updatedAt: 600, turns: [{ id: '4', createdAt: 600, stage: 'completed' }] }
    ],
    persistCodingSessions() {},
    update() {}
  });
  const ordered = state.orderedCodingSessions(state.codingSessions.filter(s => s.workspacePath === '/proj-a'));
  assert.deepEqual(ordered.map(s => s.id), ['run-newer', 'run-older', 'idle-pinned'], 'running sessions sort above idle sessions, newest run first');
  assert.equal(state.sameCodingSessionDragBucket('idle-pinned', 'run-older', false), true);
  assert.equal(state.sameCodingSessionDragBucket('idle-pinned', 'other-proj', false), false, 'cross-folder session drag is forbidden');
  state.reorderCodingSession('idle-pinned', 'other-proj', false);
  assert.deepEqual(state.codingSessionOrder, [], 'cross-folder reorder is ignored');

  const projects = [{ path: '/proj-a', label: 'A' }, { path: '/proj-b', label: 'B' }, { path: '/proj-c', label: 'C' }];
  state.reorderCodingProject('/proj-c', '/proj-a', projects);
  assert.deepEqual(state.orderedCodingProjects(projects).map(p => p.path), ['/proj-c', '/proj-a', '/proj-b']);
});

test('the three floats (files, notes, AGENTS.md) centre as one icon group and open 224px panels centred on the body', () => {
  const attachmentCss = readFileSync(new URL('../src/browser/style/nextmux-composer-attachments.css', import.meta.url), 'utf8');
  // Icons: each at top 50%, lifted by half its height and moved by its slot (36px icon + 8px gap), so the group of three is centred.
  assert.match(attachmentCss, /\.nmx-shell \.nmx-thread-float-tab \{[^}]*top: 50%;[^}]*translate: 0 calc\(-50% \+ var\(--nmx-float-slot, 0px\)\);[^}]*width: 36px; height: 36px;/);
  assert.match(attachmentCss, /\.nmx-thread-files > \.nmx-thread-float-tab \{ --nmx-float-slot: -44px; \}/);
  assert.match(attachmentCss, /\.nmx-thread-notes-float > \.nmx-thread-float-tab \{ --nmx-float-slot: 0px; \}/);
  assert.match(attachmentCss, /\.nmx-thread-agents-float > \.nmx-thread-float-tab \{ --nmx-float-slot: 44px; \}/);
  // Panels: centred on the conversation body, 224px wide, never taller than it.
  assert.match(attachmentCss, /\.nmx-thread-files:is\(:hover, :focus-within\) > div \{ top: 50%; translate: 0 -50%; right: 0; width: 224px; max-height: 100%;/);
  assert.match(attachmentCss, /\.nmx-shell \.nmx-thread-notes,\n\.nmx-shell \.nmx-thread-agents \{ position: absolute; top: 50%; right: 0; translate: 0 -50%;[^}]*width: 224px; max-height: 100%;/);
  assert.doesNotMatch(attachmentCss, /width: 208px/, 'one panel width for all three floats');
  assert.doesNotMatch(source, /compactContextFileName\(entry\.name,\s*10\)/);
  assert.doesNotMatch(source, /compactContextFileName\(selectedEntry\.name,\s*10\)/);
});

