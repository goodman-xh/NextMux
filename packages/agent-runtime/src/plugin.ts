import type {
  AgentToolDescriptor,
  ToolHandler,
  ToolSource,
} from "./types.js";
import { AgentToolError } from "./errors.js";
import { AgentToolRegistry } from "./registry.js";

/**
 * A plugin is an in-process extension of the agent runtime.  The host accepts
 * plugin objects supplied by trusted application code only; it deliberately
 * does not fetch or evaluate code from a URL.
 */
export type AgentPluginScope =
  | { readonly kind: "global" }
  | { readonly kind: "workspace"; readonly workspaceRoot: string }
  | { readonly kind: "task"; readonly taskId: string; readonly workspaceRoot?: string };

export type AgentPluginScopeKind = AgentPluginScope["kind"];

export type AgentPluginHookName =
  | "before_model_request"
  | "after_model_response"
  | "before_tool_execute"
  | "after_tool_execute"
  | "before_context_compaction"
  | "after_context_compaction";

export type AgentPluginHook = (payload: unknown) => void | Promise<void>;

export interface AgentPluginManifest {
  /** Stable identifier shared by persisted settings and event records. */
  readonly id: string;
  readonly version: string;
  readonly name?: string;
  readonly description?: string;
  /** Scopes in which the plugin can be installed. Defaults to global only. */
  readonly scopes?: readonly AgentPluginScopeKind[];
  /** When set, tools registered by this plugin must use this transport source. */
  readonly toolSource?: ToolSource;
  /** Bounded, informational capability labels for diagnostics and future UI. */
  readonly capabilities?: readonly string[];
}

export interface AgentPluginContext {
  readonly manifest: AgentPluginManifest;
  readonly scope: AgentPluginScope;
  /** Register a tool owned by this plugin. Registration remains subject to host permission checks. */
  readonly registerTool: (descriptor: AgentToolDescriptor, handler: ToolHandler) => void;
  /** Register a lifecycle hook. Hooks are removed automatically when the plugin is uninstalled. */
  readonly registerHook: (name: AgentPluginHookName, handler: AgentPluginHook) => void;
}

export interface AgentPlugin {
  readonly manifest: AgentPluginManifest;
  readonly setup: (context: AgentPluginContext) => void | Promise<void>;
  readonly dispose?: (context: AgentPluginContext) => void | Promise<void>;
}

export interface AgentPluginHostOptions {
  readonly registry: AgentToolRegistry;
}

interface InstalledPlugin {
  readonly plugin: AgentPlugin;
  context: AgentPluginContext;
  readonly scope: AgentPluginScope;
  readonly toolNames: Set<string>;
  readonly hooks: Map<AgentPluginHookName, Set<AgentPluginHook>>;
}

interface PluginHookEntry {
  readonly pluginId: string;
  readonly handler: AgentPluginHook;
  readonly scope: AgentPluginScope;
}

const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/;
const VERSION_PATTERN = /^[0-9]+(?:\.[0-9]+){0,2}(?:[-+][a-zA-Z0-9.-]+)?$/;
const MAX_CAPABILITIES = 32;
const MAX_CAPABILITY_LENGTH = 96;

function validateManifest(manifest: AgentPluginManifest): AgentPluginManifest {
  if (!manifest || typeof manifest !== "object") {
    throw new AgentToolError("INVALID_PLUGIN_MANIFEST", "Plugin manifest is required");
  }
  if (typeof manifest.id !== "string" || !PLUGIN_ID_PATTERN.test(manifest.id) || manifest.id.length > 120) {
    throw new AgentToolError("INVALID_PLUGIN_MANIFEST", "Plugin id must be a stable dotted identifier");
  }
  if (typeof manifest.version !== "string" || !VERSION_PATTERN.test(manifest.version) || manifest.version.length > 64) {
    throw new AgentToolError("INVALID_PLUGIN_MANIFEST", "Plugin version must be a numeric version");
  }
  if (manifest.name !== undefined && (typeof manifest.name !== "string" || manifest.name.length > 160)) {
    throw new AgentToolError("INVALID_PLUGIN_MANIFEST", "Plugin name is too long");
  }
  if (manifest.description !== undefined && (typeof manifest.description !== "string" || manifest.description.length > 2_000)) {
    throw new AgentToolError("INVALID_PLUGIN_MANIFEST", "Plugin description is too long");
  }
  const scopes = manifest.scopes === undefined ? ["global"] as const : manifest.scopes;
  if (!Array.isArray(scopes) || scopes.length < 1 || scopes.length > 3
    || scopes.some(scope => scope !== "global" && scope !== "workspace" && scope !== "task")
    || new Set(scopes).size !== scopes.length) {
    throw new AgentToolError("INVALID_PLUGIN_MANIFEST", "Plugin scopes must be unique global, workspace, or task values");
  }
  if (manifest.capabilities !== undefined && (!Array.isArray(manifest.capabilities) || manifest.capabilities.length > MAX_CAPABILITIES
    || manifest.capabilities.some(capability => typeof capability !== "string" || capability.length < 1 || capability.length > MAX_CAPABILITY_LENGTH))) {
    throw new AgentToolError("INVALID_PLUGIN_MANIFEST", "Plugin capabilities are invalid or too numerous");
  }
  return Object.freeze({
    ...manifest,
    scopes: Object.freeze([...scopes]),
    ...(manifest.capabilities ? { capabilities: Object.freeze([...manifest.capabilities]) } : {}),
  });
}

