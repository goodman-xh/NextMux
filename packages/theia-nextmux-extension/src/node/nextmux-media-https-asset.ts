import { validatedBaseUrl } from '@nextmux/model-runtime';
import { publicHttpsAssetDispatcher, type PublicWebReaderOptions } from './nextmux-public-web-reader';

/** An output asset may advertise HTTP, but only its HTTPS canonical form is requested.
 * API submit/poll/base URLs do not pass through this canonicalization. */
export function canonicalHttpsMediaAsset(value: string): URL {
    if (typeof value !== 'string' || value.length > 8_192 || value !== value.trim() || /[\u0000-\u0020\u007f]/u.test(value)) {
        throw new Error('MEDIA_ASSET_URL_INVALID');
    }
    const url = new URL(value);
    if (url.username || url.password || !['http:', 'https:'].includes(url.protocol)) throw new Error('MEDIA_ASSET_URL_INVALID');
    if (url.protocol === 'http:') {
        // WHATWG URL omits the explicit default :80; any remaining port is nonstandard.
        if (url.port) throw new Error('MEDIA_ASSET_HTTP_PORT_INVALID');
        url.protocol = 'https:';
    }
    url.hash = '';
    validatedBaseUrl(url.origin, false);
    return url;
}

/** TLS verification stays enabled; public DNS is pinned even through supported proxies.
 * The dispatcher cannot outlive a consumed, errored or cancelled response body. */
export async function fetchHttpsMediaAsset(
    input: string | URL, init: RequestInit, options: PublicWebReaderOptions & { readonly fetchImpl: typeof fetch }
): Promise<Response> {
    const url = canonicalHttpsMediaAsset(String(input));
    const signal = init.signal || new AbortController().signal;
    const dispatcher = await publicHttpsAssetDispatcher(url, options, signal);
    const close = (): void => { void dispatcher.destroy().catch(() => undefined); };
    try {
        const response = await options.fetchImpl(url, { ...init, redirect: 'manual', dispatcher } as RequestInit);
        if (!response.body) { close(); return response; }
        const reader = response.body.getReader();
        let finished = false;
        const finish = (): void => { if (!finished) { finished = true; close(); } };
        const body = new ReadableStream<Uint8Array>({
            async pull(controller) {
                try {
                    const item = await reader.read();
                    if (finished) return;
                    if (item.done) { finish(); reader.releaseLock(); controller.close(); }
                    else controller.enqueue(item.value);
                } catch (error) { if (finished) return; finish(); controller.error(error); }
            },
            cancel(reason) { finish(); void reader.cancel(reason).catch(() => undefined); }
        }, { highWaterMark: 0 });
        return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch (error) { close(); throw error; }
}
