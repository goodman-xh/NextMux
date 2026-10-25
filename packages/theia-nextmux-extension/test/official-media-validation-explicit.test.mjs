import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMediaTemplate } from '@nextmux/model-runtime/media-template';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

// Execute the production save and check methods against synthetic state and an
// intercepted HTTP boundary. No user connection, keychain or real API is read.
class Fixture extends NextMuxPlatformServiceImpl {
    connections = []; credentials = new Map(); requests = []; responseStatus = 200;
    async readOfficialConnectionIndex() { return structuredClone(this.connections); }
    async writeOfficialConnectionIndex(value) { this.connections = structuredClone(value); }
    async readOfficialCredential(id) { return this.credentials.get(id) || null; }
    async writeOfficialCredential(id, value) { this.credentials.set(id, value); }
    async deleteOfficialCredential(id) { this.credentials.delete(id); }
    networkFetch = async () => { throw new Error('No metadata network is needed by a custom media template'); };
    async timedMediaFetch(url, init) {
        this.requests.push({ url: String(url), method: init.method, body: init.body });
        return Response.json({ code: this.responseStatus }, { status: this.responseStatus });
    }
}
const template = method => normalizeMediaTemplate({ preset: 'custom', kind: 'video',
    submit: { path: '{base}/submit', method: 'POST', body: '{"model":"{{model}}","prompt":"{{prompt}}"}' },
    poll: { path: '{base}/status/{id}', method, ...(method === 'POST' ? { body: '{"id":"{{id}}"}' } : {}) }
});
const request = method => ({ providerId: 'custom_media', model: 'synthetic-video', baseUrl: 'https://media.fixture.invalid/v1',
    apiKey: 'synthetic-test-value', providerSettings: { mediaTemplate: template(method) }, validate: false });
const update = (saved, extra = {}) => ({ providerId: saved.providerId, connectionId: saved.id, model: saved.model,
    baseUrl: saved.baseUrl, providerSettings: saved.providerSettings, validate: false, ...extra });

for (const method of ['GET', 'POST']) {
    test(`${method} media poll is not called by save-only, explicit test calls exactly once and preserves failure gates`, async () => {
        const service = new Fixture(); const initial = (await service.saveOfficialModelConnection(request(method))).connection;
        assert.equal(initial.status, 'unverified'); assert.equal(service.requests.length, 0);
        const checked = (await service.saveOfficialModelConnection(update(initial, { validate: true }))).connection;
        assert.equal(checked.status, 'verified'); assert.equal(service.requests.length, 1);
        const captured = service.requests[0]; assert.equal(captured.method, method);
        assert.equal(captured.url, 'https://media.fixture.invalid/v1/status/nextmux-key-check');
        assert.equal(captured.url.includes('/submit'), false);
        assert.equal(captured.body, method === 'POST' ? '{"id":"nextmux-key-check"}' : undefined);
        const same = (await service.saveOfficialModelConnection(update(checked))).connection;
        assert.equal(same.status, 'verified', 'unchanged endpoint/key/model/template retains its existing evidence');
        assert.equal(service.requests.length, 1, 'saving the same configuration never repeats its check');
    });
    for (const changed of ['baseUrl', 'key', 'model', 'template']) test(`${method} changed ${changed} saved without testing cannot inherit verified media status`, async () => {
        const service = new Fixture(); const checked = (await service.saveOfficialModelConnection({ ...request(method), validate: true })).connection;
        const change = changed === 'baseUrl' ? { baseUrl: 'https://different.fixture.invalid/v1' }
            : changed === 'key' ? { apiKey: 'synthetic-replacement-value' }
            : changed === 'model' ? { model: 'another-synthetic-video' }
            : { providerSettings: { mediaTemplate: { ...checked.providerSettings.mediaTemplate, poll: { ...checked.providerSettings.mediaTemplate.poll, path: '{base}/different/{id}' } } } };
        const edited = (await service.saveOfficialModelConnection(update(checked, change))).connection;
        assert.equal(service.requests.length, 1); assert.equal(edited.status, 'unverified');
        assert.equal(edited.toolCapability, 'untested');
    });
    for (const status of [401, 403, 503]) test(`${method} explicit poll HTTP ${status} remains an error with no automatic retry or saved proof`, async () => {
        const service = new Fixture(); service.responseStatus = status;
        await assert.rejects(service.saveOfficialModelConnection({ ...request(method), validate: true }));
        assert.equal(service.requests.length, 1); assert.deepEqual(service.connections, []);
    });
}
