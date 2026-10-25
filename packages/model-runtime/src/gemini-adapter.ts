import { messagesWithToolImages } from "./tool-result-images.js";
import { randomUUID } from "node:crypto";

import type { AgentModelMessage, AgentToolCall } from "@nextmux/agent-runtime";
import { invalidToolArguments } from "@nextmux/agent-runtime";

import { contentFilterError, objectArguments, OfficialModelError, postJson, strictTokenCount, usagePairWithKnown } from "./http.js";
import { classifyModelError } from "./errors.js";
import { createToolNameCodec, type ToolNameCodec } from "./tool-names.js";
import type { AdapterInvocation, AdapterResult, OfficialModelUsage } from "./types.js";
import { normalizeModelCitations } from "./citations.js";
import { OrderedModelOutput, outputErrorWithUsage } from "./output-parts.js";
import { assertLegacyReplayEntries, replayError, replayToolCallsHash, returnedPartsHash } from "./assistant-output-replay.js";
import { geminiSchema } from "./portable-history.js";
import { repairedToolCallArguments } from "./inline-think.js";
import type { OfficialModelOutputPart } from "./types.js";
import { nativeFinishReason } from "./finish-reason.js";

interface GeminiProviderState {
  readonly kind: "gemini-content-v1";
  readonly scope?: string;
  readonly content: { readonly role: "model"; readonly parts: readonly unknown[] };
}

type ReplayEntry = { readonly kind: "provider"; readonly part: any } | { readonly kind: "media"; readonly index: number };
interface GeminiReplayState {
  readonly kind: "gemini-output-replay-v2";
  readonly scope: string;
  readonly toolCallsHash: string;
  readonly partsHash: string;
  readonly entries: readonly ReplayEntry[];
}

function replayProviderParts(state: unknown, visible: readonly OfficialModelOutputPart[], message: AgentModelMessage, toolNames: ToolNameCodec, scope?: string): unknown[] {
  const value = state as GeminiReplayState;
  if (!value || value.kind !== "gemini-output-replay-v2" || !scope || value.scope !== scope
    || value.toolCallsHash !== replayToolCallsHash(message.toolCalls) || value.partsHash !== returnedPartsHash(visible) || !Array.isArray(value.entries)
    || value.entries.length > 128 || JSON.stringify(value).length > 512_000) throw replayError();
  assertLegacyReplayEntries(value.entries, visible, message.toolCalls, toolNames);
  const parts: unknown[] = [];
  for (const entry of value.entries) {
    if (entry.kind === "media") {
      const part = visible[entry.index]!;
      if (part.type === "text") throw replayError();
      parts.push({ inlineData: { mimeType: part.mimeType, data: part.dataBase64 } });
    } else parts.push(entry.part);
  }
  return parts;
}

function validProviderContent(value: unknown): value is GeminiProviderState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as any;
  if (state.kind !== "gemini-content-v1" || state.content?.role !== "model" || !Array.isArray(state.content?.parts)) return false;
  try {
    return JSON.stringify(state).length <= 512_000;
  } catch {
    return false;
  }
}

function parsedToolOutput(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : { result: parsed };
  } catch {
    return { result: value };
  }
}

