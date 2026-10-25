import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { runMediaTranscriptionTool } from '@nextmux/media-core';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

const require = createRequire(import.meta.url);
const ffmpeg = require('@ffmpeg-installer/ffmpeg').path;

test('independent clip recognition uses its own trimmed source without legacy shot mutation', async t => {
    const f = await fixture(t, 'video');
    f.asset.uri = 'nextmux.media/composition-source.mp4';
    const subtitle = join(f.root, 'composition-captions.srt');
    await writeFile(subtitle, '1\n00:00:00,000 --> 00:00:00,500\nOutside selection\n\n2\n00:00:01,250 --> 00:00:02,500\nIndependent range\n');
    await runMediaTranscriptionTool(ffmpeg, ['-hide_banner','-nostdin','-loglevel','error','-f','lavfi','-i','color=c=blue:s=64x64:d=3',
        '-f','lavfi','-i','sine=frequency=440:duration=3','-i',subtitle,'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-c:s','mov_text','-t','3',join(f.root,f.asset.uri)]);
    f.project.composition={schemaVersion:1,tracks:[{id:'track-video',kind:'video',title:'Video'}],clips:[{id:'clip-range',trackId:'track-video',kind:'video',assetId:f.asset.id,
        from:240,durationFrames:24,sourceStartFrames:24,title:'Trimmed video'}]};
    f.service.comicShotTranscriber=async()=>{assert.fail('verified embedded subtitles must not invoke recognition');};
    const before=JSON.stringify(f.project);
    const request={...f.request,sceneId:'composition',shotId:'clip-range',compositionClipId:'clip-range'};
    const result=await f.service.transcribeComicShot(request);
    assert.deepEqual(result.cues,[{text:'Independent range',startFrame:6,durationFrames:18}]);
    assert.equal(JSON.stringify(f.project),before,'recognition does not create or change storyboard shots');
    f.project.composition.tracks.push({id:'track-captions',kind:'text',title:'Captions'});
    f.project.composition.clips.push({id:'native-captions',kind:'text',trackId:'track-captions',assetId:f.asset.id,purpose:'subtitle',from:240,durationFrames:24,sourceStartFrames:24});
    const preview=await f.service.getComicCompositionSubtitlePreview({workspaceRoot:f.root,projectId:f.project.id,expectedRevision:f.project.revision});
    assert.ok(preview.cues[f.asset.id].some(cue=>cue.text==='Independent range'&&cue.startFrame===30));
    f.project.composition.tracks[0].locked=true;
    await assert.rejects(f.service.transcribeComicShot({...request,requestId:'transcribe-locked'}),/不存在|not.*found/i);
});

test('subtitle preview reads verified source captions with the same frame timing as export',async t=>{
    const f=await fixture(t);f.asset.kind='subtitle';f.asset.uri='nextmux.media/captions.srt';
    await writeFile(join(f.root,f.asset.uri),'1\n00:00:01,250 --> 00:00:02,500\nShared timing\n');
    f.project.composition={schemaVersion:1,tracks:[{id:'track-text',kind:'text',title:'Captions'}],clips:[{id:'clip-captions',trackId:'track-text',kind:'text',purpose:'subtitle',assetId:f.asset.id,from:72,durationFrames:24,sourceStartFrames:24}]};
    const result=await f.service.getComicCompositionSubtitlePreview({workspaceRoot:f.root,projectId:f.project.id,expectedRevision:f.project.revision});
    assert.deepEqual(result.cues[f.asset.id],[{text:'Shared timing',startFrame:30,durationFrames:30}]);
    await assert.rejects(f.service.getComicCompositionSubtitlePreview({workspaceRoot:f.root,projectId:f.project.id,expectedRevision:0}),/更新|changed/i);
    f.project.assets.push({id:'missing-hidden-subtitle',kind:'subtitle',status:'ready',uri:'nextmux.media/missing.srt'});
    f.project.composition.tracks.push({id:'hidden-text',kind:'text',title:'Hidden',hidden:true});
    f.project.composition.clips.push({id:'hidden-caption',kind:'text',trackId:'hidden-text',assetId:'missing-hidden-subtitle',from:0,durationFrames:24,sourceStartFrames:0});
    const visible=await f.service.getComicCompositionSubtitlePreview({workspaceRoot:f.root,projectId:f.project.id,expectedRevision:f.project.revision});
    assert.deepEqual(Object.keys(visible.cues),[f.asset.id],'unused missing caption assets cannot suppress valid visible captions');
});

