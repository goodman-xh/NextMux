import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { sourceModule } from './helpers/comic-organizer-source-loader.mjs';
import { analyzeComicScript, applyCanvasCommand, ComicProductionStore, createCanvasDocument, createComicProject, productionDocumentFromComicProject, serializeComicProject } from '@nextmux/comic-core';
import { MediaJobStore } from '@nextmux/media-core';
import { createCanvasTimeline, editCanvasTimeline, canvasTimelineProjectId } from '@nextmux/comic-core/canvas-timeline';

const { ComicOrganizerStore } = sourceModule('node/nextmux-comic-organizer-store.ts');
const { ComicCanvasRegistryStore } = sourceModule('node/nextmux-canvas-registry-store.ts');
const { ComicCanvasStore } = sourceModule('node/nextmux-canvas-store.ts');
const { ComicCanvasTimelineStore, timelineCreationIntent } = sourceModule('node/nextmux-canvas-timeline-store.ts');
const now = '2026-10-01T00:00:00.000Z';

async function fixture(t, title = '原项目') {
    const directory = await mkdtemp(join(tmpdir(), 'comic-organizer-store-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const library = join(directory, 'home'), root = join(directory, 'original');
    await mkdir(root); await mkdir(join(root, 'nextmux.media'));
    let project = createComicProject({ title, starter: 'storyboard', now });
    const asset = { id: 'asset-11111111-1111-4111-8111-111111111111', kind: 'image', source: 'imported', uri: 'nextmux.media/original.png', status: 'ready', createdAt: now, updatedAt: now };
    project = { ...project, assets: [asset], scenes: project.scenes.map(scene => ({ ...scene, shots: scene.shots.map(shot => ({ ...shot, visualAssetId: asset.id })) })) };
    await writeFile(join(root, 'nextmux.media/original.png'), 'original image bytes');
    await writeFile(join(root, 'nextmux.comic.json'), serializeComicProject(project));
    const main = createCanvasDocument({ id: 'canvas-legacy-main', projectId: project.id, title: '原主画布', now });
    const canvas = applyCanvasCommand(main, { type: 'node.add', node: { id: 'node-main-image', title: '图片', kind: 'image', position: { x: 10, y: 20 }, size: { width: 320, height: 240 },
        origin: { sceneId: project.scenes[0].id, shotId: project.scenes[0].shots[0].id }, payload: { versions: [{ id: 'version-main-image', assetId: asset.id, kind: 'image', uri: asset.uri, createdAt: now }], currentVersionId: 'version-main-image' } } });
    const saved = (await new ComicCanvasStore(root).save(canvas, 0, project.id)).canvas;
    return { directory, root, library, project, asset, main: saved, organizer: new ComicOrganizerStore(library), registry: new ComicCanvasRegistryStore(root) };
}

test('folder persistence shares one atomic home file, deletion only clears project membership', async t => {
    const f = await fixture(t), originalBytes = await readFile(join(f.root, 'nextmux.comic.json'), 'utf8');
    const created = await f.organizer.createFolder('  故事  '), folder = created.folders[0];
    assert.equal(folder.name, '故事');
    await f.organizer.patchProject(f.project, { folderId: folder.id, coverAssetId: f.asset.id });
    const renamed = await new ComicOrganizerStore(f.library).renameFolder(folder.id, '故事 2');
    assert.equal(renamed.folders[0].id, folder.id);
    const deleted = await f.organizer.deleteFolder(folder.id);
    assert.deepEqual(deleted.folders, []); assert.equal(deleted.projectMetadata[0].folderId, null);
    assert.equal(deleted.projectMetadata[0].coverAssetId, f.asset.id);
    assert.equal(await readFile(join(f.root, 'nextmux.comic.json'), 'utf8'), originalBytes);
    assert.equal(await readFile(join(f.root, f.asset.uri), 'utf8'), 'original image bytes');
    assert.deepEqual(await new ComicOrganizerStore(f.library).read(), deleted);
    assert.deepEqual((await readdir(f.library)).filter(name => /\.tmp$|\.lock$/.test(name)), []);
});

test('project meta uses the existing project commit and accepts only ready images owned by it', async t => {
    const f = await fixture(t); let committed;
    const updated = await f.organizer.patchProject(f.project, { title: ' 改名项目 ', coverAssetId: f.asset.id }, async project => { committed = project; await writeFile(join(f.root, 'nextmux.comic.json'), serializeComicProject(project)); });
    assert.equal(committed.title, '改名项目'); assert.equal(committed.revision, f.project.revision + 1);
    assert.equal(updated.metadata.coverAssetId, f.asset.id);
    await assert.rejects(f.organizer.patchProject(f.project, { coverAssetId: 'foreign-image' }), { code: 'INVALID_COVER' });
    await assert.rejects(f.organizer.patchProject({ ...f.project, assets: [{ ...f.asset, status: 'generating' }] }, { coverAssetId: f.asset.id }), { code: 'INVALID_COVER' });
    await assert.rejects(f.organizer.patchProject({ ...f.project, assets: [{ ...f.asset, kind: 'video' }] }, { coverAssetId: f.asset.id }), { code: 'INVALID_COVER' });
    assert.equal((await f.organizer.patchProject(updated.project, { coverAssetId: null })).metadata.coverAssetId, null);
});

test('concurrent organizers preserve every folder without lost writes', async t => {
    const f = await fixture(t);
    await Promise.all(Array.from({ length: 8 }, (_, index) => new ComicOrganizerStore(f.library).createFolder(`故事 ${index}`)));
    const read = await f.organizer.read(); assert.equal(read.folders.length, 8); assert.equal(read.revision, 8);
});

test('legacy main file stays byte-for-byte untouched by registry migration and explicit main lookup', async t => {
    const f = await fixture(t), original = await readFile(join(f.root, 'nextmux.canvas.json'), 'utf8');
    const registry = await f.registry.read(f.project.id);
    assert.equal(registry.mainCanvasId, f.main.id); assert.equal(registry.canvases[0].kind, 'main');
    assert.equal(await readFile(join(f.root, 'nextmux.canvas.json'), 'utf8'), original);
    assert.deepEqual((await new ComicCanvasStore(f.root, f.main.id).read()).canvas, f.main);
    assert.equal(await new ComicCanvasStore(f.root, f.main.id).storageDirectory(), await realpath(f.root));
});

test('free canvas documents have independent revision locks and close/reopen/order persist', async t => {
    const f = await fixture(t);
    const first = await f.registry.create(f.project.id, { title: '自由画布 1' }), a = first.canvases.at(-1).id;
    const second = await f.registry.create(f.project.id, { title: '自由画布 2' }), b = second.canvases.at(-1).id;
    const storeA = new ComicCanvasStore(f.root, a), storeB = new ComicCanvasStore(f.root, b), docA = (await storeA.read()).canvas;
    assert.equal(docA.revision, 1); assert.equal((await storeB.read()).canvas.revision, 1);
    const writes = await Promise.allSettled([storeA.save({ ...docA, viewport: { x: 55, y: 66, zoom: 2 } }, 1, f.project.id), new ComicCanvasStore(f.root, a).save({ ...docA, title: 'stale' }, 1, f.project.id)]);
    assert.equal(writes.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(writes.find(result => result.status === 'rejected').reason.code, 'CANVAS_REVISION_CONFLICT');
    assert.equal((await storeB.read()).canvas.revision, 1); assert.deepEqual((await new ComicCanvasStore(f.root).read()).canvas, f.main);
    const currentA = (await storeA.read()).canvas, currentB = (await storeB.read()).canvas;
    await Promise.all([storeA.save({ ...currentA, viewport: { x: 7, y: 8, zoom: 1 } }, currentA.revision, f.project.id),
        storeB.save({ ...currentB, viewport: { x: 9, y: 10, zoom: 1 } }, currentB.revision, f.project.id)]);
    assert.equal((await storeA.read()).canvas.viewport.x, 7); assert.equal((await storeB.read()).canvas.viewport.x, 9);
    await f.registry.rename(f.project.id, a, '改名自由画布'); assert.equal((await storeA.read()).canvas.title, '改名自由画布');
    await f.registry.setOpen(f.project.id, a, false); assert.equal((await f.registry.read(f.project.id)).canvases.find(entry => entry.id === a).isOpen, false);
    await f.registry.setOpen(f.project.id, a, true);
    const ordered = await f.registry.order(f.project.id, [b, a, f.main.id]); assert.deepEqual(ordered.canvases.map(entry => entry.id), [b, a, f.main.id]);
    await assert.rejects(f.registry.order(f.project.id, [a]), { code: 'INVALID_CANVAS_ORDER' });
});

test('canvas deletion requires native Trash, preserves main, and cancellation restores access', async t => {
    const f = await fixture(t), created = await f.registry.create(f.project.id, { title: '自由画布' }), id = created.canvases.at(-1).id;
    await assert.rejects(f.registry.prepareDelete(f.project.id, f.main.id), { code: 'MAIN_CANVAS_PROTECTED' });
    let exportChecks = 0;
    await assert.rejects(f.registry.prepareDelete(f.project.id, id, () => { exportChecks++; throw Object.assign(new Error('Export still running'), { code: 'CANVAS_JOBS_ACTIVE' }); }), { code: 'CANVAS_JOBS_ACTIVE' });
    assert.equal((await new ComicCanvasStore(f.root, id).read()).exists, true, 'denied export retirement leaves the source canvas accessible');
    assert.equal((await f.registry.read(f.project.id)).canvases.find(entry => entry.id === id).deletionPending, undefined);
    const prepared = await f.registry.prepareDelete(f.project.id, id, () => { exportChecks++; });
    assert.equal(exportChecks, 2);
    assert.equal(prepared.registry.canvases.find(entry => entry.id === id).deletionPending, true);
    await assert.rejects(new ComicCanvasStore(f.root, id).read(), { code: 'CANVAS_UNAVAILABLE' });
    await assert.rejects(f.registry.finalizeDelete(f.project.id, id), { code: 'CANVAS_TRASH_REQUIRED' });
    await f.registry.cancelDelete(f.project.id, id); assert.equal((await new ComicCanvasStore(f.root, id).read()).exists, true);
    const again = await f.registry.prepareDelete(f.project.id, id), trash = join(f.directory, 'native-trash');
    await rename(again.trashPath, trash);
    const final = await f.registry.finalizeDelete(f.project.id, id);
    assert.ok(final.canvases.find(entry => entry.id === id).deletedAt); assert.equal(final.canvases.find(entry => entry.id === id).isOpen, false);
    assert.deepEqual(await f.registry.finalizeDelete(f.project.id, id), final);
    assert.equal(JSON.parse(await readFile(join(trash, 'nextmux.canvas.json'), 'utf8')).id, id);
    assert.deepEqual((await new ComicCanvasStore(f.root).read()).canvas, f.main);
});

test('running local jobs block Trash preparation and cannot lose their owning canvas', async t => {
    const f = await fixture(t), created = await f.registry.create(f.project.id, { title: '运行画布' }), id = created.canvases.at(-1).id;
    const folder = await new ComicCanvasStore(f.root, id).storageDirectory();
    await writeFile(join(folder, 'nextmux.canvas.tools.jobs.json'), JSON.stringify([{ request: { requestId: 'local-job' }, job: { requestId: 'local-job', status: 'running' } }]));
    await assert.rejects(f.registry.prepareDelete(f.project.id, id), { code: 'CANVAS_JOBS_ACTIVE' });
    assert.equal((await new ComicCanvasStore(f.root, id).read()).exists, true);
    await writeFile(join(folder, 'nextmux.canvas.tools.jobs.json'), JSON.stringify([{ request: { requestId: 'local-job' }, job: { requestId: 'local-job', status: 'succeeded' } }]));
    assert.ok((await f.registry.prepareDelete(f.project.id, id)).trashPath);
    await f.registry.cancelDelete(f.project.id, id);
    await writeFile(join(folder, 'nextmux.canvas.tools.jobs.json'), JSON.stringify([{ request: { requestId: 'local-job' }, job: { requestId: 'local-job', status: 'interrupted' } }]));
    assert.ok((await f.registry.prepareDelete(f.project.id, id)).trashPath, 'restored interrupted local processing cannot resume and must not permanently block Trash');
});

test('a media job finishing while main is edited writes only its free canvas journal and result', async t => {
    const f = await fixture(t), created = await f.registry.create(f.project.id, { title: '后台画布' }), id = created.canvases.at(-1).id;
    const store = new ComicCanvasStore(f.root, id), empty = (await store.read()).canvas;
    const node = { id: 'node-background', title: '后台图片', kind: 'imageGen', position: { x: 0, y: 0 }, size: { width: 320, height: 240 },
        payload: { mode: 'textToImage', modelId: 'fixture-model', prompt: 'frozen', parameters: {}, versions: [] } };
    const saved = (await store.save(applyCanvasCommand(empty, { type: 'node.add', node }), empty.revision, f.project.id)).canvas;
    const snapshot = { mode: 'textToImage', modelId: 'fixture-model', capabilityVersion: 'fixture-v1', prompt: 'frozen', parameters: {}, resolvedInputs: [], inputFingerprint: 'fingerprint' };
    const request = { idempotencyKey: 'canvas-background-idempotency', kind: 'image', projectId: f.project.id, sceneId: f.project.scenes[0].id, shotId: f.project.scenes[0].shots[0].id,
        input: { connectionId: 'official-00000000-0000-4000-8000-000000000001', model: 'fixture-model', prompt: 'frozen', width: 1024, height: 1024 },
        cost: { billing: 'provider_billed', description: 'Fixture cost' } };
    await store.reserve({ nodeId: node.id, idempotencyKey: 'click-background', snapshot, request, expectedRevision: saved.revision });
    await assert.rejects(f.registry.prepareDelete(f.project.id, id), { code: 'CANVAS_JOBS_ACTIVE' });
    const queue = await MediaJobStore.create({ root: join(f.directory, 'queue') }), queued = await queue.enqueue(request);
    await store.recordJob(queued);
    const mainStore = new ComicCanvasStore(f.root), activeMain = (await mainStore.read()).canvas;
    const editedMain = (await mainStore.save({ ...activeMain, viewport: { x: 50, y: 60, zoom: 2 } }, activeMain.revision, f.project.id)).canvas;
    const version = { id: 'version-background-result', assetId: 'asset-background-result', kind: 'image', uri: f.asset.uri, createdAt: new Date().toISOString(), snapshot };
    const finished = await new ComicCanvasStore(f.root, id).recordJob({ ...queued, status: 'succeeded', updatedAt: new Date().toISOString() }, version);
    assert.equal(finished.canvasId, id); assert.match(finished.fileName, new RegExp(`^nextmux\\.canvases/${id}/nextmux\\.canvas\\.json$`));
    assert.equal(finished.canvas.nodes[0].payload.currentVersionId, version.id); assert.equal(finished.jobs[0].status, 'succeeded');
    const main = await mainStore.read(); assert.deepEqual(main.canvas, editedMain); assert.deepEqual(main.jobs, []);
    const journal = JSON.parse(await readFile(join(await store.storageDirectory(), 'nextmux.canvas.jobs.json'), 'utf8'));
    assert.equal(journal[0].request.idempotencyKey, request.idempotencyKey);
});

test('duplicate copies media bytes, remaps the whole project, and retains free canvas order/closed tabs', async t => {
    const f = await fixture(t), folders = await f.organizer.createFolder('项目集');
    await f.organizer.patchProject(f.project, { folderId: folders.folders[0].id, coverAssetId: f.asset.id });
    const first = await f.registry.create(f.project.id, { title: '自由 1' }), a = first.canvases.at(-1).id;
    const second = await f.registry.create(f.project.id, { title: '自由 2' }), b = second.canvases.at(-1).id;
    await f.registry.setOpen(f.project.id, a, false); await f.registry.order(f.project.id, [b, a, f.main.id]);
    const duplicate = await f.organizer.duplicate(f.root, { title: '副本' });
    assert.notEqual(duplicate.project.id, f.project.id); assert.equal(duplicate.project.title, '副本'); assert.equal(duplicate.assetsCopied, 1); assert.equal(duplicate.canvasesCopied, 3);
    assert.notEqual(duplicate.project.assets[0].id, f.asset.id); assert.notEqual(duplicate.project.scenes[0].id, f.project.scenes[0].id);
    assert.notEqual(duplicate.project.scenes[0].shots[0].id, f.project.scenes[0].shots[0].id);
    assert.equal(duplicate.project.scenes[0].shots[0].visualAssetId, duplicate.project.assets[0].id);
    const copiedMain = (await new ComicCanvasStore(duplicate.path).read()).canvas;
    assert.notEqual(copiedMain.id, f.main.id); assert.equal(copiedMain.projectId, duplicate.project.id);
    assert.equal(copiedMain.nodes[0].origin.shotId, duplicate.project.scenes[0].shots[0].id);
    assert.equal(copiedMain.nodes[0].payload.versions[0].uri, duplicate.project.assets[0].uri);
    const copiedRegistry = await new ComicCanvasRegistryStore(duplicate.path).read(duplicate.project.id);
    assert.deepEqual(copiedRegistry.canvases.map(entry => [entry.title, entry.isOpen]), [['自由 2', true], ['自由 1', false], ['原主画布', true]]);
    for (const entry of copiedRegistry.canvases) assert.equal((await new ComicCanvasStore(duplicate.path, entry.id).read()).jobs.length, 0);
    const metadata = (await f.organizer.read()).projectMetadata.find(item => item.projectId === duplicate.project.id);
    assert.equal(metadata.folderId, folders.folders[0].id); assert.equal(metadata.coverAssetId, duplicate.project.assets[0].id);
    await rename(f.root, join(f.directory, 'original-in-trash'));
    assert.equal(await readFile(join(duplicate.path, duplicate.project.assets[0].uri), 'utf8'), 'original image bytes');
    assert.equal((await new ComicCanvasStore(duplicate.path).read()).canvas.nodes[0].payload.versions[0].assetId, duplicate.project.assets[0].id);
});

test('duplicate rejects ready missing or symlink media and exposes no partial project', async t => {
    const f = await fixture(t);
    await rm(join(f.root, f.asset.uri));
    await assert.rejects(f.organizer.duplicate(f.root, { title: 'missing-copy' }), { code: 'COMIC_ASSET_MISSING' });
    assert.deepEqual((await readdir(f.library)).filter(name => !name.startsWith('.')), []);
    await writeFile(join(f.directory, 'outside.png'), 'outside image'); await symlink(join(f.directory, 'outside.png'), join(f.root, f.asset.uri));
    await assert.rejects(f.organizer.duplicate(f.root, { title: 'symlink-copy' }), { code: 'COMIC_ASSET_INVALID' });
    assert.deepEqual((await readdir(f.library)).filter(name => !name.startsWith('.')), []);
});

test('duplicate preserves source screenplay and analysis while its production IDs and render ownership are independent', async t => {
    const f = await fixture(t), text = '第1集 城市\n地铁站。主角走出雨夜。';
    const script = { text, language: 'zh-CN', version: 7, updatedAt: now, source: 'imported' }, analysis = analyzeComicScript(text, now);
    const sidecar = productionDocumentFromComicProject(f.project, { script, scriptAnalysis: analysis });
    await (await ComicProductionStore.create({ workspaceRoot: f.root })).write(sidecar);
    const result = await f.organizer.duplicate(f.root, { title: '剧本副本' });
    const copied = (await (await ComicProductionStore.create({ workspaceRoot: result.path })).read()).document;
    assert.deepEqual(copied.script, script); assert.deepEqual(copied.scriptAnalysis, analysis);
    assert.notEqual(copied.id, sidecar.id); assert.equal(copied.projectId, result.project.id);
    assert.deepEqual(copied.renderJobs, []); assert.deepEqual(copied.providerProfiles, []);
    assert.equal(copied.shots[0].id, result.project.scenes[0].shots[0].id);
    const reservedWordScript = { ...script, text: 'constructor' }, reservedWordAnalysis = analyzeComicScript(reservedWordScript.text, now);
    await (await ComicProductionStore.create({ workspaceRoot: f.root })).write(productionDocumentFromComicProject(f.project, { script: reservedWordScript, scriptAnalysis: reservedWordAnalysis }));
    const second = await f.organizer.duplicate(f.root, { title: '保留英文原文' });
    const secondProduction = (await (await ComicProductionStore.create({ workspaceRoot: second.path })).read()).document;
    assert.deepEqual(secondProduction.script, reservedWordScript, 'ordinary script text must not resolve inherited object property names as IDs');
});

test('duplicate copies additional director/world URI fields into its own media directory', async t => {
    const f = await fixture(t), panoramaUri = 'nextmux.media/panorama with spaces.png', modelUri = 'nextmux.media/director.glb';
    await writeFile(join(f.root, panoramaUri), 'panorama bytes'); await writeFile(join(f.root, modelUri), 'director model bytes');
    const store = new ComicCanvasStore(f.root), document = (await store.read()).canvas;
    await store.save({ ...document, settings: { scene: { modelUri, panoramaUri } } }, document.revision, f.project.id);
    const result = await f.organizer.duplicate(f.root, { title: '导演副本' }), copied = (await new ComicCanvasStore(result.path).read()).canvas;
    assert.equal(result.assetsCopied, 3); assert.notEqual(copied.settings.scene.panoramaUri, panoramaUri); assert.notEqual(copied.settings.scene.modelUri, modelUri);
    await rename(f.root, join(f.directory, 'director-source-in-trash'));
    assert.equal(await readFile(join(result.path, copied.settings.scene.panoramaUri), 'utf8'), 'panorama bytes');
    assert.equal(await readFile(join(result.path, copied.settings.scene.modelUri), 'utf8'), 'director model bytes');
});

test('duplicate preserves authored production entities, configuration and sidecar-only media while clearing live ownership', async t => {
    const f = await fixture(t), source = productionDocumentFromComicProject(f.project), extraUri = 'nextmux.media/sidecar-only.png';
    await writeFile(join(f.root, extraUri), 'sidecar image bytes');
    const extra = { ...source.assets[0], id: 'asset-sidecar-only', uri: extraUri };
    const profile = { providerId: 'fixture-provider', modelId: 'fixture-model', protocol: 'generic-fixture', capabilities: [], updatedAt: now };
    const job = { id: 'render-fixture', projectId: f.project.id, kind: 'video_generation', status: 'running', idempotencyKey: 'original-render-click', payloadHash: 'fixture',
        shotIds: [source.shots[0].id], attempt: 1, maxAttempts: 3, version: 1, createdAt: now, updatedAt: now };
    const authored = { ...source, episodes: source.episodes.map(episode => ({ ...episode, title: '作者自定义集标题', status: 'generating' })),
        scenes: source.scenes.map(scene => ({ ...scene, title: '作者场景标签', setPlateAssetId: extra.id })),
        shots: source.shots.map(shot => ({ ...shot, status: 'queued', sourceJobId: job.id })), assets: [...source.assets, extra],
        providerProfiles: [profile], renderJobs: [job], customAuthoring: { group: { id: 'production-group-original', title: '自由分组', sceneIds: source.scenes.map(scene => scene.id) } } };
    await (await ComicProductionStore.create({ workspaceRoot: f.root })).write(authored);
    const result = await f.organizer.duplicate(f.root, { title: '完整制作副本' }), production = (await (await ComicProductionStore.create({ workspaceRoot: result.path })).read()).document;
    assert.equal(result.assetsCopied, 2); assert.equal(production.episodes[0].title, '作者自定义集标题'); assert.notEqual(production.episodes[0].id, source.episodes[0].id);
    assert.equal(production.episodes[0].status, 'draft'); assert.equal(production.scenes[0].title, '作者场景标签'); assert.equal(production.shots[0].status, 'draft');
    assert.equal(production.shots[0].sourceJobId, job.id, 'generation provenance remains historical in the original project');
    assert.deepEqual(production.providerProfiles, [profile]); assert.deepEqual(production.renderJobs, []);
    assert.notEqual(production.customAuthoring.group.id, authored.customAuthoring.group.id);
    assert.equal(production.customAuthoring.group.sceneIds[0], result.project.scenes[0].id);
    const copiedExtra = production.assets.find(asset => asset.id === production.scenes[0].setPlateAssetId);
    assert.ok(copiedExtra); assert.notEqual(copiedExtra.id, extra.id); assert.notEqual(copiedExtra.uri, extraUri);
    await rename(f.root, join(f.directory, 'production-source-in-trash'));
    assert.equal(await readFile(join(result.path, copiedExtra.uri), 'utf8'), 'sidecar image bytes');
});

test('duplicate opens legacy projects with titles longer than the new organizer rename limit', async t => {
    const title = '旧标题'.repeat(28), f = await fixture(t, title), copy = await f.organizer.duplicate(f.root);
    assert.equal(copy.project.title, title); assert.notEqual(copy.project.id, f.project.id);
    assert.equal(await readFile(join(copy.path, copy.project.assets[0].uri), 'utf8'), 'original image bytes');
});

test('duplicate retains independent edits and frozen old media with new project, canvas, timeline and sequence identities', async t => {
    const f = await fixture(t), registry = await f.registry.create(f.project.id, { title: '视频画布' }), canvasId = registry.canvases.at(-1).id;
    const store = new ComicCanvasStore(f.root, canvasId), initial = (await store.read()).canvas;
    const oldVersion = { id: 'version-frozen-old', assetId: 'asset-frozen-old', kind: 'video', uri: 'nextmux.media/frozen.mp4', createdAt: now, metadata: { durationMs: 4000, width: 96, height: 64 } };
    const nextVersion = { ...oldVersion, id: 'version-current', assetId: 'asset-current-video', uri: 'nextmux.media/current.mp4' };
    await writeFile(join(f.root, oldVersion.uri), 'frozen video bytes'); await writeFile(join(f.root, nextVersion.uri), 'new video bytes');
    const node = (id, version) => ({ id, kind: 'video', title: id, position: { x: 0, y: 0 }, size: { width: 280, height: 180 }, payload: { versions: [version], currentVersionId: version.id } });
    let canvas = applyCanvasCommand(initial, { type: 'node.add', node: node('node-frozen', oldVersion) });
    canvas = applyCanvasCommand(canvas, { type: 'node.add', node: node('node-next', nextVersion) });
    canvas = applyCanvasCommand(canvas, { type: 'sequence.connect', link: { id: 'sequence-original', sourceNodeId: 'node-frozen', targetNodeId: 'node-next' } });
    let timeline = createCanvasTimeline(canvas, f.project, { id: 'timeline-original-edit', now });
    const shot = timeline.project.scenes[0].shots[0];
    timeline = editCanvasTimeline(timeline, [{ type: 'command', command: { type: 'shot.trim_start', sceneId: timeline.project.scenes[0].id, shotId: shot.id, frames: 24 } }], { now }).timeline;
    await new ComicCanvasTimelineStore(f.root).create(timeline.id, f.project.id, timelineCreationIntent({ canvasId }), async () => timeline);
    // The canvas now only knows the replacement. The editor must retain its independently frozen file and cut.
    canvas = { ...canvas, nodes: [node('node-frozen', nextVersion), node('node-next', nextVersion)] };
    await store.save(canvas, initial.revision, f.project.id);
    const originalBytes = await readFile(join(f.root, 'nextmux.timelines', `${timeline.id}.json`), 'utf8');
    const result = await f.organizer.duplicate(f.root, { title: '完整剪辑副本' });
    assert.equal(result.timelinesCopied, 1); assert.equal(result.assetsCopied, 3);
    const copiedStore = new ComicCanvasTimelineStore(result.path), [summary] = await copiedStore.list(result.project.id), copy = await copiedStore.read(summary.id, result.project.id);
    assert.notEqual(copy.id, timeline.id); assert.notEqual(copy.sourceCanvasId, canvasId); assert.equal(copy.projectId, result.project.id);
    assert.equal(copy.project.id, canvasTimelineProjectId(copy.id)); assert.notEqual(copy.project.id, timeline.project.id); assert.equal(copy.revision, 0);
    const copiedCanvas = (await new ComicCanvasStore(result.path, copy.sourceCanvasId).read()).canvas;
    assert.ok(copiedCanvas); assert.notEqual(copiedCanvas.sequenceLinks[0].id, 'sequence-original');
    assert.equal(copiedCanvas.sequenceLinks[0].sourceNodeId, copy.sources[0].nodeId);
    assert.equal(copy.project.scenes[0].shots[0].durationFrames, 72);
    const frozen = copy.project.assets.find(asset => asset.id === copy.project.scenes[0].shots[0].videoAssetId);
    assert.equal(copy.project.scenes[0].shots[0].mediaSourceStartFrames[frozen.id], 24);
    assert.equal(copy.sources[0].assetId, frozen.id); assert.notEqual(copy.sources[0].versionId, oldVersion.id);
    assert.equal(await readFile(join(f.root, 'nextmux.timelines', `${timeline.id}.json`), 'utf8'), originalBytes);
    await rename(f.root, join(f.directory, 'source-in-trash'));
    assert.equal(await readFile(join(result.path, frozen.uri), 'utf8'), 'frozen video bytes');
    assert.deepEqual((await readdir(join(result.path, 'nextmux.timelines'))).filter(name => !name.endsWith('.json')), []);
});

test('duplicate refuses a linked timeline directory and never drops a missing frozen video silently', async t => {
    const f = await fixture(t), outside = join(f.directory, 'outside-timelines'); await mkdir(outside);
    await symlink(outside, join(f.root, 'nextmux.timelines'));
    await assert.rejects(f.organizer.duplicate(f.root), { code: 'COMIC_ORGANIZER_FILE_INVALID' });
    await rm(join(f.root, 'nextmux.timelines'));
    const version = { id: 'version-only-in-edit', assetId: 'asset-only-in-edit', kind: 'video', uri: 'nextmux.media/missing-edit.mp4', createdAt: now, metadata: { durationMs: 1000 } };
    const canvas = { ...f.main, nodes: [{ id: 'node-only-in-edit', kind: 'video', title: '旧剪辑视频', position: { x: 0, y: 0 }, size: { width: 280, height: 180 }, payload: { versions: [version], currentVersionId: version.id } }] };
    const timeline = createCanvasTimeline(canvas, f.project, { id: 'timeline-missing-video', now });
    await new ComicCanvasTimelineStore(f.root).create(timeline.id, f.project.id, timelineCreationIntent({ canvasId: canvas.id }), async () => timeline);
    await assert.rejects(f.organizer.duplicate(f.root), { code: 'COMIC_ASSET_MISSING' });
    assert.deepEqual((await readdir(f.library)).filter(name => name.startsWith('.nextmux-duplicate-')), []);
});
