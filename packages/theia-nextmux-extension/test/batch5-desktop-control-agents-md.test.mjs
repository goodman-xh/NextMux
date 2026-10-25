import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
// React as the extension gets it (through @theia/core), as thread-notes.test.mjs does.
const core = createRequire(require.resolve('@theia/core/package.json'));
const React = core('react');
const { renderToStaticMarkup } = core('react-dom/server');
const { agentInstructionEditorText, sameInstructionText } = require('../lib/common/nextmux-agent-instructions.js');
const widgetSource = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const notesSource = readFileSync(new URL('../src/browser/nextmux-thread-notes.tsx', import.meta.url), 'utf8');
const panelSource = readFileSync(new URL('../src/browser/nextmux-agent-instructions-panel.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', widgetSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widgetClass = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const method = name => {
    const node = widgetClass.members.find(member => ts.isMethodDeclaration(member) && member.name.getText(file) === name);
    assert.ok(node, name);
    return node.getText(file);
};

test('showing a past conversation never reaches for the computer: no reconnect from render, tab switching or the live view', () => {
    // Batch 5: render scheduled tabs.open_app for every disconnected app tab every 15 s, which lit
    // "NextMux 正在控制电脑" on opening e.g. conversation c0c3512a-… with no turn running.
    assert.doesNotMatch(widgetSource, /reconnectConversationAppTab|reconnectingAppTabs/);
    for (const name of ['renderConversationTabs', 'activeVisualTab', 'selectConversationTab', 'ensureConversationAppMarkerTabs']) {
        assert.doesNotMatch(method(name), /handleTabToolRequest|openAppInTab|queueMicrotask\(\(\) => void this\.re/, name);
    }
    // The user's own clicks and keys in a tab say they are the user's.
    assert.match(widgetSource, /pointer: async input => Boolean\(\(await bridge\.computerWindowPointer\?\.\(conversationId, \{ pid: ref\.pid, windowId: ref\.windowId, \.\.\.input, restore: true,\s*source: 'user' as const/);
    assert.match(widgetSource, /keys: async input => Boolean\(\(await bridge\.computerWindowKeys!\(conversationId, \{ pid: ref\.pid, windowId: ref\.windowId, \.\.\.input, restore: true, delivery: 'auto',\s*source: 'user' as const/);
    // Only the model's tabs.open_app is the AI acting; Reopen and every internal check are the user's.
    const tabTool = method('handleTabToolRequest');
    assert.match(tabTool, /const source = internalUiRequest \? 'user' as const : 'agent' as const;/);
    assert.match(tabTool, /restartIfRunning: request\.input\?\.restartIfRunning === true, source \}[\s\S]*?\{ onlyIfRunning: true, source \} : \{ source \}/);
});

function runGate(context) {
    const body = ts.transpile(`class Harness { ${method('computerRequestRunActive')} }; return Harness;`, { target: ts.ScriptTarget.ES2022 });
    const Harness = new Function('conversationAgentRunActive', body)(run => Boolean(run && (run.activeAgentRunId || run.agentStage === 'running')));
    return Object.assign(new Harness(), { conversationAgentRuns: new Map(), scheduledAgentRuns: new Map(), agentChildContinuationStates: new Map(),
        platformService: { getAgentRunSnapshot: async () => { throw new Error('unknown run'); } }, ...context });
}

test('a computer request runs only while its turn does; a run known to have ended is refused', async () => {
    const request = { id: 'computer-1', conversationId: 'conv', runId: 'run-1', expiresAt: Date.now() + 1000, action: 'click' };
    assert.equal(await runGate({ conversationAgentRuns: new Map([['conv', { activeAgentRunId: 'run-1', activeAgentSessionId: 'conv' }]]) }).computerRequestRunActive(request), true);
    assert.equal(await runGate({ scheduledAgentRuns: new Map([['conv', { runId: 'run-1' }]]) }).computerRequestRunActive(request), true);
    assert.equal(await runGate({ scheduledAgentRuns: new Map([['conv', { runId: 'run-1', cancelRequested: true }]]) }).computerRequestRunActive({ ...request, runId: undefined }), false);
    assert.equal(await runGate({ agentChildContinuationStates: new Map([['c', { sessionId: 'other', runId: 'x', childRunId: 'run-1' }]]) }).computerRequestRunActive(request), true);
    // Not tracked here: the backend decides by run id; an ended run is refused, an unknown one (a delegated child) is not.
    let asked = '';
    const ended = runGate({ platformService: { getAgentRunSnapshot: async (runId, after, wait) => { asked = `${runId}:${after}:${wait}`; return { status: 'completed' }; } } });
    assert.equal(await ended.computerRequestRunActive(request), false);
    assert.equal(asked, 'run-1:1000000:0', 'a status-only lookup: no events, no waiting');
    assert.equal(await runGate({ platformService: { getAgentRunSnapshot: async () => ({ status: 'running' }) } }).computerRequestRunActive(request), true);
    assert.equal(await runGate({}).computerRequestRunActive(request), true);
    assert.equal(await runGate({}).computerRequestRunActive({ ...request, runId: undefined }), false);
    // The dispatcher refuses before anything else happens.
    assert.match(method('handleComputerToolRequest'), /^protected async handleComputerToolRequest\(request: DesktopComputerToolRequest\): Promise<DesktopComputerToolResult> \{\s*if \(\(await this\.computerRequestRunActive\?\.\(request\)\) === false\) \{\s*return \{ requestId: request\.id, ok: false, error: 'The conversation run is no longer active\.' \};/);
});

test('AGENTS.md text is compared as a document: the writer\'s trailing newline never reaches the textarea', () => {
    assert.equal(agentInstructionEditorText('a\nb\n'), 'a\nb');
    assert.equal(agentInstructionEditorText('a\r\nb\r\n'), 'a\nb');
    assert.equal(agentInstructionEditorText('a\n\n'), 'a\n', 'only the one newline the writer adds');
    assert.equal(agentInstructionEditorText(undefined), '');
    assert.equal(sameInstructionText('1. 用中文回复', '1. 用中文回复\n'), true);
    assert.equal(sameInstructionText('a\r\nb', 'a\nb\n'), true);
    assert.equal(sameInstructionText('a', 'a\n\n'), false);
    // Both editors use it everywhere they compare or show the file, so an auto-save never moves the caret.
    for (const fragment of [/sameInstructionText\(agentInstructionContent\(latestDraftRef\.current\), file\.content\)/, /This panel's own save comes back here with the writer's trailing newline/,
        /dirtyRef\.current = !sameInstructionText\(agentInstructionContent\(next\), loadedContentRef\.current\)/]) assert.match(notesSource, fragment);
    assert.doesNotMatch(notesSource, /setDraft\(file\.content\)/);
    assert.match(panelSource, /const dirty = Boolean\(props\.file\) && !sameInstructionText\(draft, props\.file!\.content\);/);
    assert.match(panelSource, /if \(!sameInstructionText\(draft, saved\.content\)\) setDraft\(agentInstructionEditorText\(saved\.content\)\);/);
    assert.doesNotMatch(panelSource, /setDraft\(saved\.content\)|setDraft\(props\.file\.content\)/);
});

test('the AGENTS.md card writes like a note: numbered placeholder, “1. ” on focus, list keys, empty list saves nothing', () => {
    const output = ts.transpileModule(notesSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
    const exports = {};
    Function('exports', 'require', output)(exports, id => id === '../common/nextmux-thread-notes-model' ? require('../lib/common/nextmux-thread-notes-model.js')
        : id === '../common/nextmux-agent-instructions' ? require('../lib/common/nextmux-agent-instructions.js')
            : id === '@theia/core/shared/react' ? React : require(id));
    assert.equal(exports.agentInstructionContent('1. '), '');
    assert.equal(exports.agentInstructionContent('1. \n2. '), '');
    assert.equal(exports.agentInstructionContent('1. 先跑测试'), '1. 先跑测试');
    const html = renderToStaticMarkup(React.createElement(exports.ThreadProjectAgentsFloat, {
        locale: 'zh-CN', workspaceRoot: '/work/nextmux', api: { getAgentInstructions: async () => ({}), saveAgentInstructions: async () => ({}) }
    }));
    assert.match(html, /placeholder="1\. 写点什么…"/, 'the same placeholder as a note');
    const card = notesSource.slice(notesSource.indexOf('export function ThreadProjectAgentsFloat('), notesSource.indexOf('export const ThreadProjectAgentsNote'));
    assert.match(card, /continueNoteList\(target\.value, target\.selectionStart, target\.selectionEnd\)/);
    assert.match(card, /removeNoteListMarker\(target\.value, target\.selectionStart\)/);
    assert.match(card, /setDraft\('1\. '\);\s*latestDraftRef\.current = '1\. ';/);
    assert.match(card, /const contentToSave = agentInstructionContent\(latestDraftRef\.current\);/);
});
