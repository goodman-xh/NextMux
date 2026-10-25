import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require=createRequire(import.meta.url);
const core=createRequire(require.resolve('@theia/core/package.json'));
const {build}=createRequire(new URL('../../../apps/desktop/package.json',import.meta.url))('esbuild');
const platform=createRequire(new URL('../../../apps/cloudflare-platform/package.json',import.meta.url));
const puppeteer=(await import(platform.resolve('puppeteer'))).default;
async function serve(t){
 const bundle=await build({stdin:{loader:'tsx',resolveDir:dirname(fileURLToPath(new URL('../src/browser/nextmux-council-mode-view.tsx',import.meta.url))),contents:`
import * as React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {CouncilConfigModal} from './nextmux-council-mode-view';
const models=Array.from({length:32},(_,i)=>({modelId:'m'+i,routeId:'route'+i,label:'Model '+i,variantTag:'1.02×',detail:'A model option detail'}));
window.councilClosed=0;window.councilConfirmed=0;
function Fixture(){const [open,setOpen]=React.useState(false);const [relay,setRelay]=React.useState('');const [model,setModel]=React.useState('');const [role,setRole]=React.useState('');
const [slots,setSlots]=React.useState(Array.from({length:3},(_,i)=>({slotId:'s'+i,modelId:'m27',routeId:'route27',roles:i===0?['lead','generalist']:['generalist']})));
const dismiss=()=>{setModel('');setRole('');};
return <><button id='opener' onClick={()=>setOpen(true)}>Open Council</button>{open&&<CouncilConfigModal locale='en' relayKey={relay} relayLabel='Relay'
renderRelayDrawer={()=> <div className='nmx-relay-popover'><header>Nested relay header</header><div className='nmx-relay-options'>{Array.from({length:12},(_,idx)=><div className='nmx-relay-option-row' key={idx}><button className='nmx-relay-option-select' onClick={()=>setRelay('relay')}><strong className='nmx-relay-option-name'>Local relay {idx}</strong><span className='nmx-relay-option-metrics'>{['100%','99%','1200 ms','1×'].map(value=><span className='nmx-relay-metric-dial' key={value}><span className='nmx-relay-metric-value'>{value}</span></span>)}</span></button><button className='nmx-relay-favorite'>Star</button></div>)}</div><footer data-nested-footer>Nested relay footer</footer></div>}
models={models} slots={slots} openModelPickerSlotId={model} onToggleModelPicker={id=>{setModel(prev=>prev===id?'':id);setRole('');}} openRolePickerSlotId={role}
onToggleRolePicker={id=>{setRole(prev=>prev===id?'':id);setModel('');}} onDismissDropdowns={dismiss}
onSelectSlotModel={(id,routeId)=>setSlots(prev=>prev.map(slot=>slot.slotId===id?{...slot,routeId,modelId:models.find(m=>m.routeId===routeId).modelId}:slot))}
onToggleSlotRole={(id,r)=>setSlots(prev=>prev.map(slot=>slot.slotId===id?{...slot,roles:slot.roles.includes(r)?slot.roles.filter(x=>x!==r):[...slot.roles,r]}:slot))}
onAddSlot={()=>setSlots(prev=>[...prev,{slotId:'s'+prev.length,modelId:'m27',routeId:'route27',roles:['generalist']}])} onRemoveSlot={()=>{}} onConfirm={()=>window.councilConfirmed++} onClose={()=>{window.councilClosed++;setOpen(false);}}/>}</>;}
flushSync(()=>createRoot(document.querySelector('main')).render(<Fixture/>));
`},bundle:true,write:false,platform:'browser',format:'iife',jsx:'transform',logLevel:'silent',plugins:[{name:'no-runtime-crypto-in-ui-fixture',setup(build){build.onResolve({filter:/^node:crypto$/},()=>({path:'unused-crypto',namespace:'ui-fixture'}));build.onLoad({filter:/.*/,namespace:'ui-fixture'},()=>({contents:'export function createHash(){throw new Error("Unexpected runtime hashing in UI fixture");} export function randomInt(){throw new Error("Unexpected runtime dispatch in UI fixture");}',loader:'js'}));}}],alias:{'@nextmux/agent-runtime/council':fileURLToPath(new URL('../../agent-runtime/src/council.ts',import.meta.url)),react:core.resolve('react'),'react-dom':core.resolve('react-dom'),'react-dom/client':core.resolve('react-dom/client')}});
 const css=(await Promise.all(['nextmux.css','nextmux-desktop-production.css','nextmux-composer-attachments.css'].map(name=>readFile(new URL('../src/browser/style/'+name,import.meta.url),'utf8')))).join('\n');
 const server=createServer((req,res)=>{if(req.url==='/fixture.js'){res.writeHead(200,{'content-type':'text/javascript; charset=utf-8'});res.end(bundle.outputFiles[0].contents);}else if(req.url==='/app.css'){res.writeHead(200,{'content-type':'text/css; charset=utf-8'});res.end(css);}else{res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><style>html,body{margin:0;font:14px system-ui}.nmx-shell{width:100vw;height:100vh;display:block!important}main{height:100%;width:100%}</style><div class="nmx-shell nmx-theme-dark"><main></main></div><script src="/fixture.js"></script>');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));return 'http://127.0.0.1:'+server.address().port;
}

test('Council real React portal keeps nested-layout bounds, initial focus, role focus and Escape ownership',{timeout:45000},async t=>{
 const origin=await serve(t);const browser=await puppeteer.launch({headless:true,executablePath:process.env.PUPPETEER_EXECUTABLE_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});t.after(()=>browser.close());const page=await browser.newPage();
 await page.setViewport({width:1180,height:820});await page.setRequestInterception(true);page.on('request',request=>{if(request.url().startsWith(origin))void request.continue();else void request.abort();});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin,{waitUntil:'load'});await page.click('#opener');await page.waitForSelector('.nmx-council-modal');
 assert.equal(await page.$$eval('[data-council-slot]',nodes=>nodes.length),3);
 assert.equal(await page.$('[data-council-generalist-note]'),null);
 assert.equal(await page.$eval('[data-council-add-slot]',el=>el.disabled),true);
 assert.equal(await page.$eval('[data-council-confirm]',el=>el.disabled),true);
 const emptyBounds=await page.$eval('.nmx-council-modal',el=>{const r=el.getBoundingClientRect();return{width:r.width,height:r.height};});
 const relayScrollable=await page.$eval('.nmx-relay-options',el=>({scrollable:el.scrollHeight>el.clientHeight,overflowY:getComputedStyle(el).overflowY}));
 assert.equal(relayScrollable.scrollable,true,'relay list must be vertically scrollable when items overflow');
 assert.equal(relayScrollable.overflowY,'auto');
 await page.hover('.nmx-relay-options');
 await page.mouse.wheel({deltaY:160});
 await page.waitForFunction(()=>document.querySelector('.nmx-relay-options')?.scrollTop>0);
 await page.click('.nmx-relay-option-select');await page.waitForSelector('[data-council-slot="s0"]');

 const initialLayout=await page.evaluate(()=>{const modal=document.querySelector('.nmx-council-modal').getBoundingClientRect();const left=document.querySelector('.nmx-council-sources').getBoundingClientRect(),right=document.querySelector('.nmx-council-assignments').getBoundingClientRect();const metrics=[...document.querySelector('.nmx-relay-option-metrics').children].map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y};});return {width:modal.width,height:modal.height,left:left.width,right:right.width,metrics};});
 assert.equal(initialLayout.width,640);assert.equal(initialLayout.height,460);assert.equal(initialLayout.left,initialLayout.right);
 assert.equal(initialLayout.width,emptyBounds.width);assert.equal(initialLayout.height,emptyBounds.height);
 assert.equal(initialLayout.metrics[0].y,initialLayout.metrics[1].y);assert.ok(initialLayout.metrics[1].x>initialLayout.metrics[0].x);assert.equal(initialLayout.metrics[2].y,initialLayout.metrics[0].y);assert.equal(initialLayout.metrics[3].y,initialLayout.metrics[0].y);assert.ok(initialLayout.metrics[3].x>initialLayout.metrics[2].x);
 for(let i=3;i<8;i++)await page.click('[data-council-add-slot]');
 const fullLayout=await page.evaluate(()=>{const r=document.querySelector('.nmx-council-modal').getBoundingClientRect(),list=document.querySelector('.nmx-council-slots-list');return{width:r.width,height:r.height,scroll:list.scrollHeight>list.clientHeight,slots:document.querySelectorAll('[data-council-slot]').length,addDisabled:document.querySelector('[data-council-add-slot]').disabled};});
 assert.equal(fullLayout.width,initialLayout.width);assert.equal(fullLayout.height,initialLayout.height);assert.equal(fullLayout.scroll,true);assert.equal(fullLayout.slots,8);assert.equal(fullLayout.addDisabled,true);
 await page.click('[data-council-model-select="s0"]');
 await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-selected')==='true'&&getComputedStyle(document.activeElement.closest('.nmx-council-popover')).visibility==='visible');
 const geometry=await page.evaluate(()=>{const dialog=document.querySelector('.nmx-council-modal'),menu=document.querySelector('.nmx-council-model-dropdown'),selected=menu.querySelector('[aria-selected="true"]');const r=menu.getBoundingClientRect(),s=selected.getBoundingClientRect(),head=dialog.querySelector(':scope > header').getBoundingClientRect(),foot=dialog.querySelector(':scope > footer').getBoundingClientRect();return{menu:{top:r.top,bottom:r.bottom,left:r.left,right:r.right},selected:{top:s.top,bottom:s.bottom},headerBottom:head.bottom,footerTop:foot.top,scrollTop:menu.scrollTop,model:document.activeElement.dataset.councilModelOption,nestedFooterCount:dialog.querySelectorAll('footer').length};});

 const priceAlignment=await page.evaluate(()=>{const trigger=document.querySelector('[data-council-model-select="s0"]'),option=document.querySelector('.nmx-council-model-option[aria-selected="true"]');return [trigger,option].map(el=>{const label=el.querySelector('.nmx-council-model-trigger-label,.nmx-council-model-option-label'),price=el.querySelector('.nmx-council-model-price');return {label:label.textContent,price:price.textContent,right:price.getBoundingClientRect().left>=label.getBoundingClientRect().right};});});
 assert.deepEqual(priceAlignment,[{label:'Model 27',price:'1.02×',right:true},{label:'Model 27',price:'1.02×',right:true}]);
 assert.equal(geometry.model,'m27');assert.equal(geometry.nestedFooterCount,2);assert.ok(geometry.scrollTop>0);assert.ok(geometry.selected.top>=geometry.menu.top);assert.ok(geometry.selected.bottom<=geometry.menu.bottom);assert.ok(geometry.menu.top>=geometry.headerBottom+5);assert.ok(geometry.menu.bottom<=geometry.footerTop-5);
 await page.keyboard.press('Escape');assert.equal(await page.$('.nmx-council-popover'),null);assert.equal(await page.evaluate(()=>document.activeElement.dataset.councilModelSelect),'s0');assert.equal(await page.evaluate(()=>window.councilClosed),0);
 await page.click('[data-council-roles-trigger="s1"]');await page.waitForSelector('.nmx-council-role-dropdown');
 assert.equal(await page.$$eval('[data-council-role-option]',nodes=>nodes.length),8);
 const unchecked=await page.$eval('.nmx-council-role-dropdown [aria-checked="false"]',el=>el.dataset.councilRoleOption);await page.click('[data-council-role-option="'+unchecked+'"]');
 await page.waitForFunction(role=>document.querySelector('[data-council-role-option="'+role+'"]')?.getAttribute('aria-checked')==='true',{},unchecked);
 assert.equal(await page.evaluate(()=>document.activeElement.dataset.councilRoleOption),unchecked);
 await page.keyboard.press('ArrowDown');const arrowFocus=await page.evaluate(()=>document.activeElement.dataset.councilRoleOption);assert.notEqual(arrowFocus,unchecked);
 await page.keyboard.press('Space');assert.equal(await page.evaluate(()=>document.activeElement.dataset.councilRoleOption),arrowFocus);
 await page.evaluate(()=>document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',keyCode:229,isComposing:true,bubbles:true})));assert.ok(await page.$('.nmx-council-role-dropdown'));
 await page.keyboard.press('Escape');assert.equal(await page.$('.nmx-council-popover'),null);assert.equal(await page.evaluate(()=>document.activeElement.dataset.councilRolesTrigger),'s1');assert.equal(await page.evaluate(()=>window.councilClosed),0);
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.nmx-council-modal'));assert.equal(await page.evaluate(()=>document.activeElement.id),'opener');assert.equal(await page.evaluate(()=>window.councilClosed),1);assert.equal(await page.evaluate(()=>window.councilConfirmed),0);assert.deepEqual(errors,[]);
});
