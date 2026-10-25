import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const require = createRequire(import.meta.url), core = createRequire(require.resolve('@theia/core/package.json'));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url)), platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const puppeteer = (await import(platform.resolve('puppeteer'))).default;

async function fixture(t) {
    const { outputFiles } = await desktop('esbuild').build({ stdin: { resolveDir: new URL('../src/browser/', import.meta.url).pathname, loader: 'tsx', contents: `
import React from 'react';import {createRoot} from 'react-dom/client';
import {CanvasFloatingForm} from './nextmux-comic-canvas-float';
import {ImeTextarea} from './nextmux-ime-field';
import {useCanvasKeyboard} from './nextmux-comic-canvas-keyboard';
window.events=[];window.commands=[];window.mounts=0;window.unmounts=0;
function Form(){const[value,setValue]=React.useState('');React.useEffect(()=>{window.mounts++;return()=>window.unmounts++},[]);
 return <section><ImeTextarea value={value} onChange={e=>setValue(e.target.value)} onCompositionStart={e=>window.events.push(['start',e.data])}
 onCompositionEnd={e=>window.events.push(['end',e.data])} onBlur={()=>window.events.push(['blur'])}/>
 <button id='form-button'>Settings</button><select id='form-select'><option>Default</option></select></section>}
let locale='en';const root=createRoot(document.querySelector('main'));
function Canvas(){const ref=React.useRef(null);useCanvasKeyboard({root:ref,scopeKey:'fixture',settings:{},onCommand:command=>{window.commands.push(command);return true;},onPaste:()=>false,getViewport:()=>({x:0,y:0,zoom:1}),setViewport:()=>{},onNavigationEnd:()=>{}});
 return <div ref={ref} className='nmx-board'><button id='canvas-outside'>Canvas</button><CanvasFloatingForm title='Fixture' locale={locale}><Form/></CanvasFloatingForm></div>}
function render(){root.render(<Canvas/>)}window.rerender=next=>{locale=next;render()};window.unmount=()=>root.unmount();render();
` }, bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty' }, alias: { react: core.resolve('react'), 'react-dom/client': core.resolve('react-dom/client'), '@theia/core/shared/react': core.resolve('react') } });
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1400, height: 900 }); await page.setRequestInterception(true);
    page.on('request', r => void r.respond({ status: 200, contentType: 'text/html', body: '<main style="--nmx-text:rgb(23, 45, 67);font:13px system-ui"></main>' }));
    await page.goto('https://inline-composition.test/');
    await page.evaluate(() => localStorage.setItem('nextmux.canvas.toolbarModalSize.v1', '{"w":1300,"h":800}'));
    await page.addStyleTag({ content: await readFile(new URL('../src/browser/style/nextmux-comic-canvas-float.css', import.meta.url), 'utf8') });
    await page.addScriptTag({ content: outputFiles[0].text }); await page.waitForSelector('textarea');
    await page.focus('textarea'); await page.$eval('textarea', e => { window.originalTextarea=e;window.events.length=0; });
    const cdp = await page.createCDPSession();
    return { page, errors, compose: text => cdp.send('Input.imeSetComposition', { text, selectionStart:text.length, selectionEnd:text.length }), commit: text => cdp.send('Input.insertText', {text}) };
}

test('inline form keeps its active Chromium IME input through parent, locale, theme and viewport updates', { timeout:30000 }, async t => {
    const { page, compose, commit, errors } = await fixture(t);
    assert.equal(await page.$('[data-canvas-float-toggle],.nmx-canvas-floating-grip,[role="dialog"]'), null);
    await compose('ni'); await page.evaluate(() => window.rerender('ar'));
    await page.waitForFunction(() => document.querySelector('.nmx-canvas-floating-host').dir==='rtl');
    await page.setViewport({width:900,height:600});
    await page.evaluate(() => document.querySelector('main').style.setProperty('--nmx-text','rgb(67, 45, 23)'));
    await compose('你'); await compose('你好');
    assert.deepEqual(await page.evaluate(() => ({same:document.querySelector('textarea')===window.originalTextarea,focused:document.activeElement===window.originalTextarea,events:window.events,value:document.querySelector('textarea').value,mounts:window.mounts,unmounts:window.unmounts})),
        {same:true,focused:true,events:[['start','']],value:'你好',mounts:1,unmounts:0});
    await commit('你好'); await page.keyboard.type('!');
    assert.equal(await page.$eval('textarea',e=>e.value),'你好!');
    assert.equal(await page.$eval('.nmx-canvas-floating-form',e=>getComputedStyle(e).color),'rgb(67, 45, 23)');
    assert.equal(await page.$$eval('body > .nmx-canvas-floating-host',e=>e.length),0);
    assert.equal(await page.evaluate(()=>localStorage.getItem('nextmux.canvas.toolbarModalSize.v1')),'{"w":1300,"h":800}','old preference is neither applied nor erased');
    await page.evaluate(()=>window.unmount());assert.equal(await page.$$eval('.nmx-canvas-floating-host',e=>e.length),0);
    assert.equal(await page.evaluate(()=>window.unmounts),1);assert.deepEqual(errors,[]);
});

test('real canvas capture ignores inline form inputs and buttons but still handles the canvas', {timeout:30000}, async t=>{
    const {page,errors}=await fixture(t);
    for(const selector of ['textarea','#form-button','#form-select']){
        await page.focus(selector);await page.keyboard.press('Delete');await page.keyboard.press('Backspace');
        for(const modifier of ['Meta','Control']){await page.keyboard.down(modifier);await page.keyboard.press('a');await page.keyboard.up(modifier);}
        await page.keyboard.press('Escape');
    }
    assert.deepEqual(await page.evaluate(()=>window.commands),[]);
    assert.equal(await page.$$eval('.nmx-canvas-floating-form.is-inline',e=>e.length),1);
    await page.focus('#canvas-outside');await page.keyboard.press('Delete');
    assert.deepEqual(await page.evaluate(()=>window.commands),['delete']);
    assert.deepEqual(errors,[]);
});
