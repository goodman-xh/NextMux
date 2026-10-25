#!/usr/bin/env node

import { ensureDesktopFullAccess } from './desktop-e2e-permission.mjs';
import { connectToNextMuxWorkbench } from './desktop-attachment-file-e2e-harness.mjs';
import {
  ensureExactOfficialQaRoute,
  officialQaRouteConfig,
  removeExactOfficialQaRoute,
  verifyExactQaComposerRoute
} from './desktop-official-qa-route.mjs';

const cdpPort = process.env.NEXTMUX_CDP_PORT || '9222';
const mode = process.argv.includes('--cancel') ? 'cancel' : 'progress';
const marker = `NM_${mode.toUpperCase()}_E2E_${Date.now()}`;
const { socket, call, evaluate } = await connectToNextMuxWorkbench(cdpPort);
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const waitFor = async (read, predicate, timeoutMs, label) => {
  const startedAt = Date.now();
  let value;
  while (Date.now() - startedAt < timeoutMs) {
    value = await read();
    if (predicate(value)) return { value, elapsedMs: Date.now() - startedAt };
    await wait(200);
  }
  throw new Error(`Timed out waiting for ${label}. Last value: ${JSON.stringify(value)}`);
};

await Promise.all([call('Runtime.enable'), call('Page.enable')]);
await call('Page.bringToFront');
const qaRoute = await ensureExactOfficialQaRoute({ evaluate, config: officialQaRouteConfig() });
await ensureDesktopFullAccess(evaluate);
const composer = await evaluate(`(() => {
  const textarea = document.querySelector('.nmx-composer textarea:not(:disabled)');
  if (!textarea || document.querySelector('.nmx-stop-glyph')) return false;
  textarea.focus();
  textarea.select?.();
  return true;
})()`);
if (!composer) throw new Error('The current NextMux conversation is not ready for a new task.');

const delay = mode === 'cancel' ? 30_000 : 1_500;
const prompt = `请在当前项目执行一次 NextMux ${mode === 'cancel' ? '可取消' : '进度可见'}生命周期检查。先用一句自然语言说明正在做什么，再调用 process.run：command=node，args=-e 和 setTimeout(()=>console.log('${marker}'),${delay})。${mode === 'cancel' ? '如果任务被停止，请立即结束当前操作。' : '完成后简要总结检查结果。'}`;
await call('Input.insertText', { text: prompt });
await evaluate(`document.querySelector('.nmx-send-button')?.click()`);
await verifyExactQaComposerRoute(evaluate, qaRoute);

const readTurn = () => evaluate(`(() => {
  const marker = ${JSON.stringify(marker)};
  const turn = [...document.querySelectorAll('.nmx-task-turn')].find(node => (node.innerText || '').includes(marker));
  return {
    running: Boolean(document.querySelector('.nmx-stop-glyph')),
    text: turn?.innerText || '',
    className: turn?.className || '',
    stateClassName: turn?.querySelector('.nmx-agent-message')?.className || '',
    naturalProgress: Boolean(turn && [...turn.querySelectorAll('.nmx-agent-narration')]
      .some(node => (node.textContent || '').trim().length > 0 && !/Retrying|重试/.test(node.textContent || ''))),
    toolRunning: Boolean(turn && [...turn.querySelectorAll('.nmx-agent-activity article.is-running')]
      .some(node => /正在运行|running|実行中|실행 중|ejecutando|en cours|wird ausgeführt|em execução|выполняется|قيد التشغيل/i.test(node.innerText || ''))),
    commandRows: [...(turn?.querySelectorAll('.nmx-agent-operation-toggle') || [])].map(node => {
      const summary = node.querySelector('summary');
      const terminal = node.querySelector('.nmx-agent-command-terminal');
      const commandLine = terminal?.querySelector('.nmx-agent-command-line');
      const commandCode = commandLine?.querySelector('code');
      const host = terminal?.querySelector('.nmx-agent-command-xterm');
      const viewport = host?.querySelector('.xterm-viewport');
      const command = host?.getAttribute('aria-label') || '';
      const output = [...(host?.querySelectorAll('.xterm-rows > div') || [])]
        .map(row => row.textContent || '').join('\\n');
      return {
        articleClass: node.closest('article')?.className || '',
        collapsed: (summary?.textContent || '').trim().replace(/\s+/g, ' '),
        command,
        output,
        open: node.hasAttribute('open'),
        xtermMounted: Boolean(host?.querySelector('.xterm')),
        commandWhiteSpace: commandLine ? getComputedStyle(commandLine).whiteSpace : '',
        commandMaskImage: commandCode
          ? (getComputedStyle(commandCode).maskImage || getComputedStyle(commandCode).webkitMaskImage || '')
          : '',
        terminalBackground: viewport ? getComputedStyle(viewport).backgroundColor
          : terminal ? getComputedStyle(terminal).backgroundColor : '',
        summaryMaskImage: summary?.querySelector('strong')
          ? (getComputedStyle(summary.querySelector('strong')).maskImage || getComputedStyle(summary.querySelector('strong')).webkitMaskImage || '')
          : ''
      };
    })
  };
})()`);