test('detaching audio verifies the real source before saving an independent sound clip',async t=>{
    const f=await fixture(t,'video');f.asset.uri='nextmux.media/silent.mp4';
    await runMediaTranscriptionTool(ffmpeg,['-hide_banner','-nostdin','-loglevel','error','-f','lavfi','-i','color=c=blue:s=64x64:d=1','-c:v','libx264',join(f.root,f.asset.uri)]);
    const after={...f.project,composition:{schemaVersion:1,tracks:[{id:'audio',kind:'audio',title:'Sound'}],clips:[{id:'sound',kind:'audio',trackId:'audio',assetId:f.asset.id,from:0,durationFrames:24,sourceStartFrames:0}]}};
    await assert.rejects(f.service.validateDetachedComicAudio(f.root,f.project,after),error=>error.code==='COMPOSITION_AUDIO_MISSING');
    const sound=join(f.root,'nextmux.media/with-sound.mp4');
    await runMediaTranscriptionTool(ffmpeg,['-hide_banner','-nostdin','-loglevel','error','-i',join(f.root,f.asset.uri),'-f','lavfi','-i','sine=frequency=440:duration=1','-c:v','copy','-c:a','aac','-shortest',sound]);
    f.asset.uri='nextmux.media/with-sound.mp4';
    await f.service.validateDetachedComicAudio(f.root,f.project,after);
});

async function fixture(t, kind = 'audio') {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-shot-asr-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, 'nextmux.media'));
    const asset = { id: 'asset-audio', uri: 'nextmux.media/source.wav', kind, status: 'ready' };
    const shot = { id: 'shot-one', dialogueCues: [], durationFrames: 24, [kind === 'audio' ? 'audioAssetId' : 'videoAssetId']: asset.id };
    const project = { id: 'project-one', revision: 1, frameRate: 24, assets: [asset], scenes: [{ id: 'scene-one', shots: [shot] }] };
    class Service extends NextMuxPlatformServiceImpl {
        nextmuxDataRoot() { return join(root, 'state'); }
        comicProjectStore() { return Promise.resolve({ read: async () => ({ exists: true, project }) }); }
        getMediaRuntimeState() { return Promise.resolve({ ffmpeg: { available: true, path: ffmpeg, source: 'bundled' } }); }
    }
    const service = new Service();
    const request = { requestId: 'transcribe-test-1', workspaceRoot: root, projectId: project.id, sceneId: 'scene-one', shotId: shot.id, expectedRevision: 1 };
    return { root, asset, shot, project, service, request };
}

test('shot transcription uses local audio and returns review cues without changing dialogue', async t => {
    const f = await fixture(t);
    await runMediaTranscriptionTool(ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', join(f.root, f.asset.uri)]);
    f.shot.mediaSourceStartFrames = { [f.asset.id]: 24 };
    f.service.comicShotTranscriber = async () => ({ id: 'whisper.cpp', localOnly: true, async transcribe() {
        return { segments: [{ text: '你好', startMs: 100, endMs: 800 }] };
    } });
    const result = await f.service.transcribeComicShot(f.request);
    assert.equal(result.source, 'whisper.cpp');
    assert.deepEqual(result.cues, [{ text: '你好', startFrame: 2, durationFrames: 18 }]);
    assert.equal(f.project.revision, 1); assert.deepEqual(f.shot.dialogueCues, []);
});

test('selected managed transcription uploads extracted audio and returns review cues without changing dialogue', async t => {
    const f = await fixture(t);
    const quote = `kq1_${'a'.repeat(64)}`;
    const offeringId = '11111111-1111-4111-8111-111111111111';
    await runMediaTranscriptionTool(ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-f', 'lavfi',
        '-i', 'sine=frequency=440:duration=1', join(f.root, f.asset.uri)]);
    f.service.getPrivacySettings = async () => ({ requireZeroDataRetention: true, denyDataCollection: true });
    f.service.deviceId = async () => 'fixture-device';
    const uploads = [];
    f.service.timedMediaFetch = async (url, init) => {
        uploads.push({ url, init });
        return Response.json({ text: 'managed subtitle', segments: [{ text: 'managed subtitle', start: 0.1, end: 0.8 }] });
    };
    const result = await f.service.transcribeComicShot({ ...f.request, managedRoute: {
        connectionId: `managed:fixed:${offeringId}`, model: 'asr-model', keyPriceQuoteId: quote, costConfirmed: true
    } });
    assert.equal(result.source, 'managed');
    assert.deepEqual(result.cues, [{ text: 'managed subtitle', startFrame: 2, durationFrames: 18 }]);
    assert.deepEqual(f.shot.dialogueCues, []);
    assert.equal(f.project.revision, 1);
    assert.equal(uploads.length, 1);
    assert.ok(String(uploads[0].url).endsWith('/api/gateway/audio/transcriptions'));
    assert.equal(uploads[0].init.body.get('offeringId'), offeringId);
    assert.equal(uploads[0].init.body.get('keyPriceQuoteId'), quote);
    assert.equal(uploads[0].init.headers['idempotency-key'], f.request.requestId);
    assert.ok(uploads[0].init.body.get('file').size > 44);
});

