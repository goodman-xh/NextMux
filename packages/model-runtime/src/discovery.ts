import { MODEL_REASONING_EFFORTS, MUSIC_REFERENCE_CAPABILITIES, modelSupportsMusicReference, parseModelContract, type ModelContract, type MusicReferenceCapability } from "./model-contract.js";
import {
  boundedSecret,
  credentialSecrets,
  redactErrorSecrets,
  normalizeOfficialModelError,
  OfficialModelError,
  readLimitedJson,
  timeoutMs,
  validatedBaseUrl,
} from "./http.js";
import type { OfficialProviderId, OfficialProviderProtocol, OfficialProviderSettings, OfficialModelSelectionMode } from "./presets.js";
import { bedrockCatalogRequest, parseBedrockModelCatalog } from "./bedrock-discovery.js";
import type { AgentReasoningEffort } from "@nextmux/agent-runtime";
import { detectOllama, getOllamaModelMetadata, isOllamaCandidate, ollamaBaseUrl, ollamaContextLimit, ollamaJsonRequest, type OllamaModelCapability, type OllamaModelMetadata, type OllamaServerStatus } from "./ollama.js";
import { versionedBaseUrl } from "./endpoint-url.js";

export interface DiscoverOfficialModelsOptions {
  readonly providerId?: OfficialProviderId;
  readonly providerSettings?: OfficialProviderSettings;
  readonly protocol: OfficialProviderProtocol;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly allowInsecure?: boolean;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly fetchImpl?: typeof fetch;
}

export interface DiscoveredOfficialModel extends ModelContract {
  readonly id: string;
  readonly label: string;
  /** A provider-declared unavailable model must not be offered for a fresh generation. */
  readonly available?: boolean;
  /** Exact model voice IDs from the provider directory; preserve case for native voice names. */
  readonly voices?: readonly string[];
  /** Limits declared by this exact API route, not inferred from its display name. */
  readonly contextTokens?: number;
  readonly inputTokens?: number;
  readonly maximumOutputTokens?: number;
  /** Provider-declared USD token rates; missing prices remain unknown. */
  readonly inputPricePerMillion?: number;
  readonly outputPricePerMillion?: number;
  readonly cachedInputPricePerMillion?: number;
  readonly cacheWritePricePerMillion?: number;
  /** Native Ollama model ceiling, before the connection's user limit. */
  readonly maxContextTokens?: number;
  /** Provider-declared tool capability; false excludes the model from coding. */
  readonly toolsSupported?: boolean;
  readonly capabilities?: readonly (OllamaModelCapability | MusicReferenceCapability)[];
  readonly parameterSize?: string;
  readonly quantizationLevel?: string;
  readonly digest?: string;
  /** Explicit effort enum declared by this API; a reasoning flag alone is insufficient. */
  readonly reasoningEfforts?: readonly AgentReasoningEffort[];
  /** Input modalities advertised for this exact model by this API route. */
  readonly inputModalities?: readonly string[];
  /** Output modalities it advertises (text, image, video, speech, audio, transcription, embeddings…);
   *  the desktop classifies own-API models locally from these, never from a cloud catalogue. */
  readonly outputModalities?: readonly string[];
  /** Optional explicit MIME allowlist from compatible model directories. */
  readonly inputMimeTypes?: readonly string[];
  /** Catalog IDs may differ from the manually configured deployment name. */
  readonly selectionMode?: OfficialModelSelectionMode;
  /** Present only when the provider directory declares generation-interface support. */
  readonly interfaceSupport?: OfficialModelInterfaceSupport;
  readonly interfaceSupportSource?: OfficialModelInterfaceSupportSource;
}

export type OfficialModelInterfaceSupport = "supported" | "unsupported" | "unknown";
export type OfficialModelInterfaceSupportSource = "provider_metadata" | "models_endpoint";

export interface OfficialModelCatalogEntry extends DiscoveredOfficialModel {
  /** Whether provider metadata explicitly declares this generation interface. */
  readonly interfaceSupport: OfficialModelInterfaceSupport;
  /** A models endpoint alone proves catalog visibility, not generation support. */
  readonly interfaceSupportSource: OfficialModelInterfaceSupportSource;
}

export interface OfficialModelCatalog {
  readonly ollamaStatus?: OllamaServerStatus;
  /** Every bounded model shown by the provider's directory. */
  readonly catalogModels: readonly OfficialModelCatalogEntry[];
  /** Models explicitly declared to support the selected generation interface. */
  readonly interfaceSupportedModels: readonly OfficialModelCatalogEntry[];
  /** Models explicitly declared not to support the selected generation interface. */
  readonly interfaceUnsupportedModels: readonly OfficialModelCatalogEntry[];
  /** Listed models whose generation support still requires a live probe. */
  readonly interfaceUnverifiedModels: readonly OfficialModelCatalogEntry[];
}

