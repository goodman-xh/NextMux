import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const desktop=createRequire(new URL('../../../apps/desktop/package.json',import.meta.url));
const repository=fileURLToPath(new URL('../../../',import.meta.url));
const {buildComicVisualRenderer}=await import('../../../scripts/build-comic-visual-renderer.mjs');
const ffmpeg=desktop('@ffmpeg-installer/ffmpeg').path;
function run(args){const p=spawnSync(ffmpeg,['-hide_banner','-loglevel','error',...args],{timeout:60000,maxBuffer:16*1024*1024});assert.equal(p.status,0,p.stderr?.toString()||p.error?.message);return p.stdout;}
// Opt in on a graphics-capable runner. Absence of that runner is not a product PASS.
test('actual shared-GPU composition export retains keyframes, masks, frame count and native audio', {timeout:90000,skip:process.env.NEXTMUX_RUN_GPU_EXPORT_TEST!=='1'},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'nextmux-comic-visual-export-')),application=join(directory,'app'),temp=join(directory,'render');await mkdir(temp);await mkdir(application);
 const previous=process.env.THEIA_APP_PROJECT_PATH;process.env.THEIA_APP_PROJECT_PATH=application;t.after(async()=>{if(previous===undefined)delete process.env.THEIA_APP_PROJECT_PATH;else process.env.THEIA_APP_PROJECT_PATH=previous;await rm(directory,{recursive:true,force:true});});
 for(const file of ['comic-visual-renderer.cjs','comic-visual-renderer-preload.cjs'])await copyFile(join(repository,'apps/desktop',file),join(application,file));await buildComicVisualRenderer(join(application,'build-resources/comic-visual-renderer'));
 const source=join(directory,'source.mp4');run(['-y','-f','lavfi','-i','color=c=0x304050:s=256x192:r=24:d=1','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=1','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',source]);
 const {outputFiles}=await desktop('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/node/nextmux-comic-composition-export.ts',import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs',packages:'external'});const module={exports:{}};new Function('require','module','exports','__dirname',outputFiles[0].text)(desktop,module,module.exports,directory);
 const clip={id:'clip',trackId:'video',kind:'video',from:0,durationFrames:24,sourceStartFrames:0,assetId:'video',effects:[{id:'exposure',type:'gpu-exposure',enabled:true,params:{exposure:0}}],keyframes:[{property:'effect:exposure:exposure',frame:0,value:0,easing:'linear'},{property:'effect:exposure:exposure',frame:24,value:1,easing:'linear'}],masks:[{id:'circle',shape:'circle',enabled:true,invert:false,scope:'clip',x:.5,y:.5,width:.6,height:.6,rotation:0,feather:0,opacity:1}]};
 const composition={schemaVersion:1,tracks:[{id:'video',kind:'video',title:'Video'}],clips:[clip]},project={frameRate:24,canvas:{width:128,height:96,aspectRatio:'4:3'}};
 const output=join(directory,'export.mp4'),host={ffmpeg,temporaryRoot:temp,signal:new AbortController().signal,quality:'balanced',run:async args=>{run(args);},verify:async(path,frames)=>assert.equal(run(['-i',path,'-an','-pix_fmt','rgba','-f','rawvideo','pipe:1']).length,frames*128*96*4),progress:async()=>{},fail:(code,detail)=>{throw Error(`${code}: ${detail}`);}};
 await module.exports.renderComicCompositionExport(project,{composition,durationFrames:24,clips:[{clip,from:0,end:24,visible:true,audible:true,trackVolume:1,path:source,width:256,height:192,origin:0,audioOrigin:0}],subtitles:[]},output,host);
 const pixels=run(['-i',output,'-an','-pix_fmt','rgba','-f','rawvideo','pipe:1']),size=128*96*4,center=(48*128+64)*4;assert.equal(pixels.length,24*size);assert.ok(pixels[23*size+center]>pixels[center]+25);assert.ok(pixels[(4*128+4)*4]<10);
 const audio=run(['-i',output,'-vn','-ac','1','-ar','48000','-f','f32le','pipe:1']);let sin=0,cos=0;for(let i=0;i<audio.length/4;i++){const phase=2*Math.PI*440*i/48000;sin+=audio.readFloatLE(i*4)*Math.sin(phase);cos+=audio.readFloatLE(i*4)*Math.cos(phase);}assert.ok(2*Math.hypot(sin,cos)/(audio.length/4)>.05);
});

test('visual export uses decoded autorotation and pixel aspect ratio rather than stale container dimensions', {timeout:90000,skip:process.env.NEXTMUX_RUN_GPU_EXPORT_TEST!=='1'},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'nextmux-comic-visual-orientation-')),application=join(directory,'app');await mkdir(application);
 const previous=process.env.THEIA_APP_PROJECT_PATH;process.env.THEIA_APP_PROJECT_PATH=application;t.after(async()=>{if(previous===undefined)delete process.env.THEIA_APP_PROJECT_PATH;else process.env.THEIA_APP_PROJECT_PATH=previous;await rm(directory,{recursive:true,force:true});});
 for(const file of ['comic-visual-renderer.cjs','comic-visual-renderer-preload.cjs'])await copyFile(join(repository,'apps/desktop',file),join(application,file));await buildComicVisualRenderer(join(application,'build-resources/comic-visual-renderer'));
 const {outputFiles}=await desktop('esbuild').build({entryPoints:[fileURLToPath(new URL('../src/node/nextmux-comic-visual-export.ts',import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs',packages:'external'});const module={exports:{}};new Function('require','module','exports','__dirname',outputFiles[0].text)(desktop,module,module.exports,directory);
 const plain=join(directory,'plain.mp4'),rotated=join(directory,'rotated.mp4'),sar=join(directory,'sar.mp4');
 run(['-y','-f','lavfi','-i','color=c=red:s=160x96:r=24:d=0.25','-vf','drawbox=x=80:y=0:w=80:h=96:color=blue:t=fill','-c:v','libx264','-pix_fmt','yuv420p',plain]);
 run(['-y','-i',plain,'-c','copy','-metadata:s:v:0','rotate=90',rotated]);
 run(['-y','-f','lavfi','-i','color=c=red:s=96x96:r=24:d=0.25','-vf','setsar=2','-c:v','libx264','-pix_fmt','yuv420p',sar]);
 for(const [name,path,width,height]of [['rotated',rotated,160,96],['sar',sar,96,96]]){
  const temp=join(directory,name);await mkdir(temp);const output=join(directory,name+'-export.mp4');
  const clip={id:'clip',trackId:'video',kind:'video',from:0,durationFrames:6,sourceStartFrames:0,effects:[{id:'e',type:'gpu-exposure',enabled:true,params:{exposure:0}}]};
  await module.exports.renderComicVisualFrames({ffmpeg,temporaryRoot:temp,signal:new AbortController().signal,quality:'high',width:200,height:200,fps:24,from:0,frames:6,layers:[{clip,path,width,height,origin:0}],output});
  const pixels=run(['-i',output,'-an','-pix_fmt','rgba','-f','rawvideo','pipe:1']);assert.equal(pixels.length,6*200*200*4);
  const rgb=(x,y)=>[...pixels.subarray((y*200+x)*4,(y*200+x)*4+3)];
  if(name==='rotated'){assert.ok(rgb(10,100).every(v=>v<10),'portrait autorotation has horizontal bars');assert.ok(Math.max(...rgb(100,10))>200,'rotated picture fills top');}
  else{assert.ok(rgb(100,20).every(v=>v<10),'wide SAR has vertical bars');assert.ok(rgb(100,70)[0]>200,'square source becomes wide display picture');}
 }
});
