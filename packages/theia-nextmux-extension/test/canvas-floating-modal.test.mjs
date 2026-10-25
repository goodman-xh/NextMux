import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const base=fileURLToPath(new URL('../../../',import.meta.url)).replace(/\/$/,''),pkg=base+'/packages/theia-nextmux-extension',src=pkg+'/src/browser';
const req=createRequire(pkg+'/package.json'),core=createRequire(req.resolve('@theia/core/package.json')),desktop=createRequire(base+'/apps/desktop/package.json'),platform=createRequire(base+'/apps/cloudflare-platform/package.json');
const ts=req('typescript'),puppeteer=(await import(platform.resolve('puppeteer'))).default;
const source=ts.createSourceFile('canvas.tsx',await readFile(src+'/nextmux-comic-canvas.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const functions=['withCameraState','capabilityInputs','nodeProblems','statusOf','InlineCanvasText','ReferenceMedia','ReferenceInputs','GenerationPanel','DurationField'].map(name=>source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(source)).join('\n');
test('real inline form, modal layers and nested Escape cooperate', {timeout:60000}, async t=>{
const {outputFiles}=await desktop('esbuild').build({stdin:{loader:'tsx',resolveDir:src,contents:`
import React from 'react';import {createRoot} from 'react-dom/client';
import {createCanvasDocument,applyCanvasCommand,resolveCanvasInputs} from '@nextmux/comic-core/canvas';
import {assertCanvasContinuityInputs} from '@nextmux/comic-core/canvas-continuity';
import {continuityText} from './nextmux-comic-continuity-text';
import {CanvasFloatingForm} from './nextmux-comic-canvas-float';
import {CameraControl,CameraTags} from './nextmux-comic-canvas-camera';
import {composeCanvasCameraPrompt,deriveCanvasCameraPrompt} from './nextmux-comic-canvas-camera-state';
import {CanvasRouteSelector,useCanvasRouteSelection} from './nextmux-comic-canvas-route-selector';
import {canvasLibraryReferenceRoles,removeCanvasDirectReference} from './nextmux-comic-canvas-reference-inputs';
import {comicAssetLibraryText} from './nextmux-comic-asset-library-text';
import {isCanvasDurationValid,reconcileCanvasGenerationParameters,resolveCanvasCapability,resolveCanvasGenerationOptions,validateCanvasGenerationParameters} from '@nextmux/comic-core/canvas-capabilities';
import {createCanvasNode,canvasMediaCardSize,canvasCurrentVersion,canvasVersionReady,deleteFromCanvas,canvasLatestJob,canvasPendingUpstream,CANVAS_ACTIVE_JOB} from './nextmux-comic-canvas-logic';
import {canvasText,canvasIssueText} from './nextmux-comic-canvas-text';
import {ImeInput,ImeTextarea} from './nextmux-ime-field';
import {panelText} from './nextmux-comic-canvas-panels-text';
import {storyboardText} from './nextmux-comic-canvas-storyboard-text';
import {canvasOptionAdjustments,canvasOptionsText} from './nextmux-comic-canvas-options-text';
import {fitCanvasNodeOptions,switchCanvasModeKeepingInputs} from './nextmux-comic-canvas-options';
import {StoryboardDialog} from './nextmux-comic-canvas-storyboard';
import {CompareWindow} from './nextmux-comic-canvas-panels';
import {CanvasModalLayer} from './nextmux-comic-canvas-modal';
import {CanvasAssetLibraryDialog} from './nextmux-comic-asset-library';
import {CanvasDownloadDialog} from './nextmux-comic-canvas-download';
const CanvasContext=React.createContext(undefined),now=()=>new Date().toISOString();
${functions}
const mode={mode:'textToVideo',outputVariants:[{id:'720p',resolution:'720p',aspectRatios:['16:9']}],duration:{kind:'fixed',seconds:5},audioGeneration:{mode:'unsupported',defaultEnabled:false}};
const capability={id:'fixture',providerId:'fixture',providerModelId:'fixture',displayName:'Fixture',status:'available',version:'v1',modes:[mode]};
const route={key:'route',modelId:'fixture',source:'Fixture',available:true};
const node=createCanvasNode('videoGen',{x:0,y:0},{title:'Review video'});node.payload={...node.payload,modelId:'fixture',prompt:'Review draft',mode:'textToVideo',parameters:{resolution:'720p',aspectRatio:'16:9',durationSeconds:5}};
let doc=applyCanvasCommand(createCanvasDocument({id:'canvas',projectId:'fixture'}),{type:'node.add',node}),story=false,modal='';
const owner={locale:'en',canvas:doc,submitting:new Set(),waiting:new Set(),jobOf:()=>undefined,routeOf:()=>route,capabilityOf:()=>({capability}),families:{image:[],video:[{id:'family',name:'Fixture',available:true,routes:[route]}]},onChange(next){owner.canvas=next;render();},onNotice:()=>{},onSetRoute:()=>{}};
const close=()=>{modal='';render();};const root=createRoot(document.querySelector('#fixture-root'));
function render(){root.render(<CanvasContext.Provider value={{props:owner,selectNode:()=>{},pickReference:()=>{},change:next=>owner.onChange(next),t:(key,args)=>canvasText('en',key,args),run:()=>{},openStoryboard:()=>{story=true;render();}}}><div className='nmx-board' style={{position:'relative',zIndex:40}}><CanvasFloatingForm locale='en' title='Review video'><button id='compare' onClick={()=>{modal='compare';render();}}>Compare</button><button id='library' onClick={()=>{modal='library';render();}}>Library</button><button id='download' onClick={()=>{modal='download';render();}}>Download</button><GenerationPanel node={owner.canvas.nodes[0]}/></CanvasFloatingForm>{story&&<StoryboardDialog locale='en' prompt='Review draft' durationSeconds={5} onApply={()=>{}} onClose={()=>{story=false;render();}}/>}{modal&&<CanvasModalLayer locale='en'>{modal==='compare'?<CompareWindow locale='en' library={[]} mediaUrl={()=>''} onClose={close} onRemove={()=>{}} onClear={()=>{}}/>:modal==='library'?<CanvasAssetLibraryDialog locale='en' load={async()=>[]} onUse={async()=>{}} onClose={close}/>:<CanvasDownloadDialog locale='en' items={[{nodeId:'n',versionId:'v',assetId:'a',kind:'video',extension:'mp4',label:'Fixture',name:'',manual:false}]} onSave={async()=>undefined} onClose={close} onSaved={()=>{}}/>}</CanvasModalLayer>}</div></CanvasContext.Provider>)}
window.review={closeStory(){story=false;render();}};render();
`},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'empty'},alias:{react:core.resolve('react'),'react-dom/client':core.resolve('react-dom/client'),'@nextmux/comic-core/canvas':base+'/packages/comic-core/src/canvas.ts','@nextmux/comic-core/canvas-camera':base+'/packages/comic-core/src/canvas-camera.ts','@nextmux/comic-core/canvas-capabilities':base+'/packages/comic-core/src/canvas-capabilities.ts'}});
const browser=await puppeteer.launch({headless:true});t.after(()=>browser.close());
const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1400,height:900});await page.setRequestInterception(true);page.on('request',r=>void r.respond({status:200,contentType:'text/html',body:'<main class="nmx-shell"><section class="nmx-comic-studio"><div class="nmx-desk is-canvas" id="fixture-root"></div></section></main>'}));await page.goto('https://floating-modal.test/');
for(const name of ['nextmux-comic-canvas.css','nextmux-comic-canvas-float.css','nextmux-comic-canvas-download.css','nextmux-comic-canvas-storyboard.css','nextmux-comic-canvas-camera.css','nextmux.css','nextmux-desktop-production.css','nextmux-comic-desk.css','nextmux-comic-studio.css'])await page.addStyleTag({content:await readFile(src+'/style/'+name,'utf8')});
await page.addStyleTag({content:'main.nmx-shell{display:block;width:1400px;height:900px}main>.nmx-comic-studio{height:900px}#fixture-root{width:1380px;height:880px}main{--nmx-panel:#212121;--nmx-border:#3d3d3d;--nmx-muted:#aaa;--nmx-text:#eee;--cv-float:#212121;font:13px system-ui}.nmx-board{width:1380px;height:880px;padding-top:480px;box-sizing:border-box}body{background:#171717}'});
await page.addScriptTag({content:outputFiles[0].text});await page.waitForSelector('.nmx-board-panel');assert.equal(await page.$('[data-canvas-float-toggle]'),null);
const storyButton='.nmx-board-panel button.is-camera:not([aria-expanded])';
await page.click(storyButton);await page.waitForSelector('.nmx-sbd-dialog');
const hitInside=selector=>page.$eval(selector,el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});
assert.equal(await hitInside('.nmx-sbd-dialog textarea'),true,'storyboard field receives clicks above the form');
assert.equal(await page.$eval('.nmx-board-modal-layer',e=>e.parentElement===document.body),true);
await page.click('.nmx-sbd-dialog textarea');await page.keyboard.type('A new foreground');
assert.match(await page.$eval('.nmx-sbd-dialog textarea',e=>e.value),/A new foreground/);
assert.equal(await page.$eval('.nmx-board-inline-text',e=>e.value),'Review draft');
const cdp=await page.createCDPSession();await cdp.send('Input.imeSetComposition',{text:'ni',selectionStart:2,selectionEnd:2});await page.keyboard.press('Escape');
assert.equal(await page.$$eval('.nmx-sbd-dialog',e=>e.length),1,'composition Escape does not discard the editor');await cdp.send('Input.insertText',{text:'你'});
await page.$eval('.nmx-sbd-dialog footer button:last-child',e=>e.focus());await page.keyboard.press('Tab');
assert.equal(await page.evaluate(()=>document.activeElement===document.querySelector('.nmx-sbd-dialog button:not(:disabled)')),true,'Tab wraps inside modal');
await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.nmx-sbd-dialog'));
assert.equal(await page.$$eval('.nmx-canvas-floating-form.is-inline',e=>e.length),1);assert.equal(await page.$eval(storyButton,e=>e===document.activeElement),true);
for(const[name,selector]of [['compare','.nmx-board-compare'],['library','.nmx-board-asset-library'],['download','.nmx-board-download']]){
 await page.click('#'+name);await page.waitForSelector(selector);assert.equal(await hitInside(selector),true,name+' is above form');
 assert.equal(await page.$eval('.nmx-board-modal-layer',e=>e.contains(document.activeElement)),true,name+' receives focus');
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.nmx-board-modal-layer'));
 assert.equal(await page.$eval('#'+name,e=>e===document.activeElement),true,name+' restores focus');assert.equal(await page.$$eval('.nmx-canvas-floating-form.is-inline',e=>e.length),1);
}
await page.click('.nmx-board-panel button.is-camera[aria-expanded]');await page.waitForSelector('.nmx-camera-control');
await page.waitForFunction(()=>document.querySelector('.nmx-camera-control').getBoundingClientRect().height>100);
assert.equal(await page.evaluate(()=>document.querySelector('.nmx-camera-control').getBoundingClientRect().top<document.querySelector('.nmx-canvas-floating-host').getBoundingClientRect().top),true,'the upward popover extends outside its inline host');
assert.equal(await page.$eval('[data-camera-move="zoom_in"]',e=>getComputedStyle(e).fontSize),'11px','camera typography survives real desk button inheritance');
assert.ok(await page.$eval('[data-camera-move="zoom_in"]',e=>e.getBoundingClientRect().height<=25),'camera buttons retain compact reference height');
for(const selector of ['.nmx-camera-header','.nmx-camera-close','[data-camera-move="zoom_in"]','.nmx-camera-footer','[data-camera-action="confirm"]']){
 assert.equal(await hitInside(selector),true,selector+' must receive pointer hits with actual desktop styles: '+JSON.stringify(await page.$eval(selector,e=>{const r=e.getBoundingClientRect(),p=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {x:r.x,y:r.y,w:r.width,h:r.height,hit:p?.className};})));
}
assert.deepEqual(await page.$eval('.nmx-canvas-floating-host',e=>({x:getComputedStyle(e).overflowX,y:getComputedStyle(e).overflowY})),{x:'visible',y:'visible'});
await page.click('[data-camera-move="zoom_in"]');assert.equal(await page.$eval('[data-camera-move="zoom_in"]',e=>e.getAttribute('aria-pressed')),'true');
await page.click('[data-camera-action="confirm"]');await page.waitForFunction(()=>!document.querySelector('.nmx-camera-control'));
assert.ok(await page.$('[data-camera-remove="zoom_in"]'),'the real visible control confirms its selected camera');
await page.click('.nmx-board-panel button.is-camera[aria-expanded]');await page.waitForSelector('.nmx-camera-control');await page.focus('.nmx-camera-control button');await page.keyboard.press('Escape');
assert.equal(await page.$$eval('.nmx-camera-control',e=>e.length),0);assert.equal(await page.$$eval('.nmx-canvas-floating-form.is-inline',e=>e.length),1);
assert.equal(await page.$eval('.nmx-board-panel button.is-camera[aria-expanded]',e=>e===document.activeElement),true,'closing camera restores its trigger focus');
await page.keyboard.press('Escape');assert.equal(await page.$$eval('.nmx-canvas-floating-form.is-inline',e=>e.length),1,'consecutive Escape retains the fixed form without manually refocusing');
assert.equal(await page.$('[data-canvas-float-toggle]'),null);
await page.click('.nmx-board-panel button.is-camera[aria-expanded]');await page.waitForSelector('.nmx-camera-control');await page.focus('.nmx-board-panel button.is-camera[aria-expanded]');await page.keyboard.press('Escape');
assert.equal(await page.$$eval('.nmx-camera-control',e=>e.length),0);assert.equal(await page.$$eval('.nmx-canvas-floating-form.is-inline',e=>e.length),1);
await page.keyboard.press('Escape');assert.equal(await page.$$eval('.nmx-canvas-floating-form.is-inline',e=>e.length),1);
for(const selector of ['.nmx-camera-control [data-camera-action="cancel"]','.nmx-camera-control [data-camera-action="confirm"]']){
 assert.equal(await page.$('[data-canvas-float-toggle]'),null);
 await page.click('.nmx-board-panel button.is-camera[aria-expanded]');await page.waitForSelector('.nmx-camera-control');
 await page.click(selector);await page.waitForFunction(()=>!document.querySelector('.nmx-camera-control'));
 assert.equal(await page.$eval('.nmx-board-panel button.is-camera[aria-expanded]',e=>e===document.activeElement),true,'cancel and apply both restore camera trigger focus');
 await page.keyboard.press('Escape');assert.equal(await page.$$eval('.nmx-canvas-floating-form.is-inline',e=>e.length),1);
}
assert.deepEqual(errors,[]);
});
