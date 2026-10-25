import { randomUUID } from "node:crypto";
import { invalidToolArguments, type AgentToolCall } from "@nextmux/agent-runtime";
import { assistantReplayScope, portableAssistantOutputMessages, prepareAssistantOutputReplay, shouldAutoDegradeAssistantOutput } from "./assistant-output-replay.js";
import { createInlineThinkTagSplitter, repairedToolCallArguments } from "./inline-think.js";
import { classifyModelError } from "./errors.js";
import {
  boundedModel, boundedSecret, jsonBody, MAX_REASONING_DETAILS_BYTES, normalizeOfficialModelError,
  OfficialModelError, readLimitedJson, timeoutMs, upstreamError, usagePairWithKnown,
} from "./http.js";
import {
  detectOllama, estimateOllamaPromptTokens, getOllamaModelMetadata, ollamaBaseUrl, selectOllamaContextTokens,
  type OllamaModelMetadata,
} from "./ollama.js";
import { assertOrderedOutputSupport, outputErrorWithUsage, terminalDeliveryError } from "./output-parts.js";
import { normalizePortableHistory } from "./portable-history.js";
import { messagesWithToolImages } from "./tool-result-images.js";
import { createToolNameCodec, type ToolNameCodec } from "./tool-names.js";
import type { OfficialModelClient, OfficialModelClientOptions, OfficialModelEvent, OfficialModelFinishReason, OfficialModelRequest, OfficialModelUsage } from "./types.js";

const MAX_STREAM_BYTES = 2 * 1024 * 1024;

function withAbort<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void pending.catch(() => {}); return Promise.reject(new OfficialModelError("CANCELLED", "Model request cancelled")); }
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => { cleanup(); reject(new OfficialModelError("CANCELLED", "Model request cancelled")); };
    const cleanup = (): void => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    pending.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

function mapMessages(request: OfficialModelRequest, names: ToolNameCodec, scope: string): unknown[] {
  const calls = new Map<string, string>();
  for (const message of request.messages) for (const call of message.toolCalls ?? []) calls.set(call.id, names.encode(call.name));
  return [
    ...(request.instructions ? [{ role: "system", content: request.instructions }] : []),
    ...messagesWithToolImages(request.messages).map(({ message }) => {
      let content = message.content;
      const images: string[] = [];
      for (const attachment of message.attachments ?? []) {
        if (attachment.kind === "image") images.push(attachment.dataBase64);
        else if (attachment.kind === "text") content += `\n\n<file name="${attachment.name}">\n${attachment.content}\n</file>`;
        else throw new OfficialModelError("UNSUPPORTED_CAPABILITY", "The current transport has not verified files; the request was not sent");
      }
      const state = message.providerState as { kind?: string; scope?: string; thinking?: unknown } | undefined;
      const thinking = message.role === "assistant" && state?.kind === "ollama_provider_state" && state.scope === scope
        && typeof state.thinking === "string" && Buffer.byteLength(state.thinking) <= MAX_REASONING_DETAILS_BYTES ? state.thinking : undefined;
      return {
        role: message.role, content,
        ...(images.length ? { images } : {}),
        ...(thinking ? { thinking } : {}),
        ...(message.role === "assistant" && message.toolCalls?.length ? {
          tool_calls: message.toolCalls.map(call => ({ function: { name: names.encode(call.name), arguments: call.arguments ?? {} } })),
        } : {}),
        ...(message.role === "tool" && message.toolCallId && calls.has(message.toolCallId) ? { tool_name: calls.get(message.toolCallId) } : {}),
      };
    }),
  ];
}

function assertCapabilities(metadata: OllamaModelMetadata, request: OfficialModelRequest): void {
  const capabilities = metadata.capabilities;
  if (!capabilities) return; // Older servers do not report authoritative capability metadata.
  const unsupported = request.tools.length && !capabilities.includes("tools") ? "tools"
    : request.messages.some(message => message.attachments?.some(attachment => attachment.kind === "image")) && !capabilities.includes("vision") ? "vision"
      : capabilities.includes("embedding") && !capabilities.includes("completion") ? "completion" : undefined;
  if (unsupported) throw new OfficialModelError("UNSUPPORTED_CAPABILITY", `The current transport has not verified ${unsupported}; the request was not sent`, { retrySafe: true, params: { capability: unsupported } });
}

