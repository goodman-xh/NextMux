import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const viewSource = readFileSync(new URL('../src/browser/nextmux-conversation-tabs-view.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('view.tsx', viewSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const live = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'LiveTabView');
const start = live.body.statements.findIndex(node => ts.isVariableStatement(node) && node.declarationList.declarations[0]?.name.getText(ast) === 'keyboard');
const end = live.body.statements.findIndex(node => ts.isVariableStatement(node) && node.declarationList.declarations[0]?.name.getText(ast) === 'statusText');
assert.ok(start >= 0 && end > start);
const inputSource = live.body.statements.slice(start, end).map(node => node.getText(ast)).join('\n');
const transpile = value => ts.transpileModule(value, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
const queueExports = {};
new Function('exports', transpile(readFileSync(new URL('../src/browser/nextmux-window-input-queue.ts', import.meta.url), 'utf8')))(queueExports);
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
function fixture({ blockFirst = false } = {}) {
    const calls = [], effects = [], timers = new Map(), gate = deferred(); let serial = 0;
    const target = {
        async pointer(input) { calls.push(input.kind); if (blockFirst && calls.length === 1) await gate.promise; return true; },
        async keys(input) { calls.push(input.key || input.text); return true; }
    };
    const React = { useRef: value => ({ current: value }), useEffect: setup => effects.push(setup) };
    const create = new Function('React', 'ConversationWindowInputQueue', 'latest', 'video', 'mouse', 'streamKey', 'pictureFraction', 'keyChord', 'setTimeout', 'clearTimeout',
        transpile(`${inputSource}\nreturn { onWheel, onClick, onKeyboardInput, onKeyboardDown, onKeyboardCompositionEnd, onPointerDown, onPointerUp, settle: () => inputQueue.current.enqueue(() => true) };`));
    const handlers = create(React, queueExports.ConversationWindowInputQueue, { current: target }, { current: {} }, true, 'window-a',
        () => ({ x: .5, y: .5 }), () => ({ key: 'enter', modifiers: [] }),
        (callback, delay) => { const id = ++serial; timers.set(id, { callback, delay }); return id; }, id => timers.delete(id));
    const cleanups = effects.map(setup => setup()).filter(Boolean);
    const event = extra => ({ clientX: 10, clientY: 10, preventDefault() {}, stopPropagation() {}, nativeEvent: {}, currentTarget: { value: '', setPointerCapture() {}, hasPointerCapture: () => false }, ...extra });
    return { ...handlers, calls, gate, event, timers, flushTimers() { const pending = [...timers]; timers.clear(); pending.forEach(([, timer]) => timer.callback()); }, dispose() { cleanups.forEach(fn => fn()); } };
}

test('real event handlers flush a buffered wheel before click and Enter', async () => {
    for (const action of ['click', 'enter']) {
        const value = fixture();
        value.onWheel(value.event({ deltaY: 80 }));
        if (action === 'click') value.onClick(value.event({ detail: 1 }));
        else value.onKeyboardDown(value.event({ key: 'Enter' }));
        await value.settle();
        assert.deepEqual(value.calls, ['scroll', action]);
        assert.equal(value.timers.size, 0);
    }
});

test('a second wheel queued during a slow native scroll stays before the next click', async () => {
    const value = fixture({ blockFirst: true });
    value.onWheel(value.event({ deltaY: 80 })); value.flushTimers();
    await Promise.resolve();
    value.onWheel(value.event({ deltaY: 120 }));
    value.onClick(value.event({ detail: 1 }));
    assert.deepEqual(value.calls, ['scroll']);
    value.gate.resolve(); await value.settle();
    assert.deepEqual(value.calls, ['scroll', 'scroll', 'click']);
});

test('text, scroll, composed text and key preserve the actual event order', async () => {
    const value = fixture();
    value.onKeyboardInput(value.event({ currentTarget: { value: 'first' } }));
    value.onWheel(value.event({ deltaY: 80 }));
    value.onKeyboardCompositionEnd(value.event({ currentTarget: { value: '输入😀' }, data: '输入😀' }));
    value.onKeyboardDown(value.event({ key: 'Enter' }));
    await value.settle();
    assert.deepEqual(value.calls, ['first', 'scroll', '输入😀', 'enter']);
});

test('unmount drops a buffered composition and wheel before either reaches a native target', async () => {
    const value = fixture();
    value.onKeyboardCompositionEnd(value.event({ currentTarget: { value: 'old input' } }));
    value.onWheel(value.event({ deltaY: 80 }));
    value.dispose(); value.flushTimers(); await value.settle();
    assert.deepEqual(value.calls, []);
});

test('the real component key isolates tab switches and reconnected window identities', () => {
    const wrapper = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ConversationVisualTabView');
    const code = wrapper.getText(ast).replace(/^export /, '');
    const create = new Function('React', 'LiveTabView', transpile(`${code}\nreturn ConversationVisualTabView;`))(
        { createElement: (_type, props) => props }, () => {});
    const key = (id, pid, windowId) => create({ tab: { id, windowRef: { pid, windowId } } }).key;
    assert.notEqual(key('a', 1, 2), key('b', 1, 2));
    assert.notEqual(key('a', 1, 2), key('a', 1, 3));
    assert.equal(key('a', 1, 2), key('a', 1, 2));
});
