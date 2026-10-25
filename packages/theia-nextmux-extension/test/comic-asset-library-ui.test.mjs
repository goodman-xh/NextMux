import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { sourceModule } from './helpers/comic-organizer-source-loader.mjs';
const {ComicAssetLibraryStore}=sourceModule('node/nextmux-comic-asset-library-store.ts');
const require=createRequire(import.meta.url),core=createRequire(require.resolve('@theia/core/package.json'));
const desktop=createRequire(new URL('../../../apps/desktop/package.json',import.meta.url));
const platform=createRequire(new URL('../../../apps/cloudflare-platform/package.json',import.meta.url));
const puppeteer=(await import(platform.resolve('puppeteer'))).default;

test('actual React library picker retries imports, preserves scope locks and manages existing assets', {timeout:45000}, async t=>{
    const temp=await mkdtemp(join(tmpdir(),'nextmux-library-ui-'));t.after(()=>rm(temp,{recursive:true,force:true}));
    const sourcePath=join(temp,'source.png');await writeFile(sourcePath,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=','base64'));
    const store=new ComicAssetLibraryStore(join(temp,'library')),used=[],useRequests=new Set();
    for(const id of ['a','b','d'])await store.save({requestId:'fixture-saved-'+id,assetName:id==='a'?'Saved image':id,assetCategory:'other',assetType:id==='a'?'image':'text',remark:'',source:{projectId:'project',canvasId:'canvas',nodeId:id},...(id==='a'?{sourcePath}:{textContent:'Saved '+id})});
    const entries=await store.list();
    const {outputFiles}=await desktop('esbuild').build({stdin:{loader:'tsx',resolveDir:dirname(fileURLToPath(new URL('../src/browser/nextmux-comic-asset-library.tsx',import.meta.url))),contents:`
import * as React from 'react';import {createRoot} from 'react-dom/client';
import {CanvasAssetLibraryDialog} from './nextmux-comic-asset-library';
import {CanvasModalLayer} from './nextmux-comic-canvas-modal';
import {comicAssetLibraryText} from './nextmux-comic-asset-library-text';
const root=createRoot(document.querySelector('main'));
const fixture={key:0,closed:0,useCalls:[],failLoad:true,text:comicAssetLibraryText};window.fixture=fixture;
function close(){fixture.closed++;root.render(<p>Closed</p>);}
function renderDialog(children){root.render(<CanvasModalLayer key={fixture.key} locale='en'>{children}</CanvasModalLayer>);}
fixture.library=()=>renderDialog(<CanvasAssetLibraryDialog key={++fixture.key} operationScope='fixture-canvas' locale='en' load={()=>{if(fixture.failLoad){fixture.failLoad=false;throw Error('offline');}return window.listLibrary();}}
 onUse={async(id,requestId)=>{fixture.useCalls.push({id,requestId});await new Promise(resolve=>fixture.finishUse=resolve);await window.useLibrary(id,requestId);}} onClose={close}/>);
fixture.manage=()=>renderDialog(<CanvasAssetLibraryDialog key={++fixture.key} operationScope='fixture-management' locale='en' selectTypes={['image']} load={()=>window.listLibrary()}
 onUse={async()=>{throw Error('not invoked by management test');}} onUpload={()=>window.uploadLibrary()} onPin={(id,pinned)=>window.pinLibrary(id,pinned)} onDelete={id=>window.deleteLibrary(id)} onClose={close}/>);

`},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'empty'},alias:{react:core.resolve('react'),'@theia/core/shared/react':core.resolve('react'),'react-dom/client':core.resolve('react-dom/client')}});
    const browser=await puppeteer.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage(),errors=[];page.setDefaultTimeout(7000);page.on('pageerror',error=>errors.push(error.message));
    await page.exposeFunction('listLibrary',()=>new ComicAssetLibraryStore(join(temp,'library')).list());
    await page.exposeFunction('pinLibrary',(assetId,pinned)=>store.setPinned(assetId,pinned));
    await page.exposeFunction('deleteLibrary',assetId=>store.remove(assetId));
    await page.exposeFunction('uploadLibrary',async()=>[await store.save({requestId:'fixture-local-upload',assetName:'New upload',assetCategory:'other',assetType:'image',remark:'',sourcePath,source:{origin:'local_file'}})]);
    await page.exposeFunction('useLibrary',async(id,requestId)=>{if(useRequests.has(requestId))return;useRequests.add(requestId);used.push((await store.get(id)).assetId);throw Error('fixture import acknowledgement lost');});
    await page.setRequestInterception(true);page.on('request',request=>void request.respond({status:200,contentType:'text/html',body:'<main></main>'}));
    await page.goto('https://asset-library.test/');
    for(const name of ['nextmux-comic-canvas.css','nextmux-comic-asset-library.css'])await page.addStyleTag({content:await readFile(new URL('../src/browser/style/'+name,import.meta.url),'utf8')});
    await page.addStyleTag({content:'main{--nmx-panel:#222;--nmx-panel-2:#333;--nmx-text:#eee;--nmx-muted:#aaa;--nmx-border:#555;--nmx-accent:#b18cdb;--theia-editor-background:#222;--theia-foreground:#eee;--theia-panel-border:#555;--theia-input-background:#333;--theia-input-foreground:#eee;font:13px system-ui}'});await page.addScriptTag({content:outputFiles[0].text});
    await page.evaluate(()=>window.fixture.library());await page.waitForSelector('[role=dialog][aria-label="Asset library"] [role=alert]');await page.click('[role=alert] button');await page.waitForSelector('article');
    await page.click('.nmx-library-toolbar button[title="Images"]');assert.equal((await page.$$('article')).length,1);
    await page.$eval('article button',e=>{e.click();e.click();});await page.waitForFunction(()=>window.fixture.useCalls.length===1);
    assert.equal(await page.$eval('header button',e=>e.disabled),false);await page.click('header button');
    await page.evaluate(()=>window.fixture.library());await page.waitForSelector('article');await page.click('.nmx-library-toolbar button[title="Images"]');
    assert.equal(await page.$eval('article button',e=>e.disabled),true,'closing and reopening cannot duplicate an in-flight import');
    await page.evaluate(()=>window.fixture.finishUse());await page.waitForFunction(()=>!document.querySelector('article button').disabled);
    await page.click('article button');await page.waitForFunction(()=>window.fixture.useCalls.length===2);
    assert.equal(await page.evaluate(()=>window.fixture.useCalls[0].requestId===window.fixture.useCalls[1].requestId),true,'picker retry keeps its original import request ID');
    await page.evaluate(()=>window.fixture.finishUse());await page.waitForFunction(()=>window.fixture.closed===2);
    assert.deepEqual(used,[entries.find(e=>e.source.nodeId==='a').assetId]);
    await page.evaluate(()=>window.fixture.manage());
    await page.waitForFunction(()=>document.querySelector('button[aria-label="Upload local files"]')&&document.querySelectorAll('article').length===3);
    assert.deepEqual(await page.$eval('.nmx-board-asset-library',e=>{const r=e.getBoundingClientRect();return {centerX:r.x+r.width/2,centerY:r.y+r.height/2,width:r.width,height:r.height,bg:getComputedStyle(e).backgroundColor};}),{centerX:400,centerY:300,width:752,height:552,bg:'rgb(34, 34, 34)'},'real library CSS centers an opaque scrollable dialog inside the viewport');
    assert.equal(await page.$$eval('article button[aria-label="Add to canvas"]:disabled',buttons=>buttons.length),2,'text cannot be put into an image-only reference slot');
    await page.click('.nmx-library-toolbar button[title="Images"]');assert.equal((await page.$$('article')).length,1);
    await page.click('button[aria-label="Pin asset"]');await page.waitForSelector('button[aria-label="Unpin asset"]');
    assert.ok((await store.list())[0].pinnedAt);await page.click('button[aria-label="Upload local files"]');await page.waitForFunction(()=>document.querySelectorAll('article').length===2);
    const imageId=entries.find(e=>e.source.nodeId==='a').assetId,selector=`article[data-library-asset="${imageId}"]`;
    await page.click(`${selector} button[aria-label="Delete library item"]`);await page.waitForSelector(`${selector} .nmx-library-delete-confirm`);
    await page.click(`${selector} button[title="Cancel"]`);assert.ok(await page.$(selector));
    await page.click(`${selector} button[aria-label="Delete library item"]`);await page.click(`${selector} .nmx-library-delete-confirm button[title="Delete library item"]`);
    await page.waitForFunction(id=>!document.querySelector(`article[data-library-asset="${id}"]`),{},imageId);
    assert.equal((await store.list()).length,3);assert.ok((await readFile(sourcePath)).length>0,'deleting the library entry does not remove the source');
    await page.keyboard.press('Escape');await page.waitForFunction(()=>window.fixture.closed===3);
    const labels=['save','library','name','category','remark','character','scene','item','style','audio','audioMedia','other','all','bulk','pending','saving','success','error','remove','close','retry','invalidName','emptyText','emptyMedia','hint','use','loading','empty','loadFailed','image','video','text','upload','sort','newest','oldest','pin','unpin','delete','cancel','deleteHint','workingClose','notAllowed','characterDetails','manageCharacters'];
    for(const locale of ['zh-CN','en','zh-TW','ja','ko','es','fr','de','pt-BR','ru','ar','hi'])assert.ok((await page.evaluate(({locale,labels})=>labels.map(key=>window.fixture.text(locale,key)),{locale,labels})).every(Boolean),locale);
    assert.deepEqual(errors,[]);
});
