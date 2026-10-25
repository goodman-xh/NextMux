import * as React from 'react';
import markdownit = require('@theia/core/shared/markdown-it');
import markdownitEmoji = require('@theia/core/shared/markdown-it-emoji');
import DOMPurify = require('@theia/core/shared/dompurify');
import { filePathPillHtml, isLocalConversationTarget, normalizeLocalFileLinkTarget } from './nextmux-conversation-media';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { markdownText } from './nextmux-markdown-locale';
import { markdownMath } from './nextmux-markdown-math';

/**
 * Conversation Markdown (assistant replies and sent prompts).
 *
 * Theia's core renderer is built for UI labels: it turns every `$(name)` in
 * prose into a codicon and emits text tokens without HTML escaping, so a reply
 * that mentions `$(pwd)` or `Promise<void>` loses that text. Replies therefore
 * use their own markdown-it instance (the same library, re-exported by
 * @theia/core) with raw HTML disabled, then DOMPurify as a second boundary.
 *
 * Behaviour copied from open-source chat UIs:
 * - OpenCode session UI (MIT, packages/ui/src/components/markdown.tsx):
 *   fenced code gets a header with the language and a copy button that flips
 *   to “Copied”; tables scroll inside their own frame.
 * - markdown-it-task-lists (ISC, revin/markdown-it-task-lists): `- [ ]` and
 *   `- [x]` list items render as disabled checkboxes.
 * - GitHub Primer syntax colours (MIT, primer/primitives) for code tokens.
 * Rendering happens in a layout effect so a streamed block never paints empty.
 */

/** One Monaco-style token line: `offset` is the token start, `type` e.g. `keyword.ts`. */
export type CodeTokenLine = readonly { readonly offset: number; readonly type: string }[];
export type CodeTokenizer = (code: string, languageId: string) => readonly CodeTokenLine[] | undefined;

const LANGUAGE_IDS: Readonly<Record<string, string>> = {
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', javascript: 'javascript', node: 'javascript',
    ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript', typescript: 'typescript',
    py: 'python', python: 'python', python3: 'python', rs: 'rust', rust: 'rust', go: 'go', golang: 'go',
    java: 'java', kt: 'kotlin', kts: 'kotlin', kotlin: 'kotlin', c: 'c', h: 'c',
    cpp: 'cpp', 'c++': 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', cs: 'csharp', csharp: 'csharp', 'c#': 'csharp',
    rb: 'ruby', ruby: 'ruby', php: 'php', swift: 'swift',
    sh: 'shell', bash: 'shell', zsh: 'shell', shell: 'shell', shellscript: 'shell', console: 'shell', 'shell-session': 'shell', terminal: 'shell',
    ps1: 'powershell', powershell: 'powershell', pwsh: 'powershell', sql: 'sql', graphql: 'graphql', gql: 'graphql',
    dockerfile: 'dockerfile', docker: 'dockerfile', json: 'json', jsonc: 'json', json5: 'json',
    html: 'html', htm: 'html', vue: 'html', svelte: 'html', xml: 'xml', svg: 'xml',
    css: 'css', scss: 'scss', less: 'less', yaml: 'yaml', yml: 'yaml', md: 'markdown', markdown: 'markdown', mdx: 'markdown',
    toml: 'ini', ini: 'ini', mermaid: 'mermaid', mmd: 'mermaid'
};

const LANGUAGE_LABELS: Readonly<Record<string, string>> = {
    javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python', rust: 'Rust', go: 'Go', java: 'Java', kotlin: 'Kotlin',
    c: 'C', cpp: 'C++', csharp: 'C#', ruby: 'Ruby', php: 'PHP', swift: 'Swift', shell: 'Shell', powershell: 'PowerShell',
    sql: 'SQL', graphql: 'GraphQL', dockerfile: 'Dockerfile', json: 'JSON', html: 'HTML', xml: 'XML', css: 'CSS', scss: 'SCSS',
    less: 'Less', yaml: 'YAML', markdown: 'Markdown', mermaid: 'Mermaid', diff: 'Diff'
};

