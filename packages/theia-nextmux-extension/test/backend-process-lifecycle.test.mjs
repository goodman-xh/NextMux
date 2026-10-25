import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const helperUrl = new URL('../src/electron-main/nextmux-backend-process-lifecycle.ts', import.meta.url);
const helperSource = readFileSync(helperUrl, 'utf8');
const helper = { exports: {} };
new Function('require', 'module', 'exports', ts.transpileModule(helperSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText)(require, helper, helper.exports);
const { backendRestartArguments, NextMuxBackendProcessLifecycle } = helper.exports;
const tick = () => new Promise(resolve => setImmediate(resolve));
async function flush() { for (let index = 0; index < 4; index += 1) await tick(); }

class Child extends EventEmitter {
    exitCode = null; signalCode = null; kills = 0;
    ready(port = 60175) { this.emit('message', { port, address: '127.0.0.1', family: 'IPv4' }); }
    exit(code = 7, signal = null) { this.exitCode = code; this.signalCode = signal; this.emit('exit', code, signal); }
    kill() { this.kills += 1; this.exit(null, 'SIGTERM'); return true; }
}
function fixture(options = {}) {
    const children = [], ports = [], failures = [];
    let now = 0;
    const lifecycle = new NextMuxBackendProcessLifecycle({
        fork: port => { const child = new Child(); children.push(child); ports.push(port); return child; },
        onFailure: failure => failures.push(failure), now: () => now, ...options
    });
    return { lifecycle, children, ports, failures, advance: value => { now += value; } };
}
async function readyInitial(value) {
    const started = value.lifecycle.start(); await flush(); value.children[0].ready();
    assert.equal(await started, 60175);
}

test('same-port restart replaces only port options, preserving all non-port and post-separator arguments', () => {
    const args = ['--workspace', '/fixture/project', '--port=0', '-p', '3100', '-p6000', '--hostname=127.0.0.1', '--', '-p', 'command-argument'];
    assert.deepEqual(backendRestartArguments(args), args);
    assert.notEqual(backendRestartArguments(args), args);
    assert.deepEqual(backendRestartArguments(args, 60175), ['--workspace', '/fixture/project', '--hostname=127.0.0.1', '--port=60175', '--', '-p', 'command-argument']);
    assert.equal(args[2], '--port=0');
    for (const port of [0, -1, 65536, NaN, 1.5]) assert.throws(() => backendRestartArguments(args, port));
});

test('readiness accepts a numeric bound port only and repeated start shares its original promise', async () => {
    const f = fixture(); const started = f.lifecycle.start(); assert.equal(f.lifecycle.start(), started); await flush();
    let settled = false; started.then(() => { settled = true; });
    for (const value of [null, [], {}, { port: '60175' }, { port: 0 }, { port: 65536 }, { port: NaN }]) f.children[0].emit('message', value);
    await flush(); assert.equal(settled, false);
    f.children[0].ready(); assert.equal(await started, 60175); assert.deepEqual(f.ports, [undefined]);
    f.lifecycle.dispose(); assert.equal(f.children[0].kills, 1); assert.equal(f.failures.length, 0);
});

test('pre-ready exit or spawn error rejects launch without a restart loop', async () => {
    for (const mode of ['exit', 'error']) {
        const f = fixture(); const rejected = assert.rejects(f.lifecycle.start()); await flush();
        if (mode === 'exit') f.children[0].exit(); else f.children[0].emit('error', new Error('fixture startup failure'));
        await rejected; await flush(); assert.equal(f.children.length, 1); assert.equal(f.failures.length, 0);
        f.children[0].emit('error', new Error('late fixture IPC error'));
        f.lifecycle.dispose();
    }
});

test('only a confirmed post-ready exit restarts on the same port, not IPC disconnect/error', async () => {
    const f = fixture(); await readyInitial(f);
    f.children[0].emit('disconnect'); f.children[0].emit('error', new Error('fixture IPC error')); await flush();
    assert.equal(f.children.length, 1, 'a live model backend is not killed or timed out');
    f.children[0].exit(7, 'SIGABRT'); await flush(); assert.equal(f.children.length, 2); assert.deepEqual(f.ports, [undefined, 60175]);
    f.children[1].ready(); await flush();
    f.children[0].emit('exit', 7, 'SIGABRT'); await flush(); assert.equal(f.children.length, 2, 'retired handle cannot launch another backend');
    f.lifecycle.dispose(); assert.equal(f.children[0].kills, 0); assert.equal(f.children[1].kills, 1); assert.equal(f.failures.length, 0);
});

test('an immediate crash burst stops after exactly two replacements and reports once', async () => {
    const f = fixture(); await readyInitial(f);
    for (let index = 0; index < 3; index += 1) {
        f.children[index].exit(); await flush();
        if (index < 2) { f.children[index + 1].ready(); await flush(); }
    }
    assert.equal(f.children.length, 3); assert.deepEqual(f.ports, [undefined, 60175, 60175]);
    assert.equal(f.failures.length, 1); assert.equal(f.failures[0].reason, 'restart_limit');
    f.children[2].emit('exit', 7, null); await flush(); assert.equal(f.failures.length, 1);
    f.lifecycle.dispose();
});

test('at least sixty seconds of ready continuous runtime resets the next crash burst', async () => {
    const f = fixture(); await readyInitial(f);
    for (let index = 0; index < 2; index += 1) { f.children[index].exit(); await flush(); f.children[index + 1].ready(); await flush(); }
    f.advance(60_000); f.children[2].exit(); await flush();
    assert.equal(f.children.length, 4, 'a later isolated crash remains recoverable');
    f.children[3].ready(); await flush(); assert.equal(f.failures.length, 0); f.lifecycle.dispose();
});

test('a replacement ready on another port is rejected and stopped rather than leaving the renderer stranded', async () => {
    const f = fixture(); await readyInitial(f); f.children[0].exit(); await flush();
    f.children[1].ready(60176); await flush();
    assert.equal(f.children[1].kills, 1); assert.equal(f.children.length, 2); assert.equal(f.failures.length, 1);
    assert.equal(f.failures[0].reason, 'restart_failed'); f.lifecycle.dispose();
});

test('a replacement that exits before it is ready is tried once more on the same port within the burst', async () => {
    const f = fixture(); await readyInitial(f);
    f.children[0].exit(); await flush();
    f.children[1].exit(); await flush();
    assert.equal(f.children.length, 2, 'the next try waits for its backoff');
    await delay(320); await flush();
    assert.equal(f.children.length, 3); assert.deepEqual(f.ports, [undefined, 60175, 60175]);
    f.children[2].ready(); await flush();
    assert.equal(f.failures.length, 0); f.lifecycle.dispose();
});

test('a replacement too slow to become ready is stopped and tried once more, then reported', async () => {
    const f = fixture({ startupTimeoutMs: 20 }); await readyInitial(f);
    f.children[0].exit(); await flush();
    await delay(420); await flush();
    assert.equal(f.children.length, 3); assert.deepEqual(f.ports, [undefined, 60175, 60175]);
    assert.deepEqual(f.children.slice(1).map(child => child.kills), [1, 1]);
    assert.equal(f.failures.length, 1); assert.equal(f.failures[0].reason, 'restart_failed');
    f.lifecycle.dispose();
});

test('quit before an asynchronous fork returns stops only that owned child and never restarts', async () => {
    let resolveFork; const child = new Child(), failures = [];
    const lifecycle = new NextMuxBackendProcessLifecycle({ fork: () => new Promise(resolve => { resolveFork = resolve; }), onFailure: f => failures.push(f) });
    const rejected = assert.rejects(lifecycle.start()); lifecycle.dispose(); resolveFork(child); await rejected; await flush();
    assert.equal(child.kills, 1); assert.equal(failures.length, 0); lifecycle.dispose(); assert.equal(child.kills, 1);
});

function applicationClass(processValue, appValue, forkValue, dialogValue) {
    const source = readFileSync(new URL('../src/electron-main/nextmux-electron-main-module.ts', import.meta.url), 'utf8');
    const file = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
    const method = file.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'NextMuxElectronMainApplication')
        .members.find(n => n.name?.getText(file) === 'startBackend').getText(file);
    const code = ts.transpile(`class Base { startBackend() { this.baseCalls=(this.baseCalls||0)+1; return Promise.resolve(3100); } }
        class Application extends Base { ${method} } return Application;`, { target: ts.ScriptTarget.ES2022 });
    return new Function('process', 'app', 'fork', 'dialog', 'backendRestartArguments', 'NextMuxBackendProcessLifecycle', code)(
        processValue, appValue, forkValue, dialogValue, backendRestartArguments, NextMuxBackendProcessLifecycle);
}

