import type { OfficialProviderId, OfficialProviderProtocol } from "./presets.js";
import { modelPrimaryCategory } from "./model-taxonomy.js";
export { isPlainTextAttachmentMime, COHERE_TEXT_FILE_MAX_BYTES, COHERE_TEXT_FILE_MAX_CHARACTERS } from "./attachment-formats.js";

export type ModelCapability =
  | "model:available"
  | "model:listed"
  | "model:generatable"
  | "input:text"
  | "input:image"
  | "input:pdf"
  | "input:audio"
  | "input:video"
  | "output:text"
  | "output:image"
  | "output:audio"
  | "output:video"
  | "tools"
  | "reasoning"
  | "streaming";

export type ModelCapabilitySupport = "supported" | "unsupported" | "unknown";
export type ModelCapabilityConfidence = "verified" | "declared" | "inferred" | "unknown";
export type ModelCapabilitySource =
  | "manual_override"
  | "live_probe"
  | "provider_metadata"
  | "merchant_declaration"
  | "models_endpoint"
  | "model_heuristic";

export interface ModelCapabilityEvidence {
  readonly capability: ModelCapability;
  readonly support: ModelCapabilitySupport;
  readonly confidence: ModelCapabilityConfidence;
  readonly source: ModelCapabilitySource;
  readonly observedAt: string;
}

export interface InferModelCapabilityEvidenceOptions {
  readonly providerId: OfficialProviderId;
  readonly protocol: OfficialProviderProtocol;
  readonly model: string;
  readonly observedAt: string;
  readonly connectionVerified?: boolean;
  readonly toolCalling?: "verified" | "failed" | "untested";
  /**
   * The model came back from the connection's own authenticated /models list. For a chat model on a provider
   * whose list names callable models, that list is the availability evidence (see inferModelCapabilityEvidence).
   * It never establishes input or output modalities.
   */
  readonly discoveredByModelsEndpoint?: boolean;
  /** Explicit generation-method metadata, not a live generation result. */
  readonly interfaceSupport?: "supported" | "unsupported" | "unknown";
}

/**
 * Whether a stable transport adapter has a verified mapping for user-selected
 * reasoning effort. A model may reason internally while its current protocol
 * still has no portable/safe effort field; the UI must not conflate the two.
 */
export function protocolSupportsReasoningEffort(protocol: OfficialProviderProtocol): boolean {
  return protocol === "openai_responses"
    || protocol === "openai_chat_completions"
    || protocol === "anthropic_messages"
    || protocol === "gemini_generate_content"
    || protocol === "cohere_chat";
}

const confidenceWeight: Readonly<Record<ModelCapabilityConfidence, number>> = {
  verified: 4,
  declared: 3,
  inferred: 2,
  unknown: 1,
};

const sourceWeight: Readonly<Record<ModelCapabilitySource, number>> = {
  manual_override: 6,
  live_probe: 5,
  provider_metadata: 4,
  merchant_declaration: 3,
  models_endpoint: 2,
  model_heuristic: 1,
};

export function isModelCapabilityEvidence(value: unknown): value is ModelCapabilityEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<ModelCapabilityEvidence>;
  return typeof item.capability === "string" && [
    "model:available", "model:listed", "model:generatable",
    "input:text", "input:image", "input:pdf", "input:audio", "input:video",
    "output:text", "output:image", "output:audio", "output:video", "tools", "reasoning", "streaming",
  ].includes(item.capability)
    && (item.support === "supported" || item.support === "unsupported" || item.support === "unknown")
    && (item.confidence === "verified" || item.confidence === "declared"
      || item.confidence === "inferred" || item.confidence === "unknown")
    && (item.source === "manual_override" || item.source === "live_probe"
      || item.source === "provider_metadata" || item.source === "merchant_declaration"
      || item.source === "models_endpoint" || item.source === "model_heuristic")
    && typeof item.observedAt === "string" && item.observedAt.length <= 40
    && Number.isFinite(Date.parse(item.observedAt));
}

/**
 * Returns the strongest evidence for one capability. A newer weak heuristic
 * never overrides a verified probe or an explicit manual decision.
 */
export function effectiveModelCapabilityEvidence(
  evidence: readonly ModelCapabilityEvidence[],
  capability: ModelCapability,
): ModelCapabilityEvidence | undefined {
  return evidence
    .filter(item => item.capability === capability)
    .sort((left, right) =>
      confidenceWeight[right.confidence] - confidenceWeight[left.confidence]
      || sourceWeight[right.source] - sourceWeight[left.source]
      || Date.parse(right.observedAt) - Date.parse(left.observedAt))[0];
}

