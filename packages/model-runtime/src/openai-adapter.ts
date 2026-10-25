import { messagesWithToolImages } from "./tool-result-images.js";
import type { AgentModelMessage, AgentToolCall } from "@nextmux/agent-runtime";
import { invalidToolArguments } from "@nextmux/agent-runtime";

import { contentFilterCategories, contentFilterError, OfficialModelError, postJson, usagePairWithKnown } from "./http.js";
import { classifyModelError } from "./errors.js";
import { createToolNameCodec, type ToolNameCodec } from "./tool-names.js";
import type { AdapterInvocation, AdapterResult } from "./types.js";
import { normalizeModelCitations } from "./citations.js";
import { nativeFinishReason } from "./finish-reason.js";
import { healOrphanToolCalls, portableSchema, stripHistoricalReasoningFromMessages } from "./portable-history.js";
import { inlineThinkTagsFor, repairedToolCallArguments, splitInlineThink } from "./inline-think.js";
import { guardReasoningModelSamplingParameters, resolveCreativityTemperature } from "./model-contract.js";

function storedOpenAIReasoning(message: AgentModelMessage, replayScope?: string): { sameScope: boolean; text: string } | undefined {
  const state = message.providerState as any;
  if (!state || typeof state !== "object" || Array.isArray(state)) return undefined;
  if (state.kind === "openai-chat-v1" && typeof state.reasoning_content === "string" && state.reasoning_content.trim()) {
    return {
      sameScope: Boolean(replayScope && state.scope === replayScope),
      text: state.reasoning_content,
    };
  }
  if (state.kind === "ai_sdk_provider_state" && Array.isArray(state.reasoning)) {
    const joined = state.reasoning
      .filter((item: any) => item && typeof item.text === "string")
      .map((item: any) => item.text)
      .join("");
    if (joined.trim()) {
      return {
        sameScope: Boolean(replayScope && (state.providerScope === replayScope || state.replayScope === replayScope)),
        text: joined,
      };
    }
  }
  return undefined;
}

function mapMessages(messages: readonly AgentModelMessage[], toolNames: ToolNameCodec, invocation: AdapterInvocation): unknown[] {
  // Cross-provider hygiene (Cherry Studio #2): historical reasoning artifacts never
  // travel to another provider, and every assistant tool_calls entry keeps a matching
  // tool result even when an earlier turn was aborted mid-tool. Idempotent with the
  // host-level normalizePortableHistory pass.
  const sanitized = healOrphanToolCalls(stripHistoricalReasoningFromMessages(messages));
  const entries = messagesWithToolImages(sanitized);
  let lastUserIndex = -1;
  for (let idx = entries.length - 1; idx >= 0; idx--) {
    if (entries[idx]!.message.role === "user") {
      lastUserIndex = idx;
      break;
    }
  }
  const isDeepSeek = invocation.providerId === "deepseek" || /deepseek/i.test(invocation.model || "");
  const requiresReasoningOnToolCalls = /deepseek-reasoner|deepseek-r1|deepseek-v3\.2|kimi-k2/i.test(invocation.model || "")
    || (isDeepSeek && (invocation.reasoningEnabled === true || invocation.reasoningMode === "enabled"));
  return entries.map(({ message }, index) => {
    if (message.role === "tool") {
      return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
    }
    if (message.role === "assistant") {
      const reasoning = storedOpenAIReasoning(message, invocation.replayScope);
      if (message.toolCalls?.length) {
        const reasoningValue = reasoning?.sameScope
          ? reasoning.text
          : (requiresReasoningOnToolCalls && index > lastUserIndex ? (reasoning?.text ?? "") : undefined);
        return {
          role: "assistant",
          content: message.content || null,
          ...(reasoningValue !== undefined ? { reasoning_content: reasoningValue } : {}),
          tool_calls: message.toolCalls.map(call => ({
            id: call.id,
            type: "function",
            function: { name: toolNames.encode(call.name), arguments: JSON.stringify(call.arguments ?? {}) }
          }))
        };
      }
      return {
        role: "assistant",
        content: message.content,
        ...(reasoning?.sameScope ? { reasoning_content: reasoning.text } : {}),
      };
    }
    if (message.role === "user" && message.attachments?.length) {
      const content: unknown[] = [...(message.content ? [{ type: "text", text: message.content }] : [])];
      for (const attachment of message.attachments) {
        if (attachment.kind === "text") content.push({ type: "text", text: `\n\n<file name="${attachment.name}">\n${attachment.content}\n</file>` });
        else if (attachment.kind === "image") content.push({ type: "image_url", image_url: { url: `data:${attachment.mimeType};base64,${attachment.dataBase64}` } });
        else content.push({ type: "file", file: { filename: attachment.name, file_data: `data:${attachment.mimeType};base64,${attachment.dataBase64}` } });
      }
      return { role: "user", content };
    }
    return { role: message.role, content: message.content };
  });
}

