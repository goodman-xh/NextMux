import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { startModelCenterFixture } from './model-center-fixture.mjs';

const require = createRequire(import.meta.url);
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
// The desktop task runtime supplies Playwright. Reuse the Chromium already used by
// this repository's Puppeteer suites; running this test never downloads a browser.
let playwright;
try { playwright = require('playwright'); }
catch { playwright = createRequire(process.execPath)('playwright'); }
const puppeteer = (await import(platform.resolve('puppeteer'))).default;
const SEARCH = '[data-model-center-model-search]';
const ROW = '[data-supported-model]';
const LIST = '.nmx-mc-model-list';

test('merchant support search and scrolling use the real drawer in Playwright', { timeout: 90000 }, async t => {
    const fixture = await startModelCenterFixture();
    t.after(fixture.close);
    const browser = await playwright.chromium.launch({ headless: true, executablePath: await puppeteer.executablePath() });
    t.after(() => browser.close());
    const errors = [];
    async function open(options = {}) {
        const context = await browser.newContext({ viewport: { width: 1000, height: 760 } });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => new URL(route.request().url()).origin === fixture.origin
            ? route.continue() : (errors.push(`Unexpected external request: ${route.request().url()}`), route.abort()));
        await page.goto(`${fixture.origin}/?${new URLSearchParams({ locale: 'en', catalogCount: '230', catalogPageSize: '40', ...options })}`);
        await page.locator('[data-model-center-list]').first().click();
        await ready(page, 40);
        return { page, close: () => context.close() };
    }
    async function ready(page, count) {
        await page.waitForFunction(({ row, list, count }) => document.querySelectorAll(row).length === count
            && document.querySelector(list)?.getAttribute('aria-busy') === 'false', { row: ROW, list: LIST, count });
    }
    const requests = page => page.evaluate(() => window.fixture.supportRequests);
    async function scrollBottom(page) {
        const box = await page.locator(LIST).boundingBox();
        assert.ok(box && box.height > 80, 'the production model list retains a usable scroll viewport');
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, 100000);
    }

    await t.test('explicit multi-capability models retain both labels while image models keep Image across filters and pages', async sub => {
        const { page, close } = await open({ mixedModalities: '1' }); sub.after(close);
        const category = name => page.locator('.nmx-mc-model-categories').getByRole('button', { name, exact: true });
        const label = id => page.locator(`[data-supported-model="${id}"] .nmx-mc-model-name > small`);
        assert.equal(await label('model-001').innerText(), 'Language / Image · 3×', 'this fixture explicitly declares tools, reasoning and image_generation; both task labels retain the same price');
        assert.match(await label('model-002').innerText(), /^Image ·/, 'GPT Image remains an image model despite text output');
        assert.equal(await page.locator('[data-supported-model="model-041"]').count(), 0, 'GPT-5.5 Pro starts beyond the first page');

        await category('Language').click();
        await page.waitForFunction(() => window.fixture.supportRequests.at(-1)?.category === 'language');
        await ready(page, 40);
        assert.equal(await page.locator('[data-supported-model="model-002"]').count(), 0);
        assert.equal(await page.locator('[data-supported-model="model-041"]').count(), 0);
        await scrollBottom(page); await ready(page, 80);
        assert.equal(await label('model-041').innerText(), 'Language / Image · 3×', 'the continuation page preserves both explicit capabilities and the price');
        assert.equal(await page.locator(ROW).evaluateAll(rows => new Set(rows.map(row => row.dataset.supportedModel)).size), 80);
        assert.equal(await page.locator(`${ROW} .nmx-mc-model-name > small`).evaluateAll(labels => labels.every(label => /^Language(?: \/ Image)? ·/.test(label.textContent))), true);
        assert.deepEqual({ category: (await requests(page)).at(-1).category, after: (await requests(page)).at(-1).after }, { category: 'language', after: 'support-40' });

        await page.locator(SEARCH).fill('GPT5.5'); await ready(page, 2);
        assert.deepEqual(await page.locator(ROW).evaluateAll(rows => rows.map(row => row.dataset.supportedModel)), ['model-001', 'model-041']);
        assert.equal((await requests(page)).at(-1).after, undefined, 'search restarts the filtered catalog at its first page');
        await category('Image').click();
        await page.waitForFunction(() => window.fixture.supportRequests.at(-1)?.category === 'image');
        await ready(page, 0);
        assert.deepEqual({ category: (await requests(page)).at(-1).category, search: (await requests(page)).at(-1).search }, { category: 'image', search: 'GPT5.5' });

        await page.locator(SEARCH).fill(''); await ready(page, 2);
        assert.deepEqual(await page.locator(ROW).evaluateAll(rows => rows.map(row => row.dataset.supportedModel)), ['model-002', 'model-042']);
        assert.match(await label('model-002').innerText(), /^Image ·/);
        assert.match(await label('model-042').innerText(), /^Image ·/, 'tools and reasoning do not override the authoritative image kind');
        await page.locator(SEARCH).fill('GPT Image'); await ready(page, 1);
        assert.equal(await page.locator(ROW).getAttribute('data-supported-model'), 'model-002');
        assert.equal(await page.locator(SEARCH).evaluate(input => document.activeElement === input), true);
    });

    await t.test('search finds models beyond loaded pages; NFKC multiword IME commits once and preserves focus', async sub => {
        const { page, close } = await open(); sub.after(close);
        assert.equal(await page.locator('[data-supported-model="model-205"]').count(), 0);
        assert.equal((await requests(page)).length, 1, 'the target is beyond the only loaded page');
        await page.locator(SEARCH).fill('中文 ｇｐｔ４');
        await ready(page, 2);
        assert.deepEqual(await page.locator(ROW).evaluateAll(rows => rows.map(row => row.dataset.supportedModel)), ['model-205', 'model-209']);
        assert.equal(await page.locator(SEARCH).inputValue(), '中文 ｇｐｔ４');
        assert.equal(await page.locator(SEARCH).evaluate(input => document.activeElement === input), true);
        assert.equal((await requests(page)).at(-1).search, '中文 ｇｐｔ４', 'the whole query reaches the service, rather than filtering only loaded rows');

        await page.locator(SEARCH).fill(''); await ready(page, 40);
        const before = (await requests(page)).length;
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Input.imeSetComposition', { text: 'zhong', selectionStart: 5, selectionEnd: 5 });
        await page.waitForTimeout(360);
        assert.equal((await requests(page)).length, before, 'intermediate pinyin must not reach the service');
        await cdp.send('Input.imeSetComposition', { text: '中文', selectionStart: 2, selectionEnd: 2 });
        await page.waitForTimeout(360);
        assert.equal((await requests(page)).length, before, 'uncommitted Chinese composition must not reach the service');
        await cdp.send('Input.insertText', { text: '中文' });
        await page.keyboard.type(' GPT4');
        await ready(page, 2);
        assert.equal(await page.locator(SEARCH).inputValue(), '中文 GPT4');
        assert.deepEqual((await requests(page)).slice(before).map(request => request.search), ['中文 GPT4']);
        assert.equal(await page.locator(SEARCH).evaluate(input => document.activeElement === input), true);

        await page.locator('.nmx-mc-model-categories').getByRole('button', { name: 'Language', exact: true }).click();
        await page.waitForFunction(() => window.fixture.supportRequests.at(-1)?.category === 'language');
        await ready(page, 0);
        assert.deepEqual({ search: (await requests(page)).at(-1).search, category: (await requests(page)).at(-1).category }, { search: '中文 GPT4', category: 'language' });
        await page.locator('.nmx-mc-model-categories').getByRole('button', { name: 'Video', exact: true }).click();
        await page.waitForFunction(() => window.fixture.supportRequests.at(-1)?.category === 'video');
        await ready(page, 2);
        assert.equal((await requests(page)).at(-1).category, 'video', 'category is applied to the entire service catalog');
    });

    await t.test('slow previous query and closed merchant responses cannot replace the current results', async sub => {
        const { page, close } = await open(); sub.after(close);
        await page.evaluate(() => window.fixture.holdSupport('Synthetic'));
        await page.locator(SEARCH).fill('Synthetic');
        await page.waitForFunction(() => window.fixture.supportRequests.some(request => request.search === 'Synthetic'));
        await page.locator(SEARCH).fill('中文 GPT4'); await ready(page, 2);
        await page.evaluate(() => window.fixture.releaseSupport('Synthetic'));
        await page.waitForTimeout(100);
        await ready(page, 2);
        assert.equal(await page.locator(SEARCH).inputValue(), '中文 GPT4');
        assert.equal(await page.locator(SEARCH).evaluate(input => document.activeElement === input), true);

        await page.evaluate(() => window.fixture.holdSupport('Aurora'));
        await page.locator(SEARCH).fill('Aurora');
        await page.waitForFunction(() => window.fixture.supportRequests.some(request => request.search === 'Aurora'));
        await page.locator('.nmx-mc-drawer > header > button').click();
        await page.locator('.nmx-mc-drawer').waitFor({ state: 'detached' });
        await page.locator('[data-model-center-merchant="fixture-001"] [data-model-center-list]').click();
        await ready(page, 40);
        await page.evaluate(() => window.fixture.releaseSupport('Aurora'));
        await page.waitForTimeout(100); await ready(page, 40);
        assert.equal(await page.locator(SEARCH).inputValue(), '', 'a different merchant starts with a clean search');
        assert.equal((await requests(page)).at(-1).catalog, 'fixture-001');
    });

    await t.test('actual wheel scrolling loads every cursor once and stops at the final page', async sub => {
        const { page, close } = await open(); sub.after(close);
        for (const count of [80, 120, 160, 200, 230]) { await scrollBottom(page); await ready(page, count); }
        assert.equal(await page.locator(ROW).evaluateAll(rows => new Set(rows.map(row => row.dataset.supportedModel)).size), 230);
        const cursors = (await requests(page)).map(request => request.after || 'first');
        assert.deepEqual(cursors, ['first', 'support-40', 'support-80', 'support-120', 'support-160', 'support-200']);
        await scrollBottom(page); await page.waitForTimeout(500);
        assert.deepEqual((await requests(page)).map(request => request.after || 'first'), cursors, 'a visible final sentinel cannot create a request loop');
        assert.equal(await page.locator('[data-model-center-model-more]').count(), 0);
    });

    await t.test('failed continuation preserves rows and retries its cursor only after explicit action', async sub => {
        const { page, close } = await open(); sub.after(close);
        await page.evaluate(() => window.fixture.failSupportAfter('support-40'));
        await scrollBottom(page);
        await page.locator('[data-model-center-model-retry]').waitFor();
        await ready(page, 40);
        assert.deepEqual((await requests(page)).map(request => request.after || 'first'), ['first', 'support-40']);
        await page.waitForTimeout(500);
        assert.equal((await requests(page)).length, 2, 'IntersectionObserver must pause while the failed page remains in view');
        await page.locator('[data-model-center-model-retry]').click(); await ready(page, 80);
        assert.deepEqual((await requests(page)).map(request => request.after || 'first'), ['first', 'support-40', 'support-40'], 'retry must not restart at page one or lose earlier rows');
        assert.equal(await page.locator('[data-model-center-model-retry]').count(), 0);
    });

    await t.test('expired snapshot retries a forced first page without combining incompatible rows', async sub => {
        const { page, close } = await open(); sub.after(close);
        await page.evaluate(() => window.fixture.failSupportAfter('support-40', 1, 'merchant_catalog_cursor_stale'));
        await scrollBottom(page); await page.locator('[data-model-center-model-retry]').waitFor();
        await ready(page, 0);
        await page.waitForTimeout(400);
        assert.equal((await requests(page)).length, 2, 'an expired snapshot must wait for explicit retry');
        await page.locator('[data-model-center-model-retry]').click(); await ready(page, 40);
        const latest = (await requests(page)).at(-1);
        assert.equal(latest.after, undefined, 'expired cursors restart at page one');
        assert.equal(latest.force, true, 'retry must bypass a cached first page carrying the expired snapshot');
        assert.equal((await requests(page)).length, 3);
    });

    await t.test('stalled cursors stop, manual retry recovers, and search participates in modal keyboard focus', async sub => {
        const { page, close } = await open(); sub.after(close);
        await page.evaluate(() => window.fixture.repeatSupportCursor(true));
        await scrollBottom(page); await page.locator('[data-model-center-model-retry]').waitFor();
        await ready(page, 40);
        await page.waitForTimeout(500);
        assert.equal((await requests(page)).length, 2, 'a repeated cursor is an error, not an automatic pagination loop');
        await page.evaluate(() => window.fixture.repeatSupportCursor(false));
        await page.locator('[data-model-center-model-retry]').click(); await ready(page, 80);
        await page.locator(SEARCH).focus();
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => !!document.activeElement.closest('.nmx-mc-drawer')), true);
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.locator(SEARCH).evaluate(input => document.activeElement === input), true, 'reverse tab returns to the real search input');
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 });
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.nmx-mc-drawer').count(), 1, 'IME Escape must not close the drawer');
        await cdp.send('Input.insertText', { text: '你' });
        await page.keyboard.press('Escape');
        await page.locator('.nmx-mc-drawer').waitFor({ state: 'detached' });
        assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-model-center-list')), true, 'closing restores focus to the actual opening button');
    });
    assert.deepEqual(errors, []);
});
