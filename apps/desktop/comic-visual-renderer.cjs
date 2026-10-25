'use strict';
// Isolated rendering component: no user session, network, arbitrary URL or file input.
const {app,BrowserWindow,ipcMain,session}=require('electron');
const {join,resolve}=require('node:path');const {pathToFileURL}=require('node:url');
const root=process.env.NEXTMUX_COMIC_RENDER_ROOT;
if(!root||!require('node:fs').statSync(root).isDirectory())process.exit(2);
app.setPath('userData',join(root,'gpu-profile'));app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
let win,inflight=false,closed=false,stdinEnded=false;
const MAX_BYTES=134217728,MAX_META=8388608;
function die(message){if(closed)return;closed=true;process.stderr.write(String(message).slice(0,2048)+'\n');app.exit(1);}
const write=bytes=>new Promise((ok,fail)=>process.stdout.write(bytes,error=>error?fail(error):ok()));
async function response(bytes,error){if(!inflight)return die('Unexpected visual worker response');const detail=Buffer.from(JSON.stringify({ok:!error,...(error?{error:String(error).slice(0,2048)}:{})})),data=Buffer.from(bytes||[]),header=Buffer.alloc(8);header.writeUInt32BE(detail.length);header.writeUInt32BE(data.length,4);try{await write(header);await write(detail);if(data.length)await write(data);inflight=false;nextResolve?.();nextResolve=undefined;}catch(e){die(e);}}
let nextResolve;
const next=()=>new Promise(resolve=>{nextResolve=resolve;});
async function consume(){let chunks=[],length=0;const iterator=process.stdin[Symbol.asyncIterator]();
 async function read(n){while(length<n){const item=await iterator.next();if(item.done){if(!length&&n===8)return null;throw Error('Truncated visual request');}chunks.push(item.value);length+=item.value.length;if(length>MAX_BYTES+MAX_META+8)throw Error('Visual pipe buffer limit');}const all=chunks.length===1?chunks[0]:Buffer.concat(chunks,length),out=all.subarray(0,n);chunks=length>n?[all.subarray(n)]:[];length-=n;return out;}
 while(!closed){const header=await read(8);if(!header)break;const m=header.readUInt32BE(),size=header.readUInt32BE(4);if(m>MAX_META||size>MAX_BYTES)throw Error('Visual request limit');const meta=JSON.parse((await read(m)).toString()),bytes=size?await read(size):Buffer.alloc(0);inflight=true;if(stdinEnded){closed=true;app.exit(0);return;}const done=next();win.webContents.send('comic-visual-command',meta,bytes);await done;}closed=true;app.quit();
}
app.whenReady().then(async()=>{
 app.dock?.hide();
 const own=session.fromPartition('comic-visual-isolated');own.setPermissionRequestHandler((_w,_p,callback)=>callback(false));own.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith('file:')}));
 win=new BrowserWindow({show:false,width:32,height:32,webPreferences:{session:own,preload:join(__dirname,'comic-visual-renderer-preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false}});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());win.webContents.on('render-process-gone',()=>die('Visual renderer process exited'));
 ipcMain.on('comic-visual-result',(event,bytes,error)=>{if(event.sender===win.webContents)void response(bytes,error);});
 ipcMain.once('comic-visual-ready',()=>{void consume().catch(die);});
 const page=resolve(process.env.NEXTMUX_COMIC_RENDER_PAGE||join(__dirname,'build-resources/comic-visual-renderer/index.html'));
 await win.loadURL(pathToFileURL(page).href);
}).catch(die);
// EOF while a GPU command is pending means the owning backend has gone away.
// Normal completion closes stdin only after the last acknowledgement.
process.stdin.on('end',()=>{stdinEnded=true;if(inflight&&!closed){closed=true;app.exit(0);}});
process.stdin.on('error',die);
process.on('SIGTERM',()=>{closed=true;app.exit(0);});process.on('uncaughtException',die);process.on('unhandledRejection',die);
