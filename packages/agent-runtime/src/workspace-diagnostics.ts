import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { runTypeScriptDiagnosticWorker } from "./workspace-diagnostics-worker.js";
import { InstalledLanguageServerDiagnostics } from "./workspace-lsp-diagnostics.js";

export interface WorkspaceDiagnostic {
  readonly source: string;
  readonly code: string;
  readonly message: string;
  readonly line: number;
  readonly column: number;
  /** Stable source evidence lets existing errors survive line insertions without being reported as new. */
  readonly anchor: string;
}
export interface WorkspaceDiagnosticSnapshot {
  readonly status: "ready" | "unavailable";
  readonly sha256: string;
  readonly source: string;
  readonly reason?: string;
  readonly errors?: readonly WorkspaceDiagnostic[];
}
export interface WorkspaceDiagnosticRequest {
  readonly path: string;
  readonly content: string;
  readonly sha256: string;
  readonly signal?: AbortSignal;
}
export interface WorkspaceDiagnosticProvider {
  snapshot(request: WorkspaceDiagnosticRequest): Promise<WorkspaceDiagnosticSnapshot>;
  dispose?(): void | Promise<void>;
}
export interface WorkspaceDiagnosticDelta {
  readonly status: "checked" | "unavailable" | "stale";
  readonly scope: "edited_file";
  readonly source: string;
  readonly sha256: string;
  readonly reason?: string;
  readonly newErrors?: readonly Omit<WorkspaceDiagnostic, "anchor">[];
  readonly existingErrorCount?: number;
}

let activeWorkers = 0;
const unavailable = (request: WorkspaceDiagnosticRequest, reason: string, source = "typescript"): WorkspaceDiagnosticSnapshot =>
  ({ status: "unavailable", sha256: request.sha256, source, reason });

