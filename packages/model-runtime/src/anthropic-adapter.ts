import { messagesWithToolImages } from "./tool-result-images.js";
import type { AgentModelMessage, AgentToolCall } from "@nextmux/agent-runtime";
import { invalidToolArguments } from "@nextmux/agent-runtime";

import { objectArguments, OfficialModelError, postJson, usagePairWithKnown } from "./http.js";
import { createToolNameCodec, type ToolNameCodec } from "./tool-names.js";
import type { AdapterInvocation, AdapterResult } from "./types.js";
import { normalizeModelCitations } from "./citations.js";
import { nativeFinishReason } from "./finish-reason.js";
import { portableSchema } from "./portable-history.js";
import { repairedToolCallArguments } from "./inline-think.js";

function mapMessages(messages: readonly AgentModelMessage[], toolNames: ToolNameCodec): unknown[] {
  const mapped: { role: "user" | "assistant"; content: unknown }[] = [];
  for (const { message } of messagesWithToolImages(messages)) {
    if (message.role === "tool") {
      const block = {
        type: "tool_result",
        tool_use_id: message.toolCallId,
        content: message.content
      };
      const previous = mapped.at(-1);
      if (previous?.role === "user" && Array.isArray(previous.content)
        && previous.content.every((item: any) => item?.type === "tool_result")) {
        (previous.content as unknown[]).push(block);
      } else {
        mapped.push({ role: "user", content: [block] });
      }
      continue;
    }
    if (message.role === "assistant") {
      const content: unknown[] = [];
      if (message.content) content.push({ type: "text", text: message.content });
      for (const call of message.toolCalls ?? []) {
        content.push({ type: "tool_use", id: call.id, name: toolNames.encode(call.name), input: call.arguments ?? {} });
      }
      mapped.push({ role: "assistant", content });
      continue;
    }
    // Anthropic rejects empty text blocks: an attachment-only message carries just its attachments, and a message
    // with neither text nor attachments adds nothing (merged or not).
    const userBlocks: unknown[] = [];
    if (message.content) userBlocks.push({ type: "text", text: message.content });
    for (const attachment of message.attachments ?? []) {
      if (attachment.kind === "text") userBlocks.push({ type: "text", text: `\n\n<file name="${attachment.name}">\n${attachment.content}\n</file>` });
      else if (attachment.kind === "image") userBlocks.push({ type: "image", source: { type: "base64", media_type: attachment.mimeType, data: attachment.dataBase64 } });
      else userBlocks.push({ type: "document", source: { type: "base64", media_type: attachment.mimeType, data: attachment.dataBase64 } });
    }
    if (!userBlocks.length) continue;
    const previous = mapped.at(-1);
    if (previous?.role === "user") {
      const prevBlocks = Array.isArray(previous.content)
        ? previous.content
        : (previous.content ? [{ type: "text", text: String(previous.content) }] : []);
      previous.content = [...prevBlocks, ...userBlocks];
    } else if (message.attachments?.length) {
      mapped.push({ role: "user", content: userBlocks });
    } else {
      mapped.push({ role: "user", content: message.content });
    }
  }
  return mapped;
}

function contentBlocks(value: unknown, toolNames: ToolNameCodec, truncated: boolean): { content: string; toolCalls: readonly AgentToolCall[] } {
  if (!Array.isArray(value) || value.length > 64) {
    throw new OfficialModelError("INVALID_RESPONSE", "Claude returned an invalid content block");
  }
  const text: string[] = [];
  const toolCalls: AgentToolCall[] = [];
  for (const block of value as any[]) {
    if (block?.type === "text" && typeof block.text === "string") {
      text.push(block.text);
    } else if (block?.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
      let rawInput = block.input;
      if (typeof rawInput === "string" && rawInput.trim()) {
        const repaired = repairedToolCallArguments(rawInput);
        if (!invalidToolArguments(repaired)) rawInput = repaired;
      }
      if (truncated && (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput))) continue;
      toolCalls.push({
        id: block.id,
        name: toolNames.decode(block.name),
        arguments: objectArguments(rawInput ?? {}, "Claude tool arguments must be an object")
      });
    }
  }
  if (!truncated && !text.length && !toolCalls.length) {
    throw new OfficialModelError("INVALID_RESPONSE", "Claude returned neither text nor tool calls");
  }
  return { content: text.join("\n"), toolCalls };
}

export async function invokeAnthropic(invocation: AdapterInvocation): Promise<AdapterResult> {
  const toolNames = createToolNameCodec(invocation.tools);
  const payload = await postJson({
    endpoint: invocation.endpoint,
    headers: {
      "x-api-key": invocation.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: {
      model: invocation.model,
      max_tokens: invocation.maxOutputTokens ?? 16_384,
      ...(invocation.instructions ? { system: invocation.instructions } : {}),
      messages: mapMessages(invocation.messages, toolNames),
      ...(invocation.reasoningEffort ? { output_config: { effort: invocation.reasoningEffort } } : {}),
      ...(invocation.tools.length ? {
        tools: invocation.tools.map(tool => ({
          name: toolNames.encode(tool.name),
          description: tool.description,
          input_schema: portableSchema(tool.inputSchema)
        })),
        tool_choice: { type: "auto" }
      } : {})
    },
    signal: invocation.signal,
    timeoutMs: invocation.timeoutMs,
    fetchImpl: invocation.fetchImpl
  });
  const parsed = contentBlocks(payload?.content, toolNames, payload?.stop_reason === "max_tokens");
  const cacheCreation = payload?.usage?.cache_creation;
  const usage = usagePairWithKnown(payload?.usage?.input_tokens, payload?.usage?.output_tokens, {
    cachedInputTokens: payload?.usage?.cache_read_input_tokens,
    cacheWriteTokens: payload?.usage?.cache_creation_input_tokens
      ?? (Number(cacheCreation?.ephemeral_5m_input_tokens || 0) + Number(cacheCreation?.ephemeral_1h_input_tokens || 0) || undefined),
    reasoningTokens: payload?.usage?.output_tokens_details?.reasoning_tokens
      ?? payload?.usage?.thinking_tokens,
  });
  return {
    finishReason: nativeFinishReason(payload?.stop_reason, parsed.toolCalls.length > 0),
    ...parsed,
    citations: normalizeModelCitations(Array.isArray(payload?.content) ? payload.content.slice(0, 64)
      .filter((part: any) => part?.type === "text" && Array.isArray(part.citations))
      .flatMap((part: any) => part.citations.slice(0, 128))
      .filter((item: any) => item?.type === "web_search_result_location") : []),
    model: typeof payload?.model === "string" ? payload.model : invocation.model,
    ...usage,
  };
}
