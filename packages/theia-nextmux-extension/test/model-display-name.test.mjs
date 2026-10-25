import assert from 'node:assert/strict';
import test from 'node:test';

import { modelDisplayNameOnly } from '../lib/browser/nextmux-model-display-name.js';

test('model labels remove provider wrappers while preserving model identity', () => {
  assert.equal(modelDisplayNameOnly('MiniMaxAI/MiniMax-M2.5', 'MiniMax', 'minimax/minimax-m2.5'), 'MiniMax-M2.5');
  assert.equal(modelDisplayNameOnly('MiniMaxAI/MiniMax-M2.5', 'NovitaAI', 'novita/minimax-m2.5'), 'MiniMax-M2.5');
  assert.equal(modelDisplayNameOnly('MiniMaxAI MiniMax-M2.5', 'MiniMax', 'minimax/minimax-m2.5'), 'MiniMax-M2.5');
  assert.equal(modelDisplayNameOnly('Grok 4 (xAI)', 'xAI', 'xai/grok-4'), 'Grok 4');
  assert.equal(modelDisplayNameOnly('Text 01 (MiniMax)', 'MiniMax', 'minimax/text-01'), 'Text 01');
  assert.equal(modelDisplayNameOnly('AI21: Jamba Large 1.7', 'AI21', 'ai21/jamba-large-1.7'), 'Jamba Large 1.7');
  assert.equal(modelDisplayNameOnly('Ox Alpha (GLM-5.3-Flash preview)', 'stealth', 'stealth/ox-alpha'), 'Ox Alpha (GLM-5.3-Flash preview)');
});

test('model labels retain brand-named families through repeated normalization', () => {
  const cases = [
    ['MiniMax 01', 'minimax', 'minimax/minimax-01', 'MiniMax 01'],
    ['Qwen 3 14b', 'qwen', 'qwen/qwen3-14b', 'Qwen 3 14b'],
    ['Qwen: Qwen 3 235b A22B', 'qwen', 'qwen/qwen3-235b-a22b', 'Qwen 3 235b A22B'],
    ['AionLabs: Aion 3.0', 'aion-labs', 'aion-labs/aion-3.0', 'Aion 3.0'],
    ['Mistral: Mistral Small 3', 'mistralai', 'mistralai/mistral-small-24b-instruct-2501', 'Mistral Small 3'],
    ['MiniMaxAI MiniMax M2.5', 'minimax', 'minimax/minimax-m2.5', 'MiniMax M2.5'],
    ['Qwen 3', 'qwen', '', 'Qwen 3'],
  ];
  for (const [source, provider, canonical, expected] of cases) {
    const label = modelDisplayNameOnly(source, provider, canonical);
    assert.equal(label, expected, source);
    assert.equal(modelDisplayNameOnly(label, provider, canonical), expected, `Repeated: ${source}`);
  }
});
