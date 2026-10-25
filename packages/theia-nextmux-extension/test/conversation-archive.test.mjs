import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, open, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ConversationStore } from '../lib/node/nextmux-conversation-store.js';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
// Test the production archive projection even while other workspace builds are in flight.
const archiveModule = { exports: {} };
new Function('require', 'module', 'exports', ts.transpile(readFileSync(new URL('../src/node/nextmux-conversation-archive.ts', import.meta.url), 'utf8'),
    { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }))(
    createRequire(new URL('../lib/node/nextmux-conversation-archive.js', import.meta.url)), archiveModule, archiveModule.exports);
const { ConversationArchiveService, publishConversationArchiveFile } = archiveModule.exports;
import { CONVERSATION_ARCHIVE_MAX_BYTES } from '../lib/common/nextmux-conversation-archive.js';
import { answeredQuestionMemory } from '../lib/browser/nextmux-conversation-branch.js';
import { persistAgentOutputParts, readAgentOutputAsset } from '../lib/node/nextmux-agent-output-assets.js';

const digest = value => createHash('sha256').update(value).digest('hex');
const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const wavBytes = (() => { const value = Buffer.alloc(44); value.write('RIFF'); value.writeUInt32LE(36, 4); value.write('WAVE', 8); return value; })();
const archiveContentDigest = value => digest(JSON.stringify({
    conversations: value.conversations,
    files: value.files.map(({ dataBase64: _bytes, ...file }) => file),
    ...(value.projects ? { projects: value.projects } : {})
}));
const minimalSession = id => ({ id, title: `Conversation ${id}`, workspacePath: 'C:\\Windows\\OldProject', createdAt: 1, updatedAt: 2,
    turns: [{ id: 'turn-1', userMessageId: 'message-u1', assistantMessageId: 'message-a1', prompt: 'User-visible pasted secret stays in chosen content', response: 'A table\n| item | cost |\n|---|---|\n| x | 1 |', error: '', stage: 'complete', createdAt: 1, permissionMode: 'full_access', routeLabel: 'Example model' }] });
async function fixture(t) {
    const raw = await mkdtemp(join(tmpdir(), 'nextmux-archive-'));
    const root = await realpath(raw);
    t.after(() => rm(root, { recursive: true, force: true }));
    const store = new ConversationStore(join(root, 'source-store'));
    const destination = new ConversationStore(join(root, 'destination-store'));
    const sourceDataRoot = join(root, 'source-data');
    const importedDataRoot = join(root, 'imported-data');
    const sourceAttachments = join(sourceDataRoot, 'conversation-attachments');
    const importedAttachments = join(importedDataRoot, 'conversation-attachments');
    await mkdir(sourceAttachments, { recursive: true });
    await mkdir(importedDataRoot, { recursive: true });
    const attachment = async (id, name, bytes, kind = 'file') => {
        const path = join(sourceAttachments, `${digest(bytes)}.${name.split('.').at(-1)}`);
        await writeFile(path, bytes);
        return { id, name, uri: pathToFileURL(path).href, size: bytes.length, kind, mimeType: kind === 'text' ? 'text/plain' : 'application/octet-stream' };
    };
    const readAttachment = async (_session, reference) => {
        const path = fileURLToPath(reference.uri);
        assert.ok(path.startsWith(`${sourceAttachments}/`) || path.startsWith(`${importedAttachments}/`), 'only fixture-owned cache');
        return readFile(path);
    };
    const exporter = new ConversationArchiveService({ store, attachmentRoot: sourceAttachments, readAttachment });
    const importer = new ConversationArchiveService({ store: destination, attachmentRoot: importedAttachments, readAttachment });
    const archive = join(root, 'history.nmxarchive');
    return { root, store, destination, sourceDataRoot, importedDataRoot, sourceAttachments, importedAttachments, exporter, importer, archive, attachment };
}
async function exportSimple(f) { await f.store.save([minimalSession('conversation-1')]); return f.exporter.exportFile(f.archive); }

