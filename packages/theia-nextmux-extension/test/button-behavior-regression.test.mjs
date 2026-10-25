import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import activity from '../lib/browser/nextmux-agent-activity.js';
import { runningTaskText } from '../lib/browser/nextmux-running-task-locale.js';
import { conversationText } from '../lib/browser/nextmux-conversation-locale.js';
import { localizeDesktopSurface } from '../lib/browser/nextmux-surface-locale.js';
import { normalizeConversationMarkdown, decorateConversationLinks } from '../lib/browser/nextmux-markdown.js';
import { projectConversationStream } from '../lib/browser/nextmux-conversation-stream-model.js';

const require = createRequire(import.meta.url);
const React = createRequire(require.resolve('@theia/core/package.json'))('react');
const { ConversationMarkdown } = require('../lib/browser/nextmux-conversation-markdown.js');
const conversationCodeTokenizer = () => undefined;
const URI = require('@theia/core/lib/common/uri').default;
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
function productionHarness(names) {
    const methods = names.map(name => {
        const method = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name);
        assert.ok(method, `production method ${name}`);
        return method.getText(file);
    });
    const dependencies = { ...activity, React, URI, ConversationMarkdown, conversationCodeTokenizer, normalizeConversationMarkdown, decorateConversationLinks,
        runningTaskText, conversationText, localizeDesktopSurface };
    return new Function(...Object.keys(dependencies), ts.transpile(`class Harness { ${methods.join('\n')} }; return Harness;`, {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React
    }))(...Object.values(dependencies));
}
function* elements(value) {
    if (Array.isArray(value)) { for (const child of value) yield* elements(child); return; }
    if (!React.isValidElement(value)) return;
    yield value; yield* elements(value.props.children);
}
const textContent = value => Array.isArray(value) ? value.map(textContent).join('')
    : React.isValidElement(value) ? value.type === ConversationMarkdown ? value.props.markdown : textContent(value.props.children)
        : typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const at = n => `2026-09-20T00:00:${String(n).padStart(2, '0')}.000Z`;

test('production activity rendering keeps narration and steering in order after completion and a resumed turn-number reset', () => {
    const Harness = productionHarness(['renderAssistantResponse']);
    const state = Object.assign(new Harness(), { desktopLocale: 'en', renderThreadText: value => value, copyConversationCode: async () => undefined });
    const message = { id: 'steering-one', content: 'Keep the change readonly', createdAt: at(3), status: 'accepted' };
    const events = [
        { type: 'model_started', turn: 1, at: at(1) },
        { type: 'assistant_delta', turn: 1, delta: 'I am checking the saved permission.', at: at(2) },
        { type: 'assistant_delta', turn: 1, delta: 'The saved permission is readonly.', at: at(4) },
        { type: 'model_completed', turn: 1, toolCallCount: 1, at: at(5) }
    ];
    const project = (journal, running, terminalState) => projectConversationStream({ locale: 'en', events: journal, running,
        ...(terminalState ? { terminalState } : {}), steeringMessages: [message] });
    const live = project(events, true);
    assert.ok(live.items.some(item => item.kind === 'steering' && item.message.id === 'steering-one'));
    const completed = project(events, false, 'complete');
    const rows = completed.items.filter(item => item.kind === 'text' || item.kind === 'steering');
    assert.equal(rows.length, 3);
    assert.match(rows[0].text, /^I am checking/);
    assert.match(rows[1].message.content, /^Keep the change readonly/);
    assert.match(rows[2].text, /^The saved permission/);
    assert.ok(completed.items.every(item => item.kind !== 'text' || item.streaming === false), 'settled narration never streams');
    assert.equal(completed.idleCaret, false);
    // Narration is rendered with the actual safe Markdown response renderer; its
    // callbacks are stable so the memoized Markdown host does not re-render.
    const first = state.renderAssistantResponse(rows[0].text, 'turn-one:0');
    const second = state.renderAssistantResponse(rows[2].text, 'turn-one:2');
    for (const node of [first, second]) {
        assert.equal(node.type, ConversationMarkdown);
        assert.equal(node.props.className, 'nmx-assistant-markdown');
    }
    assert.equal(first.props.markdown, rows[0].text);
    assert.equal(first.props.onCopyCode, second.props.onCopyCode);
    assert.equal(first.props.onRender, second.props.onRender);
    assert.equal(first.props.tokenizer, second.props.tokenizer);
    const resumed = [...events,
        { type: 'backend_selected', backendId: 'restored-run', attempt: 1, at: at(6) },
        { type: 'model_started', turn: 1, at: at(7) },
        { type: 'assistant_delta', turn: 1, delta: 'Final answer appears in its own response.', at: at(8) },
        { type: 'model_completed', turn: 1, toolCallCount: 0, at: at(9) }
    ];
    const restored = project(resumed, false, 'complete').items.map(item => item.kind === 'text' ? item.text : item.kind === 'steering' ? item.message.content : '').join(' ');
    assert.match(restored, /I am checking.*Keep the change readonly.*The saved permission/);
    assert.doesNotMatch(restored, /Final answer appears/, 'a reused model turn number must not duplicate the final response in activity');
});

