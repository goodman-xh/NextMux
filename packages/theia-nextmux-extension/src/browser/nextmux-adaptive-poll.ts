/**
 * Self-scheduling poll whose cadence follows real work instead of a fixed
 * interval. Pattern from TanStack Query's `refetchInterval` +
 * `refetchIntervalInBackground: false` (MIT): one timeout chain, never two
 * overlapping requests, slower while the document is hidden. Idle backoff
 * doubles like VS Code's `RunOnceScheduler`-based pollers until `idleMs`.
 *
 * While nothing is running the renderer makes at most one cheap request per
 * `idleMs` (safety net for work started elsewhere) instead of ~5 per second.
 */
export interface AdaptivePollOptions {
    /** Delay while work is in progress or was just found. */
    readonly activeMs: number;
    /** Upper bound of the idle backoff while the document is visible. */
    readonly idleMs: number;
    /** Upper bound while the document is hidden (window closed to tray, tile hidden). */
    readonly hiddenMs?: number;
    readonly isActive: () => boolean;
    readonly isHidden?: () => boolean;
    /** Returns true when it found work, which keeps the fast cadence. */
    readonly run: () => Promise<boolean> | boolean;
    /** A run that has not settled after this long no longer blocks the loop. */
    readonly runTimeoutMs?: number;
    readonly timers?: {
        readonly set: (callback: () => void, ms: number) => unknown;
        readonly clear: (handle: unknown) => void;
    };
}

export class AdaptivePoll {
    protected handle: unknown;
    protected delay: number;
    protected running = false;
    protected disposed = false;
    protected readonly timers: NonNullable<AdaptivePollOptions['timers']>;

    constructor(protected readonly options: AdaptivePollOptions) {
        this.delay = options.activeMs;
        this.timers = options.timers || {
            set: (callback, ms) => setTimeout(callback, ms),
            clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>)
        };
    }

    /** Current scheduled delay (for diagnostics and tests). */
    get currentDelay(): number { return this.handle === undefined ? -1 : this.delay; }

    start(): void {
        if (this.disposed || this.handle !== undefined || this.running) return;
        this.schedule(0);
    }

    /** Call when activity may have started; pulls a slow idle poll forward. */
    wake(): void {
        if (this.disposed || this.running || !this.options.isActive()) return;
        if (this.handle !== undefined && this.delay <= this.options.activeMs) return;
        this.delay = this.options.activeMs;
        this.schedule(this.options.activeMs);
    }

    dispose(): void {
        this.disposed = true;
        this.cancel();
    }

    protected cancel(): void {
        if (this.handle !== undefined) this.timers.clear(this.handle);
        this.handle = undefined;
    }

    protected schedule(ms: number): void {
        this.cancel();
        if (this.disposed) return;
        this.handle = this.timers.set(() => { this.handle = undefined; void this.tick(); }, ms);
    }

    protected async tick(): Promise<void> {
        if (this.disposed || this.running) return;
        this.running = true;
        let found = false;
        let timer: unknown;
        try {
            const run = Promise.resolve().then(() => this.options.run());
            const timeoutMs = this.options.runTimeoutMs;
            found = await (timeoutMs ? Promise.race([run, new Promise<boolean>(resolve => { timer = this.timers.set(() => resolve(false), timeoutMs); })]) : run) === true;
        } catch { found = false; } finally {
            if (timer !== undefined) this.timers.clear(timer);
            this.running = false;
        }
        if (this.disposed || this.handle !== undefined) return;
        const { activeMs, idleMs } = this.options;
        if (found || this.options.isActive()) this.delay = activeMs;
        else {
            const ceiling = this.options.isHidden?.() ? Math.max(idleMs, this.options.hiddenMs ?? idleMs) : idleMs;
            this.delay = Math.min(ceiling, Math.max(activeMs, this.delay * 2));
        }
        this.schedule(this.delay);
    }
}
