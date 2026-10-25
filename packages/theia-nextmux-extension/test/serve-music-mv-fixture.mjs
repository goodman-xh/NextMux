import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const coreRequire = createRequire(require.resolve('@theia/core/package.json'));
const { build } = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url))('esbuild');
const bundle = await build({ entryPoints: [fileURLToPath(new URL('music-mv-fixture.tsx', import.meta.url))], bundle: true, write: false,
    platform: 'browser', format: 'iife', logLevel: 'silent',
    alias: { react: coreRequire.resolve('react'), 'react-dom': coreRequire.resolve('react-dom'), 'react-dom/client': coreRequire.resolve('react-dom/client') } });
const video = spawnSync(require('@ffmpeg-installer/ffmpeg').path, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'color=c=0x183748:s=640x360:r=12:d=4,drawbox=x=0:y=220:w=640:h=140:c=0x102730:t=fill,drawbox=x=470:y=100:w=28:h=150:c=0x1e202b:t=fill,drawbox=x=465:y=93:w=38:h=14:c=0xf7c788:t=fill',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'], { maxBuffer: 8_000_000 });
if (video.status !== 0) throw new Error('Could not create local synthetic visual');
const sampleRate = 22050; const samples = 42 * sampleRate;
const wav = Buffer.alloc(44 + samples * 2); wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i / sampleRate * Math.PI * 2 * 220) * 60), 44 + i * 2);
const scene = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><path fill="#244355" d="M0 0h640v360H0z"/><circle cx="480" cy="140" r="48" fill="#fcdab8"/><path fill="#162e3d" d="M0 260l180-60 150 60 310-10v110H0z"/></svg>';
const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated MV fixture</title><link rel="stylesheet" href="/codicon.css"><link rel="stylesheet" href="/workshop.css"></head><body><div id="fixture"></div><script src="/fixture.js"></script></body></html>';
const files = { '/workshop.css': new URL('../src/browser/style/nextmux-comic-workshop.css', import.meta.url), '/codicon.css': coreRequire.resolve('@vscode/codicons/dist/codicon.css'), '/codicon.ttf': coreRequire.resolve('@vscode/codicons/dist/codicon.ttf') };
const server = createServer(async (request, response) => {
    try {
        const path = new URL(request.url, 'http://127.0.0.1').pathname;
        const body = path === '/' ? html : path === '/fixture.js' ? bundle.outputFiles[0].contents : path === '/song.wav' ? wav : path === '/visual.mp4' ? video.stdout : path === '/scene.svg' ? scene : files[path] ? await readFile(files[path]) : null;
        response.writeHead(body ? 200 : 404, { 'content-type': path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.wav') ? 'audio/wav' : path.endsWith('.mp4') ? 'video/mp4' : path.endsWith('.svg') ? 'image/svg+xml' : path.endsWith('.ttf') ? 'font/ttf' : 'text/html', 'cache-control': 'no-store',
            'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self'; media-src 'self'; font-src 'self'" });
        response.end(body || 'Not found');
    } catch { response.writeHead(500); response.end('Fixture failed'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
console.log(`Isolated MV fixture: http://127.0.0.1:${server.address().port}/`);
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
