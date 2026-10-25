import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, readdir, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  AGENT_RUN_JOURNAL_MAX_ENTRIES,
  AgentRunJournalError,
  AgentRunJournalStore,
  interruptedAgentRunSnapshot,
} from '../lib/node/nextmux-agent-run-journal.js';
import { AgentRunStateStore } from '../lib/node/nextmux-agent-run-state-store.js';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { autoResumeDecision } from '../lib/browser/nextmux-agent-activity.js';

class RecoveryProbeService extends NextMuxPlatformServiceImpl {
  constructor(root) {
    super();
    this.root = root;
  }

  nextmuxDataRoot() {
    return this.root;
  }

  agentCheckpointRoot() {
    return join(this.root, 'checkpoints');
  }

  recover(runId) {
    return this.recoveredAgentJobSnapshot(runId);
  }
}

class LifecycleProbeService extends RecoveryProbeService {
  constructor(root, waitForCancellation = false) {
    super(root);
    this.waitForCancellation = waitForCancellation;
  }

  executeAgentRun(_request, execution) {
    const result = status => ({
      runId: execution.runId,
      status,
      stopReason: status === 'cancelled' ? 'cancel_requested' : 'completed',
      finalText: status === 'cancelled' ? 'cancelled' : 'done',
      events: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      turns: 0,
      toolCalls: 0,
      developmentOnly: false,
      billing: { kind: 'provider_direct', chargedMicros: 0, requestCount: 0 },
      failoverCount: 0,
      changes: [],
      route: { kind: 'official_connection', routeId: 'official:test', providerName: 'test', modelFamily: 'test', model: 'test' },
    });
    if (!this.waitForCancellation) return Promise.resolve(result('completed'));
    return new Promise(resolve => {
      if (execution.signal.aborted) resolve(result('cancelled'));
      else execution.signal.addEventListener('abort', () => resolve(result('cancelled')), { once: true });
    });
  }

  completion(runId) {
    return this.agentJobs.get(runId)?.completion;
  }

  closeConnection() {
    return this.disposeConnectionResources();
  }
}

function runRequest(root) {
  return {
    route: { kind: 'official_connection', connectionId: 'connection-test-001' },
    workbench: 'coding',
    prompt: 'test',
    workspaceRoot: root,
    conversationId: randomUUID(),
    permissionMode: 'workspace_write',
  };
}

function record(root, runId, overrides = {}) {
  return {
    schemaVersion: 1,
    runId,
    state: 'running',
    owner: { workspaceRoot: root, conversationId: 'conversation-journal-001', rootRunId: runId, depth: 0 },
    workbench: 'coding',
    permissionMode: 'workspace_write',
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

test('agent run journal atomically indexes one existing checkpoint without copying its contents', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-agent-journal-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, 'journal');
  const store = new AgentRunJournalStore(directory);
  const runId = 'agent-journal-root-001';
  await store.save(record(root, runId));
  await store.save(record(root, runId, {
    checkpointId: 'resume-00000000-0000-4000-8000-000000000001',
    updatedAt: 2_000,
  }));

  const loaded = await store.load(runId, { workspaceRoot: root, conversationId: 'conversation-journal-001' });
  assert.equal(loaded.checkpointId, 'resume-00000000-0000-4000-8000-000000000001');
  const files = await readdir(directory);
  assert.equal(files.filter(file => file.endsWith('.json')).length, 1);
  assert.equal(files.some(file => file.includes('.tmp-')), false);
  assert.equal((await readFile(join(directory, files[0]), 'utf8')).includes('messages'), false);
});

