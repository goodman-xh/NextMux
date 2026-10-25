import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// REQUIREMENTS §4.2: dialogs fade + slightly scale over an app-covering
// overlay; hover/focus colours ease; pointer focus shows no blue ring while
// keyboard focus keeps the theme ring; section switches fade; the drop
// highlight is gentle; everything honours reduced motion and ends idle.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const puppeteer = (await import(platform.resolve('puppeteer'))).default;
const widgetSource = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const frontendModule = await readFile(new URL('../src/browser/nextmux-frontend-module.ts', import.meta.url), 'utf8');

const entry = `import {fadeInElement} from './packages/theia-nextmux-extension/src/browser/nextmux-motion';
window.fadeInElement = fadeInElement;`;
// Theia's own global focus rule (packages/core/src/browser/style/index.css) is what
// paints the blue ring; include it so the override is proven against it.
const theiaFocus = ':root{--theia-focusBorder:#007fd4}:focus:not(iframe){outline-width:1px;outline-style:solid;outline-offset:-1px;opacity:1;outline-color:var(--theia-focusBorder)}';

async function fixture(t, { reduced = false, theme = 'dark', locale = 'en', width = 1100 } = {}) {
    const bundle = await desktop('esbuild').build({ stdin: { contents: entry, resolveDir: root, sourcefile: 'motion-fixture.ts', loader: 'ts' },
        bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'silent' });
    const styles = await Promise.all(['nextmux.css', 'nextmux-desktop-production.css', 'nextmux-motion.css'].map(name => readFile(new URL(`../src/browser/style/${name}`, import.meta.url), 'utf8')));
    const title = locale === 'zh-CN' ? '删除此对话？' : 'Delete this conversation?';
    const body = locale === 'zh-CN' ? '删除后无法恢复。' : 'This cannot be undone.';
    const html = `<!doctype html><html lang='${locale}'><head><meta charset='utf-8'><style>${theiaFocus}</style><style>${styles.join('\n')}</style>
<style>html,body{margin:0;height:100%;font:14px system-ui}.nmx-desktop-widget{height:100vh}</style></head>
<body><div class='nmx-desktop-widget'><div class='nmx-shell nmx-theme-${theme}' style='position:relative;height:100vh'>
<div class='nmx-titlebar-actions'><button id='back' aria-label='Back'>←</button><button data-conversation-window-menu aria-label='Windows'>▣</button></div>
<section id='nmx-workspace' class='nmx-workspace'><p>Workspace</p>
<div class='nmx-project-header'><button class='nmx-project-row' data-project-path='/a'><i class='codicon codicon-folder'></i><span>alpha</span><i></i></button></div></section>
</div></div><script src='/fixture.js'></script>
<template id='dialog'><div class='nmx-sheet-backdrop nmx-dialog-backdrop'><section class='nmx-thread-dialog nmx-project-delete-dialog' role='alertdialog' aria-modal='true'>
<header><strong>${title}</strong></header><p>${body}</p><div class='nmx-dialog-actions'><button id='cancel'>${locale === 'zh-CN' ? '取消' : 'Cancel'}</button><button id='confirm' class='is-danger'>${locale === 'zh-CN' ? '删除' : 'Delete'}</button></div></section></div></template>
</body></html>`;
    const server = createServer((request, response) => {
        if (request.url === '/fixture.js') { response.writeHead(200, { 'content-type': 'text/javascript' }); response.end(bundle.outputFiles[0].contents); return; }
        response.writeHead(200, { 'content-type': 'text/html' }); response.end(html);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage(); page.setDefaultTimeout(5000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    t.after(() => assert.deepEqual(errors, []));
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }]);
    await page.setViewport({ width, height: 640 });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForSelector('#nmx-workspace');
    return page;
}
const openDialog = page => page.evaluate(() => document.querySelector('.nmx-shell').append(document.querySelector('#dialog').content.cloneNode(true)));
const running = page => page.evaluate(() => document.getAnimations().map(animation => animation.animationName || animation.transitionProperty));
const settle = (page, ms = 320) => page.evaluate(ms => new Promise(resolve => setTimeout(resolve, ms)), ms);

