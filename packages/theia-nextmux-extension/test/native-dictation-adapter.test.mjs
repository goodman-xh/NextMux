import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeDictationAdapter } from '../lib/browser/nextmux-native-dictation-adapter.js';
const id = 'd55055b9-4673-47f1-8d7b-3ef00c32d166';
function fixture(status = 'ready', engine = 'macos-speech') {
    const input = Object.assign(new EventTarget(), { isConnected: true, selectionStart: 4, selectionEnd: 7 });
    let value = 'keepOLD tail', callback, current = true;
    const calls = [], phases = [], queue = ['unrelated queued message'];
    const owner = { input, read: () => current ? value : undefined, write: next => { value = next; calls.push(['write', next]); } };
    const bridge = { async getSpeechCapability() { return { status, engine, localOnly: true, defaultDeviceOnly: true }; },
        async startSpeech(request) { calls.push(['start', request]); return true; },
        async finishSpeech(sessionId) { calls.push(['finish', sessionId]); return true; },
        async cancelSpeech(sessionId) { calls.push(['cancel', sessionId]); return true; },
        onSpeechEvent(listener) { callback = listener; return () => { calls.push(['unsubscribe']); }; } };
    const adapter = new NativeDictationAdapter(bridge, owner, 'zh-CN', id, phase => phases.push(phase));
    return { adapter, bridge, owner, input, queue, calls, phases, emit: event => callback?.({ sessionId: id, ...event }),
        text: () => value, setText: next => { value = next; }, switchOwner: () => { current = false; } };
}
test('local speech streams insert at the captured caret and retain existing selected text; no message is submitted', async () => {
    const f = fixture(); await f.adapter.start();
    f.emit({ type: 'listening' }); assert.equal(f.phases.at(-1), 'listening');
    f.emit({ type: 'transcript', text: '你', final: false }); assert.equal(f.text(), 'keep你OLD tail');
    f.emit({ type: 'transcript', text: '你好', final: true }); assert.equal(f.text(), 'keep你好OLD tail');
    f.emit({ type: 'end', reason: 'completed' });
    assert.equal(f.adapter.active, false); assert.deepEqual(f.queue, ['unrelated queued message']);
    assert.equal(f.calls.filter(call => call[0] === 'start').length, 1);
    assert.equal(f.calls.filter(call => call[0] === 'cancel').length, 1);
});
test('Windows System.Speech uses the same isolated draft protocol', async () => {
    const f = fixture('ready', 'windows-system-speech'); await f.adapter.start();
    f.emit({ type: 'listening' }); f.emit({ type: 'transcript', text: 'Windows 本地语音', final: true });
    assert.equal(f.text(), 'keepWindows 本地语音OLD tail');
    assert.equal(f.calls.filter(call => call[0] === 'start').length, 1);
    f.emit({ type: 'end', reason: 'stopped' }); assert.equal(f.adapter.active, false);
    assert.deepEqual(f.queue, ['unrelated queued message']);
});
test('old events and a changed conversation/question never edit the new owner or a queued draft', async () => {
    const f = fixture(); await f.adapter.start();
    f.emit({ sessionId: 'old-session', type: 'transcript', text: 'wrong owner', final: true });
    assert.equal(f.text(), 'keepOLD tail');
    f.switchOwner(); f.emit({ type: 'transcript', text: 'late result', final: true });
    assert.equal(f.adapter.active, false); assert.equal(f.text(), 'keepOLD tail'); assert.deepEqual(f.queue, ['unrelated queued message']);
});
test('typing or IME cancels recognition without swallowing the input action, while pointerdown or arrow keys keep recording active', async () => {
    for (const type of ['input', 'compositionstart', 'keydown']) {
        const f = fixture(); await f.adapter.start();
        const event = Object.assign(new Event(type, { cancelable: true }), type === 'keydown' ? { key: 'a' } : {});
        f.input.dispatchEvent(event);
        assert.equal(event.defaultPrevented, false); assert.equal(f.adapter.active, false);
        f.setText('manual edit'); f.emit({ type: 'transcript', text: 'must not overwrite', final: true });
        assert.equal(f.text(), 'manual edit'); assert.equal(f.calls.filter(call => call[0] === 'cancel').length, 1);
    }
    const nav = fixture(); await nav.adapter.start();
    nav.input.dispatchEvent(new Event('pointerdown', { cancelable: true }));
    assert.equal(nav.adapter.active, true);
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']) {
        nav.input.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key }));
        assert.equal(nav.adapter.active, true);
    }
    nav.adapter.cancel();
});
test('out-of-band draft edits are detected before applying a native result', async () => {
    const f = fixture(); await f.adapter.start(); f.setText('edited elsewhere');
    f.emit({ type: 'transcript', text: 'stale result', final: true });
    assert.equal(f.text(), 'edited elsewhere'); assert.equal(f.adapter.active, false);
});
test('unavailable/denied capabilities never start, install models or fall back to a remote engine', async () => {
    for (const status of ['platform-unavailable', 'helper-unavailable', 'permission-denied', 'language-unavailable']) {
        const f = fixture(status); await f.adapter.start();
        assert.equal(f.phases.at(-1), 'unavailable'); assert.equal(f.calls.some(call => call[0] === 'start'), false);
    }
    const f = fixture();
    f.bridge.getSpeechCapability = async () => ({ status: 'ready', engine: 'macos-speech', localOnly: false });
    await f.adapter.start(); assert.equal(f.phases.at(-1), 'unavailable'); assert.equal(f.calls.length, 0);
});
test('cancelling a pending capability or start receipt cannot start capture later or leak a late session', async () => {
    const f = fixture(); let resolveCapability;
    f.bridge.getSpeechCapability = () => new Promise(resolve => { resolveCapability = resolve; });
    const starting = f.adapter.start(); f.adapter.cancel();
    resolveCapability({ status: 'ready', engine: 'macos-speech', localOnly: true }); await starting;
    assert.equal(f.calls.some(call => call[0] === 'start'), false);
    const late = fixture(); let resolveStart;
    late.bridge.startSpeech = () => new Promise(resolve => { resolveStart = resolve; });
    const pending = late.adapter.start(); await Promise.resolve(); late.adapter.cancel(); resolveStart(true); await pending;
    assert.ok(late.calls.some(call => call[0] === 'cancel')); assert.equal(late.adapter.active, false);
});
test('finish is single-flight, preserves final text as draft and never auto-restarts after native failure', async () => {
    const f = fixture('permission-required'); await f.adapter.start();
    f.adapter.finish(); f.adapter.finish(); assert.equal(f.calls.filter(call => call[0] === 'finish').length, 1);
    f.emit({ type: 'transcript', text: '保留', final: true }); f.emit({ type: 'end', reason: 'recognition-failed' });
    assert.equal(f.text(), 'keep保留OLD tail'); assert.equal(f.phases.at(-1), 'error');
    assert.equal(f.calls.filter(call => call[0] === 'start').length, 1); assert.equal(f.adapter.active, false);
});

