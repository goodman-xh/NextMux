import { createHash } from "node:crypto";
import { repairToolArguments, withoutTrailingCommas } from "./tool-arguments.js";
import { createToolNameCodec } from "./tool-names.js";

/**
 * Tool calls a model wrote out as text. Some relays pass `tools` to a model server that has no tool-call parser, and
 * the model then answers with the call as text: seen on 2026-09-30 from grok-4.6 (```json {"name":…,"arguments":…}),
 * qwen3-coder-flash (<function=…><parameter=…>), qwen-vl-plus ({"tool":…,"path":…}), qwen-vl-ocr (name{…}) and
 * gpt-3.5-turbo-16k / qwen-vl-max (name("README.md")). Like the tool parsers of vLLM and SGLang (hermes, qwen3_coder,
 * pythonic, kimi_k2, deepseek_v3), this turns such a reply back into calls, but only when the whole reply is calls
 * naming offered tools (a short preamble may come before a tagged block), so prose or an example never runs.
 */

export interface TextToolCall {
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export interface TextToolCallRepair {
  /** Text before a tagged block ("I'll read the file."), shown as the reply; empty for a bare call. */
  readonly preamble: string;
  readonly calls: readonly TextToolCall[];
}

interface ToolShape {
  readonly name: string;
  readonly inputSchema?: Readonly<Record<string, unknown>>;
}

const MAX_REPLY_CHARS = 64_000;
const MAX_PREAMBLE_CHARS = 400;
const MAX_CALLS = 16;
/** A held reply longer than this is shown after all; a real call is far shorter. */
const MAX_HELD_CHARS = 32_000;

const TAG_OPENER = /<(?:antml:|｜DSML｜|\|DSML\|)?(?:tool_call>|function(?:=|\s+name=["'])|function_calls>|invoke\s)|<\|tool_calls?_(?:section_)?begin\|>|<｜tool▁calls?▁begin｜>/;
const TAG_OPENERS = [
  "<tool_call>", "<function=", "<function ", "<function name=\"", "<function name='",
  "<function_calls>", "<invoke ", "<invoke name=\"", "<invoke name='",
  "<|tool_calls_section_begin|>", "<|tool_call_begin|>", "<｜tool▁calls▁begin｜>", "<｜tool▁call▁begin｜>",
];
/** Namespaces a tag may carry: Anthropic-style XML, and DeepSeek's DSML in full-width or ASCII bars. */
const TAG_PREFIXES = ["antml:", "｜DSML｜", "|DSML|"];
const WRAPPERS = /^(?:<\/?(?:antml:|｜DSML｜|\|DSML\|)?function_calls>|<\|tool_calls_section_(?:begin|end)\|>|<｜tool▁calls▁(?:begin|end)｜>)/;
const FENCE_LANGUAGES = new Set(["", "json", "json5", "tool_code", "tool_call", "tool", "python", "py", "xml"]);

type Resolve = (raw: string) => string | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  try { return JSON.parse(text); } catch {
    const trimmed = text.trim();
    if (!trimmed) return undefined;
    try { return JSON.parse(withoutTrailingCommas(trimmed)); } catch {
      return (trimmed.startsWith("{") && trimmed.endsWith("}")) || /^```[\s\S]*```$/.test(trimmed)
        ? repairToolArguments(trimmed)
        : undefined;
    }
  }
}

function toolResolver(tools: readonly ToolShape[]): Resolve {
  const codec = createToolNameCodec(tools);
  const names = new Set(tools.map(tool => tool.name));
  // The platform gateway names a tool nmx_<first 12 hex of its SHA-256>_<readable> when aliases collide.
  const hashed = new Map(tools.map(tool => [`nmx_${createHash("sha256").update(tool.name).digest("hex").slice(0, 12)}_`, tool.name]));
  const direct = (name: string): string | undefined => {
    const decoded = codec.decode(name);
    if (names.has(decoded)) return decoded;
    const prefix = /^nmx_[0-9a-f]{12}_/.exec(name)?.[0];
    return prefix ? hashed.get(prefix) : undefined;
  };
  return raw => {
    const name = raw.trim().replace(/^["'`]+|["'`]+$/g, "");
    if (!name || name.length > 160) return undefined;
    // Kimi writes functions.<name>:<index>; Gemini's pythonic form writes default_api.<name>.
    return direct(name) ?? direct(name.replace(/^(?:functions|default_api)\./, "").replace(/:\d+$/, ""));
  };
}

function argumentsObject(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return {};
  if (typeof value === "string") {
    if (!value.trim()) return {};
    const parsed = parseJson(value);
    return isRecord(parsed) ? parsed : undefined;
  }
  return isRecord(value) ? value : undefined;
}

function jsonCall(value: unknown, resolve: Resolve): TextToolCall | undefined {
  if (!isRecord(value)) return undefined;
  if (isRecord(value.function)) return jsonCall(value.function, resolve);
  const nameKey = ["name", "tool", "tool_name", "function", "recipient_name"].find(key => typeof value[key] === "string");
  if (!nameKey) return undefined;
  const name = resolve(value[nameKey] as string);
  if (!name) return undefined;
  const argumentKey = ["arguments", "parameters", "args", "input", "params"].find(key => key in value);
  let args: Record<string, unknown> | undefined;
  if (argumentKey) args = argumentsObject(value[argumentKey]);
  else {
    // {"tool": "workspace.read_file", "path": "README.md"}: the other fields are the arguments.
    const { [nameKey]: _name, type: _type, id: _id, ...rest } = value;
    args = rest;
  }
  return args ? { name, arguments: args } : undefined;
}

function jsonCalls(value: unknown, resolve: Resolve): TextToolCall[] | undefined {
  const list = isRecord(value) && Array.isArray(value.tool_calls) ? value.tool_calls : value;
  const items = Array.isArray(list) ? list : [list];
  if (!items.length || items.length > MAX_CALLS) return undefined;
  const calls = items.map(item => jsonCall(item, resolve));
  return calls.every((call): call is TextToolCall => Boolean(call)) ? calls : undefined;
}

/** Index just past the bracket that closes the one at `start`, skipping quoted strings; -1 when unbalanced. */
function closingIndex(text: string, start: number): number {
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const stack: string[] = [];
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (char === '"' || char === "'") {
      for (index++; index < text.length && text[index] !== char; index++) if (text[index] === "\\") index++;
      continue;
    }
    if (pairs[char]) stack.push(pairs[char]);
    else if (char === ")" || char === "]" || char === "}") {
      if (stack.pop() !== char) return -1;
      if (!stack.length) return index + 1;
    }
  }
  return -1;
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0, start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"' || char === "'") {
      for (index++; index < text.length && text[index] !== char; index++) if (text[index] === "\\") index++;
    } else if ("([{".includes(char)) depth++;
    else if (")]}".includes(char)) depth--;
    else if (char === "," && depth === 0) { parts.push(text.slice(start, index)); start = index + 1; }
  }
  parts.push(text.slice(start));
  return parts.map(part => part.trim()).filter(Boolean);
}

const NO_VALUE = Symbol("no value");

function literal(text: string): unknown {
  const value = text.trim();
  if (/^'(?:[^'\\]|\\.)*'$/.test(value)) {
    return parseJson(`"${value.slice(1, -1).replace(/\\.|"/g, match => match === "\\'" ? "'" : match === '"' ? '\\"' : match)}"`) ?? NO_VALUE;
  }
  if (value === "True") return true;
  if (value === "False") return false;
  if (value === "None") return null;
  const parsed = parseJson(value);
  return parsed === undefined ? NO_VALUE : parsed;
}

