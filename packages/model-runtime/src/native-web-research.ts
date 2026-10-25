/**
 * Explicit native web protocol adapters. This module deliberately has no Node or
 * SDK imports: relays and local own-API callers use the same wire validation.
 * A protocol declaration is evidence supplied by a route owner, not a guess from
 * its label. A requested limit is not a billing bound unless providerEnforced.
 */
export const NATIVE_WEB_RESEARCH_PROFILES = [
  "openrouter_server_tools", "openai_responses", "anthropic_messages",
  "gemini_generate_content", "zhipu_chat",
] as const;
export type NativeWebResearchProfile = typeof NATIVE_WEB_RESEARCH_PROFILES[number];
export type NativeWebResearchSupport = "supported" | "unknown" | "unsupported";
export type NativeWebResearchDeclarationSource = "provider_metadata" | "merchant_declaration" | "manual_override" | "live_probe";
export type NativeWebResearchZhipuEngine = "search_std" | "search_pro" | "search_pro_jina" | "search_pro_sogou" | "search_pro_quark";

export interface NativeWebResearchDeclaration {
  version: 1;
  profile: NativeWebResearchProfile;
  search: NativeWebResearchSupport;
  fetch: NativeWebResearchSupport;
  source: NativeWebResearchDeclarationSource;
  /** Required for Zhipu: mainland and international services have different engines. */
  zhipuSearchEngine?: NativeWebResearchZhipuEngine;
}
export interface NativeWebResearchDomainFilters {
  allowedDomains?: string[];
  blockedDomains?: string[];
}
export interface NativeWebResearchSearchRequest extends NativeWebResearchDomainFilters {
  maxUses: number;
  maxResults?: number;
  maxCharacters?: number;
}
export interface NativeWebResearchFetchRequest extends NativeWebResearchDomainFilters {
  maxUses: number;
  maxContentTokens?: number;
  /** The caller must also put the URLs in the model input. */
  urls?: string[];
}
export type NativeWebResearchOpenRouterEngine = "auto" | "native" | "exa" | "firecrawl" | "parallel" | "perplexity";
export type NativeWebResearchOpenRouterMode = "instant" | "fast" | "auto" | "deep-lite" | "deep" | "deep-reasoning" | "turbo" | "basic" | "advanced";
export interface NativeWebResearchRequest {
  search?: NativeWebResearchSearchRequest;
  fetch?: NativeWebResearchFetchRequest;
  openRouter?: {
    engine?: NativeWebResearchOpenRouterEngine;
    mode?: NativeWebResearchOpenRouterMode;
    fetchEngine?: "openrouter" | "auto" | "native" | "exa";
  };
}
export interface NativeWebResearchLimit {
  maxUses: number;
  providerEnforced: boolean;
  evidence: "documented_max_uses" | "no_documented_hard_cap";
}
export interface NativeWebResearchWire {
  ok: true;
  profile: NativeWebResearchProfile;
  tools: Record<string, unknown>[];
  bodyFields: Record<string, unknown>;
  headers: Record<string, string>;
  limits: { search?: NativeWebResearchLimit; fetch?: NativeWebResearchLimit };
  warnings: string[];
}
export interface NativeWebResearchWireError {
  ok: false;
  code: "invalid_declaration" | "invalid_request" | "capability_unknown" | "capability_unsupported" | "unsupported_parameter";
  message: string;
}
export type NativeWebResearchWireResult = NativeWebResearchWire | NativeWebResearchWireError;
export interface NativeWebResearchCitation {
  url: string;
  title?: string;
  content?: string;
  startIndex?: number;
  endIndex?: number;
}
export interface NativeWebResearchCounterEvidence {
  status: "reported" | "observed" | "missing" | "invalid";
  count?: number;
  source?: string;
}
export interface NativeWebResearchEvidence {
  profile: NativeWebResearchProfile;
  text: string;
  citations: NativeWebResearchCitation[];
  queries: string[];
  observedFetchUrls: string[];
  searchRequests?: number;
  fetchRequests?: number;
  searchUsage: NativeWebResearchCounterEvidence;
  fetchUsage: NativeWebResearchCounterEvidence;
  /** Total provider-reported cost, not incremental web cost or a charge instruction. */
  costUsd?: string;
  invalidFields: string[];
  toolErrors: string[];
  /** False when the provider expressly reports a tool continuation or failure. */
  completed: boolean;
  searchSuggestionsHtml?: string;
}

