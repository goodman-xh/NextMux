import { inflateRawSync, inflateSync } from 'node:zlib';

export interface RuntimeExtractedDocument {
  readonly method: 'pdf' | 'docx' | 'doc' | 'xlsx' | 'pptx' | 'odf' | 'epub' | 'rtf' | 'zip' | 'strings';
  readonly markdown: string;
}

const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const utf8 = new TextDecoder('utf-8');
const latin1 = new TextDecoder('latin1');

interface ZipEntry {
  readonly name: string;
  read(): Uint8Array;
}

function readZip(bytes: Uint8Array): Map<string, ZipEntry> | undefined {
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      end = offset;
      break;
    }
  }
  if (end < 0) return undefined;
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
    const name = (flags & 0x800 ? utf8.decode(nameBytes) : latin1.decode(nameBytes)).replace(/\\/g, '/');
    pointer += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    entries.set(name, {
      name,
      read: () => {
        if (flags & 0x1 || size > MAX_ENTRY_BYTES || compressedSize > MAX_ENTRY_BYTES) return new Uint8Array(0);
        if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) return new Uint8Array(0);
        const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        if (dataStart < 0 || dataStart + compressedSize > bytes.length) return new Uint8Array(0);
        const data = bytes.subarray(dataStart, dataStart + compressedSize);
        if (method === 0) return data;
        if (method === 8) {
          try {
            return new Uint8Array(inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES }));
          } catch {
            return new Uint8Array(0);
          }
        }
        return new Uint8Array(0);
      }
    });
  }
  return entries;
}

function readZipText(entries: Map<string, ZipEntry>, name: string): string | undefined {
  const entry = entries.get(name);
  return entry ? utf8.decode(entry.read()) : undefined;
}

function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith('#x') || lower.startsWith('#')) {
      const code = lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
        ? String.fromCodePoint(code)
        : '\uFFFD';
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[lower] ?? match;
  });
}

function xmlToText(xml: string, breaks: RegExp, tabs?: RegExp): string {
  let text = xml.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g, '');
  if (tabs) text = text.replace(tabs, '\t');
  text = text.replace(breaks, '\n').replace(/<[^>]+>/g, '');
  return decodeXmlEntities(text);
}

const naturalOrder = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true });

function docxMarkdown(entries: Map<string, ZipEntry>): string {
  const parts = ['word/document.xml', ...[...entries.keys()].filter(name => /^word\/(header|footer|footnotes|endnotes|comments)\d*\.xml$/.test(name)).sort(naturalOrder)];
  const styleNames = new Map(
    [...(readZipText(entries, 'word/styles.xml') || '').matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>[\s\S]*?<w:name\b[^>]*w:val="([^"]+)"/g)].map(
      match => [match[1], decodeXmlEntities(match[2])] as const
    )
  );
  return parts
    .map(name => {
      const raw = readZipText(entries, name);
      if (!raw) return '';
      const xml = raw.replace(/<w:p\b([^>]*)>([\s\S]*?)<\/w:p>/g, (paragraph, attributes: string, body: string) => {
        const styleId = /<w:pStyle\b[^>]*w:val="([^"]+)"/.exec(body)?.[1] || '';
        const style = styleNames.get(styleId) || styleId;
        const heading = /^heading\s*([1-6])$/i.exec(style)?.[1] || (/^title$/i.test(style) ? '1' : '');
        const marker = heading ? `${'#'.repeat(Number(heading))} ` : /<w:numPr\b/.test(body) || /^list\s*(?:bullet|number|paragraph)/i.test(style) ? '- ' : '';
        if (!marker || !/<w:t\b/.test(body)) return paragraph;
        const at = body.search(/<w:r\b/);
        return at < 0 ? paragraph : `<w:p${attributes}>${body.slice(0, at)}<w:r><w:t>${marker}</w:t></w:r>${body.slice(at)}</w:p>`;
      });
      const cells = xml.replace(/<\/w:p>\s*<\/w:tc>/g, '</w:tc>').replace(/<\/w:tc>/g, ' | </w:tc>').replace(/<\/w:tr>/g, '</w:tr>\n');
      const text = xmlToText(cells, /<\/w:p>|<w:br\b[^>]*\/>|<w:cr\b[^>]*\/>/g, /<w:tab\b[^>]*\/>/g).replace(/ \| *(?=\n|$)/g, '');
      return name === 'word/document.xml' ? text : `\n[${name.replace(/^word\/|\.xml$/g, '')}]\n${text}`;
    })
    .join('\n');
}

