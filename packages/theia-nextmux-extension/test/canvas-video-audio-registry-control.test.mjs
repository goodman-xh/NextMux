import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';

const repo = process.env.NEXTMUX_CANVAS_AUDIO_TEST_REPOSITORY || fileURLToPath(new URL('../../../', import.meta.url));
const sourceRoot = resolve(repo, 'packages/theia-nextmux-extension/src');
const require = createRequire(resolve(repo, 'packages/theia-nextmux-extension/package.json'));
const { compactCanvasCapabilityVersion, resolveCanvasCapability, reconcileCanvasGenerationParameters } = require('@nextmux/comic-core');
const { enqueueRequest } = require('@nextmux/media-core');
// Evaluate the real extension source in memory. Relative imports share this isolated module
// cache; workspace packages keep their existing public exports. Nothing writes lib, Node's
// require cache, a project, credentials or the installed App. Transpile is not a typecheck.
const sourceOverrides = new Map([
    [resolve(sourceRoot, 'common/nextmux-canvas-registry-intersection.ts'), process.env.NEXTMUX_CANVAS_AUDIO_REGISTRY_SOURCE],
    [resolve(sourceRoot, 'node/nextmux-canvas-generation.ts'), process.env.NEXTMUX_CANVAS_AUDIO_GENERATION_SOURCE]
]);
const sourceModules = new Map();
function loadSource(filename) {
    assert.ok(filename.startsWith(sourceRoot + sep), 'A source import must stay within the extension');
    if (sourceModules.has(filename)) return sourceModules.get(filename).exports;
    const managedRoot = process.env.NEXTMUX_MANAGED_AUDIO_SOURCE_ROOT;
    const candidate = managedRoot && filename.startsWith(sourceRoot + sep) ? resolve(managedRoot, filename.slice(sourceRoot.length + 1)) : undefined;
    const source = readFileSync(sourceOverrides.get(filename) || (candidate && require('node:fs').existsSync(candidate) ? candidate : filename), 'utf8');
    const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
    assert.equal(parsed.parseDiagnostics.length, 0, `Source syntax: ${filename}`);
    const compiled = ts.transpileModule(source, {
        fileName: filename, reportDiagnostics: true,
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    });
    assert.equal((compiled.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error).length, 0);
    const module = { exports: {} };
    sourceModules.set(filename, module);
    const externalRequire = createRequire(filename);
    const sourceRequire = specifier => specifier.startsWith('.')
        ? loadSource(resolve(dirname(filename), specifier + '.ts')) : externalRequire(specifier);
    new Function('exports', 'require', 'module', '__filename', '__dirname', compiled.outputText)(
        module.exports, sourceRequire, module, filename, dirname(filename));
    return module.exports;
}
const { buildManagedCanvasCapability, buildOfficialCanvasCapability } = loadSource(resolve(sourceRoot, 'common/nextmux-canvas-capabilities.ts'));
const { buildManagedCanvasAdapterPolicy, buildOfficialCanvasAdapterPolicy, canvasAdapterInputIssues } = loadSource(resolve(sourceRoot, 'common/nextmux-canvas-adapter-policy.ts'));
const { intersectCanvasRegistryCapability } = loadSource(resolve(sourceRoot, 'common/nextmux-canvas-registry-intersection.ts'));
const { videoModelGuide } = loadSource(resolve(sourceRoot, 'common/nextmux-video-model-guide.ts'));
const { compileCanvasGenerationJob } = loadSource(resolve(sourceRoot, 'node/nextmux-canvas-generation.ts'));
const model='alibaba/wan-3.0',connectionId='official-11111111-1111-4111-8111-111111111111';
const connection={id:connectionId,providerId:'openai',providerName:'Fixture',label:'Fixture',protocol:'openai_chat_completions',baseUrl:'https://openrouter.ai/api/v1',updatedAt:'2026-10-09T00:00:00.000Z'};
const facts={...videoModelGuide(model),source:'listing',nativeAudio:true,clipSeconds:[5],resolutions:['480p'],aspectRatios:['16:9'],frameImages:['first_frame'],supportsGenerateAudio:true};
const optional={mode:'optional',defaultEnabled:true},required={mode:'required',defaultEnabled:true},unsupported={mode:'unsupported',defaultEnabled:false};
const frame={role:'firstFrame',order:0,versionId:'version-frame',assetId:'asset-frame',kind:'image',uri:'nextmux.media/frame.png',metadata:{mimeType:'image/png',byteLength:100,width:1920,height:1080}};
const params=generateAudio=>({resolution:'480p',aspectRatio:'auto',durationSeconds:5,generateAudio});
function actual(){const policy=buildOfficialCanvasAdapterPolicy(connection,model,{kind:'video',videoFacts:facts});const capability=buildOfficialCanvasCapability(connection,model,{}, {kind:'video',videoFacts:facts});return{policy,capability};}
function raw(capability,audio){return{...capability,modes:capability.modes.map(mode=>({...mode,audioGeneration:audio,outputVariants:mode.outputVariants.map(variant=>({...variant,audioGenerationOverride:audio}))}))};}
function resolved(capability){return resolveCanvasCapability(capability,{mode:'imageToVideo',resolution:'480p'});}
function compile(capability,policy,generateAudio){return enqueueRequest(compileCanvasGenerationJob({canvasId:'audio-registry-fixture',projectId:'project-11111111-1111-4111-8111-111111111111',nodeId:'node-fixture',idempotencyKey:'fixture-'+String(generateAudio),connectionId,capability,adapterPolicy:policy,cost:{billing:'provider_billed',description:'Offline fixture'},snapshot:{modelId:model,capabilityVersion:capability.version,mode:'imageToVideo',prompt:'Three original characters wave',inputFingerprint:'fixture',resolvedInputs:[frame],parameters:params(generateAudio)}}));}
test('Wan3 captured no-control registry keeps verified own optional at mode and every output variant',()=>{
 const{policy,capability}=actual();assert.equal(policy.audioControlVersion,1);assert.deepEqual(policy.audioGeneration,optional);assert.equal(capability.status,'available');
 for(const mode of capability.modes){assert.deepEqual(mode.audioGeneration,optional);for(const variant of mode.outputVariants)assert.deepEqual(variant.audioGenerationOverride,optional);}
 assert.deepEqual(resolved(capability).audioGeneration,optional);
});
test('fitting an existing Wan3 draft preserves both explicit on and off choices',()=>{
 const{capability}=actual();for(const choice of [true,false]){const original=params(choice),before=JSON.stringify(original);const result=reconcileCanvasGenerationParameters(capability,'imageToVideo',original,[frame]);assert.equal(result.parameters.generateAudio,choice);assert.equal(JSON.stringify(original),before);}
});
for(const choice of [true,false])test(`verified own Wan3 choice=${choice} survives versioned compilation`,()=>{
 const{capability,policy}=actual(),request=compile(capability,policy,choice);assert.equal(request.input.requestAudio,choice);assert.equal(request.input.audioControlVersion,1);
});
test('an independently required soundtrack remains required without acquiring a versioned optional switch',()=>{
 const{capability,policy}=actual(),legacy={...policy,audioGeneration:required,audioControlVersion:undefined,audioRequestEnabled:false};
 const rawCap=intersectCanvasRegistryCapability(raw(capability,required),legacy,facts),cap={...rawCap,version:compactCanvasCapabilityVersion(rawCap.version)};assert.deepEqual(resolved(cap).audioGeneration,required);const request=compile(cap,legacy,true);assert.equal(request.input.audioControlVersion,undefined);assert.equal(request.input.requestAudio,false);
});
test('a genuinely unsupported route stays unsupported and gains no versioned request field',()=>{
 const{capability,policy}=actual(),noAudio={...policy,audioGeneration:unsupported,audioControlVersion:undefined,audioRequestEnabled:false};
 const rawCap=intersectCanvasRegistryCapability(raw(capability,unsupported),noAudio,{...facts,nativeAudio:false,supportsGenerateAudio:false}),cap={...rawCap,version:compactCanvasCapabilityVersion(rawCap.version)};assert.deepEqual(resolved(cap).audioGeneration,unsupported);const request=compile(cap,noAudio,false);assert.equal(request.input.requestAudio,false);assert.equal(request.input.audioControlVersion,undefined);
});
test('unverified own optional and managed/template policies cannot promote the captured registry control',()=>{
 const{capability,policy}=actual();for(const patch of [{audioControlVersion:undefined},{adapter:'managed'},{adapter:'template'}]){
  const cap=intersectCanvasRegistryCapability(raw(capability,optional),{...policy,...patch},facts);assert.deepEqual(resolved(cap).audioGeneration,unsupported);for(const mode of cap.modes)for(const variant of mode.outputVariants)assert.deepEqual(variant.audioGenerationOverride,unsupported);
 }
});
test('even an optional-control marker cannot promote an unsupported route or mutate a frozen accepted input',()=>{
 const{capability,policy}=actual(),cap=intersectCanvasRegistryCapability(raw(capability,unsupported),policy,facts);assert.deepEqual(resolved(cap).audioGeneration,unsupported);
 const accepted=Object.freeze({model,requestAudio:false,audioControlVersion:1,taskId:'owned-previous-task'}),before=JSON.stringify(accepted);actual();assert.equal(JSON.stringify(accepted),before);
});

