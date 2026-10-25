import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { AgentRunner, AgentToolRegistry, BuiltinAgentBackend, agentReplyReserveTokens } from '@nextmux/agent-runtime';
import { estimateAgentModelInputTokens } from '@nextmux/agent-runtime/token-budget';
import { messagesWithToolImages } from '@nextmux/model-runtime';
import { estimateManagedGatewayInputTokens } from '../lib/common/nextmux-managed-token-budget.js';
import * as budget from '../lib/common/nextmux-context-budget.js';
import { createConversationHistoryMirror, readConversationHistoryMirror } from '../lib/browser/nextmux-conversation-history.js';
import { compactedConversationHistory } from '../lib/browser/nextmux-conversation-branch.js';
import { automaticRelaySource } from '../lib/common/nextmux-relay-switch.js';

const budgetBindings = Object.fromEntries(Object.entries(budget).filter(([name, value]) => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) && name !== 'default' && typeof value === 'function'));
const widgetSource = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const serviceSource = readFileSync(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
const widgetFile = ts.createSourceFile('widget.tsx', widgetSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const serviceFile = ts.createSourceFile('service.ts', serviceSource, ts.ScriptTarget.Latest, true);
function allNodes(file) { const nodes = []; const visit = node => { nodes.push(node); ts.forEachChild(node, visit); }; visit(file); return nodes; }
const widgetNodes = allNodes(widgetFile), serviceNodes = allNodes(serviceFile);
const method = (nodes, file, name) => {
    const result = nodes.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name);
    assert.ok(result, `production method ${name} exists`); return result.getText(file);
};
const compile = (source, values = {}) => new Function(...Object.keys(values), ts.transpile(source, {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
}))(...Object.values(values));
const Widget = compile(`class Harness { ${['learnedRouteContextCap', 'recordLearnedRouteContextCap', 'rawModelContextWindowTokens',
    'modelContextWindowTokens', 'contextWindowForRoute', 'setModelOptionContextWindow', 'persistActiveRouteSelection',
    'restoreCodingSourceSelection', 'createCodingSessionBranch'].map(name => method(widgetNodes, widgetFile, name)).join('\n')} }; return Harness;`, {
    ...budgetBindings, automaticRelaySource, optionalKeyPriceQuoteId: value => value,
    conversationText: (_locale, key) => key,
});
const Service = compile(`class Harness { ${['learnedContextCapKey', 'learnedContextCapForRequest', 'recordLearnedContextCap', 'contextLimitsForRequest']
    .map(name => method(serviceNodes, serviceFile, name)).join('\n')} }; return Harness;`, budgetBindings);
const metadata = [
    { id: 'big', provider: 'openai', canonicalModel: 'openai/large-model', contextTokens: 128000, maximumOutputTokens: 32000 },
    { id: 'small', provider: 'openai', canonicalModel: 'openai/small-model', contextTokens: 8000, maximumOutputTokens: 700 },
];
const managed = registryModelId => ({ kind: 'managed_gateway', route: { mode: 'automatic', registryModelId } });
const service = () => Object.assign(new Service(), { learnedRouteContextCaps: new Map(), modelRegistryCache: { models: metadata }, merchantCatalogPages: new Map([
    ['merchant', { page: { offerings: [
        { id: 'big-offering', registryModelId: 'big', routeContextTokens: 128000, routeMaximumOutputTokens: 32000 },
        { id: 'small-offering', registryModelId: 'small', routeContextTokens: 8000, routeMaximumOutputTokens: 700 }
    ] } }]
]) });
const baseSession = { id: 'one', workspacePath: '/fixture', title: 'Example', turns: [], updatedAt: 1, createdAt: 1 };
function widget() {
    const route = { id: 'large-route', kind: 'official_connection', connection: { id: 'connection', providerId: 'openai', model: 'large-model', discoveredModels: [{ id: 'large-model', contextTokens: 128000 }] } };
    return Object.assign(new Widget(), {
        registryModels: metadata, activeCodingSessionId: 'one', codingSessions: [{ ...baseSession }], activeModelRouteId: route.id,
        activeRelayKey: 'official:connection', selectedModelIds: {}, contextWindowByModel: {}, learnedRouteContextCaps: {},
        automaticRelaySource: 'off', reasoningEffort: 'medium', desktopLocale: 'en',
        routesForRelay: () => [route], activeModelRoute: () => route, modelKeyForRoute: candidate => candidate.connection.model,
        activeCodingSession() { return this.codingSessions.find(item => item.id === this.activeCodingSessionId); },
        selectModelOption() { this.activeModelRouteId = route.id; }, codingSessionRelayKey: session => session.relayKey || '',
        persistCodingSessions() { this.saved = createConversationHistoryMirror(this.codingSessions); },
        saveLearnedRouteContextCaps() {},
        completeNavigationSurface() {}, update() {}, recentToolNames() { return []; }, reasoningSettingsForRoute() { return {}; },
    });
}

test('metadata is exact; own APIs inherit an official model ID; unknown windows never get made-up picker caps', () => {
    assert.equal(budget.modelContextWindowTokens(metadata, { providerId: 'openai', model: 'large-model' }), 128000);
    assert.equal(budget.modelContextWindowTokens(metadata, { providerId: 'custom_openai', model: 'large-model' }), 128000,
        'a self-owned API whose /v1/models omits context_length inherits the official window of the same model ID');
    assert.equal(budget.modelContextWindowTokens(metadata, { providerId: 'openai', model: 'large-model-preview' }), undefined);
    assert.equal(budget.modelContextWindowTokens(metadata, { providerId: 'custom_openai', model: 'large-model-preview' }), undefined);
    assert.equal(budget.modelContextWindowTokens(metadata, { providerId: 'ollama', model: 'large-model' }), undefined,
        "a local runtime's window is its own num_ctx setting, not the model card's");
    assert.equal(budget.effectiveContextWindowTokens(64000, undefined), 64000, "an explicit budget is distinct from unknown model capacity");
    assert.equal(budget.effectiveContextWindowTokens(undefined, undefined), undefined);
    assert.equal(budget.effectiveContextWindowTokens(64000, 8192), 8192);
    assert.equal(budget.effectiveContextWindowTokens(64000, 128000), 64000);
    for (const invalid of [null, '8000', NaN, Infinity, 1023, -1, 8000.5, 100000001]) assert.equal(budget.normalizeContextWindowTokens(invalid), undefined);
});

test('selected context window tiers persist per conversation and branch while rejecting unsupported caps', () => {
    const current = widget();
    current.setModelOptionContextWindow('large-model', 64000);
    assert.equal(current.contextWindowTokens, 64000);
    assert.equal(current.contextWindowByModel['large-model'], 64000);
    const restored = readConversationHistoryMirror(JSON.stringify(current.saved)).sessions[0];
    assert.equal(restored.contextWindowTokens, 64000);
    current.contextWindowTokens = 8000;
    current.restoreCodingSourceSelection(restored);
    assert.equal(current.contextWindowTokens, 64000);
    const branch = current.createCodingSessionBranch(restored, [], undefined, 2);
    assert.equal(branch.contextWindowTokens, 64000);
    assert.notEqual(branch.id, restored.id);
    current.restoreCodingSourceSelection({ ...baseSession, id: 'legacy-auto', routeId: 'large-route' });
    assert.equal(current.contextWindowTokens, undefined);
    assert.equal(current.contextWindowForRoute(current.activeModelRoute()), 64000, 'falls back to the saved per-model choice when the conversation has none');
    delete current.contextWindowByModel['large-model'];
    assert.equal(current.contextWindowForRoute(current.activeModelRoute()), 128000, 'defaults to the route ceiling when no override is saved');
    current.activeCodingSessionId = 'one';
    current.setModelOptionContextWindow('large-model', 64000);
    current.setModelOptionContextWindow('large-model', undefined);
    assert.equal(current.codingSessions[0].contextWindowTokens, undefined);
    current.setModelOptionContextWindow('large-model', 256000);
    assert.equal(current.codingSessions[0].contextWindowTokens, undefined, 'cannot select an unsupported higher cap');
});

test('queued conversation budgets survive persistence independently of subsequent picker changes', () => {
    const mirrored = createConversationHistoryMirror([{ ...baseSession, contextWindowTokens: 64000, followUpQueue: [{
        id: 'queued', sessionId: 'one', prompt: 'Review code', source: 'user', workbench: 'coding', routeId: 'large-route',
        relayKey: 'official:connection', modelLabel: 'large-model', permissionMode: 'read_only', contextWindowTokens: 16000, attachments: [], createdAt: 1
    }] }]);
    const restored = readConversationHistoryMirror(JSON.stringify(mirrored)).sessions[0];
    assert.equal(restored.contextWindowTokens, 64000);
    assert.equal(restored.followUpQueue[0].contextWindowTokens, 16000);
});

const dispatchAssignment = widgetNodes.find(node => ts.isBinaryExpression(node)
    && node.left.getText(widgetFile) === 'runContextWindowTokens' && node.operatorToken.kind === ts.SyntaxKind.EqualsToken);
assert.ok(dispatchAssignment);
const requestObject = widgetNodes.find(node => ts.isObjectLiteralExpression(node)
    && node.properties.some(property => ts.isPropertyAssignment(property) && property.name.getText(widgetFile) === 'contextWindowTokens'
        && property.initializer.getText(widgetFile) === 'runContextWindowTokens')
    && node.properties.some(property => ts.isPropertyAssignment(property) && property.name.getText(widgetFile) === 'prompt')).getText(widgetFile);
function actualDesktopRequest(current, overrides = {}) {
    const scope = {
        normalizeContextWindowTokens: budget.normalizeContextWindowTokens,
        effectiveContextWindowTokens: budget.effectiveContextWindowTokens,
        historicalExecution: undefined, queuedExecution: undefined,
        resumedExecution: undefined, submission: undefined, currentSession: current.codingSessions[0],
        route: current.activeModelRoute(), workbench: 'coding', value: 'Do the work', requestedSwitchPolicy: undefined,
        taskAttachments: [], conversationHistory: [], effectiveWorkspaceRoot: '/fixture', codingSession: current.codingSessions[0],
        runPermission: 'read_only', runReasoningEffort: 'medium', runReasoningSettings: {}, sharedTerminal: undefined, queuedRequestId: undefined, skills: [], ...overrides,
    };
    return new Function(...Object.keys(scope), ts.transpile(`let runContextWindowTokens; ${dispatchAssignment.getText(widgetFile)};
        return ${requestObject};`, { target: ts.ScriptTarget.ES2022 })).call(
        Object.assign(Object.create(Object.getPrototypeOf(current)), current, { selectedTerminalProfile: () => undefined, creativityRunField: () => ({}) }), ...Object.values(scope));
}

test('actual startAgentRun request transmits bounded context window selections to the host', () => {
    const current = widget(); current.setModelOptionContextWindow('large-model', 64000);
    assert.equal(actualDesktopRequest(current).contextWindowTokens, 64000);
    assert.equal(actualDesktopRequest(current, { queuedExecution: { task: { contextWindowTokens: 16000 } } }).contextWindowTokens, 16000);
    assert.equal(actualDesktopRequest(current, { historicalExecution: { contextWindowTokens: 32000 } }).contextWindowTokens, 32000);
    assert.equal(actualDesktopRequest(current, { resumedExecution: { turn: {} }, currentSession: { contextWindowTokens: 32000 } }).contextWindowTokens, 32000);
    assert.equal(actualDesktopRequest(current, { queuedExecution: { task: { contextWindowTokens: 1000000 } } }).contextWindowTokens, 128000, 'clamps to the route ceiling');
});

test('actual host capability resolution honors selected lower tiers and clamps to route switches and fallbacks', () => {
    const host = service();
    assert.deepEqual(host.contextLimitsForRequest({ route: managed('big'), contextWindowTokens: 64000 }), { contextWindowTokens: 64000, modelOutputTokenLimit: 32000 });
    assert.deepEqual(host.contextLimitsForRequest({ route: managed('big') }), { contextWindowTokens: 128000, modelOutputTokenLimit: 32000 });
    assert.deepEqual(host.contextLimitsForRequest({ route: managed('small'), contextWindowTokens: 64000 }), { contextWindowTokens: 8000, modelOutputTokenLimit: 700 });
    assert.equal(host.contextLimitsForRequest({ route: { kind: 'managed_gateway', route: { mode: 'fixed', offeringId: 'small-offering' } }, contextWindowTokens: 64000 }).contextWindowTokens, 8000);
    assert.deepEqual(host.contextLimitsForRequest({ route: managed('big'), contextWindowTokens: 64000,
        switchPolicy: { mode: 'allowlisted_models', fallbackRegistryModelIds: ['small'] } }), { contextWindowTokens: 8000, modelOutputTokenLimit: 700 });
    assert.deepEqual(host.contextLimitsForRequest({ route: { kind: 'official_connection', model: 'private-deployment' }, contextWindowTokens: 64000 }, { providerId: 'custom_openai' }), {});
    assert.deepEqual(host.contextLimitsForRequest({ route: { kind: 'official_connection', model: 'large-model' }, contextWindowTokens: 64000 }, { providerId: 'custom_openai' }),
        { contextWindowTokens: 64000, modelOutputTokenLimit: 32000 }, 'an own API serving an official model ID is bounded by that model');
});

const backendObject = serviceNodes.find(node => ts.isCallExpression(node) && node.expression.getText(serviceFile) === 'backend.run').arguments[0].getText(serviceFile);
function actualBackendRequest(request, limits, tools) {
    const scope = { request, ...limits, workspaceRoot: '/fixture', taskContext: undefined, effectivePermissionMode: 'read_only', tools,
        externalUnscoped: false, childContinuation: undefined, tokenBudget: undefined, requiredBackendCapabilities: [],
        backendConfiguration: { preferredBackendId: 'builtin', allowFallback: false }, backendExecutionRunId: 'context-budget-run',
        resumeCheckpoint: undefined, execution: {}, inputTokenLimit: limits.modelInputTokenLimit, BUILTIN_AGENT_BACKEND_ID: 'builtin',
        // As the host decides it: only a root coding conversation gets the wakeup and goal tools.
        conversationRun: request?.workbench === 'coding' && request?.toolScope === undefined };
    return compile(`return ${backendObject};`, scope);
}
const history = Array.from({ length: 24 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `history ${i} ${'context '.repeat(500)}` }));

