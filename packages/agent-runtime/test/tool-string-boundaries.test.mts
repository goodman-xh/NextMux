import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,realpath,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test,{type TestContext} from 'node:test';
import {AgentRunner,AgentToolRegistry,WorkspaceToolRuntime,parseTextToolCalls,textToolCallHoldback} from '../lib/index.js';
import {toolCallArguments} from '../lib/tool-arguments.js';

const write={name:'workspace.write_file',inputSchema:{type:'object',properties:{path:{type:'string'},content:{type:'string'},expectedSha256:{type:'string'}}}};
const processWrite={name:'process.write',inputSchema:{type:'object',properties:{processId:{type:'string'},data:{type:'string'}}}};
const types={name:'test.typed',inputSchema:{type:'object',properties:{array:{type:'array'},object:{type:'object'},bool:{type:'boolean'},integer:{type:'integer'},number:{type:'number'},nullable:{type:'null'},stringOrNull:{type:['string','null']}}}};
const offered=[write,processWrite,types];
const qwen=(value:string)=>`<function=workspace_write_file><parameter=path>owned.txt</parameter><parameter=content>${value}</parameter></function>`;
const invoke=(value:string,ns='')=>`<${ns}function_calls><${ns}invoke name="workspace_write_file"><${ns}parameter name="path">owned.txt</${ns}parameter><${ns}parameter name="content">${value}</${ns}parameter></${ns}invoke></${ns}function_calls>`;
const strings=['',' ','  x  ','\n','\nx','x\n','\nx\n','\n\nx\n\n','\r\n  x\r\n','一行\n第二行\n','literal\\n','\t x\t','\r','\r\n'];

test('XML strings preserve exact empty/space/LF/CRLF/Unicode boundaries in qwen and namespaced invoke forms',()=>{
  for(const value of strings)for(const xml of [qwen(value),invoke(value),invoke(value,'antml:')]){
    const call=parseTextToolCalls(xml,offered)?.calls[0];assert.ok(call,JSON.stringify(value));
    assert.equal(call.arguments.content,value);assert.equal(Buffer.from(String(call.arguments.content)).toString('hex'),Buffer.from(value).toString('hex'));
  }
  const noSchema=[{name:'test.raw'}];
  assert.equal(parseTextToolCalls('<function=test.raw><parameter=data>\n raw \n</parameter></function>',noSchema)?.calls[0].arguments.data,'\n raw \n');
});

test('wrapper/antml-looking markup within XML or JSON parameter data is never structurally replaced',()=>{
  for(const value of ['<function_calls>x</function_calls>','<antml:note>\ntext\r\n</antml:note>','<antml:function_calls>data</antml:function_calls>','<|tool_calls_section_begin|>x<|tool_calls_section_end|>','<｜tool▁calls▁begin｜>x<｜tool▁calls▁end｜>']) {
    for(const xml of [qwen(value),invoke(value,'antml:')])assert.equal(parseTextToolCalls(xml,offered)?.calls[0].arguments.content,value);
    const json=JSON.stringify({name:'workspace_write_file',arguments:{path:'owned.txt',content:value}});
    assert.equal(parseTextToolCalls(`<tool_call>${json}</tool_call>`,offered)?.calls[0].arguments.content,value);
    assert.equal(parseTextToolCalls(json,offered)?.calls[0].arguments.content,value);
  }
});

test('typed non-string JSON keeps existing whitespace tolerance while string unions remain literal',()=>{
  const values={array:[1,' x\n'],object:{x:'\r\n'},bool:false,integer:12,number:1.5,nullable:null};
  const xml='<function=test.typed>'+Object.entries(values).map(([key,value])=>`<parameter=${key}>\n ${JSON.stringify(value)} \n</parameter>`).join('')+'<parameter=stringOrNull>\nnull\n</parameter></function>';
  assert.deepEqual(parseTextToolCalls(xml,offered)?.calls[0].arguments,{...values,stringOrNull:'\nnull\n'});
});

test('native and text JSON preserve strings without adding or dropping whitespace or markup',()=>{
  for(const content of [...strings,'<function_calls>x</function_calls><antml:note>']) {
    const args={path:'owned.txt',content};
    assert.deepEqual(toolCallArguments(args),args);assert.deepEqual(toolCallArguments(JSON.stringify(args)),args);
    assert.deepEqual(parseTextToolCalls(JSON.stringify({name:write.name,arguments:args}),offered)?.calls[0].arguments,args);
  }
});

test('ambiguous XML closing delimiters and duplicate parameter keys reject the whole call',()=>{
  for(const xml of [qwen('prefix</parameter><parameter=content>suffix'),qwen('prefix</parameter>suffix'),qwen('prefix</function>suffix'),invoke('prefix</antml:invoke>suffix','antml:'),'<function=workspace_write_file><parameter=path>a</parameter><parameter=path>b</parameter><parameter=content>x</parameter></function>']) {
    assert.equal(parseTextToolCalls(xml,offered),undefined,xml);
  }
});

test('XML special object keys remain own enumerable data without changing the argument prototype',()=>{
  const schema={name:'test.keys',inputSchema:JSON.parse('{"type":"object","properties":{"__proto__":{"type":"object"},"constructor":{"type":"string"}}}')};
  const xml='<function=test.keys><parameter=__proto__>{"safe":1}</parameter><parameter=constructor>\n literal \n</parameter></function>';
  const args=parseTextToolCalls(xml,[schema])?.calls[0].arguments;assert.ok(args);
  assert.equal(Object.getPrototypeOf(args),Object.prototype);assert.deepEqual(Object.keys(args),['__proto__','constructor']);
  assert.deepEqual(Object.getOwnPropertyDescriptor(args,'__proto__')?.value,{safe:1});assert.equal(args.constructor,'\n literal \n');
  assert.equal(JSON.stringify(args),'{"__proto__":{"safe":1},"constructor":"\\n literal \\n"}');
});

