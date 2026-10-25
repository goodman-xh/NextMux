import { createHash } from 'crypto';
import { open, readFile, rename, stat, unlink, writeFile } from 'fs/promises';
import { assertVideoContainer } from './nextmux-media-transfer';

type ResumeRecord = { version: 1; source: string; etag: string; total: number; mimeType: string };
const strongEtag = (value: string | null): value is string => typeof value === 'string' && /^"[^"\r\n]{1,240}"$/.test(value);
const remove = async (path: string): Promise<void> => { await unlink(path).catch(error => { if (error?.code !== 'ENOENT') throw error; }); };

/** The only retry is a GET of the original result. Range appends require a
 * strong validator, exact byte range and unchanged total; a 200 safely restarts
 * the same download. No generation callback is accepted by this helper. */
export async function saveResumableVideo(options: {
    destination: string; source: string; response: Response; signal: AbortSignal; maximum: number;
    reopen?: (headers: Record<string, string>) => Promise<Response>;
}): Promise<{ sizeBytes: number; sha256: string; mimeType: string }> {
    const partial = `${options.destination}.download.part`, journal = `${partial}.json`;
    let response = options.response, offset = 0, record: ResumeRecord | undefined;
    try {
        const previous = JSON.parse(await readFile(journal, 'utf8')) as ResumeRecord;
        const saved = await stat(partial);
        if (previous.version === 1 && previous.source === options.source && strongEtag(previous.etag)
            && Number.isSafeInteger(previous.total) && previous.total > 0 && previous.total <= options.maximum
            && saved.isFile() && saved.size > 0 && saved.size < previous.total && options.reopen) {
            await response.body?.cancel();
            response = await options.reopen({ range: `bytes=${saved.size}-`, 'if-range': previous.etag });
            if (response.status === 206) {
                const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
                if (!range || Number(range[1]) !== saved.size || Number(range[2]) !== previous.total - 1
                    || Number(range[3]) !== previous.total || response.headers.get('etag') !== previous.etag) {
                    await response.body?.cancel(); await remove(partial); await remove(journal); throw new Error('VIDEO_RESUME_RESOURCE_CHANGED');
                }
                record = previous; offset = saved.size;
            } else if (response.status !== 200) { await response.body?.cancel(); throw new Error('VIDEO_RESUME_UNAVAILABLE'); }
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    if (!response.ok || !response.body || offset === 0 && response.status === 206) { await response.body?.cancel(); throw new Error('VIDEO_DOWNLOAD_INVALID'); }
    const lengthValue = response.headers.get('content-length'), length = lengthValue === null ? 0 : Number(lengthValue);
    if (lengthValue !== null && (!/^\d+$/.test(lengthValue) || !Number.isSafeInteger(length) || length <= 0)) throw new Error('VIDEO_DOWNLOAD_LENGTH_INVALID');
    if (length && offset + length > options.maximum) throw new Error('VIDEO_DOWNLOAD_TOO_LARGE');
    let mimeType = (response.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
    const etag = response.headers.get('etag');
    if (!offset) {
        await remove(partial); await remove(journal);
        if (strongEtag(etag) && length) record = { version: 1, source: options.source, etag, total: length, mimeType };
        if (record) { await writeFile(`${journal}.tmp`, JSON.stringify(record), { mode: 0o600 }); await rename(`${journal}.tmp`, journal); }
    }
    const handle = await open(partial, offset ? 'r+' : 'wx', 0o600), reader = response.body.getReader(), hash = createHash('sha256');
    let position = offset, finished = false, prefix = Buffer.alloc(0);
    const abort = (): void => { void reader.cancel().catch(() => undefined); };
    options.signal.addEventListener('abort', abort, { once: true });
    try {
        // Rehash the local prefix instead of persisting implementation-specific
        // crypto state. A resumed transfer verifies the entire final file.
        if (offset) {
            const buffer = Buffer.alloc(256 * 1024); let readOffset = 0;
            while (readOffset < offset) {
                options.signal.throwIfAborted();
                const read = await handle.read(buffer, 0, Math.min(buffer.length, offset - readOffset), readOffset);
                if (!read.bytesRead) throw new Error('VIDEO_RESUME_PREFIX_MISSING');
                const bytes = buffer.subarray(0, read.bytesRead); hash.update(bytes);
                if (prefix.length < 16) prefix = Buffer.concat([prefix, bytes.subarray(0, 16 - prefix.length)]);
                readOffset += read.bytesRead;
            }
        }
        while (true) {
            options.signal.throwIfAborted(); const part = await reader.read(); options.signal.throwIfAborted(); if (part.done) break;
            if (position + part.value.byteLength > options.maximum || record && position + part.value.byteLength > record.total) throw new Error('VIDEO_DOWNLOAD_TOO_LARGE');
            if (prefix.length < 16) prefix = Buffer.concat([prefix, part.value.subarray(0, 16 - prefix.length)]);
            hash.update(part.value); let written = 0;
            while (written < part.value.length) { const result = await handle.write(part.value, written, part.value.length - written, position + written); if (!result.bytesWritten) throw new Error('VIDEO_WRITE_FAILED'); written += result.bytesWritten; }
            position += part.value.length;
        }
        if (!position || length && position !== offset + length || record && position !== record.total) throw new Error('VIDEO_DOWNLOAD_INCOMPLETE');
        mimeType = assertVideoContainer(prefix, mimeType); await handle.sync(); finished = true;
    } finally {
        options.signal.removeEventListener('abort', abort); await reader.cancel().catch(() => undefined); reader.releaseLock();
        await handle.sync().catch(() => undefined); await handle.close();
        if (!finished && !record) { await remove(partial); await remove(journal); }
    }
    await rename(partial, options.destination); await remove(journal);
    return { sizeBytes: position, sha256: hash.digest('hex'), mimeType };
}
