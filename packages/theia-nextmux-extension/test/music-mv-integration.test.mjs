import { modelFailure, modelFailureText } from '../lib/browser/nextmux-model-errors.js';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import * as state from '../lib/browser/nextmux-music-mv-state.js';
import { formatManagedVideoEstimate } from '../lib/browser/nextmux-video-price.js';

// Execute the actual renderer methods against delayed, free RPC fixtures.
const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['musicGenerateMv', 'musicMvEdit', 'musicCommand', 'musicMvKey', 'musicMvEstimate', 'reconcileMusicMv', 'musicMvHasLiveJobs']);
const methods = [];
(function visit(node) {
    if (ts.isMethodDeclaration(node) && names.has(node.name.getText(ast))) methods.push(node.getText(ast));
    ts.forEachChild(node, visit);
})(ast);
assert.equal(methods.length, names.size);
const compiled = ts.transpileModule(`
const { modelFailure, modelFailureText, musicMvConfirmationKey, musicMvSegmentCurrent, musicMvRequestSeconds, formatManagedVideoEstimate } = deps;
const musicMvText = (_locale, key) => key;
const optionalKeyPriceQuoteId = quote => quote;
const mediaRuntimeText = (_locale, key) => key;
class Harness { ${methods.join('\n')} }
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const Harness = new Function('deps', `${compiled}\nreturn Harness;`)({ ...state, formatManagedVideoEstimate, modelFailure, modelFailureText });

function fixture() {
    const h = new Harness();
    const segments = [0, 1].map(index => ({ id: `segment-${index + 1}`, sectionIndex: index, sectionTitle: '',
        startMs: index * 10000, endMs: (index + 1) * 10000, lineIds: [], prompt: `Scene ${index}`, source: 'ai-video' }));
    h.project = { id: 'project-fixture', revision: 1, frameRate: 24, assets: [], canvas: { width: 1280, height: 720 },
        music: { selectedAssetId: 'asset-song', lyrics: 'a', instrumental: false,
            mv: { songAssetId: 'asset-song', lyrics: 'a', durationMs: 20000, alignment: 'estimated', lines: [], segments } } };
    h.route = { kind: 'managed', id: 'route-fixture', model: 'veo-3.1', offering: { keyPriceQuoteId: 'fixture-quote', price: { currency: 'USD', videoSecondMicros: 125000 } } };
    Object.assign(h, { activeComicWorkspaceRoot: '/fixture', musicMvWrites: Promise.resolve(), musicMvGenerating: false,
        musicMvReconciling: false, mediaState: { jobs: [] }, desktopLocale: 'en', calls: [],
        update() {}, syncComicSelection() {}, comicProject() { return this.project; }, comicStepMediaRoute() { return this.route; },
        musicSongShot() { return { scene: { id: 'scene-fixture' }, shot: { id: 'shot-fixture' } }; },
        async loadMediaState() {}, async loadComicProject() {}, async musicMvVisualInput(_project, _mv, segment) { return { prompt: segment.prompt }; } });
    h.platformService = {
        async applyComicCommand({ command }) {
            if (h.beforeSave) await h.beforeSave();
            h.project = { ...h.project, ...command.patch, revision: h.project.revision + 1 };
            h.calls.push(['save', h.project.music.mv.segments.map(s => s.jobId)]);
            return { project: h.project };
        },
        async enqueueMediaJob({ job }) {
            h.calls.push(['enqueue', job]);
            if (h.onEnqueue) await h.onEnqueue();
            return { id: `media-job-fixture-${h.calls.filter(call => call[0] === 'enqueue').length}` };
        },
        async confirmMediaJob(root, id) {
            assert.equal(root, '/fixture');
            assert.ok(h.project.music.mv.segments.some(segment => segment.jobId === id), 'persist association before spending');
            h.calls.push(['confirm', id]);
            if (h.confirmError) throw new Error('price quote expired');
        },
        async cancelMediaJob(_root, id) { h.calls.push(['cancel', id]); }
    };
    return h;
}

test('MV batch confirms existing video jobs only after saving each section, with the quoted model and actual clip cost', async () => {
    const h = fixture();
    assert.equal(h.musicMvEstimate(h.project, ['segment-1', 'segment-2']), '$2.00');
    await h.musicGenerateMv(['segment-1', 'segment-2'], h.musicMvKey(h.project));
    assert.deepEqual(h.calls.map(call => call[0]), ['enqueue', 'save', 'confirm', 'enqueue', 'save', 'confirm']);
    const inputs = h.calls.filter(call => call[0] === 'enqueue').map(call => call[1].input);
    assert.deepEqual(inputs.map(input => input.musicMvSegmentId), ['segment-1', 'segment-2']);
    assert.ok(inputs.every(input => input.durationSeconds === 8 && input.requestAudio === false && input.requestSubtitles === false && input.keyPriceQuoteId === 'fixture-quote'));
});

test('a changed quote/model or edited prompt invalidates confirmation before any billable job exists', async () => {
    for (const mutate of [h => { h.route.model = 'sora-2'; }, h => { h.route.offering.keyPriceQuoteId = 'another-quote'; },
        h => { h.project.music.mv.segments[0].prompt = 'Edited'; }]) {
        const h = fixture(), key = h.musicMvKey(h.project);
        mutate(h);
        await h.musicGenerateMv(['segment-1'], key);
        assert.equal(h.calls.length, 0);
        assert.equal(h.musicMvError, 'stale');
    }
});

test('switching songs while enqueue returns cancels the unconfirmed old section instead of charging the new song', async () => {
    const h = fixture();
    h.onEnqueue = () => { h.project.music.selectedAssetId = 'asset-another-song'; };
    await h.musicGenerateMv(['segment-1', 'segment-2'], h.musicMvKey(h.project));
    assert.equal(h.calls.filter(call => call[0] === 'enqueue').length, 1);
    assert.equal(h.calls.filter(call => call[0] === 'confirm').length, 0);
    assert.equal(h.calls.filter(call => call[0] === 'cancel').length, 1);
    assert.ok(h.project.music.mv.segments.every(segment => !segment.jobId));
});

test('a rejected price confirmation cancels the waiting job and stops the batch', async () => {
    const h = fixture(); h.confirmError = true;
    await h.musicGenerateMv(['segment-1', 'segment-2'], h.musicMvKey(h.project));
    assert.equal(h.calls.filter(call => call[0] === 'enqueue').length, 1);
    assert.equal(h.calls.filter(call => call[0] === 'cancel').length, 1);
    assert.equal(h.musicMvFailure.domain, 'operation');
    assert.doesNotMatch(h.musicMvError, /price quote expired|model request failed/i);
    assert.match(h.musicMvErrorDetail, /^price quote expired(?:\nError)?$/);
    assert.notEqual(modelFailureText('ja', h.musicMvFailure), h.musicMvError, 'stored failure follows the current UI language');
    assert.equal(h.musicMvGenerating, false);
});

test('finished jobs attach by segment job id and leave uploaded media intact', async () => {
    const h = fixture();
    h.project.music.mv.segments[0].jobId = 'media-job-one';
    Object.assign(h.project.music.mv.segments[1], { source: 'upload-image', assetId: 'asset-upload', jobId: 'media-job-two' });
    h.project.assets = [
        { id: 'asset-video-one', kind: 'video', status: 'ready', jobId: 'media-job-one' },
        { id: 'asset-video-two', kind: 'video', status: 'ready', jobId: 'media-job-two' }
    ];
    h.mediaState.jobs = [
        { id: 'media-job-two', projectId: h.project.id, kind: 'video', status: 'succeeded', output: { assetId: 'asset-video-two' } },
        { id: 'media-job-one', projectId: h.project.id, kind: 'video', status: 'succeeded', output: { assetId: 'asset-video-one' } }
    ];
    h.reconcileMusicMv(); await h.musicMvWrites;
    assert.deepEqual(h.project.music.mv.segments.map(segment => segment.assetId), ['asset-video-one', 'asset-upload']);
});

test('restored history and output without a ready project asset never attach a phantom MV clip', async () => {
    const h = fixture();
    h.project.music.mv.segments[0].jobId = 'media-job-old';
    h.project.music.mv.segments[1].jobId = 'media-job-missing';
    h.mediaState.jobs = [
        { id: 'media-job-old', projectId: h.project.id, kind: 'video', status: 'succeeded', restoredHistoryOnly: true,
            output: { assetId: 'asset-old' } },
        { id: 'media-job-missing', projectId: h.project.id, kind: 'video', status: 'succeeded',
            output: { assetId: 'asset-missing' } }
    ];
    h.reconcileMusicMv(); await h.musicMvWrites;
    assert.deepEqual(h.project.music.mv.segments.map(segment => segment.assetId), [undefined, undefined]);
    assert.equal(h.calls.length, 0);
});

test('rapid timing edits serialize and keep both changes against the latest revision', async () => {
    const h = fixture();
    await Promise.all([
        h.musicMvEdit(mv => ({ ...mv, alignment: 'tapped' })),
        h.musicMvEdit(mv => ({ ...mv, segments: mv.segments.map(segment => ({ ...segment, prompt: 'Saved edit' })) }))
    ]);
    assert.equal(h.project.music.mv.alignment, 'tapped');
    assert.ok(h.project.music.mv.segments.every(segment => segment.prompt === 'Saved edit'));
    assert.equal(h.project.revision, 3);
});


test('MV performer portraits add one input-image fee per generated segment to confirmation and queued cost', async () => {
    const h = fixture();
    h.route.offering.price.videoInputImageEachMicros = 40_000;
    h.project.assets.push({ id: 'singer', kind: 'image', status: 'ready', uri: 'nextmux.media/singer.png' });
    h.project.music.mv.singerPortraitAssetId = 'singer';
    h.project.music.mv.segments = h.project.music.mv.segments.map(segment => ({ ...segment, performance: true }));
    assert.match(h.musicMvEstimate(h.project, ['segment-1', 'segment-2']), /\$2\.08.*2 input images \$0\.08/u);
    await h.musicGenerateMv(['segment-1', 'segment-2'], h.musicMvKey(h.project));
    const enqueued = h.calls.filter(call => call[0] === 'enqueue').map(call => call[1]);
    assert.equal(enqueued.length, 2);
    assert.ok(enqueued.every(job => /\$1\.04.*1 input images \$0\.04/u.test(job.cost.description)));
});