test('the actual RPC-to-backend request causes earlier compaction after switching to a smaller route and respects total window/output limits', async () => {
    for (const id of ['big', 'small']) {
        const request = { route: managed(id), contextWindowTokens: 64000, prompt: 'EXACT_CURRENT_GOAL', history };
        const limits = service().contextLimitsForRequest(request);
        const tools = new AgentToolRegistry();
        let modelCalls = 0;
        const backend = new BuiltinAgentBackend({ tools, model: { async complete(input) {
            modelCalls++;
            const estimated = estimateAgentModelInputTokens(input.instructions, input.messages, input.tools);
            assert.ok(estimated + input.maxOutputTokens <= limits.contextWindowTokens);
            assert.ok(input.maxOutputTokens <= limits.modelOutputTokenLimit);
            assert.ok(input.messages.some(message => message.content.includes('EXACT_CURRENT_GOAL')));
            return { content: 'Completed review' };
        } } });
        const backendRequest = actualBackendRequest(request, limits, tools);
        assert.ok(backendRequest.requiredBackendCapabilities.includes('contextWindow'));
        const result = await backend.run(backendRequest);
        assert.equal(modelCalls, 1);
        assert.equal(result.events.some(event => event.type === 'context_compaction_completed'), id === 'small');
    }
    assert.equal(history.length, 24, 'compaction never mutates persisted history');
});

