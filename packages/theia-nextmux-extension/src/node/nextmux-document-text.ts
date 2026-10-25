import { DesktopDomainError, type DomainMessage } from '../common/nextmux-domain-errors';
// Text extraction for attachments a model cannot read natively.
//
// Chat clients such as Open WebUI and Cherry Studio extract the text of
// documents in the application and send that text to the model; only images,
// audio and video go to the model as they are. This module does the same for
// the desktop app with Node's built-in zlib and no third-party parser:
//   PDF (text layer, ToUnicode-aware), Word/Excel/PowerPoint (OOXML),
//   OpenDocument, EPUB, RTF, ZIP archives and legacy Office binaries
//   (best-effort string recovery).
// Scanned PDFs without a text layer produce an explicit "no text" result.
import { inflateRawSync, inflateSync } from 'node:zlib';

export interface ExtractedDocument {
    readonly text: string;
    /** Parser used, shown to the model so it knows how the text was produced. */
    readonly method: 'pdf' | 'docx' | 'doc' | 'xlsx' | 'pptx' | 'odf' | 'epub' | 'rtf' | 'ipynb' | 'eml' | 'svg' | 'image_ocr' | 'zip' | 'strings' | 'text';
    readonly truncated: boolean;
    readonly pages?: number;
    readonly note?: string;
}

export class DocumentTextError extends Error {
    readonly domainError: DomainMessage;
    readonly data: { readonly domainError: DomainMessage };
    constructor(readonly code: 'unsupported' | 'encrypted' | 'empty' | 'invalid', message: string, reason: string, params?: DomainMessage['params']) {
        super(message);
        const error = new DesktopDomainError(reason, message, params);
        this.domainError = error.domainError;
        this.data = error.data;
    }
}

/** Text sent with a message; a document saved for reading in parts may keep up to MAX_SAVED_TEXT. */
const MAX_TEXT = 110_000;
const MAX_SAVED_TEXT = 2_000_000;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const decoder = new TextDecoder('utf-8');

function finish(text: string, method: ExtractedDocument['method'], extra: Partial<ExtractedDocument> = {}): ExtractedDocument {
    const clean = text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
    if (!clean) throw new DocumentTextError('empty', 'The document has no extractable text', 'DOCUMENT_EMPTY');
    return { text: clean, method, truncated: false, ...extra };
}

/** At most `maxCharacters` of the text (110,000 by default, up to 2,000,000), marked when cut. */
export function boundedDocumentText(document: ExtractedDocument, maxCharacters = MAX_TEXT): ExtractedDocument {
    const limit = Math.max(1_000, Math.min(MAX_SAVED_TEXT, Math.floor(Number.isFinite(maxCharacters) ? maxCharacters : MAX_TEXT)));
    return document.text.length > limit ? { ...document, text: `${document.text.slice(0, limit)}\n… (truncated)`, truncated: true } : document;
}

// ---------------------------------------------------------------------------
// ZIP (stored and deflated entries; central directory, ZIP64 sizes ignored)

export interface ZipEntry { readonly name: string; read(): Uint8Array }

export function readZip(bytes: Uint8Array): Map<string, ZipEntry> {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
        if (view.getUint32(offset, true) === 0x06054b50) { end = offset; break; }
    }
    if (end < 0) throw new DocumentTextError('invalid', 'Not a ZIP container', 'DOCUMENT_FORMAT_INVALID', { format: 'ZIP' });
    const count = view.getUint16(end + 10, true);
    let pointer = view.getUint32(end + 16, true);
    const entries = new Map<string, ZipEntry>();
    for (let index = 0; index < count && pointer + 46 <= bytes.length; index += 1) {
        if (view.getUint32(pointer, true) !== 0x02014b50) break;
        const flags = view.getUint16(pointer + 8, true);
        const method = view.getUint16(pointer + 10, true);
        const compressedSize = view.getUint32(pointer + 20, true);
        const size = view.getUint32(pointer + 24, true);
        const nameLength = view.getUint16(pointer + 28, true);
        const extraLength = view.getUint16(pointer + 30, true);
        const commentLength = view.getUint16(pointer + 32, true);
        const local = view.getUint32(pointer + 42, true);
        const nameBytes = bytes.subarray(pointer + 46, pointer + 46 + nameLength);
        const name = (flags & 0x800 ? decoder.decode(nameBytes) : new TextDecoder('latin1').decode(nameBytes)).replace(/\\/g, '/');
        pointer += 46 + nameLength + extraLength + commentLength;
        if (name.endsWith('/')) continue;
        entries.set(name, {
            name,
            read: () => {
                if (flags & 0x1) throw new DocumentTextError('encrypted', 'The archive is password protected', 'DOCUMENT_ENCRYPTED', { format: 'ZIP' });
                if (size > MAX_ENTRY_BYTES || compressedSize > MAX_ENTRY_BYTES) {
                    throw new DocumentTextError('invalid', 'Archive entry is too large', 'DOCUMENT_ENTRY_TOO_LARGE', { maxMB: 64 });
                }
                if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) {
                    throw new DocumentTextError('invalid', `Invalid ZIP local file header for ${name}`, 'DOCUMENT_FORMAT_INVALID', { format: 'ZIP' });
                }
                const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
                if (dataStart < 0 || dataStart + compressedSize > bytes.length) {
                    throw new DocumentTextError('invalid', `Truncated ZIP entry data for ${name}`, 'DOCUMENT_FORMAT_INVALID', { format: 'ZIP' });
                }
                const data = bytes.subarray(dataStart, dataStart + compressedSize);
                if (method === 0) return data;
                if (method === 8) {
                    try {
                        return new Uint8Array(inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES }));
                    } catch {
                        throw new DocumentTextError('invalid', `Corrupt or oversized compressed ZIP entry: ${name}`, 'DOCUMENT_FORMAT_INVALID', { format: 'ZIP' });
                    }
                }
                throw new DocumentTextError('unsupported', `Unsupported ZIP compression method ${method}`, 'DOCUMENT_COMPRESSION_UNSUPPORTED', { method });
            }
        });
    }
    return entries;
}

const readText = (entries: Map<string, ZipEntry>, name: string): string | undefined => {
    const entry = entries.get(name);
    return entry ? decoder.decode(entry.read()) : undefined;
};

// ---------------------------------------------------------------------------
// XML helpers (the formats below are machine-written; a tolerant scanner suffices)

export function decodeXmlEntities(value: string): string {
    return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity: string) => {
        const lower = entity.toLowerCase();
        if (lower.startsWith('#x') || lower.startsWith('#')) {
            const code = lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
            return Number.isInteger(code) && code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
                ? String.fromCodePoint(code)
                : '\uFFFD';
        }
        return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[lower] ?? match;
    });
}

/** Text of an XML fragment: `breaks` become new lines, `tabs` become tabs, other tags vanish. */
function xmlToText(xml: string, breaks: RegExp, tabs?: RegExp): string {
    let text = xml.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g, '');
    if (tabs) text = text.replace(tabs, '\t');
    text = text.replace(breaks, '\n').replace(/<[^>]+>/g, '');
    return decodeXmlEntities(text);
}

const naturalOrder = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true });

// ---------------------------------------------------------------------------
// OOXML

/**
 * Word headings and list paragraphs keep their structure as Markdown (“## ”, “- ”), the way
 * MarkItDown does, so the model sees the outline without spending tokens on markup.
 */
export function markdownParagraphs(xml: string, styleNames: ReadonlyMap<string, string>): string {
    return xml.replace(/<w:p\b([^>]*)>([\s\S]*?)<\/w:p>/g, (paragraph, attributes: string, body: string) => {
        const styleId = /<w:pStyle\b[^>]*w:val="([^"]+)"/.exec(body)?.[1] || '';
        // Localized documents use ids such as “1” for “heading 1”; the style name is authoritative.
        const style = styleNames.get(styleId) || styleId;
        const heading = /^heading\s*([1-6])$/i.exec(style)?.[1] || (/^title$/i.test(style) ? '1' : '');
        const marker = heading ? `${'#'.repeat(Number(heading))} ` : /<w:numPr\b/.test(body) || /^list\s*(?:bullet|number|paragraph)/i.test(style) ? '- ' : '';
        if (!marker || !/<w:t\b/.test(body)) return paragraph;
        const at = body.search(/<w:r\b/);
        return at < 0 ? paragraph : `<w:p${attributes}>${body.slice(0, at)}<w:r><w:t>${marker}</w:t></w:r>${body.slice(at)}</w:p>`;
    });
}

