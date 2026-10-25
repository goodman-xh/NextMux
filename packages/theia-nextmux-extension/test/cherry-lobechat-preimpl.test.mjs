import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    buildArtifactBrowserPreviewHtml,
    buildMermaidRepairPrompt,
    detectPreviewableArtifact,
    exportConversationToHtml,
    exportConversationToMarkdown,
    formatLiveEndpointPreview
} from '../lib/common/nextmux-cherry-lobechat-helpers.js';
import { compactedConversationHistory, completedConversationHistory, normalizeTurnAttachmentDocuments } from '../lib/browser/nextmux-conversation-branch.js';
import { renderConversationMarkdownUnsanitized } from '../lib/browser/nextmux-conversation-markdown.js';
import { documentFitsInline, estimateTextTokens, largeDocumentDescriptor, largeDocumentOutline, LARGE_DOCUMENT_INLINE_TOKENS } from '../lib/common/nextmux-large-document.js';
import { followUpSuggestion } from '../lib/common/nextmux-follow-up-suggestion.js';
import { composerTelemetryLocales, composerTelemetryText, conversationTelemetry, followUpPlaceholder } from '../lib/browser/nextmux-composer-telemetry.js';
import { conversationExportLabels, conversationExportLocales, conversationExportText } from '../lib/browser/nextmux-conversation-export-locale.js';
import { BUSY_RETRY_DELAYS_MS, autoResumeDelayMs, isBusyFailure } from '../lib/browser/nextmux-agent-activity.js';

const here = dirname(fileURLToPath(import.meta.url));
const widgetSource = readFileSync(join(here, '../src/browser/nextmux-desktop-widget.tsx'), 'utf8');

// What the pre-implemented Cherry Studio / LobeChat items do once wired into the app. Earlier versions of this file
// tested helpers that nothing in the app called (stream batching, a fake Ollama pull, Chinese-only notes); those were
// removed with the helpers.

