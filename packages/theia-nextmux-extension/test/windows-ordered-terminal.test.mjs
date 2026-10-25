import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { Container, ContainerModule } from '@theia/core/shared/inversify/index.js';
import { ILogger } from '@theia/core/lib/common/logger.js';
import { EnvironmentUtils } from '@theia/core/lib/node/environment-utils.js';
import { TerminalProcess, ProcessManager, MultiRingBuffer } from '@theia/process/lib/node/index.js';
import { ShellProcess, ShellProcessOptions, ShellProcessFactory } from '@theia/terminal/lib/node/shell-process.js';
import { ShellCommandBuilder } from '@theia/process/lib/common/shell-command-builder.js';
import { ManagedProcessRegistry } from '@nextmux/agent-runtime';
import { NextMuxWindowsShellProcess, hasOrderedWindowsTerminalOutput } from '../lib/node/nextmux-windows-shell-process.js';
import { TheiaTerminalProcessRegistry } from '../lib/node/nextmux-theia-terminal-process-registry.js';
const require = createRequire(import.meta.url);
const pty = createRequire(require.resolve('@theia/process/lib/node/terminal-process.js'))('node-pty');
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const envUtils = { mergeProcessEnv: env => ({ PARENT: 'retained', ...env }) };
const shell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const profile = { id:'test', shellPath:shell, shellKind:'powershell', shellArgs:[], label:'Test', source:'system' };
function platform(value) { const d=Object.getOwnPropertyDescriptor(process,'platform');Object.defineProperty(process,'platform',{value,configurable:true});return()=>Object.defineProperty(process,'platform',d); }
function fixture(Type=NextMuxWindowsShellProcess, options={}, throwError=false) {
 const calls=[],writes=[],resizes=[],dataListeners=[]; let exit;
 const native={pid:9913, onData:f=>{dataListeners.push(f);return{dispose(){}};},onExit:f=>{exit=f;return{dispose(){}};},write:x=>writes.push(x),resize:(...x)=>resizes.push(x),kill(){}};
 const previous=pty.spawn;pty.spawn=(...args)=>{calls.push(args);if(throwError)throw Error('Cannot load conpty.dll');return native;};
 const manager=new ProcessManager(logger);let terminal;
 try {terminal=new Type({shell,args:[],strictEnv:true,...options},manager,new MultiRingBuffer({size:65536}),logger,envUtils);}finally{pty.spawn=previous;}
 return {terminal,manager,calls,writes,resizes,native,emit:x=>dataListeners.forEach(f=>f(x)),exit:()=>exit?.({exitCode:0,signal:0})};
}
function registry(f) {return new TheiaTerminalProcessRegistry(f.manager,new ShellCommandBuilder(),f.terminal.id,profile);}
const options={command:'node',args:['--version'],cwd:'C:\\owned',env:{},tty:true,timeoutMs:2000,outputCharacterLimit:20000};

test('Windows constructor retains upstream shell/env/cwd/size behavior and adds only bundled engine',()=>{
 const restore=platform('win32');
 try{for(const opts of [{},{args:'-NoLogo -NoProfile',cols:121,rows:39,env:{X:'x'},strictEnv:false,rootURI:'file:///C:/owned%20dir'},{env:{COLORTERM:'explicit'},strictEnv:true,cols:0,rows:0}]){
  const before=fixture(ShellProcess,opts),after=fixture(NextMuxWindowsShellProcess,opts);
  assert.equal(after.calls.length,1);assert.equal(after.calls[0][2].useConptyDll,true);
  const candidate={...after.calls[0][2]};delete candidate.useConptyDll;
  assert.deepEqual([after.calls[0][0],after.calls[0][1],candidate],before.calls[0]);
  assert.equal(hasOrderedWindowsTerminalOutput(after.terminal),true);assert.ok(after.terminal instanceof TerminalProcess);
  before.exit();after.exit();
 }}finally{restore();}
});

