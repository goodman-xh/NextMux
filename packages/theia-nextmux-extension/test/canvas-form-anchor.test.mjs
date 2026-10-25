import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const puppeteer = (await import(platform.resolve('puppeteer'))).default;
const base = fileURLToPath(new URL('../../../', import.meta.url));
const src = fileURLToPath(new URL('../src/browser/', import.meta.url));

// Reference: Neowow WorkflowCanvas-DwMe5luE.js uses NodeToolbar(position="bottom").
// vue-flow-n6glvy-_.js: bottom-centre + 10 CSS pixels, with no zoom scale or viewport clamp.
// Node dragging hides the toolbar in both source JS and CSS. Zoom changes the anchor, not the form scale.
// The reference has a zoom-hiding CSS rule but its activation is not established, so this test does not assume it.
test('the actual canvas keeps each generation form below its node through selection, drag, pan, zoom and viewport edges', { timeout: 60000 }, async t => {
    const { outputFiles } = await desktop('esbuild').build({ stdin: { resolveDir: src, loader: 'tsx', contents: `
import React from 'react';import {createRoot} from 'react-dom/client';
import {ComicCanvas} from './nextmux-comic-canvas';
import {createCanvasDocument} from '@nextmux/comic-core/canvas';
import {createCanvasNode} from './nextmux-comic-canvas-logic';
const root=createRoot(document.querySelector('main')),now='2026-10-03T00:00:00.000Z';
const create=(id,x,y)=>{const n=createCanvasNode('videoGen',{x,y},{title:id});return {...n,id,title:id,size:{width:360,height:260},payload:{...n.payload,mode:'textToVideo',modelId:'fixture',prompt:id+' prompt',parameters:{aspectRatio:'16:9',resolution:'720p',durationSeconds:5}}}};
let canvas={...createCanvasDocument({id:'canvas',projectId:'fixture',now}),viewport:{x:80,y:45,zoom:1},nodes:[create('first',350,50),create('second',950,50)]};
const route={key:'fixture',modelId:'fixture',kind:'video',source:'Fixture',routeKind:'relay',available:true};
const mode={mode:'textToVideo',outputVariants:[{id:'720p',resolution:'720p',aspectRatios:['16:9']}],duration:{kind:'fixed',seconds:5},audioGeneration:{mode:'unsupported',defaultEnabled:false}};
const capability={id:'fixture',providerId:'fixture',providerModelId:'fixture',displayName:'Fixture',status:'available',version:'v1',modes:[mode]};
const calls={changes:[],runs:[],extractions:[]};const props={locale:'en',saveState:'saved',models:{image:[],video:[route]},families:{image:[],video:[{id:'fixture',name:'Fixture',vendor:'fixture',available:true,routes:[route]}]},defaultRoute:()=>route,routeOf:()=>route,capabilityOf:()=>({capability}),jobOf:()=>undefined,waiting:new Set(),submitting:new Set(),mediaUrl:()=>'',defaults:{aspectRatio:'16:9',durationSeconds:5},
onChange(next,options){canvas=next;calls.changes.push({record:options?.record!==false});render();},onUndo(){},onRedo(){},onSetRoute(){},onRun:ids=>calls.runs.push(ids),onExtract:id=>calls.extractions.push(id),onImport(){},onUsePortrait(){},onRetrySave(){},onNotice(){},toolProgress:new Map(),onTool:async()=>false,onCancelTool(){},onPickLut:async()=>undefined,onDirectorCapture:async()=>{},onSaveMarks:async()=>{throw Error('unused')},onDirectorImport:async()=>{throw Error('unused')}};
function render(){root.render(<ComicCanvas {...props} canvas={canvas} canUndo={false} canRedo={false}/>)}
window.fixture={calls,get canvas(){return canvas},position(id,x,y){canvas={...canvas,nodes:canvas.nodes.map(n=>n.id===id?{...n,position:{x,y}}:n)};render();},legacyFrame(){const v=canvas.viewport,frame=createCanvasNode('frameExtract',{x:(850-v.x)/v.zoom,y:(180-v.y)/v.zoom},{title:'Legacy frame'});canvas={...canvas,nodes:[{...frame,id:'legacy-frame',size:{width:280,height:220}}],edges:[]};render();},render};render();
` }, bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty', '.svg': 'dataurl' },
        alias: { react: core.resolve('react'), 'react/jsx-runtime': core.resolve('react/jsx-runtime'), 'react-dom': core.resolve('react-dom'), 'react-dom/client': core.resolve('react-dom/client'),
            '@nextmux/comic-core/canvas': base + 'packages/comic-core/src/canvas.ts',
            '@nextmux/comic-core/canvas-camera': base + 'packages/comic-core/src/canvas-camera.ts', '@nextmux/comic-core/canvas-capabilities': base + 'packages/comic-core/src/canvas-capabilities.ts' } });
    const reviewDir = base + '.nextmux-run/canvas-form-review-2026-10-03'; await mkdir(reviewDir, { recursive: true });
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage(); page.setDefaultTimeout(7000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1400, height: 1000 });
    await page.setRequestInterception(true); page.on('request', r => void r.respond({ status: 200, contentType: 'text/html', body: '<main class="nmx-shell"></main>' }));
    await page.goto('https://canvas-anchor.test/');
    for (const name of ['nextmux-comic-canvas.css', 'nextmux-comic-canvas-float.css', 'nextmux-comic-canvas-view-controls.css']) await page.addStyleTag({ content: await readFile(src + 'style/' + name, 'utf8') });
    await page.addStyleTag({ content: await readFile(require.resolve('@xyflow/react/dist/style.css'), 'utf8') });
    await page.addStyleTag({ content: 'html,body,main{height:100%;margin:0}main{--nmx-bg:#171717;--nmx-panel:#222;--nmx-panel-2:#333;--nmx-text:#eee;--nmx-muted:#aaa;--nmx-border:#555;--nmx-accent:#b18cdb;--cv-float:#222;font:13px system-ui}.nmx-board{width:100%;height:100%}' });
    await page.addStyleTag({content:(await readFile(core.resolve('@vscode/codicons/dist/codicon.css'),'utf8')).replace(/url\([^)]*codicon\.ttf[^)]*\)/g,'url(data:font/ttf;base64,'+(await readFile(core.resolve('@vscode/codicons/dist/codicon.ttf'))).toString('base64')+')')});
    await page.addScriptTag({ content: outputFiles[0].text });
    const node = id => `[data-id="${id}"]`;
    const panel = '.nmx-board-panel-layer';
    const prompt = '.nmx-board-panel textarea';
    const geometry = id => page.evaluate(({ id, panel }) => {
        const n = document.querySelector('[data-id="' + id + '"]').getBoundingClientRect();
        const p = document.querySelector(panel).getBoundingClientRect();
        const r = document.querySelector('.nmx-board').getBoundingClientRect();
        const form = document.querySelector('.nmx-board-panel');
        return { node: { x: n.x, y: n.y, w: n.width, h: n.height }, panel: { x: p.x, y: p.y, w: p.width, h: p.height },
            board: { x: r.x, y: r.y, w: r.width, h: r.height }, fontSize: getComputedStyle(form).fontSize };
    }, { id, panel });
    const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1, `${label}: ${actual} ≈ ${expected}`);
    const anchored = async id => {
        await page.waitForFunction(({ id, panel }) => {
            const n = document.querySelector('[data-id="' + id + '"]').getBoundingClientRect();
            const p = document.querySelector(panel)?.getBoundingClientRect();
            return p && Math.abs(p.x + p.width / 2 - n.x - n.width / 2) < 1 && Math.abs(p.y - n.bottom - 10) < 1;
        }, {}, { id, panel });
        const g = await geometry(id); near(g.panel.x + g.panel.w / 2, g.node.x + g.node.w / 2, 'bottom centre'); near(g.panel.y, g.node.y + g.node.h + 10, '10px gap'); return g;
    };
    const select = async id => { await page.click(node(id) + ' header'); await page.waitForSelector(prompt); await page.waitForFunction(id => document.querySelector('.nmx-board-panel textarea').value === id + ' prompt', {}, id); };
    await page.waitForSelector(node('first') + ' header');
    assert.equal(await page.$(panel), null, 'an unselected canvas has no generation form');
    await select('first'); const initial = await anchored('first');
    await page.screenshot({path:reviewDir+'/node-form-inline.png'});
    assert.equal(await page.$$eval('[data-id="first"] textarea', e => e.length), 0, 'preview and form never duplicate the prompt');
    assert.equal(await page.$$eval(prompt, e => e.length), 1);
    await select('second'); await anchored('second');
    await select('first');
    // Real input events are isolated from graph selection/drag; parent rerenders must preserve Chromium composition.
    await page.focus(prompt); await page.$eval(prompt, e => { e.select(); window.originalPrompt = e; window.compositionEvents = []; for (const name of ['compositionstart', 'compositionend', 'blur']) e.addEventListener(name, () => window.compositionEvents.push(name)); });
    const cdp = await page.createCDPSession();
    await cdp.send('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 });
    assert.equal(await page.$('[data-canvas-float-toggle]'),null,'node forms have no expansion action');
    await cdp.send('Input.imeSetComposition', { text: '你', selectionStart: 1, selectionEnd: 1 });
    await page.waitForSelector('.nmx-canvas-floating-form.is-inline');
    await cdp.send('Input.imeSetComposition', { text: '你好', selectionStart: 2, selectionEnd: 2 });
    assert.deepEqual(await page.$eval(prompt, e => ({ same: e === window.originalPrompt, focus: e === document.activeElement, text: e.value, events: window.compositionEvents })), { same: true, focus: true, text: '你好', events: ['compositionstart'] });
    await cdp.send('Input.insertText', { text: '你好' }); await page.keyboard.type(' canvas');
    await page.waitForFunction(() => fixture.canvas.nodes.find(n => n.id === 'first').payload.prompt === '你好 canvas');
    assert.equal(await page.evaluate(() => fixture.canvas.nodes.find(n => n.id === 'second').payload.prompt), 'second prompt', 'editing the selected node does not change another node');
    await anchored('first');
    // Pointer drag moves the graph node; the inline form is hidden until its new anchor settles.
    const header = await page.$(node('first') + ' header'); const h = await header.boundingBox();
    await page.mouse.move(h.x + 20, h.y + h.height / 2); await page.mouse.down(); await page.mouse.move(h.x + 100, h.y + h.height / 2 + 45, { steps: 8 });
    await page.waitForFunction(()=>document.querySelector('[data-node-panel=first]')?.dataset.interacting==='true');
    assert.equal(await page.$eval(panel,e=>getComputedStyle(e).visibility),'hidden','node drag hides the attached form');
    await page.mouse.up(); const dragged = await anchored('first');
    const moved = await page.evaluate(()=>fixture.canvas.nodes.find(n=>n.id==='first').position);
    assert.ok(moved.x>390&&moved.y>65,'real pointer drag persists a moved node (including configured grid snap)');
    near(dragged.node.x-initial.node.x,moved.x-350,'node position follows saved drag x'); near(dragged.node.y-initial.node.y,moved.y-50,'node position follows saved drag y');
    near(dragged.panel.x-initial.panel.x,dragged.node.x-initial.node.x,'form follows drag x'); near(dragged.panel.y-initial.panel.y,dragged.node.y-initial.node.y,'form follows drag y');
    near(dragged.panel.w, initial.panel.w, 'drag keeps form width');
    // Middle-button panning follows the anchor without changing either node's model position.
    const positions = await page.evaluate(() => fixture.canvas.nodes.map(n => n.position));
    await page.mouse.move(1280, 700); await page.mouse.down({ button: 'middle' }); await page.mouse.move(1190, 650, { steps: 8 }); await page.mouse.up({ button: 'middle' });
    const panned = await anchored('first'); near(panned.node.x - dragged.node.x, -90, 'pan x'); near(panned.node.y - dragged.node.y, -50, 'pan y');
    assert.deepEqual(await page.evaluate(() => fixture.canvas.nodes.map(n => n.position)), positions);
    await page.click('button[aria-label="Zoom"]');
    await page.click('button[aria-label="Zoom out"]');
    await page.waitForFunction(() => fixture.canvas.viewport.zoom < 1);
    await page.waitForFunction(()=>document.querySelector('[data-node-panel=first]')?.dataset.interacting==='false');
    const zoomed = await anchored('first'); assert.ok(zoomed.node.w < initial.node.w, 'the graph node zooms'); near(zoomed.panel.w, initial.panel.w, 'the form itself does not zoom'); assert.equal(zoomed.fontSize, initial.fontSize);
    await page.click('button[aria-label="Zoom to 100%"]'); await page.waitForFunction(() => fixture.canvas.viewport.zoom === 1); await anchored('first');
    await page.keyboard.press('Escape');
    // Anchor coordinates follow model space even at the viewport boundaries: no jump above the node or sideways clamp.
    for (const [x, y, edge] of [[0, 100, 'left'], [1230, 100, 'right'], [500, 860, 'bottom']]) {
        // Zoom presets preserve the viewport centre, unlike the old reset button.
        // Place the node at a screen-space boundary using the current saved viewport.
        await page.evaluate(({ x, y }) => { const v = fixture.canvas.viewport; fixture.position('first', (x - v.x) / v.zoom, (y - v.y) / v.zoom); }, { x, y });
        await page.waitForFunction(({ x, y }) => { const n = document.querySelector('[data-id="first"]').getBoundingClientRect(), b = document.querySelector('.nmx-board').getBoundingClientRect(); return Math.abs(n.left - b.left - x) < 1 && Math.abs(n.top - b.top - y) < 1; }, {}, { x, y });
        const g = await anchored('first');
        if (edge === 'left') assert.ok(g.panel.x < g.board.x);
        if (edge === 'right') assert.ok(g.panel.x + g.panel.w > g.board.x + g.board.w);
        if (edge === 'bottom') assert.ok(g.panel.y + g.panel.h > g.board.y + g.board.h);
    }
    await page.evaluate(() => fixture.position('first', 350, 50)); await anchored('first');
    await page.setViewport({ width: 1000, height: 760 }); await anchored('first');
    await page.setViewport({width:1400,height:1000});
    await page.evaluate(()=>fixture.position('second',900,50));
    await page.keyboard.down('Shift');await page.click(node('second')+' header');await page.keyboard.up('Shift');
    await page.waitForFunction(()=>!document.querySelector('[data-node-panel]'));
    assert.equal(await page.$(panel),null,'multi-selection does not show an arbitrary node form');
    await page.mouse.click(1300,800);
    await page.click(node('first')+' header');await anchored('first');
    assert.equal(await page.$eval(prompt,e=>e.value),'你好 canvas','reselection restores the selected node draft');

    // Existing documents can still contain frameExtract nodes. Their screen-sized panel must
    // not shrink to the containing block's remaining space when its centre approaches the right edge.
    await page.evaluate(() => fixture.legacyFrame());
    await page.waitForSelector(node('legacy-frame') + ' header');
    await page.click(node('legacy-frame') + ' header');
    await page.waitForSelector('.nmx-board-panel.is-frame');
    const frameViewport = await page.evaluate(() => fixture.canvas.viewport);
    const framePanel = '.nmx-board-panel.is-frame';
    const stableFrame = async () => {
        const g = await anchored('legacy-frame');
        near(g.panel.w, 360, 'legacy frame panel width stays 360px');
        near(await page.$eval(framePanel, e => e.getBoundingClientRect().width), 360, 'frame control box width');
        assert.equal(await page.$('[data-canvas-float-toggle]'), null, 'legacy extraction has no expand-generation action');
        return g;
    };
    const frameInitial = await stableFrame();
    await page.click(framePanel + ' [role="radio"]:nth-child(3)');
    await page.waitForSelector(framePanel + ' input[type="number"]');
    await page.focus(framePanel + ' input[type="number"]');
    await page.$eval(framePanel + ' input[type="number"]', e => e.select());
    await page.keyboard.type('1.2'); await page.keyboard.press('Tab');
    await page.waitForFunction(() => fixture.canvas.nodes[0].payload.selection.timeMs === 1200);
    await stableFrame();
    const framePosition = await page.evaluate(() => fixture.canvas.nodes[0].position);
    let accumulatedPan = 0;
    for (const dx of [160, 40]) {
        await page.mouse.move(700, 700); await page.mouse.down({ button: 'middle' });
        await page.mouse.move(700 + dx, 700, { steps: 8 }); await page.mouse.up({ button: 'middle' });
        accumulatedPan += dx;
        await page.waitForFunction(x => Math.abs(fixture.canvas.viewport.x - x) < 1, {}, frameViewport.x + accumulatedPan);
        const right = await stableFrame();
        near(right.panel.x - frameInitial.panel.x, accumulatedPan, 'frame panel follows actual canvas pan');
        assert.ok(right.board.x + right.board.w - (right.panel.x + right.panel.w / 2) < 360,
            'exercise less than one panel width remaining to the right of its absolute anchor');
        assert.deepEqual(await page.evaluate(() => fixture.canvas.nodes[0].position), framePosition, 'panning does not move the frame node');
        assert.deepEqual(await page.evaluate(() => fixture.canvas.nodes[0].payload.selection), { kind: 'time', timeMs: 1200 });
    }
    await page.screenshot({ path: reviewDir + '/legacy-frame-right-edge.png' });
    // Changing the selector at that same near-edge anchor may wrap its row, but not alter panel width.
    await page.click(framePanel + ' [role="radio"]:nth-child(1)');
    await page.waitForFunction(() => fixture.canvas.nodes[0].payload.selection.kind === 'first');
    await stableFrame();
    await page.click(framePanel + ' [role="radio"]:nth-child(3)');
    await page.waitForSelector(framePanel + ' input[type="number"]');
    await stableFrame();
    await page.click(framePanel + ' [role="radio"]:nth-child(2)');
    await page.waitForFunction(() => fixture.canvas.nodes[0].payload.selection.kind === 'last');
    await stableFrame();
    assert.equal(await page.evaluate(() => fixture.calls.runs.length), 0);
    assert.equal(await page.evaluate(() => fixture.calls.extractions.length), 0, 'layout and selection changes never dispatch extraction');
    assert.deepEqual(errors, []);
});
