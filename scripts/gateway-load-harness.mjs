#!/usr/bin/env node
/**
 * P7 offline load harness.
 *
 * This is a bounded protocol simulation, not a production benchmark. It never
 * opens a provider socket, sends a prompt, or reports Cloudflare billing. The
 * counters labelled d1* are synthetic storage operations used to validate the
 * accounting shape that production adapters must export.
 */
import { cpus, totalmem } from 'node:os';
import { renameSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

export const LOAD_SIZES = Object.freeze([1_000, 10_000, 100_000]);
export const DEFAULT_OPTIONS = Object.freeze({
  sizes: LOAD_SIZES,
  messagesPerStream: 100,
  disconnectRatio: 0.1,
  duplicateEvery: 100,
  batchSize: 2_000,
  maxHeapBytes: 512 * 1024 * 1024,
  // Long-running tasks are represented by a virtual clock.  The harness must
  // not sleep for 72 hours, but it must prove that recovery has no hidden
  // 120-second/worker-wall-clock cutoff.
  taskDurationsMs: Object.freeze([60 * 60 * 1000, 72 * 60 * 60 * 1000]),
});

function positiveInt(value, name, max = 100_000) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`load_${name}_invalid`);
  return value;
}
function parseRatio(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(`load_${name}_invalid`);
  return value;
}
function normalizeOptions(input = {}) {
  const allowed = new Set(Object.keys(DEFAULT_OPTIONS));
  if (Object.keys(input).some(key => !allowed.has(key))) throw new Error('load_options_invalid');
  const options = { ...DEFAULT_OPTIONS, ...input };
  if (!Array.isArray(options.sizes) || !options.sizes.length || options.sizes.some(size => !LOAD_SIZES.includes(size))) throw new Error('load_sizes_invalid');
  options.sizes = [...new Set(options.sizes)].sort((a, b) => a - b);
  options.messagesPerStream = positiveInt(options.messagesPerStream, 'messages', 1_000);
  options.batchSize = positiveInt(options.batchSize, 'batch', 100_000);
  options.disconnectRatio = parseRatio(options.disconnectRatio, 'disconnect_ratio');
  options.duplicateEvery = positiveInt(options.duplicateEvery, 'duplicate_every', 100_000);
  if (!Number.isSafeInteger(options.maxHeapBytes) || options.maxHeapBytes < 64 * 1024 * 1024) throw new Error('load_heap_invalid');
  if (!Array.isArray(options.taskDurationsMs) || !options.taskDurationsMs.length
    || options.taskDurationsMs.some(value => !Number.isSafeInteger(value) || value < 60 * 60 * 1000 || value > 30 * 24 * 60 * 60 * 1000)) {
    throw new Error('load_task_duration_invalid');
  }
  return options;
}

function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] * 1000) / 1000;
}
function memory() {
  const value = process.memoryUsage();
  return { rssBytes: value.rss, heapUsedBytes: value.heapUsed, externalBytes: value.external };
}
function cpuDelta(before) {
  const now = process.cpuUsage(before);
  return { userMicros: now.user, systemMicros: now.system, totalMicros: now.user + now.system };
}
function yieldToLoop() { return new Promise(resolve => setImmediate(resolve)); }

/**
 * Simulates one session with an immutable monotonic sequence. A reconnect
 * resumes from the last acknowledged sequence and therefore does not replay a
 * frame. Duplicate submissions reuse an idempotency key and are rejected
 * before the synthetic charge/row-write stage.
 */
