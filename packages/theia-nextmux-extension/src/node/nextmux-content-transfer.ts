import { createHash } from 'crypto';
import { mkdir, open, readFile, rename } from 'fs/promises';
import type { FileHandle } from 'fs/promises';
import { join } from 'path';

export interface StreamedContentReceipt {
    readonly transfer: 'stream-v2';
    readonly contentRetained: false;
    readonly partId: string;
    readonly sizeBytes: number;
    readonly sha256: string;
    readonly mimeType?: string;
    readonly contentType?: string;
    readonly extension: string;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const maximum = 32 * 1024 * 1024;
function checked(root: string, requestId: string, partId: string): string {
    if (!uuid.test(requestId) || !uuid.test(partId)) throw new Error('CONTENT_TRANSFER_ID_INVALID');
    return join(root, requestId.toLowerCase(), partId.toLowerCase());
}
export function validateStreamedContent(value: unknown): StreamedContentReceipt {
    const v = value as StreamedContentReceipt;
    if (!v || v.transfer !== 'stream-v2' || v.contentRetained !== false || !uuid.test(v.partId || '')
        || !Number.isSafeInteger(v.sizeBytes) || v.sizeBytes <= 0 || v.sizeBytes > maximum
        || !/^[a-f0-9]{64}$/.test(v.sha256 || '') || !/^(png|jpg|webp|gif|mp3|wav|ogg|flac)$/.test(v.extension || '')
        || !/^(image|audio)\/[a-z0-9.+-]+$/.test(v.mimeType || v.contentType || '')) throw new Error('CONTENT_TRANSFER_RECEIPT_INVALID');
    return v;
}

/** HTTP/WS use the same ordered receiver. Only complete, hashed parts become
 * local files; partial transport files never enter a project or a checkpoint. */
export class ManagedContentReceiver {
    private readonly parts = new Map<string, { handle: FileHandle; path: string; size: number; hash: ReturnType<typeof createHash> }>();
    private total = 0;
    constructor(private readonly root: string) {}
    async event(requestId: string | undefined, event: Record<string, unknown>): Promise<boolean> {
        if (event.type !== 'media.data' && event.type !== 'media.finished') return false;
        if (!requestId || event.version !== 2) throw new Error('CONTENT_TRANSFER_TASK_MISSING');
        if (event.type === 'media.finished') {
            const receipt = validateStreamedContent(event.media), state = this.parts.get(receipt.partId);
            if (!state || state.size !== receipt.sizeBytes || state.hash.digest('hex') !== receipt.sha256) throw new Error('CONTENT_TRANSFER_HASH_MISMATCH');
            await state.handle.sync(); await state.handle.close(); this.parts.delete(receipt.partId);
            const base = checked(this.root, requestId, receipt.partId);
            await rename(state.path, `${base}.content`);
            // The receipt is durable before the session/checkpoint can publish it.
            const temporary = `${base}.receipt.tmp`;
            const proof = await open(temporary, 'w', 0o600);
            try { await proof.writeFile(JSON.stringify({ version: 2, requestId, ...receipt })); await proof.sync(); } finally { await proof.close(); }
            await rename(temporary, `${base}.json`);
            return true;
        }
        const partId = String(event.partId || ''), base = checked(this.root, requestId, partId);
        if (!Number.isSafeInteger(event.offset) || Number(event.offset) < 0 || typeof event.data !== 'string'
            || !event.data || event.data.length > 32768 || !/^[A-Za-z0-9+/]*={0,2}$/.test(event.data)) throw new Error('CONTENT_TRANSFER_CHUNK_INVALID');
        const bytes = Buffer.from(event.data, 'base64');
        if (bytes.toString('base64') !== event.data) throw new Error('CONTENT_TRANSFER_CHUNK_INVALID');
        let state = this.parts.get(partId);
        if (!state) {
            if (event.offset !== 0 || this.parts.size >= 16) throw new Error('CONTENT_TRANSFER_SEQUENCE_GAP');
            await mkdir(join(this.root, requestId.toLowerCase()), { recursive: true, mode: 0o700 });
            state = { handle: await open(`${base}.partial`, 'wx', 0o600), path: `${base}.partial`, size: 0, hash: createHash('sha256') };
            this.parts.set(partId, state);
        }
        if (state.size !== event.offset) throw new Error('CONTENT_TRANSFER_SEQUENCE_GAP');
        this.total += bytes.length;
        if (this.total > maximum || state.size + bytes.length > 24 * 1024 * 1024) throw new Error('CONTENT_TRANSFER_TOO_LARGE');
        let offset = 0;
        while (offset < bytes.length) {
            const result = await state.handle.write(bytes, offset, bytes.length - offset, state.size + offset);
            if (!result.bytesWritten) throw new Error('CONTENT_TRANSFER_WRITE_FAILED'); offset += result.bytesWritten;
        }
        state.hash.update(bytes); state.size += bytes.length;
        return true;
    }
    async close(): Promise<void> {
        for (const value of this.parts.values()) await value.handle.close().catch(() => undefined);
        this.parts.clear();
    }
}

export async function readStreamedContent(root: string, requestId: string, value: unknown): Promise<{ path: string; bytes: Buffer; receipt: StreamedContentReceipt }> {
    const receipt = validateStreamedContent(value), base = checked(root, requestId, receipt.partId);
    const saved = JSON.parse(await readFile(`${base}.json`, 'utf8')) as StreamedContentReceipt & { requestId: string };
    if (saved.requestId !== requestId || saved.sha256 !== receipt.sha256 || saved.sizeBytes !== receipt.sizeBytes) throw new Error('CONTENT_TRANSFER_RECEIPT_MISMATCH');
    const bytes = await readFile(`${base}.content`);
    if (bytes.length !== receipt.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== receipt.sha256) throw new Error('CONTENT_TRANSFER_HASH_MISMATCH');
    return { path: `${base}.content`, bytes, receipt };
}
