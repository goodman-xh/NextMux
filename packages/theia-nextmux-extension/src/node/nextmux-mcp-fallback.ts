/**
 * Metadata and selection rules for MCP failover.
 *
 * A fallback is deliberately opt-in.  Tool names must be identical and the
 * input schemas must be identical before two servers are exposed as one model
 * tool.  Only tools explicitly listed in `retrySafeTools` may be replayed;
 * unknown and side-effecting tools stay on their selected server.
 */
export interface NextMuxMcpFallbackConfig {
    readonly group?: string;
    readonly priority?: number;
    readonly retrySafeTools?: readonly string[];
}

export interface NextMuxMcpFallbackCandidate {
    readonly serverName: string;
    readonly toolName: string;
    readonly priority: number;
    readonly retrySafe: boolean;
}

const GROUP_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/i;
const TOOL_PATTERN = /^[a-z][a-z0-9._-]{0,127}$/i;

function cleanName(value: unknown, pattern: RegExp): string | undefined {
    return typeof value === 'string' && pattern.test(value.trim()) ? value.trim() : undefined;
}

function boundedPriority(value: unknown): number {
    const priority = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 100;
    return Math.max(0, Math.min(1000, priority));
}

/** Read only non-secret failover metadata from an MCP server description. */
export function readMcpFallbackConfig(value: unknown): NextMuxMcpFallbackConfig {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const source = value as Record<string, unknown>;
    const group = cleanName(source.nextmuxFallbackGroup, GROUP_PATTERN);
    const retrySafeTools = Array.isArray(source.nextmuxRetrySafeTools)
        ? [...new Set(source.nextmuxRetrySafeTools.map(item => cleanName(item, TOOL_PATTERN)).filter((item): item is string => Boolean(item)))].slice(0, 64)
        : [];
    return {
        ...(group ? { group } : {}),
        priority: boundedPriority(source.nextmuxFallbackPriority),
        ...(retrySafeTools.length ? { retrySafeTools } : {})
    };
}

export function mcpFallbackToolKey(group: string | undefined, toolName: string, schema: unknown): string {
    // JSON is stable for MCP's wire schema.  Callers should only use this for
    // grouping server responses received in the same request.
    return `${group || ''}\0${toolName}\0${JSON.stringify(schema)}`;
}

export function mcpFallbackCandidates(
    candidates: readonly NextMuxMcpFallbackCandidate[],
    primaryServerName: string,
): readonly NextMuxMcpFallbackCandidate[] {
    const primary = candidates.find(candidate => candidate.serverName === primaryServerName);
    const backups = [...candidates]
        .filter(candidate => candidate.serverName !== primaryServerName && candidate.retrySafe)
        .sort((left, right) => left.priority - right.priority || left.serverName.localeCompare(right.serverName));
    return primary ? [primary, ...backups] : backups;
}

/** Operational failures may be retried only for an explicitly safe tool. */
export function mcpFallbackErrorRetryable(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error || '');
    // These errors mean that a request may have reached the remote server, or
    // that authorization changed while it was running. Replaying is unsafe.
    if (/MCP_TOOL_RESULT_STALE|MCP_SECURE_TOOL_REQUEST_FAILED|MCP_TOOL_ERROR|MCP_APPROVAL_STALE/i.test(message)) return false;
    if (/MCP_(START_APPROVAL_REQUIRED|TOOL_APPROVAL_REQUIRED|TOOL_IDENTITY_CHANGED|ARGUMENTS_INVALID)/i.test(message)) return false;
    // A broad `catch` must never turn an arbitrary remote exception into a
    // replay.  Only transport/lifecycle failures which are known to occur
    // before a tool result is available are eligible for a safe read retry.
    return /(TIMEOUT|TIMED_OUT|UNAVAILABLE|NOT_CONNECTED|CONNECTION|TRANSPORT|PROTOCOL|DISCONNECTED)/i.test(message);
}