/** `name(path="a")`, `name("a")`, `name({"path":"a"})` or `name{"path":"a"}`, alone, one per line, or in a `[...]` list. */
function expressionCalls(body: string, resolve: Resolve, tools: ReadonlyMap<string, ToolShape>): TextToolCall[] | undefined {
  let text = body.trim();
  if (text.startsWith("[") && text.endsWith("]") && closingIndex(text, 0) === text.length) text = text.slice(1, -1);
  const calls: TextToolCall[] = [];
  let index = 0;
  while (index < text.length) {
    while (index < text.length && /[\s,;]/.test(text[index])) index++;
    if (index >= text.length) break;
    const identifier = /^[A-Za-z_][\w.:-]*/.exec(text.slice(index))?.[0];
    const name = identifier && resolve(identifier);
    if (!identifier || !name || calls.length >= MAX_CALLS) return undefined;
    index += identifier.length;
    while (text[index] === " ") index++;
    const open = text[index];
    if (open !== "(" && open !== "{") return undefined;
    const end = closingIndex(text, index);
    if (end < 0) return undefined;
    const inner = text.slice(index + 1, end - 1);
    index = end;
    let args: Record<string, unknown> | undefined;
    if (open === "{") args = argumentsObject(`{${inner}}`);
    else {
      const parts = splitTopLevel(inner);
      const single = parts.length === 1 ? parseJson(parts[0]) : undefined;
      if (isRecord(single)) args = single;
      else {
        const named: Record<string, unknown> = {}, positional: unknown[] = [];
        for (const part of parts) {
          const keyword = /^([A-Za-z_]\w*)\s*=(?!=)\s*([\s\S]+)$/.exec(part);
          const value = literal(keyword ? keyword[2] : part);
          if (value === NO_VALUE) return undefined;
          if (keyword) named[keyword[1]] = value;
          else if (Object.keys(named).length) return undefined;
          else positional.push(value);
        }
        if (positional.length) {
          // Positional values take the required parameters in order (or the only parameter).
          const schema = tools.get(name)?.inputSchema ?? {};
          const required = Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === "string") : [];
          const properties = isRecord(schema.properties) ? Object.keys(schema.properties) : [];
          const order = required.length ? required : properties.length === 1 ? properties : [];
          if (positional.length > order.length) return undefined;
          positional.forEach((value, position) => { named[order[position]] = value; });
        }
        args = named;
      }
    }
    if (!args) return undefined;
    calls.push({ name, arguments: args });
  }
  return calls.length ? calls : undefined;
}

