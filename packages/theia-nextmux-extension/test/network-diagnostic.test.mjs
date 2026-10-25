import test from 'node:test';
import assert from 'node:assert/strict';
import { platformTransportDiagnostic } from '../lib/node/nextmux-network-diagnostic.js';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

test('transport diagnosis keeps bounded known facts without SDK secrets or request data', () => {
    const e = Object.assign(new TypeError('fetch failed https://user:password@private.test/?key=secret'), {
        cause: Object.assign(new Error('Bearer token and body'), { code: 'ECONNRESET', cause: { code: 'made-up-secret', name: 'secret' } }),
        headers: { authorization: 'secret' }, body: 'private prompt'
    });
    assert.equal(platformTransportDiagnostic(e, 'http_dispatch'), 'transport_stage=http_dispatch; error_type=TypeError; error_type=Error; network_code=ECONNRESET');
    e.cause.cause = e;
    assert.match(platformTransportDiagnostic(e, 'response_read'), /network_code=ECONNRESET/);
    assert.equal(platformTransportDiagnostic({ get cause() { throw Error('secret'); } }, 'prepare_headers'), 'transport_stage=prepare_headers');
});

class Service extends NextMuxPlatformServiceImpl {
    call(options) { return this.request('/api/test', options); }
    async deviceIdForRequest() { if (this.deviceError) throw this.deviceError; return 'fixture'; }
}

test('real request error retains transport stage and network cause across the RPC readableError envelope', async () => {
    const s = new Service();
    s.networkFetch = async () => { throw Object.assign(new TypeError('fetch failed secret'), { cause: { code: 'ENOTFOUND' } }); };
    await assert.rejects(s.call({}), e => e.code === 'PLATFORM_OFFLINE' && e.data.readableError.detail.includes('transport_stage=http_dispatch')
        && e.data.readableError.detail.includes('network_code=ENOTFOUND') && !e.data.readableError.detail.includes('secret'));
    s.deviceError = new Error('device local file path and private content');
    await assert.rejects(s.call({ authenticated: true }), e => e.code === 'PLATFORM_OFFLINE' && e.data.readableError.detail.includes('transport_stage=prepare_headers')
        && !e.data.readableError.detail.includes('private content'));
    s.deviceError = undefined;
    s.networkFetch = async () => new Response(new ReadableStream({ start(controller) { controller.error(Object.assign(new Error('secret'), { code: 'UND_ERR_SOCKET' })); } }));
    await assert.rejects(s.call({}), e => e.code === 'PLATFORM_OFFLINE' && e.data.readableError.detail.includes('transport_stage=response_read')
        && e.data.readableError.detail.includes('network_code=UND_ERR_SOCKET'));
});

test('caller cancellation stays cancellation rather than a network fault', async () => {
    const s = new Service(), c = new AbortController(); c.abort();
    s.networkFetch = async () => { throw Error('must not dispatch'); };
    await assert.rejects(s.call({ signal: c.signal }), e => e.code === 'CANCELLED');
});
