import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import {
    conversationCheckpointRestoreKey,
    conversationCheckpointIdsToRestore,
    conversationAttachmentsInOriginalOrder,
    conversationHistoryStateToken,
    conversationMessageId,
    ConversationMutationLock,
    inheritConversationTurnsBefore,
    inheritConversationTurnsThrough,
    inheritConversationTurnsThroughMessage,
    conversationTurnsHaveWorkspaceState,
    compactedConversationHistory,
    completedConversationHistory,
    conversationTurnsBefore
} from '../lib/browser/nextmux-conversation-branch.js';
import { conversationText } from '../lib/browser/nextmux-conversation-locale.js';

const turns = [
    { id: 'one', prompt: 'p1', response: 'r1', stage: 'complete' },
    { id: 'two', prompt: 'p2', response: 'r2', stage: 'complete' },
    { id: 'three', prompt: 'p3', response: 'r3', stage: 'complete' },
    { id: 'four', prompt: 'p4', response: 'r4', stage: 'complete' }
];

test('visible user and assistant messages keep distinct persisted identities', () => {
    const turn = { id: 'turn-one', userMessageId: 'message-user', assistantMessageId: 'message-assistant' };
    assert.equal(conversationMessageId(turn, 'user'), 'message-user');
    assert.equal(conversationMessageId(turn, 'assistant'), 'message-assistant');
    assert.equal(conversationMessageId({ id: 'legacy-turn' }, 'user'), 'legacy-turn:user');
    assert.notEqual(conversationMessageId(turn, 'user'), conversationMessageId(turn, 'assistant'));
});

test('history CAS token ignores draft writes but changes for revisions and turn topology', () => {
    const baseline = { historyRevision: 2, updatedAt: 10, turns: [{ id: 'one' }] };
    assert.notEqual(conversationHistoryStateToken(baseline), conversationHistoryStateToken({ ...baseline, historyRevision: 3 }));
    assert.equal(conversationHistoryStateToken(baseline), conversationHistoryStateToken({
        ...baseline,
        updatedAt: 11,
        draftPrompt: 'saved while restore is in flight'
    }));
    assert.notEqual(conversationHistoryStateToken(baseline), conversationHistoryStateToken({ ...baseline, turns: [...baseline.turns, { id: 'two' }] }));
    assert.notEqual(conversationHistoryStateToken(
        { ...baseline, turns: [{ id: 'one' }, { id: 'two' }] }
    ), conversationHistoryStateToken(
        { ...baseline, turns: [{ id: 'other' }, { id: 'two' }] }
    ));
});

test('conversation mutations are exclusive per conversation and release is idempotent', () => {
    const lock = new ConversationMutationLock();
    const releaseFirst = lock.tryAcquire('conversation-a');
    const releaseOther = lock.tryAcquire('conversation-b');
    assert.equal(typeof releaseFirst, 'function');
    assert.equal(typeof releaseOther, 'function');
    assert.equal(lock.tryAcquire('conversation-a'), undefined);

    releaseFirst();
    const releaseSecond = lock.tryAcquire(' conversation-a ');
    assert.equal(typeof releaseSecond, 'function');
    releaseFirst();
    assert.equal(lock.tryAcquire('conversation-a'), undefined,
        'an old release callback cannot unlock a newer mutation');

    releaseSecond();
    releaseOther();
    assert.equal(typeof lock.tryAcquire('conversation-a'), 'function');
    assert.equal(lock.tryAcquire(''), undefined);
});

test('conversation slicing stops immediately before the edited message', () => {
    assert.deepEqual(conversationTurnsBefore(turns, 'one'), []);
    assert.deepEqual(conversationTurnsBefore(turns, 'three').map(turn => turn.id), ['one', 'two']);
    assert.throws(() => conversationTurnsBefore(turns, 'missing'), /Unknown conversation turn/);
});

test('a branch gets a new conversation identity while inherited message IDs stay stable', () => {
    const cloned = inheritConversationTurnsBefore(turns, 'three');
    assert.deepEqual(cloned.map(turn => turn.id), ['one', 'two']);
    assert.deepEqual(turns.map(turn => turn.id), ['one', 'two', 'three', 'four']);
    assert.notStrictEqual(cloned[0], turns[0]);
    assert.equal(new Set(cloned.map(turn => turn.id)).size, cloned.length);
});

test('branching from reply 88 clones turns 1-88 inclusively and keeps nested IDs stable', () => {
    const source = Array.from({ length: 100 }, (_, index) => ({
        id: `turn-${index + 1}`,
        prompt: `prompt-${index + 1}`,
        response: `response-${index + 1}`,
        stage: 'complete',
        attachments: [{ id: `attachment-${index + 1}`, name: `file-${index + 1}.txt` }]
    }));

    const inherited = inheritConversationTurnsThrough(source, 'turn-88');
    assert.equal(inherited.length, 88);
    assert.equal(inherited[87].id, 'turn-88');
    assert.equal(inherited.some(turn => turn.id === 'turn-89'), false);
    assert.equal(inherited[87].attachments[0].id, 'attachment-88');
    assert.notStrictEqual(inherited[87], source[87]);
    assert.notStrictEqual(inherited[87].attachments, source[87].attachments);
});

