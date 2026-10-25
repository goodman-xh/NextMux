import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compatibleBaseUrl, maskApiKey, parseProviderImportLink } from '../lib/common/nextmux-provider-import.js';

const require = createRequire(import.meta.url);
const link = params => `nextmux://v1/import?${new URLSearchParams({ resource: 'provider', ...params })}`;

test('a CC Switch style Codex link becomes an OpenAI-compatible own API', () => {
  const request = parseProviderImportLink(link({ app: 'codex', name: 'Relay 中转', endpoint: 'https://relay.example/v1', apiKey: 'sk-abc123456789', model: 'gpt-5.6-terra', homepage: 'https://relay.example', config: 'ZXZpbA==', usageScript: 'fetch(1)' }));
  assert.deepEqual(request, { app: 'codex', name: 'Relay 中转', endpoints: ['https://relay.example/v1'], apiKey: 'sk-abc123456789', models: ['gpt-5.6-terra'], homepage: 'https://relay.example/' });
  const remarked = parseProviderImportLink(link({ app: 'codex', remark: '主力中转', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-v1-123' }));
  assert.equal(remarked.name, '主力中转');
  assert.deepEqual(remarked.endpoints, ['https://openrouter.ai/api/v1']);
});

test('Claude and Gemini links point at the service root, which relays serve under /v1', () => {
  const claude = parseProviderImportLink(link({ app: 'claude', name: 'C', endpoint: 'https://relay.example,https://backup.example/api', apiKey: 'k', sonnetModel: 'claude-sonnet-5', model: 'claude-opus-5-5', opusModel: 'claude-opus-5-5' }));
  assert.deepEqual(claude.endpoints, ['https://relay.example/v1', 'https://backup.example/api/v1']);
  assert.deepEqual(claude.models, ['claude-opus-5-5', 'claude-sonnet-5'], 'default first, duplicates removed');
  assert.equal(compatibleBaseUrl('https://relay.example/v1/chat/completions', 'codex'), 'https://relay.example/v1');
  assert.equal(compatibleBaseUrl('https://relay.example/v1', 'claude'), 'https://relay.example/v1', 'already versioned');
  assert.equal(compatibleBaseUrl('https://relay.example/v1beta', 'gemini'), 'https://relay.example/v1beta');
  assert.equal(compatibleBaseUrl('https://relay.example/api/v3/', 'claude'), 'https://relay.example/api/v3');
});

test('unsafe or foreign links are refused; bad endpoints are dropped', () => {
  assert.equal(parseProviderImportLink(link({}).replace('resource=provider', 'resource=mcp')), undefined);
  assert.equal(parseProviderImportLink('ccswitch://v1/import?resource=provider&name=x'), undefined, 'only our scheme');
  assert.equal(parseProviderImportLink('nextmux://device-link/complete?nonce=x'), undefined);
  const request = parseProviderImportLink(link({ name: 'X', endpoint: 'http://relay.example/v1,https://user:pw@relay.example/v1,javascript:alert(1)', homepage: 'http://relay.example' }));
  assert.deepEqual(request.endpoints, [], 'HTTPS only, no credentials in the address');
  assert.equal(request.homepage, undefined);
  assert.equal(maskApiKey('sk-abcdefghijklmnop'), 'sk-••••••mnop');
  assert.equal(maskApiKey('short'), '•••••');
});

test('the main process forwards only the recognised parameters, in a canonical link', () => {
  const { parseNextMuxDeepLink } = require('../../../apps/desktop/deep-link.cjs');
  const parsed = parseNextMuxDeepLink(link({ app: 'codex', name: 'Demo', endpoint: 'https://relay.example/v1', apiKey: 'sk-1', config: 'eyJ4IjoxfQ==', usageScript: 'alert(1)' }));
  assert.equal(parsed.kind, 'provider-import');
  assert.equal(parsed.url, 'nextmux://v1/import?resource=provider&app=codex&name=Demo&endpoint=https%3A%2F%2Frelay.example%2Fv1&apiKey=sk-1');
  assert.equal(parseNextMuxDeepLink(`${link({ name: 'x' })}&name=y`), undefined, 'duplicated parameters are ambiguous');
  assert.equal(parseNextMuxDeepLink(link({ name: 'a\u0007b' })), undefined, 'control characters');
  assert.equal(parseNextMuxDeepLink('nextmux://v1/import?resource=skill&name=x'), undefined);
});

test('an Apply to NextMux link opens ＋ Compatible API with the relay values filled in', () => {
  const widget = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
  assert.match(widget, /this\.accountLinkCoordinator\.attach\(this\.routeProviderImportLinks\(desktopBridge\)\)/);
  assert.match(widget, /protected openProviderImport\(request: ProviderImportRequest\)[\s\S]*?this\.officialProviderPresets\(\)\.find\(item => item\.id === 'custom_openai'\)[\s\S]*?this\.selectModelCenterView\('official'\);\s*this\.openOfficialProvider\(provider, undefined, true\);[\s\S]{0,200}?this\.officialImportSource = request;\s*this\.officialDraft = \{ label: request\.name, model: request\.models\[0\] \|\| '', baseUrl: request\.endpoints\[0\] \|\| '', apiKey: request\.apiKey \};/);
  // One back step returns to where the link was opened; switching the recognised format keeps the import banner.
  assert.match(widget, /const backDepth = this\.navigationBackStack\.length;[\s\S]{0,200}this\.navigationBackStack = this\.navigationBackStack\.slice\(0, backDepth \+ 1\)/);
  assert.match(widget, /const importSource = this\.officialImportSource, myApisReturn = this\.myApisReturn;\s*if \(target\.id !== provider\.id\) this\.openOfficialProvider\(target\);\s*this\.officialImportSource = importSource;/);
  assert.match(widget, /if \(desktopBridge && !this\.detachedConversationId\) \{[\s\S]{0,600}accountLinkCoordinator\.attach/, 'a detached conversation window never takes the link queue');
  assert.match(widget, /if \(this\.pendingProviderImport\) this\.openProviderImport\(this\.pendingProviderImport\);/, 'a link that launches the app waits for the own-API list');
  assert.match(widget, /\{importSource && <ProviderImportBanner locale=\{this\.desktopLocale\} request=\{importSource\} \/>\}/);
  assert.doesNotMatch(widget, /saveProviderImport|ProviderImportDialog/, 'no separate confirmation dialog: the normal save buttons decide');
  const banner = readFileSync(new URL('../src/browser/nextmux-provider-import.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(banner, /apiKey/, 'the banner never shows the key');
});
