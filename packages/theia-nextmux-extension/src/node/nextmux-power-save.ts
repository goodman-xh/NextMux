import { connect } from 'net';
import { NEXTMUX_POWER_SAVE_PATH_ENV, NEXTMUX_POWER_SAVE_TOKEN_ENV } from '../common/nextmux-power-save-protocol';

export type PowerSaveRelease = () => Promise<void>;
const noPowerSaveLease: PowerSaveRelease = async () => undefined;
let powerSaveEnvironment: NodeJS.ProcessEnv | undefined;

/** Consume launch credentials once so shells, MCP servers and other children do not inherit them. */
function takePowerSaveEnvironment(): NodeJS.ProcessEnv {
    if (!powerSaveEnvironment) {
        powerSaveEnvironment = {
            [NEXTMUX_POWER_SAVE_PATH_ENV]: process.env[NEXTMUX_POWER_SAVE_PATH_ENV],
            [NEXTMUX_POWER_SAVE_TOKEN_ENV]: process.env[NEXTMUX_POWER_SAVE_TOKEN_ENV]
        };
        delete process.env[NEXTMUX_POWER_SAVE_PATH_ENV];
        delete process.env[NEXTMUX_POWER_SAVE_TOKEN_ENV];
    }
    return powerSaveEnvironment;
}

// Consume the private launch environment before any backend task can spawn children.
const desktopPowerSaveEnvironment = takePowerSaveEnvironment();

/** A lease has no deadline. Work outside Electron and unavailable hosts remain usable. `signal` drops a pending handshake. */
export function acquireDesktopPowerSaveBlocker(env: NodeJS.ProcessEnv = desktopPowerSaveEnvironment, signal?: AbortSignal): Promise<PowerSaveRelease> {
    const path = env[NEXTMUX_POWER_SAVE_PATH_ENV];
    const token = env[NEXTMUX_POWER_SAVE_TOKEN_ENV];
    if (!path || !token || signal?.aborted) return Promise.resolve(noPowerSaveLease);
    return new Promise(resolve => {
        const socket = connect(path);
        let buffer = '';
        let settled = false;
        let releasePromise: Promise<void> | undefined;
        const unavailable = (): void => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve(noPowerSaveLease);
        };
        signal?.addEventListener('abort', () => { if (!settled) unavailable(); }, { once: true });
        socket.setEncoding('utf8');
        socket.once('connect', () => socket.write(`${JSON.stringify({ token })}\n`));
        socket.on('error', unavailable);
        socket.once('close', unavailable);
        socket.on('data', chunk => {
            if (settled) return;
            buffer += chunk;
            if (buffer.length > 4096) { unavailable(); return; }
            const newline = buffer.indexOf('\n');
            if (newline < 0) return;
            try {
                if (JSON.parse(buffer.slice(0, newline))?.ok !== true) { unavailable(); return; }
                settled = true;
                // Keeping this socket open is the lease. FIN, cancellation cleanup,
                // process exit and crashes all release it in Electron main.
                resolve(() => releasePromise ??= new Promise<void>(released => {
                    if (socket.destroyed) { released(); return; }
                    socket.once('close', () => released());
                    socket.end();
                }));
            } catch { unavailable(); }
        });
    });
}

/**
 * Hold the lease around long work without ever delaying that work on Electron main: the local handshake normally
 * answers in milliseconds, and after at most two seconds the work starts anyway while the lease keeps connecting.
 * This bounds only a local IPC wait; nothing here limits how long the work itself runs.
 */
export async function holdDesktopPowerSave(env: NodeJS.ProcessEnv = desktopPowerSaveEnvironment): Promise<PowerSaveRelease> {
    if (!powerSaveHostConfigured(env)) return noPowerSaveLease;
    const pending = new AbortController();
    const lease = acquireDesktopPowerSaveBlocker(env, pending.signal);
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([lease, new Promise<void>(resolve => { timer = setTimeout(resolve, 2_000); timer.unref?.(); })]);
    clearTimeout(timer);
    let released: Promise<void> | undefined;
    return () => released ??= (pending.abort(), lease.then(release => release()));
}

function powerSaveHostConfigured(env: NodeJS.ProcessEnv): boolean {
    return Boolean(env[NEXTMUX_POWER_SAVE_PATH_ENV] && env[NEXTMUX_POWER_SAVE_TOKEN_ENV]);
}

export async function withDesktopPowerSaveBlocker<T>(operation: () => Promise<T>, env: NodeJS.ProcessEnv = desktopPowerSaveEnvironment): Promise<T> {
    // Outside Electron (tests, CLI) there is nothing to hold: start the work without an extra asynchronous hop.
    if (!powerSaveHostConfigured(env)) return operation();
    const release = await holdDesktopPowerSave(env);
    try { return await operation(); }
    finally { await release(); }
}
