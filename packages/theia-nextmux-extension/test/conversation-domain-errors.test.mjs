import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { conversationDomainError, conversationDomainReasons } from '../lib/common/nextmux-conversation-domain-errors.js';
import { domainMessageFromError } from '../lib/common/nextmux-domain-errors.js';
import { conversationDomainMessage, conversationErrorPresentation, conversationDetailsLabel, conversationDisplayTitle, conversationImportedToolCalls } from '../lib/browser/nextmux-conversation-domain-locale.js';
import { archiveWarningText } from '../lib/browser/nextmux-conversation-archive-locale.js';
import { ConversationImportPanel } from '../lib/browser/nextmux-conversation-import-panel.js';
import { ConversationStore, ConversationStoreError } from '../lib/node/nextmux-conversation-store.js';
import { ConversationArchiveService } from '../lib/node/nextmux-conversation-archive.js';
import { captureArchiveDirectoryBinding } from '../lib/node/nextmux-archive-project-bindings.js';
import { createConversationHistoryMirror, readConversationHistoryMirror } from '../lib/browser/nextmux-conversation-history.js';
const require = createRequire(import.meta.url), coreRequire = createRequire(require.resolve('@theia/core/package.json'));
const React = coreRequire('react'), { renderToStaticMarkup } = coreRequire('react-dom/server');
const locales = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];

test('every owned conversation reason has an English diagnostic and complete locale projection', () => {
    const reasons = Object.keys(conversationDomainReasons);
    assert.ok(reasons.length >= 179);
    for (const reason of reasons) {
        const message = conversationDomainError(reason, new Error('RAW 原始 diagnostic'));
        assert.match(message.code, /^CONVERSATION_[A-Z_]+$/);
        assert.doesNotMatch(message.fallbackEnglish, /\p{Script=Han}/u);
        const copy = domainMessageFromError(JSON.parse(JSON.stringify({ data: { domainError: message } })));
        assert.deepEqual(copy, message);
        for (const locale of locales) {
            const text = conversationDomainMessage(locale, copy);
            assert.ok(text?.length > 4, `${locale}: ${reason}`);
            assert.doesNotMatch(text, /undefined|RAW|diagnostic|model fail|模型失败/i);
            if (!['zh-CN', 'zh-TW', 'ja'].includes(locale)) assert.doesNotMatch(text, /\p{Script=Han}/u);
            if (locale !== 'en') assert.notEqual(text, conversationDomainMessage('en', copy));
        }
    }
});

test('known and unknown local failures retain raw diagnostics exclusively as details', () => {
    const known = new ConversationStoreError('STORE_UNAVAILABLE', 'store_write_lock_lost', { cause: new Error('RAW OSError 秘密') });
    const presented = conversationErrorPresentation('fr', known);
    assert.match(presented.details, /RAW OSError 秘密/);
    assert.doesNotMatch(presented.summary, /RAW|OSError|秘密|model/i);
    assert.notEqual(presented.summary, conversationErrorPresentation('ja', known).summary);
    const unknown = conversationErrorPresentation('hi', { data: { domainError: { code: 'UNKNOWN_EXTERNAL', fallbackEnglish: 'RAW upstream message' } } }, 'import_failed');
    assert.doesNotMatch(unknown.summary, /RAW|upstream|model/i);
    assert.match(unknown.details, /RAW upstream/);
    assert.equal(conversationDomainMessage('en', { code: 'CONVERSATION_NOT_OWNED', fallbackEnglish: 'RAW' }), undefined);
});

test('import panel renders source and item diagnostics only inside labelled details', () => {
    for (const locale of locales) {
        const html = renderToStaticMarkup(React.createElement(ConversationImportPanel, {
            locale, scanning: false, historyEnabled: true,
            scan: { scannedAt: 1, sources: [{ source: 'codex', roots: [], total: 0, importable: 0, imported: 0, candidates: [], error: 'RAW_SCAN_MESSAGE' }] },
            results: { codex: { source: 'codex', imported: 0, updated: 0, sessionIds: [], failed: [{ externalId: 'e', title: '用户 title unchanged', reason: 'RAW_IMPORT_MESSAGE', domainError: conversationDomainError('import_no_messages', 'RAW_IMPORT_MESSAGE') }] } },
            onResult() {}, onRescan() {}, onAddFolder() {}, onRemoveFolder() {}
        }));
        assert.match(html, /用户 title unchanged/);
        assert.ok(html.includes(conversationDetailsLabel(locale)));
        assert.match(html, /<pre data-nmx-literal="true">RAW_SCAN_MESSAGE<\/pre>/);
        assert.doesNotMatch(html.replace(/<details>[\s\S]*?<\/details>/g, ''), /RAW_SCAN_MESSAGE|RAW_IMPORT_MESSAGE/);
    }
});

test('archive notes project all owned warning codes in every locale', () => {
    for (const locale of locales) for (const code of [
        'conversation_text_and_attachments_may_contain_secrets', 'runtime_credentials_workspaces_permissions_and_pending_queue_not_imported',
        'project_labels_are_display_only_local_binding_requires_confirmation', 'hidden_reasoning_omitted', 'runtime_activity_metadata_omitted',
        'child_citation_identity_missing', 'unsent_queue_omitted', 'unsent_child_drafts_omitted', 'FUTURE_RAW_WARNING'
    ]) {
        const text = archiveWarningText(locale, code);
        assert.ok(text.length > 4); assert.ok(!text.includes(code));
        if (!['zh-CN', 'zh-TW', 'ja'].includes(locale)) assert.doesNotMatch(text, /\p{Script=Han}/u);
    }
});

