import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentToolRegistry, AgentRunner, MODEL_TOOL_LIMIT, type AgentToolDescriptor } from '../lib/index.js';
import { discoveredToolNames } from '../lib/tool-search.js';

function registry(count = 100) {
  const tools = new AgentToolRegistry();
  for (let index = 0; index < count; index++) tools.register({ name: `mcp.files.action_${index}`,
    description: index === count - 1 ? 'Find invoices 发票 搜索' : `Inspect resource ${index}`,
    inputSchema: { type: 'object', properties: { resourceId: { type: 'string' } }, required: ['resourceId'] },
    requiredPermission: 'full_access', source: 'mcp' }, async input => ({ modelOutput: { input }, summary: { title: 'found' } }));
  return tools;
}

test('large catalog stays discoverable beyond the former 48-tool cutoff without exposing every schema', async () => {
  const tools = registry(150);
  const allowed = tools.descriptors('full_access').map(tool => tool.name);
  const visible = tools.modelDescriptors('full_access', allowed, new Set());
  assert.equal(visible.filter(tool => tool.source === 'mcp').length, 0);
  assert.match(visible[0].description, /150 tools/);
  const found = await tools.execute({ id: 'search-1', name: 'tool.search', arguments: { query: '发票' } }, 'full_access', { runId: 'search-run', allowedToolNames: allowed });
  assert.equal(found.ok, true);
  const names = (found.output as { tools: AgentToolDescriptor[] }).tools.map(tool => tool.name);
  assert.deepEqual(names, ['mcp.files.action_149']);
  assert.equal(tools.modelDescriptors('full_access', allowed, new Set(names)).filter(tool => tool.source === 'mcp').length, 1);
  const result = await tools.execute({ id: 'found-1', name: names[0], arguments: { resourceId: 'bill' } }, 'full_access', { runId: 'search-run', allowedToolNames: allowed });
  assert.equal(result.ok, true);
});

test('discovery does not widen permission, Skill scope, or another conversation', async () => {
  const tools = registry();
  const limited = ['tool.search', 'mcp.files.action_0'];
  for (const permission of ['full_access', 'read_only'] as const) {
    const found = await tools.execute({ id: 'scope', name: 'tool.search', arguments: { query: '' } }, permission,
      { runId: 'limited-run', allowedToolNames: limited });
    const names = (found.output as {tools: AgentToolDescriptor[]}).tools.map(tool => tool.name);
    assert.deepEqual(names, permission === 'full_access' ? ['mcp.files.action_0'] : []);
  }
  assert.equal(tools.modelDescriptors('full_access', tools.descriptors('full_access').map(tool => tool.name), new Set()).filter(tool => tool.source === 'mcp').length, 0);
  assert.equal((await tools.execute({id:'denied',name:'mcp.files.action_99',arguments:{}}, 'full_access', {runId:'limited-run',allowedToolNames:limited})).error?.code,'TOOL_NOT_ALLOWED');
});

test('small catalogs stay directly callable; paginated discovery and registry updates are current', async () => {
  const tools = registry(3);
  assert.equal(tools.modelDescriptors('full_access', tools.descriptors('full_access').map(tool => tool.name), new Set()).filter(tool => tool.source === 'mcp').length,3);
  const first = await tools.execute({id:'page',name:'tool.search',arguments:{query:'',limit:1}},'full_access',{runId:'page-run'});
  assert.equal((first.output as { nextOffset: number }).nextOffset,1);
  tools.unregister('mcp.files.action_2');
  const removed = await tools.execute({id:'removed',name:'tool.search',arguments:{query:'发票'}},'full_access',{runId:'page-run'});
  assert.equal((removed.output as {total:number}).total,0);
  assert.throws(()=>tools.register({name:'tool.search',description:'spoof',inputSchema:{},requiredPermission:'read_only',source:'mcp'},async()=>({modelOutput:{},summary:{title:'spoof'}})),/provided by the host/);
});

test('runner discovers then natively calls a tool while keeping unrelated schemas out', async () => {
  const tools = registry(150);
  let turn = 0;
  const result = await new AgentRunner({ tools, permissionMode:'full_access', captureCheckpoint:true, model:{async complete(request) {
    turn++;
    if (turn === 1) { assert.equal(request.tools?.filter(tool=>tool.source==='mcp').length,0); return {toolCalls:[{id:'search-invoice',name:'tool.search',arguments:{query:'invoices'}}]}; }
    if (turn === 2) { assert.equal(request.tools?.filter(tool=>tool.source==='mcp').length,1); assert.ok(request.tools?.some(tool=>tool.name==='mcp.files.action_149')); return {toolCalls:[{id:'invoice',name:'mcp.files.action_149',arguments:{resourceId:'123'}}]}; }
    return {content:'Invoice checked.'};
  }}}).run({prompt:'Find an invoice',runId:'run-discovery-invoice'});
  assert.equal(result.status,'completed');
  assert.equal(turn,3);
  const names = discoveredToolNames(result.checkpoint?.messages ?? []);
  assert.ok(names.has('mcp.files.action_149'));
});