/** Only a missing HTTP route permits falling back. A missing model is a generation error. */
async function missingNativeRoute(response: Response, signal: AbortSignal): Promise<boolean> {
  if (response.status === 405 || response.status === 501) { void response.body?.cancel().catch(() => {}); return true; }
  if (response.status !== 404) return false;
  // Ollama uses a JSON {error: 'model ... not found'} for missing models.
  // Never replay that request through a second generation transport.
  if (response.headers.get("content-type")?.includes("json")) {
    try {
      const payload = await withAbort(readLimitedJson(response.clone()), signal);
      const detail = payload?.error?.message ?? payload?.error ?? payload?.detail ?? payload?.message;
      const missing = typeof detail === "string" && /^(?:(?:404\s+)?(?:page\s+|route\s+)?not found|Cannot POST \/api\/chat)\.?$/i.test(detail.trim());
      if (missing) void response.body?.cancel().catch(() => {});
      return missing;
    } catch { return false; }
  }
  if (!response.body) return true;
  const reader = response.body.getReader();
  let text = "";
  try {
    while (text.length <= 4_096) {
      const chunk = await withAbort(reader.read(), signal);
      if (chunk.done) break;
      text += new TextDecoder().decode(chunk.value);
    }
  } finally { void reader.cancel().catch(() => {}); }
  return !text.trim() || /^\s*(?:404\s+)?(?:page\s+)?not found\s*$/i.test(text)
    || /^\s*<!doctype html>|^\s*<html[\s>]/i.test(text);
}

function thinkingOption(metadata: OllamaModelMetadata, request: OfficialModelRequest): boolean | string | undefined {
  if (!metadata.capabilities?.includes("thinking")) return undefined;
  if (request.reasoningEnabled === false && metadata.thinkingValues?.includes(false)) return false;
  if (request.reasoningEffort !== undefined && metadata.thinkingValues?.includes(request.reasoningEffort)) return request.reasoningEffort;
  if (request.reasoningEnabled === true && metadata.thinkingValues?.includes(true)) return true;
  if (metadata.thinkingDefault !== undefined && metadata.thinkingValues?.includes(metadata.thinkingDefault)) return metadata.thinkingDefault;
  // Capability presence proves the native boolean switch, but never an arbitrary level.
  if (!metadata.thinkingValues) return request.reasoningEnabled ?? (request.reasoningEffort === "none" ? false : true);
  return undefined;
}

