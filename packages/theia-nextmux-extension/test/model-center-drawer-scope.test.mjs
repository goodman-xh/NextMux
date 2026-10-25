import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { startModelCenterFixture } from './model-center-fixture.mjs';

const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const puppeteer = (await import(platform.resolve('puppeteer'))).default;
const shots = new URL('file:///tmp/nm-shots/model-center/');

// §6.1: the supported-model drawer is confined to the Model Center tab (never
// over the titlebar tabs or the page header), stays in view after scrolling,
// animates open/closed, and a delisted favorite is shown disabled with a
// remove action instead of breaking the list.
test('Model Center drawer scope, delisted favorites and centered loading in real Chromium (light/dark, zh-CN/en, narrow/wide)', { timeout: 240000 }, async t => {
    await mkdir(shots, { recursive: true });
    const fixture = await startModelCenterFixture(); t.after(fixture.close);
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => new URL(request.url()).origin === fixture.origin ? void request.continue() : (errors.push('Blocked external request'), void request.abort()));
    const open = params => page.goto(`${fixture.origin}/?${new URLSearchParams(params)}`, { waitUntil: 'load' });
    const ready = count => page.waitForFunction(expected => document.querySelectorAll('[data-model-center-merchant]').length === expected
        && document.querySelector('.nmx-mc-merchants')?.getAttribute('aria-busy') === 'false', {}, count);
    const rect = selector => page.$eval(selector, el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; });
    for (const theme of ['light', 'dark']) for (const locale of ['zh-CN', 'en']) for (const [width, height] of [[380, 640], [1280, 800]]) {
        const label = `${theme}-${locale}-${width}x${height}`;
        await page.setViewport({ width, height }); await page.mouse.move(0, 0);
        await open({ locale, theme, count: '40' }); await ready(40);
        await page.evaluate(() => { const el = document.querySelector('.fixture-scroll'); el.scrollTop = el.scrollHeight; });
        const catalogBefore = await page.evaluate(() => window.fixture.requests.filter(request => request.catalog).length);
        await page.evaluate(() => [...document.querySelectorAll('[data-model-center-list]')].at(-1).click());
        await page.waitForFunction(() => document.querySelectorAll('[data-supported-model]').length === 3);
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 260)));
        assert.equal(await page.evaluate(() => window.fixture.requests.filter(request => request.catalog).length) - catalogBefore, 1,
            `${label}: the drawer mounts once in its layer and fetches the catalog once`);
        const [drawer, scroll, topbar, titlebar] = await Promise.all(['.nmx-mc-drawer', '.fixture-scroll', '.fixture-topbar', '.fixture-titlebar'].map(rect));
        assert.ok(drawer.top >= scroll.top - 1 && drawer.top >= topbar.bottom - 1 && drawer.top >= titlebar.bottom - 1, `${label}: drawer covers the tabs/header ${JSON.stringify({ drawer, topbar })}`);
        assert.ok(drawer.bottom <= height + 1 && drawer.height >= Math.min(300, scroll.height - 2), `${label}: drawer not fully in view after scrolling ${JSON.stringify(drawer)}`);
        assert.ok(drawer.left >= 0 && drawer.right <= width + 1, `${label}: horizontal overflow`);
        const backdrop = await rect('.nmx-mc-drawer-backdrop');
        assert.ok(Math.abs(backdrop.top - scroll.top) <= 1 && Math.abs(backdrop.bottom - scroll.bottom) <= 1, `${label}: backdrop is not the tab content area`);
        assert.equal(await page.$eval('.nmx-mc-drawer', el => getComputedStyle(el).animationName), 'nmx-mc-sheet-in', `${label}: open transition`);
        await page.screenshot({ path: new URL(`drawer-${label}.png`, shots).pathname });
        await page.evaluate(() => { window.sawClosing = false; const observer = new MutationObserver(() => {
            if (document.querySelector('.nmx-mc-drawer-backdrop.is-closing')) { window.sawClosing = true; observer.disconnect(); } });
            observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] }); });
        await page.focus('.nmx-mc-drawer > header > button'); await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('.nmx-mc-drawer'));
        assert.equal(await page.evaluate(() => window.sawClosing), true, `${label}: exit transition plays before unmount`);

        await open({ locale, theme }); await ready(2);
        await page.evaluate(() => { window.fixture.setFavoriteEntries([['fixture-000', 'Synthetic Research Collective'], ['retired-relay', 'Retired Relay Studio']]); window.fixture.setView('favorites'); });
        await page.waitForSelector('[data-model-center-delisted="retired-relay"]'); await ready(1);
        const delisted = await page.$eval('[data-model-center-delisted="retired-relay"]', el => ({ text: el.textContent, disabled: el.getAttribute('aria-disabled'),
            name: getComputedStyle(el.querySelector('strong')).color, border: getComputedStyle(el).borderTopStyle, button: el.querySelector('button').textContent }));
        assert.match(delisted.text, locale === 'zh-CN' ? /已下架/ : /Delisted/, label);
        assert.equal(delisted.disabled, 'true'); assert.equal(delisted.border, 'dashed');
        assert.match(delisted.button, locale === 'zh-CN' ? /取消收藏/ : /Remove from favorites/);
        await page.screenshot({ path: new URL(`favorites-delisted-${label}.png`, shots).pathname });
        await page.click('[data-model-center-delisted="retired-relay"] button');
        assert.deepEqual(await page.evaluate(() => window.fixture.calls.at(-1)), ['favorite', 'retired-relay']);
        await page.waitForFunction(() => !document.querySelector('[data-model-center-delisted]'));

        await open({ locale, theme, delay: '2500' });
        await page.waitForSelector('.nmx-mc-directory-status.is-initial .codicon-loading');
        const { status, scrollArea, spinner } = await page.evaluate(() => {
            const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { top: r.top, height: r.height, bottom: r.bottom }; };
            return { status: box('.nmx-mc-directory-status.is-initial'), scrollArea: box('.fixture-scroll'), spinner: box('.nmx-mc-directory-status.is-initial .codicon-loading') };
        });
        const center = spinner.top + spinner.height / 2;
        assert.ok(center > scrollArea.top + scrollArea.height * .2 && center < scrollArea.top + scrollArea.height * .7, `${label}: loading is not near the visual center ${JSON.stringify({ spinner, scrollArea, status })}`);
        await ready(2);
    }
    assert.deepEqual(errors, []);
});
