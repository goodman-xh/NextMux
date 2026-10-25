import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { routeSupportsModelAttachment } from '../lib/common/nextmux-attachment-support.js';
import {
    composerContentToken,
    createPastedTextReference,
    deserializePastedTextReferences,
    insertPastedTextReference,
    materializePastedTextPrompt,
    mergeComposerAttachmentsByOrdinal,
    pastedTextReferencesInDocument,
    requireDurablePastedTextReferences,
    serializePastedTextReferences,
    shouldExternalizePastedText
} from '../lib/browser/nextmux-composer-long-paste.js';
import { completedConversationHistory, inheritConversationTurnsBefore } from '../lib/browser/nextmux-conversation-branch.js';
import { createConversationHistoryMirror, readConversationHistoryMirror } from '../lib/browser/nextmux-conversation-history.js';

test('composer identity changes only when editable content or its owner changes', () => {
    const base = composerContentToken('session-a', 'hello', [{ id: 'file-a', ordinal: 1 }], [{ id: 'paste-a' }], ['file-a']);
    assert.equal(base, composerContentToken('session-a', 'hello', [{ id: 'file-a', ordinal: 99 }], [{ id: 'paste-a', ordinal: 2 }], ['file-a']));
    assert.notEqual(base, composerContentToken('session-b', 'hello', [{ id: 'file-a' }], [{ id: 'paste-a' }], ['file-a']));
    assert.notEqual(base, composerContentToken('session-a', 'hello!', [{ id: 'file-a' }], [{ id: 'paste-a' }], ['file-a']));
    assert.notEqual(base, composerContentToken('session-a', 'hello', [{ id: 'file-b' }], [{ id: 'paste-a' }], ['file-a']));
});

test('only genuinely large plain-text pastes become durable text references', () => {
    assert.equal(shouldExternalizePastedText('normal paragraph'), false);
    assert.equal(shouldExternalizePastedText('x'.repeat(16_000)), true);
    assert.equal(shouldExternalizePastedText(Array.from({ length: 256 }, () => 'line').join('\n')), true);
    assert.equal(shouldExternalizePastedText('你'.repeat(22_000)), true);
});

test('repeated identical pastes keep unique position references and collision-free names', () => {
    const first = createPastedTextReference({
        id: 'reference-one',
        ordinal: 1,
        createdAt: new Date('2026-08-30T12:34:56.000Z'),
        content: 'same content'
    });
    const second = createPastedTextReference({
        id: 'reference-two',
        ordinal: 2,
        createdAt: new Date('2026-08-30T12:34:56.000Z'),
        content: 'same content'
    });

    assert.notEqual(first.id, second.id);
    assert.notEqual(first.name, second.name);
    assert.notEqual(first.marker, second.marker);
    assert.equal(first.content, second.content);
});

test('anchors preserve the paragraph where each pasted file belongs', () => {
    const first = createPastedTextReference({ id: 'ref-a', ordinal: 1, createdAt: new Date(0), content: 'alpha' });
    const second = createPastedTextReference({ id: 'ref-b', ordinal: 2, createdAt: new Date(0), content: 'beta' });

    const a = insertPastedTextReference('Issue A:\n\nIssue B:', 9, 9, first);
    const issueB = a.value.indexOf('Issue B:') + 'Issue B:'.length;
    const b = insertPastedTextReference(a.value, issueB, issueB, second);

    assert.equal(pastedTextReferencesInDocument(b.value, [second, first]).map(item => item.id).join(','), 'ref-a,ref-b');
    assert.equal(materializePastedTextPrompt(b.value, [first, second]),
        `Issue A:\n${first.modelReference}\nIssue B:${second.modelReference}`);
    assert.equal(b.selectionStart, b.selectionEnd);
    assert.ok(b.selectionStart > issueB);
});