test('agent run journal replays compact activity after a restart without persisting process output', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-agent-journal-events-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, 'journal');
  const store = new AgentRunJournalStore(directory);
  const runId = 'agent-journal-events-001';
  await store.save(record(root, runId));
  await store.appendEvent(runId, { type: 'model_phase', turn: 1, phase: 'tool_calling', at: new Date().toISOString() });
  await store.appendEvent(runId, { type: 'assistant_delta', turn: 1, delta: 'Checking ', at: new Date().toISOString() });
  await store.appendEvent(runId, { type: 'assistant_delta', turn: 1, delta: 'README.md.', at: new Date().toISOString() });
  await store.appendEvent(runId, { type: 'tool_output', callId: 'call-events-001', toolName: 'read_file', source: 'builtin',
    stream: 'stdout', chunk: 'secret process output', sequence: 1, at: new Date().toISOString() });
  await store.appendEvent(runId, { type: 'tool_completed', callId: 'call-events-001', toolName: 'read_file', ok: true,
    status: 'succeeded', summary: { kind: 'workspace.read_file', params: { path: 'README.md', ignored: { nested: true } }, title: 'Read file', details: ['README.md'] }, durationMs: 5, at: new Date().toISOString() });
  await store.flushEvents(runId);
  const events = await store.loadEvents(runId);
  assert.deepEqual(events.map(event => event.type), ['model_phase', 'assistant_delta', 'tool_completed']);
  assert.equal(events[1].delta, 'Checking README.md.');
  assert.equal(events[2].summary.kind, 'workspace.read_file');
  assert.deepEqual(events[2].summary.params, { path: 'README.md' });
  assert.equal(JSON.stringify(events).includes('secret process output'), false);
  await store.remove(runId);
  assert.deepEqual(await store.loadEvents(runId), []);
});

test('assistant_delta prose is coalesced per turn, flushed at event/save boundaries, and split safely under 32 KiB without breaking surrogate pairs', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-agent-journal-deltas-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, 'journal');
  const store = new AgentRunJournalStore(directory);
  const runId = 'agent-journal-deltas-001';
  await store.save(record(root, runId));

  // Coalesce multiple deltas for turn 1 and flush before tool_started
  await store.appendEvent(runId, { type: 'assistant_delta', turn: 1, delta: 'First part ', at: '2026-03-30T00:00:01.000Z' });
  await store.appendEvent(runId, { type: 'assistant_delta', turn: 1, delta: 'second part.', at: '2026-03-30T00:00:02.000Z' });
  await store.appendEvent(runId, {
    type: 'tool_started',
    callId: 'call-delta-1',
    toolName: 'workspace.read_file',
    source: 'builtin',
    summary: { title: 'Read file' },
    at: '2026-03-30T00:00:03.000Z'
  });

  // Stream large multi-byte emoji prose (> 16 KiB UTF-8) in turn 2 and flush via save()
  const emojiStream = '😀'.repeat(6_000); // 24,000 UTF-8 bytes
  await store.appendEvent(runId, { type: 'assistant_delta', turn: 2, delta: emojiStream.slice(0, 6_001), at: '2026-03-30T00:00:04.000Z' });
  await store.appendEvent(runId, { type: 'assistant_delta', turn: 2, delta: emojiStream.slice(6_001), at: '2026-03-30T00:00:05.000Z' });
  await store.save(record(root, runId, { state: 'interrupted', updatedAt: 3_000 }));

  const restored = await new AgentRunJournalStore(directory).loadEvents(runId);
  assert.equal(restored[0].type, 'assistant_delta');
  assert.equal(restored[0].turn, 1);
  assert.equal(restored[0].delta, 'First part second part.');
  assert.equal(restored[1].type, 'tool_started');

  const turn2Deltas = restored.slice(2);
  assert.ok(turn2Deltas.length >= 2, '24 KiB UTF-8 prose splits into multiple <= 16 KiB chunks');
  for (const item of turn2Deltas) {
    assert.equal(item.type, 'assistant_delta');
    assert.equal(item.turn, 2);
    assert.ok(Buffer.byteLength(JSON.stringify(item), 'utf8') < 32 * 1024, 'serialized record stays well under 32 KiB');
    assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(item.delta), false, 'never splits surrogate pairs');
  }
  assert.equal(turn2Deltas.map(item => item.delta).join(''), emojiStream);
});

