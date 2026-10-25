import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { sourceModule } from './helpers/comic-organizer-source-loader.mjs';

const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const methodNames = new Set(['closeCanvasShortcut', 'closeComicCanvasTab', 'queueComicCanvasTabAction', 'closeTopLayer']);
const methods = [], callbacks = new Map();
(function visit(node) {
    if (ts.isMethodDeclaration(node) && methodNames.has(node.name.getText(ast))) methods.push(node.getText(ast));
    if (ts.isVariableDeclaration(node) && ['closeWindowShortcut', 'closeTopLayerForShell'].includes(node.name.getText(ast))) callbacks.set(node.name.getText(ast), node.initializer.getText(ast));
    ts.forEachChild(node, visit);
})(ast);
assert.equal(methods.length, methodNames.size, 'all actual close methods must exist');
assert.equal(callbacks.size, 2, 'both actual entry points are exercised');
const nativeSource = await readFile(new URL('../../../apps/desktop/updater.cjs', import.meta.url), 'utf8');
const nativeAst = ts.createSourceFile('updater.cjs', nativeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let nativeClose, nativeKey;
(function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'closeTopLayerOrWindow') nativeClose = node.getText(nativeAst);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'on'
        && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'before-input-event') nativeKey = node.arguments[1].getText(nativeAst);
    ts.forEachChild(node, visit);
})(nativeAst);
assert.ok(nativeClose && nativeKey);
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function fixture({ save = 'saved', onlyMain = false } = {}) {
    const calls = { windowClose: 0, bridgeClose: 0, saves: [], setOpen: [], top: 0, fullscreen: 0, notices: [] };
    const document = { fullscreenElement: undefined, querySelector: () => undefined, exitFullscreen: async () => { calls.fullscreen++; } };
    const desktopBridge = { closeDesktopWindow: () => { calls.bridgeClose++; } };
    const deps = { document, desktopBridge, OS: { type: () => 'mac', Type: { OSX: 'mac' } },
        ...sourceModule('browser/nextmux-comic-canvas-tabs.ts'), canvasTabsText: (_locale, key) => key,
        comicCanvasTabsErrorText: (_locale, error) => error.message || error.code, Element: class {} };
    const Class = new Function('deps', compile(`const {${Object.keys(deps).join(',')}}=deps;class Widget{${methods.join('\n')}
        callbacks(){return {renderer:${callbacks.get('closeWindowShortcut')},shell:${callbacks.get('closeTopLayerForShell')}}}}
        `) + ';return Widget;')(deps);
    const main = { canvasId: 'main', projectId: 'p', workspaceRoot: '/project', canvasName: 'Main', isMain: true, save: 'saved', doc: {} };
    const free = { canvasId: 'free', projectId: 'p', workspaceRoot: '/project', canvasName: 'Free', isMain: false, save, doc: {} };
    const owner = { workspaceRoot: '/project', projectId: 'p', activeCanvasId: onlyMain ? 'main' : 'free', sessions: new Map([['main', main], ...(!onlyMain ? [['free', free]] : [])]),
        registry: { mainCanvasId: 'main', canvases: [{ id: 'main', kind: 'main', isOpen: true }, ...(!onlyMain ? [{ id: 'free', kind: 'free', isOpen: true }] : [])] } };
    const widget = Object.assign(new Class(), { activeSection: 'comic', activeComicWorkspaceRoot: '/project', desktopLocale: 'en', onboardingStep: 'done',
        comicDesk: { visible: true, step: 'canvas', workspaceRoot: '/project', projectId: 'p' }, comicCanvas: onlyMain ? main : free,
        node: { querySelectorAll: () => [] }, update() {}, currentComicCanvasProjectSession: () => owner,
        comicCanvasSession: () => widget.comicCanvas, comicCanvasProjectOf: session => owner.sessions.get(session.canvasId) === session ? owner : undefined,
        comicCanvasName: session => session.canvasName, comicCanvasNotice: (session, message) => calls.notices.push({ id: session.canvasId, message }),
        flushComicCanvas: async session => { calls.saves.push(session.canvasId); if (widget.onSave) await widget.onSave(session); session.save = 'saved'; },
        activateComicCanvasTab: async (scope, id) => { scope.activeCanvasId = id; widget.comicCanvas = scope.sessions.get(id); },
        adoptComicCanvasRegistry: (scope, registry) => { scope.registry = registry; },
        platformService: { setComicCanvasOpen: async request => { calls.setOpen.push(request); return { ...owner.registry, canvases: owner.registry.canvases.map(item => item.id === request.canvasId ? { ...item, isOpen: request.open } : item) }; } }
    });
    const handlers = widget.callbacks();
    const shellWindow = { __nextmuxCloseTopLayer: handlers.shell };
    const nativeWindow = { isDestroyed: () => false, close: () => { calls.windowClose++; }, webContents: {
        executeJavaScript: async code => vm.runInNewContext(code, { window: shellWindow, document }), sendInputEvent: () => assert.fail('macOS must not replay the close key') } };
    // Run the real main-process expression, not a test approximation of the hook's boolean contract.
    const mainClose = new Function('setTimeout', `const TOP_LAYER_ANSWER_MS=600;${nativeClose};return closeTopLayerOrWindow;`)(() => 0);
    const pending = [];
    const key = new Function('window', 'process', 'closeTopLayerOrWindow', `let replayingCloseKey=false;return ${nativeKey};`)(nativeWindow, { platform: 'darwin' },
        (...args) => { const promise = mainClose(...args); pending.push(promise); return promise; });
    const native = async (overrides = {}) => {
        const event = { prevented: false, preventDefault() { this.prevented = true; } };
        key(event, { type: 'keyDown', key: 'w', meta: true, control: false, alt: false, shift: false, ...overrides });
        await Promise.all(pending.splice(0)); return event;
    };
    const renderer = (overrides = {}) => {
        const event = { key: 'w', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, isComposing: false,
            prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...overrides };
        handlers.renderer(event); return event;
    };
    const settled = async () => { if (owner.switching) await owner.switching.catch(() => undefined); await tick(); };
    return { widget, owner, main, free, calls, document, handlers, native, renderer, settled };
}

