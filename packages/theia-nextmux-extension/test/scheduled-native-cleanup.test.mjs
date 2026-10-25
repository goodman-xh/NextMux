import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const schedule = require('../lib/common/nextmux-schedule');
const source = readFileSync(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
const file = ts.createSourceFile('service.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const klass = file.statements.find(node => ts.isClassDeclaration(node)
    && node.members.some(member => member.name?.getText(file) === 'registerDesktopScheduledTask'));
const methods = ['registerDesktopScheduledTask', 'removeDesktopScheduledTask'].map(name =>
    klass.members.find(node => node.name?.getText(file) === name).getText(file)).join('\n');
const systemSource = readFileSync(new URL('../src/node/nextmux-schedule-system.ts', import.meta.url), 'utf8');
const systemModule = { exports: {} };
new Function('require', 'module', 'exports', ts.transpile(systemSource, {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
}))(() => schedule, systemModule, systemModule.exports);

const taskId = 'c718a809-980e-4041-aa5a-2586dc3cf434';
const now = new Date('2030-09-23T10:00').getTime();
const future = { taskId, cadence: 'once', runAt: '2030-09-23T10:01', enabled: true };

// Run both production methods; only OS commands, clock, and files are replaced.
// A task is registered only by /Create or bootstrap and removed only by a
// successful /Delete or bootout. No real OS scheduler is touched.
function fixture(platform) {
    const files = new Map(), registered = new Set(), commands = [], writes = [];
    const failure = { command: undefined, unlink: false };
    class FixtureDate extends Date { static now() { return now; } }
    class FixtureError extends Error { constructor(code, message) { super(message); this.code = code; } }
    const dependencies = {
        process: { platform, getuid: () => 501, env: {}, execPath: platform === 'win32'
            ? 'C:\\Program Files\\NextMux\\NextMux.exe' : '/Applications/NextMux.app/Contents/MacOS/NextMux' },
        ...schedule, ...systemModule.exports, PlatformRequestError: FixtureError, join, Date: FixtureDate,
        homedir: () => '/test-home', userInfo: () => ({ username: 'qa' }), mkdir: async () => {},
        writeFile: async (path, body, options) => { files.set(path, body); writes.push({ path, body, options }); },
        unlink: async path => {
            if (failure.unlink) throw Object.assign(new Error('private filesystem detail'), { code: 'EACCES' });
            if (!files.delete(path)) throw Object.assign(new Error('absent'), { code: 'ENOENT' });
        },
        boundedCommand: async (command, args) => {
            commands.push({ command, args });
            const remove = args[0] === '/Delete' || args[0] === 'bootout';
            if (remove && failure.command === 'throw') throw new Error('private OS diagnostic');
            if (remove && failure.command === 'exit') return { exitCode: 1, stderr: 'private OS diagnostic' };
            if (remove) registered.delete(taskId);
            else if (args[0] === '/Create' || args[0] === 'bootstrap') registered.add(taskId);
            return { exitCode: 0, stderr: '' };
        },
        xmlText: value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    };
    const Harness = new Function(...Object.keys(dependencies), ts.transpile(`class Harness { ${methods} }; return Harness;`, {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    }))(...Object.values(dependencies));
    const service = new Harness();
    service.nextmuxDataRoot = () => '/test-data';
    const plist = join('/test-home', 'Library', 'LaunchAgents', `io.nextmux.scheduled.${taskId}.plist`);
    return { service, files, registered, commands, writes, failure, plist };
}

test('editing a future native once task to past or exactly due removes its old OS registration', async () => {
    for (const platform of ['darwin', 'win32']) for (const runAt of ['2030-09-23T09:59', '2030-09-23T10:00']) {
        const f = fixture(platform);
        assert.equal((await f.service.registerDesktopScheduledTask(future)).mode, 'system');
        assert.equal(f.registered.has(taskId), true);
        if (platform === 'darwin') assert.equal(f.files.has(f.plist), true);
        const writeCount = f.writes.length, commandCount = f.commands.length;
        assert.deepEqual(await f.service.registerDesktopScheduledTask({ ...future, runAt }), {
            registered: false, mode: 'app_open', message: '任务已到期，将在应用内立即检查',
        });
        assert.equal(f.registered.has(taskId), false);
        assert.equal(f.files.has(f.plist), false);
        assert.equal(f.writes.length, writeCount, 'overdue fallback must not write a new native definition');
        assert.deepEqual(f.commands.slice(commandCount).map(item => item.args[0]), [platform === 'darwin' ? 'bootout' : '/Delete']);
    }
});

test('unconfirmed OS removal preserves app-open fallback with an explicit safe warning', async () => {
    for (const platform of ['darwin', 'win32']) for (const commandFailure of ['exit', 'throw']) {
        const f = fixture(platform);
        await f.service.registerDesktopScheduledTask(future);
        const commandCount = f.commands.length;
        f.failure.command = commandFailure;
        const result = await f.service.registerDesktopScheduledTask({ ...future, runAt: '2030-09-23T10:00' });
        assert.deepEqual(result, {
            registered: false, mode: 'app_open', message: '任务已到期，将在应用内立即检查；旧系统计划移除未确认',
        });
        assert.equal(f.registered.has(taskId), true, 'failed OS removal is not treated as confirmed absence');
        assert.doesNotMatch(JSON.stringify(result), /private/);
        assert.deepEqual(f.commands.slice(commandCount).map(item => item.args[0]), [platform === 'darwin' ? 'bootout' : '/Delete']);
    }
});

test('macOS failed plist deletion is unconfirmed, while an already absent plist is acceptable after OS removal', async () => {
    for (const unlinkFailure of [false, true]) {
        const f = fixture('darwin');
        await f.service.registerDesktopScheduledTask(future);
        if (unlinkFailure) f.failure.unlink = true;
        else f.files.delete(f.plist);
        const result = await f.service.registerDesktopScheduledTask({ ...future, runAt: '2030-09-23T09:59' });
        assert.equal(result.registered, false); assert.equal(result.mode, 'app_open');
        assert.equal(result.message.includes('旧系统计划移除未确认'), unlinkFailure);
        assert.equal(f.registered.has(taskId), false);
        assert.equal(f.files.has(f.plist), unlinkFailure);
        assert.doesNotMatch(JSON.stringify(result), /private/);
    }
});

test('legacy explicit removal retains its idempotent public result on absent or failing OS tasks', async () => {
    for (const platform of ['darwin', 'win32']) {
        const f = fixture(platform);
        f.failure.command = 'exit';
        assert.deepEqual(await f.service.removeDesktopScheduledTask(taskId), { removed: true });
    }
});
