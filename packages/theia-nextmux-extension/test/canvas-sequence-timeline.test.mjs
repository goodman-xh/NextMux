import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, symlink, mkdir, writeFile, realpath, stat } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url), root = fileURLToPath(new URL('../../../', import.meta.url)), cache = new Map();
let core;
function source(path) {
    if (cache.has(path)) return cache.get(path).exports;
    const module = { exports: {} }; cache.set(path, module);
    const output = ts.transpileModule(readFileSync(path, 'utf8'), { fileName: path, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const dependency = name => name === '@nextmux/comic-core' ? core
        : name.startsWith('@nextmux/comic-core/') ? source(join(root, 'packages/comic-core/src', `${name.split('/').at(-1)}.ts`))
        : name.startsWith('.') ? source(resolve(dirname(path), `${name.replace(/\.js$/, '')}.ts`)) : require(name);
    new Function('require', 'module', 'exports', output)(dependency, module, module.exports);
    return module.exports;
}
const mod = name => source(join(root, 'packages/comic-core/src', `${name}.ts`));
core = { ...require('@nextmux/comic-core'), ...mod('canvas'), ...mod('canvas-sequence'), ...mod('canvas-timeline') };
const { applyCanvasCommand, createCanvasDocument, executeCanvasCommand, createCanvasHistory, undoCanvasCommand, redoCanvasCommand,
    resolveCanvasInputs, validateCanvasDocument, analyzeCanvasSequence, resolveCanvasSequence, createCanvasTimeline,
    editCanvasTimeline, restoreCanvasTimeline, migrateLegacyCanvasTimeline, validateCanvasTimeline } = core;
const { createComicProject } = mod('core');
const { ComicCanvasTimelineStore, timelineIdForRequest, timelineCreationIntent } = source(join(root, 'packages/theia-nextmux-extension/src/node/nextmux-canvas-timeline-store.ts'));
const { CanvasServiceError } = source(join(root, 'packages/theia-nextmux-extension/src/node/nextmux-canvas-store.ts'));
const now = '2026-10-03T00:00:00.000Z';
const opts = id => ({ id: `timeline-${id.padEnd(10, '0')}`, now });
function fixture(kinds = ['video', 'videoGen', 'video']) {
    const project = createComicProject({ title: 'Original', starter: 'empty', now });
    const nodes = kinds.map((kind, index) => {
        const version = { id: `version-${index}`, assetId: `asset-video-test-${index}`, kind: 'video', uri: `nextmux.media/video-${index}.mp4`, createdAt: now,
            metadata: { durationMs: (index + 1) * 1000, width: 96, height: 64, mimeType: 'video/mp4', byteLength: 20, sha256: String(index).repeat(64) } };
        return { id: `node-${index}`, kind, title: `Clip ${index}`, position: { x: (3 - index) * 600, y: 0 }, size: { width: 280, height: 280 },
            payload: { versions: [version], currentVersionId: version.id, ...(kind === 'videoGen' ? { mode: 'textToVideo', prompt: 'Unbound generated clip', modelId: 'test', parameters: {} } : {}) } };
    });
    let canvas = { ...createCanvasDocument({ id: 'canvas-fixture', projectId: project.id, now }), nodes };
    for (let index = 1; index < nodes.length; index++) canvas = applyCanvasCommand(canvas, { type: 'sequence.connect', link: { id: `sequence-${index}`, sourceNodeId: nodes[index - 1].id, targetNodeId: nodes[index].id } });
    return { project, canvas };
}
const code = expected => error => error.code === expected;

test('sequence order is independent of node position and model inputs; upload and unbound generated clips enter the timeline', () => {
    const { project, canvas } = fixture();
    assert.deepEqual(resolveCanvasSequence(canvas), ['node-0', 'node-1', 'node-2']);
    assert.equal(analyzeCanvasSequence(canvas).requiresChoice, false);
    assert.deepEqual(resolveCanvasInputs(canvas, 'node-1').inputs, []);
    const before = JSON.stringify(project), timeline = createCanvasTimeline(canvas, project, opts('first'));
    assert.equal(JSON.stringify(project), before);
    assert.deepEqual(timeline.project.scenes[0].shots.map(shot => shot.title), ['Clip 0', 'Clip 1', 'Clip 2']);
    assert.deepEqual(timeline.project.scenes[0].shots.map(shot => shot.durationFrames), [24, 48, 72]);
    assert.equal(timeline.project.episodes, undefined);
    assert.notEqual(timeline.project.id, project.id);
    assert.equal(timeline.sourceCanvasId, canvas.id);
});

test('branch and independent chains need a deliberate path choice; cycles, missing nodes and non-video links are rejected', () => {
    const { canvas } = fixture();
    const branch = applyCanvasCommand(canvas, { type: 'sequence.connect', link: { id: 'branch', sourceNodeId: 'node-0', targetNodeId: 'node-2' } });
    assert.throws(() => resolveCanvasSequence(branch), code('SEQUENCE_CHOICE_REQUIRED'));
    assert.deepEqual(resolveCanvasSequence(branch, [['node-0', 'node-2']]), ['node-0', 'node-2']);
    assert.throws(() => resolveCanvasSequence(branch, [['node-0'], ['node-0']]), code('SEQUENCE_DUPLICATE_NODE'));
    assert.throws(() => applyCanvasCommand(canvas, { type: 'sequence.connect', link: { id: 'cycle', sourceNodeId: 'node-2', targetNodeId: 'node-0' } }), code('SEQUENCE_CYCLE'));
    assert.throws(() => applyCanvasCommand(canvas, { type: 'sequence.connect', link: { id: 'missing', sourceNodeId: 'node-2', targetNodeId: 'another-canvas-node' } }), code('SEQUENCE_NODE_MISSING'));
    const disconnected = { ...canvas, sequenceLinks: [] };
    assert.throws(() => resolveCanvasSequence(disconnected), code('SEQUENCE_CHOICE_REQUIRED'));
    assert.deepEqual(resolveCanvasSequence(disconnected, [['node-2'], ['node-0']]), ['node-2', 'node-0']);
    assert.throws(() => resolveCanvasSequence(disconnected, [['node-2', 'node-0']]), code('SEQUENCE_PATH'));
    const text = { id: 'text', kind: 'text', title: 'Text', position: { x: 0, y: 0 }, size: { width: 280, height: 280 }, payload: { text: 'Story' } };
    assert.throws(() => applyCanvasCommand({ ...canvas, nodes: [...canvas.nodes, text] }, { type: 'sequence.connect', link: { id: 'bad-kind', sourceNodeId: 'text', targetNodeId: 'node-0' } }), code('SEQUENCE_VIDEO_REQUIRED'));
});

test('node deletion removes incident sequence links and undo/redo restores exactly the original graph; old schema still loads', () => {
    const { canvas } = fixture();
    let history = executeCanvasCommand(createCanvasHistory(canvas), { type: 'node.delete', nodeIds: ['node-1'] });
    assert.equal(history.present.sequenceLinks.length, 0);
    history = undoCanvasCommand(history); assert.deepEqual(history.present.sequenceLinks, canvas.sequenceLinks);
    history = redoCanvasCommand(history); assert.equal(history.present.sequenceLinks.length, 0);
    const { sequenceLinks, ...legacy } = canvas;
    assert.deepEqual(validateCanvasDocument(legacy), []);
    assert.deepEqual(validateCanvasDocument({ ...canvas, sequenceLinks: 'bad' }).map(issue => issue.code), ['SEQUENCE_ARRAY']);
});

test('selected versions are frozen, repeated media in separate nodes remains two clips, and incomplete nodes are explicit errors', () => {
    const { canvas, project } = fixture(['video', 'video']);
    const same = { ...canvas, nodes: [canvas.nodes[0], { ...canvas.nodes[1], payload: structuredClone(canvas.nodes[0].payload) }] };
    const timeline = createCanvasTimeline(same, project, opts('repeat'));
    assert.equal(timeline.project.scenes[0].shots.length, 2);
    assert.equal(timeline.project.assets.filter(asset => asset.kind === 'video').length, 1);
    same.nodes[0].payload.currentVersionId = 'missing-version';
    assert.equal(timeline.sources[0].versionId, 'version-0');
    assert.throws(() => createCanvasTimeline(same, project, opts('pending')), code('TIMELINE_VIDEO_NOT_READY'));
    const fresh = fixture(['video']); delete fresh.canvas.nodes[0].payload.versions[0].metadata.durationMs;
    assert.throws(() => createCanvasTimeline(fresh.canvas, fresh.project, opts('unmeasured')), code('TIMELINE_DURATION_REQUIRED'));
    assert.throws(() => createCanvasTimeline(canvas, { ...project, id: 'project-other-project' }, opts('cross')), code('TIMELINE_PROJECT_MISMATCH'));
});

test('timeline editing really saves trim/split/reorder/audio independently; undo keeps the correct timeline identity', () => {
    const { canvas, project } = fixture();
    let timeline = createCanvasTimeline(canvas, project, opts('editable'));
    const original = structuredClone(timeline), scene = timeline.project.scenes[0], shot = scene.shots[2];
    const music = { id: 'asset-music-test', kind: 'music', source: 'imported', uri: 'nextmux.media/music.wav', status: 'ready', mimeType: 'audio/wav', sha256: 'a'.repeat(64), byteLength: 10, durationMs: 10000, createdAt: now, updatedAt: now };
    let result = editCanvasTimeline(timeline, [
        { type: 'command', command: { type: 'shot.trim_start', sceneId: scene.id, shotId: shot.id, frames: 12 } },
        { type: 'command', command: { type: 'shot.split', sceneId: scene.id, shotId: scene.shots[1].id, splitAtFrame: 24 } },
        { type: 'command', command: { type: 'shot.move', sceneId: scene.id, shotId: shot.id, targetSceneId: scene.id, afterShotId: null } },
        { type: 'place_audio', assetId: music.id, role: 'music', shots: [{ sceneId: scene.id, shotId: shot.id }] }
    ], { now, availableProject: { ...project, assets: [music] } });
    timeline = result.timeline;
    assert.equal(timeline.revision, 1); assert.equal(timeline.project.revision, 1);
    assert.equal(timeline.project.scenes[0].shots.length, 4);
    const first = timeline.project.scenes[0].shots[0];
    assert.equal(first.id, shot.id); assert.equal(first.durationFrames, 60);
    assert.equal(first.mediaSourceStartFrames[shot.videoAssetId], 12);
    assert.deepEqual(first.musicAssetIds, [music.id]);
    assert.equal(project.scenes.length, 0); assert.equal(project.assets.length, 0);
    const restored = restoreCanvasTimeline(timeline, original.project, now);
    assert.equal(restored.revision, 2); assert.deepEqual(restored.project.scenes, original.project.scenes);
    const other = createCanvasTimeline(canvas, project, opts('other'));
    assert.throws(() => restoreCanvasTimeline(timeline, other.project, now), code('TIMELINE_IDENTITY'));
});

test('long video source boundaries and legacy editor migration preserve time, existing cuts and the original data', () => {
    const { canvas, project } = fixture(['video']); canvas.nodes[0].payload.versions[0].metadata.durationMs = 800000;
    const timeline = createCanvasTimeline(canvas, project, opts('long'));
    assert.deepEqual(timeline.project.scenes[0].shots.map(shot => [shot.durationFrames, shot.mediaSourceStartFrames[shot.videoAssetId]]), [[18000, 0], [1200, 18000]]);
    const legacyProject = { ...timeline.project, id: project.id, episodes: [{ number: 7, title: 'Old episode', script: 'Existing authored script' }],
        scenes: timeline.project.scenes.map(scene => ({ ...scene, episodeNumber: 7, shots: scene.shots.map(shot => ({ ...shot, volume: .7, transitionOut: 'fade', transitionOutExplicit: true })) })) };
    const before = JSON.stringify(legacyProject), migrated = migrateLegacyCanvasTimeline(canvas, legacyProject, opts('legacy'));
    assert.equal(JSON.stringify(legacyProject), before); assert.equal(migrated.project.episodes, undefined);
    assert.equal(migrated.project.scenes[0].episodeNumber, undefined);
    assert.equal(migrated.project.scenes[0].shots[0].volume, .7);
    assert.equal(migrated.project.scenes[0].shots[0].transitionOut, 'fade');
    assert.equal(migrated.legacySource.projectRevision, legacyProject.revision);
});

test('persistent timelines survive reload, retry the same creation once, serialize edits and reject wrong project/revision/path', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'nextmux-timeline-store-'));
    try {
        const { canvas, project } = fixture(), store = new ComicCanvasTimelineStore(folder);
        const request = { canvasId: canvas.id, title: 'A', paths: [['node-0', 'node-1']] }, id = timelineIdForRequest(canvas.id, 'request-12345'), intent = timelineCreationIntent(request);
        let prepared = 0;
        const make = () => store.create(id, project.id, intent, async () => { prepared++; return createCanvasTimeline(canvas, project, { id, now, ...request }); });
        const [first, replay] = await Promise.all([make(), make()]);
        assert.equal(prepared, 1); assert.deepEqual(first, replay);
        assert.equal((await store.list(project.id, 'different-canvas')).length, 0);
        assert.equal((await store.list(project.id, canvas.id)).length, 1);
        const scene = first.project.scenes[0], shot = scene.shots[0];
        const edit = () => new ComicCanvasTimelineStore(folder).mutate(id, project.id, 0, document => editCanvasTimeline(document,
            [{ type: 'command', command: { type: 'shot.update', sceneId: scene.id, shotId: shot.id, patch: { title: 'Saved edit' } } }], { now }).timeline);
        const results = await Promise.allSettled([edit(), edit()]);
        assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
        assert.equal(results.find(result => result.status === 'rejected').reason.code, 'TIMELINE_REVISION_CONFLICT');
        assert.equal((await new ComicCanvasTimelineStore(folder).read(id, project.id)).project.scenes[0].shots[0].title, 'Saved edit');
        assert.equal((await make()).revision, 1, 'lost creation response never rebuilds over a later user edit');
        await assert.rejects(store.create(id, project.id, timelineCreationIntent({ ...request, title: 'Changed' }), async () => first), code('TIMELINE_INTENT_CHANGED'));
        await assert.rejects(store.read(id, 'project-foreign'), code('TIMELINE_PROJECT_MISMATCH'));
        await assert.rejects(store.read('../outside', project.id), code('TIMELINE_ID'));
        const file = join(folder, 'nextmux.timelines', `${id}.json`);
        const stored = JSON.parse(await readFile(file, 'utf8'));
        assert.equal(validateCanvasTimeline(stored.document).revision, 1);
        await rm(file); const outside = join(folder, 'outside.json'); await writeFile(outside, JSON.stringify(stored)); await symlink(outside, file);
        await assert.rejects(store.read(id, project.id), code('TIMELINE_FILE'));
    } finally { await rm(folder, { recursive: true, force: true }); }
});

