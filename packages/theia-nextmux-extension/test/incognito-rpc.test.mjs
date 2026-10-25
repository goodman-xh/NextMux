import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,realpath,readFile,writeFile,mkdir,readdir,lstat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {service} from './helpers/editor-recovery-source-loader.mjs';
class Host extends service.NextMuxPlatformServiceImpl {constructor(root){super();this.root=root;}nextmuxDataRoot(){return this.root;}}
async function fixture(t){const root=await realpath(await mkdtemp(join(tmpdir(),'nmx-incognito-rpc-')));const a=new Host(root),b=new Host(root);t.after(()=>rm(root,{recursive:true,force:true}));return{root,a,b};}
const record=(id,incognito=false)=>({id,incognito,ownedWorkspace:incognito,workspacePath:'',title:incognito?'PRIVATE_TITLE':'normal',turns:[{id:'turn',prompt:incognito?'PRIVATE_PROMPT':'ordinary',response:incognito?'PRIVATE_RESPONSE':'ordinary',createdAt:1,stage:'complete',events:[]}],createdAt:1,updatedAt:2});
async function disk(root){let result='';for(const entry of await readdir(root,{withFileTypes:true})){const path=join(root,entry.name);if(entry.isDirectory())result+=await disk(path);else if(entry.isFile())result+=await readFile(path,'utf8');}return result;}

test('history cannot be disabled; private history is live across connections but absent from durable history and search/index',async t=>{
 const{root,a,b}=await fixture(t);assert.equal((await a.savePrivacySettings({requireZeroDataRetention:false,denyDataCollection:false,saveConversationHistory:false})).saveConversationHistory,true);
 const normal=record(randomUUID()),p=await a.createIncognitoConversation();
 await a.patchConversationHistory({upserts:[normal,record(p.id,true)],removedSessionIds:[]});
 assert.equal((await b.readConversationHistorySession(p.id)).title,'PRIVATE_TITLE');
 assert.ok((await b.listConversationHistory()).sessions.some(s=>s.id===p.id));
 assert.ok((await b.loadConversationHistory()).sessions.some(s=>s.id===p.id));
 assert.equal((await b.conversationStore().readSession(p.id)),undefined);
 await b.syncConversationIndex([{id:p.id,workspacePath:'',title:'PRIVATE_TITLE',messages:[{id:'m',prompt:'PRIVATE_PROMPT',response:'PRIVATE_RESPONSE',createdAt:1}],createdAt:1,updatedAt:2}]);
 assert.deepEqual(await b.readConversationIndex(),[]);
 assert.doesNotMatch(await disk(join(root,'conversation-history-v1')),/PRIVATE_/);
 await assert.rejects(a.conversationStore().patch([record(randomUUID(),true)],[]),/store_session_invalid|invalid/i);
 await assert.rejects(a.exportConversationArchive(pathToFileURL(join(root,'test.nmxarchive')).href,[p.id]),{code:'INCOGNITO_ARCHIVE_UNAVAILABLE'});
});

test('editor drafts, file versions, journals, queued requests, managed content and checkpoints use private state; explicit external saves survive close',async t=>{
 const{root,a,b}=await fixture(t),p=await a.createIncognitoConversation();
 await a.patchConversationHistory({upserts:[record(p.id,true)],removedSessionIds:[]});
 const source=join(p.workspaceRoot,'note.txt');await writeFile(source,'baseline');
 const uri=pathToFileURL(source).href;
 await a.recordFileHistory({sourceUri:uri,content:'PRIVATE_VERSION',kind:'saved'});
 const recovery=await a.openEditorDraftRecovery({sessionId:p.id});assert.equal(recovery.kind,'allocated');
 await a.saveEditorDraftRecovery({id:recovery.id,expectedRevision:0,mutationId:randomUUID(),snapshot:{sessionId:p.id,sourceUri:uri,name:'note.txt',baseline:{current:'baseline'},drafts:{current:'PRIVATE_DRAFT'}}});
 assert.equal((await b.openEditorDraftRecovery({id:recovery.id})).record.snapshot.drafts.current,'PRIVATE_DRAFT');
 assert.equal((await b.listEditorDraftRecoveries()).entries.length,0);
 assert.equal((await b.listFileHistory(uri)).length,1);
 for(const path of [a.localConversationDataRoot(p.id),a.agentCheckpointRoot(p.workspaceRoot),a.managedContentRoot(p.id)])assert.ok(path.startsWith(dirname(p.workspaceRoot)));
 const exported=join(root,'saved-by-user.txt');await a.saveEditorDraftAsNewFile({destinationUri:pathToFileURL(exported).href,content:'exported',sourceUri:uri});
 await a.closeIncognitoConversations([p.id]);await assert.rejects(lstat(dirname(p.workspaceRoot)),{code:'ENOENT'});
 assert.equal(await readFile(exported,'utf8'),'exported');assert.equal(await b.readConversationHistorySession(p.id),undefined);
 await assert.rejects(b.recordFileHistory({sourceUri:uri,content:'PRIVATE_LATE_VERSION',kind:'saved'}),{code:'FILE_HISTORY_UNAVAILABLE'});
 assert.throws(()=>b.managedContentRoot(p.id),{code:'CONVERSATION_DELETED'});
 assert.doesNotMatch(await disk(root),/PRIVATE_(DRAFT|VERSION|LATE_VERSION|TITLE|PROMPT|RESPONSE)/);
});