test('branching from a user message keeps that prompt but excludes its assistant reply', () => {
    const source = turns.map(turn => turn.id === 'three' ? {
        ...turn,
        executionLabel: '4 rounds',
        usageLabel: '100 input · 25 output',
        billingLabel: '$0.01'
    } : turn);
    const inherited = inheritConversationTurnsThroughMessage(source, 'three', 'user');

    assert.deepEqual(inherited.map(turn => turn.id), ['one', 'two', 'three']);
    assert.equal(inherited.at(-1).prompt, 'p3');
    assert.equal(inherited.at(-1).response, '');
    assert.equal(inherited.at(-1).branchUserOnly, true);
    assert.equal(inherited.at(-1).executionLabel, undefined);
    assert.equal(inherited.at(-1).usageLabel, undefined);
    assert.equal(inherited.at(-1).billingLabel, undefined);
    assert.notStrictEqual(inherited.at(-1), source[2]);
    assert.deepEqual(completedConversationHistory(inherited, 12), [
        { role: 'user', content: 'p1' },
        { role: 'assistant', content: 'r1' },
        { role: 'user', content: 'p2' },
        { role: 'assistant', content: 'r2' },
        { role: 'user', content: 'p3' }
    ]);
});

test('a branch at reply 88 preserves bounded memory through turn 88 and excludes turn 89', () => {
    const source = Array.from({ length: 100 }, (_, index) => ({
        id: `turn-${index + 1}`,
        prompt: `PROMPT_MARKER_${index + 1}`,
        response: `RESPONSE_MARKER_${index + 1}`,
        stage: 'complete'
    }));
    const branch = inheritConversationTurnsThroughMessage(source, 'turn-88', 'assistant');
    const history = compactedConversationHistory(branch);
    const serialized = JSON.stringify(history);

    assert.match(serialized, /PROMPT_MARKER_1/);
    assert.match(serialized, /PROMPT_MARKER_50/);
    assert.match(serialized, /PROMPT_MARKER_88/);
    assert.doesNotMatch(serialized, /PROMPT_MARKER_89/);
    assert.ok(history.length <= 24);
    assert.ok(history.reduce((sum, message) => sum + message.content.length, 0) <= 150_000);
});

test('edited history restores images, files, and pasted text in their original attachment order', () => {
    const original = [
        { id: 'image-a', uri: 'file:///cache/image.png', name: 'image.png', kind: 'image' },
        { id: 'paste-a', uri: 'file:///cache/paste.txt', name: 'paste.txt', kind: 'text', inlineReference: '[Pasted text file: paste.txt]' },
        { id: 'file-a', uri: 'file:///cache/report.pdf', name: 'report.pdf', kind: 'file' }
    ];
    const recovered = [
        { id: 'file-a', payload: 'file' },
        { id: 'image-a', payload: 'image' },
        { id: 'paste-a', payload: 'paste' }
    ];

    assert.deepEqual(
        conversationAttachmentsInOriginalOrder(original, recovered).map(item => item.id),
        ['image-a', 'paste-a', 'file-a']
    );
    assert.throws(
        () => conversationAttachmentsInOriginalOrder(original, recovered.slice(0, 2)),
        /paste\.txt|attachment/i
    );
});

test('branch inheritance keeps message and attachment IDs stable without sharing mutable records', () => {
    const source = [{
        ...turns[0],
        attachments: [
            { id: 'image-a', uri: 'file:///cache/image.png', name: 'image.png', kind: 'image' },
            { id: 'file-a', uri: 'file:///cache/file.pdf', name: 'file.pdf', kind: 'file' }
        ],
        changes: [{ checkpointId: 'checkpoint-1' }],
        events: [{ type: 'tool', detail: { status: 'complete' } }]
    }, turns[1]];

    const inherited = inheritConversationTurnsBefore(source, 'two');
    assert.equal(inherited[0].id, source[0].id);
    assert.deepEqual(inherited[0].attachments.map(item => item.id), ['image-a', 'file-a']);
    assert.notStrictEqual(inherited[0].attachments, source[0].attachments);
    assert.notStrictEqual(inherited[0].attachments[0], source[0].attachments[0]);
    assert.notStrictEqual(inherited[0].changes, source[0].changes);
    assert.notStrictEqual(inherited[0].events[0].detail, source[0].events[0].detail);

    const branchFutureTurn = { id: 'branch-future-1', prompt: 'branch', response: '', stage: 'running' };
    const sourceFutureTurn = { id: 'source-future-1', prompt: 'source', response: '', stage: 'running' };
    const branchHistory = [...inherited, branchFutureTurn];
    const sourceHistory = [...source, sourceFutureTurn];
    assert.equal(new Set(branchHistory.map(turn => turn.id)).size, branchHistory.length);
    assert.equal(branchHistory.some(turn => turn.id === sourceFutureTurn.id), false);
    assert.equal(sourceHistory.some(turn => turn.id === branchFutureTurn.id), false);
    branchHistory[0].attachments[0].name = 'branch-only.png';
    assert.equal(source[0].attachments[0].name, 'image.png');
});

