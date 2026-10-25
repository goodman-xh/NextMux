import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { CanvasAssetVersion } from '@nextmux/comic-core';
import { CanvasServiceError } from './nextmux-canvas-store';

interface FrameSourceProof { readonly schemaVersion: 1; readonly frame: Pick<CanvasAssetVersion, 'id' | 'assetId' | 'uri' | 'metadata'>; readonly source: CanvasAssetVersion }
async function proofPath(workspaceRoot: string, frame: CanvasAssetVersion, create: boolean): Promise<string> {
    const root = await realpath(workspaceRoot), media = join(root, 'nextmux.media'), directory = join(media, '.canvas-frame-sources');
    for (const candidate of [media, directory]) {
        if (create) await mkdir(candidate, { recursive: false }).catch(error => { if (error.code !== 'EEXIST') throw error; });
        const info = await lstat(candidate);
        if (!info.isDirectory() || info.isSymbolicLink() || await realpath(candidate) !== candidate) throw new CanvasServiceError('START_FRAME_SOURCE_PROOF_INVALID', 'The local extraction proof directory is invalid.');
    }
    return join(directory, `${createHash('sha256').update(`${frame.id}\0${frame.uri}`).digest('hex')}.json`);
}

/** Written only by the real backend extraction path, not by saveCanvas or caller-provided provenance. */
export async function writeCanvasFrameSourceProof(workspaceRoot: string, frame: CanvasAssetVersion, source: CanvasAssetVersion): Promise<void> {
    if (source.kind !== 'video' || !source.metadata?.sha256 || !frame.metadata?.sha256) throw new CanvasServiceError('START_FRAME_SOURCE_PROOF_INVALID', 'The extraction requires exact local source and frame hashes.');
    const path = await proofPath(workspaceRoot, frame, true), temporary = `${path}.${randomUUID()}.tmp`;
    const value: FrameSourceProof = { schemaVersion: 1, frame: { id: frame.id, assetId: frame.assetId, uri: frame.uri, metadata: frame.metadata },
        source: { id: source.id, assetId: source.assetId, kind: 'video', uri: source.uri, createdAt: source.createdAt, metadata: source.metadata, ...(source.status ? { status: source.status } : {}) } };
    const file = await open(temporary, 'wx', 0o600);
    try { try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); } await rename(temporary, path); }
    finally { await rm(temporary, { force: true }); }
}

/** The public canvas tuple must match backend-produced proof; URI/model-name guessing is not a fallback. */
export async function readCanvasFrameSourceProof(workspaceRoot: string, frame: CanvasAssetVersion): Promise<CanvasAssetVersion> {
    try {
        const path = await proofPath(workspaceRoot, frame, false), info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 128 * 1024) throw new CanvasServiceError('START_FRAME_SOURCE_PROOF_INVALID', 'The local extraction proof is invalid.');
        const proof = JSON.parse(await readFile(path, 'utf8')) as FrameSourceProof;
        const p = frame.provenance;
        if (proof.schemaVersion !== 1 || proof.frame?.id !== frame.id || proof.frame.assetId !== frame.assetId || proof.frame.uri !== frame.uri || proof.frame.metadata?.sha256 !== frame.metadata?.sha256
            || proof.source?.kind !== 'video' || !proof.source.metadata?.sha256 || !p || proof.source.id !== p.sourceVersionId || proof.source.assetId !== p.sourceAssetId
            || proof.source.uri !== p.sourceUri || proof.source.metadata.sha256 !== p.sourceSha256 || p.operation !== 'frameExtract' || p.frameSelection?.kind !== 'last') {
            throw new CanvasServiceError('START_FRAME_SOURCE_PROOF_INVALID', 'The canvas reference does not match its actual extraction proof.');
        }
        return proof.source;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new CanvasServiceError('START_FRAME_SOURCE_PROOF_REQUIRED', 'Extract this direct video tail frame again to retain its exact local source. This does not call a model.');
        throw error;
    }
}
