import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { AgentQuestionController } from '../src/browser/nextmux-agent-question';
import { AgentQuestionPanel } from '../src/browser/nextmux-agent-question-panel';
import type { NextMuxDesktopLocale } from '../src/browser/nextmux-locale';
import { DictationTarget, focusSystemDictationDraft, shouldSubmitComposerKey, SystemDictationHint } from '../src/browser/nextmux-system-dictation';

/** Isolated visual fixture: no NextMux process, account, model, network or billing calls. */
function Fixture(): React.ReactElement {
    const [controller] = React.useState(() => new AgentQuestionController());
    const [, update] = React.useReducer(value => value + 1, 0);
    const [task, setTask] = React.useState('task-a');
    const [locale, setLocale] = React.useState<NextMuxDesktopLocale>('en');
    const [fail, setFail] = React.useState(false);
    const [attachments, setAttachments] = React.useState(false);
    const [composer, setComposer] = React.useState('Queued draft: do not use this as the question answer');
    const [result, setResult] = React.useState('No answer submitted');
    const [dictationTarget, setDictationTarget] = React.useState<DictationTarget>('unavailable');
    const [dictationHelpOpen, setDictationHelpOpen] = React.useState(false);
    const [stageWidth, setStageWidth] = React.useState(640);
    const [geometry, setGeometry] = React.useState('Use Measure scroll end after changing the fixture.');
    const root = React.useRef<HTMLElement>(null);
    const sequence = React.useRef(0);
    const queue = task === 'task-a' ? ['Review the sample files later', 'Prepare the fictional report later'] : ['Task B queue stays in task B'];
    const createQuestion = (): void => {
        controller.sync({ questionId: `q-${++sequence.current}`, runId: 'run-a', taskId: 'task-a',
            prompt: 'Choose the next action. ' + 'This fictional long prompt verifies internal scrolling in a compact window. '.repeat(8),
            options: Array.from({ length: 6 }, (_, index) => ({ id: `option-${index}`, label: `Option ${index + 1} · Continue the fictional task`,
                description: 'This is an answer option, never a message from the task queue. Long details wrap without widening the panel. '.repeat(2) })),
            allowFreeText: true, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 60_000).toISOString()
        }, 'run-a', 'task-a');
        update();
    };
    React.useEffect(createQuestion, []);
    const pending = controller.visible('run-a', task);
    const send = (cancelled = false): void => {
        if (!pending) return;
        const answer = controller.begin(pending, 'run-a', task, cancelled);
        if (!answer) return;
        update();
        setTimeout(() => {
            controller.finish(answer, !fail, fail ? 'Simulated network failure: the answer stays available for retry.' : '');
            setResult(fail ? 'Simulated failure — draft retained' : cancelled ? 'Paused — queue unchanged' : JSON.stringify(answer));
            update();
        }, 700);
    };
    return <main ref={root} className='fixture nmx-desktop-widget nmx-theme-light' dir={locale === 'ar' ? 'rtl' : 'ltr'}>
        <nav aria-label='Fixture controls'>
            <button onClick={() => setTask('task-a')}>Task A</button><button onClick={() => setTask('task-b')}>Task B</button>
            <button onClick={createQuestion}>New question A</button>
            <button type='button' onClick={() => setStageWidth(320)}>Width 320</button>
            <button type='button' onClick={() => setStageWidth(640)}>Width 640</button>
            <button type='button' onClick={() => {
                const thread = root.current?.querySelector<HTMLElement>('.nmx-task-thread');
                if (!thread) return;
                thread.scrollTop = thread.scrollHeight;
                requestAnimationFrame(() => {
                    const last = root.current!.querySelector('#last-conversation-line')!.getBoundingClientRect();
                    const composerBox = root.current!.querySelector('.nmx-composer-wrap')!.getBoundingClientRect();
                    const stage = root.current!.querySelector('.fixture-stage')!.getBoundingClientRect();
                    const hint = root.current!.querySelector('.nmx-system-dictation-hint')?.getBoundingClientRect();
                    const question = root.current!.querySelector('.nmx-user-question')?.getBoundingClientRect();
                    setGeometry(JSON.stringify({ width: Math.round(stage.width), stageHeight: Math.round(stage.height),
                        lastLineBottom: Math.round(last.bottom - stage.top), composerTop: Math.round(composerBox.top - stage.top),
                        clearance: Math.round(composerBox.top - last.bottom), hintHeight: Math.round(hint?.height || 0),
                        questionHeight: Math.round(question?.height || 0), composerHeight: Math.round(composerBox.height),
                        horizontalOverflow: thread.scrollWidth > thread.clientWidth }));
                });
            }}>Measure scroll end</button>
            <button type='button' onMouseDown={event => event.preventDefault()} onClick={() => {
                if (!root.current) return;
                setDictationTarget(focusSystemDictationDraft(root.current)); setDictationHelpOpen(true);
            }}>System dictation draft</button>
            <button onClick={() => { const q = controller.question; if (q) controller.sync({ ...q, expiresAt: new Date(0).toISOString() }, 'run-a', 'task-a'); update(); }}>Expire question</button>
            <select aria-label='Locale' value={locale} onChange={event => setLocale(event.currentTarget.value as NextMuxDesktopLocale)}>
                {['zh-CN', 'en', 'de', 'ar'].map(value => <option key={value}>{value}</option>)}
            </select>
            <label><input type='checkbox' checked={fail} onChange={event => setFail(event.currentTarget.checked)} />Fail next answer</label>
            <label><input type='checkbox' checked={attachments} onChange={event => setAttachments(event.currentTarget.checked)} />Mock attachments</label>
        </nav>
        <p>Isolated component fixture · {task} · queued {queue.length} · no external requests</p>
        <output aria-label='Last test result'>{result}</output>
        <output aria-label='Layout geometry'>{geometry}</output>
        <section className='fixture-stage nmx-shell nmx-theme-light' style={{ width: `min(100%, ${stageWidth}px)` }}><div className='nmx-task-thread nmx-task-view'>
            {Array.from({ length: 8 }, (_, index) => <article className='nmx-task-turn' key={index}><p>Conversation paragraph {index + 1}</p><p>Existing response text remains above the question panel.</p></article>)}
            <article className='nmx-task-turn is-last'><p id='last-conversation-line'>LAST CONVERSATION LINE — must scroll above the question.</p></article>
        </div><div className='nmx-composer-wrap'>
            {pending ? <AgentQuestionPanel question={pending} draft={controller.draft} locale={locale} queuedCount={queue.length}
                submitting={controller.isSubmitting(pending)} keyboardSubmitDisabled={dictationTarget !== 'unavailable'} onEdit={patch => { controller.edit(pending, patch); update(); }}
                onAnswer={() => send()} onCancel={() => send(true)} />
                : <section className='nmx-follow-up-queue'><header>Message queue · {queue.length}</header>{queue.map(item => <p key={item}>{item}</p>)}</section>}
            {attachments && <div className='nmx-composer-assets'><span>Queued attachment · draft.csv</span></div>}
            {dictationHelpOpen && <SystemDictationHint locale={locale} platform={navigator.platform} target={dictationTarget}
                onExit={() => { setDictationHelpOpen(false); setDictationTarget('unavailable'); }} />}
            <div className='nmx-composer'><textarea aria-label='Ordinary composer' value={composer} onChange={event => setComposer(event.currentTarget.value)}
                onKeyDown={event => { if (shouldSubmitComposerKey(event.nativeEvent, dictationTarget !== 'unavailable')) {
                    event.preventDefault(); setResult('Ordinary composer submitted explicitly: ' + composer);
                } }} />
                <div><span>Model · Permission · Attachments</span><button type='button' onClick={() => setResult('Ordinary composer sent by button: ' + composer)}>Queued send</button></div>
            </div>
        </div></section>
    </main>;
}

createRoot(document.getElementById('fixture')!).render(<Fixture />);
