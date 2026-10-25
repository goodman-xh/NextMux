import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import ts from 'typescript';
import test from 'node:test';

const text = await readFile(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
const sf = ts.createSourceFile('service.ts', text, ts.ScriptTarget.Latest, true);
const names = new Set(['startWorkspaceSite', 'stopWorkspaceSite', 'readSiteProject', 'desktopSiteSnapshot']);
const methods = []; let bounded;
const walk = node => {
    if (ts.isMethodDeclaration(node) && names.has(node.name?.getText(sf))) methods.push(node.getText(sf));
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'boundedCommand') bounded = node.getText(sf);
    ts.forEachChild(node, walk);
}; walk(sf);
assert.equal(methods.length, 4); assert.ok(bounded);
const javascript = ts.transpileModule(`${bounded}\nclass Fixture { desktopSites=new Map(); async workspaceDirectory(root){return root;} ${methods.join('\n')} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
class PlatformRequestError extends Error { constructor(code, message) { super(message); this.code = code; } }
function fixture(host, spawn) {
    return new Function('process', 'spawn', 'join', 'randomUUID', 'readFile', 'lstat', 'PlatformRequestError', 'desktopStatus', 'stripTerminalControl',
        `${javascript}; return new Fixture();`)(host, spawn, join, randomUUID, readFile, lstat, PlatformRequestError, code => ({ fallbackEnglish: code }), value => value);
}
async function root(t, manager) {
    const path = await mkdtemp(join(tmpdir(), 'nextmux-site-中文 空格-'));
    t.after(() => rm(path, { recursive: true, force: true }));
    await writeFile(join(path, 'package.json'), JSON.stringify({ packageManager: `${manager}@1.0`, scripts: { 'dev:web': 'never copied into the cmd command body & echo injected' } }));
    return path;
}
function fakeSpawn(calls) {
    return (command, args, options) => {
        calls.push({ command, args, options });
        const child = new EventEmitter(); child.pid = 2468; child.exitCode = null; child.stdout = new PassThrough(); child.stderr = new PassThrough();
        child.kill = () => { calls.push({ kill: true }); return true; };
        if (command === 'taskkill.exe') queueMicrotask(() => child.emit('close', 0));
        return child;
    };
}
for (const manager of ['npm', 'pnpm', 'yarn', 'bun']) test(`Windows ${manager} uses the validated command token through system cmd and stops its process tree`, async t => {
    const path = await root(t, manager), calls = [];
    const service = fixture({ platform: 'win32', env: { SystemRoot: 'C:\\Windows' } }, fakeSpawn(calls));
    const first = await service.startWorkspaceSite(path, 'dev:web');
    assert.equal(first.status, 'starting');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, join('C:\\Windows', 'System32', 'cmd.exe'));
    assert.deepEqual(calls[0].args, ['/d', '/s', '/c', `"${manager}.${manager === 'bun' ? 'exe' : 'cmd'} ${manager === 'yarn' ? '' : 'run '}dev:web"`]);
    assert.equal(calls[0].options.shell, false);
    assert.equal(calls[0].options.windowsVerbatimArguments, true);
    assert.equal(calls[0].options.cwd, path, 'workspace path is an option, never shell text');
    assert.equal(calls[0].options.env.BROWSER, 'none');
    assert.equal((await service.startWorkspaceSite(path, 'dev:web')).id, first.id, 'already running script is reused');
    for (const invalid of ['dev&whoami', 'dev|whoami', 'dev%PATH%', 'dev\nwhoami', 'dev"x', 'dev x'])
        await assert.rejects(service.startWorkspaceSite(path, invalid), { code: 'INVALID_SITE_SCRIPT' });
    assert.equal(calls.length, 1);
    assert.equal((await service.stopWorkspaceSite(path, first.id)).status, 'stopped');
    assert.deepEqual(calls[1].args, ['/PID', '2468', '/T', '/F']);
    assert.equal(calls[1].command, 'taskkill.exe');
});
test('macOS keeps literal executable / argv and SIGTERM behavior', async t => {
    const path = await root(t, 'npm'), calls = [];
    const service = fixture({ platform: 'darwin', env: {} }, fakeSpawn(calls));
    const first = await service.startWorkspaceSite(path, 'dev:web');
    assert.equal(calls[0].command, 'npm');
    assert.deepEqual(calls[0].args, ['run', 'dev:web']);
    assert.equal(calls[0].options.shell, false);
    assert.equal(calls[0].options.windowsVerbatimArguments, false);
    await service.stopWorkspaceSite(path, first.id); assert.ok(calls[1].kill);
});
