import assert from 'node:assert/strict';
import test from 'node:test';
import {
  composerMarkdownSegments,
  normalizeConversationMarkdown,
  removeAdjacentComposerLink,
  siteIconUrlFor,
  siteNameForUrl,
  shouldDisplayRawUrl,
} from '../lib/browser/nextmux-markdown.js';
import { renderConversationMarkdownHtml, renderConversationMarkdownUnsanitized } from '../lib/browser/nextmux-conversation-markdown.js';

test('normalizes escaped ampersands in copied HTTP markdown links without changing labels', () => {
  const input = '[Opus 5 ](https://www.google.com/search?q=Opus\\&q2=Fable)[**vs Fable**](https://example.com?a=1\\&b=2)';
  assert.equal(normalizeConversationMarkdown(input), '[Opus 5 ](https://www.google.com/search?q=Opus&q2=Fable)[**vs Fable**](https://example.com?a=1&b=2)');
});

test('does not rewrite non-link text or non-http destinations', () => {
  const input = '`https://example.com?a=1\\&b=2` [local](file:///tmp/a\\&b)';
  assert.equal(normalizeConversationMarkdown(input), input);
});

test('site names and public favicon URLs do not include destination paths or query strings', () => {
  assert.equal(siteNameForUrl('https://www.baidu.com/s?wd=nextmux'), '百度');
  assert.equal(siteNameForUrl('https://docs.example.test/path'), 'docs.example.test');
  assert.equal(siteIconUrlFor('https://www.baidu.com/s?wd=nextmux'), 'https://www.baidu.com/favicon.ico');
  for (const url of ['https://127.0.0.1:8787/health', 'http://localhost/a', 'http://[::1]/', 'http://192.168.3.5/a', 'https://user:pass@example.com'])
    assert.equal(siteIconUrlFor(url), undefined);
  assert.equal(shouldDisplayRawUrl('http://127.0.0.1:8787/health'), true);
  assert.equal(shouldDisplayRawUrl('https://www.baidu.com/s?wd=nextmux'), false);
});

test('leave all Markdown parsing to the existing renderer', () => {
  const input = '~~~\nhttps://github.com/Tencent/AI-Infra-Guard\n~~~\n<https://openai.com> [source](https://example.test/a_(b)).';
  assert.equal(normalizeConversationMarkdown(input), input);
});

test('composer displays pasted HTTP links as one blue label while retaining Markdown source', () => {
  const value = '[AI-Infra-Guard](https://github.com/Tencent/AI-Infra-Guard)';
  assert.deepEqual(composerMarkdownSegments(value), [{ kind: 'link', label: 'AI-Infra-Guard', href: 'https://github.com/Tencent/AI-Infra-Guard', source: value }]);
});

test('one Backspace/Delete adjacent to a composer link removes the complete source link', () => {
  const value = '前 [标题](https://example.com) 后';
  const start = value.indexOf(' 后');
  assert.deepEqual(removeAdjacentComposerLink(value, start, start, 'backward'), { value: '前  后', caret: 2 });
  const linkStart = value.indexOf('[');
  assert.deepEqual(removeAdjacentComposerLink(value, linkStart, linkStart, 'forward'), { value: '前  后', caret: linkStart });
});

test('one deletion inside a visually collapsed link removes its complete source token', () => {
  const value = '前 [标题](https://example.com) 后';
  const linkStart = value.indexOf('[');
  assert.deepEqual(removeAdjacentComposerLink(value, linkStart + 7, linkStart + 7, 'backward'), { value: '前  后', caret: linkStart });
  assert.deepEqual(removeAdjacentComposerLink(value, linkStart + 2, linkStart + 8, 'forward'), { value: '前  后', caret: linkStart });
});

test('renders CJK-friendly strong emphasis, safe inline tags, collapsible <think>, and currency vs inline math', () => {
  const cjkHtml = renderConversationMarkdownUnsanitized('**注意：**请检查配置，**方案一（推荐）**提升**100%**性能，中文**（括号）**正常。', 'zh-CN');
  assert.match(cjkHtml, /<strong>注意：<\/strong>请检查配置/);
  assert.match(cjkHtml, /<strong>方案一（推荐）<\/strong>提升<strong>100%<\/strong>性能/);
  assert.match(cjkHtml, /中文<strong>（括号）<\/strong>正常/);

  const kbdHtml = renderConversationMarkdownUnsanitized('Press <kbd>Ctrl</kbd> + <kbd>C</kbd>, H<sub>2</sub>O, <script>alert(1)</script>, Promise<void>', 'en');
  assert.match(kbdHtml, /<kbd>Ctrl<\/kbd>/);
  assert.match(kbdHtml, /H<sub>2<\/sub>O/);
  assert.match(kbdHtml, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(kbdHtml, /Promise&lt;void&gt;/);

  const mathHtml = renderConversationMarkdownUnsanitized('价格是$100，公式为$\\hat{x} + \\text{if } y = 1$；跨词货币 $100/$month 与 ($10/mo) vs ($free) 保持纯文本。', 'zh-CN');
  assert.doesNotMatch(mathHtml, /nmx-md-math-inline">100/);
  assert.match(mathHtml, /<i>x̂<\/i>/);
  assert.match(mathHtml, /if <i>y<\/i>/);

  const thinkHtml = renderConversationMarkdownUnsanitized('<think>\n先分析上下文\n</think>\n\n最终回复正文', 'zh-CN');
  assert.match(thinkHtml, /<details class="nmx-md-think">/);
  assert.match(thinkHtml, /已思考/);
  assert.match(thinkHtml, /最终回复正文/);
});

test('without a working sanitizer a reply renders as escaped plain text, never as unsanitized markup', () => {
  // Node has no DOM, so DOMPurify cannot run here: the renderer must fail closed.
  const html = renderConversationMarkdownHtml('**Bold** <img src=x onerror=alert(1)>\n<a href="javascript:alert(2)">x</a>\n\nSecond <kbd>K</kbd>', 'en');
  assert.equal(html, '<p>**Bold** &lt;img src=x onerror=alert(1)&gt;<br>&lt;a href=&quot;javascript:alert(2)&quot;&gt;x&lt;/a&gt;</p><p>Second &lt;kbd&gt;K&lt;/kbd&gt;</p>');
  assert.doesNotMatch(html, /<(?!\/?(?:p|br)>)/);
  assert.equal(renderConversationMarkdownHtml('', 'en'), '');
});
