import { estimateAgentModelInputTokens } from "@nextmux/agent-runtime";
import { modelContractFetch, unsupportedDeclaredModelInput } from "./model-contract.js";
import { randomUUID } from "node:crypto";

import { invokeAnthropic } from "./anthropic-adapter.js";
import { invokeCohere } from "./cohere-adapter.js";
import { boundedModel, boundedSecret, contentFilterError, credentialSecrets, endpointUrl, normalizeOfficialModelError, redactErrorSecrets, redactExactSecrets, timeoutMs, OfficialModelError } from "./http.js";
import { invokeGemini } from "./gemini-adapter.js";
import { assertOrderedOutputSupport, outputErrorWithUsage, terminalDeliveryError } from "./output-parts.js";
import { assistantReplayScope, portableAssistantOutputMessages, prepareAssistantOutputReplay, shouldAutoDegradeAssistantOutput } from "./assistant-output-replay.js";
import { normalizePortableHistory } from "./portable-history.js";
import { invokeOpenAICompatible } from "./openai-adapter.js";
import { AI_SDK_PROVIDER_ADAPTER, createAiSdkModelClient } from "./ai-sdk-adapter.js";
import { versionedBaseUrl } from "./endpoint-url.js";
import { createOllamaModelClient } from "./ollama-adapter.js";
import { isOllamaCandidate } from "./ollama.js";
import type {
  AdapterInvocation,
  AdapterResult,
  ModelProviderAdapterDescriptor,
  ModelTransportCapability,
  OfficialModelClient,
  OfficialModelClientOptions,
  OfficialModelRequest,
} from "./types.js";

async function emitModelEvent(request: OfficialModelRequest, event: Parameters<NonNullable<OfficialModelRequest["onModelEvent"]>>[0]): Promise<void> {
  await request.onModelEvent?.(event);
  await request.onProviderEvent?.(event);
}

const PREVIEW_COMPATIBLE_PROVIDERS = new Set(["xai", "mistral", "deepseek", "qwen"]);
const PREVIEW_PROVED_CAPABILITIES = new Set<ModelTransportCapability>(["streaming", "usage"]);

function usesPreviewCompatibleProvider(options: OfficialModelClientOptions): boolean {
  return options.enablePreviewProviderAdapter === true
    && options.protocol === "openai_chat_completions"
    && Boolean(options.providerId && PREVIEW_COMPATIBLE_PROVIDERS.has(options.providerId));
}

export function requiredTransportCapabilitiesForRequest(request: OfficialModelRequest): readonly ModelTransportCapability[] {
  const capabilities = new Set<ModelTransportCapability>();
  if (request.tools.length) capabilities.add("tools");
  for (const message of request.messages) {
    for (const attachment of message.attachments ?? []) {
      if (attachment.kind === "image") capabilities.add("vision");
      else if (attachment.kind === "file") capabilities.add("files");
    }
  }
  if (request.reasoningEffort || request.reasoningBudgetTokens !== undefined || request.reasoningEnabled !== undefined || request.reasoningMode !== undefined || request.reasoningExclude !== undefined) capabilities.add("reasoning");
  return [...capabilities];
}

function previewRequestCapabilities(request: OfficialModelRequest): readonly ModelTransportCapability[] {
  return requiredTransportCapabilitiesForRequest(request);
}

function provedAdapterCapabilities(
  adapter: ModelProviderAdapterDescriptor,
  protocol: OfficialModelClientOptions["protocol"],
): readonly ModelTransportCapability[] {
  return adapter.capabilitiesByProtocol?.[protocol] || adapter.capabilities;
}

function assertRequestCapabilitiesAreProved(
  adapter: ModelProviderAdapterDescriptor,
  protocol: OfficialModelClientOptions["protocol"],
  request: OfficialModelRequest,
): void {
  const proved = provedAdapterCapabilities(adapter, protocol);
  const unsupported = requiredTransportCapabilitiesForRequest(request)
    .filter(capability => !proved.includes(capability));
  if (unsupported.length) {
    throw new OfficialModelError(
      "UNSUPPORTED_CAPABILITY",
      `The current transport has not verified ${unsupported.join(", ")}; the request was not sent`,
      { params: { capabilities: unsupported.join(", ") } },
    );
  }
}

