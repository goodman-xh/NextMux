import { spawn } from 'node:child_process';
import { statfsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CANVAS_ON_DEVICE_MODELS } from '../common/nextmux-canvas-on-device-models';
import { CanvasOnDeviceError, downloadCanvasOnDeviceModel } from './nextmux-canvas-on-device';
import type { CanvasOnDeviceProgress } from './nextmux-canvas-on-device';

export interface CanvasVideoDepthOptions {
    readonly width: number; readonly height: number;
    readonly resolution?: 'source' | '720' | '480';
    readonly invert?: boolean; readonly smooth?: boolean;
    readonly modelDirectory: string; readonly ffmpegPath: string;
    readonly signal?: AbortSignal;
    readonly onProgress?: (progress: CanvasOnDeviceProgress) => void;
    /** An independently compiled worker and process observer for isolated integration tests. */
    readonly workerPath?: string;
    /** Tests may lower the real free-space budget; this never overrides the available-space check. */
    readonly temporaryBudgetBytes?: number;
    readonly onChild?: (phase: 'inspect' | 'decode' | 'infer' | 'encode' | 'verify', pid: number) => void;
}
function abort(signal?: AbortSignal): void {
    if (signal?.aborted) throw new CanvasOnDeviceError('CANCELLED', 'Video depth processing was cancelled');
}
function invalid(message: string): never { throw new CanvasOnDeviceError('VIDEO_TIMING_INVALID', message); }
function progress(options: CanvasVideoDepthOptions, stage: CanvasOnDeviceProgress['stage'], fraction: number): void {
    try { options.onProgress?.({ stage, fraction }); } catch { /* observer only */ }
}

export function videoDepthDimensions(width: number, height: number, resolution: CanvasVideoDepthOptions['resolution'] = 'source', sampleAspectRatio = 1): { width: number; height: number } {
    if (![width, height].every(value => Number.isSafeInteger(value) && value >= 2) || width * height > 64 * 1024 * 1024
        || !Number.isFinite(sampleAspectRatio) || sampleAspectRatio <= 0
        || !['source', '720', '480'].includes(resolution)) throw new CanvasOnDeviceError('INVALID_TOOL_INPUT', 'Video depth needs valid dimensions and source, 720 or 480 resolution');
    // Normalize anamorphic pixels by shrinking one axis, preserving display shape without upsampling.
    if (sampleAspectRatio >= 1) height /= sampleAspectRatio; else width *= sampleAspectRatio;
    if (Math.min(width, height) < 2) throw new CanvasOnDeviceError('INVALID_TOOL_INPUT', 'Video display aspect is too narrow for an even-sized depth output');
    const factor = Math.min(1, (resolution === 'source' ? 1080 : Number(resolution)) / Math.min(width, height));
    return { width: Math.max(2, Math.floor(width * factor / 2) * 2), height: Math.max(2, Math.floor(height * factor / 2) * 2) };
}