function docxText(entries: Map<string, ZipEntry>): string {
    const parts = ['word/document.xml', ...[...entries.keys()].filter(name => /^word\/(header|footer|footnotes|endnotes|comments)\d*\.xml$/.test(name)).sort(naturalOrder)];
    const styleNames = new Map([...(readText(entries, 'word/styles.xml') || '').matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>[\s\S]*?<w:name\b[^>]*w:val="([^"]+)"/g)]
        .map(match => [match[1], decodeXmlEntities(match[2])] as const));
    return parts.map(name => {
        const raw = readText(entries, name);
        if (!raw) return '';
        const xml = markdownParagraphs(raw, styleNames);
        // Table cells become " | " separated so rows stay readable.
        const cells = xml.replace(/<\/w:p>\s*<\/w:tc>/g, '</w:tc>').replace(/<\/w:tc>/g, ' | </w:tc>').replace(/<\/w:tr>/g, '</w:tr>\n');
        const text = xmlToText(cells, /<\/w:p>|<w:br\b[^>]*\/>|<w:cr\b[^>]*\/>/g, /<w:tab\b[^>]*\/>/g).replace(/ \| *(?=\n|$)/g, '');
        return name === 'word/document.xml' ? text : `\n[${name.replace(/^word\/|\.xml$/g, '')}]\n${text}`;
    }).join('\n');
}

function columnIndex(reference: string): number {
    const letters = /^[A-Z]+/.exec(reference)?.[0] || 'A';
    return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function xlsxText(entries: Map<string, ZipEntry>): string {
    const shared = [...(readText(entries, 'xl/sharedStrings.xml') || '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)]
        .map(match => decodeXmlEntities([...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(text => text[1]).join('')));
    const workbook = readText(entries, 'xl/workbook.xml') || '';
    const relations = readText(entries, 'xl/_rels/workbook.xml.rels') || '';
    const attribute = (tag: string, name: string): string | undefined => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
    const targets = new Map([...relations.matchAll(/<Relationship\b[^>]*>/g)].map(match => [attribute(match[0], 'Id') || '', attribute(match[0], 'Target') || '']));
    const sheets = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map(match => ({
        name: decodeXmlEntities(attribute(match[0], 'name') || 'Sheet'),
        path: (() => { const target = targets.get(attribute(match[0], 'r:id') || '') || ''; return target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`; })()
    })).filter(sheet => entries.has(sheet.path));
    const fallback = [...entries.keys()].filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort(naturalOrder).map((path, index) => ({ name: `Sheet${index + 1}`, path }));
    let rowsWritten = 0;
    return (sheets.length ? sheets : fallback).map(sheet => {
        const xml = readText(entries, sheet.path);
        if (!xml) return '';
        const rawRows: Map<number, string>[] = [];
        const occupiedCols = new Set<number>();
        let maxCol = 0;
        let truncatedRows = false;
        for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
            if (rowsWritten >= 5_000) { truncatedRows = true; break; }
            const cells = new Map<number, string>();
            let nextIndex = 0;
            for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
                const attributes = cell[1], body = cell[2] || '';
                const reference = /\br="([A-Z]+)\d+"/.exec(attributes)?.[1];
                const type = /\bt="([^"]+)"/.exec(attributes)?.[1];
                const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
                let value = type === 's' ? shared[Number(raw)] ?? ''
                    : type === 'inlineStr' ? [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(text => decodeXmlEntities(text[1])).join('')
                    : decodeXmlEntities(raw ?? '');
                if (type === 'b') value = value === '1' ? 'TRUE' : 'FALSE';
                const index = reference ? columnIndex(reference) : nextIndex;
                nextIndex = index + 1;
                const cleaned = value.replace(/[\t\r\n]+/g, ' ').replace(/\|/g, '\\|').trim();
                if (cleaned) {
                    cells.set(index, cleaned);
                    occupiedCols.add(index);
                    if (index > maxCol) maxCol = index;
                }
            }
            if (cells.size > 0) { rawRows.push(cells); rowsWritten += 1; }
        }
        if (!rawRows.length) return '';
        const columns = maxCol < 64
            ? Array.from({ length: maxCol + 1 }, (_, idx) => idx)
            : [...occupiedCols].sort((a, b) => a - b).slice(0, 128);
        const formatRow = (row: Map<number, string>): string => `| ${columns.map(col => row.get(col) ?? '').join(' | ')} |`;
        const separator = `| ${columns.map(() => '---').join(' | ')} |`;
        const tableLines = [formatRow(rawRows[0]), separator, ...rawRows.slice(1).map(formatRow)];
        if (truncatedRows) tableLines.push('… (more rows)');
        return `## ${sheet.name}\n${tableLines.join('\n')}`;
    }).filter(Boolean).join('\n\n');
}

function pptxText(entries: Map<string, ZipEntry>): string {
    const slides = [...entries.keys()].filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort(naturalOrder);
    return slides.map((name, index) => {
        const text = xmlToText(readText(entries, name) || '', /<\/a:p>|<a:br\b[^>]*\/>/g).trim();
        const notesName = name.replace('slides/slide', 'notesSlides/notesSlide');
        const notes = entries.has(notesName) ? xmlToText(readText(entries, notesName) || '', /<\/a:p>/g).replace(/^\s*\d+\s*$/gm, '').trim() : '';
        return `## Slide ${index + 1}\n${text}${notes ? `\n\n[Notes]\n${notes}` : ''}`;
    }).join('\n\n');
}

function odfText(entries: Map<string, ZipEntry>): string {
    const xml = readText(entries, 'content.xml');
    if (!xml) throw new DocumentTextError('invalid', 'OpenDocument content is missing', 'DOCUMENT_CONTENT_MISSING', { format: 'OpenDocument' });
    const cells = xml.replace(/<\/text:p>\s*<\/table:table-cell>/g, '</table:table-cell>').replace(/<\/table:table-cell>/g, '\t</table:table-cell>').replace(/<table:table\b[^>]*table:name="([^"]*)"[^>]*>/g, '\n## $1\n');
    return xmlToText(cells, /<\/text:p>|<\/text:h>|<text:line-break\/>|<\/table:table-row>|<\/draw:page>/g, /<text:tab\/>/g);
}

function epubText(entries: Map<string, ZipEntry>): string {
    const container = readText(entries, 'META-INF/container.xml') || '';
    const opfPath = /full-path="([^"]+)"/.exec(container)?.[1];
    const opf = opfPath ? readText(entries, opfPath) || '' : '';
    const base = opfPath?.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const manifest = new Map([...opf.matchAll(/<item\b[^>]*\bid="([^"]+)"[^>]*\bhref="([^"]+)"/g)].map(match => [match[1], base + decodeURIComponent(match[2])]));
    const spine = [...opf.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"/g)].map(match => manifest.get(match[1])).filter((path): path is string => Boolean(path));
    const files = spine.length ? spine : [...entries.keys()].filter(name => /\.x?html?$/i.test(name)).sort(naturalOrder);
    return files.map(path => htmlToText(readText(entries, path) || '')).filter(Boolean).join('\n\n');
}

export function htmlToText(html: string): string {
    // Every fragment is decoded exactly once. Converted fragments are re-escaped, so the final decode restores them
    // as they were (`&amp;lt;` stays the text `&lt;`) and decoded text that looks like a tag is never stripped.
    const escapeText = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const stripTags = (fragment: string): string => escapeText(decodeXmlEntities(fragment.replace(/<[^>]+>/g, '')).replace(/[ \t\r\n]+/g, ' ').trim());
    // Code blocks wait behind placeholders until the whitespace clean-up is done, so their indentation survives.
    const codeBlocks: string[] = [];
    const codeBlock = (_: string, code: string): string => {
        const text = decodeXmlEntities(code.replace(/<[^>]+>/g, '')).replace(/^(?:[ \t]*\r?\n)+/, '').trimEnd();
        return `\n\u0000${codeBlocks.push(`\`\`\`\n${text}\n\`\`\``) - 1}\u0000\n`;
    };
    const converted = html
        .replace(/\u0000/g, '')
        .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, '')
        .replace(/<pre\b[^>]*>\s*<code\b[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi, codeBlock)
        .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, codeBlock)
        .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, code: string) => `\`${stripTags(code)}\``)
        .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level: string, inner: string) => {
            const text = stripTags(inner);
            return text ? `\n${'#'.repeat(Number(level))} ${text}\n` : '\n';
        })
        .replace(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, inner: string) => {
            const label = stripTags(inner);
            const url = decodeXmlEntities(href).trim();
            return label && url && !/^javascript:/i.test(url) ? `[${label}](${escapeText(url)})` : label;
        })
        .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, inner: string) => {
            const item = stripTags(inner);
            return item ? `\n- ${item}\n` : '\n';
        })
        .replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (full, rowInner: string) => {
            const cellMatches = [...rowInner.matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi)];
            if (!cellMatches.length) return full;
            const hasHeader = cellMatches.some(m => m[1].toLowerCase() === 'th');
            const cells = cellMatches.map(m => stripTags(m[2]).replace(/\|/g, '\\|'));
            const rowLine = `| ${cells.join(' | ')} |`;
            return hasHeader ? `\n${rowLine}\n| ${cells.map(() => '---').join(' | ')} |\n` : `\n${rowLine}\n`;
        })
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|h[1-6]|li|tr|section|article|blockquote|ul|ol|table)>/gi, '\n')
        .replace(/<[^>]+>/g, '');
    return decodeXmlEntities(converted)
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/\u0000(\d+)\u0000/g, (_, index: string) => codeBlocks[Number(index)] ?? '')
        .trim();
}

