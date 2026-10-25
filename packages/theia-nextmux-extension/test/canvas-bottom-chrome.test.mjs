import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const puppeteer = (await import(platform.resolve('puppeteer'))).default;
const base = fileURLToPath(new URL('../../../', import.meta.url));
const src = fileURLToPath(new URL('../src/browser/', import.meta.url));

// Actual ComicCanvas, ReactFlow, CanvasModalLayer and product CSS. The host remains
// 1400px wide while its canvas changes width: window media queries cannot mask a
// regression when the desktop's side drawers make the canvas narrow.
test('canvas chrome keeps hover sizes, container spacing, hit targets and top-layer tooltips', { timeout: 60000 }, async t => {
    const { outputFiles } = await desktop('esbuild').build({ stdin: { resolveDir: src, loader: 'tsx', contents: `
import React from 'react';import {createRoot} from 'react-dom/client';
import {ComicCanvas} from './nextmux-comic-canvas';import {CanvasModalLayer} from './nextmux-comic-canvas-modal';
import {createCanvasDocument} from '@nextmux/comic-core/canvas';import {createCanvasNode} from './nextmux-comic-canvas-logic';
const root=createRoot(document.querySelector('main')),now='2026-10-03T00:00:00.000Z';
const node={...createCanvasNode('videoGen',{x:260,y:70},{title:'Fixture video'}),id:'gen',title:'Fixture video',size:{width:360,height:260}};
node.payload={...node.payload,mode:'textToVideo',modelId:'fixture',prompt:'A test-only draft',parameters:{aspectRatio:'16:9',resolution:'720p',durationSeconds:5}};
let canvas={...createCanvasDocument({id:'canvas',projectId:'fixture',now}),viewport:{x:1,y:1,zoom:1},nodes:[node]},modal=false;
const route={key:'fixture',modelId:'fixture',kind:'video',source:'Fixture',routeKind:'relay',available:true};
const mode={mode:'textToVideo',outputVariants:[{id:'720p',resolution:'720p',aspectRatios:['16:9']}],duration:{kind:'fixed',seconds:5},audioGeneration:{mode:'unsupported',defaultEnabled:false}};
const capability={id:'fixture',providerId:'fixture',providerModelId:'fixture',displayName:'Fixture',status:'available',version:'v1',modes:[mode]};
const calls={runs:[],tools:[]};const props={locale:'en',saveState:'saved',models:{image:[],video:[route]},families:{image:[],video:[{id:'fixture',name:'Fixture',vendor:'fixture',available:true,routes:[route]}]},defaultRoute:()=>route,routeOf:()=>route,capabilityOf:()=>({capability}),jobOf:()=>undefined,waiting:new Set(),submitting:new Set(),mediaUrl:()=>'',defaults:{aspectRatio:'16:9',durationSeconds:5},
onChange(next){canvas=next;render();},onUndo(){},onRedo(){},onSetRoute(){},onRun:ids=>calls.runs.push(ids),onExtract(){},onImport(){},onUsePortrait(){},onRetrySave(){},onNotice(){},toolProgress:new Map(),onTool:async(...args)=>{calls.tools.push(args);return false;},onCancelTool(){},onPickLut:async()=>undefined,onDirectorCapture:async()=>{},onSaveMarks:async()=>{throw Error('unused');},onDirectorImport:async()=>{throw Error('unused');}};
function render(){root.render(<><ComicCanvas {...props} canvas={canvas} canUndo={false} canRedo={false}/>{modal&&<CanvasModalLayer locale='en'><section role='dialog' aria-label='Native modal tooltip fixture'><button id='modal-bottom' title='Bottom dialog action' style={{position:'fixed',bottom:12,left:'50%',width:180,height:32}}>Bottom action</button></section></CanvasModalLayer>}</>);}
window.fixture={calls,get canvas(){return canvas;},position(x,y){canvas={...canvas,nodes:canvas.nodes.map(n=>({...n,position:{x,y}}))};render();},empty(){canvas={...canvas,nodes:[],edges:[],groups:[]};render();},modal(value){modal=value;render();}};render();
` }, bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty', '.svg': 'dataurl' }, alias: {
        react: core.resolve('react'), 'react/jsx-runtime': core.resolve('react/jsx-runtime'), 'react-dom': core.resolve('react-dom'), 'react-dom/client': core.resolve('react-dom/client'),
        '@nextmux/comic-core/canvas': base + 'packages/comic-core/src/canvas.ts', '@nextmux/comic-core/canvas-capabilities': base + 'packages/comic-core/src/canvas-capabilities.ts'
    } });
    const evidence = base + '.nextmux-run/canvas-bottom-chrome-review'; await mkdir(evidence, { recursive: true });
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage(); page.setDefaultTimeout(6000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 1400, height: 1000 });
    await page.setRequestInterception(true); page.on('request', request => void request.respond({ status: 200, contentType: 'text/html', body: '<main class="nmx-shell"></main>' }));
    await page.goto('https://canvas-chrome.fixture/');
    for (const name of ['nextmux-comic-canvas.css', 'nextmux-comic-canvas-float.css', 'nextmux-comic-canvas-dock.css', 'nextmux-comic-canvas-view-controls.css']) {
        await page.addStyleTag({ content: await readFile(src + 'style/' + name, 'utf8') });
    }
    await page.addStyleTag({ content: await readFile(require.resolve('@xyflow/react/dist/style.css'), 'utf8') });
    await page.addStyleTag({ content: 'html,body{height:100%;margin:0;background:#171717}main{position:absolute;left:20px;top:20px;width:1100px;height:760px;--nmx-bg:#171717;--nmx-panel:#222;--nmx-panel-2:#333;--nmx-text:#eee;--nmx-muted:#aaa;--nmx-border:#555;font:13px system-ui}' });
    await page.addStyleTag({ content: (await readFile(core.resolve('@vscode/codicons/dist/codicon.css'), 'utf8')).replace(/url\([^)]*codicon\.ttf[^)]*\)/g, 'url(data:font/ttf;base64,' + (await readFile(core.resolve('@vscode/codicons/dist/codicon.ttf'))).toString('base64') + ')') });
    await page.addScriptTag({ content: outputFiles[0].text });
    await page.waitForSelector('[data-id="gen"] header');
    const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > .5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > .5;
    const rect = selector => page.$eval(selector, element => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; });
    const resize = async width => {
        await page.$eval('main', (element, value) => element.style.width = value + 'px', width);
        await page.waitForFunction(width => document.querySelector('.nmx-board').getBoundingClientRect().width === width, {}, width);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };
    await t.test('NodeActions hover never changes the button or toolbar bounds', async () => {
        await page.click('[data-id="gen"] header'); await page.waitForSelector('.nmx-board-toolbar button');
        await page.mouse.move(1300, 900);
        const action = '.nmx-board-toolbar button[aria-label="Pin"]';
        const before = { button: await rect(action), toolbar: await rect('.nmx-board-toolbar') };
        await page.hover(action); await page.waitForSelector('.nmx-surface-tooltip');
        const after = { button: await rect(action), toolbar: await rect('.nmx-board-toolbar') };
        assert.deepEqual(after, before, 'hover reveals an independent tooltip without putting text into the toolbar layout');
        assert.match(await page.$eval('.nmx-surface-tooltip', element => element.textContent), /Pin/);
        assert.equal(await page.$eval('.nmx-surface-tooltip', element => element.closest('.nmx-board-toolbar') !== null), false);
        await page.screenshot({ path: evidence + '/node-hover.png' });
    });
    await t.test('navigation, main dock and statistics never overlap within 1100/900/760/600px canvases', async () => {
        await page.mouse.move(1300, 900);
        for (const width of [1100, 900, 760, 600]) {
            await resize(width);
            const board = await rect('.nmx-board');
            const boxes = await Promise.all(['.nmx-board-navigation', '.nmx-board-dock', '.nmx-board-statistics'].map(rect));
            for (const box of boxes) assert.ok(box.left >= board.left && box.right <= board.right && box.top >= board.top && box.bottom <= board.bottom, `${width}px: each control group stays in the actual canvas bounds`);
            for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) assert.equal(overlap(boxes[a], boxes[b]), false, `${width}px: bottom chrome groups ${a}/${b} do not cover each other`);
            await page.screenshot({ path: evidence + '/bottom-' + width + '.png' });
        }
    });
    await t.test('dock hit targets stay on top when a real node form crosses the bottom controls', async () => {
        await resize(1100); await page.evaluate(() => fixture.position(365, 340));
        await page.waitForSelector('.nmx-board-panel-layer');
        // Position the real node so its attached form crosses the dock centre;
        // do not inject an artificial z-index overlay into the fixture.
        const dock = await rect('.nmx-board-dock'), form = await rect('.nmx-board-panel-layer');
        await page.evaluate(delta => { const n = fixture.canvas.nodes[0]; fixture.position(n.position.x, n.position.y + delta); }, dock.top + dock.height / 2 - form.top - form.height / 2);
        await page.waitForFunction(() => { const a = document.querySelector('.nmx-board-dock').getBoundingClientRect(), b = document.querySelector('.nmx-board-panel-layer').getBoundingClientRect(); return b.top < a.bottom && b.bottom > a.top; });
        const hits = await page.$$eval('.nmx-board-dock button:not([hidden])', buttons => buttons.filter(button => button.getClientRects().length).map(button => {
            const r = button.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return { label: button.getAttribute('aria-label'), topmost: button === hit || button.contains(hit) };
        }));
        assert.ok(hits.length >= 5); assert.deepEqual(hits.filter(hit => !hit.topmost), [], 'all dock buttons receive pointer events above the intersecting node form');
        await page.hover('.nmx-board-dock button[aria-label="Add a node"]'); await page.waitForSelector('.nmx-surface-tooltip');
        const tip = await rect('.nmx-surface-tooltip'), button = await rect('.nmx-board-dock button[aria-label="Add a node"]');
        assert.ok(tip.bottom <= button.top, 'bottom canvas controls explain themselves above the dock even with unused space below the canvas');
        await page.screenshot({ path: evidence + '/form-behind-dock.png' });
    });
    await t.test('reference view controls toggle grid/minimap, keep the zoom menu in bounds and expose working select-all help', async () => {
        await resize(600); await page.mouse.move(1300, 900);
        const pressed = selector => page.$eval(selector, e => e.getAttribute('aria-pressed'));
        const grid = '.nmx-board-view-capsule button[aria-label="Grid"]', minimap = '.nmx-board-view-capsule button[aria-label="Minimap"]';
        const before = await pressed(grid); await page.click(grid); assert.notEqual(await pressed(grid), before); await page.click(grid); assert.equal(await pressed(grid), before);
        await page.click(minimap); await page.waitForSelector('.react-flow__minimap'); await page.click(minimap); await page.waitForFunction(() => !document.querySelector('.react-flow__minimap'));
        await page.click('button[aria-label="Zoom"]'); await page.waitForSelector('.nmx-board-zoom-menu');
        const board = await rect('.nmx-board'), menu = await rect('.nmx-board-zoom-menu');
        assert.equal(menu.width, 180); assert.ok(menu.top >= board.top && menu.bottom < board.bottom && menu.left >= board.left && menu.right <= board.right);
        await page.click('button[aria-label="Zoom to 50%"]'); await page.waitForFunction(() => Math.abs(fixture.canvas.viewport.zoom - .5) < .001);
        await page.click('button[aria-label="Zoom to 100%"]'); await page.waitForFunction(() => fixture.canvas.viewport.zoom === 1);
        await page.focus('input[aria-label="Navigation sensitivity"]'); await page.keyboard.press('End');
        await page.waitForFunction(() => document.querySelector('input[aria-label="Navigation sensitivity"]').value === '3');
        await page.focus('input[aria-label="Shift speed multiplier"]'); await page.keyboard.press('End');
        await page.waitForFunction(() => document.querySelector('input[aria-label="Shift speed multiplier"]').value === '8');
        await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.nmx-board-zoom-menu'));
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Zoom');
        await page.click('button[aria-label="Shortcuts"]'); await page.waitForSelector('dialog:modal .nmx-canvas-guide');
        const guideText = await page.$eval('.nmx-canvas-guide-keys', e => e.textContent);
        for (const label of ['Select all', 'Alt + drag', 'W / A / S / D', 'F2', 'Shift']) assert.ok(guideText.includes(label), label);
        await page.screenshot({ path: evidence + '/canvas-guide.png' });
        const original = await page.evaluate(() => JSON.stringify(fixture.canvas));
        await page.keyboard.press('Backspace'); assert.equal(await page.evaluate(() => JSON.stringify(fixture.canvas)), original, 'guide blocks deletion of canvas nodes');
        await page.$eval('.nmx-canvas-guide-body', e => { e.scrollTop = e.scrollHeight; });
        await page.waitForFunction(() => document.querySelector('.nmx-canvas-guide nav .is-active')?.textContent === '3D world');
        await page.$$eval('.nmx-canvas-guide nav button', buttons => buttons.find(button => button.textContent === 'Shortcuts').click());
        await page.waitForFunction(() => document.querySelector('.nmx-canvas-guide-body').scrollTop < 10);
        await page.click('.nmx-canvas-guide-select-all'); await page.waitForFunction(() => !document.querySelector(':modal'));
        await page.waitForFunction(() => document.querySelectorAll('.react-flow__node.selected').length === fixture.canvas.nodes.length);
        await resize(1100);
    });
    await t.test('a bottom tooltip stays inside its native dialog top layer and inside viewport bounds', async () => {
        await page.evaluate(() => fixture.modal(true)); await page.waitForSelector('dialog:modal #modal-bottom');
        await page.hover('#modal-bottom'); await page.waitForFunction(() => document.querySelector('.nmx-surface-tooltip')?.textContent === 'Bottom dialog action');
        assert.equal(await page.$eval('.nmx-surface-tooltip', element => Boolean(element.closest('dialog:modal'))), true, 'the tooltip is hosted by the real top-layer dialog, not the inert document body');
        const tip = await rect('.nmx-surface-tooltip'), button = await rect('#modal-bottom');
        assert.ok(tip.top >= 0 && tip.left >= 0 && tip.right <= 1400 && tip.bottom <= button.top, 'bottom tooltip is fully above its trigger and not clipped at the viewport edge');
        assert.equal(await page.$eval('.nmx-surface-tooltip', element => { const r = element.getBoundingClientRect(); element.style.pointerEvents = 'auto'; const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); element.style.pointerEvents = 'none'; return hit === element || element.contains(hit); }), true, 'native dialog does not paint over the tooltip');
        await page.screenshot({ path: evidence + '/dialog-bottom-tip.png' });
        // A transformed top-layer host establishes a nonzero containing block.
        // This fixture-only offset exercises the coordinate compensation using
        // the real tooltip/modal implementations, rather than a mocked formula.
        await page.mouse.move(1300, 200);
        await page.$eval('dialog:modal', element => element.style.transform = 'translate(43px, 17px)');
        await page.hover('#modal-bottom'); await page.waitForFunction(() => document.querySelector('.nmx-surface-tooltip')?.textContent === 'Bottom dialog action');
        const shiftedTip = await rect('.nmx-surface-tooltip'), shiftedButton = await rect('#modal-bottom');
        assert.ok(Math.abs(shiftedTip.left + shiftedTip.width / 2 - shiftedButton.left - shiftedButton.width / 2) < .5, 'tooltip remains centred on a trigger inside an offset native dialog');
        assert.ok(Math.abs(shiftedButton.top - shiftedTip.bottom - 8) < .5, 'tooltip keeps its 8px gap after compensating for the dialog containing-block origin');
        await page.screenshot({ path: evidence + '/dialog-offset-tip.png' });
        await page.evaluate(() => fixture.modal(false)); await page.waitForFunction(() => !document.querySelector(':modal'));
    });
    await t.test('add menu and empty canvas start with image/video creation and never offer a new text node', async () => {
        await page.evaluate(() => fixture.empty());
        await page.waitForSelector('.nmx-board-empty');
        assert.equal(await page.$$eval('.nmx-board-empty button', buttons => buttons.length), 0, 'the empty view only explains the existing add menu instead of creating a text node');
        await page.click('.nmx-board-dock button[aria-label="Add a node"]');
        await page.waitForSelector('.nmx-board-menu');
        const labels = await page.$$eval('.nmx-board-menu [role="menuitem"]', buttons => buttons.map(button => button.textContent.trim()));
        assert.deepEqual(labels.slice(0, 6), ['Image generation', 'Video generation', 'Frame grab', 'Composition', 'Director stage', '3D world']);
        assert.equal(labels.includes('Text'), false);
        await page.click('.nmx-board-menu button[role="menuitem"]:nth-of-type(2)');
        await page.waitForFunction(() => fixture.canvas.nodes.length === 1);
        assert.equal(await page.evaluate(() => fixture.canvas.nodes[0].kind), 'videoGen');
        assert.equal(await page.$('[data-canvas-float-toggle]'), null);
    });
    assert.deepEqual(await page.evaluate(() => fixture.calls), { runs: [], tools: [] }, 'this UI regression never invokes paid generation or media processing');
    assert.deepEqual(errors, []);
});
