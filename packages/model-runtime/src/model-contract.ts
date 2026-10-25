import { declaredModelTaskCategories, MODEL_TASK_CATEGORIES, type ModelTaskCategory } from './model-task-capabilities.js';

/** Model declarations are separate from what a transport happens to implement. */
export type ModelDeclarationSupport = "supported" | "unsupported" | "unknown";
export type ModelDeclarationSource = "provider_metadata" | "merchant_declaration" | "model_heuristic";
export type ModelDeclarationScope = "route" | "model" | "transport";
export interface ModelCapabilityDeclaration {
  readonly support: ModelDeclarationSupport;
  readonly source: ModelDeclarationSource;
  readonly scope: ModelDeclarationScope;
}
/** Song restyling and singing in a reference voice are distinct, declared capabilities. */
export const MUSIC_REFERENCE_CAPABILITIES = ["vocal_reference", "cover"] as const;
export type MusicReferenceCapability = typeof MUSIC_REFERENCE_CAPABILITIES[number];
export interface ModelReasoningControl extends ModelCapabilityDeclaration {
  readonly type: "effort" | "budget" | "on-off" | "adaptive";
  readonly parameter: string;
  readonly values?: readonly (string | boolean)[];
  readonly default?: string | boolean | number;
  readonly mandatory?: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly mapping?: Readonly<Record<string, string | boolean | number>>;
}
/** Verified model endpoint role; this does not prove that any relay implements the endpoint or supply a chat price. */
export interface ModelDecisionEndpointRole {
  readonly protocol: "openai_decisions";
  readonly endpoint: "/v1/decisions";
  readonly role: "decision";
  readonly canonicalModel: string;
  readonly upstreamModelId: string;
  readonly sourceUrl: string;
  readonly sourceHash: string;
  readonly source: "provider_metadata";
  readonly scope: "model";
  readonly tariffRole: "openai_decisions";
}
/** Only normalized official model-role facts are retained, independently of route transport claims. */
export function parseDecisionEndpointRoles(raw: unknown): readonly ModelDecisionEndpointRole[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 32).flatMap(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const item = value as Record<string, unknown>;
    if (item.protocol !== 'openai_decisions' || item.endpoint !== '/v1/decisions' || item.role !== 'decision'
      || item.source !== 'provider_metadata' || item.scope !== 'model' || item.tariffRole !== 'openai_decisions'
      || typeof item.upstreamModelId !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(item.upstreamModelId)
      || item.canonicalModel !== `openai/${item.upstreamModelId}` || typeof item.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(item.sourceHash)
      || item.sourceUrl !== 'https://developers.openai.com/api/docs/guides/decisions.md') return [];
    return [{ protocol: 'openai_decisions' as const, endpoint: '/v1/decisions' as const, role: 'decision' as const,
      canonicalModel: item.canonicalModel as string, upstreamModelId: item.upstreamModelId, sourceUrl: item.sourceUrl as string,
      sourceHash: item.sourceHash, source: 'provider_metadata' as const, scope: 'model' as const, tariffRole: 'openai_decisions' as const }];
  });
}
/** A separately documented endpoint tariff; ordinary chat price fields are never its authority. */
export interface ModelDecisionEndpointTariff extends ModelDecisionEndpointRole {
  readonly kind: "openai_decisions_input_only_v1";
  readonly currency: "USD";
  readonly rates: Readonly<Record<"input_token" | "output_token" | "cached_input_token" | "cache_write_token", { readonly unitSize: number; readonly amountMicros: number }>>;
  readonly requiredDimensions: readonly ["input_token"];
  readonly documentedPremiums: readonly ["regional_processing", "long_context"];
  readonly applicability: { readonly regionalProcessing: false; readonly maximumPlatformInputTokens: 32768 };
  readonly pricingStatement: string;
}
export function parseDecisionEndpointTariff(value: unknown): ModelDecisionEndpointTariff | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, any>, role = parseDecisionEndpointRoles([item])[0];
  if (!role || item.kind !== 'openai_decisions_input_only_v1' || item.currency !== 'USD'
    || JSON.stringify(item.requiredDimensions) !== '["input_token"]'
    || JSON.stringify(item.documentedPremiums) !== '["regional_processing","long_context"]'
    || item.applicability?.regionalProcessing !== false || item.applicability?.maximumPlatformInputTokens !== 32768
    || typeof item.pricingStatement !== 'string' || item.pricingStatement.length > 1024) return undefined;
  const keys = ['input_token', 'output_token', 'cached_input_token', 'cache_write_token'] as const;
  if (!item.rates || Object.keys(item.rates).length !== keys.length || keys.some(key => item.rates[key]?.unitSize !== 1000000
    || !Number.isSafeInteger(item.rates[key]?.amountMicros) || (key === 'input_token' ? item.rates[key].amountMicros <= 0 : item.rates[key].amountMicros !== 0))) return undefined;
  return { ...role, kind: 'openai_decisions_input_only_v1', currency: 'USD',
    rates: Object.fromEntries(keys.map(key => [key, { unitSize: 1000000, amountMicros: item.rates[key].amountMicros }])) as ModelDecisionEndpointTariff['rates'],
    requiredDimensions: ['input_token'], documentedPremiums: ['regional_processing', 'long_context'],
    applicability: { regionalProcessing: false, maximumPlatformInputTokens: 32768 }, pricingStatement: item.pricingStatement };
}
/** Explicit per-API endpoint fact; execution additionally requires a matching official model role. */
export interface ModelDecisionEndpointSupport {
  readonly protocol: "openai_decisions";
  readonly endpoint: "/v1/decisions";
  readonly support: "supported";
  readonly scope: "route";
  readonly source: "provider_metadata";
}
export function parseDecisionEndpointSupport(value: unknown): ModelDecisionEndpointSupport | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  return item.protocol === 'openai_decisions' && item.endpoint === '/v1/decisions' && item.support === 'supported'
    && item.scope === 'route' && item.source === 'provider_metadata'
    ? { protocol: 'openai_decisions', endpoint: '/v1/decisions', support: 'supported', scope: 'route', source: 'provider_metadata' } : undefined;
}
export interface ModelContract {
  /** Discovery/display membership only. This does not grant execution or upload permission. */
  readonly taskCategories?: readonly string[];
  readonly decisionEndpointRoles?: readonly ModelDecisionEndpointRole[];
  readonly decisionEndpointTariff?: ModelDecisionEndpointTariff;
  readonly decisionEndpointSupport?: ModelDecisionEndpointSupport;
  readonly reasoningControls?: readonly ModelReasoningControl[];
  readonly capabilityDeclarations?: Readonly<Record<string, ModelCapabilityDeclaration>>;
  readonly modalityLimits?: Readonly<Record<string, Readonly<Record<string, number>>>>;
}
/** Never turn a model name, a transport feature, or a heuristic into permission to upload audio. */
export function modelSupportsMusicReference(model: (ModelContract & {
  readonly routeCapabilityDeclarations?: ModelContract["capabilityDeclarations"];
  readonly modelCapabilityDeclarations?: ModelContract["capabilityDeclarations"];
}) | undefined, capability: MusicReferenceCapability): boolean {
  if (!model) return false;
  const claims = [model.routeCapabilityDeclarations?.[capability], model.capabilityDeclarations?.[capability], model.modelCapabilityDeclarations?.[capability]];
  if (claims.some(claim => claim?.scope !== "transport" && claim?.support === "unsupported")) return false;
  const claim = claims.find(value => value !== undefined && value.scope !== "transport");
  return claim?.support === "supported" && (claim.source === "provider_metadata" || claim.source === "merchant_declaration");
}
export const MODEL_REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** User-selectable answer style. "normal" is the default and sends no custom sampling parameter. */
export type ModelCreativityMode = "normal" | "rigorous" | "creative";
export const MODEL_CREATIVITY_MODES = ["normal", "rigorous", "creative"] as const;
/** Resolved temperature per non-default mode; "normal" deliberately resolves to undefined. */
export const CREATIVITY_MODE_TEMPERATURES: Readonly<Record<"rigorous" | "creative", number>> = { rigorous: 0.1, creative: 0.85 };
/**
 * Temperature for a creativity mode. "normal" (and an unset mode) resolves to
 * undefined: the model keeps its own default and no parameter is sent.
 */
