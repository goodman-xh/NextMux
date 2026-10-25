import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import { deflateSync } from 'node:zlib';
import { commandActivityTitle } from '../packages/theia-nextmux-extension/lib/browser/nextmux-agent-activity.js';
import { localizeDesktopSurface } from '../packages/theia-nextmux-extension/lib/browser/nextmux-surface-locale.js';

const source = readFileSync(new URL('./desktop-agent-recovery-e2e.mjs', import.meta.url), 'utf8');
test('recovery matches exact production command labels for all desktop locales', () => {
  const declaration = source.match(/const commandRow = ([\s\S]*?);\n/)?.[1];
  assert.ok(declaration);
  for (const activityLocale of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'pt-BR', 'ru', 'ar', 'hi']) {
    const match = runInNewContext(declaration, { commandActivityTitle, activityLocale });
    const command = 'node -e "process.exit(7)"';
    const row = { command, title: commandActivityTitle(activityLocale, 'running', command) };
    assert.equal(match({ details: [row] }, 'running'), row);
    assert.equal(match({ details: [row] }, 'failed'), undefined);
    assert.equal(match({ details: [{ ...row, command: '' }] }, 'running'), undefined);
    assert.ok(localizeDesktopSurface(activityLocale, '正在重试模型连接'));
  }
});

test('recovery keeps running caret, exact failure, stopped request counts and explicit once-only continuation', () => {
  assert.equal((source.match(/state\.running && state\.caret && commandRow\(state, 'running'\)/g) || []).length, 3);
  assert.match(source, /state\.failedRows === 1\s*&& commandRow\(state, 'failed'\)/);
  assert.match(source, /detail\.command\.includes\('process\.exit\(7\)'\)/);
  assert.match(source, /retryRows: operations\.filter\(node => node\.querySelector\('strong'\)/);
  for (const required of ['processExecutions === 1', 'failure.retrySafe === false', 'persisted.retryEvents.length',
    'current.requests !== before.requests', 'server.rateLimitResponses === 1', 'server.processRequests === 1', 'server.readRequests === 1',
    "confirmStoppedBeforeContinue(rateLimitMarker, 'rate-limit', 429, 16_000)", 'await clickPoint(point)']) {
    assert.ok(source.includes(required), required);
  }
  assert.doesNotMatch(source, /\^正在运行/);
  assert.doesNotMatch(source, /automaticRecovery:/);
});

test('actual localhost fixture counts each recovery marker separately and preserves one command across explicit continuation', () => {
  const fixtureSource = readFileSync(new URL('./official-model-qa-server.mjs', import.meta.url), 'utf8')
    .replace(/^#!.*\n/, '').replace(/^import .*;\n/gm, '');
  let handler;
  runInNewContext(fixtureSource, {
    http: { createServer(callback) { handler = callback; return { listen() {}, close() {} }; } },
    deflateSync, Buffer, URL, observeQaRequest() {}, toolContractFixturePath() {},
    process: { env: {}, on() {}, stdout: { write() {} } },
  });
  const send = (method, path, body) => {
    const request = Object.assign(new EventEmitter(), { method, url: path, headers: { authorization: 'Bearer nextmux-qa-secret' } });
    let status, result;
    const response = { writeHead(value) { status = value; }, end(value) { result = JSON.parse(value); } };
    handler(request, response);
    if (body) { request.emit('data', Buffer.from(JSON.stringify(body))); request.emit('end'); }
    return { status, result };
  };
  const markerA = 'NM_AUTO_RESUME_E2E_111', markerB = 'NM_AUTO_RESUME_E2E_222';
  const tools = ['process.run', 'workspace.read_file'].map(name => ({ type: 'function', function: { name } }));
  const messages = marker => [{ role: 'user', content: `${marker} 调用 process.run` }];
  const post = messages => send('POST', '/v1/chat/completions', { model: 'gpt-5.6-sol', tools, messages });
  const first = post(messages(markerA));
  const second = post(messages(markerB));
  assert.equal(first.status, 200); assert.equal(second.status, 200);
  const command = first.result.choices[0].message;
  const completed = [...messages(markerA), command, { role: 'tool', tool_call_id: command.tool_calls[0].id, content: JSON.stringify({ output: { exitCode: 0 } }) }];
  assert.equal(post(completed).status, 503);
  const state = marker => send('GET', `/__nextmux_qa/recovery?marker=${marker}`).result;
  assert.deepEqual(state(markerA), { marker: markerA, requests: 2, unavailableResponses: 1, processRequests: 1, readRequests: 0 });
  assert.equal(state(markerA).requests, 2); // Reads themselves never increment model calls.
  assert.equal(state(markerB).requests, 1);
  const continued = post(completed);
  assert.equal(continued.status, 200);
  assert.equal(continued.result.choices[0].message.tool_calls[0].function.name, 'workspace.read_file');
  assert.deepEqual(state(markerA), { marker: markerA, requests: 3, unavailableResponses: 1, processRequests: 1, readRequests: 1 });
  assert.equal(send('GET', '/__nextmux_qa/recovery?marker=unknown').status, 404);
});
