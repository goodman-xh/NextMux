'use strict';

const { spawn: nodeSpawn } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const MARKER = 0x4E4D5558;
const error = code => Object.assign(new Error(code), { code });
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const keyName = value => typeof value === 'string' && value.length > 0 && value.length <= 24;
const modifiers = value => value === undefined || (Array.isArray(value) && value.length <= 4
  && value.every(item => /^(?:(?:left|right)?(?:ctrl|control|alt|option|shift|cmd|command|meta|win)|[lr](?:ctrl|control|alt|shift|win))$/i.test(item)));

// Only data goes over stdin. Neither app text nor keys are interpolated into PowerShell code.
// The source also goes over stdin: -EncodedCommand would exceed Windows' command-line limit.
const bootstrap = "$ErrorActionPreference='Stop'; try { if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -and (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System' -EA 0).ConsentPromptBehaviorAdmin -eq 0) { $p='nmx-in-'+[Guid]::NewGuid().ToString('N'); $srv=[IO.Pipes.NamedPipeServerStream]::new($p,[IO.Pipes.PipeDirection]::InOut,1,[IO.Pipes.PipeTransmissionMode]::Byte,[IO.Pipes.PipeOptions]::Asynchronous); $cmd='$c=[IO.Pipes.NamedPipeClientStream]::new(''.'','''+$p+''',[IO.Pipes.PipeDirection]::InOut,[IO.Pipes.PipeOptions]::Asynchronous);$c.Connect(10000);$r=[IO.StreamReader]::new($c,[Text.UTF8Encoding]::new($false));$w=[IO.StreamWriter]::new($c,[Text.UTF8Encoding]::new($false));$w.AutoFlush=$true;[Console]::SetIn($r);[Console]::SetOut($w);$s=[Console]::In.ReadLine();Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($s))) -ReferencedAssemblies System.Web.Extensions;[NextMuxInput.Host]::PipeRedirected=$true;[NextMuxInput.Host]::ParentPid='+$PID+';[NextMuxInput.Host]::Run()'; $enc=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cmd)); $proc=Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand',$enc; try { $srv.WaitForConnection(); $out=[Console]::OpenStandardOutput(); $in=[Console]::OpenStandardInput(); $tOut=$srv.CopyToAsync($out); $tIn=$in.CopyToAsync($srv); [Threading.Tasks.Task]::WaitAny($tOut,$tIn) | Out-Null } finally { try { $srv.Dispose() } catch {}; try { if($proc -and !$proc.HasExited){ if(!$proc.WaitForExit(1500)){ Stop-Process -Id $proc.Id -Force -EA 0 } } } catch {} }; exit 0 }; $s=[Console]::In.ReadLine(); Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($s))) -ReferencedAssemblies 'System.Web.Extensions'; $ep=0; [int]::TryParse($env:NEXTMUX_PARENT_PID,[ref]$ep) | Out-Null; [NextMuxInput.Host]::ParentPid=$ep; [NextMuxInput.Host]::Run() } catch { exit 1 }";

