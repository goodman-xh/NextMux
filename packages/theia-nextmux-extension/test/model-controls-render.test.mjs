import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { declaredReasoningEfforts, declaredReasoningSettings, reasoningDepthChoices } from '../lib/common/nextmux-model-controls.js';
import { reasoningControlText } from '../lib/browser/nextmux-reasoning-controls-locale.js';
import { reasoningSwitchEnabledDefault } from '../lib/browser/nextmux-reasoning-depth-presentation.js';
import { isReasoningOptionRejection, reasoningEvidenceState, reasoningOptionKey } from '@nextmux/model-runtime/reasoning-evidence';
import { protocolSupportsReasoningEffort } from '@nextmux/model-runtime/capabilities';

// The production thinking-depth methods, extracted from the widget: one row per model whatever
// the API's parameter is, stored per model and per conversation, narrowed by evidence.
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const names = ['reasoningDepthChoicesForRoute', 'activeReasoningDepthId', 'reasoningDepthLabel', 'setModelOptionReasoningDepth',
  'readLocalReasoningEvidence', 'localReasoningEvidence', 'recordLocalReasoningEvidence', 'modelReasoningContract', 'reasoningEffortLevels', 'reasoningSettingsForRoute'];
const methods = names.map(name => {
  const member = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name);
  assert.ok(member, name);
  return member.getText(file);
}).join('\n');
const storage = new Map();
const window = { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) } };
const Harness = new Function('window', 'reasoningDepthChoices', 'reasoningOptionKey', 'reasoningControlText', 'declaredReasoningSettings', 'declaredReasoningEfforts',
  'reasoningEvidenceState', 'protocolSupportsReasoningEffort', 'reasoningSwitchEnabledDefault',
  ts.transpile(`class Harness { ${methods} }; return Harness;`, { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React }))(
  window, reasoningDepthChoices, reasoningOptionKey, reasoningControlText, declaredReasoningSettings, declaredReasoningEfforts, reasoningEvidenceState, protocolSupportsReasoningEffort, reasoningSwitchEnabledDefault);

const declared = { support: 'supported', source: 'provider_metadata', scope: 'route' };
function fixture(route) {
  const h = new Harness();
  Object.assign(h, {
    desktopLocale: 'zh-CN', activeRelayKey: 'managed:atlas', activeCodingSessionId: 's1', activeModelRouteId: '', activeKeyPriceQuoteId: 'q',
    codingSessions: [{ id: 's1', routeId: route.id }], reasoningSettingsByModel: {}, reasoningEffortByModel: {}, calls: [],
    routesForRelay: () => [route], modelKeyForRoute: () => 'deepseek/deepseek-v3.2', activeCodingSession() { return this.codingSessions[0]; },
    reasoningEffortForRoute: () => undefined, selectModelOption(...args) { this.calls.push(['select', ...args]); this.activeModelRouteId = args[2]; },
    persistActiveRouteSelection() { this.calls.push(['persist']); }, completeNavigationSurface() { this.calls.push(['close']); }, update() {},
    setModelOptionReasoningEffort(...args) { this.calls.push(['effort', ...args]); },
  });
  return h;
}

