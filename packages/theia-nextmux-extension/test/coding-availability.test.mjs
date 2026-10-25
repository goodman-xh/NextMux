import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';

test('catalog normalization preserves coding availability and its gateway refusal reason', async () => {
    const states = [
        { available: true, minimumInputTokens: 25000, maximumOutputTokens: 4096 },
        { available: false, unavailableReason: 'credential_token_limit', minimumInputTokens: 25000, maximumOutputTokens: 4096 }
    ];
    const managedTransport = { protocol: 'openai', orderedMediaReplay: false, fileInputMimeTypes: ['application/pdf'] };
    const credentialCapacity = { maximumRequestTokens: 60000 };
    const inputRestrictions = [{ modality: 'video', reason: 'context_estimate_unknown' }];
    class FixtureService extends NextMuxPlatformServiceImpl {
        async request() {
            return { offerings: states.map((codingAvailability, index) => ({
                id: `coding-${index}`, merchantId: 'merchant', canonicalModel: 'vendor/coding-model', status: 'active',
                workbenches: codingAvailability.available ? ['coding'] : [],
                input: ['text'], output: ['text'], capabilities: ['coding', 'tools'], codingAvailability,
                available: true, managedTransport, credentialCapacity, inputRestrictions
            })) };
        }
    }
    const service = new FixtureService();
    const catalog = await service.getCatalog();
    assert.equal(catalog.online, true);
    assert.deepEqual(catalog.offerings.map(offering => offering.codingAvailability), states);
    assert.deepEqual(catalog.offerings[0].managedTransport, managedTransport);
    assert.deepEqual(catalog.offerings[0].credentialCapacity, credentialCapacity);
    assert.deepEqual(catalog.offerings[0].inputRestrictions, inputRestrictions);
    assert.deepEqual((await service.getCatalogOffering('coding-1')).codingAvailability, states[1]);
});

test('legacy coding and comic text pickers exclude incompatible categories without a coding profile', () => {
    const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
    const methods = ['managedOfferings', 'comicCatalogTextRoutes'].map(name => {
        const method = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === name);
        assert.ok(method, `production method ${name}`);
        return method.getText(ast);
    });
    const Harness = new Function(ts.transpileModule(`class Harness { ${methods.join('\n')} }; return Harness;`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 }
    }).outputText)();
    const categories = ['coding', 'text', 'reasoning', undefined, 'image', 'video', 'audio', 'embedding', 'other'];
    const offerings = categories.map(category => ({ id: category || 'legacy', merchantId: 'merchant', category,
        status: 'active', workbenches: ['coding'], input: ['text'], output: ['text'],
        capabilities: ['coding', 'tools', 'reasoning'] }));
    assert.ok(offerings.every(offering => offering.codingAvailability === undefined));
    const h = Object.assign(new Harness(), {
        platformCatalog: { offerings }, selectedMerchantCatalog: { merchantId: 'merchant', offerings },
        merchantPickerSnapshots: new Map(), offeringMerchantId: offering => offering.merchantId,
        privacySettings: { requireZeroDataRetention: true, denyDataCollection: true },
    });
    const eligible = ['coding', 'text', 'reasoning', 'legacy'];
    assert.deepEqual(h.managedOfferings('coding').map(offering => offering.id), eligible, 'automatic coding selection');
    assert.deepEqual(h.managedOfferings('coding', 'merchant').map(offering => offering.id), eligible, 'loaded relay coding selection');
    assert.deepEqual(h.comicCatalogTextRoutes('merchant').map(route => route.offering.id), eligible, 'uncached comic text selection');
    offerings[0].privacy = { meetsZeroDataRetention: false };
    offerings[0].privacy.meetsDenyDataCollection = false;
    for (const requireZeroDataRetention of [false, true]) for (const denyDataCollection of [false, true]) {
        h.privacySettings = { requireZeroDataRetention, denyDataCollection };
        assert.deepEqual(h.managedOfferings('coding').map(offering => offering.id), eligible, 'privacy preferences never hide active coding models');
        assert.deepEqual(h.managedOfferings('coding', 'merchant').map(offering => offering.id), eligible, 'fixed relay model list stays available');
        assert.deepEqual(h.comicCatalogTextRoutes('merchant').map(route => route.offering.id), eligible, 'comic text model list stays available');
    }
});
