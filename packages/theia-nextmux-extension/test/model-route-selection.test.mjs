import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { inferModelCapabilityEvidence, OFFICIAL_PROVIDER_PRESETS } from '@nextmux/model-runtime';
import {
  isVerifiedModelRoute,
  managedRelayKey,
  migrateManagedRelayKey,
  modelRouteCapabilityGate,
  migrateOfficialRelayKey,
  officialConnectionRelayKey,
  partitionModelPickerCandidates,
  reasoningEffortLevelsForModel,
  resolveModelRelay,
  resolveModelRouteId,
} from '../lib/browser/nextmux-model-route-selection.js';

const desktopStyle = readFileSync(fileURLToPath(new URL('../src/browser/style/nextmux.css', import.meta.url)), 'utf8');
const desktopSource = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');

const duplicateCompatibleRoutes = [
  {
    id: 'official:official-connection-a',
    providerId: 'custom_openai',
    connectionId: 'official-connection-a',
    modelId: 'custom_openai/shared-model',
  },
  {
    id: 'official:official-connection-b',
    providerId: 'custom_openai',
    connectionId: 'official-connection-b',
    modelId: 'custom_openai/shared-model',
  },
];

const distinctCompatibleRoutes = [
  {
    id: 'official:official-connection-a',
    providerId: 'custom_openai',
    connectionId: 'official-connection-a',
    modelId: 'custom_openai/model-a',
    modelIds: ['custom_openai/model-a'],
  },
  {
    id: 'official:official-connection-b',
    providerId: 'custom_openai',
    connectionId: 'official-connection-b',
    modelId: 'custom_openai/model-b',
    modelIds: ['custom_openai/model-b'],
  },
];

const duplicateNamedManagedRoutes = [
  { merchantId: 'merchant-a', providerName: 'Same relay', routeId: 'managed:fixed:offering-a' },
  { merchantId: 'merchant-b', providerName: 'Same relay', routeId: 'managed:fixed:offering-b' },
];

const routes = [
  { id: 'route-session', modelId: 'provider/session-model' },
  { id: 'route-global', modelId: 'provider/global-model' },
  { id: 'route-fallback', modelId: 'provider/fallback-model' },
];

test('the active conversation route wins over an app-global model preference', () => {
  assert.equal(resolveModelRouteId({
    routes,
    sessionRouteId: 'route-session',
    selectedModelId: 'provider/global-model',
    preferredRouteId: 'route-global',
    activeRouteId: 'route-global',
    fallbackRouteId: 'route-fallback',
  }), 'route-session');
});

test('a stale global model cannot erase an available conversation route', () => {
  assert.equal(resolveModelRouteId({
    routes,
    sessionRouteId: 'route-session',
    selectedModelId: 'provider/no-longer-available',
    preferredRouteId: 'route-global',
  }), 'route-session');
});

test('a conversation model repairs a stale route id before consulting the app-global model', () => {
  assert.equal(resolveModelRouteId({
    routes,
    sessionRouteId: 'route-from-replaced-connection',
    sessionModelId: 'provider/session-model',
    selectedModelId: 'provider/global-model',
    preferredRouteId: 'route-global',
  }), 'route-session');
});

test('a temporarily unavailable conversation model does not silently switch to a global model', () => {
  assert.equal(resolveModelRouteId({
    routes: [],
    sessionRouteId: 'route-from-refreshing-catalog',
    sessionModelId: 'provider/session-model',
    selectedModelId: 'provider/global-model',
    catalogLoading: true,
  }), 'route-from-refreshing-catalog');
});

test('a settled missing conversation route remains unavailable instead of adopting a global model', () => {
  assert.equal(resolveModelRouteId({
    routes,
    sessionRouteId: 'official:removed-connection',
    sessionModelId: 'provider/removed-model',
    selectedModelId: 'provider/global-model',
    preferredRouteId: 'route-global',
    activeRouteId: 'route-global',
    fallbackRouteId: 'route-fallback',
    catalogLoading: false,
  }), 'official:removed-connection');
});

