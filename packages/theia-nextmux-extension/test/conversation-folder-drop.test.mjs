import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,stat,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import ts from 'typescript';
const source=await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('widget.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const klass=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='NextMuxDesktopWidget');
const method=name=>klass.members.find(n=>n.name?.getText(ast)===name).getText(ast);
const transpile=s=>ts.transpile(s,{target:ts.ScriptTarget.ES2022});
const URI={fromFilePath:path=>({path:{fsPath:()=>path}})};
const platform=createRequire(new URL('../../../apps/cloudflare-platform/package.json',import.meta.url));
const puppeteer=(await import(platform.resolve('puppeteer'))).default;
const Harness=Function('URI','desktopDomainErrorText','composerAttachmentUiText',transpile(`class Harness {
 ${['useDraftWorkspaceFolder','bindCodingDraftWorkspace','draftWorkspaceCanChange','unstartedCodingDraft','addComposerFolders'].map(method).join('\n')}
};return Harness;`))(URI,(_l,e)=>e.message,(_l,key)=>key);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};

async function fixture(t,bound=''){
 const base=await mkdtemp(join(tmpdir(),'nmx-body-folder-'));t.after(()=>rm(base,{recursive:true,force:true}));
 const folder=join(base,'项目 with spaces');await mkdir(folder);const regular=join(base,'regular.txt');await writeFile(regular,'fixture only');
 const a={id:'A',workspacePath:bound,incognito:false,turns:[],historyLoaded:true,updatedAt:7,draftPrompt:'KEEP DRAFT',draftAttachments:[{id:'attached',uri:'file:///synthetic-attachment'}]},b={id:'B',workspacePath:'/other',turns:[],draftPrompt:'OTHER DRAFT'};
 const h=new Harness(),calls=[];
 Object.assign(h,{desktopLocale:'en',codingSessions:[a,b],activeCodingSessionId:'A',codingSessionNavigationGeneration:0,activeWorkspaceRoot:bound,globalCodingDraft:false,draftWorkspaceRoot:'',applicationExitPreparing:false,
  prompt:a.draftPrompt,attachments:a.draftAttachments,attachmentError:'',workspaceOptions:[],expandedCodingProjects:new Set(),
  pendingAttachmentImports:new Map(),draftAttachmentRestores:new Map(),pastedTextPersistence:new Map(),unpersistedPastedTextReferences:new Map(),conversationHistoryPersistedSessions:new Map(),conversationHistoryPersistDirty:false,
  node:{querySelector:()=>null},incognitoModeIsBusy:()=>false,conversationHistoryReady:()=>true,hasUnresolvedDraftAttachments:()=>false,detachContextEditorRecovery:()=>true,
  activeCodingSession(){return this.codingSessions.find(s=>s.id===this.activeCodingSessionId)},
  fileService:{resolve:async uri=>({isDirectory:(await stat(uri.path.fsPath())).isDirectory()})},
  setProjectVisible:path=>calls.push(['visible',path]),workspaceConfigurationSaver:{runWorkspaceMutation:async fn=>{calls.push(['mutation']);await fn();}},
  workspaceService:{addRoot:async roots=>{calls.push(['addRoot',roots.map(u=>u.path.fsPath())]);h.workspaceOptions.push(...roots.map(u=>({path:u.path.fsPath()})));}},refreshWorkspaceRoots:async()=>calls.push(['refresh']),
  flushComposerDraft(){const s=this.activeCodingSession();s.draftPrompt=this.prompt;s.draftAttachments=this.attachments;calls.push(['flushDraft']);},flushConversationHistory:async()=>calls.push(['flushHistory']),
  platformService:{bindConversationDraftWorkspace:async request=>{calls.push(['bind',request]);const s=h.codingSessions.find(s=>s.id===request.id);assert.equal(request.expectedUpdatedAt,s.updatedAt);return{session:{...s,workspacePath:request.workspacePath,ownedWorkspace:false,updatedAt:s.updatedAt+1},workspaceRoot:request.workspacePath};}},
  resetDraftWorkspaceView:async()=>calls.push(['reset']),restoreComposerDraft(s){this.prompt=s.draftPrompt;this.attachments=s.draftAttachments;},persistCodingSessions:()=>calls.push(['persist']),persistDesktopRestoreState:()=>calls.push(['restoreState']),
  update(){},addNotification:(...args)=>calls.push(['notice',...args])});
 return{h,a,b,base,folder,regular,calls};
}
const sideEffects=f=>f.calls.filter(c=>['visible','mutation','addRoot','bind','reset'].includes(c[0]));

