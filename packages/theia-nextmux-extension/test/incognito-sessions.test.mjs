import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, symlink, lstat, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const code = ts.transpile(await readFile(new URL('../src/node/nextmux-incognito-sessions.ts', import.meta.url), 'utf8'), {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022});
const exports = {};
new Function('require','exports',code)(require,exports);
const {IncognitoSessions} = exports;
async function fixture(t) { const root=await mkdtemp(join(tmpdir(),'nmx-incognito-test-')); t.after(()=>rm(root,{recursive:true,force:true})); return root; }

test('temporary workspace and content state delete together, external symlink targets and normal history survive', async t=>{
 const root=await fixture(t), store=new IncognitoSessions(root), {id,workspaceRoot}=await store.create();
 const normal=join(root,'conversation-history-v1');await mkdir(normal);await writeFile(join(normal,'user.txt'),'ordinary');
 const external=join(root,'user-saved.txt');await writeFile(external,'explicit export');
 await writeFile(join(workspaceRoot,'generated.png'),'temporary');await symlink(external,join(workspaceRoot,'reference.txt'));
 await mkdir(store.dataRoot(id));await writeFile(join(store.dataRoot(id),'run.json'),'private response');
 store.put({id,incognito:true,workspacePath:'',title:'temporary title',turns:[{prompt:'private'}]});
 assert.equal(store.values().length,1);assert.equal(store.sessionForPath(workspaceRoot),id);
 await store.remove(id);assert.equal(store.has(id),false);assert.deepEqual(store.values(),[]);
 await assert.rejects(lstat(dirname(workspaceRoot)),{code:'ENOENT'});
 assert.equal(await readFile(external,'utf8'),'explicit export');assert.equal(await readFile(join(normal,'user.txt'),'utf8'),'ordinary');
 await assert.rejects(store.create(id),/INCOGNITO_SESSION_INVALID/);
});

test('a live owner and unmarked or forged directories cannot be deleted by a second startup',async t=>{
 const root=await fixture(t),first=new IncognitoSessions(root), created=await first.create();
 await writeFile(join(created.workspaceRoot,'keep'),'live');
 const forged=join(first.root,`owner-999999-${randomUUID()}`);await mkdir(forged);await writeFile(join(forged,'keep'),'unowned');
 await writeFile(join(forged,'.nextmux-incognito-owner.json'),JSON.stringify({version:1,kind:'wrong',pid:999999,nonce:'wrong'}));
 const second=new IncognitoSessions(root,process.pid,pid=>pid===process.pid);await second.ready;
 assert.equal(await readFile(join(created.workspaceRoot,'keep'),'utf8'),'live');assert.equal(await readFile(join(forged,'keep'),'utf8'),'unowned');
});

test('actual SIGKILL orphan is removed on next startup without following external links',async t=>{
 const root=await fixture(t), modulePath=join(root,'manager.cjs');await writeFile(modulePath,code);
 const external=join(root,'outside.txt');await writeFile(external,'user');
 const child=spawn(process.execPath,['-e',`const {IncognitoSessions}=require(process.argv[1]); const fs=require('node:fs/promises'); const path=require('node:path'); (async()=>{const s=new IncognitoSessions(process.argv[2]);const c=await s.create();await fs.writeFile(path.join(c.workspaceRoot,'generated.txt'),'private');await fs.symlink(process.argv[3],path.join(c.workspaceRoot,'external'));process.stdout.write(JSON.stringify(c)+'\\n');setInterval(()=>{},1000)})().catch(()=>process.exit(1));`,modulePath,root,external],{stdio:['ignore','pipe','inherit'],env:{...process.env,NODE_PATH:join(dirname(require.resolve('proper-lockfile/package.json')),'..')}});
 t.after(()=>{if(child.exitCode===null&&!child.killed)child.kill('SIGKILL');});
 const result=await new Promise((resolve,reject)=>{let data='';child.stdout.on('data',chunk=>{data+=chunk;if(data.includes('\n'))resolve(JSON.parse(data.trim()));});child.once('error',reject);});
 child.kill('SIGKILL');await once(child,'exit');
 const restarted=new IncognitoSessions(root);await restarted.ready;
 await assert.rejects(lstat(dirname(result.workspaceRoot)),{code:'ENOENT'});assert.equal(await readFile(external,'utf8'),'user');
});

