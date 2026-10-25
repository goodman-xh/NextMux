import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentRunner, AgentToolRegistry, AgentToolError, rebaseAgentRunCheckpoint, type AgentRunResult } from '../lib/index.js';

const usage = { inputTokens: 11, outputTokens: 3 };
const edit = (id='edit') => ({id,name:'workspace.write_file',arguments:{path:'notes.txt',content:'changed once\n'}});
const check = (id='check') => ({id,name:'process.run',arguments:{command:'node',args:['--test','test/notes.test.mjs']}});
function tools({failed=false,exitCode=0}={}) {
  const registry = new AgentToolRegistry(); const counts={edits:0,checks:0};
  registry.register({name:'workspace.write_file',description:'edit',inputSchema:{type:'object'},requiredPermission:'workspace_write',source:'builtin'},async()=>{
    counts.edits++;
    if(failed)throw new AgentToolError('PATCH_INVALID','Synthetic rejected edit wrote no bytes');
    return {modelOutput:{path:'notes.txt'},summary:{title:'Edited',resource:{kind:'file' as const,path:'notes.txt',action:'updated' as const}}};
  });
  registry.register({name:'process.run',description:'check',inputSchema:{type:'object'},requiredPermission:'full_access',source:'builtin'},async()=>{
    counts.checks++;return {modelOutput:{exitCode},summary:{title:'Check',commandLine:'node --test test/notes.test.mjs'}};
  });
  return {registry,counts};
}
const notices=(result:AgentRunResult)=>result.events.filter(e=>e.type==='assistant_progress'&&e.origin==='runtime'&&/Runtime verification/.test(e.content??''));
const options=(registry:AgentToolRegistry)=>({tools:registry,permissionMode:'full_access' as const,captureCheckpoint:true});

for(const prompt of ['Change notes.txt only; stop after writing. Do not inspect or run checks.','Update the source file.']) {
  test(`successful edit final does not manufacture another model/tool round: ${prompt}`,async()=>{
    const {registry,counts}=tools();let calls=0;
    const result=await new AgentRunner({...options(registry),model:{async complete(){
      if(++calls===1)return{toolCalls:[edit()],usage};
      assert.equal(calls,2,'a verification reminder must not create a third request');
      return{content:'Changed. All tests passed.',usage};
    }}}).run({prompt,runId:`run-success-final-${prompt.length}`});
    assert.equal(calls,2);assert.deepEqual(counts,{edits:1,checks:0});
    assert.equal(result.verification?.status,'unverified');assert.deepEqual(result.verification?.changedPaths,['notes.txt']);
    assert.equal(notices(result).length,0);assert.deepEqual(result.usage,{inputTokens:22,outputTokens:6});
  });
}

for(const exitCode of [0,7]) {
  test(`a model-volunteered check remains ${exitCode===0?'passed':'failed'} without an automatic repair/check round`,async()=>{
    const {registry,counts}=tools({exitCode});let calls=0;
    const result=await new AgentRunner({...options(registry),model:{async complete(){
      calls++;if(calls===1)return{toolCalls:[edit()],usage};if(calls===2)return{toolCalls:[check()],usage};
      assert.equal(calls,3);return{content:exitCode?'The check failed.':'The check passed.',usage};
    }}}).run({prompt:'Change and check notes.txt',runId:`run-voluntary-check-${exitCode}`});
    assert.deepEqual(counts,{edits:1,checks:1});assert.equal(calls,3);
    assert.equal(result.verification?.status,exitCode?'failed':'passed');assert.equal(result.verification?.checks[0]?.exitCode,exitCode);
    assert.equal(notices(result).length,0);
  });
}

