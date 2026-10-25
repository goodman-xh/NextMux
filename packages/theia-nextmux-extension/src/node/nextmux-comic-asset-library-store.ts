import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream, type Stats } from 'node:fs';
import { lstat, mkdir, open, readdir, readFile, rename, rm } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { COMIC_ASSET_CATEGORIES, sortComicAssetLibrary, type ComicAssetCategory, type ComicAssetLibraryEntry, type SaveComicCanvasAssetRequest } from '../common/nextmux-comic-asset-library';

// Match importComicMedia's real local importer so every accepted saved media file can be selected again.
const MAX_MEDIA_BYTES = 512 * 1024 * 1024;
const identifier = (id: string): boolean => /^asset-library-[a-f0-9]{64}$/.test(id);
const libraryIdentifier = (id: string): boolean => typeof id === 'string' && (identifier(id) || /^character-library:bundle-[0-9a-f-]{36}$/i.test(id));
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const queues = new Map<string, Promise<unknown>>();
type StoredEntry = Omit<ComicAssetLibraryEntry, 'mediaPath'> & { readonly schemaVersion: 1; readonly requestFingerprint: string; readonly intentFingerprint?: string; readonly mediaFile?: string; readonly mediaSha256?: string };
interface LibraryControl { readonly assetId: string; readonly pinnedAt?: string; readonly deletedAt?: string; readonly assetCategory?: ComicAssetCategory }
export type SaveLibraryAsset = Omit<ComicAssetLibraryEntry, 'assetId' | 'createdAt' | 'mediaPath'> & { readonly requestId: string; readonly sourcePath?: string; readonly intentFingerprint?: string };
export type InspectLibraryMedia = (path:string)=>Promise<Pick<ComicAssetLibraryEntry,'metadata'|'durationMs'>>;
export function comicAssetSaveIntent(request: SaveComicCanvasAssetRequest): string {
    if (typeof request.assetName !== 'string' || typeof request.remark !== 'string') throw new Error('ASSET_LIBRARY_INVALID_REQUEST');
    return hash(JSON.stringify({ workspaceRoot:resolve(request.workspaceRoot),canvasId:request.canvasId||'main',nodeId:request.nodeId,
        versionId:request.versionId,textContent:request.textContent,assetName:request.assetName.trim(),assetCategory:request.assetCategory,remark:request.remark.trim() }));
}

async function fileHash(path: string): Promise<string> {
    const value = createHash('sha256');
    for await (const chunk of createReadStream(path)) value.update(chunk);
    return value.digest('hex');
}
function fileIdentity(info: Stats): string { return `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`; }
/** Copy the selected inode, bounded by its original length, and reject concurrent edits/replacements. */
async function copyStableFile(sourcePath: string, destination: string, expected: Stats): Promise<void> {
    const source = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        if (fileIdentity(await source.stat()) !== fileIdentity(expected)) throw new Error('ASSET_LIBRARY_MEDIA_CHANGED');
        const target = await open(destination, 'wx', 0o600);
        try {
            const buffer = Buffer.alloc(64 * 1024);
            for (let position = 0; position < expected.size;) {
                const { bytesRead } = await source.read(buffer, 0, Math.min(buffer.length, expected.size - position), position);
                if (!bytesRead) throw new Error('ASSET_LIBRARY_MEDIA_CHANGED');
                for (let written = 0; written < bytesRead;) {
                    const result = await target.write(buffer, written, bytesRead - written, position + written);
                    if (!result.bytesWritten) throw new Error('ASSET_LIBRARY_COPY_FAILED');
                    written += result.bytesWritten;
                }
                position += bytesRead;
            }
            const current = await source.stat(), pathInfo = await lstat(sourcePath);
            if (fileIdentity(current) !== fileIdentity(expected) || fileIdentity(pathInfo) !== fileIdentity(expected) || pathInfo.isSymbolicLink()
                || (await target.stat()).size !== expected.size) throw new Error('ASSET_LIBRARY_MEDIA_CHANGED');
            await target.sync();
        } finally { await target.close(); }
    } finally { await source.close(); }
}
function validate(entry: StoredEntry): void {
    if (!entry || entry.schemaVersion !== 1 || !identifier(entry.assetId) || typeof entry.assetName !== 'string' || !entry.assetName.trim() || entry.assetName.length > 160
        || !COMIC_ASSET_CATEGORIES.includes(entry.assetCategory) || !['image','video','audio','text'].includes(entry.assetType)
        || typeof entry.remark !== 'string' || entry.remark.length > 4000 || !entry.source
        || (!entry.source.origin||entry.source.origin==='canvas')&&(!entry.source.projectId||!entry.source.canvasId||!entry.source.nodeId)
        || entry.source.origin!==undefined&&!['canvas','local_file','text','character'].includes(entry.source.origin)
        || !/^[a-f0-9]{64}$/.test(entry.requestFingerprint) || !Number.isFinite(Date.parse(entry.createdAt))) throw new Error('ASSET_LIBRARY_INVALID_ENTRY');
    if (entry.assetType === 'text') {
        if (!entry.textContent?.trim() || entry.textContent.length > 1000 || entry.mediaFile) throw new Error('ASSET_LIBRARY_EMPTY_TEXT');
    } else if (!/^media\.[a-z0-9]{1,8}$/.test(entry.mediaFile ?? '') || !/^[a-f0-9]{64}$/.test(entry.mediaSha256 ?? '')) throw new Error('ASSET_LIBRARY_MISSING_MEDIA');
}

