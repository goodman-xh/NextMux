import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { usageByDay, usageByModel, usageCacheParts, usagePrimaryCurrency, usageProviderCacheRate, usageProviderTotals } from '../lib/browser/nextmux-usage-stats.js';
import { loadUsageAnalytics, usageWindow } from '../lib/browser/nextmux-usage-analytics.js';
import { usageAnalyticsText } from '../lib/browser/nextmux-usage-analytics-locale.js';

const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const locales = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi'];

const record = (overrides = {}) => ({ id: 'r', canonicalModel: 'vendor/model-a', modelName: 'Model A', providerName: 'Relay', status: 'completed', currency: 'USD',
    chargedMicros: 1000, createdAt: Date.now(), durationMs: 800, inputTokens: 1000, cachedInputTokens: 400, cacheWriteTokens: 100, outputTokens: 200,
    inputIncludesCached: true, attemptCount: 1, ...overrides });

test('usage math follows the platform cache accounting and never invents unknown values', () => {
    assert.deepEqual(usageCacheParts(record()), { hit: 400, total: 1000 }, 'input already includes cache reads');
    assert.deepEqual(usageCacheParts(record({ inputIncludesCached: false })), { hit: 400, total: 1500 }, 'input + read + write');
    assert.equal(usageCacheParts(record({ inputIncludesCached: null })), undefined, 'unknown accounting is excluded, not guessed');
    assert.equal(usageCacheParts(record({ inputTokens: null })), undefined);
    const now = new Date(2026, 8, 24, 12).getTime();
    const days = usageByDay([record({ createdAt: now }), record({ createdAt: now - 86_400_000, status: 'failed', chargedMicros: 0, inputTokens: null, outputTokens: null, cachedInputTokens: null, cacheWriteTokens: null, durationMs: null }), record({ currency: 'CNY', createdAt: now })], now - 7 * 86_400_000, now + 60_000, 'USD');
    assert.equal(days.length, 8, 'one bucket per calendar day including empty days');
    assert.equal(days.at(-1).requests, 1); assert.equal(days.at(-2).failed, 1); assert.equal(days.at(-2).metered, 0);
    const models = usageByModel([record({ chargedMicros: 5 }), record({ canonicalModel: 'vendor/b', modelName: 'Model B', chargedMicros: 9 })], 'USD');
    assert.deepEqual(models.map(model => model.label), ['Model B', 'Model A'], 'sorted by spend');
    const totals = usageProviderTotals([{ merchantId: 'm', providerName: 'R', currency: 'USD', requestCount: 3, completedCount: 2, failedCount: 1, otherCount: 0, chargedMicros: 12, inputTokens: 5, cachedInputTokens: 1, cacheWriteTokens: 0, outputTokens: 2, failoverCount: 1, averageDurationMs: null, durationSampleCount: 0, modelMatchedCount: 0, modelMismatchedCount: 0, modelUnreportedCount: 3, modelEvidence: 'insufficient', firstAt: 1, latestAt: 2 }], 'USD');
    assert.equal(totals.averageDurationMs, null, 'no samples → unknown latency, not 0 ms');
    assert.equal(usagePrimaryCurrency(['CNY', 'USD']), 'USD'); assert.equal(usagePrimaryCurrency([]), 'USD');
    for (const locale of locales) for (const key of ['spend', 'cacheHitRate', 'cacheRead', 'cacheWrite', 'avgLatency', 'successRate', 'byModel', 'byRelay', 'trend', 'notReported', 'empty'])
        assert.ok(usageAnalyticsText(locale, key).trim(), `${locale}:${key}`);
});

