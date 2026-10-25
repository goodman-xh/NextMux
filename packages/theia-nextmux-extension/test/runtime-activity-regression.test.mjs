import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  appendAgentActivityEvents,
  autoResumeDelayMs,
  autoResumeDecision,
  commandActivityCommand,
  commandActivityTitle,
  toolActivitySucceeded,
  summarizeAgentTaskProgress,
  userQueuedPrompts
} from '../lib/browser/nextmux-agent-activity.js';

const at = '2026-08-30T00:00:00.000Z';
const toolStarted = (callId, title = '运行 pnpm test') => ({
  type: 'tool_started', callId, toolName: 'process.run', source: 'builtin', summary: { title }, at
});
const toolCompleted = (callId, ok, title) => ({
  type: 'tool_completed', callId, toolName: 'process.run', ok, summary: { title, details: ['exit code 1'] }, durationMs: 12, at
});

test('activity history appends durable narration and tool failures without truncating or replacing earlier records', () => {
  const earlier = [
    { type: 'assistant_progress', turn: 1, content: '正在检查测试。', origin: 'model', at },
    toolStarted('first'),
    toolCompleted('first', false, '命令执行失败')
  ];
  const later = [
    { type: 'model_retry_scheduled', turn: 2, attempt: 2, delayMs: 300, reason: 'retryable transport failure', at },
    toolStarted('second', '运行 pnpm typecheck'),
    toolCompleted('second', true, '命令执行完成')
  ];
  const merged = appendAgentActivityEvents(earlier, later);
  assert.equal(merged.length, 6);
  assert.equal(merged[0], earlier[0]);
  assert.equal(merged[2], earlier[2]);
  assert.equal(merged[2].ok, false);
  assert.equal(merged[3].type, 'model_retry_scheduled');

  const many = Array.from({ length: 600 }, (_, index) => ({
    type: 'assistant_progress', turn: index + 1, content: `progress-${index}`, origin: 'model', at
  }));
  assert.equal(appendAgentActivityEvents([], many).length, 600);
});

test('task queue projection accepts only user-authored prompt records', () => {
  const queue = userQueuedPrompts([
    { id: 'user-1', prompt: '修复登录回归', source: 'user' },
    { id: 'tool-1', prompt: 'rg -n login src', source: 'tool' },
    { id: 'tool-2', prompt: 'process exited with code 1', source: 'tool' },
    { id: 'user-2', prompt: '再运行最小测试', source: 'user' }
  ]);
  assert.deepEqual(queue.map(item => item.prompt), ['修复登录回归', '再运行最小测试']);
});

test('automatic checkpoint continuation resumes pauses and only explicitly safe failures', () => {
  assert.deepEqual(autoResumeDecision({ attempt: 0, maximum: 3, failureKind: undefined }), { action: 'resume', nextAttempt: 1 });
  assert.deepEqual(autoResumeDecision({ attempt: 2, maximum: 3, failureKind: undefined }), { action: 'resume', nextAttempt: 3 });
  assert.deepEqual(autoResumeDecision({ attempt: 3, maximum: 3, failureKind: undefined }), { action: 'stop', reason: 'limit' });
  assert.deepEqual(autoResumeDecision({ attempt: 0, maximum: 3, failureKind: 'waiting_user' }), { action: 'stop', reason: 'user' });
  assert.deepEqual(autoResumeDecision({ attempt: 0, maximum: 3, failureKind: 'model_auth' }), { action: 'stop', reason: 'user' });
  assert.deepEqual(autoResumeDecision({ attempt: 0, maximum: 3, failureKind: 'rate_limited', retrySafe: true }), { action: 'resume', nextAttempt: 1 });
  assert.deepEqual(autoResumeDecision({ attempt: 0, maximum: 3, failureKind: 'rate_limited', retrySafe: false }), { action: 'stop', reason: 'unsafe' });
  assert.deepEqual(autoResumeDecision({ attempt: 0, maximum: 3, failureKind: 'rate_limited' }), { action: 'stop', reason: 'unsafe' });
  assert.equal(autoResumeDelayMs(1), 1_000);
  assert.equal(autoResumeDelayMs(2), 2_000);
  assert.equal(autoResumeDelayMs(3), 4_000);
  assert.equal(autoResumeDelayMs(1, 15_000), 15_000);
  assert.equal(autoResumeDelayMs(2, 500), 2_000);
  assert.equal(autoResumeDelayMs(3, 999_999), 300_000);
  // A busy provider waits 30, 60, 60 and 120 seconds (LobeChat #7); a longer server hint still wins, up to 5 minutes.
  assert.equal(autoResumeDelayMs(1, undefined, 'RATE_LIMITED'), 30_000);
  assert.equal(autoResumeDelayMs(2, 0, 'RATE_LIMITED', 429), 60_000);
  assert.equal(autoResumeDelayMs(3, 45_000, 'TOO_MANY_REQUESTS'), 60_000);
  assert.equal(autoResumeDelayMs(4, undefined, 'RATE_LIMITED'), 120_000);
  assert.equal(autoResumeDelayMs(1, 90_000, 'RATE_LIMITED'), 90_000);
  assert.equal(autoResumeDelayMs(9, undefined, 'MODEL_OVERLOADED'), 120_000);
  assert.equal(autoResumeDelayMs(1, undefined, 'RETRY_LIMIT'), 1_000);
});

