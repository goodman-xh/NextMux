import { estimateAgentModelInputTokens } from "@nextmux/agent-runtime";
import { modelContractFetch, unsupportedDeclaredModelInput } from "./model-contract.js";
import { messagesWithToolImages } from "./tool-result-images.js";
import { randomUUID } from "node:crypto";
import { cohereModelCitations, normalizeModelCitations } from "./citations.js";
import { classifyModelError } from "./errors.js";

import type {
  AssistantContent,
  FilePart,
  LanguageModel,
  ModelMessage,
  ProviderMetadata,
  ToolContent,
  ToolSet,
  UserContent,
} from "ai" with { "resolution-mode": "import" };
import type {
  AgentMessageAttachment,
  AgentModelMessage,
  AgentToolCall,
} from "@nextmux/agent-runtime";

import {
  boundedModel,
  boundedSecret,
  contentFilterCategories,
  contentFilterError,
  MAX_PROVIDER_STATE_BYTES,
  normalizeOfficialModelError,
  OfficialModelError,
  timeoutMs,
  usagePairWithKnown,
  strictTokenCount,
  validatedBaseUrl,
} from "./http.js";
import {
  boundedOpenRouterRoutePolicy,
  createOpenRouterMetadataExtractor,
  hasKimiOpenRouterReasoningDetails,
  OPENROUTER_APP_HEADERS,
  openRouterProviderOptions,
  resolvedOpenRouterMetadata,
  openRouterReasoningDetails,
  openRouterReadableReasoning,
  replayableOpenRouterReasoningDetails,
  type OpenRouterReasoningDetail,
  type OpenRouterResolvedMetadata,
} from "./openrouter.js";
import { createToolNameCodec, type ToolNameCodec } from "./tool-names.js";
import { invalidToolArguments } from "@nextmux/agent-runtime";
import { assertOrderedOutputSupport, boundedModelOutputFetch, OrderedModelOutput, outputErrorWithUsage, terminalDeliveryError } from "./output-parts.js";
import { assistantReplayFetch, assistantReplayScope, portableAssistantOutputMessages, prepareAssistantOutputReplay, replayToolCallsHash, returnedPartsHash, shouldAutoDegradeAssistantOutput, type PreparedAssistantReplay } from "./assistant-output-replay.js";
import { geminiSchema, normalizePortableHistory, portableSchema } from "./portable-history.js";
import { createInlineThinkTagSplitter, inlineThinkTagsFor, repairedToolCallArguments } from "./inline-think.js";
import { versionedBaseUrl } from "./endpoint-url.js";
import { cohereAttachmentMessages } from "./cohere-attachments.js";
import type {
  ModelProviderAdapterDescriptor,
  OfficialModelClient,
  OfficialModelClientOptions,
  OfficialModelEvent,
  OfficialModelFinishReason,
  OfficialModelRequest,
  OfficialModelUsage,
} from "./types.js";

const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const ANTHROPIC_CACHE_OPTIONS = { anthropic: { cacheControl: { type: "ephemeral", ttl: "5m" } } } as const;

/** Cache stable prefixes without changing tool or message order. Thinking blocks cannot be cache breakpoints. */
function anthropicCachedMessages(messages: ModelMessage[]): ModelMessage[] {
  const result = [...messages];
  let marked = 0;
  for (let index = result.length - 1; index >= 0 && marked < 2; index--) {
    const message = result[index]!;
    const content = message.content;
    if (Array.isArray(content) && (content.length === 0 || content.at(-1)?.type === "reasoning")) continue;
    if (typeof content === "string" && !content) continue;
    result[index] = { ...message, providerOptions: {
      ...message.providerOptions,
      anthropic: { ...message.providerOptions?.anthropic, ...ANTHROPIC_CACHE_OPTIONS.anthropic },
    } };
    marked++;
  }
  return result;
}

function usesProviderEnvironmentCredentials(options: OfficialModelClientOptions): boolean {
  return options.providerSettings?.credentialSource === "environment"
    && (options.providerId === "azure_openai"
      || options.providerId === "vertex"
      || options.providerId === "bedrock");
}

interface AiSdkProviderState {
  readonly version: 1 | 2;
  readonly providerScope?: string;
  readonly replayScope?: string;
  readonly replayPartsHash?: string;
  readonly replayToolCallsHash?: string;
  readonly kind: "ai_sdk_provider_state" | "ai_sdk_tool_options";
  readonly toolCallProviderOptions: Readonly<Record<string, ProviderMetadata>>;
  readonly reasoning?: readonly {
    readonly text: string;
    readonly providerOptions?: ProviderMetadata;
  }[];
  readonly openRouter?: OpenRouterResolvedMetadata;
  readonly openRouterReasoningDetails?: readonly OpenRouterReasoningDetail[];
  /** Private metadata on the visible answer itself (Gemini's thoughtSignature on a plain text part). */
  readonly textProviderOptions?: ProviderMetadata;
}

export const AI_SDK_PROVIDER_ADAPTER: ModelProviderAdapterDescriptor = Object.freeze({
  id: "ai_sdk",
  label: "Vercel AI SDK",
  protocols: Object.freeze([
    "openai_responses",
    "openai_chat_completions",
    "anthropic_messages",
    "gemini_generate_content",
    "cohere_chat",
  ] as const),
  capabilities: Object.freeze([
    "streaming",
    "tools",
    "usage",
    "cancellation",
  ] as const),
  capabilitiesByProtocol: Object.freeze({
    openai_responses: Object.freeze(["streaming", "tools", "vision", "files", "reasoning", "usage", "cancellation"] as const),
    openai_chat_completions: Object.freeze(["streaming", "tools", "vision", "files", "reasoning", "usage", "cancellation"] as const),
    anthropic_messages: Object.freeze(["streaming", "tools", "vision", "files", "reasoning", "usage", "cancellation"] as const),
    gemini_generate_content: Object.freeze(["streaming", "tools", "vision", "files", "reasoning", "usage", "cancellation"] as const),
    // Cohere V2 exposes native SSE, tool-call deltas, attachments, and
    // thinking through the maintained provider adapter.
    cohere_chat: Object.freeze(["streaming", "tools", "vision", "files", "reasoning", "usage", "cancellation"] as const),
  }),
  priority: 200,
  maturity: "stable",
});

function assertRequestSize(messages: readonly AgentModelMessage[]): void {
  let encoded: string;
  try {
    encoded = JSON.stringify(messages);
  } catch {
    throw new OfficialModelError("INVALID_REQUEST", "The model request cannot be serialized");
  }
  if (Buffer.byteLength(encoded, "utf8") > MAX_REQUEST_BYTES) {
    throw new OfficialModelError("REQUEST_TOO_LARGE", "The model request exceeds the size limit", { params: { maxBytes: MAX_REQUEST_BYTES } });
  }
}

function filePart(attachment: Exclude<AgentMessageAttachment, { readonly kind: "text" }>): FilePart {
  return {
    type: "file",
    data: { type: "data", data: attachment.dataBase64 },
    mediaType: attachment.mimeType,
    filename: attachment.name,
  };
}

function userContent(message: AgentModelMessage): UserContent {
  if (!message.attachments?.length) return message.content;
  const content: UserContent = [{ type: "text", text: message.content }];
  for (const attachment of message.attachments) {
    if (attachment.kind === "text") {
      content.push({
        type: "text",
        text: `\n\n<file name="${attachment.name}">\n${attachment.content}\n</file>`,
      });
    } else {
      content.push(filePart(attachment));
    }
  }
  return content;
}

function toolNameByCallId(messages: readonly AgentModelMessage[], names: ToolNameCodec): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const message of messages) {
    for (const call of message.toolCalls ?? []) result.set(call.id, names.encode(call.name));
  }
  return result;
}

