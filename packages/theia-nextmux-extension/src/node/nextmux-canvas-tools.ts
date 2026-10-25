import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { CanvasAssetVersion, CanvasMediaMetadata } from '@nextmux/comic-core';
import { compileCanvasCurvesFilter } from '../common/nextmux-canvas-local-image-tools';
import type { CanvasImageCurves, CanvasColorTransferParameters, CanvasPaletteExtractParameters, CanvasExtractedPalette } from '../common/nextmux-canvas-local-image-tools';
import { canvasLabStatistics, buildCanvasColorTransferCube, extractCanvasPalette, canvasPalettePpm } from './nextmux-canvas-image-colour';
import type { CanvasLabStatistics } from './nextmux-canvas-image-colour';
import { PNG } from 'pngjs';
import { runCanvasOnDeviceImage } from './nextmux-canvas-on-device';
import { runCanvasVideoDepth } from './nextmux-canvas-video-depth';

export interface CanvasToolProgress {
    readonly stage: 'probe' | 'download' | 'process' | 'verify' | 'complete';
    readonly completedOutputs: number;
    readonly totalOutputs: number;
    readonly processedMs?: number;
    readonly fraction?: number;
    readonly downloadedBytes?: number;
    readonly totalBytes?: number;
}
export interface CanvasToolMetadata extends CanvasMediaMetadata {
    readonly frameCount?: number; readonly mediaKind?: CanvasAssetVersion['kind'];
    readonly palette?: CanvasExtractedPalette;
    readonly colorTransfer?: { readonly algorithm: 'lab-moments-d65-v1'; readonly source: CanvasLabStatistics; readonly reference: CanvasLabStatistics; readonly lutSize: number };
}
export interface CanvasToolVersion extends CanvasAssetVersion {
    readonly metadata: CanvasToolMetadata;
    readonly provenance: NonNullable<CanvasAssetVersion['provenance']> & {
        readonly tool: CanvasLocalToolRequest['tool'];
        readonly parameters: Readonly<Record<string, unknown>>;
        readonly sourceVersionIds: readonly string[];
    };
}
export interface CanvasToolRange { readonly inMs: number; readonly outMs: number }
export interface CanvasToolCrop { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
/** Signed controls use -100..100, exposure -200..200; spatial effects use 0..100. */
export interface CanvasColorAdjustments {
    readonly exposure?: number; readonly brightness?: number; readonly contrast?: number;
    readonly saturation?: number; readonly vibrance?: number; readonly temperature?: number;
    readonly tint?: number; readonly highlights?: number; readonly shadows?: number;
    readonly whites?: number; readonly blacks?: number; readonly sharpen?: number;
    readonly vignette?: number; readonly fade?: number; readonly grain?: number;
}
interface CanvasToolBase { readonly source: CanvasAssetVersion }
export type CanvasLocalToolRequest = CanvasToolBase & (
    | { readonly tool: 'video.trim' | 'audio.trim'; readonly parameters: CanvasToolRange }
    | { readonly tool: 'video.split'; readonly parameters: { readonly segments: readonly CanvasToolRange[] } }
    | { readonly tool: 'video.crop'; readonly parameters: { readonly crop?: CanvasToolCrop; readonly aspectRatio?: readonly [number, number]; readonly mirror?: boolean } }
    | { readonly tool: 'video.mirror' | 'image.mirror' | 'video.reverse' | 'video.videoOnly' | 'video.wav' | 'audio.wav'; readonly parameters?: Readonly<Record<string, never>> }
    | { readonly tool: 'video.export'; readonly parameters: CanvasToolRange & { readonly format: 'gif' | 'webp'; readonly fps?: number; readonly width?: number; readonly quality?: number } }
    | { readonly tool: 'video.compress'; readonly parameters: { readonly maxWidth?: number; readonly maxHeight?: number; readonly fps?: number; readonly crf?: number } }
    | { readonly tool: 'video.extractAudio'; readonly parameters?: { readonly format?: 'mp3' | 'wav' } }
    | { readonly tool: 'image.crop'; readonly parameters: CanvasToolCrop }
    | { readonly tool: 'image.convert'; readonly parameters: { readonly format: 'png' | 'jpeg' | 'webp'; readonly quality?: number; readonly maxWidth?: number; readonly maxHeight?: number } }
    | { readonly tool: 'image.gridSplit'; readonly parameters: { readonly rows: number; readonly columns: number; readonly gap?: number; readonly selectedCells?: readonly number[] } }
    | { readonly tool: 'image.gridStitch'; readonly parameters: { readonly rows: number; readonly columns: number; readonly cellWidth: number; readonly cellHeight: number; readonly gap?: number; readonly background?: string; readonly cells: readonly (CanvasAssetVersion | null)[] } }
    | { readonly tool: 'color.adjust'; readonly parameters: CanvasColorAdjustments }
    | { readonly tool: 'color.lut'; readonly parameters: { readonly cubePath: string; readonly strength?: number; readonly adjustments?: CanvasColorAdjustments } }
    | { readonly tool: 'color.curves'; readonly parameters: CanvasImageCurves }
    | { readonly tool: 'color.transfer'; readonly parameters: CanvasColorTransferParameters & { readonly reference: CanvasAssetVersion; readonly referenceVersionId?: string } }
    | { readonly tool: 'image.paletteExtract'; readonly parameters?: CanvasPaletteExtractParameters }
    | { readonly tool: 'image.matting'; readonly parameters?: Readonly<Record<string, never>> }
    | { readonly tool: 'image.depth'; readonly parameters?: { readonly invert?: boolean } }
    | { readonly tool: 'video.depth'; readonly parameters?: { readonly resolution?: 'source' | '720' | '480'; readonly invert?: boolean; readonly smooth?: boolean } }
);
export interface CanvasLocalToolOptions {
    readonly outputDirectory: string;
    readonly ffmpegPath?: string;
    readonly ffprobePath?: string;
    /** Shared application data cache for the pinned on-device model files. */
    readonly modelDirectory?: string;
    /** Used only when the selected FFmpeg build lacks libwebp encoders. */
    readonly cwebpPath?: string;
    readonly img2webpPath?: string;
    readonly signal?: AbortSignal;
    readonly onProgress?: (progress: CanvasToolProgress) => void;
}
export interface CanvasLocalToolResult { readonly versions: readonly CanvasToolVersion[] }

export class CanvasToolError extends Error {
    constructor(readonly code: string, message: string) { super(message); this.name = 'CanvasToolError'; }
}
function fail(message: string): never { throw new CanvasToolError('INVALID_TOOL_INPUT', message); }
function number(value: number, label: string, min: number, max = Infinity, integer = false): number {
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) fail(`${label} must be ${integer ? 'an integer' : 'a number'} in ${min}..${max}`);
    return value;
}
function abort(signal?: AbortSignal): void { if (signal?.aborted) throw new CanvasToolError('CANCELLED', 'Local media processing was cancelled'); }
function emit(options: CanvasLocalToolOptions, progress: CanvasToolProgress): void {
    // An observer cannot turn a successful media operation into a failed one.
    try { options.onProgress?.(progress); } catch { /* observer only */ }
}
function run(binary: string, args: readonly string[], signal?: AbortSignal, onTime?: (ms: number) => void, cwd?: string): Promise<string> {
    abort(signal);
    return new Promise((accept, reject) => {
        const child = spawn(binary, [...args], { stdio: ['ignore', 'pipe', 'pipe'], ...(signal ? { signal } : {}), ...(cwd ? { cwd } : {}) });
        let output = '', error = '', pending = '';
        child.stdout.on('data', chunk => {
            const text = String(chunk); output += text;
            pending += text;
            const lines = pending.split(/\r?\n/); pending = lines.pop() || '';
            for (const line of lines) { const match = /^out_time_us=(\d+)$/.exec(line); if (match) onTime?.(Number(match[1]) / 1000); }
        });
        child.stderr.on('data', chunk => { error = (error + String(chunk)).slice(-32768); });
        child.once('error', exception => reject(signal?.aborted ? new CanvasToolError('CANCELLED', 'Local media processing was cancelled') : exception));
        child.once('close', code => {
            if (signal?.aborted) reject(new CanvasToolError('CANCELLED', 'Local media processing was cancelled'));
            else if (code === 0) accept(output);
            else reject(new CanvasToolError('MEDIA_PROCESS_FAILED', `Media process exited ${code}: ${error.trim()}`));
        });
    });
}
async function localSource(version: CanvasAssetVersion): Promise<string> {
    if (!version?.id || !version.assetId || version.status === 'missing' || version.status === 'uploading') fail('A ready asset version is required');
    const uri = version.uri;
    if (typeof uri !== 'string' || !uri || (/^[a-z][a-z\d+.-]*:/i.test(uri) && !/^file:/i.test(uri) && !/^[a-z]:[\\/]/i.test(uri))) fail('Local media tools require an imported local file');
    const path = /^file:/i.test(uri) ? fileURLToPath(uri) : resolve(uri);
    if (!(await stat(path)).isFile()) fail('Source asset must be a file');
    return path;
}
async function verifySourceHash(version: CanvasAssetVersion, path: string, signal?: AbortSignal): Promise<void> {
    if (!version.metadata?.sha256) return;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) { abort(signal); hash.update(chunk); }
    if (hash.digest('hex') !== version.metadata.sha256) throw new CanvasToolError('SOURCE_BYTES_CHANGED', 'Source bytes no longer match this asset version');
}
const MIME: Record<string, string> = { '.mp4': 'video/mp4', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
/** Real decoded counts and stream metadata, never the caller's cached metadata. */
export async function probeCanvasMedia(path: string, options: Pick<CanvasLocalToolOptions, 'ffmpegPath' | 'ffprobePath' | 'signal'> = {}): Promise<CanvasToolMetadata> {
    abort(options.signal);
    const byteLength = (await stat(path)).size;
    if (!byteLength) fail('The media file is empty');
    // FFmpeg's WebP demuxer does not decode animated WebP. Read its actual RIFF frame table.
    if (extname(path).toLowerCase() === '.webp') {
        const data = await readFile(path);
        if (data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WEBP') fail('Invalid WebP file');
        let width = 0, height = 0, durationMs = 0, frameCount = 0;
        for (let offset = 12; offset + 8 <= data.length;) {
            const tag = data.toString('ascii', offset, offset + 4), size = data.readUInt32LE(offset + 4), body = offset + 8;
            if (body + size > data.length) fail('Truncated WebP file');
            if (tag === 'VP8X' && size >= 10) { width = 1 + data.readUIntLE(body + 4, 3); height = 1 + data.readUIntLE(body + 7, 3); }
            if (tag === 'ANMF' && size >= 16) { frameCount++; durationMs += data.readUIntLE(body + 12, 3); }
            offset = body + size + (size % 2);
        }
        if (frameCount && width && height) return { width, height, durationMs, frameCount, mediaKind: 'image', hasAudio: false, byteLength, mimeType: MIME['.webp'], frameRate: durationMs ? frameCount * 1000 / durationMs : undefined };
    }
    let raw: string;
    try {
        raw = await run(options.ffprobePath || 'ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', path], options.signal);
        JSON.parse(raw);
    } catch (error) {
        // ffprobe is not shipped with the app, and a system copy can be missing or broken (a Homebrew upgrade
        // leaves it unable to load its libraries). FFmpeg alone gives the same inventory and decoded count.
        if (!options.ffmpegPath || (error instanceof CanvasToolError && error.code === 'CANCELLED') || options.signal?.aborted) throw error;
        return probeCanvasMediaWithFfmpeg(path, options.ffmpegPath, byteLength, options.signal);
    }
    const probe = JSON.parse(raw) as { streams?: { codec_type?: string; width?: number; height?: number; duration?: string; nb_read_frames?: string; avg_frame_rate?: string; start_time?: string; side_data_list?: { rotation?: number }[] }[]; format?: { duration?: string; format_name?: string } };
    const streams = probe.streams || [], video = streams.find(stream => stream.codec_type === 'video');
    if (!streams.length) fail('No decodable media streams found');
    const duration = Number(probe.format?.duration ?? video?.duration);
    const [numerator, denominator] = (video?.avg_frame_rate || '').split('/').map(Number);
    const rotation = video?.side_data_list?.find(item => item.rotation !== undefined)?.rotation || 0;
    const swapped = Math.abs(rotation) % 180 === 90;
    const frameCount = Number(video?.nb_read_frames);
    return { ...(video ? { width: swapped ? video.height : video.width, height: swapped ? video.width : video.height } : {}),
        ...(Number.isFinite(duration) && duration > 0 ? { durationMs: duration * 1000 } : {}),
        ...(Number.isFinite(frameCount) && frameCount > 0 ? { frameCount } : {}),
        ...(numerator > 0 && denominator > 0 ? { frameRate: numerator / denominator } : {}),
        ...(Number.isFinite(Number(video?.start_time)) ? { streamStartMs: Number(video?.start_time) * 1000 } : {}),
        mediaKind: !video ? 'audio' : /image2|_pipe|gif|apng/.test(probe.format?.format_name || '') ? 'image' : 'video',
        hasAudio: streams.some(stream => stream.codec_type === 'audio'), byteLength, mimeType: MIME[extname(path).toLowerCase()] };
}
/** The stderr of a run that is expected to exit non-zero (`ffmpeg -i` without an output). */
function inventory(binary: string, args: readonly string[], signal?: AbortSignal): Promise<string> {
    abort(signal);
    return new Promise((accept, reject) => {
        const child = spawn(binary, [...args], { stdio: ['ignore', 'ignore', 'pipe'], ...(signal ? { signal } : {}) });
        let error = '';
        child.stderr.on('data', chunk => { if (error.length < 65536) error += String(chunk); });
        child.once('error', exception => reject(signal?.aborted ? new CanvasToolError('CANCELLED', 'Local media processing was cancelled') : exception));
        child.once('close', () => signal?.aborted ? reject(new CanvasToolError('CANCELLED', 'Local media processing was cancelled')) : accept(error));
    });
}
async function probeCanvasMediaWithFfmpeg(path: string, ffmpegPath: string, byteLength: number, signal?: AbortSignal): Promise<CanvasToolMetadata> {
    const text = await inventory(ffmpegPath, ['-hide_banner', '-nostdin', '-i', path], signal);
    const format = /Input #0, (.+?), from '/.exec(text)?.[1] || '';
    const lines = text.split(/\r?\n/), streams = lines.filter(line => /^\s*Stream #0:\d+/.test(line));
    if (!format || !streams.length) fail('No decodable media streams found');
    const videoIndex = lines.findIndex(line => /^\s*Stream #0:\d+\S*: Video:/.test(line) && !/\(attached pic\)/.test(line));
    const video = videoIndex >= 0 ? lines[videoIndex] : undefined;
    const clock = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
    const duration = clock ? Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]) : NaN;
    const size = video ? /, (\d+)x(\d+)(?=[ ,\[]|$)/.exec(video) : null;
    const rate = video ? Number((/, ([\d.]+) fps\b/.exec(video) ?? /, ([\d.]+) tbr\b/.exec(video))?.[1]) : NaN;
    // Side data of the video stream sits on the lines right below it, until the next stream.
    const following = videoIndex >= 0 ? lines.slice(videoIndex + 1) : [];
    const nextStream = following.findIndex(line => /^\s*Stream #/.test(line));
    const sideData = (nextStream >= 0 ? following.slice(0, nextStream) : following).join('\n');
    // FFmpeg 8 prints "displaymatrix: rotation of …", FFmpeg 9 "Display Matrix: rotation of …".
    const rotation = Number(/display\s*matrix:\s*rotation of (-?[\d.]+) degrees/i.exec(sideData)?.[1] || 0);
    const swapped = Math.abs(Math.round(rotation)) % 180 === 90;
    const start = Number(/, start: (-?[\d.]+)/.exec(text)?.[1]);
    let frameCount = NaN;
    if (video) {
        const progress = await run(ffmpegPath, ['-hide_banner', '-nostdin', '-v', 'error', '-i', path, '-map', '0:v:0', '-an', '-sn', '-dn', '-progress', 'pipe:1', '-nostats', '-f', 'null', '-'], signal);
        frameCount = Number([...progress.matchAll(/^frame=(\d+)$/gm)].pop()?.[1]);
    }
    const width = size ? Number(size[1]) : 0, height = size ? Number(size[2]) : 0;
    return { ...(video && width && height ? { width: swapped ? height : width, height: swapped ? width : height } : {}),
        ...(Number.isFinite(duration) && duration > 0 ? { durationMs: duration * 1000 } : {}),
        ...(Number.isFinite(frameCount) && frameCount > 0 ? { frameCount } : {}),
        ...(Number.isFinite(rate) && rate > 0 ? { frameRate: rate } : {}),
        ...(video && Number.isFinite(start) ? { streamStartMs: start * 1000 } : {}),
        mediaKind: !video ? 'audio' : /image2|_pipe|gif|apng/.test(format) ? 'image' : 'video',
        hasAudio: streams.some(line => /: Audio:/.test(line)), byteLength, mimeType: MIME[extname(path).toLowerCase()] };
}
function range(value: CanvasToolRange, metadata: CanvasToolMetadata): CanvasToolRange {
    number(value.inMs, 'inMs', 0); number(value.outMs, 'outMs', 0);
    if (!metadata.durationMs || value.outMs <= value.inMs || value.outMs > metadata.durationMs + 1) fail('Keep a positive range inside the probed media duration');
    return value;
}
function crop(value: CanvasToolCrop, metadata: CanvasToolMetadata): string {
    const width = metadata.width || 0, height = metadata.height || 0;
    number(value.x, 'crop x', 0, width, true); number(value.y, 'crop y', 0, height, true);
    number(value.width, 'crop width', 1, width, true); number(value.height, 'crop height', 1, height, true);
    if (value.x + value.width > width || value.y + value.height > height) fail('Crop rectangle is outside the image');
    return `crop=${value.width}:${value.height}:${value.x}:${value.y}:exact=1`;
}
/** A deliberately independent FFmpeg implementation of the manual controls. */
export function compileCanvasColorFilters(adjustments: CanvasColorAdjustments): readonly string[] {
    const allowed = ['exposure', 'brightness', 'contrast', 'saturation', 'vibrance', 'temperature', 'tint', 'highlights', 'shadows', 'whites', 'blacks', 'sharpen', 'vignette', 'fade', 'grain'];
    for (const [key, value] of Object.entries(adjustments)) {
        if (!allowed.includes(key)) fail(`Unknown colour adjustment: ${key}`);
        if (value !== undefined) number(value, key, ['sharpen', 'vignette', 'fade', 'grain'].includes(key) ? 0 : key === 'exposure' ? -200 : -100, key === 'exposure' ? 200 : 100);
    }
    const p = (key: keyof CanvasColorAdjustments): number => (adjustments[key] || 0) / 100;
    const filters: string[] = [];
    if (p('exposure')) filters.push(`lutrgb=r='clip(val*${2 ** p('exposure')},0,255)':g='clip(val*${2 ** p('exposure')},0,255)':b='clip(val*${2 ** p('exposure')},0,255)'`);
    if (p('brightness') || p('contrast') || p('saturation')) filters.push(`eq=brightness=${p('brightness') * .5}:contrast=${1 + p('contrast')}:saturation=${1 + p('saturation')}`);
    if (p('temperature') || p('tint')) filters.push(`colorbalance=rm=${p('temperature') * .25}:bm=${-p('temperature') * .25}:gm=${p('tint') * .25}`);
    if (p('vibrance')) filters.push(`vibrance=intensity=${p('vibrance')}`);
    if (p('highlights') || p('shadows') || p('whites') || p('blacks') || p('fade')) {
        const expression = `clip(val+${p('shadows') * 64}*pow(1-val/255,2)+${p('highlights') * 64}*pow(val/255,2)+${p('blacks') * 32}*pow(1-val/255,4)+${p('whites') * 32}*pow(val/255,4)+${p('fade') * 48}*(1-val/255),0,255)`;
        filters.push(`lutrgb=r='${expression}':g='${expression}':b='${expression}'`);
    }
    if (p('sharpen')) filters.push(`unsharp=5:5:${p('sharpen') * 1.5}:5:5:0`);
    if (p('vignette')) filters.push(`vignette=angle=${p('vignette') * Math.PI / 4}`);
    if (p('grain')) filters.push(`noise=alls=${Math.round(p('grain') * 40)}:allf=t+u:all_seed=1`);
    return filters;
}
const MAX_CUBE_BYTES = 64 * 1024 * 1024;
function assertCubeSize(byteLength: number): void { if (byteLength > MAX_CUBE_BYTES) fail('LUT files must not exceed 64 MiB'); }
async function readCanvasCube(path: string, signal?: AbortSignal): Promise<string> {
    const info = await stat(path);
    if (!info.isFile()) fail('LUT source must be a file');
    assertCubeSize(info.size);
    const chunks: Buffer[] = [];
    let byteLength = 0;
    for await (const chunk of createReadStream(path)) {
        abort(signal);
        byteLength += chunk.length;
        // Also bound the stream if the file grows after stat().
        assertCubeSize(byteLength);
        chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
}
/** Only caller-supplied 3D .cube files are accepted. Returns size after structural validation. */
export function validateCanvasCube(text: string): number {
    assertCubeSize(Buffer.byteLength(text, 'utf8'));
    let size = 0, count = 0; const domain: Record<string, number[]> = {};
    for (const [raw] of text.matchAll(/[^\r\n]+/g)) {
        const line = raw.replace(/#.*$/, '').trim(); if (!line) continue;
        if (/^TITLE\s/.test(line)) continue;
        if (/^LUT_1D_SIZE\b/.test(line)) fail('Only 3D cube LUTs are supported');
        if (/^LUT_3D_SIZE\b/.test(line)) { if (size) fail('Duplicate LUT size'); size = number(Number(line.split(/\s+/)[1]), 'LUT size', 2, 128, true); continue; }
        const values = line.split(/\s+/);
        if (/^DOMAIN_(MIN|MAX)\b/.test(line)) {
            if (values.length !== 4 || values.slice(1).some(value => !Number.isFinite(Number(value)))) fail('Invalid LUT domain');
            if (domain[values[0]]) fail('Duplicate LUT domain'); domain[values[0]] = values.slice(1).map(Number); continue;
        }
        if (values.length !== 3 || values.some(value => !Number.isFinite(Number(value)))) fail('Invalid cube RGB row');
        count++;
    }
    if (!size || count !== size ** 3) fail('LUT RGB row count must equal LUT_3D_SIZE cubed');
    const min = domain.DOMAIN_MIN || [0, 0, 0], max = domain.DOMAIN_MAX || [1, 1, 1];
    if (min.some((value, i) => value >= max[i])) fail('LUT domain maximum must exceed minimum');
    return size;
}
interface OutputPlan { readonly extension: string; readonly kind: CanvasAssetVersion['kind']; readonly args: readonly string[]; readonly durationMs?: number; readonly sources?: readonly CanvasAssetVersion[]; readonly metadata?: Partial<CanvasToolMetadata>; readonly execute?: (path: string, onTime: (ms: number) => void) => Promise<void> }
const videoEncode = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'];
const imageEncode = ['-frames:v', '1', '-update', '1'];
function evenFilter(): string { return 'pad=ceil(iw/2)*2:ceil(ih/2)*2'; }

/** Bounded binary decode: statistics and clustering use at most 256² pixels, never full-resolution RGBA. */
async function canvasImageSample(path: string, metadata: CanvasToolMetadata, ffmpeg: string, signal?: AbortSignal): Promise<{ readonly rgba: Buffer; readonly width: number; readonly height: number }> {
    abort(signal);
    const factor = Math.min(1, 256 / Math.max(metadata.width || 0, metadata.height || 0));
    const width = Math.max(1, Math.round((metadata.width || 0) * factor)), height = Math.max(1, Math.round((metadata.height || 0) * factor));
    const expected = width * height * 4;
    const rgba = await new Promise<Buffer>((accept, reject) => {
        const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', path, '-map', '0:v:0', '-an', '-frames:v', '1', '-filter_threads', '1', '-vf', `scale=${width}:${height}:flags=neighbor,format=rgba`, '-pix_fmt', 'rgba', '-f', 'rawvideo', '-'], { stdio: ['ignore', 'pipe', 'pipe'], ...(signal ? { signal } : {}) });
        const chunks: Buffer[] = []; let length = 0, error = '', exceeded = false;
        child.stdout.on('data', (chunk: Buffer) => { length += chunk.length; if (length > expected) { exceeded = true; child.kill(); } else chunks.push(chunk); });
        child.stderr.on('data', chunk => { error = (error + String(chunk)).slice(-32768); });
        child.once('error', exception => reject(signal?.aborted ? new CanvasToolError('CANCELLED', 'Local media processing was cancelled') : exception));
        child.once('close', code => {
            if (signal?.aborted) reject(new CanvasToolError('CANCELLED', 'Local media processing was cancelled'));
            else if (code !== 0 || exceeded || length !== expected) reject(new CanvasToolError('MEDIA_PROCESS_FAILED', `Image sample decode failed: ${error.trim()}`));
            else accept(Buffer.concat(chunks, expected));
        });
    });
    return { rgba, width, height };
}

/** Produces new files/versions only. It has no media-job enqueue dependency. */
export async function runCanvasLocalTool(request: CanvasLocalToolRequest, options: CanvasLocalToolOptions): Promise<CanvasLocalToolResult> {
    request = structuredClone(request);
    abort(options.signal);
    const sourcePath = await localSource(request.source), ffmpeg = options.ffmpegPath || 'ffmpeg';
    emit(options, { stage: 'probe', completedOutputs: 0, totalOutputs: 1 });
    // PNG decoding and inference work without FFmpeg, ffprobe or any provider route.
    if (request.tool === 'image.matting' || request.tool === 'image.depth') {
        if (request.source.kind !== 'image') fail('This tool requires an image asset');
        const parameters = request.parameters || {};
        if (Object.keys(parameters).some(key => request.tool !== 'image.depth' || key !== 'invert')
            || ('invert' in parameters && typeof parameters.invert !== 'boolean')) fail('Invalid on-device image parameters');
        if (!options.modelDirectory) throw new CanvasToolError('MODEL_DIRECTORY_REQUIRED', 'The application model cache is unavailable');
        await verifySourceHash(request.source, sourcePath, options.signal);
        await mkdir(options.outputDirectory, { recursive: true });
        const id = randomUUID(), path = join(resolve(options.outputDirectory), `${id}.png`);
        try {
            const model = await runCanvasOnDeviceImage(request.tool, sourcePath, path, {
                modelDirectory: options.modelDirectory, ffmpegPath: options.ffmpegPath, signal: options.signal,
                invert: request.tool === 'image.depth' ? request.parameters?.invert : undefined,
                onProgress: progress => emit(options, { ...progress, completedOutputs: 0, totalOutputs: 1 })
            });
            abort(options.signal);
            emit(options, { stage: 'verify', completedOutputs: 0, totalOutputs: 1, fraction: .99 });
            const bytes = await readFile(path), decoded = PNG.sync.read(bytes, { checkCRC: true });
            if (decoded.width !== model.width || decoded.height !== model.height) fail('On-device output dimensions do not match the decoded image');
            const version: CanvasToolVersion = { id, assetId: randomUUID(), kind: 'image', uri: pathToFileURL(path).href,
                createdAt: new Date().toISOString(), status: 'ready',
                metadata: { width: decoded.width, height: decoded.height, mediaKind: 'image', hasAudio: false,
                    frameCount: 1, byteLength: bytes.length, mimeType: 'image/png', sha256: createHash('sha256').update(bytes).digest('hex') },
                provenance: { sourceVersionId: request.source.id, operation: request.tool, tool: request.tool,
                    parameters: { ...parameters, modelId: model.modelId, modelSha256: model.modelSha256, runtime: 'onnxruntime-node' },
                    sourceVersionIds: [request.source.id] } };
            emit(options, { stage: 'complete', completedOutputs: 1, totalOutputs: 1, fraction: 1 });
            return { versions: [version] };
        } catch (error) { await unlink(path).catch(() => undefined); throw error; }
    }
    const metadata = await probeCanvasMedia(sourcePath, options);
    await verifySourceHash(request.source, sourcePath, options.signal);
    if (metadata.mediaKind !== request.source.kind) fail('Asset kind does not match its real media streams');
    if (request.tool.startsWith('video.') && (request.source.kind !== 'video' || !metadata.width)) fail('This tool requires a video asset');
    if (request.tool.startsWith('image.') && (request.source.kind !== 'image' || !metadata.width)) fail('This tool requires an image asset');
    if (request.tool.startsWith('audio.') && (request.source.kind !== 'audio' || !metadata.hasAudio)) fail('This tool requires an audio asset');
    if (request.tool.startsWith('color.') && (request.source.kind === 'audio' || !metadata.width)) fail('Colour tools require an image or video');
    await mkdir(options.outputDirectory, { recursive: true });
    if (request.tool === 'video.depth') {
        const parameters = request.parameters || {};
        if (typeof parameters !== 'object' || Array.isArray(parameters)
            || Object.keys(parameters).some(key => !['resolution', 'invert', 'smooth'].includes(key))) fail('Invalid video depth parameters');
        if (!options.modelDirectory) throw new CanvasToolError('MODEL_DIRECTORY_REQUIRED', 'The application model cache is unavailable');
        const id = randomUUID(), path = join(resolve(options.outputDirectory), `${id}.mp4`);
        try {
            const result = await runCanvasVideoDepth(sourcePath, path, { ...parameters, width: metadata.width!, height: metadata.height!,
                modelDirectory: options.modelDirectory, ffmpegPath: ffmpeg, signal: options.signal,
                onProgress: item => emit(options, { ...item, completedOutputs: 0, totalOutputs: 1 }) });
            const measured = await probeCanvasMedia(path, options), hash = createHash('sha256');
            if (measured.mediaKind !== 'video' || measured.hasAudio || measured.width !== result.width || measured.height !== result.height
                || measured.frameCount !== result.frameCount) fail('The depth video failed output verification');
            for await (const chunk of createReadStream(path)) { abort(options.signal); hash.update(chunk); }
            abort(options.signal);
            const version: CanvasToolVersion = { id, assetId: randomUUID(), kind: 'video', uri: pathToFileURL(path).href,
                createdAt: new Date().toISOString(), status: 'ready', metadata: { ...measured, sha256: hash.digest('hex') },
                provenance: { sourceVersionId: request.source.id, operation: request.tool, tool: request.tool,
                    parameters: { resolution: parameters.resolution ?? 'source', invert: parameters.invert ?? false, smooth: parameters.smooth ?? true,
                        modelId: result.modelId, modelSha256: result.modelSha256, runtime: 'onnxruntime-node' }, sourceVersionIds: [request.source.id] } };
            emit(options, { stage: 'complete', completedOutputs: 1, totalOutputs: 1, fraction: 1 });
            return { versions: [version] };
        } catch (error) { await unlink(path).catch(() => undefined); throw error; }
    }
    const input = ['-i', sourcePath], plans: OutputPlan[] = [], temporary: string[] = [], outputs: string[] = [];
    const isWebp = request.tool === 'video.export' && request.parameters.format === 'webp' || request.tool === 'image.convert' && request.parameters.format === 'webp';
    const encoders = isWebp ? await run(ffmpeg, ['-hide_banner', '-encoders'], options.signal) : '';
    const video = (filters: readonly string[] = [], before: readonly string[] = [], after: readonly string[] = [], durationMs = metadata.durationMs): OutputPlan => ({
        extension: 'mp4', kind: 'video', durationMs,
        args: [...before, ...input, '-map', '0:v:0', '-map', '0:a:0?', '-vf', [...filters, evenFilter()].join(','), ...videoEncode, ...after] });
    const audio = (format = 'wav', before: readonly string[] = [], after: readonly string[] = [], durationMs = metadata.durationMs): OutputPlan => {
        if (!metadata.hasAudio) fail('The source has no audio track');
        return { extension: format, kind: 'audio', durationMs, args: [...before, ...input, '-map', '0:a:0', '-vn', ...(format === 'wav' ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'libmp3lame', '-b:a', '192k']), ...after] };
    };
    const image = (filters: readonly string[] = [], extension = 'png', after: readonly string[] = []): OutputPlan => ({ extension, kind: 'image', args: [...input, '-map', '0:v:0', '-an', ...(filters.length ? ['-vf', filters.join(',')] : []), ...imageEncode, ...after] });
    try {
        switch (request.tool) {
            case 'video.trim': case 'audio.trim': {
                const keep = range(request.parameters, metadata), duration = keep.outMs - keep.inMs;
                const before = ['-ss', String(keep.inMs / 1000)], after = ['-t', String(duration / 1000)];
                plans.push(request.tool === 'video.trim' ? video([], before, after, duration) : audio('wav', before, after, duration)); break;
            }
            case 'video.split': {
                if (!request.parameters.segments.length) fail('Select at least one segment');
                let end = -1;
                for (const segment of request.parameters.segments) {
                    const keep = range(segment, metadata); if (keep.inMs < end) fail('Segments must be ordered and non-overlapping'); end = keep.outMs;
                    plans.push(video([], ['-ss', String(keep.inMs / 1000)], ['-t', String((keep.outMs - keep.inMs) / 1000)], keep.outMs - keep.inMs));
                } break;
            }
            case 'video.crop': {
                const parameters = request.parameters, filters: string[] = [];
                if (parameters.crop && parameters.aspectRatio) fail('Choose a crop rectangle or an aspect ratio');
                if (parameters.crop) filters.push(crop(parameters.crop, metadata));
                else if (parameters.aspectRatio) {
                    const ratio = number(parameters.aspectRatio[0], 'aspect width', .001) / number(parameters.aspectRatio[1], 'aspect height', .001);
                    const width = Math.min(metadata.width!, Math.floor(metadata.height! * ratio)), height = Math.min(metadata.height!, Math.floor(metadata.width! / ratio));
                    filters.push(crop({ x: Math.floor((metadata.width! - width) / 2), y: Math.floor((metadata.height! - height) / 2), width, height }, metadata));
                } else fail('Choose a crop rectangle or aspect ratio');
                if (parameters.mirror) filters.push('hflip'); plans.push(video(filters)); break;
            }
            case 'video.mirror': plans.push(video(['hflip'])); break;
            case 'image.mirror': plans.push(image(['hflip'])); break;
            case 'video.compress': {
                const p = request.parameters, filters: string[] = [];
                const width = number(p.maxWidth ?? metadata.width!, 'maxWidth', 2), height = number(p.maxHeight ?? metadata.height!, 'maxHeight', 2);
                const scale = Math.min(1, width / metadata.width!, height / metadata.height!);
                const outputWidth = Math.floor(metadata.width! * scale / 2) * 2, outputHeight = Math.floor(metadata.height! * scale / 2) * 2;
                if (!outputWidth || !outputHeight) fail('Compressed dimensions must be at least 2 pixels');
                filters.push(`scale=${outputWidth}:${outputHeight}`);
                if (p.fps !== undefined) { number(p.fps, 'fps', .1); if (!metadata.frameRate || p.fps > metadata.frameRate) fail('Compression may only reduce the probed frame rate'); filters.push(`fps=${p.fps}`); }
                plans.push(video(filters, [], ['-crf', String(number(p.crf ?? 24, 'crf', 0, 51))])); break;
            }
            case 'video.reverse': plans.push(video(['reverse', 'setpts=PTS-STARTPTS'], [], metadata.hasAudio ? ['-af', 'areverse,asetpts=PTS-STARTPTS'] : [])); break;
            case 'video.extractAudio': plans.push(audio(request.parameters?.format || 'mp3')); break;
            case 'video.wav': case 'audio.wav': plans.push(audio()); break;
            case 'video.videoOnly': plans.push({ ...video(), args: [...input, '-map', '0:v:0', '-an', '-vf', evenFilter(), ...videoEncode] }); break;
            case 'video.export': {
                const p = request.parameters, keep = range(p, metadata), fps = number(p.fps ?? 10, 'fps', 1, 60), width = number(p.width ?? 480, 'width', 1, 8192, true), quality = number(p.quality ?? 80, 'quality', 1, 100);
                if (!['gif', 'webp'].includes(p.format)) fail('Animated export must be GIF or WebP');
                const filters = `fps=${fps},scale=${width}:-1:flags=lanczos`, before = ['-ss', String(keep.inMs / 1000), ...input, '-t', String((keep.outMs - keep.inMs) / 1000), '-an'];
                const plan: OutputPlan = { extension: p.format, kind: 'image', durationMs: keep.outMs - keep.inMs, args: p.format === 'gif'
                    ? [...before, '-filter_complex', `[0:v]${filters},split[a][b];[a]palettegen=max_colors=256[p];[b][p]paletteuse`, '-loop', '0']
                    : [...before, '-vf', filters, '-c:v', 'libwebp_anim', '-quality', String(quality), '-loop', '0'] };
                if (p.format === 'webp' && !/\blibwebp_anim\b/.test(encoders)) {
                    plans.push({ ...plan, execute: async (path, onTime) => {
                        const frames = join(resolve(options.outputDirectory), `.${randomUUID()}.webp-frames`); temporary.push(frames); await mkdir(frames);
                        await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-progress', 'pipe:1', ...before, '-vf', filters, '-fps_mode', 'passthrough', join(frames, '%09d.png')], options.signal, onTime);
                        const files = (await readdir(frames)).filter(file => /^\d+\.png$/.test(file)).sort().map(file => join(frames, file));
                        if (!files.length) fail('No frames were decoded for WebP export');
                        await run(options.img2webpPath || 'img2webp', ['-loop', '0', '-lossy', '-q', String(quality), '-d', String(Math.round(1000 / fps)), ...files, '-o', path], options.signal);
                    } });
                } else plans.push(plan); break;
            }
            case 'image.crop': plans.push(image([crop(request.parameters, metadata)])); break;
            case 'image.convert': {
                const p = request.parameters, filters: string[] = [];
                if (!['png', 'jpeg', 'webp'].includes(p.format)) fail('Image format must be PNG, JPEG or WebP');
                const factor = Math.min(1, number(p.maxWidth ?? metadata.width!, 'maxWidth', 1) / metadata.width!, number(p.maxHeight ?? metadata.height!, 'maxHeight', 1) / metadata.height!);
                if (factor < 1) filters.push(`scale=${Math.max(1, Math.floor(metadata.width! * factor))}:${Math.max(1, Math.floor(metadata.height! * factor))}`);
                const quality = number(p.quality ?? 90, 'quality', 1, 100);
                const plan = image(filters, p.format === 'jpeg' ? 'jpg' : p.format, p.format === 'jpeg' ? ['-q:v', String(Math.round(31 - quality * .29))] : p.format === 'webp' ? ['-c:v', 'libwebp', '-quality', String(quality)] : []);
                if (p.format === 'webp' && !/\blibwebp\b/.test(encoders)) {
                    plans.push({ ...plan, execute: async (path, onTime) => {
                        const png = join(resolve(options.outputDirectory), `.${randomUUID()}.png`); temporary.push(png);
                        await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-progress', 'pipe:1', ...image(filters).args, png], options.signal, onTime);
                        await run(options.cwebpPath || 'cwebp', ['-q', String(quality), png, '-o', path], options.signal);
                    } });
                } else plans.push(plan); break;
            }
            case 'image.gridSplit': {
                const p = request.parameters, rows = number(p.rows, 'rows', 1, 20, true), columns = number(p.columns, 'columns', 1, 20, true), gap = number(p.gap ?? 0, 'gap', 0, 500, true);
                const cells = p.selectedCells?.length ? [...new Set(p.selectedCells)] : Array.from({ length: rows * columns }, (_, i) => i);
                for (const cell of cells) {
                    number(cell, 'cell index', 0, rows * columns - 1, true);
                    const row = Math.floor(cell / columns), column = cell % columns;
                    const left = Math.floor(column * metadata.width! / columns) + (column ? Math.ceil(gap / 2) : 0);
                    const right = Math.floor((column + 1) * metadata.width! / columns) - (column < columns - 1 ? Math.floor(gap / 2) : 0);
                    const top = Math.floor(row * metadata.height! / rows) + (row ? Math.ceil(gap / 2) : 0);
                    const bottom = Math.floor((row + 1) * metadata.height! / rows) - (row < rows - 1 ? Math.floor(gap / 2) : 0);
                    plans.push(image([crop({ x: left, y: top, width: right - left, height: bottom - top }, metadata)]));
                } break;
            }
            case 'image.gridStitch': {
                const p = request.parameters, rows = number(p.rows, 'rows', 1, 20, true), columns = number(p.columns, 'columns', 1, 20, true);
                const width = number(p.cellWidth, 'cellWidth', 1, 8192, true), height = number(p.cellHeight, 'cellHeight', 1, 8192, true), gap = number(p.gap ?? 4, 'gap', 0, 40, true);
                if (p.cells.length > rows * columns || !p.cells.some(Boolean)) fail('Place at least one image within the grid');
                const background = p.background || '#000000'; if (!/^#[\da-f]{6}$/i.test(background)) fail('Grid background must be a six-digit hex colour');
                const paths: string[] = [], sources: CanvasAssetVersion[] = [], indices: number[] = [];
                for (let i = 0; i < p.cells.length; i++) {
                    const cell = p.cells[i]; if (!cell) continue;
                    if (cell.kind !== 'image') fail('Grid cells must be image assets');
                    const path = await localSource(cell), probe = await probeCanvasMedia(path, options);
                    await verifySourceHash(cell, path, options.signal);
                    if (!probe.width || probe.mediaKind !== 'image') fail('Grid cells must contain real image files'); paths.push(path); sources.push(cell); indices.push(i);
                }
                const totalWidth = width * columns + gap * (columns - 1), totalHeight = height * rows + gap * (rows - 1);
                if (totalWidth * totalHeight > 64 * 1024 * 1024) fail('The stitched image must not exceed 64 megapixels');
                const filters = [`color=c=0x${background.slice(1)}:s=${totalWidth}x${totalHeight}:r=1,format=rgba[base]`];
                let previous = 'base';
                paths.forEach((_, i) => {
                    filters.push(`[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1[cell${i}]`);
                    filters.push(`[${previous}][cell${i}]overlay=x=${indices[i] % columns * (width + gap)}:y=${Math.floor(indices[i] / columns) * (height + gap)}:shortest=1:format=rgb[out${i}]`);
                    previous = `out${i}`;
                });
                plans.push({ extension: 'png', kind: 'image', sources, args: [...paths.flatMap(path => ['-i', path]), '-filter_complex', filters.join(';'), '-map', `[${previous}]`, '-an', ...imageEncode] }); break;
            }
            case 'color.curves': {
                const filter = compileCanvasCurvesFilter(request.parameters);
                plans.push(request.source.kind === 'video' ? video([filter]) : image(['format=rgba', filter])); break;
            }
            case 'color.transfer': {
                if (request.source.kind !== 'image' || request.parameters.reference?.kind !== 'image') fail('Colour transfer requires a source image and a reference image');
                const p = request.parameters, referencePath = await localSource(p.reference), referenceMetadata = await probeCanvasMedia(referencePath, options);
                await verifySourceHash(p.reference, referencePath, options.signal);
                if (referenceMetadata.mediaKind !== 'image' || !referenceMetadata.width) fail('Colour reference must contain a real image file');
                const sourceSample = await canvasImageSample(sourcePath, metadata, ffmpeg, options.signal);
                const referenceSample = await canvasImageSample(referencePath, referenceMetadata, ffmpeg, options.signal);
                const sourceStatistics = canvasLabStatistics(sourceSample.rgba), referenceStatistics = canvasLabStatistics(referenceSample.rgba), lutSize = 33;
                const cubeText = buildCanvasColorTransferCube(sourceStatistics, referenceStatistics, p, lutSize);
                const lut = join(resolve(options.outputDirectory), `.${randomUUID()}.cube`); temporary.push(lut);
                await writeFile(lut, cubeText, { flag: 'wx' });
                plans.push({ ...image(['format=rgba', `lut3d=file='${basename(lut)}':interp=trilinear`, 'format=rgba']), sources: [p.reference],
                    metadata: { colorTransfer: { algorithm: 'lab-moments-d65-v1', source: sourceStatistics, reference: referenceStatistics, lutSize } } }); break;
            }
            case 'image.paletteExtract': {
                const sample = await canvasImageSample(sourcePath, metadata, ffmpeg, options.signal);
                const palette = extractCanvasPalette(sample.rgba, request.parameters?.colorCount ?? 6, sample.width, sample.height);
                const ppm = join(resolve(options.outputDirectory), `.${randomUUID()}.ppm`); temporary.push(ppm);
                await writeFile(ppm, canvasPalettePpm(palette), { flag: 'wx' });
                plans.push({ extension: 'png', kind: 'image', args: ['-i', ppm, '-map', '0:v:0', '-an', ...imageEncode], metadata: { palette } }); break;
            }
            case 'color.adjust': case 'color.lut': {
                const filters = [...compileCanvasColorFilters(request.tool === 'color.adjust' ? request.parameters : request.parameters.adjustments || {})];
                let lut: string | undefined, strength = 1;
                if (request.tool === 'color.lut') {
                    if (extname(request.parameters.cubePath).toLowerCase() !== '.cube') fail('Import a user-provided .cube file');
                    const cubeText = await readCanvasCube(request.parameters.cubePath, options.signal); validateCanvasCube(cubeText);
                    // A generated safe filename avoids interpolating caller paths into the filter grammar.
                    lut = join(resolve(options.outputDirectory), `.${randomUUID()}.cube`); temporary.push(lut);
                    await writeFile(lut, cubeText, { flag: 'wx' }); strength = number(request.parameters.strength ?? 1, 'LUT strength', 0, 1);
                }
                const encoded = request.source.kind === 'video' ? video(filters) : image(filters);
                if (lut) {
                    const escaped = basename(lut); // Safe generated name, resolved from the FFmpeg working directory.
                    const post = filters.length ? ',' + filters.join(',') : '';
                    const visual = request.source.kind === 'video' ? `${post},${evenFilter()}` : post;
                    const complex = `[0:v]split[original][toLut];[toLut]lut3d=file='${escaped}':interp=trilinear[graded];[original][graded]blend=all_expr='A*(1-${strength})+B*${strength}'${visual}[output]`;
                    plans.push({ ...encoded, args: [...input, '-filter_complex', complex, '-map', '[output]', ...(encoded.kind === 'video' ? ['-map', '0:a:0?', ...videoEncode] : ['-an', ...imageEncode])] });
                } else plans.push(encoded); break;
            }
            default: fail('Unknown local media tool');
        }
        const versions: CanvasToolVersion[] = [];
        for (const [i, plan] of plans.entries()) {
            abort(options.signal);
            const id = randomUUID(), path = join(resolve(options.outputDirectory), `${id}.${plan.extension}`); outputs.push(path);
            emit(options, { stage: 'process', completedOutputs: i, totalOutputs: plans.length, fraction: i / plans.length });
            const onTime = (processedMs: number): void => {
                emit(options, { stage: 'process', completedOutputs: i, totalOutputs: plans.length, processedMs,
                    ...(plan.durationMs ? { fraction: Math.min((i + Math.min(processedMs / plan.durationMs, .99)) / plans.length, .99) } : {}) });
            };
            if (plan.execute) await plan.execute(path, onTime);
            else await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-progress', 'pipe:1', '-filter_threads', '1', '-filter_complex_threads', '1', ...plan.args, path], options.signal, onTime, resolve(options.outputDirectory));
            emit(options, { stage: 'verify', completedOutputs: i, totalOutputs: plans.length });
            const measured = await probeCanvasMedia(path, options), hash = createHash('sha256');
            for await (const chunk of createReadStream(path)) { abort(options.signal); hash.update(chunk); }
            if (plan.kind !== 'audio' && (!measured.width || !measured.height)) fail('Output has no visual stream');
            if (plan.kind === 'audio' && !measured.hasAudio) fail('Output has no audio track');
            versions.push({ id, assetId: randomUUID(), kind: plan.kind, uri: pathToFileURL(path).href, createdAt: new Date().toISOString(), status: 'ready',
                metadata: { ...measured, ...plan.metadata, sha256: hash.digest('hex') }, provenance: { sourceVersionId: request.source.id, operation: request.tool, tool: request.tool,
                    parameters: JSON.parse(JSON.stringify(request.parameters || {})) as Record<string, unknown>, sourceVersionIds: [request.source.id, ...(plan.sources || []).map(source => source.id)].filter((value, index, all) => all.indexOf(value) === index) } });
        }
        emit(options, { stage: 'complete', completedOutputs: plans.length, totalOutputs: plans.length, fraction: 1 });
        return { versions };
    } catch (error) {
        // Multi-output tools are atomic: no orphaned partial results after failure or cancellation.
        await Promise.all(outputs.map(path => unlink(path).catch(() => undefined))); throw error;
    } finally { await Promise.all(temporary.map(path => rm(path, { recursive: true, force: true }).catch(() => undefined))); }
}

export async function resolveCanvasToolFfprobe(ffmpegPath: string): Promise<string> {
    const adjacent = join(dirname(ffmpegPath), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    try { await access(adjacent); return adjacent; } catch { return 'ffprobe'; }
}
