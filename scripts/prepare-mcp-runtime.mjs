#!/usr/bin/env node
/**
 * Prepare the pinned local MCP payloads used by packaged NextMux builds.
 *
 * The installed app never runs npm/uvx or downloads code. This build-time
 * command fetches only the exact registry artifact recorded in the manifest,
 * verifies its integrity, installs production dependencies with lifecycle
 * scripts disabled, and writes a tiny server wrapper. Release builds fail
 * closed when a payload cannot be prepared.
 */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { npmBuildCommand } from './npm-build-command.mjs';
import { verifyPinnedPypiWheel } from './pinned-pypi-wheel.mjs';
import { writePythonMcpLauncher } from './mcp-python-launcher.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtimeRoot = join(root, 'apps/desktop/build-resources/mcp-runtime');
const manifestPath = join(runtimeRoot, 'manifest.json');
const argv = new Set(process.argv.slice(2));
const shouldFetch = argv.has('--fetch');
const refreshPythonLaunchers = argv.has('--refresh-python-launchers');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest?.version !== 1 || !manifest.runtimes || typeof manifest.runtimes !== 'object') throw new Error('MCP runtime manifest is invalid.');
if (shouldFetch === refreshPythonLaunchers) throw new Error('Choose --fetch or --refresh-python-launchers during a release build.');

const npm = npmBuildCommand();
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', encoding: 'utf8', ...options });
  if (result.error || result.status !== 0) throw result.error || new Error(`${command} ${args.join(' ')} failed with ${result.status}`);
  return result;
};
const parseJson = (output, label) => {
  try { return JSON.parse(output); } catch { throw new Error(`${label} returned invalid JSON.`); }
};
const digest = (path, algorithm = 'sha512') => createHash(algorithm).update(readFileSync(path)).digest('base64');

