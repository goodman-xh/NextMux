import type {
  AgentModelMessage,
  AgentRunStopReason,
  AgentTokenBudget,
  AgentTokenBudgetSnapshot,
  AgentToolDescriptor,
} from "./types.js";
import { estimateAgentMediaTokens, type AgentTokenEstimateProfile } from "./media-token-estimate.js";
export { estimateAgentMediaTokens, normalizeAgentMediaMetadata, type AgentTokenEstimateProfile } from "./media-token-estimate.js";

/** Keep malformed host data from turning a budget into an unbounded number. */
export const MAX_AGENT_TOKEN_BUDGET = 10_000_000;
const MAX_AGENT_TOKEN_USAGE = 100_000_000;

function validLimit(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= MAX_AGENT_TOKEN_BUDGET;
}

/**
 * Normalize untrusted budget data without throwing. Callers that expose a
 * public API should turn an undefined result for a non-undefined input into a
 * domain-specific validation error.
 */
export function normalizeAgentTokenBudget(value: unknown): AgentTokenBudget | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const hasInput = candidate.maxInputTokens !== undefined;
  const hasOutput = candidate.maxOutputTokens !== undefined;
  if (!hasInput && !hasOutput) return undefined;
  if (hasInput && !validLimit(candidate.maxInputTokens)) return undefined;
  if (hasOutput && !validLimit(candidate.maxOutputTokens)) return undefined;
  return Object.freeze({
    ...(hasInput ? { maxInputTokens: candidate.maxInputTokens as number } : {}),
    ...(hasOutput ? { maxOutputTokens: candidate.maxOutputTokens as number } : {}),
  });
}

export function tokenBudgetSnapshot(
  budget: AgentTokenBudget | undefined,
  usage: { readonly inputTokens: number; readonly outputTokens: number },
  usageKnown: boolean,
): AgentTokenBudgetSnapshot | undefined {
  if (!budget) return undefined;
  const inputTokens = Math.max(0, Number.isSafeInteger(usage.inputTokens) ? usage.inputTokens : 0);
  const outputTokens = Math.max(0, Number.isSafeInteger(usage.outputTokens) ? usage.outputTokens : 0);
  return Object.freeze({
    ...(budget.maxInputTokens === undefined ? {} : {
      maxInputTokens: budget.maxInputTokens,
      remainingInputTokens: Math.max(0, budget.maxInputTokens - inputTokens),
    }),
    ...(budget.maxOutputTokens === undefined ? {} : {
      maxOutputTokens: budget.maxOutputTokens,
      remainingOutputTokens: Math.max(0, budget.maxOutputTokens - outputTokens),
    }),
    inputTokens,
    outputTokens,
    usageKnown,
  });
}

export function normalizeAgentTokenBudgetSnapshot(value: unknown): AgentTokenBudgetSnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const budget = normalizeAgentTokenBudget(candidate);
  if (!budget || !Number.isSafeInteger(candidate.inputTokens)
    || (candidate.inputTokens as number) < 0 || (candidate.inputTokens as number) > MAX_AGENT_TOKEN_USAGE
    || !Number.isSafeInteger(candidate.outputTokens)
    || (candidate.outputTokens as number) < 0 || (candidate.outputTokens as number) > MAX_AGENT_TOKEN_USAGE
    || typeof candidate.usageKnown !== "boolean") return undefined;
  return tokenBudgetSnapshot(budget, {
    inputTokens: candidate.inputTokens as number,
    outputTokens: candidate.outputTokens as number,
  }, candidate.usageKnown);
}

/** Returns the first terminal budget reason, if a cumulative ceiling is met. */
export function tokenBudgetLimitReason(
  budget: AgentTokenBudget | undefined,
  usage: { readonly inputTokens: number; readonly outputTokens: number },
): Extract<AgentRunStopReason, "input_token_limit_reached" | "output_token_limit_reached"> | undefined {
  if (budget?.maxInputTokens !== undefined && usage.inputTokens >= budget.maxInputTokens) {
    return "input_token_limit_reached";
  }
  if (budget?.maxOutputTokens !== undefined && usage.outputTokens >= budget.maxOutputTokens) {
    return "output_token_limit_reached";
  }
  return undefined;
}

function jsonBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value) ?? "").byteLength;
  } catch {
    // A model request is already validated elsewhere; this conservative value
    // ensures a custom non-serializable descriptor cannot bypass the preflight.
    return Number.MAX_SAFE_INTEGER;
  }
}

/**
 * Provider-neutral input estimate used only for pre-dispatch admission. Exact
 * billing remains the provider's usage field; the extra structural allowance
 * intentionally errs high for short/CJK prompts and tool schemas.
 */
export function estimateAgentModelInputTokens(
  instructions: string | undefined,
  messages: readonly AgentModelMessage[],
  tools: readonly AgentToolDescriptor[],
  profile: AgentTokenEstimateProfile = {},
): number {
  let mediaTokens = 0;
  const textMessages = messages.map(message => ({
    ...message,
    ...(message.attachments ? { attachments: message.attachments.map(attachment => {
      if (attachment.kind === 'text') return attachment;
      mediaTokens += estimateAgentMediaTokens(attachment.mimeType, attachment.dataBase64, attachment.media, profile);
      return { kind: attachment.kind, name: attachment.name, mimeType: attachment.mimeType };
    }) } : {}),
    ...(message.outputParts ? { outputParts: message.outputParts.map(part => {
      if (part.type === 'text') return part;
      mediaTokens += estimateAgentMediaTokens(part.asset.mimeType, undefined, undefined, profile);
      return { type: part.type, mimeType: part.asset.mimeType };
    }) } : {}),
  }));
  const bytes = jsonBytes({ instructions: instructions ?? "", messages: textMessages, tools });
  if (bytes === Number.MAX_SAFE_INTEGER) return bytes;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, Math.ceil(bytes / 3) + messages.length * 4 + tools.length * 8 + mediaTokens));
}

/** Every generated per-request ceiling obeys all known hard limits, including automatic mode. */
export function requestOutputTokenLimit(input: {
  readonly contextWindowTokens?: number;
  readonly estimatedInputTokens: number;
  readonly modelOutputTokenLimit?: number;
  readonly remainingOutputTokens?: number;
}): number | undefined {
  const limits = [input.modelOutputTokenLimit, input.remainingOutputTokens,
    input.contextWindowTokens === undefined ? undefined : input.contextWindowTokens - input.estimatedInputTokens]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return limits.length ? Math.max(0, Math.floor(Math.min(...limits))) : undefined;
}
