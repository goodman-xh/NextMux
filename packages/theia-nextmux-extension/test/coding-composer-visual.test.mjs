import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import test from 'node:test';
import { startWorkbenchFixture } from './coding-workbench-fixture-harness.mjs';

// REQUIREMENTS §6.2 / §6.5 composer: real renderCodingWorkbench, its popovers
// and permission prompts in real Chromium with every production stylesheet.
const shots = '/tmp/nm-audit/shots';
await mkdir(shots, { recursive: true });

async function open(t, query, viewport = { width: 1000, height: 720 }) {
    const { origin, server, puppeteer } = await startWorkbenchFixture();
    t.after(() => new Promise(resolve => server.close(resolve)));
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage(); page.setDefaultTimeout(5000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    t.after(() => assert.deepEqual(errors, []));
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.setViewport(viewport);
    await page.goto(`${origin}/?${query}`);
    await page.waitForSelector('.nmx-composer textarea');
    return page;
}
const calls = page => page.evaluate(() => window.fixture.calls.map(call => call[0]).filter(name => ['submitPrompt', 'stopAgentRun'].includes(name)));
const rect = (page, selector) => page.$eval(selector, element => { const box = element.getBoundingClientRect(); return { top: box.top, bottom: box.bottom, left: box.left, right: box.right }; });

test('"+" menu opens from the "+" above the composer, fully visible, in LTR and RTL', { timeout: 60000 }, async t => {
    for (const [locale, theme] of [['zh-CN', 'dark'], ['en', 'light'], ['ar', 'dark']]) {
        const page = await open(t, `locale=${locale}&theme=${theme}`);
        await page.click('.nmx-composer-tool');
        await page.waitForSelector('.nmx-attachment-popover');
        const [menu, plus, composer] = await Promise.all([rect(page, '.nmx-attachment-popover'), rect(page, '.nmx-composer-tool'), rect(page, '.nmx-composer')]);
        const label = JSON.stringify({ locale, menu, plus, composer });
        if (locale === 'ar') assert.ok(Math.abs(menu.right - plus.right) < 2, `RTL menu aligns to the "+": ${label}`);
        else assert.ok(Math.abs(menu.left - plus.left) < 2, `menu aligns to the "+": ${label}`);
        assert.ok(menu.bottom <= composer.top, `menu does not cover the text being typed: ${label}`);
        assert.ok(composer.top - menu.bottom <= 12, `menu sits next to the composer: ${label}`);
        assert.equal(await page.$eval('.nmx-attachment-popover', element => element.scrollHeight <= element.clientHeight + 1), true, `every action visible: ${label}`);
        await page.screenshot({ path: `${shots}/composer-plus-${locale}-${theme}.png` });
        await page.keyboard.press('Escape');
        assert.equal(await page.$('.nmx-attachment-popover'), null, 'Escape closes the menu');
    }
});

test('permission switch: read-only applies at once; full access asks, Escape keeps the old mode, Allow applies', { timeout: 60000 }, async t => {
    const page = await open(t, 'locale=en&theme=light');
    assert.equal(await page.$eval('.nmx-permission-button span', element => element.scrollWidth <= element.clientWidth + 1), true, 'label is not truncated');
    await page.click('.nmx-permission-button');
    assert.deepEqual(await page.$$eval('.nmx-permission-popover > button strong', items => items.map(item => item.textContent)), ['Read-only', 'Workspace write', 'Full access']);
    await page.screenshot({ path: `${shots}/composer-permission-en-light.png` });
    await page.evaluate(() => [...document.querySelectorAll('.nmx-permission-popover > button')][0].click());
    assert.equal(await page.evaluate(() => window.fixture.permissionMode), 'read_only');
    assert.equal(await page.$('.nmx-permission-popover'), null);
    assert.equal(await page.$eval('.nmx-permission-button span', element => element.textContent), 'Read-only');

    await page.click('.nmx-permission-button');
    await page.evaluate(() => [...document.querySelectorAll('.nmx-permission-popover > button')][2].click());
    await page.waitForSelector('.nmx-permission-sheet');
    assert.equal(await page.$eval('.nmx-permission-sheet h2', element => element.textContent), 'Allow full access for this conversation?');
    assert.deepEqual(await page.$$eval('.nmx-permission-sheet button', items => items.map(item => item.textContent)), ['×', 'Cancel', 'Allow full access']);
    await page.screenshot({ path: `${shots}/composer-full-access-en-light.png` });
    await page.keyboard.press('Escape');
    assert.equal(await page.$('.nmx-permission-sheet'), null);
    assert.equal(await page.evaluate(() => window.fixture.permissionMode), 'read_only');

    await page.click('.nmx-permission-button');
    await page.evaluate(() => [...document.querySelectorAll('.nmx-permission-popover > button')][2].click());
    await page.evaluate(() => [...document.querySelectorAll('.nmx-permission-sheet button')].at(-1).click());
    assert.equal(await page.evaluate(() => window.fixture.permissionMode), 'full_access');
    assert.equal(await page.$('.nmx-permission-sheet'), null);
});

test('Enter sends, Shift+Enter adds a line, and an IME Enter only commits the candidate', { timeout: 60000 }, async t => {
    const page = await open(t, 'locale=zh-CN&theme=dark');
    await page.click('.nmx-composer textarea');
    await page.keyboard.type('第一行');
    await page.keyboard.down('Shift'); await page.keyboard.press('Enter'); await page.keyboard.up('Shift');
    await page.keyboard.type('第二行');
    assert.equal(await page.$eval('.nmx-composer textarea', element => element.value), '第一行\n第二行');
    await page.$eval('.nmx-composer textarea', element => {
        element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true, bubbles: true, cancelable: true }));
        element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }));
    });
    assert.deepEqual(await calls(page), [], 'no submission during composition');
    await page.keyboard.press('Enter');
    assert.deepEqual(await page.evaluate(() => window.fixture.calls.filter(call => call[0] === 'submitPrompt')), [['submitPrompt', '第一行\n第二行']]);
});