test('large tool schemas cannot silently exceed a selected small budget', async () => {
    const tools = new AgentToolRegistry();
    tools.register({ name: 'schema.large', source: 'builtin', requiredPermission: 'read_only', description: 'schema '.repeat(3000),
        inputSchema: { type: 'object' } }, async () => ({ modelOutput: {}, summary: { title: 'unused' } }));
    let calls = 0;
    const result = await new AgentRunner({ tools, permissionMode: 'read_only', contextWindowTokens: 1024,
        model: { async complete() { calls++; return { content: 'must not send' }; } } }).run({ prompt: 'Keep all requirements', runId: 'context-large-tools' });
    assert.equal(calls, 0);
    assert.equal(result.stopReason, 'context_window_exceeded');
    assert.ok(result.checkpoint);
});

test('unpublished capacity retains the bounded gateway output default', async () => {
    const tools = new AgentToolRegistry();
    const request = { route: managed('unknown'), prompt: 'hello' };
    const limits = service().contextLimitsForRequest(request);
    const backend = new BuiltinAgentBackend({ tools, model: { async complete(input) {
        assert.equal(input.maxOutputTokens, 4096); return { content: 'Hello' };
    } } });
    assert.equal((await backend.run(actualBackendRequest(request, { contextWindowTokens: undefined, modelOutputTokenLimit: undefined, ...limits }, tools))).status, 'completed');
});

