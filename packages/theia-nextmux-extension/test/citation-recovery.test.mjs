import assert from 'node:assert/strict';
import test from 'node:test';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

test('explicit receipt recovery retains only public citations without another generation or tool execution', async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    const service = new NextMuxPlatformServiceImpl();
    const requests = [];
    service.request = async (path, options) => {
        requests.push({ path, options });
        return { call: { id }, response: { model: 'fixture-model', content: 'Original answer', citations: [
            { url: 'https://example.com/source', title: 'Source <script>', encrypted_index: 'PRIVATE' },
            { url: 'https://user:secret@example.com' }, { url: 'javascript:alert(1)' },
        ], toolCalls: [{ id: 'old-tool', name: 'never.execute', arguments: { secret: 'PRIVATE' } }], providerState: { secret: 'PRIVATE' } }, billing: { currency: 'USD', chargedMicros: 1 } };
    };
    const recovered = await service.recoverManagedReceipt(id);
    assert.deepEqual(recovered.result.citations, [{ url: 'https://example.com/source', title: 'Source <script>' }]);
    assert.equal(recovered.result.toolCallCount, 1);
    assert.doesNotMatch(JSON.stringify(recovered), /PRIVATE|never.execute|javascript|user:secret/);
    assert.deepEqual(requests, [{ path: `/api/gateway/responses/${id}/recover`, options: { authenticated: true, method: 'POST', timeoutMs: 15_000 } }]);
});
