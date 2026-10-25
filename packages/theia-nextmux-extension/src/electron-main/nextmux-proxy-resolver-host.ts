import { randomBytes } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { createServer, type Server, type Socket } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ProxyResolveRequest, ProxyResolveResponse } from '../common/nextmux-proxy-resolver-protocol';

export interface ProxyResolverHost {
    readonly path: string;
    readonly token: string;
    close(): void;
}

/**
 * Serve Chromium's proxy resolution (PAC, WPAD, SOCKS, system settings) to the
 * forked backend. `resolve` is `session.defaultSession.resolveProxy`.
 * Only a caller that knows the per-launch random token gets an answer; the
 * Unix socket lives in a private 0700 directory.
 */
export function startProxyResolverHost(resolve: (url: string) => Promise<string>, platform = process.platform): Promise<ProxyResolverHost> {
    const token = randomBytes(24).toString('hex');
    const directory = platform === 'win32' ? '' : mkdtempSync(join(tmpdir(), 'nextmux-proxy-'));
    const path = platform === 'win32' ? `\\\\.\\pipe\\nextmux-proxy-${randomBytes(12).toString('hex')}` : join(directory, 'resolver.sock');
    const server: Server = createServer((socket: Socket) => {
        let buffer = '';
        socket.setEncoding('utf8');
        socket.setTimeout(10_000, () => socket.destroy());
        socket.on('error', () => undefined);
        socket.on('data', chunk => {
            buffer += chunk;
            if (buffer.length > 16_384) { socket.destroy(); return; }
            let newline = buffer.indexOf('\n');
            while (newline >= 0) {
                const line = buffer.slice(0, newline);
                buffer = buffer.slice(newline + 1);
                newline = buffer.indexOf('\n');
                void answer(line).then(response => { if (!socket.destroyed) socket.write(`${JSON.stringify(response)}\n`); });
            }
        });
    });
    const answer = async (line: string): Promise<ProxyResolveResponse> => {
        let request: Partial<ProxyResolveRequest>;
        try { request = JSON.parse(line); } catch { return { error: 'INVALID_REQUEST' }; }
        if (request.token !== token) return { error: 'UNAUTHORIZED' };
        let url: URL;
        try { url = new URL(String(request.url)); } catch { return { error: 'INVALID_URL' }; }
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return { error: 'INVALID_URL' };
        try { return { proxy: String(await resolve(url.href)) }; } catch { return { error: 'RESOLVE_FAILED' }; }
    };
    return new Promise((resolveHost, reject) => {
        server.once('error', reject);
        server.listen(path, () => {
            server.off('error', reject);
            server.unref();
            resolveHost({
                path, token,
                close: () => {
                    server.close();
                    if (directory) rmSync(directory, { recursive: true, force: true });
                }
            });
        });
    });
}
