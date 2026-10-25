import { injectable } from '@theia/core/shared/inversify';
import { MCPServerManagerImpl } from '@theia/ai-mcp/lib/node/mcp-server-manager-impl';
import type { MCPServer } from '@theia/ai-mcp/lib/node/mcp-server';
import type { MCPServerDescription, MCPFrontendNotificationService } from '@theia/ai-mcp/lib/common/mcp-server-manager';
import type { McpAccessChange, McpServerAccess, McpCredentialChange, McpCredentialChangeResult, McpInvocationContext } from '../common/nextmux-mcp-access';
import { compileMcpInputSchema, mcpFingerprint, McpToolPreflightError } from './nextmux-mcp-permissions';
import { canConfigureMcpCredential, credentialMcpDescription, McpCredentialStore } from './nextmux-mcp-credentials';
import { mcpFailureCode, NextMuxMcpServer } from './nextmux-mcp-server';
import { assertMcpConfigurationInput, mcpAccessSummary, mcpPublicDescription } from './nextmux-mcp-public-description';
import { readMcpFallbackConfig, type NextMuxMcpFallbackConfig } from './nextmux-mcp-fallback';
import type { McpAccessStore } from './nextmux-mcp-access-store';

import { managedDesktopMcpPreset, DESKTOP_MCP_BACKGROUND_MESSAGE } from './nextmux-mcp-desktop-policy';

/** User choices belong to the local app, while clients and browser sessions belong to their owning connections. */
@injectable()
export class NextMuxMcpServerManager extends MCPServerManagerImpl {
    protected grants = new Map<string, { fingerprint: string; tools: Map<string, string> }>();
    private mutation: Promise<unknown> = Promise.resolve();
    private revocations = new Map<string, number>();
    protected secureCredentials = new McpCredentialStore();
    private credentialChanges?: { dispose(): void };
    private diagnosticFailures = new Map<string, NonNullable<McpServerAccess['diagnostic']>>();
    private failureDetails = new Map<string, NonNullable<McpServerAccess['failure']>>();
    private browserSessions = new Map<string, { name: string; conversationId: string; server: NextMuxMcpServer; ready: Promise<void> }>();
    private browserOwners = new Map<string, string>();
    private accessStore?: McpAccessStore;
    private accessChanges?: { dispose(): void };
    private disconnected = false;
    private configuredDescriptions = new Map<string, MCPServerDescription>();

    /** Configured by the backend binding. Directly constructed test managers remain isolated. */
    configureAccessStore(store: McpAccessStore): void {
        this.accessChanges?.dispose();
        this.accessStore = store;
        this.accessChanges = store.subscribe((identity, tools, origin) => {
            if (origin === this || this.disconnected) return;
            for (const [name, server] of this.servers) {
                if (this.storedIdentity(name) !== identity) continue;
                this.revocations.set(name, (this.revocations.get(name) || 0) + 1);
                if (!tools) {
                    void this.revoke(name, false);
                    void server.stop().catch(() => undefined);
                } else {
                    this.grants.set(name, { fingerprint: this.identity(name), tools: new Map(tools) });
                    if (!server.isRunning()) void this.serial(async () => {
                        if (this.disconnected || !this.grants.has(name)) return;
                        await store.flush();
                        await this.startApproved(name, { interactive: false });
                    }).catch(() => undefined);
                }
            }
            this.notifySecureConfiguration();
        });
    }

    private async restoreAccess(name: string): Promise<void> {
        if (!this.accessStore || this.disconnected) return;
        const revision = this.revocations.get(name) || 0;
        await this.accessStore.ready();
        if (this.disconnected || revision !== (this.revocations.get(name) || 0)) return;
        const tools = this.accessStore.get(this.storedIdentity(name));
        if (!tools || this.servers.get(name)?.getCachedDescription().resolve) return;
        this.grants.set(name, { fingerprint: this.identity(name), tools: new Map(tools) });
        // A failed connection retains the user's choice and reports its real failure stage; it does not revoke consent.
        try { await this.startApproved(name, { interactive: false }); } catch { /* exposed by accessState */ }
    }

    private async persistAccess(name: string): Promise<void> {
        const grant = this.grants.get(name);
        if (this.accessStore && grant) {
            try { await this.accessStore.set(this.storedIdentity(name), [...grant.tools], this); }
            catch (error) {
                await this.revoke(name).catch(() => undefined);
                await this.servers.get(name)?.stop().catch(() => undefined);
                throw error;
            }
        }
    }

    /** Dispose only this conversation's managed clients, never the user's browser. */
    async releaseConversationSessions(conversationId: string): Promise<void> {
        await this.closeBrowserSessions(record => record.conversationId === conversationId);
        for (const [name, owner] of this.browserOwners) if (owner === conversationId) this.browserOwners.delete(name);
    }