test('a completed process tool with a non-zero exit remains failed without becoming a queue or plan item', () => {
  const summary = { title: 'pnpm 退出码 1', outcome: 'failed', details: ['test failure'] };
  assert.equal(toolActivitySucceeded(true, summary), false);
  const progress = summarizeAgentTaskProgress([
    toolStarted('non-zero', '运行 pnpm test'),
    { ...toolCompleted('non-zero', true, summary.title), summary }
  ], [], false);
  assert.equal(progress.totalSteps, 0);
  assert.deepEqual(progress.steps, []);
});

test('command activity labels keep readable concrete commands and bound only genuinely long values', () => {
  assert.equal(commandActivityCommand('运行 node server.js --port 3000'), 'node server.js --port 3000');
  assert.equal(commandActivityCommand('运行 node server.js\n--port 3000'), 'node server.js --port 3000');
  assert.equal(commandActivityTitle('zh-CN', 'running', 'pnpm test --filter long-package-name'), '正在运行 pnpm test --filter long-package-name');
  assert.equal(commandActivityTitle('zh-CN', 'completed', 'node server.js'), '执行了 node server.js');
  assert.equal(commandActivityTitle('zh-CN', 'failed', 'pnpm test'), '执行 pnpm test失败');
  assert.equal(commandActivityTitle('en', 'running', 'pnpm test'), 'Running pnpm test');
  assert.equal(commandActivityTitle('en', 'completed', 'node server.js'), 'Ran node server.js');
  assert.equal(commandActivityTitle('en', 'failed', 'pnpm test'), 'pnpm test failed');

  const bounded = commandActivityTitle('zh-CN', 'running', `node script.js --payload=${'x'.repeat(600)}`);
  assert.equal(bounded.includes('\n'), false);
  assert.ok(bounded.length <= 260);
  assert.match(bounded, /^正在运行 node script\.js --payload=x+…$/);
});

