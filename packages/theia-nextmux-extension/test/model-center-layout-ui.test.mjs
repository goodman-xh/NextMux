import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { startModelCenterFixture } from './model-center-fixture.mjs';

const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const puppeteer = (await import(platform.resolve('puppeteer'))).default;
const preferenceKey = 'nextmux.desktop.modelCenterLayout.v2';
const list = '[data-model-center-layout="list"]';
const grid = '[data-model-center-layout="grid"]';
const settled = page => page.waitForFunction(() => document.querySelector('.nmx-mc-merchants')?.getAttribute('aria-busy') === 'false');
const selected = (page, value) => page.$eval(`[data-model-center-layout="${value}"]`, node => node.getAttribute('aria-pressed'));

test('merchant layout defaults to grid, persists locally, and stays independent of category, sort, favorites and support', { timeout: 90000 }, async t => {
    const fixture = await startModelCenterFixture(); t.after(fixture.close);
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(`${fixture.origin}/?count=5&store=1`); await settled(page);
    assert.equal(await selected(page, 'grid'), 'true');
    assert.ok(await page.$$eval('[data-model-center-merchant]', nodes => nodes[0].getBoundingClientRect().top === nodes[1].getBoundingClientRect().top
        && nodes[1].getBoundingClientRect().left > nodes[0].getBoundingClientRect().right), 'grid uses multiple real columns');
    assert.deepEqual(await page.$$eval('.nmx-mc-directory-controls button', nodes => nodes.slice(-3).map(node => node.getAttribute('aria-label'))), ['Reverse sort order', 'List view', 'Grid view']);
    const callsBefore = await page.evaluate(() => window.fixture.requests.length);
    await page.focus(list); await page.keyboard.press('Enter');
    assert.equal(await selected(page, 'list'), 'true');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), preferenceKey), 'list');
    assert.equal(await page.evaluate(() => window.fixture.requests.length), callsBefore, 'layout does not request a new directory or catalog');
    assert.deepEqual(await page.$$eval('[data-model-center-merchant]', nodes => nodes.map(node => Math.round(node.getBoundingClientRect().left))), [16, 16, 16, 16, 16]);
    await page.focus(grid); await page.keyboard.press('Enter');
    assert.equal(await selected(page, 'grid'), 'true');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), preferenceKey), 'grid');
    assert.ok(await page.$$eval('[data-model-center-merchant]', nodes => nodes[0].getBoundingClientRect().top === nodes[1].getBoundingClientRect().top
        && nodes[1].getBoundingClientRect().left > nodes[0].getBoundingClientRect().right), 'grid uses multiple real columns');

    // Every capability tab shares the same layout while its own query is still sent.
    for (const capability of ['all', 'coding', 'reasoning', 'image', 'video', 'audio']) {
        await page.evaluate(value => window.fixture.setCapability(value), capability);
        await page.waitForFunction(value => window.fixture.requests.at(-1)?.capability === value, {}, capability); await settled(page);
        assert.equal(await selected(page, 'grid'), 'true', capability);
    }
    await page.click('.nmx-mc-sort button[aria-label="Reverse sort order"]');
    await page.waitForFunction(() => window.fixture.requests.at(-1)?.direction === 'asc'); await settled(page);
    assert.equal(await selected(page, 'grid'), 'true');
    await page.click('.nmx-mc-sort button[aria-label="Reverse sort order"]');
    await page.waitForFunction(() => window.fixture.requests.at(-1)?.direction === 'desc'); await settled(page);
    await page.evaluate(() => { window.fixture.setFavorites(['fixture-000', 'fixture-002']); window.fixture.setView('favorites'); });
    await page.waitForFunction(() => document.querySelectorAll('[data-model-center-merchant]').length === 2); await settled(page);
    assert.equal(await selected(page, 'grid'), 'true');
    await page.click('[data-model-center-merchant="fixture-000"] [data-model-center-list]'); await page.waitForSelector('[data-supported-model]');
    assert.ok(await page.$('.nmx-mc-store'), 'store and support drawer still open from a grid card');
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.nmx-mc-drawer'));
    await page.click('[data-model-center-favorite="fixture-000"]');
    await page.waitForFunction(() => document.querySelectorAll('[data-model-center-merchant]').length === 1); await settled(page);

    await page.reload(); await settled(page);
    assert.equal(await selected(page, 'grid'), 'true', 'saved choice survives a new component/document');
    const callsAfterReload = await page.evaluate(() => window.fixture.requests.length);
    await page.click(list);
    assert.equal(await selected(page, 'list'), 'true');
    assert.equal(await page.evaluate(() => window.fixture.requests.length), callsAfterReload);
    await page.reload(); await settled(page);
    assert.equal(await selected(page, 'list'), 'true', 'switching back is also persisted');
    await page.evaluate(key => localStorage.setItem(key, 'obsolete'), preferenceKey);
    await page.reload(); await settled(page);
    assert.equal(await selected(page, 'grid'), 'true', 'invalid old preferences keep the default usable');
    assert.deepEqual(errors, []);
});

test('layout controls stay fixed on hover and localize without overflow in light/dark, RTL and narrow windows', { timeout: 180000 }, async t => {
    const fixture = await startModelCenterFixture(); t.after(fixture.close);
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const labels = { en: 'Grid view', 'zh-CN': '宫格视图', 'zh-TW': '宮格檢視', ja: 'グリッド表示', ko: '격자 보기', es: 'Vista de cuadrícula',
        fr: 'Vue en grille', de: 'Rasteransicht', 'pt-BR': 'Exibição em grade', ru: 'Сетка', ar: 'عرض الشبكة', hi: 'ग्रिड दृश्य' };
    const shots = new URL('file:///tmp/nm-shots/model-center-layout/'); await mkdir(shots, { recursive: true });
    for (const theme of ['light', 'dark']) for (const [locale, label] of Object.entries(labels)) for (const width of [320, 1280]) {
        await page.setViewport({ width, height: 800 }); await page.mouse.move(0, 0);
        await page.goto(`${fixture.origin}/?${new URLSearchParams({ theme, locale, count: '5', long: '1', store: '1' })}`); await settled(page);
        await page.click(grid); await page.mouse.move(0, 0);
        assert.deepEqual(await page.$eval(grid, node => [node.getAttribute('aria-label'), node.getAttribute('aria-pressed')]), [label, 'true']);
        const before = await page.$eval(grid, node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
        await page.hover(grid); await page.waitForSelector('.nmx-mc-tooltip');
        assert.deepEqual(await page.$eval(grid, node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }), before, `${locale}/${width}: hover cannot stretch or shift the control`);
        assert.equal(await page.$eval('.nmx-mc-tooltip', node => node.textContent), label);
        const bounds = await page.evaluate(() => [...document.querySelectorAll('.nmx-mc-directory-controls button, [data-model-center-merchant], .nmx-mc-tooltip')].map(node => {
            const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, within: r.left >= -1 && r.right <= innerWidth + 1 };
        }));
        assert.ok(bounds.every(item => item.within), `${theme}/${locale}/${width}: ${JSON.stringify(bounds)}`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        if (['zh-CN', 'ar'].includes(locale)) await page.screenshot({ path: new URL(`${theme}-${locale}-${width}.png`, shots).pathname });
    }
    assert.deepEqual(errors, []);
});