function assertPreviewRequestIsProved(capabilities: readonly ModelTransportCapability[]): void {
  const unsupported = capabilities.filter(capability => !PREVIEW_PROVED_CAPABILITIES.has(capability));
  if (unsupported.length) {
    throw new OfficialModelError(
      "UNSUPPORTED_CAPABILITY",
      `The preview provider adapter has not verified ${unsupported.join(", ")}; use a stable compatible protocol`,
      { params: { capabilities: unsupported.join(", ") } },
    );
  }
}

export const LEGACY_PROVIDER_ADAPTER: ModelProviderAdapterDescriptor = Object.freeze({
  id: "legacy",
  label: "NextMux native adapters",
  protocols: Object.freeze([
    "openai_chat_completions",
    "anthropic_messages",
    "gemini_generate_content",
    "cohere_chat",
  ] as const),
  capabilities: Object.freeze([
    "tools",
    "usage",
    "cancellation",
  ] as const),
  capabilitiesByProtocol: Object.freeze({
    openai_chat_completions: Object.freeze(["tools", "vision", "reasoning", "usage", "cancellation"] as const),
    anthropic_messages: Object.freeze(["tools", "vision", "reasoning", "usage", "cancellation"] as const),
    gemini_generate_content: Object.freeze(["tools", "vision", "reasoning", "usage", "cancellation"] as const),
    cohere_chat: Object.freeze(["tools", "vision", "reasoning", "usage", "cancellation"] as const),
  }),
  priority: 100,
  maturity: "stable",
});

export const MODEL_PROVIDER_ADAPTERS: readonly ModelProviderAdapterDescriptor[] = Object.freeze([
  AI_SDK_PROVIDER_ADAPTER,
  LEGACY_PROVIDER_ADAPTER,
]);

/**
 * Deterministic capability selection. This is never round-robin and it never
 * replays a request on another transport after dispatch.
 */
export function modelProviderAdaptersFor(
  protocol: OfficialModelClientOptions["protocol"],
  requiredCapabilities: readonly ModelTransportCapability[] = [],
): readonly ModelProviderAdapterDescriptor[] {
  return MODEL_PROVIDER_ADAPTERS
    .filter(adapter => adapter.protocols.includes(protocol)
      && requiredCapabilities.every(capability =>
        (adapter.capabilitiesByProtocol?.[protocol] || adapter.capabilities).includes(capability)))
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
}

export function createPreferredOfficialModelClient(options: OfficialModelClientOptions): OfficialModelClient {
  if (options.protocol === "openai_chat_completions" && isOllamaCandidate(options)) {
    // The native Ollama path reports its own failures, so it is scrubbed as well (audit B02-01).
    return withCredentialScrubbing(createOllamaModelClient(options, createPreferredCompatibleModelClient), options);
  }
  return createPreferredCompatibleModelClient(options);
}

function createPreferredCompatibleModelClient(rawOptions: OfficialModelClientOptions): OfficialModelClient {
  // A relay entered as a bare host gets its format's version path, for the legacy transport too.
  const options = { ...rawOptions, baseUrl: versionedBaseUrl(rawOptions.baseUrl, rawOptions.protocol, rawOptions.providerId) };
  assertOrderedOutputSupport(options);
  const selected = modelProviderAdaptersFor(options.protocol, options.requiredCapabilities)[0];
  if (!selected) {
    const requested = options.requiredCapabilities?.join(", ") || "requested";
    throw new OfficialModelError("UNSUPPORTED_CAPABILITY", `The current protocol has no verified transport support for ${requested}`, { params: { capability: requested } });
  }
  const client = withCredentialScrubbing(selected.id === "ai_sdk"
    ? createAiSdkModelClient(options)
    : createLegacyOfficialModelClient(options), options);
  const preview = usesPreviewCompatibleProvider(options);
  if (preview) assertPreviewRequestIsProved(options.requiredCapabilities ?? []);
  return {
    adapterId: client.adapterId,
    estimateInputTokens: request => client.estimateInputTokens(request),
    async complete(request) {
      assertRequestCapabilitiesAreProved(selected, options.protocol, request);
      if (preview) assertPreviewRequestIsProved(previewRequestCapabilities(request));
      return await client.complete(request);
    },
  };
}

export function createOfficialModelClient(options: OfficialModelClientOptions): OfficialModelClient {
  if (options.protocol === "openai_chat_completions" && isOllamaCandidate(options)) {
    return withCredentialScrubbing(createOllamaModelClient(options, legacyOptions => withCredentialScrubbing(createLegacyOfficialModelClient(legacyOptions), legacyOptions)), options);
  }
  return withCredentialScrubbing(createLegacyOfficialModelClient(options), options);
}

