import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadCurrentSource } from './helpers/current-source-loader.mjs';
const runtimeUrl=new URL('../../agent-runtime/src/delegation-ledger.ts',import.meta.url);
const contextUrl=new URL('../../agent-runtime/src/task-context.ts',import.meta.url);
const source=new URL('../src/node/nextmux-agent-run-state-store.ts',import.meta.url);
const runtime={...loadCurrentSource(runtimeUrl),...loadCurrentSource(contextUrl)};
const publisherUrl=new URL('../src/node/nextmux-agent-delegation-lock-windows.ts',import.meta.url);
const publisher=loadCurrentSource(publisherUrl);
async function actualRename(from,to){return process.platform==='win32'&&String(to).endsWith('.lock')?publisher.moveWindowsDelegationLock(from,to):fs.rename(from,to);}
function store(root,overrides={}){const {AgentRunStateStore}=loadCurrentSource(source,{'@nextmux/agent-runtime':runtime,'fs/promises':{...fs,...overrides},'./nextmux-agent-delegation-lock-windows':{...publisher,moveWindowsDelegationLock:overrides.rename||publisher.moveWindowsDelegationLock}});return new AgentRunStateStore(root);}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
const deadId='11111111-1111-4111-8111-111111111111';
async function fixture(t){
 const root=await fs.mkdtemp(join(tmpdir(),'nm-child-lock-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const rootRunId='root-child-lock-test',childRunId='child-lock-test',parentRunId='parent-lock-test',owner={workspaceRoot:root,conversationId:'lock-fixture',rootRunId,depth:0};
 const stateRoot=join(root,'.state'),target=join(stateRoot,'run-state',`delegation-${createHash('sha256').update(rootRunId).digest('hex')}.json`),lock=target+'.lock';
 const empty=runtime.createAgentDelegationLedger(rootRunId);await store(stateRoot).saveDelegationLedger(empty,owner);
 const taskContext=runtime.createAgentTaskContext({workspaceRoot:root,conversationId:owner.conversationId,rootRunId,parentRunId,depth:1,goal:'local lock fixture',permissionMode:'read_only',allowedToolNames:[]});
 const metadata={childRunId,parentRunId,rootRunId,depth:1,status:'running',taskContext};
 function commit(s,index){const handle=`resume-${index.repeat(8)}-${index.repeat(4)}-4${index.repeat(3)}-8${index.repeat(3)}-${index.repeat(12)}`;return s.saveDelegationLedger(runtime.recordAgentDelegationCheckpoint(empty,metadata,handle),owner,{childRunId,resumeCheckpointId:handle,expectedCheckpointRevision:0});}
 async function stale(){await fs.mkdir(lock);const token=join(lock,`owner-${deadId}.json`);await fs.writeFile(token,JSON.stringify({ownerId:deadId,ownerPid:2147483647}));return token;}
 return {root,stateRoot,target,lock,owner,rootRunId,childRunId,empty,commit,stale};
}

test('two stale reclaimers cannot delete a replacement live lock or both acknowledge revision one',async t=>{
 const f=await fixture(t),token=await f.stale(),bothRead=deferred(),aOwned=deferred(),bTried=deferred(),events=[];let reads=0;
 function scheduled(label){let observed=false,owned=false;return store(f.stateRoot,{
  async readFile(path,...args){const value=await fs.readFile(path,...args);if(path===token&&!observed){observed=true;if(++reads===2)bothRead.resolve();await bothRead.promise;}if(path===f.target&&owned){events.push(label+':read-index');if(label==='A')await bTried.promise;}return value;},
  async unlink(path){if(path===token&&label==='B'){await aOwned.promise;events.push('B:stale-unlink');bTried.resolve();}return fs.unlink(path);},
  async rename(from,to){await actualRename(from,to);if(to===f.lock){owned=true;events.push(label+':owned');if(label==='A')aOwned.resolve();}}
 });}
 const results=await Promise.allSettled([f.commit(scheduled('A'),'2'),f.commit(scheduled('B'),'3')]);
 assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');assert.equal(results[1].reason.code,'CHILD_CHECKPOINT_CONFLICT');
 assert.ok(events.indexOf('B:stale-unlink')<events.indexOf('B:owned'));assert.ok(events.indexOf('A:read-index')<events.indexOf('B:read-index'));
 const disk=(await store(f.stateRoot).loadDelegationLedger(f.rootRunId)).ledger;assert.equal(disk.children[0].resumeCheckpointId,results[0].value.children[0].resumeCheckpointId);assert.equal(disk.children[0].checkpointRevision,1);
});

test('a late rmdir cannot remove a newly published nonempty lock, including Windows rename contention',async t=>{
 const f=await fixture(t),token=await f.stale(),aDeleted=deferred(),bOwned=deferred(),aTriedRmdir=deferred();let first=true,windowsContentions=0;
 const a=store(f.stateRoot,{
  async unlink(path){await fs.unlink(path);if(path===token)aDeleted.resolve();},
  async rmdir(path){if(path===f.lock&&first){first=false;await bOwned.promise;try{await fs.rmdir(path);assert.fail('live nonempty lock was removed');}catch(error){assert.equal(error.code,'ENOTEMPTY');aTriedRmdir.resolve();throw error;}}return fs.rmdir(path);}
 });
 const b=store(f.stateRoot,{
  async rename(from,to){if(to===f.lock){try{await fs.lstat(to);windowsContentions++;throw Object.assign(new Error('Windows existing directory'),{code:'EPERM'});}catch(error){if(error.code!=='ENOENT')throw error;}}await actualRename(from,to);if(to===f.lock)bOwned.resolve();},
  async readFile(path,...args){const value=await fs.readFile(path,...args);if(path===f.target)await aTriedRmdir.promise;return value;}
 });
 const pa=f.commit(a,'2');await aDeleted.promise;const pb=f.commit(b,'3');const results=await Promise.allSettled([pa,pb]);assert.equal(windowsContentions>0,true);assert.equal(results[1].status,'fulfilled');assert.equal(results[0].status,'rejected');assert.equal(results[0].reason.code,'CHILD_CHECKPOINT_CONFLICT');
});

test('a private candidate interrupted before its token is written cannot occupy or replace the public lock',async t=>{
 const f=await fixture(t),candidateMade=deferred(),finishCandidate=deferred();let candidate;
 const a=store(f.stateRoot,{async mkdir(path,...args){const result=await fs.mkdir(path,...args);if(String(path).includes('.lock.candidate-')){candidate=path;candidateMade.resolve();await finishCandidate.promise;}return result;}});
 const pa=f.commit(a,'2');await candidateMade.promise;assert.deepEqual(await fs.readdir(candidate),[]);await assert.rejects(fs.lstat(f.lock),e=>e.code==='ENOENT');
 const b=await f.commit(store(f.stateRoot),'3');finishCandidate.resolve();await assert.rejects(pa,e=>e.code==='CHILD_CHECKPOINT_CONFLICT');assert.equal((await store(f.stateRoot).loadDelegationLedger(f.rootRunId)).ledger.children[0].resumeCheckpointId,b.children[0].resumeCheckpointId);
});

test('a live PID is not aged out, and failed contenders remove only their private candidate',async t=>{
 const f=await fixture(t);await fs.mkdir(f.lock);const token=join(f.lock,`owner-${deadId}.json`),body=JSON.stringify({ownerId:deadId,ownerPid:process.pid});await fs.writeFile(token,body);await fs.utimes(token,new Date(0),new Date(0));await fs.utimes(f.lock,new Date(0),new Date(0));let reads=0;
 const s=store(f.stateRoot,{async readFile(path,...args){if(path===token&&++reads===3)throw Object.assign(new Error('end bounded live-owner fixture'),{code:'EIO'});return fs.readFile(path,...args);}});
 await assert.rejects(f.commit(s,'2'),e=>e.code==='DELEGATION_LEDGER_UNAVAILABLE');assert.equal(await fs.readFile(token,'utf8'),body);assert.equal((await fs.readdir(join(f.stateRoot,'run-state'))).filter(n=>n.includes('.candidate-')).length,0);
});

test('legacy file, multiple owners and symlink locks remain intact; empty orphan directories recover',async t=>{
 const f=await fixture(t);const legacy=JSON.stringify({ownerId:'legacy',ownerPid:2147483647});await fs.writeFile(f.lock,legacy);await assert.rejects(f.commit(store(f.stateRoot),'2'),e=>e.code==='DELEGATION_LEDGER_LEGACY_LOCK');assert.equal(await fs.readFile(f.lock,'utf8'),legacy);await fs.unlink(f.lock);
 await fs.mkdir(f.lock);await fs.writeFile(join(f.lock,'unexpected'),'keep');await fs.writeFile(join(f.lock,'another'),'keep');await assert.rejects(f.commit(store(f.stateRoot),'2'),e=>e.code==='DELEGATION_LEDGER_UNSAFE');assert.equal((await fs.readdir(f.lock)).length,2);await fs.rm(f.lock,{recursive:true});
 const elsewhere=join(f.root,'keep-dir');await fs.mkdir(elsewhere);await fs.writeFile(join(elsewhere,'keep'),'kept');await fs.symlink(elsewhere,f.lock,process.platform==='win32'?'junction':'dir');await assert.rejects(f.commit(store(f.stateRoot),'2'),e=>e.code==='DELEGATION_LEDGER_UNSAFE');assert.equal(await fs.readFile(join(elsewhere,'keep'),'utf8'),'kept');await fs.unlink(f.lock);
 await fs.mkdir(f.lock);const result=await f.commit(store(f.stateRoot),'2');assert.equal(result.children[0].checkpointRevision,1);await assert.rejects(fs.lstat(f.lock),e=>e.code==='ENOENT');
});

test('a hard-terminated process leaves a recoverable published owner token',async t=>{
 const f=await fixture(t);const loader=new URL('./helpers/current-source-loader.mjs',import.meta.url).href;
 const program=`import * as fs from 'node:fs/promises';import {loadCurrentSource} from ${JSON.stringify(loader)};const runtime=loadCurrentSource(new URL(${JSON.stringify(runtimeUrl.href)}));const publisher=loadCurrentSource(new URL(${JSON.stringify(publisherUrl.href)}));const rename=async(a,b)=>{await (process.platform==='win32'&&b===${JSON.stringify(f.lock)}?publisher.moveWindowsDelegationLock(a,b):fs.rename(a,b));if(b===${JSON.stringify(f.lock)}){setInterval(()=>{},1000);process.stdout.write('LOCKED\\n');await new Promise(()=>{});}};const {AgentRunStateStore}=loadCurrentSource(new URL(${JSON.stringify(source.href)}),{'@nextmux/agent-runtime':runtime,'fs/promises':{...fs,rename},'./nextmux-agent-delegation-lock-windows':{moveWindowsDelegationLock:rename}});await new AgentRunStateStore(${JSON.stringify(f.stateRoot)}).saveDelegationLedger(runtime.createAgentDelegationLedger(${JSON.stringify(f.rootRunId)}),${JSON.stringify(f.owner)});`;
 const child=spawn(process.execPath,['--input-type=module','-e',program],{stdio:['ignore','pipe','pipe']});let error='';child.stderr.on('data',data=>error+=data);t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
 // Keep the process alive after the pending Promise; unresolved Promises alone
 // do not keep Node's event loop running.
 const ready=await new Promise((yes,no)=>{child.stdout.once('data',()=>yes(true));child.once('exit',code=>no(new Error(`fixture exited ${code}: ${error}`)));child.once('error',no);});assert.equal(ready,true);
 child.kill('SIGKILL');await new Promise(resolve=>child.once('exit',resolve));const names=await fs.readdir(f.lock);assert.equal(names.length,1);assert.equal(JSON.parse(await fs.readFile(join(f.lock,names[0]),'utf8')).ownerPid,child.pid);
 const result=await f.commit(store(f.stateRoot),'2');assert.equal(result.children[0].checkpointRevision,1);await assert.rejects(fs.lstat(f.lock),e=>e.code==='ENOENT');
});

test('a destination released between rename contention and inspection is retried safely',async t=>{
 const f=await fixture(t);let collided=false;
 const s=store(f.stateRoot,{async rename(from,to){if(to===f.lock&&!collided){collided=true;throw Object.assign(new Error('owner released before inspection'),{code:'EEXIST'});}return actualRename(from,to);}});
 const result=await f.commit(s,'2');assert.equal(collided,true);assert.equal(result.children[0].checkpointRevision,1);await assert.rejects(fs.lstat(f.lock),e=>e.code==='ENOENT');
});

test('a legacy file created at the publication boundary is preserved without a check-then-rename gap',async t=>{
 const f=await fixture(t),legacy='legacy concurrent owner\nkeep exact bytes';let arrived=false;
 const s=store(f.stateRoot,{async rename(from,to){if(to===f.lock&&!arrived){arrived=true;await fs.writeFile(f.lock,legacy,{flag:'wx'});}return actualRename(from,to);}});
 await assert.rejects(f.commit(s,'2'),error=>error.code==='DELEGATION_LEDGER_LEGACY_LOCK');assert.equal(arrived,true);assert.equal(await fs.readFile(f.lock,'utf8'),legacy);
 assert.equal((await store(f.stateRoot).loadDelegationLedger(f.rootRunId)).ledger.children.length,0);
});
