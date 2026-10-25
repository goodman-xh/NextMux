import type { AgentDurableCheckpointWriter } from './durable.js';
import { canonicalRuntimeFinal } from "./semantic-messages.js";
import { randomUUID } from "node:crypto";
import type { DelegatedWorkspacePrepareInput, DelegatedWorkspaceReview, PreparedDelegatedWorkspace } from "./delegated-workspace.js";

import { AgentToolError, AgentToolRegistry } from "./registry.js";
import { narrowAgentPermission } from "./permission.js";
import { createAgentChildReceipt } from "./delegation-receipt.js";
import { agentRunPauseRequested, AgentRunInterruptedError, AgentRunner, DEFAULT_AGENT_INSTRUCTIONS, MAX_AGENT_PROMPT_CHARACTERS, rebaseAgentRunCheckpoint, type AgentRunnerOptions } from "./runner.js";
import { childAgentTaskContext, createAgentTaskContext } from "./task-context.js";
import { normalizeAgentTokenBudget } from "./token-budget.js";
import { AGENT_USER_INPUT_TOOL_NAME } from "./user-input.js";
import { createToolNameCodec } from "./tool-names.js";
import {
  AGENT_COUNCIL_ROLE_IDS,
  resolveAgentCouncilRoleId,
  type AgentCouncilRoleId,
  type AgentCouncilRouteDecision,
} from "./council.js";
import type {
  AgentModelClient,
  AgentChildReceipt,
  AgentContextMemoryItem,
  AgentPermissionMode,
  AgentReasoningEffort,
  AgentRunCheckpoint,
  AgentRunEvent,
  AgentRunStopReason,
  AgentRunStatus,
  AgentRunResult,
  AgentTaskContext,
  AgentTokenBudget,
  AgentTokenBudgetSnapshot,
  AgentUsage,
  AgentToolDescriptor,
  ToolHandler,
  ToolHandlerResult,
} from "./types.js";

export const AGENT_DELEGATE_TOOL_NAME = "agent.delegate";

/**
 * Conversation lookup is intentionally not inherited by a delegated child.
 * A child receives a bounded task context for its owning conversation; giving
 * it the unrestricted history search tools would let a model cross the
 * conversation boundary and defeat the parent/child isolation contract.
 * Hosts can provide a scoped proxy in the child tool registry when that is
 * explicitly needed, rather than weakening this default deny-list.
 */
const GLOBAL_CONVERSATION_MEMORY_TOOL_NAMES = new Set([
  "nextmux.search_conversations",
  "nextmux.get_conversation_message",
]);

export interface AgentDelegateInput {
  readonly task: string;
  readonly role?: AgentCouncilRoleId;
  readonly slotId?: string;
  /** Optional previous child run/session ID to continue an existing subagent or Council specialist session. */
  readonly sessionId?: string;
  readonly resumeRunId?: string;
  readonly acceptanceCriteria?: readonly string[];
  readonly tools?: readonly string[];
  readonly permissionMode?: AgentPermissionMode;
  readonly maxTurns?: number;
  /** Optional child-only input ceiling. */
  readonly maxInputTokens?: number;
  /** Optional child-only output ceiling. */
  readonly maxOutputTokens?: number;
  /** Explicit ids from the already-approved task memory; never conversation history. */
  readonly memoryIds?: readonly string[];
}

export interface AgentDelegationMemoryResolutionContext {
  readonly runId: string;
  readonly workspaceRoot?: string;
  readonly taskContext?: AgentTaskContext;
}

/** Confidence in the saved safe boundary, not a complete result cache or replay permission. */
export type AgentDelegationRecoveryStatus = "durable" | "unavailable" | "unknown";

export interface AgentDelegateOutput {
  readonly runId: string;
  /** Stable session identifier (matches runId) that can be passed back as sessionId to continue talking to this specialist. */
  readonly sessionId?: string;
  /**
   * With a sessionId: true when the child continued that session's conversation, false when no such session is kept
   * in this run (it finished in an earlier message, or the id is wrong) and the child started over.
   */
  readonly sessionContinued?: boolean;
  readonly status: AgentRunStatus;
  /** Stable reason that lets the parent distinguish completion, cancellation, pause and limits. */
  readonly stopReason: AgentRunStopReason;
  readonly finalText: string;
  readonly finalMessage?: import("./types.js").AgentRuntimeFinalMessage;
  /** Isolated edits remain outside the parent project until an explicit merge. */
  readonly workspaceReview?: DelegatedWorkspaceReview;
  readonly workspaceReviewError?: { readonly code: string; readonly message: string };
  readonly outputParts?: readonly import('./types.js').AgentOutputPart[];
  readonly citations?: readonly import("./types.js").ModelCitation[];
  /** Durable parent-facing evidence for diagnosing a child after its panel closes. */
  readonly receipt: AgentChildReceipt;
  /** Opaque host-owned handle for a safe child continuation, when one was persisted. */
  readonly resumeCheckpointId?: string;
  readonly recoveryStatus?: AgentDelegationRecoveryStatus;
  /** A persistence failure is diagnostic data; it must not turn a completed child into a failure. */
  readonly checkpointError?: {
    readonly code: string;
    readonly message: string;
  };
  readonly depth: number;
  readonly usage: AgentUsage;
  /** False when a child provider response did not expose verifiable usage. */
  readonly usageKnown?: boolean;
  readonly turns: number;
  readonly toolCalls: number;
  readonly tokenBudget?: AgentTokenBudgetSnapshot;
  readonly role?: AgentCouncilRoleId;
  readonly slotId?: string;
  readonly modelId?: string;
  readonly modelLabel?: string;
  readonly routeSource?: AgentCouncilRouteDecision["routeSource"];
  readonly invocationKey?: string;
}

/**
 * Durable lifecycle records for a delegated child.  The host can persist
 * these records independently of the visible conversation, so closing a
 * child tab never erases the evidence needed by the parent run.
 */
export type AgentDelegationLifecycle =
  | {
      readonly type: "started";
      readonly parentRunId: string;
      readonly rootRunId: string;
      readonly childRunId: string;
      readonly depth: number;
      readonly task: string;
      readonly taskContext: AgentTaskContext;
      readonly role?: AgentCouncilRoleId;
      readonly slotId?: string;
      readonly modelId?: string;
      readonly modelLabel?: string;
      readonly routeSource?: AgentCouncilRouteDecision["routeSource"];
      readonly invocationKey?: string;
    }
  | {
      readonly type: "event";
      readonly parentRunId: string;
      readonly rootRunId: string;
      readonly childRunId: string;
      readonly depth: number;
      readonly event: AgentRunEvent;
    }
  | {
      readonly type: "completed";
      readonly parentRunId: string;
      readonly rootRunId: string;
      readonly childRunId: string;
      readonly depth: number;
      readonly task: string;
      readonly result: AgentDelegateOutput;
      readonly taskContext: AgentTaskContext;
      readonly checkpoint?: AgentRunCheckpoint;
      readonly resumeCheckpointId?: string;
      readonly checkpointError?: {
        readonly code: string;
        readonly message: string;
      };
      readonly role?: AgentCouncilRoleId;
      readonly slotId?: string;
      readonly modelId?: string;
      readonly modelLabel?: string;
      readonly routeSource?: AgentCouncilRouteDecision["routeSource"];
      readonly invocationKey?: string;
    }
  | {
      readonly type: "failed";
      readonly parentRunId: string;
      readonly rootRunId: string;
      readonly childRunId: string;
      readonly depth: number;
      readonly task: string;
      readonly taskContext: AgentTaskContext;
      readonly error: {
        readonly code: string;
        readonly message: string;
      };
      /** A bounded outcome even when the child failed before producing a normal result. */
      readonly receipt: AgentChildReceipt;
      /** Present when a model interruption left a safe boundary to resume from. */
      readonly checkpoint?: AgentRunCheckpoint;
      readonly resumeCheckpointId?: string;
      readonly recoveryStatus?: AgentDelegationRecoveryStatus;
      readonly usage?: AgentUsage;
      readonly usageKnown?: boolean;
      readonly checkpointError?: {
        readonly code: string;
        readonly message: string;
      };
      readonly role?: AgentCouncilRoleId;
      readonly slotId?: string;
      readonly modelId?: string;
      readonly modelLabel?: string;
      readonly routeSource?: AgentCouncilRouteDecision["routeSource"];
      readonly invocationKey?: string;
    };

