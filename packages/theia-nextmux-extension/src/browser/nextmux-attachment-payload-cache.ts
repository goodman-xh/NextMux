/**
 * Sent attachments kept in memory for re-sending, editing and preview, with a byte budget (audit A21-02). The least
 * recently used payloads leave first; the originals stay in the conversation's saved files and are read again on
 * demand. Keys are `${sessionId}:${attachmentId}`, so a deleted conversation drops its entries in one call.
 */
export class AttachmentPayloadCache<T> {
    protected readonly entries = new Map<string, { readonly value: T; readonly bytes: number }>();
    protected used = 0;

    constructor(protected readonly sizeOf: (value: T) => number, protected readonly budgetBytes = 96 * 1024 * 1024) {}

    get size(): number { return this.entries.size; }

    get(key: string): T | undefined {
        const entry = this.entries.get(key);
        if (!entry) return undefined;
        this.entries.delete(key);
        this.entries.set(key, entry);
        return entry.value;
    }

    has(key: string): boolean { return this.entries.has(key); }

    set(key: string, value: T): this {
        this.delete(key);
        const bytes = Math.max(0, Number(this.sizeOf(value)) || 0) + 256;
        this.entries.set(key, { value, bytes });
        this.used += bytes;
        for (const [oldest, entry] of this.entries) {
            if (this.used <= this.budgetBytes || oldest === key) break;
            this.entries.delete(oldest);
            this.used -= entry.bytes;
        }
        return this;
    }

    delete(key: string): boolean {
        const entry = this.entries.get(key);
        if (!entry) return false;
        this.entries.delete(key);
        this.used -= entry.bytes;
        return true;
    }

    deleteSession(sessionId: string): void {
        const prefix = `${sessionId}:`;
        for (const key of [...this.entries.keys()]) if (key.startsWith(prefix)) this.delete(key);
    }

    clear(): void {
        this.entries.clear();
        this.used = 0;
    }
}
