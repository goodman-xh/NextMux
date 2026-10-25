import type { PublicWebReaderNetworkRoute } from './nextmux-public-web-reader';
import type { ProxyChoice } from './nextmux-system-proxy';

export interface PublicWebProxyFallback {
    readonly httpProxy?: string;
    readonly httpsProxy?: string;
    readonly noProxy?: string;
}

/** Match Undici's environment-proxy host, suffix and optional port semantics. */
export function publicWebProxyBypassed(url: URL, noProxy: string | undefined): boolean {
    if (noProxy === '*') return true;
    const hostname = url.hostname.toLowerCase();
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
    return (noProxy || '').split(/[,\s]/).some(raw => {
        if (!raw) return false;
        const parsed = /^(.+):(\d+)$/.exec(raw);
        const host = (parsed ? parsed[1] : raw).replace(/^\*?\./, '').toLowerCase();
        if (parsed && Number(parsed[2]) !== port) return false;
        return hostname === host || hostname.endsWith(`.${host}`);
    });
}

export function publicWebFallbackRoute(url: URL, fallback: PublicWebProxyFallback): PublicWebReaderNetworkRoute {
    if (publicWebProxyBypassed(url, fallback.noProxy)) return { kind: 'direct' };
    const uri = url.protocol === 'https:' ? fallback.httpsProxy || fallback.httpProxy : fallback.httpProxy;
    if (!uri) return { kind: 'direct' };
    try {
        const protocol = new URL(uri).protocol;
        return protocol === 'http:' || protocol === 'https:' ? { kind: 'http_proxy', uri }
            : { kind: 'unsupported', reason: 'proxy_protocol' };
    } catch { return { kind: 'unsupported', reason: 'proxy_address' }; }
}

export function publicWebSystemRoute(choice: ProxyChoice): PublicWebReaderNetworkRoute {
    if (choice.kind === 'direct') return { kind: 'direct' };
    if (choice.kind === 'socks5') return { kind: 'unsupported', reason: 'proxy_protocol' };
    const host = choice.host.includes(':') && !choice.host.startsWith('[') ? `[${choice.host}]` : choice.host;
    return { kind: 'http_proxy', uri: `${choice.kind}://${host}:${choice.port}` };
}
