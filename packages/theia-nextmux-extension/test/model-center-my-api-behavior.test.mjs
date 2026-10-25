import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { MyApisToastLifetime, MyApisErrorToast, MyApisDialog, myApisText } from '../lib/browser/nextmux-my-apis.js';
import { OfferingPriceCard, offeringPriceSectionExpanded, setOfferingPriceSectionExpanded, setOfferingPriceExpanded, OFFERING_PRICE_SECTIONS_STORAGE_KEY } from '../lib/browser/nextmux-offering-price.js';

const require = createRequire(import.meta.url), core = createRequire(require.resolve('@theia/core/package.json'));
const { renderToStaticMarkup } = core('react-dom/server');
const source = readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
const member = name => widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name);
const methods = ['saveOfficialConnection', 'refreshOfficialConnectionModels', 'officialConnectionRequestIsCurrent'].map(name => member(name).getText(file));
const deps = { modelFailureText: () => 'Connection failed', modelFailure: () => ({ detail: 'fixture' }), isOfficialMediaProtocol: () => false,
    officialDiscoverySummary: () => 'Discovered', connectionCheckText: () => 'Checked', localizeDesktopSurface: (_locale, text) => text };
const Harness = new Function(...Object.keys(deps), ts.transpile(`class Harness { ${methods.join('\n')} }; return Harness;`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(deps));

test('toast pauses remaining time, leaves at 3.8 seconds and dismisses at 4 seconds of active time', t => {
    const old = global.window; t.after(() => { global.window = old; });
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
    global.window = { setTimeout, clearTimeout };
    const events = []; const timer = new MyApisToastLifetime(value => events.push(['leaving', value]), () => events.push(['dismiss']));
    t.mock.timers.tick(1000); timer.pause(); t.mock.timers.tick(12000); assert.deepEqual(events, [['leaving', false]]);
    timer.resume(); t.mock.timers.tick(2799); assert.equal(events.length, 1);
    t.mock.timers.tick(1); assert.deepEqual(events.at(-1), ['leaving', true]);
    t.mock.timers.tick(199); assert.equal(events.length, 2); t.mock.timers.tick(1); assert.deepEqual(events.at(-1), ['dismiss']);
    timer.dispose();
});

test('manual close animates for 200 ms; disposed toasts never fire callbacks', t => {
    const old = global.window; t.after(() => { global.window = old; });
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 }); global.window = { setTimeout, clearTimeout };
    let leaves = 0, closes = 0; const timer = new MyApisToastLifetime(() => leaves++, () => closes++);
    timer.pause(); timer.close(); t.mock.timers.tick(199); assert.equal(closes, 0); t.mock.timers.tick(1); assert.equal(closes, 1);
    const pending = new MyApisToastLifetime(() => leaves++, () => closes++); pending.dispose(); const lastLeaves = leaves;
    t.mock.timers.tick(10000); assert.equal(closes, 1); assert.equal(leaves, lastLeaves);
});

const offering = { id: 'a', multiplierBps: 15000, price: { currency: 'USD', inputPerMillionMicros: 3000000, outputPerMillionMicros: 6000000 }, officialPrice: { inputPerMillionMicros: 2000000, outputPerMillionMicros: 4000000 } };
test('price sections start collapsed, open side by side together and remember that across models and storage failures', t => {
    const old = global.window; t.after(() => { global.window = old; }); const store = new Map();
    global.window = { localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) } };
    assert.equal(offeringPriceSectionExpanded('official'), false); assert.equal(offeringPriceSectionExpanded('user'), false);
    const first = renderToStaticMarkup(React.createElement(OfferingPriceCard, { locale: 'zh-CN', offering, collapsible: true }));
    assert.equal((first.match(/aria-expanded="false"/g) || []).length, 2); assert.match(first, /nmx-price-section-toggle/);
    assert.doesNotMatch(first, /<dl/, 'collapsed prices do not leave visible grid content');
    const full = renderToStaticMarkup(React.createElement(OfferingPriceCard, { locale: 'en', offering }));
    assert.match(full, /<div class="nmx-offering-price-columns"><section class="nmx-offering-price-block nmx-price-section" data-price-audience="official">/);
    assert.match(full, /<h4 class="nmx-price-section-heading">.*?<\/h4><div class="nmx-price-section-body"[^>]*><dl>/, 'a plain card shows its rows under a heading');
    setOfferingPriceSectionExpanded('official', true);
    assert.deepEqual(JSON.parse(store.get(OFFERING_PRICE_SECTIONS_STORAGE_KEY)), { official: true, user: false });
    const next = renderToStaticMarkup(React.createElement(OfferingPriceCard, { locale: 'en', offering: { ...offering, id: 'b' }, collapsible: true }));
    assert.equal((next.match(/aria-expanded="true"/g) || []).length, 2, 'side by side, the quotes open together');
    global.window.localStorage.setItem = () => { throw new Error('disabled'); }; setOfferingPriceSectionExpanded('user', true);
    assert.equal(offeringPriceSectionExpanded('user'), true); setOfferingPriceExpanded(false);
});