function commandFor(action, input) {
  if (!Number.isSafeInteger(input?.pid) || input.pid <= 0 || !Number.isSafeInteger(input?.windowId) || input.windowId <= 0) throw error('computer_window_required');
  const command = { action, pid: input.pid, windowId: input.windowId, ...(input.restore === true ? { restore: true } : {}) };
  if (['pressKey', 'hotkey'].includes(action)) {
    const keys = action === 'hotkey' ? input.keys : input.keys || [input.key];
    if (!Array.isArray(keys) || !keys.length || keys.length > 8 || !keys.every(keyName) || !modifiers(input.modifiers)
      || !integer(input.holdMs ?? 0, 0, 3000)) throw error('computer_input_invalid');
    return { ...command, action: 'keys', keys: [...(input.modifiers || []), ...keys], holdMs: input.holdMs ?? 0 };
  }
  if (action === 'typeText') {
    if (typeof input.text !== 'string' || !input.text.length || input.text.length > 16000 || !integer(input.delayMs ?? 0, 0, 100)) throw error('computer_input_invalid');
    // Bound cancellation and shutdown even if a caller requests a delay per UTF-16 unit.
    if (input.text.length * (input.delayMs || 0) > 15000) throw error('computer_input_invalid');
    return { ...command, text: input.text, delayMs: input.delayMs ?? 0 };
  }
  if (input.normalized !== undefined && typeof input.normalized !== 'boolean') throw error('computer_input_invalid');
  const normalized = input.normalized === true;
  const coordinate = value => Number.isFinite(value) && value >= 0 && value <= (normalized ? 1 : 100000);
  if (!['click', 'rightClick', 'doubleClick', 'drag', 'scroll'].includes(action)) throw error('computer_input_invalid');
  const button = action === 'rightClick' ? 'right' : input.button ?? 'left';
  if (!['left', 'right', 'middle'].includes(button)) throw error('computer_input_invalid');
  const modifier = input.modifier === undefined ? undefined : Array.isArray(input.modifier) ? input.modifier : [input.modifier];
  if (!modifiers(modifier)) throw error('computer_input_invalid');
  if (action === 'drag') {
    if (![input.fromX, input.fromY, input.toX, input.toY].every(coordinate) || !integer(input.durationMs ?? 300, 50, 3000)) throw error('computer_input_invalid');
    return { ...command, ...(normalized ? { normalized: true } : {}), button, modifiers: modifier || [], fromX: input.fromX, fromY: input.fromY, toX: input.toX, toY: input.toY, durationMs: input.durationMs ?? 300 };
  }
  if (!coordinate(input.x) || !coordinate(input.y)) throw error('computer_input_invalid');
  if (action === 'scroll') {
    if (!['up', 'down', 'left', 'right'].includes(input.direction) || !Number.isFinite(input.amount ?? 3)
      || (input.amount ?? 3) <= 0 || (input.amount ?? 3) > 10000 || !['line', 'page', 'pixel'].includes(input.by ?? 'line')) throw error('computer_input_invalid');
    return { ...command, ...(normalized ? { normalized: true } : {}), x: input.x, y: input.y, direction: input.direction, amount: input.amount ?? 3, by: input.by ?? 'line' };
  }
  const count = action === 'doubleClick' ? 2 : input.count ?? 1;
  if (!integer(count, 1, 3)) throw error('computer_input_invalid');
  return { ...command, ...(normalized ? { normalized: true } : {}), action: 'click', x: input.x, y: input.y, button, count, modifiers: modifier || [] };
}

