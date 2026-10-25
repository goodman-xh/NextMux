import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ManagedContentReceiver, readStreamedContent } from '../lib/node/nextmux-content-transfer.js';
import { saveResumableVideo } from '../lib/node/nextmux-video-resume.js';
import { prepareManagedHistoryBody } from '../lib/node/nextmux-media-delivery-history.js';
import { expandInlineMedia } from '../../../apps/cloudflare-platform/src/gateway-inline-media.js';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { createSyntheticPng64 } from '../../../apps/cloudflare-platform/test/live-relay-e2e.mjs';
import { ManagedGatewaySessionPool, ManagedSessionUnavailable } from '../lib/node/nextmux-managed-session.js';
const hash = b => createHash('sha256').update(b).digest('hex');
const mp4 = Buffer.concat([Buffer.from([0,0,0,24,...Buffer.from('ftypisom'),0,0,0,0,...Buffer.from('isommp42')]), Buffer.alloc(60000, 5)]);
async function dir(t) { const p = await realpath(await mkdtemp(join(tmpdir(),'nextmux-content-v2-'))); t.after(()=>rm(p,{recursive:true,force:true})); return p; }
const signal = () => new AbortController().signal;
const response = (b=mp4, extra={}) => new Response(b,{headers:{'content-type':'video/mp4','content-length':String(b.length),etag:'"same"',...extra}});
test('ordered receiver publishes only verified parts and survives process reconstruction without cloud content', async t => {
 const root=await dir(t), id=randomUUID(), partId=randomUUID(), bytes=Buffer.from('local-only');
 const receiver=new ManagedContentReceiver(root), receipt={transfer:'stream-v2',contentRetained:false,partId,sizeBytes:bytes.length,sha256:hash(bytes),extension:'png',mimeType:'image/png'};
 await receiver.event(id,{type:'media.data',version:2,partId,offset:0,data:bytes.toString('base64')});
 await assert.rejects(readStreamedContent(root,id,receipt));
 await receiver.event(id,{type:'media.finished',version:2,media:receipt}); await receiver.close();
 assert.deepEqual((await readStreamedContent(root,id,receipt)).bytes,bytes);
 assert.equal((await stat(join(root,id,`${partId}.content`))).mode&0o777,0o600);
 await assert.rejects(readStreamedContent(root,randomUUID(),receipt));
});
test('sequence gap, altered hash and incomplete transport never publish content',async t=>{
 for(const bad of ['gap','hash','close']){
  const root=await dir(t),id=randomUUID(),partId=randomUUID(),receiver=new ManagedContentReceiver(root);
  await receiver.event(id,{type:'media.data',version:2,partId,offset:0,data:'YQ=='});
  if(bad==='gap')await assert.rejects(receiver.event(id,{type:'media.data',version:2,partId,offset:2,data:'Yg=='}));
  if(bad==='hash')await assert.rejects(receiver.event(id,{type:'media.finished',version:2,media:{transfer:'stream-v2',contentRetained:false,partId,sizeBytes:1,sha256:'0'.repeat(64),extension:'png',mimeType:'image/png'}}));
  await receiver.close();assert.deepEqual((await readdir(join(root,id))).filter(x=>x.endsWith('.content')),[]);
 }
});
async function interrupted(destination,etag='"same"'){
 let sent=false;
 await assert.rejects(saveResumableVideo({destination,source:'original-job',maximum:1e6,signal:signal(),response:new Response(new ReadableStream({pull(c){if(!sent){sent=true;c.enqueue(mp4.subarray(0,20000));}else c.error(new Error('fixture disconnect'));}}),{headers:{'content-type':'video/mp4','content-length':String(mp4.length),...(etag?{etag}:{})}})}));
}
test('interrupted original download resumes by exact Range + strong If-Range and hashes whole local file',async t=>{
 const destination=join(await dir(t),'out.mp4');await interrupted(destination);let gets=0;
 const result=await saveResumableVideo({destination,source:'original-job',maximum:1e6,signal:signal(),response:response(),reopen:async headers=>{
  gets++;assert.deepEqual(headers,{range:'bytes=20000-','if-range':'"same"'});
  return new Response(mp4.subarray(20000),{status:206,headers:{'content-type':'video/mp4',etag:'"same"','content-length':String(mp4.length-20000),'content-range':`bytes 20000-${mp4.length-1}/${mp4.length}`}});
 }});assert.equal(gets,1);assert.equal(result.sha256,hash(mp4));assert.deepEqual(await readFile(destination),mp4);
});
test('Range ignored restarts original GET; changed validator discards stale partial; no validator keeps no partial',async t=>{
 for(const mode of ['200','changed','none']){
  const root=await dir(t),destination=join(root,'out.mp4');await interrupted(destination,mode==='none'?null:'"same"');
  if(mode==='none'){assert.deepEqual(await readdir(root),[]);continue;}
  const run=saveResumableVideo({destination,source:'original-job',maximum:1e6,signal:signal(),response:response(),reopen:async()=>mode==='200'?response():new Response(mp4.subarray(20000),{status:206,headers:{etag:'"changed"','content-range':`bytes 20000-${mp4.length-1}/${mp4.length}`}})});
  if(mode==='changed'){await assert.rejects(run,/RESOURCE_CHANGED/);assert.deepEqual(await readdir(root),[]);}else{assert.equal((await run).sha256,hash(mp4));}
 }
});
test('v2 history deduplicates only within current request, never calls upload, rejects oversize before dispatch',async()=>{
 const bytes=Buffer.alloc(120000,7),asset={sha256:hash(bytes),mimeType:'audio/wav',sizeBytes:bytes.length};
 const original={contentTransfer:'stream-v2',messages:[1,2].map(()=>({role:'assistant',content:'',outputParts:[{type:'audio',asset,dataBase64:bytes.toString('base64')}]}))};
 const opts={fetch:()=>assert.fail('no upload'),deviceId:()=>assert.fail('no identity')};
 const prepared=await prepareManagedHistoryBody(original,opts);assert.deepEqual(prepared.uploadIds,[]);assert.equal(Object.keys(prepared.body.inlineMedia).length,1);
 assert.deepEqual(expandInlineMedia(prepared.body),original.messages);
 assert.throws(()=>expandInlineMedia({...prepared.body,contentTransfer:undefined}));
 assert.throws(()=>expandInlineMedia({...prepared.body,inlineMedia:{...prepared.body.inlineMedia,['b'.repeat(64)]:'YQ=='}}));
 await assert.rejects(prepareManagedHistoryBody({...original,instructions:'x'.repeat(49*1024*1024)},opts),/REQUEST_TOO_LARGE/);
});

