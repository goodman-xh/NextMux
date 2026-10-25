import assert from 'node:assert/strict';import test from 'node:test';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {readFileSync,mkdirSync} from 'node:fs';
const require=createRequire(import.meta.url),core=createRequire(require.resolve('@theia/core/package.json')),desktop=createRequire(new URL('../../../apps/desktop/package.json',import.meta.url)),platform=createRequire(new URL('../../../apps/cloudflare-platform/package.json',import.meta.url));
test('camera popover uses two columns above the trigger, local draft, clean prompt tags, node-relative boundary placement, constrained height and dialog reuse',{timeout:30000},async t=>{
 const {outputFiles}=await desktop('esbuild').build({stdin:{loader:'tsx',resolveDir:fileURLToPath(new URL('../src/browser/',import.meta.url)),contents:`
import React from 'react';import {createRoot} from 'react-dom/client';import {CameraControl,CameraTags} from './nextmux-comic-canvas-camera';import {deriveCanvasCameraPrompt,composeCanvasCameraPrompt} from './nextmux-comic-canvas-camera-state';
let persisted=composeCanvasCameraPrompt('雨中的街道',{movements:['pedestal_up','arc_left'],speed:'slow'}),calls=0;const root=createRoot(document.querySelector('main'));
function App(){const [open,setOpen]=React.useState(false),[dialog,setDialog]=React.useState(false),[locale,setLocale]=React.useState('zh-CN'),[,tick]=React.useState(0);const trigger=React.useRef(null);const view=deriveCanvasCameraPrompt(persisted.prompt,persisted.state);const cancel=()=>{setOpen(false);trigger.current?.focus();};const apply=selection=>{persisted=composeCanvasCameraPrompt(view.body,selection);calls++;tick(v=>v+1);cancel();};window.fixture={read:()=>persisted,calls:()=>calls,dialog:()=>{setDialog(true);setOpen(true);},locale:setLocale};return <div className='nmx-board'><div className='nmx-board-panel-layer'><div className='nmx-board-panel'><button id='camera-trigger' ref={trigger} onClick={()=>{setDialog(false);setOpen(v=>!v);}}>运镜</button>{view.state&&<CameraTags locale={locale} selection={view.state.selection} onChange={apply}/>}<textarea id='prompt' value={view.body} onChange={e=>{persisted=composeCanvasCameraPrompt(e.target.value,view.state?.selection);tick(v=>v+1);}}/>{open&&<CameraControl locale={locale} selection={view.state?.selection} onConfirm={apply} onCancel={cancel} presentation={dialog?'dialog':'popover'}/>}</div></div><button id='outside'>Outside</button></div>;}root.render(<App/>);
`},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'empty'},alias:{react:core.resolve('react'),'react-dom/client':core.resolve('react-dom/client'),'@theia/core/shared/react':core.resolve('react')}});
 const puppeteer=(await import(platform.resolve('puppeteer'))).default,browser=await puppeteer.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();await page.setViewport({width:1000,height:850});page.setDefaultTimeout(4000);const errors=[];page.on('pageerror',e=>errors.push(e.message));t.after(()=>assert.deepEqual(errors,[]));
 await page.setContent('<style>body{margin:0;background:#111;color:#eee;font-family:Arial}main{padding:30px}.nmx-board{position:relative;width:900px;height:790px;overflow:hidden}.nmx-board-panel-layer{position:absolute;top:430px;left:80px}.nmx-board-panel{position:relative;width:560px;box-sizing:border-box;padding:12px;border:1px solid #555;border-radius:20px;background:#252525}textarea{width:100%;min-height:100px;box-sizing:border-box}#outside{position:absolute;bottom:0;right:0}</style><main></main>');
 await page.addStyleTag({content:readFileSync(new URL('../src/browser/style/nextmux-comic-canvas-camera.css',import.meta.url),'utf8')});await page.addScriptTag({content:outputFiles[0].text});await page.waitForSelector('#camera-trigger');
 assert.equal(await page.$eval('#prompt',e=>e.value),'雨中的街道');assert.equal(await page.$eval('.nmx-camera-tags',e=>e.textContent),'升起左弧慢速');const original=await page.evaluate(()=>JSON.stringify(fixture.read()));
 await page.click('#camera-trigger');await page.waitForSelector('.nmx-camera-control');assert.equal(await page.$$eval('[data-camera-preset]',e=>e.length),21);assert.equal(await page.$$eval('[data-camera-move]',e=>e.length),37);assert.equal(await page.$$eval('[data-camera-speed]',e=>e.length),5);
 const geometry=await page.evaluate(()=>{const r=s=>{const x=document.querySelector(s).getBoundingClientRect();return {x:x.x,y:x.y,w:x.width,h:x.height,right:x.right,bottom:x.bottom};};return{panel:r('.nmx-camera-control'),form:r('.nmx-board-panel'),left:r('.nmx-camera-presets'),right:r('.nmx-camera-options')};});
 assert.ok(Math.abs(geometry.panel.bottom-(geometry.form.y-8))<=1);assert.ok(geometry.panel.h<=320);assert.equal(geometry.left.w,116);assert.ok(geometry.left.right<=geometry.right.x+1);assert.equal(Math.round(geometry.panel.w),520);assert.ok(geometry.panel.right<=geometry.form.right);
 await page.click('[data-camera-preset=simple_zoom_in]');assert.equal(await page.evaluate(()=>JSON.stringify(fixture.read())),original,'preset is draft only');await page.keyboard.press('Escape');await page.waitForSelector('.nmx-camera-control',{hidden:true});assert.equal(await page.evaluate(()=>document.activeElement.id),'camera-trigger');assert.equal(await page.evaluate(()=>fixture.calls()),0);
 await page.click('#camera-trigger');await page.click('[data-camera-preset=gentle_rise]');await page.click('[data-camera-action=confirm]');await page.waitForSelector('.nmx-camera-control',{hidden:true});assert.equal(await page.$eval('#prompt',e=>e.value),'雨中的街道');assert.ok((await page.evaluate(()=>fixture.read().prompt)).startsWith('[缓缓升起] [Raise the camera vertically] [at a slow pace] '));assert.equal(await page.$eval('.nmx-camera-tags',e=>e.textContent),'缓缓升起慢速');
 await page.click('[data-camera-action=clear]');await page.waitForSelector('.nmx-camera-tags',{hidden:true});assert.equal(await page.evaluate(()=>fixture.read().prompt),'雨中的街道');
 await page.click('#camera-trigger');await page.click('[data-camera-move=zoom_out]');await page.click('#outside');await page.waitForSelector('.nmx-camera-control',{hidden:true});assert.equal(await page.evaluate(()=>fixture.read().prompt),'雨中的街道','outside dismiss cancels draft without swallowing its click');
 await page.click('#camera-trigger');await page.click('#camera-trigger');await page.waitForSelector('.nmx-camera-control',{hidden:true});
 // Neowow anchors the drawer above its owner. Crossing an edge must neither pin it
 // to the viewport nor shrink it; users can pan the same unchanged draft back into view.
 await page.click('#camera-trigger');await page.click('[data-camera-move=zoom_out]');
 const callsBeforePan=await page.evaluate(()=>{window.originalCamera=document.querySelector('.nmx-camera-control');return fixture.calls();});
 const readPlacement=()=>page.evaluate(()=>{const p=document.querySelector('.nmx-camera-control'),r=p.getBoundingClientRect(),b=document.querySelector('.nmx-board').getBoundingClientRect(),f=document.querySelector('.nmx-board-panel').getBoundingClientRect();const hittable=s=>{const e=p.querySelector(s),q=e.getBoundingClientRect();return q.top>=r.top&&q.bottom<=r.bottom&&e.contains(document.elementFromPoint(q.x+q.width/2,q.y+q.height/2));};return{top:r.top,left:r.left,bottom:r.bottom,height:r.height,width:r.width,formTop:f.top,formLeft:f.left,fontSize:getComputedStyle(p).fontSize,same:p===window.originalCamera,inlineTop:p.style.top,inlineBottom:p.style.bottom,boardTop:Math.max(0,b.top),boardBottom:Math.min(innerHeight,b.bottom),close:hittable('[data-camera-action=cancel]'),confirm:hittable('[data-camera-action=confirm]'),leftScroll:p.querySelector('.nmx-camera-preset-list').scrollHeight>p.querySelector('.nmx-camera-preset-list').clientHeight,rightScroll:p.querySelector('.nmx-camera-movements').scrollHeight>p.querySelector('.nmx-camera-movements').clientHeight};});
 const anchored=await readPlacement();
 for(const [top,left] of [[212,80],[168,100],[119,20],[0,-200],[-260,1000],[660,80],[430,80]]){
  await page.$eval('.nmx-board-panel-layer',(e,{top,left})=>{e.style.top=top+'px';e.style.left=left+'px';},{top,left});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const p=await readPlacement();assert.equal(p.height,320,'pan to '+top+' retains height');assert.equal(p.width,520);assert.ok(Math.abs(p.bottom-(p.formTop-8))<=1,'drawer remains 8px above its owner');assert.ok(Math.abs((p.top-anchored.top)-(p.formTop-anchored.formTop))<.1,'vertical pan moves owner and drawer equally');assert.ok(Math.abs((p.left-anchored.left)-(p.formLeft-anchored.formLeft))<.1,'horizontal pan moves owner and drawer equally');assert.equal(p.fontSize,anchored.fontSize);assert.ok(p.same,'pan never remounts the draft');assert.equal(p.inlineTop,'');assert.equal(p.inlineBottom,'');
  if(top<=212)assert.ok(p.top<p.boardTop,'the edge does not magnetically pin the drawer to the canvas top');
  if(top===430)assert.ok(p.close&&p.confirm,'panning back recovers both close and confirm');
  assert.ok(p.leftScroll&&p.rightScroll);assert.equal(await page.$eval('[data-camera-move=zoom_out]',e=>e.getAttribute('aria-pressed')),'true');assert.equal(await page.evaluate(()=>fixture.calls()),callsBeforePan);
 }
 const out=fileURLToPath(new URL('../../../.nextmux-run/camera-control-review/',import.meta.url));mkdirSync(out,{recursive:true});
 await page.$eval('.nmx-board-panel-layer',e=>e.style.top='212px');await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:out+'camera-node-top-boundary.png'});
 // Only the whole visible canvas constrains height. An offset that initially clips
 // the drawer can be panned down until its actions are available again.
 await page.$eval('.nmx-board',e=>e.style.height='190px');await page.$eval('.nmx-board-panel-layer',e=>e.style.top='70px');
 await page.waitForFunction(()=>document.querySelector('.nmx-camera-control').getBoundingClientRect().height===174);
 const clipped=await readPlacement();assert.ok(clipped.top<clipped.boardTop);assert.ok(Math.abs(clipped.bottom-(clipped.formTop-8))<=1);
 await page.$eval('.nmx-board-panel-layer',e=>e.style.top='190px');
 const compact=await readPlacement();assert.ok(compact.top>=compact.boardTop&&compact.bottom<=compact.boardBottom);assert.ok(compact.close&&compact.confirm);assert.ok(compact.leftScroll&&compact.rightScroll);assert.ok(compact.same);
 await page.screenshot({path:out+'camera-small-canvas-panned-back.png'});
 // On a very short canvas the outer drawer itself scrolls instead of crushing the
 // columns. Scroll the same draft to its footer, then recover the full-size canvas.
 await page.$eval('.nmx-board',e=>e.style.height='100px');await page.$eval('.nmx-board-panel-layer',e=>e.style.top='100px');
 await page.waitForSelector('.nmx-camera-control.is-short');
 assert.equal(await page.$eval('.nmx-camera-control',e=>e.getBoundingClientRect().height),84);
 assert.ok(await page.$eval('.nmx-camera-control',e=>e.scrollHeight>e.clientHeight));
 await page.$eval('.nmx-camera-control',e=>e.scrollTop=e.scrollHeight);
 assert.ok((await readPlacement()).confirm,'internal scrolling reaches confirm in a short canvas');
 await page.$eval('.nmx-board',e=>e.style.height='790px');await page.$eval('.nmx-board-panel-layer',e=>e.style.top='430px');await page.waitForFunction(()=>document.querySelector('.nmx-camera-control').getBoundingClientRect().height===320);
 await page.click('[data-camera-action=confirm]');await page.waitForSelector('.nmx-camera-control',{hidden:true});assert.equal(await page.evaluate(()=>fixture.calls()),callsBeforePan+1);assert.equal(await page.$eval('#prompt',e=>e.value),'雨中的街道');assert.ok((await page.evaluate(()=>fixture.read().state.selection.movements)).includes('zoom_out'));
 await page.click('#camera-trigger');
 await page.click('[data-camera-action=cancel]');await page.evaluate(()=>fixture.dialog());await page.waitForSelector('.nmx-camera-control.is-dialog');assert.equal(Math.round(await page.$eval('.nmx-camera-control',e=>e.getBoundingClientRect().width)),480);assert.ok(await page.$eval('.nmx-camera-control',e=>e.getBoundingClientRect().height<=480));
 await page.evaluate(()=>{const c=document.querySelector('.nmx-camera-control');c.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));});await page.keyboard.press('Escape');assert.ok(await page.$('.nmx-camera-control'));await page.evaluate(()=>document.querySelector('.nmx-camera-control').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));await page.keyboard.press('Escape');await page.waitForSelector('.nmx-camera-control',{hidden:true});
});

