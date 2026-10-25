import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { ConversationReadTracker } from '../lib/browser/nextmux-conversation-attention.js';

// Exercise the production visibility gate, without starting Electron or copying its conditions.
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let member, openMember, noticeMember;
function visit(node) {
    if (ts.isMethodDeclaration(node) && node.name.getText(file) === 'markVisibleConversationRead') member = node;
    if (ts.isMethodDeclaration(node) && node.name.getText(file) === 'conversationNotice') noticeMember = node;
    if (ts.isMethodDeclaration(node) && node.name.getText(file) === 'openCodingSession') openMember = node;
    ts.forEachChild(node, visit);
}
visit(file);
assert.ok(member, 'the real widget read-marker method exists');
assert.ok(openMember, 'the real widget conversation-opening method exists');
// Extract the actual acknowledgement gate and latest-turn declaration. The rest of opening a
// conversation restores editors, attachments and model state, which are unrelated to this rule.
const latestDeclaration = openMember.body.statements.find(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(declaration => declaration.name.getText(file) === 'latest'));
const openingGate = openMember.body.statements.find(node => ts.isIfStatement(node)
    && node.expression.getText(file).includes('document.visibilityState')
    && node.thenStatement.getText(file).includes('this.conversationReads.seen('));
assert.ok(latestDeclaration && openingGate, 'opening a conversation has a guarded read acknowledgement');
const compile = document => new Function('document', ts.transpile(`class Harness {
    ${member.getText(file)}
    ${noticeMember.getText(file)}
    acknowledgeOpenedConversation(session, targetTurnId) {
        ${latestDeclaration.getText(file)}
        ${openingGate.getText(file)}
    }
}; return Harness;`, {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
}))(document);
const completeTurn = { id: 'turn-result', stage: 'complete', createdAt: 100, completedAt: 200 };
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(patch = {}) {
    const document = { visibilityState: 'visible', focused: true, hasFocus() { return this.focused; } };
    const writes = [], broadcasts = [];
    const tracker = new ConversationReadTracker({ read: async () => [], mark: async receipt => { writes.push(receipt); return receipt; },
        changed() {}, broadcast: receipt => broadcasts.push(receipt) });
    const Widget = compile(document);
    const current = { id: 'session-active', turns: [completeTurn] };
    const widget = Object.assign(new Widget(), {
        activeSection: 'coding', codingPanel: 'thread', threadAwayFromBottom: false,
        conversationWindowHidden: false, detachedConversationId: '', activeCodingSessionId: current.id,
        tiledCodingSessionIds: new Set(), conversationReads: tracker,
        activeCodingSession: () => current, ...patch,
    });
    return { document, widget, current, tracker, writes, broadcasts };
}

test('visible focused conversation at the bottom acknowledges the actual latest outcome only once', async t => {
    const f = fixture(); t.after(() => f.tracker.dispose());
    f.widget.markVisibleConversationRead();
    f.widget.markVisibleConversationRead();
    await settle();
    assert.equal(f.writes.length, 1);
    assert.equal(f.broadcasts.length, 1);
    assert.equal(f.writes[0].sessionId, 'session-active');
    assert.equal(f.writes[0].noticeId, 'turn-result:complete:200');
});

test('hidden or unfocused windows never acknowledge a result until it is visible and focused', async t => {
    const f = fixture(); t.after(() => f.tracker.dispose());
    f.document.visibilityState = 'hidden';
    f.widget.markVisibleConversationRead();
    f.document.visibilityState = 'visible'; f.document.focused = false;
    f.widget.markVisibleConversationRead();
    await settle();
    assert.equal(f.writes.length, 0);
    assert.equal(f.broadcasts.length, 0);
    f.document.focused = true;
    f.widget.markVisibleConversationRead(); await settle();
    assert.equal(f.writes.length, 1);
});

test('reading an earlier turn leaves the latest result unread until reaching the bottom', async t => {
    const f = fixture({ threadAwayFromBottom: true }); t.after(() => f.tracker.dispose());
    const notice = f.tracker.notice(f.current.id, completeTurn);
    f.tracker.unread(notice); await settle();
    assert.equal(f.tracker.unread(notice), true);
    f.widget.markVisibleConversationRead(); await settle();
    assert.equal(f.writes.length, 0);
    assert.equal(f.tracker.unread(notice), true);
    f.widget.threadAwayFromBottom = false;
    f.widget.markVisibleConversationRead(); await settle();
    assert.equal(f.writes.length, 1);
    assert.equal(f.tracker.unread(notice), false);
});

