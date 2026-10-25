import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { ConversationStream } from '../src/browser/nextmux-conversation-stream';
import { ConversationMarkdown } from '../src/browser/nextmux-conversation-markdown';
import { conversationCodeTokenizer } from '../src/browser/nextmux-editor-languages';
import { projectConversationStream } from '../src/browser/nextmux-conversation-stream-model';
import { decorateConversationLinks } from '../src/browser/nextmux-markdown';
import type { NextMuxDesktopLocale } from '../src/browser/nextmux-locale';

/* Production stream + production reply Markdown (real markdown-it, DOMPurify
 * and the editor's Monarch grammars through Monaco's tokenizer). */
const params = new URLSearchParams(location.search);
const locale = (params.get('locale') || 'en') as NextMuxDesktopLocale;
const theme = params.get('theme') || 'dark';
const at = (second: number): string => `2026-09-24T00:00:${String(second).padStart(2, '0')}.000Z`;

const samples: Record<string, string> = {
    en: `# Release checklist

The resume path now confirms the checkpoint before replaying. Use \`$(pwd)\` or \`Promise<void>\` freely — and in prose too: Promise<void> and $(pwd) stay literal. See [the docs](https://github.com/openai/codex) or https://www.npmjs.com/package/react.

## What changed

1. **Checkpoint guard** — \`resume()\` returns early when nothing was saved.
2. Retry budget is shared across engines:
   - native runs keep their journal
   - delegated runs inherit the parent's permission
3. Billing is recorded once per request.

### Tasks

- [x] Replay the saved checkpoint
- [ ] Ship the migration

> Streaming never replays a settled block; only the live tail re-renders.

\`\`\`ts
export async function resume(run: Run): Promise<Result | undefined> {
    const checkpoint = run.checkpoint; // saved on every tool call
    if (!checkpoint) return undefined;
    return replay(checkpoint, { attempts: 3, label: "resume" });
}
\`\`\`

\`\`\`bash
npm test -- --grep resume && echo "ok"
\`\`\`

\`\`\`diff
-  if (!checkpoint) return;
+  if (!checkpoint) {
+    return undefined;
+  }
\`\`\`

| Engine | Latency | Success | Notes |
|:--|--:|--:|:--|
| native | 820 ms | 99.2% | default |
| delegated | 1,140 ms | 98.7% | inherits permission |
| acp | 1,480 ms | 97.9% | long-running tools with a considerably longer description column |

#### Notes

Press <kbd>Ctrl</kbd> text stays escaped: <script>alert(1)</script> and a:/b 8) :) remain plain. :rocket:

---

That's all.`,
    'zh-CN': `# 发布检查

恢复流程现在会先确认检查点，再回放。行内代码 \`$(pwd)\` 和正文里的 Promise<void> 都原样显示。参考 [Codex](https://github.com/openai/codex) 和 http://127.0.0.1:8080/health 。
中文软换行
不会插入多余空格，English 与中文混排也清晰。

## 变更

1. **检查点保护**——没有保存时 \`resume()\` 直接返回。
2. 重试预算在执行引擎之间共享：
   - 原生运行保留日志
   - 子智能体继承父任务权限

- [x] 回放已保存的检查点
- [ ] 发布迁移

> 流式输出不会重放已稳定的段落。

\`\`\`python
def resume(run):
    checkpoint = run.checkpoint  # 每次工具调用都会保存
    if checkpoint is None:
        return None
    return replay(checkpoint, attempts=3)
\`\`\`

| 引擎 | 延迟 | 成功率 |
|---|--:|--:|
| 原生 | 820 ms | 99.2% |
| 子智能体 | 1,140 ms | 98.7% |

---

完成。`,
    ar: `## قائمة الإصدار

يتحقق مسار الاستئناف الآن من نقطة الحفظ قبل إعادة التشغيل. استخدم \`resume()\` عند الحاجة.

1. **حماية نقطة الحفظ** — يعود مبكرًا عند عدم وجود حفظ.
2. تتم مشاركة ميزانية إعادة المحاولة.

> لا يعيد البث عرض الكتل المستقرة.

\`\`\`ts
const checkpoint = run.checkpoint;
\`\`\`

| المحرك | الزمن |
|---|--:|
| أصلي | 820 ms |

The English paragraph keeps its own direction.`
};
const sample = samples[locale] || samples.en;