test('usage loader pages both platform endpoints within one fixed window', async () => {
    const calls = [];
    const service = {
        async getMerchantUsageOverview(query) { calls.push(['merchant', query]); return { items: [], range: { since: query.since, until: query.until }, refreshedAt: 1, ...(query.cursor ? {} : { nextCursor: 'm2' }) }; },
        async getUsageHistory(query) { calls.push(['history', query]); return { items: [record()], range: { since: query.since, until: query.until }, ...(query.cursor === 'h2' ? {} : { nextCursor: query.cursor ? 'h2' : 'h1' }) }; }
    };
    const now = Date.UTC(2026, 8, 24, 10, 30, 12);
    const loaded = await loadUsageAnalytics(service, 30, now);
    const window = usageWindow(30, now);
    assert.equal(loaded.records.length, 3); assert.equal(loaded.truncated, false);
    assert.ok(calls.every(([, query]) => query.since === window.since && query.until === window.until), 'every page uses the same window');
    assert.deepEqual(calls.filter(([kind]) => kind === 'history').map(([, query]) => query.cursor), [undefined, 'h1', 'h2']);
    assert.deepEqual(calls.filter(([kind]) => kind === 'merchant').map(([, query]) => query.cursor), [undefined, 'm2']);
    assert.equal(window.until % 60_000, 0);
    calls.length = 0;
    const summary = await loadUsageAnalytics(service, 30, now, { history: false });
    assert.deepEqual(summary.records, []);
    assert.equal(calls.filter(([kind]) => kind === 'history').length, 0, 'the Settings summary never pages per-request history');
    assert.equal(calls.filter(([kind]) => kind === 'merchant').length, 2);
    const row = (includes, overrides = {}) => ({ merchantId: 'm', providerName: 'R', currency: 'USD', requestCount: 1, completedCount: 1, failedCount: 0, otherCount: 0, chargedMicros: 1,
        inputTokens: 1000, cachedInputTokens: 250, cacheWriteTokens: 250, outputTokens: 1, failoverCount: 0, averageDurationMs: null, durationSampleCount: 0,
        modelMatchedCount: 0, modelMismatchedCount: 0, modelUnreportedCount: 0, modelEvidence: 'insufficient', firstAt: 1, latestAt: 2, ...(includes === undefined ? {} : { inputIncludesCached: includes }), ...overrides });
    assert.equal(usageProviderCacheRate([row(true)], 'USD'), .25);
    assert.equal(usageProviderCacheRate([row(false)], 'USD'), 250 / 1500);
    assert.equal(usageProviderCacheRate([row(undefined)], 'USD'), null, 'mixed/unknown accounting stays unknown');
});

async function fixtureBundle() {
    const entry = `import * as React from 'react'; import { createRoot } from 'react-dom/client';
import { ModelUsagePanel } from './nextmux-model-usage-panel';
import { UsageAnalytics } from './nextmux-usage-analytics';
const params = new URLSearchParams(location.search), locale = params.get('locale') || 'en', theme = params.get('theme') || 'dark';
const DAY = 86400000, now = Date.now();
const models = [['anthropic/claude-sonnet-4.5', 'Claude Sonnet 4.5'], ['openai/gpt-5.1', 'GPT-5.1'], ['google/gemini-2.5-pro', 'Gemini 2.5 Pro'], ['deepseek/deepseek-v3.2', 'DeepSeek V3.2']];
const records = params.has('empty') ? [] : Array.from({ length: 140 }, (_, i) => {
  const [canonicalModel, modelName] = models[i % models.length]; const unknown = i % 11 === 0;
  return { id: 'r' + i, canonicalModel, modelName, providerName: i % 3 ? 'Synthetic Relay' : 'Second Relay', status: i % 17 === 0 ? 'failed' : 'completed', currency: 'USD',
    chargedMicros: i % 17 === 0 ? 0 : 1200 + (i % 9) * 3100, createdAt: now - (i % 26) * DAY - (i % 5) * 3600000, durationMs: unknown ? null : 600 + (i % 13) * 170,
    inputTokens: unknown ? null : 2000 + i * 13, cachedInputTokens: unknown ? null : (i % 4) * 400, cacheWriteTokens: unknown ? null : (i % 3) * 50, outputTokens: unknown ? null : 300 + i,
    inputIncludesCached: unknown ? null : i % 2 === 0, attemptCount: 1 };
});
const summary = (merchantId, providerName, filter) => { const rows = records.filter(filter);
  return { merchantId, providerName, currency: 'USD', requestCount: rows.length, completedCount: rows.filter(r => r.status === 'completed').length, failedCount: rows.filter(r => r.status === 'failed').length, otherCount: 0,
    chargedMicros: rows.reduce((s, r) => s + r.chargedMicros, 0), inputTokens: rows.reduce((s, r) => s + (r.inputTokens || 0), 0), cachedInputTokens: rows.reduce((s, r) => s + (r.cachedInputTokens || 0), 0),
    cacheWriteTokens: rows.reduce((s, r) => s + (r.cacheWriteTokens || 0), 0), outputTokens: rows.reduce((s, r) => s + (r.outputTokens || 0), 0), failoverCount: merchantId === 'm-2' ? 3 : 0,
    averageDurationMs: merchantId === 'm-2' ? null : 912, durationSampleCount: merchantId === 'm-2' ? 0 : rows.length, modelMatchedCount: rows.length, modelMismatchedCount: 0, modelUnreportedCount: 0,
    modelEvidence: merchantId === 'm-2' ? 'self_reported_conflict' : 'self_reported_consistent', firstAt: now - 26 * DAY, latestAt: now }; };
const providers = records.length ? [summary('m-1', 'Synthetic Relay', r => r.providerName === 'Synthetic Relay'), summary('m-2', 'Second Relay', r => r.providerName !== 'Synthetic Relay')] : [];
const service = {
  async getMerchantUsageOverview(q) { await new Promise(r => setTimeout(r, params.has('slow') ? 400 : 20)); return { items: providers, range: { since: q.since, until: q.until }, refreshedAt: now }; },
  async getUsageHistory(q) { await new Promise(r => setTimeout(r, params.has('slow') ? 400 : 20)); const start = Number(q.cursor || 0); const rows = records.filter(r => r.createdAt >= q.since && r.createdAt < q.until).slice(start, start + 100);
    return { items: rows, range: { since: q.since, until: q.until }, ...(start + 100 < records.length ? { nextCursor: String(start + 100) } : {}) }; }
};
const root = createRoot(document.getElementById('fixture'));
root.render(<div className='nmx-desktop-widget' dir={locale === 'ar' ? 'rtl' : 'ltr'} lang={locale}><div className={'nmx-shell nmx-theme-' + theme}><section className='nmx-workspace fixture-workspace'><div className='nmx-workspace-scroll nmx-model-center fixture-scroll'>
  {params.get('variant') === 'summary' ? <div className='nmx-settings-page'><UsageAnalytics variant='summary' service={service} locale={locale} rangeDays={30} title='30' /></div>
    : <ModelUsagePanel service={service} linked ownerId='fixture-user' locale={locale} personalUsage={[]} searchQuery={params.get('q') || ''} onLogin={() => {}} />}
</div></section></div></div>);`;
    const widget = new URL('../src/browser/nextmux-usage-analytics.tsx', import.meta.url);
    const { outputFiles } = await desktop('esbuild').build({ stdin: { contents: entry, loader: 'tsx', sourcefile: 'usage-fixture.tsx', resolveDir: dirname(fileURLToPath(widget)) },
        bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'silent',
        alias: { react: core.resolve('react'), 'react/jsx-runtime': core.resolve('react/jsx-runtime'), 'react-dom': core.resolve('react-dom'), 'react-dom/client': core.resolve('react-dom/client'),
            '@theia/core/shared/react': core.resolve('react') } });
    return outputFiles[0].contents;
}