test('portable archive preserves explicit answer sources without provider state or cross-turn inheritance', async t => {
    const f = await fixture(t), source = minimalSession('citations-session');
    const safe = { url: 'https://example.test/source', title: 'Source' };
    source.turns[0].citations = [{ ...safe, providerState: 'PRIVATE_PROVIDER_STATE' }, { url: 'javascript:alert(1)' }];
    source.turns[0].events = [{ type: 'model_completed', at: 'now', turn: 1, toolCallCount: 0, citations: [{ ...safe, token: 'PRIVATE_TOKEN' }] }];
    source.turns.push({ ...source.turns[0], id: 'second', citations: undefined, events: [] });
    await f.store.save([source]); await f.exporter.exportFile(f.archive);
    const archive = JSON.parse(await readFile(f.archive, 'utf8'));
    assert.deepEqual(archive.conversations[0].turns[0].citations, [safe]);
    assert.deepEqual(archive.conversations[0].turns[0].events[0].citations, [safe]);
    assert.equal(archive.conversations[0].turns[1].citations, undefined);
    assert.doesNotMatch(JSON.stringify(archive), /PRIVATE_PROVIDER_STATE|PRIVATE_TOKEN|javascript:/);
    const preview = await f.importer.previewFile(f.archive);
    await f.importer.importPreview(preview.previewId, 'skip');
    const imported = await f.destination.load();
    assert.deepEqual(imported.sessions[0].turns[0].citations, [safe]);
});

test('portable archive binds child citations to their own answer and parent turn, never live authority', async t => {
    const f = await fixture(t), source = minimalSession('child-source-session');
    const child = { childRunId: 'foreign-child-run', task: 'Research sources', result: { finalText: 'Child answer '.repeat(2000),
        citations: [{ url: 'https://child.test/source', title: 'Child source', providerState: 'PRIVATE' }] } };
    source.turns[0].childAgents = [child];
    source.turns.push({ ...source.turns[0], id: 'another-parent', childAgents: [child] });
    source.turns.push({ ...source.turns[0], id: 'user-only', branchUserOnly: true, childAgents: [child] });
    await f.store.save([source]); await f.exporter.exportFile(f.archive);
    const archive = JSON.parse(await readFile(f.archive, 'utf8')), turns = archive.conversations[0].turns;
    const [first] = turns[0].archivedChildResults;
    assert.match(first.childId, /^archive-[a-f0-9]{32}$/); assert.notEqual(first.childId, turns[1].archivedChildResults[0].childId);
    assert.equal(first.finalText.length, 20_000); assert.equal(first.truncated, true);
    assert.deepEqual(first.citations, [{ url: 'https://child.test/source', title: 'Child source' }]);
    assert.equal(turns[0].citations, undefined); assert.equal(turns[0].childAgents, undefined); assert.equal(turns[2].archivedChildResults, undefined);
    assert.ok(turns[0].events.some(event => event.content?.includes(child.result.finalText)), 'complete visible child text still preserved');
    assert.doesNotMatch(JSON.stringify(archive), /foreign-child-run|PRIVATE/);
    const preview = await f.importer.previewFile(f.archive); await f.importer.importPreview(preview.previewId, 'skip');
    assert.deepEqual((await f.destination.load()).sessions[0].turns[0].archivedChildResults, turns[0].archivedChildResults);
    const secondExport = join(f.root, 'again.nmxarchive'); await f.importer.exportFile(secondExport);
    assert.deepEqual(JSON.parse(await readFile(secondExport, 'utf8')).conversations[0].turns[0].archivedChildResults, turns[0].archivedChildResults);
});

test('archive refuses excess child source groups instead of silently dropping answer evidence', async t => {
    const f = await fixture(t), source = minimalSession('bounded-child-session');
    source.turns[0].childAgents = Array.from({ length: 33 }, (_, i) => ({ childRunId: `child-${i}`, task: 'Task', result: { finalText: 'Answer', citations: [{ url: 'https://child.test/source' }] } }));
    await f.store.save([source]);
    await assert.rejects(f.exporter.exportFile(f.archive), error => error.code === 'ARCHIVE_INVALID');
    await assert.rejects(readFile(f.archive), { code: 'ENOENT' });
});

test('unsupported hard links use exclusive synced export on exFAT without replacing existing files', async t => {
    const f = await fixture(t);
    const bytes = Buffer.from('complete export bytes');
    const unsupported = async () => { throw Object.assign(new Error('no hard links'), { code: 'ENOTSUP' }); };
    await publishConversationArchiveFile('unused temporary', f.archive, bytes, unsupported);
    assert.deepEqual(await readFile(f.archive), bytes);
    await assert.rejects(publishConversationArchiveFile('unused temporary', f.archive, Buffer.from('overwrite'), unsupported), error => error.code === 'ARCHIVE_DESTINATION_EXISTS');
    assert.deepEqual(await readFile(f.archive), bytes);
    let fallbackOpened = false;
    await assert.rejects(publishConversationArchiveFile('unused temporary', f.archive, bytes,
        async () => { throw Object.assign(new Error('exists'), { code: 'EEXIST' }); },
        async () => { fallbackOpened = true; throw new Error('must not open'); }), error => error.code === 'ARCHIVE_DESTINATION_EXISTS');
    assert.equal(fallbackOpened, false, 'EEXIST is never treated as unsupported hard links');
});