test('session flags cannot create persistence authority and a fork target can be reserved without a conflicting directory',async t=>{
 const root=await fixture(t),s=new IncognitoSessions(root);await s.ready;
 assert.throws(()=>s.put({id:randomUUID(),incognito:true,workspacePath:''}),/INVALID/);
 const id=randomUUID(),c=await s.create(id,false);assert.equal(s.has(id),true);await assert.rejects(lstat(c.workspaceRoot),{code:'ENOENT'});
 assert.throws(()=>s.put({id,incognito:true,workspacePath:root}),/INVALID/);
 await mkdir(c.workspaceRoot);s.put({id,incognito:true,workspacePath:'',privateWorkspacePath:root,workspaceBindings:[{path:root}]});
 assert.equal(s.read(id).privateWorkspacePath,undefined);assert.equal(s.read(id).workspaceBindings,undefined);
});


test('ordinary ownership lookups do not initialize or write a temporary profile tree',async t=>{
 const root=await fixture(t),s=new IncognitoSessions(root);
 assert.equal(s.has(randomUUID()),false);assert.equal(s.sessionForPath(root),undefined);assert.equal(s.isRetired(randomUUID()),false);
 await new Promise(resolve=>setTimeout(resolve,25));assert.deepEqual(await readdir(root),[]);
 await s.ready;assert.ok((await readdir(root)).includes('incognito-sessions-v1'));
 s.setClosingAll(true);await assert.rejects(s.create(),/INCOGNITO_SESSION_INVALID/);s.setClosingAll(false);assert.ok((await s.create()).id);
});


test('closing all fences and joins an in-flight directory allocation before releasing the closing fence',async t=>{
 const root=await fixture(t),s=new IncognitoSessions(root);await s.ready;
 const pending=s.create();const failed=assert.rejects(pending,/INCOGNITO_SESSION_INVALID/);
 await Promise.resolve();s.setClosingAll(true);await s.settleCreations();await failed;
 assert.deepEqual(s.ids(),[]);assert.deepEqual((await readdir(s.ownerRoot)).filter(n=>!n.startsWith('.')),[]);s.setClosingAll(false);
});

const privateRecord = id => ({id,incognito:true,incognitoOrigin:true,incognitoRevision:0,workspacePath:'',title:'retained conversation',turns:[{id:'t',prompt:'owned words'}],createdAt:1,updatedAt:2});
test('normal mode atomically retains identity, content and files through restart and cannot reopen',async t=>{
 const root=await fixture(t),first=new IncognitoSessions(root,900001,()=>false),c=await first.create();
 first.put(privateRecord(c.id));await writeFile(join(c.workspaceRoot,'generated.txt'),'retain file');
 const normal=await first.setMode(c.id,false,0);assert.equal(normal.incognito,false);assert.equal(normal.incognitoRevision,1);
 assert.equal(first.has(c.id),false);assert.equal(first.owns(c.id),true);assert.deepEqual(first.ids(),[]);
 const restarted=new IncognitoSessions(root,900002,()=>false);await restarted.ready;
 assert.equal(restarted.workspace(c.id),c.workspaceRoot);assert.equal(restarted.read(c.id).turns[0].prompt,'owned words');
 assert.equal(await readFile(join(c.workspaceRoot,'generated.txt'),'utf8'),'retain file');
 await assert.rejects(restarted.setMode(c.id,true,1),/INCOGNITO_REENABLE_UNAVAILABLE/);
 const third=new IncognitoSessions(root,900003,()=>false);await third.ready;
 assert.equal(third.read(c.id).incognito,false);assert.equal(await readFile(join(c.workspaceRoot,'generated.txt'),'utf8'),'retain file');
});

test('stale mode/revision cannot overwrite body; same-revision concurrent mode changes yield one winner',async t=>{
 const root=await fixture(t),s=new IncognitoSessions(root),c=await s.create();s.put(privateRecord(c.id));
 const outcomes=await Promise.allSettled([s.setMode(c.id,false,0),s.setMode(c.id,false,0)]);
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.match(outcomes.find(r=>r.status==='rejected').reason.message,/MODE_CHANGED/);
 await assert.rejects(s.save(privateRecord(c.id)),/MODE_CHANGED/);
 await assert.rejects(s.save({...privateRecord(c.id),incognito:false,incognitoRevision:undefined}),/MODE_CHANGED/);
 const current=s.read(c.id);await s.save({...current,title:'updated',updatedAt:current.updatedAt+1},current.updatedAt);
 assert.equal(s.read(c.id).title,'updated');
 s.setClosingAll(true);await assert.rejects(s.setMode(c.id,true,1),/SESSION_INVALID/);s.setClosingAll(false);
});

