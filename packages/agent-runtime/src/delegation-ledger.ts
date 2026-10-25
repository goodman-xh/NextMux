import type {
  AgentChildReceipt,
  AgentRunEvent,
  AgentRunStatus,
  AgentRunStopReason,
  AgentTaskContext,
  AgentTokenBudgetSnapshot,
} from "./types.js";
import type { AgentDelegationCheckpointMetadata, AgentDelegationLifecycle, AgentDelegationRecoveryStatus } from "./delegation.js";
import { isAgentCouncilRoleId, type AgentCouncilRoleId, type AgentCouncilRouteDecision } from "./council.js";
import { validateAgentTaskContext } from "./task-context.js";
import { canonicalChildFailureMessage, canonicalChildOutcomeSummary } from "./delegation-receipt.js";

/**
 * A bounded, diagnostic-only projection of a delegation tree.
 *
 * This is intentionally not a transcript and never contains child model
 * messages, provider state, hidden reasoning, or raw tool output.  It is the
 * durable seam a host can use to explain what happened after a child panel or
 * the desktop process has gone away.
 */
export interface AgentDelegationLedgerChild {
  readonly childRunId: string;
  readonly parentRunId: string;
  readonly rootRunId: string;
  readonly depth: number;
  readonly task: string;
  readonly taskContext?: AgentTaskContext;
  readonly role?: AgentCouncilRoleId;
  readonly slotId?: string;
  readonly acceptanceCriteria?: readonly string[];
  readonly modelId?: string;
  readonly modelLabel?: string;
  readonly routeSource?: AgentCouncilRouteDecision["routeSource"];
  readonly invocationKey?: string;
  readonly status: AgentRunStatus | "running" | "failed";
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly lastEventAt?: string;
  readonly lastEventType?: AgentRunEvent["type"];
  readonly eventCount: number;
  readonly finishedAt?: string;
  readonly stopReason?: AgentRunStopReason;
  readonly receipt?: AgentChildReceipt;
  /**
   * Inclusive usage reported by this child run.  It is diagnostic-only: the
   * tree total is stored separately at the root and must not be calculated by
   * summing these values, because a child may itself delegate descendants.
   */
  readonly usage?: AgentDelegationUsage;
  readonly resumeCheckpointId?: string;
  /** Monotonic index commit order; absent in legacy records (revision zero). */
  readonly checkpointRevision?: number;
  readonly recoveryStatus?: AgentDelegationRecoveryStatus;
  readonly checkpointError?: {
    readonly code: string;
    readonly message: string;
  };
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
}

/**
 * Provider-reported token accounting.  `usageKnown=false` is sticky and means
 * at least one request in the represented run could not be verified.
 */
export interface AgentDelegationUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly usageKnown: boolean;
}

export interface AgentDelegationLedger {
  readonly schemaVersion: 1;
  readonly rootRunId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly children: readonly AgentDelegationLedgerChild[];
  /**
   * The root run's inclusive total.  This is the authoritative tree aggregate;
   * child entries intentionally are not added to it a second time.
   */
  readonly usage?: AgentDelegationUsage;
}

export const AGENT_DELEGATION_LEDGER_MAX_CHILDREN = 32;
export const AGENT_DELEGATION_LEDGER_MAX_EVENTS_PER_CHILD = 2_048;
export const AGENT_DELEGATION_LEDGER_MAX_BYTES = 512 * 1024;

