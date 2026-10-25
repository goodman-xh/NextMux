import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { prepareNavigationEmptyCodingState, reloadNavigationDocument, restoreNavigationFixture, snapshotNavigationFixture } from './desktop-navigation-qa.mjs';

function fixture() {
    const restoreKey = 'nextmux.desktop.restoreState.v1';
    const historyKey = 'nextmux.desktop.codingSessions.v1';
    const local = new Map([
        [restoreKey, JSON.stringify({ section: 'models', newConversation: false, activeCodingSessionId: 'existing' })],
        [historyKey, JSON.stringify({ sessions: [{ id: 'existing', turns: [{ prompt: 'keep existing history' }], draftPrompt: 'keep draft' }] })],
        ['nextmux.desktop.route.coding', 'official:existing'],
        ['nextmux.desktop.activeRelay.v1', 'official:existing'],
        ['unrelated-setting', 'keep']
    ]);
    const session = new Map([['unrelated-transient', 'keep']]);
    const writes = [];
    const storage = map => ({
        getItem: key => map.has(key) ? map.get(key) : null,
        setItem: (key, value) => { writes.push(['set', key]); map.set(key, String(value)); },
        removeItem: key => { writes.push(['remove', key]); map.delete(key); },
        clear: () => { throw new Error('Whole-store clearing is forbidden'); }
    });
    const state = { section: 'models', empty: false, unsafe: false, clicks: 0, reloads: 0, resized: undefined };
    const context = {
        localStorage: storage(local), sessionStorage: storage(session), outerWidth: 1369, outerHeight: 693,
        document: { querySelector(selector) {
            if (selector === '.nmx-stop-glyph, .nmx-file-editor-tab em, .nmx-file-save-confirm') return state.unsafe ? {} : null;
            if (selector === '[data-desktop-section="coding"]') return { click: () => { state.section = 'coding'; } };
            if (selector === '.nmx-context-actions > button:first-child') return state.section === 'coding' ? { disabled: false, click: () => {
                state.clicks++; state.empty = true;
                // The real control persists the prior session/draft; it does not delete it.
                local.set(restoreKey, JSON.stringify({ section: 'coding', newConversation: true, activeCodingSessionId: '' }));
            } } : null;
            if (selector === '.nmx-empty-task') return state.empty ? {} : null;
            if (selector === '.nmx-session-row.is-current') return state.empty ? null : {};
            if (selector === '.nmx-desktop-widget') return {};
            throw new Error(`Unexpected selector ${selector}`);
        } },
        window: { resizeTo: (width, height) => { state.resized = [width, height]; } }
    };
    const evaluate = async expression => runInNewContext(expression, context);
    const reload = async () => {
        state.reloads++;
        const saved = JSON.parse(local.get(restoreKey) || '{}');
        state.empty = saved.newConversation === true;
        state.section = saved.section;
    };
    const waitFor = async (expression, label) => assert.equal(await evaluate(expression), true, label);
    return { local, session, state, writes, evaluate, waitFor, reload, historyKey, restoreKey };
}

test('nonempty restored conversation becomes an explicit empty draft before the unchanged logo assertion', async () => {
    const f = fixture();
    const history = f.local.get(f.historyKey);
    const snapshot = await snapshotNavigationFixture(f.evaluate);
    assert.equal(Object.hasOwn(snapshot.local, f.historyKey), false, 'history is not copied into cleanup');
    await prepareNavigationEmptyCodingState(f);
    assert.equal(f.state.empty, true); assert.equal(f.state.clicks, 1); assert.equal(f.state.reloads, 1);
    assert.equal(f.local.get(f.historyKey), history);
    assert.equal(f.local.get('nextmux.desktop.route.coding'), 'official:existing');
});