    private async closeBrowserSessions(matches: (record: { name: string; conversationId: string }) => boolean): Promise<void> {
        const closing: Promise<unknown>[] = [];
        for (const [key, record] of this.browserSessions) if (matches(record)) {
            this.browserSessions.delete(key);
            // Closing the transport also interrupts an initialization request;
            // do not wait for a stuck handshake before releasing the process.
            closing.push(record.server.stop().catch(() => undefined));
            closing.push(record.ready.catch(() => undefined).then(() => record.server.stop()).catch(() => undefined));
        }
        await Promise.all(closing);
    }

    private async invocationServer(name: string, context?: McpInvocationContext): Promise<MCPServer> {
        const source = this.servers.get(name)!;
        const description = source.getCachedDescription();
        const preset = (description as MCPServerDescription & { nextmuxRuntimePreset?: string }).nextmuxRuntimePreset;
        if (!context?.conversationId || !['playwright', 'chrome-devtools'].includes(preset || '')) return source;
        if (!/^[\w.-]{1,160}$/.test(context.conversationId)) throw new McpToolPreflightError('MCP_CONVERSATION_INVALID');
        const args = 'args' in description ? description.args || [] : [];
        const env = 'env' in description ? description.env || {} : {};
        const attached = args.some(arg => /^--(?:cdp-endpoint|browser-url|browserUrl|wsEndpoint|autoConnect)(?:=|$)/.test(arg))
            || Boolean(env.PLAYWRIGHT_MCP_CDP_ENDPOINT);
        // An explicit CDP endpoint represents a shared browser. Claim it rather
        // than pretend a second MCP transport would isolate that same browser.
        if (preset !== 'playwright' || attached || !('command' in description)) {
            const owner = this.browserOwners.get(name);
            if (owner && owner !== context.conversationId) throw new McpToolPreflightError('MCP_BROWSER_SESSION_IN_USE');
            this.browserOwners.set(name, context.conversationId);
            return source;
        }
        const key = `${name}\0${context.conversationId}`;
        let record = this.browserSessions.get(key);
        if (record && !record.server.isRunning() && !record.server.isInFlight()) {
            this.browserSessions.delete(key);
            await record.server.stop().catch(() => undefined);
            record = undefined;
        }
        if (!record) {
            if (this.browserSessions.size >= 32) throw new McpToolPreflightError('MCP_BROWSER_SESSION_LIMIT');
            const grant = this.grants.get(name);
            const extension = args.includes('--extension') || /^(true|1)$/i.test(env.PLAYWRIGHT_MCP_EXTENSION || '');
            const server = this.createConversationServer({ ...description, autostart: false,
                env: { ...env, ...(!extension ? { PLAYWRIGHT_MCP_ISOLATED: 'true' } : {}) }
            }, name, `NextMux-${mcpFingerprint(context.conversationId).slice(0, 10)}`);
            server.setWorkspaceRoots(this.roots);
            const ready = (async () => {
                await server.start({ interactive: false });
                this.assertServer(name);
                if (grant !== this.grants.get(name)) throw new Error('MCP_APPROVAL_STALE');
                if (!server.isRunning()) throw new Error(server.getCachedDescription().error || 'MCP_BROWSER_CONNECTION_FAILED');
            })();
            record = { name, conversationId: context.conversationId, server, ready };
            this.browserSessions.set(key, record);
            // Observe a failed startup even if a cancelled caller no longer awaits it.
            void ready.catch(async () => {
                if (this.browserSessions.get(key)?.server === server) this.browserSessions.delete(key);
                await server.stop().catch(() => undefined);
            });
        }
        await this.waitForInitialization(record.ready, context.signal);
        context.signal?.throwIfAborted();
        if (this.browserSessions.get(key) !== record) throw new McpToolPreflightError('MCP_BROWSER_SESSION_CLOSED');
        return record.server;
    }

    protected createConversationServer(description: MCPServerDescription, name: string, clientName: string): NextMuxMcpServer {
        return new NextMuxMcpServer(description, this.oauthClientProviderFactory, this.secureCredentials, () => {
            this.assertServer(name);
            const grant = this.grants.get(name);
            return () => {
                this.assertServer(name);
                if (grant !== this.grants.get(name)) throw new McpToolPreflightError('MCP_APPROVAL_STALE');
            };
        }, clientName);
    }

    private async waitForInitialization(ready: Promise<void>, signal?: AbortSignal): Promise<void> {
        if (!signal) return ready;
        signal.throwIfAborted();
        let abort: () => void = () => {};
        try {
            await Promise.race([ready, new Promise<never>((_, reject) => {
                abort = () => reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
                signal.addEventListener('abort', abort, { once: true });
            })]);
        } finally { signal.removeEventListener('abort', abort); }
    }

