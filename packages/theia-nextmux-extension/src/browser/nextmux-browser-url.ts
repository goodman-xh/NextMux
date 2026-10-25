const DRAWIO_EDITOR = /^https:\/\/app\.diagrams\.net\/(?:\?[^#]*)?#/i;
const DRAWIO_URL_LIMIT = 200_000;

/**
 * Normalize a user- or tool-provided browser address without changing its
 * structured query data.  Browser navigation is deliberately limited to
 * HTTP(S); file and executable schemes must go through the separate file/link
 * policy instead of reaching an Electron webview.
 *
 * Addresses stay under 2,000 characters, except draw.io's editor, whose
 * diagrams travel in the #fragment (never sent to a server) and can be long.
 */
export function normalizeSafeBrowserUrl(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    const limit = DRAWIO_EDITOR.test(trimmed) ? DRAWIO_URL_LIMIT : 2_000;
    if (!trimmed || trimmed.length > limit || /[\u0000-\u001f\u007f]/.test(trimmed)) return undefined;
    const explicitHttp = /^https?:\/\//i.test(trimmed);
    const localHost = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(trimmed);
    const explicitNonHttpScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
        || /^(?:javascript|data|file|blob|about|vbscript):/i.test(trimmed);
    if (explicitNonHttpScheme && !explicitHttp) return undefined;
    const candidate = explicitHttp ? trimmed : localHost ? `http://${trimmed}` : `https://${trimmed}`;
    try {
        const url = new URL(candidate);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
        if (url.username || url.password || !url.hostname) return undefined;
        const normalized = url.toString();
        return normalized.length <= (url.origin === 'https://app.diagrams.net' && url.pathname === '/' ? limit : 2_000) ? normalized : undefined;
    } catch {
        return undefined;
    }
}
