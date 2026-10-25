import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { AgentToolError } from '@nextmux/agent-runtime';
import { managedWebResearchCapabilities, managedWebResearchRequestKey } from '../lib/node/nextmux-managed-web-research.js';
import { nativeWebResearchToolRequest, nativeWebResearchToolResult } from '../lib/node/nextmux-native-web-research.js';
import { managedAgentUsage, ManagedGatewayChargeTotal } from '../lib/node/nextmux-managed-agent-usage.js';
import { normalizeModelSwitchPolicyForDispatch } from '../lib/common/nextmux-model-switch-policy.js';
import { estimateManagedGatewayInputTokens } from '../lib/common/nextmux-managed-token-budget.js';

// Exercise the actual managed closure, including its billing accumulator and
// output contract, without sending a paid request from a unit test.
const text = readFileSync(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('service.ts', text, ts.ScriptTarget.Latest, true);
let closure;
function visit(node) {
    if (!closure && ts.isBinaryExpression(node) && node.left.getText(ast) === 'nativeResearchExecutor' && ts.isArrowFunction(node.right)) closure = node.right;
    ts.forEachChild(node, visit);
}
visit(ast); assert.ok(closure);
class PlatformRequestError extends Error { constructor(code, extra = {}) { super(code); this.code = code; Object.assign(this, extra); } }
const helpers = { AgentToolError, PlatformRequestError, managedWebResearchCapabilities, managedWebResearchRequestKey,
    nativeWebResearchToolRequest, nativeWebResearchToolResult, managedAgentUsage, normalizeModelSwitchPolicyForDispatch,
    estimateManagedGatewayInputTokens, normalizeModelCitations: value => value,
    isRelayFeedbackRequestId: value => typeof value === 'string', RELAY_FEEDBACK_MAX_REQUEST_IDS: 20 };
const make = new Function(...Object.keys(helpers), ts.transpile(`
return function(host,state) {
 const {managedRoute,initialSwitchPolicy,conversationId,request,execution,emitPriceUpdate,managedBilling,managedRequestIds}=state;
 let modelCalled=false,lastGateway,failoverCount=0,developmentOnly=false;
 return (${closure.getText(ast)}).bind(host);
}`, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }))(...Object.values(helpers));

const route = { mode: 'fixed', offeringId: 'a', keyPriceQuoteId: 'kq1_' + 'a'.repeat(64) };
const policy = { version: 1, revision: 1, mode: 'single_route', merchantScope: 'selected_merchant', fallbackRegistryModelIds: [] };
function fixture(response = {}) {
    const calls = [], updates = [], catalogReads = [];
    const gateway = { call: { id: 'receipt', offeringId: 'a', failoverCount: 0 }, billing: { chargedMicros: 10003, currency: 'USD' },
        response: { content: 'Current source facts.', citations: [{ url: 'https://example.com', title: 'Source' }], usage: { inputTokens: 101, outputTokens: 20, usageKnown: true, web_search: 2 }, ...response } };
    const host = { contextCatalogOfferings: [{ id: 'a', merchantId: 'one', registryModelId: 'model', status: 'active', nativeWebResearch:
        { profile: 'openrouter_server_tools', search: 'supported', fetch: 'supported', boundedSearch: true, source: 'live_probe', searchEngine: 'parallel', searchMode: 'basic' } }],
        merchantCatalogPages: new Map(), contextLimitsForRequest: () => ({ contextWindowTokens: 16384 }),
        async getCatalogOffering(id) { catalogReads.push(id); if (this.catalogFailure) throw this.catalogFailure; return this.refreshedOffering; },
        async completeManagedGatewayWithEvents(...args) { calls.push(args); if (this.failure) throw this.failure; return gateway; } };
    const state = { managedRoute: route, initialSwitchPolicy: policy, conversationId: 'conversation', request: { workbench: 'coding' }, execution: {},
        emitPriceUpdate: async (...args) => updates.push(args), managedBilling: new ManagedGatewayChargeTotal(), managedRequestIds: [] };
    return { host, state, calls, updates, catalogReads, run: make.call(host, host, state) };
}
const context = { runId: 'run', executionScopeId: 'scope', executionId: 'batch' };