test('a draft without a conversation uses the selected model then the persisted route', () => {
  assert.equal(resolveModelRouteId({ routes, selectedModelId: 'provider/global-model' }), 'route-global');
  assert.equal(resolveModelRouteId({ routes, selectedModelId: 'missing', preferredRouteId: 'route-session' }), 'route-session');
});

test('fallback selection remains optional', () => {
  assert.equal(resolveModelRouteId({ routes, selectedModelId: 'missing', selectFallback: false }), '');
  assert.equal(resolveModelRouteId({ routes, fallbackRouteId: 'route-fallback' }), 'route-fallback');
});

test('a catalog-visible conversation route remains selected but unavailable when its capability is unverified', () => {
  assert.equal(resolveModelRouteId({
    routes: [
      { id: 'route-listed-only', modelId: 'provider/listed-only', selectable: false },
      { id: 'route-verified', modelId: 'provider/verified', selectable: true },
    ],
    sessionRouteId: 'route-listed-only',
    sessionModelId: 'provider/listed-only',
    selectedModelId: 'provider/listed-only',
    catalogLoading: true,
  }), 'route-listed-only');
});

test('conversation relay and route are restored as one selection', () => {
  assert.deepEqual(resolveModelRelay({
    availableRelayKeys: ['auto', 'official:custom_openai'],
    sessionRelayKey: 'official:custom_openai',
    activeRelayKey: 'auto',
    fallbackRelayKey: 'auto',
  }), { relayKey: 'official:custom_openai', status: 'ready' });
});

test('legacy provider relay migrates to the exact connection owned by the persisted route', () => {
  assert.equal(migrateOfficialRelayKey({
    relayKey: 'official:custom_openai',
    connections: duplicateCompatibleRoutes,
    preferredRouteId: 'official:official-connection-b',
  }), 'official:official-connection-b');
});

test('legacy provider relay uses the stable session model when its old route id is stale', () => {
  assert.equal(migrateOfficialRelayKey({
    relayKey: 'official:custom_openai',
    connections: distinctCompatibleRoutes,
    preferredRouteId: 'official:removed-connection',
    preferredModelId: 'custom_openai/model-b',
  }), 'official:official-connection-b');
});

test('duplicate compatible model ids retain the second exact connection through selection and submission', () => {
  const relayKey = migrateOfficialRelayKey({
    relayKey: 'official:custom_openai',
    connections: duplicateCompatibleRoutes,
    preferredRouteId: 'official:official-connection-b',
  });
  const scopedRoutes = duplicateCompatibleRoutes.filter(route =>
    officialConnectionRelayKey(route.connectionId) === relayKey);
  const routeId = resolveModelRouteId({
    routes: scopedRoutes,
    sessionRouteId: 'official:official-connection-b',
    selectedModelId: 'custom_openai/shared-model',
  });
  const submittedRoute = scopedRoutes.find(route => route.id === routeId);

  assert.equal(routeId, 'official:official-connection-b');
  assert.equal(submittedRoute?.connectionId, 'official-connection-b');
});

test('exact official connection relay values remain stable and legacy values without a route migrate deterministically', () => {
  assert.equal(migrateOfficialRelayKey({
    relayKey: 'official:official-connection-b',
    connections: duplicateCompatibleRoutes,
  }), 'official:official-connection-b');
  assert.equal(migrateOfficialRelayKey({
    relayKey: 'official:custom_openai',
    connections: duplicateCompatibleRoutes,
  }), 'official:official-connection-a');
});

test('managed relay keys use merchant identity and migrate legacy provider names without collisions', () => {
  assert.equal(managedRelayKey(' merchant-b '), 'managed:merchant-b');
  assert.equal(migrateManagedRelayKey({
    relayKey: 'managed:merchant-b',
    routes: duplicateNamedManagedRoutes,
  }), 'managed:merchant-b');
  assert.equal(migrateManagedRelayKey({
    relayKey: 'managed:Same relay',
    routes: duplicateNamedManagedRoutes,
    preferredRouteId: 'managed:fixed:offering-b',
  }), 'managed:merchant-b');
  assert.equal(migrateManagedRelayKey({
    relayKey: 'managed:Same relay',
    routes: duplicateNamedManagedRoutes,
  }), 'managed:Same relay', 'an ambiguous legacy name must fail closed');
  assert.equal(migrateManagedRelayKey({
    relayKey: 'managed:Unique relay',
    routes: [{ merchantId: 'merchant-only', providerName: 'Unique relay', routeId: 'managed:fixed:only' }],
  }), 'managed:merchant-only');
});

