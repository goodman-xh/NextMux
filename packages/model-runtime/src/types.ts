import type { ModelContract } from "./model-contract.js";
import type { ModelCreativityMode } from "./model-contract.js";
import type {
  AgentModelMessage,
  AgentModelRequest,
  AgentModelTurn,
  AgentOutputAsset,
  AgentReasoningEffort,
  AgentToolCall,
  AgentToolDescriptor
} from "@nextmux/agent-runtime";

import type {
  OfficialProviderId,
  OfficialProviderProtocol,
  OfficialProviderSettings,
} from "./presets.js";
import type { OfficialModelErrorSnapshot } from "./http.js";
import type { OpenRouterRoutePolicy } from "./openrouter.js";

export interface OfficialModelClientOptions extends ModelContract {
  /** Enable only when the caller consumes ordered binary parts instead of treating content as the whole answer. */
  readonly acceptOrderedOutput?: true;
  /** Degrades prior-turn assistant media outputParts and v2 replay templates into text placeholders when switching models or protocols. */
  readonly degradeForeignOutputReplay?: boolean;
  /** Host-owned authorization and bounded local read. Called for EVERY media position; a hash is not authority. */
  readonly resolveAssistantOutputAsset?: (input: {
    readonly asset: AgentOutputAsset;
    readonly messageIndex: number;
    readonly partIndex: number;
    readonly signal?: AbortSignal;
  }) => Promise<Uint8Array>;
  /** Selects a provider-native SDK when one is available for this route. */
  readonly providerId?: OfficialProviderId;
  /** Non-secret provider settings used by provider-native transports. */
  readonly providerSettings?: OfficialProviderSettings;
  readonly protocol: OfficialProviderProtocol;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  /** OpenRouter-only server-side model/provider routing controls. */
  readonly openRouterRoutePolicy?: OpenRouterRoutePolicy;
  /** Capabilities the selected transport must have proved at its public seam. */
  readonly requiredCapabilities?: readonly ModelTransportCapability[];
  /**
   * Opts into provider-specific SDK transports that have not completed the
   * full NextMux conformance matrix. Production routes leave this disabled
   * and use the maintained generic compatible transport instead.
   */
  readonly enablePreviewProviderAdapter?: boolean;
  readonly timeoutMs?: number;
  readonly allowInsecure?: boolean;
  readonly fetchImpl?: typeof fetch;
}

export type ModelTransportCapability =
  | "streaming"
  | "tools"
  | "vision"
  | "files"
  | "reasoning"
  | "usage"
  | "cancellation";

export interface ModelProviderAdapterDescriptor {
  readonly id: "legacy" | "ai_sdk";
  readonly label: string;
  readonly protocols: readonly OfficialProviderProtocol[];
  readonly capabilities: readonly ModelTransportCapability[];
  /** Protocol-specific additions proved by request/response conformance tests. */
  readonly capabilitiesByProtocol?: Readonly<Partial<Record<OfficialProviderProtocol, readonly ModelTransportCapability[]>>>;
  readonly priority: number;
  readonly maturity: "stable" | "preview";
}

export interface OfficialModelTurn extends Omit<AgentModelTurn, "outputParts"> {
  readonly finishReason?: OfficialModelFinishReason;
  readonly model: string;
  readonly outputParts?: readonly OfficialModelOutputPart[];
  readonly providerState?: unknown;
}

/** Node-memory-only parts. Raw media must not enter generic events, logs, or renderer history mirrors. */
export type OfficialModelOutputPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; readonly dataBase64: string; readonly sizeBytes: number }
  | { readonly type: "audio"; readonly mimeType: "audio/wav" | "audio/mpeg" | "audio/ogg" | "audio/flac"; readonly dataBase64: string; readonly sizeBytes: number };

export interface OfficialModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Number of input tokens served from a provider-side prompt/KV cache. */
  readonly cachedInputTokens?: number;
  /** Number of input tokens written to a provider-side prompt/KV cache. */
  readonly cacheWriteTokens?: number;
  /** Provider-reported hidden/reasoning tokens, when exposed. */
  readonly reasoningTokens?: number;
  /** Explicit cache outcome. Undefined means the provider did not expose cache metadata. */
  readonly cacheStatus?: "hit" | "miss" | "unknown";
}

export type OfficialModelFinishReason =
  | "stop"
  | "length"
  | "content-filter"
  | "tool-calls"
  | "error"
  | "other";

/**
 * Provider-neutral events emitted by the transport. The attempt id is stable
 * for exactly one HTTP generation attempt; adapters never retry that attempt.
 */
