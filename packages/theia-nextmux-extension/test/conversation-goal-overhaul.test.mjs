import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';
import React from 'react';
import { goalActiveElapsedMs, formatGoalElapsed, goalTurnRunning, normalizeGoalTiming, pauseGoalTiming, resumeGoalTiming } from '../lib/browser/nextmux-goal-elapsed.js';
import { goalRequestPrompt, goalUpdateReminder } from '../lib/browser/nextmux-goal-runner.js';
import { goalSteeringObjective, goalUpdateObjective } from '../lib/browser/nextmux-goal-presentation.js';
import { goalEditorText, goalScheduleText } from '../lib/browser/nextmux-goal-schedule-locale.js';
import { goalFileBody, goalFileObjective } from '../lib/browser/nextmux-goal-file-format.js';
import { ManagedPriceNoticeStore } from '../lib/browser/nextmux-managed-price-notice.js';
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = file.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'NextMuxDesktopWidget');
const names = ['openGoalComposer','openGoalDialog','closeGoalDrawer','saveGoalDrawer','dropUnsubmittedGoalTasks','persistCodingGoalFile','reconcileConversationSurfaces','addNotification','dismissComposerNotification','renderGoalDrawer','scrollThreadTurn','onCodingStageScroll','onThreadAtBottomStateChange','noteThreadUserScrollIntent','reopenConversationAppTab','activateContextFileTab'];
const methods = names.map(name => { const n = widget.members.find(n => n.name?.getText(file) === name); assert.ok(n,name); return n.getText(file); });
const parser = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'parsePersistedCodingGoalFile').getText(file);
class Element { isConnected = true; focus() { this.focused = true; } }
const frames = [], timers = new Map(); let timerId = 0;
const deps = { visualTabsFor: tabs => tabs, tabWindowText: (_l,k) => k, navigator: { userAgent: 'macOS' }, desktopFailureMessage: (_l,e) => e.message, React, crypto: webcrypto, goalEditorText, goalScheduleText, goalFileBody, goalFileObjective, normalizeGoalTiming, pauseGoalTiming, resumeGoalTiming, goalUpdateReminder, goalRequestPrompt,
 activeRunBelongsToSession: (a,b) => a === b, desktopDomainErrorText: (_l,e) => e.message,
 document: { activeElement: new Element() }, HTMLElement: Element, CSS: { escape: s => s },
 requestAnimationFrame: f => { frames.push(f); }, performance: { now: () => 100 }, GoalElapsed: () => null,
 URI: { fromFilePath: v => ({ resolve: p => deps.URI.fromFilePath(`${v}/${p}`), toString: () => v }) },
 window: { setTimeout(f) { timers.set(++timerId,f); return timerId; }, clearTimeout(id) { timers.delete(id); }, addEventListener() {}, removeEventListener() {} } };