test('settings, comic, and coding secondary panels do not mark the underlying conversation read', async t => {
    for (const patch of [{ activeSection: 'settings' }, { activeSection: 'comic' }, { codingPanel: 'scheduled' }, { codingPanel: 'extensions' }]) {
        const f = fixture(patch); t.after(() => f.tracker.dispose());
        f.widget.markVisibleConversationRead(); await settle();
        assert.equal(f.writes.length, 0, JSON.stringify(patch));
    }
});

test('the main window cannot mark a conversation owned by a detached window; its visible owner can', async t => {
    const f = fixture({ tiledCodingSessionIds: new Set(['session-active']) }); t.after(() => f.tracker.dispose());
    f.widget.markVisibleConversationRead(); await settle();
    assert.equal(f.writes.length, 0);
    f.widget.detachedConversationId = 'session-active';
    f.widget.conversationWindowHidden = true;
    f.widget.markVisibleConversationRead(); await settle();
    assert.equal(f.writes.length, 0, 'a reclaiming/hidden detached surface is not visible');
    f.widget.conversationWindowHidden = false;
    f.widget.markVisibleConversationRead(); await settle();
    assert.equal(f.writes.length, 1);
});

test('header-only sidebar metadata is never treated as a visible conversation body', async t => {
    const header = { id: 'header-only', historyLoaded: false, turns: [], latestTurn: completeTurn };
    const f = fixture({ activeCodingSession: () => header }); t.after(() => f.tracker.dispose());
    f.widget.markVisibleConversationRead(); await settle();
    assert.equal(f.writes.length, 0);
    header.turns = [completeTurn]; header.historyLoaded = true;
    f.widget.markVisibleConversationRead(); await settle();
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].sessionId, 'header-only');
});

test('a receipt accepted from another window prevents redundant local writes and broadcasts', async t => {
    const f = fixture(); t.after(() => f.tracker.dispose());
    f.tracker.accept(f.tracker.notice(f.current.id, completeTurn));
    f.widget.markVisibleConversationRead(); await settle();
    assert.equal(f.writes.length, 0);
    assert.equal(f.broadcasts.length, 0);
});

test('clicking a conversation title acknowledges its latest result despite a saved historical scroll position', async t => {
    const f = fixture({ threadAwayFromBottom: true }); t.after(() => f.tracker.dispose());
    const notice = f.tracker.notice(f.current.id, completeTurn);
    f.tracker.unread(notice); await settle();
    assert.equal(f.tracker.unread(notice), true);
    f.widget.acknowledgeOpenedConversation(f.current);
    await settle();
    assert.equal(f.writes.length, 1);
    assert.equal(f.broadcasts.length, 1);
    assert.equal(f.tracker.unread(notice), false);
});

test('opening an earlier search result preserves unread status, while targeting the latest result acknowledges it', async t => {
    const f = fixture(); t.after(() => f.tracker.dispose());
    f.current.turns.unshift({ ...completeTurn, id: 'earlier-turn', completedAt: 150 });
    f.widget.acknowledgeOpenedConversation(f.current, 'earlier-turn');
    f.widget.acknowledgeOpenedConversation(f.current, 'missing-turn');
    await settle();
    assert.equal(f.writes.length, 0);
    f.widget.acknowledgeOpenedConversation(f.current, completeTurn.id);
    await settle();
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].noticeId, 'turn-result:complete:200');
});

test('programmatic conversation opening in a hidden or unfocused document does not acknowledge its result', async t => {
    const f = fixture(); t.after(() => f.tracker.dispose());
    f.document.visibilityState = 'hidden';
    f.widget.acknowledgeOpenedConversation(f.current);
    f.document.visibilityState = 'visible'; f.document.focused = false;
    f.widget.acknowledgeOpenedConversation(f.current);
    await settle();
    assert.equal(f.writes.length, 0);
    assert.equal(f.broadcasts.length, 0);
    f.document.focused = true;
    f.widget.acknowledgeOpenedConversation(f.current);
    await settle();
    assert.equal(f.writes.length, 1);
});