export function resolveCreativityTemperature(mode: ModelCreativityMode | undefined): number | undefined {
  return mode === "rigorous" ? CREATIVITY_MODE_TEMPERATURES.rigorous
    : mode === "creative" ? CREATIVITY_MODE_TEMPERATURES.creative
      : undefined;
}

/** Sampling parameters reasoning models reject outright or ignore (OpenAI o-series/GPT-5+, DeepSeek reasoner, Claude thinking). */
const SAMPLING_PARAMETERS = ["temperature", "top_p", "top_k", "presence_penalty", "frequency_penalty", "logprobs", "top_logprobs"] as const;

export interface ReasoningModelSamplingOptions {
  readonly model: string;
  readonly providerId?: string;
  readonly protocol?: string;
  readonly reasoningEnabled?: boolean;
  readonly reasoningMode?: string;
  /** Official OpenAI/Azure reasoning endpoints require max_completion_tokens; relays keep max_tokens. */
  readonly requiresMaxCompletionTokens?: boolean;
}

/**
 * True when the target model is an OpenAI o1/o3/o4/gpt-5 reasoning model, a
 * DeepSeek reasoner/R1, or an Anthropic Claude with thinking enabled: all of them
 * reject custom sampling parameters (temperature/top_p/top_k/penalties).
 */
export function isReasoningModelWithoutSamplingParameters(options: ReasoningModelSamplingOptions): boolean {
  const model = options.model || "";
  if (COMPLETION_TOKEN_MODELS.test(model)) return true;
  if (/deepseek-(?:reasoner|r1)|(?:^|\/)r1(?:-|$)/i.test(model)) return true;
  const claude = options.providerId === "anthropic" || options.protocol === "anthropic_messages" || /(?:^|\/)claude/i.test(model);
  return claude && (options.reasoningEnabled === true || options.reasoningMode === "enabled" || options.reasoningMode === "adaptive");
}

/**
 * Strips sampling parameters a reasoning model rejects, clamps Claude temperature to
 * [0, 1], and converts max_tokens to max_completion_tokens where the API requires it.
 * Mutates and returns the same body for wire-level use.
 */
export function guardReasoningModelSamplingParameters(body: Record<string, any>, options: ReasoningModelSamplingOptions): Record<string, any> {
  const model = options.model || "";
  const openaiReasoning = COMPLETION_TOKEN_MODELS.test(model);
  const claude = options.providerId === "anthropic" || options.protocol === "anthropic_messages" || /(?:^|\/)claude/i.test(model);
  if (isReasoningModelWithoutSamplingParameters(options)) {
    for (const parameter of SAMPLING_PARAMETERS) delete body[parameter];
  }
  if (claude && typeof body.temperature === "number" && Number.isFinite(body.temperature)) {
    body.temperature = Math.min(1, Math.max(0, body.temperature));
  }
  if (openaiReasoning && options.requiresMaxCompletionTokens === true
    && Object.hasOwn(body, "max_tokens") && !Object.hasOwn(body, "max_completion_tokens")) {
    body.max_completion_tokens = body.max_tokens;
    delete body.max_tokens;
  }
  return body;
}