export type OfficialModelEvent =
  | { readonly type: "response.started"; readonly attemptId: string; readonly model: string }
  | { readonly type: "content.started"; readonly attemptId: string; readonly itemId: string }
  | { readonly type: "content.delta"; readonly attemptId: string; readonly itemId: string; readonly delta: string }
  | { readonly type: "content.completed"; readonly attemptId: string; readonly itemId: string }
  | { readonly type: "reasoning.started"; readonly attemptId: string; readonly itemId: string }
  | { readonly type: "reasoning.delta"; readonly attemptId: string; readonly itemId: string; readonly delta: string }
  | { readonly type: "reasoning.completed"; readonly attemptId: string; readonly itemId: string }
  | { readonly type: "tool_call.started"; readonly attemptId: string; readonly callId: string; readonly name: string }
  | { readonly type: "tool_call.arguments_delta"; readonly attemptId: string; readonly callId: string; readonly delta: string }
  | { readonly type: "tool_call.completed"; readonly attemptId: string; readonly toolCall: AgentToolCall }
  | { readonly type: "usage"; readonly attemptId: string; readonly usage: OfficialModelUsage }
  | {
      readonly type: "response.completed";
      readonly citations?: readonly import("@nextmux/agent-runtime").ModelCitation[];
      readonly attemptId: string;
      readonly model: string;
      readonly finishReason: OfficialModelFinishReason;
      readonly usage: OfficialModelUsage;
    }
  | { readonly type: "response.failed"; readonly attemptId: string; readonly error: OfficialModelErrorSnapshot };

export interface OfficialModelRequest extends AgentModelRequest {
  /** Host-authored constrained output for short programmatic model calls. */
  readonly outputSchema?: { readonly name: string; readonly schema: Record<string, unknown> };
  /** Degrades prior-turn assistant media outputParts and v2 replay templates into text placeholders when switching models or protocols. */
  readonly degradeForeignOutputReplay?: boolean;
  /** Receives ordered provider-neutral transport events without raw secrets or response bodies. */
  readonly onModelEvent?: (event: OfficialModelEvent) => void | Promise<void>;
  /** Receives incremental reasoning/thinking text deltas when exposed by the provider. */
  readonly onReasoningDelta?: (delta: string) => void | Promise<void>;
  /**
   * Stable, host-generated cache identity for the invariant request prefix.
   * This is metadata only: adapters must never derive it from secrets or raw
   * conversation text. Providers that support a native cache key may map it
   * to their request option; other providers simply report cache metadata.
   */
  readonly promptCacheKey?: string;
  /** User-selected answer style; "normal" (the default) sends no custom temperature. */
  readonly creativityMode?: ModelCreativityMode;
}

export interface OfficialModelClient {
  estimateInputTokens(request: Pick<OfficialModelRequest, "instructions" | "messages" | "tools">): number;
  readonly adapterId: ModelProviderAdapterDescriptor["id"];
  complete(request: OfficialModelRequest): Promise<OfficialModelTurn>;
}

export interface AdapterInvocation extends ModelContract {
  readonly outputSchema?: OfficialModelRequest["outputSchema"];
  readonly protocol: OfficialProviderProtocol;
  readonly providerId?: OfficialProviderId;
  readonly baseUrl: string;
  readonly acceptOrderedOutput?: true;
  readonly endpoint: URL;
  readonly apiKey: string;
  readonly model: string;
  readonly instructions?: string;
  readonly messages: readonly AgentModelMessage[];
  readonly tools: readonly AgentToolDescriptor[];
  readonly reasoningEffort?: AgentReasoningEffort;
  readonly reasoningBudgetTokens?: number;
  readonly reasoningEnabled?: boolean;
  readonly reasoningMode?: "adaptive" | "enabled" | "disabled";
  readonly reasoningExclude?: boolean;
  /** Per-request provider ceiling derived from the runner's remaining budget. */
  readonly maxOutputTokens?: number;
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
  readonly fetchImpl: typeof fetch;
  /** Node-memory-only, already authorized and validated before dispatch. */
  readonly assistantReplay?: import("./assistant-output-replay.js").PreparedAssistantReplay;
  readonly replayScope?: string;
  /** Stable host-generated identity for the invariant prompt prefix. */
  readonly promptCacheKey?: string;
  /** User-selected answer style; "normal" (the default) sends no custom temperature. */
  readonly creativityMode?: ModelCreativityMode;
}

export interface AdapterResult {
  readonly finishReason?: OfficialModelFinishReason;
  readonly content: string;
  readonly outputParts?: readonly OfficialModelOutputPart[];
  readonly citations?: readonly import("@nextmux/agent-runtime").ModelCitation[];
  readonly toolCalls: readonly AgentToolCall[];
  readonly model: string;
  readonly usage: OfficialModelUsage;
  /** False is returned when the provider omitted or malformed usage fields. */
  readonly usageKnown?: boolean;
  readonly providerState?: unknown;
}
