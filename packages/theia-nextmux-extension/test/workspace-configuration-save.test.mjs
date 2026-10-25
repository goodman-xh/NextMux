import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/browser/nextmux-workspace-configuration-save.ts', import.meta.url), 'utf8');
const compiledExports = {};
new Function('exports', ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText)(compiledExports);
const { WorkspaceConfigurationSaveCoordinator } = compiledExports;

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

class FakeUri {
  constructor(value) { this.value = value; }
  get parent() { return new FakeUri(this.value.slice(0, this.value.lastIndexOf('/')) || '/'); }
  resolve(name) { return new FakeUri(`${this.value.replace(/\/$/, '')}/${name}`); }
  isEqual(other) { return other instanceof FakeUri && other.value === this.value; }
  toString() { return this.value; }
}

function fakeWorkspaceService(save, rootCount = 1) {
  const resource = new FakeUri('/profile/workspaces/Untitled-1.theia-workspace');
  return {
    workspace: { resource },
    get roots() { return Promise.resolve(Array.from({ length: rootCount }, (_, index) => ({ index }))); },
    isUntitledWorkspace: candidate => candidate === resource,
    save,
  };
}

test('a single-root untitled workspace is silently promoted to the stable NextMux file', async () => {
  const saved = [];
  const coordinator = new WorkspaceConfigurationSaveCoordinator(
    fakeWorkspaceService(async uri => { saved.push(String(uri)); })
  );

  coordinator.schedule();
  await coordinator.flush();

  assert.deepEqual(saved, ['/profile/workspaces/NextMux.auto.theia-workspace']);
});

test('save starts immediately and shutdown flush waits for the in-flight write', async () => {
  let releaseSave;
  let saveStarted;
  let completed = false;
  const started = new Promise(resolve => { saveStarted = resolve; });
  const pendingSave = new Promise(resolve => { releaseSave = resolve; });
  const coordinator = new WorkspaceConfigurationSaveCoordinator(fakeWorkspaceService(async () => {
    saveStarted();
    await pendingSave;
    completed = true;
  }));

  coordinator.schedule();
  await started;
  const flushing = coordinator.flush();
  assert.equal(coordinator.hasPendingChanges, true);
  assert.equal(completed, false);
  releaseSave();
  await flushing;

  assert.equal(completed, true);
  assert.equal(coordinator.hasPendingChanges, false);
});

test('a root change during an in-flight save receives one trailing serialized save', async () => {
  let releaseFirstSave;
  let firstSaveStarted;
  const started = new Promise(resolve => { firstSaveStarted = resolve; });
  const firstSave = new Promise(resolve => { releaseFirstSave = resolve; });
  let calls = 0;
  const coordinator = new WorkspaceConfigurationSaveCoordinator(fakeWorkspaceService(async () => {
    calls += 1;
    if (calls === 1) {
      firstSaveStarted();
      await firstSave;
    }
  }));

  coordinator.schedule();
  const flushing = coordinator.flush();
  await started;
  coordinator.schedule();
  releaseFirstSave();
  await flushing;

  assert.equal(calls, 2);
});

test('a change between a successful drain and its finalizer is not lost', async () => {
  let calls = 0;
  let coordinator;
  const service = fakeWorkspaceService(() => {
    calls += 1;
    if (calls > 1) return Promise.resolve();
    return {
      then(resolve) {
        resolve();
        queueMicrotask(() => queueMicrotask(() => coordinator.schedule()));
      },
    };
  });
  coordinator = new WorkspaceConfigurationSaveCoordinator(service);

  coordinator.schedule();
  await coordinator.flush();

  assert.equal(calls, 2);
});

test('disposing uses the same lossless save path', async () => {
  let calls = 0;
  const coordinator = new WorkspaceConfigurationSaveCoordinator(fakeWorkspaceService(async () => { calls += 1; }));

  coordinator.schedule();
  coordinator.dispose();
  await coordinator.flush();

  assert.equal(calls, 1);
});