const MAX_DISCOVERED_MODELS = 512;
// OpenRouter lists ~630 models once every output type (image, video, speech…) is included (2026-09).
const MAX_OPENROUTER_MODELS = 2_000;
const isOpenRouter = (url: URL): boolean => url.hostname === "openrouter.ai" || url.hostname.endsWith(".openrouter.ai");
const MAX_DISCOVERY_PAGES = 16;

function azureModelEndpoint(options: DiscoverOfficialModelsOptions): URL {
  const endpoint = validatedBaseUrl(options.baseUrl, false);
  // This slice uses the already configured resource only, never ARM, Entra
  // tenant discovery or another project's endpoint. Legacy/custom routing
  // remains manually configured rather than guessing its catalog contract.
  if (endpoint.port || ![".openai.azure.com", ".services.ai.azure.com"].some(suffix => endpoint.hostname.endsWith(suffix))
    || endpoint.pathname !== "/openai/v1/" || options.providerSettings?.useDeploymentBasedUrls === true
    || (options.providerSettings?.apiVersion !== undefined && options.providerSettings.apiVersion !== "v1")
    || !["openai_responses", "openai_chat_completions"].includes(options.protocol)) {
    throw new OfficialModelError("DISCOVERY_UNSUPPORTED", "This Azure endpoint does not support read-only discovery; keep a manual deployment name");
  }
  return new URL("models", endpoint);
}

function discoveryApiKey(options: DiscoverOfficialModelsOptions): string {
  if (isOllamaCandidate(options) && !options.apiKey.trim()) return "";
  if (options.providerId !== "azure_openai") return boundedSecret(options.apiKey);
  const source = options.providerSettings?.credentialSource || "api_key";
  // Never read a machine credential just because the submitted field is empty.
  const value = source === "environment" ? process.env.AZURE_API_KEY : options.apiKey;
  if (source === "none" || typeof value !== "string" || !value.trim()) {
    throw new OfficialModelError("DISCOVERY_CREDENTIALS_MISSING", "The selected Azure credential source is missing; manual deployment configuration is still available");
  }
  return boundedSecret(value);
}

function modelEndpoint(baseUrl: string, protocol: OfficialProviderProtocol, allowInsecure: boolean): URL {
  const base = validatedBaseUrl(baseUrl, allowInsecure);
  base.pathname = `${base.pathname.replace(/\/+$/, "").replace(/\/(?:chat\/completions|responses|messages|models)$/i, "")}/`;
  const endpoint = new URL("models", base);
  if (protocol === "gemini_generate_content") endpoint.searchParams.set("pageSize", String(MAX_DISCOVERED_MODELS));
  if (protocol === "anthropic_messages") endpoint.searchParams.set("limit", String(MAX_DISCOVERED_MODELS));
  // OpenRouter lists only text models unless asked for every output (image, video, speech, …).
  if (isOpenRouter(endpoint)) endpoint.searchParams.set("output_modalities", "all");
  return endpoint;
}

