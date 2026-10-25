import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url),ts=require('typescript');
const browser=path.resolve(import.meta.dirname,'../src/browser');
const text=fs.readFileSync(path.join(browser,'nextmux-desktop-widget.tsx'),'utf8');
const ast=ts.createSourceFile('widget.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),methods=[];
function walk(n){if(ts.isMethodDeclaration(n)&&['prepareDurableRecovery','settleDurableRetryConfirmation','beginApplicationExit'].includes(n.name.getText(ast)))methods.push(n.getText(ast));ts.forEachChild(n,walk)}walk(ast);assert.equal(methods.length,3);
const helper=ts.transpileModule(fs.readFileSync(path.join(browser,'nextmux-durable-recovery.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const context=vm.createContext({exports:{},Map,Set,Promise,document:{body:{inert:false}},durableRecoveryText:()=>({title:'unknown',unavailable:'blocked'})});vm.runInContext(helper,context);context.durableRecoveryDecision=context.exports.durableRecoveryDecision;
vm.runInContext(ts.transpileModule('class WidgetFixture{'+methods.join('\n')+'};globalThis.WidgetFixture=WidgetFixture;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);
const operationId='op-11111111-1111-4111-8111-111111111111',handle='resume-22222222-2222-4222-8222-222222222222';
const blocked=()=>({status:'blocked',reason:'result_unknown',resumeCheckpointId:handle,headRevision:7,operations:[{operationId,revision:3,toolCallId:'call-original',toolName:'agent.delegate',operationKind:'delegated_model',state:'running',reason:'result_unknown',retrySupported:true,usageKnown:false}]});
function fixture(){let resolve,reject,calls=0;const query=new Promise((a,b)=>{resolve=a;reject=b});const w=new context.WidgetFixture(),turn={id:'turn',resumeCheckpointId:handle,permissionMode:'read_only'},session={id:'owner',turns:[turn],workspaceRoot:'/synthetic/original',workspaceBindings:[]};Object.assign(w,{durableRecoveryChecks:new Set(),codingSessions:[session],activeCodingSessionId:session.id,activeModelRouteId:'route-a',activeKeyPriceQuoteId:'quote-a',automaticRelaySource:'off',applicationExitPreparing:false,applicationExitGeneration:1,conversationHistoryLoadGeneration:1,node:{inert:false},desktopLocale:'en',notifications:[],updates:0,conversationHistoryReady:()=>true,conversationHasActiveRun:()=>false,codingSessionWorkspaceRoot:s=>s.workspaceRoot,platformService:{getAgentDurableRecovery:async()=>{calls++;return query}},update(){this.updates++},addNotification(...args){this.notifications.push(args)}});return{w,turn,session,resolve,reject,calls:()=>calls,prepare:()=>w.prepareDurableRecovery(session,turn,handle,'read_only',true)}}
const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve()};
test('same owner inspection has one in-flight query; duplicate click cannot create another approval',async()=>{const f=fixture(),first=f.prepare();assert.equal((await f.prepare()).proceed,false);assert.equal(f.calls(),1);f.resolve(blocked());await flush();assert(f.w.pendingDurableRetry);f.w.settleDurableRetryConfirmation(false);assert.equal((await first).proceed,false);assert.equal(f.w.durableRecoveryChecks.size,0)});
for(const [name,change]of[['conversation',f=>f.w.activeCodingSessionId='foreign'],['route',f=>f.w.activeModelRouteId='route-b'],['quote',f=>f.w.activeKeyPriceQuoteId='quote-b'],['checkpoint',f=>f.turn.resumeCheckpointId='resume-33333333-3333-4333-8333-333333333333'],['history generation',f=>f.w.conversationHistoryLoadGeneration++],['active run',f=>f.w.conversationHasActiveRun=()=>true]])test(`query resolved after ${name} changes cannot approve`,async()=>{const f=fixture(),p=f.prepare();change(f);f.resolve(blocked());assert.equal((await p).proceed,false);assert.equal(f.w.pendingDurableRetry,undefined)});
test('cancel and repeated confirm do not issue consent; one explicit confirm yields exact immutable selection',async()=>{const f=fixture(),p=f.prepare();f.resolve(blocked());await flush();f.w.settleDurableRetryConfirmation(true);f.w.settleDurableRetryConfirmation(true);const r=await p;assert.equal(r.proceed,true);assert.equal(r.retry.operationId,operationId);assert.equal(r.retry.expectedRevision,3);assert.equal(r.retry.headRevision,7);assert.equal(f.w.pendingDurableRetry,undefined)});
test('route changed while dialog is open invalidates confirmation',async()=>{const f=fixture(),p=f.prepare();f.resolve(blocked());await flush();f.w.activeModelRouteId='route-b';f.w.settleDurableRetryConfirmation(true);assert.equal((await p).proceed,false)});
test('application exit resolves the dialog as cancellation and clears inspection lock',async()=>{const f=fixture(),p=f.prepare();f.resolve(blocked());await flush();f.w.beginApplicationExit();assert.equal((await p).proceed,false);assert.equal(f.w.pendingDurableRetry,undefined);assert.equal(f.w.durableRecoveryChecks.size,0)});
test('workspace ownership drift during query cannot reuse old approval',async()=>{const f=fixture(),p=f.prepare();f.session.workspaceRoot='/synthetic/foreign';f.resolve(blocked());await flush();if(f.w.pendingDurableRetry)f.w.settleDurableRetryConfirmation(true);assert.equal((await p).proceed,false)});
for (const phase of ['query', 'dialog']) {
    for (const [name, change] of [
        ['binding path', f => { f.session.workspaceBindings[0].path = '/synthetic/foreign'; }],
        ['binding permission', f => { f.session.workspaceBindings[0].permission = 'workspace_write'; }],
        ['turn permission', f => { f.turn.permissionMode = 'workspace_write'; }]
    ]) test(`${name} drift during ${phase} invalidates recovery consent`, async () => {
        const f = fixture();
        f.session.workspaceBindings = [{ id: 'workspace-a', path: '/synthetic/original', permission: 'read_only', status: 'linked' }];
        const pending = f.prepare();
        if (phase === 'dialog') { f.resolve(blocked()); await flush(); assert(f.w.pendingDurableRetry); }
        change(f);
        if (phase === 'query') f.resolve(blocked());
        else f.w.settleDurableRetryConfirmation(true);
        assert.equal((await pending).proceed, false);
    });
}
function childFixture() {
    const f = fixture();
    const child = { childRunId: 'child-original', parentRunId: 'parent-original', rootRunId: 'root-original', depth: 1,
        resumeCheckpointId: handle, status: 'completed', taskContext: { permissionMode: 'read_only' } };
    f.turn.childAgents = [child];
    f.w.agentChildContinuationStates = new Map();
    f.w.childContinuationHandle = value => value.resumeCheckpointId;
    return { ...f, child, prepareChild: (allowRetry = false) => f.w.prepareDurableRecovery(f.session, f.turn, handle, 'read_only', allowRetry, child.childRunId) };
}
test('a finished child can continue while its parent is active and sends exact child identity without parent bindings', async () => {
    const f = childFixture(); let query;
    f.w.conversationHasActiveRun = () => true;
    f.session.workspaceBindings = [{ id: 'parent-only', path: '/parent', permission: 'workspace_write' }];
    f.w.platformService.getAgentDurableRecovery = async request => { query = request; return { status: 'none', reason: 'no_unknown_operations', operations: [] }; };
    assert.equal((await f.prepareChild()).proceed, true);
    assert.equal(query.workspaceBindings, undefined);
    assert.equal(query.childContinuation.childRunId, f.child.childRunId);
    assert.equal(query.childContinuation.parentRunId, f.child.parentRunId);
    assert.equal(query.childContinuation.resumeCheckpointId, handle);
});
for (const phase of ['query', 'dialog']) for (const field of ['parentRunId', 'rootRunId', 'depth', 'permission']) {
    test(`child ${field} drift during ${phase} invalidates approval`, async () => {
        const f = childFixture(), pending = f.prepareChild(true);
        if (phase === 'dialog') { f.resolve(blocked()); await flush(); assert(f.w.pendingDurableRetry); }
        if (field === 'permission') f.child.taskContext.permissionMode = 'workspace_write';
        else if (field === 'depth') f.child.depth++;
        else f.child[field] = `changed-${field}`;
        if (phase === 'query') f.resolve(blocked());
        else f.w.settleDurableRetryConfirmation(true);
        assert.equal((await pending).proceed, false);
    });
}
test('unknown child result never obtains retry consent from the ordinary child continue action', async () => {
    const f = childFixture(), pending = f.prepareChild(false);
    f.resolve(blocked());
    assert.equal((await pending).proceed, false);
    assert.equal(f.w.pendingDurableRetry, undefined);
});
const dialogExports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(browser, 'nextmux-durable-retry-dialog.tsx'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React }
}).outputText, { exports: dialogExports, require: name => name.endsWith('.css') ? {} : name === '@theia/core/shared/react' ? require('react') : assert.fail(`Unexpected dialog dependency ${name}`) });
test('retry dialog defaults to Cancel; Escape and backdrop only cancel', () => {
    let cancelled = 0, confirmed = 0, prevented = 0, stopped = 0;
    const tree = dialogExports.NextMuxDurableRetryDialog({ locale: 'zh-CN', onCancel: () => cancelled++, onConfirm: () => confirmed++, onKeyDown() {} });
    const section = tree.props.children, footer = section.props.children[2], buttons = footer.props.children;
    assert.equal(buttons[0].props.autoFocus, true);
    assert.equal(buttons[1].props.autoFocus, undefined);
    section.props.onKeyDown({ key: 'Escape', preventDefault() { prevented++; }, stopPropagation() { stopped++; } });
    tree.props.onMouseDown();
    assert.equal(cancelled, 2); assert.equal(confirmed, 0); assert.equal(prevented, 1); assert.equal(stopped, 1);
    section.props.onMouseDown({ stopPropagation() { stopped++; } });
    assert.equal(cancelled, 2);
});
