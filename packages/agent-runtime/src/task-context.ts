import { AgentToolError } from "./errors.js";
import type {
  AgentContextMemoryKind,
  AgentContextMemoryItem,
  AgentPermissionMode,
  AgentTaskContext,
} from "./types.js";

const MAX_GOAL_CHARACTERS = 20_000;
const MAX_PARENT_GOAL_CHARACTERS = 20_000;
const MAX_WORKSPACE_CHARACTERS = 4_096;
const MAX_CONVERSATION_ID_CHARACTERS = 300;
const WORKBENCH = /^[a-z][a-z0-9_-]{0,31}$/;
const MAX_CONSTRAINTS = 16;
const MAX_CONSTRAINT_CHARACTERS = 600;
const MAX_RELEVANT_PATHS = 64;
const MAX_PATH_CHARACTERS = 1_000;
const MAX_RECENT_OPERATIONS = 12;
const MAX_OPERATION_CHARACTERS = 700;
const MAX_TOOLS = 8192;
const MAX_IDENTIFIER_CHARACTERS = 180;
const MAX_LOCALE_CHARACTERS = 32;
const MAX_MODEL_ID_CHARACTERS = 240;
const MAX_SELECTED_MEMORY_ITEMS = 16;
const MAX_MEMORY_ID_CHARACTERS = 240;
const MAX_MEMORY_REF_CHARACTERS = 2_000;
const MAX_MEMORY_TEXT_CHARACTERS = 4_000;
const MAX_SELECTED_MEMORY_CHARACTERS = 24_000;

const memoryKinds: readonly AgentContextMemoryKind[] = ["summary", "file_ref", "checkpoint_ref", "message_ref"];

/** Input form for explicitly selecting bounded context for a delegated run. */
export interface AgentTaskContextMemoryInput {
  readonly id: string;
  readonly kind: AgentContextMemoryKind;
  readonly text?: string;
  readonly ref?: string;
  readonly sourceRunId?: string;
  readonly maxCharacters?: number;
}

export interface AgentTaskContextInput {
  readonly workspaceRoot?: string;
  readonly conversationId?: string;
  readonly workbench?: string;
  readonly goal: string;
  readonly parentGoal?: string;
  readonly constraints?: readonly string[];
  readonly relevantPaths?: readonly string[];
  readonly recentOperations?: readonly string[];
  readonly recentOperationsCanonical?: true;
  readonly parentRunId?: string;
  readonly rootRunId?: string;
  readonly depth?: number;
  readonly permissionMode?: AgentPermissionMode;
  readonly allowedToolNames?: readonly string[];
  readonly modelId?: string;
  readonly locale?: string;
  /** Explicit context excerpts/references; the parent transcript is never inferred. */
  readonly selectedMemory?: readonly AgentTaskContextMemoryInput[];
}

const permissionModes: readonly AgentPermissionMode[] = ["read_only", "workspace_write", "full_access"];

