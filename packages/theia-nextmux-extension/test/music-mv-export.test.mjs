import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

const require = createRequire(import.meta.url);
const ffmpeg = require('@ffmpeg-installer/ffmpeg').path;
function run(args) {
    const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 30_000 });
    assert.equal(result.status, 0, result.stderr?.toString() || result.error?.message);
    return result.stdout;
}
function amplitude(bytes, frequency) {
    let sine = 0, cosine = 0;
    for (let i = 0; i < bytes.length / 4; i++) {
        const phase = 2 * Math.PI * frequency * i / 48_000;
        sine += bytes.readFloatLE(i * 4) * Math.sin(phase);
        cosine += bytes.readFloatLE(i * 4) * Math.cos(phase);
    }
    return 2 * Math.hypot(sine, cosine) / (bytes.length / 4);
}
async function exported(service, workspace, id) {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
        const item = (await service.getComicExportWorkspaceState(workspace)).exports.find(item => item.id === id);
        if (['completed', 'failed', 'cancelled', 'interrupted'].includes(item?.status)) return item;
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.fail('MV export did not finish');
}

test('real MV export burns Chinese lyrics, switches visuals, and encodes the song continuously without source-video audio', { timeout: 90_000 }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-music-mv-'));
    t.diagnostic(`Offline MV fixture retained at ${root}`);
    const workspace = join(root, 'workspace');
    await mkdir(join(workspace, 'nextmux.media'), { recursive: true });
    class Service extends NextMuxPlatformServiceImpl {
        nextmuxDataRoot() { return join(root, 'state'); }
        async getMediaRuntimeState() { return { ffmpeg: { available: true, path: ffmpeg, source: 'bundled' } }; }
    }
    const service = new Service();
    let state = await service.createComicProject({ workspaceRoot: workspace, title: 'Local MV fixture', projectKind: 'music',
        starter: 'storyboard', frameRate: 24, canvas: { aspectRatio: '16:9', width: 640, height: 360 } });
    const sceneId = state.project.scenes[0].id, shotId = state.project.scenes[0].shots[0].id;
    const command = async command => { state = await service.applyComicCommand({ workspaceRoot: workspace,
        command: { ...command, expectedRevision: state.project.revision } }); };
    const attach = async (id, kind, slot, extension, args, durationMs) => {
        const uri = `nextmux.media/${id}.${extension}`;
        run([...args, '-y', join(workspace, uri)]);
        const bytes = await readFile(join(workspace, uri));
        await command({ type: 'media.attach', sceneId, shotId, slot, asset: { id, kind, uri,
            mimeType: kind === 'image' ? 'image/png' : kind === 'video' ? 'video/mp4' : 'audio/wav',
            durationMs, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
            jobId: `media-job-${randomUUID()}`, provider: 'local test fixture', model: 'synthetic' } });
    };
    await attach('asset-red-fixture', 'image', 'visual', 'png', ['-f', 'lavfi', '-i', 'color=c=red:s=640x360', '-frames:v', '1']);
    await attach('asset-blue-fixture', 'video', 'video', 'mp4', ['-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=24:d=2',
        '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=2', '-c:v', 'libx264', '-c:a', 'aac', '-t', '2'], 2000);
    await attach('asset-song-fixture', 'music', 'music', 'mov', ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2',
        '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:duration=2',
        '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1[a]', '-map', '[a]', '-c:a', 'pcm_s16le', '-output_ts_offset', '5'], 4000);
    const lyrics = '[Verse]\n海风吹过灯塔\n[Chorus]\n我们等你回家';
    await command({ type: 'project.update', patch: { music: { lyrics, instrumental: false, genre: '', mood: '', tempo: '',
        vocals: '', language: 'zh', style: '', length: 'full', format: 'wav' } } });
    await command({ type: 'music.select', assetId: 'asset-song-fixture', durationFrames: 96 });
    const mv = { songAssetId: 'asset-song-fixture', lyrics, durationMs: 4000, alignment: 'manual', lines: [
        { id: 'line-1', sectionIndex: 0, sectionTitle: 'Verse', text: '海风吹过灯塔', startMs: 500, endMs: 1500 },
        { id: 'line-2', sectionIndex: 1, sectionTitle: 'Chorus', text: '我们等你回家', startMs: 2500, endMs: 3500 }
    ], segments: [
        { id: 'segment-1', sectionIndex: 0, sectionTitle: 'Verse', startMs: 0, endMs: 2000, lineIds: ['line-1'], prompt: 'red', source: 'upload-image', assetId: 'asset-red-fixture' },
        { id: 'segment-2', sectionIndex: 1, sectionTitle: 'Chorus', startMs: 2000, endMs: 4000, lineIds: ['line-2'], prompt: 'blue', source: 'upload-video', assetId: 'asset-blue-fixture' }
    ] };
    await command({ type: 'project.update', patch: { music: { ...state.project.music, mv } } });
    const request = { workspaceRoot: workspace, fileName: 'mv-fixture', quality: 'draft', subtitleMode: 'burned',
        allowPlaceholders: false, verifyAssetIntegrity: true };
    const started = await service.startComicExport(request);
    assert.equal(started.totalShots, 2, 'the MV visual count replaces the original single-song shot');
    const result = await exported(service, workspace, started.id);
    assert.equal(result.status, 'completed', result.error);
    assert.equal(result.output.durationSeconds, 4);
    const output = join(workspace, result.output.relativeUri);
    const frame = at => run(['-ss', String(at), '-i', output, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
    assert.deepEqual([...frame(0.25).subarray(0, 3)].map(value => value > 150), [true, false, false]);
    assert.deepEqual([...frame(2.25).subarray(0, 3)].map(value => value > 150), [false, false, true]);
    const whitePixels = bytes => {
        let count = 0;
        for (let i = 0; i < bytes.length; i += 3) if (bytes[i] > 190 && bytes[i + 1] > 190 && bytes[i + 2] > 190) count++;
        return count;
    };
    assert.equal(whitePixels(frame(0.25)), 0, 'no text before the first lyric');
    assert.ok(whitePixels(frame(1)) > 80, 'Chinese lyric is burned into image pixels');
    assert.ok(whitePixels(frame(3)) > 80, 'second Chinese lyric is burned over the video');
    assert.equal(whitePixels(frame(3.75)), 0, 'lyrics stop at their authored end time');
    const audio = at => run(['-ss', String(at), '-t', '0.4', '-i', output, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1']);
    assert.ok(amplitude(audio(0.5), 440) > 0.03);
    assert.ok(amplitude(audio(2.5), 660) > 0.03, 'the song continues at its second phrase instead of restarting');
    assert.ok(amplitude(audio(2.5), 440) < 0.005, 'the song first phrase is not repeated at the cut');
    assert.ok(amplitude(audio(2.5), 880) < 0.005, 'the uploaded video audio does not mix into the song');
    const ass = await readFile(join(workspace, result.output.subtitleRelativeUris.ass), 'utf8');
    assert.match(ass, /海风吹过灯塔/);
    assert.match(ass, /我们等你回家/);
    assert.match(ass, /PingFang SC|Microsoft YaHei|Noto Sans CJK SC/);
    assert.equal(state.project.scenes[0].shots.length, 1, 'export does not rewrite the project into shots');
    assert.equal(state.project.scenes[0].shots[0].videoAssetId, 'asset-blue-fixture', 'original shot visual is left untouched');

    await command({ type: 'project.update', patch: { music: { ...state.project.music,
        mv: { ...mv, segments: mv.segments.map((segment, index) => index ? { ...segment, assetId: undefined } : segment) } } } });
    const missing = await exported(service, workspace, (await service.startComicExport(request)).id);
    assert.equal(missing.status, 'failed', 'an unfinished segment cannot silently reuse the song shot video');
    assert.equal(missing.errorInfo.messageKey, 'platform_media.visual_missing');
    await command({ type: 'project.update', patch: { music: { ...state.project.music, lyrics: 'changed words' } } });
    await assert.rejects(service.startComicExport(request), error => error.code === 'MUSIC_MV_STALE');
});
