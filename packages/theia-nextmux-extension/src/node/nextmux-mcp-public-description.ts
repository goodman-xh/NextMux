import { MCPServerStatus, type MCPServerDescription } from '@theia/ai-mcp/lib/common/mcp-server-manager';
import { parseMcpCredentialReference, type McpCredentialReference, type McpServerAccess } from '../common/nextmux-mcp-access';

/** Display data is deliberately not a configuration round-trip format. */
export type McpPublicDescription = MCPServerDescription & {
    readonly nextmuxDisplayOnly: true;
    readonly nextmuxCredential?: McpCredentialReference;
};

export function assertMcpConfigurationInput(description: MCPServerDescription): void {
    if ('nextmuxDisplayOnly' in description) throw new Error('MCP_DISPLAY_DESCRIPTION_NOT_CONFIGURATION');
}

function origin(value: string): string {
    try {
        const url = new URL(value);
        if (url.protocol === 'https:' || url.protocol === 'http:') return url.origin;
    } catch { /* Invalid or unresolved configuration is never echoed into the UI. */ }
    return 'Remote endpoint';
}

/** No argument, environment key/value, header, OAuth configuration, or URL path/query is display data. */
export function mcpAccessSummary(description: MCPServerDescription): Pick<McpServerAccess, 'connection' | 'details'> {
    if ('command' in description) return {
        connection: 'Local process',
        details: JSON.stringify({ arguments: description.args?.length || 0, environment: Object.keys(description.env || {}).length })
    };
    return {
        connection: origin(description.serverUrl),
        details: JSON.stringify({ headers: Object.keys(description.headers || {}).length, oauth: Boolean(description.oauth),
            staticToken: Boolean(description.serverAuthToken) })
    };
}

/** Read only cached state. The caller must not fetch tools or run a resolver to render a description. */
export function mcpPublicDescription(name: string, description: MCPServerDescription): McpPublicDescription {
    const credential = parseMcpCredentialReference((description as MCPServerDescription & { nextmuxCredential?: unknown }).nextmuxCredential);
    return {
        // Use the registry key verbatim so this remains a usable lookup identifier, not a new alias.
        name, nextmuxDisplayOnly: true,
        ...(typeof description.autostart === 'boolean' ? { autostart: description.autostart } : {}),
        ...(typeof description.deferLoading === 'boolean' ? { deferLoading: description.deferLoading } : {}),
        ...(Object.values(MCPServerStatus).includes(description.status!) ? { status: description.status } : {}),
        ...(description.error ? { error: description.error === 'MCP_SECURE_CONNECTION_FAILED'
            ? 'MCP_SECURE_CONNECTION_FAILED' : 'MCP_CONNECTION_FAILED' } : {}),
        ...('command' in description ? { command: 'Local process' }
            : { serverUrl: origin(description.serverUrl), ...(description.oauth ? { oauth: {} } : {}) }),
        ...(credential ? { nextmuxCredential: credential } : {})
    };
}
