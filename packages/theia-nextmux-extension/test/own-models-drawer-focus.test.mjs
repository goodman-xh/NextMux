import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
import test from 'node:test';
import ts from 'typescript';
const require=createRequire(import.meta.url),core=createRequire(require.resolve('@theia/core/package.json'));
const platform=createRequire(new URL('../../../apps/cloudflare-platform/package.json',import.meta.url));
const puppeteer=(await import(platform.resolve('puppeteer'))).default;
const {build}=createRequire(new URL('../../../apps/desktop/package.json',import.meta.url))('esbuild');
const src=readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('widget.tsx',src,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),methods={};
function visit(n){if(ts.isMethodDeclaration(n))methods[n.name.getText(ast)]=n.getText(ast);ts.forEachChild(n,visit);}visit(ast);
async function fixture(t, realModels=false){
const bundle=await build({stdin:{loader:'tsx',resolveDir:dirname(fileURLToPath(new URL('../src/browser/nextmux-own-models-drawer.tsx',import.meta.url))),contents:`
import * as React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {OwnModelsDrawer} from './nextmux-own-models-drawer';
${realModels ? "import {OwnModelList} from './nextmux-official-discovery';" : "function OwnModelList(){return <button id='model-row'>Model</button>;}"}
function myApisText(_l,key){return key;}function ownModelListText(_l,key){return key;}function officialDiscoverySummary(){return 'Two model kinds';}
class Widget{officialModels={connections:['a','b'].map(id=>({id,label:id.toUpperCase(),providerName:'Fixture',model:'fixture-chat',discoveredModels:[{id:'fixture-chat',label:'Chat',outputModalities:['text']},{id:'fixture-embedding',label:'Embedding',outputModalities:['embeddings']}]}))};officialModelListOpenId='';officialConnectionStage='idle';desktopLocale='en';globalModels=[];officialBusyConnectionId='';officialConnectionFeedbackId='';ownModelListFocusToken=0;activeSection='models';modelCenterView='official';node=document.querySelector('main');
myApiRows(){return this.officialModels.connections.map(c=>({...c,name:c.label,host:'fixture.invalid'}));}refreshOfficialConnectionModels(){this.officialConnectionMessage='Updated';this.update();}loadGlobalModels(){}update(){render();}resetWalletTopupSurface(){}closeModelEffortPickerImmediately(){}clearOfficialProviderSurface(){this.officialProviderSheet=undefined;}markComicModelSetupSeen(){}
${['renderOwnModelListDrawer','toggleOwnModelList','closeOwnModelList','trapDialogFocus','hasTransientNavigationSurface','hasDismissibleSurface','dismissTopSurface','clearNavigationSurfaces'].map(n=>methods[n]).join('\n')}
}
const root=createRoot(document.querySelector('main')),widget=new Widget();window.fixture=widget;window.escapes=0;window.addEventListener('keydown',e=>{if(e.key==='Escape')window.escapes++;});
function render(){root.render(<><button id='opener-a' onClick={e=>widget.toggleOwnModelList('a',e.currentTarget)}>Models A</button><button id='opener-b' onClick={e=>widget.toggleOwnModelList('b',e.currentTarget)}>Models B</button><button id='background-action'>Background</button>{widget.officialModelListOpenId&&widget.renderOwnModelListDrawer()}</>)}flushSync(render);
`},bundle:true,write:false,format:'iife',platform:'browser',alias:{react:core.resolve('react'),'react-dom':core.resolve('react-dom'),'react-dom/client':core.resolve('react-dom/client')},logLevel:'silent'});
const server=createServer((req,res)=>{if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><style>.nmx-sheet-backdrop{position:fixed;inset:40px 0 0;background:#ddd}.nmx-own-models-drawer{position:absolute;right:0;width:400px;height:500px;background:white}button{margin:8px}</style><main></main><script src="/fixture.js"></script>');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));return 'http://127.0.0.1:'+server.address().port;
}
test('actual API drawer owns initial focus, Tab/Escape, refresh and trigger restoration',{timeout:30000},async t=>{
 const origin=await fixture(t),browser=await puppeteer.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(origin)?r.continue():r.abort());const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);
 await page.click('#opener-a');await page.waitForFunction(()=>document.activeElement.hasAttribute('data-own-models-close'));
 assert.equal(await page.evaluate(()=>window.fixture.hasTransientNavigationSurface()&&window.fixture.hasDismissibleSurface()),true);
 await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'model-row');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent.trim()),'refresh');await page.keyboard.down('Shift');await page.keyboard.press('Tab');await page.keyboard.up('Shift');assert.equal(await page.evaluate(()=>document.activeElement.id),'model-row');
 await page.evaluate(()=>window.fixture.refreshOfficialConnectionModels());assert.equal(await page.evaluate(()=>document.activeElement.id),'model-row');
 await page.evaluate(()=>document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',keyCode:229,isComposing:true,bubbles:true})));assert.ok(await page.$('.nmx-own-models-drawer'));
 await page.evaluate(()=>window.escapes=0);await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement.id==='opener-a'&&!document.querySelector('.nmx-own-models-drawer'));assert.equal(await page.$('.nmx-own-models-drawer'),null);assert.equal(await page.evaluate(()=>window.escapes),0);
 // The outer navigation dismissal also owns the drawer, even if the user focuses its trigger.
 await page.click('#opener-a');await page.evaluate(()=>{document.querySelector('#opener-a').focus();window.fixture.dismissTopSurface();});await page.waitForFunction(()=>document.activeElement.id==='opener-a'&&!document.querySelector('.nmx-own-models-drawer'));assert.equal(await page.$('.nmx-own-models-drawer'),null);
 // A deferred focus restoration may not steal focus from a newly opened API.
 await page.click('#opener-a');await page.evaluate(()=>{window.fixture.closeOwnModelList();window.fixture.toggleOwnModelList('b',document.querySelector('#opener-b'));});await page.waitForFunction(()=>document.querySelector('.nmx-own-models-drawer')?.getAttribute('aria-label').startsWith('B')&&document.activeElement.hasAttribute('data-own-models-close'));
 await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement.id==='opener-b');
 // Navigation clears state, so returning to My APIs does not resurrect the old drawer.
 await page.click('#opener-a');await page.evaluate(()=>{window.fixture.clearNavigationSurfaces();window.fixture.update();document.querySelector('#background-action').focus();});await page.waitForFunction(()=>!document.querySelector('.nmx-own-models-drawer'));assert.equal(await page.evaluate(()=>document.activeElement.id),'background-action');assert.equal(await page.evaluate(()=>window.fixture.officialModelListOpenId),'');assert.deepEqual(errors,[]);
});

test('real model list category summaries remain keyboard reachable inside the focus trap',{timeout:30000},async t=>{
 const origin=await fixture(t,true),browser=await puppeteer.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(origin)?r.continue():r.abort());await page.goto(origin);
 await page.click('#opener-a');await page.waitForFunction(()=>document.activeElement.hasAttribute('data-own-models-close'));
 await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.type),'search');
 await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.tagName),'SUMMARY');
 assert.equal(await page.evaluate(()=>document.activeElement.parentElement.dataset.kind),'llm');
 await page.keyboard.press('Space');assert.equal(await page.evaluate(()=>document.activeElement.parentElement.open),false);
 await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.parentElement.dataset.kind),'embedding');
 await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent.trim()),'refresh');
 await page.keyboard.down('Shift');await page.keyboard.press('Tab');await page.keyboard.up('Shift');assert.equal(await page.evaluate(()=>document.activeElement.parentElement.dataset.kind),'embedding');
 await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement.id==='opener-a');
});
