import MiniSearch from "minisearch";
import type { AgentToolDescriptor } from "./types.js";

export const TOOL_SEARCH_NAME = "tool.search";
export const TOOL_SEARCH_DESCRIPTOR: AgentToolDescriptor = {
  name: TOOL_SEARCH_NAME,
  description: "Find tools that are not loaded yet (connected MCP tools and tool groups loaded on demand) by task, application, group name or exact tool name. Returns matching tool schemas; call the discovered tool directly next. Search before assuming an integration is unavailable. Empty query lists tools with pagination. Discovery never grants additional permissions.",
  inputSchema: { type: "object", properties: {
    query: { type: "string", maxLength: 300 },
    limit: { type: "integer", minimum: 1, maximum: 5 },
    offset: { type: "integer", minimum: 0 },
  }, required: ["query"], additionalProperties: false },
  requiredPermission: "read_only", source: "builtin", executionKind: "read", concurrencySafe: true,
};

// MiniSearch provides the ranking/index; Unicode segmentation keeps Chinese
// catalog descriptions searchable without another tokenizer or background task.
const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
function tokenize(text: string): string[] {
  return [...segmenter.segment(text.replace(/[._-]/g, " "))]
    .filter(part => part.isWordLike).map(part => part.segment.toLowerCase());
}

export class ToolSearchIndex {
  readonly #index: MiniSearch;
  readonly #tools: readonly AgentToolDescriptor[];
  constructor(tools: readonly AgentToolDescriptor[]) {
    this.#tools = tools;
    this.#index = new MiniSearch({ idField: "name", fields: ["name", "description", "parameters"], tokenize,
      searchOptions: { boost: { name: 3 }, prefix: true, combineWith: "AND" } });
    this.#index.addAll(tools.map(tool => ({ name: tool.name, description: tool.description,
      parameters: Object.keys((tool.inputSchema.properties ?? {}) as object).join(" ") })));
  }
  search(query: string, allowed: ReadonlySet<string>): readonly AgentToolDescriptor[] {
    if (!query.trim()) return this.#tools.filter(tool => allowed.has(tool.name));
    const names = this.#index.search(query, { filter: item => allowed.has(String(item.id)) }).map(item => String(item.id));
    const tools = new Map(this.#tools.map(tool => [tool.name, tool]));
    const exact = tools.get(query.trim());
    return [...(exact && allowed.has(exact.name) ? [exact] : []),
      ...names.filter(name => name !== exact?.name).map(name => tools.get(name)!)];
  }
}

export function discoveredToolNames(messages: readonly { role: string; content: string; toolCallId?: string;
  toolCalls?: readonly { id: string; name: string }[] }[]): Set<string> {
  const calls = new Set(messages.flatMap(message => (message.toolCalls ?? [])
    .filter(call => call.name === TOOL_SEARCH_NAME).map(call => call.id)));
  const names = new Set<string>();
  for (const message of messages) {
    if (message.role !== "tool" || !calls.has(message.toolCallId ?? "")) continue;
    try {
      const result = JSON.parse(message.content);
      if (result?.ok !== true || !Array.isArray(result.output?.tools)) continue;
      for (const tool of result.output.tools) if (typeof tool?.name === "string") {
        names.delete(tool.name);
        names.add(tool.name);
      }
    } catch { /* A truncated observation can be discovered again. */ }
  }
  return names;
}