test('exFAT fallback removes only its own partial file after a write error', async t => {
    const f = await fixture(t);
    const unsupported = async () => { throw Object.assign(new Error('unsupported'), { code: 'EOPNOTSUPP' }); };
    const failedOpen = async (...args) => {
        const handle = await open(...args);
        return { stat: () => handle.stat(), close: () => handle.close(), sync: () => handle.sync(),
            writeFile: async () => { await handle.writeFile('partial'); throw new Error('injected write failure'); } };
    };
    await assert.rejects(publishConversationArchiveFile('unused temporary', f.archive, Buffer.from('complete'), unsupported, failedOpen), /injected write failure/);
    await assert.rejects(readFile(f.archive), { code: 'ENOENT' });
});

test('exFAT write-error cleanup does not delete a different file moved into the selected name', async t => {
    const f = await fixture(t);
    const unsupported = async () => { throw Object.assign(new Error('unsupported'), { code: 'ENOSYS' }); };
    const replacementOpen = async (...args) => {
        const handle = await open(...args);
        return { stat: () => handle.stat(), close: () => handle.close(), sync: () => handle.sync(),
            writeFile: async () => {
                await handle.writeFile('partial'); await handle.close();
                await rename(f.archive, join(f.root, 'moved-partial'));
                await writeFile(f.archive, 'a different user file');
                throw new Error('injected replaced file failure');
            } };
    };
    await assert.rejects(publishConversationArchiveFile('unused temporary', f.archive, Buffer.from('complete'), unsupported, replacementOpen), /injected replaced file failure/);
    assert.equal(await readFile(f.archive, 'utf8'), 'a different user file');
});

test('portable archive roundtrip keeps full visible messages, real attachments and frozen answers but excludes machine authority', async t => {
    const f = await fixture(t);
    const sheet = await f.attachment('sheet', 'cost.csv', Buffer.from('item,cost\nx,1\n'));
    const pasted = await f.attachment('pasted', 'pasted.txt', Buffer.from('real long-text contents'), 'text');
    const source = minimalSession('conversation-1');
    Object.assign(source, { privateWorkspacePath: '/machine/private-binding', routeId: 'machine-route', providerState: { secret: 'runtime-provider-secret' }, apiKey: 'metadata-api-secret', permissionMode: 'full_access', followUpQueue: [{ prompt: 'do not automatically run this' }] });
    Object.assign(source.turns[0], {
        resumeCheckpointId: 'foreign-checkpoint', agentRootRunId: 'foreign-run', attachments: [sheet, pasted],
        pastedTextReferences: JSON.stringify([{ id: 'pasted', ordinal: 1, name: 'pasted.txt', marker: '[pasted]', modelReference: '[attachment pasted.txt]', attachment: { uri: pasted.uri, size: pasted.size } }]),
        events: [
            { type: 'user_input_requested', at: '2026-01-01', question: { questionId: 'old-question', runId: 'foreign-run', taskId: source.id, prompt: 'Which language?', createdAt: '2026-01-01', expiresAt: '2026-01-02', options: [{ id: 'es', label: 'Spanish' }] } },
            { type: 'user_input_resolved', at: '2026-01-01', questionId: 'old-question', runId: 'foreign-run', taskId: source.id, status: 'answered', answer: { optionId: 'es', optionLabel: 'Spanish', text: 'Keep the Spanish context.' } },
            { type: 'provider_reasoning', at: '', visibility: 'hidden', content: 'hidden-provider-reasoning' },
            { type: 'tool_completed', at: '', callId: 'call-1', toolName: 'read_file', ok: true, summary: { title: 'Read reference', details: ['Visible result'], checkpointId: 'foreign-checkpoint', resource: { path: '/machine/private-binding' } } },
        ],
        steeringMessages: [{ id: 'steer-1', content: 'User applied follow-up', createdAt: '2026-01-01', status: 'applied' }],
    });
    await f.store.save([source]);
    const exported = await f.exporter.exportFile(f.archive);
    assert.equal(exported.attachments, 2);
    const raw = await readFile(f.archive, 'utf8');
    for (const marker of ['runtime-provider-secret', 'metadata-api-secret', 'foreign-checkpoint', 'foreign-run', '/machine/private-binding', 'C:\\\\Windows']) assert.ok(!raw.includes(marker), marker);
    assert.ok(raw.includes(source.turns[0].prompt));
    assert.ok(exported.warnings.includes('conversation_text_and_attachments_may_contain_secrets'));
    assert.ok(exported.warnings.includes('unsent_queue_omitted'));
    const before = await readdir(f.root);
    const preview = await f.importer.previewFile(f.archive);
    assert.deepEqual(await readdir(f.root), before, 'preview creates no store or attachment files');
    assert.equal(preview.conversations[0].conflict, false);
    assert.equal(preview.attachments, 2);
    assert.ok(preview.warnings.includes('unsent_queue_omitted'));
    const result = await f.importer.importPreview(preview.previewId, 'skip');
    assert.equal(result.imported, 1);
    const [restored] = await f.destination.snapshot();
    assert.equal(restored.id, source.id);
    assert.equal(restored.workspacePath, '');
    assert.equal(restored.ownedWorkspace, true);
    assert.equal(restored.permissionMode, 'read_only');
    assert.equal(restored.turns[0].permissionMode, 'read_only');
    assert.equal(restored.turns[0].userMessageId, 'message-u1');
    assert.equal(restored.turns[0].response, source.turns[0].response);
    assert.match(answeredQuestionMemory(restored.turns[0]), /Spanish context/);
    assert.equal(restored.turns[0].steeringMessages[0].content, 'User applied follow-up');
    assert.equal(restored.followUpQueue, undefined);
    assert.equal(restored.turns[0].resumeCheckpointId, undefined);
    for (const ref of restored.turns[0].attachments) assert.deepEqual(await readFile(fileURLToPath(ref.uri)), await readFile(fileURLToPath((ref.id === 'sheet' ? sheet : pasted).uri)));
    const restoredPasted = JSON.parse(restored.turns[0].pastedTextReferences)[0];
    assert.equal(restoredPasted.attachment.uri, restored.turns[0].attachments.find(item => item.id === 'pasted').uri);
    await assert.rejects(f.importer.importPreview(preview.previewId, 'skip'), error => error.code === 'ARCHIVE_PREVIEW_EXPIRED');
    assert.deepEqual(await f.store.snapshot(), [source], 'export does not rewrite the source history');
});