/** Local immutable assets: one atomic directory per successful item; failures never roll back other items. */
export class ComicAssetLibraryStore {
    constructor(readonly root: string) { this.root = resolve(root); }
    private async control(assetId: string): Promise<LibraryControl> {
        if (!libraryIdentifier(assetId)) throw new Error('ASSET_LIBRARY_INVALID_ID');
        const path=join(this.root,`.control-${hash(assetId)}.json`);
        try {
            const info=await lstat(path);
            if (!info.isFile()||info.isSymbolicLink()||info.size>4096)throw new Error('ASSET_LIBRARY_INVALID_ENTRY');
            const value=JSON.parse(await readFile(path,'utf8')) as LibraryControl;
            if(value.assetId!==assetId||[value.pinnedAt,value.deletedAt].some(date=>date!==undefined&&(typeof date!=='string'||!Number.isFinite(Date.parse(date))))
                ||(value.assetCategory!==undefined&&!COMIC_ASSET_CATEGORIES.includes(value.assetCategory)))throw new Error('ASSET_LIBRARY_INVALID_ENTRY');
            return value;
        }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {assetId};throw error;}
    }
    private async updateControl(assetId:string, patch:(current:LibraryControl)=>LibraryControl):Promise<void>{
        if(!libraryIdentifier(assetId))throw new Error('ASSET_LIBRARY_INVALID_ID');
        const key=join(this.root,`control:${assetId}`),prior=queues.get(key)??Promise.resolve();
        const operation=prior.catch(()=>undefined).then(async()=>{
            const next=patch(await this.control(assetId));await mkdir(this.root,{recursive:true});
            const temporary=join(this.root,`.control-${randomUUID()}.tmp`),file=await open(temporary,'wx',0o600);
            try{await file.writeFile(JSON.stringify(next));await file.sync();}finally{await file.close();}
            try{await rename(temporary,join(this.root,`.control-${hash(assetId)}.json`));}finally{await rm(temporary,{force:true});}
        });queues.set(key,operation);try{await operation;}finally{if(queues.get(key)===operation)queues.delete(key);}
    }
    /** Pin/delete/category overlays also cover legacy bundles, without copying their media or rewriting their semantics. */
    async decorate(entries:readonly ComicAssetLibraryEntry[]):Promise<readonly ComicAssetLibraryEntry[]>{
        const result:ComicAssetLibraryEntry[]=[];
        for(const entry of entries){
            const control=await this.control(entry.assetId);
            if(!control.deletedAt){
                const canLeaveCharacter=Boolean(entry.mediaPath);
                const requestedCategory=control.assetCategory&&(!canLeaveCharacter&&control.assetCategory!=='character'?undefined:control.assetCategory);
                const nextCategory=requestedCategory??entry.assetCategory;
                const clearBundle=Boolean(requestedCategory&&requestedCategory!=='character'&&canLeaveCharacter);
                const nextType=entry.source.origin==='character'||(clearBundle&&entry.assetType==='text'&&Boolean(entry.characterBundleId)&&canLeaveCharacter)?'image':entry.assetType;
                result.push({...entry,assetType:nextType,assetCategory:nextCategory,...(clearBundle?{characterBundleId:undefined}:{}),...(control.pinnedAt?{pinnedAt:control.pinnedAt}:{})});
            }
        }
        return sortComicAssetLibrary(result);
    }
    async setPinned(assetId:string,pinned:boolean):Promise<void>{
        if(typeof pinned!=='boolean')throw new Error('ASSET_LIBRARY_INVALID_REQUEST');
        await this.updateControl(assetId,current=>{if(current.deletedAt)throw new Error('ASSET_LIBRARY_DELETED');return {assetId,...(current.assetCategory?{assetCategory:current.assetCategory}:{}),...(pinned?{pinnedAt:current.pinnedAt??new Date().toISOString()}:{})};});
    }
    async setCategory(assetId:string,assetCategory:ComicAssetCategory):Promise<void>{
        if(!COMIC_ASSET_CATEGORIES.includes(assetCategory))throw new Error('ASSET_LIBRARY_INVALID_REQUEST');
        if(identifier(assetId)&&assetCategory!=='character'){
            const existing=await this.stored(assetId).catch(()=>undefined);
            if(existing&&(!existing.mediaFile||existing.assetType!=='image'))throw new Error('ASSET_LIBRARY_INVALID_REQUEST');
        }
        await this.updateControl(assetId,current=>{if(current.deletedAt)throw new Error('ASSET_LIBRARY_DELETED');return {...current,assetId,assetCategory};});
    }
    async remove(assetId:string):Promise<void>{
        await this.updateControl(assetId,current=>({...current,deletedAt:current.deletedAt??new Date().toISOString()}));
        // Imported projects own separate copies. Only the library's owned directory is removed.
        if(identifier(assetId)){const path=join(this.root,assetId);const info=await lstat(path).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;});
            if(info){if(!info.isDirectory()||info.isSymbolicLink())throw new Error('ASSET_LIBRARY_INVALID_ENTRY');await rm(path,{recursive:true});}}
    }
    private async stored(assetId: string): Promise<StoredEntry> {
        if (!identifier(assetId)) throw new Error('ASSET_LIBRARY_INVALID_ID');
        const directory = join(this.root,assetId), folder = await lstat(directory), path = join(directory,'asset.json'), info = await lstat(path);
        if (!folder.isDirectory() || folder.isSymbolicLink() || !info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024) throw new Error('ASSET_LIBRARY_INVALID_ENTRY');
        const entry = JSON.parse(await readFile(path,'utf8')) as StoredEntry;
        validate(entry);
        if (entry.assetId !== assetId) throw new Error('ASSET_LIBRARY_INVALID_ENTRY');
        return entry;
    }
    private present(entry: StoredEntry): ComicAssetLibraryEntry {
        const {schemaVersion: _schema, requestFingerprint: _request, intentFingerprint: _intent, mediaFile, mediaSha256: _hash, ...result} = entry;
        return {...result,...(mediaFile ? {mediaPath:join(this.root,entry.assetId,mediaFile)} : {})};
    }
    async get(assetId: string): Promise<ComicAssetLibraryEntry> {
        if((await this.control(assetId)).deletedAt)throw new Error('ASSET_LIBRARY_DELETED');
        const entry=await this.stored(assetId), result=this.present(entry);
        if (result.mediaPath) {
            const info=await lstat(result.mediaPath);
            if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > MAX_MEDIA_BYTES || await fileHash(result.mediaPath) !== entry.mediaSha256) throw new Error('ASSET_LIBRARY_MEDIA_CHANGED');
        }
        const visible=(await this.decorate([result]))[0];if(!visible)throw new Error('ASSET_LIBRARY_DELETED');return visible;
    }
    async list(): Promise<readonly ComicAssetLibraryEntry[]> {
        await mkdir(this.root,{recursive:true});
        const result: ComicAssetLibraryEntry[]=[];
        for (const directory of await readdir(this.root,{withFileTypes:true})) {
            if (!directory.isDirectory() || !identifier(directory.name)) continue;
            try { result.push(this.present(await this.stored(directory.name))); } catch { /* A broken entry cannot hide the other successfully saved assets. */ }
        }
        return this.decorate(result);
    }
    /** Recover a completed request before touching its source, but only for the exact original intent/scope. */
    async recover(requestId: string, intentFingerprint: string): Promise<ComicAssetLibraryEntry | undefined> {
        if (typeof requestId !== 'string' || !/^[A-Za-z0-9:_-]{8,160}$/.test(requestId) || !/^[a-f0-9]{64}$/.test(intentFingerprint)) throw new Error('ASSET_LIBRARY_INVALID_REQUEST');
        if((await this.control(`asset-library-${hash(requestId)}`)).deletedAt)throw new Error('ASSET_LIBRARY_DELETED');
        let entry: StoredEntry;
        try { entry = await this.stored(`asset-library-${hash(requestId)}`); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
        if (entry.intentFingerprint !== intentFingerprint) throw new Error('ASSET_LIBRARY_REQUEST_CONFLICT');
        return this.get(entry.assetId);
    }
    async save(input: SaveLibraryAsset, inspectMedia?:InspectLibraryMedia): Promise<ComicAssetLibraryEntry> {
        if (!input || typeof input.requestId !== 'string' || !/^[A-Za-z0-9:_-]{8,160}$/.test(input.requestId)) throw new Error('ASSET_LIBRARY_INVALID_REQUEST');
        const key=join(this.root,hash(input.requestId)), prior=queues.get(key) ?? Promise.resolve();
        const operation=prior.catch(()=>undefined).then(()=>this.saveOne(input,inspectMedia));
        queues.set(key,operation);
        try { return await operation; } finally { if (queues.get(key)===operation) queues.delete(key); }
    }
    private async saveOne(input: SaveLibraryAsset, inspectMedia?:InspectLibraryMedia): Promise<ComicAssetLibraryEntry> {
        const { requestId, sourcePath, intentFingerprint, ...data }=input;
        if (typeof data.assetName !== 'string' || !data.assetName.trim() || data.assetName.trim().length > 160) throw new Error('ASSET_LIBRARY_INVALID_NAME');
        if (typeof data.remark !== 'string' || data.remark.trim().length > 4000 || !COMIC_ASSET_CATEGORIES.includes(data.assetCategory)
            || !['image','video','audio','text'].includes(data.assetType)) throw new Error('ASSET_LIBRARY_INVALID_ENTRY');
        if (data.assetType === 'text' && (typeof data.textContent !== 'string' || !data.textContent.slice(0,1000).trim())) throw new Error('ASSET_LIBRARY_EMPTY_TEXT');
        const normalized={...data,assetName:data.assetName.trim(),remark:data.remark.trim(),...(data.assetType==='text'?{textContent:data.textContent?.slice(0,1000)}:{})};
        const requestFingerprint=hash(JSON.stringify({...normalized,intentFingerprint})), assetId=`asset-library-${hash(requestId)}`;
        if((await this.control(assetId)).deletedAt)throw new Error('ASSET_LIBRARY_DELETED');
        await mkdir(this.root,{recursive:true});
        try {
            const existing=await this.stored(assetId);
            if (existing.requestFingerprint!==requestFingerprint) throw new Error('ASSET_LIBRARY_REQUEST_CONFLICT');
            return this.get(assetId);
        } catch(error) { if ((error as NodeJS.ErrnoException).code!=='ENOENT') throw error; }
        const stage=join(this.root,`.saving-${randomUUID()}`);
        await mkdir(stage,{mode:0o700});
        try {
            let mediaFile: string | undefined, mediaSha256: string | undefined, measured:Pick<ComicAssetLibraryEntry,'metadata'|'durationMs'>={};
            if (data.assetType !== 'text') {
                if (!sourcePath) throw new Error('ASSET_LIBRARY_MISSING_MEDIA');
                const info=await lstat(sourcePath), extension=extname(sourcePath).toLowerCase();
                if (!info.isFile() || info.isSymbolicLink() || !info.size || info.size>MAX_MEDIA_BYTES || !/^\.(png|jpe?g|webp|bmp|mp4|m4v|mov|webm|mp3|wav|m4a|aac|ogg|opus|flac)$/.test(extension)) throw new Error('ASSET_LIBRARY_INVALID_MEDIA');
                mediaFile=`media${extension}`;
                await copyStableFile(sourcePath,join(stage,mediaFile),info);
                mediaSha256=await fileHash(join(stage,mediaFile));
                if (data.metadata?.sha256 && data.metadata.sha256!==mediaSha256) throw new Error('ASSET_LIBRARY_MEDIA_CHANGED');
                if(inspectMedia)measured=await inspectMedia(join(stage,mediaFile));
            }
            const stored: StoredEntry={...normalized,...measured,assetId,createdAt:new Date().toISOString(),schemaVersion:1,requestFingerprint,...(intentFingerprint?{intentFingerprint}:{}),...(mediaFile?{mediaFile,mediaSha256}:{})};
            validate(stored);
            const file=await open(join(stage,'asset.json'),'wx',0o600);
            try { await file.writeFile(JSON.stringify(stored)); await file.sync(); } finally { await file.close(); }
            try { await rename(stage,join(this.root,assetId)); }
            catch(error) {
                if (!['EEXIST','ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
                const existing=await this.stored(assetId);
                if (existing.requestFingerprint!==requestFingerprint) throw new Error('ASSET_LIBRARY_REQUEST_CONFLICT');
            }
            return this.get(assetId);
        } finally { await rm(stage,{recursive:true,force:true}); }
    }
}
