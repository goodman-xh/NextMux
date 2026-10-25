import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import test from 'node:test';
import { startSidebarFixture } from './coding-sidebar-fixture-harness.mjs';

// REQUIREMENTS §6.3 / §4.2 left sidebar, real renderContextPanel + dialogs +
// every production stylesheet in real Chromium (light/dark, zh-CN/en/ar).
const shots = '/tmp/nm-audit/shots';
await mkdir(shots, { recursive: true });

async function open(t, query = '', viewport = { width: 1000, height: 720 }) {
    const { origin, server, puppeteer } = await startSidebarFixture();
    t.after(() => new Promise(resolve => server.close(resolve)));
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage(); page.setDefaultTimeout(5000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    t.after(() => assert.deepEqual(errors, []));
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.setViewport(viewport);
    await page.goto(`${origin}/${query}`);
    await page.waitForSelector('.nmx-session-row');
    // The first row can render before the widget applies the selected writing direction.
    await page.waitForFunction(expected => document.querySelector('#fixture-root')?.getAttribute('dir') === expected,
        {}, query.includes('locale=ar') ? 'rtl' : 'ltr');
    return page;
}
const rowIds = page => page.$$eval('.nmx-session-row', rows => rows.map(row => row.dataset.sessionId));
const menuLabels = page => page.$$eval('.nmx-session-menu > button', buttons => buttons.map(button => button.textContent.trim()));

test('English labels are the reviewed ones and a running conversation shows a visible spinner in light theme', { timeout: 60000 }, async t => {
    const page = await open(t, '?locale=en&theme=light');
    const headings = await page.$$eval('.nmx-context-nav > p, .nmx-recent-conversations > p', items => items.map(item => item.textContent.trim()));
    assert.deepEqual(headings, ['Pinned', 'Projects', 'Recent']);
    assert.deepEqual(await page.$$eval('.nmx-context-actions > button > span', items => items.map(item => item.textContent.trim())), ['New conversation', 'Scheduled', 'Plugins']);
    const spinner = await page.$eval('[data-session-id="s-run"] .nmx-thread-spinner', element => {
        const style = getComputedStyle(element);
        return { top: style.borderTopColor, right: style.borderRightColor };
    });
    assert.notEqual(spinner.top, 'rgb(228, 224, 221)', 'the light theme must not paint the spinner in the background colour');
    assert.equal(spinner.right, 'rgba(0, 0, 0, 0)', 'one transparent side makes the rotation visible');
    await page.screenshot({ path: `${shots}/sidebar-en-light.png` });
});

test('row menu: pin/unpin is reachable, Escape closes it, and a low row opens upwards inside the window', { timeout: 60000 }, async t => {
    const page = await open(t, '?locale=en&theme=dark');
    await page.hover('[data-session-id="s-b"]');
    await page.click('[data-session-id="s-b"] .nmx-session-more');
    assert.deepEqual(await menuLabels(page), ['Tile this conversation', 'Pin', 'Create branch', 'View run history', 'Rename', 'Copy conversation IDs-b', 'Delete conversation']);
    await page.keyboard.press('Escape');
    assert.equal(await page.$('.nmx-session-menu'), null, 'Escape dismisses the row menu');
    await page.click('[data-session-id="s-b"] .nmx-session-more');
    await page.evaluate(() => [...document.querySelectorAll('.nmx-session-menu > button')][1].click());
    assert.equal(await page.$('.nmx-session-menu'), null);
    assert.deepEqual((await rowIds(page)).slice(0, 2).sort(), ['s-b', 's-pin'], 'the pinned conversation moves to the pinned section');
    await page.click('[data-session-id="s-b"] .nmx-session-more');
    assert.equal((await menuLabels(page))[1], 'Unpin');
    await page.keyboard.press('Escape');

    await page.hover('[data-session-id="s-r2"]');
    await page.click('[data-session-id="s-r2"] .nmx-session-more');
    const geometry = await page.evaluate(() => {
        const menu = document.querySelector('.nmx-session-menu').getBoundingClientRect();
        const row = document.querySelector('[data-session-id="s-r2"]').getBoundingClientRect();
        const labels = [...document.querySelectorAll('.nmx-session-menu > button span')].map(span => span.scrollWidth <= span.clientWidth + 1);
        return { menuTop: menu.top, menuBottom: menu.bottom, rowTop: row.top, height: innerHeight, labelsFit: labels.every(Boolean) };
    });
    assert.ok(geometry.menuBottom <= geometry.rowTop + 1, `menu flips above its row: ${JSON.stringify(geometry)}`);
    assert.ok(geometry.menuTop >= 0 && geometry.menuBottom <= geometry.height);
    assert.equal(geometry.labelsFit, true, 'English menu labels are not truncated');
    await page.screenshot({ path: `${shots}/sidebar-en-dark-menu-flipped.png` });
});

test('delete dialog: Cancel is focused, Cancel closes only the dialog, and the title is shown on its own line', { timeout: 60000 }, async t => {
    const page = await open(t, '?locale=en&theme=dark');
    await page.click('[data-session-id="s-b"] .nmx-session-more');
    await page.evaluate(() => [...document.querySelectorAll('.nmx-session-menu > button')].at(-1).click());
    await page.waitForSelector('.nmx-thread-dialog');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Cancel');
    assert.deepEqual(await page.$$eval('.nmx-thread-dialog p', items => items.map(item => item.textContent)),
        ['Add Arabic RTL support to the settings page and verify every drawer', 'This conversation and its local history will be permanently deleted.']);
    assert.deepEqual(await page.$$eval('.nmx-thread-dialog footer button', items => items.map(item => item.textContent)), ['Cancel', 'Delete']);
    await page.screenshot({ path: `${shots}/sidebar-en-dark-delete.png` });
    await page.keyboard.press('Enter');
    assert.equal(await page.$('.nmx-thread-dialog'), null);
    assert.equal((await rowIds(page)).includes('s-b'), true, 'Enter on the focused Cancel keeps the conversation');
    assert.equal(await page.$('.nmx-session-menu'), null, 'Cancel does not reopen the row menu');

    await page.click('[data-session-id="s-b"] .nmx-session-more');
    await page.evaluate(() => [...document.querySelectorAll('.nmx-session-menu > button')][4].click());
    await page.waitForSelector('.nmx-thread-dialog input');
    await page.keyboard.press('Escape');
    assert.equal(await page.$('.nmx-thread-dialog'), null, 'Escape closes the rename dialog');
});

test('rename commits with Enter but not while an IME composition is active', { timeout: 60000 }, async t => {
    const page = await open(t, '?locale=zh-CN&theme=light');
    await page.click('[data-session-id="s-a"] .nmx-session-more');
    await page.evaluate(() => [...document.querySelectorAll('.nmx-session-menu > button')][4].click());
    const input = await page.waitForSelector('.nmx-thread-dialog input');
    await input.focus(); await page.$eval('.nmx-thread-dialog input', element => element.select());
    await page.keyboard.type('新标题');
    await page.$eval('.nmx-thread-dialog input', element => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true, bubbles: true })));
    assert.ok(await page.$('.nmx-thread-dialog'), 'an IME Enter only commits the candidate');
    await page.keyboard.press('Enter');
    assert.equal(await page.$('.nmx-thread-dialog'), null);
    assert.equal(await page.$eval('[data-session-id="s-a"] .nmx-session-open span', element => element.textContent), '新标题');
});

