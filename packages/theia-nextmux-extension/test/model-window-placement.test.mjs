import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {findConversationTabByTarget,tabWindows} from '../lib/browser/nextmux-conversation-tabs.js';
const require=createRequire(import.meta.url),ts=require('typescript');
const original=readFileSync(new URL('../src/browser/nextmux-desktop-widget.tsx',import.meta.url),'utf8');
const sf=ts.createSourceFile('widget.tsx',original,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const cls=sf.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='NextMuxDesktopWidget');
const method=name=>cls.members.find(n=>ts.isMethodDeclaration(n)&&n.name.getText(sf)===name).getText(sf);
function fixture(reply={ok:true,placement:'desktop'}) {
 const calls=[],synced=[],announced=[];let humanCalls=0;
 const bridge={async placeComputerWindow(...args){calls.push(args);return reply}};
 const W=Function('window','visualTabsFor','tabWindowText','findConversationTabByTarget','tabWindows',ts.transpile(`class W{${method('handleTabToolRequest')}};return W;`,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}))({nextmuxDesktop:bridge},(s,id)=>s[id]||[],(_l,k)=>k,findConversationTabByTarget,tabWindows);
 const w=new W();Object.assign(w,{loadConversationTabs(){},codingSessions:[{id:'c'}],desktopLocale:'en',detachedComputerTabs:new Set(),
  conversationTabs:{c:[{id:'window:1:11',title:'Target',status:'connected',windowRef:{pid:1,windowId:11}}]},
  computerWindowStateSync:new Map([['c:1:11',state=>synced.push(state)],['c:2:22',()=>{throw Error('wrong target sync')}]]),
  announceTab(...args){announced.push(args)},conversationWindowControls(){return{canPark:true,async place(){humanCalls++;throw Error('model must not activate human placement control')}}}});
 return {w,calls,synced,announced,get humanCalls(){return humanCalls}};
}
for(const placement of ['desktop','tab']) test(`model placement ${placement} preserves exact target without foreground activation`,async()=>{
 const f=fixture({ok:true,placement});const result=await f.w.handleTabToolRequest({id:'p',conversationId:'c',action:'tabSet',input:{tabId:'window:1:11',placement}},'win32');
 assert.equal(result.ok,true);assert.deepEqual(f.calls,[['c',1,11,placement,false]]);assert.deepEqual(f.synced,[{placement}]);assert.equal(f.humanCalls,0);assert.equal(f.announced.length,1);
});
for(const reply of [{ok:false,error:'window_not_found'},null]) test(`failed or missing placement response is not reported successful: ${reply?'failure':'missing'}`,async()=>{
 const f=fixture(reply);const result=await f.w.handleTabToolRequest({id:'p',conversationId:'c',action:'tabSet',input:{tabId:'window:1:11',placement:'desktop'}},'win32');
 assert.equal(result.ok,false);assert.equal(f.synced.length,0);assert.equal(f.announced.length,0);assert.equal(f.humanCalls,0);
});
test('explicit user placement control retains activation only for desktop',async()=>{
 const calls=[];const bridge={startComputerWindowView(){},computerWindowSnapshot(){},async placeComputerWindow(...args){calls.push(args);return{ok:true,placement:args[3]}}};
 const W=Function('window','navigator','visualTabsFor','tabWindows',ts.transpile(`class W{${method('conversationWindowControls')}};return W;`,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}))({nextmuxDesktop:bridge},{mediaDevices:{}},(s,id)=>s?.[id]||[],tabWindows);
 const w=new W();Object.assign(w,{loadConversationTabs(){},computerViewCapability:{park:false},computerWindowControls:new Map(),computerWindowStateSync:new Map(),
  computerTabSoundPreferences:new Map(),computerWindowSoundPreferences:new Map(),computerWindowVisibility:new Map(),computerWindowSoundQueues:new Map(),
  computerViewArmQueue:Promise.resolve()});
 const controls=w.conversationWindowControls('c',{windowRef:{pid:1,windowId:11}});assert.ok(controls);
 assert.equal(await controls.place('desktop'),'desktop');assert.equal(await controls.place('tab'),'tab');
 assert.deepEqual(calls,[['c',1,11,'desktop',true],['c',1,11,'tab',false]]);
});
