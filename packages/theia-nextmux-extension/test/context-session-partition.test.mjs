import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { codingProjectPathKey } from '../lib/browser/nextmux-sidebar-projects.js';

const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const render = widget.members.find(member => member.name?.getText(ast) === 'renderContextPanel');
const coding = render.body.statements.find(node => ts.isIfStatement(node) && node.expression.getText(ast) === "this.activeSection === 'coding'");
const declarationName = node => ts.isVariableStatement(node) ? node.declarationList.declarations[0].name.getText(ast) : '';
const start = coding.thenStatement.statements.findIndex(node => declarationName(node) === 'pinnedList');
const end = coding.thenStatement.statements.findIndex(node => declarationName(node) === 'renderSessionRow');
assert.ok(start >= 0 && end > start, 'the sidebar partitions sessions before rendering rows');
let project;
function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'visibleProjects.map') project = node.arguments[0];
    ts.forEachChild(node, visit);
}
visit(coding);
assert.ok(project && ts.isArrowFunction(project) && ts.isBlock(project.body), 'project preparation exists');
const projectSetup = project.body.statements.slice(0, project.body.statements.findIndex(ts.isReturnStatement));
const emitted = ts.transpileModule(`function prepare() {
    ${coding.thenStatement.statements.slice(start, end).map(node => node.getText(ast)).join('\n')}
    return { pinnedSessions, recentSessions, selectProject: workspace => {
        ${projectSetup.map(node => node.getText(ast)).join('\n')}
        return { expanded, count: rawSessions.length, sessions, visibleSessions };
    } };
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
// Project groups key by the shared path normaliser, exactly as the sidebar does.
const prepare = new Function('codingProjectPathKey', `${emitted}\nreturn prepare;`)(codingProjectPathKey);
const ids = sessions => sessions.map(session => session.id);

function fixture(sessions) {
    let visits = 0;
    const ordered = [];
    const state = {
        codingSessions: { *[Symbol.iterator]() { for (const session of sessions) { visits++; yield session; } } },
        expandedCodingProjects: new Set(), expandedProjectConversationLists: new Set(), codingSessionPagesLoading: new Set(),
        codingSessionListHasMore: () => false,
        orderedCodingSessions(list) { ordered.push(ids(list)); return [...list].sort((a, b) => a.id.localeCompare(b.id)); }
    };
    return { state, ordered, prepare: () => prepare.call(state), visits: () => visits };
}

test('sidebar partition keeps pinned, recent, and workspace sessions in exclusive groups', () => {
    const sessions = Object.freeze([
        { id: 'p-workspace', pinned: true, workspacePath: '/a' }, { id: 'p-recent', pinned: true },
        { id: 'recent-empty', workspacePath: '' }, { id: 'recent-none' },
        { id: 'a2', workspacePath: '/a' }, { id: 'b1', workspacePath: '/b' }, { id: 'a1', workspacePath: '/a' }
    ]);
    const current = fixture(sessions);
    current.state.expandedCodingProjects = new Set(['/a', '/b']);
    const prepared = current.prepare();
    assert.deepEqual(ids(prepared.pinnedSessions), ['p-recent', 'p-workspace']);
    assert.deepEqual(ids(prepared.recentSessions), ['recent-empty', 'recent-none']);
    assert.deepEqual(ids(prepared.selectProject({ path: '/a' }).visibleSessions), ['a1', 'a2']);
    assert.deepEqual(ids(prepared.selectProject({ path: '/b' }).visibleSessions), ['b1']);
    assert.equal(prepared.selectProject({ path: '/missing' }).count, 0);
    assert.equal(current.visits(), sessions.length, 'partition reads each session only once');
});

test('collapsed projects do not sort sessions, and expansion preserves five-row pagination', () => {
    const current = fixture(Array.from({ length: 7 }, (_, index) => ({ id: `a${6 - index}`, workspacePath: '/a' })));
    const prepared = current.prepare();
    assert.equal(current.ordered.length, 2, 'only pinned and recent groups are prepared initially');
    for (let index = 0; index < 100; index++) {
        const project = prepared.selectProject({ path: index === 0 ? '/a' : `/closed-${index}` });
        assert.equal(project.count, index === 0 ? 7 : 0);
        assert.deepEqual(project.visibleSessions, []);
    }
    assert.equal(current.ordered.length, 2, 'no collapsed project reaches orderedCodingSessions');
    assert.equal(current.visits(), 7, 'project count does not multiply session scans');
    current.state.expandedCodingProjects.add('/a');
    assert.deepEqual(ids(prepared.selectProject({ path: '/a' }).visibleSessions), ['a0', 'a1', 'a2', 'a3', 'a4']);
    assert.equal(current.ordered.length, 3);
    current.state.expandedProjectConversationLists.add('/a');
    assert.equal(prepared.selectProject({ path: '/a' }).visibleSessions.length, 7);
});
