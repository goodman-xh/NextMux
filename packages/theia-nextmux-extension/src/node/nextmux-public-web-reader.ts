import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { isIP, type LookupFunction } from 'node:net';
import { Parser } from 'htmlparser2';
import ipaddr from 'ipaddr.js';
import { Agent, Client, ProxyAgent, type Dispatcher } from 'undici';
import { AgentToolError, type AgentToolRegistry, type ToolHandlerResult } from '@nextmux/agent-runtime';
import { LIVE_UPSTREAM_TIMEOUTS } from './nextmux-system-proxy';
import { allBenchmarkDnsAddresses, trustedDohAddresses } from './nextmux-public-dns';

export type PublicWebReaderNetworkRoute =
    | { readonly kind: 'direct' }
    | { readonly kind: 'http_proxy'; readonly uri: string }
    | { readonly kind: 'unsupported'; readonly reason?: string };

export interface PublicWebReaderOptions {
    /** Host resolves its existing system/environment/PAC proxy settings. Never silently bypass a proxy. */
    readonly resolveNetworkRoute: (url: URL) => Promise<PublicWebReaderNetworkRoute>;
    readonly fetchImpl?: typeof fetch;
    readonly lookupImpl?: (hostname: string) => Promise<readonly LookupAddress[]>;
    /** Whole page-read limit (DNS, route, redirects, headers and body), not a model-work timeout. */
    readonly timeoutMs?: number;
}
export interface PublicWebPage {
    readonly source: 'public_http';
    readonly sourceContentIsUntrusted: true;
    readonly url: string;
    readonly finalUrl: string;
    readonly title?: string;
    readonly content: string;
    readonly contentType: string;
    readonly format?: 'markdown' | 'text';
    readonly bytesRead: number;
    readonly truncated: boolean;
    readonly redirects: number;
}
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_CONTENT_CHARACTERS = 20_000;
const MAX_REDIRECTS = 5;
const DEFAULT_READ_TIMEOUT_MS = 30_000;
const DOH_TIMEOUT_MS = 4_000;
const MAX_DOH_BYTES = 16 * 1024;
const DOH_ORIGIN = 'https://cloudflare-dns.com/dns-query';
const DOH_BOOTSTRAP: readonly LookupAddress[] = [{ address: '1.1.1.1', family: 4 }];
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const HIDDEN_TAGS = new Set(['script', 'style', 'nav', 'footer', 'noscript', 'template', 'svg', 'canvas', 'iframe']);
const FALLBACK_HIDDEN_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe']);
const BLOCK_TAGS = new Set(['address', 'article', 'aside', 'blockquote', 'br', 'dd', 'div', 'dl', 'dt', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'ol', 'p', 'pre', 'section', 'table', 'td', 'th', 'tr', 'ul']);
const SUPPORTED_CONTENT_TYPES = new Set([
    'text/html',
    'application/xhtml+xml',
    'text/plain',
    'text/markdown',
    'application/json',
    'application/ld+json',
    'text/json',
    'application/xml',
    'text/xml',
    'text/yaml',
    'application/x-yaml',
    'application/yaml',
    'text/csv'
]);

function isSupportedPublicContentType(contentType: string): boolean {
    return SUPPORTED_CONTENT_TYPES.has(contentType);
}