/**
 * Every failure a client reports — the `response.failed` event, any other event carrying an error, and the thrown
 * error — is scrubbed of the exact API key this connection was configured with (a relay may echo an opaque key in
 * its error body; pattern redaction cannot recognise it). Audit C35-03.
 */
function withCredentialScrubbing(client: OfficialModelClient, options: OfficialModelClientOptions): OfficialModelClient {
  // A connection set to use this computer's environment credentials sends those values instead of a stored key.
  const environment = options.providerSettings?.credentialSource === "environment"
    ? [process.env.AZURE_API_KEY, process.env.AWS_BEARER_TOKEN_BEDROCK, process.env.AWS_SECRET_ACCESS_KEY, process.env.AWS_SESSION_TOKEN] : [];
  const secrets = credentialSecrets(options.apiKey, undefined, environment);
  if (!secrets.length) return client;
  const scrubEvent = <T,>(event: T): T => event && typeof event === "object" && "error" in (event as object) ? redactExactSecrets(event, secrets) : event;
  return {
    ...client,
    estimateInputTokens: request => client.estimateInputTokens(request),
    async complete(request) {
      const guarded: OfficialModelRequest = {
        ...request,
        ...(request.onModelEvent ? { onModelEvent: event => request.onModelEvent!(scrubEvent(event)) } : {}),
        ...(request.onProviderEvent ? { onProviderEvent: event => request.onProviderEvent!(scrubEvent(event)) } : {}),
      };
      try {
        return await client.complete(guarded);
      } catch (error) {
        throw redactErrorSecrets(error, secrets);
      }
    },
  };
}