const MAX_ID_CHARACTERS = 240;
const MAX_TASK_CHARACTERS = 4_000;
const MAX_ERROR_CHARACTERS = 2_000;
const MAX_CHECKPOINT_ERROR_CHARACTERS = 1_000;
const validEventTypes = new Set<AgentRunEvent["type"]>([
  "backend_selected",
  "backend_fallback",
  "model_route_switched",
  "model_started",
  "model_phase",
  "provider_reasoning",
  "model_attempt_completed",
  "model_completed",
  "model_price_changed",
  "task_plan_updated",
  "assistant_progress",
  "assistant_delta",
  "tool_started",
  "tool_output",
  "tool_process_started",
  "tool_process_exited",
  "tool_completed",
  "context_compaction_started",
  "context_compaction_completed",
  "model_retry_scheduled",
  "steering_accepted",
  "steering_applied",
]);
const validStopReasons = new Set<AgentRunStopReason>([
  "completed",
  "cancel_requested",
  "pause_requested",
  "checkpoint_persistence_failed",
  "turn_limit_reached",
  "tool_call_limit_reached",
  "repeated_tool_calls",
  "input_token_limit_reached",
  "output_token_limit_reached",
  "token_usage_unknown",
]);

function compact(value: string, maximum: number): string {
  return value.replace(/[\u0000\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function safeIdentity(value: unknown, maximum = MAX_ID_CHARACTERS): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximum && /^[A-Za-z0-9._:-]+$/.test(normalized)
    ? normalized
    : undefined;
}

function safeText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = compact(value, maximum)
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|rk|pk|nmxm|nmxu)[-_][A-Za-z0-9._-]{8,}\b/gi, "[redacted]");
  return normalized || undefined;
}

function safeTimestamp(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function safeBudget(value: AgentTokenBudgetSnapshot | undefined): AgentTokenBudgetSnapshot | undefined {
  if (!value || !Number.isSafeInteger(value.inputTokens) || value.inputTokens < 0
    || !Number.isSafeInteger(value.outputTokens) || value.outputTokens < 0
    || typeof value.usageKnown !== "boolean") return undefined;
  const bounded = (candidate: number | undefined): number | undefined =>
    candidate === undefined || !Number.isSafeInteger(candidate) || candidate < 0 ? undefined : candidate;
  return {
    ...(bounded(value.maxInputTokens) === undefined ? {} : { maxInputTokens: bounded(value.maxInputTokens) }),
    ...(bounded(value.maxOutputTokens) === undefined ? {} : { maxOutputTokens: bounded(value.maxOutputTokens) }),
    inputTokens: value.inputTokens,
    outputTokens: value.outputTokens,
    usageKnown: value.usageKnown,
    ...(bounded(value.remainingInputTokens) === undefined ? {} : { remainingInputTokens: bounded(value.remainingInputTokens) }),
    ...(bounded(value.remainingOutputTokens) === undefined ? {} : { remainingOutputTokens: bounded(value.remainingOutputTokens) }),
  };
}

function safeUsage(value: unknown, defaultKnown?: boolean): AgentDelegationUsage | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Partial<AgentDelegationUsage>;
  const inputTokens = candidate.inputTokens;
  const outputTokens = candidate.outputTokens;
  const usageKnown = candidate.usageKnown === undefined ? defaultKnown : candidate.usageKnown;
  if (typeof inputTokens !== "number" || !Number.isSafeInteger(inputTokens) || inputTokens < 0
    || typeof outputTokens !== "number" || !Number.isSafeInteger(outputTokens) || outputTokens < 0
    || typeof usageKnown !== "boolean") return undefined;
  return { inputTokens, outputTokens, usageKnown };
}

function compactReceipt(value: AgentChildReceipt | undefined): AgentChildReceipt | undefined {
  if (!value || !["completed", "partial", "cancelled", "failed", "unknown"].includes(value.outcome)) return undefined;
  const failure = value.failure
    ? {
        code: safeText(value.failure.code, 180) || "CHILD_FAILED",
        message: canonicalChildFailureMessage(safeText(value.failure.code, 180) || "CHILD_FAILED"),
      }
    : undefined;
  return {
    outcome: value.outcome,
    retrySafe: value.retrySafe === true,
    unknownSideEffect: value.unknownSideEffect === true,
    summary: canonicalChildOutcomeSummary(value.outcome),
    ...(safeBudget(value.tokenBudget) ? { tokenBudget: safeBudget(value.tokenBudget) } : {}),
    ...(failure ? { failure } : {}),
  };
}