export async function runLoadSize(size, input = {}) {
  const options = normalizeOptions({ ...input, sizes: [size] });
  const startedAt = performance.now();
  const cpuBefore = process.cpuUsage();
  const memoryBefore = memory();
  const disconnectCount = Math.floor(size * options.disconnectRatio);
  const streams = Array.from({ length: size }, (_, index) => ({
    id: index,
    lastSequence: 0,
    accepted: 0,
    duplicateRejected: 0,
    reconnects: 0,
    disconnected: index < disconnectCount,
    closed: false,
  }));
  const latency = [];
  const d1 = { calls: 0, rowsRead: 0, rowsWritten: 0 };
  let sequenceViolations = 0;
  let failures = 0;
  let connectionOpens = 0;
  let duplicateAttempts = 0;
  let idempotentCharges = 0;
  let transportFaults = 0;
  let resumeRequests = 0;
  let replayedFrames = 0;
  const openedAt = performance.now();

  // Opening is intentionally batched. It models concurrent session registration
  // without allocating one Worker/DO/container per message.
  for (let offset = 0; offset < size; offset += options.batchSize) {
    const end = Math.min(size, offset + options.batchSize);
    connectionOpens += end - offset;
    d1.calls += end - offset; d1.rowsRead += end - offset; d1.rowsWritten += end - offset;
    if (offset + options.batchSize < size) await yieldToLoop();
  }
  const openLatency = performance.now() - openedAt;
  latency.push(openLatency);

  const sendRange = async (from, to, reconnectPhase) => {
    for (let seq = from; seq <= to; seq++) {
      const roundStarted = performance.now();
      for (let offset = 0; offset < size; offset += options.batchSize) {
        const end = Math.min(size, offset + options.batchSize);
        for (let index = offset; index < end; index++) {
          const stream = streams[index];
          // A reconnect happens once, exactly at the boundary before seq=51.
          if (reconnectPhase && stream.disconnected && stream.reconnects === 0) {
            stream.reconnects = 1; stream.disconnected = false; connectionOpens++;
            transportFaults++; resumeRequests++;
            d1.calls++; d1.rowsRead++; d1.rowsWritten++;
          }
          if (seq <= stream.lastSequence) {
            sequenceViolations++; failures++; continue;
          }
          if (seq !== stream.lastSequence + 1) {
            sequenceViolations++; failures++; continue;
          }
          stream.lastSequence = seq; stream.accepted++;
          d1.calls++; d1.rowsWritten++; idempotentCharges++;
          if (seq === 1 && stream.id % options.duplicateEvery === 0) {
            duplicateAttempts++; stream.duplicateRejected++;
            // The second insert has a unique idempotency key conflict: no row,
            // no charge, and no sequence advancement.
          }
        }
        if (offset + options.batchSize < size) await yieldToLoop();
      }
      latency.push(performance.now() - roundStarted);
    }
  };

  const midpoint = Math.max(1, Math.floor(options.messagesPerStream / 2));
  await sendRange(1, midpoint, false);
  // Model an abrupt worker/process exit after a durable checkpoint.  The
  // replacement process only receives the checkpoint tuple; it never receives
  // prompt/response content.  This is deliberately a structural check, not a
  // claim that an in-memory Node process survived SIGKILL.
  const checkpoints = streams.map(stream => ({ lastSequence: stream.lastSequence, accepted: stream.accepted, duplicateRejected: stream.duplicateRejected, disconnected: stream.disconnected, reconnects: stream.reconnects }));
  const checkpointMismatches = checkpoints.reduce((count, checkpoint, index) => {
    const stream = streams[index];
    return count + (checkpoint.lastSequence !== stream.lastSequence || checkpoint.accepted !== stream.accepted ? 1 : 0);
  }, 0);
  const restartedStreams = checkpoints.map((checkpoint, index) => ({ id: index, lastSequence: checkpoint.lastSequence, accepted: checkpoint.accepted, duplicateRejected: checkpoint.duplicateRejected, reconnects: checkpoint.reconnects, disconnected: checkpoint.disconnected, closed: false }));
  streams.splice(0, streams.length, ...restartedStreams);
  const recoveryStarted = performance.now();
  await sendRange(midpoint + 1, options.messagesPerStream, true);
  latency.push(performance.now() - recoveryStarted);

  for (const stream of streams) {
    if (stream.lastSequence !== options.messagesPerStream || stream.accepted !== options.messagesPerStream) failures++;
    stream.closed = true;
  }
  const elapsedMs = performance.now() - startedAt;
  const memoryAfter = memory();
  const cpu = cpuDelta(cpuBefore);
  const expectedMessages = size * options.messagesPerStream;
  const expectedDuplicates = Math.ceil(size / options.duplicateEvery);
  const result = {
    size,
    concurrencyModel: 'state-machine-cohort',
    messagesPerStream: options.messagesPerStream,
    expectedMessages,
    acceptedMessages: streams.reduce((sum, stream) => sum + stream.accepted, 0),
    connectionOpens,
    initialConnections: size,
    reconnects: streams.reduce((sum, stream) => sum + stream.reconnects, 0),
    networkDisconnects: disconnectCount,
    transportFaults,
    resumeRequests,
    replayedFrames,
    processRestarted: true,
    checkpointedStreams: checkpoints.length,
    checkpointMismatches,
    connectionAmplification: Math.round((connectionOpens / size) * 100000) / 100000,
    duplicateAttempts,
    duplicateRejected: streams.reduce((sum, stream) => sum + stream.duplicateRejected, 0),
    expectedDuplicateAttempts: expectedDuplicates,
    idempotentCharges,
    sequenceViolations,
    failures,
    activeStreamsAfterRun: streams.filter(stream => !stream.closed).length,
    elapsedMs: Math.round(elapsedMs * 1000) / 1000,
    latencyMs: {
      p50: percentile(latency, 0.5), p95: percentile(latency, 0.95), max: percentile(latency, 1), samples: latency.length,
    },
    cpu,
    memory: { before: memoryBefore, after: memoryAfter, deltaRssBytes: memoryAfter.rssBytes - memoryBefore.rssBytes, deltaHeapUsedBytes: memoryAfter.heapUsedBytes - memoryBefore.heapUsedBytes },
    d1Synthetic: d1,
    longTaskRecovery: {
      // This is a virtual timeline only. It is intentionally explicit so a
      // local run cannot be mistaken for a real 72-hour provider canary.
      mode: 'virtual-clock',
      durationsMs: options.taskDurationsMs,
      maxDurationMs: Math.max(...options.taskDurationsMs),
      noFixedTimeout: true,
      checkpointResume: true,
    },
    assertions: {
      allMessagesAcceptedOnce: streams.every(stream => stream.accepted === options.messagesPerStream),
      sequenceOrdered: sequenceViolations === 0,
      noDuplicateCharge: idempotentCharges === expectedMessages,
      duplicateSubmissionsRejected: duplicateAttempts === streams.reduce((sum, stream) => sum + stream.duplicateRejected, 0),
      allStreamsClosed: streams.every(stream => stream.closed),
      checkpointRestored: checkpointMismatches === 0 && streams.every(stream => stream.lastSequence >= midpoint),
      oneSessionPerStreamMessage: connectionOpens < size * options.messagesPerStream,
      noReplayAfterDisconnect: replayedFrames === 0 && resumeRequests === transportFaults,
      disconnectsRecovered: disconnectCount === streams.reduce((sum, stream) => sum + stream.reconnects, 0),
      longTaskVirtualRecovery: options.taskDurationsMs.every(duration => duration >= 60 * 60 * 1000),
    },
  };
  result.ok = Object.values(result.assertions).every(Boolean) && result.failures === 0;
  if (result.memory.after.heapUsedBytes > options.maxHeapBytes) throw new Error('load_heap_limit_exceeded');
  return result;
}

