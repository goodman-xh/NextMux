import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { applyCanvasCommand, createCanvasDocument } from '@nextmux/comic-core/canvas';
import { createCanvasNode, placeCanvasNode } from '../lib/browser/nextmux-comic-canvas-logic.js';

// The production desk methods, run as written (no copied logic): sequel, restored desk, landing page, confirmed re-adaptation.
const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['startComicScriptAdaptation', 'runComicSequel', 'readaptComicStory', 'openComicDesk', 'deskUnsplitEpisodes', 'comicLandingView', 'runDeskSplit']);
const methods = [];
(function visit(node) {
    if (ts.isMethodDeclaration(node) && names.has(node.name.getText(ast))) methods.push(node.getText(ast));
    ts.forEachChild(node, visit);
})(ast);
assert.equal(methods.length, names.size);
const compiled = ts.transpileModule(`
import { modelFailure, modelFailureText } from ${JSON.stringify(new URL('../lib/browser/nextmux-model-errors.js', import.meta.url).href)};
const briefs = [];
export const recorded = { briefs };
const normalizeComicAdaptSettings = value => ({ episodes: 2, episodeSeconds: 60, ...value });
const adaptComicHierarchically = async options => { if (options.sourceText === 'FAIL_RANGE') throw Object.assign(new Error('chunk failed (source characters 5001–6000)'), { code: 'COMIC_HIERARCHY_FAILED' }); briefs.push(options); const first = options.sequel ? Math.max(...options.sequel.episodes.map(episode => episode.number)) + 1 : 1; return { title: '故乡', styleBible: 'ink wash', characters: [], episodes: Array.from({length: options.settings.episodes}, (_, index) => ({number:first+index,title:'Episode',script:'…',sourceRange:{start:0,end:options.sourceText.length}})) }; };
const comicTextLanguage = (_text, fallback) => fallback;
const comicEpisodeShotInstructions = () => 'shots';
const comicPlanningTokens = () => 100;
const planComicEpisodeStoryboards = async () => { throw Object.assign(new Error('Episode 1 shot generation failed (source characters 11–30)'), { code: 'COMIC_HIERARCHY_FAILED' }); };
const deskText = (_locale, key) => key;
const plannedClipSeconds = () => [];
const videoModelUsesReferences = () => false;
const window = { crypto: { randomUUID: () => 'comic-plan-id' }, localStorage: { getItem: () => null, setItem() {} }, setTimeout: () => 0 };
const { createCanvasNode, placeCanvasNode, applyCanvasCommand } = globalThis.__nmxSequelCanvasDeps;
export class Harness { ${methods.join('\n')} }
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React } }).outputText;
globalThis.__nmxSequelCanvasDeps = { createCanvasNode, placeCanvasNode, applyCanvasCommand };
const { Harness } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const shot = (id, video) => ({ id, ...(video ? { videoAssetId: `${id}-video` } : {}) });
function project(episodes, scenes) {
    return { id: 'project-1', revision: 3, title: '故乡', styleBible: 'ink wash', canvas: { aspectRatio: '9:16' }, characters: [],
        episodes: episodes.map(number => ({ number, title: `第${number}集`, script: `第${number}集的剧本……结尾${number}` })), scenes,
        assets: scenes.flatMap(scene => scene.shots.filter(item => item.videoAssetId).map(item => ({ id: item.videoAssetId, kind: 'video', status: 'ready' }))) };
}
function harness(initial) {
    const h = new Harness();
    const splits = [];
    Object.assign(h, {
        activeComicWorkspaceRoot: '/comic', comicAdaptation: { status: 'idle' }, comicStage: 'idle', comicState: { project: initial, production: { revision: 7, script: { text: '前文' } } },
        comicAdaptSettings: { episodes: 2 }, comicReadaptConfirmUntil: 0, desktopLocale: 'zh-CN', updates: 0, splits,
        comicProject() { return this.comicState.project; }, update() { this.updates++; }, persistComicDesk() {}, startComicDeskTimer() {},
        refreshComicCharacterLibrary: async () => {}, deskVideoFacts: async () => undefined, loadComicProject: async () => {}, notifySystemTask() {},
        comicTextRoute: () => ({ route: { kind: 'official' } }), comicAgentRoute: () => ({ kind: 'official_connection', connectionId: 'text' }),
        comicLanguageName: () => 'Simplified Chinese', ct: key => key, tx: key => key, comicDeskStorageKey: id => `desk:${id}`,
        comicAllShots: value => value.scenes.flatMap(scene => scene.shots),
        comicShotHasVideo: (value, item) => Boolean(item.videoAssetId && value.assets.some(asset => asset.id === item.videoAssetId && asset.status === 'ready')),
        comicProjectKind: value => value?.projectKind || 'novel',
        comicStepsFor: kind => kind === 'image' ? [['images', 'stepImages']] : [['script', 'stepStory'], ['storyboard', 'stepStoryboard']],
        async deskCommand(build) { const command = build(this.comicState.project); if (command?.patch) this.comicState.project = { ...this.comicState.project, ...command.patch }; return this.comicState.project; },
        runDeskSplit: async function () { splits.push([...this.comicDesk.splitQueue]); },
    });
    return h;
}

test('a sequel appends only the new source and leaves the filmed episodes untouched', async () => {
    const filmed = [{ id: 's1', episodeNumber: 1, shots: [shot('a', true)] }, { id: 's2', episodeNumber: 2, shots: [shot('b', true)] }];
    const h = harness(project([1, 2], filmed));
    h.comicDesk = { projectId: 'project-1', workspaceRoot: '/comic', shooting: true, paused: false, splitQueue: [], redo: new Set(), looks: {}, drafts: new Map() };
    h.comicSequel = { workspaceRoot: '/comic', text: '第三章 续写的故事' };
    const adapted = [];
    h.startComicScriptAdaptation = async (...args) => { adapted.push(args); };
    let saved;
    h.platformService = {
        updateComicScript: async request => { saved = request; return { project: h.comicState.project, production: { revision: 8, script: { text: request.scriptText } } }; }
    };
    await h.runComicSequel();
    assert.equal(saved.scriptText, '前文\n\n第三章 续写的故事', 'the story keeps the whole text');
    assert.equal(saved.workspaceRoot, '/comic');
    assert.equal(saved.language, 'zh-CN');
    assert.equal(saved.expectedRevision, 7);
    assert.deepEqual(adapted, [['/comic', '第三章 续写的故事', 'append']], 'only the complete new source is adapted, as an append');
    assert.equal(h.comicState.project.scenes, filmed);
    assert.equal(h.comicScriptDraft, '前文\n\n第三章 续写的故事');
    assert.equal(h.comicScriptDirty, false);
    assert.equal(h.comicSequel, undefined);
});

test('re-adapting everything stops filming the old shots and, with clips filmed, needs a second press', async () => {
    const filmed = [{ id: 's1', episodeNumber: 1, shots: [shot('a', true)] }];
    const h = harness(project([1], filmed));
    let runs = 0;
    h.startComicScriptAdaptation = async (_root, story, mode) => { runs++; assert.equal(story, '全文'); assert.equal(mode, undefined); };
    h.readaptComicStory('全文');
    assert.equal(runs, 0, 'the first press only asks');
    assert.ok(h.comicReadaptConfirmUntil > Date.now());
    h.readaptComicStory('全文');
    assert.equal(runs, 1);
    const fresh = harness(project([1], [{ id: 's1', episodeNumber: 1, shots: [shot('a', false)] }]));
    let direct = 0;
    fresh.startComicScriptAdaptation = async () => { direct++; };
    fresh.readaptComicStory('全文');
    assert.equal(direct, 1, 'nothing filmed: no confirmation needed');
});

test('a desk restored after a restart or another project identifies episodes without shots and opens on canvas without auto-splitting', () => {
    const h = harness(project([1, 2, 3], [{ id: 's1', episodeNumber: 1, shots: [shot('a', true)] }, { id: 's2', episodeNumber: 2, shots: [] }]));
    assert.deepEqual(h.deskUnsplitEpisodes(h.comicState.project), [2, 3]);
    h.openComicDesk('shoot');
    assert.equal(h.comicDesk.step, 'canvas');
    assert.deepEqual(h.comicDesk.splitQueue, []);
    assert.equal(h.splits.length, 0);
    const writing = harness(project([1, 2], []));
    writing.openComicDesk('scripts', { adapting: true });
    assert.equal(writing.splits.length, 0, 'a desk opened to write scripts leaves splitting to the adaptation');
});

test('a project opens on its own page, not the one the previous project was on', () => {
    const h = harness(project([1, 2], []));
    const done = project([1], [{ id: 's1', episodeNumber: 1, shots: [shot('a', true)] }]);
    assert.equal(h.comicLandingView(done), 'timeline', 'a finished film opens in the editor');
    // A desk novel has no separate 原文 page any more: the studio shows its shot list and the production desk opens on top.
    assert.equal(h.comicLandingView(project([1, 2], [{ id: 's1', episodeNumber: 1, shots: [shot('a', true), shot('b', false)] }])), 'storyboard', 'a desk novel opens under its desk');
    assert.equal(h.comicLandingView({ ...project([], [{ id: 's1', shots: [shot('a', false)] }]), episodes: undefined, projectKind: 'topic' }), 'storyboard');
    assert.equal(h.comicLandingView({ ...project([], []), episodes: undefined, projectKind: 'image' }), 'images');
});


test('Chinese UI keeps the exact unprocessed source in the canvas story node it plans', async () => {
    const h = harness(project([1], []));
    const doc = createCanvasDocument({ id: 'canvas-1', projectId: 'project-1', now: '2026-10-03T00:00:00Z' });
    const session = { workspaceRoot: '/comic', projectId: 'project-1', canvasId: 'canvas-1', doc, base: doc };
    const planned = [];
    h.comicCanvasSession = () => session;
    h.comicCanvasIsTracked = owner => owner === session;
    h.changeComicCanvasSession = (owner, next) => { owner.doc = next; };
    h.flushComicCanvas = async owner => { assert.equal(owner, session); };
    h.planComicCanvasStory = async (owner, nodeId) => { planned.push([owner, nodeId]); };
    const story = '第一章 开端\n\n第二章 转折……'.repeat(400);
    await h.startComicScriptAdaptation('/comic', story);
    const node = session.doc.nodes.find(item => item.kind === 'text');
    assert.equal(node.title, '故事', 'the Chinese UI labels the source node');
    assert.equal(node.payload.text, story, 'the whole unprocessed source is kept, not a truncated chunk');
    assert.deepEqual(planned, [[session, node.id]], 'planning starts from the exact source node');
    assert.equal(h.comicState.project.scenes.length, 0, 'adaptation no longer writes episodes itself');
});


test('Chinese storyboard UI keeps the failed episode and exact script range visible', async () => {
    const h = harness(project([1], []));
    h.comicDesk = { workspaceRoot: '/comic', projectId: 'project-1', splitQueue: [1], splitting: false };
    h.platformService = { getComicTextModelLimits: async () => ({ contextWindowTokens: 4096 }) };
    h.deskAdvance = () => {};
    await Harness.prototype.runDeskSplit.call(h);
    assert.match(h.comicDesk.splitError, /Episode 1.*source characters 11–30/);
    assert.deepEqual(h.comicDesk.splitQueue, [1], 'the failed episode remains queued for retry');
});
