import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const repo = process.env.NEXTMUX_TEST_SOURCE_REPO || fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
const candidate = new URL('../src/', import.meta.url);
const require = createRequire(repo + '/packages/theia-nextmux-extension/package.json');
const ts = require('typescript'), React = require('react');
const read = file => fs.readFileSync(new URL(file, candidate), 'utf8');
function compile(source, deps = {}) {
  const module = { exports: {} };
  const result = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React }, reportDiagnostics: true });
  assert.equal((result.diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error).length, 0);
  new Function('module', 'exports', 'require', result.outputText)(module, module.exports, name => deps[name] ?? require(name));
  return module.exports;
}
const common = compile(read('common/nextmux-relay-capacity.ts'));
const browser = compile(read('browser/nextmux-relay-capacity.tsx'), { '../common/nextmux-relay-capacity': common });
const locale = compile(read('browser/nextmux-relay-locale.ts'), { './nextmux-copy-fallback': require(repo + '/packages/theia-nextmux-extension/lib/browser/nextmux-copy-fallback.js') });
const source = read('browser/nextmux-desktop-widget.tsx');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const method = (name, classNode = widget, sourceFile = file) => {
  const node = classNode.members.find(value => ts.isMethodDeclaration(value) && value.name.getText(sourceFile) === name);
  assert(node, name); return node.getText(sourceFile);
};
const globals = { React, ...common, RelayCapacityRefresh: browser.RelayCapacityRefresh,
  relayText: locale.relayText, relayDelistedText: () => 'delisted', relayMetricSignal: () => ({ tone: 'unknown', level: 0 }),
  offeringPriceText: () => 'average', relayMultiplierText: () => '1×', relayMeasurementExplanation: () => 'unknown',
  modelCenterText: () => 'unavailable', modelUsageText: () => 'more', ImeInput: 'input',
  relayPercentText: require(repo + '/packages/theia-nextmux-extension/lib/browser/nextmux-relay-picker.js').relayPercentText,
  relaySourceSelected: require(repo + '/packages/theia-nextmux-extension/lib/common/nextmux-relay-switch.js').relaySourceSelected,
  FavoriteHeartIcon: require(repo + '/packages/theia-nextmux-extension/lib/browser/nextmux-favorite-icon.js').FavoriteHeartIcon,
  ReactDOM: { createPortal: element => element }, document: { body: {} },
  window: { innerWidth: 1000, localStorage: { setItem() {} } } };
const Widget = new Function(...Object.keys(globals), ts.transpile(`class Harness {
  ${['relayOptionIsFull', 'renderRelayPopover', 'selectRelay', 'selectComicChatRelay'].map(name => method(name)).join('\n')}
}; return Harness;`, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React }))(...Object.values(globals));
const snapshot = (state = 'full', scope = 'coding', expiresAt = Date.now() + 3000) => ({ scope, merchants: [{ merchantId: 'merchant', state, expiresAt }] });
function fixture(scope = 'coding') {
  const instance = new Widget(), option = { key: 'managed:merchant', merchantId: 'merchant', kind: 'managed', label: 'Merchant' };
  const calls = [], ui = { relay: 'managed:original', modelsPinned: new Set(['video']) };
  Object.assign(instance, { activeSection: scope, activeRelayKey: 'managed:original', relaySourceTab: 'merchant', relaySourceQuery: '',
    desktopLocale: 'zh-CN', platformSession: { linked: true }, publicMerchantPage: { merchants: [{ id: 'merchant' }] },
    favoriteMerchantLabels: new Map(), relayCapacitySnapshot: snapshot('full', scope), relayMetricTooltip: undefined,
    relayPickerOptions: () => [option], relayOptions: () => [option], comicChatRelayKey: () => ui.relay,
    relayCapacityPoller: {}, update: () => calls.push('update'), comicChatUi: () => ui,
    activeModelRoute: () => undefined, routesForRelay: () => [], merchantPickerSnapshots: new Map(),
    applyRelaySelection: selected => calls.push(selected.key), persistComicChatUi: () => calls.push('persist'),
    loadComicChatRelayCatalog: () => calls.push('load'), resolvedDesktopTheme: () => 'dark',
    preloadMerchantCatalogSnapshot() {}, scheduleMerchantCatalogPreload() {}, cancelMerchantCatalogPreload() {} });
  return { instance, option, calls, ui };
}
function elements(node, predicate) {
  if (!node || typeof node !== 'object') return [];
  const children = React.Children.toArray(node.props?.children);
  return [...(predicate(node) ? [node] : []), ...children.flatMap(child => elements(child, predicate))];
}

