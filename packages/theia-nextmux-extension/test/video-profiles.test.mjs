import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  combineVideoProfiles, documentedVideoProfile, parseFfmpegVideoStream, parseVideoProfilesPayload, standardFrameRate, videoAspectRatioOf, videoModelProfile
} from '../lib/common/nextmux-video-profiles.js';

test('ffmpeg stream inventory yields the real frame size and frame rate', () => {
  const stderr = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'clip.mp4':
  Duration: 00:00:08.00, start: 0.000000, bitrate: 2210 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1280x720 [SAR 1:1 DAR 16:9], 2076 kb/s, 23.98 fps, 23.98 tbr, 24k tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 128 kb/s (default)`;
  assert.deepEqual(parseFfmpegVideoStream(stderr), { width: 1280, height: 720, fps: 23.98 });
  assert.deepEqual(parseFfmpegVideoStream('Stream #0:0: Video: vp9, yuv420p(tv), 720x1280, 30 tbr, 1k tbn'), { width: 720, height: 1280, fps: 30 });
  assert.equal(parseFfmpegVideoStream('Stream #0:0: Audio: aac, 44100 Hz'), undefined);
  assert.equal(standardFrameRate(23.98), 24);
  assert.equal(videoAspectRatioOf(1080, 1920), '9:16');
});

test('documented limits cover Sora 2 and Veo; unknown models have no guess', () => {
  assert.deepEqual(documentedVideoProfile('openai/sora-2')?.aspectRatios, ['16:9', '9:16']);
  assert.deepEqual(documentedVideoProfile('openai/sora-2-pro')?.durationsSeconds, [4, 8, 12]);
  assert.deepEqual(documentedVideoProfile('google/veo-3.1-generate-preview')?.frameRates, [24]);
  assert.equal(documentedVideoProfile('acme/clipper-1'), undefined);
  assert.equal(documentedVideoProfile('openai/sora-20'), undefined, 'sora-20 is not sora-2');
});

test('measured outputs extend documented limits and fill in unknown frame rates', () => {
  const measured = parseVideoProfilesPayload({ profiles: [
    { model: 'openai/sora-2', aspectRatios: [{ ratio: '16:9', samples: 5 }, { ratio: '1:1', samples: 1 }], frameRates: [{ fps: 29.97, samples: 6 }], samples: 6 },
    { model: 'acme/clipper-1', aspectRatios: [{ ratio: '1:1', samples: 3 }, { ratio: 'bogus', samples: 2 }], frameRates: [{ fps: 16, samples: 3 }], samples: 3 },
    { model: '', aspectRatios: [] }
  ] });
  assert.equal(measured.size, 2);
  const sora = videoModelProfile('openai/sora-2', measured);
  assert.deepEqual(sora.aspectRatios, ['16:9', '9:16', '1:1'], 'documented first, then a newly measured size');
  assert.deepEqual(sora.frameRates, [30], 'docs are silent on fps, measurements answer');
  assert.deepEqual(sora.sources, ['documented', 'measured']);
  const clipper = videoModelProfile('clipper-1', measured);
  assert.deepEqual(clipper.aspectRatios, ['1:1'], 'a bare upstream id finds the canonical model');
  assert.deepEqual(clipper.frameRates, [16]);
  assert.equal(videoModelProfile('acme/unknown'), undefined);
  assert.equal(combineVideoProfiles(undefined, { aspectRatios: [], frameRates: [], samples: 0 }), undefined);
});

test('the 剧本 step asks for the video model before ratio and frame rate (新建漫剧 only asks for the name)', () => {
  const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
  const sheet = source.slice(source.indexOf('    protected renderComicDeskPicture('), source.indexOf('    protected renderComicDeskSourceFooter('));
  assert.ok(sheet.indexOf("this.ct('videoModel')") > 0);
  assert.ok(sheet.indexOf("this.ct('videoModel')") < sheet.indexOf("this.ct('aspect')"), 'model comes first');
  assert.match(sheet, /plan\.ratioOptions/);
  assert.match(sheet, /plan\.rateOptions/);
  const create = source.slice(source.indexOf('    protected renderComicCreateSheet()'), source.indexOf("    /** “AI 模型”: the relay for every step"));
  assert.doesNotMatch(create, /videoModel|ratioOptions|rateOptions/);
  assert.match(source, /const draft = plan \? \{ \.\.\.this\.comicCreateDraft, aspectRatio: plan\.ratio, frameRate: plan\.rate \}/,
    'the created project uses the ratio and rate the model supports');
  const service = readFileSync(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
  assert.match(service, /void this\.reportVideoMeasurement\(remoteJobId, workspaceRoot, checkpoint\.relativeUri, deviceId\);/,
    'finished managed clips report their measured size and frame rate');
});