test('actual Electron override retains no-cluster and stops supervised forks only on final quit', async () => {
    const app = Object.assign(new EventEmitter(), { getLocale: () => 'zh-CN' });
    const children = [], launches = [], notices = [];
    const processValue = { argv: [], env: {}, versions: { electron: 'fixture-electron' } };
    const Application = applicationClass(processValue, app, (path, args, options) => {
        launches.push({ path, args, options }); const child = new Child(); children.push(child); return child;
    }, { showErrorBox: (...args) => notices.push(args) });
    const application = new Application();
    application.globals = { THEIA_BACKEND_MAIN_PATH: '/fixture/backend.js' };
    application.processArgv = { getProcessArgvWithoutBin: () => ['--port=0', '--fixture=owned'] };
    application.getForkOptions = async () => ({ detached: true, env: { THEIA_PARENT_PID: 'fixture-parent', token: 'fixture-only' } });
    const started = application.startBackend(); await flush(); children[0].ready(); assert.equal(await started, 60175);
    assert.equal(processValue.env.THEIA_ELECTRON_VERSION, 'fixture-electron');
    app.emit('before-quit', { preventDefault() {} }); assert.equal(children[0].kills, 0, 'a vetoed quit retains the backend');
    children[0].exit(); await flush(); children[1].ready(); await flush();
    assert.deepEqual(launches[1], { path: '/fixture/backend.js', args: ['--fixture=owned', '--port=60175'], options: launches[0].options });
    app.emit('quit'); await flush(); assert.equal(children[1].kills, 1); assert.equal(launches.length, 2); assert.equal(notices.length, 0);
    const noClusterProcess = { argv: ['--no-cluster'], env: {}, versions: {} };
    const NoCluster = applicationClass(noClusterProcess, app, () => { throw new Error('fork must not run'); }, {});
    const noCluster = new NoCluster(); assert.equal(await noCluster.startBackend(), 3100); assert.equal(noCluster.baseCalls, 1);
});

