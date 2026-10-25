import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadCurrentSource } from './helpers/current-source-loader.mjs';

const { openFileManager } = loadCurrentSource(new URL('../src/node/nextmux-file-manager.ts', import.meta.url));

function fixture(platform, error = null, directory = true) {
    const calls = [];
    return { calls, options: { platform, env: { SYSTEMROOT: 'D:\\Windows' }, inspect: async () => ({ isDirectory: () => directory }),
        execute: (command, args, options, callback) => { calls.push({ command, args, options }); callback(error); } } };
}

test('Windows openDirectory (folder mode) and reveal preserve paths and explicitly use windowsHide: false', async () => {
    const fake = fixture('win32');
    const folder = 'C:\\Users\\测试用户\\My Project';
    const file = '\\\\server\\share\\folder, name\\文件.txt';
    assert.equal(await openFileManager(folder, 'folder', fake.options), true);
    assert.equal(await openFileManager(file, 'reveal', fake.options), true);
    assert.deepEqual(fake.calls.map(call => [call.command, call.args]), [
        ['D:\\Windows\\explorer.exe', [folder]], ['D:\\Windows\\explorer.exe', [`/select,${file}`]]
    ]);
    for (const call of fake.calls) assert.deepEqual(call.options, { timeout: 10_000, windowsHide: false });
});

test('Windows directory launch keeps Explorer visible for SystemRoot and default Windows paths', async () => {
    for (const [env, command] of [
        [{ SystemRoot: 'E:\\Windows', SYSTEMROOT: 'D:\\Windows' }, 'E:\\Windows\\explorer.exe'],
        [{}, 'C:\\Windows\\explorer.exe']
    ]) {
        const fake = fixture('win32');
        const folder = '\\\\server\\share\\项目, folder';
        assert.equal(await openFileManager(folder, 'folder', { ...fake.options, env }), true);
        assert.deepEqual(fake.calls, [{ command, args: [folder], options: { timeout: 10_000, windowsHide: false } }]);
    }
});

test('only Explorer exit code 1 is tolerated; spawn errors, failures and timeouts remain failures', async t => {
    for (const [name, error, expected] of [
        ['normal exit', null, true], ['Explorer handoff', { code: 1 }, true],
        ['missing Explorer', { code: 'ENOENT' }, false], ['access denied', { code: 'EACCES' }, false],
        ['different exit status', { code: 2 }, false], ['timeout', { code: 1, killed: true }, false],
        ['signal', { code: 1, signal: 'SIGTERM' }, false]
    ]) await t.test(name, async () => {
        const fake = fixture('win32', error && Object.assign(new Error(name), error));
        for (const mode of ['folder', 'reveal']) assert.equal(await openFileManager('C:\\项目', mode, fake.options), expected);
    });
});

test('macOS and Linux use their fixed file managers and report nonzero exits', async () => {
    for (const platform of ['darwin', 'linux']) {
        const fake = fixture(platform);
        assert.equal(await openFileManager('/Users/测试/My Project', 'folder', fake.options), true);
        assert.equal(await openFileManager('/Users/测试/My Project/file.txt', 'reveal', fake.options), true);
        assert.deepEqual(fake.calls.map(call => [call.command, call.args]), platform === 'darwin' ? [
            ['/usr/bin/open', ['/Users/测试/My Project']], ['/usr/bin/open', ['-R', '/Users/测试/My Project/file.txt']]
        ] : [
            ['xdg-open', ['/Users/测试/My Project']], ['xdg-open', ['/Users/测试/My Project']]
        ]);
        for (const call of fake.calls) assert.deepEqual(call.options, { timeout: 10_000, windowsHide: true });
        assert.equal(await openFileManager('/existing', 'folder', fixture(platform, Object.assign(new Error('failed'), { code: 1 })).options), false);
    }
});

test('invalid, missing and non-directory folder targets never invoke a file manager', async () => {
    const fake = fixture('win32');
    for (const path of ['', 'relative\\project', 'C:relative', 'C:\\invalid\0name', `C:\\${'x'.repeat(4097)}`]) {
        assert.equal(await openFileManager(path, 'folder', fake.options), false);
    }
    assert.equal(await openFileManager('C:\\missing', 'folder', { ...fake.options, inspect: async () => { throw new Error('ENOENT'); } }), false);
    const file = fixture('win32', null, false);
    assert.equal(await openFileManager('C:\\file.txt', 'folder', file.options), false);
    assert.equal(file.calls.length, 0);
    assert.equal(await openFileManager('C:\\file.txt', 'reveal', file.options), true);
    assert.equal(fake.calls.length, 0);
});

test('synchronous executable launch failure reports false and production service delegates both actions', async () => {
    const fake = fixture('win32');
    assert.equal(await openFileManager('C:\\existing', 'folder', { ...fake.options, execute: () => { throw new Error('spawn failure'); } }), false);
    const service = readFileSync(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
    assert.match(service, /async revealInFileManager\(path: string\): Promise<boolean>\s*\{\s*return openFileManager\(path, 'reveal'\)/);
    assert.match(service, /async openFolderInFileManager\(path: string\): Promise<boolean>\s*\{\s*return openFileManager\(path, 'folder'\)/);
});