test('actual shared render produces a native disabled button, precise outer hover and click guard for both workbenches', () => {
  for (const scope of ['coding', 'comic']) {
    const { instance, calls, ui } = fixture(scope);
    const tree = instance.renderRelayPopover();
    const button = elements(tree, node => node.props?.['data-relay-key'] === 'managed:merchant')[0];
    const row = elements(tree, node => node.props?.['data-relay-capacity'] === 'full')[0];
    assert.equal(button.type, 'button'); assert.equal(button.props.disabled, true);
    // The full notice is the drawer's own tooltip (pointer and keyboard) plus the button's accessible name; a native
    // title on the row would open a second, unstyled tooltip over it.
    assert.equal(row.props.title, undefined);
    assert.equal(row.props.tabIndex, 0);
    assert.match(button.props['aria-label'], /该中转商已满载，暂不可选/);
    row.props.onFocus({ currentTarget: {} }); assert.equal(instance.relayMetricTooltip.text, '该中转商已满载，暂不可选');
    instance.relayMetricTooltip = undefined;
    row.props.onPointerEnter({ currentTarget: {} }); assert.equal(instance.relayMetricTooltip.text, '该中转商已满载，暂不可选');
    const before = calls.length; button.props.onClick(); assert.equal(calls.length, before);
    assert.equal(instance.activeRelayKey, 'managed:original'); assert.equal(ui.relay, 'managed:original');
    assert.equal(instance.selectRelay('managed:merchant'), false);
    instance.selectComicChatRelay('managed:merchant'); assert.equal(ui.relay, 'managed:original');
  }
});

test('available, unknown, expired and wrong-scope snapshots do not disable; the stored selection is preserved until the user chooses', () => {
  for (const value of [snapshot('available'), snapshot('unknown'), snapshot('full', 'coding', Date.now() - 1), snapshot('full', 'comic'), undefined]) {
    const { instance, calls } = fixture(); instance.relayCapacitySnapshot = value;
    const button = elements(instance.renderRelayPopover(), node => node.props?.['data-relay-key'] === 'managed:merchant')[0];
    assert.equal(Boolean(button.props.disabled), false);
    assert.equal(instance.activeRelayKey, 'managed:original');
    assert.equal(instance.selectRelay('managed:merchant'), true); assert.deepEqual(calls, ['managed:merchant']);
  }
});

test('strict desktop RPC strips private fields, bounds TTL from request start, rejects foreign merchants and does not cache', async () => {
  const serviceFile = ts.createSourceFile('service.ts', read('node/nextmux-platform-service.ts'), ts.ScriptTarget.Latest, true);
  const node = serviceFile.statements.find(item => ts.isClassDeclaration(item) && item.name?.text === 'NextMuxPlatformServiceImpl');
  const Service = new Function(...Object.keys(common), ts.transpile(`class Service { ${method('getPublicMerchantCapacity', node, serviceFile)} }; return Service;`,
    { target: ts.ScriptTarget.ES2022 }))(...Object.values(common));
  const service = new Service(), calls = [];
  service.request = async (url, options) => { calls.push({ url, options }); return { scope: 'coding', observedAt: 100,
    credentialId: 'PRIVATE', merchants: [{ merchantId: 'merchant', state: 'full', validUntil: 100000, secret: 'PRIVATE' }] }; };
  const before = Date.now(), first = await service.getPublicMerchantCapacity(['merchant'], 'coding');
  await service.getPublicMerchantCapacity(['merchant'], 'coding');
  assert.equal(calls.length, 2); assert.equal(calls[0].options.authenticated, false); assert.equal(calls[0].options.timeoutMs, 4000);
  assert.match(calls[0].url, /^\/api\/merchants\/public\/capacity\?/); assert.doesNotMatch(JSON.stringify(first), /PRIVATE|credential|secret/);
  assert(first.merchants[0].expiresAt <= before + 3010);
  assert.throws(() => common.normalizePublicMerchantCapacity({ scope: 'coding', observedAt: 1, merchants: [{ merchantId: 'foreign', state: 'full', validUntil: 2 }] }, ['merchant'], 'coding', before));
});