test('a failed save stays dirty and retries only after the next scheduled change', async () => {
  let calls = 0;
  const coordinator = new WorkspaceConfigurationSaveCoordinator(fakeWorkspaceService(async () => {
    calls += 1;
    if (calls === 1) throw new Error('disk temporarily unavailable');
  }));

  coordinator.schedule();
  await coordinator.flush();
  assert.equal(calls, 1);
  assert.equal(coordinator.hasPendingChanges, true);
  await Promise.resolve();
  assert.equal(calls, 1);

  coordinator.schedule();
  await coordinator.flush();
  assert.equal(calls, 2);
  assert.equal(coordinator.hasPendingChanges, false);
});

test('root mutations defer event-triggered promotion and shutdown flush joins the final save', async () => {
  const started = deferred(), releaseMutation = deferred(), saveStarted = deferred(), releaseSave = deferred();
  const events = [];
  const coordinator = new WorkspaceConfigurationSaveCoordinator(fakeWorkspaceService(async () => {
    events.push('save'); saveStarted.resolve(); await releaseSave.promise;
  }));
  const mutation = coordinator.runWorkspaceMutation(async () => {
    events.push('mutation'); coordinator.schedule(); started.resolve();
    await releaseMutation.promise;
    events.push('mutation complete');
    return 'kept result';
  });
  await started.promise;
  assert.equal(coordinator.hasPendingChanges, true);
  let flushed = false;
  const flush = coordinator.flush().then(() => { flushed = true; });
  await Promise.resolve();
  assert.deepEqual(events, ['mutation']);
  releaseMutation.resolve();
  assert.equal(await mutation, 'kept result');
  await saveStarted.promise;
  assert.deepEqual(events, ['mutation', 'mutation complete', 'save']);
  assert.equal(flushed, false);
  releaseSave.resolve(); await flush;
  assert.equal(coordinator.hasPendingChanges, false);
});

test('an active save finishes before a queued root mutation, without waiting on its trailing events', async () => {
  const saveStarted = deferred(), releaseSave = deferred();
  const events = [];
  let calls = 0;
  const coordinator = new WorkspaceConfigurationSaveCoordinator(fakeWorkspaceService(async () => {
    events.push(`save ${++calls}`);
    if (calls === 1) { saveStarted.resolve(); await releaseSave.promise; }
  }));
  coordinator.schedule(); await saveStarted.promise;
  const mutation = coordinator.runWorkspaceMutation(async () => {
    events.push('mutation'); coordinator.schedule();
  });
  coordinator.schedule();
  const shutdown = coordinator.flush();
  await Promise.resolve();
  assert.deepEqual(events, ['save 1']);
  releaseSave.resolve(); await mutation; await shutdown;
  assert.deepEqual(events, ['save 1', 'mutation', 'save 2']);
  assert.equal(coordinator.hasPendingChanges, false);
});

test('queued mutations stay serialized and a rejected mutation does not block its successor', async () => {
  const started = deferred(), release = deferred();
  const events = [];
  const coordinator = new WorkspaceConfigurationSaveCoordinator(fakeWorkspaceService(async () => { events.push('save'); }));
  const first = coordinator.runWorkspaceMutation(async () => {
    events.push('first'); coordinator.schedule(); started.resolve(); await release.promise;
    throw new Error('ROOT_ADD_FAILED');
  });
  const rejected = assert.rejects(first, /ROOT_ADD_FAILED/);
  await started.promise;
  const second = coordinator.runWorkspaceMutation(async () => { events.push('second'); coordinator.schedule(); return 2; });
  const shutdown = coordinator.flush();
  release.resolve(); await rejected;
  assert.equal(await second, 2);
  await shutdown;
  assert.deepEqual(events, ['first', 'second', 'save']);
  assert.equal(coordinator.hasPendingChanges, false);
});

test('promotion failure after a root mutation retains pending state and allows an explicit retry', async () => {
  let calls = 0;
  const coordinator = new WorkspaceConfigurationSaveCoordinator(fakeWorkspaceService(async () => {
    if (++calls === 1) throw new Error('SAVE_FAILED');
  }));
  await coordinator.runWorkspaceMutation(async () => { coordinator.schedule(); });
  // Join the automatic attempt without requesting a new retry after it fails.
  await coordinator.flush();
  assert.equal(calls, 1);
  assert.equal(coordinator.hasPendingChanges, true);
  await coordinator.flush();
  assert.equal(calls, 2);
  assert.equal(coordinator.hasPendingChanges, false);
});
