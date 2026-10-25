import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { officialDiscoveryCapabilityEvidence, invokableOfficialDiscovery, officialInvokableModelIds, officialDiscoveredModelIds, officialDiscoverySummary, OfficialCatalogDetails } from '../lib/browser/nextmux-official-discovery.js';
import { officialDiscoveryText } from '../lib/browser/nextmux-official-discovery-locale.js';
const require = createRequire(import.meta.url), coreRequire = createRequire(require.resolve('@theia/core/package.json'));
const React = coreRequire('react'), { renderToStaticMarkup } = coreRequire('react-dom/server');
const locales = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];
const connection = { providerId: 'azure_openai', model: 'my-production-alias', status: 'unverified', toolCapability: 'untested', modelDiscoveryStatus: 'catalog_discovered',
    discoveredModels: [{ id: 'gpt-fixture', label: '<catalog model>', selectionMode: 'catalog_only' }, { id: 'old-cached-model', label: 'Old cache' }, { id: 'old-invokable', label: 'Old cached flag', selectionMode: 'invokable' }] };

test('Azure old and new catalog IDs never become deployment routes; the explicit saved alias is preserved', () => {
    const before = JSON.stringify(connection);
    assert.deepEqual(invokableOfficialDiscovery(connection), []);
    assert.deepEqual(officialInvokableModelIds(connection), ['my-production-alias']);
    assert.deepEqual(officialInvokableModelIds({ ...connection, model: '' }), []);
    assert.equal(officialDiscoverySummary('en', { ...connection, modelDiscoveryStatus: 'verified' }), 'Catalog models · 3');
    assert.equal(JSON.stringify(connection), before, 'does not mutate credentials, model or evidence');
});

test('the picker can show the complete authenticated catalog while invocation stays separately gated', () => {
    assert.deepEqual(officialDiscoveredModelIds(connection), ['my-production-alias', 'gpt-fixture', 'old-cached-model', 'old-invokable']);
    assert.deepEqual(officialInvokableModelIds(connection), ['my-production-alias']);
});

test('Bedrock catalog and legacy flags never become callable profiles; the existing hand-entered ID remains', () => {
    const bedrock = { ...connection, providerId: 'bedrock', model: 'us.example.profile:0' };
    const before = JSON.stringify(bedrock);
    assert.deepEqual(invokableOfficialDiscovery(bedrock), []);
    assert.deepEqual(officialInvokableModelIds(bedrock), ['us.example.profile:0']);
    assert.deepEqual(officialInvokableModelIds({ ...bedrock, model: '' }), []);
    for (const locale of locales) {
        const note = officialDiscoveryText(locale, 'catalogNote');
        assert.ok(note); assert.doesNotMatch(note, /Azure/);
        assert.ok(officialDiscoveryText(locale, 'invocation'));
        assert.notEqual(officialDiscoveryText(locale, 'deployment'), officialDiscoveryText(locale, 'invocation'));
        assert.equal(officialDiscoverySummary(locale, { ...bedrock, modelDiscoveryStatus: 'verified' }), `${officialDiscoveryText(locale, 'catalog')} · 3`);
        const html = renderToStaticMarkup(React.createElement(OfficialCatalogDetails, { locale, connection: bedrock }));
        assert.equal((html.match(/<li>/g) || []).length, 3);
        assert.match(html, /old-cached-model/); assert.match(html, /old-invokable/);
        assert.doesNotMatch(html, /<button|<input|<option|<a |onclick/i);
    }
    assert.equal(JSON.stringify(bedrock), before);
});

test('other providers retain legacy/invokable IDs while excluding catalog-only rows everywhere', () => {
    const direct = { ...connection, providerId: 'openai' };
    assert.deepEqual(invokableOfficialDiscovery(direct).map(model => model.id), ['old-cached-model', 'old-invokable']);
    assert.deepEqual(officialInvokableModelIds(direct), ['my-production-alias', 'old-cached-model', 'old-invokable']);
    assert.deepEqual(officialInvokableModelIds({ ...direct, model: 'old-invokable' }), ['old-invokable', 'old-cached-model']);
});

