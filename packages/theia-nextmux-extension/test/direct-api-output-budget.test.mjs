import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { loadCurrentSource } from './helpers/current-source-loader.mjs';

const serviceSource = readFileSync(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('service.ts', serviceSource, ts.ScriptTarget.Latest, true);
const nodes = [];
function visit(node) { nodes.push(node); ts.forEachChild(node, visit); }
visit(ast);
const declaration = nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === 'initialOutputTokenLimit');
assert.ok(declaration?.initializer, 'use the actual service expression');
const compiled = ts.transpileModule(`const result = (${declaration.initializer.getText(ast)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;
const initialLimit = Function('request', `${compiled}; return result;`);
const { AgentRunner } = loadCurrentSource(new URL('../../agent-runtime/src/runner.ts', import.meta.url));
const { AgentToolRegistry } = loadCurrentSource(new URL('../../agent-runtime/src/registry.ts', import.meta.url));
const { createOfficialModelClient } = loadCurrentSource(new URL('../../model-runtime/src/client.ts', import.meta.url));
const { parseModelContract } = loadCurrentSource(new URL('../../model-runtime/src/model-contract.ts', import.meta.url));

async function capture(request, hardLimit = 393216, tokenBudget, protocol = 'openai_chat_completions') {
    const wire = [];
    const anthropic = protocol === 'anthropic_messages';
    const contract = anthropic ? { reasoningControls: [
        { type: 'adaptive', parameter: 'thinking.type', values: ['enabled', 'disabled'], support: 'supported', source: 'provider_metadata', scope: 'route' },
        { type: 'budget', parameter: 'thinking.budget_tokens', min: 1024, support: 'supported', source: 'provider_metadata', scope: 'route' }
    ] } : parseModelContract({ supported_parameters: ['reasoning', 'include_reasoning'] }, { protocol: 'openrouter', scope: 'route' });
    const client = createOfficialModelClient({ ...contract, providerId: anthropic ? 'anthropic' : 'openrouter', protocol,
        baseUrl: 'https://provider.test/v1', apiKey: 'offline-fixture', model: 'fixture/reasoning',
        fetchImpl: async (_url, init) => {
            wire.push(JSON.parse(String(init.body)));
            if (anthropic) return Response.json({ id: 'offline-response', type: 'message', role: 'assistant', model: 'fixture/reasoning',
                content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } });
            return Response.json({ id: 'offline-response', model: 'fixture/reasoning', choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 1, completion_tokens: 1 } });
        }
    });
    const runner = new AgentRunner({ model: client, tools: new AgentToolRegistry(), permissionMode: 'read_only',
        initialOutputTokenLimit: initialLimit(request), modelOutputTokenLimit: hardLimit, contextWindowTokens: 1_000_000,
        reasoningBudgetTokens: request.reasoningBudgetTokens, reasoningEffort: request.reasoningEffort,
        reasoningEnabled: request.reasoningEnabled, reasoningMode: request.reasoningMode, tokenBudget,
        maxTurns: 1 });
    const result = await runner.run({ prompt: 'Reply done.', runId: 'offline-output-budget' });
    assert.equal(result.status, 'completed');
    assert.equal(wire.length, 1, 'no paid retry or alternate request');
    return wire[0];
}
const coding = { workbench: 'coding', route: { kind: 'direct_api' } };

test('default direct coding sends 4096 rather than the catalog maximum', async () => {
    const body = await capture({ ...coding, reasoningEffort: 'high' });
    assert.equal(body.max_tokens, 4096);
    assert.deepEqual(body.reasoning, { effort: 'high' });
});

test('explicit reasoning budget retains wire 8192 and visible-output headroom 4096', async () => {
    const body = await capture({ ...coding, reasoningBudgetTokens: 8192 });
    assert.equal(body.max_tokens, 12288);
    assert.equal(body.reasoning.max_tokens, 8192);
});

test('model and user output hard caps still constrain adaptive reasoning requests', async () => {
    const body = await capture({ ...coding, reasoningBudgetTokens: 8192 }, 8192);
    assert.equal(body.max_tokens, 8192);
    assert.equal(body.reasoning.max_tokens, 8191);
    const userCapped = await capture({ ...coding, reasoningBudgetTokens: 8192 }, 393216, { maxOutputTokens: 7000 });
    assert.equal(userCapped.max_tokens, 7000);
    assert.equal(userCapped.reasoning.max_tokens, 6999);
});

test('direct comic planning has no new adaptive initial limit', async () => {
    for (const toolScope of ['comic-json', 'comic-scripts', 'comic-shots']) {
        const request = { route: { kind: 'direct_api' }, workbench: 'comic', toolScope, reasoningBudgetTokens: 8192 };
        assert.equal(initialLimit(request), undefined);
        const body = await capture(request, 16384);
        assert.equal(body.max_tokens, 16384);
        assert.equal(body.reasoning.max_tokens, 8192);
    }
});

test('explicitly disabled reasoning does not reserve its stale saved token budget', async () => {
    const body = await capture({ ...coding, reasoningBudgetTokens: 8192, reasoningEnabled: false });
    assert.equal(body.max_tokens, 4096);
    assert.equal(body.reasoning.max_tokens, undefined);
    assert.equal(body.reasoning.enabled, false);
});

test('both lead and delegated runner options consume the actual initial-limit variable', () => {
    for (const name of ['AgentDelegationRuntime', 'BuiltinAgentBackend']) {
        const calls = nodes.filter(node => ts.isNewExpression(node) && node.expression.getText(ast) === name);
        const target = calls.find(node => node.arguments?.[0] && ts.isObjectLiteralExpression(node.arguments[0])
            && node.arguments[0].properties.some(prop => ts.isSpreadAssignment(prop) && /initialOutputTokenLimit/.test(prop.expression.getText(ast))));
        assert.ok(target, `${name} consumes computed initialOutputTokenLimit`);
    }
});


test('disabled Anthropic reasoning mode reserves no stale budget and remains disabled on the real wire', async () => {
    for (const reasoningEnabled of [undefined, true]) {
        const body = await capture({ ...coding, reasoningBudgetTokens: 8192, reasoningMode: 'disabled', reasoningEnabled },
            393216, undefined, 'anthropic_messages');
        assert.equal(body.max_tokens, 4096);
        assert.deepEqual(body.thinking, { type: 'disabled' });
    }
    const enabled = await capture({ ...coding, reasoningBudgetTokens: 8192, reasoningMode: 'enabled' },
        393216, undefined, 'anthropic_messages');
    assert.equal(enabled.max_tokens, 12288);
    assert.deepEqual(enabled.thinking, { type: 'enabled', budget_tokens: 8192 });
});
