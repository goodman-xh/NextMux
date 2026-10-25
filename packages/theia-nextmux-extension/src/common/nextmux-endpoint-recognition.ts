import { mediaTemplatePresetForUrl } from '@nextmux/model-runtime/media-template';

/**
 * Pasted API addresses that are really a request example, or that carry the key in the URL.
 *
 * People copy a full request example from a provider's docs, e.g.
 *   https://api.wuyinkeji.com/api/async/video_veo3.1_fast?key=…
 *   https://queue.fal.run/fal-ai/veo3/fast
 *   https://api.replicate.com/v1/models/google/veo-3/predictions
 * An API that only takes generation tasks is a 自定义生成接口 in its known format: the address,
 * the model and the key are split out. A key found in any pasted URL moves to the key field and
 * never stays in the address. APIs that also chat (百炼, 方舟, 硅基流动) are left as they are;
 * their generation format is chosen under 高级.
 */
export interface RecognizedEndpoint {
    /** The connection type to switch to, when the address belongs to a generation-only API. */
    readonly providerId?: string;
    /** Its task format (a media-template preset). */
    readonly mediaPreset?: string;
    /** The address without the key (and without the model, for a generation API). */
    readonly baseUrl: string;
    readonly model?: string;
    readonly apiKey?: string;
}

const KEY_PARAMETERS = ['key', 'api_key', 'apikey', 'token', 'access_token'];

/** Where the model sits in a generation-only API's request example. */
function generationAddress(preset: string, url: URL): { readonly baseUrl: string; readonly model?: string } | undefined {
    const path = url.pathname.replace(/\/+$/, '');
    if (preset === 'wuyin') {
        const match = /^(\/api\/async)(?:\/([^/]{2,80}))?$/i.exec(path);
        if (!match) return { baseUrl: `${url.origin}/api/async` };
        return { baseUrl: `${url.origin}${match[1]}`, ...(match[2] && match[2] !== 'detail' ? { model: decodeURIComponent(match[2]) } : {}) };
    }
    if (preset === 'fal') {
        const model = path.replace(/^\//, '').replace(/\/requests(?:\/.*)?$/, '');
        return { baseUrl: 'https://queue.fal.run', ...(model ? { model } : {}) };
    }
    if (preset === 'replicate') {
        const match = /^\/v1\/models\/([^/]+\/[^/]+)/.exec(path);
        return { baseUrl: `${url.origin}/v1`, ...(match ? { model: match[1] } : {}) };
    }
    return undefined;
}

export function recognizeEndpoint(value: string): RecognizedEndpoint | undefined {
    const text = value.trim();
    if (!/^https?:\/\//i.test(text)) return undefined;
    let url: URL;
    try { url = new URL(text); } catch { return undefined; }
    let apiKey: string | undefined;
    for (const name of KEY_PARAMETERS) {
        const found = url.searchParams.get(name);
        if (found && found.trim() && !/^(?:你的密钥|your[_-]?(?:api[_-]?)?key|xxx+|<.*>)$/i.test(found.trim())) apiKey ??= found.trim();
        url.searchParams.delete(name);
    }
    const preset = mediaTemplatePresetForUrl(url.toString());
    const generation = preset ? generationAddress(preset, url) : undefined;
    if (preset && generation) {
        return { providerId: 'custom_media', mediaPreset: preset, baseUrl: generation.baseUrl, ...(generation.model ? { model: generation.model } : {}), ...(apiKey ? { apiKey } : {}) };
    }
    if (!apiKey) return undefined;
    url.hash = '';
    return { baseUrl: url.toString().replace(/\?$/, ''), apiKey };
}
