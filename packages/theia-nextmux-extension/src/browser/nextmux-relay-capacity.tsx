import * as React from 'react';
import type { PublicMerchantCapacityScope, PublicMerchantCapacitySnapshot } from '../common/nextmux-relay-capacity';

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

    constructor(private readonly read: (ids: readonly string[], scope: PublicMerchantCapacityScope) => Promise<PublicMerchantCapacitySnapshot>) { }

    start(ids: readonly string[], scope: PublicMerchantCapacityScope, onSnapshot: (value: PublicMerchantCapacitySnapshot | undefined) => void,
        visibleIds: () => readonly string[] = () => ids.slice(0, 32)): void {
        this.stop();
        this.ids = [...new Set(ids)].sort();
        this.visibleIds = visibleIds;
        this.scope = scope;
        this.onSnapshot = onSnapshot;
        this.running = this.ids.length > 0;
        onSnapshot(undefined);
        if (this.running && !this.pending) void this.refresh();
    }

    stop(): void {
        this.revision++;
        this.running = false;
        clearTimeout(this.timer); clearTimeout(this.expiryTimer);
        this.timer = this.expiryTimer = undefined;
        this.onSnapshot = undefined;
    }

    private async refresh(): Promise<void> {
        if (!this.running || this.pending) return;
        this.pending = true;
        const revision = this.revision, ids = [...new Set(this.visibleIds())].filter(id => this.ids.includes(id)).slice(0, 32), scope = this.scope;
        try {
            const snapshot = await this.read(ids, scope);
            if (!this.running || revision !== this.revision) return;
            this.onSnapshot?.(snapshot);
            clearTimeout(this.expiryTimer);
            const deadline = Math.min(...snapshot.merchants.filter(item => item.state === 'full' && item.expiresAt > Date.now()).map(item => item.expiresAt));
            if (Number.isFinite(deadline)) this.expiryTimer = setTimeout(() => {
                if (this.running && revision === this.revision) this.onSnapshot?.(undefined);
            }, Math.max(0, deadline - Date.now()));
        } catch {
            if (this.running && revision === this.revision) this.onSnapshot?.(undefined);
        } finally {
            this.pending = false;
            if (this.running) this.timer = setTimeout(() => void this.refresh(), revision === this.revision ? 2000 : 0);
        }
    }
}

/** Mounted only inside the actual open shared coding/comic relay drawer. */
export function RelayCapacityRefresh(props: {
    readonly poller: RelayCapacityPoller;
    readonly merchantIds: readonly string[];
    readonly scope: PublicMerchantCapacityScope;
    readonly onSnapshot: (value: PublicMerchantCapacitySnapshot | undefined) => void;
}): null {
    const callback = React.useRef(props.onSnapshot);
    callback.current = props.onSnapshot;
    const key = [...new Set(props.merchantIds)].sort().join('\n');
    React.useEffect(() => {
        const ids = key ? key.split('\n') : [];
        const visibleIds = (): readonly string[] => {
            const panel = document.querySelector<HTMLElement>('#nmx-relay-source-panel');
            if (!panel) return ids.slice(0, 32);
            const bounds = panel.getBoundingClientRect();
            const visible = [...panel.querySelectorAll<HTMLElement>('[data-relay-key]')].filter(node => {
                const row = node.getBoundingClientRect();
                return row.bottom > bounds.top && row.top < bounds.bottom;
            }).map(node => node.dataset.relayKey || '').filter(key => key.startsWith('managed:')).map(key => key.slice('managed:'.length))
                .filter(id => ids.includes(id)).slice(0, 32);
            return visible.length ? visible : ids.slice(0, 32);
        };
        props.poller.start(ids, props.scope, value => callback.current(value), visibleIds);
        return () => props.poller.stop();
    }, [props.poller, key, props.scope]);
    return null;
}
