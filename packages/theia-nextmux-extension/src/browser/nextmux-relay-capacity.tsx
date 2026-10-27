import * as React from 'react';
import type { PublicMerchantCapacityScope, PublicMerchantCapacitySnapshot } from '../common/nextmux-relay-capacity';

interface CapacityClaim {
    readonly ids: readonly string[];
    readonly scope: PublicMerchantCapacityScope;
    readonly onSnapshot: (value: PublicMerchantCapacitySnapshot | undefined) => void;
    readonly visibleIds?: () => readonly string[];
}

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
    private readonly claims: CapacityClaim[] = [];

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
        this.emit(kept, this.revision);
        if (this.running && !this.pending) void this.refresh();
    }

    stop(): void {
        this.revision++;
        this.running = false;
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
        this.pending = true;
        const revision = this.revision, ids = [...new Set(this.visibleIds())].filter(id => this.ids.includes(id)).slice(0, 32), scope = this.scope;
        try {
            const snapshot = await this.read(ids, scope);
            if (!this.running || revision !== this.revision) return;
            this.emit(snapshot, revision);
        } catch {
            if (this.running && revision === this.revision) this.emit(undefined, revision);
        } finally {
            this.pending = false;
            if (this.running) this.timer = setTimeout(() => void this.refresh(), revision === this.revision ? 2000 : 0);
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