test('a strict body project selection binds the same persisted draft with or without a selected project',async t=>{
 for(const bound of ['', '/existing-project']){
  const f=await fixture(t,bound),originalAttachments=f.h.attachments;
  assert.equal(await f.h.useDraftWorkspaceFolder(URI.fromFilePath(f.folder),true),true);
  assert.equal(f.h.activeCodingSessionId,'A');assert.equal(f.h.activeCodingSession().workspacePath,f.folder);assert.equal(f.h.prompt,'KEEP DRAFT');assert.equal(f.h.attachments,originalAttachments);
  assert.equal(f.h.codingSessions[1],f.b);assert.equal(f.b.draftPrompt,'OTHER DRAFT');assert.equal(f.calls.filter(c=>c[0]==='bind').length,1);
  assert.ok(f.calls.find(c=>c[0]==='reset'));assert.ok(f.calls.find(c=>c[0]==='flushHistory'));assert.equal(f.h.globalCodingDraft,false);
 }
});
test('resolve completion after switching, starting, closing or navigation has no project side effects and cannot attach into another owner',async t=>{
 for(const action of ['switch','start','close','navigation','resolve-error-switch']){
  const f=await fixture(t),gate=deferred();f.h.fileService.resolve=()=>gate.promise;
  const pending=f.h.useDraftWorkspaceFolder(URI.fromFilePath(f.folder),true);
  if(action==='switch'||action==='resolve-error-switch')f.h.activeCodingSessionId='B';
  if(action==='start')f.a.turns.push({id:'started'});
  if(action==='close')f.h.applicationExitPreparing=true;
  if(action==='navigation')f.h.codingSessionNavigationGeneration++;
  if(action==='resolve-error-switch')gate.reject(new Error('PRIVATE_ERROR'));else gate.resolve({isDirectory:true});
  assert.equal(await pending,false,action);assert.deepEqual(sideEffects(f),[],action);assert.equal(f.h.prompt,'KEEP DRAFT');assert.equal(f.h.attachments,f.a.draftAttachments);
  assert.equal(f.h.attachmentError,'',action);assert.equal(f.b.draftPrompt,'OTHER DRAFT');
 }
});
test('after addRoot starts, a newly started or switched conversation still cannot bind or become a global draft',async t=>{
 for(const action of ['start','switch']){
  const f=await fixture(t),gate=deferred();f.h.workspaceService.addRoot=async()=>{f.calls.push(['addRoot']);await gate.promise;};
  const pending=f.h.useDraftWorkspaceFolder(URI.fromFilePath(f.folder),true);await new Promise(r=>setTimeout(r,10));
  if(action==='start')f.a.turns.push({id:'started'});else f.h.activeCodingSessionId='B';gate.resolve();
  assert.equal(await pending,false);assert.equal(f.calls.filter(c=>c[0]==='bind').length,0);assert.equal(f.h.globalCodingDraft,false);assert.equal(f.h.prompt,'KEEP DRAFT');
 }
});
test('files and every strict non-draft owner are rejected; entry fullPath and name never become a project path',async t=>{
 for(const mutate of [a=>a.incognito=true,a=>a.historyLoaded=false,a=>a.turnCount=1,a=>a.latestTurn={},a=>a.sourceConversationId='origin',a=>a.goal={},a=>a.followUpQueue=[{}],a=>a.agentChildDrafts=[{}]]){
  const f=await fixture(t);mutate(f.a);assert.equal(await f.h.useDraftWorkspaceFolder(URI.fromFilePath(f.folder),true),false);assert.deepEqual(sideEffects(f),[]);
 }
 const f=await fixture(t);assert.equal(await f.h.useDraftWorkspaceFolder(URI.fromFilePath(f.regular),true),false);assert.deepEqual(sideEffects(f),[]);
 globalThis.window={nextmuxDesktop:{getPathForFile:()=>''}};
 try{await f.h.addComposerFolders([{entry:{isDirectory:true,name:'foreign',fullPath:'/foreign/guess'}}],undefined,{asProject:true});assert.deepEqual(sideEffects(f),[]);}finally{delete globalThis.window;}
});

