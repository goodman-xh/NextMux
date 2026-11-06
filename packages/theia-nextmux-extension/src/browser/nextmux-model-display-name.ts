import { modelNameGroupKey, modelReleaseVariant } from '../common/nextmux-model-name';

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

/** The video models api.4stoken.cn lists under its own names, as SCAPI_MODEL_NAMES. */
const RELAY_MODEL_NAMES: readonly (readonly string[])[] = [
    ['Wan 3.0 Video GB', 'wan3.0-video-gb', 'alibaba/wan3.0-video-gb'],
    ['Wan 3.0 Video Prime', 'wan3.0-video-prime', 'alibaba/wan3.0-video-prime'],
    ['Kling Video v4', 'kling-video-v4', 'klingai/kling-video-v4'],
    ['Video Subtitle Pro', 'video-subtitle-pro', 'alibaba/video-subtitle-pro'],
    ['Veo 3.1 R2V Fast Landscape', 'veo_3_1_r2v_fast_landscape', 'google/veo-3.1-r2v-fast-landscape'],
    ['Veo 3.1 I2V Fast FL', 'veo_3_1_i2v_s_fast_fl', 'google/veo-3.1-i2v-fast-fl'],
    ['Veo 3.1 T2V Fast', 'veo_3_1_t2v_fast', 'google/veo-3.1-t2v-fast'],
    ['Seedance 2.5', '4sdance_2.5'],
    ['Seedance 2.0 Mini', '4sdance_mini931'],
    ['Doubao Seedance 2.0 Fast', '4sdance_fast_931'],
    ['Doubao Seedance 2.0', '4sdance931']
];

const modelIdKey = (value: string): string => value.trim().replace(/^~/, '').toLowerCase();
const modelIdTail = (key: string): string => key.slice(key.lastIndexOf('/') + 1);

const KNOWN_MODEL_NAMES = new Map([...SCAPI_MODEL_NAMES, ...RELAY_MODEL_NAMES].flatMap(([name, ...ids]) =>
    ids.flatMap(id => [modelIdKey(id), modelIdTail(modelIdKey(id))].map(key => [key, name] as const))));

const tableModelName = (value: string): string | undefined => {
    const key = modelIdKey(value);
    return KNOWN_MODEL_NAMES.get(key) ?? KNOWN_MODEL_NAMES.get(modelIdTail(key));
};

/** DeepSeek's own style however a relay spells it: DeepSeek-V4.1-Flash 1017. A release is a model of its own, so it stays. */
function deepseekModelName(value: string): string | undefined {
    const match = /^deepseek-([vr]\d+(?:\.\d+)?)((?:-(?:flash|pro|lite|mini|exp))*)(?:-(\d{4}))?$/.exec(modelIdTail(modelNameGroupKey(value)));
    if (!match) return undefined;
    const [, version, variants, release] = match;
    return `DeepSeek-${version.toUpperCase()}${variants.replace(/-[a-z]/g, letter => letter.toUpperCase())}${release ? ` ${release}` : ''}`;
}

/** The title of a known model, by provider code or canonical ID, whatever its case or namespace. */
export function knownModelName(value: string): string | undefined {
    return tableModelName(value) ?? deepseekModelName(value);
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
    // So does a canonical release: a catalogue name that left it off would merge DeepSeek-V4.1 1017 into DeepSeek-V4.1.
    const known = tableModelName(canonical) || (modelReleaseVariant(canonical) ? deepseekModelName(canonical) : undefined) || knownModelName(source);
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