test('multiple long pastes keep the composer bounded and materialize at their exact caret positions', () => {
    const first = createPastedTextReference({ id: 'bounded-a', ordinal: 1, createdAt: new Date(0), content: 'a'.repeat(80_000) });
    const second = createPastedTextReference({ id: 'bounded-b', ordinal: 2, createdAt: new Date(1), content: 'b'.repeat(80_000) });
    const initial = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
    const afterFirst = insertPastedTextReference(initial, initial.indexOf('Second'), initial.indexOf('Second'), first);
    const thirdParagraph = afterFirst.value.indexOf('Third paragraph.');
    const afterSecond = insertPastedTextReference(afterFirst.value, thirdParagraph, thirdParagraph, second);

    assert.ok(afterSecond.value.length < 1_000, 'the textarea contains references, not pasted bodies');
    assert.equal(afterSecond.value.includes(first.content), false);
    assert.equal(afterSecond.value.includes(second.content), false);
    assert.equal(
        materializePastedTextPrompt(afterSecond.value, [second, first]),
        `First paragraph.\n\n${first.modelReference}Second paragraph.\n\n${second.modelReference}Third paragraph.`
    );
});

test('replacing a selection keeps one stable anchor and caret immediately after it', () => {
    const reference = createPastedTextReference({ id: 'ref-c', ordinal: 3, createdAt: new Date(0), content: 'large' });
    const result = insertPastedTextReference('before SELECT after', 7, 13, reference);
    assert.equal(result.value, `before ${reference.marker} after`);
    assert.equal(result.selectionStart, 7 + reference.marker.length);
    assert.equal(result.selectionEnd, result.selectionStart);
});


test('durable pasted-text metadata survives restart and deleted anchors stop sending attachments', () => {
    const first = createPastedTextReference({
        id: 'persistent-a', ordinal: 1, createdAt: new Date(0), content: 'first',
        attachment: { uri: 'file:///project/.nextmux/attachments/pasted-a.txt', size: 5 }
    });
    const second = createPastedTextReference({
        id: 'persistent-b', ordinal: 2, createdAt: new Date(1), content: 'second',
        attachment: { uri: 'file:///cache/pasted-b.txt', size: 6 }
    });
    const serialized = serializePastedTextReferences([first, second]);

    assert.equal(serialized.includes('first'), false, 'draft metadata must not duplicate the large body');
    assert.equal(serialized.includes('second'), false, 'draft metadata must not duplicate the large body');

    const restored = deserializePastedTextReferences(serialized);
    assert.deepEqual(restored.map(item => ({ id: item.id, uri: item.attachment?.uri })), [
        { id: 'persistent-a', uri: 'file:///project/.nextmux/attachments/pasted-a.txt' },
        { id: 'persistent-b', uri: 'file:///cache/pasted-b.txt' }
    ]);

    const promptAfterDeletingFirstAnchor = `Keep this paragraph.\n${restored[1].marker}`;
    assert.deepEqual(
        pastedTextReferencesInDocument(promptAfterDeletingFirstAnchor, restored).map(item => item.id),
        ['persistent-b']
    );
    assert.equal(
        materializePastedTextPrompt(promptAfterDeletingFirstAnchor, restored),
        `Keep this paragraph.\n${restored[1].modelReference}`
    );
});

test('deleting one historical long-text anchor removes only its attachment from the resend', () => {
    const first = createPastedTextReference({
        id: 'paste-first', ordinal: 2, createdAt: new Date(0), content: 'first',
        attachment: { uri: 'file:///cache/first.txt', size: 5 }
    });
    const second = createPastedTextReference({
        id: 'paste-second', ordinal: 4, createdAt: new Date(1), content: 'second',
        attachment: { uri: 'file:///cache/second.txt', size: 6 }
    });
    const editedPrompt = `Keep image and file. ${second.marker}`;
    const active = pastedTextReferencesInDocument(editedPrompt, [first, second]);
    const merged = mergeComposerAttachmentsByOrdinal([
        { id: 'image', ordinal: 1 },
        { id: 'paste-first', ordinal: 2 },
        { id: 'file', ordinal: 3 },
        { id: 'paste-second', ordinal: 4 }
    ], active.map(reference => ({ id: reference.id, ordinal: reference.ordinal })), [first.id, second.id]);

    assert.deepEqual(active.map(reference => reference.id), ['paste-second']);
    assert.deepEqual(merged.map(item => item.id), ['image', 'file', 'paste-second']);
    assert.doesNotMatch(materializePastedTextPrompt(editedPrompt, active), /first\.txt|paste-first/);
});

