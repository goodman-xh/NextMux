import type { McpServerAccess } from '../common/nextmux-mcp-access';

/** Coalesces notifications and never publishes an older, still-pending snapshot. */
export function createMcpAccessRefresh(ports: {
    load: () => Promise<readonly McpServerAccess[]>;
    invalidate: () => void;
    accept: (servers: readonly McpServerAccess[]) => void;
    failed: () => void;
}): { readonly version: number; refresh(): void; dispose(): void } {
    let version = 0, pending = false, running = false, disposed = false;
    const drain = async (): Promise<void> => {
        if (running) return;
        running = true;
        try {
            while (pending && !disposed) {
                pending = false;
                const current = version;
                try { const servers = await ports.load(); if (!disposed && current === version) ports.accept(servers); }
                catch { if (!disposed && current === version) ports.failed(); }
            }
        } finally { running = false; }
    };
    return {
        get version() { return version; },
        refresh() { if (!disposed) { version++; pending = true; ports.invalidate(); void drain(); } },
        dispose() { disposed = true; pending = false; version++; }
    };
}