async function failedRun(runId:string) {
  const {registry,counts}=tools({failed:true});let calls=0;const delivered:unknown[]=[];
  const result=await new AgentRunner({...options(registry),onEvent:event=>{delivered.push(event);},model:{async complete(){
    calls++;if(calls===1)return{toolCalls:[edit()],usage};
    assert.equal(calls,2,'there must be no report-only request that could return another edit');
    return{content:'Done. All checks passed.',usage};
  }}}).run({prompt:'Only the requested edit, then stop.',runId});
  assert.equal(calls,2);assert.deepEqual(counts,{edits:1,checks:0});assert.equal(result.verification?.status,'failed');
  assert.deepEqual(result.verification?.failedEdits,['notes.txt']);assert.equal(notices(result).length,0,'no extra runtime verification prose is added');
  const failed=result.events.filter(e=>e.type==='tool_completed').filter(e=>!e.ok);
  assert.equal(failed.length,1);assert.equal(failed[0].failure?.code,'PATCH_INVALID');
  assert.equal(delivered.filter(e=>(e as {type:string;ok?:boolean}).type==='tool_completed'&&(e as {ok?:boolean}).ok===false).length,1);
  assert.deepEqual(result.checkpoint?.verification?.failedEdits,['notes.txt']);
  return result;
}

test('a failed edit retains its actual failed tool event with no paid correction or repair turn',async()=>{
  await failedRun('run-failed-factual-001');
});

test('restored failed checkpoint retains failed edits without hiding facts behind the old prompted flag',async()=>{
  const first=await failedRun('run-failed-legacy-flag-001');
  const checkpoint={...first.checkpoint!,verificationPrompted:true};const {registry,counts}=tools({failed:true});let calls=0;
  const result=await new AgentRunner({...options(registry),model:{async complete(){calls++;return{content:'No edits were applied.',usage};}}})
    .run({prompt:'Resume the existing failed result',runId:checkpoint.runId,checkpoint});
  assert.equal(calls,1);assert.deepEqual(counts,{edits:0,checks:0});assert.equal(notices(result).length,0);
  assert.equal(result.verification?.status,'failed');
  assert.deepEqual(result.checkpoint?.verification?.failedEdits,['notes.txt']);
});

test('old prompted=true after success never disables tools for the normal explicit next task',async()=>{
  const {registry,counts}=tools();let firstCalls=0;
  const first=await new AgentRunner({...options(registry),model:{async complete(){return ++firstCalls===1?{toolCalls:[edit('old-edit')],usage}:{content:'Old task done.',usage};}}})
    .run({prompt:'Previous task',runId:'run-old-prompted-success-001'});
  const checkpoint={...rebaseAgentRunCheckpoint(first.checkpoint!,{runId:'run-new-normal-task-001',direction:'Now run the requested check.'}),verificationPrompted:true};let calls=0;
  const result=await new AgentRunner({...options(registry),model:{async complete(request){
    assert.ok(request.tools.some(tool=>tool.name==='process.run'),'legacy flag is not a capability restriction');
    return ++calls===1?{toolCalls:[check('new-check')],usage}:{content:'The check passed.',usage};
  }}}).run({prompt:'Now run the requested check.',runId:checkpoint.runId,checkpoint});
  assert.equal(calls,2);assert.equal(counts.checks,1);assert.equal(result.verification?.status,'passed');
});

test('ordered streamed model text/media and its checkpoint remain exact while failed edits stay structured',async()=>{
  const {registry}=tools({failed:true});let calls=0;
  const image={type:'image' as const,asset:{sha256:'a'.repeat(64),mimeType:'image/png',sizeBytes:100}};
  const parts=[{type:'text' as const,text:'Before\n'},image,{type:'text' as const,text:'After'}];
  const result=await new AgentRunner({...options(registry),acceptOrderedOutput:true,model:{async complete(request){
    if(++calls===1)return{toolCalls:[edit()],usage};assert.equal(calls,2);
    await request.onTextDelta?.('Before\nAfter');return{content:'conflicting content must not override ordered parts',outputParts:parts,usage};
  }}}).run({prompt:'Edit and return these synthetic media references',runId:'run-ordered-failure-fact-001'});
  assert.equal(calls,2);assert.deepEqual(result.outputParts,parts);assert.equal(result.finalText,'Before\nAfter');
  assert.deepEqual(result.checkpoint?.messages.at(-1)?.outputParts,parts);assert.equal(result.checkpoint?.version,2);
  assert.equal(notices(result).length,0);assert.deepEqual(result.verification?.failedEdits,['notes.txt']);
  assert.deepEqual(result.usage,{inputTokens:22,outputTokens:6});
});
