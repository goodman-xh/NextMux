import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { canRateRelayReply, normalizeRelayFeedbackRequestIds } from '../lib/common/nextmux-relay-feedback.js';
import { relayMarketplaceText } from '../lib/browser/nextmux-relay-marketplace-locale.js';
import { codingSidebarProjects } from '../lib/browser/nextmux-sidebar-projects.js';
import { createConversationHistoryMirror, readConversationHistoryMirror } from '../lib/browser/nextmux-conversation-history.js';

const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const methods = ['submitCodingTurnRelayFeedback', 'executeCodingTurnRelayFeedback', 'updateCodingTurn'];
const methodSource = methods.map(name => widget.members.find(node => ts.isMethodDeclaration(node)
    && node.name.getText(file) === name).getText(file)).join('\n');
const bindings = { canRateRelayReply, normalizeRelayFeedbackRequestIds, relayMarketplaceText };
const Widget = new Function(...Object.keys(bindings), ts.transpile(`class Harness { ${methodSource} }; return Harness;`, {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
}))(...Object.values(bindings));

function fixture(stage, requestIds = []) {
    const calls = [], notices = [], snapshots = [];
    const turn = { id: 'reply-1', prompt: 'hello', response: '', error: '', createdAt: 1, stage, relayRequestIds: requestIds };
    const instance = new Widget();
    Object.assign(instance, {
        desktopLocale: 'zh-CN', applicationExitPreparing: false,
        codingSessions: [{ id: 'session-1', workspacePath: '/project', title: 'Test', createdAt: 1, updatedAt: 1, turns: [turn] }],
        relayFeedbackSubmittingVotes: new Map(), pendingRelayFeedbackSubmissions: new Set(),
        conversationHistoryReady: () => true, update: () => {}, loadCatalog: () => {},
        persistCodingSessions: () => snapshots.push(createConversationHistoryMirror(instance.codingSessions)),
        addNotification: (...notice) => notices.push(notice),
        platformService: { submitRelayFeedbackBatch: async (ids, vote) => {
            calls.push({ ids, vote }); return { feedback: { vote } };
        } }
    });
    return { instance, turn, calls, notices, snapshots, current: () => instance.codingSessions[0].turns[0] };
}

test('failed, cancelled and legacy replies accept, switch and remove durable local feedback without merchant requests', async () => {
    for (const stage of ['error', 'cancelled', 'complete', 'paused']) {
        const f = fixture(stage);
        await f.instance.submitCodingTurnRelayFeedback('session-1', f.turn, 'up');
        assert.equal(f.current().relayFeedback, 'up', stage);
        const restored = readConversationHistoryMirror(JSON.stringify(f.snapshots.at(-1)));
        assert.equal(restored.sessions[0].turns[0].relayFeedback, 'up', `${stage} survives restart mirror`);
        assert.equal(f.notices.length, 0, 'the vote shows on the reply itself; the bell stays for background results');
        await f.instance.submitCodingTurnRelayFeedback('session-1', f.turn, 'down');
        assert.equal(f.current().relayFeedback, 'down');
        await f.instance.submitCodingTurnRelayFeedback('session-1', f.turn, 'down');
        assert.equal(f.current().relayFeedback, undefined, 'uses current state even if the render turn is stale');
        assert.deepEqual(f.calls, [], stage);
        assert.equal(f.instance.pendingRelayFeedbackSubmissions.size, 0);
    }
});

test('settled managed replies (including error/cancelled with confirmed request IDs) submit real merchant ratings', async () => {
    const f = fixture('complete', ['request-1', 'request-2', 'request-1']);
    await f.instance.submitCodingTurnRelayFeedback('session-1', f.turn, 'up');
    await f.instance.submitCodingTurnRelayFeedback('session-1', f.turn, 'up');
    assert.deepEqual(f.calls, [{ ids: ['request-1', 'request-2'], vote: 'up' }, { ids: ['request-1', 'request-2'], vote: null }]);
    const failed = fixture('error', ['failed-request']);
    await failed.instance.submitCodingTurnRelayFeedback('session-1', failed.turn, 'down');
    assert.equal(failed.current().relayFeedback, 'down');
    assert.deepEqual(failed.calls, [{ ids: ['failed-request'], vote: 'down' }]);
});

