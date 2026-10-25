import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import * as ort from 'onnxruntime-node';
import { processCanvasOnDevicePng } from './nextmux-canvas-on-device';
import { CANVAS_ON_DEVICE_MODELS } from '../common/nextmux-canvas-on-device-models';

/** One session per job: cancellation kills native work, including a video sequence. */
async function main(): Promise<void> {
    const job = JSON.parse(process.argv[2]) as { modelPath: string; inputPath: string; outputPath: string; dims: number[]; inputName: string; outputName?: string;
        mode?: 'video'; directory?: string; frameCount?: number; invert?: boolean; smooth?: boolean };
    const session = await ort.InferenceSession.create(job.modelPath, { executionProviders: ['cpu'], intraOpNumThreads: 2, interOpNumThreads: 1 });
    try {
        if (job.mode === 'video') {
            if (!job.directory || !Number.isSafeInteger(job.frameCount) || job.frameCount! < 1) throw new Error('Invalid depth sequence');
            const model = CANVAS_ON_DEVICE_MODELS['image.depth'], depthNormalization = job.smooth === false ? undefined : {};
            process.stdout.write(`${JSON.stringify({ ready: true })}\n`);
            for (let index = 0; index < job.frameCount!; index++) {
                const suffix = String(index).padStart(8, '0'), inputPath = join(job.directory, `source-${suffix}.png`);
                const png = await processCanvasOnDevicePng('image.depth', await readFile(inputPath), { invert: job.invert, depthNormalization,
                    infer: async (_model, data, dims) => {
                        const results = await session.run({ [model.inputName]: new ort.Tensor('float32', data, [...dims]) });
                        const tensor = results[model.outputName || session.outputNames[0]];
                        if (!tensor || !(tensor.data instanceof Float32Array)) throw new Error('Expected a float32 depth tensor');
                        return { data: tensor.data, dims: tensor.dims };
                    } });
                await writeFile(join(job.directory, `depth-${suffix}.png`), png, { mode: 0o600, flag: 'wx' });
                await unlink(inputPath);
                process.stdout.write(`${JSON.stringify({ processedFrames: index + 1 })}\n`);
            }
            return;
        }
        const bytes = await readFile(job.inputPath);
        const data = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
        const results = await session.run({ [job.inputName]: new ort.Tensor('float32', data, job.dims) });
        const tensor = results[job.outputName || session.outputNames[0]];
        if (!tensor || !(tensor.data instanceof Float32Array)) throw new Error('Expected a float32 mask/depth tensor');
        await writeFile(job.outputPath, Buffer.from(tensor.data.buffer, tensor.data.byteOffset, tensor.data.byteLength), { mode: 0o600 });
        await writeFile(`${job.outputPath}.json`, JSON.stringify({ dims: tensor.dims }), { mode: 0o600 });
    } finally { await session.release(); }
}
void main().catch(error => { process.stderr.write(String(error?.stack || error)); process.exitCode = 1; });