function compactError(value: { readonly code: string; readonly message: string } | undefined,
  maximum = MAX_ERROR_CHARACTERS): { readonly code: string; readonly message: string } | undefined {
  if (!value) return undefined;
  const code = safeText(value.code, 180);
  const message = canonicalChildFailureMessage(code || "CHILD_FAILED").slice(0, maximum);
  return code && message ? { code, message } : undefined;
}

function compactTaskContext(value: AgentTaskContext | undefined): AgentTaskContext | undefined {
  if (!value || typeof value !== "object") return undefined;
  try {
    // Re-validate at the persistence boundary as well.  This strips unknown
    // properties (including an accidentally attached transcript) and applies
    // the same bounds/redaction policy to values read from disk.
    return validateAgentTaskContext(value);
  } catch {
    return undefined;
  }
}

function freezeLedger(ledger: AgentDelegationLedger): AgentDelegationLedger {
  return Object.freeze({
    ...ledger,
    children: Object.freeze(ledger.children.map(child => Object.freeze({ ...child }))),
  });
}

export function createAgentDelegationLedger(
  rootRunId: string,
  now = new Date().toISOString(),
): AgentDelegationLedger {
  const root = safeIdentity(rootRunId);
  if (!root) throw new RangeError("rootRunId is invalid");
  const timestamp = safeTimestamp(now, new Date().toISOString());
  return freezeLedger({ schemaVersion: 1, rootRunId: root, createdAt: timestamp, updatedAt: timestamp, children: [] });
}

/** Link a confirmed child boundary without inventing an event or terminal result. */
export function recordAgentDelegationCheckpoint(
  ledger: AgentDelegationLedger,
  metadata: AgentDelegationCheckpointMetadata,
  resumeCheckpointId: string,
  now = new Date().toISOString(),
  checkpointRevision?: number,
): AgentDelegationLedger {
  const { childRunId, parentRunId, rootRunId, depth, taskContext } = metadata;
  const context = compactTaskContext(taskContext);
  if (rootRunId !== ledger.rootRunId || !safeIdentity(childRunId) || !safeIdentity(parentRunId)
    || !safeIdentity(resumeCheckpointId) || !Number.isSafeInteger(depth) || depth < 1 || depth > 4
    || !context || context.parentRunId !== parentRunId || context.rootRunId !== rootRunId || context.depth !== depth
    || !safeText(context.goal, MAX_TASK_CHARACTERS)) throw new RangeError("Child checkpoint ownership is invalid");
  if (checkpointRevision !== undefined && (!Number.isSafeInteger(checkpointRevision) || checkpointRevision < 0))
    throw new RangeError("Child checkpoint revision is invalid");
  const timestamp = safeTimestamp(now, new Date().toISOString());
  const children = [...ledger.children];
  let index = children.findIndex(child => child.childRunId === childRunId);
  const current = children[index];
  if (current && (current.parentRunId !== parentRunId || current.rootRunId !== rootRunId || current.depth !== depth
    || current.taskContext && (current.taskContext.workspaceRoot !== context.workspaceRoot
      || current.taskContext.conversationId !== context.conversationId))) throw new RangeError("Child checkpoint owner changed");
  if (index < 0) {
    if (children.length >= AGENT_DELEGATION_LEDGER_MAX_CHILDREN) {
      const removable = children.map((child, i) => ({ child, i })).filter(item => item.child.status !== "running")
        .sort((a, b) => Date.parse(a.child.updatedAt) - Date.parse(b.child.updatedAt))[0];
      if (!removable) throw new RangeError("Child checkpoint index is full");
      children.splice(removable.i, 1);
    }
    index = children.length;
  }
  children[index] = { ...(current || { childRunId, parentRunId, rootRunId, depth,
    task: safeText(context.goal, MAX_TASK_CHARACTERS)!, startedAt: timestamp, eventCount: 0 }),
    taskContext: context, status: metadata.status === "running" && current && current.status !== "running" ? current.status : metadata.status,
    updatedAt: timestamp,
    ...(metadata.status !== "running" ? { finishedAt: timestamp } : {}),
    ...(metadata.stopReason ? { stopReason: metadata.stopReason } : {}),
    resumeCheckpointId, ...(checkpointRevision !== undefined ? { checkpointRevision } : {}), recoveryStatus: "durable" };
  return freezeLedger({ ...ledger, updatedAt: timestamp, children });
}

