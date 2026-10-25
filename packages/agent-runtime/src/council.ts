// Browser code imports this module's role and config helpers, so Node built-ins load on use (nodeCrypto, at the end).
import type { AgentPermissionMode, AgentTaskContext, AgentTokenBudget } from "./types.js";

export const AGENT_COUNCIL_ROLE_IDS = [
  "lead", "planning", "frontend", "backend", "qa", "review", "delivery", "generalist",
] as const;
export const AGENT_COUNCIL_ROLES = AGENT_COUNCIL_ROLE_IDS;
export type AgentCouncilCanonicalRoleId = (typeof AGENT_COUNCIL_ROLE_IDS)[number];
const LEGACY_COUNCIL_ROLES = {
  requirements: "planning", research: "planning", architecture: "planning",
  ui_design: "frontend", systems: "backend", data: "backend",
  security: "review", platform: "delivery", docs: "delivery",
} as const satisfies Readonly<Record<string, AgentCouncilCanonicalRoleId>>;
// Persisted execution receipts retain their original role IDs. New assignments
// and configuration writes only use the eight canonical roles.
export type AgentCouncilRoleId = AgentCouncilCanonicalRoleId | keyof typeof LEGACY_COUNCIL_ROLES;
export type AgentCouncilRole = AgentCouncilCanonicalRoleId;

export function normalizeAgentCouncilRoleId(value: unknown): AgentCouncilCanonicalRoleId | undefined {
  if (typeof value !== "string") return undefined;
  if ((AGENT_COUNCIL_ROLE_IDS as readonly string[]).includes(value)) return value as AgentCouncilCanonicalRoleId;
  return Object.prototype.hasOwnProperty.call(LEGACY_COUNCIL_ROLES, value)
    ? LEGACY_COUNCIL_ROLES[value as keyof typeof LEGACY_COUNCIL_ROLES] : undefined;
}

/** Common names a model uses for a role, mapped to the role that does that work. */
const COUNCIL_ROLE_SYNONYMS = {
  plan: "planning", planner: "planning",
  design: "frontend", designer: "frontend", ui: "frontend", ux: "frontend",
  server: "backend", api: "backend", database: "backend",
  test: "qa", testing: "qa", tester: "qa", quality: "qa",
  reviewer: "review", code_review: "review", security_review: "review", audit: "review",
  ops: "delivery", devops: "delivery", deploy: "delivery", deployment: "delivery", release: "delivery",
} as const satisfies Readonly<Record<string, AgentCouncilCanonicalRoleId>>;

/**
 * A role named in a delegation call: exact and legacy IDs, any case or separator ("UI-Design"), and common synonyms
 * ("testing"). Undefined means the name is not a role; the caller reports it instead of guessing one.
 */
export function resolveAgentCouncilRoleId(value: unknown): AgentCouncilCanonicalRoleId | undefined {
  if (typeof value !== "string") return undefined;
  const exact = normalizeAgentCouncilRoleId(value.trim());
  if (exact) return exact;
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return normalizeAgentCouncilRoleId(key)
    ?? (Object.prototype.hasOwnProperty.call(COUNCIL_ROLE_SYNONYMS, key) ? COUNCIL_ROLE_SYNONYMS[key as keyof typeof COUNCIL_ROLE_SYNONYMS] : undefined);
}

/** Copy only role lists; preserve identities and unknown values for validation. */
export function normalizeAgentCouncilConfigRoles(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const config = input as Record<string, unknown>;
  if (!Array.isArray(config.slots)) return input;
  return { ...config, slots: config.slots.map(slot => {
    if (!slot || typeof slot !== "object" || Array.isArray(slot) || !Array.isArray(slot.roles)) return slot;
    return { ...slot, roles: [...new Set(slot.roles.map((role: unknown) => normalizeAgentCouncilRoleId(role) ?? role))] };
  }) };
}