test('image, file, and long-text attachments keep one stable insertion order', () => {
    const merged = mergeComposerAttachmentsByOrdinal([
        { id: 'file-late', ordinal: 5 },
        { id: 'image-first', ordinal: 1 },
        { id: 'file-middle', ordinal: 3 }
    ], [
        { id: 'paste-second', ordinal: 4 },
        { id: 'paste-first', ordinal: 2 }
    ]);
    assert.deepEqual(merged.map(item => item.id), [
        'image-first', 'paste-first', 'file-middle', 'paste-second', 'file-late'
    ]);
});

test('a long-paste prompt cannot be queued or sent until every inline reference is durable', () => {
    const pending = createPastedTextReference({ id: 'pending', ordinal: 1, createdAt: new Date(0), content: 'pending' });
    assert.throws(
        () => requireDurablePastedTextReferences(`Before ${pending.marker} after`, [pending]),
        /saved|durable|保存/i
    );

    const durable = createPastedTextReference({
        id: 'durable', ordinal: 2, createdAt: new Date(1), content: 'durable',
        attachment: {
            uri: 'file:///project/.nextmux/conversation-attachments/unique.txt',
            size: 7,
            workspaceRelativePath: '.nextmux/conversation-attachments/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-00000000-0000-4000-8000-000000000000.txt'
        }
    });
    assert.deepEqual(requireDurablePastedTextReferences(`Before ${durable.marker} after`, [durable]), [durable]);
});

test('restart, queue, history, and branches preserve the materialized model prompt order', () => {
    const first = createPastedTextReference({
        id: 'flow-a', ordinal: 1, createdAt: new Date(0), content: 'alpha',
        attachment: { uri: 'file:///project/.nextmux/conversation-attachments/a.txt', size: 5 }
    });
    const second = createPastedTextReference({
        id: 'flow-b', ordinal: 2, createdAt: new Date(1), content: 'beta',
        attachment: { uri: 'file:///project/.nextmux/conversation-attachments/b.txt', size: 4 }
    });
    const displayPrompt = `Intro ${first.marker}\nMiddle ${second.marker}\nEnd`;
    const modelPrompt = materializePastedTextPrompt(displayPrompt, [second, first]);
    const turn = {
        id: 'turn-with-pastes',
        prompt: displayPrompt,
        modelPrompt,
        response: 'done',
        stage: 'complete',
        attachments: [first, second].map(reference => ({
            id: reference.id,
            uri: reference.attachment.uri,
            name: reference.name,
            kind: 'text'
        }))
    };

    assert.deepEqual(completedConversationHistory([turn]), [
        { role: 'user', content: modelPrompt },
        { role: 'assistant', content: 'done' }
    ]);
    assert.equal(inheritConversationTurnsBefore([turn, { ...turn, id: 'later' }], 'later')[0].modelPrompt, modelPrompt);

    const queued = {
        id: 'queued-paste', sessionId: 'session-a', source: 'user', prompt: modelPrompt,
        workbench: 'coding', routeId: 'route-a', relayKey: 'relay-a', modelLabel: 'Model',
        permissionMode: 'workspace_write', attachments: turn.attachments, createdAt: 1
    };
    const mirror = createConversationHistoryMirror([{
        id: 'session-a', updatedAt: 1, turns: [turn], followUpQueue: [queued]
    }]);
    const restored = readConversationHistoryMirror(JSON.stringify(mirror));
    assert.equal(restored.sessions[0].followUpQueue[0].prompt, modelPrompt);
    assert.deepEqual(restored.sessions[0].followUpQueue[0].attachments, turn.attachments);
});

