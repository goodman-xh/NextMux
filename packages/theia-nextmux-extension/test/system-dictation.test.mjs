import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { focusSystemDictationDraft, dictationShortcut, shouldSubmitComposerKey, SystemDictationHint, systemDictationCopy, observeSystemDictationClearance } from '../lib/browser/nextmux-system-dictation.js';
import { AgentQuestionPanel } from '../lib/browser/nextmux-agent-question-panel.js';
import { NativeDictationAdapter } from '../lib/browser/nextmux-native-dictation-adapter.js';
import { ImeTextarea, isImeFieldComposing } from '../lib/browser/nextmux-ime-field.js';

const require = createRequire(import.meta.url);
const coreRequire = createRequire(require.resolve('@theia/core/package.json'));
const { renderToStaticMarkup } = coreRequire('react-dom/server');
const React = coreRequire('react');
const ts = require('typescript');

function draftFixture(question = false, changes = {}) {
    const document = { activeElement: null }, focused = [];
    const input = { ownerDocument: document, disabled: false, readOnly: false, isConnected: true, value: 'existing draft', selectionStart: 3, selectionEnd: 7,
        setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
        getBoundingClientRect() { return { top: 20, bottom: 60, height: 40 }; },
        focus(options) { assert.equal(options.preventScroll, true); focused.push('input'); document.activeElement = this; }, ...changes };
    const body = { scrollTop: 0, getBoundingClientRect() { return { top: 0, bottom: 100, height: 100 }; } };
    const composer = { ...input, value: 'unrelated queue draft', focus() { focused.push('composer'); document.activeElement = this; } };
    const root = { ownerDocument: document, querySelector(selector) {
        if (selector === '.nmx-user-question') return question ? { querySelector: child => child === 'textarea' ? input : child === '.nmx-user-question-body' ? body : null } : null;
        if (selector === '.nmx-composer textarea') return question ? composer : input;
        assert.fail(`unexpected selector: ${selector}`);
    } };
    return { root, document, input, composer, body, focused };
}

test('system dictation focuses only the current editable draft, preserving text and a caret the user already placed', () => {
    const f = draftFixture();
    assert.equal(focusSystemDictationDraft(f.root), 'composer');
    assert.equal(f.document.activeElement, f.input); assert.equal(f.input.value, 'existing draft');
    // An unfocused draft gets the caret after its text, so dictation appends instead of splitting a word.
    assert.equal(f.input.selectionStart, 14); assert.equal(f.input.selectionEnd, 14);
    const placed = draftFixture();
    placed.document.activeElement = placed.input;
    assert.equal(focusSystemDictationDraft(placed.root), 'composer');
    assert.deepEqual(placed.focused, []); assert.equal(placed.input.selectionStart, 3); assert.equal(placed.input.selectionEnd, 7);
});

test('pending AI answers take priority, and a disabled answer never falls through to a queued message', () => {
    const f = draftFixture(true);
    assert.equal(focusSystemDictationDraft(f.root), 'question');
    assert.deepEqual(f.focused, ['input']); assert.equal(f.composer.value, 'unrelated queue draft');
    for (const changes of [{ disabled: true }, { readOnly: true }, { isConnected: false }]) {
        const blocked = draftFixture(true, changes);
        assert.equal(focusSystemDictationDraft(blocked.root), 'unavailable'); assert.deepEqual(blocked.focused, []);
    }
    assert.equal(focusSystemDictationDraft({ querySelector: () => null }), 'unavailable');
});

test('a long question reveals only its answer field internally, preserving selection and leaving the queue untouched', () => {
    const f = draftFixture(true, { getBoundingClientRect() { return { top: 750, bottom: 810, height: 60 }; } });
    f.body.getBoundingClientRect = () => ({ top: 100, bottom: 300, height: 200 });
    f.document.activeElement = f.input;
    assert.equal(focusSystemDictationDraft(f.root), 'question');
    assert.equal(f.body.scrollTop, 510); assert.equal(f.input.selectionStart, 3); assert.equal(f.input.selectionEnd, 7);
    assert.equal(f.input.value, 'existing draft'); assert.equal(f.composer.value, 'unrelated queue draft');
    const ordinary = draftFixture(false);
    assert.equal(focusSystemDictationDraft(ordinary.root), 'composer'); assert.equal(ordinary.body.scrollTop, 0);
    const visible = draftFixture(true);
    focusSystemDictationDraft(visible.root); assert.equal(visible.body.scrollTop, 0);
});

