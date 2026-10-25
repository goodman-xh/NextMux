import { randomUUID } from 'crypto';
import * as keytar from 'keytar';
import type { MCPServerDescription, RemoteMCPServerDescription } from '@theia/ai-mcp/lib/common/mcp-server-manager';
import { parseMcpCredentialReference, type McpCredentialReference } from '../common/nextmux-mcp-access';
import { McpToolPreflightError } from './nextmux-mcp-permissions';

export type CredentialMcpDescription = RemoteMCPServerDescription & { nextmuxCredential: McpCredentialReference };
type SecretStore = Pick<typeof keytar, 'getPassword' | 'setPassword' | 'deletePassword'>;
type MutationState = { epoch: number; blocked: boolean };
// Shared by frontend connections in this backend process. No credentials are cached here.
const credentialMutations = new Map<string, MutationState>();
const mutationListeners = new WeakMap<Map<string, MutationState>, Set<(id: string) => void>>();
const service = 'NextMux';
const account = (ref: McpCredentialReference): string => `mcp-credential:${ref.id}`;

export function mcpCredentialEndpoint(value: string): string {
    if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) throw new Error('MCP_CREDENTIAL_ENDPOINT_INVALID');
    let url: URL;
    try { url = new URL(value); } catch { throw new Error('MCP_CREDENTIAL_ENDPOINT_INVALID'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.href !== `${url.origin}${url.pathname}`) throw new Error('MCP_CREDENTIAL_ENDPOINT_INVALID');
    return url.href;
}

export function credentialMcpDescription(description: MCPServerDescription): CredentialMcpDescription | undefined {
    const ref = parseMcpCredentialReference((description as unknown as Record<string, unknown>).nextmuxCredential);
    if (!ref) return undefined;
    if (!('serverUrl' in description) || description.oauth || description.serverAuthToken || description.serverAuthTokenHeader
        || Object.keys(description.headers || {}).length) throw new Error('MCP_CREDENTIAL_CONFIGURATION_CONFLICT');
    mcpCredentialEndpoint(description.serverUrl);
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(description.name) || ['__proto__', 'constructor', 'prototype'].includes(description.name)) throw new Error('MCP_NAME_INVALID');
    return { ...description, nextmuxCredential: ref };
}

export function canConfigureMcpCredential(description: MCPServerDescription): boolean {
    try {
        if (!('serverUrl' in description) || description.resolve || description.oauth || description.serverAuthToken || description.serverAuthTokenHeader
            || Object.keys(description.headers || {}).length || !/^[a-zA-Z0-9._-]{1,64}$/.test(description.name)
            || ['__proto__', 'constructor', 'prototype'].includes(description.name)) return false;
        mcpCredentialEndpoint(description.serverUrl);
        credentialMcpDescription(description);
        return true;
    } catch { return false; }
}

function validateValue(value: string): void {
    if (typeof value !== 'string' || !value || value.length > 8192 || /[^\x21-\x7e]/.test(value)) throw new Error('MCP_CREDENTIAL_VALUE_INVALID');
}

/** Only this Node class touches the OS keystore. Errors never include store/provider diagnostics. */
export class McpCredentialStore {
    constructor(private readonly secrets: SecretStore = keytar, private readonly mutations = credentialMutations) {}

    invalidate(ref: McpCredentialReference): void {
        this.mutations.set(ref.id, { epoch: (this.mutations.get(ref.id)?.epoch || 0) + 1, blocked: true });
        for (const listener of mutationListeners.get(this.mutations) || []) {
            try { listener(ref.id); } catch { /* A frontend observer cannot prevent credential revocation. */ }
        }
    }

    onDidInvalidate(listener: (id: string) => void): { dispose(): void } {
        let listeners = mutationListeners.get(this.mutations);
        if (!listeners) { listeners = new Set(); mutationListeners.set(this.mutations, listeners); }
        listeners.add(listener);
        return { dispose: () => { listeners!.delete(listener); } };
    }

    private state(ref: McpCredentialReference): MutationState { return this.mutations.get(ref.id) || { epoch: 0, blocked: false }; }

    version(ref: McpCredentialReference): number { return this.state(ref).epoch; }

    private async record(description: CredentialMcpDescription): Promise<Record<string, unknown>> {
        let raw: string | null;
        try { raw = await this.secrets.getPassword(service, account(description.nextmuxCredential)); }
        catch { throw new McpToolPreflightError('MCP_KEYCHAIN_UNAVAILABLE'); }
        let value: Record<string, unknown>;
        try {
            if (!raw || raw.length > 12_000) throw new Error();
            value = JSON.parse(raw);
            const ref = description.nextmuxCredential;
            if (!value || value.version !== 1 || value.id !== ref.id || value.revision !== ref.revision || value.kind !== ref.kind
                || value.serverName !== description.name || value.endpoint !== mcpCredentialEndpoint(description.serverUrl)) throw new Error();
            validateValue(value.value as string);
        } catch { throw new McpToolPreflightError('MCP_CREDENTIAL_UNAVAILABLE'); }
        return value;
    }