test('private workspace cannot be replaced by a project and fork remains temporary',async t=>{
 const{root,a}=await fixture(t),p=await a.createIncognitoConversation();
 await a.patchConversationHistory({upserts:[record(p.id,true)],removedSessionIds:[]});await writeFile(join(p.workspaceRoot,'created.txt'),'private file');
 await assert.rejects(a.resolveConversationForkRequest({conversationId:p.id,workspaceRoot:root}),{code:'INCOGNITO_PRIVATE_WORKSPACE_REQUIRED'});
 const target=randomUUID();const fork=await a.forkConversationWorkspace(p.id,target);assert.ok(a.incognitoSessions().has(target));
 assert.equal(await readFile(join(fork.workspaceRoot,'created.txt'),'utf8'),'private file');
 await assert.rejects(a.upsertDesktopScheduledTask({workspacePath:p.workspaceRoot}),{code:'INCOGNITO_SCHEDULE_UNAVAILABLE'});
 await a.closeIncognitoConversations([p.id,target]);await assert.rejects(lstat(fork.workspaceRoot),{code:'ENOENT'});
});

test('cleanup cancels and joins only the selected incognito jobs across backend connections before deleting files',async t=>{
 const{a,b}=await fixture(t),p=await a.createIncognitoConversation(),normal=randomUUID();
 const events=[];let finished;const completion=new Promise(resolve=>finished=resolve);
 const release = b.holdProjectRun(p.workspaceRoot);t.after(release);a.agentWorkspaceActivity();
 b.agentJobs.set('private-run',{runId:'private-run',status:'running',recoveryRecord:{owner:{conversationId:p.id}},completion});
 b.agentJobs.set('normal-run',{runId:'normal-run',status:'running',recoveryRecord:{owner:{conversationId:normal}}});
 b.cancelAgentRun=async id=>{events.push(id);assert.equal(id,'private-run');await lstat(p.workspaceRoot);finished();return{cancelled:true};};
 await a.closeIncognitoConversations([p.id]);assert.deepEqual(events,['private-run']);await assert.rejects(lstat(p.workspaceRoot),{code:'ENOENT'});
});

test('managed image and speech job streams carry the private workspace content owner into the shared receiver', async t=>{
 const {a,root}=await fixture(t),p=await a.createIncognitoConversation();const seen=[];
 a.deviceId=async()=> 'isolated-device';a.withLegacyCapacity=async(_key,_body,submit)=>submit();
 a.networkFetch=async()=>new Response('',{headers:{'content-type':'application/x-ndjson'}});
 a.consumeManagedGatewayStream=async(_response,callbacks)=>{seen.push(callbacks.contentOwnerId);throw new Error('QA_BOUNDARY_REACHED');};
 for(const kind of ['image','speech'])await assert.rejects(a.requestManagedMedia({kind,id:randomUUID(),idempotencyKey:randomUUID()},{connectionId:'managed:fixed:'+randomUUID(),keyPriceQuoteId:'kq1_'+'a'.repeat(64),model:'qa-model',prompt:'private',text:'private',format:'mp3'},new AbortController().signal,p.workspaceRoot),{code:'BILLING_TRANSPORT_UNKNOWN'});
 assert.deepEqual(seen,[p.id,p.id]);await assert.rejects(lstat(join(root,'managed-content')),{code:'ENOENT'});
 await a.closeIncognitoConversations([p.id]);
});

