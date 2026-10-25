import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { runInDisposableAttachmentFileDesktop, connectToNextMuxWorkbench } from './desktop-attachment-file-e2e-harness.mjs';
import { ensureExactOfficialQaRoute, officialQaRouteConfig } from './desktop-official-qa-route.mjs';
import { reloadDesktopDocument } from './desktop-cdp-reload.mjs';
if (await runInDisposableAttachmentFileDesktop(import.meta.url, { label: 'conversation windows', withQaRoute: true, qaDelayMs: 600 })) process.exit(0);
const port = process.env.NEXTMUX_CDP_PORT;
const parent = await connectToNextMuxWorkbench(port);
const clients = [parent];
const wait = async (probe, test, label) => { const until = Date.now()+45000; while(Date.now()<until) { const value=await probe(); if(test(value))return value; await new Promise(r=>setTimeout(r,200)); } throw Error('Timeout: '+label+' '+JSON.stringify(await probe())); };
async function connect(target) {
 const socket=new WebSocket(target.webSocketDebuggerUrl); await new Promise(r=>socket.addEventListener('open',r,{once:true})); let n=0;const pending=new Map();
 socket.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++n;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description);return r.result?.value;};
 const client={socket,call,evaluate};clients.push(client);return client;
}
try {
 const qaRoute = await ensureExactOfficialQaRoute({evaluate: parent.evaluate, config: officialQaRouteConfig()});
 await parent.evaluate(`(() => { const now=Date.now(); const sessions=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'].map((id,i)=>({id,title:'独立窗口 '+(i+1),workspacePath:'',createdAt:now,updatedAt:now-i,browsers:[],permissionMode:'full_access',reasoningEffort:'medium',relayKey:${JSON.stringify(qaRoute.relayKey)},modelId:${JSON.stringify(qaRoute.modelId)},routeId:${JSON.stringify(qaRoute.routeId)},followUpQueue:[],draftPrompt:'草稿 '+(i+1),turns:[{id:id+'-turn',prompt:'你好',response:'测试历史消息',stage:'complete',createdAt:now-1000,completedAt:now,permissionMode:'full_access',routeLabel:'QA',error:''}]})); localStorage.setItem('nextmux.desktop.codingSessions.v1',JSON.stringify(sessions));localStorage.setItem('nextmux.desktop.restoreState.v1',JSON.stringify({version:1,section:'coding',workspace:'',codingPanel:'thread',activeCodingSessionId:'11111111-1111-4111-8111-111111111111',newConversation:false,settingsPanel:'profile',billingTab:'usage',modelCenterView:'all',modelCapabilityFilter:'all',comicView:'storyboard'})); })()`);
 await reloadDesktopDocument({...parent,ignoreCache:true});
 await wait(()=>parent.evaluate(`window.nextmuxDesktop.getConversationWindowState()`),s=>s.sessions?.some(x=>x.id==='11111111-1111-4111-8111-111111111111') && s.sessions?.some(x=>x.id==='22222222-2222-4222-8222-222222222222'),'history restored');
 const geometry=()=>parent.evaluate(`(() => { const w=document.querySelector('#nmx-workspace').getBoundingClientRect();const n=document.querySelector('.nmx-titlebar-primary-nav').getBoundingClientRect();const c=document.querySelector('.nmx-titlebar-context')?.getBoundingClientRect(); return {center:w.x+w.width/2,nav:n.x+n.width/2,navY:n.y,contextY:c?.y}; })()`);
 await new Promise(r=>setTimeout(r,600));let g=await geometry();assert.ok(Math.abs(g.center-g.nav)<2,JSON.stringify(g));
 await parent.evaluate(`document.querySelector('[aria-label="打开右侧面板"]').click()`);
 await wait(geometry,g=>g.contextY!==undefined,'drawer');await new Promise(r=>setTimeout(r,240));g=await geometry();assert.ok(Math.abs(g.center-g.nav)<2,JSON.stringify(g));assert.ok(Math.abs(g.navY-g.contextY)<2);
 const drawer = await parent.evaluate(`(() => {const h=document.querySelector('.nmx-titlebar-context'),t=h.querySelector('nav'),c=h.querySelector('.nmx-titlebar-context-close'); return {extra:!!document.querySelector('.nmx-browser-open-agents'),drag:getComputedStyle(h).webkitAppRegion,gap:c.getBoundingClientRect().x-t.getBoundingClientRect().right,tabs:getComputedStyle(t).webkitAppRegion}; })()`);
 assert.equal(drawer.extra,false);assert.equal(drawer.drag,'drag');assert.equal(drawer.tabs,'no-drag');assert.ok(drawer.gap>=40,JSON.stringify(drawer));
 assert.equal(await parent.evaluate(`!!document.querySelector('[data-conversation-window-menu]')`),false);
 await parent.evaluate(`window.__windowMotions=[];window.__windowFlights=[];window.nextmuxDesktop.onConversationWindowEvent(event=>{if(event.type==='motion')window.__windowMotions.push(event.motion.kind);});new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.classList?.contains('nmx-conversation-window-flight'))window.__windowFlights.push({animations:node.getAnimations().length});}).observe(document.body,{childList:true,subtree:true});`);
 assert.equal(await parent.evaluate(`window.nextmuxDesktop.openConversationWindows(['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'])`),true);
 const targets=await wait(async()=>await(await fetch('http://127.0.0.1:'+port+'/json/list')).json(),v=>v.filter(t=>t.url.includes('nextmuxConversation=')).length===2,'two native windows');
 const a=await connect(targets.find(t=>t.url.includes('nextmuxConversation=11111111-1111-4111-8111-111111111111'))),b=await connect(targets.find(t=>t.url.includes('nextmuxConversation=22222222-2222-4222-8222-222222222222')));
 console.log('native windows', await a.evaluate(`({width:innerWidth,height:innerHeight,x:screenX,y:screenY})`), await b.evaluate(`({width:innerWidth,height:innerHeight,x:screenX,y:screenY})`));
 await wait(()=>parent.evaluate(`!!document.querySelector('[data-conversation-window-menu]')`),Boolean,'return control visible');
 assert.ok((await parent.evaluate(`window.__windowMotions`)).includes('detach'));
 await wait(()=>parent.evaluate(`window.__windowFlights`),v=>v.some(f=>f.animations>0),'detach cue really animates');
 await parent.evaluate(`window.nextmuxDesktop.closeDesktopWindow()`);
 await wait(()=>parent.evaluate(`document.visibilityState`),state=>state==='hidden','primary hidden while children stay open');
 assert.equal(await b.evaluate(`window.nextmuxDesktop.showMainWindow()`),true);
 await wait(()=>parent.evaluate(`document.visibilityState`),state=>state==='visible','same menu-bar action restores primary');
 for(const [client,draft] of [[a,'草稿 1'],[b,'草稿 2']]) {
  await wait(()=>client.evaluate(`({shell:!!document.querySelector('.is-detached-conversation'),draft:document.querySelector('.nmx-composer textarea')?.value})`),v=>v.shell&&v.draft===draft,'complete composer '+draft);
  assert.ok(await client.evaluate(`innerWidth <= 420 && innerHeight <= 560 && innerWidth < innerHeight`), 'tile must be compact portrait');
  assert.equal(await client.evaluate(`getComputedStyle(document.querySelector('.nmx-titlebar-primary-nav')).display`),'none');
  assert.equal(await client.evaluate(`!!document.querySelector('.nmx-composer') && !!document.querySelector('.nmx-route-button')`),true);
 }
 // Real input event follows the same controlled textarea path as typing.
 await a.evaluate(`(() => { const e=document.querySelector('.nmx-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'窗口 A 保存的草稿');e.dispatchEvent(new Event('input',{bubbles:true})); })()`);
 await wait(()=>parent.evaluate(`window.nextmuxDesktop.getConversationWindowState()`),s=>s.sessions.find(x=>x.id==='11111111-1111-4111-8111-111111111111')?.draftPrompt==='窗口 A 保存的草稿','draft synchronized');
 assert.equal(await b.evaluate(`document.querySelector('.nmx-composer textarea').value`),'草稿 2');
 await a.evaluate(`window.nextmuxDesktop.publishConversationWindows([{id:'11111111-1111-4111-8111-111111111111',set:{modelId:'model-a',relayKey:'relay-a'},unset:[]}])`);
 const state=await parent.evaluate(`window.nextmuxDesktop.getConversationWindowState()`);assert.equal(state.sessions.find(x=>x.id==='11111111-1111-4111-8111-111111111111').modelId,'model-a');assert.equal(state.sessions.find(x=>x.id==='22222222-2222-4222-8222-222222222222').modelId,qaRoute.modelId);
 await parent.evaluate(`window.nextmuxDesktop.focusConversationWindow('11111111-1111-4111-8111-111111111111')`);
 await a.call('Input.dispatchKeyEvent',{type:'keyDown',key:'w',code:'KeyW',modifiers:process.platform==='darwin'?4:2});
 await wait(()=>parent.evaluate(`window.nextmuxDesktop.getConversationWindowState()`),s=>!s.windows.some(x=>x.sessionId==='11111111-1111-4111-8111-111111111111'),'close saved and released');
 a.socket.close();
 assert.equal(await parent.evaluate(`document.querySelector('.nmx-composer textarea')?.value`),'窗口 A 保存的草稿');
 // Exercise the full local API/agent path from the detached composer twice.
 for (const text of ['独立窗口发送验收', '独立窗口连续对话验收']) {
  await wait(()=>parent.evaluate(`window.nextmuxDesktop.getConversationWindowState()`),s=>!s.windows.some(x=>x.sessionId==='22222222-2222-4222-8222-222222222222' && x.running),'agent settled');
  await new Promise(r=>setTimeout(r,150));
  await b.call('Page.bringToFront');
  await b.evaluate(`(() => {const e=document.querySelector('.nmx-composer textarea');e.focus();e.select();})()`);
  await b.call('Input.insertText', {text});
  await wait(()=>b.evaluate(`!document.querySelector('.nmx-send-button').disabled`),Boolean,'send enabled');
  const send = await b.evaluate(`(() => { const r=document.querySelector('.nmx-send-button').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
  await b.call('Input.dispatchMouseEvent', {type:'mousePressed',...send,button:'left',clickCount:1});
  await b.call('Input.dispatchMouseEvent', {type:'mouseReleased',...send,button:'left',clickCount:1});
  await wait(()=>parent.evaluate(`window.nextmuxDesktop.getConversationWindowState()`),s=>s.sessions.find(x=>x.id==='22222222-2222-4222-8222-222222222222')?.turns.some(t=>t.prompt===text && t.stage==='complete'),'API response '+text);
 }
 const shot=await b.call('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/nextmux-independent-window.png',Buffer.from(shot.data,'base64'));
 // Closing a running conversation hides its UI while its current and queued work finish.
 await b.evaluate(`(() => { const e=document.querySelector('.nmx-composer textarea');e.focus();e.select(); })()`);
 await b.call('Input.insertText', {text:'关闭窗口后台运行验收'});
 await b.call('Input.dispatchKeyEvent', {type:'keyDown',key:'Enter',code:'Enter'});
 await b.call('Input.dispatchKeyEvent', {type:'keyUp',key:'Enter',code:'Enter'});
 await wait(()=>parent.evaluate(`window.nextmuxDesktop.getConversationWindowState()`),s=>s.windows.some(x=>x.sessionId==='22222222-2222-4222-8222-222222222222'&&x.running),'running before close');
 await b.call('Input.insertText', {text:'关闭窗口队列继续验收'});
 await b.call('Input.dispatchKeyEvent', {type:'keyDown',key:'Enter',code:'Enter'});
 await b.call('Input.dispatchKeyEvent', {type:'keyUp',key:'Enter',code:'Enter'});
 await wait(()=>b.evaluate(`!!document.querySelector('[data-running-message-action="queue"]')`),Boolean,'queue choice');
 await b.evaluate(`document.querySelector('[data-running-message-action="queue"]').click()`);
 await wait(()=>parent.evaluate(`window.nextmuxDesktop.getConversationWindowState()`),s=>s.sessions.find(x=>x.id==='22222222-2222-4222-8222-222222222222')?.followUpQueue.length===1,'queued before close');
 await b.evaluate(`window.nextmuxDesktop.closeDesktopWindow()`);
 await wait(()=>parent.evaluate(`window.nextmuxDesktop.getConversationWindowState()`),s=>{
  const session=s.sessions.find(x=>x.id==='22222222-2222-4222-8222-222222222222');
  return ['关闭窗口后台运行验收','关闭窗口队列继续验收'].every(prompt=>session?.turns.some(t=>t.prompt===prompt&&t.stage==='complete'))&&!s.windows.length;
 },'hidden queue completed and saved');
 b.socket.close();
 await wait(()=>parent.evaluate(`!!document.querySelector('[data-conversation-window-menu]')`),visible=>!visible,'return control hidden without small windows');
 await parent.evaluate(`window.nextmuxDesktop.openConversationWindows(['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'])`);
 await wait(()=>parent.evaluate(`!!document.querySelector('[data-conversation-window-menu]')`),Boolean,'return control after reopening');
 await parent.evaluate(`document.querySelector('[data-conversation-window-menu]').click()`);
 await wait(()=>parent.evaluate(`document.querySelector('.nmx-conversation-window-menu [role="menuitem"]')?.textContent`),text=>text?.includes('收回所有小窗'),'translated return menu');
 await new Promise(r=>setTimeout(r,200));
 const menuShot=await parent.call('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/nextmux-return-windows-menu.png',Buffer.from(menuShot.data,'base64'));
 const flightsBeforeReturn=await parent.evaluate(`window.__windowFlights.length`);
 await parent.evaluate(`document.querySelector('.nmx-conversation-window-menu [role="menuitem"]').click()`);
 await wait(()=>parent.evaluate(`window.nextmuxDesktop.getConversationWindowState()`),s=>!s.windows.length,'all children returned and saved');
 assert.ok((await parent.evaluate(`window.__windowMotions`)).includes('reclaim'));
 assert.ok(await parent.evaluate(`window.__windowFlights.length > ${flightsBeforeReturn}`),'reclaim cue really animates');
 await wait(()=>parent.evaluate(`!!document.querySelector('[data-conversation-window-menu]')`),visible=>!visible,'return animation ends');
 console.log(JSON.stringify({ok:true,titlebar:g,drawer,windows:2,composer:true,modelIsolation:true,draftIsolation:true,closeSaved:true,continuedConversation:true,hiddenQueue:true,showMain:true,returnAll:true}));
} catch(error) { for (const client of clients) { if(client.socket.readyState!==1) continue; try { console.error('FAILED UI',await client.evaluate(`({text:document.body.innerText.slice(-2200),input:document.querySelector('.nmx-composer textarea')?.value,send:document.querySelector('.nmx-send-button')?.outerHTML})`)); } catch {} } throw error; } finally {for(const client of clients)client.socket.close();}
