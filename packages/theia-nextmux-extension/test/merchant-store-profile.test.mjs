import { modelCenterText } from '../lib/browser/nextmux-model-center-locale.js';
import { averageMultiplierBps, offeringMultiplierBps } from '../lib/browser/nextmux-offering-price.js';
import { CatalogSnapshotRefresh } from '../lib/browser/nextmux-catalog-refresh.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { normalizePublicMerchantDirectory, normalizePublicMerchantStoreProfile } from '../lib/common/nextmux-public-merchants.js';
import { normalizeMerchantDiscoveredModels } from '../lib/common/nextmux-merchant-discovered-models.js';
import { NextMuxPlatformServiceImpl } from '../lib/node/nextmux-platform-service.js';
import { measuredRelayQuality, measuredRelayAuthenticity, averageRelayAvailability, averageRelayLatency, latestRelayLatency, measuredRelayLatency } from '../lib/common/nextmux-relay-evidence.js';
import { relaySourceSelected } from '../lib/common/nextmux-relay-switch.js';

const measuredAt = '2026-09-28T00:00:00.000Z';
const profile = { storeTagline: '稳健的模型服务', storeDescription: '稳定服务\n\n覆盖多种模型' };
class Fixture extends NextMuxPlatformServiceImpl {
    response;
    async request() { return this.response; }
}

test('store copy is bounded by Unicode characters, whitespace-normalized and always literal text', () => {
    const result = normalizePublicMerchantStoreProfile({ storeTagline: ' \t你好\r\n\u0000 世界 ', storeDescription: ' 首行\t文字 \r\n \r\n\r\n第二行\u0007 ' });
    assert.deepEqual(result, { storeTagline: '你好 世界', storeDescription: '首行 文字\n\n第二行' });
    const bounded = normalizePublicMerchantStoreProfile({ storeTagline: '😀'.repeat(61), storeDescription: '𠮷'.repeat(601) });
    assert.equal(bounded.storeTagline, '😀'.repeat(60));
    assert.equal(bounded.storeDescription, '𠮷'.repeat(600));
    assert.deepEqual(normalizePublicMerchantStoreProfile({ storeTagline: ' \n ', storeDescription: { html: '<b>unsafe</b>' } }), {});
    assert.deepEqual(normalizePublicMerchantStoreProfile({ storeDescription: '**literal** <b>text</b>' }), { storeDescription: '**literal** <b>text</b>' });
});

test('directory RPC keeps only public store fields and respects omitted hidden or legacy copy', async () => {
    const service = new Fixture();
    service.response = { measuredAt, merchants: [{ id: 'merchant', name: 'Merchant', ...profile, storeProfileStatus: 'visible', private: 'PRIVATE' }] };
    const first = await service.getPublicMerchantDirectory();
    assert.deepEqual(first.merchants[0], { id: 'merchant', name: 'Merchant', ...profile });
    service.publicMerchantPages.get('limit=100').expiresAt = 0;
    service.response = { measuredAt, merchants: [{ id: 'merchant', name: 'Merchant' }] };
    assert.deepEqual((await service.getPublicMerchantDirectory()).merchants[0], { id: 'merchant', name: 'Merchant' });
    assert.equal(normalizePublicMerchantDirectory({ measuredAt, merchants: [{ id: 'merchant', name: 'Merchant', storeTagline: '😀'.repeat(61) }] }).merchants[0].storeTagline, '😀'.repeat(60));
});

test('catalog and scoped model catalog keep bounded merchant copy, including directory fallback', async () => {
    const service = new Fixture();
    service.response = { measuredAt, offerings: [{ id: 'offering', merchantId: 'merchant', providerName: 'Merchant', storeTagline: '😀'.repeat(61), storeDescription: profile.storeDescription }] };
    assert.equal((await service.getCatalog()).offerings[0].storeTagline, '😀'.repeat(60));
    assert.equal((await service.getMerchantCatalog('merchant')).offerings[0].storeDescription, profile.storeDescription);
    service.request = async path => {
        if (path.startsWith('/api/merchants/public?')) throw Error('temporary failure');
        return service.response;
    };
    const merchant = (await service.getPublicMerchantDirectory()).merchants[0];
    assert.equal(merchant.storeTagline, '😀'.repeat(60));
    assert.equal(merchant.storeDescription, profile.storeDescription);
    service.response.offerings[0].storeTagline = { html: 'invalid' };
    service.response.offerings[0].storeDescription = '';
    const fresh = await service.getMerchantCatalog('merchant', undefined, true);
    assert.equal(Object.hasOwn(fresh.offerings[0], 'storeTagline'), false);
    assert.equal(Object.hasOwn(fresh.offerings[0], 'storeDescription'), false);
});

