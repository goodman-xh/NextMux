import {execFile,spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {constants} from 'node:fs';
import {access} from 'node:fs/promises';
import {basename,join,resolve} from 'node:path';
import {promisify} from 'node:util';
import type {ComicCompositionClip} from '@nextmux/comic-core/composition';
export interface ComicVisualExportLayer {readonly clip:ComicCompositionClip;readonly path?:string;readonly origin?:number;readonly text?:string;readonly width?:number;readonly height?:number;}
interface Options{ffmpeg:string;temporaryRoot:string;signal:AbortSignal;quality:'draft'|'balanced'|'high';width:number;height:number;fps:number;from:number;frames:number;layers:readonly ComicVisualExportLayer[];output:string;onProgress?:(completedFrames:number)=>Promise<void>;}
const FRAME_LIMIT=134217728,META_LIMIT=8388608,RESPONSE_TIMEOUT=60000;
/** Electron's macOS Node fork runs in a Helper. GPU rendering needs the containing app executable. */
export async function comicVisualElectronExecutable(executable:string,platform:NodeJS.Platform=process.platform):Promise<string>{
 if(platform!=='darwin')return executable;
 const marker=executable.indexOf('.app/Contents/');if(marker<0)return executable;
 const contents=executable.slice(0,marker+'.app/Contents'.length),inside=executable.slice(marker+'.app/Contents/'.length);
 if(/^MacOS\/[^/]+$/.test(inside))return executable;
 if(!/^Frameworks\/.+\.app\/Contents\/MacOS\/[^/]+$/.test(inside))throw Error('Cannot locate the visual renderer application executable');
 const {stdout}=await promisify(execFile)('/usr/libexec/PlistBuddy',['-c','Print :CFBundleExecutable',join(contents,'Info.plist')],{encoding:'utf8',timeout:5000,maxBuffer:4096,windowsHide:true});
 const name=stdout.trim();if(!name||name==='.'||name==='..'||basename(name)!==name||/[\\\/\0\r\n]/.test(name))throw Error('Invalid visual renderer application executable');
 const application=join(contents,'MacOS',name);await access(application,constants.X_OK);return application;
}
/** A lost worker or blocked pipe must fail or cancel instead of hanging the export indefinitely. */
async function awaitVisualOperation<T>(operation:Promise<T>,signal:AbortSignal,timeout:number,label:string,workerDone?:Promise<void>):Promise<T>{
 return new Promise<T>((ok,fail)=>{
  let settled=false;const finish=(error?:unknown,value?:T)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',cancel);if(error!==undefined)fail(error);else ok(value as T);};
  const cancel=()=>finish(Error('Export cancelled')),timer=setTimeout(()=>finish(Error(`${label} timed out`)),timeout);
  signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
  void operation.then(value=>finish(undefined,value),error=>finish(error));
  if(workerDone)void workerDone.then(()=>finish(Error('Visual renderer exited before replying')),error=>finish(error));
 });
}
/** At most one complete frame per reader; downstream requests acknowledge before another is sent. */
class ExactReader{
 private iterator:AsyncIterator<Buffer|string>;private chunks:Buffer[]=[];private length=0;
 constructor(stream:NodeJS.ReadableStream,private readonly limit:number){this.iterator=stream[Symbol.asyncIterator]();}
 async read(size:number):Promise<Buffer>{if(size<0||size>this.limit)throw Error('Visual frame limit');while(this.length<size){const item=await this.iterator.next();if(item.done)throw Error('Visual stream ended before expected frame');const bytes=typeof item.value==='string'?Buffer.from(item.value):item.value;this.chunks.push(bytes);this.length+=bytes.length;if(this.length>this.limit+1048576)throw Error('Visual stream buffer limit');}const all=this.chunks.length===1?this.chunks[0]:Buffer.concat(this.chunks,this.length),out=all.subarray(0,size);this.chunks=this.length>size?[all.subarray(size)]:[];this.length-=size;return out;}
}
async function writable(stream:NodeJS.WritableStream,bytes:Uint8Array):Promise<void>{await new Promise<void>((ok,fail)=>stream.write(bytes,error=>error?fail(error):ok()));}
async function workerPaths():Promise<{script:string;page:string}>{
 const app=process.env.THEIA_APP_PROJECT_PATH;const candidates=[(process as NodeJS.Process&{resourcesPath?:string}).resourcesPath&&join((process as NodeJS.Process&{resourcesPath:string}).resourcesPath,'app.asar.unpacked'),process.env.NEXTMUX_RESOURCES_PATH&&join(process.env.NEXTMUX_RESOURCES_PATH,'app.asar.unpacked'),app,resolve(__dirname,'../../../../apps/desktop'),process.cwd(),join(process.cwd(),'apps/desktop')].filter(Boolean) as string[];
 for(const root of candidates){const script=join(root,'comic-visual-renderer.cjs'),page=join(root,'build-resources/comic-visual-renderer/index.html');try{await access(script);await access(page);return{script,page};}catch{/* Next packaged/development path. */}}
 throw Error('The installed visual renderer is missing. Rebuild the desktop render resources.');
}
export async function renderComicVisualFrames(options:Options):Promise<void>{
 const o=options,paths=await workerPaths(),children=new Set<ChildProcessWithoutNullStreams>(),failures:Error[]=[],completions:Promise<void>[]=[];
 const electron=await comicVisualElectronExecutable(process.versions.electron?process.execPath:require('electron') as string);
 const launch=(file:string,args:readonly string[],env:NodeJS.ProcessEnv=process.env)=>{
  const child=spawn(file,[...args],{stdio:['pipe','pipe','pipe'],windowsHide:true,env});children.add(child);let diagnostic='';child.stderr.on('data',bytes=>{diagnostic=(diagnostic+bytes.toString()).slice(-4096);});for(const stream of [child.stdin,child.stdout,child.stderr])stream.on('error',error=>failures.push(error));
  child.on('error',error=>failures.push(error));const done=new Promise<void>((ok,fail)=>{child.on('close',code=>{children.delete(child);if(code===0)ok();else fail(Error(`Visual process failed (${code}): ${diagnostic}`));});child.on('error',fail);});completions.push(done);void done.catch(()=>{});return{child,done};
 };
 const killTimers=new Map<ChildProcessWithoutNullStreams,NodeJS.Timeout>();
 const abort=()=>{for(const child of children){child.stdin.destroy();child.stdout.destroy();if(killTimers.has(child))continue;child.kill('SIGTERM');const timer=setTimeout(()=>{killTimers.delete(child);if(children.has(child))child.kill('SIGKILL');},2000);timer.unref();killTimers.set(child,timer);child.once('close',()=>{clearTimeout(timer);killTimers.delete(child);});}};
 o.signal.addEventListener('abort',abort,{once:true});
 try{
  if(o.signal.aborted)throw Error('Export cancelled');
  const env:NodeJS.ProcessEnv={...process.env,NEXTMUX_COMIC_VISUAL_WORKER:'1',NEXTMUX_COMIC_RENDER_ROOT:o.temporaryRoot,NEXTMUX_COMIC_RENDER_PAGE:paths.page};delete env.ELECTRON_RUN_AS_NODE;
  const worker=launch(electron,[paths.script],env),reader=new ExactReader(worker.child.stdout,FRAME_LIMIT);
  const command=async(meta:object,bytes:Uint8Array=new Uint8Array()):Promise<Buffer>=>awaitVisualOperation((async()=>{
   if(o.signal.aborted)throw Error('Export cancelled');if(failures.length)throw failures[0];const metadata=Buffer.from(JSON.stringify(meta));if(metadata.length>META_LIMIT||bytes.length>FRAME_LIMIT)throw Error('Visual request limit');const h=Buffer.alloc(8);h.writeUInt32BE(metadata.length);h.writeUInt32BE(bytes.length,4);await writable(worker.child.stdin,h);await writable(worker.child.stdin,metadata);if(bytes.length)await writable(worker.child.stdin,bytes);
   const header=await reader.read(8),m=header.readUInt32BE(),size=header.readUInt32BE(4);if(m>META_LIMIT||size>FRAME_LIMIT)throw Error('Invalid visual worker response');const response=JSON.parse((await reader.read(m)).toString());const pixels=size?await reader.read(size):Buffer.alloc(0);if(!response.ok)throw Error(response.error||'Visual renderer failed');return pixels;
  })(),o.signal,RESPONSE_TIMEOUT,'Visual renderer response',worker.done);
  // Preflight every enabled shader before starting media decoders/encoder.
  await command({command:'init',width:o.width,height:o.height,effects:[...new Set(o.layers.flatMap(l=>(l.clip.effects??[]).filter(e=>e.enabled).map(e=>e.type)))].map(type=>({id:type,type,enabled:true,params:{}}))});
  const sources=o.layers.map(layer=>{
   if(layer.clip.kind==='text')return{layer};const frameBytes=layer.width!*layer.height!*4;if(!Number.isSafeInteger(frameBytes)||frameBytes<4||frameBytes>FRAME_LIMIT)throw Error('Source picture dimensions exceed the visual frame limit');
   const clip=layer.clip,seconds=(clip.sourceStartFrames+o.from-clip.from)/o.fps+(layer.origin??0);const input=clip.kind==='image'?['-loop','1','-framerate',String(o.fps),'-i',layer.path!]:['-seek_timestamp','1','-ss',seconds.toFixed(9),'-i',layer.path!];
   const decoded=launch(o.ffmpeg,['-hide_banner','-loglevel','info',...input,'-an','-vf',`scale=round(iw*sar):ih,setsar=1,fps=${o.fps},trim=end_frame=${o.frames}`, '-frames:v',String(o.frames),'-pix_fmt','rgba','-f','rawvideo','pipe:1']);decoded.child.stdin.end();
   // FFmpeg autorotation can swap native width/height. Read the actual raw output
   // header rather than interpreting rotated bytes using container dimensions.
   const dimensions=awaitVisualOperation(new Promise<{width:number;height:number}>((ok,fail)=>{let header='',settled=false;const read=(bytes:Buffer)=>{header=(header+bytes.toString()).slice(-8192);const output=header.indexOf('Output #0, rawvideo');if(output<0)return;const match=/Video:\s*rawvideo[^\n]*?,\s*(\d+)x(\d+)\b/.exec(header.slice(output));if(!match)return;const width=Number(match[1]),height=Number(match[2]);settled=true;decoded.child.stderr.removeListener('data',read);if(!Number.isSafeInteger(width*height*4)||width*height*4>FRAME_LIMIT)fail(Error('Decoded picture exceeds the visual frame limit'));else ok({width,height});};decoded.child.stderr.on('data',read);decoded.child.once('close',()=>{if(!settled)fail(Error('Cannot read decoded picture dimensions'));});}),o.signal,RESPONSE_TIMEOUT,'Visual decoder startup');void dimensions.catch(()=>{});
   return{layer,decoded,reader:new ExactReader(decoded.child.stdout,FRAME_LIMIT),dimensions};
  });
  const encoder=launch(o.ffmpeg,['-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgba','-s',`${o.width}x${o.height}`,'-r',String(o.fps),'-i','pipe:0','-an','-frames:v',String(o.frames),'-c:v','libx264','-preset',o.quality==='high'?'slow':'veryfast','-crf',o.quality==='draft'?'28':o.quality==='high'?'18':'22','-pix_fmt','yuv420p','-movflags','+faststart',o.output]);encoder.child.stdout.resume();
  let lastProgress=Date.now();
  for(let frame=0;frame<o.frames;frame++){
   await command({command:'begin'});
   for(const source of sources){const dimensions=source.dimensions?await source.dimensions:undefined,data=source.reader?await awaitVisualOperation(source.reader.read(dimensions!.width*dimensions!.height*4),o.signal,RESPONSE_TIMEOUT,'Visual decoder frame'):undefined;await command({command:'layer',clip:source.layer.clip,frame:o.from-source.layer.clip.from+frame,fps:o.fps,text:source.layer.text,width:dimensions?.width,height:dimensions?.height},data);}
   const pixels=await command({command:'end'});if(pixels.length!==o.width*o.height*4)throw Error('Visual renderer returned a malformed frame');await awaitVisualOperation(writable(encoder.child.stdin,pixels),o.signal,RESPONSE_TIMEOUT,'Visual encoder frame');
   if(o.onProgress&&(Date.now()-lastProgress>=500||frame===o.frames-1)){await o.onProgress(frame+1);lastProgress=Date.now();}
  }
  encoder.child.stdin.end();worker.child.stdin.end();await awaitVisualOperation(Promise.all([encoder.done,worker.done,...sources.flatMap(s=>s.decoded?[s.decoded.done]:[])]),o.signal,RESPONSE_TIMEOUT,'Visual process completion');
 }finally{o.signal.removeEventListener('abort',abort);abort();await Promise.race([Promise.allSettled(completions),new Promise<void>(ok=>{const timer=setTimeout(ok,4000);timer.unref();void Promise.allSettled(completions).then(()=>clearTimeout(timer));})]);}
}