function modelHeaders(protocol: OfficialProviderProtocol, apiKey: string): Record<string, string> {
  if (protocol === "anthropic_messages") {
    return { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
  }
  if (protocol === "gemini_generate_content") return { "x-goog-api-key": apiKey };
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}

function boundedModelId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const id = value.trim().replace(/^models\//i, "");
  return id && id.length <= 200 && !/[\r\n\0]/.test(id) ? id : undefined;
}

function interfaceSupport(item: Record<string, unknown>, protocol: OfficialProviderProtocol, contractProtocol: string = protocol): {
  readonly support: OfficialModelInterfaceSupport;
  readonly source: OfficialModelInterfaceSupportSource;
} {
  // OpenRouter lists batch-only variants ("anthropic/claude-opus-5:batch") that its chat/completions
  // endpoint rejects with 404; offering them would only produce failing requests.
  if (contractProtocol === "openrouter" && typeof item.id === "string" && /:batch$/i.test(item.id)) {
    return { support: "unsupported", source: "provider_metadata" };
  }
  if (protocol === "gemini_generate_content" && Array.isArray(item.supportedGenerationMethods)) {
    return {
      support: item.supportedGenerationMethods.includes("generateContent") ? "supported" : "unsupported",
      source: "provider_metadata",
    };
  }
  return { support: "unknown", source: "models_endpoint" };
}

/** Preserve provider-declared ceilings; Gemini input/output are separate limits. */
export function discoveredModelLimits(item: Record<string, unknown>): Pick<DiscoveredOfficialModel, 'contextTokens' | 'inputTokens' | 'maximumOutputTokens'> {
  const top = item.top_provider && typeof item.top_provider === 'object' ? item.top_provider as Record<string, unknown> : {};
  const declaredLimits = item.limit ?? item.limits;
  const limits = declaredLimits && typeof declaredLimits === 'object' ? declaredLimits as Record<string, unknown> : {};
  const arch = item.architecture && typeof item.architecture === 'object' ? item.architecture as Record<string, unknown> : {};
  const modelInfo = item.model_info && typeof item.model_info === 'object' ? item.model_info as Record<string, unknown> : {};
  const parseTokenNumber = (value: unknown, allowString = false, min = 1): number | undefined => {
    if (typeof value === 'number') {
      return Number.isSafeInteger(value) && value >= min && value <= 100_000_000 ? value : undefined;
    }
    if (allowString && typeof value === 'string') {
      const trimmed = value.trim().replace(/,/g, '');
      const match = /^(\d+(?:\.\d+)?)\s*([km])?$/i.exec(trimmed);
      if (!match) return undefined;
      const base = Number(match[1]);
      if (!Number.isFinite(base) || base <= 0) return undefined;
      const suffix = match[2]?.toLowerCase();
      const mult = suffix === 'm' ? 1_000_000 : suffix === 'k' ? 1_000 : 1;
      const num = Math.round(base * mult);
      return Number.isSafeInteger(num) && num >= min && num <= 100_000_000 ? num : undefined;
    }
    return undefined;
  };
  const minimum = (allowString: boolean, min: number, ...values: unknown[]): number | undefined => {
    const valid = values.map(v => parseTokenNumber(v, allowString, min)).filter((value): value is number => value !== undefined);
    return valid.length ? Math.min(...valid) : undefined;
  };
  // A route-declared context window is a numeric ceiling; a string value in a
  // compatible directory is not a declared limit (test/discovery.test.mts).
  const contextTokens = minimum(
    false,
    1024,
    item.context_length,
    item.context_window,
    item.context_window_size,
    item.context_tokens,
    item.contextTokens,
    item.max_model_len,
    item.n_ctx,
    item.max_context_length,
    item.max_context_tokens,
    item.max_sequence_length,
    item.max_seq_len,
    item.num_ctx,
    item.contextLength,
    item.contextWindow,
    limits.context,
    limits.context_window,
    limits.context_length,
    limits.context_tokens,
    limits.max_context_tokens,
    top.context_length,
    top.context_window,
    top.context_tokens,
    arch.context_length,
    arch.context_window,
    modelInfo.max_input_tokens,
    modelInfo.context_window,
  );
  const inputTokens = minimum(
    false,
    1,
    item.inputTokenLimit,
    item.input_token_limit,
    item.max_input_tokens,
    item.input_tokens,
    item.inputTokens,
    limits.input,
    limits.input_tokens,
    limits.max_input_tokens,
    top.max_input_tokens,
    top.input_tokens,
  );
  const maximumOutputTokens = minimum(
    false,
    1,
    item.outputTokenLimit,
    item.output_token_limit,
    item.max_output_tokens,
    item.max_completion_tokens,
    item.max_tokens,
    item.output_tokens,
    item.maximumOutputTokens,
    limits.output,
    limits.output_tokens,
    limits.max_output_tokens,
    limits.max_completion_tokens,
    top.max_completion_tokens,
    top.max_output_tokens,
    top.output_tokens,
    modelInfo.max_output_tokens,
  );
  return { ...(contextTokens ? { contextTokens } : {}), ...(inputTokens ? { inputTokens } : {}), ...(maximumOutputTokens ? { maximumOutputTokens } : {}) };
}

/** Only retain advertised enum values; never derive effort levels from a model name. */
export function discoveredModelReasoningEfforts(item: Record<string, unknown>): readonly AgentReasoningEffort[] | undefined {
  const controls = parseModelContract(item, { protocol: "openai_chat_completions", scope: "route" }).reasoningControls;
  const declared = controls?.filter(control => control.type === "effort" && control.support === "supported").flatMap(control => control.values ?? []) ?? [];
  const efforts = MODEL_REASONING_EFFORTS.filter(value => declared.includes(value));
  if (efforts.length) return efforts;
  const reasoning = item.reasoning && typeof item.reasoning === "object" && !Array.isArray(item.reasoning) ? item.reasoning as Record<string, unknown> : {};
  const thinking = item.thinking && typeof item.thinking === "object" && !Array.isArray(item.thinking) ? item.thinking as Record<string, unknown> : {};
  const capabilities = item.capabilities && typeof item.capabilities === "object" && !Array.isArray(item.capabilities) ? item.capabilities as Record<string, unknown> : {};
  const capReasoning = capabilities.reasoning && typeof capabilities.reasoning === "object" && !Array.isArray(capabilities.reasoning) ? capabilities.reasoning as Record<string, unknown> : {};
  const rawList = [
    item.supported_reasoning_efforts,
    item.reasoning_levels,
    item.thinking_efforts,
    item.thinking_levels,
    reasoning.efforts,
    reasoning.levels,
    thinking.efforts,
    thinking.supported_efforts,
    thinking.levels,
    capReasoning.efforts,
    capReasoning.supported_efforts,
  ].find(Array.isArray);
  if (Array.isArray(rawList)) {
    const matched = MODEL_REASONING_EFFORTS.filter(value => rawList.includes(value));
    if (matched.length) return matched;
  }
  // A bare reasoning/thinking flag is not an advertised effort enum; only
  // explicitly declared enum values are retained (test/discovery.test.mts).
  return undefined;
}

function discoveredTokenPrices(item: Record<string, unknown>): Partial<DiscoveredOfficialModel> {
  const pricing = item.pricing && typeof item.pricing === 'object' && !Array.isArray(item.pricing) ? item.pricing as Record<string, unknown> : {};
  if (pricing.currency !== undefined && pricing.currency !== 'USD') return {};
  // OpenRouter-compatible directories declare USD per token (including cache rates).
  // Do not present incomplete totals when a separate request/image charge is advertised.
  if (Object.entries(pricing).some(([key, value]) => !['prompt', 'completion', 'input_cache_read', 'input_cache_write', 'currency'].includes(key) && Number(value) > 0)) return {};
  return Object.fromEntries([['prompt', 'inputPricePerMillion'], ['completion', 'outputPricePerMillion'],
    ['input_cache_read', 'cachedInputPricePerMillion'], ['input_cache_write', 'cacheWritePricePerMillion']].flatMap(([source, target]) => {
      const raw = pricing[source];
      if (typeof raw !== 'number' && (typeof raw !== 'string' || !raw.trim())) return [];
      const value = Number(raw) * 1_000_000;
      return Number.isFinite(value) && value >= 0 ? [[target, value]] : [];
    }));
}

function parseModelPage(payload: any, protocol: OfficialProviderProtocol, cap = MAX_DISCOVERED_MODELS, contractProtocol: string = protocol): readonly OfficialModelCatalogEntry[] {
  const values: unknown[] = Array.isArray(payload) ? payload
    : Array.isArray(payload?.data) ? payload.data
    : Array.isArray(payload?.models) ? payload.models
    : Array.isArray(payload?.result) ? payload.result : [];
  const models = new Map<string, OfficialModelCatalogEntry>();
  for (const raw of values.slice(0, cap * 2)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const id = boundedModelId(protocol === "cohere_chat" ? item.name : item.id ?? item.name);
    if (!id) continue;
    // OpenRouter keeps the readable name ("OpenAI: GPT-5.6 Terra") in `name`; its `id` is the slug.
    const display = typeof item.display_name === "string" ? item.display_name
      : typeof item.displayName === "string" ? item.displayName
        : contractProtocol === "openrouter" && typeof item.name === "string" ? item.name : id;
    const label = display.trim() && display.length <= 200 && !/[\r\n\0]/.test(display) ? display.trim() : id;
    const support = interfaceSupport(item, protocol, contractProtocol);
    const reasoningEfforts = discoveredModelReasoningEfforts(item);
    const contract = parseModelContract(item, { protocol: contractProtocol, scope: "route" });
    const musicCapabilities = MUSIC_REFERENCE_CAPABILITIES.filter(capability => modelSupportsMusicReference(contract, capability));
    const architecture = item.architecture && typeof item.architecture === 'object' ? item.architecture as Record<string, unknown> : {};
    const modalities = item.modalities && typeof item.modalities === 'object' ? item.modalities as Record<string, unknown> : {};
    const boundedStrings = (value: unknown): string[] | undefined => Array.isArray(value)
      ? [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && /^[a-zA-Z0-9.+_/-]{1,100}$/.test(entry)).slice(0, 64).map(entry => entry.toLowerCase()))]
      : undefined;
    const advertisedInputs = boundedStrings(architecture.input_modalities ?? item.input_modalities ?? modalities.input);
    const nativeInputs = ["image", "pdf", "audio", "video"].filter(modality => contract.capabilityDeclarations?.[`input:${modality}`]?.support === "supported");
    const inputModalities = advertisedInputs ?? (nativeInputs.length ? ["text", ...nativeInputs] : undefined);
    const outputModalities = boundedStrings(architecture.output_modalities ?? item.output_modalities ?? modalities.output);
    const inputMimeTypes = boundedStrings(item.input_mime_types);
    const voices = Array.isArray(item.voices) ? [...new Set(item.voices
      .filter((voice): voice is string => typeof voice === 'string' && /^[A-Za-z0-9._/-]{1,100}$/.test(voice)).slice(0, 100))] : undefined;
    models.set(id.toLocaleLowerCase(), {
      id,
      label,
      ...(typeof item.available === 'boolean' ? { available: item.available } : {}),
      ...(voices === undefined ? {} : { voices }),
      ...discoveredModelLimits(item),
      ...discoveredTokenPrices(item),
      ...(contract.decisionEndpointSupport || contract.decisionEndpointRoles?.length || contract.reasoningControls || contract.modalityLimits || Object.values(contract.capabilityDeclarations ?? {}).some(value => value.support !== "unknown") ? contract : {}),
      ...(musicCapabilities.length ? { capabilities: musicCapabilities } : {}),
      ...(contract.capabilityDeclarations?.tools?.support === "unknown" ? {} : { toolsSupported: contract.capabilityDeclarations?.tools?.support === "supported" }),
      ...(reasoningEfforts ? { reasoningEfforts } : {}),
      ...(inputModalities === undefined ? {} : { inputModalities }),
      ...(outputModalities === undefined ? {} : { outputModalities }),
      ...(inputMimeTypes === undefined ? {} : { inputMimeTypes }),
      interfaceSupport: support.support,
      interfaceSupportSource: support.source,
    });
    if (models.size >= cap) break;
  }
  return [...models.values()].sort((left, right) => left.id.localeCompare(right.id, "en", { numeric: true }));
}

