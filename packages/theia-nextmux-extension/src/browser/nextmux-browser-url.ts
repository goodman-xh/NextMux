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

// Loopback and private-network development hosts: typed without a scheme they are opened over plain HTTP, the way
// dev servers (Vite, Next, Python) print them.
const LOCAL_DEVELOPMENT_HOST = /^(?:localhost|[a-z0-9-]+\.localhost|(?:[a-z0-9-]+\.)+local|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\]|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?::\d{1,5})?(?:[/?#]|$)/i;
// A host, host:port or address the user typed as a location: domain labels (any script) with a letter TLD, a single
// label with a port, an IPv4 address or a bracketed IPv6 address.
const TYPED_LOCATION = /^(?:(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+\p{L}[\p{L}\p{N}-]*(?::\d{1,5})?|[\p{L}\p{N}-]+:\d{1,5}|\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?|\[[0-9a-f:.]+\](?::\d{1,5})?)(?:[/?#]|$)/iu;
// A bare "name.ext" that is a file name, not a site ("next.config.js", "README.md"): searched, as browsers do.
const FILE_NAME_SUFFIX = /\.(?:js|jsx|ts|tsx|mjs|cjs|json|ya?ml|toml|txt|log|lock|css|scss|less|html?|vue|svelte|java|kt|cpp|hpp|swift|php|sql|png|jpe?g|gif|svg|pdf|exe|dll|tar|gz|py|md)$/i;
const BLOCKED_SCHEME = /^(?:javascript|data|file|blob|about|vbscript|chrome|chrome-extension|devtools|view-source|filesystem|ws|wss|ftp|mailto|tel|sms):/i;

/**
 * What the address bar opens for what the user typed: an HTTP(S) address as is, a development host over HTTP
 * (0.0.0.0, which Chromium cannot open, becomes localhost), a domain or host:port over HTTPS, and anything else as a
 * web search (Bing for Chinese, where Google is often unreachable). Other schemes are refused; empty input opens
 * nothing. normalizeSafeBrowserUrl stays the strict normalizer for tools and links.
 */
export function normalizeUserBrowserInput(value: unknown, locale = 'en'): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return undefined;
    if (/^https?:\/\//i.test(trimmed)) return normalizeSafeBrowserUrl(trimmed.replace(/^(https?:\/\/)0\.0\.0\.0(?=[:/?#]|$)/i, '$1localhost'));
    if (BLOCKED_SCHEME.test(trimmed) || /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)) return undefined;
    // "scheme:" followed by anything but a port number is a scheme this browser does not open (git:, ssh:, ...).
    const scheme = /^([a-z][a-z\d+.-]*):(?!\d)/i.exec(trimmed);
    if (scheme && !/\./.test(scheme[1]) && !/\s/.test(trimmed)) return undefined;
    if (LOCAL_DEVELOPMENT_HOST.test(trimmed)) return normalizeSafeBrowserUrl(`http://${trimmed.replace(/^0\.0\.0\.0(?=[:/?#]|$)/, 'localhost')}`);
    if (!/\s/.test(trimmed) && TYPED_LOCATION.test(trimmed) && !(FILE_NAME_SUFFIX.test(trimmed) && !/[/:?#]/.test(trimmed))) {
        return normalizeSafeBrowserUrl(trimmed);
    }
    const query = encodeURIComponent(trimmed.slice(0, 500));
    return /^zh/i.test(locale) ? `https://www.bing.com/search?q=${query}` : `https://www.google.com/search?q=${query}`;
}
