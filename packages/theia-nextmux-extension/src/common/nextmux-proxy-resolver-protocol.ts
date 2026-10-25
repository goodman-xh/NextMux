/**
 * Electron main ↔ Node backend proxy resolution.
 *
 * The backend is a forked Node process and cannot call Chromium's proxy
 * resolver. The Electron main process serves `session.resolveProxy(url)` on a
 * private local socket (named pipe on Windows) and passes its address and a
 * random token to the backend through the fork environment. Requests and
 * responses are single-line JSON.
 */
export const NEXTMUX_PROXY_RESOLVER_PATH_ENV = 'NEXTMUX_PROXY_RESOLVER_PATH';
export const NEXTMUX_PROXY_RESOLVER_TOKEN_ENV = 'NEXTMUX_PROXY_RESOLVER_TOKEN';

export interface ProxyResolveRequest {
    readonly token: string;
    readonly url: string;
}

export interface ProxyResolveResponse {
    /** Chromium PAC-style result, e.g. `PROXY host:8080; SOCKS5 host:1080; DIRECT`. */
    readonly proxy?: string;
    readonly error?: string;
}