test('recovered file activities retain exact bounded paths and discard unknown resource data', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-agent-journal-file-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, 'journal'), store = new AgentRunJournalStore(directory), runId = 'agent-journal-file-001';
  await store.save(record(root, runId));
  const resource = { kind: 'file', path: `${root}/directory  with spaces/${'x'.repeat(600)}.txt `, action: 'read', startLine: 8, endLine: 12 };
  await store.appendEvent(runId, { type: 'tool_completed', callId: 'read-file-001', toolName: 'workspace.read_file', ok: true,
    status: 'succeeded', summary: { title: 'Read file', resource: { ...resource, content: 'SECRET_FILE_BODY', credentials: 'SECRET_CREDENTIAL' } }, durationMs: 5, at: new Date().toISOString() });
  await store.flushEvents(runId);
  const restored = await new AgentRunJournalStore(directory).loadEvents(runId);
  assert.deepEqual(restored[0].summary.resource, resource);
  assert.equal(JSON.stringify(restored).includes('SECRET_'), false);
  await store.remove(runId); assert.deepEqual(await store.loadEvents(runId), []);
});

test('recovered browser activities keep their bounded target and safe page, never typed text or credentials', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-agent-journal-browser-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, 'journal'), store = new AgentRunJournalStore(directory), runId = 'agent-journal-browser-001';
  await store.save(record(root, runId));
  const at = new Date().toISOString();
  await store.appendEvent(runId, { type: 'tool_completed', callId: 'click', toolName: 'browser.click', ok: true, status: 'succeeded', durationMs: 5, at,
    summary: { title: '浏览器操作', target: ` Sign\n in ${'x'.repeat(300)}`, resource: { kind: 'browser', url: 'https://example.com/login', title: 'Log in', cookie: 'SECRET_COOKIE' } } });
  await store.appendEvent(runId, { type: 'tool_started', callId: 'open', toolName: 'browser.open', source: 'builtin', at,
    summary: { title: '打开', resource: { kind: 'browser', url: 'https://user:SECRET_PASSWORD@example.com/' } } });
  await store.appendEvent(runId, { type: 'tool_completed', callId: 'js', toolName: 'browser.open', ok: true, status: 'succeeded', durationMs: 1, at,
    summary: { title: '打开', resource: { kind: 'browser', url: 'javascript:alert(1)' } } });
  await store.flushEvents(runId);
  const restored = await new AgentRunJournalStore(directory).loadEvents(runId);
  assert.equal(restored[0].summary.target.length, 120);
  assert.match(restored[0].summary.target, /^Sign in x+$/);
  assert.deepEqual(restored[0].summary.resource, { kind: 'browser', url: 'https://example.com/login', title: 'Log in' });
  assert.equal(restored[1].summary.resource, undefined, 'credentialed URLs are not recovered');
  assert.equal(restored[2].summary.resource, undefined, 'only http(s) pages are recovered');
  assert.equal(JSON.stringify(restored).includes('SECRET_'), false);
});

test('journal omits invalid or overlong file targets rather than truncating clickable identity', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-agent-journal-targets-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, 'journal'), store = new AgentRunJournalStore(directory), runId = 'agent-journal-targets-001';
  await store.save(record(root, runId));
  for (const [index, path] of ['', '/tmp/a\0b', '/tmp/a\nb', '/tmp/a\rb', `/${'x'.repeat(4096)}`, 'command:run', 'https://fixture.invalid/file'].entries()) {
    await store.appendEvent(runId, { type: 'tool_completed', callId: `read-invalid-${index}`, toolName: 'workspace.read_file', ok: true,
      status: 'succeeded', summary: { title: 'Read file', resource: { kind: 'file', path, action: 'read' } }, durationMs: 1, at: new Date().toISOString() });
  }
  await store.flushEvents(runId);
  const events = await store.loadEvents(runId);
  assert.equal(events.length, 7); assert.ok(events.every(event => event.summary.resource === undefined));
});