test('desktop composer wires long paste references through cache, caret, queue, and model prompt', async () => {
    const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    assert.match(source, /shouldExternalizePastedText\(text\)/);
    assert.match(source, /insertPastedTextReference\(/);
    assert.match(source, /platformService\.cacheDesktopAttachment\(\{/);
    assert.match(source, /pastedTextReferencesInDocument\(/);
    assert.match(source, /materializePastedTextPrompt\(/);
    assert.match(source, /inlineReference:\s*reference\.modelReference/);
    assert.match(source, /inlineReference:\s*item\.attachment\.inlineReference/);
    assert.match(source, /attachment:\s*\{\s*\.\.\.record\.attachment,\s*inlineReference:\s*attachment\.inlineReference/s);
    assert.match(source, /appendCodingTurn\(\s*codingSession,\s*displayValue,\s*runPermission,\s*route\.id,\s*routeSummary,\s*taskAttachments,\s*value,\s*turnPastedTextReferences,\s*route\.kind === 'managed_gateway' \? route\.keyPriceQuoteId : undefined(?:,\s*Boolean\(submission\))?\s*\)/);
    assert.match(source, /pastedTextReferences:\s*turn\.pastedTextReferences \|\| ''/);
    assert.match(source, /deserializePastedTextReferences\(pending\.pastedTextReferences\)/);
    assert.match(source, /requireDurablePastedTextReferences\(rawValue,\s*this\.pastedTextReferences\)/);
    assert.match(source, /unique:\s*true/);
    assert.match(source, /conversationId:\s*session\.id/);
    assert.match(source, /mergeComposerAttachmentsByOrdinal\(/);
    assert.match(source, /platformService\.readDesktopAttachment\(/);
    assert.doesNotMatch(source, /recoverableAttachmentResource\(/);
    // PDF eligibility moved into the shared route/transport capability check.
    // Exercise the production composer method rather than pinning its old body.
    const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
    const method = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === 'routeSupportsAttachment');
    assert.ok(method);
    const Harness = new Function('routeSupportsModelAttachment', `${ts.transpile(`class Harness { ${method.getText(ast)} }`, {
        target: ts.ScriptTarget.ES2022
    })}; return Harness;`)(routeSupportsModelAttachment);
    const pdf = { attachment: { kind: 'file', name: 'reference.pdf', mimeType: 'application/pdf', dataBase64: 'AQID' } };
    const connection = { model: 'gpt-known-name-is-not-proof', protocol: 'openai_chat_completions', providerId: 'custom_openai', capabilityEvidence: [] };
    const composer = new Harness();
    assert.equal(composer.routeSupportsAttachment(pdf, { kind: 'official_connection', connection }), false);
    assert.equal(composer.routeSupportsAttachment(pdf, { kind: 'managed_gateway', offering: { input: ['files'], capabilities: [] } }), true);
    assert.equal(composer.routeSupportsAttachment(pdf, { kind: 'managed_gateway', offering: { input: [], capabilities: ['profile', 'no-files'] } }), false);
    const declared = { ...connection, discoveredModels: [{ id: connection.model, inputModalities: ['file'] }] };
    assert.equal(composer.routeSupportsAttachment(pdf, { kind: 'official_connection', connection: declared }), true);
    assert.equal(composer.routeSupportsAttachment(pdf, { kind: 'official_connection', connection: { ...declared, protocol: 'cohere_chat' } }), false,
        'model support alone cannot bypass an adapter that does not encode PDF bytes');
    assert.match(source, /pastedTextReferencesInDocument\(pending\.prompt/);
    assert.match(source, /nmx-pasted-text-chip/);
});
