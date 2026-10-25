import type { AgentDurableCallBinding, AgentDurableCheckpointWriter, AgentPendingToolBatch } from './durable.js';
import type { ModelErrorDiagnostic } from "./model-error-signals.js";
import type { CapacityWaitReason } from './capacity-reasons.js';

export type AgentPermissionMode = "read_only" | "workspace_write" | "full_access";

/** Host-verified directory scope; a model may select its ID, never add a root. */
export interface AgentWorkspaceBinding {
  readonly id: string;
  readonly path: string;
  readonly permissionMode: AgentPermissionMode;
}
export type AgentReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type ToolSource = "builtin" | "comic" | "skill" | "mcp" | "acp";
export type AgentRunStatus = "completed" | "limit_reached" | "cancelled" | "paused";
export type AgentRunStopReason =
  | "completed"
  | "cancel_requested"
  | "pause_requested"
  | "checkpoint_persistence_failed"
  | "user_input_cancelled"
  | "user_input_expired"
  | "media_context_compaction_required"
  | "context_window_exceeded"
  | "turn_limit_reached"
  | "tool_call_limit_reached"
  | "repeated_tool_calls"
  | "input_token_limit_reached"
  | "output_token_limit_reached"
  | "output_truncated"
  | "token_usage_unknown";
export type AgentToolCompletionStatus = "succeeded" | "failed" | "cancelled" | "timed_out";

/**
 * Optional per-run token ceilings.  These are deliberately provider-neutral:
 * the runner enforces the cumulative boundary while adapters receive only the
 * output ceiling for the current request.
 */
export interface AgentTokenBudget {
  readonly maxInputTokens?: number;
  readonly maxOutputTokens?: number;
}

/** Bounded, persisted accounting state for an AgentTokenBudget. */
export interface AgentTokenBudgetSnapshot extends AgentTokenBudget {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** False means the provider did not return verifiable usage for a request. */
  readonly usageKnown: boolean;
  readonly remainingInputTokens?: number;
  readonly remainingOutputTokens?: number;
}

/** Provider-neutral token usage for one run or compound operation. */
export interface AgentUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** Token usage with an explicit indication that the provider numbers are verifiable. */
export interface AgentUsageSnapshot extends AgentUsage {
  readonly usageKnown: boolean;
}

/**
 * Stable, parent-readable outcome for a delegated child run.  This is
 * deliberately separate from AgentRunStatus: the latter describes the
 * runtime loop, while this value tells the parent whether it is safe to act
 * on the child's result or ask it to continue.
 */
export type AgentChildOutcome = "completed" | "partial" | "cancelled" | "failed" | "unknown";

/**
 * Compact receipt retained by the parent even when a child panel is closed.
 * `retrySafe` means a continuation/retry from the preserved checkpoint is
 * safe; it never means that replaying an arbitrary side effect from scratch
 * is safe.  Unknown side effects are always fail-closed.
 */
export interface AgentChildReceipt {
  readonly outcome: AgentChildOutcome;
  readonly retrySafe: boolean;
  readonly unknownSideEffect: boolean;
  readonly summary: string;
  readonly tokenBudget?: AgentTokenBudgetSnapshot;
  readonly failure?: {
    readonly code: string;
    readonly message: string;
  };
}

/**
 * A deliberately selected, bounded piece of context for a child run.
 *
 * This is not a transcript entry.  `text` is an explicitly approved excerpt
 * and `ref` is an application-owned opaque/reference value; either may be
 * present, but the runtime never fills these fields from the parent's history
 * implicitly.
 */
export type AgentContextMemoryKind = "summary" | "file_ref" | "checkpoint_ref" | "message_ref";

export interface AgentContextMemoryItem {
  readonly id: string;
  readonly kind: AgentContextMemoryKind;
  readonly text?: string;
  readonly ref?: string;
  readonly sourceRunId?: string;
  /** Maximum number of characters of `text` the child may receive. */
  readonly maxCharacters: number;
}

export interface ToolFileResource {
  readonly kind: "file";
  readonly path: string;
  readonly action: "read" | "created" | "updated";
  readonly startLine?: number;
  readonly endLine?: number;
}

/** A safe, explicit browser target emitted by a browser/site/preview tool. */
export interface ToolBrowserResource {
  readonly kind: "browser";
  readonly url: string;
  readonly title?: string;
}

export interface AgentToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly requiredPermission: AgentPermissionMode;
  readonly source: ToolSource;
  /** Optional owner assigned by the in-process AgentPluginHost. */
  readonly pluginId?: string;
  readonly concurrencySafe?: boolean;
  /** Explicitly classify custom/MCP tools; omitted values use conservative runtime defaults. */
  readonly executionKind?: "read" | "side_effect";
}

