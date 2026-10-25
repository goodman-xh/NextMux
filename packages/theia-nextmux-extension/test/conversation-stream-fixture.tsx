import * as React from 'react';
import { createRoot } from 'react-dom/client';
import MarkdownIt from 'markdown-it';
import { ConversationStream, FadePresence, StreamNotice, StreamStatusRow } from '../src/browser/nextmux-conversation-stream';
import { conversationErrorText, projectConversationStream } from '../src/browser/nextmux-conversation-stream-model';
import { conversationStreamText } from '../src/browser/nextmux-conversation-stream-locale';
import { conversationText } from '../src/browser/nextmux-conversation-locale';
import type { NextMuxDesktopLocale } from '../src/browser/nextmux-locale';

/* Real production stream components with a markdown-it renderer standing in
 * for Theia's Markdown host (which fills its container the same way). */
const markdown = new MarkdownIt({ html: false, linkify: true });
const Markdown = React.memo(function Markdown(props: { text: string }) {
    const ref = React.useRef<HTMLDivElement>(null);
    React.useLayoutEffect(() => {
        (window as unknown as { __markdownRenders: number }).__markdownRenders += 1;
        if (ref.current) ref.current.innerHTML = markdown.render(props.text);
    }, [props.text]);
    return <div className='nmx-assistant-markdown' ref={ref} />;
});
(window as unknown as { __markdownRenders: number }).__markdownRenders = 0;

const params = new URLSearchParams(location.search);
const locale = (params.get('locale') || 'en') as NextMuxDesktopLocale;
const theme = params.get('theme') || 'dark';
const at = (second: number): string => `2026-09-24T00:00:${String(second).padStart(2, '0')}.000Z`;
const zh = locale === 'zh-CN';

const patch = ['--- a/src/session.ts', '+++ b/src/session.ts', '@@ -12,7 +12,9 @@ export function resume(run) {',
    '   const checkpoint = run.checkpoint;', '-  if (!checkpoint) return;', '+  if (!checkpoint) {', '+    return undefined;', '+  }',
    '   return replay(checkpoint);'].join('\n');