test('automatic known-model context bounds each output request', async () => {
    const tools = new AgentToolRegistry();
    const request = { route: managed('big'), prompt: 'hello' };
    const limits = service().contextLimitsForRequest(request);
    const backend = new BuiltinAgentBackend({ tools, model: { async complete(input) {
        assert.equal(input.maxOutputTokens, 32000); return { content: 'Hello' };
    } } });
    assert.equal((await backend.run(actualBackendRequest(request, limits, tools))).status, 'completed');
});

test('a policy change to a smaller fallback recomputes context before the next model turn', async () => {
    const host = service(), tools = new AgentToolRegistry();
    tools.register({ name: 'read.note', source: 'builtin', requiredPermission: 'read_only', inputSchema: { type: 'object' }, description: 'Read note' },
        async () => ({ modelOutput: { content: 'details '.repeat(500) }, summary: { title: 'Read note' } }));
    const request = { route: managed('big'), contextWindowTokens: 64000, prompt: 'EXACT_CURRENT_GOAL', history };
    let policy;
    const execution = { getSwitchPolicy: () => policy };
    const getter = serviceNodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(serviceFile) === 'getContextLimits').initializer;
    const getContextLimits = new Function('request', 'execution', 'officialConnection', ts.transpile(`return ${getter.getText(serviceFile)};`,
        { target: ts.ScriptTarget.ES2022 })).call(host, request, execution, undefined);
    let calls = 0;
    const backend = new BuiltinAgentBackend({ tools, getContextLimits, model: { async complete(input) {
        calls++;
        if (calls === 1) {
            assert.equal(getContextLimits().contextWindowTokens, 64000);
            policy = { mode: 'allowlisted_models', fallbackRegistryModelIds: ['small'] };
            return { toolCalls: [{ id: 'read-note', name: 'read.note', arguments: {} }] };
        }
        assert.equal(getContextLimits().contextWindowTokens, 8000);
        assert.ok(estimateAgentModelInputTokens(input.instructions, input.messages, input.tools) + input.maxOutputTokens <= 8000);
        assert.ok(input.maxOutputTokens <= 700);
        return { content: 'Done' };
    } } });
    const result = await backend.run(actualBackendRequest(request, getContextLimits(), tools));
    assert.equal(calls, 2);
    assert.ok(result.events.some(event => event.type === 'context_compaction_completed'));
});

