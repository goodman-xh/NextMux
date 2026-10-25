import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
const require = createRequire(import.meta.url), core = createRequire(require.resolve('@theia/core/package.json'));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url)), platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const base = fileURLToPath(new URL('../../../', import.meta.url));

test('real camera tags preserve authored control-like text when clearing, cancelling and reloading a persisted selection', { timeout: 30000 }, async t => {
    const { outputFiles } = await desktop('esbuild').build({ stdin: { resolveDir: base + 'packages/theia-nextmux-extension/src/browser', loader: 'tsx', contents: `
import React from 'react';import {createRoot} from 'react-dom/client';import {CameraTags,CameraControl} from './nextmux-comic-canvas-camera';
import {composeCanvasCameraPrompt as compose,deriveCanvasCameraPrompt as derive} from './nextmux-comic-canvas-camera-state';
const root=createRoot(document.querySelector('main'));let seed,serial=0,current,confirmCount=0;
function Editor(){const [saved,setSaved]=React.useState(seed),[open,setOpen]=React.useState(false);const view=derive(saved.prompt,saved.state);current={saved,view};
 const apply=selection=>{confirmCount++;setSaved(compose(view.body,selection));setOpen(false);};
 return <><textarea id='body' value={view.body} readOnly/><button id='open' data-generation={serial} onClick={()=>setOpen(true)}>Camera</button>{view.state&&<CameraTags locale='en' selection={view.state.selection} onChange={apply}/>}{open&&<CameraControl locale='en' presentation='dialog' selection={view.state?.selection} onConfirm={apply} onCancel={()=>setOpen(false)}/>}</>;}
function render(){root.render(<Editor key={++serial}/>);}window.fixture={open(body){seed=compose(body,{movements:['zoom_in'],speed:'normal'});render();return serial;},reload(){seed=JSON.parse(JSON.stringify(current.saved));render();return serial;},read:()=>current,confirmCount:()=>confirmCount};
` }, bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty' }, alias: {
        react: core.resolve('react'), 'react-dom/client': core.resolve('react-dom/client'), '@nextmux/comic-core/canvas-camera': base + 'packages/comic-core/src/canvas-camera.ts'
    } });
    const puppeteer = (await import(platform.resolve('puppeteer'))).default, browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(4000);
    await page.setViewport({width:1000,height:850}); await page.setContent('<main></main>'); await page.addStyleTag({content:await readFile(new URL('../src/browser/style/nextmux-comic-canvas-camera.css',import.meta.url),'utf8')}); await page.addScriptTag({ content: outputFiles[0].text });
    for (const body of ['[Pan the camera to the left]\nStoryboard note follows', '[Zoom toward the subject] quoted instruction', '  [Pan the camera to the left]\n\n']) {
        await page.evaluate(body => fixture.open(body), body); await page.waitForFunction(body => document.querySelector('#body')?.value === body, {}, body);
        assert.equal(await page.$eval('#body', node => node.value), body);
        assert.equal(await page.$$eval('[data-camera-tag]', nodes => nodes.map(node => node.dataset.cameraTag).join(',')), 'zoom_in');
        const before = await page.evaluate(() => ({ state: fixture.read(), calls: fixture.confirmCount() }));
        await page.click('#open'); await page.click('[data-camera-move=pan_right]'); await page.keyboard.press('Escape');
        assert.deepEqual(await page.evaluate(() => ({ state: fixture.read(), calls: fixture.confirmCount() })), before, 'cancelling an edited camera draft changes neither body nor persisted selection');
        await page.click('[data-camera-action=clear]'); await page.waitForSelector('.nmx-camera-tags', { hidden: true });
        assert.equal(await page.$eval('#body', node => node.value), body);
        assert.deepEqual(await page.evaluate(() => fixture.read().saved), { prompt: body, state: { selection: { movements: [], speed: 'normal' }, prefix: '' } });
        const generation = await page.evaluate(() => fixture.reload()); await page.waitForFunction(generation => document.querySelector('#open')?.dataset.generation === String(generation), {}, generation); assert.equal(await page.$eval('#body', node => node.value), body);
        assert.equal(await page.$('.nmx-camera-tags'), null, 'a persisted explicit clear never turns authored text back into inferred tags');
        await page.click('#open'); assert.equal(await page.$$eval('[data-camera-move][aria-pressed=true]', nodes => nodes.length), 0);
        await page.keyboard.press('Escape'); assert.equal(await page.$eval('#body', node => node.value), body);
    }
    assert.deepEqual(errors, []);
});
