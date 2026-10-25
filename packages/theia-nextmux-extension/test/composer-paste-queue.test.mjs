import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import React from 'react';
import {
    LONG_PASTE_BYTE_THRESHOLD,
    LONG_PASTE_CHARACTER_THRESHOLD,
    LONG_PASTE_LINE_THRESHOLD,
    PastedTextMessageChip,
    composerOverlaySegments,
    createPastedTextReference,
    deserializePastedTextReferences,
    formatFollowUpQueueStatusBadge,
    formatPastedTextChipSummary,
    formatPastedTextModelPayload,
    insertPastedTextReference,
    materializePastedTextPrompt,
    parseUserPromptPastedSegments,
    removeAdjacentPastedTextMarker,
    removePastedTextReferenceById,
    resolvePastedReferenceFilePath,
    serializePastedTextReferences,
    shouldEnqueueComposerSubmissionWhileBusy,
    shouldExternalizePastedText
} from '../lib/browser/nextmux-composer-long-paste.js';
import { runningTaskText } from '../lib/browser/nextmux-running-task-locale.js';

const widgetPath = fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url));
const stylePath = fileURLToPath(new URL('../src/browser/style/nextmux-composer-attachments.css', import.meta.url));

test('Item 0A: long paste thresholds convert >= 1000 chars or >= 20 lines into inline pasted-text references', () => {
    assert.equal(LONG_PASTE_CHARACTER_THRESHOLD, 1_000);
    assert.equal(LONG_PASTE_LINE_THRESHOLD, 20);
    assert.equal(LONG_PASTE_BYTE_THRESHOLD, 4 * 1024);

    assert.equal(shouldExternalizePastedText('short text\nonly two lines'), false);
    assert.equal(shouldExternalizePastedText('x'.repeat(1_000)), true);
    assert.equal(shouldExternalizePastedText(Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n')), true);
});

test('Item 0A: cursor-position insertion, mixed text + multiple pasted chips, and summary metadata', () => {
    const firstContent = Array.from({ length: 86 }, (_, i) => `const row${i + 1} = ${i};`).join('\n');
    const secondContent = 'A'.repeat(1_250);

    const ref1 = createPastedTextReference({
        id: 'paste-1',
        ordinal: 1,
        createdAt: new Date('2026-10-20T00:00:00.000Z'),
        content: firstContent,
        attachment: {
            uri: 'file:///workspace/.nextmux/attachments/s1/a1/pasted-text-1.txt',
            workspaceRelativePath: '.nextmux/attachments/s1/a1/pasted-text-1.txt',
            size: Buffer.byteLength(firstContent, 'utf8')
        }
    });
    const ref2 = createPastedTextReference({
        id: 'paste-2',
        ordinal: 2,
        createdAt: new Date('2026-10-20T00:00:01.000Z'),
        content: secondContent,
        attachment: {
            uri: 'file:///workspace/.nextmux/attachments/s1/a2/pasted-text-2.txt',
            workspaceRelativePath: '.nextmux/attachments/s1/a2/pasted-text-2.txt',
            size: Buffer.byteLength(secondContent, 'utf8')
        }
    });

    assert.equal(ref1.lineCount, 86);
    assert.equal(ref1.charCount, firstContent.length);

    const summary1 = formatPastedTextChipSummary(ref1, 'zh-CN');
    assert.equal(summary1.title, '粘贴文本 #1 · 86 行');
    assert.match(summary1.subtitle, /^86 行 · \d+ 字 · /);
    assert.equal(summary1.filePath, '.nextmux/attachments/s1/a1/pasted-text-1.txt');
    assert.equal(resolvePastedReferenceFilePath({
        name: ref1.name,
        attachment: {
            uri: 'file:///workspace/.nextmux/attachments/s1/a1/pasted-text-1.txt',
            size: ref1.sizeBytes || 1
        }
    }), '/workspace/.nextmux/attachments/s1/a1/pasted-text-1.txt');

    // Insert first chip in the middle of existing text: [Text before] [Chip 1] [Text middle] [Chip 2] [Text after]
    const initial = '请帮我分析这段日志：和这段配置：然后给出修复方案';
    const firstCaret = '请帮我分析这段日志：'.length;
    const step1 = insertPastedTextReference(initial, firstCaret, firstCaret, ref1);
    const secondCaret = step1.value.indexOf('然后给出修复方案');
    const step2 = insertPastedTextReference(step1.value, secondCaret, secondCaret, ref2);

    const overlay = composerOverlaySegments(step2.value, [ref1, ref2]);
    const chipMarkers = overlay.filter(segment => segment.kind === 'pasted-marker');
    assert.equal(chipMarkers.length, 2);
    assert.equal(chipMarkers[0].text, ref1.marker);
    assert.equal(chipMarkers[1].text, ref2.marker);

    const materialized = materializePastedTextPrompt(step2.value, [ref1, ref2]);
    assert.equal(
        materialized,
        `请帮我分析这段日志：${ref1.modelReference}和这段配置：${ref2.modelReference}然后给出修复方案`
    );
});

test('Item 0A: atomic Backspace/Delete and × chip removal clean both prompt marker and reference list', () => {
    const ref1 = createPastedTextReference({
        id: 'paste-1',
        ordinal: 1,
        createdAt: new Date(0),
        content: 'x'.repeat(1_100)
    });
    const ref2 = createPastedTextReference({
        id: 'paste-2',
        ordinal: 2,
        createdAt: new Date(1),
        content: 'y'.repeat(1_100)
    });
    const doc = `前缀 ${ref1.marker} 中间 ${ref2.marker} 后缀`;

    // Backspace right after ref1.marker deletes the entire marker in one keystroke
    const caretAfterRef1 = doc.indexOf(ref1.marker) + ref1.marker.length;
    const backspaced = removeAdjacentPastedTextMarker(doc, caretAfterRef1, caretAfterRef1, 'backward', [ref1, ref2]);
    assert.ok(backspaced);
    assert.deepEqual(backspaced.removedIds, ['paste-1']);
    assert.deepEqual(backspaced.remainingReferences.map(r => r.id), ['paste-2']);
    assert.ok(!backspaced.value.includes(ref1.marker));
    assert.ok(backspaced.value.includes(ref2.marker));

    // Delete right before ref2.marker deletes the entire marker in one keystroke
    const caretBeforeRef2 = backspaced.value.indexOf(ref2.marker);
    const deleted = removeAdjacentPastedTextMarker(backspaced.value, caretBeforeRef2, caretBeforeRef2, 'forward', backspaced.remainingReferences);
    assert.ok(deleted);
    assert.deepEqual(deleted.removedIds, ['paste-2']);
    assert.equal(deleted.remainingReferences.length, 0);
    assert.ok(!deleted.value.includes(ref2.marker));

    // Clicking × on a chip removes both its inline marker and its reference entry
    const byId = removePastedTextReferenceById(doc, 'paste-1', [ref1, ref2]);
    assert.equal(byId.removed?.id, 'paste-1');
    assert.deepEqual(byId.remainingReferences.map(r => r.id), ['paste-2']);
    assert.ok(!byId.value.includes(ref1.marker));
    assert.ok(byId.value.includes(ref2.marker));
});

test('Item 0A: structured <pasted_file> payload and sent-message collapsible PastedTextMessageChip', () => {
    const content = Array.from({ length: 24 }, (_, i) => `line ${i + 1}`).join('\n');
    const relPath = '.nextmux/conversation-attachments/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-00000000-0000-4000-8000-000000000001.txt';
    const ref = createPastedTextReference({
        id: 'paste-1',
        ordinal: 1,
        createdAt: new Date(0),
        content,
        attachment: {
            uri: `file:///workspace/${relPath}`,
            workspaceRelativePath: relPath,
            size: Buffer.byteLength(content, 'utf8')
        }
    });

    const payload = formatPastedTextModelPayload(ref, content);
    assert.match(payload, /^<pasted_file path="\.nextmux\/conversation-attachments\/[a-f0-9-]+?\.txt" name="[^"]+" lines="24" chars="\d+">/);
    assert.match(payload, /<\/pasted_file>$/);

    const serialized = serializePastedTextReferences([ref]);
    const restored = deserializePastedTextReferences(serialized);
    assert.equal(restored.length, 1);
    assert.equal(restored[0].lineCount, 24);
    assert.equal(restored[0].charCount, content.length);

    const prompt = materializePastedTextPrompt(`请检查：${ref.marker}\n谢谢`, restored);
    const segments = parseUserPromptPastedSegments(prompt, restored, [
        {
            id: 'paste-1',
            name: ref.name,
            kind: 'text',
            uri: `file:///workspace/${relPath}`,
            workspaceRelativePath: relPath,
            size: ref.attachment.size
        }
    ]);
    const chipSegment = segments.find(segment => segment.kind === 'pasted-chip');
    assert.ok(chipSegment);
    assert.equal(chipSegment.reference?.lineCount, 24);

    const summary = formatPastedTextChipSummary(chipSegment.reference, 'zh-CN');
    assert.equal(summary.title, '粘贴文本 #1 · 24 行');
    assert.equal(summary.filePath, relPath);

    const element = React.createElement(PastedTextMessageChip, {
        segment: chipSegment,
        locale: 'zh-CN'
    });
    assert.equal(element.type, PastedTextMessageChip);
    assert.equal(element.props.segment.workspaceRelativePath, relPath);
});

test('Item 0B: sending new prompts while model is thinking/streaming enqueues into followUpQueue and never injects mid-turn', () => {
    assert.equal(shouldEnqueueComposerSubmissionWhileBusy({
        agentStage: 'idle',
        activeAgentRunId: '',
        hasRunningTurn: true,
        scheduledRunActive: false
    }), true);
    assert.equal(shouldEnqueueComposerSubmissionWhileBusy({
        agentStage: 'idle',
        activeAgentRunId: '',
        hasRunningTurn: false,
        scheduledRunActive: true
    }), true);
    assert.equal(shouldEnqueueComposerSubmissionWhileBusy({
        agentStage: 'idle',
        activeAgentRunId: '',
        hasRunningTurn: false,
        scheduledRunActive: false
    }), false);

    assert.equal(formatFollowUpQueueStatusBadge('zh-CN', false), '排队中 · 等待当前回复完成后自动发送');
    assert.equal(formatFollowUpQueueStatusBadge('en', false), 'Queued · Will send automatically after current response finishes');
    assert.equal(runningTaskText('zh-CN', 'steerNow'), '补充方向');
    assert.equal(runningTaskText('en', 'steerNow'), 'Steer');

    const locales = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
    const sampleRef = createPastedTextReference({
        id: 'paste-locale-1',
        ordinal: 1,
        createdAt: new Date(0),
        content: 'line 1\nline 2'
    });
    for (const locale of locales) {
        const chip = formatPastedTextChipSummary(sampleRef, locale);
        const waiting = formatFollowUpQueueStatusBadge(locale, false);
        const dispatching = formatFollowUpQueueStatusBadge(locale, true);
        assert.ok(chip.title && chip.subtitle, `chip summary for ${locale}`);
        assert.ok(waiting && dispatching && waiting !== dispatching, `queue badges for ${locale}`);
        if (locale !== 'zh-CN' && locale !== 'zh-TW') {
            assert.doesNotMatch(chip.title, /粘贴文本|貼上文字/, `${locale} chip title must not fall back to Chinese`);
            assert.doesNotMatch(waiting, /排队中|排隊中/, `${locale} waiting badge must not fall back to Chinese`);
            assert.doesNotMatch(dispatching, /正在自动发送|正在自動發送/, `${locale} dispatching badge must not fall back to Chinese`);
        }
    }
    assert.equal(formatFollowUpQueueStatusBadge('xx-UNKNOWN', false), formatFollowUpQueueStatusBadge('en', false));
    assert.equal(formatPastedTextChipSummary(sampleRef, 'xx-UNKNOWN').title, formatPastedTextChipSummary(sampleRef, 'en').title);

    const widgetSource = readFileSync(widgetPath, 'utf8');
    const styleSource = readFileSync(stylePath, 'utf8');
    assert.match(widgetSource, /shouldEnqueueComposerSubmissionWhileBusy/);
    assert.match(widgetSource, /formatFollowUpQueueStatusBadge/);
    assert.match(widgetSource, /nmx-follow-up-status-badge/);
    assert.match(widgetSource, /PastedTextMessageChip/);
    assert.match(styleSource, /\.nmx-shell \.nmx-message-pasted-chip/);
    assert.match(styleSource, /\.nmx-shell \.nmx-follow-up-status-badge/);
});
