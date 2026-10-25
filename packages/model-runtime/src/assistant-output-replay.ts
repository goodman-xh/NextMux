import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { normalizeAgentOutputParts } from "@nextmux/agent-runtime/output-parts";
import type { AgentModelMessage, AgentOutputPart, AgentToolCall } from "@nextmux/agent-runtime";
import { jsonBody, MAX_PROVIDER_STATE_BYTES, OfficialModelError, timeoutMs } from "./http.js";
import { OrderedModelOutput, MODEL_OUTPUT_MAX_MEDIA_BYTES } from "./output-parts.js";
import { createToolNameCodec, type ToolNameCodec } from "./tool-names.js";
import type { OfficialModelClientOptions, OfficialModelOutputPart, OfficialModelRequest } from "./types.js";

export const ASSISTANT_REPLAY_MAX_REQUEST_BYTES = 48 * 1024 * 1024;
export const replayToolCallsHash = (calls: readonly AgentToolCall[] | undefined): string => createHash("sha256").update(JSON.stringify(calls ?? [])).digest("hex");
export const replayPartsHash = (parts: readonly AgentOutputPart[]): string => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
export function returnedPartsHash(parts: readonly OfficialModelOutputPart[]): string {
  return replayPartsHash(parts.map(part => part.type === "text" ? { type: "text", text: part.text } : {
    type: part.type, asset: { sha256: createHash("sha256").update(Buffer.from(part.dataBase64, "base64")).digest("hex"), mimeType: part.mimeType, sizeBytes: part.sizeBytes },
  }));
}

export function replayError(code = "INVALID_ASSISTANT_OUTPUT"): OfficialModelError {
  return new OfficialModelError(code, "The assistant media context cannot be read safely; check local references. The request was not sent", {
    stage: "validation", category: "invalid_request", retrySafe: true, retryable: false,
    usageKnown: true, usage: { inputTokens: 0, outputTokens: 0 },
  });
}

export interface PreparedAssistantReplay {
  readonly request: OfficialModelRequest;
  readonly parts: ReadonlyMap<number, readonly OfficialModelOutputPart[]>;
  readonly maximumRequestBytes: number;
}

export function assistantReplayScope(options: Pick<OfficialModelClientOptions, "providerId" | "protocol" | "baseUrl" | "model">, adapter: string): string {
  const url = new URL(options.baseUrl); url.hash = ""; url.search = "";
  return createHash("sha256").update(JSON.stringify([adapter, options.providerId || "gemini", options.protocol,
    url.toString().replace(/\/$/, ""), options.model])).digest("hex");
}

function isV2MediaReplayState(state: unknown): boolean {
  const candidate = state as any;
  return candidate?.kind === "gemini-output-replay-v2" || (candidate?.kind === "ai_sdk_provider_state" && candidate.version === 2);
}

function downgradeV2ProviderState(state: unknown): unknown {
  const candidate = state as any;
  if (candidate?.kind === "ai_sdk_provider_state" && candidate.version === 2) {
    const reasoning = Array.isArray(candidate.reasoning) ? candidate.reasoning : undefined;
    const openRouter = candidate.openRouter;
    const openRouterReasoningDetails = Array.isArray(candidate.openRouterReasoningDetails) ? candidate.openRouterReasoningDetails : undefined;
    if (!reasoning?.length && !openRouter && !openRouterReasoningDetails?.length) return undefined;
    return {
      version: 1,
      kind: "ai_sdk_provider_state",
      ...(typeof candidate.providerScope === "string" ? { providerScope: candidate.providerScope } : {}),
      toolCallProviderOptions: {},
      ...(reasoning?.length ? { reasoning } : {}),
      ...(openRouter ? { openRouter } : {}),
      ...(openRouterReasoningDetails?.length ? { openRouterReasoningDetails } : {}),
    };
  }
  if (candidate?.kind === "gemini-output-replay-v2") {
    const thoughtParts = Array.isArray(candidate.entries)
      ? candidate.entries
          .filter((entry: any) => entry?.kind === "provider" && entry.part && typeof entry.part === "object" && !Array.isArray(entry.part) && entry.part.thought === true && typeof entry.part.text === "string")
          .map((entry: any) => ({
            thought: true,
            text: entry.part.text,
            ...(typeof entry.part.thoughtSignature === "string" ? { thoughtSignature: entry.part.thoughtSignature } : {}),
          }))
      : [];
    if (!thoughtParts.length) return undefined;
    return {
      kind: "gemini-content-v1",
      ...(typeof candidate.scope === "string" ? { scope: candidate.scope } : {}),
      content: { role: "model", parts: thoughtParts },
    };
  }
  return state;
}