export const NATIVE_WEB_RESEARCH_DOCUMENTATION: Readonly<Record<NativeWebResearchProfile, readonly string[]>> = {
  openrouter_server_tools: ["https://openrouter.ai/docs/guides/features/server-tools/web-search", "https://openrouter.ai/docs/guides/features/server-tools/web-fetch"],
  openai_responses: ["https://developers.openai.com/api/docs/guides/tools-web-search"],
  anthropic_messages: ["https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool", "https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool"],
  gemini_generate_content: ["https://ai.google.dev/gemini-api/docs/generate-content/google-search", "https://ai.google.dev/gemini-api/docs/generate-content/url-context"],
  zhipu_chat: ["https://docs.z.ai/api-reference/llm/chat-completion", "https://docs.bigmodel.cn/api-reference/模型-api/对话补全"],
};

type ObjectValue = Record<string, unknown>;
const own = (object: ObjectValue, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key);
const object = (value: unknown): ObjectValue | undefined => value !== null && typeof value === "object" && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) ? value as ObjectValue : undefined;
const keysOnly = (value: ObjectValue, keys: readonly string[]): boolean => Object.keys(value).every(key => keys.includes(key));
const enumValue = <T extends string>(value: unknown, values: readonly T[]): value is T => typeof value === "string" && values.includes(value as T);
const integer = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
const boundedText = (value: unknown, max: number): string | undefined => typeof value === "string" && value.length <= max && value.trim() ? value : undefined;
const supportValues = ["supported", "unknown", "unsupported"] as const;
const sourceValues = ["provider_metadata", "merchant_declaration", "manual_override", "live_probe"] as const;
const zhipuEngines = ["search_std", "search_pro", "search_pro_jina", "search_pro_sogou", "search_pro_quark"] as const;
const routerEngines = ["auto", "native", "exa", "firecrawl", "parallel", "perplexity"] as const;
const routerModes = ["instant", "fast", "auto", "deep-lite", "deep", "deep-reasoning", "turbo", "basic", "advanced"] as const;

/** Strict saved configuration whitelist. No displayName, vendor or hostname inference. */
export function normalizeNativeWebResearchDeclaration(raw: unknown): NativeWebResearchDeclaration | undefined {
  const value = object(raw);
  if (!value || !keysOnly(value, ["version", "profile", "search", "fetch", "source", "zhipuSearchEngine"])) return undefined;
  if (!["profile", "search", "fetch", "source"].every(key => own(value, key))) return undefined;
  if ((own(value, "version") && value.version !== 1) || !enumValue(value.profile, NATIVE_WEB_RESEARCH_PROFILES)
    || !enumValue(value.search, supportValues) || !enumValue(value.fetch, supportValues) || !enumValue(value.source, sourceValues)) return undefined;
  if (own(value, "zhipuSearchEngine") && (!enumValue(value.zhipuSearchEngine, zhipuEngines) || value.profile !== "zhipu_chat")) return undefined;
  return { version: 1, profile: value.profile, search: value.search, fetch: value.fetch, source: value.source,
    ...(value.zhipuSearchEngine ? { zhipuSearchEngine: value.zhipuSearchEngine as NativeWebResearchZhipuEngine } : {}) };
}

