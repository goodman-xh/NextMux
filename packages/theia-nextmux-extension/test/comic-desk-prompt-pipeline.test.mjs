import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { videoModelGuide, videoModelUsesReferences } from '../lib/common/nextmux-video-model-guide.js';
import * as prompts from '../lib/common/nextmux-comic-prompts.js';
import { comicAddCastCaption, comicCastRounds, comicCastRoundsDone, comicReferenceCaption, comicReferenceLayout, comicSoundLine } from '../lib/common/nextmux-comic-flow.js';
import { comicRouteImageInput } from '../lib/browser/nextmux-comic-model-eligibility.js';

import { deskInputDigest } from '../lib/common/nextmux-stable-id.js';
const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['deskPump', 'deskEnqueue', 'deskClipPrompt', 'comicShotOnScreen']);
const methods = [];
(function visit(n) { if (ts.isMethodDeclaration(n) && names.has(n.name.getText(ast))) methods.push(n.getText(ast)); ts.forEachChild(n, visit); })(ast);
assert.equal(methods.length, names.size);
const code = ts.transpileModule(`const {deskInputDigest,videoModelGuide,videoModelUsesReferences,assembleComicVideoPrompt,comicPromptUsesChinese,comicReferenceCaption,comicReferenceLayout,comicSceneReferenceCaption,comicSetPlatePrompt,comicSoundLine,comicAddCastCaption,comicCastRounds,comicCastRoundsDone,comicRouteImageInput}=deps;
const modelFailureText=(_l,e)=>e?.message||String(e);const clipOwnPrompt=x=>x;const deskText=(_l,k)=>k;const optionalKeyPriceQuoteId=x=>x;
class Harness {${methods.join('\n')}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const Harness = new Function('deps', `${code};return Harness` )({ deskInputDigest, ...prompts, videoModelGuide, videoModelUsesReferences, comicReferenceCaption, comicReferenceLayout, comicSoundLine, comicAddCastCaption, comicCastRounds, comicCastRoundsDone, comicRouteImageInput });
function fixture() {
 const h = new Harness();
 const first={id:'shot-1',visualPrompt:'Walk to the door',negativePrompt:'',cameraMotion:'follow',shotSize:'medium',durationFrames:120,dialogueCues:[],continuousTakeId:'take-a',visualAssetId:'asset-frame'};
 const next={...first,id:'shot-2',visualPrompt:'Open the door',visualAssetId:undefined};
 const scene={id:'scene-1',episodeNumber:1,setPlateAssetId:'asset-set',shots:[first,next]};
 h.project={id:'project-1',revision:1,frameRate:24,scenes:[scene],episodes:[{number:1}],characters:[],continuousShotsShareFrames:true,styleBible:'ink',canvas:{width:1280,height:720,aspectRatio:'16:9'},assets:[{id:'asset-set',uri:'set.png',kind:'image',status:'ready'},{id:'asset-frame',uri:'frame.png',kind:'image',status:'ready'}]};
 h.route={id:'official-v',kind:'official',model:'veo-3.1'};
 h.facts={...videoModelGuide('veo-3.1'),maxReferences:0,firstFrame:true};
 h.comicDesk={workspaceRoot:'/a',shooting:true,pumping:false,paused:false,redo:new Set(),redoFrame:new Set(),looks:{},seenClips:new Set(),splitQueue:[]};
 Object.assign(h,{activeComicWorkspaceRoot:'/a',desktopLocale:'en',mediaState:{jobs:[]},comicStepPrefs:{choices:{}},calls:[],comicProject(){return this.project;},async loadMediaState(){},comicStepMediaRoute(k){return k==='video'?this.route:{id:'official-i',kind:'official',model:'image',offering:{input:['text','image'],mediaInput:{referenceImages:true,maxReferences:3}}};},async deskVideoFacts(){return this.facts;},comicShotCharacterReferences(){return [];},async comicShotPromptFields(s){return {own:s.visualPrompt,negative:'',identity:'',style:'ink',continuity:'room'};},async comicFirstFrameMotion(s){return s.visualPrompt;},comicVideoMakesSound(){return false;},deskPortrait(){},deskLook(){return '';},persistComicDesk(){},update(){},deskUnsplitEpisodes(){return [];},async refreshComicPlayback(){},finishComicDesk(){this.finished=true;},async deskCommand(){return this.project;},async runDeskSplit(){}});
 h.platformService={async enqueueMediaJob({workspaceRoot,job}) {h.calls.push({workspaceRoot,...job});return{id:'job-1'};},async confirmMediaJob(root){h.calls.push({confirmed:root});}};
 return {h,scene,first,next};
}
test('continuous take waits for predecessor video and queues only the first missing clip',async()=>{
 const {h}=fixture(); await h.deskPump();
 const videos=h.calls.filter(c=>c.kind==='video');assert.equal(videos.length,1);assert.equal(videos[0].shotId,'shot-1');assert.deepEqual(videos[0].input.referenceAssetUris,['frame.png']);
 assert.equal(h.comicDesk.error,undefined);
});
test('imported read-only failure does not block a fresh filming job',async()=>{
 const {h,first}=fixture();
 h.mediaState.jobs=[{id:'media-job-imported',projectId:h.project.id,shotId:first.id,kind:'video',status:'failed',
  restoredHistoryOnly:true,updatedAt:'2099-01-01T00:00:00.000Z',input:{}}];
 await h.deskPump();
 const videos=h.calls.filter(c=>c.kind==='video');
 assert.equal(videos.length,1);
 assert.equal(videos[0].shotId,first.id);
});
test('next continuous shot uses the decoded previous last frame even for reference-capable models',async()=>{
 const {h,first,next}=fixture();first.videoAssetId='asset-video';h.project.assets.push({id:'asset-video',uri:'previous.mp4',kind:'video',status:'ready'});h.facts={...h.facts,maxReferences:3};
 let extracted=0;h.comicUsePreviousLastFrame=async(_s,p,n)=>{assert.equal(p.id,first.id);assert.equal(n.id,next.id);extracted++;next.visualAssetId='asset-last';h.project.assets.push({id:'asset-last',uri:'last.png',kind:'image',status:'ready'});};
 await h.deskPump(); const video=h.calls.find(c=>c.kind==='video');assert.equal(extracted,1);assert.deepEqual(video.input.referenceAssetUris,['last.png']);assert.equal(video.input.characterReferenceUris,undefined);assert.match(video.input.prompt,/Keep the subjects, composition and art style of the first frame/);
});
test('scene plate generation is once per scene and precedes both clip requests',async()=>{
 const {h,scene}=fixture();scene.setPlateAssetId=undefined;h.comicPromptTranslations=new prompts.ComicPromptTranslationCache();h.comicPlanText=async p=>JSON.stringify({plate:'An empty ink room. No people, text or watermark.'});
 await h.deskPump();const images=h.calls.filter(c=>c.kind==='image');assert.equal(images.length,1);assert.equal(images[0].input.comicSetPlate,true);assert.equal(h.calls.filter(c=>c.kind==='video').length,0);
});
test('a changed workspace or edited shot cannot receive an old translated desk request',async()=>{
 const {h,scene,first}=fixture();h.activeComicWorkspaceRoot='/b';await h.deskEnqueue('video',scene,first,h.route,{prompt:'old'});assert.equal(h.calls.length,0);
 h.activeComicWorkspaceRoot='/a';await h.deskEnqueue('video',scene,{...first,visualPrompt:'old description'},h.route,{prompt:'old'});assert.equal(h.calls.length,0);
});
test('without an image model, or with a text-only video model, clips go from text to video without a set plate',async()=>{
 for (const variant of ['no-image-model','text-only-video']) {
  const {h,scene,first,next}=fixture();scene.setPlateAssetId=undefined;h.project.continuousShotsShareFrames=false;first.visualAssetId=undefined;next.continuousTakeId=undefined;
  if (variant==='no-image-model') h.comicStepMediaRoute=function(k){return k==='video'?this.route:undefined;};
  else h.facts={...h.facts,maxReferences:0,firstFrame:false};
  await h.deskPump();
  assert.equal(h.calls.filter(c=>c.kind==='image').length,0,`${variant}: no set plate`);
  assert.equal(h.calls.filter(c=>c.kind==='video').length,2,`${variant}: both clips filmed`);
  assert.equal(h.comicDesk.error,undefined,`${variant}: no blocking error`);
 }
});
test('five people in a shot: the opening frame is drawn two at a time, then the clip starts from it',async()=>{
 const {h,scene,first}=fixture();scene.shots=[first];first.visualAssetId=undefined;first.continuousTakeId=undefined;h.project.continuousShotsShareFrames=false;
 const names=['A','B','C','D','E'];h.project.characters=names.map(name=>({name}));
 h.comicShotCharacterReferences=()=>names.map(name=>`${name}.png`);h.deskPortrait=(_p,character)=>({uri:`${character.name}.png`});
 const done=(call,at)=>{h.mediaState.jobs=[{id:`job-${at}`,kind:'image',projectId:'project-1',sceneId:scene.id,shotId:first.id,status:'succeeded',input:call.input,createdAt:at,updatedAt:at}];first.visualAssetId='asset-frame';h.calls=[];};
 await h.deskPump();
 let images=h.calls.filter(c=>c.kind==='image');
 assert.deepEqual(images.map(c=>c.input.characterReferenceUris),[['A.png','B.png','set.png']],'round 1: two people and the scene');
 assert.match(images[0].input.prompt,/reference image 1 \(\[Image 1\]\) is A; reference image 2 \(\[Image 2\]\) is B/);
 assert.equal(h.calls.filter(c=>c.kind==='video').length,0);
 done(images[0],'2026-01-01T00:00:01Z');await h.deskPump();
 images=h.calls.filter(c=>c.kind==='image');
 assert.deepEqual(images.map(c=>c.input.characterReferenceUris),[['frame.png','C.png','D.png']],'round 2: the frame so far and the next two');
 assert.match(images[0].input.prompt,/opening frame so far.*reference image 2 \(\[Image 2\]\) is C; reference image 3 \(\[Image 3\]\) is D/s);
 done(images[0],'2026-01-01T00:00:02Z');await h.deskPump();
 images=h.calls.filter(c=>c.kind==='image');
 assert.deepEqual(images.map(c=>c.input.characterReferenceUris),[['frame.png','E.png']]);
 done(images[0],'2026-01-01T00:00:03Z');await h.deskPump();
 assert.equal(h.calls.filter(c=>c.kind==='image').length,0);
 const clips=h.calls.filter(c=>c.kind==='video');
 assert.equal(clips.length,1,'everyone is in the frame: the clip is filmed');
 assert.deepEqual(clips[0].input.referenceAssetUris,['frame.png']);
});