test('v3 archive carries ordered assistant image/audio assets across devices, deduplicates bytes, and remaps owners', async t => {
    const f = await fixture(t);
    const source = minimalSession('portable-output');
    const owner = 'private-source-run-that-must-not-leak';
    const stored = await persistAgentOutputParts(f.sourceDataRoot, owner, [
        { type: 'text', text: 'Before image' },
        { type: 'image', mimeType: 'image/png', dataBase64: pngBase64, sizeBytes: Buffer.from(pngBase64, 'base64').length },
        { type: 'text', text: 'Between media' },
        { type: 'audio', mimeType: 'audio/wav', dataBase64: wavBytes.toString('base64'), sizeBytes: wavBytes.length },
    ]);
    Object.assign(source.turns[0], { outputParts: stored, outputAssetOwnerId: owner });
    source.turns.push({ ...source.turns[0], id: 'turn-2', outputParts: [stored[1]], response: 'Same image again' });
    await f.store.save([source]);
    const exported = await f.exporter.exportFile(f.archive);
    const document = JSON.parse(await readFile(f.archive, 'utf8'));
    assert.equal(document.version, 3);
    assert.equal(document.minimumReaderVersion, 3);
    assert.equal(JSON.stringify(document.conversations).includes(pngBase64), false, 'conversation JSON contains references, never provider bytes');
    assert.equal(JSON.stringify(document.conversations).includes(owner), false, 'source owner/run id is not portable metadata');
    assert.deepEqual(document.conversations[0].turns[0].outputParts.map(part => part.type), ['text', 'image', 'text', 'audio']);
    assert.equal(document.conversations[0].turns[0].outputAssetOwnerId, undefined);
    assert.equal(document.files.filter(file => file.path.startsWith('output-assets/')).length, 2, 'duplicate media is stored once in the archive');
    assert.equal(exported.attachments, 2, 'binary archive resources include the two generated media assets');

    await f.destination.save([minimalSession(source.id)]);
    const preview = await f.importer.previewFile(f.archive);
    const imported = await f.importer.importPreview(preview.previewId, 'copy');
    const restored = (await f.destination.snapshot()).find(item => item.id === imported.idMap[source.id]);
    assert.ok(restored);
    assert.notEqual(restored.id, source.id);
    assert.equal(restored.turns[0].outputAssetOwnerId, restored.id);
    assert.deepEqual(restored.turns[0].outputParts.map(part => part.type), ['text', 'image', 'text', 'audio']);
    assert.deepEqual(restored.turns[1].outputParts, [stored[1]]);
    const image = await readAgentOutputAsset(f.importedDataRoot, restored.id, restored.turns[0].outputParts[1].asset);
    const audio = await readAgentOutputAsset(f.importedDataRoot, restored.id, restored.turns[0].outputParts[3].asset);
    assert.equal(image.dataBase64, pngBase64);
    assert.equal(audio.dataBase64, wavBytes.toString('base64'));

    const secondArchive = join(f.root, 'second.nmxarchive');
    await f.importer.exportFile(secondArchive, [restored.id]);
    const second = JSON.parse(await readFile(secondArchive, 'utf8'));
    assert.equal(second.version, 3);
    assert.deepEqual(second.conversations[0].turns.map(turn => turn.outputParts?.map(part => part.type)), [['text', 'image', 'text', 'audio'], ['image']]);
});