test('conversation runtime keeps queue and activity separate and renders durable feedback', () => {
  const widget = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
  const style = readFileSync(fileURLToPath(new URL('../src/browser/style/nextmux.css', import.meta.url)), 'utf8');

  const pollStart = widget.indexOf('protected async pollAgentRun(');
  const pollEnd = widget.indexOf('protected async stopAgentRun(', pollStart);
  assert.ok(pollStart >= 0 && pollEnd > pollStart, 'conversation polling boundaries resolve');
  const poll = widget.slice(pollStart, pollEnd);
  assert.match(poll, /run: ConversationAgentRun = this\.conversationAgentRun\(\)/);
  assert.match(poll, /while \(run\.activeAgentRunId === runId && run\.agentPollGeneration === generation\)/);
  const ownerGuard = 'if (run.activeAgentRunId !== runId || run.agentPollGeneration !== generation || snapshot.runId !== runId) return undefined;';
  const merge = 'const merged = mergeAgentEventPollSnapshot(run.liveAgentEvents, cursor, snapshot, this.desktopLocale);';
  assert.ok(poll.includes(ownerGuard), 'late or mismatched snapshots are rejected for their original owner');
  assert.ok(poll.indexOf(ownerGuard) < poll.indexOf(merge), 'owner validation precedes event merging');
  assert.ok(poll.includes(merge), 'polling merges the owning conversation runtime events');
  assert.match(poll, /run\.liveAgentEvents = merged\.events;/);
  assert.match(poll, /this\.updateCodingTurn\(run\.activeAgentSessionId, run\.activeAgentTurnId, \{[\s\S]*?events: run\.liveAgentEvents/);
  assert.doesNotMatch(poll, /this\.liveAgentEvents/, 'polling cannot read or write a global visible conversation event stream');
  assert.doesNotMatch(widget, /liveAgentEvents\s*=\s*\[[^\n]*snapshot\.events[^\n]*\]\.slice\(-512\)/);
  assert.match(widget, /const recordedActivityEvents = appendAgentActivityEvents\(\s*turn\.events \|\| \[\],\s*\[/);
  assert.doesNotMatch(widget, /const activityEvents = live && stage === 'running'\s*\?\s*this\.liveAgentEvents/);
  assert.match(widget, /const originalRawResponse = withoutReplayedContextNote\(\[liveResult\?\.finalText, turn\.response\]/);
  assert.match(widget, /userQueuedPrompts\(codingSession\?\.followUpQueue \|\| \[\]\)/);
  assert.match(widget, /summarizeAgentTaskProgress\(events, changes, running\)/);
  // The stream projection (nextmux-conversation-stream-model.ts) owns tool rows.
  const model = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-conversation-stream-model.ts', import.meta.url)), 'utf8');
  const view = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-conversation-stream.tsx', import.meta.url)), 'utf8');
  const streamStyle = readFileSync(fileURLToPath(new URL('../src/browser/style/nextmux-conversation-stream.css', import.meta.url)), 'utf8');
  // Find can open a row's details too, so aria-expanded follows what is actually shown.
  assert.match(view, /className='nmx-stream-trigger'[\s\S]*?aria-expanded=\{expandable \? detailsOpen : undefined\}/);
  assert.match(model, /const interrupted = !running && !settledToolCalls\.has\(event\.callId\)/);
  assert.match(model, /const state: CommandActivityState = interrupted \? 'stopped' : 'running'/);
  assert.match(model, /toolActivityCompletionState\(\{ ok: event\.ok, status: event\.status, outcome: event\.summary\.outcome/);
  assert.match(model, /commandLine: event\.summary\.commandLine, processCommandLine: processCommandLines\.get\(event\.callId\)/);
  assert.match(model, /const settledToolCalls = new Set/);
  assert.match(widget, /renderTerminal: \(command, output, live\) => this\.renderAgentCommandTerminal\(command, output, live\)/);
  assert.match(widget, /class NextMuxCommandOutputHost extends React\.PureComponent/);
  assert.match(widget, /<NextMuxCommandOutputHost commandLine=\{commandLine\} output=\{output\} running=\{running\}/);
  assert.match(widget, /className='nmx-stream-idle-caret'/);
  assert.match(widget, /ensureAgentFinalSummary/);
  assert.match(widget, /scheduleAutomaticResume/);
  assert.match(widget, /agentOutcomeText\(this\.desktopLocale, 'continueTask'\)/);

  assert.match(view, /className='codicon codicon-chevron-right nmx-stream-chevron' aria-hidden='true'><\/i>/);
  assert.match(streamStyle, /\.nmx-stream-row\.is-expanded \.nmx-stream-chevron \{ transform: rotate\(90deg\); \}/);
  assert.match(streamStyle, /\.nmx-stream-trigger \{[\s\S]*?max-width:\s*100%;[\s\S]*?cursor:\s*default;/);
  assert.match(streamStyle, /> \.nmx-agent-command-terminal\s*\{[\s\S]*?background:\s*transparent;/);
  assert.match(style, /\.nmx-agent-command-xterm\s*\{[\s\S]*?max-height:\s*180px;[\s\S]*?user-select:\s*text;/);
  assert.match(style, /\.nmx-agent-command-xterm \.xterm-viewport\s*\{[\s\S]*?scrollbar-gutter:\s*stable;/);
  assert.match(style, /\.nmx-stream-idle-caret\s*\{[\s\S]*?width:\s*2px;[\s\S]*?animation:/);
  assert.match(style, /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.nmx-stream-idle-caret\s*\{[\s\S]*?animation:\s*none;/);
});

test('activity stream keeps narration, tools, files, and browser actions in one compact visual hierarchy', () => {
  const widget = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
  const model = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-conversation-stream-model.ts', import.meta.url)), 'utf8');
  const view = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-conversation-stream.tsx', import.meta.url)), 'utf8');
  const style = readFileSync(fileURLToPath(new URL('../src/browser/style/nextmux-conversation-stream.css', import.meta.url)), 'utf8');
  const renderStart = widget.indexOf('protected renderAgentActivity(');
  const renderEnd = widget.indexOf('protected renderCodingWorkbench(', renderStart);
  assert.ok(renderStart >= 0 && renderEnd > renderStart, 'activity renderer boundaries resolve');
  const render = widget.slice(renderStart, renderEnd);
  assert.match(render, /projectConversationStream\(/);
  assert.match(render, /<ConversationStream /);

  // Every observable operation uses the same row shell; its content stays
  // semantic through `data-activity-kind` and icons instead of growing a
  // different card for every provider/tool (OpenCode BasicTool pattern).
  assert.equal((view.match(/className=\{`nmx-stream-row is-/g) || []).length, 1);
  for (const kind of ['browser', 'command', 'context-compaction', 'reasoning', 'resumed', 'retry', 'fallback', 'model-attempt'])
    assert.match(model, new RegExp(`activity: '${kind}'`), kind);
  assert.match(model, /activity: `file-\$\{resource\.action\}`/);
  assert.match(model, /activity: `model-\$\{event\.phase\}`/);
  assert.match(model, /activityToolVisual\(event\.toolName/);
  assert.match(model, /browserToolActivity\(locale, event\.toolName, state, target\)/);
  assert.match(view, /className=\{`nmx-agent-narration nmx-stream-text/);

  const rowStyle = style.slice(style.indexOf('\n.nmx-stream-row {'), style.indexOf('\n.nmx-stream-line {'));
  assert.match(rowStyle, /font-size:\s*13px;/);
  assert.doesNotMatch(rowStyle, /box-shadow:|border:|background:/, 'activity rows stay on the conversation canvas');
  const textStyle = style.slice(style.indexOf('\n.nmx-stream-text {'), style.indexOf('\n.nmx-stream-text >'));
  assert.match(textStyle, /font-size:\s*15px;/);
  assert.match(textStyle, /line-height:\s*1\.6;/);
  assert.doesNotMatch(textStyle, /background:|max-height|overflow:\s*hidden/, 'body text is never boxed or clipped');
});
