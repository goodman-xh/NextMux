import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants as fsConstants, createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { sourceModule, comicCoreSource } from './helpers/comic-organizer-source-loader.mjs';
const { ComicAssetLibraryStore, comicAssetSaveIntent } = sourceModule('node/nextmux-comic-asset-library-store.ts');
const { CanvasAssetImportStore } = sourceModule('node/nextmux-canvas-asset-import-store.ts');
const { COMIC_ASSET_CATEGORY_OPTIONS } = sourceModule('common/nextmux-comic-asset-library.ts');
const { comicAssetLibraryMatches,sortComicAssetLibrary } = sourceModule('common/nextmux-comic-asset-library.ts');
const { characterLibraryAsset,libraryLocalMediaTypes } = sourceModule('node/nextmux-comic-asset-library-legacy.ts');
const { withCharacterLibraryLock } = sourceModule('node/nextmux-character-library-swap.ts');
const { probeComicMediaPackets } = sourceModule('node/nextmux-comic-media-probe.ts');
const { persistAgentOutputParts,verifiedAgentOutputAssetPath } = sourceModule('node/nextmux-agent-output-assets.ts');
const { assetLibraryOperations,runAssetLibraryOperation } = sourceModule('browser/nextmux-comic-asset-library-operations.ts');
const { ComicCanvasStore, CanvasServiceError } = sourceModule('node/nextmux-canvas-store.ts');
const { createComicProject, createCanvasDocument, applyCanvasCommand, createGenerationSnapshot, applyComicCommand, COMIC_MEDIA_DIRECTORY } = comicCoreSource;
const now = '2026-10-03T00:00:00.000Z';
const digest = data => createHash('sha256').update(data).digest('hex');
const base = { requestId:'save-fixture-0001', assetName:'  Saved image  ', assetCategory:'character', assetType:'image', remark:'  reviewed  ', source:{projectId:'project',canvasId:'canvas',nodeId:'image',versionId:'v1'} };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=', 'base64');

test('an immutable local copy survives restart/source removal and a lost acknowledgement retry', async t => {
    const root=await mkdtemp(join(tmpdir(),'nextmux-library-store-'));t.after(()=>rm(root,{recursive:true,force:true}));
    const original=join(root,'original.png');await writeFile(original,png);
    const path=join(root,'library'), store=new ComicAssetLibraryStore(path);
    const input={...base,sourcePath:original,metadata:{sha256:digest(png),width:1,height:1}};
    const [a,b]=await Promise.all([store.save(input),new ComicAssetLibraryStore(path).save(input)]);
    assert.equal(a.assetId,b.assetId);assert.equal(a.assetName,'Saved image');assert.equal(a.remark,'reviewed');
    assert.notEqual(a.mediaPath,original);assert.deepEqual(await readFile(a.mediaPath),png);
    await rm(original);
    const reopened=new ComicAssetLibraryStore(path);
    assert.deepEqual(await reopened.get(a.assetId),a);
    assert.equal((await reopened.save(input)).assetId,a.assetId,'same request reuses the committed copy without reading the removed source');
    assert.equal((await reopened.list()).length,1);
    await assert.rejects(()=>store.save({...input,assetName:'Different intent'}),/REQUEST_CONFLICT/);
    await writeFile(a.mediaPath,'tampered');await assert.rejects(()=>reopened.get(a.assetId),/MEDIA_CHANGED/);
});

test('independent failure leaves successful items intact and removes staging files; invalid names/text/paths are rejected', async t => {
    const root=await mkdtemp(join(tmpdir(),'nextmux-library-partial-'));t.after(()=>rm(root,{recursive:true,force:true}));
    const path=join(root,'library'),store=new ComicAssetLibraryStore(path);
    const text={...base,requestId:'save-text-0001',assetType:'text',textContent:'字'.repeat(1100)};
    const saved=await store.save(text);assert.equal(saved.textContent.length,1000);assert.equal(saved.mediaPath,undefined);
    for(const patch of [{assetName:' \t '},{assetCategory:'private-cloud'},{remark:null},{textContent:' \n '}])await assert.rejects(()=>store.save({...text,requestId:randomUUID(),...patch}),/ASSET_LIBRARY_/);
    await assert.rejects(()=>store.save({...base,requestId:'broken-source-1',sourcePath:join(root,'missing.png')}),/ENOENT/);
    const source=join(root,'source.mp3');await writeFile(source,'fixture audio');
    const linked=join(root,'linked.mp3');await symlink(source,linked);
    await assert.rejects(()=>store.save({...base,requestId:'linked-source-1',sourcePath:linked}),/INVALID_MEDIA/);
    const unsupported=join(root,'unsupported.gif');await writeFile(unsupported,'not an accepted importer type');
    await assert.rejects(()=>store.save({...base,requestId:'unsupported-type-1',sourcePath:unsupported}),/INVALID_MEDIA/);
    const oversized=join(root,'oversized.mp4'),large=await open(oversized,'w');await large.truncate(512*1024*1024+1);await large.close();
    await assert.rejects(()=>store.save({...base,requestId:'oversized-file-1',sourcePath:oversized}),/INVALID_MEDIA/);
    const sound=await store.save({...base,requestId:'save-sound-0001',assetType:'audio',assetCategory:'audio',durationMs:1234,metadata:{durationMs:1234},sourcePath:source});
    assert.equal(sound.durationMs,1234);assert.equal(sound.metadata.durationMs,1234);
    assert.equal((await store.list()).length,2);assert.ok((await readdir(path)).every(name=>!name.startsWith('.saving-')));
    const bad=join(path,`asset-library-${'f'.repeat(64)}`);await mkdir(bad);await writeFile(join(bad,'asset.json'),'{bad');
    assert.equal((await store.list()).length,2,'one corrupt entry does not hide intact saved items');
    await assert.rejects(()=>store.get('../../source.mp3'),/INVALID_ID/);
    assert.equal(await readFile(source,'utf8'),'fixture audio','save failures do not delete canvas media');
});