function storedToolProviderOptions(message: AgentModelMessage, callId: string): ProviderMetadata | undefined {
  const state = message.providerState;
  if (!state || typeof state !== "object" || Array.isArray(state)) return undefined;
  const candidate = state as Partial<AiSdkProviderState>;
  if ((candidate.version !== 1 && candidate.version !== 2)
    || (candidate.kind !== "ai_sdk_provider_state" && candidate.kind !== "ai_sdk_tool_options")
    || !candidate.toolCallProviderOptions || typeof candidate.toolCallProviderOptions !== "object") return undefined;
  const value = candidate.toolCallProviderOptions[callId];
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  try {
    return JSON.stringify(value).length <= MAX_PROVIDER_STATE_BYTES ? value as ProviderMetadata : undefined;
  } catch {
    return undefined;
  }
}

const MAX_FOLDED_MESSAGE_CHARS = 8_000;
const MAX_FOLDED_HISTORY_CHARS = 24_000;

function clipFoldedReasoning(text: string, maxChars: number): string {
  const clean = String(text || "").trim();
  if (!clean || maxChars <= 0) return "";
  return clean.length <= maxChars ? clean : clean.slice(clean.length - maxChars);
}

function storedReasoning(message: AgentModelMessage): readonly {
  readonly text: string;
  readonly providerOptions?: ProviderMetadata;
}[] {
  const state = message.providerState;
  if (!state || typeof state !== "object" || Array.isArray(state)) return [];
  const raw = state as Record<string, any>;
  if (raw.kind === "gemini-content-v1" && Array.isArray(raw.content?.parts)) {
    return raw.content.parts
      .filter((part: any) => part?.thought === true && typeof part.text === "string" && part.text)
      .map((part: any) => ({ text: part.text }));
  }
  if (raw.kind === "openai-chat-v1" && typeof raw.reasoning_content === "string" && raw.reasoning_content) {
    return [{ text: raw.reasoning_content }];
  }
  const candidate = state as Partial<AiSdkProviderState>;
  if ((candidate.version !== 1 && candidate.version !== 2) || candidate.kind !== "ai_sdk_provider_state"
    || !Array.isArray(candidate.reasoning)) return [];
  try {
    if (Buffer.byteLength(JSON.stringify(candidate), "utf8") > MAX_PROVIDER_STATE_BYTES) return [];
  } catch {
    return [];
  }
  const result: { text: string; providerOptions?: ProviderMetadata }[] = [];
  for (const item of candidate.reasoning) {
    if (!item || typeof item !== "object" || typeof item.text !== "string") return [];
    const providerOptions = safeProviderOptions(item.providerOptions);
    result.push({ text: item.text, ...(providerOptions ? { providerOptions } : {}) });
  }
  return result;
}

function mapMessages(
  messages: readonly AgentModelMessage[],
  names: ToolNameCodec,
  providerScope: string,
  replay?: PreparedAssistantReplay,
  reasoningExclude?: boolean,
  options?: Pick<OfficialModelClientOptions, "providerId" | "model"> & {
    readonly reasoningEnabled?: boolean;
    readonly reasoningMode?: string;
  },
): ModelMessage[] {
  const callNames = toolNameByCallId(messages, names);
  const entries = messagesWithToolImages(messages);
  let lastUserIndex = -1;
  for (let idx = entries.length - 1; idx >= 0; idx--) {
    if (entries[idx]!.message.role === "user") {
      lastUserIndex = idx;
      break;
    }
  }
  // Same rule as the OpenAI-compatible adapter: thinking models require reasoning_content on tool-call turns, and so
  // does DeepSeek with reasoning on; a non-thinking model (deepseek-chat) never receives an empty one.
  const isDeepSeek = options?.providerId === "deepseek" || /deepseek/i.test(options?.model ?? "");
  const requiresReasoningOnToolCalls = /deepseek-reasoner|deepseek-r1|deepseek-v3\.2|kimi-k2/i.test(options?.model ?? "")
    || (isDeepSeek && (options?.reasoningEnabled === true || options?.reasoningMode === "enabled"));
  const foldedForeignByEntry = new Map<number, readonly string[]>();

  if (reasoningExclude !== true) {
    let remainingBudget = MAX_FOLDED_HISTORY_CHARS;
    for (let index = entries.length - 1; index >= 0 && remainingBudget > 0; index--) {
      const { message } = entries[index]!;
      if (message.role !== "assistant") continue;
      const state = message.providerState as (Partial<AiSdkProviderState> & { scope?: string }) | undefined;
      const sameProvider = (state?.providerScope || state?.replayScope || state?.scope) === providerScope;
      if (sameProvider) continue;
      const reasoning = storedReasoning(message);
      const details = openRouterReasoningDetails(state?.openRouterReasoningDetails);
      const rawSegments = reasoning.map(part => part.text).filter(Boolean);
      if (details !== undefined) {
        const readable = openRouterReadableReasoning(details);
        if (readable && !rawSegments.join("").includes(readable)) rawSegments.push(readable);
      }
      if (!rawSegments.length) continue;
      let messageBudget = Math.min(MAX_FOLDED_MESSAGE_CHARS, remainingBudget);
      const keptReversed: string[] = [];
      for (let segIdx = rawSegments.length - 1; segIdx >= 0 && messageBudget > 0; segIdx--) {
        const clipped = clipFoldedReasoning(rawSegments[segIdx]!, messageBudget);
        if (clipped) {
          keptReversed.push(clipped);
          messageBudget -= clipped.length;
          remainingBudget -= clipped.length;
        }
      }
      if (keptReversed.length) {
        foldedForeignByEntry.set(index, keptReversed.reverse());
      }
    }
  }

  const mapped: ModelMessage[] = entries.map(({ message, sourceIndex: messageIndex }, entryIndex) => {
    if (message.role === "user") return { role: "user", content: userContent(message) };
    if (message.role === "tool") {
      const toolCallId = message.toolCallId?.trim();
      const toolName = toolCallId ? callNames.get(toolCallId) : undefined;
      if (!toolCallId || !toolName) {
        throw new OfficialModelError("INVALID_REQUEST", "The tool result has no matching tool call");
      }
      const content: ToolContent = [{
        type: "tool-result",
        toolCallId,
        toolName,
        output: { type: "text", value: message.content },
      }];
      return { role: "tool", content };
    }
    // Model-private signatures and IDs are not portable history. As in
    // OpenCode message-v2.toModelMessages, retain readable reasoning as text
    // on a model change, but never reuse another route's provider metadata.
    // Legacy unscoped records cannot establish ownership and take that path too.
    const state = message.providerState as (Partial<AiSdkProviderState> & { scope?: string }) | undefined;
    const sameProvider = (state?.providerScope || state?.replayScope || state?.scope) === providerScope;
    const reasoning = storedReasoning(message);
    const foldedForeign = foldedForeignByEntry.get(entryIndex) ?? [];
    const details = openRouterReasoningDetails(state?.openRouterReasoningDetails);
    const replayDetails = sameProvider && details !== undefined ? replayableOpenRouterReasoningDetails(details) : undefined;
    const hasKimiDetails = hasKimiOpenRouterReasoningDetails(details);
    const wireOptions = replayDetails !== undefined
      ? { providerOptions: { openaiCompatible: { reasoning_details: replayDetails } } } : {};
    const visible = replay?.parts.get(messageIndex);
    // The answer's own signature goes back only to the route that issued it (audit B02-06).
    const textOptions = sameProvider ? textSignatureOptions(state?.textProviderOptions) : undefined;
    if (!message.toolCalls?.length && (!sameProvider ? !foldedForeign.length : !reasoning.length) && visible === undefined && !textOptions) {
      if (details === undefined || (sameProvider && !hasKimiDetails) || (!sameProvider && !foldedForeign.length)) {
        return { role: "assistant", content: message.content, ...wireOptions };
      }
    }
    const content: AssistantContent = [];
    if (sameProvider) {
      for (const part of reasoning) {
        // A structured block must not also become unsigned reasoning_content,
        // except Kimi K2.5 on OpenRouter which requires both reasoning_details and reasoning_content.
        if (details !== undefined && !hasKimiDetails) continue;
        content.push({
          type: "reasoning",
          text: part.text,
          ...(part.providerOptions ? { providerOptions: part.providerOptions } : {}),
        });
      }
      if (hasKimiDetails && !reasoning.length) {
        const readableKimi = openRouterReadableReasoning(details);
        if (readableKimi) content.push({ type: "reasoning", text: readableKimi });
      }
    } else if (requiresReasoningOnToolCalls && entryIndex > lastUserIndex && message.toolCalls?.length) {
      const joinedForeign = foldedForeign.join("\n").trim();
      content.push({ type: "reasoning", text: joinedForeign });
    } else {
      for (const text of foldedForeign) {
        content.push({ type: "text", text });
      }
    }
    if (visible !== undefined) {
      for (const part of visible) content.push(part.type === "text" ? { type: "text", text: part.text }
        : { type: "file", mediaType: part.mimeType, data: { type: "data", data: part.dataBase64 } });
    } else if (message.content) content.push({ type: "text", text: message.content, ...(textOptions ? { providerOptions: textOptions } : {}) });
    for (const call of message.toolCalls ?? []) {
      const providerOptions = sameProvider ? storedToolProviderOptions(message, call.id) : undefined;
      content.push({
        type: "tool-call",
        toolCallId: call.id,
        toolName: names.encode(call.name),
        input: call.arguments ?? {},
        ...(providerOptions ? { providerOptions } : {}),
      });
    }
    return { role: "assistant", content, ...wireOptions };
  });

  const coalesced: ModelMessage[] = [];
  for (const item of mapped) {
    const prev = coalesced.at(-1);
    if (prev?.role === "user" && item.role === "user") {
      const prevParts = typeof prev.content === "string"
        ? (prev.content ? [{ type: "text" as const, text: prev.content }] : [])
        : [...prev.content];
      const nextParts = typeof item.content === "string"
        ? (item.content ? [{ type: "text" as const, text: item.content }] : [])
        : [...item.content];
      coalesced[coalesced.length - 1] = {
        ...prev,
        content: [...prevParts, ...nextParts],
      };
    } else {
      coalesced.push(item);
    }
  }
  return coalesced;
}

