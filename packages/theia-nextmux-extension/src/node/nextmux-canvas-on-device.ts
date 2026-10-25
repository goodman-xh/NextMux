import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { get } from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { PNG } from 'pngjs';
import { CANVAS_ON_DEVICE_MODELS } from '../common/nextmux-canvas-on-device-models';
import type { CanvasOnDeviceModel, CanvasOnDeviceOperation } from '../common/nextmux-canvas-on-device-models';

export class CanvasOnDeviceError extends Error {
    constructor(readonly code: string, message: string) { super(message); this.name = 'CanvasOnDeviceError'; }
}
function abort(signal?: AbortSignal): void {
    if (signal?.aborted) throw new CanvasOnDeviceError('CANCELLED', 'On-device image processing was cancelled');
}
export interface CanvasOnDeviceProgress {
    readonly stage: 'download' | 'process' | 'verify';
    readonly fraction?: number;
    readonly downloadedBytes?: number;
    readonly totalBytes?: number;
}
interface Observers { readonly signal?: AbortSignal; readonly onProgress?: (progress: CanvasOnDeviceProgress) => void }
function emit(options: Observers, progress: CanvasOnDeviceProgress): void {
    try { options.onProgress?.(progress); } catch { /* progress observers do not own work */ }
}
interface DownloadResponse { readonly ok: boolean; readonly status: number; readonly body: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array> | null }
export interface CanvasOnDeviceDownloadOptions extends Observers {
    readonly modelDirectory: string;
    /** Tests provide an in-memory response; production uses HTTPS streams with no timeout. */
    readonly fetchImpl?: (url: string, options: { signal?: AbortSignal }) => Promise<DownloadResponse>;
}
function httpsStream(url: string, options: { signal?: AbortSignal }, redirects = 0): Promise<DownloadResponse> {
    abort(options.signal);
    return new Promise((accept, reject) => {
        const request = get(url, { signal: options.signal }, response => {
            const status = response.statusCode || 0;
            if (status >= 300 && status < 400 && response.headers.location) {
                response.resume();
                if (redirects >= 8) { reject(new CanvasOnDeviceError('MODEL_DOWNLOAD_FAILED', 'Too many model download redirects')); return; }
                const destination = new URL(response.headers.location, url);
                if (destination.protocol !== 'https:') { reject(new CanvasOnDeviceError('MODEL_DOWNLOAD_FAILED', 'Model redirects must use HTTPS')); return; }
                void httpsStream(destination.href, options, redirects + 1).then(accept, reject);
            } else accept({ ok: status === 200, status, body: response });
        });
        request.once('error', reject);
    });
}
async function* chunks(body: NonNullable<DownloadResponse['body']>, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
    if ('getReader' in body) {
        const reader = body.getReader();
        const cancel = (): void => { void reader.cancel().catch(() => undefined); };
        signal?.addEventListener('abort', cancel, { once: true });
        try { for (;;) { abort(signal); const next = await reader.read(); abort(signal); if (next.done) break; yield next.value; } }
        finally { signal?.removeEventListener('abort', cancel); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    } else yield* body;
}
async function hashFile(path: string, signal?: AbortSignal): Promise<string> {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) { abort(signal); hash.update(chunk); }
    return hash.digest('hex');
}
/** Verify every cached use. Unverified bytes stay in unique .part files until atomic promotion. */
export async function downloadCanvasOnDeviceModel(model: CanvasOnDeviceModel, options: CanvasOnDeviceDownloadOptions): Promise<string> {
    abort(options.signal);
    await mkdir(options.modelDirectory, { recursive: true });
    const path = join(options.modelDirectory, `${model.id}.onnx`);
    try {
        if ((await stat(path)).size === model.byteLength && await hashFile(path, options.signal) === model.sha256) {
            emit(options, { stage: 'download', downloadedBytes: model.byteLength, totalBytes: model.byteLength, fraction: .6 }); return path;
        }
    } catch (error) { abort(options.signal); if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const temporary = `${path}.${randomUUID()}.part`;
    let downloadedBytes = 0;
    try {
        emit(options, { stage: 'download', downloadedBytes: 0, totalBytes: model.byteLength, fraction: 0 });
        const response = await (options.fetchImpl || httpsStream)(model.url, { signal: options.signal });
        if (!response.ok || !response.body) throw new CanvasOnDeviceError('MODEL_DOWNLOAD_FAILED', `Model download returned HTTP ${response.status}`);
        const handle = await open(temporary, 'wx', 0o600), hash = createHash('sha256');
        try {
            for await (const chunk of chunks(response.body, options.signal)) {
                abort(options.signal); downloadedBytes += chunk.byteLength;
                if (downloadedBytes > model.byteLength) throw new CanvasOnDeviceError('MODEL_CHECKSUM_MISMATCH', 'Model download exceeds its pinned size');
                hash.update(chunk); await handle.writeFile(chunk);
                emit(options, { stage: 'download', downloadedBytes, totalBytes: model.byteLength, fraction: .6 * downloadedBytes / model.byteLength });
            }
            abort(options.signal);
            if (downloadedBytes !== model.byteLength || hash.digest('hex') !== model.sha256) throw new CanvasOnDeviceError('MODEL_CHECKSUM_MISMATCH', 'Model SHA-256 does not match its pinned revision');
            await handle.sync();
        } finally { await handle.close(); }
        abort(options.signal); await rename(temporary, path); return path;
    } catch (error) { abort(options.signal); throw error; }
    finally { await rm(temporary, { force: true }); }
}

export interface CanvasOnDeviceTensor { readonly data: Float32Array; readonly dims: readonly number[] }
export type CanvasOnDeviceInference = (model: CanvasOnDeviceModel, input: Float32Array, dims: readonly number[], signal?: AbortSignal) => Promise<CanvasOnDeviceTensor>;
/** Job-local range history: video smooths normalization, never blends moving pixels. */
export interface CanvasDepthNormalization { min?: number; max?: number }
export interface CanvasOnDeviceImageOptions extends Observers {
    readonly modelDirectory?: string;
    readonly ffmpegPath?: string;
    readonly invert?: boolean;
    readonly depthNormalization?: CanvasDepthNormalization;
    /** Injected sessions exercise real preprocessing and PNG output without network/native dependencies. */
    readonly infer?: CanvasOnDeviceInference;
}
async function nativeInference(modelPath: string, model: CanvasOnDeviceModel, input: Float32Array, dims: readonly number[], signal?: AbortSignal, onStarted?: () => void): Promise<CanvasOnDeviceTensor> {
    abort(signal);
    const directory = await mkdtemp(join(tmpdir(), 'nextmux-image-inference-'));
    try {
        const inputPath = join(directory, 'input.bin'), outputPath = join(directory, 'output.bin');
        await writeFile(inputPath, Buffer.from(input.buffer, input.byteOffset, input.byteLength), { mode: 0o600 });
        const worker = join(__dirname, 'nextmux-canvas-on-device-worker.js').replace(/\.asar([/\\])/, '.asar.unpacked$1');
        await new Promise<void>((accept, reject) => {
            abort(signal);
            const child = spawn(process.execPath, [worker, JSON.stringify({ modelPath, inputPath, outputPath, dims, inputName: model.inputName, outputName: model.outputName })],
                { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
            let error = '';
            const cancel = (): void => { child.kill('SIGKILL'); };
            signal?.addEventListener('abort', cancel, { once: true });
            child.stderr.on('data', chunk => { error = (error + String(chunk)).slice(-16_384); });
            child.once('error', exception => { signal?.removeEventListener('abort', cancel); reject(exception); });
            child.once('close', code => {
                signal?.removeEventListener('abort', cancel);
                if (signal?.aborted) reject(new CanvasOnDeviceError('CANCELLED', 'On-device inference was cancelled'));
                else if (code === 0) accept();
                else reject(new CanvasOnDeviceError('MODEL_INFERENCE_FAILED', `On-device inference exited ${code}: ${error.trim()}`));
            });
            if (signal?.aborted) cancel();
            onStarted?.();
        });
        abort(signal);
        const bytes = await readFile(outputPath), metadata = JSON.parse(await readFile(`${outputPath}.json`, 'utf8')) as { dims: number[] };
        return { data: new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), dims: metadata.dims };
    } finally { await rm(directory, { recursive: true, force: true }); }
}
function decodePng(bytes: Buffer): PNG {
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new CanvasOnDeviceError('INVALID_TOOL_INPUT', 'A valid PNG is required');
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (!width || !height || width * height > 64 * 1024 * 1024) throw new CanvasOnDeviceError('INVALID_TOOL_INPUT', 'Images must contain at most 64 megapixels');
    return PNG.sync.read(bytes);
}
function interpolate(data: ArrayLike<number>, width: number, height: number, x: number, y: number, channel = 0, stride = 1): number {
    x = Math.max(0, Math.min(width - 1, x)); y = Math.max(0, Math.min(height - 1, y));
    const left = Math.floor(x), top = Math.floor(y), right = Math.min(left + 1, width - 1), bottom = Math.min(top + 1, height - 1), dx = x - left, dy = y - top;
    const value = (px: number, py: number): number => data[(py * width + px) * stride + channel];
    return value(left, top) * (1 - dx) * (1 - dy) + value(right, top) * dx * (1 - dy) + value(left, bottom) * (1 - dx) * dy + value(right, bottom) * dx * dy;
}
/** Aspect-preserving inputs; matting is letterboxed, depth uses multiples of the ViT's 14-pixel patch. */
export async function processCanvasOnDevicePng(tool: CanvasOnDeviceOperation, bytes: Buffer, options: CanvasOnDeviceImageOptions): Promise<Buffer> {
    abort(options.signal);
    const image = decodePng(bytes), model = CANVAS_ON_DEVICE_MODELS[tool];
    if (!model) throw new CanvasOnDeviceError('INVALID_TOOL_INPUT', 'Unknown on-device operation');
    let infer = options.infer;
    if (!infer) {
        if (!options.modelDirectory) throw new CanvasOnDeviceError('MODEL_DIRECTORY_REQUIRED', 'App data model directory is required');
        const path = await downloadCanvasOnDeviceModel(model, { ...options, modelDirectory: options.modelDirectory });
        infer = (_model, input, dims, signal) => nativeInference(path, model, input, dims, signal, () => emit(options, { stage: 'process', fraction: .7 }));
    }
    const factor = model.inputSize / Math.max(image.width, image.height);
    const multiple = tool === 'image.depth' ? 14 : 1;
    const contentWidth = Math.max(multiple, Math.round(image.width * factor / multiple) * multiple);
    const contentHeight = Math.max(multiple, Math.round(image.height * factor / multiple) * multiple);
    const width = tool === 'image.matting' ? model.inputSize : contentWidth, height = tool === 'image.matting' ? model.inputSize : contentHeight;
    const offsetX = Math.floor((width - contentWidth) / 2), offsetY = Math.floor((height - contentHeight) / 2);
    const input = new Float32Array(3 * width * height), mean = [.485, .456, .406], std = [.229, .224, .225];
    // U²-Net's upstream ToTensorLab normalizes by the image's maximum RGB;
    // Depth Anything uses fixed 1/255 scaling. Alpha must not determine RGB scaling.
    let rgbScale = 255;
    if (tool === 'image.matting') {
        rgbScale = 1;
        for (let pixel = 0; pixel < image.width * image.height; pixel++) {
            if (pixel % 65_536 === 0) { await setImmediate(); abort(options.signal); }
            rgbScale = Math.max(rgbScale, image.data[pixel * 4], image.data[pixel * 4 + 1], image.data[pixel * 4 + 2]);
        }
    }
    for (let y = 0; y < contentHeight; y++) {
        if (y % 32 === 0) { await setImmediate(); abort(options.signal); }
        for (let x = 0; x < contentWidth; x++) for (let channel = 0; channel < 3; channel++) {
            const sx = (x + .5) * image.width / contentWidth - .5, sy = (y + .5) * image.height / contentHeight - .5;
            input[channel * width * height + (y + offsetY) * width + x + offsetX] = (interpolate(image.data, image.width, image.height, sx, sy, channel, 4) / rgbScale - mean[channel]) / std[channel];
        }
    }
    emit(options, { stage: 'process', fraction: .65 });
    const tensor = await infer(model, input, [1, 3, height, width], options.signal);
    abort(options.signal);
    const outputWidth = tensor.dims.at(-1) || 0, outputHeight = tensor.dims.at(-2) || 0;
    if (!Number.isSafeInteger(outputWidth) || !Number.isSafeInteger(outputHeight) || outputWidth < 1 || outputHeight < 1 || tensor.data.length !== outputWidth * outputHeight) throw new CanvasOnDeviceError('MODEL_OUTPUT_INVALID', 'The model returned an invalid mask/depth plane');
    let min = Infinity, max = -Infinity;
    for (const value of tensor.data) { if (!Number.isFinite(value)) throw new CanvasOnDeviceError('MODEL_OUTPUT_INVALID', 'The model returned non-finite pixels'); min = Math.min(min, value); max = Math.max(max, value); }
    if (tool === 'image.depth' && options.depthNormalization) {
        const history = options.depthNormalization;
        min = history.min === undefined ? min : .8 * history.min + .2 * min;
        max = history.max === undefined ? max : .8 * history.max + .2 * max;
        history.min = min; history.max = max;
    }
    const span = max - min;
    const output = new PNG({ width: image.width, height: image.height });
    if (tool === 'image.matting') output.gamma = image.gamma;
    for (let y = 0; y < image.height; y++) {
        if (y % 32 === 0) { await setImmediate(); abort(options.signal); }
        for (let x = 0; x < image.width; x++) {
            const px = ((x + .5) * contentWidth / image.width + offsetX) * outputWidth / width - .5;
            const py = ((y + .5) * contentHeight / image.height + offsetY) * outputHeight / height - .5;
            const value = interpolate(tensor.data, outputWidth, outputHeight, px, py);
            const normalized = Math.max(0, Math.min(1, span > 1e-8 ? (value - min) / span : tool === 'image.matting' ? value : 0));
            const pixel = (y * image.width + x) * 4;
            if (tool === 'image.matting') {
                output.data[pixel] = image.data[pixel]; output.data[pixel + 1] = image.data[pixel + 1]; output.data[pixel + 2] = image.data[pixel + 2];
                output.data[pixel + 3] = Math.round(normalized * image.data[pixel + 3]);
            } else {
                const gray = Math.round(255 * (options.invert ? 1 - normalized : normalized));
                output.data[pixel] = output.data[pixel + 1] = output.data[pixel + 2] = gray; output.data[pixel + 3] = 255;
            }
        }
    }
    emit(options, { stage: 'verify', fraction: .95 }); abort(options.signal);
    return PNG.sync.write(output, { colorType: tool === 'image.matting' ? 6 : 0 });
}
async function sourcePng(path: string, options: CanvasOnDeviceImageOptions): Promise<Buffer> {
    abort(options.signal);
    const bytes = await readFile(path);
    if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return bytes;
    if (!options.ffmpegPath) throw new CanvasOnDeviceError('FFMPEG_UNAVAILABLE', 'Install FFmpeg to decode this image format; PNG works directly');
    return new Promise((accept, reject) => {
        const child = spawn(options.ffmpegPath!, ['-v', 'error', '-nostdin', '-i', path, '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', '-'], { signal: options.signal, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        const parts: Buffer[] = []; let error = '', length = 0, oversized = false;
        child.stdout.on('data', (chunk: Buffer) => { length += chunk.length; if (length > 300 * 1024 * 1024) { oversized = true; child.kill('SIGKILL'); } else parts.push(chunk); });
        child.stderr.on('data', chunk => { error = (error + String(chunk)).slice(-4096); });
        child.once('error', reject);
        child.once('close', code => {
            if (options.signal?.aborted) reject(new CanvasOnDeviceError('CANCELLED', 'Image decoding was cancelled'));
            else if (code === 0 && !oversized) accept(Buffer.concat(parts));
            else reject(new CanvasOnDeviceError('INVALID_TOOL_INPUT', `Image decode failed: ${error}`));
        });
    });
}
export async function runCanvasOnDeviceImage(tool: CanvasOnDeviceOperation, sourcePath: string, outputPath: string, options: CanvasOnDeviceImageOptions): Promise<{ width: number; height: number; modelId: string; modelSha256: string }> {
    const source = await sourcePng(sourcePath, options), png = await processCanvasOnDevicePng(tool, source, options), decoded = decodePng(png);
    await mkdir(dirname(outputPath), { recursive: true });
    const temporary = `${outputPath}.${randomUUID()}.part`;
    try { abort(options.signal); await writeFile(temporary, png, { flag: 'wx', mode: 0o600 }); abort(options.signal); await rename(temporary, outputPath); }
    finally { await rm(temporary, { force: true }); }
    const model = CANVAS_ON_DEVICE_MODELS[tool];
    return { width: decoded.width, height: decoded.height, modelId: model.id, modelSha256: model.sha256 };
}