export interface AgentDelegationCheckpointMetadata {
  readonly parentRunId: string;
  readonly rootRunId: string;
  readonly childRunId: string;
  readonly depth: number;
  readonly status: AgentRunStatus | "running" | "failed";
  readonly stopReason?: AgentRunStopReason;
  readonly taskContext: AgentTaskContext;
}

export interface AgentDelegationEvent {
  readonly parentRunId: string;
  readonly rootRunId: string;
  readonly depth: number;
  readonly event: AgentRunEvent;
}

export interface AgentDelegationChildExecutionRequest {
  readonly childRunId: string;
  readonly parentRunId: string;
  readonly rootRunId: string;
  readonly depth: number;
  readonly dispatchIndex: number;
  readonly input: AgentDelegateInput;
  readonly taskContext: AgentTaskContext;
  readonly maxTurns: number;
  readonly tokenBudget?: AgentTokenBudget;
  readonly executionId?: string;
  readonly signal?: AbortSignal;
}

export interface AgentDelegationChildExecutionOverride {
  /** Exact child route capacity. Empty means unknown; never inherit another model. */
  readonly getContextLimits?: AgentRunnerOptions["getContextLimits"];
  readonly model?: AgentModelClient;
  readonly instructions?: string;
  readonly role?: AgentCouncilRoleId;
  readonly slotId?: string;
  readonly modelId?: string;
  readonly modelLabel?: string;
  readonly routeSource?: AgentCouncilRouteDecision["routeSource"];
  readonly invocationKey?: string;
  readonly reasoningEffort?: AgentReasoningEffort;
  readonly reasoningBudgetTokens?: number;
  readonly reasoningEnabled?: boolean;
  readonly reasoningExclude?: boolean;
  readonly reasoningMode?: "adaptive" | "enabled" | "disabled";
  readonly initialOutputTokenLimit?: number;
  /** Host-owned completed output; preserve its original child identity and receipt. */
  readonly cachedResult?: AgentDelegateOutput;
}

export interface AgentDurableDelegationClaim {
  readonly childRunId: string;
  readonly invocationKey: string;
  readonly cachedResult?: AgentDelegateOutput;
  /** Host-verified continuation of this exact child and original operation. */
  readonly resumeCheckpoint?: AgentRunCheckpoint;
  /** Durable running CAS completes before model client/workspace creation. */
  readonly begin: () => Promise<void>;
  /** Reset an admission only when setup failed before any child model/tool work. */
  readonly abortBeforeStart?: (reason: { readonly code: string; readonly message: string }) => Promise<void>;
  readonly resolveExecution: () => Promise<AgentDelegationChildExecutionOverride | undefined>;
  readonly complete: (result: AgentDelegateOutput) => Promise<void>;
  /** Parent accounting includes all original attempt receipts; the child output usage remains unmodified. */
  readonly accounting?: () => { usage: AgentUsage; usageKnown: boolean };
  readonly release?: () => void | Promise<void>;
  readonly commitChildCheckpoint: (checkpoint: AgentRunCheckpoint, handle: string) => ReturnType<AgentDurableCheckpointWriter>;
}
export interface AgentDelegationRuntimeOptions {
  readonly durable?: { readonly admit: (request: AgentDelegationChildExecutionRequest, context: Parameters<ToolHandler>[1]) => Promise<AgentDurableDelegationClaim> };
  readonly model: AgentModelClient;
  /** Rebind write-capable child tools to an independent checkout supplied by the host. */
  readonly prepareWorkspace?: (input: DelegatedWorkspacePrepareInput) => Promise<PreparedDelegatedWorkspace>;
  /** Host opt-in for child-owned results; never a model-supplied delegation argument. */
  readonly acceptOrderedOutput?: true;
  readonly tools: AgentToolRegistry;
  readonly maxPermissionMode: AgentPermissionMode;
  readonly allowedToolNames: readonly string[];
  readonly reasoningEffort?: AgentReasoningEffort;
  readonly reasoningBudgetTokens?: number;
  readonly reasoningEnabled?: boolean;
  readonly reasoningExclude?: boolean;
  readonly reasoningMode?: "adaptive" | "enabled" | "disabled";
  readonly contextWindowTokens?: number;
  readonly getContextLimits?: AgentRunnerOptions["getContextLimits"];
  /** Known model/transport output ceiling; omitted when unpublished. */
  readonly modelOutputTokenLimit?: number;
  readonly initialOutputTokenLimit?: number;
  readonly modelInputTokenLimit?: number;
  /** @deprecated Known hard limits apply in automatic mode too. */
  readonly enforceContextOutputLimit?: boolean;
  readonly maxDepth?: number;
  readonly maxTurns?: number;
  readonly maxToolCalls?: number;
  readonly maxParallelToolCalls?: number;
  /** Host-selected deadline applied independently to every child model attempt. */
  readonly modelTimeoutMs?: number;
  /** Default cumulative token ceiling inherited by every child. */
  readonly tokenBudget?: AgentTokenBudget;
  /** Fallback context supplied by the host when a tool call has no context. */
  readonly taskContext?: AgentTaskContext;
  readonly onEvent?: (event: AgentDelegationEvent) => void | Promise<void>;
  readonly onLifecycle?: (event: AgentDelegationLifecycle) => void | Promise<void>;
  /**
   * Persists a child checkpoint in the host-owned store and returns an opaque
   * handle.  The runtime never serializes the checkpoint into model output.
   */
  readonly checkpointPolicy?: "best_effort" | "required";
  readonly persistCheckpoint?: (
    checkpoint: AgentRunCheckpoint,
    metadata: AgentDelegationCheckpointMetadata
  ) => string | undefined | Promise<string | undefined>;
  /** Optional host resolver for scoped memory references. It must not return a transcript. */
  readonly resolveSelectedMemory?: (
    memoryIds: readonly string[],
    context: AgentDelegationMemoryResolutionContext
  ) => readonly AgentContextMemoryItem[] | Promise<readonly AgentContextMemoryItem[]>;
  /** Optional Council Mode / specialist model resolver per delegated invocation. */
  readonly resolveChildExecution?: (
    request: AgentDelegationChildExecutionRequest
  ) => AgentDelegationChildExecutionOverride | undefined | Promise<AgentDelegationChildExecutionOverride | undefined>;
}

const permissions: readonly AgentPermissionMode[] = ["read_only", "workspace_write", "full_access"];

