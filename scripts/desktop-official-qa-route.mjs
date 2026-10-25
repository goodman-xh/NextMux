import { randomUUID } from 'node:crypto';
import {
  assertDisposableDesktopE2E,
  normalizeEndpointForComparison,
  throwPrimaryOrCleanupErrors,
  uniqueNewResourceId
} from './desktop-e2e-state.mjs';

const DEFAULT_QA_MODEL_ID = 'custom_openai/gpt-nextmux-qa-model';
const DEFAULT_QA_CONNECTION_LABEL = 'NextMux E2E QA';
const LOCAL_QA_SECRET = 'nextmux-qa-secret';

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export function officialQaRouteConfig(environment = process.env, runId = randomUUID()) {
  const port = String(environment.NEXTMUX_OFFICIAL_QA_PORT || '4181').trim();
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65_535) {
    throw new Error(`NEXTMUX_OFFICIAL_QA_PORT must be a valid TCP port, received ${JSON.stringify(port)}.`);
  }
  const modelId = String(environment.NEXTMUX_E2E_MODEL_ID || DEFAULT_QA_MODEL_ID).trim();
  const providerModelId = modelId.split('/').at(-1) || modelId;
  if (!modelId || !providerModelId) throw new Error('NEXTMUX_E2E_MODEL_ID must identify a QA model.');
  const connectionLabelPrefix = String(environment.NEXTMUX_E2E_CONNECTION_LABEL || DEFAULT_QA_CONNECTION_LABEL).trim();
  const normalizedRunId = String(runId).trim();
  if (!normalizedRunId) throw new Error('A unique QA run ID is required.');
  const connectionLabel = `${connectionLabelPrefix} · ${normalizedRunId.slice(0, 12)}`;
  if (!connectionLabelPrefix || connectionLabel.length > 80) {
    throw new Error('NEXTMUX_E2E_CONNECTION_LABEL must contain 1-80 characters.');
  }
  return {
    connectionLabel,
    connectionLabelPrefix,
    endpoint: `http://127.0.0.1:${port}/v1`,
    localSecret: LOCAL_QA_SECRET,
    modelId,
    port,
    providerModelId,
    runId: normalizedRunId
  };
}

export function qaConnectionMatches(actual, expected) {
  try {
    return String(actual?.label || '').trim() === expected.connectionLabel
      && String(actual?.model || '').trim() === expected.providerModelId
      && normalizeEndpointForComparison(actual?.endpoint) === normalizeEndpointForComparison(expected.endpoint);
  } catch {
    return false;
  }
}

export function exactQaRouteExpectation(connectionId, config) {
  if (!connectionId) throw new Error('The QA connection did not expose a connection ID.');
  return {
    connectionId,
    connectionLabel: config.connectionLabel,
    endpoint: config.endpoint,
    modelId: config.modelId,
    providerModelId: config.providerModelId,
    relayKey: `official:${connectionId}`,
    routeId: `official:${connectionId}`
  };
}

export function assertExactQaComposerRoute(snapshot, expected) {
  const failures = [];
  if (snapshot?.modelId !== expected.modelId) failures.push(`modelId=${JSON.stringify(snapshot?.modelId)}`);
  if (snapshot?.routeId !== expected.routeId) failures.push(`routeId=${JSON.stringify(snapshot?.routeId)}`);
  if (snapshot?.persistedRouteId !== expected.routeId) failures.push(`persistedRouteId=${JSON.stringify(snapshot?.persistedRouteId)}`);
  if (snapshot?.relayKey !== expected.relayKey) failures.push(`relayKey=${JSON.stringify(snapshot?.relayKey)}`);
  if (!snapshot?.session?.id) failures.push('active session is missing');
  if (snapshot?.session && snapshot.session.routeId !== expected.routeId) {
    failures.push(`session.routeId=${JSON.stringify(snapshot.session.routeId)}`);
  }
  if (snapshot?.session && snapshot.session.relayKey !== expected.relayKey) {
    failures.push(`session.relayKey=${JSON.stringify(snapshot.session.relayKey)}`);
  }
  if (snapshot?.session && snapshot.session.modelId !== expected.modelId) {
    failures.push(`session.modelId=${JSON.stringify(snapshot.session.modelId)}`);
  }
  if (failures.length) {
    throw new Error(`Composer is not bound to the exact local QA connection ${expected.connectionId}: ${failures.join(', ')}`);
  }
  return snapshot;
}

