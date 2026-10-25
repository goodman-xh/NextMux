import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadCurrentSource } from './helpers/current-source-loader.mjs';
const helperUrl=new URL('../src/node/nextmux-agent-delegation-lock-windows.ts',import.meta.url);
const storeUrl=new URL('../src/node/nextmux-agent-run-state-store.ts',import.meta.url);
const runtime=loadCurrentSource(new URL('../../agent-runtime/src/delegation-ledger.ts',import.meta.url));
function fakePublisher(behavior){let captured;const {moveWindowsDelegationLock}=loadCurrentSource(helperUrl,{'child_process':{spawn(executable,args,options){const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.kill=()=>{child.emit('killed');return true;};child.unref=()=>{};captured={executable,args,options,child,input:''};child.stdin.on('data',chunk=>captured.input+=chunk.toString('utf8'));child.stdin.once('finish',()=>behavior(child,captured));return child;}}});return {moveWindowsDelegationLock,get captured(){return captured;}};}
function exit(child,output,code){if(output)child.stdout.write(output);child.emit('close',code);}

test('Windows publication passes Unicode paths only as stdin JSON and requests a hidden fixed system process',async()=>{
 const fake=fakePublisher(child=>exit(child,'OK',0)),source="C:\\中文 空格\\x'$()`",destination='C:\\资料\\lock';
 await fake.moveWindowsDelegationLock(source,destination);
 assert.match(fake.captured.executable,/^[A-Za-z]:\\.*\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/);
 assert.deepEqual(fake.captured.args.slice(0,4),['-NoLogo','-NoProfile','-NonInteractive','-Command']);assert.equal(fake.captured.options.windowsHide,true);assert.equal(fake.captured.options.shell,false);
 assert.deepEqual(JSON.parse(fake.captured.input),{source,destination});assert.equal(fake.captured.args.join(' ').includes(source),false);
 assert.match(fake.captured.args[4],/\[IO\.Directory\]::Move/);assert.doesNotMatch(fake.captured.args[4],/Move-Item|MOVEFILE_REPLACE_EXISTING/);
});

test('native HRESULT codes distinguish collision, access and missing paths without parsing localized text',async()=>{
 for(const [native,code] of [['183','EEXIST'],['80','EEXIST'],['5','EACCES'],['3','ENOENT'],['206','ENAMETOOLONG']]){
  const fake=fakePublisher(child=>exit(child,'ERROR:'+native,1));await assert.rejects(fake.moveWindowsDelegationLock('C:\\a','C:\\b'),error=>error.code===code&&!error.publicationUncertain);
 }
 const lost=fakePublisher(child=>exit(child,'',2));await assert.rejects(lost.moveWindowsDelegationLock('C:\\a','C:\\b'),error=>error.publicationUncertain===true);
});

test('a timed out helper is killed and awaited before its publication outcome is reconciled',async()=>{
 let closed=false,killed=false;const fake=fakePublisher(child=>child.once('killed',()=>{killed=true;setTimeout(()=>{closed=true;exit(child,'',null);},20);}));
 await assert.rejects(fake.moveWindowsDelegationLock('C:\\a','C:\\b',5),error=>error.code==='ETIMEDOUT'&&error.publicationUncertain&&!error.helperMayStillRun&&closed);assert.equal(killed,true);
});

test('an unconfirmed helper termination is bounded and explicitly prevents publication reconciliation',async()=>{
 const fake=fakePublisher(()=>{});await assert.rejects(fake.moveWindowsDelegationLock('C:\\a','C:\\b',1),error=>error.publicationUncertain&&error.helperMayStillRun);
});

test('a process error without close never authorizes publication reconciliation, including a kill error',async()=>{
 for(const duringKill of [false,true]){
  const fake=fakePublisher(child=>{const fail=()=>child.emit('error',Object.assign(new Error('process error before close'),{code:'EIO'}));if(duringKill)child.once('killed',fail);else fail();});
  await assert.rejects(fake.moveWindowsDelegationLock('C:\\a','C:\\b',1),error=>error.code==='EIO'&&error.publicationUncertain&&error.helperMayStillRun);
 }
});

