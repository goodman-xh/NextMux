import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ManagedProcessRegistry, ManagedProcessSession, normalizePtyExitSignal } from "../lib/index.js";

const baseOptions = {
  command: process.execPath,
  cwd: process.cwd(),
  env: process.env,
  timeoutMs: 5_000,
  tty: false,
  outputCharacterLimit: 8_192,
} as const;

test("disposing a registry permanently closes command admission and is idempotent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nextmux-disposed-registry-"));
  const registry = new ManagedProcessRegistry();
  try {
    const first = registry.dispose();
    assert.equal(registry.dispose(), first);
    await first;
    await assert.rejects(registry.start({ ...baseOptions, cwd: directory,
      args: ['-e', "require('node:fs').writeFileSync('late.txt','late')"] }), { name: 'AbortError' });
    await assert.rejects(readFile(join(directory, 'late.txt')), { code: 'ENOENT' });
  } finally { await registry.dispose(); await rm(directory, { recursive: true, force: true }); }
});

for (const tty of [false, true]) test(`a stop during ${tty ? 'PTY' : 'pipe'} startup rejects the pending start and terminates the child`, { timeout: 10000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "nextmux-stop-during-start-"));
  const registry = new ManagedProcessRegistry();
  let stopped: Promise<void> | undefined;
  try {
    await assert.rejects(registry.start({ ...baseOptions, tty, cwd: directory,
      args: ['-e', "setTimeout(()=>require('node:fs').writeFileSync('late.txt','late'),1000);setInterval(()=>{},1000)"],
      callbacks: { onStarted: () => { stopped = registry.dispose(); } } }), { name: 'AbortError' });
    await stopped;
    await assert.rejects(readFile(join(directory, 'late.txt')), { code: 'ENOENT' });
  } finally { await registry.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test("an already-aborted managed process is rejected before any child can start", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nextmux-aborted-process-"));
  const marker = join(directory, "spawned.txt");
  const controller = new AbortController();
  controller.abort();

  try {
    assert.throws(() => new ManagedProcessSession({
      ...baseOptions,
      args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'spawned'); setInterval(() => {}, 1000);`],
      signal: controller.signal,
    }), error => error instanceof Error && error.name === "AbortError");

    await new Promise(resolve => setTimeout(resolve, 150));
    await assert.rejects(readFile(marker), error => (error as NodeJS.ErrnoException).code === "ENOENT");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("node-pty numeric exit signals are retained as Node signal names", () => {
  assert.equal(normalizePtyExitSignal(15), "SIGTERM");
  assert.equal(normalizePtyExitSignal(undefined), null);
  assert.equal(normalizePtyExitSignal(9), "SIGKILL");
  assert.equal(normalizePtyExitSignal(987_654), null);
});

test("managed process decoding preserves UTF-8 characters split across stdout chunks", async () => {
  const session = new ManagedProcessSession({
    ...baseOptions,
    args: [
      "-e",
      "const value=Buffer.from('你好'); process.stdout.write(value.subarray(0, 1)); setTimeout(() => process.stdout.write(value.subarray(1, 4)), 15); setTimeout(() => { process.stdout.write(value.subarray(4)); process.exit(0); }, 30);",
    ],
  });
  await session.ready();
  const snapshot = await session.waitForExit();
  assert.equal(snapshot.chunks.map(chunk => chunk.text).join(""), "你好");
  assert.equal(snapshot.chunks.some(chunk => chunk.text.includes("�")), false);
});

test("managed process snapshots report cursor-specific truncation and preserve sequence order", async () => {
  const session = new ManagedProcessSession({
    ...baseOptions,
    args: ["-e", "process.stdout.write('a'.repeat(5000) + 'b'.repeat(5000))"],
    outputCharacterLimit: 4_096,
  });
  await session.ready();
  const initial = await session.waitForExit();
  assert.equal(initial.truncated, true);
  assert.ok(initial.firstAvailableSequence > 1);
  assert.deepEqual(initial.chunks.map(chunk => chunk.sequence), [...initial.chunks.map(chunk => chunk.sequence)].sort((a, b) => a - b));

  const caughtUp = session.snapshot(initial.firstAvailableSequence, 8_192);
  assert.equal(caughtUp.truncated, false);
  assert.equal(caughtUp.chunks.every(chunk => chunk.sequence > initial.firstAvailableSequence), true);
});

test("bounded snapshots expose backlog and advance the sequence cursor without gaps or replay", async () => {
  const expected = `${"a".repeat(4_096)}${"b".repeat(4_096)}tail`;
  const session = new ManagedProcessSession({
    ...baseOptions,
    args: ["-e", `process.stdout.write(${JSON.stringify(expected)})`],
    outputCharacterLimit: 16_384,
  });
  await session.ready();
  await session.waitForExit();

  let cursor = 0;
  let output = "";
  const sequences: number[] = [];
  let snapshot = session.snapshot(cursor, 4_096);
  assert.equal(snapshot.outputCharacterLimit, 16_384);
  assert.equal(snapshot.retainedCharacters, expected.length);
  assert.equal(snapshot.latestSequence > 1, true);
  assert.equal(snapshot.hasMore, true);

  while (snapshot.hasMore) {
    assert.equal(snapshot.chunks.length > 0, true, "hasMore must always permit cursor progress");
    output += snapshot.chunks.map(chunk => chunk.text).join("");
    sequences.push(...snapshot.chunks.map(chunk => chunk.sequence));
    assert.equal(snapshot.nextSequence > cursor, true);
    cursor = snapshot.nextSequence;
    snapshot = session.snapshot(cursor, 4_096);
  }
  output += snapshot.chunks.map(chunk => chunk.text).join("");
  sequences.push(...snapshot.chunks.map(chunk => chunk.sequence));

  assert.equal(output, expected);
  assert.deepEqual(sequences, [...new Set(sequences)]);
  assert.deepEqual(sequences, [...sequences].sort((a, b) => a - b));
  assert.equal(snapshot.nextSequence, snapshot.latestSequence);
  assert.equal(snapshot.hasMore, false);
});

test("ring retention evicts only whole immutable sequence chunks", async () => {
  const published = new Map<number, string>();
  const session = new ManagedProcessSession({
    ...baseOptions,
    args: ["-e", "process.stdout.write('x'.repeat(8192))"],
    outputCharacterLimit: 5_000,
    callbacks: {
      onOutput: (_processId, chunk) => { published.set(chunk.sequence, chunk.text); },
    },
  });
  await session.ready();
  const snapshot = await session.waitForExit();

  assert.equal(snapshot.truncated, true);
  assert.equal(snapshot.outputCharacterLimit, 5_000);
  assert.equal(snapshot.retainedCharacters <= snapshot.outputCharacterLimit, true);
  assert.equal(snapshot.retainedCharacters, snapshot.chunks.reduce((total, chunk) => total + chunk.text.length, 0));
  assert.equal(snapshot.chunks.every(chunk => published.get(chunk.sequence) === chunk.text), true);
});

test("managed process snapshots clamp a future cursor so later output remains readable", async () => {
  const session = new ManagedProcessSession({
    ...baseOptions,
    pipeStdin: true,
    args: [
      "-e",
      "process.stdin.once('data',()=>{process.stdout.write('later');process.exit(0)});",
    ],
  });
  await session.ready();

  const empty = session.snapshot(999, 8_192);
  assert.equal(empty.nextSequence, 0);

  await session.write("continue\n");
  const completed = await session.waitForExit();
  const fresh = session.snapshot(empty.nextSequence, 8_192);
  assert.equal(fresh.chunks.map(chunk => chunk.text).join(""), "later");
  assert.equal(fresh.nextSequence, completed.nextSequence);
});

test("a future long-poll cursor is clamped before waiting so its wake-up chunk is not lost", async () => {
  const session = new ManagedProcessSession({
    ...baseOptions,
    pipeStdin: true,
    args: [
      "-e",
      "process.stdin.once('data',()=>{process.stdout.write('wake-up-output');process.exit(0)});",
    ],
  });
  await session.ready();

  const reading = session.read(999, 8_192, 2_000);
  setTimeout(() => { void session.write("continue\n"); }, 25);
  const snapshot = await reading;
  assert.equal(snapshot.chunks.map(chunk => chunk.text).join(""), "wake-up-output");
  assert.equal(snapshot.nextSequence, snapshot.latestSequence);
  await session.waitForExit();
});

test("managed process long-polls abort promptly instead of returning later output", async () => {
  const session = new ManagedProcessSession({
    ...baseOptions,
    args: ["-e", "setInterval(() => {}, 1000)"],
    timeoutMs: 30_000,
  });
  await session.ready();
  const controller = new AbortController();
  const startedAt = Date.now();
  setTimeout(() => controller.abort(), 50);

  try {
    await assert.rejects(
      session.read(0, 8_192, 1_000, controller.signal),
      error => error instanceof Error && error.name === "AbortError",
    );
    assert.equal(Date.now() - startedAt < 500, true);
  } finally {
    await session.terminate("requested");
    await session.waitForExit();
  }
});

test("termination stops accepting output before the process tree finishes exiting", async () => {
  let published = 0;
  const session = new ManagedProcessSession({
    ...baseOptions,
    args: [
      "-e",
      "process.on('SIGTERM',()=>{}); let tick=0; setInterval(()=>process.stdout.write(`tick-${++tick}\\n`), 10);",
    ],
    timeoutMs: 30_000,
    callbacks: { onOutput: () => { published += 1; } },
  });
  await session.ready();
  await session.read(0, 8_192, 2_000);
  const atTermination = published;

  await session.terminate("requested");
  await session.waitForExit();
  assert.equal(published, atTermination);
});

test("aborting a running session stops output immediately and records cancellation", async () => {
  const controller = new AbortController();
  let published = 0;
  const session = new ManagedProcessSession({
    ...baseOptions,
    args: [
      "-e",
      "process.on('SIGTERM',()=>{}); setInterval(()=>process.stdout.write('abort-tick\\n'), 10);",
    ],
    signal: controller.signal,
    timeoutMs: 30_000,
    callbacks: { onOutput: () => { published += 1; } },
  });
  await session.ready();
  await session.read(0, 8_192, 2_000);
  const atAbort = published;

  controller.abort();
  const snapshot = await session.waitForExit();
  assert.equal(published, atAbort);
  assert.equal(snapshot.running, false);
  assert.equal(snapshot.terminationReason, "cancelled");
  assert.match(snapshot.failure || "", /cancelled/i);
});

test("async output callbacks are serialized to apply bounded consumer backpressure", async () => {
  let active = 0;
  let maximumActive = 0;
  let completed = 0;
  const session = new ManagedProcessSession({
    ...baseOptions,
    args: [
      "-e",
      "let tick=0; const timer=setInterval(()=>{process.stdout.write(`phase-${++tick}\\n`); if(tick===8){clearInterval(timer);setTimeout(()=>process.exit(0),20)}}, 10);",
    ],
    callbacks: {
      async onOutput() {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise(resolve => setTimeout(resolve, 35));
        active -= 1;
        completed += 1;
      },
    },
  });
  await session.ready();
  const snapshot = await session.waitForExit();
  const expectedCallbacks = snapshot.latestSequence;
  const deadline = Date.now() + 2_000;
  while (completed < expectedCallbacks && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(completed, expectedCallbacks);
  assert.equal(maximumActive, 1);
});

test("disposing a managed process registry terminates a process that ignores graceful shutdown", async () => {
  const registry = new ManagedProcessRegistry(1);
  const session = await registry.start({
    ...baseOptions,
    args: [
      "-e",
      "process.on('SIGTERM',()=>{}); process.stdout.write('ready\\n'); setInterval(()=>{},1000);",
    ],
    timeoutMs: 30_000,
  });
  await session.read(0, 8_192, 2_000);
  await registry.dispose();
  const snapshot = await session.waitForExit();
  assert.equal(snapshot.running, false);
  assert.equal(snapshot.terminationReason, "runtime_dispose");
});

test("explicit managed-process termination is recorded as requested rather than a command failure", async () => {
  const session = new ManagedProcessSession({
    ...baseOptions,
    args: ["-e", "setInterval(() => {}, 1000)"],
    timeoutMs: 30_000,
  });
  await session.ready();
  await session.terminate("requested");
  const snapshot = await session.waitForExit();
  assert.equal(snapshot.running, false);
  assert.equal(snapshot.terminationReason, "requested");
});
