import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { enqueueRequest } from '@nextmux/media-core';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

async function fixture(t) {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-mv-queue-'));
    t.diagnostic(`Offline MV queue fixture retained at ${root}`);
    const workspace = join(root, 'workspace'); await mkdir(workspace);
    const dispatched = [];
    class Service extends NextMuxPlatformServiceImpl {
        nextmuxDataRoot() { return join(root, 'state'); }
        scheduleMediaWorker() { /* Paid jobs only run when the fixture explicitly starts the existing worker. */ }
        async executeMediaJob(_root, job) {
            dispatched.push(job.id);
            await new Promise(resolve => setTimeout(resolve, 10));
            return { assetId: `asset-${randomUUID()}`, assetKind: 'video', relativeUri: `nextmux.media/${job.id}.mp4`,
                mimeType: 'video/mp4', byteLength: 8, sha256: 'a'.repeat(64), provider: 'offline fixture', model: 'sora-2' };
        }
    }
    const service = new Service();
    let state = await service.createComicProject({ workspaceRoot: workspace, projectKind: 'music', starter: 'storyboard',
        canvas: { aspectRatio: '16:9', width: 640, height: 360 }, frameRate: 24 });
    const sceneId = state.project.scenes[0].id, shotId = state.project.scenes[0].shots[0].id;
    const command = async command => {
        state = await service.getComicProject(workspace);
        state = await service.applyComicCommand({ workspaceRoot: workspace, command: { ...command, expectedRevision: state.project.revision } });
    };
    await command({ type: 'shot.update', sceneId, shotId, patch: { durationFrames: 720 } });
    const mv = { songAssetId: 'asset-song-fixture', lyrics: '', durationMs: 30000, alignment: 'estimated', lines: [], segments: [
        { id: 'segment-1', sectionIndex: 0, sectionTitle: '', startMs: 0, endMs: 15000, lineIds: [], prompt: 'red mountain', source: 'ai-video' },
        { id: 'segment-2', sectionIndex: 0, sectionTitle: '', startMs: 15000, endMs: 30000, lineIds: [], prompt: 'blue ocean', source: 'ai-video' }
    ] };
    const music = { lyrics: '', instrumental: true, genre: '', mood: '', tempo: '', vocals: '', language: '', style: '', length: 'full', format: 'wav',
        selectedAssetId: mv.songAssetId, mv };
    await command({ type: 'project.update', patch: { music } });
    const enqueue = async (index, inputPatch = {}) => service.enqueueMediaJob({ workspaceRoot: workspace, job: {
        idempotencyKey: `mv-test-${randomUUID()}`, kind: 'video', projectId: state.project.id, sceneId, shotId,
        input: { musicMvSegmentId: mv.segments[index].id, connectionId: 'managed:fixed:11111111-2222-4333-8444-555555555555',
            model: 'sora-2', prompt: mv.segments[index].prompt, durationSeconds: 12, width: 640, height: 360, ...inputPatch },
        cost: { billing: 'platform_billed', description: 'offline fixture; no network provider' }
    } });
    const saveJobs = async jobs => {
        await command({ type: 'project.update', patch: { music: { ...music, mv: { ...mv,
            segments: mv.segments.map((segment, index) => ({ ...segment, ...(jobs[index] ? { jobId: jobs[index].id } : {}) })) } } } });
    };
    return { service, workspace, dispatched, enqueue, saveJobs, command, mv, music, state: () => state };
}

test('two MV segments reuse the normal paid queue on one song shot and wait for confirmation', async t => {
    const f = await fixture(t);
    const jobs = [await f.enqueue(0), await f.enqueue(1)];
    assert.deepEqual(jobs.map(job => job.status), ['awaiting_confirmation', 'awaiting_confirmation']);
    assert.equal(jobs[0].shotId, jobs[1].shotId);
    assert.notEqual(jobs[0].id, jobs[1].id);
    assert.match(jobs[0].input.musicMvSnapshot, /^[a-f0-9]{64}$/);
    assert.notEqual(jobs[0].input.musicMvSnapshot, jobs[1].input.musicMvSnapshot);
    assert.equal(f.dispatched.length, 0);
    await assert.rejects(f.service.confirmMediaJob(f.workspace, jobs[0].id), error => error.code === 'STALE_MEDIA_REQUEST');
    await f.saveJobs(jobs);
    for (const job of jobs) assert.equal((await f.service.confirmMediaJob(f.workspace, job.id)).status, 'queued');
    const store = await f.service.mediaJobStore(f.workspace);
    await f.service.runMediaWorker(f.workspace, store);
    assert.equal(f.dispatched.length, 2);
    assert.deepEqual(await Promise.all(jobs.map(async job => (await store.get(job.id)).status)), ['succeeded', 'succeeded']);
    const final = await f.service.getComicProject(f.workspace);
    assert.equal(final.project.assets.filter(asset => jobs.some(job => job.id === asset.jobId)).length, 2, 'both concurrently attached versions survive');
});

test('MV enqueue validates segment, prompt, model clip duration and normalized queue identity', async t => {
    const f = await fixture(t);
    for (const patch of [{ musicMvSegmentId: 'missing' }, { prompt: 'different prompt' }, { durationSeconds: 15 }, { durationSeconds: 30 }]) {
        await assert.rejects(f.enqueue(0, patch), error => error.code === 'STALE_MEDIA_REQUEST');
    }
    await assert.rejects(f.enqueue(0, { musicMvSegmentId: '../unsafe' }), error => error.code === 'INVALID_MEDIA_REQUEST');
    const job = await f.enqueue(0);
    assert.equal(enqueueRequest(job).input.musicMvSegmentId, 'segment-1');
    assert.equal(enqueueRequest(job).input.musicMvSnapshot, job.input.musicMvSnapshot, 'identity survives queue serialization');
});

