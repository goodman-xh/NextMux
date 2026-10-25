import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { appendFile, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import ts from 'typescript';
import { sourceModule } from './helpers/comic-organizer-source-loader.mjs';
const usage=sourceModule('node/nextmux-own-api-usage.ts');
const {comicChatJobOrigin}=sourceModule('common/nextmux-comic-chat.ts');
const connections=[{id:'own-a'},{id:'own-b'}];
const output={assetId:'asset-1',assetKind:'video',relativeUri:'nextmux.media/result.mp4',byteLength:42,sha256:'a'.repeat(64),mimeType:'video/mp4'};
const job=(connectionId='own-a',id='job-1',extra={})=>({id,kind:'video',projectId:'project',sceneId:'scene-canvas-main',shotId:'node-1',input:{connectionId,model:'minimax/hailuo-3-max',prompt:'Synthetic test'},status:'succeeded',output,completedAt:'2026-10-04T10:00:00.000Z',...extra});
const source=readFileSync(new URL('../src/node/nextmux-platform-service.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('service.ts',source,ts.ScriptTarget.Latest,true),cls=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='NextMuxPlatformServiceImpl');
const names=['ownApiUsagePath','recordOwnApiUsage','recordOwnApiMediaUsage','listOwnApiUsage','ownApiUsageSource','runMediaLane','getMediaWorkspaceState'];
const methods=names.map(name=>{const m=cls.members.find(n=>ts.isMethodDeclaration(n)&&n.name.getText(ast)===name);assert.ok(m,name);return m.getText(ast)});
const deps={...usage,join,basename,readFile,resolve,unlink,comicChatJobOrigin,holdDesktopPowerSave:async()=>async()=>{},MEDIA_JOB_ABORTS:new Map()};
const Host=new Function(...Object.keys(deps),ts.transpile(`class Host {${methods.join('\n')}}return Host`,{target:ts.ScriptTarget.ES2022}))(...Object.values(deps));
function host(root){return Object.assign(new Host(),{nextmuxDataRoot:()=>root,ownApiUsageWrites:Promise.resolve(),readOfficialConnectionIndex:async()=>connections});}
async function temporary(t){const root=await mkdtemp(join(tmpdir(),'nmx-own-media-usage-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}

test('own usage resolves exact raw and legacy route IDs, never managed/local or unknown connections',()=>{
 for(const value of ['own-a','official:own-a','official:own-a:minimax%2Fhailuo-3-max'])assert.equal(usage.ownApiUsageConnectionId(value,connections),'own-a');
 for(const value of [undefined,'','unknown','official:unknown:model','official:own-a:','managed:fixed:own-a','comfyui:local','local:own-a'])assert.equal(usage.ownApiUsageConnectionId(value,connections),undefined);
 assert.equal(usage.ownApiUsageConnectionId('official:own-a:nested:model',[...connections,{id:'own-a:nested'}]),undefined,'ambiguous legacy identity is not guessed');
});
test('only real completed media jobs produce call metadata, with no invented cost or token fields',()=>{
 for(const connectionId of ['own-a','official:own-a:model']){
  const input=job(connectionId),before=JSON.stringify(input),entry=usage.ownApiUsageForMediaJob(input,connections,{kind:'comic',title:'QA'});
  assert.deepEqual(entry,{id:'job-1',at:Date.parse(input.completedAt),kind:'video',connectionId:'own-a',model:input.input.model,source:{kind:'comic',title:'QA'},status:'completed'});assert.equal(JSON.stringify(input),before);
 }
 for(const patch of [{status:'running'},{status:'failed'},{status:'cancelled'},{restoredHistoryOnly:true},{output:undefined},{completedAt:undefined},{completedAt:'bad'},{kind:'export'}])assert.equal(usage.ownApiUsageForMediaJob(job('own-a','job-1',patch),connections,{kind:'comic'}),undefined);
 for(const id of ['managed:fixed:own-a','comfyui:local','unknown'])assert.equal(usage.ownApiUsageForMediaJob(job(id),connections,{kind:'comic'}),undefined);
});
test('concurrent connections and a reopened log record each job once, while backfills retain real chronological order',async t=>{
 const root=await temporary(t),a=host(root),b=host(root),jobs=[job('own-a','raw'),job('official:own-b:model','legacy',{completedAt:'2026-10-03T10:00:00.000Z'}),job('managed:fixed:own-a','managed'),job('comfyui:local','local'),job('own-a','imported',{restoredHistoryOnly:true})];
 await Promise.all([a.recordOwnApiMediaUsage(root,jobs),b.recordOwnApiMediaUsage(root,jobs)]);
 await host(root).recordOwnApiMediaUsage(root,jobs);const entries=await a.listOwnApiUsage();assert.deepEqual(entries.map(e=>e.id),['raw','legacy']);
 assert.deepEqual(entries.map(e=>e.connectionId),['own-a','own-b']);assert.equal((await readFile(a.ownApiUsagePath(),'utf8')).trim().split('\n').length,2);
 for(const e of entries){assert.equal('inputTokens' in e,false);assert.equal('outputTokens' in e,false);assert.equal('cost' in e,false);}
});
test('a workspace refresh backfills only its already-read successful jobs and never executes a provider',async t=>{
 const root=await temporary(t),h=host(root),jobs=[job(),job('official:own-b:model','legacy')];let reads=0,scheduled=0;
 Object.assign(h,{validateWorkspaceRootInput(){},mediaJobStore:async()=>({list:async limit=>{reads++;assert.equal(limit,100);return jobs}}),ensureMediaRecovery:async()=>{},scheduleMediaWorker(){scheduled++},getMediaRuntimeState:async()=>({ffmpeg:{available:false}}),executeMediaJob(){assert.fail('no model request')},mediaRequestError:e=>e});
 const first=await h.getMediaWorkspaceState(root),second=await h.getMediaWorkspaceState(root);assert.equal(first.jobs,jobs);assert.equal(second.jobs,jobs);assert.equal(reads,2);assert.equal(scheduled,2);assert.equal((await h.listOwnApiUsage()).length,2);
});
test('the actual worker completion and checkpoint-only recovery both log raw own IDs exactly once',async t=>{
 const root=await temporary(t),h=host(root);let executions=0,attached=0;
 Object.assign(h,{connectionDisposed:false,mediaWorkspaceId:()=>root,mediaOwnerHeartbeats:new Map(),mediaAbortControllers:new Map(),mediaWorkerId:'worker',recordCanvasMediaJob:async()=>{},retryOnComicRevision:fn=>fn(),attachMediaCheckpoint:async()=>{attached++},validateMediaJobAgainstProject:async()=>{},executeMediaJob:async()=>{executions++;return output},mediaOutputSidecarPath:()=>join(root,'no-sidecar'),mediaFailure:e=>{throw e}});
 async function run(checkpoint){let claimed=false,current=job('own-a','worker-job',{status:'running',output:undefined,checkpoint});const store={claimNext:async()=>claimed?undefined:(claimed=true,current),heartbeatWorker:async()=>{},saveCheckpoint:async()=>{},complete:async()=>current=job('own-a','worker-job'),get:async()=>current,releaseWorker:async()=>{},fail:async()=>assert.fail('worker failed')};await h.runMediaLane(root,store)}
 await run(undefined);await run(output);assert.equal(executions,1);assert.equal(attached,2);assert.deepEqual((await h.listOwnApiUsage()).map(e=>e.id),['worker-job']);assert.equal(h.mediaOwnerHeartbeats.size,0);
});
test('usage failures never fail a completed result and the next safe refresh can retry',async t=>{
 const root=await temporary(t),h=host(root);h.readOfficialConnectionIndex=async()=>{throw Error('unavailable metadata')};await h.recordOwnApiMediaUsage(root,[job()]);assert.deepEqual(await h.listOwnApiUsage(),[]);
 h.readOfficialConnectionIndex=async()=>connections;await h.recordOwnApiMediaUsage(root,[job()]);assert.equal((await h.listOwnApiUsage()).length,1);
});
test('legacy duplicate/corrupt log lines are filtered and first known metadata is kept without inferred usage',async t=>{
 const root=await temporary(t),h=host(root);h.recordOwnApiUsage({id:'text-run',at:50,kind:'text',connectionId:'own-a',model:'text-model',source:{kind:'comic'},inputTokens:12,outputTokens:0,status:'completed'});await h.ownApiUsageWrites;
 const first=await readFile(h.ownApiUsagePath(),'utf8');await appendFile(h.ownApiUsagePath(),first+'not json\n{"id":1}\n');
 const entries=await h.listOwnApiUsage();assert.equal(entries.length,1);assert.equal(entries[0].inputTokens,12);assert.equal(entries[0].outputTokens,0);
});
test('retention does not resurrect older recovered jobs or append them repeatedly',async t=>{
 const root=await temporary(t),path=join(root,'usage.jsonl');const entries=Array.from({length:1000},(_,i)=>({id:'current-'+i,at:1000+i,kind:'video',connectionId:'own-a',model:'model',source:{kind:'comic'},status:'completed'}));
 await writeFile(path,entries.map(e=>JSON.stringify(e)).join('\n')+'\n');const old={...entries[0],id:'old-pruned',at:10};await usage.appendOwnApiUsage(path,[old]);await usage.appendOwnApiUsage(path,[old]);assert.equal(usage.readOwnApiUsageLog(await readFile(path,'utf8')).length,1000);assert.doesNotMatch(await readFile(path,'utf8'),/old-pruned/);
});