test('verified native video subtitles are reused and clipped to the selected source range', async t => {
    const f = await fixture(t, 'video');
    f.asset.uri = 'nextmux.media/source.mp4'; f.shot.mediaSourceStartFrames = { [f.asset.id]: 24 };
    const subtitle = join(f.root, 'captions.srt');
    await writeFile(subtitle, '1\n00:00:00,000 --> 00:00:00,500\n旧片段\n\n2\n00:00:01,000 --> 00:00:02,500\n当前片段\n');
    await runMediaTranscriptionTool(ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-i', subtitle, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-c:s', 'mov_text', '-t', '3', join(f.root, f.asset.uri)]);
    f.service.comicShotTranscriber = async () => { assert.fail('native subtitles must not invoke ASR'); };
    const result = await f.service.transcribeComicShot(f.request);
    assert.equal(result.source, 'native_subtitle');
    assert.deepEqual(result.cues, [{ text: '当前片段', startFrame: 0, durationFrames: 24 }]);
});

test('native subtitle extraction normalizes absolute stream origins before clipping source ranges', async t => {
    const f = await fixture(t, 'video');
    f.asset.uri = 'nextmux.media/source.mp4';
    const base = join(f.root, 'base.mp4'), subtitle = join(f.root, 'captions.srt');
    await writeFile(subtitle, '1\n00:00:00,200 --> 00:00:00,600\n第一句\n\n2\n00:00:01,200 --> 00:00:01,600\n第二句\n');
    await runMediaTranscriptionTool(ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=24:d=2',
        '-i', subtitle, '-map', '0:v', '-map', '1:s', '-c:v', 'libx264', '-c:s', 'mov_text', base]);
    f.shot.mediaSourceStartFrames = { [f.asset.id]: 24 };
    f.asset.streamStartMs = 9999;
    f.service.comicShotTranscriber = async () => { assert.fail('native subtitles must not invoke ASR'); };
    for (const origin of [5, 0.5]) {
        const inputs = origin === 5 ? ['-i', base, '-map', '0:v', '-map', '0:s', '-c', 'copy', '-output_ts_offset', '5']
            : ['-itsoffset', '0.5', '-i', base, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-map', '0:v', '-map', '0:s', '-map', '1:a', '-c:v', 'copy', '-c:s', 'copy', '-c:a', 'aac'];
        await runMediaTranscriptionTool(ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', ...inputs, '-y', join(f.root, f.asset.uri)]);
        const result = await f.service.transcribeComicShot(f.request);
        assert.equal(result.source, 'native_subtitle');
        assert.deepEqual(result.cues, [{ text: '第二句', startFrame: 5, durationFrames: 9 }], `origin ${origin} stays separate from logical source in-points`);
    }
    const before = join(f.root, 'before.srt'), shifted = join(f.root, 'shifted.mp4');
    await writeFile(before, '1\n00:00:00,000 --> 00:00:00,200\n起点前\n\n2\n00:00:00,300 --> 00:00:00,700\n跨起点\n');
    await runMediaTranscriptionTool(ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-itsoffset', '0.5', '-i', base,
        '-i', before, '-map', '0:v', '-map', '1:s', '-c:v', 'copy', '-c:s', 'mov_text', '-y', shifted]);
    const cues = await f.service.extractEmbeddedSubtitleCues(ffmpeg, shifted, 24, new AbortController().signal, 500);
    assert.deepEqual(cues, [{ text: '跨起点', startFrame: 0, durationFrames: 5 }], 'pre-picture captions are removed and captions crossing the origin are intersected');
});

