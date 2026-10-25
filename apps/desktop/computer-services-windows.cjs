'use strict';

// Windows-only native services. Files are copied out of Electron's asar before PowerShell reads them.
// JSON travels over stdin/stdout; no user-controlled value is interpolated into PowerShell source.
const { spawn: nodeSpawn } = require('node:child_process');
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createInterface } = require('node:readline');

const INPUT_MARKER = 0x4e4d5558;
const MAX_FRAME_BYTES = 64 * 1024 * 1024;
const unavailable = () => ({ lock: false, sound: false, ocr: false, ocrLanguages: [], canPark: false,
  parkReason: 'foreground_input_required' });
const validId = value => Number.isSafeInteger(value) && value > 0;

function createWindowsServices({ spawn = nodeSpawn, onEvent = () => {}, onExit = () => {}, callTimeoutMs = 30_000, killGraceMs = 3_000,
  shutdownTimeoutMs = 5000, tempRoot = tmpdir(), systemRoot = process.env.SystemRoot || 'C:\\Windows' } = {}) {
  let child, directory, lineReader, disposed = false, sequence = 0, capabilities = unavailable();
  const pending = new Map();
  const cleanupDirectory = () => { if (directory) { try { rmSync(directory, { recursive: true, force: true }); } catch {} directory = undefined; } };
  const finish = (request, result) => { clearTimeout(request.timer); request.resolve(result); };
  const start = () => {
    if (disposed) throw new Error('windows_services_disposed');
    if (child) return child;
    directory ??= mkdtempSync(join(tempRoot, 'nextmux-windows-'));
    for (const name of ['computer-services-windows.ps1', 'computer-services-windows.cs', 'computer-audio-windows.cs']) {
      writeFileSync(join(directory, name), readFileSync(join(__dirname, name)), { mode: 0o600 });
    }
    const process = spawn(join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(directory, 'computer-services-windows.ps1')],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...global.process.env, NEXTMUX_PARENT_PID: String(global.process.pid) } });
    child = process;
    const reader = createInterface({ input: process.stdout });
    lineReader = reader;
    let finished = false;
    const exited = () => {
      if (finished) return;
      finished = true;
      if (child === process) {
        child = null;
        capabilities = unavailable();
      }
      reader.close();
      if (lineReader === reader) lineReader = undefined;
      for (const [requestId, request] of pending.entries()) {
        if (request.process === process) {
          pending.delete(requestId);
          finish(request, { ok: false, error: 'windows_services_exited' });
        }
      }
      if (disposed && !child) cleanupDirectory();
      else { try { onExit(); } catch {} }
    };
    process.once('error', exited);
    process.once('exit', exited);
    process.stdin?.on('error', () => {});
    process.stderr?.on('data', () => {}); // Drain compiler/runtime diagnostics; never forward script internals to the UI.
    reader.on('line', line => {
      if (child !== process || line.length > 1_048_576) return;
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message?.type === 'input-blocked') {
        if (validId(message.pid) && validId(message.windowId)) { try { onEvent(message); } catch {} }
        return;
      }
      if (message?.capability && typeof message.capability === 'object') {
        const info = message.capability;
        const canPark = info.canPark === true;
        capabilities = { lock: info.lock === true, sound: info.sound === true, ocr: info.ocr === true,
          ocrLanguages: Array.isArray(info.ocrLanguages) ? info.ocrLanguages.filter(item => typeof item === 'string').slice(0, 256) : [],
          canPark, parkReason: canPark ? '' : String(info.parkReason || 'foreground_input_required') };
      }
      const request = pending.get(message?.id);
      if (!request || request.process !== process) return;
      pending.delete(message.id);
      finish(request, message);
    });
    return process;
  };
  const call = (op, payload = {}) => new Promise(resolve => {
    if (disposed) { resolve({ ok: false, error: 'windows_services_disposed' }); return; }
    let process;
    try { process = start(); } catch { resolve({ ok: false, error: 'windows_services_unavailable' }); return; }
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, error: 'windows_services_timeout' });
      if (child === process) {
        child = null;
        capabilities = unavailable();
      }
      for (const [otherId, otherRequest] of pending.entries()) {
        if (otherRequest.process === process) {
          pending.delete(otherId);
          finish(otherRequest, { ok: false, error: 'windows_services_timeout' });
        }
      }
      // Closing stdin lets finally remove hooks and restore audio, even after an OCR timeout. A helper stuck in a
      // native call never reads stdin again: after a grace period it is stopped (the next call already uses a new one).
      try { process.stdin?.end(); } catch {}
      const kill = setTimeout(() => {
        try { if (process.exitCode === null && process.signalCode === null) process.kill(); } catch {}
      }, killGraceMs);
      kill.unref?.();
      process.once('exit', () => clearTimeout(kill));
    }, callTimeoutMs);
    pending.set(id, { resolve, timer, process });
    try { process.stdin.write(`${JSON.stringify({ ...payload, id, op })}\n`); }
    catch { pending.delete(id); finish({ resolve, timer }, { ok: false, error: 'windows_services_exited' }); }
  });
  return {
    call,
    capability: () => ({ ...capabilities, ocrLanguages: [...capabilities.ocrLanguages] }),
    ready: () => call('capability'),
    shield(targets = {}) {
      const windows = Array.isArray(targets.windows) ? targets.windows : [];
      const normalized = windows.map(item => Array.isArray(item) ? { pid: item[0], windowId: item[1] }
        : typeof item === 'object' && item ? { pid: item.pid, windowId: item.windowId } : { windowId: item });
      if (normalized.length > 256 || normalized.some(item => !validId(item.windowId) || item.pid !== undefined && !validId(item.pid))) {
        return Promise.resolve({ ok: false, error: 'shield_request_invalid' });
      }
      return call('shield', { windows: normalized });
    },
    mute(pid, muted) {
      return validId(pid) && pid <= 0xffffffff && typeof muted === 'boolean' ? call('mute', { pid, muted })
        : Promise.resolve({ ok: false, error: 'sound_request_invalid' });
    },
    windowCapability(pid, windowId) {
      return validId(pid) && validId(windowId) ? call('windowCapability', { pid, windowId })
        : Promise.resolve({ ok: false, error: 'window_invalid', canPark: false, parkReason: 'window_invalid' });
    },
    park(pid, windowId, group = '') {
      return validId(pid) && validId(windowId) ? call('park', { pid, windowId, group: String(group || '').slice(0, 240) })
        : Promise.resolve({ ok: false, error: 'window_invalid' });
    },
    unpark(pid, windowId, hostOrOptions = {}, maybeActivate = false) {
      const options = typeof hostOrOptions === 'object' && hostOrOptions !== null
        ? hostOrOptions
        : { hostWindow: hostOrOptions, activate: maybeActivate };
      const hostWindow = Number.isSafeInteger(options.hostWindow) ? options.hostWindow : 0;
      const activate = Boolean(options.activate);
      return validId(pid) && validId(windowId) ? call('unpark', { pid, windowId, hostWindow, activate })
        : Promise.resolve({ ok: false, error: 'window_invalid' });
    },
    restoreDesktops: () => call('restoreDesktops'),
    terminateProcess(pid, windowId = 0, audioPid = 0) {
      return validId(pid) ? call('terminateProcess', {
        pid,
        windowId: validId(windowId) ? windowId : 0,
        ...(validId(audioPid) ? { audioPid } : {})
      }) : Promise.resolve({ ok: false, error: 'window_invalid' });
    },
    topWindows: () => call('topWindows'),
    async captureWindow(pid, windowId, maxSize = 1280) {
      if (!validId(pid) || !validId(windowId)) return { ok: false, error: 'window_invalid' };
      const size = Math.max(256, Math.min(2048, Math.round(Number(maxSize) || 1280)));
      const reply = await call('captureWindow', { pid, windowId, maxSize: size });
      if (!reply.ok) return { ok: false, fallback: reply.error === 'window_not_capturable', error: String(reply.error || 'window_not_capturable') };
      if (typeof reply.data !== 'string' || !Number.isInteger(reply.width) || !Number.isInteger(reply.height)) {
        return { ok: false, fallback: true, error: 'window_not_capturable' };
      }
      return { ok: true, mimeType: String(reply.mimeType || 'image/jpeg'), data: reply.data, width: reply.width, height: reply.height };
    },
    async captureFrame(pid, windowId, maxWidth = 1024) {
      if (!validId(pid) || !validId(windowId)) return { ok: false, error: 'window_invalid' };
      const width = Math.max(160, Math.min(2048, Math.round(Number(maxWidth) || 1024)));
      let path;
      try {
        start();
        path = join(directory, `capture-${++sequence}.bgra`);
        const reply = await call('captureWindow', { pid, windowId, maxSize: width, path });
        if (!reply.ok) return { ok: false, fallback: reply.error === 'window_not_capturable', error: String(reply.error || 'window_not_capturable') };
        if (!Number.isInteger(reply.width) || !Number.isInteger(reply.height) || !Number.isInteger(reply.stride)) {
          return { ok: false, fallback: true, error: 'window_not_capturable' };
        }
        const data = readFileSync(path);
        if (data.length < reply.stride * reply.height) return { ok: false, error: 'window_not_capturable' };
        return { ok: true, width: reply.width, height: reply.height, stride: reply.stride, data };
      } catch {
        return { ok: false, error: disposed ? 'windows_services_disposed' : 'window_not_capturable' };
      } finally {
        if (path) { try { rmSync(path, { force: true }); } catch {} }
      }
    },
    async recognizeText(frame, rects, languages) {
      const { width, height, stride = width * 4, data } = frame || {};
      if (!Number.isInteger(width) || width < 1 || width > 8192 || !Number.isInteger(height) || height < 1 || height > 8192
        || !Number.isInteger(stride) || stride < width * 4 || stride * height > MAX_FRAME_BYTES
        || !Buffer.isBuffer(data) || data.length < stride * height || !Array.isArray(rects) || rects.length < 1 || rects.length > 16
        || rects.some(rect => !Array.isArray(rect) || rect.length !== 4 || rect.some(value => !Number.isFinite(value) || value < 0 || value > 1)
          || rect[2] <= 0 || rect[3] <= 0 || rect[0] + rect[2] > 1.00001 || rect[1] + rect[3] > 1.00001)
        || languages !== undefined && (!Array.isArray(languages) || languages.length > 4 || languages.some(value => typeof value !== 'string' || !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(value)))) {
        return { ok: false, error: 'ocr_request_invalid' };
      }
      let path;
      try {
        start();
        path = join(directory, `frame-${++sequence}.bgra`);
        writeFileSync(path, data.subarray(0, stride * height), { mode: 0o600 });
        const reply = await call('ocr', { path, width, height, stride, rects, ...(languages?.length ? { languages } : {}) });
        if (!reply.ok || !Array.isArray(reply.texts)) return { ok: false, error: String(reply.error || 'ocr_failed'),
          ...(Array.isArray(reply.ocrLanguages) ? { ocrLanguages: reply.ocrLanguages } : {}) };
        return { ok: true, texts: reply.texts.slice(0, rects.length).map(value => String(value || '').slice(0, 500)),
          ...(Array.isArray(reply.boxes) ? { boxes: reply.boxes.slice(0, rects.length) } : {}),
          ocrLanguages: capabilities.ocrLanguages };
      } catch { return { ok: false, error: disposed ? 'windows_services_disposed' : 'ocr_failed' }; }
      finally { if (path) { try { rmSync(path, { force: true }); } catch {} } }
    },
    async dispose() {
      if (disposed) return;
      // Keep stdin usable until all final commands have completed. EOF is the native restoration signal.
      if (child) await call('restore');
      disposed = true;
      const process = child;
      if (process) {
        await new Promise(resolve => {
          const timer = setTimeout(() => { process.kill(); resolve(); }, shutdownTimeoutMs);
          process.once('exit', () => { clearTimeout(timer); resolve(); });
          process.stdin.end();
        });
      }
      cleanupDirectory();
    }
  };
}

module.exports = { createWindowsServices, INPUT_MARKER };
