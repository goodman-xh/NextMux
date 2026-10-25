/** A conversation's input/output window budget, not a cumulative token allowance. */
export function normalizeContextWindowTokens(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1_024 && value <= 100_000_000
        ? value : undefined;
}

export interface ContextModelMetadata {
    readonly id: string;
    readonly canonicalModel: string;
    readonly provider: string;
    readonly inputTokens?: number | null;
    readonly contextTokens: number | null;
    readonly maximumOutputTokens?: number | null;
}

/** Exact identities only: a similarly named model on another API is not capacity evidence. */
export interface ContextModelIdentity {
    readonly registryModelId?: string;
    readonly providerId?: string;
    readonly model?: string;
    readonly capacity?: ModelCapacity;
}

export interface ModelCapacity {
    readonly contextTokens?: number | null;
    readonly inputTokens?: number | null;
    readonly maximumOutputTokens?: number | null;
}

export function normalizeModelCapacity(value: ModelCapacity | undefined): { readonly contextTokens?: number; readonly inputTokens?: number; readonly maximumOutputTokens?: number } {
    const valid = (input: unknown): input is number => typeof input === 'number' && Number.isSafeInteger(input) && input > 0 && input <= 100_000_000;
    return Object.fromEntries(['contextTokens', 'inputTokens', 'maximumOutputTokens']
        .filter(key => valid(value?.[key as keyof ModelCapacity])).map(key => [key, value![key as keyof ModelCapacity]]));
}