test('a real source write during copy is rejected even when the canvas version has no hash', async t=>{
    const root=await mkdtemp(join(tmpdir(),'nextmux-library-changing-'));t.after(()=>rm(root,{recursive:true,force:true}));
    const sourcePath=join(root,'changing.mp4'),file=await open(sourcePath,'w+');t.after(()=>file.close());await file.truncate(64*1024*1024);
    const path=join(root,'library'),store=new ComicAssetLibraryStore(path);
    const result=store.save({...base,assetType:'video',sourcePath,requestId:'changing-source-1'}).then(value=>({value}),error=>({error}));
    let observed=false;
    for(let count=0;count<1000;count++){
        const dirs=await readdir(path).catch(()=>[]),stage=dirs.find(name=>name.startsWith('.saving-'));
        if(stage&&(await stat(join(path,stage,'media.mp4')).catch(()=>undefined))?.size>0){observed=true;break;}
        await new Promise(resolve=>setTimeout(resolve,1));
    }
    assert.equal(observed,true,'mutate a source only after its actual copy starts');
    await file.write(Buffer.from('edited while copying'),0,20,0);await file.sync();
    assert.match((await result).error?.message??'',/MEDIA_CHANGED/);
    assert.deepEqual(await store.list(),[]);assert.ok((await readdir(path)).every(name=>!name.startsWith('.saving-')));
});

