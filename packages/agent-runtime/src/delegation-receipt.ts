import type {
  AgentChildOutcome,
  AgentChildReceipt,
  AgentRunEvent,
  AgentRunStatus,
  AgentTokenBudgetSnapshot,
} from "./types.js";

const MAX_FAILURE_CODE = 160;

type ReceiptStatus = AgentRunStatus | "failed";

export interface AgentChildReceiptInput {
  readonly status: ReceiptStatus;
  readonly events?: readonly AgentRunEvent[];
  readonly checkpointAvailable?: boolean;
  readonly budget?: AgentTokenBudgetSnapshot;
  readonly failure?: {
    readonly code: string;
    readonly message: string;
  };
}

export function canonicalChildFailureMessage(code: string): string {
  return code === "TOOL_EXECUTION_UNKNOWN"
    ? "The child task has an unknown side-effect state; automatic replay is blocked"
    : `Child operation failed (${code})`;
}

function safeFailure(value: AgentChildReceiptInput["failure"]): AgentChildReceipt["failure"] | undefined {
  if (!value || typeof value.code !== "string" || typeof value.message !== "string") return undefined;
  const code = value.code.trim().slice(0, MAX_FAILURE_CODE) || "CHILD_AGENT_FAILED";
  const message = canonicalChildFailureMessage(code);
  return { code, message };
}

function eventFailure(events: readonly AgentRunEvent[]): AgentChildReceipt["failure"] | undefined {
  for (const event of events) {
    if (event.type !== "tool_completed" || !event.failure) continue;
    const failure = safeFailure(event.failure);
    if (failure) return failure;
  }
  return undefined;
}

function hasUnknownSideEffect(events: readonly AgentRunEvent[], failure: AgentChildReceipt["failure"] | undefined): boolean {
  if (failure?.code === "TOOL_EXECUTION_UNKNOWN" || failure?.code === "DURABLE_TOOL_UNKNOWN") return true;
  return events.some(event => event.type === "tool_completed" && (event.unknownSideEffect
    || event.failure?.childReceipt?.unknownSideEffect || event.failure?.code === "TOOL_EXECUTION_UNKNOWN"));
}

export function canonicalChildOutcomeSummary(outcome: AgentChildOutcome): string {
  switch (outcome) {
    case "completed": return "Child task completed";
    case "partial": return "Child task stopped at a resumable boundary";
    case "cancelled": return "Child task was cancelled";
    case "unknown": return "Child task has an unknown side-effect state";
    case "failed": return "Child task failed";
  }
}

/**
 * Converts a runtime result (or a thrown child failure) into a bounded,
 * machine-readable receipt.  It intentionally does not copy child messages
 * or tool output into the parent result.
 */
export function createAgentChildReceipt(input: AgentChildReceiptInput): AgentChildReceipt {
  const events = input.events || [];
  const failure = safeFailure(input.failure) || eventFailure(events);
  const unknownSideEffect = hasUnknownSideEffect(events, failure);
  let outcome: AgentChildOutcome;
  if (unknownSideEffect) outcome = "unknown";
  else if (input.status === "completed") outcome = "completed";
  else if (input.status === "limit_reached" || input.status === "paused") outcome = "partial";
  else if (input.status === "cancelled") outcome = "cancelled";
  else outcome = "failed";

  const retrySafe = !unknownSideEffect && (
    outcome === "completed" ||
    (outcome === "partial" || outcome === "cancelled") && input.checkpointAvailable === true
  );
  return {
    outcome,
    retrySafe,
    unknownSideEffect,
    summary: canonicalChildOutcomeSummary(outcome),
    ...(input.budget ? { tokenBudget: input.budget } : {}),
    ...(failure ? { failure } : {}),
  };
}