function domains(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 20) return undefined;
  const result: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || entry.length > 253 || entry !== entry.trim()) return undefined;
    const domain = entry.toLowerCase();
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain)) return undefined;
    if (!result.includes(domain)) result.push(domain);
  }
  return result;
}
function externalUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length > 4096 || raw !== raw.trim()) return undefined;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname) return undefined;
    return url.href;
  } catch { return undefined; }
}
function normalizedFilters(value: ObjectValue): NativeWebResearchDomainFilters | undefined {
  const filters: NativeWebResearchDomainFilters = {};
  for (const key of ["allowedDomains", "blockedDomains"] as const) {
    if (!own(value, key)) continue;
    const list = domains(value[key]);
    if (!list) return undefined;
    filters[key] = list;
  }
  return filters;
}
/** Invalid or unbounded requests are rejected, never silently widened or clamped. */
export function normalizeNativeWebResearchRequest(raw: unknown): NativeWebResearchRequest | undefined {
  const value = object(raw);
  if (!value || !keysOnly(value, ["search", "fetch", "openRouter"]) || (!own(value, "search") && !own(value, "fetch"))) return undefined;
  const result: NativeWebResearchRequest = {};
  if (own(value, "search")) {
    const search = object(value.search);
    if (!search || !keysOnly(search, ["maxUses", "maxResults", "maxCharacters", "allowedDomains", "blockedDomains"]) || !integer(search.maxUses, 1, 3)) return undefined;
    if (own(search, "maxResults") && !integer(search.maxResults, 1, 10)) return undefined;
    if (own(search, "maxCharacters") && !integer(search.maxCharacters, 1, 20000)) return undefined;
    const filters = normalizedFilters(search);
    if (!filters) return undefined;
    result.search = { maxUses: search.maxUses, ...filters,
      ...(own(search, "maxResults") ? { maxResults: search.maxResults as number } : {}),
      ...(own(search, "maxCharacters") ? { maxCharacters: search.maxCharacters as number } : {}) };
  }
  if (own(value, "fetch")) {
    const fetch = object(value.fetch);
    if (!fetch || !keysOnly(fetch, ["maxUses", "maxContentTokens", "urls", "allowedDomains", "blockedDomains"]) || !integer(fetch.maxUses, 1, 3)) return undefined;
    if (own(fetch, "maxContentTokens") && !integer(fetch.maxContentTokens, 1, 16384)) return undefined;
    const filters = normalizedFilters(fetch);
    if (!filters) return undefined;
    result.fetch = { maxUses: fetch.maxUses, ...filters,
      ...(own(fetch, "maxContentTokens") ? { maxContentTokens: fetch.maxContentTokens as number } : {}) };
    if (own(fetch, "urls")) {
      if (!Array.isArray(fetch.urls) || fetch.urls.length < 1 || fetch.urls.length > fetch.maxUses) return undefined;
      const urls = fetch.urls.map(externalUrl);
      if (urls.some(url => !url)) return undefined;
      result.fetch.urls = [...new Set(urls as string[])];
    }
  }
  if (own(value, "openRouter")) {
    const router = object(value.openRouter);
    if (!router || !keysOnly(router, ["engine", "mode", "fetchEngine"])) return undefined;
    if (own(router, "engine") && !enumValue(router.engine, routerEngines)) return undefined;
    if (own(router, "mode") && !enumValue(router.mode, routerModes)) return undefined;
    if (own(router, "fetchEngine") && !enumValue(router.fetchEngine, ["openrouter", "auto", "native", "exa"] as const)) return undefined;
    result.openRouter = { ...router } as NativeWebResearchRequest["openRouter"];
  }
  return result;
}

const wireError = (code: NativeWebResearchWireError["code"], message: string): NativeWebResearchWireError => ({ ok: false, code, message });
const limit = (maxUses: number, providerEnforced: boolean): NativeWebResearchLimit => ({ maxUses, providerEnforced,
  evidence: providerEnforced ? "documented_max_uses" : "no_documented_hard_cap" });
function filterParameters(filters: NativeWebResearchDomainFilters, blockedKey: string): ObjectValue {
  return { ...(filters.allowedDomains ? { allowed_domains: [...filters.allowedDomains] } : {}),
    ...(filters.blockedDomains ? { [blockedKey]: [...filters.blockedDomains] } : {}) };
}