test('journal readback reapplies the resource whitelist to malformed but parseable records', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-agent-journal-readback-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, 'journal'), store = new AgentRunJournalStore(directory), runId = 'agent-journal-readback-001';
  await store.save(record(root, runId));
  const event = { type: 'tool_completed', callId: 'readback-file-001', toolName: 'workspace.read_file', ok: true,
    status: 'succeeded', summary: { title: 'Read file' }, durationMs: 1, at: new Date().toISOString() };
  await store.appendEvent(runId, event); await store.flushEvents(runId);
  const log = (await readdir(directory)).find(name => name.endsWith('-events.ndjson'));
  assert.ok(log);
  const resources = [{ kind: 'file', path: 17, action: 'read' }, { kind: 'file', path: '/tmp/a.txt', action: 'invalid' },
    { kind: 'file', path: '/tmp/a.txt', action: 'read', content: 'SECRET_BODY', startLine: -1, endLine: 'bad' }];
  await writeFile(join(directory, log), resources.map(resource => JSON.stringify({ ...event, summary: { ...event.summary, resource } })).join('\n') + '\n');
  const restored = await new AgentRunJournalStore(directory).loadEvents(runId);
  assert.equal(restored.length, 3); assert.ok(restored.every(item => item.summary.title === 'Read file'));
  assert.equal(restored[0].summary.resource, undefined); assert.equal(restored[1].summary.resource, undefined);
  assert.deepEqual(restored[2].summary.resource, { kind: 'file', path: '/tmp/a.txt', action: 'read' });
  assert.equal(JSON.stringify(restored).includes('SECRET_BODY'), false);
});

test('agent run journal rejects owner mismatch, malformed lineage, corruption, and symlink records', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-agent-journal-invalid-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, 'journal');
  const store = new AgentRunJournalStore(directory);
  const runId = 'agent-journal-invalid-001';
  await store.save(record(root, runId));
  await assert.rejects(
    () => store.load(runId, { workspaceRoot: root, conversationId: 'another-conversation' }),
    error => error instanceof AgentRunJournalError && error.code === 'AGENT_RUN_JOURNAL_OWNER_MISMATCH',
  );
  await assert.rejects(
    () => store.save(record(root, 'agent-journal-child-001', {
      owner: { workspaceRoot: root, parentRunId: 'parent-wrong-001', rootRunId: 'root-child-001', depth: 1 },
      childContinuation: {
        childRunId: 'child-journal-001',
        parentRunId: 'parent-right-001',
        rootRunId: 'root-child-001',
        depth: 1,
        resumeCheckpointId: 'resume-00000000-0000-4000-8000-000000000002',
      },
    })),
    error => error instanceof AgentRunJournalError && error.code === 'AGENT_RUN_JOURNAL_CORRUPT',
  );

  const [journalFile] = (await readdir(directory)).filter(file => file.endsWith('.json'));
  await writeFile(join(directory, journalFile), '{broken', 'utf8');
  await assert.rejects(
    () => store.load(runId),
    error => error instanceof AgentRunJournalError && error.code === 'AGENT_RUN_JOURNAL_CORRUPT',
  );
  await unlink(join(directory, journalFile));
  const outside = join(root, 'outside.json');
  await writeFile(outside, '{}', 'utf8');
  try {
    await symlink(outside, join(directory, journalFile), 'file');
  } catch (error) {
    if (error.code === 'EPERM') return t.diagnostic('Windows test user cannot create symlinks.');
    throw error;
  }
  await assert.rejects(
    () => store.load(runId),
    error => error instanceof AgentRunJournalError && error.code === 'AGENT_RUN_JOURNAL_UNSAFE',
  );
});

