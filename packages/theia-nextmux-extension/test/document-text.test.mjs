import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { extractDocumentText, decodeTextBytes, readZip, DocumentTextError } = require('../lib/node/nextmux-document-text.js');
const { attachmentDelivery, routeSupportsModelAttachment } = require('../lib/common/nextmux-attachment-support.js');
const fixture = name => new Uint8Array(readFileSync(new URL(`./fixtures/documents/${name}`, import.meta.url)));
const read = name => extractDocumentText(name, fixture(name));

// Fixtures were produced by python-docx/openpyxl/python-pptx, ReportLab and
// LibreOffice, so they match what real users attach.
test('office and OpenDocument files become readable text with their structure', () => {
    // The title paragraph keeps its level as Markdown, like MarkItDown's output.
    assert.equal(read('report.docx').text, '# 季度报告 Quarterly Report\n营收增长 42%，Revenue grew 42%.\n地区 | 收入\n华东 | 1200');
    assert.match(read('report.odt').text, /季度报告 Quarterly Report[\s\S]*地区\t收入\n华东\t1200/);
    assert.match(read('report.rtf').text, /营收增长 42%，Revenue grew 42%\.\n地区\t收入/);
    assert.equal(read('report.doc').method, 'doc');
    assert.match(read('report.doc').text, /^季度报告 Quarterly Report\n营收增长 42%，Revenue grew 42%\.\n地区\t收入/);
    assert.equal(read('budget.xlsx').text, '## 销售\n| 产品 | 数量 | 单价 |\n| --- | --- | --- |\n| 键盘 | 3 | 199.5 |\n| Mouse | 10 | 49 |\n\n## Notes\n|  | second sheet 第二页 |\n| --- | --- |');
    assert.match(read('budget.ods').text, /## 销售\n产品\t数量\t单价\n键盘\t3\t199\.5/);
    assert.match(read('deck.pptx').text, /## Slide 1\n路线图 Roadmap\nQ4 发布桌面版\n\n\[Notes\]\n演讲备注 speaker notes\n\n## Slide 2\nSecond slide 第二页/);
});

test('PDF text layers decode through ToUnicode maps and predefined Unicode CMaps across pages', () => {
    const office = read('libreoffice.pdf');
    assert.equal(office.method, 'pdf'); assert.equal(office.pages, 1);
    assert.match(office.text, /季度报告 ?Quarterly Report\n营收增长 ?42%，Revenue grew 42%\.\n地区 ?收入\n华东 ?1200/);
    const generated = read('reportlab.pdf');
    assert.equal(generated.pages, 2);
    assert.equal(generated.text, '[Page 1]\nHello PDF (page one)\n中文内容测试\n\n[Page 2]\nSecond page text');
});

test('damaged or text-free input reports a typed reason instead of throwing blindly', () => {
    assert.throws(() => extractDocumentText('scan.pdf', new TextEncoder().encode('%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF')), error => error instanceof DocumentTextError && error.code === 'empty');
    assert.throws(() => extractDocumentText('x.docx', new Uint8Array([1, 2, 3])), error => error instanceof DocumentTextError);
    assert.equal(readZip(fixture('report.docx')).has('word/document.xml'), true);
});

test('plain text in legacy Chinese and Japanese encodings is decoded, not rejected', () => {
    assert.equal(decodeTextBytes(Uint8Array.from([0xc4, 0xe3, 0xba, 0xc3])), '你好');
    assert.equal(decodeTextBytes(new TextEncoder().encode('hello 世界')), 'hello 世界');
    assert.equal(decodeTextBytes(Uint8Array.from([0xff, 0xfe, 0x60, 0x4f])), '你');
});

test('delivery follows open-source clients: documents as text, images unless the model is text-only', () => {
    const connection = (extra = {}) => ({ kind: 'official_connection', connection: { protocol: 'openai_chat_completions', providerId: 'custom', model: 'm', capabilityEvidence: [], ...extra } });
    const png = { kind: 'image', name: 'a.png', mimeType: 'image/png', dataBase64: 'AA==' };
    const pdf = { kind: 'file', name: 'a.pdf', mimeType: 'application/pdf', dataBase64: 'AA==' };
    const docx = { kind: 'file', name: 'a.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', dataBase64: 'AA==' };
    const audio = { kind: 'file', name: 'a.m4a', mimeType: 'audio/mp4', dataBase64: 'AA==' };
    // A direct connection that publishes no modality list: images are sent.
    assert.equal(routeSupportsModelAttachment(png, connection()), true);
    assert.equal(attachmentDelivery(png, connection()), 'native');
    // Declared text-only: the image is OCR/metadata-extracted instead of blocked.
    const textOnly = connection({ discoveredModels: [{ id: 'm', inputModalities: ['text'] }] });
    assert.equal(attachmentDelivery(png, textOnly), 'extract');
    assert.equal(attachmentDelivery(pdf, textOnly), 'extract');
    assert.equal(attachmentDelivery(docx, connection()), 'extract');
    assert.equal(attachmentDelivery(audio, connection()), 'describe');
    assert.equal(attachmentDelivery({ kind: 'text', name: 'a.md', content: 'x' }, undefined), 'native');
    // A managed offering with no declared inputs is unknown, not text-only.
    assert.equal(attachmentDelivery(png, { kind: 'managed_gateway', offering: { input: [], capabilities: [] } }), 'native');
    assert.equal(attachmentDelivery(png, { kind: 'managed_gateway', offering: { input: ['text'], capabilities: [] } }), 'extract');
});

test('Word headings (including localized style ids) and list items keep Markdown structure', async () => {
    const { markdownParagraphs } = require('../lib/node/nextmux-document-text.js');
    const paragraph = (style, text, list = false) => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${list ? '<w:numPr><w:ilvl w:val="0"/></w:numPr>' : ''}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
    const xml = paragraph('1', '概述') + paragraph('Heading2', 'Details') + paragraph('', 'item', true) + paragraph('', 'plain');
    const out = markdownParagraphs(xml, new Map([['1', 'heading 1'], ['Heading2', 'heading 2']])).replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '');
    assert.equal(out, '# 概述\n## Details\n- item\nplain\n');
});

test('Jupyter notebooks (.ipynb), RFC 822 emails (.eml), SVG (.svg), and HTML convert to structured Markdown', () => {
    const { htmlToText } = require('../lib/node/nextmux-document-text.js');
    const nb = JSON.stringify({
        metadata: { kernelspec: { language: 'python' } },
        cells: [
            { cell_type: 'markdown', source: ['# Analysis\n', 'Quarterly metrics.'] },
            {
                cell_type: 'code',
                source: ['print(21 * 2)'],
                outputs: [{ output_type: 'stream', text: ['42\n'] }]
            }
        ]
    });
    const extractedNb = extractDocumentText('analysis.ipynb', new TextEncoder().encode(nb));
    assert.equal(extractedNb.method, 'ipynb');
    assert.match(extractedNb.text, /# Analysis[\s\S]*```python\nprint\(21 \* 2\)\n```[\s\S]*\*\*Output:\*\*\n```text\n42\n```/);

    const eml = [
        'From: =?UTF-8?B?5byg5LiJ?= <zhangsan@example.com>',
        'To: team@example.com',
        'Subject: =?UTF-8?Q?Sprint_Report?= ',
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: quoted-printable',
        '',
        'Revenue grew =34=32%.',
    ].join('\r\n');
    const extractedEml = extractDocumentText('message.eml', new TextEncoder().encode(eml));
    assert.equal(extractedEml.method, 'eml');
    assert.match(extractedEml.text, /\*\*From\*\*: 张三 <zhangsan@example\.com>[\s\S]*\*\*Subject\*\*: Sprint Report[\s\S]*Revenue grew 42%\./);

    const svg = '<svg width="120" height="60" viewBox="0 0 120 60"><title>Architecture Diagram</title><text x="10" y="20">API Gateway</text><rect width="10" height="10"/></svg>';
    const extractedSvg = extractDocumentText('arch.svg', new TextEncoder().encode(svg));
    assert.equal(extractedSvg.method, 'svg');
    assert.match(extractedSvg.text, /## SVG Document[\s\S]*Architecture Diagram[\s\S]*120 × 60[\s\S]*API Gateway/);

    const html = '<html><body><h2>Overview</h2><ul><li>First</li></ul><p>See <a href="https://example.com">Docs</a></p><table><tr><th>Key</th><th>Val</th></tr><tr><td>A</td><td>1</td></tr></table></body></html>';
    const md = htmlToText(html);
    assert.match(md, /## Overview[\s\S]*- First[\s\S]*\[Docs\]\(https:\/\/example\.com\)[\s\S]*\| Key \| Val \|[\s\S]*\| A \| 1 \|/);
});

test('HTML entities decode exactly once and code blocks keep their text and indentation', () => {
    const { htmlToText } = require('../lib/node/nextmux-document-text.js');
    const html = '<h2>Escape &amp;lt; here</h2><ul><li>Use &lt;div&gt; &amp;amp; more</li></ul>'
        + '<p>Raw &amp;gt; and <code>&amp;lt;tag&amp;gt;</code></p>'
        + '<table><tr><th>A&#124;B</th></tr></table><p><a href="https://e.com/?a=1&amp;b=2">Q &amp;amp; A</a> &#0;</p>'
        + '<pre><code>def f():\n    return "&lt;b&gt;" &amp;&amp; 1\n\n\n\n    # end</code></pre>';
    const md = htmlToText(html);
    assert.match(md, /^## Escape &lt; here$/m);
    assert.match(md, /^- Use <div> &amp; more$/m);
    assert.match(md, /Raw &gt; and `&lt;tag&gt;`/);
    assert.match(md, /\| A\\\|B \|/);
    assert.match(md, /\[Q &amp; A\]\(https:\/\/e\.com\/\?a=1&b=2\) \uFFFD/);
    assert.ok(md.includes('```\ndef f():\n    return "<b>" && 1\n\n\n\n    # end\n```'), md);
    assert.equal(md.includes('\u0000'), false);
});

test('image fallback inspects PNG/JPEG headers and formats local OCR Markdown', async () => {
    const { inspectImageBytes, extractImageOcrMarkdown } = require('../lib/node/nextmux-image-markdown-fallback.js');
    const pngBytes = Buffer.from(
        '89504e470d0a1a0a' +
        '0000000d4948445200000140000000f0080600000000000000' +
        '0000001074455874536f667477617265004e6578744d757800000000' +
        '0000000049454e44ae426082',
        'hex'
    );
    const info = inspectImageBytes(new Uint8Array(pngBytes), 'image/png');
    assert.equal(info.format, 'png');
    assert.equal(info.width, 320);
    assert.equal(info.height, 240);
    assert.equal(info.colorType, 'RGBA');
    assert.equal(info.metadata.Software, 'NextMux');

    const fallback = await extractImageOcrMarkdown('screenshot.png', new Uint8Array(pngBytes), 'image/png', {
        runOcr: async () => 'Error: ECONNREFUSED 127.0.0.1:8080'
    });
    assert.equal(fallback.method, 'image_ocr');
    assert.match(fallback.text, /320 × 240 px[\s\S]*\*\*Software\*\*: NextMux[\s\S]*ECONNREFUSED 127\.0\.0\.1:8080/);

    // Failed or empty OCR is a typed failure, not "extracted text" made of metadata alone.
    for (const runOcr of [async () => '  \n ', async () => { throw new Error('helper missing'); }]) {
        await assert.rejects(extractImageOcrMarkdown('blank.png', new Uint8Array(pngBytes), 'image/png', { runOcr }),
            error => error.code === 'empty' && error.domainError?.code === 'DOCUMENT_IMAGE_NO_TEXT');
    }
    // Embedded metadata is bounded context: a many-kilobyte XMP packet or generator settings never flood the prompt.
    const textChunk = (key, value) => {
        const data = Buffer.concat([Buffer.from(key, 'latin1'), Buffer.from([0]), Buffer.from(value, 'utf8')]);
        const length = Buffer.alloc(4);
        length.writeUInt32BE(data.length);
        return Buffer.concat([length, Buffer.from('tEXt', 'latin1'), data, Buffer.alloc(4)]);
    };
    const iend = pngBytes.subarray(pngBytes.length - 12);
    const noisy = Buffer.concat([pngBytes.subarray(0, 33), textChunk('parameters', `line one\nline two ${'x'.repeat(5_000)}`),
        ...Array.from({ length: 30 }, (_, index) => textChunk(`Key${index}`, 'v')), iend]);
    const bounded = await extractImageOcrMarkdown('noisy.png', new Uint8Array(noisy), 'image/png', { runOcr: async () => 'Visible text' });
    assert.match(bounded.text, /- \*\*parameters\*\*: line one line two x{900,1000}…\n/, 'values are flattened to one line and capped');
    assert.equal((bounded.text.match(/^- \*\*Key\d+\*\*/gm) || []).length, 15, '16 entries at most, including parameters');
    assert.match(bounded.text, /### Extracted Text \(OCR\)\nVisible text$/);
});

test('local OCR needs no developer tools, keeps paths out of script source and is bounded by a hard deadline', async () => {
    const { runBoundedRecognizer } = require('../lib/node/nextmux-image-markdown-fallback.js');
    const source = readFileSync(new URL('../src/node/nextmux-image-markdown-fallback.ts', import.meta.url), 'utf8');
    // /usr/bin/swiftc is an xcrun shim: without developer tools it opens the system "install developer tools" dialog.
    assert.doesNotMatch(source, /execFile[^\n]*swiftc|xcode-select|\.nextmux', 'cache'/, 'macOS recognition neither compiles nor caches a helper binary');
    assert.match(source, /runBoundedRecognizer\('\/usr\/bin\/osascript', \['-l', 'JavaScript', '-e', MACOS_VISION_SCRIPT, imagePath\]/,
        'the picture path is an osascript argument, never script source');
    const windowsScript = /const WINDOWS_OCR_SCRIPT = \[([\s\S]*?)\]\.join/.exec(source)?.[1] || '';
    assert.match(windowsScript, /\$env:NEXTMUX_OCR_IMAGE/);
    assert.doesNotMatch(windowsScript, /\$\{|JSON\.stringify|imagePath/, 'Windows gets the path in the environment, never in PowerShell source');
    assert.match(windowsScript, /ToBase64String\(\[Text\.Encoding\]::UTF8\.GetBytes\(\$text\)\)/, 'text survives any console code page');
    assert.match(source, /win32\.join\(systemRoot, 'System32', 'WindowsPowerShell', 'v1\.0', 'powershell\.exe'\)/);
    assert.match(source, /windowsHide: true/);

    // A helper that hangs, even one that leaves a child holding its pipes, settles on time with no text.
    const started = Date.now();
    const output = await runBoundedRecognizer(process.execPath, ['-e',
        "require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 4000)'], { stdio: 'inherit' }); setInterval(() => {}, 1000)"], 300);
    assert.deepEqual(output, { stdout: '' });
    assert.ok(Date.now() - started < 3_000, `settled after ${Date.now() - started} ms`);
    assert.deepEqual(await runBoundedRecognizer(process.execPath, ['-e', "process.stdout.write('read'); process.exit(0)"], 5_000), { stdout: 'read', exitCode: 0 });
    assert.deepEqual(await runBoundedRecognizer(process.execPath, ['-e', 'process.exit(4)'], 5_000), { stdout: '', exitCode: 4 });
    assert.deepEqual(await runBoundedRecognizer('/nonexistent/recognizer', [], 5_000), { stdout: '' });
});

test('macOS recognizes text in a picture with the system Vision framework', { skip: process.platform !== 'darwin' && 'macOS only' }, async t => {
    const { execFileSync } = await import('node:child_process');
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { runLocalImageOcr, extractImageOcrMarkdown } = require('../lib/node/nextmux-image-markdown-fallback.js');
    const directory = mkdtempSync(join(tmpdir(), 'nextmux-ocr-test-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const picture = join(directory, 'sample.png');
    const draw = `ObjC.import('AppKit');
function run(argv) {
    const image = $.NSImage.alloc.initWithSize($.NSMakeSize(560, 90));
    image.lockFocus;
    $.NSColor.whiteColor.setFill;
    $.NSRectFill($.NSMakeRect(0, 0, 560, 90));
    const attributes = $.NSDictionary.dictionaryWithObjectsForKeys($([$.NSFont.systemFontOfSize(34), $.NSColor.blackColor]),
        $([$.NSFontAttributeName, $.NSForegroundColorAttributeName]));
    $('连接被拒绝 ECONNREFUSED 8080').drawAtPointWithAttributes($.NSMakePoint(16, 26), attributes);
    image.unlockFocus;
    const png = $.NSBitmapImageRep.imageRepWithData(image.TIFFRepresentation).representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({}));
    return png.writeToFileAtomically(argv[0], true) ? 'ok' : 'failed';
}`;
    try {
        if (execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', draw, picture], { encoding: 'utf8', timeout: 20_000 }).trim() !== 'ok') throw new Error('not drawn');
    } catch {
        t.skip('this session cannot draw a sample picture');
        return;
    }
    const text = await runLocalImageOcr(picture, 15_000);
    assert.match(text, /ECONNREFUSED/);
    assert.match(text, /连接被拒绝/);
    assert.equal(await runLocalImageOcr(join(directory, 'missing.png'), 15_000), '', 'an unreadable picture has no text');
    const extracted = await extractImageOcrMarkdown('sample.png', new Uint8Array(readFileSync(picture)), 'image/png', { timeoutMs: 15_000 });
    assert.match(extracted.text, /### Extracted Text \(OCR\)\n[^\n]*ECONNREFUSED/);
});

test('D2-01, D2-04, D2-08, D2-09, D2-18: PDF unclosed hex string termination, invalid XML entity code points, sparse XLSX columns, and RTF group-scoped \\uc', () => {
    const { decodeXmlEntities, rtfText, pdfText } = require('../lib/node/nextmux-document-text.js');

    // D2-04: Out-of-range and surrogate XML entities become U+FFFD instead of throwing RangeError
    assert.equal(decodeXmlEntities('Valid &#65; Invalid &#x110000; &#999999999; &#xd800;'), 'Valid A Invalid \uFFFD \uFFFD \uFFFD');

    // D2-09: RTF \ucN is scoped to {...} groups and guards invalid \uN code points
    const rtf = '{\\rtf1\\ansi{\\*\\pn\\uc0}\\u20013?\\u25991?}';
    assert.equal(rtfText(rtf), '中文');

    // D2-01: PDF content stream with unclosed '<' hex string token terminates without infinite loop
    const unclosedHexPdf = [
        '%PDF-1.4',
        '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
        '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
        '3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj',
        '4 0 obj << /Length 48 >> stream',
        'BT (SafePrefix) Tj [<4142] TJ <48656c6c6f ET',
        'endstream endobj',
        '%%EOF'
    ].join('\n');
    const parsedPdf = pdfText(new TextEncoder().encode(unclosedHexPdf));
    assert.match(parsedPdf.text, /SafePrefix/);

    // D2-08: Sparse XLSX with far-right XFD1 cell compacts columns without memory explosion
    const { writeZip } = require('../../../apps/desktop/app-plugin-zip.cjs');
    const sparseXlsx = writeZip([
        ['xl/workbook.xml', Buffer.from('<workbook><sheets><sheet name="Sparse" r:id="rId1"/></sheets></workbook>')],
        ['xl/_rels/workbook.xml.rels', Buffer.from('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')],
        ['xl/worksheets/sheet1.xml', Buffer.from('<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Left</t></is></c><c r="XFD1" t="inlineStr"><is><t>FarRight</t></is></c></row></sheetData></worksheet>')]
    ]);
    const extractedSparse = extractDocumentText('sparse.xlsx', new Uint8Array(sparseXlsx));
    assert.match(extractedSparse.text, /\| Left \| FarRight \|/);
    assert.ok(extractedSparse.text.length < 500);
});