test('Cherry Studio #6: the jump-to-latest button keeps its unseen dot and speaks the interface language', () => {
    const button = /<button className={`nmx-thread-to-bottom[^\n]*/.exec(widgetSource)?.[0] || '';
    assert.match(button, /localizeDesktopSurface\(this\.desktopLocale, this\.threadUnseenUpdates \? '有新消息，回到底部' : '回到底部'\)/);
    assert.match(button, /<span aria-hidden='true'><\/span>/, 'the dot stays empty: text inside an 8px dot overflowed it');
});

test('Cherry Studio #7: a page, SVG or Mermaid diagram becomes a browser-drawer preview; the code block keeps a preview button', () => {
    const htmlArtifact = detectPreviewableArtifact('Here is code:\n```html\n<!DOCTYPE html><html><body>Hello</body></html>\n```');
    assert.equal(htmlArtifact?.kind, 'html');
    assert.equal(htmlArtifact?.standalone, true);
    assert.match(buildArtifactBrowserPreviewHtml(htmlArtifact, { theme: 'dark', channel: 'c1', renderFailed: 'failed' }), /<!DOCTYPE html>/i);
    assert.equal(detectPreviewableArtifact('```html\n<div>unfinished'), null, 'an unclosed fence is not previewed');

    const mermaidArtifact = detectPreviewableArtifact('```mermaid\ngraph TD\nA-->B\n```');
    assert.equal(mermaidArtifact?.kind, 'mermaid');
    const page = buildArtifactBrowserPreviewHtml(mermaidArtifact, { theme: 'light', channel: 'c2', mermaidRuntime: 'AAAA', renderFailed: 'Could not draw' });
    assert.match(page, /securityLevel: 'strict'/);
    assert.match(buildMermaidRepairPrompt('graph TD\nA-->B(test)', 'Parse error', 'Fix this diagram', 'Error'), /Fix this diagram[\s\S]*Error: Parse error[\s\S]*```mermaid/);

    const rendered = renderConversationMarkdownUnsanitized('```mermaid\ngraph TD\nA-->B\n```', 'zh-CN');
    assert.match(rendered, /data-nmx-preview-code="true"/);
    assert.match(rendered, /在浏览器预览/);
    assert.match(renderConversationMarkdownUnsanitized('```mermaid\ngraph TD\nA-->B\n```', 'en'), /Preview in browser/);
});

test('Cherry Studio #8 & #9: pinned and left-out turns shape the context; exports speak the interface language', () => {
    const turns = [
        { id: 't1', prompt: 'Pinned question', response: 'Pinned answer', stage: 'complete', pinned: true },
        { id: 't2', prompt: 'Excluded question', response: 'Excluded answer', stage: 'complete', excludedFromContext: true },
        { id: 't3', prompt: 'Recent question', response: 'Recent answer', stage: 'complete' }
    ];
    const compacted = compactedConversationHistory(turns, 1);
    const allText = compacted.map(m => m.content).join('\n');
    assert.match(allText, /Pinned question/);
    assert.doesNotMatch(allText, /Excluded question/);

    const zh = conversationExportLabels('zh-CN');
    const md = exportConversationToMarkdown('测试对话', turns, zh);
    assert.match(md, /# 测试对话/);
    assert.match(md, /## 第 1 轮 \(📌 重点保留\)/);
    assert.match(md, /🚫 已从上下文排除/);
    const en = exportConversationToMarkdown('Test', turns, conversationExportLabels('en'));
    assert.match(en, /## Turn 1 \(📌 Always kept in context\)/);
    assert.match(en, /### You\n\nPinned question/);
    const html = exportConversationToHtml('<b>测试</b>', turns, conversationExportLabels('ar'));
    assert.match(html, /<html lang="ar" dir="rtl">/);
    assert.match(html, /&lt;b&gt;测试&lt;\/b&gt;/, 'the title is escaped');
    for (const locale of conversationExportLocales) {
        for (const key of ['pin', 'unpin', 'exclude', 'include', 'exportMarkdown', 'exportHtml', 'exportTitle', 'exported', 'exportFailed']) {
            assert.ok(conversationExportText(locale, key), `${locale}.${key}`);
        }
    }
    // The menu shows each entry once, and export saves a file instead of copying to the clipboard.
    assert.equal(widgetSource.match(/renderTurnContextAndExportMenuItems\(/g).length, 2, 'one definition and one call');
    assert.match(widgetSource, /protected async exportCodingSessionConversation[\s\S]{0,1600}showSaveDialog[\s\S]{0,600}fileService\.writeFile/);
});

test('Cherry Studio #10: the preview shows the URL chat requests really go to, # pinned or not, per provider', () => {
    const normal = formatLiveEndpointPreview('https://api.example.com', { protocol: 'openai' });
    assert.deepEqual(normal, { resolvedUrl: 'https://api.example.com/v1/chat/completions', rawLocked: false });
    // A # keeps the root as typed, and the transports still add the operation path.
    const locked = formatLiveEndpointPreview('https://api.example.com/custom/path#', { protocol: 'openai' });
    assert.deepEqual(locked, { resolvedUrl: 'https://api.example.com/custom/path/chat/completions', rawLocked: true });
    // A built-in provider keeps its own path: no /v1 is invented for it.
    assert.equal(formatLiveEndpointPreview('https://api.deepseek.com', { protocol: 'openai_chat_completions', providerId: 'deepseek' }).resolvedUrl,
        'https://api.deepseek.com/chat/completions');
    assert.equal(formatLiveEndpointPreview('https://api.anthropic.com/v1', { protocol: 'anthropic_messages', providerId: 'anthropic' }).resolvedUrl,
        'https://api.anthropic.com/v1/messages');
    assert.equal(formatLiveEndpointPreview('https://generativelanguage.googleapis.com', { protocol: 'gemini', model: 'gemini-2.5-pro' }).resolvedUrl,
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent');
    assert.deepEqual(formatLiveEndpointPreview('   '), { resolvedUrl: '', rawLocked: false });
});

test('Cherry Studio #12: a long document is described with its outline instead of being sent whole', () => {
    assert.equal(estimateTextTokens('abcd'.repeat(10)), 10);
    assert.equal(estimateTextTokens('中文测试'), 4);
    assert.equal(documentFitsInline('x'.repeat(4 * LARGE_DOCUMENT_INLINE_TOKENS)), true);
    assert.equal(documentFitsInline('x'.repeat(4 * LARGE_DOCUMENT_INLINE_TOKENS + 8)), false);
    assert.equal(documentFitsInline('字'.repeat(6_000), 32_000), false, 'a small window reads long documents in parts sooner');
    assert.equal(documentFitsInline('字'.repeat(1_500), 8_000), true, 'short documents always go whole');

    const withHeadings = `# 第一章 总则\n${'内容A\n'.repeat(1200)}## 第二章 细则\n${'内容B\n'.repeat(1200)}\`\`\`python\n# not a heading\n\`\`\`\n# 附录`;
    const outline = largeDocumentOutline(withHeadings);
    assert.deepEqual(outline.sections.map(section => [section.title, section.startLine, section.endLine]),
        [['第一章 总则', 1, 1201], ['第二章 细则', 1202, 2405], ['附录', 2406, 2406]], 'code comments are not headings');
    const described = largeDocumentDescriptor({ name: 'spec.pdf', path: '/tmp/docs/spec-abc.md', content: withHeadings, size: '2 MB', details: 'PDF, 42 pages' });
    assert.match(described, /^\[Attachment "spec\.pdf" \(2 MB; PDF, 42 pages\)\. Its text \(2,406 lines/);
    assert.match(described, /\n\/tmp\/docs\/spec-abc\.md\n/);
    assert.match(described, /workspace\.read_file .*workspace\.search_text/s);
    assert.match(described, /- 1–1201 第一章 总则\n- 1202–2405 第二章 细则/);

    const pdf = Array.from({ length: 120 }, (_, index) => `[Page ${index + 1}]\nText of page ${index + 1}`).join('\n\n');
    const pages = largeDocumentDescriptor({ name: 'scan.pdf', path: '/tmp/p.md', content: pdf });
    assert.match(pages, /each starts with a "\[Page N\]" line/);
    assert.match(pages, /p\.1 → line 1, p\.4 → line 10/);
    assert.ok((pages.match(/p\.\d+ →/g) || []).length <= 40, 'a long page list is sampled');

    const plain = Array.from({ length: 400 }, (_, i) => `Plain paragraph line ${i + 1} with \`\`\`\` fences inside`).join('\n');
    const preview = largeDocumentDescriptor({ name: 'raw.txt', path: '/tmp/raw.md', content: plain });
    assert.match(preview, /no headings or pages to list\. Its first 30 lines:\n`````text\n/);
    assert.match(preview, /Plain paragraph line 30 with/);
    assert.doesNotMatch(preview, /Plain paragraph line 31 with/);

    // Later turns are told where the saved text is, and restored records are checked.
    const documents = normalizeTurnAttachmentDocuments([{ attachmentId: 'a1', name: 'spec.pdf', path: '/tmp/docs/spec-abc.md', lines: 2406, characters: 9000 }, { name: 'bad' }]);
    assert.deepEqual(documents, [{ attachmentId: 'a1', name: 'spec.pdf', path: '/tmp/docs/spec-abc.md', lines: 2406, characters: 9000 }]);
    assert.equal(normalizeTurnAttachmentDocuments('nope'), undefined);
    const history = completedConversationHistory([{ id: 't1', prompt: 'Summarize the spec', response: 'Done', stage: 'complete', attachmentDocuments: documents }]);
    assert.match(history[0].content, /^Summarize the spec\n\n\[Attached to this message and saved for reading in parts: "spec\.pdf" at \/tmp\/docs\/spec-abc\.md \(2,406 lines\)/);
    const longTurns = Array.from({ length: 14 }, (_, index) => ({ id: `t${index}`, prompt: `Q${index}`, response: `A${index}`, stage: 'complete', ...(index === 0 ? { attachmentDocuments: documents } : {}) }));
    assert.match(compactedConversationHistory(longTurns)[0].content, /#1 user: Q0 \| document "spec\.pdf" saved at \/tmp\/docs\/spec-abc\.md \(2406 lines\)/,
        'the memory of an older turn keeps the path whole');
    assert.match(widgetSource, /protected async saveAttachmentForReadingInParts/);
});

test('LobeChat #7: a busy provider is retried after 30, 60, 60 and 120 seconds, then left to the user', () => {
    assert.deepEqual([...BUSY_RETRY_DELAYS_MS], [30_000, 60_000, 60_000, 120_000]);
    assert.equal(isBusyFailure('UPSTREAM_RATE_LIMITED'), true);
    assert.equal(isBusyFailure('', 529), true);
    assert.equal(isBusyFailure('MODEL_CALL_FAILED', 500), false);
    assert.deepEqual([1, 2, 3, 4].map(attempt => autoResumeDelayMs(attempt, undefined, 'RATE_LIMITED', 429)), [30_000, 60_000, 60_000, 120_000]);
});

test('LobeChat #10: the line under the message box uses reported usage, never a character estimate', () => {
    const turns = [
        { stage: 'complete', usageLabel: '1200 输入 · 300 输出', events: [] },
        { stage: 'complete', usageLabel: '2000 输入 · 500 输出', events: [
            { type: 'model_attempt_completed', outcome: 'succeeded', durationMs: 4_000 },
            { type: 'model_attempt_completed', outcome: 'failed', durationMs: 9_000 },
            { type: 'model_attempt_completed', outcome: 'succeeded', durationMs: 1_000 }
        ] },
        { stage: 'error', usageLabel: '' }
    ];
    assert.deepEqual(conversationTelemetry(turns), { totalTokens: 4_000, tokensPerSecond: 100 });
    assert.deepEqual(conversationTelemetry([
        {
            stage: 'complete',
            usageLabel: '1000 输入 · 240 输出',
            events: [{ type: 'model_attempt_completed', outcome: 'succeeded', durationMs: 2_000 }]
        },
        {
            stage: 'complete',
            usageLabel: '1500 输入 · 340 输出',
            events: [
                { type: 'model_attempt_completed', outcome: 'succeeded', durationMs: 2_000, outputTokens: 40 },
                { type: 'model_attempt_completed', outcome: 'succeeded', durationMs: 2_000, generationDurationMs: 1_500, outputTokens: 300 }
            ]
        }
    ]), { totalTokens: 3_080, tokensPerSecond: 200 }, 'reports the peak tok/s across turns and individual generation attempts');
    assert.equal(conversationTelemetry([{ stage: 'complete', prompt: 'x'.repeat(9_000) }]), undefined, 'nothing to show without reported usage');
    assert.deepEqual(conversationTelemetry([{ usageLabel: '10 输入 · 8 输出', events: [{ type: 'model_attempt_completed', outcome: 'succeeded', durationMs: 50 }] }]),
        { totalTokens: 18 }, 'a reply too short to time shows no speed');
    assert.equal(composerTelemetryText('zh-CN', 'total', 12_345), '本对话 12,345 Token');
    assert.equal(composerTelemetryText('en', 'speed', 42.25), '42.3 tok/s');
    assert.equal(composerTelemetryText('de', 'total', 12_345), 'Diese Unterhaltung: 12.345 Token');
    for (const locale of composerTelemetryLocales) for (const key of ['speed', 'total', 'title']) assert.ok(composerTelemetryText(locale, key), `${locale}.${key}`);
    assert.doesNotMatch(widgetSource, /nmx-composer-telemetry[^\n]*style=\{\{/, 'styled by CSS, not inline');
});

test('LobeChat #16: the follow-up the last reply offered becomes the user\'s own next request', () => {
    assert.equal(followUpSuggestion('已完成修改。\n\n需要我帮你补充单元测试吗？'), '请帮我补充单元测试');
    assert.equal(followUpSuggestion('改好了。要不要我继续优化你的查询性能？'), '请继续优化我的查询性能');
    assert.equal(followUpSuggestion('如果需要，我可以帮你把它改成异步版本。'), '请帮我把它改成异步版本');
    assert.equal(followUpSuggestion('我可以为你生成接口文档，需要吗？'), '请帮我生成接口文档');
    assert.equal(followUpSuggestion('Done.\n\nWould you like me to add tests for your parser?'), 'Please add tests for my parser');
    assert.equal(followUpSuggestion('Shall I update the README as well?'), 'Please update the README as well');
    assert.equal(followUpSuggestion('Let me know if you want me to open a pull request.'), 'Please open a pull request');
    // Nothing is suggested when the reply asks the user something, offers nothing specific, or ends in code.
    assert.equal(followUpSuggestion('你希望用哪种数据库？'), '');
    assert.equal(followUpSuggestion('还有什么需要我帮忙的吗？'), '');
    assert.equal(followUpSuggestion('需要我帮你做别的吗？'), '');
    assert.equal(followUpSuggestion('Is there anything else I can help with?'), '');
    assert.equal(followUpSuggestion('Can I help with anything else?'), '');
    assert.equal(followUpSuggestion('Here it is:\n```js\n// Would you like me to add tests?\n```'), '');
    assert.equal(followUpSuggestion(`需要我帮你${'把所有的模块都重新整理一遍并且补充完整的文档'.repeat(2)}吗？`), '', 'too long to be a short follow-up');
    assert.equal(followUpPlaceholder('zh-CN', '请帮我补充单元测试'), '请帮我补充单元测试   ⇥ 按 Tab 使用');
    assert.match(widgetSource, /followUpPlaceholder\(this\.desktopLocale, followUp\)/);
});

test('LobeChat #17: a liked or disliked reply tells the next request how to adjust', () => {
    const history = completedConversationHistory([
        { id: 't1', prompt: 'Explain X', response: 'X is Y', stage: 'complete', relayFeedback: 'down' }
    ]);
    assert.match(history[0].content, /User disliked the assistant reply/);
    assert.match(completedConversationHistory([{ id: 't1', prompt: 'Explain X', response: 'X is Y', stage: 'complete', relayFeedback: 'up' }])[0].content,
        /User liked the assistant reply/);
});
