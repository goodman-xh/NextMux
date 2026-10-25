import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import ts from 'typescript';
import { createComicProject, applyComicCommand } from '@nextmux/comic-core';
const source = await readFile(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('service.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const names = new Set(['attachMediaCheckpoint', 'setMediaShotStatus', 'bestEffortMediaShotFailure']);
const methods = [];
(function visit(node) { if (ts.isMethodDeclaration(node) && names.has(node.name.getText(ast))) methods.push(node.getText(ast)); ts.forEachChild(node, visit); })(ast);
assert.equal(methods.length, names.size);
const code = ts.transpileModule(`import { mediaMessage } from ${JSON.stringify(new URL('../lib/common/nextmux-media-messages.js', import.meta.url).href)};
import { comicChatJobOrigin } from ${JSON.stringify(new URL('../lib/common/nextmux-comic-chat.js', import.meta.url).href)};
import { isCanvasStartFrameMediaJob } from ${JSON.stringify(new URL('../lib/node/nextmux-canvas-start-frame-service.js', import.meta.url).href)};
class PlatformRequestError extends Error { constructor(code,message) { super(message); this.code=code; } }
export class Harness { ${methods.join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { Harness } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
function fixture() {
  const h = new Harness();
  let project = createComicProject({ title: 'Set test', starter: 'storyboard' });
  const sceneId = project.scenes[0].id, shotId = project.scenes[0].shots[0].id;
  const image = { id: `asset-${randomUUID()}`, kind: 'image', uri: 'nextmux.media/original.png', mimeType: 'image/png', sha256: 'a'.repeat(64), byteLength: 42, jobId: `media-job-${randomUUID()}`, provider: 'mock', model: 'mock' };
  project = applyComicCommand(project, { type: 'media.attach', expectedRevision: project.revision, sceneId, shotId, slot: 'visual', asset: image });
  const writes = [];
  h.comicProjectStore = async () => ({ read: async () => ({ exists: true, project }), apply: async command => { writes.push(command); project = applyComicCommand(project, command); return { exists: true, project }; } });
  const job = { id: `media-job-${randomUUID()}`, projectId: project.id, sceneId, shotId, kind: 'image', input: { prompt: 'Empty room', comicSetPlate: true } };
  const output = { assetId: `asset-${randomUUID()}`, assetKind: 'image', relativeUri: 'nextmux.media/set.png', mimeType: 'image/png', byteLength: 100, sha256: 'b'.repeat(64), provider: 'mock', model: 'mock' };
  return { h, job, output, writes, current: () => project, replace: next => { project = next; } };
}

test('a set plate is a scene reference and leaves the first shot image/status unchanged', async () => {
  const { h, job, output, writes, current } = fixture();
  const shot = structuredClone(current().scenes[0].shots[0]);
  await h.attachMediaCheckpoint('/comic', job, output);
  assert.equal(current().scenes[0].setPlateAssetId, output.assetId);
  assert.deepEqual(current().scenes[0].shots[0], shot);
  assert.deepEqual(writes.map(command => command.type), ['asset.import', 'scene.update']);
  assert.equal(current().assets.find(asset => asset.id === output.assetId).kind, 'image');
});

test('replaying a completed set-plate checkpoint is idempotent', async () => {
  const { h, job, output, writes, current } = fixture();
  await h.attachMediaCheckpoint('/comic', job, output);
  const revision = current().revision;
  await h.attachMediaCheckpoint('/comic', job, output);
  assert.equal(current().revision, revision); assert.equal(writes.length, 2);
  assert.equal(current().assets.filter(asset => asset.id === output.assetId).length, 1);
});

test('set-plate generating/failure/cancellation never changes the shot status', async () => {
  const { h, job, current, writes } = fixture();
  const before = structuredClone(current());
  await h.setMediaShotStatus('/comic', job, 'generating');
  await h.setMediaShotStatus('/comic', job, 'failed');
  await h.bestEffortMediaShotFailure('/comic', job, false);
  await h.bestEffortMediaShotFailure('/comic', job, true);
  assert.equal(writes.length, 0); assert.deepEqual(current(), before);
  await h.setMediaShotStatus('/comic', { ...job, input: { prompt: 'ordinary first frame' } }, 'generating');
  assert.equal(current().scenes[0].shots[0].status, 'generating', 'normal image generation still updates the shot');
});

test('a replaced project is rejected before any plate asset is imported', async () => {
  const { h, job, output, writes } = fixture();
  await assert.rejects(h.attachMediaCheckpoint('/comic', { ...job, projectId: 'different' }, output), error => error.code === 'PROJECT_CHANGED');
  assert.equal(writes.length, 0);
});

test('a plate still attaches to its scene when the temporary first-shot target was deleted', async () => {
  const { h, job, output, current, replace } = fixture();
  replace({ ...current(), scenes: current().scenes.map(scene => ({ ...scene, shots: [] })) });
  await h.attachMediaCheckpoint('/comic', job, output);
  assert.equal(current().scenes[0].setPlateAssetId, output.assetId);
  assert.deepEqual(current().scenes[0].shots, []);
});

test('a conflicting checkpoint asset id cannot silently reuse different media', async () => {
  const { h, job, output, current, writes } = fixture();
  const occupied = current().assets[0];
  await assert.rejects(h.attachMediaCheckpoint('/comic', job, { ...output, assetId: occupied.id }), error => error.code === 'STALE_MEDIA_REQUEST');
  assert.equal(writes.length, 0);
  assert.equal(current().scenes[0].setPlateAssetId, undefined);
});


test('a plate chosen by the user while generation runs remains selected', async () => {
  const { h, job, output, current, replace } = fixture();
  const userAssetId = current().assets[0].id;
  replace({ ...current(), scenes: current().scenes.map(scene => ({ ...scene, setPlateAssetId: userAssetId })) });
  await h.attachMediaCheckpoint('/comic', job, output);
  assert.equal(current().scenes[0].setPlateAssetId, userAssetId);
  assert.ok(current().assets.some(asset => asset.id === output.assetId), 'generated image remains available as an alternate');
});