const targetPlatform = process.env.NEXTMUX_TARGET_PLATFORM || process.platform;
const targetArchitecture = process.env.NEXTMUX_TARGET_ARCH || process.arch;
if (targetPlatform !== process.platform || targetArchitecture !== process.arch) {
  throw new Error('MCP browser and native payloads must be prepared on their target OS and architecture.');
}
for (const [id, entry] of Object.entries(manifest.runtimes)) {
  if (Array.isArray(entry.platforms) && !entry.platforms.includes(targetPlatform)) { console.log(`[NextMux MCP] skipped ${id} for ${targetPlatform}`); continue; }
  if (Array.isArray(entry.architectures) && !entry.architectures.includes(targetArchitecture)) { console.log(`[NextMux MCP] skipped ${id} for ${targetPlatform}-${targetArchitecture}`); continue; }
  const source = entry?.source;
  if (!source || typeof source !== 'object') throw new Error(`MCP runtime ${id} has no pinned source.`);
  const target = join(runtimeRoot, entry.entry.replaceAll('/', '/').split('/').slice(0, -1).join('/'));
  const payload = join(runtimeRoot, entry.entry);
  if (refreshPythonLaunchers) {
    if (source.type !== 'pypi') continue;
    // Refresh generated launchers only, without redownloading/reinstalling an
    // already verified payload or modifying another runtime's resources.
    await verifyPinnedPypiWheel(source, join(target, 'wheels'));
    const python = join(runtimeRoot, 'python-runtime', process.platform === 'win32' ? 'python.exe' : 'bin/python3');
    if (!existsSync(python) || !lstatSync(python).isFile() || lstatSync(python).isSymbolicLink()) throw new Error('Prepared bundled Python is missing.');
    writePythonMcpLauncher(payload, source.pythonModule);
    console.log(`[NextMux MCP] refreshed Python launcher ${id}`);
    continue;
  }
  // Keep only Playwright's revisioned browser cache; the original installer still validates it.
  if (id === 'playwright' && source.type === 'npm' && existsSync(target)) {
    if (!lstatSync(target).isDirectory() || lstatSync(target).isSymbolicLink()) throw new Error('Playwright runtime target must be a real directory.');
    const children = readdirSync(target);
    if (children.includes('browsers')) {
      const browserInfo = lstatSync(join(target, 'browsers'));
      if (!browserInfo.isDirectory() || browserInfo.isSymbolicLink()) throw new Error('Playwright browser cache must be a real directory.');
    }
    for (const child of children) if (child !== 'browsers') rmSync(join(target, child), { recursive: true, force: true });
  } else {
    rmSync(target, { recursive: true, force: true });
  }
  mkdirSync(target, { recursive: true });
  if (source.type === 'npm') {
    if (typeof source.package !== 'string' || typeof source.version !== 'string' || typeof source.integrity !== 'string' || typeof source.bin !== 'string') throw new Error(`MCP runtime ${id} npm source is invalid.`);
    const temp = join(runtimeRoot, `.download-${id}`);
    rmSync(temp, { recursive: true, force: true }); mkdirSync(temp, { recursive: true });
    const packed = parseJson(run(npm.command, [...npm.prefixArgs, 'pack', `${source.package}@${source.version}`, '--pack-destination', temp, '--json'], { stdio: ['ignore', 'pipe', 'inherit'] }).stdout, `${id} npm pack`);
    const tarball = packed?.[0]?.filename ? join(temp, packed[0].filename) : undefined;
    if (!tarball || !existsSync(tarball) || `sha512-${digest(tarball)}` !== source.integrity) throw new Error(`MCP runtime ${id} npm integrity mismatch.`);
    const packageRoot = join(target, 'package'); mkdirSync(packageRoot, { recursive: true });
    run(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-xzf', tarball, '-C', packageRoot, '--strip-components=1']);
    // Install upstream dependencies in the isolated payload. The exact primary
    // tarball is integrity checked; lifecycle scripts stay disabled.
    run(npm.command, [...npm.prefixArgs, 'install', '--prefix', packageRoot, '--omit=dev', '--ignore-scripts', '--package-lock=false', '--no-audit', '--no-fund']);
    if (id === 'playwright') {
      // Match the browser to the pinned upstream Playwright release, at build
      // time. Installed NextMux never downloads browser code or needs Chrome.
      run(process.execPath, [join(packageRoot, 'node_modules/playwright/cli.js'), 'install', 'chromium', '--no-shell'], {
        env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: join(target, 'browsers') },
      });
    }
    const wrapper = `#!/usr/bin/env node\n'use strict';\nconst path = require('node:path');\nconst { spawn } = require('node:child_process');\nconst child = spawn(process.execPath, [path.join(__dirname, 'package', ${JSON.stringify(source.bin)}), ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });\nchild.once('exit', (code, signal) => { if (signal) process.kill(process.pid, signal); else process.exitCode = code ?? 1; });\nchild.once('error', error => { process.stderr.write(error.message + '\\n'); process.exitCode = 78; });\n`;
    writeFileSync(payload, wrapper, { mode: 0o755 });
    rmSync(temp, { recursive: true, force: true });
    console.log(`[NextMux MCP] prepared ${id} ${source.package}@${source.version}`);
  } else if (source.type === 'pypi') {
    // Python MCP servers require a matching embedded Python distribution. The
    // release runner must provide NEXTMUX_MCP_PYTHON_RUNTIME_DIR; unlike npm,
    // extracting a wheel alone cannot run on a fresh machine.
    const pythonRoot = process.env.NEXTMUX_MCP_PYTHON_RUNTIME_DIR;
    const pythonExecutable = process.env.NEXTMUX_MCP_PYTHON || (process.platform === 'win32' ? 'python.exe' : 'python3');
    if (!pythonRoot || !existsSync(pythonRoot) || typeof source.pythonModule !== 'string') throw new Error(`MCP runtime ${id} requires NEXTMUX_MCP_PYTHON_RUNTIME_DIR and pythonModule for the target architecture.`);
    const wheelDir = join(target, 'wheels'); mkdirSync(wheelDir, { recursive: true });
    run(pythonExecutable, ['-m', 'pip', 'download', '--only-binary=:all:', '--dest', wheelDir, `${source.package}==${source.version}`]);
    // pip also downloads dependencies. Verify the exact primary wheel recorded
    // in the manifest, never an arbitrary first dependency from the directory.
    await verifyPinnedPypiWheel(source, wheelDir);
    const packageDir = join(target, 'python-package'); mkdirSync(packageDir, { recursive: true });
    run(pythonExecutable, ['-m', 'pip', 'install', '--no-index', '--find-links', wheelDir, '--target', packageDir, `${source.package}==${source.version}`]);
    const packagedPython = join(runtimeRoot, 'python-runtime');
    rmSync(packagedPython, { recursive: true, force: true });
    (await import('node:fs')).cpSync(pythonRoot, packagedPython, { recursive: true });
    writePythonMcpLauncher(payload, source.pythonModule);
    console.log(`[NextMux MCP] prepared ${id} ${source.package}==${source.version}`);
  } else throw new Error(`MCP runtime ${id} has unsupported source type.`);
}
