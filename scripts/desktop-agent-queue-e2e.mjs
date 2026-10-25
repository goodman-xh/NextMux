#!/usr/bin/env node

import assert from 'node:assert/strict';

import { runIsolatedAgentQueueE2E } from './desktop-agent-queue-fixture.mjs';

await runIsolatedAgentQueueE2E({ name: 'agent-queue', qaDelayMs: 35 }, async ({ evaluate, route, send, verifyExactRoute, waitFor }) => {
  const stamp = Date.now();
  const currentMarker = `NM_QUEUE_CURRENT_${stamp}`;
  const autoMarker = `NM_QUEUE_AUTODRAIN_${stamp}`;
  const directMarker = `NM_QUEUE_DIRECT_${stamp}`;
  const overflowMarker = `NM_QUEUE_OVERFLOW_${stamp}`;
  const editedSuffix = 'EDITED_AT_QUEUE_TAIL';
  const replacementMarker = `NM_QUEUE_REPLACEMENT_${stamp}`;
  const fadeProbe = '队列长消息边界验证'.repeat(80);

  const readState = () => evaluate(`(() => {
    const normalize = node => (node?.innerText || '').trim().replace(/\\s+/g, ' ');
    const turns = [...document.querySelectorAll('.nmx-task-turn')];
    const turnFor = marker => turns.find(node => normalize(node).includes(marker));
    const queueNode = document.querySelector('.nmx-follow-up-queue');
    const textarea = document.querySelector('.nmx-composer textarea');
    const queueRect = queueNode?.getBoundingClientRect();
    const textareaRect = textarea?.getBoundingClientRect();
    const queueStyle = queueNode ? getComputedStyle(queueNode) : undefined;
    const choice = document.querySelector('.nmx-running-message-mode');
    const queue = [...document.querySelectorAll('.nmx-follow-up-queue > article')].map(node => {
      const content = node.querySelector(':scope > div');
      const prompt = content?.querySelector('strong');
      const direction = node.querySelector('.nmx-follow-up-direction');
      const remove = [...node.querySelectorAll(':scope > button')]
        .find(button => !button.matches('.nmx-follow-up-direction, .nmx-follow-up-more'));
      const more = node.querySelector('.nmx-follow-up-more');
      const contentRect = content?.getBoundingClientRect();
      const directionRect = direction?.getBoundingClientRect();
      const promptStyle = prompt ? getComputedStyle(prompt) : undefined;
      const contentStyle = content ? getComputedStyle(content) : undefined;
      return {
        text: normalize(prompt),
        fullText: normalize(node),
        model: normalize(node.querySelector('small')),
        oneLine: promptStyle?.whiteSpace === 'nowrap'
          && prompt && prompt.getBoundingClientRect().height <= (parseFloat(promptStyle.lineHeight) || 22) * 1.25,
        overflowing: Boolean(prompt && prompt.scrollWidth > prompt.clientWidth),
        maskImage: contentStyle?.maskImage || contentStyle?.webkitMaskImage || '',
        clearOfActions: Boolean(contentRect && directionRect && contentRect.right <= directionRect.left + 0.5),
        controlsVisible: Boolean(direction && remove && more),
      };
    });
    const turn = marker => {
      const node = turnFor(marker);
      return node ? {
        className: node.querySelector('.nmx-agent-message')?.className || '',
        text: normalize(node),
      } : null;
    };
    let stored = {};
    let restore = {};
    try { stored = JSON.parse(localStorage.getItem('nextmux.desktop.codingSessions.v1') || '{}'); } catch {}
    try { restore = JSON.parse(localStorage.getItem('nextmux.desktop.restoreState.v1') || '{}'); } catch {}
    const sessions = Array.isArray(stored) ? stored : Array.isArray(stored.sessions) ? stored.sessions : [];
    const activeSessionId = restore.activeCodingSessionId || stored.activeCodingSessionId || '';
    const activeSession = sessions.find(session => session?.id === activeSessionId);
    const persistedTurn = marker => {
      const record = activeSession?.turns?.find(candidate => candidate?.prompt?.includes(marker));
      return record ? { stage: record.stage || '', prompt: record.prompt || '', response: record.response || '' } : null;
    };
    return {
      running: Boolean(document.querySelector('.nmx-stop-glyph')),
      route: {
        modelId: document.querySelector('.nmx-route-button')?.getAttribute('data-model-id') || '',
        routeId: document.querySelector('.nmx-route-button')?.getAttribute('data-route-id') || '',
      },
      queue,
      queueCountLabel: normalize(document.querySelector('.nmx-follow-up-queue > header > span')),
      queueLayout: queueNode ? {
        scrollbarHidden: queueStyle?.scrollbarWidth === 'none',
        scrollable: queueNode.scrollHeight > queueNode.clientHeight,
        insideComposer: Boolean(queueNode.closest('.nmx-composer-wrap')),
        clearOfComposer: Boolean(queueRect && textareaRect && queueRect.bottom <= textareaRect.top + 0.5),
      } : null,
      current: turn(${JSON.stringify(currentMarker)}),
      auto: turn(${JSON.stringify(autoMarker)}),
      direct: turn(${JSON.stringify(directMarker)}),
      persistedCurrent: persistedTurn(${JSON.stringify(currentMarker)}),
      persistedAuto: persistedTurn(${JSON.stringify(autoMarker)}),
      persistedDirect: persistedTurn(${JSON.stringify(directMarker)}),
      attachmentError: normalize(document.querySelector('.nmx-attachment-error')),
      composerValue: textarea?.value || '',
      choice: {
        visible: Boolean(choice),
        adjustDisabled: choice?.querySelector('[data-running-message-action="adjust"]')?.disabled ?? null,
        queueDisabled: choice?.querySelector('[data-running-message-action="queue"]')?.disabled ?? null,
      },
      activityTexts: [...document.querySelectorAll('.nmx-agent-activity article')].map(normalize).filter(Boolean),
      processRunningActivity: [...document.querySelectorAll('.nmx-agent-activity article.is-running')]
        .some(node => /正在运行|Running|実行中|실행 중|Ejecutando|En cours|Wird ausgeführt|Em execução|Выполняется|قيد التشغيل|चल रहा है/i.test(normalize(node))),
    };
  })()`);

  const clickQueueControl = async (marker, control) => {
    const clicked = await evaluate(`(() => {
      const row = [...document.querySelectorAll('.nmx-follow-up-queue > article')]
        .find(node => (node.innerText || '').includes(${JSON.stringify(marker)}));
      if (!row) return false;
      const button = ${control === 'remove'
        ? `[...row.querySelectorAll(':scope > button')].find(candidate => !candidate.matches('.nmx-follow-up-direction, .nmx-follow-up-more'))`
        : `row.querySelector(${JSON.stringify(control === 'more' ? '.nmx-follow-up-more' : '.nmx-follow-up-direction')})`};
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    })()`);
    assert.equal(clicked, true, `${control} must be available for ${marker}`);
  };

  const chooseLater = async (prompt, queueLength) => {
    const offered = await waitFor(
      readState,
      state => state.choice.visible && !state.choice.queueDisabled
        && state.queue.length === queueLength && state.composerValue === prompt,
      5_000,
      `explicit later choice for queue length ${queueLength}`
    );
    assert.equal(offered.value.choice.adjustDisabled, false, 'text-only messages must also offer adjusting the current task');
    const clicked = await evaluate(`(() => {
      const button = document.querySelector('[data-running-message-action="queue"]:not(:disabled)');
      button?.click();
      return Boolean(button);
    })()`);
    assert.equal(clicked, true, 'Run later must be selectable');
  };

  const currentPrompt = `消息队列真实回归 ${currentMarker}。调用 process.run：command=node，args=-e 和 setTimeout(()=>console.log('${currentMarker}'),9000)。完成后简短回复。`;
  await send(currentPrompt);
  await waitFor(readState, state => state.running && state.current?.className.includes('is-running')
    && state.processRunningActivity, 45_000, 'current queue-owner process.run activity');
  await verifyExactRoute();

  const prompts = Array.from({ length: 20 }, (_, index) => {
    const ordinal = String(index + 1).padStart(2, '0');
    if (index === 0) {
      return `消息队列真实回归 ${autoMarker} FIFO_${ordinal} ${fadeProbe}。调用 process.run：command=node，args=-e 和 setTimeout(()=>console.log('${autoMarker}'),20000)。`;
    }
    if (index === 10) {
      return `消息队列真实回归 ${directMarker} FIFO_${ordinal}。调用 process.run：command=node，args=-e 和 setTimeout(()=>console.log('${directMarker}'),12000)。`;
    }
    return `NM_QUEUE_FIFO_${ordinal}_${stamp} 普通追加任务 ${ordinal}`;
  });
  for (let index = 0; index < prompts.length; index += 1) {
    await send(prompts[index]);
    await chooseLater(prompts[index], index);
    await waitFor(readState, state => state.queue.length === index + 1, 5_000, `FIFO queue length ${index + 1}`);
  }

  const fullQueue = await readState();
  assert.equal(fullQueue.queueCountLabel, '20', 'queue count must expose the 20-item capacity');
  assert.deepEqual(fullQueue.queue.map(item => item.text), prompts, 'normal appends must retain exact FIFO order');
  assert.equal(fullQueue.queue.every(item => item.controlsVisible), true, 'every queued user task must expose queue controls');
  assert.equal(fullQueue.queue.some(item => fullQueue.activityTexts.includes(item.text)), false,
    'tool activity must never be projected into the user follow-up queue');
  assert.equal(fullQueue.queue[0].oneLine, true, 'long queued prompts must stay on one line');
  assert.equal(fullQueue.queue[0].overflowing, true, 'the long queue fixture must actually overflow');
  assert.match(fullQueue.queue[0].maskImage, /gradient/i, 'overflowing queue text must fade before its controls');
  assert.equal(fullQueue.queue[0].clearOfActions, true, 'faded text must not cover queue controls');
  assert.deepEqual(fullQueue.queueLayout, {
    scrollbarHidden: true,
    scrollable: true,
    insideComposer: true,
    clearOfComposer: true,
  }, 'a 20-item queue must scroll without a visible scrollbar or composer overlap');

  await send(`NM_QUEUE_CAPACITY_21_${stamp} ${overflowMarker}`);
  await chooseLater(`NM_QUEUE_CAPACITY_21_${stamp} ${overflowMarker}`, 20);
  const capped = await waitFor(
    readState,
    state => state.queue.length === 20 && Boolean(state.attachmentError),
    5_000,
    '21st queue item rejection'
  );
  assert.equal(capped.value.queue.some(item => item.text.includes(overflowMarker)), false, 'the 21st item must not enter the queue');
  await evaluate(`(() => {
    const textarea = document.querySelector('.nmx-composer textarea');
    if (!(textarea instanceof HTMLTextAreaElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(textarea, '');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.nmx-attachment-error button')?.click();
    return true;
  })()`);

  const editedOriginal = prompts[1];
  await clickQueueControl(editedOriginal, 'more');
  const editClicked = await evaluate(`(() => {
    const button = document.querySelector('.nmx-follow-up-menu button:first-child');
    button?.click();
    return Boolean(button);
  })()`);
  assert.equal(editClicked, true, 'queued edit menu action must be available');
  await waitFor(readState, state => state.queue.length === 19 && state.composerValue === editedOriginal, 5_000, 'queued task returned to composer');
  const editedPrompt = `${editedOriginal} ${editedSuffix}`;
  await evaluate(`(() => {
    const textarea = document.querySelector('.nmx-composer textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(textarea, ${JSON.stringify(editedPrompt)});
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    return textarea.value;
  })()`);
  const editedSent = await evaluate(`(() => {
    const button = document.querySelector('.nmx-send-button:not(:disabled)');
    button?.click();
    return Boolean(button);
  })()`);
  assert.equal(editedSent, true, 'edited queued task must be sendable');
  await chooseLater(editedPrompt, 19);
  await waitFor(readState, state => state.queue.length === 20 && state.queue.at(-1)?.text === editedPrompt, 5_000, 'edited task appended at queue tail');

  const deletedPrompt = prompts[2];
  await clickQueueControl(deletedPrompt, 'remove');
  await waitFor(readState, state => state.queue.length === 19 && !state.queue.some(item => item.text === deletedPrompt), 5_000, 'queued task deletion');
  await send(replacementMarker);
  await chooseLater(replacementMarker, 19);
  const expectedBeforeDrain = [prompts[0], ...prompts.slice(3), editedPrompt, replacementMarker];
  const beforeDrain = await waitFor(readState, state => state.queue.length === 20, 5_000, 'queue restored to capacity after edit and delete');
  assert.deepEqual(beforeDrain.value.queue.map(item => item.text), expectedBeforeDrain,
    'edit must move one item to the tail, delete must remove only its target, and replacement must append last');

  const autoStarted = await waitFor(
    readState,
    state => state.persistedAuto?.stage === 'running'
      && state.queue.length === 19 && !state.queue.some(item => item.text.includes(autoMarker)),
    80_000,
    'oldest FIFO task to auto-send after the current task'
  );
  assert.deepEqual(autoStarted.value.queue.map(item => item.text), expectedBeforeDrain.slice(1),
    'automatic drain must remove only the oldest queued task');

  await clickQueueControl(directMarker, 'more');
  const directClicked = await evaluate(`(() => {
    const button = document.querySelector('.nmx-follow-up-menu button:last-child');
    button?.click();
    return Boolean(button);
  })()`);
  assert.equal(directClicked, true, 'direct send menu action must be available');
  const directStarted = await waitFor(
    readState,
    state => (state.persistedDirect?.stage === 'running' || state.direct?.className.includes('is-running'))
      && (['cancelled', 'complete'].includes(state.persistedAuto?.stage)
        || state.auto?.className.includes('is-cancelled') || state.auto?.className.includes('is-complete')),
    25_000,
    'direct-send target after the active queued task reaches a terminal stage'
  );
  const interruptedStage = directStarted.value.persistedAuto?.stage
    || (directStarted.value.auto?.className.includes('is-cancelled') ? 'cancelled'
      : directStarted.value.auto?.className.includes('is-complete') ? 'complete' : 'unknown');
  assert.equal(interruptedStage, 'cancelled',
    'Direct send must cancel the currently running queued task before starting its target');
  const directCompleted = await waitFor(
    readState,
    state => state.persistedDirect?.stage === 'complete',
    45_000,
    'direct queued task completion'
  );
  const final = directCompleted.value;
  assert.equal(final.route.routeId, route.routeId, 'the queue run must remain on its exact local QA connection');
  assert.equal(final.route.modelId, route.modelId, 'the queue run must remain on its exact QA model');
  assert.equal(final.queue.some(item => final.activityTexts.includes(item.text)), false,
    'tool events must remain absent from the user queue after automatic and direct drain');

  console.log(JSON.stringify({
    profileIsolation: true,
    exactRoute: { routeId: route.routeId, modelId: route.modelId, endpoint: route.endpoint },
    capacity: 20,
    fifoBeforeDrain: expectedBeforeDrain.map(prompt => prompt.slice(0, 80)),
    longQueueLayout: fullQueue.queueLayout,
    editedTaskMovedToTail: true,
    deletedTaskRemoved: true,
    overflowRejected: true,
    oldestAutoSentAfterMs: autoStarted.elapsedMs,
    directSendStartedAfterMs: directStarted.elapsedMs,
    directSendCompletedAfterMs: directCompleted.elapsedMs,
    toolEventsProjectedAsUserQueue: false,
    pass: true,
  }, null, 2));
});