function selectedTone(path, at, frequency) {
    const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', String(at), '-t', '0.2', '-i', path,
        '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1']);
    assert.equal(result.status, 0, result.stderr?.toString());
    let sine = 0, cosine = 0;
    for (let i = 0; i < result.stdout.length / 4; i++) {
        const phase = 2 * Math.PI * frequency * i / 48000;
        sine += result.stdout.readFloatLE(i * 4) * Math.sin(phase);
        cosine += result.stdout.readFloatLE(i * 4) * Math.cos(phase);
    }
    return 2 * Math.hypot(sine, cosine) / (result.stdout.length / 4);
}

test('shot and song ASR use actual absolute playable origins while source ranges remain logical', async t => {
    const f = await fixture(t);
    const tones = join(f.root, 'tones.wav');
    await runMediaTranscriptionTool(ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1',
        '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=1', '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1[a]', '-map', '[a]', '-c:a', 'pcm_s16le', tones]);
    f.asset.uri = 'nextmux.media/source.mov'; f.asset.streamStartMs = 9999;
    f.shot.mediaSourceStartFrames = { [f.asset.id]: 24 };
    f.service.comicShotTranscriber = async () => ({ id: 'whisper.cpp', localOnly: true, async transcribe({ audioPath }) {
        assert.ok(selectedTone(audioPath, 0.1, 880) > 0.08, 'logical second phrase reaches ASR');
        assert.ok(selectedTone(audioPath, 0.1, 440) < 0.005, 'preceding phrase is excluded');
        return { segments: [{ text: '第二句', startMs: 100, endMs: 800 }] };
    } });
    for (const origin of [5, 0.5]) {
        const inputs = origin === 5 ? ['-i', tones, '-c:a', 'pcm_s16le', '-output_ts_offset', '5']
            : ['-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=24:d=3', '-itsoffset', '0.5', '-i', tones,
                '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-c:a', 'pcm_s16le'];
        await runMediaTranscriptionTool(ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', ...inputs, '-y', join(f.root, f.asset.uri)]);
        assert.equal((await f.service.transcribeComicShot(f.request)).cues[0].text, '第二句');
    }
    f.asset.kind = 'music'; f.asset.durationMs = 2000;
    f.project.music = { selectedAssetId: f.asset.id };
    f.service.comicShotTranscriber = async () => ({ id: 'whisper.cpp', localOnly: true, async transcribe({ audioPath }) {
        assert.ok(selectedTone(audioPath, 0.1, 440) > 0.08, 'whole song starts at its actual origin');
        assert.ok(selectedTone(audioPath, 1.1, 880) > 0.08, 'whole song includes its final phrase');
        return { segments: [{ text: '整首歌', startMs: 100, endMs: 1800 }] };
    } });
    assert.equal((await f.service.transcribeComicShot({ ...f.request, source: 'music' })).cues[0].text, '整首歌');
});