test('synchronous close during kill leaves no termination timer behind',async()=>{
 const fake=fakePublisher(child=>child.once('killed',()=>exit(child,'',null))),timers=new Set(),set=globalThis.setTimeout,clear=globalThis.clearTimeout;
 globalThis.setTimeout=(callback,delay,...args)=>{const timer=set(()=>{timers.delete(timer);callback(...args);},delay);timers.add(timer);return timer;};
 globalThis.clearTimeout=timer=>{timers.delete(timer);return clear(timer);};
 try {
  await assert.rejects(fake.moveWindowsDelegationLock('C:\\a','C:\\b',1),error=>error.code==='ETIMEDOUT'&&error.publicationUncertain&&!error.helperMayStillRun);
  assert.equal(timers.size,0);
 } finally {for(const timer of timers)clear(timer);globalThis.setTimeout=set;globalThis.clearTimeout=clear;}
});

async function withWindowsBranch(t,publish,run){
 const root=await fs.mkdtemp(join(tmpdir(),'nm-win-publish-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const original=Object.getOwnPropertyDescriptor(process,'platform');Object.defineProperty(process,'platform',{value:'win32'});
 try {
  const {AgentRunStateStore}=loadCurrentSource(storeUrl,{'@nextmux/agent-runtime':runtime,'./nextmux-agent-delegation-lock-windows':{moveWindowsDelegationLock:publish}});
  const store=new AgentRunStateStore(root),rootRunId='root-publish-fixture',owner={workspaceRoot:root,conversationId:'publish',rootRunId,depth:0},ledger=runtime.createAgentDelegationLedger(rootRunId);
  await run({store,root,owner,ledger,rootRunId});
 } finally {Object.defineProperty(process,'platform',original);}
}

test('a successful move with a lost response is acknowledged only after matching directory identity and unique owner token',async t=>{
 await withWindowsBranch(t,async(from,to)=>{await fs.rename(from,to);throw Object.assign(new Error('lost response'),{code:'EIO',publicationUncertain:true});},async f=>{
  const saved=await f.store.saveDelegationLedger(f.ledger,f.owner);assert.equal(saved.rootRunId,f.rootRunId);assert.equal((await fs.readdir(join(f.root,'run-state'))).some(name=>name.endsWith('.lock')),false);
 });
});

test('unknown publication before a move preserves the sealed candidate and never writes a ledger',async t=>{
 await withWindowsBranch(t,async()=>{throw Object.assign(new Error('lost response'),{code:'EIO',publicationUncertain:true});},async f=>{
  await assert.rejects(f.store.saveDelegationLedger(f.ledger,f.owner),error=>error.code==='DELEGATION_LEDGER_UNAVAILABLE');
  const names=await fs.readdir(join(f.root,'run-state'));assert.equal(names.length,1);assert.match(names[0],/\.lock\.candidate-/);assert.equal((await fs.readdir(join(f.root,'run-state',names[0]))).length,1);await assert.rejects(f.store.loadDelegationLedger(f.rootRunId),error=>error.code==='DELEGATION_LEDGER_NOT_FOUND');
 });
});

test('a possibly running publisher cannot cause a live lock to be released or an unconfirmed ledger ACK',async t=>{
 await withWindowsBranch(t,async(from,to)=>{await fs.rename(from,to);throw Object.assign(new Error('termination unknown'),{code:'ETIMEDOUT',publicationUncertain:true,helperMayStillRun:true});},async f=>{
  await assert.rejects(f.store.saveDelegationLedger(f.ledger,f.owner),error=>error.code==='DELEGATION_LEDGER_UNAVAILABLE');
  const names=await fs.readdir(join(f.root,'run-state'));assert.equal(names.length,1);assert.match(names[0],/\.lock$/);assert.equal((await fs.readdir(join(f.root,'run-state',names[0]))).length,1);await assert.rejects(f.store.loadDelegationLedger(f.rootRunId),error=>error.code==='DELEGATION_LEDGER_NOT_FOUND');
 });
});
