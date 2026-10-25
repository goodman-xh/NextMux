import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { Module, createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const require = createRequire(import.meta.url), pkg = fileURLToPath(new URL('..', import.meta.url));
const ts = require('typescript'), ffmpeg = require('@ffmpeg-installer/ffmpeg').path;
const options = ts.convertCompilerOptionsFromJson(JSON.parse(readFileSync(join(pkg, 'tsconfig.json'), 'utf8')).compilerOptions, pkg).options;
const overrides = new Set(['node/nextmux-platform-service', 'node/nextmux-canvas-asset-import-store', 'common/nextmux-canvas-reference-attachment']);
const modules = new Map();
function current(relative) {
  if (modules.has(relative)) return modules.get(relative).exports;
  const filename = join(pkg, 'lib', `${relative}.js`), sourcePath = join(pkg, 'src', `${relative}.ts`);
  const module = new Module(filename); modules.set(relative, module);
  module.filename = filename; module.paths = Module._nodeModulePaths(dirname(filename));
  const native = module.require.bind(module);
  module.require = id => {
    // Resolve the three changed modules from source; all unrelated runtime modules use the normal build.
    const local = id.startsWith('.') ? join(dirname(relative), id).replace(/\.js$/, '') : '';
    return overrides.has(local) ? current(local) : native(id);
  };
  module._compile(ts.transpileModule(readFileSync(sourcePath, 'utf8'), { fileName: sourcePath, compilerOptions: options }).outputText, filename);
  return module.exports;
}
const { NextMuxPlatformServiceImpl } = current('node/nextmux-platform-service');
const { CanvasAssetImportStore } = current('node/nextmux-canvas-asset-import-store');
const { ComicCanvasStore } = require('../lib/node/nextmux-canvas-store');
const { ComicCanvasRegistryStore } = require('../lib/node/nextmux-canvas-registry-store');
const { createCanvasDocument } = require('@nextmux/comic-core');
const { attachCanvasReferenceVersion } = current('common/nextmux-canvas-reference-attachment');
function run(args) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], { timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr?.toString() || result.error?.message);
}
function gen(id, mode = 'imageToImage') {
  return { id, kind: mode === 'imageToImage' ? 'imageGen' : 'videoGen', title: id, position: { x: 0, y: 0 }, size: { width: 320, height: 240 },
    payload: { mode, modelId: 'test/reference-model', prompt: 'Preserve this prompt', parameters: {}, versions: [] } };
}

test('choosing a new inline first frame clears stale legacy continuity and repeated selection is a no-op', () => {
  const now = '2026-10-04T00:00:00.000Z';
  const old = { id: 'old-frame', assetId: 'old-asset', kind: 'image', uri: 'old.png', createdAt: now };
  const next = { ...old, id: 'new-frame', assetId: 'new-asset', uri: 'new.png' };
  const continuity = { version: 1, sourceNodeId: 'source-video', sourceVersionId: 'video-v1', sourceAssetId: 'video-a1', approvedAt: now,
    intent: 'continueAction', strategy: 'tailFrame', inputVersionId: old.id, inputAssetId: old.assetId, inputNodeId: 'old-node',
    boundary: { appearance: '', action: 'walk forward', camera: '', story: '' }, userPrompt: 'Continue walking' };
  const target = gen('target', 'imageToVideo');
  const canvas = { ...createCanvasDocument({ id: 'legacy-continuity', projectId: 'fixture', now }), nodes: [
    { ...target, payload: { ...target.payload, continuity } },
    { id: 'old-node', kind: 'image', title: 'Old frame', position: { x: 0, y: 0 }, size: { width: 320, height: 240 }, payload: { versions: [old], currentVersionId: old.id } }
  ], edges: [{ id: 'old-edge', sourceNodeId: 'old-node', sourcePort: 'output', targetNodeId: 'target', targetPort: 'firstFrame', role: 'firstFrame', order: 0, binding: 'pinnedVersion', pinnedVersionId: old.id }] };
  const updated = attachCanvasReferenceVersion(canvas, { nodeId: 'target', role: 'firstFrame' }, next, 'new-input', now);
  assert.equal(updated.nodes[0].payload.continuity, undefined);
  assert.equal(updated.nodes[0].payload.prompt, target.payload.prompt);
  assert.equal(updated.edges.length, 0); assert.equal(updated.nodes.length, canvas.nodes.length);
  const snapshot = require('@nextmux/comic-core/canvas').createGenerationSnapshot(updated, 'target', { capabilityVersion: 'fixture' });
  assert.equal(snapshot.resolvedInputs.find(input => input.role === 'firstFrame').versionId, next.id);
  assert.equal(attachCanvasReferenceVersion(updated, { nodeId: 'target', role: 'firstFrame' }, next, 'other-input', now), updated);
});

