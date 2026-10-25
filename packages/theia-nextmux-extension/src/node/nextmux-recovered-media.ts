import { createHash, randomUUID } from 'crypto';
import { constants } from 'fs';
import { lstat, mkdir, open, realpath, unlink } from 'fs/promises';
import { join } from 'path';
import { pathToFileURL } from 'url';
import type { BillingReceiptMedia } from '../common/nextmux-billing-receipts';
import { publishConversationArchiveFile } from './nextmux-conversation-archive';
import { validateStreamedContent } from './nextmux-content-transfer';
import { readBoundedResponseBody } from './nextmux-response-body';

export const RECOVERED_MEDIA_MAX_BYTES = 24 * 1024 * 1024;
const types = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac' } as const;
const sha = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

export function validateReceiptMedia(value: unknown, requestId: string): BillingReceiptMedia {
    const item = value as Partial<BillingReceiptMedia> | undefined;
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestId)
        || !item || item.requestId !== requestId || (item.transfer !== 'stream-v2' && item.downloadPath !== `/api/gateway/media/${requestId}/result`)
        || !item.extension || typeof item.mimeType !== 'string' || types[item.extension] !== item.mimeType
        || !['image', 'speech', 'music', 'sound_effect'].includes(String(item.kind)) || (item.kind === 'image') !== item.mimeType.startsWith('image/')
        || !Number.isSafeInteger(item.sizeBytes) || item.sizeBytes! <= 0 || item.sizeBytes! > RECOVERED_MEDIA_MAX_BYTES
        || !Number.isSafeInteger(item.expiresAt) || item.expiresAt! <= 0
        || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('INVALID_MEDIA_RECEIPT');
    if (item.transfer === 'stream-v2') validateStreamedContent(item);
    return { kind: item.kind!, requestId, downloadPath: item.downloadPath,
        ...(item.transfer === 'stream-v2' ? { transfer: item.transfer, contentRetained: false as const, partId: item.partId } : {}), extension: item.extension, mimeType: item.mimeType,
        sizeBytes: item.sizeBytes!, sha256: item.sha256, expiresAt: item.expiresAt!,
        provider: String(item.provider || '').slice(0, 300), model: String(item.model || '').slice(0, 300) };
}

/** Stop reading as soon as the cap is exceeded, even without Content-Length. */
export async function readBoundedMediaBody(response: Response, limit = RECOVERED_MEDIA_MAX_BYTES): Promise<Uint8Array> {
    const bytes = await readBoundedResponseBody(response, limit);
    if (!bytes.length) throw new Error('MEDIA_EMPTY');
    return bytes;
}

