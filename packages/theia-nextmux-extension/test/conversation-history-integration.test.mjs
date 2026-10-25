import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { incognitoText } from '../lib/browser/nextmux-incognito-text.js';
import ts from 'typescript';

import {
  createConversationHistoryMirror,
  mergeConversationHistorySessions,
  portableConversationHistorySessions,
} from '../lib/browser/nextmux-conversation-history.js';
import { conversationPersistenceChanges, createConversationPersistenceBaseline } from '../lib/browser/nextmux-conversation-persistence.js';

const widget = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
const service = readFileSync(fileURLToPath(new URL('../src/node/nextmux-platform-service.ts', import.meta.url)), 'utf8');
const protocol = readFileSync(fileURLToPath(new URL('../src/common/nextmux-platform-protocol.ts', import.meta.url)), 'utf8');

test('complete conversation history is durable and the renderer mirror never truncates live state', () => {
  const localSession = {
    id: 'owned', title: 'Owned', workspacePath: '', ownedWorkspace: true,
    privateWorkspacePath: 'C:\\Users\\old-machine\\owned', updatedAt: 1, turns: [],
  };
  const mirror = createConversationHistoryMirror(portableConversationHistorySessions([localSession]));
  assert.equal(Object.hasOwn(mirror.sessions[0], 'privateWorkspacePath'), false);
  assert.match(widget, /this\.platformService\.patchConversationHistory\(/);
  assert.match(widget, /this\.platformService\.loadConversationHistory\(\)/);
  assert.doesNotMatch(widget, /this\.codingSessions\s*=\s*compact/);
  assert.doesNotMatch(widget, /turns:\s*session\.turns\.slice\(-24\)/);
  assert.match(widget, /mergeConversationHistorySessions\(this\.codingSessions, durable/);
  assert.match(widget, /listConversationHistory/);
  assert.match(widget, /readConversationHistorySession\(sessionId\)/);
  assert.match(widget, /historyLoaded !== false/);
});

test('quiet-period persistence sends only changed sessions and removed ids', () => {
  const acknowledged = { id: 'clean', updatedAt: 1, turns: [] };
  const changed = {
    id: 'owned', updatedAt: 2, turns: [], privateWorkspacePath: '/this-machine/owned',
  };
  const changes = conversationPersistenceChanges([acknowledged, changed], new Map([['clean', acknowledged]]));
  const outgoing = portableConversationHistorySessions(changes.upserts);
  assert.deepEqual(outgoing.map(session => session.id), ['owned']);
  assert.equal(Object.hasOwn(outgoing[0], 'privateWorkspacePath'), false);
  assert.match(protocol, /patchConversationHistory\(request: DesktopConversationHistoryPatchRequest\)/);
  assert.match(service, /async patchConversationHistory\(request: DesktopConversationHistoryPatchRequest\)/);
  assert.match(widget, /scheduleConversationHistoryPersist\(delay = 750\)/);
  assert.doesNotMatch(widget, /saveConversationHistory\(snapshot\)/);
});

test('permission changes touch the session snapshot so an immediate restart cannot restore stale durable metadata', () => {
  assert.match(widget, /protected persistActiveCodingSessionState\(touch = false\)/);
  assert.match(widget, /updatedAt:\s*touch \? Math\.max\(Date\.now\(\), session\.updatedAt \+ 1\) : session\.updatedAt/);
  assert.match(widget, /setPermissionMode\(mode:[\s\S]*?this\.persistActiveCodingSessionState\(true\)/);
  assert.match(widget, /confirmFullAccess\(\):[\s\S]*?this\.persistActiveCodingSessionState\(true\)/);
});

test('window initialization hydrates history before workspace restoration consumes a conversation', async () => {
  const parsed = ts.createSourceFile('widget.tsx', widget, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const widgetClass = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
  const method = name => {
    const result = widgetClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(parsed) === name);
    assert.ok(result, `${name} must exist`); return result.getText(parsed);
  };
  assert.match(method('init'), /void this\.initializeConversationWindows\(\)/);
  const code = ts.transpile(`class Harness { ${method('initializeConversationWindows')} ${method('initializeConversationHistory')} }; return Harness;`,
    { target: ts.ScriptTarget.ES2022 });
  for (const mode of ['no-bridge', 'missing-state', 'main', 'detached']) {
    const events = [], session = { id: 'session-a', title: 'Stored conversation', turns: [] };
    const nativeState = { windowId: 'main', windows: [], sessions: [session] };
    const bridge = mode === 'no-bridge' ? undefined : {
      async getConversationWindowState() { return mode === 'missing-state' ? undefined : nativeState; },
      onConversationWindowEvent() { return () => {}; }, onConversationWindowHighlight() { return () => {}; }
    };
    const Harness = new Function('window', 'document', 'createConversationPersistenceBaseline', 'mergeConversationHistorySessions', code)(
      { nextmuxDesktop: bridge, setTimeout() {} }, { title: '' }, createConversationPersistenceBaseline, mergeConversationHistorySessions);
    const state = Object.assign(new Harness(), {
      codingSessions: [], detachedConversationId: mode === 'detached' ? session.id : '',
      tiledCodingSessionIds: new Set(), removedCodingSessionIds: new Set(), toDispose: { push() {} },
      async loadPrivacySettings() { events.push('privacy'); },
      async restoreDurableCodingSessions() { this.codingSessions = [session]; this.conversationHistoryPersistenceReady = true; events.push('durable'); },
      async hydrateOwnedCodingSessionWorkspaces() { events.push('hydrate'); }, loadTerminalRecords() {},
      async refreshWorkspaceRoots() {
        assert.equal(this.conversationHistoryPersistenceReady, true, mode);
        assert.deepEqual(this.codingSessions, [session], mode); events.push('workspaces');
      },
      openCodingSession(id) { assert.equal(id, session.id); events.push('open'); },
      activeCodingSession() { return this.codingSessions[0]; },
      async publishConversationWindowChanges() { events.push('publish'); },
      refreshConversationHistoryPersistDirty() {}, scheduleConversationHistoryPersist() {}, update() {}
    });
    await state.initializeConversationWindows();
    assert.deepEqual(events, mode === 'detached' ? ['workspaces', 'open']
      : ['privacy', 'durable', 'hydrate', 'workspaces', ...(mode === 'main' ? ['publish'] : [])], mode);
  }
  assert.doesNotMatch(widget, /this\.scheduleSurfaceLocalization\(\);\s*void this\.refreshWorkspaceRoots\(\);/);
});

test('local history is always enabled and only explicit local-data deletion clears history and its search index', () => {
  assert.match(protocol, /DesktopLocalDataCategory[^;]*conversation_history/);
  assert.match(service, /conversation_history:\s*join\(this\.nextmuxDataRoot\(\), 'conversation-history-v1'\)/);
  assert.match(service, /async clearConversationHistory\(\)[\s\S]*?conversationStore\(\)\.clear\(\)[\s\S]*?rm\(this\.conversationIndexPath\(\)/);
  const privacySave = service.match(/async savePrivacySettings\([\s\S]*?\n    }\n\n    protected async editorDraftRecoveryStore/)?.[0] || '';
  assert.doesNotMatch(privacySave, /conversationStore\(\)\.clear\(\)/);
  assert.match(service, /category === 'conversation_history'[\s\S]*?conversationStore\(\)\.clear\(\)[\s\S]*?rm\(this\.conversationIndexPath\(\)/);
  const parsed = ts.createSourceFile('widget.tsx', widget, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const historyInputs = [];
  const visit = node => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(parsed) === 'input'
      && node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute)
        && attribute.name.getText(parsed) === 'aria-label'
        && attribute.initializer?.getText(parsed) === "{incognitoText(locale, 'historyLabel')}")) historyInputs.push(node);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.equal(historyInputs.length, 1, 'the actual privacy history control is unique');
  const attributes = new Map(historyInputs[0].attributes.properties.filter(ts.isJsxAttribute)
    .map(attribute => [attribute.name.getText(parsed), attribute.initializer]));
  for (const name of ['disabled', 'checked']) {
    assert.equal(attributes.has(name), true, `${name} is enforced by the actual control`);
    assert.equal(attributes.get(name), undefined, `${name} is unconditional, not a mutable draft value`);
  }
  assert.equal(attributes.has('onChange'), false, 'the locked control cannot opt out through a handler');
  assert.equal(incognitoText('zh-CN', 'historyLabel'), '保存本机对话记录');
  assert.match(incognitoText('en', 'historyDescription'), /always saved locally/);
  assert.match(privacySave, /saveConversationHistory:\s*true/);
});

test('search waits for the virtualized conversation list to commit before revealing an old turn', () => {
  assert.match(widget, /setThreadFindQuery\(query: string\)[\s\S]*?this\.update\(\);\s*this\.scheduleActiveThreadMatchReveal\(\)/);
  assert.match(widget, /scheduleActiveThreadMatchReveal\(\)[\s\S]*?const token = \+\+this\.threadFindRevealToken[\s\S]*?attempt < 12[\s\S]*?requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => reveal\(0\)\)\)/);
  assert.match(widget, /closeThreadFind\(\)[\s\S]*?this\.threadFindRevealToken \+= 1/);
});

test('a search message target reveals that bubble instead of the start of its long turn', () => {
  const parsed = ts.createSourceFile('widget.tsx', widget, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const widgetClass = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
  const method = widgetClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(parsed) === 'scrollThreadTurn');
  const code = ts.transpile(`class Harness { ${method.getText(parsed)} }; return Harness;`, { target: ts.ScriptTarget.ES2022 });
  for (const [messageId, absoluteTop] of [[undefined, 100], ['long-turn', 100], ['user-message', 100], ['assistant-message', 250], ['steering-message', 850]]) {
    const frames = [], stage = { scrollTop: 0, scrollHeight: 3000, clientHeight: 600, getBoundingClientRect: () => ({ top: 0 }) };
    const message = top => ({ getBoundingClientRect: () => ({ top: top - stage.scrollTop }) });
    const turn = { ...message(100), querySelector(selector) {
      const id = /data-message-id="([^"]+)"/.exec(selector)?.[1];
      return { 'user-message': message(100), 'assistant-message': message(250), 'steering-message': message(850) }[id] || null;
    } };
    const Harness = new Function('CSS', 'requestAnimationFrame', 'window', code)(
      { escape: value => value }, callback => frames.push(callback), { setTimeout: callback => frames.push(callback) });
    const state = Object.assign(new Harness(), {
      threadListTurns: [{ id: 'long-turn' }, { id: 'latest-turn' }], threadJumpToken: 0, threadScroller: stage,
      node: { querySelector: () => turn }, isDisposed: false,
      cancelThreadBottomFollow() {}, cancelThreadScrollRestore() {}, update() {}, revealActiveThreadMarker() {}
    });
    state.scrollThreadTurn('long-turn', false, messageId);
    for (let step = 0; frames.length && step < 30; step++) frames.shift()();
    assert.equal(stage.scrollTop, absoluteTop - 24, messageId || 'legacy turn navigation');
    assert.equal(state.activeThreadTurnId, 'long-turn');
    assert.equal(state.threadAwayFromBottom, true);
  }
});

