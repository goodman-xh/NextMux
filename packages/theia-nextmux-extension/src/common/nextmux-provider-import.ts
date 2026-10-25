/**
 * One-click "apply to NextMux" from a relay's website, in the same shape as CC Switch links:
 *
 *   nextmux://v1/import?resource=provider&app=codex&name=Relay&endpoint=https%3A%2F%2Frelay.example%2Fv1&apiKey=sk-…&model=gpt-5.6-terra
 *
 * A relay that already offers "import to CC Switch" (ccswitch://v1/import?…) only swaps the
 * scheme. Recognised parameters: resource (must be "provider"), app, name, endpoint (comma-separated
 * for several), apiKey, model, sonnetModel / opusModel / haikuModel, homepage, notes. Anything else
 * (config blobs, usage scripts…) is ignored and never run. The app always shows a confirmation with
 * every value before anything is saved, and the key only goes to the OS keychain.
 */

export const PROVIDER_IMPORT_KEYS = ['resource', 'app', 'name', 'remark', 'provider', 'label', 'endpoint', 'baseUrl', 'apiKey', 'homepage', 'model', 'sonnetModel', 'opusModel', 'haikuModel', 'notes'] as const;
const VALUE_LIMIT = 4_096;

export interface ProviderImportRequest {
    /** CC Switch app id (claude, codex, gemini, opencode, openclaw…); decides how the endpoint is read. */
    readonly app: string;
    readonly name: string;
    /** Explicit user remark from the import link, when separate from provider/site name. */
    readonly remark?: string;
    /** Explicit provider or site name from the import link (excluding user remark). */
    readonly sourceName?: string;
    /** OpenAI-compatible base URLs derived from the link, first one preferred. */
    readonly endpoints: readonly string[];
    readonly apiKey: string;
    /** Suggested models, the link's default first. */
    readonly models: readonly string[];
    readonly homepage?: string;
    readonly notes?: string;
}

const clean = (value: string | null, limit = VALUE_LIMIT): string => (value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, limit);

/**
 * The OpenAI Chat Completions base for a relay endpoint. Claude- and Gemini-style links give the
 * service root (what ANTHROPIC_BASE_URL expects); relays built on new-api / one-api serve the
 * OpenAI-compatible API under /v1 of that root. Codex-style links already point at /v1.
 */
export function compatibleBaseUrl(endpoint: string, app = ''): string | undefined {
    let url: URL;
    try { url = new URL(endpoint.trim()); } catch { return undefined; }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return undefined;
    url.search = '';
    let path = url.pathname.replace(/\/+$/, '');
    path = path.replace(/\/(?:chat\/completions|completions|responses|messages)$/i, '');
    const versioned = /\/(?:v\d+(?:beta|alpha)?|api\/v\d+|openai)$/i.test(path);
    if (!versioned && ['claude', 'claude-desktop', 'gemini', ''].includes(app.toLowerCase())) path = `${path}/v1`;
    url.pathname = path || '/';
    return url.toString().replace(/\/$/, '');
}

export function parseProviderImportLink(value: string): ProviderImportRequest | undefined {
    if (typeof value !== 'string' || value.length > 16_384) return undefined;
    let url: URL;
    try { url = new URL(value); } catch { return undefined; }
    if (url.protocol !== 'nextmux:' || url.hostname !== 'v1' || url.pathname !== '/import') return undefined;
    const params = url.searchParams;
    if (params.get('resource') !== 'provider') return undefined;
    const app = clean(params.get('app'), 40).toLowerCase();
    const rawEndpoints = clean(params.get('endpoint')) || clean(params.get('baseUrl'));
    const endpoints = [...new Set(rawEndpoints.split(',').map(item => compatibleBaseUrl(item, app)).filter((item): item is string => Boolean(item)))].slice(0, 8);
    const models = [...new Set(['model', 'sonnetModel', 'opusModel', 'haikuModel'].map(key => clean(params.get(key), 200)).filter(Boolean))];
    const homepage = clean(params.get('homepage'), 500);
    let safeHomepage: string | undefined;
    try { safeHomepage = homepage && new URL(homepage).protocol === 'https:' ? new URL(homepage).toString() : undefined; } catch { safeHomepage = undefined; }
    const remark = clean(params.get('remark'), 120);
    const sourceName = clean(params.get('name'), 120)
        || clean(params.get('label'), 120)
        || clean(params.get('provider'), 120);
    const resolvedName = remark
        || sourceName
        || (endpoints[0] ? new URL(endpoints[0]).host : 'API');
    return {
        app,
        name: resolvedName,
        ...(remark ? { remark, ...(sourceName ? { sourceName } : {}) } : {}),
        endpoints,
        apiKey: clean(params.get('apiKey'), 8_192),
        models,
        ...(safeHomepage ? { homepage: safeHomepage } : {}),
        ...(clean(params.get('notes'), 500) ? { notes: clean(params.get('notes'), 500) } : {})
    };
}

/** A key shown for checking without revealing it: first 3 and last 4 characters. */
export function maskApiKey(key: string): string {
    const value = key.trim();
    if (!value) return '';
    return value.length <= 10 ? '•'.repeat(value.length) : `${value.slice(0, 3)}${'•'.repeat(6)}${value.slice(-4)}`;
}
