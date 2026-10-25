import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentDelegationRuntime, AgentToolRegistry, createToolNameCodec } from '../lib/index.js';

function fixture(maxDepth=1) {
  const tools = new AgentToolRegistry();
  for (const name of ['workspace.read_file','workspace.write_file']) tools.register({name,description:name,requiredPermission:name.endsWith('write_file')?'workspace_write':'read_only',source:'builtin',inputSchema:{type:'object'}},async()=>({modelOutput:{ok:true},summary:{title:name}}));
  let modelCalls=0,prepared=0;let offered:string[]=[];
  new AgentDelegationRuntime({tools,maxDepth,allowedToolNames:['workspace.read_file','workspace.write_file'],maxPermissionMode:'workspace_write',
    prepareWorkspace:async()=>{prepared++;throw new Error('unexpected isolated write in selection-only fixture');},
    model:{async complete(request){modelCalls++;offered=request.tools.map(t=>t.name);return {content:'text complete'};}},
  }).register();
  return {tools,stats:()=>({modelCalls,prepared,offered})};
}

test('unknown aliases fail before child billing or workspace allocation, including a mixed valid list',async()=>{
 for(const names of [['workspace_unknown_file'],['workspace.read_file','workspace_unknown_file']]){
  const f=fixture();const r=await f.tools.execute({id:'alias',name:'agent.delegate',arguments:{task:'read then write',tools:names}},'workspace_write',{runId:'alias-parent'});
  assert.equal(r.ok,false);assert.equal(r.error?.code,'INVALID_DELEGATION_TOOLS');assert.match(r.error?.message||'',/registered tool names/);assert.deepEqual(f.stats(),{modelCalls:0,prepared:0,offered:[]});
 }
});
test('known tools fully removed by parent policy fail without starting a text-only child',async()=>{
 const f=fixture();const r=await f.tools.execute({id:'policy',name:'agent.delegate',arguments:{task:'write',tools:['workspace.write_file']}},'workspace_write',{runId:'policy-parent',allowedToolNames:['agent.delegate']});
 assert.equal(r.ok,false);assert.equal(r.error?.code,'DELEGATION_TOOLS_UNAVAILABLE');assert.equal(f.stats().modelCalls,0);assert.equal(f.stats().prepared,0);
});
test('canonical read selection remains usable and partial policy intersections do not widen tools',async()=>{
 const f=fixture();const r=await f.tools.execute({id:'canonical',name:'agent.delegate',arguments:{task:'read',tools:['workspace.read_file','workspace.write_file']}},'workspace_write',{runId:'canonical-parent',allowedToolNames:['agent.delegate','workspace.read_file']});
 assert.equal(r.ok,true);assert.equal(f.stats().modelCalls,1);assert.deepEqual(f.stats().offered,['workspace.read_file']);
});
test('an explicit empty allowlist remains a deliberate text-only delegation',async()=>{
 const f=fixture();const r=await f.tools.execute({id:'text',name:'agent.delegate',arguments:{task:'summarize supplied sentence',tools:[]}},'workspace_write',{runId:'text-parent'});
 assert.equal(r.ok,true);assert.equal(f.stats().modelCalls,1);assert.deepEqual(f.stats().offered,[]);
});


test('lower child permission cannot turn an explicit write task into paid text-only success',async()=>{
 const f=fixture();const r=await f.tools.execute({id:'lower',name:'agent.delegate',arguments:{task:'write',tools:['workspace.write_file'],permissionMode:'read_only'}},'workspace_write',{runId:'lower-parent'});
 assert.equal(r.ok,false);assert.equal(r.error?.code,'DELEGATION_TOOLS_UNAVAILABLE');assert.equal(f.stats().modelCalls,0);assert.equal(f.stats().prepared,0);
});


test('automatic recursive delegate does not satisfy a denied explicit write selection',async()=>{
 const f=fixture(2);const r=await f.tools.execute({id:'recursive-lower',name:'agent.delegate',arguments:{task:'write',tools:['workspace.write_file'],permissionMode:'read_only'}},'workspace_write',{runId:'recursive-parent',delegationDepth:0});
 assert.equal(r.ok,false);assert.equal(r.error?.code,'DELEGATION_TOOLS_UNAVAILABLE');assert.equal(f.stats().modelCalls,0);assert.equal(f.stats().prepared,0);
});


test('known provider aliases decode to canonical tools before the same parent policy intersection',async()=>{
 const f=fixture();const r=await f.tools.execute({id:'known-alias',name:'agent.delegate',arguments:{task:'read',tools:['workspace_read_file','workspace_write_file']}},'workspace_write',{runId:'known-parent',allowedToolNames:['agent.delegate','workspace.read_file']});
 assert.equal(r.ok,true);assert.equal(f.stats().modelCalls,1);assert.deepEqual(f.stats().offered,['workspace.read_file']);
});

test('provider write aliases cannot bypass a lower child permission or parent scope',async()=>{
 for(const context of [{allowedToolNames:['agent.delegate']},{}]){
  const f=fixture(2);const r=await f.tools.execute({id:'restricted-alias',name:'agent.delegate',arguments:{task:'write',tools:['workspace_write_file'],permissionMode:'read_only'}},'workspace_write',{runId:'restricted-parent',...context});
  assert.equal(r.ok,false);assert.equal(r.error?.code,'DELEGATION_TOOLS_UNAVAILABLE');assert.equal(f.stats().modelCalls,0);assert.equal(f.stats().prepared,0);
 }
});

test('collision-safe full registry aliases never select a similarly named tool from a narrowed set',async()=>{
 const registry = new AgentToolRegistry();let offered:string[]=[];
 for(const name of ['workspace.read_file','workspace_read_file'])registry.register({name,description:name,requiredPermission:'read_only',source:'builtin',inputSchema:{type:'object'}},async()=>({modelOutput:{},summary:{title:name}}));
 new AgentDelegationRuntime({tools:registry,maxDepth:1,allowedToolNames:['workspace.read_file','workspace_read_file'],maxPermissionMode:'read_only',model:{async complete(request){offered=request.tools.map(t=>t.name);return {content:'done'};}}}).register();
 const codec=createToolNameCodec(registry.descriptors('full_access'));
 const dotted=codec.encode('workspace.read_file');assert.notEqual(dotted,'workspace_read_file');
 for(const [name,expected] of [[dotted,'workspace.read_file'],['workspace_read_file','workspace_read_file']]){
  const result=await registry.execute({id:name,name:'agent.delegate',arguments:{task:'read',tools:[name]}},'read_only',{runId:'collision-parent',allowedToolNames:['agent.delegate',expected]});
  assert.equal(result.ok,true);assert.deepEqual(offered,[expected]);
 }
 const denied=await registry.execute({id:'collision-denied',name:'agent.delegate',arguments:{task:'read',tools:['workspace_read_file']}},'read_only',{runId:'collision-parent',allowedToolNames:['agent.delegate','workspace.read_file']});
 assert.equal(denied.ok,false);assert.equal(denied.error?.code,'DELEGATION_TOOLS_UNAVAILABLE');
});