function degradeAssistantOutputMessage(message: AgentModelMessage): AgentModelMessage {
  const parts = Array.isArray(message.outputParts) ? message.outputParts : [];
  const textSegments: string[] = [];
  const mediaNotes: string[] = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
      textSegments.push(part.text);
    } else if (part.type === "image" || part.type === "audio") {
      const mimeType = typeof (part as any).asset?.mimeType === "string" ? (part as any).asset.mimeType : part.type;
      mediaNotes.push(`[Generated ${part.type} (${mimeType}) omitted on model switch]`);
    }
  }
  const baseText = message.content?.trim() ? message.content : textSegments.join("\n");
  const nextContent = [baseText, ...mediaNotes].filter(Boolean).join(baseText && mediaNotes.length ? "\n\n" : "");
  const nextProviderState = downgradeV2ProviderState(message.providerState);
  const { outputParts: _omittedOutputParts, providerState: _omittedProviderState, ...rest } = message;
  return {
    ...rest,
    content: nextContent,
    ...(nextProviderState !== undefined ? { providerState: nextProviderState } : {}),
  };
}

/**
 * Converts foreign-route or unsupported-protocol assistant `outputParts` and v2 media replay templates
 * into portable text placeholders while preserving readable reasoning in a v1 providerState.
 */
export function portableAssistantOutputMessages(
  messages: readonly AgentModelMessage[],
  options: Pick<OfficialModelClientOptions, "providerId" | "protocol" | "baseUrl" | "model" | "acceptOrderedOutput">,
  adapter: "legacy" | "ai_sdk" = "ai_sdk",
): readonly AgentModelMessage[] {
  const routeSupportsMediaReplay = options.protocol === "gemini_generate_content"
    && (options.providerId === undefined || options.providerId === "gemini")
    && options.acceptOrderedOutput === true;
  let targetScope = "";
  if (routeSupportsMediaReplay) {
    try { targetScope = assistantReplayScope(options, adapter); } catch { targetScope = ""; }
  }
  let changed = false;
  const mapped = messages.map(message => {
    if (message.role !== "assistant" || (message.outputParts === undefined && !isV2MediaReplayState(message.providerState))) {
      return message;
    }
    if (routeSupportsMediaReplay && message.outputParts !== undefined) {
      const state = message.providerState as any;
      if (state === undefined) return message;
      if (typeof state?.model === "string" && state.model !== options.model) {
        changed = true;
        return degradeAssistantOutputMessage(message);
      }
      if (adapter === "legacy" && state?.kind === "gemini-output-replay-v2" && state.scope === targetScope) return message;
      if (adapter === "ai_sdk" && state?.kind === "ai_sdk_provider_state" && state.version === 2 && state.replayScope === targetScope) return message;
      if (!isV2MediaReplayState(state)) return message;
    }
    changed = true;
    return degradeAssistantOutputMessage(message);
  });
  return changed ? mapped : messages;
}

export function shouldAutoDegradeAssistantOutput(
  options: OfficialModelClientOptions,
  input: OfficialModelRequest,
): boolean {
  if (options.degradeForeignOutputReplay === true || input.degradeForeignOutputReplay === true) return true;
  const nonGeminiProtocol = options.protocol !== "gemini_generate_content" || (options.providerId !== undefined && options.providerId !== "gemini");
  const unconfiguredOrderedOutput = options.acceptOrderedOutput !== true && options.resolveAssistantOutputAsset === undefined;
  return input.messages.some(message => {
    if (message.role !== "assistant" || message.outputParts === undefined) return false;
    const state = message.providerState as any;
    if (typeof state?.model === "string" && state.model !== options.model) return true;
    if (!nonGeminiProtocol && !unconfiguredOrderedOutput) return false;
    return isV2MediaReplayState(state) || (unconfiguredOrderedOutput && state === undefined);
  });
}