test('targeted file and library imports persist references without extra canvas nodes or wires', { timeout: 90_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'nextmux-reference-import-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const workspaceRoot = join(root, 'workspace'); await mkdir(workspaceRoot);
  class Service extends NextMuxPlatformServiceImpl {
    nextmuxDataRoot() { return join(root, 'profile'); }
    async getMediaRuntimeState() { return { ffmpeg: { available: true, path: ffmpeg, source: 'bundled', message: '' }, comfyUi: { configured: false, available: false, source: 'missing', message: '' } }; }
    canvasStore(path, canvasId) {
      const owner = this;
      return new class extends ComicCanvasStore {
        async writeDocument(...args) {
          if (owner.failCanvasWrite) { owner.failCanvasWrite = false; throw new Error('injected failure before canvas commit'); }
          return super.writeDocument(...args);
        }
      }(path, canvasId);
    }
  }
  const service = new Service(), imagePath = join(root, 'reference.png'), videoPath = join(root, 'reference.mp4');
  run(['-f', 'lavfi', '-i', 'color=c=red:s=64x64', '-frames:v', '1', '-y', imagePath]);
  run(['-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=24:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', videoPath]);
  const created = await service.createComicProject({ workspaceRoot, title: 'Reference imports', starter: 'empty' });
  const canvas = { ...createCanvasDocument({ id: 'canvas-reference-import', projectId: created.project.id }), nodes: [
    gen('image-target'), gen('frame-target', 'firstLastFrame'), gen('video-target', 'referenceToVideo'), gen('retry-target'),
  ] };
  await service.saveComicCanvas({ workspaceRoot, canvas, expectedRevision: 0 });
  const state = () => service.getComicCanvas(workspaceRoot);
  const project = async () => (await service.getComicProject(workspaceRoot)).project;
  const snapshot = async () => ({ canvas: await readFile(join(workspaceRoot, 'nextmux.canvas.json'), 'utf8'), project: await readFile(join(workspaceRoot, 'nextmux.comic.json'), 'utf8'),
    files: await readdir(join(workspaceRoot, 'nextmux.media/imports')).catch(() => []) });
  const reference = (result, id, role) => result.state.canvas.nodes.find(node => node.id === id).payload.inputs.find(input => input.role === role);
  const nodeCount = canvas.nodes.length;

  await t.test('real image upload goes straight into a reference and survives service reopen', async () => {
    const before = await state();
    const result = await service.importComicCanvasAsset({ workspaceRoot, expectedRevision: before.canvas.revision, path: imagePath, target: { nodeId: 'image-target', role: 'referenceImage' } });
    assert.equal(result.nodeId, 'image-target'); assert.equal(result.state.canvas.nodes.length, nodeCount); assert.equal(result.state.canvas.edges.length, 0);
    const input = reference(result, 'image-target', 'referenceImage');
    assert.equal(input.version.kind, 'image'); assert.equal(input.version.metadata.width, 64); assert.ok(input.version.metadata.sha256);
    assert.equal(result.state.canvas.nodes[0].payload.prompt, 'Preserve this prompt');
    assert.deepEqual((await new Service().getComicCanvas(workspaceRoot)).canvas, result.state.canvas);
    assert.deepEqual(await readFile(join(workspaceRoot, input.version.uri)), await readFile(imagePath));
  });
  await t.test('wrong file kind, missing target and malformed image reject without canvas/project/media mutation', async () => {
    const malformed = join(root, 'not-an-image.png'); await writeFile(malformed, await readFile(videoPath));
    for (const [path, target] of [[videoPath, { nodeId: 'image-target', role: 'referenceImage' }], [imagePath, { nodeId: 'absent-in-this-canvas', role: 'referenceImage' }], [malformed, { nodeId: 'retry-target', role: 'referenceImage' }]]) {
      const before = await snapshot();
      await assert.rejects(service.importComicCanvasAsset({ workspaceRoot, expectedRevision: (await state()).canvas.revision, path, target }));
      assert.deepEqual(await snapshot(), before);
    }
  });
  await t.test('first/last frame and video slots receive their exact typed reference', async () => {
    for (const [nodeId, role, path, kind] of [['frame-target', 'firstFrame', imagePath, 'image'], ['frame-target', 'lastFrame', imagePath, 'image'], ['video-target', 'referenceVideo', videoPath, 'video']]) {
      const result = await service.importComicCanvasAsset({ workspaceRoot, expectedRevision: (await state()).canvas.revision, path, target: { nodeId, role } });
      assert.equal(reference(result, nodeId, role).version.kind, kind);
      assert.equal(result.state.canvas.nodes.length, nodeCount); assert.equal(result.state.canvas.edges.length, 0);
    }
    assert.equal((await state()).canvas.nodes.find(node => node.id === 'frame-target').payload.mode, 'firstLastFrame');
  });
  const imageEntry = await service.saveComicLocalAssetToLibrary({ requestId: 'save-reference-image-1', path: imagePath });
  const videoEntry = await service.saveComicLocalAssetToLibrary({ requestId: 'save-reference-video-1', path: videoPath });
  let request, imported;
  await t.test('library wrong-kind target is rejected before importing any project asset', async () => {
    const before = await snapshot();
    await assert.rejects(service.importComicAssetLibraryAsset({ workspaceRoot, expectedRevision: (await state()).canvas.revision, requestId: 'wrong-kind-library-1', assetId: videoEntry.assetId,
      position: { x: 0, y: 0 }, target: { nodeId: 'retry-target', role: 'referenceImage' } }));
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('prepared journal retry reuses one imported media and attaches one input', async () => {
    request = { workspaceRoot, expectedRevision: (await state()).canvas.revision, requestId: 'retry-reference-import-1', assetId: imageEntry.assetId,
      position: { x: 0, y: 0 }, target: { nodeId: 'retry-target', role: 'referenceImage' } };
    const assetsBefore = (await project()).assets.length;
    service.failCanvasWrite = true;
    await assert.rejects(service.importComicAssetLibraryAsset(request), /injected failure/);
    assert.equal((await project()).assets.length, assetsBefore + 1);
    imported = await new Service().importComicAssetLibraryAsset(request);
    assert.equal(imported.nodeId, 'retry-target'); assert.equal(imported.state.canvas.nodes.length, nodeCount); assert.equal(imported.state.canvas.edges.length, 0);
    assert.equal((await project()).assets.length, assetsBefore + 1);
    assert.equal(imported.state.canvas.nodes.find(node => node.id === 'retry-target').payload.inputs.length, 1);
    assert.equal(reference(imported, 'retry-target', 'referenceImage').id, new CanvasAssetImportStore(workspaceRoot, request).nodeId);
  });
  await t.test('lost acknowledgement is idempotent and changed target/role conflicts', async () => {
    const again = await new Service().importComicAssetLibraryAsset(request);
    assert.deepEqual(again, imported);
    for (const target of [{ nodeId: 'image-target', role: 'referenceImage' }, { nodeId: 'retry-target', role: 'firstFrame' }])
      await assert.rejects(new Service().importComicAssetLibraryAsset({ ...request, target }), /REQUEST_CONFLICT/);
  });
  await t.test('a completed retry never recreates a reference deliberately removed later', async () => {
    const before = (await state()).canvas;
    await service.saveComicCanvas({ workspaceRoot, expectedRevision: before.revision, canvas: { ...before, nodes: before.nodes.map(node => node.id === 'retry-target' ? { ...node, payload: { ...node.payload, inputs: [] } } : node) } });
    const after = await new Service().importComicAssetLibraryAsset(request);
    assert.deepEqual(after.state.canvas.nodes.find(node => node.id === 'retry-target').payload.inputs, []);
  });
  await t.test('a lost completed-journal write recognizes the already persisted direct input', async () => {
    const request = { workspaceRoot, expectedRevision: (await state()).canvas.revision, requestId: 'lost-completed-reference-1', assetId: imageEntry.assetId,
      position: { x: 0, y: 0 }, target: { nodeId: 'retry-target', role: 'referenceImage' } };
    const assetsBefore = (await project()).assets.length, originalWrite = CanvasAssetImportStore.prototype.write;
    let failed = false;
    CanvasAssetImportStore.prototype.write = async function(record) {
      if (record.completed && !failed) { failed = true; throw new Error('injected completed journal write failure'); }
      return originalWrite.call(this, record);
    };
    try { await assert.rejects(service.importComicAssetLibraryAsset(request), /injected completed journal/); }
    finally { CanvasAssetImportStore.prototype.write = originalWrite; }
    const persisted = await state();
    assert.equal(persisted.canvas.nodes.find(node => node.id === 'retry-target').payload.inputs.length, 1);
    const recovered = await new Service().importComicAssetLibraryAsset(request);
    assert.deepEqual(recovered.state, persisted);
    assert.equal((await project()).assets.length, assetsBefore + 1);
  });
  await t.test('target ownership is checked against the requested canvas before media import', async () => {
    const registry = await new ComicCanvasRegistryStore(workspaceRoot).create(created.project.id, { title: 'Other canvas', mainCanvas: (await state()).canvas });
    const other = registry.canvases.find(entry => entry.kind === 'free');
    const otherBefore = await service.getComicCanvas(workspaceRoot, other.id), before = await snapshot();
    await assert.rejects(service.importComicCanvasAsset({ workspaceRoot, canvasId: other.id, expectedRevision: otherBefore.canvas.revision, path: imagePath, target: { nodeId: 'image-target', role: 'referenceImage' } }));
    assert.deepEqual(await snapshot(), before); assert.deepEqual(await service.getComicCanvas(workspaceRoot, other.id), otherBefore);
  });
  await t.test('ordinary uploads and library imports still add media nodes when target is omitted', async () => {
    const before = (await state()).canvas;
    const result = await service.importComicCanvasAsset({ workspaceRoot, expectedRevision: before.revision, path: imagePath, position: { x: 42, y: 56 } });
    assert.equal(result.state.canvas.nodes.length, nodeCount + 1); assert.deepEqual(result.state.canvas.nodes.at(-1).position, { x: 42, y: 56 });
    const library = await service.importComicAssetLibraryAsset({ workspaceRoot, expectedRevision: result.state.canvas.revision, requestId: 'ordinary-library-1', assetId: imageEntry.assetId, position: { x: 84, y: 96 } });
    assert.equal(library.state.canvas.nodes.length, nodeCount + 2); assert.equal(library.state.canvas.nodes.at(-1).id, library.nodeId);
  });
});