export const MIN_COUNCIL_SLOTS = 3;
export const MAX_COUNCIL_SLOTS = 8;

export interface AgentCouncilSlotSpec {
  readonly slotId: string;
  readonly modelId: string;
  readonly modelLabel?: string;
  readonly roles: readonly AgentCouncilRoleId[];
}

export type AgentCouncilValidationError =
  | "config_invalid" | "min_slots" | "max_slots" | "slot_invalid" | "slot_id_required" | "duplicate_slot_ids"
  | "slot_model_required" | "slot_roles_required" | "slot_roles_invalid"
  | "lead_required" | "multiple_leads" | "lead_slot_mismatch";

export interface AgentCouncilValidationResult {
  readonly valid: boolean;
  readonly error?: AgentCouncilValidationError;
}

export function validateAgentCouncilConfig(input: unknown): AgentCouncilValidationResult {
  const config = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : undefined;
  if (config && (["sourceKey", "relayKey"].some(key => config[key] !== undefined && typeof config[key] !== "string")
    || config.enabled !== undefined && typeof config.enabled !== "boolean")) return { valid: false, error: "config_invalid" };
  if (!Array.isArray(config?.slots) || config.slots.length < MIN_COUNCIL_SLOTS) return { valid: false, error: "min_slots" };
  if (config.slots.length > MAX_COUNCIL_SLOTS) return { valid: false, error: "max_slots" };
  const ids = new Set<string>();
  let leadId: string | undefined;
  for (const slot of config.slots) {
    if (!slot || typeof slot !== "object" || Array.isArray(slot)) return { valid: false, error: "slot_invalid" };
    if (typeof slot.slotId !== "string" || !slot.slotId.trim()) return { valid: false, error: "slot_id_required" };
    if (ids.has(slot.slotId)) return { valid: false, error: "duplicate_slot_ids" };
    ids.add(slot.slotId);
    if (typeof slot.modelId !== "string" || !slot.modelId.trim()) return { valid: false, error: "slot_model_required" };
    if (!Array.isArray(slot.roles) || slot.roles.length === 0) return { valid: false, error: "slot_roles_required" };
    if (slot.roles.some((role: unknown) => normalizeAgentCouncilRoleId(role) !== role || role === undefined)) return { valid: false, error: "slot_roles_invalid" };
    if (slot.roles.includes("lead")) {
      if (leadId !== undefined) return { valid: false, error: "multiple_leads" };
      leadId = slot.slotId;
    }
  }
  if (leadId === undefined) return { valid: false, error: "lead_required" };
  if (config.leadSlotId !== undefined && config.leadSlotId !== leadId) return { valid: false, error: "lead_slot_mismatch" };
  return { valid: true };
}

export function agentCouncilValidationErrorMessage(error: AgentCouncilValidationError): string {
  const messages: Record<AgentCouncilValidationError, string> = {
    config_invalid: "Council configuration contains invalid fields. Open its settings and correct them.",
    min_slots: "Council requires at least 3 model slots.", max_slots: "Council supports at most 8 model slots.",
    slot_invalid: "A Council slot is malformed. Open the configuration and correct it.",
    slot_id_required: "Every Council slot needs a non-empty ID.", duplicate_slot_ids: "Council slot IDs must be unique.",
    slot_model_required: "Choose a model for every Council slot.", slot_roles_required: "Choose at least one role for every Council slot.",
    slot_roles_invalid: "Council contains an unknown role. Choose one of the eight supported roles.",
    lead_required: "Assign exactly one Council lead.", multiple_leads: "Only one Council slot can be the lead.",
    lead_slot_mismatch: "The Council lead ID does not match the slot assigned as lead.",
  };
  return messages[error];
}

export type AgentCouncilRouteSource =
  | "explicit_slot"
  | "role_match"
  | "generalist_fallback"
  | "random_fallback";