// Read actual RPC bodies and the real shared media importer, without launching a desktop or paid transport.
const source=await readFile(new URL('../src/node/nextmux-platform-service.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('rpc.ts',source,ts.ScriptTarget.Latest,true),methods=[];
const names=new Set(['comicAssetLibraryCategories','listComicAssetLibrary','saveComicCanvasAssetToLibrary','importComicAssetLibraryAsset','importComicMedia','importComicMediaWithIdentity',
    'saveComicLocalAssetToLibrary','setComicAssetLibraryPinned','deleteComicAssetLibraryAsset','validateComicImport','probeComicImport']);
(function walk(node){if(ts.isMethodDeclaration(node)&&names.has(node.name.getText(ast)))methods.push(node.getText(ast));ts.forEachChild(node,walk);})(ast);
assert.equal(methods.length,names.size);
const internalTokenDeclaration=ast.statements.find(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(declaration=>declaration.name.getText(ast)==='COMIC_MEDIA_IMPORT_INTERNAL_TOKEN'));
assert.ok(internalTokenDeclaration,'load the actual module-private identity guard with the production methods');
class FixturePlatformError extends Error { constructor(code,message){super(message);this.code=code;} }
const dependencies={ComicAssetLibraryStore,comicAssetSaveIntent,CanvasAssetImportStore,COMIC_ASSET_CATEGORY_OPTIONS,CanvasServiceError,join,randomUUID,applyCanvasCommand,
    applyComicCommand,COMIC_MEDIA_DIRECTORY,basename,dirname,extname,isAbsolute,resolve,fsConstants,createReadStream,createHash,copyFile,lstat,mkdir,rm,stat,
    characterLibraryAsset,libraryLocalMediaTypes,withCharacterLibraryLock,probeComicMediaPackets,verifiedAgentOutputAssetPath,
    boundedCommand:async(file,args,cwd,timeout)=>{try{return {exitCode:0,...await promisify(execFile)(file,args,{cwd,timeout,maxBuffer:4*1024*1024})};}catch(error){return {exitCode:error.code,stdout:error.stdout||'',stderr:error.stderr||''};}},
    PlatformRequestError:FixturePlatformError,mediaMessage:key=>key};
const compiled=ts.transpileModule(`const {${Object.keys(dependencies).join(',')}}=deps;${internalTokenDeclaration.getText(ast)}\nclass Harness {${methods.join('\n')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const Harness=new Function('deps',`${compiled}\nreturn Harness;`)(dependencies);
Harness.prototype.listComicCharacterLibrary=async()=>[];

test('production RPC saves the reviewed version and reimports a real reference into another persisted canvas without paid jobs', async t=>{
    const root=await mkdtemp(join(tmpdir(),'nextmux-library-rpc-'));t.after(()=>rm(root,{recursive:true,force:true}));
    const sourceRoot=join(root,'source'),targetRoot=join(root,'target');await mkdir(sourceRoot);await mkdir(targetRoot);
    const project=createComicProject({title:'Source',starter:'empty',now}),targetProject=createComicProject({title:'Target',starter:'empty',now});
    await writeFile(join(sourceRoot,'old.png'),png);await writeFile(join(sourceRoot,'new.png'),'new selected version');
    const old={id:'v1',assetId:'asset-old',kind:'image',uri:'old.png',createdAt:now,metadata:{sha256:digest(png),width:1,height:1}};
    const newer={...old,id:'v2',assetId:'asset-new',uri:'new.png',metadata:{}};
    const sourceStore=new ComicCanvasStore(sourceRoot),targetStore=new ComicCanvasStore(targetRoot);
    let canvas=createCanvasDocument({id:'source-canvas',projectId:project.id,now});
    canvas=applyCanvasCommand(canvas,{type:'node.add',node:{id:'image',kind:'image',title:'Original title',position:{x:0,y:0},size:{width:320,height:240},payload:{versions:[old,newer],currentVersionId:'v2'}}});
    canvas=applyCanvasCommand(canvas,{type:'node.add',node:{id:'note',kind:'text',title:'Note',position:{x:0,y:300},size:{width:320,height:240},payload:{text:'Original note'}}});
    await sourceStore.save(canvas,0,project.id);
    await targetStore.save(createCanvasDocument({id:'target-canvas',projectId:targetProject.id,now}),0,targetProject.id);
    const originalJSON=await readFile(join(sourceRoot,'nextmux.canvas.json'),'utf8');let imports=0;
    const harness=new Harness();Object.assign(harness,{nextmuxDataRoot:()=>join(root,'app'),canvasStore:workspaceRoot=>new ComicCanvasStore(workspaceRoot),resolveMediaInput:async(workspaceRoot,uri)=>join(workspaceRoot,uri),
        importComicMediaWithIdentity:async({workspaceRoot,paths})=>{imports++;const bytes=await readFile(paths[0]),uri=`imported-${imports}.png`;await copyFile(paths[0],join(workspaceRoot,uri));
            const asset={id:`asset-imported-${imports}`,kind:'image',uri,sha256:digest(bytes),byteLength:bytes.length,mimeType:'image/png',width:1,height:1,streamStartMs:0};
            return {assetIds:[asset.id],skipped:[],state:{project:{...targetProject,assets:[asset]}}};}});
    assert.deepEqual(await harness.comicAssetLibraryCategories(),COMIC_ASSET_CATEGORY_OPTIONS);
    const saveRequest={workspaceRoot:sourceRoot,nodeId:'image',versionId:'v1',requestId:'reviewed-image-1',assetName:'Saved reference',assetCategory:'scene',remark:''};
    const saved=await harness.saveComicCanvasAssetToLibrary(saveRequest);
    assert.equal(saved.source.versionId,'v1');assert.deepEqual(await readFile(saved.mediaPath),png);
    assert.equal(await readFile(join(sourceRoot,'nextmux.canvas.json'),'utf8'),originalJSON);
    await assert.rejects(()=>harness.saveComicCanvasAssetToLibrary({workspaceRoot:sourceRoot,nodeId:'note',textContent:'Stale note',requestId:'stale-text-1',assetName:'Note',assetCategory:'other',remark:''}),/changed/);
    const textRequest={workspaceRoot:sourceRoot,nodeId:'note',textContent:'Original note',requestId:'current-text-1',assetName:'Note',assetCategory:'other',remark:''};
    const text=await harness.saveComicCanvasAssetToLibrary(textRequest);
    await sourceStore.mutate(canvas=>applyCanvasCommand(canvas,{type:'node.delete',nodeIds:['image','note']}));
    await rm(join(sourceRoot,'old.png'));await rm(join(sourceRoot,'nextmux.canvas.json'));
    const restarted=Object.assign(new Harness(),harness);
    assert.deepEqual(await restarted.saveComicCanvasAssetToLibrary(saveRequest),saved,'RPC lost-ack retry recovers without the deleted source node, file or canvas document');
    assert.deepEqual(await restarted.saveComicCanvasAssetToLibrary(textRequest),text);
    for(const patch of [{nodeId:'other'},{versionId:'v2'},{assetName:'Different'},{assetCategory:'audio'},{remark:'changed'},{textContent:'different'},{workspaceRoot:targetRoot},{canvasId:'another'}])
        await assert.rejects(()=>restarted.saveComicCanvasAssetToLibrary({...saveRequest,...patch}),/REQUEST_CONFLICT/);
    await assert.rejects(()=>restarted.saveComicCanvasAssetToLibrary({...textRequest,textContent:'changed snapshot'}),/REQUEST_CONFLICT/);
    const before=(await targetStore.read()).canvas;
    const importRequest={workspaceRoot:targetRoot,requestId:'import-image-1',expectedRevision:before.revision,assetId:saved.assetId,position:{x:20,y:30}};
    const result=await harness.importComicAssetLibraryAsset(importRequest);
    const node=result.state.canvas.nodes.find(n=>n.id===result.nodeId),version=node.payload.versions[0];
    assert.equal(node.kind,'image');assert.equal(node.title,'Saved reference');assert.equal(version.provenance.operation,'assetLibrary.import');
    assert.deepEqual(await readFile(join(targetRoot,version.uri)),png);assert.equal(version.metadata.streamStartMs,0);
    let target=applyCanvasCommand(result.state.canvas,{type:'node.add',node:{id:'generate',kind:'videoGen',title:'Draft',position:{x:400,y:0},size:{width:320,height:240},payload:{mode:'imageToVideo',modelId:'fixture-model',prompt:'Animate saved reference',parameters:{},versions:[]}}});
    target=applyCanvasCommand(target,{type:'edge.connect',edge:{id:'reference-edge',sourceNodeId:node.id,sourcePort:'image',targetNodeId:'generate',targetPort:'firstFrame',role:'firstFrame',order:0,binding:'pinnedVersion',pinnedVersionId:version.id}});
    const snapshot=createGenerationSnapshot(target,'generate',{capabilityVersion:'fixture'});
    assert.equal(snapshot.resolvedInputs[0].assetId,version.assetId);assert.equal(snapshot.resolvedInputs[0].versionId,version.id);assert.equal(snapshot.resolvedInputs[0].uri,version.uri);
    assert.equal((await targetStore.read()).jobs.length,0);assert.equal(imports,1);
    const retries=await Promise.all([restarted.importComicAssetLibraryAsset(importRequest),restarted.importComicAssetLibraryAsset(importRequest)]);
    assert.ok(retries.every(item=>item.nodeId===result.nodeId&&item.state.canvas.revision===result.state.canvas.revision));assert.equal(imports,1,'lost-ack retry with the old revision does not copy or add another node');
    for(const patch of [{assetId:text.assetId},{position:{x:21,y:30}}])await assert.rejects(()=>restarted.importComicAssetLibraryAsset({...importRequest,...patch}),/REQUEST_CONFLICT/);
    const note=await harness.importComicAssetLibraryAsset({workspaceRoot:targetRoot,requestId:'import-note-1',expectedRevision:result.state.canvas.revision,assetId:text.assetId,position:{x:20,y:350}});
    assert.equal(note.state.canvas.nodes.find(n=>n.id===note.nodeId).payload.text,'Original note');assert.equal(imports,1,'text import does not become a media or paid request');
    assert.equal((await harness.listComicAssetLibrary()).length,2);
    await assert.rejects(()=>harness.importComicAssetLibraryAsset({workspaceRoot:targetRoot,requestId:'import-stale-1',expectedRevision:0,assetId:saved.assetId,position:{x:0,y:0}}));
    assert.equal(imports,1,'stale revision is rejected before copying media');
    await targetStore.mutate(canvas=>applyCanvasCommand(canvas,{type:'node.delete',nodeIds:[result.nodeId]}));
    const deleted=await restarted.importComicAssetLibraryAsset(importRequest);
    assert.equal(deleted.nodeId,result.nodeId);assert.equal(deleted.state.canvas.nodes.some(node=>node.id===result.nodeId),false,'completed requests never resurrect a subsequently deleted node');assert.equal(imports,1);
    let interrupt=true;
    class InterruptedCanvasStore extends ComicCanvasStore { async writeDocument(...args){if(interrupt){interrupt=false;throw Error('fixture interrupted before canvas commit');}return super.writeDocument(...args);} }
    harness.canvasStore=workspaceRoot=>new InterruptedCanvasStore(workspaceRoot);
    const interruptedRequest={...importRequest,requestId:'import-interrupted-1',expectedRevision:(await targetStore.read()).canvas.revision};
    await assert.rejects(()=>harness.importComicAssetLibraryAsset(interruptedRequest),/interrupted before canvas commit/);
    assert.equal(imports,2);
    const resumed=await restarted.importComicAssetLibraryAsset(interruptedRequest);
    assert.equal(imports,2,'prepared durable import reuses the already copied media after a canvas commit failure');
    assert.ok(resumed.state.canvas.nodes.some(node=>node.id===resumed.nodeId));
});

test('actual media importer reuses durable identity after prepared journal failure and rejects conflicts without overwriting files', async t=>{
    // Theia dispatches target[method](...args), including TS-protected method names. Exercise that exact access shape.
    let unexpectedIO=0;
    const blockedIO=()=>{unexpectedIO++;throw new Error('untrusted RPC reached media I/O');};
    const blockedDependencies={...dependencies,...Object.fromEntries(['createReadStream','copyFile','lstat','mkdir','rm','stat'].map(name=>[name,blockedIO]))};
    const GuardHarness=new Function('deps',`${compiled}\nreturn Harness;`)(blockedDependencies);
    const rpcTarget=new Proxy({}, {get:(_target,key)=>key==='importComicMediaWithIdentity'?GuardHarness.prototype.importComicMediaWithIdentity:blockedIO});
    const rpcRequest={workspaceRoot:'/must-not-be-read',paths:['/must-not-be-read/source.png']};
    const rpcIdentity={fileId:'12345678-1234-4234-a234-123456789012',jobId:'media-job-12345678-1234-4234-a234-123456789012'};
    await assert.rejects(()=>rpcTarget['importComicMediaWithIdentity'](rpcRequest,rpcIdentity),/helper is internal/);
    for(const fake of [null,'comic-media-import-internal',{}, {description:'comic-media-import-internal'},true,1]) {
        await assert.rejects(()=>rpcTarget['importComicMediaWithIdentity'](...JSON.parse(JSON.stringify([rpcRequest,rpcIdentity,fake]))),/helper is internal/);
    }
    assert.equal(unexpectedIO,0,'missing and JSON-serializable forged tokens fail before any service or filesystem access');
    const root=await mkdtemp(join(tmpdir(),'nextmux-library-import-gap-'));t.after(()=>rm(root,{recursive:true,force:true}));
    const dataRoot=join(root,'app'),workspace=join(root,'project');await mkdir(workspace);const projectFile=join(workspace,'project.json');
    const project=createComicProject({title:'Persistent importer fixture',starter:'empty',now});await writeFile(projectFile,JSON.stringify(project));
    const canvasStore=new ComicCanvasStore(workspace),initial=(await canvasStore.save(createCanvasDocument({id:'import-gap-canvas',projectId:project.id,now}),0,project.id)).canvas;
    const source=join(root,'source.png');await writeFile(source,png);
    const entry=await new ComicAssetLibraryStore(join(dataRoot,'comic-asset-library')).save({...base,sourcePath:source});
    let decoded=0;
    const service=()=>Object.assign(new Harness(),{
        nextmuxDataRoot:()=>dataRoot,canvasStore:root=>new ComicCanvasStore(root),workspaceDirectory:root=>realpath(root),
        sha256File:async path=>digest(await readFile(path)),getMediaRuntimeState:async()=>({ffmpeg:{available:true,path:'isolated-decoder'}}),
        validateComicImport:async()=>{decoded++;return true;},probeComicImport:async()=>({width:1,height:1}),
        comicProjectStore:async()=>({read:async()=>({project:JSON.parse(await readFile(projectFile,'utf8'))}),commitPrepared:async(revision,next)=>{
            const current=JSON.parse(await readFile(projectFile,'utf8'));assert.equal(current.revision,revision);await writeFile(projectFile,JSON.stringify(next));return {project:next};}}),
        withComicProduction:async(_root,state)=>state,syncComicProductionDocument:async()=>{},comicRequestError:error=>error,
    });
    const request={workspaceRoot:workspace,requestId:'import-journal-gap-1',expectedRevision:initial.revision,assetId:entry.assetId,position:{x:20,y:30}};
    const identity=new CanvasAssetImportStore(workspace,request).mediaIdentity(initial.id);
    const mediaDirectory=join(workspace,COMIC_MEDIA_DIRECTORY,'imports'),target=join(mediaDirectory,`${identity.fileId}.png`);
    const originalWrite=CanvasAssetImportStore.prototype.write;let fail=true;
    CanvasAssetImportStore.prototype.write=async function(record){if(fail){fail=false;throw Object.assign(new Error('injected ENOSPC at prepared journal write'),{code:'ENOSPC'});}return originalWrite.call(this,record);};
    try {await assert.rejects(()=>service().importComicAssetLibraryAsset(request),/injected ENOSPC/);}
    finally {CanvasAssetImportStore.prototype.write=originalWrite;}
    const firstProject=JSON.parse(await readFile(projectFile,'utf8'));assert.equal(firstProject.assets.length,1);assert.equal(decoded,1);
    assert.equal(firstProject.assets[0].id,`asset-${identity.fileId}`);assert.equal(firstProject.assets[0].jobId,identity.jobId);
    assert.deepEqual(await readdir(mediaDirectory),[`${identity.fileId}.png`]);
    assert.equal((await canvasStore.read()).canvas.nodes.length,0);
    await assert.rejects(()=>service().importComicAssetLibraryAsset({...request,position:{x:21,y:30}}),/different media or intent/,'same request with changed intent is rejected even before a journal exists');
    await writeFile(target,'tampered after import');
    await assert.rejects(()=>service().importComicAssetLibraryAsset(request),/changed or is unavailable/);assert.equal(await readFile(target,'utf8'),'tampered after import');
    await writeFile(target,png);
    // Restart into a separate Node process: recovery must come from the project/journal files, not an in-memory map.
    const childPath=join(root,'recover.mjs');
    await writeFile(childPath,`
import * as fs from 'node:fs/promises';import * as path from 'node:path';import * as crypto from 'node:crypto';
import {constants as fsConstants,createReadStream} from 'node:fs';
import {sourceModule,comicCoreSource} from ${JSON.stringify(new URL('./helpers/comic-organizer-source-loader.mjs',import.meta.url).href)};
const {ComicAssetLibraryStore,comicAssetSaveIntent}=sourceModule('node/nextmux-comic-asset-library-store.ts');
const {CanvasAssetImportStore}=sourceModule('node/nextmux-canvas-asset-import-store.ts');
const {CanvasServiceError,ComicCanvasStore}=sourceModule('node/nextmux-canvas-store.ts');
const {COMIC_ASSET_CATEGORY_OPTIONS}=sourceModule('common/nextmux-comic-asset-library.ts');
const {readFile,writeFile,realpath}=fs;const digest=data=>crypto.createHash('sha256').update(data).digest('hex');
const deps={...fs,...path,...crypto,...comicCoreSource,ComicAssetLibraryStore,comicAssetSaveIntent,CanvasAssetImportStore,COMIC_ASSET_CATEGORY_OPTIONS,CanvasServiceError,fsConstants,createReadStream,PlatformRequestError:class extends Error{},mediaMessage:key=>key};
const Harness=new Function('deps',${JSON.stringify(compiled+'\nreturn Harness;')})(deps);
const dataRoot=${JSON.stringify(dataRoot)},projectFile=${JSON.stringify(projectFile)};let decoded=0;
const service=${service.toString()};
const result=await service().importComicAssetLibraryAsset(${JSON.stringify(request)});
process.stdout.write(JSON.stringify({result,decoded}));
`);
    const child=JSON.parse((await promisify(execFile)(process.execPath,[childPath],{timeout:60000,maxBuffer:4*1024*1024})).stdout);
    const recovered=child.result;assert.equal(child.decoded,0);
    assert.equal(decoded,1,'fresh service process state recovers the project asset without copying or decoding again');
    assert.equal(JSON.parse(await readFile(projectFile,'utf8')).assets.length,1);assert.equal(recovered.state.canvas.nodes.length,1);
    assert.deepEqual(await readdir(mediaDirectory),[`${identity.fileId}.png`]);
    await rm(dirname(entry.mediaPath),{recursive:true});
    assert.equal((await service().importComicAssetLibraryAsset(request)).nodeId,recovered.nodeId,'completed request remains recoverable after its source library item is deleted');
    // The public one-argument RPC ignores even an explicit renderer-supplied second positional argument.
    const publicOne=await service().importComicMedia({workspaceRoot:workspace,paths:[source]},identity);
    const publicTwo=await service().importComicMedia({workspaceRoot:workspace,paths:[source]},identity);
    assert.notEqual(publicOne.assetIds[0],firstProject.assets[0].id);assert.notEqual(publicTwo.assetIds[0],publicOne.assetIds[0]);
    assert.equal(JSON.parse(await readFile(projectFile,'utf8')).assets.length,3);
    const other=await new ComicAssetLibraryStore(join(dataRoot,'comic-asset-library')).save({...base,requestId:'another-library-item',sourcePath:source});
    const collisionRequest={...request,requestId:'import-file-collision-1',assetId:other.assetId,expectedRevision:recovered.state.canvas.revision};
    const collision=new CanvasAssetImportStore(workspace,collisionRequest).mediaIdentity(initial.id),collisionPath=join(mediaDirectory,`${collision.fileId}.png`);
    await writeFile(collisionPath,'do not overwrite');
    await assert.rejects(()=>service().importComicAssetLibraryAsset(collisionRequest),/different media/);assert.equal(await readFile(collisionPath,'utf8'),'do not overwrite');
    const orphanRequest={...collisionRequest,requestId:'import-compatible-orphan-1'},orphan=new CanvasAssetImportStore(workspace,orphanRequest).mediaIdentity(initial.id),orphanPath=join(mediaDirectory,`${orphan.fileId}.png`);
    await writeFile(orphanPath,png);const inode=(await stat(orphanPath)).ino;
    const reused=await service().importComicAssetLibraryAsset(orphanRequest);
    assert.equal((await stat(orphanPath)).ino,inode,'matching copied file from an interrupted import is reused without replacement');
    assert.ok(reused.state.canvas.nodes.some(node=>node.payload.versions?.[0].assetId===`asset-${orphan.fileId}`));
    const bundleId=`bundle-${randomUUID()}`,charactersRoot=join(dataRoot,'comic-character-library'),bundleRoot=join(charactersRoot,bundleId);
    await mkdir(bundleRoot,{recursive:true});const portrait=join(bundleRoot,'portrait.png');await writeFile(portrait,png);
    const oldCharacter={bundleId,name:'Existing character',createdAt:now,thumbnailPath:portrait,sourceProjectId:project.id,sourceCharacterId:'character-original',referenceCount:3,
        authorizationRef:'existing permission',appearance:'Original appearance',description:'Original description',identityVersion:'identity-original'};
    const legacyService=Object.assign(service(),{listComicCharacterLibrary:async()=>[oldCharacter],characterLibraryRoot:()=>charactersRoot});
    const unified=(await legacyService.listComicAssetLibrary()).find(entry=>entry.characterBundleId===bundleId);
    assert.equal(unified.mediaPath,portrait);assert.equal(unified.character.referenceCount,3);assert.equal(unified.character.identityVersion,'identity-original');
    const importedCharacter=await legacyService.importComicAssetLibraryAsset({...orphanRequest,requestId:'import-existing-character',assetId:unified.assetId,expectedRevision:reused.state.canvas.revision});
    const node=importedCharacter.state.canvas.nodes.find(node=>node.id===importedCharacter.nodeId),projectCopy=join(workspace,node.payload.versions[0].uri);
    await legacyService.deleteComicAssetLibraryAsset(unified.assetId);
    assert.deepEqual(await readFile(projectCopy),png,'deleting a legacy character library entry preserves the actual canvas import copy');
    assert.equal((await legacyService.listComicAssetLibrary()).some(entry=>entry.assetId===unified.assetId),false,'tombstone also hides a stale legacy listing');
});

test('local uploads validate real copied files, project type facets, persist pin/delete, and recover acknowledgements',async t=>{
    const root=await realpath(await mkdtemp(join(tmpdir(),'nextmux-unified-library-')));t.after(()=>rm(root,{recursive:true,force:true}));
    const ffmpeg=createRequire(import.meta.url)('@ffmpeg-installer/ffmpeg').path;
    const files=[['picture.png','image',['-f','lavfi','-i','color=c=blue:s=64x64','-frames:v','1']],
        ['clip.mp4','video',['-f','lavfi','-i','color=c=blue:s=64x64:d=0.2','-c:v','mpeg4']],
        ['sound.wav','audio',['-f','lavfi','-i','sine=frequency=440:duration=0.2','-c:a','pcm_s16le']]];
    const service=Object.assign(new Harness(),{nextmuxDataRoot:()=>root,getMediaRuntimeState:async()=>({ffmpeg:{available:true,path:ffmpeg}}),sha256File:async path=>digest(await readFile(path))});
    const entries=[];
    for(const [name,kind,args] of files){const source=join(root,name);await promisify(execFile)(ffmpeg,['-hide_banner','-loglevel','error',...args,'-y',source]);
        const request={requestId:`local-upload-${kind}`,path:source};const entry=await service.saveComicLocalAssetToLibrary(request);entries.push(entry);
        assert.equal(entry.assetType,kind);assert.equal(entry.source.origin,'local_file');assert.equal(entry.characterBundleId,undefined);
        assert.equal(comicAssetLibraryMatches(entry,kind),true);assert.equal(comicAssetLibraryMatches(entry,'character'),false);
        assert.deepEqual(await readFile(entry.mediaPath),await readFile(source));
        if(kind==='audio'){assert.equal(entry.assetCategory,'audio');assert.equal(entry.audioSubtype,undefined,'do not invent speech/music semantics from an audio stream');}
        await rm(source);assert.equal((await service.saveComicLocalAssetToLibrary(request)).assetId,entry.assetId,'same local request recovers after source removal');
    }
    const mislabeled=join(root,'wrong.wav');await writeFile(mislabeled,png);
    await assert.rejects(()=>service.saveComicLocalAssetToLibrary({requestId:'wrong-upload-format',path:mislabeled}),/file content/);
    assert.equal((await service.listComicAssetLibrary()).length,3);
    assert.ok((await readdir(join(root,'comic-asset-library'))).every(name=>!name.startsWith('.saving-')));
    await service.setComicAssetLibraryPinned({assetId:entries[0].assetId,pinned:true});
    const reopened=new ComicAssetLibraryStore(join(root,'comic-asset-library'));assert.equal((await reopened.list())[0].assetId,entries[0].assetId);
    assert.equal(sortComicAssetLibrary(await reopened.list(),true)[0].assetId,entries[0].assetId,'pin precedes both time orders');
    const kept=join(root,'project-copy.png');await copyFile(entries[0].mediaPath,kept);const keptBytes=await readFile(kept);
    await service.deleteComicAssetLibraryAsset(entries[0].assetId);await service.deleteComicAssetLibraryAsset(entries[0].assetId);
    assert.deepEqual(await readFile(kept),keptBytes);assert.equal((await reopened.list()).length,2);
    await assert.rejects(()=>service.saveComicLocalAssetToLibrary({requestId:'local-upload-image',path:join(root,'picture.png')}),/DELETED/,'a late save retry cannot resurrect a deliberately deleted entry');
    const text=await service.saveComicLocalAssetToLibrary({requestId:'chat-text-fixture',textContent:'Selected chat text',assetName:'Chat excerpt'});
    assert.equal(text.assetType,'text');assert.equal(text.source.origin,'text');
    assert.equal(comicAssetLibraryMatches(text,'all'),true);assert.equal(comicAssetLibraryMatches(text,'audio'),false);
    const outputs=await persistAgentOutputParts(root,'chat-owner-fixture',[{type:'image',mimeType:'image/png',sizeBytes:keptBytes.length,dataBase64:keptBytes.toString('base64')}]);
    const agentOutput={ownerId:'chat-owner-fixture',asset:outputs[0].asset},request={requestId:'chat-generated-image',agentOutput,assetName:'Generated picture'};
    const generated=await service.saveComicLocalAssetToLibrary(request);assert.equal(generated.assetType,'image');assert.deepEqual(await readFile(generated.mediaPath),keptBytes);
    await assert.rejects(()=>service.saveComicLocalAssetToLibrary({...request,requestId:'chat-wrong-owner',agentOutput:{...agentOutput,ownerId:'other-owner'}}),/ENOENT/);
    await assert.rejects(()=>service.saveComicLocalAssetToLibrary({...request,requestId:'chat-wrong-sha',agentOutput:{...agentOutput,asset:{...agentOutput.asset,sizeBytes:1}}}),/MISMATCH/);
    await rm(await verifiedAgentOutputAssetPath(root,agentOutput.ownerId,agentOutput.asset));
    assert.equal((await service.saveComicLocalAssetToLibrary(request)).assetId,generated.assetId,'saved output retry recovers without the deleted chat cache');
    const charPortrait=await service.saveComicLocalAssetToLibrary({requestId:'local-character-portrait',path:kept,assetName:'女主立绘'});
    assert.equal(charPortrait.assetCategory,'character','character keyword in name/remark infers character category');
    assert.equal(comicAssetLibraryMatches(charPortrait,'character'),true);assert.equal(comicAssetLibraryMatches(charPortrait,'image'),false);
    await reopened.setCategory(charPortrait.assetId,'other');
    const movedToImage=await reopened.get(charPortrait.assetId);
    assert.equal(movedToImage.assetCategory,'other');assert.equal(comicAssetLibraryMatches(movedToImage,'image'),true);assert.equal(comicAssetLibraryMatches(movedToImage,'character'),false);
    await reopened.setCategory(charPortrait.assetId,'character');
    assert.equal((await reopened.get(charPortrait.assetId)).assetCategory,'character');
});

test('closing and reopening progress shares a destination operation and its original failed request identity',async()=>{
    const state=assetLibraryOperations('canvas-destination-fixture',()=>{}),ids=[];let release;
    const pending=runAssetLibraryOperation(state,'asset-one',async id=>{ids.push(id);await new Promise(resolve=>release=resolve);throw Error('lost acknowledgement');});
    const reopened=assetLibraryOperations('canvas-destination-fixture',()=>{});assert.equal(reopened,state);
    assert.equal(await runAssetLibraryOperation(reopened,'asset-one',async()=>{throw Error('duplicate import');}),false);
    release();await assert.rejects(()=>pending,/lost acknowledgement/);
    await runAssetLibraryOperation(reopened,'asset-one',async id=>{ids.push(id);});assert.equal(ids[0],ids[1]);
    assert.equal(reopened.busy,'');assert.equal(reopened.requests.size,0);
    assert.notEqual(assetLibraryOperations('other-canvas',()=>{}),state);
});
