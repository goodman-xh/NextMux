#!/usr/bin/env node

import {
  ensureExactOfficialQaRoute,
  officialQaRouteConfig,
  removeExactOfficialQaRoute,
  verifyExactQaComposerRoute,
} from './desktop-official-qa-route.mjs';

const cdpPort = process.env.NEXTMUX_CDP_PORT || '9222';
const stamp = Date.now();
const requestMarker = `NM_LONG_PASTE_E2E_REQUEST_${stamp}`;
const bodyMarker = `NM_LONG_PASTE_E2E_BODY_${stamp}`;
const longBody = `${bodyMarker}\n${'bounded long-paste payload '.repeat(900)}`;

const targets = await fetch(`http://127.0.0.1:${cdpPort}/json`).then(response => response.json());
const page = targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl);
if (!page) throw new Error(`No Electron page is available on CDP port ${cdpPort}.`);

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let sequence = 0;
const pending = new Map();
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const promise = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) promise.reject(new Error(message.error.message));
  else promise.resolve(message.result);
});
const call = (method, params = {}) => {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
};
const evaluate = async expression => {
  const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  return response.result?.value;
};
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const waitFor = async (read, predicate, timeoutMs, label) => {
  const startedAt = Date.now();
  let value;
  while (Date.now() - startedAt < timeoutMs) {
    value = await read();
    if (predicate(value)) return { value, elapsedMs: Date.now() - startedAt };
    await wait(120);
  }
  throw new Error(`Timed out waiting for ${label}. Last value: ${JSON.stringify(value)}`);
};

const state = () => evaluate(`(() => {
  const text = node => (node?.innerText || '').trim().replace(/\\s+/g, ' ');
  const textarea = document.querySelector('.nmx-composer textarea');
  const chips = [...document.querySelectorAll('.nmx-pasted-text-chip')].map(node => ({
    text: text(node),
    title: node.getAttribute('title') || ''
  }));
  const turn = [...document.querySelectorAll('.nmx-task-turn')]
    .find(node => text(node).includes(${JSON.stringify(requestMarker)}));
  let draft;
  try {
    const mirror = JSON.parse(localStorage.getItem('nextmux.desktop.codingSessions.v1') || '{}');
    const sessions = Array.isArray(mirror.sessions) ? mirror.sessions : [];
    draft = sessions.find(session => typeof session.draftPrompt === 'string'
      && session.draftPrompt.includes('pasted-text-'));
  } catch { draft = undefined; }
  return {
    running: Boolean(document.querySelector('.nmx-send-button.is-stop')),
    route: text(document.querySelector('.nmx-route-button')),
    prompt: textarea?.value || '',
    selectionStart: textarea?.selectionStart ?? -1,
    chips,
    sendDisabled: Boolean(document.querySelector('.nmx-send-button')?.disabled),
    routeDiagnostics: {
      selectedModel: localStorage.getItem('nextmux.desktop.selectedModel.coding.v1') || '',
      selectedRoute: localStorage.getItem('nextmux.desktop.route.coding') || '',
      activeRelay: localStorage.getItem('nextmux.desktop.activeRelay.v1') || '',
      availableModelIds: [...document.querySelectorAll('.nmx-model-option')]
        .map(node => node.getAttribute('data-model-id') || '').filter(Boolean),
      session: (() => {
        try {
          const mirror = JSON.parse(localStorage.getItem('nextmux.desktop.codingSessions.v1') || '{}');
          const sessions = Array.isArray(mirror.sessions) ? mirror.sessions : [];
          const activeId = JSON.parse(sessionStorage.getItem('nextmux.desktop.reloadState.v1') || '{}').activeCodingSessionId || '';
          const active = sessions.find(candidate => candidate.id === activeId) || sessions[0];
          return active ? { id: active.id || '', routeId: active.routeId || '', relayKey: active.relayKey || '' } : null;
        } catch { return null; }
      })()
    },
    draft: draft ? {
      prompt: draft.draftPrompt || '',
      references: draft.draftPastedTextReferences || '',
      workspacePath: draft.workspacePath || ''
    } : null,
    turn: turn ? {
      className: turn.querySelector('.nmx-agent-message')?.className || '',
      response: text(turn.querySelector('.nmx-gateway-content')),
      prompt: text(turn.querySelector('.nmx-user-message')),
      attachments: [...turn.querySelectorAll('.nmx-turn-attachments > *')].map(text)
    } : null,
    editing: Boolean(document.querySelector('.nmx-user-message-editor textarea')),
    editDialog: Boolean(document.querySelector('.nmx-turn-edit-dialog'))
  };
})()`);

await Promise.all([call('Runtime.enable'), call('Page.enable')]);
const qaRoute = await ensureExactOfficialQaRoute({
  evaluate,
  environment: process.env,
  config: officialQaRouteConfig(process.env, `long-paste-${stamp}`),
});
const initial = await state();
if (initial.running || initial.prompt || initial.chips.length) {
  throw new Error(`The current NextMux composer must be idle and empty: ${JSON.stringify(initial)}`);
}