test('one-way conversion retains normal history/search/archive and rejects reopening without removing files',async t=>{
 const {root,a,b}=await fixture(t),p=await a.createIncognitoConversation();
 await a.patchConversationHistory({upserts:[{...record(p.id,true),incognitoOrigin:true,incognitoRevision:0}],removedSessionIds:[]});
 const file=join(p.workspaceRoot,'generated.txt');await writeFile(file,'generated file');
 const beforeState=a.localConversationDataRoot(p.id);
 const normal=await a.setConversationIncognito({id:p.id,incognito:false,expectedRevision:0});
 assert.equal(normal.revision,1);assert.equal(normal.session.incognitoOrigin,true);assert.equal(normal.workspaceRoot,p.workspaceRoot);
 assert.equal(a.localConversationDataRoot(p.id),beforeState);assert.equal((await b.searchConversationHistory({query:'PRIVATE_PROMPT'})).matches[0].conversationId,p.id);
 assert.equal((await b.listIncognitoConversations()).length,0);assert.equal((await b.loadConversationHistory()).sessions[0].incognito,false);
 const destination=pathToFileURL(join(root,'kept.nmxarchive')).href;await a.exportConversationArchive(destination,[p.id]);
 assert.equal(await readFile(file,'utf8'),'generated file');assert.equal(await a.conversationStore().readSession(p.id),undefined);
 await assert.rejects(a.setConversationIncognito({id:p.id,incognito:true,expectedRevision:1}),{code:'INCOGNITO_REENABLE_UNAVAILABLE'});
 assert.equal((await b.searchConversationHistory({query:'PRIVATE_PROMPT'})).matches.length,1);
 await assert.rejects(a.setConversationIncognito({id:p.id,incognito:false,expectedRevision:0}),{code:'INCOGNITO_MODE_CHANGED'});
 await a.closeIncognitoConversations([],true);assert.equal(await readFile(file,'utf8'),'generated file');
 assert.ok((await lstat(join(root,'kept.nmxarchive'))).isFile());
});

test('ordinary origin flags are stripped and busy transitions never cancel another task',async t=>{
 const {a,b}=await fixture(t),normal=record(randomUUID());
 await a.patchConversationHistory({upserts:[{...normal,incognitoOrigin:true,incognitoRevision:8}],removedSessionIds:[]});
 assert.equal((await a.readConversationHistorySession(normal.id)).incognitoOrigin,undefined);
 await assert.rejects(a.setConversationIncognito({id:normal.id,incognito:true,expectedRevision:0}),{code:'INCOGNITO_REENABLE_UNAVAILABLE'});
 const p=await a.createIncognitoConversation();await a.patchConversationHistory({upserts:[record(p.id,true)],removedSessionIds:[]});
 const release=b.holdProjectRun(p.workspaceRoot);let cancelled=false;b.cancelAgentRun=async()=>{cancelled=true};
 await assert.rejects(a.setConversationIncognito({id:p.id,incognito:false,expectedRevision:0}),{code:'INCOGNITO_MODE_BUSY'});
 assert.equal(cancelled,false);assert.equal((await a.readConversationHistorySession(p.id)).incognito,true);release();
 const retained=await a.setConversationIncognito({id:p.id,incognito:false,expectedRevision:0});
 await a.closeIncognitoConversations([],true);assert.ok(await lstat(retained.workspaceRoot));
 await a.closeIncognitoConversations([p.id]);await assert.rejects(lstat(retained.workspaceRoot),{code:'ENOENT'});
});

test('combined history pages retain stable recency without duplicate or missing normal-origin sessions',async t=>{
 const {a}=await fixture(t);const ids=[];
 for(let i=0;i<4;i++){const p=await a.createIncognitoConversation();ids.push(p.id);await a.patchConversationHistory({upserts:[record(p.id,true)],removedSessionIds:[]});await a.setConversationIncognito({id:p.id,incognito:false,expectedRevision:0});}
 for(let i=0;i<4;i++){const value={...record(randomUUID()),updatedAt:Date.now()+i};ids.push(value.id);await a.patchConversationHistory({upserts:[value],removedSessionIds:[]});}
 const found=[];let cursor;
 do{const page=await a.listConversationHistory({limit:2,cursor});assert.ok(page.sessions.length<=2);found.push(...page.sessions.map(s=>s.id));cursor=page.nextCursor;}while(cursor);
 assert.deepEqual([...found].sort(),ids.sort());assert.equal(new Set(found).size,8);
});

