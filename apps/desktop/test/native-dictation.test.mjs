import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const { registerNativeDictation } = createRequire(import.meta.url)('../native-dictation.cjs');
const updater = readFileSync(new URL('../updater.cjs', import.meta.url), 'utf8');
const trustSource = updater.slice(updater.indexOf('function trustedMainFrame('), updater.indexOf("require('./native-dictation.cjs')"));
const id = 'd55055b9-4673-47f1-8d7b-3ef00c32d166';
function fixture(platform = 'darwin', { isPackaged = false, exists = () => true, spawnError } = {}) {
  const handlers = new Map(), windows = [], children = [], calls = [];
  const app = Object.assign(new EventEmitter(), { isPackaged });
  const BrowserWindow = { fromWebContents: owner => windows.find(window => window.webContents === owner) };
  const trustedMainFrame = vm.runInNewContext(`(${trustSource})`, { BrowserWindow, URL });
  registerNativeDictation({ app, BrowserWindow, platform, resourcesPath: '/fixture', trustedMainFrame,
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, exists,
    spawnProcess(file, args, options) {
      if (spawnError) throw spawnError;
      calls.push({ file, args, options });
      const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kills: 0,
        kill() { this.kills++; return true; } });
      children.push(child); return child;
    } });
  const owner = (url = 'file:///fixture/index.html', focused = true) => {
    const sender = Object.assign(new EventEmitter(), { id: windows.length + 1, mainFrame: {}, events: [], destroyed: false,
      getURL: () => url, isDestroyed() { return this.destroyed; }, send(channel, value) { this.events.push({ channel, value }); } });
    windows.push({ webContents: sender, isDestroyed: () => false, isFocused: () => focused });
    return { sender, senderFrame: sender.mainFrame };
  };
  const invoke = (name, event, value) => handlers.get(`nextmux:speech:${name}`)(event, value);
  return { app, calls, children, owner, invoke };
}
test('native speech uses actual trusted main-frame guard and explicit foreground window; no untrusted spawn', async () => {
  const f = fixture(), valid = f.owner();
  for (const event of [undefined, {}, { sender: valid.sender }, { ...valid, senderFrame: {} }, f.owner('https://outside.invalid')]) {
    assert.equal(f.invoke('start', event, { sessionId: id, locale: 'zh-CN' }), false);
    assert.equal((await f.invoke('capability', event, 'zh-CN')).engine, 'none');
    assert.equal(f.invoke('cancel', event, id), false);
  }
  assert.equal(f.invoke('start', f.owner('file:///fixture/index.html', false), { sessionId: id, locale: 'zh-CN' }), false);
  assert.equal(f.invoke('start', valid, { sessionId: '../bad', locale: 'zh-CN' }), false);
  assert.equal(f.invoke('start', valid, { sessionId: id, locale: 'zh-CN;not-a-command' }), false);
  assert.equal(f.calls.length, 0);
});
test('supported platforms fail closed when their helper is absent; other platforms remain unsupported', async () => {
  for (const platform of ['darwin', 'win32']) {
    const f = fixture(platform, { exists: () => false }), event = f.owner();
    assert.equal((await f.invoke('capability', event, 'zh-CN')).status, 'helper-unavailable');
    assert.equal(f.invoke('start', event, { sessionId: id, locale: 'zh-CN' }), false); assert.equal(f.calls.length, 0);
  }
  const other = fixture('linux'), event = other.owner();
  assert.equal((await other.invoke('capability', event, 'zh-CN')).status, 'platform-unavailable');
  assert.equal(other.calls.length, 0);
});
test('Mac and Windows speech probes report unavailable on launch or output-stream failure', async () => {
  for (const platform of ['darwin', 'win32']) {
    const broken = fixture(platform, { spawnError: new Error('launch failed') }), event = broken.owner();
    assert.equal((await broken.invoke('capability', event, 'en-US')).status, 'helper-unavailable');
    assert.equal(broken.invoke('start', event, { sessionId: id, locale: 'en-US' }), false);
    const f = fixture(platform), promise = f.invoke('capability', f.owner(), 'en-US');
    f.children[0].stdout.emit('error', new Error('pipe failed'));
    assert.equal((await promise).status, 'helper-unavailable');
    assert.equal(f.children[0].kills, 1);
  }
});
test('Windows probes and starts its packaged system speech helper directly without a shell', async () => {
  const f = fixture('win32', { isPackaged: true }), event = f.owner();
  const capability = f.invoke('capability', event, 'zh-CN');
  assert.match(f.calls[0].file.replaceAll('\\', '/'), /\/fixture\/speech\/NextMuxSpeechHelper\.exe$/);
  assert.deepEqual(f.calls[0].args, ['--probe', 'zh-CN']);
  assert.equal(f.calls[0].options.shell, undefined);
  f.children[0].stdout.write(JSON.stringify({ type: 'capability', status: 'ready', engine: 'windows-system-speech',
    localOnly: true, defaultDeviceOnly: true }));
  f.children[0].emit('close', 0);
  assert.deepEqual(await capability, { status: 'ready', engine: 'windows-system-speech', localOnly: true, defaultDeviceOnly: true });
  assert.equal(f.invoke('start', event, { sessionId: id, locale: 'zh-CN' }), true);
  assert.match(f.calls[1].file.replaceAll('\\', '/'), /\/fixture\/speech\/NextMuxSpeechHelper\.exe$/);
  assert.deepEqual(f.calls[1].args, ['--recognize', 'zh-CN']);
  assert.equal(f.calls[1].options.shell, undefined);
  assert.equal(f.invoke('cancel', event, id), true);
});
test('native capability is bounded metadata only, not recording or implicit permission request', async () => {
  const f = fixture(), event = f.owner(), promise = f.invoke('capability', event, 'zh-CN');
  assert.deepEqual(f.calls[0].args, ['--probe', 'zh-CN']); assert.equal(f.calls[0].options.stdio[0], 'ignore');
  f.children[0].stdout.write(JSON.stringify({ type: 'capability', status: 'permission-required', engine: 'macos-speech',
    localOnly: true, defaultDeviceOnly: true }));
  f.children[0].emit('close', 0);
  assert.equal((await promise).status, 'permission-required'); assert.equal(f.children[0].kills, 1);
});
test('native events remain session-owned, unicode-safe and single flight; finish/cancel cannot affect another window', () => {
  const f = fixture(), event = f.owner(), other = f.owner();
  assert.equal(f.invoke('start', event, { sessionId: id, locale: 'zh-CN' }), true);
  assert.equal(f.invoke('start', event, { sessionId: id, locale: 'zh-CN' }), false);
  const child = f.children[0], bytes = Buffer.from(JSON.stringify({ type: 'transcript', text: '你好语音', final: false }) + '\n');
  for (const byte of bytes) child.stdout.write(Buffer.from([byte]));
  assert.equal(event.sender.events[0].value.text, '你好语音'); assert.equal(event.sender.events[0].value.sessionId, id);
  assert.equal(other.sender.events.length, 0); assert.equal(f.invoke('cancel', other, id), false);
  assert.equal(f.invoke('finish', event, id), true); assert.equal(child.stdin.read().toString(), 'finish\n');
  child.stdout.write('{"type":"end","reason":"completed"}\n');
  assert.equal(child.kills, 1); assert.equal(event.sender.events.at(-1).value.reason, 'completed');
  assert.equal(f.invoke('cancel', event, id), false); assert.equal(event.sender.listenerCount('did-start-navigation'), 0);
});
test('a helper that never answers "finish" ends the session after ten seconds, not after the six-minute session limit', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(), event = f.owner();
  assert.equal(f.invoke('start', event, { sessionId: id, locale: 'zh-CN' }), true);
  const child = f.children[0];
  child.stdout.write(JSON.stringify({ type: 'transcript', text: '已经听到的话', final: false }) + '\n');
  assert.equal(f.invoke('finish', event, id), true);
  // A second press while finishing keeps the first deadline.
  assert.equal(f.invoke('finish', event, id), true);
  t.mock.timers.tick(9_999);
  assert.equal(event.sender.events.some(({ value }) => value.type === 'end'), false);
  t.mock.timers.tick(1);
  const ends = event.sender.events.filter(({ value }) => value.type === 'end');
  assert.deepEqual(ends.map(({ value }) => value.reason), ['stopped']);
  assert.equal(child.kills, 1);
  // What was heard stays delivered; the session is gone, so a late answer changes nothing.
  assert.equal(event.sender.events[0].value.text, '已经听到的话');
  child.stdout.write('{"type":"end","reason":"completed"}\n');
  t.mock.timers.tick(10_000);
  assert.equal(event.sender.events.filter(({ value }) => value.type === 'end').length, 1);
});
test('completed utterances keep the same native IPC session active until the person finishes', () => {
  for (const platform of ['darwin', 'win32']) {
    const f = fixture(platform), event = f.owner(), other = f.owner();
    assert.equal(f.invoke('start', event, { sessionId: id, locale: 'zh-CN' }), true);
    const child = f.children[0];
    for (const snapshot of [
      { text: '第一句未修正', final: false }, { text: '第一句', final: true },
      { text: '第一句第二', final: false }, { text: '第一句第二句', final: true },
    ]) child.stdout.write(JSON.stringify({ type: 'transcript', ...snapshot }) + '\n');
    assert.equal(child.kills, 0);
    assert.deepEqual(event.sender.events.map(({ value }) => value.text), ['第一句未修正', '第一句', '第一句第二', '第一句第二句']);
    assert.ok(event.sender.events.every(({ value }) => value.sessionId === id));
    assert.equal(other.sender.events.length, 0);
    assert.equal(f.invoke('start', event, { sessionId: id, locale: 'zh-CN' }), false);
    assert.equal(f.invoke('finish', event, id), true);
    assert.equal(child.stdin.read().toString(), 'finish\n');
    child.stdout.write('{"type":"end","reason":"stopped"}\n');
    const delivered = event.sender.events.length;
    child.stdout.write('{"type":"transcript","text":"late stale text","final":true}\n');
    assert.equal(event.sender.events.length, delivered);
    assert.equal(child.kills, 1);
  }
});
test('navigation, window destruction, app quit and invalid helper output release only their sessions', () => {
  for (const cause of ['navigation', 'destroyed', 'renderer-crash', 'quit', 'invalid', 'oversize', 'error', 'delivery-failed']) {
    const f = fixture(), event = f.owner();
    f.invoke('start', event, { sessionId: id, locale: 'en-US' });
    const child = f.children[0];
    if (cause === 'navigation') event.sender.emit('did-start-navigation', {}, 'file:///different.html', false, true);
    if (cause === 'destroyed') { event.sender.destroyed = true; event.sender.emit('destroyed'); }
    if (cause === 'renderer-crash') event.sender.emit('render-process-gone');
    if (cause === 'quit') { f.app.emit('before-quit'); assert.equal(child.kills, 0, 'a quit that may still be cancelled keeps dictation'); f.app.emit('will-quit', { defaultPrevented: false }); }
    if (cause === 'invalid') child.stdout.write('{"type":"send-user-message"}\n');
    if (cause === 'oversize') child.stdout.write('x'.repeat(65537));
    if (cause === 'error') child.emit('error', new Error('test'));
    if (cause === 'delivery-failed') { event.sender.send = () => { throw new Error('renderer gone'); }; child.stdout.write('{"type":"listening"}\n'); }
    assert.equal(child.kills, 1, cause); assert.equal(child.stdin.destroyed, true, cause);
    assert.equal(f.invoke('cancel', event, id), false, cause);
  }
});
test('Swift contract is local-only and build resources include privacy metadata for both Mac architectures', () => {
  const swift = readFileSync(new URL('../native/speech/NextMuxSpeechHelper.swift', import.meta.url), 'utf8');
  assert.match(swift, /requiresOnDeviceRecognition = true/); assert.match(swift, /supportsOnDeviceRecognition/);
  assert.match(swift, /removeTap\(onBus: 0\)/); assert.match(swift, /task\?\.cancel\(\)/); assert.match(swift, /replaceRequest\(nil\)\?\.endAudio\(\)/);
  assert.doesNotMatch(swift, /URLSession|requiresOnDeviceRecognition = false|write\(to:|installModel/);
  const build = readFileSync(new URL('../../../scripts/build-native-speech.mjs', import.meta.url), 'utf8');
  assert.match(build, /\['arm64', 'x86_64'\]/); assert.match(build, /NSSpeechRecognitionUsageDescription/);
  assert.match(build, /sysctl\.proc_translated/); assert.match(build, /\['-arm64', 'xcrun'/);
  assert.match(readFileSync(new URL('../electron-builder.config.cjs', import.meta.url), 'utf8'), /speech\/NextMuxSpeechHelper.app/);
});
test('Windows helper uses only installed System.Speech recognition and is built as executable AnyCPU for both release runners', () => {
  const source = readFileSync(new URL('../native/speech/NextMuxSpeechHelper.cs', import.meta.url), 'utf8');
  assert.match(source, /SpeechRecognitionEngine\.InstalledRecognizers\(\)/);
  assert.match(source, /new DictationGrammar\(\)/);
  assert.match(source, /SetInputToDefaultAudioDevice\(\)/);
  assert.match(source, /RecognizeAsync\(RecognizeMode\.Multiple\)/);
  assert.match(source, /windows-system-speech/);
  assert.match(source, /Console\.ReadLine\(\)/);
  assert.doesNotMatch(source, /HttpClient|WebClient|URLSession|Process\.Start|SendKeys|installModel|Download/);
  const build = readFileSync(new URL('../../../scripts/build-native-speech.mjs', import.meta.url), 'utf8');
  assert.match(build, /\/platform:anycpu/);
  assert.match(build, /\/reference:System\.Speech\.dll/);
  assert.match(build, /spawnSync\(target, \['--probe', 'en-US'\]/);
  const builder = readFileSync(new URL('../electron-builder.config.cjs', import.meta.url), 'utf8');
  assert.match(builder, /native\/speech\/windows/);
  assert.match(builder, /NextMuxSpeechHelper\.exe/);
});
