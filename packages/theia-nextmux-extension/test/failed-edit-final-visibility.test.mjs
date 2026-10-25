import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import test from 'node:test';
import { AgentRunner, AgentToolRegistry, AgentToolError } from '../../agent-runtime/lib/index.js';
import { projectConversationStream } from '../lib/browser/nextmux-conversation-stream-model.js';

const require=createRequire(realpathSync(new URL('../lib/browser/nextmux-change-review.js',import.meta.url)));
const originalCss=require.extensions['.css'];
require.extensions['.css']=()=>{};
const {NextMuxChangeReview}=require('./nextmux-change-review.js');
if(originalCss)require.extensions['.css']=originalCss;else delete require.extensions['.css'];
const React=require('react');const coreRequire=createRequire(require.resolve('@theia/core/package.json'));
const {renderToStaticMarkup}=coreRequire('react-dom/server');

// Actual runtime outcome and the existing compiled UI, with a deliberately false model final.
// The authoritative failed operation and unchanged-file warning must remain visible.
test('failed edit rows and all locale unchanged-file warnings survive a model success claim',async()=>{
  const tools=new AgentToolRegistry();let models=0,edits=0;
  tools.register({name:'workspace.write_file',description:'edit',inputSchema:{type:'object'},requiredPermission:'workspace_write',source:'builtin'},async()=>{
    edits++;throw new AgentToolError('PATCH_INVALID','Synthetic rejected edit wrote no bytes');
  });
  const result=await new AgentRunner({tools,permissionMode:'workspace_write',captureCheckpoint:true,model:{async complete(){
    return ++models===1?{toolCalls:[{id:'bad-edit',name:'workspace.write_file',arguments:{path:'notes.txt',content:'changed'}}]}:{content:'Done. All checks passed.'};
  }}}).run({prompt:'Only this requested edit; stop after it.',runId:'run-failed-ui-authority-001'});
  assert.equal(models,2);assert.equal(edits,1);assert.equal(result.status,'completed');
  assert.equal(result.verification.status,'failed');assert.deepEqual(result.verification.failedEdits,['notes.txt']);
  const failure=result.events.find(event=>event.type==='tool_completed');
  assert.equal(failure.ok,false);assert.equal(failure.status,'failed');assert.equal(failure.failure.code,'PATCH_INVALID');
  const events=[...result.events,{type:'assistant_progress',turn:result.turns,origin:'model',content:result.finalText,at:new Date().toISOString()}];
  for(const locale of ['zh-CN','zh-TW','en','ja','ko','es','fr','de','pt-BR','ru','ar','hi']) {
    const projection=projectConversationStream({locale,events,running:false,terminalState:'complete'});
    const row=projection.items.find(item=>item.kind==='row'&&item.tool==='workspace.write_file');
    assert.ok(row,`${locale}: the original failed edit row stays visible`);assert.equal(row.tone,'failed',locale);
    assert.notEqual(row.chip,'Done',locale);assert.notEqual(row.chip,'完成',locale);
    const html=renderToStaticMarkup(React.createElement(NextMuxChangeReview,{locale,changes:[],verification:result.verification,
      restoring:false,blocked:false,isRestored:()=>false,onOpen(){},onRestore(){},onRestoreAll(){}}));
    assert.equal(html,'');
    assert.equal(result.events.some(event=>event.type==='assistant_progress'&&/Runtime verification/.test(event.content??'')),false);
  }
});