test('native video audio ASR follows the picture origin instead of the earlier container audio origin', async t => {
    const f = await fixture(t, 'video');
    const picture = join(f.root, 'picture.mp4'), tone = join(f.root, 'tone.wav');
    f.asset.uri = 'nextmux.media/source.mov'; f.shot.mediaSourceStartFrames = { [f.asset.id]: 24 };
    await runMediaTranscriptionTool(ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=24:d=2', '-c:v', 'libx264', picture]);
    await runMediaTranscriptionTool(ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1.5',
        '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=1', '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1[a]', '-map', '[a]', '-c:a', 'pcm_s16le', tone]);
    await runMediaTranscriptionTool(ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-itsoffset', '0.5', '-i', picture, '-i', tone,
        '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'pcm_s16le', join(f.root, f.asset.uri)]);
    f.service.comicShotTranscriber = async () => ({ id: 'whisper.cpp', localOnly: true, async transcribe({ audioPath }) {
        assert.ok(selectedTone(audioPath, 0.1, 880) > 0.08);
        assert.ok(selectedTone(audioPath, 0.1, 440) < 0.005);
        return { segments: [{ text: '画面对齐', startMs: 100, endMs: 800 }] };
    } });
    assert.equal((await f.service.transcribeComicShot(f.request)).cues[0].text, '画面对齐');
});

test('music transcription uses the whole selected song and preserves existing shot dialogue', async t => {
    const f = await fixture(t, 'music');
    f.asset.durationMs = 2000;
    f.project.projectKind = 'music';
    f.project.music = { selectedAssetId: f.asset.id };
    f.shot.dialogueCues = [{ text: 'existing shot subtitle' }];
    f.shot.mediaSourceStartFrames = { [f.asset.id]: 48 };
    f.shot.audioAssetId = 'unrelated-voice';
    f.project.assets.push({ id: 'unrelated-voice', kind: 'audio', status: 'ready', uri: '../must-not-read.wav' });
    await runMediaTranscriptionTool(ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-f', 'lavfi',
        '-i', 'sine=frequency=440:duration=2', join(f.root, f.asset.uri)]);
    f.service.comicShotTranscriber = async () => ({ id: 'sherpa-onnx', localOnly: true, async transcribe({ audioPath }) {
        const bytes = await (await import('node:fs/promises')).readFile(audioPath);
        assert.ok(bytes.length > 64000, 'all two seconds reach the recognizer despite the one-second song shot');
        return { segments: [{ text: '歌曲第二句', startMs: 1100, endMs: 1800 }] };
    } });
    const result = await f.service.transcribeComicShot({ ...f.request, source: 'music' });
    assert.equal(result.source, 'sherpa-onnx');
    assert.deepEqual(result.cues, [{ text: '歌曲第二句', startFrame: 26, durationFrames: 18 }]);
    assert.deepEqual(f.shot.dialogueCues, [{ text: 'existing shot subtitle' }]);
    assert.equal(f.project.revision, 1);
    await assert.rejects(f.service.transcribeComicShot({ ...f.request, source: 'remote' }), error => error.code === 'INVALID_COMIC_REQUEST');
});

test('music ASR tolerates visual job revisions but rejects a replaced song', async t => {
    const f = await fixture(t, 'music');
    f.project.music = { selectedAssetId: f.asset.id, lyrics: '保留歌词' };
    await runMediaTranscriptionTool(ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-f', 'lavfi',
        '-i', 'sine=frequency=440:duration=1', join(f.root, f.asset.uri)]);
    f.service.comicShotTranscriber = async () => ({ id: 'sherpa-onnx', localOnly: true, async transcribe() {
        f.project.revision++;
        return { segments: [{ text: '保留歌词', startMs: 100, endMs: 800 }] };
    } });
    const result = await f.service.transcribeComicShot({ ...f.request, source: 'music' });
    assert.equal(result.revision, 2);
    f.service.comicShotTranscriber = async () => ({ id: 'sherpa-onnx', localOnly: true, async transcribe() {
        f.project.revision++;
        f.project.music.selectedAssetId = 'asset-different-song';
        return { segments: [{ text: '旧歌', startMs: 100, endMs: 800 }] };
    } });
    await assert.rejects(f.service.transcribeComicShot({ ...f.request, source: 'music', expectedRevision: 2 }),
        error => error.code === 'COMIC_REVISION_CONFLICT');
});

test('existing dialogue, stale revisions, unsafe media paths and absent models are rejected', async t => {
    const f = await fixture(t);
    f.shot.dialogueCues = [{ text: '保留' }];
    await assert.rejects(f.service.transcribeComicShot(f.request), e => e.code === 'COMIC_DIALOGUE_EXISTS');
    f.shot.dialogueCues = [];
    await assert.rejects(f.service.transcribeComicShot({ ...f.request, expectedRevision: 0 }), e => e.code === 'COMIC_REVISION_CONFLICT');
    f.asset.uri = '../outside.wav';
    await assert.rejects(f.service.transcribeComicShot(f.request), e => e.code === 'INVALID_MEDIA_PATH');
    f.asset.uri = 'nextmux.media/source.wav';
    await writeFile(join(f.root, f.asset.uri), 'audio');
    await assert.rejects(f.service.transcribeComicShot(f.request), e => e.code === 'ASR_TOOL_UNAVAILABLE');
});