// ---------------------------------------------------------------------------
// RTF

export function rtfText(rtf: string): string {
    let output = '';
    let skip = 0;
    let unicodeSkip = 1, pendingSkip = 0;
    const stack: { skip: number; unicodeSkip: number }[] = [];
    for (let index = 0; index < rtf.length; index += 1) {
        const character = rtf[index];
        if (character === '{') { stack.push({ skip, unicodeSkip }); continue; }
        if (character === '}') {
            const frame = stack.pop();
            skip = frame?.skip ?? 0;
            unicodeSkip = frame?.unicodeSkip ?? 1;
            continue;
        }
        if (character === '\\') {
            const next = rtf[index + 1];
            if (next === '\\' || next === '{' || next === '}') { if (!skip) output += next; index += 1; continue; }
            if (next === "'") {
                const code = parseInt(rtf.slice(index + 2, index + 4), 16);
                if (pendingSkip > 0) pendingSkip -= 1; else if (!skip && Number.isFinite(code)) output += String.fromCharCode(code);
                index += 3; continue;
            }
            if (next === '*') { skip = 1; index += 1; continue; }
            const match = /^\\([a-z]+)(-?\d+)? ?/i.exec(rtf.slice(index, index + 40));
            if (!match) { index += 1; continue; }
            const [whole, word, parameter] = match;
            index += whole.length - 1;
            if (['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'footer', 'themedata', 'datastore'].includes(word)) skip = 1;
            else if (word === 'par' || word === 'line' || word === 'row') { if (!skip) output += '\n'; }
            else if (word === 'tab' || word === 'cell') { if (!skip) output += '\t'; }
            else if (word === 'uc') unicodeSkip = Math.max(0, Number(parameter ?? 1));
            else if (word === 'u' && parameter) {
                if (!skip) {
                    const rawCode = Number(parameter);
                    const code = rawCode < 0 ? rawCode + 65_536 : rawCode;
                    output += Number.isInteger(code) && code >= 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
                        ? String.fromCodePoint(code)
                        : '\uFFFD';
                }
                pendingSkip = unicodeSkip;
            }
            continue;
        }
        if (character === '\r' || character === '\n') continue;
        if (pendingSkip > 0) { pendingSkip -= 1; continue; }
        if (!skip) output += character;
    }
    return output;
}

// ---------------------------------------------------------------------------
// Legacy binaries (.doc/.xls/.ppt): recover readable UTF-16LE and ASCII runs.

export function binaryStrings(bytes: Uint8Array): string {
    const natural = /[A-Za-z0-9\s.,;:!?'"()\-/%&@#+=À-ɏЀ-ӿ　-〿一-鿿＀-￯]/;
    const keep = (run: string): boolean => {
        const trimmed = run.trim();
        if (trimmed.length < 4) return false;
        let good = 0;
        for (const character of trimmed) if (natural.test(character)) good += 1;
        return good / trimmed.length >= 0.9;
    };
    const utf16Runs = (start: number): string[] => {
        const runs: string[] = [];
        let current = '';
        for (let index = start; index + 1 < bytes.length; index += 2) {
            const code = bytes[index] | (bytes[index + 1] << 8);
            if (code === 9 || code === 10 || code === 13 || (code >= 32 && code < 0xd800 && code !== 0xfffd && !(code >= 0x7f && code < 0xa0))) current += String.fromCharCode(code);
            else { if (keep(current)) runs.push(current.trim()); current = ''; }
        }
        if (keep(current)) runs.push(current.trim());
        return runs;
    };
    const candidates = [utf16Runs(0), utf16Runs(1), (new TextDecoder('latin1').decode(bytes).match(/[\x20-\x7e\t]{6,}/g) || []).filter(keep)];
    const score = (runs: string[]): number => runs.reduce((total, run) => total + run.length, 0);
    const best = candidates.sort((a, b) => score(b) - score(a))[0];
    // Style and property names repeat in every Office file; keep distinct runs only.
    return [...new Set(best)].filter(run => !/^(Root Entry|Normal|Heading \d|Default Paragraph Font|Table Normal|No List|WordDocument|SummaryInformation|DocumentSummaryInformation|CompObj|1Table|0Table|Data)$/i.test(run)).join('\n');
}

// ---------------------------------------------------------------------------
// Word 97-2003 (.doc): OLE compound file + FIB piece table

/** Streams of an OLE compound file (the container of .doc/.xls/.ppt). */
export function readCompoundFile(bytes: Uint8Array): Map<string, Uint8Array> {
    if (bytes.length < 512) throw new DocumentTextError('invalid', 'Not an OLE compound file', 'DOCUMENT_FORMAT_INVALID', { format: 'OLE' });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== 0xe011cfd0) throw new DocumentTextError('invalid', 'Not an OLE compound file', 'DOCUMENT_FORMAT_INVALID', { format: 'OLE' });
    const sectorShift = view.getUint16(30, true), miniSectorShift = view.getUint16(32, true);
    if ((sectorShift !== 9 && sectorShift !== 12) || miniSectorShift !== 6) {
        throw new DocumentTextError('invalid', 'Invalid OLE sector shift', 'DOCUMENT_FORMAT_INVALID', { format: 'OLE' });
    }
    const sectorSize = 1 << sectorShift, miniSectorSize = 1 << miniSectorShift;
    const sectorOffset = (sector: number): number => (sector + 1) * sectorSize;
    const difat: number[] = [];
    for (let index = 0; index < 109; index += 1) { const value = view.getInt32(76 + index * 4, true); if (value >= 0) difat.push(value); }
    let difatSector = view.getInt32(68, true);
    for (let guard = 0; difatSector >= 0 && guard < 4096; guard += 1) {
        const base = sectorOffset(difatSector);
        if (base < 0 || base + sectorSize > bytes.length) break;
        for (let index = 0; index < sectorSize / 4 - 1; index += 1) { const value = view.getInt32(base + index * 4, true); if (value >= 0) difat.push(value); }
        difatSector = view.getInt32(base + sectorSize - 4, true);
    }
    const fat: number[] = [];
    for (const sector of difat) for (let index = 0; index < sectorSize / 4; index += 1) {
        const offset = sectorOffset(sector) + index * 4;
        if (offset >= 0 && offset + 4 <= bytes.length) fat.push(view.getInt32(offset, true));
    }
    const chain = (start: number, table: readonly number[]): number[] => {
        const sectors: number[] = [];
        for (let sector = start; sector >= 0 && sectors.length < table.length + 1; sector = table[sector] ?? -2) sectors.push(sector);
        return sectors;
    };
    const readChain = (start: number, size: number): Uint8Array => {
        if (size < 0 || size > MAX_ENTRY_BYTES) {
            throw new DocumentTextError('invalid', 'OLE stream size exceeds limit', 'DOCUMENT_ENTRY_TOO_LARGE', { maxMB: 64 });
        }
        const output = new Uint8Array(size);
        let written = 0;
        for (const sector of chain(start, fat)) {
            const offset = sectorOffset(sector), length = Math.min(sectorSize, size - written);
            if (length <= 0 || offset < 0 || offset >= bytes.length) break;
            const slice = bytes.subarray(offset, Math.min(bytes.length, offset + length));
            output.set(slice, written);
            written += slice.length;
        }
        return output.subarray(0, written);
    };
    const directoryChain = chain(view.getInt32(48, true), fat);
    const directoryBytes = readChain(view.getInt32(48, true), Math.min(MAX_ENTRY_BYTES, directoryChain.length * sectorSize));
    const entries: { name: string; type: number; start: number; size: number }[] = [];
    for (let offset = 0; offset + 128 <= directoryBytes.length; offset += 128) {
        const entry = new DataView(directoryBytes.buffer, directoryBytes.byteOffset + offset, 128);
        const nameLength = Math.min(64, entry.getUint16(64, true));
        const name = new TextDecoder('utf-16le').decode(directoryBytes.subarray(offset, offset + Math.max(0, nameLength - 2)));
        entries.push({ name, type: entry.getUint8(66), start: entry.getInt32(116, true), size: entry.getUint32(120, true) });
    }
    const root = entries.find(entry => entry.type === 5);
    const miniStream = root ? readChain(root.start, root.size) : new Uint8Array(0);
    const miniFatStart = view.getInt32(60, true), cutoff = view.getUint32(56, true) || 4096;
    const miniFatBytes = miniFatStart >= 0 ? readChain(miniFatStart, Math.min(MAX_ENTRY_BYTES, chain(miniFatStart, fat).length * sectorSize)) : new Uint8Array(0);
    const miniFat = Array.from({ length: Math.floor(miniFatBytes.length / 4) }, (_, index) => new DataView(miniFatBytes.buffer, miniFatBytes.byteOffset).getInt32(index * 4, true));
    const streams = new Map<string, Uint8Array>();
    for (const entry of entries) {
        if (entry.type !== 2) continue;
        if (entry.size < 0 || entry.size > MAX_ENTRY_BYTES) {
            throw new DocumentTextError('invalid', 'OLE stream size exceeds limit', 'DOCUMENT_ENTRY_TOO_LARGE', { maxMB: 64 });
        }
        if (entry.size < cutoff) {
            const output = new Uint8Array(entry.size);
            let written = 0;
            for (const sector of chain(entry.start, miniFat)) {
                const miniOffset = sector * miniSectorSize;
                const length = Math.min(miniSectorSize, entry.size - written);
                if (length <= 0 || miniOffset < 0 || miniOffset >= miniStream.length) break;
                const slice = miniStream.subarray(miniOffset, Math.min(miniStream.length, miniOffset + length));
                output.set(slice, written);
                written += slice.length;
            }
            streams.set(entry.name, output.subarray(0, written));
        } else streams.set(entry.name, readChain(entry.start, entry.size));
    }
    return streams;
}

const cp1252 = new TextDecoder('windows-1252');

/** Main document text of a Word 97-2003 file from its piece table. */
export function wordBinaryText(bytes: Uint8Array): string {
    const streams = readCompoundFile(bytes);
    const document = streams.get('WordDocument');
    if (!document || document.length < 0x1aa) throw new DocumentTextError('invalid', 'Not a Word document', 'DOCUMENT_FORMAT_INVALID', { format: 'Word' });
    const fib = new DataView(document.buffer, document.byteOffset, document.byteLength);
    if (fib.getUint16(0, true) !== 0xa5ec) throw new DocumentTextError('invalid', 'Not a Word 97-2003 document', 'DOCUMENT_FORMAT_INVALID', { format: 'Word 97–2003' });
    if (fib.getUint16(0x0a, true) & 0x0100) throw new DocumentTextError('encrypted', 'The Word document is encrypted', 'DOCUMENT_ENCRYPTED', { format: 'Word' });
    const table = streams.get(fib.getUint16(0x0a, true) & 0x0200 ? '1Table' : '0Table');
    const ccpText = fib.getInt32(0x4c, true);
    const fcClx = fib.getUint32(0x1a2, true), lcbClx = fib.getUint32(0x1a6, true);
    if (!table || !lcbClx || fcClx >= table.length || fcClx + lcbClx > table.length) throw new DocumentTextError('invalid', 'The Word piece table is missing', 'DOCUMENT_WORD_TABLE_MISSING');
    const clx = new DataView(table.buffer, table.byteOffset + fcClx, lcbClx);
    let offset = 0;
    while (offset + 3 <= lcbClx && clx.getUint8(offset) === 1) offset += 3 + clx.getUint16(offset + 1, true);
    if (offset + 5 > lcbClx || clx.getUint8(offset) !== 2) throw new DocumentTextError('invalid', 'The Word piece table is damaged', 'DOCUMENT_WORD_TABLE_DAMAGED');
    const lcb = clx.getUint32(offset + 1, true), plc = offset + 5;
    const pieces = Math.floor((lcb - 4) / 12);
    if (pieces < 0 || plc + (pieces + 1) * 4 + pieces * 8 > lcbClx) {
        throw new DocumentTextError('invalid', 'The Word piece table is damaged', 'DOCUMENT_WORD_TABLE_DAMAGED');
    }
    let text = '';
    for (let index = 0; index < pieces && text.length < ccpText; index += 1) {
        const cpStart = clx.getUint32(plc + index * 4, true), cpEnd = clx.getUint32(plc + (index + 1) * 4, true);
        const pcd = plc + (pieces + 1) * 4 + index * 8;
        const fcValue = clx.getUint32(pcd + 2, true);
        const compressed = (fcValue & 0x40000000) !== 0;
        const length = Math.min(cpEnd - cpStart, ccpText - text.length);
        if (length <= 0) continue;
        if (compressed) {
            const fc = (fcValue & 0x3fffffff) / 2;
            text += cp1252.decode(document.subarray(fc, fc + length));
        } else {
            const fc = fcValue & 0x3fffffff;
            text += new TextDecoder('utf-16le').decode(document.subarray(fc, fc + length * 2));
        }
    }
    // Field codes (between 0x13 and 0x14) are instructions, not content.
    return text.replace(/\u0013[^\u0014\u0015]*\u0014?/g, '').replace(/[\u0014\u0015]/g, '')
        .replace(/\u0007/g, '\t').replace(/\r|\u000b/g, '\n').replace(/\u000c/g, '\n\n').replace(/[\u0000-\u0008\u000e-\u001f]/g, '');
}

// ---------------------------------------------------------------------------
// PDF text layer

interface PdfObject { readonly body: string; readonly stream?: Uint8Array }
type CMap = { readonly map: Map<number, string>; readonly widths: readonly number[] };

const latin1 = new TextDecoder('latin1');

function pdfStreamData(raw: Uint8Array, dictionary: string): Uint8Array | undefined {
    const filters = [...(/\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(dictionary)?.[1] || '').matchAll(/\/(\w+)/g)].map(match => match[1]);
    let data = raw;
    for (const filter of filters) {
        if (filter === 'FlateDecode' || filter === 'Fl') {
            try { data = new Uint8Array(inflateSync(data, { maxOutputLength: MAX_ENTRY_BYTES })); }
            catch {
                try { data = new Uint8Array(inflateSync(data, { finishFlush: 2, maxOutputLength: MAX_ENTRY_BYTES })); } catch { return undefined; }
            }
            const predictor = Number(/\/Predictor\s+(\d+)/.exec(dictionary)?.[1] || 1);
            if (predictor >= 10) data = pngUnpredict(data, Number(/\/Columns\s+(\d+)/.exec(dictionary)?.[1] || 1));
        } else if (filter === 'ASCII85Decode' || filter === 'A85') {
            data = ascii85(data);
        } else if (filter === 'ASCIIHexDecode' || filter === 'AHx') {
            const hex = latin1.decode(data).replace(/[^0-9a-f]/gi, '');
            data = Uint8Array.from(hex.match(/../g) || [], pair => parseInt(pair, 16));
        } else return undefined; // images (DCT/JPX/CCITT) and others hold no text
    }
    return data;
}

function ascii85(input: Uint8Array): Uint8Array {
    const source = latin1.decode(input).replace(/\s+/g, '').replace(/^<~/, '').replace(/~>.*$/, '');
    const output: number[] = [];
    let group: number[] = [];
    for (const character of source) {
        if (character === 'z' && !group.length) { output.push(0, 0, 0, 0); continue; }
        const code = character.charCodeAt(0) - 33;
        if (code < 0 || code > 84) continue;
        group.push(code);
        if (group.length === 5) {
            let value = 0;
            for (const digit of group) value = value * 85 + digit;
            output.push((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
            group = [];
        }
    }
    if (group.length) {
        const missing = 5 - group.length;
        while (group.length < 5) group.push(84);
        let value = 0;
        for (const digit of group) value = value * 85 + digit;
        output.push(...[(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].slice(0, 4 - missing));
    }
    return Uint8Array.from(output);
}

function pngUnpredict(data: Uint8Array, columns: number): Uint8Array {
    const rowLength = columns + 1, rows = Math.floor(data.length / rowLength);
    const output = new Uint8Array(rows * columns);
    for (let row = 0; row < rows; row += 1) {
        const type = data[row * rowLength];
        for (let column = 0; column < columns; column += 1) {
            const raw = data[row * rowLength + 1 + column];
            const up = row ? output[(row - 1) * columns + column] : 0;
            const left = column ? output[row * columns + column - 1] : 0;
            output[row * columns + column] = (type === 2 ? raw + up : type === 1 ? raw + left : raw) & 0xff;
        }
    }
    return output;
}

function pdfObjects(bytes: Uint8Array): Map<number, PdfObject> {
    const text = latin1.decode(bytes);
    const objects = new Map<number, PdfObject>();
    const pattern = /(\d+)\s+(\d+)\s+obj\b/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
        const start = match.index + match[0].length;
        const end = text.indexOf('endobj', start);
        if (end < 0) break;
        let body = text.slice(start, end);
        let stream: Uint8Array | undefined;
        const streamAt = body.search(/\bstream\r?\n/);
        if (streamAt >= 0) {
            const dictionary = body.slice(0, streamAt);
            const dataStart = start + streamAt + (/\bstream\r\n/.test(body.slice(streamAt, streamAt + 8)) ? 8 : 7);
            const declared = Number(/\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dictionary)?.[1]);
            const endStream = text.indexOf('endstream', dataStart);
            const dataEnd = Number.isFinite(declared) && declared > 0 && dataStart + declared <= endStream + 2 ? dataStart + declared : endStream;
            stream = pdfStreamData(bytes.subarray(dataStart, Math.max(dataStart, dataEnd)), dictionary);
            body = dictionary;
        }
        objects.set(Number(match[1]), { body, stream });
        pattern.lastIndex = end + 6;
    }
    // Objects packed into object streams (PDF 1.5+).
    for (const object of [...objects.values()]) {
        if (!/\/Type\s*\/ObjStm/.test(object.body) || !object.stream) continue;
        const first = Number(/\/First\s+(\d+)/.exec(object.body)?.[1] || 0);
        const count = Number(/\/N\s+(\d+)/.exec(object.body)?.[1] || 0);
        const content = latin1.decode(object.stream);
        const header = content.slice(0, first).trim().split(/\s+/).map(Number);
        for (let index = 0; index < count; index += 1) {
            const number = header[index * 2], offset = header[index * 2 + 1], next = header[index * 2 + 3];
            if (!Number.isFinite(number) || objects.has(number)) continue;
            objects.set(number, { body: content.slice(first + offset, Number.isFinite(next) ? first + next : undefined) });
        }
    }
    return objects;
}

const reference = (body: string, key: string): number | undefined => {
    const match = new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`).exec(body);
    return match ? Number(match[1]) : undefined;
};

/** Inline dictionary value `/Key << ... >>` with nesting, or the referenced object's body. */
function dictionaryValue(body: string, key: string, objects: Map<number, PdfObject>): string | undefined {
    const at = body.search(new RegExp(`/${key}\\s*<<`));
    if (at >= 0) {
        let depth = 0, index = body.indexOf('<<', at);
        const start = index;
        for (; index < body.length - 1; index += 1) {
            if (body.startsWith('<<', index)) { depth += 1; index += 1; }
            else if (body.startsWith('>>', index)) { depth -= 1; index += 1; if (!depth) return body.slice(start, index + 1); }
        }
    }
    const ref = reference(body, key);
    return ref !== undefined ? objects.get(ref)?.body : undefined;
}

function parseCMap(data: string): CMap {
    const map = new Map<number, string>();
    const hexToText = (hex: string): string => {
        let out = '';
        for (let index = 0; index + 3 < hex.length + 1; index += 4) {
            const unit = parseInt(hex.slice(index, index + 4).padEnd(4, '0'), 16);
            out += String.fromCharCode(unit);
        }
        return hex.length === 2 ? String.fromCharCode(parseInt(hex, 16)) : out;
    };
    const widths = new Set<number>();
    for (const range of data.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) {
        for (const pair of range[1].matchAll(/<([0-9a-f]+)>\s*<[0-9a-f]+>/gi)) widths.add(pair[1].length / 2);
    }
    for (const block of data.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
        for (const pair of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]*)>/gi)) { map.set(parseInt(pair[1], 16), hexToText(pair[2])); widths.add(pair[1].length / 2); }
    }
    for (const block of data.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
        for (const range of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(\[[^\]]*\]|<[0-9a-f]*>)/gi)) {
            const low = parseInt(range[1], 16), high = parseInt(range[2], 16);
            widths.add(range[1].length / 2);
            if (high - low > 65_535) continue;
            if (range[3].startsWith('[')) {
                [...range[3].matchAll(/<([0-9a-f]*)>/gi)].forEach((item, offset) => map.set(low + offset, hexToText(item[1])));
            } else {
                const base = range[3].slice(1, -1);
                const prefix = base.slice(0, -4), last = parseInt(base.slice(-4) || '0', 16);
                for (let code = low; code <= high; code += 1) {
                    map.set(code, base.length <= 4 ? String.fromCharCode(last + code - low) : hexToText(prefix) + String.fromCharCode(last + code - low));
                }
            }
        }
    }
    return { map, widths: [...widths].sort((a, b) => b - a) };
}

/** Standard Latin text for simple fonts without a ToUnicode map (WinAnsi approximation). */
const winAnsi = (code: number): string => ({ 0x80: '€', 0x82: '‚', 0x84: '„', 0x85: '…', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x99: '™' } as Record<number, string>)[code] ?? String.fromCharCode(code);

const UTF16_CMAP: CMap = { map: new Map(), widths: [] };

function decodePdfString(bytes: readonly number[], cmap: CMap | undefined, twoByte: boolean): string {
    if (cmap === UTF16_CMAP) {
        let out = '';
        for (let index = 0; index + 1 < bytes.length; index += 2) out += String.fromCharCode(bytes[index] * 256 + bytes[index + 1]);
        return out;
    }
    if (!cmap || !cmap.map.size) {
        if (twoByte) return '';
        return bytes.map(winAnsi).join('');
    }
    let out = '';
    for (let index = 0; index < bytes.length;) {
        let matched = false;
        for (const width of cmap.widths.length ? cmap.widths : [twoByte ? 2 : 1]) {
            if (index + width > bytes.length) continue;
            let code = 0;
            for (let offset = 0; offset < width; offset += 1) code = code * 256 + bytes[index + offset];
            const mapped = cmap.map.get(code);
            if (mapped !== undefined) { out += mapped; index += width; matched = true; break; }
        }
        if (!matched) { if (!twoByte && bytes[index] >= 32) out += winAnsi(bytes[index]); index += twoByte ? 2 : 1; }
    }
    return out;
}

function literalString(source: string, start: number): { bytes: number[]; end: number } {
    const bytes: number[] = [];
    let depth = 1, index = start + 1;
    for (; index < source.length && depth > 0; index += 1) {
        const character = source[index];
        if (character === '\\') {
            const next = source[index + 1];
            const escapes: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
            if (next in escapes) { bytes.push(escapes[next]); index += 1; }
            else if (/[0-7]/.test(next)) { const octal = /^[0-7]{1,3}/.exec(source.slice(index + 1))![0]; bytes.push(parseInt(octal, 8) & 0xff); index += octal.length; }
            else if (next === '\r' || next === '\n') { index += next === '\r' && source[index + 2] === '\n' ? 2 : 1; }
            continue;
        }
        if (character === '(') depth += 1;
        if (character === ')') { depth -= 1; if (!depth) break; }
        bytes.push(character.charCodeAt(0) & 0xff);
    }
    return { bytes, end: index };
}

function contentText(content: string, fonts: Map<string, { cmap?: CMap; twoByte: boolean }>): string {
    let output = '', font: { cmap?: CMap; twoByte: boolean } | undefined;
    // Text line position (Tm/Td/T*); a new line starts when y moves.
    let lineX = 0, lineY = 0, leading = 0, lastY: number | undefined, moved = false;
    const operands: (number | string | number[][] | number[])[] = [];
    const wordLike = /[A-Za-z0-9À-ɏЀ-ӿ]$/;
    const emit = (bytes: number[]): void => {
        const text = decodePdfString(bytes, font?.cmap, font?.twoByte ?? false);
        if (!text) return;
        if (lastY !== undefined && Math.abs(lineY - lastY) > 1.5) output += '\n';
        else if (moved && wordLike.test(output) && /^[A-Za-z0-9À-ɏЀ-ӿ]/.test(text)) output += ' ';
        output += text;
        lastY = lineY; moved = false;
    };
    const numberAt = (offset: number): number => Number(operands[operands.length - offset]) || 0;
    for (let index = 0; index < content.length; index += 1) {
        const character = content[index];
        if (character === '%') { const newline = content.indexOf('\n', index); index = newline < 0 ? content.length : newline; continue; }
        if (character === '(') { const literal = literalString(content, index); operands.push(literal.bytes); index = literal.end; continue; }
        if (character === '<' && content[index + 1] === '<') { const end = content.indexOf('>>', index); index = end < 0 ? content.length : end + 1; continue; }
        if (character === '<') {
            const end = content.indexOf('>', index);
            if (end < 0) break;
            const hex = content.slice(index + 1, end).replace(/\s+/g, '');
            operands.push(Array.from((hex.length % 2 ? `${hex}0` : hex).match(/../g) || [], pair => parseInt(pair, 16)));
            index = end; continue;
        }
        if (character === '[') {
            // TJ array: strings plus kerning numbers; a large negative kern is a word space.
            const items: number[][] = [];
            let cursor = index + 1;
            while (cursor < content.length && content[cursor] !== ']') {
                const at = content[cursor];
                if (at === '(') { const literal = literalString(content, cursor); items.push(literal.bytes); cursor = literal.end + 1; }
                else if (at === '<' && content[cursor + 1] !== '<') {
                    const end = content.indexOf('>', cursor);
                    if (end < 0) { cursor = content.length; break; }
                    const hex = content.slice(cursor + 1, end).replace(/\s+/g, '');
                    items.push(Array.from((hex.length % 2 ? `${hex}0` : hex).match(/../g) || [], pair => parseInt(pair, 16)));
                    cursor = end + 1;
                }
                else if (/[-\d.]/.test(at)) { const number = /^-?\d*\.?\d+/.exec(content.slice(cursor))?.[0] || at; if (Number(number) < -180) items.push([-1]); cursor += number.length; }
                else cursor += 1;
            }
            operands.push(items); index = cursor; continue;
        }
        if (character === '/') { const name = /^\/[^\s/<>[\]()]*/.exec(content.slice(index))![0]; operands.push(name.slice(1)); index += name.length - 1; continue; }
        if (/[-+\d.]/.test(character)) { const number = /^[-+]?\d*\.?\d+/.exec(content.slice(index)); if (number) { operands.push(Number(number[0])); index += number[0].length - 1; } continue; }
        if (/[A-Za-z'"*]/.test(character)) {
            const operator = /^[A-Za-z'"*]+/.exec(content.slice(index))![0];
            index += operator.length - 1;
            switch (operator) {
                case 'BT': lineX = 0; lineY = 0; moved = true; break;
                case 'Tf': font = fonts.get(String(operands[operands.length - 2])); break;
                case 'TL': leading = numberAt(1); break;
                case 'Td': lineX += numberAt(2); lineY += numberAt(1); moved = true; break;
                case 'TD': lineX += numberAt(2); lineY += numberAt(1); leading = -numberAt(1); moved = true; break;
                case 'Tm': lineX = numberAt(2); lineY = numberAt(1); moved = true; break;
                case 'T*': lineY -= leading || 12; moved = true; break;
                case 'Tj': { const value = operands[operands.length - 1]; if (Array.isArray(value)) emit(value as number[]); break; }
                case "'": case '"': { lineY -= leading || 12; moved = true; const value = operands[operands.length - 1]; if (Array.isArray(value)) emit(value as number[]); break; }
                case 'TJ': {
                    const value = operands[operands.length - 1];
                    if (Array.isArray(value)) for (const item of value as number[][]) {
                        if (item.length === 1 && item[0] === -1) { if (!/\s$/.test(output)) output += ' '; }
                        else emit(item);
                    }
                    break;
                }
                case 'BI': { const end = content.indexOf('EI', index); index = end < 0 ? content.length : end + 1; break; }
                default: break;
            }
            void lineX;
            operands.length = 0;
        }
    }
    return output;
}

export function pdfText(bytes: Uint8Array): { text: string; pages: number } {
    const head = latin1.decode(bytes.subarray(0, 4096));
    if (!head.includes('%PDF')) throw new DocumentTextError('invalid', 'Not a PDF file', 'DOCUMENT_FORMAT_INVALID', { format: 'PDF' });
    const objects = pdfObjects(bytes);
    const trailer = latin1.decode(bytes.subarray(Math.max(0, bytes.length - 4096)));
    const encryptRe = /\/Encrypt\s*(?:\d+\s+\d+\s+R|<<)/;
    if (encryptRe.test(trailer) || encryptRe.test(head) || [...objects.values()].some(object => /\/Type\s*\/XRef/.test(object.body) && /\/Encrypt\b/.test(object.body))) {
        throw new DocumentTextError('encrypted', 'The PDF is encrypted', 'DOCUMENT_ENCRYPTED', { format: 'PDF' });
    }
    const cmaps = new Map<number, CMap>();
    const fontInfo = (fontObject: number | undefined, inline?: string): { cmap?: CMap; twoByte: boolean } => {
        const body = inline ?? (fontObject !== undefined ? objects.get(fontObject)?.body || '' : '');
        const twoByte = /\/Subtype\s*\/Type0/.test(body) || /\/Encoding\s*\/Identity-[HV]/.test(body);
        const toUnicode = reference(body, 'ToUnicode');
        if (toUnicode === undefined) {
            // Predefined Unicode CMaps (UniGB-UCS2-H, UniJIS-UTF16-H, …) carry UTF-16 code units directly.
            if (/\/Encoding\s*\/Uni\w*-(UCS2|UTF16)-[HV]/.test(body)) return { twoByte, cmap: UTF16_CMAP };
            return { twoByte };
        }
        if (!cmaps.has(toUnicode)) {
            const stream = objects.get(toUnicode)?.stream;
            cmaps.set(toUnicode, parseCMap(stream ? latin1.decode(stream) : ''));
        }
        return { cmap: cmaps.get(toUnicode), twoByte };
    };
    // Page order from the page tree; inherited resources follow /Parent.
    const pages: number[] = [];
    const visit = (number: number, depth = 0): void => {
        const body = objects.get(number)?.body || '';
        if (depth > 64) return;
        if (/\/Type\s*\/Page\b(?!s)/.test(body)) { pages.push(number); return; }
        const kids = /\/Kids\s*\[([^\]]*)\]/.exec(body)?.[1] || '';
        for (const kid of kids.matchAll(/(\d+)\s+\d+\s+R/g)) visit(Number(kid[1]), depth + 1);
    };
    const catalog = [...objects.entries()].find(([, object]) => /\/Type\s*\/Catalog/.test(object.body));
    const root = catalog ? reference(catalog[1].body, 'Pages') : undefined;
    if (root !== undefined) visit(root);
    if (!pages.length) for (const [number, object] of objects) if (/\/Type\s*\/Page\b(?!s)/.test(object.body)) pages.push(number);
    const resourcesOf = (body: string): string => {
        let current = body;
        for (let depth = 0; depth < 32; depth += 1) {
            const resources = dictionaryValue(current, 'Resources', objects);
            if (resources) return resources;
            const parent = reference(current, 'Parent');
            if (parent === undefined) break;
            current = objects.get(parent)?.body || '';
        }
        return '';
    };
    const texts: string[] = [];
    for (const page of pages.slice(0, 300)) {
        const body = objects.get(page)?.body || '';
        const resources = resourcesOf(body);
        const fontDictionary = dictionaryValue(resources, 'Font', objects) || '';
        const fonts = new Map<string, { cmap?: CMap; twoByte: boolean }>();
        for (const entry of fontDictionary.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)) fonts.set(entry[1], fontInfo(Number(entry[2])));
        const contentRefs = /\/Contents\s*\[([^\]]*)\]/.exec(body)?.[1] ?? /\/Contents\s+(\d+\s+\d+\s+R)/.exec(body)?.[1] ?? '';
        let content = '';
        for (const ref of contentRefs.matchAll(/(\d+)\s+\d+\s+R/g)) {
            const stream = objects.get(Number(ref[1]))?.stream;
            if (stream) content += `${latin1.decode(stream)}\n`;
        }
        // Form XObjects often carry the page text of exported documents.
        const xobjects = dictionaryValue(resources, 'XObject', objects) || '';
        for (const entry of xobjects.matchAll(/\/[^\s/<>[\]()]+\s+(\d+)\s+\d+\s+R/g)) {
            const object = objects.get(Number(entry[1]));
            if (object?.stream && /\/Subtype\s*\/Form/.test(object.body)) {
                const formFonts = dictionaryValue(dictionaryValue(object.body, 'Resources', objects) || '', 'Font', objects) || '';
                for (const font of formFonts.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)) if (!fonts.has(font[1])) fonts.set(font[1], fontInfo(Number(font[2])));
                content += `${latin1.decode(object.stream)}\n`;
            }
        }
        texts.push(contentText(content, fonts).replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim());
    }
    return { text: texts.map((text, index) => pages.length > 1 ? `[Page ${index + 1}]\n${text}` : text).join('\n\n'), pages: pages.length };
}

// ---------------------------------------------------------------------------
// Plain text in an unknown encoding

/** UTF-8/UTF-16 when valid, then GB18030 (covers GBK/GB2312), then Latin-1. */
export function decodeTextBytes(bytes: Uint8Array): string {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    for (const encoding of ['utf-8', 'gb18030', 'shift_jis', 'big5']) {
        try { return new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\ufeff/, '').replace(/\0/g, ''); } catch { /* next */ }
    }
    return latin1.decode(bytes).replace(/\0/g, '');
}

// ---------------------------------------------------------------------------
// Jupyter Notebook (.ipynb), RFC 822 Email (.eml), and SVG (.svg)

function joinNotebookLines(value: unknown): string {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
        return value.map((item, idx) => {
            const line = String(item ?? '');
            return line.endsWith('\n') || idx === value.length - 1 ? line : `${line}\n`;
        }).join('');
    }
    return '';
}

export function ipynbText(raw: string): string {
    let parsed: {
        cells?: Array<{
            cell_type?: string;
            source?: unknown;
            outputs?: Array<{
                output_type?: string;
                text?: unknown;
                data?: Record<string, unknown>;
                ename?: string;
                evalue?: string;
                traceback?: unknown;
            }>;
        }>;
        metadata?: {
            kernelspec?: { language?: string };
            language_info?: { name?: string };
        };
    };
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new DocumentTextError('invalid', 'Invalid Jupyter notebook JSON', 'DOCUMENT_FORMAT_INVALID', { format: 'IPYNB' });
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cells)) {
        throw new DocumentTextError('invalid', 'Invalid Jupyter notebook structure', 'DOCUMENT_FORMAT_INVALID', { format: 'IPYNB' });
    }
    const language = (parsed.metadata?.kernelspec?.language || parsed.metadata?.language_info?.name || 'python').trim();
    const sections: string[] = [];
    for (const cell of parsed.cells) {
        if (!cell || typeof cell !== 'object') continue;
        const source = joinNotebookLines(cell.source).trim();
        if (cell.cell_type === 'markdown' || cell.cell_type === 'raw') {
            if (source) sections.push(source);
            continue;
        }
        if (cell.cell_type === 'code') {
            const parts: string[] = [];
            if (source) {
                parts.push(`\`\`\`${language}\n${source}\n\`\`\``);
            }
            const outputBlocks: string[] = [];
            for (const output of Array.isArray(cell.outputs) ? cell.outputs : []) {
                if (!output || typeof output !== 'object') continue;
                if (output.output_type === 'stream') {
                    const text = joinNotebookLines(output.text).trim();
                    if (text) outputBlocks.push(text);
                } else if (output.output_type === 'execute_result' || output.output_type === 'display_data') {
                    const md = joinNotebookLines(output.data?.['text/markdown']).trim();
                    const plain = joinNotebookLines(output.data?.['text/plain']).trim();
                    if (md) outputBlocks.push(md);
                    else if (plain) outputBlocks.push(plain);
                } else if (output.output_type === 'error') {
                    const trace = joinNotebookLines(output.traceback).replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim();
                    const header = `${output.ename || 'Error'}: ${output.evalue || ''}`.trim();
                    outputBlocks.push(trace ? `${header}\n${trace}` : header);
                }
            }
            if (outputBlocks.length) {
                parts.push(`**Output:**\n\`\`\`text\n${outputBlocks.join('\n')}\n\`\`\``);
            }
            if (parts.length) sections.push(parts.join('\n\n'));
        }
    }
    return sections.join('\n\n');
}

