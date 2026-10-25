import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
const source=readFileSync(new URL('../src/browser/nextmux-native-dictation-adapter.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}};vm.runInNewContext(compiled,{module,exports:module.exports,setInterval,clearInterval,setTimeout,clearTimeout,performance});
const {NativeDictationAdapter}=module.exports;
function fixture(){
 let text='ABCD',listener,frameId=0;const frames=new Map(),renders=[],calls=[];
 const input=Object.assign(new EventTarget(),{isConnected:true,value:text,selectionStart:2,selectionEnd:4,disabled:false,readOnly:false,setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;calls.push(['caret',start,end]);}});
 const document=Object.assign(new EventTarget(),{activeElement:input}),view={requestAnimationFrame(fn){const id=++frameId;frames.set(id,fn);return id;},cancelAnimationFrame(id){frames.delete(id);}};
 input.ownerDocument=document;document.defaultView=view;const doc=input.ownerDocument;
 const owner={input,read:()=>text,write(value){text=value;calls.push(['write',value]);renders.push(()=>{input.value=value;});},isComposing:()=>false};
 const bridge={async getSpeechCapability(){return{status:'ready',engine:'macos-speech',localOnly:true,defaultDeviceOnly:true};},async startSpeech(){return true;},async finishSpeech(){calls.push(['finish']);return true;},async cancelSpeech(){calls.push(['cancel']);return true;},onSpeechEvent(fn){listener=fn;return()=>{};}};
 const adapter=new NativeDictationAdapter(bridge,owner,'zh-CN','fixture',()=>{});
 const frame=()=>{const pending=[...frames.values()];frames.clear();for(const fn of pending)fn();const render=renders.splice(0);for(const fn of render)fn();};
 return{adapter,input,owner,doc,calls,emit:event=>listener?.({sessionId:'fixture',...event}),text:()=>text,frames(){for(let i=0;i<4;i++)frame();},edit(value){text=value;input.value=value;input.dispatchEvent(new Event('input'));}};
}
test('finishing after a silence gap preserves the last heard insertion when native completion is empty',async()=>{
 const f=fixture();await f.adapter.start();try{
  f.emit({type:'listening'});f.emit({type:'transcript',text:'先说的话',final:false});f.frames();
  f.emit({type:'level',value:0});f.adapter.finish();f.emit({type:'transcript',text:'',final:true});f.emit({type:'end',reason:'stopped'});f.frames();
  assert.equal(f.text(),'AB先说的话CD');assert.equal(f.calls.filter(c=>c[0]==='finish').length,1);
 }finally{f.adapter.cancel();}
});
test('the caret follows accepted dictation after the owned textarea renders, including the final result before stop',async()=>{
 const f=fixture();await f.adapter.start();try{
  f.emit({type:'transcript',text:'一句',final:false});assert.equal(f.input.value,'ABCD');f.frames();
  assert.equal(f.input.value,'AB一句CD');assert.equal(f.input.selectionStart,4);assert.equal(f.input.selectionEnd,4);
  f.emit({type:'transcript',text:'一句话',final:true});f.emit({type:'end',reason:'completed'});f.frames();
  assert.equal(f.input.selectionStart,5);assert.equal(f.input.selectionEnd,5);assert.equal(f.text(),'AB一句话CD');
 }finally{f.adapter.cancel();}
});
test('a shorter correction of the same cumulative snapshot remains a correction rather than guessed new speech',async()=>{
 const f=fixture();await f.adapter.start();try{
  f.emit({type:'transcript',text:'需要纠正的长句',final:false});f.emit({type:'transcript',text:'短句',final:true});f.frames();
  assert.equal(f.text(),'AB短句CD');
 }finally{f.adapter.cancel();}
});
test('caret work never takes focus or overwrites a later user edit',async()=>{
 const f=fixture();await f.adapter.start();try{
  f.emit({type:'transcript',text:'声音',final:false});const other={};f.doc.activeElement=other;f.frames();assert.equal(f.doc.activeElement,other);assert.equal(f.input.selectionStart,4);
  f.doc.activeElement=f.input;f.emit({type:'transcript',text:'声音内容',final:true});f.edit('user edit');f.input.setSelectionRange(1,1);f.frames();
  assert.equal(f.text(),'user edit');assert.equal(f.input.selectionStart,1);
 }finally{f.adapter.cancel();}
});

test('committed cumulative history survives silence, later utterances and repeated empty completion',async()=>{
 const f=fixture();await f.adapter.start();try{
  f.emit({type:'transcript',text:'第一句未修正',final:false});f.emit({type:'transcript',text:'第一句',final:false});f.emit({type:'transcript',text:'第一句',final:true});f.frames();
  f.emit({type:'level',value:0});f.emit({type:'transcript',text:'第一句第二',final:false});f.emit({type:'transcript',text:'第一句第二句',final:true});f.adapter.finish();
  f.emit({type:'transcript',text:'',final:true});f.emit({type:'transcript',text:' ',final:true});f.emit({type:'end',reason:'stopped'});f.frames();
  assert.equal(f.text(),'AB第一句第二句CD');assert.equal(f.input.selectionStart,8);assert.equal(f.input.selectionEnd,8);
 }finally{f.adapter.cancel();}
});
test('pointer selection after native end cancels the pending caret before the DOM commit',async()=>{
 const f=fixture();await f.adapter.start();try{
  f.emit({type:'transcript',text:'last',final:true});f.emit({type:'end',reason:'completed'});
  f.doc.dispatchEvent(new Event('pointerdown'));f.input.setSelectionRange(1,1);f.frames();assert.equal(f.input.selectionStart,1);
 }finally{f.adapter.cancel();}
});