export interface AgentCouncilRouteDecision {
  readonly role: AgentCouncilCanonicalRoleId;
  readonly slotId: string;
  readonly modelId: string;
  readonly modelLabel: string;
  readonly routeSource: AgentCouncilRouteSource;
}

export function isAgentCouncilRoleId(value: unknown): value is AgentCouncilRoleId {
  return normalizeAgentCouncilRoleId(value) !== undefined;
}

/**
 * Resolve one caller-selected index within the eligible Council slot pool.
 * The run-owned dispatcher below supplies rotation or random selection.
 * 1. If an explicit `slotId` is supplied and exists in the active slots, use it.
 * 2. Otherwise, filter slots that declare `requestedRole` (excluding `lead`-only when delegating specialist work unless also tagged).
 * 3. If no slot declares `requestedRole`, fall back to slots tagged with `generalist` ("杂活/其他").
 * 4. If no slot is tagged with `generalist`, use the non-lead-only pool (the lead assigns it at random; 负责人随机分配).
 */
export function resolveAgentCouncilSlot(
  slots: readonly AgentCouncilSlotSpec[],
  requestedRole: AgentCouncilRoleId | undefined,
  requestedSlotId: string | undefined,
  dispatchIndex: number,
): AgentCouncilRouteDecision | undefined {
  const pool = councilCandidatePool(slots, requestedRole, requestedSlotId);
  if (!pool) return undefined;
  const safeIndex = Number.isSafeInteger(dispatchIndex) && dispatchIndex >= 0 ? dispatchIndex : 0;
  return councilPoolDecision(pool, safeIndex);
}

interface CouncilCandidatePool {
  readonly role: AgentCouncilCanonicalRoleId;
  readonly slots: readonly AgentCouncilSlotSpec[];
  readonly routeSource: AgentCouncilRouteSource;
}

function councilCandidatePool(
  slots: readonly AgentCouncilSlotSpec[],
  requestedRole: AgentCouncilRoleId | undefined,
  requestedSlotId: string | undefined,
): CouncilCandidatePool | undefined {
  if (!Array.isArray(slots) || slots.length === 0) return undefined;
  if (slots.some(slot => !slot || typeof slot.slotId !== "string" || !slot.slotId.trim()
    || typeof slot.modelId !== "string" || !slot.modelId.trim() || !Array.isArray(slot.roles) || !slot.roles.length
    || slot.roles.some((role: unknown) => !normalizeAgentCouncilRoleId(role)))
    || new Set(slots.map(slot => slot.slotId)).size !== slots.length) return undefined;
  const normalizedRole = normalizeAgentCouncilRoleId(requestedRole);
  const effectiveRole = normalizedRole && normalizedRole !== "lead" ? normalizedRole : "generalist";

  if (requestedSlotId) {
    const exact = slots.find(slot => slot.slotId === requestedSlotId);
    if (exact) {
      return { role: effectiveRole, slots: [exact], routeSource: "explicit_slot" };
    }
    // An unknown slot ID (a typo or a slot removed since the roster was shown) is ignored: route by role instead.
  }

  const roleMatches = slots.filter(slot => slot.roles.some((role: unknown) => normalizeAgentCouncilRoleId(role) === effectiveRole));
  if (roleMatches.length > 0) {
    return { role: effectiveRole, slots: roleMatches, routeSource: "role_match" };
  }

  const generalistMatches = slots.filter(slot => slot.roles.includes("generalist"));
  if (generalistMatches.length > 0) {
    return { role: effectiveRole, slots: generalistMatches, routeSource: "generalist_fallback" };
  }

  // Product rule (Council settings copy): without a 杂活/其他 slot, the lead assigns uncovered roles at random
  // among the non-lead-only slots; a lead-only team has no eligible pool.
  const nonLeadSlots = slots.filter(slot => {
    const uniqueRoles = new Set(slot.roles.map((role: unknown) => normalizeAgentCouncilRoleId(role)).filter(Boolean));
    return !uniqueRoles.has("lead") || uniqueRoles.size > 1;
  });
  return nonLeadSlots.length ? { role: effectiveRole, slots: nonLeadSlots, routeSource: "random_fallback" } : undefined;
}