function columnIndex(reference: string): number {
  const letters = /^[A-Z]+/.exec(reference)?.[0] || 'A';
  return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function xlsxMarkdown(entries: Map<string, ZipEntry>): string {
  const shared = [...(readZipText(entries, 'xl/sharedStrings.xml') || '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(match =>
    decodeXmlEntities([...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(text => text[1]).join(''))
  );
  const workbook = readZipText(entries, 'xl/workbook.xml') || '';
  const relations = readZipText(entries, 'xl/_rels/workbook.xml.rels') || '';
  const attribute = (tag: string, name: string): string | undefined => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
  const targets = new Map([...relations.matchAll(/<Relationship\b[^>]*>/g)].map(match => [attribute(match[0], 'Id') || '', attribute(match[0], 'Target') || '']));
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*>/g)]
    .map(match => ({
      name: decodeXmlEntities(attribute(match[0], 'name') || 'Sheet'),
      path: (() => {
        const target = targets.get(attribute(match[0], 'r:id') || '') || '';
        return target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
      })()
    }))
    .filter(sheet => entries.has(sheet.path));
  const fallback = [...entries.keys()]
    .filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort(naturalOrder)
    .map((path, index) => ({ name: `Sheet${index + 1}`, path }));
  let rowsWritten = 0;
  return (sheets.length ? sheets : fallback)
    .map(sheet => {
      const xml = readZipText(entries, sheet.path);
      if (!xml) return '';
      const rawRows: Map<number, string>[] = [];
      const occupiedCols = new Set<number>();
      let maxCol = 0;
      let truncatedRows = false;
      for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
        if (rowsWritten >= 5_000) {
          truncatedRows = true;
          break;
        }
        const cells = new Map<number, string>();
        let nextIndex = 0;
        for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const attributes = cell[1];
          const body = cell[2] || '';
          const reference = /\br="([A-Z]+)\d+"/.exec(attributes)?.[1];
          const type = /\bt="([^"]+)"/.exec(attributes)?.[1];
          const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
          let value =
            type === 's'
              ? shared[Number(raw)] ?? ''
              : type === 'inlineStr'
                ? [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(text => decodeXmlEntities(text[1])).join('')
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
        if (cells.size > 0) {
          rawRows.push(cells);
          rowsWritten += 1;
        }
      }
      if (!rawRows.length) return '';
      const columns = maxCol < 64
        ? Array.from({ length: maxCol + 1 }, (_, idx) => idx)
        : [...occupiedCols].sort((a, b) => a - b).slice(0, 128);
      const formatRow = (r: Map<number, string>): string => `| ${columns.map(col => r.get(col) ?? '').join(' | ')} |`;
      const separator = `| ${columns.map(() => '---').join(' | ')} |`;
      const lines = [formatRow(rawRows[0]), separator, ...rawRows.slice(1).map(formatRow)];
      if (truncatedRows) lines.push('… (more rows)');
      return `## ${sheet.name}\n${lines.join('\n')}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

function pptxMarkdown(entries: Map<string, ZipEntry>): string {
  const slides = [...entries.keys()].filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort(naturalOrder);
  return slides
    .map((name, index) => {
      const text = xmlToText(readZipText(entries, name) || '', /<\/a:p>|<a:br\b[^>]*\/>/g).trim();
      const notesName = name.replace('slides/slide', 'notesSlides/notesSlide');
      const notes = entries.has(notesName)
        ? xmlToText(readZipText(entries, notesName) || '', /<\/a:p>/g).replace(/^\s*\d+\s*$/gm, '').trim()
        : '';
      return `## Slide ${index + 1}\n${text}${notes ? `\n\n[Notes]\n${notes}` : ''}`;
    })
    .join('\n\n');
}

