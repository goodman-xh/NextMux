#!/usr/bin/env node

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeLaunchPlan, requestQuit, bounded, attachCloseObserver } from './desktop-close-persistence-e2e.mjs';
import { freePort, launchOwnedE2eProcess, terminateTree, waitForPort } from './desktop-attachment-file-e2e-harness.mjs';
import { assertDisposableDesktopE2E } from './desktop-e2e-state.mjs';
import { ensureExactOfficialQaRoute, officialQaRouteConfig } from './desktop-official-qa-route.mjs';
import { finishE2eRun, installE2eSignalCleanup } from './desktop-terminal-ci-e2e.mjs';
import { hideFixtureAttachment, readAttachmentOwnerSession, verifiedFixtureAttachment } from './desktop-attachment-owner-files.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pause = ms => new Promise(done => setTimeout(done, ms));
const desktopRequire = createRequire(join(root, 'apps/desktop/package.json'));
const coreRequire = createRequire(desktopRequire.resolve('@theia/core/lib/common/message-rpc/rpc-message-encoder'));

async function waitFor(read, predicate, label, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await bounded(Promise.resolve().then(read), 5000, label);
    if (predicate(value)) return value;
    await pause(100);
  }
  throw new Error(`ATTACHMENT_OWNER_TIMEOUT: ${label}`); // Never dump body/RPC/credential state.
}

async function click(client, selector) {
  assert.equal(await client.evaluate(`(() => {
    const button = document.querySelector(${JSON.stringify(selector)});
    if (!button || button.disabled || document.body.inert) return false;
    button.scrollIntoView({ block: 'center' }); button.click(); return true;
  })()`), true, `Unavailable isolated control: ${selector}`);
}

async function view(client) {
  return client.evaluate(`(() => {
    let mirror = {}, restore = {};
    try { mirror = JSON.parse(localStorage.getItem('nextmux.desktop.codingSessions.v1') || '{}'); } catch {}
    try { restore = JSON.parse(localStorage.getItem('nextmux.desktop.restoreState.v1') || '{}'); } catch {}
    const id = document.querySelector('.nmx-session-row.is-current')?.getAttribute('data-session-id') || restore.activeCodingSessionId || '';
    return { id, sessions: (mirror.sessions || []).map(item => ({ id: item.id, draft: item.draftPrompt || '' })),
      prompt: document.querySelector('.nmx-composer textarea')?.value || '',
      ordinary: [...document.querySelectorAll('.nmx-attachment-chips:not(.nmx-unresolved-attachments) .nmx-attachment-label b')].map(node => node.textContent),
      pasted: document.querySelectorAll('.nmx-pasted-text-chip').length,
      unresolved: document.querySelectorAll('.nmx-unresolved-attachments .is-unsupported').length,
      error: Boolean(document.querySelector('.nmx-attachment-error')),
      disabled: Boolean(document.querySelector('.nmx-send-button')?.disabled),
      running: Boolean(document.querySelector('.nmx-send-button.is-stop')) };
  })()`);
}

async function insert(client, text) {
  await client.evaluate(`document.querySelector('.nmx-composer textarea:not(:disabled)')?.focus()`);
  await client.call('Input.insertText', { text });
}

async function selectSession(client, id) {
  await client.evaluate(`document.querySelectorAll('.nmx-project-row[aria-expanded="false"]').forEach(node => node.click())`);
  await waitFor(() => client.evaluate(`Boolean(document.querySelector('.nmx-session-row[data-session-id="${id}"] .nmx-session-open'))`), Boolean, 'owner row');
  await click(client, `.nmx-session-row[data-session-id="${id}"] .nmx-session-open`);
  await waitFor(() => view(client), value => value.id === id, 'exact owner session');
}

export async function gateBundle(key) {
  // Reuse the installed MIT msgpackr 1.12.1 decoder, not a second protocol parser.
  const unpack = join(dirname(dirname(coreRequire.resolve('msgpackr/unpack'))), 'unpack.js');
  const { build } = desktopRequire('esbuild');
  const result = await build({ stdin: { contents: `import { unpack } from ${JSON.stringify(unpack)};
    import { installAttachmentCacheGate } from './scripts/desktop-attachment-owner-gate.mjs';
    if (globalThis[${JSON.stringify(key)}]) throw new Error('ATTACHMENT_GATE_ALREADY_INSTALLED');
    globalThis[${JSON.stringify(key)}] = { arm(expected) { this.gate?.dispose();
      this.gate = installAttachmentCacheGate({ socketClass: WebSocket, unpack, expected }); },
      status() { return this.gate?.status(); }, release() { this.gate?.release(); },
      dispose() { this.gate?.dispose(); delete globalThis[${JSON.stringify(key)}]; } };`,
    resolveDir: root, sourcefile: 'isolated-attachment-gate.mjs' }, bundle: true, platform: 'browser',
    format: 'iife', minify: true, write: false, logLevel: 'silent' });
  return result.outputFiles[0].text;
}

