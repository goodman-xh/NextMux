import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { conversationCheckpointIdsToRestore, conversationHistoryStateToken } from '../lib/browser/nextmux-conversation-branch.js';
import { conversationText } from '../lib/browser/nextmux-conversation-locale.js';

const require = createRequire(import.meta.url), React = require('react');
const { renderToStaticMarkup } = createRequire(require.resolve('@theia/core/package.json'))('react-dom/server');
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const methods = ['setTurnEditRestoreWorkspace', 'renderCodingSessionDialogs'].map(name =>
    widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === name).getText(ast)).join('\n');
const js = ts.transpileModule(`class Harness { ${methods} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React }
}).outputText;
const warningLocale = {};
Function('exports', ts.transpile(readFileSync(new URL('../src/browser/nextmux-checkpoint-warning-locale.ts', import.meta.url), 'utf8'), {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
}))(warningLocale);
const Harness = Function('React', 'conversationCheckpointIdsToRestore', 'conversationHistoryStateToken', 'conversationText',
    'codingSidebarProjects', 'localizeDesktopSurface', 'checkpointWarningText', 'visibleCheckpointWarnings', `${js}; return Harness;`)(React, conversationCheckpointIdsToRestore,
    conversationHistoryStateToken, conversationText, () => [], (_locale, text) => text, warningLocale.checkpointWarningText, warningLocale.visibleCheckpointWarnings);

test('snapshot budget warnings explain partial restoration without claiming that the task failed', () => {
    const message = warningLocale.checkpointWarningText('zh-CN', 'Source snapshot file/byte budget reached');
    assert.match(message, /数量或大小限制/);
    assert.match(message, /仅已记录的文件更改可以恢复/);
    assert.match(message, /不表示任务执行失败/);
    assert.equal(warningLocale.checkpointWarningText('zh-CN', 'Unknown future warning'), 'Unknown future warning');
});

function fixture(changes = []) {
    const source = { id: 'session', turns: [
        { id: 'earlier', checkpointWarnings: ['Earlier warning must stay out of this restore'] },
        { id: 'target', changes, checkpointWarnings: ['Source snapshot file/byte budget reached'] },
        { id: 'later', checkpointWarnings: ['Source snapshot file/byte budget reached', 'Some files could not be read consistently'] }
    ] };
    const host = new Harness(), plans = [];
    Object.assign(host, { codingSessions: [source], workspaceOptions: [], codingHistoryProjects: [], desktopLocale: 'en',
        pendingTurnEdit: { sessionId: source.id, turnId: 'target' }, turnEditRestorePreview: { status: 'idle' },
        conversationHistoryReady: () => true, update() {},
        platformService: { getAgentCheckpointDiff: async (_root, id) => changes.find(change => change.checkpointId === id) },
        createWorkspaceRestorePlan: async (_source, ids) => {
            plans.push(ids); return [{ workspaceRoot: '/workspace', checkpointIds: ids, changes,
                targets: ids.map(checkpointId => ({ checkpointId, side: 'before' })) }];
        }
    });
    return { host, plans };
}

test('message rollback exposes incomplete coverage even when no changes were recorded', async () => {
    const { host, plans } = fixture();
    await host.setTurnEditRestoreWorkspace(true);
    assert.equal(host.turnEditRestorePreview.status, 'ready');
    assert.deepEqual(host.turnEditRestorePreview.checkpointIds, []);
    assert.deepEqual(plans, []);
    assert.deepEqual(host.turnEditRestorePreview.warnings, [
        'Source snapshot file/byte budget reached', 'Some files could not be read consistently'
    ]);
    const html = renderToStaticMarkup(host.renderCodingSessionDialogs());
    assert.doesNotMatch(html, /Source snapshot file\/byte budget reached/);
    assert.match(html, /Some files could not be read consistently/);
    assert.match(html, /Only file changes recorded by NextMux can be restored/);
    assert.doesNotMatch(html, /Earlier warning|No changes|disabled=""/);
});

test('partial coverage retains the recorded restore plan and its warning', async () => {
    const change = { checkpointId: 'recorded', workspaceRoot: '/workspace', path: 'source.ts', additions: 1, deletions: 1 };
    const { host, plans } = fixture([change]);
    await host.setTurnEditRestoreWorkspace(true);
    assert.deepEqual(plans, [['recorded']]);
    assert.deepEqual(host.turnEditRestorePreview.changes, [change]);
    const html = renderToStaticMarkup(host.renderCodingSessionDialogs());
    assert.match(html, /source\.ts/);
    assert.doesNotMatch(html, /Source snapshot file\/byte budget reached/);
    assert.doesNotMatch(html, /disabled=""/);
});

test('turns with complete coverage do not inherit unrelated earlier warnings', async () => {
    const { host } = fixture();
    host.codingSessions[0].turns[1].checkpointWarnings = [];
    host.codingSessions[0].turns[2].checkpointWarnings = [];
    await host.setTurnEditRestoreWorkspace(true);
    assert.deepEqual(host.turnEditRestorePreview.warnings, []);
    assert.doesNotMatch(renderToStaticMarkup(host.renderCodingSessionDialogs()), /codicon-warning/);
});