/** No paths, remote URLs, background reads or credential access. Host must check its trusted run/owner on each call. */
export async function prepareAssistantOutputReplay(
  options: OfficialModelClientOptions, input: OfficialModelRequest, adapter: "legacy" | "ai_sdk",
): Promise<PreparedAssistantReplay | undefined> {
  if (shouldAutoDegradeAssistantOutput(options, input)) {
    const portableMessages = portableAssistantOutputMessages(input.messages, options, adapter);
    if (portableMessages !== input.messages) {
      input = { ...input, messages: portableMessages };
    }
  }
  const mediaState = (message: AgentModelMessage): boolean => isV2MediaReplayState(message.providerState);
  if (!input.messages.some(message => message.outputParts !== undefined || mediaState(message))) return;
  if (options.protocol !== "gemini_generate_content" || (options.providerId !== undefined && options.providerId !== "gemini")
    || options.acceptOrderedOutput !== true) throw replayError("UNSUPPORTED_CAPABILITY");
  const replayTimeoutMs = timeoutMs(options.timeoutMs);
  const replaySignals = [
    ...(input.signal ? [input.signal] : []),
    ...(replayTimeoutMs > 0 ? [AbortSignal.timeout(replayTimeoutMs)] : []),
  ];
  const readSignal = replaySignals.length === 1
    ? replaySignals[0]
    : replaySignals.length > 1
      ? AbortSignal.any(replaySignals)
      : new AbortController().signal;
  const assertActive = (): void => { if (readSignal.aborted) throw replayError(input.signal?.aborted ? "CANCELLED" : "TIMEOUT"); };
  assertActive();
  let request: OfficialModelRequest;
  try {
    const messages = input.messages.map(message => {
      if (message.outputParts === undefined) {
        if (mediaState(message)) throw replayError();
        return message;
      }
      if (message.role !== "assistant") throw replayError();
      return { ...message, content: "", outputParts: normalizeAgentOutputParts(message.outputParts) };
    });
    // Keep the existing 4 MiB non-binary request bound. Clone before the first
    // async host callback so late edits cannot change a previously authorized slot.
    request = { ...input, ...JSON.parse(jsonBody({ messages, tools: input.tools, instructions: input.instructions })) };
  } catch (error) { throw replayError(error instanceof OfficialModelError && error.code === "REQUEST_TOO_LARGE" ? error.code : undefined); }
  const scope = assistantReplayScope(options, adapter);
  for (const message of request.messages) assertReplayStateScope(message, scope, adapter, createToolNameCodec(request.tools));
  let mediaBytes = 0;
  for (const message of request.messages) for (const part of message.outputParts ?? []) {
    if (part.type !== "text") mediaBytes += part.asset.sizeBytes;
  }
  if (mediaBytes > MODEL_OUTPUT_MAX_MEDIA_BYTES) throw replayError("REQUEST_TOO_LARGE");
  const resolver = options.resolveAssistantOutputAsset;
  if (mediaBytes && typeof resolver !== "function") throw replayError("ASSISTANT_OUTPUT_UNAVAILABLE");
  const parts = new Map<number, readonly OfficialModelOutputPart[]>();
  for (const [messageIndex, message] of request.messages.entries()) {
    if (message.outputParts === undefined) continue;
    const output = new OrderedModelOutput(true);
    for (const [partIndex, part] of message.outputParts.entries()) {
      assertActive();
      if (part.type === "text") { output.text(String(partIndex), part.text); continue; }
      let bytes: Uint8Array;
      try {
        let onAbort!: () => void;
        try {
          bytes = await Promise.race([
            Promise.resolve().then(() => { assertActive(); return resolver!({ asset: Object.freeze({ ...part.asset }), messageIndex, partIndex, signal: readSignal }); }),
            new Promise<never>((_resolve, reject) => {
              onAbort = () => { try { assertActive(); } catch (error) { reject(error); } };
              readSignal.addEventListener("abort", onAbort, { once: true });
              if (readSignal.aborted) onAbort();
            }),
          ]);
        } finally { readSignal.removeEventListener("abort", onAbort); }
      } catch { assertActive(); throw replayError("ASSISTANT_OUTPUT_UNAVAILABLE"); }
      assertActive();
      if (!(bytes instanceof Uint8Array) || bytes.byteLength !== part.asset.sizeBytes) throw replayError();
      const copy = Buffer.from(bytes);
      if (createHash("sha256").update(copy).digest("hex") !== part.asset.sha256) throw replayError();
      output.media(part.asset.mimeType, () => copy.toString("base64"));
    }
    try { parts.set(messageIndex, output.finish({ inputTokens: 0, outputTokens: 0 }, true)!); }
    catch { throw replayError(); }
  }
  assertActive();
  return { request, parts, maximumRequestBytes: mediaBytes ? ASSISTANT_REPLAY_MAX_REQUEST_BYTES : 4 * 1024 * 1024 };
}

