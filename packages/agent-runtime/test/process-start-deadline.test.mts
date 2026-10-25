import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { ManagedProcessRegistry } from '../lib/process-session.js';
import { AgentToolRegistry } from '../lib/registry.js';
import { WorkspaceToolRuntime } from '../lib/workspace-tools.js';

const server = "const http=require('node:http'); const s=http.createServer((q,r)=>r.end(String(process.pid))); s.listen(0,'127.0.0.1',()=>console.log('READY:'+s.address().port));";

async function owner() {
  const base = await mkdtemp(join(tmpdir(), 'nm-start-deadline-'));
  const root = join(base, 'root'); await mkdir(root);
  const native = new ManagedProcessRegistry();
  const launched: any[] = [];
  const runtime = await WorkspaceToolRuntime.create({ workspaceRoot: root, checkpointRoot: join(base, 'checkpoints'), permissionMode: 'full_access',
    processRegistry: {
      async start(options) { launched.push(options); return native.start(options); },
      get: id => native.get(id), release: id => native.release(id), dispose: () => native.dispose(),
    } });
  const tools = new AgentToolRegistry(); runtime.registerTools(tools);
  let calls = 0;
  return { native, runtime, tools, launched,
    execute(name: string, arguments_: Record<string, unknown>, context: any = {}) {
      return tools.execute({ id: `deadline-${++calls}`, name, arguments: arguments_ }, 'full_access', { runId: 'deadline', ...context });
    },
    async close() { await runtime.dispose(); await native.dispose(); await rm(base, { recursive: true, force: true }); },
  };
}

async function ready(owner_: Awaited<ReturnType<typeof owner>>, processId: string) {
  const session = owner_.native.get(processId)!;
  for (let attempt = 0; attempt < 100; attempt++) {
    const match = /READY:(\d+)/.exec(session.snapshot().chunks.map(chunk => chunk.text).join(''));
    if (match) {
      const url = `http://127.0.0.1:${match[1]}/health`;
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      assert.equal(response.status, 200); assert.match(await response.text(), /^\d+$/);
      return url;
    }
    assert.equal(session.running, true, JSON.stringify(session.snapshot()));
    await delay(20);
  }
  assert.fail('the actual HTTP child did not become ready');
}

for (const tty of [false, true]) {
  test(`process.start omission keeps the real ${tty ? 'PTY' : 'pipe'} server alive until explicit termination`, { timeout: 10_000 }, async () => {
    const o = await owner();
    try {
      const result = await o.execute('process.start', { command: process.execPath, args: ['-e', server], tty });
      assert.equal(result.ok, true, JSON.stringify(result.error));
      assert.equal(o.launched[0].timeoutMs, 0, 'the long-lived tool must not impose a hidden fixed deadline');
      const processId = (result.output as any).processId;
      const url = await ready(o, processId);
      await delay(200);
      assert.equal((await fetch(url)).status, 200);
      const stopped = await o.execute('process.terminate', { processId });
      assert.equal(stopped.ok, true, JSON.stringify(stopped.error));
      const final = await o.native.get(processId)!.waitForExit();
      assert.equal(final.running, false); assert.equal(final.terminationReason, 'requested');
      await assert.rejects(fetch(url, { signal: AbortSignal.timeout(1_000) }));
    } finally { await o.close(); }
  });

  test(`an explicit positive process.start deadline still terminates a real ${tty ? 'PTY' : 'pipe'} child`, { timeout: 10_000 }, async () => {
    const o = await owner();
    try {
      const result = await o.execute('process.start', { command: process.execPath, args: ['-e', server], tty, timeoutMs: 400 });
      assert.equal(result.ok, true, JSON.stringify(result.error));
      const processId = (result.output as any).processId;
      const url = await ready(o, processId);
      const final = await o.native.get(processId)!.waitForExit();
      assert.equal(final.running, false); assert.equal(final.terminationReason, 'timeout');
      assert.match(final.failure || '', /timed out/);
      await assert.rejects(fetch(url, { signal: AbortSignal.timeout(1_000) }));
    } finally { await o.close(); }
  });

  test(`cancelling the owning task terminates a default-deadline-free ${tty ? 'PTY' : 'pipe'} child`, { timeout: 10_000 }, async () => {
    const o = await owner(); const cancelled = new AbortController();
    try {
      const result = await o.execute('process.start', { command: process.execPath, args: ['-e', server], tty }, { signal: cancelled.signal });
      assert.equal(result.ok, true, JSON.stringify(result.error));
      const processId = (result.output as any).processId; const url = await ready(o, processId);
      cancelled.abort();
      const final = await o.native.get(processId)!.waitForExit();
      assert.equal(final.terminationReason, 'cancelled');
      await assert.rejects(fetch(url, { signal: AbortSignal.timeout(1_000) }));
    } finally { await o.close(); }
  });
}

