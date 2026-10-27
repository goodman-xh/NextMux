import type { PlatformDeviceLink, PlatformDeviceSession } from '../common/nextmux-platform-protocol';

const DEVICE_LINK_NONCE = /^[A-Za-z0-9_-]{43}$/;

export interface DesktopDeviceLinkCallback {
    readonly nonce: string;
    readonly url: string;
}

export function parseDesktopDeviceLinkCallback(value: string): DesktopDeviceLinkCallback | undefined {
    if (typeof value !== 'string' || value.length > 2048 || value.includes('\0')) return undefined;
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return undefined;
    }
    if (url.protocol !== 'nextmux:' || url.hostname !== 'device-link' || url.pathname !== '/complete') return undefined;
    if (url.username || url.password || url.port || url.hash) return undefined;
    if ([...url.searchParams.keys()].length !== 1 || url.searchParams.getAll('nonce').length !== 1) return undefined;
    const nonce = url.searchParams.get('nonce') || '';
    if (!DEVICE_LINK_NONCE.test(nonce)) return undefined;
    const canonical = `nextmux://device-link/complete?nonce=${nonce}`;
    return url.toString() === canonical ? { nonce, url: canonical } : undefined;
}

export interface DesktopAccountLinkCoordinatorOptions {
    readonly complete: (nonce: string) => Promise<PlatformDeviceSession>;
    readonly poll: () => Promise<PlatformDeviceSession>;
    readonly accept: (session: PlatformDeviceSession) => void;
    readonly reportError: (error: unknown) => void;
    readonly setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
    readonly clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
    readonly now?: () => number;
    readonly pollIntervalMs?: number;
}

export interface DesktopDeviceLinkBridge {
    takePendingDeepLinks(): Promise<readonly string[]>;
    onDeepLink(callback: (url: string) => void): () => void;
}

export class DesktopAccountLinkCoordinator {
    protected timer: ReturnType<typeof setTimeout> | undefined;
    protected expiresAt = 0;
    protected active = false;
    protected generation = 0;
    protected disposed = false;
    protected readonly handledNonces = new Set<string>();
    protected readonly setTimer: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
    protected readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
    protected readonly now: () => number;

    constructor(protected readonly options: DesktopAccountLinkCoordinatorOptions) {
        this.setTimer = options.setTimer || ((callback, delay) => globalThis.setTimeout(callback, delay));
        this.clearTimer = options.clearTimer || (timer => globalThis.clearTimeout(timer));
        this.now = options.now || Date.now;
    }

    start(link: PlatformDeviceLink): void {
        this.cancel();
        if (this.disposed) return;
        this.active = true;
        this.expiresAt = Number(link.expiresAt) || 0;
        this.schedulePoll();
    }

    cancel(): void {
        // Any answer still on its way belongs to the flow that ended here and is ignored (audit A02-01).
        this.generation += 1;
        this.active = false;
        this.expiresAt = 0;
        if (this.timer !== undefined) this.clearTimer(this.timer);
        this.timer = undefined;
    }

    dispose(): void {
        this.disposed = true;
        this.cancel();
        this.handledNonces.clear();
    }

    async handleDeepLink(value: string): Promise<boolean> {
        const callback = parseDesktopDeviceLinkCallback(value);
        if (!callback || this.disposed || this.handledNonces.has(callback.nonce)) return false;
        this.handledNonces.add(callback.nonce);
        try {
            const session = await this.options.complete(callback.nonce);
            if (session.linked) this.cancel();
            this.options.accept(session);
            return true;
        } catch (error) {
            this.handledNonces.delete(callback.nonce);
            this.options.reportError(error);
            return false;
        }
    }

    attach(bridge: DesktopDeviceLinkBridge): () => void {
        let attached = true;
        const handle = (value: string): void => { if (attached) void this.handleDeepLink(value); };
        const detach = bridge.onDeepLink(handle);
        void bridge.takePendingDeepLinks().then(values => {
            if (attached) for (const value of values) handle(value);
        }).catch(error => this.options.reportError(error));
        return () => {
            attached = false;
            detach();
        };
    }

    protected schedulePoll(): void {
        if (!this.active || this.disposed) return;
        if (this.expiresAt <= this.now()) {
            this.cancel();
            return;
        }
        this.timer = this.setTimer(() => {
            this.timer = undefined;
            void this.pollOnce();
        }, this.options.pollIntervalMs || 3_000);
    }

    protected async pollOnce(): Promise<void> {
        if (!this.active || this.disposed) return;
        const generation = this.generation;
        try {
            const session = await this.options.poll();
            // A browser approval (or cancel, or a new sign-in) finished while this poll was out: its older answer
            // must not put the account back to signed out.
            if (generation !== this.generation || !this.active || this.disposed) return;
            this.options.accept(session);
            if (session.linked) {
                this.cancel();
                return;
            }
        } catch (error) {
            this.options.reportError(error);
        }
        this.schedulePoll();
    }
}
