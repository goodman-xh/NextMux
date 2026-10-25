import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { videoModelGuide, videoModelUsesReferences } from '../lib/common/nextmux-video-model-guide.js';
import { assembleComicVideoPrompt, comicPromptUsesChinese, ComicPromptTranslationCache } from '../lib/common/nextmux-comic-prompts.js';
import { musicMvRequestSeconds } from '../lib/browser/nextmux-music-mv-state.js';
import { comicRouteImageInput } from '../lib/browser/nextmux-comic-model-eligibility.js';
const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let method;
(function visit(n) {if(ts.isMethodDeclaration(n)&&n.name.getText(ast)==='musicMvVisualInput')method=n.getText(ast);ts.forEachChild(n,visit);})(ast);
assert.ok(method);
const code = ts.transpileModule(`const {videoModelGuide,videoModelUsesReferences,assembleComicVideoPrompt,comicPromptUsesChinese,musicMvRequestSeconds,comicRouteImageInput}=deps;const comicTextLanguage=(_t,f)=>f;class Harness{${method}}`, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const Harness = new Function('deps',`${code};return Harness`)({videoModelGuide,videoModelUsesReferences,assembleComicVideoPrompt,comicPromptUsesChinese,musicMvRequestSeconds,comicRouteImageInput});
function fixture(model='veo-3.1') {
 const h=new Harness(), calls=[];
 Object.assign(h,{comicPromptTranslations:new ComicPromptTranslationCache(),ct:k=>k,comicLanguageName:()=> 'English',comicPlanText:async request=>{calls.push(request);return JSON.stringify({visual:'A red kite rises above the river. A slow upward crane follows it.'});}});
 const project={id:'p',canvas:{width:1280,height:720},assets:[]};
 const mv={singerPortraitAssetId:undefined};
 const segment={id:'s',startMs:0,endMs:8000,prompt:'红风筝升起，镜头缓缓上升。',performance:false};
 return {h,calls,project,mv,segment,route:{kind:'managed',model,offering:{input:['text','image'],mediaInput:{firstFrame:true,referenceImages:false}}}};
}
test('an edited MV visual is translated once for English models and retains its source for stale-job checks',async()=>{
 const f=fixture();const input=await f.h.musicMvVisualInput(f.project,f.mv,f.segment,f.route);
 assert.match(input.prompt,/A red kite rises/);assert.match(input.prompt,/Silent video/);assert.match(input.prompt,/No text or lyrics on screen/);assert.match(input.prompt,/^\[00:00-00:08\]/);
 assert.equal(input.musicMvSourcePrompt,f.segment.prompt);await f.h.musicMvVisualInput(f.project,f.mv,f.segment,f.route);assert.equal(f.calls.length,1);
});
test('a bilingual MV model keeps authored visual language and never calls translation',async()=>{
 const f=fixture('kling-v3.0-pro');const input=await f.h.musicMvVisualInput(f.project,f.mv,f.segment,f.route);assert.match(input.prompt,/红风筝/);assert.match(input.prompt,/静音视频/);assert.equal(f.calls.length,0);
});
test('a singer portrait takes the first-frame motion path when video references are unavailable',async()=>{
 const f=fixture('runway-gen-4.5');f.project.assets.push({id:'portrait',kind:'image',status:'ready',uri:'singer.png'});f.mv.singerPortraitAssetId='portrait';f.segment.performance=true;
 f.h.comicPlanText=async request=>request.includes('Extract')?JSON.stringify({motion:'The singer raises one hand; the camera follows upward.'}):JSON.stringify({visual:'The singer in a red coat raises one hand; the camera follows upward.'});
 // The extraction call is independently cached and receives only a visual source, never lyrics.
 f.h.comicPromptTranslations.translateMotion=async()=> 'The singer raises one hand; the camera follows upward.';
 const input=await f.h.musicMvVisualInput(f.project,f.mv,f.segment,f.route);assert.deepEqual(input.referenceAssetUris,['singer.png']);assert.equal(input.characterReferenceUris,undefined);assert.doesNotMatch(input.prompt,/red coat/);assert.match(input.prompt,/No text or lyrics on screen/);
});
