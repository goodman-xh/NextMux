import assert from "node:assert/strict";
import test from "node:test";

import {
  effectiveModelCapabilityEvidence,
  inferModelCapabilityEvidence,
  isChatModelListing,
  modelCapabilityHasVerifiedSupport,
  mergeModelCapabilityEvidence,
  modelCapabilitySupport,
  protocolSupportsReasoningEffort,
  type ModelCapabilityEvidence,
} from "../lib/index.js";

const observedAt = "2026-08-29T08:00:00.000Z";

test("reasoning effort controls require a transport with a verified effort mapping", () => {
  assert.equal(protocolSupportsReasoningEffort("openai_responses"), true);
  assert.equal(protocolSupportsReasoningEffort("anthropic_messages"), true);
  assert.equal(protocolSupportsReasoningEffort("gemini_generate_content"), true);
  assert.equal(protocolSupportsReasoningEffort("openai_chat_completions"), true);
  assert.equal(protocolSupportsReasoningEffort("cohere_chat"), true);
});

test("an own API's authenticated model list makes a listed chat model callable with tools", () => {
  const evidence = inferModelCapabilityEvidence({
    providerId: "custom_openai",
    protocol: "openai_chat_completions",
    model: "opaque-model-42",
    observedAt,
    discoveredByModelsEndpoint: true,
    toolCalling: "untested",
  });

  assert.equal(modelCapabilitySupport(evidence, "model:listed"), "supported");
  assert.equal(modelCapabilitySupport(evidence, "model:available"), "supported");
  assert.equal(modelCapabilityHasVerifiedSupport(evidence, "model:generatable"), true);
  assert.equal(modelCapabilityHasVerifiedSupport(evidence, "tools"), true);
  assert.equal(effectiveModelCapabilityEvidence(evidence, "model:generatable")?.source, "models_endpoint");
  assert.equal(effectiveModelCapabilityEvidence(evidence, "tools")?.source, "models_endpoint");
  // The list says nothing about modalities: text stays inferred, pictures unknown.
  assert.equal(effectiveModelCapabilityEvidence(evidence, "input:text")?.confidence, "inferred");
  assert.equal(modelCapabilitySupport(evidence, "input:image"), "unknown");
});

test("a listed picture, voice, embedding or utility model is listed but never authorized", () => {
  for (const model of ["gpt-image-1", "gpt-image-2.5-flare", "tts-1", "whisper-1", "text-embedding-3-small",
    "omni-moderation-latest", "codex-auto-review", "gpt-4o-realtime-preview", "babbage-002", "sora-2"]) {
    const evidence = inferModelCapabilityEvidence({
      providerId: "custom_openai",
      protocol: "openai_chat_completions",
      model,
      observedAt,
      discoveredByModelsEndpoint: true,
    });
    assert.equal(modelCapabilitySupport(evidence, "model:listed"), "supported", model);
    assert.equal(modelCapabilityHasVerifiedSupport(evidence, "model:generatable"), false, model);
    assert.equal(modelCapabilitySupport(evidence, "tools"), "unknown", model);
  }
  assert.deepEqual(["gpt-6.1-sol", "claude-sonnet-4.6", "qwen3-coder-next", "deepseek-v4.1-flash"].map(isChatModelListing), [true, true, true, true]);
  assert.equal(isChatModelListing({ id: "studio-model", outputModalities: ["image"] }), false, "a declared picture output wins over a chat-like name");
});

test("a catalog-only provider's list names no deployment the key can call", () => {
  for (const providerId of ["azure_openai", "bedrock"] as const) {
    const evidence = inferModelCapabilityEvidence({
      providerId,
      protocol: "openai_responses",
      model: "gpt-4o",
      observedAt,
      discoveredByModelsEndpoint: true,
    });
    assert.equal(modelCapabilityHasVerifiedSupport(evidence, "model:generatable"), false, providerId);
    assert.equal(modelCapabilitySupport(evidence, "tools"), "unknown", providerId);
  }
});

test("a failed tool probe or an unsupported generation declaration outranks the model list", () => {
  const failedTools = inferModelCapabilityEvidence({
    providerId: "custom_openai",
    protocol: "openai_chat_completions",
    model: "gpt-6-sol",
    observedAt,
    discoveredByModelsEndpoint: true,
    toolCalling: "failed",
  });
  assert.equal(modelCapabilitySupport(failedTools, "tools"), "unsupported");

  const listed = inferModelCapabilityEvidence({
    providerId: "custom_openai",
    protocol: "openai_chat_completions",
    model: "gpt-6-sol",
    observedAt,
    discoveredByModelsEndpoint: true,
  });
  const laterFailure: ModelCapabilityEvidence = { capability: "tools", support: "unsupported", confidence: "verified", source: "live_probe", observedAt };
  assert.equal(modelCapabilitySupport(mergeModelCapabilityEvidence(listed, [laterFailure]), "tools"), "unsupported");

  const embedOnly = inferModelCapabilityEvidence({
    providerId: "gemini",
    protocol: "gemini_generate_content",
    model: "gemini-chat",
    observedAt,
    discoveredByModelsEndpoint: true,
    interfaceSupport: "unsupported",
  });
  assert.equal(modelCapabilitySupport(embedOnly, "model:generatable"), "unsupported");
  assert.equal(modelCapabilityHasVerifiedSupport(embedOnly, "model:generatable"), false);
  assert.equal(modelCapabilitySupport(embedOnly, "tools"), "unknown");
});