test('empty reuse only authorizes an existing empty owned workspace, never text, queued work or files',async t=>{
 const {a}=await fixture(t),p=await a.createIncognitoConversation();
 const empty={...record(p.id,true),turns:[]};await a.patchConversationHistory({upserts:[empty],removedSessionIds:[]});
 assert.equal(await a.canReuseEmptyConversation(p.id),true);
 await writeFile(join(p.workspaceRoot,'.user-file'),'retain');assert.equal(await a.canReuseEmptyConversation(p.id),false);await rm(join(p.workspaceRoot,'.user-file'));
 await a.patchConversationHistory({upserts:[{...empty,draftPrompt:'do not overwrite'}],removedSessionIds:[]});assert.equal(await a.canReuseEmptyConversation(p.id),false);
 await a.patchConversationHistory({upserts:[{...empty,followUpQueue:[{id:'work'}]}],removedSessionIds:[]});assert.equal(await a.canReuseEmptyConversation(p.id),false);
 assert.equal(await a.canReuseEmptyConversation(randomUUID()),false);
});

test('retained origin archive reads controlled attachments and generated media from its owned state; import cannot grant mode authority',async t=>{
 const {root,a}=await fixture(t),p=await a.createIncognitoConversation();
 const attachment=await a.cacheDesktopAttachment({conversationId:p.id,name:'kept.txt',mimeType:'text/plain',dataBase64:Buffer.from('source attachment').toString('base64')});
 const {persistAgentOutputParts}=await import('../lib/node/nextmux-agent-output-assets.js');
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
 const parts=await persistAgentOutputParts(a.localConversationDataRoot(p.id),p.id,[{type:'image',mimeType:'image/png',sizeBytes:Buffer.from(png,'base64').length,dataBase64:png}]);
 const value=record(p.id,true);value.turns[0]={...value.turns[0],attachments:[{...attachment,id:randomUUID(),kind:'file',name:'kept.txt',mimeType:'text/plain'}],outputParts:parts,outputAssetOwnerId:p.id};
 await a.patchConversationHistory({upserts:[value],removedSessionIds:[]});await a.setConversationIncognito({id:p.id,incognito:false,expectedRevision:0});
 const path=join(root,'with-assets.nmxarchive');await a.exportConversationArchive(pathToFileURL(path).href,[p.id]);
 const archive=JSON.parse(await readFile(path,'utf8'));assert.equal(archive.files.length,2);assert.equal(archive.conversations[0].incognitoOrigin,undefined);assert.equal(archive.conversations[0].incognitoRevision,undefined);
 assert.ok(archive.files.some(file=>Buffer.from(file.dataBase64,'base64').toString()==='source attachment'));
 await assert.rejects(a.setConversationIncognito({id:p.id,incognito:true,expectedRevision:1}),{code:'INCOGNITO_REENABLE_UNAVAILABLE'});await a.closeIncognitoConversations([p.id]);
 assert.ok(await lstat(path));
});

test('retained drafts remain discoverable after losing process maps and reopening is rejected',async t=>{
 const {a}=await fixture(t),p=await a.createIncognitoConversation();await a.patchConversationHistory({upserts:[record(p.id,true)],removedSessionIds:[]});
 const source=join(p.workspaceRoot,'draft.txt');await writeFile(source,'base');const recovery=await a.openEditorDraftRecovery({sessionId:p.id});
 await a.saveEditorDraftRecovery({id:recovery.id,expectedRevision:0,mutationId:randomUUID(),snapshot:{sessionId:p.id,sourceUri:pathToFileURL(source).href,name:'draft.txt',baseline:{current:'base'},drafts:{current:'retained draft'}}});
 await a.setConversationIncognito({id:p.id,incognito:false,expectedRevision:0});a.incognitoSessions().recoveryOwners.clear();
 assert.ok((await a.listEditorDraftRecoveries()).entries.some(entry=>entry.id===recovery.id));
 assert.equal((await a.openEditorDraftRecovery({id:recovery.id})).record.snapshot.drafts.current,'retained draft');
 await assert.rejects(a.setConversationIncognito({id:p.id,incognito:true,expectedRevision:1}),{code:'INCOGNITO_REENABLE_UNAVAILABLE'});assert.equal((await a.listEditorDraftRecoveries()).entries.length,1);
});

