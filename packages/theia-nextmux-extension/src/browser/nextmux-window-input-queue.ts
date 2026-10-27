/** Preserve the user's text/key/pointer order without blocking the renderer. */
export class ConversationWindowInputQueue {
    private tail: Promise<boolean> = Promise.resolve(true);
    private generation = 0;

    get currentGeneration(): number { return this.generation; }

    /** Cancel work that has not reached the native bridge; never replay uncertain input. */
    cancel(): void { this.generation += 1; }

    enqueue(action: () => boolean | Promise<boolean>, generation = this.generation): Promise<boolean> {
        const pending = this.tail.then(async () => {
            if (generation !== this.generation) return false;
            try {
                const accepted = await action();
                if (!accepted && generation === this.generation) this.cancel();
                return accepted;
            } catch {
                if (generation === this.generation) this.cancel();
                return false;
            }
        });
        this.tail = pending;
        return pending;
    }

    text(value: string, send: (chunk: string) => Promise<boolean>, generation = this.generation): Promise<boolean> {
        return this.enqueue(async () => {
            for (let offset = 0; offset < value.length;) {
                if (generation !== this.generation) return false;
                let end = Math.min(value.length, offset + 2000);
                // A UTF-16 surrogate pair must reach the native text bridge together.
                if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1]) && /[\uDC00-\uDFFF]/.test(value[end])) end -= 1;
                if (!await send(value.slice(offset, end))) return false;
                offset = end;
            }
            return true;
        }, generation);
    }
}
