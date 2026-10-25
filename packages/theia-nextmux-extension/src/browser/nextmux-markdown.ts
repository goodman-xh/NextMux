import LinkifyIt from 'linkify-it';

const webLinks = new LinkifyIt({ fuzzyLink: false, fuzzyEmail: false, fuzzyIP: false });

// Theia keys its Markdown cache by this object identity. Sharing it prevents
// unchanged messages and their icons being rebuilt on every widget update.
export const conversationMarkdownOptions = Object.freeze({ supportHtml: false, supportThemeIcons: false, isTrusted: false });

const KNOWN_SITE_NAMES: Readonly<Record<string, string>> = {
    'arxiv.org': 'arXiv',
    'baidu.com': '百度',
    'chatgpt.com': 'ChatGPT',
    'claude.ai': 'Claude',
    'dev.to': 'DEV Community',
    'discord.com': 'Discord',
    'docs.google.com': 'Google Docs',
    'drive.google.com': 'Google Drive',
    'github.com': 'GitHub',
    'gitlab.com': 'GitLab',
    'huggingface.co': 'Hugging Face',
    'linkedin.com': 'LinkedIn',
    'medium.com': 'Medium',
    'modelscope.cn': 'ModelScope',
    'npmjs.com': 'npm',
    'openai.com': 'OpenAI',
    'pypi.org': 'PyPI',
    'reddit.com': 'Reddit',
    'stackoverflow.com': 'Stack Overflow',
    't.me': 'Telegram',
    'wikipedia.org': 'Wikipedia',
    'x.com': 'X',
    'youtube.com': 'YouTube',
    'youtu.be': 'YouTube',
};

const MAX_LINK_URL_LENGTH = 4096;

function httpUrl(value: string): URL | undefined {
    if (!value || value.length > MAX_LINK_URL_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) return undefined;
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        return undefined;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    // A destination containing credentials is left as authored. In particular,
    // never derive a favicon URL from a username/password-bearing destination.
    if (parsed.username || parsed.password || !parsed.hostname) return undefined;
    return parsed;
}

function publicFaviconHost(hostname: string, port: string): boolean {
    if (port || hostname.includes(':') || hostname.startsWith('[') || !hostname.includes('.') || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return false;
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(hostname)) return false;
    if (hostname === '::1' || hostname.startsWith('127.') || hostname.startsWith('10.') || hostname.startsWith('192.168.') || hostname.startsWith('169.254.')) return false;
    const private172 = /^172\.(?:1[6-9]|2\d|3[0-1])\./.test(hostname);
    return !private172 && !/^\d+$/.test(hostname);
}

/** Return a stable site label without performing metadata requests. */
export function siteNameForUrl(value: string): string | undefined {
    const parsed = httpUrl(value);
    if (!parsed) return undefined;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const exact = KNOWN_SITE_NAMES[host];
    if (exact) return exact;
    for (const [knownHost, name] of Object.entries(KNOWN_SITE_NAMES)) {
        if (host.endsWith(`.${knownHost}`)) return name;
    }
    return host;
}

/**
 * Build a same-host favicon URL for public hosts only. The browser may fail
 * to load a site's icon; the enclosing globe remains as the fallback.
 * No server-side URL or metadata fetch is involved.
 */
export function siteIconUrlFor(value: string): string | undefined {
    const parsed = httpUrl(value);
    if (!parsed || !publicFaviconHost(parsed.hostname, parsed.port)) return undefined;
    return `https://${parsed.hostname}/favicon.ico`;
}

/** Local, private, port-bound, or otherwise unpreviewable destinations stay
 * as the full address.  A host name alone is misleading for these links and
 * a favicon request would either fail or leak a local destination. */
export function shouldDisplayRawUrl(value: string): boolean {
    const parsed = httpUrl(value);
    return Boolean(parsed && !publicFaviconHost(parsed.hostname, parsed.port));
}

function normalizeHttpDestination(value: string): string {
    return value.replace(/\\&/g, '&');
}

function linkifiedHttpUrl(value: string): string | undefined {
    let candidate = value;
    // linkify-it can include adjacent CJK prose in an explicit http match.
    // Trim a non-ASCII suffix while the remaining value is still a valid URL;
    // ordinary URL path/query characters (including ASCII letters) remain
    // untouched, and the removed prose is reinserted by the caller.
    while (candidate && /[^\x00-\x7f]$/u.test(candidate)) {
        const trimmed = candidate.slice(0, -1);
        if (!httpUrl(trimmed)) break;
        candidate = trimmed;
    }
    return httpUrl(candidate) ? candidate : undefined;
}

/** Preserve copied Markdown destinations before the existing Theia parser runs. */
export function normalizeConversationMarkdown(value: string): string {
    return value.replace(/(\]\(https?:\/\/[^)\s]+)\)/gi, match => normalizeHttpDestination(match));
}

