export interface McpToolAccess {
    readonly name: string;
    readonly description: string;
    readonly fingerprint: string;
    readonly approved: boolean;
    readonly supported: boolean;
}

/** Execution identity is host-supplied, never taken from model arguments. */
export interface McpInvocationContext {
    readonly conversationId?: string;
    readonly runId?: string;
    readonly signal?: AbortSignal;
}

/** Non-secret MCP registration hints used only to build an explicit fallback group. */
export interface McpFallbackConfiguration {
    readonly nextmuxFallbackGroup?: string;
    readonly nextmuxFallbackPriority?: number;
    /** Only idempotent/read-only tools may be listed here. */
    readonly nextmuxRetrySafeTools?: readonly string[];
}

/** Structured input field specification extracted from registry metadata or smart config recognition. */
export interface McpInputFieldSpec {
    readonly key: string;
    readonly label: string;
    readonly description?: string;
    readonly required: boolean;
    readonly secret?: boolean;
    readonly defaultValue?: string;
    readonly placeholder?: string;
    readonly target: 'env' | 'arg' | 'header' | 'url';
    readonly argFlag?: string;
}

export type McpServerConfiguration = ({
    readonly command: string;
    readonly args: readonly string[];
    readonly env?: Readonly<Record<string, string>>;
} | { readonly serverUrl: string }) & McpFallbackConfiguration & {
    /** Curated preset id resolved to a checked-in payload in packaged builds. */
    readonly nextmuxRuntimePreset?: string;
};

export interface McpServerAccess {
    readonly name: string;
    readonly fingerprint: string;
    readonly connection: string;
    readonly details: string;
    readonly local: boolean;
    readonly running: boolean;
    readonly approved: boolean;
    readonly needsReview: boolean;
    readonly tools: readonly McpToolAccess[];
    readonly credential?: McpCredentialReference;
    readonly credentialEditable?: boolean;
    readonly diagnostic?: 'configuration' | 'authorization' | 'dependency' | 'authentication' | 'connection' | 'stopped' | 'empty' | 'tools' | 'ready';
    /** The transport lifecycle state, retained so the UI can distinguish a
     * deliberately stopped server from a failed/expired connection. */
    readonly status?: string;
    readonly toolsTruncated?: boolean;
    /** Allow-listed diagnostics only: never include a command, URL, argument,
     * environment value or raw transport error in the renderer response. */
    readonly failure?: {
        readonly stage: 'startup' | 'connection' | 'tools';
        readonly code: 'runtime_missing' | 'browser_missing' | 'permission_denied' | 'timeout' | 'authentication' | 'process_exit' | 'protocol' | 'connection';
        /**
         * Bounded, redacted evidence for a local-process failure.  This is
         * deliberately structured rather than the child command/stderr so a
         * renderer can explain an exit without receiving credentials or
         * paths.  Fields are omitted when the transport cannot provide them.
         */
        readonly exitCode?: number;
        readonly signal?: string;
        readonly detail?: string;
        /** runtime_missing only: which well-known launcher is absent, so the panel can name what to install. */
        readonly runtime?: 'uvx' | 'npx' | 'docker';
    };
}

/** This is a non-secret locator. It is not an authorization grant. */
export interface McpCredentialReference {
    readonly id: string;
    readonly revision: string;
    readonly kind: 'bearer' | 'x-api-key' | 'api-key';
}

export interface McpCredentialChange {
    readonly serverName: string;
    readonly fingerprint: string;
    readonly action: 'set' | 'clear';
    readonly kind?: McpCredentialReference['kind'];
    /** Write-only, transient RPC input; never included in a response or configuration. */
    readonly value?: string;
}

export interface McpCredentialChangeResult {
    readonly credential?: McpCredentialReference;
    readonly servers: readonly McpServerAccess[];
}

export function parseMcpCredentialReference(value: unknown): McpCredentialReference | undefined {
    if (value === undefined) return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MCP_CREDENTIAL_REFERENCE_INVALID');
    const ref = value as Record<string, unknown>;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    if (Object.keys(ref).length !== 3 || typeof ref.id !== 'string' || !uuid.test(ref.id)
        || typeof ref.revision !== 'string' || !uuid.test(ref.revision)
        || typeof ref.kind !== 'string' || !['bearer', 'x-api-key', 'api-key'].includes(ref.kind)) throw new Error('MCP_CREDENTIAL_REFERENCE_INVALID');
    return { id: ref.id, revision: ref.revision, kind: ref.kind as McpCredentialReference['kind'] };
}

export interface McpAccessChange {
    readonly serverName: string;
    readonly fingerprint: string;
    readonly action: 'start' | 'revoke' | 'tools';
    readonly tools?: readonly { readonly name: string; readonly fingerprint: string }[];
}