test('agent run journal keeps bounded restart metadata and deletes acknowledged runs', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-agent-journal-retention-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, 'journal');
  const store = new AgentRunJournalStore(directory);
  for (let index = 0; index < AGENT_RUN_JOURNAL_MAX_ENTRIES + 4; index += 1) {
    const runId = `agent-retention-${String(index).padStart(4, '0')}`;
    await store.save(record(root, runId, {
      owner: { workspaceRoot: root, rootRunId: runId, depth: 0 },
      createdAt: 10_000 + index,
      updatedAt: 10_000 + index,
    }));
  }
  assert.ok((await readdir(directory)).filter(file => file.endsWith('.json')).length <= AGENT_RUN_JOURNAL_MAX_ENTRIES);

  const removableRunId = 'agent-retention-remove-001';
  await store.save(record(root, removableRunId, {
    owner: { workspaceRoot: root, rootRunId: removableRunId, depth: 0 },
  }));
  await store.remove(removableRunId);
  await assert.rejects(
    () => store.load(removableRunId),
    error => error instanceof AgentRunJournalError && error.code === 'AGENT_RUN_JOURNAL_NOT_FOUND',
  );
});

test('restart recovery is always interrupted and requires an explicit user action', () => {
  const runId = 'agent-journal-recovery-001';
  const snapshot = interruptedAgentRunSnapshot(record('/tmp/workspace', runId, {
    state: 'interrupted',
    checkpointId: 'resume-00000000-0000-4000-8000-000000000003',
  }));
  assert.equal(snapshot.status, 'interrupted');
  assert.equal(snapshot.error?.resumable, true);
  assert.equal(snapshot.error?.retrySafe, false);
  assert.equal(snapshot.error?.kind, 'waiting_user');
  assert.deepEqual(autoResumeDecision({
    attempt: 0,
    maximum: 3,
    failureKind: snapshot.error?.kind,
    retrySafe: snapshot.error?.retrySafe,
  }), { action: 'stop', reason: 'user' });
});

test('desktop snapshot recovery validates the indexed checkpoint owner before offering manual continuation', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-agent-journal-platform-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runId = 'agent-journal-platform-001';
  const conversationId = 'conversation-platform-001';
  const owner = { workspaceRoot: root, conversationId, rootRunId: runId, depth: 0 };
  const checkpointStore = new AgentRunStateStore(join(root, 'checkpoints'));
  const checkpointId = await checkpointStore.save({
    version: 1,
    runId,
    executionScopeId: 'scope-journal-platform-001',
    nextTurn: 1,
    segment: 1,
    messages: [{ role: 'user', content: 'stored only in the checkpoint file' }],
    seenToolCallIds: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    toolCalls: 0,
    repeatedToolBatchTurns: 0,
    createdAt: new Date().toISOString(),
  }, owner);
  const journal = new AgentRunJournalStore(join(root, 'agent-run-journal-v1'));
  await journal.save(record(root, runId, { owner, checkpointId }));

  const snapshot = await new RecoveryProbeService(root).recover(runId);
  assert.equal(snapshot.status, 'interrupted');
  assert.equal(snapshot.error?.resumeCheckpointId, checkpointId);
  assert.equal(snapshot.error?.retrySafe, false);
  assert.equal((await journal.load(runId)).state, 'interrupted');

  const mismatchedRunId = 'agent-journal-platform-002';
  const mismatchedCheckpointId = await checkpointStore.save({
    version: 1,
    runId: mismatchedRunId,
    nextTurn: 1,
    segment: 1,
    messages: [{ role: 'user', content: 'owner mismatch' }],
    seenToolCallIds: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    toolCalls: 0,
    repeatedToolBatchTurns: 0,
    createdAt: new Date().toISOString(),
  }, { workspaceRoot: root, conversationId: 'different-conversation', rootRunId: mismatchedRunId, depth: 0 });
  await journal.save(record(root, mismatchedRunId, {
    owner: { workspaceRoot: root, conversationId, rootRunId: mismatchedRunId, depth: 0 },
    checkpointId: mismatchedCheckpointId,
  }));
  await assert.rejects(
    () => new RecoveryProbeService(root).recover(mismatchedRunId),
    error => error?.code === 'RUN_STATE_OWNER_MISMATCH',
  );
});