export function buildNativeWebResearchWire(rawDeclaration: unknown, rawRequest: unknown): NativeWebResearchWireResult {
  const declaration = normalizeNativeWebResearchDeclaration(rawDeclaration);
  if (!declaration) return wireError("invalid_declaration", "A valid explicit native web protocol declaration is required.");
  const request = normalizeNativeWebResearchRequest(rawRequest);
  if (!request) return wireError("invalid_request", "Native web requests require maxUses between 1 and 3 and bounded optional parameters.");
  for (const capability of ["search", "fetch"] as const) {
    if (!request[capability]) continue;
    if (declaration[capability] !== "supported") return wireError(declaration[capability] === "unknown" ? "capability_unknown" : "capability_unsupported", `${capability} is ${declaration[capability]} for this declared route.`);
  }
  if (request.openRouter && declaration.profile !== "openrouter_server_tools") return wireError("unsupported_parameter", "OpenRouter settings require the OpenRouter server-tools profile.");
  const wire: NativeWebResearchWire = { ok: true, profile: declaration.profile, tools: [], bodyFields: {}, headers: {}, limits: {}, warnings: [] };
  const { search, fetch } = request;
  if (declaration.profile === "openrouter_server_tools") {
    if (search) {
      const engine = request.openRouter?.engine ?? "parallel";
      const mode = request.openRouter?.mode ?? (engine === "parallel" ? "basic" : undefined);
      const modes = engine === "exa" ? ["instant", "fast", "auto", "deep-lite", "deep", "deep-reasoning"] : engine === "parallel" ? ["turbo", "fast", "basic", "advanced"] : [];
      if (mode && !modes.includes(mode)) return wireError("unsupported_parameter", "The search mode is not documented for the selected engine.");
      if (search.allowedDomains && search.blockedDomains && engine !== "exa") return wireError("unsupported_parameter", "This engine requires mutually exclusive allow/block domain filters.");
      if (engine === "native" && (search.allowedDomains || search.blockedDomains)) return wireError("unsupported_parameter", "Native OpenRouter domain filters require endpoint-specific proof; this generic profile cannot guarantee them.");
      const providerEnforced = engine !== "auto" && engine !== "native";
      wire.tools.push({ type: "openrouter:web_search", parameters: {
        engine, ...(mode ? { mode } : {}), max_uses: search.maxUses,
        max_results: search.maxResults ?? 5, max_total_results: (search.maxResults ?? 5) * search.maxUses,
        ...(search.maxCharacters && engine !== "firecrawl" && providerEnforced ? { max_characters: search.maxCharacters } : {}),
        ...filterParameters(search, "excluded_domains"),
      } });
      wire.limits.search = limit(search.maxUses, providerEnforced);
      if (!providerEnforced) wire.warnings.push("Native/auto search can fall back to another engine and does not enforce maxUses for every provider.");
      if (search.maxCharacters && (!providerEnforced || engine === "firecrawl")) wire.warnings.push("This engine does not enforce the requested character cap.");
    }
    if (fetch) {
      const engine = request.openRouter?.fetchEngine ?? "openrouter";
      wire.tools.push({ type: "openrouter:web_fetch", parameters: { engine, max_uses: fetch.maxUses,
        ...(fetch.maxContentTokens ? { max_content_tokens: fetch.maxContentTokens } : {}), ...filterParameters(fetch, "blocked_domains") } });
      wire.limits.fetch = limit(fetch.maxUses, engine === "openrouter" || engine === "exa");
      if (!wire.limits.fetch.providerEnforced) wire.warnings.push("Native/auto fetch does not provide a verified cap for every provider.");
    }
    wire.bodyFields.max_tool_calls = (search?.maxUses ?? 0) + (fetch?.maxUses ?? 0);
  } else if (declaration.profile === "openai_responses") {
    if (fetch) return wireError("capability_unsupported", "OpenAI Responses web search has no separate web-fetch tool in this profile.");
    if (search) {
      const filters = filterParameters(search, "blocked_domains");
      wire.tools.push({ type: "web_search", ...(Object.keys(filters).length ? { filters } : {}) });
      wire.bodyFields.include = ["web_search_call.action.sources"];
      wire.limits.search = limit(search.maxUses, false);
      wire.warnings.push("This Responses profile has no documented universal hard search-call cap.");
    }
  } else if (declaration.profile === "anthropic_messages") {
    for (const options of [search, fetch]) if (options?.allowedDomains && options.blockedDomains) return wireError("unsupported_parameter", "Anthropic accepts allowedDomains or blockedDomains, not both.");
    if (search) {
      wire.tools.push({ type: "web_search_20250305", name: "web_search", max_uses: search.maxUses, ...filterParameters(search, "blocked_domains") });
      wire.limits.search = limit(search.maxUses, true);
    }
    if (fetch) {
      wire.tools.push({ type: "web_fetch_20250910", name: "web_fetch", max_uses: fetch.maxUses, citations: { enabled: true },
        ...(fetch.maxContentTokens ? { max_content_tokens: fetch.maxContentTokens } : {}), ...filterParameters(fetch, "blocked_domains") });
      wire.limits.fetch = limit(fetch.maxUses, true);
    }
  } else if (declaration.profile === "gemini_generate_content") {
    for (const options of [search, fetch]) if (options?.allowedDomains || options?.blockedDomains) return wireError("unsupported_parameter", "These generateContent tools do not document domain filters.");
    if (search) { wire.tools.push({ google_search: {} }); wire.limits.search = limit(search.maxUses, false); }
    if (fetch) { wire.tools.push({ url_context: {} }); wire.limits.fetch = limit(fetch.maxUses, false); }
    wire.warnings.push("generateContent grounding tools do not document a hard per-request search/fetch-call cap.");
  } else {
    if (fetch) return wireError("capability_unsupported", "The Zhipu chat search protocol has no separate fetch tool.");
    if (search) {
      const engine = declaration.zhipuSearchEngine;
      if (!engine) return wireError("invalid_declaration", "Zhipu requires an explicitly declared search engine.");
      if (search.blockedDomains || (search.allowedDomains && search.allowedDomains.length !== 1)) return wireError("unsupported_parameter", "Zhipu search accepts one allowed domain and no blocked-domain list.");
      if (engine === "search_pro_quark" && (search.maxResults || search.allowedDomains)) return wireError("unsupported_parameter", "The declared Quark engine does not support count or domain filtering.");
      if (engine === "search_pro_sogou" && search.maxResults && search.maxResults !== 10) return wireError("unsupported_parameter", "The declared Sogou engine requires a result count in multiples of ten.");
      wire.tools.push({ type: "web_search", web_search: { enable: true, search_engine: engine, search_result: true,
        ...(engine !== "search_pro_quark" ? { count: search.maxResults ?? (engine === "search_pro_sogou" ? 10 : 5) } : {}),
        ...(search.allowedDomains ? { search_domain_filter: search.allowedDomains[0] } : {}) } });
      wire.limits.search = limit(search.maxUses, false);
      wire.warnings.push("Zhipu count bounds results, not the number of paid search calls; no hard call cap is documented.");
    }
  }
  if (declaration.profile !== "openrouter_server_tools" && search && (search.maxResults || search.maxCharacters)) wire.warnings.push("Requested result/content caps are sent only where the selected protocol documents them.");
  if (declaration.profile === "gemini_generate_content" && fetch?.maxContentTokens) wire.warnings.push("URL context does not document a maxContentTokens wire option.");
  return wire;
}

