import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const compile = (path, require = () => ({})) => {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText)(require, module, module.exports); return module.exports;
};
const common = compile('../src/common/nextmux-editor-draft-recovery.ts');
const { EditorDraftRecoveryController, editorRecoveryDirty } = compile('../src/browser/nextmux-editor-draft-recovery.ts', () => common);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const snapshot = (text, extra = {}) => ({ sessionId: 'A', sourceUri: 'file:///synthetic/only.txt', name: 'only.txt',
  baseline: { current: 'original' }, drafts: { current: text }, ...extra });
const copy = value => structuredClone(value);
function fixture(t) {
  let sequence = 0;
  const records = new Map(), handles = new Set(), saves = [], deleted = [], released = [];
  const service = {
    async listEditorDraftRecoveries() { return { enabled: true, settingsRevision: 0, entries: [], totalBytes: 0 }; },
    async openEditorDraftRecovery({ id }) {
      if (!id) { id = `id-${++sequence}`; handles.add(id); return { kind: 'allocated', id, revision: 0 }; }
      if (!records.has(id)) throw new Error('EDITOR_RECOVERY_NOT_FOUND');
      return { kind: 'record', record: copy(records.get(id)) };
    },
    async saveEditorDraftRecovery(request) {
      saves.push(copy(request));
      const previous = records.get(request.id);
      if (previous?.mutationId === request.mutationId) return copy(previous);
      if ((previous?.revision || 0) !== request.expectedRevision) throw new Error('EDITOR_RECOVERY_CONFLICT');
      if (!previous && !handles.has(request.id)) throw new Error('EDITOR_RECOVERY_NOT_FOUND');
      handles.delete(request.id);
      const record = { version: 1, id: request.id, mutationId: request.mutationId, revision: request.expectedRevision + 1,
        snapshotSha256: 'a'.repeat(64), updatedAt: new Date().toISOString(),
        source: { status: 'matching', canWriteSource: true }, snapshot: copy(request.snapshot) };
      records.set(request.id, record); return copy(record);
    },
    async discardEditorDraftRecovery({ id, expectedRevision }) {
      if (expectedRevision === 0 && handles.delete(id)) { released.push(id); return { discarded: true }; }
      if (!records.has(id)) throw new Error('EDITOR_RECOVERY_NOT_FOUND');
      if (records.get(id).revision !== expectedRevision) throw new Error('EDITOR_RECOVERY_CONFLICT');
      records.delete(id); deleted.push(id); return { discarded: true };
    }
  };
  const controller = new EditorDraftRecoveryController(service); t.after(() => controller.dispose());
  return { controller, service, records, handles, saves, deleted, released };
}

test('real controller synchronously captures exact empty/before drafts and follows up a pending older write', async t => {
  const f = fixture(t), gate = deferred(), save = f.service.saveEditorDraftRecovery;
  f.service.saveEditorDraftRecovery = async request => { await gate.promise; return save(request); };
  f.controller.capture('A', snapshot('one')); const pending = f.controller.flushAll();
  await new Promise(setImmediate);
  f.controller.capture('A', snapshot('', { baseline: { current: 'original', before: 'old' }, drafts: { current: '', before: 'changed before' } }));
  gate.resolve(); await pending;
  assert.equal(f.saves.length, 2); assert.equal(f.controller.hasUnconfirmed, false);
  assert.deepEqual([...f.records.values()][0].snapshot.drafts, { current: '', before: 'changed before' });
});

test('a lost acknowledgement retries the same id/mutation/bytes before committing newer input', async t => {
  const f = fixture(t), save = f.service.saveEditorDraftRecovery; let lose = true;
  f.service.saveEditorDraftRecovery = async request => { const ack = await save(request); if (lose) { lose = false; throw new Error('EDITOR_RECOVERY_UNAVAILABLE'); } return ack; };
  f.controller.capture('A', snapshot('one')); await assert.rejects(f.controller.flushAll(), /UNAVAILABLE/);
  f.controller.capture('A', snapshot('two')); await f.controller.flushAll();
  assert.equal(f.saves.length, 3);
  assert.deepEqual(f.saves[0], f.saves[1]); assert.notEqual(f.saves[2].mutationId, f.saves[1].mutationId);
  assert.equal(f.records.size, 1); assert.equal([...f.records.values()][0].snapshot.drafts.current, 'two');
});

