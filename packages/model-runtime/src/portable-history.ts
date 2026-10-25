import type { AgentMessageAttachment, AgentModelMessage } from "@nextmux/agent-runtime";
import { isModelInputExplicitlyUnsupported } from "./model-contract.js";
import { INLINE_THINK_TAGS, splitInlineThink } from "./inline-think.js";
import type { OfficialModelClientOptions } from "./types.js";

const MISTRAL_FAMILY = /(?:^|\/)(?:mistral|mixtral|codestral|devstral|magistral|ministral|pixtral|voxtral|open-mistral)/i;
const KIMI_FAMILY = /kimi-k\d/i;
const TEXT_ONLY_MODEL_FAMILY = /(?:^|\/)(?:deepseek-(?:chat|reasoner|coder|r1|v3)|qwen(?:2\.5|3)?-coder)/i;
const SAFE_TOOL_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MISTRAL_TOOL_ID = /^[A-Za-z0-9]{9}$/;
const KIMI_TOOL_ID = /^functions\.[A-Za-z0-9_.-]+:\d+$/;
const MAX_SCHEMA_DEPTH = 14;
export const DEFAULT_MAX_INLINE_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024;
export const DEFAULT_INLINE_IMAGE_OFFLOAD_BYTE_QUANTUM = 10 * 1024 * 1024;

const GEMINI_SCHEMA_KEYS = new Set([
  "type",
  "format",
  "title",
  "description",
  "nullable",
  "enum",
  "maxItems",
  "minItems",
  "properties",
  "required",
  "minProperties",
  "maxProperties",
  "minLength",
  "maxLength",
  "pattern",
  "anyOf",
  "propertyOrdering",
  "items",
  "minimum",
  "maximum",
]);

const GEMINI_FORMATS: Readonly<Record<string, ReadonlySet<string>>> = {
  string: new Set(["enum", "date-time", "date", "time"]),
  integer: new Set(["int32", "int64"]),
  number: new Set(["float", "double"]),
};

function fnv1aBase62(value: string, length = 9): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let hash = 0x811c9dc5n;
  const bytes = new TextEncoder().encode(value);
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  let text = "";
  for (let index = 0; index < length; index++) {
    text += alphabet[Number(hash % 62n)];
    hash /= 62n;
  }
  return text;
}

function remapProviderStateToolIds(providerState: unknown, convert: (id: string) => string): unknown {
  if (!providerState || typeof providerState !== "object" || Array.isArray(providerState)) return providerState;
  const state = providerState as Record<string, any>;
  if ((state.kind === "ai_sdk_provider_state" || state.kind === "ai_sdk_tool_options")
    && state.toolCallProviderOptions && typeof state.toolCallProviderOptions === "object" && !Array.isArray(state.toolCallProviderOptions)) {
    const entries = Object.entries(state.toolCallProviderOptions);
    if (!entries.length) return providerState;
    const remapped = Object.fromEntries(entries.map(([key, value]) => [convert(key), value]));
    return { ...state, toolCallProviderOptions: remapped };
  }
  if (state.kind === "anthropic-content-v1" && Array.isArray(state.content)) {
    return {
      ...state,
      content: state.content.map((block: any) =>
        block && typeof block === "object" && block.type === "tool_use" && typeof block.id === "string"
          ? { ...block, id: convert(block.id) }
          : block),
    };
  }
  if (state.kind === "openai-chat-v1" && state.message && typeof state.message === "object" && Array.isArray(state.message.tool_calls)) {
    return {
      ...state,
      message: {
        ...state.message,
        tool_calls: state.message.tool_calls.map((call: any) =>
          call && typeof call === "object" && typeof call.id === "string"
            ? { ...call, id: convert(call.id) }
            : call),
      },
    };
  }
  return providerState;
}

/**
 * Normalizes toolCallIds across model/provider switches:
 * - Mistral family requires 9-character alphanumeric `[A-Za-z0-9]{9}` IDs.
 * - Kimi K2 requires `functions.<name>:<index>` IDs on OpenAI-compatible/chat routes.
 * - Anthropic and strict OpenAI-compatible gateways require `^[A-Za-z0-9_-]{1,64}$`.
 */
