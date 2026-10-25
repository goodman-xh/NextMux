import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export type CanvasFrameSelection = { readonly kind: 'first' | 'last' } | { readonly kind: 'time'; readonly timeMs: number };
export interface CanvasFrameExtractionRequest {
    readonly ffmpegPath: string;
    readonly ffprobePath?: string;
    readonly sourcePath: string;
    readonly outputPath: string;
    /** Time points are relative to the first decoded presentation timestamp. */
    readonly selection: CanvasFrameSelection;
    readonly signal?: AbortSignal;
}
export interface CanvasExtractedFrame {
    readonly actualTimeMs: number;
    readonly sourceTimestampMs: number;
    readonly sourceFrameIndex: number;
    readonly timeBase?: string;
    readonly width: number;
    readonly height: number;
}

function run(binary: string, args: readonly string[], signal?: AbortSignal, retainStderr = false): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        // windowsHide: ffmpeg/ffprobe must never flash a console window on Windows while a frame is extracted.
        const child = spawn(binary, [...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, ...(signal ? { signal } : {}) });
        const output: Buffer[] = [];
        let errors = '';
        child.stdout.on('data', chunk => output.push(Buffer.from(chunk)));
        child.stderr.on('data', chunk => { errors = retainStderr ? errors + String(chunk) : (errors + String(chunk)).slice(-32_768); });
        child.on('error', reject);
        child.on('close', code => {
            if (code === 0) resolve({ stdout: Buffer.concat(output).toString('utf8'), stderr: errors });
            else reject(new Error(`Canvas media process failed (${code}): ${errors.trim()}`));
        });
    });
}

