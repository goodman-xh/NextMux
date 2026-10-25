import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

// Execute the installed Theia implementation, including its real event ordering
// and workspace-data transforms. Only browser/OS dependencies are replaced.
// Upstream: https://github.com/eclipse-theia/theia/blob/v1.74.1/packages/workspace/src/browser/workspace-service.ts#L538-L566
const require = createRequire(import.meta.url);
const theiaFile = require.resolve('@theia/workspace/lib/browser/workspace-service.js');
const theiaRequire = createRequire(theiaFile);
const ts = theiaRequire('typescript');
const URI = theiaRequire('@theia/core/lib/common/uri').default;
const { Deferred } = theiaRequire('@theia/core/lib/common/promise-util');
const { Emitter } = theiaRequire('@theia/core/lib/common/event');
const { DisposableCollection } = theiaRequire('@theia/core/lib/common/disposable');
const { FileStat } = theiaRequire('@theia/filesystem/lib/common/files');
const jsoncparser = theiaRequire('jsonc-parser');
const Ajv = theiaRequire('@theia/core/shared/ajv');
const { workspaceSchema } = theiaRequire('./workspace-schema-updater');
const { PreferenceScope } = theiaRequire('@theia/core/lib/common/preferences');
const theiaSource = readFileSync(theiaFile.replace('/lib/', '/src/').replace(/\.js$/, '.ts'), 'utf8');
const ast = ts.createSourceFile('workspace-service.ts', theiaSource, ts.ScriptTarget.Latest, true);
const serviceClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'WorkspaceService');
const methodNames = [
  'roots', 'tryGetRoots', 'workspace', 'onWorkspaceChanged', 'onWorkspaceLocationChanged',
  'getWorkspacePath', 'setWorkspace', 'updateWorkspace', 'updateRoots', 'computeRoots',
  'getWorkspaceDataFromFile', 'addRoot', 'removeRoots', 'spliceRoots', 'writeWorkspaceFile',
  'toValidRoot', 'toFileStat', 'opened', 'saved', 'save', 'isUntitledWorkspace',
];
const methods = methodNames.map(name => {
  const member = serviceClass.members.find(node => node.name?.getText(ast) === name);
  assert.ok(member, `installed Theia still supplies ${name}`);
  return member.getText(ast);
});
const workspaceData = ast.statements.find(node => ts.isModuleDeclaration(node) && node.name.text === 'WorkspaceData');
assert.ok(workspaceData);
const fixtureCode = ts.transpileModule(
  `${workspaceData.getText(ast).replace(/^export /, '')}\nclass TheiaWorkspaceFixture {\n${methods.join('\n')}\n}`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
).outputText;
const { TheiaWorkspaceFixture } = new Function(
  'URI', 'Deferred', 'FileStat', 'jsoncparser', 'Ajv', 'workspaceSchema', 'PreferenceScope',
  `${fixtureCode}\nreturn { TheiaWorkspaceFixture };`,
)(URI, Deferred, FileStat, jsoncparser, Ajv, workspaceSchema, PreferenceScope);