    private clearFailure(name: string): void {
        this.diagnosticFailures.delete(name);
        this.failureDetails.delete(name);
    }

    private recordFailure(name: string, stage: NonNullable<McpServerAccess['failure']>['stage'], error: unknown,
        evidence?: NonNullable<McpServerAccess['failure']>): void {
        // Like Cline's connection lifecycle, retain the failure stage. Unlike a
        // raw stderr dump, these fixed codes are safe to send across the RPC.
        const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
        const code: NonNullable<McpServerAccess['failure']>['code'] = evidence?.code || mcpFailureCode(message);
        this.failureDetails.set(name, { stage: evidence?.stage || stage, code,
            ...(evidence?.exitCode !== undefined ? { exitCode: evidence.exitCode } : {}),
            ...(evidence?.signal ? { signal: evidence.signal } : {}),
            ...(evidence?.detail ? { detail: evidence.detail } : {}),
            ...(code === 'runtime_missing' && evidence?.runtime ? { runtime: evidence.runtime } : {}) });
        this.diagnosticFailures.set(name, code === 'runtime_missing' || code === 'browser_missing' ? 'dependency'
            : code === 'authentication' ? 'authentication' : 'connection');
    }

    override setClient(client: MCPFrontendNotificationService): void {
        super.setClient(client);
        this.disconnected = false;
        if (this.accessStore && !this.accessChanges) this.configureAccessStore(this.accessStore);
        this.credentialChanges?.dispose();
        this.credentialChanges = this.secureCredentials.onDidInvalidate(id => {
            let affected = false;
            for (const [name, server] of this.servers) {
                if (credentialMcpDescription(server.getCachedDescription())?.nextmuxCredential.id === id) {
                    this.revoke(name);
                    affected = true;
                    void server.stop().catch(() => undefined);
                }
            }
            if (affected) this.notifySecureConfiguration();
        });
    }

    override disconnectClient(client: MCPFrontendNotificationService): void {
        if (this.client === client) {
            this.disconnected = true;
            this.accessChanges?.dispose();
            this.accessChanges = undefined;
            this.credentialChanges?.dispose();
            this.credentialChanges = undefined;
            for (const name of this.servers.keys()) void this.revoke(name, false);
        }
        super.disconnectClient(client);
    }

    private revoke(name: string, forget = true): Promise<void> {
        this.grants.delete(name);
        this.revocations.set(name, (this.revocations.get(name) || 0) + 1);
        this.browserOwners.delete(name);
        const persisted = forget && this.accessStore && this.servers.has(name)
            ? this.accessStore.set(this.storedIdentity(name), undefined, this) : undefined;
        const closing = Promise.all([persisted, this.closeBrowserSessions(record => record.name === name)]).then(() => undefined);
        void closing.catch(() => undefined);
        return closing;
    }

    private serial<T>(action: () => Promise<T>): Promise<T> {
        const result = this.mutation.then(action, action);
        this.mutation = result.catch(() => undefined);
        return result;
    }

    private approvalDescription(name: string): MCPServerDescription {
        const server = this.servers.get(name);
        if (!server) throw new Error('MCP_SERVER_NOT_FOUND');
        // Packaged local presets are rewritten to the Electron-hosted runtime
        // during startup. Use the effective launch description for the grant
        // fingerprint, otherwise the grant made from the user locator becomes
        // stale as soon as the server connects and startup is rolled back.
        return server instanceof NextMuxMcpServer
            ? server.approvalDescription()
            : server.getCachedDescription();
    }

    protected override configurationOnly(description: MCPServerDescription): Omit<MCPServerDescription, 'status' | 'error' | 'tools' | 'resolve'> {
        const { nextmuxAddedAt: _addedAt, nextmuxSource: _source, ...configuration } = super.configurationOnly(description) as Record<string, unknown>;
        return configuration as Omit<MCPServerDescription, 'status' | 'error' | 'tools' | 'resolve'>;
    }

    private storedIdentity(name: string): string {
        return mcpFingerprint({ configuration: this.configurationOnly(this.configuredDescriptions.get(name) || this.approvalDescription(name)),
            runtime: this.configurationOnly(this.approvalDescription(name)) });
    }

    private identity(name: string): string {
        const description = this.approvalDescription(name);
        const credential = credentialMcpDescription(description)?.nextmuxCredential;
        return mcpFingerprint({ configuration: this.storedIdentity(name),
            credentialEpoch: credential ? this.secureCredentials.version(credential) : undefined });
    }

    private assertServer(name: string): void {
        if (this.grants.get(name)?.fingerprint !== this.identity(name)) throw new Error('MCP_START_APPROVAL_REQUIRED');
    }

