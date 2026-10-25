/**
 * Large uploaded documents (Cherry Studio #12, LobeChat #8). A document whose text would take a large share of every
 * request is saved as a Markdown file the model reads in parts with workspace.read_file / workspace.search_text, and the
 * message carries a description instead: where the file is, how long it is, its outline with line numbers (headings,
 * pages, slides, sheets), or its first lines when it has no structure. Shorter documents are still sent whole.
 */

/** Rough token count: one per CJK/kana/Hangul character, one per four other characters. */
export function estimateTextTokens(text: string): number {
    const cjk = (text.match(/[぀-ヿ㐀-鿿가-힯豈-﫿]/g) || []).length;
    return cjk + Math.ceil((text.length - cjk) / 4);
}

/** A document over this many tokens (or over 15% of a small context window) is read in parts. */
export const LARGE_DOCUMENT_INLINE_TOKENS = 12_000;
/** The most text a saved document keeps (about a thousand pages); inline delivery keeps its own 110,000 limit. */
export const LARGE_DOCUMENT_MAX_CHARACTERS = 2_000_000;
/** What inline delivery sends at most, as before documents could be read in parts. */
export const INLINE_DOCUMENT_MAX_CHARACTERS = 110_000;

export function documentFitsInline(text: string, contextWindowTokens?: number): boolean {
    const windowShare = contextWindowTokens && Number.isFinite(contextWindowTokens) && contextWindowTokens > 0
        ? Math.floor(contextWindowTokens * 0.15) : LARGE_DOCUMENT_INLINE_TOKENS;
    return estimateTextTokens(text) <= Math.max(2_000, Math.min(LARGE_DOCUMENT_INLINE_TOKENS, windowShare));
}

export interface LargeDocumentSection {
    readonly title: string;
    readonly startLine: number;
    readonly endLine: number;
}

export interface LargeDocumentOutline {
    readonly lines: number;
    /** Headings, slides and sheets ("## Slide 3", "# Chapter", "第一章 …"), outside code blocks. */
    readonly sections: readonly LargeDocumentSection[];
    /** "[Page N]" markers of extracted PDFs: page number and the line it starts on. */
    readonly pages: readonly { readonly page: number; readonly line: number }[];
}

const HEADING = /^(#{1,4})\s+(\S.{0,118})$/;
const CHAPTER = /^(?:第\s*[0-9一二三四五六七八九十百千]+\s*[章节篇回部卷]|(?:chapter|part|section)\s+[0-9ivxlc]+\b)[^\n]{0,60}$/i;
const PAGE = /^\[Page (\d{1,5})\]$/;
const FENCE = /^\s*(`{3,}|~{3,})/;

export function largeDocumentOutline(content: string): LargeDocumentOutline {
    const lines = content.split(/\r?\n/);
    const starts: { readonly title: string; readonly line: number }[] = [];
    const pages: { page: number; line: number }[] = [];
    let fence = '';
    lines.forEach((raw, index) => {
        const fenceMatch = FENCE.exec(raw);
        if (fenceMatch) {
            if (!fence) fence = fenceMatch[1][0];
            else if (fenceMatch[1][0] === fence) fence = '';
            return;
        }
        if (fence) return;
        const line = raw.trim();
        const page = PAGE.exec(line);
        if (page) { pages.push({ page: Number(page[1]), line: index + 1 }); return; }
        const heading = HEADING.exec(line);
        const title = heading ? heading[2].replace(/\s+#+$/, '').trim() : CHAPTER.test(line) ? line : '';
        if (title) starts.push({ title, line: index + 1 });
    });
    const sections = starts.map((start, index) => ({
        title: start.title,
        startLine: start.line,
        endLine: (starts[index + 1]?.line ?? lines.length + 1) - 1
    }));
    return { lines: lines.length, sections, pages };
}

/** Code-fence marker longer than any backtick run in the text, so a preview can never close its own block. */
function fenceFor(text: string): string {
    return '`'.repeat(Math.max(3, ...(text.match(/`{3,}/g) || []).map(run => run.length + 1)));
}

function sampled<T>(items: readonly T[], maximum: number): readonly T[] {
    if (items.length <= maximum) return items;
    const step = items.length / maximum;
    return Array.from({ length: maximum }, (_, index) => items[Math.floor(index * step)]);
}

export interface LargeDocumentDescriptorInput {
    readonly name: string;
    /** Where the text was saved, as the file tools take it. */
    readonly path: string;
    readonly content: string;
    /** For example "PDF, 42 pages" or "Word document"; omitted for plain text. */
    readonly details?: string;
    /** The file's size as shown to the user. */
    readonly size?: string;
}

/** What the model receives instead of the whole text. English, like the other attachment notes. */
export function largeDocumentDescriptor(input: LargeDocumentDescriptorInput): string {
    const outline = largeDocumentOutline(input.content);
    const number = (value: number): string => value.toLocaleString('en-US');
    const about = [input.size, input.details].filter(Boolean).join('; ');
    const lines = [
        `[Attachment "${input.name}"${about ? ` (${about})` : ''}. Its text (${number(outline.lines)} lines, ${number(input.content.length)} characters) is too long to send with every request, so it was saved for reading in parts:`,
        input.path,
        'Read the parts you need with workspace.read_file (this path, startLine/endLine, a few hundred lines at a time) and find passages with workspace.search_text (query, this path). Read the whole text only when the task needs all of it, and say which part an answer comes from. The file stays available in later messages of this conversation.'
    ];
    if (outline.sections.length >= 2) {
        const shown = sampled(outline.sections, 60);
        lines.push('', `Outline (line numbers${shown.length < outline.sections.length ? `; ${shown.length} of ${outline.sections.length} sections, search for the others` : ''}):`,
            ...shown.map(section => `- ${section.startLine}–${section.endLine} ${section.title}`));
    }
    if (outline.pages.length >= 2) {
        const shown = sampled(outline.pages, 40);
        lines.push('', `Pages: each starts with a "[Page N]" line (search for it to jump to a page). ${shown.map(page => `p.${page.page} → line ${page.line}`).join(', ')}${shown.length < outline.pages.length ? ', …' : ''}`);
    }
    if (outline.sections.length < 2 && outline.pages.length < 2) {
        const preview = input.content.split(/\r?\n/).slice(0, 30).join('\n').slice(0, 2_400);
        const marker = fenceFor(preview);
        lines.push('', 'It has no headings or pages to list. Its first 30 lines:', `${marker}text`, preview, marker);
    }
    return `${lines.join('\n')}\n]`;
}