/** Use Theia's onRender hook: decorate parsed anchors, never reparse Markdown. */
export function decorateConversationLinks(element: HTMLElement | undefined): void {
    if (!element) return;
    // Theia does not linkify bare URLs. Use markdown-it's URL recognizer on
    // rendered text only, leaving code and existing Markdown anchors intact.
    const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
        if (node.parentElement?.closest('a, pre, code, button, textarea, script, style')) continue;
        if (/https?:\/\//i.test(node.textContent || '')) textNodes.push(node as Text);
    }
    for (const text of textNodes) {
        const value = text.data;
        const matches = webLinks.match(value.replace(/[，。；！？、]/g, ' '))
            ?.map(match => ({ match, url: /^https?:$/i.test(match.schema) ? linkifiedHttpUrl(match.url) : undefined }))
            .filter((entry): entry is { match: typeof entry.match; url: string } => Boolean(entry.url));
        if (!matches?.length) continue;
        const fragment = element.ownerDocument.createDocumentFragment();
        let cursor = 0;
        for (const { match, url } of matches) {
            fragment.append(value.slice(cursor, match.index));
            const anchor = element.ownerDocument.createElement('a');
            anchor.href = url;
            anchor.textContent = value.slice(match.index, match.index + url.length);
            fragment.append(anchor);
            cursor = match.index + url.length;
        }
        fragment.append(value.slice(cursor));
        text.replaceWith(fragment);
    }
    for (const anchor of element.querySelectorAll<HTMLAnchorElement>('a[href], a[data-href]')) {
        if (anchor.dataset.nmxSiteLink || anchor.closest('pre, code') || anchor.querySelector('img')) continue;
        const href = anchor.getAttribute('data-href') || anchor.getAttribute('href') || '';
        const name = siteNameForUrl(href);
        if (!name) continue;
        anchor.dataset.nmxSiteLink = 'true';
        const label = anchor.textContent?.trim() || '';
        if (shouldDisplayRawUrl(href)) {
            // Local/IP links are still ordinary clickable anchors, but they
            // must expose the exact address instead of a failed preview label.
            anchor.textContent = href;
        } else if (label === href || httpUrl(label)?.href === httpUrl(href)?.href) anchor.textContent = name;
        if (!anchor.title) anchor.title = href;
        if (shouldDisplayRawUrl(href)) continue;
        const icon = element.ownerDocument.createElement('span');
        icon.className = 'nmx-site-icon';
        icon.setAttribute('aria-hidden', 'true');
        // The fallback globe is drawn by CSS (no emoji glyph): it matches the
        // monochrome UI icons and never ends up in copied text.
        icon.classList.add('is-fallback');
        const iconUrl = siteIconUrlFor(href);
        if (iconUrl) {
            const image = element.ownerDocument.createElement('img');
            image.alt = '';
            image.referrerPolicy = 'no-referrer';
            image.loading = 'lazy';
            image.decoding = 'async';
            image.onload = () => { icon.classList.add('is-loaded'); icon.classList.remove('is-fallback'); };
            image.onerror = () => image.remove();
            image.src = iconUrl;
            icon.appendChild(image);
        }
        anchor.prepend(icon);
    }
}

export type ComposerMarkdownSegment =
    | { readonly kind: 'text'; readonly value: string }
    | { readonly kind: 'link'; readonly label: string; readonly href: string; readonly source: string };

/**
 * Keeps the composer source Markdown-compatible while giving the editor a
 * readable inline representation.  Only HTTP(S) links are promoted; every
 * other character stays literal so pasted code and paths are untouched.
 */
export function composerMarkdownSegments(value: string): ComposerMarkdownSegment[] {
    const segments: ComposerMarkdownSegment[] = [];
    const pattern = /\[((?:`[^`\n]+`|[^\]\n])+)\]\((https?:\/\/[^)\s]+)\)/gi;
    let cursor = 0;
    for (const match of value.matchAll(pattern)) {
        const index = match.index ?? -1;
        if (index < cursor) continue;
        if (index > cursor) segments.push({ kind: 'text', value: value.slice(cursor, index) });
        const label = match[1] || '';
        const href = normalizeHttpDestination(match[2] || '');
        segments.push({ kind: 'link', label, href, source: match[0] });
        cursor = index + match[0].length;
    }
    if (cursor < value.length) segments.push({ kind: 'text', value: value.slice(cursor) });
    return segments.length ? segments : [{ kind: 'text', value }];
}

/** Remove one complete Markdown link when Backspace/Delete is pressed next to it. */
export function removeAdjacentComposerLink(value: string, start: number, end: number, direction: 'backward' | 'forward'): { value: string; caret: number } | undefined {
    const pattern = /\[((?:`[^`\n]+`|[^\]\n])+)\]\((https?:\/\/[^)\s]+)\)/gi;
    for (const match of value.matchAll(pattern)) {
        const index = match.index ?? -1;
        const finish = index + match[0].length;
        // The textarea keeps the Markdown source while the overlay shows only
        // the label.  A visual caret can therefore land anywhere inside the
        // hidden destination. Treat a deletion touching any part of that
        // source link as deletion of the one visible link token.
        const touchesSelection = start !== end && end > index && start < finish;
        const touchesCaret = start === end && start >= index && start <= finish
            && (direction === 'backward' ? start > index : start < finish);
        if (touchesSelection || touchesCaret || direction === 'backward' && finish === start || direction === 'forward' && index === start) {
            return { value: value.slice(0, index) + value.slice(finish), caret: index };
        }
    }
    return undefined;
}
