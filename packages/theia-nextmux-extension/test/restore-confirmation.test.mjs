import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const React = require('react');
const desktopRequire = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const groupBuild = desktopRequire('esbuild').buildSync({
    entryPoints: [new URL('../src/browser/nextmux-change-grouping.ts', import.meta.url).pathname],
    bundle: true, platform: 'node', format: 'cjs', write: false
});
const module = { exports: {} };
Function('module', 'exports', groupBuild.outputFiles[0].text)(module, module.exports);
const text = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const names = ['requestRestoreCheckpoint', 'requestRestoreAllChanges', 'dismissRestoreConfirmation', 'confirmPendingRestore', 'renderRestoreConfirmationDialog'];
const methods = names.map(name => widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === name).getText(ast));
const code = ts.transpileModule(`class Harness { ${methods.join('\n')} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React }
}).outputText;
class FocusTarget { isConnected = true; focused = 0; focus() { this.focused++; } }
const document = { activeElement: new FocusTarget() };
const Harness = Function('React', 'document', 'HTMLElement', 'groupAgentCheckpointChanges', 'localizeDesktopSurface', `${code}; return Harness;`)(
    React, document, FocusTarget, module.exports.groupChangesByFile, (_locale, value) => value
);
const changes = [{ checkpointId: 'a', path: 'a.ts' }, { checkpointId: 'b', path: 'b.ts' }];
function fixture() {
    const calls = [], marked = new Set();
    const host = Object.assign(new Harness(), {
        activeCodingSessionId: 'owner', activeWorkspaceRoot: '/work', desktopLocale: 'zh-CN',
        activeCodingSession: () => ({ id: 'owner', turns: [{ changes }] }),
        isCheckpointRestored: id => marked.has(id), update() {},
        async restoreCheckpoint(...args) { calls.push(['single', ...args]); },
        async restoreAllChanges(...args) { calls.push(['all', ...args]); },
        trapDialogFocus(event) { calls.push(['focus-trap', event.key]); }
    });
    return { host, calls, marked };
}

for (const all of [false, true]) for (const undo of [false, true]) {
    test(`${all ? 'all files' : 'single file'} ${undo ? 'undo' : 'restore'} waits for confirmation and forwards its direction once`, async () => {
        const { host, calls, marked } = fixture();
        if (undo) for (const change of changes) marked.add(change.checkpointId);
        if (all) host.requestRestoreAllChanges(changes); else host.requestRestoreCheckpoint('a');
        assert.deepEqual(calls, []);
        assert.equal(host.pendingRestoreConfirmation.undo, undo);
        const dialog = host.renderRestoreConfirmationDialog().props.children;
        assert.equal(dialog.props.role, 'alertdialog');
        assert.equal(dialog.props['aria-modal'], 'true');
        assert.match(dialog.props.children[0].props.children, undo ? /撤销/ : /恢复/);
        assert.equal(dialog.props.children.at(-1).props.children[0].props.autoFocus, true);
        await host.confirmPendingRestore();
        await host.confirmPendingRestore();
        assert.deepEqual(calls, [all ? ['all', changes, undo] : ['single', 'a', undo]]);
        assert.equal(host.pendingRestoreConfirmation, undefined);
    });
}

test('Escape cancels without writing, Tab is trapped, and focus returns to the originating control', () => {
    const { host, calls } = fixture();
    const focusCount = document.activeElement.focused;
    host.requestRestoreCheckpoint('a');
    const onKeyDown = host.renderRestoreConfirmationDialog().props.children.props.onKeyDown;
    onKeyDown({ key: 'Tab' });
    let prevented = false, stopped = false;
    onKeyDown({ key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
    assert.equal(prevented && stopped, true);
    assert.deepEqual(calls, [['focus-trap', 'Tab']]);
    assert.equal(host.pendingRestoreConfirmation, undefined);
    assert.equal(document.activeElement.focused, focusCount + 1);
});

test('a confirmation cannot apply to a different conversation or workspace after navigation', async () => {
    const { host, calls } = fixture();
    host.requestRestoreCheckpoint('a');
    host.activeCodingSessionId = 'other';
    await host.confirmPendingRestore();
    host.activeCodingSessionId = '';
    host.requestRestoreCheckpoint('a');
    host.activeWorkspaceRoot = '/other';
    await host.confirmPendingRestore();
    assert.deepEqual(calls, []);
});

test('generated restore receipts do not prevent a completely restored file group from offering undo', () => {
    const { host, marked } = fixture();
    marked.add('a'); marked.add('b');
    host.requestRestoreAllChanges([...changes, { checkpointId: 'restore-00000000-0000-4000-8000-000000000001', path: 'a.ts' }]);
    assert.equal(host.pendingRestoreConfirmation.undo, true);
});