test('all twelve locales provide compact system-owned privacy help without fake shortcut, recording or payment claims', () => {
    assert.equal(Object.keys(systemDictationCopy).length, 12);
    for (const [locale, copy] of Object.entries(systemDictationCopy)) {
        assert.equal(copy.length, 8);
        assert.match(dictationShortcut(locale, 'Win32'), /Win \+ H/);
        assert.equal(dictationShortcut(locale, 'darwin'), copy[2]); assert.equal(dictationShortcut(locale, 'MacIntel'), copy[2]);
        assert.equal(dictationShortcut(locale, 'Linux'), copy[3]);
        const html = renderToStaticMarkup(React.createElement(SystemDictationHint, { locale, platform: 'darwin', target: 'question', onExit() {} }));
        assert.ok(html.includes(copy[6])); assert.ok(html.includes(copy[7]));
        assert.match(html, /role="status"/); assert.doesNotMatch(html, /OpenAI|OpenRouter|60|8 MB|Fn|MediaRecorder|is-listening/);
        assert.doesNotMatch(html, /codicon-close/);
        assert.match(html, /<details><summary>/); assert.match(html, /<small tabindex="0">/);
    }
});

test('Enter and IME during the listening help never submit a task or queue entry; explicit ordinary Enter still works', () => {
    const enter = { key: 'Enter', shiftKey: false };
    assert.equal(shouldSubmitComposerKey(enter, false), true);
    for (const event of [enter, { ...enter, ctrlKey: true }, { ...enter, metaKey: true }]) assert.equal(shouldSubmitComposerKey(event, true), false);
    for (const event of [{ ...enter, isComposing: true }, { ...enter, keyCode: 229 }, { ...enter, shiftKey: true }, { ...enter, key: 'a' }]) assert.equal(shouldSubmitComposerKey(event, false), false);
});