function odfMarkdown(entries: Map<string, ZipEntry>): string {
  const xml = readZipText(entries, 'content.xml');
  if (!xml) return '';
  const cells = xml
    .replace(/<\/text:p>\s*<\/table:table-cell>/g, '</table:table-cell>')
    .replace(/<\/table:table-cell>/g, '\t</table:table-cell>')
    .replace(/<table:table\b[^>]*table:name="([^"]*)"[^>]*>/g, '\n## $1\n');
  return xmlToText(cells, /<\/text:p>|<\/text:h>|<text:line-break\/>|<\/table:table-row>|<\/draw:page>/g, /<text:tab\/>/g);
}

function htmlToMarkdown(html: string): string {
  const stripTags = (fragment: string): string => decodeXmlEntities(fragment.replace(/<[^>]+>/g, '')).replace(/[ \t\r\n]+/g, ' ').trim();
  const converted = html
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level: string, inner: string) => {
      const text = stripTags(inner);
      return text ? `\n${'#'.repeat(Number(level))} ${text}\n` : '\n';
    })
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, inner: string) => {
      const item = stripTags(inner);
      return item ? `\n- ${item}\n` : '\n';
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeXmlEntities(converted).replace(/[ \t]{2,}/g, ' ').trim();
}

function epubMarkdown(entries: Map<string, ZipEntry>): string {
  const container = readZipText(entries, 'META-INF/container.xml') || '';
  const opfPath = /full-path="([^"]+)"/.exec(container)?.[1];
  const opf = opfPath ? readZipText(entries, opfPath) || '' : '';
  const base = opfPath?.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const manifest = new Map([...opf.matchAll(/<item\b[^>]*\bid="([^"]+)"[^>]*\bhref="([^"]+)"/g)].map(match => [match[1], base + decodeURIComponent(match[2])]));
  const spine = [...opf.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"/g)].map(match => manifest.get(match[1])).filter((path): path is string => Boolean(path));
  const files = spine.length ? spine : [...entries.keys()].filter(name => /\.x?html?$/i.test(name)).sort(naturalOrder);
  return files.map(path => htmlToMarkdown(readZipText(entries, path) || '')).filter(Boolean).join('\n\n');
}

