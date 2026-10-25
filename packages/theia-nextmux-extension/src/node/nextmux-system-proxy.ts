import { connect } from 'net';
import * as tls from 'tls';
import { Agent, Dispatcher, ProxyAgent, Socks5ProxyAgent } from 'undici';
import {
    NEXTMUX_PROXY_RESOLVER_PATH_ENV, NEXTMUX_PROXY_RESOLVER_TOKEN_ENV,
    type ProxyResolveResponse
} from '../common/nextmux-proxy-resolver-protocol';

/**
 * "Follow the system proxy" for the Node backend, the same way Chromium does.
 *
 * Proxy selection is delegated per origin to Electron's `session.resolveProxy`
 * (PAC/WPAD/system/SOCKS; see nextmux-proxy-resolver-host.ts). Its PAC-style
 * result is mapped to undici dispatchers: `PROXY`/`HTTPS` → ProxyAgent,
 * `SOCKS5`/`SOCKS` → Socks5ProxyAgent, `DIRECT` → Agent. `SOCKS4` is not
 * supported by undici and is skipped in favor of the next entry. Like
 * VS Code's `http.proxySupport` default, results are cached per origin for a
 * short time. Loopback traffic is always direct.
 */

/**
 * Waiting on an upstream has no clock. undici defaults to 300 s before headers and between body chunks, which cuts off
 * a model that thinks quietly, a relay that holds headers until the first token, or a local model still loading. A
 * dead peer is still detected: undici enables TCP keepalive on every socket (probes after 60 s idle), so only an
 * online server can hold a request open, and the user's stop ends it at any time.
 */
export const LIVE_UPSTREAM_TIMEOUTS = { headersTimeout: 0, bodyTimeout: 0 } as const;

/** Per-request form, for dispatchers whose pools do not take the constructor option (SOCKS5). Explicit values win. */
export function withLiveUpstream(options: Dispatcher.DispatchOptions): Dispatcher.DispatchOptions {
    return { ...LIVE_UPSTREAM_TIMEOUTS, ...options };
}

export type ProxyChoice =
    | { readonly kind: 'direct' }
    | { readonly kind: 'http' | 'https' | 'socks5'; readonly host: string; readonly port: number };

/** Parse a Chromium/PAC result such as `PROXY a:8080; SOCKS5 b:1080; DIRECT`. */
export function parseProxyResolution(result: string | undefined): ProxyChoice[] {
    const choices: ProxyChoice[] = [];
    for (const entry of String(result || '').split(';')) {
        const [rawType, rawAddress] = entry.trim().split(/\s+/, 2);
        const type = (rawType || '').toUpperCase();
        if (type === 'DIRECT') { choices.push({ kind: 'direct' }); continue; }
        const kind = type === 'PROXY' || type === 'HTTP' ? 'http' : type === 'HTTPS' ? 'https' : type === 'SOCKS5' || type === 'SOCKS' ? 'socks5' : undefined;
        if (!kind || !rawAddress) continue;
        const match = /^(\[[^\]]+\]|[^:]+):(\d{1,5})$/.exec(rawAddress);
        const port = match ? Number(match[2]) : 0;
        if (!match || port < 1 || port > 65_535) continue;
        choices.push({ kind, host: match[1], port });
    }
    return choices;
}

/** The first choice undici can serve; an empty or unsupported result means DIRECT. */
export function preferredProxyChoice(result: string | undefined): ProxyChoice {
    return parseProxyResolution(result)[0] || { kind: 'direct' };
}

export function isLoopbackHost(hostname: string): boolean {
    const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\./.test(host);
}

export type ProxyResolver = (url: string) => Promise<string | undefined>;

let resolverEnvironment: NodeJS.ProcessEnv | undefined;

/** Read the resolver address once and keep it out of child processes (terminals, MCP servers). */
function takeResolverEnvironment(): NodeJS.ProcessEnv {
    if (!resolverEnvironment) {
        resolverEnvironment = {
            [NEXTMUX_PROXY_RESOLVER_PATH_ENV]: process.env[NEXTMUX_PROXY_RESOLVER_PATH_ENV],
            [NEXTMUX_PROXY_RESOLVER_TOKEN_ENV]: process.env[NEXTMUX_PROXY_RESOLVER_TOKEN_ENV]
        };
        delete process.env[NEXTMUX_PROXY_RESOLVER_PATH_ENV];
        delete process.env[NEXTMUX_PROXY_RESOLVER_TOKEN_ENV];
    }
    return resolverEnvironment;
}

/** Client for the Electron main-process resolver; `undefined` outside Electron. */
export function electronProxyResolver(env: NodeJS.ProcessEnv = takeResolverEnvironment(), timeoutMs = 2_000): ProxyResolver | undefined {
    const path = env[NEXTMUX_PROXY_RESOLVER_PATH_ENV];
    const token = env[NEXTMUX_PROXY_RESOLVER_TOKEN_ENV];
    if (!path || !token) return undefined;
    return url => new Promise(resolve => {
        let settled = false, buffer = '';
        const finish = (value: string | undefined) => { if (settled) return; settled = true; socket.destroy(); resolve(value); };
        const socket = connect(path);
        socket.setEncoding('utf8');
        socket.setTimeout(timeoutMs, () => finish(undefined));
        socket.on('error', () => finish(undefined));
        socket.on('connect', () => socket.write(`${JSON.stringify({ token, url })}\n`));
        socket.on('data', chunk => {
            buffer += chunk;
            const newline = buffer.indexOf('\n');
            if (newline < 0) { if (buffer.length > 16_384) finish(undefined); return; }
            try {
                const response = JSON.parse(buffer.slice(0, newline)) as ProxyResolveResponse;
                finish(typeof response.proxy === 'string' ? response.proxy : undefined);
            } catch { finish(undefined); }
        });
    });
}

