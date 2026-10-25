import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url),desktop=createRequire(new URL('../../../apps/desktop/package.json',import.meta.url));
const {outputFiles}=await desktop('esbuild').build({entryPoints:[new URL('../src/browser/nextmux-comic-multitrack-player.tsx',import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'cjs',packages:'external'});
const module={exports:{}};new Function('require','module','exports',outputFiles[0].text)(require,module,module.exports);
const {ComicMultitrackPlayer}=module.exports;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t){
    const callbacks=new Map();let id=0,now=1000;
    t.mock.method(globalThis,'requestAnimationFrame',fn=>{callbacks.set(++id,fn);return id;},{create:true});
    t.mock.method(globalThis,'cancelAnimationFrame',handle=>callbacks.delete(handle),{create:true});
    t.mock.method(performance,'now',()=>now);
    const errors=[],states=[];
    const composition={schemaVersion:1,tracks:[{id:'picture',kind:'video',title:'Picture'},{id:'audio',kind:'audio',title:'Audio'}],clips:[{id:'v',trackId:'picture',kind:'video',from:0,durationFrames:48,sourceStartFrames:0,assetId:'v'},{id:'a',trackId:'audio',kind:'audio',from:0,durationFrames:48,sourceStartFrames:0,assetId:'a'}]};
    const player=new ComicMultitrackPlayer({composition,mediaAssets:[],fps:24,projectCanvas:{width:320,height:180},locale:'en',onPlaybackError:error=>errors.push(error),onStateChange:state=>states.push(state)});
    player.setState=(patch,done)=>{player.state={...player.state,...patch};done?.();};player.gain=()=>{};
    return{player,errors,states,callbacks,setNow(value){now=value;},step(value){now=value;const [handle,fn]=callbacks.entries().next().value;callbacks.delete(handle);fn(value-.25);}};
}
// Node does not normally expose animation-frame APIs; install only test-local placeholders.
globalThis.requestAnimationFrame??=()=>0;globalThis.cancelAnimationFrame??=()=>{};

test('multitrack clock never becomes negative, ignores cancelled ticks and excludes pause time',t=>{
    const f=fixture(t),p=f.player;p.play();f.step(1000);assert.equal(p.live.seconds,0);
    f.step(1250);assert.equal(p.live.seconds,.25);const stale=[...f.callbacks.values()][0];p.pause();f.setNow(2000);stale(2000);assert.equal(p.live.seconds,.25);
    p.play();f.step(2250);assert.equal(p.live.seconds,.5);p.seek(1,false);const before=[...f.callbacks.values()][0];p.seek(.5,true);f.setNow(9000);before(9000);assert.equal(p.live.seconds,.5);
    p.play();f.step(10500);assert.equal(p.live.seconds,2);assert.equal(p.live.playing,false);assert.equal(f.callbacks.size,0);
});

test('obsolete play promises cannot fail a new attempt, while current failures pause only video',async t=>{
    const f=fixture(t),p=f.player;let rejectFirst,rejectSecond;
    const element={paused:true,seeking:false,readyState:4,currentTime:0,duration:2,pause(){this.paused=true;},play(){return new Promise((_,reject)=>{if(!rejectFirst)rejectFirst=reject;else rejectSecond=reject;});}};
    const entry={element,url:'file:///video.mp4'};p.media.set('v',entry);p.live.playing=true;p.start('v',entry);p.stop(entry);p.start('v',entry);
    rejectFirst(Object.assign(Error('old'),{name:'NotAllowedError'}));await tick();assert.deepEqual(f.errors,[]);assert.equal(p.live.playing,true);
    rejectSecond(Object.assign(Error('current'),{name:'NotSupportedError'}));await tick();assert.equal(f.errors.length,1);assert.equal(p.live.playing,false);
    const audio={element:{...element,pause(){},play(){return Promise.reject(Object.assign(Error('audio'),{name:'NotSupportedError'}));}},url:'file:///audio.wav'};
    p.media.set('a',audio);p.live.playing=true;p.start('a',audio);await tick();assert.equal(p.live.playing,true);assert.equal(f.errors.at(-1).kind,'audio');
});

test('equivalent fresh asset arrays do not seek or publish; changed URLs resync without update loops',t=>{
    const f=fixture(t),p=f.player;let sync=0;p.sync=()=>{sync++;};
    const assets=[{id:'v',url:'file:///v.mp4',kind:'video',title:'v',source:'imported',used:true}],previous={...p.props,mediaAssets:assets};
    p.props={...previous,mediaAssets:assets.map(asset=>({...asset}))};p.componentDidUpdate(previous);assert.equal(sync,0);assert.equal(f.states.length,0);
    p.props={...previous,mediaAssets:[{...assets[0],url:'file:///new.mp4'}]};p.componentDidUpdate(previous);assert.equal(sync,1);assert.equal(f.states.length,0);
});

test('loaded-data resync does not repeatedly seek to an already reached target',t=>{
    const f=fixture(t),p=f.player;let writes=0,time=1;
    const element={paused:true,seeking:false,readyState:4,duration:2,get currentTime(){return time;},set currentTime(value){writes++;time=value;},pause(){}};
    p.media.set('v',{element,url:'file:///v.mp4'});p.live.seconds=1;
    p.sync(true);p.sync(true);assert.equal(writes,0);p.live.seconds=1.25;p.sync(true);p.sync(true);assert.equal(writes,1);assert.equal(time,1.25);
});

test('preview gain preserves the schema maximum and visibly reports unsupported amplification',t=>{
    const f=fixture(t),p=f.player,previous={window:globalThis.window,location:globalThis.location,AudioContext:globalThis.AudioContext};
    class Context{state='running';destination={};createGain(){return{gain:{value:0},connect(){}};}createMediaElementSource(){return{connect(){}};}}
    globalThis.window={AudioContext:Context};globalThis.AudioContext=Context;globalThis.location={href:'https://preview.test/',origin:'https://preview.test'};
    t.after(()=>{for(const[name,value]of Object.entries(previous)){if(value===undefined)delete globalThis[name];else globalThis[name]=value;}});
    const local={element:{volume:0},url:'file:///local.wav'};ComicMultitrackPlayer.prototype.gain.call(p,local,16);assert.equal(p.gains.get(local.element).gain.value,16);assert.equal(local.element.volume,1);
    const remote={element:{volume:0},url:'https://untrusted.example/media.wav'};ComicMultitrackPlayer.prototype.gain.call(p,remote,2);assert.equal(remote.element.volume,1);assert.match(p.state.error,/cannot be amplified/);
});
