import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url), core = createRequire(require.resolve('@theia/core/package.json'));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url)), platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const src = fileURLToPath(new URL('../src/browser/', import.meta.url)), base = fileURLToPath(new URL('../../../', import.meta.url));

test('real canvas copy/paste, duplicate and undo retain camera authoring and explicit route bindings', { timeout: 30000 }, async t => {
    const { outputFiles } = await desktop('esbuild').build({ stdin: { loader: 'tsx', resolveDir: src, contents: `
import React from 'react';import {createRoot} from 'react-dom/client';import {ComicCanvas} from './nextmux-comic-canvas';
import {createCanvasDocument} from '@nextmux/comic-core/canvas';import {createStoryboard} from '@nextmux/comic-core/canvas-camera';import {createCanvasNode} from './nextmux-comic-canvas-logic';
const root=createRoot(document.querySelector('main')),now='2026-10-04T10:00:00.000Z',literal='[Pan the camera to the left] authored note';
const make=(id,x)=>({...createCanvasNode('videoGen',{x,y:40},{title:id}),id,title:id,payload:{mode:'textToVideo',modelId:'fixture',prompt:literal,parameters:{resolution:'720p',aspectRatio:'16:9',durationSeconds:5},versions:[]}});
const routeKey='managed:fixed:copied-route';
let canvas={...createCanvasDocument({id:'canvas',projectId:'project',now}),viewport:{x:20,y:20,zoom:1},nodes:[make('clear',350),make('slow',960)],settings:{nodeRoutes:{clear:routeKey,slow:routeKey},nodeCamera:{clear:{selection:{movements:[],speed:'normal'},prefix:''},slow:{selection:{movements:[],speed:'slow'},prefix:''}},nodeStoryboard:{slow:createStoryboard(5)}}},past=[],future=[],clipboard='';
Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{clipboard=value;},readText:async()=>clipboard}});
const route={key:routeKey,connectionId:'fixture',kind:'video',modelId:'fixture',label:'Fixture',source:'fixture',routeKind:'relay',available:true};
const capability={id:'fixture',providerId:'fixture',providerModelId:'fixture',displayName:'Fixture',status:'available',version:'v1',modes:[{mode:'textToVideo',outputVariants:[{id:'720p',resolution:'720p',aspectRatios:['16:9']}],duration:{kind:'fixed',seconds:5},audioGeneration:{mode:'unsupported',defaultEnabled:false}}]};
const props={locale:'en',saveState:'saved',models:{image:[],video:[route]},families:{image:[],video:[{id:'fixture',name:'Fixture',available:true,routes:[route]}]},defaults:{aspectRatio:'16:9',durationSeconds:5},defaultRoute:()=>route,routeOf:node=>canvas.settings.nodeRoutes?.[node.id]===route.key?route:undefined,capabilityOf:()=>({capability}),jobOf:()=>undefined,waiting:new Set(),submitting:new Set(),mediaUrl:uri=>uri,onChange(next,options){if(options.record!==false){past.push(canvas);future=[];}canvas=next;render();},onUndo(){if(past.length){future.push(canvas);canvas=past.pop();render();}},onRedo(){if(future.length){past.push(canvas);canvas=future.pop();render();}},onSetRoute(){},onRun(){throw Error('no paid work');},onExtract(){},onImport(){},onUsePortrait(){},onRetrySave(){},onNotice(){},toolProgress:new Map(),onTool:async()=>false,onCancelTool(){},onPickLut:async()=>undefined,onDirectorCapture:async()=>{},onSaveMarks:async()=>{throw Error('unused')},onDirectorImport:async()=>{throw Error('unused')}};
function render(){root.render(<ComicCanvas {...props} canvas={canvas} canUndo={past.length>0} canRedo={future.length>0}/>)}window.fixture={get canvas(){return canvas},get clipboard(){return clipboard},get past(){return past}};render();
` }, bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty', '.svg': 'dataurl' }, alias: {
        react: core.resolve('react'), 'react/jsx-runtime': core.resolve('react/jsx-runtime'), 'react-dom': core.resolve('react-dom'), 'react-dom/client': core.resolve('react-dom/client'),
        '@nextmux/comic-core/canvas': base + 'packages/comic-core/src/canvas.ts', '@nextmux/comic-core/canvas-camera': base + 'packages/comic-core/src/canvas-camera.ts', '@nextmux/comic-core/canvas-capabilities': base + 'packages/comic-core/src/canvas-capabilities.ts'
    } });
    const puppeteer = (await import(platform.resolve('puppeteer'))).default, browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(5000);
    await page.setViewport({ width: 1600, height: 1000 }); await page.setRequestInterception(true);
    page.on('request', request => void request.respond({ status: 200, contentType: 'text/html', body: '<main></main>' })); await page.goto('https://authoring-copy.test/');
    for (const file of ['nextmux.css', 'nextmux-desktop-production.css', 'nextmux-comic-canvas.css', 'nextmux-comic-canvas-float.css', 'nextmux-comic-canvas-camera.css', 'nextmux-comic-canvas-view-controls.css']) await page.addStyleTag({ content: await readFile(src + 'style/' + file, 'utf8') });
    await page.addStyleTag({ content: await readFile(require.resolve('@xyflow/react/dist/style.css'), 'utf8') });
    await page.addStyleTag({ content: 'html,body,main{margin:0;height:100%}.nmx-board{width:100%;height:100%}main{font:13px system-ui;--theia-foreground:#eee;--theia-editor-background:#222}' });
    await page.addScriptTag({ content: outputFiles[0].text }); await page.waitForSelector('[data-id="clear"] header');
    const shortcut = async key => { await page.focus('.nmx-board'); await page.keyboard.down('Control'); await page.keyboard.press(key); await page.keyboard.up('Control'); };
    const copyPaste = async (id, count) => {
        await page.click('[data-id="' + id + '"] header'); await page.waitForSelector('[data-node-panel="' + id + '"]'); await shortcut('c');
        await page.waitForFunction(id => JSON.parse(fixture.clipboard || '{}').nodes?.[0]?.id === id, {}, id);
        await page.evaluate(() => { const data = new DataTransfer(); data.setData('text/plain', fixture.clipboard); document.querySelector('.nmx-board').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); });
        await page.waitForFunction(count => fixture.canvas.nodes.length === count, {}, count);
        await page.waitForFunction(id => document.querySelector('[data-node-panel]')?.dataset.nodePanel !== id, {}, id);
        return page.$eval('[data-node-panel]', element => element.dataset.nodePanel);
    };
    const copiedClear = await copyPaste('clear', 3); assert.notEqual(copiedClear, 'clear');
    const inspect = () => page.evaluate(() => { const id = document.querySelector('[data-node-panel]').dataset.nodePanel; return {
        id, body: document.querySelector('[data-node-panel] textarea').value, camera: fixture.canvas.settings.nodeCamera[id], route: fixture.canvas.settings.nodeRoutes[id],
        tags: [...document.querySelectorAll('.nmx-camera-tags')].map(value => value.textContent), storyboard: fixture.canvas.settings.nodeStoryboard?.[id]
    }; });
    let copied = await inspect(); assert.equal(copied.body, '[Pan the camera to the left] authored note'); assert.deepEqual(copied.camera, { selection: { movements: [], speed: 'normal' }, prefix: '' }); assert.deepEqual(copied.tags, []);
    assert.equal(copied.route, 'managed:fixed:copied-route');
    await shortcut('z'); await page.waitForFunction(() => fixture.canvas.nodes.length === 2);
    assert.equal(await page.evaluate(id => fixture.canvas.settings.nodeCamera[id], copiedClear), undefined, 'one undo removes the copied authoring state');
    assert.equal(await page.evaluate(id => fixture.canvas.settings.nodeRoutes[id], copiedClear), undefined, 'one undo also removes the copied route binding');
    await page.waitForFunction(() => !document.querySelector('[data-node-panel]'));
    await shortcut('y'); await page.waitForFunction(() => fixture.canvas.nodes.length === 3);
    assert.deepEqual(await page.evaluate(id => fixture.canvas.settings.nodeCamera[id], copiedClear), copied.camera);
    assert.equal(await page.$('[data-node-panel]'), null, 'redo restores content without resurrecting the cleared selection');
    await page.click('[data-id="' + copiedClear + '"] header'); await page.waitForSelector('[data-node-panel="' + copiedClear + '"]');
    await shortcut('d'); await page.waitForFunction(() => fixture.canvas.nodes.length === 4); await page.waitForFunction(id => document.querySelector('[data-node-panel]')?.dataset.nodePanel !== id, {}, copiedClear);
    copied = await inspect(); assert.equal(copied.body, '[Pan the camera to the left] authored note'); assert.deepEqual(copied.tags, []); assert.deepEqual(copied.camera, { selection: { movements: [], speed: 'normal' }, prefix: '' });
    assert.equal(copied.route, 'managed:fixed:copied-route', 'the actual duplicate command preserves the original explicit route');
    const copiedSlow = await copyPaste('slow', 5); assert.notEqual(copiedSlow, 'slow'); copied = await inspect();
    assert.equal(copied.body, '[Pan the camera to the left] authored note'); assert.deepEqual(copied.camera, { selection: { movements: [], speed: 'slow' }, prefix: '' }); assert.equal(copied.tags.length, 1); assert.match(copied.tags[0], /Slow/i);
    assert.equal(copied.route, 'managed:fixed:copied-route');
    assert.ok(copied.storyboard); assert.ok(await page.$('[data-node-panel] button.is-camera.is-set:not([aria-expanded])'), 'copied storyboard remains available in its actual control');
    assert.deepEqual(errors, []);
});
