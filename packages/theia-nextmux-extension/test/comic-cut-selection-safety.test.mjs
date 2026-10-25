import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Test the edited TSX, not a stale generated desktop bundle. Dependencies are
// ordinary built production helpers; no browser, disk edits or media requests.
const require=createRequire(new URL('../package.json',import.meta.url));
const source=readFileSync(new URL('../src/browser/nextmux-comic-cut.tsx',import.meta.url),'utf8');
const module={exports:{}};
new Function('require','exports','module',ts.transpileModule(source,{compilerOptions:{
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,
}}).outputText)(id=>id.startsWith('./')
  ? require(fileURLToPath(new URL('../lib/browser/'+id.slice(2)+'.js',import.meta.url))) : require(id),module.exports,module);
const {comicCutLanes,comicCutTrimDelta}=module.exports;

test('audio-run indexing keeps interleaved music continuity, restart boundaries and source data intact',()=>{
  const audio=(assetId,start,role='music',length=20)=>({assetId,role,start,length,title:assetId});
  const clips=[{shotId:'a',start:0,duration:3,audio:[audio('m',0),audio('other',0),audio('v',0,'audio')]},
    {shotId:'b',start:2.5,duration:3,audio:[audio('m',2.5),audio('other',0),audio('v',0,'audio'),audio('zero',0,'effect',0)]},
    {shotId:'c',start:5.5,duration:2,audio:[audio('m',5.5),audio('other',3)]}];
  const before=structuredClone(clips);
  const lanes=comicCutLanes(clips);
  assert.deepEqual(lanes.music.map(({assetId,start,duration,shotIds})=>({assetId,start,duration,shotIds})),[
    {assetId:'m',start:0,duration:7.5,shotIds:['a','b','c']},
    {assetId:'other',start:0,duration:3,shotIds:['a']},
    {assetId:'other',start:2.5,duration:5,shotIds:['b','c']},
  ]);
  assert.equal(lanes.audio.length,2,'voice occurrences remain independent even for one file');
  assert.deepEqual(lanes.effect,[]);assert.deepEqual(clips,before,'projection must not mutate source clips/audio');
  assert.deepEqual(comicCutLanes(clips),lanes,'repeated projections create the same runs without accumulating shot IDs');
});

test('left trim preview cannot restore time before any attached audio starts',()=>{
  const audio=[{assetId:'m',role:'music',start:0,length:10}];
  assert.equal(comicCutTrimDelta({kind:'video',videoStart:2,duration:3,audio},'start',-1,24),0);
  assert.equal(comicCutTrimDelta({kind:'image',duration:3,audio},'start',-1,24),0);
  assert.equal(comicCutTrimDelta({kind:'video',videoStart:2,duration:3,audio:[{...audio[0],start:.5}]},'start',-1,24),-.5);
  assert.equal(comicCutTrimDelta({kind:'image',duration:3,audio:[]},'start',-1,24),-1);
});