function citationMetadataExtractor(
  observe: (value: unknown) => void,
  delegate?: ReturnType<typeof createOpenRouterMetadataExtractor>,
): ReturnType<typeof createOpenRouterMetadataExtractor> {
  const observeBody = (body: any): void => {
    if (body && typeof body === "object" && !body.usage && body.choices?.[0]?.usage) {
      body.usage = body.choices[0].usage;
    }
    const message = body?.choices?.[0]?.delta ?? body?.choices?.[0]?.message;
    if (Array.isArray(message?.annotations)) observe(message.annotations.slice(0, 128)
      .filter((item: any) => item?.type === "url_citation").map((item: any) => item.url_citation));
  };
  return {
    async extractMetadata(input) { observeBody(input.parsedBody); return delegate?.extractMetadata(input); },
    createStreamExtractor() {
      const inner = delegate?.createStreamExtractor();
      return { processChunk(chunk) { observeBody(chunk); inner?.processChunk(chunk); }, buildMetadata() { return inner?.buildMetadata(); } };
    },
  };
}

/**
 * A relay address entered as a bare host ("https://api.example.com") gets its format's version path, as the SDKs
 * expect it in their base URL: /v1 for OpenAI and Anthropic formats, /v1beta for Gemini. Without it the Anthropic
 * SDK posted to /messages and New API relays answered 404 or their web page (2026-09-30). Addresses that carry any
 * path are used exactly as entered; first-party presets keep their own URLs.
 */
async function languageModel(options: OfficialModelClientOptions, baseUrl: string, observeCitations: (value: unknown) => void): Promise<LanguageModel> {
  // Use the provider-native transports for cloud control planes. These
  // providers are deliberately selected before the protocol fallback: their
  // wire format and authentication headers are not interchangeable with a
  // generic OpenAI-compatible endpoint.
  if (options.providerId === "azure_openai") {
    const { createAzure } = await import("@ai-sdk/azure");
    const provider = createAzure({
      baseURL: baseUrl,
      apiKey: options.apiKey || undefined,
      apiVersion: options.providerSettings?.apiVersion,
      useDeploymentBasedUrls: options.providerSettings?.useDeploymentBasedUrls,
      fetch: options.fetchImpl,
    });
    return options.protocol === "openai_responses"
      ? provider.responses(options.model)
      : provider.chat(options.model);
  }
  if (options.providerId === "vertex") {
    const { createGoogleVertex } = await import("@ai-sdk/google-vertex");
    return createGoogleVertex({
      baseURL: baseUrl,
      apiKey: options.apiKey || undefined,
      project: options.providerSettings?.project,
      location: options.providerSettings?.location,
      fetch: options.fetchImpl,
    }).languageModel(options.model);
  }
  if (options.providerId === "bedrock") {
    const { createAmazonBedrock } = await import("@ai-sdk/amazon-bedrock");
    return createAmazonBedrock({
      baseURL: baseUrl,
      apiKey: options.apiKey || undefined,
      region: options.providerSettings?.region,
      fetch: options.fetchImpl,
    }).languageModel(options.model);
  }
  if (options.protocol === "openai_responses") {
    const { createOpenAI } = await import("@ai-sdk/openai");
    return createOpenAI({
      baseURL: baseUrl,
      apiKey: options.apiKey,
      fetch: options.fetchImpl,
      name: "nextmux-openai",
    }).responses(options.model);
  }
  if (options.protocol === "anthropic_messages") {
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    return createAnthropic({
      baseURL: baseUrl,
      apiKey: options.apiKey,
      fetch: options.fetchImpl,
      name: "nextmux-anthropic",
    }).languageModel(options.model);
  }
  if (options.protocol === "gemini_generate_content") {
    const { createGoogle } = await import("@ai-sdk/google");
    return createGoogle({
      baseURL: baseUrl,
      apiKey: options.apiKey,
      fetch: options.fetchImpl,
      name: "nextmux-google",
    }).languageModel(options.model);
  }
  if (options.protocol === "cohere_chat") {
    const { createCohere } = await import("@ai-sdk/cohere");
    return createCohere({
      baseURL: baseUrl,
      apiKey: options.apiKey,
      fetch: options.fetchImpl,
    }).languageModel(options.model);
  }
  if (options.protocol !== "openai_chat_completions") {
    throw new OfficialModelError("UNSUPPORTED_PROTOCOL", "The Vercel AI SDK adapter does not support this protocol");
  }
  if (options.enablePreviewProviderAdapter && options.providerId === "xai") {
    const { createXai } = await import("@ai-sdk/xai");
    return createXai({
      baseURL: baseUrl,
      apiKey: options.apiKey,
      fetch: options.fetchImpl,
    }).chat(options.model);
  }
  if (options.enablePreviewProviderAdapter && options.providerId === "mistral") {
    const { createMistral } = await import("@ai-sdk/mistral");
    return createMistral({
      baseURL: baseUrl,
      apiKey: options.apiKey,
      fetch: options.fetchImpl,
    }).languageModel(options.model);
  }
  if (options.enablePreviewProviderAdapter && options.providerId === "deepseek") {
    const { createDeepSeek } = await import("@ai-sdk/deepseek");
    return createDeepSeek({
      baseURL: baseUrl,
      apiKey: options.apiKey,
      fetch: options.fetchImpl,
    }).languageModel(options.model);
  }
  if (options.enablePreviewProviderAdapter && options.providerId === "qwen") {
    const { createAlibaba } = await import("@ai-sdk/alibaba");
    return createAlibaba({
      baseURL: baseUrl,
      apiKey: options.apiKey,
      fetch: options.fetchImpl,
      includeUsage: true,
    }).languageModel(options.model);
  }
  if (options.providerId === "openai") {
    const { createOpenAI } = await import("@ai-sdk/openai");
    const provider = createOpenAI({
      baseURL: baseUrl,
      apiKey: options.apiKey,
      fetch: options.fetchImpl,
      name: "nextmux-openai",
    });
    return provider.chat(options.model);
  }
  const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
  if (options.providerId === "openrouter") {
    return createOpenAICompatible({
      baseURL: baseUrl,
      apiKey: options.apiKey,
      fetch: options.fetchImpl,
      headers: { ...OPENROUTER_APP_HEADERS },
      includeUsage: true,
      metadataExtractor: citationMetadataExtractor(observeCitations, createOpenRouterMetadataExtractor()),
      name: "openrouter",
    }).chatModel(options.model);
  }
  return createOpenAICompatible({
    baseURL: baseUrl,
    apiKey: options.apiKey,
    fetch: options.fetchImpl,
    includeUsage: true,
    metadataExtractor: citationMetadataExtractor(observeCitations),
    name: "nextmux-compatible",
  }).chatModel(options.model);
}