const record = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const enumValues = (value: unknown): (string | boolean)[] => {
  const values = Array.isArray(value) ? value : record(value).values ?? record(value).enum ?? record(value).supported_values;
  return Array.isArray(values) ? [...new Set(values.filter((item): item is string | boolean => typeof item === "boolean" || typeof item === "string" && /^[\w-]{1,64}$/.test(item)))].slice(0, 32) : [];
};
const support = (value: unknown): ModelDeclarationSupport => value === true || record(value).supported === true || record(value).support === "supported" ? "supported"
  : value === false || record(value).supported === false || record(value).support === "unsupported" ? "unsupported" : "unknown";
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= -1 && value <= 1_000_000_000;
function protocolId(value: string): string {
  return ({openai: "openai_chat_completions", openrouter: "openai_chat_completions", anthropic: "anthropic_messages", gemini: "gemini_generate_content", cohere: "cohere_chat", responses: "openai_responses"} as Record<string, string>)[value] ?? value;
}

/** Bounded normalization for native directories and already-normalized saved contracts. */
export function parseModelContract(item: Record<string, unknown>, options: { protocol: string; scope: ModelDeclarationScope; source?: ModelDeclarationSource }): ModelContract {
  const provenance = { source: options.source ?? "provider_metadata", scope: options.scope };
  const capabilities = record(item.capabilities);
  const parameters = record(item.supported_parameters);
  const parameterNames = Array.isArray(item.supported_parameters) ? item.supported_parameters.map(value => typeof value === "string" ? value : record(value).name ?? record(value).parameter) : Object.keys(parameters);
  const declarations: Record<string, ModelCapabilityDeclaration> = {};
  const aliases: Record<string, string[]> = {
    tools: ["tools", "tool_call", "tool_calling", "function_calling"], reasoning: ["reasoning", "thinking"],
    "input:image": ["image_input", "vision"], "input:pdf": ["pdf_input"], "input:audio": ["audio_input"], "input:video": ["video_input"],
    structured_output: ["structured_output", "structured_outputs", "json_schema", "response_format"],
    streaming: ["streaming", "stream"], prompt_caching: ["prompt_caching", "prompt_cache", "cache_control"],
    web_search: ["web_search", "search"], parallel_tool_calls: ["parallel_tool_calls"],
    vocal_reference: ["vocal_reference", "vocalReference"], cover: ["cover", "music_cover"],
  };
  for (const [key, names] of Object.entries(aliases)) {
    const explicit = names.map(name => capabilities[name] ?? item[name]).find(value => support(value) !== "unknown");
    declarations[key] = { ...provenance, support: explicit !== undefined ? support(explicit)
      : names.some(name => parameterNames.includes(name) || Array.isArray(item.capabilities) && item.capabilities.includes(name)) ? "supported" : "unknown" };
  }
  // Some media directories expose feature lists rather than a capability object. Only
  // explicit feature identifiers count; neither model IDs nor generic audio inputs do.
  const mediaFeatures = [item.capabilities, item.supported_features, item.supportedFeatures, item.nextmux_capabilities]
    .flatMap(value => Array.isArray(value) ? value.slice(0, 64) : [])
    .filter((value): value is string => typeof value === "string")
    .map(value => value.replace(/-/g, "_").toLowerCase());
  for (const key of MUSIC_REFERENCE_CAPABILITIES) {
    if (declarations[key].support === "unknown" && aliases[key].some(name => mediaFeatures.includes(name.toLowerCase()))) declarations[key] = { ...provenance, support: "supported" };
  }
  const architecture = record(item.architecture);
  const modalities = record(item.modalities);
  const inputModalities = Array.isArray(architecture.input_modalities ?? item.input_modalities ?? modalities.input)
    ? architecture.input_modalities ?? item.input_modalities ?? modalities.input : [];
  for (const modality of ["image", "pdf", "audio", "video"]) {
    if (inputModalities.includes(modality) && declarations[`input:${modality}`].support === "unknown") declarations[`input:${modality}`] = { ...provenance, support: "supported" };
  }
  for (const [key, value] of Object.entries(record(item.capabilityDeclarations)).slice(0, 64)) {
    if (!/^[\w:-]{1,64}$/.test(key)) continue;
    const entry = record(value);
    declarations[key] = { ...provenance, support: support(entry),
      ...(["route", "model", "transport"].includes(entry.scope) ? { scope: entry.scope } : {}),
      ...(["provider_metadata", "merchant_declaration", "model_heuristic"].includes(entry.source) ? { source: entry.source } : {}) };
  }
  const controls: ModelReasoningControl[] = [];
  const add = (type: ModelReasoningControl["type"], parameter: string, raw: unknown, values = enumValues(raw)): void => {
    const value = record(raw);
    const status = support(raw);
    values = enumValues(values);
    const defaultValue = value.default ?? value.default_value ?? value.default_effort;
    const mapping = Object.fromEntries(Object.entries(record(value.mapping)).slice(0, 32).filter(([key, entry]) => /^[\w-]{1,64}$/.test(key)
      && (typeof entry === "boolean" || finite(entry) || typeof entry === "string" && /^[\w-]{1,64}$/.test(entry))));
    controls.push({ ...provenance, type, parameter, support: status === "unknown" && (values.length || type === "budget") ? "supported" : status,
      ...(values.length ? { values } : {}),
      ...(defaultValue !== undefined && (finite(defaultValue) || values.includes(defaultValue)) ? { default: defaultValue } : {}),
      ...(typeof value.mandatory === "boolean" ? { mandatory: value.mandatory } : {}),
      ...(finite(value.min ?? value.minimum ?? value.min_tokens) ? { min: value.min ?? value.minimum ?? value.min_tokens } : {}),
      ...(finite(value.max ?? value.maximum ?? value.max_tokens) ? { max: value.max ?? value.maximum ?? value.max_tokens } : {}),
      ...(Object.keys(mapping).length ? { mapping: mapping as ModelReasoningControl["mapping"] } : {}) });
  };
  const protocol = protocolId(options.protocol);
  const reasoning = record(item.reasoning);
  const hasOpenRouterReasoning = options.protocol === "openrouter" && item.reasoning !== undefined && item.reasoning !== null && typeof item.reasoning === "object";
  if (hasOpenRouterReasoning && declarations.reasoning.support === "unknown") declarations.reasoning = { ...provenance, support: "supported" };
  const nativeEffort = record(capabilities.effort);
  const directoryEffort = record(item.effort);
  const effortValues = [...new Set([
    ...enumValues(directoryEffort.supported_levels),
    ...enumValues(item.reasoningEfforts), ...enumValues(item.reasoning_efforts), ...enumValues(reasoning.supported_efforts), ...enumValues(nativeEffort.supported_efforts),
    ...enumValues(Array.isArray(item.reasoning_options) ? item.reasoning_options : record(item.reasoning_options).effort ?? record(item.reasoning_options).reasoning_effort),
    ...enumValues(parameters.reasoning_effort ?? parameters["reasoning.effort"]),
    ...Object.keys(nativeEffort).filter(key => !["supported", "default", "mandatory"].includes(key) && support(nativeEffort[key]) === "supported"),
    ...(Array.isArray(item.supported_parameters) ? item.supported_parameters.flatMap(value => ["reasoning_effort", "reasoning.effort"].includes(record(value).name ?? record(value).parameter) ? enumValues(value) : []) : []),
  ])];
  const effortParameter = protocol === "anthropic_messages" ? "output_config.effort" : protocol === "gemini_generate_content" ? "generationConfig.thinkingConfig.thinkingLevel"
    : protocol === "openai_responses" ? "reasoning.effort" : protocol === "cohere_chat" ? "thinking.token_budget" : "reasoning_effort";
  if (protocol !== "cohere_chat" && (effortValues.length || nativeEffort.supported !== undefined)) add("effort", effortParameter, { ...nativeEffort, default: nativeEffort.default ?? reasoning.default_effort ?? directoryEffort.default_level, mandatory: nativeEffort.mandatory ?? reasoning.mandatory }, effortValues);
  const thinking = record(capabilities.thinking);
  if (protocol === "anthropic_messages" && Object.keys(thinking).length) {
    const types = record(thinking.types);
    const values = ["adaptive", "enabled"].filter(key => support(types[key]) === "supported" || enumValues(thinking.types).includes(key));
    if (thinking.mandatory === false || support(types.disabled) === "supported") values.push("disabled");
    add(values.includes("adaptive") ? "adaptive" : "on-off", "thinking.type", thinking, values);
    if (values.includes("enabled")) add("budget", "thinking.budget_tokens", { supported: true, min: 1024, ...record(thinking.budget ?? thinking.budget_tokens) });
  }
  for (const [parameter, type] of Object.entries({
    "reasoning.max_tokens": "budget", "reasoning.exclude": "on-off", "reasoning.enabled": "on-off",
    enable_thinking: "on-off", thinking_budget: "budget", "thinking.type": "on-off",
    "thinking.budget_tokens": "budget", "thinking.token_budget": "budget",
    "generationConfig.thinkingConfig.thinkingBudget": "budget", "generationConfig.thinkingConfig.thinkingLevel": "effort",
  } as const)) {
    const raw = parameters[parameter] ?? record(item.reasoning_options)[parameter];
    if (raw !== undefined) add(type, parameter, raw);
    else if (parameterNames.includes(parameter)) add(type, parameter, { supported: true }, type === "on-off" ? parameter.endsWith(".type") ? ["enabled", "disabled"] : [true, false] : []);
  }
  // A normalized contract overrides parsed wire metadata for the same parameter.
  if (Array.isArray(item.reasoningControls)) for (const raw of item.reasoningControls.slice(0, 32)) {
    const entry = record(raw);
    if (!["effort", "budget", "on-off", "adaptive"].includes(entry.type) || typeof entry.parameter !== "string" || !/^[\w.]{1,100}$/.test(entry.parameter)) continue;
    const index = controls.findIndex(control => control.parameter === entry.parameter && control.type === entry.type);
    if (index >= 0) controls.splice(index, 1);
    add(entry.type, entry.parameter, entry);
    const last = controls.length - 1;
    controls[last] = { ...controls[last],
      ...(["route", "model", "transport"].includes(entry.scope) ? { scope: entry.scope } : {}),
      ...(["provider_metadata", "merchant_declaration", "model_heuristic"].includes(entry.source) ? { source: entry.source } : {}) };
  }
  if (options.protocol === "openrouter" && declarations.reasoning.support === "supported" && declarations.reasoning.source !== "model_heuristic" && declarations.reasoning.scope !== "transport") {
    // OpenRouter declares one normalized control across model families; it performs provider mapping.
    // https://openrouter.ai/docs/guides/best-practices/reasoning-tokens
    const mandatory = reasoning.mandatory === true;
    const gatewayEfforts = MODEL_REASONING_EFFORTS.filter(effort => !mandatory || effort !== "none");
    const unified: ModelReasoningControl[] = [
      { ...provenance, type: "effort", parameter: "reasoning.effort", support: !hasOpenRouterReasoning || reasoning.supported_efforts === null ? "supported" : "unsupported",
        values: gatewayEfforts, ...(mandatory ? { mandatory: true } : {}),
        ...(typeof reasoning.default_effort === "string" && gatewayEfforts.includes(reasoning.default_effort as typeof gatewayEfforts[number]) ? { default: reasoning.default_effort } : {}) },
      { ...provenance, type: "budget", parameter: "reasoning.max_tokens", support: !hasOpenRouterReasoning || reasoning.supports_max_tokens === true ? "supported" : "unsupported", min: 1 },
      { ...provenance, type: "on-off", parameter: "reasoning.exclude", support: "supported", values: [true, false] },
      { ...provenance, type: "on-off", parameter: "reasoning.enabled", support: "supported", values: mandatory ? [true] : [true, false],
        ...(typeof reasoning.default_enabled === "boolean" ? { default: reasoning.default_enabled } : {}), ...(mandatory ? { mandatory: true } : {}) },
    ];
    if (mandatory) for (let index = 0; index < controls.length; index += 1) {
      const control = controls[index];
      if (control.type === "effort") controls[index] = { ...control, mandatory: true, values: control.values?.filter(value => value !== "none") };
    }
    for (const control of unified) {
      if (control.type === "effort" && controls.some(entry => entry.type === "effort")) continue;
      if (!controls.some(entry => entry.parameter === control.parameter)) controls.push(control);
    }
  }
  if (controls.some(control => control.support === "supported" && control.source !== "model_heuristic" && control.scope !== "transport") && declarations.reasoning.support === "unknown") declarations.reasoning = { ...provenance, support: "supported" };
  const modalityLimits: Record<string, Record<string, number>> = {};
  for (const [modality, raw] of Object.entries(record(item.modalityLimits ?? item.modality_limits)).slice(0, 16)) {
    if (!/^[\w:-]{1,32}$/.test(modality)) continue;
    const values = Object.fromEntries(Object.entries(record(raw)).filter(([key, value]) => /^[\w]{1,64}$/.test(key) && finite(value) && value >= 0).slice(0, 32));
    if (Object.keys(values).length) modalityLimits[modality] = values;
  }
  const taskCategories = [...new Set([
    ...(Array.isArray(item.taskCategories) ? item.taskCategories.slice(0, 32).filter((value): value is ModelTaskCategory => typeof value === 'string' && MODEL_TASK_CATEGORIES.includes(value as ModelTaskCategory)) : []),
    ...declaredModelTaskCategories(item)
  ])];
  const decisionEndpointRoles = parseDecisionEndpointRoles(item.decisionEndpointRoles);
  const decisionEndpointTariff = parseDecisionEndpointTariff(item.decisionEndpointTariff);
  const normalizedEndpointSupport = parseDecisionEndpointSupport(item.decisionEndpointSupport);
  const explicitEndpoints = Array.isArray(item.supported_endpoints) ? item.supported_endpoints.slice(0, 64) : [];
  const openaiProtocol = ['openai', 'openai_chat_completions', 'openai_responses', 'openrouter'].includes(options.protocol || '');
  const decisionEndpointSupport = options.scope === 'route' && openaiProtocol
    ? normalizedEndpointSupport || (explicitEndpoints.some(value => value === '/v1/decisions' || value === 'decisions')
      ? { protocol: 'openai_decisions' as const, endpoint: '/v1/decisions' as const, support: 'supported' as const, scope: 'route' as const, source: 'provider_metadata' as const } : undefined)
    : undefined;
  return { capabilityDeclarations: declarations, ...(decisionEndpointSupport ? { decisionEndpointSupport } : {}), ...(decisionEndpointRoles.length ? { decisionEndpointRoles } : {}), ...(decisionEndpointTariff && decisionEndpointRoles.some(role => role.canonicalModel === decisionEndpointTariff.canonicalModel && role.sourceHash === decisionEndpointTariff.sourceHash) ? { decisionEndpointTariff } : {}), ...(taskCategories.length ? { taskCategories } : {}), ...(controls.length ? { reasoningControls: controls } : {}), ...(Object.keys(modalityLimits).length ? { modalityLimits } : {}) };
}