export interface AgentToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: unknown;
}

/** Host-observed media properties for admission estimates; never transport bytes. */
export interface AgentMediaMetadata {
  readonly width?: number;
  readonly height?: number;
  readonly durationSeconds?: number;
  readonly pageCount?: number;
}

export type AgentMessageAttachment =
  | {
      readonly kind: "text";
      readonly name: string;
      readonly content: string;
      /** Exact token in the owning user message for caret-positioned text. */
      readonly inlineReference?: string;
    }
  | {
      readonly kind: "image";
      readonly name: string;
      readonly mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
      readonly dataBase64: string;
      readonly media?: AgentMediaMetadata;
    }
  | {
      readonly kind: "file";
      readonly name: string;
      readonly mimeType: string;
      readonly dataBase64: string;
      readonly media?: AgentMediaMetadata;
    };

/** Stable host messages keep localization at the display edge. Values may contain user-owned paths/text. */
export type AgentMessageParams = Readonly<Record<string, string | number | boolean | undefined>>;

export interface AgentRuntimeFinalMessage {
  readonly origin: "runtime";
  readonly stopReason: AgentRunStopReason | "empty_response";
  readonly params?: AgentMessageParams;
}

export interface ToolExecutionSummary {
  readonly title: string;
  readonly kind?: string;
  readonly params?: AgentMessageParams;
  /** Exact bounded argv presentation for process tools; never parsed from localized titles. */
  readonly commandLine?: string;
  readonly details?: readonly string[];
  /** The tool transport may succeed while the operation it ran fails (for example, a process exits non-zero). */
  readonly outcome?: "succeeded" | "failed";
  /** Structured lifecycle reason for a process that was intentionally stopped. */
  readonly terminationReason?: ToolProcessTerminationReason;
  readonly checkpointId?: string;
  readonly checkpointIds?: readonly string[];
  readonly changedPaths?: readonly string[];
  /**
   * Short human-readable object of the operation, such as the accessible name
   * of a clicked element, a pressed key or a selected option. Display only:
   * never parsed, never a secret value (typed text is not recorded).
   */
  readonly target?: string;
  /** Structured UI target. Consumers must not infer targets by parsing localized title text. */
  readonly resource?: ToolFileResource | ToolBrowserResource;
}

export interface ToolHandlerResult {
  /** Host persistence or handler termination is still unconfirmed. */
  readonly unsettled?: true;
  /** Full bounded result sent back to the model, but not copied into UI events. */
  readonly modelOutput: unknown;
  /** Bounded media observed by a tool; kept separate from JSON text and UI summaries. */
  readonly attachments?: readonly AgentMessageAttachment[];
  /** Sanitized, compact result safe to display in the desktop activity trace. */
  readonly summary: ToolExecutionSummary;
  /** Host-only control metadata. Ordinary registrations cannot activate it. */
  readonly skillPolicy?: AgentSkillPolicy;
  /** Model usage consumed inside a compound tool, such as a delegated child agent. */
  readonly usageKnown?: boolean;
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
}

export interface ToolExecutionResult {
  readonly ok: boolean;
  /** Cancellation settled the caller before the handler acknowledged termination. */
  readonly unsettled?: true;
  readonly output?: unknown;
  readonly attachments?: readonly AgentMessageAttachment[];
  readonly summary: ToolExecutionSummary;
  readonly skillPolicy?: AgentSkillPolicy;
  /** False when a compound tool could not verify all model usage. */
  readonly usageKnown?: boolean;
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly params?: AgentMessageParams;
    /** Optional bounded diagnostic returned by a compound tool. */
    readonly childReceipt?: AgentChildReceipt;
  };
  readonly ledger?: {
    readonly fingerprint: string;
    readonly state: ToolExecutionLedgerState;
    readonly replayed: boolean;
  };
}

export interface ToolExecutionOutput {
  readonly processId?: string;
  readonly stream: "stdout" | "stderr" | "pty";
  /** A bounded incremental chunk for terminal presentation. */
  readonly text: string;
}

export type ToolProcessTerminationReason = "requested" | "cancelled" | "timeout" | "runtime_dispose";

export type ToolExecutionLedgerState = "prepared" | "running" | "committed" | "failed" | "unknown";

/**
 * Compact operational memory shared with a delegated child run.
 *
 * This is deliberately not a conversation transcript.  It carries the
 * project/task boundary and a small bounded operation summary so a child can
 * start productively without duplicating the parent's user-facing history or
 * spending a turn rediscovering the workspace.
 */
