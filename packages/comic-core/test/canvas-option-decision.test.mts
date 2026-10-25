import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCanvasCommand, compileCanvasGenerationRequest, createCanvasDocument, createGenerationSnapshot, validateCanvasDocument } from '../lib/canvas.js';
import type { CanvasDocument, CanvasVideoGenNode } from '../lib/canvas.js';
import { reconcileCanvasGenerationParameters, resolveCanvasGenerationOptions, validateCanvasGenerationParameters } from '../lib/canvas-capabilities.js';
import type { CanvasModelCapability } from '../lib/canvas-capabilities.js';

const model: CanvasModelCapability = { id:'model',providerId:'fixture',providerModelId:'model',displayName:'Model',version:'fixture-v1',status:'available',sources:['fixture'],
  modes:[{mode:'textToVideo',defaultResolution:'720p',outputVariants:[
    {id:'720p',resolution:'720p',aspectRatios:['16:9','9:16'],defaultAspectRatio:'16:9'},
    {id:'1080p',resolution:'1080p',aspectRatios:['9:16'],durationOverride:{kind:'enum',seconds:[8],defaultSeconds:8},audioGenerationOverride:{mode:'required',defaultEnabled:true}}
  ],duration:{kind:'enum',seconds:[5,10],defaultSeconds:5},audioGeneration:{mode:'optional',defaultEnabled:false}}] };
const original = {resolution:'1080p',aspectRatio:'16:9',durationSeconds:5,generateAudio:false};
function canvas(): CanvasDocument {
  const node: CanvasVideoGenNode = {id:'generation',kind:'videoGen',title:'Video',position:{x:0,y:0},size:{width:320,height:300},
    payload:{modelId:'model',mode:'textToVideo',prompt:'A quiet harbor',parameters:original,versions:[]}};
  return applyCanvasCommand(createCanvasDocument({id:'canvas',projectId:'project'}),{type:'node.add',node});
}

test('one capability decision retains requested values and freezes the effective submission independently', () => {
  const result = reconcileCanvasGenerationParameters(model,'textToVideo',original);
  assert.deepEqual(result.parameters,{resolution:'1080p',aspectRatio:'9:16',durationSeconds:8,generateAudio:true});
  assert.deepEqual(result.optionDecision.adjustments.map(item=>item.path),['aspectRatio','durationSeconds','generateAudio']);
  assert.deepEqual(result.optionDecision.requested.parameters,original);
  const doc=applyCanvasCommand(canvas(),{type:'node.setParameters',nodeId:'generation',parameters:result.parameters,optionDecision:result.optionDecision});
  assert.deepEqual(validateCanvasDocument(doc),[]);
  const snapshot=createGenerationSnapshot(doc,'generation',{capabilityVersion:model.version});
  assert.ok(Object.isFrozen(snapshot.optionDecision?.effective.parameters));
  assert.deepEqual(compileCanvasGenerationRequest(snapshot).parameters,result.parameters);
  (result.optionDecision.requested.parameters as Record<string,unknown>).durationSeconds=999;
  (result.parameters as Record<string,unknown>).durationSeconds=999;
  assert.equal(snapshot.optionDecision?.requested.parameters.durationSeconds,5);
  assert.equal(snapshot.parameters.durationSeconds,8);
  assert.equal(snapshot.optionDecision?.capabilityVersion,'fixture-v1');
});

test('ordinary prompt edits retain the decision and raw model or parameter edits invalidate it', () => {
  const result=reconcileCanvasGenerationParameters(model,'textToVideo',original);
  const doc=applyCanvasCommand(canvas(),{type:'node.setParameters',nodeId:'generation',parameters:result.parameters,optionDecision:result.optionDecision});
  const prompt=applyCanvasCommand(doc,{type:'node.setParameters',nodeId:'generation',parameters:result.parameters,prompt:'Another harbor'});
  assert.deepEqual((prompt.nodes[0] as CanvasVideoGenNode).payload.optionDecision,result.optionDecision);
  for(const patch of [{parameters:{...result.parameters,durationSeconds:10}},{parameters:result.parameters,modelId:'different-model'}]) {
    const edited=applyCanvasCommand(doc,{type:'node.setParameters',nodeId:'generation',...patch});
    assert.equal((edited.nodes[0] as CanvasVideoGenNode).payload.optionDecision,undefined);
  }
  assert.equal(createGenerationSnapshot(canvas(),'generation',{capabilityVersion:model.version}).optionDecision,undefined,'legacy nodes remain compatible');
});