test('real canvas middle/right drag preserves the open camera draft and anchor, while primary outside click cancels', { timeout: 45000 }, async t => {
 const base=fileURLToPath(new URL('../../../',import.meta.url)),src=fileURLToPath(new URL('../src/browser/',import.meta.url));
 const {outputFiles}=await desktop('esbuild').build({stdin:{loader:'tsx',resolveDir:src,contents:`
import React from 'react';import {createRoot} from 'react-dom/client';import {ComicCanvas} from './nextmux-comic-canvas';
import {createCanvasDocument} from '@nextmux/comic-core/canvas';import {createCanvasNode} from './nextmux-comic-canvas-logic';
const root=createRoot(document.querySelector('main')),now='2026-10-04T00:00:00Z';
const node=createCanvasNode('videoGen',{x:380,y:260},{videoModelId:'fixture',title:'Camera pan test'});
let canvas={...createCanvasDocument({id:'pan-canvas',projectId:'fixture',now}),viewport:{x:20,y:20,zoom:1},nodes:[{...node,id:'video',size:{width:360,height:240},payload:{...node.payload,mode:'textToVideo',prompt:'Keep this authored prompt.',parameters:{resolution:'720p',aspectRatio:'16:9',durationSeconds:5}}}]};
const route={key:'fixture',modelId:'fixture',kind:'video',source:'Fixture',routeKind:'relay',available:true};
const capability={id:'fixture',providerId:'fixture',providerModelId:'fixture',displayName:'Fixture',status:'available',version:'1',modes:[{mode:'textToVideo',outputVariants:[{id:'720',resolution:'720p',aspectRatios:['16:9']}],duration:{kind:'fixed',seconds:5},audioGeneration:{mode:'unsupported',defaultEnabled:false}}]};
const calls={runs:0,extractions:0};const props={locale:'en',saveState:'saved',models:{image:[],video:[route]},families:{image:[],video:[{id:'fixture',name:'Fixture',vendor:'fixture',available:true,routes:[route]}]},defaultRoute:()=>route,routeOf:()=>route,capabilityOf:()=>({capability}),jobOf:()=>undefined,waiting:new Set(),submitting:new Set(),mediaUrl:()=>'',defaults:{aspectRatio:'16:9',durationSeconds:5},
onChange(next){canvas=next;render();},onUndo(){},onRedo(){},onSetRoute(){},onRun(){calls.runs++;},onExtract(){calls.extractions++;},onImport(){},onUsePortrait(){},onRetrySave(){},onNotice(){},toolProgress:new Map(),onTool:async()=>false,onCancelTool(){},onPickLut:async()=>undefined,onDirectorCapture:async()=>{},onSaveMarks:async()=>{throw Error('unused')},onDirectorImport:async()=>{throw Error('unused')}};
function render(){root.render(<ComicCanvas {...props} canvas={canvas} canUndo={false} canRedo={false}/>)}
window.fixture={get canvas(){return canvas},calls};render();
`},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'empty','.svg':'dataurl'},alias:{react:core.resolve('react'),'react/jsx-runtime':core.resolve('react/jsx-runtime'),'react-dom':core.resolve('react-dom'),'react-dom/client':core.resolve('react-dom/client'),'@nextmux/comic-core/canvas':base+'packages/comic-core/src/canvas.ts','@nextmux/comic-core/canvas-camera':base+'packages/comic-core/src/canvas-camera.ts','@nextmux/comic-core/canvas-capabilities':base+'packages/comic-core/src/canvas-capabilities.ts'}});
 const puppeteer=(await import(platform.resolve('puppeteer'))).default,browser=await puppeteer.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();page.setDefaultTimeout(7000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport({width:1400,height:1000});await page.setRequestInterception(true);page.on('request',request=>void request.respond(request.isNavigationRequest()?{status:200,contentType:'text/html',body:'<main class="nmx-shell"></main>'}:{status:204}));await page.goto('https://camera-pan.test/');
 for(const file of ['nextmux-comic-canvas.css','nextmux-comic-canvas-float.css','nextmux-comic-canvas-camera.css','nextmux-comic-canvas-view-controls.css'])await page.addStyleTag({content:readFileSync(src+'style/'+file,'utf8')});
 await page.addStyleTag({content:readFileSync(require.resolve('@xyflow/react/dist/style.css'),'utf8')});
 await page.addStyleTag({content:'html,body,main{height:100%;margin:0}main{--nmx-bg:#171717;--nmx-panel:#222;--nmx-panel-2:#333;--nmx-text:#eee;--nmx-muted:#aaa;--nmx-border:#555;--nmx-accent:#b18cdb;--cv-float:#222;font:13px system-ui}.nmx-board{width:100%;height:100%}'});
 await page.addScriptTag({content:outputFiles[0].text});await page.waitForSelector('[data-id=video] header');await page.click('[data-id=video] header');
 const trigger='.nmx-board-panel button.is-camera[aria-expanded]';await page.click(trigger);await page.waitForSelector('.nmx-camera-control');await page.click('[data-camera-move=zoom_out]');
 const initial=await page.evaluate(()=>{window.originalCamera=document.querySelector('.nmx-camera-control');return {prompt:fixture.canvas.nodes[0].payload.prompt,metadata:fixture.canvas.settings.nodeCamera??null,position:fixture.canvas.nodes[0].position};});
 const geometry=()=>page.evaluate(()=>{const p=document.querySelector('.nmx-camera-control'),r=p.getBoundingClientRect(),f=document.querySelector('.nmx-board-panel').getBoundingClientRect();return {x:r.x,y:r.y,bottom:r.bottom,w:r.width,h:r.height,font:getComputedStyle(p).fontSize,formX:f.x,formY:f.y,same:p===window.originalCamera};});
 for(const [button,dx,dy] of [['middle',-80,-60],['right',50,30]]){
  const before=await geometry(),view=await page.evaluate(()=>fixture.canvas.viewport);
  await page.mouse.move(1200,750);await page.mouse.down({button});
  assert.ok(await page.$('.nmx-camera-control'),button+' pointerdown does not dismiss the draft');
  await page.mouse.move(1200+dx,750+dy,{steps:8});await page.mouse.up({button});
  await page.waitForFunction(({x,y})=>Math.abs(fixture.canvas.viewport.x-x)<1&&Math.abs(fixture.canvas.viewport.y-y)<1,{}, {x:view.x+dx,y:view.y+dy});
  const after=await geometry();assert.ok(after.same);assert.ok(Math.abs(after.x-before.x-dx)<1);assert.ok(Math.abs(after.y-before.y-dy)<1);assert.ok(Math.abs(after.bottom-after.formY+8)<=1);assert.equal(after.w,before.w);assert.equal(after.h,before.h);assert.equal(after.font,before.font);
  assert.equal(await page.$eval('[data-camera-move=zoom_out]',e=>e.getAttribute('aria-pressed')),'true');
  assert.deepEqual(await page.evaluate(()=>fixture.canvas.nodes[0].position),initial.position,'canvas pan never drags the node itself');
  assert.deepEqual(await page.evaluate(()=>({prompt:fixture.canvas.nodes[0].payload.prompt,metadata:fixture.canvas.settings.nodeCamera??null})),{prompt:initial.prompt,metadata:initial.metadata},'pan never commits the camera draft');
 }
 // A real primary click still dismisses and discards the unconfirmed edit.
 await page.mouse.click(1200,750,{button:'left'});await page.waitForSelector('.nmx-camera-control',{hidden:true});
 await page.click('[data-id=video] header');await page.click(trigger);await page.waitForSelector('.nmx-camera-control');assert.equal(await page.$eval('[data-camera-move=zoom_out]',e=>e.getAttribute('aria-pressed')),'false');
 await page.click(trigger);await page.waitForSelector('.nmx-camera-control',{hidden:true});
 await page.click(trigger);await page.waitForSelector('.nmx-camera-control');await page.keyboard.press('Escape');await page.waitForSelector('.nmx-camera-control',{hidden:true});
 assert.equal(await page.$eval(trigger,e=>e===document.activeElement),true);assert.deepEqual(await page.evaluate(()=>fixture.calls),{runs:0,extractions:0});assert.deepEqual(errors,[]);
});
