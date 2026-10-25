#!/usr/bin/env node

import { ensureDesktopFullAccess } from './desktop-e2e-permission.mjs';
import { connectToNextMuxWorkbench } from './desktop-attachment-file-e2e-harness.mjs';
import { commandActivityTitle } from '../packages/theia-nextmux-extension/lib/browser/nextmux-agent-activity.js';
import { normalizeDesktopLocale } from '../packages/theia-nextmux-extension/lib/browser/nextmux-locale.js';
import { localizeDesktopSurface } from '../packages/theia-nextmux-extension/lib/browser/nextmux-surface-locale.js';
import {
  ensureExactOfficialQaRoute,
  officialQaRouteConfig,
  removeExactOfficialQaRoute,
} from './desktop-official-qa-route.mjs';

const cdpPort = process.env.NEXTMUX_CDP_PORT || '9222';
const stamp = Date.now();
const failedMarker = `NM_COMMAND_FAILURE_E2E_${stamp}`;
const recoveryMarker = `NM_AUTO_RESUME_E2E_${stamp}`;
const rateLimitMarker = `NM_RATE_LIMIT_E2E_${stamp}`;
const { socket, call } = await connectToNextMuxWorkbench(cdpPort);
const evaluate = async expression => {
  const response = await call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  }
  return response.result?.value;
};
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const waitFor = async (read, predicate, timeoutMs, label) => {
  const deadline = Date.now() + timeoutMs;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (predicate(value)) return value;
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${label}. Last state: ${JSON.stringify(value)}`);
};
const clickPoint = async point => {
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
};

await Promise.all([call('Runtime.enable'), call('Page.enable')]);
await call('Page.bringToFront');
const qaRoute = await ensureExactOfficialQaRoute({ evaluate, config: officialQaRouteConfig() });
// Route setup always returns to the coding composer. Select permission only
// after that transition so this flow is independent of the previous E2E's
// final section (route cleanup intentionally ends in Model Center).
await ensureDesktopFullAccess(evaluate);
const activityLocale = normalizeDesktopLocale(await evaluate(`document.querySelector('.nmx-desktop-widget')?.getAttribute('lang') || document.documentElement.lang || navigator.language`));
const retryLabel = localizeDesktopSurface(activityLocale, '正在重试模型连接');
const commandRow = (state, status) => state.details.find(detail => detail.command
  && detail.title === commandActivityTitle(activityLocale, status, detail.command));

const composerState = () => evaluate(`(() => {
  const textarea = document.querySelector('.nmx-composer textarea');
  const button = document.querySelector('.nmx-send-button');
  if (!textarea || !button) return null;
  const textareaRect = textarea.getBoundingClientRect();
  const buttonRect = button.getBoundingClientRect();
  return {
    value: textarea.value,
    textarea: { x: textareaRect.x + textareaRect.width / 2, y: textareaRect.y + textareaRect.height / 2 },
    button: { x: buttonRect.x + buttonRect.width / 2, y: buttonRect.y + buttonRect.height / 2 },
    stopping: button.classList.contains('is-stop'),
    label: button.getAttribute('aria-label') || '',
  };
})()`);
const sendPrompt = async prompt => {
  const initial = await waitFor(composerState, state => state && !state.stopping, 20_000, 'idle composer');
  await clickPoint(initial.textarea);
  await call('Input.insertText', { text: prompt });
  const ready = await waitFor(composerState, state => state?.value === prompt && !state.stopping, 5_000, 'entered prompt');
  await clickPoint(ready.button);
};
const readTurn = marker => evaluate(`(() => {
  const marker = ${JSON.stringify(marker)};
  const turn = [...document.querySelectorAll('.nmx-task-turn')].find(node => (node.innerText || '').includes(marker));
  const operations = turn ? [...turn.querySelectorAll('.nmx-agent-operation')] : [];
  const commandDetails = operations.filter(node => node.querySelector('.nmx-agent-operation-toggle'));
  return {
    exists: Boolean(turn),
    text: turn?.innerText || '',
    running: document.querySelector('.nmx-send-button')?.classList.contains('is-stop') || false,
    caret: Boolean(turn?.querySelector('.nmx-stream-idle-caret')),
    canContinue: Boolean(turn?.querySelector('.nmx-agent-resume button:not(:disabled)')),
    operationTitles: commandDetails.map(node => node.querySelector('summary strong')?.textContent?.trim() || ''),
    failedRows: commandDetails.filter(node => node.classList.contains('is-error')).length,
    processRows: commandDetails.filter(node => Boolean(node.querySelector('.nmx-agent-command-terminal'))).length,
    retryRows: operations.filter(node => node.querySelector('strong')?.textContent?.trim() === ${JSON.stringify(retryLabel)}).length,
    details: commandDetails.map(node => {
      const details = node.querySelector('details');
      const host = node.querySelector('.nmx-agent-command-xterm');
      return {
        open: Boolean(details?.open),
        text: node.innerText || '',
        title: node.querySelector('summary strong')?.textContent?.trim() || '',
        command: host?.getAttribute('aria-label') || '',
        output: [...(host?.querySelectorAll('.xterm-rows > div') || [])]
          .map(row => row.textContent || '').join('\\n')
      };
    }),
  };
})()`);
const readPersistedTurn = marker => evaluate(`(() => {
  const marker = ${JSON.stringify(marker)};
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem('nextmux.desktop.codingSessions.v1') || '{}'); } catch {}
  const sessions = Array.isArray(stored) ? stored : Array.isArray(stored.sessions) ? stored.sessions : [];
  const turn = sessions.flatMap(session => Array.isArray(session?.turns) ? session.turns : [])
    .find(candidate => typeof candidate?.prompt === 'string' && candidate.prompt.includes(marker));
  const events = Array.isArray(turn?.events) ? turn.events : [];
  return {
    stage: turn?.stage || '',
    failure: turn?.failure || null,
    resumeCheckpointId: turn?.resumeCheckpointId || '',
    autoResumeAttempts: Number(turn?.autoResumeAttempts || 0),
    retryEvents: events.filter(event => event?.type === 'model_retry_scheduled').map(event => ({
      delayMs: Number(event.delayMs || 0),
      attempt: Number(event.attempt || 0),
      reason: event.reason || ''
    }))
  };
})()`);
const readRecoveryQaState = async (marker, kind) => {
  const port = process.env.NEXTMUX_OFFICIAL_QA_PORT || '4181';
  const response = await fetch(`http://127.0.0.1:${port}/__nextmux_qa/${kind}?marker=${encodeURIComponent(marker)}`);
  if (!response.ok) throw new Error(`Recovery QA state returned HTTP ${response.status}.`);
  return response.json();
};
// These generic provider errors do not prove a request was unaccepted. Check
// the actual server count, durable checkpoint and UI for longer than the old
// automatic retry floor before granting explicit continuation via the UI.
const confirmStoppedBeforeContinue = async (marker, kind, httpStatus, durationMs) => {
  const failure = await waitFor(() => readPersistedTurn(marker), state => state.stage === 'error'
    && state.failure?.httpStatus === httpStatus && state.failure.retrySafe === false
    && Boolean(state.resumeCheckpointId), 30_000, `persisted ${httpStatus} checkpoint`);
  await waitFor(() => readTurn(marker), state => !state.running && state.canContinue, 5_000, 'explicit continuation button');
  const before = await readRecoveryQaState(marker, kind);
  const startedAt = Date.now();
  while (Date.now() - startedAt < durationMs) {
    const [turn, persisted, current] = await Promise.all([
      readTurn(marker), readPersistedTurn(marker), readRecoveryQaState(marker, kind),
    ]);
    if (turn.running || !turn.canContinue || persisted.stage !== 'error'
      || persisted.resumeCheckpointId !== failure.resumeCheckpointId || persisted.retryEvents.length
      || current.requests !== before.requests || current.processRequests !== 1 || current.readRequests !== 0) {
      throw new Error(`Unsafe automatic replay or lost checkpoint after HTTP ${httpStatus}.`);
    }
    await wait(250);
  }
  const point = await evaluate(`(() => {
    const turn = [...document.querySelectorAll('.nmx-task-turn')].find(node => (node.innerText || '').includes(${JSON.stringify(marker)}));
    const button = turn?.querySelector('.nmx-agent-resume button:not(:disabled)');
    if (!button) return null;
    button.scrollIntoView({ block: 'center' });
    const rect = button.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  if (!point) throw new Error('Continuation button disappeared before explicit consent.');
  await clickPoint(point);
  return { failure, before, stoppedObservedMs: Date.now() - startedAt };
};

await sendPrompt(`${failedMarker}：请在当前项目验证非零退出码的恢复路径。先说明正在做什么，再调用 process.run 执行 node，参数包含 process.exit(7)；完成后用自然语言总结失败如何被呈现。`);
const failedRunning = await waitFor(
  () => readTurn(failedMarker),
  state => state.running && state.caret && commandRow(state, 'running'),
  20_000,
  'running failed-command activity and caret',
);
const failedDone = await waitFor(
  () => readTurn(failedMarker),
  state => !state.running && state.failedRows === 1
    && commandRow(state, 'failed')
    && state.text.includes('非零退出码已被记录'),
  30_000,
  'failed command activity and final summary',
);
const failedRowPoint = await evaluate(`(() => {
  const marker = ${JSON.stringify(failedMarker)};
  const turn = [...document.querySelectorAll('.nmx-task-turn')].find(node => (node.innerText || '').includes(marker));
  const summary = [...(turn?.querySelectorAll('.nmx-agent-operation.is-error details > summary') || [])].at(-1);
  if (!summary) return null;
  const rect = summary.getBoundingClientRect();
  return { x: rect.x + rect.width / 2, y: rect.y + Math.min(rect.height / 2, 16) };
})()`);
if (!failedRowPoint) throw new Error('Failed command row was not available for expansion.');
await clickPoint(failedRowPoint);
const failedExpanded = await waitFor(
  () => readTurn(failedMarker),
  state => state.details.some(detail => detail.open && /(?:退出码|code)\s*7/i.test(detail.output)
    && detail.command.includes('process.exit(7)')),
  5_000,
  'command summary details expansion',
);

await sendPrompt(`${recoveryMarker}：请继续当前项目的恢复检查。先说明正在验证自动恢复，再调用 process.run 执行 node，参数为 -e 和 setTimeout(()=>console.log('${recoveryMarker}'),1500)。模型连接短暂失败时请自动恢复，完成后用自然语言总结。`);
const recoveryRunning = await waitFor(
  () => readTurn(recoveryMarker),
  state => state.running && state.caret && commandRow(state, 'running'),
  20_000,
  'recovery command activity and caret',
);
const recoveryStopped = await confirmStoppedBeforeContinue(recoveryMarker, 'recovery', 503, 1_500);
const recovered = await waitFor(
  () => readTurn(recoveryMarker),
  state => !state.running && !state.canContinue && state.processRows === 1
    && state.text.includes('已完成的命令只执行 1 次')
    && state.text.includes('最终总结均已保留'),
  45_000,
  'explicit checkpoint continuation and summary',
);
const recoveryQaState = await readRecoveryQaState(recoveryMarker, 'recovery');

await sendPrompt(`${rateLimitMarker}：请验证模型限流后的安全恢复。先说明正在执行命令，再调用 process.run 执行 node，参数为 -e 和 setTimeout(()=>console.log('${rateLimitMarker}'),100)。命令完成后模型连接会返回一次 429；必须从检查点继续，绝不能重复执行已经完成的命令，最后用自然语言总结。`);
const rateRunning = await waitFor(
  () => readTurn(rateLimitMarker),
  state => state.running && state.caret && commandRow(state, 'running'),
  20_000,
  'rate-limit command activity and caret',
);
const rateStopped = await confirmStoppedBeforeContinue(rateLimitMarker, 'rate-limit', 429, 16_000);
const rateFailure = rateStopped.failure;
const rateRecovered = await waitFor(
  () => readTurn(rateLimitMarker),
  state => !state.running && state.processRows === 1
    && state.text.includes('429 已按可恢复状态处理')
    && !/Continue task|继续任务/.test(state.text),
  45_000,
  'rate-limit checkpoint recovery and no duplicate command',
);
const rateQaState = await readRecoveryQaState(rateLimitMarker, 'rate-limit');

const report = {
  selectedModel: await evaluate(`document.querySelector('.nmx-route-button')?.getAttribute('data-model-id') || ''`),
  failedCommand: {
    runningLabel: commandRow(failedRunning, 'running')?.title,
    caretVisibleWhileRunning: failedRunning.caret,
    completedLabel: commandRow(failedDone, 'failed')?.title,
    detailsExpanded: failedExpanded.details.some(detail => detail.open && /(?:退出码|code)\s*7/i.test(detail.output)),
    finalSummaryVisible: failedDone.text.includes('非零退出码已被记录'),
  },
  explicit503Recovery: {
    runningLabel: commandRow(recoveryRunning, 'running')?.title,
    caretVisibleWhileRunning: recoveryRunning.caret,
    unsafeAutomaticReplayPrevented: recoveryStopped.stoppedObservedMs >= 1_500,
    stoppedObservedMs: recoveryStopped.stoppedObservedMs,
    checkpointRetainedBeforeContinue: Boolean(recoveryStopped.failure.resumeCheckpointId),
    server: recoveryQaState,
    processExecutions: recovered.processRows,
    completedWithoutContinueButton: !/Continue task|继续任务/.test(recovered.text),
    finalSummaryVisible: recovered.text.includes('最终总结均已保留'),
  },
  rateLimitedRecovery: {
    runningLabel: commandRow(rateRunning, 'running')?.title,
    caretVisibleWhileRunning: rateRunning.caret,
    failureCode: rateFailure.failure?.code || '',
    failureHttpStatus: rateFailure.failure?.httpStatus || null,
    checkpointRetainedBeforeResume: Boolean(rateFailure.resumeCheckpointId),
    unsafeAutomaticReplayPrevented: rateStopped.stoppedObservedMs >= 16_000,
    stoppedObservedMs: rateStopped.stoppedObservedMs,
    processExecutions: rateRecovered.processRows,
    server: rateQaState,
    completedWithoutContinueButton: !/Continue task|继续任务/.test(rateRecovered.text),
    finalSummaryVisible: rateRecovered.text.includes('429 已按可恢复状态处理'),
  },
};
report.pass = Object.values(report.failedCommand).every(Boolean)
  && report.explicit503Recovery.caretVisibleWhileRunning
  && report.explicit503Recovery.unsafeAutomaticReplayPrevented
  && report.explicit503Recovery.checkpointRetainedBeforeContinue
  && report.explicit503Recovery.server.unavailableResponses === 1
  && report.explicit503Recovery.server.processRequests === 1
  && report.explicit503Recovery.server.readRequests === 1
  && report.explicit503Recovery.processExecutions === 1
  && report.explicit503Recovery.completedWithoutContinueButton
  && report.explicit503Recovery.finalSummaryVisible
  && report.rateLimitedRecovery.caretVisibleWhileRunning
  && report.rateLimitedRecovery.failureHttpStatus === 429
  && report.rateLimitedRecovery.checkpointRetainedBeforeResume
  && report.rateLimitedRecovery.unsafeAutomaticReplayPrevented
  && report.rateLimitedRecovery.processExecutions === 1
  && report.rateLimitedRecovery.server.rateLimitResponses === 1
  && report.rateLimitedRecovery.server.processRequests === 1
  && report.rateLimitedRecovery.server.readRequests === 1
  && report.rateLimitedRecovery.completedWithoutContinueButton
  && report.rateLimitedRecovery.finalSummaryVisible;
console.log(JSON.stringify(report, undefined, 2));
await removeExactOfficialQaRoute({ evaluate, route: qaRoute });
socket.close();
if (!report.pass) process.exitCode = 1;