test("provider metadata can declare generation support without pretending a live call succeeded", () => {
  const evidence = inferModelCapabilityEvidence({
    providerId: "gemini",
    protocol: "gemini_generate_content",
    model: "gemini-chat",
    observedAt,
    interfaceSupport: "supported",
  });

  assert.equal(modelCapabilitySupport(evidence, "model:generatable"), "supported");
  assert.equal(effectiveModelCapabilityEvidence(evidence, "model:generatable")?.confidence, "declared");
  assert.equal(effectiveModelCapabilityEvidence(evidence, "model:generatable")?.source, "provider_metadata");
  assert.equal(modelCapabilityHasVerifiedSupport(evidence, "model:generatable"), false);
});

test("one successful live capability probe verifies model availability separately from the directory", () => {
  const evidence = inferModelCapabilityEvidence({
    providerId: "custom_openai",
    protocol: "openai_chat_completions",
    model: "opaque-model-42",
    observedAt,
    connectionVerified: true,
  });

  assert.equal(modelCapabilitySupport(evidence, "model:listed"), "unknown");
  assert.equal(modelCapabilitySupport(evidence, "model:available"), "supported");
  assert.equal(modelCapabilitySupport(evidence, "model:generatable"), "supported");
  assert.equal(modelCapabilityHasVerifiedSupport(evidence, "model:generatable"), true);
  assert.equal(effectiveModelCapabilityEvidence(evidence, "model:generatable")?.source, "live_probe");
});

test("an unavailable directory cannot fabricate model support", () => {
  const evidence = inferModelCapabilityEvidence({
    providerId: "custom_openai",
    protocol: "openai_chat_completions",
    model: "unverified-model",
    observedAt,
  });

  assert.equal(modelCapabilitySupport(evidence, "model:listed"), "unknown");
  assert.equal(modelCapabilitySupport(evidence, "model:available"), "unknown");
  assert.equal(modelCapabilitySupport(evidence, "model:generatable"), "unknown");
  assert.equal(modelCapabilityHasVerifiedSupport(evidence, "model:generatable"), false);
});

test("native streaming transport does not invent a model streaming declaration", () => {
  const evidence = inferModelCapabilityEvidence({
    providerId: "cohere",
    protocol: "cohere_chat",
    model: "command-test",
    observedAt,
    connectionVerified: true,
  });

  assert.equal(modelCapabilitySupport(evidence, "streaming"), "unknown");
});

test("live tool probes override weaker heuristics", () => {
  const inferred = inferModelCapabilityEvidence({
    providerId: "custom_openai",
    protocol: "openai_chat_completions",
    model: "gpt-compatible",
    observedAt,
  });
  const verifiedFailure: ModelCapabilityEvidence = {
    capability: "tools",
    support: "unsupported",
    confidence: "verified",
    source: "live_probe",
    observedAt: "2026-08-29T08:01:00.000Z",
  };

  const merged = mergeModelCapabilityEvidence(inferred, [verifiedFailure]);
  assert.equal(modelCapabilitySupport(merged, "tools"), "unsupported");
  assert.deepEqual(effectiveModelCapabilityEvidence(merged, "tools"), verifiedFailure);
});

test("manual decisions outrank newer provider metadata at equal confidence", () => {
  const manual: ModelCapabilityEvidence = {
    capability: "input:image",
    support: "unsupported",
    confidence: "verified",
    source: "manual_override",
    observedAt,
  };
  const metadata: ModelCapabilityEvidence = {
    capability: "input:image",
    support: "supported",
    confidence: "verified",
    source: "provider_metadata",
    observedAt: "2026-08-29T09:00:00.000Z",
  };

  assert.deepEqual(effectiveModelCapabilityEvidence([metadata, manual], "input:image"), manual);
});

test("known multimodal families are inferred, never mislabeled as verified", () => {
  const evidence = inferModelCapabilityEvidence({
    providerId: "gemini",
    protocol: "gemini_generate_content",
    model: "gemini-test",
    observedAt,
  });

  assert.equal(modelCapabilitySupport(evidence, "input:image"), "supported");
  assert.equal(modelCapabilitySupport(evidence, "input:audio"), "supported");
  assert.equal(effectiveModelCapabilityEvidence(evidence, "input:image")?.confidence, "inferred");
});

test("provider-native Azure and Vertex identities keep their model modality evidence", () => {
  const azure = inferModelCapabilityEvidence({
    providerId: "azure_openai",
    protocol: "openai_responses",
    model: "gpt-4o-deployment",
    observedAt,
  });
  assert.equal(modelCapabilitySupport(azure, "input:image"), "supported");
  assert.equal(modelCapabilitySupport(azure, "input:pdf"), "supported");
  assert.equal(modelCapabilitySupport(azure, "reasoning"), "supported");

  const vertex = inferModelCapabilityEvidence({
    providerId: "vertex",
    protocol: "gemini_generate_content",
    model: "gemini-2.5-pro",
    observedAt,
  });
  for (const capability of ["input:image", "input:pdf", "input:audio", "input:video"] as const) {
    assert.equal(modelCapabilitySupport(vertex, capability), "supported", capability);
  }
});

test("repeated capability observations replace stale evidence from the same source", () => {
  const older: ModelCapabilityEvidence = {
    capability: "tools",
    support: "unsupported",
    confidence: "verified",
    source: "live_probe",
    observedAt: "2026-08-29T08:00:00.000Z",
  };
  const newer: ModelCapabilityEvidence = {
    ...older,
    support: "supported",
    observedAt: "2026-08-30T08:00:00.000Z",
  };

  const merged = mergeModelCapabilityEvidence(
    Array.from({ length: 80 }, (_, index) => ({
      ...older,
      observedAt: new Date(Date.parse(older.observedAt) + index * 1000).toISOString(),
    })),
    [newer],
  );

  assert.equal(merged.filter(item => item.capability === "tools" && item.source === "live_probe").length, 1);
  assert.deepEqual(effectiveModelCapabilityEvidence(merged, "tools"), newer);
});
