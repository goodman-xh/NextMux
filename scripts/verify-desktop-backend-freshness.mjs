import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const repository = fileURLToPath(new URL('../', import.meta.url));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const criticalModules = ['nextmux-platform-service', 'nextmux-conversation-store', 'nextmux-agent-run-state-store'];
const parse = (name, text) => ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const visit = (node, predicate, found = []) => { if (predicate(node)) found.push(node); ts.forEachChild(node, child => { visit(child, predicate, found); }); return found; };

async function payloadReader(path) {
  const target = resolve(path);
  if ((await stat(target)).isDirectory()) return { read: file => readFile(join(target, file)), async has(file) {
    try { return (await stat(join(target, file))).isFile(); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  } };
  assert.ok(target.endsWith('.asar'), 'Payload must be an unpacked app directory or app.asar');
  const desktopRequire = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
  const builderRequire = createRequire(desktopRequire.resolve('electron-builder/package.json'));
  const asar = builderRequire('@electron/asar');
  const entries = new Set(asar.listPackage(target).map(path => path.replaceAll('\\', '/').replace(/^\//, '')));
  return { read: async file => asar.extractFile(target, file), has: async file => entries.has(file) };
}

function referencedSourceMap(text, file) {
  // Only an actual trailing JS directive links a runtime bundle to a map;
  // a string inside an embedded dependency is not a mapping directive.
  const trailer = text.slice(file.statements.at(-1)?.end || 0);
  const references = [...trailer.matchAll(/^\s*\/\/[#@]\s*sourceMappingURL=(\S+)\s*$/gm)];
  assert.ok(references.length <= 1, 'Ambiguous trailing source-map directives');
  return references[0]?.[1];
}

function storedFormatVersion(file, name) {
  const values = visit(file, node => ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && ts.isPropertyAccessExpression(node.left) && node.left.name.text === name && ts.isNumericLiteral(node.right));
  assert.equal(values.length, 1, `Missing or ambiguous compiled ${name}`);
  return Number(values[0].right.text);
}

function checkNullCursor(method, file, expected) {
  const cursor = method.parameters[1]?.name.getText(file), first = method.body?.statements[0];
  let expression = ts.isIfStatement(first) ? first.expression : ts.isExpressionStatement(first) ? first.expression : undefined;
  // esbuild may fold normalization and validation into one comma expression.
  while (expression && ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.CommaToken) expression = expression.left;
  assert.ok(expression && ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && expression.left.getText(file) === cursor, `${method.name.getText(file)} must normalize the cursor before validation`);
  const value = expression.right;
  assert.ok(ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    && value.left.getText(file) === cursor, 'Cursor must use nullish normalization, not a source-only marker');
  const fallback = value.right;
  assert.ok(expected === '' ? ts.isStringLiteral(fallback) && fallback.text === ''
    : ts.isVoidExpression(fallback) && ts.isNumericLiteral(fallback.expression) && fallback.expression.text === '0'
      || ts.isIdentifier(fallback) && fallback.text === 'undefined', 'Unexpected compiled cursor fallback');
  // Evaluate only the whitelisted nullish expression, never execute the application bundle.
  const normalize = new Function(cursor, `return (${value.getText(file)});`);
  assert.equal(normalize(null), expected); assert.equal(normalize(undefined), expected);
  assert.equal(normalize('cursor-value'), 'cursor-value'); assert.equal(normalize(''), '');
}

/** Read-only gate: source freshness plus exact bundle/map pairing against the current full build. */
export async function verifyDesktopBackendFreshness(payloadPath, { sourceRoot = repository, referenceDesktop = join(sourceRoot, 'apps/desktop') } = {}) {
  const reader = await payloadReader(payloadPath), readPayload = reader.read;
  const metadata = JSON.parse((await readPayload('package.json')).toString('utf8'));
  assert.equal(metadata.main, 'bootstrap.cjs', 'Actual package entry no longer points to the audited bootstrap');
  const bootstrap = await readPayload('bootstrap.cjs'), bootstrapFile = parse('bootstrap.cjs', bootstrap.toString('utf8'));
  assert.equal(sha256(bootstrap), sha256(await readFile(join(referenceDesktop, 'bootstrap.cjs'))), 'Packaged bootstrap is stale');
  assert.ok(bootstrapFile.statements.some(statement => ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)
    && statement.expression.expression.getText(bootstrapFile) === 'require'
    && statement.expression.arguments[0]?.text === './lib/backend/electron-main.js'), 'Bootstrap does not execute the expected backend entry');
  const artifacts = {}, maps = {}, parsed = {}, sourceMapModes = {};
  for (const name of ['electron-main', 'main']) {
    const path = `lib/backend/${name}.js`, actual = await readPayload(path), expected = await readFile(join(referenceDesktop, path));
    const digest = sha256(actual);
    assert.equal(digest, sha256(expected), `Stale or mismatched qualification artifact: ${path}`);
    artifacts[path] = digest; parsed[name] = parse(`${name}.js`, actual.toString('utf8'));
    const sourceMap = referencedSourceMap(actual.toString('utf8'), parsed[name]);
    const mapPath = `${path}.map`;
    if (!sourceMap) {
      assert.equal(await reader.has(mapPath), false, `Unreferenced backend source map must not ship: ${mapPath}`);
      sourceMapModes[name] = 'production-no-map';
      continue;
    }
    assert.equal(sourceMap, `${name}.js.map`, 'Unexpected runtime source-map target');
    const mapBytes = await readPayload(mapPath);
    artifacts[mapPath] = sha256(mapBytes);
    assert.equal(artifacts[mapPath], sha256(await readFile(join(referenceDesktop, mapPath))), `Stale or mismatched qualification artifact: ${mapPath}`);
    const map = JSON.parse(mapBytes.toString('utf8'));
    assert.equal(map.version, 3); assert.ok(Array.isArray(map.sources) && Array.isArray(map.sourcesContent) && map.sources.length === map.sourcesContent.length && map.mappings.length > 0, `Incomplete ${name} source map`);
    if (map.file) assert.equal(map.file.replaceAll('\\', '/').split('/').at(-1), `${name}.js`, 'Source map file points to another bundle');
    maps[name] = map; sourceMapModes[name] = 'linked-and-hash-paired';
  }
  const electron = parsed['electron-main'];
  const backendPaths = visit(electron, node => ts.isPropertyAssignment(node) && node.name.getText(electron) === 'THEIA_BACKEND_MAIN_PATH');
  assert.equal(backendPaths.length, 1, 'Ambiguous backend entry');
  const entry = backendPaths[0].initializer;
  assert.ok(ts.isCallExpression(entry) && entry.arguments.length === 2 && entry.arguments[0].getText(electron) === '__dirname'
    && entry.arguments[1].text === 'main.js', 'Electron entry does not start the audited main.js');
  const sourceHashes = {}, compiledInputHashes = {};
  for (const module of criticalModules) {
    const inputPath = `node_modules/@nextmux/theia-extension/lib/node/${module}.js`;
    const currentInput = await readFile(join(sourceRoot, `packages/theia-nextmux-extension/lib/node/${module}.js`));
    compiledInputHashes[inputPath] = sha256(await readPayload(inputPath));
    assert.equal(compiledInputHashes[inputPath], sha256(currentInput), `Packaged backend compiler input is stale: ${module}`);
    if (!maps.main) continue;
    const sourceCandidates = [`packages/theia-nextmux-extension/src/node/${module}.ts`, `packages/theia-nextmux-extension/lib/node/${module}.js`];
    let matched;
    for (const path of sourceCandidates) {
      const indexes = maps.main.sources.flatMap((source, index) => source.replaceAll('\\', '/').endsWith(`/${path}`) ? [index] : []);
      assert.ok(indexes.length <= 1, `Ambiguous embedded source: ${module}`);
      if (indexes.length) { matched = { path, content: maps.main.sourcesContent[indexes[0]] }; break; }
    }
    assert.ok(matched && typeof matched.content === 'string', `Required backend source missing from actual main.js.map: ${module}`);
    const digest = sha256(matched.content);
    assert.equal(digest, sha256(await readFile(join(sourceRoot, matched.path))), `Embedded backend source is stale: ${module}`);
    sourceHashes[matched.path] = digest;
  }
  const main = parsed.main;
  const required = ['getMerchantCatalog', 'getMerchantDiscoveredModels', 'deleteProjectConversationHistory', 'deleteProject', 'isDeletedSession'];
  const methods = new Map();
  for (const name of required) {
    const found = visit(main, node => ts.isMethodDeclaration(node) && node.name.getText(main) === name);
    assert.equal(found.length, 1, `Required compiled backend method missing or ambiguous: ${name}`); methods.set(name, found[0]);
  }
  checkNullCursor(methods.get('getMerchantCatalog'), main, undefined);
  checkNullCursor(methods.get('getMerchantDiscoveredModels'), main, '');
  assert.equal(methods.get('getMerchantCatalog').parent, methods.get('deleteProjectConversationHistory').parent, 'Project deletion and catalog RPC must belong to the same backend service');
  assert.equal(methods.get('deleteProject').parent, methods.get('isDeletedSession').parent, 'Deletion and tombstone guards must belong to the same store');
  const currentStore = parse('current-store.js', (await readFile(join(sourceRoot, 'packages/theia-nextmux-extension/lib/node/nextmux-conversation-store.js'))).toString('utf8'));
  const formatVersions = {};
  for (const name of ['CONVERSATION_STORE_WRITER_VERSION', 'CONVERSATION_STORE_READER_VERSION']) {
    formatVersions[name] = storedFormatVersion(main, name);
    assert.ok(formatVersions[name] >= 2, 'Runtime store must preserve permanent-deletion tombstones');
    assert.equal(formatVersions[name], storedFormatVersion(currentStore, name), `Runtime ${name} differs from the current compiler input`);
  }
  return { schemaVersion: 1, passed: true, scope: 'packaged-backend-vs-current-full-build', payload: resolve(payloadPath),
    entryChain: ['package.json:main', 'bootstrap.cjs', 'lib/backend/electron-main.js', 'lib/backend/main.js'],
    artifacts, artifactSetSha256: sha256(JSON.stringify(artifacts)), sourceMapModes, embeddedSourceSha256: sourceHashes, compiledInputSha256: compiledInputHashes, formatVersions,
    compiledNullCursorChecks: ['getMerchantCatalog', 'getMerchantDiscoveredModels'], nativeArtifactsModified: false };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const index = process.argv.indexOf('--payload'), path = process.argv[index + 1];
  assert.ok(index >= 0 && path && !path.startsWith('--'), '--payload requires an unpacked app directory or app.asar');
  console.log(JSON.stringify(await verifyDesktopBackendFreshness(path)));
}
