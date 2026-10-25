import type {
  AgentPermissionMode,
  AgentToolCall,
  AgentToolDescriptor,
  AgentSkillPolicy,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolHandler,
} from "./types.js";
import { AgentToolError } from "./errors.js";
import { narrowAgentPermission } from "./permission.js";
import { ToolExecutionLedger } from "./tool-execution-ledger.js";
import { AGENT_SKILL_LOAD_TOOL_NAME, validatedSkillPolicy } from "./tool-policy.js";
import { coerceToolArgumentsToSchema } from "./tool-arguments.js";
import { TOOL_SEARCH_DESCRIPTOR, TOOL_SEARCH_NAME, ToolSearchIndex } from "./tool-search.js";

/** Tools one model request may carry: OpenAI documents 128 functions, the lowest limit of the supported formats. */
export const MODEL_TOOL_LIMIT = 128;

export { AgentToolError } from "./errors.js";

interface RegisteredTool {
  readonly descriptor: AgentToolDescriptor;
  readonly handler: ToolHandler;
  readonly hostSkillLoader?: boolean;
}

function validToolName(value: string): boolean {
  return /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/.test(value);
}

function cancelledExecution(unsettled = false): ToolExecutionResult {
  return {
    ok: false,
    ...(unsettled ? { unsettled: true as const, usageKnown: false } : {}),
    summary: { kind: "tool.error", params: { code: "CANCELLED" }, title: "Task cancelled" },
    error: { code: "CANCELLED", message: "Agent run was cancelled" },
  };
}

const HANDLER_ABORT_SETTLE_GRACE_MS = 750;

