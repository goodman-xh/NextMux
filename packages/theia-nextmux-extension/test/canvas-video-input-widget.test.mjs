import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { sourceModule, comicCoreSource as core } from './helpers/comic-organizer-source-loader.mjs';
const require = createRequire(import.meta.url), logic = sourceModule('browser/nextmux-comic-canvas-logic.ts');
const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), methods = [];
const names = new Set(['comicCanvasVideoInputFingerprint', 'invalidateComicCanvasVideoInputs', 'cancelComicCanvasVideoInput', 'prepareComicCanvasVideoInput', 'prepareComicCanvasVideoFrame', 'prepareComicCanvasDirectVideoFrame', 'prepareComicContinuityFrame', 'canvasCapabilityOf', 'adoptComicCanvas', 'submitComicCanvasNode', 'reconcileComicCanvasRoutes', 'undoComicCanvas', 'comicCanvasRetryPending']);
(function visit(node) { if (ts.isMethodDeclaration(node) && names.has(node.name.getText(ast))) methods.push(node.getText(ast)); ts.forEachChild(node, visit); })(ast);
assert.equal(methods.length, names.size);
const deps = { ...core, ...logic, ...require('@nextmux/comic-core/canvas-capabilities'), ...sourceModule('browser/nextmux-comic-canvas-video-input.ts'), ...sourceModule('browser/nextmux-comic-canvas-options.ts'),
    window: { crypto: globalThis.crypto }, canvasOptionsText: (_locale, key) => key, canvasText: (_locale, key) => key, canvasIssueText: (_locale, issue) => issue.code,
    continuityText: (_locale, key) => key, modelFailureText: (_locale, error) => error.message };