const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
function directoryFixture() {
    const Harness = productionHarness(['loadContextFiles', 'loadContextDirectory', 'contextFileVisible']);
    const reads = [];
    const state = Object.assign(new Harness(), {
        activeCodingSessionId: 'A', activeWorkspaceRoot: '/unrelated', desktopLocale: 'en',
        contextFilesLoading: false, contextFilesRefreshPending: false, contextFilesWorkspace: '',
        contextFileChildren: new Map(), expandedContextDirectories: new Set(),
        activeCodingSession() { return { id: this.activeCodingSessionId, workspacePath: `/project-${this.activeCodingSessionId}` }; },
        codingSessionWorkspaceRoot: session => session.workspacePath,
        detachContextEditorRecovery: () => true, update() {},
        fileService: { resolve(uri) { const read = { path: uri.path.fsPath(), ...deferred() }; reads.push(read); return read.promise; } }
    });
    const answer = (index, name) => reads[index].resolve({ children: [{ name, isDirectory: false,
        resource: URI.fromFilePath(`${reads[index].path}/${name}`) }] });
    return { state, reads, answer };
}

test('switching conversations while directory A loads discards its late rows and finishes with only directory B', async () => {
    const { state, reads, answer } = directoryFixture();
    const loading = state.loadContextFiles();
    state.activeCodingSessionId = 'B';
    await state.loadContextFiles();
    assert.equal(reads.length, 1, 'serialize directory reads while the old request is outstanding');
    assert.equal(state.contextFilesRefreshPending, true);
    answer(0, 'from-A.txt'); await loading;
    assert.deepEqual(reads.map(read => read.path), ['/project-A', '/project-B']);
    assert.equal(state.contextFilesWorkspace, '/project-B');
    assert.equal(state.contextFileChildren.has('/project-A'), false, 'late A results are cleared before B is displayed');
    answer(1, 'from-B.txt'); await settle();
    assert.deepEqual([...state.contextFileChildren.keys()], ['/project-B']);
    assert.deepEqual(state.contextFileChildren.get('/project-B').map(row => row.name), ['from-B.txt']);
    assert.deepEqual([...state.expandedContextDirectories], ['/project-B']);
    assert.equal(state.contextFilesLoading, false);
});

test('same-directory calls coalesce while an explicit refresh performs one fresh read', async () => {
    for (const force of [false, true]) {
        const { state, reads, answer } = directoryFixture();
        const loading = state.loadContextFiles();
        await state.loadContextFiles(force);
        assert.equal(state.contextFilesRefreshPending, force);
        answer(0, 'old.txt'); await loading;
        assert.equal(reads.length, force ? 2 : 1);
        if (force) { answer(1, 'fresh.txt'); await settle(); }
        assert.deepEqual(state.contextFileChildren.get('/project-A').map(row => row.name), [force ? 'fresh.txt' : 'old.txt']);
    }
});