function boundedCursor(value: unknown): string | undefined {
  const cursor = typeof value === "string" ? value.trim() : "";
  return cursor && cursor.length <= 1_024 && !/[\r\n\0]/.test(cursor) ? cursor : undefined;
}

function nextModelPage(endpoint: URL, payload: any, protocol: OfficialProviderProtocol): URL | undefined {
  const next = new URL(endpoint);
  if (protocol === "gemini_generate_content") {
    const token = boundedCursor(payload?.nextPageToken);
    if (!token) return undefined;
    next.searchParams.set("pageToken", token);
    return next;
  }
  if (protocol === "anthropic_messages" && payload?.has_more === true) {
    const afterId = boundedCursor(payload?.last_id);
    if (!afterId) throw new OfficialModelError("INVALID_RESPONSE", "The model catalog returned an invalid pagination cursor");
    next.searchParams.set("after_id", afterId);
    return next;
  }
  return undefined;
}

/** Native metadata discovery is bounded to four /show requests at a time. */
export async function discoverOllamaModelCatalog(options: DiscoverOfficialModelsOptions): Promise<OfficialModelCatalog | undefined> {
  if (options.protocol !== "openai_chat_completions" || !isOllamaCandidate(options)) return undefined;
  const controller = new AbortController();
  let timedOut = false;
  const abort = (): void => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const duration = timeoutMs(options.timeoutMs);
  const timer = duration > 0 ? setTimeout(() => { timedOut = true; controller.abort(); }, duration) : undefined;
  const nativeOptions = { ...options, signal: controller.signal };
  try {
    const server = await detectOllama(nativeOptions);
    if (!server) return undefined;
    let payload: any;
    try { payload = await ollamaJsonRequest(nativeOptions, "tags"); }
    catch (error) {
      if ([404, 405, 501].includes(normalizeOfficialModelError(error).httpStatus ?? 0)) return undefined;
      throw error;
    }
    if (!Array.isArray(payload?.models)) throw new OfficialModelError("INVALID_RESPONSE", "Invalid Ollama model catalog response");
    const rows = new Map<string, { id: string; digest?: string; details: Record<string, unknown> }>();
    for (const raw of payload.models.slice(0, MAX_DISCOVERED_MODELS * 2)) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const id = boundedModelId(raw.model ?? raw.name);
      if (!id) continue;
      const digest = typeof raw.digest === "string" && /^[\w:.-]{1,200}$/.test(raw.digest) ? raw.digest : undefined;
      rows.set(id, { id, ...(digest ? { digest } : {}), details: raw.details && typeof raw.details === "object" ? raw.details : {} });
      if (rows.size >= MAX_DISCOVERED_MODELS) break;
    }
    const entries = [...rows.values()], models: OfficialModelCatalogEntry[] = [];
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => {
      while (index < entries.length) {
        const row = entries[index++];
        if (controller.signal.aborted) throw controller.signal.reason;
        let metadata: OllamaModelMetadata;
        try { metadata = await getOllamaModelMetadata({ ...nativeOptions, model: row.id, digest: row.digest }); }
        catch (error) {
          // A model can disappear between /tags and /show; retain an unverified
          // directory entry, never invent capabilities from its name.
          if (![404, 405, 501].includes(normalizeOfficialModelError(error).httpStatus ?? 0)) throw error;
          metadata = {};
        }
        const capabilities = metadata.capabilities;
        const embeddingOnly = capabilities?.includes("embedding") && !capabilities.includes("completion");
        const support: OfficialModelInterfaceSupport = embeddingOnly ? "unsupported" : capabilities?.includes("completion") ? "supported" : "unknown";
        const detailText = (value: unknown): string | undefined => typeof value === "string" && /^[\w .+-]{1,128}$/.test(value) ? value : undefined;
        const parameterSize = metadata.parameterSize ?? detailText(row.details.parameter_size);
        const quantizationLevel = metadata.quantizationLevel ?? detailText(row.details.quantization_level);
        const reasoningEfforts = MODEL_REASONING_EFFORTS.filter(effort => metadata.thinkingLevels?.includes(effort));
        models.push({
          id: row.id, label: row.id,
          ...parseModelContract({ capabilities, reasoningControls: capabilities?.includes("thinking") ? [
            ...(metadata.thinkingLevels?.length ? [{ type: "effort", parameter: "think", support: "supported", values: metadata.thinkingLevels, default: typeof metadata.thinkingDefault === "string" ? metadata.thinkingDefault : undefined }] : []),
            ...(!metadata.thinkingValues || metadata.thinkingValues.some(value => typeof value === "boolean") ? [{ type: "on-off", parameter: "think", support: "supported", values: metadata.thinkingValues?.filter(value => typeof value === "boolean") ?? [true, false], default: typeof metadata.thinkingDefault === "boolean" ? metadata.thinkingDefault : undefined }] : []),
          ] : [] }, { protocol: "ollama", scope: "route" }),
          contextTokens: ollamaContextLimit({ maxContextTokens: metadata.maxContextTokens, userContextTokens: options.providerSettings?.ollamaContextTokens }),
          ...(metadata.maxContextTokens ? { maxContextTokens: metadata.maxContextTokens } : {}),
          ...(capabilities === undefined ? {} : { capabilities, toolsSupported: capabilities.includes("tools"), inputModalities: capabilities.includes("vision") ? ["text", "image"] : ["text"], outputModalities: embeddingOnly ? ["embeddings"] : ["text"] }),
          ...(parameterSize ? { parameterSize } : {}), ...(quantizationLevel ? { quantizationLevel } : {}),
          ...(row.digest ? { digest: row.digest } : {}), ...(reasoningEfforts.length ? { reasoningEfforts } : {}),
          ...(embeddingOnly ? { selectionMode: "catalog_only" as const } : {}),
          interfaceSupport: support, interfaceSupportSource: capabilities === undefined ? "models_endpoint" : "provider_metadata",
        });
      }
    }));
    const catalogModels = models.sort((left, right) => left.id.localeCompare(right.id, "en", { numeric: true }));
    return {
      ollamaStatus: { version: server.version, modelCount: catalogModels.length, toolsModelCount: catalogModels.filter(model => model.toolsSupported && model.interfaceSupport !== "unsupported").length },
      catalogModels,
      interfaceSupportedModels: catalogModels.filter(model => model.interfaceSupport === "supported"),
      interfaceUnsupportedModels: catalogModels.filter(model => model.interfaceSupport === "unsupported"),
      interfaceUnverifiedModels: catalogModels.filter(model => model.interfaceSupport === "unknown"),
    };
  } catch (error) {
    controller.abort();
    throw normalizeOfficialModelError(error, { signal: options.signal, timedOut, provider: options.providerId });
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

/**
 * Lists model identifiers without generating content. The result proves only
 * that the endpoint advertised a model; callers must probe tools/modalities
 * separately and must not infer them from this response.
 */
export async function discoverOfficialModelCatalog(
  options: DiscoverOfficialModelsOptions,
): Promise<OfficialModelCatalog> {
  try {
    return await discoverCatalog(options);
  } catch (error) {
    // A catalog error can echo the key it was sent with (audit B02-01).
    const environment = options.providerSettings?.credentialSource === "environment" ? [process.env.AZURE_API_KEY, process.env.AWS_BEARER_TOKEN_BEDROCK] : [];
    throw redactErrorSecrets(error, credentialSecrets(options.apiKey, undefined, environment));
  }
}

async function discoverCatalog(options: DiscoverOfficialModelsOptions): Promise<OfficialModelCatalog> {
  if (options.signal?.aborted) {
    throw new OfficialModelError("CANCELLED", "Model discovery request cancelled");
  }
  if (options.providerId === "vertex") {
    throw new OfficialModelError("DISCOVERY_UNSUPPORTED", "Vertex discovery authentication and endpoints are not configured; keep manual model configuration");
  }
  const ollamaCatalog = await discoverOllamaModelCatalog(options);
  if (ollamaCatalog) return ollamaCatalog;
  const azure = options.providerId === "azure_openai";
  const bedrock = options.providerId === "bedrock" ? bedrockCatalogRequest(options) : undefined;
  const normalizedBaseUrl = options.baseUrl.trim().replace(/\/+$/, "").replace(/\/(?:chat\/completions|responses|messages|models)$/i, "");
  const compatibleBaseUrl = options.providerId === "ollama"
    ? new URL("v1", ollamaBaseUrl(options.baseUrl, options.allowInsecure === true)).toString()
    : versionedBaseUrl(normalizedBaseUrl || options.baseUrl, options.protocol, options.providerId);
  let endpoint = bedrock?.endpoint ?? (azure ? azureModelEndpoint(options)
    : modelEndpoint(compatibleBaseUrl, options.protocol, options.allowInsecure === true));
  const apiKey = bedrock?.apiKey ?? discoveryApiKey(options);
  const controller = new AbortController();
  let timedOut = false;
  const abort = (): void => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs(options.timeoutMs));
  try {
    const models = new Map<string, OfficialModelCatalogEntry>();
    const cursors = new Set<string>();
    const cap = isOpenRouter(endpoint) ? MAX_OPENROUTER_MODELS : MAX_DISCOVERED_MODELS;
    for (let page = 0; page < MAX_DISCOVERY_PAGES && models.size < cap; page += 1) {
      if (controller.signal.aborted) throw controller.signal.reason;
      const response = await (options.fetchImpl ?? fetch)(endpoint, {
        method: "GET",
        redirect: "error",
        headers: { accept: "application/json", ...(azure ? { "api-key": apiKey } : modelHeaders(options.protocol, apiKey)) },
        signal: controller.signal,
      });
      // Keep provider error codes/messages when available, while preserving HTTP
      // classification when a compatible gateway sends an HTML or text error.
      if (!response.ok) {
        let errorBody: unknown;
        try { errorBody = await readLimitedJson(response); }
        catch (error) { errorBody = { message: normalizeOfficialModelError(error).readableError.detail }; }
        throw normalizeOfficialModelError({ status: response.status, headers: response.headers, data: errorBody });
      }
      const payload = await readLimitedJson(response);
      if (controller.signal.aborted) throw controller.signal.reason;
      if (azure && !Array.isArray(payload?.data)) throw new OfficialModelError("INVALID_RESPONSE", "Invalid Azure model catalog response");
      for (const model of bedrock ? parseBedrockModelCatalog(payload, MAX_DISCOVERED_MODELS) : parseModelPage(payload, options.protocol, cap, options.providerId === "openrouter" || isOpenRouter(endpoint) ? "openrouter" : options.protocol)) {
        models.set(model.id.toLocaleLowerCase(), azure ? { ...model, selectionMode: "catalog_only" } : model);
        if (models.size >= cap) break;
      }
      // ListFoundationModels has no cursor; never follow invented model URLs/tokens.
      if (bedrock) break;
      const next = nextModelPage(endpoint, payload, options.protocol);
      if (!next) break;
      const cursor = next.toString();
      if (cursors.has(cursor)) {
        throw new OfficialModelError("INVALID_RESPONSE", "The model catalog repeated the same pagination cursor");
      }
      cursors.add(cursor);
      endpoint = next;
    }
    const catalogModels = [...models.values()].sort((left, right) =>
      left.id.localeCompare(right.id, "en", { numeric: true }));
    return {
      catalogModels,
      interfaceSupportedModels: catalogModels.filter(model => model.interfaceSupport === "supported"),
      interfaceUnsupportedModels: catalogModels.filter(model => model.interfaceSupport === "unsupported"),
      interfaceUnverifiedModels: catalogModels.filter(model => model.interfaceSupport === "unknown"),
    };
  } catch (error) {
    throw normalizeOfficialModelError(error, { signal: options.signal, timedOut, provider: options.providerId });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

/**
 * Backward-compatible directory list. Provider metadata is retained when
 * present so callers can show explicitly unsupported models without selecting
 * them; unknown entries remain visible and still require a live probe.
 */
export async function discoverOfficialModels(
  options: DiscoverOfficialModelsOptions,
): Promise<readonly DiscoveredOfficialModel[]> {
  const catalog = await discoverOfficialModelCatalog(options);
  return catalog.catalogModels.filter(model => !catalog.ollamaStatus || model.interfaceSupport !== "unsupported").map(model => model.interfaceSupport === "unknown"
    ? { id: model.id, label: model.label, ...retainedModelLimits(model), ...(model.selectionMode ? { selectionMode: model.selectionMode } : {}) }
    : {
      id: model.id,
      label: model.label,
      ...retainedModelLimits(model),
      ...(model.selectionMode ? { selectionMode: model.selectionMode } : {}),
      interfaceSupport: model.interfaceSupport,
      interfaceSupportSource: model.interfaceSupportSource,
    });
}

function retainedModelLimits(model: DiscoveredOfficialModel): Omit<DiscoveredOfficialModel, "id" | "label" | "selectionMode" | "interfaceSupport" | "interfaceSupportSource"> {
  return {
    ...(model.available === undefined ? {} : { available: model.available }),
    ...(model.voices === undefined ? {} : { voices: model.voices }),
    ...(model.contextTokens === undefined ? {} : { contextTokens: model.contextTokens }),
    ...(model.inputTokens === undefined ? {} : { inputTokens: model.inputTokens }),
    ...(model.maximumOutputTokens === undefined ? {} : { maximumOutputTokens: model.maximumOutputTokens }),
    ...(model.inputPricePerMillion === undefined ? {} : { inputPricePerMillion: model.inputPricePerMillion }),
    ...(model.outputPricePerMillion === undefined ? {} : { outputPricePerMillion: model.outputPricePerMillion }),
    ...(model.cachedInputPricePerMillion === undefined ? {} : { cachedInputPricePerMillion: model.cachedInputPricePerMillion }),
    ...(model.cacheWritePricePerMillion === undefined ? {} : { cacheWritePricePerMillion: model.cacheWritePricePerMillion }),
    ...(model.reasoningEfforts === undefined ? {} : { reasoningEfforts: model.reasoningEfforts }),
    ...(model.reasoningControls === undefined ? {} : { reasoningControls: model.reasoningControls }),
    ...(model.taskCategories === undefined ? {} : { taskCategories: model.taskCategories }),
    ...(model.decisionEndpointRoles === undefined ? {} : { decisionEndpointRoles: model.decisionEndpointRoles }),
    ...(model.decisionEndpointTariff === undefined ? {} : { decisionEndpointTariff: model.decisionEndpointTariff }),
    ...(model.decisionEndpointSupport === undefined ? {} : { decisionEndpointSupport: model.decisionEndpointSupport }),
    ...(model.capabilityDeclarations === undefined ? {} : { capabilityDeclarations: model.capabilityDeclarations }),
    ...(model.modalityLimits === undefined ? {} : { modalityLimits: model.modalityLimits }),
    ...(model.inputModalities === undefined ? {} : { inputModalities: model.inputModalities }),
    ...(model.outputModalities === undefined ? {} : { outputModalities: model.outputModalities }),
    ...(model.inputMimeTypes === undefined ? {} : { inputMimeTypes: model.inputMimeTypes }),
    ...(model.maxContextTokens === undefined ? {} : { maxContextTokens: model.maxContextTokens }),
    ...(model.toolsSupported === undefined ? {} : { toolsSupported: model.toolsSupported }),
    ...(model.capabilities === undefined ? {} : { capabilities: model.capabilities }),
    ...(model.parameterSize === undefined ? {} : { parameterSize: model.parameterSize }),
    ...(model.quantizationLevel === undefined ? {} : { quantizationLevel: model.quantizationLevel }),
    ...(model.digest === undefined ? {} : { digest: model.digest }),
  };
}
