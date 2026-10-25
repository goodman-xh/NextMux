import assert from 'node:assert/strict';
import { createRequire, Module } from 'node:module';
import { readFile } from 'node:fs/promises';
import { mkdir, mkdtemp, readlink, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const desktopRequire = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const runtimeSource = fileURLToPath(new URL('../../agent-runtime/src/workspace-tools.ts', import.meta.url));
const registrySource = fileURLToPath(new URL('../../agent-runtime/src/registry.ts', import.meta.url));
// Compile current runtime source in memory. This never writes installed lib or application state.
const build = desktopRequire('esbuild').buildSync({ stdin: { contents: `export { WorkspaceToolRuntime } from ${JSON.stringify(runtimeSource)}; export { AgentToolRegistry } from ${JSON.stringify(registrySource)};`,
    resolveDir: dirname(runtimeSource), sourcefile: 'checkpoint-coverage-source.ts', loader: 'ts' },
    bundle: true, packages: 'external', platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
const runtimeModule = new Module(join(dirname(runtimeSource), 'checkpoint-coverage-source.cjs'));
runtimeModule.filename = join(dirname(runtimeSource), 'checkpoint-coverage-source.cjs');
runtimeModule.paths = Module._nodeModulePaths(dirname(runtimeSource));
runtimeModule._compile(build.outputFiles[0].text, runtimeModule.filename);
const { WorkspaceToolRuntime, AgentToolRegistry } = runtimeModule.exports;
const sessionSource = await readFile(new URL('../src/node/nextmux-incognito-sessions.ts', import.meta.url), 'utf8');
const sessionModule = { exports: {} };
Function('require', 'exports', ts.transpile(sessionSource, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }))(
    require, sessionModule.exports);
const { IncognitoSessions } = sessionModule.exports;
const structuralWarning = 'Folders, folder permissions or symbolic links changed; those changes cannot be restored from checkpoints';

for (const incognito of [false, true]) {
    test(`${incognito ? 'incognito' : 'ordinary'} checkpoints restore regular-file content and permissions while reporting structural exclusions`, { timeout: 20_000 }, async t => {
        const profile = await realpath(await mkdtemp(join(tmpdir(), 'nm-structure-coverage-')));
        const sessions = incognito ? new IncognitoSessions(profile) : undefined;
        const owned = sessions ? await sessions.create() : undefined;
        const workspaceRoot = owned?.workspaceRoot || join(profile, 'ordinary-project');
        if (!owned) await mkdir(workspaceRoot);
        const checkpointRoot = join(owned ? sessions.dataRoot(owned.id) : profile, 'agent-checkpoints', 'owned-workspace');
        const file = join(workspaceRoot, 'source.txt'), folder = join(workspaceRoot, 'folder');
        await writeFile(file, 'original', { mode: 0o640 });
        await mkdir(folder, { mode: 0o755 });
        const runtime = await WorkspaceToolRuntime.create({ workspaceRoot, checkpointRoot, permissionMode: 'full_access' });
        t.after(async () => { await runtime.dispose(); if (owned) await sessions.remove(owned.id); await rm(profile, { recursive: true, force: true }); });
        const registry = new AgentToolRegistry(); runtime.registerTools(registry);
        const runId = `structure-${randomUUID()}`;
        let sequence = 0;
        const execute = async (name, args) => {
            const result = await registry.execute({ id: `${runId}-${++sequence}`, name, arguments: args }, 'full_access', { runId });
            assert.equal(result.ok, true, JSON.stringify(result.error)); return result;
        };
        const script = `const fs=require('node:fs');fs.writeFileSync('source.txt','modified');fs.chmodSync('source.txt',0o600);fs.mkdirSync('empty');fs.chmodSync('folder',0o700);fs.symlinkSync('source.txt','python');setInterval(()=>{},1000);`;
        const started = await execute('process.start', { command: process.execPath, args: ['-e', script], tty: false });
        let ready = false;
        for (let count = 0; count < 200; count++) {
            try { if (await readlink(join(workspaceRoot, 'python')) === 'source.txt') { ready = true; break; } } catch { /* owned child is still starting */ }
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(ready, true, 'owned command must finish its writes');
        const stopped = await execute('process.terminate', { processId: started.output.processId });
        assert.equal(stopped.output.checkpointCoverage.complete, false);
        assert.ok(stopped.output.checkpointCoverage.warnings.includes(structuralWarning));
        assert.ok(stopped.output.checkpointCoverage.excluded.includes('empty/'));
        assert.ok(stopped.output.checkpointCoverage.excluded.includes('folder/'));
        assert.ok(stopped.output.checkpointCoverage.excluded.includes('python'));
        await runtime.restoreCheckpointChain([...stopped.summary.checkpointIds].reverse());
        assert.equal(await readFile(file, 'utf8'), 'original');
        assert.equal((await stat(file)).mode & 0o777, 0o640);
        assert.equal(await readlink(join(workspaceRoot, 'python')), 'source.txt');
        assert.equal((await stat(folder)).mode & 0o777, 0o700);
        assert.equal((await stat(join(workspaceRoot, 'empty'))).isDirectory(), true);
    });
}