test('ordinary drafts cannot promote, including old draftOnly requests; text and attachment bytes remain unchanged',async t=>{
 const {a}=await fixture(t),id=randomUUID();
 const attachment=await a.cacheDesktopAttachment({conversationId:id,name:'keep.txt',mimeType:'text/plain',dataBase64:Buffer.from('keep attachment').toString('base64')});
 const draft={...record(id),turns:[],draftPrompt:'keep text',draftAttachments:[{...attachment,id:'a',name:'keep.txt',kind:'file',mimeType:'text/plain'}]};
 await a.patchConversationHistory({upserts:[draft],removedSessionIds:[]});
 for(const draftOnly of [undefined,true])await assert.rejects(a.setConversationIncognito({id,incognito:true,expectedRevision:0,draftOnly,expectedUpdatedAt:2}),{code:'INCOGNITO_REENABLE_UNAVAILABLE'});
 assert.deepEqual(await a.readConversationHistorySession(id),draft);assert.equal(await a.conversationStore().isDeletedSession(id),false);
 assert.equal((await a.readDesktopAttachment({...draft.draftAttachments[0],conversationId:id})).dataBase64,Buffer.from('keep attachment').toString('base64'));
 assert.deepEqual(await a.listIncognitoConversations(),[]);
});

test('retained original run journal is rediscovered from its owned state after process run-owner map is lost',async t=>{
 const {a}=await fixture(t),p=await a.createIncognitoConversation();await a.patchConversationHistory({upserts:[record(p.id,true)],removedSessionIds:[]});
 await a.setConversationIncognito({id:p.id,incognito:false,expectedRevision:0});
 const runId=randomUUID(),now=Date.now();await a.agentRunJournalStore(p.id).save({schemaVersion:1,runId,state:'interrupted',owner:{workspaceRoot:p.workspaceRoot,conversationId:p.id,rootRunId:runId,depth:0},workbench:'coding',permissionMode:'read_only',createdAt:now,updatedAt:now});
 a.incognitoSessions().runOwners.clear();const restored=await a.recoveredAgentJobSnapshot(runId);
 assert.equal(restored.runId,runId);assert.equal(a.incognitoSessions().runSession(runId),p.id);
});

test('a held model-start preparation blocks only its conversation mode transition and releases after start failure',async t=>{
 const {a}=await fixture(t),p=await a.createIncognitoConversation();await a.patchConversationHistory({upserts:[record(p.id,true)],removedSessionIds:[]});
 let entered,release;const arrived=new Promise(resolve=>entered=resolve),wait=new Promise(resolve=>release=resolve);
 a.resolveConversationForkRequest=async request=>{entered();await wait;return request;};a.startAgentRunForProject=async()=>{throw Error('QA_START_FAILURE')};
 const starting=a.startAgentRun({conversationId:p.id,workspaceRoot:p.workspaceRoot});await arrived;
 await assert.rejects(a.setConversationIncognito({id:p.id,incognito:false,expectedRevision:0}),{code:'INCOGNITO_MODE_BUSY'});
 const other=await a.createIncognitoConversation();await a.patchConversationHistory({upserts:[record(other.id,true)],removedSessionIds:[]});assert.equal((await a.setConversationIncognito({id:other.id,incognito:false,expectedRevision:0})).session.incognito,false);
 const rejected=assert.rejects(starting,/QA_START_FAILURE/);release();await rejected;
 assert.equal((await a.setConversationIncognito({id:p.id,incognito:false,expectedRevision:0})).session.incognito,false);
});

test('project binding fences same-chat model admission, allows other chats, and releases on failure',async t=>{
 const {a}=await fixture(t),id=randomUUID(),other=randomUUID();
 await a.patchConversationHistory({upserts:[{...record(id),turns:[]},{...record(other),turns:[]}],removedSessionIds:[]});
 const policy=a.withConversationHistoryWritePolicy.bind(a);let entered,release;
 const arrived=new Promise(resolve=>entered=resolve),wait=new Promise(resolve=>release=resolve);
 a.withConversationHistoryWritePolicy=async(...args)=>{entered();await wait;return policy(...args)};
 const binding=a.bindConversationDraftWorkspace({id,workspacePath:'/definitely-unavailable-nextmux-fixture',expectedUpdatedAt:2});await arrived;
 a.resolveConversationForkRequest=async request=>request;a.startAgentRunForProject=async()=>({runId:'local-fixture'});
 await assert.rejects(a.startAgentRun({conversationId:id}),{code:'INCOGNITO_MODE_BUSY'});assert.equal((await a.startAgentRun({conversationId:other})).runId,'local-fixture');
 const rejected=assert.rejects(binding);release();await rejected;
 assert.equal((await a.startAgentRun({conversationId:id})).runId,'local-fixture');assert.equal((await a.readConversationHistorySession(id)).workspacePath,'');
});
