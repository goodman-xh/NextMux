import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
const require = createRequire(import.meta.url), ts = require('typescript');
const dir = await mkdtemp(join(tmpdir(), 'nm-start-frame-flow-'));
const source = await readFile(new URL('../src/browser/nextmux-comic-start-frame-flow.ts', import.meta.url), 'utf8');
await writeFile(join(dir, 'flow.cjs'), ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
const { runComicStartFrameFlow } = require(join(dir, 'flow.cjs'));
test.after(() => rm(dir, { recursive: true, force: true }));
function fixture(status = 'awaiting_confirmation') {
    const calls = [], control = { cancelled: false };
    const state = { canvas: { revision: 7 } };
    const ready = { state, preparationId: 'prepared', job: { id: 'image-job', status: 'succeeded' }, version: { id: 'frame' }, applied: false, videoContinuationKey: 'original-video-click', videoIntentFingerprint: 'reviewed-video-intent' };
    const initial = { ...ready, job: { id: 'image-job', status }, ...(status !== 'succeeded' ? { version: undefined } : {}) };
    const service = {
        async runComicCanvasStartFrame(r) { calls.push(['image', r]); return initial; },
        async getComicCanvasStartFrame(r) { calls.push(['poll', r]); return ready; },
        async applyComicCanvasStartFrame(r) { calls.push(['apply', r]); ready.applied = true; return state; },
        async confirmMediaJob(...r) { calls.push(['confirm', ...r]); },
        async cancelMediaJob(...r) { calls.push(['cancel', ...r]); },
        async runComicCanvasNode(r) { calls.push(['video', r]); return { state, job: { id: 'video-job', status: 'awaiting_confirmation' } }; },
    };
    const options = { service, request: { workspaceRoot: '/isolated', canvasId: 'canvas', nodeId: 'node' }, plan: { fingerprint: 'original-inputs' },
        imageClickKey: 'original-image-click', newVideoClickKey: 'new-video-click', control, adopt() {}, videoRequest: { workspaceRoot: '/isolated', canvasId: 'canvas', nodeId: 'node' }, async wait() {} };
    return { calls, control, state, ready, initial, service, options };
}
test('one consent dispatches the confirmed image and exactly one video with durable identity', async () => {
    const f = fixture(); const result = await runComicStartFrameFlow(f.options);
    assert.equal(result.job.id, 'video-job');
    assert.deepEqual(f.calls.map(c => c[0]), ['image', 'confirm', 'poll', 'poll', 'apply', 'poll', 'video']);
    assert.equal(f.calls[0][1].acceptedTwoStepBilling, true);
    assert.equal(f.calls.at(-1)[1].idempotencyKey, 'original-video-click');
    assert.equal(f.calls.at(-1)[1].expectedRevision, 7);
    assert.deepEqual(f.calls.at(-1)[1].startFrameContinuation, { preparationId: 'prepared', intentFingerprint: 'reviewed-video-intent' });
});
test('cancelling while the image response is outstanding cancels it without confirmation or video dispatch', async () => {
    const f = fixture(); f.service.runComicCanvasStartFrame = async () => { f.control.cancelled = true; return f.initial; };
    assert.equal(await runComicStartFrameFlow(f.options), undefined);
    assert.deepEqual(f.calls.map(c => c[0]), ['cancel']);
});
test('cancelling during apply keeps the paid image but starts no video', async () => {
    const f = fixture('succeeded'); f.service.applyComicCanvasStartFrame = async () => { f.control.cancelled = true; f.ready.applied = true; return f.state; };
    assert.equal(await runComicStartFrameFlow(f.options), undefined);
    assert.equal(f.calls.some(c => c[0] === 'video'), false);
});
test('a failed image is not automatically retried or followed by a video', async () => {
    const f = fixture('failed'); await assert.rejects(runComicStartFrameFlow(f.options), /START_FRAME_IMAGE_INCOMPLETE/);
    assert.deepEqual(f.calls.map(c => c[0]), ['image']);
});
test('an attached image is not used before the image task reaches its successful terminal state', async () => {
    const f = fixture('running'); f.initial.version = { id: 'frame' }; let polls = 0;
    f.service.getComicCanvasStartFrame = async () => { polls++; return f.ready; };
    await runComicStartFrameFlow(f.options); assert.ok(polls >= 2);
    assert.deepEqual(f.calls.map(c => c[0]), ['image', 'apply', 'video']);
});
test('lost video reply returns the original in-progress job without a second dispatch', async () => {
    const f = fixture('succeeded'); f.ready.applied = true; f.ready.videoJob = { id: 'existing-video', status: 'running' };
    const result = await runComicStartFrameFlow(f.options);
    assert.equal(result.job.id, 'existing-video'); assert.deepEqual(f.calls.map(c => c[0]), ['image', 'poll']);
});
test('explicitly regenerating a finished video uses a new video identity and reuses the completed image', async () => {
    const f = fixture('succeeded'); f.ready.applied = true; f.ready.videoJob = { id: 'finished-video', status: 'succeeded' };
    await runComicStartFrameFlow(f.options);
    assert.equal(f.calls.at(-1)[1].idempotencyKey, 'new-video-click'); assert.deepEqual(f.calls.map(c => c[0]), ['image', 'poll', 'video']);
});
test('a cached image respects the newly reviewed video route and intent', async () => {
    const f = fixture('succeeded'); f.options.plan.videoIntentFingerprint = 'current-video-intent';
    f.options.request.videoConnectionId = 'chosen-api'; f.options.request.videoKeyPriceQuoteId = 'chosen-quote';
    await runComicStartFrameFlow(f.options);
    const applied = f.calls.find(c => c[0] === 'apply')[1];
    assert.equal(applied.videoConnectionId, 'chosen-api'); assert.equal(applied.videoKeyPriceQuoteId, 'chosen-quote');
    assert.equal(applied.intentFingerprint, 'current-video-intent');
    assert.equal(f.calls.at(-1)[1].startFrameContinuation.intentFingerprint, 'current-video-intent');
});
test('cancelling while the video reservation reply is outstanding cancels the real reserved job', async () => {
    const f = fixture('succeeded'); f.service.runComicCanvasNode = async r => { f.calls.push(['video', r]); f.control.cancelled = true;
        return { state: f.state, job: { id: 'video-job', status: 'awaiting_confirmation' } }; };
    assert.equal(await runComicStartFrameFlow(f.options), undefined);
    assert.deepEqual(f.calls.at(-1), ['cancel', '/isolated', 'video-job']);
    assert.equal(f.control.jobId, 'video-job');
});

const quotaFailure = () => ({ code: 'AUTH_FAILED', message: 'private fixture supplier detail must not become UI copy', retryable: false,
    readableError: { kind: 'provider_quota_exhausted', code: 'AUTH_FAILED', source: 'own_api' } });
test('a failed image retains its structured failure on the original incomplete exception without video dispatch', async () => {
    const f = fixture('failed'), failure = quotaFailure(); f.initial.job.failure = failure;
    await assert.rejects(runComicStartFrameFlow(f.options), error => error.message === 'START_FRAME_IMAGE_INCOMPLETE' && error.startFrameImageFailure === failure);
    assert.deepEqual(f.calls.map(call => call[0]), ['image']);
});
test('a polled failed image retains the exact structured failure and cannot apply or dispatch a video', async () => {
    const f = fixture('running'), failure = quotaFailure();
    f.service.getComicCanvasStartFrame = async r => { f.calls.push(['poll', r]); return { ...f.ready, version: undefined, job: { id: 'image-job', status: 'failed', failure } }; };
    await assert.rejects(runComicStartFrameFlow(f.options), error => error.message === 'START_FRAME_IMAGE_INCOMPLETE' && error.startFrameImageFailure === failure);
    assert.deepEqual(f.calls.map(call => call[0]), ['image', 'poll']);
});
test('the final original image check preserves structured failure without starting a video', async () => {
    const f = fixture('succeeded'), failure = quotaFailure();
    f.service.getComicCanvasStartFrame = async r => { f.calls.push(['poll', r]); return { ...f.ready, version: undefined, job: { id: 'image-job', status: 'failed', failure } }; };
    await assert.rejects(runComicStartFrameFlow(f.options), error => error.message === 'START_FRAME_IMAGE_INCOMPLETE' && error.startFrameImageFailure === failure);
    assert.deepEqual(f.calls.map(call => call[0]), ['image', 'poll']);
});
for (const status of ['cancelled', 'paused', 'interrupted']) test(`${status} remains incomplete without failure promotion or video dispatch`, async () => {
    const f = fixture(status); f.initial.job.failure = quotaFailure();
    await assert.rejects(runComicStartFrameFlow(f.options), error => error.message === 'START_FRAME_IMAGE_INCOMPLETE' && error.startFrameImageFailure === undefined);
    assert.deepEqual(f.calls.map(call => call[0]), ['image']);
});