export interface AgentTaskContext {
  readonly version: 1;
  readonly workspaceRoot: string;
  readonly conversationId?: string;
  /** The NextMux workbench that owns the run (for example coding or comic); delegated children inherit it. */
  readonly workbench?: string;
  readonly goal: string;
  /** The parent/root objective retained when a child narrows the immediate goal. */
  readonly parentGoal?: string;
  readonly constraints: readonly string[];
  readonly relevantPaths: readonly string[];
  readonly recentOperations: readonly string[];
  /** Legacy operation strings may be localized UI titles and are not model instructions. */
  readonly recentOperationsCanonical?: true;
  readonly parentRunId?: string;
  readonly rootRunId?: string;
  readonly depth: number;
  readonly permissionMode: AgentPermissionMode;
  readonly allowedToolNames: readonly string[];
  readonly modelId?: string;
  readonly locale?: string;
  /** Explicitly selected bounded memory; never an implicit parent transcript. */
  readonly selectedMemory: readonly AgentContextMemoryItem[];
}

export interface ToolExecutionContext {
  /** Backend/runtime-owned admitted identity; never parsed from model arguments. */
  readonly durableCall?: AgentDurableCallBinding;
  readonly runId: string;
  /** Host-owned remaining parent allowance at dispatch, including zero/exhaustion. */
  readonly remainingTokenBudget?: AgentTokenBudgetSnapshot;
  /** Logical task scope retained across provider retries, checkpoint recovery and continuation. */
  readonly executionScopeId?: string;
  /** Host-owned model batch identity. A new batch may intentionally repeat an earlier command. */
  readonly executionId?: string;
  /** First batch after recovery conservatively reuses committed semantic effects across batches. */
  readonly replayPreviousEffects?: boolean;
  /**
   * Later batches of a recovered run: tool calls whose results the restored conversation already contains. A committed
   * effect outside this set was never seen by the model, so its first repeat returns that result instead of running
   * again (audit B01-02); after that, an identical call runs normally.
   */
  readonly recoveredSeenCallIds?: ReadonlySet<string>;
  readonly signal?: AbortSignal;
  readonly permissionMode?: AgentPermissionMode;
  readonly rootRunId?: string;
  readonly delegationDepth?: number;
  readonly allowedToolNames?: readonly string[];
  readonly toolPolicy?: AgentToolPolicySnapshot;
  /** Compact project/task memory for tools and delegated children. */
  readonly taskContext?: AgentTaskContext;
  /** Absolute workspace root used by the active tool runtime. */
  readonly workspaceRoot?: string;
  /**
   * Host-owned clarification channel available to delegated children.  A
   * child may ask a question through its parent's broker; the host keeps the
   * question outside ordinary tool messages and decides how to render it.
   */
  readonly requestUserInput?: AgentUserInputHandler;
  /** Host-only scoped authorization; never filled from model question arguments. */
  readonly requestPermissionApproval?: AgentPermissionApprovalHandler;
  /** Best-effort side channel; it never replaces the final tool result returned to the model. */
  readonly onOutput?: (output: ToolExecutionOutput) => void | Promise<void>;
  readonly onProcessStarted?: (process: { readonly processId: string; readonly commandLine: string; readonly interactive: boolean }) => void | Promise<void>;
  readonly onProcessExited?: (process: { readonly processId: string; readonly exitCode: number | null; readonly signal: NodeJS.Signals | null; readonly failure?: string; readonly terminationReason?: ToolProcessTerminationReason }) => void | Promise<void>;
}

export type ToolHandler = (
  input: unknown,
  context: ToolExecutionContext,
) => Promise<ToolHandlerResult>;

export interface AgentModelMessage {
  readonly role: "user" | "assistant" | "tool";
  readonly content: string;
  /** Original host timestamps; preserved verbatim through recovery and compaction. */
  readonly at?: string;
  readonly createdAt?: string;
  /** Visible assistant output references; ownership is checked by the host, never inferred from hashes. */
  readonly outputParts?: readonly AgentOutputPart[];
  readonly toolCallId?: string;
  readonly toolCalls?: readonly AgentToolCall[];
  readonly attachments?: readonly AgentMessageAttachment[];
  /**
   * Bounded, provider-specific assistant state needed to continue a tool-use
   * turn (for example Gemini thought signatures). It never appears in UI
   * events and adapters must validate it before reuse.
   */
  readonly providerState?: unknown;
}

/**
 * Provider-neutral transport telemetry forwarded to the agent loop.
 *
 * This is intentionally broader than any one vendor protocol.  Adapters may
 * add fields while the runner only consumes the small, safe lifecycle subset
 * (`response.*`, `reasoning.*`, `content.*`, and `tool_call.*`).  Raw response
 * bodies, credentials, and hidden reasoning text must never be placed here.
 */
