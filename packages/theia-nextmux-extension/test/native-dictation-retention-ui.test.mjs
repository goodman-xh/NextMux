import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),desktop=createRequire(new URL('../../../apps/desktop/package.json',import.meta.url)),platform=createRequire(new URL('../../../apps/cloudflare-platform/package.json',import.meta.url)),core=createRequire(require.resolve('@theia/core/package.json'));
const source=readFileSync(new URL('../src/browser/nextmux-native-dictation-adapter.ts',import.meta.url),'utf8');
function bundle(legacy=false){
 const adapter=legacy?source.replace("if (!event.text.trim()) return;",'').replace('this.followCaret(this.prefix.length + event.text.length);',''):source;
 return desktop('esbuild').buildSync({stdin:{loader:'tsx',resolveDir:fileURLToPath(new URL('../src/browser/',import.meta.url)),contents:`
import * as React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
import{ImeTextarea,isImeFieldComposing}from'./nextmux-ime-field';
${adapter}
const root=createRoot(document.querySelector('main'));let adapter,callback,prompt='ABCD',ownerId=0,renderPending=false;
const input=()=>document.querySelector('textarea');
function render(){root.render(<><ImeTextarea key={ownerId} value={prompt} onChange={e=>{prompt=e.currentTarget.value;update();}}/><button id="finish" onClick={()=>adapter?.finish()}>Stop</button><input id="other"/></>);}
function update(){if(renderPending)return;renderPending=true;requestAnimationFrame(()=>{renderPending=false;flushSync(render);});}
window.fixture={
 async start(){adapter?.cancel();ownerId++;prompt='ABCD';flushSync(render);const area=input();area.focus();area.setSelectionRange(2,4);const captured=ownerId;
  adapter=new NativeDictationAdapter({async getSpeechCapability(){return{status:'ready',engine:'macos-speech',localOnly:true,defaultDeviceOnly:true};},async startSpeech(){return true;},async finishSpeech(){return true;},async cancelSpeech(){return true;},onSpeechEvent(listener){callback=listener;return()=>{};}},
   {input:area,read:()=>ownerId===captured?prompt:undefined,write:value=>{prompt=value;update();},isComposing:()=>isImeFieldComposing(area)},'zh-CN','owned-native-ui',()=>update());await adapter.start();this.emit({type:'listening'});},
 emit(event){callback?.({sessionId:'owned-native-ui',...event});},finish(){adapter?.finish();},end(){this.emit({type:'end',reason:'stopped'});},
 async frames(){for(let i=0;i<5;i++)await new Promise(requestAnimationFrame);return this.snapshot();},
 snapshot(){const area=input();return{prompt,value:area?.value,start:area?.selectionStart,end:area?.selectionEnd,active:document.activeElement?.id||document.activeElement?.tagName,adapterActive:adapter?.active};},
 switchOwner(){ownerId++;prompt='NEW OWNER';update();},dispose(){adapter?.cancel();flushSync(()=>root.render(null));}
};flushSync(render);
`},bundle:true,write:false,format:'iife',platform:'browser',alias:{react:core.resolve('react'),'react-dom/client':core.resolve('react-dom/client'),'react-dom':core.resolve('react-dom')},logLevel:'silent'}).outputFiles[0].text;
}

