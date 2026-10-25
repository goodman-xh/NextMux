import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {NextMuxPlatformServiceImpl} from '../lib/node/nextmux-platform-service.js';
import {authorityBodyHash} from '../lib/node/nextmux-managed-task-authority.js';
const origin='https://pricing-wait.invalid',owner='pricing-owner';
const route={mode:'fixed',offeringId:'same-selected-offering'};
const input={messages:[{role:'user',content:'Continue after the same tool results'}],tools:[],workbench:'coding'};
const proof={providerAccepted:false,usageKnown:true,chargedMicros:0,resumable:true,recoveryMode:'resume'};
const ndjson=events=>new Response(events.map(e=>JSON.stringify(e)).join('\n')+'\n',{headers:{'content-type':'application/x-ndjson'}});
const result={ok:true,call:{id:'00000000-0000-4000-8000-000000000001'},response:{content:'finished',toolCalls:[],usage:{inputTokens:1,outputTokens:1,usageKnown:true}}};
class Service extends NextMuxPlatformServiceImpl{
 nextmuxDataRoot(){return this.root;}async getPrivacySettings(){return{};}async deviceId(){return'pricing-device-123456789';}managedSessionPool(){return this.pool;}
 stream(key,signal,callbacks={},firstSubmit=false){return this.completeManagedGatewayWithEvents(route,input,key,signal,callbacks,firstSubmit);}
 consume(response){return this.consumeManagedGatewayStream(response,{});}
}
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'pricing-wait-'));t.after(()=>rm(root,{recursive:true,force:true}));const s=new Service();s.root=root;s.baseUrl=origin;s.mediaDeliveryAccountId=owner;return s;}

for (const code of ['pricing_authority_updating','route_temporarily_unavailable']) {
const failure=(details=proof)=>({code,message:'Preacceptance wait',status:503,retryAfterMs:1,...details});
test(`${code}: confirmed wait keeps the same selected route/body/key, uses HTTP after WS terminal, then invokes once`,async t=>{
 const s=await fixture(t),key=randomUUID(),bodies=[];let ws=0,posts=0;
 s.pool={async openStream(body,id){ws++;assert.equal(id,key);bodies.push(JSON.stringify(body));return ndjson([{type:'gateway.started'},{type:'error',error:failure()}]);}};
 s.networkFetch=async(url,init)=>{assert(url.endsWith('/responses'));posts++;assert.equal(init.headers['idempotency-key'],key);bodies.push(init.body);return ndjson([{type:'completed',result}]);};
 assert.equal((await s.stream(key)).response.content,'finished');assert.equal(ws,1);assert.equal(posts,1);assert.equal(bodies[0],bodies[1]);assert.equal(JSON.parse(bodies[0]).offeringId,route.offeringId);
});

test(`${code}: admission wait retains its saved nonce/body and never falls through to legacy dispatch`,async t=>{
 const s=await fixture(t),key=randomUUID(),admitted=[];let posts=0;
 s.networkFetch=async(url,init)=>{const b=JSON.parse(init.body||'{}');
  if(url.endsWith('/enrollment'))return Response.json({ok:true,protocol:'task-authority-v1',userId:owner,enabled:true});
  if(url.endsWith('/admit')){admitted.push(b);if(admitted.length===1)return Response.json({error:{code},details:{...proof,retryAfter:1}},{status:503});
   const bodyHash=authorityBodyHash(b.body),requestId=result.call.id;
   const authorityRef='nmx-ta1.'+Buffer.from(JSON.stringify({version:1,origin:'protocol_first_submit',userId:owner,clientNonce:b.clientNonce,bodyHash,requestId})).toString('base64url')+'.fixture';
   return Response.json({ok:true,clientNonce:b.clientNonce,bodyHash,requestId,authorityRef});}
  assert(url.endsWith('/responses'));assert.match(b.taskAuthorityRef,/^nmx-ta1\./);posts++;return ndjson([{type:'completed',result}]);
 };
 assert.equal((await s.stream(key,undefined,{},true)).call.id,result.call.id);assert.equal(posts,1);assert.equal(admitted.length,2);assert.deepEqual(admitted[0],admitted[1]);
});

test(`${code}: missing proof, accepted/unknown responses, and any observed output never become safe retries`,async t=>{
 const s=await fixture(t);
 for(const details of [{},{...proof,providerAccepted:true},{...proof,acceptanceUnknown:true},{...proof,chargedMicros:1}]){
  await assert.rejects(s.consume(ndjson([{type:'error',error:failure(details)}])),e=>e.waitingPricing===false);
 }
 for(const event of [{type:'response.started'},{type:'content.delta',delta:'partial'},{type:'tool_call.started',callId:'one'},{type:'reasoning.delta',delta:'private'},{type:'usage',usageKnown:false}]){
  await assert.rejects(s.consume(ndjson([event,{type:'error',error:failure()}])),e=>e.waitingPricing===false&&e.retrySafe===false,event.type);
 }
});

test(`${code}: actual upstream 402 after preacceptance wait stops and does not reissue a rejected request`,async t=>{
 const s=await fixture(t);let calls=0;s.networkFetch=async()=>{calls++;return ndjson([{type:'error',error:calls===1?failure():{code:'upstream_balance_unavailable',status:503,message:'Upstream HTTP 402',providerAccepted:false,usageKnown:true,chargedMicros:0}}]);};
 await assert.rejects(s.stream(randomUUID()),e=>e.code==='upstream_balance_unavailable');assert.equal(calls,2);
});

test(`${code}: stop during confirmed wait aborts immediately without another POST or billing lookup`,async t=>{
 const s=await fixture(t),c=new AbortController();let calls=0;s.networkFetch=async()=>{calls++;return ndjson([{type:'error',error:failure()}]);};
 await assert.rejects(s.stream(randomUUID(),c.signal,{onProviderEvent:e=>{if(e.type==='gateway.heartbeat')c.abort();}}),e=>e.code==='CANCELLED');assert.equal(calls,1);
});
}