test('assistant output export and import fail closed for missing or tampered media', async t => {
    const f = await fixture(t);
    const source = minimalSession('output-integrity');
    const [image] = await persistAgentOutputParts(f.sourceDataRoot, 'output-owner', [
        { type: 'image', mimeType: 'image/png', dataBase64: pngBase64, sizeBytes: Buffer.from(pngBase64, 'base64').length }
    ]);
    Object.assign(source.turns[0], { outputParts: [image], outputAssetOwnerId: 'output-owner' });
    await f.store.save([source]);
    await f.exporter.exportFile(f.archive);
    const original = JSON.parse(await readFile(f.archive, 'utf8'));
    const outputIndex = original.files.findIndex(file => file.path.startsWith('output-assets/'));
    assert.ok(outputIndex >= 0);

    const missing = structuredClone(original);
    missing.files.splice(outputIndex, 1);
    missing.contentSha256 = archiveContentDigest(missing);
    await writeFile(f.archive, JSON.stringify(missing));
    await assert.rejects(f.importer.previewFile(f.archive), error => error.code === 'ARCHIVE_INVALID');

    const tampered = structuredClone(original);
    const encoded = tampered.files[outputIndex].dataBase64;
    tampered.files[outputIndex].dataBase64 = `${encoded[0] === 'A' ? 'B' : 'A'}${encoded.slice(1)}`;
    await writeFile(f.archive, JSON.stringify(tampered));
    await assert.rejects(f.importer.previewFile(f.archive), error => error.code === 'ARCHIVE_INVALID');

    const wrongMime = structuredClone(original);
    wrongMime.conversations[0].turns[0].outputParts[0].asset.mimeType = 'image/jpeg';
    wrongMime.contentSha256 = archiveContentDigest(wrongMime);
    await writeFile(f.archive, JSON.stringify(wrongMime));
    await assert.rejects(f.importer.previewFile(f.archive), error => error.code === 'ARCHIVE_INVALID');
    await assert.rejects(readFile(join(f.destination.root, 'manifest-v1.json')), { code: 'ENOENT' });
});

test('missing local assistant asset aborts export and import commit failure removes newly installed output bytes', async t => {
    const f = await fixture(t);
    const source = minimalSession('output-rollback');
    const expectedBytes = Buffer.from(pngBase64, 'base64');
    const asset = { sha256: digest(expectedBytes), mimeType: 'image/png', sizeBytes: expectedBytes.length };
    Object.assign(source.turns[0], { outputParts: [{ type: 'image', asset }], outputAssetOwnerId: 'missing-owner' });
    await f.store.save([source]);
    await assert.rejects(f.exporter.exportFile(f.archive), error => error.code === 'ARCHIVE_ATTACHMENT_MISSING');
    await assert.rejects(readFile(f.archive), { code: 'ENOENT' });

    source.turns[0].outputParts = await persistAgentOutputParts(f.sourceDataRoot, 'source-owner', [
        { type: 'image', mimeType: 'image/png', dataBase64: pngBase64, sizeBytes: expectedBytes.length }
    ]);
    source.turns[0].outputAssetOwnerId = 'source-owner';
    await f.store.save([source]);
    await f.exporter.exportFile(f.archive);
    const preview = await f.importer.previewFile(f.archive);
    const write = f.destination.writeFile;
    f.destination.writeFile = async (...args) => { if (String(args[0]).includes('manifest-v1.json.tmp')) throw new Error('injected output commit failure'); return write(...args); };
    await assert.rejects(f.importer.importPreview(preview.previewId, 'skip'), error => error.domainError?.params.reason === 'store_snapshot_save_failed');
    await assert.rejects(readAgentOutputAsset(f.importedDataRoot, source.id, asset));
    await assert.rejects(readFile(join(f.destination.root, 'manifest-v1.json')), { code: 'ENOENT' });
});

