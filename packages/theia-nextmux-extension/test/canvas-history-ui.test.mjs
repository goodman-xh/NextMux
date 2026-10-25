import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const require=createRequire(import.meta.url),core=createRequire(require.resolve('@theia/core/package.json'));
const desktop=createRequire(new URL('../../../apps/desktop/package.json',import.meta.url));
const platform=createRequire(new URL('../../../apps/cloudflare-platform/package.json',import.meta.url));
const puppeteer=(await import(platform.resolve('puppeteer'))).default;

test('actual history dialog previews local versions, filters jobs, disables inaccessible media, guards repeat selection and stays closable', {timeout:45000}, async t=>{
    const {outputFiles}=await desktop('esbuild').build({stdin:{loader:'tsx',resolveDir:dirname(fileURLToPath(new URL('../src/browser/nextmux-comic-canvas-history.tsx',import.meta.url))),contents:`
import * as React from 'react';import {createRoot} from 'react-dom/client';import {CanvasGenerationHistoryDialog} from './nextmux-comic-canvas-history';
const root=createRoot(document.querySelector('main'));const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=';
const snapshot={modelId:'fixture-model',prompt:'A real historical prompt',parameters:{resolution:'720p',apiKey:'NEVER_RENDER_ME'},resolvedInputs:[]};
const version=(id,status)=>({id,assetId:id,kind:'image',uri:id+'.png',createdAt:'2026-10-03T01:00:00Z',snapshot,...(status?{status}:{})});
const make=(id)=>({id,projectId:'project',title:id,nodes:[{id:'picture',kind:'imageGen',title:'Picture '+id,payload:{versions:[version('old'),version('current'),version('missing','missing'),version('broken')],currentVersionId:'current',jobs:[{idempotencyKey:'failed',status:'failed',createdAt:'2026-10-03T03:00:00Z',snapshot},{idempotencyKey:'running',status:'running',createdAt:'2026-10-03T02:00:00Z',snapshot}]}}]});
const fixture={canvases:[make('one'),make('two')],calls:[],closed:0,open:true,node:false,hold:false,refreshes:0};window.fixture=fixture;
function render(){if(!fixture.open){root.render(<p>Closed</p>);return;}root.render(<CanvasGenerationHistoryDialog key={fixture.node?'node':'global'} locale='en' canvases={fixture.canvases} initialCanvasId={fixture.node?'one':undefined} initialNodeId={fixture.node?'picture':undefined} mediaUrl={uri=>uri==='broken.png'?'https://missing.fixture/not-found':png}
onRefresh={async()=>{fixture.refreshes++;}} onClose={()=>{fixture.closed++;fixture.open=false;render();}}
onSelectVersion={async(canvasId,nodeId,versionId)=>{fixture.calls.push({canvasId,nodeId,versionId});if(fixture.hold)await new Promise(done=>fixture.finish=done);
fixture.canvases=fixture.canvases.map(canvas=>canvas.id!==canvasId?canvas:{...canvas,nodes:canvas.nodes.map(node=>node.id!==nodeId?node:{...node,payload:{...node.payload,currentVersionId:versionId}})});render();}}/>);}
fixture.render=render;fixture.nodeHistory=()=>{fixture.node=true;fixture.open=true;render();};fixture.reopen=()=>{fixture.open=true;render();};fixture.removeOld=()=>{fixture.canvases=fixture.canvases.map(canvas=>({...canvas,nodes:canvas.nodes.map(node=>({...node,payload:{...node.payload,versions:node.payload.versions.filter(version=>version.id!=='old')}}))}));render();};render();
`},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'empty'},alias:{react:core.resolve('react'),'@theia/core/shared/react':core.resolve('react'),'react-dom/client':core.resolve('react-dom/client'),'@theia/core/shared/react-dom':core.resolve('react-dom')}});
    const browser=await puppeteer.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();page.setDefaultTimeout(7000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.setRequestInterception(true);page.on('request',request=>void(request.url()==='https://history.fixture/'?request.respond({status:200,contentType:'text/html',body:'<main></main>'}):request.url().startsWith('https://missing.fixture')?request.abort():request.continue()));
    await page.setViewport({width:1600,height:900});await page.goto('https://history.fixture/');
    for(const file of ['nextmux-comic-canvas.css','nextmux-comic-canvas-history.css'])await page.addStyleTag({content:await readFile(new URL('../src/browser/style/'+file,import.meta.url),'utf8')});
    await page.addScriptTag({content:outputFiles[0].text});await page.waitForSelector('[role=dialog]');
    const select='.nmx-canvas-history-select>button',row=(canvas,version)=>`button[data-history-key='${JSON.stringify([canvas,'picture','version',version])}']`;
    assert.match(await page.$eval('.nmx-canvas-history-scope',e=>e.textContent),/2 loaded canvases/);assert.equal((await page.$$('button[data-history-key]')).length,12);
    await page.click(row('one','missing'));assert.equal(await page.$eval(select,e=>e.disabled),true);assert.match(await page.$eval('.nmx-canvas-history-preview',e=>e.textContent),/inaccessible/);
    await page.click(row('one','broken'));await page.waitForFunction(()=>document.querySelector('.nmx-canvas-history-preview').textContent.includes('inaccessible'));assert.equal(await page.$eval(select,e=>e.disabled),true);
    await page.click(row('one','old'));await page.waitForFunction(()=>!document.querySelector('.nmx-canvas-history-select>button').disabled);
    const globalGeometry=await page.evaluate(()=>{const main=document.querySelector('.nmx-canvas-history.is-global').getBoundingClientRect(),detail=document.querySelector('.nmx-canvas-history-drawer').getBoundingClientRect();return {width:main.width,detailWidth:detail.width,gap:detail.left-main.right,grid:getComputedStyle(document.querySelector('.nmx-canvas-history-grid')).display};});
    assert.deepEqual(globalGeometry,{width:760,detailWidth:380,gap:12,grid:'grid'});
    await page.click('button[title="List"]');assert.equal(await page.$eval('.nmx-canvas-history-grid',e=>getComputedStyle(e).display),'flex');await page.click('button[title="Grid"]');
    const evidence=fileURLToPath(new URL('../../../.nextmux-run/canvas-history-review/',import.meta.url));await mkdir(evidence,{recursive:true});await page.screenshot({path:evidence+'global-history.png'});
    const title=await page.$eval('.nmx-canvas-history.is-global>header>strong',e=>{const r=e.getBoundingClientRect();return{x:r.left+10,y:r.top+10};});
    await page.mouse.move(title.x,title.y);await page.mouse.down();await page.mouse.move(title.x-60,title.y+30,{steps:5});await page.mouse.up();
    const resize=await page.$eval('.nmx-canvas-history-resize',e=>{const r=e.getBoundingClientRect();return{x:r.left+8,y:r.top+8};});
    await page.mouse.move(resize.x,resize.y);await page.mouse.down();await page.mouse.move(resize.x+40,resize.y+40,{steps:5});await page.mouse.up();
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('nextmux.canvas.history.window.v1')));assert.equal(saved.left,360);assert.equal(saved.top,54);assert.equal(saved.width,800);assert.equal(saved.height,760);
    assert.doesNotMatch(await page.$eval('.nmx-canvas-history-detail',e=>e.textContent),/NEVER_RENDER_ME|apiKey/);
    await page.click(select);await page.waitForFunction(()=>window.fixture.calls.length===1&&document.querySelector('.nmx-canvas-history-select>button').disabled);
    assert.deepEqual(await page.evaluate(()=>window.fixture.calls[0]),{canvasId:'one',nodeId:'picture',versionId:'old'});
    await page.click(row('two','old'));await page.waitForFunction(()=>!document.querySelector('.nmx-canvas-history-select>button').disabled);await page.evaluate(()=>window.fixture.hold=true);
    await page.$eval(select,e=>{e.click();e.click();});assert.equal(await page.evaluate(()=>window.fixture.calls.length),2);await page.click('button[aria-label="Close history"]');
    assert.equal(await page.evaluate(()=>window.fixture.closed),1);await page.evaluate(()=>{window.fixture.hold=false;window.fixture.finish();});
    await page.waitForFunction(()=>window.fixture.canvases[1].nodes[0].payload.currentVersionId==='old');assert.equal(await page.$('[role=dialog]'),null);
    await page.evaluate(()=>window.fixture.reopen());await page.waitForSelector('[role=dialog]');
    assert.equal(await page.$eval('.nmx-canvas-history.is-global',e=>e.getBoundingClientRect().width),800);
    await page.click(row('one','current'));await page.waitForFunction(()=>!document.querySelector('.nmx-canvas-history-select>button').disabled);await page.evaluate(()=>window.fixture.removeOld());
    assert.equal((await page.$$('button[data-history-key]')).length,10);await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>window.fixture.closed),2);
    await page.evaluate(()=>window.fixture.nodeHistory());await page.waitForSelector('.nmx-canvas-history.is-node');
    const geometry=await page.evaluate(()=>({right:document.querySelector('.nmx-canvas-history-node-right').getBoundingClientRect().width,bottom:document.querySelector('.nmx-canvas-history-bottom').getBoundingClientRect().height,thumb:document.querySelector('.nmx-canvas-history-strip>button').getBoundingClientRect().width}));
    assert.equal(geometry.right,340);assert.equal(geometry.bottom,100);assert.equal(geometry.thumb,72);
    await page.screenshot({path:evidence+'node-history.png'});
    await page.click('button[title="Succeeded"]');await page.click('button[title="In progress"]');await page.click('button[title="Other"]');
    assert.equal((await page.$$('button[data-history-key]')).length,1);assert.equal(await page.$eval(select,e=>e.disabled),true);
    await page.keyboard.press('Escape');assert.equal(await page.$('[role=dialog]'),null);
    assert.deepEqual(errors,[]);
});
