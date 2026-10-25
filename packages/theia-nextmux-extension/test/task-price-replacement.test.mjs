import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire,Module} from 'node:module';
import {readFileSync,existsSync} from 'node:fs';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

// Compile current product sources in memory, including their normal imports.
// This independent test never changes lib output during a parallel app build.
const require=createRequire(import.meta.url),ts=require('typescript');
function product(name,append=''){
 const source=fileURLToPath(new URL(`../src/node/${name}.ts`,import.meta.url));
 const filename=fileURLToPath(new URL(`../lib/node/${name}.js`,import.meta.url));
 const code=ts.transpileModule(readFileSync(source,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText;
 const module=new Module(filename);module.filename=filename;module.paths=Module._nodeModulePaths(dirname(filename));require.cache[filename]=module;
 const normalRequire=module.require.bind(module);module.require=function(request){if(request.startsWith('./nextmux-')){const target=join(dirname(filename),request+'.js');if(require.cache[target])return require.cache[target].exports;if(!existsSync(target)&&existsSync(join(dirname(source),request+'.ts')))return product(request.slice(2));}return normalRequire(request);};
 module._compile(code+append,filename);return module.exports;
}
const authority=product('nextmux-managed-task-authority');
const {authorityBodyHash,managedRequestAuthority,continueManagedTaskAtCurrentPrice,cancelPendingManagedTaskPriceReplacement,claimManagedTaskSubmission,recordManagedTaskDelivery,loadManagedReceiptAuthority}=authority;
const {NextMuxPlatformServiceImpl,TestPlatformRequestError}=product('nextmux-platform-service','\nmodule.exports.TestPlatformRequestError=PlatformRequestError;');
const platformOrigin='https://replacement.fixture.invalid',userId='replacement-owner';
const requestBody=()=>({offeringId:randomUUID(),keyPriceQuoteId:'kq1_'+'a'.repeat(64),pricePolicy:'current',workbench:'coding',messages:[{role:'user',content:'preserve my original prompt'}, {role:'tool',toolCallId:'already-executed',content:'file already written'}],tools:[],maximumOutputTokens:1000});
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'nextmux-price-replacement-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const body=requestBody(),owner={root,platformOrigin,userId,requestKey:randomUUID()},stored=new Map(),calls=[];
 const admit=async input=>{
  calls.push(input);const hash=authorityBodyHash(input.body);if(input.bodyHash)assert.equal(input.bodyHash,hash);
  let row=stored.get(input.clientNonce);
  if(row){assert.equal(row.bodyHash,hash);return row;}
  const requestId=randomUUID(),claims={version:1,origin:'protocol_first_submit',userId,clientNonce:input.clientNonce,bodyHash:hash,requestId};
  row={ok:true,clientNonce:input.clientNonce,bodyHash:hash,requestId,authorityRef:'nmx-ta1.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.fixture'};
  stored.set(input.clientNonce,row);return row;
 };
 const original=await managedRequestAuthority({...owner,body,firstSubmit:true,enrolled:true,admit});
 const scope=requestId=>({root,platformOrigin,userId,requestId});
 const proof=(requestId=original.requestId)=>({version:1,authority:'task',originalRequestId:requestId,clientNonce:randomUUID(),bodyHash:authorityBodyHash(body)});
 const continueWith=(replacement,overrides={})=>continueManagedTaskAtCurrentPrice({...scope(replacement.originalRequestId),body,replacement,admit,...overrides});
 const error=(replacement,details={})=>new TestPlatformRequestError('price_revision_required','original undispatched price expired',409,1,{requestId:replacement.originalRequestId,currency:'USD',settled:true,usageKnown:true,chargedMicros:0,providerAccepted:false,replacement,...details});
 const service=new NextMuxPlatformServiceImpl();service.nextmuxDataRoot=()=>root;service.baseUrl=platformOrigin;service.mediaDeliveryAccountId=userId;
 return {root,body,owner,stored,calls,admit,original,scope,proof,continueWith,error,service};
}
async function journalContents(root){const rows=[];async function walk(path){for(const entry of await readdir(path,{withFileTypes:true})){const next=join(path,entry.name);if(entry.isDirectory())await walk(next);else if(entry.name.endsWith('.json'))rows.push(JSON.parse(await readFile(next,'utf8')));}}await walk(root);return rows;}

test('same linked receipt concurrently admits only one child and never changes the parent body or nonce',async t=>{
 const f=await fixture(t),p=f.proof(),results=await Promise.all(Array.from({length:5},()=>f.continueWith(p)));
 assert.equal(new Set(results.map(row=>row.requestId)).size,1);assert.equal(f.stored.size,2);assert.equal(f.calls.length,2);
 assert.equal(f.calls[1].clientNonce,p.clientNonce);assert.equal(f.calls[1].replacementAuthorityRef,f.original.authorityRef);assert.deepEqual(f.calls[1].body,f.body);
 assert.notEqual(results[0].requestId,f.original.requestId);
 const rows=await journalContents(f.root),parent=rows.find(row=>row.mode==='task'&&row.requestId===f.original.requestId);
 assert.equal(parent.bodyHash,authorityBodyHash(f.body));assert.deepEqual(parent.priceReplacement,p);assert.equal(parent.authorityRef,f.original.authorityRef);
});

test('lost child admission acknowledgement reopens exactly the same nonce and returns the original child',async t=>{
 const f=await fixture(t),p=f.proof();
 await assert.rejects(f.continueWith(p,{admit:async input=>{await f.admit(input);throw Error('ADMIT_ACK_LOST');}}),/ADMIT_ACK_LOST/);
 const child=await f.continueWith(p);
 assert.equal(f.stored.size,2);assert.equal(f.calls.length,3);assert.equal(f.calls[1].clientNonce,f.calls[2].clientNonce);
 assert.equal(child.requestId,f.stored.get(p.clientNonce).requestId);assert.equal(child.submissionState,'ready');
});

test('changed body, proof, account or deterministic child nonce cannot adopt or fork the replacement',async t=>{
 const f=await fixture(t),p=f.proof();
 for(const replacement of [{...p,version:2},{...p,authority:'legacy'},{...p,originalRequestId:randomUUID()},{...p,bodyHash:'0'.repeat(64)},{...p,clientNonce:'not-a-uuid'}])
  await assert.rejects(f.continueWith(replacement),error=>/TASK_/.test(error.code));
 await assert.rejects(f.continueWith(p,{body:{...f.body,messages:[]}}),error=>error.code==='TASK_PRICE_REPLACEMENT_INVALID');
 await assert.rejects(f.continueWith(p,{userId:'foreign-account'}),error=>error.code==='TASK_AUTHORITY_JOURNAL_CONFLICT');
 assert.equal(f.calls.length,1);await f.continueWith(p);
 await assert.rejects(f.continueWith({...p,clientNonce:randomUUID()}),error=>error.code==='TASK_PRICE_REPLACEMENT_CONFLICT');
 assert.equal(f.stored.size,2);assert.equal(f.calls.length,2);
});

test('a cancelled original cannot acquire a new price child',async t=>{
 const f=await fixture(t);await recordManagedTaskDelivery({...f.scope(f.original.requestId),delivery:'cancelled'});
 await assert.rejects(f.continueWith(f.proof()),error=>error.code==='TASK_PRICE_REPLACEMENT_INVALID');assert.equal(f.stored.size,1);
});

test('recovered submitted child is receipt-only and never authorizes a second model POST',async t=>{
 const f=await fixture(t),p=f.proof(),child=await f.continueWith(p);
 await claimManagedTaskSubmission({...f.scope(f.original.requestId),body:f.body});
 await claimManagedTaskSubmission({...f.scope(child.requestId),body:f.body});
 const parent=await loadManagedReceiptAuthority(f.scope(f.original.requestId));const polls=[];
 f.service.fetchManagedTaskReceipt=async current=>{polls.push(current.requestId);if(current.requestId===parent.requestId)throw f.error(p);return {call:{id:child.requestId},response:{content:'existing answer'},billing:{chargedMicros:17,currency:'USD'}};};
 f.service.request=async()=>assert.fail('known child admission must not be sent again');
 const result=await f.service.withManagedTaskCapacity(parent,f.body,async()=>assert.fail('submitted child must not POST again'));
 assert.deepEqual(polls,[parent.requestId,child.requestId]);assert.equal(result.call.id,child.requestId);assert.equal(result.billing.chargedMicros,17);assert.equal(f.stored.size,2);
});

test('multiple verified zero-charge price revisions continue inside one call with the identical tool history',async t=>{
 const f=await fixture(t),submitted=[],proofs=new Map();
 f.service.request=async(path,options)=>{assert.equal(path,'/api/gateway/task-authority/admit');return f.admit(options.body);};
 const result=await f.service.withManagedTaskCapacity(f.original,f.body,async(resuming,current)=>{
  submitted.push(current.requestId);assert.equal(resuming,false);
  if(submitted.length<4){const p=f.proof(current.requestId);proofs.set(current.requestId,p);throw f.error(p);}
  return {call:{id:current.requestId},response:{content:'final model answer'},billing:{chargedMicros:23,currency:'USD'}};
 });
 assert.equal(submitted.length,4);assert.equal(new Set(submitted).size,4);assert.equal(f.stored.size,4);assert.equal(result.call.id,submitted[3]);
 assert(f.calls.every(call=>authorityBodyHash(call.body)===authorityBodyHash(f.body)));assert.equal(result.billing.chargedMicros,23);
});

for(const details of [{chargedMicros:1},{providerAccepted:true},{acceptanceUnknown:true},{partial:true},{visibleOutputStarted:true},{toolCallStarted:true},{reasoningStarted:true},{usageKnown:false},{settled:false}]){
 test(`unproved replacement ${Object.keys(details)[0]} cannot create another model request`,async t=>{
  const f=await fixture(t),p=f.proof(),failure=f.error(p,details);assert.equal(failure.priceReplacement,undefined);
  let submitted=0;f.service.request=async()=>assert.fail('invalid replacement must never re-admit');
  await assert.rejects(f.service.withManagedTaskCapacity(f.original,f.body,async()=>{submitted++;throw failure;}));
  assert.equal(submitted,1);assert.equal(f.stored.size,1);
 });
}

test('cancelled linked child is recovered as cancelled without POST, new nonce or earlier tool execution',async t=>{
 const f=await fixture(t),p=f.proof(),child=await f.continueWith(p);
 await recordManagedTaskDelivery({...f.scope(child.requestId),delivery:'cancelled'});
 f.service.request=async()=>assert.fail('cancelled child must not re-admit');let submitted=0;
 await assert.rejects(f.service.withManagedTaskCapacity(f.original,f.body,async()=>{submitted++;throw f.error(p);}),error=>error.code==='CANCELLED');
 assert.equal(submitted,1);assert.equal(f.stored.size,2);
});

test('linked admission lost ACK continues automatically with one deterministic child and one final model dispatch',async t=>{
 const f=await fixture(t),p=f.proof();let first=true;
 f.service.request=async(path,options)=>{assert.equal(path,'/api/gateway/task-authority/admit');const response=await f.admit(options.body);if(first){first=false;throw new TestPlatformRequestError('PLATFORM_OFFLINE','lost admission ACK',503,1);}return response;};
 const submissions=[];
 const result=await f.service.withManagedTaskCapacity(f.original,f.body,async(_resuming,current)=>{submissions.push(current.requestId);if(current.requestId===f.original.requestId)throw f.error(p);return {call:{id:current.requestId},response:{content:'success after lost ACK'},billing:{chargedMicros:17,currency:'USD'}};});
 assert.deepEqual(submissions,[f.original.requestId,f.stored.get(p.clientNonce).requestId]);assert.equal(result.billing.chargedMicros,17);
 assert.equal(f.stored.size,2);assert.equal(f.calls.length,3);assert.equal(f.calls[1].clientNonce,f.calls[2].clientNonce);
});

test('cancel during a lost replacement admission ACK persists cancellation and never submits the child',async t=>{
 const f=await fixture(t),p=f.proof(),controller=new AbortController();let submitted=0;
 f.service.request=async(path,options)=>{assert.equal(path,'/api/gateway/task-authority/admit');await f.admit(options.body);controller.abort('user_stop');throw new TestPlatformRequestError('PLATFORM_OFFLINE','lost ACK while stopped',503,1);};
 await assert.rejects(f.service.withManagedTaskCapacity(f.original,f.body,async()=>{submitted++;throw f.error(p);},controller.signal),error=>error.code==='CANCELLED');
 assert.equal(submitted,1);assert.equal(f.stored.size,2);
 const recovered=await loadManagedReceiptAuthority(f.scope(f.original.requestId));assert.equal(recovered.submissionState,'cancelled','restart must not revive the pending replacement');
 await assert.rejects(f.service.withManagedTaskCapacity(recovered,f.body,async()=>assert.fail('stopped model must not submit again')),error=>error.code==='CANCELLED');
});


for (const stage of ['before-admit','lost-ack','ready']) {
 test(`pending replacement cancellation fences ${stage} without model dispatch or a new admission`,async t=>{
  const f=await fixture(t),p=f.proof();let child;
  if(stage==='lost-ack')await assert.rejects(f.continueWith(p,{admit:async input=>{await f.admit(input);throw Error('ACK_LOST');}}),/ACK_LOST/);
  if(stage==='ready')child=await f.continueWith(p);
  const admissions=f.calls.length;
  assert.deepEqual(await cancelPendingManagedTaskPriceReplacement({...f.scope(f.original.requestId),body:f.body,replacement:p}),{cancelled:true,requestId:f.original.requestId});
  assert.equal((await loadManagedReceiptAuthority(f.scope(f.original.requestId))).submissionState,'cancelled');
  await assert.rejects(f.continueWith(p),error=>['TASK_PRICE_REPLACEMENT_INVALID','TASK_AUTHORITY_CANCELLED'].includes(error.code));
  if(child)assert.equal(await claimManagedTaskSubmission({...f.scope(child.requestId),body:f.body}),false);
  assert.equal(f.calls.length,admissions);
 });
}
for (const state of ['submitted','waiting_capacity','cancel_requested']) {
 test(`cancelling linked ${state} returns its real authority and never invents a zero-charge close`,async t=>{
  const f=await fixture(t),p=f.proof(),child=await f.continueWith(p);
  await claimManagedTaskSubmission({...f.scope(child.requestId),body:f.body});
  if(state!=='submitted')await recordManagedTaskDelivery({...f.scope(child.requestId),delivery:state});
  const result=await cancelPendingManagedTaskPriceReplacement({...f.scope(f.original.requestId),body:f.body,replacement:p});
  assert.equal(result.cancelled,false);assert.equal(result.authority.requestId,child.requestId);assert.equal(result.authority.submissionState,state);
  assert.notEqual((await loadManagedReceiptAuthority(f.scope(f.original.requestId))).submissionState,'cancelled');assert.equal(f.stored.size,2);
 });
}

test('cancel racing an in-flight child admission serializes before any local submission claim',async t=>{
 const f=await fixture(t),p=f.proof();let entered,release;
 const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
 const childPromise=f.continueWith(p,{admit:async input=>{const result=await f.admit(input);entered();await gate;return result;}});
 await started;
 const cancelPromise=cancelPendingManagedTaskPriceReplacement({...f.scope(f.original.requestId),body:f.body,replacement:p});
 release();const [child,cancelled]=await Promise.all([childPromise,cancelPromise]);
 assert.equal(cancelled.cancelled,true);assert.equal(await claimManagedTaskSubmission({...f.scope(child.requestId),body:f.body}),false);assert.equal(f.stored.size,2);
});

test('user cancellation after child admission acknowledgement but before first POST cancels the ready child',async t=>{
 const f=await fixture(t),p=f.proof(),controller=new AbortController();let posts=0;
 f.service.request=async(path,options)=>{assert.equal(path,'/api/gateway/task-authority/admit');const result=await f.admit(options.body);controller.abort('user_stop');return result;};
 await assert.rejects(f.service.withManagedTaskCapacity(f.original,f.body,async()=>{posts++;throw f.error(p);},controller.signal),error=>error.code==='CANCELLED');
 assert.equal(posts,1);assert.equal(f.stored.size,2);
 const child=f.stored.get(p.clientNonce);assert.equal((await loadManagedReceiptAuthority(f.scope(child.requestId))).submissionState,'cancelled');
 assert.equal((await loadManagedReceiptAuthority(f.scope(f.original.requestId))).submissionState,'cancelled');
});

test('client shutdown during a lost linked admission ACK preserves resumability and never marks user cancellation',async t=>{
 const f=await fixture(t),p=f.proof(),controller=new AbortController();let posts=0;
 f.service.request=async(path,options)=>{assert.equal(path,'/api/gateway/task-authority/admit');await f.admit(options.body);controller.abort('client_shutdown');throw new TestPlatformRequestError('PLATFORM_OFFLINE','shutdown before ACK',503,1);};
 await assert.rejects(f.service.withManagedTaskCapacity(f.original,f.body,async()=>{posts++;throw f.error(p);},controller.signal),error=>error.code==='CANCELLED');
 assert.equal(posts,1);assert.equal(f.stored.size,2);
 assert.notEqual((await loadManagedReceiptAuthority(f.scope(f.original.requestId))).submissionState,'cancelled');
 const child=await f.continueWith(p);assert.equal(child.requestId,f.stored.get(p.clientNonce).requestId);assert.equal(child.submissionState,'ready');assert.equal(f.stored.size,2);
});
