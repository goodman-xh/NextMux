import type { AppendComicDirectorUploadRequest, BeginComicDirectorUploadRequest, ComicDirectorUploadState } from '../common/nextmux-director-contracts';

/** Each chunk stays comfortably below Theia's 100 MB WebSocket message limit. */
export const DIRECTOR_UPLOAD_CHUNK_BYTES = 768 * 1024;
export interface DirectorUploadTransport {
    beginComicDirectorUpload(request: BeginComicDirectorUploadRequest): Promise<ComicDirectorUploadState>;
    appendComicDirectorUpload(request: AppendComicDirectorUploadRequest): Promise<ComicDirectorUploadState>;
    discardComicDirectorUpload(request: { readonly workspaceRoot: string; readonly uploadId: string }): Promise<void>;
}

/** Upload one bounded chunk at a time, then consume the staged file in its final RPC. */
export async function withDirectorBlobUpload<T>(blob: Blob, request: Omit<BeginComicDirectorUploadRequest, 'byteLength' | 'uploadId'>,
    transport: DirectorUploadTransport, consume: (uploadId: string) => Promise<T>): Promise<T> {
    if (!blob.size || blob.size > 256 * 1024 * 1024) throw Object.assign(new Error('DIRECTOR_MEDIA_INVALID'), { code: 'DIRECTOR_MEDIA_INVALID' });
    const uploadId = crypto.randomUUID();
    try {
        const upload = await transport.beginComicDirectorUpload({ ...request, uploadId, byteLength: blob.size });
        if (upload.uploadId !== uploadId || upload.offset !== 0 || upload.byteLength !== blob.size) throw Object.assign(new Error('DIRECTOR_UPLOAD_INVALID'), { code: 'DIRECTOR_UPLOAD_INVALID' });
        let offset = 0;
        while (offset < blob.size) {
            const end = Math.min(offset + DIRECTOR_UPLOAD_CHUNK_BYTES, blob.size);
            const state = await transport.appendComicDirectorUpload({ workspaceRoot: request.workspaceRoot, uploadId, offset,
                dataBase64: await directorBlobBase64(blob.slice(offset, end)) });
            if (state.uploadId !== uploadId || state.offset !== end || state.byteLength !== blob.size) throw Object.assign(new Error('DIRECTOR_UPLOAD_INVALID'), { code: 'DIRECTOR_UPLOAD_INVALID' });
            offset = end;
        }
        return await consume(uploadId);
    } finally {
        await transport.discardComicDirectorUpload({ workspaceRoot: request.workspaceRoot, uploadId }).catch(() => undefined);
    }
}

/** Binary RPC transport only; these ephemeral bytes are never stored in the scene JSON. */
export function directorBlobBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error('DIRECTOR_MEDIA_INVALID'));
        reader.onabort = () => reject(new Error('DIRECTOR_MEDIA_INVALID'));
        reader.onload = () => {
            const result = String(reader.result ?? '');
            const comma = result.indexOf(',');
            if (comma < 0) reject(new Error('DIRECTOR_MEDIA_INVALID')); else resolve(result.slice(comma + 1));
        };
        reader.readAsDataURL(blob);
    });
}
export function directorImportMime(name: string, supplied: string): string {
    switch (name.split('.').pop()?.toLowerCase()) {
        case 'glb': return 'model/gltf-binary';
        case 'gltf': return 'model/gltf+json';
        case 'spz': case 'ply': return 'application/octet-stream';
        default: return supplied;
    }
}
