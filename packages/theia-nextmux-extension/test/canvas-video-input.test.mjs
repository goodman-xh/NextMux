import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceModule, comicCoreSource as core } from './helpers/comic-organizer-source-loader.mjs';
const { inspectCanvasVideoInputCapability: inspect, resolveCanvasVideoInput: resolve, convertCanvasVideoInputToFrame: convert } = sourceModule('browser/nextmux-comic-canvas-video-input.ts');
const now = '2026-10-04T00:00:00Z';
const video = { id: 'v1', assetId: 'a1', kind: 'video', uri: 'source.mp4', createdAt: now, metadata: { mimeType: 'video/mp4', width: 1280, height: 720, byteLength: 1024, durationMs: 5000 } };
const frame = { id: 'f1', assetId: 'af', kind: 'image', uri: 'tail.png', createdAt: now, metadata: { mimeType: 'image/png', width: 1280, height: 720, byteLength: 500 }, provenance: { operation: 'frameExtract', sourceNodeId: 'source', sourceVersionId: 'v1', frameSelection: { kind: 'last' } } };
const rule = { supported: true, maxCount: 1, maxBytes: 2048, formats: ['mp4'], minDurationSeconds: 1, maxDurationSeconds: 10 };
const output = { outputVariants: [{ id: '720', resolution: '720p', aspectRatios: ['16:9'] }], duration: { kind: 'fixed', seconds: 5 }, audioGeneration: { mode: 'unsupported', defaultEnabled: false } };
const capability = { id: 'model', providerId: 'merchant', providerModelId: 'model', displayName: 'Model', version: '1', status: 'available', sources: [], modes: [
    { mode: 'referenceToVideo', ...output, referenceRules: { video: rule }, combinationConstraints: [{ combination: 'video', maxVideos: 1 }] },
    { mode: 'imageToVideo', ...output, firstFrame: true, frameImageRule: { supported: true, maxCount: 1, formats: ['png'], maxBytes: 1024 } }
] };
const item = (id, kind, payload) => ({ id, kind, title: id, position: { x: 0, y: 0 }, size: { width: 360, height: 260 }, payload });
function fixture(binding = 'followCurrent') {
    return { ...core.createCanvasDocument({ id: 'canvas', projectId: 'project', now }), nodes: [
        item('source', 'video', { versions: [video, { ...video, id: 'v2', assetId: 'a2', uri: 'new.mp4' }], currentVersionId: 'v1' }),
        item('target', 'videoGen', { versions: [], mode: 'referenceToVideo', modelId: 'model', prompt: '', parameters: {} }),
        item('frame', 'frameExtract', { selection: { kind: 'last' }, versions: [frame], currentVersionId: 'f1' })
    ], edges: [{ id: 'video-edge', sourceNodeId: 'source', sourcePort: 'output', targetNodeId: 'target', targetPort: 'referenceVideo', role: 'referenceVideo', order: 0, binding, ...(binding === 'pinnedVersion' ? { pinnedVersionId: 'v1' } : {}) }] };
}
const request = canvas => ({ targetNodeId: 'target', input: resolve(canvas, 'target').input, frameNodeId: 'frame', frameVersionId: 'f1', capability, edgeId: 'frame-edge', now });
test('real mode and video rules, metadata limits, and unresolved capability states determine support', () => {
    assert.equal(inspect({ loading: true }, video).state, 'loading');
    assert.equal(inspect({}, video).state, 'unknown');
    assert.equal(inspect({ error: 'offline' }, video).state, 'error');
    assert.equal(inspect({ capability }, video).referenceVideo, 'supported');
    assert.equal(inspect({ capability }, video).imageToVideo, 'supported');
    assert.equal(inspect({ capability: { ...capability, modes: [{ ...capability.modes[1], frameImageRule: { supported: false, maxCount: 0 } }] } }, video).imageToVideo, 'unsupported');
    const imageReferencesOnly = { ...capability, modes: [{ mode: 'referenceToVideo', ...output, referenceRules: { image: rule } }] };
    assert.equal(inspect({ capability: imageReferencesOnly }, video).referenceVideo, 'unknown');
    assert.equal(inspect({ capability: imageReferencesOnly }, video).imageToVideo, 'unsupported');
    assert.equal(inspect({ capability }, { ...video, metadata: { ...video.metadata, byteLength: 9999 } }).referenceVideo, 'invalid');
    assert.equal(inspect({ capability }, { ...video, metadata: { ...video.metadata, byteLength: undefined } }).referenceVideo, 'unknown');
});
test('pinned edge, following edge and direct references resolve exactly one existing ready version', () => {
    const canvas = fixture('pinnedVersion'); canvas.nodes[0].payload.currentVersionId = 'v2';
    assert.equal(resolve(canvas, 'target').input.version.id, 'v1');
    canvas.edges[0] = { ...canvas.edges[0], binding: 'followCurrent', pinnedVersionId: undefined };
    assert.equal(resolve(canvas, 'target').input.version.id, 'v2');
    canvas.edges = []; canvas.nodes[1].payload.inputs = [{ id: 'direct', role: 'referenceVideo', order: 0, version: video }];
    assert.equal(resolve(canvas, 'target').input.inputId, 'direct');
    canvas.nodes[1].payload.inputs.push({ id: 'second', role: 'referenceVideo', order: 1, version: video });
    assert.equal(resolve(canvas, 'target').code, 'VIDEO_INPUT_AMBIGUOUS');
    canvas.nodes[1].payload.inputs.pop(); canvas.nodes[1].payload.inputs[0].version = { ...video, status: 'missing' };
    assert.equal(resolve(canvas, 'target').code, 'VIDEO_INPUT_UNAVAILABLE');
});
test('conversion pins the real frame, preserves other compatible inputs and does not require a draft prompt', () => {
    const canvas = fixture();
    canvas.nodes.push(item('text', 'text', { text: '' }));
    canvas.edges.push({ id: 'text-edge', sourceNodeId: 'text', sourcePort: 'output', targetNodeId: 'target', targetPort: 'prompt', role: 'prompt', order: 0, binding: 'followCurrent' });
    const before = structuredClone(canvas), result = convert(canvas, request(canvas));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(canvas, before);
    assert.equal(result.canvas.nodes[1].payload.mode, 'imageToVideo');
    assert.equal(result.canvas.nodes[1].payload.prompt, '');
    assert.equal(result.canvas.revision, canvas.revision + 1);
    assert.equal(result.canvas.edges.find(edge => edge.id === 'frame-edge').pinnedVersionId, 'f1');
    assert.deepEqual(result.canvas.edges.find(edge => edge.id === 'text-edge'), canvas.edges[1]);
    assert.equal(result.canvas.edges.some(edge => edge.id === 'video-edge'), false);
    assert.deepEqual(result.canvas.sequenceLinks ?? [], []);
});
test('only an explicit new playback continuation adds sequence; failures leave the document unchanged', () => {
    const canvas = fixture(), options = request(canvas);
    const result = convert(canvas, { ...options, sequence: { id: 'playback', sourceNodeId: 'source' } });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.canvas.sequenceLinks, [{ id: 'playback', sourceNodeId: 'source', targetNodeId: 'target' }]);
    const bad = convert(canvas, { ...options, sequence: { id: 'bad', sourceNodeId: 'frame' } });
    assert.equal(bad.ok, false); assert.equal(bad.canvas, canvas);
});
test('stale source, wrong provenance, unknown actual frame bytes and incompatible retained media cannot partly convert', () => {
    for (const mutate of [
        canvas => { canvas.nodes[0].payload.currentVersionId = 'v2'; },
        canvas => { canvas.nodes[2].payload.versions = [{ ...frame, provenance: { ...frame.provenance, sourceVersionId: 'v2' } }]; },
        canvas => { canvas.nodes[2].payload.versions = [{ ...frame, metadata: { ...frame.metadata, byteLength: undefined } }]; },
        canvas => { canvas.nodes[1].payload.inputs = [{ id: 'audio', role: 'referenceAudio', order: 0, version: { ...video, kind: 'audio', uri: 'voice.wav' } }]; },
        canvas => { canvas.nodes[1].payload.inputs = [{ id: 'duplicate-frame', role: 'firstFrame', order: 0, version: frame }]; },
        canvas => { canvas.nodes[1].payload.modelId = 'different-model'; }
    ]) {
        const canvas = fixture(), options = request(canvas); mutate(canvas); const before = structuredClone(canvas);
        const result = convert(canvas, options);
        assert.equal(result.ok, false); assert.equal(result.canvas, canvas); assert.deepEqual(canvas, before);
    }
});
test('direct input conversion preserves all other direct references and removes obsolete continuity', () => {
    const canvas = fixture(); canvas.edges = [];
    canvas.nodes[1].payload.inputs = [{ id: 'direct-video', role: 'referenceVideo', order: 0, version: video }];
    // This deliberately stale metadata must not be passed to validation in the converted document.
    canvas.nodes[1].payload.continuity = { obsolete: true };
    const result = convert(canvas, request(canvas));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.canvas.nodes[1].payload.inputs.length, 1);
    assert.equal(result.canvas.nodes[1].payload.inputs[0].role, 'firstFrame');
    assert.equal(result.canvas.nodes[1].payload.inputs[0].version.id, 'f1');
    assert.equal(result.canvas.edges.length, 0);
    assert.equal('continuity' in result.canvas.nodes[1].payload, false);
    assert.equal(canvas.nodes[1].payload.inputs.length, 1);
});

test('a node-free direct extracted version becomes a frozen first frame without creating nodes or wires', () => {
    const canvas = fixture(); canvas.edges = []; canvas.nodes = canvas.nodes.slice(0, 2);
    canvas.nodes[1].payload.inputs = [{ id: 'direct-video', role: 'referenceVideo', order: 0, version: video }];
    const { sourceNodeId: _source, ...provenance } = frame.provenance;
    const directFrame = { ...frame, provenance };
    const options = { targetNodeId: 'target', input: resolve(canvas, 'target').input, frameVersion: directFrame, capability, edgeId: 'direct-first', now };
    const result = convert(canvas, options); assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.canvas.nodes.length, canvas.nodes.length); assert.deepEqual(result.canvas.edges, []);
    const direct = result.canvas.nodes[1].payload.inputs[0]; assert.equal(direct.version.assetId, 'af'); assert.equal(direct.id, 'direct-first');
    assert.notEqual(direct.version, directFrame); assert.equal(canvas.nodes[1].payload.inputs[0].role, 'referenceVideo');
    assert.deepEqual(core.parseCanvasDocument(core.serializeCanvasDocument(result.canvas)), result.canvas);
});
