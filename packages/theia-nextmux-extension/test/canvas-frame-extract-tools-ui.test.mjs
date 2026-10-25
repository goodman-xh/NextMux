import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url), core = createRequire(require.resolve('@theia/core/package.json'));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));

test('frame menu runs endpoints directly; centred custom picker submits once and preserves failures and ownership', { timeout: 45000 }, async t => {
    const { outputFiles } = await desktop('esbuild').build({
        stdin: { loader: 'tsx', resolveDir: fileURLToPath(new URL('../src/browser/', import.meta.url)), contents: `
import React from 'react';import {createRoot} from 'react-dom/client';import {ReactFlowProvider} from '@xyflow/react';
import {CanvasFrameExtractMenu,CanvasFrameExtractDialog} from './nextmux-comic-canvas-tools';
import {CanvasModalLayer} from './nextmux-comic-canvas-modal';
const root=createRoot(document.querySelector('main'));let mode='',serial=0;
let version={id:'video-v1',assetId:'asset-v1',kind:'video',uri:'captured-v1.mp4',createdAt:'2026-10-04T00:00:00Z',status:'ready',metadata:{durationMs:2345}};
const calls=[],pending=[];let closeCount=0;
const close=()=>{closeCount++;mode='';render();};
const show=(value)=>{mode=value;serial++;render();};
function render(){const captured=version;root.render(<ReactFlowProvider><div className='nmx-board'>
<div className='fixture-toolbar'><button id='open-menu' onClick={()=>show('menu')}>Grab frame</button>
{mode==='menu'&&<CanvasFrameExtractMenu key={serial} locale='en' onClose={close} onPick={choice=>{if(choice==='custom')show('dialog');else{calls.push({versionId:captured.id,selection:{kind:choice}});mode='';render();}}}/>}</div>
{mode==='dialog'&&<CanvasModalLayer locale='en'><CanvasFrameExtractDialog locale='en' version={captured} mediaUrl={uri=>'https://media.test/'+uri} busy={false}
onRun={selection=>{calls.push({versionId:captured.id,selection});return new Promise((resolve,reject)=>pending.push({resolve,reject}));}} onClose={close}/></CanvasModalLayer>}
</div></ReactFlowProvider>);}
window.fixture={calls,pending,show,close,replace(){version={...version,id:'video-v2',assetId:'asset-v2',uri:'captured-v2.mp4'};render();},get closeCount(){return closeCount;}};render();
` }, bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty' }, alias: {
            react: core.resolve('react'), 'react/jsx-runtime': core.resolve('react/jsx-runtime'), 'react-dom/client': core.resolve('react-dom/client'),
            '@theia/core/shared/react': core.resolve('react'), '@theia/core/shared/react-dom': core.resolve('react-dom')
        }
    });
    const puppeteer = (await import(platform.resolve('puppeteer'))).default, browser = await puppeteer.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 1100, height: 800 });
    await page.setRequestInterception(true);
    page.on('request', request => void request.respond(request.url().startsWith('https://media.test/')
        ? { status: 404, body: '' } : { status: 200, contentType: 'text/html', body: '<main class="nmx-desktop-widget nmx-shell"></main>' }));
    await page.goto('https://frame-tools.test/');
    for (const name of ['nextmux.css', 'nextmux-desktop-production.css', 'nextmux-comic-canvas.css'])
        await page.addStyleTag({ content: await readFile(new URL('../src/browser/style/' + name, import.meta.url), 'utf8') });
    await page.addStyleTag({ content: 'html,body{margin:0}main.nmx-shell{display:block;width:1100px;height:800px}.nmx-board{width:1100px;height:800px}.fixture-toolbar{position:absolute;left:750px;top:490px}.nmx-board-frame-dialog{--nmx-panel:#222;--nmx-text:white;--nmx-border:#444;--nmx-muted:#aaa}' });
    await page.addScriptTag({ content: outputFiles[0].text });
    const dialog = '.nmx-board-frame-dialog', submit = dialog + ' .nmx-board-generate';
    for (const kind of ['first', 'last']) {
        await page.click('#open-menu'); await page.waitForSelector('.nmx-board-frame-menu');
        const bounds = await page.$eval('.nmx-board-frame-menu', element => { const r = element.getBoundingClientRect(), bar = document.querySelector('.fixture-toolbar').getBoundingClientRect(); return { right: r.right, top: r.top, barRight: bar.right, barBottom: bar.bottom }; });
        assert.ok(Math.abs(bounds.right - bounds.barRight) < 1 && Math.abs(bounds.top - bounds.barBottom - 6) < 1, 'menu stays right-aligned 6px below its toolbar');
        await page.click(`[data-frame-choice="${kind}"]`);
        assert.equal(await page.$(dialog), null, 'endpoint actions do not create a configuration dialog');
        assert.deepEqual(await page.evaluate(() => window.fixture.calls.at(-1)), { versionId: 'video-v1', selection: { kind } });
    }
    await page.click('#open-menu'); await page.waitForSelector('[data-frame-choice="custom"]'); await page.click('[data-frame-choice="custom"]');
    await page.waitForSelector(dialog);
    const geometry = await page.$eval(dialog, element => { const r = element.getBoundingClientRect(); const field = element.querySelector('input[type=number]'); const f = field.getBoundingClientRect(); return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, hit: field.contains(document.elementFromPoint(f.x + f.width / 2, f.y + f.height / 2)) }; });
    assert.ok(Math.abs(geometry.cx - 550) <= 1 && Math.abs(geometry.cy - 400) <= 1, 'custom picker is centred in its modal');
    assert.equal(geometry.hit, true, 'custom time entry is actually clickable');
    const fill = async value => {
        await page.focus(dialog + ' input[type=number]');
        await page.$eval(dialog + ' input[type=number]', element => element.select());
        await page.keyboard.press('Backspace'); if (value) await page.keyboard.type(value);
        assert.equal(await page.$eval(dialog + ' input[type=number]', element => element.value), value, 'replacement selects the entire decimal time');
    };
    await fill('3'); assert.equal(await page.$eval(submit, element => element.disabled), true);
    await fill('1.234');
    await page.$eval(submit, element => { element.click(); element.click(); });
    await page.waitForFunction(() => window.fixture.pending.length === 1);
    assert.equal(await page.evaluate(() => window.fixture.calls.length), 3, 'synchronous duplicate clicks launch one extraction');
    assert.deepEqual(await page.evaluate(() => window.fixture.calls.at(-1)), { versionId: 'video-v1', selection: { kind: 'time', timeMs: 1234 } });
    assert.equal(await page.$eval(dialog + ' input[type=number]', element => element.disabled), true);
    await page.keyboard.press('Escape'); assert.ok(await page.$(dialog), 'busy Escape cannot abandon an in-flight operation');
    await page.evaluate(() => window.fixture.pending[0].reject(new Error('Fixture extraction failed')));
    await page.waitForSelector(dialog + ' [role=alert]');
    assert.match(await page.$eval(dialog + ' [role=alert]', element => element.textContent), /Fixture extraction failed/);
    assert.equal(await page.$eval(dialog + ' input[type=number]', element => element.value), '1.234');
    await fill('2.345'); await page.click(submit); await page.waitForFunction(() => window.fixture.pending.length === 2);
    assert.deepEqual(await page.evaluate(() => window.fixture.calls.at(-1).selection), { kind: 'last' }, 'duration endpoint resolves the true last decoded frame');
    await page.evaluate(() => window.fixture.pending[1].resolve()); await page.waitForFunction(() => !document.querySelector('.nmx-board-frame-dialog'));

    // A replaced source or unmounted owner must not be closed by an older completed extraction.
    await page.evaluate(() => window.fixture.show('dialog')); await page.waitForSelector(dialog); await page.click(submit);
    await page.waitForFunction(() => window.fixture.pending.length === 3);
    await page.evaluate(() => window.fixture.replace()); await page.waitForFunction(() => document.querySelector('.nmx-board-frame-dialog video').src.endsWith('captured-v2.mp4'));
    const before = await page.evaluate(() => window.fixture.closeCount);
    await page.evaluate(async () => { window.fixture.pending[2].resolve(); await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.ok(await page.$(dialog)); assert.equal(await page.evaluate(() => window.fixture.closeCount), before);
    await page.click(submit); await page.waitForFunction(() => window.fixture.pending.length === 4);
    await page.evaluate(() => window.fixture.close()); await page.waitForFunction(() => !document.querySelector('.nmx-board-frame-dialog'));
    await page.evaluate(() => window.fixture.show('dialog')); await page.waitForSelector(dialog);
    const afterClose = await page.evaluate(() => window.fixture.closeCount);
    await page.evaluate(async () => { window.fixture.pending[3].resolve(); await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.ok(await page.$(dialog)); assert.equal(await page.evaluate(() => window.fixture.closeCount), afterClose);
    assert.deepEqual(errors, []);
});