function councilPoolDecision(pool: CouncilCandidatePool, index: number): AgentCouncilRouteDecision {
  const chosen = pool.slots[index % pool.slots.length];
  return {
    role: pool.role,
    slotId: chosen.slotId,
    modelId: chosen.modelId,
    modelLabel: chosen.modelLabel || chosen.modelId,
    routeSource: pool.routeSource,
  };
}

export const DEFAULT_COUNCIL_SPECIALIST_TIMEOUT_MS = 180_000;

export interface AgentCouncilSlotFailure {
  readonly slotId: string;
  readonly code: string;
  readonly message: string;
  readonly timedOut: boolean;
  readonly failedAt: number;
}

export type AgentCouncilSpecialistIsolatedResult<T> =
  | { readonly ok: true; readonly decision: AgentCouncilRouteDecision; readonly value: T }
  | {
      readonly ok: false;
      readonly decision: AgentCouncilRouteDecision;
      readonly error: AgentCouncilSlotFailure;
      readonly fallbackNote: string;
    };

export function createCouncilSpecialistTimeoutSignal(
  parentSignal?: AbortSignal,
  timeoutMs: number = DEFAULT_COUNCIL_SPECIALIST_TIMEOUT_MS,
): { readonly signal: AbortSignal; readonly timedOut: () => boolean; readonly dispose: () => void } {
  const safeTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : DEFAULT_COUNCIL_SPECIALIST_TIMEOUT_MS;
  const controller = new AbortController();
  let didTimeout = false;
  const onParentAbort = (): void => {
    controller.abort(parentSignal?.reason ?? new Error("Cancelled"));
  };
  if (parentSignal?.aborted) {
    onParentAbort();
    return { signal: controller.signal, timedOut: () => false, dispose: () => undefined };
  }
  parentSignal?.addEventListener("abort", onParentAbort, { once: true });
  const timer = setTimeout(() => {
    if (!controller.signal.aborted) {
      didTimeout = true;
      controller.abort(new Error(`Council specialist timed out after ${safeTimeoutMs}ms`));
    }
  }, safeTimeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => didTimeout,
    dispose: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onParentAbort);
    },
  };
}

export function formatCouncilSpecialistFailureNote(
  decision: Pick<AgentCouncilRouteDecision, "role" | "slotId" | "modelId" | "modelLabel">,
  error: { readonly code?: string; readonly message?: string; readonly timedOut?: boolean },
): string {
  const label = decision.modelLabel || decision.modelId;
  const reasonCode = error.timedOut ? "COUNCIL_SPECIALIST_TIMEOUT" : error.code || "COUNCIL_SPECIALIST_FAILED";
  const reasonMessage = (error.message || (error.timedOut ? "Specialist exceeded execution time limit." : "Specialist execution failed.")).trim();
  return `[Council Specialist Unavailable: slot "${decision.slotId}" (${label}) assigned to role "${decision.role}" failed (${reasonCode}: ${reasonMessage}). Do not retry this failed slot; synthesize remaining specialist outputs and complete this subtask directly.]`;
}

