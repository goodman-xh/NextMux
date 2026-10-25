import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url), core = createRequire(require.resolve('@theia/core/package.json'));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const src = fileURLToPath(new URL('../src/browser/', import.meta.url)), repo = fileURLToPath(new URL('../../../', import.meta.url));

test('actual canvas video drags preserve chosen routes and delegate references and explicit I2V intent', { timeout: 45000 }, async t => {
    const { outputFiles } = await desktop('esbuild').build({ stdin: { loader: 'tsx', resolveDir: src, contents: `
import React from 'react';import {createRoot} from 'react-dom/client';import {ComicCanvas} from './nextmux-comic-canvas';
import {createCanvasDocument} from '@nextmux/comic-core/canvas';import {createCanvasNode} from './nextmux-comic-canvas-logic';
const root=createRoot(document.querySelector('main')),now='2026-10-04T00:00:00Z';
const video={id:'a-version-1',assetId:'a-asset-1',kind:'video',uri:'source-a.mp4',createdAt:now,status:'ready',metadata:{width:480,height:270,durationMs:2500}};
const source={id:'a',kind:'video',title:'Source video A',position:{x:50,y:80},size:{width:240,height:180},payload:{versions:[video],currentVersionId:video.id}};
const target={...createCanvasNode('videoGen',{x:850,y:80},{title:'Existing B'}),id:'b',size:{width:280,height:200}};
target.payload={...target.payload,modelId:'fixture-video',mode:'textToVideo',prompt:'Original draft',parameters:{resolution:'720p',aspectRatio:'16:9',durationSeconds:5}};
const route=(key,label,routeKind='relay')=>({key,connectionId:key,kind:'video',modelId:'fixture-video',label,source:label,sourceLabel:label,sourceKey:key,routeKind,available:true});
const routes=[route('source-route','Source merchant','own'),route('default-route-specific-key','Default merchant'),route('existing-route-specific-key','Existing merchant')];
const baseMode={mode:'textToVideo',outputVariants:[{id:'720p',resolution:'720p',aspectRatios:['16:9','9:16']}],duration:{kind:'fixed',seconds:5},audioGeneration:{mode:'unsupported',defaultEnabled:false}};
const capability={id:'fixture-video',providerId:'fixture',providerModelId:'fixture-video',displayName:'Fixture video',status:'available',version:'v1',modes:[baseMode,{...baseMode,mode:'imageToVideo',firstFrame:true},{...baseMode,mode:'referenceToVideo',referenceRules:{video:{supported:true,maxCount:2}},combinationConstraints:[{combination:'video',maxVideos:2}]}]};
const initial=()=>({...createCanvasDocument({id:'canvas',projectId:'project',now}),viewport:{x:10,y:10,zoom:1},nodes:structuredClone([source,target]),settings:{nodeRoutes:{a:routes[0].key,b:routes[2].key}}});
let canvas=initial(),serial=0;
const calls={inputs:[],intents:[],events:[],changes:[],notices:[],runs:[],extracts:[],routes:[]};
function change(next,options={}){canvas=next;calls.changes.push({record:options.record!==false,canvas:structuredClone(canvas)});calls.events.push('change');render();}
const props={locale:'en',saveState:'saved',canUndo:false,canRedo:false,models:{image:[],video:routes},families:{image:[],video:[{id:'fixture-video',name:'Fixture video',vendor:'Fixture',available:true,routes}]},
defaultRoute:()=>routes[1],routeOf:node=>routes.find(route=>route.key===canvas.settings.nodeRoutes?.[node.id]),capabilityOf:()=>({capability}),jobOf:()=>undefined,waiting:new Set(),submitting:new Set(),mediaUrl:()=>'',defaults:{aspectRatio:'16:9',durationSeconds:5},
onChange:change,onUndo(){},onRedo(){},onSetRoute(ids,route){calls.routes.push({ids,key:route.key});canvas={...canvas,settings:{...canvas.settings,nodeRoutes:{...canvas.settings.nodeRoutes,...Object.fromEntries(ids.map(id=>[id,route.key]))}}};render();},onRun:ids=>calls.runs.push(ids),onExtract:id=>calls.extracts.push(id),onContinuityFrame:async()=>{throw Error('unexpected continuity extraction')},onExtractVersion:async()=>{throw Error('unexpected extraction')},
onVideoModeIntent(nodeId){calls.intents.push(nodeId);calls.events.push('intent');},onVideoInput(sourceNodeId,targetNodeId,mode){const node=canvas.nodes.find(node=>node.id===targetNodeId);calls.events.push('input');calls.inputs.push({sourceNodeId:sourceNodeId??null,targetNodeId,mode:mode??null,routeKey:canvas.settings.nodeRoutes?.[targetNodeId],manual:canvas.settings.manualVideoModes?.[targetNodeId]===true,actualMode:node?.payload.mode,prompt:node?.payload.prompt,parameters:structuredClone(node?.payload.parameters),edges:structuredClone(canvas.edges),sequence:structuredClone(canvas.sequenceLinks??[])});},
assetLibraryCategories:async()=>[],assetLibraryEntries:async()=>[],onSaveLibraryAsset:async()=>{throw Error('unexpected library write')},onUseLibraryAsset:async()=>{},onImport(){},onUsePortrait(){},onRetrySave(){},onNotice:message=>calls.notices.push(message),toolProgress:new Map(),onTool:async()=>false,onCancelTool(){},onPickLut:async()=>undefined,onDirectorCapture:async()=>{},onSaveMarks:async()=>{throw Error('unused')},onDirectorImport:async()=>{throw Error('unused')}};
function render(){root.render(<ComicCanvas key={serial} {...props} canvas={canvas}/>);}
window.fixture={calls,get canvas(){return canvas},reset(kind){canvas=initial();serial++;for(const key of Object.keys(calls))calls[key].length=0;if(kind==='edge'||kind==='direct'){canvas.nodes=canvas.nodes.map(node=>node.id==='b'?{...node,payload:{...node.payload,mode:'referenceToVideo',...(kind==='direct'?{inputs:[{id:'direct-video',role:'referenceVideo',order:0,version:structuredClone(video)}]}:{})}}:node);if(kind==='edge')canvas.edges=[{id:'pinned-a-b',sourceNodeId:'a',sourcePort:'output',targetNodeId:'b',targetPort:'referenceVideo',role:'referenceVideo',order:0,binding:'pinnedVersion',pinnedVersionId:video.id}];}render();}};render();
` }, bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty', '.svg': 'dataurl' }, alias: {
        react: core.resolve('react'), 'react/jsx-runtime': core.resolve('react/jsx-runtime'), 'react-dom': core.resolve('react-dom'), 'react-dom/client': core.resolve('react-dom/client'),
        '@nextmux/comic-core/canvas': repo + 'packages/comic-core/src/canvas.ts', '@nextmux/comic-core/canvas-capabilities': repo + 'packages/comic-core/src/canvas-capabilities.ts'
    } });
    const puppeteer = (await import(platform.resolve('puppeteer'))).default, browser = await puppeteer.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage(), errors = []; page.setDefaultTimeout(6000); page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 1440, height: 1000 });
    await page.setRequestInterception(true);
    page.on('request', request => void request.respond({ status: 200, contentType: 'text/html', body: '<main class="nmx-shell"></main>' }));
    await page.goto('https://canvas-video-input.test/');
    for (const name of ['nextmux-comic-canvas.css', 'nextmux-comic-canvas-float.css', 'nextmux-comic-canvas-view-controls.css', 'nextmux-comic-canvas-camera.css'])
        await page.addStyleTag({ content: await readFile(src + 'style/' + name, 'utf8') });
    await page.addStyleTag({ content: await readFile(require.resolve('@xyflow/react/dist/style.css'), 'utf8') });
    await page.addStyleTag({ content: 'html,body,main{height:100%;margin:0}main{--nmx-bg:#171717;--nmx-panel:#222;--nmx-panel-2:#333;--nmx-text:#eee;--nmx-muted:#aaa;--nmx-border:#555;--nmx-accent:#b18cdb;--theia-editor-background:#222;--theia-foreground:#eee;--theia-panel-border:#555;--theia-input-background:#333;--theia-input-foreground:#eee;--theia-descriptionForeground:#aaa;font:13px system-ui}.nmx-board{width:100%;height:100%}' });
    await page.addScriptTag({ content: outputFiles[0].text }); await page.waitForSelector('[data-id="a"] .nmx-board-handle.is-out');
    const center = selector => page.$eval(selector, element => { const r = element.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    const drag = async (from, to) => { await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 12 }); await page.mouse.up(); };
    const reset = async kind => { await page.evaluate(kind => window.fixture.reset(kind), kind); await page.waitForSelector('[data-id="a"] .nmx-board-handle.is-out'); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); };

    await t.test('video-to-blank creates B with its chosen route and sequence before delegation', async () => {
        await drag(await center('[data-id="a"] .nmx-board-handle.is-out'), { x: 480, y: 410 });
        await page.waitForSelector('.nmx-board-menu [role=menuitem]');
        let selected = false;
        for (const button of await page.$$('.nmx-board-menu [role=menuitem]')) if ((await button.evaluate(element => element.textContent)).trim() === 'Video generation') { await button.click(); selected = true; break; }
        assert.equal(selected, true, 'the real connection menu offers a video node');
        await page.waitForFunction(() => window.fixture.calls.inputs.length === 1);
        const { canvas, calls } = await page.evaluate(() => ({ canvas: window.fixture.canvas, calls: window.fixture.calls }));
        const created = canvas.nodes.find(node => !['a', 'b'].includes(node.id));
        assert.ok(created); assert.equal(created.kind, 'videoGen');
        assert.equal(canvas.settings.nodeRoutes[created.id], 'default-route-specific-key');
        assert.notEqual(canvas.settings.nodeRoutes[created.id], canvas.settings.nodeRoutes.a, 'a new target does not silently inherit the source merchant');
        assert.equal(created.payload.modelId, 'fixture-video');
        assert.equal(created.payload.mode, 'textToVideo', 'the backend decides the supported media mode');
        assert.deepEqual(canvas.edges, [], 'the UI does not pre-connect an unsupported video reference');
        assert.deepEqual(canvas.sequenceLinks.map(link => [link.sourceNodeId, link.targetNodeId]), [['a', created.id]]);
        assert.equal(calls.inputs[0].targetNodeId, created.id); assert.equal(calls.inputs[0].sourceNodeId, 'a');
        assert.equal(calls.inputs[0].routeKey, 'default-route-specific-key'); assert.equal(calls.inputs[0].sequence.length, 1);
        assert.deepEqual(calls.events, ['change', 'input']);
        assert.equal(calls.changes.filter(change => change.record).length, 1);
    });

    await t.test('connecting an existing video target delegates without mode or order changes', async () => {
        await reset(); const before = await page.evaluate(() => structuredClone(window.fixture.canvas));
        await drag(await center('[data-id="a"] .nmx-board-handle.is-out'), await center('[data-id="b"] .nmx-board-handle.is-in'));
        await page.waitForFunction(() => window.fixture.calls.inputs.length === 1);
        const { canvas, calls } = await page.evaluate(() => ({ canvas: window.fixture.canvas, calls: window.fixture.calls }));
        assert.deepEqual(canvas, before);
        assert.deepEqual(calls.events, ['input']);
        assert.equal(calls.inputs[0].sourceNodeId, 'a'); assert.equal(calls.inputs[0].targetNodeId, 'b');
        assert.equal(calls.inputs[0].actualMode, 'textToVideo'); assert.equal(calls.inputs[0].routeKey, 'existing-route-specific-key');
        assert.equal(calls.inputs[0].sequence.length, 0);
    });

    for (const kind of ['edge', 'direct']) await t.test(`explicit I2V preserves authored content and ${kind} references until conversion`, async () => {
        await reset(kind); await page.click('[data-id="b"] header'); await page.waitForSelector('[data-node-panel="b"] textarea');
        const prompt = '用户保留的下一段 new prompt';
        await page.focus('[data-node-panel="b"] textarea'); await page.$eval('[data-node-panel="b"] textarea', element => element.select());
        await page.keyboard.type(prompt); await page.waitForFunction(prompt => window.fixture.canvas.nodes.find(node => node.id === 'b').payload.prompt === prompt, {}, prompt);
        const before = await page.evaluate(() => ({ node: structuredClone(window.fixture.canvas.nodes.find(node => node.id === 'b')), edges: structuredClone(window.fixture.canvas.edges), route: window.fixture.canvas.settings.nodeRoutes.b }));
        await page.evaluate(() => { window.fixture.calls.events.length = 0; window.fixture.calls.changes.length = 0; });
        await page.click('[data-node-panel="b"] [role=tab][title="Image to video"]');
        await page.waitForFunction(() => window.fixture.calls.inputs.length === 1);
        const { canvas, calls } = await page.evaluate(() => ({ canvas: window.fixture.canvas, calls: window.fixture.calls }));
        assert.equal(canvas.settings.manualVideoModes.b, true);
        assert.deepEqual(calls.intents, ['b']); assert.deepEqual(calls.events, ['intent', 'change', 'input']);
        assert.equal(calls.changes[0].record, false, 'manual intent is saved before the asynchronous conversion');
        assert.deepEqual(canvas.nodes.find(node => node.id === 'b'), before.node);
        assert.deepEqual(canvas.edges, before.edges); assert.equal(canvas.settings.nodeRoutes.b, before.route);
        assert.equal(calls.inputs[0].sourceNodeId, null); assert.equal(calls.inputs[0].targetNodeId, 'b'); assert.equal(calls.inputs[0].mode, 'imageToVideo');
        assert.equal(calls.inputs[0].manual, true); assert.equal(calls.inputs[0].prompt, prompt); assert.equal(calls.inputs[0].routeKey, before.route);
        assert.equal(calls.inputs[0].actualMode, 'referenceToVideo', 'pending conversion cannot discard the existing video input');
        assert.equal(await page.$eval('[data-node-panel="b"] textarea', element => element.value), prompt);
        assert.deepEqual(calls.runs, []); assert.deepEqual(calls.extracts, []);
    });
    assert.deepEqual(errors, []);
});