test('usage page renders exact spend, cache and latency analytics in real Chromium (light/dark, zh-CN/en/ar, narrow/wide)', { timeout: 240000 }, async t => {
    const puppeteer = (await import(platform.resolve('puppeteer'))).default;
    await mkdir('/tmp/nm-shots/usage', { recursive: true });
    const style = name => readFile(new URL(`../src/browser/style/${name}`, import.meta.url));
    const assets = {
        '/fixture.js': ['text/javascript', await fixtureBundle()],
        '/style.css': ['text/css', await style('nextmux.css')], '/production.css': ['text/css', await style('nextmux-desktop-production.css')],
        '/pickers.css': ['text/css', await style('nextmux-pickers-settings.css')],
        '/icons.css': ['text/css', await readFile(core.resolve('@vscode/codicons/dist/codicon.css'))], '/codicon.ttf': ['font/ttf', await readFile(core.resolve('@vscode/codicons/dist/codicon.ttf'))],
        '/': ['text/html', `<!doctype html><html><head><meta charset='utf-8'><link rel='stylesheet' href='/icons.css'><link rel='stylesheet' href='/style.css'><link rel='stylesheet' href='/production.css'><link rel='stylesheet' href='/pickers.css'>
<style>html,body,#fixture,.nmx-desktop-widget,.nmx-shell{margin:0;width:100%;height:100%;font:13px system-ui}*{box-sizing:border-box}.nmx-shell{display:block}.nmx-shell .fixture-workspace{height:100%;padding-top:0}.fixture-scroll{flex:1;min-height:0;overflow:auto}</style></head><body><div id='fixture'></div><script src='/fixture.js'></script></body></html>`]
    };
    const server = createServer((request, response) => {
        const asset = assets[new URL(request.url, 'http://127.0.0.1').pathname];
        response.writeHead(asset ? 200 : 404, { 'content-type': asset?.[0] || 'text/plain' }); response.end(asset?.[1] || 'Not found');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const theme of ['light', 'dark']) for (const locale of ['zh-CN', 'en', 'ar']) for (const [width, height] of [[380, 760], [1280, 860]]) {
        if (locale === 'ar' && width === 380 && theme === 'light') continue;
        const label = `${theme}-${locale}-${width}x${height}`;
        await page.setViewport({ width, height }); await page.mouse.move(0, 0);
        await page.goto(`${origin}/?${new URLSearchParams({ locale, theme })}`, { waitUntil: 'load' });
        await page.waitForSelector('.nmx-usage-trend .nmx-usage-chart-bar');
        const view = await page.evaluate(() => {
            const kpi = key => document.querySelector(`[data-usage-kpi="${key}"] strong`).textContent;
            return { spend: kpi('spend'), requests: kpi('requests'), cache: kpi('cache'), latency: kpi('latency'), tokens: kpi('tokens'),
                bars: document.querySelectorAll('.nmx-usage-trend .nmx-usage-chart-bar').length, models: document.querySelectorAll('[data-usage-model]').length,
                relays: [...document.querySelectorAll('[data-usage-relay]')].map(row => row.textContent), pageWidth: document.documentElement.scrollWidth,
                tableOverflowContained: [...document.querySelectorAll('.nmx-usage-table-scroll')].every(node => node.getBoundingClientRect().right <= innerWidth + 1) };
        });
        const latin = value => value.replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/٫/g, '.');
        assert.match(latin(view.spend), /\$\s?\d|\d\s?US\$|\d.*\$/, `${label}: exact spend ${view.spend}`); assert.match(latin(view.spend), /[.,]\d{2,6}/, `${label}: fees keep decimals`);
        assert.equal(latin(view.requests).replace(/\D/g, ''), '140');
        assert.match(latin(view.cache), /\d.*[%٪]/, `${label}: cache hit rate`); assert.match(view.latency, /ms|s/);
        assert.equal(view.bars, 31, `${label}: one bar per calendar day in 30 days`);
        assert.equal(view.models, 4); assert.equal(view.relays.length, 2);
        assert.ok(view.relays.find(row => row.includes('Second Relay')).includes('—'), `${label}: unknown latency renders —`);
        assert.ok(view.pageWidth <= width, `${label}: horizontal page overflow ${view.pageWidth}`);
        assert.ok(view.tableOverflowContained, `${label}: wide tables scroll inside their card`);
        const bar = await page.$$('.nmx-usage-trend .nmx-usage-chart-bar');
        for (const index of [0, 15, 30]) {
            await bar[index].hover();
            const tip = await page.$eval('.nmx-usage-trend .nmx-usage-chart-tip', el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, text: el.textContent }; });
            assert.ok(tip.left >= 0 && tip.right <= width, `${label}: tooltip ${index} clipped ${JSON.stringify(tip)}`);
        }
        await page.mouse.move(0, 0);
        await page.click('.nmx-usage-segmented button:nth-child(3)');
        assert.equal(await page.$eval('.nmx-usage-segmented button:nth-child(3)', el => el.getAttribute('aria-pressed')), 'true');
        await page.click('.nmx-usage-segmented button:nth-child(1)');
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 260)));
        await page.screenshot({ path: `/tmp/nm-shots/usage/usage-${label}.png`, fullPage: true });
    }
    for (const theme of ['light', 'dark']) {
        await page.setViewport({ width: 900, height: 400 });
        await page.goto(`${origin}/?${new URLSearchParams({ locale: 'zh-CN', theme, variant: 'summary' })}`, { waitUntil: 'load' });
        await page.waitForFunction(() => /\$/.test(document.querySelector('[data-usage-kpi="spend"] strong')?.textContent || ''));
        await page.screenshot({ path: `/tmp/nm-shots/usage/usage-summary-${theme}-zh-CN.png` });
    }
    await page.goto(`${origin}/?${new URLSearchParams({ locale: 'en', theme: 'dark', empty: '1' })}`, { waitUntil: 'load' });
    await page.waitForSelector('.nmx-usage-empty');
    assert.equal(await page.$eval('[data-usage-kpi="tokens"] strong', el => el.textContent), '—', 'no reported tokens → —, not 0');
    assert.equal(await page.$eval('[data-usage-kpi="cache"] strong', el => el.textContent), '—');
    assert.equal(await page.$eval('[data-usage-kpi="latency"] strong', el => el.textContent), '—');
    await page.goto(`${origin}/?${new URLSearchParams({ locale: 'zh-CN', theme: 'light', slow: '1' })}`, { waitUntil: 'load' });
    await page.waitForSelector('.nmx-usage-loading');
    await page.screenshot({ path: '/tmp/nm-shots/usage/usage-loading-light-zh-CN.png' });
    assert.deepEqual(errors, []);
});