function createWindowsInput({ spawn = nodeSpawn, source = () => readFileSync(join(__dirname, 'computer-input-windows.cs'), 'utf8'), timeoutMs = 20000 } = {}) {
  let child, loading, current, buffer = '', sequence = 0, closed = false, poisoned = false, queue = Promise.resolve();
  let startup, exitPromise;
  // Background (posted) input: answered by the helper at once, apart from the one-at-a-time foreground lease.
  const posts = new Map();
  const windowQueues = new Map();
  function write(value) { child.stdin.write(`${JSON.stringify(value)}\n`); }
  function start() {
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      startup = { resolve, reject };
      let process;
      try {
        process = spawn(join(global.process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
          ['-NoProfile', '-NonInteractive', '-Command', bootstrap],
          { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...global.process.env, NEXTMUX_PARENT_PID: String(global.process.pid) } });
      } catch { reject(error('computer_input_unavailable')); return; }
      child = process; buffer = '';
      const timer = setTimeout(() => { startup?.reject(error('computer_input_unavailable')); process.stdin.end(); }, timeoutMs);
      timer.unref?.();
      let finishExit;
      exitPromise = new Promise(done => { finishExit = done; });
      const ended = () => {
        clearTimeout(timer);
        if (child !== process) return;
        child = undefined; loading = undefined;
        startup?.reject(error('computer_input_unavailable')); startup = undefined;
        const pending = current; current = undefined;
        // Recover a lease whose final key-up acknowledgement was lost. Do not
        // admit another foreground action until a fresh helper releases it.
        if (pending) pending.resolve({ ok: false, error: 'computer_input_helper_exited', recover: pending.held });
        for (const post of posts.values()) post({ ok: false, error: 'computer_input_helper_exited' });
        posts.clear();
        finishExit();
      };
      // close follows stdout drain; exit may precede the final held-key journal.
      process.once('close', ended); process.once('error', ended);
      process.stdin.on('error', () => { process.stdin.end(); });
      process.stderr.on('data', () => {}); // Native errors are stable codes; never expose app text.
      process.stdout.on('data', chunk => {
        buffer += chunk.toString('utf8');
        if (buffer.length > 65536) { process.stdin.end(); return; }
        for (let index; (index = buffer.indexOf('\n')) >= 0;) {
          const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
          let message;
          try { message = JSON.parse(line); } catch { process.stdin.end(); return; }
          if (!message || typeof message !== 'object' || Array.isArray(message)) { process.stdin.end(); return; }
          if (message.ready === true) { clearTimeout(timer); startup?.resolve(); startup = undefined; continue; }
          const post = posts.get(message.id);
          if (post) { if (Array.isArray(message.held)) continue; posts.delete(message.id); post(message); continue; }
          if (!current || message.id !== current.id) continue;
          if (Array.isArray(message.held)) { current.held = message.held; continue; }
          const pending = current; current = undefined;
          pending.resolve({ ...message, ...(!message.ok && pending.held?.length ? { recover: pending.held } : {}) });
        }
      });
      process.stdin.write(`${Buffer.from(source(), 'utf8').toString('base64')}\n`);
    });
    return loading.catch(failure => {
      // A synchronous spawn failure has no close event to clear the startup
      // promise. Permit a later request to retry after that transient failure.
      if (!child) { loading = undefined; startup = undefined; }
      throw failure;
    });
  }
  async function dispatch(command, signal) {
    signal?.throwIfAborted();
    await start();
    signal?.throwIfAborted();
    // dispose() may have begun while PowerShell compiled the helper. Recovery
    // releases still run, but no new foreground input may start after shutdown.
    if (closed && command.action !== 'release') throw error('computer_host_closed');
    const id = ++sequence;
    let drainTimer;
    const cancel = () => {
      if (current?.id !== id || !child) return;
      try { write({ action: 'cancel', id }); } catch { /* the exit handler recovers the journal */ }
      drainTimer ??= setTimeout(() => { if (current?.id === id) child?.kill(); }, 2000);
    };
    const result = new Promise(resolve => { current = { id, resolve, held: command.releases || [] }; });
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, timeoutMs); timer.unref?.();
    let response;
    try { write({ ...command, id }); response = await result; }
    finally { clearTimeout(timer); clearTimeout(drainTimer); signal?.removeEventListener('abort', cancel); }
    if (response.recover?.length) {
      // One bounded recovery attempt. Failure poisons this instance so another
      // request cannot silently proceed with potentially held keys/buttons.
      if (command.action === 'release') { poisoned = true; throw error('computer_input_cleanup_failed'); }
      try { await dispatch({ action: 'release', releases: response.recover }); }
      catch { poisoned = true; throw error('computer_input_cleanup_failed'); }
    }
    if (!response.ok) {
      if (response.error === 'computer_input_cleanup_failed') poisoned = true;
      throw error(/^[a-z_]+$/.test(response.error || '') ? response.error : 'computer_input_failed');
    }
    return { effect: 'dispatched' };
  }
  return {
    execute() {
      // New actions have no global keyboard/mouse dispatch. Internal held-key
      // release recovery calls dispatch directly and remains bounded.
      return Promise.reject(error('background_unsupported'));
    },
    /**
     * Background input into one window: clicks, scrolls, text and single keys posted to the control under the point,
     * without the foreground, the cursor or the keyboard state. Many windows at once; nothing waits for a running
     * foreground gesture. Rejects with background_unsupported where only global input works; no fallback is permitted.
     */
    post(input) {
      const key = `${input?.pid}:${input?.windowId}`;
      const run = (windowQueues.get(key) || Promise.resolve()).then(() => this.postNow(input));
      const tail = run.catch(() => undefined).finally(() => { if (windowQueues.get(key) === tail) windowQueues.delete(key); });
      windowQueues.set(key, tail);
      return run;
    },
    async postNow(input) {
      const kind = input?.kind;
      const fraction = value => Number.isFinite(value) && value >= 0 && value <= 1;
      if (!Number.isSafeInteger(input?.pid) || input.pid <= 0 || !Number.isSafeInteger(input?.windowId) || input.windowId <= 0) throw error('computer_window_required');
      let command;
      if (kind === 'click' || kind === 'doubleClick' || kind === 'move') {
        if (!fraction(input.x) || !fraction(input.y) || (input.button !== undefined && !['left', 'right'].includes(input.button))) throw error('computer_input_invalid');
        command = { kind, x: input.x, y: input.y, ...(kind === 'move' ? {} : { button: input.button ?? 'left' }) };
      } else if (kind === 'drag') {
        const durationMs = input.durationMs ?? 300;
        if (!fraction(input.from?.x) || !fraction(input.from?.y) || !fraction(input.to?.x) || !fraction(input.to?.y)
          || !integer(durationMs, 50, 2000) || (input.button !== undefined && input.button !== 'left')) throw error('computer_input_invalid');
        command = { kind, fromX: input.from.x, fromY: input.from.y, toX: input.to.x, toY: input.to.y, durationMs, button: 'left' };
      } else if (kind === 'scroll') {
        if (!fraction(input.x) || !fraction(input.y) || !['up', 'down', 'left', 'right'].includes(input.direction)) throw error('computer_input_invalid');
        command = { kind, x: input.x, y: input.y, direction: input.direction, amount: Math.max(1, Math.min(10, Math.round(Number(input.amount) || 3))) };
      } else if (kind === 'text') {
        if (typeof input.text !== 'string' || !input.text.length || input.text.length > 16000) throw error('computer_input_invalid');
        command = { kind, text: input.text };
      } else if (kind === 'key') {
        const hasKeys = Array.isArray(input.keys) && input.keys.length > 0 && input.keys.length <= 4 && input.keys.every(keyName);
        const hasKey = keyName(input.key);
        if ((!hasKey && !hasKeys) || (input.keys !== undefined && !hasKeys) || !modifiers(input.modifiers)
          || !integer(input.holdMs ?? 0, 0, 3000)) throw error('computer_input_invalid');
        command = { kind, ...(hasKeys ? { keys: [...input.keys] } : { key: input.key }), modifiers: input.modifiers || [],
          ...(input.holdMs > 0 ? { holdMs: input.holdMs } : {}) };
      } else throw error('computer_input_invalid');
      input.signal?.throwIfAborted();
      if (closed) throw error('computer_host_closed');
      if (poisoned) throw error('computer_input_cleanup_failed');
      await start();
      input.signal?.throwIfAborted();
      if (closed) throw error('computer_host_closed');
      const id = ++sequence;
      const waitLimit = Math.min(timeoutMs, 5000 + (command.holdMs || command.durationMs || 0));
      let cancelled = false, timedOut = false, drainTimer;
      const cancel = () => {
        if (!posts.has(id) || cancelled) return;
        cancelled = true;
        drainTimer = setTimeout(() => {
          // An unresponsive helper cannot accept another request. EOF gives finally a chance to drain.
          const settle = posts.get(id); posts.delete(id); poisoned = true;
          child?.stdin.end(); settle?.({ ok: false, error: 'computer_input_cleanup_failed' });
        }, 2000);
        try { write({ action: 'cancel', id }); } catch { child?.stdin.end(); }
      };
      const reply = await new Promise(resolve => {
        // A cancellation is complete only after the native finally path posts every up.
        const timer = setTimeout(() => { timedOut = true; cancel(); }, waitLimit);
        timer.unref?.();
        posts.set(id, message => { clearTimeout(timer); clearTimeout(drainTimer); input.signal?.removeEventListener('abort', cancel); resolve(message); });
        input.signal?.addEventListener('abort', cancel, { once: true });
        try { write({ action: 'post', id, pid: input.pid, windowId: input.windowId, ...command }); }
        catch { posts.get(id)?.({ ok: false, error: 'computer_input_helper_exited' }); posts.delete(id); }
      });
      if (reply.error === 'computer_input_cleanup_failed') { poisoned = true; child?.stdin.end(); }
      if (timedOut) throw error('computer_input_timeout');
      input.signal?.throwIfAborted();
      if (!reply.ok) throw error(/^[a-z_]+$/.test(reply.error || '') ? reply.error : 'computer_input_failed');
      return { effect: 'dispatched', delivery: 'background' };
    },
    async dispose() {
      closed = true;
      if (current && child) write({ action: 'cancel', id: current.id });
      for (const id of posts.keys()) { try { write({ action: 'cancel', id }); } catch {} }
      await queue;
      if (child) { const process = child; process.stdin.end(); const timer = setTimeout(() => process.kill(), 5000); try { await exitPromise; } finally { clearTimeout(timer); } }
    }
  };
}

module.exports = { createWindowsInput, commandFor, MARKER };