export interface ModelRequestContractOptions extends ModelContract {
  readonly protocol: string;
  readonly providerId?: string;
  readonly baseUrl: string;
  readonly model: string;
}
export interface ModelReasoningRequest {
  readonly reasoningEffort?: string;
  readonly reasoningBudgetTokens?: number;
  readonly reasoningEnabled?: boolean;
  readonly reasoningMode?: "adaptive" | "enabled" | "disabled";
  readonly reasoningExclude?: boolean;
  readonly maxOutputTokens?: number;
  /** User-selected answer style; "normal" (the default) sends no custom temperature. */
  readonly creativityMode?: ModelCreativityMode;
}
function setPath(body: Record<string, any>, path: string, value: unknown): void {
  const parts = path.split(".");
  let target = body;
  for (const key of parts.slice(0, -1)) { target[key] = record(target[key]); target = target[key]; }
  target[parts.at(-1)!] = value;
}
/** The one final wire mapping used by native adapters, SDK adapters and the gateway. */
export function applyModelRequestContract(body: Record<string, any>, options: ModelRequestContractOptions, request: ModelReasoningRequest): Record<string, any> {
  const protocol = options.providerId === "bedrock" ? "bedrock_converse" : protocolId(options.protocol);
  const endpoint = new URL(options.baseUrl);
  const openrouter = options.protocol === "openrouter" || options.providerId === "openrouter" || endpoint.hostname === "openrouter.ai" || endpoint.hostname.endsWith(".openrouter.ai");
  // Remove SDK model-name heuristics. Existing provider replay blocks are untouched.
  delete body.reasoning_effort; delete body.reasoning; delete body.thinking; delete body.enable_thinking; delete body.thinking_budget;
  if (body.output_config) delete body.output_config.effort;
  if (body.generationConfig) delete body.generationConfig.thinkingConfig;
  if (protocol === "bedrock_converse" && body.additionalModelRequestFields) delete body.additionalModelRequestFields.reasoningConfig;
  const allowed = protocol === "bedrock_converse" ? ["additionalModelRequestFields.reasoningConfig.maxReasoningEffort"]
    : protocol === "anthropic_messages" ? ["output_config.effort", "thinking.type", "thinking.budget_tokens"]
    : protocol === "gemini_generate_content" ? ["generationConfig.thinkingConfig.thinkingLevel", "generationConfig.thinkingConfig.thinkingBudget", "generationConfig.thinkingConfig.includeThoughts"]
    : protocol === "cohere_chat" ? ["thinking.type", "thinking.token_budget"]
    : protocol === "openai_responses" ? ["reasoning.effort", "reasoning.max_tokens", "reasoning.exclude"]
    : openrouter ? ["reasoning.effort", "reasoning.max_tokens", "reasoning.exclude", "reasoning.enabled"]
    : ["reasoning_effort", "enable_thinking", "thinking_budget", "thinking.type"];
  const explicitControls = options.reasoningControls ?? [];
  const unifiedControls = openrouter && options.capabilityDeclarations?.reasoning?.support === "supported"
    && options.capabilityDeclarations.reasoning.source !== "model_heuristic" && options.capabilityDeclarations.reasoning.scope !== "transport"
    ? parseModelContract({ capabilityDeclarations: options.capabilityDeclarations, reasoningControls: explicitControls }, { protocol: "openrouter", scope: "route" }).reasoningControls ?? []
    : explicitControls;
  for (const control of options.capabilityDeclarations?.reasoning?.support === "unsupported" ? [] : unifiedControls) {
    if (control.support !== "supported" || control.scope === "transport" || control.source === "model_heuristic") continue;
    const parameter = openrouter && ["reasoning_effort", "output_config.effort", "generationConfig.thinkingConfig.thinkingLevel"].includes(control.parameter) ? "reasoning.effort" : control.parameter;
    if (!allowed.includes(parameter)) continue;
    let value: unknown = control.type === "effort" ? request.reasoningEffort : control.type === "budget" ? request.reasoningBudgetTokens
      : parameter.endsWith("exclude") ? request.reasoningExclude : parameter.endsWith(".type") ? request.reasoningMode ?? request.reasoningEnabled : request.reasoningEnabled;
    if (value === undefined && request.reasoningEffort !== undefined && control.mapping) value = control.mapping[request.reasoningEffort];
    else if (value !== undefined && control.mapping && Object.hasOwn(control.mapping, String(value))) value = control.mapping[String(value)];
    if (value === undefined && (control.mandatory || request.reasoningEffort !== undefined || request.reasoningBudgetTokens !== undefined || request.reasoningEnabled !== undefined || request.reasoningMode !== undefined)) value = control.default;
    if (openrouter && parameter === "reasoning.enabled" && value === false && request.reasoningEnabled === undefined
      && (request.reasoningEffort !== undefined || request.reasoningBudgetTokens !== undefined)) value = undefined;
    // A provider's off-by-default effort must not undo an explicit enable action.
    if (control.type === "effort" && value === "none" && request.reasoningEffort === undefined && request.reasoningEnabled === true) value = undefined;
    if ((control.type === "adaptive" || control.type === "on-off") && parameter.endsWith(".type") && typeof value === "boolean") value = value ? control.values?.includes("adaptive") ? "adaptive" : "enabled" : "disabled";
    if (control.type === "budget" || ["thinking.token_budget", "thinking.budget_tokens", "reasoning.max_tokens", "thinking_budget", "generationConfig.thinkingConfig.thinkingBudget"].includes(parameter)) {
      if (!finite(value) || !Number.isSafeInteger(value)) continue;
      value = Math.max(control.min ?? (parameter.endsWith("thinkingBudget") ? -1 : 0), Math.min(control.max ?? Number.MAX_SAFE_INTEGER, value));
      if (request.maxOutputTokens !== undefined && ["thinking.budget_tokens", "reasoning.max_tokens", "thinking.token_budget"].includes(parameter)) value = Math.min(value as number, request.maxOutputTokens - 1);
      if ((value as number) < (control.min ?? (parameter.endsWith("thinkingBudget") ? -1 : 0))) continue;
    } else if (value === undefined || !control.values?.includes(value as string | boolean)) continue;
    if (control.mandatory && (value === false || value === "disabled" || value === "none")) {
      value = control.default;
      if (value === undefined || value === false || value === "disabled" || value === "none" || !control.values?.includes(value as string | boolean)) continue;
    }
    setPath(body, parameter, value);
  }
  if (protocol === "bedrock_converse" && body.additionalModelRequestFields?.reasoningConfig) body.additionalModelRequestFields.reasoningConfig.type = "enabled";
  if (openrouter && body.reasoning?.effort !== undefined && body.reasoning?.max_tokens !== undefined) delete body.reasoning.effort;
  if (openrouter && (body.reasoning?.enabled === false || body.reasoning?.effort === "none")) {
    delete body.reasoning.max_tokens;
    if (body.reasoning.enabled === false) delete body.reasoning.effort;
    else delete body.reasoning.enabled;
  }
  if (body.generationConfig?.thinkingConfig?.thinkingBudget !== undefined) delete body.generationConfig.thinkingConfig.thinkingLevel;
  if (body.thinking?.type === "disabled" || body.enable_thinking === false) {
    delete body.reasoning_effort; delete body.thinking_budget;
    if (body.thinking) delete body.thinking.token_budget;
  }
  if (protocol === "anthropic_messages") {
    if (body.thinking?.budget_tokens !== undefined && body.thinking.type === undefined) body.thinking.type = "enabled";
    if (body.thinking?.type === "adaptive" || body.thinking?.type === "disabled") delete body.thinking.budget_tokens;
    if (body.thinking?.type === "enabled" && body.thinking.budget_tokens === undefined) delete body.thinking;
    // The SDK may set max_tokens itself (a default, or a model cap) after the call's own limit was applied: the
    // budget must stay below the max_tokens actually sent, and at Anthropic's minimum, or thinking is left off
    // rather than sending a request the API rejects (audit B02-07).
    if (body.thinking?.type === "enabled" && Number.isSafeInteger(body.thinking.budget_tokens) && Number.isSafeInteger(body.max_tokens)) {
      body.thinking.budget_tokens = Math.min(body.thinking.budget_tokens, body.max_tokens - 1);
      if (body.thinking.budget_tokens < 1024) delete body.thinking;
    }
    if (body.thinking?.type === "enabled" || body.thinking?.type === "adaptive") {
      delete body.top_k;
      if (body.temperature !== undefined && body.temperature !== 1) delete body.temperature;
    }
  }
  if (protocol === "cohere_chat" && body.thinking?.token_budget !== undefined) body.thinking.type ??= "enabled";
  // Creativity mode: rigorous/creative resolve a fixed temperature; "normal" sends nothing
  // so the model keeps its own default. A reasoning model then strips it again below.
  const creativityTemperature = resolveCreativityTemperature(request.creativityMode);
  if (creativityTemperature !== undefined) {
    if (protocol === "gemini_generate_content") setPath(body, "generationConfig.temperature", creativityTemperature);
    else body.temperature = creativityTemperature;
  } else if (request.creativityMode === "normal" && body.temperature !== undefined) {
    delete body.temperature;
  }
  guardReasoningModelSamplingParameters(body, {
    model: options.model,
    providerId: options.providerId,
    protocol: options.protocol,
    reasoningEnabled: request.reasoningEnabled === true || body.thinking?.type === "enabled" || body.thinking?.type === "adaptive",
    reasoningMode: request.reasoningMode,
    requiresMaxCompletionTokens: protocol === "openai_chat_completions" && endpoint.protocol === "https:"
      && (!endpoint.port || endpoint.port === "443")
      && (endpoint.hostname === "api.openai.com"
        || options.providerId === "azure_openai"
        || /\.openai\.azure\.com$|\.cognitiveservices\.azure\.com$|\.services\.ai\.azure\.com$/i.test(endpoint.hostname)),
  });
  if (Array.isArray(body.tools) && body.tools.length === 0) {
    delete body.tools;
    delete body.tool_choice;
    delete body.parallel_tool_calls;
  }
  if (request.maxOutputTokens !== undefined && protocol === "openai_chat_completions") {
    const isOfficialOpenAiOrAzure = endpoint.protocol === "https:"
      && (!endpoint.port || endpoint.port === "443")
      && (endpoint.hostname === "api.openai.com"
        || options.providerId === "azure_openai"
        || /\.openai\.azure\.com$|\.cognitiveservices\.azure\.com$|\.services\.ai\.azure\.com$/i.test(endpoint.hostname));
    const officialReasoning = isOfficialOpenAiOrAzure && /^(?:o\d+(?:-|$)|gpt-(?:[5-9]|\d{2,})(?:[.-]|$)|codex)/i.test(options.model);
    const keepMaxCompletionTokens = Object.hasOwn(body, "max_completion_tokens") && !Object.hasOwn(body, "max_tokens") && isOfficialOpenAiOrAzure;
    delete body.max_tokens; delete body.max_completion_tokens;
    body[officialReasoning || keepMaxCompletionTokens ? "max_completion_tokens" : "max_tokens"] = request.maxOutputTokens;
  }
  if (protocol === "openai_chat_completions" && Array.isArray(body.messages)) {
    const isDeepSeek = options.providerId === "deepseek" || /deepseek/i.test(options.model);
    const isKimiThinking = /kimi-k2.*thinking|kimi-k2\.5/i.test(options.model)
      || (/kimi-k2/i.test(options.model) && body.thinking?.type === "enabled");
    const requiresReasoningOnToolCalls = isKimiThinking
      || /deepseek-reasoner|deepseek-r1|deepseek-v3\.2/i.test(options.model)
      || (isDeepSeek && body.thinking?.type === "enabled");
    if (requiresReasoningOnToolCalls) {
      let lastUserIndex = -1;
      for (let idx = body.messages.length - 1; idx >= 0; idx--) {
        if (body.messages[idx]?.role === "user") {
          lastUserIndex = idx;
          break;
        }
      }
      for (let idx = lastUserIndex + 1; idx < body.messages.length; idx++) {
        const msg = body.messages[idx];
        if (!msg || typeof msg !== "object" || msg.role !== "assistant") continue;
        if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0 && typeof msg.reasoning_content !== "string") {
          msg.reasoning_content = "";
        }
      }
    }
  }
  return body;
}