test('timeline directory refuses a symlink escape', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'nextmux-timeline-symlink-'));
    try { await mkdir(join(folder, 'outside')); await symlink(join(folder, 'outside'), join(folder, 'nextmux.timelines'));
        await assert.rejects(new ComicCanvasTimelineStore(folder).list('project-test'), code('TIMELINE_PATH'));
    } finally { await rm(folder, { recursive: true, force: true }); }
});

function rpcHarness() {
    const text = readFileSync(join(root, 'packages/theia-nextmux-extension/src/node/nextmux-platform-service.ts'), 'utf8');
    const ast = ts.createSourceFile('service.ts', text, ts.ScriptTarget.Latest, true);
    const names = new Set(['comicTimelineScope', 'listComicCanvasTimelines', 'getComicCanvasTimeline', 'createComicCanvasTimeline', 'probeComicImport',
        'applyComicCanvasTimelineEdits', 'validateDetachedComicAudio', 'restoreComicCanvasTimeline', 'startComicExport']);
    const methods = [], helpers = [];
    (function walk(node) { if (ts.isMethodDeclaration(node) && names.has(node.name.getText(ast))) methods.push(node.getText(ast));
        if (ts.isFunctionDeclaration(node) && node.name?.getText(ast) === 'boundedCommand') helpers.push(node.getText(ast)); ts.forEachChild(node, walk); })(ast);
    assert.equal(methods.length, names.size);
    const compiled = ts.transpileModule(`const { ${Object.keys(core).filter(key => ['canvasTimelineAsset','createCanvasTimeline','editCanvasTimeline','migrateLegacyCanvasTimeline','restoreCanvasTimeline','resolveCanvasSequence'].includes(key)).join(',')}, ComicCanvasTimelineStore,timelineIdForRequest,timelineCreationIntent,CanvasServiceError,PlatformRequestError,realpath,resolve,stat,randomUUID,mediaMessage,exportMessage,withDesktopPowerSaveBlocker,spawn,dirname,probeComicMediaPackets,MediaRuntimeError } = deps; ${helpers.join('\n')} class Harness { ${methods.join('\n')} }`,
        { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    class PlatformRequestError extends Error { constructor(code, message) { super(typeof message === 'string' ? message : message.key); this.code = code; } }
    return new (new Function('deps', `${compiled}\nreturn Harness;`)({ ...core, ComicCanvasTimelineStore, timelineIdForRequest, timelineCreationIntent,
        CanvasServiceError, PlatformRequestError, realpath, resolve, stat, randomUUID, mediaMessage: key => ({ key }), exportMessage: message => ({ message }), withDesktopPowerSaveBlocker: operation => operation(),
        spawn, dirname, probeComicMediaPackets: source(join(root, 'packages/theia-nextmux-extension/src/node/nextmux-comic-media-probe.ts')).probeComicMediaPackets, MediaRuntimeError: CanvasServiceError }))();
}

test('production timeline RPC measures video bytes, saves edits and freezes only the selected timeline for the real exporter boundary', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'nextmux-timeline-rpc-'));
    try {
        const { project, canvas } = fixture();
        await mkdir(join(folder, 'nextmux.media')); await writeFile(join(folder, 'nextmux.media/fixture.mp4'), 'local fixture');
        const harness = rpcHarness(), activity = { activeByWorkspace: new Map(), clearing: new Set() };
        let probes = 0, exported;
        Object.assign(harness, {
            validateWorkspaceRootInput: value => assert.equal(value, folder),
            comicProjectStore: async () => ({ read: async () => ({ exists: true, project }) }),
            canvasStore: (_root, canvasId) => { assert.equal(canvasId, canvas.id); return { withLock: operation => operation(), read: async () => ({ canvas }) }; },
            getMediaRuntimeState: async () => ({ ffmpeg: { available: true, path: '/fixture/ffmpeg' } }),
            comicExportAssetPath: async (_root, asset, kind, _label, verify) => { assert.equal(kind, 'video'); assert.equal(verify, true); return join(folder, 'nextmux.media/fixture.mp4'); },
            probeComicImport: async () => { probes++; return { durationMs: 2250, streamStartMs: 5000, width: 128, height: 72 }; },
            sha256File: async () => 'a'.repeat(64),
            assertComicExportConnectionAvailable: () => {}, mediaWorkspaceId: () => 'workspace', comicExportWorkspaceActivity: () => activity,
            acquireComicExportLifecycleLock: async () => ({ assertOwned: () => {}, release: async () => {} }),
            musicMvExportProject: value => value, persistComicExport: async () => {}, comicExports: new Map(), activeComicExportByWorkspace: new Map(),
            executeComicExport: async (_run, value, request) => { exported = { project: structuredClone(value), request }; }
        });
        const request = { workspaceRoot: folder, canvasId: canvas.id, requestId: 'rpc-request-1234', expectedCanvasRevision: canvas.revision, paths: [['node-1', 'node-2']] };
        let timeline = await harness.createComicCanvasTimeline(request);
        assert.equal(probes, 2); assert.equal(timeline.project.scenes[0].shots.length, 2);
        assert.deepEqual(timeline.project.scenes[0].shots.map(shot => shot.durationFrames), [54, 54]);
        assert.equal(timeline.project.assets[0].streamStartMs, 5000);
        canvas.revision++;
        assert.equal((await harness.createComicCanvasTimeline(request)).id, timeline.id); assert.equal(probes, 2);
        const scene = timeline.project.scenes[0], shot = scene.shots[0];
        timeline = (await harness.applyComicCanvasTimelineEdits({ workspaceRoot: folder, timelineId: timeline.id, expectedRevision: 0,
            edits: [{ type: 'command', command: { type: 'shot.update', sceneId: scene.id, shotId: shot.id, patch: { durationFrames: 24 } } }] })).timeline;
        const exportRequest = { workspaceRoot: folder, timelineId: timeline.id, expectedTimelineRevision: 1, canvasId: canvas.id,
            quality: 'balanced', subtitleMode: 'none', allowPlaceholders: false, verifyAssetIntegrity: true };
        const state = await harness.startComicExport(exportRequest);
        await harness.comicExports.get(state.id).completion;
        assert.equal(state.timelineId, timeline.id); assert.equal(state.sourceCanvasId, canvas.id);
        assert.deepEqual(exported.project.scenes[0].shots.map(shot => shot.durationFrames), [24, 54]);
        assert.equal(exported.project.scenes[0].shots.length, 2, 'no source project or other-canvas clips are exported');
        assert.equal(exported.project.id, timeline.project.id);
        await assert.rejects(harness.startComicExport({ ...exportRequest, expectedTimelineRevision: 0 }), code('TIMELINE_REVISION_CONFLICT'));
        await assert.rejects(harness.startComicExport({ ...exportRequest, canvasId: 'other-canvas' }), code('TIMELINE_REVISION_CONFLICT'));
        await assert.rejects(harness.startComicExport({ ...exportRequest, episodeId: 'some-episode' }), code('INVALID_COMIC_EXPORT'));
        await assert.rejects(harness.startComicExport({ ...exportRequest, compositionNodeId: 'composition' }), code('INVALID_COMIC_EXPORT'));
        assert.equal(project.scenes.length, 0);
        assert.equal((await harness.getComicCanvasTimeline(folder, timeline.id)).revision, 1);
    } finally { await rm(folder, { recursive: true, force: true }); }
});

