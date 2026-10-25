import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentToolRegistry } from '@nextmux/agent-runtime';
import { parseNativeWebResearchEvidence } from '@nextmux/model-runtime/native-web-research';
import {
    resolveOwnNativeWebResearchDeclaration,
    nativeWebResearchToolRequest,
    nativeWebResearchToolResult,
    executeOwnNativeWebResearch,
    registerNativeWebResearchTools
} from '../lib/node/nextmux-native-web-research.js';

const manual = (profile, extra = {}) => ({ version: 1, profile, search: 'supported', fetch: 'supported', source: 'manual_override', ...extra });
const connection = (extra = {}) => ({ providerId: 'custom_openai', protocol: 'openai_chat_completions', baseUrl: extra.providerId === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://relay.example/v1', ...extra });
const response = payload => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
const chatPayload = { choices: [{ message: { content: 'Current source facts.', annotations: [{ type: 'url_citation', url_citation: { url: 'https://www.example.com/source', title: 'Source' } }] }, finish_reason: 'stop' }], usage: { prompt_tokens: 120, completion_tokens: 30, server_tool_use: { web_search_requests: 1 }, cost: '0.0011' } };

test('own capability resolution follows disable/explicit protocol and exact-model trusted metadata', () => {
    assert.equal(resolveOwnNativeWebResearchDeclaration(connection({ providerName: 'OpenRouter', label: 'GPT with Search' }), 'any'), undefined);
    assert.equal(resolveOwnNativeWebResearchDeclaration(connection({ protocol: 'openai_responses' }), 'gpt-6'), undefined);
    assert.equal(resolveOwnNativeWebResearchDeclaration(connection({ providerId: 'openrouter', nativeWebResearch: null }), 'z-ai/glm'), undefined);
    assert.equal(resolveOwnNativeWebResearchDeclaration(connection({ providerId: 'openrouter' }), 'z-ai/glm'), undefined);
    assert.equal(resolveOwnNativeWebResearchDeclaration(connection({ providerId: 'openrouter', discoveredModels: [{ id: 'z-ai/glm', toolsSupported: true }] }), 'z-ai/glm')?.profile, 'openrouter_server_tools');
    assert.equal(resolveOwnNativeWebResearchDeclaration(connection({ providerId: 'openrouter', model: 'z-ai/glm', status: 'verified', toolCapability: 'verified' }), 'z-ai/glm')?.profile, 'openrouter_server_tools');
    assert.equal(resolveOwnNativeWebResearchDeclaration(connection({ providerId: 'openrouter', model: 'z-ai/glm', status: 'verified', toolCapability: 'verified', discoveredModels: [{ id: 'z-ai/glm', toolsSupported: false }] }), 'z-ai/glm'), undefined);
    assert.equal(resolveOwnNativeWebResearchDeclaration(connection({ nativeWebResearch: manual('gemini_generate_content') }), 'unbranded-model')?.fetch, 'supported');
    assert.equal(resolveOwnNativeWebResearchDeclaration(connection({ nativeWebResearch: manual('openai_responses') }), 'model')?.fetch, 'unsupported');
    assert.equal(resolveOwnNativeWebResearchDeclaration(connection({ nativeWebResearch: manual('zhipu_chat') }), 'model'), undefined);
    const withMetadata = connection({ protocol: 'anthropic_messages', discoveredModels: [{ id: 'same-model', capabilityDeclarations: { web_search: { support: 'supported', source: 'provider_metadata', scope: 'model' } } }] });
    assert.equal(resolveOwnNativeWebResearchDeclaration(withMetadata, 'same-model')?.search, 'supported');
    assert.equal(resolveOwnNativeWebResearchDeclaration(withMetadata, 'other-model'), undefined);
    assert.equal(resolveOwnNativeWebResearchDeclaration({ ...withMetadata, discoveredModels: [{ id: 'same-model', capabilityDeclarations: { web_search: { support: 'supported', source: 'model_heuristic', scope: 'model' } } }] }, 'same-model'), undefined);
    const verifiedOpenRouter = { providerId: 'openrouter', model: 'same-model', status: 'verified', toolCapability: 'verified' };
    for (const baseUrl of ['https://relay.example/v1', 'http://openrouter.ai/api/v1', 'https://openrouter.ai/v1', 'https://openrouter.ai/api/v1?key=bad', 'https://openrouter.ai/api/v1#fragment', 'https://user:key@openrouter.ai/api/v1', 'https://openrouter.ai:8443/api/v1']) {
        assert.equal(resolveOwnNativeWebResearchDeclaration(connection({ ...verifiedOpenRouter, baseUrl }), 'same-model'), undefined, baseUrl);
    }
    assert.equal(resolveOwnNativeWebResearchDeclaration(connection({ ...verifiedOpenRouter, protocol: 'gemini_generate_content' }), 'same-model'), undefined);
    assert.equal(resolveOwnNativeWebResearchDeclaration(connection({ ...verifiedOpenRouter, baseUrl: 'https://openrouter.ai/api/v1/', protocol: 'openai_responses' }), 'same-model')?.profile, 'openrouter_server_tools');
    assert.equal(resolveOwnNativeWebResearchDeclaration(connection({ ...verifiedOpenRouter, baseUrl: 'https://relay.example/v1', nativeWebResearch: manual('openrouter_server_tools') }), 'same-model')?.profile, 'openrouter_server_tools');
});

test('shared tool input is bounded and fetch rejects private/local/browser targets', () => {
    const search = nativeWebResearchToolRequest('search', { query: '  Current sources  ', maxResults: 3, allowedDomains: ['EXAMPLE.COM'] });
    assert.deepEqual(search.nativeWebResearch, { search: { maxUses: 2, maxResults: 3, maxCharacters: 4000, allowedDomains: ['example.com'] } });
    assert.equal(search.maximumOutputTokens, 4096);
    assert.match(search.messages[0].content, /Current sources/);
    for (const input of [{ query: '' }, { query: 'x'.repeat(501) }, { query: 'valid', maxResults: 11 }, { query: 'valid', unexpected: true }]) assert.throws(() => nativeWebResearchToolRequest('search', input), { code: 'INVALID_INPUT' });
    for (const url of ['http://127.0.0.1', 'http://10.0.0.1', 'http://[::1]', 'http://192.168.1.1', 'https://localhost', 'https://source.internal', 'file:///tmp/page', 'https://user:key@example.com', 'https://example.com/' + 'x'.repeat(2048)]) assert.throws(() => nativeWebResearchToolRequest('fetch', { url }), { code: 'INVALID_INPUT' }, url);
    const fetch = nativeWebResearchToolRequest('fetch', { url: 'https://www.example.com/page', maxContentTokens: 16384 });
    assert.deepEqual(fetch.nativeWebResearch, { fetch: { maxUses: 1, maxContentTokens: 16384, urls: ['https://www.example.com/page'] } });
});

test('own OpenRouter uses only the selected local API/key/model and reports compound usage', async () => {
    const requests = [];
    const result = await executeOwnNativeWebResearch({ connection: connection({ providerId: 'openrouter', discoveredModels: [{ id: 'z-ai/selected-model', toolsSupported: true }] }), key: 'nm_local_secret_12345', model: 'z-ai/selected-model', operation: 'search', input: { query: 'current report', maxResults: 3 },
        fetchImpl: async (url, init) => { requests.push({ url: String(url), init, body: JSON.parse(init.body) }); return response(chatPayload); } });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(requests[0].init.headers.authorization, 'Bearer nm_local_secret_12345');
    assert.equal(requests[0].body.model, 'z-ai/selected-model');
    assert.equal(requests[0].body.tools[0].type, 'openrouter:web_search');
    assert.equal(requests[0].body.tools[0].parameters.engine, 'parallel');
    assert.equal(requests[0].body.tools[0].parameters.mode, 'basic');
    assert.equal(requests[0].body.tools[0].parameters.max_uses, 2);
    assert.equal(result.usageKnown, true);
    assert.deepEqual(result.usage, { inputTokens: 120, outputTokens: 30 });
    assert.equal(result.modelOutput.status, 'ok');
    assert.equal(result.modelOutput.providerReportedTotalCostUsd, '0.0011');
    assert.equal(JSON.stringify(result).includes('nm_local_secret_12345'), false);
});

test('manual protocols use their documented endpoint and auth on the same base URL', async () => {
    const cases = [
        ['openai_responses', '/responses', 'authorization', { status: 'completed', output: [{ type: 'web_search_call', status: 'completed', action: { type: 'search', query: 'query' } }, { type: 'message', content: [{ type: 'output_text', text: 'Answer' }] }], usage: { input_tokens: 20, output_tokens: 10 } }],
        ['anthropic_messages', '/messages', 'x-api-key', { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Answer', citations: [{ type: 'web_search_result_location', url: 'https://www.example.com', title: 'Source' }] }], usage: { input_tokens: 20, output_tokens: 10, server_tool_use: { web_search_requests: 1 } } }],
        ['gemini_generate_content', '/models/selected-model:generateContent', 'x-goog-api-key', { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Answer' }] }, groundingMetadata: { webSearchQueries: ['query'], groundingChunks: [{ web: { uri: 'https://www.example.com', title: 'Source' } }] } }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 5, thoughtsTokenCount: 5 } }],
        ['zhipu_chat', '/chat/completions', 'authorization', { choices: [{ message: { content: 'Answer' }, finish_reason: 'stop' }], web_search: [{ link: 'https://www.example.com', title: 'Source' }], usage: { prompt_tokens: 20, completion_tokens: 10 } }]
    ];
    for (const [profile, endpoint, auth, payload] of cases) {
        let request;
        const result = await executeOwnNativeWebResearch({ connection: connection({ nativeWebResearch: manual(profile, profile === 'zhipu_chat' ? { zhipuSearchEngine: 'search_std' } : {}) }), key: 'local-key-12345', model: 'selected-model', operation: 'search', input: { query: 'query' }, fetchImpl: async (url, init) => { request = { url: String(url), init, body: JSON.parse(init.body) }; return response(payload); } });
        assert.equal(request.url, `https://relay.example/v1${endpoint}`, profile);
        assert.ok(request.init.headers[auth].includes('local-key-12345'), profile);
        if (profile === 'openai_responses') assert.equal(request.body.store, false);
        assert.equal(result.usageKnown, true, profile);
        assert.deepEqual(result.usage, { inputTokens: 20, outputTokens: 10 }, profile);
        assert.equal(result.modelOutput.status, 'ok', profile);
    }
});

test('Gemini fetch remains usable with explicit cap warnings and source evidence', async () => {
    let request;
    const result = await executeOwnNativeWebResearch({ connection: connection({ nativeWebResearch: manual('gemini_generate_content') }), key: 'local-key-12345', model: 'same-model', operation: 'fetch', input: { url: 'https://www.example.com/page' }, fetchImpl: async (url, init) => { request = JSON.parse(init.body); return response({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Page content' }] }, urlContextMetadata: { urlMetadata: [{ retrievedUrl: 'https://www.example.com/page', urlRetrievalStatus: 'URL_RETRIEVAL_STATUS_SUCCESS' }] } }], usageMetadata: { promptTokenCount: 15, toolUsePromptTokenCount: 1000, candidatesTokenCount: 10 } }); } });
    assert.deepEqual(request.tools, [{ url_context: {} }]);
    assert.equal(result.modelOutput.status, 'ok');
    assert.ok(result.modelOutput.warnings.some(warning => /hard per-request/.test(warning)));
    assert.equal(result.usageKnown, true);
    assert.deepEqual(result.usage, { inputTokens: 1015, outputTokens: 10 });
});

test('paid failures/missing usage preserve uncertainty, scrub credentials and never retry', async () => {
    let calls = 0;
    const common = { connection: connection({ providerId: 'openrouter', discoveredModels: [{ id: 'same-model', toolsSupported: true }] }), key: 'opaque-local-secret', model: 'same-model', operation: 'search', input: { query: 'query' } };
    const missing = await executeOwnNativeWebResearch({ ...common, fetchImpl: async () => { calls++; return response({ choices: [{ message: { content: 'I searched the web' }, finish_reason: 'stop' }] }); } });
    assert.equal(calls, 1);
    assert.equal(missing.usageKnown, false);
    assert.equal(missing.modelOutput.status, 'no_web_evidence');
    const failed = await executeOwnNativeWebResearch({ ...common, fetchImpl: async () => { calls++; return new Response(JSON.stringify({ error: { code: 'bad', message: 'opaque-local-secret echoed' } }), { status: 429 }); } });
    assert.equal(calls, 2);
    assert.equal(failed.usageKnown, false);
    assert.equal(failed.modelOutput.status, 'failed');
    assert.equal(JSON.stringify(failed).includes('opaque-local-secret'), false);
    assert.ok(failed.modelOutput.errors.length > 0);
});

test('continuations retain known compound usage and are reported as partial', () => {
    const evidence = parseNativeWebResearchEvidence('anthropic_messages', { stop_reason: 'pause_turn', content: [{ type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://www.example.com', title: 'Source' }] }], usage: { server_tool_use: { web_search_requests: 1 } } });
    const result = nativeWebResearchToolResult(evidence, { inputTokens: 12, outputTokens: 6 }, true);
    assert.equal(result.modelOutput.status, 'partial');
    assert.equal(result.usageKnown, true);
    assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 6 });
});

test('HTTP and 200-envelope failures retain only reported accounting and never claim success or fabricated web evidence', async () => {
    let calls = 0;
    const common = { connection: connection({ providerId: 'openrouter', discoveredModels: [{ id: 'same-model', toolsSupported: true }] }), key: 'opaque-local-secret', model: 'same-model', operation: 'search', input: { query: 'query' } };
    const failedSource = await executeOwnNativeWebResearch({ ...common, fetchImpl: async () => {
        calls++;
        return new Response(JSON.stringify({ ...chatPayload, error: { code: 'rate_limit', message: 'opaque-local-secret echoed' } }), { status: 429 });
    } });
    assert.equal(failedSource.usageKnown, true);
    assert.deepEqual(failedSource.usage, { inputTokens: 120, outputTokens: 30 });
    assert.equal(failedSource.modelOutput.usageEvidence.search.count, 1);
    assert.equal(failedSource.modelOutput.providerReportedTotalCostUsd, '0.0011');
    assert.equal(failedSource.modelOutput.status, 'partial');
    assert.ok(failedSource.modelOutput.errors.includes('RATE_LIMITED'));
    assert.equal(JSON.stringify(failedSource).includes('opaque-local-secret'), false);
    const failedEnvelope = await executeOwnNativeWebResearch({ ...common, fetchImpl: async () => {
        calls++;
        return response({ error: { code: 'bad' }, choices: [{ message: { content: 'I searched: [source](https://www.example.com/pretend)' } }], usage: { prompt_tokens: 20, completion_tokens: 2 } });
    } });
    assert.equal(failedEnvelope.usageKnown, true);
    assert.deepEqual(failedEnvelope.usage, { inputTokens: 20, outputTokens: 2 });
    assert.equal(failedEnvelope.modelOutput.status, 'failed');
    assert.deepEqual(failedEnvelope.modelOutput.sources, []);
    assert.equal(failedEnvelope.modelOutput.usageEvidence.search.status, 'missing');
    const invalid = await executeOwnNativeWebResearch({ ...common, fetchImpl: async () => {
        calls++;
        return response({ error: { code: 'bad' }, usage: { prompt_tokens: -1, completion_tokens: 2, server_tool_use: { web_search_requests: 'one' } } });
    } });
    assert.equal(invalid.usageKnown, false);
    assert.equal(invalid.modelOutput.status, 'failed');
    assert.equal(invalid.modelOutput.usageEvidence.search.status, 'invalid');
    assert.equal(calls, 3);
});

test('parent allowance and unsupported capability block before any network dispatch', async () => {
    let calls = 0;
    const common = { connection: connection({ providerId: 'openrouter', discoveredModels: [{ id: 'same-model', toolsSupported: true }] }), key: 'local-key-12345', model: 'same-model', operation: 'search', input: { query: 'query' }, fetchImpl: async () => { calls++; return response(chatPayload); } };
    for (const remainingTokenBudget of [
        { inputTokens: 0, outputTokens: 0, usageKnown: false }, { inputTokens: 0, outputTokens: 0, usageKnown: true, remainingOutputTokens: 0 },
        { inputTokens: 0, outputTokens: 0, usageKnown: true, remainingInputTokens: 0 }, { inputTokens: 0, outputTokens: 0, usageKnown: true, remainingInputTokens: 10 }
    ]) await assert.rejects(executeOwnNativeWebResearch({ ...common, remainingTokenBudget }), { code: 'TOKEN_BUDGET_EXHAUSTED' });
    await assert.rejects(executeOwnNativeWebResearch({ ...common, connection: connection() }), { code: 'WEB_RESEARCH_UNSUPPORTED' });
    assert.equal(calls, 0);
    let outputLimit;
    await executeOwnNativeWebResearch({ ...common, remainingTokenBudget: { inputTokens: 0, outputTokens: 0, usageKnown: true, remainingOutputTokens: 15 }, fetchImpl: async (_url, init) => { outputLimit = JSON.parse(init.body).max_tokens; return response(chatPayload); } });
    assert.equal(outputLimit, 15);
});

test('registered research tools are paid side effects and unsupported tools are absent', async () => {
    const registry = new AgentToolRegistry();
    let seenContext;
    registerNativeWebResearchTools(registry, async (_operation, _input, context) => { seenContext = context; return nativeWebResearchToolResult(parseNativeWebResearchEvidence('openrouter_server_tools', chatPayload), { inputTokens: 10, outputTokens: 5 }, true); }, { search: true, fetch: false });
    assert.deepEqual(registry.descriptors('read_only').map(tool => tool.name), ['web.search']);
    assert.equal(registry.descriptor('web.search').executionKind, 'side_effect');
    assert.equal(registry.descriptor('web.search').concurrencySafe, false);
    const budget = { inputTokens: 0, outputTokens: 0, usageKnown: true, remainingOutputTokens: 100 };
    const result = await registry.execute({ id: 'research', name: 'web.search', arguments: { query: 'query' } }, 'read_only', { runId: 'same-run', remainingTokenBudget: budget });
    assert.equal(result.ok, true);
    assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 5 });
    assert.equal(seenContext.remainingTokenBudget, budget);
    const empty = new AgentToolRegistry(); registerNativeWebResearchTools(empty, async () => { throw new Error('should not run'); }, { search: false, fetch: false });
    assert.deepEqual(empty.descriptors('read_only'), []);
});
