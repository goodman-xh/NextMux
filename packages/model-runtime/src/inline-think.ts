import { invalidToolArguments, toolCallArguments } from "@nextmux/agent-runtime";

export interface InlineThinkChunkResult {
  readonly reasoning: string;
  readonly content: string;
  readonly closedNow: boolean;
}

export interface InlineThinkTagSplitter {
  push(chunk: string): InlineThinkChunkResult;
  flush(): InlineThinkChunkResult;
  disable(): InlineThinkChunkResult;
  readonly isThinking: boolean;
  readonly hasExtractedReasoning: boolean;
}

function trailingPrefixOverlap(text: string, target: string): number {
  const lower = text.toLowerCase();
  const maxCheck = Math.min(lower.length, target.length - 1);
  for (let len = maxCheck; len >= 1; len--) {
    if (target.startsWith(lower.slice(lower.length - len))) {
      return len;
    }
  }
  return 0;
}

/** Reasoning tags any model may open its answer with. */
export const INLINE_THINK_TAGS: readonly string[] = Object.freeze(["thinking", "think"]);

/**
 * The inline reasoning tags a model opens its answer with, as Cherry Studio maps them: Gemini through an
 * OpenAI-compatible endpoint wraps its thought summary in `<thought>`.
 */
export function inlineThinkTagsFor(model: string | undefined): readonly string[] {
  return /gemini/i.test(model ?? "") ? [...INLINE_THINK_TAGS, "thought"] : INLINE_THINK_TAGS;
}

/**
 * Stateful streaming splitter that extracts a leading `<think>...</think>` (or another of `tags`) block at the
 * start of an assistant response stream. A tag split across chunks is held until it is complete, an unclosed block
 * becomes reasoning at `flush()`, and a literal tag later in the answer (a code fence, a quoted prompt) stays content.
 */
export function createInlineThinkTagSplitter(tags: readonly string[] = INLINE_THINK_TAGS): InlineThinkTagSplitter {
  // Longest first, so "<thinking>" is never read as "<think>" followed by "ing>".
  const openings = [...new Set(tags)].map(name => ({ open: `<${name.toLowerCase()}>`, close: `</${name.toLowerCase()}>` }))
    .sort((left, right) => right.open.length - left.open.length);
  let state: "initial" | "thinking" | "passthrough" = "initial";
  let buffer = "";
  let closeTag = "</think>";
  let stripLeadingAfterClose = false;
  let extractedAny = false;

  const consumeThinkingBuffer = (finalFlush = false): InlineThinkChunkResult => {
    if (!buffer) return { reasoning: "", content: "", closedNow: false };
    const lower = buffer.toLowerCase();
    const closeIdx = lower.indexOf(closeTag);
    if (closeIdx !== -1) {
      const reasoning = buffer.slice(0, closeIdx);
      let remainder = buffer.slice(closeIdx + closeTag.length);
      remainder = remainder.replace(/^\s+/, "");
      stripLeadingAfterClose = remainder.length === 0;
      buffer = "";
      state = "passthrough";
      if (reasoning) extractedAny = true;
      return { reasoning, content: remainder, closedNow: true };
    }
    if (finalFlush) {
      const reasoning = buffer;
      buffer = "";
      state = "passthrough";
      if (reasoning) extractedAny = true;
      return { reasoning, content: "", closedNow: true };
    }
    const holdback = trailingPrefixOverlap(buffer, closeTag);
    const safeEnd = buffer.length - holdback;
    if (safeEnd <= 0) {
      return { reasoning: "", content: "", closedNow: false };
    }
    const reasoning = buffer.slice(0, safeEnd);
    buffer = buffer.slice(safeEnd);
    if (reasoning) extractedAny = true;
    return { reasoning, content: "", closedNow: false };
  };

  return {
    get isThinking() {
      return state === "thinking";
    },
    get hasExtractedReasoning() {
      return extractedAny;
    },
    disable(): InlineThinkChunkResult {
      if (state === "passthrough") return { reasoning: "", content: "", closedNow: false };
      const pending = buffer;
      buffer = "";
      const wasThinking = state === "thinking";
      state = "passthrough";
      if (wasThinking) {
        if (pending) extractedAny = true;
        return { reasoning: pending, content: "", closedNow: true };
      }
      return { reasoning: "", content: pending, closedNow: false };
    },
    push(chunk: string): InlineThinkChunkResult {
      if (!chunk) return { reasoning: "", content: "", closedNow: false };
      if (state === "passthrough") {
        let content = chunk;
        if (stripLeadingAfterClose) {
          content = content.replace(/^\s+/, "");
          if (content.length > 0) stripLeadingAfterClose = false;
        }
        return { reasoning: "", content, closedNow: false };
      }
      buffer += chunk;
      if (state === "initial") {
        const trimmed = buffer.trimStart();
        if (!trimmed) {
          if (buffer.length > 64) {
            const content = buffer;
            buffer = "";
            state = "passthrough";
            return { reasoning: "", content, closedNow: false };
          }
          return { reasoning: "", content: "", closedNow: false };
        }
        const lower = trimmed.toLowerCase();
        const opening = openings.find(tag => lower.startsWith(tag.open));
        if (opening) {
          closeTag = opening.close;
          state = "thinking";
          extractedAny = true;
          buffer = trimmed.slice(opening.open.length);
          return consumeThinkingBuffer(false);
        }
        if (openings.some(tag => tag.open.startsWith(lower))) {
          return { reasoning: "", content: "", closedNow: false };
        }
        const content = buffer;
        buffer = "";
        state = "passthrough";
        return { reasoning: "", content, closedNow: false };
      }
      return consumeThinkingBuffer(false);
    },
    flush(): InlineThinkChunkResult {
      if (state === "initial") {
        const content = buffer;
        buffer = "";
        state = "passthrough";
        return { reasoning: "", content, closedNow: false };
      }
      if (state === "thinking") {
        return consumeThinkingBuffer(true);
      }
      return { reasoning: "", content: "", closedNow: false };
    },
  };
}