test('store, mirror, index, archive and preview preserve explicit default-name provenance and user prose', async t => {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-domain-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const store = new ConversationStore(join(root, 'source'));
    const session = { id: 'default-name', title: 'New conversation', titleOrigin: 'default', workspacePath: '', createdAt: 1, updatedAt: 2,
        turns: [{ id: 'turn', prompt: '用户正文 新对话', response: 'respuesta 用户正文', stage: 'complete', error: '', createdAt: 1, importedToolCalls: 3 }] };
    const userNamed = { ...session, id: 'user-name', title: '新对话', titleOrigin: undefined };
    const recoveredDraft = { ...session, id: 'recovered', title: 'Recovered draft', titleOrigin: 'recoveredDraft' };
    const authoredDraft = { ...session, id: 'authored-draft', title: '用户草稿 title', titleOrigin: 'draft', draftPrompt: '用户草稿 title' };
    await store.save([session, userNamed, recoveredDraft, authoredDraft]);
    assert.equal((await store.readSession(authoredDraft.id)).titleOrigin, 'draft');
    assert.equal((await store.list()).sessions.find(s => s.id === authoredDraft.id).titleOrigin, 'draft');
    assert.equal((await store.search({ conversationId: authoredDraft.id })).matches[0].titleOrigin, 'draft');
    assert.equal(readConversationHistoryMirror(JSON.stringify(createConversationHistoryMirror([authoredDraft]))).sessions[0].titleOrigin, 'draft');
    assert.equal((await store.readSession(recoveredDraft.id)).titleOrigin, 'recoveredDraft');
    assert.equal((await store.list()).sessions.find(s => s.id === recoveredDraft.id).titleOrigin, 'recoveredDraft');
    assert.equal(readConversationHistoryMirror(JSON.stringify(createConversationHistoryMirror([recoveredDraft]))).sessions[0].titleOrigin, 'recoveredDraft');
    assert.equal((await store.readSession(session.id)).titleOrigin, 'default');
    assert.equal((await store.list()).sessions.find(s => s.id === session.id).titleOrigin, 'default');
    assert.equal((await store.search({ conversationId: session.id })).matches[0].titleOrigin, 'default');
    const mirrored = readConversationHistoryMirror(JSON.stringify(createConversationHistoryMirror([session]))).sessions[0];
    assert.equal(mirrored.titleOrigin, 'default'); assert.equal(mirrored.turns[0].importedToolCalls, 3);
    const archive = join(root, 'test.nmxarchive');
    const exporter = new ConversationArchiveService({ store, attachmentRoot: join(root, 'attachments'), readAttachment: async () => { throw new Error('unexpected'); } });
    await exporter.exportFile(archive);
    const destination = new ConversationStore(join(root, 'destination'));
    const importer = new ConversationArchiveService({ store: destination, attachmentRoot: join(root, 'imported-attachments'), readAttachment: async () => { throw new Error('unexpected'); } });
    const preview = await importer.previewFile(archive);
    assert.equal(preview.conversations.find(s => s.id === session.id).titleOrigin, 'default');
    assert.equal(preview.conversations.find(s => s.id === recoveredDraft.id).titleOrigin, 'recoveredDraft');
    assert.equal(preview.conversations.find(s => s.id === authoredDraft.id).titleOrigin, 'draft');
    await importer.importPreview(preview.previewId, 'skip');
    const restoredDraft = await destination.readSession(recoveredDraft.id);
    assert.equal(restoredDraft.titleOrigin, 'recoveredDraft');
    const restoredAuthoredDraft = await destination.readSession(authoredDraft.id);
    assert.equal(restoredAuthoredDraft.titleOrigin, 'draft');
    const restored = await destination.readSession(session.id);
    assert.equal(restored.titleOrigin, 'default'); assert.equal(restored.turns[0].importedToolCalls, 3);
    assert.equal(restored.turns[0].prompt, session.turns[0].prompt); assert.equal(restored.turns[0].response, session.turns[0].response);
    for (const locale of locales) {
        assert.ok(conversationDisplayTitle(locale, restored));
        assert.ok(conversationDisplayTitle(locale, restoredDraft));
        assert.equal(conversationDisplayTitle(locale, { title: 'Recovered draft' }), 'Recovered draft');
        if (locale !== 'en') assert.notEqual(conversationDisplayTitle(locale, restoredDraft), 'Recovered draft');
        assert.equal(conversationDisplayTitle(locale, userNamed), '新对话');
        assert.equal(conversationDisplayTitle(locale, restoredAuthoredDraft), authoredDraft.title);
        assert.ok(conversationImportedToolCalls(locale, 3).includes('3'));
    }
    assert.notEqual(conversationDisplayTitle('ja', restored), conversationDisplayTitle('en', restored));
    await assert.rejects(store.save([{ ...session, titleOrigin: 'guessed' }]), e => e.domainError?.params.reason === 'store_session_invalid');
    await assert.rejects(captureArchiveDirectoryBinding('https://example.test'), e => e.code === 'ARCHIVE_BINDING_INVALID' && e.domainError?.params.reason === 'binding_invalid');
    await writeFile(join(root, 'bad.nmxarchive'), 'not-json');
    await assert.rejects(importer.previewFile(join(root, 'bad.nmxarchive')), e => e.code === 'ARCHIVE_INVALID' && e.domainError?.params.reason === 'archive_format_unsupported');
});