function mapMessages(messages: readonly AgentModelMessage[], toolNames: ToolNameCodec, invocation: AdapterInvocation): unknown[] {
  const names = new Map<string, string>();
  for (const message of messages) {
    for (const call of message.toolCalls ?? []) names.set(call.id, toolNames.encode(call.name));
  }
  const contents: { role: "user" | "model"; parts: unknown[] }[] = [];
  for (const { sourceIndex: messageIndex, message } of messagesWithToolImages(messages)) {
    if (message.role === "assistant") {
      const visible = invocation.assistantReplay?.parts.get(messageIndex);
      if ((message.providerState as any)?.kind === "gemini-output-replay-v2") {
        if (!visible) throw replayError();
        contents.push({ role: "model", parts: replayProviderParts(message.providerState, visible, message, toolNames, invocation.replayScope) });
      } else if (visible !== undefined && message.providerState !== undefined && visible.some(part => part.type !== "text")) {
        throw replayError(); // Old state has no media slots; never guess where it belonged.
      } else if (validProviderContent(message.providerState) && invocation.replayScope
        && message.providerState.scope === invocation.replayScope) {
        if (visible !== undefined) {
          const texts = (message.providerState.content.parts as any[]).filter(part => !part?.thought && typeof part?.text === "string" && part.text).map(part => part.text);
          if (JSON.stringify(texts) !== JSON.stringify(visible.map(part => part.type === "text" ? part.text : null))) throw replayError();
        }
        contents.push({
          role: "model",
          parts: [...message.providerState.content.parts]
        });
      } else {
        const parts: unknown[] = [];
        if (validProviderContent(message.providerState) && invocation.reasoningExclude !== true) {
          // Match the SDK path: keep readable analysis when changing models,
          // but rebuild calls from canonical history without private signatures.
          for (const part of message.providerState.content.parts as any[]) {
            if (part?.thought && typeof part.text === "string" && part.text) parts.push({ text: part.text });
          }
        }
        if (visible !== undefined) for (const part of visible) parts.push(part.type === "text" ? { text: part.text }
          : { inlineData: { mimeType: part.mimeType, data: part.dataBase64 } });
        else if (message.content) parts.push({ text: message.content });
        for (const call of message.toolCalls ?? []) {
          parts.push({ functionCall: { id: call.id, name: toolNames.encode(call.name), args: call.arguments ?? {} } });
        }
        contents.push({ role: "model", parts });
      }
      continue;
    }
    if (message.role === "tool") {
      const part = {
        functionResponse: {
          id: message.toolCallId,
          name: message.toolCallId ? names.get(message.toolCallId) : undefined,
          response: parsedToolOutput(message.content)
        }
      };
      const previous = contents.at(-1);
      if (previous?.role === "user" && previous.parts.every((item: any) => item?.functionResponse)) {
        previous.parts.push(part);
      } else {
        contents.push({ role: "user", parts: [part] });
      }
      continue;
    }
    // Gemini rejects empty text parts: only real text and attachments become parts.
    const parts: unknown[] = [];
    if (message.content) parts.push({ text: message.content });
    for (const attachment of message.attachments ?? []) {
      if (attachment.kind === "text") parts.push({ text: `\n\n<file name="${attachment.name}">\n${attachment.content}\n</file>` });
      else parts.push({ inlineData: { mimeType: attachment.mimeType, data: attachment.dataBase64 } });
    }
    if (!parts.length) continue;
    const previous = contents.at(-1);
    if (previous?.role === "user") {
      previous.parts.push(...parts);
    } else {
      contents.push({ role: "user", parts });
    }
  }
  return contents;
}

