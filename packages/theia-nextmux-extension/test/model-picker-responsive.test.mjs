import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import ts from 'typescript';
const platform=createRequire(new URL('../../../apps/cloudflare-platform/package.json',import.meta.url));
const puppeteer=(await import(platform.resolve('puppeteer'))).default;
const source=readFileSync(new URL('../src/browser/nextmux-floating-panel.ts',import.meta.url),'utf8');
const moduleFixture={exports:{}};
new Function('exports','module',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(moduleFixture.exports,moduleFixture);
const {placeModelPickerPanels}=moduleFixture.exports;
const styles=['nextmux.css','nextmux-desktop-production.css','nextmux-pickers-settings.css','nextmux-shell-polish.css','nextmux-composer-attachments.css'].map(n=>readFileSync(new URL('../src/browser/style/'+n,import.meta.url),'utf8')).join('\n');
test('picker and detail use actual responsive widths without overlap or clipping',{timeout:30000},async t=>{
 const browser=await puppeteer.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();await page.setRequestInterception(true);page.on('request',r=>r.abort());
 for(const width of [360,500,760]){
  const geometry=placeModelPickerPanels({left:8,top:80,width:264,height:200,maxHeight:200,side:'above'},{width,height:800});await page.setViewport({width,height:800});
  await page.setContent(`<style>${styles}</style><div class='nmx-shell'><section class='nmx-composer-popover nmx-route-popover nmx-model-picker-popover nmx-model-only-popover' style='position:fixed;left:${geometry.picker.left}px;top:80px;width:${geometry.picker.width}px;height:200px'>Model</section></div><div class='nmx-model-effort-portal nmx-theme-dark'><section class='nmx-model-effort-menu nmx-model-evidence-menu is-${geometry.detail.side}' style='left:${geometry.detail.left}px;top:80px;width:${geometry.detail.width}px;max-height:400px'><div class='nmx-offering-price'>Price detail</div></section></div>`);
  const actual=await page.evaluate(()=>Object.fromEntries([['picker','.nmx-model-picker-popover'],['detail','.nmx-model-effort-menu']].map(([id,selector])=>{const r=document.querySelector(selector).getBoundingClientRect();return[id,{left:r.left,right:r.right,width:r.width}];})));const label=JSON.stringify({width,geometry,actual});
  for(const key of ['picker','detail']){assert.ok(Math.abs(actual[key].width-geometry[key].width)<1,label);assert.ok(actual[key].left>=7&&actual[key].right<=width-7,label);}
  assert.ok(geometry.detail.side==='left'?actual.detail.right+6<=actual.picker.left:actual.picker.right+6<=actual.detail.left,label);
  if(width===760){assert.equal(actual.picker.width,264);assert.equal(actual.detail.width,340);}
 }
});
