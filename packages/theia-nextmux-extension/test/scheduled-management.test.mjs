import assert from 'node:assert/strict';
import { mkdtemp, mkdir, stat, realpath, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const { AgentToolRegistry } = require('@nextmux/agent-runtime');
const { registerScheduleTools } = require('../lib/node/nextmux-schedule-tools');
const { updateScheduledTaskStore } = require('../lib/node/nextmux-schedule-store');
const { validScheduleTime, scheduledTaskNeedsAttention } = require('../lib/common/nextmux-schedule');
const { normalizeContextWindowTokens } = require('../lib/common/nextmux-context-budget');
const { scheduleDomainMessage } = require('../lib/common/nextmux-schedule-domain');
const { DesktopDomainError } = require('../lib/common/nextmux-domain-errors');
const { desktopDomainErrorText } = require('../lib/browser/nextmux-domain-error-locale');
const modelControlsModule = { exports: {} };
new Function('exports', 'require', ts.transpile(readFileSync(new URL('../src/common/nextmux-model-controls.ts', import.meta.url), 'utf8'),
  { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }))(modelControlsModule.exports, require);
const { declaredReasoningSettings } = modelControlsModule.exports;
const source = ts.createSourceFile('service.ts', readFileSync(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const klass = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxPlatformServiceImpl');
const method = klass.members.find(node => node.name?.getText(source) === 'upsertDesktopScheduledTask').getText(source);
class PlatformRequestError extends Error { constructor(code, message) { super(message); this.code = code; } }
const deps = { isAbsolute, realpath, stat, validScheduleTime, PlatformRequestError, scheduleDomainMessage, normalizeContextWindowTokens, updateScheduledTaskStore, join };
const Service = new Function(...Object.keys(deps), ts.transpile(`class Service { ${method} }; return Service`, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }))(...Object.values(deps));
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'nm-schedule-management-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, 'project'); await mkdir(workspace);
  const other = join(root, 'other'); await mkdir(other);
  const registrations = [], store = join(root, 'scheduled-tasks');
  const service = Object.assign(new Service(), { nextmuxDataRoot: () => root,
    loadDesktopScheduledTasks: () => updateScheduledTaskStore(store),
    registerDesktopScheduledTask: async input => { registrations.push(input); return { registered: false, mode: 'app_open', message: 'App open' }; },
    removeDesktopScheduledTask: async id => { registrations.push({ removed: id }); }
  });
  const defaults = { modelRoute: { kind: 'official_connection', connectionId: 'key-a', model: 'chosen-model' },
    modelLabel: 'chosen-model', routeId: 'official:key-a:chosen-model', relayKey: 'official:key-a', modelId: 'chosen-model',
    permissionMode: 'workspace_write', reasoningEffort: 'high', contextWindowTokens: 32000 };
  const registry = new AgentToolRegistry();
  registerScheduleTools(registry, { workspaceRoot: workspace, conversationId: 'owner-conversation', defaults,
    load: () => service.loadDesktopScheduledTasks(), save: (task, revision) => service.upsertDesktopScheduledTask(task, revision),
    remove: id => updateScheduledTaskStore(store, { upsert: [], remove: [id] }) });
  const call = (name, args = {}, permission = 'workspace_write') => registry.execute({ id: randomUUID(), name, arguments: args }, permission, { runId: 'schedule-tool-test' });
  const draft = patch => ({ ...defaults, id: randomUUID(), workspacePath: workspace, title: 'Daily check', prompt: 'Check project', cadence: 'daily', runAt: '09:00', enabled: true, createdAt: Date.now(), lastStatus: 'idle', ...patch });
  return { root, workspace, other, store, service, registry, call, draft, registrations };
}

test('manual and model paths share validated save, independent model settings, project ownership and native registration', async t => {
  const f = await fixture(t);
  const manual = await f.service.upsertDesktopScheduledTask(f.draft({ workspacePath: f.other }), 0);
  assert.equal(manual.workspacePath, await realpath(f.other)); assert.equal(manual.definitionRevision, 1);
  const result = await f.call('nextmux.update_schedule', { action: 'create', idempotencyKey: 'daily-new', title: 'Model plan', prompt: 'Inspect', cadence: 'daily', runAt: '10:00', permissionMode: 'full_access' });
  assert.equal(result.ok, true, JSON.stringify(result));
  const model = JSON.parse(result.output);
  assert.equal(model.workspacePath, await realpath(f.workspace)); assert.equal(model.permissionMode, 'workspace_write');
  assert.equal(model.contextWindowTokens, 32000); assert.equal(model.model, 'chosen-model');
  const saved = (await f.service.loadDesktopScheduledTasks()).find(task => task.id === model.id);
  assert.equal(saved.originConversationId, 'owner-conversation'); assert.equal(saved.modelRoute.connectionId, 'key-a');
  assert.equal(f.registrations.length, 2);
  const listed = await f.call('nextmux.list_schedules', {}, 'read_only');
  assert.deepEqual(JSON.parse(listed.output).tasks.map(task => task.id), [model.id]);
  assert.equal((await f.call('nextmux.update_schedule', { action: 'update', id: manual.id, title: 'Foreign edit' })).ok, false);
  assert.equal((await f.call('nextmux.update_schedule', { action: 'update', id: model.id, title: 'Readonly edit' }, 'read_only')).ok, false);
});

test('tool retries create exactly one task and cannot reuse the key for another prompt', async t => {
  const f = await fixture(t);
  const args = { action: 'create', idempotencyKey: 'once-only', title: 'One', prompt: 'Inspect', cadence: 'daily', runAt: '09:00' };
  const first = await f.call('nextmux.update_schedule', args), retry = await f.call('nextmux.update_schedule', args);
  assert.equal(first.ok, true); assert.equal(retry.ok, true);
  assert.equal(JSON.parse(first.output).id, JSON.parse(retry.output).id); assert.equal(JSON.parse(retry.output).idempotent, true);
  assert.equal(f.registrations.length, 1);
  assert.equal((await f.call('nextmux.update_schedule', { ...args, prompt: 'Different request' })).error.code, 'SCHEDULE_IDEMPOTENCY_CONFLICT');
});

test('concurrent edits compare versions and stale runtime writers never overwrite or resurrect plans', async t => {
  const f = await fixture(t), first = await f.service.upsertDesktopScheduledTask(f.draft(), 0);
  const results = await Promise.allSettled([
    f.service.upsertDesktopScheduledTask({ ...first, title: 'Editor A' }, 1),
    f.service.upsertDesktopScheduledTask({ ...first, title: 'Editor B' }, 1)
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const latest = (await f.service.loadDesktopScheduledTasks())[0]; assert.equal(latest.definitionRevision, 2);
  await updateScheduledTaskStore(f.store, { upsert: [{ ...first, title: 'Old runtime', enabled: true }], remove: [], runtimeOnly: true });
  assert.equal((await f.service.loadDesktopScheduledTasks())[0].title, latest.title);
  await updateScheduledTaskStore(f.store, { upsert: [], remove: [first.id] });
  await updateScheduledTaskStore(f.store, { upsert: [first], remove: [], runtimeOnly: true });
  assert.equal((await f.service.loadDesktopScheduledTasks()).length, 0);
});

test('invalid directories, missing route, past one-shot and missing permission are rejected before scheduler registration', async t => {
  const f = await fixture(t), file = join(f.root, 'file.txt'); await writeFile(file, 'not a directory');
  for (const patch of [{ workspacePath: file }, { workspacePath: join(f.root, 'missing') }, { modelRoute: undefined },
    { permissionMode: undefined }, { cadence: 'once', runAt: '2020-01-01T09:00' }]) {
    await assert.rejects(f.service.upsertDesktopScheduledTask(f.draft(patch), 0));
  }
  assert.equal(f.registrations.length, 0); assert.equal((await f.service.loadDesktopScheduledTasks()).length, 0);
});

test('permanent configuration/balance failures pause while transport failures remain retryable', () => {
  for (const error of [{ code: 'INSUFFICIENT_BALANCE' }, { code: 'PRICE_QUOTE_CHANGED' }, { code: 'CREDENTIAL_INVALID' },
    { code: 'ENOENT' }, { code: 'PERMISSION_DENIED' }, { status: 401 }, new Error('模型线路不可用，请更换')]) assert.equal(scheduledTaskNeedsAttention(error), true);
  for (const error of [{ code: 'NETWORK_ERROR' }, { code: 'ETIMEDOUT' }, { status: 503 }]) assert.equal(scheduledTaskNeedsAttention(error), false);
});

test('a running plan retains its model and prompt while its next occurrence can be paused', async t => {
  const f = await fixture(t), saved = await f.service.upsertDesktopScheduledTask(f.draft(), 0);
  const running = { ...saved, lastStatus: 'running' };
  await updateScheduledTaskStore(f.store, { upsert: [running], remove: [], runtimeOnly: true });
  await assert.rejects(f.service.upsertDesktopScheduledTask({ ...running, prompt: 'Change running prompt' }, 1), { code: 'SCHEDULE_RUNNING' });
  const paused = await f.service.upsertDesktopScheduledTask({ ...running, enabled: false }, 1);
  assert.equal(paused.enabled, false); assert.equal(paused.prompt, running.prompt);
});

const widgetSource = ts.createSourceFile('widget.tsx', readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widgetClass = widgetSource.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const loaderMethod = widgetClass.members.find(node => node.name?.getText(widgetSource) === 'loadScheduleModels').getText(widgetSource);
const PlanPicker = new Function(ts.transpile(`class Picker { ${loaderMethod} }; return Picker`, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }))();
function planPicker(getMerchantCatalog) {
  return Object.assign(new PlanPicker(), { scheduleCatalogRequest: 0, scheduleDialogOpen: true, scheduleDraft: { relayKey: 'managed:merchant-b' },
    activeRelayKey: 'managed:merchant-a', activeModelRouteId: 'model-a', platformSession: { linked: true, user: { id: 'owner' } },
    merchantPickerSnapshots: new Map(), offeringMerchantId: offering => offering.merchantId, platformService: { getMerchantCatalog }, update() {} });
}
test('plan model loading uses its own merchant, caches all pages and never changes conversation selection', async () => {
  const calls = [];
  const picker = planPicker(async (merchantId, cursor) => {
    calls.push([merchantId, cursor]);
    return { merchantId, online: true, offerings: [{ id: cursor ? 'b-2' : 'b-1', merchantId }], nextCursor: cursor ? undefined : 'next' };
  });
  await picker.loadScheduleModels();
  assert.equal(calls.length, 2); assert.ok(calls.every(([merchant]) => merchant === 'merchant-b'));
  assert.deepEqual(picker.merchantPickerSnapshots.get('merchant-b').catalog.offerings.map(item => item.id), ['b-1', 'b-2']);
  assert.equal(picker.activeRelayKey, 'managed:merchant-a'); assert.equal(picker.activeModelRouteId, 'model-a');
  await picker.loadScheduleModels(); assert.equal(calls.length, 2); assert.equal(picker.scheduleCatalogLoading, false);
});
test('switching plan merchants ignores stale responses from the previous selection', async () => {
  let finish;
  const picker = planPicker(() => new Promise(resolve => { finish = resolve; }));
  const pending = picker.loadScheduleModels();
  picker.scheduleDraft = { relayKey: 'official:own-key' };
  await picker.loadScheduleModels();
  finish({ merchantId: 'merchant-b', online: true, offerings: [{ id: 'old', merchantId: 'merchant-b' }] });
  await pending;
  assert.equal(picker.merchantPickerSnapshots.size, 0); assert.equal(picker.scheduleCatalogLoading, false);
});

test('new schedule controls and validation messages have exact manual translations in all 12 languages', () => {
  const { localizeDesktopSurface } = require('../lib/browser/nextmux-surface-locale');
  const localeSource = ts.createSourceFile('locale.ts', readFileSync(new URL('../src/browser/nextmux-surface-locale.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const manual = localeSource.statements.flatMap(node => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : [])
    .find(node => node.name.getText(localeSource) === 'manual').initializer;
  const locales = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
  const keys = ['编辑计划','保存计划','选择其他文件夹','中转商 / 自有 API','计划中转商','计划模型','计划思考深度','计划上下文','计划权限',
    '按本机时间执行；休眠后补跑一次。结果保存在所选项目的计划对话中。','请选择中转商与模型。','计划更新失败','模型列表加载失败，请重新选择中转商。',
    '计划正在运行，请结束后再修改设置。','计划已发生变化，请刷新后重试。','计划已删除，请刷新后重试。','请填写计划名称和任务说明。',
    '请检查计划时间与权限设置。','此计划已经执行，请选择新的运行时间。','已保存模型','先选择项目文件夹'];
  for (const locale of locales) {
    const catalog = manual.properties.find(property => property.name.text === locale).initializer;
    for (const key of keys) {
      const entry = catalog.properties.find(property => property.name.text === key);
      assert.ok(entry, `${locale} must explicitly translate ${key}`);
      assert.equal(localizeDesktopSurface(locale, key), entry.initializer.text);
      if (locale !== 'zh-CN') assert.notEqual(entry.initializer.text, key, `${locale}: ${key}`);
    }
  }
});

const openProjectMethod = ['openCodingSessionForWorkspace', 'workspaceRootIsOpen', 'verifyCodingProjectPath', 'codingSessionWorkspaceRoot', 'ensureCodingSessionWorkspace', 'loadContextFiles'].map(name => widgetClass.members.find(node => node.name?.getText(widgetSource) === name).getText(widgetSource)).join('\n');
const ProjectOpener = new Function('URI', 'DesktopDomainError', 'desktopDomainErrorText', ts.transpile(`class Opener { ${openProjectMethod} }; return Opener`, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }))({ fromFilePath: path => ({ path }) }, DesktopDomainError, desktopDomainErrorText);
function projectOpener() {
  const added = [], created = [], errors = [];
  const opener = Object.assign(new ProjectOpener(), { desktopLocale: 'en', workspaceOptions: [{ path: '/already-open', label: 'Open' }], verifiedCodingProjectPaths: new Set(), codingSessionNavigationGeneration: 0,
    fileService: { async resolve() { return { isDirectory: true }; } },
    workspaceService: { async addRoot() { assert.fail('Theia addRoot can reload the window and must not be called'); } },
    async refreshWorkspaceRoots() { this.workspaceOptions = [...this.workspaceOptions, ...added.map(path => ({ path, label: path }))]; },
    createCodingSessionForWorkspace(path) { assert.ok(this.workspaceRootIsOpen(path)); created.push(path); },
    setProjectVisible() {}, addNotification(...args) { errors.push(args); }, openWorkspace() { assert.fail('known project must not reopen the folder chooser'); }
  });
  return { opener, added, created, errors };
}
test('scheduled or historical project plus validates that exact folder without reloading the Theia workspace', async () => {
  const f = projectOpener();
  await f.opener.openCodingSessionForWorkspace('/scheduled-project');
  assert.deepEqual(f.added, []); assert.deepEqual(f.created, ['/scheduled-project']); assert.deepEqual(f.errors, []);
  await f.opener.openCodingSessionForWorkspace('/scheduled-project');
  assert.deepEqual(f.added, []); assert.equal(f.created.length, 2);
  await f.opener.openCodingSessionForWorkspace('/already-open');
  assert.equal(f.created.at(-1), '/already-open');
});
test('invalid project and navigation away during validation never open a different project or the native chooser', async () => {
  const f = projectOpener();
  f.opener.desktopLocale = 'ja';
  f.opener.fileService.resolve = async () => ({ isDirectory: false });
  await f.opener.openCodingSessionForWorkspace('/not-directory');
  assert.equal(f.errors.length, 1); assert.deepEqual(f.added, []); assert.deepEqual(f.created, []);
  assert.match(f.errors[0][2], /[\p{Script=Hiragana}\p{Script=Katakana}]/u, 'the primary project error uses the selected non-English locale');
  assert.doesNotMatch(f.errors[0][2], /missing or inaccessible|Select it again/, 'canonical diagnostics do not reach the primary notification');
  let finish;
  f.opener.fileService.resolve = () => new Promise(resolve => { finish = resolve; });
  const pending = f.opener.openCodingSessionForWorkspace('/scheduled-project');
  f.opener.codingSessionNavigationGeneration++;
  finish({ isDirectory: true }); await pending;
  assert.deepEqual(f.added, []); assert.deepEqual(f.created, []);
});

test('restored scheduled project drives file browsing and execution without borrowing the previously open root', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'nm-scheduled-project-root-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const f = projectOpener(), loaded = [], session = { id: 'scheduled-conversation', workspacePath: directory };
  f.opener.fileService.resolve = async resource => ({ isDirectory: (await stat(resource.path)).isDirectory() });
  Object.assign(f.opener, { activeCodingSessionId: session.id, activeCodingSession: () => session, activeWorkspaceRoot: '/already-open',
    codingSessions: [session], contextFileChildren: new Map(), expandedContextDirectories: new Set(),
    detachContextEditorRecovery: () => true, update() {}, async loadContextDirectory(path) { loaded.push(path); },
    platformService: { async getConversationWorkspace() { assert.fail('valid project must not become a private conversation directory'); } }
  });
  assert.equal(f.opener.codingSessionWorkspaceRoot(session), '', 'unverified historical path is not used before directory validation');
  await f.opener.loadContextFiles();
  assert.deepEqual(loaded, [directory]); assert.equal(f.opener.contextFilesWorkspace, directory);
  const prepared = await f.opener.ensureCodingSessionWorkspace(session);
  assert.equal(prepared, session); assert.equal(f.opener.codingSessionWorkspaceRoot(prepared), directory);
  assert.equal(f.opener.activeWorkspaceRoot, '/already-open', 'background directory verification does not switch global workspace');
  await rm(directory, { recursive: true });
  await assert.rejects(f.opener.ensureCodingSessionWorkspace(session), { code: 'WORKSPACE_UNAVAILABLE' });
  assert.equal(f.opener.verifiedCodingProjectPaths.has(directory), false, 'stale validation cache is discarded after the project moves');
  f.opener.workspaceOptions.push({ path: directory, label: 'Still registered' });
  await assert.rejects(f.opener.ensureCodingSessionWorkspace(session), { code: 'WORKSPACE_UNAVAILABLE' }, 'Theia root membership also must not bypass filesystem validation');
});

test('only unbound conversations provision a private workspace and reuse it on later submissions', async () => {
  const f = projectOpener(), session = { id: 'standalone', workspacePath: '', updatedAt: 1 }, calls = [];
  Object.assign(f.opener, { codingSessions: [session], persistCodingSessions() {}, persistDesktopRestoreState() {},
    platformService: { async getConversationWorkspaceBindings(id) {
      calls.push(id);
      return { workspaceRoot: '/private/standalone', workspaces: [{ workspaceRoot: '/private/standalone' }] };
    } }
  });
  const prepared = await f.opener.ensureCodingSessionWorkspace(session);
  assert.equal(prepared.workspacePath, ''); assert.equal(prepared.privateWorkspacePath, '/private/standalone');
  assert.equal(prepared.ownedWorkspace, true); assert.equal(f.opener.codingSessionWorkspaceRoot(prepared), '/private/standalone');
  assert.equal(await f.opener.ensureCodingSessionWorkspace(prepared), prepared);
  assert.deepEqual(calls, ['standalone']);
});


const editPlanMethods = ['openScheduleDialog', 'selectedScheduleModelRoute', 'saveScheduledTask', 'scheduleRouteModelLabel']
  .map(name => widgetClass.members.find(node => node.name?.getText(widgetSource) === name).getText(widgetSource)).join('\n');
const PlanEditor = new Function('URI', 'FileType', 'bindPriceQuote', 'validScheduleTime', 'declaredReasoningSettings',
  ts.transpile(`class Editor { ${editPlanMethods} }; return Editor`, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }))(
    { fromFilePath: path => ({ scheme: 'file', path }) }, { Directory: 2 }, value => value, validScheduleTime, declaredReasoningSettings);

test('model-created plan edits resolve exact connection and model, preserving execution snapshot and options', async t => {
  const f = await fixture(t);
  const created = await f.call('nextmux.update_schedule', { action: 'create', title: 'AI created', prompt: 'Inspect',
    cadence: 'daily', runAt: '09:00', enabled: false, permissionMode: 'read_only' });
  assert.equal(created.ok, true);
  const prior = (await f.service.loadDesktopScheduledTasks()).find(task => task.id === JSON.parse(created.output).id);
  assert.equal(prior.routeId, 'official:key-a:chosen-model');
  const exact = { id: 'official:key-a', kind: 'official_connection', connection: {
    id: 'key-a', model: 'chosen-model', modelFamily: 'Chosen model', providerId: 'custom_openai', providerName: 'Merchant A' } };
  const wrongConnection = { ...exact, id: 'official:key-b', connection: { ...exact.connection, id: 'key-b' } };
  const wrongModel = { ...exact, id: prior.routeId, connection: { ...exact.connection, model: 'different-model' } };
  let routes = [wrongConnection, wrongModel, exact];
  const editor = Object.assign(new PlanEditor(), { scheduledTasks: [prior], scheduledTasksReady: true,
    scheduledTasksPersistence: Promise.resolve(), scheduledTasksPersisted: new Map(), defaultPermissionMode: 'full_access',
    scheduleModelRoutes: () => routes, managedModelRoute: () => undefined, reasoningEffortLevels: () => ['high'], modelReasoningContract: () => undefined,
    modelKeyForRoute: route => `${route.connection.providerId}/${route.connection.model}`,
    rememberNavigation() {}, clearNavigationSurfaces() {}, async loadScheduleModels() {}, update() {},
    setProjectVisible() {}, completeNavigationSurface() {},
    fileService: { async activateProvider() { return { async stat(resource) { return { type: (await stat(resource.path)).isDirectory() ? 2 : 0 }; } }; } },
    platformService: { upsertDesktopScheduledTask: (task, revision) => f.service.upsertDesktopScheduledTask(task, revision) }
  });
  editor.openScheduleDialog(prior);
  assert.equal(editor.selectedScheduleModelRoute(), exact, 'a matching-looking route ID must not override the saved connection/model identity');
  assert.equal(editor.scheduleDraft.reasoningEffort, 'high'); assert.equal(editor.scheduleDraft.contextWindowTokens, 32000);
  editor.scheduleDraft = { ...editor.scheduleDraft, title: 'Edited title' };
  await editor.saveScheduledTask();
  assert.equal(editor.scheduleDraftError, '');
  const saved = (await f.service.loadDesktopScheduledTasks()).find(task => task.id === prior.id);
  assert.equal(saved.title, 'Edited title'); assert.equal(saved.routeId, exact.id);
  assert.deepEqual(saved.modelRoute, prior.modelRoute); assert.equal(saved.reasoningEffort, prior.reasoningEffort);
  assert.equal(saved.contextWindowTokens, undefined, 'saving an existing plan removes obsolete custom context caps'); assert.equal(saved.permissionMode, 'read_only'); assert.equal(saved.enabled, false);
  editor.openScheduleDialog(saved);
  assert.equal(editor.selectedScheduleModelRoute(), exact);
  routes = [wrongConnection, { ...wrongModel, id: exact.id }];
  assert.equal(editor.selectedScheduleModelRoute(), undefined, 'missing exact model never silently falls back by ID, family or another connection');
});