function publicAddress(address: string): boolean {
    if (!isIP(address)) return false;
    try {
        const parsed = ipaddr.process(address);
        if (parsed.range() !== 'unicast') return false;
        // Deprecated IPv4-compatible literals have no useful role in public retrieval.
        return parsed.kind() !== 'ipv6' || !parsed.toByteArray().slice(0, 12).every(byte => byte === 0);
    } catch { return false; }
}
function publicUrl(raw: unknown): URL {
    if (typeof raw !== 'string' || raw.length > 2048 || raw !== raw.trim() || /[\u0000-\u0020\u007f]/.test(raw)) {
        throw new AgentToolError('INVALID_INPUT', 'web.read_page requires a public HTTP(S) URL of at most 2,048 characters.');
    }
    let url: URL;
    try { url = new URL(raw); } catch { throw new AgentToolError('INVALID_INPUT', 'web.read_page requires a valid public HTTP(S) URL.'); }
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !hostname
        || /(?:^|\.)(?:localhost|local|internal|test|invalid|onion)$/.test(hostname)
        || (isIP(hostname) ? !publicAddress(hostname) : !hostname.includes('.'))) {
        throw new AgentToolError('PUBLIC_URL_REQUIRED', 'The page must use a public HTTP(S) address without embedded credentials.');
    }
    url.hash = '';
    return url;
}
function checkAbort(signal?: AbortSignal): void {
    if (signal?.aborted) throw new AgentToolError('CANCELLED', 'Public page reading was cancelled.');
}
async function abortable<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
    checkAbort(signal);
    if (!signal) return pending;
    return new Promise<T>((resolve, reject) => {
        const cancel = () => reject(new AgentToolError('CANCELLED', 'Public page reading was cancelled.'));
        signal.addEventListener('abort', cancel, { once: true });
        void pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
    });
}
async function resolvedAddresses(url: URL, options: PublicWebReaderOptions, signal?: AbortSignal): Promise<readonly LookupAddress[]> {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const literalFamily = isIP(host);
    let addresses: readonly LookupAddress[];
    try {
        addresses = literalFamily ? [{ address: host, family: literalFamily }] : await abortable(
            (options.lookupImpl ?? (hostname => lookup(hostname, { all: true, verbatim: true })))(host), signal);
    } catch (error) {
        if (error instanceof AgentToolError) throw error;
        throw new AgentToolError('PUBLIC_DNS_FAILED', 'The public page hostname could not be resolved.');
    }
    if (!literalFamily && allBenchmarkDnsAddresses(addresses)) {
        addresses = await trustedPublicDns(host, options, signal);
    }
    if (!addresses.length || addresses.length > 64 || addresses.some(entry => !publicAddress(entry.address) || isIP(entry.address) !== entry.family)) {
        throw new AgentToolError('PUBLIC_DNS_REQUIRED', 'The page hostname resolves to a private, reserved or invalid address.');
    }
    return addresses;
}

/** Public Client.connect extension: tunnel authority is pinned; the origin request Host and TLS SNI stay unchanged. */
class PinnedProxyClient extends Client {
    constructor(origin: URL, options: object, private readonly authority: string) { super(origin, options); }
    override connect(options: Omit<Dispatcher.ConnectOptions, 'origin'>): Promise<Dispatcher.ConnectData>;
    override connect(options: Omit<Dispatcher.ConnectOptions, 'origin'>, callback: (error: Error | null, data: Dispatcher.ConnectData) => void): void;
    override connect(options: Omit<Dispatcher.ConnectOptions, 'origin'>, callback?: (error: Error | null, data: Dispatcher.ConnectData) => void): Promise<Dispatcher.ConnectData> | void {
        // CONNECT's own Host must agree with its pinned authority. This does not
        // alter the source HTTP request that travels inside the tunnel.
        const headers = { ...options.headers } as Record<string, string | string[] | undefined>;
        for (const key of Object.keys(headers)) if (key.toLowerCase() === 'host') delete headers[key];
        headers.host = this.authority;
        const pinned = { ...options, path: this.authority, headers };
        return callback ? super.connect(pinned, callback) : super.connect(pinned);
    }
}
function pinnedDispatcher(url: URL, addresses: readonly LookupAddress[], route: PublicWebReaderNetworkRoute, verifyTls = false): Dispatcher {
    if (!route || !['direct', 'http_proxy'].includes(route.kind)) throw new AgentToolError('PUBLIC_PROXY_UNSUPPORTED', 'The configured proxy cannot safely pin the public page destination; use the browser fallback.');
    if (route.kind === 'http_proxy') {
        let proxy: URL;
        try { proxy = new URL(route.uri); } catch { throw new AgentToolError('PUBLIC_PROXY_UNSUPPORTED', 'The configured proxy address is invalid.'); }
        if (!['http:', 'https:'].includes(proxy.protocol)) throw new AgentToolError('PUBLIC_PROXY_UNSUPPORTED', 'This public page reader supports HTTP(S) CONNECT proxies; use the browser fallback for this proxy.');
        const address = addresses[0].address;
        const authority = `${isIP(address) === 6 ? `[${address}]` : address}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`;
        return new ProxyAgent({ uri: proxy.href, ...LIVE_UPSTREAM_TIMEOUTS, proxyTunnel: true,
            ...(verifyTls ? { requestTls: { rejectUnauthorized: true }, proxyTls: { rejectUnauthorized: true } } : {}),
            clientFactory: (origin, clientOptions) => new PinnedProxyClient(origin, clientOptions, authority) });
    }
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const pinnedLookup: LookupFunction = (hostname, lookupOptions, callback) => {
        if (hostname.replace(/^\[|\]$/g, '').toLowerCase() !== host) {
            callback(new Error('PUBLIC_DNS_PIN_MISMATCH'), '', 0); return;
        }
        const eligible = addresses.filter(entry => !lookupOptions.family || entry.family === lookupOptions.family);
        if (!eligible.length) { callback(new Error('PUBLIC_DNS_PIN_FAMILY'), '', 0); return; }
        if (lookupOptions.all) callback(null, [...eligible]);
        else callback(null, eligible[0].address, eligible[0].family);
    };
    return new Agent({ ...LIVE_UPSTREAM_TIMEOUTS, connect: { lookup: pinnedLookup, ...(verifyTls ? { rejectUnauthorized: true } : {}) } });
}