const Harness = new Function(...Object.keys(deps), ts.transpile(`${parser}\nclass Harness { ${methods.join('\n')} }; return Harness;`, { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React }))(...Object.values(deps));
function fixture(status = 'active', running = false) {
 const goal = { id:'g',prompt:'Old objective',status,createdAt:1,updatedAt:2,attempts:0 };
 const session = { id:'a',goal,turns:[],followUpQueue:[{id:'old',automaticGoal:true},{id:'sent',automaticGoal:true,dispatch:{}},{id:'user'}] };
 const calls = { writes:[],persisted:[],submits:[],steering:[] };
 const h = Object.assign(new Harness(), { activeCodingSessionId:'a',activeSection:'coding',codingPanel:'thread',codingSessions:[session],desktopLocale:'zh-CN',
 goalDraftsBySession:new Map(),goalEditorDrafts:new Map(),goalContinuationTimers:new Set(),goalFileOperations:new Map(),contextFileTabs:new Map(),
 notifications:[],composerNotifications:[],composerNotificationTimers:new Map(),managedPriceNotices:new ManagedPriceNoticeStore(),prompt:'ordinary draft',goalComposerActive:false,
 activeCodingSession() { return this.codingSessions.find(s => s.id === this.activeCodingSessionId); },
 conversationAgentRun: () => ({activeAgentRunId:running?'run-a':'',activeAgentSessionId:'a'}),
 persistCodingSessions() { calls.persisted.push(this.codingSessions[0].goal); },persistNotifications() {},codingSessionWorkspaceRoot:() => '/project',update() {},
 setComposerPrompt(v) { this.prompt=v; },scheduleComposerDraftPersist() {},node:{querySelector:() => null},
 submitSavedCodingGoal(id,goal) { calls.submits.push({id,goal}); },
 updateFollowUpQueue(id,queue) { this.codingSessions=this.codingSessions.map(s => s.id===id?{...s,followUpQueue:queue}:s); return true; },
 async persistCodingGoalFile(s,g,mode) { calls.writes.push({s,g,mode}); },platformService:{async sendAgentRunMessage(id,content) { calls.steering.push({id,content}); }},trapDialogFocus() {} });
 return {h,goal,session,calls};
}
const edit = async h => { await h.openGoalDialog(); h.goalDrawer.draft='  New objective\nSecond line  '; };
for (const status of ['active','paused']) test(`${status} goal routes openGoalComposer to edit drawer without touching composer`, () => {
 const {h}=fixture(status);h.openGoalComposer();assert.equal(h.goalComposerActive,false);assert.equal(h.prompt,'ordinary draft');
 assert.equal(h.goalDrawer?.goalId,'g');assert.equal(h.goalDrawer?.draft,'Old objective');assert.equal(h.notifications.length,0);
});
test('completed goal allows openGoalComposer to enter replacement mode while preserving previous prompt', () => {
 const {h}=fixture('completed');h.openGoalComposer();assert.equal(h.goalComposerActive,true);assert.equal(h.goalComposerPreviousPrompt,'ordinary draft');
 assert.equal(h.prompt,'');assert.equal(h.goalDrawer,undefined);assert.equal(h.notifications.length,0);
});
for (const status of ['active','paused','completed']) test(`${status} edit persists trimmed replacement and preserves pause`, async () => {
 const {h,calls}=fixture(status);await edit(h);await h.saveGoalDrawer();
 assert.equal(h.codingSessions[0].goal.prompt,'New objective\nSecond line');assert.equal(h.codingSessions[0].goal.status,status==='paused'?'paused':'active');
 assert.deepEqual(calls.writes[0].mode,{previousPrompt:'Old objective'});assert.equal(calls.submits.length,status==='paused'?0:1);
 assert.equal(h.goalDrawer,undefined);assert.deepEqual(h.codingSessions[0].followUpQueue.map(t=>t.id),['sent','user']);assert.equal(h.prompt,'ordinary draft');
});
test('running edit saves once and relies on native steering without extra turn',async()=>{
 const {h,calls}=fixture('active',true);await edit(h);await h.saveGoalDrawer();assert.equal(calls.writes.length,1);assert.equal(calls.submits.length,0);assert.deepEqual(calls.steering,[]);
});
test('rootless running edit uses one bounded reminder; paused goal does not steer',async()=>{
 for(const [status,length,count] of [['active',10,1],['active',20000,0],['paused',10,0]]){
 const {h,calls}=fixture(status,true);h.codingSessionWorkspaceRoot=()=>'';await edit(h);h.goalDrawer.draft='x'.repeat(length);await h.saveGoalDrawer();
 assert.equal(calls.steering.length,count);assert.equal(calls.submits.length,0);if(count)assert.equal(goalSteeringObjective({content:calls.steering[0].content}),'x'.repeat(length)); }
});
test('unchanged/empty drafts do not write and failed save retains old record and draft',async()=>{
 const {h,calls}=fixture();await h.openGoalDialog();h.goalDrawer.draft=' Old objective ';await h.saveGoalDrawer();assert.equal(h.goalDrawer,undefined);assert.equal(calls.writes.length,0);
 await h.openGoalDialog();h.goalDrawer.draft=' ';await h.saveGoalDrawer();assert.ok(h.goalDrawer);h.goalDrawer.draft='new';h.persistCodingGoalFile=async()=>{throw Error('conflict');};await h.saveGoalDrawer();
 assert.equal(h.codingSessions[0].goal.prompt,'Old objective');assert.ok(h.goalDrawer.error);assert.equal(h.goalDrawer.saving,false);
});
test('switch preserves drawer draft; cancel discards; deletion closes drawer',async()=>{
 const {h}=fixture();await edit(h);h.activeCodingSessionId='b';h.reconcileConversationSurfaces('b');assert.equal(h.goalDrawer,undefined);
 h.activeCodingSessionId='a';await h.openGoalDialog();assert.equal(h.goalDrawer.draft.trim(),'New objective\nSecond line');h.closeGoalDrawer();await h.openGoalDialog();assert.equal(h.goalDrawer.draft,'Old objective');
 h.codingSessions=[];h.reconcileConversationSurfaces('a');assert.equal(h.goalDrawer,undefined);
});
test('switch drops notices/timers and async completion stays in original history',()=>{
 const {h}=fixture();h.addNotification('info','A','detail');const timer=[...h.composerNotificationTimers.values()][0];assert.ok(timers.has(timer));
 h.activeCodingSessionId='b';h.reconcileConversationSurfaces('b');assert.equal(h.composerNotifications.length,0);assert.equal(timers.has(timer),false);
 h.addNotification('success','Done A','','a');assert.equal(h.composerNotifications.length,0);assert.equal(h.notifications[0].conversationId,'a');
 h.addNotification('info','Global','','');assert.equal(h.composerNotifications.length,1);h.addNotification('info','same','','b');h.addNotification('info','same','','a');assert.equal(h.notifications.filter(n=>n.title==='same').length,2);
});
test('active time excludes old goals, human turns, idle and paused intervals across resume',()=>{
 const goal={createdAt:60000,status:'active'};const turns=[{prompt:goalRequestPrompt('old','start'),createdAt:0,completedAt:50000,stage:'complete'},
 {prompt:'human',createdAt:70000,completedAt:200000,stage:'complete'},{prompt:goalRequestPrompt('new','start'),createdAt:60000,completedAt:120000,stage:'complete'},
 {prompt:'explicit',goalPresentationOrigin:'automatic-v1',createdAt:180000,stage:'running'}];
 assert.equal(goalActiveElapsedMs(goal,turns,300000),180000);const paused={...goal,...pauseGoalTiming(goal,240000),status:'paused'};
 assert.equal(goalActiveElapsedMs(paused,turns,600000),120000);assert.equal(goalTurnRunning(paused,turns),false);
 const resumed={...paused,...resumeGoalTiming(paused,600000),status:'active'};assert.equal(goalActiveElapsedMs(resumed,turns,660000),180000);assert.equal(goalTurnRunning(resumed,turns),true);
 assert.deepEqual([0,14*60000,135*60000,1523*60000].map(formatGoalElapsed),['0m','14m','2h 15m','1d 1h 23m']);
});
test('native and exact fallback steering expose only objective',()=>{
 assert.equal(goalSteeringObjective({kind:'goal_update',content:'new\nline'}),'new\nline');assert.equal(goalSteeringObjective({kind:'direction',content:goalUpdateReminder('new')}),'new');
 assert.equal(goalSteeringObjective({kind:'direction',content:'<system-reminder>quote</system-reminder>'}),undefined);
});
test('explicit prompt replacement retains SHA CAS and rejects external prompt conflicts',async()=>{
 const {h,session,goal}=fixture();h.persistCodingGoalFile=Harness.prototype.persistCodingGoalFile;
 let content=`---\nconversationId: a\ngoalId: g\nstatus: active\ncreatedAt: 1\nupdatedAt: 2\nattempts: 0\n---\n\n${goalFileBody('zh-CN',goal.prompt)}`;
 const hash=async()=>Buffer.from(await webcrypto.subtle.digest('SHA-256',Buffer.from(content))).toString('hex');
 h.platformService={async getAgentFileState(){return{exists:true,sha256:await hash()};},async saveCodingGoalFile(r){assert.equal(r.expectedSha256,await hash());content=r.content;}};
 h.fileService={async readFile(){return{value:{buffer:Buffer.from(content)}};}};
 await assert.rejects(h.persistCodingGoalFile(session,{...goal,prompt:'new'}),/其他位置修改/);
 await h.persistCodingGoalFile(session,{...goal,prompt:'new',updatedAt:3},{previousPrompt:goal.prompt});assert.ok(content.endsWith('\nnew\n'));assert.ok(!content.includes('Old objective'));
 content=content.replace('\nnew\n','\nexternal\n');await assert.rejects(h.persistCodingGoalFile(session,{...goal,prompt:'again'},{previousPrompt:'new'}),/其他位置修改/);
});
test('short last turn cannot steal clicked penultimate marker at clamped bottom',()=>{
 const {h}=fixture();frames.length=0;const stage={scrollTop:0,scrollHeight:1100,clientHeight:500,getBoundingClientRect:()=>({top:0}),scrollTo({top}){this.scrollTop=top;},querySelectorAll(){throw Error('scroll spy must not override click');}};
 const target={getBoundingClientRect:()=>({top:800-stage.scrollTop,height:100})};Object.assign(h,{threadListTurns:[{id:'first'},{id:'penultimate'},{id:'last'}],threadJumpToken:0,threadScroller:stage,
 node:{querySelector:s=>s==='.nmx-task-view'?stage:target},cancelThreadBottomFollow(){},cancelThreadScrollRestore(){},revealActiveThreadMarker(){}});
 h.scrollThreadTurn('penultimate',false);assert.equal(stage.scrollTop,600);assert.equal(h.activeThreadTurnId,'penultimate');h.onThreadAtBottomStateChange(true);h.onCodingStageScroll();
 while(frames.length)frames.shift()();assert.equal(h.activeThreadTurnId,'penultimate');assert.ok(target.getBoundingClientRect().top+100<=stage.clientHeight);
 h.noteThreadUserScrollIntent();assert.equal(h.threadClickedTurn,undefined);
});
test('drawer blocks dirty scrim dismissal and saves via IME-safe keyboard shortcut',async()=>{
 const {h}=fixture();await edit(h);const children=h.renderGoalDrawer().props.children,aside=children[1];assert.equal(aside.props.role,'dialog');assert.equal(aside.props['aria-modal'],'true');
 let saves=0;h.saveGoalDrawer=async()=>{saves++;};const event={nativeEvent:{isComposing:true},key:'Enter',ctrlKey:true,preventDefault(){}};
 aside.props.onKeyDown(event);assert.equal(saves,0);event.nativeEvent.isComposing=false;aside.props.onKeyDown(event);assert.equal(saves,1);children[0].props.onMouseDown();assert.ok(h.goalDrawer);
});

