import { runtimeFinalText } from '../lib/browser/nextmux-agent-outcome-locale.js';
import { desktopStatus } from '../lib/common/nextmux-desktop-status.js';
import { domainMessageFromError, DesktopDomainError } from '../lib/common/nextmux-domain-errors.js';
import { desktopDomainMessage, desktopDomainErrorText } from '../lib/browser/nextmux-domain-error-locale.js';
import { declaredReasoningSettings } from '../lib/common/nextmux-model-controls.js';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const { localScheduleDateTime, scheduledOccurrenceDue, scheduledTaskNeedsAttention, validScheduleTime } = require('../lib/common/nextmux-schedule');
const { claimScheduledOccurrence } = require('../lib/node/nextmux-schedule-claims');
const { updateScheduledTaskStore } = require('../lib/node/nextmux-schedule-store');
const { windowsScheduledTaskXml } = require('../lib/node/nextmux-schedule-system');
const { codingSidebarProjects } = require('../lib/browser/nextmux-sidebar-projects');
const URI = require('@theia/core/lib/common/uri').default;
const { FileType } = require('@theia/filesystem/lib/common/files');
const { DiskFileSystemProvider } = require('@theia/filesystem/lib/node/disk-file-system-provider');
const task = patch => ({ id: randomUUID(), title: 'Check project', prompt: 'Check the project', workspacePath: '/project',
  cadence: 'daily', runAt: '09:00', createdAt: new Date(2026, 8, 1).getTime(), enabled: true, ...patch });
const at = (day, hour, minute = 0) => new Date(2026, 8, day, hour, minute).getTime();