test('dialog fades in with a slight zoom over an overlay that covers the whole app, then stops animating', { timeout: 40000 }, async t => {
    for (const [theme, locale, width] of [['dark', 'en', 1100], ['light', 'zh-CN', 1100], ['dark', 'zh-CN', 480]]) {
        await t.test(`${theme} ${locale} ${width}px`, async t => {
            const page = await fixture(t, { theme, locale, width });
            const start = await page.evaluate(() => {
                document.querySelector('.nmx-shell').append(document.querySelector('#dialog').content.cloneNode(true));
                const dialog = document.querySelector('.nmx-thread-dialog');
                return { names: document.getAnimations().map(animation => animation.animationName), transform: getComputedStyle(dialog).transform,
                    opacity: Number(getComputedStyle(dialog).opacity) };
            });
            assert.ok(start.names.includes('nmx-motion-fade-in'), 'overlay fades');
            assert.ok(start.names.includes('nmx-motion-dialog-in'), 'dialog zooms in');
            assert.ok(start.opacity < 1, 'dialog starts transparent');
            assert.match(start.transform, /^matrix\(0\.9[6-9]/, 'dialog starts slightly scaled down');
            if (theme === 'dark' && width === 1100) await page.screenshot({ path: '/tmp/nm-motion-dialog-mid.png' });
            await settle(page);
            assert.deepEqual(await running(page), [], 'no animation keeps running once open');
            const cover = await page.evaluate(() => {
                const overlay = document.querySelector('.nmx-dialog-backdrop');
                const hit = (x, y) => overlay.contains(document.elementFromPoint(x, y));
                const box = overlay.getBoundingClientRect();
                return { full: box.width === innerWidth && box.height === innerHeight, corners: [hit(2, 2), hit(innerWidth - 2, 2), hit(2, innerHeight - 2), hit(innerWidth - 2, innerHeight - 2)],
                    titlebar: overlay.contains(document.elementFromPoint(20, 12)), zIndex: getComputedStyle(overlay).zIndex };
            });
            assert.equal(cover.full, true);
            assert.deepEqual(cover.corners, [true, true, true, true]);
            assert.equal(cover.titlebar, true, 'the overlay covers the custom titlebar too');
            await page.screenshot({ path: `/tmp/nm-motion-dialog-${theme}-${locale}-${width}.png` });
        });
    }
});

test('pointer focus has no ring (not even Theia blue); keyboard focus keeps the theme ring; hover colours ease', { timeout: 30000 }, async t => {
    const page = await fixture(t);
    await openDialog(page); await settle(page);
    await page.click('#cancel');
    const pointer = await page.$eval('#cancel', el => ({ focused: document.activeElement === el, outline: getComputedStyle(el).outlineStyle }));
    assert.deepEqual(pointer, { focused: true, outline: 'none' });
    await page.keyboard.press('Tab');
    const keyboard = await page.$eval('#confirm', el => ({ focused: document.activeElement === el, style: getComputedStyle(el).outlineStyle,
        width: getComputedStyle(el).outlineWidth, color: getComputedStyle(el).outlineColor }));
    assert.equal(keyboard.focused, true);
    assert.equal(keyboard.style, 'solid');
    assert.equal(keyboard.width, '2px');
    assert.notEqual(keyboard.color, 'rgb(0, 127, 212)', 'never the default blue');
    const transition = await page.$eval('#cancel', el => ({ property: getComputedStyle(el).transitionProperty, duration: getComputedStyle(el).transitionDuration }));
    assert.match(transition.property, /background-color/);
    assert.match(transition.property, /color/);
    assert.equal(transition.duration.split(',')[0].trim(), '0.12s');
});

test('section switch fades the workspace in; drop highlight fades in and out; the flight cue lights up the landing control', { timeout: 30000 }, async t => {
    const page = await fixture(t);
    const fade = await page.evaluate(() => {
        const animation = window.fadeInElement(document.querySelector('#nmx-workspace'));
        const keyframes = animation.effect.getKeyframes();
        return { duration: animation.effect.getTiming().duration, from: Number(keyframes[0].opacity), to: Number(keyframes.at(-1).opacity) };
    });
    assert.deepEqual(fade, { duration: 180, from: 0, to: 1 });
    const baseline = await page.$eval('.nmx-project-row', el => getComputedStyle(el).backgroundColor);
    await page.evaluate(() => document.querySelector('.nmx-project-row').classList.add('is-drop-highlight'));
    const highlight = await page.evaluate(() => new Promise(resolve => setTimeout(() => resolve({
        names: document.getAnimations().map(animation => animation.animationName),
        background: getComputedStyle(document.querySelector('.nmx-project-row')).backgroundColor }), 400)));
    assert.ok(highlight.names.includes('nmx-project-drop-highlight'));
    assert.notEqual(highlight.background, baseline, 'visibly highlighted mid-way');
    assert.ok(await page.evaluate(() => { document.querySelector('[data-conversation-window-menu]').classList.add('is-flight-landed');
        return document.getAnimations().some(animation => animation.animationName === 'nmx-motion-flight-landed'); }));
    await settle(page, 1_200);
    assert.deepEqual(await running(page), [], 'one-shot effects end; nothing loops while idle');
    assert.equal(await page.$eval('.nmx-project-row', el => getComputedStyle(el).backgroundColor), baseline, 'highlight fades back out');
});

test('reduced motion: no dialog, fade or WAAPI animation; the drop highlight stays visible without animating', { timeout: 30000 }, async t => {
    const page = await fixture(t, { reduced: true, theme: 'light' });
    await openDialog(page);
    assert.equal(await page.$eval('.nmx-thread-dialog', el => getComputedStyle(el).animationName), 'none');
    assert.equal(await page.evaluate(() => window.fadeInElement(document.querySelector('#nmx-workspace'))), undefined);
    await page.evaluate(() => document.querySelector('.nmx-project-row').classList.add('is-drop-highlight'));
    const row = await page.$eval('.nmx-project-row', el => ({ name: getComputedStyle(el).animationName, background: getComputedStyle(el).backgroundColor }));
    assert.equal(row.name, 'none');
    assert.notEqual(row.background, 'rgba(0, 0, 0, 0)');
});

test('running timeline marker respects reduced motion, including a live preference change', { timeout: 30000 }, async t => {
    const page = await fixture(t, { reduced: true });
    await page.evaluate(() => {
        const timeline = document.createElement('nav');
        timeline.className = 'nmx-thread-timeline';
        timeline.innerHTML = '<button class="is-running" aria-label="Running turn"><span></span></button>';
        document.querySelector('.nmx-shell').append(timeline);
    });
    const animationName = () => page.$eval('.nmx-thread-timeline button.is-running > span', el => getComputedStyle(el).animationName);
    const initiallyReduced = await animationName();
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
    const normalMotion = await animationName();
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    const reducedAgain = await animationName();
    assert.deepEqual([initiallyReduced, normalMotion, reducedAgain],
        ['none', 'nmx-timeline-pulse', 'none'], 'reduced motion freezes the cue both at load and after a live change');
});

test('hidden documents pause CSS animations', { timeout: 30000 }, async t => {
    const page = await fixture(t);
    await page.evaluate(() => { document.documentElement.classList.add('nmx-document-hidden'); document.querySelector('.nmx-project-row').classList.add('is-drop-highlight'); });
    assert.equal(await page.$eval('.nmx-project-row', el => getComputedStyle(el).animationPlayState), 'paused');
});

test('production widget: motion stylesheet is loaded last, sections fade, tiles ease in, jump-to-bottom stays short', () => {
    assert.doesNotMatch(frontendModule.slice(frontendModule.indexOf("style/nextmux-motion.css';")), /\.css';[\s\S]*\.css';/, 'motion stylesheet is the last stylesheet import');
    assert.ok(frontendModule.includes("style/nextmux-motion.css';"));
    assert.match(widgetSource, /if \(this\.lastRenderedSection !== undefined\) fadeInElement\(this\.node\.querySelector\('#nmx-workspace'\)\);/);
    assert.match(widgetSource, /this\.node\.classList\.add\('nmx-conversation-entering'\);/);
    assert.match(widgetSource, /button\.classList\.add\('is-flight-landed'\);/);
    assert.match(widgetSource, /document\.documentElement\.classList\.toggle\('nmx-document-hidden', document\.visibilityState === 'hidden'\);/);
    const bottom = widgetSource.slice(widgetSource.indexOf('protected scrollThreadBottom(): void'), widgetSource.indexOf('protected onThreadNavigatorWheel('));
    assert.match(bottom, /stage\.scrollTop = stage\.scrollHeight - stage\.clientHeight \* 2;/);
    assert.doesNotMatch(widgetSource, /scroll-behavior:\s*smooth/, 'wheel scrolling is never forced smooth');
});