test('same selected API receives bounded multilingual research and normal authoritative billing once', async () => {
    const f = fixture(); const input = { query: 'Neowow 视频生成' };
    const result = await f.run('search', input, context);
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0][0], route);
    assert.deepEqual(f.calls[0][1].nativeWebResearch.openRouter, { engine: 'parallel', mode: 'basic', fetchEngine: 'openrouter' });
    assert.equal(f.calls[0][1].nativeWebResearch.search.maxUses, 2); assert.deepEqual(f.calls[0][1].tools, []);
    assert.equal(f.calls[0][1].conversationId, 'conversation'); assert.equal(f.calls[0][1].switchPolicy.mode, 'single_route');
    assert.equal(f.calls[0][2], managedWebResearchRequestKey(context, 'search', input));
    assert.equal(result.usageKnown, true); assert.deepEqual(result.usage, { inputTokens: 101, outputTokens: 20 });
    assert.equal(result.modelOutput.sources[0].url, 'https://example.com'); assert.equal(result.modelOutput.usageEvidence.search.count, 2);
    assert.equal(f.state.managedBilling.chargedMicros, 10003); assert.deepEqual(f.state.managedRequestIds, ['receipt']);
    await f.run('search', input, context); // a recovered server receipt is idempotent in the local total
    assert.equal(f.state.managedBilling.requestCount, 1);
});

test('parent limits and changed capability prevent upstream dispatch', async () => {
    const f = fixture();
    await assert.rejects(f.run('search', { query: 'test' }, { ...context, remainingTokenBudget: { usageKnown: true, remainingOutputTokens: 0 } }), e => e.code === 'TOKEN_BUDGET_EXHAUSTED');
    assert.equal(f.calls.length, 0);
    f.host.contextCatalogOfferings[0].nativeWebResearch.source = 'merchant_declaration';
    await assert.rejects(f.run('search', { query: 'test' }, context), e => e.code === 'WEB_RESEARCH_UNSUPPORTED');
    assert.equal(f.calls.length, 0);
});

test('unknown paid outcome is not retried or reclassified as a free result', async () => {
    const f = fixture(); f.host.failure = new PlatformRequestError('BILLING_TRANSPORT_UNKNOWN');
    const result = await f.run('search', { query: 'test' }, context);
    assert.equal(f.calls.length, 1); assert.equal(result.usageKnown, false); assert.equal(result.modelOutput.retrySafe, false);
    assert.equal(result.modelOutput.code, 'BILLING_TRANSPORT_UNKNOWN'); assert.equal(f.state.managedBilling.requestCount, 0);
});

test('missing source evidence does not become a claim of completed public research', async () => {
    const f = fixture({ citations: [], usage: { inputTokens: 100, outputTokens: 20, usageKnown: true } });
    const result = await f.run('search', { query: 'test' }, context);
    assert.notEqual(result.modelOutput.status, 'ok');
    assert.equal(result.modelOutput.usageEvidence.search.status, 'missing');
    assert.equal(result.usageKnown, true, 'token usage and web evidence are separate facts');
});

test('an evicted fixed offering is re-read by exact ID and restored without changing the selected API', async () => {
    const f = fixture(), selected = structuredClone(f.host.contextCatalogOfferings[0]);
    f.host.refreshedOffering = selected;
    f.host.contextCatalogOfferings = [{ ...selected, id: 'another-api' }];
    const result = await f.run('search', { query: 'test' }, context);
    assert.equal(result.modelOutput.status, 'ok');
    assert.deepEqual(f.catalogReads, ['a']);
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0][0], route);
    assert.deepEqual(f.host.contextCatalogOfferings.find(offering => offering.id === 'a'), selected);
    await f.run('search', { query: 'later' }, { ...context, executionId: 'next-batch' });
    assert.deepEqual(f.catalogReads, ['a'], 'restored metadata avoids extra reads on subsequent calls');
});