test('running task: Stop is shown for an empty composer and becomes a busy spinner at once; a typed message queues instead', { timeout: 60000 }, async t => {
    const page = await open(t, 'locale=en&theme=dark&stage=running');
    const stop = await page.$('.nmx-send-button.is-stop');
    assert.ok(stop, 'Stop replaces Send while the task runs');
    assert.equal(await page.$eval('.nmx-send-button', element => element.getAttribute('aria-label')), 'Stop');
    assert.equal(await page.$eval('.nmx-permission-button', element => element.disabled), false, 'the next task permission remains editable during a run');
    await page.click('.nmx-permission-button');
    await page.evaluate(() => [...document.querySelectorAll('.nmx-permission-popover > button')][0].click());
    assert.deepEqual(await page.evaluate(() => [window.fixture.permissionMode, window.fixture.lastRunPermissionMode]), ['read_only', 'workspace_write'], 'saving next-task permission must not change the accepted running snapshot');
    assert.match(await page.$eval('.nmx-permission-button', element => element.title), /Current task:.*Newly sent tasks will use:/);
    await page.screenshot({ path: `${shots}/composer-running-en-dark.png` });
    await stop.click();
    assert.deepEqual(await calls(page), ['stopAgentRun']);
    assert.equal(await page.$eval('.nmx-send-button', element => element.disabled && Boolean(element.querySelector('.codicon-loading'))), true);

    const typing = await open(t, 'locale=en&theme=dark&stage=running');
    await typing.click('.nmx-composer textarea');
    await typing.keyboard.type('Also run the linter');
    assert.equal(await typing.$('.nmx-send-button.is-stop'), null, 'a typed message can be sent to steer or queue');
    await typing.keyboard.press('Enter');
    assert.deepEqual(await typing.evaluate(() => window.fixture.calls.filter(call => call[0] === 'submitPrompt').length), 1);
});

