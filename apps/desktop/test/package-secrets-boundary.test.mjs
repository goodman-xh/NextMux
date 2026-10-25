import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, copyFile, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { finished } from 'node:stream/promises';
import test from 'node:test';

const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('electron-builder/package.json'));
const { FileMatcher, getNodeModuleFileMatcher } = builderRequire('app-builder-lib/out/fileMatcher');
const { NodeModuleCopyHelper } = builderRequire('app-builder-lib/out/util/NodeModuleCopyHelper');
const asar = builderRequire('@electron/asar');
const desktop = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const runtimePath = fileURLToPath(new URL('../../../packages/agent-runtime/runtime/citations.cjs', import.meta.url));
const forbidden = /(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|\.dev\.vars(?:\..*)?|windows-codex-backup)(?:\/|$)/;

test('real electron-builder dependency collector excludes credential files and preserves citation runtime in a new isolated ASAR', async t => {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-package-boundary-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const stage = join(root, 'stage'), appDir = join(root, 'app'), source = join(root, 'vendor');
    await mkdir(stage); await mkdir(appDir); await mkdir(source);
    const fixture = {
        'package.json': JSON.stringify({ name: '@nextmux/agent-runtime', version: '0.0.0-test', main: 'index.cjs' }),
        'index.cjs': 'module.exports = {};', 'LICENSE.txt': 'Synthetic fixture license',
        '.env': 'NPM_CONFIG_TOKEN=SYNTHETIC_NOT_A_REAL_CREDENTIAL', '.env.production': 'TEST_ONLY=synthetic',
        '.npmrc': '//registry.invalid/:_authToken=SYNTHETIC_NOT_A_REAL_CREDENTIAL',
        '.dev.vars': 'TEST_ONLY=synthetic', '.dev.vars.local': 'TEST_ONLY=synthetic',
        'nested/.env': 'TEST_ONLY=synthetic', 'windows-codex-backup/rollout-fixture.jsonl': 'synthetic private history',
        'runtime/citations.cjs': await readFile(runtimePath)
    };
    for (const [name, bytes] of Object.entries(fixture)) { const path = join(source, name); await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes); }
    const config = { ...desktop.build };
    const mainMatcher = getNodeModuleFileMatcher(appDir, stage, value => value, {}, { config, debugLogger: { isEnabled: false } });
    // This is the same per-dependency matcher and collector used by computeNodeModuleFileSets.
    const destination = join(stage, 'node_modules', '@nextmux', 'agent-runtime');
    const matcher = new FileMatcher(source, destination, mainMatcher.macroExpander, mainMatcher.patterns);
    const copier = new NodeModuleCopyHelper(matcher, { config, appInfo: { type: 'commonjs' }, getWorkspaceRoot: async () => root });
    const files = await copier.collectNodeModules({ dir: source, name: '@nextmux/agent-runtime' }, [], 'node_modules/@nextmux/agent-runtime');
    const names = files.map(path => relative(source, path).replaceAll('\\', '/'));
    assert.deepEqual(names.sort(), ['LICENSE.txt', 'index.cjs', 'package.json', 'runtime/citations.cjs']);
    for (const path of files) { const target = join(destination, relative(source, path)); await mkdir(dirname(target), { recursive: true }); await copyFile(path, target); }
    const artifact = join(root, 'isolated-package.asar');
    // asar 3.x resolves with its output stream after end(), before the queued
    // file bytes have necessarily reached disk. Verify only after it finishes.
    await finished(await asar.createPackage(stage, artifact));
    const entries = asar.listPackage(artifact);
    assert.equal(entries.some(path => forbidden.test(path)), false);
    assert.deepEqual(asar.extractFile(artifact, 'node_modules/@nextmux/agent-runtime/runtime/citations.cjs'), await readFile(runtimePath));
    assert.ok((await stat(artifact)).size > 0, 'verified a real newly written isolated archive');
});

test('app file rules also exclude nested environment and backup files, without dropping required JS or public licenses', async () => {
    const from = '/synthetic-nextmux-app';
    const matcher = new FileMatcher(from, '/synthetic-output', value => value, desktop.build.files).createFilter();
    const file = { isDirectory: () => false };
    for (const path of ['lib/.env', 'lib/nested/.env.production', 'lib/.npmrc', 'lib/.dev.vars', 'lib/windows-codex-backup/rollout.jsonl'])
        assert.equal(matcher(`${from}/${path}`, file), false, path);
    for (const path of ['bootstrap.cjs', 'package.json', 'lib/backend/main.js', 'lib/runtime/citations.cjs', 'lib/LICENSE.txt'])
        assert.equal(matcher(`${from}/${path}`, file), true, path);
});