    /**
     * Returns non-secret failover metadata for the registry bridge.  This is
     * intentionally read-only; fallback groups never grant MCP access and
     * every candidate still has to pass its own approval checks.
     */
    fallbackConfig(name: string): NextMuxMcpFallbackConfig {
        const server = this.servers.get(name);
        return readMcpFallbackConfig(server?.getCachedDescription());
    }

    override addOrUpdateServer(description: MCPServerDescription): Promise<void> {
        assertMcpConfigurationInput(description);
        const previous = this.configuredDescriptions.get(description.name) || this.servers.get(description.name)?.getCachedDescription();
        let interrupted: Promise<void> | undefined;
        if (previous && !this.haveSameConfiguration(previous, description)) {
            this.revoke(description.name);
            this.clearFailure(description.name);
            // Do not queue a configuration change behind the very handshake
            // it invalidated. Stop also fences late callbacks from that client.
            interrupted = this.servers.get(description.name)?.stop();
            void interrupted?.catch(() => undefined);
        }
        credentialMcpDescription(description); // An invalid replacement never retains the previous approval or falls back anonymously.
        return this.serial(async () => {
            await interrupted;
            const before = this.servers.has(description.name) ? this.identity(description.name) : undefined;
            const configured = this.configuredDescriptions.get(description.name);
            // A packaged launch rewrites the live command. Rediscovery of the same user locator must not undo that rewrite.
            if (!configured || !this.haveSameConfiguration(configured, description)) await this.upsertServer(description);
            if (before !== undefined && before !== this.identity(description.name)) await this.revoke(description.name);
            await this.accessStore?.flush();
            if (!this.grants.has(description.name)) await this.restoreAccess(description.name);
        });
    }

    private async upsertServer(description: MCPServerDescription): Promise<void> {
        assertMcpConfigurationInput(description);
        credentialMcpDescription(description);
        if (this.servers.has(description.name)) {
            await super.addOrUpdateServer(description);
            this.configuredDescriptions.set(description.name, description);
            this.clearFailure(description.name);
            return;
        }
        this.configuredDescriptions.set(description.name, description);
        const server = new NextMuxMcpServer(description, this.oauthClientProviderFactory, this.secureCredentials, () => {
            this.assertServer(description.name);
            const grant = this.grants.get(description.name);
            return () => {
                this.assertServer(description.name);
                if (grant !== this.grants.get(description.name)) throw new McpToolPreflightError('MCP_APPROVAL_STALE');
            };
        });
        server.setWorkspaceRoots(this.roots);
        this.servers.set(description.name, server);
        this.serverListeners.set(description.name, server.onDidUpdateStatus(() => this.notifySecureConfiguration()));
        this.notifySecureConfiguration();
    }

    private notifySecureConfiguration(): void {
        try { void Promise.resolve(this.client?.didUpdateMCPServers()).catch(() => undefined); } catch { /* A UI observer cannot roll back a stored locator. */ }
    }

    override async getServerDescription(name: string): ReturnType<MCPServerManagerImpl['getServerDescription']> {
        const server = this.servers.get(name);
        return server ? mcpPublicDescription(name, server.getCachedDescription()) : undefined;
    }

    protected override connectionDescription(description: MCPServerDescription): object {
        const metadata = description as MCPServerDescription & { cwd?: string; nextmuxRuntimePreset?: string };
        return { ...super.connectionDescription(description), cwd: metadata.cwd, nextmuxRuntimePreset: metadata.nextmuxRuntimePreset,
            nextmuxCredential: credentialMcpDescription(description)?.nextmuxCredential };
    }

    async changeCredential(change: McpCredentialChange): Promise<McpCredentialChangeResult> {
        if (!change || !['set', 'clear'].includes(change.action) || Object.keys(change).some(key => !['serverName', 'fingerprint', 'action', 'kind', 'value'].includes(key))) {
            throw new Error('MCP_CREDENTIAL_CHANGE_INVALID');
        }
        if (change.fingerprint !== this.identity(change.serverName)) throw new Error('MCP_APPROVAL_STALE');
        const description = this.servers.get(change.serverName)!.getCachedDescription();
        if (!('serverUrl' in description) || !canConfigureMcpCredential(description)) throw new Error('MCP_CREDENTIAL_CONFIGURATION_CONFLICT');
        const previous = credentialMcpDescription(description);
        // This happens before the first await, including a pending startup, tool-list or another mutation.
        const revoked = this.revoke(change.serverName);
        if (previous) this.secureCredentials.invalidate(previous.nextmuxCredential);
        const stopped = this.servers.get(change.serverName)!.stop();
        void stopped.catch(() => undefined);
        const revision = this.revocations.get(change.serverName);
        const expectedIdentity = this.identity(change.serverName);
        let credential: McpCredentialChangeResult['credential'];
        await this.serial(async () => {
            await revoked;
            if (revision !== this.revocations.get(change.serverName) || expectedIdentity !== this.identity(change.serverName)) throw new Error('MCP_APPROVAL_STALE');
            await stopped;
            if (change.action === 'set') {
                credential = await this.secureCredentials.replace(description, change.kind!, change.value!);
            } else {
                if (change.value !== undefined || change.kind !== undefined) throw new Error('MCP_CREDENTIAL_CHANGE_INVALID');
                if (previous) await this.secureCredentials.clear(previous);
            }
            // Even if another UI revokes while the keychain is pending, record the new locator without regranting anything.
            const { nextmuxCredential: _old, ...configuration } = description as typeof description & { nextmuxCredential?: unknown };
            await this.upsertServer({ ...configuration, autostart: false, ...(credential ? { nextmuxCredential: credential } : {}) } as MCPServerDescription);
            await this.revoke(change.serverName);
        });
        return { ...(credential ? { credential } : {}), servers: await this.accessState() };
    }