async function poll(evaluate, expression, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let value;
  while (Date.now() < deadline) {
    value = await evaluate(expression);
    if (predicate(value)) return value;
    await pause(60);
  }
  throw new Error(`Timed out waiting for ${label}. Last value: ${JSON.stringify(value)}`);
}

async function clickVisible(evaluate, expression, label, timeoutMs = 15_000) {
  await poll(evaluate, `(() => {
    const node = (${expression});
    if (!(node instanceof HTMLElement) || node.matches(':disabled')) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  })()`, Boolean, timeoutMs, label);
  const clicked = await evaluate(`(() => {
    const node = (${expression});
    if (!(node instanceof HTMLElement) || node.matches(':disabled')) return false;
    node.scrollIntoView({ block: 'center', inline: 'nearest' });
    node.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Unable to click ${label}.`);
  await pause(100);
}

async function ensureModelCenterViewVisible(evaluate, view, label) {
  const panelState = await evaluate(`(() => {
    const shell = document.querySelector('.nmx-shell');
    const panel = document.querySelector('#nmx-context-panel');
    const rect = panel?.getBoundingClientRect();
    return {
      collapsed: Boolean(shell?.classList.contains('is-context-collapsed')),
      panelVisible: Boolean(rect && rect.width > 0 && rect.height > 0)
    };
  })()`);
  if (panelState?.collapsed || !panelState?.panelVisible) {
    await clickVisible(evaluate, `document.querySelector('[data-context-panel-toggle]')`, 'expand model center context panel');
  }
  // View tabs live in the context panel; the model-center content area is a
  // sibling workspace node. Keep the selector scoped to the stable data
  // contract, not to the wrong visual pane.
  const selector = `.nmx-context-panel [data-model-center-view="${view}"]`;
  await clickVisible(evaluate, `document.querySelector(${JSON.stringify(selector)})`, label);
  await poll(evaluate, `document.querySelector(${JSON.stringify(selector)})?.classList.contains('is-active')`, Boolean, 5_000, label);
}

