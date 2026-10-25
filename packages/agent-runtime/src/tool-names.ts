import { createHash } from "node:crypto";

/**
 * Tool names on the wire. NextMux tools are namespaced with dots (tabs.open_app, workspace.apply_patch), which
 * OpenAI, Anthropic and most relays reject, so each tool gets a provider-safe alias. The alias is the readable name
 * with dots turned into underscores (tabs_open_app); a hash is added only when that would collide or break the
 * provider's rules. The instructions and tool descriptions sent with a request name tools by these same aliases
 * (rewriteToolReferences), so a model never has to guess that "tabs.open_app" in the prompt means another name.
 */
const MAX_PROVIDER_TOOL_NAME_LENGTH = 64;
const VALID_PROVIDER_TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;

function hashedAlias(name: string): string {
  const digest = createHash("sha256").update(name).digest("hex").slice(0, 12);
  const readable = name.normalize("NFKD").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "tool";
  const prefix = `nmx_${digest}_`;
  return `${prefix}${readable.slice(0, MAX_PROVIDER_TOOL_NAME_LENGTH - prefix.length)}`;
}

/** The readable provider-safe name for a tool, before collision handling. */
export function providerToolAlias(name: string): string {
  if (VALID_PROVIDER_TOOL_NAME.test(name)) return name;
  const readable = name.normalize("NFKD").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return VALID_PROVIDER_TOOL_NAME.test(readable) ? readable : hashedAlias(name);
}

export interface ToolNameCodec {
  readonly encode: (name: string) => string;
  readonly decode: (name: string) => string;
}

export function createToolNameCodec(tools: readonly { readonly name: string }[]): ToolNameCodec {
  const encoded = new Map<string, string>();
  const decoded = new Map<string, string>();
  const names = new Set(tools.map(tool => tool.name));
  for (const tool of tools) {
    let alias = providerToolAlias(tool.name);
    // Another tool already has this alias, or a tool is literally named like it: fall back to a hashed alias.
    const taken = decoded.get(alias);
    if ((taken && taken !== tool.name) || (alias !== tool.name && names.has(alias))) alias = hashedAlias(tool.name);
    if (decoded.has(alias) && decoded.get(alias) !== tool.name) {
      alias = `nmx_${createHash("sha256").update(`collision:${tool.name}`).digest("hex").slice(0, 20)}`;
    }
    encoded.set(tool.name, alias);
    decoded.set(alias, tool.name);
  }
  return {
    encode: name => encoded.get(name) ?? providerToolAlias(name),
    // A model that copies the dotted name from older text still reaches the tool.
    decode: name => decoded.get(name) ?? (names.has(name) ? name : decoded.get(providerToolAlias(name)) ?? name)
  };
}

/** Replace mentions of tool names in text sent to the model with the names the model can actually call. */
export function rewriteToolReferences(text: string, tools: readonly { readonly name: string }[], codec: ToolNameCodec = createToolNameCodec(tools)): string {
  const renamed = tools.map(tool => tool.name).filter(name => codec.encode(name) !== name).sort((a, b) => b.length - a.length);
  if (!renamed.length || !text) return text;
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?<![A-Za-z0-9_.])(${renamed.map(escape).join("|")})(?![A-Za-z0-9_])`, "g");
  return text.replace(pattern, name => codec.encode(name));
}
