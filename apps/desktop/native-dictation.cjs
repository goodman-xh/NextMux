'use strict';

const path = require('node:path');
const { existsSync } = require('node:fs');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const validLocale = value => typeof value === 'string' && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(value);
const validId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const endReasons = new Set(['completed', 'stopped', 'cancelled', 'permission-denied', 'language-unavailable', 'device-unavailable', 'text-limit', 'recognition-failed']);

function registerNativeDictation({ app, BrowserWindow, ipcMain, trustedMainFrame,
  platform = process.platform, resourcesPath = process.resourcesPath, spawnProcess = spawn, exists = existsSync,
  clockNow = () => performance.now() }) {
  const active = new Map();
  const helperConfiguration = platform === 'darwin'
    ? { engine: 'macos-speech', packaged: 'speech/NextMuxSpeechHelper.app/Contents/MacOS/NextMuxSpeechHelper',
      development: 'native/speech/macos/NextMuxSpeechHelper.app/Contents/MacOS/NextMuxSpeechHelper' }
    : platform === 'win32'
      ? { engine: 'windows-system-speech', packaged: 'speech/NextMuxSpeechHelper.exe',
        development: 'native/speech/windows/NextMuxSpeechHelper.exe' }
      : undefined;
  const helper = helperConfiguration
    ? path.join(app.isPackaged ? resourcesPath : __dirname,
      app.isPackaged ? helperConfiguration.packaged : helperConfiguration.development)
    : undefined;
  const unsupported = () => ({ status: helperConfiguration ? 'helper-unavailable' : 'platform-unavailable',
    engine: 'none', localOnly: true, defaultDeviceOnly: true });
  const supported = () => Boolean(helper && exists(helper));
  const ownerAlive = record => !record.owner.isDestroyed() && trustedMainFrame(record.event);
  const terminate = child => {
    child.kill('SIGTERM');
    const deadline = setTimeout(() => { if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL'); }, 1500);
    deadline.unref();
    child.once('close', () => clearTimeout(deadline));
  };
  const send = (record, value) => {
    try { if (ownerAlive(record)) record.owner.send('nextmux:speech:event', { ...value, sessionId: record.id }); }
    catch { record.cancel?.(); }
  };
  const finishRecord = (record, reason = 'cancelled') => {
    if (active.get(record.owner.id) !== record) return;
    active.delete(record.owner.id);
    clearTimeout(record.timer);
    clearTimeout(record.finishTimer);
    record.owner.removeListener('destroyed', record.cancel);
    record.owner.removeListener('render-process-gone', record.cancel);
    record.owner.removeListener('did-start-navigation', record.navigate);
    record.child.stdin.destroy();
    terminate(record.child);
    send(record, { type: 'end', reason });
  };
  const probe = locale => new Promise(resolve => {
    if (!supported()) { resolve(unsupported()); return; }
    let output = '', settled = false;
    let child;
    try { child = spawnProcess(helper, ['--probe', locale], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }); }
    catch { resolve(unsupported()); return; }
    const done = value => { if (settled) return; settled = true; clearTimeout(timer); child.kill('SIGTERM'); resolve(value); };
    const timer = setTimeout(() => done(unsupported()), 5000);
    child.stdout.setEncoding('utf8');
    child.on('error', () => done(unsupported()));
    child.stdout.on('error', () => done(unsupported()));
    child.stdout.on('data', data => { output += data.toString(); if (output.length > 4096) done(unsupported()); });
    child.on('close', code => {
      if (code !== 0) { done(unsupported()); return; }
      try {
        const value = JSON.parse(output);
        if (value.type !== 'capability' || !['ready', 'permission-required', 'permission-denied', 'language-unavailable'].includes(value.status)
          || value.engine !== helperConfiguration.engine || value.localOnly !== true || value.defaultDeviceOnly !== true)
          throw new Error('INVALID_CAPABILITY');
        done({ status: value.status, engine: helperConfiguration.engine, localOnly: true, defaultDeviceOnly: true });
      } catch { done(unsupported()); }
    });
  });
  ipcMain.handle('nextmux:speech:capability', (event, locale) => trustedMainFrame(event) && validLocale(locale) ? probe(locale) : unsupported());
  ipcMain.handle('nextmux:speech:start', (event, request) => {
    if (!trustedMainFrame(event) || !validId(request?.sessionId) || !validLocale(request?.locale) || !supported()) return false;
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window?.isFocused() || active.has(event.sender.id)) return false;
    let child;
    try { child = spawnProcess(helper, ['--recognize', request.locale], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true }); }
    catch { return false; }
    const record = { id: request.sessionId, owner: event.sender, event, child, output: '', timer: undefined,
      lastLevelAt: -Infinity, finishing: false };
    record.cancel = () => finishRecord(record);
    record.navigate = (_event, _url, _inPlace, mainFrame) => { if (mainFrame) record.cancel(); };
    active.set(event.sender.id, record);
    event.sender.once('destroyed', record.cancel);
    event.sender.once('render-process-gone', record.cancel);
    event.sender.on('did-start-navigation', record.navigate);
    // Includes a potentially pending OS permission prompt. No retry or new session.
    record.timer = setTimeout(record.cancel, 6 * 60 * 1000);
    child.stdout.setEncoding('utf8');
    child.on('error', () => finishRecord(record, 'recognition-failed'));
    child.stdin.on('error', () => finishRecord(record, 'recognition-failed'));
    child.on('close', () => finishRecord(record, 'recognition-failed'));
    child.stdout.on('data', data => {
      if (active.get(record.owner.id) !== record || !ownerAlive(record)) { record.cancel(); return; }
      record.output += data.toString();
      if (Buffer.byteLength(record.output) > 65536) { finishRecord(record, 'recognition-failed'); return; }
      let newline;
      while ((newline = record.output.indexOf('\n')) >= 0) {
        const line = record.output.slice(0, newline); record.output = record.output.slice(newline + 1);
        try {
          const value = JSON.parse(line);
          if (value.type === 'listening') send(record, { type: 'listening' });
          else if (value.type === 'level' && Number.isFinite(value.value) && value.value >= 0 && value.value <= 1) {
            const now = clockNow();
            if (!record.finishing && now - record.lastLevelAt >= 100) {
              record.lastLevelAt = now;
              send(record, { type: 'level', value: value.value });
            }
          }
          else if (value.type === 'transcript' && typeof value.text === 'string' && value.text.length <= 10000 && typeof value.final === 'boolean')
            send(record, { type: 'transcript', text: value.text, final: value.final });
          else if (value.type === 'end' && endReasons.has(value.reason)) { finishRecord(record, value.reason); return; }
          else throw new Error('INVALID_SPEECH_EVENT');
        } catch { finishRecord(record, 'recognition-failed'); return; }
      }
    });
    return true;
  });
  for (const command of ['finish', 'cancel']) ipcMain.handle(`nextmux:speech:${command}`, (event, id) => {
    if (!trustedMainFrame(event) || !validId(id)) return false;
    const record = active.get(event.sender.id);
    if (!record || record.id !== id) return false;
    if (command === 'cancel') record.cancel();
    else {
      try {
        record.finishing = true;
        record.finishTimer ??= setTimeout(() => finishRecord(record, 'stopped'), 10_000);
        record.finishTimer.unref?.();
        record.child.stdin.write('finish\n');
      }
      catch { finishRecord(record, 'recognition-failed'); return false; }
    }
    return true;
  });
  // Only once quitting is certain: a quit the person cancels (a running task, 继续运行) keeps dictation going.
  app.on('will-quit', event => { if (!event.defaultPrevented) for (const record of [...active.values()]) record.cancel(); });
}

module.exports = { registerNativeDictation };