    async read(description: CredentialMcpDescription): Promise<{ value: string; assertCurrent: () => void }> {
        const ref = description.nextmuxCredential;
        const epoch = this.state(ref).epoch;
        const assertCurrent = (): void => {
            if (this.state(ref).blocked || this.state(ref).epoch !== epoch) throw new McpToolPreflightError('MCP_CREDENTIAL_CHANGED');
        };
        assertCurrent();
        const record = await this.record(description);
        assertCurrent();
        return { value: record.value as string, assertCurrent };
    }

    async replace(description: RemoteMCPServerDescription, kind: McpCredentialReference['kind'], value: string): Promise<McpCredentialReference> {
        validateValue(value);
        if (!['bearer', 'x-api-key', 'api-key'].includes(kind)) throw new Error('MCP_CREDENTIAL_KIND_INVALID');
        const previous = credentialMcpDescription(description);
        let ref: McpCredentialReference = { id: previous?.nextmuxCredential.id || randomUUID(), revision: randomUUID(), kind };
        credentialMcpDescription({ ...description, nextmuxCredential: ref } as CredentialMcpDescription);
        this.invalidate(ref);
        if (previous) {
            try { await this.record(previous); }
            catch (error) {
                if (!(error instanceof McpToolPreflightError) || error.reason !== 'MCP_CREDENTIAL_UNAVAILABLE') throw error;
                // Explicit re-entry after a lost preference write/import can repair the locator.
                // Never overwrite, delete or reuse the secret behind an unmatched reference.
                ref = { ...ref, id: randomUUID() };
                this.invalidate(ref);
            }
        }
        try {
            await this.secrets.setPassword(service, account(ref), JSON.stringify({ version: 1, ...ref,
                serverName: description.name, endpoint: mcpCredentialEndpoint(description.serverUrl), value }));
        } catch { throw new Error('MCP_KEYCHAIN_UNAVAILABLE'); }
        this.mutations.set(ref.id, { epoch: this.state(ref).epoch, blocked: false });
        return ref;
    }

    async clear(description: CredentialMcpDescription): Promise<void> {
        this.invalidate(description.nextmuxCredential);
        await this.record(description);
        try { await this.secrets.deletePassword(service, account(description.nextmuxCredential)); }
        catch { throw new Error('MCP_KEYCHAIN_UNAVAILABLE'); }
        // Keep old live transports blocked even if deleting an already absent item returned false.
    }
}

/** SDK fetch seam: inject only after scope/epoch checks and never follow an authentication-bearing redirect. */
export function createAuthenticatedMcpFetch(options: {
    description: CredentialMcpDescription; store: McpCredentialStore; assertAccess: () => void; fetchImpl?: typeof fetch;
}): typeof fetch {
    const description = credentialMcpDescription(options.description)!;
    const endpoint = mcpCredentialEndpoint(description.serverUrl);
    const kind = description.nextmuxCredential.kind;
    return async (input, init) => {
        const target = input instanceof Request ? input.url : String(input);
        if (mcpCredentialEndpoint(target) !== endpoint || !['GET', 'POST', 'DELETE'].includes((init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase())) {
            throw new McpToolPreflightError('MCP_CREDENTIAL_ENDPOINT_CHANGED');
        }
        options.assertAccess();
        const signal = init?.signal || (input instanceof Request ? input.signal : undefined);
        if (signal?.aborted) throw new McpToolPreflightError('MCP_REQUEST_CANCELLED');
        const credential = await options.store.read(description);
        options.assertAccess();
        credential.assertCurrent();
        if (signal?.aborted) throw new McpToolPreflightError('MCP_REQUEST_CANCELLED');
        const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
        for (const name of ['authorization', 'x-api-key', 'api-key', 'cookie', 'proxy-authorization', 'host']) {
            if (headers.has(name)) throw new McpToolPreflightError('MCP_CREDENTIAL_HEADER_CONFLICT');
        }
        headers.set(kind === 'bearer' ? 'Authorization' : kind, kind === 'bearer' ? `Bearer ${credential.value}` : credential.value);
        options.assertAccess();
        credential.assertCurrent();
        let response: Response;
        try { response = await (options.fetchImpl || fetch)(input, { ...init, headers, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' }); }
        catch { throw new Error('MCP_HTTPS_REQUEST_FAILED'); }
        if (!response.ok) {
            void response.body?.cancel().catch(() => undefined);
            // SDK otherwise embeds an arbitrary error response body in its error/log output.
            return new Response(null, { status: response.status, statusText: 'MCP_HTTP_ERROR' });
        }
        return response;
    };
}