function settleInvocationOnAbort(
  invoke: () => Promise<ToolExecutionResult>,
  signal: AbortSignal | undefined,
  settleGraceMs = HANDLER_ABORT_SETTLE_GRACE_MS,
): Promise<ToolExecutionResult> {
  if (!signal) return invoke();
  if (signal.aborted) return Promise.resolve(cancelledExecution());
  return new Promise<ToolExecutionResult>((resolve, reject) => {
    let settled = false;
    let invocationStarted = false;
    let abortTimer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => {
      signal.removeEventListener("abort", onAbort);
      if (abortTimer) clearTimeout(abortTimer);
    };
    const finish = (result: ToolExecutionResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = (): void => {
      if (!invocationStarted) {
        finish(cancelledExecution());
        return;
      }
      // Give cooperative handlers a short, bounded window to finish cleanup
      // and return their authoritative outcome. A handler that ignores the
      // signal cannot keep execute() pending forever.
      abortTimer = setTimeout(() => finish(cancelledExecution(true)), settleGraceMs);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    try {
      invocationStarted = true;
      // Keep a rejection observer attached after cancellation: a handler that
      // ignores AbortSignal may settle later and must not create an unhandled
      // rejection or overwrite the already-authoritative cancellation result.
      void invoke().then(finish, fail);
    } catch (error) {
      fail(error);
    }
  });
}

export class AgentToolRegistry {
  readonly #tools = new Map<string, RegisteredTool>();
  #executionLedger?: ToolExecutionLedger;
  readonly #skillPolicies = new Map<string, AgentSkillPolicy>();
  #searchIndex?: ToolSearchIndex;
  #catalogWarning?: string;
  /** Host tool groups (name prefix → one-line purpose) that may be loaded on demand when a model's context is small. */
  readonly #deferredGroups = new Map<string, string>();

  constructor(options: { readonly executionLedger?: ToolExecutionLedger } = {}) {
    this.#executionLedger = options.executionLedger;
    this.#register(TOOL_SEARCH_DESCRIPTOR, async (input, context) => {
      const value = input as Record<string, unknown> | undefined;
      if (!value || typeof value.query !== "string" || value.query.length > 300
        || (value.limit !== undefined && (!Number.isInteger(value.limit) || Number(value.limit) < 1 || Number(value.limit) > 5))
        || (value.offset !== undefined && (!Number.isSafeInteger(value.offset) || Number(value.offset) < 0))) {
        throw new AgentToolError("INVALID_TOOL_SEARCH", "Use a query up to 300 characters, limit 1–5, and a non-negative offset");
      }
      const catalog = this.descriptors(context.permissionMode ?? "read_only", context.allowedToolNames)
        .filter(tool => this.#searchable(tool));
      this.#searchIndex ??= new ToolSearchIndex([...this.#tools.values()].map(tool => tool.descriptor).filter(tool => this.#searchable(tool)));
      // A group name ("tabs" or "tabs.*") loads that whole deferred group in one call.
      const group = value.query.trim().replace(/\.\*$/, "");
      const whole = this.#deferredGroups.has(group) ? catalog.filter(tool => this.#groupOf(tool.name) === group) : [];
      const matches = whole.length ? whole : this.#searchIndex.search(value.query, new Set(catalog.map(tool => tool.name)));
      const offset = Number(value.offset ?? 0);
      const tools: AgentToolDescriptor[] = [];
      let resultChars = 0;
      for (const tool of matches.slice(offset, offset + (whole.length ? 24 : Number(value.limit ?? 3)))) {
        const size = JSON.stringify(tool).length;
        if (tools.length && resultChars + size > (whole.length ? 60000 : 22000)) break;
        // MCP registration already bounds a single schema. Always advance at
        // least one result so browsing cannot stall on a large description.
        tools.push(tool);
        resultChars += size;
      }
      // A loaded group arrives with full schemas in the next turn's tool list; the result only names its tools.
      if (whole.length) return { modelOutput: { tools: tools.map(tool => ({ name: tool.name, description: tool.description.slice(0, 160) })), total: matches.length,
        nextOffset: offset + tools.length < matches.length ? offset + tools.length : null, loadedGroup: group,
        hint: `The ${group}.* tools are loaded from your next turn: call them directly.` },
        summary: { kind: "tool.search", params: { count: matches.length }, title: "Searched available tools" } };
      return { modelOutput: { tools, total: matches.length,
        nextOffset: offset + tools.length < matches.length ? offset + tools.length : null,
        sources: [...new Set(catalog.map(tool => tool.source === "mcp" ? tool.name.split(".")[1] : this.#groupOf(tool.name)))].slice(0, 64),
        ...(this.#catalogWarning ? { warning: this.#catalogWarning } : {}),
        hint: tools.length ? "Call these tools directly with their inputSchema in the next turn."
          : "No matching authorized tools. Try a shorter query, source name, or an empty query to browse; no permissions were changed." },
        summary: { kind: "tool.search", params: { count: matches.length }, title: "Searched available tools" } };
    });
  }

  /** Adds a catalog warning for the model; distinct warnings accumulate so a later one never hides an earlier one. */
  setCatalogWarning(warning: string): void {
    const text = warning.trim();
    if (!text || this.#catalogWarning?.includes(text)) return;
    this.#catalogWarning = [this.#catalogWarning, text].filter(Boolean).join(" ").slice(0, 1000);
  }

  useExecutionLedger(ledger: ToolExecutionLedger): void {
    if (this.#executionLedger && this.#executionLedger !== ledger) {
      throw new AgentToolError("EXECUTION_LEDGER_ALREADY_CONFIGURED", "A different tool execution ledger is already configured");
    }
    this.#executionLedger = ledger;
  }

  recoverCommitted(call: AgentToolCall, context: ToolExecutionContext): Promise<ToolExecutionResult | undefined> {
    return this.#executionLedger?.recoverCommitted(call, context) ?? Promise.resolve(undefined);
  }

  register(descriptor: AgentToolDescriptor, handler: ToolHandler): void {
    if (descriptor.name === TOOL_SEARCH_NAME) throw new AgentToolError("RESERVED_TOOL_NAME", "tool.search is provided by the host registry");
    if (descriptor.name === AGENT_SKILL_LOAD_TOOL_NAME) throw new AgentToolError("RESERVED_TOOL_NAME", "skill.load requires the verified host loader registration");
    this.#register(descriptor, handler);
  }

  registerHostSkillLoader(descriptor: AgentToolDescriptor, handler: ToolHandler, policies: readonly AgentSkillPolicy[]): void {
    if (descriptor.name !== AGENT_SKILL_LOAD_TOOL_NAME || !Array.isArray(policies) || policies.length > 24) throw new AgentToolError("INVALID_SKILL_POLICY", "Invalid host skill loader");
    const verified = policies.map(validatedSkillPolicy);
    if (new Set(verified.map(policy => policy.id)).size !== verified.length) throw new AgentToolError("INVALID_SKILL_POLICY", "Duplicate host skill source");
    this.#register({ ...descriptor, source: "skill", requiredPermission: "read_only", concurrencySafe: false, executionKind: "read" }, handler, true);
    for (const policy of verified) this.#skillPolicies.set(policy.id, policy);
  }

  validateSkillPolicy(policy: AgentSkillPolicy): AgentSkillPolicy {
    const validated = validatedSkillPolicy(policy);
    const approved = this.#skillPolicies.get(validated.id);
    if (!approved || JSON.stringify(approved) !== JSON.stringify(validated)) throw new AgentToolError("SKILL_POLICY_STALE", "The loaded skill is no longer approved at this source revision");
    return validated;
  }

  #register(descriptor: AgentToolDescriptor, handler: ToolHandler, hostSkillLoader = false): void {
    if (!validToolName(descriptor.name)) {
      throw new AgentToolError("INVALID_TOOL_NAME", `Invalid tool name: ${descriptor.name}`);
    }
    if (this.#tools.has(descriptor.name)) {
      throw new AgentToolError("DUPLICATE_TOOL", `Tool is already registered: ${descriptor.name}`);
    }
    this.#tools.set(descriptor.name, { descriptor, handler, hostSkillLoader });
    this.#searchIndex = undefined;
  }

  descriptors(
    permissionMode: AgentPermissionMode,
    allowedToolNames?: readonly string[],
  ): readonly AgentToolDescriptor[] {
    const allowed = allowedToolNames ? new Set(allowedToolNames) : undefined;
    return [...this.#tools.values()]
      .filter(tool => narrowAgentPermission(permissionMode, tool.descriptor.requiredPermission)
        === tool.descriptor.requiredPermission)
      .filter(tool => !allowed || allowed.has(tool.descriptor.name))
      .filter(tool => tool.descriptor.name !== TOOL_SEARCH_NAME || [...this.#tools.values()].some(candidate => candidate.descriptor.source === "mcp")
        || [...this.#tools.values()].some(candidate => this.#searchable(candidate.descriptor)))
      .map(tool => tool.descriptor)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  /** Full authorization stays in descriptors/execute; only model disclosure is bounded. */
  /**
   * Host tool groups that may be loaded on demand (Anthropic tool search `defer_loading`, Claude Code deferred tools):
   * only when a model's context is too small for every schema, and then a whole group loads with one tool.search.
   */
  configureDeferredGroups(groups: Readonly<Record<string, string>>): void {
    this.#deferredGroups.clear();
    for (const [group, summary] of Object.entries(groups).slice(0, 32)) {
      if (/^[a-z][a-z0-9_]{0,31}$/.test(group) && typeof summary === "string") this.#deferredGroups.set(group, summary.slice(0, 160));
    }
    this.#searchIndex = undefined;
  }

  #groupOf(name: string): string { return name.split(".")[0] ?? name; }

  #searchable(tool: AgentToolDescriptor): boolean {
    return tool.name !== TOOL_SEARCH_NAME && (tool.source === "mcp" || (tool.source === "builtin" && this.#deferredGroups.has(this.#groupOf(tool.name))));
  }

  modelDescriptors(permissionMode: AgentPermissionMode, allowedToolNames: readonly string[], discovered: ReadonlySet<string>,
    options: { readonly schemaBudgetBytes?: number; readonly used?: ReadonlySet<string> } = {}): readonly AgentToolDescriptor[] {
    const all = this.descriptors(permissionMode, allowedToolNames);
    const mcp = all.filter(tool => tool.source === "mcp");
    let visibleMcp: ReadonlySet<string> | undefined;
    if (mcp.length > 8 || JSON.stringify(mcp).length > 14000) {
      const loaded = [...discovered].slice(-12);
      let schemaBytes = 0;
      const visible = new Set<string>();
      for (const name of loaded.reverse()) {
        const tool = mcp.find(candidate => candidate.name === name);
        if (!tool) continue;
        const size = JSON.stringify(tool).length;
        if (visible.size && schemaBytes + size > 24000) continue;
        visible.add(name); schemaBytes += size;
      }
      visibleMcp = visible;
    }
    let tools = all.filter(tool => tool.source !== "mcp" || !visibleMcp || visibleMcp.has(tool.name));
    // Built-in groups stay out of a small context until the model asks for them; tools it already used or found stay.
    const deferred = new Map<string, number>();
    const budget = options.schemaBudgetBytes ?? Number.POSITIVE_INFINITY;
    const optional = tools.filter(tool => tool.source === "builtin" && this.#deferredGroups.has(this.#groupOf(tool.name)));
    // Too many tools for one request (OpenAI's limit, the lowest) also loads optional groups on demand.
    if (optional.length && (JSON.stringify(tools).length > budget || tools.length > MODEL_TOOL_LIMIT)) {
      // A group the conversation already works with (a tool of it was used or found) stays loaded whole.
      const pinned = new Set([...discovered, ...(options.used ?? [])].map(name => this.#groupOf(name)));
      const keep = new Set(tools.filter(tool => !optional.includes(tool) || pinned.has(this.#groupOf(tool.name))).map(tool => tool.name));
      let size = JSON.stringify(tools.filter(tool => keep.has(tool.name))).length;
      const groups = new Map<string, AgentToolDescriptor[]>();
      for (const tool of optional) if (!keep.has(tool.name)) groups.set(this.#groupOf(tool.name), [...(groups.get(this.#groupOf(tool.name)) ?? []), tool]);
      // Whole groups, smallest first, while they fit; the rest are listed in tool.search.
      for (const [group, members] of [...groups].sort((left, right) => JSON.stringify(left[1]).length - JSON.stringify(right[1]).length)) {
        const extra = JSON.stringify(members).length;
        if (size + extra <= budget && keep.size + members.length < MODEL_TOOL_LIMIT) { for (const tool of members) keep.add(tool.name); size += extra; }
        else deferred.set(group, members.length);
      }
      tools = tools.filter(tool => keep.has(tool.name));
    }
    // Never more than a request may carry; tool.search stays so nothing becomes unreachable.
    if (tools.length > MODEL_TOOL_LIMIT) tools = [...tools.filter(tool => tool.name === TOOL_SEARCH_NAME),
      ...tools.filter(tool => tool.name !== TOOL_SEARCH_NAME).slice(0, MODEL_TOOL_LIMIT - 1)];
    if (!visibleMcp && !deferred.size && !mcp.length) return tools.filter(tool => tool.name !== TOOL_SEARCH_NAME);
    const sources = [...new Set(mcp.map(tool => tool.name.split(".")[1]))].slice(0, 64).join(", ");
    const groupsText = [...deferred].map(([group, count]) => `${group}.* (${count} tools: ${this.#deferredGroups.get(group)})`).join("; ");
    return tools.map(tool => tool.name === TOOL_SEARCH_NAME
      ? { ...tool, description: [tool.description,
        mcp.length ? `Connected sources (${mcp.length} tools): ${sources}.` : "",
        deferred.size ? `Not loaded yet, to save this model's context: ${groupsText}. To use one, first call tool.search with the group name as the query (for example "${[...deferred.keys()][0]}"); that loads the whole group, then call its tools directly.` : "",
        this.#catalogWarning ?? ""].filter(Boolean).join(" ") }
      : tool);
  }

  descriptor(name: string): AgentToolDescriptor | undefined {
    return this.#tools.get(name)?.descriptor;
  }

  unregister(name: string): boolean {
    if (name === TOOL_SEARCH_NAME) return false;
    this.#searchIndex = undefined;
    if (name === AGENT_SKILL_LOAD_TOOL_NAME) this.#skillPolicies.clear();
    return this.#tools.delete(name);
  }

  async execute(
    call: AgentToolCall,
    permissionMode: AgentPermissionMode,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (context.allowedToolNames && !context.allowedToolNames.includes(call.name)) {
      return {
        ok: false,
        summary: { kind: "tool.error", params: { code: "TOOL_NOT_ALLOWED", toolName: call.name }, title: "Tool not allowed" },
        error: { code: "TOOL_NOT_ALLOWED", message: `Tool is not allowed in this run: ${call.name}` },
      };
    }
    const tool = this.#tools.get(call.name);
    if (!tool) {
      return {
        ok: false,
        summary: { kind: "tool.error", params: { code: "TOOL_NOT_FOUND", toolName: call.name }, title: "Tool not found" },
        error: { code: "TOOL_NOT_FOUND", message: `Unknown tool: ${call.name}` },
      };
    }
    if (narrowAgentPermission(permissionMode, tool.descriptor.requiredPermission) !== tool.descriptor.requiredPermission) {
      return {
        ok: false,
        summary: { kind: "tool.error", params: { code: "PERMISSION_DENIED", toolName: call.name }, title: "Permission denied" },
        error: {
          code: "PERMISSION_DENIED",
          message: `${call.name} requires ${tool.descriptor.requiredPermission} permission`,
        },
      };
    }
    if (context.signal?.aborted) {
      return {
        ok: false,
        summary: { kind: "tool.error", params: { code: "CANCELLED" }, title: "Task cancelled" },
        error: { code: "CANCELLED", message: "Agent run was cancelled" },
      };
    }
    const invoke = (): Promise<ToolExecutionResult> => settleInvocationOnAbort(async () => {
      try {
        // Models sometimes stringify a whole structured value (a JSON array as
        // text, "50" for an integer). Coerce against the declared schema before
        // the handler validates, so a well-intended call is not rejected
        // (audit OpenCode #9). The ledger keeps the raw arguments for identity.
        const coercedArguments = coerceToolArgumentsToSchema(call.arguments, tool.descriptor.inputSchema);
        const result = await tool.handler(coercedArguments, { ...context, permissionMode });
        const policy = tool.hostSkillLoader ? this.validateSkillPolicy(result.skillPolicy!) : undefined;
        return {
          ok: true,
          ...(result.unsettled ? { unsettled: true as const } : {}),
          output: result.modelOutput,
          ...(result.attachments?.length ? { attachments: result.attachments } : {}),
          summary: context.signal?.aborted ? { ...result.summary, terminationReason: "cancelled" } : result.summary,
          ...(policy ? { skillPolicy: policy } : {}),
          ...(result.usage ? { usage: result.usage } : {}),
          ...(result.usageKnown === undefined ? {} : { usageKnown: result.usageKnown }),
        };
      } catch (error) {
        const known = error instanceof AgentToolError;
        const childBudget = known ? error.childReceipt?.tokenBudget : undefined;
        const childUsage = known ? error.usage ?? (childBudget ? { inputTokens: childBudget.inputTokens, outputTokens: childBudget.outputTokens } : undefined) : undefined;
        return {
          ok: false,
          ...(known && (error.childReceipt || childUsage) ? {
            usageKnown: error.usageKnown ?? childBudget?.usageKnown ?? false,
            ...(childUsage ? { usage: childUsage } : {}),
          } : {}),
          summary: { kind: "tool.error", params: { ...(known ? error.params : {}), code: known ? error.code : "TOOL_EXECUTION_FAILED", toolName: call.name },
            title: known ? error.message : "Tool execution failed" },
          error: {
            code: known ? error.code : "TOOL_EXECUTION_FAILED",
            message: known ? error.message : "Tool execution failed",
            ...(known && error.params ? { params: error.params } : {}),
            ...(known && error.childReceipt ? { childReceipt: error.childReceipt } : {}),
          },
        };
      }
    }, context.signal, call.name === "agent.delegate" ? 30_000 : HANDLER_ABORT_SETTLE_GRACE_MS);
    return this.#executionLedger
      ? this.#executionLedger.execute(call, tool.descriptor, { ...context, permissionMode }, invoke)
      : invoke();
  }
}
