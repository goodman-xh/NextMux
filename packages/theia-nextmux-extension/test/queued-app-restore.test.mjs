import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { parseAppControlMarker } from '../lib/browser/nextmux-app-control.js';

const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const method = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === 'editQueuedFollowUpTask').getText(ast);
const Harness = new Function('composerContentToken', 'parseAppControlMarker', 'removeFollowUpTask', 'requestAnimationFrame', ts.transpile(`class Harness { ${method} }; return Harness;`, { target: ts.ScriptTarget.ES2022 }))(
    (...args) => JSON.stringify(args), parseAppControlMarker, (tasks, id) => tasks.filter(task => task.id !== id), () => {});
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
function fixture(prompt, load = async () => []) {
    const value = new Harness();
    const session = { id: 'session', followUpQueue: [{ id: 'task', prompt }] };
    Object.assign(value, {
        codingSessions: [session], activeCodingSessionId: session.id, prompt: '', attachments: [], pastedTextReferences: [], editedTurnAttachmentOrder: [],
        composerApps: new Map([[session.id, { id: 'old-app', name: 'Old app' }]]), queuedAttachmentPayloads: new Map(),
        conversationHistoryReady: () => true, resolveQueuedAttachments: load, scheduleComposerDraftPersist() {},
        setComposerPrompt(text) { this.prompt = text; }, appIconFor: id => `data:image/png;base64,${id}`,
        setComposerApp(id, app) { this.composerApps.set(id, app); },
        updateFollowUpQueue(id, tasks) { assert.equal(id, session.id); session.followUpQueue = tasks; return true; }
    });
    return value;
}

test('editing a queued application restores its chip identity and clean prompt', async () => {
    const value = fixture('[App:记事本(notepad)]\n继续编写');
    await value.editQueuedFollowUpTask('session', 'task');
    assert.equal(value.prompt, '继续编写');
    assert.deepEqual(value.composerApps.get('session'), { id: 'notepad', name: '记事本', icon: 'data:image/png;base64,notepad' });
    assert.equal(value.codingSessions[0].followUpQueue.length, 0);
});

test('editing a plain queued task clears an unrelated draft application', async () => {
    const value = fixture('只回答问题');
    await value.editQueuedFollowUpTask('session', 'task');
    assert.equal(value.prompt, '只回答问题');
    assert.equal(value.composerApps.has('session'), false);
});

test('a new application selection while attachments load protects the draft and queued task', async () => {
    const gate = deferred(), value = fixture('[App:记事本(notepad)]\n继续编写', () => gate.promise);
    const pending = value.editQueuedFollowUpTask('session', 'task');
    value.composerApps.set('session', { id: 'new-app', name: 'New user choice' });
    gate.resolve([]); await pending;
    assert.equal(value.prompt, '');
    assert.equal(value.composerApps.get('session').id, 'new-app');
    assert.equal(value.codingSessions[0].followUpQueue.length, 1);
});
