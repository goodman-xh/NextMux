import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const method = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === 'personalApiUsageRecords').getText(ast);
const Harness = new Function('matchCatalogModel', 'modelUsageText', 'localizeDesktopSurface', 'desktopText', 'LOCAL_MODEL_BILLING_LABEL',
    ts.transpile(`class Harness {${method}}; return Harness;`, { target: ts.ScriptTarget.ES2022 }))(
    () => undefined, (_locale, key) => key, (_locale, key) => key, (_locale, key) => key, 'local');
const entry = (id, at = 10000, values = {}) => ({ id, at, kind: 'text', connectionId: 'connection-1', model: 'model-a',
    source: { kind: 'coding' }, inputTokens: 10, outputTokens: 20, status: 'completed', ...values });
const turn = values => ({ id: 'turn-1', agentRootRunId: 'run-a', agentHostRunId: 'run-a', createdAt: 1000, completedAt: 10000,
    routeId: 'official:connection-1:model-a', routeLabel: 'model-a', usageLabel: '10 输入 · 20 输出', stage: 'complete', ...values });
function records(entries, turns = [turn()]) {
    const harness = new Harness();
    Object.assign(harness, { codingSessions: [{ id: 'session-1', title: 'test', turns }],
        officialModels: { connections: [{ id: 'connection-1', providerId: 'custom_openai', label: 'test', discoveredModels: [] }] },
        globalModels: [], ownApiUsageEntries: entries, desktopLocale: 'zh-CN' });
    return harness.personalApiUsageRecords();
}
const ids = values => values.map(record => record.id).sort();
test('different backend runs within one former 5-second bucket remain distinct', () => {
    assert.deepEqual(ids(records([entry('run-a'), entry('run-b', 10001)])), ['own:run-b', 'session-1:turn-1']);
});
test('the same backend run across a former time bucket boundary appears once', () => {
    assert.deepEqual(ids(records([entry('run-a', 12499)], [turn({ completedAt: 12501 })])), ['session-1:turn-1']);
});
test('a continuation matches only its current host and preserves the earlier root execution', () => {
    assert.deepEqual(ids(records([entry('run-a'), entry('run-b')], [turn({ agentHostRunId: 'run-b' })])), ['own:run-a', 'session-1:turn-1']);
});
test('legacy root-only identity still identifies its one backend execution', () => {
    assert.deepEqual(ids(records([entry('run-a')], [turn({ agentHostRunId: undefined })])), ['session-1:turn-1']);
});
test('legacy turns without any run ID do not hide independent nearby executions', () => {
    assert.deepEqual(ids(records([entry('run-a'), entry('run-b')], [turn({ agentHostRunId: undefined, agentRootRunId: undefined })])),
        ['own:run-a', 'own:run-b', 'session-1:turn-1']);
});
test('connection, exact model and coding source remain part of the match', () => {
    for (const values of [{ connectionId: 'connection-2' }, { model: 'model-b' }, { source: { kind: 'comic_chat' } }]) {
        assert.equal(records([entry('run-a', 10000, values)]).length, 2);
    }
    assert.equal(records([entry('run-a', 10000, { model: 'model:a' })], [turn({ routeId: 'official:connection-1:model%3Aa' })]).length, 1);
});
