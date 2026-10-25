#!/usr/bin/env node

import {
  ensureExactOfficialQaRoute,
  officialQaRouteConfig,
  removeExactOfficialQaRoute
} from './desktop-official-qa-route.mjs';

const cdpPort = process.env.NEXTMUX_CDP_PORT || '9222';
let connectionLabel = process.env.NEXTMUX_E2E_CONNECTION_LABEL || 'NextMux E2E QA';
const expectedCatalogModels = (process.env.NEXTMUX_E2E_DISCOVERED_MODELS
  || 'gpt-5.6-sol,gpt-nextmux-qa-secondary').split(',').map(value => value.trim()).filter(Boolean);
const verifiedModel = (process.env.NEXTMUX_E2E_VERIFIED_MODEL || expectedCatalogModels[0] || '').trim();
const normalizedVerifiedModel = verifiedModel.toLocaleLowerCase();
const directoryOnlyModels = expectedCatalogModels.filter(model => model.toLocaleLowerCase() !== normalizedVerifiedModel);
const normalizedDirectoryOnlyModels = directoryOnlyModels.map(value => value.toLocaleLowerCase());
if (!verifiedModel || directoryOnlyModels.length === 0) {
  throw new Error('Model discovery E2E requires one live-probed model and at least one directory-only model.');
}
const unsupportedGroupLabels = {
  en: 'Models unavailable for this API',
  'zh-CN': '当前 API 暂不可用的模型',
  'zh-TW': '此 API 目前無法使用的模型',
  ja: 'この API では利用できないモデル',
  ko: '이 API에서 사용할 수 없는 모델',
  es: 'Modelos no disponibles para esta API',
  fr: 'Modèles indisponibles pour cette API',
  de: 'Für diese API nicht verfügbare Modelle',
  'pt-BR': 'Modelos indisponíveis para esta API',
  ru: 'Модели, недоступные для этого API',
  ar: 'نماذج غير متاحة لواجهة API هذه',
  hi: 'इस API के लिए अनुपलब्ध मॉडल'
};
const normalizeDesktopLocale = value => {
  const raw = String(value || '').trim();
  if (Object.hasOwn(unsupportedGroupLabels, raw)) return raw;
  const lower = raw.toLocaleLowerCase();
  if (lower.startsWith('zh-tw') || lower.startsWith('zh-hk') || lower.startsWith('zh-hant')) return 'zh-TW';
  if (lower.startsWith('zh')) return 'zh-CN';
  if (lower.startsWith('pt')) return 'pt-BR';
  return Object.keys(unsupportedGroupLabels).find(locale => locale.toLocaleLowerCase().split('-')[0] === lower.split('-')[0]) || 'en';
};

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
    if (predicate(value)) return value;
    await wait(120);
  }
  throw new Error(`Timed out waiting for ${label}. Last value: ${JSON.stringify(value)}`);
};
let qaRoute;
const pickerSnapshotExpression = `(() => {
  const picker = document.querySelector('.nmx-model-picker-popover');
  const rowIndex = node => {
    const value = Number(node.closest('[data-index]')?.getAttribute('data-index'));
    return Number.isInteger(value) ? value : null;
  };
  const describe = node => {
    const id = node.getAttribute('data-model-id') || '';
    const button = node.querySelector('button');
    return {
      id,
      model: id.toLocaleLowerCase().split('/').pop() || '',
      text: (node.innerText || '').trim().replace(/\\s+/g, ' '),
      disabled: Boolean(button?.disabled),
      supported: !node.classList.contains('is-unsupported'),
      capabilityGate: node.getAttribute('data-capability-gate') || '',
      title: button?.getAttribute('title') || '',
      selected: node.classList.contains('is-selected'),
      index: rowIndex(node)
    };
  };
  const labels = [...(picker?.querySelectorAll('.nmx-model-picker-section-label') || [])].map(node => ({
    text: node.textContent?.trim() || '',
    index: rowIndex(node)
  }));
  return {
    open: Boolean(picker),
    labels,
    models: [...(picker?.querySelectorAll('.nmx-model-option') || [])].map(describe)
  };
})()`;
const setPickerSearch = async value => {
  const changed = await evaluate(`(() => {
    const input = document.querySelector('.nmx-model-picker-search input');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, ${JSON.stringify(String(value))});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  if (!changed) throw new Error('The model picker search input is unavailable.');
  await wait(120);
};

try {
  await Promise.all([call('Runtime.enable'), call('Page.enable')]);
  await call('Page.bringToFront');
  qaRoute = await ensureExactOfficialQaRoute({ evaluate, config: officialQaRouteConfig() });
  connectionLabel = qaRoute.connectionLabel;
  const desktopLocale = normalizeDesktopLocale(await evaluate(`document.documentElement.lang || localStorage.getItem('nextmux.locale') || navigator.language || 'en'`));
  const unsupportedGroupLabel = unsupportedGroupLabels[desktopLocale];
  await evaluate(`(() => {
    if (!document.querySelector('.nmx-settings-nav')) document.querySelector('.nmx-account-trigger')?.click();
    return true;
  })()`);
  await waitFor(
    () => evaluate(`Boolean(document.querySelector('.nmx-settings-nav [data-settings-panel="official"]'))`),
    Boolean, 5_000, 'settings navigation'
  );
  await evaluate(`document.querySelector('.nmx-settings-nav [data-settings-panel="official"]')?.click()`);
  const opened = await waitFor(
    () => evaluate(`(() => {
      const label = ${JSON.stringify(connectionLabel)};
      const article = [...document.querySelectorAll('.nmx-settings-list article')]
        .find(node => node.querySelector('strong')?.textContent?.trim() === label);
      const button = article?.querySelector('button');
      if (!button) return false;
      button.click();
      return true;
    })()`),
    Boolean, 5_000, 'saved official connection'
  );
  if (!opened) throw new Error(`Saved connection is unavailable: ${connectionLabel}`);
  const connectionId = await waitFor(
    () => evaluate(`(() => {
      const label = ${JSON.stringify(connectionLabel)};
      const article = [...document.querySelectorAll('.nmx-official-sheet .nmx-saved-connections article')]
        .find(node => node.querySelector('strong')?.textContent?.trim() === label);
      return article?.getAttribute('data-connection-id') || '';
    })()`),
    Boolean, 5_000, 'connection management row'
  );
  // Settings opens the saved-connections list with its editor folded. The
  // datalist belongs to the editor, not the list; explicitly open this exact
  // temporary record before asserting model discovery. Never inspect its key.
  const editing = await evaluate(`(() => {
    const article = [...document.querySelectorAll('.nmx-official-sheet [data-connection-id]')]
      .find(node => node.getAttribute('data-connection-id') === ${JSON.stringify(connectionId)});
    const button = article?.querySelector('[data-official-action="configure"]');
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (!editing) throw new Error('The exact temporary connection cannot be opened for catalog inspection.');
  await waitFor(() => evaluate(`(() => {
    const inputs = [...document.querySelectorAll('.nmx-official-sheet .nmx-official-form label input:not([type="password"])')];
    return { label: inputs[0]?.value || '', model: inputs[1]?.value || '', endpoint: inputs[2]?.value || '' };
  })()`), value => value.label === connectionLabel && value.model === qaRoute.providerModelId
    && value.endpoint.replace(/\/+$/, '') === qaRoute.endpoint.replace(/\/+$/, ''), 5_000, 'exact connection editor');
  const discoveryBefore = await evaluate(`(() => {
    const article = document.querySelector('.nmx-official-sheet [data-connection-id=${JSON.stringify(connectionId)}]');
    return {
      models: [...document.querySelectorAll('.nmx-official-sheet datalist option')].map(option => option.value),
      managementText: article?.innerText || ''
    };
  })()`);
  let discoveryEvidence = {
    mode: 'persisted_verified',
    message: '',
    models: discoveryBefore.models
  };
  if (!expectedCatalogModels.every(model => discoveryBefore.models.includes(model))) {
    const refreshed = await evaluate(`(() => {
      const article = document.querySelector('.nmx-official-sheet [data-connection-id=${JSON.stringify(connectionId)}]');
      const button = article?.querySelector('[data-official-action="refresh-models"]');
      if (!button || button.disabled) return false;
      button.click();
      return true;
    })()`);
    if (!refreshed) throw new Error('Refresh models action is unavailable.');
    const result = await waitFor(
      () => evaluate(`(() => {
        const article = document.querySelector('.nmx-official-sheet [data-connection-id=${JSON.stringify(connectionId)}]');
        const button = article?.querySelector('[data-official-action="refresh-models"]');
        return {
          buttonDisabled: Boolean(button?.disabled),
          text: document.querySelector('.nmx-official-sheet .nmx-connection-message')?.textContent?.trim() || '',
          error: document.querySelector('.nmx-official-sheet .nmx-purchase-error')?.textContent?.trim() || '',
          models: [...document.querySelectorAll('.nmx-official-sheet datalist option')].map(option => option.value)
        };
      })()`),
      value => !value.buttonDisabled && (Boolean(value.error) || expectedCatalogModels.every(model => value.models.includes(model))),
      10_000,
      'completed model discovery'
    );
    if (result.error) throw new Error(`Model discovery failed: ${result.error}`);
    discoveryEvidence = { mode: 'refreshed', message: result.text, models: result.models };
  }
  const datalistModels = await waitFor(
    () => evaluate(`[...document.querySelectorAll('.nmx-official-sheet datalist option')].map(option => option.value)`),
    values => expectedCatalogModels.every(model => values.includes(model)),
    10_000,
    'discovered model datalist'
  );
  const managementText = await evaluate(`document.querySelector('.nmx-official-sheet [data-connection-id=${JSON.stringify(connectionId)}]')?.innerText || ''`);
  await evaluate(`document.querySelector('.nmx-official-sheet > header > button')?.click()`);
  await evaluate(`document.querySelector('.nmx-titlebar-primary-nav [data-desktop-section="coding"]')?.click()`);
  await waitFor(() => evaluate(`Boolean(document.querySelector('.nmx-route-button'))`), Boolean, 5_000, 'coding composer');
  await evaluate(`document.querySelector('.nmx-route-button')?.click()`);

  const pickerSnapshot = await waitFor(
    () => evaluate(pickerSnapshotExpression),
    value => value.models.some(item => item.model === normalizedVerifiedModel
      && item.supported && !item.disabled && Number.isInteger(item.index))
      && value.labels.some(label => label.text === unsupportedGroupLabel && Number.isInteger(label.index)),
    8_000,
    'verified model and unavailable section'
  );
  const verifiedPickerModel = pickerSnapshot.models.find(item => item.model === normalizedVerifiedModel);
  const unsupportedGroup = pickerSnapshot.labels.find(label => label.text === unsupportedGroupLabel);
  if (verifiedPickerModel.capabilityGate !== 'verified_generation_and_tools') {
    throw new Error(`Verified model did not expose separate generation/tool probe evidence: ${JSON.stringify(verifiedPickerModel)}`);
  }
  if (unsupportedGroup.index <= verifiedPickerModel.index) {
    throw new Error(`Unsupported group did not follow the verified model: ${JSON.stringify({ verifiedPickerModel, unsupportedGroup })}`);
  }
  // The picker virtualizes long lists, so directory-only entries can be
  // outside the mounted DOM even though they are present. Exercise the real
  // search control and verify each API-catalog model remains visible but
  // disabled until a generation/tool probe succeeds.
  const directoryOnlyPickerModels = [];
  for (let index = 0; index < directoryOnlyModels.length; index += 1) {
    await setPickerSearch(directoryOnlyModels[index]);
    const searched = await waitFor(
      () => evaluate(pickerSnapshotExpression),
      value => value.labels.some(label => label.text === unsupportedGroupLabel && Number.isInteger(label.index))
        && value.models.some(item => item.model === normalizedDirectoryOnlyModels[index]
          && !item.supported && item.disabled && Number.isInteger(item.index)),
      5_000,
      `directory-only model ${directoryOnlyModels[index]}`
    );
    const group = searched.labels.find(label => label.text === unsupportedGroupLabel);
    const model = searched.models.find(item => item.model === normalizedDirectoryOnlyModels[index]);
    if (!model || !group
        || !['generation_unverified', 'generation_unsupported', 'tools_unverified', 'tools_unsupported'].includes(model.capabilityGate)
        || !model.title || model.index <= group.index) {
      throw new Error(`Directory-only model was not disabled below the unavailable heading: ${JSON.stringify(searched)}`);
    }
    directoryOnlyPickerModels.push({ ...model, unavailableGroupIndex: group.index });
  }
  await setPickerSearch(directoryOnlyModels[0]);
  const disabledUnsupportedModel = directoryOnlyPickerModels[0];

  const selectionBefore = await evaluate(`(() => ({
    routeText: (document.querySelector('.nmx-route-button')?.textContent || '').trim().replace(/\\s+/g, ' '),
    selectedIds: [...document.querySelectorAll('.nmx-model-option.is-selected')]
      .map(node => node.getAttribute('data-model-id') || '')
  }))()`);
  const disabledClickAttempt = await evaluate(`(() => {
    const option = [...document.querySelectorAll('.nmx-model-option')]
      .find(node => node.getAttribute('data-model-id') === ${JSON.stringify(disabledUnsupportedModel.id)});
    const button = option?.querySelector('button');
    if (!button) return { found: false, disabled: false };
    button.click();
    return { found: true, disabled: button.disabled };
  })()`);
  await wait(200);
  const selectionAfter = await evaluate(`(() => ({
    routeText: (document.querySelector('.nmx-route-button')?.textContent || '').trim().replace(/\\s+/g, ' '),
    pickerOpen: Boolean(document.querySelector('.nmx-model-picker-popover')),
    selectedIds: [...document.querySelectorAll('.nmx-model-option.is-selected')]
      .map(node => node.getAttribute('data-model-id') || ''),
    unsupportedSelected: Boolean([...document.querySelectorAll('.nmx-model-option.is-selected')]
      .some(node => node.getAttribute('data-model-id') === ${JSON.stringify(disabledUnsupportedModel.id)}))
  }))()`);
  if (!disabledClickAttempt.found || !disabledClickAttempt.disabled
      || !selectionAfter.pickerOpen || selectionAfter.unsupportedSelected
      || selectionAfter.routeText !== selectionBefore.routeText
      || JSON.stringify(selectionAfter.selectedIds) !== JSON.stringify(selectionBefore.selectedIds)) {
    throw new Error(`Disabled unsupported model changed selection: ${JSON.stringify({ selectionBefore, disabledClickAttempt, selectionAfter })}`);
  }

  console.log(JSON.stringify({
    connectionLabel,
    desktopLocale,
    discoveryMode: discoveryEvidence.mode,
    discoveryMessage: discoveryEvidence.message,
    catalogEvidence: {
      models: datalistModels.filter(model => expectedCatalogModels.includes(model)),
      source: '/models'
    },
    capabilityProbeEvidence: {
      model: verifiedModel,
      selectable: true,
      generationVerified: true,
      toolCallingVerified: true,
      managementText
    },
    managementText,
    verifiedPickerModel,
    directoryOnlyPickerModels,
    unsupportedGroup,
    disabledUnsupportedModel,
    disabledClickPreservedSelection: true,
    pass: true
  }, undefined, 2));
} finally {
  if (qaRoute) await removeExactOfficialQaRoute({ evaluate, route: qaRoute }).catch(() => undefined);
  socket.close();
}
