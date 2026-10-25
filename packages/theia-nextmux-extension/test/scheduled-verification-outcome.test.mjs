import { runtimeFinalText } from '../lib/browser/nextmux-agent-outcome-locale.js';
import { desktopStatus } from '../lib/common/nextmux-desktop-status.js';
import { domainMessageFromError, DesktopDomainError } from '../lib/common/nextmux-domain-errors.js';
import { desktopDomainMessage, desktopDomainErrorText } from '../lib/browser/nextmux-domain-error-locale.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { AgentQuestionController } from '../lib/browser/nextmux-agent-question.js';
import { declaredReasoningSettings } from '../lib/common/nextmux-model-controls.js';
import { goalRequestPrompt, goalTurnDecision } from '../lib/browser/nextmux-goal-runner.js';
import { pauseGoalTiming } from '../lib/browser/nextmux-goal-elapsed.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const URI = require('@theia/core/lib/common/uri').default;
const { FileType } = require('@theia/filesystem/lib/common/files');
const { scheduledTaskNeedsAttention } = require('../lib/common/nextmux-schedule');

const path = new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url);
const source = ts.createSourceFile(path.pathname, readFileSync(path,'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function actualMethod(name, globals = {}) {
  let method;
  function visit(node) { if (ts.isMethodDeclaration(node) && node.name.getText(source) === name) method = node; ts.forEachChild(node,visit); }
  visit(source); assert.ok(method,`method ${name} exists`);
  const methodText=method.getText(source).replace(/^protected\s+/, '');
  const code=ts.transpileModule(`class Subject { ${methodText} }; globalThis.testedMethod=Subject.prototype.${name};`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  const context={runtimeFinalText, DesktopDomainError, desktopStatus, domainMessageFromError, desktopDomainMessage, desktopDomainErrorText, ...globals};vm.runInNewContext(code,context);return context.testedMethod;
}
const scheduled=actualMethod('executeScheduledTask',{
  URI, FileType, AgentQuestionController, window: {}, scheduledTaskNeedsAttention, bindPriceQuote: route=>route, normalizeModelCitations:()=>[], priceAuthorizationErrorCode:()=>undefined,
  declaredReasoningSettings,
});
const modelReasoningContract = actualMethod('modelReasoningContract');
function schedulerFixture(result){
  const patches=[],turns=[],notifications=[];
  const task={id:'schedule',title:'Check source',cadence:'once',enabled:true,workspacePath:'/work',routeId:'official',prompt:'Run task'};
  const subject={desktopLocale:'zh-CN',fileService:{activateProvider:async()=>({stat:async()=>({type:FileType.Directory})})},scheduledTasksReady:true,scheduledTasksPersistence:Promise.resolve(),scheduledAgentRuns:new Map(),
    scheduledTasks:[task],scheduledTaskDueAt:()=>Date.now()-1000,flushConversationHistory:async()=>{},pollScheduledAgentRun:async()=>result,runningScheduledTaskIds:new Set(),workspaceOptions:[{path:'/work'}],defaultPermissionMode:'full_access',
    conversationHistoryReady:()=>true, allModelRoutes:()=>[{id:'official',kind:'official_connection',connection:{id:'key',model:'model',providerName:'provider',modelFamily:'model'}}],
    modelReasoningContract,
    updateScheduledTask:(_id,patch)=>patches.push(patch),scheduledTaskSession:()=>({id:'conversation'}),codingConversationHistory:()=>[],
    appendCodingTurn:()=>({id:'turn'}),managedModelRoute:()=>undefined,reasoningEffortForRoute:()=>undefined,prepareAgentSkills:async()=>[],
    updateCodingTurn:(_sid,_tid,patch)=>turns.push(patch),agentBillingLabel:()=>'',notifySystemTask(){},codingSessionTitle:text=>text,addNotification:(...args)=>notifications.push(args),
    platformService:{claimDesktopScheduledTaskRun:async()=>({claimed:true}),startAgentRun:async()=>({runId:'scheduled-job'}),removeDesktopScheduledTask:async()=>{}}};
  return {subject,task,patches,turns,notifications};
}
function result(status,extra={}){return{status,stopReason:status,finalText:'Run result',route:{modelFamily:'model',providerName:'provider'},turns:1,toolCalls:0,usage:{inputTokens:1,outputTokens:1},failoverCount:0,changes:[],events:[],billing:{kind:'provider_direct'},...extra};}

test('scheduled context overflow retains pause/recovery state and never announces success',async()=>{
  const f=schedulerFixture(result('limit_reached',{stopReason:'context_window_exceeded',resumeCheckpointId:'resume-001',finalText:'模型上下文不足'}));
  await scheduled.call(f.subject,f.task);
  assert.equal(f.turns.at(-1).stage,'paused');assert.equal(f.turns.at(-1).resumeCheckpointId,'resume-001');
  assert.equal(f.turns.at(-1).stopReason,'context_window_exceeded');assert.equal(f.patches.at(-1).lastStatus,'error');
  assert.equal(f.notifications.at(-1)[0],'warning');assert.equal(f.patches.at(-1).lastMessageDescriptor.params.stopReason,'context_window_exceeded');
  assert.match(f.patches.at(-1).lastMessage,/context/i);
  assert.equal(f.patches.at(-1).lastMessageDescriptor.technicalDetails,'模型上下文不足');
});
test('scheduled cancellation and failed checks are retained, while a successful result completes',async()=>{
  for(const [response,stage,status] of [[result('cancelled',{resumeCheckpointId:'cancel-resume'}),'cancelled','error'],[result('completed',{verification:{status:'failed'}}),'complete','error'],[result('completed',{verification:{status:'passed'}}),'complete','complete']]){
    const f=schedulerFixture(response);await scheduled.call(f.subject,f.task);
    assert.equal(f.turns.at(-1).stage,stage);assert.equal(f.patches.at(-1).lastStatus,status);
    assert.equal(f.turns.at(-1).verification,response.verification);
  }
});

test('a failed real check prevents a goal completion marker from completing the goal; unverified goals remain possible',()=>{
  for(const status of ['failed','passed','unverified']){
    const timers=[];
    const method=actualMethod('scheduleGoalContinuation',{agentPauseBlocksAutomaticDispatch:()=>false,goalTurnDecision,goalRequestPrompt,window:{setTimeout:callback=>timers.push(callback)}});
    const turn={id:'turn',stage:'complete',response:'All done\n[GOAL_COMPLETE]',verification:{status}};
    const goal={id:'goal',status:'active',prompt:'Implement',attempts:0};
    const session={id:'session',goal,turns:[turn]};
    const subject={codingSessions:[session],goalContinuationTimers:new Set(),update(){},persistCodingSessions(){},persistCodingGoalFile:async()=>{},
      updateFollowUpQueue(){return true;},setCodingGoalStatus:actualMethod('setCodingGoalStatus',{pauseGoalTiming})};
    method.call(subject,'session',turn);
    assert.equal(subject.codingSessions[0].goal.status,status==='failed'?'active':'completed');
    assert.equal(timers.length,status==='failed'?1:0);
  }
});