test('changed song, changed source or changed segment cannot release an old paid MV job', async t => {
    const f = await fixture(t);
    const job = await f.enqueue(0);
    await f.saveJobs([job]);
    const music = f.state().project.music;
    await f.command({ type: 'project.update', patch: { music: { ...music, selectedAssetId: 'asset-next-song', mv: { ...music.mv, songAssetId: 'asset-next-song' } } } });
    await assert.rejects(f.service.confirmMediaJob(f.workspace, job.id), error => error.code === 'STALE_MEDIA_REQUEST');
    await f.saveJobs([job]);
    await f.command({ type: 'project.update', patch: { music: { ...f.state().project.music,
        mv: { ...f.state().project.music.mv, segments: f.state().project.music.mv.segments.map(segment => ({ ...segment, source: 'upload-video' })) } } } });
    await assert.rejects(f.service.confirmMediaJob(f.workspace, job.id), error => error.code === 'STALE_MEDIA_REQUEST');
    await f.saveJobs([job]);
    assert.equal((await f.service.confirmMediaJob(f.workspace, job.id)).status, 'queued');
    await f.command({ type: 'project.update', patch: { music: { ...f.state().project.music,
        mv: { ...f.state().project.music.mv, segments: f.state().project.music.mv.segments.map(segment => ({ ...segment, prompt: 'changed after confirmation' })) } } } });
    const store = await f.service.mediaJobStore(f.workspace);
    await f.service.runMediaWorker(f.workspace, store);
    assert.equal(f.dispatched.length, 0, 'worker rechecks immediately before any provider execution');
    assert.equal((await store.get(job.id)).status, 'failed');
});

test('English MV requests remain bound to the authored Chinese prompt at enqueue, confirmation and execution', async t => {
    const f = await fixture(t);
    const sourcePrompt = '歌手走过雨中的街道';
    f.mv.segments[0].prompt = sourcePrompt;
    await f.command({ type: 'project.update', patch: { music: f.music } });
    const translated = 'The singer walks through a rainy street. No text or lyrics on screen.';
    const job = await f.enqueue(0, { prompt: translated, musicMvSourcePrompt: sourcePrompt });
    assert.equal(job.input.prompt, translated);
    assert.equal(job.input.musicMvSourcePrompt, sourcePrompt);
    assert.equal(enqueueRequest(job).input.musicMvSourcePrompt, sourcePrompt);
    await assert.rejects(f.enqueue(0, { prompt: translated, musicMvSourcePrompt: '过期的镜头原文' }), error => error.code === 'STALE_MEDIA_REQUEST');
    await f.saveJobs([job]);
    const music = f.state().project.music;
    const changedMusic = { ...music, mv: { ...music.mv,
        segments: music.mv.segments.map(segment => segment.id === job.input.musicMvSegmentId ? { ...segment, prompt: '用户改为歌手停在门前' } : segment) } };
    await f.command({ type: 'project.update', patch: { music: changedMusic } });
    await assert.rejects(f.service.confirmMediaJob(f.workspace, job.id), error => error.code === 'STALE_MEDIA_REQUEST');
    await f.saveJobs([job]);
    assert.equal((await f.service.confirmMediaJob(f.workspace, job.id)).status, 'queued');
    await f.command({ type: 'project.update', patch: { music: changedMusic } });
    const store = await f.service.mediaJobStore(f.workspace);
    await f.service.runMediaWorker(f.workspace, store);
    assert.equal(f.dispatched.length, 0);
    assert.equal((await store.get(job.id)).status, 'failed');
});

test('changing the singer portrait or performance flag invalidates an already saved MV request', async t => {
    const f = await fixture(t);
    for (const id of ['asset-portrait-one', 'asset-portrait-two']) {
        await f.command({ type: 'asset.import', asset: { id, kind: 'image', source: 'imported', uri: `nextmux.media/${id}.png`,
            mimeType: 'image/png', byteLength: 8, sha256: 'b'.repeat(64), jobId: `media-job-${randomUUID()}`, provider: 'local', model: 'portrait.png' } });
    }
    f.mv.singerPortraitAssetId = 'asset-portrait-one';
    f.mv.segments[0].performance = true;
    await f.command({ type: 'project.update', patch: { music: f.music } });
    const job = await f.enqueue(0);
    await f.saveJobs([job]);
    const saved = f.state().project.music;
    await f.command({ type: 'project.update', patch: { music: { ...saved, mv: { ...saved.mv, singerPortraitAssetId: 'asset-portrait-two' } } } });
    await assert.rejects(f.service.confirmMediaJob(f.workspace, job.id), error => error.code === 'STALE_MEDIA_REQUEST');
    await f.command({ type: 'project.update', patch: { music: { ...saved, mv: { ...saved.mv,
        segments: saved.mv.segments.map(segment => ({ ...segment, performance: false })) } } } });
    await assert.rejects(f.service.confirmMediaJob(f.workspace, job.id), error => error.code === 'STALE_MEDIA_REQUEST');
    await f.command({ type: 'project.update', patch: { music: saved } });
    assert.equal((await f.service.confirmMediaJob(f.workspace, job.id)).status, 'queued');
    assert.equal(f.dispatched.length, 0);
});
