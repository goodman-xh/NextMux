import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const wanted = new Set(['composerFilesFromTransfer', 'handleComposerDrop', 'handleComposerPaste',
    'attachmentExtension', 'attachmentMimeType', 'textAttachmentExtension', 'classifyAttachment', 'attachmentRecordFromBytes',
    'imageMimeType', 'bytesToBase64', 'addBrowserFiles', 'runOwnedAttachmentImport', 'decodableTextAttachment']);
const methods = [];
function visit(node) { if (ts.isMethodDeclaration(node) && wanted.has(node.name.getText(ast))) methods.push(node.getText(ast)); ts.forEachChild(node, visit); }
visit(ast); assert.equal(methods.length, wanted.size);
const decoder = ts.transpile(await readFile(new URL('../src/common/nextmux-text-attachment.ts', import.meta.url), 'utf8'),
    { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS });
const code = `if (typeof crypto.randomUUID !== 'function') crypto.randomUUID = () => 'fixture-' + Math.random().toString(16).slice(2);
const decoderExports = {}; (function(exports) { ${decoder} })(decoderExports);
const { decodeTextAttachment, TextAttachmentDecodeError, TEXT_ATTACHMENT_MAX_BYTES } = decoderExports;
const MAX_FILE_ATTACHMENTS_PER_TASK = 8;
const MAX_ATTACHMENT_TOTAL_BYTES = 32 * 1024 * 1024;
const composerAttachmentText = (_locale, key) => key;
${ts.transpile(`class TransferHarness { ${methods.join('\n')} }`, { target: ts.ScriptTarget.ES2022 })}
// 应用操控 (dropping an app) needs the desktop bridge; these files are ordinary attachments.
TransferHarness.prototype.appControlAvailable = () => false;`;
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const puppeteer = (await import(platform.resolve('puppeteer'))).default;

test('actual drop and paste handlers retain distinct native File objects with identical metadata', { timeout: 30000 }, async t => {
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setContent('<div id="drop"><textarea>NM_ATTACHMENT_DRAFT_KEEP</textarea></div>');
    await page.addScriptTag({ content: `${code}; window.TransferHarness = TransferHarness;` });
    const results = await page.evaluate(async () => {
        const results = [];
        for (const kind of ['drop', 'paste']) {
            const a = new File(['AAA'], 'notes.txt', { type: 'text/plain', lastModified: 42 });
            const b = new File(['BBB'], 'notes.txt', { type: 'text/plain', lastModified: 42 });
            const transfer = new DataTransfer(); transfer.items.add(a); transfer.items.add(b);
            const widget = new window.TransferHarness(); let received;
            widget.composerDragActive = true;
            widget.update = () => {};
            // Producer ownership/cache durability have separate real-service tests.
            // Here the real DOM File identities must reach that producer intact.
            widget.addBrowserFiles = files => { received = [...files]; };
            const textarea = document.querySelector('textarea');
            const event = kind === 'drop' ? new DragEvent('drop', { dataTransfer: transfer, cancelable: true, bubbles: true })
                : new ClipboardEvent('paste', { clipboardData: transfer, cancelable: true, bubbles: true });
            const listener = value => kind === 'drop' ? widget.handleComposerDrop(value) : widget.handleComposerPaste(value);
            textarea.addEventListener(kind, listener, { once: true }); textarea.dispatchEvent(event);
            results.push({ kind, receivedCount: received.length, texts: await Promise.all(received.map(file => file.text())),
                defaultPrevented: event.defaultPrevented, draft: textarea.value,
                sameObjects: received[0] === a && received[1] === b });
        }
        return results;
    });
    for (const result of results) {
        assert.equal(result.receivedCount, 2, result.kind);
        assert.deepEqual(result.texts, ['AAA', 'BBB']); assert.equal(result.sameObjects, true);
        assert.equal(result.defaultPrevented, true); assert.equal(result.draft, 'NM_ATTACHMENT_DRAFT_KEEP');
    }
});

