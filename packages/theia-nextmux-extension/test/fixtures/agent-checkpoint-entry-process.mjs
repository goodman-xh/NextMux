import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DelegatedWorkspaceManager, WorkspaceToolRuntime } from '@nextmux/agent-runtime';
import { NextMuxPlatformServiceImpl } from '../../lib/node/nextmux-platform-service.js';

class Service extends NextMuxPlatformServiceImpl {
  constructor(profile) { super(); this.profile = profile; }
  nextmuxDataRoot() { return this.profile; }
}

const [mode, profile, sourceRoot] = process.argv.slice(2);
const service = new Service(profile);
const originalCreate = WorkspaceToolRuntime.create;
WorkspaceToolRuntime.create = async function (options) {
  const runtime = await originalCreate.call(this, options);
  const sentinel = join(options.checkpointRoot, 'entry-race-sentinel');
  await writeFile(sentinel, 'temporary-fixture-only');
  process.stdout.write(`${JSON.stringify({ type: 'entered', workspaceRoot: options.workspaceRoot, sentinel })}\n`);
  await new Promise(resolve => process.stdin.once('data', resolve));
  return runtime;
};

try {
  if (mode === 'child') {
    const manager = new DelegatedWorkspaceManager({
      storageRoot: join(profile, 'delegated-workspaces'),
      checkpointRootForWorkspace: root => service.agentCheckpointRoot(root),
    });
    let lease;
    try {
      const child = await manager.prepare({
        childRunId: `child-${randomUUID()}`, parentRunId: `agent-${randomUUID()}`,
        workspaceRoot: sourceRoot, permissionMode: 'workspace_write',
        beforeRuntimeCreate: async root => { lease = await service.acquireAgentCheckpointRunLeases([root]); },
      });
      await child.dispose();
    } finally { await lease?.release(); }
  } else if (mode === 'read') {
    try { await service.getAgentCheckpointDiff(sourceRoot, `missing-${randomUUID()}`); }
    catch { /* The preview identifier is deliberately absent; only the open/clear race matters. */ }
  } else throw new Error(`invalid fixture mode: ${mode}`);
  process.stdout.write(`${JSON.stringify({ type: 'done' })}\n`);
} catch (error) {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
}