/**
 * Apply one lifecycle record without ever retaining the record's raw event.
 * Mismatched or malformed observability data is ignored so it can never turn
 * a successful agent run into a failed run.
 */
export function applyAgentDelegationLifecycle(
  ledger: AgentDelegationLedger,
  lifecycle: AgentDelegationLifecycle,
  now = new Date().toISOString(),
): AgentDelegationLedger {
  if (!ledger || ledger.schemaVersion !== 1 || lifecycle.rootRunId !== ledger.rootRunId) return ledger;
  const fallback = safeTimestamp(now, new Date().toISOString());
  const children = [...ledger.children];
  if (lifecycle.type === "started") {
    if (children.some(child => child.childRunId === lifecycle.childRunId)) return ledger;
    const childRunId = safeIdentity(lifecycle.childRunId);
    const parentRunId = safeIdentity(lifecycle.parentRunId);
    const rootRunId = safeIdentity(lifecycle.rootRunId);
    const task = safeText(lifecycle.task, MAX_TASK_CHARACTERS);
    if (!childRunId || !parentRunId || !rootRunId || !task) return ledger;
    if (children.length >= AGENT_DELEGATION_LEDGER_MAX_CHILDREN) {
      const removable = children
        .map((child, index) => ({ child, index }))
        .filter(item => item.child.status !== "running")
        .sort((left, right) => Date.parse(left.child.updatedAt) - Date.parse(right.child.updatedAt))[0];
      if (!removable) return ledger;
      children.splice(removable.index, 1);
    }
    const validRouteSources = new Set<AgentCouncilRouteDecision["routeSource"]>([
      "explicit_slot",
      "role_match",
      "generalist_fallback",
      "random_fallback",
    ]);
    children.push({
      childRunId,
      parentRunId,
      rootRunId,
      depth: Number.isSafeInteger(lifecycle.depth) && lifecycle.depth >= 1 && lifecycle.depth <= 4 ? lifecycle.depth : 1,
      task,
      ...(compactTaskContext(lifecycle.taskContext) ? { taskContext: compactTaskContext(lifecycle.taskContext) } : {}),
      ...(isAgentCouncilRoleId(lifecycle.role) ? { role: lifecycle.role } : {}),
      ...(safeIdentity(lifecycle.slotId, 120) ? { slotId: safeIdentity(lifecycle.slotId, 120) } : {}),
      ...(safeText(lifecycle.modelId, 180) ? { modelId: safeText(lifecycle.modelId, 180) } : {}),
      ...(safeText(lifecycle.modelLabel, 180) ? { modelLabel: safeText(lifecycle.modelLabel, 180) } : {}),
      ...(lifecycle.routeSource && validRouteSources.has(lifecycle.routeSource) ? { routeSource: lifecycle.routeSource } : {}),
      ...(safeIdentity(lifecycle.invocationKey, 120) ? { invocationKey: safeIdentity(lifecycle.invocationKey, 120) } : {}),
      status: "running",
      startedAt: fallback,
      updatedAt: fallback,
      eventCount: 0,
    });
    return freezeLedger({ ...ledger, updatedAt: fallback, children });
  }

  const index = children.findIndex(child => child.childRunId === lifecycle.childRunId);
  if (index < 0) return ledger;
  const current = children[index];
  if (lifecycle.type === "event") {
    const eventType = lifecycle.event?.type;
    const eventAt = safeTimestamp(lifecycle.event?.at, fallback);
    children[index] = {
      ...current,
      eventCount: Math.min(AGENT_DELEGATION_LEDGER_MAX_EVENTS_PER_CHILD, current.eventCount + 1),
      updatedAt: eventAt,
      lastEventAt: eventAt,
      ...(validEventTypes.has(eventType) ? { lastEventType: eventType } : {}),
    };
    return freezeLedger({ ...ledger, updatedAt: eventAt, children });
  }

  const finishedAt = fallback;
  if (lifecycle.type === "completed") {
    const receipt = compactReceipt(lifecycle.result.receipt);
    children[index] = {
      ...current,
      task: safeText(lifecycle.task, MAX_TASK_CHARACTERS) || current.task,
      ...(compactTaskContext(lifecycle.taskContext) ? { taskContext: compactTaskContext(lifecycle.taskContext) } : {}),
      ...(isAgentCouncilRoleId(lifecycle.role ?? lifecycle.result.role) ? { role: (lifecycle.role ?? lifecycle.result.role)! } : {}),
      ...(safeIdentity(lifecycle.slotId ?? lifecycle.result.slotId, 120) ? { slotId: safeIdentity(lifecycle.slotId ?? lifecycle.result.slotId, 120) } : {}),
      ...(safeText(lifecycle.modelId ?? lifecycle.result.modelId, 180) ? { modelId: safeText(lifecycle.modelId ?? lifecycle.result.modelId, 180) } : {}),
      ...(safeText(lifecycle.modelLabel ?? lifecycle.result.modelLabel, 180) ? { modelLabel: safeText(lifecycle.modelLabel ?? lifecycle.result.modelLabel, 180) } : {}),
      ...(safeIdentity(lifecycle.invocationKey ?? lifecycle.result.invocationKey, 120)
        ? { invocationKey: safeIdentity(lifecycle.invocationKey ?? lifecycle.result.invocationKey, 120) } : {}),
      status: lifecycle.result.status,
      updatedAt: finishedAt,
      finishedAt,
      stopReason: lifecycle.result.stopReason,
      eventCount: current.eventCount,
      ...(receipt ? { receipt } : {}),
      ...(safeUsage(lifecycle.result.usage, lifecycle.result.usageKnown !== false)
        ? { usage: safeUsage(lifecycle.result.usage, lifecycle.result.usageKnown !== false)! }
        : {}),
      ...(safeIdentity(lifecycle.result.resumeCheckpointId) ? { resumeCheckpointId: safeIdentity(lifecycle.result.resumeCheckpointId) } : {}),
      ...(lifecycle.result.recoveryStatus ? { recoveryStatus: lifecycle.result.recoveryStatus } : {}),
      ...(compactError(lifecycle.result.checkpointError, MAX_CHECKPOINT_ERROR_CHARACTERS)
        ? { checkpointError: compactError(lifecycle.result.checkpointError, MAX_CHECKPOINT_ERROR_CHARACTERS) } : {}),
    };
  } else {
    const receipt = compactReceipt(lifecycle.receipt);
    children[index] = {
      ...current,
      task: safeText(lifecycle.task, MAX_TASK_CHARACTERS) || current.task,
      ...(compactTaskContext(lifecycle.taskContext) ? { taskContext: compactTaskContext(lifecycle.taskContext) } : {}),
      ...(isAgentCouncilRoleId(lifecycle.role) ? { role: lifecycle.role } : {}),
      ...(safeIdentity(lifecycle.slotId, 120) ? { slotId: safeIdentity(lifecycle.slotId, 120) } : {}),
      ...(safeText(lifecycle.modelId, 180) ? { modelId: safeText(lifecycle.modelId, 180) } : {}),
      ...(safeText(lifecycle.modelLabel, 180) ? { modelLabel: safeText(lifecycle.modelLabel, 180) } : {}),
      ...(safeIdentity(lifecycle.invocationKey, 120) ? { invocationKey: safeIdentity(lifecycle.invocationKey, 120) } : {}),
      status: "failed",
      updatedAt: finishedAt,
      finishedAt,
      ...(receipt ? { receipt } : {}),
      ...(safeIdentity(lifecycle.resumeCheckpointId) ? { resumeCheckpointId: safeIdentity(lifecycle.resumeCheckpointId) } : {}),
      ...(lifecycle.recoveryStatus ? { recoveryStatus: lifecycle.recoveryStatus } : {}),
      ...(safeUsage(lifecycle.usage, lifecycle.usageKnown !== false) ? { usage: safeUsage(lifecycle.usage, lifecycle.usageKnown !== false) } : {}),
      ...(compactError(lifecycle.checkpointError, MAX_CHECKPOINT_ERROR_CHARACTERS)
        ? { checkpointError: compactError(lifecycle.checkpointError, MAX_CHECKPOINT_ERROR_CHARACTERS) } : {}),
      ...(compactError(lifecycle.error) ? { error: compactError(lifecycle.error) } : {}),
    };
  }
  return freezeLedger({ ...ledger, updatedAt: finishedAt, children });
}

