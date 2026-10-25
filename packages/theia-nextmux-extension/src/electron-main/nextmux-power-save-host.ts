import { randomBytes } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { createServer, type Socket } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';

export interface AppSuspensionBlocker {
    start(type: 'prevent-app-suspension'): number;
    stop(id: number): void;
}

export interface PowerSaveHost {
    readonly path: string;
    readonly token: string;
    close(): void;
}

/**
 * Use the same authenticated local-socket channel as the Chromium proxy resolver.
 * Each connected backend lease owns one reference. A backend crash closes its
 * sockets, releasing its references without clocks or renderer participation.
 * Electron owns the OS assertion, so a main-process crash releases it too.
 */
export function startPowerSaveHost(blocker: AppSuspensionBlocker, platform = process.platform): Promise<PowerSaveHost> {
    const token = randomBytes(24).toString('hex');
    const directory = platform === 'win32' ? '' : mkdtempSync(join(tmpdir(), 'nextmux-power-'));
    const path = platform === 'win32' ? `\\\\.\\pipe\\nextmux-power-${randomBytes(12).toString('hex')}` : join(directory, 'power.sock');
    const sockets = new Set<Socket>();
    const leases = new Set<Socket>();
    let blockerId: number | undefined;
    let closed = false;
    const release = (socket: Socket): void => {
        leases.delete(socket);
        if (!leases.size && blockerId !== undefined) {
            const id = blockerId;
            blockerId = undefined;
            blocker.stop(id);
        }
    };
    const server = createServer(socket => {
        sockets.add(socket);
        let buffer = '';
        let authenticated = false;
        socket.setEncoding('utf8');
        socket.on('error', () => undefined);
        socket.on('end', () => { release(socket); socket.end(); });
        socket.on('close', () => { sockets.delete(socket); release(socket); });
        socket.on('data', chunk => {
            if (authenticated || closed) { socket.destroy(); return; }
            buffer += chunk;
            if (buffer.length > 4096) { socket.destroy(); return; }
            const newline = buffer.indexOf('\n');
            if (newline < 0) return;
            try {
                const request = JSON.parse(buffer.slice(0, newline));
                if (request?.token !== token || buffer.slice(newline + 1)) { socket.destroy(); return; }
                if (blockerId === undefined) blockerId = blocker.start('prevent-app-suspension');
                leases.add(socket);
                authenticated = true;
                socket.write('{"ok":true}\n');
            } catch { socket.destroy(); }
        });
    });
    return new Promise((resolve, reject) => {
        server.once('error', error => {
            if (directory) rmSync(directory, { recursive: true, force: true });
            reject(error);
        });
        server.listen(path, () => {
            server.unref();
            resolve({ path, token, close: () => {
                if (closed) return;
                closed = true;
                for (const socket of sockets) { release(socket); socket.destroy(); }
                sockets.clear();
                server.close();
                if (directory) rmSync(directory, { recursive: true, force: true });
            } });
        });
    });
}
