import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath, stat, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { normalizeScene } from '@nextmux/comic-core';
import type { CanvasAssetVersion, CanvasDocument, CanvasNode } from '@nextmux/comic-core';
import type { ComicDirectorCameraSnapshot, ComicDirectorCaptureResult, ComicDirectorModelImportResult, ImportComicDirectorModelRequest, SaveComicCanvasMarkedImageRequest, SaveComicDirectorCaptureRequest } from '../common/nextmux-director-contracts';
import type { DesktopComicCanvasState } from '../common/nextmux-platform-protocol';
import { probeCanvasMedia } from './nextmux-canvas-tools';
import { DirectorUploadStore } from './nextmux-director-uploads';
import { decodeDirectorBase64, DirectorMediaError, directorSha256, DIRECTOR_IMAGE_MAX_BYTES, DIRECTOR_MEDIA_MAX_BYTES,
    assertDirectorDimensions, validateDirectorGltf, validateDirectorPly, validateDirectorPng, validateDirectorSpz, validateDirectorWebm } from './nextmux-director-media';

export interface DirectorCanvasStore {
    read(): Promise<DesktopComicCanvasState>;
    mutate(operation: (canvas: CanvasDocument) => CanvasDocument | Promise<CanvasDocument>, expectedRevision?: number): Promise<DesktopComicCanvasState>;
}
export interface DirectorMediaRuntime { readonly ffmpegPath: string; readonly ffprobePath?: string }
export interface DirectorServiceOptions {
    readonly runtime: () => Promise<DirectorMediaRuntime>;
    readonly transcode?: typeof transcodeDirectorRecording;
    readonly uploads?: DirectorUploadStore;
}
function fail(code: string, message: string): never { throw new DirectorMediaError(code, message); }
function canonicalJson(value: unknown): string {
    const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort)
        : item && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().filter(key => (item as Record<string, unknown>)[key] !== undefined)
            .map(key => [key, sort((item as Record<string, unknown>)[key])])) : item;
    return JSON.stringify(sort(value));
}
function cameraSnapshot(camera: ComicDirectorCameraSnapshot): ComicDirectorCameraSnapshot {
    if (!camera || !Number.isFinite(camera.fov) || camera.fov < 10 || camera.fov > 120) fail('DIRECTOR_CAPTURE_INVALID', 'The capture camera is invalid.');
    const vector = (value: ComicDirectorCameraSnapshot['position']): ComicDirectorCameraSnapshot['position'] => {
        if (!value || !['x', 'y', 'z'].every(key => Number.isFinite(value[key as keyof typeof value]) && Math.abs(value[key as keyof typeof value]) <= 1e7)) fail('DIRECTOR_CAPTURE_INVALID', 'The capture camera transform is invalid.');
        return { x: value.x, y: value.y, z: value.z };
    };
    if (camera.id !== undefined && (typeof camera.id !== 'string' || camera.id.length > 256 || /[\u0000-\u001f]/.test(camera.id))) fail('DIRECTOR_CAPTURE_INVALID', 'The capture camera identifier is invalid.');
    return { ...(camera.id ? { id: camera.id } : {}), position: vector(camera.position), rotation: vector(camera.rotation),
        ...(camera.lookAt ? { lookAt: vector(camera.lookAt) } : {}), fov: camera.fov };
}
function inside(root: string, path: string): void {
    const local = relative(root, path);
    if (local === '..' || local.startsWith('../') || local.startsWith('..\\') || isAbsolute(local)) fail('DIRECTOR_PROJECT_PATH', 'The project media folder points outside the project.');
}
/** Validate each parent before creating its child; symlink escapes cannot write an external media directory. */
async function mediaDirectory(workspaceRoot: string, component: string): Promise<{ root: string; directory: string }> {
    const root = await realpath(workspaceRoot);
    let directory = root;
    for (const part of ['nextmux.media', component]) {
        const next = join(directory, part);
        try { await mkdir(next); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        directory = await realpath(next); inside(root, directory);
        if (!(await stat(directory)).isDirectory()) fail('DIRECTOR_PROJECT_PATH', 'The project media location is not a directory.');
    }
    return { root, directory };
}
function runFfmpeg(binary: string, args: readonly string[]): Promise<void> {
    return new Promise((accept, reject) => {
        const child = spawn(binary, [...args], { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-32768); });
        child.once('error', reject);
        child.once('close', code => code === 0 ? accept() : reject(new DirectorMediaError('DIRECTOR_TRANSCODE_FAILED', `The recording could not be converted to MP4: ${stderr.trim()}`)));
    });
}
/** Real H.264/yuv420p output and decoded measurements, using the existing configured/bundled FFmpeg runtime. */
export async function transcodeDirectorRecording(input: string, output: string, runtime: DirectorMediaRuntime, expectedDurationMs?: number, frameRate?: number): Promise<NonNullable<CanvasAssetVersion['metadata']>> {
    const source = await probeCanvasMedia(input, runtime);
    if (source.mediaKind !== 'video' || !source.width || !source.height || !source.frameCount
        || source.durationMs !== undefined && (source.durationMs <= 0 || source.durationMs > 1_800_000)
        || source.frameRate !== undefined && (source.frameRate <= 0 || source.frameRate > 120)) fail('DIRECTOR_MEDIA_INVALID', 'The recording has no usable video stream or exceeds its limits.');
    assertDirectorDimensions(source.width, source.height);
    // Keep long animations usable within the upload/storage limit. VBV bounds video bitrate while CRF preserves quality when the scene is simple.
    const seconds = Math.max(1, (source.durationMs || 0) / 1000, (expectedDurationMs || 0) / 1000,
        source.frameRate ? source.frameCount / source.frameRate : 0);
    const maxRate = Math.max(128_000, Math.min(16_000_000, Math.floor(192 * 1024 * 1024 * 8 / seconds)));
    await runFfmpeg(runtime.ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-protocol_whitelist', 'file,pipe', '-i', input,
        '-map', '0:v:0', '-an', '-sn', '-dn', '-vf', `${frameRate ? `fps=${frameRate},` : ''}pad=ceil(iw/2)*2:ceil(ih/2)*2`, '-c:v', 'libx264', '-preset', 'medium',
        '-crf', '18', '-maxrate', String(maxRate), '-bufsize', String(maxRate * 2), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-map_metadata', '-1', output]);
    const measured = await probeCanvasMedia(output, runtime);
    if (measured.mediaKind !== 'video' || !measured.width || !measured.height || !measured.durationMs || !measured.frameCount
        || measured.durationMs > 1_800_000 || !measured.byteLength || measured.byteLength > DIRECTOR_MEDIA_MAX_BYTES) fail('DIRECTOR_TRANSCODE_FAILED', 'The converted recording is empty, invalid, or too large.');
    assertDirectorDimensions(measured.width, measured.height);
    return { width: measured.width, height: measured.height, durationMs: measured.durationMs, frameRate: measured.frameRate,
        hasAudio: measured.hasAudio, streamStartMs: measured.streamStartMs, byteLength: measured.byteLength, mimeType: 'video/mp4' };
}

export class ComicDirectorService {
    private readonly captures = new Map<string, { fingerprint: string; promise: Promise<ComicDirectorCaptureResult> }>();
    readonly uploads: DirectorUploadStore;
    constructor(readonly workspaceRoot: string, readonly store: DirectorCanvasStore, readonly options: DirectorServiceOptions) { this.uploads = options.uploads || new DirectorUploadStore(workspaceRoot); }

    async importModel(request: Omit<ImportComicDirectorModelRequest, 'workspaceRoot'>): Promise<ComicDirectorModelImportResult> {
        if (!request || typeof request.name !== 'string' || request.name.length > 256 || /[\u0000-\u001f]/.test(request.name)
            || typeof request.mimeType !== 'string') fail('DIRECTOR_MEDIA_INVALID', 'Choose a supported local model or splat file.');
        const extension = /\.(glb|gltf|spz|ply)$/i.exec(request.name)?.[1].toLowerCase();
        const allowed: Record<string, readonly string[]> = { glb: ['model/gltf-binary', 'application/octet-stream', ''],
            gltf: ['model/gltf+json', 'application/json', 'application/octet-stream', 'text/plain', ''], spz: ['application/octet-stream', 'application/gzip', 'application/x-spz', ''],
            ply: ['application/octet-stream', 'application/ply', 'model/ply', 'text/plain', ''] };
        const mime = request.mimeType.toLowerCase().trim();
        if (!extension || !allowed[extension].includes(mime)) fail('DIRECTOR_MEDIA_INVALID', 'The model filename and MIME type do not match a supported format.');
        if ((typeof request.dataBase64 === 'string') === (typeof request.uploadId === 'string')) fail('DIRECTOR_UPLOAD_INVALID', 'Supply exactly one uploaded file or base64 body.');
        const staged = request.uploadId ? await this.uploads.load(request.uploadId, 'model', request.mimeType, request.name,
            directorSha256(canonicalJson({ purpose: 'model', name: request.name, mimeType: request.mimeType }))) : undefined;
        if (staged?.receipt) {
            if (staged.receipt.purpose !== 'model') fail('DIRECTOR_UPLOAD_CONFLICT', 'The upload belongs to another operation.');
            return staged.receipt.result;
        }
        const data = staged?.data || decodeDirectorBase64(request.dataBase64, DIRECTOR_MEDIA_MAX_BYTES);
        if (extension === 'glb' || extension === 'gltf') validateDirectorGltf(data, extension === 'glb');
        else if (extension === 'spz') validateDirectorSpz(data);
        else validateDirectorPly(data);
        const hash = directorSha256(data), { directory } = await mediaDirectory(this.workspaceRoot, 'director-models'), name = `${hash}.${extension}`, path = join(directory, name);
        try { await writeFile(path, data, { flag: 'wx', mode: 0o600 }); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            // Never follow a planted file symlink when reusing a content-addressed import.
            const info = await lstat(path);
            if (!info.isFile() || info.isSymbolicLink() || info.size !== data.length) fail('DIRECTOR_PROJECT_PATH', 'The existing project model file is invalid.');
            const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
            try { if (directorSha256(await handle.readFile()) !== hash) fail('DIRECTOR_PROJECT_PATH', 'The existing project model file has changed.'); }
            finally { await handle.close(); }
        }
        const result: ComicDirectorModelImportResult = { uri: `nextmux.media/director-models/${name}`, kind: extension === 'glb' || extension === 'gltf' ? 'model' : 'splat',
            mimeType: extension === 'glb' ? 'model/gltf-binary' : extension === 'gltf' ? 'model/gltf+json' : 'application/octet-stream', byteLength: data.length, sha256: hash };
        if (request.uploadId) await this.uploads.complete(request.uploadId, hash, { purpose: 'model', result });
        return result;
    }

    saveCapture(raw: Omit<SaveComicDirectorCaptureRequest, 'workspaceRoot'>): Promise<ComicDirectorCaptureResult> {
        let request: typeof raw, transportFingerprint: string;
        try {
            if (!raw || typeof raw.captureId !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(raw.captureId) || typeof raw.sourceNodeId !== 'string' || !raw.sourceNodeId
                || !Number.isSafeInteger(raw.expectedRevision) || raw.expectedRevision < 0 || !['image', 'video'].includes(raw.kind)
                || typeof raw.mimeType !== 'string') fail('DIRECTOR_CAPTURE_INVALID', 'The capture request is invalid.');
            const scene = normalizeScene(raw.scene), camera = cameraSnapshot(raw.camera);
            if (!Number.isSafeInteger(raw.frame) || raw.frame < 0 || raw.frame > scene.duration
                || raw.endFrame !== undefined && (!Number.isSafeInteger(raw.endFrame) || raw.endFrame < raw.frame || raw.endFrame > scene.duration)) fail('DIRECTOR_CAPTURE_INVALID', 'The captured frame range is invalid.');
            if (raw.position && (!Number.isFinite(raw.position.x) || !Number.isFinite(raw.position.y))) fail('DIRECTOR_CAPTURE_INVALID', 'The capture position is invalid.');
            const title = typeof raw.title === 'string' ? raw.title.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 160) : '';
            request = { ...raw, scene, camera, title, ...(raw.position ? { position: { ...raw.position } } : {}) };
            if ((typeof raw.dataBase64 === 'string') === (typeof raw.uploadId === 'string')) fail('DIRECTOR_UPLOAD_INVALID', 'Supply exactly one uploaded file or base64 body.');
            if (raw.kind === 'image' && raw.mimeType !== 'image/png') fail('DIRECTOR_MEDIA_INVALID', 'A screenshot must use the image/png MIME type.');
            // Revision is excluded: recovering the same click remains valid after canvas revisions advance.
            const { expectedRevision: _revision, dataBase64: bytes, ...identity } = request;
            transportFingerprint = directorSha256(canonicalJson({ ...identity, ...(bytes ? { base64Sha256: directorSha256(bytes) } : {}) }));
        } catch (error) { return Promise.reject(error); }
        const existing = this.captures.get(request.captureId);
        if (existing) {
            if (existing.fingerprint !== transportFingerprint) return Promise.reject(new DirectorMediaError('DIRECTOR_CAPTURE_ID_CONFLICT', 'This capture identifier belongs to a different capture.'));
            return existing.promise;
        }
        const promise = (async () => {
            const staged = request.uploadId ? await this.uploads.load(request.uploadId, 'capture', request.mimeType, undefined, transportFingerprint) : undefined;
            const data = staged?.data || (staged?.receipt ? undefined : decodeDirectorBase64(request.dataBase64, request.kind === 'image' ? DIRECTOR_IMAGE_MAX_BYTES : DIRECTOR_MEDIA_MAX_BYTES));
            const hash = staged?.sha256 || directorSha256(data!);
            const { expectedRevision: _revision, dataBase64: _bytes, uploadId: _upload, ...identity } = request;
            const fingerprint = directorSha256(canonicalJson({ ...identity, dataSha256: hash }));
            if (staged?.receipt) {
                if (staged.receipt.purpose !== 'capture' || staged.receipt.captureId !== request.captureId || staged.receipt.requestSha256 !== fingerprint) fail('DIRECTOR_UPLOAD_CONFLICT', 'The upload belongs to another operation.');
                const recovered = this.recovered(await this.store.read(), request.captureId, fingerprint);
                if (!recovered) fail('DIRECTOR_UPLOAD_CONSUMED', 'The captured asset was removed.');
                return recovered;
            }
            if (!data || data.length > (request.kind === 'image' ? DIRECTOR_IMAGE_MAX_BYTES : DIRECTOR_MEDIA_MAX_BYTES)) fail('DIRECTOR_MEDIA_INVALID', 'The capture is too large.');
            if (request.kind === 'image') validateDirectorPng(data); else validateDirectorWebm(data, request.mimeType);
            const result = await this.executeCapture(request, data, fingerprint);
            if (request.uploadId) await this.uploads.complete(request.uploadId, hash, { purpose: 'capture', captureId: request.captureId, requestSha256: fingerprint });
            return result;
        })();
        this.captures.set(request.captureId, { fingerprint: transportFingerprint, promise });
        // Completed captures recover against the current canvas rather than retaining a stale state snapshot in memory.
        const forget = (): void => { if (this.captures.get(request.captureId)?.promise === promise) this.captures.delete(request.captureId); };
        void promise.then(forget, forget);
        return promise;
    }
    /** 标记修图: store the user's marked picture (source pixels plus visible marks, rendered locally) as a new image node beside its source. */
    saveMarkedImage(raw: Omit<SaveComicCanvasMarkedImageRequest, 'workspaceRoot'>): Promise<ComicDirectorCaptureResult> {
        let request: typeof raw, transportFingerprint: string;
        try {
            if (!raw || typeof raw.markId !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(raw.markId) || typeof raw.sourceNodeId !== 'string' || !raw.sourceNodeId
                || typeof raw.sourceVersionId !== 'string' || !raw.sourceVersionId || !Number.isSafeInteger(raw.expectedRevision) || raw.expectedRevision < 0) fail('CANVAS_MARKS_INVALID', 'The marked picture request is invalid.');
            if (raw.position && (!Number.isFinite(raw.position.x) || !Number.isFinite(raw.position.y))) fail('CANVAS_MARKS_INVALID', 'The marked picture position is invalid.');
            if ((typeof raw.dataBase64 === 'string') === (typeof raw.uploadId === 'string')) fail('DIRECTOR_UPLOAD_INVALID', 'Supply exactly one uploaded file or base64 body.');
            const title = typeof raw.title === 'string' ? raw.title.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 160) : '';
            request = { ...raw, title, ...(raw.position ? { position: { x: raw.position.x, y: raw.position.y } } : {}) };
            const { expectedRevision: _revision, dataBase64: bytes, ...identity } = request;
            transportFingerprint = directorSha256(canonicalJson({ purpose: 'marks', ...identity, ...(bytes ? { base64Sha256: directorSha256(bytes) } : {}) }));
        } catch (error) { return Promise.reject(error); }
        const key = `marks:${request.markId}`, existing = this.captures.get(key);
        if (existing) {
            if (existing.fingerprint !== transportFingerprint) return Promise.reject(new DirectorMediaError('CANVAS_MARKS_ID_CONFLICT', 'This mark identifier belongs to a different picture.'));
            return existing.promise;
        }
        const promise = (async () => {
            const staged = request.uploadId ? await this.uploads.load(request.uploadId, 'capture', 'image/png', undefined, transportFingerprint) : undefined;
            const data = staged?.data || (staged?.receipt ? undefined : decodeDirectorBase64(request.dataBase64, DIRECTOR_IMAGE_MAX_BYTES));
            const hash = staged?.sha256 || directorSha256(data!);
            const { expectedRevision: _revision, dataBase64: _bytes, uploadId: _upload, ...identity } = request;
            const fingerprint = directorSha256(canonicalJson({ purpose: 'marks', ...identity, dataSha256: hash }));
            if (staged?.receipt) {
                if (staged.receipt.purpose !== 'capture' || staged.receipt.captureId !== key || staged.receipt.requestSha256 !== fingerprint) fail('DIRECTOR_UPLOAD_CONFLICT', 'The upload belongs to another operation.');
                const recovered = this.recoveredMarks(await this.store.read(), request.markId, fingerprint);
                if (!recovered) fail('DIRECTOR_UPLOAD_CONSUMED', 'The marked picture was removed.');
                return recovered;
            }
            if (!data || data.length > DIRECTOR_IMAGE_MAX_BYTES) fail('DIRECTOR_MEDIA_INVALID', 'The marked picture is too large.');
            const result = await this.executeMarks(request, data, validateDirectorPng(data), fingerprint);
            if (request.uploadId) await this.uploads.complete(request.uploadId, hash, { purpose: 'capture', captureId: key, requestSha256: fingerprint });
            return result;
        })();
        this.captures.set(key, { fingerprint: transportFingerprint, promise });
        const forget = (): void => { if (this.captures.get(key)?.promise === promise) this.captures.delete(key); };
        void promise.then(forget, forget);
        return promise;
    }
    private recoveredMarks(state: DesktopComicCanvasState, markId: string, fingerprint: string): ComicDirectorCaptureResult | undefined {
        for (const node of state.canvas?.nodes || []) if (node.kind === 'image') {
            const version = node.payload.versions.find(item => item.provenance?.annotation?.markId === markId);
            if (version) {
                if (version.provenance?.annotation?.requestSha256 !== fingerprint) fail('CANVAS_MARKS_ID_CONFLICT', 'This mark identifier belongs to a different picture.');
                return { state, nodeId: node.id, version };
            }
        }
        return undefined;
    }
    private async executeMarks(request: Omit<SaveComicCanvasMarkedImageRequest, 'workspaceRoot'>, data: Buffer, size: { width: number; height: number }, fingerprint: string): Promise<ComicDirectorCaptureResult> {
        const initial = await this.store.read(), recovered = this.recoveredMarks(initial, request.markId, fingerprint);
        if (recovered) return recovered;
        const canvas = initial.canvas, source = canvas?.nodes.find(node => node.id === request.sourceNodeId);
        if (!canvas || canvas.revision !== request.expectedRevision) fail('CANVAS_REVISION_CONFLICT', 'Reload the canvas before saving this marked picture.');
        const sourceVersion = source && 'versions' in source.payload ? source.payload.versions.find(item => item.id === request.sourceVersionId) : undefined;
        if (!source || !sourceVersion || sourceVersion.kind !== 'image' || sourceVersion.status === 'missing' || sourceVersion.status === 'uploading') fail('CANVAS_MARKS_SOURCE_REQUIRED', 'The marked picture source is unavailable.');
        const { directory } = await mediaDirectory(this.workspaceRoot, 'canvas-marks'), name = `${fingerprint.slice(0, 16)}-${randomUUID()}.png`, output = join(directory, name);
        let attached = false;
        try {
            await writeFile(output, data, { flag: 'wx', mode: 0o600 });
            const nodeId = `marks-${randomUUID()}`;
            const version: CanvasAssetVersion = { id: `version-${randomUUID()}`, assetId: `asset-${randomUUID()}`, kind: 'image',
                uri: `nextmux.media/canvas-marks/${name}`, createdAt: new Date().toISOString(), status: 'ready',
                metadata: { ...size, mimeType: 'image/png', byteLength: data.length, sha256: directorSha256(data) },
                provenance: { operation: 'canvas.annotate', sourceNodeId: source.id, sourceVersionId: sourceVersion.id,
                    annotation: { markId: request.markId, dataSha256: directorSha256(data), requestSha256: fingerprint } } };
            let concurrent: ComicDirectorCaptureResult | undefined;
            const state = await this.store.mutate(current => {
                concurrent = this.recoveredMarks({ ...initial, canvas: current }, request.markId, fingerprint);
                if (concurrent) return current;
                if (current.id !== canvas.id) fail('CANVAS_IDENTITY_CHANGED', 'The original canvas was replaced.');
                const sourceNode = current.nodes.find(node => node.id === source.id);
                if (!sourceNode) fail('CANVAS_MARKS_SOURCE_REQUIRED', 'The marked picture source was removed.');
                const box = { width: 320, height: 240 };
                const position = request.position || { x: sourceNode.position.x + sourceNode.size.width + 60, y: sourceNode.position.y };
                const node: CanvasNode = { id: nodeId, kind: 'image', title: request.title || sourceNode.title, position, size: box,
                    payload: { versions: [version], currentVersionId: version.id } };
                return { ...current, nodes: [...current.nodes, node] };
            });
            if (concurrent) return { ...concurrent, state };
            attached = true;
            return { state, nodeId, version };
        } finally {
            if (!attached) await unlink(output).catch(() => undefined);
        }
    }
    private recovered(state: DesktopComicCanvasState, captureId: string, fingerprint: string): ComicDirectorCaptureResult | undefined {
        for (const node of state.canvas?.nodes || []) if (['image', 'video'].includes(node.kind) && 'versions' in node.payload) {
            const version = node.payload.versions.find(item => item.provenance?.directorCapture?.captureId === captureId);
            if (version) {
                if (version.provenance?.directorCapture?.requestSha256 !== fingerprint) fail('DIRECTOR_CAPTURE_ID_CONFLICT', 'This capture identifier belongs to a different capture.');
                return { state, nodeId: node.id, version };
            }
        }
        return undefined;
    }
    private async executeCapture(request: Omit<SaveComicDirectorCaptureRequest, 'workspaceRoot'>, data: Buffer, fingerprint: string): Promise<ComicDirectorCaptureResult> {
        const initial = await this.store.read(), recovered = this.recovered(initial, request.captureId, fingerprint);
        if (recovered) return recovered;
        const canvas = initial.canvas, source = canvas?.nodes.find(node => node.id === request.sourceNodeId);
        if (!canvas || canvas.revision !== request.expectedRevision) fail('CANVAS_REVISION_CONFLICT', 'Reload the canvas before saving this capture.');
        if (!source || !['sceneComposer', 'world'].includes(source.kind)) fail('DIRECTOR_SOURCE_REQUIRED', 'The captured director or world node is unavailable.');
        const { directory } = await mediaDirectory(this.workspaceRoot, 'director-captures'), name = `${fingerprint.slice(0, 16)}-${randomUUID()}.${request.kind === 'image' ? 'png' : 'mp4'}`;
        const output = join(directory, name), input = join(directory, `.${randomUUID()}.webm`);
        let attached = false;
        try {
            let metadata: NonNullable<CanvasAssetVersion['metadata']>;
            if (request.kind === 'image') {
                const size = validateDirectorPng(data); await writeFile(output, data, { flag: 'wx', mode: 0o600 });
                metadata = { ...size, mimeType: 'image/png', byteLength: data.length };
            } else {
                await writeFile(input, data, { flag: 'wx', mode: 0o600 });
                const expectedDurationMs = Math.max(1, (request.endFrame === undefined ? request.scene.duration : request.endFrame - request.frame) / request.scene.fps * 1000);
                // The browser records at the display rate; the clip keeps the scene's own frame rate so it fits the edit.
                metadata = await (this.options.transcode || transcodeDirectorRecording)(input, output, await this.options.runtime(), expectedDurationMs, request.scene.fps);
            }
            const outputInfo = await lstat(output);
            if (!outputInfo.isFile() || outputInfo.isSymbolicLink() || !outputInfo.size || outputInfo.size > DIRECTOR_MEDIA_MAX_BYTES) fail('DIRECTOR_MEDIA_INVALID', 'The capture file is invalid or too large.');
            const outputData = await readFile(output), nodeId = `director-output-${randomUUID()}`;
            const version: CanvasAssetVersion = { id: `version-${randomUUID()}`, assetId: `asset-${randomUUID()}`, kind: request.kind,
                uri: `nextmux.media/director-captures/${name}`, createdAt: new Date().toISOString(), status: 'ready',
                metadata: { ...metadata, byteLength: outputInfo.size, sha256: directorSha256(outputData) },
                provenance: { operation: request.kind === 'image' ? 'director.screenshot' : 'director.recording', sourceNodeId: source.id,
                    actualTimeMs: request.frame / request.scene.fps * 1000, directorCapture: { captureId: request.captureId, scene: request.scene,
                        ...(source.kind === 'world' ? { world: source.payload.world } : {}),
                        camera: request.camera, frame: request.frame, ...(request.endFrame !== undefined ? { endFrame: request.endFrame } : {}),
                        sceneSha256: directorSha256(canonicalJson(request.scene)), dataSha256: directorSha256(data), requestSha256: fingerprint } } };
            let concurrent: ComicDirectorCaptureResult | undefined;
            const state = await this.store.mutate(current => {
                concurrent = this.recovered({ ...initial, canvas: current }, request.captureId, fingerprint);
                if (concurrent) return current;
                if (current.id !== canvas.id) fail('CANVAS_IDENTITY_CHANGED', 'The original canvas was replaced.');
                const sourceNode = current.nodes.find(node => node.id === source.id);
                if (!sourceNode || sourceNode.kind !== source.kind) fail('DIRECTOR_SOURCE_REQUIRED', 'The captured director or world node was removed.');
                const size = { width: 320, height: 240 };
                const position = request.position || { x: sourceNode.position.x + sourceNode.size.width + 60, y: sourceNode.position.y };
                const node: CanvasNode = { id: nodeId, kind: request.kind, title: request.title || sourceNode.title, position, size,
                    payload: { versions: [version], currentVersionId: version.id } };
                const role = request.kind === 'image' ? 'referenceImage' : 'referenceVideo';
                const nodes = current.nodes.map(item => item.id === sourceNode.id && 'versions' in item.payload
                    ? { ...item, payload: { ...item.payload, versions: [...item.payload.versions, version], currentVersionId: version.id } } as CanvasNode : item);
                return { ...current, nodes: [...nodes, node], edges: [...current.edges, { id: `director-edge-${randomUUID()}`,
                    sourceNodeId: sourceNode.id, sourcePort: 'output', targetNodeId: nodeId, targetPort: role, role, order: 0,
                    binding: 'pinnedVersion', pinnedVersionId: version.id }] };
            });
            if (concurrent) return { ...concurrent, state };
            attached = true;
            return { state, nodeId, version };
        } finally {
            await unlink(input).catch(() => undefined);
            if (!attached) await unlink(output).catch(() => undefined);
        }
    }
}
