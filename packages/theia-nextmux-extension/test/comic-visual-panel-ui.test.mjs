import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const pkg=fileURLToPath(new URL('../',import.meta.url)),src=join(pkg,'src/browser'),require=createRequire(join(pkg,'package.json'));
const desktop=createRequire(new URL('../../../apps/desktop/package.json',import.meta.url));
const platform=createRequire(new URL('../../../apps/cloudflare-platform/package.json',import.meta.url)),core=createRequire(require.resolve('@theia/core/package.json'));
const puppeteer=(await import(platform.resolve('puppeteer'))).default;

test('existing editor effect controls add, disable, re-enable and render all registered choices', {timeout:90000}, async t=>{
    const directory=await mkdtemp(join(tmpdir(),'nextmux-multitrack-ui-'));let browser,server;
    t.after(async()=>{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});});
    const ffmpeg=require('@ffmpeg-installer/ffmpeg').path,video=join(directory,'blue.mp4'),audio=join(directory,'tone.wav');
    for(const args of [ ['-f','lavfi','-i','color=c=blue:s=320x180:r=24:d=8','-c:v','libx264','-pix_fmt','yuv420p',video], ['-f','lavfi','-i','sine=frequency=440:duration=8','-c:a','pcm_s16le',audio] ]){
        const result=spawnSync(ffmpeg,['-hide_banner','-loglevel','error',...args],{timeout:15000});assert.equal(result.status,0,result.stderr.toString());
    }
    const videoBytes=await readFile(video),audioBytes=await readFile(audio);
    const {outputFiles}=await desktop('esbuild').build({stdin:{loader:'tsx',resolveDir:src,contents:`
import React from 'react';import{createRoot}from'react-dom/client';import{ComicMultitrack}from'./nextmux-comic-multitrack';
import{applyComicCompositionOperation}from'@nextmux/comic-core/composition';
const original={schemaVersion:1,tracks:[{id:'base',title:'Base',kind:'video'},{id:'overlay',title:'Overlay',kind:'video'},{id:'sound',title:'Music',kind:'audio',volume:.5},{id:'words',title:'Titles',kind:'text'}],clips:[
{id:'background',trackId:'base',kind:'video',title:'Blue',from:0,durationFrames:144,sourceStartFrames:0,assetId:'blue',nativeAudio:false},
{id:'picture',trackId:'overlay',kind:'image',title:'Red',from:0,durationFrames:144,sourceStartFrames:0,assetId:'red',transform:{scale:.5,x:0}},
{id:'music',trackId:'sound',kind:'audio',title:'Tone',from:0,durationFrames:144,sourceStartFrames:24,assetId:'tone',volume:.5},
{id:'title',trackId:'words',kind:'text',purpose:'title',text:'Title',from:0,durationFrames:144,sourceStartFrames:0,textStyle:{fontSize:20,color:'#ffffff'},transform:{y:-65}},
{id:'subtitle',trackId:'words',kind:'text',purpose:'subtitle',assetId:'srt',from:0,durationFrames:144,sourceStartFrames:24,textStyle:{fontSize:16,color:'#ffffff'},transform:{y:65}}]};
let composition=structuredClone(original),controller,latest,commits=0,failNext=false,states=0,insertions=[],imports=0,exports=0,back=0,closed=0,showSubtitles=true;
const assets=[{id:'blue',kind:'video',title:'Blue video',source:'imported',url:'/blue.mp4',durationMs:8000,used:true},{id:'red',kind:'image',title:'Red picture',source:'imported',url:'/red.svg',used:true},{id:'tone',kind:'music',title:'Music',source:'imported',url:'/tone.wav',durationMs:8000,used:true}];
const context={frameRate:24,canvas:{width:320,height:180},assets:[...assets,{id:'srt',kind:'subtitle',source:'imported'}].map(asset=>({...asset,uri:asset.url||'captions.srt',status:'ready',createdAt:'',updatedAt:''}))};
const root=createRoot(document.querySelector('main'));
function render(){root.render(<ComicMultitrack composition={composition} assets={assets} mediaAssets={[...assets]} fps={24} projectCanvas={{width:320,height:180}} locale='en' busy={false} importing={false} canUndo={true} canRedo={true} exportLabel='Export' exportDisabled={false}
onCommit={async next=>{commits++;if(failNext){failNext=false;return false;}composition=applyComicCompositionOperation(composition,{type:'replace',composition:next},context);render();return true;}} onInsertAsset={(...args)=>{insertions.push(args);return true;}} onImportFiles={()=>{imports++;}} actions={{pickFiles(){imports++;},undo(){},redo(){},exportVideo(){exports++;}}} onBack={()=>{back++;}} backLabel='Back' onClose={()=>{closed++;}} closeLabel='Close'
player={{onController:c=>{controller=c;},onStateChange:s=>{latest=s;states++;},subtitlesVisible:showSubtitles,onToggleSubtitles(){showSubtitles=!showSubtitles;render();},subtitleCues:{srt:[{startFrame:24,durationFrames:48,text:'Subtitle'}]}}}/>)}
window.qa={get composition(){return composition;},get state(){return controller.state();},get commits(){return commits;},get states(){return states;},get insertions(){return insertions;},get imports(){return imports;},get exports(){return exports;},get back(){return back;},get closed(){return closed;},seek(s){controller.seek(s,true);},rerender:render,reset(){composition=structuredClone(original);render();},fail(){failNext=true;},boundary(){composition={schemaVersion:1,tracks:[original.tracks[0]],clips:[{...original.clips[0],id:'first',durationFrames:24},{...original.clips[0],id:'second',from:24,durationFrames:24,sourceStartFrames:96}]};render();},long(){composition={schemaVersion:1,tracks:original.tracks,clips:Array.from({length:5000},(_,i)=>({...original.clips[1],id:'long-'+i,from:i*2400}))};render();}};render();
`},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'empty'},alias:{react:core.resolve('react'),'react-dom/client':core.resolve('react-dom/client')}});
    browser=await puppeteer.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required','--enable-unsafe-webgpu',...(process.platform==='darwin'?['--use-angle=metal']:[])]});const page=await browser.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);await page.setViewport({width:1280,height:850});
    server=createServer((request,response)=>{
        const body=request.url==='/blue.mp4'?videoBytes:request.url==='/tone.wav'?audioBytes:request.url==='/red.svg'?Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="red"/></svg>'):Buffer.from('<div class="nmx-shell"><main></main></div>');
        const type=request.url==='/blue.mp4'?'video/mp4':request.url==='/tone.wav'?'audio/wav':request.url==='/red.svg'?'image/svg+xml':'text/html',range=/bytes=(\d+)-(\d*)/.exec(request.headers.range||'');
        if(range){const start=Number(range[1]),end=range[2]?Math.min(body.length-1,Number(range[2])):body.length-1;response.writeHead(206,{'Content-Type':type,'Content-Range':`bytes ${start}-${end}/${body.length}`,'Content-Length':end-start+1,'Accept-Ranges':'bytes'});response.end(body.subarray(start,end+1));}
        else{response.writeHead(200,{'Content-Type':type,'Content-Length':body.length,'Accept-Ranges':'bytes'});response.end(body);}
    });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.addStyleTag({content:await readFile(join(src,'style/nextmux-comic-multitrack.css'),'utf8')});
    await page.addStyleTag({content:await readFile(join(src,'style/nextmux-comic-visual-panel.css'),'utf8')});await page.addStyleTag({content:'html,body,main,.nmx-shell{height:100%;margin:0;box-sizing:border-box}main{--nmx-bg:#171717;--nmx-panel:#222;--nmx-panel-2:#333;--nmx-text:#eee;--nmx-muted:#aaa;--nmx-border:#555;--nmx-accent:#ad91ec;font:12px system-ui}'});
    await page.addScriptTag({content:outputFiles[0].text});await page.waitForSelector('.nmx-mt-layer video');await page.waitForFunction(()=>document.querySelector('.nmx-mt-layer video').readyState>=2);
    const rgb=async(x,y)=>{const box=await page.$eval('.nmx-mt-output',e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};});const bytes=await page.screenshot({type:'png',clip:{x:Math.floor(box.x+box.width*x),y:Math.floor(box.y+box.height*y),width:1,height:1}});const result=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-i','pipe:0','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{input:bytes});assert.equal(result.status,0,result.stderr.toString());return [...result.stdout];};
    const center=await rgb(.5,.5),edge=await rgb(.1,.5);assert.ok(center[0]>200&&center[2]<40,`red upper layer ${center}`);assert.ok(edge[2]>180&&edge[0]<40,`blue lower video ${edge}`);
    assert.equal(await page.$$eval('.nmx-mt-layer',items=>items.length),4);
    assert.equal(await page.$eval('.nmx-mt-layer[data-clip-id="subtitle"]',e=>e.textContent),'Subtitle','external subtitle samples source offset');
    await page.click('.nmx-mt-transport button[aria-pressed]');
    assert.equal(await page.$eval('.nmx-mt-layer[data-clip-id="subtitle"]',e=>getComputedStyle(e).opacity),'0');
    assert.equal(await page.$eval('.nmx-mt-layer[data-clip-id="title"]',e=>getComputedStyle(e).opacity),'1','subtitle toggle keeps titles');
    const stateCount=await page.evaluate(()=>qa.states);await page.evaluate(()=>{for(let i=0;i<10;i++)qa.rerender();});
    await page.waitForFunction(()=>document.querySelector('.nmx-mt-layer video').readyState>=2);assert.equal(await page.evaluate(()=>qa.states),stateCount,'new asset array must not publish recursively');
    await page.click('.nmx-mt-play');await page.waitForFunction(()=>qa.state.seconds>.5);
    await page.waitForFunction(()=>document.querySelector('.nmx-mt-layer video').currentTime>.25);
    assert.equal(await page.$eval('audio',e=>e.volume),.25,'track volume multiplies clip volume');
    await page.click('.nmx-mt-play');await page.evaluate(()=>qa.seek(1.25));
    await page.waitForFunction(()=>Math.abs(document.querySelector('.nmx-mt-layer video').currentTime-1.25)<.08);
    await page.waitForFunction(()=>Math.abs(document.querySelector('audio').currentTime-2.25)<.08);
    await page.click('[aria-label="Expand preview"]');await page.waitForSelector('dialog:modal');await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('dialog:modal'));

    // Actual effect panel events drive the same engine used by export; then restore the baseline.
    await page.click('[data-clip-id="picture"].nmx-mt-clip');
    await page.select('.nmx-mt-inspector select[aria-label="Effects & color"]','gpu-invert');
    await page.click('.nmx-mt-inspector button[title="Add"]');
    await page.waitForFunction(()=>qa.composition.clips.find(c=>c.id==='picture').effects?.[0]?.type==='gpu-invert');
    await page.waitForFunction(()=>{const c=document.querySelector('.nmx-mt-output canvas');if(!c)return false;const p=c.getContext('2d').getImageData(160,90,1,1).data;return p[0]<20&&p[1]>200&&p[2]>200;});
    const effect=await page.evaluate(()=>structuredClone(qa.composition.clips.find(c=>c.id==='picture').effects[0]));
    assert.equal(effect.enabled,true);
    await page.click('.nmx-mt-inspector input[type="checkbox"]');
    await page.waitForFunction(()=>!qa.composition.clips.find(c=>c.id==='picture').effects[0].enabled);
    await page.waitForFunction(()=>!document.querySelector('.nmx-mt-output canvas'));
    await page.click('.nmx-mt-inspector input[type="checkbox"]');
    await page.waitForFunction(()=>!!document.querySelector('.nmx-mt-output canvas'));
    assert.equal(await page.$$eval('.nmx-mt-inspector select[aria-label="Effects & color"] option',o=>o.length),54);
    await page.click('[aria-label="Expand preview"]');await page.waitForSelector('dialog:modal');await page.click('.nmx-mt-preview-close');await page.waitForFunction(()=>!document.querySelector('dialog:modal'));
    for(const summary of await page.$$('.nmx-mt-inspector summary'))if(await summary.evaluate(e=>e.textContent)==='Masks'){await summary.click();break;}
    await page.select('.nmx-mt-inspector select[aria-label="Masks"]','circle');await page.click('.nmx-mt-inspector select[aria-label="Masks"] + button');
    await page.waitForFunction(()=>qa.composition.clips.find(c=>c.id==='picture').masks?.[0]?.shape==='circle');
    const circle=await page.evaluate(()=>qa.composition.clips.find(c=>c.id==='picture').masks[0]);assert.ok(Math.abs(circle.width*320-.7*180)<1e-6);

    await page.evaluate(()=>qa.reset());await page.waitForFunction(()=>!document.querySelector('.nmx-mt-output canvas'));


});
