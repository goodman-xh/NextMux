const active = new Map<string, number>();

/** A save-scoped refusal, not permission to overwrite or a new configuration store. */
export function guardMcpPreferenceSave(uri: string): () => void {
    active.set(uri, (active.get(uri) || 0) + 1);
    let released = false;
    return () => {
        if (released) return;
        released = true;
        const remaining = (active.get(uri) || 1) - 1;
        if (remaining) active.set(uri, remaining); else active.delete(uri);
    };
}

export function isMcpPreferenceSaveGuarded(uri: string): boolean { return active.has(uri); }
