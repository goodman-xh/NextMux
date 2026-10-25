import { MediaRuntimeError } from '@nextmux/media-core';
import { mediaMessage } from '../common/nextmux-media-messages';

/** Keep cancellation and deadlines attached until the response body is consumed or cancelled. */
export async function fetchMediaWithLifetime(
    fetchImpl: typeof fetch, input: string | URL, init: RequestInit, signal: AbortSignal,
    headerTimeoutMs = 120_000, bodyIdleTimeoutMs = headerTimeoutMs, totalTimeoutMs = 6 * 60 * 60_000
): Promise<Response> {
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let output: ReadableStreamDefaultController<Uint8Array> | undefined;
    let finished = false;
    let failure: MediaRuntimeError | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let totalTimer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => {
        clearTimeout(idleTimer);
        clearTimeout(totalTimer);
        signal.removeEventListener('abort', abort);
    };
    const stop = (reason: MediaRuntimeError): void => {
        if (finished) return;
        finished = true;
        failure = reason;
        cleanup();
        controller.abort(reason);
        output?.error(reason);
        // Do not await a broken source's cancellation hook before releasing the consumer.
        void reader?.cancel(reason).catch(() => undefined);
    };
    const abort = (): void => stop(new MediaRuntimeError('CANCELLED', mediaMessage('media_cancelled'), false));
    const armIdle = (milliseconds: number): void => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => stop(new MediaRuntimeError('MEDIA_TIMEOUT', mediaMessage('transfer_idle_timeout', { timeoutKind: 'idle', timeoutMs: milliseconds }), true)), milliseconds);
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); throw failure; }
    armIdle(headerTimeoutMs);
    totalTimer = setTimeout(() => stop(new MediaRuntimeError('MEDIA_TIMEOUT', mediaMessage('transfer_total_timeout', { timeoutKind: 'total', timeoutMs: totalTimeoutMs }), true)), totalTimeoutMs);
    try {
        const response = await fetchImpl(input, { ...init, signal: controller.signal });
        if (failure) { void response.body?.cancel().catch(() => undefined); throw failure; }
        if (!response.body) { finished = true; cleanup(); return response; }
        reader = response.body.getReader();
        armIdle(bodyIdleTimeoutMs);
        const body = new ReadableStream<Uint8Array>({
            start(stream) { output = stream; },
            async pull(stream) {
                try {
                    const item = await reader!.read();
                    if (finished) return;
                    if (item.done) { finished = true; cleanup(); stream.close(); reader!.releaseLock(); }
                    else { armIdle(bodyIdleTimeoutMs); stream.enqueue(item.value); }
                } catch (error) {
                    if (finished) return;
                    finished = true; cleanup(); stream.error(error);
                }
            },
            cancel(reason) {
                if (finished) return;
                finished = true; cleanup(); controller.abort(reason);
                void reader!.cancel(reason).catch(() => undefined);
            }
        }, { highWaterMark: 0 });
        return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch (error) {
        finished = true; cleanup(); throw failure || error;
    }
}

/** Video responses must be a supported container, including generic binary CDN responses. */
export function assertVideoContainer(prefix: Uint8Array, mimeType: string): string {
    const mp4 = prefix.length >= 12 && String.fromCharCode(...prefix.subarray(4, 8)) === 'ftyp'
        && !/^(?:avif|avis|heic|heix|hevc|hevx|mif1|msf1|M4A |M4B |M4P )$/.test(String.fromCharCode(...prefix.subarray(8, 12)));
    const webm = prefix.length >= 4 && prefix[0] === 0x1a && prefix[1] === 0x45 && prefix[2] === 0xdf && prefix[3] === 0xa3;
    const valid = (mimeType === 'video/mp4' || mimeType === 'video/quicktime') ? mp4
        : mimeType === 'video/webm' ? webm
        : mimeType === 'application/octet-stream' && (mp4 || webm);
    if (!valid) throw new MediaRuntimeError('INVALID_VIDEO_OUTPUT', mediaMessage('video_container_invalid'), false);
    return mimeType === 'application/octet-stream' ? webm ? 'video/webm' : 'video/mp4' : mimeType;
}
