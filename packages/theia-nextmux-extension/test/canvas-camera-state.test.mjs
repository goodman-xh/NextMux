import assert from 'node:assert/strict';import test from 'node:test';import {createRequire} from 'node:module';import {sourceModule} from './helpers/comic-organizer-source-loader.mjs';
const require=createRequire(import.meta.url),{CAMERA_MOVES,CAMERA_PRESETS,CAMERA_SPEEDS,compileCameraPrompt,applyCameraPreset}=require('@nextmux/comic-core/canvas-camera');
const {deriveCanvasCameraPrompt:derive,composeCanvasCameraPrompt:compose}=sourceModule('browser/nextmux-comic-canvas-camera-state.ts');
const {CAMERA_CONTROL_LOCALES,cameraControlText,cameraMoveLabel,cameraPresetLabel,cameraSpeedLabel,cameraSelectionLabel}=sourceModule('browser/nextmux-comic-canvas-camera-text.ts');
test('legacy saved/unsaved camera prefixes project read-only into tags and a lossless authored body',()=>{
 const selection={movements:['pedestal_up','arc_left'],speed:'slow'};
 for(const body of ['中文正文\n第二行','  保留空格  ','[unknown annotation] 后续正文','','\n\n','[Zoom] authored token']){
  const original=compose(body,selection),snapshot=JSON.stringify(original);
  for(const saved of [undefined,original.state]){const projected=derive(original.prompt,saved);assert.equal(projected.body,body);assert.deepEqual(projected.state.selection,selection);assert.equal(compose(projected.body,projected.state.selection).prompt,original.prompt);}
  assert.equal(JSON.stringify(original),snapshot,'opening never rewrites persisted content');
 }
 const oldPrompt=compileCameraPrompt(selection,[],'中文故事').prompt;assert.equal(derive(oldPrompt).body,'中文故事');assert.equal(compose('改后的故事',derive(oldPrompt).state.selection).prompt,compileCameraPrompt(selection,[],'改后的故事').prompt);
});
test('unknown, incidental prose and mismatched preset tokens are never stripped',()=>{
 const phrase='[Raise the camera vertically]';
 for(const prompt of ['[unknown] '+phrase+' 中文','[简单拉近] 中文','[at a slow pace] 中文',phrase+'literal',phrase+'[unknown]正文','[简单拉近] '+phrase+' 正文'])assert.deepEqual(derive(prompt),{body:prompt});
 assert.equal(derive(phrase+' [unknown] [Move along an arc on the subject\'s left side] 正文').body,'[unknown] [Move along an arc on the subject\'s left side] 正文');
 assert.equal(derive(phrase+'\n中文').body,'\n中文');assert.equal(derive(phrase+'  中文').body,' 中文');
 assert.deepEqual(derive(phrase+' 中文',{selection:{movements:['zoom_in'],speed:'normal'},prefix:phrase+' '}).state.selection,{movements:['pedestal_up'],speed:'normal'});
 assert.deepEqual(derive('ordinary body',{selection:{movements:['unknown'],speed:'slow'},prefix:''}),{body:'ordinary body'});
});
test('saved prefix separator variations preserve the authored body',()=>{
 const selection={movements:['zoom_in'],speed:'normal'},token='[Zoom toward the subject]';
 assert.equal(derive(token+' text',{selection,prefix:token+' '}).body,'text');assert.equal(derive(token+'text',{selection,prefix:token}).body,token+'text');
 assert.equal(derive(token+'\ntext',{selection,prefix:token+' '}).body,'\ntext');assert.equal(derive(token+'  text',{selection,prefix:token+' '}).body,' text');assert.equal(derive(token,{selection,prefix:token+' '}).body,'');
});
test('empty-body camera state cannot add a separator on every keystroke or consume authored whitespace',()=>{
 const selection={movements:['pedestal_up','arc_left'],speed:'slow'},empty=compose('',selection),stale=empty.state;
 assert.equal(stale.prefix.endsWith(' '),false);
 let prompt=empty.prompt,body='';
 for(const character of ['中','文',' ','字','\n','第','二','行']){
  body+=character;const current=derive(prompt,stale);prompt=compose(current.body+character,current.state.selection).prompt;
  assert.equal(derive(prompt,stale).body,body,'stale empty-state prefix never leaks a separator into the next edit');
  assert.equal(prompt,compose(body,selection).prompt);
 }
 for(const authored of [' ','  中文','\n中文',' 中文  ', '']){
  const edited=compose(authored,selection),projected=derive(edited.prompt,stale);
  assert.equal(projected.body,authored);assert.equal(compose(projected.body,projected.state.selection).prompt,edited.prompt);
 }
 const authored='  中文',edited=compose(authored,selection),tooLong={...stale,prefix:stale.prefix+'  '};
 assert.equal(derive(edited.prompt,tooLong).body,authored,'a stale long prefix cannot consume any authored leading spaces');
 assert.equal(derive(empty.prompt,{...stale,prefix:stale.prefix+' '}).body,'','deleting the complete body also tolerates the previous nonempty prefix');
});
test('all presets survive legacy inference, and clearing tags removes only the compiled prefix',()=>{
 for(const preset of CAMERA_PRESETS){const selection=applyCameraPreset(preset.id),original=compose('正文 [unknown]',selection),projected=derive(original.prompt);assert.deepEqual(projected.state.selection,selection);assert.equal(compose(projected.body,{movements:[],speed:'normal'}).prompt,'正文 [unknown]');}
});
test('speed-only selection persists without inventing executable movement',()=>{
 const selection={movements:[],speed:'slow'},edited=compose('正文',selection);assert.equal(edited.prompt,'正文');assert.deepEqual(edited.state,{selection,prefix:''});assert.deepEqual(derive(edited.prompt,edited.state),{body:'正文',state:edited.state});
 assert.equal(compose('正文',{movements:['zoom_in'],speed:derive(edited.prompt,edited.state).state.selection.speed}).prompt,'[Zoom toward the subject] [at a slow pace] 正文');assert.deepEqual(compose('正文',{movements:[],speed:'normal'}),{prompt:'正文',state:{selection:{movements:[],speed:'normal'},prefix:''}});assert.deepEqual(compose('正文'),{prompt:'正文'},'undefined selection retains the legacy no-state contract');
});
test('all 12 locales contain complete human-readable camera labels',()=>{
 assert.equal(CAMERA_CONTROL_LOCALES.length,12);
 for(const locale of CAMERA_CONTROL_LOCALES){
  for(const item of CAMERA_MOVES){const label=cameraMoveLabel(locale,item.id);assert.ok(label?.trim(),locale+item.id);assert.notEqual(label,item.id);assert.notEqual(label,item.actionPhrase);}
  for(const item of CAMERA_PRESETS){const label=cameraPresetLabel(locale,item.id);assert.ok(label?.trim(),locale+item.id);assert.notEqual(label,item.id);assert.equal(cameraSelectionLabel(locale,applyCameraPreset(item.id)),label+(item.speed==='normal'?'':' · '+cameraSpeedLabel(locale,item.speed)));}
  for(const item of CAMERA_SPEEDS){const label=cameraSpeedLabel(locale,item.id);assert.ok(label?.trim(),locale+item.id);assert.notEqual(label,item.id);}
  for(const key of ['title','presets','custom','zoom','horizontal','vertical','special','speed','hint','confirm','close','clear','remove','resetSpeed'])assert.ok(cameraControlText(locale,key)?.trim(),locale+key);
 }
 assert.equal(cameraSelectionLabel('zh-CN',{movements:['pedestal_up','arc_left'],speed:'slow'}),'升起 + 左弧 + 慢速');
});
test('saved camera boundaries preserve authored camera-like tokens, including after clearing and reload',()=>{
 const selection={movements:['zoom_in'],speed:'normal'};
 for(const body of ['[Pan the camera to the left]\nStoryboard note follows','[Zoom toward the subject] authored quote','[at a slow pace] belongs to the text','[简单拉近] [Zoom toward the subject] quoted instructions']){
  const saved=compose(body,selection),projected=derive(saved.prompt,saved.state);
  assert.equal(projected.body,body,'only the exact saved prefix belongs to the control');
  assert.deepEqual(projected.state.selection,selection,'author text never adds camera tags');
  const cleared=compose(projected.body,{movements:[],speed:'normal'});
  assert.equal(cleared.prompt,body);assert.equal(derive(cleared.prompt,cleared.state).body,body,'clearing then reopening must not infer the preserved body as a legacy control');
  assert.equal(derive(JSON.parse(JSON.stringify(cleared)).prompt,JSON.parse(JSON.stringify(cleared)).state).body,body,'the boundary survives persistence');
 }
 const body='[Pan the camera to the left] note',speedOnly=compose(body,{movements:[],speed:'slow'});
 assert.equal(derive(speedOnly.prompt,speedOnly.state).body,body);assert.deepEqual(derive(speedOnly.prompt,speedOnly.state).state.selection,{movements:[],speed:'slow'});
});
