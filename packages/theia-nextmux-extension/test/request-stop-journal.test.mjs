import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { updateManagedStop, pendingManagedStops } from '../lib/node/nextmux-request-stop-journal.js';
const requestId='00000000-0000-4000-8000-000000000001';
class Service extends NextMuxPlatformServiceImpl {
 constructor(root){super();this.root=root;this.baseUrl='https://fixture.invalid';this.mediaDeliveryAccountId='owner';}
 nextmuxDataRoot(){return this.root;}managedSessionPool(){}async deviceId(){return'fixture-device-0000001';}
 async managedGatewayDispatchBody(){return{contentTransfer:'stream-v2',acceptOrderedOutput:true,messages:[{role:'user',content:'never journal this private prompt'}]};}
 async prepareManagedTaskAuthority(){return{mode:'legacy'};}async recoverManagedGatewayBilling(error){throw error;}
 async stream(signal){return this.dispatchManagedGatewayWithEventsAttempt({mode:'fixed',offeringId:'model'}, {conversationId:'conversation',messages:[],tools:[]},'request-key-1',signal,{},true);}
 async flush(){return this.flushManagedStopRecovery();}async deliver(s,r){return this.deliverManagedStop(s,r);}scheduleManagedStopRecovery(){this.retryScheduled=true;}
}
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'stop-journal-'));t.after(()=>rm(root,{recursive:true,force:true}));const scope={root,platformOrigin:'https://fixture.invalid',userId:'owner',requestKey:'request-key-1'};return{root,scope,service:new Service(root)};}
test('journal records only opaque identity and stop intent, survives restart and preserves owner/ID',async t=>{
 const f=await fixture(t);await updateManagedStop(f.scope,{requestId,reason:'user_stop'});const [saved]=await pendingManagedStops(f.scope);assert.equal(saved.requestId,requestId);assert.equal(saved.reason,'user_stop');
 await assert.rejects(updateManagedStop(f.scope,{requestId:'00000000-0000-4000-8000-000000000002'}),/IDENTITY_CONFLICT/);
 assert.equal((await pendingManagedStops({...f.scope,userId:'foreign'})).length,0);
 await updateManagedStop(f.scope,{acknowledged:true});assert.equal((await pendingManagedStops(f.scope)).length,0);
});
for(const known of [true,false])test(`actual client explicit stop ${known?'with response ID':'before response ACK'} persists then sends independent stop`,{timeout:10000},async t=>{
 const f=await fixture(t),signal=new AbortController(),calls=[];let started;const ready=new Promise(r=>started=r);
 f.service.networkFetch=async(url,init)=>{
  const path=new URL(url).pathname;calls.push(path);
  if(path.endsWith('/stop')){assert.equal(init.signal.aborted,false);const pending=await pendingManagedStops(f.scope);assert.equal(pending[0].reason,'user_stop');return Response.json({ok:true,requestId,stopRequested:true,providerStopConfirmed:false});}
  assert.equal(init.headers['x-nextmux-request-control'],'1');
  if(!known){started();return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));}
  return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(JSON.stringify({type:'gateway.accepted',requestId})+'\n'));init.signal.addEventListener('abort',()=>controller.error(new DOMException('aborted','AbortError')),{once:true});started();}}),{headers:{'content-type':'application/x-ndjson'}});
 };
 const run=f.service.stream(signal.signal);run.catch(()=>{});await ready;
 if(known){for(let n=0;n<50;n++){const row=await updateManagedStop(f.scope);if(row.requestId)break;await new Promise(r=>setTimeout(r,2));}}
 signal.abort('user_stop');await assert.rejects(run);
 assert(calls.includes(known?`/api/gateway/responses/${requestId}/stop`:'/api/gateway/stop'));
 assert.equal(calls.filter(p=>p==='/api/gateway/responses').length,1);assert.equal((await pendingManagedStops(f.scope)).length,0);
});
test('ordinary client shutdown detaches and never writes or sends explicit stop',async t=>{
 const f=await fixture(t),signal=new AbortController();let start;const ready=new Promise(r=>start=r);const calls=[];
 f.service.networkFetch=async(url,init)=>{calls.push(url);start();return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));};
 const run=f.service.stream(signal.signal);run.catch(()=>{});await ready;signal.abort('client_shutdown');await assert.rejects(run);
 assert.equal(calls.length,1);assert.equal((await pendingManagedStops(f.scope)).length,0);
});
test('cold startup retries only saved stop; lost stop ACK does not authorize another model generation',async t=>{
 const f=await fixture(t);await updateManagedStop(f.scope,{reason:'exit_incognito'});let attempts=0;
 f.service.networkFetch=async(url,init)=>{assert.equal(new URL(url).pathname,'/api/gateway/stop');assert.equal(JSON.parse(init.body).reason,'exit_incognito');if(++attempts===1)throw new TypeError('lost acknowledgement');return Response.json({ok:true,requestId,stopRequested:true});};
 await f.service.flush();assert.equal((await pendingManagedStops(f.scope)).length,1);assert.equal(f.service.retryScheduled,true);
 const fresh=new Service(f.root);fresh.networkFetch=f.service.networkFetch;await fresh.flush();assert.equal(attempts,2);assert.equal((await pendingManagedStops(f.scope)).length,0);
});
test('durable stop prevents restarting original generation, and account switch does not send it as another user',async t=>{
 const f=await fixture(t);const record=await updateManagedStop(f.scope,{reason:'user_stop'});let posts=0;
 f.service.networkFetch=async(url)=>{posts++;return Response.json({ok:true,requestId,stopRequested:true});};
 f.service.mediaDeliveryAccountId='another';await f.service.deliver(f.scope,record);assert.equal(posts,0);
 f.service.mediaDeliveryAccountId='owner';await assert.rejects(f.service.stream(),e=>e.code==='CANCELLED');assert.equal(posts,1);
});

for(const reason of ['client_shutdown','user_stop','exit_incognito'])test(`cancelAgentRun uses ${reason} and waits for the local job to unwind`,async t=>{
 const f=await fixture(t),controller=new AbortController(),events=[];
 let complete;const completion=new Promise(resolve=>complete=resolve);
 const job={status:'running',controller,completion};f.service.agentJobs.set(requestId,job);
 f.service.markAgentJobInterrupted=async()=>{assert.equal(controller.signal.aborted,false);events.push('restart-marker');};
 f.service.wakeAgentJob=()=>events.push('wake');
 controller.signal.addEventListener('abort',()=>events.push(controller.signal.reason));
 let returned=false;const pending=f.service.cancelAgentRun(requestId,reason).then(()=>{returned=true;});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(returned,false,'RPC must wait for tools/checkpoints to unwind');
 assert.equal(controller.signal.reason,reason);
 assert.deepEqual(events,reason==='client_shutdown'?['restart-marker',reason,'wake']:[reason,'wake']);
 assert.equal(job.shutdownInterrupted,reason==='client_shutdown'?true:undefined);
 complete();await pending;assert.equal(returned,true);
});
