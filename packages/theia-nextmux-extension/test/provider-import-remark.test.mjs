import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseProviderImportLink } from '../lib/common/nextmux-provider-import.js';
import { providerImportSource } from '../lib/browser/nextmux-provider-import.js';

// A relay website's "Import to NextMux" button: nextmux://v1/import?resource=provider&…
const link = params => `nextmux://v1/import?${new URLSearchParams({ resource: 'provider', app: 'codex', endpoint: 'https://relay.example.com/v1', apiKey: 'sk-test', ...params })}`;

test('the remark / API name parameter fills the display name, in a fixed precedence', () => {
    assert.equal(parseProviderImportLink(link({ remark: '我的中转', name: 'N', label: 'L', provider: 'P' })).name, '我的中转');
    assert.equal(parseProviderImportLink(link({ name: 'Relay Pro', label: 'L', provider: 'P' })).name, 'Relay Pro');
    assert.equal(parseProviderImportLink(link({ label: 'Label', provider: 'P' })).name, 'Label');
    assert.equal(parseProviderImportLink(link({ provider: 'SuperRelay' })).name, 'SuperRelay');
});

test('without a name the banner shows the real host of the imported address, never a fixed one', () => {
    const request = parseProviderImportLink(link({}));
    assert.equal(providerImportSource(request), 'relay.example.com');
    assert.equal(providerImportSource(parseProviderImportLink(link({ provider: 'SuperRelay' }))), 'SuperRelay');
    for (const file of ['../src/browser/nextmux-provider-import.tsx', '../src/common/nextmux-provider-import.ts', '../src/browser/nextmux-desktop-widget.tsx']) {
        assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), 'utf8'), /supergpt/i, `${file} has no hardcoded source host`);
    }
});

test('the Add / Edit API drawer has a remark (display) name field', () => {
    const widget = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    assert.match(widget, /data-api-remark-field='true'/);
    const myApis = readFileSync(new URL('../src/browser/nextmux-my-apis.tsx', import.meta.url), 'utf8');
    assert.match(myApis, /remarkLabel: '备注名称 \/ API 名称'/);
});

test('the banner shows the host the key goes to beside the name a link gives itself', async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const React = createRequire(require.resolve('@theia/core/package.json'))('react');
    const { renderToStaticMarkup } = createRequire(require.resolve('@theia/core/package.json'))('react-dom/server');
    const { ProviderImportBanner } = await import('../lib/browser/nextmux-provider-import.js');
    const banner = request => renderToStaticMarkup(React.createElement(ProviderImportBanner, { locale: 'en', request }));
    const claimed = banner(parseProviderImportLink(link({ name: 'OpenAI Official', endpoint: 'https://evil.example.net/v1' })));
    assert.match(claimed, /Imported from OpenAI Official/);
    assert.match(claimed, /class="nmx-import-host"[^>]*><bdi dir="ltr">evil\.example\.net<\/bdi>/);
    // A nameless link already shows its host; it is not repeated.
    assert.doesNotMatch(banner(parseProviderImportLink(link({}))), /nmx-import-host/);
});
