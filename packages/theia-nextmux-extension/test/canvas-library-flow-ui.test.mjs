import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url), core = createRequire(require.resolve('@theia/core/package.json'));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url)), platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const puppeteer = (await import(platform.resolve('puppeteer'))).default;
const root = fileURLToPath(new URL('../../../', import.meta.url)), src = fileURLToPath(new URL('../src/browser/', import.meta.url));
test('actual canvas saves directly from right-click, node and selection tools; library inputs isolate late pickers', { timeout: 60000 }, async t => {
    const bundle = await desktop('esbuild').build({ stdin: { resolveDir: src, loader: 'tsx', contents: `
import React from 'react'; import {createRoot} from 'react-dom/client'; import {ComicCanvas} from './nextmux-comic-canvas';
import {createCanvasDocument,applyCanvasCommand} from '@nextmux/comic-core/canvas'; import {createCanvasNode,connectCanvasNodes} from './nextmux-comic-canvas-logic';
const root=createRoot(document.querySelector('main')),stamp='2026-10-03T00:00:00Z';
const v=(id,kind='image')=>({id:'v-'+id,assetId:'a-'+id,kind,uri:id,createdAt:stamp,metadata:{width:640,height:360,durationMs:5000,mimeType:kind==='image'?'image/png':'video/mp4'}});
const media=(id,kind,x,y)=>({id,kind,title:id,position:{x,y},size:{width:220,height:160},payload:{versions:[v(id,kind)],currentVersionId:'v-'+id}});
const gen=(id,mode,x,y)=>({...createCanvasNode(mode.endsWith('Image')?'imageGen':'videoGen',{x,y},{title:id}),id,title:id,size:{width:300,height:220},payload:{mode,modelId:'fixture',capabilityVersion:'1',prompt:'Prompt',parameters:{aspectRatio:'16:9',resolution:'720p',durationSeconds:5},versions:[]}});
let canvas={...createCanvasDocument({id:'canvas',projectId:'project-a',now:stamp}),viewport:{x:20,y:20,zoom:1},nodes:[media('picture','image',20,20),media('movie','video',1130,700),gen('image-gen','textToImage',350,20),gen('video-gen','textToVideo',700,20),gen('frames','firstLastFrame',350,330),gen('reference','referenceToVideo',700,330)]};
const rules={supported:true,maxCount:3},variant={id:'720p',resolution:'720p',aspectRatios:['16:9']};
const modes=[{mode:'textToImage'},{mode:'imageToImage',referenceRules:{image:rules},combinationConstraints:[{combination:'image',maxImages:3}]},{mode:'textToVideo'},{mode:'imageToVideo',firstFrame:true},{mode:'firstLastFrame',firstFrame:true,lastFrame:true},{mode:'referenceToVideo',referenceRules:{image:rules,video:rules},combinationConstraints:[{combination:'video',maxVideos:3},{combination:'image',maxImages:3}]}].map(item=>({...item,outputVariants:[variant],duration:{kind:'fixed',seconds:5},audioGeneration:{mode:'unsupported',defaultEnabled:false}}));
const cap={id:'fixture',providerId:'fixture',providerModelId:'fixture',displayName:'Fixture',status:'available',version:'1',modes,sources:[]};
const route=kind=>({key:kind,connectionId:kind,kind,modelId:'fixture',label:'Fixture',source:'Own',routeKind:'own',available:true});
const calls={saves:[],uses:[],runs:[],imports:[],notices:[]}; let library=[],seq=0,gate,loading=false,busy=false;
const image='data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="purple"/></svg>';
const change=next=>{canvas=next;render();};
function attach(sourceId,targetId,role){let base=canvas;if(role==='firstFrame'||role==='lastFrame'){base={...base,edges:base.edges.filter(e=>e.targetNodeId!==targetId||e.role!==role),nodes:base.nodes.map(n=>n.id===targetId?{...n,payload:{...n.payload,inputs:(n.payload.inputs??[]).filter(i=>i.role!==role)}}:n)};}const result=connectCanvasNodes(base,sourceId,targetId,stamp,role);if(result.error)throw Error(result.error);change(result.canvas);}
function render(){root.render(<ComicCanvas locale='en' canvas={canvas} saveState='saved' canUndo={false} canRedo={false} onUndo={()=>{}} onRedo={()=>{}}
 models={{image:[route('image')],video:[route('video')]}} families={{image:[{id:'fixture',name:'Fixture',vendor:'fixture',available:true,routes:[route('image')]}],video:[{id:'fixture',name:'Fixture',vendor:'fixture',available:true,routes:[route('video')]}]}}
 defaultRoute={route} routeOf={node=>route(node.kind==='imageGen'?'image':'video')} capabilityOf={()=>loading?{loading:true}:{capability:cap}} jobOf={()=>busy?{status:'running'}:undefined}
 waiting={new Set()} submitting={new Set()} mediaUrl={uri=>uri.startsWith('movie')?'':image} defaults={{aspectRatio:'16:9',durationSeconds:5}} onChange={change} onSetRoute={()=>{}} onRun={ids=>calls.runs.push(ids)}
 onExtract={()=>{}} onContinuityFrame={async()=>{throw Error('unused')}} assetLibraryCategories={async()=>[]} assetLibraryEntries={async()=>library} libraryScope={canvas.projectId}
 onSaveLibraryAsset={async input=>{calls.saves.push(input);const owner=canvas.nodes.find(n=>n.id===input.nodeId),version=owner.payload.versions.find(v=>v.id===input.versionId);const entry={...input,assetId:'library-'+input.nodeId,assetType:version.kind,createdAt:stamp,updatedAt:stamp};library=[...library.filter(e=>e.assetId!==entry.assetId),entry];return entry;}}
 onUseLibraryAsset={async(id,position,requestId,target)=>{const entry=library.find(e=>e.assetId===id),owner=canvas.projectId;calls.uses.push({id,position,requestId,target,owner});const pending=gate;gate=undefined;if(pending)await pending.promise;if(owner!==canvas.projectId)return;const node=media('import-'+(++seq),entry.assetType,position.x,position.y);change(applyCanvasCommand(canvas,{type:'node.add',node},{now:stamp}));if(target)attach(node.id,target.nodeId,target.role);}}
 onAttachReference={attach} onImport={(p,f,target)=>calls.imports.push(target)} onUsePortrait={()=>{}} onRetrySave={()=>{}} onNotice={text=>calls.notices.push(text)} toolProgress={new Map()} onTool={async()=>false} onCancelTool={()=>{}} onPickLut={async()=>undefined} onDirectorCapture={async()=>{}} onSaveMarks={async()=>{throw Error('unused')}} onDirectorImport={async()=>{throw Error('unused')}}/>);}
window.fixture={calls,get canvas(){return canvas},get library(){return library},hold(){let resolve;const promise=new Promise(done=>resolve=done);gate={promise,resolve};this.release=resolve;},setState(l,b){loading=l;busy=b;render();},switchProject(){canvas={...canvas,projectId:'project-b'};render();},direct(){canvas={...canvas,nodes:canvas.nodes.map(n=>n.id==='frames'?{...n,payload:{...n.payload,inputs:[{id:'direct-first',role:'firstFrame',order:0,version:v('direct')},{id:'direct-last',role:'lastFrame',order:0,version:v('last')}]}}:n)};render();}};render();
` }, bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty', '.svg': 'dataurl' }, alias: {
        react: core.resolve('react'), 'react/jsx-runtime': core.resolve('react/jsx-runtime'), 'react-dom': core.resolve('react-dom'), 'react-dom/client': core.resolve('react-dom/client'),
        '@nextmux/comic-core/canvas': root + 'packages/comic-core/src/canvas.ts', '@nextmux/comic-core/canvas-capabilities': root + 'packages/comic-core/src/canvas-capabilities.ts'
    } });
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close()); const page = await browser.newPage(); page.setDefaultTimeout(7000);
    const errors = []; page.on('pageerror', error => errors.push(error.message)); await page.setViewport({ width: 1440, height: 1000 });
    await page.setRequestInterception(true); page.on('request', request => void request.respond({ status: 200, contentType: 'text/html', body: '<main class="nmx-shell"></main>' })); await page.goto('https://library-flow.test/');
    for (const name of ['nextmux-comic-canvas.css','nextmux-comic-canvas-float.css','nextmux-comic-asset-library.css','nextmux-comic-canvas-view-controls.css']) await page.addStyleTag({ content: await readFile(src + 'style/' + name, 'utf8') });
    await page.addStyleTag({ content: await readFile(require.resolve('@xyflow/react/dist/style.css'), 'utf8') });
    await page.addStyleTag({ content: 'html,body,main{height:100%;margin:0}main{--nmx-bg:#171717;--nmx-panel:#222;--nmx-panel-2:#333;--nmx-text:#eee;--nmx-muted:#aaa;--nmx-border:#555;--nmx-accent:#b18cdb;--theia-editor-background:#222;--theia-foreground:#eee;--theia-panel-border:#555;--theia-input-background:#333;--theia-input-foreground:#eee;--theia-descriptionForeground:#aaa;font:13px system-ui}.nmx-board{width:100%;height:100%}' });
    await page.addScriptTag({ content: bundle.outputFiles[0].text }); await page.waitForSelector('[data-id="picture"]');
    const choose = async (id, role) => {
        await page.waitForFunction(()=>!document.querySelector(':modal')); await page.mouse.click(1400,450); await page.click(`[data-id="${id}"] header`);
        const slot=`[data-node-panel="${id}"] [data-reference-role="${role}"]`;
        await page.click(`${slot} .nmx-board-reference-picker > summary`);
        await page.click(`${slot} button[title="Choose a reference or character photo from the library"]`);
    };
    const close = () => page.click('.nmx-board-asset-library [data-nmx-layer-close]');
    const use = id => page.click(`[data-library-asset="library-${id}"] .nmx-library-card-actions button`);
    for (const id of ['picture','movie']) {
        await page.click(`[data-id="${id}"] .nmx-board-node-body`, { button: 'right' }); await page.waitForSelector('[role="menu"]').catch(async error => { console.log('right menu', id, errors, await page.$eval(`[data-id="${id}"]`,e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,at:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,300)}})); throw error; });
        assert.equal(await page.$eval('[role="menu"]', el => { const r=el.getBoundingClientRect(); return r.left>=0 && r.top>=0 && r.right<=innerWidth && r.bottom<=innerHeight; }), true, 'context menu fits even near the lower right edge');
        await page.click('[role="menu"] button[role="menuitem"]');
        await page.waitForFunction(id=>fixture.calls.saves.some(input=>input.nodeId===id),{},id);
        assert.equal(await page.$(':modal'),null,'save immediately persists without a name/category/notes dialog');
    }
    assert.deepEqual(await page.evaluate(() => fixture.library.map(e=>[e.assetType,e.assetCategory])), [['image','other'],['video','other']]);
    assert.deepEqual(await page.evaluate(() => fixture.calls.notices), ['Saved successfully','Saved successfully']);
    await page.click('[data-id="picture"] header'); await page.click('[data-id="picture"] button[aria-label="Save to asset library"]');
    await page.waitForFunction(()=>fixture.calls.saves.length===3);
    await page.keyboard.down('Shift'); await page.click('[data-id="movie"] header'); await page.keyboard.up('Shift');
    await page.click('.nmx-board-selection button:has(.codicon-save)'); await page.waitForFunction(()=>fixture.calls.saves.length===5);
    assert.equal(await page.$(':modal'),null,'node and multi-selection tools use the same direct-save flow');
    assert.deepEqual(await page.evaluate(()=>fixture.calls.saves.map(input=>input.nodeId)),['picture','movie','picture','picture','movie']);
    assert.equal(await page.evaluate(()=>new Set(fixture.calls.saves.filter(input=>input.nodeId==='picture').map(input=>input.requestId)).size),1,'all three entry points share the original persisted request');
    assert.equal(await page.evaluate(()=>fixture.calls.saves.some(input=>'mediaKind' in input)),false,'display-only media type is never sent to the save service');
    await choose('image-gen','referenceImage'); await page.waitForSelector('[data-library-asset="library-picture"]');
    assert.equal(await page.$('[data-library-asset="library-movie"]'), null); await use('picture'); await page.waitForFunction(()=>!document.querySelector(':modal'));
    assert.equal(await page.evaluate(()=>fixture.canvas.nodes.find(n=>n.id==='image-gen').payload.mode), 'imageToImage');
    assert.ok(await page.$('[data-node-panel="image-gen"] [data-reference-role="referenceImage"] .nmx-board-reference-thumb img'), 'the selected input appears in its real reference slot');
    assert.match(await page.$eval('[data-id="image-gen"] .nmx-board-placeholder',e=>e.textContent), /Reference added/);
    assert.equal(await page.evaluate(()=>fixture.canvas.nodes.find(n=>n.id==='image-gen').payload.versions.length),0,'a reference never pretends to be a generated result');
    await choose('video-gen','firstFrame'); await page.waitForSelector('[data-library-asset="library-picture"]'); await use('picture'); await page.waitForFunction(()=>!document.querySelector(':modal'));
    assert.equal(await page.evaluate(()=>fixture.canvas.nodes.find(n=>n.id==='video-gen').payload.mode), 'imageToVideo');
    await choose('frames','firstFrame'); await page.waitForSelector('[data-library-asset="library-picture"]'); await use('picture'); await page.waitForFunction(()=>!document.querySelector(':modal'));
    assert.equal(await page.evaluate(()=>fixture.canvas.nodes.find(n=>n.id==='frames').payload.mode), 'firstLastFrame');
    await choose('frames','lastFrame'); await page.waitForSelector('[data-library-asset="library-picture"]'); await use('picture'); await page.waitForFunction(()=>!document.querySelector(':modal'));
    await choose('reference','referenceVideo'); await page.waitForSelector('[data-library-asset="library-movie"]'); assert.equal(await page.$('[data-library-asset="library-picture"]'), null);
    await page.click('.nmx-library-toolbar button[title="All"]'); assert.equal(await page.$eval('[data-library-asset="library-picture"] button',e=>e.disabled), true, 'switching the category cannot bypass role type filtering');
    await use('movie'); await page.waitForFunction(()=>!document.querySelector(':modal'));
    assert.deepEqual(await page.evaluate(()=>fixture.calls.uses.map(c=>[c.target.nodeId,c.target.role])), [['image-gen','referenceImage'],['video-gen','firstFrame'],['frames','firstFrame'],['frames','lastFrame'],['reference','referenceVideo']]);
    await page.evaluate(()=>fixture.hold()); await choose('video-gen','firstFrame'); await page.waitForSelector('[data-library-asset="library-picture"]'); await use('picture'); await page.waitForSelector('.nmx-library-progress'); await close();
    await choose('reference','referenceVideo'); await page.waitForSelector('[data-library-asset="library-movie"]'); await page.evaluate(()=>fixture.release());
    await page.waitForFunction(()=>fixture.canvas.edges.filter(e=>e.targetNodeId==='video-gen').some(e=>e.sourceNodeId==='import-6'));
    assert.ok(await page.$('[data-library-asset="library-movie"]'), 'completion from the closed first-frame picker does not close the newer video picker'); await close();
    await page.evaluate(()=>fixture.direct()); await page.click('[data-id="frames"] header'); await page.waitForSelector('[data-direct-input="direct-first"]');
    assert.match(await page.$eval('[data-direct-input="direct-first"]',e=>e.title), /640 × 360.*5\.00 s.*image\/png/);
    await page.click('[data-direct-input="direct-first"] button'); await page.waitForFunction(()=>!document.querySelector('[data-direct-input="direct-first"]'));
    assert.deepEqual(await page.evaluate(()=>fixture.canvas.nodes.find(n=>n.id==='frames').payload.inputs.map(i=>i.id)), ['direct-last']);
    assert.equal(await page.$$eval('[data-library-input-role]',items=>items.length), 0,'reference choices live in the selected node form, not empty media cards');
    await choose('reference','referenceVideo'); await page.waitForSelector('[data-library-asset="library-movie"]'); await page.evaluate(()=>fixture.switchProject()); await page.waitForFunction(()=>!document.querySelector(':modal'));
    assert.equal(await page.evaluate(()=>fixture.calls.runs.length),0); assert.deepEqual(errors, []);
    const screenshots=root+'.nextmux-run/canvas-library-flow'; await mkdir(screenshots,{recursive:true}); await page.screenshot({path:screenshots+'/library-inputs.png'});
});