export interface AgentModelProviderEvent {
  readonly type: string;
  /** `capacity.waiting`: authenticated platform admission reasons only. */
  readonly capacityReasons?: readonly CapacityWaitReason[];
  readonly attemptId?: string;
  readonly itemId?: string;
  readonly callId?: string;
  readonly name?: string;
  readonly delta?: string;
  readonly content?: string;
  readonly visibility?: "visible" | "hidden";
  readonly status?: "streaming" | "complete";
  readonly model?: string;
  readonly finishReason?: string;
  readonly citations?: readonly ModelCitation[];
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
  readonly toolCall?: AgentToolCall;
  readonly error?: unknown;
  /** `route.switched`: the display name of the route now serving the request, and a short reason class. */
  readonly route?: string;
  readonly reason?: string;
}

export interface AgentModelRequest {
  readonly instructions?: string;
  readonly messages: readonly AgentModelMessage[];
  readonly tools: readonly AgentToolDescriptor[];
  readonly reasoningEffort?: AgentReasoningEffort;
  readonly reasoningBudgetTokens?: number;
  readonly reasoningEnabled?: boolean;
  readonly reasoningMode?: "adaptive" | "enabled" | "disabled";
  readonly reasoningExclude?: boolean;
  /** Maximum output tokens for this single provider request, when bounded. */
  readonly maxOutputTokens?: number;
  readonly signal?: AbortSignal;
  /**
   * Receives visible assistant text as the provider streams it. Implementations
   * must preserve ordering and must not use this callback for hidden reasoning.
   */
  readonly onTextDelta?: (delta: string) => void | Promise<void>;
  /**
   * Receives safe provider lifecycle events.  This is separate from visible
   * assistant text so the host can show real phases without treating hidden
   * chain-of-thought as user-visible content.
   */
  readonly onProviderEvent?: (event: AgentModelProviderEvent) => void | Promise<void>;
}

/** Visible, untrusted source metadata. A citation never grants tool or instruction authority. */
export interface ModelCitation {
  readonly url: string;
  readonly title?: string;
}