const prefix = `First issue for ${requestMarker}: `;
const suffix = '\nSecond issue stays after the attachment.';
await evaluate(`(() => {
  const textarea = document.querySelector('.nmx-composer textarea');
  if (!textarea) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(textarea, ${JSON.stringify(prefix + suffix)});
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await waitFor(state, value => value.prompt === prefix + suffix, 4_000, 'committed composer input');
await evaluate(`(() => {
  const textarea = document.querySelector('.nmx-composer textarea');
  if (!textarea) return false;
  textarea.focus();
  textarea.setSelectionRange(${prefix.length}, ${prefix.length});
  return textarea.selectionStart === ${prefix.length};
})()`);
await wait(80);

const pasted = await evaluate(`(() => {
  const textarea = document.querySelector('.nmx-composer textarea');
  if (!textarea) return false;
  const transfer = new DataTransfer();
  transfer.setData('text/plain', ${JSON.stringify(longBody)});
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: transfer });
  textarea.dispatchEvent(event);
  return event.defaultPrevented;
})()`);
if (!pasted) throw new Error('The long text paste was not externalized.');

const referenced = await waitFor(state, value => value.chips.length === 1
  && value.prompt.includes('pasted-text-')
  && value.prompt.indexOf('pasted-text-') > value.prompt.indexOf(requestMarker)
  && value.prompt.indexOf('pasted-text-') < value.prompt.indexOf('Second issue'), 8_000, 'positioned pasted-text reference');
const durable = await waitFor(state, value => Boolean(value.draft?.references.includes('workspaceRelativePath')
  || value.draft?.references.includes('file:')), 8_000, 'durable pasted-text draft');

const submitted = await evaluate(`(() => {
  const button = document.querySelector('.nmx-send-button:not(:disabled)');
  button?.click();
  return Boolean(button);
})()`);
if (!submitted) throw new Error(`Unable to submit the long-paste task: ${JSON.stringify(await state())}`);
await waitFor(state, value => Boolean(value.turn), 10_000, 'temporary long-paste conversation turn');
await verifyExactQaComposerRoute(evaluate, qaRoute);

const completed = await waitFor(state, value => Boolean(value.turn && !value.running
  && /is-complete|is-error|is-cancelled/.test(value.turn.className)), 120_000, 'long-paste model task completion');
const editStarted = await evaluate(`(() => {
  const turn = [...document.querySelectorAll('.nmx-task-turn')]
    .find(node => (node.innerText || '').includes(${JSON.stringify(requestMarker)}));
  const edit = turn?.querySelector('.nmx-user-message-actions button[data-message-action="edit"]:not(:disabled)');
  edit?.click();
  return Boolean(edit);
})()`);
if (!editStarted) throw new Error('Unable to edit the completed long-paste turn.');
await waitFor(state, value => value.editing, 4_000, 'historical message editor');
const anchorRemoved = await evaluate(`(() => {
  const textarea = document.querySelector('.nmx-user-message-editor textarea');
  if (!textarea) return false;
  const next = textarea.value.replace(/⟦[^⟧]*pasted-text-[^⟧]*⟧/giu, '');
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(textarea, next);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('.nmx-user-message-editor button.is-primary:not(:disabled)')?.click();
  return !next.includes('pasted-text-');
})()`);
if (!anchorRemoved) throw new Error('The historical pasted-text anchor could not be removed.');
await waitFor(state, value => value.editDialog, 4_000, 'edit continuation dialog');
const replaced = await evaluate(`(() => {
  const button = document.querySelector('.nmx-turn-edit-dialog button.is-danger-subtle:not(:disabled)');
  button?.click();
  return Boolean(button);
})()`);
if (!replaced) throw new Error('Unable to continue without creating a branch.');
const resubmitted = await waitFor(state, value => Boolean(value.turn && !value.running
  && /is-complete|is-error|is-cancelled/.test(value.turn.className)
  && !value.turn.prompt.includes('pasted-text-')), 120_000, 'edited historical task completion');
const final = resubmitted.value;
const report = {
  requestMarker,
  route: initial.route,
  externalizedAtCaret: referenced.value.prompt.indexOf('pasted-text-') > referenced.value.prompt.indexOf(requestMarker)
    && referenced.value.prompt.indexOf('pasted-text-') < referenced.value.prompt.indexOf('Second issue'),
  oneVisibleReferenceChip: referenced.value.chips.length === 1,
  collisionSafeName: /^pasted-text-\d{8}-\d{6}-\d{3}-[a-z0-9-]+\.txt$/i.test(referenced.value.chips[0]?.title || ''),
  durableDraftMetadata: Boolean(durable.value.draft?.references),
  rawBodyDuplicatedInDraftMetadata: durable.value.draft?.references.includes(bodyMarker) || false,
  finalTaskClass: final.turn?.className,
  providerReceivedNamedTextAttachment: completed.value.turn?.response === requestMarker,
  editedTaskCompleted: final.turn?.className.includes('is-complete') || false,
  historicalAnchorRemoved: anchorRemoved,
  removedHistoricalAttachmentNotResent: final.turn?.response === `${requestMarker}_EDITED_NO_ATTACHMENT`
    && !final.turn?.attachments.some(name => /pasted-text-/i.test(name)),
  pass: referenced.value.chips.length === 1
    && /^pasted-text-\d{8}-\d{6}-\d{3}-[a-z0-9-]+\.txt$/i.test(referenced.value.chips[0]?.title || '')
    && Boolean(durable.value.draft?.references)
    && !durable.value.draft?.references.includes(bodyMarker)
    && completed.value.turn?.response === requestMarker
    && anchorRemoved
    && final.turn?.className.includes('is-complete')
    && final.turn?.response === `${requestMarker}_EDITED_NO_ATTACHMENT`
    && !final.turn?.attachments.some(name => /pasted-text-/i.test(name))
};
console.log(JSON.stringify(report, undefined, 2));
await removeExactOfficialQaRoute({ evaluate, route: qaRoute }).catch(() => undefined);
socket.close();
if (!report.pass) process.exitCode = 1;
