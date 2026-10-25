import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ToolExecutionLedger, AgentToolRegistry } from '../lib/index.js';

for (const corrupt of [false, true]) test(`large tool images are durable and ${corrupt ? 'corruption refuses replay' : 'replay in a fresh process'}`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'nm-tool-media-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const journalPath = join(root, 'ledger.jsonl');
  const registry = new AgentToolRegistry({ executionLedger: await ToolExecutionLedger.open({ journalPath }) });
  let calls = 0;
  const descriptor = { name: 'test.screen', description: 'screen', inputSchema: { type: 'object' }, requiredPermission: 'full_access' as const, source: 'mcp' as const, executionKind: 'side_effect' as const };
  const dataBase64 = Buffer.alloc(900_000, 1).toString('base64');
  registry.register(descriptor, async () => { calls++; return { modelOutput: { screen: true }, summary: { title: 'screen' }, attachments: [{ kind: 'image', name: 'screen', mimeType: 'image/png', dataBase64 }] }; });
  const call = { id: 'original', name: descriptor.name, arguments: {} };
  const context = { runId: 'run-media-test', executionScopeId: 'scope-media-test' };
  const first = await registry.execute(call, 'full_access', context);
  assert.equal(first.ok, true); assert.equal(first.ledger?.state, 'committed');
  assert.equal(first.attachments?.[0].kind, 'image');
  const journal = await readFile(journalPath, 'utf8');
  assert.ok(journal.length < 10_000); assert.ok(!journal.includes(dataBase64));
  const [asset] = await readdir(`${journalPath}.assets`);
  if (corrupt) await writeFile(join(`${journalPath}.assets`, asset), 'tampered');
  const source = `const {AgentToolRegistry,ToolExecutionLedger}=require(${JSON.stringify(new URL('../lib/index.js', import.meta.url).pathname)}); (async()=>{const registry=new AgentToolRegistry({executionLedger:await ToolExecutionLedger.open({journalPath:${JSON.stringify(journalPath)}})});registry.register(${JSON.stringify(descriptor)},async()=>{throw new Error('must not execute')});const r=await registry.execute(${JSON.stringify(call)},'full_access',${JSON.stringify(context)}); console.log(JSON.stringify({ok:r.ok,replayed:r.ledger?.replayed,error:r.error?.code,size:r.attachments?.[0]?.dataBase64?.length}));})().catch(e=>{console.error(e);process.exit(1)});`;
  const child = spawnSync(process.execPath, ['-e', source], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const recovered = JSON.parse(child.stdout);
  assert.equal(recovered.replayed, true);
  assert.equal(calls, 1);
  if (corrupt) { assert.equal(recovered.ok, false); assert.equal(recovered.error, 'TOOL_EXECUTION_UNKNOWN'); }
  else { assert.equal(recovered.ok, true); assert.equal(recovered.size, dataBase64.length); }
});