test('success or assertion failure cleanup restores only navigation and routes, preserving current history and unrelated writes', async () => {
    for (const fails of [false, true]) {
        const f = fixture(); const snapshot = await snapshotNavigationFixture(f.evaluate);
        try {
            await prepareNavigationEmptyCodingState(f);
            f.local.set('nextmux.desktop.route.coding', 'temporary-ui-choice');
            f.local.set('nextmux.desktop.route.comic', 'temporary-ui-choice');
            f.local.set('late-unrelated-setting', 'keep later value');
            f.local.set(f.historyKey, 'newer durable history mirror');
            f.session.set('late-transient', 'keep');
            if (fails) throw new Error('logo assertion failed');
        } catch (error) { assert.equal(error.message, 'logo assertion failed'); }
        finally { await restoreNavigationFixture({ ...f, snapshot }); }
        assert.equal(f.state.empty, false); assert.equal(f.state.section, 'models');
        assert.equal(f.local.get('nextmux.desktop.route.coding'), 'official:existing');
        assert.equal(f.local.has('nextmux.desktop.route.comic'), false);
        assert.equal(f.local.get(f.historyKey), 'newer durable history mirror');
        assert.equal(f.local.get('late-unrelated-setting'), 'keep later value');
        assert.equal(f.session.get('late-transient'), 'keep');
        assert.deepEqual(f.state.resized, [1369, 693]);
        assert.ok(f.writes.every(([, key]) => key !== f.historyKey));
    }
});

test('running tasks or unsaved file state fail before a new conversation, reload, or storage write', async () => {
    const f = fixture(); f.state.unsafe = true;
    await assert.rejects(snapshotNavigationFixture(f.evaluate), /no running task or unsaved file/);
    await assert.rejects(prepareNavigationEmptyCodingState(f), /no running task or unsaved file/);
    assert.equal(f.state.clicks, 0); assert.equal(f.state.reloads, 0); assert.equal(f.writes.length, 0);
});

