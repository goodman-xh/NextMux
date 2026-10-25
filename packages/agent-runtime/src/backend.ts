import type {
  AgentBackend,
  AgentBackendRunRequest,
} from "./types.js";
import { AgentRunner, type AgentRunnerOptions } from "./runner.js";

export const BUILTIN_AGENT_BACKEND_ID = "builtin";

/**
 * Adapter for the original NextMux loop. Keeping it behind the same interface
 * as ACP runtimes lets the host replace the loop without rewriting the UI,
 * permissions, billing, or conversation storage.
 */
export class BuiltinAgentBackend implements AgentBackend {
  readonly id = BUILTIN_AGENT_BACKEND_ID;
  readonly capabilities = {
    streaming: true,
    cancellation: true,
    sessionResume: true,
    permissions: true,
    filesystem: true,
    terminal: true,
    mcp: true,
    // AgentRunner enforces the cumulative budget before and after every
    // provider request, so the builtin backend can safely accept bounded runs.
    tokenBudget: true,
    contextWindow: true,
    toolPolicy: true,
    orderedOutput: true,
  } as const;

  readonly #options: Omit<
    AgentRunnerOptions,
    "permissionMode" | "reasoningEffort" | "reasoningBudgetTokens" | "reasoningEnabled" | "reasoningExclude" | "reasoningMode" | "onEvent" | "onCheckpoint" | "onDurableCheckpoint" | "takeSteeringMessages" | "requestUserInput" | "requestPermissionApproval" | "acceptOrderedOutput"
  >;

  constructor(options: Omit<
    AgentRunnerOptions,
    "permissionMode" | "reasoningEffort" | "reasoningBudgetTokens" | "reasoningEnabled" | "reasoningExclude" | "reasoningMode" | "onEvent" | "onCheckpoint" | "onDurableCheckpoint" | "takeSteeringMessages" | "requestUserInput" | "requestPermissionApproval" | "acceptOrderedOutput"
  >) {
    this.#options = options;
  }

  run(request: AgentBackendRunRequest) {
    return new AgentRunner({
      ...this.#options,
      permissionMode: request.permissionMode,
      acceptOrderedOutput: request.acceptOrderedOutput,
      reasoningEffort: request.reasoningEffort,
      reasoningBudgetTokens: request.reasoningBudgetTokens,
      reasoningEnabled: request.reasoningEnabled,
      reasoningExclude: request.reasoningExclude,
      reasoningMode: request.reasoningMode,
      modelInputTokenLimit: request.modelInputTokenLimit ?? this.#options.modelInputTokenLimit,
      tokenBudget: request.tokenBudget,
      contextWindowTokens: request.contextWindowTokens ?? this.#options.contextWindowTokens,
      modelOutputTokenLimit: request.modelOutputTokenLimit ?? this.#options.modelOutputTokenLimit,
      enforceContextOutputLimit: request.enforceContextOutputLimit ?? this.#options.enforceContextOutputLimit,
      allowedToolNames: request.allowedToolNames,
      captureCheckpoint: request.captureCheckpoint,
      onEvent: request.onEvent,
      onCheckpoint: request.onCheckpoint,
      onDurableCheckpoint: request.onDurableCheckpoint,
      takeSteeringMessages: request.takeSteeringMessages,
      requestUserInput: request.requestUserInput,
      requestPermissionApproval: request.requestPermissionApproval,
      conversationWakeups: request.conversationWakeups,
    }).run({
      prompt: request.prompt,
      attachments: request.attachments,
      history: request.history,
      checkpoint: request.checkpoint,
      runId: request.runId,
      signal: request.signal,
      taskContext: request.taskContext,
      ...(request.pinnedToolNames ? { pinnedToolNames: request.pinnedToolNames } : {}),
    });
  }
}