test('missing real attachment fails the complete export instead of silently losing its payload', async t => {
    const f = await fixture(t);
    const source = minimalSession('a');
    source.turns[0].attachments = [{ id: 'missing', uri: pathToFileURL(join(f.sourceAttachments, 'missing.txt')).href, name: 'missing.txt', kind: 'text', size: 10 }];
    await f.store.save([source]);
    await assert.rejects(f.exporter.exportFile(f.archive), error => error.code === 'ARCHIVE_ATTACHMENT_MISSING');
    await assert.rejects(readFile(f.archive), { code: 'ENOENT' });
});

test('draft-only pasted text payload is included and rebased, never queued for execution', async t => {
    const f = await fixture(t);
    const pasted = await f.attachment('draft-paste', 'draft.txt', Buffer.from('draft long content'), 'text');
    const source = minimalSession('a');
    source.draftPrompt = 'See [draft]';
    source.draftPastedTextReferences = JSON.stringify([{ id: pasted.id, ordinal: 1, name: pasted.name, marker: '[draft]', modelReference: '[draft.txt]', attachment: { uri: pasted.uri, size: pasted.size } }]);
    await f.store.save([source]);
    await f.exporter.exportFile(f.archive);
    const preview = await f.importer.previewFile(f.archive);
    await f.importer.importPreview(preview.previewId, 'skip');
    const [restored] = await f.destination.snapshot();
    assert.equal(restored.draftAttachments.length, 1);
    assert.equal(JSON.parse(restored.draftPastedTextReferences)[0].attachment.uri, restored.draftAttachments[0].uri);
    assert.equal(await readFile(fileURLToPath(restored.draftAttachments[0].uri), 'utf8'), 'draft long content');
});

test('stable conflicts support skip or one deterministic copy without overwriting original conversations', async t => {
    const f = await fixture(t);
    await exportSimple(f);
    const existing = minimalSession('conversation-1'); existing.turns[0].response = 'original must stay';
    await f.destination.save([existing]);
    let preview = await f.importer.previewFile(f.archive);
    assert.equal(preview.conversations[0].conflict, true);
    assert.equal((await f.importer.importPreview(preview.previewId, 'skip')).skipped, 1);
    preview = await f.importer.previewFile(f.archive);
    const copied = await f.importer.importPreview(preview.previewId, 'copy');
    assert.equal(copied.idMap['conversation-1'], preview.conversations[0].copyId);
    assert.deepEqual((await f.destination.snapshot()).find(item => item.id === existing.id), existing);
    preview = await f.importer.previewFile(f.archive);
    assert.equal(preview.conversations[0].copyConflict, true);
    assert.equal((await f.importer.importPreview(preview.previewId, 'copy')).skipped, 1);
    assert.equal((await f.destination.snapshot()).length, 2);
});

test('import requires a current preview of both the archive bytes and conversation conflicts', async t => {
    const f = await fixture(t);
    await exportSimple(f);
    await assert.rejects(f.importer.importPreview('not-a-preview', 'skip'), error => error.code === 'ARCHIVE_PREVIEW_EXPIRED');
    let preview = await f.importer.previewFile(f.archive);
    const original = await readFile(f.archive);
    await writeFile(f.archive, Buffer.concat([original, Buffer.from(' ')]));
    await assert.rejects(f.importer.importPreview(preview.previewId, 'skip'), error => error.code === 'ARCHIVE_CHANGED');
    await writeFile(f.archive, original);
    preview = await f.importer.previewFile(f.archive);
    await f.destination.save([minimalSession('new-local')]);
    await assert.rejects(f.importer.importPreview(preview.previewId, 'copy'), error => error.code === 'IMPORT_CONFLICT');
    assert.deepEqual((await f.destination.snapshot()).map(item => item.id), ['new-local']);
});