test('real Chromium native directory DataTransfer routes only unstarted ordinary body drops to the project intent',async t=>{
 const base=await mkdtemp(join(tmpdir(),'nmx-native-drop-'));t.after(()=>rm(base,{recursive:true,force:true}));const folder=join(base,'目录 spaces');await mkdir(folder);
 const code=transpile(`class DropHarness {${['handleComposerDrop','handleCodingStageDragOver','composerFilesFromTransfer','draftWorkspaceCanChange','unstartedCodingDraft'].map(method).join('\n')}};window.DropHarness=DropHarness;`);
 const browser=await puppeteer.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();
 await page.setContent('<section class="nmx-coding-stage"><div class="nmx-empty-task" style="height:150px">Empty body</div><div class="nmx-task-view" style="height:150px">Started body</div><div class="nmx-composer-dock nmx-composer-wrap"><textarea style="height:80px">KEEP</textarea></div></section>');await page.addScriptTag({content:code});
 await page.evaluate(()=>{const h=window.h=new DropHarness();Object.assign(h,{activeSection:'coding',codingPanel:'thread',activeCodingSessionId:'A',globalCodingDraft:false,composerDropMode:'thread',incognitoModeIsBusy:()=>false,appControlAvailable:()=>false,update(){},folders:[],files:[],owner:{id:'A',turns:[],incognito:false,historyLoaded:true}});h.activeCodingSession=()=>h.owner;h.addBrowserFiles=files=>h.files.push(files.length);h.addComposerFolders=(folders,offset,options)=>h.folders.push({count:folders.length,nativeFile:folders[0].file instanceof File,name:folders[0].entry.name,offset,asProject:options?.asProject??null});const stage=document.querySelector('section');for(const name of ['dragenter','dragover'])stage.addEventListener(name,e=>h.handleCodingStageDragOver(e));stage.addEventListener('drop',e=>h.handleComposerDrop(e));});
 const client=await page.createCDPSession();
 const drop=async selector=>{const point=await page.$eval(selector,e=>{const r=e.getBoundingClientRect();return{x:r.left+10,y:r.top+10}});for(const type of ['dragEnter','dragOver','drop'])await client.send('Input.dispatchDragEvent',{type,...point,data:{items:[],files:[folder],dragOperationsMask:1}});};
 for(const bound of ['', '/existing']){await page.evaluate(bound=>{h.owner.workspacePath=bound;h.owner.turns=[];h.owner.incognito=false;h.composerDropMode='thread';},bound);await drop('.nmx-empty-task');assert.equal(await page.evaluate(()=>h.folders.at(-1).asProject),true);}
 assert.equal(await page.evaluate(()=>h.folders.at(-1).nativeFile),true,'directory must be captured from the actual native File/DataTransfer');
 await page.evaluate(()=>{h.owner.turns=[{id:'started'}];});await drop('.nmx-task-view');assert.equal(await page.evaluate(()=>h.folders.at(-1).asProject),null);
 await page.evaluate(()=>{h.owner.turns=[];h.owner.incognito=true;});await drop('.nmx-empty-task');assert.equal(await page.evaluate(()=>h.folders.at(-1).asProject),null);
 await page.evaluate(()=>{h.owner.incognito=false;h.composerDropMode='composer';});await drop('textarea');assert.equal(await page.evaluate(()=>h.folders.at(-1).asProject),null);
 await page.evaluate(()=>{const before=h.folders.length,transfer=new DataTransfer();transfer.setData('text/uri-list','https://example.com/foreign');document.querySelector('.nmx-empty-task').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));window.urlUnchanged=h.folders.length===before;});assert.equal(await page.evaluate(()=>urlUnchanged),true);
});