const coordinatorSource = readFileSync(new URL('../src/browser/nextmux-workspace-configuration-save.ts', import.meta.url), 'utf8');
const coordinatorExports = {};
new Function('exports', ts.transpileModule(coordinatorSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText)(coordinatorExports);
const { WorkspaceConfigurationSaveCoordinator } = coordinatorExports;
const widgetSource = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const widgetAst = ts.createSourceFile('widget.tsx', widgetSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widgetClass = widgetAst.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const widgetMethods = ['chooseDraftWorkspace', 'useDraftWorkspaceFolder', 'refreshWorkspaceRoots', 'addDroppedProjectFolders', 'finishConversationArchiveImport'].map(name => {
  const member = widgetClass.members.find(node => node.name?.getText(widgetAst) === name);
  assert.ok(member, `widget still supplies ${name}`);
  return member.getText(widgetAst);
});
const WidgetFixture = new Function('requestAnimationFrame', 'URI', 'window', ts.transpileModule(
  `class WidgetFixture { ${widgetMethods.join('\n')} }; return WidgetFixture;`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
).outputText)(() => {}, URI, {});

function createFixture({ onOperation = async () => {}, existingAutomatic = false, additionalBasename = 'project-b' } = {}) {
  const initial = new URI('file:///virtual/project-a');
  const additional = new URI(`file:///virtual/${additionalBasename}`);
  const untitled = new URI('file:///virtual/profile/Untitled-1.theia-workspace');
  const automatic = untitled.parent.resolve('NextMux.auto.theia-workspace');
  const files = new Map();
  if (existingAutomatic) files.set(String(automatic), JSON.stringify({ folders: [{ path: String(initial) }, { path: String(additional) }] }));
  const directories = new Set([initial.toString(), additional.toString()]);
  const trace = [];
  let tick = 0;
  const stat = resource => {
    if (directories.has(String(resource))) return FileStat.dir(resource);
    if (!files.has(String(resource))) throw new Error(`ENOENT: ${resource}`);
    return { resource, isDirectory: false, isFile: true, name: resource.path.base,
      mtime: ++tick, ctime: 0, etag: String(tick), size: files.get(String(resource)).length };
  };
  const operate = async (operation, resource, value) => {
    trace.push({ operation, path: String(resource), ...(value === undefined ? {} : { value }) });
    await onOperation(operation, resource, value);
  };
  const service = new TheiaWorkspaceFixture();
  Object.assign(service, {
    _workspace: FileStat.dir(initial), _roots: [FileStat.dir(initial)],
    deferredRoots: new Deferred(), toDisposeOnWorkspace: new DisposableCollection(),
    onWorkspaceChangeEmitter: new Emitter(), onWorkspaceLocationChangedEmitter: new Emitter(),
    fileService: {
      async exists(uri) { await operate('exists', uri); return files.has(String(uri)) || directories.has(String(uri)); },
      async create(uri) { await operate('create', uri); files.set(String(uri), ''); return stat(uri); },
      async read(uri) { await operate('read', uri); return { ...stat(uri), value: files.get(String(uri)) }; },
      // Theia's FileService.write defaults to create/overwrite, so deleting a
      // file before the write does not itself make the write fail.
      async write(uri, value) { await operate('write', uri, value); files.set(String(uri), value); return stat(uri); },
      async resolve(uri) { await operate('resolve', uri); return stat(uri); },
      async delete(uri) { await operate('delete', uri); files.delete(String(uri)); },
      watch() { return { dispose() {} }; },
    },
    server: { async setMostRecentlyUsedWorkspace(uri) { await operate('recent', uri); } },
    schemaService: { getJSONSchema: () => ({ properties: {} }) },
    untitledWorkspaceService: { isUntitledWorkspace: uri => Boolean(uri?.isEqual(untitled)) },
    getUntitledWorkspace: async () => untitled,
    isWorkspaceFile: value => value.isFile,
    isRemoteSession: () => false,
    setURLFragment() {}, updateTitle() {}, watchRoots() {},
    logger: { error: value => assert.fail(value), warn: value => assert.fail(value) },
    labelProvider: { getLongName: value => String(value.resource ?? value) },
  });
  service.deferredRoots.resolve(service._roots);
  const coordinator = new WorkspaceConfigurationSaveCoordinator(service);
  const schedule = () => {
    trace.push({ operation: 'schedule', path: String(service.workspace?.resource) });
    coordinator.schedule();
  };
  service.onWorkspaceChanged(schedule);
  service.onWorkspaceLocationChanged(schedule);
  return {
    service, coordinator, initial, additional, untitled, automatic, files, trace,
    async rootPaths() { return (await service.roots).map(root => String(root.resource)); },
    savedRoots() {
      const content = files.get(String(automatic));
      return content ? jsoncparser.parse(content).folders.map(folder => folder.path.startsWith('file:///')
        ? folder.path : String(automatic.parent.resolveToAbsolute(folder.path))) : [];
    },
  };
}

function createWidget(fixture) {
  const widget = new WidgetFixture();
  Object.assign(widget, {
    codingSessions: [], activeCodingSessionId: '', codingSessionNavigationGeneration: 0,
    draftWorkspaceCanChange() { return false; },
    workspaceService: fixture.service, workspaceConfigurationSaver: fixture.coordinator,
    fileService: fixture.service.fileService,
    fileDialogService: { showOpenDialog: async () => fixture.additional },
    workspaceOptions: [{ path: fixture.initial.path.fsPath() }], expandedCodingProjects: new Set(),
    setProjectVisible() {}, flushComposerDraft() {}, persistDesktopRestoreState() {}, update() {},
    addNotification() {}, selectWorkspaceRoot(path) { this.selectedRoot = path; },
    conversationHistoryPersistenceReady: true,
    async restoreDurableCodingSessions() { this.historyRestored = true; },
    async hydrateOwnedCodingSessionWorkspaces() { this.workspacesHydrated = true; },
    applyWorkspaceRoots(roots) { this.workspaceOptions = roots.map(root => ({ path: root.resource.path.fsPath() })); },
  });
  fixture.service.onWorkspaceChanged(() => { void widget.refreshWorkspaceRoots(); });
  return widget;
}

test('installed Theia control: an uncoordinated first addRoot loses its new root, while the second succeeds', async () => {
  const fixture = createFixture();
  await fixture.service.addRoot([fixture.additional]);
  await fixture.coordinator.flush();
  assert.deepEqual(await fixture.rootPaths(), [String(fixture.initial)]);
  assert.deepEqual(fixture.savedRoots(), [String(fixture.initial)]);
  const autoWrite = fixture.trace.findIndex(event => event.operation === 'write' && event.path === String(fixture.automatic));
  const spliceWrite = fixture.trace.findIndex(event => event.operation === 'write' && event.path === String(fixture.untitled)
    && jsoncparser.parse(event.value).folders.length === 2);
  const untitledDelete = fixture.trace.findIndex(event => event.operation === 'delete' && event.path === String(fixture.untitled));
  assert.ok(autoWrite >= 0 && autoWrite < spliceWrite && spliceWrite < untitledDelete,
    'automatic save snapshots A, splice writes A+B into Untitled, promotion then deletes that file');
  await fixture.service.addRoot([fixture.additional]);
  await fixture.coordinator.flush();
  assert.deepEqual(await fixture.rootPaths(), [String(fixture.initial), String(fixture.additional)]);
  assert.deepEqual(fixture.savedRoots(), [String(fixture.initial), String(fixture.additional)]);
});

test('actual draft picker preserves the added root in the first selection and its automatic workspace', async () => {
  const fixture = createFixture();
  const widget = createWidget(fixture);
  await widget.chooseDraftWorkspace();
  await fixture.coordinator.flush();
  assert.equal(widget.attachmentError, undefined);
  assert.equal(widget.draftWorkspaceRoot, fixture.additional.path.fsPath());
  assert.deepEqual(await fixture.rootPaths(), [String(fixture.initial), String(fixture.additional)]);
  assert.deepEqual(widget.workspaceOptions.map(root => root.path), [fixture.initial.path.fsPath(), fixture.additional.path.fsPath()]);
  assert.deepEqual(fixture.savedRoots(), [String(fixture.initial), String(fixture.additional)]);
  assert.equal(fixture.files.has(String(fixture.untitled)), false);
  assert.equal(fixture.coordinator.hasPendingChanges, false);
  const previousWrites = fixture.trace.filter(event => event.operation === 'write').length;
  await widget.chooseDraftWorkspace();
  await fixture.coordinator.flush();
  assert.deepEqual(await fixture.rootPaths(), [String(fixture.initial), String(fixture.additional)]);
  assert.equal(fixture.trace.filter(event => event.operation === 'write').length, previousWrites, 'choosing the same root is idempotent');
});

test('reopening a single folder reproduces the conversion path even when an automatic workspace already exists', async () => {
  const fixture = createFixture({ existingAutomatic: true });
  const widget = createWidget(fixture);
  assert.equal(fixture.service.workspace.isDirectory, true);
  assert.deepEqual(await fixture.rootPaths(), [String(fixture.initial)]);
  await widget.chooseDraftWorkspace();
  await fixture.coordinator.flush();
  assert.equal(widget.attachmentError, undefined);
  assert.deepEqual(await fixture.rootPaths(), [String(fixture.initial), String(fixture.additional)]);
  assert.deepEqual(fixture.savedRoots(), [String(fixture.initial), String(fixture.additional)]);
  assert.equal(String(fixture.service.workspace.resource), String(fixture.automatic));
  assert.ok(fixture.trace.some(event => event.operation === 'write' && event.path === String(fixture.untitled)));
});

test('actual project drop joins the same root mutation and promotion boundary', async () => {
  const fixture = createFixture();
  const widget = createWidget(fixture);
  await widget.addDroppedProjectFolders([{ path: fixture.additional.path.fsPath() }]);
  await fixture.coordinator.flush();
  assert.equal(widget.selectedRoot, fixture.additional.path.fsPath());
  assert.deepEqual(await fixture.rootPaths(), [String(fixture.initial), String(fixture.additional)]);
  assert.deepEqual(fixture.savedRoots(), [String(fixture.initial), String(fixture.additional)]);
});

test('actual committed archive import adds its root before restoring history and promoting the workspace', async () => {
  const fixture = createFixture();
  const widget = createWidget(fixture);
  await widget.finishConversationArchiveImport({ boundDirectories: [String(fixture.additional)] });
  await fixture.coordinator.flush();
  assert.equal(widget.historyRestored, true);
  assert.equal(widget.workspacesHydrated, true);
  assert.deepEqual(await fixture.rootPaths(), [String(fixture.initial), String(fixture.additional)]);
  assert.deepEqual(fixture.savedRoots(), [String(fixture.initial), String(fixture.additional)]);
});

test('actual transient-root cleanup finishes before an untitled workspace is promoted', async () => {
  const fixture = createFixture({ additionalBasename: '.chrome-provider-login-123' });
  fixture.files.set(String(fixture.untitled), JSON.stringify({ folders: [{ path: String(fixture.initial) }, { path: String(fixture.additional) }] }));
  fixture.service._workspace = await fixture.service.fileService.resolve(fixture.untitled);
  fixture.service._roots.push(FileStat.dir(fixture.additional));
  const widget = createWidget(fixture);
  await widget.refreshWorkspaceRoots();
  await fixture.coordinator.flush();
  assert.deepEqual(await fixture.rootPaths(), [String(fixture.initial)]);
  assert.deepEqual(fixture.savedRoots(), [String(fixture.initial)]);
  assert.equal(String(fixture.service.workspace.resource), String(fixture.automatic));
});