test('the actual gateway pre-dispatch guard catches a smaller-policy race after prompt assembly', () => {
    const callback = serviceNodes.find(node => ts.isArrowFunction(node) && ts.isBlock(node.body)
        && node.body.statements.some(statement => ts.isVariableStatement(statement)
            && statement.declarationList.declarations.some(declaration => declaration.name.getText(serviceFile) === 'currentLimits')));
    assert.ok(callback);
    const guard = callback.body.statements.filter(statement => ts.isIfStatement(statement) && statement.expression.getText(serviceFile).includes('currentLimits.contextWindowTokens')
        || ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => ['currentLimits', 'gatewayMessages', 'estimatedInput', 'outputLimits', 'maximumOutputTokens'].includes(declaration.name.getText(serviceFile))))
        .map(statement => statement.getText(serviceFile)).join('\n');
    class PlatformRequestError extends Error { constructor(code, message) { super(message); this.code = code; } }
    const check = new Function('request', 'switchPolicy', 'modelRequest', 'estimateManagedGatewayInputTokens', 'messagesWithToolImages', 'PlatformRequestError', 'agentReplyReserveTokens', ts.transpile(
        `${guard}; return maximumOutputTokens;`, { target: ts.ScriptTarget.ES2022 }));
    const host = service(), request = { route: managed('big'), contextWindowTokens: 64000 };
    const policy = { mode: 'allowlisted_models', fallbackRegistryModelIds: ['small'] };
    assert.throws(() => check.call(host, request, policy, { instructions: 'Task', messages: history, tools: [], maxOutputTokens: 4096 },
        estimateManagedGatewayInputTokens, messagesWithToolImages, PlatformRequestError, agentReplyReserveTokens), { code: 'CONTEXT_WINDOW_EXCEEDED', retrySafe: true, usageKnown: true });
    assert.equal(check.call(host, request, policy, { instructions: 'Task', messages: [{ role: 'user', content: 'hello' }], tools: [], maxOutputTokens: 4096 },
        estimateManagedGatewayInputTokens, messagesWithToolImages, PlatformRequestError, agentReplyReserveTokens), 700);
});


test('aggregator IDs resolve exact author aliases without guessing deployment or variant capacity', () => {
    const models = [{ id: 'gemini', provider: 'google', canonicalModel: 'google/gemini-test', contextTokens: 1000000, maximumOutputTokens: 64000 },
        { id: 'deepseek', provider: 'deepseek', canonicalModel: 'deepseek/v4-pro', contextTokens: 1000000 }];
    assert.equal(budget.modelContextWindowTokens(models, { providerId: 'openrouter', model: 'deepseek/v4-pro' }), 1000000);
    assert.equal(budget.modelContextWindowTokens(models, { providerId: 'gemini', model: 'models/gemini-test' }), 1000000);
    assert.equal(budget.modelContextWindowTokens(models, { providerId: 'custom_openai', model: 'deepseek/v4-pro:thinking' }), undefined);
    assert.equal(budget.modelContextWindowTokens(models, { providerId: 'azure_openai', model: 'custom-deployment' }), undefined, 'deployment names are not official model IDs');
    assert.equal(budget.modelContextWindowTokens(metadata, { providerId: 'azure_openai', model: 'large-model' }), 128000, 'a deployment named after the official model inherits it');
    assert.equal(budget.modelContextWindowTokens(metadata, { providerId: 'anthropic', model: 'large-model' }), 128000, 'a relay behind a native protocol serves other authors too');
    assert.equal(budget.modelContextWindowTokens([...metadata, { id: 'ambiguous', provider: 'anthropic', canonicalModel: 'anthropic/large-model', contextTokens: 200000 }],
        { providerId: 'custom_openai', model: 'large-model' }), undefined, 'a bare name two authors publish is ambiguous');
});

