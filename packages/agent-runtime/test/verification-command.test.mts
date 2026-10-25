import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AgentVerificationTracker, isVerificationCommand } from '../lib/run-verification.js';

test('inspection, collection and configuration modes never certify edits', () => {
  const queries: [string, string[]][] = [
    ['tsc', ['--showConfig']], ['tsc', ['--listFilesOnly']], ['tsc', ['--init']], ['tsc', ['-v']],
    ['tsc', ['--build', '--dry']], ['pytest', ['--collect-only', '-q']], ['pytest', ['--co']],
    ['python3', ['-m', 'pytest', '--fixtures']], ['pytest', ['--setup-plan']],
    ['jest', ['--showConfig=true']], ['jest', ['--listTests']], ['vitest', ['list']],
    ['eslint', ['--print-config', 'src/a.ts']], ['ruff', ['rule', 'E501']], ['ruff', ['check', '--show-files']],
    ['ruff', ['format', '.']], ['pylint', ['--generate-rcfile']], ['cargo-nextest', ['list']],
    ['cargo', ['test', '--', '--list']], ['go', ['test', '-list=.', './...']],
    ['go', ['build', '-n']], ['dotnet', ['test', '--list-tests']],
    ['pnpm', ['test', '--', '--listTests']], ['npm', ['run', 'test', '--', '--collect-only']],
    ['pnpm', ['run', 'typecheck', '--', '--showConfig']], ['yarn', ['test', '--help']],
  ];
  for (const [command, args] of queries) assert.equal(isVerificationCommand({ command, args }), false, `${command} ${args.join(' ')}`);
});

test('actual check modes remain valid, including Python modules and Windows paths', () => {
  const checks: [string, string[]][] = [
    ['tsc', ['--noEmit']], ['C:\\tools\\tsc.cmd', ['-p', '.']], ['tsc', ['--build']],
    ['pytest', ['-v', 'tests']], ['python3', ['-m', 'pytest', '-q']], ['python3.12', ['-m', 'unittest', 'discover']],
    ['jest', ['--runInBand']], ['vitest', ['run']], ['vitest', ['related', 'src/a.ts']],
    ['eslint', ['src']], ['ruff', ['check', '.']], ['ruff', ['format', '--check', '.']],
    ['mypy', ['src']], ['pylint', ['src']], ['cargo-nextest', ['run']], ['cargo', ['test']],
    ['go', ['test', './...']], ['dotnet', ['build']], ['node', ['--test', 'a.test.mjs']],
    ['pnpm', ['--dir', 'core', 'run', 'typecheck']], ['npm', ['run', 'test', '--', '--runInBand']],
  ];
  for (const [command, args] of checks) assert.equal(isVerificationCommand({ command, args }), true, `${command} ${args.join(' ')}`);
});

test('real successful tsc configuration query cannot conceal a type error', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'nm-verification-query-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noEmit: true, skipLibCheck: true, types: [] }, files: ['broken.ts'] }));
  await writeFile(join(cwd, 'broken.ts'), 'export const value: number = "wrong";\n');
  const compiler = createRequire(import.meta.url).resolve('typescript/bin/tsc');
  const query = spawnSync(process.execPath, [compiler, '--showConfig'], { cwd, encoding: 'utf8' });
  const check = spawnSync(process.execPath, [compiler, '--noEmit', '--pretty', 'false'], { cwd, encoding: 'utf8' });
  assert.equal(query.status, 0);
  assert.equal(check.status, 2);
  assert.match(check.stdout, /TS2322/);
  const tracker = new AgentVerificationTracker();
  tracker.observe({ id: 'edit', name: 'workspace.write_file', arguments: { path: 'broken.ts' } },
    { ok: true, output: {}, summary: { title: 'edit', resource: { kind: 'file', path: 'broken.ts', action: 'updated' } } });
  tracker.observe({ id: 'query', name: 'process.run', arguments: { command: 'tsc', args: ['--showConfig'], cwd } },
    { ok: true, output: { exitCode: query.status, stdout: query.stdout }, summary: { title: 'query', commandLine: 'tsc --showConfig' } });
  assert.equal(tracker.snapshot().status, 'unverified');
  assert.deepEqual(tracker.snapshot().checks, []);
  tracker.observe({ id: 'check', name: 'process.run', arguments: { command: 'tsc', args: ['--noEmit'], cwd } },
    { ok: true, output: { exitCode: check.status, stdout: check.stdout }, summary: { title: 'check', commandLine: 'tsc --noEmit' } });
  assert.equal(tracker.snapshot().status, 'failed');
});
