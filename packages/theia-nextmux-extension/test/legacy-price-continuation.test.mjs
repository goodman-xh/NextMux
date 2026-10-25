import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { legacyCapacityJournal } from '../lib/node/nextmux-managed-task-authority.js';
import { prepareLegacyPriceContinuation, loadLegacyPriceContinuation, claimLegacyPriceContinuation, legacyPriceReplacementKey } from '../lib/node/nextmux-legacy-price-continuation.js';
const origin='https://legacy-price.invalid',userId='owner',hash='f'.repeat(64),oldQuote='kq1_'+'a'.repeat(64);
const body={pricePolicy:'current',prompt:'private prompt never persisted'};
const route={mode:'fixed',offeringId:randomUUID(),keyPriceQuoteId:oldQuote};
const input={messages:[{role:'user',content:'continue'},{role:'assistant',content:'',toolCalls:[{id:'ran',name:'workspace.read_file',arguments:{path:'test'}}]},{role:'tool',toolCallId:'ran',content:'already completed'}],tools:[],workbench:'coding'};
const proof=(originalRequestId=randomUUID())=>({version:1,authority:'legacy',originalRequestId,clientNonce:randomUUID(),requestHash:hash});
const closed=(p,overrides={})=>({ok:false,code:'price_revision_required',message:'closed zero',details:{requestId:p.originalRequestId,currency:'USD',providerAccepted:false,settled:true,usageKnown:true,chargedMicros:0,replacement:p,...overrides}});
const answer=(id=randomUUID())=>({call:{id,offeringId:route.offeringId},response:{content:'done',toolCalls:[],model:'fixture',usage:{inputTokens:10,outputTokens:2,usageKnown:true}},billing:{chargedMicros:5,currency:'USD'}});
class Service extends NextMuxPlatformServiceImpl {
 nextmuxDataRoot(){return this.root;}async deviceId(){return'legacy-price-device';}async getPrivacySettings(){return{};}managedSessionPool(){return undefined;}
 stream(key,signal){return this.completeManagedGatewayWithEvents(route,input,key,signal,{},true);}
 buffered(key){return this.dispatchManagedGateway(route,input,key,undefined,true);}
 wait(key,submit,signal,callbacks={}){return this.withLegacyCapacity(key,body,submit,signal,callbacks);}
 async fail(payload){return this.consumeManagedGatewayStream(Response.json(payload,{status:409}),{});}
}
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'legacy-price-'));t.after(()=>rm(root,{recursive:true,force:true}));const s=new Service();s.root=root;s.baseUrl=origin;s.mediaDeliveryAccountId=userId;return {root,s,scope:(key,otherBody=body)=>({root,platformOrigin:origin,userId,requestKey:key,body:otherBody})};}
const enrollment=()=>Response.json({ok:true,protocol:'task-authority-v1',userId,enabled:false});
for(const transport of ['stream','buffered'])test(`${transport}: zero-charge parent continues identical model body under linked key/header without replaying tools`,async t=>{
 const f=await fixture(t),p=proof(),calls=[],key=randomUUID(),result=answer();
 f.s.networkFetch=async(url,init)=>{if(url.endsWith('/enrollment'))return enrollment();assert(url.endsWith('/responses'));calls.push({key:init.headers['idempotency-key'],parent:init.headers['x-nextmux-price-replacement'],body:JSON.parse(init.body)});
  return calls.length===1?Response.json(closed(p),{status:409}):Response.json(result);};
 const done=await f.s[transport](key);assert.equal(done.call.id,result.call.id);assert.equal(done.billing.chargedMicros,5);assert.equal(calls.length,2);
 assert.deepEqual(calls.map(x=>x.key),[key,legacyPriceReplacementKey(p)]);assert.equal(calls[1].parent,p.originalRequestId);assert.deepEqual(calls[1].body,calls[0].body);assert.deepEqual(calls[1].body.messages,input.messages);
});
test('multiple sequential repricings stay in one complete call with distinct durable parent links',async t=>{
 const f=await fixture(t),p=proof(),q=proof(),seen=[],key=randomUUID();f.s.networkFetch=async(url,init)=>{if(url.endsWith('/enrollment'))return enrollment();seen.push(init.headers);return seen.length<3?Response.json(closed(seen.length===1?p:q),{status:409}):Response.json(answer());};
 await f.s.stream(key);assert.deepEqual(seen.map(x=>x['idempotency-key']),[key,legacyPriceReplacementKey(p),legacyPriceReplacementKey(q)]);assert.equal(seen[2]['x-nextmux-price-replacement'],q.originalRequestId);
});
test('lost child POST acknowledgement recovers by child key and never repeats parent or child POST',async t=>{
 const f=await fixture(t),p=proof(),seen=[],result=answer(),key=randomUUID();f.s.networkFetch=async(url,init)=>{if(url.endsWith('/enrollment'))return enrollment();seen.push({url,key:init.headers['idempotency-key']});
  if(url.endsWith('/api/gateway/recover')){assert.equal(init.headers['idempotency-key'],legacyPriceReplacementKey(p));return Response.json(result);}
  if(seen.filter(x=>x.url.endsWith('/responses')).length===1)return Response.json(closed(p),{status:409});throw Error('lost acknowledgement');};
 assert.equal((await f.s.stream(key)).call.id,result.call.id);assert.equal(seen.filter(x=>x.url.endsWith('/responses')).length,2);assert.equal(seen.at(-1).key,legacyPriceReplacementKey(p));
});
test('cold reopen of submitted child only reads keyed receipt; no old POST',async t=>{
 const f=await fixture(t),key=randomUUID(),p=proof();await prepareLegacyPriceContinuation({...f.scope(key),replacement:p});await claimLegacyPriceContinuation(f.scope(key));
 f.s.networkFetch=async(url,init)=>{assert(url.endsWith('/api/gateway/recover'));assert.equal(init.headers['idempotency-key'],legacyPriceReplacementKey(p));return Response.json({recovered:true});};
 assert.deepEqual(await f.s.wait(key,()=>assert.fail('must never POST')),{recovered:true});
});
test('ready child claims once across concurrent observers; journal excludes prompts',async t=>{
 const f=await fixture(t),key=randomUUID(),p=proof();await prepareLegacyPriceContinuation({...f.scope(key),replacement:p});
 const claimed=await Promise.all(Array.from({length:8},()=>claimLegacyPriceContinuation(f.scope(key))));assert.equal(claimed.filter(Boolean).length,1);
 async function content(path){let text='';for(const x of await readdir(path,{withFileTypes:true}))text+=x.isDirectory()?await content(join(path,x.name)):await readFile(join(path,x.name),'utf8');return text;}
 assert(!(await content(f.root)).includes(body.prompt));assert.equal((await loadLegacyPriceContinuation(f.scope(key))).delivery,'submitted');
});
test('changed body, account, parent receipt, or server fingerprint cannot create/reuse a child',async t=>{
 const f=await fixture(t),key=randomUUID(),p=proof();await prepareLegacyPriceContinuation({...f.scope(key),replacement:p});
 await assert.rejects(loadLegacyPriceContinuation({...f.scope(key),userId:'other'}),e=>e.code==='LEGACY_PRICE_JOURNAL_CONFLICT');
 await assert.rejects(loadLegacyPriceContinuation(f.scope(key,{...body,prompt:'changed'})),e=>e.code==='LEGACY_PRICE_JOURNAL_CONFLICT');
 await assert.rejects(prepareLegacyPriceContinuation({...f.scope(randomUUID()),replacement:p,expectedRequestId:randomUUID()}),e=>e.code==='LEGACY_PRICE_REPLACEMENT_INVALID');
 await assert.rejects(prepareLegacyPriceContinuation({...f.scope(randomUUID()),replacement:p,expectedServerHash:'b'.repeat(64)}),e=>e.code==='LEGACY_PRICE_REPLACEMENT_INVALID');
});
test('provider acceptance, paid outcome, partial output, or missing usage proof prohibits replacement',async t=>{
 for(const overrides of [{providerAccepted:true},{chargedMicros:1},{partial:true},{usageKnown:false},{settled:false},{acceptanceUnknown:true},{toolCallStarted:true}]){
  const f=await fixture(t),p=proof();let posts=0;
  await assert.rejects(f.s.wait(randomUUID(),async()=>{posts++;return f.s.fail(closed(p,overrides));}));assert.equal(posts,1);
 }
});
test('user cancellation targets current child capacity request and remains cancelled on reopen',async t=>{
 const f=await fixture(t),key=randomUUID(),p=proof(),childId=randomUUID(),childKey=legacyPriceReplacementKey(p);await prepareLegacyPriceContinuation({...f.scope(key),replacement:p});await claimLegacyPriceContinuation(f.scope(key));
 await legacyCapacityJournal(f.scope(childKey),{requestId:childId,serverBodyHash:hash,delivery:'waiting_capacity'});const c=new AbortController();c.abort();let cancels=0;
 f.s.networkFetch=async(url)=>{assert(url.endsWith(`/capacity/${childId}/cancel`));cancels++;return Response.json({ok:true,requestId:childId,currency:'USD'});};
 await assert.rejects(f.s.wait(key,()=>assert.fail('never POST'),c.signal),e=>e.code==='CANCELLED'&&e.chargedMicros===0);assert.equal(cancels,1);
 await assert.rejects(f.s.wait(key,()=>assert.fail('never POST')),e=>e.code==='CANCELLED');assert.equal(cancels,1);
});
test('shutdown preserves ready child; user cancel prevents it being sent later',async t=>{
 const f=await fixture(t),key=randomUUID(),p=proof();await prepareLegacyPriceContinuation({...f.scope(key),replacement:p});const shutdown=new AbortController();shutdown.abort('client_shutdown');
 await assert.rejects(f.s.wait(key,()=>assert.fail('never POST'),shutdown.signal));assert.equal((await loadLegacyPriceContinuation(f.scope(key))).delivery,'ready');
 const userCancel=new AbortController();userCancel.abort();await assert.rejects(f.s.wait(key,()=>assert.fail('never POST'),userCancel.signal));assert.equal((await loadLegacyPriceContinuation(f.scope(key))).delivery,'cancelled');
});
const notReceived=p=>({ok:false,code:'price_replacement_not_received',details:{requestId:p.originalRequestId,providerAccepted:false,canSubmit:true,replacement:p,recoveryMode:'resume',resumable:true}});
test('crash between claim and transport recovers child absence, then submits only the same deterministic key',async t=>{
 const f=await fixture(t),key=randomUUID(),p=proof();await prepareLegacyPriceContinuation({...f.scope(key),replacement:p});await claimLegacyPriceContinuation(f.scope(key));let lookups=0,posts=0;
 f.s.networkFetch=async(url,init)=>{assert(url.endsWith('/api/gateway/recover'));assert.equal(init.headers['idempotency-key'],legacyPriceReplacementKey(p));assert.equal(init.headers['x-nextmux-price-replacement'],p.originalRequestId);lookups++;return Response.json(notReceived(p),{status:409});};
 const result=await f.s.wait(key,async(_resume,identity)=>{posts++;assert.equal(identity.requestKey,legacyPriceReplacementKey(p));assert.equal(identity.replacesRequestId,p.originalRequestId);return'once';});
 assert.equal(result,'once');assert.equal(lookups,1);assert.equal(posts,1);assert.equal((await loadLegacyPriceContinuation(f.scope(key))).submissionCount,2);
});
test('lost pre-acceptance child transport uses absence proof and retries same key/header/body once',async t=>{
 const f=await fixture(t),p=proof(),key=randomUUID(),bodies=[],keys=[];let lookup=0;
 f.s.networkFetch=async(url,init)=>{if(url.endsWith('/enrollment'))return enrollment();if(url.endsWith('/api/gateway/recover')){lookup++;assert.equal(init.headers['x-nextmux-price-replacement'],p.originalRequestId);assert.equal(init.headers['idempotency-key'],legacyPriceReplacementKey(p));return Response.json(notReceived(p),{status:409});}
  assert(url.endsWith('/responses'));bodies.push(init.body);keys.push(init.headers['idempotency-key']);if(keys.length===1)return Response.json(closed(p),{status:409});if(keys.length===2)throw Error('socket closed before delivery');return Response.json(answer());};
 await f.s.stream(key);assert.equal(lookup,1);assert.deepEqual(keys,[key,legacyPriceReplacementKey(p),legacyPriceReplacementKey(p)]);assert.equal(bodies[0],bodies[1]);assert.equal(bodies[1],bodies[2]);
});
test('absence of a foreign replacement does not authorize any generation',async t=>{
 const f=await fixture(t),key=randomUUID(),p=proof();await prepareLegacyPriceContinuation({...f.scope(key),replacement:p});await claimLegacyPriceContinuation(f.scope(key));
 f.s.networkFetch=async()=>Response.json(notReceived({...p,clientNonce:randomUUID()}),{status:409});
 await assert.rejects(f.s.wait(key,()=>assert.fail('must not POST')),e=>e.code==='LEGACY_PRICE_REPLACEMENT_CONFLICT');
});
test('only one local observer claims a matching submitted-generation retry proof',async t=>{
 const f=await fixture(t),key=randomUUID(),p=proof();await prepareLegacyPriceContinuation({...f.scope(key),replacement:p});await claimLegacyPriceContinuation(f.scope(key));
 const results=await Promise.all(Array.from({length:8},()=>claimLegacyPriceContinuation({...f.scope(key),expectedSubmittedCount:1})));assert.equal(results.filter(Boolean).length,1);
 assert.equal((await loadLegacyPriceContinuation(f.scope(key))).submissionCount,2);
});
test('user cancellation concurrent with zero-charge parent receipt persists cancelled child before any child POST',async t=>{
 const f=await fixture(t),key=randomUUID(),p=proof(),c=new AbortController();let posts=0;
 await assert.rejects(f.s.wait(key,async()=>{posts++;c.abort();return f.s.fail(closed(p));},c.signal),e=>e.code==='CANCELLED');
 assert.equal(posts,1);assert.equal((await loadLegacyPriceContinuation(f.scope(key))).delivery,'cancelled');
 await assert.rejects(f.s.wait(key,()=>assert.fail('cold user-cancelled child must not submit')),e=>e.code==='CANCELLED');
});
test('application shutdown concurrent with zero receipt preserves ready child for later original-task recovery',async t=>{
 const f=await fixture(t),key=randomUUID(),p=proof(),c=new AbortController();
 await assert.rejects(f.s.wait(key,async()=>{c.abort('client_shutdown');return f.s.fail(closed(p));},c.signal));
 assert.equal((await loadLegacyPriceContinuation(f.scope(key))).delivery,'ready');
 let sent=0;assert.equal(await f.s.wait(key,async(_resuming,identity)=>{sent++;assert.equal(identity.requestKey,legacyPriceReplacementKey(p));return'recovered';}),'recovered');assert.equal(sent,1);
});
test('stale ready cancellation cannot erase a concurrently claimed child; verified server cancellation can',async t=>{
 const {cancelLegacyPriceContinuation}=await import('../lib/node/nextmux-legacy-price-continuation.js');const f=await fixture(t),key=randomUUID(),p=proof();
 const stale=await prepareLegacyPriceContinuation({...f.scope(key),replacement:p});assert.equal(stale.delivery,'ready');await claimLegacyPriceContinuation(f.scope(key));
 assert.equal(await cancelLegacyPriceContinuation(f.scope(key)),false);assert.equal((await loadLegacyPriceContinuation(f.scope(key))).delivery,'submitted');
 assert.equal(await cancelLegacyPriceContinuation({...f.scope(key),confirmedServerCancellation:true}),true);assert.equal((await loadLegacyPriceContinuation(f.scope(key))).delivery,'cancelled');
});
