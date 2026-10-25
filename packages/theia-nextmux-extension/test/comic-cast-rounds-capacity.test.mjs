import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('typescript');
const source=readFileSync(new URL('../src/common/nextmux-comic-flow.ts',import.meta.url),'utf8');
const exports={};new Function('exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exports);
const {comicCastRounds}=exports;
const portraits=['a','b','c','d','e'];
test('dynamic image capacity preserves every portrait and reserves the composition slot',()=>{
 for(const slots of [2,3,4,5,8])for(const plate of [true,false]){
  const rounds=comicCastRounds(portraits,plate,slots);
  assert.deepEqual(rounds.flat(),portraits);
  rounds.forEach((round,i)=>assert.ok(round.length+(i>0||plate?1:0)<=slots));
  assert.equal(rounds[0].length,Math.min(5,slots-(plate?1:0)));
 }
 assert.deepEqual(comicCastRounds(portraits,false,3),[['a','b','c'],['d','e']]);
 assert.deepEqual(comicCastRounds(portraits,true),[['a','b'],['c','d'],['e']]);
 for(const slots of [0,1,-1,NaN,Infinity])assert.deepEqual(comicCastRounds(portraits,true,slots),[]);
});
const widget=readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx',import.meta.url),'utf8');
const start=widget.indexOf('const cap = Math.max(0, Math.floor(facts?.maxReferences ?? 3))');
const block=widget.slice(start,widget.indexOf('const lastPicture',start));
const code=ts.transpileModule(`function decide(portraits,plate,imageRoute,facts,usesReferences,desk){${block};return {rounds,framesInstead,cast};}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const decide=new Function('comicCastRounds','comicRouteImageInput',code+';return decide;')(comicCastRounds,route=>route.supported!==false);
test('five people with three video slots cannot silently generate with no image route',()=>{
 for(const route of [undefined,{offering:{mediaInput:{maxReferences:1}}},{supported:false}])for(const locale of ['zh-CN','en','ja']){
  const desk={};assert.throws(()=>decide.call({desktopLocale:locale},portraits,null,route,{maxReferences:3},true,desk),/AI|モデル/);
  assert.equal(desk.stopped,true);
 }
});
test('widget uses managed and custom image capacities and sends a complete cast',()=>{
 for(const route of [{offering:{mediaInput:{maxReferences:4}}},{connection:{providerSettings:{mediaTemplate:{maxReferences:4}}}}]){
  const result=decide.call({desktopLocale:'en'},portraits,{uri:'plate'},route,{maxReferences:3},true,{});
  assert.deepEqual(result.rounds,[['a','b','c'],['d','e']]);assert.equal(result.framesInstead,true);
  assert.deepEqual(result.cast,[...portraits,'plate']);
 }
 const result=decide.call({desktopLocale:'en'},portraits,null,undefined,{maxReferences:6},true,{});
 assert.equal(result.framesInstead,false);assert.deepEqual(result.cast,portraits);
});