function createLegacyOfficialModelClient(options: OfficialModelClientOptions): OfficialModelClient {
  // Endpoint, protocol selection and replay scope must share one construction-time snapshot.
  options = { ...options };
  assertOrderedOutputSupport(options);
  const apiKey = boundedSecret(options.apiKey);
  const model = boundedModel(options.model);
  if (options.protocol === "openai_responses") {
    throw new OfficialModelError("UNSUPPORTED_PROTOCOL", "OpenAI Responses requires the Vercel AI SDK adapter");
  }
  const endpoint = endpointUrl(options.baseUrl, options.protocol, model, options.allowInsecure === true);
  const requestTimeout = timeoutMs(options.timeoutMs);
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    adapterId: "legacy",
    estimateInputTokens: request => estimateAgentModelInputTokens(request.instructions, request.messages, request.tools, options),
    async complete(request) {
      const attemptId = randomUUID();
      let invocation: AdapterInvocation = {
        endpoint,
        protocol: options.protocol,
        providerId: options.providerId,
        baseUrl: options.baseUrl,
        reasoningControls: options.reasoningControls,
        capabilityDeclarations: options.capabilityDeclarations,
        apiKey,
        model,
        instructions: request.instructions,
        outputSchema: request.outputSchema,
        messages: request.messages,
        tools: request.tools,
        reasoningEffort: request.reasoningEffort,
        reasoningBudgetTokens: request.reasoningBudgetTokens,
        reasoningEnabled: request.reasoningEnabled,
        reasoningMode: request.reasoningMode,
        reasoningExclude: request.reasoningExclude,
        maxOutputTokens: request.maxOutputTokens,
        signal: request.signal,
        timeoutMs: requestTimeout,
        fetchImpl: modelContractFetch(fetchImpl, options, request),
        ...(options.acceptOrderedOutput ? { acceptOrderedOutput: true } : {}),
        replayScope: assistantReplayScope(options, "legacy"),
        ...(request.promptCacheKey ? { promptCacheKey: request.promptCacheKey } : {}),
        ...(request.creativityMode ? { creativityMode: request.creativityMode } : {}),
      };
      let result: AdapterResult | undefined;
      let terminalStarted = false;
      const assertActive = (): void => { if (request.signal?.aborted) throw new OfficialModelError("CANCELLED", "Model request cancelled"); };
      try {
        if (shouldAutoDegradeAssistantOutput(options, request)) {
          const portableMessages = portableAssistantOutputMessages(request.messages, options, "legacy");
          if (portableMessages !== request.messages) {
            request = { ...request, messages: portableMessages };
            invocation = { ...invocation, messages: request.messages };
          }
        }
        const replay = await prepareAssistantOutputReplay(options, request, "legacy");
        if (replay) {
          request = replay.request;
          invocation = { ...invocation, messages: request.messages, tools: request.tools, instructions: request.instructions, assistantReplay: replay };
        } else {
          const normalizedMessages = normalizePortableHistory(request.messages, options);
          if (normalizedMessages !== request.messages) {
            request = { ...request, messages: normalizedMessages };
            invocation = { ...invocation, messages: request.messages };
          }
        }
        const unsupportedInput = unsupportedDeclaredModelInput(options, request.messages);
        if (unsupportedInput) throw new OfficialModelError("UNSUPPORTED_CAPABILITY", `The model explicitly does not support ${unsupportedInput}; the request was not sent`, { params: { capability: unsupportedInput } });
        await emitModelEvent(request, { type: "response.started", attemptId, model });
        result = options.protocol === "anthropic_messages" ? await invokeAnthropic(invocation)
          : options.protocol === "gemini_generate_content" ? await invokeGemini(invocation)
            : options.protocol === "cohere_chat" ? await invokeCohere(invocation)
              : await invokeOpenAICompatible(invocation);
        assertActive();
        // A safety stop from any adapter (Claude refusal, Gemini SAFETY family, Cohere toxic stop) is the one
        // content-filter failure, never a cut-off success.
        if (result.finishReason === "content-filter") {
          throw outputErrorWithUsage(contentFilterError("", { stage: "response" }), result.usage, result.usageKnown !== false);
        }
        const legacyReasoning = (result.providerState as any)?.kind === "openai-chat-v1"
          && typeof (result.providerState as any).reasoning_content === "string"
          ? (result.providerState as any).reasoning_content as string
          : "";
        if (legacyReasoning) {
          const reasoningItemId = `reasoning-${attemptId}`;
          await emitModelEvent(request, { type: "reasoning.started", attemptId, itemId: reasoningItemId });
          await request.onReasoningDelta?.(legacyReasoning);
          assertActive();
          await emitModelEvent(request, { type: "reasoning.delta", attemptId, itemId: reasoningItemId, delta: legacyReasoning });
          await emitModelEvent(request, { type: "reasoning.completed", attemptId, itemId: reasoningItemId });
        }
        if (result.content) {
          const itemId = `content-${attemptId}`;
          await emitModelEvent(request, { type: "content.started", attemptId, itemId });
          await request.onTextDelta?.(result.content);
          assertActive();
          await emitModelEvent(request, { type: "content.delta", attemptId, itemId, delta: result.content });
          await emitModelEvent(request, { type: "content.completed", attemptId, itemId });
        }
        for (const call of result.toolCalls) {
          await emitModelEvent(request, { type: "tool_call.started", attemptId, callId: call.id, name: call.name });
          await emitModelEvent(request, {
            type: "tool_call.arguments_delta",
            attemptId,
            callId: call.id,
            delta: JSON.stringify(call.arguments ?? {}),
          });
          await emitModelEvent(request, { type: "tool_call.completed", attemptId, toolCall: call });
        }
        assertActive();
        await emitModelEvent(request, { type: "usage", attemptId, usage: result.usage });
        assertActive();
        terminalStarted = true;
        await emitModelEvent(request, {
          type: "response.completed",
          attemptId,
          model: result.model,
          finishReason: result.finishReason ?? (result.toolCalls.length ? "tool-calls" : "stop"),
          usage: result.usage,
          ...(result.citations?.length ? { citations: result.citations } : {}),
        });
        return result;
      } catch (error) {
        let failure = normalizeOfficialModelError(terminalStarted && result
          ? terminalDeliveryError(result.usage, result.usageKnown !== false) : error, { signal: request.signal, attemptId, provider: options.providerId });
        if (result && failure.usageKnown === undefined) failure = outputErrorWithUsage(failure, result.usage, result.usageKnown !== false);
        try {
          // The legacy path announces its failure even when the consumer
          // cancelled inside a text callback: the attempt already started and
          // must terminate with response.failed (test/ordered-output.test.mts).
          if (!terminalStarted) await emitModelEvent(request, { type: "response.failed", attemptId, error: failure.toJSON() });
        } catch {
          // The original model failure remains authoritative if an event sink fails.
        }
        throw failure;
      }
    }
  };
}
