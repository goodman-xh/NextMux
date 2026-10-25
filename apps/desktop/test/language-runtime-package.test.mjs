import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, copyFile, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

if (process.platform === 'linux') process.env.NEXTMUX_PACKAGE_TARGET ||= 'darwin-x64';
const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('electron-builder/package.json'));
const { FileMatcher, getNodeModuleFileMatcher, excludedExts } = builderRequire('app-builder-lib/out/fileMatcher');
const { NodeModuleCopyHelper } = builderRequire('app-builder-lib/out/util/NodeModuleCopyHelper');
const { doMergeConfigs } = builderRequire('app-builder-lib/out/util/config/config');
const asar = builderRequire('@electron/asar');
const { build } = require('esbuild');
const config = require('../electron-builder.config.cjs');
const runtime = fileURLToPath(new URL('../../../packages/agent-runtime/lib/', import.meta.url));

test('production-minified language runtime uses genuinely collected WASM and separately shipped compiler declarations', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nm-language-package-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stage = join(root, 'stage'), appDir = join(root, 'app');
  await mkdir(stage); await mkdir(appDir);
  // electron-builder merges the configuration first, which turns `files` into one file set; the node_modules
  // matcher then honours its include patterns too (a raw string list would contribute only the excludes).
  const merged = doMergeConfigs([{ ...config, files: [...config.files], extraFiles: undefined, extraResources: undefined }]);
  const matcherRoot = getNodeModuleFileMatcher(appDir, stage, value => value, {}, { config: merged, debugLogger: { isEnabled: false } });
  for (const name of ['typescript', '@vscode/tree-sitter-wasm']) {
    const source = dirname(require.resolve(`${name}/package.json`)), destination = join(stage, 'node_modules', name);
    const matcher = new FileMatcher(source, destination, matcherRoot.macroExpander, matcherRoot.patterns);
    const copier = new NodeModuleCopyHelper(matcher, { config, appInfo: { type: 'commonjs' }, getWorkspaceRoot: async () => root });
    const files = await copier.collectNodeModules({ dir: source, name }, excludedExts.split(',').map(value => `.${value}`), `node_modules/${name}`);
    for (const file of files) { const output = join(destination, relative(source, file)); await mkdir(dirname(output), { recursive: true }); await copyFile(file, output); }
    if (name === 'typescript') assert.equal(files.some(file => file.endsWith('lib.es5.d.ts')), false, 'test exercises actual builder declaration exclusion');
    else for (const language of ['python', 'go', 'rust']) assert.ok(files.some(file => file.endsWith(`tree-sitter-${language}.wasm`)));
  }
  const resources = join(root, 'resources');
  const libraries = config.extraResources.find(item => item.to === 'language-runtime/typescript');
  assert.ok(libraries, 'all platforms ship compiler declarations');
  // Top-level resources apply to macOS too; listing them in the mac section again copied them twice.
  assert.equal([...config.extraResources, ...config.mac.extraResources].filter(item => item.to === libraries.to).length, 1, 'macOS ships the declarations once');
  const libraryTarget = join(resources, libraries.to);
  await mkdir(libraryTarget, { recursive: true });
  for (const name of await readdir(libraries.from)) if (/^lib.*\.d\.ts$/.test(name)) await copyFile(join(libraries.from, name), join(libraryTarget, name));
  const output = join(stage, 'runtime.cjs');
  await build({ stdin: { contents: `module.exports = { ...require(${JSON.stringify(join(runtime, 'workspace-diagnostics.js'))}), ...require(${JSON.stringify(join(runtime, 'workspace-project-map.js'))}) };`, resolveDir: root },
    outfile: output, platform: 'node', format: 'cjs', bundle: true, minify: true, external: ['typescript', '@vscode/tree-sitter-wasm'] });
  const workspace = join(root, 'workspace'); await mkdir(workspace);
  const script = join(stage, 'verify.cjs');
  await writeFile(script, `Object.defineProperty(process,'resourcesPath',{value:${JSON.stringify(resources)},configurable:true});
const {DefaultWorkspaceDiagnostics,parseProjectStructure}=require('./runtime.cjs');
(async()=>{const d=new DefaultWorkspaceDiagnostics(${JSON.stringify(workspace)});try {
const content='export const broken: number = "wrong";';
const result=await d.snapshot({path:'app.ts',content,sha256:require('node:crypto').createHash('sha256').update(content).digest('hex')});
const map=await parseProjectStructure('test.py','def actual():\\n    pass\\n',20);
console.log(JSON.stringify({result,map}));}finally{await d.dispose();}})().catch(error=>{console.error(error);process.exitCode=1;});`);
  const { stdout } = await promisify(execFile)(process.execPath, [script], { timeout: 10_000 });
  const result = JSON.parse(stdout);
  assert.equal(result.result.status, 'ready', stdout);
  assert.equal(result.result.errors[0].code, '2322');
  assert.equal(result.map.symbols[0].name, 'actual');
  assert.equal(result.map.parser, 'tree-sitter-wasm');
  // Exercise Electron's ASAR reads and worker environment, not only a loose development tree.
  const archive = join(root, 'language-runtime.asar');
  await asar.createPackage(stage, archive);
  const packaged = await promisify(execFile)(require('electron'), [join(archive, 'verify.cjs')], {
    timeout: 15_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  const packagedResult = JSON.parse(packaged.stdout);
  assert.equal(packagedResult.result.status, 'ready', packaged.stdout);
  assert.equal(packagedResult.result.errors[0].code, '2322');
  assert.equal(packagedResult.map.symbols[0].name, 'actual');
});
