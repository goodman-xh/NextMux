#!/usr/bin/env node
// Isolated launcher and filesystem evidence only. All UI actions are performed
// through the supported desktop-control skill, never injected by this helper.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { createEmptyLocalPlatformFixture, readDurableDraft } from './desktop-close-persistence-e2e.mjs';
import { launchOwnedE2eProcess, terminateTree } from './desktop-attachment-file-e2e-harness.mjs';
import { installE2eSignalCleanup } from './desktop-terminal-ci-e2e.mjs';

const executable = process.env.NEXTMUX_PACKAGED_EXECUTABLE;
assert.ok(executable && isAbsolute(executable), 'Exact absolute QA executable is required');
const profile = await mkdtemp(join(tmpdir(), 'nextmux-serial-close-manual-'));
const workspace = join(profile, 'workspace'), state = join(profile, 'state'), logs = join(profile, 'logs');
for (const directory of [workspace, state, logs, join(profile, 'electron'), join(profile, 'theia')]) await mkdir(directory);
const filename = 'serial-close-fixture.txt', original = 'Original synthetic close fixture.\n';
await writeFile(join(workspace, filename), original, { flag: 'wx', mode: 0o600 });
const draft = `Unsent serial close draft ${randomUUID()}`;
const server = createEmptyLocalPlatformFixture();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${server.address().port}`;
const children = []; let round = 0, child, cleanupPromise;
const env = { ...process.env, NEXTMUX_PLATFORM_API_URL: endpoint, NEXTMUX_PUBLIC_APP_URL: endpoint,
  NEXTMUX_DESKTOP_STATE_DIR: state, NEXTMUX_AGENT_STATE_DIR: state, THEIA_CONFIG_DIR: join(profile, 'theia'),
  NEXTMUX_DESKTOP_E2E_ISOLATED: '1', NEXTMUX_DESKTOP_E2E_PROFILE_DIR: profile, NEXTMUX_E2E_WORKSPACE: workspace,
  XDG_DATA_HOME: join(profile, 'xdg-data'), XDG_CONFIG_HOME: join(profile, 'xdg-config') };
const cleanup = () => cleanupPromise ||= (async () => {
  for (const owned of children) await terminateTree(owned);
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
})();
const disposeSignals = installE2eSignalCleanup(cleanup);
async function launch() {
  if (child) {
    assert.equal(child.exitCode, 0, 'Restart requires a natural successful prior exit');
    assert.equal(child.signalCode, null);
    await terminateTree(child);
  }
  round++;
  child = launchOwnedE2eProcess(executable, [workspace, `--user-data-dir=${join(profile, 'electron')}`, `--electronUserData=${join(profile, 'electron')}`],
    { env, stdout: join(logs, `app-${round}.stdout.log`), stderr: join(logs, `app-${round}.stderr.log`) });
  children.push(child);
  child.once('exit', (code, signal) => console.log(JSON.stringify({ event: 'app-exit', round, code, signal })));
  console.log(JSON.stringify({ event: 'launched', round, pid: child.pid, executable, profile, workspace, state, draft, filename }));
}
await launch();
const input = createInterface({ input: process.stdin });
try {
  for await (const command of input) {
    if (command === 'status') console.log(JSON.stringify({ round, exitCode: child.exitCode, signalCode: child.signalCode,
      durableDraft: await readDurableDraft(state, draft), file: await readFile(join(workspace, filename), 'utf8'), nonGetRequests: server.nonGetRequests }));
    else if (command === 'restart') await launch();
    else if (command === 'finish') { assert.equal(child.exitCode, 0); assert.equal(child.signalCode, null); break; }
    else if (command) throw new Error('Unknown QA control command');
  }
} finally { await cleanup(); disposeSignals(); input.close(); }