test('My API toast has the required status markup and connection copy in every locale', () => {
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
        const html = renderToStaticMarkup(React.createElement(MyApisErrorToast, { locale, error: 'secret upstream diagnostic' }));
        assert.match(html, /nmx-floating-toast is-error/); assert.match(html, /role="status"/); assert.match(html, /codicon-error/);
        assert.match(html, /nmx-floating-toast-close/); assert.doesNotMatch(html, /secret upstream diagnostic/);
        assert.ok(myApisText(locale, 'connectionFailed').length > 5);
    }
    assert.equal(myApisText('zh-CN', 'connectionFailed'), '无法连接模型服务。');
});

test('saving failures retain the typed API key and model refresh touches only the selected connection', async () => {
    const state = new Harness(); const calls = [];
    Object.assign(state, { officialConnectionStage: 'idle', officialConnectionRequestToken: 0, desktopLocale: 'en',
        officialProviderSheet: { id: 'custom_openai', protocol: 'openai_chat' }, officialDraft: { label: '', model: '', baseUrl: 'https://example.invalid', apiKey: 'fixture-secret' },
        platformService: { async saveOfficialModelConnection(request) { calls.push(request); throw Error('offline'); }, async refreshOfficialModelDiscovery(id) { calls.push(id); return { id }; } },
        update() {}, async refreshOfficialModelsAfterMutation() { calls.push('read-saved-snapshot'); } });
    await state.saveOfficialConnection(false);
    assert.equal(state.officialDraft.apiKey, 'fixture-secret'); assert.equal(state.officialConnectionStage, 'idle'); assert.equal(calls[0].model, '');
    calls.length = 0; await state.refreshOfficialConnectionModels({ id: 'only-this-one', providerId: 'custom_openai' });
    assert.deepEqual(calls, ['only-this-one', 'read-saved-snapshot']); assert.equal(state.officialConnectionStage, 'idle');
});

test('main API form keeps provider/protocol/model controls inside its single Advanced section', () => {
    const sheet = member('renderOfficialConnectionSheet'); const details = []; const modelRefs = [];
    const attr = (node, name) => node.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(file) === name)?.initializer;
    const visit = node => {
        if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === 'details' && attr(node.openingElement, 'className')?.text === 'nmx-official-advanced') details.push(node);
        if (ts.isJsxExpression(node) && node.expression?.getText(file) === 'modelField') modelRefs.push(node);
        ts.forEachChild(node, visit);
    }; visit(sheet);
    assert.equal(details.length, 1); assert.equal(modelRefs.length, 1);
    const advanced = details[0].getText(file); assert.match(advanced, /provider-preset/); assert.match(advanced, /NativeWebResearchFields/); assert.match(advanced, /modelField/);
    assert.ok(modelRefs[0].pos > details[0].pos && modelRefs[0].end < details[0].end);
    assert.doesNotMatch(details[0].openingElement.getText(file), /open=/);
    assert.doesNotMatch(member('renderModelCenter').getText(file), /const errored = this\.officialModels\.connections\.find/,
        'dismissed toasts must not be recreated from persistent discovery errors');
});

test('API action metadata and literal model counts survive one, two and three digit counts', () => {
    const props = { locale: 'en', rows: [1, 20, 300].map((modelCount, i) => ({ id: String(i), name: 'API', providerName: 'Fixture', modelCount, kind: 'chat', status: 'unverified' })), busy: false,
        onOpenModels() {}, onClose() {}, onAdd() {}, onOfficial() {}, onEdit() {}, onTest() {}, onRemove() {}, onCancelRemove() {} };
    const html = renderToStaticMarkup(React.createElement(MyApisDialog, props));
    for (const action of ['models', 'speed', 'edit', 'delete']) assert.equal((html.match(new RegExp(`data-api-action="${action}"`, 'g')) || []).length, 3);
    for (const count of [1, 20, 300]) assert.match(html, new RegExp(`nmx-my-apis-model-count"><span data-nmx-literal="true">${count}</span>`));
});