type DispatchHandler = Parameters<Dispatcher['dispatch']>[1];

/**
 * An undici dispatcher that asks the resolver which route an origin should
 * take and delegates to a shared direct/proxy agent. Resolution failures fall
 * back to `fallback` (environment/OS settings) rather than failing requests.
 */
export class SystemProxyDispatcher extends Dispatcher {
    protected readonly direct = new Agent(LIVE_UPSTREAM_TIMEOUTS);
    protected readonly proxies = new Map<string, Dispatcher>();
    protected readonly routes = new Map<string, { readonly expires: number; readonly route: Promise<Dispatcher> }>();

    constructor(protected readonly resolver: ProxyResolver, protected readonly fallback: Dispatcher, protected readonly ttlMs = 60_000, protected readonly now = () => Date.now()) {
        super();
    }

    /** Exposed for diagnostics and tests. */
    async choiceFor(origin: string): Promise<ProxyChoice> {
        let url: URL;
        try { url = new URL(origin); } catch { return { kind: 'direct' }; }
        if (isLoopbackHost(url.hostname)) return { kind: 'direct' };
        const result = await this.resolver(`${url.protocol}//${url.host}/`);
        if (result === undefined) throw new Error('PROXY_RESOLVE_UNAVAILABLE');
        // A PAC answer is an ordered list (“PROXY a; PROXY b; DIRECT”): a proxy that cannot be reached gives way to
        // the next choice, as browsers do, instead of failing every request (audit A15-04).
        const choices = parseProxyResolution(result);
        if (choices.length <= 1) return choices[0] || { kind: 'direct' };
        for (const choice of choices) {
            if (choice.kind === 'direct' || await this.reachable(choice.host, choice.port)) return choice;
        }
        return choices[0];
    }

    /** Whether a proxy accepts a TCP connection within a short time. */
    protected reachable(host: string, port: number, timeoutMs = 1_500): Promise<boolean> {
        return new Promise(resolve => {
            const socket = connect({ host: host.replace(/^\[|\]$/g, ''), port });
            const done = (value: boolean) => { socket.destroy(); resolve(value); };
            socket.setTimeout(timeoutMs, () => done(false));
            socket.once('connect', () => done(true));
            socket.once('error', () => done(false));
        });
    }

    protected dispatcherFor(choice: ProxyChoice): Dispatcher {
        if (choice.kind === 'direct') return this.direct;
        const host = choice.host.includes(':') && !choice.host.startsWith('[') ? `[${choice.host}]` : choice.host;
        const key = `${choice.kind}://${host}:${choice.port}`;
        let dispatcher = this.proxies.get(key);
        if (!dispatcher) {
            dispatcher = choice.kind === 'socks5' ? new Socks5ProxyAgent(key) : new ProxyAgent({ uri: key, ...LIVE_UPSTREAM_TIMEOUTS });
            this.proxies.set(key, dispatcher);
        }
        return dispatcher;
    }

    route(origin: string): Promise<Dispatcher> {
        const now = this.now();
        const cached = this.routes.get(origin);
        if (cached && cached.expires > now) return cached.route;
        const route = this.choiceFor(origin).then(choice => this.dispatcherFor(choice), () => {
            // Do not keep a failed lookup: retry on the next request.
            this.routes.delete(origin);
            return this.fallback;
        });
        if (this.routes.size >= 512) this.routes.delete(this.routes.keys().next().value!);
        this.routes.set(origin, { expires: now + this.ttlMs, route });
        return route;
    }

    override dispatch(options: Dispatcher.DispatchOptions, handler: DispatchHandler): boolean {
        const origin = String(options.origin || '');
        void this.route(origin).then(dispatcher => dispatcher.dispatch(withLiveUpstream(options), handler)).catch(error => {
            const target = handler as unknown as { onResponseError?: (controller: unknown, error: Error) => void; onError?: (error: Error) => void };
            if (target.onResponseError) target.onResponseError(undefined, error as Error);
            else target.onError?.(error as Error);
        });
        return true;
    }

    override async close(): Promise<void> {
        await Promise.allSettled([this.direct.close(), ...[...this.proxies.values()].map(proxy => proxy.close())]);
    }

    override async destroy(): Promise<void> {
        await Promise.allSettled([this.direct.destroy(), ...[...this.proxies.values()].map(proxy => proxy.destroy())]);
    }
}

let systemCertificatesTrusted: boolean | undefined;

/**
 * Trust the operating system's certificate store in addition to Node's
 * bundled roots, so corporate TLS-inspection CAs installed on the machine work
 * like they do in Chromium. Verification itself always stays on.
 * Requires `tls.getCACertificates`/`tls.setDefaultCACertificates` (Node ≥ 22.15 / 23.5).
 */
export function trustSystemCertificates(api: {
    getCACertificates?: (type?: 'default' | 'system' | 'bundled' | 'extra') => string[];
    setDefaultCACertificates?: (certificates: string[]) => void;
} = tls as never): boolean {
    if (systemCertificatesTrusted !== undefined && api === (tls as never)) return systemCertificatesTrusted;
    let trusted = false;
    if (typeof api.getCACertificates === 'function' && typeof api.setDefaultCACertificates === 'function') {
        try {
            const system = api.getCACertificates('system');
            if (system.length) {
                api.setDefaultCACertificates([...new Set([...api.getCACertificates('default'), ...system])]);
                trusted = true;
            }
        } catch { trusted = false; }
    }
    if (api === (tls as never)) systemCertificatesTrusted = trusted;
    return trusted;
}