const baseEvents = [
    { type: 'backend_selected', backendId: 'native', attempt: 1, at: at(0) },
    { type: 'model_started', turn: 1, at: at(0) },
    { type: 'provider_reasoning', turn: 1, itemId: 'r1', visibility: 'visible', status: 'complete', at: at(1),
        content: zh ? '**检查恢复流程**\n\n先读取会话文件，再确认检查点是否完整。' : '**Checking the resume path**\n\nRead the session file first, then confirm the checkpoint is intact.' },
    { type: 'assistant_delta', turn: 1, delta: zh ? '我先看一下恢复逻辑。' : 'Let me look at the resume logic first.', at: at(2) },
    { type: 'model_completed', turn: 1, toolCallCount: 3, at: at(2) },
    { type: 'tool_completed', callId: 'read', toolName: 'workspace.read_file', ok: true, status: 'succeeded', durationMs: 4, at: at(3),
        summary: { title: '读取 src/session.ts', resource: { kind: 'file', path: '/repo/src/session.ts', action: 'read', startLine: 1, endLine: 80 } } },
    { type: 'tool_completed', callId: 'edit', toolName: 'workspace.apply_patch', ok: true, status: 'succeeded', durationMs: 9, at: at(4),
        summary: { title: '修改 src/session.ts', checkpointId: 'cp-edit-1', resource: { kind: 'file', path: '/repo/src/session.ts', action: 'updated' } } },
    { type: 'tool_started', callId: 'cmd', toolName: 'process.run', source: 'builtin', at: at(5), summary: { title: '运行 npm test', commandLine: 'npm test -- --grep resume' } },
    { type: 'tool_output', callId: 'cmd', toolName: 'process.run', source: 'builtin', stream: 'stdout', chunk: '✔ resume replays checkpoint\n✔ resume skips empty run\n', sequence: 1, at: at(6) },
    { type: 'tool_completed', callId: 'cmd', toolName: 'process.run', ok: true, status: 'succeeded', durationMs: 900, at: at(7),
        summary: { title: '运行 npm test', commandLine: 'npm test -- --grep resume', details: ['2 passing'] } },
    { type: 'tool_completed', callId: 'open', toolName: 'browser.open', ok: true, status: 'succeeded', durationMs: 50, at: at(8),
        summary: { title: '浏览器操作', resource: { kind: 'browser', url: 'https://www.example.com/login', title: 'Example Login' } } },
    { type: 'tool_completed', callId: 'click', toolName: 'browser.click', ok: true, status: 'succeeded', durationMs: 40, at: at(9),
        summary: { title: '浏览器操作', target: zh ? '登录' : 'Sign in', resource: { kind: 'browser', url: 'https://www.example.com/login' } } },
    { type: 'tool_completed', callId: 'fill', toolName: 'mcp.playwright.browser_type', ok: true, status: 'succeeded', durationMs: 40, at: at(10),
        summary: { title: 'MCP：playwright / browser_type', target: 'Email', details: ['返回 1 个内容块'] } },
    { type: 'tool_completed', callId: 'agent', toolName: 'agent.delegate', ok: true, status: 'succeeded', durationMs: 4000, at: at(11),
        summary: { title: zh ? '检查分支回滚' : 'Review branch rollback', details: [zh ? '回滚覆盖完整。' : 'Rollback coverage is complete.'] } },
    { type: 'user_input_requested', at: at(12), question: { kind: 'permission', questionId: 'q1', runId: 'r', taskId: 't', prompt: 'Run outside the workspace?',
        options: [], allowFreeText: false, createdAt: at(12), expiresAt: at(59), approval: { toolName: 'process.run', scope: 'unsandboxed_command', target: 'git push origin main' } } },
    { type: 'user_input_resolved', questionId: 'q1', runId: 'r', taskId: 't', status: 'answered', answer: { optionId: 'allow', optionLabel: zh ? '允许' : 'Allow' }, at: at(13) },
    { type: 'context_compaction_started', turn: 2, segment: 1, at: at(14) },
    { type: 'context_compaction_completed', turn: 2, segment: 1, messagesBefore: 64, messagesAfter: 20, at: at(15) },
    { type: 'backend_selected', backendId: 'native', attempt: 1, at: at(16) },
    { type: 'model_started', turn: 1, at: at(16) },
    { type: 'assistant_delta', turn: 1, delta: zh ? '检查点现在可以安全恢复。' : 'The checkpoint now resumes safely.', at: at(17) },
    { type: 'model_completed', turn: 1, toolCallCount: 1, at: at(17) }
] as const;

const changes = [{ checkpointId: 'cp-edit-1', path: 'src/session.ts', additions: 3, deletions: 1, patch, binary: false, truncated: false }];

/** Like the widget, the terminal reads the current app theme when it renders. */
const themeRef = { current: theme };
function Terminal(props: { command: string; output: string }): React.ReactElement {
    return <pre className='fixture-terminal' data-theme={themeRef.current}>{`$ ${props.command}\n${props.output.replace(/\u001b\[[0-9;]*m/g, '')}`}</pre>;
}