test('actual isolated HTTP backend exit restores the same endpoint without any application/task replay', { timeout: 10000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'nextmux-backend-exit-'));
    const file = join(directory, 'backend.cjs'); const children = [], failures = [];
    await writeFile(file, `const http=require('node:http');
        const value=process.argv.find(arg=>arg.startsWith('--port='));
        const port=value?Number(value.slice(7)):0;
        const server=http.createServer((_req,res)=>res.end(String(process.pid)));
        server.listen(port,'127.0.0.1',()=>process.send(server.address()));`);
    const lifecycle = new NextMuxBackendProcessLifecycle({ fork: port => {
        const child = fork(file, backendRestartArguments([], port), { env: {}, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
        children.push(child); return child;
    }, onFailure: failure => failures.push(failure) });
    t.after(async () => { lifecycle.dispose(); for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill(); await rm(directory, { recursive: true, force: true }); });
    const port = await lifecycle.start(), url = `http://127.0.0.1:${port}`;
    const initialPid = await (await fetch(url)).text(); assert.equal(initialPid, String(children[0].pid));
    children[0].kill('SIGKILL');
    let replacementPid;
    for (let attempt = 0; attempt < 40; attempt += 1) {
        await delay(50);
        try { const pid = await (await fetch(url, { signal: AbortSignal.timeout(500) })).text(); if (pid !== initialPid) { replacementPid = pid; break; } } catch { /* replacement has not listened yet */ }
    }
    assert.equal(children.length, 2); assert.equal(replacementPid, String(children[1].pid)); assert.equal(failures.length, 0);
});