/** Media assets reuse the reader's public DNS pin and configured proxy policy.
 * Caller owns this dispatcher until its response body is consumed or cancelled. */
export async function publicHttpsAssetDispatcher(url: URL, options: PublicWebReaderOptions, signal: AbortSignal): Promise<Dispatcher> {
    // The existing page reader's 2 KiB page-URL limit is not a limit on signed media paths/queries.
    const checked = publicUrl(url.origin);
    if (url.href.length > 8_192 || url.username || url.password || url.hash || checked.protocol !== 'https:') {
        throw new AgentToolError('PUBLIC_URL_REQUIRED', 'Media assets require HTTPS.');
    }
    const addresses = await resolvedAddresses(checked, options, signal);
    const route = await abortable(options.resolveNetworkRoute(url), signal);
    return pinnedDispatcher(url, addresses, route, true);
}

async function dohJson(response: Response, signal: AbortSignal): Promise<unknown> {
    if (response.status !== 200 || response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/dns-json') {
        await response.body?.cancel().catch(() => undefined);
        throw new AgentToolError('PUBLIC_DNS_FAILED', 'Trusted public DNS did not return a DNS answer.');
    }
    const length = response.headers.get('content-length');
    if (length && /^\d+$/.test(length) && Number(length) > MAX_DOH_BYTES || !response.body) {
        await response.body?.cancel().catch(() => undefined);
        throw new AgentToolError('PUBLIC_DNS_FAILED', 'Trusted public DNS returned an oversized or empty answer.');
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let complete = false;
    try {
        for (;;) {
            const next = await abortable(reader.read(), signal);
            if (next.done) { complete = true; break; }
            total += next.value.byteLength;
            if (total > MAX_DOH_BYTES) throw new AgentToolError('PUBLIC_DNS_FAILED', 'Trusted public DNS returned an oversized answer.');
            chunks.push(next.value);
        }
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
        catch { throw new AgentToolError('PUBLIC_DNS_FAILED', 'Trusted public DNS returned an invalid answer.'); }
    } finally {
        if (!complete) await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
}

/** Resolve only an all-benchmark system result. Fixed public bootstrap prevents
 * fake-IP recursion; Host/SNI and ordinary TLS verification remain unchanged.
 * The existing network-route resolver owns proxy selection for this request. */
async function trustedPublicDns(host: string, options: PublicWebReaderOptions, signal?: AbortSignal): Promise<readonly LookupAddress[]> {
    checkAbort(signal);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) controller.abort();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, DOH_TIMEOUT_MS);
    const dispatchers: Dispatcher[] = [];
    try {
        // At most two DNS queries per logical lookup. Await both outcomes before
        // releasing the dispatcher; any invalid/private family rejects the read.
        const results = await Promise.allSettled(([1, 28] as const).map(async type => {
            const query = new URL(DOH_ORIGIN);
            query.searchParams.set('name', host);
            query.searchParams.set('type', String(type));
            query.searchParams.set('cd', 'false');
            let route: PublicWebReaderNetworkRoute;
            try { route = await abortable(options.resolveNetworkRoute(new URL(query.href)), controller.signal); }
            catch (error) {
                if (error instanceof AgentToolError) throw error;
                throw new AgentToolError('PUBLIC_NETWORK_ROUTE_FAILED', 'The configured DNS network route could not be prepared safely.');
            }
            const dispatcher = pinnedDispatcher(query, DOH_BOOTSTRAP, route);
            dispatchers.push(dispatcher);
            const pending = (options.fetchImpl ?? fetch)(query.href, {
                method: 'GET', redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal,
                headers: { accept: 'application/dns-json', 'user-agent': 'NextMux-Public-Reader/1.0' }, dispatcher
            } as RequestInit);
            // A transport may deliver headers concurrently with cancellation.
            // Dispose that late response even when abortable already rejected.
            void pending.then(response => { if (controller.signal.aborted) void response.body?.cancel().catch(() => undefined); }).catch(() => undefined);
            const response = await abortable(pending, controller.signal);
            return trustedDohAddresses(await dohJson(response, controller.signal), host, type, publicAddress);
        }));
        const failure = results.find(result => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
        const addresses = results.flatMap(result => result.status === 'fulfilled' ? [...result.value] : []);
        if (!addresses.length || addresses.length > 64) throw new AgentToolError('PUBLIC_DNS_REQUIRED', 'Trusted public DNS returned no usable public address.');
        return addresses;
    } catch (error) {
        checkAbort(signal);
        if (timedOut) throw new AgentToolError('PUBLIC_DNS_FAILED', 'Trusted public DNS did not finish within its reading time limit.');
        if (error instanceof AgentToolError) throw error;
        throw new AgentToolError('PUBLIC_DNS_FAILED', 'The public hostname could not be verified through the configured DNS network route.');
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        controller.abort();
        await Promise.allSettled(dispatchers.map(dispatcher => dispatcher.destroy()));
    }
}
async function boundedBody(response: Response, signal?: AbortSignal): Promise<{ text: string; bytesRead: number }> {
    const contentLength = response.headers.get('content-length');
    if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_RESPONSE_BYTES) {
        await response.body?.cancel().catch(() => undefined);
        throw new AgentToolError('PUBLIC_RESPONSE_TOO_LARGE', 'The public page exceeds the 2 MiB response limit.');
    }
    const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(response.headers.get('content-type') ?? '')?.[1] ?? 'utf-8';
    let decoder: TextDecoder;
    try { decoder = new TextDecoder(charset); } catch {
        await response.body?.cancel().catch(() => undefined);
        throw new AgentToolError('PUBLIC_CONTENT_ENCODING_UNSUPPORTED', 'The page declares an unsupported text encoding.');
    }
    if (!response.body) return { text: '', bytesRead: 0 };
    const reader = response.body.getReader();
    let bytesRead = 0, text = '';
    try {
        for (;;) {
            const chunk = await abortable(reader.read(), signal);
            if (chunk.done) break;
            bytesRead += chunk.value.byteLength;
            if (bytesRead > MAX_RESPONSE_BYTES) throw new AgentToolError('PUBLIC_RESPONSE_TOO_LARGE', 'The public page exceeds the 2 MiB response limit.');
            text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
        return { text, bytesRead };
    } catch (error) {
        await reader.cancel().catch(() => undefined);
        throw error;
    } finally { reader.releaseLock(); }
}
export function parseHtmlToMarkdown(html: string, hiddenTags: ReadonlySet<string> = HIDDEN_TAGS): { title?: string; content: string; truncated: boolean } {
    const stack: { tag: string; hidden: boolean }[] = [];
    let hidden = 0, inTitle = 0, inHead = 0, inPre = 0, inInlineCode = 0, inTable = 0, inTableCell = 0;
    let title = '', content = '', preBuffer = '', preLang = '', tableCellBuffer = '', truncated = false;
    let tableRow: string[] | undefined;
    let tableHasHeaderSeparator = false;
    let activeLink: { href: string; text: string } | undefined;

    const appendRaw = (raw: string) => {
        if (!raw) return;
        if (content.length + raw.length > MAX_CONTENT_CHARACTERS) truncated = true;
        content += raw.slice(0, Math.max(0, MAX_CONTENT_CHARACTERS - content.length));
    };
    const ensureLineStart = () => {
        if (content.length > 0 && !content.endsWith('\n')) appendRaw('\n');
    };
    const append = (text: string) => {
        const clean = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/[\t\r \f]+/g, ' ');
        const normalized = (!content || content.endsWith('\n')) ? clean.replace(/^ +/, '') : clean;
        appendRaw(normalized);
    };
    const writeInline = (token: string) => {
        if (activeLink) activeLink.text += token;
        else if (inTableCell > 0) tableCellBuffer += token;
        else appendRaw(token);
    };
    const flushActiveLink = () => {
        if (!activeLink) return;
        const link = activeLink;
        activeLink = undefined;
        const label = link.text.replace(/\s+/g, ' ').trim();
        const formatted = label && link.href && label !== link.href ? `[${label}](${link.href})` : label;
        if (formatted) {
            if (inTableCell > 0) tableCellBuffer += formatted;
            else appendRaw(formatted);
        }
    };

    const parser = new Parser({
        onopentag(tag, attrs) {
            const skip = hiddenTags.has(tag) || Object.prototype.hasOwnProperty.call(attrs, 'hidden') || attrs['aria-hidden'] === 'true'
                || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attrs.style ?? '');
            stack.push({ tag, hidden: skip });
            if (skip) hidden++;
            if (tag === 'head') inHead++;
            if (tag === 'title') inTitle++;
            if (hidden || inHead) return;
            if (tag === 'pre') {
                inPre++;
                if (inPre === 1) {
                    preBuffer = '';
                    preLang = /\b(?:language|lang)-([a-z0-9_+-]+)/i.exec(attrs.class ?? attrs['data-lang'] ?? '')?.[1]?.toLowerCase() ?? '';
                }
                return;
            }
            if (tag === 'code') {
                if (inPre > 0) {
                    if (!preLang) {
                        preLang = /\b(?:language|lang)-([a-z0-9_+-]+)/i.exec(attrs.class ?? attrs['data-lang'] ?? '')?.[1]?.toLowerCase() ?? '';
                    }
                } else {
                    inInlineCode++;
                    if (inInlineCode === 1) writeInline('`');
                }
                return;
            }
            if (inPre > 0) return;
            if (tag === 'a') {
                flushActiveLink();
                const rawHref = (attrs.href ?? '').trim();
                const validHref = rawHref && !/^(?:javascript|data|vbscript):/i.test(rawHref) && rawHref !== '#' ? rawHref : '';
                activeLink = { href: validHref, text: '' };
                return;
            }
            if (tag === 'table') {
                inTable++;
                if (inTable === 1) tableHasHeaderSeparator = false;
                ensureLineStart();
                return;
            }
            if (tag === 'tr' && inTable > 0) {
                tableRow = [];
                return;
            }
            if ((tag === 'th' || tag === 'td') && inTable > 0 && tableRow !== undefined) {
                inTableCell++;
                if (inTableCell === 1) tableCellBuffer = '';
                return;
            }
            if (inTableCell > 0) return;
            if (/^h[1-6]$/.test(tag)) {
                ensureLineStart();
                appendRaw(`${'#'.repeat(Number(tag[1]))} `);
                return;
            }
            if (tag === 'li') {
                ensureLineStart();
                appendRaw('- ');
                return;
            }
            if (BLOCK_TAGS.has(tag)) appendRaw('\n');
        },
        ontext(text) {
            if (inTitle && !hidden) {
                title += text.slice(0, Math.max(0, 500 - title.length));
                return;
            }
            if (hidden || inHead) return;
            if (inPre > 0) {
                preBuffer += text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
                return;
            }
            const clean = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/[\t\r\n \f]+/g, ' ');
            if (activeLink) activeLink.text += clean;
            else if (inTableCell > 0) tableCellBuffer += clean;
            else append(text);
        },
        onclosetag(tag) {
            const wasHidden = hidden > 0 || inHead > 0;
            let matchIdx = -1;
            for (let i = stack.length - 1; i >= 0; i--) {
                if (stack[i].tag === tag) {
                    matchIdx = i;
                    break;
                }
            }
            if (matchIdx >= 0) {
                const popped = stack.splice(matchIdx);
                for (const frame of popped) {
                    if (frame.hidden) hidden = Math.max(0, hidden - 1);
                }
            }
            if (tag === 'title') inTitle = Math.max(0, inTitle - 1);
            if (tag === 'head') inHead = Math.max(0, inHead - 1);
            if (wasHidden || hidden || inHead) return;
            if (tag === 'pre' && inPre > 0) {
                inPre--;
                if (inPre === 0) {
                    const codeText = preBuffer.replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '');
                    ensureLineStart();
                    appendRaw(`\`\`\`${preLang}\n${codeText}\n\`\`\`\n`);
                    preBuffer = '';
                    preLang = '';
                }
                return;
            }
            if (tag === 'code') {
                if (inPre === 0 && inInlineCode > 0) {
                    if (inInlineCode === 1) writeInline('`');
                    inInlineCode--;
                }
                return;
            }
            if (inPre > 0) return;
            if (tag === 'a') {
                flushActiveLink();
                return;
            }
            if ((tag === 'th' || tag === 'td') && inTable > 0 && inTableCell > 0) {
                flushActiveLink();
                inTableCell--;
                if (inTableCell === 0 && tableRow !== undefined) {
                    tableRow.push(tableCellBuffer.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim());
                    tableCellBuffer = '';
                }
                return;
            }
            if (tag === 'tr' && inTable > 0 && tableRow !== undefined) {
                flushActiveLink();
                if (tableRow.some(Boolean)) {
                    ensureLineStart();
                    appendRaw(`| ${tableRow.join(' | ')} |\n`);
                    if (!tableHasHeaderSeparator) {
                        appendRaw(`| ${tableRow.map(() => '---').join(' | ')} |\n`);
                        tableHasHeaderSeparator = true;
                    }
                }
                tableRow = undefined;
                return;
            }
            if (tag === 'table' && inTable > 0) {
                flushActiveLink();
                inTable--;
                appendRaw('\n');
                return;
            }
            if (inTableCell > 0) return;
            if (/^h[1-6]$/.test(tag) || tag === 'li' || BLOCK_TAGS.has(tag)) {
                flushActiveLink();
                appendRaw('\n');
            }
        }
    }, { decodeEntities: true, lowerCaseTags: true });
    parser.end(html);
    flushActiveLink();
    const cleanTitle = title.replace(/\s+/g, ' ').trim();
    return { ...(cleanTitle ? { title: cleanTitle } : {}), content: content.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), truncated };
}

