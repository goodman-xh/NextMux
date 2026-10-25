import assert from 'node:assert/strict';
import test from 'node:test';

import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { AgentEventBuffer } from '../lib/node/nextmux-agent-event-buffer.js';

test('closing a desktop connection aborts active agent work and waits for cleanup', async () => {
  class LifecyclePlatformService extends NextMuxPlatformServiceImpl {
    seedRunningJob() {
      const controller = new AbortController();
      let cleanupObserved = false;
      const completion = new Promise(resolve => {
        controller.signal.addEventListener('abort', () => {
          cleanupObserved = true;
          resolve();
        }, { once: true });
      });
      const job = {
        runId: 'agent-lifecycle-test',
        controller,
        events: new AgentEventBuffer({ maximumEntries: 8, maximumWeight: 8_192 }),
        pendingMessages: [],
        startedAt: Date.now(),
        status: 'running',
        cancelRequested: false,
        updatedAt: Date.now(),
        completion,
      };
      this.agentJobs.set(job.runId, job);
      return { controller, job, cleanupObserved: () => cleanupObserved };
    }

    async shutdown() {
      await this.disposeConnectionResources();
    }

    get jobCount() {
      return this.agentJobs.size;
    }
  }

  const service = new LifecyclePlatformService();
  const seeded = service.seedRunningJob();
  await service.shutdown();

  assert.equal(seeded.controller.signal.aborted, true);
  assert.equal(seeded.job.cancelRequested, true);
  assert.equal(seeded.job.status, 'cancelled');
  assert.equal(seeded.cleanupObserved(), true);
  assert.equal(service.jobCount, 0);
  await service.shutdown();
  assert.equal(service.jobCount, 0, 'shutdown must be idempotent');
});