test('local datetime input does not round-trip through UTC and invalid dates/times are rejected', () => {
  assert.equal(localScheduleDateTime(at(19, 9, 12)), '2026-09-19T09:12');
  for (const value of ['2026-02-30T12:00', '2026-09-19T25:00', '2026-09-19T12:75', 'bad']) assert.equal(validScheduleTime('once', value), false);
  assert.equal(validScheduleTime('once', '2026-09-19T12:30'), true);
  assert.equal(validScheduleTime('daily', '24:00'), false);
  assert.equal(validScheduleTime('daily', '09:30'), true);
});
test('sleep spanning days coalesces to the latest missed occurrence, including before today\'s time', () => {
  const plan = task({ lastOccurrenceAt: at(10, 9) });
  assert.equal(scheduledOccurrenceDue(plan, at(19, 8)), at(18, 9));
  assert.equal(scheduledOccurrenceDue(plan, at(19, 10)), at(19, 9));
  assert.equal(scheduledOccurrenceDue({ ...plan, lastOccurrenceAt: at(19, 9) }, at(19, 10)), undefined);
  assert.equal(scheduledOccurrenceDue({ ...plan, lastStatus: 'running' }, at(19, 10)), undefined);
});
test('weekly is Monday, never Tuesday; a missed week has at most one catch-up', () => {
  const plan = task({ cadence: 'weekly' });
  assert.equal(scheduledOccurrenceDue(plan, at(21, 8)), at(14, 9));
  assert.equal(scheduledOccurrenceDue(plan, at(21, 9)), at(21, 9));
  assert.equal(scheduledOccurrenceDue({ ...plan, createdAt: at(21, 8) }, at(21, 8)), undefined);
});
test('once, disabled plans and legacy lastRunAt cannot be replayed', () => {
  const plan = task({ cadence: 'once', runAt: '2026-09-19T09:00' });
  assert.equal(scheduledOccurrenceDue(plan, at(19, 8)), undefined);
  assert.equal(scheduledOccurrenceDue(plan, at(19, 10)), at(19, 9));
  assert.equal(scheduledOccurrenceDue({ ...plan, lastRunAt: at(19, 9) }, at(20, 10)), undefined);
  assert.equal(scheduledOccurrenceDue({ ...plan, enabled: false }, at(20, 10)), undefined);
});
test('durable occurrence claim serializes concurrent windows and survives restart with bounded per-task state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nm-schedule-claim-'));
  try {
    const id = randomUUID(), due = Date.now() - 60_000;
    const result = await Promise.all(Array.from({ length: 16 }, () => claimScheduledOccurrence(root, id, due)));
    assert.equal(result.filter(Boolean).length, 1);
    assert.equal(await claimScheduledOccurrence(root, id, due), false);
    assert.equal(await claimScheduledOccurrence(root, id, due - 1), false);
    assert.equal(await claimScheduledOccurrence(root, id, due + 1), true);
    await writeFile(join(root, `${id}.json`), '{broken');
    await assert.rejects(claimScheduledOccurrence(root, id, due + 2));
    assert.equal(await readFile(join(root, `${id}.json`), 'utf8'), '{broken');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('native plan store survives a fresh browser origin, merges windows and never resurrects deleted legacy plans', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nm-schedule-store-'));
  try {
    const first = task(), second = task();
    assert.equal((await updateScheduledTaskStore(root, undefined, [first]))[0].id, first.id);
    await Promise.all([updateScheduledTaskStore(root, { upsert: [{ ...first, title: 'Updated' }], remove: [] }),
      updateScheduledTaskStore(root, { upsert: [second], remove: [] })]);
    const reopened = await updateScheduledTaskStore(root);
    assert.equal(reopened.length, 2); assert.equal(reopened.find(item => item.id === first.id).title, 'Updated');
    await updateScheduledTaskStore(root, { upsert: [], remove: [first.id] });
    assert.equal((await updateScheduledTaskStore(root, undefined, [first])).some(item => item.id === first.id), false);
    await writeFile(join(root, 'tasks.json'), '{corrupt');
    await assert.rejects(updateScheduledTaskStore(root, { upsert: [first], remove: [] }));
    assert.equal(await readFile(join(root, 'tasks.json'), 'utf8'), '{corrupt');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('Windows native schedule has unambiguous local ISO dates, sleep catch-up, Monday and no artificial run limit', () => {
  const xml = windowsScheduledTaskXml({ taskId: randomUUID(), cadence: 'weekly', runAt: '09:00', enabled: true }, 'C:\\A&B\\NextMux.exe', at(19, 12));
  assert.match(xml, /2026-09-19T09:00:00/); assert.match(xml, /<Monday\/>/);
  assert.match(xml, /<StartWhenAvailable>true/); assert.match(xml, /<MultipleInstancesPolicy>IgnoreNew/);
  assert.match(xml, /<ExecutionTimeLimit>PT0S/); assert.match(xml, /A&amp;B/);
});

const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const klass = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const names = ['scheduledTaskWorkspaceOptions', 'scheduleModelRoutes', 'selectedScheduleModelRoute', 'saveScheduledTask', 'scheduleRouteModelLabel', 'scheduledTaskDueAt', 'executeScheduledTask', 'pollScheduledAgentRun', 'runDueScheduledTasks', 'scheduledTaskSession',
  'normalizedModelId', 'modelKeyForOffering', 'modelKeyForConnection', 'modelKeyForRoute', 'modelReasoningContract'];
const methods = names.map(name => klass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name).getText(file));
const { AgentQuestionController } = require('../lib/browser/nextmux-agent-question');
const { stableUuid } = require('../lib/common/nextmux-stable-id');
const { officialConnectionRelayKey, managedRelayKey } = require('../lib/browser/nextmux-model-route-selection');
const Harness = new Function('runtimeFinalText', 'DesktopDomainError', 'desktopStatus', 'domainMessageFromError', 'desktopDomainMessage', 'desktopDomainErrorText', 'declaredReasoningSettings', 'scheduledOccurrenceDue', 'validScheduleTime', 'bindPriceQuote', 'priceAuthorizationErrorCode', 'normalizeModelCitations', 'AgentQuestionController', 'mergeAgentEventPollSnapshot', 'window', 'codingSidebarProjects', 'URI', 'FileType', 'officialConnectionRelayKey', 'managedRelayKey', 'scheduledTaskNeedsAttention', 'stableUuid',
  ts.transpile(`class Harness { ${methods.join('\n')} }; return Harness;`, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }))(
    runtimeFinalText, DesktopDomainError, desktopStatus, domainMessageFromError, desktopDomainMessage, desktopDomainErrorText, declaredReasoningSettings, scheduledOccurrenceDue, validScheduleTime, value => value, () => false, value => value || [], AgentQuestionController,
    (events, cursor, snapshot) => ({ events: [...events, ...snapshot.events], cursor: snapshot.nextEventIndex }), { setTimeout }, codingSidebarProjects, URI, FileType, officialConnectionRelayKey, managedRelayKey, scheduledTaskNeedsAttention, stableUuid);
function harness(plans = []) {
  const value = new Harness(), requests = [], turns = new Map();
  const route = { id: 'official:test', kind: 'official_connection', connection: { id: 'test', model: 'chosen', modelFamily: 'Chosen', providerName: 'Test' } };
  Object.assign(value, { desktopLocale: 'zh-CN', scheduledTasks: plans, scheduledTasksReady: true, scheduledTasksPersistence: Promise.resolve(),
    scheduledTasksPersistenceError: '', runningScheduledTaskIds: new Set(), scheduledAgentRuns: new Map(), pendingAgentSubmissions: new Set(), codingSessions: [], codingHistoryProjects: [],
    fileService: { activateProvider: async () => ({ stat: async () => ({ type: FileType.Directory }) }) },
    scheduleDraft: { title: 'A plan', prompt: 'Run it', cadence: 'daily', runAt: '09:00', workspacePath: '/chosen', routeId: route.id, relayKey: 'official:test', contextWindowTokens: 32000, permissionMode: 'workspace_write', reasoningEffort: 'high' },
    workspaceOptions: [{ path: '/active', label: 'Active' }, { path: '/chosen', label: 'Chosen' }], activeWorkspaceRoot: '/active', activeModelRouteId: route.id,
    contextWindowTokens: 32000, permissionMode: 'workspace_write', defaultPermissionMode: 'full_access',
    allModelRoutes: () => [route], managedModelRoutes: () => [], scheduledTasksPersisted: new Map(), setProjectVisible() {}, syncSavedScheduledTasks: async () => {}, reasoningEffortLevels: () => ['high'], reasoningEffortForRoute: () => 'high', managedModelRoute: () => undefined,
    persistScheduledTasks() {}, persistCodingSessions() {}, flushConversationHistory: async () => {}, completeNavigationSurface() {}, update() {}, registerScheduledTask: async () => {},
    conversationHistoryReady: () => true, hydrateCodingSession: async id => value.codingSessions.find(item => item.id === id), codingConversationHistory: () => [],
    updateScheduledTask(id, patch) { value.scheduledTasks = value.scheduledTasks.map(item => item.id === id ? { ...item, ...patch } : item); },
    appendCodingTurn(session, prompt, permissionMode) { const turn = { id: randomUUID(), prompt, permissionMode }; turns.set(turn.id, turn); return turn; },
    updateCodingTurn(_session, id, patch) { turns.set(id, { ...turns.get(id), ...patch }); },
    prepareAgentSkills: async () => [], addNotification() {}, notifySystemTask() {}, codingSessionTitle: text => text, agentBillingLabel: () => '',
    platformService: { upsertDesktopScheduledTask: async task => ({ ...task, definitionRevision: 1 }), claimDesktopScheduledTaskRun: async () => ({ claimed: true }),
      startAgentRun: async request => { requests.push(request); return { runId: randomUUID() }; },
      getAgentRunSnapshot: async runId => ({ runId, status: 'completed', events: [{ type: 'run_completed' }], nextEventIndex: 1,
        result: { status: 'completed', finalText: 'Checked', events: [], route: { modelFamily: 'Chosen', providerName: 'Test' },
          usage: { inputTokens: 1, outputTokens: 1 }, billing: { kind: 'official' }, failoverCount: 0, changes: [], turns: 1, toolCalls: 1 } }),
      removeDesktopScheduledTask: async () => {}, cancelAgentRun: async () => {} }
  });
  return { value, requests, turns };
}
test('actual create method saves selected project and a stable model/context/permission snapshot', async () => {
  const { value } = harness(); await value.saveScheduledTask();
  assert.equal(value.scheduledTasks.length, 1);
  const plan = value.scheduledTasks[0]; assert.equal(plan.workspacePath, '/chosen');
  assert.equal(plan.modelRoute.connectionId, 'test'); assert.equal(plan.modelRoute.model, 'chosen');
  assert.equal(plan.contextWindowTokens, undefined, 'new plans discard legacy custom context caps'); assert.equal(plan.permissionMode, 'workspace_write');
  assert.equal(plan.reasoningEffort, 'high');
});
test('saving a plan cannot retain a reasoning selection after the API stops declaring it', async () => {
  const { value } = harness(); value.reasoningEffortLevels = () => [];
  await value.saveScheduledTask();
  assert.equal(value.scheduledTasks[0].reasoningEffort, undefined);
});
test('actual due path starts a background job with conversation ownership and saved settings, then records result', async () => {
  const plan = task({ cadence: 'once', runAt: localScheduleDateTime(Date.now() - 60_000), modelRoute: { kind: 'official_connection', connectionId: 'stored', model: 'chosen' },
    routeId: 'not-in-current-picker', contextWindowTokens: 16000, reasoningEffort: 'low', permissionMode: 'read_only' });
  const { value, requests, turns } = harness([plan]); await value.runDueScheduledTasks();
  assert.equal(requests.length, 1); assert.equal(requests[0].route.connectionId, 'stored');
  assert.equal(requests[0].contextWindowTokens, 16000); assert.equal(requests[0].reasoningEffort, 'low');
  assert.equal(requests[0].permissionMode, 'read_only'); assert.equal(requests[0].conversationId, value.codingSessions[0].id);
  assert.equal(value.scheduledTasks[0].enabled, false); assert.equal(value.scheduledTasks[0].lastStatus, 'complete');
  assert.equal([...turns.values()][0].stage, 'complete'); assert.ok([...turns.values()][0].agentRootRunId);
  await value.runDueScheduledTasks(); assert.equal(requests.length, 1);
});
test('a restored recurring plan pauses when its selected directory moved, without a claim or repeated tick', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nm-schedule-moved-directory-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, 'project'), store = join(root, 'scheduled-tasks');
  await mkdir(workspace);
  const saved = task({ workspacePath: workspace, runAt: '00:00', createdAt: Date.now() - 86_400_000,
    routeId: 'official:test', modelRoute: { kind: 'official_connection', connectionId: 'test', model: 'chosen' } });
  await updateScheduledTaskStore(store, { upsert: [saved], remove: [] });
  await rm(workspace, { recursive: true });
  const provider = new DiskFileSystemProvider();
  let statCalls = 0, claims = 0;
  const openSavedPlan = async () => {
    const { value, requests } = harness(await updateScheduledTaskStore(store));
    let writes = Promise.resolve();
    value.fileService = { activateProvider: async () => ({ stat: async resource => {
      statCalls++;
      return provider.stat(resource);
    } }) };
    value.platformService.claimDesktopScheduledTaskRun = async () => { claims++; return { claimed: true }; };
    value.updateScheduledTask = (id, patch) => {
      value.scheduledTasks = value.scheduledTasks.map(item => item.id === id ? { ...item, ...patch } : item);
      const updated = value.scheduledTasks.find(item => item.id === id);
      writes = writes.then(() => updateScheduledTaskStore(store, { upsert: [updated], remove: [], runtimeOnly: true }));
      value.scheduledTasksPersistence = writes;
    };
    return { value, requests, flushed: () => writes };
  };
  const first = await openSavedPlan();
  await first.value.runDueScheduledTasks(); await first.flushed();
  assert.equal(first.requests.length, 0, 'missing directory never reaches the model');
  assert.equal(claims, 0, 'missing directory never consumes its due occurrence');
  const paused = (await updateScheduledTaskStore(store))[0];
  assert.equal(paused.enabled, false, 'an unavailable project needs explicit attention');
  assert.equal(paused.lastStatus, 'error');
  assert.equal(paused.lastMessageDescriptor.code, 'SCHEDULE_WORKSPACE_UNAVAILABLE');
  await updateScheduledTaskStore(store, { upsert: [{ ...paused, lastAttemptAt: Date.now() - 61_000 }], remove: [], runtimeOnly: true });
  const restarted = await openSavedPlan();
  await restarted.value.runDueScheduledTasks(); await restarted.flushed();
  assert.equal(statCalls, 1, 'a restart and next tick do not retry a paused plan');
  await mkdir(workspace);
  const restored = (await updateScheduledTaskStore(store))[0];
  await updateScheduledTaskStore(store, { upsert: [{ ...restored, enabled: true }], remove: [], runtimeOnly: true });
  const resumed = await openSavedPlan();
  await resumed.value.runDueScheduledTasks(); await resumed.flushed();
  assert.equal(resumed.requests.length, 1, 'the selected directory can be used after explicit resume');
  assert.equal(claims, 1);
});
test('actual dispatcher defers unloaded history, and competing timers never exceed two active launches', async () => {
  const plans = Array.from({ length: 5 }, () => task({ cadence: 'once', runAt: localScheduleDateTime(Date.now() - 60_000), routeId: 'official:test' }));
  const { value, requests } = harness(plans);
  value.conversationHistoryReady = () => false; await value.runDueScheduledTasks(); assert.equal(requests.length, 0);
  value.conversationHistoryReady = () => true;
  let release; const gate = new Promise(resolve => { release = resolve; });
  const snapshot = value.platformService.getAgentRunSnapshot;
  value.platformService.getAgentRunSnapshot = async (...args) => { await gate; return snapshot(...args); };
  const first = value.runDueScheduledTasks();
  await new Promise(resolve => setTimeout(resolve, 10)); await value.runDueScheduledTasks();
  assert.equal(requests.length, 2); assert.equal(value.runningScheduledTaskIds.size, 2);
  release(); await first; assert.equal(value.runningScheduledTaskIds.size, 0);
});
test('unavailable saved routes do not consume a once plan or starve other due plans', async () => {
  const invalid = Array.from({ length: 2 }, () => task({ cadence: 'once', runAt: localScheduleDateTime(Date.now() - 120_000), routeId: 'missing' }));
  const valid = task({ cadence: 'once', runAt: localScheduleDateTime(Date.now() - 60_000), routeId: 'official:test' });
  const { value, requests } = harness([...invalid, valid]); let claims = 0;
  value.platformService.claimDesktopScheduledTaskRun = async () => { claims++; return { claimed: true }; };
  await value.runDueScheduledTasks(); assert.equal(claims, 0); assert.equal(requests.length, 0);
  assert.equal(value.scheduledTasks[0].enabled, false); assert.equal(value.scheduledTasks[0].lastOccurrenceAt, undefined);
  await value.runDueScheduledTasks(); assert.equal(claims, 1); assert.equal(requests.length, 1);
});
test('a recorded uncertain launch never becomes success or silently remains waiting after restart', async () => {
  const plan = task({ cadence: 'once', runAt: localScheduleDateTime(Date.now() - 60_000), routeId: 'official:test' });
  const { value, requests } = harness([plan]); value.platformService.claimDesktopScheduledTaskRun = async () => ({ claimed: false });
  await value.runDueScheduledTasks(); assert.equal(requests.length, 0);
  assert.equal(value.scheduledTasks[0].lastStatus, 'error'); assert.equal(value.scheduledTasks[0].enabled, false);
  assert.equal(value.scheduledTasks[0].lastMessageDescriptor.code, 'SCHEDULE_ALREADY_CLAIMED');
});
test('background scheduled questions and permission requests remain bound to their conversation and persist activity', async () => {
  const { value, turns } = harness();
  const id = 'scheduled-run', session = 'scheduled-session', turn = 'scheduled-turn';
  let release, count = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const completed = value.platformService.getAgentRunSnapshot;
  const question = { runId: id, taskId: session, questionId: 'permission-one', kind: 'permission',
    expiresAt: new Date(Date.now() + 60_000).toISOString(), options: [{ id: 'allow', label: 'Allow once' }] };
  value.platformService.getAgentRunSnapshot = async () => {
    if (++count === 1) return { runId: id, status: 'running', pendingQuestion: question,
      events: [{ type: 'user_input_requested', question }], nextEventIndex: 1 };
    await gate; return completed(id);
  };
  const running = value.pollScheduledAgentRun(id, session, turn);
  await new Promise(resolve => setTimeout(resolve, 10));
  const controller = value.scheduledAgentRuns.get(session).questions;
  assert.equal(controller.visible(id, session), question);
  assert.equal(controller.visible(id, 'different-conversation'), undefined);
  assert.equal(turns.get(turn).events[0].type, 'user_input_requested');
  release(); await running;
  assert.equal(controller.visible(id, session), undefined);
});
