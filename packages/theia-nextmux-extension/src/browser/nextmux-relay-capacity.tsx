import * as React from 'react';
import type { PublicMerchantCapacityScope, PublicMerchantCapacitySnapshot } from '../common/nextmux-relay-capacity';

interface CapacityClaim {
    readonly ids: readonly string[];
    readonly scope: PublicMerchantCapacityScope;
    readonly onSnapshot: (value: PublicMerchantCapacitySnapshot | undefined) => void;
    readonly visibleIds?: () => readonly string[];
}

const FOCUS_REFRESH_COOLDOWN_MS = 5_000;
const RESTRICTED_POLL_INTERVAL_MS = 10_000;
const NORMAL_POLL_INTERVAL_MS = 15_000;
const MAX_ERROR_BACKOFF_MS = 60_000;

/** One visible picker owns one serial read; scope changes never race old replies. */
export class RelayCapacityPoller {
    private revision = 0;
    private running = false;
    private pending = false;
    private timer?: ReturnType<typeof setTimeout>;
    private expiryTimer?: ReturnType<typeof setTimeout>;
    private ids: readonly string[] = [];
    private visibleIds: () => readonly string[] = () => this.ids.slice(0, 32);
    private scope: PublicMerchantCapacityScope = 'coding';
    private onSnapshot?: (value: PublicMerchantCapacitySnapshot | undefined) => void;
    private snapshot?: PublicMerchantCapacitySnapshot;
    private consecutiveFailures = 0;
    private lastRefreshAt = 0;
    private errorBackoffUntil = 0;
    private pausedPendingResume = false;
    private readonly claims: CapacityClaim[] = [];
    private readonly onVisibilityOrFocus = (event?: { readonly type?: string }): void => {
        if (!this.running || this.pending) return;
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        const now = Date.now();
        if (this.consecutiveFailures > 0 && now < this.errorBackoffUntil) {
            const remaining = Math.max(0, this.errorBackoffUntil - now)
                + (event?.type === 'online' ? 1_000 + Math.round(Math.random() * 4_000) : 0);
            clearTimeout(this.timer);
            this.timer = setTimeout(() => {
                this.timer = undefined;
                void this.refresh();
            }, remaining);
            return;
        }
        if (!this.pausedPendingResume && now - this.lastRefreshAt < FOCUS_REFRESH_COOLDOWN_MS) return;
        clearTimeout(this.timer);
        this.timer = undefined;
        if (event?.type === 'online') {
            this.pausedPendingResume = false;
            const staggerMs = 1_000 + Math.round(Math.random() * 4_000);
            this.timer = setTimeout(() => {
                this.timer = undefined;
                void this.refresh();
            }, staggerMs);
            return;
        }
        void this.refresh();
    };

    constructor(private readonly read: (ids: readonly string[], scope: PublicMerchantCapacityScope) => Promise<PublicMerchantCapacitySnapshot>) { }

    start(ids: readonly string[], scope: PublicMerchantCapacityScope, onSnapshot: (value: PublicMerchantCapacitySnapshot | undefined) => void,
        visibleIds: () => readonly string[] = () => ids.slice(0, 32)): void {
        // Observations of the same scope stay until replaced or expired, so handing the poll from the relay drawer to
        // the model list never flashes models whose API keys are full; another scope starts from nothing.
        const kept = this.snapshot?.scope === scope ? this.snapshot : undefined;
        this.stop();
        this.ids = [...new Set(ids)].sort();
        this.visibleIds = visibleIds;
        this.scope = scope;
        this.onSnapshot = onSnapshot;
        this.running = this.ids.length > 0;
        this.consecutiveFailures = 0;
        this.errorBackoffUntil = 0;
        this.pausedPendingResume = false;
        if (this.running) {
            if (typeof document !== 'undefined') document.addEventListener?.('visibilitychange', this.onVisibilityOrFocus);
            if (typeof window !== 'undefined') {
                window.addEventListener?.('focus', this.onVisibilityOrFocus);
                window.addEventListener?.('online', this.onVisibilityOrFocus);
            }
        }
        this.emit(kept, this.revision);
        if (this.running && !this.pending) void this.refresh();
    }

    stop(): void {
        this.revision++;
        this.running = false;
        this.consecutiveFailures = 0;
        this.errorBackoffUntil = 0;
        this.pausedPendingResume = false;
        if (typeof document !== 'undefined') document.removeEventListener?.('visibilitychange', this.onVisibilityOrFocus);
        if (typeof window !== 'undefined') {
            window.removeEventListener?.('focus', this.onVisibilityOrFocus);
            window.removeEventListener?.('online', this.onVisibilityOrFocus);
        }
        clearTimeout(this.timer); clearTimeout(this.expiryTimer);
        this.timer = this.expiryTimer = undefined;
        this.onSnapshot = undefined;
    }