test('own APIs (自有 API) inherit official catalog windows by exact model ID', () => {
    const catalog = [
        { id: 'gpt', provider: 'openai', canonicalModel: 'openai/gpt-5.4', contextTokens: 1_050_000, inputTokens: 922_000, maximumOutputTokens: 128_000 },
        { id: 'opus', provider: 'anthropic', canonicalModel: 'anthropic/claude-opus-4.6', contextTokens: 200_000, maximumOutputTokens: 64_000 },
        { id: 'chat', provider: 'deepseek', canonicalModel: 'deepseek/deepseek-chat', contextTokens: 128_000, maximumOutputTokens: 8_192 },
        { id: 'pro', provider: 'google', canonicalModel: 'google/gemini-2.5-pro', contextTokens: null, inputTokens: 1_048_576, maximumOutputTokens: 65_536 },
    ];
    const own = model => budget.modelContextWindowTokens(catalog, { providerId: 'custom_openai', model });
    assert.equal(own('gpt-5.4'), 1_050_000, 'the published window, not the 922K input ceiling');
    assert.equal(budget.contextWindowTokenLabel(own('gpt-5.4')), '1M');
    assert.equal(budget.modelInputTokenLimit(catalog, { providerId: 'custom_openai', model: 'gpt-5.4' }), 922_000, 'the input ceiling stays enforced separately');
    assert.equal(budget.modelOutputTokenLimit(catalog, { providerId: 'custom_openai', model: 'gpt-5.4' }), 128_000);
    assert.equal(own('claude-opus-4-6'), 200_000, "Anthropic's dashed API ID is the catalog's claude-opus-4.6");
    assert.equal(own('anthropic/claude-opus-4-6'), 200_000);
    assert.equal(budget.modelContextWindowTokens(catalog, { providerId: 'anthropic', model: 'claude-opus-4-6' }), 200_000);
    assert.equal(own('deepseek-chat'), 128_000);
    assert.equal(own('gemini-2.5-pro'), 1_048_576, 'an input-only card plans within its input ceiling');
    assert.equal(budget.modelContextWindowTokens(catalog, { providerId: 'vertex', model: 'gemini-2.5-pro' }), 1_048_576);
    for (const variant of ['gpt-5.4-mini', 'gpt-5.4:thinking', 'claude-opus-4-6-20260201', 'deepseek-chat-v3', 'gpt-5']) {
        assert.equal(own(variant), undefined, `${variant} is not an official ID in this catalog`);
    }
    assert.equal(budget.modelContextWindowTokens(catalog, { providerId: 'custom_openai', model: 'gpt-5.4', capacity: { contextTokens: 400_000 } }), 400_000,
        'a window the endpoint declares that is smaller than the card wins');
    assert.equal(budget.modelContextWindowTokens([{ ...catalog[0], id: 'gpt-relay', contextTokens: 1_000_000, inputTokens: 872_000 }, catalog[0]],
        { providerId: 'custom_openai', model: 'gpt-5.4' }), 1_000_000, 'two cards of one model keep the smaller published window');
});

test('API route ceilings constrain both actual picker and host, even without registry metadata', () => {
    const connection = { providerId: 'custom_openai', model: 'private-deployment', discoveredModels: [
        { id: 'private-deployment', contextTokens: 32000, maximumOutputTokens: 2000 },
        { id: 'other-deployment', contextTokens: 1000000, maximumOutputTokens: 64000 }
    ] };
    assert.equal(widget().modelContextWindowTokens({ kind: 'official_connection', connection }), 32000);
    assert.deepEqual(service().contextLimitsForRequest({ route: { kind: 'official_connection', model: 'private-deployment' }, contextWindowTokens: 64000 }, connection),
        { contextWindowTokens: 32000, modelOutputTokenLimit: 2000 });
    const host = service();
    host.contextCatalogOfferings = [{ id: 'small-route', registryModelId: 'big', routeContextTokens: 24000, routeMaximumOutputTokens: 1500 }];
    assert.deepEqual(host.contextLimitsForRequest({ route: managed('big'), contextWindowTokens: 64000 }), { contextWindowTokens: 24000, modelOutputTokenLimit: 1500 });
    host.contextCatalogOfferings.push({ id: 'fallback-route', registryModelId: 'small', routeContextTokens: 4000, routeMaximumOutputTokens: 500 });
    assert.deepEqual(host.contextLimitsForRequest({ route: managed('big'), switchPolicy: { mode: 'allowlisted_models', fallbackRegistryModelIds: ['small'] } }),
        { contextWindowTokens: 4000, modelOutputTokenLimit: 500 });
});

