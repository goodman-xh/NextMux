import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { goalRequestObjective } from '../lib/browser/nextmux-goal-presentation.js';

const widget = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
const parsed = ts.createSourceFile('widget.tsx', widget, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widgetClass = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');

const methodBody = name => {
  const method = widgetClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(parsed) === name);
  assert.ok(method, `${name} should exist`);
  return method.getText(parsed);
};

test('plain text and attachment composer drafts persist through one per-session debounce', () => {
  const persist = methodBody('persistComposerDraft');
  const schedule = methodBody('scheduleComposerDraftPersist');

  assert.match(persist, /draftPrompt:\s*this\.prompt\s*\|\|\s*undefined/);
  assert.match(persist, /draftAttachments:\s*draftAttachments\.length\s*\?\s*draftAttachments\s*:\s*undefined/);
  assert.match(persist, /const sessionId = this\.activeCodingSessionId/);
  assert.doesNotMatch(persist, /conversationMutations|scheduleComposerDraftPersist\(\)/);
  assert.match(schedule, /ensureCodingSession\(/);
  assert.match(schedule, /const sessionId = this\.activeCodingSessionId/);
  assert.match(schedule, /setTimeout\(\(\) =>[\s\S]*?activeCodingSessionId === sessionId[\s\S]*?,\s*250\)/);
  assert.match(widget, /<textarea[\s\S]*?onInput=\{event => \{[\s\S]*?this\.prompt = event\.currentTarget\.value;[\s\S]*?this\.scheduleComposerDraftPersist\(\)/);
});

test('switching conversations flushes the old draft before restoring the target draft', () => {
  const open = methodBody('openCodingSession');
  assert.match(open, /this\.flushComposerDraft\(\)[\s\S]*?this\.activeCodingSessionId = session\.id[\s\S]*?this\.restoreComposerDraft\(session\)/);

  const startNew = methodBody('startNewCodingTask');
  assert.match(startNew, /this\.flushComposerDraft\(\)[\s\S]*?this\.activeCodingSessionId = ''/);
});

test('historical editing flushes a pending draft before snapshotting the source', () => {
  const request = methodBody('requestTurnEditConfirmation');
  assert.ok(request.indexOf('this.flushComposerDraft()') < request.indexOf('this.codingSessions.find('));
});

test('restored attachments cannot overwrite files added while durable bytes are loading', () => {
  const restore = methodBody('restoreComposerDraft');
  assert.match(restore, /this\.draftAttachmentRestores\.get\(sessionId\) !== entry/);
  assert.match(restore, /if \(this\.activeCodingSessionId === sessionId\)/);
  assert.match(restore, /new Map\(\[\.\.\.loaded, \.\.\.this\.attachments\]/);
  assert.match(restore, /this\.attachments = \(owner\.draftAttachments \|\| \[\]\)\.flatMap/);
});

test('queuing or sending a prompt clears the durable composer draft immediately', () => {
  const runningSubmit = methodBody('submitRunningMessage');
  assert.match(runningSubmit, /submittedComposerToken[\s\S]*?await this\.waitForPastedTextPersistence[\s\S]*?currentComposerToken\(\) !== submittedComposerToken[\s\S]*?this\.(?:setComposerPrompt\(''\)|prompt = '')[\s\S]*?this\.persistComposerDraft\(\)/);
  const normalSubmit = methodBody('executePromptSubmission');
  assert.match(methodBody('submitPrompt'), /this\.executePromptSubmission\(workbench, queuedExecution, resumedExecution, historicalExecution, submission\)/);
  assert.match(normalSubmit, /submittedComposerToken[\s\S]*?await this\.waitForPastedTextPersistence[\s\S]*?composerStillMatches\(\)[\s\S]*?appendCodingTurn[\s\S]*?this\.(?:setComposerPrompt\(''\)|prompt = '')[\s\S]*?this\.attachments = \[\]/);
  assert.doesNotMatch(normalSubmit, /this\.persistComposerDraft\(\)/);
});

test('workspace provisioning merges the newest session snapshot after its await', () => {
  const ensure = methodBody('ensureCodingSessionWorkspace');
  assert.ok(ensure.indexOf('await this.platformService.getConversationWorkspace') < ensure.indexOf('const current = this.codingSessions.find'));
  assert.match(ensure, /const latest = current \|\| session/);
  assert.match(ensure, /const updated: CodingSessionRecord = \{\s*\.\.\.latest,/);
});

test('application shutdown synchronously snapshots the draft and awaits durable history', () => {
  const body = methodBody('shutdownForApplicationExit');
  const snapshot = body.indexOf('this.flushComposerDraft()');
  const history = body.indexOf('await wait(this.flushConversationHistory())');
  const workspace = body.indexOf('await wait(this.workspaceConfigurationSaver.flush())');
  assert.ok(snapshot >= 0 && history > snapshot && workspace > history,
    'the synchronous draft snapshot must precede durable history and workspace persistence');
  assert.match(body, /Promise\.allSettled\(\[\.\.\.this\.pastedTextPersistence\.values\(\)\]\)/);
  assert.match(body, /if \(this\.conversationHistoryPersistDirty\) await wait\(this\.flushConversationHistory\(\)\)/);
  assert.match(body, /signal\?\.addEventListener\('abort', cancel, \{ once: true \}\)/,
    'the wrapper must retain cancellation while joining durable work');
});

test('actual draft flush is a no-op on navigation and never replaces a named empty conversation title', () => {
  const Harness = Function('window', 'serializePastedTextReferences', 'goalRequestObjective', ts.transpile(
    `class Harness { ${methodBody('persistComposerDraft')} ${methodBody('codingSessionTitle')} }; return Harness;`,
    { target: ts.ScriptTarget.ES2022 }))({ clearTimeout() {} }, JSON.stringify, goalRequestObjective);
  const named = { id: 'named', title: 'Model-created named conversation', turns: [], historyLoaded: true, createdAt: 1, updatedAt: 1 };
  let saves = 0;
  const state = Object.assign(new Harness(), { activeCodingSessionId: 'named', prompt: '', codingSessions: [named],
    pruneUnpersistedPastedTextReferences() {}, activePastedTextReferences: () => [], composerDraftAttachmentReferences: () => [],
    persistCodingSessions() { saves++; } });
  state.persistComposerDraft();
  assert.equal(state.codingSessions[0], named); assert.equal(saves, 0);
  state.prompt = 'A new unsent draft'; state.persistComposerDraft();
  assert.equal(state.codingSessions[0].title, named.title); assert.equal(state.codingSessions[0].draftPrompt, state.prompt);
  state.prompt = ''; state.persistComposerDraft(); assert.equal(state.codingSessions[0].title, named.title);
  state.codingSessions = [{ ...named, title: '新对话' }];
  state.prompt = 'User-authored default-like title'; state.persistComposerDraft();
  assert.equal(state.codingSessions[0].title, '新对话', 'an unmarked historical/user title is not identified by its text');
  state.codingSessions = [{ ...named, title: 'New conversation' }];
  state.prompt = 'Keep the explicit English title'; state.persistComposerDraft();
  assert.equal(state.codingSessions[0].title, 'New conversation', 'a user-authored canonical default title remains literal too');
  state.codingSessions = [{ ...named, title: 'Exact old draft', draftPrompt: 'Exact old draft' }];
  state.prompt = 'The replacement draft'; state.persistComposerDraft();
  assert.equal(state.codingSessions[0].title, 'Exact old draft', 'a manual title equal to the previous draft remains literal');
  state.codingSessions = [{ ...named, title: 'New conversation', titleOrigin: 'default' }];
  state.prompt = 'Automatic draft title'; state.persistComposerDraft(); assert.equal(state.codingSessions[0].title, state.prompt);
  state.prompt = 'Updated automatic title'; state.persistComposerDraft(); assert.equal(state.codingSessions[0].title, state.prompt);
  assert.equal(state.codingSessions[0].titleOrigin, 'draft', 'a prompt-derived title retains explicit draft provenance');
});
