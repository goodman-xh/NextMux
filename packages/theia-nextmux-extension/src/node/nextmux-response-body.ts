export class ResponseBodyLimitError extends Error {
    constructor() { super('RESPONSE_BODY_LIMIT'); }
}

/** Bounds decoded bytes while reading, including chunked responses without a length header. */
export async function readBoundedResponseBody(response: Response, limit: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new ResponseBodyLimitError();
    const length = response.headers.get('content-length');
    if (length && (!/^\d+$/.test(length) || Number(length) > limit)) {
        await response.body?.cancel().catch(() => undefined); throw new ResponseBodyLimitError();
    }
    if (!response.body) return new Uint8Array();
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
        for (;;) {
            const next = await reader.read(); if (next.done) break;
            size += next.value.byteLength;
            if (size > limit) throw new ResponseBodyLimitError();
            chunks.push(next.value);
        }
        return Buffer.concat(chunks, size);
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