export function sanitizeToolCallIds(
  messages: readonly AgentModelMessage[],
  options?: Pick<OfficialModelClientOptions, "providerId" | "model"> & { readonly protocol?: string },
): readonly AgentModelMessage[] {
  if (!messages.length) return messages;
  const isMistral = options?.providerId === "mistral" || MISTRAL_FAMILY.test(options?.model || "");
  const isKimi = !isMistral
    && KIMI_FAMILY.test(options?.model || "")
    && !["anthropic", "anthropic_messages", "gemini", "gemini_generate_content"].includes(options?.protocol || "");
  const validPattern = isMistral ? MISTRAL_TOOL_ID : isKimi ? KIMI_TOOL_ID : SAFE_TOOL_ID;
  const hasInvalidId = messages.some(message =>
    message.outputParts === undefined && (
      (Array.isArray(message.toolCalls) && message.toolCalls.some(call => !validPattern.test(String(call?.id || ""))))
      || (message.role === "tool" && Boolean(message.toolCallId) && !validPattern.test(String(message.toolCallId)))
    ));
  if (!hasInvalidId) return messages;

  const map = new Map<string, string>();
  const used = new Set<string>();
  for (const message of messages) {
    for (const call of message.toolCalls ?? []) {
      const id = String(call?.id || "");
      if (validPattern.test(id)) used.add(id);
    }
    if (message.role === "tool" && message.toolCallId) {
      const id = String(message.toolCallId);
      if (validPattern.test(id)) used.add(id);
    }
  }

  const convert = (rawId: string, toolName = "", position = 0): string => {
    const value = String(rawId || "");
    if (validPattern.test(value)) return value;
    const existing = map.get(value);
    if (existing !== undefined) return existing;
    if (isMistral) {
      const base = fnv1aBase62(value, 9);
      let candidate = base;
      let counter = 0;
      while (used.has(candidate)) {
        candidate = `${base.slice(0, 7)}${String(++counter).padStart(2, "0")}`;
      }
      used.add(candidate);
      map.set(value, candidate);
      return candidate;
    }
    if (isKimi) {
      const tool = String(toolName || "").replace(/[^A-Za-z0-9_-]+/g, "_") || "tool";
      let candidate = `functions.${tool}:${position}`;
      for (let index = position + 1; used.has(candidate); index++) {
        candidate = `functions.${tool}:${index}`;
      }
      used.add(candidate);
      map.set(value, candidate);
      return candidate;
    }
    const cleaned = value.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
    const hash = fnv1aBase62(value, 9);
    let candidate = cleaned && cleaned.length <= 64 ? cleaned : `${(cleaned || "call").slice(0, 52)}_${hash}`;
    let counter = 0;
    while (used.has(candidate) || !SAFE_TOOL_ID.test(candidate)) {
      const prefix = (cleaned || "call").slice(0, 48);
      candidate = `${prefix}_${hash}${counter ? `_${counter}` : ""}`;
      counter++;
    }
    used.add(candidate);
    map.set(value, candidate);
    return candidate;
  };

  let position = 0;
  return messages.map(message => {
    if (message.outputParts !== undefined) return message;
    const nextToolCalls = message.toolCalls?.length
      ? message.toolCalls.map(call => ({ ...call, id: convert(call.id, call.name, position++) }))
      : undefined;
    const nextToolCallId = message.role === "tool" && message.toolCallId
      ? convert(message.toolCallId, "", position)
      : undefined;
    const nextProviderState = message.providerState !== undefined
      ? remapProviderStateToolIds(message.providerState, id => convert(id, "", position))
      : undefined;
    if (!nextToolCalls && !nextToolCallId && nextProviderState === message.providerState) {
      return message;
    }
    return {
      ...message,
      ...(nextToolCalls ? { toolCalls: nextToolCalls } : {}),
      ...(nextToolCallId ? { toolCallId: nextToolCallId } : {}),
      ...(nextProviderState !== undefined ? { providerState: nextProviderState } : {}),
    };
  });
}

/**
 * Repairs assistant messages whose `toolCalls` lack a matching `role: "tool"` result
 * in the immediately following tool block (e.g. after a cancelled/interrupted turn + model switch).
 */
