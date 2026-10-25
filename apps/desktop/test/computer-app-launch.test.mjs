import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const {ComputerAutomation}=createRequire(import.meta.url)('../computer-automation.cjs');
const missing=()=>Object.assign(new Error('missing'),{code:'app_not_running'});
const request=(selector,id=crypto.randomUUID())=>({id,conversationId:'qa',expiresAt:Date.now()+10000,action:'openApp',input:{selector}});
async function fixture(t,options={}){const root=await mkdtemp(join(tmpdir(),'nextmux-app-launch-'));const app=join(root,'QA Fixture.app');await mkdir(app);const engine=new ComputerAutomation({platform:'darwin',sdkLoader:async()=>({create:async()=>options.client}),launchMacApp:options.launch});t.after(async()=>{await engine.dispose();await rm(root,{recursive:true,force:true});});return{engine,app};}
test('cold explicit .app uses LaunchServices once then discovers; repeated request does not relaunch',async t=>{let launched=0,reads=0;const f=await fixture(t,{launch:async(path,signal)=>{assert.match(path,/QA Fixture.app$/);assert.equal(signal.aborted,false);launched++;},client:{getApp:async()=>{if(++reads<3)throw missing();return{getState:async()=>({app:'QA',text:'ready'})};},close:async()=>{}}});const r=request(f.app);assert.equal((await f.engine.run(r,1)).ok,true);assert.equal((await f.engine.run(r,1)).ok,true);assert.equal(launched,1);assert.equal(reads,3);});
test('discovered stopped app retains SDK launch path; no fallback after uncertain getState',async t=>{let launched=0,observed=0;const f=await fixture(t,{launch:async()=>launched++,client:{getApp:async()=>({getState:async()=>{observed++;throw missing();}}),close:async()=>{}}});assert.equal((await f.engine.run(request(f.app),1)).ok,false);assert.equal(launched,0);assert.equal(observed,1);});
test('names, bundle IDs, nonexistent paths, and ambiguous discovery cannot invoke path launcher',async t=>{let launched=0;const f=await fixture(t,{launch:async()=>launched++,client:{getApp:async()=>{throw missing();},close:async()=>{}}});for(const s of ['Calculator','com.example.qa','/no/qa.app',f.app+'/Contents'])assert.equal((await f.engine.run(request(s),1)).ok,false);assert.equal(launched,0);});
test('unknown launch completion is never retried, including same request id',async t=>{let launched=0;const f=await fixture(t,{launch:async()=>{launched++;throw Object.assign(Error('unknown'),{code:'launch_unknown'});},client:{getApp:async()=>{throw missing();},close:async()=>{}}});const r=request(f.app);assert.equal((await f.engine.run(r,1)).error,'launch_unknown');assert.equal((await f.engine.run(r,1)).error,'computer_request_already_dispatched');assert.equal(launched,1);});
