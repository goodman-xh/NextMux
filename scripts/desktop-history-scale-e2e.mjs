#!/usr/bin/env node
// VS Code's Lists-And-Trees benchmark exercises population, filtering and
// collapse. Exercise the real NextMux renderer and durable store, not a DOM mock.
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { platform, arch, release } from 'node:os';
import { ConversationStore } from '../packages/theia-nextmux-extension/lib/node/nextmux-conversation-store.js';
import { runInDisposableAttachmentFileDesktop, connectToNextMuxWorkbench } from './desktop-attachment-file-e2e-harness.mjs';
import { reloadDesktopDocument } from './desktop-cdp-reload.mjs';

if (await runInDisposableAttachmentFileDesktop(import.meta.url, { label: 'large history renderer' })) process.exit(0);
const profile = process.env.NEXTMUX_DESKTOP_E2E_PROFILE_DIR;
const state = process.env.NEXTMUX_DESKTOP_STATE_DIR;
assert.ok(process.env.NEXTMUX_DESKTOP_E2E_ISOLATED === '1' && profile && state && relative(profile, state) === 'nextmux-state', 'Only a disposable E2E profile may be seeded');
const count = Number(process.env.NEXTMUX_HISTORY_SCALE_COUNT || 10_000);
assert.ok([10_000, 50_000].includes(count), 'Use 10000 or 50000 conversations');
const workspace = resolve(process.cwd());
const store = new ConversationStore(join(state, 'conversation-history-v1'));
const client = await connectToNextMuxWorkbench(process.env.NEXTMUX_CDP_PORT);
const { evaluate, call } = client;
const delay = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));
const id = i => `scale-ui-${String(i).padStart(6, '0')}`;
const marker = i => `SCALE_BODY_${String(i).padStart(6, '0')}`;
const row = i => `.nmx-session-row[data-session-id="${id(i)}"]`;
const results = [];
const report = { version: 1, measuredAt: new Date().toISOString(), host: { platform: platform(), arch: arch(), release: release() }, conversations: count, actualJsonBodies: true, isolated: true, providerRequests: 0, results };
async function waitFor(probe, predicate, label, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  let value, lastError;
  while (Date.now() < deadline) {
    try { value = await probe(); if (predicate(value)) return value; lastError = undefined; }
    catch (error) { lastError = String(error.message); }
    await delay(100);
  }
  throw new Error(`Timed out: ${label}; ${JSON.stringify(value)}; ${lastError || ''}`);
}
async function metrics() {
  const values = Object.fromEntries((await call('Performance.getMetrics')).metrics.map(item => [item.name, item.value]));
  return { cpu: values.TaskDuration, script: values.ScriptDuration, layout: values.LayoutDuration, heap: values.JSHeapUsedSize, nodes: values.Nodes };
}
async function measure(name, action) {
  const before = await metrics(), started = performance.now();
  await action();
  const after = await metrics();
  const sample = { name, wallMs: Math.round(performance.now() - started), rendererTaskCpuMs: Math.round(Math.max(0, after.cpu - before.cpu) * 1000), rendererScriptCpuMs: Math.round(Math.max(0, after.script - before.script) * 1000), rendererLayoutCpuMs: Math.round(Math.max(0, after.layout - before.layout) * 1000), jsHeapUsedBytes: after.heap, domNodes: after.nodes, sessionRows: await evaluate(`document.querySelectorAll('.nmx-session-row').length`) };
  results.push(sample);
  console.log(JSON.stringify(sample));
}
async function click(selector) {
  await waitFor(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), Boolean, selector);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
}
async function clickButtonWithText(selector, label) {
  const expression = `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(button => button.textContent.trim() === ${JSON.stringify(label)})`;
  await waitFor(() => evaluate(`Boolean(${expression})`), Boolean, `${label} button`);
  await evaluate(`${expression}.click()`);
}
async function searchForOldest() {
  if (!await evaluate(`!!document.querySelector('.nmx-sidebar-search input')`)) await click('.nmx-context-heading > div > button:first-child');
  await waitFor(() => evaluate(`!!document.querySelector('.nmx-sidebar-search input')`), Boolean, 'search input');
  await evaluate(`(() => { const input = document.querySelector('.nmx-sidebar-search input'); input.focus(); input.select(); })()`);
  await call('Input.insertText', { text: marker(0) });
  await waitFor(() => evaluate(`!!document.querySelector(${JSON.stringify(row(0))})`), Boolean, 'oldest indexed message');
}
try {
  assert.equal((await store.list()).total, 0, 'Seed requires empty disposable history');
  const now = Date.now() - count * 1000;
  const sessions = Array.from({ length: count }, (_, i) => ({
    id: id(i), workspacePath: workspace, title: `Scale conversation ${i}`, createdAt: now + i * 1000, updatedAt: now + i * 1000,
    browsers: [], pinned: false, permissionMode: 'full_access', reasoningEffort: 'medium', routeId: '', relayKey: '', modelId: '', followUpQueue: [], draftPrompt: '',
    turns: [{ id: `turn-${id(i)}`, prompt: marker(i), response: `Saved answer ${i}`, stage: 'complete', createdAt: now + i * 1000, completedAt: now + i * 1000, permissionMode: 'full_access', routeLabel: '', error: '' }],
  }));
  const seedCpu = process.cpuUsage(), seedStart = performance.now();
  await store.save(sessions);
  report.seed = { wallMs: Math.round(performance.now() - seedStart), cpuMicros: process.cpuUsage(seedCpu), peakRssKiB: process.resourceUsage().maxRSS };
  assert.equal((await store.list({ workspacePath: workspace })).total, count);
  console.log(JSON.stringify({ event: 'seeded', count, ...report.seed }));
  await evaluate(`(() => { localStorage.removeItem('nextmux.desktop.codingSessions.v1'); localStorage.setItem('nextmux.desktop.restoreState.v1', JSON.stringify({version:1,section:'coding',workspace:${JSON.stringify(workspace)},codingPanel:'thread',activeCodingSessionId:${JSON.stringify(id(count - 1))},newConversation:false,settingsPanel:'profile',billingTab:'usage',modelCenterView:'all',modelCapabilityFilter:'all',comicView:'storyboard'})); })()`);
  await call('Performance.enable', { timeDomain: 'threadTicks' });
  await measure('openProject', async () => {
    await reloadDesktopDocument({ ...client, ignoreCache: true });
    await waitFor(() => evaluate(`!!document.querySelector(${JSON.stringify(row(count - 1))})`), Boolean, 'newest session');
    await click(`${row(count - 1)} .nmx-session-open`);
    await waitFor(() => evaluate(`document.querySelector('.nmx-thread')?.innerText || document.querySelector('.nmx-coding-stage')?.innerText || ''`), text => text.includes(marker(count - 1)), 'newest body');
  });
  const projectSelector = `.nmx-project-row[data-project-path=${JSON.stringify(workspace)}]`;
  await measure('expandPage', async () => {
    await evaluate(`(() => { const p = document.querySelector(${JSON.stringify(projectSelector)}); if (p?.getAttribute('aria-expanded') !== 'true') p?.click(); })()`);
    const more = `${projectSelector}`;
    await evaluate(`document.querySelector(${JSON.stringify(more)})?.closest('.nmx-project-tree')?.querySelector('.nmx-project-conversation-toggle')?.click()`);
    await waitFor(() => evaluate(`!!document.querySelector('.nmx-session-virtual-list .nmx-session-row')`), Boolean, 'virtual page');
    assert.ok(await evaluate(`document.querySelectorAll('.nmx-session-row').length < 100`), 'Only viewport rows should mount');
  });
  await measure('searchOldest', searchForOldest);
  await measure('openOldest', async () => {
    await click(`${row(0)} .nmx-session-open`);
    await waitFor(() => evaluate(`document.querySelector('.nmx-coding-stage')?.innerText || ''`), text => text.includes(marker(0)), 'oldest body loaded');
  });
  // Opening a search result exits search without reordering the project. Find
  // it again before using its row menu; the old row can be outside the viewport.
  await searchForOldest();
  await measure('renameOldest', async () => {
    await click(`${row(0)} .nmx-session-more`);
    await clickButtonWithText(`${row(0)} .nmx-session-menu button`, '重命名');
    await waitFor(() => evaluate(`!!document.querySelector('.nmx-thread-dialog input')`), Boolean, 'rename dialog');
    await evaluate(`(() => { const input = document.querySelector('.nmx-thread-dialog input'); input.focus(); input.select(); })()`);
    await call('Input.insertText', { text: 'Scale renamed oldest' });
    await click('.nmx-thread-dialog footer .is-primary');
    await waitFor(() => store.readSession(id(0)), session => session?.title === 'Scale renamed oldest', 'rename saved');
  });
  await measure('manualSort', async () => {
    if (await evaluate(`!!document.querySelector('.nmx-sidebar-search > button')`)) await click('.nmx-sidebar-search > button');
    await waitFor(() => evaluate(`document.querySelectorAll('.nmx-session-row').length`), n => n >= 2, 'normal list');
    const firstTwo = await evaluate(`Array.from(document.querySelectorAll('.nmx-session-row')).slice(0,2).map(row => row.dataset.sessionId)`);
    await evaluate(`(() => { const [a,b] = ${JSON.stringify(firstTwo)}.map(id => document.querySelector('[data-session-id="'+id+'"]')); const dataTransfer = new DataTransfer(); b.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer})); a.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer})); b.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer})); })()`);
    await waitFor(() => evaluate(`document.querySelector('.nmx-session-row')?.dataset.sessionId`), value => value === firstTwo[1], 'manual order applied');
  });
  await searchForOldest();
  await measure('deleteOldest', async () => {
    await click(`${row(0)} .nmx-session-more`);
    await click(`${row(0)} .nmx-session-menu .is-danger`);
    await click('.nmx-thread-dialog footer .is-danger');
    await waitFor(() => store.list({ workspacePath: workspace, limit: 1 }), page => page.total === count - 1, 'durable deletion');
    assert.equal((await store.search({ query: marker(0) })).matches.length, 0, 'Deleted body must leave search index');
  });
  report.ok = true;
  report.limitations = ['Development build on the recorded host', 'Renderer CPU/JS heap are not whole-app CPU/RSS', 'No paid provider or D1 traffic is exercised'];
} catch (error) {
  report.ok = false; report.error = String(error.stack || error);
  try { report.ui = await evaluate(`({text:document.querySelector('.nmx-coding-context')?.innerText?.slice(0,1500),errors:document.querySelector('.nmx-history-error')?.innerText})`); } catch {}
  throw error;
} finally {
  const output = resolve('docs/reports', `p1-renderer-${count}.json`);
  await mkdir(resolve('docs/reports'), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Renderer report: ${output}`);
  client.socket.close();
}
