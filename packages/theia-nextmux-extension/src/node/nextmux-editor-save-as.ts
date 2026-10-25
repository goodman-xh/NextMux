import { randomUUID } from 'crypto';
import { constants } from 'fs';
import { link, lstat, open, realpath, unlink } from 'fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { EDITOR_SAVE_AS_MAX_BYTES, EditorDraftSaveAsErrorCode, EditorDraftSaveAsRequest, EditorDraftSaveAsResult } from '../common/nextmux-editor-save-as';

type Reason = EditorDraftSaveAsErrorCode extends `EDITOR_SAVE_AS_${infer Value}` ? Value : never;
export class EditorDraftSaveAsError extends Error {
    readonly code: EditorDraftSaveAsErrorCode;
    constructor(reason: Reason) { const code = `EDITOR_SAVE_AS_${reason}` as const; super(code); this.code = code; this.name = 'EditorDraftSaveAsError'; }
}
interface Identity { readonly dev: bigint; readonly ino: bigint; }
const fail = (reason: Reason): never => { throw new EditorDraftSaveAsError(reason); };
const sameIdentity = (left: Identity, right: Identity): boolean => left.dev === right.dev && left.ino === right.ino;
const equivalentPath = (left: string, right: string): boolean => resolve(left).normalize('NFC').toLowerCase() === resolve(right).normalize('NFC').toLowerCase();
const controls = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
function parsedUri(value: unknown): URL {
    if (typeof value !== 'string' || !value.length || value.length > 8192 || controls.test(value)) fail('INVALID_URI');
    try { return new URL(value as string); } catch { return fail('INVALID_URI'); }
}
function localPath(uri: URL): string | undefined {
    if (uri.protocol !== 'file:' || uri.hostname || uri.username || uri.password || uri.search || uri.hash) return undefined;
    if (process.platform !== 'win32' && /^\/[a-z]:/i.test(uri.pathname)) return undefined;
    try {
        const target = fileURLToPath(uri);
        if (!isAbsolute(target) || controls.test(target)) return undefined;
        if (process.platform !== 'win32' && /^\/[a-z]:/i.test(target)) return undefined;
        if (process.platform === 'win32') {
            if (!/^[a-z]:\\/i.test(target)) return undefined; // no UNC or device namespace
            const segments = target.slice(3).split('\\');
            if (segments.some(part => !part || /[:*?"<>|]/.test(part) || /[ .]$/.test(part)
                || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) return undefined;
        }
        return target;
    } catch { return undefined; }
}
async function sourceIdentityPath(source: string): Promise<string> {
    try { return await realpath(source); }
    catch {
        try { return join(await realpath(dirname(source)), basename(source)); }
        catch { return resolve(source); }
    }
}

/** No source write, directory creation, overwrite rename, recovery mutation, or network request. */
export async function saveEditorDraftAsNewFile(request: EditorDraftSaveAsRequest, options: {
    readonly signal?: AbortSignal;
    readonly isCancelled?: () => boolean;
} = {}): Promise<EditorDraftSaveAsResult> {
    let temporary: string | undefined;
    let identity: Identity | undefined;
    let parent: string | undefined;
    let parentIdentity: Identity | undefined;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    const active = (): void => { if (options.signal?.aborted || options.isCancelled?.()) fail('CANCELLED'); };
    const parentUnchanged = async (): Promise<void> => {
        if (!parent || !parentIdentity) fail('UNSAFE_PATH');
        const info = await lstat(parent!, { bigint: true });
        if (!info.isDirectory() || info.isSymbolicLink() || !sameIdentity(info, parentIdentity!) || await realpath(parent!) !== parent) fail('UNSAFE_PATH');
    };
    try {
        active();
        if (!request || typeof request !== 'object' || Array.isArray(request)
            || Object.keys(request).some(key => !['sourceUri', 'destinationUri', 'content'].includes(key))
            || typeof request.content !== 'string') fail('INVALID_REQUEST');
        if (request.content.length > EDITOR_SAVE_AS_MAX_BYTES || Buffer.byteLength(request.content, 'utf8') > EDITOR_SAVE_AS_MAX_BYTES) fail('TOO_LARGE');
        const bytes = Buffer.from(request.content, 'utf8');
        if (bytes.toString('utf8') !== request.content) fail('INVALID_REQUEST'); // no lossy lone-surrogate replacement
        const sourceUri = parsedUri(request.sourceUri), destinationUri = parsedUri(request.destinationUri);
        const destination = localPath(destinationUri);
        if (!/^file:\/\//i.test(request.destinationUri) || !destination || destinationUri.pathname.endsWith('/')) fail('INVALID_URI');
        if (sourceUri.protocol === 'file:' && (sourceUri.search || sourceUri.hash)) fail('INVALID_URI');
        const source = localPath(sourceUri);
        if (source && equivalentPath(source, destination!)) fail('SAME_SOURCE');
        parent = await realpath(dirname(destination!));
        const info = await lstat(parent, { bigint: true });
        if (!info.isDirectory() || info.isSymbolicLink()) fail('UNSAFE_PATH');
        parentIdentity = info;
        const target = join(parent, basename(destination!));
        if (source && equivalentPath(await sourceIdentityPath(source), target)) fail('SAME_SOURCE');
        await parentUnchanged(); active();
        temporary = join(parent, `.nextmux-save-as-${randomUUID()}.tmp`);
        handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
        const opened = await handle.stat({ bigint: true });
        if (!opened.isFile() || opened.nlink !== 1n) fail('UNSAFE_PATH');
        identity = opened;
        await parentUnchanged(); active();
        await handle.writeFile(bytes); await handle.sync();
        const written = await handle.stat({ bigint: true });
        if (!sameIdentity(written, opened) || written.size !== BigInt(bytes.length) || written.nlink !== 1n) fail('UNSAFE_PATH');
        await handle.close(); handle = undefined;
        await parentUnchanged(); active();
        const current = await lstat(temporary, { bigint: true });
        if (!current.isFile() || current.isSymbolicLink() || !sameIdentity(current, opened) || current.nlink !== 1n) fail('UNSAFE_PATH');
        active();
        // Hard-link publication is exclusive. Never replace it with an exists→write
        // check or overwrite-capable rename when the filesystem cannot support it.
        await link(temporary, target);
        // This is the commit point. Late cancellation/cleanup failure cannot delete
        // or reverse a newly published file, nor claim that no file was created.
        return { created: true, destinationUri: pathToFileURL(target).href, bytes: bytes.length };
    } catch (error) {
        if (error instanceof EditorDraftSaveAsError) throw error;
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code === 'EEXIST') fail('TARGET_EXISTS');
        if (['ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'ENOSYS'].includes(code || '')) fail('UNSUPPORTED_FILESYSTEM');
        if (code === 'ELOOP' || code === 'ENOTDIR') fail('UNSAFE_PATH');
        return fail('UNAVAILABLE');
    } finally {
        try { await handle?.close(); } catch { /* Preserve original outcome. */ }
        if (temporary && identity) {
            try {
                await parentUnchanged();
                const current = await lstat(temporary, { bigint: true });
                if (current.isFile() && !current.isSymbolicLink() && sameIdentity(current, identity)) await unlink(temporary);
            } catch { /* Do not delete an unproven path or reverse a committed file. */ }
        }
    }
}
