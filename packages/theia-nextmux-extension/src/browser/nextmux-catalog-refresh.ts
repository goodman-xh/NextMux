export interface CatalogSnapshotSource {
    readonly key: string;
    readonly load: () => Promise<boolean>;
}

/** Successful sources are retained across retries; a version commits only as a complete set. */
export class CatalogSnapshotRefresh {
    private version = '';
    private completed = new Set<string>();
    private inFlight = new Map<string, Promise<boolean>>();

    /** Account changes invalidate successes even when the public catalog version is unchanged. */
    reset(): void {
        this.version = '';
        this.completed = new Set();
        this.inFlight = new Map();
    }

    async refresh(version: string, sources: readonly CatalogSnapshotSource[]): Promise<boolean> {
        if (this.version !== version) {
            this.reset();
            this.version = version;
        }
        const completed = this.completed;
        const inFlight = this.inFlight;
        const results = await Promise.all(sources.map(source => {
            if (completed.has(source.key)) return true;
            const existing = inFlight.get(source.key);
            if (existing) return existing;
            const request = Promise.resolve().then(source.load).catch(() => false).then(success => {
                if (success) completed.add(source.key);
                inFlight.delete(source.key);
                return success;
            });
            inFlight.set(source.key, request);
            return request;
        }));
        return this.version === version && this.completed === completed && results.every(Boolean);
    }
}

/** Read the HTTP status carried by Theia RPC without mistaking a transient failure for withdrawal. */
export function merchantSnapshotRemoved(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const value = error as { code?: unknown; httpStatus?: unknown; status?: unknown; data?: { httpStatus?: unknown } };
    const status = value.data?.httpStatus ?? value.httpStatus ?? value.status;
    return value.code === 'merchant_not_found' || status === 404 || status === 410;
}
