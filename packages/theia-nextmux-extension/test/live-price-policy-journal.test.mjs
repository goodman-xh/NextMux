import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, Module } from 'node:module';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

// Load the actual source so this boundary review cannot accidentally test an
// older compiled journal implementation while another worker builds the app.
const require = createRequire(import.meta.url);
const ts = require('typescript');
const sourcePath = fileURLToPath(new URL('../src/node/nextmux-managed-task-authority.ts', import.meta.url));
const compiled = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = new Module(sourcePath);
module.filename = sourcePath;
module.paths = Module._nodeModulePaths(dirname(sourcePath));
module._compile(compiled, sourcePath);
const {
    authorityBodyHash, managedRequestAuthority, legacyCapacityJournal,
    resolveManagedRequestPricePolicy, claimManagedTaskSubmission, recordManagedTaskDelivery
} = module.exports;

const platformOrigin = 'https://price-policy.fixture.invalid';
const userId = 'price-policy-owner';
const originalBody = () => ({
    automaticRouting: false,
    offeringId: 'fixed-original-offering',
    keyPriceQuoteId: `kq1_${'a'.repeat(64)}`,
    messages: [{ role: 'user', content: 'private original prompt' }],
    tools: [], workbench: 'coding', maximumOutputTokens: 1000,
    switchPolicy: { mode: 'single_route' }
});
async function scope(t, requestKey = randomUUID()) {
    const root = await mkdtemp(join(tmpdir(), 'nextmux-live-price-policy-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    return { root, platformOrigin, userId, requestKey };
}
function token(input, requestId) {
    return 'nmx-ta1.' + Buffer.from(JSON.stringify({
        version: 1, origin: 'protocol_first_submit', userId,
        clientNonce: input.clientNonce, bodyHash: input.bodyHash, requestId
    })).toString('base64url') + '.fixture';
}
function admissions() {
    const saved = new Map(), calls = [];
    return {
        saved, calls,
        async admit(input) {
            calls.push(input);
            let response = saved.get(input.clientNonce);
            if (!response) {
                const requestId = randomUUID();
                response = { ok: true, clientNonce: input.clientNonce, bodyHash: input.bodyHash,
                    requestId, authorityRef: token(input, requestId) };
                saved.set(input.clientNonce, response);
            }
            return response;
        }
    };
}
async function files(root) {
    const result = {};
    async function visit(path) {
        for (const entry of await readdir(path, { withFileTypes: true })) {
            const target = join(path, entry.name);
            if (entry.isDirectory()) await visit(target);
            else result[target.slice(root.length)] = await readFile(target, 'utf8');
        }
    }
    await visit(root);
    return result;
}

test('only a fresh invocation opts into current pricing and resolving creates no admission or content journal', async t => {
    const owner = await scope(t), body = originalBody();
    assert.equal(typeof resolveManagedRequestPricePolicy, 'function');
    const current = await resolveManagedRequestPricePolicy({ ...owner, body, firstSubmit: true });
    assert.deepEqual(current, { ...body, pricePolicy: 'current' });
    assert.equal(Object.hasOwn(body, 'pricePolicy'), false, 'caller input is not mutated');
    assert.deepEqual(await readdir(owner.root), [], 'policy selection must not create an authority or nonce');
    const historical = await resolveManagedRequestPricePolicy({ ...owner, body, firstSubmit: false });
    assert.deepEqual(historical, body);
});

for (const policy of [undefined, 'current']) {
    test(`persisted legacy authority ${policy || 'old format'} retains its exact body when reopened`, async t => {
        const owner = await scope(t), body = { ...originalBody(), ...(policy ? { pricePolicy: policy } : {}) };
        await managedRequestAuthority({ ...owner, body, firstSubmit: true, enrolled: false });
        const before = await files(owner.root);
        for (const firstSubmit of [false, true]) {
            for (const proposedBody of [originalBody(), { ...originalBody(), pricePolicy: 'current' }]) {
                const recovered = await resolveManagedRequestPricePolicy({ ...owner, body: proposedBody, firstSubmit });
                assert.deepEqual(recovered, body);
                assert.deepEqual(await managedRequestAuthority({ ...owner, body: recovered, firstSubmit, enrolled: true,
                    admit: async () => assert.fail('legacy request must never re-admit') }), { mode: 'legacy' });
            }
        }
        assert.deepEqual(await files(owner.root), before);
    });

    test(`TaskAccount ${policy || 'old format'} capacity resume preserves original authority and submission hash`, async t => {
        const owner = await scope(t), body = { ...originalBody(), ...(policy ? { pricePolicy: policy } : {}) };
        const server = admissions();
        const authority = await managedRequestAuthority({ ...owner, body, firstSubmit: true, enrolled: true, admit: server.admit });
        const receiptScope = { root: owner.root, platformOrigin, userId, requestId: authority.requestId };
        assert.equal(await claimManagedTaskSubmission({ ...receiptScope, body }), true);
        await recordManagedTaskDelivery({ ...receiptScope, delivery: 'waiting_capacity' });
        const before = await files(owner.root);
        const recovered = await resolveManagedRequestPricePolicy({ ...owner, body: originalBody(), firstSubmit: false });
        assert.deepEqual(recovered, body);
        const reopened = await managedRequestAuthority({ ...owner, body: recovered, firstSubmit: false, enrolled: false,
            admit: async () => assert.fail('known authority is not repriced/re-admitted') });
        assert.equal(reopened.authorityRef, authority.authorityRef);
        assert.equal(reopened.requestId, authority.requestId);
        assert.equal(reopened.submissionState, 'waiting_capacity');
        assert.deepEqual(await files(owner.root), before);
        assert.equal(await claimManagedTaskSubmission({ ...receiptScope, body: recovered,
            waiting: { requestId: authority.requestId, bodyHash: authorityBodyHash(body), canResume: true } }), true);
        assert.equal(server.calls.length, 1);
    });

    test(`legacy capacity-only ${policy || 'old format'} journal wins over a fresh flag`, async t => {
        const owner = await scope(t), body = { ...originalBody(), ...(policy ? { pricePolicy: policy } : {}) };
        const requestId = randomUUID();
        await legacyCapacityJournal({ ...owner, body }, { requestId, serverBodyHash: 'b'.repeat(64), delivery: 'waiting_capacity' });
        const before = await files(owner.root);
        const recovered = await resolveManagedRequestPricePolicy({ ...owner, body: originalBody(), firstSubmit: true });
        assert.deepEqual(recovered, body);
        const record = await legacyCapacityJournal({ ...owner, body: recovered });
        assert.equal(record.requestId, requestId);
        assert.equal(record.delivery, 'waiting_capacity');
        assert.deepEqual(await files(owner.root), before);
    });
}

test('lost admission acknowledgement reuses original current-price nonce and exact body after cold reconstruction', async t => {
    const owner = await scope(t), body = { ...originalBody(), pricePolicy: 'current' }, server = admissions();
    await assert.rejects(managedRequestAuthority({ ...owner, body, firstSubmit: true, enrolled: true,
        admit: async input => { await server.admit(input); throw Error('ACK_LOST'); } }), /ACK_LOST/);
    const recovered = await resolveManagedRequestPricePolicy({ ...owner, body: originalBody(), firstSubmit: false });
    assert.deepEqual(recovered, body);
    const authority = await managedRequestAuthority({ ...owner, body: recovered, firstSubmit: false, enrolled: false, admit: server.admit });
    assert.equal(authority.requestId, [...server.saved.values()][0].requestId);
    assert.equal(server.saved.size, 1);
    assert.equal(new Set(server.calls.map(row => row.clientNonce)).size, 1);
    assert.equal(new Set(server.calls.map(row => row.bodyHash)).size, 1);
});

test('policy compatibility cannot change prompt, offering, original quote, or explicit charge limit', async t => {
    const owner = await scope(t), body = { ...originalBody(), pricePolicy: 'current' };
    await managedRequestAuthority({ ...owner, body, firstSubmit: true, enrolled: false });
    const before = await files(owner.root);
    for (const changed of [
        { messages: [{ role: 'user', content: 'different prompt' }] },
        { offeringId: 'different-offering' },
        { keyPriceQuoteId: `kq1_${'f'.repeat(64)}` },
        { switchPolicy: { mode: 'single_route', maxRequestChargeMicros: 999 } }
    ]) {
        await assert.rejects(resolveManagedRequestPricePolicy({ ...owner, body: { ...originalBody(), ...changed }, firstSubmit: true }),
            error => error.code === 'TASK_AUTHORITY_JOURNAL_CONFLICT');
    }
    assert.deepEqual(await files(owner.root), before);
});

test('privacy upgrade restores exact legacy strict body only with the original durable owner-scoped hash', async t => {
    for (const zeroDataRetention of [false, true]) for (const dataCollection of ['allow', 'deny']) {
        const owner = await scope(t);
        const old = { ...originalBody(), zeroDataRetention, dataCollection, pricePolicy: 'current' };
        await managedRequestAuthority({ ...owner, body: old, firstSubmit: true, enrolled: false });
        const before = await files(owner.root);
        const proposed = { ...originalBody(), privacyPreference: { mode: 'advisory-v1', zeroDataRetention: false, dataCollection: 'allow' } };
        const restored = await resolveManagedRequestPricePolicy({ ...owner, body: proposed, firstSubmit: true });
        assert.deepEqual(restored, old);
        assert.equal(Object.hasOwn(restored, 'privacyPreference'), false);
        assert.deepEqual(await managedRequestAuthority({ ...owner, body: restored, firstSubmit: false,
            enrolled: true, admit: () => assert.fail('restoring a strict request must not re-admit it') }), { mode: 'legacy' });
        assert.deepEqual(await files(owner.root), before);
        await assert.rejects(resolveManagedRequestPricePolicy({ ...owner, body: { ...proposed, offeringId: 'another-api' }, firstSubmit: true }),
            error => error.code === 'TASK_AUTHORITY_JOURNAL_CONFLICT');
    }
});

test('changed checkbox settings preserve the original advisory preference on TaskAccount capacity resume', async t => {
    const owner = await scope(t), server = admissions();
    const body = { ...originalBody(), privacyPreference: { mode: 'advisory-v1', zeroDataRetention: true, dataCollection: 'deny' }, pricePolicy: 'current' };
    const authority = await managedRequestAuthority({ ...owner, body, firstSubmit: true, enrolled: true, admit: server.admit });
    const delivery = { root: owner.root, platformOrigin, userId, requestId: authority.requestId };
    await claimManagedTaskSubmission({ ...delivery, body });
    await recordManagedTaskDelivery({ ...delivery, delivery: 'waiting_capacity' });
    const before = await files(owner.root);
    const proposed = { ...originalBody(), privacyPreference: { mode: 'advisory-v1', zeroDataRetention: false, dataCollection: 'allow' } };
    const restored = await resolveManagedRequestPricePolicy({ ...owner, body: proposed, firstSubmit: false });
    assert.deepEqual(restored, body);
    const reopened = await managedRequestAuthority({ ...owner, body: restored, firstSubmit: false,
        enrolled: false, admit: () => assert.fail('never admit the same task again') });
    assert.equal(reopened.authorityRef, authority.authorityRef);
    assert.equal(reopened.requestId, authority.requestId);
    assert.deepEqual(await files(owner.root), before);
    assert.equal(server.calls.length, 1);
});

test('privacy compatibility never weakens a fresh request or an explicit new constraint', async t => {
    const owner = await scope(t);
    const body = { ...originalBody(), zeroDataRetention: true, dataCollection: 'deny',
        privacyPreference: { mode: 'advisory-v1', zeroDataRetention: false, dataCollection: 'allow' } };
    assert.deepEqual(await resolveManagedRequestPricePolicy({ ...owner, body, firstSubmit: true }), { ...body, pricePolicy: 'current' });
    assert.deepEqual(await readdir(owner.root), []);
    await managedRequestAuthority({ ...owner, body, firstSubmit: true, enrolled: false });
    await assert.rejects(resolveManagedRequestPricePolicy({ ...owner, body: { ...body, zeroDataRetention: false }, firstSubmit: true }),
        error => error.code === 'TASK_AUTHORITY_JOURNAL_CONFLICT');
});

test('a foreign account cannot use policy recovery to adopt the old request', async t => {
    const owner = await scope(t), body = originalBody();
    await managedRequestAuthority({ ...owner, body, firstSubmit: true, enrolled: false });
    await assert.rejects(resolveManagedRequestPricePolicy({ ...owner, userId: 'foreign-owner', body, firstSubmit: true }),
        error => error.code === 'TASK_AUTHORITY_ACCOUNT_CHANGED' || error.code === 'TASK_AUTHORITY_JOURNAL_CONFLICT');
});

test('authority and capacity journals must agree on the exact old/current body', async t => {
    const owner = await scope(t), body = originalBody();
    await managedRequestAuthority({ ...owner, body, firstSubmit: true, enrolled: false });
    await legacyCapacityJournal({ ...owner, body: { ...body, pricePolicy: 'current' } },
        { requestId: randomUUID(), serverBodyHash: 'b'.repeat(64), delivery: 'waiting_capacity' });
    await assert.rejects(resolveManagedRequestPricePolicy({ ...owner, body, firstSubmit: true }),
        error => ['TASK_AUTHORITY_JOURNAL_CONFLICT', 'CAPACITY_JOURNAL_CONFLICT'].includes(error.code));
});
