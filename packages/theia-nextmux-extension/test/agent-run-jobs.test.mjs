import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const protocol = readFileSync(fileURLToPath(new URL('../src/common/nextmux-platform-protocol.ts', import.meta.url)), 'utf8');
const service = readFileSync(fileURLToPath(new URL('../src/node/nextmux-platform-service.ts', import.meta.url)), 'utf8');
const widget = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');
const productionStyle = readFileSync(fileURLToPath(new URL('../src/browser/style/nextmux-desktop-production.css', import.meta.url)), 'utf8');

test('desktop agent jobs have bounded lifecycle and incremental snapshots', () => {
  assert.match(protocol, /DesktopAgentRunFailureKind/);
  assert.match(protocol, /'model_timeout'/);
  assert.match(protocol, /'rate_limited'/);
  assert.match(protocol, /'model_unavailable'/);
  assert.match(protocol, /'tool_failed'/);
  assert.match(protocol, /'waiting_user'/);
  assert.match(protocol, /readonly status: AgentRunStatus/);
  assert.match(protocol, /readonly stopReason: AgentRunStopReason/);
  assert.match(protocol, /readonly stopReason: AgentRunStopReason/);
  assert.match(protocol, /\| 'paused'/);
  assert.match(protocol, /startAgentRun\(request: DesktopAgentRunRequest\)/);
  assert.match(protocol, /getAgentRunSnapshot\(runId: string, afterEventIndex\?: number, waitMs\?: number/);
  assert.match(protocol, /getAgentDelegationLedger\(rootRunId: string, conversationId: string\)/);
  assert.match(protocol, /cancelAgentRun\(runId: string/);
  assert.match(protocol, /sendAgentRunMessage\(runId: string, message: string\)/);
  assert.match(service, /const AGENT_JOB_TTL_MS = 30 \* 60 \* 1_000/);
  assert.match(service, /const AGENT_JOB_MAX_ENTRIES = 96/);
  assert.match(service, /const AGENT_JOB_MAX_EVENTS = 4_096/);
  assert.match(service, /const AGENT_JOB_MAX_EVENT_CHARACTERS = 4 \* 1024 \* 1024/);
  assert.match(service, /events: eventSnapshot\.events/);
  assert.match(service, /firstEventIndex: eventSnapshot\.firstEventIndex/);
  assert.match(service, /nextEventIndex: eventSnapshot\.nextEventIndex/);
  assert.match(service, /current\.status !== 'running'/);
  const eventSink = service.slice(service.indexOf('onEvent: event => {'), service.indexOf('onDelegationLifecycle: lifecycle => {'));
  assert.doesNotMatch(eventSink, /current\.cancelRequested/,
    'already-produced lifecycle events must survive the cancellation unwind');
  assert.match(service, /const AGENT_JOB_MAX_PENDING_MESSAGES = 24/);
  assert.match(service, /const AGENT_JOB_MAX_PENDING_CHARACTERS = 80_000/);
  assert.match(service, /pendingMessages: job\.pendingMessages\.map/);
  assert.match(service, /type: 'steering_accepted'/);
  assert.match(service, /takeSteeringMessages/);
  assert.match(service, /new AgentEventBuffer<AgentRunEvent>/);
  assert.match(service, /waitForChange\(afterEventIndex, waitMs/);
  assert.match(service, /new AgentRunJournalStore\(join\(this\.nextmuxDataRoot\(\), 'agent-run-journal-v1'\)\)/);
  assert.match(service, /(?:onCheckpoint|onDurableCheckpoint):[\s\S]{0,240}saveAgentJobRecoveryCheckpoint/);
  assert.match(service, /if \(!current\.shutdownInterrupted\)[\s\S]{0,180}clearAgentJobRecovery/,
    'normal completion and explicit user cancellation must acknowledge and remove the restart journal');
  assert.match(service, /job\.shutdownInterrupted = true;[\s\S]{0,180}markAgentJobInterrupted/,
    'connection shutdown must retain an interrupted journal instead of looking like user cancellation');
  assert.match(service, /recoveredAgentJobSnapshot\(normalized\)/);
  assert.match(service, /initializeAgentDelegationLedger\(/);
  assert.match(service, /saveDelegationLedger\(/);
  assert.match(service, /delegationLedgerPersistenceBlocked/);
  assert.match(service, /recordAgentDelegationUsage\(current, result\)/,
    'the root result must be persisted as the single inclusive delegation aggregate');
  assert.match(service, /if \(job\.childRunId \|\| !job\.delegationLedger/,
    'child continuations must not overwrite the root aggregate');
  assert.match(service, /delegationLedger: job\.delegationLedger/);
  assert.match(service, /this\.wakeAgentJob\(current\)/);
  assert.match(service, /terminalAgentStatus/);
  assert.match(service, /retryable: true, resumable: true/);
  assert.match(service, /responseRetryAfterMs\(response, payload\)/);
  assert.match(service, /status === 429 \|\| signal\.rateLimited \|\| modelFailure\?\.category === 'rate_limit'/);
  const delegationStart = service.indexOf('new AgentDelegationRuntime({');
  const delegationEnd = service.indexOf('}).register();', delegationStart);
  assert.ok(delegationStart >= 0 && delegationEnd > delegationStart, 'desktop delegation registration must remain discoverable');
  const delegation = service.slice(delegationStart, delegationEnd);
  assert.match(delegation, /tokenBudget,\s*[\r\n]+\s*taskContext/,
    'desktop-created child agents must inherit the current bounded token budget');
});

test('terminal agent failures keep a stable user-facing category', () => {
  assert.match(service, /normalizedCode === 'TIMEOUT'/);
  assert.match(service, /kind: 'model_timeout'/);
  assert.match(service, /kind: 'rate_limited'/);
  assert.match(service, /kind: 'model_unavailable'/);
  assert.match(service, /kind: 'model_auth'/);
  assert.match(service, /kind: 'tool_failed'/);
  assert.match(service, /kind: 'waiting_user'/);
});

test('terminal agent failures persist the activity trace and stable failure data', () => {
  assert.match(widget, /events: (?:this|run)\.liveAgentEvents/);
  assert.match(widget, /completedAt: Date\.now\(\)/);
  assert.match(widget, /terminalFailure \? \{[\s\S]{0,180}failure: terminalFailure/);
  assert.match(widget, /terminalFailure\.resumeCheckpointId[\s\S]{0,160}resumeCheckpointId: terminalFailure\.resumeCheckpointId/);
  assert.match(widget, /snapshot\.status !== 'completed' && snapshot\.status !== 'limit_reached'[\s\S]{0,160}snapshot\.status !== 'paused'/);
  assert.match(widget, /!agentPauseBlocksAutomaticDispatch\(turn\.stopReason\)/);
  assert.match(widget, /agentStartController.*ConversationAgentRun\['agentStartController'\]/);
  assert.match(widget, /(?:this|run)\.agentStartController\?\.abort\(\)/);
  assert.match(widget, /if \(runId\)[\s\S]{0,60}await this\.platformService\.cancelAgentRun\(runId\)/);
  assert.match(widget, /!(?:this|run)\.activeAgentRunId/);
});

test('cancelling a desktop task aborts both direct and managed network calls', () => {
  assert.match(service, /job\.controller\.abort\((?:reason)?\)/);
  assert.match(service, /modelRequest\.signal/);
  assert.match(service, /completeManagedGateway\([\s\S]*?modelRequest\.signal/);
  assert.match(service, /signal\?: AbortSignal/);
  assert.match(service, /options\.signal\?\.addEventListener\('abort', abortFromCaller/);
  assert.match(service, /PlatformRequestError\('CANCELLED', '任务已取消'\)/);
});

test('managed gateway requests forward document attachment capability', () => {
  const gatewayCall = service.indexOf('const gateway = await this.completeManagedGatewayWithEvents(');
  const blockStart = service.indexOf('requiredCapabilities: [', gatewayCall);
  const managedCapabilityBlock = service.slice(
    blockStart,
    service.indexOf("...(request.workbench", blockStart)
  );
  assert.match(managedCapabilityBlock, /attachment\.kind === 'file'/);
  assert.match(managedCapabilityBlock, /\['files'\]/);
});

test('cancellation waits for runtime unwinding so its resumable checkpoint is not discarded', () => {
  const thenStart = service.search(/\}\)+\.then\(result => \{/);
  const thenEnd = service.indexOf('}).catch(error => {', thenStart);
  assert.ok(thenStart >= 0 && thenEnd > thenStart, 'runtime completion handler must remain discoverable');
  const thenBlock = service.slice(thenStart, thenEnd);
  assert.match(thenBlock, /current\.status !== 'running'/);
  assert.match(thenBlock, /current\.result = \{ \.\.\.result, events: current\.events\.all\(\) \}/);
  assert.match(thenBlock, /current\.cancelRequested \? 'cancelled' : result\.status/);
  assert.match(service, /job\.cancelRequested = true;[\s\S]*?job\.controller\.abort\((?:reason)?\)/);
  assert.doesNotMatch(service, /job\.status = 'cancelled';[\s\S]{0,180}job\.controller\.abort\((?:reason)?\)/);
  const catchBlock = service.slice(thenEnd, service.indexOf('}).finally(() =>', thenEnd));
  assert.match(catchBlock, /if \(stableError\.resumeCheckpointId\) \{[\s\S]*?current\.error = stableError;/,
    'explicit cancellation of a durable operation must preserve stableError.resumeCheckpointId so clearAgentJobRecovery retains the checkpoint handle');
});

test('child-agent work is exposed as a bounded, conversation-scoped drawer surface', () => {
    assert.match(protocol, /DesktopAgentChildSnapshot/);
    assert.match(protocol, /readonly children: readonly DesktopAgentChildSnapshot\[\]/);
    assert.match(protocol, /readonly parentRunId: string/);
    assert.match(protocol, /readonly taskContext: AgentTaskContext/);
    assert.match(service, /children: Map<string, RunningAgentChild>/);
    assert.match(service, /applyAgentDelegationLifecycle/);
    assert.match(service, /agentChildSnapshots\(job\)/);
    assert.match(widget, /id='nmx-context-tab-browser'[\s\S]*aria-controls='nmx-context-panel-browser'/);
    assert.match(widget, /id='nmx-context-tab-files'[\s\S]*aria-controls='nmx-context-panel-files'/);
    assert.match(widget, /id='nmx-context-tab-agents'[\s\S]*aria-controls='nmx-context-panel-agents'/);
    assert.match(widget, /id='nmx-context-panel-browser'[\s\S]*role='tabpanel'/);
    assert.match(widget, /id='nmx-context-panel-files'[\s\S]*role='tabpanel'/);
    assert.match(widget, /id='nmx-context-panel-agents'[\s\S]*role='tabpanel'/);
    assert.match(widget, /session\?\.turns\.flatMap\(turn => \[\.\.\.\(turn\.childAgents \|\| \[\]\)\]\)/);
    assert.match(widget, /for \(const turn of session\.turns\)[\s\S]{0,360}merged\.set\(child\.childRunId, child\)/,
        'currentAgentChildren must aggregate subagents across all turns of the active conversation');
    assert.match(widget, /const liveChild = session && this\.activeAgentSessionId === session\.id && this\.activeAgentTurnId/,
        'a stale live child list must not leak into the newly selected conversation');
    assert.match(widget, /findAgentChild\(childRunId: string, owner\?: \{ readonly sessionId: string; readonly turnId\?: string \}\)/);
    assert.match(widget, /findAgentChild\(state\.childRunId, \{ sessionId: state\.sessionId, turnId: state\.turnId \}\)/);
    assert.match(widget, /const liveSessionId = owner\?\.sessionId \|\| this\.activeCodingSessionId/);
    assert.doesNotMatch(widget, /if \(active\.childRunId !== this\.activeAgentChildId\) this\.activeAgentChildId = active\.childRunId/);
    assert.match(widget, /onScroll=\{event => this\.onAgentChildDetailScroll\(activeChildId/);
    assert.match(widget, /scheduleAgentChildScrollSync\(\)/);
    assert.match(widget, /agentChildScrollStates/);
    assert.match(widget, /nmx-agent-child-new-events/);
    assert.doesNotMatch(widget, /nmx-browser-open-agents/);
    assert.match(widget, /onClick=\{\(\) => this\.showAgentWorkContext\(\)\}/);
    assert.match(widget, /nmx-agent-open-browser/);
    assert.match(widget, /onClick=\{\(\) => this\.showBrowserWorkContext\(\)\}/);
    assert.match(widget, /target\.kind === 'file' \? void this\.openToolFileActivity\(target\.summary\) : this\.openToolBrowserActivity\(target\.summary\)/);
    assert.match(widget, /openToolBrowserActivity/);
    const browserCapture = widget.slice(widget.indexOf('protected captureAgentBrowsers'), widget.indexOf('protected syncSiteBrowsers'));
    assert.match(browserCapture, /isBrowserNavigationToolName\(event\.toolName\)/);
    assert.doesNotMatch(browserCapture, /browser\|site\|preview\|playwright\|web\/i/,
        'generic web tools must not promote arbitrary result URLs into browser tabs');
});

test('child-agent continuation keeps its opaque checkpoint and private task context', () => {
    assert.match(protocol, /DesktopAgentChildContinuation/);
    assert.match(protocol, /readonly childContinuation\?: DesktopAgentChildContinuation/);
    assert.match(protocol, /readonly resumeCheckpointId: string/);
    assert.match(service, /scope: 'child'/);
    assert.match(service, /stored\.checkpoint\.runId !== childContinuation\.childRunId/);
    assert.match(service, /storedContext\.parentRunId !== childContinuation\.parentRunId/);
    assert.match(service, /storedContext\.rootRunId !== childContinuation\.rootRunId/);
    assert.match(service, /!request\.conversationId/);
    const dispatchStart = service.indexOf('result = await backend.run({');
    assert.notEqual(dispatchStart, -1);
    const dispatchSource = service.slice(dispatchStart);
    const preferredBackendExpression = dispatchSource.match(/preferredBackendId: (.+),\n\s*allowBackendFallback:/)?.[1];
    assert.ok(preferredBackendExpression, 'the dispatch selects a backend before deciding fallback');
    const selectBackend = Function('childContinuation', 'request', 'BUILTIN_AGENT_BACKEND_ID', 'backendConfiguration',
        `return ${preferredBackendExpression};`);
    assert.equal(selectBackend({ childRunId: 'child' }, {}, 'builtin', { preferredBackendId: 'external' }), 'builtin',
        'children remain pinned to the builtin runtime even when other dispatch modes share that restriction');
    const allowlistExpression = dispatchSource.match(/allowedToolNames: ([\s\S]+?),\n\s*captureCheckpoint: Boolean\(childContinuation\)/)?.[1];
    assert.ok(allowlistExpression, 'the dispatch supplies its tool policy alongside checkpoint capture');
    const selectAllowlist = Function('request', 'externalUnscoped', 'childContinuation', 'taskContext', 'tools', 'effectivePermissionMode', 'execution', 'conversationRun',
        `return ${allowlistExpression};`);
    const savedTools = ['workspace.read_file'];
    assert.deepEqual(selectAllowlist({}, false, { childRunId: 'child' }, { allowedToolNames: savedTools }), savedTools,
        'children retain their saved allowlist without acquiring the current root registry');
    // Only a root coding conversation is re-run when a wakeup fires and can hold a /goal.
    const registry = { descriptors: () => [{ name: 'workspace.read_file' }] };
    assert.deepEqual(selectAllowlist({}, false, undefined, {}, registry, 'workspace_write', {}, true),
        ['workspace.read_file', 'task.update_plan', 'task.schedule_wakeup', 'task.update_goal']);
    assert.deepEqual(selectAllowlist({}, false, undefined, {}, registry, 'workspace_write', {}, false), ['workspace.read_file', 'task.update_plan']);
    assert.match(service, /const conversationRun = request\.workbench === 'coding' && request\.toolScope === undefined && !childContinuation;/);
    assert.match(service, /conversationWakeups: conversationRun,/);
    assert.match(service, /const hasMcpPolicy = \(await this\.mcpServerManager\.getServerNames\(\)\)\.length > 0/,
        'configured but unstarted or unapproved MCP servers still create a policy boundary');
    assert.match(service, /const externalUnscoped = effectivePermissionMode === 'full_access' && !childContinuation && !request\.skills\?\.length && !resumeCheckpoint\?\.toolPolicy && !hasMcpPolicy/,
        'the legacy unscoped ACP exception cannot consume a child, Skill, scoped checkpoint, MCP grant or restricted mode');
    assert.match(service, /tools\.descriptors\(effectivePermissionMode\)\.map\(tool => tool\.name\), 'task\.update_plan'/,
        'root allowlists come from the actual permission-filtered host registry, not model-provided names');
    assert.match(service, /captureCheckpoint: Boolean\(childContinuation\)/);
    const serviceFile = ts.createSourceFile('service.ts', service, ts.ScriptTarget.Latest, true);
    let registration;
    const findRegistration = node => {
      if (ts.isIfStatement(node) && ts.isExpressionStatement(node.thenStatement)) {
        const call = node.thenStatement.expression;
        if (ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression)
          && call.expression.name.text === 'registerConversationTools') registration = node;
      }
      ts.forEachChild(node, findRegistration);
    };
    findRegistration(serviceFile);
    assert.ok(registration, 'conversation tool registration must remain conditional');
    const dispatch = Function('childContinuation', 'tools', 'workspaceRoot', 'request', 'effectivePermissionMode', 'execution',
      ts.transpile(registration.getText(serviceFile), { removeComments: true, target: ts.ScriptTarget.ES2022 }));
    const calls = [], tools = {}, owner = { registerConversationTools: (...args) => calls.push(args) };
    const req = { workbench: 'coding' }, exec = { signal: undefined };
    dispatch.call(owner, { childRunId: 'child' }, tools, '/project', req, 'workspace_write', exec);
    assert.deepEqual(calls, [], 'a child cannot register root conversation tools');
    dispatch.call(owner, undefined, tools, '/project', req, 'workspace_write', exec);
    assert.deepEqual(calls, [[tools, '/project', { request: req, permissionMode: 'workspace_write', signal: undefined }]], 'creation tools receive the owning root workspace');
    assert.match(widget, /resumeCheckpointId: checkpointId/);
    assert.match(widget, /continueAgentChild\(activeChildId\)/);
    assert.match(widget, /data-agent-child-composer=/);
    assert.match(widget, /Always cancel that backend job on the error path/);
});

test('child receipts remain visible and distinguish safe continuation from unknown side effects', () => {
    assert.match(protocol, /readonly receipt\?: AgentChildReceipt/);
    assert.match(widget, /const receipt = active\.receipt \|\| active\.result\?\.receipt/);
    assert.match(widget, /data-agent-child-receipt=\{receipt\.outcome\}/);
    assert.match(widget, /receipt\.unknownSideEffect \|\| !receipt\.retrySafe/);
    assert.match(widget, /agentChildReceiptOutcomeLabel\(receipt\)/);
    assert.match(productionStyle, /\.nmx-shell \.nmx-agent-child-receipt \{/);
    assert.match(productionStyle, /\.nmx-shell \.nmx-agent-child-receipt\.is-unknown/);
});

