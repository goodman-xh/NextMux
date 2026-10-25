import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/browser/nextmux-window-input-queue.ts', import.meta.url), 'utf8');
const exports = {};
new Function('exports', ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(exports);
const { ConversationWindowInputQueue } = exports;
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

test('a long paste completes before subsequent Enter and pointer actions, with complete Unicode chunks', async () => {
    const queue = new ConversationWindowInputQueue(), gate = deferred(), sent = [];
    const value = `${'a'.repeat(1999)}😀${'b'.repeat(2100)}`;
    const typing = queue.text(value, async text => { sent.push(text); if (sent.length === 1) await gate.promise; return true; });
    const enter = queue.enqueue(async () => { sent.push('ENTER'); return true; });
    const click = queue.enqueue(async () => { sent.push('CLICK'); return true; });
    await Promise.resolve();
    assert.equal(sent.length, 1);
    gate.resolve();
    assert.deepEqual(await Promise.all([typing, enter, click]), [true, true, true]);
    assert.equal(sent.slice(0, -2).join(''), value);
    assert.deepEqual(sent.slice(-2), ['ENTER', 'CLICK']);
    for (const chunk of sent.slice(0, -2)) {
        assert.ok(chunk.length <= 2000);
        assert.equal(chunk.isWellFormed(), true);
    }
});

test('failure stops remaining paste chunks and already queued actions without resending', async () => {
    const queue = new ConversationWindowInputQueue(), calls = [];
    const typing = queue.text('x'.repeat(4001), async value => { calls.push(value); return false; });
    const enter = queue.enqueue(async () => { calls.push('ENTER'); return true; });
    assert.deepEqual(await Promise.all([typing, enter]), [false, false]);
    assert.equal(calls.length, 1);
    assert.equal(await queue.enqueue(async () => { calls.push('NEW USER INPUT'); return true; }), true);
    assert.equal(calls.length, 2);
});

test('uncertain rejected input and a previously buffered batch do not automatically replay', async () => {
    const queue = new ConversationWindowInputQueue(), generation = queue.currentGeneration;
    assert.equal(await queue.enqueue(async () => { throw Error('ack unknown'); }), false);
    let calls = 0;
    assert.equal(await queue.text('buffered before failure', async () => { calls += 1; return true; }, generation), false);
    assert.equal(calls, 0);
});

test('closing or disabling a target drops pending input but allows newly authorized input', async () => {
    const queue = new ConversationWindowInputQueue(), gate = deferred(), calls = [];
    const first = queue.enqueue(async () => { calls.push('OLD'); await gate.promise; return true; });
    const pending = queue.enqueue(async () => { calls.push('MUST NOT RUN'); return true; });
    await Promise.resolve();
    queue.cancel();
    const next = queue.enqueue(async () => { calls.push('NEW'); return true; });
    gate.resolve();
    assert.deepEqual(await Promise.all([first, pending, next]), [true, false, true]);
    assert.deepEqual(calls, ['OLD', 'NEW']);
});

test('queued targets keep their original identity when the selected tab changes', async () => {
    const queue = new ConversationWindowInputQueue(), calls = [], gate = deferred();
    const firstTarget = async text => { calls.push(['a', text]); await gate.promise; return true; };
    const first = queue.text('a text', firstTarget);
    const next = queue.text('b text', async text => { calls.push(['b', text]); return true; });
    await Promise.resolve(); gate.resolve();
    await Promise.all([first, next]);
    assert.deepEqual(calls, [['a', 'a text'], ['b', 'b text']]);
});