async function setInputValue(evaluate, expression, value, label) {
  await poll(evaluate, `Boolean(${expression})`, Boolean, 10_000, label);
  const applied = await evaluate(`(() => {
    const input = (${expression});
    if (!(input instanceof HTMLInputElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!applied) throw new Error(`Unable to set ${label}.`);
  await poll(
    evaluate,
    `(${expression})?.value || ''`,
    current => current === value,
    5_000,
    `${label} value`
  );
  await pause(60);
}

async function assertQaConnectionDoesNotExist(evaluate, config) {
  const match = await evaluate(`(() => {
    const label = ${JSON.stringify(config.connectionLabel)};
    const rows = [...document.querySelectorAll('.nmx-official-sheet .nmx-saved-connections article, .nmx-my-apis-list > li')]
      .filter(row => (row.querySelector('strong')?.textContent || '').trim() === label);
    return { count: rows.length, connectionId: rows[0]?.getAttribute('data-connection-id') || '' };
  })()`);
  if (match.count > 1) {
    throw new Error(`More than one saved connection is named ${JSON.stringify(config.connectionLabel)}; the QA route is ambiguous.`);
  }
  if (match.count !== 0) throw new Error(`The unique QA connection name already exists: ${JSON.stringify(config.connectionLabel)}.`);
  await poll(evaluate, `Boolean(document.querySelector('.nmx-official-sheet .nmx-official-form'))`, Boolean, 5_000, 'QA connection editor');
  return match;
}

async function readSavedQaConnections(evaluate) {
  return evaluate(`[...document.querySelectorAll('.nmx-official-sheet .nmx-saved-connections article, .nmx-my-apis-list > li')].map(row => ({
    id: row.getAttribute('data-connection-id') || '',
    label: (row.querySelector('strong')?.textContent || '').trim()
  }))`);
}

async function recoverUniqueNewQaConnection(evaluate, beforeConnectionIds, config) {
  const startedAt = Date.now();
  let lastState;
  while (Date.now() - startedAt < 32_000) {
    const [rows, stage] = await Promise.all([
      readSavedQaConnections(evaluate),
      evaluate(`document.querySelector('.nmx-official-sheet')?.dataset.connectionStage || ''`)
    ]);
    const exactRows = rows.filter(row => row.label === config.connectionLabel);
    const connectionId = uniqueNewResourceId(
      beforeConnectionIds,
      exactRows.map(row => row.id),
      `QA connection named ${JSON.stringify(config.connectionLabel)}`
    );
    lastState = { stage, exactRows };
    if (connectionId) return connectionId;
    if (exactRows.some(row => !row.id)) {
      throw new Error(`The new QA connection ${JSON.stringify(config.connectionLabel)} exists without an exact data-connection-id.`);
    }
    // Give an in-flight validation/save request time to materialize even if the
    // initiating CDP call failed before its result was observed.
    if (stage === 'idle' && Date.now() - startedAt >= 1_000) return '';
    await pause(100);
  }
  throw new Error(`Timed out resolving the unique QA connection created by this run. Last state: ${JSON.stringify(lastState)}.`);
}

async function readQaConnectionEditor(evaluate) {
  return evaluate(`(() => {
    const inputs = [...document.querySelectorAll('.nmx-official-sheet .nmx-official-form label input')];
    return { label: inputs.find(input => input.maxLength === 80)?.value || '', model: inputs.find(input => input.maxLength === 200)?.value || '', endpoint: inputs.find(input => input.maxLength === 2048)?.value || '' };
  })()`);
}

async function configureQaConnection(evaluate, config) {
  await setInputValue(evaluate, `document.querySelector('.nmx-official-sheet .nmx-official-form input[maxlength="80"]')`, config.connectionLabel, 'QA connection label');
  await setInputValue(evaluate, `document.querySelector('.nmx-official-sheet .nmx-official-form input[maxlength="200"]')`, config.providerModelId, 'QA provider model ID');
  await setInputValue(evaluate, `document.querySelector('.nmx-official-sheet .nmx-official-form input[maxlength="2048"]')`, config.endpoint, 'QA endpoint');
  // Never inspect an existing password value. The reserved localhost fixture always receives its fixed test secret.
  await setInputValue(evaluate, `document.querySelector('.nmx-official-sheet .nmx-official-form input[type="password"]')`, LOCAL_QA_SECRET, 'local QA fixture credential');
  const validationStarted = Date.now();
  await clickVisible(evaluate, `document.querySelector('.nmx-official-sheet .nmx-official-form-actions .nmx-primary-button')`, 'test and save local QA connection');
  await pause(180);
  const saved = await poll(evaluate, `(() => ({
    stage: document.querySelector('.nmx-official-sheet')?.dataset.connectionStage || (document.querySelector('.nmx-my-apis') ? 'idle' : ''),
    error: document.querySelector('.nmx-official-sheet .nmx-purchase-error, .nmx-my-apis-error')?.textContent?.trim() || '',
    rows: [...document.querySelectorAll('.nmx-official-sheet .nmx-saved-connections article, .nmx-my-apis-list > li')]
      .filter(row => (row.querySelector('strong')?.textContent || '').trim() === ${JSON.stringify(config.connectionLabel)})
      .map(row => row.getAttribute('data-connection-id') || '')
  // Product discovery permits 30 s and tool validation another 120 s. Keep a
  // bounded harness deadline that covers both; report latency, not a false 30 s failure.
  }))()`, state => state.stage === 'idle' && (Boolean(state.error) || (state.rows.length === 1 && Boolean(state.rows[0]))), 180_000, 'validated local QA connection');
  if (saved.error) throw new Error(`Local QA connection validation failed: ${saved.error}`);
  process.stdout.write(`${JSON.stringify({ event: 'qa_connection_validated', elapsedMs: Date.now() - validationStarted })}\n`);
  return saved.rows[0];
}

export async function readExactQaComposerRoute(evaluate) {
  return evaluate(`(() => {
    const button = document.querySelector('.nmx-composer .nmx-route-button');
    let stored = {};
    let restore = {};
    try { stored = JSON.parse(localStorage.getItem('nextmux.desktop.codingSessions.v1') || '{}'); } catch {}
    try { restore = JSON.parse(localStorage.getItem('nextmux.desktop.restoreState.v1') || '{}'); } catch {}
    const sessions = Array.isArray(stored) ? stored : Array.isArray(stored.sessions) ? stored.sessions : [];
    const activeSessionId = restore.activeCodingSessionId || stored.activeCodingSessionId || '';
    const session = sessions.find(candidate => candidate?.id === activeSessionId);
    return {
      modelId: button?.getAttribute('data-model-id') || '',
      routeId: button?.getAttribute('data-route-id') || '',
      persistedRouteId: localStorage.getItem('nextmux.desktop.route.coding') || '',
      relayKey: localStorage.getItem('nextmux.desktop.activeRelay.v1') || '',
      session: session ? { id: session.id, routeId: session.routeId || '', relayKey: session.relayKey || '', modelId: session.modelId || '' } : undefined
    };
  })()`);
}

export async function verifyExactQaComposerRoute(evaluate, expected) {
  const route = await readExactQaComposerRoute(evaluate);
  return assertExactQaComposerRoute(route, expected);
}

export async function ensureExactOfficialQaRoute({ evaluate, environment = process.env, config = officialQaRouteConfig(environment) }) {
  assertDisposableDesktopE2E(environment);
  const running = await evaluate(`Boolean(document.querySelector('.nmx-stop-glyph'))`);
  if (running) throw new Error('NextMux is already running another task; the QA route cannot be changed safely.');

  await clickVisible(evaluate, `document.querySelector('.nmx-titlebar-primary-nav [data-desktop-section="models"]')`, 'model center navigation');
  await poll(evaluate, `Boolean(document.querySelector('.nmx-model-center'))`, Boolean, 8_000, 'model center');
  // The compatible-API entry is intentionally scoped to the Direct API view;
  // the model center opens on the relay marketplace by default. Follow the
  // same stable data attribute a user uses instead of relying on localized
  // text or assuming the entry is mounted in every view.
  if (await evaluate(`Boolean(document.querySelector('.nmx-my-apis-button'))`)) {
    await clickVisible(evaluate, `document.querySelector('.nmx-my-apis-button')`, 'My APIs');
    await clickVisible(evaluate, `document.querySelector('.nmx-my-apis-toolbar .nmx-primary-button')`, 'Add compatible API');
  } else {
    await ensureModelCenterViewVisible(evaluate, 'official', 'Direct API view');
    await clickVisible(evaluate, `document.querySelector('.nmx-model-center [data-provider-id="custom_openai"]')`, 'Compatible API entry');
  }
  await poll(evaluate, `Boolean(document.querySelector('.nmx-official-sheet .nmx-official-form'))`, Boolean, 5_000, 'Compatible API sheet');

  await assertQaConnectionDoesNotExist(evaluate, config);
  const beforeConnectionIds = (await readSavedQaConnections(evaluate)).map(row => row.id).filter(Boolean);
  let expected;
  try {
    const connectionId = await configureQaConnection(evaluate, config);
    if (!connectionId) {
      throw new Error(`The local QA connection did not expose its unique connection ID.`);
    }
    if (beforeConnectionIds.includes(connectionId)) {
      throw new Error(`The QA connection reused a pre-existing ID ${connectionId}; refusing to treat it as temporary.`);
    }
    expected = exactQaRouteExpectation(connectionId, config);
    // Re-open the saved record and prove the UI exposes the exact endpoint and model. Password fields are never read.
    const currentEditor = await readQaConnectionEditor(evaluate);
    if (!qaConnectionMatches(currentEditor, config)) {
      await clickVisible(evaluate, `document.querySelector(${JSON.stringify(`.nmx-official-sheet .nmx-saved-connections article[data-connection-id="${connectionId}"] button[data-official-action="configure"], .nmx-my-apis-list > li[data-connection-id="${connectionId}"] .nmx-my-apis-actions > button:nth-last-child(2)`)})`, 'QA connection configure button');
      const verifiedEditor = await readQaConnectionEditor(evaluate);
      if (!qaConnectionMatches(verifiedEditor, config)) {
        throw new Error(`The saved ${config.connectionLabel} connection does not match its localhost endpoint and QA model.`);
      }
    }
    await clickVisible(evaluate, `document.querySelector('.nmx-official-sheet > header > button')`, 'close Compatible API sheet');
    if (await evaluate(`Boolean(document.querySelector('.nmx-my-apis-close'))`)) await clickVisible(evaluate, `document.querySelector('.nmx-my-apis-close')`, 'close My APIs');
    await clickVisible(evaluate, `document.querySelector('.nmx-titlebar-primary-nav [data-desktop-section="coding"]')`, 'coding navigation');
    await poll(evaluate, `Boolean(document.querySelector('.nmx-composer .nmx-route-button'))`, Boolean, 8_000, 'coding composer');
    await clickVisible(evaluate, `document.querySelector('[data-relay-trigger="composer"]')`, 'connection selector');
    await poll(evaluate, `Boolean(document.querySelector('.nmx-model-picker-popover .nmx-model-picker-relay-view .nmx-relay-popover'))`, Boolean, 5_000, 'connection selector popover');
    await clickVisible(evaluate, `document.querySelector('.nmx-model-picker-popover [data-relay-source-tab="my-api"]')`, 'personal API source tab');
    await poll(evaluate, `document.querySelector('.nmx-model-picker-popover [data-relay-source-tab="my-api"]')?.getAttribute('aria-selected')`, value => value === 'true', 5_000, 'personal API source tab selection');

    const relayChoice = `document.querySelector(${JSON.stringify(`.nmx-model-picker-popover .nmx-model-picker-relay-view .nmx-relay-options button[data-relay-key="${expected.relayKey}"]`)})`;
    const exactRelayVisible = await evaluate(`Boolean(${relayChoice})`);
    if (!exactRelayVisible) {
      throw new Error(`Product DOM prerequisite missing: the connection selector must expose the full route as data-relay-key=${JSON.stringify(expected.relayKey)}. Refusing label/suffix matching.`);
    }
    await clickVisible(evaluate, relayChoice, 'exact local QA connection');
    if (await evaluate(`Boolean(document.querySelector('.nmx-dialog-backdrop .nmx-primary-button'))`)) {
      await clickVisible(evaluate, `document.querySelector('.nmx-dialog-backdrop .nmx-primary-button')`, 'confirm exact QA connection switch');
    }
    await poll(evaluate, `localStorage.getItem('nextmux.desktop.activeRelay.v1')`, value => value === expected.relayKey, 8_000, 'exact QA relay persistence');

    await clickVisible(evaluate, `document.querySelector('.nmx-composer .nmx-route-button')`, 'model picker');
    await poll(evaluate, `Boolean(document.querySelector('.nmx-model-only-popover .nmx-model-picker-list'))`, Boolean, 5_000, 'source-scoped model picker');
    const modelChoiceSelector = `.nmx-model-option[data-model-id=${JSON.stringify(config.modelId)}] > button:not(:disabled):not([aria-disabled="true"])`;
    const modelChoice = `document.querySelector(${JSON.stringify(modelChoiceSelector)})`;
    await clickVisible(evaluate, modelChoice, 'exact QA model');
    if (await evaluate(`Boolean(document.querySelector('.nmx-model-effort-menu button.is-active'))`)) {
      await clickVisible(evaluate, `document.querySelector('.nmx-model-effort-menu button.is-active')`, 'current QA reasoning effort');
    }

    const composer = await poll(evaluate, `(() => {
    const button = document.querySelector('.nmx-composer .nmx-route-button');
    let stored = {};
    let restore = {};
    try { stored = JSON.parse(localStorage.getItem('nextmux.desktop.codingSessions.v1') || '{}'); } catch {}
    try { restore = JSON.parse(localStorage.getItem('nextmux.desktop.restoreState.v1') || '{}'); } catch {}
    const sessions = Array.isArray(stored) ? stored : Array.isArray(stored.sessions) ? stored.sessions : [];
    const activeSessionId = restore.activeCodingSessionId || stored.activeCodingSessionId || '';
    const session = sessions.find(candidate => candidate?.id === activeSessionId);
    return {
      modelId: button?.getAttribute('data-model-id') || '',
      routeId: button?.getAttribute('data-route-id') || '',
      persistedRouteId: localStorage.getItem('nextmux.desktop.route.coding') || '',
      relayKey: localStorage.getItem('nextmux.desktop.activeRelay.v1') || '',
      session: session ? { id: session.id, routeId: session.routeId || '', relayKey: session.relayKey || '', modelId: session.modelId || '' } : undefined
    };
  })()`, value => value.modelId === expected.modelId
    && value.routeId === expected.routeId
    && value.persistedRouteId === expected.routeId
    && value.relayKey === expected.relayKey, 8_000, 'exact QA composer route before first temporary turn');
    return { ...expected, composer };
  } catch (error) {
    const cleanupErrors = [];
    try {
      if (!expected) {
        const recoveredConnectionId = await recoverUniqueNewQaConnection(evaluate, beforeConnectionIds, config);
        if (recoveredConnectionId) expected = exactQaRouteExpectation(recoveredConnectionId, config);
      }
      if (expected) await removeExactOfficialQaRoute({ evaluate, route: expected });
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    throwPrimaryOrCleanupErrors(error, cleanupErrors, `Configure isolated QA route ${config.connectionLabel}`);
  }
}

export async function removeExactOfficialQaRoute({ evaluate, route }) {
  if (!route?.connectionId) return;
  const running = await evaluate(`Boolean(document.querySelector('.nmx-stop-glyph'))`);
  if (running) throw new Error(`Cannot remove QA connection ${route.connectionId} while a task is running.`);
  const oldRowSelector = `.nmx-official-sheet .nmx-saved-connections article[data-connection-id="${route.connectionId}"]`;
  const newRowSelector = `.nmx-my-apis-list > li[data-connection-id="${route.connectionId}"]`;
  const rowSelector = `${oldRowSelector}, ${newRowSelector}`;
  if (!await evaluate(`Boolean(document.querySelector(${JSON.stringify(rowSelector)}))`)) {
    await clickVisible(evaluate, `document.querySelector('.nmx-titlebar-primary-nav [data-desktop-section="models"]')`, 'model center navigation for QA cleanup');
    await poll(evaluate, `Boolean(document.querySelector('.nmx-model-center'))`, Boolean, 8_000, 'model center for QA cleanup');
    if (await evaluate(`Boolean(document.querySelector('.nmx-my-apis-button'))`)) {
      await clickVisible(evaluate, `document.querySelector('.nmx-my-apis-button')`, 'My APIs cleanup');
    } else {
      await ensureModelCenterViewVisible(evaluate, 'official', 'Direct API view for QA cleanup');
      await clickVisible(evaluate, `document.querySelector('.nmx-model-center [data-provider-id="custom_openai"]')`, 'Compatible API entry for QA cleanup');
      await poll(evaluate, `Boolean(document.querySelector('.nmx-official-sheet'))`, Boolean, 5_000, 'Compatible API cleanup sheet');
    }
  }
  const row = await evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(rowSelector)});
    return node ? { id: node.getAttribute('data-connection-id') || '', label: node.querySelector('strong')?.textContent?.trim() || '' } : undefined;
  })()`);
  if (!row || row.id !== route.connectionId || row.label !== route.connectionLabel) {
    throw new Error(`Refusing to remove a non-exact QA connection. Expected ${route.connectionId}/${route.connectionLabel}, found ${JSON.stringify(row)}.`);
  }
  const disconnect = `${oldRowSelector} button[data-official-action="disconnect"], ${newRowSelector} .nmx-my-apis-remove, ${newRowSelector} .nmx-my-apis-actions.is-confirming button.is-danger`;
  await clickVisible(evaluate, `document.querySelector(${JSON.stringify(disconnect)})`, 'disconnect exact QA connection');
  await clickVisible(evaluate, `document.querySelector(${JSON.stringify(disconnect)})`, 'confirm disconnect exact QA connection');
  await poll(evaluate, `!document.querySelector(${JSON.stringify(rowSelector)})`, Boolean, 15_000, 'exact QA connection and keychain removal');
  await clickVisible(evaluate, `document.querySelector('.nmx-official-sheet > header > button, .nmx-my-apis-close')`, 'close Compatible API cleanup sheet');
}
