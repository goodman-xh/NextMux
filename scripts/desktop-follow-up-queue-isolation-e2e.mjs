#!/usr/bin/env node

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { runIsolatedAgentQueueE2E } from './desktop-agent-queue-fixture.mjs';
import { reloadDesktopDocument } from './desktop-cdp-reload.mjs';

await runIsolatedAgentQueueE2E({ name: 'queue-isolation', qaDelayMs: 40, isolatedWorkspace: true }, async ({ call, evaluate, root, route, verifyExactRoute, wait, waitFor }) => {
  const stamp = Date.now();
  const runMarker = `NM_QUEUE_OWNER_RUN_${stamp}`;
  const queuedMarker = `NM_QUEUE_OWNER_PENDING_${stamp}`;
  const sessionA = randomUUID();
  const sessionB = randomUUID();
  const titleA = `Queue owner A ${stamp}`;
  const titleB = `Queue owner B ${stamp}`;

  const reload = async () => {
    await reloadDesktopDocument({ call, evaluate, ignoreCache: true, timeoutMs: 35_000 });
    await waitFor(
      () => evaluate(`({
        ready: document.readyState,
        mounted: Boolean(document.querySelector('.nmx-desktop-widget'))
      })`),
      state => state.ready !== 'loading' && state.mounted,
      35_000,
      'mounted NextMux workbench after isolated reload'
    );
  };

  const readPersisted = () => evaluate(`(() => {
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem('nextmux.desktop.codingSessions.v1') || '{}'); } catch {}
    const sessions = Array.isArray(stored) ? stored : Array.isArray(stored.sessions) ? stored.sessions : [];
    const view = session => ({
      id: session?.id || '',
      permissionMode: session?.permissionMode || '',
      queue: (session?.followUpQueue || []).map(item => item.prompt),
      turns: (session?.turns || []).map(turn => ({ prompt: turn.prompt, stage: turn.stage, permissionMode: turn.permissionMode, response: turn.response || '', failure: turn.failure })),
    });
    return {
      a: view(sessions.find(session => session?.id === ${JSON.stringify(sessionA)})),
      b: view(sessions.find(session => session?.id === ${JSON.stringify(sessionB)})),
    };
  })()`);
  const readUi = () => evaluate(`(() => {
    const normalize = node => (node?.innerText || '').trim().replace(/\\s+/g, ' ');
    return {
      current: normalize(document.querySelector('.nmx-session-row.is-current .nmx-session-open span')),
      debug: (() => { const w = window.theia?.container?.get([...window.theia.container._bindingDictionary._map.keys()].find(k => typeof k === 'function' && typeof k.prototype?.getWidgets === 'function' && typeof k.prototype?.getOrCreateWidget === 'function'))?.getWidgets('nextmux.desktop.widget')[0]; return w ? { stage: w.agentStage, error: w.agentError, attachmentError: w.attachmentError, ready: w.conversationHistoryReady(), submitting: w.conversationAgentRun().submitting, prompt: w.prompt, skill: w.skillService.state, notifications: w.notifications?.slice(-2) } : undefined; })(),
      queue: [...document.querySelectorAll('.nmx-follow-up-queue > article')]
        .map(node => normalize(node.querySelector('strong'))),
      taskText: normalize(document.querySelector('.nmx-task-view')),
      running: Boolean(document.querySelector('.nmx-stop-glyph')),
      activityTexts: [...document.querySelectorAll('.nmx-agent-activity article')].map(normalize).filter(Boolean),
      route: {
        modelId: document.querySelector('.nmx-route-button')?.getAttribute('data-model-id') || '',
        routeId: document.querySelector('.nmx-route-button')?.getAttribute('data-route-id') || '',
      },
    };
  })()`);
  const openSession = async title => {
    const clicked = await evaluate(`(() => {
      const button = [...document.querySelectorAll('.nmx-session-open')]
        .find(candidate => candidate.querySelector('span')?.textContent === ${JSON.stringify(title)});
      button?.click();
      return Boolean(button);
    })()`);
    assert.equal(clicked, true, `conversation ${title} must be present`);
    await waitFor(readUi, state => state.current === title, 8_000, `${title} active conversation`);
  };
  // Exercise the actual widget submission lifecycle with a local mock provider.
  // This is an integration check, not proof of native pointer dispatch; the
  // separate real-provider permission/edit UI evidence covers those controls.
  const send = async text => {
    const sent = await evaluate(`(() => {
      const w=window.theia.container.get([...window.theia.container._bindingDictionary._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.getWidgets==='function'&&typeof k.prototype?.getOrCreateWidget==='function')).getWidgets('nextmux.desktop.widget')[0];
      if (!w || !w.conversationHistoryReady()) return false;
      w.setComposerPrompt(${JSON.stringify(text)});
      w.persistComposerDraft();
      void w.submitPrompt('coding');
      return true;
    })()`);
    assert.equal(sent, true, 'active conversation submission must be available');
  };

  const now = Date.now();
  await evaluate(`(() => {
    const common = {
      workspacePath: ${JSON.stringify(root)},
      turns: [],
      browsers: [],
      pinned: false,
      routeId: ${JSON.stringify(route.routeId)},
      relayKey: ${JSON.stringify(route.relayKey)},
      modelId: ${JSON.stringify(route.modelId)},
      permissionMode: 'full_access',
      createdAt: ${now},
      updatedAt: ${now},
    };
    const sessions = [{
      ...common,
      id: ${JSON.stringify(sessionA)},
      title: ${JSON.stringify(titleA)},
      followUpQueue: [],
    }, {
      ...common,
      id: ${JSON.stringify(sessionB)},
      title: ${JSON.stringify(titleB)},
      followUpQueue: [{
        id: 'queue-owned-task',
        sessionId: ${JSON.stringify(sessionB)},
        source: 'user',
        prompt: ${JSON.stringify(queuedMarker)},
        workbench: 'coding',
        routeId: ${JSON.stringify(route.routeId)},
        relayKey: ${JSON.stringify(route.relayKey)},
        modelLabel: ${JSON.stringify(route.providerModelId)},
        permissionMode: 'full_access',
        attachments: [],
        createdAt: ${now},
      }],
    }];
    localStorage.setItem('nextmux.desktop.codingSessions.v1', JSON.stringify(sessions));
    localStorage.setItem('nextmux.desktop.restoreState.v1', JSON.stringify({
      version: 1,
      section: 'coding',
      workspace: ${JSON.stringify(root)},
      codingPanel: 'thread',
      activeCodingSessionId: ${JSON.stringify(sessionA)},
      newConversation: false,
      settingsPanel: 'profile',
      billingTab: 'usage',
      modelCenterView: 'all',
      modelCapabilityFilter: 'all',
      comicView: 'storyboard',
    }));
    sessionStorage.clear();
    return true;
  })()`);
  await reload();
  const restored = await waitFor(readUi, state => state.current === titleA, 20_000, 'owner A after isolated reload');
  await verifyExactRoute();
  assert.deepEqual(restored.value.route, { modelId: route.modelId, routeId: route.routeId },
    'reloaded sessions must retain the exact local QA route');

  await send(`消息队列真实回归 ${runMarker}。调用 process.run：command=node，args=-e 和 setTimeout(()=>console.log('${runMarker}'),12000)。完成后简短回复。`);
  await waitFor(
    readUi,
    state => state.running && state.taskText.includes(runMarker),
    35_000,
    'owner A running task'
  );
  await openSession(titleB);
  const isolatedWhileAIsRunning = await waitFor(
    async () => ({ ui: await readUi(), persisted: await readPersisted() }),
    state => state.ui.queue.length === 1
      && state.ui.queue[0] === queuedMarker
      && state.persisted.a.turns.some(turn => turn.prompt.includes(runMarker) && turn.stage === 'running')
      && state.persisted.b.turns.length === 0,
    8_000,
    'owner B queue isolated from owner A running tool'
  );
  assert.equal(isolatedWhileAIsRunning.value.ui.taskText.includes(runMarker), false,
    'owner A turn and tool activity must not render in owner B conversation');
  assert.equal(isolatedWhileAIsRunning.value.ui.queue.some(item => isolatedWhileAIsRunning.value.ui.activityTexts.includes(item)), false,
    'owner A tool events must not become owner B queued user tasks');

  const menuOpened = await evaluate(`(() => {
    const button = document.querySelector('.nmx-follow-up-queue .nmx-follow-up-more');
    button?.click();
    return Boolean(button);
  })()`);
  assert.equal(menuOpened, true, 'owner B queued task menu must open');
  const directClicked = await evaluate(`(() => {
    const button = document.querySelector('.nmx-follow-up-menu button:last-child');
    button?.click();
    return Boolean(button);
  })()`);
  assert.equal(directClicked, true, 'owner B direct-send action must be available');
  const ownerBStarted = await waitFor(
    async () => ({ ui: await readUi(), persisted: await readPersisted() }),
    state => state.persisted.a.turns.some(turn => turn.prompt.includes(runMarker) && turn.stage === 'running')
      && state.persisted.b.turns.some(turn => turn.prompt === queuedMarker && ['running', 'complete'].includes(turn.stage))
      && state.persisted.b.queue.length === 0,
    10_000,
    'owner B starts independently while owner A is still running'
  );
  assert.equal(ownerBStarted.value.ui.current, titleB, 'direct queued task must start in its owning conversation');
  assert.equal(ownerBStarted.value.ui.taskText.includes(runMarker), false, 'owner B must not inherit owner A turn content');

  const ownerBCompleted = await waitFor(
    readPersisted,
    state => state.b.turns.some(turn => turn.prompt === queuedMarker && turn.stage === 'complete')
      && state.b.queue.length === 0,
    45_000,
    'owner B direct task completion'
  );
  const ownerACompleted = await waitFor(
    readPersisted,
    state => state.a.turns.some(turn => turn.prompt.includes(runMarker) && turn.stage === 'complete'),
    70_000,
    'owner A completion without cross-session interruption'
  );
  await openSession(titleA);
  const ownerAFinalUi = (await waitFor(
    readUi,
    state => state.current === titleA && state.taskText.includes(runMarker),
    8_000,
    'owner A virtualized history after returning from owner B'
  )).value;
  assert.equal(ownerAFinalUi.taskText.includes(queuedMarker), false, 'owner B prompt must never render in owner A history');
  assert.equal(ownerAFinalUi.taskText.includes(runMarker), true, 'owner A history must retain its own completed run');

  // Real UI: a saved next-task permission must not rewrite the running task.
  const editMarker = `NM_RUNNING_EDIT_${stamp}`;
  const editedMarker = `NM_EDITED_REPLY_${stamp}`;
  await send(`消息队列真实回归 ${editMarker}。调用 process.run：command=node，args=-e 和 setTimeout(()=>console.log('${editMarker}'),30000)。完成后简短回复。`);
  await waitFor(readPersisted, state => state.a.turns.some(turn => turn.prompt.includes(editMarker) && turn.stage === 'running'), 20_000, 'running turn to edit');
  const permissionEnabled = await evaluate(`(() => {
    const button = document.querySelector('.nmx-permission-button');
    if (!button || button.disabled) return false;
    button.click(); return true;
  })()`);
  assert.equal(permissionEnabled, true, 'running task permission selector remains available');
  await waitFor(() => evaluate(`document.querySelectorAll('.nmx-permission-popover > button').length`), count => count === 3, 5_000, 'permission choices');
  await evaluate(`document.querySelector('.nmx-permission-popover > button')?.click()`);
  const permissions = (await waitFor(readPersisted, state => state.a.permissionMode === 'read_only', 5_000, 'read-only next task preference')).value;
  assert.equal(permissions.a.turns.find(turn => turn.prompt.includes(editMarker)).permissionMode, 'full_access');
  const editorOpened = await evaluate(`(() => {
    const turn = [...document.querySelectorAll('.nmx-task-turn')].find(node => node.innerText.includes(${JSON.stringify(editMarker)}));
    const button = turn?.querySelector('[data-message-action="edit"]');
    if (!button || button.disabled) return false;
    button.click(); return true;
  })()`);
  assert.equal(editorOpened, true, 'running sent message has an enabled edit button');
  await waitFor(() => evaluate(`Boolean(document.querySelector('.nmx-user-message-editor textarea'))`), Boolean, 5_000, 'message editor');
  await evaluate(`(() => {const area = document.querySelector('.nmx-user-message-editor textarea');area.focus();area.select();})()`);
  await call('Input.insertText', { text: `${editedMarker} 请简短回复，不要调用 process.run。` });
  assert.equal((await readPersisted()).a.turns.find(turn => turn.prompt.includes(editMarker)).stage, 'running', 'typing alone does not stop the original run');
  await evaluate(`document.querySelector('.nmx-user-message-editor .is-primary')?.click()`);
  await waitFor(() => evaluate(`Boolean(document.querySelector('.nmx-turn-edit-dialog .nmx-branch-replace:not(:disabled)'))`), Boolean, 8_000, 'replace edited message confirmation');
  const editStartedAt = Date.now();
  await evaluate(`document.querySelector('.nmx-turn-edit-dialog .nmx-branch-replace')?.click()`);
  const edited = await waitFor(readPersisted, state => state.a.turns.some(turn => turn.prompt.includes(editedMarker) && turn.stage === 'complete'), 25_000, 'stop original and finish edited message');
  assert.equal(edited.value.a.turns.some(turn => turn.prompt.includes(editMarker)), false, 'replace removes original turn only after stop acknowledgement');
  assert.equal(edited.value.a.turns.find(turn => turn.prompt.includes(editedMarker)).permissionMode, 'read_only', 'replacement uses the saved current conversation permission ceiling');
  assert.equal(edited.value.b.turns.at(-1).stage, 'complete', 'editing A keeps B intact');
  const editCompletionMs = Date.now() - editStartedAt;

  console.log(JSON.stringify({
    profileIsolation: true,
    submissionMethod: 'actual widget methods; not a native pointer-send assertion',
    provider: 'isolated localhost fixture; no paid request',
    exactRoute: { routeId: route.routeId, modelId: route.modelId, endpoint: route.endpoint },
    ownerACompletedAfterMs: ownerACompleted.elapsedMs,
    ownerBStartedAfterMs: ownerBStarted.elapsedMs,
    ownerBCompletedAfterMs: ownerBCompleted.elapsedMs,
    independentConversationDispatch: true,
    runningPermissionChangedForNextTaskOnly: true,
    editStoppedAndJoinedOriginalBeforeResubmit: true,
    editCompletionMs,
    ownerBStartedBeforeOwnerACompleted: true,
    directSendDidNotCancelOtherConversation: true,
    toolEventsProjectedAsOtherConversationQueue: false,
    final: ownerBCompleted.value,
    pass: true,
  }, null, 2));
});