test('feedback leaves running replies and incomplete history untouched', async () => {
    const running = fixture('running', ['request-1']);
    await running.instance.submitCodingTurnRelayFeedback('session-1', running.turn, 'up');
    const loading = fixture('complete', ['request-1']);
    loading.instance.conversationHistoryReady = () => false;
    await loading.instance.submitCodingTurnRelayFeedback('session-1', loading.turn, 'up');
    for (const f of [running, loading]) {
        assert.equal(f.current().relayFeedback, undefined);
        assert.deepEqual(f.calls, []);
        assert.deepEqual(f.snapshots, []);
    }
});

test('remembered projects stay in the normal project list without becoming authorized workspace roots', () => {
    const workspaces = [{ path: '/projects/open', label: 'Open project' }];
    const sessions = [{ workspacePath: '/projects/closed' }, { workspacePath: '/projects/open' },
        { workspacePath: '' }, { workspacePath: '/projects/closed' }, { workspacePath: 'C:\\Work\\Other' }];
    assert.deepEqual(codingSidebarProjects(workspaces, sessions), [
        { path: '/projects/open', label: 'Open project' },
        { path: '/projects/closed', label: 'closed' },
        { path: 'C:\\Work\\Other', label: 'Other' }
    ]);
    assert.equal(workspaces.length, 1, 'display projection cannot mount or authorize historical paths');
    assert.doesNotMatch(source, /已离线项目|nmx-unavailable-projects|nmx-session-unavailable-badge/);
    assert.match(source, /openWorkspacePaths\.has\(workspace\.path\) && workspace\.path !== this\.activeWorkspaceRoot/);
});

const comicMethod = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === 'submitComicTurnFeedback').getText(file);
const ComicHarness = new Function(...Object.keys(bindings), ts.transpile(`class Harness { ${comicMethod} }; return Harness;`, {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
}))(...Object.values(bindings));

function comicFixture(relayRequestIds, submit = async (ids, vote) => ({ feedback: { vote } })) {
    const calls = [], notices = [], saved = [];
    const chat = { id: 'chat-1', turns: [{ id: 'turn-1', mode: 'agent', prompt: '分镜怎么改', reply: '先拉近景', ...(relayRequestIds ? { relayRequestIds } : {}) }] };
    const instance = Object.assign(new ComicHarness(), {
        desktopLocale: 'zh-CN', comicFeedbackByTurnId: {}, comicRelayFeedbackSubmitting: new Map(),
        comicChatUi: () => ({ chatId: 'chat-1' }), activeComicChat: () => chat,
        patchComicChatTurn: (chatId, turnId, change) => { chat.turns = chat.turns.map(turn => turn.id === turnId ? change(turn) : turn); saved.push(chat.turns[0].feedback); },
        platformService: { submitRelayFeedbackBatch: async (ids, vote) => { calls.push({ ids, vote }); return submit(ids, vote); } },
        loadCatalog: () => {}, update: () => {}, addNotification: (...notice) => notices.push(notice)
    });
    return { instance, calls, notices, saved, turn: () => chat.turns[0] };
}

test('a comic reply from an own API keeps its thumbs locally; nothing is sent', async () => {
    const f = comicFixture(undefined);
    await f.instance.submitComicTurnFeedback('turn-1', 'up');
    assert.equal(f.turn().feedback, 'up');
    await f.instance.submitComicTurnFeedback('turn-1', 'up');
    assert.equal(f.turn().feedback, undefined, 'pressing the same thumb again takes it back');
    assert.deepEqual(f.calls, []);
});

