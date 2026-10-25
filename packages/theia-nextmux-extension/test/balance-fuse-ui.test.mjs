import { modelFailure } from '../lib/browser/nextmux-model-errors.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

import { agentFailureTitle } from '../lib/browser/nextmux-agent-outcome-locale.js';
import { runningTaskText } from '../lib/browser/nextmux-running-task-locale.js';

const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const helper = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'isInsufficientBalanceFailure');
assert.ok(helper);
const isInsufficientBalanceFailure = new Function('modelFailure', `${ts.transpile(helper.getText(parsed), { target: ts.ScriptTarget.ES2022 }).replace(/^export\s+/, '')}; return isInsufficientBalanceFailure;`)(modelFailure);

test('balance fuse recognizes stable gateway codes and forward-compatible failure kinds', () => {
  assert.equal(isInsufficientBalanceFailure({ code: 'wallet_balance_insufficient', kind: 'waiting_user' }), true);
  assert.equal(isInsufficientBalanceFailure({ code: 'WALLET_BALANCE_INSUFFICIENT' }), true);
  assert.equal(isInsufficientBalanceFailure({ kind: 'insufficient_balance' }), true);
  assert.equal(isInsufficientBalanceFailure({ code: 'rate_limited', kind: 'rate_limited' }), false);
  assert.equal(isInsufficientBalanceFailure(undefined), false);
});

test('renderer cancels the live job, records the balance failure and does not drain queued work', () => {
  const poll = source.slice(source.indexOf('protected async pollAgentRun('), source.indexOf('protected async stopAgentRun('));
  assert.match(poll, /isInsufficientBalanceFailure\(snapshot\.error\)[\s\S]*?agentCancelRequested = true;[\s\S]*?cancelAgentRun\(runId\)[\s\S]*?return snapshot;/);
  assert.match(source, /if \(isInsufficientBalanceFailure\(snapshot\.error\)\)[\s\S]*?terminalFailure = snapshot\.error;[\s\S]*?insufficientBalance/);
  assert.match(source, /if \(balanceInsufficient\) \{[\s\S]{0,600}?setCodingGoalStatus\([^)]*'paused'\);\s*return;\s*\}\s*for \(const sessionId of followUpDrainTargets\)/, 'no queued work drains and an active goal pauses');
});

test('balance and route warnings occupy independent stacked rows in every language', () => {
  assert.match(source, /nmx-composer-alert-stack[\s\S]*?balanceInsufficient[\s\S]*?insufficientBalance[\s\S]*?this\.attachmentError/);
  const locales = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
  for (const locale of locales) {
    assert.ok(runningTaskText(locale, 'insufficientBalance').trim(), locale);
    assert.ok(runningTaskText(locale, 'rechargeNow').trim(), locale);
    assert.ok(agentFailureTitle(locale, { code: 'wallet_balance_insufficient', message: 'x', kind: 'waiting_user', retryable: false, resumable: false }).trim(), locale);
  }
});