function parseCandidate(payload: any, toolNames: ToolNameCodec, accepted: boolean, usage: OfficialModelUsage, usageKnown: boolean, scope?: string): {
  content: string;
  outputParts?: AdapterResult["outputParts"];
  toolCalls: readonly AgentToolCall[];
  citations: ReturnType<typeof normalizeModelCitations>;
  providerState?: GeminiProviderState | GeminiReplayState;
} {
  let candidateContent = payload?.candidates?.[0]?.content;
  const truncated = payload?.candidates?.[0]?.finishReason === "MAX_TOKENS";
  if (candidateContent?.role !== "model" || !Array.isArray(candidateContent.parts)) {
    throw outputErrorWithUsage(new OfficialModelError("INVALID_RESPONSE", "Gemini returned no usable candidate content", { readableError: classifyModelError(payload) }), usage, usageKnown);
  }
  if (candidateContent.parts.length > 64) {
    throw outputErrorWithUsage(new OfficialModelError("OUTPUT_TOO_LARGE", "Gemini content parts exceed the size limit", { params: { maxParts: 64 } }), usage, usageKnown);
  }
  candidateContent = {
    ...candidateContent,
    parts: candidateContent.parts.map((part: any) => {
      if (part?.functionCall && typeof part.functionCall.args === "string" && part.functionCall.args.trim()) {
        const repaired = repairedToolCallArguments(part.functionCall.args);
        if (!invalidToolArguments(repaired)) {
          return { ...part, functionCall: { ...part.functionCall, args: repaired } };
        }
      }
      return part;
    }),
  };
  if (truncated) candidateContent = { ...candidateContent, parts: candidateContent.parts.filter((part: any) => !part?.functionCall
    || typeof part.functionCall.name === "string" && part.functionCall.args && typeof part.functionCall.args === "object" && !Array.isArray(part.functionCall.args)) };
  const text: string[] = [];
  const toolCalls: AgentToolCall[] = [];
  const output = new OrderedModelOutput(accepted);
  for (const part of candidateContent.parts as any[]) {
    if (typeof part?.text === "string" && !part.thought) { text.push(part.text); output.text(`text-${text.length}`, part.text); }
    if (part?.inlineData && !part.thought) {
      if (part.thoughtSignature) output.media(undefined, () => undefined);
      else output.media(part.inlineData.mimeType, () => part.inlineData.data);
    }
    if (part?.fileData && !part.thought) output.media(undefined, () => undefined);
    if (part?.functionCall && typeof part.functionCall.name === "string") {
      toolCalls.push({
        id: typeof part.functionCall.id === "string" ? part.functionCall.id : `gemini-${randomUUID()}`,
        name: toolNames.decode(part.functionCall.name),
        arguments: objectArguments(part.functionCall.args ?? {}, "Gemini tool arguments must be an object")
      });
    }
  }
  const outputParts = output.finish(usage, usageKnown);
  if (!truncated && !text.length && !toolCalls.length && !outputParts?.some(part => part.type !== "text")) {
    throw outputErrorWithUsage(new OfficialModelError("INVALID_RESPONSE", "Gemini returned neither text nor tool calls", { readableError: classifyModelError(payload) }), usage, usageKnown);
  }
  let serialized: string;
  try {
    // New visible media belongs only to outputParts. Preserve the old bounded
    // private thoughts/tool signatures unchanged; they are never public output.
    // Signed visible media was rejected above rather than corrupting its replay.
    serialized = JSON.stringify({ ...candidateContent, parts: candidateContent.parts.flatMap((part: any) => {
      if (!part || typeof part !== "object" || part.thought || !part.inlineData) return [part];
      const { inlineData: _inlineData, ...state } = part;
      if (state.thought === false) delete state.thought;
      return Object.keys(state).length ? [state] : [];
    }) });
  } catch {
    throw outputErrorWithUsage(new OfficialModelError("INVALID_RESPONSE", "Gemini context cannot be serialized"), usage, usageKnown);
  }
  if (serialized.length > 512_000) {
    throw outputErrorWithUsage(new OfficialModelError("INVALID_RESPONSE", "Gemini tool context exceeds the size limit"), usage, usageKnown);
  }
  const providerContent = JSON.parse(serialized);
  let providerState: GeminiProviderState | GeminiReplayState | undefined = providerContent.parts.length
    ? { kind: "gemini-content-v1", scope, content: providerContent } : undefined;
  if (providerState && outputParts?.some(part => part.type !== "text")) {
    const entries: ReplayEntry[] = [];
    let cursor = 0;
    for (const part of candidateContent.parts as any[]) {
      if (part && !part.thought && part.inlineData) {
        const { inlineData: _inlineData, ...rest } = part;
        if (rest.thought === false) delete rest.thought;
        if (Object.keys(rest).length) entries.push({ kind: "provider", part: rest });
        if (typeof part.text === "string" && part.text) cursor++;
        entries.push({ kind: "media", index: cursor++ });
      } else {
        entries.push({ kind: "provider", part });
        if (!part?.thought && typeof part?.text === "string" && part.text) cursor++;
      }
    }
    providerState = { kind: "gemini-output-replay-v2", scope: scope || "", toolCallsHash: replayToolCallsHash(toolCalls), partsHash: returnedPartsHash(outputParts), entries };
    if (!scope || JSON.stringify(providerState).length > 512_000) {
      throw outputErrorWithUsage(new OfficialModelError("INVALID_RESPONSE", "Gemini tool context exceeds the size limit"), usage, usageKnown);
    }
    try { replayProviderParts(providerState, outputParts, { role: "assistant", content: "", toolCalls }, toolNames, scope); }
    catch { throw outputErrorWithUsage(new OfficialModelError("INVALID_RESPONSE", "Gemini media context cannot be replayed safely"), usage, usageKnown); }
  }
  return {
    content: text.join("\n"),
    ...(outputParts ? { outputParts } : {}),
    toolCalls,
    citations: normalizeModelCitations(Array.isArray(payload?.candidates?.[0]?.groundingMetadata?.groundingChunks)
      ? payload.candidates[0].groundingMetadata.groundingChunks.slice(0, 128).map((chunk: any) => ({ url: chunk?.web?.uri, title: chunk?.web?.title })) : []),
    ...(providerState ? { providerState } : {})
  };
}

