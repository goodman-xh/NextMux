import assert from 'node:assert/strict';
import test from 'node:test';
import { builtinModules, createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = require('../electron-builder.config.cjs');
const { runtimeRoots, runtimePackages } = require('../electron-builder-targets.cjs');
const builder = createRequire(require.resolve('electron-builder/package.json'));
const { FileMatcher } = builder('app-builder-lib/out/fileMatcher');
const filter = new FileMatcher(desktop, '/output', value => value, config.files).createFilter();
const files = config.files.filter(value => typeof value === 'string' && /^[\w-]+\.cjs$/.test(value));
const builtins = new Set([...builtinModules, ...builtinModules.map(name => `node:${name}`), 'electron']);
const packages = new Set([...runtimeRoots, ...runtimePackages(desktop)]);
const packageName = specifier => specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];

function requests(file) {
  const source = ts.createSourceFile(file, readFileSync(join(desktop, file), 'utf8'), ts.ScriptTarget.Latest, true);
  const output = [];
  const visit = (node, functionDepth = 0) => {
    if (ts.isFunctionLike(node)) functionDepth++;
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(source);
      const loader = name === 'require' || name === 'require.resolve' || name === 'import' || name.startsWith('createRequire(');
      if (loader) {
        assert.ok(ts.isStringLiteral(node.arguments[0]), `${file}: dynamic loader needs an explicit packaging audit: ${node.getText(source)}`);
        output.push({ specifier: node.arguments[0].text, functionDepth });
      }
    }
    ts.forEachChild(node, child => visit(child, functionDepth));
  };
  visit(source);
  return output;
}

test('every unbundled shipped CJS loader has a builtin, shipped relative file or runtime package', () => {
  assert.ok(files.length >= 25);
  let count = 0;
  for (const file of files) for (const { specifier, functionDepth } of requests(file)) {
    count++;
    if (builtins.has(specifier)) continue;
    if (specifier === '@nextmux/theia-extension/package.json') {
      assert.equal(file, 'app-plugins.cjs');
      assert.ok(functionDepth > 0, 'the optional pnpm fallback must never resolve at module load');
      continue;
    }
    if (specifier.startsWith('.')) {
      const target = resolve(desktop, dirname(file), specifier);
      assert.ok(existsSync(target), `${file} needs ${specifier}`);
      assert.ok(filter(target, { isDirectory: () => false }), `${file}: ${specifier} is excluded from build.files`);
    } else assert.ok(packages.has(packageName(specifier)), `${file}: ${specifier} is not a runtime package`);
  }
  assert.ok(count >= 100, 'audit must enumerate real loader call expressions');
});

test('the real packaged ASAR contains the external packages used by shipped CJS files', t => {
  const archive = join(desktop, 'release/mac-arm64/NextMux.app/Contents/Resources/app.asar');
  if (!existsSync(archive)) return t.skip('mac-arm64 artifact is unavailable');
  const asar = builder('@electron/asar');
  const inventory = new Set(asar.listPackage(archive).map(name => name.replace(/^\//, '')));
  for (const file of files) for (const { specifier } of requests(file)) {
    if (builtins.has(specifier) || specifier.startsWith('.') || specifier === '@nextmux/theia-extension/package.json') continue;
    const name = packageName(specifier);
    assert.ok(inventory.has(`node_modules/${name}/package.json`), `ASAR lacks ${name}, required by ${file}`);
  }
  const runtime = JSON.parse(asar.extractFile(archive, 'node_modules/@nextmux/model-runtime/package.json'));
  const adapter = runtime.exports['./decision-adapter'].default;
  assert.ok(inventory.has(`node_modules/@nextmux/model-runtime/${adapter.replace(/^\.\//, '')}`));
});
