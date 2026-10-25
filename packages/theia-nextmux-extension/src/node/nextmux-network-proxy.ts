const LOOPBACK_NO_PROXY_ENTRIES = Object.freeze(['localhost', '127.0.0.1', '[::1]'] as const);

/**
 * WinINET commonly stores loopback bypasses as `127.*`. Undici intentionally
 * supports host/suffix entries rather than that Windows-only wildcard syntax,
 * so forwarding the value unchanged can silently send local model and MCP
 * traffic through the user's proxy. Loopback services are always local trust
 * boundaries in NextMux and must remain directly reachable.
 */
export function withLoopbackProxyBypass(value: string | undefined): string {
    const entries = (value || '')
        .split(/[;,\s]+/)
        .map(entry => entry.trim())
        .filter(Boolean);
    if (entries.includes('*')) return '*';

    const existing = new Set(entries.map(entry => entry.toLocaleLowerCase()));
    for (const loopback of LOOPBACK_NO_PROXY_ENTRIES) {
        if (!existing.has(loopback)) entries.push(loopback);
    }
    return entries.join(',');
}