test('normal read/write is serialized across independent manager instances without obsolete-file reads',async t=>{
 const root=await fixture(t),a=new IncognitoSessions(root),c=await a.create();a.put(privateRecord(c.id));await a.setMode(c.id,false,0);
 const b=new IncognitoSessions(root);await b.ready;
 for(let i=0;i<8;i++){
  const record=a.read(c.id);await Promise.all([a.save({...record,title:`revision ${i}`,updatedAt:record.updatedAt+1}),b.refresh()]);
 }
 await b.refresh();assert.equal(b.read(c.id).title,'revision 7');assert.equal(b.workspace(c.id),c.workspaceRoot);
 await assert.rejects(a.setMode(c.id,true,1),/REENABLE_UNAVAILABLE/);await b.refresh();assert.equal(b.read(c.id).title,'revision 7');
 await assert.rejects(b.save({...privateRecord(c.id),incognito:false,incognitoRevision:0}),/MODE_CHANGED/);
});

test('corrupt session ownership is retained fail-closed and cannot authorize cleanup',async t=>{
 const root=await fixture(t),a=new IncognitoSessions(root,900004,()=>false),c=await a.create();
 await writeFile(join(c.workspaceRoot,'retain.txt'),'not deleted');await writeFile(join(dirname(c.workspaceRoot),'.nextmux-incognito-session.json'),'{bad');
 const b=new IncognitoSessions(root,900005,()=>false);await b.ready;
 assert.equal(await readFile(join(c.workspaceRoot,'retain.txt'),'utf8'),'not deleted');assert.equal(b.owns(c.id),false);
});

test('real normal-owner SIGKILL retains content; a newly created private SIGKILL deletes only that owned container',async t=>{
 const root=await fixture(t),modulePath=join(root,'manager.cjs');await writeFile(modulePath,code);
 const external=join(root,'external-user.txt');await writeFile(external,'keep user export');
 const common=`const {IncognitoSessions}=require(process.argv[1]);const fs=require('node:fs/promises');const path=require('node:path');`;
 async function childStep(body){
  const child=spawn(process.execPath,['-e',common+`(async()=>{${body};setInterval(()=>{},1000)})().catch(e=>{process.stderr.write(String(e));process.exit(1)});`,modulePath,root,external],{stdio:['ignore','pipe','inherit'],env:{...process.env,NODE_PATH:join(dirname(require.resolve('proper-lockfile/package.json')),'..')}});
  t.after(()=>{if(child.exitCode===null&&!child.killed)child.kill('SIGKILL')});
  const result=await new Promise((resolve,reject)=>{let value='';child.stdout.on('data',data=>{value+=data;if(value.includes('\n'))resolve(JSON.parse(value.trim()))});child.once('error',reject);child.once('exit',code=>{if(!value)reject(Error(`child exited ${code}`))})});
  child.kill('SIGKILL');await once(child,'exit');return result;
 }
 const created=await childStep(`const s=new IncognitoSessions(process.argv[2]);const c=await s.create();s.put({id:c.id,incognito:true,workspacePath:'',title:'real retained',turns:[],createdAt:1,updatedAt:2});await fs.writeFile(path.join(c.workspaceRoot,'generated.txt'),'retained');await fs.symlink(process.argv[3],path.join(c.workspaceRoot,'external'));await s.setMode(c.id,false,0);process.stdout.write(JSON.stringify(c)+'\\n')`);
 const restored=await childStep(`const s=new IncognitoSessions(process.argv[2]);await s.ready;const row=s.values()[0];if(row.title!=='real retained')throw Error('missing retained conversation');const c=await s.create();s.put({id:c.id,incognito:true,workspacePath:'',title:'new private',turns:[]});process.stdout.write(JSON.stringify(c)+'\\n')`);
 assert.notEqual(restored.id,created.id);const final=new IncognitoSessions(root);await final.ready;
 await assert.rejects(lstat(dirname(restored.workspaceRoot)),{code:'ENOENT'});assert.equal(await readFile(join(created.workspaceRoot,'generated.txt'),'utf8'),'retained');assert.equal(await readFile(external,'utf8'),'keep user export');
});