test('catalog success and typed failures are truthful and localized without marking invocation verified', () => {
    const failures = ['credentials_missing', 'authentication_failed', 'permission_denied', 'endpoint_unsupported', 'rate_limited', 'timeout', 'network_error', 'invalid_response'];
    for (const locale of locales) {
        assert.equal(officialDiscoverySummary(locale, connection), `${officialDiscoveryText(locale, 'catalog')} · 3`);
        for (const failure of failures) {
            const value = officialDiscoverySummary(locale, { ...connection, modelDiscoveryFailure: failure });
            assert.equal(value, officialDiscoveryText(locale, failure)); assert.ok(value); assert.notEqual(value, officialDiscoverySummary(locale, connection));
        }
    }
    assert.equal(connection.status, 'unverified'); assert.equal(connection.toolCapability, 'untested');
});

test('read-only catalog component renders 12 languages, RTL, literal IDs and bounded rows without selection handlers', () => {
    for (const locale of locales) {
        const html = renderToStaticMarkup(React.createElement(OfficialCatalogDetails, { locale, connection }));
        const note = renderToStaticMarkup(React.createElement('span', null, officialDiscoveryText(locale, 'catalogNote'))).slice(6, -7);
        assert.ok(html.includes(note)); assert.match(html, /&lt;catalog model&gt;/);
        assert.doesNotMatch(html, /<button|<input|<option|<a |onclick|<catalog model>/i);
        if (locale === 'ar') assert.match(html, /dir="rtl"/);
    }
    const html = renderToStaticMarkup(React.createElement(OfficialCatalogDetails, { locale: 'en', connection: { ...connection, discoveredModels: Array.from({ length: 220 }, (_, n) => ({ id: `id-${n}`, label: `Label ${n}`, selectionMode: 'catalog_only' })) } }));
    assert.equal((html.match(/<li>/g) || []).length, 200); assert.match(html, /200 \/ 220/);
    assert.equal(renderToStaticMarkup(React.createElement(OfficialCatalogDetails, { locale: 'en', connection: { ...connection, providerId: 'openai', discoveredModels: [{ id: 'actual', label: 'Actual', selectionMode: 'invokable' }] } })), '');
});

test('all route/select/count/reference surfaces share the filtered IDs and manual deployment remains an editable field', () => {
    const widget = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    assert.ok((widget.match(/officialInvokableModelIds\(connection\)/g) || []).length >= 3,
        'all route and display surfaces must continue to use the invokable discovery helper');
    assert.match(widget, /new Map\(officialDiscoveredModelIds\(connection\)/);
    assert.match(widget, /for \(const model of officialDiscoveredModelIds\(connection\)\)/);
    assert.match(widget, /provider.id === 'azure_openai'\) return \[\.\.\.new Set\(this.officialConnectionsFor/);
    assert.match(widget, /<OfficialCatalogDetails locale=\{this.desktopLocale\} connection=\{connection\}/);
    assert.match(widget, /model: connection.model,/);
    assert.match(widget, /const manualModelLabel = provider.id === 'azure_openai' \? officialDiscoveryText\(this.desktopLocale, 'deployment'\)/);
    assert.match(widget, /provider.id === 'bedrock' \? officialDiscoveryText\(this.desktopLocale, 'invocation'\)/);
    assert.match(widget, /isCatalogOnlyOfficialProvider\(provider.id\) && <p className='nmx-connection-note'/);
    const css = readFileSync(new URL('../src/browser/style/nextmux.css', import.meta.url), 'utf8');
    assert.match(css, /\.nmx-official-catalog-only ul \{[^}]*max-height: 192px;[^}]*overflow: auto/);
});


test('native false image and PDF declarations invalidate positive capability inference and stale probes', () => {
    const current = { ...connection, providerId: 'anthropic', model: 'claude-fixture', updatedAt: '2026-09-28T00:00:00Z',
        discoveredModels: [{ id: 'claude-fixture', label: 'Claude', capabilityDeclarations: {
            'input:image': { support: 'unsupported', source: 'provider_metadata', scope: 'route' },
            'input:pdf': { support: 'unsupported', source: 'provider_metadata', scope: 'route' }
        } }] };
    const old = ['input:image', 'input:pdf'].map(capability => ({ capability, support: 'supported', confidence: 'verified', source: 'live_probe', observedAt: '2026-09-01T00:00:00Z' }));
    const next = officialDiscoveryCapabilityEvidence(current, current.model, old);
    for (const capability of ['input:image', 'input:pdf']) assert.deepEqual(next.filter(item => item.capability === capability).map(item => item.support), ['unsupported']);
});