/** Normalized fence info → Monaco language id (or `diff`). */
export function codeLanguageId(info: string): string | undefined {
    const name = info.trim().split(/[\s{]/, 1)[0].toLowerCase().replace(/^language-/, '');
    if (!name) return undefined;
    if (name === 'diff' || name === 'patch') return 'diff';
    return LANGUAGE_IDS[name];
}

/** Extract an optional filename or title from fence metadata (e.g. `ts src/index.ts` or `ts title="src/index.ts"`). */
export function codeFenceTitle(info: string): string | undefined {
    const trimmed = info.trim();
    const firstSpace = trimmed.search(/[\s{]/);
    if (firstSpace < 0) return undefined;
    const rest = trimmed.slice(firstSpace).trim();
    if (!rest) return undefined;
    const attrMatch = /(?:^|\s)(?:title|file|filename|path)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s}]+))/i.exec(rest);
    if (attrMatch) {
        const value = (attrMatch[1] || attrMatch[2] || attrMatch[3] || '').trim();
        return value ? value.slice(0, 80) : undefined;
    }
    const token = rest.replace(/^\{|\}$/g, '').trim().split(/\s+/)[0] || '';
    if (token && !token.includes('=') && /^[A-Za-z0-9_./\\-]+(?:\.[A-Za-z0-9_-]+)+$/.test(token)) {
        return token.slice(0, 80);
    }
    return undefined;
}

/** Human label for a fence: known languages get their proper name; others are shown as written. */
export function codeLanguageLabel(info: string): string {
    const raw = info.trim().split(/[\s{]/, 1)[0].replace(/^language-/, '');
    const id = codeLanguageId(raw);
    const base = raw.toLowerCase() === 'toml' ? 'TOML'
        : raw.toLowerCase() === 'ini' ? 'INI'
        : (id && LANGUAGE_LABELS[id]) || raw.slice(0, 32);
    const title = codeFenceTitle(info);
    return title && title !== base ? (base ? `${base} · ${title}` : title) : base;
}

const TOKEN_CLASSES: readonly (readonly [RegExp, string])[] = [
    [/^comment/, 'comment'], [/^(?:string\.escape|regexp)/, 'escape'], [/^(?:string|attribute\.value)/, 'string'],
    [/^keyword/, 'keyword'], [/^number/, 'number'], [/^type/, 'type'], [/^(?:annotation|metatag|meta)/, 'meta'],
    [/^(?:key|attribute\.name|variable)/, 'property'], [/^tag/, 'tag'], [/^function/, 'function']
];

function tokenClass(type: string): string | undefined {
    for (const [pattern, name] of TOKEN_CLASSES) if (pattern.test(type)) return name;
    return undefined;
}

const HTML_ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, character => HTML_ESCAPES[character]);
}

const MAX_HIGHLIGHT_CHARS = 60_000;
const MAX_HIGHLIGHT_LINES = 2_000;

/** Highlight fenced code to escaped HTML; falls back to plain escaped text. */
export function highlightCode(code: string, info: string, tokenizer: CodeTokenizer | undefined): string {
    const languageId = codeLanguageId(info);
    if (!languageId || code.length > MAX_HIGHLIGHT_CHARS) return escapeHtml(code);
    const lines = code.split('\n');
    if (lines.length > MAX_HIGHLIGHT_LINES) return escapeHtml(code);
    if (languageId === 'diff') {
        return lines.map(line => {
            const kind = /^(?:\+\+\+|---)(?:\s|$)/.test(line) ? 'meta' : line.startsWith('+') ? 'inserted' : line.startsWith('-') ? 'deleted'
                : line.startsWith('@@') ? 'meta' : undefined;
            return kind ? `<span class="nmx-tok-${kind}">${escapeHtml(line)}</span>` : escapeHtml(line);
        }).join('\n');
    }
    let tokens: readonly CodeTokenLine[] | undefined;
    try { tokens = tokenizer?.(code, languageId); } catch { tokens = undefined; }
    if (!tokens || tokens.length !== lines.length) return escapeHtml(code);
    return lines.map((line, index) => {
        const lineTokens = tokens![index] || [];
        if (!lineTokens.length) return escapeHtml(line);
        let html = lineTokens[0].offset > 0 ? escapeHtml(line.slice(0, lineTokens[0].offset)) : '';
        for (let position = 0; position < lineTokens.length; position++) {
            const token = lineTokens[position];
            const end = lineTokens[position + 1]?.offset ?? line.length;
            const text = line.slice(token.offset, end);
            if (!text) continue;
            const name = tokenClass(token.type);
            html += name ? `<span class="nmx-tok-${name}">${escapeHtml(text)}</span>` : escapeHtml(text);
        }
        return html;
    }).join('\n');
}

