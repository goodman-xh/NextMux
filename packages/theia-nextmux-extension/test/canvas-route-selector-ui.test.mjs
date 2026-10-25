import assert from 'node:assert/strict';import test from 'node:test';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),core=createRequire(require.resolve('@theia/core/package.json')),desktop=createRequire(new URL('../../../apps/desktop/package.json',import.meta.url)),platform=createRequire(new URL('../../../apps/cloudflare-platform/package.json',import.meta.url));

test('real connection-first selector keeps merchant, own connection and model choices scoped without paid calls',{timeout:30000},async t=>{
 const {outputFiles}=await desktop('esbuild').build({stdin:{loader:'tsx',resolveDir:fileURLToPath(new URL('../src/browser/',import.meta.url)),contents:`
import React from 'react';import {createRoot} from 'react-dom/client';import {CanvasRouteSelector,useCanvasRouteSelection} from './nextmux-comic-canvas-route-selector';
const r=(key,modelId,sourceKey,label,available=true)=>({key,modelId,connectionId:sourceKey,kind:'image',sourceKey,sourceLabel:label,source:label,label:modelId,routeKind:sourceKey.startsWith('official:')?'own':'relay',available,...(!available?{reason:'Not supported'}:{})});
const routes=[r('a1','model-a','managed:a','Same store'),r('b1','model-a','managed:b','Same store'),r('a2','model-b','managed:a','Same store'),r('c1','model-a','managed:c','Disabled store',false),r('o1','model-a','official:one','My connection'),r('o2','model-b','official:two','My connection')];
let current=routes[1],sourceRoutes=[...routes],calls=[];const root=createRoot(document.querySelector('main'));
const families=()=>['a','b'].map(id=>({id,name:'Model '+id.toUpperCase(),available:true,routes:sourceRoutes.filter(r=>r.modelId==='model-'+id)}));
function App(){const selection=useCanvasRouteSelection(families(),current,choice=>{current=choice;calls.push(choice);render();});window.fixture.selection=selection;return <section><CanvasRouteSelector locale='en' selection={selection}/><button id='generate' disabled={selection.blocked}>Generate</button></section>;}
function render(){root.render(<App/>);}window.fixture={calls,route:()=>current,removeOwn(){sourceRoutes=sourceRoutes.filter(r=>r.routeKind!=='own');render();},external(key){current=routes.find(r=>r.key===key);render();}};render();
`},bundle:true,write:false,platform:'browser',format:'iife',alias:{react:core.resolve('react'),'react-dom/client':core.resolve('react-dom/client'),'@theia/core/shared/react':core.resolve('react')}});
 const puppeteer=(await import(platform.resolve('puppeteer'))).default,browser=await puppeteer.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();page.setDefaultTimeout(4000);const errors=[];page.on('pageerror',e=>errors.push(e.message));t.after(()=>assert.deepEqual(errors,[]));
 await page.setContent('<main></main>');await page.addScriptTag({content:outputFiles[0].text});
 const source='select[aria-label="API source"]',merchant='select[aria-label="Relay provider"]',own='select[aria-label="Own API connection"]',model='select[aria-label="Model"]';
 await page.waitForSelector(merchant);assert.equal(await page.$eval(merchant,e=>e.value),'managed:b');
 assert.deepEqual(await page.$$eval(model+' option',items=>items.map(i=>i.textContent)),['Model A'],'initial selection retains exact merchant B, showing only its models');
 assert.deepEqual(await page.$$eval(merchant+' option',items=>items.slice(0,2).map(i=>i.textContent)),['Same store · a','Same store · b']);
 await page.select(merchant,'managed:a');await page.waitForFunction(()=>fixture.route().key==='a1');
 await page.select(model,'b');await page.waitForFunction(()=>fixture.route().key==='a2');
 await page.select(merchant,'managed:b');await page.waitForFunction(()=>fixture.route().key==='b1');
 await page.select(merchant,'managed:a');await page.waitForFunction(()=>fixture.route().key==='a2');
 const count=await page.evaluate(()=>fixture.calls.length);assert.equal(await page.$eval(merchant+' option[value="managed:c"]',e=>e.disabled),true);
 await page.evaluate(()=>fixture.selection.pickConnection('managed:c'));
 assert.equal(await page.$eval(merchant,e=>e.value),'managed:a');assert.equal(await page.evaluate(()=>fixture.route().key),'a2');
 assert.equal(await page.evaluate(()=>fixture.calls.length),count,'even a stale/programmatic unavailable choice cannot change UI scope while leaving an old generation binding');
 await page.select(source,'own');await page.waitForSelector(own);await page.waitForFunction(()=>fixture.route().key==='o2');
 assert.deepEqual(await page.$$eval(model+' option',items=>items.map(i=>i.textContent)),['Model B']);
 await page.select(own,'official:one');await page.waitForFunction(()=>fixture.route().key==='o1');assert.deepEqual(await page.$$eval(model+' option',items=>items.map(i=>i.textContent)),['Model A']);
 await page.select(source,'relay');await page.waitForSelector(merchant);assert.equal(await page.$eval(merchant,e=>e.value),'managed:a');assert.equal(await page.evaluate(()=>fixture.route().key),'a2','returning to relay restores its actual last model binding');
 await page.select(merchant,'managed:b');await page.waitForFunction(()=>fixture.route().key==='b1');
 await page.select(source,'own');await page.waitForFunction(()=>fixture.route().key==='o1');
 await page.evaluate(()=>fixture.removeOwn());const before=await page.evaluate(()=>fixture.calls.length);assert.equal(await page.$eval('#generate',e=>e.disabled),true);assert.equal(await page.$eval(own,e=>e.value),'');
 await page.select(source,'relay');await page.waitForFunction(()=>fixture.route().key==='b1');assert.equal(await page.$eval(source+' option[value=own]',e=>e.disabled),true);await page.evaluate(()=>fixture.selection.pickKind('own'));
 assert.equal(await page.$eval(source,e=>e.value),'relay');assert.equal(await page.evaluate(()=>fixture.route().key),'b1');assert.equal(await page.evaluate(()=>fixture.calls.length),before+1,'missing own connections keep the visible relay source and saved binding consistent for every generation entry point');
 await page.evaluate(()=>fixture.external('a2'));await page.waitForFunction(()=>document.querySelector('select[aria-label="Relay provider"]')?.value==='managed:a'&&document.querySelector('select[aria-label="Model"]')?.value==='b');
 assert.equal(await page.$eval(merchant,e=>e.value),'managed:a');assert.equal(await page.$eval(model,e=>e.value),'b','undo or external saved-route changes update both connection and model');
 await page.evaluate(()=>fixture.external('c1'));await page.waitForFunction(()=>document.querySelector('select[aria-label=\"Relay provider\"]').value==='managed:c');assert.equal(await page.$eval('#generate',e=>e.disabled),true,'an already saved unavailable route stays visible and blocked');
 await page.select(merchant,'managed:b');await page.waitForFunction(()=>fixture.route().key==='b1');assert.equal(await page.$eval('#generate',e=>e.disabled),false);
});
