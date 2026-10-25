#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureEntry } from '../packages/theia-nextmux-extension/test/helpers/work-context-layout-source.mjs';

// Real current renderer/close callback and both CSS files. Synthetic editor
// leaf measures React identity; this is not an Electron/Monaco runtime test.
const root = fileURLToPath(new URL('../', import.meta.url));
const desktop = createRequire(join(root, 'apps/desktop/package.json'));
const extension = createRequire(join(root, 'packages/theia-nextmux-extension/package.json'));
const core = createRequire(extension.resolve('@theia/core/package.json'));
const puppeteerModule = createRequire(join(root, 'apps/cloudflare-platform/package.json')).resolve('puppeteer');
const puppeteer = (await import(puppeteerModule)).default || await import(puppeteerModule);
const directory = await mkdtemp(join(tmpdir(), 'nextmux-file-pane-visual-'));
const { outputFiles } = await desktop('esbuild').build({ stdin: { contents: fixtureEntry, resolveDir: root,
    sourcefile: 'file-pane-fixture.tsx', loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife',
    alias: { react: core.resolve('react'), 'react-dom/client': core.resolve('react-dom/client') }, logLevel: 'silent' });
const styles = await Promise.all(['nextmux.css', 'nextmux-desktop-production.css'].map(name =>
    readFile(join(root, 'packages/theia-nextmux-extension/src/browser/style', name))));
const html = `<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>
<link rel='stylesheet' href='/icons.css'><link rel='stylesheet' href='/style.css'><link rel='stylesheet' href='/production.css'>
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;font:14px system-ui}*{box-sizing:border-box}
#nextmux\\.desktop\\.widget{position:static;width:100%;height:100%;min-width:0}
.fixture-shell.nmx-shell{display:block;min-width:0;width:100%;height:100vh;--nmx-context-panel-width:0px;--nmx-context-file-list-width:180px}
.fixture-controls{position:fixed;bottom:16px;left:16px;z-index:1;display:flex;gap:8px}
.fixture-controls button{font:12px system-ui;padding:6px}.fixture-editor{width:100%;height:100%;min-width:0;min-height:0;flex:1;resize:none;white-space:pre;
margin:0;padding:12px;border:0;background:var(--nmx-bg);color:var(--nmx-text);font:13px/21px monospace}
</style></head><body><div id='nextmux.desktop.widget' class='nmx-desktop-widget'><div id='fixture'></div></div><script src='/fixture.js'></script></body></html>`;
const assets = { '/': ['text/html', html], '/fixture.js': ['text/javascript', outputFiles[0].contents],
    '/style.css': ['text/css', styles[0]], '/production.css': ['text/css', styles[1]],
    '/icons.css': ['text/css', await readFile(core.resolve('@vscode/codicons/dist/codicon.css'))],
    '/codicon.ttf': ['font/ttf', await readFile(core.resolve('@vscode/codicons/dist/codicon.ttf'))] };
const server = createServer((request, response) => {
    const asset = request.method === 'GET' ? assets[new URL(request.url, 'http://127.0.0.1').pathname] : undefined;
    response.writeHead(asset ? 200 : 404, { 'content-type': asset?.[0] || 'text/plain', 'cache-control': 'no-store',
        'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'self'" });
    response.end(asset?.[1] || 'Not found');
});
let browser;
const cases = [], screenshots = [], errors = [];
const report = { scope: 'Current source renderer + production CSS; synthetic editor leaf, no packaged app or file IO', directory, cases, screenshots, errors };
try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await puppeteer.launch({ headless: true, userDataDir: join(directory, 'browser-profile') });
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', request => { if (new URL(request.url()).origin === origin) void request.continue(); else { errors.push('external request blocked'); void request.abort(); } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => { errors.push('unexpected native dialog'); void dialog.dismiss(); });
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const paneWidth = async width => { await page.$eval('.fixture-shell', (node, value) => node.style.setProperty('--nmx-work-context-width', `${value}px`), width); await settle(); };
    const measure = () => page.evaluate(() => {
        const pane = document.querySelector('.nmx-work-context'), layout = pane.querySelector('.nmx-context-file-layout');
        const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width, height: r.height }; };
        const tree = layout.querySelector('.nmx-context-file-list'), divider = layout.querySelector('.nmx-context-file-list-resize'), editor = layout.querySelector('.nmx-context-file-preview');
        return { pane: rect(pane), layout: rect(layout), tree: rect(tree), editor: rect(editor), divider: rect(divider),
            treeDisplay: getComputedStyle(tree).display, dividerDisplay: getComputedStyle(divider).display, editorDisplay: getComputedStyle(editor).display,
            direction: getComputedStyle(pane).direction, pageWidth: document.documentElement.scrollWidth,
            counts: { ...window.fixture.counts }, draft: window.fixture.widget.contextFileDrafts.current,
            dirty: window.fixture.widget.contextFileDirty, text: document.querySelector('.fixture-editor')?.value,
            controls: [...pane.querySelectorAll(':scope > header > nav button')].filter(node => { const style = getComputedStyle(node), r = node.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && r.width > 0 && r.height > 0; }).map(rect) };
    });
    const assertLayout = (value, width, preview) => {
        assert.ok(Math.abs(value.pane.width - width) <= 1, `expected pane ${width}, got ${value.pane.width}`);
        if (!preview) {
            assert.ok(value.tree.width >= 179); assert.ok(value.tree.width <= value.layout.width + 1); assert.equal(value.editorDisplay, 'none'); assert.equal(value.dividerDisplay, 'none');
        } else if (width <= 420) {
            assert.equal(value.treeDisplay, 'none'); assert.equal(value.dividerDisplay, 'none'); assert.ok(value.editor.width >= value.layout.width - 1);
        } else {
            assert.ok(value.tree.width >= 179); assert.equal(value.divider.width, 6); assert.ok(value.editor.width > 300);
        }
        assert.ok(value.controls.every(control => control.left >= value.pane.left && control.right <= value.pane.right), 'visible context controls must stay inside the pane');
    };
    for (const [windowWidth, windowHeight] of [[980, 680], [1440, 900]]) for (const theme of ['dark', 'light']) for (const locale of ['en', 'zh-CN', 'ar']) {
        await page.setViewport({ width: windowWidth, height: windowHeight });
        await page.goto(`${origin}/?theme=${theme}&locale=${locale}`, { waitUntil: 'networkidle0' });
        await page.waitForSelector('.nmx-context-file-layout'); await paneWidth(297);
        const treeOnly = await measure(); assertLayout(treeOnly, 297, false);
        await page.click('[data-fixture="open"]'); await settle();
        const editor = await page.$('.fixture-editor'); assert.ok(editor);
        await editor.click(); await page.keyboard.press('End'); await page.keyboard.type(' — unsaved fixture'); await settle();
        const narrow = await measure(); assertLayout(narrow, 297, true); assert.equal(narrow.dirty, true); assert.ok(narrow.draft.endsWith('unsaved fixture'));
        assert.equal(narrow.direction, locale === 'ar' ? 'rtl' : 'ltr');
        for (const width of [497, 297]) {
            await paneWidth(width); const resized = await measure(); assertLayout(resized, width, true);
            assert.equal(await editor.evaluate(node => node === document.querySelector('.fixture-editor')), true, 'CSS resize must not replace the editor DOM');
            assert.equal(resized.text, narrow.text); assert.equal(resized.draft, narrow.draft); assert.equal(resized.counts.mount, 1); assert.equal(resized.counts.unmount, 0);
            const path = join(directory, `${windowWidth}-${theme}-${locale}-${width}.png`); await page.screenshot({ path }); screenshots.push(path);
        }
        await page.click('.nmx-work-context-header-actions > button[aria-expanded]'); await settle();
        const expandMenu = await page.$$('.nmx-context-file-menu [role=menuitem]'); assert.equal(expandMenu.length, 4);
        await expandMenu[2].click(); await settle();
        const maximized = await measure(); assert.ok(maximized.pane.width > 497); assert.ok(maximized.tree.width >= 179);
        assert.equal(maximized.text, narrow.text); assert.equal(maximized.counts.mount, 1);
        await page.click('.nmx-work-context-header-actions > button[aria-expanded]'); await settle();
        const restoreMenu = await page.$$('.nmx-context-file-menu [role=menuitem]'); assert.equal(restoreMenu.length, 4);
        await restoreMenu[2].click(); await settle();
        const restoredWidth = await measure(); assert.ok(restoredWidth.pane.width > 0);
        await page.click('.nmx-work-context-header-actions > button[aria-expanded]'); await settle();
        assert.ok(await page.$('.nmx-context-file-menu [role=menuitem]:last-child'), 'history action must be available in the file menu');
        await page.click('.nmx-context-file-menu [role=menuitem]:last-child'); await page.evaluate(() => window.fixture.widget.update()); await settle();
        const timeline = await measure(); assert.ok(await page.$('.nmx-context-file-history'), 'history timeline must open from the file menu');
        assert.equal((await page.$$('.nmx-context-file-history [data-history-kind]')).length, 6);
        await page.click('.nmx-context-file-history [data-history-kind="saved"]'); await settle();
        const returned = await measure(); assertLayout(returned, 297, true); assert.equal(returned.counts.unmount, 0);
        await page.click('.nmx-file-editor-tab-close'); await settle();
        const closed = await measure(); assertLayout(closed, 297, false); assert.equal(closed.counts.unmount, 1); assert.equal(closed.counts.detach, 0); assert.equal(await page.$('.nmx-file-editor-tab'), null);
        await paneWidth(497); assertLayout(await measure(), 497, false);
        assert.ok(closed.pageWidth <= windowWidth);
        cases.push({ windowWidth, windowHeight, theme, locale, treeOnly, narrow, maximized, returned, closed });
    }
    assert.deepEqual(errors, []); report.passed = true;
} catch (error) {
    report.failure = String(error.stack || error); process.exitCode = 1;
} finally {
    if (browser) await browser.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ directory, passed: report.passed || false, cases: cases.length, screenshots, failure: report.failure }));
}