test('native CmdW consumes synchronously and closes the current canvas tab without invoking window close', async () => {
    const f = fixture(), gate = deferred(); f.widget.onSave = () => gate.promise;
    assert.equal((await f.native()).prevented, true);
    assert.equal(f.calls.windowClose, 0); assert.equal(f.owner.activeCanvasId, 'free'); assert.equal(f.calls.setOpen.length, 0);
    gate.resolve(); await f.settled();
    assert.equal(f.owner.activeCanvasId, 'main'); assert.equal(f.owner.registry.canvases.find(item => item.id === 'free').isOpen, false);
    assert.equal(f.calls.windowClose, 0); assert.equal(f.calls.bridgeClose, 0); assert.deepEqual(f.calls.saves, ['free']);
});

test('renderer CmdW uses the same canvas handling, while topmost layers retain priority in both entry points', async () => {
    const f = fixture(); const event = f.renderer(); assert.equal(event.prevented && event.stopped, true); await f.settled();
    assert.equal(f.calls.setOpen.length, 1); assert.equal(f.calls.bridgeClose, 0);
    for (const entry of ['native', 'renderer']) {
        const modal = fixture(); modal.widget.node.querySelectorAll = () => [{ disabled: false, click() { modal.calls.top++; } }];
        await modal[entry](); await modal.settled();
        assert.equal(modal.calls.top, 1); assert.equal(modal.calls.saves.length, 0); assert.equal(modal.calls.setOpen.length, 0);
        assert.equal(modal.calls.windowClose + modal.calls.bridgeClose, 0);
    }
});