test('dragging a conversation shows where it will land and drops there', { timeout: 60000 }, async t => {
    const page = await open(t, '?locale=en&theme=dark');
    const before = await rowIds(page);
    const box = async id => page.$eval(`[data-session-id="${id}"]`, element => { const rect = element.getBoundingClientRect(); return { x: rect.x + rect.width / 3, y: rect.y + rect.height / 2 }; });
    await page.setDragInterception(true);
    const from = await box('s-c'), to = await box('s-a');
    const data = await page.mouse.drag(from, to);
    await page.mouse.dragEnter(to, data); await page.mouse.dragOver(to, data);
    const feedback = await page.evaluate(() => ({ dragging: document.querySelector('[data-session-id="s-c"]').classList.contains('is-dragging'),
        edge: [...document.querySelector('[data-session-id="s-a"]').classList].find(name => name.startsWith('is-drop-')),
        shadow: getComputedStyle(document.querySelector('[data-session-id="s-a"]')).boxShadow }));
    assert.equal(feedback.dragging, true);
    assert.equal(feedback.edge, 'is-drop-before', 'dragging upwards inserts before the target');
    assert.match(feedback.shadow, /inset/);
    await page.screenshot({ path: `${shots}/sidebar-en-dark-drag.png` });
    await page.mouse.drop(to, data);
    const after = await rowIds(page);
    assert.notDeepEqual(after, before);
    assert.ok(after.indexOf('s-c') < after.indexOf('s-a'));
    assert.equal(await page.$('.is-drop-before, .is-drop-after, .is-dragging'), null, 'feedback clears after the drop');
});