test('a managed comic reply rates its requests, keeps the recorded vote, and sends one vote at a time', async () => {
    const f = comicFixture(['request-1', 'request-2', 'request-1']);
    await f.instance.submitComicTurnFeedback('turn-1', 'down');
    await f.instance.submitComicTurnFeedback('turn-1', 'down');
    assert.deepEqual(f.calls, [{ ids: ['request-1', 'request-2'], vote: 'down' }, { ids: ['request-1', 'request-2'], vote: null }]);
    assert.equal(f.turn().feedback, undefined);
    // The platform's answer wins over the button pressed.
    const recorded = comicFixture(['request-1'], async () => ({ feedback: { vote: 'up' } }));
    await recorded.instance.submitComicTurnFeedback('turn-1', 'down');
    assert.equal(recorded.turn().feedback, 'up');
    // A second press while the first is on its way does nothing.
    let release;
    const slow = comicFixture(['request-1'], (ids, vote) => new Promise(resolve => { release = () => resolve({ feedback: { vote } }); }));
    const first = slow.instance.submitComicTurnFeedback('turn-1', 'up');
    assert.equal(slow.instance.comicRelayFeedbackSubmitting.get('turn-1'), 'up');
    await slow.instance.submitComicTurnFeedback('turn-1', 'down');
    release(); await first;
    assert.equal(slow.calls.length, 1);
    assert.equal(slow.turn().feedback, 'up');
    assert.equal(slow.instance.comicRelayFeedbackSubmitting.size, 0);
});

test('a comic rating the platform refuses keeps the previous vote and says so', async () => {
    const f = comicFixture(['request-1'], async () => { throw new Error('network down'); });
    await f.instance.submitComicTurnFeedback('turn-1', 'up');
    assert.equal(f.turn().feedback, undefined);
    assert.deepEqual(f.saved, [], 'nothing was written');
    assert.equal(f.notices.length, 1);
    assert.equal(f.notices[0][0], 'error');
    assert.equal(f.notices[0][2], 'network down');
    assert.equal(f.notices[0][3], '', 'not filed under a chat conversation');
});

test('a comic reply being rated shows the spinner on the pressed thumb and holds both until the platform answers', async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    require.extensions['.css'] ??= () => {};
    const React = require('react');
    const { renderToStaticMarkup } = createRequire(require.resolve('@theia/core/package.json'))('react-dom/server');
    const { ComicChatThread } = require('../lib/browser/nextmux-comic-chat-view.js');
    const turn = { id: 'turn-1', mode: 'agent', prompt: 'hello', references: [], params: {}, jobIds: [], reply: 'A reply', createdAt: '2026-10-24T00:00:00.000Z' };
    const noop = () => {};
    const render = extra => {
        const original = console.error; console.error = () => {};
        try {
            return renderToStaticMarkup(React.createElement(ComicChatThread, { locale: 'en', turns: [{ turn, media: [], references: [], proposals: [] }],
                onMenu: noop, onOpen: noop, onRetry: noop, onCancel: noop, onGenerate: noop, onCopy: noop, onFeedback: noop,
                feedbackLabels: { up: 'Helpful', down: 'Not helpful' }, ...extra })).match(/<div class="nmx-comic-chat-turn-actions[\s\S]*?<\/div>/)[0];
        } finally { console.error = original; }
    };
    const busy = render({ feedbackByTurnId: { 'turn-1': 'up' }, feedbackSubmitting: { 'turn-1': 'down' } });
    assert.match(busy, /data-relay-feedback="up" class="nmx-relay-feedback is-active"[^>]*aria-pressed="true" aria-busy="false" disabled=""><i class="codicon codicon-thumbsup"/);
    assert.match(busy, /data-relay-feedback="down" class="nmx-relay-feedback"[^>]*aria-busy="true" disabled=""><i class="codicon codicon-loading codicon-modifier-spin"/);
    const idle = render({ feedbackByTurnId: { 'turn-1': 'down' } });
    assert.doesNotMatch(idle, /disabled/);
    assert.match(idle, /data-relay-feedback="down" class="nmx-relay-feedback is-active is-negative"/);
});