test('session commit failure rolls back only newly imported attachment files and keeps original store bytes', async t => {
    const f = await fixture(t);
    const source = minimalSession('source'); source.turns[0].attachments = [await f.attachment('a', 'note.txt', Buffer.from('note'), 'text')];
    await f.store.save([source]); await f.exporter.exportFile(f.archive);
    const original = minimalSession('local'); await f.destination.save([original]);
    await mkdir(f.importedAttachments); await writeFile(join(f.importedAttachments, 'user-owned.txt'), 'keep');
    const manifestBefore = await readFile(join(f.destination.root, 'manifest-v1.json'));
    const preview = await f.importer.previewFile(f.archive);
    const write = f.destination.writeFile;
    f.destination.writeFile = async (...args) => { if (String(args[0]).includes('manifest-v1.json.tmp')) throw new Error('injected atomic commit failure'); return write(...args); };
    await assert.rejects(f.importer.importPreview(preview.previewId, 'skip'), error => error.domainError?.params.reason === 'store_patch_save_failed');
    assert.deepEqual(await readFile(join(f.destination.root, 'manifest-v1.json')), manifestBefore);
    assert.deepEqual(await readdir(f.importedAttachments), ['user-owned.txt']);
    assert.deepEqual(await f.destination.snapshot(), [original]);
    f.destination.writeFile = write;
    assert.equal((await f.importer.importPreview(preview.previewId, 'skip')).imported, 1);
});

test('same preview imported concurrently commits once and the loser cannot delete winner attachments', async t => {
    const f = await fixture(t);
    const source = minimalSession('source'); source.turns[0].attachments = [await f.attachment('a', 'note.txt', Buffer.from('note'), 'text')];
    await f.store.save([source]); await f.exporter.exportFile(f.archive);
    const preview = await f.importer.previewFile(f.archive);
    const results = await Promise.allSettled([f.importer.importPreview(preview.previewId, 'skip'), f.importer.importPreview(preview.previewId, 'skip')]);
    assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
    const [restored] = await f.destination.snapshot();
    assert.equal(await readFile(fileURLToPath(restored.turns[0].attachments[0].uri), 'utf8'), 'note');
});

test('archive preview rejects ZIP/compression, future versions, traversal and malformed or mismatched payloads', async t => {
    const f = await fixture(t);
    const source = minimalSession('a'); source.turns[0].attachments = [await f.attachment('a', 'note.txt', Buffer.from('note'), 'text')];
    await f.store.save([source]); await f.exporter.exportFile(f.archive);
    const original = JSON.parse(await readFile(f.archive, 'utf8'));
    for (const mutate of [
        value => { value.version = 99; },
        value => { value.files[0].path = '../escape'; },
        value => { value.files[0].path = 'C:\\escape'; },
        value => { value.files[0].path = 'attachments/CON.txt'; },
        value => { value.files[0].dataBase64 = '####'; },
        value => { value.files[0].dataBase64 = Buffer.from('evil').toString('base64'); },
        value => { value.files[0].size = 1024 * 1024 * 1024; },
        value => { value.conversations[0].turns[0].prompt = 'tampered transcript'; },
        value => { value.extra = JSON.parse('{"__proto__":{"polluted":true}}'); },
    ]) {
        const next = structuredClone(original); mutate(next);
        await writeFile(f.archive, JSON.stringify(next));
        await assert.rejects(f.importer.previewFile(f.archive), error => ['ARCHIVE_INVALID', 'ARCHIVE_TOO_LARGE', 'ARCHIVE_VERSION'].includes(error.code));
    }
    await writeFile(f.archive, Buffer.from('PK\x03\x04zip-bomb-not-supported'));
    await assert.rejects(f.importer.previewFile(f.archive), /ZIP/);
    assert.equal({}.polluted, undefined);
    await assert.rejects(readFile(join(f.destination.root, 'manifest-v1.json')), { code: 'ENOENT' });
});

test('oversized sparse archive is rejected using metadata before allocation or decoding', async t => {
    const f = await fixture(t);
    const { open } = await import('node:fs/promises');
    const file = await open(f.archive, 'wx');
    await file.truncate(CONVERSATION_ARCHIVE_MAX_BYTES + 1); await file.close();
    await assert.rejects(f.importer.previewFile(f.archive), error => error.code === 'ARCHIVE_TOO_LARGE');
});