test('editing, coding, hidden desk and another workspace preserve existing window-close behavior', async () => {
    for (const mutate of [f => { f.widget.comicDesk.step = 'edit'; }, f => { f.widget.activeSection = 'coding'; },
        f => { f.widget.comicDesk.visible = false; }, f => { f.widget.activeComicWorkspaceRoot = '/other'; }]) {
        for (const entry of ['native', 'renderer']) {
            const f = fixture(); mutate(f); assert.equal(f.widget.closeCanvasShortcut(), undefined);
            await f[entry](); await f.settled();
            assert.equal(f.calls.windowClose + f.calls.bridgeClose, 1); assert.equal(f.calls.setOpen.length, 0);
        }
    }
});

test('dirty close confirmation, cancellation and save failure keep the window and original canvas', async () => {
    const dirty = fixture({ save: 'dirty' }); await dirty.native(); await dirty.settled();
    assert.ok(dirty.widget.comicDeskConfirm); assert.equal(dirty.calls.saves.length, 0); assert.equal(dirty.calls.windowClose, 0);
    dirty.widget.comicDeskConfirm.actions[0].onClick(); assert.equal(dirty.widget.comicDeskConfirm, undefined);
    assert.equal(dirty.owner.activeCanvasId, 'free'); assert.equal(dirty.owner.registry.canvases.find(item => item.id === 'free').isOpen, true);
    await dirty.native(); dirty.widget.onSave = async () => { throw new Error('disk full'); };
    dirty.widget.comicDeskConfirm.actions[1].onClick(); await dirty.settled();
    assert.equal(dirty.owner.activeCanvasId, 'free'); assert.equal(dirty.calls.setOpen.length, 0); assert.equal(dirty.calls.windowClose, 0);
    assert.ok(dirty.calls.notices.some(item => item.message === 'disk full'));
    const failure = fixture(); failure.widget.onSave = async () => { throw new Error('disk full'); };
    await failure.native(); await failure.settled();
    assert.equal(failure.calls.windowClose, 0); assert.equal(failure.calls.setOpen.length, 0); assert.equal(failure.owner.activeCanvasId, 'free');
});

test('repeat CmdW while switching is consumed without duplicate close operations; loading cannot exit the UI', async () => {
    const f = fixture(), gate = deferred(); f.widget.onSave = () => gate.promise;
    await f.native(); await f.native(); f.renderer();
    assert.equal(f.calls.windowClose + f.calls.bridgeClose, 0); assert.deepEqual(f.calls.saves, ['free']);
    gate.resolve(); await f.settled(); assert.equal(f.calls.setOpen.length, 1);
    for (const missing of [false, true]) {
        const loading = fixture(); if (missing) loading.widget.comicCanvas = undefined; else loading.free.loading = true;
        await loading.native(); await loading.settled();
        assert.equal(loading.calls.windowClose, 0); assert.equal(loading.calls.setOpen.length, 0);
    }
});

test('the final main canvas cannot fall through to closing the UI, and shifted CmdW is not intercepted', async () => {
    const f = fixture({ onlyMain: true }); await f.native(); await f.settled();
    assert.equal(f.owner.activeCanvasId, 'main'); assert.equal(f.owner.registry.canvases[0].isOpen, true);
    assert.equal(f.calls.setOpen.length, 0); assert.equal(f.calls.windowClose + f.calls.bridgeClose, 0);
    assert.equal((await f.native({ shift: true })).prevented, false);
    assert.equal(f.renderer({ shiftKey: true }).prevented, false);
});

test('open unmarked modal, application exit and mismatched captured ownership claim the key without closing a tab', async () => {
    for (const mutate of [f => { f.document.querySelector = selector => selector.startsWith('dialog') ? {} : undefined; },
        f => { f.widget.applicationExitPreparing = true; }, f => { f.free.projectId = 'other'; },
        f => { f.owner.activeCanvasId = 'main'; }, f => { f.free.workspaceRoot = '/other'; }]) {
        const f = fixture(); mutate(f); await f.native(); await f.settled();
        assert.equal(f.calls.windowClose, 0); assert.equal(f.calls.setOpen.length, 0); assert.equal(f.calls.saves.length, 0);
    }
});