export function healOrphanToolCalls(messages: readonly AgentModelMessage[]): readonly AgentModelMessage[] {
  if (!messages.length) return messages;
  let needsHeal = false;
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!;
    if (message.role === "tool") {
      needsHeal = true;
      break;
    }
    if (message.role !== "assistant" || !message.toolCalls?.length) continue;
    const expected = new Set(message.toolCalls.map(call => call.id));
    const answered = new Set<string>();
    let cursor = index + 1;
    while (cursor < messages.length && messages[cursor]!.role === "tool") {
      const toolCallId = messages[cursor]!.toolCallId?.trim();
      if (!toolCallId || !expected.has(toolCallId) || answered.has(toolCallId)) {
        needsHeal = true;
        break;
      }
      answered.add(toolCallId);
      cursor++;
    }
    if (needsHeal || message.toolCalls.some(call => !answered.has(call.id))) {
      needsHeal = true;
      break;
    }
    index = cursor - 1;
  }
  if (!needsHeal) return messages;

  const result: AgentModelMessage[] = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!;
    if (message.role === "tool") {
      // Drop orphan tool messages that have no preceding assistant toolCalls batch.
      continue;
    }
    result.push(message);
    if (message.role !== "assistant" || !message.toolCalls?.length) continue;
    const expected = new Set(message.toolCalls.map(call => call.id));
    const answered = new Set<string>();
    let lookahead = index + 1;
    while (lookahead < messages.length && messages[lookahead]!.role === "tool") {
      const toolMessage = messages[lookahead]!;
      const toolCallId = toolMessage.toolCallId?.trim();
      if (toolCallId && expected.has(toolCallId) && !answered.has(toolCallId)) {
        result.push(toolMessage);
        answered.add(toolCallId);
      }
      lookahead++;
    }
    for (const call of message.toolCalls) {
      if (!answered.has(call.id)) {
        result.push({
          role: "tool",
          toolCallId: call.id,
          content: JSON.stringify({
            ok: false,
            error: {
              code: "INTERRUPTED",
              message: "Tool execution was interrupted before completion",
            },
          }),
        });
        answered.add(call.id);
      }
    }
    index = lookahead - 1;
  }
  return result;
}

/**
 * Coalesces adjacent `role: "user"` messages so strict alternating-role providers
 * (Anthropic, Gemini, Mistral) never reject histories after an aborted turn or system injection.
 */
export function mergeConsecutiveUserMessages(messages: readonly AgentModelMessage[]): readonly AgentModelMessage[] {
  if (messages.length < 2) return messages;
  let hasAdjacentUsers = false;
  for (let index = 1; index < messages.length; index++) {
    if (messages[index - 1]!.role === "user" && messages[index]!.role === "user") {
      hasAdjacentUsers = true;
      break;
    }
  }
  if (!hasAdjacentUsers) return messages;

  const merged: AgentModelMessage[] = [];
  for (const message of messages) {
    const previous = merged.at(-1);
    if (previous && previous.role === "user" && message.role === "user") {
      const combinedContent = [previous.content, message.content].filter(Boolean).join("\n\n");
      const combinedAttachments: AgentMessageAttachment[] = [
        ...(previous.attachments ?? []),
        ...(message.attachments ?? []),
      ];
      merged[merged.length - 1] = {
        ...previous,
        content: combinedContent,
        ...(combinedAttachments.length ? { attachments: combinedAttachments } : {}),
      };
    } else {
      merged.push(message);
    }
  }
  return merged;
}

/**
 * Coalesces adjacent tool-less `role: "assistant"` messages when model switches or
 * partial/aborted turns leave consecutive assistant entries in history.
 */
export function mergeConsecutiveAssistantMessages(messages: readonly AgentModelMessage[]): readonly AgentModelMessage[] {
  if (messages.length < 2) return messages;
  let hasMergeable = false;
  for (let index = 1; index < messages.length; index++) {
    const prev = messages[index - 1]!;
    const curr = messages[index]!;
    if (prev.role === "assistant" && curr.role === "assistant"
      && !prev.toolCalls?.length && !prev.outputParts?.length && !curr.outputParts?.length) {
      hasMergeable = true;
      break;
    }
  }
  if (!hasMergeable) return messages;

  const merged: AgentModelMessage[] = [];
  for (const message of messages) {
    const previous = merged.at(-1);
    if (previous && previous.role === "assistant" && message.role === "assistant"
      && !previous.toolCalls?.length && !previous.outputParts?.length && !message.outputParts?.length) {
      const combinedContent = [previous.content, message.content].filter(Boolean).join("\n\n");
      merged[merged.length - 1] = {
        ...previous,
        content: combinedContent,
        ...(message.toolCalls?.length ? { toolCalls: message.toolCalls } : {}),
        ...(message.providerState !== undefined ? { providerState: message.providerState } : {}),
      };
    } else {
      merged.push(message);
    }
  }
  return merged;
}