test('Gemini independent input/output limits stay separate and invalid legacy capacities are omitted', () => {
    const identity = { providerId: 'custom_openai', model: 'unknown', capacity: { inputTokens: 32000, maximumOutputTokens: 8000 } };
    assert.equal(budget.modelContextWindowTokens([], identity), 32000, 'never sum input and output limits');
    assert.equal(budget.modelOutputTokenLimit([], identity), 8000);
    assert.deepEqual(budget.normalizeModelCapacity({ contextTokens: null, inputTokens: '32000', maximumOutputTokens: -1 }), {});
});


test('route metadata is used as the only context budget, and unknown stays unknown', () => {
    assert.equal(budget.effectiveContextWindowTokens(64000, 32000), 32000);
    assert.deepEqual(service().contextLimitsForRequest({ route: managed('unknown'), contextWindowTokens: 64000 }), { modelOutputTokenLimit: 4096 });
    assert.deepEqual(service().contextLimitsForRequest({ route: managed('unknown') }), { modelOutputTokenLimit: 4096 });
    assert.equal(budget.contextWindowTokenLabel(1_050_000), '1M');
});


test('picker requires exact API capacity even when the catalog knows that model', () => {
    const current = widget();
    const known = current.activeModelRoute();
    const unknown = { ...known, connection: { ...known.connection, discoveredModels: [{ id: 'large-model' }] } };
    assert.equal(current.modelContextWindowTokens(known), 128000);
    assert.equal(current.modelContextWindowTokens(unknown), undefined);
    assert.equal(current.modelContextWindowTokens({ ...known, connection: { ...known.connection,
        discoveredModels: [{ id: 'other-model', contextTokens: 256000 }] } }), undefined);
    current.routesForRelay = () => [unknown];
    current.setModelOptionContextWindow('large-model', 64000);
    assert.equal(current.contextWindowTokens, undefined);
});

test('mainstream market context window labels and tier choices cover 32K through 10M+', () => {
    assert.equal(budget.contextWindowTokenLabel(128_000), '128K');
    assert.equal(budget.contextWindowTokenLabel(131_072), '128K');
    assert.equal(budget.contextWindowTokenLabel(200_000), '200K');
    assert.equal(budget.contextWindowTokenLabel(256_000), '256K');
    assert.equal(budget.contextWindowTokenLabel(262_144), '256K');
    assert.equal(budget.contextWindowTokenLabel(1_000_000), '1M');
    assert.equal(budget.contextWindowTokenLabel(1_047_576), '1M');
    assert.equal(budget.contextWindowTokenLabel(1_048_576), '1M');
    assert.equal(budget.contextWindowTokenLabel(2_000_000), '2M');
    assert.equal(budget.contextWindowTokenLabel(2_097_152), '2M');
    assert.equal(budget.contextWindowTokenLabel(10_000_000), '10M');
    assert.deepEqual(budget.contextWindowChoices(128_000), [32000, 64000, 128000]);
    assert.deepEqual(budget.contextWindowChoices(200_000), [32000, 64000, 128000, 200000]);
    assert.deepEqual(budget.contextWindowChoices(400_000), [32000, 64000, 128000, 256000, 400000]);
    assert.deepEqual(budget.contextWindowChoices(1_000_000), [32000, 64000, 128000, 256000, 512000, 1000000]);
    assert.deepEqual(budget.contextWindowChoices(2_000_000), [32000, 64000, 128000, 256000, 512000, 1000000, 2000000]);
    assert.deepEqual(budget.contextWindowChoices(1_000_000, 128_000), [32000, 64000, 128000]);
    assert.deepEqual(budget.contextWindowChoices(262_144), [32768, 65536, 131072, 262144]);
    assert.deepEqual(budget.contextWindowChoices(1_047_576), [32768, 65536, 131072, 262144, 524288, 1047576]);
});