export function modelCapabilitySupport(
  evidence: readonly ModelCapabilityEvidence[],
  capability: ModelCapability,
): ModelCapabilitySupport {
  return effectiveModelCapabilityEvidence(evidence, capability)?.support ?? "unknown";
}

/**
 * Capability gates must require verified evidence. A provider declaration or
 * heuristic may inform the picker, but cannot authorize a route. A connection's
 * own authenticated model list can (inferModelCapabilityEvidence).
 */
export function modelCapabilityHasVerifiedSupport(
  evidence: readonly ModelCapabilityEvidence[],
  capability: ModelCapability,
): boolean {
  const effective = effectiveModelCapabilityEvidence(evidence, capability);
  return effective?.support === "supported" && effective.confidence === "verified";
}

export function mergeModelCapabilityEvidence(
  ...groups: readonly (readonly ModelCapabilityEvidence[])[]
): readonly ModelCapabilityEvidence[] {
  const unique = new Map<string, ModelCapabilityEvidence>();
  for (const item of groups.flat()) {
    if (!isModelCapabilityEvidence(item)) continue;
    // One source represents its latest observation for a capability. Keeping
    // every timestamp made routine refreshes grow the local connection index
    // without bound and could eventually hide every saved connection.
    const key = [item.capability, item.source].join("\0");
    const previous = unique.get(key);
    if (!previous || Date.parse(item.observedAt) >= Date.parse(previous.observedAt)) {
      unique.set(key, item);
    }
  }
  return [...unique.values()].sort((left, right) => left.capability.localeCompare(right.capability)
    || sourceWeight[right.source] - sourceWeight[left.source]
    || Date.parse(right.observedAt) - Date.parse(left.observedAt));
}

function evidence(
  capability: ModelCapability,
  support: ModelCapabilitySupport,
  confidence: ModelCapabilityConfidence,
  source: ModelCapabilitySource,
  observedAt: string,
): ModelCapabilityEvidence {
  return { capability, support, confidence, source, observedAt };
}

/**
 * Utility models an OpenAI-style /models list returns beside its chat models that no chat request can use:
 * moderation and safety classifiers, realtime voice sessions, automatic review agents and the legacy
 * completions-only base models.
 */
const NON_CHAT_LISTING = /moderation|(?:^|[/_.-])guard(?:$|[/_.-])|realtime|auto-review|(?:^|[/_-])(?:babbage|davinci)-\d/;

/**
 * Whether a /models entry (a discovered row or a bare id) is a language model a chat request can use. Picture,
 * video, voice, music, transcription, embedding and reranking models (model-taxonomy.ts) and the utility
 * models above are not.
 */
export function isChatModelListing(model: unknown): boolean {
  const id = typeof model === "string" ? model
    : model && typeof model === "object" ? (model as { readonly id?: unknown }).id : undefined;
  return typeof id === "string" && Boolean(id.trim()) && !NON_CHAT_LISTING.test(id.trim().toLocaleLowerCase())
    && modelPrimaryCategory(model) === "language";
}

/**
 * Whether a provider's model list can stand in for a live check. Azure and Bedrock list a catalogue, not the
 * deployments or profiles a key can call. A local Ollama model is checked by a live call first: a declared tool
 * template does not mean a small local model calls tools reliably, and its list needs no key.
 */
export function modelListAuthorizesRoutes(providerId: OfficialProviderId): boolean {
  return providerId !== "azure_openai" && providerId !== "bedrock" && providerId !== "ollama";
}

/**
 * Conservative baseline for a saved direct connection. Model-name matching is
 * recorded as inferred evidence only. It is never presented as a verified API
 * capability and can be superseded by live probes or provider metadata.
 */