test('misattached decisions are rejected but final adapter-derived dimensions remain independent', () => {
  const result=reconcileCanvasGenerationParameters(model,'textToVideo',original);
  const doc=applyCanvasCommand(canvas(),{type:'node.setParameters',nodeId:'generation',parameters:result.parameters,optionDecision:result.optionDecision});
  const malformed=structuredClone(doc) as any;
  malformed.nodes[0].payload.optionDecision.effective.parameters.durationSeconds=5;
  assert.ok(validateCanvasDocument(malformed).some(issue=>issue.code==='OPTION_DECISION'));
  assert.throws(()=>createGenerationSnapshot(malformed,'generation',{capabilityVersion:model.version}),/Parameter decision/);
  const snapshot=createGenerationSnapshot(doc,'generation',{capabilityVersion:'refreshed-v2'});
  const adapterPrepared={...snapshot,parameters:{...snapshot.parameters,width:1080,height:1920}};
  assert.equal(compileCanvasGenerationRequest(adapterPrepared).parameters.width,1080);
  assert.equal(adapterPrepared.optionDecision?.capabilityVersion,'fixture-v1','editor provenance is distinct from current adapter capability');
  assert.throws(()=>compileCanvasGenerationRequest({...snapshot,optionDecision:{...result.optionDecision,modelId:'another'}}),/decision/i);
});

test('project preference is recorded as an adjustment, and reference evidence is never truncated', () => {
  const input={role:'referenceAudio' as const,kind:'audio' as const,versionId:'audio-v1',edgeId:'audio-edge',metadata:{durationMs:2000}};
  const result=reconcileCanvasGenerationParameters(model,'referenceToVideo',{resolution:'retired',aspectRatio:'1:1',durationSeconds:12,quality:'high'},[input],{aspectRatio:'9:16'});
  assert.equal(result.mode,'textToVideo');
  assert.equal(result.parameters.aspectRatio,'9:16');
  assert.equal(result.parameters.quality,undefined);
  assert.equal(result.optionDecision.requested.parameters.aspectRatio,'1:1');
  assert.equal(result.optionDecision.requested.mode,'referenceToVideo');
  assert.deepEqual(result.inputs,[input]);
  assert.ok(result.issues.some(issue=>issue.path.startsWith('inputs.')),'incompatible reference remains visible to validation');
});

test('complete quote proofs narrow durations, aspect and sound by the actual input count', () => {
  const mode={...model.modes[0],mode:'referenceToVideo' as const,duration:{kind:'enum' as const,seconds:[5,8,10],defaultSeconds:5},
    referenceRules:{image:{supported:true,maxCount:1}},combinationConstraints:[{combination:'image' as const,maxImages:1}],
    outputVariants:[{id:'720p',resolution:'720p',aspectRatios:['16:9','9:16'],requestShapes:[
      {aspectRatio:'16:9',durationSeconds:5,firstFrame:false,lastFrame:false,referenceImages:0,requestAudio:false,width:1280,height:720},
      {aspectRatio:'16:9',durationSeconds:10,firstFrame:false,lastFrame:false,referenceImages:0,requestAudio:true,width:1280,height:720},
      {aspectRatio:'9:16',durationSeconds:8,firstFrame:false,lastFrame:false,referenceImages:1,requestAudio:false,width:720,height:1280}
    ]}]};
  const proven={...model,modes:[mode]};
  const params={resolution:'720p',aspectRatio:'16:9',durationSeconds:5,generateAudio:false};
  const empty=resolveCanvasGenerationOptions(proven,'referenceToVideo',params,[]);
  assert.deepEqual(empty.variant?.aspectRatios,['16:9']);
  assert.deepEqual(empty.duration,{kind:'enum',seconds:[5,10],defaultSeconds:5});
  const longer=reconcileCanvasGenerationParameters(proven,'referenceToVideo',{...params,durationSeconds:10});
  assert.equal(longer.parameters.generateAudio,true);
  const input={role:'referenceImage' as const,kind:'image' as const,versionId:'image-v1',metadata:{width:720,height:1280}};
  const referenced=reconcileCanvasGenerationParameters(proven,'referenceToVideo',params,[input]);
  assert.deepEqual(referenced.parameters,{resolution:'720p',aspectRatio:'9:16',durationSeconds:8,generateAudio:false});
  assert.deepEqual(validateCanvasGenerationParameters(proven,'referenceToVideo',referenced.parameters,[input]),[]);
  assert.deepEqual(resolveCanvasGenerationOptions(proven,'referenceToVideo',params,[input,{...input,versionId:'image-v2'}]).duration,
    {kind:'enum',seconds:[],defaultSeconds:5},'no quote proof means no selectable legal duration');
});

test('native soundtrack evidence does not replace a route-fixed request audio flag', () => {
  const capability={...model,modes:[{...model.modes[0],audioGeneration:{mode:'required' as const,defaultEnabled:true},outputVariants:[
    {id:'720p',resolution:'720p',aspectRatios:['16:9'],requestAudioOverride:false,requestShapes:[
      {aspectRatio:'16:9',durationSeconds:5,firstFrame:false,lastFrame:false,referenceImages:0,requestAudio:false,width:1280,height:720}
    ]}
  ]}]};
  const parameters={resolution:'720p',aspectRatio:'16:9',durationSeconds:5,generateAudio:true};
  assert.deepEqual(resolveCanvasGenerationOptions(capability,'textToVideo',parameters).audioGeneration,{mode:'required',defaultEnabled:true});
  assert.deepEqual(validateCanvasGenerationParameters(capability,'textToVideo',parameters),[]);
});
