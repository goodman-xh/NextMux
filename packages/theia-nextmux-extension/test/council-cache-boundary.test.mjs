import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('service.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
let resolver;
function visit(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'resolveChildExecution' && ts.isArrowFunction(node.initializer)) resolver = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(resolver);
const council = {};
Function('exports', 'require', ts.transpile(readFileSync(new URL('../../agent-runtime/src/council.ts', import.meta.url), 'utf8'), {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
}))(council, createRequire(import.meta.url));
const js = ts.transpile(`const resolver = ${resolver};`, { target: ts.ScriptTarget.ES2022 });
function fixture(slots = [{ slotId: 'ui', modelId: 'designer', roles: ['ui_design'] }], randomIndex) {
    const completed = new Map(), config = { revision: 1, slots };
    let modelInitializations = 0;
    const resolve = Function('councilConfig', 'councilDispatcher', 'computeChildInvocationKey', 'completedCouncilInvocations',
        'getCouncilSlotModelClient', 'buildCouncilSpecialistInstructions', 'councilSessionDecisions', `${js}; return resolver;`)(config,
        new council.AgentCouncilDispatcher(slots, randomIndex), council.computeChildInvocationKey, completed, async () => { modelInitializations++; return {}; }, council.buildCouncilSpecialistInstructions,
        new Map());
    return { completed, resolve, count: () => modelInitializations };
}
const request = { parentRunId: 'parent', dispatchIndex: 0, input: { task: 'Design the dialog', role: 'ui_design', tools: [] },
    taskContext: { permissionMode: 'read_only', allowedToolNames: [], selectedMemory: [] }, maxTurns: 12, executionId: 'batch-1' };

test('the real host resolver returns an existing completed result without initializing another model client', async () => {
    const f = fixture(), initial = await f.resolve(request), completed = { status: 'completed', runId: 'original-child' };
    f.completed.set(initial.invocationKey, completed);
    const cached = await f.resolve(request);
    assert.strictEqual(cached.cachedResult, completed);
    assert.equal(cached.model, undefined);
    assert.equal(f.count(), 1);
});

const team = [
    { slotId: 'lead', modelId: 'lead-model', roles: ['lead'] },
    { slotId: 'a', modelId: 'model-a', roles: ['generalist'] },
    { slotId: 'b', modelId: 'model-b', roles: ['generalist'] },
    { slotId: 'qa', modelId: 'qa-model', roles: ['qa'] }
];
const taskRequest = (task, role = 'generalist', slotId) => ({ ...request, input: { ...request.input, task, role, ...(slotId ? { slotId } : {}) } });

test('interleaved unrelated roles cannot starve a generalist, and missing roles share the same fallback pool', async () => {
    const f = fixture(team);
    const selected = [];
    for (const [index, role] of ['generalist', 'qa', 'generalist', 'qa', 'security', 'docs', 'generalist'].entries()) {
        selected.push((await f.resolve({ ...taskRequest(`task-${index}`, role), dispatchIndex: index })).slotId);
    }
    assert.deepEqual(selected, ['a', 'qa', 'b', 'qa', 'a', 'b', 'a']);
});

test('explicit slots do not consume automatic turns and exact completed requests retain their original assignment', async () => {
    const f = fixture(team), originalRequest = taskRequest('exact task');
    const original = await f.resolve(originalRequest);
    const completed = { status: 'completed', runId: 'original-a', invocationKey: original.invocationKey };
    f.completed.set(original.invocationKey, completed);
    assert.equal((await f.resolve(taskRequest('explicit task', 'generalist', 'a'))).slotId, 'a');
    const callsBeforeReuse = f.count();
    const reused = await f.resolve({ ...originalRequest, dispatchIndex: 17 });
    assert.equal(reused.slotId, 'a');
    assert.strictEqual(reused.cachedResult, completed);
    assert.equal(f.count(), callsBeforeReuse);
    assert.equal((await f.resolve(taskRequest('next new task'))).slotId, 'b');
});

test('a failed or unfinished invocation has no result cache; an explicit repeat stays on its slot', async () => {
    const f = fixture(team), first = await f.resolve(taskRequest('uncompleted task'));
    assert.equal(first.slotId, 'a');
    // No completed lifecycle receipt was stored: the resolver never treats a route binding as a result.
    const retry = await f.resolve(taskRequest('uncompleted task'));
    assert.equal(retry.slotId, 'a'); assert.equal(retry.cachedResult, undefined);
    assert.equal(f.count(), 2, 'only these two explicit resolver calls initialize clients');
    assert.equal((await f.resolve(taskRequest('different task'))).slotId, 'b');
});

test('only unmatched work without generalists uses random fallback and exact repeats do not draw again', async () => {
    const slots = [team[0], { slotId: 'a', modelId: 'model-a', roles: ['architecture'] },
        { slotId: 'b', modelId: 'model-b', roles: ['frontend'] }];
    let calls = 0;
    const f = fixture(slots, maximum => { assert.equal(maximum, 2); return calls++ % 2 === 0 ? 1 : 0; });
    assert.equal((await f.resolve(taskRequest('matching task', 'architecture'))).slotId, 'a');
    assert.equal(calls, 0);
    const first = await f.resolve(taskRequest('missing role one', 'qa'));
    assert.equal(first.routeSource, 'random_fallback'); assert.equal(first.slotId, 'b');
    assert.equal((await f.resolve(taskRequest('missing role one', 'qa'))).slotId, 'b');
    assert.equal(calls, 1, 'an exact repeat remains bound even before a result is cached');
    assert.equal((await f.resolve(taskRequest('missing role two', 'security'))).slotId, 'a');
    assert.equal(calls, 2, 'both eligible candidates are reachable; lead-only never enters the pool');
});

test('the real host resolver forwards criteria, exact text, policy, budget and batch into the cache identity', async () => {
    const f = fixture(), original = await f.resolve(request);
    f.completed.set(original.invocationKey, { status: 'completed', runId: 'original-child' });
    for (const changed of [
        { ...request, input: { ...request.input, acceptanceCriteria: ['Keyboard navigation required'] } },
        { ...request, input: { ...request.input, task: 'Design  the dialog' } },
        { ...request, input: { ...request.input, tools: undefined } },
        { ...request, taskContext: { ...request.taskContext, allowedToolNames: ['workspace.read_file'] } },
        { ...request, tokenBudget: { maxOutputTokens: 80 } }, { ...request, maxTurns: 2 }, { ...request, executionId: 'batch-2' }
    ]) {
        const next = await f.resolve(changed);
        assert.notEqual(next.invocationKey, original.invocationKey);
        assert.equal(next.cachedResult, undefined);
    }
});
