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

test('free tracks edit, keyframe and composite real media in the browser without disturbing independent tracks', {timeout:90000}, async t=>{
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
let composition=structuredClone(original),controller,latest,commits=0,failNext=false,states=0,insertions=[],imports=0,exports=0,back=0,closed=0,folderOpened=0,busy=false,showSubtitles=true;
const assets=[{id:'blue',kind:'video',title:'Blue video',source:'imported',url:'/blue.mp4',durationMs:8000,used:true},{id:'red',kind:'image',title:'Red picture',source:'imported',url:'/red.svg',used:true},{id:'tone',kind:'music',title:'Music',source:'imported',url:'/tone.wav',durationMs:8000,used:true}];
const context={frameRate:24,canvas:{width:320,height:180},assets:[...assets,{id:'srt',kind:'subtitle',source:'imported'}].map(asset=>({...asset,uri:asset.url||'captions.srt',status:'ready',createdAt:'',updatedAt:''}))};
const root=createRoot(document.querySelector('main'));
function render(){root.render(<ComicMultitrack composition={composition} assets={assets} mediaAssets={[...assets]} fps={24} projectCanvas={{width:320,height:180}} locale='en' busy={busy} importing={false} canUndo={true} canRedo={true} exportLabel='Export' exportDisabled={false}
projectTitle='文件夹名称' projectPath='/tmp/文件夹名称' onOpenFolder={()=>{folderOpened++;}}
onCommit={async next=>{commits++;if(failNext){failNext=false;return false;}composition=applyComicCompositionOperation(composition,{type:'replace',composition:next},context);render();return true;}} onInsertAsset={(...args)=>{insertions.push(args);return true;}} onImportFiles={()=>{imports++;}} actions={{pickFiles(){imports++;},undo(){},redo(){},exportVideo(){exports++;}}} onBack={()=>{back++;}} backLabel='Back' onClose={()=>{closed++;}} closeLabel='Close'
player={{onController:c=>{controller=c;},onStateChange:s=>{latest=s;states++;},subtitlesVisible:showSubtitles,onToggleSubtitles(){showSubtitles=!showSubtitles;render();},subtitleCues:{srt:[{startFrame:24,durationFrames:48,text:'Subtitle'}]}}}/>)}
window.qa={get composition(){return composition;},get state(){return controller.state();},get commits(){return commits;},get states(){return states;},get insertions(){return insertions;},get imports(){return imports;},get exports(){return exports;},get back(){return back;},get closed(){return closed;},get folderOpened(){return folderOpened;},setBusy(v){busy=v;render();},seek(s){controller.seek(s,true);},rerender:render,reset(){composition=structuredClone(original);render();},fail(){failNext=true;},boundary(){composition={schemaVersion:1,tracks:[original.tracks[0]],clips:[{...original.clips[0],id:'first',durationFrames:24},{...original.clips[0],id:'second',from:24,durationFrames:24,sourceStartFrames:96}]};render();},long(){composition={schemaVersion:1,tracks:original.tracks,clips:Array.from({length:5000},(_,i)=>({...original.clips[1],id:'long-'+i,from:i*2400}))};render();}};render();
`},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'empty'},alias:{react:core.resolve('react'),'react-dom/client':core.resolve('react-dom/client')}});
    browser=await puppeteer.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});const page=await browser.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);await page.setViewport({width:1280,height:850});
    server=createServer((request,response)=>{
        const body=request.url==='/blue.mp4'?videoBytes:request.url==='/tone.wav'?audioBytes:request.url==='/red.svg'?Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="red"/></svg>'):Buffer.from('<div class="nmx-shell"><main></main></div>');
        const type=request.url==='/blue.mp4'?'video/mp4':request.url==='/tone.wav'?'audio/wav':request.url==='/red.svg'?'image/svg+xml':'text/html',range=/bytes=(\d+)-(\d*)/.exec(request.headers.range||'');
        if(range){const start=Number(range[1]),end=range[2]?Math.min(body.length-1,Number(range[2])):body.length-1;response.writeHead(206,{'Content-Type':type,'Content-Range':`bytes ${start}-${end}/${body.length}`,'Content-Length':end-start+1,'Accept-Ranges':'bytes'});response.end(body.subarray(start,end+1));}
        else{response.writeHead(200,{'Content-Type':type,'Content-Length':body.length,'Accept-Ranges':'bytes'});response.end(body);}
    });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.addStyleTag({content:await readFile(join(src,'style/nextmux-comic-multitrack.css'),'utf8')});
    await page.addStyleTag({content:'html,body,main,.nmx-shell{height:100%;margin:0;box-sizing:border-box}main{--nmx-bg:#171717;--nmx-panel:#222;--nmx-panel-2:#333;--nmx-text:#eee;--nmx-muted:#aaa;--nmx-border:#555;--nmx-accent:#ad91ec;font:12px system-ui}'});
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

    // Holding the ruler scrubs continuously; locating the playhead must never edit the composition.
    const beforeScrub=await page.evaluate(()=>({commits:qa.commits,composition:JSON.stringify(qa.composition)}));
    await page.evaluate(()=>document.addEventListener('pointerdown',event=>{window.scrubPointerId=event.pointerId;},{capture:true}));
    const ruler=await page.$eval('.nmx-mt-ruler',e=>{const r=e.getBoundingClientRect();return{x:r.left,y:r.top+12};});
    await page.click('.nmx-mt-play');await page.waitForFunction(()=>qa.state.playing);
    await page.mouse.move(ruler.x+48,ruler.y);await page.mouse.down();
    assert.equal(await page.evaluate(()=>qa.state.playing),false,'scrubbing pauses playback');
    assert.equal(await page.evaluate(()=>document.querySelector('.nmx-mt').hasPointerCapture(window.scrubPointerId)),true);
    await page.mouse.move(ruler.x+96,ruler.y,{steps:6});await page.mouse.up();
    assert.equal(await page.evaluate(()=>qa.state.seconds),2,'holding the ruler must scrub past the first pointer-down frame');
    assert.equal(await page.evaluate(()=>document.querySelector('.nmx-mt').hasPointerCapture(window.scrubPointerId)),false);
    await page.waitForFunction(()=>Math.abs(document.querySelector('.nmx-mt-layer video').currentTime-2)<.08&&Math.abs(document.querySelector('audio').currentTime-3)<.08);
    const line=await page.$eval('[data-track-id="words"] .nmx-mt-playhead',e=>{const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+22};});
    await page.mouse.move(line.x,line.y);await page.mouse.down();await page.mouse.move(line.x+48,ruler.y-80,{steps:5});await page.mouse.up();
    assert.equal(await page.evaluate(()=>qa.state.seconds),3,'dragging the line continues above the timeline under pointer capture');
    assert.equal(await page.$$eval('.nmx-mt-clip.is-selected',items=>items.length),0,'the line does not select or move the clip underneath');

    // Scrolled, zoomed coordinates remain integer frames; scroll/zoom during capture are read live.
    for(let i=0;i<6;i++)await page.click('.nmx-mt-toolbar button:has(.codicon-zoom-in)');
    await page.$eval('.nmx-mt-timeline',e=>{e.scrollLeft=160;});
    await page.waitForFunction(()=>document.querySelector('.nmx-mt-timeline').scrollLeft===160);
    const geometry=()=>page.$eval('.nmx-mt-ruler',e=>{const r=e.getBoundingClientRect(),head=e.querySelector('[role="slider"]');return{x:r.left,y:r.top+12,pixels:parseFloat(head.style.left)/Number(head.getAttribute('aria-valuenow'))};});
    const zoomed=await geometry();
    await page.mouse.move(zoomed.x+72*zoomed.pixels,zoomed.y);await page.mouse.down();await page.mouse.move(zoomed.x+79.3*zoomed.pixels,zoomed.y,{steps:4});
    assert.equal(await page.evaluate(()=>qa.state.seconds*24),79,'zoomed scrub rounds to a whole frame');
    await page.$eval('.nmx-mt-timeline',e=>{e.scrollLeft+=80;});
    const scrolledFrame=Math.round(79.3+80/zoomed.pixels);await page.waitForFunction(frame=>Math.round(qa.state.seconds*24)===frame,{},scrolledFrame);
    await page.keyboard.press('+');
    const rezoomedFrame=Math.round((79.3+80/zoomed.pixels)/1.25);await page.waitForFunction(frame=>Math.round(qa.state.seconds*24)===frame,{},rezoomedFrame);
    await page.mouse.move(-300,zoomed.y);assert.equal(await page.evaluate(()=>qa.state.seconds),0,'past the left edge clamps to frame zero');
    await page.mouse.move(5000,zoomed.y);assert.equal(await page.evaluate(()=>qa.state.seconds),6,'past the right edge clamps to the composition end');
    await page.mouse.up();await page.mouse.move(400,zoomed.y);assert.equal(await page.evaluate(()=>qa.state.seconds),6,'released pointer no longer seeks');

    // Cancel, lost capture, Escape and window blur all release the gesture without committing edits.
    for(const cancel of ['pointercancel','lostcapture','escape','blur']){
        await page.evaluate(()=>qa.seek(3));const g=await geometry();
        await page.mouse.move(g.x+72*g.pixels,g.y);await page.mouse.down();await page.mouse.move(g.x+80*g.pixels,g.y,{steps:2});
        const seconds=await page.evaluate(()=>qa.state.seconds);
        if(cancel==='escape')await page.keyboard.press('Escape');
        else await page.evaluate(kind=>{const root=document.querySelector('.nmx-mt');if(kind==='pointercancel')root.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:window.scrubPointerId,isPrimary:true}));else if(kind==='lostcapture')root.releasePointerCapture(window.scrubPointerId);else window.dispatchEvent(new Event('blur'));},cancel);
        await page.mouse.move(g.x+90*g.pixels,g.y,{steps:2});await page.mouse.up();
        assert.equal(await page.evaluate(()=>qa.state.seconds),seconds,`${cancel}: later movements do not seek`);
        assert.equal(await page.evaluate(()=>document.querySelector('.nmx-mt').hasPointerCapture(window.scrubPointerId)),false,`${cancel}: capture released`);
    }
    for(let i=0;i<7;i++)await page.click('.nmx-mt-toolbar button:has(.codicon-zoom-out)');
    await page.$eval('.nmx-mt-timeline',e=>{e.scrollLeft=0;});
    assert.deepEqual(await page.evaluate(()=>({commits:qa.commits,composition:JSON.stringify(qa.composition)})),beforeScrub,'scrubbing does not save or generate an undo step');

    // Keyboard activation inserts the focused asset once and must not bubble into playback shortcuts.
    const inserted=await page.evaluate(()=>qa.insertions.length);await page.focus('.nmx-mt-asset:nth-child(2)');await page.keyboard.press('Enter');
    await page.waitForFunction(count=>qa.insertions.length===count+1,{},inserted);
    await page.waitForFunction(()=>!document.querySelector('.nmx-mt-asset:nth-child(2)').disabled);await page.focus('.nmx-mt-asset:nth-child(2)');
    await page.keyboard.down(' ');await page.keyboard.down(' ');await page.keyboard.up(' ');
    await page.waitForFunction(count=>qa.insertions.length===count+2,{},inserted);
    assert.equal(await page.evaluate(()=>qa.state.playing),false,'Space on an asset inserts once instead of starting playback');

    // A real pointer drag changes both track and time; unrelated audio retains its independent in-point.
    await page.evaluate(()=>qa.seek(0));await page.click('.nmx-mt-toolbar [aria-label="Snapping"]');
    await page.$eval('.nmx-mt-timeline',element=>{element.scrollTop=120;});
    let box=await page.$eval('.nmx-mt-clip[data-clip-id="picture"]',e=>{const r=e.getBoundingClientRect();return{x:r.x+50,y:r.y+20};});
    const targetY=await page.$eval('[data-track-id="base"] .nmx-mt-track-content',e=>{const r=e.getBoundingClientRect();return r.y+25;});
    await page.mouse.move(box.x,box.y);await page.mouse.down();await page.mouse.move(box.x+96,targetY,{steps:6});await page.mouse.up();
    await page.waitForFunction(()=>qa.composition.clips.find(c=>c.id==='picture').trackId==='base');
    assert.equal(await page.evaluate(()=>qa.composition.clips.find(c=>c.id==='picture').from),48);
    assert.equal(await page.evaluate(()=>qa.composition.clips.find(c=>c.id==='music').sourceStartFrames),24);

    await page.evaluate(()=>{qa.reset();qa.seek(0);});await page.waitForFunction(()=>document.querySelector('.nmx-mt-clip[data-clip-id="picture"]')?.closest('[data-track-id]')?.dataset.trackId==='overlay');await page.click('.nmx-mt-clip[data-clip-id="picture"]');
    await page.click('[aria-label="Position X · Add or remove keyframe here"]');
    await page.waitForFunction(()=>qa.composition.clips.find(c=>c.id==='picture').keyframes?.length===1);
    await page.evaluate(()=>qa.seek(2));
    const xField=await page.$('.nmx-mt-property input');await xField.focus();await xField.evaluate(e=>{e.value='100';});await page.keyboard.press('Tab');
    await page.waitForFunction(()=>qa.composition.clips.find(c=>c.id==='picture').keyframes?.length===2);
    await page.evaluate(()=>qa.seek(1));
    await page.waitForFunction(()=>document.querySelector('.nmx-mt-layer[data-clip-id="picture"]').style.transform.includes('translate(50px, 0px)'));
    assert.match(await page.$eval('.nmx-mt-layer[data-clip-id="picture"]',e=>e.style.transform),/translate\(50px, 0px\)/,'preview interpolates the same frame-valued curve');
    await page.select('.nmx-mt-key-row select','hold');
    await page.waitForFunction(()=>qa.composition.clips.find(c=>c.id==='picture').keyframes[0].easing==='hold');
    await page.waitForFunction(()=>document.querySelector('.nmx-mt-layer[data-clip-id="picture"]').style.transform.includes('translate(0px, 0px)'));
    assert.match(await page.$eval('.nmx-mt-layer[data-clip-id="picture"]',e=>e.style.transform),/translate\(0px, 0px\)/);
    await page.select('.nmx-mt-key-row select','linear');
    const dragKey=async(from,delta,to)=>{const selector=`.nmx-mt-key-diamond[title="Position X · ${from}"]`;await page.waitForSelector(selector);await page.$eval(selector,e=>e.scrollIntoView({block:'nearest'}));const b=await page.$eval(selector,e=>{const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});await page.mouse.move(b.x,b.y);await page.mouse.down();await page.mouse.move(b.x+delta,b.y,{steps:4});await page.mouse.up();await page.waitForFunction(frame=>qa.composition.clips.find(c=>c.id==='picture').keyframes.some(k=>k.frame===frame),{},to);};
    await page.evaluate(()=>qa.seek(2));await page.click('[data-track-id="overlay"] [aria-label="Hide track"]');
    await dragKey(48,24,60);await page.click('[data-track-id="overlay"] [aria-label="Show track"]');
    await page.evaluate(()=>qa.seek(2.5));await dragKey(60,-24,48);await page.evaluate(()=>qa.seek(1));
    await page.focus('.nmx-mt');await page.keyboard.press('s');
    await page.waitForFunction(()=>qa.composition.clips.filter(c=>c.assetId==='red').length===2);
    const cut=await page.evaluate(()=>qa.composition.clips.filter(c=>c.assetId==='red').map(c=>({from:c.from,length:c.durationFrames,keys:c.keyframes})));
    assert.equal(cut[0].length,24);assert.equal(cut[1].from,24);assert.equal(cut[1].keys.find(k=>k.frame===0).value,50);

    await page.evaluate(()=>qa.reset());await page.waitForFunction(()=>document.querySelectorAll('.nmx-mt-clip').length===5);await page.click('.nmx-mt-clip[data-clip-id="music"]');await page.keyboard.down('Shift');await page.click('.nmx-mt-clip[data-clip-id="title"]');await page.keyboard.up('Shift');await page.focus('.nmx-mt');await page.keyboard.press('Delete');
    await page.waitForFunction(()=>!qa.composition.clips.some(c=>c.id==='music'||c.id==='title'));
    assert.equal(await page.evaluate(()=>qa.composition.clips.filter(c=>c.kind==='video'||c.kind==='image').length),2);

    await page.evaluate(()=>{qa.reset();qa.fail();});await page.waitForFunction(()=>document.querySelectorAll('.nmx-mt-clip').length===5);await page.click('.nmx-mt-clip[data-clip-id="picture"]');await page.keyboard.press('Delete');await page.waitForSelector('.nmx-mt-error');
    assert.equal(await page.evaluate(()=>qa.composition.clips.some(c=>c.id==='picture')),true,'failed save restores composition');
    await page.click('.nmx-mt-toolbar [aria-label="Back"]');await page.click('.nmx-mt-toolbar [aria-label="Close"]');await page.click('.nmx-mt-export');
    assert.deepEqual(await page.evaluate(()=>[qa.back,qa.closed,qa.exports]),[1,1,1]);
    // Track controls affect only their declared operation; lock does not disable listening controls.
    await page.click('[data-track-id="overlay"] [aria-label="Lock track"]');await page.waitForFunction(()=>qa.composition.tracks.find(t=>t.id==='overlay').locked);
    await page.click('.nmx-mt-clip[data-clip-id="picture"]');await page.keyboard.press('Delete');assert.equal(await page.evaluate(()=>qa.composition.clips.some(c=>c.id==='picture')),true);
    await page.click('[data-track-id="overlay"] [aria-label="Hide track"]');await page.waitForFunction(()=>document.querySelector('.nmx-mt-layer[data-clip-id="picture"]').style.opacity==='0');
    await page.click('[data-track-id="overlay"] [aria-label="Show track"]');await page.click('[data-track-id="overlay"] [aria-label="Unlock track"]');await page.waitForFunction(()=>!qa.composition.tracks.find(t=>t.id==='overlay').locked);
    await page.click('[data-track-id="overlay"] [aria-label="Solo track"]');await page.waitForFunction(()=>document.querySelector('.nmx-mt-layer[data-clip-id="background"]').style.opacity==='0');await page.click('[data-track-id="overlay"] [aria-label="Unsolo track"]');
    const rename='[data-track-id="overlay"] input[aria-label="Rename track"]';await page.focus(rename);await page.$eval(rename,e=>{e.value='Picture in picture';});await page.keyboard.press('Tab');await page.waitForFunction(()=>qa.composition.tracks.find(t=>t.id==='overlay').title==='Picture in picture');
    await page.click('[data-track-id="overlay"] [aria-label="Move layer up"]');await page.waitForFunction(()=>qa.composition.tracks.findIndex(t=>t.id==='overlay')===2);
    await page.select('select[aria-label="Add track"]','video');await page.waitForFunction(()=>qa.composition.tracks.length===5);const newTrack=await page.evaluate(()=>qa.composition.tracks.at(-1).id);
    await page.click('.nmx-mt-asset:nth-child(2) .nmx-mt-asset-add');await page.waitForFunction(()=>qa.insertions.length>0);assert.equal(await page.evaluate(()=>qa.insertions.at(-1)[1]),newTrack,'adding media targets the newly created track');
    await page.click(`[data-track-id="${newTrack}"] [aria-label="Delete track and clips"]`);await page.waitForFunction(()=>qa.composition.tracks.length===4);
    await page.click('.nmx-mt-clip[data-clip-id="picture"]');await page.click('[data-track-id="overlay"] [aria-label="Hide track"]');await page.evaluate(()=>qa.seek(6));
    const endHandle='.nmx-mt-clip[data-clip-id="picture"] .nmx-mt-trim.is-end';await page.$eval(endHandle,e=>e.scrollIntoView({block:'nearest'}));const trim=await page.$eval(endHandle,e=>{const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});await page.mouse.move(trim.x,trim.y);await page.mouse.down();await page.mouse.move(trim.x-24,trim.y,{steps:3});await page.mouse.up();await page.waitForFunction(()=>qa.composition.clips.find(c=>c.id==='picture').durationFrames===132);
    await page.click('[data-track-id="overlay"] [aria-label="Show track"]');
    await page.$$eval('.nmx-mt-inspector label',labels=>{const input=labels.find(l=>l.textContent.includes('Visual · Fade in'))?.querySelector('input');input?.focus();if(input)input.value='1';});await page.keyboard.press('Tab');await page.waitForFunction(()=>qa.composition.clips.find(c=>c.id==='picture').envelope?.fadeInFrames===24||qa.composition.clips.find(c=>c.id==='picture').fadeInFrames===24);
    await page.evaluate(()=>qa.seek(.5));await page.waitForFunction(()=>Math.abs(+(document.querySelector('.nmx-mt-layer[data-clip-id="picture"]')?.style.opacity ?? 1)-.5)<.01);
    await page.click('.nmx-mt-clip[data-clip-id="subtitle"]');await page.click('.nmx-mt-inspector [aria-label="Edit captions"]');
    await page.waitForFunction(()=>!qa.composition.clips.some(c=>c.id==='subtitle'));
    const captions=await page.evaluate(()=>qa.composition.clips.filter(c=>c.purpose==='subtitle'));assert.equal(captions[0].text,'Subtitle');assert.equal(captions[0].from,0);assert.equal(captions[0].durationFrames,48);assert.equal(captions[0].transform.y,65);
    await page.click('.nmx-mt-clip[data-clip-id="background"]');await page.click('.nmx-mt-inspector input[type="checkbox"]');await page.waitForFunction(()=>qa.composition.clips.find(c=>c.id==='background').nativeAudio===true);
    await page.click('.nmx-mt-inspector [aria-label="Detach audio"]');
    await page.waitForFunction(()=>qa.composition.clips.some(c=>c.kind==='audio'&&c.assetId==='blue'));
    const detached=await page.evaluate(()=>({clip:qa.composition.clips.find(c=>c.kind==='audio'&&c.assetId==='blue'),original:qa.composition.clips.find(c=>c.id==='background')}));assert.equal(detached.clip.durationFrames,detached.original.durationFrames);assert.equal(detached.original.nativeAudio,false);
    // The following video is loaded and positioned while paused, then reused across the cut.
    await page.evaluate(()=>{qa.boundary();qa.seek(0);});await page.waitForSelector('.nmx-mt-layer[data-clip-id="second"] video');
    await page.waitForFunction(()=>{const video=document.querySelector('.nmx-mt-layer[data-clip-id="second"] video');return video.readyState>=2&&!video.seeking&&Math.abs(video.currentTime-4)<.05;});
    assert.equal(await page.$eval('.nmx-mt-layer[data-clip-id="second"] video',e=>e.paused),true);
    await page.evaluate(()=>{window.preloaded=document.querySelector('.nmx-mt-layer[data-clip-id="second"] video');});await page.click('.nmx-mt-play');await page.waitForFunction(()=>qa.state.seconds>1.15);
    assert.equal(await page.evaluate(()=>window.preloaded===document.querySelector('.nmx-mt-layer[data-clip-id="second"] video')),true,'boundary reuses the preloaded element');
    await page.waitForFunction(()=>window.preloaded.currentTime>4.1&&!window.preloaded.paused);await page.click('.nmx-mt-play');
    await page.evaluate(()=>qa.long());await page.waitForFunction(()=>qa.composition.clips.length===5000);
    await page.waitForFunction(()=>window.preloaded.getAttribute('src')===null);
    assert.ok(await page.$$eval('.nmx-mt-ruler > span',items=>items.length)<=200);
    assert.ok(await page.$$eval('.nmx-mt-clip',items=>items.length)<30,'offscreen clips are not mounted');
    assert.equal(await page.$eval('.nmx-mt-toolbar .nmx-mt-folder-title',e=>e.textContent.trim()),'文件夹名称');
    await page.click('.nmx-mt-toolbar .nmx-mt-folder-title');
    assert.equal(await page.evaluate(()=>qa.folderOpened),1,'clicking folder title in toolbar opens folder');
    await page.click('[data-nmx-mt-keys="true"]');
    await page.waitForSelector('.nmx-mt-shortcuts');
    await page.click('.nmx-mt-output');
    await page.waitForFunction(()=>!document.querySelector('.nmx-mt-shortcuts'));
    await page.$eval('.nmx-mt-timeline',e=>{e.scrollLeft=0;});
    const timelineBox=await page.$eval('.nmx-mt-timeline',e=>{const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});
    await page.mouse.move(timelineBox.x,timelineBox.y);
    await page.mouse.wheel({deltaY:120});
    await page.waitForFunction(()=>document.querySelector('.nmx-mt-timeline').scrollLeft>0);
    await page.evaluate(()=>qa.setBusy(true));
    assert.equal(await page.$eval('.nmx-mt-toolbar [aria-label="Back"]',e=>e.disabled),false,'back remains enabled while busy');
    assert.equal(await page.$eval('.nmx-mt-toolbar [aria-label="Close"]',e=>e.disabled),false,'close remains enabled while busy');
    await page.click('.nmx-mt-toolbar [aria-label="Back"]');await page.click('.nmx-mt-toolbar [aria-label="Close"]');
    assert.deepEqual(await page.evaluate(()=>[qa.back,qa.closed]),[2,2]);
    await page.evaluate(()=>qa.setBusy(false));
    assert.deepEqual(errors,[]);
});