const compiled = ts.transpileModule(`const {${Object.keys(deps).join(',')}}=deps;class Widget{${methods.join('\n')}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const Widget = new Function('deps', `${compiled};return Widget;`)(deps);
let routeSource;
(function visit(node) { if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'onSetRoute') routeSource = node.initializer.expression.getText(ast); ts.forEachChild(node, visit); })(ast);
assert.ok(routeSource);
const routeCompiled = ts.transpileModule(`const {${Object.keys(deps).join(',')}}=deps;function make(session){return ${routeSource};}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const routeCallback = new Function('deps', `${routeCompiled};return make;`)(deps);
const now = '2026-10-04T00:00:00Z';
const metadata = { mimeType: 'video/mp4', width: 1280, height: 720, byteLength: 500, durationMs: 5000 };
const video = { id: 'v1', assetId: 'a1', kind: 'video', uri: 'video.mp4', metadata, createdAt: now };
const common = { outputVariants: [{ id: '720', resolution: '720p', aspectRatios: ['16:9'] }], duration: { kind: 'fixed', seconds: 5 }, audioGeneration: { mode: 'unsupported', defaultEnabled: false } };
const capability = { id: 'm', providerId: 'merchant', providerModelId: 'model', displayName: 'Model', status: 'available', version: '1', sources: [], modes: [{ mode: 'imageToVideo', ...common, firstFrame: true, frameImageRule: { supported: true, maxCount: 1, formats: ['png'], maxBytes: 1024 } }] };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture({ reference = false, direct = false, supportedVideo = false, cached = true } = {}) {
    const model = supportedVideo ? { ...capability, modes: [...capability.modes, { mode: 'referenceToVideo', ...common, referenceRules: { video: { supported: true, maxCount: 1, formats: ['mp4'], maxBytes: 1024 } }, combinationConstraints: [{ combination: 'video', maxVideos: 1 }] }] } : capability;
    const target = { ...logic.createCanvasNode('videoGen', { x: 500, y: 0 }, { videoModelId: 'model', title: 'Target' }), id: 'target' };
    target.payload = { ...target.payload, mode: reference || direct ? 'referenceToVideo' : 'textToVideo', prompt: '', parameters: {}, ...(direct ? { inputs: [{ id: 'direct', role: 'referenceVideo', order: 0, version: video }] } : {}) };
    const sourceNode = { id: 'source', kind: 'video', title: 'Source', position: { x: 0, y: 0 }, size: { width: 500, height: 280 }, payload: { versions: [video], currentVersionId: 'v1' } };
    const doc = { ...core.createCanvasDocument({ id: 'c', projectId: 'p', now }), nodes: [sourceNode, target], settings: { nodeRoutes: { target: 'merchant-model' } }, edges: reference ? [{ id: 'reference', sourceNodeId: 'source', sourcePort: 'output', targetNodeId: 'target', targetPort: 'referenceVideo', role: 'referenceVideo', order: 0, binding: 'followCurrent' }] : [] };
    const session = { doc, base: doc, workspaceRoot: '/qa', canvasId: 'c', save: 'saved', capabilities: new Map(cached ? [['video|merchant-model|model', { capability: model }]] : []), submitting: new Set(), reconcile: new Set(), past: [], future: [] };
    const extracts = [], notices = [], choice = { key: 'merchant-model', modelId: 'model', kind: 'video', connectionId: 'merchant' };
    const widget = Object.assign(new Widget(), { comicCanvas: session, comicCanvasCapabilityLoads: new WeakMap(), comicCanvasVideoInputs: new WeakMap(), comicCanvasFrameCaptures: new WeakMap(), comicCanvasRetries: new WeakMap(), desktopLocale: 'en',
        update() {}, scheduleComicCanvasSave() {}, comicCanvasCanWrite: item => item === session && !widget.closed, comicCanvasIsTracked: item => item === session && !widget.closed, canvasRouteOf: () => choice,
        reconcileComicCanvasRoutes() {}, fitComicCanvasSettings() {}, notifyComicCanvasJobs() {}, comicCanvasNotice: (_item, message) => notices.push(message),
        changeComicCanvasSession(item, next, record) { if (record) item.past.push(item.doc); item.doc = next; item.save = 'dirty'; this.invalidateComicCanvasVideoInputs(item); },
        flushComicCanvas: async item => { if (widget.onFlush) await widget.onFlush(item); item.base = item.doc; item.save = 'saved'; },
        platformService: { getComicCanvasCapability: () => widget.onCapability ? widget.onCapability() : Promise.resolve(model), extractComicCanvasFrame: async request => {
            extracts.push(request); const baseline = session.base, node = baseline.nodes.find(item => item.id === request.nodeId), input = core.resolveCanvasInputs(baseline, node.id).inputs[0];
            if (widget.onExtract) await widget.onExtract(request);
            const version = { id: `frame-${extracts.length}`, assetId: `asset-frame-${extracts.length}`, kind: 'image', uri: `frame-${extracts.length}.png`, createdAt: now,
                metadata: { mimeType: 'image/png', width: 1280, height: 720, byteLength: 400 }, provenance: { operation: 'frameExtract', sourceVersionId: input.versionId, sourceNodeId: input.sourceNodeId, frameSelection: node.payload.selection } };
            return { canvas: core.applyCanvasCommand(baseline, { type: 'node.addVersion', nodeId: node.id, version, select: true }) };
        }, extractComicCanvasInputFrame: async request => {
            extracts.push(request); if (widget.onExtract) await widget.onExtract(request);
            return { id: `direct-frame-${extracts.length}`, assetId: `asset-frame-${extracts.length}`, kind: 'image', uri: `frame-${extracts.length}.png`, createdAt: now,
                metadata: { mimeType: 'image/png', width: 1280, height: 720, byteLength: 400 }, provenance: { operation: 'frameExtract', sourceVersionId: request.versionId, frameSelection: request.selection } };
        } } });
    const start = (source = reference || direct ? undefined : 'source', mode) => widget.prepareComicCanvasVideoInput(session, source, 'target', mode);
    const node = () => session.doc.nodes.find(item => item.id === 'target');
    return { widget, session, extracts, notices, start, node, model, changeRoute: selected => { Object.assign(choice, selected); routeCallback.call(widget, session)(['target'], choice); } };
}
test('new video link chooses verified video references without extracting or submitting generation', async () => {
    const f = fixture({ supportedVideo: true }); await f.start();
    assert.equal(f.node().payload.mode, 'referenceToVideo'); assert.equal(f.extracts.length, 0);
    assert.equal(f.session.doc.edges[0].binding, 'pinnedVersion'); assert.equal(f.session.doc.edges[0].pinnedVersionId, 'v1');
    assert.deepEqual(core.validateCanvasDocument(f.session.doc), []); assert.deepEqual(f.notices, []);
});
test('unsupported video reference falls back to a real tail frame; output is an ordinary image and one undo restores the draft', async () => {
    const f = fixture(); await f.start();
    assert.deepEqual(f.notices, []); assert.equal(f.extracts.length, 1); assert.equal(f.node().payload.mode, 'imageToVideo');
    const images = f.session.doc.nodes.filter(node => node.kind === 'image'); assert.equal(images.length, 1);
    assert.deepEqual(images[0].payload.versions[0].provenance.frameSelection, { kind: 'last' });
    assert.equal(f.session.doc.edges.length, 1); assert.equal(f.session.doc.edges[0].role, 'firstFrame'); assert.equal(f.session.doc.edges[0].binding, 'pinnedVersion');
    assert.equal(f.session.doc.nodes.some(node => node.kind === 'frameExtract'), false); assert.equal(f.session.past.length, 1);
    assert.equal(f.session.past[0].nodes.length, 2); assert.equal(f.session.past[0].edges.length, 0);
    f.widget.undoComicCanvas(); assert.equal(f.node().payload.mode, 'textToVideo'); assert.equal(f.session.doc.nodes.length, 2); assert.equal(f.session.doc.edges.length, 0);
    f.widget.undoComicCanvas(true); assert.equal(f.node().payload.mode, 'imageToVideo'); assert.equal(f.session.doc.edges[0].pinnedVersionId, images[0].payload.currentVersionId);
});
test('existing edge and direct video switch explicitly to image mode without discarding the original while extraction runs', async () => {
    for (const direct of [false, true]) {
        const f = fixture({ direct, reference: !direct }), gate = deferred(); f.widget.onExtract = () => gate.promise;
        const pending = f.start(undefined, 'imageToVideo'); while (!f.extracts.length) await tick();
        assert.equal(f.node().payload.mode, 'referenceToVideo'); assert.equal(direct ? f.node().payload.inputs.length : f.session.doc.edges.filter(edge => edge.targetNodeId === 'target').length, 1);
        gate.resolve(); await pending; assert.deepEqual(f.notices, []); assert.equal(f.node().payload.mode, 'imageToVideo');
        assert.deepEqual(core.validateCanvasDocument(f.session.doc), []);
    }
});
test('capability loading is awaited, not misclassified; failure and unknown support do not extract', async () => {
    const f = fixture({ cached: false }), gate = deferred(); f.widget.onCapability = () => gate.promise;
    const pending = f.start(); await tick(); assert.equal(f.extracts.length, 0); assert.equal(f.session.doc.nodes.length, 2);
    gate.resolve(f.model); await pending; assert.equal(f.extracts.length, 1);
    const g = fixture({ cached: false }); g.widget.onCapability = () => Promise.reject(new Error('network offline')); await g.start(); assert.equal(g.extracts.length, 0); assert.match(g.notices[0], /network offline/);
});
test('manual text mode is never overwritten; unsupported explicit image route is rejected unchanged', async () => {
    const f = fixture(); f.session.doc.settings.manualVideoModes = { target: true }; const before = f.session.doc; await f.start(); assert.equal(f.session.doc, before); assert.equal(f.extracts.length, 0);
    const g = fixture({ reference: true }); g.session.capabilities.set('video|merchant-model|model', { capability: { ...g.model, modes: [{ mode: 'textToVideo', ...common }] } }); const original = g.session.doc;
    await g.start(undefined, 'imageToVideo'); assert.equal(g.session.doc, original); assert.equal(g.extracts.length, 0);
    assert.equal(g.notices[0], 'issue.MODE_UNSUPPORTED');
});
test('duplicate preparation extracts once; extraction failure removes temporary empty nodes and can be retried', async () => {
    const f = fixture(), gate = deferred(); f.widget.onExtract = () => gate.promise;
    const pending = f.start(); while (!f.extracts.length) await tick(); await f.start(); assert.equal(f.extracts.length, 1); gate.resolve(); await pending;
    const g = fixture(); g.widget.onExtract = async () => { throw new Error('ffmpeg failed'); }; await g.start(); assert.equal(g.session.doc.nodes.length, 2); assert.equal(g.session.doc.edges.length, 0);
    g.widget.onExtract = undefined; await g.start(); assert.equal(g.node().payload.mode, 'imageToVideo'); assert.equal(g.session.doc.nodes.length, 3);
});

test('direct reference fallback never publishes a temporary node or edge and is exactly one undoable change', async () => {
    const f = fixture({ direct: true }), before = structuredClone(f.session.doc), gate = deferred(); f.widget.onExtract = () => gate.promise;
    const pending = f.start(); while (!f.extracts.length) await tick();
    assert.deepEqual(f.session.doc, before); assert.equal(f.session.past.length, 0);
    assert.equal(f.extracts[0].inputId, 'direct'); assert.equal(f.extracts[0].assetId, 'a1');
    gate.resolve(); await pending; assert.deepEqual(f.notices, []);
    assert.equal(f.session.doc.nodes.length, 2); assert.equal(f.session.doc.edges.length, 0); assert.equal(f.session.past.length, 1);
    assert.equal(f.node().payload.inputs[0].role, 'firstFrame'); assert.equal(f.node().payload.mode, 'imageToVideo');
    f.widget.undoComicCanvas(); assert.deepEqual(f.node().payload.inputs, before.nodes[1].payload.inputs); assert.equal(f.node().payload.mode, 'referenceToVideo');
    f.widget.undoComicCanvas(true); assert.equal(f.node().payload.inputs[0].role, 'firstFrame'); assert.equal(f.session.doc.nodes.length, 2);
});

test('failed or stale direct extraction cannot change references, publish nodes, or add history', async () => {
    for (const change of ['failure', 'cancel', 'delete', 'replace', 'route', 'tab']) {
        const f = fixture({ direct: true }), gate = deferred(); f.widget.onExtract = () => gate.promise;
        const pending = f.start(); while (!f.extracts.length) await tick();
        if (change === 'failure') gate.reject(new Error('ffmpeg failed'));
        else {
            if (change === 'cancel') f.widget.cancelComicCanvasVideoInput(f.session, 'target');
            if (change === 'delete') f.session.doc = core.applyCanvasCommand(f.session.doc, { type: 'node.delete', nodeIds: ['target'] });
            if (change === 'replace') f.node().payload.inputs = [{ id: 'direct', role: 'referenceVideo', order: 0, version: { ...video, assetId: 'replacement', uri: 'replacement.mp4' } }];
            if (change === 'route') f.session.doc.settings.nodeRoutes = { target: 'new-route' };
            if (change === 'tab') f.widget.comicCanvas = { doc: core.createCanvasDocument({ id: 'other', projectId: 'p' }) };
            gate.resolve();
        }
        await pending; assert.equal(f.session.doc.nodes.length, change === 'delete' ? 1 : 2, change); assert.equal(f.session.doc.edges.length, 0, change);
        assert.equal(f.session.past.length, 0, change); if (f.node()) assert.equal(f.node().payload.inputs[0].role, 'referenceVideo', change);
    }
});
test('late results cannot overwrite delete, route/mode/ref edits, or a different active canvas', async () => {
    for (const change of ['delete', 'mode', 'route', 'reference', 'tab']) {
        const f = fixture({ reference: true }), gate = deferred(); f.widget.onExtract = () => gate.promise;
        const pending = f.start(undefined, 'imageToVideo'); while (!f.extracts.length) await tick();
        if (change === 'tab') f.widget.comicCanvas = { doc: core.createCanvasDocument({ id: 'other', projectId: 'p' }) };
        else {
            let next = f.session.doc;
            if (change === 'delete') next = core.applyCanvasCommand(next, { type: 'node.delete', nodeIds: ['target'] });
            else if (change === 'mode') { f.widget.cancelComicCanvasVideoInput(f.session, 'target'); next = { ...next, settings: { ...next.settings, manualVideoModes: { target: true } } }; }
            else if (change === 'route') next = { ...next, settings: { ...next.settings, nodeRoutes: { target: 'other-merchant' } } };
            else next = core.applyCanvasCommand(next, { type: 'edge.disconnect', edgeId: 'reference' });
            f.widget.changeComicCanvasSession(f.session, next, true);
        }
        gate.resolve(); await pending;
        assert.equal(f.session.doc.edges.some(edge => edge.targetNodeId === 'target' && edge.role === 'firstFrame'), false, change);
        if (change === 'delete') assert.equal(f.node(), undefined); else assert.equal(f.node().payload.mode, 'referenceToVideo', change);
    }
});
test('manual frame capture uses the exact reviewed version and selection, returning a real image', async () => {
    const f = fixture(); const result = await f.widget.prepareComicContinuityFrame('source', 'v1', { kind: 'time', timeMs: 1200 });
    assert.equal(result.node.kind, 'image'); assert.equal(result.version.provenance.sourceVersionId, 'v1');
    assert.deepEqual(result.version.provenance.frameSelection, { kind: 'time', timeMs: 1200 }); assert.equal(result.canvas.edges.length, 0);
});
test('in-flight input preparation cannot submit generation and invalid reference limits do not silently become image input', async () => {
    const f = fixture(), gate = deferred(); f.widget.onExtract = () => gate.promise;
    const pending = f.start(); while (!f.extracts.length) await tick();
    await f.widget.submitComicCanvasNode(f.session, 'target'); // Any fall-through invokes unstubbed billing methods and fails.
    assert.equal(f.session.submitting.has('target'), false); gate.resolve(); await pending;
    const g = fixture({ supportedVideo: true }); g.session.doc.nodes[0].payload.versions[0] = { ...video, metadata: { ...metadata, byteLength: 9999 } };
    await g.start(); assert.equal(g.extracts.length, 0); assert.equal(g.node().payload.mode, 'textToVideo'); assert.equal(g.notices[0], 'INPUT_LIMIT_EXCEEDED');
});
test('identical manual frame requests share one extraction and release their lock after failure', async () => {
    const f = fixture(), gate = deferred(); f.widget.onExtract = () => gate.promise;
    const first = f.widget.prepareComicContinuityFrame('source', 'v1', { kind: 'first' });
    const second = f.widget.prepareComicContinuityFrame('source', 'v1', { kind: 'first' });
    while (!f.extracts.length) await tick(); assert.equal(f.extracts.length, 1); gate.resolve();
    const results = await Promise.all([first, second]); assert.equal(results[0].node.id, results[1].node.id);
    assert.equal(f.widget.comicCanvasFrameCaptures.get(f.session).size, 0);
});
test('route change re-evaluates an automatic video reference, but manual mode remains fixed', async () => {
    const f = fixture({ reference: true, supportedVideo: true }), gate = deferred(); f.widget.onExtract = () => gate.promise;
    f.session.capabilities.set('video|new-merchant|model', { capability });
    f.changeRoute({ key: 'new-merchant' });
    while (!f.extracts.length) await tick(); assert.equal(f.node().payload.mode, 'referenceToVideo'); gate.resolve();
    while (f.widget.comicCanvasVideoInputs.get(f.session)?.size) await tick(); assert.equal(f.node().payload.mode, 'imageToVideo');
    assert.equal(f.session.doc.settings.nodeRoutes.target, 'new-merchant');
    const g = fixture({ reference: true }); g.session.doc.settings.manualVideoModes = { target: true }; g.session.reconcile.add('target');
    Widget.prototype.reconcileComicCanvasRoutes.call(g.widget, g.session, { key: 'merchant-model', modelId: 'model' }, capability);
    assert.equal(g.node().payload.mode, 'referenceToVideo'); assert.equal(g.extracts.length, 0); assert.ok(g.notices.includes('modeBlocked'));
});
test('a following source version change cancels binding while pinned references retain the reviewed video', async () => {
    for (const pinned of [false, true]) {
        const f = fixture({ reference: true });
        if (pinned) f.session.doc.edges[0] = { ...f.session.doc.edges[0], binding: 'pinnedVersion', pinnedVersionId: 'v1' };
        const gate = deferred(); f.widget.onExtract = () => gate.promise;
        const pending = f.start(undefined, 'imageToVideo'); while (!f.extracts.length) await tick();
        f.widget.changeComicCanvasSession(f.session, { ...f.session.doc, nodes: f.session.doc.nodes.map(node => node.id === 'source'
            ? { ...node, payload: { versions: [...node.payload.versions, { ...video, id: 'v2', assetId: 'a2', uri: 'new.mp4' }], currentVersionId: 'v2' } } : node) }, true);
        gate.resolve(); await pending;
        assert.equal(f.node().payload.mode, pinned ? 'imageToVideo' : 'referenceToVideo');
        const image = f.session.doc.nodes.find(node => node.kind === 'image'); assert.equal(image.payload.versions[0].provenance.sourceVersionId, 'v1');
    }
});
test('explicit video edit and extend connect using their own capability without a reference-to-video grant', async () => {
    for (const mode of ['videoEdit', 'videoExtend']) {
        const f = fixture();
        f.session.doc.settings.manualVideoModes = { target: true };
        f.node().payload.mode = mode;
        const model = { ...capability, modes: [{ mode, ...common, referenceRules: { video: { supported: true, maxCount: 1, formats: ['mp4'], maxBytes: 1024 } }, combinationConstraints: [{ combination: 'video', maxVideos: 1 }] }] };
        f.session.capabilities.set('video|merchant-model|model', { capability: model });
        await f.start(); assert.deepEqual(f.notices, []); assert.equal(f.node().payload.mode, mode); assert.equal(f.extracts.length, 0);
        assert.equal(f.session.doc.edges.length, 1); assert.equal(f.session.doc.edges[0].role, 'referenceVideo');
        assert.deepEqual(core.validateCanvasDocument(f.session.doc), []);
    }
});
test('additional video references are retained up to the real route count, without an ambiguous fallback extraction', async () => {
    const addSource = (f, id) => { f.session.doc = { ...f.session.doc, nodes: [...f.session.doc.nodes, { ...f.session.doc.nodes[0], id,
        payload: { versions: [{ ...video, id: `v-${id}`, assetId: `a-${id}`, uri: `${id}.mp4` }], currentVersionId: `v-${id}` } }] }; f.session.base = f.session.doc; };
    const f = fixture({ reference: true, supportedVideo: true });
    const model = { ...f.model, modes: f.model.modes.map(mode => mode.mode === 'referenceToVideo' ? { ...mode,
        referenceRules: { video: { ...mode.referenceRules.video, maxCount: 2 } }, combinationConstraints: [{ combination: 'video', maxVideos: 2 }] } : mode) };
    f.session.capabilities.set('video|merchant-model|model', { capability: model });
    addSource(f, 'second'); await f.start('second'); assert.deepEqual(f.notices, []);
    assert.equal(f.session.doc.edges.length, 2); assert.equal(f.session.doc.edges.find(edge => edge.sourceNodeId === 'second').pinnedVersionId, 'v-second'); assert.equal(f.extracts.length, 0);
    addSource(f, 'third'); const before = f.session.doc; await f.start('third'); assert.equal(f.session.doc, before); assert.ok(f.notices.length);
    const g = fixture({ reference: true }); addSource(g, 'second'); const original = g.session.doc;
    await g.start('second'); assert.equal(g.session.doc, original); assert.equal(g.extracts.length, 0); assert.ok(g.notices.length);
});