/** Await close even on cancellation: callers may then safely remove every temporary file. */
function run(binary: string, args: readonly string[], options: CanvasVideoDepthOptions, phase: Parameters<NonNullable<CanvasVideoDepthOptions['onChild']>>[0],
    onLine?: (line: string, stream: 'stdout' | 'stderr') => void, checkResources?: () => void): Promise<string> {
    abort(options.signal);
    checkResources?.();
    return new Promise((accept, reject) => {
        const child = spawn(binary, [...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
        let output = '', error = '', failure: Error | undefined;
        const cancel = (): void => { child.kill('SIGKILL'); };
        const check = (): void => {
            if (failure) return;
            try { checkResources?.(); } catch (exception) { failure ||= exception as Error; cancel(); }
        };
        const watcher = checkResources ? setInterval(check, 100) : undefined;
        options.signal?.addEventListener('abort', cancel, { once: true });
        for (const [stream, pipe] of [['stdout', child.stdout], ['stderr', child.stderr]] as const) {
            let pending = '';
            pipe.on('data', (chunk: Buffer) => {
                const text = String(chunk);
                if (stream === 'stdout') output = (output + text).slice(-65_536); else error = (error + text).slice(-16_384);
                pending += text; const lines = pending.split(/\r?\n/); pending = lines.pop() || '';
                try { check(); if (!failure) for (const line of lines) onLine?.(line, stream); }
                catch (exception) { failure ||= exception as Error; cancel(); }
            });
        }
        child.once('error', exception => { failure ||= exception; });
        child.once('close', code => {
            if (watcher) clearInterval(watcher);
            options.signal?.removeEventListener('abort', cancel);
            if (options.signal?.aborted) reject(new CanvasOnDeviceError('CANCELLED', 'Video depth processing was cancelled'));
            else if (failure) reject(failure);
            else if (code !== 0) reject(new CanvasOnDeviceError('VIDEO_DEPTH_FAILED', `${phase} exited ${code}: ${error.trim()}`));
            else accept(output);
        });
        if (options.signal?.aborted) cancel();
        try { if (child.pid) options.onChild?.(phase, child.pid); } catch { /* observer only */ }
    });
}

// Different request IDs may execute in parallel. Reserve conservative peak bytes per volume until
// cleanup, in addition to checking real free space as other processes can also write to that volume.
const temporaryReservations = new Map<string, bigint>();

interface Packet { readonly ptsUs: number; readonly durationUs: number }
export function videoDepthPackets(text: string): Packet[] {
    const base = /^#tb 0:\s*(\d+)\/(\d+)/m.exec(text);
    if (!base || !Number(base[2])) invalid('The video has no verifiable packet time base');
    const scale = (value: string): number => {
        const numerator = BigInt(value) * BigInt(base![1]) * 1_000_000n, denominator = BigInt(base![2]);
        const absolute = numerator < 0n ? -numerator : numerator;
        const result = Number((absolute + denominator / 2n) / denominator) * (numerator < 0n ? -1 : 1);
        if (!Number.isSafeInteger(result)) invalid('Video timestamps exceed the supported precision');
        return result;
    };
    return text.split(/\r?\n/).flatMap(line => {
        const match = /^0,\s*(-?\d+),\s*(-?\d+),\s*(\d+),/.exec(line);
        return match ? [{ ptsUs: scale(match[2]), durationUs: scale(match[3]) }] : [];
    });
}

/** Balanced branches avoid expression recursion limits; constant-rate spans need only one expression. */
export function videoDepthPtsExpression(ptsUs: readonly number[]): string {
    if (!ptsUs.length || ptsUs[0] !== 0 || ptsUs.some((pts, index) => !Number.isSafeInteger(pts) || pts < 0 || index > 0 && pts <= ptsUs[index - 1])) invalid('Decoded frame timestamps must strictly increase');
    const build = (start: number, end: number): string => {
        if (end - start === 1) return String(ptsUs[start]);
        const step = ptsUs[start + 1] - ptsUs[start];
        let regular = true;
        for (let index = start + 2; index < end; index++) if (ptsUs[index] - ptsUs[index - 1] !== step) { regular = false; break; }
        if (regular) return `${ptsUs[start]}+(N-${start})*${step}`;
        const middle = Math.floor((start + end) / 2);
        return `if(lt(N,${middle}),${build(start, middle)},${build(middle, end)})`;
    };
    return build(0, ptsUs.length);
}

/** Decode actual frames and their PTS, infer every frame with one native session, then restore their clock. */
export async function runCanvasVideoDepth(sourcePath: string, outputPath: string, options: CanvasVideoDepthOptions): Promise<{
    width: number; height: number; frameCount: number; durationMs: number; modelId: string; modelSha256: string;
}> {
    abort(options.signal);
    videoDepthDimensions(options.width, options.height, options.resolution);
    if (options.invert !== undefined && typeof options.invert !== 'boolean' || options.smooth !== undefined && typeof options.smooth !== 'boolean')
        throw new CanvasOnDeviceError('INVALID_TOOL_INPUT', 'Depth invert and smooth must be booleans');
    const model = CANVAS_ON_DEVICE_MODELS['image.depth'];
    const modelPath = await downloadCanvasOnDeviceModel(model, { modelDirectory: options.modelDirectory, signal: options.signal,
        onProgress: item => { try { options.onProgress?.({ ...item, fraction: Math.min(.1, (item.fraction || 0) / 6) }); } catch { /* observer only */ } } });
    await mkdir(dirname(outputPath), { recursive: true });
    const directory = await mkdtemp(join(dirname(outputPath), '.video-depth-'));
    let volume: string | undefined, reservedBytes = 0n;
    try {
        const disk = statfsSync(directory, { bigint: true }), free = disk.bavail * disk.bsize;
        volume = String((await stat(directory, { bigint: true })).dev);
        // Keep headroom for the OS and model/runtime files. Eight bytes per pixel conservatively
        // covers decoded RGB PNG, inferred depth, encoder output and per-frame container overhead.
        const reserve = free / 20n > 256n * 1024n * 1024n ? free / 20n : 256n * 1024n * 1024n;
        let budget = free > reserve ? free - reserve : 0n;
        if (options.temporaryBudgetBytes !== undefined) {
            if (!Number.isSafeInteger(options.temporaryBudgetBytes) || options.temporaryBudgetBytes < 0)
                throw new CanvasOnDeviceError('INVALID_TOOL_INPUT', 'The temporary storage budget must be a nonnegative integer');
            if (BigInt(options.temporaryBudgetBytes) < budget) budget = BigInt(options.temporaryBudgetBytes);
        }
        const insufficientSpace = (): never => { throw new CanvasOnDeviceError('LOCAL_STORAGE_INSUFFICIENT',
            'Not enough free local disk space for this depth video. Free disk space or choose a smaller output size.'); };
        const checkFreeSpace = (): void => {
            const current = statfsSync(directory, { bigint: true });
            if (current.bavail * current.bsize <= reserve) insufficientSpace();
        };
        checkFreeSpace();
        const version = await run(options.ffmpegPath, ['-version'], options, 'inspect');
        const major = Number(/ffmpeg version (?:n)?(\d+)/.exec(version)?.[1]);
        if (!major || major < 4) throw new CanvasOnDeviceError('FFMPEG_UNAVAILABLE', 'Video depth requires FFmpeg 4 or newer');
        let sourceSize: { width: number; height: number; sar: number } | undefined;
        // showinfo sees the same automatically rotated frame and SAR as the subsequent decoder.
        // Keep this local to depth; changing generic media metadata would affect other canvas tools.
        await run(options.ffmpegPath, ['-hide_banner', '-nostdin', '-i', sourcePath, '-map', '0:v:0', '-an', '-sn', '-dn',
            '-vf', 'showinfo', '-frames:v', '1', '-f', 'null', '-'], options, 'inspect', line => {
            if (sourceSize || !/\bn:\s*0\s+pts:/.test(line)) return;
            const dimensions = /\bs:(\d+)x(\d+)/.exec(line), sar = /\bsar:(\d+)\/(\d+)/.exec(line);
            if (dimensions) sourceSize = { width: Number(dimensions[1]), height: Number(dimensions[2]),
                sar: sar && Number(sar[1]) && Number(sar[2]) ? Number(sar[1]) / Number(sar[2]) : 1 };
        }, checkFreeSpace);
        if (!sourceSize) throw new CanvasOnDeviceError('VIDEO_DEPTH_FAILED', 'Cannot read the source video display dimensions');
        const size = videoDepthDimensions(sourceSize.width, sourceSize.height, options.resolution, sourceSize.sar);
        const frameBytes = BigInt(size.width * size.height * 8 + 65_536);
        const ensureSpace = (frames: number): void => {
            checkFreeSpace();
            const desired = BigInt(frames) * frameBytes, total = temporaryReservations.get(volume!) || 0n;
            if (desired > budget || total + desired - reservedBytes > budget) insufficientSpace();
            temporaryReservations.set(volume!, total + desired - reservedBytes);
            reservedBytes = desired;
        };
        ensureSpace(1);
        const sync = major >= 5 ? ['-fps_mode', 'passthrough'] : ['-vsync', '0'];
        const sourcePts: number[] = [], packetPath = join(directory, 'source-packets.txt');
        progress(options, 'process', .1);
        await run(options.ffmpegPath, ['-hide_banner', '-nostdin', '-n', '-copyts', '-i', sourcePath,
            '-map', '0:v:0', '-an', '-sn', '-dn', '-vf', `scale=${size.width}:${size.height},setsar=1,settb=1/1000000,showinfo`,
            '-c:v', 'png', '-threads', '1', ...sync, '-start_number', '0', join(directory, 'source-%08d.png'),
            '-map', '0:v:0', '-an', '-sn', '-dn', '-c:v', 'copy', '-f', 'framecrc', packetPath], options, 'decode', line => {
            const frame = /\bn:\s*(\d+)\s+pts:\s*(-?\d+)\s+pts_time:/.exec(line);
            if (frame) {
                if (Number(frame[1]) !== sourcePts.length) invalid('Decoded frames lost their timestamp order');
                ensureSpace(sourcePts.length + 1);
                sourcePts.push(Number(frame[2]));
            }
        }, checkFreeSpace);
        abort(options.signal);
        const packets = videoDepthPackets(await readFile(packetPath, 'utf8'));
        const last = packets.find(packet => packet.ptsUs === sourcePts.at(-1));
        if (!last || last.durationUs <= 0) invalid('The final decoded frame has no exact source duration');
        const pts = sourcePts.map(value => value - sourcePts[0]), expression = videoDepthPtsExpression(pts);
        const decodedFiles = (await readdir(directory)).filter(name => /^source-\d{8,}\.png$/.test(name));
        if (decodedFiles.length !== pts.length) invalid('Decoded frame count does not match the source timestamps');
        const durationUs = pts[pts.length - 1] + last.durationUs;
        if (!Number.isSafeInteger(durationUs)) invalid('The video duration exceeds the supported precision');
        const scriptPath = join(directory, 'timestamps.filter');
        await writeFile(scriptPath, `settb=1/1000000,setpts='${expression}',setsar=1`, { mode: 0o600 });
        progress(options, 'process', .2);
        const worker = options.workerPath || join(__dirname, 'nextmux-canvas-on-device-worker.js').replace(/\.asar([/\\])/, '.asar.unpacked$1');
        await run(process.execPath, [worker, JSON.stringify({ mode: 'video', modelPath, directory, frameCount: pts.length,
            invert: options.invert ?? false, smooth: options.smooth ?? true })], options, 'infer', (line, stream) => {
            if (stream !== 'stdout' || !line.startsWith('{')) return;
            const message = JSON.parse(line) as { processedFrames?: number };
            if (message.processedFrames) progress(options, 'process', Math.min(.85, .2 + .65 * message.processedFrames / pts.length));
        }, checkFreeSpace);
        abort(options.signal);
        progress(options, 'process', .85);
        const encoded = join(directory, 'depth.mp4');
        // 4.4 supports a passthrough clock with an explicit last-frame rate. Newer FFmpeg disallows
        // -r with passthrough; setts writes the exact packet duration instead. Neither resamples frames.
        const ending = major >= 5 ? ['-bsf:v', `setts=duration=${last.durationUs}`] : ['-r', `1000000/${last.durationUs}`];
        await run(options.ffmpegPath, ['-hide_banner', '-v', 'error', '-nostdin', '-n', '-framerate', '1', '-start_number', '0',
            '-i', join(directory, 'depth-%08d.png'), '-map', '0:v:0', '-an', '-sn', '-dn', '-map_metadata', '-1',
            major >= 9 ? '-/filter:v' : '-filter_script:v', scriptPath, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
            '-pix_fmt', 'yuv420p', '-bf', '0', '-enc_time_base', '1:1000000', ...sync,
            '-video_track_timescale', '1000000', ...ending, '-movflags', '+faststart', encoded], options, 'encode', undefined, checkFreeSpace);
        progress(options, 'verify', .95);
        const outputPackets = join(directory, 'output-packets.txt');
        await run(options.ffmpegPath, ['-hide_banner', '-v', 'error', '-nostdin', '-n', '-i', encoded,
            '-map', '0:v:0', '-c:v', 'copy', '-f', 'framecrc', outputPackets], options, 'verify', undefined, checkFreeSpace);
        const measured = videoDepthPackets(await readFile(outputPackets, 'utf8')).sort((a, b) => a.ptsUs - b.ptsUs);
        if (measured.length !== pts.length || measured.some((packet, index) => Math.abs(packet.ptsUs - pts[index]) > 1)
            || Math.abs(measured.at(-1)!.durationUs - last.durationUs) > 1) invalid('Encoded depth video did not preserve every source frame timestamp and duration');
        abort(options.signal);
        await rename(encoded, outputPath);
        return { ...size, frameCount: pts.length, durationMs: durationUs / 1000, modelId: model.id, modelSha256: model.sha256 };
    } finally {
        try { await rm(directory, { recursive: true, force: true }); }
        finally {
            if (volume && reservedBytes) {
                const remaining = (temporaryReservations.get(volume) || 0n) - reservedBytes;
                if (remaining > 0n) temporaryReservations.set(volume, remaining); else temporaryReservations.delete(volume);
            }
        }
    }
}