/** Inert, bounded display/replay metadata. A digest is not a read capability or a model instruction. */
export interface AgentOutputAsset {
  readonly sha256: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

export type AgentOutputPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image" | "audio"; readonly asset: AgentOutputAsset };

export interface AgentModelTurn {
  /** Provider-selected model identifier for lifecycle telemetry. */
  readonly model?: string;
  /** Provider verdict; `length` is a partial response that requires continuation. */
  readonly finishReason?: string;
  readonly content?: string;
  readonly outputParts?: readonly AgentOutputPart[];
  readonly citations?: readonly ModelCitation[];
  readonly toolCalls?: readonly AgentToolCall[];
  readonly providerState?: unknown;
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
  /** Adapters set false when the provider omitted or malformed usage fields. */
  readonly usageKnown?: boolean;
}

export interface AgentModelClient {
  /** Same provider-aware admission estimate used by the selected transport. */
  estimateInputTokens?(request: Pick<AgentModelRequest, "instructions" | "messages" | "tools">): number;
  complete(request: AgentModelRequest): Promise<AgentModelTurn>;
}

export type AgentModelFailureStage =
  | "validation"
  | "request"
  | "connection"
  | "response"
  | "stream"
  | "decode"
  | "cancelled"
  | "unknown";

export type AgentModelFailureCategory =
  | "authentication"
  | "rate_limit"
  | "timeout"
  | "network"
  | "upstream"
  | "invalid_request"
  | "invalid_response"
  | "cancelled"
  | "unknown";

/** Presentation evidence from model-runtime; deliberately independent of retry policy. */
export interface AgentReadableModelError {
  /** Platform admission display only; never funding or retry policy. */
  readonly walletAdmission?: {
    readonly currency: string;
    readonly requiredMicros: number;
    readonly availableRequestBudgetMicros: number;
    readonly outstandingRiskMicros: number;
    readonly reason: "outstanding_usage" | "reserved_funds" | "request_ceiling";
  };
  readonly kind: string;
  readonly detail: string;
  readonly httpStatus?: number;
  readonly code?: string;
  readonly parameter?: string;
  readonly retryAfterSeconds?: number;
  readonly providerReason?: string;
  readonly causeKind?: "provider_quota_exhausted";
  readonly source?: "own_api" | "relay" | "local";
  readonly retryCount?: number;
  readonly relaySwitchCount?: number;
}

export interface AgentModelFailure {
  readonly code: string;
  readonly stage: AgentModelFailureStage;
  readonly category: AgentModelFailureCategory;
  readonly reason: string;
  readonly retryable: boolean;
  readonly retrySafe: boolean;
  readonly httpStatus?: number;
  /** Server-advised delay before a safe retry, bounded by the host. */
  readonly retryAfterMs?: number;
  readonly requestId?: string;
  readonly providerAttemptId?: string;
  readonly providerCode?: string;
  readonly networkCode?: string;
  readonly diagnostic?: ModelErrorDiagnostic;
  readonly readableError?: AgentReadableModelError;
}

export interface AgentSteeringMessage {
  readonly id: string;
  readonly content: string;
  readonly createdAt: string;
  /** Omitted means additive direction. A goal update replaces the active goal. */
  readonly kind?: "direction" | "goal_update";
}

export interface AgentUserQuestionRequest {
  readonly prompt: string;
  readonly options?: readonly { readonly id: string; readonly label: string; readonly description?: string }[];
}

export interface AgentPermissionApprovalRequest {
  readonly toolName: string;
  readonly scope: "external_file" | "unsandboxed_command" | "process_input";
  readonly target: string;
  readonly detail?: string;
  /**
   * A compound command line whose parts would write outside the workspace
   * (audit OpenCode #12). The dialog shows these paths; the run itself is not
   * authorized by them.
   */
  readonly outOfWorkspaceWrite?: boolean;
  readonly outOfWorkspacePaths?: readonly string[];
  /** The command line carries compound shell operators this runtime never interprets. */
  readonly compoundCommand?: boolean;
  /** Hosts may auto-ignore this request after this many milliseconds. */
  readonly autoIgnoreAfterMs?: number;
}
export type AgentPermissionApprovalHandler = (request: AgentPermissionApprovalRequest, signal?: AbortSignal) => Promise<boolean>;

export interface AgentUserQuestion extends AgentUserQuestionRequest {
  /** Only the host permission broker can create this discriminator. */
  readonly kind?: "permission";
  readonly approval?: AgentPermissionApprovalRequest;
  readonly questionId: string;
  readonly runId: string;
  readonly taskId: string;
  readonly options: NonNullable<AgentUserQuestionRequest["options"]>;
  readonly allowFreeText: boolean;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface AgentUserAnswer {
  readonly questionId: string;
  readonly runId: string;
  readonly taskId: string;
  readonly optionId?: string;
  readonly text?: string;
  readonly cancelled?: true;
}

export type AgentUserQuestionAnswer = AgentUserAnswer;

export interface AgentUserInputResult {
  readonly status: "answered" | "cancelled" | "expired";
  readonly answer?: { readonly optionId?: string; readonly optionLabel?: string; readonly text?: string };
}

export type AgentUserInputHandler = (question: AgentUserQuestionRequest, signal?: AbortSignal) => Promise<AgentUserInputResult>;

export type AgentTaskPlanStepStatus = "pending" | "in_progress" | "completed";

/** A model-authored, bounded high-level task step. Execution activity is intentionally separate. */
export interface AgentTaskPlanStep {
  readonly id: string;
  readonly title: string;
  readonly status: AgentTaskPlanStepStatus;
}

/** @deprecated Accepted only while migrating checkpoints written by retired runtime-plan builds. */
export type LegacyRuntimeTaskPlanCheckpointSource = "runtime";

export type AgentTaskPlanCheckpointSource = "model" | LegacyRuntimeTaskPlanCheckpointSource;

/** Public prices frozen by the gateway for one actual request. Never provider credentials. */
export interface ManagedPriceUpdate {
  readonly id: string;
  readonly requestId: string;
  readonly at: number;
  readonly previousQuoteId?: string;
  readonly effectiveQuoteId: string;
  readonly offeringId: string;
  readonly model: string;
  readonly currency: string;
  readonly usageMultiplierBps: number | null;
  /** When supplied by the gateway, the multiplier of the previously active quote. */
  readonly previousUsageMultiplierBps?: number;
  readonly rates: readonly { readonly metric: string; readonly unitSize: number; readonly customerAmountMicros: number }[];
}

export type AgentRunEvent =
  | {
      readonly type: 'model_price_changed';
      readonly runId: string;
      readonly sessionId?: string;
      readonly pricingUpdate: ManagedPriceUpdate;
      readonly at: string;
    }
  | { readonly type: "user_input_requested"; readonly question: AgentUserQuestion; readonly at: string }
  | { readonly type: "user_input_resolved"; readonly questionId: string; readonly runId: string; readonly taskId: string; readonly status: AgentUserInputResult["status"]; readonly answer?: AgentUserInputResult["answer"]; readonly at: string }
  | {
      readonly type: "backend_selected";
      readonly backendId: string;
      readonly attempt: number;
      readonly at: string;
    }
  | {
      readonly type: "backend_fallback";
      readonly fromBackendId: string;
      readonly toBackendId: string;
      readonly reason: string;
      readonly at: string;
    }
  | {
      /** A managed gateway moved the request to another route before any output (same request, no side effects). */
      readonly type: "model_route_switched";
      readonly turn: number;
      /** Display name of the new route; empty when the host does not know it. */
      readonly route: string;
      readonly reason: "busy" | "timeout" | "unavailable" | "failed";
      readonly at: string;
    }
  | {
      readonly type: "model_started";
      readonly turn: number;
      /**
       * This request continues a reply cut off by the output limit, or one whose stream dropped mid-way: its text
       * joins the previous text of the same reply, so displays keep one unbroken answer instead of a new segment.
       */
      readonly continuation?: "output_limit" | "stream_resume";
      readonly at: string;
    }
  | {
      /** Observable transport phase; never contains hidden reasoning text. */
      readonly type: "model_phase";
      readonly turn: number;
      readonly phase: "thinking" | "responding" | "tool_calling" | "settling" | "waiting_capacity" | "failed";
      readonly capacityReasons?: readonly CapacityWaitReason[];
      readonly attemptId?: string;
      readonly at: string;
    }
  | {
      /** A provider-visible reasoning summary, if the adapter explicitly supplies one. */
      readonly type: "provider_reasoning";
      readonly turn: number;
      readonly visibility: "visible";
      readonly content: string;
      readonly status: "streaming" | "complete";
      readonly itemId?: string;
      readonly at: string;
    }
  | {
      readonly type: "model_attempt_completed";
      readonly turn: number;
      /** One-based attempt number within this model turn. */
      readonly attempt: number;
      readonly outcome: "succeeded" | "failed";
      readonly startedAt: string;
      readonly at: string;
      readonly durationMs: number;
      readonly retryScheduled: boolean;
      readonly outputTokens?: number;
      readonly generationDurationMs?: number;
      readonly failure?: AgentModelFailure;
    }
  | {
      readonly type: "model_completed";
      readonly turn: number;
      readonly toolCallCount: number;
      readonly citations?: readonly ModelCitation[];
      readonly outputParts?: readonly AgentOutputPart[];
      readonly at: string;
    }
  | {
      /** Replaces the model-authored plan for this run; runtime progress uses assistant_progress. */
      readonly type: "task_plan_updated";
      readonly steps: readonly AgentTaskPlanStep[];
      readonly source: "model";
      readonly at: string;
    }
  | {
      readonly type: "assistant_progress";
      readonly turn: number;
      readonly content: string;
      /** Runtime progress is derived from observed operations, never hidden model reasoning. */
      readonly origin?: "model" | "runtime";
      readonly at: string;
    }
  | {
      readonly type: "assistant_delta";
      readonly turn: number;
      readonly delta: string;
      readonly at: string;
    }
  | {
      readonly type: "tool_started";
      readonly callId: string;
      readonly toolName: string;
      readonly source: ToolSource;
      readonly summary?: ToolExecutionSummary;
      readonly at: string;
    }
  | {
      readonly type: "tool_output";
      readonly callId: string;
      readonly toolName: string;
      readonly source: ToolSource;
      readonly processId?: string;
      readonly stream: "stdout" | "stderr" | "pty";
      readonly chunk: string;
      readonly sequence: number;
      readonly at: string;
    }
  | {
      readonly type: "tool_process_started";
      readonly callId: string;
      readonly toolName: string;
      readonly source: ToolSource;
      readonly processId: string;
      readonly commandLine: string;
      readonly interactive: boolean;
      readonly at: string;
    }
  | {
      readonly type: "tool_process_exited";
      readonly callId: string;
      readonly toolName: string;
      readonly source: ToolSource;
      readonly processId: string;
      readonly exitCode: number | null;
      readonly signal: NodeJS.Signals | null;
      readonly failure?: string;
      readonly terminationReason?: ToolProcessTerminationReason;
      readonly at: string;
    }
  | {
      readonly type: "tool_completed";
      readonly callId: string;
      readonly toolName: string;
      readonly ok: boolean;
      /** Operation-level outcome. `ok` remains the tool-transport outcome. */
      readonly status: AgentToolCompletionStatus;
      readonly summary: ToolExecutionSummary;
      readonly unknownSideEffect?: true;
      readonly failure?: {
        readonly code: string;
        readonly message: string;
        readonly params?: AgentMessageParams;
        /** Compact delegated-child diagnostic; never contains the child transcript. */
        readonly childReceipt?: AgentChildReceipt;
      };
      readonly durationMs: number;
      readonly at: string;
    }
  | {
      readonly type: "context_compaction_started";
      readonly turn: number;
      readonly segment: number;
      readonly at: string;
    }
  | {
      readonly type: "context_compaction_completed";
      readonly turn: number;
      readonly segment: number;
      readonly messagesBefore: number;
      readonly messagesAfter: number;
      /** Real context ceiling discovered when an upstream route rejected a larger advertised window. */
      readonly detectedContextWindowLimit?: number;
      readonly at: string;
    }
  | {
      readonly type: "model_retry_scheduled";
      readonly turn: number;
      readonly attempt: number;
      readonly delayMs: number;
      readonly reason: string;
      readonly at: string;
    }
  | {
      readonly type: "steering_accepted";
      readonly message: AgentSteeringMessage;
      readonly at: string;
    }
  | {
      readonly type: "steering_applied";
      readonly message: AgentSteeringMessage;
      readonly turn: number;
      readonly at: string;
    };

export interface AgentSkillPolicy {
  readonly id: string;
  readonly name: string;
  readonly sourceHash: string;
  /** Undefined inherits the existing grant; [] explicitly allows no resource tools. */
  readonly allowedToolNames?: readonly string[];
}

export interface AgentToolPolicySnapshot {
  readonly allowedToolNames: readonly string[];
  readonly skills: readonly AgentSkillPolicy[];
}

export interface AgentVerificationCheck {
  readonly cwd?: string;
  readonly callId: string;
  readonly command: string;
  readonly exitCode: number | null;
  readonly status: "passed" | "failed" | "running";
  readonly revision: number;
  readonly afterLastChange: boolean;
  readonly processId?: string;
}

/** Observed checks, not a guarantee of complete semantic test coverage. */
export interface AgentRunVerification {
  readonly status: "not_required" | "unverified" | "passed" | "failed";
  readonly changedPaths: readonly string[];
  /** Files whose latest edit attempt failed and was never redone successfully: the run did not change them. */
  readonly failedEdits?: readonly string[];
  readonly revision: number;
  readonly checks: readonly AgentVerificationCheck[];
}

export interface AgentRunCheckpoint {
  /** Local file backup receipts retained across an interrupted host run. Never model tool calls. */
  readonly recoveredFileCheckpointIds?: readonly string[];
  readonly verification?: AgentRunVerification;
  readonly verificationPrompted?: boolean;
  /** v2 is required for output references; v1 remains text-only for old readers. */
  readonly version: 1 | 2 | 3;
  readonly pendingToolBatch?: AgentPendingToolBatch;
  /** A cancelled/expired question remains paused until an explicit new user direction. */
  readonly userInputStopReason?: "user_input_cancelled" | "user_input_expired";
  readonly durableStop?: { readonly reason: 'tool_call_limit_reached' | 'input_token_limit_reached' | 'output_token_limit_reached'; readonly turns: number };
  readonly accountedOperationIds?: readonly string[];
  readonly runId: string;
  readonly executionScopeId?: string;
  readonly logicalParentOperationId?: string;
  /** Trusted cross-run process lineage; a single marker, never duplicated tool history. */
  readonly processResumeContext?: { readonly previousRunId: string };
  readonly nextTurn: number;
  readonly segment: number;
  readonly messages: readonly AgentModelMessage[];
  /** Current task boundary preserved independently from older conversation history. */
  readonly taskAnchor?: AgentModelMessage;
  /** Latest applied goal replacement, including its stable host identity and timestamp. */
  readonly activeGoal?: AgentSteeringMessage;
  /** Compact operational memory; never contains the full parent transcript. */
  readonly taskContext?: AgentTaskContext;
  readonly toolPolicy?: AgentToolPolicySnapshot;
  /** Latest high-level model plan; old checkpoints may contain a retired synthetic runtime plan. */
  readonly taskPlan?: readonly AgentTaskPlanStep[];
  /** Persisted provenance. The deprecated runtime value is accepted only for checkpoint migration. */
  readonly taskPlanSource?: AgentTaskPlanCheckpointSource;
  readonly seenToolCallIds: readonly string[];
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
  /** Persisted provider-usage confidence; omitted by legacy checkpoints. */
  readonly usageKnown?: boolean;
  readonly tokenBudget?: AgentTokenBudgetSnapshot;
  readonly toolCalls: number;
  readonly previousToolBatchSignature?: string;
  readonly previousToolResultSignature?: string;
  readonly repeatedToolBatchTurns: number;
  /** Per-call failure streaks: hashes avoid persisting a second copy of tool arguments. */
  readonly repeatedToolFailures?: readonly {
    readonly signature: string;
    readonly errorCode: string;
    readonly count: number;
  }[];
  readonly createdAt: string;
}

export interface AgentRunResult {
  readonly verification?: AgentRunVerification;
  /** Real context ceiling discovered when an upstream route rejected a larger advertised window. */
  readonly detectedContextWindowLimit?: number;
  readonly runId: string;
  readonly status: AgentRunStatus;
  readonly stopReason: AgentRunStopReason;
  readonly finalText: string;
  /** Present only when finalText is runtime-authored. Model-authored text is never translated. */
  readonly finalMessage?: AgentRuntimeFinalMessage;
  /** Only this result's answer/paused response, never inherited from an earlier tool turn or child. */
  readonly outputParts?: readonly AgentOutputPart[];
  /** Sources belonging to the final answer, not earlier tool-planning turns. */
  readonly citations?: readonly ModelCitation[];
  readonly events: readonly AgentRunEvent[];
  readonly usage: AgentUsage;
  /** False when one or more provider responses omitted verifiable usage. */
  readonly usageKnown?: boolean;
  readonly tokenBudget?: AgentTokenBudgetSnapshot;
  readonly turns: number;
  readonly toolCalls: number;
  readonly checkpoint?: AgentRunCheckpoint;
}

/** Stable host/runtime seam used by the desktop service. */
export interface AgentBackendCapabilities {
  readonly streaming: boolean;
  readonly cancellation: boolean;
  readonly sessionResume: boolean;
  readonly permissions: boolean;
  readonly filesystem: boolean;
  readonly terminal: boolean;
  readonly mcp: boolean;
  /** Whether the backend enforces the normalized cumulative token budget. */
  readonly tokenBudget?: boolean;
  /** Enforces a host-selected model context window before provider requests. */
  readonly contextWindow?: boolean;
  readonly toolPolicy?: boolean;
  /** Preserves opaque ordered references, not a claim of provider/media renderer support. */
  readonly orderedOutput?: boolean;
}

export interface AgentBackendRunRequest {
  /** Model input + output window; distinct from a cumulative spending budget. */
  readonly contextWindowTokens?: number;
  /** Known model/transport output ceiling; omitted when unpublished. */
  readonly modelOutputTokenLimit?: number;
  readonly modelInputTokenLimit?: number;
  /** @deprecated Known hard limits apply in automatic mode too. */
  readonly enforceContextOutputLimit?: boolean;
  readonly prompt: string;
  /** Explicit host acceptance of ordered output references and their non-text presentation. */
  readonly acceptOrderedOutput?: true;
  readonly attachments?: readonly AgentMessageAttachment[];
  readonly history?: readonly AgentModelMessage[];
  readonly checkpoint?: AgentRunCheckpoint;
  readonly workspaceRoot: string;
  /** Optional host-verified extra roots. workspaceRoot remains the primary scope. */
  readonly workspaceBindings?: readonly AgentWorkspaceBinding[];
  /** Compact operational memory supplied by the host; distinct from history. */
  readonly taskContext?: AgentTaskContext;
  /** Optional per-run tool capability boundary, narrower than permission mode. */
  readonly allowedToolNames?: readonly string[];
  /** Tools used in this conversation's recent turns: kept loaded when a small context defers optional tool groups. */
  readonly pinnedToolNames?: readonly string[];
  /** Ask the builtin backend to retain a private checkpoint after completion. */
  readonly captureCheckpoint?: boolean;
  readonly permissionMode: AgentPermissionMode;
  readonly reasoningEffort?: AgentReasoningEffort;
  readonly reasoningBudgetTokens?: number;
  readonly reasoningEnabled?: boolean;
  readonly reasoningMode?: "adaptive" | "enabled" | "disabled";
  readonly reasoningExclude?: boolean;
  readonly tokenBudget?: AgentTokenBudget;
  /** Capabilities the caller requires for this particular run. */
  readonly requiredBackendCapabilities?: readonly (keyof AgentBackendCapabilities)[];
  /** Explicit runtime selection. Omission keeps deterministic priority routing. */
  readonly preferredBackendId?: string;
  /** Fallback is opt-in when a concrete backend was selected. */
  readonly allowBackendFallback?: boolean;
  readonly runId?: string;
  readonly signal?: AbortSignal;
  readonly onEvent?: (event: AgentRunEvent) => void | Promise<void>;
  /** Safe continuation boundary emitted before the next model request. */
  readonly onCheckpoint?: (checkpoint: AgentRunCheckpoint) => void | Promise<void>;
  readonly onDurableCheckpoint?: AgentDurableCheckpointWriter;
  readonly takeSteeringMessages?: () => readonly AgentSteeringMessage[];
  readonly requestUserInput?: AgentUserInputHandler;
  /** Host-only scoped authorization; never filled from model question arguments. */
  readonly requestPermissionApproval?: AgentPermissionApprovalHandler;
  /** The host re-runs this conversation when a task.schedule_wakeup timer fires; only then is that tool offered. */
  readonly conversationWakeups?: boolean;
}

export interface AgentBackend {
  readonly id: string;
  readonly capabilities: AgentBackendCapabilities;
  run(request: AgentBackendRunRequest): Promise<AgentRunResult>;
}