test('archive and attachment symlinks are rejected and export never overwrites an existing destination', async t => {
    const f = await fixture(t);
    await exportSimple(f);
    const original = await readFile(f.archive);
    await assert.rejects(f.exporter.exportFile(f.archive), error => error.code === 'ARCHIVE_DESTINATION_EXISTS');
    assert.deepEqual(await readFile(f.archive), original);
    const alias = join(f.root, 'alias.nmxarchive'); await symlink(f.archive, alias);
    await assert.rejects(f.importer.previewFile(alias), error => error.code === 'ARCHIVE_UNSAFE');
    const external = join(f.root, 'outside'); await mkdir(external);
    await symlink(external, f.importedAttachments, 'junction');
    const preview = await f.importer.previewFile(f.archive);
    await assert.rejects(f.importer.importPreview(preview.previewId, 'skip'), error => error.code === 'ARCHIVE_UNSAFE');
    assert.deepEqual(await readdir(external), []);
});

test('read-only archive snapshot never quarantines corrupt history or migrates a legacy manifest', async t => {
    const f = await fixture(t); await f.store.save([minimalSession('a')]);
    const manifestPath = join(f.store.root, 'manifest-v1.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    delete manifest.createdByVersion; delete manifest.minimumReaderVersion;
    const legacy = JSON.stringify(manifest); await writeFile(manifestPath, legacy);
    await f.store.snapshot(); assert.equal(await readFile(manifestPath, 'utf8'), legacy);
    await writeFile(manifestPath, '{bad json');
    const before = await readdir(f.store.root);
    await assert.rejects(f.store.snapshot(), error => error.code === 'STORE_CORRUPT');
    assert.deepEqual(await readdir(f.store.root), before);
    assert.equal(await readFile(manifestPath, 'utf8'), '{bad json');
});

test('archive roundtrip preserves semantic display metadata and runtime origin without live authority', async t => {
    const f = await fixture(t), source = minimalSession('semantic-session');
    const finalMessage = { origin: 'runtime', stopReason: 'turn_limit_reached', params: { limit: 5 } };
    Object.assign(source.turns[0], { finalMessage, stopReason: 'turn_limit_reached', failure: {
        code: 'MODEL_TIMEOUT', kind: 'model_timeout', message: '旧界面错误', retryable: true, resumable: true, resumeCheckpointId: 'private-handle'
    }, events: [
        { type: 'assistant_progress', origin: 'runtime', at: '', turn: 1, content: '旧的运行时中文状态' },
        { type: 'tool_completed', at: '', callId: 'old-call', toolName: 'nextmux.list_schedules', ok: true,
            summary: { kind: 'nextmux.list_schedules', params: { count: 3, unsafeNested: { command: 'do not retain' } }, title: 'Read project schedules', details: [], checkpointId: 'private-handle' } }
    ], childAgents: [{ task: 'Child task', result: { finalText: 'Task paused.', finalMessage: { origin: 'runtime', stopReason: 'pause_requested' } } }] });
    source.turns.push({ ...minimalSession('legacy').turns[0], id: 'legacy-turn', userMessageId: 'legacy-user', assistantMessageId: 'legacy-assistant',
        response: '任务已暂停，可从检查点继续。', stopReason: 'pause_requested' });
    await f.store.save([source]); await f.exporter.exportFile(f.archive);
    const archive = JSON.parse(await readFile(f.archive, 'utf8')), turn = archive.conversations[0].turns[0];
    assert.deepEqual(turn.finalMessage, finalMessage);
    assert.equal(turn.stopReason, 'turn_limit_reached');
    assert.deepEqual(turn.failure, { code: 'MODEL_TIMEOUT', kind: 'model_timeout', message: 'Task failed (MODEL_TIMEOUT).', retryable: false, resumable: false });
    assert.deepEqual(archive.conversations[0].turns[1].finalMessage, { origin: 'runtime', stopReason: 'pause_requested' });
    assert.equal(turn.events[0].origin, 'runtime');
    assert.deepEqual(turn.events[1].summary, { kind: 'nextmux.list_schedules', params: { count: 3 }, title: 'Read project schedules', details: [] });
    assert.equal(turn.events[2].origin, 'runtime');
    assert.equal(turn.childAgents, undefined);
    assert.doesNotMatch(JSON.stringify(archive), /private-handle|unsafeNested|do not retain/);
    const preview = await f.importer.previewFile(f.archive); await f.importer.importPreview(preview.previewId, 'skip');
    const imported = (await f.destination.load()).sessions[0].turns[0];
    assert.deepEqual(imported.finalMessage, finalMessage);
    assert.equal(imported.stopReason, 'turn_limit_reached');
    assert.deepEqual(imported.failure, turn.failure);
    assert.deepEqual(imported.events.map(event => event.origin), ['runtime', undefined, 'runtime']);
    assert.deepEqual(imported.events[1].summary, turn.events[1].summary);
});