test('actual merchant tabs have independent cooldowns and only refresh their own directory; price expansion survives reload', { timeout: 45000 }, async t => {
    const { build } = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url))('esbuild');
    const puppeteer = (await import(createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url)).resolve('puppeteer'))).default;
    const bundle = await build({ stdin: { loader: 'jsx', resolveDir: dirname(fileURLToPath(new URL('../lib/browser/nextmux-model-center-merchants.js', import.meta.url))), contents: `
import React from 'react'; import {createRoot} from 'react-dom/client'; import {ModelCenterMerchants} from './nextmux-model-center-merchants'; import {OfferingPriceCard} from './nextmux-offering-price';
localStorage.setItem('nextmux.desktop.modelCenterLayout.v1','grid');window.calls=[];window.now=Date.now();Date.now=()=>window.now;
const service={async getPublicMerchantDirectory(query,force){window.calls.push({query,force});return {merchants:[{id:'relay',name:'Relay',metrics:{},outputCategories:['text']}],totalCount:1};}};
let view='all',capability='all',model='a';const root=createRoot(document.querySelector('main'));
function render(){root.render(<><ModelCenterMerchants service={service} locale='zh-CN' view={view} capability={capability} query='' favorites={[]} onFavorite={()=>{}} onCopy={async()=>{}}/><OfferingPriceCard locale='zh-CN' offering={{...${JSON.stringify(offering)},id:model}} collapsible/></>);}
window.setTab=(value)=>{view=value==='quality'?'all':'capability';capability=value==='quality'?'all':value;render();};window.setModel=()=>{model='b';render();};render();` }, bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'silent',
        alias: { react: core.resolve('react'), 'react-dom': core.resolve('react-dom'), 'react-dom/client': core.resolve('react-dom/client') } });
    const server = createServer((req, res) => { res.setHeader('Content-Type', req.url === '/fixture.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/fixture.js' ? bundle.outputFiles[0].text : '<!doctype html><meta charset="utf-8"><main></main><script src="/fixture.js"></script>'); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close()); const page = await browser.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message)); await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => document.querySelector('.nmx-mc-refresh')?.getAttribute('aria-disabled') === 'false');
    assert.ok(await page.$('.nmx-mc-grid')); assert.equal(await page.$eval('.nmx-mc-merchant-bio', node => node.textContent), '暂无简介');
    await page.click('.nmx-mc-refresh'); await page.waitForFunction(() => window.calls.some(call => call.force) && document.querySelector('.nmx-mc-refresh')?.classList.contains('is-cooling') && !document.querySelector('.nmx-mc-refresh')?.classList.contains('is-spinning'));
    const initialCalls = await page.evaluate(() => window.calls.length); await page.click('.nmx-mc-refresh'); assert.equal(await page.evaluate(() => window.calls.length), initialCalls);
    await page.evaluate(() => { window.now += 1000; }); await page.waitForFunction(() => (document.querySelector('.nmx-mc-refresh')?.title || document.querySelector('.nmx-mc-refresh')?.getAttribute('aria-label')) === '29 秒后可再次刷新');
    for (const capability of ['all', 'coding', 'reasoning', 'image', 'video', 'audio']) {
        await page.evaluate(value => window.setTab(value), capability);
        await page.waitForFunction(value => document.querySelector('.nmx-mc-refresh')?.dataset.tabKey === 'capability:' + value && document.querySelector('.nmx-mc-refresh').getAttribute('aria-disabled') === 'false', {}, capability);
        await page.click('.nmx-mc-refresh'); await page.waitForFunction(() => document.querySelector('.nmx-mc-refresh')?.classList.contains('is-cooling') && !document.querySelector('.nmx-mc-refresh')?.classList.contains('is-spinning'));
        assert.equal(await page.evaluate(() => window.calls.at(-1).query.capability), capability);
    }
    assert.equal(await page.evaluate(() => window.calls.filter(call => call.force).length), 7);
    await page.evaluate(() => window.setTab('quality')); await page.waitForFunction(() => document.querySelector('.nmx-mc-refresh')?.dataset.tabKey === 'quality-relays');
    assert.equal(await page.$eval('.nmx-mc-refresh', node => node.getAttribute('aria-disabled')), 'true');
    await page.click('.nmx-price-section-toggle'); await page.evaluate(() => window.setModel());
    assert.deepEqual(await page.$$eval('.nmx-price-section-toggle', nodes => nodes.map(node => node.getAttribute('aria-expanded'))), ['true', 'true']);
    await page.reload(); await page.waitForSelector('.nmx-price-section-toggle');
    assert.deepEqual(await page.$$eval('.nmx-price-section-toggle', nodes => nodes.map(node => node.getAttribute('aria-expanded'))), ['true', 'true']);
    assert.deepEqual(errors, []);
});