function boundedOption(value: number | undefined, fallback: number, minimum: number, maximum: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new AgentToolError("INVALID_DELEGATION_POLICY", `${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function delegatedTokenBudget(input: {
  readonly maxInputTokens?: unknown;
  readonly maxOutputTokens?: unknown;
}): AgentTokenBudget | undefined {
  const hasBudget = input.maxInputTokens !== undefined || input.maxOutputTokens !== undefined;
  if (!hasBudget) return undefined;
  const budget = normalizeAgentTokenBudget({
    ...(input.maxInputTokens === undefined ? {} : { maxInputTokens: input.maxInputTokens }),
    ...(input.maxOutputTokens === undefined ? {} : { maxOutputTokens: input.maxOutputTokens }),
  });
  if (!budget) {
    throw new AgentToolError("INVALID_DELEGATION_INPUT", "Delegated token limits must be positive bounded integers");
  }
  return budget;
}

function narrowerTokenBudget(
  inherited: AgentTokenBudget | undefined,
  requested: AgentTokenBudget | undefined,
): AgentTokenBudget | undefined {
  if (!inherited) return requested;
  if (!requested) return inherited;
  const minimum = (left: number | undefined, right: number | undefined): number | undefined => {
    if (left === undefined) return right;
    if (right === undefined) return left;
    return Math.min(left, right);
  };
  const maxInputTokens = minimum(inherited.maxInputTokens, requested.maxInputTokens);
  const maxOutputTokens = minimum(inherited.maxOutputTokens, requested.maxOutputTokens);
  return {
    ...(maxInputTokens === undefined ? {} : { maxInputTokens }),
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
  };
}

function validToolName(name: unknown): name is string {
  return typeof name === "string" && /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/.test(name);
}

function validMemoryId(name: unknown): name is string {
  return typeof name === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,239}$/.test(name.trim());
}

function safeCheckpointHandle(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return /^[A-Za-z0-9._:-]{1,240}$/.test(normalized) ? normalized : undefined;
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/\b(?:sk|rk|pk|nmxm|nmxu)_[A-Za-z0-9._-]{8,}\b/g, "[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, "Bearer [REDACTED]")
    .replace(/((?:authorization|proxy-authorization|cookie|set-cookie|api[_ -]?key|token|password|secret)\s*[=:]\s*)\S+/gi, "$1[REDACTED]");
}

function safeError(error: unknown): { readonly code: string; readonly message: string } {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : undefined;
  const code = typeof record?.code === "string" && record.code.trim()
    ? record.code.trim().slice(0, 120)
    : "CHILD_AGENT_FAILED";
  // Model adapters may retain localized diagnostics for the UI. Parent tool results use a stable English failure.
  const message = error instanceof AgentRunInterruptedError
    ? `The child model request failed (${code})`
    : error instanceof AgentToolError ? error.message : "The delegated child agent failed";
  return { code, message: redactSensitiveText(message).replace(/[\u0000\r\n]+/g, " ").slice(0, 2_000) };
}

function extractPartialChildProgress(events: readonly AgentRunEvent[]): string | undefined {
  const toolSummaries: string[] = [];
  let assistantText = "";
  for (const event of events) {
    if (event.type === "assistant_delta" && typeof event.delta === "string") {
      assistantText += event.delta;
    } else if (event.type === "assistant_progress" && event.origin === "model" && typeof event.content === "string" && !assistantText) {
      assistantText = event.content;
    } else if (event.type === "tool_completed") {
      const target = event.summary?.resource?.kind === "file"
        ? event.summary.resource.path
        : event.summary?.target || event.summary?.title || "";
      const cleanTarget = redactSensitiveText(String(target)).replace(/[\u0000\r\n]+/g, " ").trim().slice(0, 80);
      const statusSuffix = event.status && event.status !== "succeeded" ? ` (${event.status})` : "";
      toolSummaries.push(cleanTarget && cleanTarget !== event.toolName
        ? `${event.toolName}: ${cleanTarget}${statusSuffix}`
        : `${event.toolName}${statusSuffix}`);
    }
  }
  const parts: string[] = [];
  if (toolSummaries.length > 0) {
    parts.push(`tools=[${toolSummaries.slice(-6).join(", ")}]`);
  }
  const cleanAssistant = redactSensitiveText(assistantText).replace(/[\u0000\r\n]+/g, " ").trim();
  if (cleanAssistant) {
    const excerpt = cleanAssistant.length > 400 ? `...${cleanAssistant.slice(-397)}` : cleanAssistant;
    parts.push(`output=${JSON.stringify(excerpt)}`);
  }
  if (!parts.length) return undefined;
  return parts.join("; ").slice(0, 600);
}

function parseInput(input: unknown, maximumTurns: number): AgentDelegateInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AgentToolError("INVALID_DELEGATION_INPUT", "Delegation input must be an object");
  }
  const candidate = input as Record<string, unknown>;
  if (typeof candidate.task !== "string" || !candidate.task.trim()
    || candidate.task.length > MAX_AGENT_PROMPT_CHARACTERS || candidate.task.includes("\0")) {
    throw new AgentToolError("INVALID_DELEGATION_INPUT", `Delegated task must contain 1 to ${MAX_AGENT_PROMPT_CHARACTERS} characters`);
  }
  let role: AgentCouncilRoleId | undefined;
  if (candidate.role !== undefined) {
    if (typeof candidate.role !== "string" || !candidate.role.trim() || candidate.role.length > 64) {
      throw new AgentToolError("INVALID_DELEGATION_INPUT", "Delegated role must be a valid role identifier");
    }
    // A role the team does not have is reported to the model, which can correct the call; silently handing a
    // review or a test to the generalist would hide that the specialist never saw it.
    const resolved = resolveAgentCouncilRoleId(candidate.role);
    if (!resolved) {
      throw new AgentToolError("INVALID_DELEGATION_INPUT",
        `Unknown role "${candidate.role.trim()}". Use one of: ${AGENT_COUNCIL_ROLE_IDS.join(", ")}. No child was started.`);
    }
    role = resolved;
  }
  let slotId: string | undefined;
  if (candidate.slotId !== undefined) {
    if (typeof candidate.slotId !== "string" || !candidate.slotId.trim() || candidate.slotId.length > 120) {
      throw new AgentToolError("INVALID_DELEGATION_INPUT", "Delegated slotId must be a non-empty string up to 120 characters");
    }
    slotId = candidate.slotId.trim();
  }
  let sessionId: string | undefined;
  const rawSessionId = candidate.sessionId ?? candidate.resumeRunId;
  if (rawSessionId !== undefined) {
    if (typeof rawSessionId !== "string" || !/^[A-Za-z0-9._:-]{8,180}$/.test(rawSessionId.trim())) {
      throw new AgentToolError("INVALID_DELEGATION_INPUT", "Delegated sessionId must be a valid run/session identifier");
    }
    sessionId = rawSessionId.trim();
  }
  let acceptanceCriteria: readonly string[] | undefined;
  if (candidate.acceptanceCriteria !== undefined) {
    if (!Array.isArray(candidate.acceptanceCriteria) || candidate.acceptanceCriteria.length > 12
      || !candidate.acceptanceCriteria.every(item => typeof item === "string" && item.trim().length > 0 && item.length <= 500)) {
      throw new AgentToolError("INVALID_DELEGATION_INPUT", "acceptanceCriteria must contain up to 12 strings (1 to 500 characters each)");
    }
    acceptanceCriteria = candidate.acceptanceCriteria.map(item => item.trim());
  }
  let tools: readonly string[] | undefined;
  if (candidate.tools !== undefined) {
    if (!Array.isArray(candidate.tools) || candidate.tools.length > 64 || !candidate.tools.every(validToolName)) {
      throw new AgentToolError("INVALID_DELEGATION_INPUT", "Delegated tools must contain up to 64 valid tool names");
    }
    tools = [...new Set(candidate.tools)];
  }
  let permissionMode: AgentPermissionMode | undefined;
  if (candidate.permissionMode !== undefined) {
    if (!permissions.includes(candidate.permissionMode as AgentPermissionMode)) {
      throw new AgentToolError("INVALID_DELEGATION_INPUT", "Delegated permission mode is invalid");
    }
    permissionMode = candidate.permissionMode as AgentPermissionMode;
  }
  let maxTurns: number | undefined;
  if (candidate.maxTurns !== undefined) {
    if (!Number.isSafeInteger(candidate.maxTurns) || (candidate.maxTurns as number) < 1
      || (candidate.maxTurns as number) > maximumTurns) {
      throw new AgentToolError("INVALID_DELEGATION_INPUT", `Delegated maxTurns must be between 1 and ${maximumTurns}`);
    }
    maxTurns = candidate.maxTurns as number;
  }
  let memoryIds: readonly string[] | undefined;
  if (candidate.memoryIds !== undefined) {
    if (!Array.isArray(candidate.memoryIds) || candidate.memoryIds.length > 16 || !candidate.memoryIds.every(validMemoryId)) {
      throw new AgentToolError("INVALID_DELEGATION_INPUT", "memoryIds must contain up to 16 valid memory identifiers");
    }
    memoryIds = [...new Set(candidate.memoryIds.map(value => value.trim()))];
  }
  const tokenBudget = delegatedTokenBudget(candidate);
  return {
    task: candidate.task.trim(),
    ...(role ? { role } : {}),
    ...(slotId ? { slotId } : {}),
    ...(sessionId ? { sessionId, resumeRunId: sessionId } : {}),
    ...(acceptanceCriteria?.length ? { acceptanceCriteria } : {}),
    ...(tools ? { tools } : {}),
    ...(permissionMode ? { permissionMode } : {}),
    ...(maxTurns ? { maxTurns } : {}),
    ...(tokenBudget?.maxInputTokens === undefined ? {} : { maxInputTokens: tokenBudget.maxInputTokens }),
    ...(tokenBudget?.maxOutputTokens === undefined ? {} : { maxOutputTokens: tokenBudget.maxOutputTokens }),
    ...(memoryIds === undefined ? {} : { memoryIds }),
  };
}

export class AgentDelegationRuntime {
  readonly descriptor: AgentToolDescriptor = {
    name: AGENT_DELEGATE_TOOL_NAME,
    description: "Delegate a bounded subtask to a child agent that calls the model independently and can use only authorized tools.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["task"],
      properties: {
        task: { type: "string", minLength: 1, maxLength: MAX_AGENT_PROMPT_CHARACTERS },
        role: {
          type: "string",
          enum: AGENT_COUNCIL_ROLE_IDS,
          description: "Optional specialist role when Council Mode is active; the child goes to the team member with that role.",
        },
        slotId: {
          type: "string",
          minLength: 1,
          maxLength: 120,
          description: "Optional explicit team slot identifier when Council Mode is active.",
        },
        sessionId: {
          type: "string",
          minLength: 8,
          maxLength: 180,
          description: "Optional previous child runId/sessionId to continue an existing subagent or Council specialist session with follow-up directions.",
        },
        resumeRunId: {
          type: "string",
          minLength: 8,
          maxLength: 180,
          description: "Alias for sessionId to continue a previous delegated child session.",
        },
        acceptanceCriteria: {
          type: "array",
          maxItems: 12,
          items: { type: "string", minLength: 1, maxLength: 500 },
          description: "Optional verifiable acceptance criteria for the delegated specialist task.",
        },
        tools: {
          type: "array",
          maxItems: 64,
          items: { type: "string" },
          description: "Optional narrower tool allowlist using registered tool names or their exact provider aliases. Omit to inherit the authorized tools; use [] only for a text-only child. Unknown names are rejected.",
        },
        permissionMode: {
          type: "string",
          enum: permissions,
          description: "Optional lower permission ceiling for this child task.",
        },
        maxTurns: { type: "integer", minimum: 1, maximum: 16 },
        maxInputTokens: { type: "integer", minimum: 1, maximum: 10_000_000 },
        maxOutputTokens: { type: "integer", minimum: 1, maximum: 10_000_000 },
        memoryIds: {
          type: "array",
          maxItems: 16,
          items: { type: "string", minLength: 1, maxLength: 240 },
          description: "Optional explicit ids from approved bounded task memory; never loads conversation history.",
        },
      },
    },
    requiredPermission: "read_only",
    source: "builtin",
  };

  readonly handler: ToolHandler;
  readonly #prepareWorkspace?: AgentDelegationRuntimeOptions["prepareWorkspace"];
  readonly #durable?: AgentDelegationRuntimeOptions["durable"];
  readonly #model: AgentModelClient;
  readonly #acceptOrderedOutput?: true;
  readonly #tools: AgentToolRegistry;
  readonly #maxPermissionMode: AgentPermissionMode;
  readonly #allowedToolNames: readonly string[];
  readonly #reasoningEffort?: AgentReasoningEffort;
  readonly #reasoningBudgetTokens?: number;
  readonly #reasoningEnabled?: boolean;
  readonly #reasoningExclude?: boolean;
  readonly #reasoningMode?: "adaptive" | "enabled" | "disabled";
  readonly #contextWindowTokens?: number;
  readonly #getContextLimits?: AgentRunnerOptions["getContextLimits"];
  readonly #enforceContextOutputLimit?: boolean;
  readonly #modelOutputTokenLimit?: number;
  readonly #initialOutputTokenLimit?: number;
  readonly #modelInputTokenLimit?: number;
  readonly #maxDepth: number;
  readonly #maxTurns: number;
  readonly #maxToolCalls: number;
  readonly #maxParallelToolCalls: number;
  readonly #modelTimeoutMs?: number;
  readonly #tokenBudget?: AgentTokenBudget;
  readonly #taskContext?: AgentTaskContext;
  readonly #onEvent?: (event: AgentDelegationEvent) => void | Promise<void>;
  readonly #onLifecycle?: (event: AgentDelegationLifecycle) => void | Promise<void>;
  readonly #persistCheckpoint?: AgentDelegationRuntimeOptions["persistCheckpoint"];
  readonly #checkpointPolicy: "best_effort" | "required";
  readonly #resolveSelectedMemory?: AgentDelegationRuntimeOptions["resolveSelectedMemory"];
  readonly #resolveChildExecution?: AgentDelegationRuntimeOptions["resolveChildExecution"];
  readonly #completedSessionCheckpoints = new Map<string, AgentRunCheckpoint>();
  #dispatchCount = 0;

  constructor(options: AgentDelegationRuntimeOptions) {
    if (!Array.isArray(options.allowedToolNames) || options.allowedToolNames.length > 8192
      || !options.allowedToolNames.every(validToolName)) {
      throw new AgentToolError("INVALID_DELEGATION_POLICY", "allowedToolNames must contain up to 8192 valid tool names");
    }
    this.#prepareWorkspace = options.prepareWorkspace;
    this.#durable = options.durable;
    this.#model = options.model;
    this.#acceptOrderedOutput = options.acceptOrderedOutput;
    this.#tools = options.tools;
    this.#maxPermissionMode = options.maxPermissionMode;
    this.#allowedToolNames = [...new Set(options.allowedToolNames)].filter(name => name !== AGENT_DELEGATE_TOOL_NAME);
    this.#reasoningEffort = options.reasoningEffort;
    this.#reasoningBudgetTokens = options.reasoningBudgetTokens;
    this.#reasoningEnabled = options.reasoningEnabled;
    this.#reasoningExclude = options.reasoningExclude;
    this.#reasoningMode = options.reasoningMode;
    this.#modelInputTokenLimit = options.modelInputTokenLimit;
    this.#contextWindowTokens = options.contextWindowTokens;
    this.#getContextLimits = options.getContextLimits;
    this.#enforceContextOutputLimit = options.enforceContextOutputLimit;
    this.#modelOutputTokenLimit = options.modelOutputTokenLimit;
    this.#initialOutputTokenLimit = options.initialOutputTokenLimit;
    this.#maxDepth = boundedOption(options.maxDepth, 1, 1, 4, "maxDepth");
    this.#maxTurns = boundedOption(options.maxTurns, 4, 1, 16, "maxTurns");
    this.#maxToolCalls = boundedOption(options.maxToolCalls, 8, 1, 64, "maxToolCalls");
    this.#maxParallelToolCalls = boundedOption(options.maxParallelToolCalls, 2, 1, 8, "maxParallelToolCalls");
    this.#modelTimeoutMs = options.modelTimeoutMs;
    if (options.tokenBudget !== undefined && !normalizeAgentTokenBudget(options.tokenBudget)) {
      throw new AgentToolError("INVALID_DELEGATION_POLICY", "tokenBudget limits must be positive bounded integers");
    }
    this.#tokenBudget = options.tokenBudget === undefined ? undefined : normalizeAgentTokenBudget(options.tokenBudget);
    this.#taskContext = options.taskContext;
    this.#onEvent = options.onEvent;
    this.#onLifecycle = options.onLifecycle;
    this.#persistCheckpoint = options.persistCheckpoint;
    this.#checkpointPolicy = options.checkpointPolicy ?? "best_effort";
    this.#resolveSelectedMemory = options.resolveSelectedMemory;
    this.#resolveChildExecution = options.resolveChildExecution;
    this.handler = async (input, context) => {
      const childStop = new AbortController();
      const forwardStop = (): void => childStop.abort(context.signal?.reason);
      context.signal?.addEventListener('abort', forwardStop, { once: true });
      if (context.signal?.aborted) forwardStop();
      try { return await this.#delegate(input, { ...context, signal: childStop.signal }); }
      finally {
        context.signal?.removeEventListener('abort', forwardStop);
        // End background processes started by this child without stopping its parent.
        childStop.abort('runtime_dispose');
      }
    };
  }

  register(): void {
    this.#tools.register(this.descriptor, this.handler);
  }

  async #delegate(input: unknown, context: Parameters<ToolHandler>[1]): Promise<ToolHandlerResult> {
    const supplied = parseInput(input, this.#maxTurns);
    // Arguments can refer to the names exposed on the wire too. Decode only
    // aliases from the full registry codec, before applying parent/child policy;
    // replacing underscores or building a narrowed codec could select a different
    // tool when a literal underscore name collides with a dotted name.
    const registered = this.#tools.descriptors("full_access");
    const codec = createToolNameCodec(registered);
    const aliases = new Map(registered.map(tool => [codec.encode(tool.name), tool.name]));
    const parsed = supplied.tools === undefined ? supplied : {
      ...supplied,
      tools: [...new Set(supplied.tools.map(name => this.#tools.descriptor(name) ? name : aliases.get(name) ?? name))],
    };
    const currentDepth = context.delegationDepth ?? 0;
    if (currentDepth >= this.#maxDepth) {
      throw new AgentToolError("DELEGATION_DEPTH_LIMIT", "The delegated task reached the recursion depth limit");
    }
    if (context.signal?.aborted) {
      throw new AgentToolError("CANCELLED", "The delegated task was cancelled");
    }

    const inheritedNames = context.allowedToolNames
      ? new Set(context.allowedToolNames.filter(name => name !== AGENT_DELEGATE_TOOL_NAME))
      : undefined;
    const requestedNames = parsed.tools ? new Set(parsed.tools) : undefined;
    // Silently intersecting an explicit unknown list used to spend a child model call with zero tools,
    // then report a completed task without a reviewable workspace.
    const unknownNames = parsed.tools?.filter(name => !this.#tools.descriptor(name)
      && name !== AGENT_USER_INPUT_TOOL_NAME) ?? [];
    if (unknownNames.length) {
      throw new AgentToolError("INVALID_DELEGATION_TOOLS",
        `Unknown child tools: ${unknownNames.join(", ")}. Use registered tool names or their exact provider aliases. No child was started.`);
    }
    const childNames = this.#allowedToolNames.filter(name =>
      !GLOBAL_CONVERSATION_MEMORY_TOOL_NAMES.has(name)
      && (!inheritedNames || inheritedNames.has(name)) && (!requestedNames || requestedNames.has(name)));
    // The question channel is a runtime capability rather than a registered
    // tool. Preserve it for a child only when the parent explicitly exposed
    // it and supplied a host-owned handler.
    if (context.requestUserInput && inheritedNames?.has(AGENT_USER_INPUT_TOOL_NAME)
      && (!requestedNames || requestedNames.has(AGENT_USER_INPUT_TOOL_NAME))) {
      childNames.push(AGENT_USER_INPUT_TOOL_NAME);
    }
    if (parsed.tools?.length && !childNames.length) {
      throw new AgentToolError("DELEGATION_TOOLS_UNAVAILABLE",
        "None of the requested child tools are allowed by the current task policy. No child was started.");
    }
    const childDepth = currentDepth + 1;
    if (childDepth < this.#maxDepth) childNames.push(AGENT_DELEGATE_TOOL_NAME);

    const parentTaskContext = context.taskContext ?? this.#taskContext;
    const rootRunId = context.rootRunId ?? parentTaskContext?.rootRunId ?? context.runId;
    const permissionMode = narrowAgentPermission(
      context.permissionMode ?? this.#maxPermissionMode,
      this.#maxPermissionMode,
      parsed.permissionMode ?? this.#maxPermissionMode,
    );
    // Auto-added recursive delegation must not make an explicitly requested
    // write-only selection look usable after a read-only permission downgrade.
    const requestedChildNames = requestedNames ? childNames.filter(name => requestedNames.has(name)) : childNames;
    if (parsed.tools?.length && !this.#tools.descriptors(permissionMode, requestedChildNames).length
      && !(context.requestUserInput && requestedChildNames.includes(AGENT_USER_INPUT_TOOL_NAME))) {
      throw new AgentToolError("DELEGATION_TOOLS_UNAVAILABLE",
        "None of the requested child tools are available within the child permission ceiling. No child was started.");
    }
    const remaining = context.remainingTokenBudget;
    // The parent's allowance gates every NEW child, durable or not. A child result that is already complete
    // (and paid for) is returned first even when no allowance remains: refusing it would strand a finished
    // child on crash recovery, where usage is often unverified.
    const exhaustedAllowance = Boolean(remaining
      && (!remaining.usageKnown || remaining.remainingInputTokens === 0 || remaining.remainingOutputTokens === 0));
    // Without a durable ledger or a council resolver no cached result can exist: refuse before any preparation.
    if (exhaustedAllowance && !this.#durable && !this.#resolveChildExecution) {
      throw new AgentToolError('TOKEN_BUDGET_EXHAUSTED', 'The parent task has no verified token allowance remaining');
    }
    const remainingBudget = remaining ? {
      ...(remaining.remainingInputTokens === undefined ? {} : { maxInputTokens: remaining.remainingInputTokens }),
      ...(remaining.remainingOutputTokens === undefined ? {} : { maxOutputTokens: remaining.remainingOutputTokens }),
    } : undefined;
    const childTokenBudget = narrowerTokenBudget(narrowerTokenBudget(this.#tokenBudget, delegatedTokenBudget(parsed)), remainingBudget);
    let childRunId = `child-${randomUUID()}`;
    const dispatchIndex = this.#dispatchCount++;
    const childEvents: AgentRunEvent[] = [];
    const selectedMemory = await this.#selectSelectedMemory(parsed.memoryIds, parentTaskContext, context);
    const sourceWorkspaceRoot = context.workspaceRoot ?? parentTaskContext?.workspaceRoot;
    const canWrite = this.#tools.descriptors(permissionMode, childNames)
      .some(tool => tool.name !== AGENT_DELEGATE_TOOL_NAME && tool.requiredPermission !== "read_only");
    const initialChildTaskContext = childAgentTaskContext(parentTaskContext, {
      workspaceRoot: sourceWorkspaceRoot,
      conversationId: parentTaskContext?.conversationId,
      goal: parsed.task,
      constraints: parentTaskContext?.constraints,
      relevantPaths: parentTaskContext?.relevantPaths,
      recentOperations: parentTaskContext?.recentOperations,
      recentOperationsCanonical: parentTaskContext?.recentOperationsCanonical,
      parentRunId: context.runId,
      rootRunId,
      depth: childDepth,
      permissionMode,
      allowedToolNames: childNames,
      modelId: parentTaskContext?.modelId,
      locale: parentTaskContext?.locale,
      ...(selectedMemory === undefined ? {} : { selectedMemory }),
    });
    const childRequest: AgentDelegationChildExecutionRequest = {
      childRunId, parentRunId: context.runId, rootRunId, depth: childDepth, dispatchIndex, input: parsed,
      taskContext: initialChildTaskContext, maxTurns: parsed.maxTurns ?? this.#maxTurns,
      ...(childTokenBudget ? { tokenBudget: childTokenBudget } : {}),
      ...(context.executionId ? { executionId: context.executionId } : {}), signal: context.signal,
    };
    if (this.#durable && !context.durableCall) throw new AgentToolError('DURABLE_ADMISSION_REQUIRED', 'A host-admitted original operation is required');
    const durableClaim = this.#durable ? await this.#durable.admit(childRequest, context) : undefined;
    let began = false, childStarted = false;
    let isolated: PreparedDelegatedWorkspace | undefined;
    try {
    if (durableClaim) childRunId = durableClaim.childRunId;
    let childExecution: AgentDelegationChildExecutionOverride | undefined = durableClaim
      ? { invocationKey: durableClaim.invocationKey, ...(durableClaim.cachedResult ? { cachedResult: durableClaim.cachedResult } : {}) }
      : this.#resolveChildExecution ? await this.#resolveChildExecution(childRequest) : undefined;
    if (this.#resolveChildExecution && !childExecution && (parsed.role || parsed.slotId)) {
      throw new AgentToolError('COUNCIL_ROUTE_UNAVAILABLE', 'No eligible specialist route is available. Continue this subtask yourself and report that no specialist participated.');
    }
    // A completed call already owns its workspace, lifecycle and usage receipt.
    // Resolve it before allocating another checkout or emitting a second child.
    if (childExecution?.cachedResult) {
      const cachedOutput = childExecution.cachedResult;
      if (cachedOutput.status !== 'completed' && (!durableClaim || cachedOutput.receipt.unknownSideEffect) || !childExecution.invocationKey
        || cachedOutput.invocationKey !== childExecution.invocationKey || !cachedOutput.runId
        || cachedOutput.workspaceReview && cachedOutput.workspaceReview.childRunId !== cachedOutput.runId) {
        throw new AgentToolError('INVALID_DELEGATION_CACHE', 'The completed child record does not match this invocation. No child was started.');
      }
      return {
        modelOutput: cachedOutput,
        usage: durableClaim ? (durableClaim.accounting?.().usage ?? cachedOutput.usage) : { inputTokens: 0, outputTokens: 0 },
        usageKnown: durableClaim ? (durableClaim.accounting?.().usageKnown ?? cachedOutput.usageKnown === true) : true,
        summary: {
          kind: 'agent.delegate',
          params: { status: cachedOutput.status, requiresMerge: cachedOutput.workspaceReview?.requiresMerge === true },
          title: 'Existing child task result',
          ...(cachedOutput.finalText ? { details: [cachedOutput.finalText.slice(0, 500)] } : {}),
        },
      };
    }
    if (exhaustedAllowance) throw new AgentToolError('TOKEN_BUDGET_EXHAUSTED', 'The parent task has no verified token allowance remaining');
    if (durableClaim) {
      if (context.signal?.aborted) throw new AgentToolError('CANCELLED', 'Delegation cancelled before admission');
      if (durableClaim.resumeCheckpoint && (durableClaim.resumeCheckpoint.runId !== childRunId
        || durableClaim.resumeCheckpoint.logicalParentOperationId !== context.durableCall?.operationId)) {
        throw new AgentToolError('INVALID_DELEGATION_CHECKPOINT', 'The continuation does not belong to this child operation');
      }
      await durableClaim.begin();
      began = true;
      childExecution = { ...(await durableClaim.resolveExecution()), invocationKey: durableClaim.invocationKey };
    }
    if ((parsed.role || parsed.slotId) && (this.#resolveChildExecution || durableClaim) && !childExecution?.model) {
      throw new AgentToolError('COUNCIL_ROUTE_UNAVAILABLE', 'The specialist model is unavailable. Continue this subtask yourself and report that no specialist participated.');
    }
    isolated = canWrite && this.#prepareWorkspace && sourceWorkspaceRoot
      ? await this.#prepareWorkspace({ childRunId, parentRunId: durableClaim?.resumeCheckpoint?.taskContext?.parentRunId ?? context.runId,
        workspaceRoot: sourceWorkspaceRoot, permissionMode, signal: context.signal,
        ...(durableClaim?.resumeCheckpoint ? { resume: true } : {}) })
      : undefined;
    const childTools = isolated?.tools ?? this.#tools;
    const effectiveChildNames = isolated
      ? childNames.filter(name => childTools.descriptor(name) || name === AGENT_USER_INPUT_TOOL_NAME)
      : childNames;
    const childTaskContext = durableClaim?.resumeCheckpoint?.taskContext ?? childAgentTaskContext(parentTaskContext, {
      ...initialChildTaskContext,
      workspaceRoot: isolated?.workspaceRoot ?? sourceWorkspaceRoot,
      allowedToolNames: effectiveChildNames,
      ...(childExecution?.modelId ? { modelId: childExecution.modelId } : {}),
    });
    const councilMetadata = {
      ...(childExecution?.role ?? parsed.role ? { role: childExecution?.role ?? parsed.role } : {}),
      ...(childExecution?.slotId ?? parsed.slotId ? { slotId: childExecution?.slotId ?? parsed.slotId } : {}),
      ...(childExecution?.modelId ? { modelId: childExecution.modelId } : {}),
      ...(childExecution?.modelLabel ? { modelLabel: childExecution.modelLabel } : {}),
      ...(childExecution?.routeSource ? { routeSource: childExecution.routeSource } : {}),
      ...(childExecution?.invocationKey ? { invocationKey: childExecution.invocationKey } : {}),
    };
    const notifyLifecycle = async (event: AgentDelegationLifecycle): Promise<void> => {
      try {
        await this.#onLifecycle?.(event);
      } catch {
        // Observability must never turn a successful child run into a failure.
      }
    };
    await notifyLifecycle({
      type: "started",
      parentRunId: context.runId,
      rootRunId,
      childRunId,
      depth: childDepth,
      task: parsed.task,
      taskContext: childTaskContext,
      ...councilMetadata,
    });
    const notifyEvent = async (event: AgentRunEvent): Promise<void> => {
      childEvents.push(event);
      try {
        await this.#onEvent?.({ parentRunId: context.runId, rootRunId, depth: childDepth, event });
      } catch {
        // A telemetry sink is best effort and must not interrupt the child.
      }
      await notifyLifecycle({
        type: "event",
        parentRunId: context.runId,
        rootRunId,
        childRunId,
        depth: childDepth,
        event,
      });
    };
    type PersistedBoundary = { readonly resumeCheckpointId?: string; readonly recoveryStatus?: AgentDelegationRecoveryStatus;
      readonly checkpointError?: { readonly code: string; readonly message: string } };
    let latestCheckpointId: string | undefined;
    let boundaryFailure: { readonly checkpoint: AgentRunCheckpoint; readonly persisted: PersistedBoundary } | undefined;
    const persistCheckpoint = async (
      checkpoint: AgentRunCheckpoint,
      status: AgentDelegationCheckpointMetadata["status"],
      stopReason?: AgentRunStopReason
    ): Promise<PersistedBoundary> => {
      if (!this.#persistCheckpoint) return this.#checkpointPolicy === "required"
        ? { recoveryStatus: "unavailable", checkpointError: { code: "CHILD_CHECKPOINT_REQUIRED", message: "Child checkpoint persistence is required" } } : {};
      try {
        const handle = await this.#persistCheckpoint(checkpoint, {
          parentRunId: childTaskContext.parentRunId ?? context.runId, rootRunId, childRunId, depth: childDepth, status,
          ...(stopReason ? { stopReason } : {}), taskContext: childTaskContext,
        });
        if (handle === undefined && this.#checkpointPolicy !== "required") return {};
        const normalizedHandle = safeCheckpointHandle(handle);
        if (!normalizedHandle) return { ...(latestCheckpointId ? { resumeCheckpointId: latestCheckpointId } : {}),
          recoveryStatus: "unavailable", checkpointError: { code: "INVALID_CHECKPOINT_HANDLE", message: "The checkpoint handle is not a safe opaque identifier" } };
        latestCheckpointId = normalizedHandle;
        return { resumeCheckpointId: normalizedHandle, recoveryStatus: "durable" };
      } catch (error) {
        // A failed host commit may already have renamed a record. Never infer
        // that executed work did not happen, or replace the last confirmed handle.
        return { ...(latestCheckpointId ? { resumeCheckpointId: latestCheckpointId } : {}),
          recoveryStatus: "unknown", checkpointError: safeError(error) };
      }
    };
    let result: AgentRunResult;
    let continuedSession = false;
    let workspaceReview: DelegatedWorkspaceReview | undefined;
    let workspaceReviewError: AgentDelegateOutput['workspaceReviewError'];
    try {
      const acceptanceBlock = parsed.acceptanceCriteria?.length
        ? `Acceptance criteria (verify all before completing):\n${parsed.acceptanceCriteria.map((item, idx) => `${idx + 1}. ${item}`).join("\n")}`
        : undefined;
      const specialistInstructions = [childExecution?.instructions?.trim(), acceptanceBlock, isolated?.snapshotWarning].filter(Boolean).join('\n\n');
      const childInstructions = specialistInstructions
        ? `${DEFAULT_AGENT_INSTRUCTIONS}\n\n${specialistInstructions}`.slice(0, 19_500) : undefined;
      const childOwnsContextLimits = typeof childExecution?.getContextLimits === "function";
      const childContextLimits = childExecution?.getContextLimits?.();
      const childUsesSpecialistModel = Boolean(childExecution?.model && childExecution.model !== this.#model) || childOwnsContextLimits;
      const previousSessionCheckpoint = parsed.sessionId && !durableClaim?.resumeCheckpoint
        ? this.#completedSessionCheckpoints.get(parsed.sessionId)
        : undefined;
      const continuedSessionCheckpoint = previousSessionCheckpoint
        ? {
            ...rebaseAgentRunCheckpoint(previousSessionCheckpoint, { runId: childRunId, direction: parsed.task }),
            taskContext: childTaskContext,
            toolPolicy: undefined,
          }
        : undefined;
      continuedSession = Boolean(continuedSessionCheckpoint);
      const effectiveCheckpoint = durableClaim?.resumeCheckpoint ?? continuedSessionCheckpoint;
      childStarted = true;
      result = await new AgentRunner({
        model: childExecution?.model ?? this.#model,
        ...(childInstructions ? { instructions: childInstructions } : {}),
        acceptOrderedOutput: this.#acceptOrderedOutput,
        tools: childTools,
        permissionMode,
        reasoningEffort: childExecution?.reasoningEffort ?? (childUsesSpecialistModel ? undefined : this.#reasoningEffort),
        reasoningBudgetTokens: childExecution?.reasoningBudgetTokens ?? (childUsesSpecialistModel ? undefined : this.#reasoningBudgetTokens),
        reasoningEnabled: childExecution?.reasoningEnabled ?? (childUsesSpecialistModel ? undefined : this.#reasoningEnabled),
        reasoningExclude: childExecution?.reasoningExclude ?? (childUsesSpecialistModel ? undefined : this.#reasoningExclude),
        reasoningMode: childExecution?.reasoningMode ?? (childUsesSpecialistModel ? undefined : this.#reasoningMode),
        modelInputTokenLimit: childOwnsContextLimits ? childContextLimits?.modelInputTokenLimit : this.#modelInputTokenLimit,
        contextWindowTokens: childOwnsContextLimits ? childContextLimits?.contextWindowTokens : this.#contextWindowTokens,
        getContextLimits: childOwnsContextLimits ? childExecution!.getContextLimits : this.#getContextLimits,
        enforceContextOutputLimit: this.#enforceContextOutputLimit,
        modelOutputTokenLimit: childOwnsContextLimits ? childContextLimits?.modelOutputTokenLimit : this.#modelOutputTokenLimit,
        initialOutputTokenLimit: childExecution?.initialOutputTokenLimit ?? (childOwnsContextLimits ? undefined : this.#initialOutputTokenLimit),
        maxTurns: parsed.maxTurns ?? this.#maxTurns,
        maxTotalTurns: parsed.maxTurns ?? this.#maxTurns,
        maxToolCalls: this.#maxToolCalls,
        maxParallelToolCalls: this.#maxParallelToolCalls,
        modelTimeoutMs: this.#modelTimeoutMs,
        ...(childTokenBudget ? { tokenBudget: childTokenBudget } : {}),
        allowedToolNames: effectiveChildNames,
        ...(!isolated && context.toolPolicy ? { toolPolicy: context.toolPolicy } : {}),
        taskContext: childTaskContext,
        ...(context.requestUserInput ? { requestUserInput: context.requestUserInput } : {}),
        ...(context.requestPermissionApproval ? { requestPermissionApproval: context.requestPermissionApproval } : {}),
         logicalParentOperationId: context.durableCall?.operationId,
         delegationContext: { rootRunId, depth: childDepth },
         onEvent: notifyEvent,
         captureCheckpoint: true,
         ...(durableClaim ? { onDurableCheckpoint: async (checkpoint: AgentRunCheckpoint) => {
           const persisted = await persistCheckpoint(checkpoint, 'running');
           if (persisted.recoveryStatus !== 'durable' || !persisted.resumeCheckpointId) throw new AgentToolError('DURABLE_CHILD_CHECKPOINT_REQUIRED', 'Child checkpoint did not receive durable ACK');
           return durableClaim.commitChildCheckpoint(checkpoint, persisted.resumeCheckpointId);
         } } : {}),
         ...(this.#checkpointPolicy === "required" ? { onCheckpoint: async (checkpoint: AgentRunCheckpoint) => {
           const persisted = await persistCheckpoint(checkpoint, "running");
           if (persisted.recoveryStatus !== "durable") {
             boundaryFailure = { checkpoint, persisted };
             throw new AgentToolError("CHILD_CHECKPOINT_PERSISTENCE_FAILED", "Child checkpoint could not be committed; no further request was sent");
           }
         } } : {}),
       }).run({ prompt: parsed.task, runId: childRunId, signal: context.signal, taskContext: childTaskContext,
         ...(effectiveCheckpoint ? { checkpoint: effectiveCheckpoint } : {}) });
    } catch (error) {
      // A boundary failure pauses after the work already accounted in that
      // checkpoint. It is not an unexecuted tool error and must retain usage.
      if (boundaryFailure) {
        const checkpoint = boundaryFailure.checkpoint;
        const finalMessage = { origin: "runtime" as const, stopReason: "checkpoint_persistence_failed" as const };
        result = { runId: childRunId, status: "paused", stopReason: finalMessage.stopReason,
          finalMessage, finalText: canonicalRuntimeFinal(finalMessage), events: childEvents,
          usage: checkpoint.usage, usageKnown: checkpoint.usageKnown,
          turns: Math.max(0, checkpoint.nextTurn - 1), toolCalls: checkpoint.toolCalls,
          ...(checkpoint.tokenBudget ? { tokenBudget: checkpoint.tokenBudget } : {}), checkpoint };
      } else {
        // Freeze failed/paused children too; their partial edits remain reviewable.
        if (isolated) await isolated.review().catch(() => isolated?.dispose().catch(() => undefined));
        const interrupted = error instanceof AgentRunInterruptedError;
        const observedEvents = interrupted ? error.events : childEvents;
        const partialProgress = extractPartialChildProgress(observedEvents);
        const baseError = safeError(error);
        const childError = partialProgress
          ? { code: baseError.code, message: `${baseError.message} (Partial progress: ${partialProgress})`.slice(0, 2_000) }
          : baseError;
        const persisted = interrupted
          ? await persistCheckpoint(error.checkpoint, "failed")
          : {};
        const baseReceipt = createAgentChildReceipt({
          status: "failed", events: observedEvents,
          checkpointAvailable: persisted.recoveryStatus === undefined ? interrupted : persisted.recoveryStatus === "durable",
          failure: childError,
          ...(interrupted && error.checkpoint.tokenBudget ? { budget: error.checkpoint.tokenBudget } : {}),
        });
        const failureReceipt = {
          ...baseReceipt,
          ...(partialProgress ? { summary: `${baseReceipt.summary} (Partial progress: ${partialProgress})`.slice(0, 800) } : {}),
          ...(persisted.recoveryStatus && persisted.recoveryStatus !== "durable" ? { retrySafe: false } : {}),
        };
        await notifyLifecycle({
          type: "failed",
          parentRunId: context.runId,
          rootRunId,
          childRunId,
          depth: childDepth,
          task: parsed.task,
          taskContext: childTaskContext,
          error: childError,
          receipt: failureReceipt,
          ...(interrupted ? { checkpoint: error.checkpoint } : {}),
          ...(persisted.resumeCheckpointId ? { resumeCheckpointId: persisted.resumeCheckpointId } : {}),
          ...(persisted.checkpointError ? { checkpointError: persisted.checkpointError } : {}),
          ...(persisted.recoveryStatus ? { recoveryStatus: persisted.recoveryStatus } : {}),
          ...(interrupted ? { usage: error.checkpoint.usage, usageKnown: error.checkpoint.usageKnown } : {}),
          ...councilMetadata,
        });
        // Return a structured failure through the normal tool channel so the
        // parent model receives the same bounded receipt that the desktop host
        // persists. The original exception is intentionally not exposed.
        throw new AgentToolError(childError.code, childError.message, {
          childReceipt: failureReceipt,
          ...(persisted.recoveryStatus ? { params: { recoveryStatus: persisted.recoveryStatus } } : {}),
          ...(interrupted ? { usage: error.checkpoint.usage, usageKnown: error.checkpoint.usageKnown } : {}),
        });
      }
    }

    if (isolated) {
      try { workspaceReview = await isolated.review(); }
      catch (error) { workspaceReviewError = safeError(error); }
    }
    if (context.signal?.aborted && !agentRunPauseRequested(context.signal)) {
      const finalMessage = { origin: 'runtime' as const, stopReason: 'cancel_requested' as const };
      result = { ...result, status: 'cancelled', stopReason: 'cancel_requested', finalMessage,
        finalText: canonicalRuntimeFinal(finalMessage) };
    }
    const persisted = boundaryFailure?.persisted ?? (result.checkpoint
      ? await persistCheckpoint(result.checkpoint, result.status, result.stopReason)
      : {});
    if (result.checkpoint) {
      const normalizedSessionCheckpoint: AgentRunCheckpoint = {
        ...result.checkpoint,
        version: result.checkpoint.messages.some(m => m.outputParts !== undefined) ? 2 : 1,
        pendingToolBatch: undefined,
        durableStop: undefined,
      };
      this.#completedSessionCheckpoints.set(childRunId, normalizedSessionCheckpoint);
      if (parsed.sessionId) {
        this.#completedSessionCheckpoints.set(parsed.sessionId, normalizedSessionCheckpoint);
      }
      // Each kept session is a whole child conversation: keep the newest few.
      while (this.#completedSessionCheckpoints.size > 16) {
        const oldestKey = this.#completedSessionCheckpoints.keys().next().value;
        if (!oldestKey) break;
        this.#completedSessionCheckpoints.delete(oldestKey);
      }
    }

    const output: AgentDelegateOutput = {
      runId: childRunId,
      ...(parsed.sessionId ? { sessionId: parsed.sessionId, sessionContinued: Boolean(continuedSession) } : {}),
      status: result.status,
      stopReason: result.stopReason,
      finalText: result.finalMessage ? canonicalRuntimeFinal(result.finalMessage) : result.finalText,
      ...(result.finalMessage ? { finalMessage: result.finalMessage } : {}),
      ...(workspaceReview ? { workspaceReview } : {}),
      ...(workspaceReviewError ? { workspaceReviewError } : {}),
      ...(result.outputParts === undefined ? {} : { outputParts: result.outputParts }),
      ...(result.citations?.length ? { citations: result.citations } : {}),
      receipt: createAgentChildReceipt({
        status: result.status,
        events: result.events,
        checkpointAvailable: persisted.recoveryStatus === undefined ? Boolean(result.checkpoint) : persisted.recoveryStatus === "durable",
        ...(result.tokenBudget ? { budget: result.tokenBudget } : {}),
      }),
      // Completion and local recoverability are independent. A caller must not
      // automatically replay even a completed result whose save was uncertain.
      ...(workspaceReviewError || persisted.recoveryStatus && persisted.recoveryStatus !== "durable" ? { receipt: {
        ...createAgentChildReceipt({ status: result.status, events: result.events,
          ...(result.tokenBudget ? { budget: result.tokenBudget } : {}) }), retrySafe: false,
      } } : {}),
      ...(persisted.recoveryStatus ? { recoveryStatus: persisted.recoveryStatus } : {}),
      ...(persisted.resumeCheckpointId ? { resumeCheckpointId: persisted.resumeCheckpointId } : {}),
      ...(persisted.checkpointError ? { checkpointError: persisted.checkpointError } : {}),
      depth: childDepth,
      usage: result.usage,
      ...(result.usageKnown === undefined ? {} : { usageKnown: result.usageKnown }),
      turns: result.turns,
      toolCalls: result.toolCalls,
      ...(result.tokenBudget ? { tokenBudget: result.tokenBudget } : {}),
      ...councilMetadata,
    };
    const completedLifecycle = {
      type: "completed" as const,
      parentRunId: context.runId,
      rootRunId,
      childRunId,
      depth: childDepth,
      task: parsed.task,
      result: output,
      taskContext: result.checkpoint?.taskContext ?? childTaskContext,
      ...(result.checkpoint ? { checkpoint: result.checkpoint } : {}),
      ...(persisted.resumeCheckpointId ? { resumeCheckpointId: persisted.resumeCheckpointId } : {}),
      ...(persisted.checkpointError ? { checkpointError: persisted.checkpointError } : {}),
      ...councilMetadata,
    };
    let unsettled = false;
    if (durableClaim) {
      let completeError: unknown;
      try { await durableClaim.complete(output); }
      catch (error) { completeError = error; }
      if (completeError) {
        if (output.status !== "completed") await notifyLifecycle(completedLifecycle);
        if (context.signal?.aborted) unsettled = true;
        else {
          if (completeError instanceof AgentToolError && completeError.code === "DURABLE_OPERATION_UNKNOWN") throw completeError;
          throw new AgentToolError('DURABLE_RESULT_COMMIT_FAILED', 'The original child result must be verified; it was not replayed');
        }
      }
    }
    if (!unsettled) await notifyLifecycle(completedLifecycle);
    return {
      modelOutput: output,
      ...(unsettled ? { unsettled: true as const } : {}),
      usage: durableClaim?.accounting?.().usage ?? result.usage,
      usageKnown: !unsettled && (durableClaim?.accounting?.().usageKnown ?? (result.usageKnown !== false && result.tokenBudget?.usageKnown !== false)),
      summary: {
        kind: "agent.delegate", params: { status: result.status, requiresMerge: workspaceReview?.requiresMerge === true },
        title: result.status === "completed" ? "Child task completed" : result.status === "cancelled" ? "Child task cancelled" : result.status === "paused" ? "Child task paused" : "Child task reached its limit",
        ...(!result.finalMessage && result.finalText ? { details: [result.finalText.slice(0, 500)] } : {}),
      },
    };
    } catch (error) {
      if (began && !childStarted) await durableClaim?.abortBeforeStart?.(safeError(error));
      throw error;
    } finally {
      try { await isolated?.dispose().catch(() => undefined); } finally { await durableClaim?.release?.(); }
    }
  }

  async #selectSelectedMemory(
    memoryIds: readonly string[] | undefined,
    parentTaskContext: AgentTaskContext | undefined,
    context: Parameters<ToolHandler>[1],
  ): Promise<readonly AgentContextMemoryItem[] | undefined> {
    if (memoryIds === undefined) return undefined;
    if (this.#resolveSelectedMemory) {
      let resolved: readonly AgentContextMemoryItem[];
      try {
        resolved = await this.#resolveSelectedMemory(memoryIds, {
          runId: context.runId,
          ...(context.workspaceRoot ? { workspaceRoot: context.workspaceRoot } : {}),
          ...(parentTaskContext ? { taskContext: parentTaskContext } : {}),
        });
      } catch {
        throw new AgentToolError("MEMORY_REFERENCE_UNAVAILABLE", "Selected child memory is unavailable");
      }
      if (!Array.isArray(resolved)) throw new AgentToolError("MEMORY_REFERENCE_UNAVAILABLE", "Selected child memory is unavailable");
      const byId = new Map(resolved.map(item => [item?.id, item]));
      const selected = memoryIds.map(id => byId.get(id)).filter((item): item is AgentContextMemoryItem => Boolean(item));
      if (selected.length !== memoryIds.length) {
        throw new AgentToolError("MEMORY_REFERENCE_UNAVAILABLE", "One or more selected child memory references are unavailable");
      }
      return selected;
    }
    const available = parentTaskContext?.selectedMemory || [];
    const byId = new Map(available.map(item => [item.id, item]));
    const selected = memoryIds.map(id => byId.get(id)).filter((item): item is AgentContextMemoryItem => Boolean(item));
    if (selected.length !== memoryIds.length) {
      throw new AgentToolError("MEMORY_REFERENCE_UNAVAILABLE", "One or more selected child memory references are unavailable");
    }
    return selected;
  }
}

export function createAgentDelegateTool(options: AgentDelegationRuntimeOptions): {
  readonly descriptor: AgentToolDescriptor;
  readonly handler: ToolHandler;
  readonly runtime: AgentDelegationRuntime;
} {
  const runtime = new AgentDelegationRuntime(options);
  return { descriptor: runtime.descriptor, handler: runtime.handler, runtime };
}