test('a resolved thinking switch defaults to its eligible enable choice without overriding explicit preferences', () => {
  const route = { id: 'r1', kind: 'managed_gateway', offering: { keyPriceQuoteId: 'q', reasoningControls: [
    { ...declared, type: 'on-off', parameter: 'enable_thinking', values: [true, false], default: false },
    { ...declared, type: 'on-off', parameter: 'reasoning.exclude', values: [true, false] },
  ] } };
  const h = fixture(route);
  const choices = h.reasoningDepthChoicesForRoute(route);
  assert.deepEqual(choices.options.map(option => [option.id, h.reasoningDepthLabel(option)]), [['enabled:false', '关闭'], ['enabled:true', '开启']]);
  assert.equal(choices.defaultId, 'enabled:false', 'the provider declaration is unchanged');
  assert.deepEqual(h.reasoningSettingsForRoute(route), { reasoningEnabled: true }, 'an unset frontend choice defaults to the resolved enable option');
  assert.equal(h.activeReasoningDepthId(route, choices), 'enabled:true');
  h.codingSessions[0].reasoningSettings = { reasoningEnabled: false };
  assert.deepEqual(h.reasoningSettingsForRoute(route), { reasoningEnabled: false }, 'an existing conversation preference is retained');
  assert.equal(h.activeReasoningDepthId(route, choices), 'enabled:false');
  delete h.codingSessions[0].reasoningSettings;
  h.reasoningSettingsByModel['deepseek/deepseek-v3.2'] = { reasoningEnabled: false };
  assert.deepEqual(h.reasoningSettingsForRoute(route), { reasoningEnabled: false }, 'an explicit saved model preference is retained');
  h.setModelOptionReasoningDepth('deepseek/deepseek-v3.2', choices.options[1], 'coding', { id: 'q' }, 'r1');
  assert.deepEqual(h.reasoningSettingsByModel['deepseek/deepseek-v3.2'], { reasoningEnabled: true });
  assert.deepEqual(h.codingSessions[0].reasoningSettings, { reasoningEnabled: true }, 'the conversation keeps its own choice');
  assert.equal(JSON.parse(storage.get('nextmux.desktop.reasoningSettings.v1'))['deepseek/deepseek-v3.2'].reasoningEnabled, true);
  assert.deepEqual(h.calls.map(call => call[0]), ['select', 'persist', 'close']);
  assert.equal(h.activeKeyPriceQuoteId, 'q', 'a thinking-only change keeps the displayed price authorization');
  assert.equal(h.activeReasoningDepthId(route, choices), 'enabled:true');
});

test('a refused or undeclared thinking enable option is never supplied as a frontend default', () => {
  const route = { id: 'refused', kind: 'managed_gateway', offering: {
    reasoningEvidence: { 'enabled:true': 'rejected' },
    reasoningControls: [{ ...declared, type: 'on-off', parameter: 'enable_thinking', values: [true, false], default: false }]
  } };
  assert.deepEqual(fixture(route).reasoningSettingsForRoute(route), {});
  route.offering.reasoningEvidence = {};
  route.offering.reasoningControls = [];
  assert.deepEqual(fixture(route).reasoningSettingsForRoute(route), {});
});

test('effort levels go through the effort setter and clear an earlier “off”', () => {
  const route = { id: 'r2', kind: 'managed_gateway', offering: { keyPriceQuoteId: 'q',
    reasoningEfforts: ['low', 'medium'],
    reasoningEvidence: { 'effort:high': 'rejected', 'effort:low': 'verified' }, reasoningControls: [
      { ...declared, type: 'effort', parameter: 'reasoning.effort', values: ['low', 'medium', 'high'] },
      { ...declared, type: 'on-off', parameter: 'reasoning.enabled', values: [true, false] },
    ] } };
  const h = fixture(route);
  h.reasoningSettingsByModel['deepseek/deepseek-v3.2'] = { reasoningEnabled: false };
  const choices = h.reasoningDepthChoicesForRoute(route);
  assert.deepEqual(choices.options.map(option => option.id), ['enabled:false', 'effort:low', 'effort:medium'], 'the level this API refused is gone');
  h.setModelOptionReasoningDepth('deepseek/deepseek-v3.2', choices.options[2], 'coding', { id: 'q' }, 'r2');
  assert.deepEqual(h.reasoningSettingsByModel['deepseek/deepseek-v3.2'], {});
  assert.deepEqual(h.calls.at(-1), ['effort', 'deepseek/deepseek-v3.2', 'medium', 'coding', { id: 'q' }, 'r2']);
});