test('rediscovery makes an evicted schema callable again, including after checkpoint reconstruction', () => {
  const tools = registry(30);
  const history = Array.from({length: 20}, (_, index) => [
    {role:'assistant', content:'', toolCalls:[{id:`s${index}`,name:'tool.search'}]},
    {role:'tool',toolCallId:`s${index}`,content:JSON.stringify({ok:true,output:{tools:[{name:`mcp.files.action_${index}`} ]}})},
  ]).flat();
  history.push({role:'assistant',content:'',toolCalls:[{id:'rediscover',name:'tool.search'}]},
    {role:'tool',toolCallId:'rediscover',content:JSON.stringify({ok:true,output:{tools:[{name:'mcp.files.action_0'}]}})});
  const visible = tools.modelDescriptors('full_access', tools.descriptors('full_access').map(tool => tool.name), discoveredToolNames(history));
  assert.ok(visible.some(tool => tool.name === 'mcp.files.action_0'));
  assert.equal(visible.filter(tool => tool.source === 'mcp').length,12);
});

test('large schemas paginate by output budget without skipping tools', async () => {
  const tools = new AgentToolRegistry();
  for (let index=0;index<5;index++) tools.register({name:`mcp.large.action_${index}`,description:'Large parameters',
    inputSchema:{type:'object',properties:{value:{type:'string',description:'a'.repeat(19000)}}},
    requiredPermission:'read_only',source:'mcp'},async()=>({modelOutput:{},summary:{title:'ok'}}));
  const names:string[]=[];
  let offset:number|null=0;
  do {
    const result = await tools.execute({id:`large-${offset}`,name:'tool.search',arguments:{query:'',limit:5,offset}},'read_only',{runId:'large'});
    const output=result.output as {tools:AgentToolDescriptor[];nextOffset:number|null};
    assert.ok(JSON.stringify(output).length<24000);
    names.push(...output.tools.map(tool=>tool.name));
    offset=output.nextOffset;
  } while(offset!==null);
  assert.equal(new Set(names).size,5);
});

function hostRegistry() {
  const tools = new AgentToolRegistry();
  const add = (name: string, size = 400) => tools.register({ name, description: `${name} ${'x'.repeat(size)}`,
    inputSchema: { type: 'object', properties: { value: { type: 'string' } } }, requiredPermission: 'read_only', source: 'builtin' },
    async input => ({ modelOutput: { input }, summary: { title: name } }));
  for (const name of ['workspace.read_file', 'workspace.search_text', 'process.run']) add(name);
  for (let index = 0; index < 6; index++) add(`tabs.action_${index}`, 1500);
  for (let index = 0; index < 6; index++) add(`browser.action_${index}`, 1500);
  tools.configureDeferredGroups({ tabs: 'apps in this conversation’s tabs', browser: 'the built-in browser' });
  return tools;
}

test('more tools than one request may carry load optional groups on demand, and a request never exceeds the limit', () => {
  const tools = new AgentToolRegistry();
  const add = (name: string) => tools.register({ name, description: name, inputSchema: { type: 'object', properties: {} }, requiredPermission: 'read_only', source: 'builtin' },
    async input => ({ modelOutput: { input }, summary: { title: name } }));
  for (let index = 0; index < 70; index++) add(`workspace.action_${String(index).padStart(2, '0')}`);
  for (let index = 0; index < 40; index++) add(`tabs.action_${index}`);
  for (let index = 0; index < 40; index++) add(`browser.action_${index}`);
  tools.configureDeferredGroups({ tabs: 'apps in tabs', browser: 'the built-in browser' });
  const allowed = tools.descriptors('read_only').map(tool => tool.name);
  const sent = tools.modelDescriptors('read_only', allowed, new Set(), { schemaBudgetBytes: 10_000_000 });
  assert.ok(sent.length <= MODEL_TOOL_LIMIT, `${sent.length} tools`);
  assert.equal(sent.filter(tool => tool.name.startsWith('workspace.')).length, 70, 'core tools are all kept');
  assert.match(sent.find(tool => tool.name === 'tool.search')!.description, /Not loaded yet/);
});