/** Explicit local save. No prompt, tools, provider URL or binary data crosses the renderer RPC. */
export async function saveRecoveredMedia(options: {
    dataRoot: string; ownerId: string; media: BillingReceiptMedia; baseUrl: string;
    localContent?: (media: BillingReceiptMedia) => Promise<Uint8Array>;
    deviceId: () => Promise<string>; currentOwnerId: () => Promise<string | undefined>; fetch: typeof fetch;
}): Promise<string> {
    const media = validateReceiptMedia(options.media, options.media.requestId);
    if (!options.ownerId || options.ownerId.length > 200) throw new Error('MEDIA_OWNER_REQUIRED');
    const assertOwner = async (): Promise<void> => { if (await options.currentOwnerId() !== options.ownerId) throw new Error('MEDIA_OWNER_CHANGED'); };
    await assertOwner();
    if (media.transfer !== 'stream-v2' && media.expiresAt <= Date.now()) throw new Error('MEDIA_RECEIPT_EXPIRED');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 60_000);
    let temporary: string | undefined;
    let assertStorage: (() => Promise<void>) | undefined;
    try {
        let bytes: Uint8Array;
        if (media.transfer === 'stream-v2') {
            if (!options.localContent) throw new Error('MEDIA_CONTENT_NOT_RETAINED');
            bytes = await options.localContent(media);
        } else {
        const response = await options.fetch(new URL(media.downloadPath!, options.baseUrl), {
            method: 'GET', headers: { 'x-nextmux-device-id': await options.deviceId(), accept: media.mimeType },
            redirect: 'error', signal: controller.signal
        });
        if (!response.ok || response.headers.get('x-nextmux-call-id') !== media.requestId
            || response.headers.get('content-type')?.split(';')[0].trim() !== media.mimeType) throw new Error('MEDIA_DOWNLOAD_UNAVAILABLE');
        bytes = await readBoundedMediaBody(response, media.sizeBytes);
        }
        if (bytes.length !== media.sizeBytes || sha(bytes) !== media.sha256) throw new Error('MEDIA_INTEGRITY_MISMATCH');
        await assertOwner();
        await mkdir(options.dataRoot, { recursive: true, mode: 0o700 });
        const dataRoot = await realpath(options.dataRoot);
        const storageRoot = join(dataRoot, 'recovered-media');
        const directory = join(storageRoot, sha(options.ownerId));
        // Private directories are not a sandbox against another process running as the same OS user.
        // Detect replacement at each write boundary; never follow a changed parent during cleanup.
        const directories: { path: string; dev: number; ino: number }[] = [];
        assertStorage = async (): Promise<void> => {
            for (const expected of directories) {
                const current = await lstat(expected.path);
                if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== expected.dev || current.ino !== expected.ino
                    || await realpath(expected.path) !== expected.path) throw new Error('MEDIA_STORAGE_UNSAFE');
            }
        };
        const rememberDirectory = async (path: string): Promise<void> => {
            const info = await lstat(path);
            if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path) throw new Error('MEDIA_STORAGE_UNSAFE');
            directories.push({ path, dev: info.dev, ino: info.ino });
            await assertStorage!();
        };
        await rememberDirectory(dataRoot);
        await mkdir(storageRoot, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
        await rememberDirectory(storageRoot);
        await assertStorage();
        await mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
        await rememberDirectory(directory);
        const target = join(directory, `${media.requestId}-${media.sha256.slice(0, 16)}.${media.extension}`);
        const verifyExisting = async (): Promise<boolean> => {
            await assertStorage!();
            const info = await lstat(target).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
            if (!info) return false;
            if (!info.isFile() || info.isSymbolicLink() || info.size !== media.sizeBytes) throw new Error('MEDIA_STORAGE_CONFLICT');
            const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
            try {
                const opened = await handle.stat();
                if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino || opened.size !== media.sizeBytes) throw new Error('MEDIA_STORAGE_CONFLICT');
                const bytes = Buffer.alloc(media.sizeBytes);
                let offset = 0;
                while (offset < bytes.length) { const next = await handle.read(bytes, offset, bytes.length - offset, offset); if (!next.bytesRead) throw new Error('MEDIA_STORAGE_CONFLICT'); offset += next.bytesRead; }
                if ((await handle.read(Buffer.alloc(1), 0, 1, bytes.length)).bytesRead || (await handle.stat()).size !== bytes.length || sha(bytes) !== media.sha256) throw new Error('MEDIA_STORAGE_CONFLICT');
            } finally { await handle.close(); }
            return true;
        };
        if (!await verifyExisting()) {
            await assertStorage();
            temporary = join(directory, `.download-${randomUUID()}.tmp`);
            const handle = await open(temporary, 'wx', 0o600);
            try { await assertStorage(); await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
            await assertOwner();
            await assertStorage();
            try { await publishConversationArchiveFile(temporary, target, bytes); }
            catch (error) { if ((error as { code?: string }).code !== 'ARCHIVE_DESTINATION_EXISTS' || !await verifyExisting()) throw error; }
        }
        await assertStorage();
        await assertOwner();
        return pathToFileURL(target).toString();
    } finally {
        clearTimeout(timer);
        if (temporary) await (async () => { await assertStorage?.(); await unlink(temporary!); })().catch(() => undefined);
    }
}
