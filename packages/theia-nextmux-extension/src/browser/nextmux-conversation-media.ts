/**
 * Local media and file references inside rendered conversation Markdown.
 *
 * A reply (or a sent prompt) may point at project files: `![](out/chart.png)`,
 * `[demo](build/demo.mp4)`, `[config](src/config.ts#L12)` or an absolute path.
 * After rendering, this module resolves each local target against the
 * conversation's project, shows images inline, and turns every local link
 * into a file chip whose tooltip is the full path. Clicks are handled by the
 * widget: images and videos open in the viewer, other files in the file drawer.
 * A clip written as a picture (`![](out/demo.mp4)`) or a `<video>` tag becomes a
 * video card in its place; a link to a clip keeps its chip and gets a card under
 * its paragraph (nextmux-video-card.ts).
 */

import { createVideoCard, isLoadableVideoUrl, isNetworkFileUrl, isVideoDataUrl } from './nextmux-video-card';

export type ConversationMediaKind = 'image' | 'video' | 'audio' | 'file';

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg', 'ico', 'apng']);
const VIDEO = new Set(['mp4', 'm4v', 'webm', 'mov', 'ogv', 'mkv']);
const AUDIO = new Set(['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus']);

export function conversationMediaKind(path: string): ConversationMediaKind {
    const clean = path.replace(/[?#].*$/, '');
    const extension = clean.includes('.') ? clean.slice(clean.lastIndexOf('.') + 1).toLowerCase() : '';
    if (IMAGE.has(extension)) return 'image';
    if (VIDEO.has(extension)) return 'video';
    if (AUDIO.has(extension)) return 'audio';
    return 'file';
}

/** A clip by its name (`demo.mp4`, `https://…/clip.webm?sig=…`) or carried in the reply (`data:video/mp4;base64,…`). */
export function isVideoTarget(target: string): boolean {
    const value = target.trim();
    if (/^data:/i.test(value)) return isVideoDataUrl(value);
    return conversationMediaKind(value) === 'video';
}

/** True for targets that point at the local file system rather than the web. */
export function isLocalConversationTarget(target: string): boolean {
    const value = target.trim();
    if (!value || value.startsWith('#') || /[\u0000-\u001f\u007f]/.test(value)) return false;
    if (/^[a-z]:(?:[\\/]|%5c|%2f)/i.test(value) || /^file:/i.test(value)) return true;
    const colon = value.indexOf(':');
    if (colon <= 0) return true;
    const candidate = value.slice(0, colon).replace(/[\u0000-\u0020]/g, '').toLowerCase();
    return !/^[a-z][a-z\d+.-]*$/.test(candidate);
}

/**
 * The directory a path pill shows: its last folder behind an ellipsis, in the path's own separator
 * (C:/Users/me/.cache/node/bin/ → …/bin/). A short single folder (src/, /tmp/) stays whole; a last folder
 * longer than 14 characters leaves only …/. The pill's title and data-path keep the full path.
 */
export function compactDirectoryPrefix(directory: string): string {
    const segments = directory.split(/[\\/]+/).filter(Boolean);
    if (segments.length <= 1 && directory.length <= 16) return directory;
    const separator = /[\\/]$/.exec(directory)?.[0] ?? (directory.includes('\\') && !directory.includes('/') ? '\\' : '/');
    const parent = segments.at(-1) ?? '';
    return parent && parent.length <= 14 ? `…${separator}${parent}${separator}` : `…${separator}`;
}

/** Shared markdown/DOM path markup: the compact directory, then the whole basename. */
export function filePathPillHtml(target: string, fullPath = target): string {
    const escape = (value: string): string => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
    const label = fullPath.replace(/#L\d+(?:-L?\d+)?$/i, '').replace(/[\\/]+$/, '');
    const separator = Math.max(label.lastIndexOf('/'), label.lastIndexOf('\\'));
    const directory = separator >= 0 ? label.slice(0, separator + 1) : '';
    const name = label.slice(separator + 1) || fullPath;
    return `<span class="nmx-file-path-pill" role="link" tabindex="0" title="${escape(fullPath)}" data-path="${escape(fullPath)}" data-href="${escape(target)}">`
        + (directory ? `<span class="nmx-file-path-dir"><span>${escape(compactDirectoryPrefix(directory))}</span></span>` : '')
        + `<span class="nmx-file-path-name"><span>${escape(name)}</span></span></span>`;
}

export interface ResolvedConversationTarget {
    /** Absolute file-system path, shown on hover. */
    readonly path: string;
    /** URL the renderer can load (file:// for local files). */
    readonly url: string;
}

// Inline paths may include a recognized bare filename. Runtime names (`node.js`) and versions stay plain code. Inline code
// and quotes have their own edges, so an absolute path under a user folder or a drive may hold spaces (`/Users/me/My Project/a.ts`,
// `C:\\Program Files\\My App`, `C:\\a.ts`); a command (`/usr/bin/env node a.js`, `/Users/me/project --flag`) stays code.
const EXTENSION = String.raw`\.(?=[a-z0-9]*[a-z])[a-z0-9]{1,8}`;
const USER_ROOT = String.raw`(?:\/(?:Users|home|Volumes|tmp|private|var|opt|etc|mnt|srv|data)\/|[a-z]:[\\/])`;
// Words of a name under such a root are joined by spaces. A word after a space is never a command option: `--anything`, a short
// `-x`/`-xy`/`-1` that ends the path or takes `=`, or a `-word` that more words follow (`java -jar app.jar`). Name suffixes stay
// (`最终修补 -zhengshi`, `最终修补 -获取加密`, `report - Copy.txt`, `Final Patch -v2`). Spaces and separators delimit the words,
// so a deep path never backtracks across them.
const OPTION = String.raw`-(?:-|[a-z0-9][^\s\\/]*(?= )|(?:[a-z]{1,2}|\d)(?:=|$))`;
const SPACED_NAME = String.raw`[^\\/\s"<>\`|*?:]+(?: +(?!${OPTION})[^\\/\s"<>\`|*?:]+)*`;
// Extensionless directories need at least two segments and a known absolute root; relative prose stays untouched.
const USER_DIRECTORY_PATH = String.raw`(?=${USER_ROOT})(?:[a-z]:)?(?:[\\/]${SPACED_NAME}){2,}[\\/]?`;
const TEXT_DIRECTORY_PATH = String.raw`(?=${USER_ROOT})(?:[a-z]:)?(?:[\\/][^\\/\s"'<>\`|*?:，。；、）)\]]+?){2,}?[\\/]?`;
const CODE_PATH = new RegExp(String.raw`^(?:${USER_DIRECTORY_PATH}|(?:(?:\.{1,2}\/|\/|[a-z]:[\\/])?(?:[^\s\`'"<>|*?:\\/]+[\\/])+[^\s\`'"<>|*?:\\/]+`
    + String.raw`|${USER_ROOT}(?:${SPACED_NAME}[\\/])*${SPACED_NAME})${EXTENSION}(?::\d{1,6}(?::\d{1,6})?)?)$`, 'i');
// An absolute path written in plain text ("已保存到 /Users/me/Movies/demo.mp4", "C:/work/a.txt"). The colon of a drive letter
// is not a start, so `C:/Users/…` links whole instead of from `/Users/`.
const TEXT_PATH = new RegExp(String.raw`(^|[\s(（“"'：]|(?<![a-z]):)(${USER_ROOT}[^\s<>"'\`，。；、）)\]]+?${EXTENSION}|${TEXT_DIRECTORY_PATH})(?=$|[\s,;!?，。；：！？、）)\]"']|\.(?:\s|$))`, 'gi');
// A quote that opens on an absolute root closes at a quote of its own kind on the same line, and everything between is the
// candidate ("F:\\修补\\最终修补 -zhengshi", 「C:\\Program Files\\My App」, "/Users/me/it's here/a.txt"), as Explorer's “Copy as
// path” writes it. Each body stops at the next quote of its kind, so the scan stays linear.
const QUOTED_PATH = new RegExp(String.raw`(?<=["“])${USER_ROOT}[^"“”\n]*(?=["”])|(?<=['‘])${USER_ROOT}[^'‘’\n]*(?=['’])`
    + String.raw`|(?<=「)${USER_ROOT}[^「」\n]*(?=」)|(?<=『)${USER_ROOT}[^『』\n]*(?=』)`, 'gi');

/** `src/app.ts:42` → `src/app.ts#L42`, the form file links already use. */
function pathTarget(value: string): string {
    const line = /^(.*?):(\d{1,6})(?::\d{1,6})?$/.exec(value);
    return line && !/^[a-z]$/i.test(line[1]) ? `${line[1]}#L${line[2]}` : value;
}

// Bare names are deliberately allowlisted: prose domains and runtime names are not local-file evidence.
const BARE_FILE_EXTENSIONS = new Set([
    'sqlite', 'db', 'sqlite3', 'csv', 'tsv', 'json', 'jsonl', 'md', 'markdown', 'txt', 'log', 'pdf',
    'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'png', 'jpg', 'jpeg', 'webp', 'svg', 'gif', 'bmp',
    'avif', 'ico', 'wav', 'mp3', 'ogg', 'm4a', 'aac', 'flac', 'mp4', 'webm', 'mov', 'mkv',
    'py', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'html', 'htm', 'css', 'scss', 'less', 'sql',
    'yaml', 'yml', 'toml', 'xml', 'ini', 'env', 'sh', 'bat', 'ps1', 'zip', 'tar', 'gz', '7z',
    'rs', 'go', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'rb', 'php', 'vue', 'svelte',
    ...IMAGE, ...VIDEO, ...AUDIO
]);
const RUNTIME_NAMES = new Set(['node.js', 'next.js', 'vue.js', 'react.js', 'three.js', 'chart.js',
    'd3.js', 'express.js', 'nw.js', 'electron.js']);
const DOMAIN_EXTENSIONS = new Set(['com', 'org', 'net', 'io', 'dev', 'ai', 'app', 'cn', 'co', 'edu', 'gov', 'uk', 'de', 'jp', 'fr']);
const BOUNDED_PATH = new RegExp(String.raw`(^|[\s(（\[{"'\`“「『|=：])([^\s\`"'“”「」『』<>|*?=，。；、）)\]{}]*?${EXTENSION}(?::\d{1,6}(?::\d{1,6})?)?(?:#L\d+(?:-L?\d+)?)?)(?=$|[\s,;!?，。；：！？、）)\]{}"'\`”」』|]|\.(?:\s|$))`, 'gi');

// A last name with spaces is a command line or a sentence, not a name, when it sits right inside a bin folder
// (`.venv/bin/python manage.py migrate`) or a word before its last is a file name (`a.txt is missing`).
function spacedNameIsCommandOrProse(path: string): boolean {
    const segments = path.replace(/[\\/]+$/, '').split(/[\\/]/);
    const words = segments[segments.length - 1].split(/ +/);
    if (words.length < 2) return false;
    if (/^(?:\.?bin|scripts)$/i.test(segments[segments.length - 2] || '')) return true;
    return words.slice(0, -1).some(word => {
        const lower = word.toLowerCase();
        const extension = /\.([a-z0-9]{1,8})$/.exec(lower)?.[1] || '';
        return (BARE_FILE_EXTENSIONS.has(extension) || extension === 'exe') && !RUNTIME_NAMES.has(lower);
    });
}

/** Recognize local paths and known bare filenames without treating domains/commands as files. */
export function isValidLocalFileLinkCandidate(raw: string): boolean {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length > 4096) return false;
    const value = trimmed.replace(/(?:#L\d+(?:-L?\d+)?|:\d{1,6}(?::\d{1,6})?)$/i, '');
    if (value.startsWith('//') || !isLocalConversationTarget(value)) return false;
    if (/[\\/]/.test(value)) return CODE_PATH.test(value) && !spacedNameIsCommandOrProse(value);
    if (/[\s\`'"<>|*?:#@=]/.test(value) || /^v?\d+(?:\.\d+)+(?:[-+][\w.-]+)?$/i.test(value)) return false;
    const lower = value.toLowerCase();
    const extension = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
    return !RUNTIME_NAMES.has(lower) && !DOMAIN_EXTENSIONS.has(extension) && BARE_FILE_EXTENSIONS.has(extension);
}

export function normalizeLocalFileLinkTarget(raw: string): string | undefined {
    const trimmed = raw.trim();
    return isValidLocalFileLinkCandidate(trimmed) ? pathTarget(trimmed.replace(/[\\/]+$/, '')) : undefined;
}

export interface LocalFileLinkCandidate {
    readonly start: number;
    readonly end: number;
    readonly target: string;
}

/** The same bounded scanner serves rendered text and persisted tool command/output evidence. */
export function findLocalFileLinkCandidatesInText(text: string): LocalFileLinkCandidate[] {
    const found: LocalFileLinkCandidate[] = [];
    // A quoted path links whole. When the whole is no path, neither is its part before a space:
    // `"F:\\修补\\最终修补 -x --y"` must not link `F:\\修补\\最终修补`.
    const quotedStarts = new Set<number>();
    QUOTED_PATH.lastIndex = 0;
    for (let match = QUOTED_PATH.exec(text); match; match = QUOTED_PATH.exec(text)) {
        // Spaces and sentence punctuation typed before the closing quote end the sentence, not the path.
        let length = match[0].length;
        while (length && /[\s.,;!?。，；！？、]/.test(match[0][length - 1])) length--;
        const path = match[0].slice(0, length);
        const target = normalizeLocalFileLinkTarget(path);
        if (target) found.push({ start: match.index, end: match.index + path.length, target });
        else quotedStarts.add(match.index);
    }
    for (const pattern of [TEXT_PATH, BOUNDED_PATH]) {
        pattern.lastIndex = 0;
        for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
            const target = normalizeLocalFileLinkTarget(match[2]);
            if (!target) continue;
            const start = match.index + match[1].length;
            const end = start + match[2].length;
            if (quotedStarts.has(start) && /\s/.test(text.charAt(end))) continue;
            if (found.some(candidate => start < candidate.end && end > candidate.start)) continue;
            found.push({ start, end, target });
        }
    }
    return found.sort((left, right) => left.start - right.start);
}

/** Turn implicit file mentions into links, keeping code blocks and existing links untouched. */
function linkLocalPaths(element: HTMLElement, canLink: (target: string) => boolean): void {
    const document = element.ownerDocument;
    for (const code of element.querySelectorAll<HTMLElement>('code')) {
        if (code.dataset.nmxPathChecked || code.closest('pre, a')) continue;
        const text = (code.textContent || '').trim();
        const target = normalizeLocalFileLinkTarget(text);
        if (!target || !canLink(target)) continue;
        code.dataset.nmxPathChecked = 'true';
        const anchor = document.createElement('a');
        anchor.setAttribute('data-href', target);
        anchor.setAttribute('href', '#');
        code.replaceWith(anchor);
        anchor.append(code);
    }
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
        acceptNode: node => node.parentElement?.closest('pre, code, a, .nmx-file-path-pill, button, textarea, [contenteditable]') || !/[.\\/]/.test(node.nodeValue || '')
            ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    const texts: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node as Text);
    for (const text of texts) {
        const value = text.nodeValue || '';
        const candidates = findLocalFileLinkCandidatesInText(value).filter(candidate => canLink(candidate.target));
        if (!candidates.length) continue;
        const fragment = document.createDocumentFragment();
        let cursor = 0;
        for (const candidate of candidates) {
            fragment.append(value.slice(cursor, candidate.start));
            const anchor = document.createElement('a');
            anchor.setAttribute('data-href', candidate.target);
            anchor.setAttribute('href', '#');
            anchor.textContent = value.slice(candidate.start, candidate.end);
            fragment.append(anchor);
            cursor = candidate.end;
        }
        fragment.append(value.slice(cursor));
        text.replaceWith(fragment);
    }
}

export function compactFileLinkLabel(rawText: string): string {
    // Keep the exported name for callers, but leave shortening to the CSS
    // leading-edge fade so the real trailing segments and copied text survive.
    return rawText.replace(/\\/g, '/').replace(/(\/[^/]+)\/+$/, '$1');
}

export interface ConversationMediaOptions {
    /** The reader's language, for the video cards' labels. */
    readonly locale?: string;
    /**
     * Whether a picture on a file server (`file://server/share/…`) may load without a click. Never by default: loading
     * one lets Windows sign in to that server on its own. The widget allows those inside the conversation's own roots.
     * Clips on a file server never load by themselves; their chip opens them on a click, which asks first.
     */
    readonly allowNetworkFile?: (resolved: ResolvedConversationTarget) => boolean;
}

/** Link previews a message shows at most; clips written into the reply itself always show. */
const VIDEO_PREVIEWS = 4;

/** The last name of a path or web address (`clip.mp4` of `https://…/clip.mp4?sig=…`). */
function clipName(value: string, web: boolean): string {
    const clean = value.replace(/[?#].*$/, '').replace(/[\\/]+$/, '');
    const name = clean.slice(Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\')) + 1);
    if (!web) return name;
    try { return decodeURIComponent(name); } catch { return name; }
}

interface ConversationClip { readonly url: string; readonly path?: string; readonly name: string }

/** What a card plays for a target: a web address, a clip carried in the reply, or a file on this computer. */
function conversationClip(target: string, resolve: (target: string) => ResolvedConversationTarget | undefined): ConversationClip | undefined {
    const value = target.trim();
    if (!value) return undefined;
    if (/^(?:https?|blob|data):/i.test(value)) {
        if (!isLoadableVideoUrl(value)) return undefined;
        const web = /^https?:/i.test(value);
        return web ? { url: value, path: value, name: clipName(value, true) } : { url: value, name: '' };
    }
    if (!isLocalConversationTarget(value)) return undefined;
    const resolved = resolve(value);
    return resolved && isLoadableVideoUrl(resolved.url) ? { url: resolved.url, path: resolved.path, name: clipName(resolved.path, false) } : undefined;
}

/** A poster the reply gave a clip: a picture on the web, carried in the reply, or on this computer. */
function conversationPoster(target: string, resolve: (target: string) => ResolvedConversationTarget | undefined): string | undefined {
    const value = target.trim();
    if (!value) return undefined;
    if (/^https?:\/\/[^\s]+$/i.test(value) || /^data:image\/(?:png|jpeg|webp|gif);/i.test(value)) return value;
    if (!isLocalConversationTarget(value) || conversationMediaKind(value) !== 'image') return undefined;
    const resolved = resolve(value);
    return resolved && /^file:\/\/\//i.test(resolved.url) ? resolved.url : undefined;
}

/**
 * Decorate local images and file links in a rendered Markdown host.
 * `resolve` maps a raw target to a path/URL, or undefined when unresolvable.
 */
export function decorateConversationMedia(element: HTMLElement | undefined, resolve: (target: string) => ResolvedConversationTarget | undefined,
    classifyLocalFile?: (target: string) => ConversationMediaKind | undefined, options: ConversationMediaOptions = {}): void {
    if (!element) return;
    const document = element.ownerDocument;
    const locale = options.locale || 'en';
    linkLocalPaths(element, target => /[\\/]/.test(target) || Boolean(classifyLocalFile ? classifyLocalFile(target) : resolve(target)));
    for (const image of element.querySelectorAll<HTMLImageElement>('img[data-nmx-local-src]')) {
        if (image.dataset.nmxMediaReady) continue;
        const resolved = resolve(image.dataset.nmxLocalSrc || '');
        image.dataset.nmxMediaReady = 'true';
        if (!resolved) { image.classList.add('is-missing'); continue; }
        image.dataset.nmxPath = resolved.path;
        image.title = resolved.path;
        // A picture on a file server waits for a click (which asks first) instead of loading by itself.
        if (isNetworkFileUrl(resolved.url) && options.allowNetworkFile?.(resolved) !== true) { image.classList.add('is-missing'); continue; }
        image.src = resolved.url;
        image.addEventListener('error', () => image.classList.add('is-missing'), { once: true });
    }
    for (const image of element.querySelectorAll<HTMLImageElement>('img:not([data-nmx-local-src])')) {
        if (!image.title && image.src && !image.closest('.nmx-site-icon')) image.title = image.getAttribute('src') || '';
    }
    // A clip written as a picture or a <video> tag: a card in its place. One the card may not load by itself (a file
    // server, a path no project resolves) stays a path chip, so its click opens it the way any file link does.
    const shown = new Set<string>();
    for (const placeholder of element.querySelectorAll<HTMLElement>('span.nmx-md-video[data-nmx-video]')) {
        const source = (placeholder.getAttribute('data-nmx-video') || '').trim();
        const label = (placeholder.getAttribute('data-nmx-video-label') || '').trim();
        const clip = conversationClip(source, resolve);
        if (!clip) {
            if (isLocalConversationTarget(source) && !/^(?:blob|data):/i.test(source)) {
                const host = document.createElement('span');
                host.innerHTML = filePathPillHtml(source);
                placeholder.replaceWith(host.firstElementChild as HTMLElement);
            } else placeholder.replaceWith(label || source);
            continue;
        }
        shown.add(clip.url);
        const poster = conversationPoster(placeholder.getAttribute('data-nmx-video-poster') || '', resolve);
        placeholder.replaceWith(createVideoCard(document, { url: clip.url, ...(clip.path ? { path: clip.path } : {}), ...(poster ? { poster } : {}),
            label: label || clip.name, locale }));
    }
    for (const anchor of element.querySelectorAll<HTMLElement>('a[data-href], .nmx-file-path-pill[data-href]')) {
        if (anchor.dataset.nmxFileLink || anchor.closest('pre') || anchor.querySelector('img')) continue;
        const target = anchor.getAttribute('data-href') || '';
        if (!isLocalConversationTarget(target)) continue;
        const resolved = resolve(target);
        const fullPath = resolved?.path || target;
        const host = element.ownerDocument.createElement('span');
        host.innerHTML = filePathPillHtml(target, fullPath);
        const pill = host.firstElementChild as HTMLElement;
        pill.dataset.nmxFileLink = conversationMediaKind(target);
        pill.dataset.nmxPath = fullPath;
        pill.dataset.nmxFileTarget = target;
        pill.dataset.nmxLabel = anchor.textContent?.trim() || fullPath;
        // Existing link classes remain available to integrations while every
        // path uses the same two-part structure and keyboard semantics.
        if (anchor.classList.contains('nmx-file-link')) pill.classList.add('nmx-file-link');
        anchor.replaceWith(pill);
    }
    // A link to a clip (a path chip, a web address, a clip carried in the reply) keeps its place in the sentence and
    // gets a card under its paragraph, as chat apps unfurl a link. Code, tables, headings and thinking never do; a
    // clip that cannot be shown takes its card away again (the link stays).
    let previews = 0;
    const lastCard = new Map<Element, Element>();
    for (const link of element.querySelectorAll<HTMLElement>('.nmx-file-path-pill[data-nmx-file-link], a[href], a[data-href]')) {
        if (previews >= VIDEO_PREVIEWS) break;
        if (link.querySelector('img') || link.closest('pre, code, td, th, h1, h2, h3, h4, h5, h6, .nmx-md-think, .nmx-video-card')) continue;
        const pillKind = link.dataset.nmxFileLink;
        const target = pillKind !== undefined ? pillKind === 'video' ? link.dataset.nmxFileTarget || link.getAttribute('data-href') || '' : ''
            : link.getAttribute('data-href') || link.getAttribute('href') || '';
        if (!target || pillKind === undefined && (!/^(?:https?|data):/i.test(target) || !isVideoTarget(target))) continue;
        const clip = conversationClip(target, resolve);
        const block = link.closest('p, li');
        if (!clip || !block || shown.has(clip.url)) continue;
        shown.add(clip.url);
        previews++;
        let card: HTMLElement | undefined;
        let gone = false;
        card = createVideoCard(document, { url: clip.url, ...(clip.path ? { path: clip.path } : {}), preview: true, locale,
            label: clip.name || link.textContent?.trim() || '', onUnavailable: () => { if (card) card.remove(); else gone = true; } });
        if (gone) continue;
        if (block.tagName === 'LI') block.append(card);
        else {
            (lastCard.get(block) || block).after(card);
            lastCard.set(block, card);
        }
    }
}
