import type { ChildProcess } from 'child_process';
import { performance } from 'perf_hooks';

const MAX_RESTARTS_PER_BURST = 2;
const STABLE_RUNTIME_MS = 60_000;
const STARTUP_TIMEOUT_MS = 30_000;

export interface BackendProcessFailure {
    reason: 'restart_failed' | 'restart_limit';
    code: number | null;
    signal: NodeJS.Signals | null;
}

/** Change only the backend port option; preserve workspace and other launch arguments. */
export function backendRestartArguments(argv: readonly string[], port?: number): string[] {
    if (port === undefined) return [...argv];
    if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('Invalid backend port');
    const separator = argv.indexOf('--');
    const options = separator < 0 ? argv : argv.slice(0, separator);
    const result: string[] = [];
    for (let index = 0; index < options.length; index += 1) {
        const argument = options[index];
        if (argument === '--port' || argument === '-p') {
            if (/^-?\d+$/.test(options[index + 1] || '')) index += 1;
        } else if (!/^--port=/.test(argument) && !/^-p\d+$/.test(argument)) result.push(argument);
    }
    result.push(`--port=${port}`);
    if (separator >= 0) result.push(...argv.slice(separator));
    return result;
}

/** Watch actual child exits, without timing out model work or replaying any task. */
export class NextMuxBackendProcessLifecycle {
    private child: ChildProcess | undefined;
    private initial: Promise<number> | undefined;
    private restarting: Promise<void> | undefined;
    private requestedPort: number | undefined;
    private restarts = 0;
    private stopped = false;
    private exhausted = false;
    private lastExit: Pick<BackendProcessFailure, 'code' | 'signal'> = { code: null, signal: null };

    constructor(private readonly options: {
        fork(port?: number): ChildProcess | Promise<ChildProcess>;
        onFailure(failure: BackendProcessFailure): void;
        now?(): number;
        startupTimeoutMs?: number;
    }) {}

    start(): Promise<number> {
        this.initial ??= this.launch();
        return this.initial;
    }

    dispose(): void {
        if (this.stopped) return;
        this.stopped = true;
        this.requestedPort = undefined;
        this.kill(this.child);
    }

    private now(): number { return this.options.now?.() ?? performance.now(); }

    private kill(child: ChildProcess | undefined): void {
        if (child?.exitCode === null && child.signalCode === null) {
            try { child.kill(); } catch { /* Only this owned child can be stopped. */ }
        }
    }

    private async launch(expectedPort?: number): Promise<number> {
        const child = await this.options.fork(expectedPort);
        if (this.stopped) {
            this.kill(child);
            throw new Error('Backend start was stopped');
        }
        this.child = child;
        return new Promise<number>((resolve, reject) => {
            let port: number | undefined;
            let readyAt = 0;
            let settled = false;
            // A replacement that is only slow (a busy disk, an antivirus scan) gets another try within the burst.
            const startupTimer = setTimeout(() => fail(true), this.options.startupTimeoutMs ?? STARTUP_TIMEOUT_MS);
            startupTimer.unref?.();
            const fail = (slow = false): void => {
                if (settled) return;
                settled = true;
                clearTimeout(startupTimer);
                child.off('message', onMessage);
                reject(Object.assign(new Error('The backend process did not become ready'), { retryable: slow && expectedPort !== undefined }));
                this.kill(child);
            };
            const onMessage = (address: unknown): void => {
                if (settled || this.stopped || !address || typeof address !== 'object' || Array.isArray(address)) return;
                const value = (address as { port?: unknown }).port;
                if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65_535) return;
                if (expectedPort !== undefined && value !== expectedPort) { fail(); return; }
                port = value;
                readyAt = this.now();
                settled = true;
                clearTimeout(startupTimer);
                child.off('message', onMessage);
                resolve(value);
            };
            const onError = (): void => { if (port === undefined) fail(); };
            const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
                clearTimeout(startupTimer);
                child.off('message', onMessage);
                child.off('exit', onExit);
                // Keep the guarded error listener for a late IPC/kill error on
                // this retired handle; it must not become an uncaught error.
                if (this.child !== child) return;
                this.child = undefined;
                if (!settled) {
                    settled = true;
                    reject(Object.assign(new Error('The backend exited before becoming ready'), { retryable: expectedPort !== undefined }));
                }
                if (port === undefined || this.stopped || this.exhausted) return;
                this.lastExit = { code, signal };
                if (this.now() - readyAt >= STABLE_RUNTIME_MS) this.restarts = 0;
                this.requestedPort = port;
                this.restart();
            };
            child.on('message', onMessage);
            child.on('error', onError);
            child.on('exit', onExit);
            // A fixture/fork implementation may already report an exit. Do
            // not leave the initial readiness promise pending in that case.
            if (child.exitCode !== null || child.signalCode !== null) onExit(child.exitCode, child.signalCode);
        });
    }

    private restart(): void {
        if (this.restarting || this.stopped || this.exhausted) return;
        this.restarting = this.restartLoop().finally(() => {
            this.restarting = undefined;
            if (this.requestedPort !== undefined) this.restart();
        });
    }

    private async restartLoop(): Promise<void> {
        while (!this.stopped && this.requestedPort !== undefined) {
            const port = this.requestedPort;
            this.requestedPort = undefined;
            if (this.restarts >= MAX_RESTARTS_PER_BURST) { this.failure('restart_limit'); return; }
            this.restarts += 1;
            try { await this.launch(port); }
            catch (error) {
                // A replacement that exited before it was ready, or was too slow to be, is tried again within the burst.
                if (!this.stopped && (error as { retryable?: boolean })?.retryable && this.restarts < MAX_RESTARTS_PER_BURST) {
                    await new Promise<void>(resolve => {
                        const timer = setTimeout(resolve, 250 * this.restarts);
                        timer.unref?.();
                    });
                    if (!this.stopped) { this.requestedPort = port; continue; }
                }
                if (!this.stopped) this.failure('restart_failed');
                return;
            }
        }
    }

    private failure(reason: BackendProcessFailure['reason']): void {
        this.exhausted = true;
        this.requestedPort = undefined;
        try { this.options.onFailure({ reason, ...this.lastExit }); } catch { /* Reporting must not crash Electron. */ }
    }
}