const managedQuote=`kq1_${'a'.repeat(64)}`,managedId='11111111-1111-4111-8111-111111111111';
const managedShape=requestAudio=>({resolution:'480p',aspectRatio:'1:1',width:480,height:480,durationSeconds:2,firstFrame:true,lastFrame:false,referenceImages:0,requestAudio});
function managed(audio=[false,true],extra={}){return{id:managedId,merchantId:'merchant-fixture',providerName:'Managed fixture',providerModelCode:model,canonicalModel:model,displayName:'Wan 3',status:'active',category:'video',capabilities:['text_to_video','image_to_video','video_native_audio'],keyPriceQuoteId:managedQuote,mediaInput:{firstFrame:true,lastFrame:false,referenceImages:false,maxReferences:0},price:{videoInputImageEachMicros:0},videoLimits:{durations:[2],resolutions:['480p'],aspectRatios:['1:1'],frameImages:['first_frame'],shapeQuoteId:managedQuote,inputImagePriceMicros:0,provenShapes:audio.map(managedShape)},...extra};}
const squareFrame={...frame,metadata:{...frame.metadata,width:1254,height:1254}};
function managedCompile(route,choice){const options={kind:'video',videoFacts:{...facts,clipSeconds:[2],aspectRatios:['1:1']}},policy=buildManagedCanvasAdapterPolicy(route,options),capability=buildManagedCanvasCapability(route,{},options);return{policy,capability,request:enqueueRequest(compileCanvasGenerationJob({canvasId:'managed-audio-fixture',projectId:'project-11111111-1111-4111-8111-111111111111',nodeId:'managed-audio-node',idempotencyKey:'managed-audio-'+choice,connectionId:`managed:fixed:${managedId}`,keyPriceQuoteId:managedQuote,capability,adapterPolicy:policy,cost:{billing:'platform_billed',description:'Offline exact quoted audio'},snapshot:{modelId:model,capabilityVersion:capability.version,mode:'imageToVideo',prompt:'Three characters wave',inputFingerprint:'managed-audio',resolvedInputs:[squareFrame],parameters:{resolution:'480p',aspectRatio:'auto',durationSeconds:2,generateAudio:choice}}}))};}
for(const choice of [true,false])test(`managed Wan3 current exact quoted audio=${choice} preserves UI choice through reconciliation and queue`,()=>{
 const route=managed(),{policy,capability,request}=managedCompile(route,choice);assert.deepEqual(policy.audioGeneration,optional);assert.equal(policy.audioRequestEnabled,undefined);assert.equal(request.input.requestAudio,choice);assert.equal(request.input.audioControlVersion,undefined);assert.equal(request.input.aspectRatio,'1:1');assert.equal(request.input.keyPriceQuoteId,managedQuote);assert.deepEqual(canvasAdapterInputIssues(policy,'video',request.input),[]);
 const original={resolution:'480p',aspectRatio:'auto',durationSeconds:2,generateAudio:choice},before=JSON.stringify(original),reconciled=reconcileCanvasGenerationParameters(capability,'imageToVideo',original,[squareFrame]);assert.equal(reconciled.parameters.generateAudio,choice);assert.equal(JSON.stringify(original),before);
});
test('managed audio uses exact current proof, not native-audio labels, stale quote or image price',()=>{
 const silent=managed([false]),p=buildManagedCanvasAdapterPolicy(silent,{kind:'video'});assert.deepEqual(p.audioGeneration,unsupported);assert.equal(p.audioRequestEnabled,false);assert.throws(()=>managedCompile(silent,true),{code:'CANVAS_CAPABILITY_INVALID'});
 for(const route of [managed([false,true],{keyPriceQuoteId:`kq1_${'b'.repeat(64)}`}),managed([false,true],{price:{videoInputImageEachMicros:1}}),managed([false,true],{videoLimits:{...managed().videoLimits,provenShapes:undefined}})]){const policy=buildManagedCanvasAdapterPolicy(route,{kind:'video'});assert.equal(policy.audioRequestEnabled,false);assert.equal(buildManagedCanvasCapability(route).modes.length,0);assert.throws(()=>managedCompile(route,true));}
});
test('fixed-on managed shape is required and cannot be silently replaced by false',()=>{
 const{policy,capability,request}=managedCompile(managed([true]),true);assert.deepEqual(policy.audioGeneration,required);assert.equal(request.input.requestAudio,true);assert.equal(resolveCanvasCapability(capability,{mode:'imageToVideo',resolution:'480p'}).audioGeneration.mode,'required');assert.throws(()=>managedCompile(managed([true]),false),{code:'CANVAS_CAPABILITY_INVALID'});
});
test('audio proof does not cover another duration, ratio, frame count or audio combination',()=>{
 const valid=managed(),p=buildManagedCanvasAdapterPolicy(valid,{kind:'video'}),input=managedCompile(valid,true).request.input;
 for(const patch of [{durationSeconds:3},{aspectRatio:'16:9',width:854,height:480},{firstFrameUri:undefined},{characterReferenceUris:['nextmux.media/extra.png']}])assert.ok(canvasAdapterInputIssues(p,'video',{...input,...patch}).length>0);
 const asymmetric=managed();asymmetric.videoLimits.provenShapes=[managedShape(false),{...managedShape(true),durationSeconds:3}];const policy=buildManagedCanvasAdapterPolicy(asymmetric,{kind:'video'});assert.ok(canvasAdapterInputIssues(policy,'video',input).some(x=>x.code==='CANVAS_MANAGED_SHAPE_UNPROVEN'));
});
test('an existing frozen false request is neither recompiled nor rewritten by newer audio proof',()=>{
 const original=Object.freeze({connectionId:`managed:fixed:${managedId}`,keyPriceQuoteId:managedQuote,model,requestAudio:false,durationSeconds:2,width:480,height:480,resolution:'480p',aspectRatio:'1:1',firstFrameUri:squareFrame.uri}),before=JSON.stringify(original),p=buildManagedCanvasAdapterPolicy(managed(),{kind:'video'});assert.deepEqual(canvasAdapterInputIssues(p,'video',original),[]);assert.equal(JSON.stringify(original),before);
});
