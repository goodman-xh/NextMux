import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
const require=createRequire(import.meta.url),core=createRequire(require.resolve('@theia/core/package.json'));
const {build}=createRequire(new URL('../../../apps/desktop/package.json',import.meta.url))('esbuild');
const platform=createRequire(new URL('../../../apps/cloudflare-platform/package.json',import.meta.url));
const puppeteer=(await import(platform.resolve('puppeteer'))).default;
async function serve(t){
 const bundle=await build({stdin:{loader:'tsx',resolveDir:dirname(fileURLToPath(new URL('../src/browser/nextmux-thread-notes.tsx',import.meta.url))),contents:`
import * as React from 'react';import {createRoot} from 'react-dom/client';import {ThreadNotes,hasThreadNoteContent,hasThreadNotes} from './nextmux-thread-notes';import {placeModelPickerPanels} from './nextmux-floating-panel';window.place=placeModelPickerPanels;window.hasThreadNoteContent=hasThreadNoteContent;window.hasThreadNotes=hasThreadNotes;window.noteEvents=[];
localStorage.setItem('nextmux.desktop.notes.height.conversation.v1','56');localStorage.setItem('nextmux.desktop.notes.height.global.v1','56');
createRoot(document.querySelector('main')).render(<div className='nmx-coding-stage'><aside className='nmx-thread-notes-float'><span className='nmx-thread-float-tab' tabIndex={0}><i className='codicon codicon-note'/>N</span><ThreadNotes locale='en' conversationId='isolated-fixture' onNoteChange={(id,has)=>window.noteEvents.push([id,has])}/></aside></div>);
`},bundle:true,write:false,platform:'browser',format:'iife',alias:{react:core.resolve('react'),'react-dom':core.resolve('react-dom'),'react-dom/client':core.resolve('react-dom/client')},logLevel:'silent'});
 const css=(await Promise.all(['nextmux.css','nextmux-desktop-production.css','nextmux-pickers-settings.css','nextmux-shell-polish.css','nextmux-composer-attachments.css'].map(n=>readFile(new URL('../src/browser/style/'+n,import.meta.url),'utf8')))).join('\n');
 const server=createServer((req,res)=>{if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);}else{res.setHeader('Content-Type','text/html');res.end(`<!doctype html><meta charset='utf-8'><style>${css}</style><style>html,body{margin:0;width:100%;height:100%;font:14px system-ui}.nmx-shell{display:block!important;width:100%;height:100%}.nmx-coding-stage{position:relative!important;width:700px!important;height:800px;--nmx-float-top:16px;--nmx-float-bottom:16px}</style><div class='nmx-shell'><main></main></div><script src='/fixture.js'></script>`);}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));return 'http://127.0.0.1:'+server.address().port;
}
async function pageFor(t){const origin=await serve(t),browser=await puppeteer.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();await page.setViewport({width:1000,height:900});await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(origin)?r.continue():r.abort());await page.goto(origin);return page;}
async function measureNotes(page){return page.evaluate(()=>{const float=document.querySelector('.nmx-thread-notes-float'),panel=float.querySelector('.nmx-thread-notes'),tab=float.querySelector('.nmx-thread-float-tab');const rect=e=>{const r=e.getBoundingClientRect();return{top:r.top,bottom:r.bottom,height:r.height,width:r.width}};return {tall:float.classList.contains('is-tall-panel'),float:rect(float),panel:rect(panel),tab:rect(tab)};});}
async function waitPlacement(page,tall){await page.waitForFunction(tall=>{const f=document.querySelector('.nmx-thread-notes-float'),p=f.querySelector('.nmx-thread-notes'),tab=f.querySelector('.nmx-thread-float-tab'),a=p.getBoundingClientRect(),b=f.getBoundingClientRect();return f.classList.contains('is-tall-panel')===tall&&(tall?Math.abs((a.top+a.bottom)-(b.top+b.bottom))<2:Math.abs(a.top-tab.getBoundingClientRect().top)<2);},{},tall);}
test('actual notes align small cards, center resized cards inside bounds and restore alignment',{timeout:30000},async t=>{
 const page=await pageFor(t),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.focus('.nmx-thread-float-tab');await waitPlacement(page,false);let m=await measureNotes(page);assert.equal(m.panel.width,208);assert.ok(Math.abs(m.panel.top-m.tab.top)<1);
 await page.evaluate(()=>{document.querySelector('.nmx-coding-stage').style.height='600px';for(const a of document.querySelectorAll('.nmx-thread-note textarea'))a.style.height='320px';});await waitPlacement(page,true);m=await measureNotes(page);assert.equal(m.panel.width,208);assert.ok(m.panel.top>=m.float.top-1&&m.panel.bottom<=m.float.bottom+1);
 await page.evaluate(()=>{for(const a of document.querySelectorAll('.nmx-thread-note textarea'))a.style.height='56px';});await waitPlacement(page,false);m=await measureNotes(page);assert.equal(m.panel.width,208);
 await page.evaluate(()=>document.querySelector('.nmx-coding-stage').style.height='280px');await waitPlacement(page,true);m=await measureNotes(page);assert.ok(m.panel.top>=m.float.top-1&&m.panel.bottom<=m.float.bottom+1);assert.equal(m.panel.width,208);
 await page.evaluate(()=>document.querySelector('.nmx-coding-stage').style.height='800px');await waitPlacement(page,false);
 const b9=await page.evaluate(async()=>{
  const area=document.querySelector('.nmx-thread-note textarea');
  area.focus();
  await new Promise(r=>setTimeout(r,350));
  const duringFocus={value:area.value,stored:localStorage.getItem('nextmux.desktop.notes.conversation.v1:isolated-fixture'),hasNotes:window.hasThreadNotes('isolated-fixture'),dot:document.querySelector('.codicon-note').classList.contains('has-notes')};
  area.blur();
  await new Promise(r=>setTimeout(r,20));
  const afterBlur={value:area.value,stored:localStorage.getItem('nextmux.desktop.notes.conversation.v1:isolated-fixture'),hasNotes:window.hasThreadNotes('isolated-fixture'),dot:document.querySelector('.codicon-note').classList.contains('has-notes'),emptyCheck:[window.hasThreadNoteContent(''),window.hasThreadNoteContent('1. '),window.hasThreadNoteContent('1. \n2. '),window.hasThreadNoteContent('1. hello')]};
  return {duringFocus,afterBlur};
 });
 assert.deepEqual(b9.duringFocus,{value:'1. ',stored:null,hasNotes:false,dot:false});
 assert.deepEqual(b9.afterBlur,{value:'',stored:null,hasNotes:false,dot:false,emptyCheck:[false,false,false,true]});
 assert.deepEqual(errors,[]);
});