function toolCall(part: {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: unknown;
}, names: ToolNameCodec): AgentToolCall {
  if (!part.toolCallId || !part.toolName) {
    throw new OfficialModelError("INVALID_TOOL_CALL", "The model returned an invalid tool call");
  }
  // Repaired when possible (code fence, double-encoded JSON, trailing comma); otherwise marked so the
  // runner asks the model to call again instead of failing the whole task.
  return {
    id: part.toolCallId,
    name: names.decode(part.toolName),
    arguments: repairedToolCallArguments(part.input),
  };
}

/** Only Gemini puts a replay signature on a plain text part; other providers' text metadata (item IDs) stays out. */
function textSignatureOptions(value: unknown): ProviderMetadata | undefined {
  const options = safeProviderOptions(value);
  if (!options) return undefined;
  const kept = Object.fromEntries(Object.entries(options).filter(([namespace, entry]) => (namespace === "google" || namespace === "vertex")
    && entry && typeof entry === "object" && "thoughtSignature" in (entry as Record<string, unknown>)));
  return Object.keys(kept).length ? kept as ProviderMetadata : undefined;
}

function safeProviderOptions(value: unknown): ProviderMetadata | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  try {
    const serialized = JSON.stringify(value);
    if (!serialized || serialized.length > MAX_PROVIDER_STATE_BYTES) return undefined;
    const parsed = JSON.parse(serialized) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as ProviderMetadata : undefined;
  } catch {
    return undefined;
  }
}

function savedProviderState(
  toolCallProviderOptions: Readonly<Record<string, ProviderMetadata>>,
  reasoning: readonly { readonly text: string; readonly providerOptions?: ProviderMetadata }[],
  providerScope: string,
  openRouter?: OpenRouterResolvedMetadata,
  replay?: Pick<AiSdkProviderState, "replayScope" | "replayPartsHash" | "replayToolCallsHash">,
  openRouterDetails?: readonly OpenRouterReasoningDetail[],
  textProviderOptions?: ProviderMetadata,
): AiSdkProviderState | undefined {
  const preservedReasoning = reasoning.filter(part => part.text || part.providerOptions);
  if (!Object.keys(toolCallProviderOptions).length && !preservedReasoning.length && !openRouter && !textProviderOptions) return undefined;
  const state: AiSdkProviderState = {
    version: replay ? 2 : 1,
    kind: "ai_sdk_provider_state",
    providerScope,
    toolCallProviderOptions,
    ...replay,
    ...(preservedReasoning.length ? { reasoning: preservedReasoning } : {}),
    ...(openRouter ? { openRouter } : {}),
    ...(openRouterDetails !== undefined ? { openRouterReasoningDetails: openRouterDetails } : {}),
    ...(textProviderOptions ? { textProviderOptions } : {}),
  };
  try {
    const serialized = JSON.stringify(state);
    if (Buffer.byteLength(serialized, "utf8") > MAX_PROVIDER_STATE_BYTES) {
      throw new OfficialModelError("INVALID_RESPONSE", "The model protocol state exceeds the size limit", { params: { maxBytes: MAX_PROVIDER_STATE_BYTES } });
    }
    return JSON.parse(serialized) as AiSdkProviderState;
  } catch (error) {
    if (error instanceof OfficialModelError) throw error;
    throw new OfficialModelError("INVALID_RESPONSE", "The model returned protocol state that cannot be serialized");
  }
}

async function emitModelEvent(request: OfficialModelRequest, event: OfficialModelEvent): Promise<void> {
  await request.onModelEvent?.(event);
  await request.onProviderEvent?.(event);
}

function normalizedUsage(value: {
  readonly inputTokens?: unknown;
  readonly outputTokens?: unknown;
  readonly inputTokenDetails?: {
    readonly cacheReadTokens?: unknown;
    readonly cacheWriteTokens?: unknown;
  };
  readonly outputTokenDetails?: {
    readonly reasoningTokens?: unknown;
  };
  /** Raw provider usage lets us distinguish an explicit zero from AI SDK's
   * normalized default zero (which otherwise looks like a cache miss). */
  readonly raw?: unknown;
}): OfficialModelUsage {
  const raw = value.raw && typeof value.raw === "object" && !Array.isArray(value.raw)
    ? value.raw as Record<string, any> : undefined;
  const firstRaw = (...paths: readonly (readonly string[])[]): unknown => {
    if (!raw) return undefined;
    for (const path of paths) {
      let current: any = raw;
      for (const key of path) current = current?.[key];
      if (current !== undefined && current !== null) return current;
    }
    return undefined;
  };
  const positiveDetail = (candidate: unknown): number | undefined => {
    const value = Number(candidate);
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  };
  // A zero the provider itself sent is a real cache miss; the SDK's own default zero is not (audit B02-04).
  const rawDetail = (candidate: unknown): number | undefined => strictTokenCount(candidate);
  return usagePairWithKnown(value.inputTokens, value.outputTokens, {
    cachedInputTokens: rawDetail(firstRaw(["prompt_tokens_details", "cached_tokens"], ["input_tokens_details", "cached_tokens"], ["cached_tokens"], ["prompt_cache_hit_tokens"], ["cache_read_input_tokens"], ["cachedContentTokenCount"]))
      ?? positiveDetail(value.inputTokenDetails?.cacheReadTokens),
    cacheWriteTokens: rawDetail(firstRaw(["prompt_tokens_details", "cache_write_tokens"], ["input_tokens_details", "cache_write_tokens"], ["cache_write_tokens"], ["cache_creation_input_tokens"]))
      ?? positiveDetail(value.inputTokenDetails?.cacheWriteTokens),
    reasoningTokens: positiveDetail(firstRaw(["completion_tokens_details", "reasoning_tokens"], ["output_tokens_details", "reasoning_tokens"], ["reasoning_tokens"], ["thoughts_token_count"]))
      ?? positiveDetail(value.outputTokenDetails?.reasoningTokens),
  }).usage;
}

