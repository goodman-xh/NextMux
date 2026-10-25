import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentRunner, AgentToolRegistry, DEFAULT_AGENT_INSTRUCTIONS, agentTaskContextInstruction, childAgentTaskContext,
  createAgentTaskContext, validateAgentTaskContext, type AgentModelMessage } from '../lib/index.js';

// Every turn, in every workbench and in delegated children, knows it runs inside NextMux and may tell the user
// its conversation ID, workspace and workbench when asked.

test('the task context names the application, workbench, workspace and conversation', () => {
  const context = createAgentTaskContext({ workspaceRoot: '/Users/me/project', conversationId: 'conversation-42', workbench: 'comic', goal: 'Draw the cover' });
  const block = agentTaskContextInstruction(context);
  assert.match(block, /^<nextmux-task-context>\n/);
  assert.match(block, /\napplication: NextMux\nworkbench: comic\nworkspaceRoot: \/Users\/me\/project\nconversationId: conversation-42\n/);
  assert.match(block, new RegExp(`\\nplatform: ${process.platform}\\narch: ${process.arch}\\n`));
  assert.match(block, /When the user asks for the current conversation ID, workspace path, workbench or host application, give the exact conversationId, workspaceRoot, workbench and application values from this block\./);
  assert.match(DEFAULT_AGENT_INSTRUCTIONS, /^You are running inside NextMux,/);
  assert.match(DEFAULT_AGENT_INSTRUCTIONS, /If the user asks for the current conversation ID, workspace path, workbench or host application, answer with the exact values from <nextmux-task-context>\./);
  assert.match(DEFAULT_AGENT_INSTRUCTIONS, /re-read the target lines with workspace\.read_file before retrying/);
  assert.match(DEFAULT_AGENT_INSTRUCTIONS, /non-interactive flags \(-y, --yes, CI=1, --no-pager\)/);
  assert.match(DEFAULT_AGENT_INSTRUCTIONS, /Never revert, stash, or overwrite uncommitted changes/);
  assert.match(DEFAULT_AGENT_INSTRUCTIONS, /When permissionMode is read_only/);
  assert.match(DEFAULT_AGENT_INSTRUCTIONS, /verify modified code with targeted typechecks, linters, or tests/);
});

test('a delegated child inherits the workbench and conversation; a context without a workbench omits the line', () => {
  const parent = createAgentTaskContext({ workspaceRoot: '/w', conversationId: 'conversation-7', workbench: 'coding', goal: 'Ship it', rootRunId: 'root-run-0001' });
  const child = childAgentTaskContext(parent, { goal: 'Write the tests', parentRunId: 'root-run-0001' });
  assert.equal(child.workbench, 'coding');
  assert.equal(child.conversationId, 'conversation-7');
  assert.match(agentTaskContextInstruction(child), /\nworkbench: coding\n/);
  const legacy = validateAgentTaskContext({ ...parent, workbench: undefined });
  assert.equal(legacy.workbench, undefined, 'a checkpoint saved before the field existed still validates');
  assert.doesNotMatch(agentTaskContextInstruction(legacy), /workbench:/);
  assert.match(agentTaskContextInstruction(legacy), /\napplication: NextMux\n/);
  assert.throws(() => createAgentTaskContext({ workspaceRoot: '/w', goal: 'x', workbench: 'Coding Studio' }), /workbench is invalid/);
});

test('the model request of a run carries the context block in its instructions', async () => {
  let instructions = '';
  let messages: readonly AgentModelMessage[] = [];
  const runner = new AgentRunner({ tools: new AgentToolRegistry(), permissionMode: 'read_only',
    taskContext: createAgentTaskContext({ workspaceRoot: '/w', conversationId: 'conversation-9', workbench: 'coding', goal: '请把当前对话的id发给我' }),
    model: { async complete(request) { instructions = request.instructions ?? ''; messages = request.messages; return { content: 'conversation-9' }; } } });
  const result = await runner.run({ prompt: '请把当前对话的id发给我', runId: 'run-host-identity-001' });
  assert.equal(result.status, 'completed');
  const text = [instructions, ...messages.map(message => message.content)].join('\n');
  assert.match(text, /application: NextMux/);
  assert.match(text, /conversationId: conversation-9/);
  assert.match(text, /workbench: coding/);
});