test('desktop ordered stream uses actual billing request ID and persists ordered local assets without a download request',async t=>{
 const root=await dir(t),service=new NextMuxPlatformServiceImpl(),requestId=randomUUID(),taskId=randomUUID(),partId=randomUUID(),bytes=Buffer.from(createSyntheticPng64());
 service.baseUrl='https://fixture.invalid';service.nextmuxDataRoot=()=>root;service.networkFetch=()=>assert.fail('No output download or model repeat');
 const asset={sha256:hash(bytes),sizeBytes:bytes.length,mimeType:'image/png'},receipt={...asset,transfer:'stream-v2',contentRetained:false,partId,extension:'png'};
 const result={call:{id:requestId},response:{content:'BeforeAfter',outputParts:[{type:'text',text:'Before'},{type:'image',asset},{type:'text',text:'After'}],outputAssets:[{...receipt,partIndex:1,expiresAt:Date.now()+1000}]},billing:{currency:'USD',chargedMicros:3}};
 const events=[{type:'response.started',requestId},{type:'media.data',requestId,version:2,partId,offset:0,data:bytes.toString('base64')},{type:'media.finished',requestId,version:2,media:receipt},{type:'completed',result}].map((e,i)=>({...e,taskId,sequence:i+1}));
 const parsed=await service.consumeManagedGatewayStream(new Response(events.map(e=>JSON.stringify(e)).join('\n'),{headers:{'content-type':'application/x-ndjson'}}),{});
 const saved=await service.persistManagedGatewayOutputParts(parsed,'local-owner');assert.deepEqual(saved.map(p=>p.type),['text','image','text']);assert.equal(saved[1].asset.sha256,asset.sha256);
 assert.deepEqual((await readStreamedContent(service.managedContentRoot(),requestId,receipt)).bytes,bytes);
});

