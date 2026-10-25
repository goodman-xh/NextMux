import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { browserSha256 } from '../lib/browser-sha256.js';
import { applyComicCommand, createComicProject } from '../lib/core.js';
import { parseComicProject, serializeComicProject } from '../lib/codec.js';
import { ComicProjectStore } from '../lib/store.js';
import { setProjectCharacterProfile } from '../lib/canvas-characters.js';

const now = '2026-09-30T00:00:00.000Z';
const require = createRequire(import.meta.url);
const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const modules = ['canvas-camera', 'canvas-batch-import', 'canvas-characters', 'canvas-character-generation', 'canvas-authoring'];

test('authoring subpaths resolve and execute using only browser globals and relative runtime dependencies', () => {
  const context = createContext({ TextEncoder, URL, crypto: globalThis.crypto });
  const cache = new Map<string, { exports: Record<string, any> }>();
  const load = (path: string): Record<string, any> => {
    const absolute = resolve(path);
    const cached = cache.get(absolute);
    if (cached) return cached.exports;
    const module = { exports: {} };
    cache.set(absolute, module);
    const code = readFileSync(absolute, 'utf8');
    const execute = runInContext(`(function(require, module, exports) { ${code}\n})`, context, { filename: absolute });
    execute((specifier: string) => {
      assert.ok(specifier.startsWith('./') || specifier.startsWith('../'), `${absolute} has a non-browser runtime dependency: ${specifier}`);
      return load(resolve(dirname(absolute), specifier));
    }, module, module.exports);
    return module.exports;
  };
  const publicApi = require('@nextmux/comic-core');
  for (const name of modules) {
    const path = require.resolve(`@nextmux/comic-core/${name}`);
    assert.equal(path, join(packageRoot, 'lib', `${name}.js`));
    const isolated = load(path);
    assert.ok(Object.keys(isolated).length > 0);
    for (const key of Object.keys(require(`@nextmux/comic-core/${name}`))) assert.ok(key in publicApi, `${name}.${key} is absent from the root public API`);
  }
  const authoring = load(require.resolve('@nextmux/comic-core/canvas-authoring'));
  assert.ok(authoring.createCameraSelection());
  assert.equal(authoring.splitBatchPrompts('one\n\ntwo').prompts.length, 2);
  const core = load(join(packageRoot, 'lib/core.js'));
  const project = core.createComicProject({ now, starter: 'empty' });
  assert.match(project.id, /^project-[a-f0-9-]{36}$/);
  const serialized = authoring.serializeCanvasCharacterProject(project);
  assert.equal(authoring.parseCanvasCharacterProject(serialized).id, project.id);
  assert.equal(typeof authoring.createShotCharacterGenerationSnapshot, 'function');
});

test('browser SHA-256 matches the original Node UTF-8 hash including multiblock and Unicode input', () => {
  for (const value of ['', 'abc', '角色档案🙂', '\ud800', 'x'.repeat(1000)]) {
    assert.equal(browserSha256(value), createHash('sha256').update(value).digest('hex'));
  }
});

test('browser-safe codec preserves exact legacy migration identifiers', () => {
  const legacy = { title: '旧项目🙂', frameRate: 24, scenes: [{ title: '旧场景', shots: [{ title: '旧镜头', dialogue: '你好' }] }] };
  const seed = createHash('sha256').update(JSON.stringify(legacy)).digest('hex');
  let counter = 0;
  const expected = (prefix: string): string => {
    const hash = createHash('sha256').update(`${seed}:${prefix}:${counter++}`).digest('hex');
    return `${prefix}-${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  };
  const migrated = parseComicProject(legacy, { now });
  assert.equal(migrated.migratedFrom, 0);
  assert.equal(migrated.project.id, expected('project'));
  assert.equal(migrated.project.scenes[0].id, expected('scene'));
  assert.equal(migrated.project.scenes[0].shots[0].id, expected('shot'));
  assert.equal(migrated.project.scenes[0].shots[0].dialogueCues[0].id, expected('dialogue'));
});

test('normal project load, comic command edits, saves and reloads retain canvas character profiles and history', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'canvas-character-save-'));
  const workspaceRoot = join(directory, 'workspace');
  const historyRoot = join(directory, 'history');
  try {
    await mkdir(workspaceRoot);
    const store = await ComicProjectStore.create({ workspaceRoot, historyRoot });
    const initialized = await store.initialize({ now, starter: 'storyboard' });
    let project = applyComicCommand(initialized.project!, { type: 'character.add', expectedRevision: initialized.project!.revision,
      character: { name: '林澈', appearance: '短黑发，左眼下小痣', identityVersion: 'source-v2' } }, { now });
    const characterId = project.characters[0].id;
    project = setProjectCharacterProfile(project, characterId, {
      canonicalVersion: 2, sourceIdentityVersion: 'source-v2', immutableTraits: project.characters[0].appearance,
      referenceViews: [], history: [], outfits: [{ id: 'coat', version: 1, label: '外套', description: '蓝色外套', refs: [], episodeNumbers: [2] }],
      providerBindings: [], voiceBindings: [],
    }, now);
    const expectedProfile = project.characters[0].canvasCharacter;
    await store.commitPrepared(initialized.project!.revision, project);
    const loaded = await store.read();
    assert.deepEqual(loaded.project!.characters[0].canvasCharacter, expectedProfile);
    const edited = await store.apply({ type: 'character.update', expectedRevision: loaded.project!.revision, characterId,
      patch: { name: '林澈改名', voice: '轻声' } }, { now });
    await store.apply({ type: 'project.update', expectedRevision: edited.project!.revision, patch: { title: '修改项目标题' } }, { now });
    const reloaded = await (await ComicProjectStore.create({ workspaceRoot, historyRoot })).read();
    assert.equal(reloaded.project!.characters[0].name, '林澈改名');
    assert.equal(reloaded.project!.title, '修改项目标题');
    assert.deepEqual(reloaded.project!.characters[0].canvasCharacter, expectedProfile);
    assert.deepEqual(parseComicProject(serializeComicProject(reloaded.project!)).project.characters[0].canvasCharacter, expectedProfile);
    const snapshots = (await readdir(historyRoot)).filter(name => name.endsWith('.json'));
    const preserved = await Promise.all(snapshots.map(async name => parseComicProject(await readFile(join(historyRoot, name), 'utf8')).project));
    assert.ok(preserved.some(snapshot => snapshot.characters[0]?.canvasCharacter?.canonicalVersion === 2));
    const path = join(workspaceRoot, 'nextmux.comic.json');
    const raw = JSON.parse(await readFile(path, 'utf8'));
    raw.characters[0].canvasCharacter.apiKey = 'must-not-be-retained';
    await writeFile(path, JSON.stringify(raw));
    const normalized = await store.read();
    assert.equal('apiKey' in normalized.project!.characters[0].canvasCharacter!, false);
    await store.apply({ type: 'project.update', expectedRevision: normalized.project!.revision, patch: { title: '再保存' } }, { now });
    assert.doesNotMatch(await readFile(path, 'utf8'), /must-not-be-retained/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
