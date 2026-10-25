import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { requireCopyFallback } from './copy-fallback-module.mjs';
import { conversationCheckpointIdsToRestore } from '../lib/browser/nextmux-conversation-branch.js';

const require = createRequire(import.meta.url), React = require('react');
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const method = name => {
    const member = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name);
    assert.ok(member, name); return member.getText(file);
};
function compile(code, bindings = {}) {
    return new Function(...Object.keys(bindings), ts.transpile(code, {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React
    }))(...Object.values(bindings));
}
function* nodes(node) { yield node; for (const child of node.getChildren(file)) yield* nodes(child); }
const localeExports = {};
compile(readFileSync(new URL('../src/browser/nextmux-conversation-locale.ts', import.meta.url), 'utf8'), {
    exports: localeExports, require: requireCopyFallback
});
const { conversationText } = localeExports;

test('branch confirmation checks code rollback synchronously whenever the edited turn or later turns have checkpoints', async () => {
    const methods = ['beginTurnEdit', 'requestTurnEditConfirmation', 'resetTurnEditRestore', 'setTurnEditRestoreWorkspace'];
    const Harness = compile(`class Harness { ${methods.map(method).join('\n')} }; return Harness;`, {
        conversationCheckpointIdsToRestore, conversationHistoryStateToken: session => JSON.stringify(session), conversationText,
        desktopDomainErrorText: (_locale, error) => String(error)
    });
    for (const position of ['current', 'later', 'none']) {
        const tasks = [], harness = new Harness();
        const turns = [{ id: 'first', prompt: 'Original', changes: position === 'current' ? [{ checkpointId: 'first-checkpoint' }] : [] },
            { id: 'second', prompt: 'Later', changes: position === 'later' ? [{ checkpointId: 'second-checkpoint' }] : [] }];
        Object.assign(harness, { codingSessions: [{ id: 'session', turns }], activeCodingSessionId: 'session', desktopLocale: 'zh-CN',
            conversationHistoryReady: () => true, update() {}, focusTurnEditor() {}, flushComposerDraft() {},
            createWorkspaceRestorePlan: async () => [] });
        const actualSet = harness.setTurnEditRestoreWorkspace;
        harness.setTurnEditRestoreWorkspace = value => { const pending = actualSet.call(harness, value); tasks.push(pending); return pending; };
        harness.beginTurnEdit('session', 'first');
        harness.editingTurnValue = 'Edited';
        harness.requestTurnEditConfirmation('session', 'first');
        assert.equal(harness.pendingTurnEdit.prompt, 'Edited');
        assert.equal(harness.turnEditRestoreWorkspace, position !== 'none');
        assert.equal(harness.turnEditRestorePreview.status, position !== 'none' ? 'loading' : 'idle');
        await Promise.all(tasks);
        assert.equal(harness.turnEditRestorePreview.status, position !== 'none' ? 'ready' : 'idle');
        assert.equal(tasks.length, position !== 'none' ? 1 : 0);
    }
});

test('actual branch footer orders create, cancel, continue and preserves their separate actions in twelve languages', () => {
    const footer = [...nodes(widget)].find(node => ts.isJsxElement(node)
        && node.openingElement.tagName.getText(file) === 'footer'
        && node.getText(file).includes("this.confirmTurnEdit('branch')"));
    assert.ok(footer);
    const render = compile(`return function(restoreBlocked) { return ${footer.getText(file)}; };`, { React, conversationText });
    const translations = { 'zh-CN': '继续', 'zh-TW': '繼續', en: 'Continue', ja: '続行', ko: '계속', es: 'Continuar',
        fr: 'Continuer', de: 'Weiter', 'pt-BR': 'Continuar', ru: 'Продолжить', ar: 'متابعة', hi: 'जारी रखें' };
    for (const [locale, expected] of Object.entries(translations)) {
        const actions = [], harness = { desktopLocale: locale, conversationHistoryReady: () => true, turnEditSubmitting: false,
            confirmTurnEdit: action => actions.push(action), dismissTurnEditConfirmation: () => actions.push('cancel') };
        const buttons = React.Children.toArray(render.call(harness, false).props.children);
        assert.deepEqual(buttons.map(button => button.props.children), [conversationText(locale, 'createBranch'), conversationText(locale, 'cancel'), expected]);
        assert.match(buttons[0].props.className, /theia-button main/);
        assert.match(buttons[1].props.className, /theia-button secondary/);
        assert.match(buttons[2].props.className, /theia-button secondary/);
        for (const button of buttons) button.props.onClick();
        assert.deepEqual(actions, ['branch', 'cancel', 'replace']);
        const blocked = React.Children.toArray(render.call(harness, true).props.children);
        assert.deepEqual(blocked.map(button => button.props.disabled), [true, false, true]);
    }
});

const tabsNode = [...nodes(widget)].find(node => ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === 'nav'
    && node.openingElement.attributes.properties.some(attribute => attribute.name?.getText(file) === 'className'
        && attribute.initializer?.text === 'nmx-file-editor-tabs'));
assert.ok(tabsNode);
const renderTabs = compile(`return function(fileTabs, preview) { return ${tabsNode.getText(file)}; };`, {
    React, NextMuxFileTabButton: 'file-tab-button', isGoalFilePath: () => false,
    fileDrawerText: (_locale, key) => key, workbenchText: (_locale, key) => key
});
const tabs = ['first.ts', 'last.ts'].map(name => ({ preview: { uri: `file:///workspace/${name}`, path: name, name, kind: 'text' }, dirty: false }));

test('actual file tab wheel handler uses the dominant trackpad axis and only consumes overflowing scroll', () => {
    const render = renderTabs.call({ desktopLocale: 'en', resolvedDesktopTheme: () => 'dark' }, tabs, tabs[0].preview);
    const nav = { scrollWidth: 800, clientWidth: 200, scrollLeft: 0 };
    let prevented = 0;
    const wheel = (deltaX, deltaY) => render.props.onWheel({ currentTarget: nav, deltaX, deltaY, preventDefault: () => prevented++ });
    wheel(0, 45); assert.equal(nav.scrollLeft, 45);
    wheel(-80, 20); assert.equal(nav.scrollLeft, -35);
    wheel(0, 0); assert.equal(prevented, 2);
    nav.scrollWidth = nav.clientWidth;
    wheel(0, 100); assert.equal(nav.scrollLeft, -35); assert.equal(prevented, 2);
});

test('active file tabs scroll into view on opening and after activating another tab', () => {
    const calls = [], active = { uri: tabs[0].preview.uri };
    const harness = { desktopLocale: 'en', resolvedDesktopTheme: () => 'dark', update() { calls.push('update'); },
        persistActiveCodingSessionState() { calls.push('persist'); }, activateContextFileTab(uri) { active.uri = uri; return true; } };
    const rows = () => React.Children.toArray(renderTabs.call(harness, tabs, active).props.children);
    const scroll = { scrollIntoView: options => calls.push(options) };
    let rendered = rows();
    rendered[0].ref(scroll); rendered[1].ref(scroll); rendered[0].ref(null);
    assert.deepEqual(calls, [{ block: 'nearest', inline: 'nearest' }]);
    React.Children.toArray(rendered[1].props.children)[0].props.onClick();
    assert.equal(active.uri, tabs[1].preview.uri);
    rendered = rows(); rendered[0].ref(scroll); rendered[1].ref(scroll);
    assert.deepEqual(calls, [{ block: 'nearest', inline: 'nearest' }, 'persist', 'update', { block: 'nearest', inline: 'nearest' }]);
});
