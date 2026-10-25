import test from 'node:test';
import assert from 'node:assert/strict';
import { declaredReasoningEfforts, declaredReasoningSettings, normalizeReasoningSettings, reasoningControlField } from '../lib/common/nextmux-model-controls.js';
const declared = { support: 'supported', source: 'provider_metadata', scope: 'route' };
test('desktop effort controls preserve declared order/default values without model-family inference', () => {
  assert.deepEqual(declaredReasoningEfforts({ reasoningControls: [{ ...declared, type: 'effort', parameter: 'reasoning.effort', values: ['minimal', 'max', 'none'] }] }), ['minimal', 'max', 'none']);
  assert.deepEqual(declaredReasoningEfforts({ reasoningEfforts: ['low'], reasoningControls: [{ ...declared, support: 'unsupported', type: 'effort', parameter: 'effort', values: ['high'] }] }), []);
  assert.deepEqual(declaredReasoningEfforts({}), []);
  assert.deepEqual(declaredReasoningEfforts({ reasoningControls: [{ ...declared, scope: 'transport', type: 'effort', parameter: 'effort', values: ['high'] }] }), []);
});
test('budget, mandatory on/off and adaptive selections are revalidated before dispatch', () => {
  const controls = [
    { ...declared, type: 'budget', parameter: 'thinking.budget_tokens', min: 1024, max: 4096 },
    { ...declared, type: 'on-off', parameter: 'enable_thinking', values: [true, false], mandatory: true },
    { ...declared, type: 'on-off', parameter: 'reasoning.exclude', values: [true, false] },
    { ...declared, type: 'adaptive', parameter: 'thinking.type', values: ['adaptive', 'enabled'] },
  ];
  assert.deepEqual(declaredReasoningSettings(controls, { reasoningBudgetTokens: 2048, reasoningEnabled: false, reasoningExclude: false, reasoningMode: 'adaptive' }),
    { reasoningBudgetTokens: 2048, reasoningExclude: false, reasoningMode: 'adaptive' });
  assert.deepEqual(declaredReasoningSettings(controls, { reasoningBudgetTokens: 5000, reasoningMode: 'disabled' }), {});
  assert.deepEqual(declaredReasoningSettings([], { reasoningBudgetTokens: 2048, reasoningEnabled: true }), {});
  assert.deepEqual(normalizeReasoningSettings({ reasoningEnabled: false, reasoningBudgetTokens: Infinity, reasoningMode: 'invented', secret: 'x' }), { reasoningEnabled: false });
});


test('mandatory thinking never offers the none effort', () => {
    assert.deepEqual(declaredReasoningEfforts({ reasoningControls: [{ ...declared, type: 'effort', parameter: 'reasoning.effort', values: ['none', 'low', 'high'], mandatory: true }] }), ['low', 'high']);
});


test('controls without an implemented wire mapping remain hidden', () => {
    assert.equal(reasoningControlField({ ...declared, type: 'budget', parameter: 'vendor.unimplemented', min: 1 }), undefined);
    assert.equal(reasoningControlField({ ...declared, type: 'on-off', parameter: 'vendor.toggle', values: [true, false] }), undefined);
    assert.deepEqual(declaredReasoningEfforts({ reasoningControls: [{ ...declared, type: 'effort', parameter: 'vendor.effort', values: ['low', 'high'] }] }), []);
});


test('unmapped mode enums are not submitted as enabled flags or invented modes', () => {
    const controls = [{ ...declared, type: 'adaptive', parameter: 'thinking.type', values: ['auto', 'enabled'] }];
    assert.deepEqual(declaredReasoningSettings(controls, { reasoningMode: 'auto' }), {});
});


test('inferred reasoning metadata cannot expose executable controls', () => {
    assert.deepEqual(declaredReasoningEfforts({ reasoningControls: [{ ...declared, source: 'model_heuristic', type: 'effort', parameter: 'reasoning.effort', values: ['low'] }] }), []);
    assert.equal(reasoningControlField({ ...declared, source: 'model_heuristic', type: 'budget', parameter: 'thinking.budget_tokens' }), undefined);
    assert.deepEqual(declaredReasoningEfforts({ reasoningEfforts: ['low'], capabilityDeclarations: { reasoning: { ...declared, support: 'unsupported' } } }), []);
});