test('POSIX constructor preserves upstream spawn options without a capability claim',()=>{
 const restore=platform('linux');try{const a=fixture(ShellProcess),b=fixture();assert.deepEqual(b.calls,a.calls);assert.equal(hasOrderedWindowsTerminalOutput(b.terminal),false);a.exit();b.exit();}finally{restore();}
});

test('pseudo terminals and failed DLL loads are never trusted or retried with system ConPTY',async()=>{
 const restore=platform('win32');try{
  const failed=fixture(NextMuxWindowsShellProcess,{},true);assert.equal(failed.calls.length,1);assert.equal(failed.calls[0][2].useConptyDll,true);assert.equal(hasOrderedWindowsTerminalOutput(failed.terminal),false);
  const pseudo=fixture(NextMuxWindowsShellProcess,{isPseudo:true});assert.equal(pseudo.calls.length,0);assert.equal(hasOrderedWindowsTerminalOutput(pseudo.terminal),false);
  await new Promise(r=>setImmediate(r));
 }finally{restore();}
});

test('old Windows terminals reject before any write, resize, cwd conversion or lease',async()=>{
 const restore=platform('win32');const f=fixture(ShellProcess);let conversions=0;
 const r=new TheiaTerminalProcessRegistry(f.manager,new ShellCommandBuilder(),f.terminal.id,profile,async()=>{conversions++;return'C:\\owned';});
 try {for(let i=0;i<2;i++)await assert.rejects(r.start(options),e=>e.code==='TERMINAL_OUTPUT_ORDER_UNSUPPORTED');assert.equal(conversions,0);assert.deepEqual(f.writes,[]);assert.deepEqual(f.resizes,[]);}finally{await r.dispose();f.exit();restore();}
});

test('pipe and secret env-overlay branches precede the Windows integrated-terminal gate',async()=>{
 const restore=platform('win32'),f=fixture(ShellProcess),r=registry(f),previous=ManagedProcessRegistry.prototype.start,calls=[];
 ManagedProcessRegistry.prototype.start=async function(o){calls.push(o);return{processId:'pipe-fixture'};};
 try{assert.equal((await r.start({...options,tty:false})).processId,'pipe-fixture');assert.equal((await r.start({...options,envOverlay:{OWN:'scoped'}})).processId,'pipe-fixture');assert.equal(calls.length,2);assert.deepEqual(f.writes,[]);}finally{ManagedProcessRegistry.prototype.start=previous;await r.dispose();f.exit();restore();}
});

