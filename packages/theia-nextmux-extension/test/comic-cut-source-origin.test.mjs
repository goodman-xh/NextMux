import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { comicEditorVideoPosition, comicEditorSeekMedia } from '../lib/browser/nextmux-comic-editor.js';
import { comicCutMaximumDuration } from '../lib/browser/nextmux-comic-cut.js';
import { probeComicVideoPackets } from '../lib/node/nextmux-comic-media-probe.js';

const require = createRequire(import.meta.url);
const app = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const puppeteer = (await import(app.resolve('puppeteer'))).default;
const ffmpeg = require('@ffmpeg-installer/ffmpeg').path;
function encode(args) {
    const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], { timeout: 15_000, maxBuffer: 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr?.toString() || result.error?.message);
}

test('real browser seeks use absolute stream origins for global PTS offsets and delayed video streams', { timeout: 45_000 }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-browser-source-origin-'));
    let browser, server;
    t.after(async () => {
        try {
            if (browser) {
                // Cleanup belongs to this fixture; a stalled CDP close cannot strand Chromium.
                const timer = setTimeout(() => browser.process()?.kill('SIGKILL'), 3_000);
                try { await browser.close(); } catch { /* fixture process is already closed */ } finally { clearTimeout(timer); }
            }
        } finally {
            if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
            await rm(root, { recursive: true, force: true });
        }
    });
    const colors = ['-f', 'lavfi', '-i', 'color=c=red:s=64x64:r=24:d=1', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=24:d=1'];
    const overall = join(root, 'overall.mp4'), small = join(root, 'small.mp4'), delayed = join(root, 'delayed.mp4');
    encode([...colors, '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-r', '24',
        '-c:v', 'libx264', '-output_ts_offset', '5', '-y', overall]);
    encode([...colors, '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-r', '24',
        '-c:v', 'libx264', '-output_ts_offset', '0.5', '-y', small]);
    encode([...colors, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
        '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0,setpts=PTS+0.5/TB[v]', '-map', '[v]', '-map', '2:a', '-vsync', '0', '-r', '24',
        '-c:v', 'libx264', '-c:a', 'aac', '-y', delayed]);
    const files = new Map(await Promise.all(['overall.mp4', 'small.mp4', 'delayed.mp4'].map(async name => [name, await readFile(join(root, name))])));
    server = createServer((request, response) => {
        const file = files.get(request.url?.slice(1));
        if (!file) { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<html><body></body></html>'); return; }
        const range = /^bytes=(\d+)-(\d*)/.exec(request.headers.range || '');
        if (range) {
            const start = Number(range[1]), end = range[2] ? Math.min(file.length - 1, Number(range[2])) : file.length - 1;
            if (start > end) { response.writeHead(416, { 'content-range': `bytes */${file.length}` }); response.end(); return; }
            response.writeHead(206, { 'content-type': 'video/mp4', 'content-length': end - start + 1, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${file.length}` });
            response.end(file.subarray(start, end + 1));
        } else { response.writeHead(200, { 'content-type': 'video/mp4', 'content-length': file.length, 'accept-ranges': 'bytes' }); response.end(file); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await puppeteer.launch({ headless: true, timeout: 10_000, protocolTimeout: 10_000 });
    const page = await browser.newPage(); page.setDefaultTimeout(5_000);
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    for (const [name, path, expectedOrigin, from = 1] of [['overall.mp4', overall, 5_000], ['small.mp4', small, 500, 1.75], ['delayed.mp4', delayed, 500]]) {
        const timing = await probeComicVideoPackets(ffmpeg, path);
        assert.equal(timing.streamStartMs, expectedOrigin);
        assert.equal(timing.durationMs, 2_000, 'source capacity excludes presentation delay and longer container audio');
        const clip = { kind: 'video', videoStart: from, videoOrigin: timing.streamStartMs / 1000, videoLength: timing.durationMs / 1000, duration: 2 - from };
        assert.equal(comicCutMaximumDuration(clip, 24), 2 - from, 'presentation origin never consumes logical tail capacity');
        const position = comicEditorVideoPosition(clip);
        const pixel = await page.evaluate(async ({ name, position, seekSource }) => {
            const seekMedia = new Function('comicEditorMediaSeeks', `return (${seekSource})`)(new WeakMap());
            const video = document.createElement('video'); video.muted = true; document.body.append(video);
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('video source seek timed out')), 5_000);
                const settle = () => { if (seekMedia(video, position)) { clearTimeout(timer); resolve(); } };
                video.onloadeddata = video.ondurationchange = video.onseeked = settle;
                video.onerror = () => { clearTimeout(timer); reject(new Error(video.error?.message)); };
                video.src = `/${name}`;
            });
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
            const context = canvas.getContext('2d'); context.drawImage(video, 0, 0);
            const result = { currentTime: video.currentTime, rgba: [...context.getImageData(32, 32, 1, 1).data] };
            video.remove(); return result;
        }, { name, position, seekSource: comicEditorSeekMedia.toString() });
        assert.equal(pixel.currentTime, position);
        assert.ok(pixel.rgba[2] > 200 && pixel.rgba[0] < 40, `${name}: logical source in-point one second selects the blue half: ${JSON.stringify(pixel)}`);
    }
});
