import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

// The production send path: widget.deliverableAttachments with the real host
// extraction method, for a route that publishes no modality list (like a
// direct Zeekai/OpenAI-compatible connection) and for a text-only model.
const require = createRequire(import.meta.url);
const support = require('../lib/common/nextmux-attachment-support.js');
const service = Object.values(require('../lib/node/nextmux-platform-service.js')).find(value => typeof value === 'function' && value.prototype?.extractAttachmentText);
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const methods = [];
(function visit(node) { if (ts.isMethodDeclaration(node) && ['deliverableAttachments', 'formatMediaSize'].includes(node.name.getText(file))) methods.push(node.getText(file)); ts.forEachChild(node, visit); })(file);
assert.equal(methods.length, 2);
const Harness = new Function('attachmentDelivery', `${ts.transpile(`class Harness { ${methods.join('\n')} }`, { target: ts.ScriptTarget.ES2022 })}; return Harness;`)(support.attachmentDelivery);
const fixture = name => readFileSync(new URL(`./fixtures/documents/${name}`, import.meta.url));
const record = (name, mimeType, bytes, kind = 'file') => ({ id: name, uri: `file:///cache/${name}`, size: bytes.length,
    attachment: kind === 'image' ? { kind, name, mimeType, dataBase64: bytes.toString('base64') } : { kind, name, mimeType, dataBase64: bytes.toString('base64') } });

function widget() {
    const calls = [];
    return Object.assign(new Harness(), {
        extractedAttachmentText: new Map(), calls,
        platformService: { extractAttachmentText: request => { calls.push(request.name); return service.prototype.extractAttachmentText.call({}, request); } }
    });
}