test('a small context loads optional host groups on demand; a large one gets every schema directly', async () => {
  const tools = hostRegistry();
  const allowed = tools.descriptors('read_only').map(tool => tool.name);
  const large = tools.modelDescriptors('read_only', allowed, new Set(), { schemaBudgetBytes: 1_000_000 });
  assert.equal(large.length, 15, 'every tool, and no tool.search when nothing is deferred');
  assert.ok(!large.some(tool => tool.name === 'tool.search'));
  const small = tools.modelDescriptors('read_only', allowed, new Set(), { schemaBudgetBytes: 6000 });
  assert.deepEqual(small.map(tool => tool.name).filter(name => !name.startsWith('tool.')), ['process.run', 'workspace.read_file', 'workspace.search_text']);
  const search = small.find(tool => tool.name === 'tool.search')!;
  assert.match(search.description, /Not loaded yet/);
  assert.match(search.description, /browser\.\* \(6 tools: the built-in browser\)/);
  assert.match(search.description, /tabs\.\* \(6 tools: apps in this conversation’s tabs\)/);
  // The group name loads the whole group in one call.
  const found = await tools.execute({ id: 'group', name: 'tool.search', arguments: { query: 'tabs' } }, 'read_only', { runId: 'r', allowedToolNames: allowed });
  const names = (found.output as { tools: AgentToolDescriptor[] }).tools.map(tool => tool.name);
  assert.deepEqual(names, ['tabs.action_0', 'tabs.action_1', 'tabs.action_2', 'tabs.action_3', 'tabs.action_4', 'tabs.action_5']);
  const next = tools.modelDescriptors('read_only', allowed, new Set(names), { schemaBudgetBytes: 6000 });
  assert.equal(next.filter(tool => tool.name.startsWith('tabs.')).length, 6, 'found tools are loaded next turn');
  // A tool used earlier stays loaded even without a search in this turn.
  const used = tools.modelDescriptors('read_only', allowed, new Set(), { schemaBudgetBytes: 6000, used: new Set(['browser.action_2']) });
  assert.equal(used.filter(tool => tool.name.startsWith('browser.')).length, 6, 'a used tool keeps its group loaded');
});

test('the runner sends core tools to a small-context model and loads a group after tool.search', async () => {
  const tools = hostRegistry();
  let turn = 0;
  const result = await new AgentRunner({ tools, permissionMode: 'read_only', contextWindowTokens: 12288, model: { async complete(request) {
    turn++;
    const names = (request.tools ?? []).map(tool => tool.name);
    if (turn === 1) { assert.ok(!names.some(name => name.startsWith('tabs')), 'tabs deferred'); return { toolCalls: [{ id: 'find', name: 'tool.search', arguments: { query: 'tabs' } }] }; }
    if (turn === 2) { assert.ok(names.filter(name => name.startsWith('tabs')).length === 6, 'tabs loaded'); return { toolCalls: [{ id: 'use', name: 'tabs.action_1', arguments: { value: 'a' } }] }; }
    return { content: 'Done.' };
  } } }).run({ prompt: 'Use the tab', runId: 'run-deferred-groups' });
  assert.equal(result.status, 'completed');
  assert.equal(turn, 3);
});

test('tools used in earlier turns of the conversation stay loaded in a new run on a small context', async () => {
  const tools = hostRegistry();
  let seen: string[] = [];
  await new AgentRunner({ tools, permissionMode: 'read_only', contextWindowTokens: 12288, model: { async complete(request) {
    seen = (request.tools ?? []).map(tool => tool.name);
    return { content: 'ok' };
  } } }).run({ prompt: 'Mute it', runId: 'run-pinned-tools', pinnedToolNames: ['tabs.action_3'] });
  assert.equal(seen.filter(name => name.startsWith('tabs.')).length, 6, 'the whole group of a tool used before is loaded without a search');
});

test('catalog warnings accumulate for the model instead of the last one hiding the others', async () => {
  const tools = registry(150);
  tools.setCatalogWarning('Tool catalog contains the first 64 running MCP servers.');
  tools.setCatalogWarning('Left out MCP tools whose input schema is invalid or unsupported: files/broken.');
  tools.setCatalogWarning('Tool catalog contains the first 64 running MCP servers.');
  tools.setCatalogWarning('   ');
  const allowed = tools.descriptors('full_access').map(tool => tool.name);
  const search = tools.modelDescriptors('full_access', allowed, new Set()).find(tool => tool.name === 'tool.search')!;
  assert.match(search.description, /first 64 running MCP servers\. Left out MCP tools whose input schema is invalid or unsupported: files\/broken\.$/);
  assert.equal(search.description.match(/first 64 running/g)?.length, 1, 'a repeated warning is kept once');
  const found = await tools.execute({ id: 'warn', name: 'tool.search', arguments: { query: 'nothing-matches-this' } }, 'full_access', { runId: 'warn-run', allowedToolNames: allowed });
  assert.match((found.output as { warning: string }).warning, /first 64[\s\S]*files\/broken/);
  tools.setCatalogWarning('x'.repeat(2000));
  assert.ok((((await tools.execute({ id: 'warn-2', name: 'tool.search', arguments: { query: 'nothing' } }, 'full_access', { runId: 'warn-run', allowedToolNames: allowed })).output as { warning: string }).warning.length) <= 1000);
});