export async function invokeGemini(invocation: AdapterInvocation): Promise<AdapterResult> {
  const toolNames = createToolNameCodec(invocation.tools);
  const generationConfig = invocation.maxOutputTokens === undefined ? undefined : { maxOutputTokens: invocation.maxOutputTokens };
  const payload = await postJson({
    endpoint: invocation.endpoint,
    headers: { "x-goog-api-key": invocation.apiKey },
    body: {
      ...(invocation.instructions ? { systemInstruction: { parts: [{ text: invocation.instructions }] } } : {}),
      contents: mapMessages(invocation.messages, toolNames, invocation),
      ...(generationConfig ? { generationConfig } : {}),
      ...(invocation.tools.length ? {
        tools: [{
          functionDeclarations: invocation.tools.map(tool => ({
            name: toolNames.encode(tool.name),
            description: tool.description,
            parameters: geminiSchema(tool.inputSchema)
          }))
        }],
        toolConfig: { functionCallingConfig: { mode: "AUTO" } }
      } : {})
    },
    signal: invocation.signal,
    timeoutMs: invocation.timeoutMs,
    fetchImpl: invocation.fetchImpl,
    ...(invocation.assistantReplay ? { maximumRequestBytes: invocation.assistantReplay.maximumRequestBytes } : {})
  });
  // Gemini bills thinking as output: the output count carries it, like OpenAI's completion_tokens (audit B02-05).
  const thoughts = strictTokenCount(payload?.usageMetadata?.thoughtsTokenCount);
  const candidates = payload?.usageMetadata?.candidatesTokenCount;
  const billedOutput = thoughts !== undefined && strictTokenCount(candidates ?? 0) !== undefined ? Number(candidates ?? 0) + thoughts : candidates;
  const usage = usagePairWithKnown(payload?.usageMetadata?.promptTokenCount, billedOutput, {
    cachedInputTokens: payload?.usageMetadata?.cachedContentTokenCount,
    reasoningTokens: payload?.usageMetadata?.thoughtsTokenCount,
  });
  // A blocked prompt (promptFeedback, no candidate) or a SAFETY-family finish is the one content-filter failure.
  const blockReason = payload?.promptFeedback?.blockReason;
  const blocked = typeof blockReason === "string" && blockReason !== "BLOCK_REASON_UNSPECIFIED";
  if (blocked || nativeFinishReason(payload?.candidates?.[0]?.finishReason, false) === "content-filter") {
    throw outputErrorWithUsage(contentFilterError(String(blocked ? blockReason : payload.candidates[0].finishReason).slice(0, 80),
      { httpStatus: 200, stage: "response" }),
    usage.usage, usage.usageKnown !== false);
  }
  const parsed = parseCandidate(payload, toolNames, invocation.acceptOrderedOutput === true, usage.usage, usage.usageKnown !== false, invocation.replayScope);
  return {
    ...parsed,
    finishReason: nativeFinishReason(payload?.candidates?.[0]?.finishReason, parsed.toolCalls.length > 0),
    model: invocation.model,
    ...usage,
  };
}
