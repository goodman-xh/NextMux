import { MCPServer } from '@theia/ai-mcp/lib/node/mcp-server';
import { MCPServerStatus, type MCPServerDescription } from '@theia/ai-mcp/lib/common/mcp-server-manager';
import type { MCPOAuthClientProviderFactory } from '@theia/ai-mcp/lib/node/mcp-oauth-client-provider-factory';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { MCPOAuthClientProvider } from '@theia/ai-mcp/lib/node/mcp-oauth-client-provider';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { CallToolResultSchema, ListRootsRequestSchema, ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { execFile, type ChildProcess } from 'node:child_process';
import { posixDescendantProcessIds, terminatePosixProcesses } from './nextmux-process-tree';
import { credentialMcpDescription, createAuthenticatedMcpFetch, McpCredentialStore } from './nextmux-mcp-credentials';
import { MCP_TEXT_MAX_CHARS, truncateMcpToolTextHeadTail } from './nextmux-mcp-images';
import { McpToolPreflightError } from './nextmux-mcp-permissions';
import { defaultPackagedMcpRuntimeOptions, resolvePackagedMcpRuntime, type LocalMcpRuntimeDescription } from './nextmux-mcp-runtime';
import { captureDesktopMcpBackgroundPolicy, type DesktopMcpBackgroundPolicy } from './nextmux-mcp-desktop-policy';
import { mcpChildEnvironment, mcpLauncherRuntime, resolveMcpLauncherSync, type McpLauncherRuntime } from './nextmux-mcp-launch';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { OAuthError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { MCPOAuthCancelledError } from '@theia/ai-mcp/lib/node/mcp-oauth-callback-service';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
export type NextMuxMcpFailureEvidence = {
    readonly stage: 'startup' | 'connection' | 'tools';
    readonly code: 'runtime_missing' | 'browser_missing' | 'permission_denied' | 'timeout' | 'authentication' | 'process_exit' | 'protocol' | 'connection';
    readonly exitCode?: number;
    readonly signal?: string;
    readonly detail?: string;
    /** Only for runtime_missing: the well-known launcher (uvx/npx/docker) that could not be found. */
    readonly runtime?: McpLauncherRuntime;
};

/**
 * The upstream transport intentionally exposes only a boolean lifecycle.  A
 * small subclass lets us observe a local child's exit and stderr without
 * replacing the MCP protocol implementation.  stdout remains exclusively
 * owned by the SDK's JSON-RPC reader.
 */
class NextMuxStdioClientTransport extends StdioClientTransport {
    onProcessExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
    onProcessError?: (error: Error) => void;
    private observed = false;
    private processClosed?: Promise<void>;
    private knownDescendants: number[] = [];

    addDescendants(pids: readonly number[]): void {
        for (const pid of pids) {
            if (!this.knownDescendants.includes(pid)) {
                this.knownDescendants.push(pid);
            }
        }
    }

    override start(): Promise<void> {
        const started = super.start();
        const child = (this as unknown as { _process?: ChildProcess })._process;
        if (child && !this.observed) {
            this.observed = true;
            child.once('error', error => this.onProcessError?.(error));
            child.once('exit', () => {
                if (this.knownDescendants.length > 0) {
                    void terminatePosixProcesses(this.knownDescendants);
                }
            });
            this.processClosed = new Promise(resolve => child.once('close', (code, signal) => {
                this.onProcessExit?.(code, signal);
                resolve();
            }));
        }
        return started;
    }

    override async close(): Promise<void> {
        if (this.pid && process.platform !== 'win32') {
            this.addDescendants(await posixDescendantProcessIds(this.pid));
        }
        try {
            await super.close();
        } finally {
            if (this.knownDescendants.length > 0) {
                await terminatePosixProcesses(this.knownDescendants);
            }
        }
        // The SDK returns just after SIGKILL. Wait for actual exit before a
        // retry can spawn a replacement; the server bounds this cleanup wait.
        await this.processClosed;
    }
}

function redactMcpDiagnostic(value: unknown): string | undefined {
    const source = value instanceof Error ? value.message : typeof value === 'string' ? value : '';
    if (!source.trim()) return undefined;
    const redacted = source
        .replace(/[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, '')
        .replace(/\b(?:authorization|proxy-authorization|cookie|set-cookie)["']?\s*[:=]\s*[^\r\n]+/gi, '[redacted]')
        .replace(/\b[a-z0-9_-]*?(?:api[_-]?key|(?:access[_-]?|refresh[_-]?|id[_-]?|auth[_-]?|session[_-]?)?token|secret|password|private[_-]?key)["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi, '[redacted]')
        .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '[redacted]')
        .replace(/https?:\/\/[^\s)\]}]+/gi, '[url]')
        .replace(/(?:\/Users\/|\/home\/|\/private\/|\/var\/|[A-Za-z]:[\\/])[^\s)\]}]+/g, '[path]')
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return redacted ? redacted.slice(0, 360) : undefined;
}

/**
 * One classifier for every MCP failure, local or remote, so the panel and the manager never disagree.
 * A missing executable shows up as ENOENT from spawn, as a shell's exit code (127 on macOS/Linux, 9009 from
 * cmd.exe) or as cmd.exe's message in English or Chinese.
 */
