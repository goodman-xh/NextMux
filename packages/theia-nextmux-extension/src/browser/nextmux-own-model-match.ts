/**
 * Which public-directory model an own API's model id names ("claude-sonnet-4-5-20250929", "[官转]gpt-4o",
 * "video_wan_3.0", "deepseek-chat" …). Matching runs on this computer against the public catalog the app already
 * downloaded (models.dev + OpenRouter); nothing about the user's APIs is sent anywhere. What the API itself reported
 * always wins; the catalog only fills what it left out (kind, context, reference price, capabilities).
 */
import { modelNameForms, modelNameGroupKey, modelReleaseVariant } from '../common/nextmux-model-name';
import type { PlatformRegistryModel } from '../common/nextmux-platform-protocol';

export type CatalogModel = Pick<PlatformRegistryModel, 'canonicalModel' | 'id' | 'provider' | 'output' | 'capabilities' | 'contextTokens' | 'maximumOutputTokens'>
    & Partial<Pick<PlatformRegistryModel, 'aliases' | 'input' | 'referencePrice' | 'displayName' | 'kind' | 'taskCategories'>>;

interface CatalogIndex<T extends CatalogModel> { readonly exact: Map<string, T[]>; forms?: Map<string, T[]>; }
const indexes = new WeakMap<readonly CatalogModel[], CatalogIndex<CatalogModel>>();

/** When one spelling belongs to several providers, the model family names the author. */
const FAMILY_PROVIDERS: readonly (readonly [RegExp, RegExp])[] = [
    [/^(?:gpt|o\d|chatgpt|dall-e|sora|whisper|tts-\d|codex)/, /^openai$/],
    [/^(?:claude|opus|sonnet|haiku|fable)/, /^anthropic$/],
    [/^(?:gemini|gemma|imagen|veo|lyria)/, /^google$/],
    [/^deepseek/, /^deepseek/],
    [/^(?:qwen|qwq|qvq|wan)/, /^(?:alibaba|qwen)/],
    [/^(?:glm|cogview|cogvideo|chatglm)/, /^(?:zhipuai|z-ai|thudm)/],
    [/^(?:kimi|moonshot)/, /^moonshot/],
    [/^grok/, /^x-?ai$/],
    [/^llama/, /^meta/],
    [/^(?:mistral|mixtral|codestral|pixtral|magistral|devstral|ministral)/, /^mistral/],
    [/^(?:doubao|seed)/, /^(?:bytedance|doubao)/],
    [/^(?:minimax|abab|hailuo)/, /^minimax/],
    [/^ernie/, /^baidu/],
    [/^hunyuan/, /^tencent/],
];

function add<T extends CatalogModel>(map: Map<string, T[]>, key: string, model: T): void {
    if (!key) return;
    const list = map.get(key);
    if (!list) map.set(key, [model]);
    else if (!list.some(item => item.canonicalModel === model.canonicalModel) && list.length < 8) list.push(model);
}

function names(model: CatalogModel): string[] {
    return [...new Set([model.canonicalModel, model.id, ...(model.aliases || [])].filter(Boolean).map(value => value.toLowerCase()))].slice(0, 12);
}

function indexOf<T extends CatalogModel>(catalog: readonly T[]): CatalogIndex<T> {
    const cached = indexes.get(catalog) as CatalogIndex<T> | undefined;
    if (cached) return cached;
    const exact = new Map<string, T[]>();
    for (const model of catalog) for (const name of names(model)) { add(exact, name, model); add(exact, name.slice(name.lastIndexOf('/') + 1), model); }
    const index: CatalogIndex<T> = { exact };
    indexes.set(catalog, index as CatalogIndex<CatalogModel>);
    return index;
}

/** Spelling variants are built only when an exact name misses (a few hundred thousand keys for the full catalog). */
function formsOf<T extends CatalogModel>(catalog: readonly T[], index: CatalogIndex<T>): Map<string, T[]> {
    if (index.forms) return index.forms;
    const forms = new Map<string, T[]>();
    for (const model of catalog) for (const name of names(model).slice(0, 6)) for (const form of modelNameForms(name).slice(0, 16)) add(forms, form, model);
    index.forms = forms;
    return forms;
}