export function inferModelCapabilityEvidence(
  options: InferModelCapabilityEvidenceOptions,
): readonly ModelCapabilityEvidence[] {
  const model = options.model.trim().toLocaleLowerCase();
  const provider = options.providerId;
  const result: ModelCapabilityEvidence[] = [
    evidence("input:text", "supported", options.connectionVerified ? "verified" : "inferred",
      options.connectionVerified ? "live_probe" : "model_heuristic", options.observedAt),
    evidence("output:text", "supported", options.connectionVerified ? "verified" : "inferred",
      options.connectionVerified ? "live_probe" : "model_heuristic", options.observedAt),
  ];
  // A streaming adapter proves transport support, not this model/route's declaration.
  result.push(evidence("streaming", "unknown", "unknown", "model_heuristic", options.observedAt));

  // The user's key read this chat model from its own API's model list. NextMux does not spend a paid call on
  // every listed model, so that list is the evidence that the model answers and can call tools. A failed tool
  // probe, an "unsupported" generation declaration or a non-chat model keeps it out (as does an "unsupported"
  // provider declaration the caller merges), and so does a provider whose list cannot stand in for a check.
  const listed = Boolean(options.discoveredByModelsEndpoint) && options.interfaceSupport !== "unsupported"
    && modelListAuthorizesRoutes(provider) && isChatModelListing(model);
  if (options.connectionVerified) {
    result.push(evidence("model:available", "supported", "verified", "live_probe", options.observedAt));
    result.push(evidence("model:generatable", "supported", "verified", "live_probe", options.observedAt));
  } else if (listed) {
    result.push(evidence("model:available", "supported", "verified", "models_endpoint", options.observedAt));
    result.push(evidence("model:generatable", "supported", "verified", "models_endpoint", options.observedAt));
  }
  if (options.discoveredByModelsEndpoint) {
    result.push(evidence("model:listed", "supported", "verified", "models_endpoint", options.observedAt));
  }
  if (!options.connectionVerified && options.interfaceSupport && options.interfaceSupport !== "unknown") {
    result.push(evidence(
      "model:generatable",
      options.interfaceSupport,
      "declared",
      "provider_metadata",
      options.observedAt,
    ));
  }
  if (options.toolCalling === "verified") {
    result.push(evidence("tools", "supported", "verified", "live_probe", options.observedAt));
  } else if (options.toolCalling === "failed") {
    result.push(evidence("tools", "unsupported", "verified", "live_probe", options.observedAt));
  } else if (listed) {
    result.push(evidence("tools", "supported", "verified", "models_endpoint", options.observedAt));
  } else {
    result.push(evidence("tools", "unknown", "unknown", "model_heuristic", options.observedAt));
  }

  // Provider-native control planes keep the same model families but use a
  // different provider id. Preserve the conservative heuristic across those
  // aliases so a verified Azure/Vertex route does not lose attachment support
  // merely because it is not named `openai` or `gemini`.
  const isOpenAiFamily = provider === "openai" || provider === "azure_openai";
  const isGeminiFamily = provider === "gemini" || provider === "vertex";
  const imageInput = provider === "anthropic" && /claude/.test(model)
    || isGeminiFamily && /gemini/.test(model)
    || isOpenAiFamily && /(?:gpt|chatgpt|o[1-9])/.test(model)
    || provider === "xai" && /grok/.test(model)
    || provider === "mistral" && /(?:pixtral|vision)/.test(model)
    || provider === "qwen" && /(?:^|[-_/])(?:vl|vision)(?:$|[-_/])/.test(model)
    || provider === "zhipu" && /(?:4v|vision|(?:^|[-_/])vl(?:$|[-_/]))/.test(model)
    || (provider === "custom_openai" || provider === "openrouter")
      && /(?:gpt|vision|omni|claude|gemini|grok|qwen|kimi|glm|pixtral|(?:^|[-_/])vl(?:$|[-_/]))/.test(model);
  if (imageInput) result.push(evidence("input:image", "supported", "inferred", "model_heuristic", options.observedAt));

  if ((isOpenAiFamily || provider === "anthropic" || isGeminiFamily) && imageInput) {
    result.push(evidence("input:pdf", "supported", "inferred", "model_heuristic", options.observedAt));
  }
  if (isGeminiFamily && /gemini/.test(model)) {
    result.push(
      evidence("input:audio", "supported", "inferred", "model_heuristic", options.observedAt),
      evidence("input:video", "supported", "inferred", "model_heuristic", options.observedAt),
    );
  }
  if (/(?:reason|think|deepseek-r|o[1-9]|gpt|claude|gemini|grok|glm|qwen|kimi)/.test(model)) {
    result.push(evidence("reasoning", "supported", "inferred", "model_heuristic", options.observedAt));
  }
  return mergeModelCapabilityEvidence(result);
}