test('a fixed active offering with absent optional research metadata can recover fresh platform evidence', async () => {
    const f = fixture(), selected = structuredClone(f.host.contextCatalogOfferings[0]);
    f.host.contextCatalogOfferings[0].nativeWebResearch = undefined;
    f.host.refreshedOffering = selected;
    await f.run('search', { query: 'test' }, context);
    assert.deepEqual(f.catalogReads, ['a']); assert.equal(f.calls.length, 1);
    assert.deepEqual(f.host.contextCatalogOfferings[0].nativeWebResearch, selected.nativeWebResearch);
});

test('explicit unknown, unsupported, unproved, disabled and withdrawn entries never trigger a metadata retry', async () => {
    for (const change of [
        { nativeWebResearch: { profile: 'openrouter_server_tools', search: 'unknown', fetch: 'unknown', boundedSearch: false, source: 'provider_metadata' } },
        { nativeWebResearch: { profile: 'openrouter_server_tools', search: 'unsupported', fetch: 'unsupported', boundedSearch: false, source: 'provider_metadata' } },
        { nativeWebResearch: { profile: 'openrouter_server_tools', search: 'supported', fetch: 'supported', boundedSearch: true, source: 'merchant_declaration' } },
        { nativeWebResearch: null },
        { available: false }, { status: 'unavailable' },
    ]) {
        const f = fixture(); f.host.refreshedOffering = structuredClone(f.host.contextCatalogOfferings[0]);
        Object.assign(f.host.contextCatalogOfferings[0], change);
        await assert.rejects(f.run('search', { query: 'test' }, context), error => error.code === 'WEB_RESEARCH_UNSUPPORTED');
        assert.equal(f.catalogReads.length, 0); assert.equal(f.calls.length, 0);
    }
});

test('missing, wrong-ID, withdrawn and unproved fresh evidence cannot authorize a paid call', async () => {
    const selected = structuredClone(fixture().host.contextCatalogOfferings[0]);
    for (const fresh of [undefined, { ...selected, id: 'wrong-api' }, { ...selected, status: 'unavailable' },
        { ...selected, available: false }, { ...selected, nativeWebResearch: undefined },
        { ...selected, nativeWebResearch: { ...selected.nativeWebResearch, source: 'merchant_declaration' } }]) {
        const f = fixture(); f.host.contextCatalogOfferings = []; f.host.refreshedOffering = fresh;
        await assert.rejects(f.run('search', { query: 'test' }, context), error => error.code === 'WEB_RESEARCH_UNSUPPORTED');
        assert.deepEqual(f.catalogReads, ['a']); assert.equal(f.calls.length, 0);
    }
});

test('failed exact metadata read is not retried and automatic routes do not guess an offering', async () => {
    const fixed = fixture(); fixed.host.contextCatalogOfferings = []; fixed.host.catalogFailure = new Error('offline');
    await assert.rejects(fixed.run('search', { query: 'test' }, context), error => error.code === 'WEB_RESEARCH_UNSUPPORTED');
    assert.deepEqual(fixed.catalogReads, ['a']); assert.equal(fixed.calls.length, 0);
    const automatic = fixture(); automatic.host.contextCatalogOfferings = [];
    automatic.state.managedRoute = { mode: 'automatic', registryModelId: 'model' };
    automatic.run = make.call(automatic.host, automatic.host, automatic.state);
    await assert.rejects(automatic.run('search', { query: 'test' }, context), error => error.code === 'WEB_RESEARCH_UNSUPPORTED');
    assert.equal(automatic.catalogReads.length, 0); assert.equal(automatic.calls.length, 0);
});

test('current cached capability adds no public catalog read and still obeys parent paid-token limits', async () => {
    const f = fixture();
    await f.run('search', { query: 'test' }, context);
    assert.equal(f.catalogReads.length, 0);
    await assert.rejects(f.run('search', { query: 'test' }, { ...context, remainingTokenBudget: { usageKnown: true, remainingOutputTokens: 0 } }), error => error.code === 'TOKEN_BUDGET_EXHAUSTED');
    assert.equal(f.catalogReads.length, 0); assert.equal(f.calls.length, 1);
});