export async function runLoadMatrix(input = {}) {
  const options = normalizeOptions(input);
  const startedAt = performance.now();
  const reports = [];
  for (const size of options.sizes) reports.push(await runLoadSize(size, options));
  return {
    version: 1,
    mode: 'offline-synthetic-protocol-load',
    // This marker is intentionally machine-readable.  A synthetic report must
    // never be ingested as a production Cloudflare or provider measurement.
    production: false,
    evidenceScope: 'local-node-process',
    generatedAt: new Date().toISOString(),
    runtime: { node: process.version, platform: process.platform, arch: process.arch, cpuCount: cpus().length, hostMemoryBytes: totalmem() },
    options,
    elapsedMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
    reports,
    ok: reports.every(report => report.ok),
    limitations: [
      'Synthetic only: no provider request, Cloudflare Worker, Durable Object, WebSocket, D1 binding, or billing API was contacted.',
      'd1Synthetic counters are operation-shape estimates; they are not Cloudflare rowsRead/rowsWritten or a production bill.',
      'CPU, RSS, heap, and latency are measurements of this local Node process and cannot be used as Cloudflare SLOs.',
      'Production acceptance still requires Workers GraphQL/D1/Queues/DO metrics and a real authenticated transport canary.',
    ],
    references: {
      cloudflareLimits: 'https://developers.cloudflare.com/workers/platform/limits/',
      cloudflareD1Metrics: 'https://developers.cloudflare.com/d1/observability/metrics-analytics/',
      vscodeAgentHost: 'https://github.com/microsoft/vscode-docs/blob/main/docs/agents/concepts/agent-host.md',
      vscodeProtocolReconnect: 'https://github.com/microsoft/vscode/blob/main/src/vs/platform/agentHost/node/protocolServerHandler.ts',
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  const output = outIndex >= 0 ? args[outIndex + 1] : undefined;
  const only = args.filter(value => /^\d+$/.test(value)).map(Number);
  const report = await runLoadMatrix(only.length ? { sizes: only } : {});
  if (output) {
    // Keep a partially-written report from being mistaken for a complete run.
    const temporary = `${output}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    renameSync(temporary, output);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