/** Strip XML framing newlines on scalar string parameters while keeping raw payload bodies intact. */
function parameterValue(tool: ToolShape | undefined, key: string, raw: string, framedBlock = false): unknown {
  const properties = isRecord(tool?.inputSchema?.properties) ? tool!.inputSchema!.properties as Record<string, unknown> : {};
  const property = properties[key];
  const types = isRecord(property) ? [property.type].flat().filter((type): type is string => typeof type === "string") : [];
  const trimmedFraming = raw.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
  if (!types.length || types.includes("string")) {
    const isUnion = types.some(type => type !== "string");
    const isRawPayload = key === "content" || key === "data" || key === "constructor";
    if (isUnion || (isRawPayload && !framedBlock)) return raw;
    return trimmedFraming;
  }
  const parsed = parseJson(trimmedFraming.trim());
  return parsed === undefined ? trimmedFraming : parsed;
}

function xmlParameters(body: string, pattern: RegExp, tool: ToolShape | undefined): Record<string, unknown> | undefined {
  const args: Record<string, unknown> = {};
  let rest = body;
  const framedBlock = /^\r?\n/.test(body);
  for (const match of body.matchAll(pattern)) {
    const key = match[1] || match[2];
    const value = match.length > 3 ? match[3] : match[2];
    if (!key || Object.prototype.hasOwnProperty.call(args, key)) return undefined;
    if (/^[^<\n\r"'`/]*<\/(?:antml:|｜DSML｜|\|DSML\|)?parameter>[^<\n\r"'`/]*$/.test(value)) return undefined;
    Object.defineProperty(args, key, { value: parameterValue(tool, key, value, framedBlock), enumerable: true, writable: true, configurable: true });
    rest = rest.replace(match[0], "");
  }
  return rest.trim() ? undefined : args;
}

function glmParameters(body: string, tool: ToolShape | undefined): Record<string, unknown> | undefined {
  const pattern = /<arg_key>([\s\S]*?)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>(?=\s*(?:<arg_key>|$))/g;
  const args: Record<string, unknown> = {};
  let rest = body;
  let matched = false;
  const framedBlock = /^\r?\n/.test(body);
  for (const match of body.matchAll(pattern)) {
    matched = true;
    const key = match[1].trim();
    const value = match[2];
    if (!key || Object.prototype.hasOwnProperty.call(args, key)) return undefined;
    Object.defineProperty(args, key, { value: parameterValue(tool, key, value, framedBlock || /^\r?\n/.test(value)), enumerable: true, writable: true, configurable: true });
    rest = rest.replace(match[0], "");
  }
  return matched && !rest.trim() ? args : undefined;
}

const PARAMETER_TAG_PATTERN = /<(?:antml:|｜DSML｜|\|DSML\|)?parameter(?:=([^>\s]+)|\b[^>]*?\bname=["']([^"']+)["'][^>]*?)>([\s\S]*?)<\/(?:antml:|｜DSML｜|\|DSML\|)?parameter>(?=\s*(?:<(?:antml:|｜DSML｜|\|DSML\|)?parameter\b|$))/g;

function taggedCalls(text: string, resolve: Resolve, tools: ReadonlyMap<string, ToolShape>): TextToolCallRepair | undefined {
  const opener = TAG_OPENER.exec(text);
  if (!opener) return undefined;
  const preamble = text.slice(0, opener.index).trim();
  if (preamble.length > MAX_PREAMBLE_CHARS) return undefined;
  let rest = text.slice(opener.index).trim();
  const calls: TextToolCall[] = [];
  const named = (raw: string, body: string, parse: (tool: ToolShape | undefined) => Record<string, unknown> | undefined): boolean => {
    const name = resolve(raw);
    const args = name ? parse(tools.get(name)) : undefined;
    if (!name || !args) return false;
    calls.push({ name, arguments: args });
    return true;
  };
  const qwen = (name: string, body: string): boolean => named(name, body, tool => {
    const xml = xmlParameters(body, PARAMETER_TAG_PATTERN, tool);
    if (xml) return xml;
    if (/<\/?(?:antml:|｜DSML｜|\|DSML\|)?parameter\b/.test(body)) return undefined;
    if (/<arg_key>/.test(body)) return glmParameters(body, tool);
    const trimmed = body.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    if (!trimmed.startsWith("{")) return undefined;
    const parsed = parseJson(trimmed);
    return isRecord(parsed) ? parsed : undefined;
  });
  while (rest) {
    // Consume envelope tags only between calls, never from an argument value.
    const wrapper = WRAPPERS.exec(rest);
    if (wrapper) { rest = rest.slice(wrapper[0].length).trim(); continue; }
    if (calls.length >= MAX_CALLS) return undefined;
    let match: RegExpExecArray | null;
    let ok = false;
    if ((match = /^<(?:antml:|｜DSML｜|\|DSML\|)?tool_call>\s*([\s\S]*?)\s*(<\/(?:antml:|｜DSML｜|\|DSML\|)?tool_call>|$)/.exec(rest))) {
      const closed = Boolean(match[2]);
      const inner = match[1].replace(/^```(?:json|xml)?\s*|\s*```$/g, "").trim();
      const fnInner = /^<(?:antml:|｜DSML｜|\|DSML\|)?(?:function(?:=([^>\s]+)|\b[^>]*?\bname=["']([^"']+)["'][^>]*?)|invoke\b[^>]*?\bname=["']([^"']+)["'][^>]*?)>([\s\S]*?)<\/(?:antml:|｜DSML｜|\|DSML\|)?(?:function|invoke)>$/.exec(inner);
      const glmInner = !fnInner && closed ? /^([^\s<]+)\s*(<arg_key>[\s\S]*)$/.exec(inner) : null;
      if (fnInner && closed) {
        ok = qwen(fnInner[1] || fnInner[2] || fnInner[3], fnInner[4]);
      } else if (glmInner && closed) {
        ok = named(glmInner[1], glmInner[2], tool => glmParameters(glmInner[2], tool));
      } else if (closed && /^<(?:antml:|｜DSML｜|\|DSML\|)?(?:function(?:=|\s+name=["'])|function_calls>|invoke\s)/.test(inner)) {
        const nested = taggedCalls(inner, resolve, tools);
        ok = Boolean(nested && !nested.preamble && calls.length + nested.calls.length <= MAX_CALLS && calls.push(...nested.calls));
      } else if (!/^<(?:antml:|｜DSML｜|\|DSML\|)?(?:function|invoke|parameter|arg_key)\b/.test(inner)) {
        const parsed = jsonCalls(parseJson(inner), resolve);
        ok = Boolean(parsed && calls.push(...parsed));
      }
    } else if ((match = /^<(?:antml:|｜DSML｜|\|DSML\|)?function(?:=([^>\s]+)|\b[^>]*?\bname=["']([^"']+)["'][^>]*?)>([\s\S]*?)<\/(?:antml:|｜DSML｜|\|DSML\|)?function>/.exec(rest))) {
      ok = qwen(match[1] || match[2], match[3]);
    } else if ((match = /^<(?:antml:|｜DSML｜|\|DSML\|)?invoke\b[^>]*?\bname=["']([^"']+)["'][^>]*?>([\s\S]*?)<\/(?:antml:|｜DSML｜|\|DSML\|)?invoke>/.exec(rest))) {
      ok = qwen(match[1], match[2]);
    } else if ((match = /^<\|tool_call_begin\|>\s*([^<\s]+)\s*<\|tool_call_argument_begin\|>([\s\S]*?)(?:<\|tool_call_end\|>|(?=<\|tool_calls_section_end\|>))/.exec(rest))) {
      const body = match[2];
      ok = named(match[1], body, () => argumentsObject(body.trim()));
    } else if ((match = /^<｜tool▁call▁begin｜>(?:function<｜tool▁sep｜>)?([^\s<｜]+)\s*(?:<｜tool▁sep｜>)?\s*([\s\S]*?)(?:<｜tool▁call▁end｜>|(?=<｜tool▁calls▁end｜>))/.exec(rest))) {
      const body = match[2].trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
      ok = named(match[1], body, () => argumentsObject(body));
    }
    if (!match || !ok || !match[0] || calls.length > MAX_CALLS) return undefined;
    rest = rest.slice(match[0].length).trim();
  }
  return calls.length ? { preamble, calls } : undefined;
}

function unfenced(text: string): string {
  const fence = /^```([\w-]*)[^\S\n]*\n([\s\S]*?)(?:\n?```)?$/.exec(text);
  return fence && FENCE_LANGUAGES.has(fence[1].toLowerCase()) ? fence[2].trim() : text;
}

/** The calls this reply consists of, or undefined when it is an ordinary reply. */
export function parseTextToolCalls(content: string, tools: readonly ToolShape[]): TextToolCallRepair | undefined {
  const text = String(content || "").trim();
  if (!text || text.length > MAX_REPLY_CHARS || !tools.length) return undefined;
  const resolve = toolResolver(tools);
  const byName = new Map(tools.map(tool => [tool.name, tool]));
  const tagged = taggedCalls(text, resolve, byName);
  if (tagged) return tagged;
  const body = unfenced(text);
  if (body !== text) {
    const inner = taggedCalls(body, resolve, byName);
    if (inner && !inner.preamble) return inner;
  }
  const calls = /^[{[]/.test(body) ? jsonCalls(parseJson(body), resolve) ?? expressionCalls(body, resolve, byName)
    : expressionCalls(body, resolve, byName);
  return calls ? { preamble: "", calls } : undefined;
}

/**
 * While a reply streams, where its visible part ends: from here on it may be a tool call written as text, which is held
 * back so the user never sees raw call markup. What is held is shown once the reply turns out to be ordinary text.
 */
/** A trailing "<…" that could still open a call, its namespace prefix included or still arriving. */
function couldOpenTag(tail: string): boolean {
  const body = tail.slice(1);
  if (TAG_PREFIXES.some(prefix => prefix.startsWith(body))) return true;
  const bare = `<${body.slice((TAG_PREFIXES.find(prefix => body.startsWith(prefix)) ?? "").length)}`;
  return TAG_OPENERS.some(opener => opener.startsWith(bare)) || /^<(?:function|invoke)\s+(?:name(?:=\s*)?)?$/.test(bare);
}

export function textToolCallHoldback(text: string, tools: readonly ToolShape[]): number {
  if (!tools.length) return text.length;
  const head = text.slice(0, MAX_PREAMBLE_CHARS + 200);
  const tag = TAG_OPENER.exec(head);
  let hold = text.length;
  if (tag) hold = tag.index;
  else {
    // A tag may be arriving: hold a trailing "<too…" that could still open one.
    const last = head.lastIndexOf("<");
    if (last >= 0 && last === text.lastIndexOf("<") && couldOpenTag(text.slice(last))) hold = last;
  }
  const lead = text.trimStart();
  const start = text.length - lead.length;
  if (wholeReplyMayBeCall(lead, tools)) hold = Math.min(hold, start);
  if (hold < 0) hold = text.length;
  return text.length - hold > MAX_HELD_CHARS ? text.length : hold;
}

function wholeReplyMayBeCall(lead: string, tools: readonly ToolShape[]): boolean {
  if (!lead) return true;
  if (lead.startsWith("`")) {
    const newline = lead.indexOf("\n");
    const fence = /^(`{1,3})([\w-]*)[^\S\n]*$/.exec(newline < 0 ? lead : lead.slice(0, newline));
    if (!fence) return false;
    if (fence[1].length < 3) return newline < 0;
    const language = fence[2].toLowerCase();
    if (newline < 0) return [...FENCE_LANGUAGES].some(known => known.startsWith(language));
    if (!FENCE_LANGUAGES.has(language)) return false;
    const inner = lead.slice(newline + 1).trimStart();
    return !inner || /^[{[<]/.test(inner) || nameMayStart(inner, tools);
  }
  return /^[{[]/.test(lead) || nameMayStart(lead, tools);
}

/** The reply starts, or may still start, with an offered tool's name followed by its arguments. */
function nameMayStart(text: string, tools: readonly ToolShape[]): boolean {
  const identifier = /^[A-Za-z_][\w.:-]*/.exec(text)?.[0];
  if (!identifier) return false;
  const codec = createToolNameCodec(tools);
  const names = tools.flatMap(tool => [tool.name, codec.encode(tool.name)]);
  if (identifier.length === text.length) {
    return [...names, "nmx_", "functions.", "default_api."].some(name => name.startsWith(identifier) || identifier.startsWith(name));
  }
  return /^\s*[({]/.test(text.slice(identifier.length)) && Boolean(toolResolver(tools)(identifier));
}
