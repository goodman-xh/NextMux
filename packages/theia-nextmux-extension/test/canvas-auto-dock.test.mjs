import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const require=createRequire(import.meta.url),core=createRequire(require.resolve('@theia/core/package.json'));
const desktop=createRequire(new URL('../../../apps/desktop/package.json',import.meta.url));
const platform=createRequire(new URL('../../../apps/cloudflare-platform/package.json',import.meta.url));
const puppeteer=(await import(platform.resolve('puppeteer'))).default;
test('dock preference, timers, hover, focus and open panels never change canvas or hide active controls', {timeout:30000}, async t=>{
 const url=new URL('../src/browser/nextmux-comic-canvas-dock.tsx',import.meta.url);
 const {outputFiles}=await desktop('esbuild').build({stdin:{loader:'tsx',resolveDir:dirname(fileURLToPath(url)),contents:`
import * as React from 'react';import {createRoot} from 'react-dom/client';import {CanvasAutoDock,canvasDockText} from './nextmux-comic-canvas-dock';
const root=createRoot(document.querySelector('main'));let keep=false,panel=false,key='user-a',rev=0;
function App(){const board=React.useRef(null);return <div ref={board} className='nmx-board'><button id='outside'>Outside</button><CanvasAutoDock locale='en' storageKey={key} root={board} keepOpen={keep}><button id='action'>Add</button></CanvasAutoDock>{panel&&<aside role='dialog'>Dialog</aside>}</div>}
function render(){root.render(<App key={rev}/>)}window.fixture={render,text:canvasDockText,setKeep(v){keep=v;render()},setPanel(v){panel=v;render()},switchUser(v){key=v;rev++;render()}};render();`},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'empty'},alias:{react:core.resolve('react'),'react-dom/client':core.resolve('react-dom/client')}});
 const browser=await puppeteer.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setRequestInterception(true);page.on('request',r=>void r.respond({status:200,contentType:'text/html',body:'<main></main>'}));await page.goto('https://dock.test/');
 await page.addStyleTag({content:await readFile(new URL('../src/browser/style/nextmux-comic-canvas-dock.css',import.meta.url),'utf8')+' .nmx-board-dock{position:fixed;bottom:20px;left:100px;padding:10px;background:#eee}'});
 await page.addScriptTag({content:outputFiles[0].text});await page.waitForSelector('#action');
 const hidden=()=>page.$eval('.nmx-board-dock',e=>e.classList.contains('is-auto-hidden'));
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 await sleep(1300);assert.equal(await hidden(),false,'off by default');
 await page.click('[aria-label="Auto-hide toolbar"]');await page.mouse.move(20,20);await sleep(150);assert.equal(await hidden(),false);await page.waitForSelector('.is-auto-hidden');
 assert.equal(await page.evaluate(()=>localStorage.getItem('user-a')),'true');
 await page.hover('.nmx-board-dock');await page.waitForFunction(()=>!document.querySelector('.nmx-board-dock').classList.contains('is-auto-hidden'));
 await page.mouse.move(20,20);await page.waitForSelector('.is-auto-hidden');
 await page.focus('[aria-label="Show toolbar"]');await page.waitForFunction(()=>document.activeElement?.id==='action');await sleep(400);assert.equal(await hidden(),false,'keyboard focus keeps toolbar open');
 await page.focus('#outside');await page.waitForSelector('.is-auto-hidden');
 await page.evaluate(()=>window.fixture.setKeep(true));await page.waitForFunction(()=>!document.querySelector('.nmx-board-dock').classList.contains('is-auto-hidden'));await sleep(400);assert.equal(await hidden(),false);
 await page.evaluate(()=>window.fixture.setKeep(false));await sleep(150);await page.evaluate(()=>window.fixture.setPanel(true));await sleep(400);assert.equal(await hidden(),false,'opening a dialog cancels pending collapse');
 await page.evaluate(()=>window.fixture.setPanel(false));await page.waitForSelector('.is-auto-hidden');
 await page.evaluate(()=>window.fixture.switchUser('user-b'));await page.waitForFunction(()=>document.querySelector('[aria-label="Auto-hide toolbar"]').getAttribute('aria-pressed')==='false');await sleep(1300);assert.equal(await hidden(),false);
 await page.evaluate(()=>window.fixture.switchUser('user-a'));await page.waitForFunction(()=>document.querySelector('[aria-label="Auto-hide toolbar"]').getAttribute('aria-pressed')==='true');assert.equal(await hidden(),false);await sleep(600);assert.equal(await hidden(),false,'restored preference initially waits 1200ms');await page.waitForSelector('.is-auto-hidden');
 for(const locale of ['zh-CN','en','zh-TW','ja','ko','es','fr','de','pt-BR','ru','ar','hi'])assert.ok((await page.evaluate(locale=>['autoHide','show'].map(k=>window.fixture.text(locale,k)),locale)).every(Boolean));
 assert.deepEqual(errors,[]);
});