function scopeMatches(scope: AgentPluginScope, context: { readonly runId: string; readonly executionScopeId?: string; readonly workspaceRoot?: string; readonly taskContext?: { readonly conversationId?: string; readonly rootRunId?: string; readonly parentRunId?: string; readonly workspaceRoot?: string } }): boolean {
  if (scope.kind === "global") return true;
  if (scope.kind === "workspace") {
    return (context.workspaceRoot ?? context.taskContext?.workspaceRoot) === scope.workspaceRoot;
  }
  return context.executionScopeId === scope.taskId
    || context.runId === scope.taskId
    || context.taskContext?.conversationId === scope.taskId
    || context.taskContext?.rootRunId === scope.taskId
    || context.taskContext?.parentRunId === scope.taskId;
}

function validateScope(scope: AgentPluginScope): void {
  if (!scope || typeof scope !== "object") throw new AgentToolError("INVALID_PLUGIN_SCOPE", "Plugin scope is required");
  if (scope.kind === "global") return;
  if (scope.kind === "workspace") {
    if (typeof scope.workspaceRoot !== "string" || scope.workspaceRoot.trim().length === 0 || scope.workspaceRoot.length > 4_096) {
      throw new AgentToolError("INVALID_PLUGIN_SCOPE", "Workspace plugin scope requires a workspace root");
    }
    return;
  }
  if (scope.kind === "task") {
    if (typeof scope.taskId !== "string" || scope.taskId.trim().length === 0 || scope.taskId.length > 160) {
      throw new AgentToolError("INVALID_PLUGIN_SCOPE", "Task plugin scope requires a task id");
    }
    if (scope.workspaceRoot !== undefined && (typeof scope.workspaceRoot !== "string" || scope.workspaceRoot.length > 4_096)) {
      throw new AgentToolError("INVALID_PLUGIN_SCOPE", "Invalid workspace root in task plugin scope");
    }
    return;
  }
  throw new AgentToolError("INVALID_PLUGIN_SCOPE", "Unknown plugin scope");
}

/**
 * Lightweight lifecycle host for trusted in-process extensions.  Existing
 * registries remain valid; the host simply tracks ownership so a plugin can
 * be disabled without removing unrelated tools or hooks.
 */
export class AgentPluginHost {
  readonly #registry: AgentToolRegistry;
  readonly #plugins = new Map<string, InstalledPlugin>();
  readonly #hooks = new Map<AgentPluginHookName, Set<PluginHookEntry>>();

  constructor(options: AgentPluginHostOptions) {
    this.#registry = options.registry;
  }