test('composer clears its IME guard when an input method cancels composition on blur', () => {
    const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    const refIndex = source.indexOf('ref={this.composerTextareaRef}');
    const composer = source.slice(source.lastIndexOf('<textarea', refIndex), source.indexOf('placeholder={this.goalComposerActive', refIndex));
    assert.match(composer, /onCompositionStart=\{[^}]*this\.composerComposing = true;/);
    assert.match(composer, /onCompositionEnd=\{event => \{/);
    assert.match(composer, /onBlur=\{event => \{[\s\S]*?this\.composerComposing = false;[\s\S]*?this\.syncComposerDomControls\(\);/);
});

test('actual AI question panel suppresses keyboard submission during dictation help while preserving explicit buttons and independent draft edits', () => {
    let answers = 0, text = '', cancelled = 0;
    const queue = ['keep queued task'];
    const props = { question: { questionId: 'q', taskId: 'task', runId: 'run', prompt: 'Question?', options: [] }, draft: { text: '', optionId: '' },
        locale: 'en', submitting: false, queuedCount: queue.length, keyboardSubmitDisabled: true,
        onEdit(patch) { text = patch.text; }, onAnswer() { answers++; }, onCancel() { cancelled++; } };
    const panel = AgentQuestionPanel(props);
    const key = { key: 'Enter', ctrlKey: true, nativeEvent: { isComposing: false }, stopPropagation() {}, preventDefault() {} };
    panel.props.onKeyDown(key); assert.equal(answers, 0);
    const walk = node => [node, ...[].concat(node?.props?.children || []).filter(Boolean).flatMap(walk)];
    const nodes = walk(panel);
    nodes.find(node => node.type === 'textarea' || node.type === ImeTextarea).props.onChange({ currentTarget: { value: 'spoken answer' } });
    assert.equal(text, 'spoken answer'); assert.deepEqual(queue, ['keep queued task']); assert.equal(answers, 0);
    panel.props.onSubmit({ preventDefault() {}, stopPropagation() {} }); assert.equal(answers, 1); assert.equal(cancelled, 0);
    AgentQuestionPanel({ ...props, keyboardSubmitDisabled: false }).props.onKeyDown(key); assert.equal(answers, 2);
});

test('actual widget mic binds only the original question to the native adapter, never a cloud setting or queued task', async () => {
    const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let method, stopMethod, phaseMethod;
    const visit = node => {
        if (ts.isMethodDeclaration(node)) {
            const name = node.name.getText(file);
            if (name === 'openVoiceInput') method = node;
            else if (name === 'stopVoiceInput') stopMethod = node;
            else if (name === 'onNativeDictationPhase') phaseMethod = node;
        }
        ts.forEachChild(node, visit);
    };
    visit(file); assert.ok(method?.body); assert.ok(stopMethod?.body); assert.ok(phaseMethod?.body);
    const open = method.body.getText(file).slice(1, -1);
    const stop = stopMethod.body.getText(file).slice(1, -1);
    const onPhase = phaseMethod.body.getText(file).slice(1, -1);
    assert.match(stop, /stopMicrophoneCapture\(false\)/);
    const f = draftFixture(true); let stops = 0, renders = 0, callback, answer = f.input.value;
    f.document.activeElement = f.input;
    Object.assign(f.input, { addEventListener() {}, removeEventListener() {} });
    const question = { questionId: 'q' }, nativeCalls = [];
    const bridge = { async getSpeechCapability() { return { status: 'ready', engine: 'macos-speech', localOnly: true }; },
        async startSpeech(request) { nativeCalls.push(request); callback?.({ sessionId: request.sessionId, type: 'listening' }); return true; }, async finishSpeech() { return true; }, async cancelSpeech() { return true; },
        onSpeechEvent(listener) { callback = listener; return () => undefined; } };
    const compiledPhase = vm.runInNewContext(ts.transpileModule(`(function(adapter, phase) { ${onPhase} })`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText);
    const widget = { node: f.root, prompt: 'keep normal message', followUpQueue: ['keep queue'],
        activeSection: 'coding', codingPanel: 'thread', activeCodingSessionId: 'session', activeAgentRunId: 'run', desktopLocale: 'zh-CN',
        nativeDictationActivity: { set() {} },
        onNativeDictationPhase(adapter, phase) { return compiledPhase.call(this, adapter, phase); },
        currentAgentQuestionState() { return { runId: this.activeAgentRunId, questions: this.agentQuestions }; },
        agentQuestions: { visible: () => question, isSubmitting: () => false, get draft() { return { text: answer }; },
            edit(_question, patch) { assert.equal(_question, question); answer = patch.text; } },
        get platformService() { assert.fail('Old cloudEnabled must never be consulted'); },
        stopVoiceInput(render) { assert.equal(render, false); stops++; }, update() { renders++; }, submitPrompt() { assert.fail('No submit'); } };
    const compiled = ts.transpileModule(`(async function() { ${open} })`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    try {
        await vm.runInNewContext(compiled, { focusSystemDictationDraft, NativeDictationAdapter, isImeFieldComposing, window: { nextmuxDesktop: bridge, crypto: { randomUUID: () => 'native-fixture' } } }).call(widget);
        assert.equal(stops, 1); assert.equal(renders, 2); assert.equal(widget.nativeDictation.active, true); assert.equal(widget.nativeDictationPhase, 'listening');
        assert.equal(widget.systemDictationTarget, 'question'); assert.equal(widget.prompt, 'keep normal message');
        assert.deepEqual(widget.followUpQueue, ['keep queue']); assert.equal(f.document.activeElement, f.input);
        assert.equal(nativeCalls.length, 1);
        callback({ sessionId: 'native-fixture', type: 'transcript', text: 'hello', final: true });
        assert.equal(answer, 'exihellosting draft'); assert.equal(widget.prompt, 'keep normal message'); assert.deepEqual(widget.followUpQueue, ['keep queue']);
    } finally {
        widget.nativeDictation?.cancel();
    }
    assert.doesNotMatch(source, /CloudSpeechSettingsPanel|cloudSpeechUploading|startCloudVoiceInput|webkitSpeechRecognition|new Recognition/);
    assert.match(source, /shouldSubmitComposerKey\(event.nativeEvent, this.systemDictationTarget !== 'unavailable'\)/);
    assert.match(source, /<DictationButton locale=\{this\.desktopLocale\} active=\{Boolean\(this\.nativeDictation\?\.active\)\} phase=\{this\.nativeDictationPhase\}/);
});

test('dictation mode stays visible until explicit exit; exit restores keyboard submission without sending or stopping OS recognition', () => {
    const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let stopMethod;
    const visit = node => { if (ts.isMethodDeclaration(node) && node.name.getText(file) === 'stopVoiceInput') stopMethod = node; ts.forEachChild(node, visit); };
    visit(file); assert.ok(stopMethod?.body);
    const body = stopMethod.body.getText(file).slice(1, -1);
    let renders = 0, meterStops = 0;
    const widget = { systemDictationHelpOpen: true, systemDictationTarget: 'question', prompt: 'draft retained', followUpQueue: ['keep queue'],
        nativeDictationActivity: { set() {} },
        stopMicrophoneCapture(render) { assert.equal(render, false); meterStops++; }, update() { renders++; },
        submitPrompt() { assert.fail('Exit never sends'); } };
    const exit = vm.runInNewContext(ts.transpileModule(`(function(render = true) { ${body} })`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText);
    const onExit = () => exit.call(widget);
    const panel = React.createElement(SystemDictationHint, { locale: 'en', platform: 'darwin', target: widget.systemDictationTarget, onExit });
    assert.equal(widget.systemDictationHelpOpen, true);
    assert.equal(shouldSubmitComposerKey({ key: 'Enter', shiftKey: false }, widget.systemDictationTarget !== 'unavailable'), false);
    assert.match(renderToStaticMarkup(panel), /Stop dictation with the system shortcut before exiting/);
    onExit();
    assert.equal(widget.systemDictationHelpOpen, false); assert.equal(widget.systemDictationTarget, 'unavailable');
    assert.equal(shouldSubmitComposerKey({ key: 'Enter', shiftKey: false }, widget.systemDictationTarget !== 'unavailable'), true);
    assert.equal(widget.prompt, 'draft retained'); assert.deepEqual(widget.followUpQueue, ['keep queue']);
    assert.equal(renders, 1); assert.equal(meterStops, 1);
    assert.doesNotMatch(body, /platformService|nativeAction|speechRecognition|transcribe|submitPrompt/);
});

test('dictation clearance measures the whole actual composer, is scoped, deduplicated and cleaned without React resize loops', () => {
    const savedObserver = globalThis.ResizeObserver;
    const frames = new Map(), writes = [], watched = [];
    let resize, disconnected = 0, nextFrame = 0, top = 198.5;
    globalThis.ResizeObserver = class {
        constructor(callback) { resize = callback; }
        observe(node) { watched.push(node); }
        disconnect() { disconnected++; }
    };
    try {
        const composer = { getBoundingClientRect() { return { top }; } }, thread = { getBoundingClientRect() { return { bottom: 640 }; } };
        const shell = { querySelector(selector) { assert.equal(selector, '.nmx-task-view'); return thread; },
            style: { setProperty(name, value) { writes.push([name, value]); }, removeProperty(name) { writes.push([name, null]); } } };
        const view = { requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; },
            cancelAnimationFrame(frame) { frames.delete(frame); } };
        const hint = { isConnected: true, closest(selector) { return selector === '.nmx-shell' ? shell : selector === '.nmx-composer-wrap' ? composer : null; },
            ownerDocument: { defaultView: view } };
        const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); };
        const cleanup = observeSystemDictationClearance(hint);
        assert.deepEqual(watched, [composer, thread]); assert.equal(frames.size, 1);
        resize(); resize(); assert.equal(frames.size, 1); assert.equal(writes.length, 0);
        flush(); assert.deepEqual(writes, [['--nmx-dictation-composer-clearance', '442px']]);
        resize(); flush(); assert.equal(writes.length, 1);
        top = 111.1; resize(); flush(); assert.deepEqual(writes.at(-1), ['--nmx-dictation-composer-clearance', '529px']);
        resize(); cleanup(); assert.equal(disconnected, 1); assert.equal(frames.size, 0);
        assert.deepEqual(writes.at(-1), ['--nmx-dictation-composer-clearance', null]);
        resize(); assert.equal(frames.size, 0);
        observeSystemDictationClearance({ closest: () => null, ownerDocument: { defaultView: view } })();
        assert.equal(watched.length, 2);
    } finally { globalThis.ResizeObserver = savedObserver; }
});