// Exact names only. Provider aliases identify the same author, never a fuzzy
// model family (e.g. 'mini', ':thinking', version dates and suffixes stay intact).
const contextProviderAliases: Readonly<Record<string, string>> = {
    gemini: 'google', 'google-ai-studio': 'google', xai: 'x-ai', grok: 'x-ai',
    mistral: 'mistralai', alibaba: 'qwen', zhipu: 'z-ai', zai: 'z-ai',
    moonshot: 'moonshotai', 'moonshot-ai': 'moonshotai', minimaxai: 'minimax'
};
const contextAuthors = new Set(['openai', 'anthropic', 'google', 'x-ai', 'mistralai', 'qwen', 'z-ai', 'moonshotai', 'minimax', 'deepseek', 'cohere']);
// A local runtime serves whatever window its own server is set to (Ollama's num_ctx), not the model card's.
const contextLocalRuntimes = new Set(['ollama']);
function contextProvider(value: string): string { return contextProviderAliases[value.toLowerCase()] || value.toLowerCase(); }
function contextCanonical(value: string): string {
    // One spelling per version: Anthropic's API writes claude-opus-4-6 where catalogs write claude-opus-4.6.
    const name = value.toLowerCase().replace(/^models\//, '').replace(/(?<=\d)-(?=\d)/g, '.');
    const slash = name.indexOf('/');
    return slash < 0 ? name : `${contextProvider(name.slice(0, slash))}/${name.slice(slash + 1)}`;
}
function matchingContextModels(models: readonly ContextModelMetadata[], identity: ContextModelIdentity): readonly ContextModelMetadata[] {
    if (identity.registryModelId) return models.filter(entry => entry.id === identity.registryModelId);
    if (!identity.model) return [];
    const model = contextCanonical(identity.model), provider = contextProvider(identity.providerId || '');
    const direct = models.filter(entry => contextProvider(entry.provider) === provider
        && contextCanonical(entry.canonicalModel) === (model.includes('/') ? model : `${provider}/${model}`));
    if (direct.length) return direct;
    if (contextLocalRuntimes.has(provider)) return [];
    // Own APIs (OpenRouter, relays, Azure, custom endpoints) seldom declare context_length in /v1/models.
    // An official model ID, as author/model or as the bare name, inherits that model's published window.
    // Anything else matches nothing: a deployment name, a dated snapshot or a ':thinking' variant, and a
    // bare name that two authors publish.
    const exact = models.filter(entry => contextAuthors.has(contextProvider(entry.provider))
        && contextCanonical(entry.canonicalModel) === (model.includes('/') ? model : `${contextProvider(entry.provider)}/${model}`));
    return new Set(exact.map(entry => contextCanonical(entry.canonicalModel))).size === 1 ? exact : [];
}

/** Same conservative resolver in the picker and host, never supplied by a renderer preference. */
export function modelContextWindowTokens(models: readonly ContextModelMetadata[], identity: ContextModelIdentity): number | undefined {
    const entries = [...matchingContextModels(models, identity), ...(identity.capacity ? [identity.capacity] : [])];
    // The window is the joint input+output size a model card publishes (GPT-5.4: 1,050,000). A separate input
    // ceiling (922,000 = window - output) is enforced as modelInputTokenLimit, so it never shrinks the window.
    // An input-only API (Gemini) declares no joint window: its input ceiling is then a conservative planning
    // budget with output reserved inside it, never a larger window made by summing independent limits.
    const limits = entries.map(entry => normalizeContextWindowTokens(entry.contextTokens) ?? normalizeContextWindowTokens(entry.inputTokens))
        .filter((value): value is number => value !== undefined);
    return limits.length ? Math.min(...limits) : undefined;
}

export function modelInputTokenLimit(models: readonly ContextModelMetadata[], identity: ContextModelIdentity): number | undefined {
    const limits = [...matchingContextModels(models, identity), ...(identity.capacity ? [identity.capacity] : [])]
        .map(entry => normalizeModelCapacity(entry).inputTokens).filter((value): value is number => typeof value === 'number');
    return limits.length ? Math.min(...limits) : undefined;
}

export function modelOutputTokenLimit(models: readonly ContextModelMetadata[], identity: ContextModelIdentity): number | undefined {
    const limits = [...matchingContextModels(models, identity), ...(identity.capacity ? [identity.capacity] : [])]
        .map(entry => normalizeModelCapacity(entry).maximumOutputTokens).filter((value): value is number => typeof value === 'number');
    return limits.length ? Math.min(...limits) : undefined;
}

/** An explicit user budget can bound an unknown API; automatic never invents a capacity. */
export function effectiveContextWindowTokens(selected: unknown, modelLimit: unknown): number | undefined {
    const maximum = normalizeContextWindowTokens(modelLimit);
    if (maximum === undefined) return normalizeContextWindowTokens(selected);
    return Math.min(normalizeContextWindowTokens(selected) ?? maximum, maximum);
}

/**
 * A context size the way model vendors and mainstream tools write it: 131,072 → 128K, 262,144 → 256K,
 * 200,000 → 200K, 1,048,576 → 1M (Zed, OpenRouter and vendor docs all use a compact K/M form).
 * Round decimal sizes stay decimal (128,000 → 128K); binary sizes use binary thousands (131,072 → 128K).
 */
export function contextWindowTokenLabel(tokens: number): string {
    if (!Number.isFinite(tokens) || tokens <= 0) return '—';
    // Vendors sell these as "1M": GPT-4.1's 1,047,576, Gemini's 1,048,576, GPT-5.4's 1,050,000, and a
    // 1M window that a relay reports less its output reserve (921,600, 922,000).
    if (tokens >= 900_000 && tokens <= 1_050_000) return '1M';
    if (tokens === 2_097_152 || tokens === 2_000_000) return '2M';
    const unit = tokens % 1_000 !== 0 && tokens % 1_024 === 0 ? 1_024 : 1_000;
    // 1.5M, 2M; thousands are whole: 128K, 200K.
    if (tokens >= unit * unit) return `${Number((tokens / (unit * unit)).toFixed(2))}M`;
    if (tokens >= unit) return `${Number((tokens / unit).toFixed(tokens < unit * 10 ? 1 : 0))}K`;
    return String(Math.round(tokens));
}

/**
 * Selectable context windows up to the model's declared (or learned real) ceiling, ascending: the standard
 * 32K, 64K, 128K, 256K, 512K, 1M … tiers below it, then the ceiling itself as the top option. 200K is a
 * ceiling (Claude), never a step on the way to a larger window. Tiers follow the ceiling's binary
 * (1,024-based) or decimal convention.
 */
export function contextWindowChoices(maxTokens: unknown, learnedCapTokens?: unknown): readonly number[] {
    const declaredMax = normalizeContextWindowTokens(maxTokens);
    const learnedCap = normalizeContextWindowTokens(learnedCapTokens);
    const effectiveMax = declaredMax !== undefined && learnedCap !== undefined
        ? Math.min(declaredMax, learnedCap)
        : (declaredMax ?? learnedCap);
    if (effectiveMax === undefined) return [];
    const isBinary = effectiveMax % 1_000 !== 0 && (effectiveMax % 1_024 === 0 || effectiveMax === 1_047_576);
    const k = isBinary ? 1_024 : 1_000;
    const m = isBinary ? 1_024 * 1_024 : 1_000_000;
    const maxLabel = contextWindowTokenLabel(effectiveMax);
    // A tier the ceiling rounds to (1M under a 1,050,000 ceiling) would be a second "1M" row.
    const tiers = [32 * k, 64 * k, 128 * k, 256 * k, 512 * k, m, 2 * m, 4 * m, 10 * m]
        .filter(tier => tier < effectiveMax && contextWindowTokenLabel(tier) !== maxLabel);
    return [...tiers, effectiveMax];
}