function Turn(props: { live: boolean; compacting: boolean; streamText: string; dotVisible: boolean; showDialog: boolean; dialogKey: number; appTheme: string }): React.ReactElement {
    const events = props.compacting ? baseEvents.slice(0, 17) : baseEvents;
    const liveEvents = props.live ? [...events.slice(0, 18), { type: 'assistant_delta', turn: 3, delta: props.streamText, at: at(20) }] : events;
    const projection = projectConversationStream({ locale, events: liveEvents as never, running: props.live || props.compacting,
        ...(props.live || props.compacting ? {} : { terminalState: 'complete' as const }), changes });
    const renderMarkdown = React.useCallback((text: string) => <Markdown text={text} />, []);
    const renderTerminal = React.useCallback((command: string, output: string) => <Terminal command={command} output={output} />, []);
    const noop = React.useCallback(() => undefined, []);
    return <>
        <nav className='fixture-sidebar'><span>{zh ? '恢复检查点' : 'Resume checkpoint'}</span>
            <FadePresence present={props.dotVisible}><i className='nmx-session-terminal-dot' aria-label='unread'></i></FadePresence></nav>
        <section className='nmx-task-turn is-first is-last'>
            <div className='nmx-user-message'><div className='nmx-user-markdown'><p>{zh ? '修复恢复逻辑' : 'Fix resume'}</p></div>
                <span className='nmx-user-message-actions'>
                    <button data-message-action='copy' aria-label={conversationText(locale, 'copyMessage')}><i className='codicon codicon-copy'></i></button>
                    <button data-message-action='edit' aria-label={conversationText(locale, 'editMessage')}><i className='codicon codicon-edit'></i></button>
                </span></div>
            <div className='nmx-agent-message is-complete'><div>
                <ConversationStream locale={locale} projection={projection} idPrefix='fixture' label='activity' planLabel='plan' theme={props.appTheme}
                    renderMarkdown={renderMarkdown} renderTerminal={renderTerminal} renderSteering={() => null} onOpen={noop} onRestore={noop} />
                {!props.live && !props.compacting && <>
                    <div className='nmx-gateway-content'><div className='nmx-assistant-markdown'><p>{zh ? '已修复：恢复前会先确认检查点存在，测试全部通过。' : 'Fixed: resume now confirms the checkpoint exists first, and all tests pass.'}</p></div></div>
                    <StreamStatusRow locale={locale} item={{ kind: 'row', key: 'paused', activity: 'paused', icon: 'debug-pause', tone: 'stopped', title: conversationStreamText(locale, 'paused') }} />
                    <StreamNotice tone='error' text={conversationErrorText(locale, { code: 'UPSTREAM_TIMEOUT_XYZ', message: 'Error: {"error":{"code":"ETIMEDOUT"}} at fetch (node:internal)' })} />
                </>}
            </div></div>
        </section>
        <div className='nmx-composer-alert-stack fixture-balance'>
            <div className='nmx-attachment-error is-balance' role='alert'>
                <span>{zh ? '余额不足，请充值后继续' : 'Insufficient balance. Add funds to continue.'}</span>
                <button className='nmx-balance-recharge'>{zh ? '立即充值' : 'Add funds'}</button>
                <button type='button' className='nmx-balance-dismiss' aria-label={conversationStreamText(locale, 'dismiss')}><i className='codicon codicon-close'></i></button>
            </div>
        </div>
        {props.showDialog && <div key={props.dialogKey} className='nmx-sheet-backdrop nmx-dialog-backdrop nmx-branch-backdrop'>
            <section className='nmx-thread-dialog nmx-turn-edit-dialog nmx-branch-dialog' role='alertdialog' aria-modal='true' aria-labelledby='t'>
                <header><h2 id='t'>{conversationText(locale, 'branchTitle')}</h2></header>
                <p>{conversationText(locale, 'branchPrompt')}</p>
                <label className='nmx-branch-restore nmx-turn-edit-restore'><input type='checkbox' /><span>{conversationText(locale, 'restoreWorkspaceOption')}</span></label>
                <footer>
                    <button className='theia-button secondary nmx-branch-create'>{conversationText(locale, 'createBranch')}</button>
                    <button className='theia-button secondary'>{conversationText(locale, 'cancel')}</button>
                    <button className='theia-button main is-primary nmx-branch-replace' title={conversationText(locale, 'replaceWarning')}>{conversationText(locale, 'dontCreate')}</button>
                </footer>
            </section>
        </div>}
    </>;
}

function App(): React.ReactElement {
    const [state, setState] = React.useState({ live: false, compacting: false, streamText: '', dotVisible: true, showDialog: false, dialogKey: 0, appTheme: theme });
    themeRef.current = state.appTheme;
    (window as unknown as { fixture: unknown }).fixture = {
        set: (patchState: Partial<typeof state>) => setState(value => ({ ...value, ...patchState })),
        openDialog: () => setState(value => ({ ...value, showDialog: true, dialogKey: value.dialogKey + 1 }))
    };
    return <div className='nmx-desktop-widget'>
        <div className={`nmx-shell nmx-theme-${state.appTheme}`} dir={locale === 'ar' ? 'rtl' : 'ltr'} lang={locale}>
            <main className='nmx-workspace fixture-workspace'><div className='nmx-task-view fixture-transcript'><Turn {...state} /></div></main>
        </div>
    </div>;
}

createRoot(document.getElementById('fixture')!).render(<App />);