test('merchant model detail metadata keeps bounded profile fields and rejects mismatched identities', () => {
    const page = { merchantId: 'merchant', state: 'ready', models: [], measuredAt, ...profile,
        merchant: { id: 'merchant', name: 'Merchant', ...profile, email: 'PRIVATE' } };
    const result = normalizeMerchantDiscoveredModels(page, 'merchant');
    assert.equal(result.storeDescription, profile.storeDescription);
    assert.deepEqual(result.merchant, { id: 'merchant', name: 'Merchant', ...profile });
    assert.throws(() => normalizeMerchantDiscoveredModels({ ...page, merchant: { ...page.merchant, id: 'other' } }, 'merchant'));
});

test('catalog version changes invalidate every merchant metadata cache and obsolete requests cannot restore hidden copy', async () => {
    for (const [load, requests, pages, payload] of [
        [service => service.getPublicMerchantDirectory(), 'publicMerchantRequests', 'publicMerchantPages', hidden => ({ measuredAt, merchants: [{ id: 'merchant', name: 'Merchant', ...(hidden ? {} : profile) }] })],
        [service => service.getMerchantCatalog('merchant'), 'merchantCatalogRequests', 'merchantCatalogPages', hidden => ({ measuredAt, offerings: [{ id: 'offering', merchantId: 'merchant', ...(hidden ? {} : profile) }] })],
        [service => service.getMerchantDiscoveredModels('merchant'), 'merchantDiscoveredRequests', 'merchantDiscoveredPages', hidden => ({ merchantId: 'merchant', measuredAt, state: 'ready', models: [], ...(hidden ? {} : profile) })]
    ]) {
        const service = new Fixture();
        const waiting = [];
        const paths = [];
        let version = '11111111';
        service.request = async path => {
            if (path === '/api/models/version') return { version };
            paths.push(path);
            return new Promise(resolve => waiting.push(resolve));
        };
        await service.getModelCatalogVersion();
        const obsolete = load(service);
        version = '22222222';
        await service.getModelCatalogVersion();
        const fresh = load(service);
        assert.equal(waiting.length, 2, 'version change does not reuse an obsolete in-flight request');
        if (requests === 'publicMerchantRequests') {
            assert.equal(new URL(paths[0], 'https://fixture.invalid').searchParams.get('catalogVersion'), '11111111');
            assert.equal(new URL(paths[1], 'https://fixture.invalid').searchParams.get('catalogVersion'), '22222222');
        }
        waiting[0](payload(false)); await obsolete;
        assert.equal(service[pages].size, 0, 'old profile cannot return to a fresh cache');
        assert.equal(service[requests].size, 1, 'old request cleanup cannot delete the new request');
        waiting[1](payload(true)); await fresh;
        assert.equal(service[pages].size, 1);
        assert.doesNotMatch(JSON.stringify([...service[pages].values()]), /storeTagline|storeDescription/);
        version = '33333333'; await service.getModelCatalogVersion();
        assert.equal(service[pages].size, 0);
    }
});

const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const methods = ['relayOptions', 'applyRelaySelection', 'checkModelCatalogVersion'].map(name => widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name).getText(file));
const values = { measuredRelayQuality, measuredRelayAuthenticity, averageRelayAvailability, averageRelayLatency, latestRelayLatency, measuredRelayLatency,
    relaySourceSelected, managedRelayKey: id => `managed:${id}`, averageMultiplierBps, offeringMultiplierBps,
    relayText: (_locale, key) => key, window: { clearTimeout() {}, localStorage: { setItem() {}, removeItem() {} } } };
const Widget = new Function(...Object.keys(values), ts.transpile(`class Harness { ${methods.join('\n')} }; return Harness;`, {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
}))(...Object.values(values));
const fixture = () => Object.assign(new Widget(), {
    activeSection: 'coding', activeRelayKey: 'managed:merchant', relaySourceTab: 'merchant', relaySortMode: 'quality', desktopLocale: 'en',
    favoriteMerchantLabels: new Map(), officialModels: { connections: [] },
    managedOfferings: () => [{ id: 'offering', merchantId: 'merchant', providerName: 'Merchant', registryModelId: 'model', multiplierBps: 10000,
        network: { availability: 1, sampleCount: 0, state: 'unknown', p95LatencyMs: null }, fidelity: { index: 0, sampleCount: 0 }, ...profile }],
    offeringMerchantId: row => row.merchantId,
    publicMerchantPage: { merchants: [{ id: 'merchant', name: 'Merchant', ...profile }] },
    selectedModelIds: {}, persistActiveRouteSelection() {}, loadSelectedMerchantCatalog() {}, update() {}
});

