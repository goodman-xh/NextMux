/**
 * The IDs a merchant's own listing and an unlisted model get: anonymous by design (model-policies.js,
 * merchant-unlisted-models.js), so they name nothing. "Model 41e8…" is how older labels printed one, and a saved label may
 * still say it. Any other namespace is someone's real model, and so is a dated "model-20240601".
 */
const SYNTHETIC_MODEL_ID = /^(?:~?(?:merchant-[0-9a-f]+|unlisted)\/)?(?:merchant-)?model[-\s](?!\d{8}$)[0-9a-f]{8,}$/i;

export const isSyntheticModelId = (value: string): boolean => SYNTHETIC_MODEL_ID.test(value.trim());

/** 速创's models, each name then its IDs: a provider code is the last part of an address, and a canonical ID is no title. */
const SCAPI_MODEL_NAMES: readonly (readonly string[])[] = [
    ['GPT Image 2.6', 'image_gpt_2.6', 'openai/gpt-image-2.6'],
    ['GPT Image 2.6 Sunburst', 'image_gpt_2.6_sunburst', 'openai/gpt-image-2.6-sunburst'],
    ['GPT Image 2.6 Flare', 'image_gpt_2.6_flare', 'openai/gpt-image-2.6-flare'],
    ['GPT Image 2.5', 'image_gpt_2.5', 'openai/gpt-image-2.5'],
    ['GPT Image 2.5 Sunburst', 'image_gpt_2.5_sunburst', 'openai/gpt-image-2.5-sunburst'],
    ['GPT Image 2.5 Flare', 'image_gpt_2.5_flare', 'openai/gpt-image-2.5-flare'],
    ['GPT Image 2', 'image_gpt', 'openai/gpt-image-2'],
    ['Nano Banana 2', 'image_nanoBanana2', 'google/nano-banana-2'],
    ['Nano Banana 2.1', 'NanoBanana2.1', 'google/gemini-nano-banana-2.1'],
    ['Nano Banana 2 Lite', 'image_nanoBanana2Lite', 'google/nano-banana-2-lite'],
    ['Nano Banana Pro', 'image_nanoBanana_pro', 'google/nano-banana-pro'],
    ['Nano Banana', 'image_nanoBanana', 'google/nano-banana'],
    ['Wan 3.0 Video', 'video_wan_3.0', 'alibaba/wan3.0-video'],
    ['Kling Video v3 Omni', 'video_omni', 'klingai/kling-video-v3-omni'],
    ['MiniMax Hailuo 3', 'video_minimax_h3', 'minimax/hailuo-3'],
    ['Muse Video', 'video_muse', 'muse/video-muse'],
    ['Agnes Video', 'video_agens', 'agnes/video-agens'],
    ['Google Omni Video', 'video_google_omni', 'google/google-omni-video'],
    ['Vidu Q3', 'video_vidu', 'vidu/vidu-q3'],
    ['Vidu Q3 Pro', 'video_vidu_q3_pro', 'vidu/vidu-q3-pro'],
    ['Grok Imagine Video', 'video_grok_imagine', 'x-ai/grok-imagine-video']
];

const modelIdKey = (value: string): string => value.trim().replace(/^~/, '').toLowerCase();
const modelIdTail = (key: string): string => key.slice(key.lastIndexOf('/') + 1);

const KNOWN_MODEL_NAMES = new Map(SCAPI_MODEL_NAMES.flatMap(([name, ...ids]) =>
    ids.flatMap(id => [modelIdKey(id), modelIdTail(modelIdKey(id))].map(key => [key, name] as const))));

/** The title of a model in the table, by provider code or canonical ID, whatever its case or namespace. */
export function knownModelName(value: string): string | undefined {
    const key = modelIdKey(value);
    return KNOWN_MODEL_NAMES.get(key) ?? KNOWN_MODEL_NAMES.get(modelIdTail(key));
}

const compactProviderIdentity = (value: string): string => value
    .replace(/^~/, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');

const providerBaseIdentity = (value: string): string => compactProviderIdentity(value)
    .replace(/(?:artificialintelligence|ai|labs?|cloud|research)$/u, '');

const sameProviderIdentity = (left: string, right: string): boolean => {
    const compactLeft = compactProviderIdentity(left);
    const compactRight = compactProviderIdentity(right);
    if (!compactLeft || !compactRight) return false;
    if (compactLeft === compactRight) return true;
    const baseLeft = providerBaseIdentity(left);
    const baseRight = providerBaseIdentity(right);
    return baseLeft.length >= 3 && baseLeft === baseRight;
};

export function modelDisplayNameOnly(
    displayName: string,
    providerName = '',
    canonicalModel = '',
    fallback = ''
): string {
    // An anonymous ID is never shown, or read as a provider or a family.
    const [name, spare, canonical] = [displayName, fallback, canonicalModel].map(value => isSyntheticModelId(value) ? '' : value.trim());
    const canonicalFallback = canonical.replace(/^~/, '').split('/').pop()?.trim() || '';
    const source = name || spare || canonicalFallback;
    if (!source) return '未命名模型';
    // The table outranks a catalogue name: the wrapper rules below would read "Muse AI Video" as provider Muse's "AI Video".
    const known = knownModelName(canonical) || knownModelName(source);
    if (known) return known;
    const providerCandidates = [...new Set([
        providerName,
        canonical.replace(/^~/, '').split('/')[0] || ''
    ].map(value => value.trim()).filter(Boolean))];
    const isProviderIdentity = (value: string): boolean => providerCandidates.some(candidate => sameProviderIdentity(value, candidate));
    let label = source;

    const namespacedLabel = label.match(/^(?:[^/\s]{1,80}\/)+([^/]+)$/u);
    if (namespacedLabel) label = namespacedLabel[1].trim();

    const colonPrefix = label.match(/^([^:：]{1,80})\s*[:：]\s*(.+)$/u);
    if (colonPrefix && isProviderIdentity(colonPrefix[1])) label = colonPrefix[2].trim();

    const tokenPrefix = label.match(/^(\S{1,80})\s+(.+)$/u);
    if (tokenPrefix && isProviderIdentity(tokenPrefix[1])) {
        const family = providerBaseIdentity(tokenPrefix[1]);
        // A vendor can also name the model family (Qwen 3, MiniMax 01, Aion 3).
        // Keep that identity unless it is merely a wrapper or repeated in the name.
        const namesModelFamily = !canonicalFallback || compactProviderIdentity(canonicalFallback).startsWith(family);
        if (!namesModelFamily || compactProviderIdentity(tokenPrefix[2]).startsWith(family)) label = tokenPrefix[2].trim();
    }

    const separatorSuffix = label.match(/^(.+?)\s*[·|]\s*([^·|]+)$/u);
    if (separatorSuffix && isProviderIdentity(separatorSuffix[2])) label = separatorSuffix[1].trim();

    const parentheticalSuffix = label.match(/^(.+?)\s+\(([^()]{1,80})\)$/u);
    if (parentheticalSuffix && isProviderIdentity(parentheticalSuffix[2])) label = parentheticalSuffix[1].trim();

    return label || spare || canonicalFallback || source;
}