    override setWorkspaceRoots(roots: string[] | undefined): void {
        // MCP roots are discovery hints, not a sandbox. The per-run registry still requires full_access for MCP tools.
        super.setWorkspaceRoots(roots);
        for (const record of this.browserSessions.values()) record.server.setWorkspaceRoots(roots);
    }

    override async stopServer(name: string): Promise<void> {
        const closing = this.revoke(name);
        this.clearFailure(name);
        await Promise.all([closing, super.stopServer(name)]);
    }

    override removeServer(name: string): Promise<void> {
        const revoked = this.revoke(name);
        const stopped = this.servers.get(name)?.stop();
        void stopped?.catch(() => undefined);
        this.clearFailure(name);
        return this.serial(async () => {
            await revoked; await stopped; await super.removeServer(name);
            this.configuredDescriptions.delete(name);
            this.clearFailure(name);
        });
    }

    override signOut(name: string): Promise<void> {
        const revoked = this.revoke(name);
        return revoked.then(() => super.signOut(name));
    }

    async reviewAccess(name: string): Promise<readonly McpServerAccess[]> {
        await this.serial(async () => {
            const server = this.servers.get(name);
            if (!server) throw new Error('MCP_SERVER_NOT_FOUND');
            const current = server.getCachedDescription();
            if (current.resolve) {
                const resolved = await current.resolve(current);
                if (!resolved || resolved.name !== name) throw new Error('MCP_CONFIGURATION_UNRESOLVED');
                await this.upsertServer({ ...resolved, resolve: undefined });
                await this.revoke(name);
            }
        });
        return this.accessState();
    }

    override startServer(name: string, options?: { interactive?: boolean }): Promise<void> {
        return this.serial(() => this.startApproved(name, options));
    }

    private async startApproved(name: string, options?: { interactive?: boolean }): Promise<void> {
        const server = this.servers.get(name);
        if (!server) throw new Error('MCP_SERVER_NOT_FOUND');
        // Never execute variable resolvers or start a local process before explicit review.
        if (server.getCachedDescription().resolve) throw new Error('MCP_CONFIGURATION_REVIEW_REQUIRED');
        this.assertServer(name);
        const approved = this.grants.get(name);
        this.clearFailure(name);
        try {
            await server.start({ interactive: Boolean(options?.interactive) });
            // Revocation wins over the eventual transport outcome. A pending
            // startup may resolve after Stop was pressed without ever reaching
            // Running; that is not a new connection failure.
            this.assertServer(name);
            if (approved !== this.grants.get(name)) throw new Error('MCP_APPROVAL_STALE');
            // Theia's doStart handles a failed handshake internally and may
            // resolve in Errored state. A resolved Promise is not a connection.
            if (!server.isRunning()) {
                const description = server.getCachedDescription();
                throw new Error(description.error || (description.status === 'Authentication Required'
                    ? 'MCP_AUTHENTICATION_REQUIRED' : 'MCP_START_FAILED'));
            }
        } catch (error) {
            // Preserve known permission/secure-transport errors, never echo a
            // process error containing command arguments or credentials.
            const message = error instanceof Error ? error.message : '';
            if (/^MCP_(?:APPROVAL_STALE|START_APPROVAL_REQUIRED)$/.test(message)
                || approved !== this.grants.get(name)) {
                await server.stop().catch(() => undefined);
                throw new Error('MCP_APPROVAL_STALE');
            }
            const evidence = server instanceof NextMuxMcpServer ? server.failureEvidence() : undefined;
            this.recordFailure(name, evidence?.stage || 'startup', error, evidence);
            if (message.startsWith('MCP_SECURE_CONNECTION_FAILED')) throw error;
            throw new Error(`MCP_START_FAILED_${this.failureDetails.get(name)!.code.toUpperCase()}`);
        }
        this.notifySecureConfiguration();
    }