function usageFieldsAreKnown(value: {
  readonly inputTokens?: unknown;
  readonly outputTokens?: unknown;
  readonly raw?: unknown;
} | undefined): boolean {
  if (!value) return false;
  const valid = (candidate: unknown): boolean => strictTokenCount(candidate) !== undefined;
  if (!valid(value.inputTokens) || !valid(value.outputTokens)) return false;
  // The SDK fills missing counters with 0 (Gemini's partial usageMetadata, for one). When the provider's own usage
  // object is there, both counters must be in it (audit B02-03).
  const raw = value.raw && typeof value.raw === "object" && !Array.isArray(value.raw) ? value.raw as Record<string, unknown> : undefined;
  if (!raw) return true;
  const has = (...keys: string[]): boolean => keys.some(key => strictTokenCount(raw[key]) !== undefined);
  return has("prompt_tokens", "input_tokens", "promptTokenCount", "inputTokens") && has("completion_tokens", "output_tokens", "candidatesTokenCount", "outputTokens");
}

function normalizedFinishReason(value: unknown, hasToolCalls: boolean): OfficialModelFinishReason {
  return value === "stop" || value === "length" || value === "content-filter"
    || value === "tool-calls" || value === "error" || value === "other"
    ? value
    : hasToolCalls ? "tool-calls" : "other";
}

/** Only a native rejection envelope from a real HTTP 429 can authorize checkpoint continuation. */
function isNativeShortRateLimitRejection(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  if (record.name !== "AI_APICallError" || record.statusCode !== 429
    || typeof record.responseBody !== "string" || record.responseBody.length > 64 * 1024) return false;
  try {
    const body: unknown = JSON.parse(record.responseBody);
    if (!body || typeof body !== "object" || Array.isArray(body)) return false;
    const envelope = body as Record<string, unknown>;
    // Unknown fields may carry consumption or an accepted generation; do not guess them away.
    if (Object.keys(envelope).some(key => !["error", "request_id", "id"].includes(key))) return false;
    // State/consumption words are contradictory even with prose, negation, or ID separators.
    // Do not interpret "not charged" as proof of zero consumption.
    const contradictoryState = (value: string): boolean =>
      /(?:^|[^a-z])(?:accepted|completed|succeeded|running|pending|charged|charging|charges?|billed|billing|consumed|consuming|consumption|usage|cost)(?:[^a-z]|$)/i.test(value);
    const requestIdentifier = (value: unknown): boolean => typeof value === "string"
      && value.length > 0 && value.length <= 200 && /^[A-Za-z0-9._:/-]+$/.test(value)
      && !contradictoryState(value)
      && !/^(?:gen(?:eration)?|generated|task|job|resp(?:onse)?|msg|image|video|audio)(?:[._:/-]|$)/i.test(value);
    for (const key of ["id", "request_id"]) {
      if (Object.prototype.hasOwnProperty.call(envelope, key) && !requestIdentifier(envelope[key])) return false;
    }
    const value = envelope.error;
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const failure = value as Record<string, unknown>;
    if (typeof failure.message !== "string" || !failure.message || failure.message.length > 8_192) return false;
    if (Object.prototype.hasOwnProperty.call(failure, "type")
      && (typeof failure.type !== "string" || !failure.type || failure.type.length > 200)) return false;
    if (Object.prototype.hasOwnProperty.call(failure, "param")
      && failure.param !== null && (typeof failure.param !== "string" || failure.param.length > 200)) return false;
    // A contradictory accepted-generation or consumption signal is never a rate-limit refusal.
    if (Object.values(failure).some(value => typeof value === "string" && (
      contradictoryState(value)
      || /(?:generation[_ -]?id|\b(?:content|output|usage|billing|charged|cost)\s*[:=])/i.test(value)
      || /\b(?:generation|response|completion|task|job)[ ._:-]*(?:accepted|completed|succeeded|running|pending)\b/i.test(value)
    ))) return false;
    return Object.keys(failure).every(key => ["code", "message", "type", "param"].includes(key))
      && typeof failure.code === "string"
      && ["rate_limit_rpm_exceeded", "rate_limit_tpm_exceeded"].includes(failure.code);
  } catch { return false; }
}

/**
 * Independent AI SDK transport. It intentionally coexists with the hand-written
 * adapters until protocol conformance passes in the packaged desktop runtime.
 * The SDK retry count is zero: NextMux never replays a possibly billed request.
 */