test('upstream factory resolves the Windows rebind with named logger, per-call options and shell integration',()=>{
 const restore=platform('win32'),oldSpawn=pty.spawn,calls=[];
 pty.spawn=(...args)=>{calls.push(args);return{pid:9914,onData:()=>({dispose(){}}),onExit:()=>({dispose(){}}),write(){},resize(){},kill(){}};};
 try{
  const c=new Container(),integrationToken=Symbol('injector');let injected=0;
  c.bind(ShellProcess).toSelf().inTransientScope();c.bind(ProcessManager).toConstantValue(new ProcessManager(logger));c.bind(MultiRingBuffer).toDynamicValue(()=>new MultiRingBuffer({size:65536}));c.bind(ILogger).toConstantValue(logger).whenTargetNamed('terminal');c.bind(EnvironmentUtils).toConstantValue(envUtils);
  c.bind(integrationToken).toConstantValue({injectShellIntegration(o){injected++;return{...o,env:{...o.env,INTEGRATION:'yes'}};}});
  const backendText=readFileSync(new URL('../src/node/nextmux-backend-module.ts',import.meta.url),'utf8'),ast=ts.createSourceFile('backend.ts',backendText,ts.ScriptTarget.Latest,true);
  const moduleNode=ast.statements.find(n=>ts.isExportAssignment(n)).expression;
  const compiled=ts.transpileModule(moduleNode.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const ConnectionContainerModule=Symbol('connections'),DiskFileSystemProvider=class{},NextMuxDiskFileSystemProvider=class{};
  const module=new Function('ContainerModule','ConnectionContainerModule','nextmuxConnectionModule','DiskFileSystemProvider','NextMuxDiskFileSystemProvider','ShellProcess','NextMuxWindowsShellProcess',`return ${compiled.replace(/^"use strict";\s*/, '')}`)(ContainerModule,ConnectionContainerModule,{},DiskFileSystemProvider,NextMuxDiskFileSystemProvider,ShellProcess,NextMuxWindowsShellProcess);
  c.load(module);
  const upstream=require.resolve('@theia/terminal/lib/node/terminal-backend-module.js');const source=readFileSync(upstream,'utf8');
  const upstreamAst=ts.createSourceFile('upstream.js',source,ts.ScriptTarget.Latest,true);let factory;
  function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(upstreamAst).endsWith('.toFactory')&&n.arguments[0]?.getText(upstreamAst).includes('ShellProcessOptions'))factory=n.arguments[0].getText(upstreamAst);ts.forEachChild(n,visit);}visit(upstreamAst);assert.ok(factory);
  const actualFactory=new Function('inversify_1','shell_process_1','shell_integration_injector_1',`return (${factory});`)({Container},{ShellProcess,ShellProcessOptions},{ShellIntegrationInjector:integrationToken});
  c.bind(ShellProcessFactory).toFactory(actualFactory);
  const make=c.get(ShellProcessFactory),a=make({shell,args:[],strictEnv:true,cols:111,enableShellIntegration:true}),b=make({shell,args:['-NoProfile'],strictEnv:true,cols:77});
  assert.ok(a instanceof NextMuxWindowsShellProcess);assert.ok(b instanceof NextMuxWindowsShellProcess);assert.notEqual(a,b);assert.equal(injected,1);assert.equal(calls[0][2].env.INTEGRATION,'yes');assert.equal(calls[1][2].env.INTEGRATION,undefined);assert.equal(calls[0][2].cols,111);assert.equal(calls[1][2].cols,77);assert.ok(calls.every(x=>x[2].useConptyDll===true));
 }finally{pty.spawn=oldSpawn;restore();}
});

const nativeWires = JSON.parse(readFileSync(new URL('./fixtures/r13-native-conpty-output.json',import.meta.url),'utf8'));
for (const captured of nativeWires) test(`captured bundled ${captured.shell} output survives split markers, excludes the following prompt and reuses the trusted terminal`,async()=>{
 const restore=platform('win32'),f=fixture(),localProfile={...profile,shellKind:captured.shell};
 const r=new TheiaTerminalProcessRegistry(f.manager,new ShellCommandBuilder(),f.terminal.id,localProfile);
 try{
  for(let round=0;round<2;round++){
   f.native.write=value=>{f.writes.push(value);const id=/NextMuxStart;([0-9a-f-]{36})/.exec(value)?.[1];assert.ok(id);
    const wire=captured.wire.replaceAll(captured.marker,id),startEnd=wire.indexOf('\x07')+1,completion=wire.indexOf('\x1b]777;NextMux;'),finish=wire.indexOf('\x07',completion)+1;
    assert.ok(startEnd>0&&completion>startEnd&&finish>completion);
    setImmediate(()=>{for(let i=0;i<startEnd;i+=7)f.emit(wire.slice(i,Math.min(i+7,startEnd)));f.emit(wire.slice(startEnd,completion));for(let i=completion;i<finish;i+=7)f.emit(wire.slice(i,Math.min(i+7,finish)));f.emit(wire.slice(finish));});
   };
   const session=await r.start(options),result=await session.waitForExit(),text=result.chunks.map(x=>x.text).join('');
   assert.equal(result.exitCode,7);assert.match(text,/NMX_R12_EXIT_7_SECOND/);assert.doesNotMatch(text,/NMX_R12_READY|NextMux|\x1b/);assert.equal(f.terminal.pid,9913);
  }
 }finally{await r.dispose();f.exit();restore();}
});