export function pageText(html: string): { title?: string; content: string; truncated: boolean } {
    const primary = parseHtmlToMarkdown(html, HIDDEN_TAGS);
    if (primary.content || !/<(?:nav|footer)\b/i.test(html)) return primary;
    return parseHtmlToMarkdown(html, FALLBACK_HIDDEN_TAGS);
}

function formatStructuredTextContent(rawText: string, contentType: string): { content: string; truncated: boolean } {
    const clean = rawText.replace(/\u0000/g, '');
    if (contentType === 'application/json' || contentType === 'application/ld+json' || contentType === 'text/json') {
        try {
            const formatted = JSON.stringify(JSON.parse(clean), null, 2);
            return {
                content: formatted.slice(0, MAX_CONTENT_CHARACTERS).trim(),
                truncated: formatted.length > MAX_CONTENT_CHARACTERS
            };
        } catch {
            // Fall through to raw UTF-8 text when JSON is malformed.
        }
    }
    return {
        content: clean.slice(0, MAX_CONTENT_CHARACTERS).trim(),
        truncated: clean.length > MAX_CONTENT_CHARACTERS
    };
}

/** Client-only source reading; no model call, credentials, cookies, browser, search provider or persistence. */
async function readPageWithinDeadline(options: PublicWebReaderOptions & { readonly url: string; readonly signal: AbortSignal }): Promise<PublicWebPage> {
    const original = publicUrl(options.url);
    let current = original;
    const visited = new Set<string>();
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
        checkAbort(options.signal);
        if (visited.has(current.href)) throw new AgentToolError('PUBLIC_REDIRECT_LOOP', 'The public page redirects in a loop.');
        visited.add(current.href);
        const addresses = await resolvedAddresses(current, options, options.signal);
        let dispatcher: Dispatcher;
        try {
            const route = await abortable(options.resolveNetworkRoute(new URL(current.href)), options.signal);
            dispatcher = pinnedDispatcher(current, addresses, route);
        } catch (error) {
            if (error instanceof AgentToolError) throw error;
            throw new AgentToolError('PUBLIC_NETWORK_ROUTE_FAILED', 'The configured network route could not be prepared safely.');
        }
        try {
            const response = await abortable((options.fetchImpl ?? fetch)(current.href, { method: 'GET', redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer', signal: options.signal,
                headers: { accept: 'text/html,application/xhtml+xml,text/plain,text/markdown;q=0.9', 'user-agent': 'NextMux-Public-Reader/1.0' }, dispatcher } as RequestInit), options.signal);
            if (REDIRECT_STATUSES.has(response.status)) {
                await response.body?.cancel().catch(() => undefined);
                const location = response.headers.get('location');
                if (!location) throw new AgentToolError('PUBLIC_REDIRECT_INVALID', 'The page returned a redirect without a destination.');
                if (redirects === MAX_REDIRECTS) throw new AgentToolError('PUBLIC_REDIRECT_LIMIT', 'The page exceeds the five-redirect limit.');
                let next: string;
                try { next = new URL(location, current).href; } catch { throw new AgentToolError('PUBLIC_REDIRECT_INVALID', 'The page returned an invalid redirect destination.'); }
                current = publicUrl(next);
                continue;
            }
            if (!response.ok) {
                await response.body?.cancel().catch(() => undefined);
                throw new AgentToolError('PUBLIC_HTTP_FAILED', `The public page returned HTTP ${response.status}.`);
            }
            const contentType = (response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
            if (!isSupportedPublicContentType(contentType)) {
                await response.body?.cancel().catch(() => undefined);
                throw new AgentToolError('PUBLIC_CONTENT_TYPE_UNSUPPORTED', 'The public source is not an HTML or plain-text page.');
            }
            const body = await boundedBody(response, options.signal);
            const isHtml = contentType === 'text/html' || contentType === 'application/xhtml+xml';
            const extracted = isHtml ? pageText(body.text)
                : formatStructuredTextContent(body.text, contentType);
            const format = isHtml || contentType === 'text/markdown' || contentType === 'text/x-markdown' ? 'markdown' as const : 'text' as const;
            return { source: 'public_http', sourceContentIsUntrusted: true, url: original.href, finalUrl: current.href, ...extracted, contentType, format, bytesRead: body.bytesRead, redirects };
        } catch (error) {
            if (error instanceof AgentToolError) throw error;
            checkAbort(options.signal);
            throw new AgentToolError('PUBLIC_NETWORK_FAILED', 'The public page could not be read through the configured network route; use the browser fallback if needed.');
        } finally { await dispatcher.destroy().catch(() => undefined); }
    }
    throw new AgentToolError('PUBLIC_REDIRECT_LIMIT', 'The page exceeds the five-redirect limit.');
}