function parseToolCalls(value: unknown, toolNames: ToolNameCodec, truncated: boolean): readonly AgentToolCall[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 64) {
    throw new OfficialModelError("INVALID_TOOL_CALL", "The model returned an invalid tool call");
  }
  return value.flatMap((candidate: any) => {
    if (candidate?.type !== "function" || typeof candidate.id !== "string"
      || typeof candidate.function?.name !== "string") {
      if (truncated) return [];
      throw new OfficialModelError("INVALID_TOOL_CALL", "The model returned an invalid tool call");
    }
    if (truncated && (candidate.function.arguments === undefined || candidate.function.arguments === null
      || typeof candidate.function.arguments === "string" && !candidate.function.arguments.trim())) return [];
    const argumentsValue = repairedToolCallArguments(candidate.function.arguments || "{}");
    if (truncated && invalidToolArguments(argumentsValue)) return [];
    return [{
      id: candidate.id,
      name: toolNames.decode(candidate.function.name),
      arguments: argumentsValue,
    }];
  });
}

export async function invokeOpenAICompatible(invocation: AdapterInvocation): Promise<AdapterResult> {
  const toolNames = createToolNameCodec(invocation.tools);
  // Creativity mode: "normal" sends no temperature; rigorous/creative resolve a fixed value. Reasoning models
  // (OpenAI o-series/GPT-5+, DeepSeek reasoner/R1) drop sampling parameters here; modelContractFetch then applies the
  // full contract (Claude thinking, max_completion_tokens on official endpoints) to the wire body.
  const creativityTemperature = resolveCreativityTemperature(invocation.creativityMode);
  const wireBody = guardReasoningModelSamplingParameters({
    model: invocation.model,
    ...(invocation.outputSchema ? { response_format: { type: "json_schema", json_schema: { name: invocation.outputSchema.name, schema: invocation.outputSchema.schema } } } : {}),
    messages: [
      ...(invocation.instructions ? [{ role: "system", content: invocation.instructions }] : []),
      ...mapMessages(invocation.messages, toolNames, invocation)
    ],
    ...(invocation.reasoningEffort ? { reasoning_effort: invocation.reasoningEffort } : {}),
    ...(creativityTemperature === undefined ? {} : { temperature: creativityTemperature }),
    ...(invocation.maxOutputTokens === undefined ? {} : { max_tokens: invocation.maxOutputTokens }),
    ...(invocation.tools.length ? {
      tools: invocation.tools.map(tool => ({
        type: "function",
        function: {
          name: toolNames.encode(tool.name),
          description: tool.description,
          parameters: portableSchema(tool.inputSchema)
        }
      })),
      tool_choice: "auto"
    } : {})
  }, { model: invocation.model });
  const payload = await postJson({
    endpoint: invocation.endpoint,
    headers: { authorization: `Bearer ${invocation.apiKey}` },
    body: wireBody,
    signal: invocation.signal,
    timeoutMs: invocation.timeoutMs,
    fetchImpl: invocation.fetchImpl
  });
  const message = payload?.choices?.[0]?.message;
  const truncated = payload?.choices?.[0]?.finish_reason === "length";
  const rawUsage = payload?.usage ?? payload?.choices?.[0]?.usage;
  const usage = usagePairWithKnown(rawUsage?.prompt_tokens, rawUsage?.completion_tokens, {
    cachedInputTokens: rawUsage?.prompt_tokens_details?.cached_tokens
      ?? rawUsage?.prompt_tokens_details?.cache_read_tokens
      ?? rawUsage?.prompt_cache_hit_tokens
      ?? rawUsage?.cached_tokens
      ?? rawUsage?.cache_read_input_tokens,
    cacheWriteTokens: rawUsage?.prompt_tokens_details?.cache_write_tokens
      ?? rawUsage?.cache_write_tokens
      ?? rawUsage?.cache_creation_input_tokens,
    reasoningTokens: rawUsage?.completion_tokens_details?.reasoning_tokens
      ?? rawUsage?.reasoning_tokens,
  });
  // A safety stop on an HTTP 200 body (content_filter, or a relay passing through safety/refusal) is not an answer
  // (Cherry Studio #4); it fails as the one content-filter error, carrying the usage the provider reported.
  if (nativeFinishReason(payload?.choices?.[0]?.finish_reason, false) === "content-filter") {
    throw contentFilterError(contentFilterCategories(payload.choices[0].content_filter_details ?? payload.choices[0].content_filter_results), {
      httpStatus: 200, stage: "response", ...usage, ...(usage.usageKnown === false ? {} : { usageKnown: true }),
    });
  }
  if (!message || (!truncated && typeof message.content !== "string" && !Array.isArray(message.tool_calls))) {
    throw new OfficialModelError("INVALID_RESPONSE", "The model returned no assistant message", { readableError: classifyModelError(payload) });
  }
  const toolCalls = parseToolCalls(message.tool_calls, toolNames, truncated);
  const explicitReasoning = typeof message.reasoning_content === "string" && message.reasoning_content.trim()
    ? message.reasoning_content
    : typeof message.reasoning === "string" && message.reasoning.trim()
      ? message.reasoning
      : undefined;
  const rawContent = typeof message.content === "string" ? message.content : "";
  const split = !explicitReasoning && rawContent ? splitInlineThink(rawContent, inlineThinkTagsFor(invocation.model)) : { reasoning: "", content: rawContent };
  const rawReasoning = explicitReasoning ?? (split.reasoning || undefined);
  // An HTTP 200 answer with zero text, zero reasoning and zero tool calls is a typed
  // failure, not a silent empty response (Cherry Studio #4). A native length verdict
  // permits an empty assistant turn (test/output-truncation.test.mts).
  if (!truncated && !split.content && !toolCalls.length && !rawReasoning) {
    throw new OfficialModelError("EMPTY_RESPONSE", "The model service returned an empty response", {
      readableError: {
        kind: "invalid_response",
        code: "EMPTY_RESPONSE",
        detail: `finish_reason: ${String(payload?.choices?.[0]?.finish_reason ?? "unknown")}`,
      },
      ...usage,
      ...(usage.usageKnown === false ? {} : { usageKnown: true }),
    });
  }
  const providerState = rawReasoning && Buffer.byteLength(rawReasoning, "utf8") <= 256_000
    ? {
        kind: "openai-chat-v1" as const,
        ...(invocation.replayScope ? { scope: invocation.replayScope } : {}),
        reasoning_content: rawReasoning,
      }
    : undefined;
  return {
    finishReason: nativeFinishReason(payload?.choices?.[0]?.finish_reason, toolCalls.length > 0),
    content: split.content,
    citations: normalizeModelCitations(Array.isArray(message.annotations)
      ? message.annotations.slice(0, 128).filter((item: any) => item?.type === "url_citation").map((item: any) => item.url_citation) : []),
    toolCalls,
    model: typeof payload.model === "string" ? payload.model : invocation.model,
    ...(providerState ? { providerState } : {}),
    ...usage,
  };
}