function pick<T extends CatalogModel>(candidates: readonly T[] | undefined, name: string): T | undefined {
    if (!candidates?.length) return undefined;
    if (candidates.length === 1) return candidates[0];
    const family = FAMILY_PROVIDERS.find(([pattern]) => pattern.test(name))?.[1];
    const preferred = family ? candidates.filter(model => family.test(model.provider.toLowerCase())) : [];
    return preferred.length === 1 ? preferred[0] : undefined;
}

function variantIdentity(name: string): { variants: string; versions: string } {
    const tail = modelNameGroupKey(name).split('/').pop()!.replace(/non-thinking/g, 'nothinking').replace(/([a-z])(\d)/g, '$1-$2');
    const parts = tail.replace(/(\d)-(?=\d+(?:\.\d+)*(?:-|$))/g, '$1.').split('-');
    return {
        variants: parts.filter(part => /^(?:mini|flash|pro|turbo|lite|preview|thinking|nothinking|vision|instruct|\d+(?:\.\d+)?b)$/.test(part)).sort().join('/'),
        // The backend accepts "4-0" / "4.0" / "4" and glued versions such as "veo3".
        versions: parts.filter(part => /^\d+(?:\.\d+)*[a-z]?$/.test(part) && !/^\d+(?:\.\d+)?b$/.test(part))
            .map(part => part.replace(/(?:\.0)+$/, '')).join('/')
    };
}

function hasNamedIdentity(name: string, identity: ReturnType<typeof variantIdentity>): boolean {
    const tail = modelNameGroupKey(name).split('/').pop()!;
    return FAMILY_PROVIDERS.some(([pattern]) => pattern.test(tail)) || Boolean(identity.variants) || /(?:^|-)v\d|\d+\.\d/.test(tail);
}

export function matchCatalogModel<T extends CatalogModel>(id: string, label: string | undefined, catalog: readonly T[] | undefined): T | undefined {
    const lower = id?.trim().toLowerCase();
    if (!lower || !catalog?.length) return undefined;
    const index = indexOf(catalog);
    const tail = lower.slice(lower.lastIndexOf('/') + 1);
    const identity = variantIdentity(lower);
    // Opaque deployment IDs may use a descriptive label; recognizable IDs own
    // their variant/version even when a generic label or a stale alias omits it.
    const namedIdentity = hasNamedIdentity(lower, identity);
    const labelIdentity = label ? variantIdentity(label) : undefined;
    const requested = namedIdentity ? identity : labelIdentity && hasNamedIdentity(label!, labelIdentity) ? labelIdentity : undefined;
    const requestedRelease = modelReleaseVariant(namedIdentity ? lower : label || lower);
    const compatible = (candidates: readonly T[] | undefined): readonly T[] | undefined => candidates?.filter(model => {
        if (modelReleaseVariant(model.canonicalModel) !== requestedRelease) return false;
        const candidate = variantIdentity(model.canonicalModel);
        return !requested || candidate.variants === requested.variants
            // A public alias such as deepseek-v3 -> deepseek-chat can omit a version;
            // two explicit versions must agree, including an extra version suffix.
            && (!requested.versions || candidate.versions === requested.versions
                || /(?:^|\/)deepseek-(?:chat|coder|reasoner)$/.test(model.canonicalModel.toLowerCase()));
    });
    for (const key of [lower, tail]) {
        const hit = pick(compatible(index.exact.get(key)), key.slice(key.lastIndexOf('/') + 1));
        if (hit) return hit;
    }
    const forms = formsOf(catalog, index);
    for (const form of [...modelNameForms(id), ...(!namedIdentity && label && label.toLowerCase() !== lower ? modelNameForms(label) : [])]) {
        const hit = pick(compatible(forms.get(form)), form);
        if (hit) return hit;
    }
    return undefined;
}