test('empty draft, narrow window and Arabic keep every composer control reachable', { timeout: 60000 }, async t => {
    for (const [query, width] of [['locale=en&theme=light&empty', 1000], ['locale=zh-CN&theme=dark', 620], ['locale=ar&theme=light', 760]]) {
        const page = await open(t, query, { width, height: 720 });
        const layout = await page.evaluate(() => {
            const composer = document.querySelector('.nmx-composer').getBoundingClientRect();
            return [...document.querySelectorAll('.nmx-composer > div:last-of-type > button')].map(button => {
                const box = button.getBoundingClientRect();
                const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
                return { label: button.getAttribute('aria-label') || button.textContent, inside: box.left >= composer.left - 1 && box.right <= composer.right + 1, reachable: button === hit || button.contains(hit) };
            });
        });
        for (const control of layout) assert.ok(control.inside && control.reachable, `${query} ${width}: ${JSON.stringify(layout)}`);
        await page.screenshot({ path: `${shots}/composer-${query.replace(/[&=]/g, '-')}-${width}.png` });
    }
});

test('应用操控: the icon beside the permission button picks one app, shown alone on the top row of the composer', { timeout: 60000 }, async t => {
    for (const [locale, theme] of [['zh-CN', 'dark'], ['en', 'light'], ['ar', 'dark']]) {
        const { origin, server, puppeteer } = await startWorkbenchFixture();
        t.after(() => new Promise(resolve => server.close(resolve)));
        const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
        const page = await browser.newPage(); page.setDefaultTimeout(5000);
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.evaluateOnNewDocument(() => {
            let picks = 0;
            window.nextmuxDesktop = { openAppInTab: async () => ({ ok: false }), pickApplication: async () => (++picks === 1
                ? { name: '计算器', id: 'com.apple.calculator', path: '/System/Applications/Calculator.app', icon: '' }
                : { name: '微信', id: 'com.tencent.xinWeChat', path: '/Applications/WeChat.app', icon: '' }) };
        });
        await page.setViewport({ width: 1000, height: 720 });
        await page.goto(`${origin}/?locale=${locale}&theme=${theme}`);
        await page.waitForSelector('.nmx-composer textarea');
        const order = await page.$$eval('.nmx-composer-below > button', buttons => buttons.map(button => button.className.split(' ')[0]));
        // A conversation with a project folder shows its path between the two; the app icon still follows it.
        assert.deepEqual(order.slice(0, 3), ['nmx-permission-button', 'nmx-project-path-button', 'nmx-app-control-button'], `the icon follows the permission button and project path (${locale})`);
        const path = await page.$eval('.nmx-project-path-button', button => ({ text: button.textContent, title: button.getAttribute('title'), width: button.getBoundingClientRect().width }));
        assert.ok(path.text.trim() && path.title && path.width < 260, `the project path is short with its full path in the tooltip: ${JSON.stringify(path)}`);
        const label = await page.$eval('.nmx-app-control-button', button => button.getAttribute('title'));
        if (locale === 'zh-CN') assert.equal(label, '应用操控');
        assert.equal(await page.$('.nmx-composer-app'), null, 'no app until one is picked');
        await page.click('.nmx-app-control-button');
        await page.waitForSelector('.nmx-composer-app');
        const [chip, input, composer] = await Promise.all(['.nmx-composer-app', '.nmx-composer-input', '.nmx-composer'].map(selector => page.$eval(selector, element => {
            const box = element.getBoundingClientRect(); return { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
        })));
        assert.ok(chip.bottom <= input.top, `the app has its own row above the text: ${JSON.stringify({ chip, input })}`);
        if (locale === 'ar') assert.ok(composer.right - chip.right < 24, `RTL: the app sits at the inline start: ${JSON.stringify({ chip, composer })}`);
        else assert.ok(chip.left - composer.left < 24, `the app sits at the top left: ${JSON.stringify({ chip, composer })}`);
        assert.match(await page.$eval('.nmx-composer-app', element => element.textContent), /计算器/);
        assert.ok(await page.$('.nmx-composer-app-notice'), 'without Full access the pick says it needs it');
        await page.screenshot({ path: `${shots}/composer-app-control-${locale}-${theme}.png` });
        // One app at a time: a second pick replaces the first.
        await page.click('.nmx-app-control-button');
        await page.waitForFunction(() => document.querySelector('.nmx-composer-app')?.textContent.includes('微信'));
        assert.equal((await page.$$('.nmx-composer-app')).length, 1);
        await page.click('.nmx-composer-app-remove');
        await page.waitForFunction(() => !document.querySelector('.nmx-composer-app'));
        assert.deepEqual(errors, []);
    }
});
