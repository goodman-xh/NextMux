import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { AgentQuestionController, questionPausePreservesQueue } from '../lib/browser/nextmux-agent-question.js';
import { AgentQuestionPanel } from '../lib/browser/nextmux-agent-question-panel.js';
import { createConversationHistoryMirror, readConversationHistoryMirror } from '../lib/browser/nextmux-conversation-history.js';
import { answeredQuestionMemory, completedConversationHistory, compactedConversationHistory } from '../lib/browser/nextmux-conversation-branch.js';

const require = createRequire(import.meta.url);
const coreRequire = createRequire(require.resolve('@theia/core/package.json'));
const { renderToStaticMarkup } = coreRequire('react-dom/server');
const question = (patch = {}) => ({ questionId: 'q-1', runId: 'run-a', taskId: 'task-a', prompt: 'Choose the next step?',
  options: [{ id: 'read', label: 'Read first', description: 'No changes' }, { id: 'edit', label: 'Edit' }],
  allowFreeText: true, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), ...patch });
const sync = (controller, q) => controller.sync(q, q.runId, q.taskId);

test('answers are explicit and never consume queued messages or the normal composer', () => {
  const controller = new AgentQuestionController(), q = question();
  const queue = Object.freeze([{ id: 'ordinary-next-task', prompt: 'This is not an answer' }]);
  const composer = Object.freeze({ prompt: 'Unsent task draft', attachments: ['draft.csv'] });
  sync(controller, q);
  assert.equal(controller.begin(q, q.runId, q.taskId), undefined);
  controller.edit(q, { optionId: 'read', text: 'Use this directory' });
  const answer = controller.begin(q, q.runId, q.taskId);
  assert.deepEqual(answer, { questionId: 'q-1', runId: 'run-a', taskId: 'task-a', optionId: 'read', text: 'Use this directory' });
  assert.deepEqual(queue, [{ id: 'ordinary-next-task', prompt: 'This is not an answer' }]);
  assert.equal(composer.prompt, 'Unsent task draft');
});

test('switching tasks hides the question without moving its draft to another task', () => {
  const controller = new AgentQuestionController(), q = question();
  sync(controller, q);
  controller.edit(q, { text: 'A private answer' });
  assert.equal(controller.visible('run-a', 'task-b'), undefined);
  assert.equal(controller.begin(q, 'run-a', 'task-b'), undefined);
  assert.equal(controller.begin(q, 'run-b', 'task-a'), undefined);
  assert.equal(controller.visible('run-a', 'task-a'), q);
  assert.equal(controller.draft.text, 'A private answer');
});

test('double submission is locked and failed submission preserves the exact answer for retry', () => {
  const controller = new AgentQuestionController(), q = question();
  sync(controller, q);
  controller.edit(q, { optionId: 'edit', text: 'Keep the tests' });
  const answer = controller.begin(q, q.runId, q.taskId);
  assert.equal(controller.begin(q, q.runId, q.taskId), undefined);
  assert.equal(controller.edit(q, { text: 'changed during RPC' }), false);
  controller.finish(answer, false, 'Connection interrupted');
  assert.equal(controller.draft.text, 'Keep the tests');
  assert.equal(controller.draft.error, 'Connection interrupted');
  const retry = controller.begin(q, q.runId, q.taskId);
  assert.deepEqual(retry, answer);
  controller.finish(retry, true);
  sync(controller, q); // delayed snapshot cannot revive a submitted question
  assert.equal(controller.question, undefined);
});

test('an older RPC completion cannot clear a new question or another run draft', () => {
  for (const next of [question({ questionId: 'q-2' }), question({ runId: 'run-b', taskId: 'task-b' })]) {
    const controller = new AgentQuestionController(), q = question();
    sync(controller, q); controller.edit(q, { text: 'Old answer' });
    const oldAnswer = controller.begin(q, q.runId, q.taskId);
    sync(controller, next); controller.edit(next, { text: 'New answer draft' });
    controller.finish(oldAnswer, true);
    assert.equal(controller.question, next);
    assert.equal(controller.draft.text, 'New answer draft');
    assert.equal(controller.begin(q, next.runId, next.taskId), undefined);
  }
});

