import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {restoreManagedRecoveredTools} from '../lib/node/nextmux-recovered-tool-names.js';
const hash=s=>createHash('sha256').update(s).digest('hex');
test('original local tool list reverses readable and colliding aliases without adding or executing calls',()=>{
 const request={tools:[{name:'workspace.read_file'},{name:'workspace_read_file'},{name:'资源检索'}],messages:[]};
 const result={recovery:{source:'provider_resource'},response:{content:'',toolCalls:[{id:'a',name:`nmx_${hash('workspace.read_file').slice(0,12)}_workspace_read_file`,arguments:{path:'a'}},{id:'b',name:'workspace_read_file',arguments:{}},{id:'c',name:`nmx_${hash('资源检索').slice(0,12)}_tool`,arguments:{}}]}};
 const decoded=restoreManagedRecoveredTools(result,request);assert.deepEqual(decoded.response.toolCalls.map(c=>c.name),request.tools.map(t=>t.name));assert.deepEqual(decoded.response.toolCalls.map(c=>c.id),['a','b','c']);assert.equal(decoded.response.toolCalls[0].arguments.path,'a');
});
test('ordinary live result is not decoded twice, and unknown aliases remain for runtime validation',()=>{
 const result={response:{toolCalls:[{name:'workspace_read_file'}]}};assert.equal(restoreManagedRecoveredTools(result,{tools:[{name:'workspace.read_file'}],messages:[]}),result);
 const recovered={...result,recovery:{source:'provider_resource'}};assert.equal(restoreManagedRecoveredTools(recovered,{tools:[],messages:[]}).response.toolCalls[0].name,'workspace_read_file');
});