test('ordered v2 rejects WS before connection or start frame, allowing unchanged HTTP request transport',async()=>{
 let connects=0;
 const transport=new ManagedGatewaySessionPool({baseUrl:'https://fixture.invalid',deviceId:async()=>{connects++;return'fixture';},WebSocket:class{constructor(){connects++;}}});
 await assert.rejects(transport.openStream({contentTransfer:'stream-v2',acceptOrderedOutput:true},'unchanged-original-key'),ManagedSessionUnavailable);assert.equal(connects,0);transport.close();
});

test('managed image receives automatically, then same receipt reuses local content; legacy receipt reads only original protected asset',async t=>{
 const root=await dir(t),service=new NextMuxPlatformServiceImpl(),requestId=randomUUID(),partId=randomUUID(),bytes=Buffer.from(createSyntheticPng64());
 service.baseUrl='https://fixture.invalid';service.nextmuxDataRoot=()=>root;service.deviceId=async()=>'fixture-device';service.getPrivacySettings=async()=>({});
 const receipt={kind:'image',requestId,mimeType:'image/png',extension:'png',sizeBytes:bytes.length,sha256:hash(bytes),expiresAt:Date.now()+60000,provider:'Fixture',model:'fixture',transfer:'stream-v2',contentRetained:false,partId};
 const result={call:{id:requestId},media:receipt,billing:{currency:'USD',chargedMicros:1}};
 const job={kind:'image',id:'media-job-'+randomUUID(),idempotencyKey:'original-image-request'},input={connectionId:'managed:fixed:'+randomUUID(),keyPriceQuoteId:'kq1_'+'a'.repeat(64),prompt:'fixture',width:64,height:64,model:'fixture'};
 let posts=0,gets=0,mode='first';
 service.networkFetch=async(url,init)=>{
  if(init.method==='GET'){gets++;assert.equal(new URL(url).pathname,`/api/gateway/media/${requestId}/result`);return new Response(bytes,{headers:{'content-type':'image/png','x-nextmux-call-id':requestId}});}
  posts++;assert.equal(new Headers(init.headers).get('x-nextmux-content-transfer'),'stream-v2');assert.equal(new Headers(init.headers).get('idempotency-key'),job.idempotencyKey);
  const media=mode==='legacy'?{...receipt,transfer:undefined,contentRetained:undefined,partId:undefined,downloadPath:`/api/gateway/media/${requestId}/result`}:receipt;
  const events=[...(mode==='first'?[{type:'request.started',requestId},{type:'media.data',version:2,partId,offset:0,data:bytes.toString('base64')},{type:'media.finished',version:2,media:receipt}]:[]),{type:'completed',result:{...result,media}}];
  return new Response(events.map((e,i)=>JSON.stringify({...e,taskId:requestId,sequence:i+1})).join('\n'),{headers:{'content-type':'application/x-ndjson'}});
 };
 for(mode of ['first','receipt','legacy'])assert.deepEqual(Buffer.from((await service.requestManagedMedia(job,input,signal())).bytes),bytes);
 assert.equal(posts,3,'three explicit calls reuse the same original key');assert.equal(gets,1,'only old cached receipt needs GET');
});