test('managed effort controls cannot restore levels the public catalog cannot execute', () => {
  const route = { id: 'r3', kind: 'managed_gateway', offering: {
    reasoningEfforts: ['low', 'medium'], reasoningControls: [
      { ...declared, type: 'effort', parameter: 'reasoning_effort', values: ['none', 'low', 'medium', 'high'] },
    ] } };
  const h = fixture(route);
  assert.deepEqual(h.reasoningEffortLevels(route), ['low', 'medium']);
  assert.deepEqual(h.reasoningDepthChoicesForRoute(route).options.map(option => option.id), ['effort:low', 'effort:medium']);
  h.setModelOptionReasoningDepth('deepseek/deepseek-v3.2', { id: 'effort:high', effort: 'high', settings: {} }, 'coding', undefined, route.id);
  assert.deepEqual(h.calls, [], 'a stale menu cannot select an unpublished effort');
  route.offering.reasoningEfforts = [];
  assert.deepEqual(h.reasoningEffortLevels(route), []);
  assert.deepEqual(h.reasoningDepthChoicesForRoute(route).options, [], 'an incompatible protocol or unproven enum publishes no efforts');
});

test('empty managed effort lists preserve declared budget and on/off controls', () => {
  for (const [control, expected] of [
    [{ ...declared, type: 'on-off', parameter: 'enable_thinking', values: [true, false] }, ['enabled:false', 'enabled:true']],
    [{ ...declared, type: 'budget', parameter: 'thinking.budget_tokens', min: 1024, max: 4096 }, ['budget:2048', 'budget:4096']],
  ]) {
    const route = { id: 'r4', kind: 'managed_gateway', offering: { reasoningEfforts: [], reasoningControls: [
      { ...declared, type: 'effort', parameter: 'reasoning_effort', values: ['low', 'high'] }, control,
    ] } };
    const h = fixture(route);
    assert.deepEqual(h.reasoningEffortLevels(route), []);
    assert.deepEqual(h.reasoningDepthChoicesForRoute(route).options.map(option => option.id), expected);
  }
});

test('own APIs keep their evidence on this computer: a refused option disappears, a week later it is retried', () => {
  const route = { id: 'o1', kind: 'official_connection', connection: { id: 'conn', model: 'gpt-6-astra', protocol: 'openai_chat_completions',
    discoveredModels: [{ id: 'gpt-6-astra', reasoningControls: [{ ...declared, type: 'effort', parameter: 'reasoning_effort', values: ['low', 'medium', 'high'] }] }] } };
  storage.clear();
  const h = fixture(route);
  assert.deepEqual(h.reasoningDepthChoicesForRoute(route).options.map(option => option.id), ['effort:low', 'effort:medium', 'effort:high']);
  h.recordLocalReasoningEvidence(route, 'effort:high', 'rejected');
  h.recordLocalReasoningEvidence(route, 'effort:low', 'accepted', true);
  h.recordLocalReasoningEvidence({ kind: 'managed_gateway' }, 'effort:low', 'rejected');
  const stored = JSON.parse(storage.get('nextmux.desktop.reasoningEvidence.v1'));
  assert.deepEqual(Object.keys(stored), ['conn\ngpt-6-astra'], 'merchant APIs are recorded by the platform, not here');
  const fresh = fixture(route);
  const choices = fresh.reasoningDepthChoicesForRoute(route);
  assert.deepEqual(choices.options.map(option => [option.id, option.evidence]), [['effort:low', 'verified'], ['effort:medium', undefined]]);
  stored['conn\ngpt-6-astra']['effort:high'].t = Date.now() - 8 * 24 * 3600 * 1000;
  storage.set('nextmux.desktop.reasoningEvidence.v1', JSON.stringify(stored));
  assert.equal(fixture(route).reasoningDepthChoicesForRoute(route).options.length, 3);
  // A refusal is recognised from the readable error the run failed with.
  assert.equal(isReasoningOptionRejection({ kind: 'invalid_request', httpStatus: 400, detail: "Unsupported parameter: 'reasoning_effort' is not supported with this model." }), true);
});