test('real local video probe uses selected video stream length and start timestamp rather than container duration or node metadata', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'nextmux-timeline-video-'));
    try {
        const ffmpeg = require('@ffmpeg-installer/ffmpeg').path, file = join(folder, 'source.mp4');
        await promisify(execFile)(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=12',
            '-frames:v', '15', '-vf', 'setpts=PTS+5/TB', '-vsync', '0', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file], { timeout: 20000 });
        const { canvas, project } = fixture(['video']);
        canvas.nodes[0].payload.versions[0].metadata.durationMs = 99000;
        delete canvas.nodes[0].payload.versions[0].metadata.sha256;
        const harness = rpcHarness();
        Object.assign(harness, { validateWorkspaceRootInput: value => assert.equal(value, folder),
            comicProjectStore: async () => ({ read: async () => ({ project }) }),
            canvasStore: () => ({ withLock: operation => operation(), read: async () => ({ canvas }) }),
            getMediaRuntimeState: async () => ({ ffmpeg: { available: true, path: ffmpeg } }),
            comicExportAssetPath: async () => file, sha256File: async path => createHash('sha256').update(await readFile(path)).digest('hex') });
        const timeline = await harness.createComicCanvasTimeline({ workspaceRoot: folder, canvasId: canvas.id, requestId: 'real-video-1234', expectedCanvasRevision: canvas.revision });
        const asset = timeline.project.assets[0];
        assert.equal(asset.durationMs, 1250); assert.equal(asset.streamStartMs, 5000);
        assert.equal(timeline.project.scenes[0].shots[0].durationFrames, 30);
        assert.equal(asset.sha256, createHash('sha256').update(await readFile(file)).digest('hex'));
        assert.equal(canvas.nodes[0].payload.versions[0].metadata.durationMs, 99000, 'source document is never rewritten by import');
    } finally { await rm(folder, { recursive: true, force: true }); }
});