test('a hard-killed backend leaves a root checkpoint that restart exposes only for manual recovery', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-agent-journal-crash-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runId = 'agent-journal-hard-crash-001';
  const conversationId = 'conversation-hard-crash-001';
  const journalUrl = new URL('../lib/node/nextmux-agent-run-journal.js', import.meta.url).href;
  const stateUrl = new URL('../lib/node/nextmux-agent-run-state-store.js', import.meta.url).href;
  const source = `
    import { AgentRunJournalStore } from ${JSON.stringify(journalUrl)};
    import { AgentRunStateStore } from ${JSON.stringify(stateUrl)};
    const root = ${JSON.stringify(root)};
    const runId = ${JSON.stringify(runId)};
    const conversationId = ${JSON.stringify(conversationId)};
    const owner = { workspaceRoot: root, conversationId, rootRunId: runId, depth: 0 };
    const checkpointId = await new AgentRunStateStore(${JSON.stringify(join(root, 'checkpoints'))}).save({
      version: 1, runId, executionScopeId: 'scope-hard-crash-001', nextTurn: 1, segment: 1,
      messages: [{ role: 'user', content: 'recover after crash' }], seenToolCallIds: [],
      usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: 0, repeatedToolBatchTurns: 0,
      createdAt: new Date().toISOString()
    }, owner);
    await new AgentRunJournalStore(${JSON.stringify(join(root, 'agent-run-journal-v1'))}).save({
      schemaVersion: 1, runId, state: 'running', owner, workbench: 'coding',
      permissionMode: 'workspace_write', checkpointId, createdAt: Date.now(), updatedAt: Date.now()
    });
    process.stdout.write('JOURNAL_READY\\n');
    setInterval(() => undefined, 1_000);
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  await new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`child journal timeout: ${stderr}`)), 5_000);
    child.stdout.on('data', chunk => {
      stdout += String(chunk);
      if (stdout.includes('JOURNAL_READY')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.once('error', reject);
    child.once('exit', code => {
      if (!stdout.includes('JOURNAL_READY')) reject(new Error(stderr || `child exited ${code}`));
    });
  });
  child.kill('SIGKILL');
  if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));

  const snapshot = await new RecoveryProbeService(root).recover(runId);
  assert.equal(snapshot.status, 'interrupted');
  assert.equal(snapshot.error?.resumable, true);
  assert.equal(snapshot.error?.retrySafe, false);
  assert.equal(snapshot.error?.kind, 'waiting_user');
});

test('normal completion and explicit cancellation remove the restart journal', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-agent-journal-lifecycle-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const completedService = new LifecycleProbeService(root);
  const completed = await completedService.startAgentRun(runRequest(root));
  await completedService.completion(completed.runId);
  await assert.rejects(
    () => new AgentRunJournalStore(join(root, 'agent-run-journal-v1')).load(completed.runId),
    error => error instanceof AgentRunJournalError && error.code === 'AGENT_RUN_JOURNAL_NOT_FOUND',
  );

  const cancelledService = new LifecycleProbeService(root, true);
  const cancelled = await cancelledService.startAgentRun(runRequest(root));
  await cancelledService.cancelAgentRun(cancelled.runId);
  await cancelledService.completion(cancelled.runId);
  await assert.rejects(
    () => new AgentRunJournalStore(join(root, 'agent-run-journal-v1')).load(cancelled.runId),
    error => error instanceof AgentRunJournalError && error.code === 'AGENT_RUN_JOURNAL_NOT_FOUND',
  );
});

test('backend shutdown retains the same cancellation boundary as an interrupted manual recovery', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nextmux-agent-journal-shutdown-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const service = new LifecycleProbeService(root, true);
  const started = await service.startAgentRun(runRequest(root));
  await service.closeConnection();

  const recovered = await new AgentRunJournalStore(join(root, 'agent-run-journal-v1')).load(started.runId);
  assert.equal(recovered.state, 'interrupted');
  assert.equal(interruptedAgentRunSnapshot(recovered).error?.retrySafe, false);
});
