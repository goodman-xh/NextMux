import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { localizeDesktopSurface } from '../packages/theia-nextmux-extension/lib/browser/nextmux-surface-locale.js';
import { normalizeDesktopLocale } from '../packages/theia-nextmux-extension/lib/browser/nextmux-locale.js';

test('delegation uses the current permission translation, including the actual English wording', () => {
  assert.equal(localizeDesktopSurface('en', '工作区写入'), 'Workspace write');
  for (const locale of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'pt', 'ru', 'ar', 'hi']) {
    assert.ok(localizeDesktopSurface(normalizeDesktopLocale(locale), '工作区写入').trim());
  }
  const source = readFileSync(new URL('./desktop-agent-delegation-e2e.mjs', import.meta.url), 'utf8');
  assert.match(source, /workspacePermissionLabel = localizeDesktopSurface\(permissionLocale, '工作区写入'\)/);
  assert.match(source, /permission !== workspacePermissionLabel/);
  assert.match(source, /JSON\.stringify\(workspacePermissionLabel\)/);
  assert.doesNotMatch(source, /\/Workspace Write\|/);
});

test('delegation still verifies the actual request permission and child capability isolation', () => {
  const source = readFileSync(new URL('./desktop-agent-delegation-e2e.mjs', import.meta.url), 'utf8');
  assert.match(source, /agentRpc\.request\.permissionMode !== 'workspace_write'/);
  assert.match(source, /qaState\.childPermissionRequest === 'full_access'/);
  assert.match(source, /qaState\.childProcessToolExposed === false/);
  assert.match(source, /qaState\.childWriteToolExposed === false/);
  assert.match(source, /assertExactAgentRunRpc\(rpcFrames, qaRoute, \{ marker \}\)/);
});

test('fast continuation can be proven by its unique result without falsely claiming a running spinner was observed', () => {
  const source = readFileSync(new URL('./desktop-agent-delegation-e2e.mjs', import.meta.url), 'utf8');
  const expression = source.match(/const continuationProgress = await waitForExpression\(`([\s\S]*?)`, 'child-agent continuation running or completed'/)?.[1];
  assert.ok(expression);
  const actualExpression = expression.replace('${JSON.stringify(childContinuationMarker)}', JSON.stringify('unique-continuation'));
  const evaluate = (running, text) => runInNewContext(actualExpression, { document: { querySelector: selector =>
    selector.includes('is-stop') ? running ? {} : null : { innerText: text } } });
  assert.equal(evaluate(true, ''), 'running');
  assert.equal(evaluate(false, 'unique-continuation: done'), 'completed');
  assert.equal(evaluate(false, 'old child answer'), false);
  assert.match(source, /childContinuationRunningObserved: continuationProgress === 'running'/);
  assert.match(source, /report\.childContinuationCalls >= 1/);
  assert.match(source, /report\.childContinuationVisible/);
});
