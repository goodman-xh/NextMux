import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),desktop=createRequire(new URL('../../../apps/desktop/package.json',import.meta.url));
const {GPU_EFFECT_REGISTRY}=require('@nextmux/comic-core/visual-effects');
const {outputFiles}=await desktop('esbuild').build({entryPoints:[new URL('../src/browser/nextmux-comic-visual-labels.ts',import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'cjs'});
const module={exports:{}};new Function('require','module','exports',outputFiles[0].text)(require,module,module.exports);
const {comicEffectParamLabel,comicEffectOptionLabel,comicEffectAlphaLabel}=module.exports;
const locales=['zh-CN','en','zh-TW','ja','ko','es','fr','de','pt-BR','ru','ar','hi'];
test('every exposed fixed FreeCut parameter and option has all 12 display locales without changing protocol values',()=>{
 for(const locale of locales)for(const effect of GPU_EFFECT_REGISTRY.values())for(const[key,param]of Object.entries(effect.params)){
  if(effect.id==='gpu-lut'&&param.type==='json')continue;
  const label=comicEffectParamLabel(locale,key,'MISSING');assert.ok(label&&label!=='MISSING',`${locale}:${effect.id}:${key}`);
  for(const option of param.options??[])assert.ok(comicEffectOptionLabel(locale,option.value,'MISSING')!=='MISSING',`${locale}:${option.value}`);
 }
 for(const locale of locales)assert.ok(comicEffectAlphaLabel(locale));
 assert.equal(comicEffectParamLabel('zh-CN','shutterAngle','MISSING'),'快门角度');
 assert.equal(comicEffectParamLabel('zh-TW','shutterAngle','MISSING'),'快門角度');
 assert.equal(comicEffectParamLabel('ru','strength','MISSING'),'Сила');
 assert.equal(comicEffectOptionLabel('ar','blue','MISSING'),'شاشة زرقاء');
 assert.equal(comicEffectOptionLabel('hi','horizontal','MISSING'),'क्षैतिज');
 assert.equal(comicEffectOptionLabel('ja','courier','MISSING'),'Courier');
});