const WIDE_CHARACTER = /[\u1100-\u11ff\u2e80-\u303f\u3040-\u30ff\u3100-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/u;

interface RenderEnvironment {
    readonly tokenizer?: CodeTokenizer;
    readonly locale: NextMuxDesktopLocale;
}

type MarkdownIt = ReturnType<typeof markdownit>;
type Token = ReturnType<MarkdownIt['parse']>[number];

function createRenderer(): MarkdownIt {
    const md = markdownit({ html: false, linkify: false, typographer: false, breaks: false });
    // `:rocket:` still becomes 🚀, but text such as `8)` or `C:/` never turns into a face.
    md.use(markdownitEmoji.full, { shortcuts: {} });
    // `$$…$$`, `\\[…\\]`, `\\(…\\)` and `$…$` math (see nextmux-markdown-math.ts).
    md.use(markdownMath);

    // Collapsible `<think>...</think>` and `<thinking>...</thinking>` blocks in model prose (settled replies & ComicChatThread).
    md.block.ruler.before('fence', 'nmx_think_block', (state, startLine, endLine, silent) => {
        const lineStart = state.bMarks[startLine] + state.tShift[startLine];
        if (state.sCount[startLine] - state.blkIndent >= 4) return false;
        const first = state.src.slice(lineStart, state.eMarks[startLine]).trim();
        const openMatch = /^<(think|thinking)>(.*)$/i.exec(first);
        if (!openMatch) return false;
        const tagName = openMatch[1].toLowerCase();
        const closeRegex = new RegExp(`</${tagName}>\\s*$`, 'i');
        let line = startLine;
        let body = '';
        let closed = false;
        const firstRest = openMatch[2];
        if (closeRegex.test(firstRest)) {
            body = firstRest.replace(closeRegex, '');
            closed = true;
        } else {
            const lines = firstRest ? [firstRest] : [];
            for (line = startLine + 1; line < endLine; line++) {
                const rawLine = state.src.slice(state.bMarks[line], state.eMarks[line]);
                if (closeRegex.test(rawLine.trim())) {
                    const beforeClose = rawLine.replace(new RegExp(`</${tagName}>\\s*$`, 'i'), '');
                    if (beforeClose.trim()) lines.push(beforeClose);
                    closed = true;
                    break;
                }
                lines.push(rawLine);
            }
            if (!closed) line = endLine - 1;
            body = lines.join('\n');
        }
        if (silent) return true;
        const token = state.push('nmx_think_block', 'details', 0);
        token.content = body.trim();
        token.meta = { closed };
        token.map = [startLine, line + 1];
        state.line = line + 1;
        return true;
    });

    md.renderer.rules.nmx_think_block = (tokens, index, _options, environment) => {
        const token = tokens[index];
        const { locale, tokenizer } = env(environment);
        const isZh = typeof locale === 'string' && locale.startsWith('zh');
        const label = isZh ? '已思考' : 'Thought';
        const preview = token.content.replace(/\s+/g, ' ').trim().slice(0, 96);
        const bodyHtml = token.content ? md.render(token.content, { locale, tokenizer } satisfies RenderEnvironment) : '';
        return `<details class="nmx-md-think">`
            + `<summary class="nmx-md-think-summary"><i class="codicon codicon-lightbulb" aria-hidden="true"></i>`
            + `<span class="nmx-md-think-title">${escapeHtml(label)}</span>`
            + (preview ? `<span class="nmx-md-think-preview">${escapeHtml(preview)}</span>` : '')
            + `<i class="codicon codicon-chevron-right nmx-md-think-chevron" aria-hidden="true"></i></summary>`
            + `<div class="nmx-md-think-body">${bodyHtml}</div></details>\n`;
    };

    // Safe typographic inline HTML tags (`<kbd>`, `<mark>`, `<sub>`, `<sup>`, `<br>`) while keeping `html: false`
    // so `<script>`, `<tuple>`, `Promise<void>`, etc. remain escaped as literal text.
    md.inline.ruler.before('escape', 'nmx_safe_inline_html', (state, silent) => {
        const src = state.src;
        const pos = state.pos;
        if (src.charCodeAt(pos) !== 0x3C /* < */) return false;
        const brMatch = /^<br\s*\/?>/i.exec(src.slice(pos));
        if (brMatch) {
            if (!silent) {
                const token = state.push('html_inline', '', 0);
                token.content = '<br>';
            }
            state.pos = pos + brMatch[0].length;
            return true;
        }
        const tagMatch = /^<(\/?)(kbd|mark|sub|sup)>/i.exec(src.slice(pos));
        if (!tagMatch) return false;
        const isClosing = Boolean(tagMatch[1]);
        const tag = tagMatch[2].toLowerCase();
        if (!isClosing) {
            const closeRe = new RegExp(`</${tag}>`, 'i');
            if (!closeRe.test(src.slice(pos + tagMatch[0].length))) return false;
        }
        if (!silent) {
            const token = state.push('html_inline', '', 0);
            token.content = `<${isClosing ? '/' : ''}${tag}>`;
        }
        state.pos = pos + tagMatch[0].length;
        return true;
    });

    // CJK-friendly strong emphasis (`**注意：**内容`, `**加粗（含中文括号）**紧接中文`, `**100%**提升`, `中文**（括号）**`):
    // CommonMark right/left-flanking rules fail when `**` sits between punctuation and CJK/word characters.
    md.inline.ruler2.before('balance_pairs', 'nmx_cjk_friendly_strong', state => {
        const delimiters = state.delimiters;
        const tokens = state.tokens;
        if (!delimiters || delimiters.length < 2) return false;
        for (let i = 0; i < delimiters.length; i++) {
            const delim = delimiters[i];
            if (delim.marker !== 0x2A /* * */ || (delim.length ?? 0) < 2) continue;
            let prevChar = '';
            for (let t = delim.token - 1; t >= 0; t--) {
                const content = tokens[t]?.content;
                if (content) { prevChar = content.slice(-1); break; }
            }
            let nextChar = '';
            for (let t = delim.token + 1; t < tokens.length; t++) {
                const content = tokens[t]?.content;
                if (content) { nextChar = content.charAt(0); break; }
            }
            if (!delim.close && prevChar && !/\s/.test(prevChar)
                && (WIDE_CHARACTER.test(prevChar) || WIDE_CHARACTER.test(nextChar) || /[%）)”’】》」』！？：；，。.,!?:;)\]}>'"`]/.test(prevChar))) {
                delim.close = true;
            }
            if (!delim.open && nextChar && !/\s/.test(nextChar)
                && (WIDE_CHARACTER.test(prevChar) || WIDE_CHARACTER.test(nextChar) || /[（(“‘【《「『(\[<{'"`$¥￥]/.test(nextChar))) {
                delim.open = true;
            }
        }
        return false;
    });
    // Local file links (`file:` URLs, Windows drive paths) are allowed so the
    // reply can point at project files; script and data URLs stay blocked
    // (except inline raster images).
    md.validateLink = (url: string): boolean => {
        const value = url.trim().toLowerCase();
        if (/^(?:vbscript|javascript):/.test(value)) return false;
        if (value.startsWith('data:')) return /^data:image\/(?:gif|png|jpeg|webp);/.test(value);
        return true;
    };
    // The sanitizer only keeps web schemes in href/src; a local target moves
    // to data-href, which the click handler and link decoration read.
    const linkOpen = md.renderer.rules.link_open;
    md.renderer.rules.link_open = (tokens, index, options, environment, self) => {
        const href = tokens[index].attrGet('href') || '';
        if (href && !href.startsWith('#') && !/^(?:https?|mailto|tel):/i.test(href)) {
            tokens[index].attrSet('data-href', href);
            tokens[index].attrSet('href', '#');
        }
        return linkOpen ? linkOpen(tokens, index, options, environment, self) : self.renderToken(tokens, index, options);
    };

    // Task lists (behaviour of markdown-it-task-lists, ISC).
    md.core.ruler.after('inline', 'nmx-task-lists', state => {
        const tokens = state.tokens;
        for (let index = 2; index < tokens.length; index++) {
            const inline = tokens[index];
            if (inline.type !== 'inline' || tokens[index - 1].type !== 'paragraph_open' || tokens[index - 2].type !== 'list_item_open') continue;
            const match = /^\[([ xX])\][ \t]+/.exec(inline.content);
            const first = inline.children?.[0];
            if (!match || !first || first.type !== 'text' || !first.content.startsWith(match[0].trimEnd())) continue;
            first.content = first.content.slice(match[0].trimEnd().length).replace(/^[ \t]+/, '');
            const checkbox = new state.Token('html_inline', '', 0);
            checkbox.content = `<input class="nmx-md-task-box" type="checkbox" disabled${match[1] === ' ' ? '' : ' checked'} aria-hidden="true">`;
            inline.children!.unshift(checkbox);
            tokens[index - 2].attrJoin('class', 'nmx-md-task');
            for (let parent = index - 3; parent >= 0; parent--) {
                if (tokens[parent].level === tokens[index - 2].level - 1 && /_list_open$/.test(tokens[parent].type)) {
                    if (!(tokens[parent].attrGet('class') || '').includes('nmx-md-task-list')) tokens[parent].attrJoin('class', 'nmx-md-task-list');
                    break;
                }
            }
        }
    });

    // GitHub-style blockquote alerts: `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`.
    const ALERT_META: Readonly<Record<string, { readonly icon: string; readonly en: string; readonly zh: string }>> = {
        note: { icon: 'info', en: 'Note', zh: '提示' },
        tip: { icon: 'lightbulb', en: 'Tip', zh: '技巧' },
        important: { icon: 'Milestone', en: 'Important', zh: '重要' },
        warning: { icon: 'warning', en: 'Warning', zh: '警告' },
        caution: { icon: 'error', en: 'Caution', zh: '注意' }
    };
    md.core.ruler.after('nmx-task-lists', 'nmx-github-alerts', state => {
        const tokens = state.tokens;
        const { locale } = env(state.env);
        const isZh = typeof locale === 'string' && locale.startsWith('zh');
        for (let index = 0; index < tokens.length - 2; index++) {
            const bqOpen = tokens[index];
            const pOpen = tokens[index + 1];
            const inline = tokens[index + 2];
            if (bqOpen.type !== 'blockquote_open' || pOpen.type !== 'paragraph_open' || inline.type !== 'inline') continue;
            const first = inline.children?.[0];
            if (!first || first.type !== 'text') continue;
            const match = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:[ \t]+|$)/i.exec(first.content);
            if (!match) continue;
            const kind = match[1].toLowerCase();
            const meta = ALERT_META[kind];
            if (!meta) continue;
            bqOpen.attrJoin('class', `nmx-md-alert is-${kind}`);
            bqOpen.attrSet('data-alert', kind);
            first.content = first.content.slice(match[0].length);
            if (!first.content && inline.children![1]?.type === 'softbreak') {
                inline.children!.splice(0, 2);
            } else if (!first.content) {
                inline.children!.splice(0, 1);
            }
            const badge = new state.Token('html_inline', '', 0);
            const titleText = isZh ? meta.zh : meta.en;
            const iconName = meta.icon.toLowerCase();
            badge.content = `<span class="nmx-md-alert-title"><i class="codicon codicon-${iconName}" aria-hidden="true"></i><span>${escapeHtml(titleText)}</span></span>`;
            inline.children!.unshift(badge);
        }
    });

    // Top-level blocks pick their own direction (Arabic reply in an English UI and vice versa).
    md.core.ruler.push('nmx-auto-direction', state => {
        for (const token of state.tokens) {
            if (token.level === 0 && token.nesting === 1 && /^(?:paragraph|heading|bullet_list|ordered_list|blockquote|table)_open$/.test(token.type)) {
                token.attrSet('dir', 'auto');
            }
        }
    });

    const env = (value: unknown): RenderEnvironment => (value || {}) as RenderEnvironment;
    md.core.ruler.push('nmx-file-path-pills', state => {
        for (const block of state.tokens) {
            const children = block.children;
            if (!children) continue;
            for (let index = 0; index < children.length; index++) {
                const token = children[index];
                const target = token.type === 'code_inline' ? /^file:/i.test(token.content) ? token.content : normalizeLocalFileLinkTarget(token.content)
                    : token.type === 'link_open' ? token.attrGet('href') : undefined;
                let end = index;
                if (token.type === 'link_open') {
                    while (end < children.length && children[end].type !== 'link_close') end++;
                    if (end === children.length || !target || !isLocalConversationTarget(target)
                        || children.slice(index, end).some(child => child.type === 'image')) { index = end; continue; }
                }
                if (!target || !isLocalConversationTarget(target)) continue;
                const pill = new state.Token('html_inline', '', 0);
                pill.content = filePathPillHtml(target);
                children.splice(index, end - index + 1, pill);
            }
        }
    });
    md.renderer.rules.fence = (tokens, index, _options, environment) => {
        const token = tokens[index];
        const info = token.info ? md.utils.unescapeAll(token.info).trim() : '';
        const code = token.content.endsWith('\n') ? token.content.slice(0, -1) : token.content;
        const label = codeLanguageLabel(info);
        const { locale, tokenizer } = env(environment);
        const languageId = codeLanguageId(info);
        const previewable = languageId === 'html' || languageId === 'htm' || languageId === 'svg' || languageId === 'mermaid'
            || (languageId === 'xml' && /^<svg[\s>]/i.test(code.trim()));
        // A page, SVG graphic or Mermaid diagram also opens in the browser panel (a finished one opens there by itself).
        const previewButtons = previewable
            ? `<button type="button" class="nmx-md-code-preview" data-nmx-preview-code="true" data-preview-lang="${escapeHtml(languageId === 'xml' ? 'svg' : languageId || 'html')}" aria-label="${escapeHtml(markdownText(locale, 'previewInBrowser'))}" title="${escapeHtml(markdownText(locale, 'previewInBrowser'))}"><i class="codicon codicon-open-preview" aria-hidden="true"></i><span>${escapeHtml(markdownText(locale, 'previewInBrowser'))}</span></button>`
            : '';
        return `<div class="nmx-md-code"${languageId ? ` data-language="${escapeHtml(languageId)}"` : ''}>`
            + `<div class="nmx-md-code-header"><span class="nmx-md-code-lang">${escapeHtml(label)}</span>`
            + previewButtons
            + `<button type="button" class="nmx-md-code-copy" data-nmx-copy-code="true" aria-label="${escapeHtml(markdownText(locale, 'copyCode'))}" title="${escapeHtml(markdownText(locale, 'copyCode'))}">`
            + `<i class="codicon codicon-copy" aria-hidden="true"></i><i class="codicon codicon-check" aria-hidden="true"></i>`
            + `<span class="nmx-md-code-copy-label" data-copy="${escapeHtml(markdownText(locale, 'copy'))}" data-copied="${escapeHtml(markdownText(locale, 'copied'))}"></span></button></div>`
            + `<pre dir="ltr"><code${languageId ? ` class="language-${escapeHtml(languageId)}"` : ''}>${highlightCode(code, info, tokenizer)}</code></pre></div>\n`;
    };
    md.renderer.rules.code_block = (tokens, index) => `<pre class="nmx-md-plain-code" dir="ltr"><code>${escapeHtml(tokens[index].content.replace(/\n$/, ''))}</code></pre>\n`;
    const tableOpen = md.renderer.rules.table_open;
    md.renderer.rules.table_open = (tokens, index, options, environment, self) => `<div class="nmx-md-table">`
        + (tableOpen ? tableOpen(tokens, index, options, environment, self) : self.renderToken(tokens, index, options));
    const tableClose = md.renderer.rules.table_close;
    md.renderer.rules.table_close = (tokens, index, options, environment, self) =>
        (tableClose ? tableClose(tokens, index, options, environment, self) : self.renderToken(tokens, index, options)) + '</div>\n';
    // A soft line break between two CJK characters is not a space in Chinese or Japanese.
    md.renderer.rules.softbreak = (tokens: Token[], index: number) => {
        const before = tokens[index - 1]?.content.slice(-1) || '';
        const after = tokens[index + 1]?.content.charAt(0) || '';
        return WIDE_CHARACTER.test(before) && WIDE_CHARACTER.test(after) ? '' : '\n';
    };
    const image = md.renderer.rules.image;
    md.renderer.rules.image = (tokens, index, options, environment, self) => {
        tokens[index].attrSet('loading', 'lazy');
        tokens[index].attrSet('decoding', 'async');
        tokens[index].attrSet('referrerpolicy', 'no-referrer');
        // A local image (relative, absolute or file: path) is resolved against
        // the conversation's project after rendering; the sanitizer would drop
        // file: and Windows drive paths, and a relative path would resolve
        // against the app bundle instead of the project.
        const source = tokens[index].attrGet('src') || '';
        if (source && !/^(?:https?:|data:image\/|blob:)/i.test(source)) {
            tokens[index].attrSet('data-nmx-local-src', source);
            tokens[index].attrSet('src', '');
            tokens[index].attrJoin('class', 'nmx-md-local-image');
        }
        return image ? image(tokens, index, options, environment, self) : self.renderToken(tokens, index, options);
    };
    return md;
}

let renderer: MarkdownIt | undefined;
const cache = new Map<string, string>();
let cachedCharacters = 0;
const CACHE_CHARACTERS = 4_000_000;

/** Markdown-it output BEFORE sanitization, for renderer tests only: never insert it into the DOM. */
export function renderConversationMarkdownUnsanitized(markdown: string, locale: NextMuxDesktopLocale, tokenizer?: CodeTokenizer): string {
    renderer ||= createRenderer();
    return renderer.render(markdown, { locale, tokenizer } satisfies RenderEnvironment);
}

/** Escaped plain text (paragraphs and line breaks kept) for when no sanitizer can run. */
function plainTextHtml(markdown: string): string {
    return markdown.split(/(?:\r?\n[ \t]*){2,}/).filter(paragraph => paragraph.trim())
        .map(paragraph => `<p>${escapeHtml(paragraph).replace(/\r?\n/g, '<br>')}</p>`).join('');
}

/** Markdown → sanitized HTML. Results are cached so remounting a long transcript is cheap. */
export function renderConversationMarkdownHtml(markdown: string, locale: NextMuxDesktopLocale, tokenizer?: CodeTokenizer): string {
    const key = `${locale}\u0000${tokenizer ? 1 : 0}\u0000${markdown}`;
    const cached = cache.get(key);
    if (cached !== undefined) {
        cache.delete(key);
        cache.set(key, cached);
        return cached;
    }
    // Fail closed: without a working sanitizer the reply shows as escaped text, never as unsanitized markup.
    // DOMPurify itself returns its input unchanged when the DOM it needs is missing (`isSupported` false).
    const html = (typeof DOMPurify?.sanitize === 'function' && DOMPurify.isSupported === true
        ? DOMPurify.sanitize(renderConversationMarkdownUnsanitized(markdown, locale, tokenizer), {
            ADD_ATTR: ['loading', 'decoding', 'referrerpolicy', 'class', 'role', 'tabindex', 'title', 'data-path', 'data-href', 'data-alert', 'data-nmx-preview-code', 'data-preview-lang'],
            FORBID_TAGS: ['style', 'form'],
            ALLOW_UNKNOWN_PROTOCOLS: false
        })
        : plainTextHtml(markdown)) as unknown as string;
    cache.set(key, html);
    cachedCharacters += key.length + html.length;
    for (const [oldKey, oldHtml] of cache) {
        if (cachedCharacters <= CACHE_CHARACTERS || cache.size <= 1) break;
        cache.delete(oldKey);
        cachedCharacters -= oldKey.length + oldHtml.length;
    }
    return html;
}

export interface ConversationMarkdownProps {
    readonly markdown: string;
    readonly className: string;
    readonly locale: NextMuxDesktopLocale;
    readonly tokenizer?: CodeTokenizer;
    /** Runs after every render with the host element (link decoration). */
    readonly onRender?: (element: HTMLElement) => void;
    /** Clipboard writer; defaults to `navigator.clipboard`. */
    readonly onCopyCode?: (code: string) => Promise<void> | void;
}

const COPIED_MS = 1_600;

export const ConversationMarkdown = React.memo(function ConversationMarkdown(props: ConversationMarkdownProps): React.ReactElement {
    const ref = React.useRef<HTMLDivElement>(null);
    const copy = React.useRef(props.onCopyCode);
    copy.current = props.onCopyCode;
    const copiedTimers = React.useRef<Map<string, number>>(new Map());
    React.useEffect(() => () => {
        for (const timer of copiedTimers.current.values()) window.clearTimeout(timer);
        copiedTimers.current.clear();
    }, []);
    React.useLayoutEffect(() => {
        const host = ref.current;
        if (!host) return;
        host.innerHTML = props.markdown.trim() ? renderConversationMarkdownHtml(props.markdown, props.locale, props.tokenizer) : '';
        if (copiedTimers.current.size > 0) {
            const buttons = host.querySelectorAll<HTMLButtonElement>('button[data-nmx-copy-code]');
            buttons.forEach((btn, idx) => {
                const codeText = btn.closest('.nmx-md-code')?.querySelector('pre > code')?.textContent ?? '';
                const key = `${idx}:${codeText}`;
                if (copiedTimers.current.has(key) || copiedTimers.current.has(codeText)) {
                    btn.classList.add('is-copied');
                }
            });
        }
        props.onRender?.(host);
    }, [props.markdown, props.locale, props.tokenizer, props.onRender]);
    const onClick = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        const button = (event.target as Element | null)?.closest?.<HTMLButtonElement>('button[data-nmx-copy-code]');
        if (!button || !event.currentTarget.contains(button)) return;
        event.preventDefault();
        event.stopPropagation();
        const host = event.currentTarget;
        const buttons = [...host.querySelectorAll<HTMLButtonElement>('button[data-nmx-copy-code]')];
        const idx = buttons.indexOf(button);
        const code = button.closest('.nmx-md-code')?.querySelector('pre > code')?.textContent ?? '';
        const key = `${idx}:${code}`;
        const write = copy.current || ((text: string) => navigator.clipboard?.writeText(text));
        void Promise.resolve(write(code)).then(() => {
            const previous = copiedTimers.current.get(key);
            if (previous) window.clearTimeout(previous);
            button.classList.add('is-copied');
            const timer = window.setTimeout(() => {
                copiedTimers.current.delete(key);
                const currentHost = ref.current;
                const liveBtn = currentHost?.querySelectorAll<HTMLButtonElement>('button[data-nmx-copy-code]')[idx];
                liveBtn?.classList.remove('is-copied');
                button.classList.remove('is-copied');
            }, COPIED_MS);
            copiedTimers.current.set(key, timer);
        }).catch(() => undefined);
    }, []);
    return <div ref={ref} className={props.className} onClick={onClick} onKeyDown={event => {
        if (event.key !== 'Enter') return;
        const pill = (event.target as Element | null)?.closest<HTMLElement>('.nmx-file-path-pill');
        if (pill && event.currentTarget.contains(pill)) { event.preventDefault(); pill.click(); }
    }} data-nmx-literal />;
});