/** Append native tools without replacing user function tools or mutating a body. */
export function applyNativeWebResearchWire<T extends Record<string, unknown>>(body: T, wire: NativeWebResearchWire): T & Record<string, unknown> {
  if (wire.ok !== true) throw new Error("A validated native web wire configuration is required.");
  if (own(body, "web_search_options") || (typeof body.model === "string" && /:online(?:$|:)/.test(body.model))
    || (Array.isArray(body.plugins) && body.plugins.some(plugin => object(plugin)?.id === "web"))) throw new Error("A legacy web-search surface is already enabled; mixing it with native tools can add unexpected calls or charges.");
  if (wire.profile === "openrouter_server_tools" && own(body, "stop_server_tools_when")) throw new Error("stop_server_tools_when overrides max_tool_calls and must be configured separately.");
  if (own(body, "tools") && !Array.isArray(body.tools)) throw new Error("The request tools field must be an array.");
  const existing = (body.tools ?? []) as unknown[];
  for (const tool of existing) {
    const entry = object(tool);
    if (!entry) throw new Error("Existing tool descriptors must be objects.");
    if ((typeof entry.type === "string" && /^(?:openrouter:web_(?:search|fetch)|web_search(?:_preview|_\d+)?|web_fetch_\d+)$/.test(entry.type))
      || own(entry, "google_search") || own(entry, "url_context") || wire.tools.some(native => (native.type && native.type === entry.type) || (native.name && native.name === entry.name)
      || (own(native, "google_search") && own(entry, "google_search")) || (own(native, "url_context") && own(entry, "url_context")))) throw new Error("A native web tool is already present; its controls must not be overwritten.");
  }
  const result: Record<string, unknown> = { ...body, ...wire.bodyFields, tools: [...existing, ...wire.tools.map(tool => structuredClone(tool))] };
  if (wire.bodyFields.include) {
    if (own(body, "include") && (!Array.isArray(body.include) || body.include.some(item => typeof item !== "string"))) throw new Error("The request include field must be a string array.");
    result.include = [...new Set([...(body.include as string[] | undefined ?? []), ...wire.bodyFields.include as string[]])];
  }
  if (own(wire.bodyFields, "max_tool_calls") && own(body, "max_tool_calls")) {
    if (!integer(body.max_tool_calls, 1, 30)) throw new Error("The existing max_tool_calls must be a positive bounded integer.");
    result.max_tool_calls = Math.min(body.max_tool_calls, wire.bodyFields.max_tool_calls as number);
  }
  return result as T & Record<string, unknown>;
}