test('expired and wrong-owner snapshots cannot accept answers; free text does not require an option', () => {
  const controller = new AgentQuestionController(), q = question();
  controller.sync(q, 'other-run', q.taskId);
  assert.equal(controller.question, undefined);
  sync(controller, q);
  assert.equal(controller.edit(q, { optionId: 'unknown' }), false);
  controller.edit(q, { text: 'My own option' });
  assert.equal(controller.begin(q, q.runId, q.taskId, false, Date.parse(q.expiresAt)), undefined);
  assert.equal(controller.begin(q, q.runId, q.taskId).text, 'My own option');
});

test('cancellation has no implicit answer and both user-input pauses preserve the queue', () => {
  const controller = new AgentQuestionController(), q = question();
  sync(controller, q); controller.edit(q, { optionId: 'read', text: 'Do not submit this' });
  assert.deepEqual(controller.begin(q, q.runId, q.taskId, true), { runId: q.runId, taskId: q.taskId, questionId: q.questionId, cancelled: true });
  assert.equal(questionPausePreservesQueue('user_input_cancelled'), true);
  assert.equal(questionPausePreservesQueue('user_input_expired'), true);
  assert.equal(questionPausePreservesQueue('completed'), false);
});

test('question panel keeps free input and accessible radio options in every locale', () => {
  for (const locale of ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
    const html = renderToStaticMarkup(AgentQuestionPanel({ question: question({ prompt: '<script>not executable</script>' }),
      draft: { optionId: '', text: '', error: '' }, submitting: false, queuedCount: 3, locale, onEdit() {}, onAnswer() {}, onCancel() {} }));
    assert.match(html, /role="radiogroup"/);
    assert.equal((html.match(/<textarea/g) || []).length, 1);
    assert.match(html, /data-task-id="task-a"/);
    assert.match(html, /&lt;script&gt;not executable&lt;\/script&gt;/);
    assert.doesNotMatch(html, /nmx-follow-up-queue/);
    assert.match(html, /· 3/);
  }
});

test('question submission and paste cannot bubble to the ordinary composer', () => {
  let answers = 0, stops = 0, prevents = 0;
  const panel = AgentQuestionPanel({ question: question(), draft: { optionId: '', text: 'answer', error: '' },
    submitting: false, queuedCount: 1, locale: 'en', onEdit() {}, onAnswer() { answers++; }, onCancel() {} });
  const event = { stopPropagation() { stops++; }, preventDefault() { prevents++; } };
  panel.props.onPaste(event);
  assert.equal(stops, 1); assert.equal(prevents, 0);
  panel.props.onKeyDown({ ...event, key: 'Enter', ctrlKey: true, nativeEvent: { isComposing: true } });
  assert.equal(answers, 0);
  panel.props.onKeyDown({ ...event, key: 'Enter', metaKey: true, nativeEvent: { isComposing: false } });
  assert.equal(answers, 1);
  panel.props.onSubmit(event);
  assert.equal(answers, 2);
  assert.equal(stops, 4);
});

test('question history survives restart as read-only events and never enters the ordinary queue', () => {
  const q = question();
  const events = [
    { type: 'user_input_requested', question: q, at: q.createdAt },
    { type: 'user_input_resolved', questionId: q.questionId, runId: q.runId, taskId: q.taskId,
      status: 'answered', answer: { optionId: 'read', optionLabel: 'Read first', text: 'Keep files unchanged' }, at: q.createdAt },
    { type: 'user_input_resolved', questionId: 'q-cancelled', runId: q.runId, taskId: q.taskId,
      status: 'cancelled', answer: { text: 'Never persist a cancelled draft as an answer' }, at: q.createdAt },
  ];
  const original = { id: q.taskId, updatedAt: 1, createdAt: 1, followUpQueue: [{ id: 'queued', sessionId: q.taskId, source: 'user', prompt: 'Ordinary queued task' }],
    turns: [{ id: 'turn', prompt: 'Original task', createdAt: 1, response: '', stage: 'paused', stopReason: 'user_input_cancelled', events }] };
  const restored = readConversationHistoryMirror(JSON.stringify(createConversationHistoryMirror([original]))).sessions[0];
  assert.deepEqual(restored.turns[0].events.slice(0, 2), events.slice(0, 2));
  assert.equal(restored.turns[0].events[2].answer, undefined);
  assert.equal(restored.followUpQueue.length, 1);
  assert.equal(restored.followUpQueue[0].prompt, 'Ordinary queued task');
  assert.equal(restored.turns[0].stopReason, 'user_input_cancelled');
  const controller = new AgentQuestionController();
  assert.equal(controller.question, undefined, 'persisted events do not restore an actionable question');
});