  get registry(): AgentToolRegistry { return this.#registry; }

  has(pluginId: string): boolean { return this.#plugins.has(pluginId); }

  manifests(): readonly AgentPluginManifest[] {
    return [...this.#plugins.values()].map(installed => installed.plugin.manifest);
  }

  toolNames(pluginId: string): readonly string[] {
    return [...(this.#plugins.get(pluginId)?.toolNames ?? [])];
  }

  async install(plugin: AgentPlugin, scope: AgentPluginScope = { kind: "global" }): Promise<void> {
    if (!plugin || typeof plugin !== "object" || typeof plugin.setup !== "function") {
      throw new AgentToolError("INVALID_PLUGIN", "Plugin setup is required");
    }
    const manifest = validateManifest(plugin.manifest);
    validateScope(scope);
    if (this.#plugins.has(manifest.id)) throw new AgentToolError("PLUGIN_ALREADY_INSTALLED", `Plugin is already installed: ${manifest.id}`);
    if (!(manifest.scopes ?? ["global"]).includes(scope.kind)) {
      throw new AgentToolError("PLUGIN_SCOPE_NOT_ALLOWED", `Plugin ${manifest.id} does not allow the ${scope.kind} scope`);
    }

    const installed: InstalledPlugin = {
      plugin: { ...plugin, manifest },
      context: undefined as unknown as AgentPluginContext,
      scope,
      toolNames: new Set<string>(),
      hooks: new Map<AgentPluginHookName, Set<AgentPluginHook>>(),
    };
    const context: AgentPluginContext = {
      manifest,
      scope,
      registerTool: (descriptor, handler) => {
        if (!descriptor || typeof descriptor !== "object" || typeof handler !== "function") {
          throw new AgentToolError("INVALID_PLUGIN_TOOL", `Plugin ${manifest.id} provided an invalid tool`);
        }
        if (manifest.toolSource && descriptor.source !== manifest.toolSource) {
          throw new AgentToolError("PLUGIN_TOOL_SOURCE_MISMATCH", `Plugin ${manifest.id} requires ${manifest.toolSource} tools`);
        }
        if (descriptor.pluginId && descriptor.pluginId !== manifest.id) {
          throw new AgentToolError("PLUGIN_TOOL_OWNER_MISMATCH", `Tool ${descriptor.name} is owned by another plugin`);
        }
        const scopedHandler: ToolHandler = async (input, executionContext) => {
          if (!scopeMatches(scope, executionContext)) {
            throw new AgentToolError("PLUGIN_SCOPE_MISMATCH", `Plugin ${manifest.id} is not active in this task scope`);
          }
          return handler(input, executionContext);
        };
        this.#registry.register({ ...descriptor, pluginId: manifest.id }, scopedHandler);
        installed.toolNames.add(descriptor.name);
      },
      registerHook: (name, handler) => {
        if (!Object.prototype.hasOwnProperty.call({
          before_model_request: true,
          after_model_response: true,
          before_tool_execute: true,
          after_tool_execute: true,
          before_context_compaction: true,
          after_context_compaction: true,
        }, name) || typeof handler !== "function") {
          throw new AgentToolError("INVALID_PLUGIN_HOOK", `Plugin ${manifest.id} provided an invalid hook`);
        }
        const owned = installed.hooks.get(name) ?? new Set<AgentPluginHook>();
        owned.add(handler);
        installed.hooks.set(name, owned);
        const global = this.#hooks.get(name) ?? new Set<PluginHookEntry>();
        global.add({ pluginId: manifest.id, handler, scope });
        this.#hooks.set(name, global);
      },
    };
    installed.context = context;

    try {
      await plugin.setup(context);
      this.#plugins.set(manifest.id, installed);
    } catch (error) {
      this.#removeRegistrations(installed);
      throw error;
    }
  }

  async uninstall(pluginId: string): Promise<boolean> {
    const installed = this.#plugins.get(pluginId);
    if (!installed) return false;
    try {
      if (installed.plugin.dispose) await installed.plugin.dispose(installed.context);
    } finally {
      this.#removeRegistrations(installed);
      this.#plugins.delete(pluginId);
    }
    return true;
  }

  async dispose(): Promise<void> {
    for (const pluginId of [...this.#plugins.keys()]) await this.uninstall(pluginId);
  }

  /** Invoke hooks in installation order. Scoped hooks only run for their active task. */
  async emit(name: AgentPluginHookName, payload: unknown, executionContext?: {
    readonly runId: string;
    readonly executionScopeId?: string;
    readonly workspaceRoot?: string;
    readonly taskContext?: { readonly conversationId?: string; readonly rootRunId?: string; readonly parentRunId?: string; readonly workspaceRoot?: string };
  }): Promise<void> {
    const hooks = this.#hooks.get(name);
    if (!hooks) return;
    for (const entry of [...hooks]) {
      if (entry.scope.kind !== "global" && !executionContext) continue;
      if (executionContext && !scopeMatches(entry.scope, executionContext)) continue;
      await entry.handler(payload);
    }
  }

  #removeRegistrations(installed: InstalledPlugin): void {
    for (const toolName of installed.toolNames) this.#registry.unregister(toolName);
    for (const [name, handlers] of installed.hooks) {
      const global = this.#hooks.get(name);
      if (!global) continue;
      for (const handler of handlers) {
        for (const entry of [...global]) {
          if (entry.pluginId === installed.plugin.manifest.id && entry.handler === handler) global.delete(entry);
        }
      }
      if (global.size === 0) this.#hooks.delete(name);
    }
  }
}