const COMPLETION_TOKEN_MODELS = /(?:^|\/)(?:gpt-(?:[5-9]|\d{2,})(?:[.-]|$)|o[1-9](?:\d*|-|$)|codex)/i;
const PARAMETER_REFUSAL = /unknown|unrecogni[sz]ed|unsupported|not (?:supported|permitted|allowed)|extra (?:inputs|fields)|invalid (?:parameter|field|argument)|additional propert|cannot find field|must be 1|only 1 is supported|must not be set|不支持|未知参数|无效参数/i;
const OPTIONAL_SELF_HEAL_FIELDS = [
  "parallel_tool_calls",
  "service_tier",
  "serviceTier",
  "inference_geo",
  "store",
  "metadata",
  "prompt_cache_key",
  "safety_identifier",
  "user",
  "top_k",
  "seed",
  "temperature",
  "top_p",
  "presence_penalty",
  "frequency_penalty",
  "logprobs",
  "top_logprobs",
  "logit_bias",
  "reasoning_effort",
  "stream_options",
  "tool_choice",
  "thinking",
  "reasoning",
] as const;
const OUTPUT_LIMIT_PATTERNS = [
  /range of max_(?:completion_|output_)?tokens should be \[\s*1\s*,\s*(\d{3,7})\s*\]/i,
  /max_(?:completion_|output_)?tokens:?\s*\d+\s*>\s*(\d{3,7}),?\s*which is the maximum allowed/i,
  /max_(?:completion_|output_)?tokens[^.\n]{0,60}?(?:must be|should be|is)\s*(?:less than or equal to|<=|at most|no (?:more|greater) than|not (?:more|greater) than)\s*(\d{3,7})/i,
  /(?:max_(?:completion_|output_)?tokens|maxOutputTokens)[^.\n]{0,80}?maximum(?: allowed)?(?: value)?(?: is| of|:)\s*(\d{3,7})/i,
];

