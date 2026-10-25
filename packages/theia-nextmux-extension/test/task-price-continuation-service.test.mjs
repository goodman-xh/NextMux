import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { authorityBodyHash } from '../lib/node/nextmux-managed-task-authority.js';
import { updateManagedStop } from '../lib/node/nextmux-request-stop-journal.js';
const owner='price-continuation-owner', origin='https://task-price-fixture.invalid';
const quote='kq1_'+'1'.repeat(64), offering=randomUUID();
const route={mode:'fixed',offeringId:offering,keyPriceQuoteId:quote};
const input={workbench:'coding',messages:[{role:'user',content:'continue after prior tools'},{role:'assistant',content:'',toolCalls:[{id:'already-done',name:'workspace.read_file',arguments:{path:'package.json'}}]},{role:'tool',toolCallId:'already-done',content:'{"name":"fixture"}'}],tools:[]};
const ndjson=events=>new Response(events.map(e=>JSON.stringify(e)).join('\n')+'\n',{headers:{'content-type':'application/x-ndjson'}});
const decode=token=>JSON.parse(Buffer.from(token.split('.')[1],'base64url'));
const receipt=id=>({call:{id,offeringId:offering},response:{content:'completed once',model:'fixture',toolCalls:[],usage:{inputTokens:10,outputTokens:1,usageKnown:true}},billing:{chargedMicros:7,currency:'USD'}});
class Service extends NextMuxPlatformServiceImpl {
 nextmuxDataRoot(){return this.root;} async getPrivacySettings(){return {};} async deviceId(){return 'price-device-123456';} managedSessionPool(){return undefined;}
 run(key,signal){return this.completeManagedGatewayWithEvents(route,input,key,signal,{},true);}
 runBuffered(key,signal){return this.dispatchManagedGateway(route,input,key,signal,true);}
}
async function fixture(t,{revisions=1,dropAdmission=false,dropParentReply=false,holdFinal=false}={}) {
 const root=await mkdtemp(join(tmpdir(),'task-price-service-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const records=new Map(), submits=[], admissions=[], recovers=[], links=new Map(),stops=[];let lost=false,lostParent=false,firstBody,started;
 const ready=new Promise(resolve=>started=resolve);
 const make=()=>{const s=new Service();s.root=root;s.baseUrl=origin;s.mediaDeliveryAccountId=owner;s.networkFetch=async(url,init)=>{
  if(url.endsWith('/enrollment'))return Response.json({ok:true,protocol:'task-authority-v1',userId:owner,enabled:true});
  const value=JSON.parse(init.body||'{}');
  if(url.endsWith('/stop')){const id=url.split('/').at(-2);assert([...records.values()].some(record=>record.requestId===id));stops.push(id);return Response.json({ok:true,requestId:id,stopRequested:true});}
  if(url.endsWith('/admit')){
   admissions.push(value);firstBody ||= value.body;
   assert.deepEqual(value.body,firstBody,'replacement admission does not alter the original model input');
   let record=records.get(value.clientNonce);
   if(!record){const id=randomUUID(), claims={version:1,origin:'protocol_first_submit',userId:owner,clientNonce:value.clientNonce,bodyHash:authorityBodyHash(value.body),requestId:id};
    record={ok:true,clientNonce:value.clientNonce,bodyHash:claims.bodyHash,requestId:id,authorityRef:'nmx-ta1.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.fixture',order:records.size};records.set(value.clientNonce,record);}
   if(value.replacementAuthorityRef){const parent=decode(value.replacementAuthorityRef);assert.equal(links.get(parent.requestId)?.clientNonce,value.clientNonce);
    if(dropAdmission&&!lost){lost=true;throw new TypeError('simulated lost admission acknowledgement');}}
   return Response.json(record);
  }
  const authority=decode(value.taskAuthorityRef||value.authorityRef), record=[...records.values()].find(r=>r.requestId===authority.requestId);assert(record);
  const replacement=()=>{let proof=links.get(record.requestId);if(!proof){proof={version:1,authority:'task',originalRequestId:record.requestId,clientNonce:randomUUID(),bodyHash:record.bodyHash};links.set(record.requestId,proof);}
   return {code:'price_revision_required',message:'Use linked current price',status:409,requestId:record.requestId,providerAccepted:false,settled:true,usageKnown:true,chargedMicros:0,currency:'USD',replacement:proof};};
  if(url.endsWith('/responses')){
   submits.push(record.requestId); const {taskAuthorityRef,...body}=value;assert.deepEqual(body,firstBody);
   if(record.order<revisions){const error=replacement();if(dropParentReply&&!lostParent){lostParent=true;throw new TypeError('simulated lost zero-charge receipt');}
    return ndjson([{type:'gateway.started',requestId:record.requestId},{type:'error',error}]);}
   if(holdFinal){started();return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));}
   return ndjson([{type:'gateway.started',requestId:record.requestId},{type:'content.delta',delta:'completed once'},{type:'completed',result:receipt(record.requestId)}]);
  }
  if(url.endsWith('/recover')){recovers.push(record.requestId);return record.order<revisions?Response.json({ok:false,code:'price_revision_required',message:'Use linked current price',details:replacement()},{status:409}):Response.json(receipt(record.requestId));}
  throw Error('Unexpected fixture URL '+url);
 };return s;};
 return {make,submits,admissions,recovers,records,root,ready,stops};
}
test('TaskAccount price revisions continue inside one model call with unchanged tool results and one POST per zero-charge child',async t=>{
 const f=await fixture(t,{revisions:2}), key=randomUUID();const done=await f.make().run(key);
 assert.equal(done.response.content,'completed once');assert.equal(done.billing.chargedMicros,7);assert.equal(f.records.size,3);
 assert.equal(f.submits.length,3);assert.equal(new Set(f.submits).size,3);assert.equal(f.admissions.filter(x=>x.replacementAuthorityRef).length,2);
 const cold=await f.make().run(key);assert.equal(cold.call.id,done.call.id);assert.equal(f.submits.length,3,'cold replay only reads the linked final receipt');
});
test('lost original zero-charge receipt and linked-admission ACK recover the same chain without stopping or new model input',async t=>{
 const f=await fixture(t,{dropAdmission:true,dropParentReply:true});const done=await f.make().run(randomUUID());
 assert.equal(done.billing.chargedMicros,7);assert.equal(f.records.size,2);assert.equal(f.submits.length,2);
 const replacementAdmits=f.admissions.filter(x=>x.replacementAuthorityRef);assert(replacementAdmits.length>=2);assert.equal(new Set(replacementAdmits.map(x=>x.clientNonce)).size,1);assert(f.recovers.length>0);
});
test('buffered TaskAccount price replacement preserves the original request stop identity',async t=>{
 const f=await fixture(t,{revisions:2}),key=randomUUID();const done=await f.make().runBuffered(key);
 assert.equal(done.billing.chargedMicros,7);assert.equal(f.submits.length,3);
 const records=[...f.records.values()];
 for(const [index,record] of records.entries()){
  const saved=await updateManagedStop({root:f.root,platformOrigin:origin,userId:owner,requestKey:index?`task-request:${record.requestId}`:key});
  assert.equal(saved.requestId,record.requestId);
 }
});
test('stopping a price successor cancels that request and cold recovery cannot bypass its durable stop',async t=>{
 const f=await fixture(t,{revisions:2,holdFinal:true}),key=randomUUID(),controller=new AbortController();
 const running=f.make().run(key,controller.signal);running.catch(()=>{});await f.ready;controller.abort('user_stop');
 await assert.rejects(running);
 const records=[...f.records.values()],child=records.at(-1);
 assert.deepEqual(f.stops,[child.requestId]);assert.equal(f.submits.length,3);
 const original=await updateManagedStop({root:f.root,platformOrigin:origin,userId:owner,requestKey:key});
 assert.equal(original.requestId,records[0].requestId);assert.equal(original.reason,undefined);
 const stopped=await updateManagedStop({root:f.root,platformOrigin:origin,userId:owner,requestKey:`task-request:${child.requestId}`});
 assert.equal(stopped.requestId,child.requestId);assert.equal(stopped.reason,'user_stop');assert.equal(stopped.acknowledged,true);
 await assert.rejects(f.make().run(key),error=>error.code==='CANCELLED');
 assert.equal(f.submits.length,3);assert.deepEqual(f.stops,[child.requestId]);
});