/**
 * Record the root run's inclusive usage without double-counting delegated
 * children.  Repeated/stale observations are merged monotonically and an
 * unknown observation remains unknown for safety.
 */
export function recordAgentDelegationUsage(
  ledger: AgentDelegationLedger,
  usage: { readonly inputTokens: number; readonly outputTokens: number },
  usageKnown = true,
  now = new Date().toISOString(),
): AgentDelegationLedger {
  if (!ledger || ledger.schemaVersion !== 1) return ledger;
  const inputTokens = usage?.inputTokens;
  const outputTokens = usage?.outputTokens;
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0
    || !Number.isSafeInteger(outputTokens) || outputTokens < 0
    || typeof usageKnown !== "boolean") return ledger;
  const timestamp = safeTimestamp(now, ledger.updatedAt);
  const previous = ledger.usage;
  const nextUsage: AgentDelegationUsage = {
    inputTokens: Math.max(previous?.inputTokens ?? 0, inputTokens),
    outputTokens: Math.max(previous?.outputTokens ?? 0, outputTokens),
    usageKnown: (previous?.usageKnown ?? true) && usageKnown,
  };
  if (previous && previous.inputTokens === nextUsage.inputTokens
    && previous.outputTokens === nextUsage.outputTokens
    && previous.usageKnown === nextUsage.usageKnown) return ledger;
  return freezeLedger({ ...ledger, updatedAt: timestamp, usage: nextUsage });
}