function compact(value: string, maximum: number): string {
  return value.replace(/[\u0000\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function optionalIdentifier(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new AgentToolError("INVALID_TASK_CONTEXT", `${name} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_IDENTIFIER_CHARACTERS
    || !/^[A-Za-z0-9._:-]+$/.test(normalized)) {
    throw new AgentToolError("INVALID_TASK_CONTEXT", `${name} is invalid`);
  }
  return normalized;
}

function stringList(
  value: readonly string[] | undefined,
  maximumItems: number,
  maximumCharacters: number,
  name: string,
): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new AgentToolError("INVALID_TASK_CONTEXT", `${name} contains too many entries`);
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") throw new AgentToolError("INVALID_TASK_CONTEXT", `${name} contains a non-string entry`);
    const normalized = compact(item, maximumCharacters);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function toolList(value: readonly string[] | undefined): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_TOOLS) {
    throw new AgentToolError("INVALID_TASK_CONTEXT", "allowedToolNames contains too many entries");
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/.test(item)) {
      throw new AgentToolError("INVALID_TASK_CONTEXT", "allowedToolNames contains an invalid tool name");
    }
    if (!seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}

function memoryIdentifier(value: unknown, name: string): string {
  if (typeof value !== "string") throw new AgentToolError("INVALID_TASK_CONTEXT", `${name} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_MEMORY_ID_CHARACTERS
    || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(normalized)) {
    throw new AgentToolError("INVALID_TASK_CONTEXT", `${name} is invalid`);
  }
  return normalized;
}

function memoryText(value: unknown, maximum: number, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new AgentToolError("INVALID_TASK_CONTEXT", `${name} must be a string`);
  const normalized = compact(value, maximum);
  if (!normalized) throw new AgentToolError("INVALID_TASK_CONTEXT", `${name} cannot be empty`);
  // Context may originate from model/tool output.  Never carry credentials
  // into a child prompt even when the caller selected the excerpt explicitly.
  return normalized
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, "Bearer [redacted]")
    .slice(0, maximum);
}

function memoryItems(value: readonly AgentTaskContextMemoryInput[] | undefined): readonly AgentContextMemoryItem[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_SELECTED_MEMORY_ITEMS) {
    throw new AgentToolError("INVALID_TASK_CONTEXT", "selectedMemory contains too many entries");
  }
  const result: AgentContextMemoryItem[] = [];
  const seen = new Set<string>();
  let totalCharacters = 0;
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new AgentToolError("INVALID_TASK_CONTEXT", "selectedMemory contains an invalid entry");
    }
    const candidate = item as AgentTaskContextMemoryInput;
    const id = memoryIdentifier(candidate.id, "selectedMemory.id");
    if (!memoryKinds.includes(candidate.kind)) {
      throw new AgentToolError("INVALID_TASK_CONTEXT", "selectedMemory.kind is invalid");
    }
    const maxCharacters = candidate.maxCharacters === undefined ? 2_000 : candidate.maxCharacters;
    if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1 || maxCharacters > MAX_MEMORY_TEXT_CHARACTERS) {
      throw new AgentToolError("INVALID_TASK_CONTEXT", "selectedMemory.maxCharacters is invalid");
    }
    const text = memoryText(candidate.text, maxCharacters, "selectedMemory.text");
    const ref = candidate.ref === undefined
      ? undefined
      : memoryText(candidate.ref, MAX_MEMORY_REF_CHARACTERS, "selectedMemory.ref");
    if (!text && !ref) throw new AgentToolError("INVALID_TASK_CONTEXT", "selectedMemory requires text or ref");
    const sourceRunId = candidate.sourceRunId === undefined
      ? undefined : memoryIdentifier(candidate.sourceRunId, "selectedMemory.sourceRunId");
    const key = `${candidate.kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    totalCharacters += (text?.length ?? 0) + (ref?.length ?? 0);
    if (totalCharacters > MAX_SELECTED_MEMORY_CHARACTERS) {
      throw new AgentToolError("INVALID_TASK_CONTEXT", "selectedMemory exceeds the context size limit");
    }
    result.push({
      id,
      kind: candidate.kind,
      ...(text ? { text } : {}),
      ...(ref ? { ref } : {}),
      ...(sourceRunId ? { sourceRunId } : {}),
      maxCharacters,
    });
  }
  return result;
}

function boundedDepth(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || value < 0 || value > 4) {
    throw new AgentToolError("INVALID_TASK_CONTEXT", "depth must be between 0 and 4");
  }
  return value;
}

/** Validate and normalize a compact context received from a host or checkpoint. */
export function validateAgentTaskContext(value: unknown): AgentTaskContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentToolError("INVALID_TASK_CONTEXT", "Agent task context must be an object");
  }
  const candidate = value as Partial<AgentTaskContext>;
  if (candidate.version !== 1) throw new AgentToolError("INVALID_TASK_CONTEXT", "Agent task context version is unsupported");
  if (typeof candidate.workspaceRoot !== "string" || candidate.workspaceRoot.length > MAX_WORKSPACE_CHARACTERS
    || candidate.workspaceRoot.includes("\0")) {
    throw new AgentToolError("INVALID_TASK_CONTEXT", "workspaceRoot is invalid");
  }
  if (typeof candidate.goal !== "string") throw new AgentToolError("INVALID_TASK_CONTEXT", "goal is required");
  const goal = compact(candidate.goal, MAX_GOAL_CHARACTERS);
  if (!goal) throw new AgentToolError("INVALID_TASK_CONTEXT", "goal is required");
  const conversationId = candidate.conversationId === undefined
    ? undefined
    : typeof candidate.conversationId === "string"
      ? compact(candidate.conversationId, MAX_CONVERSATION_ID_CHARACTERS)
      : "";
  if (candidate.conversationId !== undefined && !conversationId) {
    throw new AgentToolError("INVALID_TASK_CONTEXT", "conversationId is invalid");
  }
  if (candidate.workbench !== undefined && (typeof candidate.workbench !== "string" || !WORKBENCH.test(candidate.workbench))) {
    throw new AgentToolError("INVALID_TASK_CONTEXT", "workbench is invalid");
  }
  const parentGoal = candidate.parentGoal === undefined
    ? undefined
    : typeof candidate.parentGoal === "string"
      ? compact(candidate.parentGoal, MAX_PARENT_GOAL_CHARACTERS)
      : "";
  if (candidate.parentGoal !== undefined && !parentGoal) {
    throw new AgentToolError("INVALID_TASK_CONTEXT", "parentGoal is invalid");
  }
  const modelId = candidate.modelId === undefined
    ? undefined
    : typeof candidate.modelId === "string"
      ? compact(candidate.modelId, MAX_MODEL_ID_CHARACTERS)
      : "";
  const locale = candidate.locale === undefined
    ? undefined
    : typeof candidate.locale === "string"
      ? compact(candidate.locale, MAX_LOCALE_CHARACTERS)
      : "";
  if (candidate.modelId !== undefined && !modelId || candidate.locale !== undefined && !locale) {
    throw new AgentToolError("INVALID_TASK_CONTEXT", "modelId or locale is invalid");
  }
  const permissionMode = candidate.permissionMode ?? "read_only";
  if (!permissionModes.includes(permissionMode)) throw new AgentToolError("INVALID_TASK_CONTEXT", "permissionMode is invalid");
  const selectedMemory = memoryItems(candidate.selectedMemory);
  return Object.freeze({
    version: 1 as const,
    workspaceRoot: candidate.workspaceRoot,
    ...(conversationId ? { conversationId } : {}),
    ...(candidate.workbench ? { workbench: candidate.workbench } : {}),
    goal,
    ...(parentGoal ? { parentGoal } : {}),
    constraints: Object.freeze([...stringList(candidate.constraints, MAX_CONSTRAINTS, MAX_CONSTRAINT_CHARACTERS, "constraints")]),
    relevantPaths: Object.freeze([...stringList(candidate.relevantPaths, MAX_RELEVANT_PATHS, MAX_PATH_CHARACTERS, "relevantPaths")]),
    recentOperations: Object.freeze([...stringList(candidate.recentOperations, MAX_RECENT_OPERATIONS, MAX_OPERATION_CHARACTERS, "recentOperations")]),
    ...(candidate.recentOperationsCanonical === true ? { recentOperationsCanonical: true as const } : {}),
    ...(optionalIdentifier(candidate.parentRunId, "parentRunId") ? { parentRunId: optionalIdentifier(candidate.parentRunId, "parentRunId") } : {}),
    ...(optionalIdentifier(candidate.rootRunId, "rootRunId") ? { rootRunId: optionalIdentifier(candidate.rootRunId, "rootRunId") } : {}),
    depth: boundedDepth(candidate.depth),
    permissionMode,
    allowedToolNames: Object.freeze([...toolList(candidate.allowedToolNames)]),
    ...(modelId ? { modelId } : {}),
    ...(locale ? { locale } : {}),
    selectedMemory: Object.freeze(selectedMemory.map(item => Object.freeze(item))),
  });
}

/** Build a normalized root or child context from host-owned fields. */
export function createAgentTaskContext(input: AgentTaskContextInput): AgentTaskContext {
  return validateAgentTaskContext({
    version: 1,
    workspaceRoot: input.workspaceRoot || "",
    goal: input.goal,
    ...(input.conversationId === undefined ? {} : { conversationId: input.conversationId }),
    ...(input.workbench === undefined ? {} : { workbench: input.workbench }),
    ...(input.parentGoal === undefined ? {} : { parentGoal: input.parentGoal }),
    ...(input.constraints === undefined ? {} : { constraints: input.constraints }),
    ...(input.relevantPaths === undefined ? {} : { relevantPaths: input.relevantPaths }),
    ...(input.recentOperations === undefined ? {} : { recentOperations: input.recentOperations }),
    ...(input.recentOperationsCanonical === true ? { recentOperationsCanonical: true as const } : {}),
    ...(input.parentRunId === undefined ? {} : { parentRunId: input.parentRunId }),
    ...(input.rootRunId === undefined ? {} : { rootRunId: input.rootRunId }),
    ...(input.depth === undefined ? {} : { depth: input.depth }),
    ...(input.permissionMode === undefined ? {} : { permissionMode: input.permissionMode }),
    ...(input.allowedToolNames === undefined ? {} : { allowedToolNames: input.allowedToolNames }),
    ...(input.modelId === undefined ? {} : { modelId: input.modelId }),
    ...(input.locale === undefined ? {} : { locale: input.locale }),
    ...(input.selectedMemory === undefined ? {} : { selectedMemory: input.selectedMemory }),
  });
}

/** Derive a child context while retaining the parent's project boundary. */
export function childAgentTaskContext(
  parent: AgentTaskContext | undefined,
  input: AgentTaskContextInput,
): AgentTaskContext {
  return createAgentTaskContext({
    workspaceRoot: input.workspaceRoot ?? parent?.workspaceRoot ?? "",
    conversationId: input.conversationId ?? parent?.conversationId,
    workbench: input.workbench ?? parent?.workbench,
    goal: input.goal,
    parentGoal: input.parentGoal ?? parent?.parentGoal ?? parent?.goal,
    constraints: input.constraints ?? parent?.constraints,
    relevantPaths: input.relevantPaths ?? parent?.relevantPaths,
    recentOperations: input.recentOperations ?? parent?.recentOperations,
    recentOperationsCanonical: input.recentOperations === undefined ? parent?.recentOperationsCanonical : input.recentOperationsCanonical,
    parentRunId: input.parentRunId,
    rootRunId: input.rootRunId ?? parent?.rootRunId,
    depth: input.depth ?? ((parent?.depth ?? 0) + 1),
    permissionMode: input.permissionMode ?? parent?.permissionMode,
    allowedToolNames: input.allowedToolNames ?? parent?.allowedToolNames,
    modelId: input.modelId ?? parent?.modelId,
    locale: input.locale ?? parent?.locale,
    selectedMemory: input.selectedMemory ?? parent?.selectedMemory,
  });
}

/** Add one bounded operation to the child-visible operational memory. */
export function recordAgentTaskOperation(
  context: AgentTaskContext,
  operation: string,
): AgentTaskContext {
  return createAgentTaskContext({
    ...context,
    recentOperations: [...(context.recentOperationsCanonical ? context.recentOperations : []), operation].slice(-MAX_RECENT_OPERATIONS),
    recentOperationsCanonical: true,
    selectedMemory: context.selectedMemory,
  });
}

function contextLine(label: string, value: string): string {
  return `${label}: ${value || "(none)"}`;
}

/**
 * Render context as a short, clearly delimited system instruction.  The
 * transcript is intentionally not included; only bounded operational facts
 * are sent to the child model.
 */
export function agentTaskContextInstruction(context: AgentTaskContext): string {
  const normalized = validateAgentTaskContext(context);
  const lines = [
    "<nextmux-task-context>",
    "This is compact runtime context, not a copied conversation transcript.",
    contextLine("application", "NextMux"),
    ...(normalized.workbench ? [contextLine("workbench", normalized.workbench)] : []),
    contextLine("workspaceRoot", normalized.workspaceRoot),
    contextLine("conversationId", normalized.conversationId || "(projectless or unavailable)"),
    contextLine("platform", process.platform),
    contextLine("arch", process.arch),
    ...(normalized.parentGoal ? [contextLine("parentGoal", normalized.parentGoal)] : []),
    contextLine("goal", normalized.goal),
    contextLine("permissionMode", normalized.permissionMode),
    contextLine("allowedTools", normalized.allowedToolNames.slice(0, 48).join(", ")
      + (normalized.allowedToolNames.length > 48 ? `; ${normalized.allowedToolNames.length - 48} more authorized tools; use tool.search to discover connected tools.` : "")),
    contextLine("relevantPaths", normalized.relevantPaths.join("; ")),
    contextLine("constraints", normalized.constraints.join("; ")),
    contextLine("recentOperations", normalized.recentOperationsCanonical ? normalized.recentOperations.join("; ") : ""),
    ...(normalized.selectedMemory.length ? [
      "selectedMemory (explicit bounded items only):",
      ...normalized.selectedMemory.map(item => [
        `- ${item.kind}:${item.id}`,
        ...(item.ref ? [`  ref: ${item.ref}`] : []),
        ...(item.text ? [`  excerpt: ${item.text}`] : []),
        ...(item.sourceRunId ? [`  sourceRunId: ${item.sourceRunId}`] : []),
      ].join("\n")),
    ] : []),
    normalized.parentRunId ? contextLine("parentRunId", normalized.parentRunId) : "",
    normalized.rootRunId ? contextLine("rootRunId", normalized.rootRunId) : "",
    "Use this boundary to choose tools efficiently. When the user asks for the current conversation ID, workspace path, workbench or host application, give the exact conversationId, workspaceRoot, workbench and application values from this block. Do not claim work that is not verified.",
    "</nextmux-task-context>",
  ].filter(Boolean);
  return lines.join("\n").slice(0, 12_000);
}