const files = [
    record('photo.png', 'image/png', Buffer.from('iVBORw0KGgo=', 'base64'), 'image'),
    record('report.pdf', 'application/pdf', fixture('libreoffice.pdf')),
    record('report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fixture('report.docx')),
    record('budget.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fixture('budget.xlsx')),
    record('deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', fixture('deck.pptx')),
    record('old.doc', 'application/msword', fixture('report.doc')),
    record('gbk.txt', 'text/plain', Buffer.from([0xc4, 0xe3, 0xba, 0xc3, 0xca, 0xc0, 0xbd, 0xe7])),
    record('memo.m4a', 'audio/mp4', Buffer.from([0, 0, 0, 24, 102, 116, 121, 112]))
];

test('a connection without a modality list gets the image natively and every document as readable text', async () => {
    const route = { kind: 'official_connection', connection: { protocol: 'openai_chat_completions', providerId: 'custom', model: 'gpt-5.6-terra', capabilityEvidence: [] } };
    const target = widget();
    const delivered = await target.deliverableAttachments(files, route);
    assert.equal(delivered.length, files.length);
    assert.deepEqual(delivered[0], files[0].attachment, 'the image travels as an image');
    const text = name => delivered.find(item => item.name === name);
    assert.equal(text('report.pdf').kind, 'text'); assert.match(text('report.pdf').content, /extracted by the app \(PDF, 1 pages\)[\s\S]*Revenue grew 42%/);
    assert.match(text('report.docx').content, /季度报告 Quarterly Report[\s\S]*地区 \| 收入/);
    assert.match(text('budget.xlsx').content, /## 销售\n\| 产品 \| 数量 \| 单价 \|\n\| --- \| --- \| --- \|\n\| 键盘 \| 3 \| 199\.5 \|/);
    assert.match(text('deck.pptx').content, /## Slide 1\n路线图 Roadmap/);
    assert.match(text('old.doc').content, /季度报告 Quarterly Report/);
    assert.match(text('gbk.txt').content, /你好世界/);
    assert.match(text('memo.m4a').content, /does not accept audio input/);
    // A second send reuses the extracted text instead of parsing again.
    const before = target.calls.length;
    await target.deliverableAttachments(files, route);
    assert.equal(target.calls.length, before);
});

test('a text-only model still receives a description of the image instead of a blocked send', async () => {
    const route = { kind: 'official_connection', connection: { protocol: 'openai_chat_completions', providerId: 'custom', model: 'm', capabilityEvidence: [],
        discoveredModels: [{ id: 'm', inputModalities: ['text'] }] } };
    const delivered = await widget().deliverableAttachments(files.slice(0, 2), route);
    assert.equal(delivered[0].kind, 'text'); assert.match(delivered[0].content, /photo\.png[\s\S]*does not accept image input/);
    assert.equal(delivered[1].kind, 'text');
});

test('a model that reads PDF natively gets the PDF itself', async () => {
    const route = { kind: 'official_connection', connection: { protocol: 'openai_responses', providerId: 'openai', model: 'm', capabilityEvidence: [],
        discoveredModels: [{ id: 'm', inputModalities: ['text', 'image', 'pdf'] }] } };
    const delivered = await widget().deliverableAttachments([files[1]], route);
    assert.equal(delivered[0].kind, 'file'); assert.equal(delivered[0].mimeType, 'application/pdf');
});

test('extractAttachmentText returns structured Media Attachment Markdown for audio and video files instead of binary decoding', async () => {
    const audioRes = await service.prototype.extractAttachmentText.call({}, {
        name: 'voice-note.m4a',
        mimeType: 'audio/mp4',
        dataBase64: Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 77, 52, 65, 32]).toString('base64')
    });
    assert.equal(audioRes.ok, true);
    assert.equal(audioRes.method, 'text');
    assert.equal(audioRes.truncated, false);
    assert.match(audioRes.text, /### Media Attachment: voice-note\.m4a/);
    assert.match(audioRes.text, /- Category: Audio/);
    assert.match(audioRes.text, /- Type: audio\/mp4 \(m4a\)/);
    assert.match(audioRes.text, /- Size: 12 B \(12 bytes\)/);

    const videoRes = await service.prototype.extractAttachmentText.call({}, {
        name: 'demo.mp4',
        mimeType: 'video/mp4',
        dataBase64: Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]).toString('base64')
    });
    assert.equal(videoRes.ok, true);
    assert.match(videoRes.text, /### Media Attachment: demo\.mp4/);
    assert.match(videoRes.text, /- Category: Video/);
});

test('adaptMessagesForCouncilSlot converts image and binary attachments to Markdown text for text-only Council specialist routes', async () => {
    const host = {
        contextCatalogOfferings: [],
        merchantCatalogPages: new Map(),
        readOfficialConnectionIndex: async () => [{
            id: 'conn-1',
            protocol: 'openai_chat_completions',
            providerId: 'deepseek',
            model: 'deepseek-reasoner',
            capabilityEvidence: [],
            discoveredModels: [{ id: 'deepseek-reasoner', inputModalities: ['text'] }]
        }],
        extractAttachmentText: req => service.prototype.extractAttachmentText.call({}, req),
        attachmentExtractionCache: new Map(), cachedAttachmentExtraction: service.prototype.cachedAttachmentExtraction
    };
    const messages = [{
        role: 'user',
        content: 'Inspect this diagram and audio',
        attachments: [
            files[0].attachment,
            files[7].attachment,
            { kind: 'file', name: 'setup.exe', mimeType: 'application/octet-stream', dataBase64: Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0xff, 0xfe]).toString('base64') }
        ]
    }];
    const adapted = await service.prototype.adaptMessagesForCouncilSlot.call(
        host,
        messages,
        { kind: 'official_connection', connectionId: 'conn-1', model: 'deepseek-reasoner' }
    );
    assert.equal(adapted.length, 1);
    assert.equal(adapted[0].attachments.length, 3);
    assert.equal(adapted[0].attachments[0].kind, 'text');
    // The picture holds no recognizable text: OCR reports failure instead of passing metadata off as its text.
    assert.match(adapted[0].attachments[0].content, /\[Attachment "photo\.png" \(image\/png\) could not be sent natively to this model\.\]/);
    assert.equal(adapted[0].attachments[1].kind, 'text');
    assert.match(adapted[0].attachments[1].content, /### Media Attachment: memo\.m4a/);
    // Other binaries are described, never decoded into junk text.
    assert.equal(adapted[0].attachments[2].content, '[Attachment "setup.exe" (application/octet-stream) could not be sent natively to this model.]');
});

test('re-adapting the same history extracts each attachment once (no OCR on every turn of a run)', async () => {
    let extractions = 0;
    const host = {
        contextCatalogOfferings: [], merchantCatalogPages: new Map(),
        readOfficialConnectionIndex: async () => [{ id: 'conn-1', protocol: 'openai_chat_completions', providerId: 'deepseek', model: 'deepseek-chat',
            capabilityEvidence: [], discoveredModels: [{ id: 'deepseek-chat', inputModalities: ['text'] }] }],
        extractAttachmentText: async () => { extractions++; return { ok: true, method: 'pdf', text: 'Quarterly revenue grew 42%.', truncated: false }; },
        attachmentExtractionCache: new Map(), cachedAttachmentExtraction: service.prototype.cachedAttachmentExtraction
    };
    const messages = [{ role: 'user', content: 'Summarize', attachments: [files[1].attachment] }];
    const route = { kind: 'official_connection', connectionId: 'conn-1', model: 'deepseek-chat' };
    for (let turn = 0; turn < 3; turn++) {
        const adapted = await service.prototype.adaptMessagesForCouncilSlot.call(host, messages, route);
        assert.match(adapted[0].attachments[0].content, /this model cannot read it natively, so its content was extracted as text\]\n\nQuarterly revenue grew 42%\./);
    }
    assert.equal(extractions, 1);
});