function decodeQuotedPrintableBytes(input: string): Uint8Array {
    const cleaned = input.replace(/=\r?\n/g, '');
    const bytes: number[] = [];
    for (let i = 0; i < cleaned.length; i += 1) {
        if (cleaned[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(cleaned.slice(i + 1, i + 3))) {
            bytes.push(parseInt(cleaned.slice(i + 1, i + 3), 16));
            i += 2;
        } else {
            bytes.push(cleaned.charCodeAt(i) & 0xff);
        }
    }
    return Uint8Array.from(bytes);
}

function decodeRfc2047(value: string): string {
    return value.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_, _charset: string, encoding: string, payload: string) => {
        try {
            if (encoding.toUpperCase() === 'B') {
                return decodeTextBytes(Uint8Array.from(Buffer.from(payload, 'base64')));
            }
            const qCleaned = payload.replace(/_/g, ' ');
            return decodeTextBytes(decodeQuotedPrintableBytes(qCleaned));
        } catch {
            return payload;
        }
    });
}

function parseMimeHeaders(headerBlock: string): Map<string, string> {
    const unfolded = headerBlock.replace(/\r?\n[ \t]+/g, ' ');
    const headers = new Map<string, string>();
    for (const line of unfolded.split(/\r?\n/)) {
        const colon = line.indexOf(':');
        if (colon <= 0) continue;
        const key = line.slice(0, colon).trim().toLowerCase();
        const val = decodeRfc2047(line.slice(colon + 1).trim());
        headers.set(key, headers.has(key) ? `${headers.get(key)}, ${val}` : val);
    }
    return headers;
}