test('relay options expose directory copy, while refreshed hidden copy never falls back to a stale selection or catalog', () => {
    const instance = fixture();
    const merchant = () => instance.relayOptions().find(option => option.merchantId === 'merchant');
    assert.equal(merchant().storeTagline, profile.storeTagline);
    assert.equal(merchant().storeDescription, profile.storeDescription);
    instance.selectedPublicMerchant = instance.publicMerchantPage.merchants[0];
    instance.publicMerchantPage = { merchants: [{ id: 'merchant', name: 'Merchant' }] };
    assert.equal(merchant().storeDescription, undefined);
    instance.publicMerchantPage = undefined; instance.selectedPublicMerchant = undefined;
    assert.equal(merchant().storeDescription, undefined);
});

test('selected relay retains profile from favorites or catalog without falling back to a stale directory row', () => {
    const instance = fixture();
    instance.relaySourceTab = 'favorite';
    instance.favoriteMerchantPage = { merchants: [{ id: 'merchant', name: 'Merchant', storeTagline: 'Fresh favorite' }] };
    instance.applyRelaySelection({ key: 'managed:merchant', kind: 'managed', merchantId: 'merchant', label: 'Merchant', ...profile });
    assert.equal(instance.selectedPublicMerchant.storeTagline, 'Fresh favorite');
    assert.equal(instance.selectedPublicMerchant.storeDescription, undefined);
    instance.favoriteMerchantPage = undefined;
    instance.applyRelaySelection({ key: 'managed:merchant', kind: 'managed', merchantId: 'merchant', label: 'Merchant', ...profile });
    assert.equal(instance.selectedPublicMerchant.storeDescription, profile.storeDescription);
});

