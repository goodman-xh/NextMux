import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,readFile,writeFile,mkdir,readdir,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {service} from './helpers/editor-recovery-source-loader.mjs';
const require=createRequire(import.meta.url),{IncognitoSessions}=require('../lib/node/nextmux-incognito-sessions.js');
class Host extends service.NextMuxPlatformServiceImpl {constructor(root){super();this.root=root;}nextmuxDataRoot(){return this.root;}}
const record=id=>({id,incognito:true,incognitoOrigin:true,incognitoRevision:0,workspacePath:'',title:'CLEAR_ONLY_THIS_HISTORY',turns:[{id:'turn',prompt:'CLEAR_ONLY_THIS_MESSAGE'}],createdAt:1,updatedAt:2});

test('clearing retained history preserves generated files, does not revive deleted messages, and leaves live private sessions alone',async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'nmx-origin-clear-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const host=new Host(root),saved=await host.createIncognitoConversation(),active=await host.createIncognitoConversation();
 await host.patchConversationHistory({upserts:[record(saved.id),record(active.id)],removedSessionIds:[]});
 await writeFile(join(saved.workspaceRoot,'generated.txt'),'GENERATED_FILE_KEEP');
 const state=host.localConversationDataRoot(saved.id);await mkdir(state,{recursive:true});await writeFile(join(state,'user-version.txt'),'USER_VERSION_KEEP');
 await host.setConversationIncognito({id:saved.id,incognito:false,expectedRevision:0});
 const previous=await host.readConversationHistorySession(saved.id);
 await host.clearConversationHistory();
 assert.equal(await readFile(join(saved.workspaceRoot,'generated.txt'),'utf8'),'GENERATED_FILE_KEEP');
 assert.equal(await readFile(join(state,'user-version.txt'),'utf8'),'USER_VERSION_KEEP');
 assert.equal(await host.readConversationHistorySession(saved.id),undefined);
 assert.equal((await host.readConversationHistorySession(active.id)).incognito,true);
 const remaining=(await host.loadConversationHistory()).sessions;assert.ok(!remaining.some(s=>s.id===saved.id));assert.ok(remaining.some(s=>s.id===active.id));
 await host.patchConversationHistory({upserts:[previous],removedSessionIds:[]});
 assert.equal(await host.readConversationHistorySession(saved.id),undefined,'a stale renderer cannot restore cleared history');
 const fresh=new IncognitoSessions(root);await fresh.ready;
 assert.equal(fresh.read(saved.id),undefined);assert.equal(fresh.isRetired(saved.id),true);
 assert.equal(await readFile(join(saved.workspaceRoot,'generated.txt'),'utf8'),'GENERATED_FILE_KEEP');
 const container=dirname(saved.workspaceRoot);
 for(const file of await readdir(container))if(/^session-.*\.json$/.test(file))assert.doesNotMatch(await readFile(join(container,file),'utf8'),/CLEAR_ONLY_THIS_/);
 await host.closeIncognitoConversations([],true);
 assert.equal(await readFile(join(saved.workspaceRoot,'generated.txt'),'utf8'),'GENERATED_FILE_KEEP');
});
