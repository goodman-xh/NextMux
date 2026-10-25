import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const moduleUrl = new URL('../src/electron-main/nextmux-electron-main-module.ts', import.meta.url);
const upstreamUrl = require.resolve('@theia/core/src/electron-main/electron-main-application.ts');

function method(path, className, methodName) {
    const source = readFileSync(path, 'utf8');
    const file = ts.createSourceFile('application.ts', source, ts.ScriptTarget.Latest, true);
    return file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className)
        .members.find(node => node.name?.getText(file) === methodName).getText(file);
}

// Exercise the current application override and installed Theia implementation,
// without importing Electron or rebuilding the running desktop application.
const optionsSource = ts.transpile(`
    const NEXTMUX_PROXY_RESOLVER_PATH_ENV = 'NEXTMUX_PROXY_RESOLVER_PATH', NEXTMUX_PROXY_RESOLVER_TOKEN_ENV = 'NEXTMUX_PROXY_RESOLVER_TOKEN';
    const NEXTMUX_POWER_SAVE_PATH_ENV = 'NEXTMUX_POWER_SAVE_PATH', NEXTMUX_POWER_SAVE_TOKEN_ENV = 'NEXTMUX_POWER_SAVE_TOKEN';
    class Base { ${method(upstreamUrl, 'ElectronMainApplication', 'getForkOptions')} }
    class Application extends Base {
        startProxyResolver() { return Promise.resolve(globalThis.fixtureProxyResolver); }
        startPowerSaveBlocker() { return Promise.resolve(globalThis.fixturePowerSaveHost); }
        ${method(moduleUrl, 'NextMuxElectronMainApplication', 'getForkOptions')}
    }
    return Application;`, { target: ts.ScriptTarget.ES2022 });

test('desktop fork options bind the actual parent without changing Theia security or platform options', async () => {
    for (const platform of ['darwin', 'win32']) {
        const environment = { THEIA_PARENT_PID: 'stale-ancestor', preserved: 'fixture' };
        const Application = new Function('process', 'ElectronSecurityToken', optionsSource)(
            { pid: 12345, platform, env: environment }, 'test-electron-security-token');
        const application = new Application(); application.electronSecurityToken = { value: 'fixture' };
        const options = await application.getForkOptions();
        assert.equal(options.env.THEIA_PARENT_PID, '12345');
        assert.equal(options.detached, platform !== 'win32');
        assert.equal(options.env['test-electron-security-token'], JSON.stringify(application.electronSecurityToken));
        assert.equal(options.env.preserved, 'fixture');
        assert.equal(environment.THEIA_PARENT_PID, 'stale-ancestor', 'parent environment remains unchanged');
        assert.equal(options.env.NEXTMUX_PROXY_RESOLVER_PATH, undefined, 'no resolver env without a running host');
        assert.equal(options.env.NEXTMUX_POWER_SAVE_PATH, undefined, 'no power-save env without a running host');
        globalThis.fixtureProxyResolver = { path: '/private/resolver.sock', token: 'launch-token' };
        globalThis.fixturePowerSaveHost = { path: '/private/power.sock', token: 'power-token' };
        const withResolver = await new Application().getForkOptions.call(Object.assign(new Application(), { electronSecurityToken: { value: 'fixture' } }));
        delete globalThis.fixtureProxyResolver;
        delete globalThis.fixturePowerSaveHost;
        assert.equal(withResolver.env.NEXTMUX_PROXY_RESOLVER_PATH, '/private/resolver.sock', 'the backend learns the Chromium proxy resolver');
        assert.equal(withResolver.env.NEXTMUX_PROXY_RESOLVER_TOKEN, 'launch-token');
        assert.equal(withResolver.env.NEXTMUX_POWER_SAVE_PATH, '/private/power.sock', 'the backend learns the power-save lease channel');
        assert.equal(withResolver.env.NEXTMUX_POWER_SAVE_TOKEN, 'power-token');
        assert.equal(withResolver.env.THEIA_PARENT_PID, '12345');
    }
});

test('a detached backend using the real Theia watchdog exits after its fork parent is killed', { timeout: 20000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'nextmux-parent-watchdog-'));
    const parentPath = join(directory, 'parent.cjs'), backendPath = join(directory, 'backend.cjs');
    const exitPath = join(directory, 'backend-exit.json');
    let parent, backendPid;
    t.after(async () => {
        if (parent && parent.exitCode === null && parent.signalCode === null) parent.kill('SIGKILL');
        // This PID belongs exclusively to the fixture we just forked. An exit
        // receipt means it has already exited and must never be signalled again.
        if (backendPid) {
            try { await readFile(exitPath); } catch {
                try { process.kill(backendPid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
            }
        }
        await rm(directory, { recursive: true, force: true });
    });
    await writeFile(backendPath, `
        const fs = require('node:fs');
        require(${JSON.stringify(require.resolve('@theia/core/lib/node/main'))});
        process.on('exit', code => fs.writeFileSync(${JSON.stringify(exitPath)}, JSON.stringify({ code, pid: process.pid })));
        const server = require('node:http').createServer((_request, response) => response.end('fixture'));
        server.listen(0, '127.0.0.1', () => process.send({ pid: process.pid, parent: process.env.THEIA_PARENT_PID, port: server.address().port }));
    `);
    await writeFile(parentPath, `
        const Application = new Function('process', 'ElectronSecurityToken', ${JSON.stringify(optionsSource)})(process, 'test-electron-security-token');
        const app = new Application(); app.electronSecurityToken = { value: 'fixture' };
        app.getForkOptions().then(options => {
            const child = require('node:child_process').fork(${JSON.stringify(backendPath)}, ['--user-data-dir=' + ${JSON.stringify(join(directory, 'profile'))}],
                { ...options, cwd: ${JSON.stringify(directory)}, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
            child.on('message', value => process.send(value));
            child.on('error', error => { throw error; });
        });
    `);
    parent = fork(parentPath, [], { cwd: directory, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let errors = ''; parent.stderr.on('data', chunk => { errors += chunk; });
    const [ready] = await Promise.race([
        once(parent, 'message'),
        once(parent, 'exit').then(([code]) => { throw new Error(`Fixture parent exited early (${code}): ${errors}`); })
    ]);
    backendPid = ready.pid;
    assert.equal(ready.parent, String(parent.pid));
    const endpoint = `http://127.0.0.1:${ready.port}`;
    const response = await fetch(endpoint); assert.equal(await response.text(), 'fixture');
    const exited = once(parent, 'exit'); parent.kill('SIGKILL'); await exited;
    let receipt;
    for (let attempt = 0; attempt < 60; attempt++) {
        try { receipt = JSON.parse(await readFile(exitPath, 'utf8')); break; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        await delay(100);
    }
    assert.deepEqual(receipt, { code: 0, pid: backendPid }, 'Theia parent watchdog must exit the orphan within its five-second interval');
    // exit handlers run just before the OS releases the listening socket.
    await delay(100);
    await assert.rejects(fetch(endpoint, { signal: AbortSignal.timeout(1000) }));
});
