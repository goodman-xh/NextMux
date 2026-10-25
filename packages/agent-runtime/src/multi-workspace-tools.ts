import { realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { AgentToolError, AgentToolRegistry } from "./registry.js";
import { narrowAgentPermission } from "./permission.js";
import { workspaceDirectoryIdentity } from "./workspace-identity.js";
import { WorkspaceToolRuntime, type AgentCheckpointDiff, type WorkspaceToolRuntimeOptions } from "./workspace-tools.js";
import type { ToolExecutionLedger } from "./tool-execution-ledger.js";
import type { AgentPermissionMode, AgentWorkspaceBinding, AgentToolDescriptor, ToolHandler, ToolExecutionContext, ToolHandlerResult } from "./types.js";

export interface MultiWorkspaceToolRuntimeOptions extends Omit<WorkspaceToolRuntimeOptions, "workspaceRoot" | "checkpointRoot" | "expectedWorkspaceIdentity"> {
  readonly bindings: readonly AgentWorkspaceBinding[];
  readonly primaryBindingId: string;
  /** The host owns the checkpoint location; never accept it from a tool argument. */
  readonly checkpointRootForWorkspace: (workspaceRoot: string) => string | Promise<string>;
}

export interface WorkspaceCheckpointGroup {
  readonly workspaceBindingId: string;
  readonly workspaceRoot: string;
  readonly checkpointIds: readonly string[];
}

/** Capture existing handlers without copying any file/process implementation. */
class WorkspaceRegistrations extends AgentToolRegistry {
  readonly tools = new Map<string, { descriptor: AgentToolDescriptor; handler: ToolHandler }>();
  ledger?: ToolExecutionLedger;
  override register(descriptor: AgentToolDescriptor, handler: ToolHandler): void {
    super.register(descriptor, handler);
    this.tools.set(descriptor.name, { descriptor, handler });
  }
  override useExecutionLedger(ledger: ToolExecutionLedger): void {
    super.useExecutionLedger(ledger);
    this.ledger = ledger;
  }
}

interface BoundRuntime {
  readonly binding: AgentWorkspaceBinding;
  readonly runtime: WorkspaceToolRuntime;
  readonly registrations: WorkspaceRegistrations;
}

interface ObservedCommand {
  readonly token: string;
  readonly roots: readonly BoundRuntime[];
  processId?: string;
}

function contains(root: string, path: string): boolean {
  const inside = relative(root, path);
  return inside === "" || !isAbsolute(inside) && inside !== ".." && !inside.startsWith(`..${sep}`);
}

/** Resolve existing parents too, so new files cannot bypass a symlink boundary. */
async function canonicalTarget(path: string): Promise<string> {
  try { return await realpath(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return resolve(await canonicalTarget(parent), relative(parent, path));
  }
}

/**
 * One existing workspace runtime per verified directory, one run-owned ledger.
 * This follows OpenCode's explicit external-directory boundary and Cline's
 * per-workspace checkpoint ownership without introducing another tool framework.
 * Sources: https://opencode.ai/docs/permissions/#external-directories
 *          https://docs.cline.bot/core-workflows/checkpoints
 */
export class MultiWorkspaceToolRuntime {
  readonly #roots: ReadonlyMap<string, BoundRuntime>;
  readonly #primary: BoundRuntime;
  readonly #processOwners = new Map<string, BoundRuntime>();
  readonly #checkpointOwners = new Map<string, BoundRuntime>();
  readonly #commandScopes = new Map<string, ObservedCommand>();
  readonly permissionMode: AgentPermissionMode;
  #finalizePromise?: Promise<void>;
  #disposePromise?: Promise<void>;

  #assertRunning(context?: ToolExecutionContext): void {
    if (this.#finalizePromise || this.#disposePromise || context?.signal?.aborted) throw new AgentToolError("CANCELLED", "Workspace run has stopped");
  }

  #assertCommandPermissions(): void {
    // A process can use absolute paths, symlinks or child processes outside
    // its cwd. The current single-root sandbox cannot enforce mixed bindings
    // on every host; an approval must not silently elevate a read-only root.
    if ([...this.#roots.values()].some(root => root.binding.permissionMode === "read_only")) {
      throw new AgentToolError("WORKSPACE_COMMAND_PERMISSION_CONFLICT", "Commands cannot start while a bound directory is read-only: this host cannot enforce mixed directory permissions. File tools remain available with each directory's permission.");
    }
  }

  private constructor(roots: ReadonlyMap<string, BoundRuntime>, primaryId: string, permissionMode: AgentPermissionMode) {
    this.#roots = roots;
    this.#primary = roots.get(primaryId)!;
    this.permissionMode = permissionMode;
  }

  static async create(options: MultiWorkspaceToolRuntimeOptions): Promise<MultiWorkspaceToolRuntime> {
    const validMode = (mode: unknown): mode is AgentPermissionMode => ["read_only", "workspace_write", "full_access"].includes(String(mode));
    if (!validMode(options.permissionMode) || !Array.isArray(options.bindings) || !options.bindings.length || options.bindings.length > 64) {
      throw new AgentToolError("INVALID_WORKSPACE_BINDINGS", "Provide between 1 and 64 host-verified workspace bindings");
    }
    const verified: { binding: AgentWorkspaceBinding; checkpointRoot: string; identity: string }[] = [];
    const ids = new Set<string>();
    const paths = new Set<string>();
    const stores = new Set<string>();
    for (const binding of options.bindings) {
      if (!binding || typeof binding.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(binding.id)
        || ids.has(binding.id) || typeof binding.path !== "string" || !isAbsolute(binding.path) || binding.path.includes("\0") || !validMode(binding.permissionMode)) {
        throw new AgentToolError("INVALID_WORKSPACE_BINDINGS", "Workspace binding ID, path or permission is invalid");
      }
      const path = await realpath(binding.path);
      const identity = await workspaceDirectoryIdentity(path);
      if (paths.has(path)) throw new AgentToolError("INVALID_WORKSPACE_BINDINGS", "Workspace roots must be distinct directories");
      const store = await options.checkpointRootForWorkspace(path);
      if (typeof store !== "string" || !isAbsolute(store) || store.includes("\0")) throw new AgentToolError("INVALID_CHECKPOINT_ROOT", "Checkpoint root must be an absolute host-owned path");
      const checkpointRoot = await canonicalTarget(store);
      if (stores.has(checkpointRoot)) throw new AgentToolError("INVALID_CHECKPOINT_ROOT", "Each workspace needs a distinct checkpoint store");
      ids.add(binding.id); paths.add(path); stores.add(checkpointRoot);
      verified.push({ binding: Object.freeze({ id: binding.id, path, permissionMode: narrowAgentPermission(options.permissionMode, binding.permissionMode) }), checkpointRoot, identity });
    }
    if (!ids.has(options.primaryBindingId)) throw new AgentToolError("INVALID_WORKSPACE_BINDINGS", "Primary workspace binding is missing");
    const roots = new Map<string, BoundRuntime>();
    try {
      for (const { binding, checkpointRoot, identity } of verified) {
        const primary = binding.id === options.primaryBindingId;
        const runtime = await WorkspaceToolRuntime.create({ workspaceRoot: binding.path, checkpointRoot, expectedWorkspaceIdentity: identity, permissionMode: binding.permissionMode,
          commandSnapshotExcludedRoots: verified.filter(candidate => candidate.binding.path !== binding.path
            && contains(binding.path, candidate.binding.path)).map(candidate => candidate.binding.path),
          terminalProfile: options.terminalProfile, limits: options.limits, commandEnvironment: options.commandEnvironment,
          processRegistry: primary ? options.processRegistry : undefined, diagnostics: primary ? options.diagnostics : undefined });
        const registrations = new WorkspaceRegistrations();
        roots.set(binding.id, { binding, runtime, registrations });
        runtime.registerTools(registrations);
      }
      return new MultiWorkspaceToolRuntime(roots, options.primaryBindingId, options.permissionMode);
    } catch (error) {
      await Promise.allSettled([...roots.values()].map(root => root.runtime.dispose()));
      throw error;
    }
  }

  registerTools(registry: AgentToolRegistry): void {
    // Preserve the old single-root journal and all host tools' idempotency. The
    // selected binding remains part of each tool's arguments and fingerprint.
    registry.useExecutionLedger(this.#primary.registrations.ledger!);
    const bindingIds = [...this.#roots.keys()];
    for (const { descriptor } of this.#primary.registrations.tools.values()) {
      registry.register({ ...descriptor,
        ...(descriptor.name === "process.read" ? { executionKind: "read" as const } : {}),
        description: `${descriptor.description} workspaceBindingId selects a verified directory; omit it for primary (${this.#primary.binding.id}). Process follow-up calls without it use the process's owning directory.`,
        inputSchema: { ...descriptor.inputSchema, properties: { ...(descriptor.inputSchema.properties as Record<string, unknown>),
          workspaceBindingId: { type: "string", enum: bindingIds, description: "Host-verified directory ID from workspace.list_bindings." } } },
      }, (input, context) => this.#invoke(descriptor.name, input, context));
    }
    registry.register({ name: "workspace.list_bindings", description: "List the host-verified directories for this run, their effective permissions and the primary directory. Select workspaceBindingId when operating in another directory.",
      source: "builtin", requiredPermission: "read_only", executionKind: "read", concurrencySafe: true,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    }, async (_input, context) => ({
      modelOutput: { primaryBindingId: this.#primary.binding.id, bindings: [...this.#roots.values()].map(({ binding }) => ({ ...binding,
        permissionMode: narrowAgentPermission(binding.permissionMode, context.permissionMode ?? this.permissionMode) })) },
      summary: { kind: "workspace.list_bindings", params: { count: this.#roots.size }, title: "Listed workspace bindings" },
    }));
  }

  async #invoke(name: string, input: unknown, context: ToolExecutionContext): Promise<ToolHandlerResult> {
    this.#assertRunning(context);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new AgentToolError("INVALID_ARGUMENTS", "Tool arguments must be an object");
    const { workspaceBindingId, ...values } = input as Record<string, unknown>;
    if (workspaceBindingId !== undefined && (typeof workspaceBindingId !== "string" || !this.#roots.has(workspaceBindingId))) {
      throw new AgentToolError("INVALID_WORKSPACE_BINDING", "Unknown workspace binding ID");
    }
    const processFollowup = ["process.read", "process.write", "process.terminate"].includes(name);
    const owner = processFollowup && typeof values.processId === "string" ? this.#processOwners.get(values.processId) : undefined;
    if (processFollowup && !owner) throw new AgentToolError("PROCESS_NOT_FOUND", "Process session is not owned by this run");
    const root = workspaceBindingId === undefined ? owner ?? this.#primary : this.#roots.get(workspaceBindingId as string)!;
    if (owner && root !== owner) throw new AgentToolError("WORKSPACE_BINDING_MISMATCH", "Process belongs to another workspace binding");
    const tool = root.registrations.tools.get(name)!;
    const mode = narrowAgentPermission(this.permissionMode, root.binding.permissionMode, context.permissionMode ?? this.permissionMode);
    if (narrowAgentPermission(mode, tool.descriptor.requiredPermission) !== tool.descriptor.requiredPermission) throw new AgentToolError("PERMISSION_DENIED", "Tool is not permitted in this workspace binding");
    if (["process.run", "process.start", "process.write"].includes(name)) this.#assertCommandPermissions();
    // Stopping a process and reading its buffered output remain safe after a
    // directory moves. New operations and stdin must still target its owner.
    if (name !== "process.read" && name !== "process.terminate") await root.runtime.assertWorkspaceIdentity();
    const path = name.startsWith("workspace.") ? values.path : !processFollowup ? values.cwd : undefined;
    if (typeof path === "string") {
      const target = await canonicalTarget(resolve(root.binding.path, path));
      const targetOwner = [...this.#roots.values()].filter(candidate => contains(candidate.binding.path, target))
        .sort((a, b) => b.binding.path.length - a.binding.path.length)[0];
      if (targetOwner && targetOwner !== root) throw new AgentToolError("WORKSPACE_BINDING_MISMATCH", "Select the target directory's workspaceBindingId explicitly");
    }
    let commandScope: ObservedCommand | undefined;
    if (name === "process.run" || name === "process.start") {
      const participants = [...this.#roots.values()].filter(candidate => narrowAgentPermission(candidate.binding.permissionMode,
        context.permissionMode ?? this.permissionMode) !== "read_only");
      commandScope = { token: `observed-${randomUUID()}`, roots: participants };
      try {
        for (const participant of participants) await participant.runtime.prepareObservedCommand(commandScope.token, context);
        for (const participant of participants) await participant.runtime.assertWorkspaceIdentity();
        this.#assertRunning(context);
      } catch (error) {
        await Promise.allSettled(participants.map(participant => participant.runtime.discardObservedCommand(commandScope!.token)));
        throw error;
      }
    } else if (typeof values.processId === "string") commandScope = this.#commandScopes.get(values.processId);
    let result: ToolHandlerResult;
    try { this.#assertRunning(context); result = await tool.handler(values, { ...context, permissionMode: mode, workspaceRoot: root.binding.path,
      ...(context.taskContext ? { taskContext: { ...context.taskContext, workspaceRoot: root.binding.path, permissionMode: mode } } : {}),
      onProcessStarted: async process => {
        const existing = this.#processOwners.get(process.processId);
        if (existing && existing !== root) throw new AgentToolError("PROCESS_OWNER_CONFLICT", "Process identifier is already owned by another directory");
        this.#processOwners.set(process.processId, root);
        if (commandScope) { commandScope.processId = process.processId; this.#commandScopes.set(process.processId, commandScope); }
        await context.onProcessStarted?.(process);
      },
    }); } catch (error) {
      // A failed validation/launch has no writer. A started process retains
      // every root's baseline until stop/finalize, including cancellation.
      if (commandScope && !commandScope.processId) await Promise.allSettled(commandScope.roots.map(participant => participant.runtime.discardObservedCommand(commandScope!.token)));
      throw error;
    }
    const output = result.modelOutput && typeof result.modelOutput === "object" ? result.modelOutput as Record<string, unknown> : undefined;
    if (commandScope && (name === "process.run" || output?.running === false)) {
      const changes = await Promise.all(commandScope.roots.map(async participant => ({ participant,
        result: await participant.runtime.collectObservedCommand(commandScope!.token, true) })));
      const checkpointIds = [...new Set([...(result.summary?.checkpointIds || []), ...changes.flatMap(change => change.result.checkpointIds)])];
      const changedPaths = [...new Set([...(result.summary?.changedPaths || []), ...changes.flatMap(change => change.result.changedPaths)])];
      this.#collectCheckpoints();
      result = { ...result, summary: { ...result.summary, checkpointIds, changedPaths }, modelOutput: {
        ...output, checkpointIds, changedPaths, workspaceCheckpointGroups: changes.map(({ participant }) => ({
          workspaceBindingId: participant.binding.id, workspaceRoot: participant.binding.path,
          checkpointIds: checkpointIds.filter(id => this.#checkpointOwners.get(id) === participant) })),
        checkpointCoverage: { complete: changes.every(change => change.result.checkpointCoverage.complete)
          && (output?.checkpointCoverage as { complete?: boolean } | undefined)?.complete !== false,
          excluded: [...new Set(changes.flatMap(change => change.result.checkpointCoverage.excluded))],
          warnings: changes.flatMap(change => change.result.checkpointCoverage.warnings.map(warning => `[${change.participant.binding.path}] ${warning}`)) }
      } };
      if (commandScope.processId) this.#commandScopes.delete(commandScope.processId);
    }
    this.#collectCheckpoints();
    return { ...result, modelOutput: result.modelOutput && typeof result.modelOutput === "object" && !Array.isArray(result.modelOutput)
      ? { ...result.modelOutput, workspaceBindingId: root.binding.id, workspaceRoot: root.binding.path }
      : { result: result.modelOutput, workspaceBindingId: root.binding.id, workspaceRoot: root.binding.path } };
  }

  #collectCheckpoints(): void {
    for (const root of this.#roots.values()) for (const id of root.runtime.getCreatedCheckpointIds()) this.#checkpointOwners.set(id, root);
  }

  getCreatedCheckpointIds(): readonly string[] { this.#collectCheckpoints(); return [...this.#checkpointOwners.keys()]; }
  getWorkspaceCheckpointGroups(): readonly WorkspaceCheckpointGroup[] {
    return [...this.#roots.values()].map(root => ({ workspaceBindingId: root.binding.id, workspaceRoot: root.binding.path, checkpointIds: root.runtime.getCreatedCheckpointIds() }));
  }
  getCheckpointWarnings(): readonly string[] {
    return [...this.#roots.values()].flatMap(root => root.runtime.getCheckpointWarnings().map(warning => `[${root.binding.path}] ${warning}`));
  }
  async getCheckpointDiff(checkpointId: string, includeContent = false): Promise<AgentCheckpointDiff & { readonly workspaceBindingId: string }> {
    this.#collectCheckpoints();
    const owner = this.#checkpointOwners.get(checkpointId);
    if (owner) return { ...await owner.runtime.getCheckpointDiff(checkpointId, includeContent), workspaceBindingId: owner.binding.id };
    // Older/restored checkpoints aren't in this process's creation list. Probe
    // only verified stores; never infer a root from an untrusted path or ID.
    for (const root of this.#roots.values()) {
      try { return { ...await root.runtime.getCheckpointDiff(checkpointId, includeContent), workspaceBindingId: root.binding.id }; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    throw new AgentToolError("INVALID_CHECKPOINT", "Checkpoint is not owned by a verified workspace binding");
  }

  #processOwner(processId: string): WorkspaceToolRuntime {
    const root = this.#processOwners.get(processId);
    if (!root) throw new AgentToolError("PROCESS_NOT_FOUND", "Process session is not owned by this run");
    return root.runtime;
  }
  writeManagedProcess(processId: string, data: string): Promise<{ readonly accepted: number }> {
    this.#assertRunning(); this.#assertCommandPermissions();
    return this.#processOwner(processId).writeManagedProcess(processId, data);
  }
  resizeManagedProcess(processId: string, columns: number, rows: number): { readonly resized: boolean } { return this.#processOwner(processId).resizeManagedProcess(processId, columns, rows); }
  terminateManagedProcess(processId: string): Promise<{ readonly terminated: boolean }> { return this.#processOwner(processId).terminateManagedProcess(processId); }
  finalizeProcessCheckpoints(): Promise<void> {
    return this.#finalizePromise ??= (async () => {
      // A process owned by A can still be writing B while A terminates. Stop
      // every owner first, then collect any root's final state.
      const stopped = await Promise.allSettled([...this.#roots.values()].map(root => root.runtime.stopOwnedProcesses()));
      const results = await Promise.allSettled([...this.#roots.values()].map(root => root.runtime.finalizeProcessCheckpoints()));
      this.#collectCheckpoints();
      const failed = [...stopped, ...results].filter((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failed.length) throw new AggregateError(failed.map(result => result.reason), "Could not finalize all workspace processes");
    })();
  }
  dispose(): Promise<void> {
    return this.#disposePromise ??= (async () => {
      const finalized = await Promise.allSettled([this.finalizeProcessCheckpoints()]);
      const results = await Promise.allSettled([...this.#roots.values()].map(root => root.runtime.dispose()));
      this.#collectCheckpoints();
      const failed = [...finalized, ...results].filter((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failed.length) throw new AggregateError(failed.map(result => result.reason), "Could not dispose all workspace runtimes");
    })();
  }
}