/** Normalize a value read from a local store; malformed children are dropped. */
export function normalizeAgentDelegationLedger(value: unknown): AgentDelegationLedger | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Partial<AgentDelegationLedger>;
  const rootRunId = safeIdentity(candidate.rootRunId);
  if (candidate.schemaVersion !== 1 || !rootRunId || !Array.isArray(candidate.children)) return undefined;
  const createdAt = safeTimestamp(candidate.createdAt, "");
  const updatedAt = safeTimestamp(candidate.updatedAt, createdAt);
  if (!createdAt) return undefined;
  const validRouteSources = new Set<AgentCouncilRouteDecision["routeSource"]>([
    "explicit_slot",
    "role_match",
    "generalist_fallback",
    "random_fallback",
  ]);
  const children: AgentDelegationLedgerChild[] = [];
  for (const raw of candidate.children.slice(0, AGENT_DELEGATION_LEDGER_MAX_CHILDREN)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const child = raw as Partial<AgentDelegationLedgerChild>;
    const childRunId = safeIdentity(child.childRunId);
    const parentRunId = safeIdentity(child.parentRunId);
    const childRootRunId = safeIdentity(child.rootRunId);
    const task = safeText(child.task, MAX_TASK_CHARACTERS);
    const status = child.status;
    if (!childRunId || !parentRunId || childRootRunId !== rootRunId || !task
      || !["running", "completed", "limit_reached", "cancelled", "paused", "failed"].includes(status as string)) continue;
    if (child.checkpointRevision !== undefined && (!Number.isSafeInteger(child.checkpointRevision)
      || child.checkpointRevision < 0 || child.checkpointRevision > 0 && !safeIdentity(child.resumeCheckpointId))) return undefined;
    const candidateEventCount = child.eventCount;
    const eventCount = typeof candidateEventCount === "number" && Number.isSafeInteger(candidateEventCount) && candidateEventCount >= 0
      ? Math.min(candidateEventCount, AGENT_DELEGATION_LEDGER_MAX_EVENTS_PER_CHILD) : 0;
    const candidateDepth = child.depth;
    const depth = typeof candidateDepth === "number" && Number.isSafeInteger(candidateDepth) && candidateDepth >= 1 && candidateDepth <= 4 ? candidateDepth : 1;
    const entry: AgentDelegationLedgerChild = {
      childRunId,
      parentRunId,
      rootRunId,
      depth,
      task,
      ...(compactTaskContext(child.taskContext) ? { taskContext: compactTaskContext(child.taskContext) } : {}),
      ...(isAgentCouncilRoleId(child.role) ? { role: child.role } : {}),
      ...(safeIdentity(child.slotId, 120) ? { slotId: safeIdentity(child.slotId, 120) } : {}),
      ...(safeText(child.modelId, 180) ? { modelId: safeText(child.modelId, 180) } : {}),
      ...(safeText(child.modelLabel, 180) ? { modelLabel: safeText(child.modelLabel, 180) } : {}),
      ...(child.routeSource && validRouteSources.has(child.routeSource) ? { routeSource: child.routeSource } : {}),
      ...(safeIdentity(child.invocationKey, 120) ? { invocationKey: safeIdentity(child.invocationKey, 120) } : {}),
      status: status as AgentDelegationLedgerChild["status"],
      startedAt: safeTimestamp(child.startedAt, createdAt),
      updatedAt: safeTimestamp(child.updatedAt, updatedAt),
      ...(child.lastEventAt ? { lastEventAt: safeTimestamp(child.lastEventAt, updatedAt) } : {}),
      ...(validEventTypes.has(child.lastEventType as AgentRunEvent["type"]) ? { lastEventType: child.lastEventType as AgentRunEvent["type"] } : {}),
      eventCount,
      ...(child.finishedAt ? { finishedAt: safeTimestamp(child.finishedAt, updatedAt) } : {}),
      ...(validStopReasons.has(child.stopReason as AgentRunStopReason)
        ? { stopReason: child.stopReason as AgentRunStopReason } : {}),
      ...(compactReceipt(child.receipt) ? { receipt: compactReceipt(child.receipt) } : {}),
      ...(safeUsage(child.usage) ? { usage: safeUsage(child.usage) } : {}),
      ...(safeIdentity(child.resumeCheckpointId) ? { resumeCheckpointId: safeIdentity(child.resumeCheckpointId) } : {}),
      ...(child.checkpointRevision !== undefined ? { checkpointRevision: child.checkpointRevision } : {}),
      ...(["durable", "unavailable", "unknown"].includes(child.recoveryStatus || "") ? { recoveryStatus: child.recoveryStatus } : {}),
      ...(compactError(child.checkpointError, MAX_CHECKPOINT_ERROR_CHARACTERS)
        ? { checkpointError: compactError(child.checkpointError, MAX_CHECKPOINT_ERROR_CHARACTERS) } : {}),
      ...(compactError(child.error) ? { error: compactError(child.error) } : {}),
    };
    if (!children.some(existing => existing.childRunId === entry.childRunId)) children.push(entry);
  }
  const usage = safeUsage(candidate.usage);
  return freezeLedger({
    schemaVersion: 1,
    rootRunId,
    createdAt,
    updatedAt,
    children,
    ...(usage ? { usage } : {}),
  });
}
