import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import test from 'node:test';
import { PANELS, startSettingsFixture } from './settings-fixture-harness.mjs';

// Every Settings tab (§6.8, §6.5) rendered through the production
// renderSettings + navigation with all production stylesheets, in real
// Chromium (fixture: settings-fixture-harness.mjs). Each tab is reached by
// clicking its navigation button; every visible control must be reachable
// (non-zero box, inside the viewport horizontally), rounded (no square
// “rigid” controls), have a hover transition, and no locale may show an
// untranslated or placeholder label.
test('every settings tab renders, is reachable and has soft (rounded, transitioned) controls in real Chromium', { timeout: 420000 }, async t => {
    const { origin, server, puppeteer } = await startSettingsFixture();
    t.after(() => new Promise(resolve => server.close(resolve)));
    await mkdir('/tmp/nm-shots/settings-all', { recursive: true });
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const problems = [];
    for (const theme of ['light', 'dark']) for (const locale of ['zh-CN', 'en']) for (const [width, height] of [[760, 760], [1280, 820]]) {
        await page.setViewport({ width, height });
        await page.goto(`${origin}/?${new URLSearchParams({ theme, locale, panel: 'profile' })}`, { waitUntil: 'load' });
        await page.waitForFunction(() => Number(document.body.dataset.localized || 0) > 0);
        for (const panel of PANELS) {
            const label = `${panel}-${theme}-${locale}-${width}`;
            const before = await page.evaluate(() => Number(document.body.dataset.localized || 0));
            await page.click(`[data-settings-panel="${panel}"]`);
            await page.waitForFunction(value => Number(document.body.dataset.localized || 0) > value, {}, before);
            await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 260)));
            const report = await page.evaluate(viewport => {
                const scope = document.querySelector('.nmx-settings-page');
                const controls = [...scope.querySelectorAll('button, select, input:not([type=checkbox]):not([type=radio]), textarea, summary')].filter(node => {
                    const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(node).visibility !== 'hidden';
                });
                const square = controls.filter(node => {
                    const style = getComputedStyle(node);
                    const bordered = parseFloat(style.borderTopWidth) > 0 || !/rgba\(0, 0, 0, 0\)|transparent/.test(style.backgroundColor);
                    return bordered && parseFloat(style.borderTopLeftRadius) < 4 && node.tagName !== 'SUMMARY';
                }).map(node => `${node.tagName.toLowerCase()}.${String(node.className).split(' ')[0]}:${(node.textContent || node.getAttribute('aria-label') || '').trim().slice(0, 24)}`);
                const rigid = controls.filter(node => node.tagName === 'BUTTON' && !node.disabled).filter(node => {
                    const style = getComputedStyle(node); return style.transitionDuration.split(',').every(value => parseFloat(value) === 0);
                }).map(node => `${String(node.className).split(' ')[0]}:${(node.textContent || node.getAttribute('aria-label') || '').trim().slice(0, 24)}`);
                const outside = controls.filter(node => { const box = node.getBoundingClientRect(); return box.right > viewport + 1 || box.left < -1; })
                    .map(node => (node.textContent || '').trim().slice(0, 24));
                return { heading: document.querySelector('.nmx-settings-heading h2')?.textContent || '', controls: controls.length, square, rigid, outside,
                    pageWidth: document.documentElement.scrollWidth, text: scope.innerText };
            }, width);
            const check = (ok, message) => { if (!ok) problems.push(`${label}: ${message}`); };
            check(report.heading, 'title');
            check(report.controls > 0, 'interactive controls');
            check(!report.outside.length, `controls outside the viewport ${JSON.stringify(report.outside)}`);
            check(report.pageWidth <= width, `horizontal overflow ${report.pageWidth}`);
            check(!report.square.length, `square (rigid) controls ${JSON.stringify(report.square)}`);
            check(!report.rigid.length, `buttons without a hover transition ${JSON.stringify(report.rigid)}`);
            check(!/desktop action/.test(report.text), 'placeholder translation');
            // Language names stay in their own script (简体中文, 繁體中文, 日本語), like every OS language picker.
            const translatable = report.text.split('\n').filter(line => !/^(简体中文|繁體中文|日本語)$/u.test(line.trim())).join('\n');
            if (locale === 'en') check(!/[\p{Script=Han}]/u.test(translatable), `untranslated Chinese ${JSON.stringify(translatable.match(/[^\n]*[\p{Script=Han}][^\n]*/gu)?.slice(0, 4))}`);
            await page.screenshot({ path: `/tmp/nm-shots/settings-all/${label}.png` });
        }
    }
    assert.deepEqual(problems, []);
    // Wiring: a representative control on each tab reaches its production handler.
    await page.setViewport({ width: 1280, height: 820 });
    await page.goto(`${origin}/?${new URLSearchParams({ theme: 'light', locale: 'en', panel: 'permissions' })}`, { waitUntil: 'load' });
    await page.waitForFunction(() => Number(document.body.dataset.localized || 0) > 0);
    await page.click('.nmx-permission-options button:nth-child(2)');
    assert.deepEqual(await page.evaluate(() => window.fixture.calls.at(-1)), ['permission', 'workspace_write']);
    await page.click('[data-settings-panel="system"]');
    await page.click('.nmx-microphone-select select');
    assert.deepEqual(await page.evaluate(() => window.fixture.calls.at(-1)), ['microphones', false], 'microphone list refreshes on every click');
    await page.keyboard.press('Escape');
    await page.click('[data-settings-panel="updates"]');
    await page.click('.nmx-update-settings .nmx-settings-actions button.is-primary');
    assert.deepEqual(await page.evaluate(() => window.fixture.calls.at(-1)), ['downloadUpdate']);
    await page.click('[data-settings-panel="data"]');
    await page.click('[data-local-data-action="clear-cache"]');
    assert.deepEqual(await page.evaluate(() => window.fixture.calls.at(-1)), ['openModal', 'cache']);
    assert.match(await page.evaluate(() => document.querySelector('.nmx-local-data-modal')?.textContent || ''), /never be deleted|不会被删除/i, 'clear cache modal protects conversations');
    await page.click('[data-local-data-confirm="cache"]');
    assert.deepEqual(await page.evaluate(() => window.fixture.calls.at(-1)), ['clear', 'cache']);
    await page.click('[data-settings-panel="billing"]');
    await page.click('.nmx-billing-heading-actions input[type=checkbox]');
    assert.deepEqual(await page.evaluate(() => window.fixture.calls.find(call => call[0] === 'globalAuto')), ['globalAuto', true], 'global Auto-best toggles from the balance page');
    assert.deepEqual(errors, []);
});
