import assert from 'node:assert/strict';
import test from 'node:test';
import { comicCoreSource as core, sourceModule } from './helpers/comic-organizer-source-loader.mjs';
const { switchCanvasMode, createCanvasNode, connectCanvasNodes, planCanvasConnection, deleteFromCanvas, rerouteCanvasEdge } = sourceModule('browser/nextmux-comic-canvas-logic.ts');
const { switchCanvasModeKeepingInputs } = sourceModule('browser/nextmux-comic-canvas-options.ts');
const now='2026-10-04T00:00:00Z';
const version=(id,kind='image')=>({id,assetId:`asset-${id}`,kind,uri:`media/${id}.${kind==='image'?'png':'mp4'}`,createdAt:now});
const input=(id,role,kind='image')=>({id,role,order:0,version:version(id,kind)});
function fixture(mode,inputs,edges=[]){
 const node={...createCanvasNode('videoGen',{x:500,y:0},{videoModelId:'fixture',title:'Target'}),id:'target'};
 node.payload={...node.payload,mode,inputs};
 const picture={id:'source',kind:'image',title:'Source',position:{x:0,y:0},size:{width:360,height:260},payload:{versions:[version('source')],currentVersionId:'source'}};
 return {...core.createCanvasDocument({id:'canvas',projectId:'project',now}),nodes:[picture,node],edges};
}
const target=doc=>doc.nodes.find(node=>node.id==='target');
test('direct first and last frame references map to reference images and back with immutable identities',()=>{
 const original=fixture('firstLastFrame',[input('first','firstFrame'),input('last','lastFrame')]);
 const frozen=JSON.stringify(original);
 const next=switchCanvasModeKeepingInputs(original,'target','referenceToVideo',now);
 assert.ok(next);assert.equal(target(next).payload.mode,'referenceToVideo');
 assert.deepEqual(target(next).payload.inputs.map(item=>[item.role,item.version.id]),[['referenceImage','first'],['referenceImage','last']]);
 const restored=switchCanvasModeKeepingInputs(next,'target','firstLastFrame',now);
 assert.ok(restored);assert.deepEqual(target(restored).payload.inputs.map(item=>[item.role,item.version.id]),[['firstFrame','first'],['lastFrame','last']]);
 assert.equal(JSON.stringify(original),frozen);assert.deepEqual(core.validateCanvasDocument(restored),[]);
});
test('frame occupancy counts kept direct inputs and wires together; an incompatible selection is not silently dropped',()=>{
 const edge={id:'wire',sourceNodeId:'source',sourcePort:'output',targetNodeId:'target',targetPort:'firstFrame',role:'firstFrame',order:0,binding:'followCurrent'};
 const original=fixture('firstLastFrame',[input('last','lastFrame')],[edge]);
 assert.equal(switchCanvasModeKeepingInputs(original,'target','imageToVideo',now),undefined);
 const next=switchCanvasModeKeepingInputs(original,'target','referenceToVideo',now);
 const restored=switchCanvasModeKeepingInputs(next,'target','firstLastFrame',now);
 assert.ok(restored);assert.equal(restored.edges[0].role,'firstFrame');assert.equal(target(restored).payload.inputs[0].role,'lastFrame');
 assert.deepEqual(core.validateCanvasDocument(restored),[]);
 const dropped=switchCanvasMode(original,'target','textToVideo',now);
 assert.equal(target(dropped.canvas).payload.mode,'textToVideo');assert.equal(target(dropped.canvas).payload.inputs.length,0);
 assert.equal(dropped.dropped.length,1);assert.equal(dropped.droppedInputs.length,1);assert.equal(target(original).payload.inputs.length,1);
});
test('a video reference is never relabelled as a first-frame picture, and a compatible audio input is retained',()=>{
 const video=fixture('referenceToVideo',[input('video','referenceVideo','video')]);
 assert.equal(switchCanvasModeKeepingInputs(video,'target','imageToVideo',now),undefined);
 const original=fixture('referenceToVideo',[input('picture','referenceImage'),input('audio','referenceAudio','audio')]);
 const next=switchCanvasModeKeepingInputs(original,'target','imageToVideo',now);
 assert.ok(next);assert.deepEqual(target(next).payload.inputs.map(item=>item.role),['firstFrame','referenceAudio']);
 assert.deepEqual(core.validateCanvasDocument(next),[]);
});
test('actively wiring another picture after an inline first frame chooses the last-frame slot',()=>{
 const original=fixture('imageToVideo',[input('first','firstFrame')]);
 assert.deepEqual(planCanvasConnection(original,'source','target'),{role:'lastFrame',mode:'firstLastFrame'});
 const result=connectCanvasNodes(original,'source','target',now);
 assert.equal(result.error,undefined);assert.equal(target(result.canvas).payload.mode,'firstLastFrame');
 assert.equal(target(result.canvas).payload.inputs[0].version.id,'first');assert.equal(result.canvas.edges[0].role,'lastFrame');
 assert.deepEqual(core.validateCanvasDocument(result.canvas),[]);
});

test('deleting a prompt wire preserves remaining inline reference media and the corresponding mode',()=>{
 for(const [kind,mode,role]of [['videoGen','imageToVideo','firstFrame'],['videoGen','referenceToVideo','referenceImage'],['imageGen','imageToImage','referenceImage']]){
  let canvas=fixture(mode,[input('kept',role)]);
  canvas={...canvas,nodes:canvas.nodes.map(node=>node.id==='target'?{...node,kind}:node)};
  const text={id:'text',kind:'text',title:'Prompt',position:{x:0,y:100},size:{width:300,height:200},payload:{text:'extra prompt'}};
  const wire={id:'prompt-wire',sourceNodeId:'text',sourcePort:'output',targetNodeId:'target',targetPort:'prompt',role:'prompt',order:0,binding:'followCurrent'};
  const original={...canvas,nodes:[...canvas.nodes,text],edges:[wire]};
  const next=deleteFromCanvas(original,[],['prompt-wire'],now);
  assert.equal(target(next).payload.mode,mode);assert.deepEqual(target(next).payload.inputs,target(original).payload.inputs);
  assert.equal(next.edges.length,0);assert.deepEqual(core.validateCanvasDocument(next),[]);
 }
});

test('rerouting a wire into an occupied direct frame slot refuses without deleting either reference',()=>{
 const wire={id:'last-wire',sourceNodeId:'source',sourcePort:'output',targetNodeId:'target',targetPort:'lastFrame',role:'lastFrame',order:0,binding:'followCurrent'};
 const original=fixture('firstLastFrame',[input('kept-first','firstFrame')],[wire]);
 const frozen=JSON.stringify(original);
 const result=rerouteCanvasEdge(original,'last-wire','firstFrame',now);
 assert.equal(result.error,'ROLE_LIMIT');assert.equal(result.canvas,original);assert.equal(JSON.stringify(original),frozen);
});