test('real React ImeTextarea retains speech across silence and stop and follows only its owned caret',{timeout:30000},async t=>{
 const {default:puppeteer}=await import(platform.resolve('puppeteer'));const browser=await puppeteer.launch({headless:true});t.after(()=>browser.close());const receipts=[];
 const page=await browser.newPage();const setup=async legacy=>{await page.setContent('<main></main>');await page.addScriptTag({content:bundle(legacy)});await page.evaluate(()=>fixture.start());};
 await t.test('legacy control reproduces empty-stop erasure and a caret that misses the insertion end',async()=>{
  await setup(true);await page.evaluate(()=>{fixture.emit({type:'transcript',text:'声音',final:false});});let s=await page.evaluate(()=>fixture.frames());assert.notEqual(s.start,4);assert.equal(s.prompt,'AB声音CD');const legacyCaret=s.start;
  await page.evaluate(()=>{fixture.finish();fixture.emit({type:'transcript',text:'',final:true});fixture.end();});s=await page.evaluate(()=>fixture.frames());assert.equal(s.prompt,'ABCD');receipts.push({case:'legacy-control',passed:true,erasureReproduced:true,missingInsertionEndCaretReproduced:true,legacyCaret});
 });
 await t.test('final interim corrections and a later utterance keep cumulative committed history through a silence gap',async()=>{
  await setup(false);await page.evaluate(()=>{fixture.emit({type:'transcript',text:'第一句未修正',final:false});fixture.emit({type:'transcript',text:'第一句',final:false});fixture.emit({type:'transcript',text:'第一句',final:true});});await page.evaluate(()=>fixture.frames());
  await new Promise(r=>setTimeout(r,400));await page.evaluate(()=>{fixture.emit({type:'level',value:0});fixture.emit({type:'transcript',text:'第一句第二',final:false});fixture.emit({type:'transcript',text:'第一句第二句',final:true});fixture.finish();fixture.emit({type:'transcript',text:'',final:true});fixture.end();});const s=await page.evaluate(()=>fixture.frames());assert.equal(s.prompt,'AB第一句第二句CD');assert.equal(s.value,s.prompt);assert.equal(s.start,8);assert.equal(s.end,8);receipts.push({case:'silence-later-cumulative-utterance-empty-stop',passed:true});
 });
 await t.test('same-turn final and end before the React commit still put the caret after accepted text',async()=>{
  await setup(false);await page.evaluate(()=>{fixture.emit({type:'transcript',text:'最终内容',final:true});fixture.end();});const s=await page.evaluate(()=>fixture.frames());assert.equal(s.value,'AB最终内容CD');assert.equal(s.start,6);assert.equal(s.end,6);receipts.push({case:'same-turn-final-end-before-react-commit',passed:true});
 });
 await t.test('manual mic stop keeps focus on its button while the textarea caret follows the final text',async()=>{
  await setup(false);await page.evaluate(()=>fixture.emit({type:'transcript',text:'初步',final:false}));await page.evaluate(()=>fixture.frames());await page.click('#finish');await page.evaluate(()=>{fixture.emit({type:'transcript',text:'完成文本',final:true});fixture.end();});const s=await page.evaluate(()=>fixture.frames());assert.equal(s.value,'AB完成文本CD');assert.equal(s.start,6);assert.equal(s.end,6);assert.equal(s.active,'finish');receipts.push({case:'manual-stop-no-focus-steal',passed:true});
 });
 await t.test('a post-end pointer selection and later user typing are not changed by old native work',async()=>{
  await setup(false);await page.evaluate(()=>{fixture.emit({type:'transcript',text:'旧语音',final:true});fixture.end();});await page.evaluate(()=>fixture.frames());await page.evaluate(()=>{const e=document.querySelector('textarea');e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));e.setSelectionRange(1,1);});await page.evaluate(()=>fixture.frames());let s=await page.evaluate(()=>fixture.snapshot());assert.equal(s.start,1);
  await page.focus('textarea');await page.keyboard.type('U');await page.evaluate(()=>fixture.frames());s=await page.evaluate(()=>fixture.snapshot());assert.ok(s.prompt.includes('U'));assert.equal(s.value,s.prompt);receipts.push({case:'post-end-user-pointer-and-typing',passed:true});
 });
 await t.test('a new owner before the scheduled render receives neither the old transcript nor its caret',async()=>{
  await setup(false);await page.evaluate(()=>{fixture.emit({type:'transcript',text:'旧语音',final:true});fixture.end();fixture.switchOwner();});const s=await page.evaluate(()=>fixture.frames());assert.equal(s.prompt,'NEW OWNER');assert.equal(s.value,'NEW OWNER');receipts.push({case:'new-owner-before-react-commit',passed:true});
 });
 await t.test('IME started after native end cancels its deferred caret work',async()=>{
  await setup(false);await page.evaluate(()=>{fixture.emit({type:'transcript',text:'旧语音',final:true});fixture.end();const e=document.querySelector('textarea');e.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));e.setSelectionRange(1,1);});await page.evaluate(()=>fixture.frames());const s=await page.evaluate(()=>fixture.snapshot());assert.equal(s.start,1);await page.evaluate(()=>document.querySelector('textarea').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));receipts.push({case:'post-end-ime-before-react-commit',passed:true});
 });
 await page.evaluate(()=>fixture.dispose());if(process.env.NMX_NATIVE_RETENTION_RECEIPT){const receipt=process.env.NMX_NATIVE_RETENTION_RECEIPT;writeFileSync(receipt,JSON.stringify({at:new Date().toISOString(),sourceFaithfulReactImeTextarea:true,syntheticNativeEvents:true,physicalMicrophone:0,models:0,receipts},null,2)+'\n',{flag:'wx',mode:0o600});}
});