export function createAiSdkModelClient(rawOptions: OfficialModelClientOptions): OfficialModelClient {
  assertOrderedOutputSupport(rawOptions);
  const apiKey = rawOptions.apiKey?.trim()
    ? boundedSecret(rawOptions.apiKey)
    : usesProviderEnvironmentCredentials(rawOptions)
      ? ""
      : boundedSecret(rawOptions.apiKey);
  const usesOpenRouterCompatible = rawOptions.providerId === "openrouter"
    && rawOptions.protocol === "openai_chat_completions";
  if (!usesOpenRouterCompatible && rawOptions.openRouterRoutePolicy !== undefined) {
    throw new OfficialModelError("INVALID_REQUEST", "OpenRouter routing policies require OpenRouter Chat Completions");
  }
  const openRouterRoutePolicy = usesOpenRouterCompatible
    ? boundedOpenRouterRoutePolicy(rawOptions.openRouterRoutePolicy)
    : undefined;
  const options: OfficialModelClientOptions = {
    ...rawOptions,
    apiKey,
    model: boundedModel(rawOptions.model),
    ...(openRouterRoutePolicy ? { openRouterRoutePolicy } : {}),
  };
  // Versioning reads the typed address (a trailing "#" pins its root); validation then checks the result.
  const baseUrl = validatedBaseUrl(versionedBaseUrl(rawOptions.baseUrl, rawOptions.protocol, rawOptions.providerId), rawOptions.allowInsecure === true)
    .toString().replace(/\/$/, "");
  const requestTimeout = timeoutMs(rawOptions.timeoutMs);

  return {
    adapterId: "ai_sdk",
    estimateInputTokens: request => estimateAgentModelInputTokens(request.instructions, request.messages, request.tools, options),
    async complete(request) {
      const attemptId = randomUUID();
      const output = new OrderedModelOutput(options.acceptOrderedOutput === true);
      // Every protocol's stream is read through the byte and line budget, not only Gemini's (audit B02-08).
      let providerResponseCount = 0;
      let providerHttpStatus: number | undefined;
      let providerStreamOutputObserved = false;
      const providerFetch = options.fetchImpl ?? fetch;
      const observedFetch: typeof fetch = async (input, init) => {
        const response = await providerFetch(input, init);
        providerResponseCount++;
        providerHttpStatus = response.status;
        return response;
      };
      let boundedOutput: ReturnType<typeof boundedModelOutputFetch> | undefined = boundedModelOutputFetch(observedFetch);
      let usage: OfficialModelUsage = { inputTokens: 0, outputTokens: 0 };
      let usageKnown = false;
      let terminalStarted = false;
      let diagnosticSource: "adapter_exception" | "sdk_stream_error" = "adapter_exception";
      try {
        if (request.signal?.aborted) throw new OfficialModelError("CANCELLED", "Model request cancelled");
        if (shouldAutoDegradeAssistantOutput(options, request)) {
          const portableMessages = portableAssistantOutputMessages(request.messages, options, "ai_sdk");
          if (portableMessages !== request.messages) request = { ...request, messages: portableMessages };
        }
        const replay = await prepareAssistantOutputReplay(options, request, "ai_sdk");
        if (replay) {
          request = replay.request;
          boundedOutput = boundedModelOutputFetch(assistantReplayFetch(observedFetch, replay.maximumRequestBytes, request.signal));
        } else {
          const normalizedMessages = normalizePortableHistory(request.messages, options);
          if (normalizedMessages !== request.messages) request = { ...request, messages: normalizedMessages };
        }
        const unsupportedInput = unsupportedDeclaredModelInput(options, request.messages);
        if (unsupportedInput) throw new OfficialModelError("UNSUPPORTED_CAPABILITY", `The model explicitly does not support ${unsupportedInput}; the request was not sent`, { params: { capability: unsupportedInput } });
        assertRequestSize(request.messages);
        if (options.protocol === "cohere_chat") request = { ...request, messages: cohereAttachmentMessages(request.messages) };
        await emitModelEvent(request, {
          type: "response.started",
          attemptId,
          model: options.model,
        });
        // Provider warnings are represented by the SDK stream/result. Avoid
        // writing model compatibility diagnostics into the desktop process.
        (globalThis as typeof globalThis & { AI_SDK_LOG_WARNINGS?: false }).AI_SDK_LOG_WARNINGS = false;
        let citations: ReturnType<typeof normalizeModelCitations> = [];
        const observeCitations = (value: unknown): void => { citations = normalizeModelCitations([...citations, ...normalizeModelCitations(value)]); };
        const [{ dynamicTool, jsonSchema, streamText }, model] = await Promise.all([
          import("ai"),
          languageModel({ ...options, fetchImpl: modelContractFetch(boundedOutput?.fetch ?? options.fetchImpl ?? fetch, options, request) }, baseUrl, observeCitations),
        ]);
        const names = createToolNameCodec(request.tools);
        const cacheAnthropic = options.protocol === "anthropic_messages";
        const tools: ToolSet = {};
        for (const [index, descriptor] of request.tools.entries()) {
          const sanitizedSchema = options.protocol === "gemini_generate_content"
            ? geminiSchema(descriptor.inputSchema)
            : portableSchema(descriptor.inputSchema);
          tools[names.encode(descriptor.name)] = dynamicTool({
            description: descriptor.description,
            inputSchema: jsonSchema(sanitizedSchema),
            // Responses may otherwise normalize optional tool fields into required fields.
            ...(options.protocol === "openai_responses" ? { strict: false } : {}),
            ...(cacheAnthropic && index === request.tools.length - 1 ? { providerOptions: ANTHROPIC_CACHE_OPTIONS } : {}),
          });
        }
        const promptCacheKey = typeof request.promptCacheKey === "string"
          && request.promptCacheKey.trim().length > 0
          && request.promptCacheKey.trim().length <= 128
          ? request.promptCacheKey.trim()
          : undefined;
        // The Responses API accepts native non-PDF documents. The SDK keeps
        // this explicit opt-in so document bytes are preserved as input_file,
        // never decoded as text. The model picker still requires MIME evidence.
        const passThroughUnsupportedFiles = options.protocol === "openai_responses"
          && request.messages.some(message => message.attachments?.some(attachment => attachment.kind === "file"
            && attachment.mimeType !== "application/pdf" && !attachment.mimeType.startsWith("image/")));
        const providerOptions = usesOpenRouterCompatible
          || (options.providerId === "openai" && promptCacheKey) || passThroughUnsupportedFiles
          ? {
              ...(usesOpenRouterCompatible ? openRouterProviderOptions(options.openRouterRoutePolicy) : {}),
              // The first-party OpenAI adapter maps this stable identity to
              // prompt_cache_key. Compatible relays are deliberately not sent
              // an unknown provider option.
              ...((options.providerId === "openai" && promptCacheKey) || passThroughUnsupportedFiles ? { openai: {
                ...(options.providerId === "openai" && promptCacheKey ? { promptCacheKey } : {}),
                ...(passThroughUnsupportedFiles ? { passThroughUnsupportedFiles: true } : {}),
              } } : {}),
            }
          : undefined;
        const messageOptions = { providerId: options.providerId, model: options.model,
          reasoningEnabled: request.reasoningEnabled, reasoningMode: request.reasoningMode };
        const result = streamText({
          model,
          instructions: cacheAnthropic && request.instructions
            ? { role: "system", content: request.instructions, providerOptions: ANTHROPIC_CACHE_OPTIONS }
            : request.instructions,
          messages: cacheAnthropic
            ? anthropicCachedMessages(mapMessages(request.messages, names, assistantReplayScope(options, "ai_sdk"), replay, request.reasoningExclude, messageOptions))
            : mapMessages(request.messages, names, assistantReplayScope(options, "ai_sdk"), replay, request.reasoningExclude, messageOptions),
          tools,
          toolChoice: request.tools.length ? "auto" : undefined,
          // Reasoning controls are applied from the model declaration at the wire seam.
          maxOutputTokens: request.maxOutputTokens,
          providerOptions,
          abortSignal: request.signal,
          ...(requestTimeout > 0 ? { timeout: requestTimeout } : {}),
          maxRetries: 0,
          telemetry: { isEnabled: false },
          // Every protocol's SSE chunks are inspected for in-stream errors and safety
          // blocks (Cherry Studio #4). Reuse the SDK's parsed raw-chunk seam locally;
          // never emit or save raw chunks.
          include: { rawChunks: true },
          // AI SDK defaults to console.error for streaming failures, which can
          // include a provider response body. The structured catch path below
          // is the only allowed error surface.
          onError: () => {},
        });
        let content = "";
        const calls = new Map<string, AgentToolCall>();
        const incompleteCalls = new Map<string, { call: AgentToolCall; providerOptions?: ProviderMetadata }>();
        const toolCallProviderOptions: Record<string, ProviderMetadata> = {};
        let textProviderOptions: ProviderMetadata | undefined;
        const reasoningById = new Map<string, { text: string; providerOptions?: ProviderMetadata }>();
        const startedToolCalls = new Set<string>();
        const toolCallsWithInput = new Set<string>();
        const openContent = new Set<string>();
        const openReasoning = new Set<string>();
        let finishReason: OfficialModelFinishReason = "other";
        let resolvedModel = options.model;
        let openRouterProviderMetadata: ProviderMetadata | undefined;
        let openRouterResponseHeaders: Readonly<Record<string, string>> | undefined;
        const inlineThinkSplitter = createInlineThinkTagSplitter(inlineThinkTagsFor(options.model));
        const inlineReasoningItemId = `inline-think-${attemptId}`;
        let nativeReasoningObserved = false;
        let lastTextPartId = `text-${attemptId}`;

        const emitInlineReasoning = async (delta: string, closedNow: boolean): Promise<void> => {
          if (delta) {
            if (!openReasoning.has(inlineReasoningItemId)) {
              openReasoning.add(inlineReasoningItemId);
              await emitModelEvent(request, { type: "reasoning.started", attemptId, itemId: inlineReasoningItemId });
            }
            const current = reasoningById.get(inlineReasoningItemId) ?? { text: "" };
            reasoningById.set(inlineReasoningItemId, { text: current.text + delta });
            await emitModelEvent(request, { type: "reasoning.delta", attemptId, itemId: inlineReasoningItemId, delta });
            await request.onReasoningDelta?.(delta);
          }
          if (closedNow && openReasoning.delete(inlineReasoningItemId)) {
            await emitModelEvent(request, { type: "reasoning.completed", attemptId, itemId: inlineReasoningItemId });
          }
        };

        const emitVisibleText = async (partId: string, delta: string): Promise<void> => {
          if (!delta) return;
          if (!openContent.has(partId)) {
            openContent.add(partId);
            await emitModelEvent(request, { type: "content.started", attemptId, itemId: partId });
          }
          content += delta;
          output.text(partId, delta);
          await emitModelEvent(request, {
            type: "content.delta",
            attemptId,
            itemId: partId,
            delta,
          });
          await request.onTextDelta?.(delta);
        };

        for await (const part of result.stream) {
          // SDK startup/error parts also occur when an HTTP request is refused.
          // Every provider output/usage part makes continuation fail closed.
          if (part.type !== "start" && part.type !== "error") providerStreamOutputObserved = true;
          if (part.type === "raw") {
            const raw = part.rawValue as any;
            // In-stream error detection (Cherry Studio #4): an HTTP 200 stream can still
            // carry an error chunk or a safety-filter finish. Fail closed with typed errors.
            const streamedError = raw?.error;
            // A provider-declared upstream_error keeps its fixed public
            // MODEL_CALL_FAILED classification through the SDK error part below
            // (test/failure-diagnostics.test.mts); only a specific client-side
            // rejection becomes REQUEST_REJECTED here.
            const streamedErrorType = String(streamedError?.type ?? streamedError?.code ?? "").toLowerCase();
            if (streamedError && typeof streamedError === "object"
              && (streamedError.message || streamedError.code || streamedError.type)
              && streamedErrorType !== "upstream_error") {
              throw new OfficialModelError("REQUEST_REJECTED", "The model service returned an error inside the stream", {
                readableError: classifyModelError({ httpStatus: 200, error: streamedError }),
                httpStatus: 200,
                stage: "stream",
              });
            }
            if (raw?.choices?.[0]?.finish_reason === "content_filter") {
              throw contentFilterError(contentFilterCategories(raw.choices[0].content_filter_details ?? raw.choices[0].content_filter_results),
                { httpStatus: 200, stage: "stream" });
            }
            // Gemini blocks a prompt with promptFeedback and no candidate (SAFETY, BLOCKLIST, PROHIBITED_CONTENT, IMAGE_SAFETY…).
            if (typeof raw?.promptFeedback?.blockReason === "string" && raw.promptFeedback.blockReason !== "BLOCK_REASON_UNSPECIFIED") {
              throw contentFilterError(raw.promptFeedback.blockReason.slice(0, 80), { httpStatus: 200, stage: "stream" });
            }
            if (usesOpenRouterCompatible) {
              const delta = raw?.choices?.[0]?.delta;
              const readable = openRouterReadableReasoning(openRouterReasoningDetails(delta?.reasoning_details));
              // Plain reasoning is already emitted by the compatible SDK.
              // Encrypted data/signatures never enter user-facing events.
              if (readable && !delta.reasoning && !delta.reasoning_content && !content) {
                nativeReasoningObserved = true;
                const itemId = "openrouter-details";
                if (!openReasoning.has(itemId)) {
                  openReasoning.add(itemId);
                  await emitModelEvent(request, { type: "reasoning.started", attemptId, itemId });
                }
                await emitModelEvent(request, { type: "reasoning.delta", attemptId, itemId, delta: readable });
                await request.onReasoningDelta?.(readable);
              }
              if ((delta?.content || delta?.tool_calls?.length) && openReasoning.delete("openrouter-details")) {
                await emitModelEvent(request, { type: "reasoning.completed", attemptId, itemId: "openrouter-details" });
              }
            }
            if (options.protocol === "cohere_chat" && (raw?.type === "citation-start" || raw?.type === "citation-end")) {
              observeCitations(cohereModelCitations(raw.delta?.message?.citations));
            }
            // The installed Gemini SDK has no visible fileData URL result. Fail
            // explicitly instead of letting its optional-text schema erase it.
            if (options.protocol === "gemini_generate_content" && Array.isArray(raw?.candidates?.[0]?.content?.parts)) {
              for (const item of raw.candidates[0].content.parts) {
                if (!item?.thought && (item?.fileData || (item?.inlineData && item?.thoughtSignature))) {
                  // Signed visible media needs a private replay/reference contract
                  // before its signature can safely be separated from its bytes.
                  output.media(undefined, () => undefined);
                }
              }
            }
          } else if (part.type === "source" && part.sourceType === "url") {
            citations = normalizeModelCitations([...citations, { url: part.url, title: part.title }]);
          } else if (part.type === "text-start") {
            textProviderOptions = textSignatureOptions(part.providerMetadata) ?? textProviderOptions;
            lastTextPartId = part.id;
            if (nativeReasoningObserved) {
              openContent.add(part.id);
              await emitModelEvent(request, { type: "content.started", attemptId, itemId: part.id });
            }
          } else if (part.type === "text-delta") {
            textProviderOptions = textSignatureOptions(part.providerMetadata) ?? textProviderOptions;
            lastTextPartId = part.id;
            if (!part.text) continue;
            if (nativeReasoningObserved) {
              await emitVisibleText(part.id, part.text);
            } else {
              const split = inlineThinkSplitter.push(part.text);
              await emitInlineReasoning(split.reasoning, split.closedNow);
              await emitVisibleText(part.id, split.content);
            }
          } else if (part.type === "file") {
            // A visible file is never silently discarded for text-only consumers.
            // reasoning-file intentionally does not enter this visible-content path.
            output.media(part.file.mediaType, () => part.file.base64);
          } else if (part.type === "text-end") {
            textProviderOptions = textSignatureOptions(part.providerMetadata) ?? textProviderOptions;
            if (!nativeReasoningObserved) {
              const flushed = inlineThinkSplitter.flush();
              await emitInlineReasoning(flushed.reasoning, flushed.closedNow);
              if (flushed.content) await emitVisibleText(part.id, flushed.content);
            }
            if (openContent.delete(part.id)) {
              await emitModelEvent(request, { type: "content.completed", attemptId, itemId: part.id });
            }
          } else if (part.type === "reasoning-start") {
            nativeReasoningObserved = true;
            const disabled = inlineThinkSplitter.disable();
            await emitInlineReasoning(disabled.reasoning, disabled.closedNow);
            if (disabled.content) await emitVisibleText(lastTextPartId, disabled.content);
            openReasoning.add(part.id);
            const providerOptions = safeProviderOptions(part.providerMetadata);
            reasoningById.set(part.id, {
              text: "",
              ...(providerOptions ? { providerOptions } : {}),
            });
            await emitModelEvent(request, { type: "reasoning.started", attemptId, itemId: part.id });
          } else if (part.type === "reasoning-delta") {
            nativeReasoningObserved = true;
            const current = reasoningById.get(part.id) ?? { text: "" };
            const providerOptions = safeProviderOptions(part.providerMetadata) ?? current.providerOptions;
            reasoningById.set(part.id, {
              text: current.text + part.text,
              ...(providerOptions ? { providerOptions } : {}),
            });
            if (part.text) {
              await emitModelEvent(request, {
                type: "reasoning.delta",
                attemptId,
                itemId: part.id,
                delta: part.text,
              });
              await request.onReasoningDelta?.(part.text);
            }
          } else if (part.type === "reasoning-end") {
            openReasoning.delete(part.id);
            const providerOptions = safeProviderOptions(part.providerMetadata);
            if (providerOptions) {
              const current = reasoningById.get(part.id) ?? { text: "" };
              reasoningById.set(part.id, { ...current, providerOptions });
            }
            await emitModelEvent(request, { type: "reasoning.completed", attemptId, itemId: part.id });
          } else if (part.type === "tool-input-start") {
            const name = names.decode(part.toolName);
            startedToolCalls.add(part.id);
            await emitModelEvent(request, {
              type: "tool_call.started",
              attemptId,
              callId: part.id,
              name,
            });
          } else if (part.type === "tool-input-delta") {
            if (!part.delta) continue;
            if (part.delta.trim()) toolCallsWithInput.add(part.id);
            await emitModelEvent(request, {
              type: "tool_call.arguments_delta",
              attemptId,
              callId: part.id,
              delta: part.delta,
            });
          } else if (part.type === "tool-call") {
            const call = toolCall(part, names);
            // OpenAI SDK trackers default a stream with no argument bytes to {}.
            // On an output limit that is an unfinished call, unlike explicit {}.
            const missingStreamedInput = (options.protocol === "openai_chat_completions" || options.protocol === "openai_responses")
              && startedToolCalls.has(call.id) && !toolCallsWithInput.has(call.id);
            if (!startedToolCalls.has(call.id)) {
              startedToolCalls.add(call.id);
              await emitModelEvent(request, {
                type: "tool_call.started",
                attemptId,
                callId: call.id,
                name: call.name,
              });
            }
            const providerOptions = safeProviderOptions(part.providerMetadata);
            // A provider can finish with length after emitting an unfinished JSON call.
            // Keep that diagnostic for ordinary failures, but never present it as a complete call on truncation.
            if (missingStreamedInput || invalidToolArguments(call.arguments) || part.invalid && (part.input === undefined
              || typeof part.input === "string" && !part.input.trim())) {
              incompleteCalls.set(call.id, { call, providerOptions });
              continue;
            }
            calls.set(call.id, call);
            if (providerOptions) toolCallProviderOptions[call.id] = providerOptions;
            await emitModelEvent(request, { type: "tool_call.completed", attemptId, toolCall: call });
          } else if (part.type === "finish-step") {
            resolvedModel = part.response.modelId || resolvedModel;
            if (usesOpenRouterCompatible) {
              openRouterProviderMetadata = safeProviderOptions(part.providerMetadata);
              openRouterResponseHeaders = part.response.headers;
            }
          } else if (part.type === "finish") {
            usage = normalizedUsage(part.totalUsage);
            usageKnown = usageFieldsAreKnown(part.totalUsage);
            finishReason = normalizedFinishReason(part.finishReason, calls.size > 0);
          } else if (part.type === "abort") {
            throw new OfficialModelError("CANCELLED", "Model request cancelled");
          } else if (part.type === "error") {
            diagnosticSource = "sdk_stream_error";
            throw part.error;
          }
        }
        if (!nativeReasoningObserved) {
          const flushed = inlineThinkSplitter.flush();
          await emitInlineReasoning(flushed.reasoning, flushed.closedNow);
          if (flushed.content) await emitVisibleText(lastTextPartId, flushed.content);
        }
        if (request.signal?.aborted) throw new OfficialModelError("CANCELLED", "Model request cancelled");
        if (finishReason !== "length") for (const { call, providerOptions } of incompleteCalls.values()) {
          calls.set(call.id, call);
          if (providerOptions) toolCallProviderOptions[call.id] = providerOptions;
          await emitModelEvent(request, { type: "tool_call.completed", attemptId, toolCall: call });
        }
        // A provider that ends its stream with an error (Gemini sends it inside the stream) has not answered, even when
        // some text or complete-looking tool calls arrived first; nothing from it may run as a success (audit B02-02).
        if (finishReason === "error") {
          throw new OfficialModelError("INVALID_RESPONSE", "The model stream ended with an error", {
            readableError: classifyModelError({ code: 'INVALID_RESPONSE', finish_reason: finishReason }),
          });
        }
        // A safety stop (OpenAI content_filter, Gemini SAFETY family, Claude refusal) is not an answer, even after
        // partial text: it fails with the one content-filter error instead of "no assistant message" or a cut-off success.
        if (finishReason === "content-filter") throw contentFilterError("", { httpStatus: 200, stage: "stream" });
        const outputParts = output.finish(usage, usageKnown);
        // A reasoning-only answer is still an answer (Cherry Studio #1): a small reasoning
        // budget can be spent thinking, so visible text may legitimately be empty.
        if (finishReason !== "length" && !content && !calls.size && !reasoningById.size
          && !outputParts?.some(part => part.type !== "text")) {
          throw new OfficialModelError("INVALID_RESPONSE", "The model returned no assistant message", {
            readableError: classifyModelError({ code: 'INVALID_RESPONSE', finish_reason: finishReason }),
          });
        }
        for (const itemId of openContent) {
          await emitModelEvent(request, { type: "content.completed", attemptId, itemId });
        }
        for (const itemId of openReasoning) {
          await emitModelEvent(request, { type: "reasoning.completed", attemptId, itemId });
        }
        const openRouter = usesOpenRouterCompatible
          ? resolvedOpenRouterMetadata({
              requestedModel: options.model,
              providerMetadata: openRouterProviderMetadata,
              responseHeaders: openRouterResponseHeaders,
              usageKnown,
            })
          : undefined;
        if (openRouter?.model.verified) resolvedModel = openRouter.model.value;
        const scopeOptions = openRouter?.model.verified ? { ...options, model: openRouter.model.value } : options;
        const providerState = savedProviderState(toolCallProviderOptions, [...reasoningById.values()], assistantReplayScope(scopeOptions, "ai_sdk"), openRouter,
          outputParts?.some(part => part.type !== "text") ? { replayScope: assistantReplayScope(options, "ai_sdk"),
            replayPartsHash: returnedPartsHash(outputParts), replayToolCallsHash: replayToolCallsHash([...calls.values()]) } : undefined,
          openRouterReasoningDetails(openRouterProviderMetadata?.openrouter?.reasoning_details), textProviderOptions);
        await emitModelEvent(request, { type: "usage", attemptId, usage });
        if (request.signal?.aborted) throw new OfficialModelError("CANCELLED", "Model request cancelled");
        terminalStarted = true;
        await emitModelEvent(request, {
          type: "response.completed",
          attemptId,
          model: resolvedModel,
          finishReason,
          usage,
          ...(citations.length ? { citations } : {}),
        });
        return {
          finishReason,
          content,
          toolCalls: [...calls.values()],
          model: resolvedModel,
          usage,
          ...(usageKnown ? {} : { usageKnown: false }),
          ...(outputParts ? { outputParts } : {}),
          ...(citations.length ? { citations } : {}),
          ...(providerState ? { providerState } : {}),
        };
      } catch (error) {
        const boundedFailure = boundedOutput?.failure();
        let failure = normalizeOfficialModelError(terminalStarted ? terminalDeliveryError(usage, usageKnown)
          : boundedFailure ? outputErrorWithUsage(boundedFailure, usage, usageKnown) : error,
          { signal: request.signal, attemptId, diagnosticSource, provider: options.providerId });
        if (usageKnown && failure.usageKnown === undefined) failure = outputErrorWithUsage(failure, usage, true);
        if (providerResponseCount === 1 && providerHttpStatus === 429 && !providerStreamOutputObserved
          && !terminalStarted && !request.signal?.aborted && !usageKnown && failure.usage === undefined
          && failure.code === "RATE_LIMITED"
          && !["balance_insufficient", "provider_quota_exhausted"].includes(failure.readableError.kind)
          && isNativeShortRateLimitRejection(error)) {
          // The endpoint explicitly refused this generation. Continue from the
          // existing checkpoint; never replay completed tools or assert zero fees.
          failure = new OfficialModelError(failure.code, failure.publicMessage, { ...failure.toJSON(), retrySafe: true });
        }
        try {
          if (!terminalStarted && !request.signal?.aborted && failure.code !== "CANCELLED") await emitModelEvent(request, {
            type: "response.failed",
            attemptId,
            error: failure.toJSON(),
          });
        } catch {
          // Preserve the provider failure if the event sink is unavailable.
        }
        throw failure;
      }
    },
  };
}
