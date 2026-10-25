import { messagesWithToolImages } from "./tool-result-images.js";
import type { AgentModelMessage, AgentToolCall } from "@nextmux/agent-runtime";
import { invalidToolArguments } from "@nextmux/agent-runtime";

import { OfficialModelError, postJson, usagePairWithKnown } from "./http.js";
import { createToolNameCodec, type ToolNameCodec } from "./tool-names.js";
import type { AdapterInvocation, AdapterResult } from "./types.js";
import { cohereModelCitations } from "./citations.js";
import { cohereAttachmentMessages } from "./cohere-attachments.js";
import { nativeFinishReason } from "./finish-reason.js";
import { repairedToolCallArguments } from "./inline-think.js";

function messages(input: readonly AgentModelMessage[], toolNames: ToolNameCodec): unknown[] {
  return messagesWithToolImages(cohereAttachmentMessages(input)).map(({ message }) => {
    if (message.role === "tool") {
      return {
        role: "tool",
        tool_call_id: message.toolCallId,
        content: [{ type: "document", document: { data: message.content } }]
      };
    }
    if (message.role === "assistant" && message.toolCalls?.length) {
      return {
        role: "assistant",
        content: message.content ? [{ type: "text", text: message.content }] : [],
        tool_calls: message.toolCalls.map(call => ({
          id: call.id,
          type: "function",
          function: { name: toolNames.encode(call.name), arguments: JSON.stringify(call.arguments ?? {}) }
        }))
      };
    }
    if (message.role === "user" && message.attachments?.length) {
      const content: unknown[] = [{ type: "text", text: message.content }];
      for (const attachment of message.attachments) {
        if (attachment.kind === "text") content.push({ type: "text", text: `\n\n<file name="${attachment.name}">\n${attachment.content}\n</file>` });
        else if (attachment.kind === "image") content.push({ type: "image_url", image_url: { url: `data:${attachment.mimeType};base64,${attachment.dataBase64}` } });
      }
      return { role: "user", content };
    }
    return { role: message.role, content: message.content };
  });
}

function toolCalls(value: unknown, toolNames: ToolNameCodec, truncated: boolean): readonly AgentToolCall[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 16) {
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

export async function invokeCohere(invocation: AdapterInvocation): Promise<AdapterResult> {
  const toolNames = createToolNameCodec(invocation.tools);
  const payload = await postJson({
    endpoint: invocation.endpoint,
    headers: { authorization: `Bearer ${invocation.apiKey}` },
    body: {
      model: invocation.model,
      messages: [
        ...(invocation.instructions ? [{ role: "system", content: invocation.instructions }] : []),
        ...messages(invocation.messages, toolNames)
      ],
      stream: false,
      ...(invocation.maxOutputTokens === undefined ? {} : { max_tokens: invocation.maxOutputTokens }),
      ...(invocation.tools.length ? {
        tools: invocation.tools.map(tool => ({
          type: "function",
          function: {
            name: toolNames.encode(tool.name),
            description: tool.description,
            parameters: tool.inputSchema
          }
        }))
      } : {})
    },
    signal: invocation.signal,
    timeoutMs: invocation.timeoutMs,
    fetchImpl: invocation.fetchImpl
  });
  const message = payload?.message;
  const truncated = payload?.finish_reason === "MAX_TOKENS";
  const calls = toolCalls(message?.tool_calls, toolNames, truncated);
  const content = Array.isArray(message?.content)
    ? message.content.filter((item: any) => item?.type === "text" && typeof item.text === "string").map((item: any) => item.text).join("")
    : typeof message?.content === "string" ? message.content : "";
  if (!message || (!truncated && !content && calls.length === 0)) {
    throw new OfficialModelError("INVALID_RESPONSE", "The model returned no assistant message");
  }
  // billed_units is what is charged; `tokens` also counts the prompt template Cohere adds (audit B02-05).
  const usage = payload?.usage?.billed_units || payload?.usage?.tokens || payload?.usage || {};
  const normalizedUsage = usagePairWithKnown(usage.input_tokens ?? usage.prompt_tokens, usage.output_tokens ?? usage.completion_tokens, {
    cachedInputTokens: usage.cached_input_tokens ?? usage.cache_read_input_tokens,
    cacheWriteTokens: usage.cache_write_tokens ?? usage.cache_creation_input_tokens,
    reasoningTokens: usage.reasoning_tokens ?? usage.thinking_tokens,
  });
  return {
    finishReason: nativeFinishReason(payload?.finish_reason, calls.length > 0),
    content,
    citations: cohereModelCitations(message.citations),
    toolCalls: calls,
    model: typeof payload.model === "string" ? payload.model : invocation.model,
    ...normalizedUsage,
  };
}
