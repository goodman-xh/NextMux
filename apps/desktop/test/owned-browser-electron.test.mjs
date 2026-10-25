import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);

test('current owned registry, production preload and Theia handler: isolated hidden Electron acceptance', { timeout: 60_000 }, async t => {
  const directory = process.env.NEXTMUX_OWNED_BROWSER_TEST_OUTPUT || await mkdtemp(join(tmpdir(), 'nm-owned-regression-'));
  await mkdir(directory, { recursive: true });
  if (!process.env.NEXTMUX_OWNED_BROWSER_TEST_OUTPUT) t.after(() => rm(directory, { recursive: true, force: true }));
  const environment = { ...process.env, NEXTMUX_OWNED_BROWSER_TEST_OUTPUT: directory }; delete environment.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [fileURLToPath(new URL('./fixtures/owned-browser-electron.cjs', import.meta.url))], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { if (log.length < 1024 * 1024) log += chunk.toString(); });
  t.after(() => { if (child.exitCode === null) child.kill('SIGTERM'); });
  const status = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
  await writeFile(join(directory, 'formal-source-electron.log'), log);
  assert.equal(status.code, 0, `Isolated Electron failed (${status.signal || status.code}); see ${join(directory, 'formal-source-electron.log')}`);
  const result = JSON.parse(await readFile(join(directory, 'owned-browser-electron-hidden-result.json'), 'utf8'));
  assert.equal(result.status, 'hidden_structural_passed'); assert.equal(result.cases.length, 10);
  assert.ok(result.cases.every(value => value.passed)); assert.ok(result.phases.every(value => value.exactText && !value.focusouts.length));
  assert.equal(result.windowEvents.length, 0, 'Hidden acceptance must not show or focus the fixture host');
});