test('global and agent conversation search use complete durable history without renderer index truncation', () => {
  assert.match(protocol, /searchConversationHistory\(request: DesktopConversationSearchRequest\)/);
  assert.match(service, /this\.conversationStore\(\)\.searchRecords\(request\)/);
  assert.match(service, /this\.conversationStore\(\)\.search\(\{\s*\.\.\.request,\s*limit:\s*500\s*\}\)/);
  assert.doesNotMatch(service, /conversationHistorySearchRecords\(\(await this\.conversationStore\(\)\.load\(\)\)\.sessions\)/);
  assert.match(service, /async searchConversationHistory\(request: DesktopConversationSearchRequest\)/);
  assert.doesNotMatch(widget, /this\.codingSessions\.slice\(0, 500\)/);
  assert.doesNotMatch(widget, /messages:[\s\S]{0,800}\.slice\(-500\)/);
  assert.doesNotMatch(widget, /syncConversationIndex\(records\)/);
});

test('legacy index sync cannot truncate history during an older-client upgrade', () => {
  const method = service.match(/async syncConversationIndex\(records: readonly DesktopConversationIndexRecord\[\]\)[\s\S]*?\n    async cacheDesktopAttachment/);
  assert.ok(method, 'legacy sync method must remain auditable while older clients upgrade');
  assert.doesNotMatch(method[0], /records\.slice\(0,\s*500\)/);
  assert.doesNotMatch(method[0], /Array\.isArray\(record\.messages\)[\s\S]{0,120}\.slice\(0,\s*500\)/);
  assert.doesNotMatch(method[0], /64\s*\*\s*1024\s*\*\s*1024/);
});