export function mcpFailureCode(message: string, exitCode?: number): NextMuxMcpFailureEvidence['code'] {
    return /browser.*(?:not (?:found|installed)|missing)|executable doesn't exist|playwright.*install|packaged Chromium is missing/i.test(message) ? 'browser_missing'
        : exitCode === 9009 || exitCode === 127
            || /ENOENT|command not found|not recognized as an internal or external command|不是内部或外部命令|系统找不到指定的(?:路径|文件)|MCP_RUNTIME_(?:UNAVAILABLE|MANIFEST_INVALID)|MODULE_NOT_FOUND|cannot find module/i.test(message) ? 'runtime_missing'
            : /EACCES|EPERM|permission denied/i.test(message) ? 'permission_denied'
                : /\b(?:401|403)\b|unauthori[sz]ed|unauthenticated|authentication|credential|oauth|invalid[ _]token|missing[ _]token/i.test(message) ? 'authentication'
                    : /timed?\s*out|timeout|ETIMEDOUT/i.test(message) ? 'timeout'
                        : /connection[ _]closed|process.*exit|EPIPE|SIGPIPE|MCP.*-32000/i.test(message) ? 'process_exit'
                            : /parse error|invalid.*(?:json|rpc)|unexpected token|protocol.*(?:invalid|error)/i.test(message) ? 'protocol' : 'connection';
}

/** Reuse the SDK protocol and Theia client; isolate only the credential-bearing transport lifecycle. */
/**
 * Fetch for a remote MCP server's own requests. A redirect is followed only within the server's origin: headers a
 * server is configured with (an API key header, a token, OAuth) never reach another site (audit B07-001).
 */
function sameOriginMcpFetch(extraHeaders?: Record<string, string>): typeof fetch {
    return async (url, init) => {
        let target = new URL(url instanceof Request ? url.url : url.toString());
        const headers = new Headers(init?.headers);
        for (const [name, value] of Object.entries(extraHeaders || {})) if (!headers.has(name)) headers.set(name, value);
        let request: RequestInit = { ...init, headers, redirect: 'manual' };
        for (let hop = 0; hop < 5; hop++) {
            const response = await fetch(target, request);
            const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
            if (!location) return response;
            const next = new URL(location, target);
            await response.body?.cancel().catch(() => undefined);
            if (next.origin !== target.origin) throw new Error('MCP_REDIRECT_TO_OTHER_SITE');
            if (response.status === 303) request = { ...request, method: 'GET', body: undefined };
            target = next;
        }
        throw new Error('MCP_TOO_MANY_REDIRECTS');
    };
}

export class NextMuxMcpServer extends MCPServer {
    private lifecycle = 0;
    private desktopPolicy?: DesktopMcpBackgroundPolicy;

    desktopBackgroundPolicy(): DesktopMcpBackgroundPolicy | undefined { return this.desktopPolicy; }
    private readonly closingClients = new WeakSet<Client>();
    private localStderr = '';
    private localFailure?: NextMuxMcpFailureEvidence;
    private startup?: AbortController;
    private stopPromise?: Promise<void>;
    private readonly cleanup = new WeakMap<Client, Promise<void>>();
    private cachedTools?: {
        readonly client: Client;
        readonly listToolsFn: Client['listTools'];
        readonly tools: Awaited<ReturnType<MCPServer['getTools']>>['tools'];
    };

    protected startupTimeoutMs(interactive: boolean): number {
        const configured = Number(process.env.NEXTMUX_MCP_STARTUP_TIMEOUT_MS);
        // OAuth may require a human response, but even that attempt must finish.
        return Number.isFinite(configured) && configured > 0 ? Math.min(300_000, Math.max(1_000, configured))
            : interactive && 'serverUrl' in this.description && this.description.oauth ? 120_000 : 30_000;
    }

    protected callTimeoutMs(): number {
        const configured = Number(process.env.NEXTMUX_MCP_CALL_TIMEOUT_MS);
        return Number.isFinite(configured) && configured > 0 ? Math.min(300_000, Math.max(1_000, configured)) : 60_000;
    }

    protected cleanupTimeoutMs(): number { return 10_000; }

