import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { sourceModule, comicCoreSource } from './helpers/comic-organizer-source-loader.mjs';

const logic = sourceModule('browser/nextmux-comic-canvas-logic.ts');
const tabs = sourceModule('browser/nextmux-comic-canvas-tabs.ts');
const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['loadComicCanvasHistory', 'selectComicCanvasHistoryVersion', 'comicCanvasProjectKey', 'comicCanvasProjectOf',
    'comicCanvasIsTracked', 'comicCanvasCanWrite', 'adoptComicCanvasRegistry', 'dropComicCanvasTabSession', 'changeComicCanvasSession', 'comicCanvasVideoInputFingerprint', 'invalidateComicCanvasVideoInputs']);
const methods = [];
(function visit(node) { if (ts.isMethodDeclaration(node) && names.has(node.name.getText(ast))) methods.push(node.getText(ast)); ts.forEachChild(node, visit); })(ast);
assert.equal(methods.length, names.size);
const deps = { applyCanvasCommand: comicCoreSource.applyCanvasCommand, canvasVersionReady: logic.canvasVersionReady,
    ownedComicCanvasSession: tabs.ownedComicCanvasSession, window: { clearTimeout() {} } };
const compiled = ts.transpileModule(`const {${Object.keys(deps).join(',')}}=deps;class Widget{comicCanvasVideoInputs = new WeakMap();${methods.join('\n')}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const Widget = new Function('deps', `${compiled};return Widget;`)(deps);
const now = '2026-10-03T00:00:00.000Z';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const version = id => ({ id, assetId: `asset-${id}`, kind: 'video', uri: `nextmux.media/${id}.mp4`, createdAt: now });
function document(id, projectId = 'project-a') {
    return { ...comicCoreSource.createCanvasDocument({ id, projectId, now }), nodes: [{ id: 'video', kind: 'video', title: 'Video', position: { x: 0, y: 0 }, size: { width: 360, height: 260 },
        payload: { versions: [version('old'), version('latest')], currentVersionId: 'latest' } }] };
}
function fixture() {
    const docs = new Map(['main', 'closed', 'deleted', 'pending'].map(id => [id, document(id)]));
    const record = (id, extras = {}) => ({ id, kind: id === 'main' ? 'main' : 'free', title: id, isOpen: id === 'main', createdAt: now, updatedAt: now, ...extras });
    const registry = { schemaVersion: 1, projectId: 'project-a', revision: 3, mainCanvasId: 'main', canvases: [record('main'), record('closed'), record('deleted', { deletedAt: now }), record('pending', { deletionPending: true })] };
    const makeSession = (owner, id, doc) => ({ workspaceRoot: owner.workspaceRoot, projectId: owner.projectId, canvasId: id, canvasName: id, isMain: id === 'main', doc, base: doc, past: [], future: [], save: 'saved' });
    const owner = { workspaceRoot: '/comic-a', projectId: 'project-a', activeCanvasId: 'main', registry, sessions: new Map() };
    const main = makeSession(owner, 'main', docs.get('main')); owner.sessions.set('main', main);
    const otherOwner = { workspaceRoot: '/comic-b', projectId: 'project-b', activeCanvasId: 'other', registry: undefined, sessions: new Map() };
    const other = makeSession(otherOwner, 'other', document('other', 'project-b')); otherOwner.sessions.set('other', other);
    const calls = { list: [], get: [], adopt: [], create: [], save: [], activate: [], scheduled: [] };
    const widget = Object.assign(new Widget(), { activeComicWorkspaceRoot: owner.workspaceRoot, comicState: { project: { id: owner.projectId } }, comicCanvas: main,
        comicCanvasProjects: new Map([[JSON.stringify([owner.workspaceRoot, owner.projectId]), owner], [JSON.stringify([otherOwner.workspaceRoot, otherOwner.projectId]), otherOwner]]),
        comicProject() { return this.comicState.project; }, update() {}, scheduleComicCanvasSave: (session, delay) => calls.scheduled.push([session, delay]),
        createComicCanvasSession(captured, entry) { calls.create.push([captured, entry.id]); const session = makeSession(captured, entry.id, docs.get(entry.id)); captured.sessions.set(entry.id, session);
            if (widget.onLoad) session.load = widget.onLoad(session); return session; },
        flushComicCanvas: async session => { calls.save.push(session); if (widget.onSave) await widget.onSave(session); session.base = session.doc; session.save = 'saved'; },
        activateComicCanvasTab: async (captured, id) => { calls.activate.push([captured, id]); captured.activeCanvasId = id; if (widget.activeComicWorkspaceRoot === captured.workspaceRoot) widget.comicCanvas = captured.sessions.get(id); },
        platformService: { listComicCanvases: async root => { calls.list.push(root); return widget.onList ? widget.onList(root) : registry; },
            getComicCanvas: async (root, id) => { calls.get.push([root, id]); return widget.onGet ? widget.onGet(root, id) : { canvas: docs.get(id) }; } } });
    const adopt = widget.adoptComicCanvasRegistry; widget.adoptComicCanvasRegistry = function(captured, value) { calls.adopt.push([captured, value]); return adopt.call(this, captured, value); };
    const switchProject = () => { widget.activeComicWorkspaceRoot = other.workspaceRoot; widget.comicState = { project: { id: other.projectId } }; widget.comicCanvas = other; };
    const tombstone = id => { owner.registry = { ...owner.registry, revision: owner.registry.revision + 1, canvases: owner.registry.canvases.map(item => item.id === id ? { ...item, deletionPending: true } : item) }; };
    return { widget, owner, main, other, registry, docs, calls, switchProject, tombstone };
}

test('history selection imports the production readiness validator', () => {
    const imported = ast.statements.filter(ts.isImportDeclaration).some(node => node.moduleSpecifier.text === './nextmux-comic-canvas-logic'
        && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) && node.importClause.namedBindings.elements.some(binding => binding.name.text === 'canvasVersionReady'));
    assert.equal(imported, true);
});

test('history reads only captured comic project canvases, including closed tabs and local unsaved versions', async () => {
    const f = fixture(); f.main.doc = { ...f.main.doc, title: 'Unsaved local title' };
    const documents = await f.widget.loadComicCanvasHistory(f.main);
    assert.deepEqual(documents.map(item => item.id), ['main', 'closed']); assert.equal(documents[0], f.main.doc);
    assert.deepEqual(f.calls.list, ['/comic-a']); assert.deepEqual(f.calls.get, [['/comic-a', 'closed']]);
    assert.equal(f.calls.adopt.length, 0); assert.equal(f.calls.save.length, 0); assert.equal(f.calls.activate.length, 0);
});

for (const method of ['loadComicCanvasHistory', 'selectComicCanvasHistoryVersion']) {
    test(`${method} rejects an old source before any request`, async () => {
        const f = fixture(); f.switchProject();
        await assert.rejects(f.widget[method](f.main, 'closed', 'video', 'old'), /CANVAS_NOT_FOUND/); assert.deepEqual(f.calls.list, []);
    });
    test(`${method} rejects late registry results after project switch or source deletion before adopting/loading`, async () => {
        for (const invalidation of ['project', 'deleted', 'pending']) {
            const f = fixture(), gate = deferred(); f.widget.onList = () => gate.promise;
            const pending = f.widget[method](f.main, 'closed', 'video', 'old');
            if (invalidation === 'project') f.switchProject(); else if (invalidation === 'deleted') f.owner.sessions.delete('main'); else f.tombstone('main');
            gate.resolve(f.registry); await assert.rejects(pending, /CANVAS_NOT_FOUND/);
            assert.equal(f.calls.adopt.length, 0, invalidation); assert.equal(f.calls.get.length, 0, invalidation); assert.equal(f.calls.create.length, 0, invalidation);
            assert.equal(f.calls.save.length, 0); assert.equal(f.calls.activate.length, 0);
        }
    });
    test(`${method} rejects a registry from another project`, async () => {
        const f = fixture(); f.widget.onList = () => ({ ...f.registry, projectId: 'project-b' });
        await assert.rejects(f.widget[method](f.main, 'closed', 'video', 'old'), /CANVAS_NOT_FOUND/); assert.equal(f.calls.adopt.length, 0); assert.equal(f.calls.save.length, 0);
    });
}

test('history discards late reads after a project switch and never returns another project document', async () => {
    const f = fixture(), gate = deferred(); f.widget.onGet = () => gate.promise;
    const pending = f.widget.loadComicCanvasHistory(f.main); while (!f.calls.get.length) await Promise.resolve(); f.switchProject(); gate.resolve({ canvas: f.docs.get('closed') });
    await assert.rejects(pending, /CANVAS_NOT_FOUND/);
    for (const replacement of [document('closed', 'project-b'), document('wrong-id')]) {
        const g = fixture(); g.widget.onGet = () => ({ canvas: replacement }); await assert.rejects(g.widget.loadComicCanvasHistory(g.main), /CANVAS_NOT_FOUND/);
    }
});

test('a canvas retired during a history read is excluded, including stale registry responses', async () => {
    for (const timing of ['before', 'during']) {
        const f = fixture(), gate = deferred(); f.widget.onGet = () => gate.promise;
        if (timing === 'before') f.tombstone('closed');
        const pending = f.widget.loadComicCanvasHistory(f.main); while (!f.calls.get.length && timing === 'during') await Promise.resolve();
        if (timing === 'during') f.tombstone('closed'); gate.resolve({ canvas: f.docs.get('closed') });
        assert.deepEqual((await pending).map(doc => doc.id), ['main']);
    }
});

test('version selection changes the captured target, saves before activation and leaves source/other project intact', async () => {
    const f = fixture(), source = f.main.doc, other = f.other.doc, gate = deferred(); f.widget.onSave = () => gate.promise;
    const pending = f.widget.selectComicCanvasHistoryVersion(f.main, 'closed', 'video', 'old');
    while (!f.calls.save.length) await Promise.resolve(); const target = f.owner.sessions.get('closed');
    assert.equal(target.doc.nodes[0].payload.currentVersionId, 'old'); assert.equal(target.past.length, 1); assert.equal(f.calls.activate.length, 0);
    assert.equal(f.main.doc, source); assert.equal(f.other.doc, other); assert.equal(f.calls.save[0], target);
    gate.resolve(); await pending; assert.deepEqual(f.calls.activate, [[f.owner, 'closed']]);
});

test('missing/deleted/pending canvases and absent/unready versions do not write or activate', async () => {
    for (const [canvasId, nodeId, versionId] of [['deleted', 'video', 'old'], ['pending', 'video', 'old'], ['absent', 'video', 'old'], ['closed', 'absent', 'old'], ['closed', 'video', 'absent'], ['closed', 'video', 'unready']]) {
        const f = fixture(); f.docs.get('closed').nodes[0].payload.versions.push({ ...version('unready'), status: 'missing' });
        await assert.rejects(f.widget.selectComicCanvasHistoryVersion(f.main, canvasId, nodeId, versionId), /CANVAS_NOT_FOUND|VERSION_NOT_FOUND/);
        assert.equal(f.calls.save.length, 0); assert.equal(f.calls.activate.length, 0); assert.equal(f.calls.scheduled.length, 0);
    }
});

test('late target loads recheck project, target lifetime and version availability before writing', async () => {
    for (const invalidation of ['project', 'deleted', 'missing-version', 'wrong-project']) {
        const f = fixture(), gate = deferred(); f.widget.onLoad = () => gate.promise;
        const pending = f.widget.selectComicCanvasHistoryVersion(f.main, 'closed', 'video', 'old'); while (!f.calls.create.length) await Promise.resolve();
        const target = f.owner.sessions.get('closed');
        if (invalidation === 'project') f.switchProject(); else if (invalidation === 'deleted') f.tombstone('closed');
        else if (invalidation === 'missing-version') target.doc = { ...target.doc, nodes: [] }; else target.doc = { ...target.doc, projectId: 'project-b' };
        gate.resolve(); await assert.rejects(pending, /CANVAS_NOT_FOUND|VERSION_NOT_FOUND/); assert.equal(f.calls.save.length, 0); assert.equal(f.calls.activate.length, 0);
    }
});

test('save completion cannot activate another project or a target deleted while saving; save errors stay errors', async () => {
    for (const invalidation of ['project', 'deleted', 'replaced']) {
        const f = fixture(), gate = deferred(); f.widget.onSave = () => gate.promise;
        const pending = f.widget.selectComicCanvasHistoryVersion(f.main, 'closed', 'video', 'old'); while (!f.calls.save.length) await Promise.resolve();
        if (invalidation === 'project') f.switchProject(); else if (invalidation === 'deleted') f.tombstone('closed'); else f.owner.sessions.set('closed', { ...f.owner.sessions.get('closed') });
        const other = f.other.doc; gate.resolve(); await pending; assert.equal(f.calls.activate.length, 0, invalidation); assert.equal(f.other.doc, other);
    }
    const f = fixture(); f.widget.onSave = async () => { throw Error('CANVAS_SAVE_FAILED'); };
    await assert.rejects(f.widget.selectComicCanvasHistoryVersion(f.main, 'closed', 'video', 'old'), /CANVAS_SAVE_FAILED/); assert.equal(f.calls.activate.length, 0);
});
