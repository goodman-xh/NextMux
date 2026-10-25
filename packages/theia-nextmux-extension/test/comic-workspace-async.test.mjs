import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

// Run the production renderer methods with delayed RPCs; no copied race logic.
const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['comicWorkspaceRequestCurrent', 'createComicProject', 'commitComicCommand',
    'saveComicScript', 'applyComicScriptAnalysis', 'importComicCharacterFromLibrary', 'saveComicCharacterToLibrary',
    'onComicFileChanged', 'selectComicWorkspaceRoot', 'resetComicSelection', 'loadComicProject',
    'startComicExport', 'cancelComicExport']);
const methods = [];
function visit(node) {
    if (ts.isMethodDeclaration(node) && names.has(node.name.getText(ast))) methods.push(node.getText(ast));
    ts.forEachChild(node, visit);
}
visit(ast);
assert.equal(methods.length, names.size);
const compiled = ts.transpileModule(`
import { modelFailureText } from ${JSON.stringify(new URL('../lib/browser/nextmux-model-errors.js', import.meta.url).href)};
const localizeDesktopSurface = (_locale, text) => text;
const EMPTY_COMIC_STATE = { exists: false };
const EMPTY_MEDIA_STATE = { jobs: [] };
const window = { localStorage: { getItem: () => null } };
const URI = { fromFilePath: path => path };
export class Harness { ${methods.join('\n')} }
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { Harness } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const nextTick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function state(root) {
    return { exists: true, sha256: root, project: { id: root, title: root, revision: 1 },
        production: { revision: 1, script: { text: `${root} script` }, scriptAnalysis: { status: 'ready' } } };
}
function fixture() {
    const h = new Harness();
    Object.assign(h, {
        activeComicWorkspaceRoot: '/A', comicWorkspaceRoot: '/A', comicLoadSequence: 0,
        comicWorkspaceOptions: [{ path: '/A' }, { path: '/B' }], comicState: state('/A'),
        comicStage: 'idle', comicExportStage: 'idle', comicExternalChange: false, comicPrompt: 'A input',
        comicCreateDraft: { title: 'A project', frameRate: 24, aspectRatio: '16:9', starter: 'empty', scriptText: 'A script', target: 'workspace' },
        comicScriptDirty: true, comicScriptDraft: 'edited A script', comicCharacterLibraryBusy: false,
        comicCharacterDraft: { characterId: 'A-character', authorizationRef: 'A-license' },
        comicCharacterLibrarySelection: 'A-library-entry', comicCharacterLibraryAuthorization: 'A-license',
        comicExportState: { exports: [] }, comicExportDraft: { fileName: 'A export', quality: 'draft', subtitleMode: 'sidecar' },
        updates: 0, syncs: 0, notifications: [], navigationCompleted: 0,
        update() { this.updates++; }, syncComicSelection() { this.syncs++; },
        comicProject() { return this.comicState.project; }, comicHasDirtyDraft: () => false, comicLandingView: () => 'storyboard',
        comicCanvasFor: () => ({ width: 1920, height: 1080 }),
        completeNavigationSurface() { this.navigationCompleted++; },
        releaseComicVisualPreview() {}, setComicPrompt() {}, persistComicWorkspaceSelection() {},
        loadMediaState() {}, loadComicExportState() {}, refreshComicCharacterLibrary() {}, loadComicLibrary: async () => {}, setComicView() {}, ct: key => key, comicTextRoute: () => ({ id: 'text-route' }), startComicScriptAdaptation: async () => {},
        addNotification(...args) { this.notifications.push(args); },
        fileService: { watch: () => ({ dispose() {} }) },
        platformService: { getComicProject: async root => state(root) }
    });
    return h;
}
function snapshot(h) {
    return JSON.stringify({ state: h.comicState, root: h.comicWorkspaceRoot, stage: h.comicStage,
        exportStage: h.comicExportStage, exports: h.comicExportState, exportError: h.comicExportError,
        message: h.comicMessage, error: h.comicError, dirty: h.comicScriptDirty, script: h.comicScriptDraft,
        busy: h.comicCharacterLibraryBusy, selection: h.comicCharacterLibrarySelection,
        authorization: h.comicCharacterLibraryAuthorization, external: h.comicExternalChange,
        updates: h.updates, syncs: h.syncs, notifications: h.notifications, navigation: h.navigationCompleted });
}
async function switchWorkspace(h, returnToA = false) {
    h.selectComicWorkspaceRoot('/B');
    await nextTick();
    if (returnToA) {
        h.selectComicWorkspaceRoot('/A');
        await nextTick();
    }
    // A newer action/draft must not be cleared by the old action's finally.
    h.comicStage = 'saving';
    h.comicExportStage = 'starting';
    h.comicScriptDraft = 'new owner unsaved draft';
    h.comicScriptDirty = true;
    h.comicCharacterLibraryBusy = true;
    h.comicCharacterLibrarySelection = 'new selection';
    h.comicCharacterLibraryAuthorization = 'new authorization';
    h.comicMessage = 'new owner message';
    h.comicError = 'new owner error';
    h.comicExportError = 'new owner export error';
}
const operations = [
    ['createComicProject', 'createComicProject', []],
    ['commitComicCommand', 'applyComicCommand', [{ type: 'shot.update' }, 'saved']],
    ['saveComicScript', 'updateComicScript', []],
    ['applyComicScriptAnalysis', 'applyComicAnalysis', []],
    ['importComicCharacterFromLibrary', 'importComicCharacterFromLibrary', []],
    ['saveComicCharacterToLibrary', 'saveComicCharacterToLibrary', []],
    ['startComicExport', 'startComicExport', []],
    ['cancelComicExport', 'cancelComicExport', ['A-export']]
];
for (const [method, rpc, args] of operations) {
    for (const [label, reject, returnToA] of [['success after A→B', false, false],
        ['failure after A→B', true, false], ['success after A→B→A', false, true]]) {
        test(`${method}: ${label} cannot overwrite the current workspace`, async () => {
            const h = fixture();
            const pending = deferred();
            const saved = new Map();
            let requestRoot;
            h.platformService[rpc] = async request => {
                requestRoot = typeof request === 'string' ? request : request.workspaceRoot;
                const value = await pending.promise;
                saved.set(requestRoot, value);
                return value;
            };
            const operation = h[method](...args);
            assert.equal(requestRoot, '/A');
            await switchWorkspace(h, returnToA);
            const before = snapshot(h);
            if (reject) pending.reject(Object.assign(new Error('old A error'), { code: 'REVISION_CONFLICT' }));
            else pending.resolve(state('/A-saved'));
            const result = await operation;
            assert.equal(snapshot(h), before);
            if (!reject) assert.equal(saved.get('/A').project.id, '/A-saved', 'the already submitted save still completes for A');
            if (method === 'commitComicCommand') assert.equal(result, undefined, 'callers must not apply stale follow-up drafts');
        });
    }
}

test('normal saves still apply their result when the workspace did not change', async () => {
    const h = fixture();
    const saved = state('/A-saved');
    h.platformService.applyComicCommand = async () => saved;
    assert.equal(await h.commitComicCommand({}, 'saved'), saved);
    assert.equal(h.comicState, saved);
    assert.equal(h.comicWorkspaceRoot, '/A');
    assert.equal(h.comicMessage, 'saved');
    assert.equal(h.comicStage, 'idle');
});

for (const reject of [false, true]) {
    test(`external file read ${reject ? 'failure' : 'success'} cannot cross a workspace switch`, async () => {
        const h = fixture();
        const pending = deferred();
        const requested = deferred();
        h.platformService.getComicProject = root => {
            if (root === '/A') { requested.resolve(); return pending.promise; }
            return Promise.resolve(state(root));
        };
        const operation = h.onComicFileChanged();
        await requested.promise;
        await switchWorkspace(h);
        const before = snapshot(h);
        if (reject) pending.reject(new Error('old file read failed'));
        else pending.resolve(state('/A-external'));
        await operation;
        assert.equal(snapshot(h), before);
    });
}