test('process.run keeps its 30-second default and its explicit bounded deadline', { timeout: 10_000 }, async () => {
  const o = await owner();
  try {
    const quick = await o.execute('process.run', { command: process.execPath, args: ['-e', "console.log('bounded')"] });
    assert.equal(quick.ok, true); assert.equal(o.launched[0].timeoutMs, 30_000);
    assert.equal((quick.output as any).stdout.trim(), 'bounded');
    const timed = await o.execute('process.run', { command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], timeoutMs: 100 });
    assert.equal(timed.ok, true); assert.equal((timed.output as any).terminationReason, 'timeout');
  } finally { await o.close(); }
});

test('process.start invalid explicit timeout values remain rejected before process admission', async () => {
  const o = await owner();
  try {
    for (const timeoutMs of [0, -1, 99, 1_800_001]) {
      const result = await o.execute('process.start', { command: process.execPath, args: ['-e', "console.log('must not launch')"], timeoutMs });
      assert.equal(result.ok, false); assert.equal(result.error?.code, 'INVALID_ARGUMENTS');
    }
    assert.equal(o.launched.length, 0);
  } finally { await o.close(); }
});

test('disposing one owner stops its long-lived server and leaves the other owner running', { timeout: 10_000 }, async () => {
  const a = await owner(); const b = await owner();
  try {
    const one = await a.execute('process.start', { command: process.execPath, args: ['-e', server], tty: false });
    const two = await b.execute('process.start', { command: process.execPath, args: ['-e', server], tty: true });
    assert.equal(one.ok, true); assert.equal(two.ok, true);
    const oneId = (one.output as any).processId; const twoId = (two.output as any).processId;
    const oneUrl = await ready(a, oneId); const twoUrl = await ready(b, twoId);
    const forbidden = await a.execute('process.terminate', { processId: twoId });
    assert.equal(forbidden.ok, false); assert.equal(forbidden.error?.code, 'PROCESS_NOT_FOUND');
    const oneSession = a.native.get(oneId)!;
    await a.runtime.finalizeProcessCheckpoints();
    assert.equal((await oneSession.waitForExit()).terminationReason, 'runtime_dispose');
    await assert.rejects(fetch(oneUrl, { signal: AbortSignal.timeout(1_000) }));
    assert.equal((await fetch(twoUrl)).status, 200); assert.equal(b.native.get(twoId)!.running, true);
  } finally { await a.close(); await b.close(); }
});

test('default process.start pipe and PTY HTTP servers survive the former five-minute deadline', {
  skip: process.env.NEXTMUX_RUN_LONG_PROCESS_TEST !== '1', timeout: 330_000,
}, async () => {
  const o = await owner(); const sessions: { processId: string; url: string }[] = [];
  try {
    for (const tty of [false, true]) {
      const result = await o.execute('process.start', { command: process.execPath, args: ['-e', server], tty });
      assert.equal(result.ok, true, JSON.stringify(result.error));
      const processId = (result.output as any).processId;
      sessions.push({ processId, url: await ready(o, processId) });
    }
    const startedAt = Date.now();
    for (let index = 0; index < 31; index++) {
      await delay(10_000);
      for (const session of sessions) {
        assert.equal(o.native.get(session.processId)!.running, true);
        assert.equal((await fetch(session.url)).status, 200);
      }
    }
    assert.ok(Date.now() - startedAt >= 310_000);
    await o.runtime.finalizeProcessCheckpoints();
    for (const session of sessions) await assert.rejects(fetch(session.url, { signal: AbortSignal.timeout(1_000) }));
  } finally { await o.close(); }
});
