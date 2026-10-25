import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {execFileSync} from 'node:child_process';

const desktop=createRequire(new URL('../../../apps/desktop/package.json',import.meta.url));
const source=fileURLToPath(new URL('../src/node/nextmux-comic-visual-export.ts',import.meta.url));
const {outputFiles}=await desktop('esbuild').build({entryPoints:[source],bundle:true,write:false,platform:'node',format:'cjs',packages:'external'});
function load(overrides={}) {
 const module={exports:{}};
 new Function('require','module','exports','__dirname',outputFiles[0].text)(id=>id in overrides?overrides[id]:desktop(id),module,module.exports,fileURLToPath(new URL('../src/node/',import.meta.url)));
 return module.exports;
}
const {comicVisualElectronExecutable}=load();

async function bundle(t,name='Renamed Product & QA',executable='Custom Main') {
 const root=await mkdtemp(join(tmpdir(),'nextmux-visual-launch-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const contents=join(root,name+'.app','Contents'),main=join(contents,'MacOS',executable);
 await mkdir(join(contents,'MacOS'),{recursive:true});await writeFile(main,'fixture');await chmod(main,0o700);
 const escaped=executable.replaceAll('&','&amp;').replaceAll('<','&lt;');
 await writeFile(join(contents,'Info.plist'),`<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>${escaped}</string></dict></plist>`);
 return {contents,main,helper:join(contents,'Frameworks','Different Helper (Plugin).app','Contents','MacOS','Different Helper (Plugin)')};
}

test('macOS Helper uses the renamed containing application, including binary plist', {skip:process.platform!=='darwin'},async t=>{
 const b=await bundle(t);assert.equal(await comicVisualElectronExecutable(b.helper,'darwin'),b.main);
 execFileSync('/usr/bin/plutil',['-convert','binary1',join(b.contents,'Info.plist')]);
 assert.equal(await comicVisualElectronExecutable(b.helper,'darwin'),b.main);
});
test('a normal packaged macOS executable remains unchanged without reading a plist',async()=>{
 const main='/Applications/Arbitrary Name.app/Contents/MacOS/Arbitrary Name';
 assert.equal(await comicVisualElectronExecutable(main,'darwin'),main);
});
test('Windows and Linux preserve their original executable paths',async()=>{
 for(const [platform,path]of [['win32','C:\\Program Files\\Product\\Product.exe'],['linux','/opt/product/product']])assert.equal(await comicVisualElectronExecutable(path,platform),path);
});
test('macOS Helpers reject missing metadata and nonexistent executable rather than guessing a name', {skip:process.platform!=='darwin'},async t=>{
 const b=await bundle(t);await rm(b.main);await assert.rejects(comicVisualElectronExecutable(b.helper,'darwin'),/ENOENT/);
 await rm(join(b.contents,'Info.plist'));await assert.rejects(comicVisualElectronExecutable(b.helper,'darwin'));
});
test('macOS metadata cannot escape Contents/MacOS', {skip:process.platform!=='darwin'},async t=>{
 const b=await bundle(t);await writeFile(join(b.contents,'Info.plist'),'<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>../../outside</string></dict></plist>');
 await assert.rejects(comicVisualElectronExecutable(b.helper,'darwin'),/Invalid visual renderer/);
});

function fakeChild() {
 const child=new EventEmitter();Object.assign(child,{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),exitCode:null,signalCode:null,kills:[]});
 child.kill=signal=>{child.kills.push(signal);child.signalCode=signal;child.stdout.end();queueMicrotask(()=>child.emit('close',null,signal));return true;};
 return child;
}
function renderHarness(mode) {
 const calls=[],children=[];
 const cp={execFile:desktop('node:child_process').execFile,spawn:(file,args,options)=>{
  const child=fakeChild();calls.push({file,args,options});children.push(child);
  if(mode==='ignore-term'){const original=child.kill;child.kill=signal=>{if(signal==='SIGTERM'){child.kills.push(signal);return true;}return original(signal);};}
  if(mode==='exit')queueMicrotask(()=>{child.stderr.write('startup fixture failed');child.exitCode=7;child.stdout.end();child.emit('close',7);});
  if(mode==='error')queueMicrotask(()=>{child.emit('error',Object.assign(new Error('fixture spawn failed'),{code:'ENOENT'}));child.stdout.end();child.emit('close',-2);});
  if(mode==='invalid')queueMicrotask(()=>{const header=Buffer.alloc(8);header.writeUInt32BE(8388609);child.stdout.write(header);});
  return child;
 }};
 const api=load({'node:child_process':cp});
 const controller=new AbortController();
 const promise=api.renderComicVisualFrames({ffmpeg:'ffmpeg-fixture',temporaryRoot:tmpdir(),signal:controller.signal,quality:'balanced',width:128,height:96,fps:24,from:0,frames:1,layers:[],output:join(tmpdir(),'never-created-visual-test.mp4')});
 // Attach before scheduling exit/error so an early rejection is always observed.
 void promise.catch(()=>{});
 return {calls,children,controller,promise};
}
const flush=()=>new Promise(ok=>setImmediate(ok));
async function started(h) {for(let i=0;i<100&&!h.calls.length;i++)await flush();assert.equal(h.calls.length,1,'worker spawned');await flush();}

test('worker startup failure rejects and never starts ffmpeg',async()=>{
 const h=renderHarness('exit');await assert.rejects(h.promise,/Visual process failed \(7\)|ended before expected frame/);assert.equal(h.calls.length,1);
});
test('worker spawn error rejects without leaving a child pending',async()=>{
 const h=renderHarness('error');await assert.rejects(h.promise,/fixture spawn failed|ended before expected frame/);assert.equal(h.calls.length,1);
});
test('stalled startup times out and cleans only its own worker',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const h=renderHarness('stalled');await started(h);
 t.mock.timers.tick(60000);await flush();await assert.rejects(h.promise,/Visual renderer response timed out/);
 assert.deepEqual(h.children[0].kills,['SIGTERM']);assert.equal(h.calls.length,1);assert.equal(h.children[0].stdin.destroyed,true);
});
test('cancellation during startup rejects immediately and closes the owned worker',async()=>{
 const h=renderHarness('stalled');await started(h);h.controller.abort();await assert.rejects(h.promise,/Export cancelled|ended before expected frame/);
 assert.deepEqual(h.children[0].kills,['SIGTERM']);assert.equal(h.calls.length,1);
});
test('a stalled worker ignoring TERM is escalated to KILL before cleanup completes',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const h=renderHarness('ignore-term');await started(h);
 t.mock.timers.tick(60000);await flush();assert.deepEqual(h.children[0].kills,['SIGTERM']);
 t.mock.timers.tick(2000);await flush();await assert.rejects(h.promise,/timed out/);
 assert.deepEqual(h.children[0].kills,['SIGTERM','SIGKILL']);assert.equal(h.calls.length,1);
});
test('malformed IPC response rejects and cleans the worker before starting ffmpeg',async()=>{
 const h=renderHarness('invalid');await assert.rejects(h.promise,/Invalid visual worker response/);
 assert.deepEqual(h.children[0].kills,['SIGTERM']);assert.equal(h.calls.length,1);
});
