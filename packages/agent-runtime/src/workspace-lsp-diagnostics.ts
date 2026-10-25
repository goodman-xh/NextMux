import spawn = require("cross-spawn");
import type { ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { opendir, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { terminateChildProcessTree } from "./child-process-tree.js";
import type { WorkspaceDiagnostic, WorkspaceDiagnosticProvider, WorkspaceDiagnosticRequest, WorkspaceDiagnosticSnapshot } from "./workspace-diagnostics.js";

type JsonObject = Record<string, any>;
export interface LanguageServerDiagnosticCommand { readonly command: string; readonly args: readonly string[]; readonly language: string; readonly initializationOptions?: Readonly<Record<string, unknown>>; }
type ServerSpec = LanguageServerDiagnosticCommand;
const servers: Readonly<Record<string, ServerSpec>> = {
  python: { command: "pyright-langserver", args: ["--stdio"], language: "python" },
  go: { command: "gopls", args: ["serve"], language: "go" },
  rust: { command: "rust-analyzer", args: [], language: "rust", initializationOptions: { cargo: { buildScripts: { enable: false } }, procMacro: { enable: false } } },
};
let activeServers = 0;

/** Minimal stdio LSP transport. Never executes server-requested commands or edits, and never installs servers. */
class DiagnosticLanguageServer {
  readonly #child: ChildProcess;
  readonly #spec: ServerSpec;
  readonly #root: string;
  #buffer = Buffer.alloc(0);
  #sequence = 0;
  #closed = false;
  #ready: Promise<JsonObject>;
  #requests = new Map<number, { resolve: (value: any) => void; reject: () => void; timer: ReturnType<typeof setTimeout> }>();
  #documents = new Map<string, number>();
  #observations = new Map<string, { version: number; errors: unknown[] }>();
  #waiters = new Set<() => void>();
  #idle?: ReturnType<typeof setTimeout>;
  constructor(root: string, spec: ServerSpec) {
    this.#root = root; this.#spec = spec;
    this.#child = spawn(spec.command, [...spec.args], { cwd: root, shell: false, windowsHide: true,
      env: { ...process.env, GOPROXY: "off", GOSUMDB: "off", CARGO_NET_OFFLINE: "true" },
      detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
    activeServers++;
    this.#child.stdout!.on("data", (data: Buffer) => this.#receive(data));
    this.#child.stderr!.resume();
    this.#child.stdin!.on("error", () => this.close());
    this.#child.on("error", () => this.close());
    this.#child.on("exit", () => this.close());
    this.#ready = this.#request("initialize", { processId: process.pid, rootUri: pathToFileURL(root).href,
      workspaceFolders: [{ uri: pathToFileURL(root).href, name: "workspace" }],
      ...(spec.initializationOptions ? { initializationOptions: spec.initializationOptions } : {}),
      capabilities: { textDocument: { publishDiagnostics: { versionSupport: true }, diagnostic: { dynamicRegistration: false } },
        workspace: { configuration: true } } }).then(result => { this.#notify("initialized", {}); return result?.capabilities ?? {}; });
    // Initialization may fail before the first snapshot awaits it.
    void this.#ready.catch(() => undefined);
  }
  get closed(): boolean { return this.#closed; }
  #send(message: JsonObject): void {
    if (this.#closed) throw new Error("language_server_unavailable");
    const content = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }));
    this.#child.stdin!.write(Buffer.concat([Buffer.from(`Content-Length: ${content.length}\r\n\r\n`), content]));
  }
  #notify(method: string, params: unknown): void { this.#send({ method, params }); }
  #request(method: string, params: unknown): Promise<any> {
    const id = ++this.#sequence;
    return new Promise((resolveRequest, reject) => {
      const timer = setTimeout(() => { this.#requests.delete(id); reject(new Error("language_server_timeout")); }, 2000);
      this.#requests.set(id, { resolve: resolveRequest, reject: () => reject(new Error("language_server_unavailable")), timer });
      try { this.#send({ id, method, params }); } catch { clearTimeout(timer); this.#requests.delete(id); reject(new Error("language_server_unavailable")); }
    });
  }
  #receive(data: Buffer): void {
    this.#buffer = Buffer.concat([this.#buffer, data]);
    if (this.#buffer.length > 4 * 1024 * 1024) { this.close(); return; }
    for (;;) {
      const end = this.#buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      const length = Number(/^Content-Length:\s*(\d+)\s*$/im.exec(this.#buffer.subarray(0, end).toString("ascii"))?.[1]);
      if (!Number.isSafeInteger(length) || length < 0 || length > 2 * 1024 * 1024) { this.close(); return; }
      if (this.#buffer.length < end + 4 + length) return;
      let message: JsonObject;
      try { message = JSON.parse(this.#buffer.subarray(end + 4, end + 4 + length).toString("utf8")); }
      catch { this.close(); return; }
      this.#buffer = this.#buffer.subarray(end + 4 + length);
      if (message.method && message.id !== undefined) {
        // Configuration requests are data only. A server may never authorize filesystem changes.
        try { this.#send({ id: message.id, result: message.method === "workspace/configuration"
          ? (Array.isArray(message.params?.items) ? message.params.items.slice(0, 100).map(() => null) : [])
          : message.method === "workspace/workspaceFolders" ? [{ uri: pathToFileURL(this.#root).href, name: "workspace" }]
          : message.method === "workspace/applyEdit" ? { applied: false } : null }); } catch { this.close(); }
      } else if (message.method === "textDocument/publishDiagnostics") {
        const params = message.params;
        if (typeof params?.uri === "string" && Number.isSafeInteger(params.version) && Array.isArray(params.diagnostics)
          && this.#documents.get(params.uri) === params.version) {
          this.#observations.set(params.uri, { version: params.version, errors: params.diagnostics });
          for (const wake of [...this.#waiters]) wake();
        }
      } else if (Number.isSafeInteger(message.id)) {
        const pending = this.#requests.get(message.id);
        if (!pending) continue;
        this.#requests.delete(message.id); clearTimeout(pending.timer);
        if (message.error) pending.reject(); else pending.resolve(message.result);
      }
    }
  }
  async snapshot(request: WorkspaceDiagnosticRequest): Promise<WorkspaceDiagnosticSnapshot> {
    const result = (reason: string): WorkspaceDiagnosticSnapshot => ({ status: "unavailable", source: this.#spec.command, sha256: request.sha256, reason });
    if (request.signal?.aborted) return result("cancelled");
    if (this.#idle) clearTimeout(this.#idle);
    let abortReject: (() => void) | undefined;
    const abortPromise = new Promise<never>((_resolve, reject) => {
      abortReject = () => reject(new Error("cancelled"));
    });
    const abort = (): void => {
      abortReject?.();
      for (const wake of [...this.#waiters]) wake();
    };
    request.signal?.addEventListener("abort", abort, { once: true });
    try {
      const capabilities = await Promise.race([this.#ready, abortPromise]);
      if (request.signal?.aborted) return result("cancelled");
      if (this.#closed) return result("language_server_unavailable");
      const uri = pathToFileURL(resolve(this.#root, request.path)).href;
      const previous = this.#documents.get(uri), version = (previous ?? 0) + 1;
      if (previous === undefined && this.#documents.size >= 64) {
        const oldest = this.#documents.keys().next().value!;
        this.#notify("textDocument/didClose", { textDocument: { uri: oldest } });
        this.#documents.delete(oldest); this.#observations.delete(oldest);
      }
      this.#documents.set(uri, version); this.#observations.delete(uri);
      if (previous === undefined) this.#notify("textDocument/didOpen", { textDocument: { uri, version, languageId: this.#spec.language, text: request.content } });
      else this.#notify("textDocument/didChange", { textDocument: { uri, version }, contentChanges: [{ text: request.content }] });
      let diagnostics: unknown[] | undefined;
      if (capabilities.diagnosticProvider) {
        const response = await Promise.race([this.#request("textDocument/diagnostic", { textDocument: { uri } }), abortPromise]);
        if (response?.kind === "full" && Array.isArray(response.items) && this.#documents.get(uri) === version) diagnostics = response.items;
      } else {
        await new Promise<void>(resolveWait => {
          const timer = setTimeout(finish, 1600);
          const self = this;
          function finish(): void { clearTimeout(timer); self.#waiters.delete(wake); resolveWait(); }
          function wake(): void { if (self.#closed || request.signal?.aborted || self.#observations.get(uri)?.version === version) finish(); }
          this.#waiters.add(wake); wake();
        });
        if (request.signal?.aborted) return result("cancelled");
        const observation = this.#observations.get(uri);
        if (observation?.version === version && this.#documents.get(uri) === version) diagnostics = observation.errors;
      }
      if (request.signal?.aborted) return result("cancelled");
      if (!diagnostics) return result("fresh_versioned_diagnostics_unavailable");
      const lines = request.content.split(/\r?\n/);
      const errors: WorkspaceDiagnostic[] = [];
      for (const raw of diagnostics) {
        if (!raw || typeof raw !== "object") return result("invalid_diagnostics");
        const item = raw as JsonObject;
        if (item.severity !== undefined && item.severity !== 1) continue;
        const start = item.range?.start, end = item.range?.end;
        if (typeof item.message !== "string" || !Number.isSafeInteger(start?.line) || !Number.isSafeInteger(start?.character)
          || start.line < 0 || start.character < 0 || start.line >= lines.length) return result("invalid_diagnostics");
        errors.push({ source: this.#spec.command, code: String(item.code ?? ""), message: item.message.slice(0, 2000),
          line: start.line + 1, column: start.character + 1,
          anchor: lines[start.line]!.slice(start.character, end?.line === start.line ? end.character : start.character + 160).slice(0, 160) });
      }
      return errors.length > 100 ? result("diagnostic_limit_exceeded") : { status: "ready", source: this.#spec.command, sha256: request.sha256, errors };
    } catch (error) {
      if (request.signal?.aborted || (error instanceof Error && error.message === "cancelled")) return result("cancelled");
      return result("language_server_missing_or_unavailable");
    }
    finally {
      request.signal?.removeEventListener("abort", abort);
      if (!this.#closed) { this.#idle = setTimeout(() => this.close(), 30_000); this.#idle.unref(); }
    }
  }
  close(): void {
    if (this.#closed) return;
    this.#closed = true; activeServers--;
    if (this.#idle) clearTimeout(this.#idle);
    for (const pending of this.#requests.values()) { clearTimeout(pending.timer); pending.reject(); }
    this.#requests.clear();
    for (const wake of [...this.#waiters]) wake();
    this.#documents.clear(); this.#observations.clear();
    void terminateChildProcessTree(this.#child, 100).catch(() => undefined);
  }
}

export class InstalledLanguageServerDiagnostics implements WorkspaceDiagnosticProvider {
  readonly #root: string;
  readonly #clients = new Map<string, DiagnosticLanguageServer>();
  readonly #starting = new Map<string, Promise<{ client?: DiagnosticLanguageServer; reason?: string }>>();
  readonly #failed = new Set<string>();
  readonly #servers: Readonly<Record<string, ServerSpec>>;
  #preflight?: Promise<string | undefined>;
  /** Host-owned overrides only; never accept executable names from model tool arguments. */
  constructor(workspaceRoot: string, serverCommands: Readonly<Record<string, ServerSpec>> = servers) { this.#root = workspaceRoot; this.#servers = serverCommands; }
  async snapshot(request: WorkspaceDiagnosticRequest): Promise<WorkspaceDiagnosticSnapshot> {
    const language = /\.pyi?$/i.test(request.path) ? "python" : /\.go$/i.test(request.path) ? "go" : /\.rs$/i.test(request.path) ? "rust" : undefined;
    const noData = (reason: string): WorkspaceDiagnosticSnapshot => ({ status: "unavailable", sha256: request.sha256, source: language ? this.#servers[language]?.command ?? "none" : "none", reason });
    if (!language) return noData("unsupported_language");
    if (!this.#servers[language]) return noData("language_server_not_configured");
    if (Buffer.byteLength(request.content) > 1024 * 1024) return noData("document_byte_budget_exceeded");
    if (this.#failed.has(language)) return noData("language_server_missing_or_unavailable");
    if (request.signal?.aborted) return noData("cancelled");
    let client = this.#clients.get(language);
    if (!client || client.closed) {
      let pendingStart = this.#starting.get(language);
      if (!pendingStart) {
        pendingStart = (async () => {
          const reason = await (this.#preflight ??= this.#projectBudget());
          if (reason) return { reason };
          const existing = this.#clients.get(language);
          if (existing && !existing.closed) return { client: existing };
          if (activeServers >= 2) return { reason: "language_server_capacity" };
          try {
            const created = new DiagnosticLanguageServer(this.#root, this.#servers[language]!);
            this.#clients.set(language, created);
            return { client: created };
          } catch {
            this.#failed.add(language);
            return { reason: "language_server_missing_or_unavailable" };
          }
        })().finally(() => {
          this.#starting.delete(language);
        });
        this.#starting.set(language, pendingStart);
      }
      const started = await pendingStart;
      if (request.signal?.aborted) return noData("cancelled");
      if (started.reason || !started.client) return noData(started.reason ?? "language_server_missing_or_unavailable");
      client = started.client;
    }
    const snapshot = await client.snapshot(request);
    if (client.closed) {
      this.#clients.delete(language);
      if (!request.signal?.aborted && snapshot.reason === "language_server_missing_or_unavailable") {
        this.#failed.add(language);
      }
    }
    return snapshot;
  }
  async #projectBudget(): Promise<string | undefined> {
    const pending = [this.#root];
    let entries = 0, sourceFiles = 0, bytes = 0;
    try {
      while (pending.length) {
        const directory = await opendir(pending.pop()!);
        for await (const entry of directory) {
          if (++entries > 4000) return "project_entry_budget_exceeded";
          if ([".git", "node_modules", "target", "vendor", ".venv", "venv", "__pycache__", ".next"].includes(entry.name)) continue;
          const path = resolve(directory.path, entry.name);
          // Do not let a language service silently analyze symlinked external projects.
          if (entry.isSymbolicLink()) return "project_symlink_requires_host_language_service";
          if (entry.isDirectory()) pending.push(path);
          else if (entry.isFile() && /\.(?:pyi?|go|rs)$/i.test(entry.name)) {
            if (++sourceFiles > 500) return "project_file_budget_exceeded";
            bytes += (await stat(path)).size;
            if (bytes > 24 * 1024 * 1024) return "project_byte_budget_exceeded";
          }
        }
      }
    } catch { return "project_budget_scan_unavailable"; }
    return undefined;
  }
  dispose(): void { for (const client of this.#clients.values()) client.close(); this.#clients.clear(); }
}