export async function executeCouncilSpecialistWithIsolation<T>(options: {
  readonly decision: AgentCouncilRouteDecision;
  readonly dispatcher?: AgentCouncilDispatcher;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly execute: (signal: AbortSignal) => Promise<T>;
}): Promise<AgentCouncilSpecialistIsolatedResult<T>> {
  const guard = createCouncilSpecialistTimeoutSignal(options.signal, options.timeoutMs);
  try {
    const value = await options.execute(guard.signal);
    return { ok: true, decision: options.decision, value };
  } catch (rawError) {
    const timedOut = guard.timedOut();
    const errRecord = rawError && typeof rawError === "object" ? (rawError as { code?: unknown; message?: unknown }) : undefined;
    const code = timedOut
      ? "COUNCIL_SPECIALIST_TIMEOUT"
      : typeof errRecord?.code === "string" && errRecord.code.trim()
        ? errRecord.code.trim()
        : "COUNCIL_SPECIALIST_FAILED";
    const message = typeof errRecord?.message === "string" && errRecord.message.trim()
      ? errRecord.message.trim()
      : timedOut
        ? `Specialist slot "${options.decision.slotId}" timed out.`
        : "Specialist execution failed.";
    const failure: AgentCouncilSlotFailure = {
      slotId: options.decision.slotId,
      code,
      message,
      timedOut,
      failedAt: Date.now(),
    };
    options.dispatcher?.markSlotFailed(options.decision.slotId, failure);
    return {
      ok: false,
      decision: options.decision,
      error: failure,
      fallbackNote: formatCouncilSpecialistFailureNote(options.decision, failure),
    };
  } finally {
    guard.dispose();
  }
}

/**
 * One parent run's automatic routing. Unrelated candidate pools cannot consume
 * each other's turns. An exact invocation keeps its first assignment so a
 * completed-result lookup is not invalidated by subsequent dispatches.
 * This stores routing only: it neither retries a failed child nor caches an
 * unfinished result, and it does not add concurrency to the parent runner.
 */
export class AgentCouncilDispatcher {
  readonly #slots: readonly AgentCouncilSlotSpec[];
  readonly #nextByPool = new Map<string, number>();
  readonly #assignments = new Map<string, AgentCouncilRouteDecision>();
  readonly #failedSlots = new Map<string, AgentCouncilSlotFailure>();
  readonly #randomIndex: (upperBound: number) => number;

  constructor(slots: readonly AgentCouncilSlotSpec[], randomIndex: (upperBound: number) => number = upperBound => nodeCrypto().randomInt(upperBound)) {
    this.#slots = Array.isArray(slots) && councilCandidatePool(slots, undefined, slots[0]?.slotId)
      ? slots.map(slot => ({
        ...slot,
        roles: [...new Set(slot.roles.map((role: unknown) => normalizeAgentCouncilRoleId(role)).filter((role: AgentCouncilRoleId | undefined): role is AgentCouncilRoleId => Boolean(role)))],
      })) : [];
    this.#randomIndex = randomIndex;
  }

