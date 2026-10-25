#!/usr/bin/env node
// One-command local check before opening the app, publishing the source or
// sending a pull request.
//
//   node scripts/local-check.mjs            secrets, build, type checks, all tests
//   node scripts/local-check.mjs --quick    secrets, build, type checks, fast unit tests
//   node scripts/local-check.mjs --only=secrets,build
//
// Every step writes its full output to .nextmux-run/check-logs/<step>.log and
// the run ends with a summary table. The exit code is non-zero when any
// required step fails. Steps that need something this machine lacks (for
// example the Cloudflare platform folder) are reported as skipped.
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const quick = args.has('--quick');
const only = [...args].find(arg => arg.startsWith('--only='))?.slice(7).split(',').filter(Boolean);
const logDirectory = join(root, '.nextmux-run', 'check-logs');
const color = process.stdout.isTTY ? { green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', dim: '\x1b[2m', reset: '\x1b[0m' } : { green: '', red: '', yellow: '', dim: '', reset: '' };

function run(command, commandArgs, { cwd = root, log, env = {} } = {}) {
    return new Promise(resolvePromise => {
        const child = spawn(command, commandArgs, { cwd, env: { ...process.env, FORCE_COLOR: '0', ...env }, shell: process.platform === 'win32' });
        const out = createWriteStream(log, { flags: 'a' });
        out.write(`$ ${command} ${commandArgs.join(' ')}  (in ${cwd})\n`);
        child.stdout.pipe(out, { end: false }); child.stderr.pipe(out, { end: false });
        child.on('error', error => { out.end(`\n${error.message}\n`); resolvePromise(127); });
        child.on('close', code => { out.end(`\nexit ${code}\n`); resolvePromise(code ?? 1); });
    });
}

const have = async command => (await run(process.platform === 'win32' ? 'where' : 'which', [command], { log: join(logDirectory, 'which.log') })) === 0;
const pnpm = (...commandArgs) => ['pnpm', commandArgs];
const platformDirectory = join(root, 'apps', 'cloudflare-platform');

/** Ordered steps. `optional` failures are reported but do not fail the run. */
const steps = [
    { id: 'environment', title: 'Node.js 22+ and pnpm', run: async () => {
        const major = Number(process.versions.node.split('.')[0]);
        if (major < 22) return { ok: false, note: `Node.js ${process.versions.node}; 22 or newer is required` };
        if (!await have('pnpm')) return { ok: false, note: 'pnpm is not on PATH (corepack enable, or npm i -g pnpm)' };
        return { ok: true, note: `Node.js ${process.versions.node}` };
    } },
    { id: 'secrets', title: 'Secret scan (no keys, tokens or private keys in the tree)', run: async log => ({ ok: await run(process.execPath, [join(root, 'scripts', 'secret-scan.mjs'), root], { log }) === 0 }) },
    { id: 'install', title: 'Dependencies installed', run: async log => existsSync(join(root, 'node_modules'))
        ? { ok: true, note: 'node_modules present' }
        : { ok: await run(...pnpm('install', '--frozen-lockfile'), { log }) === 0 } },
    { id: 'build', title: 'Build runtime packages and the desktop extension', run: async log => ({ ok: await run(...pnpm('desktop:prepare'), { log }) === 0 }) },
    { id: 'typecheck', title: 'Type checks', run: async log => ({ ok: await run(...pnpm('-r', '--workspace-concurrency=2', 'typecheck'), { log }) === 0 }) },
    { id: 'runtime-tests', title: 'Agent and model runtime tests', run: async log => {
        const a = await run(...pnpm('--filter', '@nextmux/agent-runtime', 'test'), { log });
        const b = await run(...pnpm('--filter', '@nextmux/model-runtime', 'test'), { log });
        return { ok: a === 0 && b === 0 };
    } },
    { id: 'desktop-tests', title: quick ? 'Desktop unit tests (attachments, AGENTS.md, locale)' : 'Desktop extension tests', run: async log => {
        const directory = join(root, 'packages', 'theia-nextmux-extension');
        const files = quick
            ? ['test/composer-attachments.test.mjs', 'test/attachment-transfer-dom.test.mjs', 'test/change-review-restore.test.mjs', 'test/surface-locale.test.mjs']
            : ['test/*.test.mjs'];
        const code = await run(process.execPath, ['--test', '--test-concurrency=4', ...files], { cwd: directory, log });
        return { ok: code === 0 };
    }, optionalWhen: () => !quick, note: 'Failures are listed in the log; they do not block a local run. FFmpeg is bundled (@ffmpeg-installer, plus the Windows ARM64 build prepared at release), so media tests need nothing installed.' },
    { id: 'platform-tests', title: 'Platform (Cloudflare Worker) tests', run: async log => existsSync(platformDirectory)
        ? { ok: await run(process.execPath, ['--test', '--test-concurrency=4', 'test/*.test.mjs'], { cwd: platformDirectory, log }) === 0 }
        : { ok: true, skipped: true, note: 'apps/cloudflare-platform not present' }, skipWhen: () => quick }
];

await mkdir(logDirectory, { recursive: true });
const results = [];
const started = Date.now();
for (const step of steps) {
    if (only && !only.includes(step.id)) continue;
    if (step.skipWhen?.()) { results.push({ step, ok: true, skipped: true, ms: 0, note: 'skipped (--quick)' }); continue; }
    const log = join(logDirectory, `${step.id}.log`);
    if (process.stdout.isTTY) process.stdout.write(`${color.dim}…${color.reset} ${step.title}`);
    const at = Date.now();
    let outcome;
    try { outcome = await step.run(log); } catch (error) { outcome = { ok: false, note: error instanceof Error ? error.message : String(error) }; }
    const ms = Date.now() - at;
    const optional = Boolean(step.optionalWhen?.());
    results.push({ step, ...outcome, optional, ms });
    const mark = outcome.skipped ? `${color.yellow}–${color.reset}` : outcome.ok ? `${color.green}✓${color.reset}` : optional ? `${color.yellow}!${color.reset}` : `${color.red}✗${color.reset}`;
    process.stdout.write(`${process.stdout.isTTY ? '\r' : ''}${mark} ${step.title} ${color.dim}(${(ms / 1000).toFixed(1)}s)${color.reset}${outcome.note ? ` — ${outcome.note}` : ''}\n`);
    if (!outcome.ok && !optional && step.id === 'environment') break;
}
const failed = results.filter(result => !result.ok && !result.optional);
console.log(`\n${failed.length ? `${color.red}${failed.length} required check(s) failed` : `${color.green}All required checks passed`}${color.reset} in ${((Date.now() - started) / 1000).toFixed(0)}s.`);
for (const result of results.filter(item => !item.ok)) console.log(`  ${result.step.title}: see ${join('.nextmux-run', 'check-logs', `${result.step.id}.log`)}${result.optional && result.step.note ? ` (${result.step.note})` : ''}`);
process.exitCode = failed.length ? 1 : 0;
