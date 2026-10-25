import test from 'node:test';
import assert from 'node:assert/strict';
import { reasoningDepthChoices } from '../lib/common/nextmux-model-controls.js';
import { contextWindowTokenLabel } from '../lib/common/nextmux-context-budget.js';

const declared = { support: 'supported', source: 'provider_metadata', scope: 'route' };
const ids = choices => choices.options.map(option => `${option.id}=${option.label}`);

test('every kind of thinking parameter becomes one ordered depth row', () => {
  // Effort levels, with the API's own switch as “off”.
  assert.deepEqual(ids(reasoningDepthChoices({ reasoningControls: [
    { ...declared, type: 'effort', parameter: 'reasoning.effort', values: ['low', 'medium', 'high'] },
    { ...declared, type: 'on-off', parameter: 'reasoning.enabled', values: [true, false] },
    { ...declared, type: 'on-off', parameter: 'reasoning.exclude', values: [true, false] },
  ] })), ['enabled:false=off', 'effort:low=low', 'effort:medium=medium', 'effort:high=high']);
  // A switch only (DeepSeek V3.2 on a relay): off / on, and the API's default is known.
  const toggle = reasoningDepthChoices({ reasoningControls: [
    { ...declared, type: 'on-off', parameter: 'enable_thinking', values: [true, false], default: false },
    { ...declared, type: 'on-off', parameter: 'reasoning.exclude', values: [true, false] },
  ] });
  assert.deepEqual(ids(toggle), ['enabled:false=off', 'enabled:true=on']);
  assert.equal(toggle.defaultId, 'enabled:false');
  // A thinking mode (Anthropic): off / auto / on.
  assert.deepEqual(ids(reasoningDepthChoices({ reasoningControls: [
    { ...declared, type: 'adaptive', parameter: 'thinking.type', values: ['adaptive', 'enabled', 'disabled'], default: 'adaptive' },
  ] })), ['mode:disabled=off', 'mode:adaptive=auto', 'mode:enabled=on']);
  // A token budget only: presets inside the declared range, “off” only where 0 is allowed.
  assert.deepEqual(ids(reasoningDepthChoices({ reasoningControls: [
    { ...declared, type: 'budget', parameter: 'generationConfig.thinkingConfig.thinkingBudget', min: 0, max: 16_384 },
  ] })), ['budget:0=off', 'budget:2048=low', 'budget:8192=medium', 'budget:16384=high']);
  assert.deepEqual(ids(reasoningDepthChoices({ reasoningControls: [
    { ...declared, type: 'budget', parameter: 'thinking.budget_tokens', min: 1024, max: 4096 },
  ] })), ['budget:2048=low', 'budget:4096=medium']);
});

test('“include thinking in the response” is never a choice, and a lone option is not a row', () => {
  assert.deepEqual(reasoningDepthChoices({ reasoningControls: [
    { ...declared, type: 'on-off', parameter: 'reasoning.exclude', values: [true, false] },
  ] }).options, []);
  assert.deepEqual(reasoningDepthChoices({ reasoningControls: [
    { ...declared, type: 'on-off', parameter: 'enable_thinking', values: [true, false], mandatory: true },
  ] }).options, [], 'thinking that cannot be turned off leaves nothing to choose');
  assert.deepEqual(reasoningDepthChoices({ capabilityDeclarations: { reasoning: { ...declared, support: 'unsupported' } },
    reasoningControls: [{ ...declared, type: 'effort', parameter: 'reasoning_effort', values: ['low', 'high'] }] }).options, []);
  assert.deepEqual(reasoningDepthChoices({ reasoningControls: [
    { ...declared, source: 'model_heuristic', type: 'effort', parameter: 'reasoning_effort', values: ['low', 'high'] },
  ] }).options, [], 'a guess from the model name is not a declaration');
});

test('options this API refused are left out; proven ones say so', () => {
  const contract = { reasoningControls: [{ ...declared, type: 'effort', parameter: 'reasoning_effort', values: ['low', 'medium', 'high'] }] };
  const choices = reasoningDepthChoices(contract, { 'effort:high': 'rejected', 'effort:low': 'verified' });
  assert.deepEqual(ids(choices), ['effort:low=low', 'effort:medium=medium']);
  assert.equal(choices.options[0].evidence, 'verified');
  assert.equal(choices.options[1].evidence, undefined);
  assert.deepEqual(reasoningDepthChoices(contract, { 'effort:high': 'rejected', 'effort:medium': 'rejected' }).options, [], 'one survivor is not a choice');
  // Own APIs whose protocol cannot carry an effort pass no levels.
  assert.deepEqual(reasoningDepthChoices(contract, undefined, []).options, []);
});

test('context sizes read the way vendors write them', () => {
  // 1,047,576 is the 1M window OpenAI advertises for GPT-4.1 (2^20 minus 1,000), so it reads 1M like the tier list.
  for (const [tokens, label] of [[131_072, '128K'], [262_144, '256K'], [200_000, '200K'], [1_048_576, '1M'], [1_000_000, '1M'],
    [163_840, '160K'], [32_768, '32K'], [128_000, '128K'], [1_047_576, '1M'], [1_050_000, '1M'], [922_000, '1M'], [2_000_000, '2M'], [1_572_864, '1.5M'], [400_000, '400K'], [204_800, '200K'], [32_000, '32K'], [512, '512']]) {
    assert.equal(contextWindowTokenLabel(tokens), label, String(tokens));
  }
  assert.equal(contextWindowTokenLabel(0), '—');
});
