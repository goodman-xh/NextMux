import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { startModelCenterFixture } from './model-center-fixture.mjs';
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const puppeteer = (await import(platform.resolve('puppeteer'))).default;

// This is an intentionally exhaustive browser matrix (72 full navigations,
// tooltips, focus and pagination).  Two Puppeteer workers can contend for the
// shared CI/display runtime, so keep the test's safety deadline generous while
// still failing a genuinely hung page.
test('actual Model Center cards/drawer: 12 locales, two themes, three sizes and transactional interactions', { timeout: 180000 }, async t => {
    const fixture = await startModelCenterFixture(); t.after(fixture.close);
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => new URL(request.url()).origin === fixture.origin ? void request.continue() : (errors.push('Blocked external request'), void request.abort()));
    const open = async params => { await page.goto(`${fixture.origin}/?${new URLSearchParams(params)}`, { waitUntil: 'load' }); };
    const ready = async (count = 2) => page.waitForFunction(expected => document.querySelectorAll('[data-model-center-merchant]').length === expected
        && document.querySelector('.nmx-mc-merchants')?.getAttribute('aria-busy') === 'false', {}, count);
    const locales = ['zh-CN','zh-TW','en','ja','ko','es','fr','de','pt-BR','ru','ar','hi'];
    for (const locale of locales) for (const theme of ['dark','light']) for (const [width, height] of [[320,680],[900,760],[640,360]]) {
        const label = `${locale}/${theme}/${width}x${height}`;
        await page.setViewport({ width, height }); await open({ locale, theme }); await ready();
        const layout = await page.evaluate(() => {
            const directory = document.querySelector('.nmx-mc-directory'); const rows = [...directory.querySelectorAll('[data-model-center-merchant]')];
            return { rows: rows.map(row => ({ width: row.getBoundingClientRect().width, height: row.getBoundingClientRect().height,
                background: getComputedStyle(row).backgroundColor, border: getComputedStyle(row).borderTopColor, rating: row.querySelector('.nmx-mc-metrics strong').textContent })),
                width: document.documentElement.scrollWidth, direction: getComputedStyle(directory).direction, documentDirection: getComputedStyle(document.documentElement).direction,
                tableCount: directory.querySelectorAll('table').length };
        });
        assert.equal(layout.rows.length, 2, label); assert.ok(layout.width <= width, `${label}: horizontal overflow ${layout.width}`);
        assert.equal(layout.direction, locale === 'ar' ? 'rtl' : 'ltr', label); assert.equal(layout.documentDirection, 'ltr');
        assert.ok(layout.rows.every(row => row.height <= (width === 320 ? 190 : 116)), `${label}: card height ${layout.rows.map(row=>row.height)}`);
        assert.ok(layout.rows.every(row => row.background === (theme === 'dark' ? 'rgb(37, 36, 39)' : 'rgb(255, 255, 255)')), `${label}: wrong actual card background`);
        assert.ok(layout.rows.every(row => row.border === (theme === 'dark' ? 'rgb(81, 75, 86)' : 'rgb(215, 206, 219)')), `${label}: wrong actual border`);
        const expected = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(1);
        assert.equal(layout.rows[0].rating, expected, `${label}: zero votes must be initial 100%, not 10000%`);
        assert.equal(layout.rows[1].rating, expected, `${label}: 100-point measured quality is 100%`);
        assert.equal(layout.tableCount, 0);
        assert.equal(await page.$eval('[data-api-state]', el => el.dataset.apiState), 'ready', `${label}: API validation must not depend on probe samples`);
        await page.click('[data-model-center-merchant] [data-model-center-list]');
        await page.waitForFunction(() => document.querySelectorAll('[data-supported-model]').length === 3 && document.querySelector('.nmx-mc-model-list')?.getAttribute('aria-busy') === 'false');
        // Measure the settled sheet, not a frame of its 200 ms slide-in transition.
        await page.waitForFunction(() => document.querySelector('.nmx-mc-drawer').getAnimations().every(animation => animation.playState === 'finished'));
        const drawer = await page.evaluate(() => {
            const el = document.querySelector('.nmx-mc-drawer'), rect = el.getBoundingClientRect();
            return { left: rect.left, right: rect.right, bottom: rect.bottom, top: rect.top, text: el.textContent,
                rows: [...el.querySelectorAll('[data-supported-model]')].map(row => ({ name: row.querySelector('strong').textContent, height: row.getBoundingClientRect().height })),
                summary: el.querySelector('.nmx-mc-model-summary').textContent,
                tables: el.querySelectorAll('table').length, width: document.documentElement.scrollWidth };
        });
        assert.ok(drawer.left >= 0 && drawer.right <= width && drawer.top >= 0 && drawer.bottom <= height, label);
        assert.equal(drawer.rows.length, 3, label); assert.equal(drawer.tables, 0, `${label}: prices must not expand by default`);
        assert.ok(drawer.rows.every(row => row.height <= 100), `${label}: model rows too tall ${drawer.rows.map(row=>row.height)}`);
        assert.doesNotMatch(drawer.text, /Raw unpriced|suspended|Wrong duplicate/);
        assert.deepEqual(drawer.summary.match(/\p{Decimal_Number}+/gu), [new Intl.NumberFormat(locale).format(3)],
            `${label}: summary must count the three loaded active model prices after deduplication, not five raw listings or 428 discovered models`);
        if (locale === 'en') assert.match(drawer.summary, /3 model prices loaded/);
        if (locale === 'zh-CN') assert.match(drawer.summary, /已加载 3 条模型报价/);
        await page.focus('.nmx-mc-drawer > header > button');
        await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.nmx-mc-drawer'));
    }
    t.diagnostic('72 actual React + production CSS directory/drawer layout cases passed; no production account or API was used.');

    await page.setViewport({width:900,height:760}); await open({locale:'en'}); await ready();
    await page.click('[data-model-center-favorite]');
    assert.deepEqual(await page.evaluate(()=>window.fixture.calls), [['favorite','fixture-000']]);
    assert.equal(await page.$eval('[data-model-center-favorite]',el=>el.getAttribute('aria-pressed')), 'true');
    await page.click('[data-model-center-merchant] [data-model-center-list]');
    await page.waitForSelector('[data-supported-model]');
    await page.click('[data-supported-model] .nmx-mc-model-row');
    assert.deepEqual(await page.$$eval('[data-price-metric]',rows=>rows.map(row=>row.dataset.priceMetric)), ['input_token','cached_input_token','cache_write_token','output_token']);
    const prices = await page.$eval('.nmx-mc-model-expanded',el=>el.textContent);
    assert.match(prices,/Input/); assert.match(prices,/Cache read/); assert.match(prices,/Cache write/); assert.match(prices,/Output/);
    assert.match(prices,/\$2/); assert.match(prices,/\$0\.006/); assert.match(prices,/1,000,000/); assert.match(prices,/1,000 tokens/);
    const preview = await page.$eval('.nmx-mc-model-row',el=>el.textContent);
    assert.match(preview,/\$6/); assert.match(preview,/\$24/); // unit normalization, not official-price reverse calculation
    assert.equal(await page.$('.nmx-mc-drawer > footer .nmx-mc-choose'), null, 'model center must not expose a conversation-bound choose button');
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.nmx-mc-drawer'));
    await page.click('[aria-label="Copy merchant ID"]');
    assert.deepEqual(await page.evaluate(()=>window.fixture.calls.at(-1)), ['copy','RLY-0000000000000000']);
    await page.evaluate(()=>window.fixture.setQuery('rly-0000000000000000')); await ready(1);
    assert.equal(await page.$eval('[data-model-center-merchant]', el => el.textContent.includes('fixture-000')), false, 'internal merchant identity must not be displayed');

    for (const locale of ['en','zh-CN','de','ar']) {
        // Park the pointer away from the cards: a hovered copy button would
        // legitimately show its own hint first.
        await page.setViewport({width:320,height:360}); await page.mouse.move(0,0); await open({locale}); await ready();
        await page.focus('[data-model-center-merchant] .nmx-mc-metrics [tabindex="0"]'); await page.waitForSelector('[role=tooltip]');
        const tooltip = await page.$eval('[role=tooltip]',el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,text:el.textContent};});
        assert.ok(tooltip.left>=12 && tooltip.right<=308 && tooltip.top>=12 && tooltip.bottom<=348, `${locale}: clipped focus tooltip`);
        assert.match(tooltip.text,/100/); await page.mouse.move(0,0);
        assert.ok(await page.$('[role=tooltip]'), 'mouse leave must not hide the keyboard-focused hint');
    }
    for (const locale of ['zh-CN', 'en']) for (const theme of ['dark', 'light']) {
        await page.setViewport({ width: 320, height: 360 }); await open({ locale, theme, long: '1' }); await ready();
        await page.click('[data-model-center-list]'); await page.waitForSelector('[data-supported-model]');
        await page.waitForFunction(() => document.querySelector('.nmx-mc-drawer').getAnimations().every(animation => animation.playState === 'finished'));
        await page.mouse.move(0, 0);
        const compact = await page.$eval('.nmx-mc-model-list', el => ({ height: el.getBoundingClientRect().height, overflow: el.scrollWidth - el.clientWidth }));
        assert.ok(compact.height >= 100, `${locale}/${theme}: long merchant name collapsed the short-window model list`);
        assert.equal(compact.overflow, 0);
        // All four anchor corners exercise the production tooltip's real measured-height placement.
        for (const [left, top] of [[0, 0], [280, 0], [0, 330], [280, 330]]) {
            await page.evaluate(({ left, top }) => { const hint = document.querySelector('.nmx-mc-model > .nmx-mc-hint');
                hint.style.position = 'fixed'; hint.style.left = left + 'px'; hint.style.top = top + 'px'; hint.style.width = '35px';
                hint.querySelector('button').focus(); }, { left, top });
            await page.waitForSelector('[role=tooltip]');
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const bounds = await page.$eval('[role=tooltip]', el => { const r = el.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom }; });
            assert.ok(bounds.left >= 12 && bounds.right <= 308 && bounds.top >= 12 && bounds.bottom <= 348, `${locale}/${theme}/${left},${top}: tooltip outside viewport ${JSON.stringify(bounds)}`);
            await page.keyboard.press('Escape');
            await page.evaluate(() => document.activeElement.blur());
        }
        await page.evaluate(() => { const hint = document.querySelector('.nmx-mc-model > .nmx-mc-hint'); hint.removeAttribute('style');
            const buttons = document.querySelectorAll('.nmx-mc-drawer button'); buttons[buttons.length - 1].focus(); });
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.closest('.nmx-mc-drawer') !== null), true, 'forward Tab stays in the model dialog');
        await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
        assert.equal(await page.evaluate(() => document.activeElement.closest('.nmx-mc-drawer') !== null), true, 'reverse Tab stays in the model dialog');
        await page.focus('.nmx-mc-drawer > header > button');
        await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.nmx-mc-drawer'));
        assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-model-center-list')), true, 'Escape restores the opening list button');
    }
    t.diagnostic('Long-name/price short-window cases, 16 measured tooltip corners, and Tab/Escape focus containment passed.');
    await page.setViewport({width:900,height:760}); await open({locale:'en',count:'205',delay:'1'}); await ready(100);
    await page.evaluate(()=>{const el=document.querySelector('.fixture-scroll');el.scrollTop=el.scrollHeight;});
    await ready(200); await page.evaluate(()=>{const el=document.querySelector('.fixture-scroll');el.scrollTop=el.scrollHeight;}); await ready(205);
    assert.equal(await page.$$eval('[data-model-center-merchant]',rows=>new Set(rows.map(row=>row.dataset.modelCenterMerchant)).size),205);
    await page.evaluate(()=>{window.fixture.setFavorites(window.fixture.merchants.map(m=>m.id));window.fixture.setView('favorites');}); await ready(205);
    assert.equal(await page.evaluate(()=>window.fixture.requests.filter(r=>r.merchantIds).at(-1).merchantIds.length),5, 'favorite IDs beyond 200 must be queried');
    await open({locale:'en'}); await ready();
    await page.evaluate(()=>window.fixture.setQuery('slow')); await page.waitForFunction(()=>window.fixture.requests.some(r=>r.query==='slow'));
    await page.evaluate(()=>window.fixture.setQuery('Synthetic Relay 2')); await ready(1);
    assert.equal(await page.$eval('[data-model-center-merchant]',el=>el.dataset.modelCenterMerchant),'fixture-001','late previous query must not overwrite current query');
    await open({locale:'en',error:'1'}); await page.waitForFunction(()=>document.querySelector('.nmx-mc-directory-status button'));
    assert.equal(await page.$$eval('[data-model-center-merchant]',rows=>rows.length),0);
    await page.click('.nmx-mc-directory-status button'); await ready();
    assert.deepEqual(errors, []);
});