test('search: light surface, non-matching projects hidden', { timeout: 60000 }, async t => {
    const page = await open(t, '?locale=en&theme=light');
    await page.evaluate(() => window.fixture.openCodingSearch());
    await page.keyboard.type('css');
    const search = await page.$eval('.nmx-sidebar-search', element => getComputedStyle(element).backgroundColor);
    assert.equal(search, 'rgb(251, 250, 249)');
    assert.deepEqual(await rowIds(page), ['s-r2']);
    assert.equal(await page.$('.nmx-project-tree'), null, 'projects without a match are not listed');
    await page.screenshot({ path: `${shots}/sidebar-en-light-search.png` });
    await page.keyboard.press('Escape');
    assert.equal(await page.$('.nmx-sidebar-search'), null);
});

test('Arabic: rows mirror (indent, menu side) and an English title truncates at its end', { timeout: 60000 }, async t => {
    const page = await open(t, '?locale=ar&theme=dark');
    // `dir=rtl` can be set before the deferred workspace stylesheet has
    // finished affecting layout. Observe the final CSS state, not only the
    // root attribute, before taking the geometry snapshot.
    await page.waitForFunction(() => {
        const row = document.querySelector('[data-session-id="s-a"]');
        if (!row) return false;
        const style = getComputedStyle(row);
        return style.marginLeft === '0px' && style.marginRight === '25px';
    });
    const layout = await page.evaluate(() => {
        const row = document.querySelector('[data-session-id="s-a"]').getBoundingClientRect();
        const project = document.querySelector('[data-project-path="/work/nextmux"]').getBoundingClientRect();
        const more = document.querySelector('[data-session-id="s-a"] .nmx-session-more').getBoundingClientRect();
        const title = document.querySelector('[data-session-id="s-b"] .nmx-session-open > span');
        return { rowRight: row.right, projectRight: project.right, moreLeft: more.left, rowLeft: row.left, titleDir: title.getAttribute('dir'),
            direction: getComputedStyle(title).direction, overflow: getComputedStyle(title).textOverflow,
            rootDir: document.querySelector('#fixture-root').getAttribute('dir'),
            rowMarginLeft: getComputedStyle(document.querySelector('[data-session-id="s-a"]')).marginLeft,
            rowMarginRight: getComputedStyle(document.querySelector('[data-session-id="s-a"]')).marginRight };
    });
    assert.ok(layout.projectRight - layout.rowRight >= 20, `project conversations indent from the right: ${JSON.stringify(layout)}`);
    assert.ok(layout.moreLeft - layout.rowLeft < 8, 'the row menu button sits at the inline end (left)');
    assert.equal(layout.titleDir, 'auto'); assert.equal(layout.direction, 'ltr'); assert.equal(layout.overflow, 'ellipsis');
    await page.screenshot({ path: `${shots}/sidebar-ar-dark.png` });
});