test('actual navigation runner retains logo checks, requires isolation before CDP, and always restores fixture state', () => {
    const source = readFileSync(new URL('./desktop-navigation-qa.mjs', import.meta.url), 'utf8');
    assert.match(source, /expect\(initialLayout\.ownEmptyLogo && Boolean\(initialLayout\.emptyHeading\)/);
    assert.ok(source.indexOf('assertDisposableDesktopE2E();') < source.indexOf('await connectToNextMuxWorkbench(port)'));
    assert.ok(source.indexOf('await prepareNavigationEmptyCodingState({ evaluate, waitFor, reload })') < source.indexOf('const initialLayout = await layoutState()'));
    assert.match(source, /finally \{\s*try \{ await restoreNavigationFixture/);
    assert.match(source, /throwPrimaryOrCleanupErrors\(primaryError, cleanupErrors/);
    assert.doesNotMatch(source, /localStorage\.clear\(|sessionStorage\.clear\(|deleteActiveTemporaryConversation|saveConversationHistory/);
});

test('reload waits for a new document, not the old mounted widget', async () => {
    let origin = 100, calls = 0;
    await reloadNavigationDocument({
        evaluate: async () => origin,
        call: async method => { assert.equal(method, 'Page.reload'); calls++; },
        waitFor: async expression => {
            const context = { performance: { timeOrigin: origin }, document: { querySelector: () => ({}) } };
            assert.equal(runInNewContext(expression, context), false, 'old workbench cannot satisfy reload readiness');
            context.performance.timeOrigin = ++origin;
            assert.equal(runInNewContext(expression, context), true);
        }
    });
    assert.equal(calls, 1);
});

test('production new-conversation, persistence and delayed workspace restore retain an empty draft after document reconstruction', () => {
    const require = createRequire(new URL('../packages/theia-nextmux-extension/package.json', import.meta.url));
    const ts = require('typescript');
    const source = readFileSync(new URL('../packages/theia-nextmux-extension/src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    const names = new Set(['startNewCodingTask', 'persistDesktopRestoreState', 'loadDesktopRestoreState', 'workspaceRootIsOpen',
        'restoreDesktopRestoreState', 'applyWorkspaceRoots', 'activeCodingSession',
        'restoreCodingSourceSelection', 'recentCodingSource', 'codingSessionRelayKey', 'setComposerPrompt']);
    const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), methods = [];
    const visit = node => { if (ts.isMethodDeclaration(node) && names.has(node.name.getText(file))) methods.push(node.getText(file)); ts.forEachChild(node, visit); };
    visit(file); assert.equal(methods.length, names.size);
    const helpers = {};
    Object.assign(helpers, require('./lib/common/nextmux-price-quote.js'));
    new Function('exports', ts.transpile(readFileSync(new URL('../packages/theia-nextmux-extension/src/browser/nextmux-desktop-restore-state.ts', import.meta.url), 'utf8'),
        { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }))(helpers);
    new Function('exports', 'require', ts.transpile(readFileSync(new URL('../packages/theia-nextmux-extension/src/browser/nextmux-model-route-selection.ts', import.meta.url), 'utf8'),
        { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }))(helpers, createRequire(new URL('../packages/theia-nextmux-extension/lib/browser/nextmux-model-route-selection.js', import.meta.url)));
    const local = new Map(), sessionStorage = new Map();
    const storage = map => ({ getItem: key => map.get(key) || null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) });
    const Harness = new Function('window', 'requestAnimationFrame', ...Object.keys(helpers),
        ts.transpile(`class Harness { ${methods.join('\n')} };`, { target: ts.ScriptTarget.ES2022 }) + 'return Harness;')(
        { localStorage: storage(local), sessionStorage: storage(sessionStorage) }, () => 0, ...Object.values(helpers));
    const sessions = [{ id: 'prior', workspacePath: '/synthetic', turns: [{ prompt: 'do not lose existing history' }] }];
    const make = () => Object.assign(new Harness(), { activeCodingSessionId: '', activeSection: 'coding', codingPanel: 'thread',
        codingSessions: sessions, activeWorkspaceRoot: '/synthetic', workspaceOptions: [{ path: '/synthetic' }],
        platformCatalog: { offerings: [] }, officialModels: { connections: [] },
        activeRelayKey: 'official:foreign', activeModelRouteId: 'official:foreign:model', selectedModelIds: { coding: 'foreign-model', comic: '' },
        expandedCodingProjects: new Set(), defaultPermissionMode: 'read_only', agentStage: 'idle', settingsPanel: 'profile',
        detachContextEditorRecovery() { assert.equal(this.contextFilePreview, undefined); return true; },
        flushComposerDraft() {}, persistActiveCodingSessionState() {}, rememberNavigation() {}, update() {},
        syncActiveTerminal() {}, syncActiveBrowser() {} });
    const before = make(); before.activeCodingSessionId = 'prior'; before.startNewCodingTask();
    assert.equal(before.activeCodingSessionId, '');
    assert.equal(before.activeRelayKey, ''); assert.equal(before.activeModelRouteId, ''); assert.equal(before.selectedModelIds.coding, '');
    assert.equal(JSON.parse(local.get(helpers.DESKTOP_RESTORE_STATE_KEY)).newConversation, true);
    const after = make(); after.pendingDesktopRestoreState = after.loadDesktopRestoreState();
    after.applyWorkspaceRoots([{ resource: { scheme: 'file', path: { fsPath: () => '/synthetic', base: 'synthetic' } } }]);
    assert.equal(after.pendingDesktopRestoreState, undefined);
    assert.equal(after.activeCodingSessionId, ''); assert.equal(after.globalCodingDraft, true);
    assert.equal(after.activeSection, 'coding'); assert.equal(after.codingPanel, 'thread');
    assert.equal(after.activeRelayKey, ''); assert.equal(after.activeModelRouteId, ''); assert.equal(after.selectedModelIds.coding, '');
    assert.equal(after.codingSessions, sessions); assert.equal(sessions[0].turns.length, 1);
});