function attachmentCapability(attachment: AgentMessageAttachment): string | undefined {
  if (attachment.kind === "image") return "input:image";
  if (attachment.kind !== "file") return undefined;
  if (attachment.mimeType === "application/pdf") return "input:pdf";
  if (attachment.mimeType.startsWith("audio/")) return "input:audio";
  if (attachment.mimeType.startsWith("video/")) return "input:video";
  return undefined;
}

function isAttachmentUnsupportedOnTarget(
  attachment: AgentMessageAttachment,
  options?: Pick<OfficialModelClientOptions, "providerId" | "model" | "capabilityDeclarations" | "modalityLimits">,
): boolean {
  if (!options) return false;
  const capability = attachmentCapability(attachment);
  if (!capability) return false;
  if (isModelInputExplicitlyUnsupported(options, capability)) return true;
  const explicitlySupported = options.capabilityDeclarations?.[capability]?.support === "supported";
  if (explicitlySupported) return false;
  if (options.providerId === "deepseek" || TEXT_ONLY_MODEL_FAMILY.test(options.model || "")) {
    return true;
  }
  return false;
}

function estimatedInlineBytes(attachment: AgentMessageAttachment): number {
  if (attachment.kind !== "image" && attachment.kind !== "file") return 0;
  const rawLen = attachment.dataBase64?.length ?? 0;
  return Math.floor((rawLen * 3) / 4);
}

/**
 * Degrades historical non-text attachments (prior to the latest user message) to descriptive
 * text placeholders when switching mid-session to a model that does not support that modality,
 * and offloads oldest historical inline images in a 10 MiB quantum when total inline image
 * bytes exceed 20 MiB so prompt-cache prefixes remain stable across turns.
 */
export function normalizeHistoricalAttachments(
  messages: readonly AgentModelMessage[],
  options?: Pick<OfficialModelClientOptions, "providerId" | "model" | "capabilityDeclarations" | "modalityLimits">,
): readonly AgentModelMessage[] {
  if (!messages.length) return messages;
  let lastUserIndex = -1;
  for (let idx = messages.length - 1; idx >= 0; idx--) {
    if (messages[idx]!.role === "user") {
      lastUserIndex = idx;
      break;
    }
  }

  let changed = false;
  const step1 = messages.map((message, index) => {
    if (index >= lastUserIndex || !message.attachments?.length) return message;
    const kept: AgentMessageAttachment[] = [];
    const notes: string[] = [];
    for (const attachment of message.attachments) {
      if (attachment.kind !== "text" && isAttachmentUnsupportedOnTarget(attachment, options)) {
        const label = attachment.kind === "image" ? "image" : "file";
        notes.push(`[Attached ${label}: ${attachment.name || attachment.mimeType}]`);
      } else {
        kept.push(attachment);
      }
    }
    if (!notes.length) return message;
    changed = true;
    const nextContent = [message.content, ...notes].filter(Boolean).join("\n\n");
    const { attachments: _old, ...rest } = message;
    return {
      ...rest,
      content: nextContent,
      ...(kept.length ? { attachments: kept } : {}),
    };
  });

  // Quantum-stepped inline image byte budget offloading (20 MiB trigger -> 10 MiB target).
  let totalImageBytes = 0;
  for (const message of step1) {
    for (const attachment of message.attachments ?? []) {
      if (attachment.kind === "image") totalImageBytes += estimatedInlineBytes(attachment);
    }
  }
  if (totalImageBytes <= DEFAULT_MAX_INLINE_REQUEST_IMAGE_BYTES) {
    return changed ? step1 : messages;
  }

  const targetBytes = Math.max(0, DEFAULT_MAX_INLINE_REQUEST_IMAGE_BYTES - DEFAULT_INLINE_IMAGE_OFFLOAD_BYTE_QUANTUM);
  let remainingBytes = totalImageBytes;
  return step1.map((message, index) => {
    if (index >= lastUserIndex || remainingBytes <= targetBytes || !message.attachments?.length) {
      return message;
    }
    const kept: AgentMessageAttachment[] = [];
    const notes: string[] = [];
    for (const attachment of message.attachments) {
      if (attachment.kind === "image" && remainingBytes > targetBytes) {
        remainingBytes -= estimatedInlineBytes(attachment);
        notes.push(`[Historical inline image offloaded to preserve context & KV cache budget: ${attachment.name || attachment.mimeType}]`);
      } else {
        kept.push(attachment);
      }
    }
    if (!notes.length) return message;
    const nextContent = [message.content, ...notes].filter(Boolean).join("\n\n");
    const { attachments: _old, ...rest } = message;
    return {
      ...rest,
      content: nextContent,
      ...(kept.length ? { attachments: kept } : {}),
    };
  });
}

