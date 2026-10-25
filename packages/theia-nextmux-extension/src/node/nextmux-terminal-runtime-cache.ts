import type { DesktopTerminalRuntime } from '../common/nextmux-platform-protocol';

export interface ResilientTerminalRuntimeCacheOptions {
    readonly resolve: () => Promise<DesktopTerminalRuntime>;
    readonly fallback: () => DesktopTerminalRuntime;
    /** One bounded retry gives ConPTY and slow login shells time to finish cleanup after reload. */
    readonly retryDelayMs?: number;
    /** Repeated transient failures are coalesced briefly, but never remain sticky until restart. */
    readonly transientTtlMs?: number;
    readonly now?: () => number;
    readonly sleep?: (milliseconds: number) => Promise<void>;
}

interface TerminalRuntimeCacheEntry {
    readonly value: DesktopTerminalRuntime;
    readonly expiresAt: number;
}

interface TerminalRuntimePendingEntry {
    readonly revision: number;
    readonly promise: Promise<DesktopTerminalRuntime>;
}

export function terminalRuntimeDiscoveryIsTransient(runtime: DesktopTerminalRuntime): boolean {
    return runtime.supportStatus === 'unsupported'
        && runtime.supportReason === 'terminal_profile_unavailable';
}

/**
 * Coalesces terminal discovery for one backend connection and distinguishes
 * immutable platform incompatibility from a shell/PTY probe that may recover.
 */
export class ResilientTerminalRuntimeCache {
    protected readonly retryDelayMs: number;
    protected readonly transientTtlMs: number;
    protected readonly now: () => number;
    protected readonly sleep: (milliseconds: number) => Promise<void>;
    protected revision = 0;
    protected cached: TerminalRuntimeCacheEntry | undefined;
    protected pending: TerminalRuntimePendingEntry | undefined;

    constructor(protected readonly options: ResilientTerminalRuntimeCacheOptions) {
        this.retryDelayMs = Math.max(0, options.retryDelayMs ?? 180);
        this.transientTtlMs = Math.max(1, options.transientTtlMs ?? 1_500);
        this.now = options.now || Date.now;
        this.sleep = options.sleep || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
    }

    invalidate(): void {
        this.revision += 1;
        this.cached = undefined;
        // A stale operation may finish for its original caller, but cannot
        // overwrite the new generation or block an explicit refresh.
        this.pending = undefined;
    }

    async get(refresh = false): Promise<DesktopTerminalRuntime> {
        if (refresh) this.invalidate();
        const cached = this.cached;
        if (cached && cached.expiresAt > this.now()) return cached.value;
        if (this.pending) return this.pending.promise;

        const revision = this.revision;
        let operation: Promise<DesktopTerminalRuntime>;
        operation = this.resolveWithRecovery()
            .then(value => {
                if (revision === this.revision) {
                    this.cached = {
                        value,
                        expiresAt: terminalRuntimeDiscoveryIsTransient(value)
                            ? this.now() + this.transientTtlMs
                            : Number.POSITIVE_INFINITY
                    };
                }
                return value;
            })
            .finally(() => {
                if (this.pending?.promise === operation) this.pending = undefined;
            });
        this.pending = { revision, promise: operation };
        return operation;
    }

    protected async resolveOnce(): Promise<DesktopTerminalRuntime> {
        try {
            return await this.options.resolve();
        } catch {
            return this.options.fallback();
        }
    }

    protected async resolveWithRecovery(): Promise<DesktopTerminalRuntime> {
        const first = await this.resolveOnce();
        if (!terminalRuntimeDiscoveryIsTransient(first)) return first;
        if (this.retryDelayMs > 0) await this.sleep(this.retryDelayMs);
        return this.resolveOnce();
    }
}