test('async app completion keeps the conversation captured before awaiting', async () => {
 const {h}=fixture(); const tab={id:'tab',kind:'local-desktop',appId:'example'};
 h.conversationTabs=[tab];h.tabInteractedIds=new Set();let resolve;
 h.handleTabToolRequest=()=>new Promise(r=>{resolve=r;});
 // App-tab failures are announced inside the tab (top-right toast), keyed by the captured conversation.
 h.tabAnnouncements=new Map();h.announceTab=(conversationId,tabId,text)=>h.tabAnnouncements.set(`${conversationId}\n${tabId}`,{text});
 const completion=h.reopenConversationAppTab('a',tab,'check_or_open');h.activeCodingSessionId='b';h.reconcileConversationSurfaces('b');
 resolve({ok:false,error:'failed'});await completion;
 assert.ok(h.tabAnnouncements.has('a\ntab'),'announced in conversation a');assert.ok(!h.tabAnnouncements.has('b\ntab'));assert.equal(h.composerNotifications.length,0);
});

test('old objective completing during disk save cannot complete the newly edited objective', async () => {
 const {h}=fixture('active',true); const run={activeAgentRunId:'run-a',activeAgentSessionId:'a'};h.conversationAgentRun=()=>run;
 let release;h.persistCodingGoalFile=()=>new Promise(r=>{release=r;});const queued=[];
 h.enqueueFollowUpTask=(id,kind,prompt)=>{queued.push({id,kind,prompt});return true;};h.requestFollowUpQueueDrain=()=>{};
 await edit(h);const saving=h.saveGoalDrawer();
 h.codingSessions=h.codingSessions.map(s=>({...s,goal:{...s.goal,status:'completed',pausedAt:10},turns:[{id:'old-turn',stage:'complete',response:'[GOAL_COMPLETE]'}]}));
 run.activeAgentRunId='';release();await saving;
 assert.equal(h.codingSessions[0].goal.status,'active');assert.equal(h.codingSessions[0].goal.pausedAt,undefined);
 assert.equal(queued.length,1);assert.equal(queued[0].prompt,goalRequestPrompt('New objective\nSecond line','continue'));
});