/**
 * Splits a leading `<think>...</think>` or `<thinking>...</thinking>` block from a buffered assistant message.
 */
export function splitInlineThink(text: string, tags: readonly string[] = INLINE_THINK_TAGS): { reasoning: string; content: string } {
  if (!text || typeof text !== "string") return { reasoning: "", content: text || "" };
  const splitter = createInlineThinkTagSplitter(tags);
  const first = splitter.push(text);
  const last = splitter.flush();
  if (!splitter.hasExtractedReasoning) {
    return { reasoning: "", content: text };
  }
  return {
    reasoning: `${first.reasoning}${last.reasoning}`.trim(),
    content: `${first.content}${last.content}`,
  };
}

function extractFirstBalancedObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start === -1) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const ch = text[index]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }
  return undefined;
}

/**
 * Repairs common LLM JSON corruptions inside tool call arguments:
 * - Outer markdown code fences (```json ... ```)
 * - Unescaped literal control characters (\n, \r, \t) inside JSON string literals
 * - Invalid single-char backslash escapes (\', \_, \$, Windows paths) inside JSON strings
 * - Line/block comments outside strings
 * - Python booleans/None (`True`, `False`, `None`) outside strings
 * - Trailing commas before `}` or `]`
 */
export function sanitizeNonStrictToolJson(raw: string): string {
  let text = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fenced?.[1] !== undefined) text = fenced[1].trim();

  let out = "";
  let inString = false;
  let index = 0;
  while (index < text.length) {
    const ch = text[index]!;
    if (inString) {
      if (ch === "\\") {
        const next = text[index + 1];
        if (next === undefined) {
          out += "\\\\";
          index++;
          continue;
        }
        if ('"\\/bfnrt'.includes(next)) {
          out += ch + next;
          index += 2;
          continue;
        }
        if (next === "u" && /^[0-9a-fA-F]{4}$/.test(text.slice(index + 2, index + 6))) {
          out += text.slice(index, index + 6);
          index += 6;
          continue;
        }
        out += "\\\\" + next;
        index += 2;
        continue;
      }
      if (ch === '"') {
        inString = false;
        out += ch;
        index++;
        continue;
      }
      const code = ch.charCodeAt(0);
      if (code === 0x0a) {
        out += "\\n";
      } else if (code === 0x0d) {
        out += "\\r";
      } else if (code === 0x09) {
        out += "\\t";
      } else if (code < 0x20) {
        out += `\\u${code.toString(16).padStart(4, "0")}`;
      } else {
        out += ch;
      }
      index++;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      index++;
      continue;
    }
    if (ch === "/" && text[index + 1] === "/") {
      index += 2;
      while (index < text.length && text[index] !== "\n" && text[index] !== "\r") index++;
      continue;
    }
    if (ch === "/" && text[index + 1] === "*") {
      const endComment = text.indexOf("*/", index + 2);
      index = endComment === -1 ? text.length : endComment + 2;
      continue;
    }
    out += ch;
    index++;
  }

  // Replace standalone Python literals outside strings and strip trailing commas.
  let cleaned = "";
  inString = false;
  let escaped = false;
  for (let i = 0; i < out.length; i++) {
    const ch = out[i]!;
    if (inString) {
      cleaned += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      cleaned += ch;
      continue;
    }
    if (ch === ",") {
      let lookahead = i + 1;
      while (lookahead < out.length && /\s/.test(out[lookahead]!)) lookahead++;
      if (out[lookahead] === "}" || out[lookahead] === "]") {
        continue;
      }
    }
    const prev = i > 0 ? out[i - 1]! : "";
    if (!/[A-Za-z0-9_$]/.test(prev)) {
      if (out.startsWith("True", i) && !/[A-Za-z0-9_$]/.test(out[i + 4] ?? "")) {
        cleaned += "true";
        i += 3;
        continue;
      }
      if (out.startsWith("False", i) && !/[A-Za-z0-9_$]/.test(out[i + 5] ?? "")) {
        cleaned += "false";
        i += 4;
        continue;
      }
      if (out.startsWith("None", i) && !/[A-Za-z0-9_$]/.test(out[i + 4] ?? "")) {
        cleaned += "null";
        i += 3;
        continue;
      }
    }
    cleaned += ch;
  }
  return cleaned;
}

/**
 * Repairs and parses tool call arguments (whether passed as an object, JSON string, or malformed LLM JSON).
 */
export function repairedToolCallArguments(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return toolCallArguments(raw);
  }
  if (typeof raw !== "string") {
    return toolCallArguments(raw);
  }
  const direct = toolCallArguments(raw);
  if (!invalidToolArguments(direct)) return direct;

  const sanitized = sanitizeNonStrictToolJson(raw);
  const fromSanitized = toolCallArguments(sanitized);
  if (!invalidToolArguments(fromSanitized)) return fromSanitized;

  const balanced = extractFirstBalancedObject(sanitized) ?? extractFirstBalancedObject(raw);
  if (balanced) {
    const fromBalanced = toolCallArguments(sanitizeNonStrictToolJson(balanced));
    if (!invalidToolArguments(fromBalanced)) return fromBalanced;
  }
  return direct;
}