export async function runAttachmentOwnerE2E(environment = process.env) {
  closeLaunchPlan(environment, resolve(tmpdir(), 'attachment-owner-check'), resolve(tmpdir(), 'attachment-owner-check/workspace'), 1);
  const profile = await mkdtemp(join(tmpdir(), 'nextmux-attachment-owner-'));
  const state = join(profile, 'nextmux-state'), workspace = join(profile, 'workspace'), logs = join(profile, 'logs');
  await Promise.all([state, workspace, logs, join(profile, 'electron-user-data'), join(profile, 'theia-config')]
    .map(path => mkdir(path, { recursive: true })));
  const qaPort = await freePort(), endpoint = `http://127.0.0.1:${qaPort}`;
  const env = { ...environment, NEXTMUX_ALLOW_INSECURE_OFFICIAL: '1', NEXTMUX_PLATFORM_API_URL: endpoint,
    NEXTMUX_PUBLIC_APP_URL: endpoint, NEXTMUX_OFFICIAL_QA_PORT: String(qaPort), NEXTMUX_DESKTOP_STATE_DIR: state,
    NEXTMUX_AGENT_STATE_DIR: state, NEXTMUX_DESKTOP_E2E_ISOLATED: '1', NEXTMUX_DESKTOP_E2E_PROFILE_DIR: profile,
    NEXTMUX_E2E_WORKSPACE: workspace, THEIA_CONFIG_DIR: join(profile, 'theia-config'),
    ...(process.platform === 'win32' ? { LOCALAPPDATA: join(profile, 'local-app-data'), APPDATA: join(profile, 'roaming-app-data') }
      : { XDG_DATA_HOME: join(profile, 'xdg-data'), XDG_CONFIG_HOME: join(profile, 'xdg-config') }) };
  assertDisposableDesktopE2E(env);
  const children = [], clients = [], gates = [], restores = [];
  let primaryError, stopping = false, cleanupPromise;
  const cleanup = () => {
    stopping = true;
    return cleanupPromise ||= (async () => {
      const failures = [];
      for (const restore of restores.reverse()) try { await restore(); } catch (error) { failures.push(error); }
      for (const { client, key } of gates) try { await client.evaluate(`globalThis[${JSON.stringify(key)}]?.dispose()`); } catch { /* Closed owned renderer has no remaining wrapper. */ }
      for (const client of clients) try { client.socket.close(); } catch { /* already closed */ }
      for (const child of [...children].reverse()) try { await terminateTree(child); } catch (error) { failures.push(error); }
      if (failures.length) throw new AggregateError(failures, 'Attachment owner cleanup failed');
    })();
  };
  const disposeSignals = installE2eSignalCleanup(cleanup);
  const report = { profile, executable: environment.NEXTMUX_PACKAGED_EXECUTABLE, platform: process.platform, arch: process.arch,
    syntheticOnly: true, transportDelayOnly: true, lateOwners: [], missingCache: [] };
  process.stdout.write(`${JSON.stringify({ event: 'attachment_owner_profile', profile, logs })}\n`);
  try {
    const qa = launchOwnedE2eProcess(process.execPath, [join(root, 'scripts/official-model-qa-server.mjs')], {
      env: { ...env, NEXTMUX_OFFICIAL_QA_DELAY_MS: '30' }, stdout: join(logs, 'qa.stdout.log'), stderr: join(logs, 'qa.stderr.log') });
    children.push(qa); await waitForPort(qaPort, 15000, qa);
    const modelRequests = async () => (await readFile(join(logs, 'qa.stdout.log'), 'utf8')).split('\n').filter(line => {
      try { const item = JSON.parse(line); return item.event === 'qa_request' && item.phase === 'started' && item.method === 'POST' && item.route === '/v1/chat/completions'; } catch { return false; }
    }).length;
    async function launch(round) {
      if (stopping) throw new Error('ATTACHMENT_OWNER_STOPPING');
      const port = await freePort(), plan = closeLaunchPlan(env, profile, workspace, port);
      const child = launchOwnedE2eProcess(plan.command, plan.args, { env, stdout: join(logs, `app-${round}.stdout.log`), stderr: join(logs, `app-${round}.stderr.log`) });
      children.push(child); await waitForPort(port, 90000, child);
      const client = await attachCloseObserver(port, { child, executable: plan.command }); clients.push(client);
      return { child, client };
    }
    const first = await launch(1), client = first.client;
    await ensureExactOfficialQaRoute({ evaluate: client.evaluate, environment: env, config: officialQaRouteConfig(env) });
    const stamp = Date.now(), marker = `NM_LONG_PASTE_E2E_REQUEST_${stamp}`, other = `B_UNCHANGED_${randomUUID()}`;
    const text = Buffer.from(`ORDINARY_ATTACHMENT_${randomUUID()}\n`), name = `owner-${randomUUID()}.txt`;
    const long = Buffer.from(`NM_LONG_PASTE_E2E_BODY_${stamp}\n${'bounded synthetic owner content '.repeat(700)}`);
    await insert(client, `${marker} keep both draft attachments`);
    const a = (await waitFor(() => view(client), value => value.id && value.prompt.includes(marker), 'owner A created')).id;
    await waitFor(() => readAttachmentOwnerSession(state, a), value => value?.draftPrompt?.includes(marker), 'owner A durable seed');
    const key = `__nmxAttachmentOwner_${randomUUID().replaceAll('-', '_')}`;
    await client.evaluate(await gateBundle(key)); gates.push({ client, key });
    let b;
    for (const [kind, bytes] of [['ordinary', text], ['pasted', long]]) {
      await client.evaluate(`globalThis[${JSON.stringify(key)}].arm(${JSON.stringify({ conversationId: a, dataBase64: bytes.toString('base64'), ...(kind === 'ordinary' ? { name } : {}) })})`);
      await client.evaluate(`(() => {
        const transfer = new DataTransfer();
        ${kind === 'ordinary' ? `transfer.items.add(new File([Uint8Array.from(atob(${JSON.stringify(bytes.toString('base64'))}), c => c.charCodeAt(0))], ${JSON.stringify(name)}, { type: 'text/plain' }));`
          : `transfer.setData('text/plain', ${JSON.stringify(bytes.toString('utf8'))});`}
        const target = document.querySelector(${JSON.stringify(kind === 'ordinary' ? '.nmx-composer-wrap' : '.nmx-composer textarea')});
        if (!target) throw new Error('ATTACHMENT_OWNER_COMPOSER_MISSING');
        if (target instanceof HTMLTextAreaElement) { target.focus(); target.setSelectionRange(target.value.length, target.value.length); }
        const event = new Event(${JSON.stringify(kind === 'ordinary' ? 'drop' : 'paste')}, { bubbles: true, cancelable: true });
        Object.defineProperty(event, ${JSON.stringify(kind === 'ordinary' ? 'dataTransfer' : 'clipboardData')}, { value: transfer });
        target.dispatchEvent(event); return true;
      })()`);
      await waitFor(() => client.evaluate(`globalThis[${JSON.stringify(key)}].status()`), value => value.held === 1, 'exact cache request withheld', 6000);
      if (!b) {
        await click(client, '.nmx-context-actions button:first-child'); await insert(client, other);
        b = (await waitFor(() => view(client), value => value.id && value.id !== a && value.prompt === other, 'owner B created')).id;
      } else await selectSession(client, b);
      await client.evaluate(`globalThis[${JSON.stringify(key)}].release()`);
      await waitFor(() => readAttachmentOwnerSession(state, a), value => kind === 'ordinary' ? value?.draftAttachments?.some(item => item.name === name)
        : JSON.parse(value?.draftPastedTextReferences || '[]').length === 1, 'late cache persisted only to A');
      const current = await view(client), status = await client.evaluate(`globalThis[${JSON.stringify(key)}].status()`);
      assert.equal(current.id, b); assert.equal(current.prompt, other); assert.equal(current.ordinary.length, 0); assert.equal(current.pasted, 0);
      assert.deepEqual(status, { held: 1, released: 1, extraMatches: 0, expired: false, sendFailed: false });
      await selectSession(client, a);
      await waitFor(() => view(client), value => value.ordinary.includes(name) && (kind !== 'pasted' || value.pasted === 1), 'A retains its attachment');
      report.lateOwners.push({ kind, originalOwnerRetained: true, otherOwnerUnchanged: true, ...status });
      console.log(JSON.stringify({ event: 'attachment_owner_late_result', ...report.lateOwners.at(-1) }));
    }
    await client.evaluate(`globalThis[${JSON.stringify(key)}].dispose()`);
    const saved = await readAttachmentOwnerSession(state, a), pasted = JSON.parse(saved.draftPastedTextReferences)[0];
    const ordinary = saved.draftAttachments.find(item => item.name === name);
    assert.equal(JSON.stringify(saved).includes(long.toString('utf8')), false, 'Long paste body must live in its real cache file, not the history manifest');
    await verifiedFixtureAttachment(profile, ordinary, text); await verifiedFixtureAttachment(profile, pasted.attachment, long);
    await requestQuit(client, process.platform);
    await waitFor(() => ({ code: first.child.exitCode, signal: first.child.signalCode }), value => value.code !== null || value.signal !== null, 'natural first exit');
    assert.equal(first.child.exitCode, 0); assert.equal(first.child.signalCode, null);
    // Reap only this observed app's detached descendants after proving natural
    // exit; no previous backend may keep writing the profile during restart.
    await terminateTree(first.child);
    const second = await launch(2), resumed = second.client;
    await selectSession(resumed, a);
    await waitFor(() => view(resumed), value => value.ordinary.includes(name) && value.pasted === 1, 'draft attachments restored after full quit');
    const restored = await readAttachmentOwnerSession(state, a);
    assert.equal(restored.draftAttachments[0].uri, ordinary.uri);
    assert.equal(JSON.parse(restored.draftPastedTextReferences)[0].attachment.uri, pasted.attachment.uri);
    report.restart = { normalExit: true, originalIdsAndUrisRetained: true,
      ordinary: await verifiedFixtureAttachment(profile, ordinary, text), pasted: await verifiedFixtureAttachment(profile, pasted.attachment, long) };
    console.log(JSON.stringify({ event: 'attachment_owner_restart_result', ...report.restart }));
    for (const [kind, reference, bytes] of [['ordinary', ordinary, text], ['pasted', pasted.attachment, long]]) {
      await selectSession(resumed, b);
      const restore = await hideFixtureAttachment(profile, reference, bytes); restores.push(restore);
      await selectSession(resumed, a);
      const before = await modelRequests();
      if (kind === 'ordinary') await waitFor(() => view(resumed), value => value.unresolved === 1 && value.disabled, 'missing ordinary cache blocks send');
      else {
        // Selecting the owner updates its ID before async ordinary-file restore
        // finishes. Wait for actual composer readiness, not just sidebar state.
        await waitFor(() => view(resumed), value => value.ordinary.includes(name) && value.pasted === 1
          && !value.disabled && !value.error && !value.unresolved, 'ordinary restored before testing missing paste');
        await click(resumed, '.nmx-send-button:not(:disabled)');
      }
      await waitFor(() => view(resumed), value => !value.running && (value.error || value.unresolved > 0), 'missing cache visible failure');
      await pause(1500);
      assert.equal(await modelRequests(), before, 'Missing attachment must not silently send a reduced prompt');
      const owner = await readAttachmentOwnerSession(state, a);
      assert.equal(owner.turns.length, 0); assert.ok(owner.draftPrompt.includes(marker));
      await restore();
      await selectSession(resumed, b); await selectSession(resumed, a);
      await waitFor(() => view(resumed), value => value.ordinary.includes(name) && value.pasted === 1 && !value.unresolved, 'recovered fixture draft');
      report.missingCache.push({ kind, visibleFailure: true, modelRequestsUnchanged: true, sourceRestored: true });
      console.log(JSON.stringify({ event: 'attachment_owner_missing_result', ...report.missingCache.at(-1) }));
    }
    await requestQuit(resumed, process.platform);
    await waitFor(() => second.child.exitCode, value => value !== null, 'natural final exit');
    assert.equal(second.child.exitCode, 0); assert.equal(second.child.signalCode, null);
    report.pass = true;
    await writeFile(join(logs, 'result.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
    console.log(JSON.stringify(report, null, 2));
  } catch (error) { primaryError = error; }
  finally {
    try { await finishE2eRun(cleanup, primaryError); } finally { disposeSignals(); }
    console.log(`Preserved attachment-owner profile: ${profile}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runAttachmentOwnerE2E();