test('FileList is preferred once, items-only fallback preserves distinct files and identical object references deduplicate', { timeout: 30000 }, async t => {
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage(); await page.setContent('<div></div>');
    await page.addScriptTag({ content: `${code}; window.TransferHarness = TransferHarness;` });
    const result = await page.evaluate(async () => {
        const widget = new window.TransferHarness();
        const a = new File(['AAA'], 'notes.txt', { lastModified: 42 }), b = new File(['BBB'], 'notes.txt', { lastModified: 42 });
        const transfer = new DataTransfer(); transfer.items.add(a); transfer.items.add(b);
        const direct = widget.composerFilesFromTransfer(transfer);
        const fallback = widget.composerFilesFromTransfer({ files: [], items: transfer.items });
        const sameReference = widget.composerFilesFromTransfer({ files: [a, a, b], items: [] });
        return { direct: direct.length, fallback: await Promise.all(fallback.map(file => file.text())),
            sameReference: sameReference.length };
    });
    assert.deepEqual(result, { direct: 2, fallback: ['AAA', 'BBB'], sameReference: 2 });
});

test('actual drop producer preserves original draft and attachments when reading or strict text decoding fails', { timeout: 30000 }, async t => {
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage(); await page.setContent('<textarea>NM_ATTACHMENT_DRAFT_KEEP</textarea>');
    await page.addScriptTag({ content: `${code}; window.TransferHarness = TransferHarness;` });
    const results = await page.evaluate(async () => {
        const results = [];
        for (const failure of ['invalid-text', 'read-failure']) {
            const widget = new window.TransferHarness(); let reads = 0, writes = 0, appends = 0;
            const original = [{ id: 'existing', uri: 'file:///synthetic-existing', size: 4,
                attachment: { kind: 'text', name: 'existing.txt', content: 'keep' } }];
            const owner = { id: 'A', draftPrompt: 'NM_ATTACHMENT_DRAFT_KEEP', draftAttachments: [{ id: 'existing', name: 'existing.txt' }] };
            const before = JSON.stringify(owner);
            Object.assign(widget, { prompt: 'NM_ATTACHMENT_DRAFT_KEEP', attachments: original, activeCodingSessionId: 'A',
                codingSessions: [owner], pendingAttachmentImports: new Map(), codingPopover: '', navigationBackStack: [],
                desktopLocale: 'en', attachmentError: '', applicationExitPreparing: false, update() {},
                activeCodingSession: () => owner, codingSessionWorkspaceRoot: () => '',
                conversationHistoryPersistedSessions: new Map([['A', owner]]), conversationHistoryReady: () => true, flushComposerDraft() {}, async flushConversationHistory() {},
                platformService: { async cacheDesktopAttachment() { writes += 1; throw new Error('CACHE_SHOULD_NOT_RUN'); } },
                appendOwnedAttachment() { appends += 1; }, addNotification() {} });
            const file = new File([new Uint8Array([0xc3, 0x28])], 'qa-invalid-utf8.txt', { type: 'text/plain' });
            const read = file.arrayBuffer.bind(file);
            file.arrayBuffer = async () => { reads += 1; if (failure === 'read-failure') throw new Error('PRIVATE_READ_FAULT'); return read(); };
            const transfer = new DataTransfer(); transfer.items.add(file);
            const event = new DragEvent('drop', { dataTransfer: transfer, cancelable: true });
            widget.handleComposerDrop(event);
            await Promise.allSettled([...widget.pendingAttachmentImports.keys()]);
            await new Promise(resolve => setTimeout(resolve, 0));
            results.push({ failure, reads, writes, appends, error: widget.attachmentError,
                prompt: widget.prompt, sameAttachmentArray: widget.attachments === original,
                ownerUnchanged: JSON.stringify(owner) === before, textarea: document.querySelector('textarea').value,
                pendingCount: widget.pendingAttachmentImports.size });
        }
        return results;
    });
    for (const result of results) {
        // Non-UTF-8 text is kept as a file and decoded by the host on send; its cache write is attempted.
        assert.equal(result.reads, 1); assert.equal(result.writes, result.failure === 'invalid-text' ? 1 : 0, JSON.stringify(result)); assert.equal(result.appends, 0);
        assert.equal(result.error, 'prepareFailed'); assert.equal(result.prompt, 'NM_ATTACHMENT_DRAFT_KEEP');
        assert.equal(result.textarea, 'NM_ATTACHMENT_DRAFT_KEEP'); assert.equal(result.sameAttachmentArray, true);
        assert.equal(result.ownerUnchanged, true); assert.equal(result.pendingCount, 0);
    }
});
