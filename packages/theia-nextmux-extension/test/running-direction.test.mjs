import { modelFailureText } from '../lib/browser/nextmux-model-errors.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { createRequire } from 'node:module';

// “Send now without interrupting” from the running composer (Cmd/Ctrl+Enter or the pill button).
const require = createRequire(import.meta.url);
const { runningTaskText } = require('../lib/browser/nextmux-running-task-locale.js');
const source = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const methods = new Map();
const visit = node => { if (ts.isMethodDeclaration(node)) methods.set(node.name.getText(ast), node.getText(ast)); ts.forEachChild(node, visit); };
visit(ast);
const names = ['submitRunningDirection', 'runningDirectionBlocker', 'moveQueuedFollowUpTaskToTop', 'runningComposerShortcut'];
const code = ts.transpile(`class Harness { ${names.map(name => methods.get(name)).join('\n')} }`, { target: ts.ScriptTarget.ES2022 });
const Harness = new Function('modelFailureText', 'runningTaskText', 'activeRunBelongsToSession', 'requestAnimationFrame', 'navigator', `${code}; return Harness;`)(
    modelFailureText, runningTaskText, (active, session) => active === session, () => 0, { platform: 'MacIntel', userAgent: 'Mac' });

function widget(overrides = {}) {
    const calls = { sent: [], queued: 0, notices: [], steering: [] };
    const target = Object.assign(new Harness(), {
        desktopLocale: 'zh-CN', prompt: '  also cover the error path  ', attachments: [], pastedTextReferences: [], composerComposing: false,
        runningMessageSubmitting: false, activeAgentRunId: 'run-1', activeAgentTurnId: 'turn-1', activeAgentSessionId: 's1',
        agentQuestions: { visible: () => false }, node: { querySelector: () => undefined },
        conversationHistoryReady: () => true, activeCodingSession: () => ({ id: 's1' }), activeCodingSessionId: 's1',
        platformService: { sendAgentRunMessage: async (runId, text) => { calls.sent.push([runId, text]); return { accepted: true, message: { id: 'm1', content: text, createdAt: 'now' } }; } },
        recordSteeringMessage: (...args) => calls.steering.push(args),
        setComposerPrompt(value) { this.prompt = value; }, persistComposerDraft() {}, update() {},
        submitRunningMessage: async () => { calls.queued += 1; return true; },
        addNotification: (kind, title, body) => calls.notices.push(body)
    }, overrides);
    return { target, calls };
}

test('submitting while busy always queues the message for after the active reply finishes', async () => {
    const { target, calls } = widget();
    assert.equal(await target.submitRunningDirection(), true);
    assert.deepEqual(calls.sent, []);
    assert.equal(calls.queued, 1);
    assert.equal(target.prompt, '');
    assert.deepEqual(calls.notices, [runningTaskText('zh-CN', 'steerQueuedInstead')]);
});

test('when the run has not started, is asking a question, or is finishing, the message is also queued and the user is told', async () => {
    for (const overrides of [{ activeAgentRunId: '' }, { agentQuestions: { visible: () => true } },
        { platformService: { sendAgentRunMessage: async () => ({ accepted: false, message: {} }) } }]) {
        const { target, calls } = widget(overrides);
        assert.equal(await target.submitRunningDirection(), true);
        assert.deepEqual(calls.sent, []);
        assert.equal(calls.queued, 1);
        assert.deepEqual(calls.notices, [runningTaskText('zh-CN', 'steerQueuedInstead')]);
    }
});

test('attachments and pasted blocks are also queued through submitRunningMessage when submitted while busy', async () => {
    const { target, calls } = widget({ attachments: [{ id: 'a' }] });
    assert.equal(target.runningDirectionBlocker(), runningTaskText('zh-CN', 'steerUnavailable'));
    assert.equal(await target.submitRunningDirection(), true);
    assert.deepEqual(calls.sent, []);
    assert.equal(calls.queued, 1);
});

test('a failed queue delivery keeps the draft and shows the error in the selected language', async () => {
    const { target } = widget({ submitRunningMessage: async () => { throw new Error('queue full'); } });
    assert.equal(await target.submitRunningDirection(), false);
    assert.equal(target.attachmentError, '操作未能完成，请查看详情。');
    assert.doesNotMatch(target.attachmentError, /queue full|模型/, 'a local delivery failure does not claim that the model failed');
    assert.equal(target.prompt.trim(), 'also cover the error path');
});

test('the running composer uses the queue send action and both Enter and Cmd/Ctrl+Enter queue while busy', () => {
    assert.match(source, /data-running-action=\{agentRunning \? 'queue' : undefined\}/);
    assert.match(methods.get('handleComposerKeyDown'), /void this\.submitPrompt\(\)/);
    const { target } = widget();
    assert.equal(target.runningComposerShortcut('queue'), '↩');
    assert.equal(target.runningComposerShortcut('steer'), '⌘↩');
});

test('a queued message can move to the front', () => {
    const queue = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    let written;
    const { target } = widget({ codingSessions: [{ id: 's1', followUpQueue: queue }], followUpTaskMenuId: 'c', updateFollowUpQueue: (_id, next) => { written = next; return true; } });
    target.moveQueuedFollowUpTaskToTop('s1', 'c');
    assert.deepEqual(written.map(task => task.id), ['c', 'a', 'b']);
    assert.equal(target.followUpTaskMenuId, '');
});