test('each window refreshes directory data and selected identity when the catalog profile revision changes', async () => {
    const instance = fixture();
    let version = '11111111', catalogLoads = 0, directoryLoads = 0;
    Object.assign(instance, { publicMerchantPageRequest: 4, publicMerchantDirectoryVersion: '', modelPickerRelayOpen: true,
        favoriteMerchantPage: instance.publicMerchantPage, selectedPublicMerchant: instance.publicMerchantPage.merchants[0],
        platformService: { getModelCatalogVersion: async () => ({ version }) },
        loadCatalog: async () => { catalogLoads++; return true; }, loadPublicMerchantPage: async () => { directoryLoads++; },
        pendingCatalogVersion: '', pendingCatalogMerchants: new Set(), catalogRemovedMerchants: new Set(), pendingComicDirectories: new Set(),
        catalogSnapshotRefresh: new CatalogSnapshotRefresh(), catalogSnapshotRevision: 0, merchantCatalogRequest: 0, scheduleCatalogRequest: 0,
        merchantPickerSnapshots: new Map(), comicStepDirectory: new Map(), catalogMerchantSources: () => [] });
    await instance.checkModelCatalogVersion();
    assert.equal(instance.publicMerchantDirectoryVersion, version);
    assert.equal(instance.publicMerchantPageRequest, 5);
    assert.equal(instance.publicMerchantPage, undefined);
    assert.equal(instance.favoriteMerchantPage, undefined);
    assert.equal(instance.selectedPublicMerchant, undefined);
    assert.equal(catalogLoads, 3); assert.equal(directoryLoads, 1);
    await instance.checkModelCatalogVersion();
    assert.equal(catalogLoads, 3); assert.equal(directoryLoads, 1);
    version = '22222222'; await instance.checkModelCatalogVersion();
    assert.equal(catalogLoads, 6); assert.equal(directoryLoads, 2);
    // The model center's retry token is part of the key, so “重试” reloads the same directory version.
    assert.match(source, /directoryVersion=\{`\$\{this\.publicMerchantDirectoryVersion\}:\$\{this\.modelCenterRefreshToken\}`\}/);
    const modelCenter = readFileSync(new URL('../src/browser/nextmux-model-center-merchants.tsx', import.meta.url), 'utf8');
    assert.match(modelCenter, /const requestKey = JSON\.stringify\([^;]*props\.directoryVersion/);
});

test('empty store intros are localized in every supported desktop language', () => {
    for (const [locale, expected] of Object.entries({
        'zh-CN': '暂无简介', 'zh-TW': '暫無簡介', en: 'No description yet', ja: '紹介はまだありません', ko: '소개 없음',
        es: 'Sin descripción', fr: 'Aucune description', de: 'Keine Beschreibung', ru: 'Нет описания', 'pt-BR': 'Sem descrição',
        ar: 'لا يوجد وصف بعد', hi: 'अभी कोई विवरण नहीं'
    })) assert.equal(modelCenterText(locale, 'noStoreIntro'), expected);
});

test('the store profile is shown as plain text: intro or fallback in the directory card, full profile in the model drawer', () => {
    const directory = readFileSync(new URL('../src/browser/nextmux-model-center-merchants.tsx', import.meta.url), 'utf8');
    const widget = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    assert.match(directory, /const storeIntro = \(merchant\.storeTagline \|\| merchant\.storeDescription \|\| ''\)\.trim\(\);/);
    assert.match(directory, /const storeIntroDisplay = storeIntro \|\| text\('noStoreIntro'\);/);
    assert.match(directory, /\{hint\(\s*<p className=\{`nmx-mc-tagline nmx-mc-merchant-bio\$\{storeIntro \? '' : ' is-empty'\}`\} data-testid=\{`mc-store-tagline-\$\{merchant\.id\}`\} data-nmx-literal dir='auto'>\s*\{storeIntroDisplay\}/);
    assert.match(directory, /`\$\{merchant\.name\} · \$\{storeIntroDisplay\}`/);
    assert.match(directory, /<MerchantStoreProfile merchant=\{merchant\} locale=\{locale\} \/>/);
    assert.doesNotMatch(directory, /dangerouslySetInnerHTML/);
    // Relay picker name tooltip: name, the public number that tells same-named stores apart, then the intro or its fallback.
    assert.match(widget, /option\.kind === 'managed'\s*\?\s*\[option\.label, option\.publicCode, \(option\.storeTagline \|\| option\.storeDescription \|\| ''\)\.trim\(\) \|\| modelCenterText\(this\.desktopLocale, 'noStoreIntro'\)\]/);
});

test('model center rows use compact price metric, averageMultiplier sort label, and per-tab 30s force-refresh cooldown', async () => {
    const { offeringPriceText } = await import('../lib/browser/nextmux-offering-price.js');
    assert.equal(offeringPriceText('zh-CN', 'averageMultiplier'), '平均倍率');
    assert.equal(offeringPriceText('en', 'averageMultiplier'), 'Avg. multiplier');
    assert.equal(modelCenterText('zh-CN', 'refreshCooldown', 30), '30 秒后可再次刷新');
    const directory = readFileSync(new URL('../src/browser/nextmux-model-center-merchants.tsx', import.meta.url), 'utf8');
    const widget = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    const mcCss = readFileSync(new URL('../src/browser/style/nextmux-model-center.css', import.meta.url), 'utf8');
    const mainCss = readFileSync(new URL('../src/browser/style/nextmux.css', import.meta.url), 'utf8');
    assert.match(directory, /key === 'multiplier' \? offeringPriceText\(locale, 'averageMultiplier'\) : market\(/);
    assert.match(directory, /const multiplier = relayMultiplierTag\(locale, average\);[\s\S]{0,260}\{multiplier \|\| '—'\}/);
    assert.match(directory, /service\.getPublicMerchantDirectory\(request\(\), force\)/);
    assert.match(directory, /MODEL_CENTER_REFRESH_COOLDOWN_MS = 30_000/);
    assert.match(directory, /isCoolingDown \? text\('refreshCooldown', remainingSeconds\) : text\('refresh'\)/);
    assert.match(directory, /aria-disabled=\{isDisabled\}/);
    // Only a press of 刷新 spins it, and a failed refresh may be tried again at once.
    assert.match(directory, /const isSpinning = loading && manualRefreshKey === requestKey \|\| Boolean\(props\.refreshing\);/);
    assert.match(directory, /if \(force\) \{\s*delete modelCenterCooldownUntilByTab\[cooldownKey\];/);
    assert.match(mcCss, /\.nmx-mc-directory button\.nmx-mc-directory-refresh\s*\{[^}]*background:\s*transparent\s*!important;[^}]*border:\s*0\s*!important;[^}]*box-shadow:\s*none\s*!important;/);
    assert.doesNotMatch(widget, /nmx-model-center-refresh/);
    assert.match(widget, /onRefresh=\{tabKey => \{ if \(tabKey === 'quality-relays'\) void this\.loadModelCenterMerchantCount\(\); \}\}/);
    assert.match(widget, /mode === 'price' \? offeringPriceText\(this\.desktopLocale, 'averageMultiplier'\) : relayText\(this\.desktopLocale, key\)/);
    assert.match(mainCss, /\.nmx-shell\.nmx-theme-light \.nmx-billing-table > article[\s\S]*?background:\s*#faf9f7;/);
});


