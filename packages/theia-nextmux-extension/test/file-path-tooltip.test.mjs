import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { fixtureEntry } from './helpers/work-context-layout-source.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const core = createRequire(desktop.resolve('@theia/core/package.json'));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const puppeteer = (await import(platform.resolve('puppeteer'))).default;

test('real first and later file tabs show unclipped full paths on hover and keyboard focus', { timeout: 30000 }, async t => {
    const bundle = await desktop('esbuild').build({ stdin: { contents: fixtureEntry, resolveDir: root, sourcefile: 'tooltip-fixture.tsx', loader: 'tsx' },
        bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'silent',
        alias: { react: core.resolve('react'), 'react-dom/client': core.resolve('react-dom/client') } });
    const styles = await Promise.all(['nextmux.css', 'nextmux-desktop-production.css'].map(name => readFile(new URL(`../src/browser/style/${name}`, import.meta.url))));
    const html = `<!doctype html><html><head><meta charset='utf-8'><link rel='stylesheet' href='/style.css'><link rel='stylesheet' href='/production.css'>
<style>html,body{margin:0;height:100%;font:14px system-ui}.fixture-shell.nmx-shell{display:block;min-width:0;width:100%;height:100vh;--nmx-context-panel-width:0px;--nmx-context-file-list-width:180px}.fixture-editor{width:100%;height:100%}.fixture-controls{position:fixed;bottom:10px;left:10px}</style>
</head><body><div class='nmx-desktop-widget'><div id='fixture'></div></div><script src='/fixture.js'></script></body></html>`;
    const assets = { '/fixture.js': ['text/javascript', bundle.outputFiles[0].contents], '/style.css': ['text/css', styles[0]], '/production.css': ['text/css', styles[1]] };
    const server = createServer((request, response) => {
        const asset = assets[new URL(request.url, 'http://127.0.0.1').pathname] || ['text/html', html];
        response.writeHead(200, { 'content-type': asset[0] }); response.end(asset[1]);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage(); page.setDefaultTimeout(3000); await page.setViewport({ width: 700, height: 600 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    for (const theme of ['dark', 'light']) {
        await page.goto(`http://127.0.0.1:${server.address().port}/?history&theme=${theme}`);
        await page.waitForSelector('.nmx-file-editor-tabs [role=tab]');
        const first = '.nmx-file-editor-tabs [role=tab]';
        await page.hover(first);
        await page.waitForSelector('[role=tooltip]', { timeout: 1000 });
        assert.equal(await page.$eval('[role=tooltip]', el => el.textContent), '/synthetic-only/sample.txt');
        assert.equal(await page.$eval('[role=tooltip]', el => el.parentElement === document.body), true, 'portal escapes the tab strip overflow');
        await page.mouse.move(5, 500); await page.waitForSelector('[role=tooltip]', { hidden: true });
        const path = '/other-project/' + 'nested-folder/'.repeat(14) + 'same-name.txt';
        await page.evaluate(path => {
            const widget = window.fixture.widget;
            const preview = { ...widget.contextFilePreview, path, uri: `file://${path}`, name: 'same-name.txt' };
            widget.contextFileTabs.set(widget.contextFilePreview.uri, { preview: widget.contextFilePreview, drafts: {}, dirty: false, activeSide: 'current' });
            widget.contextFileTabs.set(preview.uri, { preview, drafts: {}, dirty: false, activeSide: 'current' });
            widget.update();
        }, path);
        const last = '.nmx-file-editor-tab:last-child [role=tab]';
        await page.focus(last); await page.waitForSelector('[role=tooltip]');
        const tooltip = await page.$eval('[role=tooltip]', el => {
            const rect = el.getBoundingClientRect();
            const range = document.createRange(); range.selectNodeContents(el);
            window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
            return { text: el.textContent, selected: String(window.getSelection()), x: rect.x, right: rect.right,
                bottom: rect.bottom, viewport: innerWidth, height: innerHeight, theme: el.className };
        });
        assert.equal(tooltip.text, path); assert.equal(tooltip.selected, path, 'full path remains selectable for copying');
        assert.ok(tooltip.x >= 8 && tooltip.right <= tooltip.viewport - 7 && tooltip.bottom <= tooltip.height - 7);
        assert.match(tooltip.theme, new RegExp(`nmx-theme-${theme}`));
        assert.ok(await page.$eval(last, el => el.getAttribute('aria-describedby')));
        await page.keyboard.press('Escape'); await page.waitForSelector('[role=tooltip]', { hidden: true });
        await page.$eval(last, el => el.blur());
        await page.hover(first); await page.waitForSelector('[role=tooltip]');
        assert.equal(await page.$eval('[role=tooltip]', el => el.textContent), '/synthetic-only/sample.txt', 'first tab stays correct after another path tooltip');
        await page.evaluate(() => window.dispatchEvent(new Event('resize')));
        await page.waitForSelector('[role=tooltip]', { hidden: true });
    }
    assert.deepEqual(errors, []);
});