const progress = await waitFor(readTurn, state => state.running && state.naturalProgress, 45_000, 'natural-language progress');
const tool = await waitFor(readTurn, state => state.running && state.toolRunning, 20_000, 'running tool event');
let stoppedAfterMs;
let expandedCommandState;
if (mode === 'cancel') {
  const stopStartedAt = Date.now();
  await evaluate(`document.querySelector('.nmx-send-button')?.click()`);
  await waitFor(readTurn, state => !state.running && /Task stopped|任务已停止|已停止当前任务/i.test(state.text), 15_000, 'cancelled task state');
  stoppedAfterMs = Date.now() - stopStartedAt;
} else {
  await waitFor(readTurn, state => !state.running && state.stateClassName.includes('is-complete'), 45_000, 'completed task state');
  await evaluate(`(() => {
    const marker = ${JSON.stringify(marker)};
    const turn = [...document.querySelectorAll('.nmx-task-turn')].find(node => (node.innerText || '').includes(marker));
    const row = [...(turn?.querySelectorAll('.nmx-agent-operation-toggle') || [])]
      .find(node => /node/i.test(node.querySelector('summary')?.textContent || ''));
    const summary = row?.querySelector('summary');
    if (summary && !row.hasAttribute('open')) summary.click();
    return Boolean(summary);
  })()`);
  expandedCommandState = (await waitFor(readTurn, state => state.commandRows.some(row => row.open && row.command.includes(marker)
    && row.output.includes(marker) && row.xtermMounted), 5_000, 'expanded exact command line')).value;
}

const final = await readTurn();
const markerOccurrences = final.text.split(marker).length - 1;
const cancelledToolProducedOutput = mode === 'cancel' && /process\.run\s*·\s*\d+\s*ms/i.test(final.text);
const commandRow = final.commandRows.find(row => row.command.includes(marker) && row.output.includes(marker))
  || expandedCommandState?.commandRows.find(row => row.command.includes(marker) && row.output.includes(marker))
  || final.commandRows.find(row => row.command.includes(marker))
  || final.commandRows.find(row => /node/i.test(row.collapsed));
const exactCommandPresentation = mode === 'cancel' || Boolean(commandRow
  && /执行了\s+node|Ran\s+node/i.test(commandRow.collapsed)
  && !/退出码|exit code|耗时|duration/i.test(commandRow.collapsed)
  && /^node\s+-e\s+/.test(commandRow.command)
  && commandRow.command.includes(marker)
  && commandRow.output.includes(marker)
  && commandRow.xtermMounted
  && commandRow.commandWhiteSpace === 'nowrap'
  && commandRow.commandMaskImage && commandRow.commandMaskImage !== 'none'
  && commandRow.summaryMaskImage && commandRow.summaryMaskImage !== 'none'
  && commandRow.terminalBackground && commandRow.terminalBackground !== 'rgba(0, 0, 0, 0)');
const interruptedCommandSettled = mode !== 'cancel' || Boolean(commandRow
  && /已终止|Stopped|停止|중지|detuvo|arrêté|beendet|interrompido|Остановлено|إيقاف|रोका/i.test(commandRow.collapsed)
  && commandRow.articleClass.includes('is-stopped')
  && !commandRow.articleClass.includes('is-running'));
const internalProbeHidden = !commandRow || !/__nextmux|NextMuxStart;|\]777;NextMux;|Console\]::Write/i.test(commandRow.output);
const report = {
  mode,
  marker,
  naturalProgressVisible: progress.value.naturalProgress,
  progressVisibleAfterMs: progress.elapsedMs,
  toolRunningVisible: tool.value.toolRunning,
  toolVisibleAfterMs: tool.elapsedMs,
  stoppedAfterMs,
  finalState: final.stateClassName.includes('is-cancelled') ? 'cancelled'
    : final.stateClassName.includes('is-complete') ? 'complete' : 'unknown',
  markerOccurrences,
  cancelledToolProducedOutput,
  commandActivity: commandRow,
  exactCommandPresentation,
  interruptedCommandSettled,
  internalProbeHidden,
  activityPreserved: mode !== 'cancel' || final.naturalProgress,
  pass: final.stateClassName.includes(mode === 'cancel' ? 'is-cancelled' : 'is-complete')
    && progress.value.naturalProgress
    && tool.value.toolRunning
    && exactCommandPresentation
    && interruptedCommandSettled
    && internalProbeHidden
    && (mode !== 'cancel' || !cancelledToolProducedOutput && final.naturalProgress)
};
console.log(JSON.stringify(report, undefined, 2));
await removeExactOfficialQaRoute({ evaluate, route: qaRoute });
socket.close();
if (!report.pass) process.exitCode = 1;