/** Only installed Gemini JSON POSTs get the larger bound, never arbitrary fetches or URLs from a reference. */
export function assistantReplayFetch(fetchImpl: typeof fetch, maximumBytes: number, signal?: AbortSignal): typeof fetch {
  return async (input, init) => {
    if (signal?.aborted) throw replayError("CANCELLED");
    if (init?.method?.toUpperCase() !== "POST" || typeof init.body !== "string") throw replayError();
    if (Buffer.byteLength(init.body, "utf8") > maximumBytes) throw replayError("REQUEST_TOO_LARGE");
    return fetchImpl(input, init);
  };
}

/** Compare the private template's visible slots and calls, not only its claimed hashes. */
export function assertLegacyReplayEntries(
  entries: readonly any[], visible: readonly { type: string; text?: string }[],
  calls: readonly AgentToolCall[] | undefined, toolNames: ToolNameCodec,
): void {
  let cursor = 0, callCursor = 0;
  const ids = new Set<string>();
  for (const entry of entries) {
    if (entry?.kind === "media") {
      const part = visible[cursor];
      if (entry.index !== cursor || !part || part.type === "text") throw replayError();
      cursor++;
    } else if (entry?.kind === "provider" && entry.part && typeof entry.part === "object" && !Array.isArray(entry.part)) {
      const part = entry.part;
      // v2 may retain reasoning text/signatures, never a second media transport
      // hidden in provider state. All binary bytes must use authorized slots.
      if (Object.keys(part).some(key => !['text', 'thought', 'thoughtSignature', 'functionCall'].includes(key))
        || (part.text !== undefined && typeof part.text !== 'string')
        || (part.thought !== undefined && typeof part.thought !== 'boolean')
        || (part.thoughtSignature !== undefined && typeof part.thoughtSignature !== 'string')) throw replayError();
      if (!part.thought && typeof part.text === "string" && part.text) {
        const expected = visible[cursor++];
        if (!expected || expected.type !== "text" || expected.text !== part.text) throw replayError();
      }
      if (part.functionCall !== undefined) {
        const original = part.functionCall, expected = calls?.[callCursor++];
        if (!original || typeof original !== "object" || Array.isArray(original) || !expected || ids.has(expected.id)
          || Object.keys(original).some(key => !['id', 'name', 'args'].includes(key))
          || original.name !== toolNames.encode(expected.name)
          || (original.id !== undefined ? original.id !== expected.id : !/^gemini-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(expected.id))
          || !isDeepStrictEqual(original.args ?? {}, expected.arguments ?? {})) throw replayError();
        ids.add(expected.id);
      }
    } else throw replayError();
  }
  if (cursor !== visible.length || callCursor !== (calls?.length ?? 0)) throw replayError();
}

function assertReplayStateScope(message: AgentModelMessage, scope: string, adapter: "legacy" | "ai_sdk", toolNames: ToolNameCodec): void {
  if (message.outputParts === undefined || message.providerState === undefined) return;
  const state = message.providerState as any;
  const media = message.outputParts.some(part => part.type !== "text");
  if (adapter === "legacy") {
    if (state?.kind === "gemini-output-replay-v2") {
      if (state.scope !== scope || state.partsHash !== replayPartsHash(message.outputParts)
        || state.toolCallsHash !== replayToolCallsHash(message.toolCalls)
        || !Array.isArray(state.entries) || state.entries.length > 128 || JSON.stringify(state).length > 512_000) throw replayError();
      assertLegacyReplayEntries(state.entries, message.outputParts, message.toolCalls, toolNames);
    } else if (media) throw replayError();
    return;
  }
  if (!media && state?.version !== 2) return;
  if (!state || state.kind !== "ai_sdk_provider_state" || state.version !== 2 || state.replayScope !== scope
    || state.replayPartsHash !== replayPartsHash(message.outputParts) || state.replayToolCallsHash !== replayToolCallsHash(message.toolCalls)
    || !state.toolCallProviderOptions || typeof state.toolCallProviderOptions !== "object" || Array.isArray(state.toolCallProviderOptions)
    || Object.values(state.toolCallProviderOptions).some(value => !value || typeof value !== "object" || Array.isArray(value))
    || (state.reasoning !== undefined && (!Array.isArray(state.reasoning) || state.reasoning.some((part: any) => !part || typeof part.text !== "string"
      || (part.providerOptions !== undefined && (!part.providerOptions || typeof part.providerOptions !== "object" || Array.isArray(part.providerOptions))))))
    || Buffer.byteLength(JSON.stringify(state), "utf8") > MAX_PROVIDER_STATE_BYTES) throw replayError();
}