function pdfText(bytes: Uint8Array): string {
  const raw = latin1.decode(bytes);
  const decodeLiteral = (value: string): string =>
    value
      .replace(/\\([nrtbf()\\])/g, (_, ch: string) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[ch] ?? ch))
      .replace(/\\([0-7]{1,3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)));

  const extractBlocks = (streamText: string): string => {
    const pieces: string[] = [];
    for (const block of streamText.matchAll(/\bBT\b([\s\S]*?)\bET\b/g)) {
      const lines: string[] = [];
      let current = '';
      for (const token of block[1].matchAll(/\((?:\\.|[^\\()])*\)\s*Tj|\[((?:\\.|[^\]])*)\]\s*TJ|\((?:\\.|[^\\()])*\)\s*'|(\bT\*|\bTD|\bTd|\bTm)\b/g)) {
        const full = token[0];
        if (token[2]) {
          if (current.trim()) {
            lines.push(current.trim());
            current = '';
          }
          continue;
        }
        if (token[1] !== undefined) {
          for (const str of token[1].matchAll(/\((?:\\.|[^\\()])*\)/g)) {
            current += decodeLiteral(str[0].slice(1, -1));
          }
        } else {
          const open = full.indexOf('(');
          const close = full.lastIndexOf(')');
          if (open >= 0 && close > open) {
            current += decodeLiteral(full.slice(open + 1, close));
          }
        }
      }
      if (current.trim()) lines.push(current.trim());
      if (lines.length) pieces.push(lines.join('\n'));
    }
    return pieces.join('\n\n');
  };

  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < raw.length) {
    const streamIdx = raw.indexOf('stream', cursor);
    if (streamIdx < 0) break;
    const dictStart = Math.max(0, streamIdx - 512);
    const dict = raw.slice(dictStart, streamIdx);
    let dataStart = streamIdx + 6;
    if (raw[dataStart] === '\r' && raw[dataStart + 1] === '\n') dataStart += 2;
    else if (raw[dataStart] === '\n' || raw[dataStart] === '\r') dataStart += 1;
    const endIdx = raw.indexOf('endstream', dataStart);
    if (endIdx < 0) break;
    cursor = endIdx + 9;
    let streamEnd = endIdx;
    while (streamEnd > dataStart && (raw[streamEnd - 1] === '\n' || raw[streamEnd - 1] === '\r')) streamEnd -= 1;
    const slice = bytes.subarray(dataStart, streamEnd);
    let decoded = '';
    if (/\/FlateDecode\b/.test(dict)) {
      try {
        decoded = latin1.decode(inflateSync(slice, { maxOutputLength: MAX_ENTRY_BYTES }));
      } catch {
        try {
          decoded = latin1.decode(inflateRawSync(slice, { maxOutputLength: MAX_ENTRY_BYTES }));
        } catch {
          decoded = '';
        }
      }
    } else if (!/\/(DCTDecode|JPXDecode|CCITTFaxDecode|JBIG2Decode)\b/.test(dict)) {
      decoded = latin1.decode(slice);
    }
    if (decoded.includes('BT')) {
      const text = extractBlocks(decoded);
      if (text) chunks.push(text);
    }
  }
  return chunks.join('\n\n').trim();
}

function binaryStrings(bytes: Uint8Array): string {
  const ascii = latin1.decode(bytes).match(/[\x20-\x7e]{6,}/g) || [];
  return ascii.slice(0, 2_000).join('\n').trim();
}

export function tryExtractBinaryDocumentMarkdown(filePath: string, bytes: Uint8Array): RuntimeExtractedDocument | undefined {
  const lower = filePath.toLowerCase();
  const extIdx = lower.lastIndexOf('.');
  const ext = extIdx >= 0 ? lower.slice(extIdx + 1) : '';
  const isPdf = ext === 'pdf' || latin1.decode(bytes.subarray(0, 5)) === '%PDF-';
  if (isPdf) {
    const text = pdfText(bytes);
    return {
      method: 'pdf',
      markdown: text || '_[PDF file contains no extractable text layer (likely a scanned image PDF).]_'
    };
  }

  const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZip) {
    const entries = readZip(bytes);
    if (entries) {
      if (entries.has('word/document.xml')) {
        return { method: 'docx', markdown: docxMarkdown(entries).trim() };
      }
      if (entries.has('xl/workbook.xml')) {
        return { method: 'xlsx', markdown: xlsxMarkdown(entries).trim() };
      }
      if ([...entries.keys()].some(entry => entry.startsWith('ppt/slides/'))) {
        return { method: 'pptx', markdown: pptxMarkdown(entries).trim() };
      }
      if (entries.has('content.xml') && (readZipText(entries, 'mimetype') || '').includes('opendocument')) {
        return { method: 'odf', markdown: odfMarkdown(entries).trim() };
      }
      if (entries.has('META-INF/container.xml')) {
        return { method: 'epub', markdown: epubMarkdown(entries).trim() };
      }
      const names = [...entries.keys()].sort(naturalOrder);
      return {
        method: 'zip',
        markdown: `Archive contents (${names.length} files):\n${names.slice(0, 500).map(n => `- ${n}`).join('\n')}`
      };
    }
  }

  if (['doc', 'xls', 'ppt'].includes(ext) || (bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf)) {
    const recovered = binaryStrings(bytes);
    if (recovered) {
      return { method: 'strings', markdown: recovered };
    }
  }

  return undefined;
}
