import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url), core = createRequire(require.resolve('@theia/core/package.json'));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const puppeteer = (await import(platform.resolve('puppeteer'))).default;
const base = fileURLToPath(new URL('../../../', import.meta.url)), src = fileURLToPath(new URL('../src/browser/', import.meta.url));

test('storyboard uses the reference wide dialog with working shots, time ranges, modal camera and lossless apply', { timeout: 90000 }, async t => {
    const { outputFiles } = await desktop('esbuild').build({ stdin: { resolveDir: src, loader: 'tsx', contents: `
import React from 'react';import {createRoot} from 'react-dom/client';import {StoryboardDialog} from './nextmux-comic-canvas-storyboard';
import {validateStoryboard} from '@nextmux/comic-core/canvas-camera';
const root=createRoot(document.querySelector('main'));let state={open:false,serial:0,locale:'zh-CN',durationSeconds:15,prompt:'',references:[]},saved,results=[],closed=0;
function render(){root.render(<><button id='trigger' onClick={()=>{state={...state,open:true};render();}}>Storyboard</button>{state.open&&<StoryboardDialog key={state.serial} {...state} saved={saved} onClose={()=>{closed++;state.open=false;render();}} onApply={(prompt,storyboard)=>{results.push({prompt,storyboard,issues:validateStoryboard(storyboard)});state.open=false;render();}}/>}</>);}
window.fixture={open(options={}){saved=options.saved;state={open:true,serial:state.serial+1,locale:'zh-CN',durationSeconds:15,prompt:'',references:[],...options};render();},duration(value){state={...state,durationSeconds:value};render();},get results(){return results;},get closed(){return closed;}};render();
` }, bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty', '.svg': 'dataurl' }, alias: {
        react: core.resolve('react'), 'react/jsx-runtime': core.resolve('react/jsx-runtime'), 'react-dom': core.resolve('react-dom'), 'react-dom/client': core.resolve('react-dom/client'),
        '@nextmux/comic-core/canvas-camera': base + 'packages/comic-core/src/canvas-camera.ts'
    } });
    const evidence = base + '.nextmux-run/canvas-storyboard-reference-review'; await mkdir(evidence, { recursive: true });
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage(); page.setDefaultTimeout(6000); await page.setViewport({ width: 1512, height: 878 });
    const errors = [], outgoing = []; page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true); page.on('request', request => {
        if (request.url().startsWith('data:')) return void request.continue();
        if (request.url() !== 'https://canvas-storyboard.fixture/' && !/\/(?:favicon\.ico|fonts\/)/.test(new URL(request.url()).pathname)) outgoing.push(request.url());
        void request.respond({ status: 200, contentType: 'text/html', body: '<main class="nmx-desktop-widget nmx-shell"></main>' });
    });
    await page.goto('https://canvas-storyboard.fixture/');
    const frontend = await readFile(src + 'nextmux-frontend-module.ts', 'utf8');
    const globalStyles = [...frontend.matchAll(/import ['"]\.\.\/\.\.\/src\/browser\/style\/([^'"]+\.css)['"]/g)].map(match => match[1]);
    for (const name of [...globalStyles, 'nextmux-comic-canvas.css', 'nextmux-comic-canvas-camera.css', 'nextmux-comic-canvas-storyboard.css']) {
        await page.addStyleTag({ content: await readFile(src + 'style/' + name, 'utf8') });
    }
    await page.addStyleTag({ content: 'html,body{margin:0;height:100%}main.nmx-shell{position:absolute;inset:0;display:block}' });
    await page.addStyleTag({ content: (await readFile(core.resolve('@vscode/codicons/dist/codicon.css'), 'utf8')).replace(/url\([^)]*codicon\.ttf[^)]*\)/g, 'url(data:font/ttf;base64,' + (await readFile(core.resolve('@vscode/codicons/dist/codicon.ttf'))).toString('base64') + ')') });
    await page.addScriptTag({ content: outputFiles[0].text });
    const open = async options => { await page.evaluate(options => fixture.open(options), options); await page.waitForSelector('.nmx-sbd-dialog'); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }; 
    const rect = selector => page.$eval(selector, element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; });
    const click = selector => page.click(selector);
    const result = () => page.evaluate(() => fixture.results.at(-1));

    await t.test('desktop reference geometry: one full width shot, parallel settings, independent fixed bottom regions', async () => {
        await open({});
        const dialog = await rect('.nmx-sbd-dialog'), card = await rect('.nmx-sbd-scene'), body = await rect('.nmx-sbd-scenes');
        assert.deepEqual(dialog, { x: 196, y: 20, width: 1120, height: 838, right: 1316, bottom: 858 });
        assert.ok(card.width > 1080 && card.width === body.width - 24);
        const lens = await rect('.nmx-sbd-selectors>label:first-child'), aperture = await rect('.nmx-sbd-selectors>label:nth-child(2)'), camera = await rect('.nmx-sbd-camera-field');
        assert.equal(lens.y, aperture.y); assert.equal(lens.y, camera.y); assert.ok(lens.right <= aperture.x && aperture.right <= camera.x);
        const toolbar = await rect('.nmx-sbd-toolbar'), other = await rect('.nmx-sbd-other'), footer = await rect('.nmx-sbd-footer');
        assert.ok(body.bottom <= toolbar.y && toolbar.bottom <= other.y && other.bottom <= footer.y);
        assert.equal(await page.$$eval('.nmx-sbd-content textarea', fields => fields.length), 3);
        assert.equal(await page.$$eval('.nmx-sbd-time-row input[type=range]', fields => fields.length), 2);
        assert.equal(await page.$eval('.nmx-sbd-dialog', node => node.scrollWidth <= node.clientWidth), true);
        const close = await rect('.nmx-sbd-close');
        assert.equal(await page.evaluate(r => document.querySelector('.nmx-sbd-close').contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)), close), true);
        await page.screenshot({ path: evidence + '/desktop-single.png' });
    });

    await t.test('time handles, clear/restore, keyboard reorder and shot cap preserve valid structural data', async () => {
        await click('.nmx-sbd-add'); await click('.nmx-sbd-add');
        assert.equal(await page.$$eval('.nmx-sbd-scene', cards => cards.length), 3);
        assert.equal(await page.$eval('.nmx-sbd-add', button => button.disabled), true, 'no fourth positive interval fits in 15 seconds');
        await page.focus('[data-shot-id="shot-1"] input[type=range]:first-child'); await page.keyboard.press('ArrowRight');
        assert.equal(await page.$eval('[data-shot-id="shot-1"] .nmx-sbd-time-value', node => node.textContent), '0.1s - 5.0s');
        await click('[data-shot-id="shot-2"] .nmx-sbd-clear-time');
        await page.focus('[data-shot-id="shot-2"] input[type=range]:last-child'); await page.keyboard.press('ArrowLeft');
        assert.equal(await page.$eval('[data-shot-id="shot-2"] .nmx-sbd-time-value', node => node.textContent), '5.0s - 9.9s', 'cleared range is restored only inside the unoccupied gap');
        await page.focus('[data-shot-id="shot-3"] .nmx-sbd-drag'); await page.keyboard.press('ArrowUp');
        assert.deepEqual(await page.$$eval('.nmx-sbd-scene', cards => cards.map(card => card.dataset.shotId)), ['shot-1', 'shot-3', 'shot-2']);
        await page.setDragInterception(true);
        const fromRect = await rect('[data-shot-id="shot-2"] .nmx-sbd-drag'), toRect = await rect('[data-shot-id="shot-1"] .nmx-sbd-drag');
        const from = {x:fromRect.x+fromRect.width/2,y:fromRect.y+fromRect.height/2}, to = {x:toRect.x+toRect.width/2,y:toRect.y+toRect.height/2};
        const drag = await page.mouse.drag(from, to); await page.mouse.dragEnter(to, drag); await page.mouse.dragOver(to, drag); await page.mouse.drop(to, drag); await page.mouse.up();
        await page.setDragInterception(false);
        assert.deepEqual(await page.$$eval('.nmx-sbd-scene', cards => cards.map(card => card.dataset.shotId)), ['shot-2', 'shot-1', 'shot-3']);
        await click('.nmx-sbd-btn.is-primary');
        const saved = await result(); assert.deepEqual(saved.issues, []); assert.deepEqual(saved.storyboard.shots.map(shot => shot.id), ['shot-2', 'shot-1', 'shot-3']);
        assert.equal(saved.storyboard.shots.find(shot => shot.id === 'shot-3').startSeconds, 10, 'reorder does not silently rewrite authored times');
        await open({ prompt: saved.prompt, saved: saved.storyboard, durationSeconds: 5 });
        assert.equal(await page.$eval('[data-shot-id="shot-3"] .nmx-sbd-time-value', node => node.textContent), '10.0s - 15.0s', 'changing generation duration does not truncate the authored plan');
        assert.equal(await page.$eval('.nmx-sbd-btn.is-primary', button => button.disabled), true);
        await click('[data-shot-id="shot-3"] .nmx-sbd-remove'); await click('[data-shot-id="shot-2"] .nmx-sbd-remove');
        assert.equal(await page.$eval('.nmx-sbd-btn.is-primary', button => button.disabled), false, 'explicitly removing the out-of-range shots repairs the plan');
        await open({ durationSeconds: 40 }); for (let i = 0; i < 7; i++) await click('.nmx-sbd-add');
        assert.equal(await page.$$eval('.nmx-sbd-scene', cards => cards.length), 8); assert.equal(await page.$eval('.nmx-sbd-add', button => button.disabled), true);
        const close = await rect('.nmx-sbd-close'); await page.$eval('.nmx-sbd-scenes', body => { body.scrollTop = body.scrollHeight; });
        assert.deepEqual(await rect('.nmx-sbd-close'), close, 'scrolling shots never moves the close target');
        await page.screenshot({ path: evidence + '/desktop-eight.png' });
    });

    await t.test('a duration change while editing validates the current model limit without discarding shots', async () => {
        await open({ durationSeconds: 15 }); await click('.nmx-sbd-add'); await click('.nmx-sbd-add');
        const ranges = await page.$$eval('.nmx-sbd-time-value', nodes => nodes.map(node => node.textContent));
        await page.evaluate(() => fixture.duration(5));
        await page.waitForFunction(() => document.querySelector('.nmx-sbd-btn.is-primary').disabled);
        assert.deepEqual(await page.$$eval('.nmx-sbd-time-value', nodes => nodes.map(node => node.textContent)), ranges);
        assert.ok(await page.$('.nmx-sbd-error[role=alert]'));
        await page.evaluate(() => fixture.duration(15));
        await page.waitForFunction(() => !document.querySelector('.nmx-sbd-btn.is-primary').disabled);
        await click('.nmx-sbd-btn.is-primary'); const saved = await result();
        assert.equal(saved.storyboard.clipDurationSeconds, 15); assert.deepEqual(saved.issues, []);
        assert.deepEqual(saved.storyboard.shots.map(shot => [shot.startSeconds, shot.endSeconds]), [[0,5],[5,10],[10,15]]);
    });

    await t.test('typing/lens/sound edits apply locally and reopen without duplicating the original text', async () => {
        await open({ locale: 'en', prompt: '  KEEP ORIGINAL EXACTLY ONCE\n\n', durationSeconds: 15 });
        await page.type('.nmx-sbd-content textarea', 'Foreground actor');
        const focal = await page.$eval('.nmx-sbd-selectors select', node => node.options[1].value); await page.select('.nmx-sbd-selectors select', focal);
        await click('.nmx-sbd-switches input'); await click('.nmx-sbd-btn.is-primary');
        const saved = await result(); assert.equal(saved.prompt.split('KEEP ORIGINAL EXACTLY ONCE').length - 1, 1); assert.equal(saved.storyboard.originalPrompt, '  KEEP ORIGINAL EXACTLY ONCE\n\n', 'keeping the original preserves its exact leading and trailing whitespace'); assert.equal(saved.storyboard.shots[0].foreground, 'Foreground actor');
        assert.equal(saved.storyboard.soundEffects, true); assert.equal(saved.storyboard.shots[0].focalLength, focal); assert.deepEqual(saved.issues, []);
        await open({ locale: 'en', prompt: saved.prompt, saved: saved.storyboard, durationSeconds: 15 }); await click('.nmx-sbd-btn.is-primary');
        const reopened = await result(); assert.equal(reopened.prompt, saved.prompt); assert.deepEqual(reopened.storyboard, saved.storyboard);
        await open({ locale: 'en', prompt: reopened.prompt, saved: reopened.storyboard });
        await click('.nmx-sbd-other input'); await click('.nmx-sbd-btn.is-primary');
        assert.equal((await result()).prompt.includes('KEEP ORIGINAL EXACTLY ONCE'), false, 'explicitly opting out removes the retained original text');
    });

    await t.test('camera nested modal closes independently and blank drag never dismisses the storyboard', async () => {
        await open({}); await click('.nmx-sbd-camera-trigger'); await page.waitForFunction(() => document.querySelectorAll('dialog:modal').length === 2);
        const cameraRect = await rect('.nmx-camera-control.is-dialog'); assert.equal(cameraRect.width, 520); assert.ok(cameraRect.height <= 620);
        await click('[data-camera-move="push_in"]'); await click('[data-camera-speed="slow"]');
        await click('[data-camera-action="confirm"]'); await page.waitForFunction(() => document.querySelectorAll('dialog:modal').length === 1);
        assert.ok((await page.$eval('.nmx-sbd-camera-trigger', node => node.textContent)).includes('推进'));
        await click('.nmx-sbd-camera-trigger'); await page.waitForFunction(() => document.querySelectorAll('dialog:modal').length === 2);
        assert.equal(await page.$eval('[data-camera-move="push_in"]', button => button.getAttribute('aria-pressed')), 'true');
        await page.screenshot({ path: evidence + '/camera-nested.png' });
        await page.keyboard.press('Escape'); await page.waitForFunction(() => document.querySelectorAll('dialog:modal').length === 1);
        assert.ok(await page.$('.nmx-sbd-dialog')); assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('nmx-sbd-camera-trigger')), true);
        await page.mouse.move(20, 20); await page.mouse.down(); await page.mouse.move(400, 200); await page.mouse.up();
        assert.ok(await page.$('.nmx-sbd-dialog'), 'blank-to-card drag does not count as a blank click');
        await page.mouse.move(20, 20); await page.mouse.down(); assert.ok(await page.$('.nmx-sbd-dialog')); await page.mouse.up();
        await page.waitForFunction(() => !document.querySelector('.nmx-sbd-dialog'));
    });

    await t.test('narrow viewport keeps actual references, settings and close/apply visible with no horizontal overflow', async () => {
        await page.setViewport({ width: 390, height: 760 });
        const uri = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="teal"/></svg>');
        await open({ references: [{ id: 'actual-1', kind: 'image', uri, label: 'Connected image' }], durationSeconds: 40 });
        for (let i = 0; i < 4; i++) await click('.nmx-sbd-add');
        const dialog = await rect('.nmx-sbd-dialog'); assert.equal(dialog.width, 366); assert.equal(dialog.height, 736);
        assert.equal(await page.$eval('.nmx-sbd-dialog', node => node.scrollWidth <= node.clientWidth), true);
        assert.equal(await page.$eval('.nmx-sbd-ref-thumb img', image => image.alt === 'Connected image' && image.complete && image.naturalWidth > 0), true);
        assert.equal(await page.$$eval('.nmx-sbd-content textarea', fields => fields.every(field => !field.placeholder.includes('@'))), true, 'no promise of unimplemented text-reference bindings');
        await page.$eval('.nmx-sbd-scenes', node => { node.scrollTop = node.scrollHeight; });
        for (const selector of ['.nmx-sbd-close', '.nmx-sbd-btn.is-primary']) {
            const box = await rect(selector); assert.ok(box.x >= 0 && box.right <= 390 && box.y >= 0 && box.bottom <= 760);
            assert.equal(await page.evaluate(({ selector, box }) => document.querySelector(selector).contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)), { selector, box }), true);
        }
        await page.screenshot({ path: evidence + '/mobile-five.png' });
        await click('.nmx-sbd-close'); await page.waitForFunction(() => !document.querySelector('.nmx-sbd-dialog'));
        for (const locale of ['en','zh-TW','ja','ko','es','fr','de','pt-BR','ru','ar','hi']) {
            await open({locale});
            assert.equal(await page.$eval('.nmx-sbd-dialog', node => node.scrollWidth <= node.clientWidth), true, locale + ': no horizontal dialog overflow');
            const toolbar = await rect('.nmx-sbd-toolbar'), add = await rect('.nmx-sbd-add'), switches = await rect('.nmx-sbd-switches');
            assert.ok(add.x >= toolbar.x && add.right <= toolbar.right && switches.x >= toolbar.x && switches.right <= toolbar.right, locale + ': toolbar controls remain within the dialog');
            await click('.nmx-sbd-close');
        }
    });
    assert.deepEqual(errors, []); assert.deepEqual(outgoing, [], 'all editing stays local: no generation or other service request is dispatched');
    await writeFile(evidence + '/verification.json', JSON.stringify({ status: 'passed', suites: 6, desktopViewport: [1512, 878], referenceDialog: [1120, 838], smallViewport: [390, 760], networkRequests: outgoing.length, pageErrors: errors }, null, 2));
});
