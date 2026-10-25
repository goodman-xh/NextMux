/** A native editing history belongs to one visible composer owner. Switching
 * owners gets a fresh DOM key, including when returning to a previous owner.
 * Draft text is persisted separately; browser undo stacks are not persisted. */
export class ComposerInputScope {
    private owner = '';
    private revision = 0;

    key(owner: string): string {
        if (this.owner !== owner) {
            this.owner = owner;
            this.revision += 1;
        }
        return String(this.revision);
    }

    reset(): void {
        this.revision += 1;
    }

    /** Typing into a new draft allocates its conversation synchronously. This
     * is the same editing session, so keep the IME target and native history. */
    adopt(previousOwner: string, nextOwner: string): void {
        if (this.owner === previousOwner) this.owner = nextOwner;
    }
}
