#!/usr/bin/env node

import assert from 'node:assert/strict';

import { runIsolatedAgentQueueE2E } from './desktop-agent-queue-fixture.mjs';

await runIsolatedAgentQueueE2E({ name: 'agent-steering', qaDelayMs: 45 }, async ({ evaluate, route, send, verifyExactRoute, waitFor }) => {
  const stamp = Date.now();
  const runMarker = `NM_STEERING_RUN_${stamp}`;
  const directionMarker = `NM_STEERING_DIRECTION_${stamp}`;

  const readState = () => evaluate(`(() => {
    const normalize = node => (node?.innerText || '').trim().replace(/\\s+/g, ' ');
    const turn = [...document.querySelectorAll('.nmx-task-turn')]
      .find(node => normalize(node).includes(${JSON.stringify(runMarker)}));
    const steering = turn && [...turn.querySelectorAll('.nmx-steering-message')]
      .find(node => normalize(node).includes(${JSON.stringify(directionMarker)}));
    const queue = [...document.querySelectorAll('.nmx-follow-up-queue > article')]
      .map(node => normalize(node.querySelector('strong')));
    const activityTexts = [...document.querySelectorAll('.nmx-agent-activity article')]
      .map(normalize).filter(Boolean);
    const textarea = document.querySelector('.nmx-composer textarea');
    const choice = document.querySelector('.nmx-running-message-mode');
    const adjustChoice = choice?.querySelector('[data-running-message-action="adjust"]');
    const queueChoice = choice?.querySelector('[data-running-message-action="queue"]');
    return {
      running: Boolean(turn?.querySelector('.nmx-agent-message.is-running')),
      stopVisible: Boolean(document.querySelector('.nmx-stop-glyph')),
      composerEditable: textarea instanceof HTMLTextAreaElement && !textarea.disabled,
      composerValue: textarea instanceof HTMLTextAreaElement ? textarea.value : '',
      choice: {
        visible: Boolean(choice),
        adjustDisabled: adjustChoice instanceof HTMLButtonElement ? adjustChoice.disabled : null,
        queueDisabled: queueChoice instanceof HTMLButtonElement ? queueChoice.disabled : null,
      },
      finalActions: document.querySelectorAll('.nmx-send-button').length,
      queue,
      turnClass: turn?.querySelector('.nmx-agent-message')?.className || '',
      turnText: normalize(turn),
      steeringText: normalize(steering),
      steeringApplied: Boolean(steering?.querySelector('.codicon-check')),
      activityTexts,
      route: {
        modelId: document.querySelector('.nmx-route-button')?.getAttribute('data-model-id') || '',
        routeId: document.querySelector('.nmx-route-button')?.getAttribute('data-route-id') || '',
      },
    };
  })()`);

  await send(`运行中调整方向真实回归 ${runMarker}。调用 process.run：command=node，args=-e 和 setTimeout(()=>console.log('${runMarker}'),7000)。命令完成后按最新方向总结。`);
  const running = await waitFor(
    readState,
    state => state.running && state.composerEditable && state.turnClass.includes('is-running'),
    45_000,
    'running tool with an editable composer'
  );
  await verifyExactRoute();
  assert.equal(running.value.route.routeId, route.routeId, 'the running task must use the exact local QA route');
  assert.equal(running.value.route.modelId, route.modelId, 'the running task must use the exact local QA model');

  await send(`请把当前任务的最终方向调整为 ${directionMarker}，继续当前命令，不要创建新的独立任务。`);
  const offered = await waitFor(
    readState,
    state => state.running && state.choice.visible && !state.choice.adjustDisabled
      && !state.choice.queueDisabled && state.queue.length === 0
      && state.composerValue.includes(directionMarker),
    5_000,
    'explicit running-message action choice'
  );
  assert.equal(offered.value.finalActions, 1, 'running composer must expose only one stop-or-send final action');
  assert.equal(offered.value.stopVisible, false, 'the stop glyph must not coexist with the running-message send choice');

  const cancelled = await evaluate(`(() => {
    const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
    return target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  })()`);
  assert.equal(cancelled, false, 'Escape must be consumed by the running-message choice');
  await waitFor(
    readState,
    state => state.running && !state.choice.visible && state.queue.length === 0
      && state.composerValue.includes(directionMarker),
    5_000,
    'choice cancellation without draft loss'
  );

  const reopened = await evaluate(`(() => {
    const button = document.querySelector('.nmx-send-button:not(:disabled)');
    button?.click();
    return Boolean(button);
  })()`);
  assert.equal(reopened, true, 'the preserved draft must reopen the action choice');
  await waitFor(readState, state => state.choice.visible && !state.choice.adjustDisabled, 5_000, 'reopened action choice');

  const adjusted = await evaluate(`(() => {
    const button = document.querySelector('[data-running-message-action="adjust"]:not(:disabled)');
    button?.click();
    return Boolean(button);
  })()`);
  assert.equal(adjusted, true, 'Adjust current task must be enabled for a text-only running message');

  const accepted = await waitFor(
    readState,
    state => state.running && state.queue.length === 0 && state.steeringText.includes(directionMarker),
    10_000,
    'direction accepted without interrupting the current run'
  );
  assert.equal(accepted.value.turnClass.includes('is-running'), true, 'direction acceptance must keep the original turn running');
  assert.equal(accepted.value.queue.length, 0, 'accepted direction must leave the user queue exactly once');

  const completed = await waitFor(
    readState,
    state => !state.running && state.turnClass.includes('is-complete'),
    70_000,
    'steered task completion'
  );
  const applied = await waitFor(readState, state => state.steeringApplied, 10_000, 'applied direction status');
  const final = applied.value;
  assert.equal(final.steeringText.includes(directionMarker), true, 'accepted direction must remain visible in durable turn history');
  assert.equal(final.steeringApplied, true, 'direction must transition from accepted to applied');
  assert.equal(final.queue.length, 0, 'tool events and steering events must not reappear as queued user work');
  assert.equal(final.queue.some(item => final.activityTexts.includes(item)), false,
    'tool activity must remain isolated from the follow-up queue after completion');

  console.log(JSON.stringify({
    profileIsolation: true,
    exactRoute: { routeId: route.routeId, modelId: route.modelId, endpoint: route.endpoint },
    composerEditableWhileRunning: running.value.composerEditable,
    explicitChoiceBeforeDispatch: true,
    escapePreservedDraft: true,
    acceptedWithoutInterruptionAfterMs: accepted.elapsedMs,
    completedAfterMs: completed.elapsedMs,
    appliedAfterMs: applied.elapsedMs,
    durableDirectionMarker: directionMarker,
    toolEventsProjectedAsUserQueue: false,
    pass: true,
  }, null, 2));
});