function selfHealWirePayload(
  status: number,
  errorText: string,
  sentBody: Record<string, any>,
  options: ModelRequestContractOptions,
): Record<string, any> | undefined {
  if (status !== 400 && status !== 422) return undefined;
  const message = String(errorText || "").slice(0, 4096);
  const next = structuredClone(sentBody);
  let changed = false;

  for (const pattern of OUTPUT_LIMIT_PATTERNS) {
    const match = message.match(pattern);
    const limit = Number(match?.[1]);
    if (Number.isInteger(limit) && limit >= 256 && limit <= 1_000_000) {
      for (const key of ["max_tokens", "max_completion_tokens", "max_output_tokens"] as const) {
        if (typeof next[key] === "number" && next[key] > limit) {
          next[key] = limit;
          changed = true;
        }
      }
      if (typeof next.generationConfig?.maxOutputTokens === "number" && next.generationConfig.maxOutputTokens > limit) {
        next.generationConfig.maxOutputTokens = limit;
        changed = true;
      }
      break;
    }
  }

  if (/enable_thinking[^.\n]{0,80}?(?:must be set to false|non-streaming)/i.test(message) && next.enable_thinking !== false) {
    next.enable_thinking = false;
    changed = true;
  }

  if (PARAMETER_REFUSAL.test(message)) {
    if (Object.hasOwn(next, "max_tokens")
      && (/max_completion_tokens/i.test(message)
        || (/(?:^|[^A-Za-z0-9_])max_tokens(?:[^A-Za-z0-9_]|$)/i.test(message) && COMPLETION_TOKEN_MODELS.test(options.model)))) {
      next.max_completion_tokens = next.max_tokens;
      delete next.max_tokens;
      changed = true;
    } else if (Object.hasOwn(next, "max_completion_tokens")
      && /(?:^|[^A-Za-z0-9_])max_completion_tokens(?:[^A-Za-z0-9_]|$)/i.test(message)) {
      next.max_tokens = next.max_completion_tokens;
      delete next.max_completion_tokens;
      changed = true;
    }
    const refusedFields = OPTIONAL_SELF_HEAL_FIELDS.filter(field =>
      Object.hasOwn(next, field) && new RegExp(`(?:^|[^A-Za-z0-9_])${field}(?:[^A-Za-z0-9_]|$)`).test(message));
    if (refusedFields.length >= 1) {
      for (const field of refusedFields) {
        delete next[field];
      }
      changed = true;
    }
    if (Array.isArray(next.tools) && next.tools.length === 0) {
      delete next.tools;
      delete next.tool_choice;
      delete next.parallel_tool_calls;
      changed = true;
    }
  }

  return changed ? next : undefined;
}

