/**
 * Thinking-depth evidence: which thinking options one API actually accepts for one model.
 *
 * Provider metadata only says what an API claims. Real requests say what it does: an option the
 * upstream rejected by name must not be offered again, and an option that produced thinking is proven.
 * The platform keeps this per merchant API (shared by every user) and the desktop keeps it per own API
 * (on that computer only); both key it by the same option string.
 */

import type { ReadableModelError } from "./errors.js";

export interface ReasoningOptionRequest {
  readonly reasoningEffort?: string | null;
  readonly reasoningEnabled?: boolean;
  readonly reasoningMode?: string;
  readonly reasoningBudgetTokens?: number;
}

/** `verified`: thinking came back; `accepted`: the API took the option; `rejected`: the API refused it by name. */
export type ReasoningEvidenceState = "verified" | "accepted" | "rejected";

export interface ReasoningEvidenceCounts {
  readonly accepted: number;
  readonly rejected: number;
  readonly reasoningSeen: number;
  readonly lastOutcome: "accepted" | "rejected";
}

/**
 * The one thinking option a request asked for, as a stable key ("" when it asked for none).
 * Turning thinking off wins over a default effort sent alongside it.
 */
export function reasoningOptionKey(request: ReasoningOptionRequest | undefined | null): string {
  if (!request) return "";
  if (request.reasoningMode === "adaptive" || request.reasoningMode === "enabled" || request.reasoningMode === "disabled") return `mode:${request.reasoningMode}`;
  if (request.reasoningEnabled === false) return "enabled:false";
  if (typeof request.reasoningEffort === "string" && /^[a-z]{1,16}$/.test(request.reasoningEffort)) return `effort:${request.reasoningEffort}`;
  if (request.reasoningEnabled === true) return "enabled:true";
  const budget = request.reasoningBudgetTokens;
  if (typeof budget === "number" && Number.isSafeInteger(budget) && budget >= 0) return `budget:${budget}`;
  return "";
}

export function isReasoningOptionKey(value: unknown): value is string {
  return typeof value === "string" && /^(?:mode:(?:adaptive|enabled|disabled)|enabled:(?:true|false)|effort:[a-z]{1,16}|budget:\d{1,10})$/.test(value);
}

// Request parameter names that carry a thinking option, as providers echo them in 400 errors.
const PARAMETER_NAME = /(?:reasoning_effort|reasoning\.(?:effort|max_tokens|enabled|exclude)|include_reasoning|enable_thinking|thinking_budget|thinkingbudget|thinking_config|thinkingconfig|thinking_?level|thinking level|thinking\.(?:type|budget_tokens)|budget_tokens|output_config\.effort)/i;
// The bare names count only as a quoted/labelled parameter, never as prose.
const BARE_PARAMETER = /(?:["'`](?:reasoning|thinking|effort)["'`]|(?:^|[\s,;])(?:reasoning|thinking|effort)\s*[:：](?!\/))/i;
// The parameter itself (or its value) is refused.
const REFUSED = /(?:not supported|unsupported|does not support|doesn't support|extra (?:inputs|fields)|not permitted|not allowed|unrecogni[sz]ed|unknown (?:name|parameter|field|argument)|cannot find field|invalid value|supported values|must be one of|must be set to|is not available|不支持|不允许|无效)/i;
// Replaying an earlier turn's thinking is a continuity problem, not the chosen option.
const CONTINUITY = /(?:reasoning_content|reasoning_details|redacted_thinking|thinking block|thinking blocks|must start with|signature)/i;

/** A 400/422 that refuses a thinking parameter by name: this API does not accept the option that was sent. */
export function isReasoningOptionRejection(error: Pick<ReadableModelError, "kind" | "httpStatus" | "detail" | "parameter"> | undefined | null): boolean {
  if (!error) return false;
  if (error.kind !== "invalid_request" && error.httpStatus !== 400 && error.httpStatus !== 422) return false;
  if (error.parameter && (PARAMETER_NAME.test(error.parameter) || /^(?:reasoning|thinking|effort)$/i.test(error.parameter))) return true;
  const detail = String(error.detail || "").slice(0, 4_000);
  if (!detail || CONTINUITY.test(detail)) return false;
  return (PARAMETER_NAME.test(detail) || BARE_PARAMETER.test(detail)) && REFUSED.test(detail);
}

/** One option's standing on one API. A later acceptance clears an earlier rejection. */
export function reasoningEvidenceState(counts: ReasoningEvidenceCounts | undefined): ReasoningEvidenceState | undefined {
  if (!counts) return undefined;
  if (counts.lastOutcome === "rejected" && counts.rejected > 0) return "rejected";
  if (counts.reasoningSeen > 0) return "verified";
  return counts.accepted > 0 ? "accepted" : undefined;
}
