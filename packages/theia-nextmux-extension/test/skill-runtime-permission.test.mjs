import assert from 'node:assert/strict';
import { SKILL_LIMITS } from '../lib/common/nextmux-skill-format.js';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AgentRunner, AgentToolRegistry } from '@nextmux/agent-runtime';
import { readVerifiedAgentSkill } from '../lib/node/nextmux-skill-snapshot.js';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { AgentRunStateStore } from '../lib/node/nextmux-agent-run-state-store.js';

const source = (declaration = 'allowedTools: [test.read]', instructions = 'Read only from the verified source.') =>
  `---\nname: read-skill\ndescription: Verified skill\n${declaration}\n---\n${instructions}\n`;
const digest = text => createHash('sha256').update(text).digest('hex');
async function fixture(t, content = source()) {
  const directory = await mkdtemp(join(tmpdir(), 'nextmux-skill-policy-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const workspace = join(directory, 'workspace');
  const approvedGlobal = join(directory, 'global');
  const outside = join(directory, 'outside');
  await Promise.all([workspace, approvedGlobal, outside].map(path => mkdir(path)));
  const sourcePath = join(workspace, 'SKILL.md');
  await writeFile(sourcePath, content);
  const reference = { name: 'read-skill', sourcePath, sourceSha256: digest(content), description: 'Renderer must not control this', instructions: 'WRITE EVERYTHING', allowedTools: ['test.write'] };
  return { directory, workspace, approvedGlobal, outside, reference };
}

test('host uses one verified source for instructions and declarations, ignoring renderer permission/body claims', async t => {
  const f = await fixture(t);
  const snapshot = await readVerifiedAgentSkill(f.reference, [f.workspace]);
  assert.equal(snapshot.instructions, 'Read only from the verified source.');
  assert.deepEqual(snapshot.allowedTools, ['test.read']);
  assert.equal(snapshot.policy.sourceHash, f.reference.sourceSha256);
  assert.equal(snapshot.policy.id, digest(snapshot.sourcePath));
});

for (const declaration of ['allowedTools: []', 'allowed-tools: []', '']) test(`declaration ${declaration || '(absent)'} preserves its exact deny/inherit semantics`, async t => {
  const f = await fixture(t, source(declaration));
  const snapshot = await readVerifiedAgentSkill(f.reference, [f.workspace]);
  assert.deepEqual(snapshot.allowedTools, declaration ? [] : undefined);
  assert.deepEqual(snapshot.policy.allowedToolNames, declaration ? [] : undefined);
});

for (const declaration of ['allowedTools: null', 'allowedTools: test.read', 'allowedTools: ["test.*"]', 'allowedTools: [Read]', 'allowedTools: [test.read]\nallowed-tools: [test.write]']) {
  test(`invalid or ambiguous declaration is rejected: ${declaration}`, async t => {
    const f = await fixture(t, source(declaration));
    await assert.rejects(readVerifiedAgentSkill(f.reference, [f.workspace]), { code: 'INVALID_TOOL_POLICY' });
  });
}

test('source snapshot rejects stale hashes, invalid paths and unapproved roots', async t => {
  const f = await fixture(t);
  await assert.rejects(readVerifiedAgentSkill({ ...f.reference, sourceSha256: 'a'.repeat(64) }, [f.workspace]), { code: 'SKILL_SOURCE_CHANGED' });
  await assert.rejects(readVerifiedAgentSkill({ ...f.reference, sourcePath: 'relative/SKILL.md' }, [f.workspace]), { code: 'INVALID_SKILL_SOURCE' });
  await assert.rejects(readVerifiedAgentSkill(f.reference, [f.approvedGlobal]), { code: 'SKILL_SOURCE_UNAPPROVED' });
  await assert.rejects(readVerifiedAgentSkill({ ...f.reference, name: 'renamed' }, [f.workspace]), { code: 'INVALID_SKILLS' });
});

test('configured global root works but a workspace symlink cannot escape to arbitrary files', async t => {
  const f = await fixture(t);
  const globalPath = join(f.approvedGlobal, 'SKILL.md');
  await writeFile(globalPath, source());
  const global = await readVerifiedAgentSkill({ ...f.reference, sourcePath: globalPath }, [f.workspace, f.approvedGlobal]);
  assert.deepEqual(global.allowedTools, ['test.read']);
  const outsidePath = join(f.outside, 'SKILL.md');
  await writeFile(outsidePath, source());
  const linkDirectory = join(f.workspace, 'linked');
  await symlink(f.outside, linkDirectory, 'dir');
  await assert.rejects(readVerifiedAgentSkill({ ...f.reference, sourcePath: join(linkDirectory, 'SKILL.md') }, [f.workspace, f.approvedGlobal]), { code: 'SKILL_SOURCE_UNAPPROVED' });
});

test('file size and body size are bounded and non-files cannot be parsed', async t => {
  const f = await fixture(t, source('', 'x'.repeat(SKILL_LIMITS.fileBytes + 1)));
  await assert.rejects(readVerifiedAgentSkill(f.reference, [f.workspace]), { code: 'INVALID_SKILL_SOURCE' });
  const content = source('', 'x'.repeat(SKILL_LIMITS.instructions + 1));
  await writeFile(f.reference.sourcePath, content);
  await assert.rejects(readVerifiedAgentSkill({ ...f.reference, sourceSha256: digest(content) }, [f.workspace]), { code: 'INVALID_SKILLS' });
  const parent = join(f.workspace, 'directory');
  await mkdir(parent); await mkdir(join(parent, 'SKILL.md'));
  await assert.rejects(readVerifiedAgentSkill({ ...f.reference, sourcePath: join(parent, 'SKILL.md') }, [f.workspace]), { code: 'INVALID_SKILL_SOURCE' });
});

test('actual Node registration revalidates at load and applies file policy in the agent loop', async t => {
  const f = await fixture(t);
  const service = new NextMuxPlatformServiceImpl();
  service.skillEnvironment = { async getConfigDirUri() { return pathToFileURL(f.approvedGlobal).toString(); } };
  const registry = new AgentToolRegistry();
  let effects = 0;
  registry.register({ name: 'test.write', requiredPermission: 'workspace_write', source: 'builtin', description: 'fake write', inputSchema: {} }, async () => { effects++; return { modelOutput: {}, summary: { title: 'write' } }; });
  await service.registerSkills(registry, [f.reference], f.workspace);
  let turn = 0;
  const runner = new AgentRunner({ tools: registry, permissionMode: 'workspace_write', model: { async complete() {
    return [{ toolCalls: [{ id: 'load', name: 'skill.load', arguments: { name: f.reference.name } }] },
      { toolCalls: [{ id: 'write', name: 'test.write', arguments: {} }] }, { content: 'done' }][turn++];
  } } });
  await runner.run({ prompt: 'test' });
  assert.equal(effects, 0);
  await writeFile(f.reference.sourcePath, source('allowedTools: [test.write]', 'New unapproved content'));
  const changed = await registry.execute({ id: 'changed', name: 'skill.load', arguments: { name: f.reference.name } }, 'workspace_write', { runId: 'run-node-changed' });
  assert.equal(changed.ok, false);
  assert.equal(changed.error.code, 'SKILL_SOURCE_CHANGED');
  assert.equal(changed.output, undefined);
  assert.equal(changed.skillPolicy, undefined);
});

test('Node registry refuses duplicate or missing source snapshots', async t => {
  const f = await fixture(t);
  const service = new NextMuxPlatformServiceImpl();
  service.skillEnvironment = { async getConfigDirUri() { return pathToFileURL(f.approvedGlobal).toString(); } };
  await assert.rejects(service.registerSkills(new AgentToolRegistry(), [f.reference, f.reference], f.workspace), { code: 'INVALID_SKILLS' });
  const { sourcePath, sourceSha256, ...legacy } = f.reference;
  await assert.rejects(service.registerSkills(new AgentToolRegistry(), [legacy], f.workspace), { code: 'INVALID_SKILL_SOURCE' });
});

test('a malformed global Skill cannot prevent valid Skills or an ordinary task from running', async t => {
  const f = await fixture(t);
  const globalRoot = join(f.approvedGlobal, 'skills');
  await mkdir(globalRoot);
  const badPath = join(globalRoot, 'SKILL.md');
  const badBody = source('', 'x'.repeat(SKILL_LIMITS.instructions + 1));
  await writeFile(badPath, badBody);
  const bad = { ...f.reference, sourcePath: badPath, sourceSha256: digest(badBody) };
  const service = new NextMuxPlatformServiceImpl();
  service.skillEnvironment = { async getConfigDirUri() { return pathToFileURL(f.approvedGlobal).toString(); } };
  const registry = new AgentToolRegistry();
  await service.registerSkills(registry, [bad, f.reference], f.workspace);
  const loaded = await registry.execute({ id: 'load-good', name: 'skill.load', arguments: { name: f.reference.name } }, 'read_only', { runId: 'run-skill-isolation' });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.output.instructions, 'Read only from the verified source.');
  const ordinaryRegistry = new AgentToolRegistry();
  await service.registerSkills(ordinaryRegistry, [bad], f.workspace);
  let calls = 0;
  await new AgentRunner({ tools: ordinaryRegistry, permissionMode: 'read_only', model: { async complete(request) {
    calls++; assert.ok(request.tools.every(tool => tool.name !== 'skill.load')); return { content: 'ordinary task works' };
  } } }).run({ prompt: 'Do an ordinary task' });
  assert.equal(calls, 1);
});

test('disk checkpoint roundtrip preserves Skill scope across a fresh Node host registry', async t => {
  const f = await fixture(t, source('allowedTools: []'));
  const makeRegistry = async () => {
    const service = new NextMuxPlatformServiceImpl();
    service.skillEnvironment = { async getConfigDirUri() { return pathToFileURL(f.approvedGlobal).toString(); } };
    const registry = new AgentToolRegistry();
    await service.registerSkills(registry, [f.reference], f.workspace);
    return registry;
  };
  let turn = 0;
  const first = await new AgentRunner({ tools: await makeRegistry(), permissionMode: 'workspace_write', captureCheckpoint: true,
    model: { async complete() { return turn++ ? { content: 'done' } : { toolCalls: [{ id: 'load', name: 'skill.load', arguments: { name: f.reference.name } }] }; } },
  }).run({ prompt: 'test' });
  const store = new AgentRunStateStore(join(f.directory, 'state'));
  const owner = { workspaceRoot: f.workspace, conversationId: 'conversation-skill-safe', rootRunId: first.runId, depth: 0 };
  const id = await store.save(first.checkpoint, owner);
  const restored = await store.load(id, { expectedOwner: owner });
  assert.deepEqual(restored.toolPolicy, first.checkpoint.toolPolicy);
  const result = await new AgentRunner({ tools: await makeRegistry(), permissionMode: 'workspace_write', captureCheckpoint: true,
    model: { async complete(request) { assert.ok(request.tools.every(tool => tool.name === 'skill.load' || tool.name === 'task.update_plan')); return { content: 'resumed' }; } },
  }).run({ prompt: 'continue', checkpoint: restored });
  assert.deepEqual(result.checkpoint.toolPolicy, first.checkpoint.toolPolicy);
  await writeFile(f.reference.sourcePath, source('allowedTools: [test.write]'));
  await assert.rejects(makeRegistry(), { code: 'SKILL_SOURCE_CHANGED' });
});

test('task Skill validation preserves distinct RPC reasons and exact limits', async t => {
  const f = await fixture(t);
  const service = new NextMuxPlatformServiceImpl();
  service.skillEnvironment = { async getConfigDirUri() { return pathToFileURL(f.approvedGlobal).toString(); } };
  await assert.rejects(service.registerSkills(new AgentToolRegistry(), Array.from({ length: 25 }, () => f.reference), f.workspace), error => {
    assert.equal(error.code, 'INVALID_SKILLS');
    assert.equal(error.data.domainError.code, 'SKILL_TASK_LIMIT');
    assert.deepEqual(error.data.domainError.params, { limit: 24 });
    assert.match(error.message, /24/);
    return true;
  });
  await assert.rejects(service.registerSkills(new AgentToolRegistry(), [f.reference, f.reference], f.workspace), error => {
    assert.equal(error.code, 'INVALID_SKILLS');
    assert.equal(error.data.domainError.code, 'SKILL_DUPLICATE_NAME');
    assert.deepEqual(error.data.domainError.params, { name: f.reference.name });
    return true;
  });
  const references = [];
  for (let index = 0; index < 6; index++) {
    const name = `long-skill-${index}`;
    const directory = join(f.workspace, name);
    await mkdir(directory);
    const content = `---\nname: ${name}\ndescription: Long instructions\n---\n${'x'.repeat(24000)}\n`;
    const sourcePath = join(directory, 'SKILL.md');
    await writeFile(sourcePath, content);
    references.push({ name, sourcePath, sourceSha256: digest(content) });
  }
  await assert.rejects(service.registerSkills(new AgentToolRegistry(), references, f.workspace), error => {
    assert.equal(error.code, 'INVALID_SKILLS');
    assert.equal(error.data.domainError.code, 'SKILL_TOTAL_INSTRUCTIONS_LIMIT');
    assert.deepEqual(error.data.domainError.params, { limit: 120000 });
    assert.doesNotMatch(error.message, /[\u4e00-\u9fff]/);
    return true;
  });
});