test('known rejection keeps exact memory and permits a corrected snapshot, not the rejected payload forever', async t => {
  const f = fixture(t), save = f.service.saveEditorDraftRecovery;
  f.service.saveEditorDraftRecovery = request => request.snapshot.drafts.current === 'large'
    ? Promise.reject(new Error('EDITOR_RECOVERY_TOO_LARGE')) : save(request);
  f.controller.capture('A', snapshot('large')); await assert.rejects(f.controller.flushAll(), /TOO_LARGE/);
  assert.equal(f.controller.entries.get('A').snapshot.drafts.current, 'large');
  f.controller.capture('A', snapshot('small')); await f.controller.flushAll();
  assert.equal(f.controller.isConfirmed('A'), true); assert.equal([...f.records.values()][0].snapshot.drafts.current, 'small');
});

test('a mismatched receipt never marks the submitted snapshot saved and keeps its recovery identity', async t => {
  const f = fixture(t), save = f.service.saveEditorDraftRecovery;
  f.service.saveEditorDraftRecovery = async request => ({ ...await save(request), mutationId: 'wrong-receipt' });
  f.controller.capture('A', snapshot('exact bytes')); await assert.rejects(f.controller.flushAll(), /UNAVAILABLE/);
  assert.equal(f.controller.isConfirmed('A'), false);
  const pending = f.controller.entries.get('A').pending.request;
  f.service.saveEditorDraftRecovery = save; await f.controller.flushAll();
  assert.deepEqual(f.saves[1], pending); assert.equal(f.controller.isConfirmed('A'), true);
});

test('undoing an uncommitted rejected draft releases only its owned revision-zero handle', async t => {
  const f = fixture(t);
  f.service.saveEditorDraftRecovery = async () => { throw new Error('EDITOR_RECOVERY_QUOTA_EXCEEDED'); };
  f.controller.capture('A', snapshot('one')); await assert.rejects(f.controller.flushAll());
  assert.equal(f.handles.size, 1);
  f.controller.capture('A', snapshot('original')); await f.controller.flushAll();
  assert.equal(f.handles.size, 0); assert.equal(f.released.length, 1); assert.equal(f.controller.entries.size, 0);
});

test('new input while a clean snapshot deletes its backup receives a fresh id without losing bytes', async t => {
  const f = fixture(t); f.controller.capture('A', snapshot('one')); await f.controller.flushAll();
  const originalId = f.controller.entries.get('A').ack.id, gate = deferred(), discard = f.service.discardEditorDraftRecovery;
  f.service.discardEditorDraftRecovery = async request => { await gate.promise; return discard(request); };
  f.controller.capture('A', snapshot('original')); const clearing = f.controller.flushAll();
  await new Promise(setImmediate); f.controller.capture('A', snapshot('new during deletion')); gate.resolve(); await clearing;
  assert.notEqual(f.controller.entries.get('A').ack.id, originalId);
  assert.equal([...f.records.values()][0].snapshot.drafts.current, 'new during deletion');
});

test('an explicitly saved oversized clean file can clear its older small backup even with recovery disabled', async t => {
  const f = fixture(t); f.controller.capture('A', snapshot('small')); await f.controller.flushAll();
  f.controller.state = { enabled: false, settingsRevision: 1, entries: [], totalBytes: 0 };
  const large = 'x'.repeat(common.EDITOR_RECOVERY_MAX_BYTES + 1);
  assert.equal(f.controller.capture('A', snapshot(large, { baseline: { current: large } }), true), true);
  await f.controller.flushAll(); assert.equal(f.records.size, 0); assert.equal(f.controller.entries.size, 0);
});

test('late open cannot replace input even after that input has already been durably acknowledged', async t => {
  const f = fixture(t); f.controller.capture('A', snapshot('old')); await f.controller.flushAll();
  const id = f.controller.entries.get('A').ack.id, old = copy(f.records.get(id)), gate = deferred();
  f.service.openEditorDraftRecovery = () => gate.promise;
  const opening = f.controller.open(id);
  f.controller.capture('A', snapshot('new')); await f.controller.flushAll();
  gate.resolve({ kind: 'record', record: old }); await opening;
  assert.equal(f.controller.entries.get('A').snapshot.drafts.current, 'new');
  assert.equal(f.controller.entries.get('A').ack.revision, 2);
});