    /**
     * One mounted picker's claim. Pickers can overlap (the council dialog's relay list behind another picker): the
     * latest one polls, and closing it hands the poll back to the one below instead of stopping both.
     */
    attach(ids: readonly string[], scope: PublicMerchantCapacityScope, onSnapshot: (value: PublicMerchantCapacitySnapshot | undefined) => void,
        visibleIds?: () => readonly string[]): () => void {
        const claim: CapacityClaim = { ids, scope, onSnapshot, visibleIds };
        this.claims.push(claim);
        this.start(ids, scope, onSnapshot, visibleIds);
        return () => {
            const index = this.claims.indexOf(claim);
            if (index < 0) return;
            this.claims.splice(index, 1);
            if (index !== this.claims.length) return;
            const below = this.claims.at(-1);
            if (below) this.start(below.ids, below.scope, below.onSnapshot, below.visibleIds);
            else this.stop();
        };
    }

    /** Publishes a snapshot and clears it again when its first restriction (a full merchant or full offerings) expires. */
    private emit(snapshot: PublicMerchantCapacitySnapshot | undefined, revision: number): void {
        this.snapshot = snapshot;
        this.onSnapshot?.(snapshot);
        clearTimeout(this.expiryTimer);
        this.expiryTimer = undefined;
        const now = Date.now();
        const deadline = Math.min(...(snapshot?.merchants || []).filter(item => (item.state === 'full' || item.fullOfferingIds?.length) && item.expiresAt > now)
            .map(item => item.expiresAt));
        if (Number.isFinite(deadline)) this.expiryTimer = setTimeout(() => {
            if (revision === this.revision) this.emit(undefined, revision);
        }, Math.max(0, deadline - now));
    }

    private async refresh(): Promise<void> {
        if (!this.running || this.pending) return;
        if ((typeof document !== 'undefined' && document.visibilityState === 'hidden')
            || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
            this.pausedPendingResume = true;
            return;
        }
        this.pausedPendingResume = false;
        this.lastRefreshAt = Date.now();
        this.pending = true;
        const revision = this.revision, ids = [...new Set(this.visibleIds())].filter(id => this.ids.includes(id)).slice(0, 32), scope = this.scope;
        try {
            const snapshot = await this.read(ids, scope);
            if (!this.running || revision !== this.revision) return;
            if (snapshot === undefined) this.consecutiveFailures++;
            else this.consecutiveFailures = 0;
            this.emit(snapshot, revision);
        } catch {
            if (this.running && revision === this.revision) {
                this.consecutiveFailures++;
                this.emit(undefined, revision);
            }
        } finally {
            this.pending = false;
            if (this.running) {
                const hasRestricted = Boolean(this.snapshot?.merchants.some(item => item.state === 'full' || Boolean(item.fullOfferingIds?.length)));
                const baseBackoffMs = Math.min(MAX_ERROR_BACKOFF_MS, 10_000 * 2 ** Math.min(3, this.consecutiveFailures - 1));
                const nextIntervalMs = revision !== this.revision
                    ? 0
                    : this.consecutiveFailures > 0
                        ? Math.max(1_000, Math.round(baseBackoffMs * (0.8 + Math.random() * 0.4)))
                        : (hasRestricted ? RESTRICTED_POLL_INTERVAL_MS : NORMAL_POLL_INTERVAL_MS);
                this.errorBackoffUntil = revision === this.revision && this.consecutiveFailures > 0
                    ? Date.now() + nextIntervalMs
                    : 0;
                this.timer = setTimeout(() => void this.refresh(), nextIntervalMs);
            }
        }
    }
}

/**
 * Mounted inside each open picker that shows capacity: the shared coding/comic relay drawer (also the council dialog's
 * relay list) and the model list. `pinnedMerchantIds` are polled first whatever the drawer shows, so the merchant
 * whose models are on screen stays current even when its row is scrolled away or another source tab is open.
 */
export function RelayCapacityRefresh(props: {
    readonly poller: RelayCapacityPoller;
    readonly merchantIds: readonly string[];
    readonly pinnedMerchantIds?: readonly string[];
    readonly scope: PublicMerchantCapacityScope;
    readonly onSnapshot: (value: PublicMerchantCapacitySnapshot | undefined) => void;
}): null {
    const callback = React.useRef(props.onSnapshot);
    callback.current = props.onSnapshot;
    const pinnedKey = [...new Set(props.pinnedMerchantIds || [])].sort().join('\n');
    const key = [...new Set([...props.merchantIds, ...(props.pinnedMerchantIds || [])])].sort().join('\n');
    React.useEffect(() => {
        const ids = key ? key.split('\n') : [];
        const pinned = pinnedKey ? pinnedKey.split('\n') : [];
        const visibleIds = (): readonly string[] => {
            const panel = document.querySelector<HTMLElement>('#nmx-relay-source-panel');
            const bounds = panel?.getBoundingClientRect();
            const rows = !panel || !bounds ? [] : [...panel.querySelectorAll<HTMLElement>('[data-relay-key]')].filter(node => {
                const row = node.getBoundingClientRect();
                return row.bottom > bounds.top && row.top < bounds.bottom;
            }).map(node => node.dataset.relayKey || '').filter(relayKey => relayKey.startsWith('managed:')).map(relayKey => relayKey.slice('managed:'.length));
            const visible = [...new Set([...pinned, ...rows])].filter(id => ids.includes(id)).slice(0, 32);
            return visible.length ? visible : ids.slice(0, 32);
        };
        return props.poller.attach(ids, props.scope, value => callback.current(value), visibleIds);
    }, [props.poller, key, pinnedKey, props.scope]);
    return null;
}