test('duplicate transcripts do not re-render and a rejected draft write ends native capture safely', async () => {
    const f = fixture(); await f.adapter.start();
    f.emit({ type: 'transcript', text: '相同', final: false }); f.emit({ type: 'transcript', text: '相同', final: false });
    assert.equal(f.calls.filter(call => call[0] === 'write').length, 1);
    f.owner.write = () => { throw new Error('draft unavailable'); };
    assert.doesNotThrow(() => f.emit({ type: 'transcript', text: 'new', final: true }));
    assert.equal(f.phases.at(-1), 'error'); assert.equal(f.adapter.active, false);
    assert.equal(f.calls.filter(call => call[0] === 'cancel').length, 1);
});

test('transcript owner callback receives partial and final flags after the draft is updated', async () => {
    const f = fixture();
    const updates = [];
    f.owner.onTranscript = (value, final) => updates.push({ value, final });
    await f.adapter.start();
    f.emit({ type: 'transcript', text: '部', final: false });
    f.emit({ type: 'transcript', text: '完整命令', final: true });
    assert.deepEqual(updates, [
        { value: '部', final: false },
        { value: '完整命令', final: true }
    ]);
    f.adapter.cancel();
});


test('a final transcript identical to its partial is delivered once, without rewriting the draft', async () => {
    const f = fixture();
    const commands = [];
    f.owner.onTranscript = (text, final) => { if (final) commands.push(text); };
    await f.adapter.start();
    f.emit({ type: 'transcript', text: '暂停', final: false });
    assert.deepEqual(commands, []);
    f.emit({ type: 'transcript', text: '暂停', final: true });
    f.emit({ type: 'transcript', text: '暂停', final: true });
    assert.deepEqual(commands, ['暂停']);
    assert.equal(f.calls.filter(call => call[0] === 'write').length, 1);
    f.switchOwner();
    f.emit({ type: 'transcript', text: '后退 10 秒', final: true });
    assert.deepEqual(commands, ['暂停']);
    assert.equal(f.adapter.active, false);
});

test('blur alone preserves the captured logical draft owner until an explicit edit or end', async () => {
    const f = fixture(); await f.adapter.start();
    try {
        f.input.dispatchEvent(new Event('blur'));
        f.emit({ type: 'transcript', text: '继续', final: true });
        assert.equal(f.adapter.active, true);
        assert.equal(f.text(), 'keep继续OLD tail');
    } finally { f.adapter.cancel(); }
});

test('modifier keydowns and out-of-range audio levels do not abort dictation, and transcripts over 10,000 chars truncate to remaining capacity', async () => {
    const f = fixture(); await f.adapter.start();
    try {
        f.emit({ type: 'listening' });
        for (const key of ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']) {
            const keyEvent = Object.assign(new Event('keydown', { cancelable: true }), { key });
            f.input.dispatchEvent(keyEvent);
            assert.equal(f.adapter.active, true, `${key} keydown must not cancel dictation`);
        }
        f.emit({ type: 'level', value: 1.05 });
        f.emit({ type: 'level', value: -0.05 });
        f.emit({ type: 'level', value: Number.NaN });
        assert.equal(f.adapter.active, true, 'out-of-range level samples must be clamped instead of cancelling dictation');
        const longSpeech = '语'.repeat(9995);
        f.emit({ type: 'transcript', text: longSpeech, final: true });
        assert.equal(f.text().length, 10000);
        assert.equal(f.text(), `keep${'语'.repeat(9988)}OLD tail`);
        assert.equal(f.calls.some(call => call[0] === 'finish'), true);
    } finally { f.adapter.cancel(); }
});
