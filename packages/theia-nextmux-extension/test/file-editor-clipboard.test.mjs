import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const source=readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx',import.meta.url),'utf8');
const file=ts.createSourceFile('widget.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const klass=file.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='NextMuxFileEditor');
const method=klass.members.find(n=>ts.isMethodDeclaration(n)&&n.name.getText(file)==='runEditingCommand');
const Harness=Function('readDesktopClipboard','writeDesktopClipboard',ts.transpile(`class Harness { ${method.getText(file)} }; return Harness;`,{target:ts.ScriptTarget.ES2022}))(
 s=>s.readText(),(s,text)=>s.writeText(text));
function fixture(){
 let content='原始内容',version=1,currentModel, selection={equalsSelection(other){return this===other;}};
 const writes=[],edits=[];let undoStops=0;
 const model={getVersionId:()=>version,isDisposed:()=>false,getValueInRange:()=>content,pushStackElement(){undoStops++;}};
 currentModel=model;
 const editor={focus(){},getModel:()=>currentModel,getSelection:()=>selection,executeEdits(_,items){edits.push(...items);content=items[0].text;version++;}};
 const state=Object.assign(new Harness(),{props:{clipboardService:{readText:async()=> '中文： [GOAL_COMPLETE]\n新行',writeText:async text=>writes.push(text)}},commandEditor:()=>editor});
 return {state,writes,edits,get content(){return content;},get undoStops(){return undoStops;},changeVersion(){version++;},switchModel(){currentModel={};},changeSelection(){selection={equalsSelection(other){return this===other;}};}};
}
test('file clipboard preserves Unicode and punctuation and creates one undo group',async()=>{
 const f=fixture();await f.state.runEditingCommand('paste');assert.equal(f.content,'中文： [GOAL_COMPLETE]\n新行');assert.equal(f.undoStops,2);
 await f.state.runEditingCommand('copy');assert.deepEqual(f.writes,['中文： [GOAL_COMPLETE]\n新行']);
 await f.state.runEditingCommand('cut');assert.equal(f.content,'');assert.equal(f.writes.length,2);
});
test('clipboard read failure never erases a selection',async()=>{
 const f=fixture();f.state.props.clipboardService.readText=async()=>{throw Error('unavailable');};
 await assert.rejects(f.state.runEditingCommand('paste'),/unavailable/);assert.equal(f.edits.length,0);assert.equal(f.content,'原始内容');
});
test('late clipboard data cannot overwrite newer content or a different tab or selection',async()=>{
 for(const mutation of ['changeVersion','switchModel','changeSelection']){
  const f=fixture();let resolve;f.state.props.clipboardService.readText=()=>new Promise(r=>resolve=r);
  const pending=f.state.runEditingCommand('paste');f[mutation]();resolve('late');await pending;assert.equal(f.edits.length,0,mutation);
 }
});
test('read-only file refuses paste and cut but permits copy',async()=>{
 const f=fixture();f.state.props.readOnly=true;await f.state.runEditingCommand('paste');await f.state.runEditingCommand('cut');await f.state.runEditingCommand('copy');
 assert.equal(f.edits.length,0);assert.deepEqual(f.writes,['原始内容']);
});