/** A stalled source cannot keep the task from proceeding to its browser fallback. */
export async function readPublicWebPage(options: PublicWebReaderOptions & { readonly url: string; readonly signal?: AbortSignal }): Promise<PublicWebPage> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new AgentToolError('INVALID_INPUT', 'The page-read time limit must be between 1 and 120,000 milliseconds.');
    checkAbort(options.signal);
    const controller = new AbortController();
    let timedOut = false;
    const onCancel = () => controller.abort();
    options.signal?.addEventListener('abort', onCancel, { once: true });
    if (options.signal?.aborted) controller.abort();
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try { return await readPageWithinDeadline({ ...options, signal: controller.signal }); }
    catch (error) {
        if (timedOut) throw new AgentToolError('PUBLIC_READ_TIMEOUT', 'The public page did not finish within its reading time limit; use the browser fallback if needed.');
        throw error;
    } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onCancel);
    }
}

export function registerPublicWebReaderTool(registry: AgentToolRegistry, options: PublicWebReaderOptions): void {
    registry.register({ name: 'web.read_page', source: 'builtin', requiredPermission: 'read_only', executionKind: 'read', concurrencySafe: true,
        description: 'Read a public HTTP(S) source URL directly from this computer through its configured network route, with a 30-second page-read limit. Works independently of model-native web tools. No search key, model request, cookies or credentials. Returns up to 20,000 characters of untrusted page text and source URLs; no desktop browser tabs or private networks. Page text is sent to the selected model as ordinary tool context.',
        inputSchema: { type: 'object', additionalProperties: false, required: ['url'], properties: { url: { type: 'string', minLength: 8, maxLength: 2048 } } }
    }, async (input, context): Promise<ToolHandlerResult> => {
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'url')) throw new AgentToolError('INVALID_INPUT', 'web.read_page accepts only a public source URL.');
        const url = (input as { url?: unknown }).url;
        const valid = publicUrl(url);
        const page = await readPublicWebPage({ ...options, url: valid.href, signal: context.signal });
        return { modelOutput: { ...page, status: !page.content ? 'no_content' : page.truncated ? 'partial' : 'ok', sources: [{ url: page.finalUrl, ...(page.title ? { title: page.title } : {}) }] },
            summary: { kind: 'web.read_page', title: page.title ?? valid.hostname, params: { source: 'public_http', characters: page.content.length, truncated: page.truncated } } };
    });
}