/** Lazy, bounded compiler worker; each runtime releases it on exit and after idle. */
export class DefaultWorkspaceDiagnostics implements WorkspaceDiagnosticProvider {
  readonly #root: string;
  readonly #lsp: InstalledLanguageServerDiagnostics;
  #worker?: Worker;
  #nextId = 0;
  #pending = new Map<number, (snapshot?: WorkspaceDiagnosticSnapshot) => void>();
  #queue: Promise<void> = Promise.resolve();
  #idle?: ReturnType<typeof setTimeout>;
  #closed = false;
  constructor(workspaceRoot: string) { this.#root = workspaceRoot; this.#lsp = new InstalledLanguageServerDiagnostics(workspaceRoot); }

  async snapshot(request: WorkspaceDiagnosticRequest): Promise<WorkspaceDiagnosticSnapshot> {
    if (this.#closed || request.signal?.aborted) return unavailable(request, "cancelled");
    if (!/\.(?:[cm]?[jt]s|[jt]sx)$/i.test(request.path)) return this.#lsp.snapshot(request);
    if (Buffer.byteLength(request.content) > 1024 * 1024) return unavailable(request, "document_byte_budget_exceeded");
    return new Promise<WorkspaceDiagnosticSnapshot>(resolve => {
      let settled = false;
      const done = (snapshot: WorkspaceDiagnosticSnapshot): void => {
        if (settled) return;
        settled = true;
        request.signal?.removeEventListener("abort", onQueuedAbort);
        resolve(snapshot);
      };
      const onQueuedAbort = (): void => done(unavailable(request, "cancelled"));
      request.signal?.addEventListener("abort", onQueuedAbort, { once: true });
      const run = async (): Promise<void> => {
        if (settled) return;
        request.signal?.removeEventListener("abort", onQueuedAbort);
        // A throw (say, postMessage on a dying worker) must still answer this caller, or its edit waits forever.
        const snapshot = await this.#runWorkerSnapshot(request, done).catch(() => unavailable(request, "diagnostic_failed"));
        done(snapshot);
      };
      this.#queue = this.#queue.then(run, run);
    });
  }

  async #runWorkerSnapshot(
    request: WorkspaceDiagnosticRequest,
    earlyResolve: (snapshot: WorkspaceDiagnosticSnapshot) => void,
  ): Promise<WorkspaceDiagnosticSnapshot> {
    if (this.#closed || request.signal?.aborted) return unavailable(request, "cancelled");
    if (this.#idle) clearTimeout(this.#idle);
    if (!this.#worker) {
      if (activeWorkers >= 2) return unavailable(request, "diagnostic_worker_capacity");
      try {
        const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
        const packagedLibraries = resourcesPath && join(resourcesPath, "language-runtime", "typescript");
        this.#worker = new Worker(`(${runTypeScriptDiagnosticWorker.toString()})()`, { eval: true,
          workerData: { workspaceRoot: this.#root, typescriptPath: require.resolve("typescript"),
            ...(packagedLibraries && existsSync(join(packagedLibraries, "lib.es5.d.ts")) ? { libraryPath: packagedLibraries } : {}) },
          resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 } });
        activeWorkers++;
        const worker = this.#worker;
        worker.on("message", (message: { id: number; result: WorkspaceDiagnosticSnapshot }) => this.#pending.get(message.id)?.(message.result));
        worker.on("error", () => this.#stop(worker));
        worker.on("exit", () => this.#stop(worker));
        worker.unref();
      } catch { return unavailable(request, "diagnostic_worker_unavailable"); }
    }
    const worker = this.#worker;
    const id = ++this.#nextId;
    return new Promise(resolve => {
      const finish = (snapshot?: WorkspaceDiagnosticSnapshot): void => {
        if (!this.#pending.delete(id)) return;
        clearTimeout(timer);
        request.signal?.removeEventListener("abort", abort);
        if (!this.#pending.size && this.#worker) {
          this.#idle = setTimeout(() => this.#stop(worker), 30_000); this.#idle.unref();
        }
        const resolved = snapshot ?? unavailable(request, "diagnostic_failed");
        earlyResolve(resolved);
        resolve(resolved);
      };
      const abort = (): void => { finish(unavailable(request, "cancelled")); this.#stop(worker); };
      const timer = setTimeout(() => { finish(unavailable(request, "diagnostic_timeout")); this.#stop(worker); }, 2500);
      this.#pending.set(id, finish);
      request.signal?.addEventListener("abort", abort, { once: true });
      worker.postMessage({ id, path: request.path, content: request.content, sha256: request.sha256 });
    });
  }
  #stop(worker?: Worker): void {
    if (!worker || this.#worker !== worker) return;
    this.#worker = undefined;
    activeWorkers--;
    if (this.#idle) clearTimeout(this.#idle);
    for (const finish of [...this.#pending.values()]) finish();
    void worker.terminate().catch(() => undefined);
  }
  async dispose(): Promise<void> { this.#closed = true; this.#stop(this.#worker); await this.#lsp.dispose(); }
}

/** Enforce a host-independent deadline even when an injected language service never settles. */
export async function captureWorkspaceDiagnostics(provider: WorkspaceDiagnosticProvider, request: WorkspaceDiagnosticRequest): Promise<WorkspaceDiagnosticSnapshot> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  request.signal?.addEventListener("abort", abort, { once: true });
  if (request.signal?.aborted) controller.abort();
  try {
    return await Promise.race([
      Promise.resolve().then(() => provider.snapshot({ ...request, signal: controller.signal })).then(snapshot => {
        if (snapshot.sha256 !== request.sha256) return unavailable(request, "version_mismatch", snapshot.source);
        return snapshot;
      }).catch(() => unavailable(request, "diagnostic_failed", "language-service")),
      new Promise<WorkspaceDiagnosticSnapshot>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(unavailable(request, "diagnostic_timeout", "language-service")); }, 2800); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    request.signal?.removeEventListener("abort", abort);
  }
}

export async function workspaceDiagnosticDelta(
  provider: WorkspaceDiagnosticProvider, absolutePath: string, request: WorkspaceDiagnosticRequest, before: WorkspaceDiagnosticSnapshot,
): Promise<WorkspaceDiagnosticDelta> {
  const after = await captureWorkspaceDiagnostics(provider, request);
  const base = { scope: "edited_file" as const, source: after.source, sha256: request.sha256 };
  try {
    if (createHash("sha256").update(await readFile(absolutePath)).digest("hex") !== request.sha256) return { ...base, status: "stale", reason: "file_changed_during_diagnostics" };
  } catch { return { ...base, status: "stale", reason: "file_unavailable_after_write" }; }
  if (before.status !== "ready" || after.status !== "ready" || before.source !== after.source) return {
    ...base, status: "unavailable", reason: before.status !== "ready" ? `baseline_${before.reason ?? "unavailable"}` : after.reason ?? "provider_changed",
  };
  const identity = (item: WorkspaceDiagnostic): string => JSON.stringify([item.source, item.code, item.message, item.anchor]);
  const existing = new Map<string, number>();
  for (const item of before.errors ?? []) existing.set(identity(item), (existing.get(identity(item)) ?? 0) + 1);
  const newErrors: Omit<WorkspaceDiagnostic, "anchor">[] = [];
  for (const item of after.errors ?? []) {
    const key = identity(item), count = existing.get(key) ?? 0;
    if (count) existing.set(key, count - 1);
    else { const { anchor: _anchor, ...diagnostic } = item; newErrors.push(diagnostic); }
  }
  return { ...base, status: "checked", newErrors, existingErrorCount: (after.errors?.length ?? 0) - newErrors.length };
}