/** SDK transports keep their response implementation while sharing the native request contract. */
export function modelContractFetch(fetchImpl: typeof fetch, options: ModelRequestContractOptions, request: ModelReasoningRequest): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof init?.body !== "string") return fetchImpl(input, init);
    let body: unknown;
    try { body = JSON.parse(init.body); } catch { return fetchImpl(input, init); }
    let currentBody = applyModelRequestContract(record(body), options, request);
    let response = await fetchImpl(input, { ...init, body: JSON.stringify(currentBody) });
    for (let step = 0; step < 2 && (response.status === 400 || response.status === 422) && !init.signal?.aborted; step++) {
      let errorText = "";
      try { errorText = await response.clone().text(); } catch { break; }
      const healed = selfHealWirePayload(response.status, errorText, currentBody, options);
      if (!healed) break;
      await response.body?.cancel().catch(() => undefined);
      currentBody = healed;
      response = await fetchImpl(input, { ...init, body: JSON.stringify(currentBody) });
    }
    return response;
  }) as typeof fetch;
}

export function isModelInputExplicitlyUnsupported(options: ModelContract, capability: string): boolean {
  return options.capabilityDeclarations?.[capability]?.support === "unsupported";
}

/** Explicit negative model input metadata wins over a transport's general media support. */
export function unsupportedDeclaredModelInput(
  options: ModelContract,
  messages: readonly { readonly role?: string; readonly attachments?: readonly { readonly kind: string; readonly mimeType?: string }[] }[],
): string | undefined {
  let lastUserIndex = -1;
  for (let idx = messages.length - 1; idx >= 0; idx--) {
    if (messages[idx]?.role === "user") {
      lastUserIndex = idx;
      break;
    }
  }
  const startIndex = Math.max(0, lastUserIndex);
  for (let index = startIndex; index < messages.length; index++) {
    const message = messages[index]!;
    for (const attachment of message.attachments ?? []) {
      const capability = attachment.kind === "image" || attachment.mimeType?.startsWith("image/") ? "input:image"
        : attachment.mimeType === "application/pdf" ? "input:pdf"
        : attachment.mimeType?.startsWith("audio/") ? "input:audio"
        : attachment.mimeType?.startsWith("video/") ? "input:video" : undefined;
      if (capability && isModelInputExplicitlyUnsupported(options, capability)) return capability;
    }
  }
  return undefined;
}