function extractMimeBody(rawPart: string): { plain: string[]; html: string[]; attachments: string[] } {
    const normalized = rawPart.replace(/\r\n/g, '\n');
    const splitAt = normalized.indexOf('\n\n');
    const headerBlock = splitAt >= 0 ? normalized.slice(0, splitAt) : '';
    const bodyBlock = splitAt >= 0 ? normalized.slice(splitAt + 2) : normalized;
    const headers = parseMimeHeaders(headerBlock);
    const contentType = headers.get('content-type') || 'text/plain';
    const disposition = headers.get('content-disposition') || '';
    const transferEncoding = (headers.get('content-transfer-encoding') || '').toLowerCase().trim();

    const boundaryMatch = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
    if (/^multipart\//i.test(contentType) && boundaryMatch) {
        const boundary = boundaryMatch[1] || boundaryMatch[2];
        const delimiter = `--${boundary}`;
        const rawSegments = bodyBlock.split(delimiter).slice(1);
        const plain: string[] = [];
        const html: string[] = [];
        const attachments: string[] = [];
        for (const segment of rawSegments) {
            if (segment.startsWith('--')) break;
            const trimmedSegment = segment.replace(/^\n/, '').replace(/\n$/, '');
            if (!trimmedSegment.trim()) continue;
            const sub = extractMimeBody(trimmedSegment);
            plain.push(...sub.plain);
            html.push(...sub.html);
            attachments.push(...sub.attachments);
        }
        if (/^multipart\/alternative/i.test(contentType) && plain.length) {
            return { plain, html: [], attachments };
        }
        return { plain, html, attachments };
    }

    const filenameMatch = /filename\*?=(?:"([^"]+)"|([^;\s]+))/i.exec(disposition) || /name=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
    const filename = filenameMatch ? decodeRfc2047(filenameMatch[1] || filenameMatch[2]) : '';
    if (/^attachment/i.test(disposition) || (filename && !/^text\/(plain|html)/i.test(contentType))) {
        return {
            plain: [],
            html: [],
            attachments: [filename ? `${filename} (${contentType.split(';')[0].trim()})` : contentType.split(';')[0].trim()]
        };
    }

    let decodedText = bodyBlock;
    if (transferEncoding === 'base64') {
        try {
            decodedText = decodeTextBytes(Uint8Array.from(Buffer.from(bodyBlock.replace(/\s+/g, ''), 'base64')));
        } catch {
            decodedText = bodyBlock;
        }
    } else if (transferEncoding === 'quoted-printable') {
        decodedText = decodeTextBytes(decodeQuotedPrintableBytes(bodyBlock));
    }

    if (/^text\/html/i.test(contentType)) {
        const converted = htmlToText(decodedText);
        return { plain: [], html: converted ? [converted] : [], attachments: [] };
    }
    if (/^text\//i.test(contentType) || !headers.has('content-type')) {
        return { plain: decodedText.trim() ? [decodedText.trim()] : [], html: [], attachments: [] };
    }
    return { plain: [], html: [], attachments: [] };
}