test('history compaction preserves native goal kind and complete fallback envelope', () => {
 const historySource=readFileSync(new URL('../src/browser/nextmux-conversation-history.ts',import.meta.url),'utf8');
 const history=ts.createSourceFile('history.ts',historySource,ts.ScriptTarget.Latest,true);
 const helpers=['isRecord','boundedString','optionalString','compactSteeringMessage'].map(name=>{
  const fn=history.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(fn,name);return fn.getText(history);
 });
 const compact=new Function('goalUpdateObjective',ts.transpile(helpers.join('\n')+';return compactSteeringMessage;',{target:ts.ScriptTarget.ES2022}))(goalUpdateObjective);
 for(const message of [{kind:'goal_update',content:'objective'.repeat(500)},{kind:'direction',content:goalUpdateReminder('new target'.repeat(300))}]){
  const saved=compact({...message,id:'update',createdAt:'2026-10-21T00:00:00Z',status:'accepted'},true);
  assert.equal(goalSteeringObjective(saved),goalSteeringObjective(message));assert.equal(saved.content,message.content);
 }
});

test('elapsed leaf owns a 30-second timer only during an active goal turn and cleans it up', () => {
 const viewSource=readFileSync(new URL('../src/browser/nextmux-goal-elapsed-view.tsx',import.meta.url),'utf8');
 const view=ts.createSourceFile('elapsed.tsx',viewSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const fn=view.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='GoalElapsed');
 const calls=[];let cleanup;
 const react={...React,useState:()=>[0,()=>calls.push('tick')],useEffect:effect=>{cleanup=effect();}};
 const clock={setInterval(callback,ms){calls.push(ms);callback();return 7;},clearInterval(id){calls.push(`clear:${id}`);}};
 const component=new Function('React','window','goalTurnRunning','formatGoalElapsed','goalActiveElapsedMs',ts.transpile(fn.getText(view).replace('export ', '')+';return GoalElapsed;',{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}))(react,clock,goalTurnRunning,formatGoalElapsed,goalActiveElapsedMs);
 const turns=[{prompt:goalRequestPrompt('objective','start'),createdAt:1,stage:'running'}];
 component({goal:{createdAt:0,status:'active'},turns});assert.deepEqual(calls,[30000,'tick']);cleanup();assert.equal(calls.at(-1),'clear:7');
 calls.length=0;component({goal:{createdAt:0,status:'paused',pausedAt:2},turns});assert.deepEqual(calls,[]);assert.equal(cleanup,undefined);
});

test('reopening a legacy goal file tab routes to the dedicated drawer without changing the file preview', async () => {
 const {h}=fixture();h.isCodingGoalFileUri=()=>true;const preview={uri:'file:///project/kept.ts'};h.contextFilePreview=preview;
 assert.equal(h.activateContextFileTab('file:///project/.nextmux/goals/g.md'),true);
 assert.equal(h.goalDrawer.goalId,'g');assert.equal(h.contextFilePreview,preview);
});

test('historical replay notifications capture sessionId rather than borrowing the current composer owner', () => {
 for(const name of ['submitPrompt','executePromptSubmission']){
  const method=widget.members.find(n=>n.name?.getText(file)===name);
  const declaration=method.body.statements.flatMap(n=>ts.isVariableStatement(n)?n.declarationList.declarations:[]).find(n=>n.name.getText(file)==='notificationSessionId');
  assert.ok(declaration,name);
  const owner=new Function('queuedExecution','resumedExecution','historicalExecution',`return ${declaration.initializer.getText(file)};`);
  assert.equal(owner.call({activeCodingSessionId:'B'},undefined,undefined,{sessionId:'A'}),'A');
 }
});