test('a 1M window less its output reserve still reads 1M, and tiers never repeat a label', () => {
    for (const tokens of [900_000, 921_600, 922_000, 936_000, 1_000_000, 1_047_576, 1_048_576, 1_050_000]) {
        assert.equal(budget.contextWindowTokenLabel(tokens), '1M', String(tokens));
    }
    assert.equal(budget.contextWindowTokenLabel(899_000), '899K');
    assert.equal(budget.contextWindowTokenLabel(1_500_000), '1.5M');
    assert.deepEqual(budget.contextWindowChoices(1_050_000), [32000, 64000, 128000, 256000, 512000, 1050000], 'one 1M row: the ceiling');
    assert.deepEqual(budget.contextWindowChoices(922_000), [32000, 64000, 128000, 256000, 512000, 922000]);
    assert.deepEqual(budget.contextWindowChoices(921_600), [32768, 65536, 131072, 262144, 524288, 921600]);
    assert.deepEqual(budget.contextWindowChoices(1_050_000, 200_000), [32000, 64000, 128000, 200000], 'a learned 200K cap is the top choice');
    for (const ceiling of [8_000, 32_000, 128_400, 163_840, 200_000, 204_800, 400_000, 922_000, 1_050_000, 1_572_864, 2_000_500, 10_000_000]) {
        const choices = budget.contextWindowChoices(ceiling);
        const labels = choices.map(budget.contextWindowTokenLabel);
        assert.equal(choices.at(-1), ceiling, `${ceiling} is the top choice`);
        assert.ok(choices.every((value, index) => index === 0 || value > choices[index - 1]), `${ceiling}: ${choices} ascend`);
        assert.equal(new Set(labels).size, labels.length, `${ceiling}: ${labels} are distinct`);
        assert.ok(!labels.slice(0, -1).includes('200K'), `${ceiling}: 200K is never a step below a larger ceiling`);
    }
});

test('learned route context caps clamp fake-1M relays on both renderer and host', () => {
    const current = widget();
    const fakeMillionRoute = {
        id: 'fake-1m-route',
        kind: 'official_connection',
        connection: { id: 'conn-1m', providerId: 'openai', model: 'fake-1m', discoveredModels: [{ id: 'fake-1m', contextTokens: 1_000_000 }] }
    };
    current.routesForRelay = () => [fakeMillionRoute];
    current.activeModelRoute = () => fakeMillionRoute;
    current.activeModelRouteId = fakeMillionRoute.id;
    assert.equal(current.modelContextWindowTokens(fakeMillionRoute), 1_000_000);
    current.setModelOptionContextWindow('fake-1m', 1_000_000);
    assert.equal(current.contextWindowTokens, 1_000_000);
    current.recordLearnedRouteContextCap(fakeMillionRoute, 128_000);
    assert.equal(current.modelContextWindowTokens(fakeMillionRoute), 128_000, 'picker ceiling clamps to the learned 128K limit');
    assert.equal(current.contextWindowTokens, 128_000, 'active selection is clamped down from 1M to 128K');
    assert.deepEqual(budget.contextWindowChoices(current.modelContextWindowTokens(fakeMillionRoute)), [32000, 64000, 128000]);

    const host = service();
    host.recordLearnedContextCap({ route: managed('big') }, 64_000);
    assert.deepEqual(host.contextLimitsForRequest({ route: managed('big'), contextWindowTokens: 128_000 }), {
        contextWindowTokens: 64_000,
        modelOutputTokenLimit: 32_000
    });
});

test('switching a 1M-context conversation to a smaller model or lower tier re-compacts history to fit', () => {
    const largeTurns = Array.from({ length: 20 }, (_, index) => ({
        id: `turn-${index}`,
        prompt: `Turn ${index} user question: ${'detailed_specification_line '.repeat(600)}`,
        response: `Turn ${index} assistant implementation: ${'detailed_implementation_step '.repeat(600)}`,
        stage: 'complete',
        createdAt: index + 1
    }));
    const historyAt1M = compactedConversationHistory(largeTurns, { contextWindowTokens: 1_000_000 });
    const charsAt1M = historyAt1M.reduce((sum, msg) => sum + msg.content.length, 0);
    assert.ok(charsAt1M > 200_000, `1M context window retains full large history (${charsAt1M} chars > 150K legacy cap)`);

    const historyAt128K = compactedConversationHistory(largeTurns, { contextWindowTokens: 128_000 });
    const charsAt128K = historyAt128K.reduce((sum, msg) => sum + msg.content.length, 0);
    assert.ok(charsAt128K <= Math.floor(128_000 * 0.45 * 2.5) + 4_000, `128K model re-compacts history (${charsAt128K} chars)`);
    assert.ok(charsAt128K < charsAt1M * 0.65);

    const historyAt32K = compactedConversationHistory(largeTurns, { contextWindowTokens: 32_000 });
    const charsAt32K = historyAt32K.reduce((sum, msg) => sum + msg.content.length, 0);
    assert.ok(charsAt32K <= Math.floor(32_000 * 0.45 * 2.5) + 4_000, `32K model re-compacts history (${charsAt32K} chars)`);
    assert.ok(charsAt32K < charsAt128K * 0.5);
});