    private async until<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
        let abort: () => void = () => {};
        try {
            return await Promise.race([operation, new Promise<never>((_, reject) => {
                abort = () => reject(signal.reason);
                signal.addEventListener('abort', abort, { once: true });
                if (signal.aborted) abort();
            })]);
        } finally { signal.removeEventListener('abort', abort); }
    }

    private async bounded<T>(operation: Promise<T>, timeout: number): Promise<T> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error('MCP cleanup timed out')), timeout);
        try { return await this.until(operation, controller.signal); }
        finally { clearTimeout(timer); }
    }

    override start(options: { interactive?: boolean } = {}): Promise<void> {
        if (this.startPromise) return this.startPromise;
        if (!this.stopPromise && this.isRunning()) return Promise.resolve();
        const stopping = this.stopPromise;
        const lifecycle = ++this.lifecycle;
        const controller = new AbortController();
        this.startup = controller;
        // Install the promise before publishing Starting: status listeners can
        // synchronously call start again. Each attempt owns its captured client.
        const starting = Promise.resolve().then(async () => {
            const timer = setTimeout(() => controller.abort(new Error('MCP startup timed out')), this.startupTimeoutMs(!!options.interactive));
            try {
                if (stopping) await this.until(stopping, controller.signal);
                controller.signal.throwIfAborted();
                this.error = undefined; this.localFailure = undefined; this.localStderr = '';
                this.suppressOAuthUnauthorizedErrors = false;
                this.setStatus('command' in this.description ? MCPServerStatus.Starting : MCPServerStatus.Connecting);
                if (this.client) await this.until(this.closeConnection(this.client, this.transport), controller.signal);
                controller.signal.throwIfAborted();
                await this.until(this.doStart({ interactive: !!options.interactive }), controller.signal);
            } catch (error) {
                if (lifecycle !== this.lifecycle) return; // deliberate stop/reconfiguration wins
                if (!this.localFailure) {
                    if ('command' in this.description) this.setLocalFailure('startup', error);
                    else this.localFailure = { stage: 'startup', code: mcpFailureCode(String(error)) };
                }
                const secure = 'serverUrl' in this.description && 'nextmuxCredential' in this.description;
                const code = this.localFailure?.code || 'connection';
                const failure = secure ? `MCP_SECURE_CONNECTION_FAILED: ${code}`
                    : code === 'timeout' ? 'MCP_STARTUP_TIMEOUT' : 'MCP_START_FAILED';
                this.error = secure ? 'MCP_SECURE_CONNECTION_FAILED' : failure;
                this.setStatus(MCPServerStatus.Errored);
                controller.abort(error);
                if (this.client) await this.closeConnection(this.client, this.transport).catch(() => undefined);
                throw new Error(failure);
            } finally {
                clearTimeout(timer);
                if (this.startPromise === starting) this.startPromise = undefined;
            }
        });
        this.startPromise = starting;
        return starting;
    }

    /** A timed-out close remains a retry barrier until that exact client exits. */
    private closeConnection(client: Client, transport: Transport): Promise<void> {
        let closing = this.cleanup.get(client);
        if (!closing) {
            this.closingClients.add(client);
            closing = (async () => {
                const pid = transport instanceof StdioClientTransport ? transport.pid : undefined;
                const descendants = pid && process.platform !== 'win32' ? await posixDescendantProcessIds(pid) : [];
                if (transport instanceof NextMuxStdioClientTransport && descendants.length > 0) {
                    transport.addDescendants(descendants);
                }
                if (pid && process.platform === 'win32') await this.killWindowsProcessTree(pid);
                if (transport instanceof StreamableHTTPClientTransport) {
                    // DELETE is best effort. It must never delay closing streams indefinitely.
                    await this.bounded(transport.terminateSession(), 1_000).catch(() => undefined);
                }
                try { await client.close(); }
                finally { if (descendants.length) await terminatePosixProcesses(descendants); }
            })();
            this.cleanup.set(client, closing);
            void closing.catch(() => { if (this.cleanup.get(client) === closing) this.cleanup.delete(client); });
        }
        return this.bounded(closing, this.cleanupTimeoutMs());
    }

    constructor(description: MCPServerDescription, factory: MCPOAuthClientProviderFactory,
        private readonly credentials: McpCredentialStore, private readonly captureAccess: () => () => void,
        private readonly clientName?: string) {
        super(description, factory);
    }

    protected override createClient(): Client {
        // Like OpenCode, expose roots even when no project is open yet. A later
        // project change must not require replacing an already approved client.
        const client = new Client({ name: this.clientName || 'NextMux', version: '1.0.0' }, {
            capabilities: { roots: { listChanged: true } }
        });
        client.setRequestHandler(ListRootsRequestSchema, async () => ({
            roots: (this.workspaceRoots || []).map(uri => ({ uri, name: uri.split('/').pop() || uri }))
        }));
        // A server that changes its tools says so; the access page reads the list again (at most every two seconds).
        // New tools still need their own approval (audit B07-003).
        let lastToolRefresh = 0;
        let pendingToolRefresh: ReturnType<typeof setTimeout> | undefined;
        client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
            if (this.client === client) this.cachedTools = undefined;
            if (pendingToolRefresh) return;
            pendingToolRefresh = setTimeout(() => {
                pendingToolRefresh = undefined;
                lastToolRefresh = Date.now();
                if (this.client === client && this.isRunning()) this.onDidUpdateStatusEmitter.fire(this.status);
            }, Math.max(0, 2_000 - (Date.now() - lastToolRefresh)));
        });
        return client;
    }

    override setWorkspaceRoots(roots: string[] | undefined): void {
        this.workspaceRoots = roots;
        if (this.isRunning()) void this.client.sendRootsListChanged().catch(() => undefined);
    }

    /**
     * Return the command that will actually be executed for approval identity
     * checks. Packaged presets are rewritten to Electron's embedded runtime at
     * startup; hashing the user-facing `npx`/`uvx` locator instead would make a
     * valid approval look stale immediately after the handshake and the manager
     * would stop the server. Resolution is read-only and returns the original
     * description when the payload is unavailable (the startup path still
     * reports the concrete runtime error).
     */
    approvalDescription(): MCPServerDescription {
        if (!('command' in this.description)) return this.description;
        const runtime = resolvePackagedMcpRuntime(this.description as LocalMcpRuntimeDescription, defaultPackagedMcpRuntimeOptions());
        return 'description' in runtime ? runtime.description as MCPServerDescription : this.description;
    }

    /** A bounded, redacted diagnostic suitable for the access RPC/UI. */
    failureEvidence(): NextMuxMcpFailureEvidence | undefined {
        return this.localFailure ? { ...this.localFailure } : undefined;
    }

    private localFailureDetail(): string | undefined {
        return this.localFailure?.detail;
    }

    private appendLocalStderr(chunk: unknown): void {
        const text = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : '';
        if (!text) return;
        this.localStderr = `${this.localStderr}${text}`;
        // Keep only a small tail: stderr is diagnostic evidence, never a
        // transcript.  The redaction happens again when it is published.
        if (Buffer.byteLength(this.localStderr, 'utf8') > 8_192) this.localStderr = this.localStderr.slice(-8_192);
    }

    private setLocalFailure(stage: NextMuxMcpFailureEvidence['stage'], error: unknown, extra?: { exitCode?: number; signal?: string }): void {
        const raw = [this.localStderr, redactMcpDiagnostic(error)].filter(Boolean).join(' ').trim();
        const message = raw || 'MCP local process failed';
        const code = mcpFailureCode(message, extra?.exitCode);
        const runtime = code === 'runtime_missing' && 'command' in this.description ? mcpLauncherRuntime(this.localDescription().command) : undefined;
        this.localFailure = {
            stage,
            code,
            ...(runtime ? { runtime } : {}),
            ...(extra?.exitCode !== undefined && Number.isSafeInteger(extra.exitCode) && extra.exitCode >= 0 ? { exitCode: extra.exitCode } : {}),
            ...(extra?.signal && /^[A-Z][A-Z0-9_]{0,31}$/.test(extra.signal) ? { signal: extra.signal } : {}),
            ...(redactMcpDiagnostic(message) ? { detail: redactMcpDiagnostic(message) } : {})
        };
    }

    private localDescription(): Extract<MCPServerDescription, { command: string }> & { readonly cwd?: string } {
        return this.description as Extract<MCPServerDescription, { command: string }> & { readonly cwd?: string };
    }

    private async doStartLocal(): Promise<void> {
        const lifecycle = this.lifecycle;
        const signal = this.startup!.signal;
        let initialized = false;
        const description = this.localDescription();
        const client = this.createClient();
        this.client = client;
        const childEnv = mcpChildEnvironment(description.env);
        // uvx falls back to `uv tool run`, npx always gets -y; a missing launcher fails as runtime_missing.
        const launcher = resolveMcpLauncherSync(description.command, description.args || [], childEnv);
        const transport = new NextMuxStdioClientTransport({
            command: launcher.command,
            args: launcher.args,
            env: childEnv,
            cwd: description.cwd,
            stderr: 'pipe'
        });
        this.transport = transport;
        const stderr = transport.stderr;
        if (stderr) {
            const stream = stderr as unknown as { setEncoding?: (encoding: string) => void; on: (event: string, listener: (chunk: unknown) => void) => void };
            stream.setEncoding?.('utf8');
            stream.on('data', chunk => {
                if (lifecycle === this.lifecycle) this.appendLocalStderr(chunk);
            });
        }
        transport.onProcessError = error => {
            if (lifecycle !== this.lifecycle || signal.aborted || this.isStopped()) return;
            this.setLocalFailure(initialized ? 'connection' : 'startup', error);
            this.error = 'MCP_LOCAL_PROCESS_FAILED';
            this.setStatus(MCPServerStatus.Errored);
        };
        transport.onProcessExit = (code, exitSignal) => {
            if (lifecycle !== this.lifecycle || signal.aborted || this.isStopped()) return;
            // The SDK's onclose can already have changed Running to Errored.
            // Handshake completion belongs to this connection, not its status.
            const stage: NextMuxMcpFailureEvidence['stage'] = initialized ? 'connection' : 'startup';
            // A spawn failure (ENOENT/EACCES) emits `error` and then `close`
            // with a negative libuv code. Keep the specific cause instead of
            // replacing it with a generic "process exited" (Cline keeps the
            // first spawn error for the same reason).
            const prior = this.localFailure;
            if (!prior || prior.code === 'process_exit' || prior.code === 'connection') {
                this.setLocalFailure(stage, `MCP process exited${code === null ? '' : code < 0 ? ` (spawn ${code === -2 ? 'ENOENT' : code === -13 ? 'EACCES' : 'failed'})` : ` with code ${code}`}`, {
                    ...(code === null ? {} : { exitCode: code }), ...(exitSignal ? { signal: exitSignal } : {})
                });
            }
            this.error = 'MCP_LOCAL_PROCESS_EXITED';
            this.setStatus(MCPServerStatus.Errored);
        };
        this.configureErrorHandlers();
        await this.until(client.connect(transport), signal);
        signal.throwIfAborted();
        if (lifecycle !== this.lifecycle) return;
        if (this.localFailure || this.getStatus() === MCPServerStatus.Errored) {
            throw new Error(this.localFailureDetail() || 'MCP_LOCAL_HANDSHAKE_FAILED');
        }
        initialized = true;
        this.error = undefined;
        this.setStatus(MCPServerStatus.Running);
    }

    protected override async doStart(options: { interactive: boolean }): Promise<void> {
        this.desktopPolicy = undefined;
        this.cachedTools = undefined;
        // Curated local presets are rewritten in packaged/prepared desktop builds. This uses
        // Electron's embedded Node runtime and a checked-in payload manifest;
        // it never falls back to mutable global npx/uvx downloads.
        if ('command' in this.description) {
            const runtime = resolvePackagedMcpRuntime(this.description as LocalMcpRuntimeDescription, defaultPackagedMcpRuntimeOptions());
            if ('error' in runtime) {
                this.error = runtime.error;
                this.setStatus(MCPServerStatus.Errored);
                throw new Error(runtime.error);
            }
            if (runtime.description !== this.description) this.update(runtime.description as unknown as MCPServerDescription, false);
        }
        this.desktopPolicy = captureDesktopMcpBackgroundPolicy(this.description, defaultPackagedMcpRuntimeOptions());
        const description = credentialMcpDescription(this.description);
        if (!description && 'command' in this.description) return this.doStartLocal();
        const signal = this.startup!.signal;
        if (!description) return this.doStartRemote(options, signal);
        const client = this.createClient();
        this.client = client;
        const approved = this.captureAccess();
        const assertAccess = () => { signal.throwIfAborted(); approved(); };
        const transport = new StreamableHTTPClientTransport(new URL(description.serverUrl), {
            fetch: this.abortableFetch(createAuthenticatedMcpFetch({ description, store: this.credentials, assertAccess }), signal),
            reconnectionOptions: { maxRetries: 2, initialReconnectionDelay: 1000, maxReconnectionDelay: 8000, reconnectionDelayGrowFactor: 2 }
        });
        this.transport = transport;
        this.configureErrorHandlers();
        await this.until(client.connect(transport), signal);
        assertAccess();
        if (this.getStatus() === MCPServerStatus.Errored) throw new Error('MCP_CONNECTION_CLOSED');
        this.error = undefined;
        this.setStatus(MCPServerStatus.Connected);
    }

    /** Keep Theia's OAuth/SSE compatibility, but fence every asynchronous boundary. */
    private async doStartRemote(options: { interactive: boolean }, signal: AbortSignal): Promise<void> {
        if (!('serverUrl' in this.description)) throw new Error('MCP_CONFIGURATION_INVALID');
        const description = this.description;
        let provider: MCPOAuthClientProvider | undefined;
        let headers = description.headers;
        if (description.serverAuthToken) headers = { ...headers,
            [description.serverAuthTokenHeader || 'Authorization']: description.serverAuthTokenHeader
                ? description.serverAuthToken : `Bearer ${description.serverAuthToken}` };
        const createProvider = async (): Promise<MCPOAuthClientProvider | undefined> => {
            if (!description.oauth) return undefined;
            const pending = this.createOAuthClientProvider(options.interactive);
            // A late native callback must not outlive a cancelled attempt.
            void pending.then(value => { if (signal.aborted) value.cancel(); }).catch(() => undefined);
            return this.until(pending, signal);
        };
        try {
            provider = await createProvider();
            signal.throwIfAborted();
            this.authProvider = provider;
            this.client = this.createClient();
            this.transport = this.createStreamableHttpTransport(headers, provider);
            this.configureErrorHandlers();
            try { await this.connectTransport(provider, headers); }
            catch (error) {
                signal.throwIfAborted();
                // Authorization outcomes are final for this attempt, as in Theia.
                if (error instanceof MCPOAuthCancelledError || error instanceof Error && this.isAuthenticationRequiredError(error)
                    || this.isIncompatibleAuthServerError(error)) throw error;
                await this.until(this.closeConnection(this.client, this.transport), signal);
                provider?.cancel();
                provider = await createProvider();
                signal.throwIfAborted();
                this.authProvider = provider;
                this.client = this.createClient();
                this.transport = this.createSSETransport(headers, provider);
                this.setStatus(MCPServerStatus.Connecting);
                this.configureErrorHandlers();
                await this.connectTransport(provider, headers);
            }
            signal.throwIfAborted();
            if (this.isStopped() || this.getStatus() === MCPServerStatus.Errored) throw new Error('MCP_CONNECTION_CLOSED');
            this.error = undefined;
            this.setStatus(MCPServerStatus.Connected);
        } catch (error) {
            signal.throwIfAborted();
            if (error instanceof MCPOAuthCancelledError) {
                if (this.client) await this.until(this.closeConnection(this.client, this.transport), signal);
                this.error = undefined;
                this.setStatus(MCPServerStatus.NotConnected);
            } else if (error instanceof Error && this.isAuthenticationRequiredError(error)) {
                this.localFailure = { stage: 'startup', code: 'authentication', detail: redactMcpDiagnostic(error) };
                this.error = 'MCP_AUTHENTICATION_REQUIRED';
                this.setStatus(MCPServerStatus.AuthenticationRequired);
                if (this.client) await this.until(this.closeConnection(this.client, this.transport), signal);
            } else throw error;
        } finally {
            provider?.cancel();
            if (this.authProvider === provider) this.authProvider = undefined;
        }
    }

    protected override isAuthenticationRequiredError(error: Error): boolean {
        if (super.isAuthenticationRequiredError(error)) return true;
        const status = (error as { code?: unknown; status?: unknown }).code ?? (error as { status?: unknown }).status;
        if (status === 401 || status === 403) return true;
        return /\b(?:401|403)\b|unauthori[sz]ed|unauthenticated|authentication[ _]required|invalid[ _]token|missing[ _]token|no cookie/i.test(error.message || '');
    }

    protected override async connectTransport(provider: MCPOAuthClientProvider | undefined, headers?: Record<string, string>): Promise<void> {
        const signal = this.startup!.signal;
        const client = this.client;
        const transport = this.transport;
        this.suppressOAuthUnauthorizedErrors = !!provider;
        try {
            try { await this.until(client.connect(transport), signal); }
            catch (error) {
                signal.throwIfAborted();
                if (!(provider && error instanceof UnauthorizedError
                    && (transport instanceof StreamableHTTPClientTransport || transport instanceof SSEClientTransport))) throw error;
                this.setStatus(MCPServerStatus.AuthenticationRequired);
                const code = await this.until(provider.waitForAuthorization(), signal);
                await this.until(transport.finishAuth(code), signal);
                await this.until(this.closeConnection(client, transport), signal);
                signal.throwIfAborted();
                this.client = this.createClient();
                this.transport = transport instanceof StreamableHTTPClientTransport
                    ? this.createStreamableHttpTransport(headers, provider) : this.createSSETransport(headers, provider);
                this.setStatus(MCPServerStatus.Connecting);
                this.configureErrorHandlers();
                try { await this.until(this.client.connect(this.transport), signal); }
                catch (reconnectError) {
                    signal.throwIfAborted();
                    if (this.isUnauthorizedReconnectError(reconnectError)) {
                        await this.until(Promise.resolve(provider.invalidateCredentials?.('tokens')), signal);
                        await this.until(Promise.resolve(provider.invalidateCredentials?.('discovery')), signal);
                        throw new UnauthorizedError();
                    }
                    throw reconnectError;
                }
            }
        } catch (error) {
            signal.throwIfAborted();
            if (provider && error instanceof OAuthError) {
                await this.until(Promise.resolve(provider.invalidateCredentials?.('tokens')), signal);
                await this.until(Promise.resolve(provider.invalidateCredentials?.('discovery')), signal);
            }
            throw error;
        } finally {
            if (!signal.aborted) this.suppressOAuthUnauthorizedErrors = false;
        }
    }

    private abortableFetch(fetcher: typeof fetch, signal: AbortSignal): typeof fetch {
        return (input, init) => {
            // Allow bounded session deletion after cancelling initialization or
            // streams. The credential fetch still enforces revocation itself.
            const method = init?.method || (input instanceof Request ? input.method : 'GET');
            const lifetime = signal.aborted && method.toUpperCase() === 'DELETE' ? AbortSignal.timeout(1_000) : signal;
            lifetime.throwIfAborted();
            const requestSignal = init?.signal || (input instanceof Request ? input.signal : undefined);
            return fetcher(input, { ...init, signal: requestSignal ? AbortSignal.any([lifetime, requestSignal]) : lifetime });
        };
    }

    protected override createStreamableHttpTransport(headers: Record<string, string> | undefined, authProvider: MCPOAuthClientProvider | undefined): StreamableHTTPClientTransport {
        if (!('serverUrl' in this.description)) return super.createStreamableHttpTransport(headers, authProvider);
        return new StreamableHTTPClientTransport(new URL(this.description.serverUrl), {
            ...(headers ? { requestInit: { headers } } : {}),
            ...(authProvider ? { authProvider } : {}),
            fetch: this.abortableFetch(sameOriginMcpFetch(), this.startup!.signal),
            reconnectionOptions: { maxRetries: 2, initialReconnectionDelay: 1000, maxReconnectionDelay: 8000, reconnectionDelayGrowFactor: 2 }
        });
    }

    private isStaleRemoteSessionError(error: unknown): boolean {
        if (!(this.transport instanceof StreamableHTTPClientTransport) || !this.isRunning() || this.isStopped()) return false;
        const text = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? '');
        return /\b404\b|session.*(?:not found|expired|invalid|terminated|unknown)/i.test(text);
    }

    private async reconnectStaleRemoteSession(failedClient: Client, signal?: AbortSignal): Promise<boolean> {
        if (this.client !== failedClient || !this.isRunning() || this.isStopped() || !(this.transport instanceof StreamableHTTPClientTransport)) return false;
        this.cachedTools = undefined;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error('MCP session reconnect timed out')), this.startupTimeoutMs(false));
        const previousStartup = this.startup;
        this.startup = controller;
        const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
        try {
            await this.until(this.closeConnection(failedClient, this.transport), combined).catch(() => undefined);
            combined.throwIfAborted();
            await this.until(this.doStart({ interactive: false }), combined);
            return this.isRunning();
        } catch {
            return false;
        } finally {
            clearTimeout(timer);
            if (this.startup === controller) this.startup = previousStartup;
        }
    }

    protected override createSSETransport(headers: Record<string, string> | undefined, authProvider: MCPOAuthClientProvider | undefined): SSEClientTransport {
        if (!('serverUrl' in this.description)) return super.createSSETransport(headers, authProvider);
        // The event stream keeps the headers the SDK adds (an OAuth token) as well as the configured ones (audit B07-002).
        return new SSEClientTransport(new URL(this.description.serverUrl), {
            eventSourceInit: { fetch: this.abortableFetch(sameOriginMcpFetch(headers), this.startup!.signal) },
            ...(headers ? { requestInit: { headers } } : {}), ...(authProvider ? { authProvider } : {}), fetch: this.abortableFetch(sameOriginMcpFetch(), this.startup!.signal)
        });
    }

    protected override handleSteadyStateError(error: Error, prefix: string): void {
        this.cachedTools = undefined;
        if (!credentialMcpDescription(this.description)) return super.handleSteadyStateError(error, prefix);
        if (this.isStopped()) return;
        this.error = 'MCP_SECURE_CONNECTION_FAILED';
        this.setStatus(MCPServerStatus.Errored);
    }

    protected override configureErrorHandlers(): void {
        super.configureErrorHandlers();
        const client = this.client;
        const transport = this.transport;
        const lifecycle = this.lifecycle;
        const active = () => lifecycle === this.lifecycle && this.client === client && this.transport === transport && !this.closingClients.has(client);
        const clientError = client.onerror;
        const transportError = transport.onerror;
        client.onerror = error => { if (active()) clientError?.(error); };
        transport.onerror = error => { if (active()) transportError?.(error); };
        const previous = client.onclose;
        client.onclose = () => {
            if (!active()) return;
            this.cachedTools = undefined;
            previous?.();
            // A clean transport close need not emit onerror. Do not leave a
            // disconnected client in Running, and never let an old client's
            // delayed close overwrite a replacement connection's status.
            if (!this.isRunning() && !this.isInFlight()) return;
            this.error = 'MCP_CONNECTION_CLOSED';
            this.setStatus(MCPServerStatus.Errored);
        };
    }

    override async getTools(signal?: AbortSignal): ReturnType<MCPServer['getTools']> {
        const client = this.client;
        const lifecycle = this.lifecycle;
        const deadline = new AbortController();
        const timer = setTimeout(() => deadline.abort(new Error('MCP tools/list timed out')), this.startupTimeoutMs(false));
        const requestSignal = AbortSignal.any([deadline.signal, ...(signal ? [signal] : []), ...(this.startup ? [this.startup.signal] : [])]);
        try {
            signal?.throwIfAborted();
            const assertAccess = credentialMcpDescription(this.description) ? this.captureAccess() : undefined;
            if (!this.isRunning()) return { tools: [] };
            if (this.cachedTools && this.cachedTools.client === client && this.cachedTools.listToolsFn === client.listTools) {
                assertAccess?.();
                return { tools: [...this.cachedTools.tools] };
            }
            const fetchAllPages = async (activeClient: Client): Promise<Awaited<ReturnType<MCPServer['getTools']>>['tools']> => {
                const tools: Awaited<ReturnType<MCPServer['getTools']>>['tools'] = [];
                const cursors = new Set<string>();
                let cursor: string | undefined;
                do {
                    signal?.throwIfAborted();
                    const page = await this.until(activeClient.listTools(cursor ? { cursor } : undefined, { signal: requestSignal }), requestSignal);
                    if (activeClient !== this.client || lifecycle !== this.lifecycle) throw new Error('MCP_CONNECTION_CHANGED');
                    tools.push(...page.tools.slice(0, 4097 - tools.length));
                    cursor = page.nextCursor;
                    if (cursor && cursors.has(cursor)) throw new Error('MCP_TOOL_LIST_CURSOR_REPEATED');
                    if (cursor) cursors.add(cursor);
                    if (cursor && cursors.size >= 128) throw new Error('MCP_TOOL_LIST_PAGE_LIMIT');
                } while (cursor && tools.length <= 4096);
                return tools;
            };
            let tools: Awaited<ReturnType<MCPServer['getTools']>>['tools'];
            try {
                tools = await fetchAllPages(client);
            } catch (error) {
                if (!requestSignal.aborted && this.isStaleRemoteSessionError(error) && await this.reconnectStaleRemoteSession(client, requestSignal)) {
                    tools = await fetchAllPages(this.client);
                } else {
                    throw error;
                }
            }
            assertAccess?.();
            this.cachedTools = { client: this.client, listToolsFn: this.client.listTools, tools: [...tools] };
            return { tools };
        }
        catch (error) {
            signal?.throwIfAborted();
            if (client === this.client && lifecycle === this.lifecycle && this.isRunning()) {
                if ('command' in this.description) this.setLocalFailure('tools', error);
                else this.localFailure = { stage: 'tools', code: mcpFailureCode(String(error)) };
                this.error = 'MCP_TOOL_LIST_FAILED';
                this.setStatus(MCPServerStatus.Errored);
            }
            if (credentialMcpDescription(this.description)) throw new Error('MCP_SECURE_TOOL_LIST_FAILED');
            throw error;
        } finally { clearTimeout(timer); }
    }

    override async callTool(name: string, args: string, signal?: AbortSignal): ReturnType<MCPServer['callTool']> {
        const deadline = new AbortController();
        const timer = setTimeout(() => deadline.abort(new Error('MCP tools/call timed out')), this.callTimeoutMs());
        const requestSignal = AbortSignal.any([deadline.signal, ...(signal ? [signal] : []), ...(this.startup ? [this.startup.signal] : [])]);
        try {
            signal?.throwIfAborted();
            const assertAccess = credentialMcpDescription(this.description) ? this.captureAccess() : undefined;
            const parsedArgs = JSON.parse(args);
            const activeClient = this.client;
            // The request itself carries every stop reason (caller, deadline, server stop), so the SDK cancels it on the
            // server; its own timeout sits past ours instead of capping a longer configured one at the SDK's 60 s.
            const callOptions = { signal: requestSignal, timeout: this.callTimeoutMs() + 1_000 };
            let result: unknown;
            try {
                result = await this.until(
                    activeClient.callTool({ name, arguments: parsedArgs }, CallToolResultSchema, callOptions),
                    requestSignal
                );
            } catch (error) {
                if (!requestSignal.aborted && this.isStaleRemoteSessionError(error) && await this.reconnectStaleRemoteSession(activeClient, requestSignal)) {
                    result = await this.until(
                        this.client.callTool({ name, arguments: parsedArgs }, CallToolResultSchema, callOptions),
                        requestSignal
                    );
                } else {
                    throw error;
                }
            }
            assertAccess?.();
            if (result && typeof result === 'object' && Array.isArray((result as { content?: unknown[] }).content)) {
                const content = (result as { content: unknown[] }).content;
                if (content.some(item => item && typeof item === 'object' && (item as { type?: unknown }).type === 'text'
                    && typeof (item as { text?: unknown }).text === 'string' && ((item as { text: string }).text.length > MCP_TEXT_MAX_CHARS))) {
                    result = {
                        ...(result as Record<string, unknown>),
                        content: content.map(item => {
                            if (item && typeof item === 'object' && (item as { type?: unknown }).type === 'text'
                                && typeof (item as { text?: unknown }).text === 'string' && (item as { text: string }).text.length > MCP_TEXT_MAX_CHARS) {
                                return { ...(item as Record<string, unknown>), ...truncateMcpToolTextHeadTail((item as { text: string }).text) };
                            }
                            return item;
                        })
                    };
                }
            }
            // The SDK signature also includes its legacy compatibility schema.
            // This call explicitly validates CallToolResultSchema, matching
            // Theia's existing callTool return contract without a second parse.
            return result as Awaited<ReturnType<MCPServer['callTool']>>;
        }
        catch (error) {
            signal?.throwIfAborted();
            if (error instanceof McpToolPreflightError) throw error;
            if (credentialMcpDescription(this.description)) throw new Error('MCP_SECURE_TOOL_REQUEST_FAILED');
            throw error;
        } finally { clearTimeout(timer); }
    }

    protected stdioProcessId(): number | undefined {
        const transport = this.transport;
        const pid = transport instanceof StdioClientTransport ? transport.pid : null;
        return typeof pid === 'number' && pid > 1 ? pid : undefined;
    }

    /** Windows: end the server and everything it started in one step, before the SDK closes its pipes. */
    protected killWindowsProcessTree(pid: number): Promise<void> {
        const systemRoot = process.env.SystemRoot || 'C:\\Windows';
        return new Promise(resolve => execFile(`${systemRoot}\\System32\\taskkill.exe`, ['/PID', String(pid), '/T', '/F'],
            { windowsHide: true, timeout: 5_000 }, () => resolve()));
    }

    override stop(): Promise<void> {
        if (this.stopPromise && !this.startPromise) return this.stopPromise;
        this.desktopPolicy = undefined;
        this.cachedTools = undefined;
        const lifecycle = ++this.lifecycle;
        this.startup?.abort(new Error('MCP_START_CANCELLED'));
        this.startPromise = undefined;
        this.suppressOAuthUnauthorizedErrors = false;
        this.authProvider?.cancel();
        this.authProvider = undefined;
        const client = this.client;
        const transport = this.transport;
        this.error = undefined; this.localFailure = undefined; this.localStderr = '';
        const stopping = Promise.resolve().then(async () => {
            try { if (client) await this.closeConnection(client, transport); }
            catch (error) {
                if (lifecycle === this.lifecycle && client === this.client) {
                    this.error = 'MCP_CLEANUP_FAILED';
                    this.setStatus(MCPServerStatus.Errored);
                }
                throw error;
            }
            finally {
                if (lifecycle === this.lifecycle && client === this.client && this.error !== 'MCP_CLEANUP_FAILED') {
                    this.error = undefined;
                    this.setStatus('command' in this.description ? MCPServerStatus.NotRunning : MCPServerStatus.NotConnected);
                }
                if (this.stopPromise === stopping) this.stopPromise = undefined;
            }
        });
        this.stopPromise = stopping;
        return stopping;
    }
}
