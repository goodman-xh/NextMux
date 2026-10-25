import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { validScheduleTime } = require('../lib/common/nextmux-schedule');
// Load the current helper without rebuilding or disturbing a running acceptance session.
const systemSource = readFileSync(new URL('../src/node/nextmux-schedule-system.ts', import.meta.url), 'utf8');
const systemModule = { exports: {} };
new Function('require', 'module', 'exports', ts.transpile(systemSource, { target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS }))(() => ({ validScheduleTime }), systemModule, systemModule.exports);
const { macScheduledAppBundle } = systemModule.exports;

const source = readFileSync(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
const file = ts.createSourceFile('service.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const klass = file.statements.find(node => ts.isClassDeclaration(node)
    && node.members.some(member => member.name?.getText(file) === 'registerDesktopScheduledTask'));
const method = klass.members.find(node => node.name?.getText(file) === 'registerDesktopScheduledTask').getText(file);

function fixture(execPath, platform = 'darwin', failure = false, now = Date.now()) {
    const writes = [], commands = [], removals = [];
    class FixtureDate extends Date { static now() { return now; } }
    const dependencies = { process: { execPath, platform, getuid: () => 501 }, validScheduleTime,
        macScheduledAppBundle, PlatformRequestError: Error, join, Date: FixtureDate,
        homedir: () => '/test-home', mkdir: async () => {},
        writeFile: async (...args) => writes.push(args),
        boundedCommand: async (...args) => { commands.push(args); return { exitCode: failure ? 1 : 0, stderr: 'Failed' }; },
        xmlText: value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    };
    const Harness = new Function(...Object.keys(dependencies), ts.transpile(`class Harness { ${method} }; return Harness;`, {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    }))(...Object.values(dependencies));
    const service = new Harness();
    service.scheduledClock = () => ({ hour: 9, minute: 30 });
    service.removeDesktopScheduledTask = async id => { removals.push(id); return { removed: true }; };
    return { service, writes, commands, removals };
}
const request = { taskId: 'c718a809-980e-4041-aa5a-2586dc3cf434', cadence: 'daily', runAt: '09:30', enabled: true };

test('development Electron main and helper never register a broken background launch', async () => {
    for (const execPath of [
        '/project/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
        '/project/node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Helper.app/Contents/MacOS/Electron Helper',
        '/project/node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Helper (Renderer).app/Contents/MacOS/Electron Helper (Renderer)',
    ]) {
        const { service, writes, commands } = fixture(execPath);
        assert.equal(macScheduledAppBundle(execPath), undefined);
        assert.deepEqual(await service.registerDesktopScheduledTask(request), {
            registered: false, mode: 'app_open', message: '开发版本会在应用保持运行时执行计划',
        });
        assert.equal(writes.length, 0);
        assert.equal(commands.length, 0);
    }
});

test('packaged main and renamed or stock helpers register the outer application with launchd', async () => {
    const bundle = '/Applications/NextMux & QA.app';
    for (const inside of ['MacOS/NextMux', 'MacOS/Electron',
        'Frameworks/NextMux Helper.app/Contents/MacOS/NextMux Helper',
        'Frameworks/NextMux Helper (Renderer).app/Contents/MacOS/NextMux Helper (Renderer)',
        'Frameworks/Electron Helper.app/Contents/MacOS/Electron Helper']) {
        const { service, writes, commands } = fixture(`${bundle}/Contents/${inside}`);
        assert.equal((await service.registerDesktopScheduledTask(request)).mode, 'system');
        assert.equal(writes.length, 1);
        assert.match(writes[0][1], /<string>\/usr\/bin\/open<\/string><string>-g<\/string><string>-a<\/string><string>\/Applications\/NextMux &amp; QA.app<\/string>/);
        assert.doesNotMatch(writes[0][1], /Helper/);
        assert.match(writes[0][1], /<key>Hour<\/key><integer>9<\/integer><key>Minute<\/key><integer>30<\/integer>/);
        assert.deepEqual(commands.map(command => command[1][0]), ['bootout', 'bootstrap']);
    }
});

test('macOS system plist passes background launch arguments as distinct values to the real plist parser', { skip: process.platform !== 'darwin' }, async () => {
    const bundle = '/Applications/NextMux & QA.app';
    const { service, writes } = fixture(`${bundle}/Contents/MacOS/NextMux`);
    await service.registerDesktopScheduledTask(request);
    const values = JSON.parse(execFileSync('/usr/bin/plutil', ['-extract', 'ProgramArguments', 'json', '-o', '-', '-'], {
        input: writes[0][1], encoding: 'utf8'
    }));
    assert.deepEqual(values, ['/usr/bin/open', '-g', '-a', bundle, '--args', '--nextmux-scheduled']);
});

test('scheduled cold launch disables early focus and only its first ready window uses inactive display', () => {
    const nativeSource = readFileSync(new URL('../src/electron-main/nextmux-electron-main-module.ts', import.meta.url), 'utf8');
    const nativeFile = ts.createSourceFile('native.ts', nativeSource, ts.ScriptTarget.Latest, true);
    const methodText = (className, methodName) => nativeFile.statements
        .find(node => ts.isClassDeclaration(node) && node.name?.text === className).members
        .find(node => node.name?.getText(nativeFile) === methodName).getText(nativeFile);
    const ready = methodText('NextMuxElectronWindow', 'attachReadyToShow');
    const early = methodText('NextMuxElectronMainApplication', 'isShowWindowEarly');
    class FakeWindowBase {
        constructor() { this.window = new EventEmitter(); this.focused = 0; this.inactive = 0;
            this.window.showInactive = () => { this.inactive++; }; }
        attachReadyToShow() { this.window.once('ready-to-show', () => { this.focused++; }); }
    }
    class FakeAppBase { isShowWindowEarly() { return true; } }
    for (const scheduled of [true, false]) {
        const { Window, Application } = new Function('WindowBase', 'AppBase', 'process', ts.transpile(`
            let backgroundScheduledWindow = process.argv.includes('--nextmux-scheduled');
            class Window extends WindowBase { ${ready} }
            class Application extends AppBase { ${early} }
            return { Window, Application };`, { target: ts.ScriptTarget.ES2022 }))(
            FakeWindowBase, FakeAppBase, { argv: scheduled ? ['NextMux', '--nextmux-scheduled'] : ['NextMux'] });
        assert.equal(new Application().isShowWindowEarly(), !scheduled);
        const first = new Window(); first.attachReadyToShow(); first.window.emit('ready-to-show');
        assert.equal(first.focused, scheduled ? 0 : 1);
        assert.equal(first.inactive, scheduled ? 1 : 0);
        const userOpened = new Window(); userOpened.attachReadyToShow(); userOpened.window.emit('ready-to-show');
        assert.equal(userOpened.focused, 1, 'later user-created windows retain ordinary focus');
    }
    assert.match(nativeSource, /rebind\(ElectronMainApplication\)\.to\(NextMuxElectronMainApplication\)/);
});

test('a second launch only restores the one workbench window; scheduler wake-ups do nothing', async () => {
    const nativeSource = readFileSync(new URL('../src/electron-main/nextmux-electron-main-module.ts', import.meta.url), 'utf8');
    const nativeFile = ts.createSourceFile('native.ts', nativeSource, ts.ScriptTarget.Latest, true);
    const method = nativeFile.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxElectronMainApplication')
        .members.find(node => node.name?.getText(nativeFile) === 'onSecondInstance').getText(nativeFile);
    const calls = [];
    class Base { async onSecondInstance(...args) { calls.push(args); } }
    const showMainWindowKey = Symbol('show-main');
    const Harness = new Function('Base', 'app', 'showMainWindowKey', ts.transpile(`class Harness extends Base { ${method} }; return Harness;`, {
        target: ts.ScriptTarget.ES2022
    }))(Base, { [showMainWindowKey]: () => false }, showMainWindowKey);
    const app = new Harness();
    let focused = 0, existing = true;
    app.focusExistingWorkbenchWindow = () => { if (!existing) return undefined; focused++; return {}; };
    app.openUrl = async () => {};
    await app.onSecondInstance({}, ['NextMux', '--nextmux-scheduled'], '/work', ['NextMux']);
    await app.onSecondInstance({}, ['NextMux'], '/work', ['NextMux', '--nextmux-scheduled']);
    assert.equal(focused, 0, 'a scheduler wake-up neither focuses nor opens a window');
    assert.equal(calls.length, 0);
    // Desktop shortcut, Dock, taskbar or tray relaunches (with or without a path) restore the existing window.
    await app.onSecondInstance({}, ['NextMux'], '/work', ['NextMux']);
    await app.onSecondInstance({}, ['NextMux'], '/work', ['NextMux', '/requested-project']);
    assert.equal(focused, 2);
    assert.equal(calls.length, 0, 'Theia never creates a second workbench window');
    // Only when no workbench window exists at all may Theia create the single window.
    existing = false;
    await app.onSecondInstance({}, ['NextMux'], '/work', ['NextMux']);
    assert.equal(calls.length, 1);
});

test('a failed packaged OS registration keeps the app-running fallback', async () => {
    const { service } = fixture('/Applications/NextMux.app/Contents/Frameworks/NextMux Helper.app/Contents/MacOS/NextMux Helper', 'darwin', true);
    const result = await service.registerDesktopScheduledTask(request);
    assert.equal(result.registered, false);
    assert.equal(result.mode, 'app_open');
});

test('expired or exactly due one-shot registration never invents a future native trigger on either platform', async () => {
    const now = new Date('2030-09-23T10:00').getTime();
    for (const [execPath, platform] of [
        ['/Applications/NextMux.app/Contents/MacOS/NextMux', 'darwin'],
        ['/Applications/NextMux.app/Contents/Frameworks/NextMux Helper.app/Contents/MacOS/NextMux Helper', 'darwin'],
        ['C:\\Program Files\\NextMux\\NextMux.exe', 'win32'],
    ]) for (const runAt of ['2030-09-23T09:59', '2030-09-23T10:00']) {
        const { service, writes, commands, removals } = fixture(execPath, platform, false, now);
        assert.deepEqual(await service.registerDesktopScheduledTask({ ...request, cadence: 'once', runAt }), {
            registered: false, mode: 'app_open', message: '任务已到期，将在应用内立即检查',
        });
        assert.equal(writes.length, 0); assert.equal(commands.length, 0); assert.deepEqual(removals, [request.taskId]);
    }
});

test('a future macOS one-shot retains its native calendar registration and disabled cleanup', async () => {
    const f = fixture('/Applications/NextMux.app/Contents/MacOS/NextMux', 'darwin', false, new Date('2030-09-23T10:00').getTime());
    const future = { ...request, cadence: 'once', runAt: '2030-09-23T10:01' };
    assert.equal((await f.service.registerDesktopScheduledTask(future)).mode, 'system');
    assert.equal(f.writes.length, 1);
    assert.match(f.writes[0][1], /<key>Month<\/key><integer>9<\/integer><key>Day<\/key><integer>23<\/integer><key>Hour<\/key><integer>10<\/integer><key>Minute<\/key><integer>1<\/integer>/);
    assert.deepEqual(f.commands.map(command => command[1][0]), ['bootout', 'bootstrap']);
    assert.equal((await f.service.registerDesktopScheduledTask({ ...future, enabled: false })).registered, false);
    assert.deepEqual(f.removals, [request.taskId]); assert.equal(f.writes.length, 1); assert.equal(f.commands.length, 2);
});

test('plain Node, malformed bundles and unsupported platforms never claim background scheduling', async () => {
    for (const [execPath, platform] of [
        ['/opt/homebrew/bin/node', 'darwin'],
        ['/Applications/NextMux.app/Contents/Resources/node', 'darwin'],
        ['/Applications/NextMux.app/Contents/Resources/NextMux', 'darwin'],
        ['/opt/nextmux/nextmux', 'linux'],
        ['C:\\dev\\electron.exe', 'win32'],
    ]) {
        const { service, writes, commands } = fixture(execPath, platform);
        assert.equal((await service.registerDesktopScheduledTask(request)).mode, 'app_open');
        assert.equal(writes.length, 0);
        assert.equal(commands.length, 0);
    }
});