async function probePath(request: CanvasFrameExtractionRequest): Promise<string> {
    if (request.ffprobePath) return request.ffprobePath;
    const adjacent = join(dirname(request.ffmpegPath), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    try { await access(adjacent); return adjacent; } catch { return 'ffprobe'; }
}

interface DecodedFrame { readonly timestampMs: number; readonly width: number; readonly height: number; }

/** Uses decoded presentation timestamps, including VFR and nonzero stream origins. No duration-minus-frame guess. */
export async function extractCanvasVideoFrame(request: CanvasFrameExtractionRequest): Promise<CanvasExtractedFrame> {
    if (!request || !request.outputPath.toLowerCase().endsWith('.png') || !['first', 'last', 'time'].includes(request.selection?.kind)
        || (request.selection.kind === 'time' && (!Number.isFinite(request.selection.timeMs) || request.selection.timeMs < 0))) {
        throw new Error('Invalid canvas frame selection');
    }
    // FFmpeg/ffprobe positional filenames beginning with '-' are options unless
    // represented as absolute paths. Capture relative paths before any await.
    request = { ...request, sourcePath: resolve(request.sourcePath), outputPath: resolve(request.outputPath) };
    const source = await stat(request.sourcePath);
    if (!source.isFile()) throw new Error('Canvas video source is not a file');
    // FFmpeg 9 removed -vsync; older packaged builds do not have -fps_mode.
    // Probe the executable itself so custom/versionless builds also keep every decoded frame.
    const help = await run(request.ffmpegPath, ['-hide_banner', '-h', 'full'], request.signal, true);
    const options = `${help.stdout}\n${help.stderr}`;
    const sync = /^\s*-fps_mode(?:\s|\[)/m.test(options) ? ['-fps_mode', 'passthrough']
        : /^\s*-vsync\s/m.test(options) ? ['-vsync', '0'] : undefined;
    if (!sync) throw new Error('FFmpeg does not expose a timestamp-preserving video sync mode');
    const ffprobe = await probePath(request);
    let frames: DecodedFrame[] = [];
    let timeBase: string | undefined;
    try {
        const result = await run(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_streams',
            '-show_entries', 'frame=best_effort_timestamp,best_effort_timestamp_time,width,height:stream=time_base',
            '-of', 'json', request.sourcePath], request.signal);
        const probe = JSON.parse(result.stdout) as { streams?: { time_base?: string }[]; frames?: {
            best_effort_timestamp?: number; best_effort_timestamp_time?: string; width?: number; height?: number;
        }[] };
        timeBase = probe.streams?.[0]?.time_base;
        const [numerator, denominator] = (timeBase || '').split('/').map(Number);
        frames = (probe.frames || []).map(frame => ({
            timestampMs: denominator > 0 && numerator > 0 && Number.isFinite(frame.best_effort_timestamp)
                ? frame.best_effort_timestamp! * numerator / denominator * 1_000 : Number(frame.best_effort_timestamp_time) * 1_000,
            width: frame.width || 0, height: frame.height || 0,
        }));
    } catch (error) {
        if (request.ffprobePath || request.signal?.aborted) throw error;
        // Some packaged FFmpeg distributions omit ffprobe. showinfo still provides real decoded timestamps.
        const result = await run(request.ffmpegPath, ['-hide_banner', '-nostdin', '-copyts', '-i', request.sourcePath, '-map', '0:v:0',
            '-vf', 'showinfo', '-an', ...sync, '-f', 'null', '-'], request.signal, true);
        timeBase = /config in time_base:\s*(\d+\/\d+)/.exec(result.stderr)?.[1];
        const [numerator, denominator] = (timeBase || '').split('/').map(Number);
        if (!(numerator > 0 && denominator > 0)) throw new Error('Video has no decoded presentation time base');
        for (const line of result.stderr.split('\n')) {
            const match = /\bn:\s*(\d+)\s+pts:\s*(-?\d+)\s+pts_time:([\d.eE+-]+).*?\bs:(\d+)x(\d+)/.exec(line);
            if (!match) continue;
            if (Number(match[1]) !== frames.length || !Number.isSafeInteger(Number(match[2]))) throw new Error('Video has incomplete decoded presentation timestamps');
            // pts_time is formatted with limited significant digits, especially with a large stream origin.
            frames.push({ timestampMs: Number(match[2]) * numerator / denominator * 1_000, width: Number(match[4]), height: Number(match[5]) });
        }
    }
    if (!frames.length || frames.some(frame => !frame || !Number.isFinite(frame.timestampMs) || frame.width <= 0 || frame.height <= 0)) {
        throw new Error('Video has no complete decoded presentation timestamps');
    }
    const originMs = frames[0].timestampMs;
    let index = request.selection.kind === 'last' ? frames.length - 1 : 0;
    if (request.selection.kind === 'time') {
        const targetMs = originMs + request.selection.timeMs;
        if (targetMs > frames[frames.length - 1].timestampMs + 0.001) throw new Error('Requested time is after the last decoded frame');
        // The frame visible at a time point is the last presentation frame at or before it.
        for (let candidate = 1; candidate < frames.length && frames[candidate].timestampMs <= targetMs + 0.001; candidate++) index = candidate;
    }
    const temporaryOutput = join(dirname(request.outputPath), `.canvas-frame-${randomUUID()}.png`);
    try {
        await run(request.ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-i', request.sourcePath,
            '-map', '0:v:0', '-vf', `select=eq(n\\,${index})`, ...sync, '-frames:v', '1', '-update', '1', temporaryOutput], request.signal);
        // PNG IHDR measures the actual output, including FFmpeg autorotation.
        const png = await readFile(temporaryOutput);
        if (png.length < 24 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
            throw new Error('Canvas frame output must be a PNG image');
        }
        request.signal?.throwIfAborted();
        // image2's update mode can ignore FFmpeg's -n. Exclusive filesystem
        // creation keeps an existing output (including symlinks) untouched.
        await writeFile(request.outputPath, png, { flag: 'wx' });
        return { actualTimeMs: frames[index].timestampMs - originMs, sourceTimestampMs: frames[index].timestampMs,
            sourceFrameIndex: index, ...(timeBase ? { timeBase } : {}), width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
    } finally { await unlink(temporaryOutput).catch(() => undefined); }
}