function countEvidence(root: ObjectValue, key: "web_search_requests" | "web_fetch_requests", invalidFields: string[], openRouterDetails = false): NativeWebResearchCounterEvidence {
  const usage = object(root.usage);
  const descriptors = [
    { container: "server_tool_use", keys: [key] },
    { container: "serverToolUse", keys: [key] },
    // OpenRouter's current generated SDK uses this wire container; keep the
    // legacy guide/Anthropic field and reject contradictory provider evidence.
    ...(openRouterDetails && key === "web_search_requests" ? [
      { container: "server_tool_use_details", keys: [key] },
      { container: "serverToolUseDetails", keys: [key, "webSearchRequests"] },
    ] : []),
  ];
  const invalidContainer = usage && descriptors.find(({ container }) => own(usage, container) && !object(usage[container]));
  if ((own(root, "usage") && !usage) || invalidContainer) {
    const source = `usage.${invalidContainer?.container ?? "server_tool_use"}.${key}`;
    invalidFields.push(source); return { status: "invalid", source };
  }
  const values: Array<{ value: unknown; source: string }> = [];
  for (const { container, keys } of descriptors) {
    const entry = object(usage?.[container]);
    if (entry) for (const field of keys) if (own(entry, field)) values.push({ value: entry[field], source: `usage.${container}.${field}` });
  }
  if (!values.length) return { status: "missing" };
  if (values.some(({ value }) => !integer(value, 0, 1_000_000)) || new Set(values.map(({ value }) => value)).size !== 1) {
    invalidFields.push(...values.map(({ source }) => source));
    return { status: "invalid", source: values[0].source };
  }
  return { status: "reported", count: values[0].value as number, source: values[0].source };
}
function costEvidence(root: ObjectValue, invalidFields: string[]): string | undefined {
  const usage = object(root.usage);
  if (!usage || !own(usage, "cost")) return undefined;
  const value = usage.cost;
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" ? value : "";
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?(?:e-\d+)?$/.test(text) || text.length > 80 || Number(text) < 0 || !Number.isFinite(Number(text))) {
    invalidFields.push("usage.cost"); return undefined;
  }
  return text;
}