  markSlotFailed(
    slotId: string,
    reason?: { readonly code?: string; readonly message?: string; readonly timedOut?: boolean; readonly failedAt?: number },
  ): void {
    if (typeof slotId !== "string" || !slotId.trim()) return;
    this.#failedSlots.set(slotId, {
      slotId,
      code: reason?.code || "COUNCIL_SPECIALIST_FAILED",
      message: reason?.message || "Specialist slot failed.",
      timedOut: Boolean(reason?.timedOut),
      failedAt: reason?.failedAt ?? Date.now(),
    });
  }

  isSlotFailed(slotId: string): boolean {
    return this.#failedSlots.has(slotId);
  }

  failedSlots(): ReadonlyMap<string, AgentCouncilSlotFailure> {
    return new Map(this.#failedSlots);
  }

  resolve(
    requestedRole: AgentCouncilRoleId | undefined,
    requestedSlotId: string | undefined,
    requestIdentity: string,
  ): AgentCouncilRouteDecision | undefined {
    const existing = this.#assignments.get(requestIdentity);
    if (existing) return existing;
    const rawPool = councilCandidatePool(this.#slots, requestedRole, requestedSlotId);
    if (!rawPool) return undefined;
    const healthyInPool = this.#failedSlots.size > 0
      ? rawPool.slots.filter(slot => !this.#failedSlots.has(slot.slotId))
      : rawPool.slots;
    const pool: CouncilCandidatePool = healthyInPool.length > 0
      ? { ...rawPool, slots: healthyInPool }
      : rawPool;
    // Roles that fall back to the same generalists share one rotation. Explicit
    // slot choices never advance automatic rotation for any role.
    const poolKey = JSON.stringify(pool.slots.map(slot => slot.slotId));
    const automaticRotation = pool.routeSource === "role_match" || pool.routeSource === "generalist_fallback";
    const index = pool.routeSource === "random_fallback" ? this.#randomIndex(pool.slots.length)
      : automaticRotation ? this.#nextByPool.get(poolKey) ?? 0 : 0;
    if (!Number.isSafeInteger(index) || index < 0 || index >= pool.slots.length) throw new Error("Invalid Council candidate index");
    const decision = councilPoolDecision(pool, index);
    if (automaticRotation) this.#nextByPool.set(poolKey, (index + 1) % pool.slots.length);
    this.#assignments.set(requestIdentity, decision);
    return decision;
  }
}

/**
 * Exact identity for the host's completed Council calls. This key is not a
 * persistence mechanism and does not authorize replaying an unfinished request.
 */
export function computeChildInvocationKey(input: {
  readonly parentRunId: string;
  readonly configRevision?: number;
  readonly role?: AgentCouncilRoleId;
  readonly slotId?: string;
  readonly task: string;
  readonly acceptanceCriteria?: readonly string[];
  readonly tools?: readonly string[];
  readonly permissionMode?: AgentPermissionMode;
  readonly memoryIds?: readonly string[];
  readonly maxTurns?: number;
  readonly tokenBudget?: AgentTokenBudget;
  readonly taskContext?: AgentTaskContext;
  readonly executionId?: string;
}): string {
  const canonical = JSON.stringify({
    parentRunId: input.parentRunId,
    configRevision: input.configRevision ?? 1,
    role: normalizeAgentCouncilRoleId(input.role) || "generalist",
    slotId: input.slotId || "",
    task: input.task,
    acceptanceCriteria: input.acceptanceCriteria,
    tools: input.tools === undefined ? null : [...input.tools].sort(),
    permissionMode: input.permissionMode || "read_only",
    memoryIds: input.memoryIds === undefined ? null : [...input.memoryIds].sort(),
    maxTurns: input.maxTurns,
    tokenBudget: input.tokenBudget,
    taskContext: input.taskContext,
    executionId: input.executionId,
  });
  const digest = nodeCrypto().createHash("sha256").update(canonical).digest("hex");
  return `inv-${digest}`;
}

const ROLE_DESCRIPTIONS: Readonly<Record<AgentCouncilCanonicalRoleId, { readonly title: string; readonly boundary: string }>> = {
  lead: { title: "负责人 (Lead Coordinator)", boundary: "Own the overall goal, bounded task assignment, acceptance, integration, and final delivery. Delegate implementation and independent checks only when needed; do not duplicate specialists' work." },
  planning: { title: "方案与调研 (Planning & Research)", boundary: "Clarify requirements and acceptance criteria; verify source and documentation; design architecture, interfaces, and migration plans. Deliver a grounded plan, without implementing changes assigned to engineering roles." },
  frontend: { title: "前端与设计 (Frontend & Design)", boundary: "Design and implement UI, visual styling, accessibility, responsive layout, and client interactions. Coordinate API contracts with backend; do not take over server or storage work." },
  backend: { title: "后端与数据 (Backend & Data)", boundary: "Implement services, APIs, domain validation, storage and migrations, runtime/IPC, native integration, and process lifecycle. Keep user interface design with frontend." },
  qa: { title: "测试验收 (QA & Verification)", boundary: "Reproduce defects and design/run targeted unit, integration, and end-to-end checks. Report observed behavior and reproducible evidence; do not replace independent code/security review with test results." },
  review: { title: "代码与安全审查 (Code & Security Review)", boundary: "Independently inspect diffs for correctness, regressions, maintainability, trust boundaries, permissions, secret exposure, and injection risk. Report actionable findings without unrequested edits." },
  delivery: { title: "构建与交付 (Build & Delivery)", boundary: "Prepare build and packaging scripts, platform/architecture verification, authorized deployment, documentation, mindmaps, and localization. Use verified implementation and test results; never claim an unperformed release or platform test." },
  generalist: { title: "杂活/其他 (Generalist & Utility)", boundary: "Handle bounded cross-cutting, glue, formatting, cleanup, or otherwise unassigned work. Follow the requested task's acceptance criteria without duplicating already assigned work." },
};

export function roleTitleForCouncilRole(role: AgentCouncilRoleId): string {
  return ROLE_DESCRIPTIONS[normalizeAgentCouncilRoleId(role) || "generalist"]?.title || ROLE_DESCRIPTIONS.generalist.title;
}

/**
 * Council Mode keeps extra subagents off by default (the desktop's 阻止模型创建子代理 starts checked): the
 * Subagents Disabled rule is written unless `disableSubagents` is explicitly false, and allowing them adds no rule.
 */
export function buildCouncilLeadInstructions(
  slots: readonly AgentCouncilSlotSpec[],
  options?: { readonly disableSubagents?: boolean },
): string {
  if (!validateAgentCouncilConfig(normalizeAgentCouncilConfigRoles({ slots })).valid) {
    return "Council Mode delegation is unavailable because its configuration is invalid. Continue the user's work yourself, explain this limitation, and never claim a specialist participated or drop a subtask.";
  }
  const nonEmptySlots = slots.filter(slot => slot.modelId);
  const hasGeneralist = nonEmptySlots.some(slot => slot.roles.includes("generalist"));
  const specialistRoles = [...new Set(nonEmptySlots.flatMap(slot => slot.roles.map(role => normalizeAgentCouncilRoleId(role))))]
    .filter((role): role is AgentCouncilCanonicalRoleId => role !== undefined && role !== "lead");
  const slotLines = nonEmptySlots.map(slot => {
    const rolesText = [...new Set(slot.roles.map(role => normalizeAgentCouncilRoleId(role) || role))].join(", ");
    return `- Slot \`${slot.slotId}\` -> Model \`${slot.modelLabel || slot.modelId}\`: [${rolesText}]`;
  });

  return [
    "## Council Mode (臭皮匠模式 — Multi-Model Role Collaboration)",
    "You are the **Lead Coordinator (`lead` / 负责人)** in Council Mode. You own the main conversation and are responsible for task planning, delegating bounded subtasks to specialist role models via `agent.delegate`, reviewing their deliverables, and presenting the final verified outcome to the user.",
    "",
    "### Configured Team Roster",
    ...slotLines,
    hasGeneralist
      ? "- Unassigned roles automatically fall back to a slot tagged with `generalist` (杂活/其他)."
      : "- Note: No slot is explicitly tagged `generalist`; a role with no configured match is randomly assigned among slots that are not lead-only.",
    "- Repeated dispatches of a role rotate among its matching slots (else the generalists); an explicit `slotId` picks that slot. An identical repeated request keeps its slot; only a completed result is reused, and failed work is never resent automatically.",
    ...(options?.disableSubagents !== false ? [
      "- **Subagents Disabled (已关闭子智能体)**: Do NOT create or spawn any extra subagents, background agents, or recursive sub-delegations outside the configured Council role slots above. Specialist models must execute their assigned role directly and never spawn subagents.",
    ] : []),
    "",
    "### Delegation & Acceptance Protocol",
    `1. **Dispatch First (开局先派发)**: For substantive work, make \`agent.delegate\` your first tool calls, one per configured role the request needs (configured: ${specialistRoles.map(role => `\`${role}\``).join(", ")}), before long reading, analysis, or synthesis, so each role starts within seconds. Each call sets \`role\`, a self-contained \`task\`, and clear \`acceptanceCriteria\`. Calls run one after another in the order you issue them, so order them by dependency (\`planning\` before implementation, implementation before \`qa\` and \`review\`).`,
    "2. **Use the Configured Specialists**: Delegate substantive implementation, investigation, or review to the matching specialist before doing that work yourself. For UI redesign with a configured `frontend` role, first delegate the visual design/review to that role; do not complete all UI work yourself and leave the assigned model unused. Trivial questions need no delegation. If delegation is unavailable or fails, report that specific limitation and continue the work you can verify without claiming a specialist participated.",
    "3. **Independent Verification & Session Continuation (负责人验收与追问续跑)**: Each specialist returns a structured receipt, summary, `runId`, and (after write tools) a workspace review/diff. Check it against your `acceptanceCriteria`; if it is incomplete or defective, fix it directly or pass `sessionId: \"<previous child runId>\"` (or `resumeRunId`) to `agent.delegate` to continue that exact specialist session with concrete defect feedback before delivering.",
    "4. **Unified Delivery**: You alone answer in the main conversation; specialists work in their own role sub-conversations. Synthesize their verified contributions into one coherent, high-quality response.",
  ].join("\n");
}