/**
 * Reasoning wrappers any answer may open with (relay renderings of Claude's redacted thinking included). Gemini's
 * `<thought>` is not here: its live splitter already moved it to reasoning, and another model's leading `<thought>`
 * is that answer's own content.
 */
const HISTORY_REASONING_TAGS = [...INLINE_THINK_TAGS, "redacted_reasoning"];

/**
 * Strips the reasoning an earlier answer opened with, so a switch to another provider never re-sends a raw think
 * block (Cherry Studio #2). History keeps the live splitter's rule (inline-think.ts): only a block that opens the
 * answer is reasoning, and an unclosed one (a turn interrupted mid-reasoning) leaves no visible answer. A tag later in
 * the text, in a code fence or a quoted prompt, is the answer's own content and is never removed.
 */
export function stripHistoricalReasoningArtifacts(text: string): string {
  if (!text || typeof text !== "string") return text;
  const split = splitInlineThink(text, HISTORY_REASONING_TAGS);
  return split.content === text ? text : split.content.replace(/\n{3,}/g, "\n\n").trim();
}

/** Applies reasoning-artifact stripping to historical assistant text messages only. */
export function stripHistoricalReasoningFromMessages(messages: readonly AgentModelMessage[]): readonly AgentModelMessage[] {
  let changed = false;
  const result = messages.map(message => {
    if (message.role !== "assistant" || !message.content) return message;
    const content = stripHistoricalReasoningArtifacts(message.content);
    if (content === message.content) return message;
    changed = true;
    return { ...message, content };
  });
  return changed ? result : messages;
}

/**
 * Applies portable history hygiene (`stripHistoricalReasoningFromMessages`,
 * `normalizeHistoricalAttachments`, `sanitizeToolCallIds`, `healOrphanToolCalls`,
 * `mergeConsecutiveUserMessages`, `mergeConsecutiveAssistantMessages`) before
 * building provider-specific wire payloads.
 */
export function normalizePortableHistory(
  messages: readonly AgentModelMessage[],
  options?: Pick<OfficialModelClientOptions, "providerId" | "model" | "capabilityDeclarations" | "modalityLimits"> & { readonly protocol?: string },
): readonly AgentModelMessage[] {
  const reasoningStripped = stripHistoricalReasoningFromMessages(messages);
  const attachmentsNormalized = normalizeHistoricalAttachments(reasoningStripped, options);
  const sanitized = sanitizeToolCallIds(attachmentsNormalized, options);
  const healed = healOrphanToolCalls(sanitized);
  const usersMerged = mergeConsecutiveUserMessages(healed);
  return mergeConsecutiveAssistantMessages(usersMerged);
}

/**
 * Converts a JSON Schema into the subset Gemini's `functionDeclarations.parameters` accepts.
 */