test('discard invalidates an in-flight open and cannot resurrect its old record', async t => {
  const f = fixture(t); f.controller.capture('A', snapshot('old')); await f.controller.flushAll();
  const entry = f.controller.entries.get('A'), old = copy(f.records.get(entry.ack.id)), gate = deferred();
  f.service.openEditorDraftRecovery = () => gate.promise;
  const opening = f.controller.open(entry.ack.id); const rejected = assert.rejects(opening, /NOT_FOUND/);
  await f.controller.discard('A', entry.version); gate.resolve({ kind: 'record', record: old }); await rejected;
  assert.equal(f.controller.entries.size, 0); assert.equal(f.records.size, 0);
});

test('explicit discard rejects a stale local version and refuses a newer backend revision', async t => {
  const f = fixture(t); f.controller.capture('A', snapshot('one')); await f.controller.flushAll();
  const version = f.controller.entries.get('A').version;
  f.controller.capture('A', snapshot('two'));
  await assert.rejects(f.controller.discard('A', version), /CONFLICT/); await f.controller.flushAll();
  const entry = f.controller.entries.get('A'); f.records.get(entry.ack.id).revision++;
  await assert.rejects(f.controller.discard('A', entry.version), /CONFLICT/);
  assert.equal(f.controller.entries.get('A').snapshot.drafts.current, 'two');
});

test('capture and open have bounded admission; rejections never evict another owner', async t => {
  const f = fixture(t);
  for (let i = 0; i < 32; i++) assert.equal(f.controller.capture(String(i), snapshot(String(i))), true);
  assert.equal(f.controller.capture('extra', snapshot('extra')), false);
  assert.equal(f.controller.capture('0', snapshot('x'.repeat(common.EDITOR_RECOVERY_MAX_BYTES))), false);
  assert.equal(f.controller.entries.get('0').snapshot.drafts.current, '0');
  f.service.openEditorDraftRecovery = async () => ({ kind: 'record', record: { id: 'extra', revision: 1, snapshot: snapshot('remote') } });
  await assert.rejects(f.controller.open('extra'), /QUOTA/);
  assert.equal(f.controller.entries.size, 32);
});

test('history-independent disabled setting stops new captures but preserves already-confirmed copies', async t => {
  const f = fixture(t); f.controller.capture('A', snapshot('one')); await f.controller.flushAll();
  f.controller.state = { enabled: false, settingsRevision: 3, entries: [], totalBytes: 0 };
  assert.equal(f.controller.capture('A', snapshot('one')), true);
  assert.equal(f.controller.capture('A', snapshot('new')), false);
  const gate = deferred(); f.service.listEditorDraftRecoveries = () => gate.promise;
  const reading = f.controller.refresh(); gate.resolve({ enabled: true, settingsRevision: 1, entries: [], totalBytes: 0 }); await reading;
  assert.equal(f.controller.state.enabled, false); assert.equal(f.controller.state.settingsRevision, 3);
  assert.equal(editorRecoveryDirty(snapshot('', { baseline: { current: 'original' }, drafts: { current: '' } })), true);
});


test('CRLF disk baselines and LF models remain clean, including oversized files and before-side drafts', t => {
  const f = fixture(t);
  const baseline = 'line one\r\nline two\r\n'.repeat(30_000);
  const drafts = baseline.replace(/\r\n/g, '\n');
  const clean = snapshot(drafts, { baseline: { current: baseline, before: 'old\r\n' }, drafts: { current: drafts, before: 'old\n' } });
  assert.equal(editorRecoveryDirty(clean), false);
  assert.equal(f.controller.capture('windows', clean), true);
  assert.equal(f.controller.entries.size, 0);
  assert.equal(f.controller.error, undefined);
  assert.equal(editorRecoveryDirty({ ...clean, drafts: { current: drafts + 'edited' } }), true);
  assert.equal(editorRecoveryDirty({ ...clean, drafts: { before: 'edited\n' } }), true);
  assert.equal(editorRecoveryDirty(snapshot('', { baseline: { current: '' }, drafts: { before: '' } })), true);
});