const copied: string[] = [];
(window as unknown as { copied: string[] }).copied = copied;
const onCopy = (text: string): Promise<void> => { copied.push(text); return Promise.resolve(); };

/* Mirrors the widget: while running, the reply streams inside the activity
 * stream (`.nmx-stream-text`, split into cached blocks); once complete, the
 * same text is the turn response in `.nmx-gateway-content`. */
function App(): React.ReactElement {
    const [state, setState] = React.useState({ text: sample, live: false, single: false, tools: params.get('tools') === '1' });
    (window as unknown as { fixture: unknown }).fixture = { set: (patch: Partial<typeof state>) => setState(value => ({ ...value, ...patch })), sample };
    const events = [
        { type: 'backend_selected', backendId: 'native', attempt: 1, at: at(0) },
        { type: 'model_started', turn: 1, at: at(0) },
        ...(state.tools ? [
            { type: 'model_completed', turn: 1, toolCallCount: 1, at: at(1) },
            { type: 'tool_completed', callId: 'read', toolName: 'workspace.read_file', ok: true, status: 'succeeded', durationMs: 4, at: at(1),
                summary: { title: 'read', resource: { kind: 'file', path: '/repo/src/session.ts', action: 'read', startLine: 1, endLine: 80 } } },
            { type: 'model_started', turn: 2, at: at(1) }
        ] : []),
        { type: 'assistant_delta', turn: state.tools ? 2 : 1, delta: state.text, at: at(2) },
        ...(state.live ? [] : [{ type: 'model_completed', turn: state.tools ? 2 : 1, toolCallCount: 0, at: at(3) }])
    ];
    const projection = projectConversationStream({ locale, events: events as never, running: state.live,
        ...(state.live ? {} : { terminalState: 'complete' as const }) });
    const renderMarkdown = React.useCallback((text: string) => <ConversationMarkdown markdown={text} className='nmx-assistant-markdown'
        locale={locale} tokenizer={conversationCodeTokenizer} onRender={decorateConversationLinks} onCopyCode={onCopy} />, []);
    const noop = React.useCallback(() => undefined, []);
    const stage = state.live ? 'running' : 'complete';
    return <div className='nmx-desktop-widget'>
        <div className={`nmx-shell nmx-theme-${theme}`} dir={locale === 'ar' ? 'rtl' : 'ltr'} lang={locale}>
            <main className='nmx-workspace fixture-workspace'><div className='nmx-task-view fixture-transcript'>
                <section className='nmx-task-turn is-first is-last'>
                    <div className='nmx-user-message'>
                        <ConversationMarkdown markdown={'Why does `Vec<u8>` vanish? Promise<void> $(pwd)'} className='nmx-user-markdown' locale={locale} />
                    </div>
                    <div className={`nmx-agent-message is-${stage}`}><div>
                        {state.single
                            // Reference layout: the reply rendered in the stream as one Markdown document.
                            ? <section className='nmx-agent-activity nmx-stream is-live'>{state.tools && <div className='nmx-stream-row'><div className='nmx-stream-line'><div className='nmx-stream-trigger'>
                                <span className='nmx-stream-label'>Read</span></div></div></div>}<div className='nmx-agent-narration nmx-stream-text'>{renderMarkdown(state.text)}</div></section>
                            : projection.items.length ? <ConversationStream locale={locale} projection={projection} idPrefix='md' label='activity' planLabel='plan' theme={theme}
                                renderMarkdown={renderMarkdown} renderTerminal={() => null} renderSteering={() => null} onOpen={noop} onRestore={noop} /> : null}
                        {!state.live && !state.single && <div className='nmx-gateway-content' data-nmx-literal>{renderMarkdown(state.text)}</div>}
                    </div></div>
                </section>
            </div></main>
        </div>
    </div>;
}

createRoot(document.getElementById('fixture')!).render(<App />);