    async accessState(): Promise<readonly McpServerAccess[]> {
        return Promise.all([...this.servers.keys()].slice(0, 64).map(async name => {
            const server = this.servers.get(name)!;
            let description = server.getCachedDescription();
            let fingerprint = this.identity(name);
            const grant = this.grants.get(name);
            let listed: Awaited<ReturnType<MCPServerManagerImpl['getTools']>>['tools'] = [];
            let toolsTruncated = false;
            let listFailed = false;
            let listError: unknown;
            if (server.isRunning() && grant?.fingerprint === fingerprint) {
                try {
                    const all = (await server.getTools()).tools;
                    listed = all.slice(0, 4096); toolsTruncated = all.length > listed.length;
                } catch (error) { listFailed = true; listError = error; }
            }
            if (this.servers.get(name) !== server) throw new Error('MCP_CONFIGURATION_CHANGED');
            description = server.getCachedDescription();
            fingerprint = this.identity(name);
            const approved = grant === this.grants.get(name) && grant?.fingerprint === fingerprint;
            if (!approved) listed = [];
            // An old tools/list response must not clear a new startup failure,
            // or reintroduce errors after the user revoked this connection.
            if (approved && server.isRunning()) {
                if (listFailed) {
                    const evidence = server instanceof NextMuxMcpServer ? server.failureEvidence() : undefined;
                    this.recordFailure(name, evidence?.stage || 'tools', listError, evidence);
                }
                else this.clearFailure(name);
            }
            const lifecycleStatus = typeof description.status === 'string' ? description.status : undefined;
            const errored = lifecycleStatus === 'Errored' || lifecycleStatus === 'Authentication Required';
            const intentionallyStopped = lifecycleStatus === 'Not Running' || lifecycleStatus === 'Not Connected';
            if (approved && errored && description.error && !this.failureDetails.has(name)) {
                const evidence = server instanceof NextMuxMcpServer ? server.failureEvidence() : undefined;
                this.recordFailure(name, evidence?.stage || 'connection', description.error, evidence);
            }
            return {
                name, fingerprint, local: 'command' in description,
                ...mcpAccessSummary(description),
                running: server.isRunning(), approved, ...(lifecycleStatus ? { status: lifecycleStatus } : {}),
                needsReview: Boolean(description.resolve),
                diagnostic: description.resolve ? 'configuration' : this.diagnosticFailures.get(name)
                    ?? (!approved ? 'authorization' : errored ? 'connection' : !server.isRunning() ? intentionallyStopped ? 'stopped' : 'connection' : listFailed ? 'connection'
                        : !listed.length ? 'empty' : !listed.some(tool => grant?.tools.get(tool.name) === mcpFingerprint(tool)) ? 'tools' : 'ready'),
                ...(this.failureDetails.has(name) ? { failure: this.failureDetails.get(name)! } : {}),
                ...(toolsTruncated ? { toolsTruncated: true } : {}),
                credentialEditable: canConfigureMcpCredential(description),
                ...(credentialMcpDescription(description) ? { credential: credentialMcpDescription(description)!.nextmuxCredential } : {}),
                tools: listed.map(tool => {
                    let supported = true;
                    try { compileMcpInputSchema(tool.inputSchema); } catch { supported = false; }
                    const toolFingerprint = mcpFingerprint(tool);
                    return { name: tool.name, description: (tool.description || '').slice(0, 2000), fingerprint: toolFingerprint,
                        supported, approved: supported && grant?.tools.get(tool.name) === toolFingerprint };
                })
            };
        }));
    }