test('model history after an edit cannot include the target or later messages', () => {
    const prefix = conversationTurnsBefore(turns, 'three');
    assert.deepEqual(completedConversationHistory(prefix, 12), [
        { role: 'user', content: 'p1' },
        { role: 'assistant', content: 'r1' },
        { role: 'user', content: 'p2' },
        { role: 'assistant', content: 'r2' }
    ]);
});

test('long histories stay within the runtime message and character contract', () => {
    const longTurns = Array.from({ length: 40 }, (_, turnIndex) => ({
        id: `turn-${turnIndex}`,
        prompt: `prompt-${turnIndex}-${'p'.repeat(7_000)}`,
        response: `response-${turnIndex}-${'r'.repeat(7_000)}`,
        stage: 'complete',
        steeringMessages: Array.from({ length: 16 }, (_, directionIndex) => ({
            id: `direction-${turnIndex}-${directionIndex}`,
            content: `direction-${turnIndex}-${directionIndex}-${'d'.repeat(2_000)}`,
            status: 'applied'
        }))
    }));
    const history = completedConversationHistory(longTurns, 500);
    assert.ok(history.length <= 24);
    assert.ok(history.reduce((sum, message) => sum + message.content.length, 0) <= 150_000);
    assert.ok(history.every(message => message.content.length <= 20_000));
    assert.match(history.at(-1).content, /^response-39-/);
    assert.match(history[0].content, /^(?:prompt|direction)-\d+/);
});

test('workspace checkpoints after the edit point unwind in exact reverse execution order', () => {
    const checkpointTurns = [
        { ...turns[0], changes: [{ checkpointId: 'checkpoint-00000001' }] },
        { ...turns[1], changes: [{ checkpointId: 'checkpoint-00000002' }, { checkpointId: 'checkpoint-00000003' }] },
        { ...turns[2], changes: [{ checkpointId: 'checkpoint-00000004' }] },
        { ...turns[3], changes: [{ checkpointId: 'checkpoint-00000005' }, { checkpointId: 'checkpoint-00000006' }] }
    ];
    assert.deepEqual(conversationCheckpointIdsToRestore(checkpointTurns, 'three'), [
        'checkpoint-00000006', 'checkpoint-00000005', 'checkpoint-00000004'
    ]);
    assert.deepEqual(conversationCheckpointIdsToRestore(checkpointTurns, 'one'), [
        'checkpoint-00000006', 'checkpoint-00000005', 'checkpoint-00000004',
        'checkpoint-00000003', 'checkpoint-00000002', 'checkpoint-00000001'
    ]);
});

test('chat-only branches do not request a workspace copy, while file changes and cached attachments do', () => {
    assert.equal(conversationTurnsHaveWorkspaceState([
        { id: 'chat', prompt: 'hello', response: 'hi', stage: 'complete', changes: [] }
    ]), false);
    assert.equal(conversationTurnsHaveWorkspaceState([
        { id: 'edit', prompt: 'edit', response: 'done', stage: 'complete', changes: [{ checkpointId: 'checkpoint-00000001' }] }
    ]), true);
    assert.equal(conversationTurnsHaveWorkspaceState([
        { id: 'attachment', prompt: 'inspect', response: 'done', stage: 'complete', changes: [], attachments: [{ workspaceRelativePath: '.nextmux/conversation-attachments/a.txt' }] }
    ]), true);
});

test('restored checkpoint identity is always scoped to one conversation branch', () => {
    assert.equal(
        conversationCheckpointRestoreKey('source', '', 'checkpoint-1'),
        'conversation:source::checkpoint-1'
    );
    assert.notEqual(
        conversationCheckpointRestoreKey('source', '', 'checkpoint-1'),
        conversationCheckpointRestoreKey('branch', '', 'checkpoint-1')
    );
    assert.notEqual(
        conversationCheckpointRestoreKey('source', 'C:\\work\\demo\\', 'checkpoint-1'),
        conversationCheckpointRestoreKey('branch', 'C:/work/demo', 'checkpoint-1')
    );
});

test('edit and branch controls are localized for every desktop language', () => {
    const locales = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
    for (const locale of locales) {
        for (const key of ['copyMessage', 'editMessage', 'branchTitle', 'branchPrompt', 'branchAttachmentNote', 'attachmentRecoveryFailed', 'branchSuffix', 'replaceWarning', 'restoreWorkspaceOption', 'restoreWorkspaceHint', 'createBranch', 'dontCreate', 'cancel', 'restoringCode', 'restoreFailed', 'restoreWorkspaceMissing']) {
            assert.ok(conversationText(locale, key).trim(), `${locale}.${key}`);
        }
    }
});

