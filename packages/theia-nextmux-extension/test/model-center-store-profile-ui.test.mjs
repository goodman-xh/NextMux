import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { startModelCenterFixture } from './model-center-fixture.mjs';

const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const puppeteer = (await import(platform.resolve('puppeteer'))).default;
const shots = new URL('file:///tmp/nm-shots/model-center/');

// Directory intros always reserve two lines, showing a localized fallback for empty profiles.
// The model drawer still shows only real profile content, clamped to four lines with a working toggle.
test('Model Center store profile in real Chromium (light/dark, zh-CN/en/ar, narrow/wide)', { timeout: 240000 }, async t => {
    await mkdir(shots, { recursive: true });
    const fixture = await startModelCenterFixture(); t.after(fixture.close);
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const theme of ['light', 'dark']) for (const locale of ['zh-CN', 'en', 'ar']) for (const [width, height] of [[380, 640], [1280, 800]]) {
        const label = `store-${theme}-${locale}-${width}x${height}`;
        await page.setViewport({ width, height }); await page.mouse.move(0, 0);
        await page.goto(`${fixture.origin}/?${new URLSearchParams({ locale, theme, count: '3', store: '1' })}`, { waitUntil: 'load' });
        await page.waitForFunction(() => document.querySelectorAll('[data-model-center-merchant]').length === 3
            && document.querySelector('.nmx-mc-merchants')?.getAttribute('aria-busy') === 'false');
        await page.evaluate(() => {
            window.fixture.merchants[0].storeTagline = '官方直连' + '稳定可靠的模型服务'.repeat(6);
            window.fixture.merchants[1].storeTagline = '  Short intro  ';
            window.fixture.setFavorites([]);
        });
        await page.waitForFunction(() => document.querySelector('[data-testid="mc-store-tagline-fixture-001"]')?.textContent.trim() === 'Short intro');
        const emptyIntro = locale === 'zh-CN' ? '暂无简介' : locale === 'en' ? 'No description yet' : 'لا يوجد وصف بعد';
        for (const layout of ['list', 'grid']) {
            await page.click(`[data-model-center-layout="${layout}"]`);
            const cards = await page.$$eval('[data-model-center-merchant]', nodes => nodes.map(node => {
                const tagline = node.querySelector('.nmx-mc-tagline');
                if (!tagline) return undefined;
                const box = tagline.getBoundingClientRect(); const card = node.getBoundingClientRect();
                const style = getComputedStyle(tagline); const range = document.createRange(); range.selectNodeContents(tagline);
                const visibleLines = new Set([...range.getClientRects()].filter(rect => rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1).map(rect => rect.top)).size;
                return { text: tagline.textContent.trim(), height: box.height, cardHeight: card.height,
                    lines: box.height / parseFloat(style.lineHeight), visibleLines, clamp: style.webkitLineClamp,
                    empty: tagline.classList.contains('is-empty'), opacity: style.opacity,
                    testId: tagline.dataset.testid, id: node.dataset.modelCenterMerchant,
                    inside: box.left >= card.left - 1 && box.right <= card.right + 1,
                    overflow: style.overflow, clipped: tagline.scrollHeight > tagline.clientHeight + 1 };
            }));
            assert.equal(cards.filter(Boolean).length, 3, `${label}/${layout}: every merchant has an intro row`);
            assert.equal(cards[1].text, 'Short intro', `${label}/${layout}: intro whitespace is trimmed`);
            assert.equal(cards[1].visibleLines, 1, `${label}/${layout}: the short intro uses one of the two reserved lines`);
            assert.equal(cards[2].text, emptyIntro, `${label}/${layout}: empty profiles have localized fallback copy`);
            assert.equal(cards[2].empty, true, `${label}/${layout}: empty profiles are marked`);
            assert.equal(cards[2].opacity, '0.68', `${label}/${layout}: empty copy is muted`);
            assert.ok(cards.slice(0, 2).every(card => !card.empty), `${label}/${layout}: real intros are not marked empty`);
            for (const card of cards) {
                assert.ok(Math.abs(card.lines - 2) < 0.01, `${label}/${layout}: intro reserves exactly two lines`);
                assert.ok(card.visibleLines >= 1 && card.visibleLines <= 2, `${label}/${layout}: intro displays at most two lines`);
                assert.equal(card.clamp, '2', `${label}/${layout}: extra lines are clamped`);
                assert.equal(card.overflow, 'hidden', `${label}/${layout}: extra text is clipped`);
                assert.equal(card.testId, `mc-store-tagline-${card.id}`);
                assert.ok(card.inside, `${label}/${layout}: intro stays within its card`);
                assert.ok(Math.abs(card.height - cards[0].height) < 0.1, `${label}/${layout}: empty, one-line and two-line intros have equal height`);
                assert.ok(Math.abs(card.cardHeight - cards[0].cardHeight) < 0.1, `${label}/${layout}: empty, one-line and two-line cards have equal height`);
            }
            if (layout === 'grid' || width < 500) {
                assert.equal(cards[0].visibleLines, 2, `${label}/${layout}: a long intro fills both lines`);
                if (width < 500) assert.ok(cards[0].clipped, `${label}/${layout}: a long intro is truncated after two lines`);
            }
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `${label}/${layout}: no horizontal page overflow`);
            await page.screenshot({ path: new URL(`${label}-${layout}.png`, shots).pathname });
        }
        await page.hover('[data-testid="mc-store-tagline-fixture-001"]');
        await page.waitForSelector('.nmx-mc-tooltip');
        assert.equal(await page.$eval('.nmx-mc-tooltip', node => node.textContent), 'Synthetic Relay 2 · Short intro');
        await page.mouse.move(0, 0);
        await page.evaluate(() => {
            window.fixture.merchants[1].storeTagline = '';
            window.fixture.merchants[1].storeDescription = '  Description-only intro  ';
            window.fixture.setFavorites([]);
        });
        await page.waitForFunction(() => document.querySelector('[data-testid="mc-store-tagline-fixture-001"]')?.textContent.trim() === 'Description-only intro');
        assert.equal(await page.$eval('[data-testid="mc-store-tagline-fixture-001"]', node => node.classList.contains('is-empty')), false);
        await page.evaluate(() => {
            window.fixture.merchants[1].storeDescription = ' \n ';
            window.fixture.setFavorites([]);
        });
        await page.waitForFunction(expected => document.querySelector('[data-testid="mc-store-tagline-fixture-001"]')?.textContent.trim() === expected, {}, emptyIntro);
        assert.equal(await page.$eval('[data-testid="mc-store-tagline-fixture-001"]', node => node.classList.contains('is-empty')), true);

        await page.evaluate(() => document.querySelector('[data-model-center-list]').click());
        await page.waitForSelector('.nmx-mc-store');
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 260)));
        const store = await page.$eval('.nmx-mc-store', node => {
            const description = node.querySelector('.nmx-mc-store-description');
            return { tagline: node.querySelector('.nmx-mc-store-tagline')?.textContent, clamped: description.scrollHeight > description.clientHeight + 1,
                lines: Math.round(description.clientHeight / parseFloat(getComputedStyle(description).lineHeight)),
                toggle: node.querySelector('.nmx-mc-store-toggle')?.getAttribute('aria-expanded'),
                inside: (() => { const r = node.getBoundingClientRect(); const d = node.closest('.nmx-mc-drawer').getBoundingClientRect(); return r.left >= d.left - 1 && r.right <= d.right + 1; })() };
        });
        assert.match(store.tagline, /官方直连/, `${label}: drawer shows the tagline`);
        assert.ok(store.clamped && store.lines <= 4, `${label}: long description is clamped to four lines ${JSON.stringify(store)}`);
        assert.equal(store.toggle, 'false', `${label}: a toggle offers the rest of the description`);
        assert.ok(store.inside, `${label}: store section overflows the drawer`);
        await page.screenshot({ path: new URL(`${label}-drawer.png`, shots).pathname });
        await page.click('.nmx-mc-store-toggle');
        const expanded = await page.$eval('.nmx-mc-store', node => ({ toggle: node.querySelector('.nmx-mc-store-toggle').getAttribute('aria-expanded'),
            full: (() => { const d = node.querySelector('.nmx-mc-store-description'); return d.scrollHeight <= d.clientHeight + 1 || getComputedStyle(d).overflowY === 'auto'; })() }));
        assert.deepEqual(expanded, { toggle: 'true', full: true }, `${label}: expanding shows the whole description`);
        assert.equal(await page.$eval('.nmx-mc-store-toggle', node => node.textContent), locale === 'zh-CN' ? '收起' : locale === 'en' ? 'Show less' : 'عرض أقل');
        await page.focus('.nmx-mc-drawer > header > button'); await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('.nmx-mc-drawer'));

        // The merchant without a profile gets no store section at all.
        await page.evaluate(() => [...document.querySelectorAll('[data-model-center-list]')].at(-1).click());
        await page.waitForSelector('[data-supported-model]');
        assert.equal(await page.$('.nmx-mc-store'), null, `${label}: no empty store section`);
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('.nmx-mc-drawer'));
    }
    assert.deepEqual(errors, []);
});
