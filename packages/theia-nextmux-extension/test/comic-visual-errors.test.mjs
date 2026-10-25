import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../../apps/desktop/package.json',import.meta.url));
const {outputFiles}=await require('esbuild').build({entryPoints:[new URL('../src/browser/nextmux-comic-visual-errors.ts',import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'cjs'});
const module={exports:{}};new Function('require','module','exports',outputFiles[0].text)(require,module,module.exports);
const {comicVisualErrorText,comicVisualExportErrorText}=module.exports;
test('all 12 locales distinguish export failure from preview and keep diagnostic codes internal',()=>{
 for(const locale of ['zh-CN','en','zh-TW','ja','ko','es','fr','de','pt-BR','ru','ar','hi']){
  const preview=comicVisualErrorText(locale,Error('WebGPU is unavailable on this device'));
  const exported=comicVisualExportErrorText(locale,{code:'COMIC_EXPORT_VISUAL_PROCESSING_FAILED',message:'WebGPU is unavailable on this device'});
  assert.ok(exported);assert.notEqual(exported,preview);assert.doesNotMatch(exported,/COMIC_EXPORT_|WebGPU/);
  assert.ok(comicVisualExportErrorText(locale,'COMIC_EXPORT_VISUAL_PROCESSING_FAILED: decoder failed'));
 }
});
test('unrelated or cancelled export errors retain their existing handling',()=>{
 for(const error of [undefined,null,Error('CANCELLED'),{code:'COMIC_EXPORT_AUDIO_MISSING'},'MODEL_REQUEST_FAILED'])assert.equal(comicVisualExportErrorText('en',error),undefined);
});