test('offered tools, no-prose rules, streaming holdback and 64k/16-call ceilings remain strict',()=>{
  const single=qwen('x');
  for(const xml of [single+' Ordinary trailing prose.',single.replace('workspace_write_file','unknown_tool'),'x'.repeat(64001),single.repeat(17)])assert.equal(parseTextToolCalls(xml,offered),undefined);
  assert.equal(parseTextToolCalls(single,[]),undefined);
  assert.equal(parseTextToolCalls('<function_calls>'+single.repeat(16)+'</function_calls>',offered)?.calls.length,16);
  const two=JSON.stringify([{name:write.name,arguments:{path:'a',content:'x'}},{name:write.name,arguments:{path:'b',content:'x'}}]);
  assert.equal(parseTextToolCalls(single.repeat(15)+`<tool_call>${two}</tool_call>`,offered),undefined,'a batched JSON block cannot bypass the global total');
  assert.equal(textToolCallHoldback('I will act.\n<antml:inv',offered),'I will act.\n'.length);
  assert.equal(textToolCallHoldback('Ordinary text',offered),'Ordinary text'.length);
});

async function workspace(t:TestContext){
  const root=await realpath(await mkdtemp(join(tmpdir(),'nextmux-r14-string-')));const dir=join(root,'workspace');await mkdir(dir);
  const runtime=await WorkspaceToolRuntime.create({workspaceRoot:dir,checkpointRoot:join(root,'checkpoints'),permissionMode:'full_access'});
  const registry=new AgentToolRegistry();runtime.registerTools(registry);
  t.after(async()=>{await runtime.dispose();await rm(root,{recursive:true,force:true});});return{dir,runtime,registry};
}

test('actual runner text fallback writes one owned file with exact LF/markup bytes and no extra verification round',async t=>{
  const {dir,registry}=await workspace(t),before='baseline\n',content='\nR14 changed once\r\n<function_calls>x</function_calls>\n';
  await writeFile(join(dir,'owned.txt'),before);const expected=createHash('sha256').update(before).digest('hex');let models=0;
  const xml=qwen(content).replace('</function>',`<parameter=expectedSha256>${expected}</parameter></function>`);
  const result=await new AgentRunner({tools:registry,permissionMode:'full_access',captureCheckpoint:true,model:{async complete(request){
    if(++models===1){for(const delta of [xml.slice(0,31),xml.slice(31)])await request.onTextDelta?.(delta);return{content:xml,usage:{inputTokens:1,outputTokens:1}};}
    assert.equal(models,2);return{content:'The single write succeeded; no extra checks.',usage:{inputTokens:1,outputTokens:1}};
  }}}).run({prompt:'Write this owned file once, preserving every byte; stop without checks.',runId:'run-r14-file-boundaries-001'});
  assert.equal(models,2);assert.equal(result.toolCalls,1);assert.equal(result.verification?.status,'unverified');
  assert.deepEqual(await readFile(join(dir,'owned.txt')),Buffer.from(content));
  const completed=result.events.filter(e=>e.type==='tool_completed');assert.equal(completed.length,1);assert.equal(completed[0].ok,true);
});

test('actual process.write receives the XML data as exact stdin bytes, including CR/LF',async t=>{
  const {registry}=await workspace(t),runId='run-r14-process-data-001',data='\r\n  中文\n';
  const script=`const chunks=[];let size=0;process.stdin.on('data',b=>{chunks.push(b);size+=b.length;if(size>=${Buffer.byteLength(data)}){process.stdout.write(JSON.stringify({hex:Buffer.concat(chunks).toString('hex')}),()=>process.exit(0))}});`;
  const start=await registry.execute({id:'start-owned',name:'process.start',arguments:{command:process.execPath,args:['-e',script],tty:false,pipeStdin:true,timeoutMs:5000}},'full_access',{runId});
  assert.equal(start.ok,true,start.error?.message);const processId=(start.output as {processId:string}).processId;
  const xml=`<function=process_write><parameter=processId>${processId}</parameter><parameter=data>${data}</parameter></function>`;
  const call=parseTextToolCalls(xml,registry.descriptors('full_access'))?.calls[0];assert.ok(call);
  const written=await registry.execute({id:'write-owned',...call},'full_access',{runId});
  assert.equal(written.ok,true,written.error?.message);assert.equal((written.output as {accepted:number}).accepted,data.length);
  let output='',done=false,afterSequence=0;
  for(let n=0;n<10&&!done;n++){
    const read=await registry.execute({id:`read-${n}`,name:'process.read',arguments:{processId,afterSequence,waitMs:500}},'full_access',{runId});
    assert.equal(read.ok,true,read.error?.message);const value=read.output as {running:boolean;nextSequence:number;hasMore:boolean;chunks:{stream:string;text:string}[];exitCode?:number};
    output+=value.chunks.filter(c=>c.stream==='stdout').map(c=>c.text).join('');afterSequence=value.nextSequence;
    done=!value.running&&!value.hasMore;if(done)assert.equal(value.exitCode,0);
  }
  assert.equal(done,true);assert.equal(JSON.parse(output).hex,Buffer.from(data).toString('hex'));
});