/** Same default as the lead: the Subagents Disabled rule is written unless `disableSubagents` is explicitly false. */
export function buildCouncilSpecialistInstructions(
  decision: AgentCouncilRouteDecision,
  acceptanceCriteria?: readonly string[],
  options?: { readonly disableSubagents?: boolean },
): string {
  const meta = ROLE_DESCRIPTIONS[normalizeAgentCouncilRoleId(decision.role) || "generalist"];
  const fallbackNote =
    decision.routeSource === "generalist_fallback"
      ? `Note: You are fulfilling the \`${decision.role}\` role via your \`generalist\` (杂活/其他) assignment.`
      : decision.routeSource === "random_fallback"
        ? `Note: You were assigned the \`${decision.role}\` task by lead fallback routing.`
        : "";
  const criteriaSection =
    acceptanceCriteria && acceptanceCriteria.length > 0
      ? [
          "",
          "### Acceptance Criteria (负责人验收标准)",
          ...acceptanceCriteria.map((item, idx) => `${idx + 1}. ${item}`),
        ]
      : [];

  return [
    `## Council Mode Specialist Assignment — ${meta.title}`,
    `- Assigned Role ID: \`${decision.role}\``,
    `- Assigned Slot: \`${decision.slotId}\` (\`${decision.modelLabel}\`)`,
    ...(fallbackNote ? [`- Routing Note: ${fallbackNote}`] : []),
    `- Role Boundary: ${meta.boundary}`,
    ...criteriaSection,
    "",
    "### Execution Rules",
    "1. Focus strictly on your assigned subtask and role boundary. Do not modify unrelated files or expand scope.",
    "2. Base every claim on verified code or tool output. When making code changes, verify them with targeted checks if tools permit.",
    "3. Conclude with a concise, structured deliverable summary stating: (a) what was analyzed or changed, (b) key file paths/symbols, and (c) how each acceptance criterion was satisfied.",
    // A specialist sees no slot roster, so its rule names no slots: it does the assigned role itself.
    ...(options?.disableSubagents !== false ? [
      "- **Subagents Disabled (已关闭子智能体)**: Do NOT create or spawn any subagents, background agents, or further delegations. Execute your assigned role directly and report your deliverable to the lead.",
    ] : []),
  ].join("\n");
}

/**
 * Node's crypto for the Council runtime (dispatch and invocation keys, which run in Node only). Not a static import:
 * the browser bundles this module, and an import made it ship a 2 MB crypto polyfill that it never calls.
 */
function nodeCrypto(): typeof import("node:crypto") {
  return process.getBuiltinModule("node:crypto");
}
