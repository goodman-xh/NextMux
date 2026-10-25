#!/usr/bin/env node
/**
 * Provider-to-local-tool acceptance probe.
 *
 * The provider receives only a tool schema and a short prompt. The returned
 * function call is executed against a temporary local NextMux project. No
 * conversation body, credential, or persistent user data is sent upstream.
 */
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentToolRegistry } from '../packages/agent-runtime/lib/index.js';
import { NextMuxPlatformServiceImpl } from '../packages/theia-nextmux-extension/lib/node/nextmux-platform-service.js';

const key = String(process.env.ZEEKAI_API_KEY || process.env.API_KEY || '').trim();
const endpoint = String(process.env.ZEEKAI_ENDPOINT || 'https://api.zeekai.cc').replace(/\/$/, '');
const model = String(process.env.ZEEKAI_MODEL || 'gpt-6-astra');
const output = process.env.P12_REPORT || 'docs/reports/p12-zeekai-tool-call-2026-09-14-live.json';
if (!key) throw new Error('ZEEKAI_API_KEY_REQUIRED');

const prompt = '请在当前项目创建一个标题为“模型工具验收”的新对话。';
const tool = {
  type: 'function',
  function: {
    name: 'nextmux_create_conversation',
    description: '在当前项目创建本地对话',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { title: { type: 'string' }, idempotencyKey: { type: 'string' } },
      required: ['title', 'idempotencyKey'],
    },
  },
};

const startedAt = Date.now();
const response = await fetch(`${endpoint}/v1/chat/completions`, {
  method: 'POST',
  headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
  body: JSON.stringify({
    model,
    messages: [{ role: 'system', content: '你可以调用工具完成用户请求。' }, { role: 'user', content: prompt }],
    tools: [tool],
    tool_choice: { type: 'function', function: { name: tool.function.name } },
    temperature: 0,
    max_tokens: 200,
  }),
});
const payload = await response.json().catch(() => ({}));
const call = payload?.choices?.[0]?.message?.tool_calls?.[0];
let parsed;
if (call?.function?.name !== tool.function.name) throw new Error('PROVIDER_TOOL_CALL_MISSING');
try { parsed = JSON.parse(call.function.arguments); } catch { throw new Error('PROVIDER_TOOL_ARGUMENTS_INVALID'); }

const root = await mkdtemp(join(tmpdir(), 'nextmux-provider-tool-'));
const workspace = join(root, 'project');
const state = join(root, 'state');
await mkdir(workspace);
class FixtureService extends NextMuxPlatformServiceImpl {
  nextmuxDataRoot() { return state; }
  register(registry, workspaceRoot) { return this.registerConversationTools(registry, workspaceRoot); }
}
let execution;
let replay;
try {
  const service = new FixtureService();
  const registry = new AgentToolRegistry();
  service.register(registry, workspace);
  execution = await registry.execute({
    id: 'provider-tool-acceptance',
    name: 'nextmux.create_conversation',
    arguments: parsed,
  }, 'full_access', { runId: 'provider-tool-acceptance' });
  replay = await registry.execute({
    id: 'provider-tool-acceptance-replay',
    name: 'nextmux.create_conversation',
    arguments: parsed,
  }, 'full_access', { runId: 'provider-tool-acceptance' });
} finally {
  await rm(root, { recursive: true, force: true });
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: response.ok && execution?.ok ? 'ready' : 'failed',
  source: 'authenticated-provider-to-local-tool-acceptance',
  provider: {
    origin: endpoint,
    modelRequested: model,
    modelReturned: payload?.model || null,
    httpStatus: response.status,
    latencyMs: Date.now() - startedAt,
    toolCallObserved: true,
    toolName: call.function.name,
  },
  localExecution: {
    ok: Boolean(execution?.ok),
    idempotent: Boolean(replay?.ok && replay?.output?.idempotent),
    replaySameConversation: Boolean(execution?.output?.conversationId && replay?.output?.conversationId
      && execution.output.conversationId === replay.output.conversationId),
    conversationCreated: Boolean(execution?.output?.conversationId),
    errorCode: execution?.ok ? null : execution?.error?.code || 'UNKNOWN',
  },
  promptSha256: createHash('sha256').update(prompt).digest('hex'),
  note: 'Temporary local project only; no provider key or conversation body persisted.',
};
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
