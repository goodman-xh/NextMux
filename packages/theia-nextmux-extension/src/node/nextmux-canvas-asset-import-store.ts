import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { CanvasNode } from '@nextmux/comic-core/canvas';
import type { ImportComicLibraryAssetRequest } from '../common/nextmux-comic-asset-library';

export interface CanvasLibraryMediaIdentity { readonly fileId: string; readonly jobId: string }
function digestUuid(value: string): string {
    const hash=createHash('sha256').update(value).digest('hex');
    return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
}

export interface CanvasAssetImportRecord {
    readonly schemaVersion: 1;
    readonly intentFingerprint: string;
    readonly projectId: string;
    readonly canvasId: string;
    readonly node: CanvasNode;
    readonly target?: ImportComicLibraryAssetRequest['target'];
    readonly completed: boolean;
}
/** This journal is read/written while the owning canvas mutation lock is held. */
export class CanvasAssetImportStore {
    readonly key: string;
    readonly nodeId: string;
    readonly fingerprint: string;
    constructor(readonly directory: string, request: ImportComicLibraryAssetRequest) {
        if (typeof request.requestId !== 'string' || !/^[A-Za-z0-9:_-]{8,160}$/.test(request.requestId)
            || !/^(?:asset-library-[a-f0-9]{64}|character-library:bundle-[0-9a-f-]{36})$/i.test(request.assetId) || !Number.isFinite(request.position?.x) || !Number.isFinite(request.position?.y)) throw new Error('ASSET_LIBRARY_INVALID_REQUEST');
        this.key = createHash('sha256').update(request.requestId).digest('hex');
        this.nodeId = `canvas-library-${this.key}`;
        if (request.target !== undefined && (!request.target || typeof request.target.nodeId !== 'string' || !request.target.nodeId.trim() || request.target.nodeId.length > 200
            || !['firstFrame','lastFrame','referenceImage','referenceVideo','referenceAudio','character'].includes(request.target.role))) throw new Error('ASSET_LIBRARY_INVALID_REQUEST');
        this.requestTarget = request.target ? { nodeId: request.target.nodeId, role: request.target.role } : undefined;
        this.fingerprint = createHash('sha256').update(JSON.stringify({assetId:request.assetId,x:request.position.x,y:request.position.y,
            ...(request.target ? {target:{nodeId:request.target.nodeId,role:request.target.role}} : {})})).digest('hex');
    }
    private get folder(): string { return join(this.directory,'nextmux.canvas.asset-imports'); }
    private get path(): string { return join(this.folder,`${this.key}.json`); }
    /** Stable local media identity survives a failure before this journal's prepared write. */
    mediaIdentity(canvasId: string): CanvasLibraryMediaIdentity {
        return { fileId:digestUuid(`${canvasId}\0${this.key}`), jobId:`media-job-${digestUuid(`${canvasId}\0${this.key}\0${this.fingerprint}`)}` };
    }
    async read(): Promise<CanvasAssetImportRecord | undefined> {
        try {
            const folder=await lstat(this.folder),file=await lstat(this.path);
            if (!folder.isDirectory() || folder.isSymbolicLink() || !file.isFile() || file.isSymbolicLink() || file.size>128*1024) throw new Error('ASSET_LIBRARY_IMPORT_JOURNAL_INVALID');
            const record=JSON.parse(await readFile(this.path,'utf8')) as CanvasAssetImportRecord;
            if (record?.schemaVersion!==1 || !record.projectId || !record.canvasId || record.node?.id!==this.nodeId || typeof record.completed!=='boolean'
                || !/^[a-f0-9]{64}$/.test(record.intentFingerprint)) throw new Error('ASSET_LIBRARY_IMPORT_JOURNAL_INVALID');
            if (record.intentFingerprint!==this.fingerprint) throw new Error('ASSET_LIBRARY_REQUEST_CONFLICT');
            if (record.target?.nodeId !== this.requestTarget?.nodeId || record.target?.role !== this.requestTarget?.role) throw new Error('ASSET_LIBRARY_REQUEST_CONFLICT');
            return record;
        } catch(error) { if ((error as NodeJS.ErrnoException).code==='ENOENT') return undefined; throw error; }
    }
    private readonly requestTarget: ImportComicLibraryAssetRequest['target'];
    async write(record: CanvasAssetImportRecord): Promise<void> {
        await mkdir(this.folder,{recursive:true});
        const folder=await lstat(this.folder);
        if (!folder.isDirectory() || folder.isSymbolicLink()) throw new Error('ASSET_LIBRARY_IMPORT_JOURNAL_INVALID');
        const temporary=join(this.folder,`.${this.key}-${randomUUID()}.tmp`),file=await open(temporary,'wx',0o600);
        try {
            try { await file.writeFile(JSON.stringify(record)); await file.sync(); } finally { await file.close(); }
            await rename(temporary,this.path);
        } finally { await rm(temporary,{force:true}); }
    }
}