test('desktop surface wires inline editing, explicit branch choice and optional workspace rewind', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
    const style = readFileSync(fileURLToPath(new URL('../src/browser/style/nextmux.css', import.meta.url)), 'utf8');
    const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
    const methodText = name => {
        const method = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name);
        assert.ok(method, name);
        return method.getText(file);
    };
    const prepare = methodText('prepareConversationBranchWorkspace');
    const confirm = methodText('confirmTurnEdit');
    const branch = methodText('branchCodingSession');
    assert.doesNotMatch(source, /turnEditCountdown|dontCreateCountdown|createBranchCountdown/);
    assert.match(source, /className='nmx-user-message-actions'/);
    assert.match(source, /className='nmx-user-message-editor'/);
    assert.match(source, /confirmTurnEdit\('branch'\)/);
    assert.match(source, /confirmTurnEdit\('replace'\)/);
    assert.match(prepare, /forkConversationWorkspaces\(\{\s*sourceConversationId: source\.id,\s*targetConversationId: branch\.id/,
        'the shared branch path must request an independently owned multi-root copy');
    assert.match(confirm, /await this\.prepareConversationBranchWorkspace\(source, branch, requestedRestorePlan\)/);
    assert.match(branch, /await this\.prepareConversationBranchWorkspace\(source, branch\)/);
    assert.match(prepare, /roots\.map\(workspaceRoot => \(\{ workspaceRoot,[\s\S]*?inheritedCheckpointIds:[\s\S]*?checkpointIds:/,
        'all bound roots preserve inherited checkpoints separately from the requested rollback chain');
    assert.match(prepare, /ownedWorkspace:\s*true/);
    assert.match(prepare, /rebaseProjectlessConversationAttachments\(target, target\.privateWorkspacePath!, source\)/,
        'both branch entry points rebase attachments through the shared path');
    assert.doesNotMatch(prepare, /restoreAgentCheckpoint(?:Chain|Groups)\(/,
        'branch preparation must never restore directly in the source roots');
    assert.match(confirm, /if \(restoreWorkspace && mode === 'replace'\)[\s\S]*?restoreAgentCheckpointGroups\(restorePlans,/,
        'only an in-place edit sends the original multi-root restore transaction');
    const lockIndex = confirm.indexOf('this.conversationMutations.tryAcquire(source.id)');
    const attachmentRecoveryIndex = confirm.indexOf('await this.resolveTurnAttachments(source, pending.turnId)', lockIndex);
    const casIndex = confirm.indexOf('currentSource();', lockIndex);
    const restoreIndex = confirm.indexOf('restoreAgentCheckpointGroups(restorePlans,');
    const commitCasIndex = confirm.indexOf('const committedSource = currentSource();', restoreIndex);
    const commitIndex = confirm.indexOf('conversationTurnsBefore(committedSource.turns, pending.turnId)', commitCasIndex);
    const releaseIndex = confirm.indexOf('releaseConversationMutation?.();', commitIndex);
    const submitIndex = confirm.indexOf("this.submitPrompt('coding', undefined, undefined, historicalExecutionToSubmit)", releaseIndex);
    assert.ok(lockIndex >= 0 && attachmentRecoveryIndex > lockIndex && casIndex > attachmentRecoveryIndex && restoreIndex > casIndex
        && commitCasIndex > restoreIndex && commitIndex > commitCasIndex
        && releaseIndex > commitIndex && submitIndex > releaseIndex,
    'one conversation lock must span attachment recovery, pre-restore CAS, filesystem restore and the final history commit');
    assert.match(source, /conversationCheckpointIdsToRestore\(source\.turns, pending\.turnId\)/);
    assert.match(source, /session\.ownedWorkspace \|\| !session\.workspacePath[\s\S]{0,160}?getConversationWorkspace(?:Bindings)?\(session\.id\)/,
        'legacy projectless conversations resolve their backend-owned workspace without accepting stale project paths');
    assert.match(source, /pastedTextReferences:\s*turn\.pastedTextReferences \|\| ''/);
    assert.match(source, /const historicalPastedTextReferences = deserializePastedTextReferences\(pending\.pastedTextReferences\)/);
    assert.match(source, /pastedTextReferencesInDocument\(pending\.prompt,\s*historicalPastedTextReferences\)/);
    assert.match(source, /pastedTextReferences,\s*attachmentOrder: editedTurnAttachmentOrder/);
    assert.match(source, /await this\.resolveTurnAttachments\(source, pending\.turnId\)/);
    assert.match(source, /conversationAttachmentsInOriginalOrder\(/);
    assert.match(source, /let composerAttachments:[^=]+ = recoveredAttachments\.filter\(attachment =>/);
    assert.match(source, /turnPastedTextReferences = historicalExecution\.pastedTextReferences/);
    assert.match(source, /const editedTurnAttachmentOrder = \(sourceTurn\.attachments \|\| \[\]\)[\s\S]*?\.map\(attachment => attachment\.id\)/);
    assert.match(source, /attachmentOrder: editedTurnAttachmentOrder/);
    assert.match(source, /platformService\.readDesktopAttachment\(/);
    assert.match(source, /discardConversationWorkspace\(/);
    assert.match(source, /session\.ownedWorkspace \|\| !session\.workspacePath[\s\S]*?discardConversationWorkspace\(sessionId\)/,
        'deleting an owned fork must remove its private files and checkpoints');
    // Attachments no longer block a send: documents become text and other files a description.
    assert.match(source, /typeof this\.deliverableAttachments === 'function'[\s\S]*?attachments = await this\.deliverableAttachments\(taskAttachments, route, documents\)/);
    assert.doesNotMatch(source, /recoverableAttachmentResource/);
    assert.match(source, /platformService\.readDesktopAttachment\(/);
    assert.match(source, /throw new ConversationAttachmentRecoveryError\(conversationText\(/);
    assert.match(source, /error instanceof ConversationAttachmentRecoveryError/);
    assert.match(source, /conversationCheckpointRestoreKey\(/);
    assert.match(source, /className='nmx-branch-restore nmx-turn-edit-restore'[\s\S]*?type='checkbox'[\s\S]*?checked=\{this\.turnEditRestoreWorkspace\}/);
    // Rollback remains a body option; footer order is Create branch (primary), Cancel, Continue.
    const dialogStart = source.indexOf("className='nmx-thread-dialog nmx-turn-edit-dialog nmx-branch-dialog'");
    const footerStart = source.indexOf('<footer>', dialogStart);
    const footerEnd = source.indexOf('</footer>', footerStart);
    const footer = source.slice(footerStart, footerEnd);
    const rollbackIndex = source.indexOf("className='nmx-branch-restore nmx-turn-edit-restore'", dialogStart);
    const replaceIndex = footer.indexOf("confirmTurnEdit('replace')");
    const branchIndex = footer.indexOf("confirmTurnEdit('branch')");
    const cancelIndex = footer.indexOf('dismissTurnEditConfirmation()');
    assert.ok(dialogStart >= 0 && footerStart >= 0 && footerEnd > footerStart);
    assert.ok(rollbackIndex > dialogStart && rollbackIndex < footerStart, 'rollback is a body option, not a footer action');
    assert.ok(branchIndex >= 0 && branchIndex < cancelIndex && cancelIndex < replaceIndex, 'create branch, cancel and continue follow the requested order');
    assert.doesNotMatch(footer, /restoreWorkspaceHint|<small/);
    assert.match(footer, /className='theia-button main is-primary nmx-branch-replace' title=\{conversationText\(this\.desktopLocale, 'replaceWarning'\)\}/,
        'the destructive consequence stays attached to the replace action');
    assert.match(source, /this\.turnEditRestoreWorkspace = false/);
    assert.match(source, /setTurnEditRestoreWorkspace[\s\S]*?conversationCheckpointIdsToRestore/);
    assert.match(source, /getAgentCheckpointDiff\(workspaceRoot, checkpointId\)/);
    assert.match(source, /turnEditRestorePreview: TurnEditRestorePreview = \{ status: 'idle' \}/);
    assert.match(source, /restorePreview\.changes\.map\(change =>/);
    assert.match(source, /disabled=\{!this\.conversationHistoryReady\(\) \|\| this\.turnEditSubmitting \|\| restoreBlocked\}/);
    assert.match(style, /\.nmx-turn-edit-diff-preview/);
    assert.match(source, /turnAttachmentPayloadKey\(sessionId: string, attachmentId: string\)/);
    assert.match(source, /turnAttachmentPayloads\.get\(this\.turnAttachmentPayloadKey\(session\.id, attachment\.id\)\)/);
    assert.match(source, /this\.turnEditSubmitting/);
    let menuGate;
    const findMenuGate = node => {
        if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'assistantMenuAvailable') menuGate = node.initializer;
        ts.forEachChild(node, findMenuGate);
    };
    findMenuGate(file);
    assert.ok(menuGate, 'assistant menu has an explicit settled-output gate');
    const canOpenMenu = Function('stage', 'assistantCopyText', `return (${menuGate.getText(file)});`);
    assert.equal(canOpenMenu('running', 'partial output'), false);
    assert.equal(canOpenMenu('complete', ''), false);
    assert.equal(canOpenMenu('complete', 'final output'), true);
    assert.equal(canOpenMenu('error', 'localized error'), true);
    assert.match(source, /this\.turnCopyMenuId === assistantMessageMenuId && assistantMenuAvailable && <section/);
    assert.match(source, /inheritConversationTurnsBefore\(source\.turns, pending\.turnId\)/);
    assert.match(source, /conversationTurnsBefore\(committedSource\.turns, pending\.turnId\)/);
    assert.match(source, /title: `\$\{source\.title\} · \$\{conversationText\(this\.desktopLocale, 'branchSuffix'\)\}`/);
    assert.match(source, /protected async branchCodingSession/);
    assert.match(style, /\.nmx-user-message:hover \.nmx-user-message-actions/);
    assert.match(style, /\.nmx-turn-edit-dialog/);
    assert.match(style, /\.nmx-dialog-backdrop \{[\s\S]*?z-index:\s*120/);
});

test('editing prompt 90 in place permanently replaces the old 90-100 model context', () => {
    const source = Array.from({ length: 100 }, (_, index) => ({
        id: `turn-${index + 1}`,
        prompt: `PROMPT_${index + 1}${index >= 89 ? '_OLD_TAIL_MARKER' : ''}`,
        modelPrompt: `MODEL_PROMPT_${index + 1}${index >= 89 ? '_OLD_TAIL_MARKER' : ''}`,
        response: `RESPONSE_${index + 1}${index >= 89 ? '_OLD_TAIL_MARKER' : ''}`,
        steeringMessages: [{
            id: `direction-${index + 1}`,
            content: `DIRECTION_${index + 1}${index >= 89 ? '_OLD_TAIL_MARKER' : ''}`,
            status: 'applied'
        }],
        stage: 'complete'
    }));
    const retained = conversationTurnsBefore(source, 'turn-90');
    const editedPrompt = 'PROMPT_90_EDITED';
    const modelInput = [...compactedConversationHistory(retained), { role: 'user', content: editedPrompt }];

    assert.equal(retained.length, 89);
    assert.equal(retained.at(-1).id, 'turn-89');
    assert.equal(modelInput.at(-1).content, editedPrompt);
    assert.equal(modelInput.some(message => message.content.includes('OLD_TAIL_MARKER')), false);
    assert.equal(modelInput.some(message => /MODEL_PROMPT_(?:9\d|100)/.test(message.content)), false);
    assert.equal(modelInput.some(message => /RESPONSE_(?:9\d|100)/.test(message.content)), false);
    assert.equal(modelInput.some(message => /DIRECTION_(?:9\d|100)/.test(message.content)), false);
    assert.equal(source.length, 100, 'pure truncation does not mutate the pre-edit snapshot');
});

test('historical resend binds an immutable target instead of re-reading the active conversation after async work', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');

    assert.match(source, /interface HistoricalPromptExecution/);
    assert.match(source, /readonly preparedTurnId: string/);
    assert.match(source, /sessionId:\s*targetSessionId/);
    assert.match(source, /expectedTailTurnId:/);
    assert.match(source, /historicalExecution\?\.sessionId/);
    assert.match(source, /preparedHistoricalTurn = historicalExecution[\s\S]*?historicalExecution\.preparedTurnId/,
        'the replacement turn must already exist before its model execution starts');
    assert.match(source, /turns:\s*\[\.\.\.conversationTurnsBefore\(committedSource\.turns, pending\.turnId\), replacementTurn\]/,
        'truncation and replacement must be committed in one session snapshot');
    assert.match(source, /historyRevision:\s*\(committedSource\.historyRevision \|\| 0\) \+ 1/,
        'destructive history rewrites must advance the merge generation');
    assert.match(source, /const currentSource = \(\): CodingSessionRecord => \{[\s\S]*?conversationHistoryStateToken\(current\) !== expectedSourceState/,
        'historical resend must compare-and-swap the source after asynchronous recovery');
    assert.match(source, /const committedSource = currentSource\(\);[\s\S]*?\.\.\.committedSource,[\s\S]*?historyRevision:\s*\(committedSource\.historyRevision \|\| 0\) \+ 1/,
        'the final replace commit must use the post-restore session snapshot');
    assert.match(source, /openCodingSession\(targetSessionId, undefined, false\)/,
        'a prepared running turn must not be mistaken for an already-started agent run');
    assert.match(source, /openCodingSession\(sessionId: string, targetTurnId\?: string, adoptLatestRunState = true(?:,\s*targetMessageId\?: string)?\)/,
        'ordinary navigation should continue adopting persisted run state');
    assert.match(source, /historicalExecution\?\.route/);
    assert.match(source, /historicalExecution\?\.permissionMode/);
    assert.match(source, /historicalExecution\?\.reasoningEffort/);
    assert.match(source, /this\.reasoningEffortLevels\(sourceRoute\)\.includes\(source\.reasoningEffort\)/,
        'historical resend must not replay an effort field unsupported by the pinned transport');
    assert.doesNotMatch(source, /requestAnimationFrame\(\(\) => void this\.submitPrompt\('coding'\)\)/,
        'edited prompts must not wait a frame and then submit against mutable global state');
});

test('submit, queue and checkpoint restore share the per-conversation mutation lock', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');

    const submitStart = source.indexOf('protected async submitPrompt(');
    const submitEnd = source.indexOf('protected async restoreCheckpoint(', submitStart);
    const submit = source.slice(submitStart, submitEnd);
    const acquire = submit.indexOf('this.conversationMutations.tryAcquire(mutationSessionId)');
    const workspace = submit.indexOf('await this.ensureCodingSessionWorkspace(codingSession)');
    const running = submit.indexOf("run.agentStage = 'running'");
    const release = submit.indexOf('releaseConversationMutation?.();');
    const launch = submit.indexOf('await this.prepareAgentSkills(effectiveWorkspaceRoot)');
    assert.ok(acquire >= 0 && workspace > acquire && running > workspace && release > running && launch > release,
        'submission holds the lock through turn persistence, then releases it before the long-running agent');

    const queueStart = source.indexOf('protected updateFollowUpQueue(');
    const queueEnd = source.indexOf('protected discardSessionFollowUpQueue(', queueStart);
    const queue = source.slice(queueStart, queueEnd);
    assert.match(queue, /this\.conversationMutations\.tryAcquire\(sessionId\)/);
    assert.match(queue, /if \(!releaseConversationMutation\) return false/);
    assert.match(queue, /finally \{\s*releaseConversationMutation\(\)/);

    const drainStart = source.indexOf('protected async drainFollowUpQueue(');
    const drainEnd = source.indexOf('protected async pollAgentRun(', drainStart);
    const drain = source.slice(drainStart, drainEnd);
    assert.ok(drain.indexOf('await this.resolveQueuedAttachments(task)')
        < drain.indexOf('if (!this.updateFollowUpQueue(session.id'),
    'queue drain must re-enter the lock after asynchronous attachment recovery and before dequeue');

    const restoreStart = source.indexOf('protected async restoreCheckpoint(');
    const restoreEnd = source.indexOf('protected async openCheckpointDiff(', restoreStart);
    const restore = source.slice(restoreStart, restoreEnd);
    assert.match(restore, /this\.conversationMutations\.tryAcquire\(session\.id\)/);
    assert.ok(restore.indexOf('tryAcquire(session.id)') < restore.indexOf('restoreAgentCheckpointGroups(plans)'));
    assert.match(restore, /finally \{[\s\S]*?releaseConversationMutation\?\.\(\)/);
});

test('assistant message menu exposes branching while user messages keep copy and edit only', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
    const style = readFileSync(fileURLToPath(new URL('../src/browser/style/nextmux.css', import.meta.url)), 'utf8');
    assert.match(source, /inheritConversationTurnsThroughMessage\(source\.turns, targetTurnId, messageRole\)/);
    assert.match(source, /const assistantMessageMenuId = `assistant:\$\{turn\.id\}`/);
    assert.match(source, /renderTurnMessageMenuItems\(codingSession\?\.id \|\| this\.activeCodingSessionId, turn, 'assistant', assistantCopyText, branchDisabled\)/);
    assert.match(source, /branchCodingSession\(codingSession\?\.id \|\| this\.activeCodingSessionId, turn\.id, 'assistant'\)/);
    assert.match(source, /disabled=\{branchDisabled\}[\s\S]*?conversationText\(this\.desktopLocale, 'createBranch'\)/);
    assert.equal((source.match(/browsers: source\.browsers\?\.map\(browser => \(\{ \.\.\.browser \}\)\)/g) || []).length, 1);
    assert.equal((source.match(/viewState: source\.viewState \? \{ \.\.\.source\.viewState \} : undefined/g) || []).length, 1);
    assert.ok((source.match(/followUpQueue: \[\]/g) || []).length >= 2);
    assert.match(source, /protected createCodingSessionBranch[\s\S]*?id: crypto\.randomUUID\(\)/);
    assert.match(source, /sourceConversationId: source\.id/);
    assert.match(source, /conversationMessageId\(sourceTurn, sourceRole\)/);
    assert.match(source, /protected appendCodingTurn[\s\S]*?id: crypto\.randomUUID\(\)/);
    assert.match(source, /data-message-action='copy'/);
    assert.match(source, /data-message-action='edit'/);
    assert.match(source, /data-message-action='create-branch'/);
    assert.match(source, /data-message-action='more'/);
    assert.doesNotMatch(source, /nmx-message-menu-trigger-\$\{turn\.id\}-user/);
    assert.doesNotMatch(source, /nmx-user-message-menu/);
    const threadStart = source.indexOf('const assistantMessageMenuId =');
    const thread = source.slice(threadStart, source.indexOf('protected ', threadStart));
    const menu = source.slice(source.indexOf('protected renderTurnMessageMenuItems'), source.indexOf('protected async branchCodingSession'));
    assert.equal((thread.match(/aria-haspopup='menu'/g) || []).length, 1);
    assert.equal((thread.match(/role='menu'/g) || []).length, 1);
    assert.equal((menu.match(/role='menuitem'/g) || []).length, 3,
        'assistant message keeps the shared menu: undo file changes (when the turn made some), copy content, and copy message id locator');
    assert.match(menu, /\{turn\.changes && turn\.changes\.length > 0 && <button role='menuitem' data-message-action='revert-files-only'/);
    assert.match(source, /userMessageId: crypto\.randomUUID\(\)/);
    assert.match(source, /assistantMessageId: crypto\.randomUUID\(\)/);
    assert.match(source, /conversationMessageId\(turn, role\)/);
    assert.ok((source.match(/draftPrompt:\s*undefined/g) || []).length >= 3);
    assert.ok((source.match(/draftPastedTextReferences:\s*undefined/g) || []).length >= 3);
    assert.match(source, /const truncated: CodingSessionRecord = \{[\s\S]*?followUpQueue: \[\],[\s\S]*?draftPrompt: undefined,[\s\S]*?draftPastedTextReferences: undefined/,
        'editing in place must not restore the discarded conversation draft after a failed resend');
    assert.match(source, /!turn\.branchUserOnly && <div className=\{`nmx-agent-message/);
    assert.match(source, /protected cloneInMemoryTurnAttachmentsForBranch[\s\S]*?turnAttachmentPayloadKey\(sourceSessionId, attachment\.id\)[\s\S]*?turnAttachmentPayloadKey\(branchSessionId, attachment\.id\)/,
        'project branches must re-key volatile attachment payloads to the new conversation');
    assert.equal((source.match(/cloneInMemoryTurnAttachmentsForBranch\(source\.id, branch\.id, branch\.turns\)/g) || []).length, 1,
        'the shared branch preparation path preserves volatile project attachments for both entry points');
    assert.match(source, /protected toggleTurnMessageMenu/);
    assert.match(source, /protected handleTurnMessageMenuKeyDown/);
    assert.match(source, /event\.key === 'Escape' && this\.turnCopyMenuId/);
    assert.doesNotMatch(source, /className='nmx-session-menu nmx-message-menu'/,
        'message menus must not inherit the project-sidebar menu width contract');
    assert.match(style, /\.nmx-message-menu\s*>\s*button\s*\{[\s\S]*?white-space:\s*nowrap;/);
});

test('branch and edit confirmation dialogs trap focus without a duplicate checkbox focus frame', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
    const style = readFileSync(fileURLToPath(new URL('../src/browser/style/nextmux.css', import.meta.url)), 'utf8');
    assert.match(source, /protected trapDialogFocus\(event: React\.KeyboardEvent<HTMLElement>\)/);
    assert.match(source, /className='nmx-thread-dialog nmx-turn-edit-dialog nmx-branch-dialog' role='alertdialog'[\s\S]*?onKeyDown=\{event => this\.trapDialogFocus\(event\)\}/);
    assert.match(style, /\.nmx-turn-edit-restore:has\(input:focus-visible\)\s*\{[\s\S]*?outline:\s*0;[\s\S]*?box-shadow:/);
});

test('desktop branch E2E covers 100-turn context isolation without keyboard or mouse injection', () => {
    const source = readFileSync(fileURLToPath(new URL('../../../scripts/desktop-conversation-branch-e2e.mjs', import.meta.url)), 'utf8');
    const widgetSource = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
    assert.match(source, /Array\.from\(\{ length: 100 \}/);
    assert.match(source, /branchTurns === 88/);
    assert.match(source, /sourceTurns === 90/);
    assert.match(source, /const branchRpc = await capturedAgentRequest\(branchProbe, route\)/,
        'the E2E must capture the actual structured agent RPC for the branched turn');
    assert.match(source, /const serializedBranchRequest = JSON\.stringify\(branchRequest\)/);
    assert.match(source, /hasTarget:\s*serializedBranchRequest\.includes\(keep88Marker\)/);
    assert.match(source, /hasTurn89:\s*serializedBranchRequest\.includes\(keep89Marker\)/);
    assert.match(source, /hasOldTail:\s*serializedBranchRequest\.includes\(forbiddenTailMarker\)/);
    assert.match(source, /!evidence\.replaceContext\.hasOldTail/);
    assert.match(source, /user-message point-in-time branch is created/,
        'the E2E must actually click the user-message branch action, not only inspect its label');
    assert.match(source, /source draft, pasted-text reference and queue stay owned by the source while the branch starts clean/);
    assert.match(source, /hasTargetPrompt:\s*serializedUserBranchRequest\.includes\(userBranchPromptMarker\)/);
    assert.match(source, /hasTargetResponse:\s*serializedUserBranchRequest\.includes\(userBranchForbiddenResponseMarker\)/);
    assert.match(source, /user-message branch model context stops exactly after the selected user prompt/);
    assert.match(source, /projectless attachment URI is rebased/);
    assert.match(source, /every post-branch turn ID is new and disjoint from the source tail/);
    assert.match(source, /source and branch have independent durable records/);
    assert.match(source, /branch inherits route preferences without mutating the source record/);
    assert.match(source, /a capability-verified compatible route preserves the branch selected reasoning effort/,
        'the E2E must verify the UI does not leak an unsupported effort field into the model request');
    assert.match(widgetSource, /protected reasoningEffortForRoute[\s\S]*?route\.id === this\.activeModelRouteId[\s\S]*?const saved = this\.reasoningEffortByModel/,
        'an active branch must display its own effort before consulting the global per-model default');
    assert.match(widgetSource, /protected syncReasoningEffort\(route: DesktopModelRoute \| undefined, sessionValue\?: AgentReasoningEffort\)[\s\S]*?sessionValue && levels\.includes\(sessionValue\)[\s\S]*?const saved = this\.reasoningEffortByModel/,
        'restoring a conversation keeps its own effort before consulting the global per-model default');
    assert.match(widgetSource, /this\.syncReasoningEffort\(route, session\?\.reasoningEffort\)/,
        'model-route synchronization restores the active conversation effort');
    assert.match(widgetSource, /data-reasoning-depth=\{item\.id\}/,
        'thinking-depth choices expose stable locale-independent automation semantics');
    assert.match(source, /projectless checkpoint and persistence records are copied into independent branch scopes/);
    assert.doesNotMatch(source, /Input\.dispatch|dispatchKeyEvent|dispatchMouseEvent|mousePressed|keyDown/);
});