    async changeAccess(change: McpAccessChange): Promise<readonly McpServerAccess[]> {
        const name = change.serverName;
        // Withdraw authority immediately, even while a previous approval is
        // waiting for tools/list or a startup handshake. Cleanup stays ordered.
        const closing = change.action === 'revoke' ? Promise.all([
            this.revoke(name),
            // Interrupt the handshake now; waiting for the mutation queue can
            // leave Stop blocked behind that same handshake's timeout.
            this.servers.get(name)?.stop().catch(() => undefined)
        ]) : undefined;
        if (change.action === 'tools' && Array.isArray(change.tools) && change.tools.length <= 4096
            && change.tools.every(tool => tool && typeof tool.name === 'string' && typeof tool.fingerprint === 'string')) {
            const grant = this.grants.get(name);
            if (grant && change.fingerprint === grant.fingerprint && grant.fingerprint === this.identity(name)) {
                // Unchecking a tool withdraws it synchronously. New grants
                // still wait for the complete current schema validation below.
                const retained = new Map([...grant.tools].filter(([toolName, fingerprint]) =>
                    change.tools!.some(tool => tool.name === toolName && tool.fingerprint === fingerprint)));
                if (retained.size !== grant.tools.size) {
                    grant.tools = retained;
                    this.revocations.set(name, (this.revocations.get(name) || 0) + 1);
                    void this.persistAccess(name).catch(() => undefined);
                }
            }
        }
        const revision = this.revocations.get(name) || 0;
        await this.serial(async () => {
            await this.accessStore?.ready();
            if (change.action === 'revoke') {
                this.clearFailure(name);
                await Promise.all([closing, super.stopServer(name)]);
                return;
            }
            if (revision !== (this.revocations.get(name) || 0)) throw new Error('MCP_APPROVAL_STALE');
            if (change.fingerprint !== this.identity(name)) throw new Error('MCP_APPROVAL_STALE');
            if (change.action === 'start') {
                // A double click or delayed duplicate must not reset a live
                // client's tool approvals or replace its active sessions.
                if (this.servers.get(name)?.isRunning() && this.grants.get(name)?.fingerprint === change.fingerprint) return;
                const previous = this.grants.get(name);
                this.grants.set(name, { fingerprint: change.fingerprint,
                    tools: previous?.fingerprint === change.fingerprint ? previous.tools : new Map() });
                await this.persistAccess(name);
                if (revision !== (this.revocations.get(name) || 0)) throw new Error('MCP_APPROVAL_STALE');
                await this.startApproved(name, { interactive: true });
            } else if (change.action === 'tools') {
                this.assertServer(name);
                if (!Array.isArray(change.tools) || change.tools.length > 4096) throw new Error('MCP_TOOL_APPROVAL_INVALID');
                const expected = this.grants.get(name)!;
                const listed = (await super.getTools(name)).tools;
                const next = new Map<string, string>();
                for (const requested of change.tools) {
                    const tool = listed.find(item => item.name === requested.name);
                    if (!tool || mcpFingerprint(tool) !== requested.fingerprint) throw new Error('MCP_TOOL_APPROVAL_STALE');
                    compileMcpInputSchema(tool.inputSchema);
                    next.set(tool.name, requested.fingerprint);
                }
                this.assertServer(name);
                if (expected !== this.grants.get(name) || revision !== (this.revocations.get(name) || 0)) throw new Error('MCP_APPROVAL_STALE');
                expected.tools = next;
                await this.persistAccess(name);
            } else throw new Error('MCP_APPROVAL_INVALID');
        });
        return this.accessState();
    }

    desktopBackgroundWarning(name: string): string | undefined {
        return managedDesktopMcpPreset(this.servers.get(name)?.getCachedDescription()) ? DESKTOP_MCP_BACKGROUND_MESSAGE : undefined;
    }

    private desktopCatalogFilter(server: MCPServer): (tool: { readonly name: string; readonly inputSchema: unknown }) => boolean {
        const description = server.getCachedDescription();
        if (!managedDesktopMcpPreset(description)) return () => true;
        return server instanceof NextMuxMcpServer ? server.desktopBackgroundPolicy()?.catalogFilter(description) || (() => false) : () => false;
    }

    private desktopToolAllowed(server: MCPServer, tool: { readonly name: string; readonly inputSchema: unknown }): boolean {
        const description = server.getCachedDescription();
        if (!managedDesktopMcpPreset(description)) return true;
        return server instanceof NextMuxMcpServer && server.desktopBackgroundPolicy()?.permits(description, tool) === true;
    }

    async approvedToolIdentity(name: string, toolName: string): Promise<string> {
        this.assertServer(name);
        const grant = this.grants.get(name)!;
        const listed = await super.getTools(name);
        const tool = listed.tools.find(item => item.name === toolName);
        if (!tool || grant.tools.get(toolName) !== mcpFingerprint(tool)) throw new Error('MCP_TOOL_APPROVAL_REQUIRED');
        this.assertServer(name);
        if (grant !== this.grants.get(name)) throw new Error('MCP_APPROVAL_STALE');
        if (!this.desktopToolAllowed(this.servers.get(name)!, tool)) throw new McpToolPreflightError('MCP_DESKTOP_BACKGROUND_UNSUPPORTED');
        return mcpFingerprint({ server: grant.fingerprint, tool });
    }

    /** One tools/list snapshot per server, not one network read per tool. */
    async approvedToolCatalog(name: string): Promise<readonly { tool: Awaited<ReturnType<MCPServerManagerImpl['getTools']>>['tools'][number]; identity: string }[]> {
        this.assertServer(name);
        const grant = this.grants.get(name)!;
        const listed = await super.getTools(name);
        this.assertServer(name);
        if (grant !== this.grants.get(name)) throw new Error('MCP_APPROVAL_STALE');
        const desktopFilter = this.desktopCatalogFilter(this.servers.get(name)!);
        return listed.tools.slice(0, 4096).flatMap(tool => {
            try {
                if (grant.tools.get(tool.name) !== mcpFingerprint(tool) || !desktopFilter(tool)) return [];
                return [{ tool, identity: mcpFingerprint({ server: grant.fingerprint, tool }) }];
            } catch { return []; }
        });
    }