test('automatic routing is derived from explicit conversation intent and its legacy flag is read once', () => {
  assert.match(desktopSource, /protected get automaticRouting\(\): boolean \{ return this\.automaticRelaySource !== 'off'; \}/);
  assert.doesNotMatch(desktopSource, /(?:protected\s+automaticRouting\s*=|this\.automaticRouting\s*=)/);
  assert.equal((desktopSource.match(/getItem\('nextmux\.desktop\.automaticRouting'\)/g) || []).length, 1);
  assert.equal((desktopSource.match(/removeItem\('nextmux\.desktop\.automaticRouting'\)/g) || []).length, 1);
  assert.doesNotMatch(desktopSource, /setItem\('nextmux\.desktop\.automaticRouting'/);
});

test('managed relay options and routes stay scoped to merchantId instead of display name', () => {
  assert.match(desktopSource, /readonly merchantId\?: string/);
  assert.match(desktopSource, /managedRelayKey\(merchantId\)[\s\S]*?'managed'[\s\S]*?merchantId/);
  assert.match(desktopSource, /this\.offeringMerchantId\(route\.offering\) === merchantId/);
  assert.match(desktopSource, /directoryMerchants\?\.find\(merchant => merchant\.id === merchantId\)/);
  assert.match(desktopSource, /this\.relaySourceTab === \'favorite\' \? this\.favoriteMerchantPage : this\.publicMerchantPage\)\?\.merchants\.find\(merchant => merchant\.id === option\.merchantId\)/);
  assert.doesNotMatch(desktopSource, /route\.offering\.providerName === providerName/);
  assert.doesNotMatch(desktopSource, /candidate\.label === offering\.providerName/);
});

test('desktop compatible routes are connection scoped and expose the line name without changing the model name', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url)), 'utf8');

  assert.match(source, /key:\s*officialConnectionRelayKey\(connection\.id\)/);
  assert.match(source, /route\.connection\.id === connectionId/);
  assert.match(source, /migrateOfficialRelayKey\(\{/);
  assert.match(source, /const optionRouteLabel = optionRoute\?\.kind === 'official_connection' \? optionRoute\.connection\.label : ''/);
  assert.match(source, /const optionTitle = \[model\.label, optionRouteLabel, \.\.\.\[\.\.\.metrics, \.\.\.contextRow\]\.map/,
    'route metadata must stay in the accessible title rather than the visible row');
  assert.match(source, /aria-label=\{optionTitle\}><span><strong>\{model\.label\}<\/strong>/);
  assert.doesNotMatch(source, /className='nmx-model-option-route'/,
    'the visible model row should show the model name only; route metadata belongs in the accessible title');
  assert.match(source, /data-relay-key=\{option\.key\}/);
  assert.match(source, /connectionId:\s*route\.connection\.id/);
  assert.match(source, /if \(relay\.status !== 'ready'\)/);
  assert.match(source, /savedOfficialRelayUnavailable/);
  assert.match(desktopStyle, /\.nmx-relay-options strong \{[\s\S]*?white-space:\s*nowrap;/);
  assert.doesNotMatch(source, /const officialProviders = new Map<string, OfficialModelConnection\[\]>/);
});

test('a catalog refresh cannot replace a conversation relay while it is temporarily absent', () => {
  assert.deepEqual(resolveModelRelay({
    availableRelayKeys: ['auto'],
    sessionRelayKey: 'official:custom_openai',
    activeRelayKey: 'auto',
    fallbackRelayKey: 'auto',
    sessionRelayLoading: true,
  }), { relayKey: 'official:custom_openai', status: 'pending' });
});

test('a failed official catalog read preserves the exact conversation relay', () => {
  assert.deepEqual(resolveModelRelay({
    availableRelayKeys: ['auto'],
    sessionRelayKey: 'official:connection-b',
    activeRelayKey: 'auto',
    fallbackRelayKey: 'auto',
    sessionRelayLoading: true,
  }), { relayKey: 'official:connection-b', status: 'pending' });
});

test('a removed direct connection never silently crosses into a marketplace relay', () => {
  assert.deepEqual(resolveModelRelay({
    availableRelayKeys: ['auto'],
    sessionRelayKey: 'official:removed',
    activeRelayKey: 'official:removed',
    fallbackRelayKey: 'auto',
    sessionRelayLoading: false,
  }), { relayKey: 'official:removed', status: 'unavailable' });
});

test('a removed managed conversation relay also waits for an explicit replacement', () => {
  assert.deepEqual(resolveModelRelay({
    availableRelayKeys: ['auto'],
    sessionRelayKey: 'managed:removed-offering',
    activeRelayKey: 'auto',
    fallbackRelayKey: 'auto',
    sessionRelayLoading: false,
  }), { relayKey: 'managed:removed-offering', status: 'unavailable' });
});

test('scheduled tasks and unavailable sessions never silently rewrite their saved route', () => {
  assert.match(desktopSource, /const route = bindPriceQuote\(this\.allModelRoutes\('coding'\)\.find\(candidate => candidate\.id === task\.routeId\), task\.keyPriceQuoteId\);/);
  assert.doesNotMatch(desktopSource, /availableRoutes\.find\(candidate => candidate\.id === task\.routeId\)\s*\|\|\s*availableRoutes\.find/);
  assert.match(desktopSource, /if \(session\?\.routeId\) \{[\s\S]*?activeModelRouteId = session\.routeId;[\s\S]*?localStorage\.setItem\(`nextmux\.desktop\.route\.\$\{workbench\}`, session\.routeId\);/);
});

test('a missing app-level direct connection also waits for an explicit replacement', () => {
  assert.deepEqual(resolveModelRelay({
    availableRelayKeys: ['auto'],
    activeRelayKey: 'official:removed',
    fallbackRelayKey: 'auto',
  }), { relayKey: 'official:removed', status: 'unavailable' });
});

test('a directory listing never makes a model route selectable without a verified capability probe', () => {
  assert.equal(isVerifiedModelRoute([]), false);
  assert.equal(isVerifiedModelRoute([{
    capability: 'model:listed',
    support: 'supported',
    confidence: 'verified',
    source: 'models_endpoint',
    observedAt: '2026-08-31T08:00:00.000Z',
  }]), false);
  assert.equal(isVerifiedModelRoute([{
    capability: 'model:generatable',
    support: 'unsupported',
    confidence: 'declared',
    source: 'provider_metadata',
    observedAt: '2026-08-31T08:00:00.500Z',
  }]), false);
  assert.equal(isVerifiedModelRoute([{
    capability: 'model:generatable',
    support: 'supported',
    confidence: 'verified',
    source: 'live_probe',
    observedAt: '2026-08-31T08:00:01.000Z',
  }]), true);
});

test('generation and tool capability evidence stay separate in the coding-route gate', () => {
  const generation = {
    capability: 'model:generatable',
    support: 'supported',
    confidence: 'verified',
    source: 'live_probe',
    observedAt: '2026-08-31T08:00:00.000Z',
  };
  const toolsUnknown = {
    capability: 'tools',
    support: 'unknown',
    confidence: 'unknown',
    source: 'model_heuristic',
    observedAt: '2026-08-31T08:00:00.000Z',
  };
  const toolsVerified = {
    ...toolsUnknown,
    support: 'supported',
    confidence: 'verified',
    source: 'live_probe',
  };

  assert.deepEqual(modelRouteCapabilityGate([generation, toolsUnknown], true), {
    generation: 'verified', tools: 'unknown', selectable: false, reason: 'tools_unverified',
  });
  assert.deepEqual(modelRouteCapabilityGate([generation, toolsVerified], true), {
    generation: 'verified', tools: 'verified', selectable: true,
  });
  assert.equal(isVerifiedModelRoute([generation, toolsUnknown], true), false);
  assert.equal(isVerifiedModelRoute([generation, toolsVerified], true), true);

  assert.deepEqual(modelRouteCapabilityGate([{
    capability: 'model:listed',
    support: 'supported',
    confidence: 'declared',
    source: 'models_endpoint',
    observedAt: '2026-08-31T08:00:00.000Z',
  }], true), {
    generation: 'unknown', tools: 'unknown', selectable: false, reason: 'generation_unverified',
  });
  const generationUnsupported = inferModelCapabilityEvidence({
    providerId: 'gemini',
    protocol: 'gemini_generate_content',
    model: 'embedding-only',
    observedAt: '2026-08-31T08:00:00.000Z',
    discoveredByModelsEndpoint: true,
    interfaceSupport: 'unsupported',
  });
  assert.deepEqual(modelRouteCapabilityGate(generationUnsupported, true), {
    generation: 'unsupported', tools: 'unknown', selectable: false, reason: 'generation_unsupported',
  });
  assert.deepEqual(modelRouteCapabilityGate([generation, {
    ...toolsUnknown,
    support: 'unsupported',
    confidence: 'verified',
    source: 'live_probe',
  }], true), {
    generation: 'verified', tools: 'unsupported', selectable: false, reason: 'tools_unsupported',
  });
});

test('the capability gate is protocol and provider independent across every shipped preset', () => {
  for (const provider of OFFICIAL_PROVIDER_PRESETS) {
    const evidence = inferModelCapabilityEvidence({
      providerId: provider.id,
      protocol: provider.protocol,
      model: provider.defaultModel,
      observedAt: '2026-08-31T08:00:00.000Z',
      connectionVerified: true,
      toolCalling: 'verified',
    });
    assert.equal(modelRouteCapabilityGate(evidence, true).selectable, true,
      `${provider.id}/${provider.protocol} should use the same evidence gate`);
  }
});

test('reasoning effort controls require a reasoning capability, not a recognizable model name', () => {
  assert.deepEqual(reasoningEffortLevelsForModel({
    reasoningSupported: false,
    providerId: 'openai',
    model: 'gpt-5.6-sol',
  }), []);
  assert.deepEqual(reasoningEffortLevelsForModel({
    reasoningSupported: true,
    providerId: 'custom_openai',
    model: 'opaque-reasoner',
    reasoningEfforts: ['minimal', 'high'],
  }), ['minimal', 'high']);
});

test('the picker keeps verified models enabled and directory-only models in the unavailable section', () => {
  const partition = partitionModelPickerCandidates([
    { id: 'custom_openai/gpt-5.6-sol', identity: 'gpt-5.6-sol' },
    { id: 'registry/gpt-5.6-sol', identity: 'gpt-5.6-sol' },
    { id: 'custom_openai/gpt-nextmux-qa-secondary', identity: 'gpt-nextmux-qa-secondary' },
  ], new Set(['custom_openai/gpt-5.6-sol']));

  assert.deepEqual(partition.selectable.map(model => model.id), ['custom_openai/gpt-5.6-sol']);
  assert.deepEqual(partition.unavailable.map(model => model.id), ['custom_openai/gpt-nextmux-qa-secondary']);
});

test('a withdrawn saved managed API never silently adopts a same-model API during directory refresh', () => {
  const routeId='managed:fixed:original-api';
  for (const selectFallback of [false,true]) assert.equal(resolveModelRouteId({ routes:[{id:'managed:fixed:another-api',modelId:'same-model'}],
    sessionRouteId:routeId,sessionModelId:'same-model',selectedModelId:'same-model',activeRouteId:routeId,selectFallback }),routeId);
});

test('a selected fixed API in a new draft is exact, even before a conversation is saved', () => {
  for (const available of [false, true]) for (const field of ['preferredRouteId', 'activeRouteId']) {
    const routeId = 'managed:fixed:original-api';
    const routes = [{id:'managed:fixed:another-api',modelId:'same-model'}, ...(available ? [{id:routeId,modelId:'same-model'}] : [])];
    assert.equal(resolveModelRouteId({routes, [field]: routeId, selectedModelId:'same-model',selectFallback:false}), routeId);
  }
});
