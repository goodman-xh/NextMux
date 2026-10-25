import assert from "node:assert/strict";
import test from "node:test";

import { isReasoningOptionKey, isReasoningOptionRejection, reasoningEvidenceState, reasoningOptionKey } from "../lib/index.js";

test("a request's thinking option has one stable key", () => {
  assert.equal(reasoningOptionKey({ reasoningEffort: "high" }), "effort:high");
  assert.equal(reasoningOptionKey({ reasoningEffort: "medium", reasoningEnabled: false }), "enabled:false", "turning thinking off wins over a default effort");
  assert.equal(reasoningOptionKey({ reasoningEnabled: true }), "enabled:true");
  assert.equal(reasoningOptionKey({ reasoningMode: "adaptive", reasoningEffort: "high" }), "mode:adaptive");
  assert.equal(reasoningOptionKey({ reasoningBudgetTokens: 8192 }), "budget:8192");
  assert.equal(reasoningOptionKey({ reasoningEffort: null }), "");
  assert.equal(reasoningOptionKey({ reasoningEffort: "HIGH; DROP" }), "");
  assert.equal(reasoningOptionKey(undefined), "");
  for (const key of ["effort:high", "enabled:false", "mode:adaptive", "budget:8192"]) assert.equal(isReasoningOptionKey(key), true, key);
  for (const key of ["", "effort:", "effort:High", "budget:-1", "mode:on", "x:y"]) assert.equal(isReasoningOptionKey(key), false, key);
});

const rejected = (detail: string, extra: Record<string, unknown> = {}) => ({ kind: "invalid_request" as const, httpStatus: 400, detail, ...extra });

test("refusals that name a thinking parameter mark the option unsupported", () => {
  for (const detail of [
    "Unsupported parameter: 'reasoning_effort' is not supported with this model.",
    "Unrecognized request argument supplied: reasoning_effort",
    "thinking: Extra inputs are not permitted",
    "1 validation error for ChatCompletionRequest\nreasoning_effort\n  Extra inputs are not permitted",
    "Invalid JSON payload received. Unknown name \"thinkingConfig\" at 'generation_config': Cannot find field.",
    "Thinking level is not supported for this model.",
    "parameter.enable_thinking must be set to false for non-streaming calls",
    "Invalid value: 'minimal'. Supported values are: 'low', 'medium', and 'high'. (reasoning.effort)",
    "该模型不支持 reasoning_effort 参数",
  ]) assert.equal(isReasoningOptionRejection(rejected(detail)), true, detail);
  assert.equal(isReasoningOptionRejection(rejected("Invalid value: 'minimal'.", { parameter: "reasoning_effort" })), true, "structured param");
});

test("thinking replay, context and unrelated 400s never blame the chosen option", () => {
  for (const detail of [
    "Missing `reasoning_content` field in the assistant message at message index 1.",
    "messages.1.content.0.type: Expected `thinking` or `redacted_thinking`, but found `text`. When `thinking` is enabled, a final `assistant` message must start with a thinking block.",
    "This model's maximum context length is 131072 tokens.",
    "Invalid 'messages[2].content': string too long.",
    "The reasoning behind this request is not supported by policy",
    "tools: Extra inputs are not permitted",
  ]) assert.equal(isReasoningOptionRejection(rejected(detail)), false, detail);
  assert.equal(isReasoningOptionRejection({ kind: "rate_limited", httpStatus: 429, detail: "reasoning_effort is not supported" }), false, "only request refusals count");
  assert.equal(isReasoningOptionRejection(undefined), false);
});

test("a later acceptance clears a rejection; thinking seen proves the option", () => {
  assert.equal(reasoningEvidenceState({ accepted: 3, rejected: 1, reasoningSeen: 0, lastOutcome: "rejected" }), "rejected");
  assert.equal(reasoningEvidenceState({ accepted: 3, rejected: 1, reasoningSeen: 0, lastOutcome: "accepted" }), "accepted");
  assert.equal(reasoningEvidenceState({ accepted: 3, rejected: 0, reasoningSeen: 2, lastOutcome: "accepted" }), "verified");
  assert.equal(reasoningEvidenceState(undefined), undefined);
});
