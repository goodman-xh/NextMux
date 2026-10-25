export interface AgentEventBufferOptions {
    readonly maximumEntries: number;
    readonly maximumWeight: number;
}

export interface AgentEventBufferSnapshot<T> {
    readonly events: readonly T[];
    readonly firstEventIndex: number;
    readonly nextEventIndex: number;
}

/**
 * Bounded, cursor-addressed event journal used by the desktop RPC adapter.
 * Cursors are absolute so eviction never causes a client to replay a different
 * event at an index it has already consumed.
 */
export class AgentEventBuffer<T> {
    protected readonly maximumEntries: number;
    protected readonly maximumWeight: number;
    protected readonly events: T[] = [];
    protected readonly weights: number[] = [];
    protected readonly waiters = new Set<() => void>();
    protected firstIndex = 0;
    protected nextIndex = 0;
    protected retainedWeight = 0;

    constructor(options: AgentEventBufferOptions) {
        if (!Number.isSafeInteger(options.maximumEntries) || options.maximumEntries < 1
            || !Number.isSafeInteger(options.maximumWeight) || options.maximumWeight < 1) {
            throw new RangeError('Agent event buffer limits must be positive safe integers');
        }
        this.maximumEntries = options.maximumEntries;
        this.maximumWeight = options.maximumWeight;
    }

    append(event: T, weight = 1): number {
        const boundedWeight = Number.isSafeInteger(weight) && weight > 0
            ? Math.min(weight, this.maximumWeight)
            : 1;
        const index = this.nextIndex++;
        this.events.push(event);
        this.weights.push(boundedWeight);
        this.retainedWeight += boundedWeight;
        while (this.events.length > this.maximumEntries || this.retainedWeight > this.maximumWeight) {
            this.events.shift();
            this.retainedWeight -= this.weights.shift() || 0;
            this.firstIndex += 1;
        }
        this.wake();
        return index;
    }

    snapshot(afterEventIndex: number): AgentEventBufferSnapshot<T> {
        const cursor = Math.min(this.nextIndex, Math.max(this.firstIndex, afterEventIndex));
        return {
            events: this.events.slice(cursor - this.firstIndex),
            firstEventIndex: this.firstIndex,
            nextEventIndex: this.nextIndex
        };
    }

    all(): readonly T[] {
        return [...this.events];
    }

    async waitForChange(afterEventIndex: number, waitMs: number, active: () => boolean): Promise<void> {
        const cursor = Math.min(this.nextIndex, Math.max(this.firstIndex, afterEventIndex));
        if (waitMs <= 0 || !active() || cursor !== this.nextIndex) return;
        await new Promise<void>(resolve => {
            let settled = false;
            let timer: ReturnType<typeof setTimeout> | undefined;
            const done = (): void => {
                if (settled) return;
                settled = true;
                if (timer) clearTimeout(timer);
                this.waiters.delete(done);
                resolve();
            };
            this.waiters.add(done);
            timer = setTimeout(done, waitMs);
            if (!active() || cursor !== this.nextIndex) done();
        });
    }

    wake(): void {
        for (const waiter of [...this.waiters]) waiter();
    }
}
