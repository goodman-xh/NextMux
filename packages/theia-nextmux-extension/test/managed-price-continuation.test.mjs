import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {NextMuxPlatformServiceImpl} from '../lib/node/nextmux-platform-service.js';
import {readManagedPriceUpdate} from '../lib/common/nextmux-managed-price-update.js';
const origin='https://price-continuation.invalid',owner='price-test-owner';
const offeringId=randomUUID(),oldQuote='kq1_'+'1'.repeat(64),newQuote='kq1_'+'2'.repeat(64);
const route={mode:'fixed',offeringId,keyPriceQuoteId:oldQuote};
const input={messages:[{role:'user',content:'continue this task'}],tools:[],workbench:'coding',conversationId:'price-test-conversation'};
const update=(requestId=randomUUID())=>({id:`${requestId}:${newQuote}`,requestId,at:1791300000000,previousQuoteId:oldQuote,
 effectiveQuoteId:newQuote,offeringId,model:'test-model',currency:'USD',usageMultiplierBps:10000,
 rates:[{metric:'input_token',unitSize:1000000,customerAmountMicros:250000}]});
const result=p=>({call:{id:p.requestId,offeringId},pricingUpdate:p,response:{content:'finished',toolCalls:[],model:'test-model',usage:{inputTokens:10,outputTokens:2,usageKnown:true}},billing:{chargedMicros:3,currency:'USD'}});
const ndjson=events=>new Response(events.map(e=>JSON.stringify(e)).join('\n')+'\n',{headers:{'content-type':'application/x-ndjson'}});
class Service extends NextMuxPlatformServiceImpl {
 nextmuxDataRoot(){return this.root;} async getPrivacySettings(){return{};} async deviceId(){return 'price-device-123456';}
 managedSessionPool(){return undefined;}
 stream(key,callbacks={},request=input,fresh=true){return this.completeManagedGatewayWithEvents(route,request,key,undefined,callbacks,fresh);}
 consume(response,callbacks){return this.consumeManagedGatewayStream(response,callbacks);}
}
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'price-continuation-'));t.after(()=>rm(root,{recursive:true,force:true}));const s=new Service();s.root=root;s.baseUrl=origin;s.mediaDeliveryAccountId=owner;return s;}

test('fresh model invocation sends current policy once; authoritative price event precedes text and billing uses the same receipt',async t=>{
 const s=await fixture(t),p=update(),events=[],posts=[];
 s.networkFetch=async(url,init)=>{
  if(url.endsWith('/enrollment'))return Response.json({ok:true,protocol:'task-authority-v1',userId:owner,enabled:false});
  assert(url.endsWith('/responses'));const body=JSON.parse(init.body);posts.push({body,key:init.headers['idempotency-key']});
  return ndjson([{type:'gateway.started',requestId:p.requestId},{type:'pricing.updated',requestId:p.requestId,pricingUpdate:p},
   {type:'content.delta',delta:'finished'},{type:'completed',result:result(p)}]);
 };
 const key=randomUUID(),done=await s.stream(key,{onPricingUpdate:x=>events.push(['price',x]),onTextDelta:x=>events.push(['text',x])});
 assert.equal(posts.length,1);assert.equal(posts[0].key,key);assert.equal(posts[0].body.pricePolicy,'current');assert.equal(posts[0].body.offeringId,offeringId);
 assert.deepEqual(events,[['price',p],['text','finished']]);assert.equal(done.pricingUpdate.requestId,done.call.id);assert.equal(done.billing.chargedMicros,3);
});

test('notification delivery failure cannot resend, interrupt output, or change a paid receipt',async t=>{
 const s=await fixture(t),p=update();let posts=0;
 s.networkFetch=async(url)=>{if(url.endsWith('/enrollment'))return Response.json({ok:true,protocol:'task-authority-v1',userId:owner,enabled:false});posts++;return ndjson([
  {type:'gateway.started',requestId:p.requestId},{type:'pricing.updated',requestId:p.requestId,pricingUpdate:p},{type:'completed',result:result(p)}]);};
 const done=await s.stream(randomUUID(),{onPricingUpdate(){throw Error('renderer storage unavailable');}});
 assert.equal(done.call.id,p.requestId);assert.equal(done.billing.chargedMicros,3);assert.equal(posts,1);
});

test('tool-result continuation remains a new request with its original messages; no earlier request is reissued',async t=>{
 const s=await fixture(t),posts=[];s.networkFetch=async(url,init)=>{
  if(url.endsWith('/enrollment'))return Response.json({ok:true,protocol:'task-authority-v1',userId:owner,enabled:false});
  posts.push({key:init.headers['idempotency-key'],body:JSON.parse(init.body)});return ndjson([{type:'completed',result:result(update())}]);};
 const first=randomUUID(),second=randomUUID();await s.stream(first);
 const continued={...input,messages:[...input.messages,{role:'assistant',content:'',toolCalls:[{id:'already-ran',name:'workspace.read_file',arguments:{path:'package.json'}}]},
  {role:'tool',toolCallId:'already-ran',content:'{"name":"nextmux"}'}]};
 await s.stream(second,{},continued);
 assert.deepEqual(posts.map(p=>p.key),[first,second]);assert(posts.every(p=>p.body.pricePolicy==='current'));
 assert.deepEqual(posts[1].body.messages,continued.messages);
});

test('legacy calls without new-call proof retain their exact no-policy body',async t=>{
 const s=await fixture(t),seen=[];s.networkFetch=async(url,init)=>{assert(url.endsWith('/responses'));seen.push(JSON.parse(init.body));return ndjson([{type:'completed',result:result(update())}]);};
 await s.stream(randomUUID(),{},input,false);assert.equal(seen.length,1);assert(!('pricePolicy' in seen[0]));
});

test('bad or foreign price metadata is ignored without losing the model result',async t=>{
 const s=await fixture(t),p=update(),seen=[];
 const done=await s.consume(ndjson([{type:'gateway.started',requestId:p.requestId},
  {type:'pricing.updated',pricingUpdate:update()},{type:'pricing.updated',pricingUpdate:{...p,rates:[{metric:'input_token',unitSize:0,customerAmountMicros:2}]}},
  {type:'completed',result:result(p)}]),{onPricingUpdate:x=>seen.push(x)});
 assert.equal(done.call.id,p.requestId);assert.deepEqual(seen,[]);
});

test('buffered authenticated receipt exposes the same public prices without trusting malformed fields',async t=>{
 const s=await fixture(t),p=update(),seen=[];
 await s.consume(Response.json(result(p)),{onPricingUpdate:x=>seen.push(x)});assert.deepEqual(seen,[p]);
 assert.equal(readManagedPriceUpdate({...p,id:'foreign'}),undefined);
 assert.equal(readManagedPriceUpdate({...p,currency:'<USD>'}),undefined);
 assert.equal(readManagedPriceUpdate({...p,rates:[...p.rates,...p.rates]}),undefined);
 assert.equal(readManagedPriceUpdate({...p,rates:[{...p.rates[0],customerAmountMicros:-1}]}),undefined);
 assert.equal(readManagedPriceUpdate(p,randomUUID()),undefined);
});
