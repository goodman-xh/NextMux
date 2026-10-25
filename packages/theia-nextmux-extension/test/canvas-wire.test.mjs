import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceModule, comicCoreSource as core } from './helpers/comic-organizer-source-loader.mjs';
const {createCanvasNode,deleteFromCanvas}=sourceModule('browser/nextmux-comic-canvas-logic.ts');
const now='2026-10-03T00:00:00.000Z';
const make=(kind,id)=>({...createCanvasNode(kind,{x:0,y:0},{title:id}),id});
const media=(kind,id)=>({id,kind,title:id,position:{x:0,y:0},size:{width:280,height:280},payload:{versions:[{id:id+'-version',assetId:id+'-asset',kind,uri:'media/'+id,createdAt:now}],currentVersionId:id+'-version'}});
const edge=(role,source,target,extra={})=>({id:'reference',sourceNodeId:source.id,sourcePort:'output',targetNodeId:target.id,targetPort:role,role,order:0,binding:'followCurrent',...extra});

test('every supported reference role disconnects independently of playback links and preserves source assets',()=>{
    const cases=[['prompt','text','imageGen'],['character','character','videoGen'],['referenceImage','image','imageGen','imageToImage'],['firstFrame','image','videoGen','imageToVideo'],['lastFrame','image','videoGen','firstLastFrame'],['referenceImage','image','videoGen','referenceToVideo'],['referenceVideo','video','videoGen','referenceToVideo'],['referenceAudio','audio','videoGen','referenceToVideo'],['compositionVideo','video','composition'],['compositionAudio','audio','composition'],['referenceVideo','video','frameExtract'],['referenceImage','image','sceneComposer'],['referenceImage','image','world']];
    for(const [role,sourceKind,targetKind,mode] of cases){
        const source=sourceKind==='character'?{...media('image','source'),kind:'character',payload:{...media('image','source').payload,characterId:'character'}}:['image','video','audio'].includes(sourceKind)?media(sourceKind,'source'):make(sourceKind,'source');
        const target=make(targetKind,'target');if(mode)target.payload={...target.payload,mode};
        const canvas={...core.createCanvasDocument({id:'canvas',projectId:'project',now}),nodes:[source,target,make('videoGen','v1'),make('videoGen','v2')],edges:[edge(role,source,target,sourceKind==='image'?{binding:'pinnedVersion',pinnedVersionId:'source-version'}:{})],sequenceLinks:[{id:'playback',sourceNodeId:'v1',targetNodeId:'v2'}]};
        assert.deepEqual(core.validateCanvasDocument(canvas),[],role+' starts valid');const before=JSON.stringify(canvas);
        const next=deleteFromCanvas(canvas,[],['reference'],now);
        assert.equal(next.edges.length,0,role);assert.deepEqual(next.sequenceLinks,canvas.sequenceLinks,role+' does not remove playback');assert.deepEqual(next.nodes.find(node=>node.id==='source'),source,role+' preserves media');assert.equal(next.nodes.length,4,role+' does not delete nodes');assert.deepEqual(core.validateCanvasDocument(next),[],role+' remains valid');assert.equal(JSON.stringify(canvas),before,'deletion never mutates its undo snapshot');
    }
});

test('reference and playback links between the same nodes delete independently and together',()=>{
    const source=make('videoGen','source'),target=make('videoGen','target');target.payload={...target.payload,mode:'referenceToVideo'};
    const canvas={...core.createCanvasDocument({id:'canvas',projectId:'project',now}),nodes:[source,target],edges:[edge('referenceVideo',source,target)],sequenceLinks:[{id:'playback',sourceNodeId:source.id,targetNodeId:target.id}]};
    const playbackOnly=deleteFromCanvas(canvas,[],['playback'],now);assert.deepEqual(playbackOnly.edges,canvas.edges);assert.deepEqual(playbackOnly.nodes,canvas.nodes);assert.equal(playbackOnly.sequenceLinks.length,0);
    const both=deleteFromCanvas(canvas,[],['reference','playback'],now);assert.equal(both.edges.length,0);assert.equal(both.sequenceLinks.length,0);assert.equal(both.nodes.length,2);assert.equal(both.nodes[1].payload.mode,'textToVideo');
});
