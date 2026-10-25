import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { comicCanvasTabKeyTarget, comicCanvasTabNeedsCloseConfirmation, ownedComicCanvasSession, saveBeforeComicCanvasSwitch } from '../lib/browser/nextmux-comic-canvas-tabs.js';
import { canvasTabsText, canvasTabsActionText, comicCanvasTabsErrorText, COMIC_CANVAS_TABS_LOCALES } from '../lib/browser/nextmux-comic-canvas-tabs-text.js';
import { canvasRunOrder, canvasNodeBusy, canvasPendingUpstream } from '../lib/browser/nextmux-comic-canvas-logic.js';
import { comicStartFrameSettings } from '../lib/browser/nextmux-comic-start-frame-settings.js';
import { modelFailureText } from '../lib/browser/nextmux-model-errors.js';
import { analyzeCanvasSequence } from '@nextmux/comic-core/canvas-sequence';

const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
/** Execute the real widget methods without booting the unrelated Theia application. */
function methodHarness(name, globals = {}) {
    const asyncStart = source.indexOf(`    protected async ${name}(`);
    const start = asyncStart >= 0 ? asyncStart : source.indexOf(`    protected ${name}(`);
    assert.ok(start >= 0, `method ${name} exists`);
    const end = source.indexOf('\n    protected ', start + 1);
    const method = source.slice(start, end < 0 ? undefined : end).trim();
    const { outputText } = ts.transpileModule(`class Harness { ${method} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
    return Function('canvasText', 'canvasTabsText', 'comicCanvasTabsErrorText', 'window', 'canvasRunOrder', 'canvasNodeBusy', 'canvasPendingUpstream',
        'analyzeCanvasSequence', 'modelFailureText', 'comicStartFrameSettings', `${outputText}\nreturn new Harness();`)(
        (_locale, key) => key, (_locale, key) => key, (_locale, error) => error.code, globals.window ?? {}, canvasRunOrder, canvasNodeBusy, canvasPendingUpstream,
        analyzeCanvasSequence, modelFailureText, comicStartFrameSettings);
}

test('switch waits for the current save before activating the target', async () => {
    const events = [];
    let finish;
    const current = { canvasId: 'a' }, target = { canvasId: 'b' };
    const saving = new Promise(resolve => { finish = resolve; });
    const pending = saveBeforeComicCanvasSwitch(current, target, async item => { events.push(`save:${item.canvasId}`); await saving; }, item => { events.push(`active:${item.canvasId}`); });
    await Promise.resolve();
    assert.deepEqual(events, ['save:a']);
    finish(); await pending;
    assert.deepEqual(events, ['save:a', 'active:b']);
});

test('failed saving keeps the current tab active and never discards its document', async () => {
    const current = { canvasId: 'a', doc: { prompt: 'unsaved' } }, target = { canvasId: 'b' };
    let active = current;
    await assert.rejects(saveBeforeComicCanvasSwitch(current, target, async () => { throw new Error('disk full'); }, item => { active = item; }), /disk full/);
    assert.equal(active, current);
    assert.equal(current.doc.prompt, 'unsaved');
});

test('switching to the same session is a no-op', async () => {
    const item = {};
    await saveBeforeComicCanvasSwitch(item, item, () => { assert.fail('should not save'); }, () => { assert.fail('should not activate'); });
});

test('completion looks up its captured canvas even after another canvas becomes active', async () => {
    const a = { id: 'a', result: undefined }, b = { id: 'b', result: undefined };
    const sessions = new Map([['a', a], ['b', b]]);
    let active = a;
    let finish;
    const pending = new Promise(resolve => { finish = resolve; }).then(result => { const owner = ownedComicCanvasSession(sessions, 'a', a); if (owner) owner.result = result; });
    active = b; finish('image-a'); await pending;
    assert.equal(active, b);
    assert.equal(a.result, 'image-a');
    assert.equal(b.result, undefined);
    sessions.set('a', { id: 'replacement' });
    assert.equal(ownedComicCanvasSession(sessions, 'a', a), undefined);
});

test('real background refresh reads and adopts the owning canvas after an active-tab change', async () => {
    const widget = methodHarness('refreshComicCanvas');
    const session = { workspaceRoot: '/project', canvasId: 'a' };
    const response = { id: 'a', revision: 3 };
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const calls = [];
    widget.platformService = { getComicCanvas: (root, id) => { calls.push([root, id]); return pending; } };
    widget.comicCanvasIsTracked = owner => owner === session;
    widget.adoptComicCanvas = (owner, canvas) => calls.push([owner, canvas]);
    widget.comicCanvas = session;
    const refreshing = widget.refreshComicCanvas(session);
    widget.comicCanvas = { canvasId: 'b' };
    finish({ canvas: response }); await refreshing;
    assert.deepEqual(calls, [['/project', 'a'], [session, response]]);
});

test('composition export preserves its extra canvas request and journal when the active tab changes during saving', async () => {
    const widget = methodHarness('exportComicCanvasComposition');
    const extra = { workspaceRoot: '/project', canvasId: 'extra', base: { revision: 12 }, doc: { nodes: [{ id: 'mix', kind: 'composition', title: 'My mix' }] }, submitting: new Set() };
    const main = { workspaceRoot: '/project', canvasId: 'main', submitting: new Set() };
    const requests = [], polls = [];
    let saved;
    const saving = new Promise(resolve => { saved = resolve; });
    widget.comicCanvas = extra;
    widget.activeComicWorkspaceRoot = '/project';
    widget.comicExportState = { exports: [] };
    widget.comicExportStage = 'idle';
    widget.flushComicCanvas = async owner => { assert.equal(owner, extra); await saving; };
    widget.comicCanvasIsTracked = owner => owner === extra;
    widget.comicCanvasNotice = () => assert.fail('unexpected export error');
    widget.scheduleComicCanvasPoll = owner => polls.push(owner);
    widget.update = () => undefined;
    widget.platformService = { startComicExport: async request => { requests.push(request); return { id: 'export-extra', status: 'queued' }; } };
    const exporting = widget.exportComicCanvasComposition('mix');
    widget.comicCanvas = main;
    saved(); await exporting;
    assert.equal(requests.length, 1);
    assert.equal(requests[0].canvasId, 'extra');
    assert.equal(requests[0].compositionNodeId, 'mix');
    assert.equal(requests[0].expectedCanvasRevision, 12);
    assert.deepEqual(extra.composing, { exportId: 'export-extra', nodeId: 'mix' });
    assert.equal(main.composing, undefined);
    assert.deepEqual(polls, [extra]);
});

test('composition completion polls and refreshes the captured owner while another project is active', async () => {
    const widget = methodHarness('followComicCanvasComposition');
    const extra = { workspaceRoot: '/project-a', canvasId: 'extra', composing: { exportId: 'export-extra', nodeId: 'mix' } };
    const otherState = { exports: [{ id: 'other-export', status: 'running' }] };
    const reads = [], refreshed = [], notices = [];
    widget.comicCanvas = { workspaceRoot: '/project-b', canvasId: 'other-main' };
    widget.activeComicWorkspaceRoot = '/project-b';
    widget.comicExportState = otherState;
    widget.comicCanvasIsTracked = owner => owner === extra;
    widget.comicCanvasName = () => 'Scratch A';
    widget.refreshComicCanvas = async owner => refreshed.push(owner);
    widget.comicCanvasNotice = (owner, text) => notices.push([owner, text]);
    widget.platformService = { getComicExportWorkspaceState: async root => { reads.push(root); return { exports: [{ id: 'export-extra', status: 'completed' }] }; } };
    await widget.followComicCanvasComposition(extra);
    assert.deepEqual(reads, ['/project-a']);
    assert.deepEqual(refreshed, [extra]);
    assert.equal(widget.comicExportState, otherState);
    assert.equal(extra.composing, undefined);
    assert.deepEqual(notices, [[extra, 'Scratch A · composeDone']]);
});

test('a transient composition-result refresh failure keeps the owner journal for the next poll', async () => {
    const widget = methodHarness('followComicCanvasComposition');
    const composing = { exportId: 'export-extra', nodeId: 'mix' };
    const extra = { workspaceRoot: '/project', canvasId: 'extra', composing };
    widget.activeComicWorkspaceRoot = '/other';
    widget.comicCanvasIsTracked = () => true;
    widget.platformService = { getComicExportWorkspaceState: async () => ({ exports: [{ id: 'export-extra', status: 'completed' }] }) };
    widget.refreshComicCanvas = async () => { throw new Error('temporary read failure'); };
    await assert.rejects(widget.followComicCanvasComposition(extra), /temporary read failure/);
    assert.equal(extra.composing, composing);
});

test('real editor handoff waits for main sync, flushes the active tab, then opens its timeline', async () => {
    const widget = methodHarness('commitComicCanvasToEditor');
    const main = { canvasId: 'main', doc: { id: 'main', settings: {}, nodes: [], edges: [] }, base: { revision: 7 }, workspaceRoot: '/project', isMain: true, committing: false };
    const extra = { canvasId: 'extra', doc: { id: 'extra', revision: 99, settings: {}, nodes: [{ id: 'node-video', kind: 'video', title: 'Source video', position: { x: 0, y: 0 }, size: { width: 280, height: 180 }, payload: { currentVersionId: 'v1', versions: [{ id: 'v1', assetId: 'a1', kind: 'video', uri: 'nextmux.media/f.mp4', createdAt: '2026-10-03T00:00:00.000Z', metadata: { durationMs: 4000, width: 96, height: 64 } }] } }], edges: [] }, base: { revision: 99 }, workspaceRoot: '/project', isMain: false, committing: false };
    const owner = { registry: { mainCanvasId: 'main' }, sessions: new Map([['main', main], ['extra', extra]]) };
    const timeline = { id: 'timeline-extra', sourceCanvasId: 'extra', revision: 1 };
    const calls = [];
    let finishSync;
    owner.syncingMain = new Promise(resolve => { finishSync = resolve; }).then(() => calls.push('sync:main'));
    widget.comicCanvas = extra;
    widget.activeComicWorkspaceRoot = '/project';
    widget.comicDesk = { step: 'canvas' };
    widget.comicCutBusy = false;
    widget.comicCutImporting = false;
    widget.comicTimelineSequence = 0;
    widget.comicTimelineLoading = false;
    widget.desktopLocale = 'en';
    widget.comicCanvasSession = () => extra;
    widget.comicCanvasProjectOf = () => owner;
    widget.comicProject = () => ({ id: 'p', revision: 5, scenes: [] });
    widget.comicTimelineSelectionKey = () => 'selection';
    widget.applyComicTimelineState = document => calls.push(`apply:${document.id}`);
    widget.rememberNavigation = () => calls.push('remember');
    widget.persistComicDesk = () => calls.push('persist');
    widget.update = () => undefined;
    widget.comicCanvasNotice = (_session, message) => assert.fail(`unexpected failure notice: ${message}`);
    widget.flushComicCanvas = async item => calls.push(`save:${item.canvasId}`);
    widget.platformService = {
        listComicCanvasTimelines: async root => { calls.push(`list:${root}`); return []; },
        createComicCanvasTimeline: async request => { calls.push(request); return timeline; }
    };
    const committing = widget.commitComicCanvasToEditor();
    await Promise.resolve();
    assert.deepEqual(calls, []);
    assert.equal(extra.committing, true);
    finishSync();
    await committing;
    assert.deepEqual(calls.slice(0, 3), ['sync:main', 'save:extra', 'list:/project']);
    const request = calls[3];
    assert.equal(request.workspaceRoot, '/project');
    assert.equal(request.canvasId, 'extra');
    assert.equal(request.expectedCanvasRevision, 99);
    assert.match(request.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.deepEqual(calls.slice(4), ['apply:timeline-extra', 'remember', 'persist']);
    assert.equal(calls.includes('save:main'), false);
    assert.equal(widget.comicDesk.step, 'edit');
    assert.equal(extra.committing, false);
    assert.equal(widget.comicTimelineLoading, false);
});

test('real flush saves an edit made during the first save before allowing a switch', async () => {
    const widget = methodHarness('flushComicCanvas', { window: { clearTimeout: () => undefined } });
    const session = { save: 'dirty' };
    let writes = 0;
    widget.comicCanvasCanWrite = () => true;
    widget.saveComicCanvas = async item => { writes++; item.save = writes === 1 ? 'dirty' : 'saved'; };
    await widget.flushComicCanvas(session);
    assert.equal(writes, 2);
    assert.equal(session.save, 'saved');
});

test('two confirmed clicks crossing the save await submit only one owning generation', async () => {
    const widget = methodHarness('runComicCanvasNodes');
    const session = { doc: { settings: {}, nodes: [{ id: 'n', kind: 'imageGen', payload: { versions: [], jobs: [] } }], edges: [] }, submitting: new Set(), waiting: new Set() };
    let started = 0, finish;
    const generation = new Promise(resolve => { finish = resolve; });
    widget.comicCanvas = session;
    widget.comicCanvasRetryPending = () => false;
    widget.flushComicCanvas = async () => undefined;
    widget.submitComicCanvasNode = async (owner, id) => { owner.submitting.add(id); started++; await generation; owner.submitting.delete(id); };
    widget.update = () => undefined;
    widget.scheduleComicCanvasPoll = () => undefined;
    widget.comicCanvasNotice = () => assert.fail('unexpected failure');
    const first = widget.runComicCanvasNodes(['n'], true);
    const second = widget.runComicCanvasNodes(['n'], true);
    await Promise.resolve();
    assert.equal(started, 1);
    finish(); await Promise.all([first, second]);
    assert.equal(started, 1);
});

test('a cached project with new storyboard shots schedules main synchronization once per project revision', async () => {
    const widget = methodHarness('comicCanvasSession');
    const main = { canvasId: 'main', doc: {}, loading: false, isMain: true }, extra = { canvasId: 'extra', doc: { scratch: true }, loading: false, isMain: false };
    const owner = { workspaceRoot: '/project', projectId: 'p', activeCanvasId: 'extra', registry: { mainCanvasId: 'main' }, sessions: new Map([['main', main], ['extra', extra]]) };
    const project = { id: 'p', title: 'Project', revision: 5 };
    const calls = [];
    let finish;
    widget.comicCanvasProjects = new Map([['cache', owner]]);
    widget.comicDesk = { workspaceRoot: '/project', projectId: 'p' };
    widget.comicProject = () => project;
    widget.comicCanvasProjectKey = () => 'cache';
    widget.comicCanvasMissesProject = () => true;
    widget.synchronizeComicCanvasMain = async (target, snapshot) => { calls.push([target, snapshot]); await new Promise(resolve => { finish = resolve; }); };
    widget.update = () => undefined;
    assert.equal(widget.comicCanvasSession(), extra);
    assert.equal(widget.comicCanvasSession(), extra);
    assert.deepEqual(calls, [[owner, project]]);
    assert.equal(owner.mainSyncRevision, 5);
    finish(); await owner.syncingMain;
    assert.equal(widget.comicCanvasSession(), extra);
    assert.equal(calls.length, 1);
    assert.deepEqual(extra.doc, { scratch: true });
});

test('real cached resume seeds main through adoption and leaves scratch contents and owning queued jobs intact', async () => {
    const widget = methodHarness('synchronizeComicCanvasMain');
    const main = { workspaceRoot: '/project', canvasId: 'main', doc: { id: 'main', queuedJob: 'owner-main' }, loading: false, isMain: true };
    const extra = { canvasId: 'extra', doc: { id: 'extra', prompt: 'scratch', queuedJob: 'owner-extra' }, isMain: false };
    const owner = { registry: { mainCanvasId: 'main' }, sessions: new Map([['main', main], ['extra', extra]]) };
    const calls = [];
    const seeded = { id: 'main', queuedJob: 'owner-main', newShot: 'shot-2' };
    widget.flushComicCanvas = async session => calls.push(`save:${session.canvasId}`);
    widget.comicCanvasCanWrite = () => true;
    widget.comicCanvasMissesProject = () => true;
    widget.seedComicCanvasNow = async session => { calls.push(`seed:${session.canvasId}`); return { canvas: seeded }; };
    widget.adoptComicCanvas = (session, canvas) => { calls.push(`adopt:${session.canvasId}`); session.doc = canvas; };
    widget.scheduleComicCanvasPoll = session => calls.push(`poll:${session.canvasId}`);
    widget.comicCanvasNotice = () => assert.fail('unexpected failure notice');
    widget.platformService = { getComicCanvas: async (root, id) => { calls.push(`read:${id}`); return { exists: true, canvas: main.doc }; } };
    await widget.synchronizeComicCanvasMain(owner, { id: 'p' });
    assert.deepEqual(calls, ['save:main', 'read:main', 'seed:main', 'adopt:main', 'poll:main']);
    assert.equal(main.doc, seeded);
    assert.equal(main.doc.queuedJob, 'owner-main');
    assert.deepEqual(extra.doc, { id: 'extra', prompt: 'scratch', queuedJob: 'owner-extra' });
});

test('registry rename updates scratch undo snapshots so later node edits cannot restore the old canvas name', () => {
    const widget = methodHarness('adoptComicCanvasRegistry');
    const extra = { canvasId: 'extra', canvasName: 'old', isMain: false, doc: { title: 'old' }, past: [{ title: 'old', nodeX: 1 }], future: [{ title: 'old', nodeX: 2 }] };
    const owner = { sessions: new Map([['extra', extra]]), registry: { revision: 1 } };
    widget.update = () => undefined;
    widget.createComicCanvasSession = () => assert.fail('should reuse existing session');
    widget.adoptComicCanvasRegistry(owner, { revision: 2, mainCanvasId: 'main', canvases: [{ id: 'extra', title: 'new' }] });
    assert.equal(extra.canvasName, 'new');
    assert.equal(extra.doc.title, 'new');
    assert.deepEqual(extra.past, [{ title: 'new', nodeX: 1 }]);
    assert.deepEqual(extra.future, [{ title: 'new', nodeX: 2 }]);
    widget.adoptComicCanvasRegistry(owner, { revision: 1, mainCanvasId: 'main', canvases: [{ id: 'extra', title: 'stale' }] });
    assert.equal(extra.canvasName, 'new');
});

test('real pending deletion recovery finalizes an already-Trashed directory without moving twice', async () => {
    const moves = [];
    const widget = methodHarness('resolvePendingComicCanvasDelete', { window: { nextmuxDesktop: { trashFolder: async path => { moves.push(path); return true; } } } });
    const owner = { workspaceRoot: '/project', registry: { canvases: [{ id: 'a', deletionPending: true }] } };
    const final = { canvases: [{ id: 'a', deletedAt: 'now' }] };
    widget.currentComicCanvasProjectSession = () => owner;
    widget.queueComicCanvasTabAction = (_owner, action) => action();
    widget.adoptComicCanvasRegistry = (_owner, registry) => { owner.registry = registry; };
    widget.platformService = { finalizeDeleteComicCanvas: async () => final };
    await widget.resolvePendingComicCanvasDelete('a');
    assert.deepEqual(moves, []);
    assert.equal(owner.registry, final);
});

test('real pending deletion recovery retries native Trash when the directory still exists', async () => {
    const calls = [];
    const widget = methodHarness('resolvePendingComicCanvasDelete', { window: { nextmuxDesktop: { trashFolder: async path => { calls.push(`trash:${path}`); return true; } } } });
    const pending = { canvases: [{ id: 'a', deletionPending: true }] }, final = { canvases: [{ id: 'a', deletedAt: 'now' }] };
    const owner = { workspaceRoot: '/project', registry: pending };
    widget.currentComicCanvasProjectSession = () => owner;
    widget.queueComicCanvasTabAction = (_owner, action) => action();
    widget.adoptComicCanvasRegistry = (_owner, registry) => { owner.registry = registry; };
    widget.platformService = {
        finalizeDeleteComicCanvas: async () => { calls.push('finalize'); if (calls.length === 1) throw { code: 'CANVAS_TRASH_REQUIRED' }; return final; },
        deleteComicCanvas: async () => { calls.push('prepare'); return { registry: pending, trashPath: '/project/extra/a' }; }
    };
    await widget.resolvePendingComicCanvasDelete('a');
    assert.deepEqual(calls, ['finalize', 'prepare', 'trash:/project/extra/a', 'finalize']);
    assert.equal(owner.registry, final);
});

test('close confirmation covers dirty, saving, failed and unresolved load errors', () => {
    for (const save of ['dirty', 'saving', 'failed']) assert.equal(comicCanvasTabNeedsCloseConfirmation({ save }), true);
    assert.equal(comicCanvasTabNeedsCloseConfirmation({ save: 'saved', saving: Promise.resolve() }), true);
    assert.equal(comicCanvasTabNeedsCloseConfirmation({ save: 'saved', error: 'load failed' }), true);
    assert.equal(comicCanvasTabNeedsCloseConfirmation({ save: 'saved' }), false);
});

test('horizontal tab keys wrap, respect Home/End and leave IME and editing shortcuts alone', () => {
    const ids = ['a', 'b', 'c'];
    assert.equal(comicCanvasTabKeyTarget(ids, 'a', { key: 'ArrowLeft' }), 'c');
    assert.equal(comicCanvasTabKeyTarget(ids, 'c', { key: 'ArrowRight' }), 'a');
    assert.equal(comicCanvasTabKeyTarget(ids, 'b', { key: 'Home' }), 'a');
    assert.equal(comicCanvasTabKeyTarget(ids, 'b', { key: 'End' }), 'c');
    for (const extra of [{ isComposing: true }, { keyCode: 229 }, { editable: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
        assert.equal(comicCanvasTabKeyTarget(ids, 'b', { key: 'ArrowLeft', ...extra }), undefined);
    }
    for (const key of ['ArrowUp', 'ArrowDown', 'Tab', 'Delete']) assert.equal(comicCanvasTabKeyTarget(ids, 'b', { key }), undefined);
    assert.equal(comicCanvasTabKeyTarget([], 'a', { key: 'Home' }), undefined);
});

test('every tab label, action and known error has copy in all twelve locales', () => {
    assert.equal(COMIC_CANVAS_TABS_LOCALES.length, 12);
    for (const locale of COMIC_CANVAS_TABS_LOCALES) {
        for (const key of ['main', 'free', 'closeTitle', 'closeBody', 'return', 'close', 'mainLocked', 'tabFailed', 'copyDone']) {
            assert.notEqual(canvasTabsText(locale, key, { name: 'Canvas A', error: 'error', x: 100, y: 200 }), key);
        }
        for (const key of ['tabs', 'create', 'reopen', 'copyToMain', 'deleteTitle', 'deleteBody', 'closeTab']) assert.notEqual(canvasTabsActionText(locale, key), key);
        for (const code of ['INVALID_NAME', 'DUPLICATE_FOLDER_NAME', 'FOLDER_NOT_FOUND', 'CANVAS_BUSY', 'INVALID_COVER', 'INVALID_CANVAS_ORDER', 'NO_CURRENT_RESULT', 'CANVAS_SAVE_FAILED', 'MAIN_CANVAS_PROTECTED', 'SOMETHING_NEW']) {
            const text = comicCanvasTabsErrorText(locale, { code, message: 'private diagnostic text' });
            assert.ok(text.length > 5);
            assert.ok(!text.includes('private diagnostic'));
        }
    }
    assert.equal(comicCanvasTabsErrorText('xx', { code: 'INVALID_NAME' }), comicCanvasTabsErrorText('en', { code: 'INVALID_NAME' }));
});

test('RPC requests carry captured ownership and pending Trash has a recoverable UI path', () => {
    assert.match(source, /runComicCanvasNode\(\{ workspaceRoot: session\.workspaceRoot, canvasId: session\.canvasId/);
    assert.match(source, /saveComicCanvas\(\{ workspaceRoot: session\.workspaceRoot, canvasId: session\.canvasId/);
    assert.match(source, /getComicCanvasToolJob\(session\.workspaceRoot, requestId, session\.canvasId\)/);
    assert.match(source, /cancelComicCanvasTool\(session\.workspaceRoot, entry\.requestId, session\.canvasId\)/);
    assert.match(source, /resolvePendingComicCanvasDelete\(canvasId: string\)/);
    assert.match(source, /CANVAS_TRASH_REQUIRED/);
    assert.match(source, /<ComicCanvas key=\{session\.canvasId\}/);
});