test('explicit answers remain in the next model turn and older compacted memory without adding queue messages', () => {
  const q = question({ prompt: 'Which language should we use?' });
  const resolved = { type: 'user_input_resolved', questionId: q.questionId, runId: q.runId, taskId: q.taskId,
    status: 'answered', answer: { text: 'ANSWER_ONLY_SENTINEL_SPANISH' }, at: q.createdAt };
  const first = { id: 'first', stage: 'complete', prompt: 'Prepare the report', response: 'Done.',
    events: [{ type: 'user_input_requested', question: q, at: q.createdAt }, resolved, resolved] };
  const recent = completedConversationHistory([first]);
  assert.equal(recent.length, 2, 'clarifications do not spend the historical message budget');
  assert.equal(recent[0].content.split('ANSWER_ONLY_SENTINEL_SPANISH').length, 2, 'deduplicated by full binding');
  const many = [first, ...Array.from({ length: 12 }, (_, index) => ({ id: `later-${index}`, stage: 'complete', prompt: 'Next task', response: 'Done.' }))];
  const compacted = compactedConversationHistory(many);
  assert.ok(compacted.some(item => item.content.includes('ANSWER_ONLY_SENTINEL_SPANISH')));
  assert.equal(answeredQuestionMemory({ ...first, branchUserOnly: true }), '', 'prompt-only branch cannot inherit later decisions');
  assert.equal(answeredQuestionMemory({ ...first, events: [first.events[0], { ...resolved, runId: 'other-run' }, { ...resolved, taskId: 'other-task' }] }), '');
  assert.equal(answeredQuestionMemory({ ...first, events: [first.events[0], { ...resolved, status: 'cancelled' }, resolved] }), '', 'first terminal resolution wins');
  assert.equal(answeredQuestionMemory({ ...first, events: [first.events[0], { ...resolved, status: 'expired' }] }), '');
  const bounded = completedConversationHistory([{ ...first, prompt: 'x'.repeat(30_000) }]);
  assert.ok(bounded[0].content.length <= 20_000);
  assert.match(bounded[0].content, /ANSWER_ONLY_SENTINEL_SPANISH/);
});

test('widget integrates a dedicated answer channel, bounded panel and paused-run scheduling guards', () => {
  const widget = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
  const answerMethod = widget.slice(widget.indexOf('protected async answerAgentQuestion'), widget.indexOf('protected async pollAgentRun'));
  assert.match(answerMethod, /answerAgentRunQuestion\(answer\)/);
  assert.doesNotMatch(answerMethod, /sendAgentRunMessage|enqueueFollowUpTask|this\.prompt|removeQueued/);
  assert.match(widget, /pendingQuestion \? <AgentQuestionPanel[\s\S]*?\/\> : followUpQueue\.length/);
  assert.match(widget, /!agentPauseBlocksAutomaticDispatch\(run\.agentResult\?\.stopReason\)/);
  assert.match(widget, /!agentPauseBlocksAutomaticDispatch\(turn\.stopReason\)/);
  assert.match(widget, /!agentPauseBlocksAutomaticDispatch\(latestTurn\.stopReason\)/);
  const css = readFileSync(new URL('../src/browser/style/nextmux.css', import.meta.url), 'utf8');
  assert.match(css, /--nmx-question-max-height: min\(28dvh, 220px\)/);
  assert.match(css, /max-height: var\(--nmx-question-max-height\)/);
  assert.match(css, /\.nmx-user-question-body \{[^}]*overflow: auto/s);
  assert.match(css, /\.nmx-shell:has\(\.nmx-user-question\) \.nmx-task-turn\.is-last \{[^}]*padding-bottom: var\(--nmx-dictation-composer-clearance, calc\(205px \+ var\(--nmx-question-max-height\)\)\)/s);
});
