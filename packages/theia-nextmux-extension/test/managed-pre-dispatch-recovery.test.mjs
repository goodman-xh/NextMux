import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const agentBase=process.env.NEXTMUX_PRE_DISPATCH_AGENT_BUILD?pathToFileURL(process.env.NEXTMUX_PRE_DISPATCH_AGENT_BUILD+'/'):new URL('../../agent-runtime/lib/',import.meta.url);
const {AgentRunner,AgentToolRegistry}=await import(new URL('index.js',agentBase));
const base=process.env.NEXTMUX_PRE_DISPATCH_CLIENT_BUILD?pathToFileURL(process.env.NEXTMUX_PRE_DISPATCH_CLIENT_BUILD+'/'):new URL('../lib/',import.meta.url);
const {NextMuxPlatformServiceImpl}=await import(new URL('node/nextmux-platform-service.js',base));
const {canRecoverGatewayResult,recoverBillingResult}=await import(new URL('node/nextmux-billing-recovery.js',base));
class Probe extends NextMuxPlatformServiceImpl{consume(r){return this.consumeManagedGatewayStream(r,{});}}
const id='00000000-0000-4000-8000-000000000091';
const pending={code:'gateway_pre_dispatch_pending',message:'Waiting before dispatch',status:503,requestId:id,providerAccepted:false,preDispatchPending:true,recoveryMode:'resume',resumable:true};
const recovered={code:'gateway_pre_dispatch_recovered',message:'Original request was not dispatched',status:503,requestId:id,providerAccepted:false,notDispatched:true,zeroChargeConfirmed:true,chargedMicros:0,currency:'USD',retrySafe:true,retryable:true,billingPending:false,recoveryMode:'none'};
async function error(fields){let result;await assert.rejects(new Probe().consume(new Response(JSON.stringify({type:'error',error:fields})+'\n',{headers:{'content-type':'application/x-ndjson'}})),e=>{result=e;return true;});return result;}
test('only exact pre-dispatch pending evidence enters original receipt lookup',async()=>{
 assert.equal(canRecoverGatewayResult(await error(pending)),true);
 for(const change of [{providerAccepted:true},{preDispatchPending:false},{requestId:'../foreign'},{code:'PLATFORM_REQUEST_FAILED'},{recoveryMode:'billing_review'},{partial:true},{usageKnown:true},{acceptanceUnknown:true}])assert.equal(canRecoverGatewayResult(await error({...pending,...change})),false);
});
test('earlier tools do not permit any unknown, charged or partial model replay',async()=>{
 for(const change of [{code:'upstream_connection_failed'},{zeroChargeConfirmed:false},{notDispatched:false},{providerAccepted:true},{chargedMicros:1},{partial:true},{usageKnown:true},{requestId:'foreign'}]){
  const tools=new AgentToolRegistry();let executions=0,calls=0;
  tools.register({name:'fixture.once',description:'Prior work',inputSchema:{type:'object'},source:'builtin',requiredPermission:'read_only'},async()=>{executions++;return{modelOutput:{value:'once'},summary:{title:'once'}};});
  const failure=await error({...recovered,...change});
  await assert.rejects(new AgentRunner({tools,permissionMode:'read_only',model:{async complete(){calls++;if(calls===1)return{toolCalls:[{id:'prior',name:'fixture.once',arguments:{}}]};throw failure;}}}).run({prompt:'Continue',runId:'run-pre-dispatch-negative-fixture'}));
  assert.equal(calls,2);assert.equal(executions,1);
 }
});
test('only verified zero-charge no-dispatch proof permits a checkpoint model retry',async()=>{
 const yes=await error(recovered);assert.equal(yes.retrySafe,true);assert.equal(yes.retryable,true);assert.equal(yes.providerAccepted,false);assert.equal(yes.chargedMicros,0);
 for(const change of [{providerAccepted:true},{zeroChargeConfirmed:false},{chargedMicros:1},{notDispatched:false},{partial:true},{acceptanceUnknown:true},{usageKnown:true},{requestId:'../foreign'},{requestId:'------------------------------------'},{currency:'usd'},{billingPending:true},{recoveryMode:'billing_review'}])assert.notEqual((await error({...recovered,...change})).retrySafe,true);
});
test('pre-dispatch recovery polls only original request, then passes its zero-charge terminal proof to checkpoint',async()=>{
 const old=await error(pending),done=await error(recovered);let reads=0;
 await assert.rejects(recoverBillingResult(old,{pause:async()=>{},poll:async requestId=>{assert.equal(requestId,id);reads++;if(reads===1)throw old;throw done;}}),e=>e===done);
 assert.equal(reads,2);assert.equal(done.retrySafe,true);
});
test('foreign receipt and nested stream proof cannot authorize another original request',async()=>{
 const foreign='00000000-0000-4000-8000-000000000092';
 for(const type of ['gateway_pre_dispatch_pending','gateway_pre_dispatch_recovered']){
  const fields=type===pending.code?pending:recovered;let seen;
  await assert.rejects(new Probe().consume(new Response([
   {type:'gateway.accepted',requestId:id,taskId:id,streamId:'fixture',sequence:1},
   {type:'error',requestId:id,taskId:id,streamId:'fixture',sequence:2,error:{...fields,requestId:foreign}}
  ].map(x=>JSON.stringify(x)).join('\n'),{headers:{'content-type':'application/x-ndjson'}})),e=>{seen=e;return true;});
  assert.equal(seen.code,'BILLING_RECEIPT_MISMATCH');assert.notEqual(seen.retrySafe,true);
  await assert.rejects(recoverBillingResult(await error(pending),{pause:async()=>{},poll:async()=>{throw await error({...fields,requestId:foreign});}}),e=>e.code==='BILLING_RECEIPT_MISMATCH'&&e.requestId===id&&e.retrySafe===false);
 }
});
test('a proven pre-dispatch retry retains earlier tool outputs and never repeats those tools',async()=>{
 const tools=new AgentToolRegistry();let executions=0,calls=0;const checkpoints=[];
 for(const name of ['fixture.inspect','fixture.verify'])tools.register({name,description:'Read-only prior work',inputSchema:{type:'object'},source:'builtin',requiredPermission:'read_only'},async()=>{executions++;return {modelOutput:{value:name+'-done'},summary:{title:name}};});
 const failure=await error(recovered);
 const result=await new AgentRunner({tools,permissionMode:'read_only',onCheckpoint:cp=>checkpoints.push(cp),model:{async complete(request){calls++;if(calls===1)return {toolCalls:[{id:'tool-1',name:'fixture.inspect',arguments:{}},{id:'tool-2',name:'fixture.verify',arguments:{}}]};if(calls===2)throw failure;assert.ok(JSON.stringify(request.messages).includes('fixture.inspect-done'));assert.ok(JSON.stringify(request.messages).includes('fixture.verify-done'));return {content:'Finished after original no-dispatch proof'};}}}).run({prompt:'Continue the same work',runId:'run-pre-dispatch-checkpoint-fixture'});
 assert.equal(result.status,'completed');assert.equal(result.toolCalls,2);assert.equal(executions,2);assert.equal(calls,3);assert.ok(result.events.some(e=>e.type==='model_retry_scheduled'));assert.ok(checkpoints.length>0);
});
