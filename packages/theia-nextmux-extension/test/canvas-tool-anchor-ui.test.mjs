import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url), core = createRequire(require.resolve('@theia/core/package.json'));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const src = fileURLToPath(new URL('../src/browser/', import.meta.url)), repo = fileURLToPath(new URL('../../../', import.meta.url));

// Actual ComicCanvas/ReactFlow/menus and desktop CSS. Only external service callbacks
// are mocked: viewport changes below come from real pointer and zoom-control events.
test('media tool menus keep their toolbar anchor through pan, zoom, node drag and resize', { timeout: 60000 }, async t => {
    const { outputFiles } = await desktop('esbuild').build({ stdin: { loader: 'tsx', resolveDir: src, contents: `
import React from 'react';import {createRoot} from 'react-dom/client';
import {ComicCanvas} from './nextmux-comic-canvas';import {createCanvasDocument} from '@nextmux/comic-core/canvas';
const root=createRoot(document.querySelector('main')),now='2026-10-04T00:00:00Z';
const make=(kind,y=250)=>{const v={id:kind+'-v1',assetId:kind+'-asset',kind,uri:kind==='image'?'fixture.png':'fixture.mp4',createdAt:now,status:'ready',metadata:{width:640,height:360,durationMs:2500}};return {...createCanvasDocument({id:'canvas',projectId:'fixture',now}),viewport:{x:0,y:0,zoom:1},nodes:[{id:'media',title:'Selected '+kind,kind,position:{x:520,y},size:{width:480,height:240},payload:{versions:[v],currentVersionId:v.id}}]};};
let canvas=make('image'),serial=0;const calls={runs:[],tools:[],extracts:[],changes:[]};
const props={locale:'en',saveState:'saved',canUndo:false,canRedo:false,models:{image:[],video:[]},families:{image:[],video:[]},defaultRoute:()=>undefined,routeOf:()=>undefined,capabilityOf:()=>({}),jobOf:()=>undefined,waiting:new Set(),submitting:new Set(),mediaUrl:uri=>uri.endsWith('.png')?'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="%234a7898"/></svg>':'',defaults:{aspectRatio:'16:9',durationSeconds:5},
onChange(next,options){canvas=next;calls.changes.push({record:options?.record!==false});render();},onUndo(){},onRedo(){},onSetRoute(){},onRun:ids=>calls.runs.push(ids),onExtract(){},onExtractVersion:async(...args)=>{calls.extracts.push(args);throw Error('No extraction is permitted in this layout test');},onImport(){},onUsePortrait(){},onRetrySave(){},onNotice(){},toolProgress:new Map(),onTool:async(...args)=>{calls.tools.push(args);return false;},onCancelTool(){},onPickLut:async()=>undefined,onDirectorCapture:async()=>{},onSaveMarks:async()=>{throw Error('unused');},onDirectorImport:async()=>{throw Error('unused');}};
function render(){root.render(<ComicCanvas key={serial} {...props} canvas={canvas}/>);}
window.fixture={calls,get canvas(){return canvas;},reset(kind,y=250){canvas=make(kind,y);serial++;render();}};render();
` }, bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty', '.svg': 'dataurl' }, alias: {
        react: core.resolve('react'), 'react/jsx-runtime': core.resolve('react/jsx-runtime'), 'react-dom': core.resolve('react-dom'), 'react-dom/client': core.resolve('react-dom/client'),
        '@nextmux/comic-core/canvas': repo + 'packages/comic-core/src/canvas.ts', '@nextmux/comic-core/canvas-capabilities': repo + 'packages/comic-core/src/canvas-capabilities.ts'
    } });
    const puppeteer = (await import(platform.resolve('puppeteer'))).default, browser = await puppeteer.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage(), errors = []; page.setDefaultTimeout(6000); page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 1440, height: 1000 });
    await page.setRequestInterception(true); page.on('request', request => void request.respond({ status: 200, contentType: 'text/html', body: '<main class="nmx-desktop-widget nmx-shell"></main>' }));
    await page.goto('https://canvas-tool-anchor.test/');
    for (const name of ['nextmux.css', 'nextmux-desktop-production.css', 'nextmux-comic-canvas.css', 'nextmux-comic-canvas-float.css', 'nextmux-comic-canvas-view-controls.css', 'nextmux-comic-canvas-dock.css'])
        await page.addStyleTag({ content: await readFile(src + 'style/' + name, 'utf8') });
    await page.addStyleTag({ content: await readFile(require.resolve('@xyflow/react/dist/style.css'), 'utf8') });
    await page.addStyleTag({ content: 'html,body{height:100%;margin:0}main.nmx-shell{position:absolute;inset:12px;display:block;--nmx-bg:#171717;--nmx-panel:#222;--nmx-panel-2:#333;--nmx-text:#eee;--nmx-muted:#aaa;--nmx-border:#555;--nmx-accent:#b18cdb;font:13px system-ui}.nmx-board{width:100%;height:100%}' });
    await page.addScriptTag({ content: outputFiles[0].text });
    const frameMenu = '.nmx-board-frame-menu', toolMenu = '.nmx-board-tools:not(.nmx-board-frame-menu)';
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const near = (a, b, label) => assert.ok(Math.abs(a - b) < 1, `${label}: ${a} ≈ ${b}`);
    const geometry = selector => page.evaluate(selector => {
        const menu = document.querySelector(selector), toolbar = document.querySelector('.nmx-board-toolbar'), board = document.querySelector('.nmx-board');
        const rect = element => { const r = element.getBoundingClientRect(); return { left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height }; };
        return { menu:rect(menu),toolbar:rect(toolbar),board:rect(board),font:getComputedStyle(menu.querySelector('button')).fontSize,maxHeight:getComputedStyle(menu).maxHeight,scrollTop:menu.scrollTop,scrollHeight:menu.scrollHeight,clientHeight:menu.clientHeight,same:menu===window.originalMenu };
    }, selector);
    const anchored = async (selector, baseline) => {
        await settle(); const g = await geometry(selector);
        near(g.menu.top, g.toolbar.bottom + 6, 'menu remains 6px below toolbar');
        near(g.menu.right, g.toolbar.right, 'menu keeps the toolbar right edge');
        if (baseline) {
            near(g.menu.width, baseline.menu.width, 'menu CSS width stays fixed');
            assert.equal(g.font, baseline.font, 'font does not scale with the node');
            assert.equal(g.same, true, 'moving the canvas preserves the same menu DOM');
        }
        return g;
    };
    const open = async (kind, frame = false, y = 250) => {
        await page.setViewport({ width: 1440, height: 1000 });
        await page.evaluate(({ kind, y }) => fixture.reset(kind, y), { kind, y });
        await page.waitForSelector('[data-id="media"] header'); await settle();
        await page.click('[data-id="media"] header');
        const icon = frame ? 'device-camera' : 'tools';
        const trigger = await page.waitForSelector(`.nmx-board-toolbar button:has(.codicon-${icon})`); assert.ok(trigger); await trigger.click();
        const selector = frame ? frameMenu : toolMenu; await page.waitForSelector(selector); await settle();
        await page.$eval(selector, element => { window.originalMenu = element; });
        return { selector, baseline: await anchored(selector) };
    };
    const pan = async (dx, dy) => {
        const start = await page.evaluate(({ dx, dy }) => {
            const b = document.querySelector('.nmx-board').getBoundingClientRect();
            for (const y of [b.top+60,b.bottom-150,b.top+b.height/2]) for (const x of [b.left+70,b.right-70,b.left+b.width/2]) {
                if(x+dx<b.left+5||x+dx>b.right-5||y+dy<b.top+5||y+dy>b.bottom-5)continue;
                const hit=document.elementFromPoint(x,y);if(hit?.classList.contains('react-flow__pane'))return {x,y};
            }
        }, { dx, dy });
        assert.ok(start, `uncovered pane for actual ${dx},${dy} pan`);
        const before = await page.evaluate(() => ({ viewport:fixture.canvas.viewport,positions:fixture.canvas.nodes.map(node=>node.position) }));
        await page.mouse.move(start.x,start.y); await page.mouse.down({ button:'middle' });
        await page.mouse.move(start.x+dx,start.y+dy,{steps:8}); await page.mouse.up({button:'middle'});
        await page.waitForFunction(({x,y})=>Math.abs(fixture.canvas.viewport.x-x)<1&&Math.abs(fixture.canvas.viewport.y-y)<1,{}, {x:before.viewport.x+dx,y:before.viewport.y+dy});
        assert.deepEqual(await page.evaluate(()=>fixture.canvas.nodes.map(node=>node.position)),before.positions,'pan never changes source node coordinates');
    };
    for (const frame of [false,true]) await t.test(frame ? 'frame menu follows a video toolbar without flipping or resizing' : 'long image tool menu follows its toolbar without flipping or resizing', async () => {
        const { selector,baseline } = await open(frame?'video':'image',frame);
        // Both horizontal edges and both vertical directions: the menu is allowed
        // outside the board, rather than jumping to a different side of its node.
        for(const [dx,dy] of [[-650,0],[1120,0],[-470,0],[0,540],[0,-700],[0,160]]) {
            await pan(dx,dy); const g=await anchored(selector,baseline);
            near(g.menu.height,baseline.menu.height,'pan never shrinks the menu to remaining anchor space');
            assert.equal(g.maxHeight,baseline.maxHeight,'pan does not change the board-based height budget');
        }
        await page.click('button[aria-label="Zoom"]'); await page.click('button[aria-label="Zoom to 50%"]');
        await page.waitForFunction(()=>fixture.canvas.viewport.zoom===.5); await anchored(selector,baseline);
        await page.click('button[aria-label="Zoom to 100%"]'); await page.waitForFunction(()=>fixture.canvas.viewport.zoom===1);
        await page.click('button[aria-label="Zoom"]'); await anchored(selector,baseline);
        const before = await page.evaluate(()=>fixture.canvas.nodes[0].position);
        const dragStart = await page.$eval('[data-id="media"] header',header=>{
            const r=header.getBoundingClientRect();for(const fraction of [.95,.05,.5]){const x=r.left+r.width*fraction,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);if(header.contains(hit))return{x,y};}
        });
        assert.ok(dragStart,'an exposed part of the actual node header remains draggable');
        await page.mouse.move(dragStart.x,dragStart.y);await page.mouse.down();await page.mouse.move(dragStart.x+70,dragStart.y+30,{steps:8});await page.mouse.up();
        await page.waitForFunction(before=>fixture.canvas.nodes[0].position.x!==before.x,{},before);
        const dragged=await anchored(selector,baseline);near(dragged.menu.height,baseline.menu.height,'node drag does not change menu height');
        await page.setViewport({width:1200,height:760});const resized=await anchored(selector,baseline);
        await pan(-100,-50);const moved=await anchored(selector,baseline);
        near(moved.menu.height,resized.menu.height,'after resize, pan retains the same board-height limit');
    });
    await t.test('the video toolbar switches exclusively between tools and frame choices',async()=>{
        await open('video');
        await page.click('.nmx-board-toolbar button:has(.codicon-device-camera)');await page.waitForSelector(frameMenu);
        assert.equal(await page.$(toolMenu),null,'opening frame choices closes the tool menu');
        await page.click('.nmx-board-toolbar button:has(.codicon-tools)');await page.waitForSelector(toolMenu);
        assert.equal(await page.$(frameMenu),null,'opening tools closes the frame menu');
    });
    await t.test('long tools scroll internally and open a real tool without running a paid job',async()=>{
        const {selector,baseline}=await open('image',false,100);
        await page.setViewport({width:1440,height:380});await anchored(selector,baseline);
        const g=await geometry(selector);assert.ok(g.scrollHeight>g.clientHeight,'a short board constrains the long image tool menu');
        const before=await page.evaluate(()=>fixture.canvas.viewport);
        const x=(g.menu.left+g.menu.right)/2,y=Math.min(g.menu.top+60,g.board.bottom-80);
        await page.mouse.move(x,y);await page.mouse.wheel({deltaY:900});
        await page.waitForFunction(selector=>document.querySelector(selector).scrollTop>0,{},selector);
        assert.deepEqual(await page.evaluate(()=>fixture.canvas.viewport),before,'menu wheel scroll never pans or zooms the graph');
        // Return the internal scroller to its first visible actionable tool with a real wheel.
        await page.mouse.wheel({deltaY:-2000});await page.waitForFunction(selector=>document.querySelector(selector).scrollTop===0,{},selector);
        const button=await page.$(selector+' [role="menuitem"]');
        assert.equal(await button.evaluate(element=>{const r=element.getBoundingClientRect();return element.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'the visible tool really receives pointer hits');
        await button.click();await page.waitForSelector('.nmx-board-tool[role="dialog"]');
        assert.equal(await page.$(selector),null);await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.nmx-board-tool'));
    });
    assert.deepEqual(await page.evaluate(()=>({runs:fixture.calls.runs,tools:fixture.calls.tools,extracts:fixture.calls.extracts})),{runs:[],tools:[],extracts:[]},'menu movement and opening a configuration dialog never run generation or media processing');
    assert.deepEqual(errors,[]);
});