/** Native NDJSON transport, selected before the generic SDK for Ollama routes. */
export function createOllamaModelClient(
  original: OfficialModelClientOptions,
  compatibleFactory: (options: OfficialModelClientOptions) => OfficialModelClient,
): OfficialModelClient {
  const options = { ...original, providerSettings: original.providerSettings ? { ...original.providerSettings } : undefined };
  assertOrderedOutputSupport(options);
  const model = boundedModel(options.model);
  const apiKey = options.apiKey ? boundedSecret(options.apiKey) : "";
  const base = ollamaBaseUrl(options.baseUrl, options.allowInsecure === true);
  const endpoint = new URL("api/chat", base);
  const scope = assistantReplayScope(options, "ollama");
  const fetchImpl = options.fetchImpl ?? fetch;
  const deadlineMs = timeoutMs(options.timeoutMs);
  let native: boolean | undefined = options.providerId === "ollama" ? true : undefined;
  let ollamaEndpoint = native === true;
  let compatible: OfficialModelClient | undefined;
  const fallback = (): OfficialModelClient => compatible ??= compatibleFactory({
    ...options,
    baseUrl: ollamaEndpoint ? new URL("v1", base).toString() : options.baseUrl,
    apiKey: apiKey || "ollama",
  });

  return {
    adapterId: "legacy",
    estimateInputTokens: request => native === false ? fallback().estimateInputTokens(request) : estimateOllamaPromptTokens(request),
    async complete(request) {
      if (native === false) return fallback().complete(request);
      const attemptId = randomUUID();
      const controller = new AbortController();
      const abort = (): void => controller.abort();
      let timedOut = false;
      request.signal?.addEventListener("abort", abort, { once: true });
      if (request.signal?.aborted) controller.abort();
      const timer = deadlineMs > 0 ? setTimeout(() => { timedOut = true; controller.abort(); }, deadlineMs) : undefined;
      let started = false, terminalStarted = false;
      let usage: OfficialModelUsage = { inputTokens: 0, outputTokens: 0 };
      let usageKnown = false;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      const assertActive = (): void => { if (controller.signal.aborted) throw new OfficialModelError("CANCELLED", "Model request cancelled"); };
      const emit = async (event: OfficialModelEvent): Promise<void> => {
        assertActive();
        await request.onModelEvent?.(event);
        assertActive();
        await request.onProviderEvent?.(event);
        assertActive();
      };
      const start = async (): Promise<void> => {
        if (!started) { started = true; await emit({ type: "response.started", attemptId, model }); }
      };
      try {
        assertActive();
        if (shouldAutoDegradeAssistantOutput(options, request)) {
          const portableMessages = portableAssistantOutputMessages(request.messages, options, "legacy");
          if (portableMessages !== request.messages) request = { ...request, messages: portableMessages };
        }
        const replay = await prepareAssistantOutputReplay(options, request, "legacy");
        if (replay) {
          request = replay.request;
        } else {
          const normalizedMessages = normalizePortableHistory(request.messages, options);
          if (normalizedMessages !== request.messages) request = { ...request, messages: normalizedMessages };
        }
        const metadataOptions = { ...options, apiKey, fetchImpl, signal: controller.signal };
        if (native === undefined) {
          native = Boolean(await withAbort(detectOllama(metadataOptions), controller.signal));
          ollamaEndpoint = native;
        }
        if (!native) return fallback().complete(request);
        let metadata: OllamaModelMetadata = {};
        try {
          metadata = await withAbort(getOllamaModelMetadata({ ...metadataOptions, model }), controller.signal);
        } catch (error) {
          assertActive();
          // Older servers may expose chat but not model metadata. Other errors
          // (authentication, connectivity, invalid model) must remain visible.
          if (!(error instanceof OfficialModelError) || ![404, 405, 501].includes(error.httpStatus ?? 0)) throw error;
        }
        assertCapabilities(metadata, request);
        const names = createToolNameCodec(request.tools);
        const promptTokens = estimateOllamaPromptTokens(request);
        const contextTokens = selectOllamaContextTokens({
          maxContextTokens: metadata.maxContextTokens, userContextTokens: options.providerSettings?.ollamaContextTokens,
          promptTokens, maxOutputTokens: request.maxOutputTokens,
        });
        const messages = mapMessages(request, names, scope);
        const think = thinkingOption(metadata, request);
        const body = jsonBody({
          model, stream: true, messages, ...(request.outputSchema ? { format: request.outputSchema.schema } : {}), keep_alive: "5m", truncate: false,
          options: { num_ctx: contextTokens, ...(request.maxOutputTokens === undefined ? {} : { num_predict: request.maxOutputTokens }) },
          ...(think === undefined ? {} : { think }),
          ...(request.tools.length ? { tools: request.tools.map(tool => ({ type: "function", function: {
            name: names.encode(tool.name), description: tool.description, parameters: tool.inputSchema,
          } })) } : {}),
        });
        const response = await withAbort(fetchImpl(endpoint, {
          method: "POST", redirect: "error", headers: {
            accept: "application/x-ndjson", "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          }, body, signal: controller.signal,
        }), controller.signal);
        if (await missingNativeRoute(response, controller.signal)) {
          native = false;
          return fallback().complete(request);
        }
        await start();
        if (!response.ok) {
          let payload: unknown;
          try { payload = await withAbort(readLimitedJson(response), controller.signal); } catch { assertActive(); }
          throw upstreamError(response.status, { readableError: classifyModelError(payload ?? { status: response.status }, { provider: "ollama", source: "local" }) }, response.headers);
        }
        if (!response.body) throw new OfficialModelError("INVALID_RESPONSE", "The model returned no assistant message");
        reader = response.body.getReader();
        let buffer = "", wireBytes = 0, content = "", thinking = "", resolvedModel = model;
        let finished = false, openContent = false, openReasoning = false, nativeThinkingObserved = false;
        let finishReason: "stop" | "tool-calls" | "length" | "other" = "other";
        const toolCalls: AgentToolCall[] = [];
        const incompleteCalls: AgentToolCall[] = [];
        const decoder = new TextDecoder();
        const inlineThinkSplitter = createInlineThinkTagSplitter();
        const contentId = `content-${attemptId}`, reasoningId = `reasoning-${attemptId}`;
        const closeReasoning = async (): Promise<void> => {
          if (openReasoning) { openReasoning = false; await emit({ type: "reasoning.completed", attemptId, itemId: reasoningId }); }
        };
        const appendThinking = async (delta: string): Promise<void> => {
          if (!delta) return;
          if (!openReasoning) { openReasoning = true; await emit({ type: "reasoning.started", attemptId, itemId: reasoningId }); }
          thinking += delta;
          if (Buffer.byteLength(thinking) > MAX_REASONING_DETAILS_BYTES) throw new OfficialModelError("RESPONSE_TOO_LARGE", "The model response exceeds the size limit");
          await request.onReasoningDelta?.(delta);
          await emit({ type: "reasoning.delta", attemptId, itemId: reasoningId, delta });
        };
        const appendContent = async (delta: string): Promise<void> => {
          if (!delta) return;
          await closeReasoning();
          if (!openContent) { openContent = true; await emit({ type: "content.started", attemptId, itemId: contentId }); }
          content += delta;
          await request.onTextDelta?.(delta);
          await emit({ type: "content.delta", attemptId, itemId: contentId, delta });
        };
        const parseChunk = async (line: string): Promise<void> => {
          if (!line.trim()) return;
          let chunk: any;
          try { chunk = JSON.parse(line); } catch { throw new OfficialModelError("INVALID_RESPONSE", "The model returned unreadable data"); }
          if (!chunk || typeof chunk !== "object" || Array.isArray(chunk)) throw new OfficialModelError("INVALID_RESPONSE", "The model returned unreadable data");
          if (chunk.error) throw new OfficialModelError("REQUEST_REJECTED", "The model service returned an error", {
            readableError: classifyModelError(chunk, { provider: "ollama", source: "local" }), stage: "stream",
          });
          if (typeof chunk.model === "string") resolvedModel = chunk.model;
          const message = chunk.message;
          if (message?.thinking) {
            if (typeof message.thinking !== "string") throw new OfficialModelError("INVALID_RESPONSE", "The model returned unreadable data");
            nativeThinkingObserved = true;
            const disabled = inlineThinkSplitter.disable();
            if (disabled.reasoning) await appendThinking(disabled.reasoning);
            if (disabled.content) await appendContent(disabled.content);
            await appendThinking(message.thinking);
          }
          if (message?.content) {
            if (typeof message.content !== "string") throw new OfficialModelError("INVALID_RESPONSE", "The model returned unreadable data");
            if (nativeThinkingObserved) {
              await appendContent(message.content);
            } else {
              const split = inlineThinkSplitter.push(message.content);
              if (split.reasoning) await appendThinking(split.reasoning);
              if (split.closedNow) await closeReasoning();
              if (split.content) await appendContent(split.content);
            }
          }
          if (message?.tool_calls !== undefined) {
            if (!Array.isArray(message.tool_calls) || toolCalls.length + incompleteCalls.length + message.tool_calls.length > 16) throw new OfficialModelError("INVALID_TOOL_CALL", "The model returned an invalid tool call");
            await closeReasoning();
            for (const candidate of message.tool_calls) {
              if (typeof candidate?.function?.name !== "string" || !candidate.function.name.trim()) throw new OfficialModelError("INVALID_TOOL_CALL", "The model returned an invalid tool call");
              const call: AgentToolCall = { id: `ollama-${randomUUID()}`, name: names.decode(candidate.function.name), arguments: repairedToolCallArguments(candidate.function.arguments ?? {}) };
              if (invalidToolArguments(call.arguments) || candidate.function.arguments === undefined
                || typeof candidate.function.arguments === "string" && !candidate.function.arguments.trim()) {
                incompleteCalls.push(call);
                continue;
              }
              toolCalls.push(call);
              await emit({ type: "tool_call.started", attemptId, callId: call.id, name: call.name });
              await emit({ type: "tool_call.arguments_delta", attemptId, callId: call.id, delta: JSON.stringify(call.arguments) });
              await emit({ type: "tool_call.completed", attemptId, toolCall: call });
            }
          }
          if (chunk.done === true) {
            finished = true;
            const reported = usagePairWithKnown(chunk.prompt_eval_count, chunk.eval_count, { cachedInputTokens: chunk.prompt_eval_cached_count });
            usage = reported.usage; usageKnown = reported.usageKnown !== false;
            finishReason = chunk.done_reason === "length" ? "length" : toolCalls.length ? "tool-calls" : chunk.done_reason === "stop" ? "stop" : "other";
          }
        };
        while (!finished) {
          const chunk = await withAbort(reader.read(), controller.signal);
          if (chunk.done) {
            buffer += decoder.decode();
            if (buffer.trim()) await parseChunk(buffer);
            break;
          }
          wireBytes += chunk.value.byteLength;
          if (wireBytes > MAX_STREAM_BYTES) throw new OfficialModelError("RESPONSE_TOO_LARGE", "The model response exceeds the size limit");
          buffer += decoder.decode(chunk.value, { stream: true });
          let newline: number;
          while (!finished && (newline = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
            await parseChunk(line);
          }
        }
        assertActive();
        if (!finished) throw new OfficialModelError("INVALID_RESPONSE", "The model returned unreadable data", {
          stage: "stream", readableError: classifyModelError({ code: "stream_interrupted" }, { provider: "ollama", source: "local" }),
        });
        if (!nativeThinkingObserved) {
          const flushed = inlineThinkSplitter.flush();
          if (flushed.reasoning) await appendThinking(flushed.reasoning);
          if (flushed.closedNow) await closeReasoning();
          if (flushed.content) await appendContent(flushed.content);
        }
        if ((finishReason as OfficialModelFinishReason) !== "length") for (const call of incompleteCalls) {
          toolCalls.push(call);
          await emit({ type: "tool_call.started", attemptId, callId: call.id, name: call.name });
          await emit({ type: "tool_call.arguments_delta", attemptId, callId: call.id, delta: JSON.stringify(call.arguments) });
          await emit({ type: "tool_call.completed", attemptId, toolCall: call });
        }
        await closeReasoning();
        if (openContent) await emit({ type: "content.completed", attemptId, itemId: contentId });
        await emit({ type: "usage", attemptId, usage });
        if ((finishReason as OfficialModelFinishReason) !== "length" && !content && !toolCalls.length) throw new OfficialModelError("INVALID_RESPONSE", "The model returned no assistant message");
        terminalStarted = true;
        await emit({ type: "response.completed", attemptId, model: resolvedModel, finishReason, usage });
        return { content, toolCalls, finishReason, model: resolvedModel, usage, ...(usageKnown ? {} : { usageKnown: false }),
          ...(thinking ? { providerState: { kind: "ollama_provider_state", scope, thinking } } : {}) };
      } catch (error) {
        const failureSource = terminalStarted ? terminalDeliveryError(usage, usageKnown)
          : timedOut && !request.signal?.aborted ? new DOMException("Timeout", "TimeoutError") : error;
        let failure = normalizeOfficialModelError(failureSource,
          { signal: request.signal, timedOut, attemptId, provider: "ollama" });
        if (failure.usageKnown === undefined) failure = outputErrorWithUsage(failure, usage, usageKnown);
        if (!terminalStarted) {
          try {
            // Emit failure even after cancellation; normal event emission checks active state.
            if (!started) {
              await request.onModelEvent?.({ type: "response.started", attemptId, model });
              await request.onProviderEvent?.({ type: "response.started", attemptId, model });
            }
            await request.onModelEvent?.({ type: "response.failed", attemptId, error: failure.toJSON() });
            await request.onProviderEvent?.({ type: "response.failed", attemptId, error: failure.toJSON() });
          } catch { /* The model failure remains authoritative if an event sink fails. */ }
        }
        throw failure;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        request.signal?.removeEventListener("abort", abort);
        void reader?.cancel().catch(() => {});
      }
    },
  };
}
