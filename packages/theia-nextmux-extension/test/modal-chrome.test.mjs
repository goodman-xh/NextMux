import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const moduleUrl = new URL('../src/browser/nextmux-modal-chrome.ts', import.meta.url);

// The module runs in a real browser: the window-chrome state must follow any
// modal (dialogs, lightbox, Theia dialogs), ignore side drawers that leave the
// top bar usable, and tell
// the host exactly once per transition.
const entry = `import { installModalChrome, MODAL_OPEN_CLASS } from './nextmux-modal-chrome';
window.calls = [];
window.uninstall = installModalChrome(document, open => { window.calls.push(open); return Promise.resolve(true); });
window.classes = () => ({ open: document.body.classList.contains(MODAL_OPEN_CLASS) });`;

test('modal chrome follows dialogs, skips drawers and reports each transition once', { timeout: 60_000 }, async t => {
    const { outputFiles } = await desktop('esbuild').build({ stdin: { contents: entry, loader: 'ts', resolveDir: dirname(fileURLToPath(moduleUrl)), sourcefile: 'modal-chrome-fixture.ts' },
        bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'silent' });
    const puppeteer = (await import(platform.resolve('puppeteer'))).default;
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><body><div id='theia-top-panel' style='position:absolute;top:0;left:0;right:0;height:30px'></div>
<div id='theia-app-shell'><div class='nmx-shell' id='shell'></div></div></body></html>`);
    await page.addScriptTag({ content: outputFiles[0].text });
    const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const state = async () => { await frame(); return page.evaluate(() => ({ ...window.classes(), calls: [...window.calls] })); };

    assert.deepEqual(await state(), { open: false, calls: [] }, 'nothing is reported while no modal is open');

    // A side drawer (non-dialog sheet) keeps the title bar live.
    await page.evaluate(() => { document.getElementById('shell').innerHTML = `<div class='nmx-sheet-backdrop' style='position:fixed;inset:40px 0 0 0'><section role='dialog' aria-modal='true'>drawer</section></div>`; });
    assert.deepEqual(await state(), { open: false, calls: [] });

    // A dialog kept in the workspace below the top bar (the comic 制作台) leaves the window buttons usable.
    await page.evaluate(() => { document.getElementById('shell').innerHTML = `<div style='position:absolute;inset:40px 0 0 276px'><div class='nmx-desk-backdrop' role='dialog' aria-modal='true' style='position:absolute;inset:0'>studio</div></div>`; });
    assert.deepEqual(await state(), { open: false, calls: [] }, 'the comic studio keeps the close button');

    // A centred dialog (for example "create branch") covers the window.
    await page.evaluate(() => { document.getElementById('shell').innerHTML = `<div class='nmx-sheet-backdrop nmx-dialog-backdrop' style='position:fixed;inset:0'><section role='dialog' aria-modal='true'>branch</section></div>`; });
    assert.deepEqual(await state(), { open: true, calls: [true] });

    // Streaming mutations while the dialog stays open do not re-report.
    await page.evaluate(() => { for (let index = 0; index < 50; index += 1) document.getElementById('shell').appendChild(document.createElement('p')); });
    assert.deepEqual((await state()).calls, [true]);

    // Hidden dialogs no longer count.
    await page.evaluate(() => { document.querySelector('.nmx-dialog-backdrop').style.display = 'none'; });
    assert.deepEqual(await state(), { open: false, calls: [true, false] });

    // The image lightbox counts too.
    await page.evaluate(() => { document.getElementById('shell').innerHTML = `<div class='nmx-attachment-lightbox' style='position:fixed;inset:0'></div>`; });
    assert.deepEqual(await state(), { open: true, calls: [true, false, true] });
    await page.evaluate(() => { document.getElementById('shell').innerHTML = ''; });
    assert.deepEqual((await state()).calls, [true, false, true, false]);

    // Theia's own dialogs count as well.
    await page.evaluate(() => { const overlay = document.createElement('div'); overlay.className = 'dialogOverlay'; overlay.style.cssText = 'position:fixed;inset:0'; document.body.appendChild(overlay); });
    assert.deepEqual(await state(), { open: true, calls: [true, false, true, false, true] });

    // Responsive geometry changes do not produce a DOM mutation, but still change which chrome is covered.
    await page.evaluate(() => {
        document.querySelector('.dialogOverlay').remove();
        document.getElementById('shell').innerHTML = `<style>.responsive-modal{position:fixed;inset:40px 0 0 0}@media(max-width:700px){.responsive-modal{top:0}}</style><div class='responsive-modal' aria-modal='true'>responsive dialog</div>`;
    });
    assert.equal((await state()).open, false);
    await page.setViewport({ width: 600, height: 600 });
    assert.equal((await state()).open, true, 'resize alone hides covered controls');
    await page.setViewport({ width: 900, height: 600 });
    assert.equal((await state()).open, false, 'resize alone restores uncovered controls');
    await page.setViewport({ width: 600, height: 600 });
    assert.equal((await state()).open, true);

    // Uninstalling restores the chrome.
    await page.evaluate(() => window.uninstall());
    assert.deepEqual(await page.evaluate(() => ({ ...window.classes(), last: window.calls.at(-1) })), { open: false, last: false });
});