/** Parse provider evidence without treating absent counters or result counts as zero. */
export function parseNativeWebResearchEvidence(profile: NativeWebResearchProfile, payload: unknown): NativeWebResearchEvidence {
  const root = object(payload) ?? {};
  const result: NativeWebResearchEvidence = { profile, text: "", citations: [], queries: [], observedFetchUrls: [],
    searchUsage: { status: "missing" }, fetchUsage: { status: "missing" }, invalidFields: [], toolErrors: [], completed: true };
  const textParts: string[] = [];
  const addText = (raw: unknown): void => { const value = boundedText(raw, 1_000_000); if (value) textParts.push(value); };
  const addQuery = (raw: unknown): void => { const value = boundedText(raw, 4096); if (value && result.queries.length < 100 && !result.queries.includes(value)) result.queries.push(value); };
  const addFetch = (raw: unknown): void => { const value = externalUrl(raw); if (value && result.observedFetchUrls.length < 100 && !result.observedFetchUrls.includes(value)) result.observedFetchUrls.push(value); };
  const addCitation = (raw: unknown): void => {
    const entry = object(raw); if (!entry) return;
    const nested = object(entry.url_citation) ?? entry;
    const url = externalUrl(nested.url ?? nested.uri ?? nested.link); if (!url || result.citations.length >= 100) return;
    const title = boundedText(nested.title, 512), content = boundedText(nested.content ?? nested.cited_text, 4000);
    const start = nested.start_index ?? nested.startIndex, end = nested.end_index ?? nested.endIndex;
    const citation: NativeWebResearchCitation = { url, ...(title ? { title } : {}), ...(content ? { content } : {}) };
    if (integer(start, 0, 1_000_000) && integer(end, start, 1_000_000)) { citation.startIndex = start; citation.endIndex = end; }
    const previous = result.citations.find(existing => existing.url === url && existing.startIndex === citation.startIndex && existing.endIndex === citation.endIndex);
    if (previous) Object.assign(previous, citation); else result.citations.push(citation);
  };
  const addError = (raw: unknown): void => {
    const entry = object(raw);
    const error = entry?.error_code ?? entry?.code ?? raw;
    const code = boundedText(error, 256);
    if (code && result.toolErrors.length < 20 && !result.toolErrors.includes(code)) result.toolErrors.push(code);
  };
  const annotations = (raw: unknown): void => { if (Array.isArray(raw)) raw.forEach(addCitation); };
  const parseMessage = (message: ObjectValue): void => {
    if (typeof message.content === "string") addText(message.content);
    if (Array.isArray(message.content)) for (const item of message.content) { const entry = object(item); if (entry?.type === "text" || entry?.type === "output_text") { addText(entry.text); annotations(entry.annotations); annotations(entry.citations); } }
    annotations(message.annotations);
  };
  if (profile === "openrouter_server_tools" || profile === "zhipu_chat") {
    if (Array.isArray(root.choices)) for (const rawChoice of root.choices) {
      const choice = object(rawChoice); const message = object(choice?.message); if (message) parseMessage(message);
      if (choice?.finish_reason === "tool_calls" || choice?.finish_reason === "length" || choice?.finish_reason === "error") result.completed = false;
    }
    if (Array.isArray(root.web_search)) root.web_search.forEach(addCitation);
  }
  if (profile === "openai_responses" || profile === "openrouter_server_tools") {
    let searchCount = 0, fetchCount = 0, observedSearch = false, observedFetch = false;
    if (Array.isArray(root.output)) for (const rawItem of root.output) {
      const item = object(rawItem); if (!item) continue;
      if (item.type === "message") parseMessage(item);
      if (item.type === "web_search_call") {
        const action = object(item.action);
        if (item.status === "completed") {
          if (action?.type === "search") { searchCount++; observedSearch = true; }
          if (action?.type === "open_page" || action?.type === "find_in_page") { fetchCount++; observedFetch = true; addFetch(action.url); }
        } else result.completed = false;
        addQuery(action?.query); if (Array.isArray(action?.queries)) action.queries.forEach(addQuery);
        annotations(action?.sources);
      }
    }
    if (profile === "openai_responses") {
      if (observedSearch) result.searchUsage = { status: "observed", count: searchCount, source: "output.completed_web_search_call.search" };
      if (observedFetch) result.fetchUsage = { status: "observed", count: fetchCount, source: "output.completed_web_search_call.page_actions" };
      if (root.status && root.status !== "completed") result.completed = false;
    }
    // OpenRouter can expose the Responses envelope too; its partial status is
    // independent of whether an earlier web-search action already completed.
    if (profile === "openrouter_server_tools" && Array.isArray(root.output) && root.status && root.status !== "completed") result.completed = false;
  }
  if (profile === "anthropic_messages" && Array.isArray(root.content)) {
    for (const rawItem of root.content) {
      const item = object(rawItem); if (!item) continue;
      if (item.type === "text") { addText(item.text); annotations(item.citations); }
      if (item.type === "server_tool_use" && item.name === "web_search") addQuery(object(item.input)?.query);
      if (item.type === "server_tool_use" && item.name === "web_fetch") addFetch(object(item.input)?.url);
      if (item.type === "web_search_tool_result" || item.type === "web_fetch_tool_result") {
        const content = object(item.content);
        if (Array.isArray(item.content)) for (const rawEntry of item.content) { const entry = object(rawEntry); if (entry?.type === "web_search_result") addCitation(entry); else if (entry?.type === "web_search_tool_result_error") addError(entry); }
        if (content?.type === "web_fetch_result") { addCitation({ url: content.url, title: object(content.content)?.title }); addFetch(content.url); }
        if (content?.type === "web_fetch_tool_result_error" || content?.type === "web_search_tool_result_error") addError(content);
      }
    }
    if (root.stop_reason === "pause_turn" || root.stop_reason === "tool_use" || root.stop_reason === "max_tokens" || root.stop_reason === "refusal") result.completed = false;
  }
  if (profile === "gemini_generate_content" && Array.isArray(root.candidates)) {
    for (const rawCandidate of root.candidates) {
      const candidate = object(rawCandidate); if (!candidate) continue;
      const content = object(candidate.content); if (Array.isArray(content?.parts)) for (const rawPart of content.parts) { const part = object(rawPart); if (part && !part.thought) addText(part.text); }
      const metadata = object(candidate.groundingMetadata ?? candidate.grounding_metadata);
      const queries = metadata?.webSearchQueries ?? metadata?.web_search_queries; if (Array.isArray(queries)) queries.forEach(addQuery);
      const chunks = metadata?.groundingChunks ?? metadata?.grounding_chunks;
      if (Array.isArray(chunks)) for (const rawChunk of chunks) { const chunk = object(rawChunk); if (chunk?.web) addCitation(chunk.web); }
      const entryPoint = object(metadata?.searchEntryPoint ?? metadata?.search_entry_point);
      const html = boundedText(entryPoint?.renderedContent ?? entryPoint?.rendered_content, 65536); if (html) result.searchSuggestionsHtml = html;
      const context = object(candidate.urlContextMetadata ?? candidate.url_context_metadata);
      const urls = context?.urlMetadata ?? context?.url_metadata;
      if (Array.isArray(urls)) for (const rawUrl of urls) { const url = object(rawUrl); if (url?.urlRetrievalStatus === "URL_RETRIEVAL_STATUS_SUCCESS" || url?.url_retrieval_status === "URL_RETRIEVAL_STATUS_SUCCESS") addFetch(url.retrievedUrl ?? url.retrieved_url); }
      if (candidate.finishReason && candidate.finishReason !== "STOP") result.completed = false;
    }
  }
  if (profile === "openrouter_server_tools" || profile === "anthropic_messages") {
    result.searchUsage = countEvidence(root, "web_search_requests", result.invalidFields, profile === "openrouter_server_tools");
    result.fetchUsage = countEvidence(root, "web_fetch_requests", result.invalidFields, profile === "openrouter_server_tools");
  }
  result.costUsd = costEvidence(root, result.invalidFields);
  if (result.searchUsage.count !== undefined) result.searchRequests = result.searchUsage.count;
  if (result.fetchUsage.count !== undefined) result.fetchRequests = result.fetchUsage.count;
  if (root.error) { addError(object(root.error)?.code ?? "provider_error"); result.completed = false; }
  if (result.toolErrors.length) result.completed = false;
  result.text = textParts.join("\n").slice(0, 65536);
  return result;
}
