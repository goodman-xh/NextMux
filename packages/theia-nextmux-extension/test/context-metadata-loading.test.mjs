import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { AgentToolRegistry, BuiltinAgentBackend } from '@nextmux/agent-runtime';
import { estimateAgentModelInputTokens } from '@nextmux/agent-runtime/token-budget';

class ColdHost extends NextMuxPlatformServiceImpl {
    paths = [];
    response = [{ id: 'saved-offering-beyond-500', registryModelId: 'registry-model', routeContextTokens: 8000, routeMaximumOutputTokens: 1000 }];
    async request(path) {
        this.paths.push(path);
        if (path.startsWith('/api/models/registry?')) return { models: [{ id: 'registry-model', provider: 'openai', canonicalModel: 'openai/fixture', contextTokens: 128000, maximumOutputTokens: 16000 }], nextOffset: null };
        assert.equal(path, '/api/catalog?offeringId=saved-offering-beyond-500&limit=1');
        return { offerings: this.response };
    }
}

test('a restarted headless plan resolves a saved fixed offering outside the global catalog before model invocation', async t => {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-headless-capacity-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const request = { route: { kind: 'managed_gateway', route: { mode: 'fixed', offeringId: 'saved-offering-beyond-500' } },
        prompt: 'Keep the exact scheduled goal.', contextWindowTokens: 64000 };
    await writeFile(join(root, 'scheduled-request.json'), JSON.stringify(request));
    const restored = JSON.parse(await readFile(join(root, 'scheduled-request.json'), 'utf8'));
    const host = new ColdHost();
    assert.equal(host.modelRegistryCache, undefined); assert.equal(host.merchantCatalogPages.size, 0);
    await host.ensureContextMetadata(restored);
    const limits = host.contextLimitsForRequest(restored);
    assert.deepEqual(limits, { contextWindowTokens: 8000, modelOutputTokenLimit: 1000 });
    const tools = new AgentToolRegistry();
    tools.register({ name: 'files.read', source: 'builtin', requiredPermission: 'read_only', description: 'Read a workspace file', inputSchema: { type: 'object' } },
        async () => ({ modelOutput: {}, summary: { title: 'unused' } }));
    const backend = new BuiltinAgentBackend({ tools, model: { async complete(input) {
        assert.ok(estimateAgentModelInputTokens(input.instructions, input.messages, input.tools) + input.maxOutputTokens <= 8000);
        assert.ok(input.maxOutputTokens <= 1000); return { content: 'Scheduled task completed' };
    } } });
    const result = await backend.run({ ...limits, prompt: restored.prompt, workspaceRoot: root, permissionMode: 'read_only', tools, requiredBackendCapabilities: ['contextWindow'] });
    assert.equal(result.status, 'completed');
    await host.ensureContextMetadata(restored);
    assert.equal(host.paths.length, 2, 'registry TTL and offering cache avoid repeated metadata reads');
    const source = await readFile(new URL('../src/node/nextmux-platform-service.ts', import.meta.url), 'utf8');
    assert.ok(source.indexOf('await this.ensureContextMetadata(request);') < source.indexOf('const getContextLimits ='));
});

test('missing or mismatched offering metadata cannot borrow another route capacity after restart', async () => {
    const request = { route: { kind: 'managed_gateway', route: { mode: 'fixed', offeringId: 'saved-offering-beyond-500' } } };
    for (const response of [[], [{ id: 'different-route', registryModelId: 'registry-model', routeContextTokens: 1000000 }]]) {
        const host = new ColdHost(); host.response = response;
        await host.ensureContextMetadata(request);
        assert.deepEqual(host.contextLimitsForRequest(request), { modelOutputTokenLimit: 4096 });
        assert.equal(host.contextCatalogOfferings.length, 0);
    }
});


test('output-only route ceilings survive unknown context in automatic mode', () => {
    const host = new ColdHost();
    host.contextCatalogOfferings = [{ id: 'output-only', registryModelId: 'registry-model', routeMaximumOutputTokens: 700 }];
    assert.deepEqual(host.contextLimitsForRequest({ route: { kind: 'managed_gateway', route: { mode: 'fixed', offeringId: 'output-only' } } }), { modelOutputTokenLimit: 700 });
    host.contextCatalogOfferings = [{ id: 'input-only', registryModelId: 'registry-model', routeInputTokens: 2000, routeMaximumOutputTokens: 500 }];
    assert.deepEqual(host.contextLimitsForRequest({ route: { kind: 'managed_gateway', route: { mode: 'fixed', offeringId: 'input-only' } } }), { contextWindowTokens: 2000, modelInputTokenLimit: 2000, modelOutputTokenLimit: 500 });
});