    override async getTools(name: string): ReturnType<MCPServerManagerImpl['getTools']> {
        this.assertServer(name);
        const grant = this.grants.get(name);
        const result = await super.getTools(name);
        this.assertServer(name);
        if (grant !== this.grants.get(name)) throw new Error('MCP_APPROVAL_STALE');
        return result;
    }

    override async callTool(name: string, toolName: string, argumentsJson: string): ReturnType<MCPServerManagerImpl['callTool']> {
        return this.callApprovedTool(name, toolName, argumentsJson);
    }

    async callApprovedTool(name: string, toolName: string, argumentsJson: string, expectedIdentity?: string, context?: McpInvocationContext): ReturnType<MCPServerManagerImpl['callTool']> {
        context?.signal?.throwIfAborted();
        let approvedTool: { readonly name: string; readonly inputSchema: unknown } | undefined;
        let reason = 'MCP_START_APPROVAL_REQUIRED';
        try {
            this.assertServer(name);
            const grant = this.grants.get(name)!;
            reason = 'MCP_TOOL_LIST_UNAVAILABLE';
            const source = this.servers.get(name)!;
            const listed = (await (source instanceof NextMuxMcpServer ? source.getTools(context?.signal) : source.getTools())).tools;
            const tool = listed.find(item => item.name === toolName);
            reason = 'MCP_TOOL_APPROVAL_REQUIRED';
            if (!tool || grant.tools.get(toolName) !== mcpFingerprint(tool)) throw new Error();
            reason = 'MCP_TOOL_IDENTITY_CHANGED';
            if (expectedIdentity && expectedIdentity !== mcpFingerprint({ server: grant.fingerprint, tool })) throw new Error();
            reason = 'MCP_ARGUMENTS_INVALID';
            if (typeof argumentsJson !== 'string' || Buffer.byteLength(argumentsJson) > 20_000) throw new Error();
            const input = JSON.parse(argumentsJson);
            if (!compileMcpInputSchema(tool.inputSchema).validate(input)) throw new Error();
            reason = 'MCP_APPROVAL_STALE';
            this.assertServer(name);
            if (grant !== this.grants.get(name) || grant.tools.get(toolName) !== mcpFingerprint(tool)) throw new Error();
            reason = 'MCP_DESKTOP_BACKGROUND_UNSUPPORTED';
            if (!this.desktopToolAllowed(source, tool)) throw new Error();
            approvedTool = tool;
        } catch {
            context?.signal?.throwIfAborted();
            // Only this pre-dispatch block is classified retryable. In
            // particular, a remote error with the same text is not trusted.
            throw new McpToolPreflightError(reason);
        }
        const grant = this.grants.get(name)!;
        const revision = this.revocations.get(name);
        const target = (await this.invocationServer(name, context))!;
        context?.signal?.throwIfAborted();
        this.assertServer(name);
        if (grant !== this.grants.get(name)) throw new McpToolPreflightError('MCP_APPROVAL_STALE');
        if (target !== this.servers.get(name)) {
            const tool = (await (target instanceof NextMuxMcpServer ? target.getTools(context?.signal) : target.getTools())).tools.find(item => item.name === toolName);
            if (!tool || grant.tools.get(toolName) !== mcpFingerprint(tool)) throw new McpToolPreflightError('MCP_TOOL_IDENTITY_CHANGED');
        }
        context?.signal?.throwIfAborted();
        this.assertServer(name);
        if (grant !== this.grants.get(name) || revision !== this.revocations.get(name)) throw new McpToolPreflightError('MCP_APPROVAL_STALE');
        if (!approvedTool || !this.desktopToolAllowed(target, approvedTool)) throw new McpToolPreflightError('MCP_DESKTOP_BACKGROUND_UNSUPPORTED');
        const result = target instanceof NextMuxMcpServer
            ? await target.callTool(toolName, argumentsJson, context?.signal)
            : await target.callTool(toolName, argumentsJson);
        try {
            this.assertServer(name);
            if (grant !== this.grants.get(name) || revision !== this.revocations.get(name)) throw new Error();
        } catch {
            // An already dispatched effect cannot be undone or safely retried.
            // Do not attach stale output to a newly authorized run/credential.
            throw new Error('MCP_TOOL_RESULT_STALE');
        }
        return result;
    }

    // Resource reads are a separate privilege, not an implicit side effect of tool approval.
    override async readResource(): ReturnType<MCPServerManagerImpl['readResource']> { throw new Error('MCP_RESOURCE_APPROVAL_UNSUPPORTED'); }
    override async getResources(): ReturnType<MCPServerManagerImpl['getResources']> { throw new Error('MCP_RESOURCE_APPROVAL_UNSUPPORTED'); }
}