export function emlText(bytes: Uint8Array): string {
    const raw = decodeTextBytes(bytes).replace(/\r\n/g, '\n');
    const splitAt = raw.indexOf('\n\n');
    const headerBlock = splitAt >= 0 ? raw.slice(0, splitAt) : '';
    const headers = parseMimeHeaders(headerBlock);
    const headerLines: string[] = [];
    for (const [key, label] of [
        ['from', 'From'],
        ['to', 'To'],
        ['cc', 'Cc'],
        ['date', 'Date'],
        ['subject', 'Subject']
    ] as const) {
        const value = headers.get(key);
        if (value) headerLines.push(`- **${label}**: ${value}`);
    }
    const { plain, html, attachments } = extractMimeBody(raw);
    const bodySections = [...plain, ...html];
    const parts: string[] = [];
    if (headerLines.length) parts.push(headerLines.join('\n'));
    if (bodySections.length) parts.push(bodySections.join('\n\n'));
    if (attachments.length) parts.push(`### Attachments\n${attachments.map(item => `- ${item}`).join('\n')}`);
    return parts.join('\n\n');
}

export function svgText(raw: string): string {
    const svgTag = /<svg\b([^>]*)>/i.exec(raw)?.[1] || '';
    const attr = (name: string): string => new RegExp(`\\b${name}=["']([^"']+)["']`, 'i').exec(svgTag)?.[1]?.trim() || '';
    const width = attr('width');
    const height = attr('height');
    const viewBox = attr('viewBox');
    const ariaLabel = decodeXmlEntities(attr('aria-label'));
    const title = decodeXmlEntities((/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(raw)?.[1] || '').replace(/<[^>]+>/g, '').trim());
    const desc = decodeXmlEntities((/<desc\b[^>]*>([\s\S]*?)<\/desc>/i.exec(raw)?.[1] || '').replace(/<[^>]+>/g, '').trim());

    const textNodes = [...raw.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi)]
        .map(match => decodeXmlEntities(match[1].replace(/<\/tspan>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/[ \t\r\n]+/g, ' ').trim())
        .filter(Boolean);

    const meta: string[] = [];
    if (title) meta.push(`- **Title**: ${title}`);
    if (desc) meta.push(`- **Description**: ${desc}`);
    if (ariaLabel) meta.push(`- **Aria-Label**: ${ariaLabel}`);
    if (width || height) meta.push(`- **Dimensions**: ${width || 'auto'} × ${height || 'auto'}`);
    if (viewBox) meta.push(`- **ViewBox**: \`${viewBox}\``);

    const shapeCounts = (['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'g'] as const)
        .map(tag => [tag, [...raw.matchAll(new RegExp(`<${tag}\\b`, 'gi'))].length] as const)
        .filter(([, count]) => count > 0)
        .map(([tag, count]) => `${count} <${tag}>`);
    if (shapeCounts.length) meta.push(`- **Elements**: ${shapeCounts.join(', ')}`);

    const sections = ['## SVG Document'];
    if (meta.length) sections.push(meta.join('\n'));
    if (textNodes.length) sections.push(`### Text Labels\n${textNodes.map(line => `- ${line}`).join('\n')}`);
    return sections.join('\n\n');
}

// ---------------------------------------------------------------------------
// Entry point

export function extensionOf(name: string): string {
    const base = name.toLowerCase();
    const index = base.lastIndexOf('.');
    return index > 0 ? base.slice(index + 1) : '';
}

/** Formats this module turns into text for models without native support. */
export const EXTRACTABLE_EXTENSIONS: ReadonlySet<string> = new Set(['pdf', 'docx', 'docm', 'dotx', 'xlsx', 'xlsm', 'xltx', 'pptx', 'pptm', 'ppsx',
    'odt', 'ods', 'odp', 'ott', 'epub', 'rtf', 'zip', 'doc', 'xls', 'ppt', 'pages', 'numbers', 'key', 'html', 'htm', 'xhtml', 'eml', 'ipynb', 'svg']);

export function extractDocumentText(name: string, bytes: Uint8Array, mimeType = '', maxCharacters = MAX_TEXT): ExtractedDocument {
    return boundedDocumentText(extractFullDocumentText(name, bytes, mimeType), maxCharacters);
}

function extractFullDocumentText(name: string, bytes: Uint8Array, mimeType: string): ExtractedDocument {
    const extension = extensionOf(name);
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
    if (extension === 'pdf' || mimeType === 'application/pdf' || latin1.decode(bytes.subarray(0, 5)) === '%PDF-') {
        const { text, pages } = pdfText(bytes);
        if (!text.replace(/\[Page \d+\]|\s/g, '')) throw new DocumentTextError('empty', 'The PDF has no text layer (it may be a scan)', 'DOCUMENT_PDF_NO_TEXT');
        return finish(text, 'pdf', { pages });
    }
    if (extension === 'ipynb' || mimeType === 'application/x-ipynb+json') {
        return finish(ipynbText(decodeTextBytes(bytes)), 'ipynb');
    }
    if (extension === 'eml' || mimeType === 'message/rfc822') {
        return finish(emlText(bytes), 'eml');
    }
    if (extension === 'svg' || mimeType === 'image/svg+xml') {
        return finish(svgText(decodeTextBytes(bytes)), 'svg');
    }
    if (['html', 'htm', 'xhtml'].includes(extension)) return finish(htmlToText(decodeTextBytes(bytes)), 'text');
    if (extension === 'rtf' || latin1.decode(bytes.subarray(0, 5)) === '{\\rtf') return finish(rtfText(latin1.decode(bytes)), 'rtf');
    if (isZip) {
        const entries = readZip(bytes);
        if (entries.has('word/document.xml')) return finish(docxText(entries), 'docx');
        if (entries.has('xl/workbook.xml')) return finish(xlsxText(entries), 'xlsx');
        if ([...entries.keys()].some(entry => entry.startsWith('ppt/slides/'))) return finish(pptxText(entries), 'pptx');
        if (entries.has('content.xml') && (readText(entries, 'mimetype') || '').includes('opendocument')) return finish(odfText(entries), 'odf');
        if (entries.has('META-INF/container.xml')) return finish(epubText(entries), 'epub');
        // iWork documents embed a PDF preview when saved with one.
        const preview = entries.get('QuickLook/Preview.pdf');
        if (preview) return finish(pdfText(preview.read()).text, 'pdf', { note: 'Text read from the document preview' });
        return finish(zipListing(entries), 'zip');
    }
    if (['doc', 'xls', 'ppt'].includes(extension) || (bytes[0] === 0xd0 && bytes[1] === 0xcf)) {
        try {
            const streams = readCompoundFile(bytes);
            if (streams.has('WordDocument')) return finish(wordBinaryText(bytes), 'doc');
            // Excel/PowerPoint 97-2003: readable strings from the workbook or slide stream.
            const stream = streams.get('Workbook') || streams.get('Book') || streams.get('PowerPoint Document');
            if (stream) return finish(binaryStrings(stream), 'strings', { note: 'Recovered text from a legacy Office binary; layout is not preserved' });
        } catch (error) {
            if (error instanceof DocumentTextError && error.code === 'encrypted') throw error;
        }
        return finish(binaryStrings(bytes), 'strings', { note: 'Recovered text from a legacy Office binary; formatting and some characters may be missing' });
    }
    throw new DocumentTextError('unsupported', 'No text extractor for this format', 'DOCUMENT_UNSUPPORTED');
}

const TEXT_ENTRY = /\.(txt|md|markdown|csv|tsv|json|jsonl|ya?ml|toml|xml|html?|css|scss|less|js|jsx|mjs|cjs|ts|tsx|py|go|rs|java|kt|c|h|cpp|hpp|cc|cs|rb|php|swift|sh|bash|zsh|sql|ini|cfg|conf|log|env\.example|gradle|properties|vue|svelte|dart|lua|r|scala|tex|rst|adoc|proto|graphql)$/i;

function zipListing(entries: Map<string, ZipEntry>): string {
    const names = [...entries.keys()].filter(name => !/(^|\/)(__MACOSX|\.DS_Store|node_modules|\.git)(\/|$)/.test(name)).sort(naturalOrder);
    let budget = MAX_TEXT - 8_000;
    const sections = [`Archive contents (${names.length} files):`, ...names.slice(0, 500).map(name => `  ${name}`)];
    if (names.length > 500) sections.push(`  … ${names.length - 500} more`);
    for (const name of names) {
        if (budget <= 0 || !TEXT_ENTRY.test(name)) continue;
        let content: string;
        try {
            const data = entries.get(name)!.read();
            if (data.length > 512 * 1024 || data.subarray(0, 4096).includes(0)) continue;
            content = new TextDecoder('utf-8', { fatal: true }).decode(data);
        } catch { continue; }
        const clipped = content.slice(0, Math.min(24_000, budget));
        sections.push(`\n### ${name}\n${clipped}`);
        budget -= clipped.length + name.length + 8;
    }
    return sections.join('\n');
}
