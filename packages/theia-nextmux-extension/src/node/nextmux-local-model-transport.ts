import { Agent } from 'undici';
import { OfficialModelError, validatedLocalModelBaseUrl } from '@nextmux/model-runtime';
import { LIVE_UPSTREAM_TIMEOUTS } from './nextmux-system-proxy';

/** The model endpoints any local-model request may reach. A model download is not one of them (see `pullFetch`). */
const MODEL_ENDPOINTS: readonly string[] = ['GET /v1/models', 'POST /v1/chat/completions',
    'GET /api/version', 'GET /api/tags', 'POST /api/show', 'POST /api/chat'];
/** Only the download the user started from a failed reply (LobeChat #13). */
const PULL_ENDPOINTS: readonly string[] = ['POST /api/pull'];

/** One direct connection pool, deliberately independent from the global proxy. */
export class LocalModelTransport {
    private dispatcher: Agent | undefined;

    readonly fetch: typeof fetch = (input, init) => this.send(input, init, MODEL_ENDPOINTS);

    /** A separate door for Ollama's /api/pull, so model traffic through `fetch` can never start a download. */
    readonly pullFetch: typeof fetch = (input, init) => this.send(input, init, PULL_ENDPOINTS);

    private async send(input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1], allowed: readonly string[]): Promise<Response> {
        const request = new Request(input, init);
        const signal = init?.signal ?? (input instanceof Request ? input.signal : request.signal);
        const url = new URL(request.url);
        const base = validatedLocalModelBaseUrl(`${url.origin}/v1`);
        if (url.username || url.password || url.search || url.hash || !allowed.includes(`${request.method} ${url.pathname}`)) {
            throw new OfficialModelError('LOCAL_MODEL_URL_REQUIRED', 'The local model endpoint is not allowed', { params: { reason: 'endpoint_not_allowed', method: request.method } });
        }
        url.hostname = base.hostname;
        const headers = new Headers(request.headers);
        // Ollama local API needs no authentication. Never forward a cloud key/cookie.
        for (const name of [...headers.keys()]) {
            if (!['accept', 'content-type', 'user-agent'].includes(name.toLowerCase())) headers.delete(name);
        }
        this.dispatcher ??= new Agent({ connections: 4, pipelining: 1, ...LIVE_UPSTREAM_TIMEOUTS });
        return fetch(url, { method: request.method, body: request.body, signal,
            headers, redirect: 'error', credentials: 'omit', duplex: 'half',
            dispatcher: this.dispatcher } as RequestInit);
    }

    async close(): Promise<void> {
        const dispatcher = this.dispatcher;
        this.dispatcher = undefined;
        await dispatcher?.close();
    }
}