test('one serial poller rejects old scope responses, never overlaps a pending read and stops when the drawer closes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const reads = [], outputs = [];
  const poller = new browser.RelayCapacityPoller((ids, scope) => new Promise(resolve => reads.push({ ids, scope, resolve })));
  poller.start(['a'], 'coding', value => outputs.push(value)); assert.equal(reads.length, 1);
  poller.start(['b'], 'comic', value => outputs.push(value)); assert.equal(reads.length, 1);
  reads[0].resolve(snapshot('full', 'coding')); await new Promise(resolve => setImmediate(resolve));
  assert(outputs.every(value => value === undefined)); t.mock.timers.tick(0); assert.equal(reads.length, 2); assert.equal(reads[1].scope, 'comic');
  poller.stop(); reads[1].resolve(snapshot('full', 'comic')); await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(20_000); assert.equal(reads.length, 2); assert(outputs.every(value => value === undefined));
});

test('full observation expires even when the subsequent refresh hangs or fails', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const outputs = [], reads = [];
  const poller = new browser.RelayCapacityPoller(() => new Promise(resolve => reads.push(resolve)));
  poller.start(['merchant'], 'coding', value => outputs.push(value));
  reads[0](snapshot('full', 'coding', Date.now() + 2500)); await new Promise(resolve => setImmediate(resolve));
  assert.equal(outputs.at(-1).merchants[0].state, 'full');
  t.mock.timers.tick(2000); assert.equal(reads.length, 2);
  t.mock.timers.tick(500); assert.equal(outputs.at(-1), undefined);
  poller.stop(); reads[1](snapshot('unknown')); await new Promise(resolve => setImmediate(resolve));
});

test('real row, merchant-name, metric and select-focus handlers preserve the exact full tooltip in hover order, while normal hints remain', () => {
  for (const scope of ['coding', 'comic']) {
    const { instance } = fixture(scope);
    const tree = instance.renderRelayPopover();
    const row = elements(tree, node => node.props?.['data-relay-capacity'] === 'full')[0];
    const name = elements(row, node => node.props?.className === 'nmx-relay-option-name')[0];
    const metrics = elements(row, node => node.props?.['data-relay-metric']);
    const select = elements(row, node => node.props?.['data-relay-key'] === 'managed:merchant')[0];
    const event = { currentTarget: { getAttribute: () => 'Merchant · normal description' } };
    row.props.onPointerEnter(event);
    name.props.onPointerEnter(event);
    assert.equal(instance.relayMetricTooltip.text, '该中转商已满载，暂不可选');
    for (const metric of metrics) {
      metric.props.onPointerEnter(event);
      assert.equal(instance.relayMetricTooltip.text, '该中转商已满载，暂不可选');
    }
    select.props.onFocus(event); assert.equal(instance.relayMetricTooltip.text, '该中转商已满载，暂不可选');
    instance.relayCapacitySnapshot = snapshot('available', scope);
    name.props.onPointerEnter(event); assert.equal(instance.relayMetricTooltip.text, 'Merchant · normal description');
    metrics[0].props.onPointerEnter(event); assert.equal(instance.relayMetricTooltip.text, metrics[0].props['aria-label']);
  }
});
