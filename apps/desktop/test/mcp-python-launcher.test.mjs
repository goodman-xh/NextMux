import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import path from 'node:path';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, existsSync, copyFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writePythonMcpLauncher } from '../../../scripts/mcp-python-launcher.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const python = process.env.NEXTMUX_TEST_PYTHON || (process.platform === 'win32' ? 'python.exe' : '/usr/bin/python3');
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'nextmux-python-launcher-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const target = join(directory, 'runtime'), packages = join(target, 'python-package');
  mkdirSync(packages, { recursive: true });
  return { directory, target, packages, payload: join(target, 'server.cjs') };
}
function runBootstrap(bootstrap, args = [], options = {}) {
  const result = spawnSync(python, ['-I', '-S', bootstrap, ...args], { encoding: 'utf8', timeout: 10000, ...options });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('actual generated bootstrap processes bundled pth and preserves module arguments', t => {
  const f = fixture(t);
  mkdirSync(join(f.packages, 'fixture_server'));
  mkdirSync(join(f.packages, 'bundled-extra'));
  writeFileSync(join(f.packages, 'bundled.pth'), 'bundled-extra\n');
  writeFileSync(join(f.packages, 'bundled-extra', 'pth_dependency.py'), 'VALUE = "bundled"\n');
  writeFileSync(join(f.packages, 'fixture_server', '__main__.py'), 'import json,sys,pth_dependency\nprint(json.dumps({"value":pth_dependency.VALUE,"args":sys.argv[1:],"isolated":sys.flags.isolated,"no_site":sys.flags.no_site}))\n');
  const { bootstrap } = writePythonMcpLauncher(f.payload, 'fixture_server');
  assert.deepEqual(runBootstrap(bootstrap, ['--name', 'contains space', '中文']), { value: 'bundled', args: ['--name', 'contains space', '中文'], isolated: 1, no_site: 1 });
  assert.match(readFileSync(f.payload, 'utf8'), /\['-I', '-S', path\.join\(__dirname, 'python-bootstrap\.py'\)/);
});

test('isolated launch ignores ambient PYTHONPATH, PYTHONHOME, user site and current-directory modules', t => {
  const f = fixture(t), poison = join(f.directory, 'untrusted');
  mkdirSync(poison);
  mkdirSync(join(f.packages, 'fixture_server'));
  writeFileSync(join(f.packages, 'fixture_server', '__main__.py'), 'import json,sys\nprint(json.dumps({"origin":"bundled","paths":sys.path}))\n');
  writeFileSync(join(poison, 'fixture_server.py'), 'raise RuntimeError("ambient module was imported")\n');
  writeFileSync(join(poison, 'json.py'), 'raise RuntimeError("current directory was imported")\n');
  writeFileSync(join(poison, 'sitecustomize.py'), 'raise RuntimeError("ambient site was imported")\n');
  const { bootstrap } = writePythonMcpLauncher(f.payload, 'fixture_server');
  const result = runBootstrap(bootstrap, [], { cwd: poison, env: { ...process.env, PYTHONPATH: poison, PYTHONHOME: poison, PYTHONUSERBASE: poison } });
  assert.equal(result.origin, 'bundled');
  assert.ok(!result.paths.includes(poison));
  assert.ok(result.paths.includes(realpathSync(f.packages)));
});

test('invalid modules and linked bundled package directories are refused before launcher writes', t => {
  const f = fixture(t);
  for (const name of ['', '../other', 'module;import os', '-m', 'a/b']) assert.throws(() => writePythonMcpLauncher(f.payload, name), /exact module/);
  assert.equal(existsSync(f.payload), false);
  const external = join(f.directory, 'external');
  mkdirSync(external); rmSync(f.packages, { recursive: true });
  try { symlinkSync(external, f.packages, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) { t.skip('This Windows account cannot create a test link'); return; } throw error; }
  assert.throws(() => writePythonMcpLauncher(f.payload, 'fixture_server'), /real bundled directory/);
  assert.equal(existsSync(f.payload), false);
});

test('normal refresh command verifies the pinned wheel and changes only Python launchers', t => {
  const f = fixture(t), scripts = join(f.directory, 'scripts'), runtime = join(f.directory, 'apps/desktop/build-resources/mcp-runtime');
  mkdirSync(scripts, { recursive: true });
  for (const name of ['prepare-mcp-runtime.mjs', 'pinned-pypi-wheel.mjs', 'mcp-python-launcher.mjs', 'npm-build-command.mjs']) copyFileSync(join(root, 'scripts', name), join(scripts, name));
  const target = join(runtime, 'runtimes', 'fixture-python');
  mkdirSync(join(target, 'python-package'), { recursive: true });
  mkdirSync(join(target, 'wheels'));
  const wheel = Buffer.from('isolated primary artifact fixture');
  writeFileSync(join(target, 'wheels', 'fixture-1.0-py3-none-any.whl'), wheel);
  const dependency = join(target, 'python-package', 'dependency.py');
  writeFileSync(dependency, 'existing verified payload\n');
  const other = join(runtime, 'runtimes', 'other'); mkdirSync(other); writeFileSync(join(other, 'keep.txt'), 'other runtime');
  const interpreter = join(runtime, 'python-runtime', process.platform === 'win32' ? 'python.exe' : 'bin/python3');
  mkdirSync(dirname(interpreter), { recursive: true }); writeFileSync(interpreter, 'regular interpreter fixture; refresh never executes it');
  const manifest = { version: 1, runtimes: { other: { entry: 'runtimes/other/server.cjs', source: { type: 'npm' } }, fixture: { entry: 'runtimes/fixture-python/server.cjs', source: { type: 'pypi', pythonModule: 'fixture_server', url: 'https://files.pythonhosted.org/fixture-1.0-py3-none-any.whl', sha256: createHash('sha256').update(wheel).digest('hex') } } } };
  writeFileSync(join(runtime, 'manifest.json'), JSON.stringify(manifest));
  const command = join(scripts, 'prepare-mcp-runtime.mjs');
  const refreshed = spawnSync(process.execPath, [command, '--refresh-python-launchers'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(refreshed.status, 0, refreshed.stderr);
  assert.equal(readFileSync(dependency, 'utf8'), 'existing verified payload\n');
  assert.deepEqual(readFileSync(join(target, 'wheels', 'fixture-1.0-py3-none-any.whl')), wheel);
  assert.equal(readFileSync(join(other, 'keep.txt'), 'utf8'), 'other runtime');
  assert.ok(existsSync(join(target, 'python-bootstrap.py')));
  writeFileSync(join(target, 'wheels', 'fixture-1.0-py3-none-any.whl'), 'corrupt');
  const failed = spawnSync(process.execPath, [command, '--refresh-python-launchers'], { encoding: 'utf8', timeout: 10000 });
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /integrity mismatch/);
});


test('generated Windows Python spawn requests a hidden console without losing exact arguments or stdio', t => {
  const f = fixture(t);
  writePythonMcpLauncher(f.payload, 'fixture_server');
  const calls = [], listeners = new Map();
  const child = { once(event, listener) { listeners.set(event, listener); return this; } };
  const environment = { FIXTURE: 'retained' };
  const runtime = { platform: 'win32', argv: ['node', f.payload, 'serve', '--literal', 'spaces ; $ untouched'], env: environment, stderr: { write() {} }, kill() { throw Error('No process signal in test'); }, pid: 0 };
  runInNewContext(readFileSync(f.payload, 'utf8'), { __dirname: f.target, process: runtime, require(name) { if (name === 'node:path') return path; if (name === 'node:child_process') return { spawn(...args) { calls.push(args); return child; } }; throw Error(name); } });
  assert.equal(calls.length, 1);
  const [command, args, options] = calls[0];
  assert.equal(command, join(f.target, '..', '..', 'python-runtime', 'python.exe'));
  assert.deepEqual(Array.from(args), ['-I', '-S', join(f.target, 'python-bootstrap.py'), 'serve', '--literal', 'spaces ; $ untouched']);
  assert.equal(options.windowsHide, true);
  assert.equal(options.stdio, 'inherit');
  assert.equal(options.env, environment);
  assert.equal(options.cwd, f.target);
  assert.equal(options.shell, undefined);
  listeners.get('exit')(7, null);
  assert.equal(runtime.exitCode, 7);
});