test('transcription cancellation is workspace-owned and stops the pending local recognizer', async t => {
    const f = await fixture(t);
    await runMediaTranscriptionTool(ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', join(f.root, f.asset.uri)]);
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    f.service.comicShotTranscriber = async () => ({ id: 'whisper.cpp', localOnly: true, async transcribe({ signal }) {
        started();
        return await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'CANCELLED' })), { once: true }));
    } });
    const pending = f.service.transcribeComicShot(f.request);
    await ready;
    const other = await mkdtemp(join(tmpdir(), 'nextmux-other-asr-')); t.after(() => rm(other, { recursive: true, force: true }));
    assert.equal((await f.service.cancelComicShotTranscription(other, f.request.requestId)).cancelled, false);
    assert.equal((await f.service.cancelComicShotTranscription(f.root, f.request.requestId)).cancelled, true);
    await assert.rejects(pending, e => e.code === 'CANCELLED');
    assert.equal(f.service.comicTranscriptions.size, 0);
});

test('optional local ASR config survives unrelated media settings saves and can be cleared', async t => {
    const f = await fixture(t);
    const executablePath = join(f.root, 'whisper-cli'); const modelPath = join(f.root, 'ggml-base.bin');
    await writeFile(executablePath, 'binary fixture'); await writeFile(modelPath, 'model fixture');
    const canonical = { executablePath: await realpath(executablePath), modelPath: await realpath(modelPath) };
    const base = { ffmpegPath: '', comfyUiBaseUrl: '', comfyUiWorkflowPath: '' };
    await f.service.saveMediaRuntime({ ...base, whisperExecutablePath: executablePath, whisperModelPath: modelPath });
    assert.deepEqual((await f.service.readMediaRuntimeConfig()).whisper, canonical);
    await f.service.saveMediaRuntime(base);
    assert.deepEqual((await f.service.readMediaRuntimeConfig()).whisper, canonical);
    await f.service.saveMediaRuntime({ ...base, whisperExecutablePath: '', whisperModelPath: '' });
    assert.equal((await f.service.readMediaRuntimeConfig()).whisper, undefined);
});

test('canvas timeline transcription reads the independent cut and keeps its source project unchanged',async t=>{
    const f=await fixture(t);await runMediaTranscriptionTool(ffmpeg,['-hide_banner','-nostdin','-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=2',join(f.root,f.asset.uri)]);
    const timeline={id:'timeline-asr-fixture',revision:4,project:{...structuredClone(f.project),id:'project-timeline-asr',revision:4}};
    timeline.project.scenes[0].shots[0].mediaSourceStartFrames={[f.asset.id]:24};
    const original=JSON.stringify(f.project),reads=[];
    f.service.comicTimelineScope=async root=>({project:f.project,store:{read:async(id,projectId)=>{reads.push([root,id,projectId]);return timeline;}}});
    f.service.comicShotTranscriber=async()=>({id:'whisper.cpp',localOnly:true,transcribe:async()=>({segments:[{text:'Cut subtitle',startMs:100,endMs:800}]})});
    const request={...f.request,projectId:timeline.project.id,expectedRevision:4,timelineId:timeline.id,expectedTimelineRevision:4};
    const result=await f.service.transcribeComicShot(request);
    assert.equal(result.timelineId,timeline.id);assert.equal(result.timelineRevision,4);assert.equal(result.projectId,timeline.project.id);
    assert.equal(result.cues[0].text,'Cut subtitle');assert.equal(JSON.stringify(f.project),original);assert.deepEqual(timeline.project.scenes[0].shots[0].dialogueCues,[]);
    assert.equal(reads.length,2);assert.ok(reads.every(row=>row[1]===timeline.id&&row[2]===f.project.id));
    await assert.rejects(()=>f.service.transcribeComicShot({...request,expectedTimelineRevision:3}),error=>error.code==='COMIC_REVISION_CONFLICT');
    await assert.rejects(()=>f.service.transcribeComicShot({...request,expectedTimelineRevision:undefined}),error=>error.code==='INVALID_COMIC_REQUEST');
    await assert.rejects(()=>f.service.transcribeComicShot({...request,source:'music'}),error=>error.code==='INVALID_COMIC_REQUEST');
    f.service.comicShotTranscriber=async()=>({id:'whisper.cpp',localOnly:true,transcribe:async()=>{timeline.revision++;timeline.project.revision++;return {segments:[{text:'Stale',startMs:100,endMs:800}]};}});
    await assert.rejects(()=>f.service.transcribeComicShot(request),error=>error.code==='COMIC_REVISION_CONFLICT');
    assert.equal(JSON.stringify(f.project),original);assert.deepEqual(timeline.project.scenes[0].shots[0].dialogueCues,[]);
});