export function geminiSchema(
  schema: Record<string, unknown>,
  root: Record<string, unknown> = schema,
  depth = 0,
): Record<string, unknown> {
  if (depth > MAX_SCHEMA_DEPTH || !schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { type: "object" };
  }
  let source: Record<string, any> = schema;
  if (typeof source.$ref === "string" && source.$ref.startsWith("#/")) {
    const target = source.$ref
      .slice(2)
      .split("/")
      .reduce<any>((node, part) => node?.[part.replace(/~1/g, "/").replace(/~0/g, "~")], root);
    if (target && typeof target === "object" && !Array.isArray(target)) {
      const { $ref: _ref, ...sibling } = source;
      source = { ...target, ...sibling };
    }
  }
  const out: Record<string, unknown> = {};
  const rawTypes = Array.isArray(source.type)
    ? source.type
    : typeof source.type === "string"
      ? [source.type]
      : [];
  const nonNull = rawTypes.filter((item: unknown) => item !== "null");
  const nullable = rawTypes.includes("null") ? ["null"] : [];
  let type: string | undefined = nonNull[0]?.toLowerCase?.();
  if (nonNull.length > 1) {
    return {
      anyOf: nonNull.map((item: string) => geminiSchema({ ...source, type: item }, root, depth + 1)),
      ...(nullable.length ? { nullable: true } : {}),
    };
  }
  const variants: unknown[] | undefined = Array.isArray(source.anyOf)
    ? source.anyOf
    : Array.isArray(source.oneOf)
      ? source.oneOf
      : undefined;
  if (variants?.length) {
    const kept = variants.filter((item: any) => item?.type !== "null" && item?.const !== null);
    if (kept.length !== variants.length) out.nullable = true;
    if (kept.length === 1) {
      return {
        ...geminiSchema(kept[0] as Record<string, unknown>, root, depth + 1),
        ...out,
        ...(source.description ? { description: String(source.description) } : {}),
      };
    }
    return {
      anyOf: kept.map(item => geminiSchema(item as Record<string, unknown>, root, depth + 1)),
      ...out,
      ...(source.description ? { description: String(source.description) } : {}),
    };
  }
  if (source.const !== undefined && source.enum === undefined) {
    source = { ...source, enum: [source.const] };
  }
  if (!type) {
    type = source.properties ? "object" : source.items ? "array" : source.enum ? "string" : "string";
  }
  out.type = type;
  if (nullable.length || source.nullable === true) out.nullable = true;
  for (const key of Object.keys(source)) {
    if (!GEMINI_SCHEMA_KEYS.has(key) || ["type", "nullable", "properties", "items", "anyOf", "required", "enum", "format"].includes(key)) {
      continue;
    }
    const value = source[key];
    if (["title", "description", "pattern"].includes(key) && typeof value === "string") {
      out[key] = value.slice(0, 4000);
    } else if (Number.isFinite(value)) {
      out[key] = value;
    } else if (key === "propertyOrdering" && Array.isArray(value)) {
      out[key] = value.filter((item: unknown) => typeof item === "string");
    }
  }
  if (typeof source.format === "string" && GEMINI_FORMATS[type]?.has(source.format)) {
    out.format = source.format;
  }
  if (Array.isArray(source.enum)) {
    const values: unknown[] = source.enum.filter((value: unknown) => value !== null);
    const numeric = (type === "number" || type === "integer") && values.length > 0
      && values.every(value => typeof value === "number" && Number.isFinite(value) && (type !== "integer" || Number.isInteger(value)));
    const boolean = type === "boolean" && values.length > 0 && values.every(value => typeof value === "boolean");
    if (numeric || boolean) {
      // Gemini accepts `enum` only on STRING; a numeric enum fails the whole request (400). Keep the native type so
      // the model returns a real number/boolean, name the allowed values, and let the tool's own schema enforce them.
      const allowed = [...new Set(values.map(value => String(value)))].join(", ");
      out.description = `${typeof out.description === "string" && out.description ? `${out.description} ` : ""}Allowed values: ${allowed}.`.slice(0, 4000);
    } else if (values.length) {
      // String (or mixed) values: Gemini's string enum, with the type that goes with it.
      out.enum = [...new Set(values.map(value => String(value)))];
      if (type !== "string") out.type = "string";
    }
  }
  if (type === "object") {
    const properties = source.properties && typeof source.properties === "object" && !Array.isArray(source.properties)
      ? source.properties as Record<string, Record<string, unknown>>
      : {};
    const names = Object.keys(properties).slice(0, 512);
    if (names.length) {
      out.properties = Object.fromEntries(names.map(name => [name, geminiSchema(properties[name]!, root, depth + 1)]));
    }
    const required = Array.isArray(source.required)
      ? source.required.filter((name: unknown): name is string => typeof name === "string" && names.includes(name))
      : [];
    if (required.length) out.required = [...new Set(required)];
  } else if (type === "array") {
    const rawItems = Array.isArray(source.items) ? source.items[0] : source.items;
    out.items = geminiSchema((rawItems && typeof rawItems === "object" ? rawItems : {}) as Record<string, unknown>, root, depth + 1);
  }
  return out;
}

/**
 * Strips top-level metadata keywords (`$schema`, `$id`) and normalizes `const` -> `enum`
 * while keeping full JSON Schema for OpenAI, Anthropic, and Cohere.
 */
export function portableSchema(schema: Record<string, unknown>, depth = 0): Record<string, unknown> {
  return portableSchemaValue(schema, depth) as Record<string, unknown>;
}

function portableSchemaValue(schema: unknown, depth = 0): unknown {
  if (depth > MAX_SCHEMA_DEPTH || !schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(item => portableSchemaValue(item, depth + 1));
  const record = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === "$schema" || key === "$id") continue;
    if (key === "const" && record.enum === undefined) {
      out.enum = [value];
      continue;
    }
    out[key] = value && typeof value === "object" ? portableSchemaValue(value, depth + 1) : value;
  }
  return out;
}
