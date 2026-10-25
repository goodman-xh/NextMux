import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceModule, comicCoreSource as core } from './helpers/comic-organizer-source-loader.mjs';
const { prepareCanvasDragCopy: prepare, commitCanvasDragCopy: commit, canvasDragGroupMembers, canvasDragMoveRoots } = sourceModule('browser/nextmux-comic-canvas-drag-copy.ts');
const now='2026-10-03T00:00:00Z';
const version=(id,kind)=>({id:'v-'+id,assetId:'asset-'+id,kind,uri:'media/'+id,createdAt:now,metadata:{width:640,height:360,durationMs:5000}});
function fixture(){
    const media={id:'outside',kind:'image',title:'outside',position:{x:0,y:0},size:{width:100,height:100},payload:{versions:[version('outside','image')],currentVersionId:'v-outside'}};
    const video=id=>({id,kind:'videoGen',title:id,position:{x:id==='a'?200:500,y:100},size:{width:200,height:160},payload:{mode:id==='a'?'imageToVideo':'referenceToVideo',modelId:'test',prompt:'go',parameters:{},versions:[version(id,'video')],currentVersionId:'v-'+id,job:{id:'job-'+id,status:'running'}}});
    const edge=(id,source,target,role)=>({id,sourceNodeId:source,sourcePort:'output',targetNodeId:target,targetPort:role,role,order:0,binding:'pinnedVersion',pinnedVersionId:'v-'+source});
    return {...core.createCanvasDocument({id:'c',projectId:'p',now}),nodes:[media,video('a'),video('b'),video('down')],edges:[edge('in','outside','a','firstFrame'),edge('internal','a','b','referenceVideo'),edge('out','a','down','referenceVideo')],sequenceLinks:[{id:'chain',sourceNodeId:'a',targetNodeId:'b'}]};
}
test('Alt copies internal references and sequence; Cmd/Ctrl+Alt additionally keeps external input without touching output consumers',()=>{
    for(const duplicate of [false,true]){
        const canvas=fixture(),before=structuredClone(canvas),prepared=prepare(canvas,['a','b'],duplicate,now);assert.equal(prepared.ok,true);
        const result=commit(canvas,prepared.plan,{x:70,y:40},now);assert.equal(result.ok,true);assert.deepEqual(canvas,before);
        const [a,b]=result.ids.map(id=>result.canvas.nodes.find(node=>node.id===id));
        assert.deepEqual(a.position,{x:270,y:140});assert.deepEqual(b.position,{x:570,y:140});
        assert.equal(a.payload.job,undefined);assert.equal(a.payload.currentVersionId,'v-a');assert.equal(a.payload.versions[0].uri,'media/a');
        assert.equal(result.canvas.edges.some(e=>e.sourceNodeId===a.id&&e.targetNodeId==='down'),false);
        assert.equal(result.canvas.edges.filter(e=>e.targetNodeId===a.id).length,duplicate?1:0);
        assert.equal(result.canvas.edges.find(e=>e.targetNodeId===b.id).pinnedVersionId,'v-a');
        assert.deepEqual(result.canvas.sequenceLinks.at(-1),{id:prepared.plan.sequenceLinks[0].id,sourceNodeId:a.id,targetNodeId:b.id});
        assert.deepEqual(result.canvas.nodes.slice(0,canvas.nodes.length),canvas.nodes);assert.deepEqual(core.validateCanvasDocument(result.canvas),[]);
        assert.equal(result.canvas.revision,canvas.revision+1);
    }
});
test('selected group plus one selected child recursively copies each descendant once',()=>{
    const canvas=fixture();canvas.nodes.push({id:'group-node',kind:'group',title:'Group',position:{x:180,y:80},size:{width:550,height:230},payload:{groupId:'group'}});
    canvas.groups=[{id:'group',title:'Group',nodeIds:['a','b']}];
    const result=prepare(canvas,['group-node','a'],true,now);assert.equal(result.ok,true);assert.equal(result.plan.nodes.length,3);assert.equal(result.plan.groups.length,1);
    const committed=commit(canvas,result.plan,{x:200,y:100},now);assert.equal(committed.ok,true);assert.equal(committed.canvas.groups.at(-1).nodeIds.length,2);
    assert.deepEqual(core.validateCanvasDocument(committed.canvas),[]);assert.deepEqual(canvas.nodes.find(n=>n.id==='group-node').position,{x:180,y:80});
});
test('drop preserves concurrent unrelated edits and rejects deleted owners, cross-project scopes and invalidated pinned inputs atomically',()=>{
    const canvas=fixture(),prepared=prepare(canvas,['a','b'],true,now);assert.equal(prepared.ok,true);
    const updated={...canvas,revision:7,title:'edited during drag',nodes:canvas.nodes.map(n=>n.id==='down'?{...n,title:'new title'}:n)};
    const merged=commit(updated,prepared.plan,{x:10,y:20},now);assert.equal(merged.ok,true);assert.equal(merged.canvas.title,updated.title);assert.equal(merged.canvas.revision,8);assert.equal(merged.canvas.nodes.find(n=>n.id==='down').title,'new title');
    assert.equal(commit({...canvas,projectId:'other'},prepared.plan,{x:1,y:1},now).ok,false);
    assert.equal(commit({...canvas,nodes:canvas.nodes.filter(n=>n.id!=='a')},prepared.plan,{x:1,y:1},now).ok,false);
    const removedInput={...canvas,nodes:canvas.nodes.filter(n=>n.id!=='outside'),edges:canvas.edges.filter(e=>e.sourceNodeId!=='outside')};
    assert.equal(commit(removedInput,prepared.plan,{x:1,y:1},now).ok,false);assert.equal(removedInput.nodes.length,3);
});
test('ordinary moves reduce selected nested groups and members to outer roots independent of selection order',()=>{
    const canvas=fixture();canvas.nodes.push(
        {id:'inner-card',kind:'group',title:'Inner',position:{x:180,y:80},size:{width:550,height:230},payload:{groupId:'inner'}},
        {id:'outer-card',kind:'group',title:'Outer',position:{x:160,y:60},size:{width:600,height:300},payload:{groupId:'outer'}});
    canvas.groups=[{id:'inner',title:'Inner',nodeIds:['a','b'],parentGroupId:'outer'},{id:'outer',title:'Outer',nodeIds:['inner-card']}];
    assert.deepEqual([...canvasDragGroupMembers(canvas,'outer-card')].sort(),['a','b','inner-card']);
    for(const ids of [['a','b','outside','inner-card','outer-card'],['outer-card','inner-card','outside','b','a']])assert.deepEqual(canvasDragMoveRoots(canvas,ids).sort(),['outer-card','outside']);
    const moved=canvasDragMoveRoots(canvas,['a','b','outside','inner-card','outer-card']).reduce((next,id)=>{const source=canvas.nodes.find(node=>node.id===id);return core.applyCanvasCommand(next,{type:'node.move',nodeId:id,position:{x:source.position.x+60,y:source.position.y+40}},{now});},canvas);
    for(const id of ['a','b','outside','inner-card','outer-card']){const source=canvas.nodes.find(node=>node.id===id),actual=moved.nodes.find(node=>node.id===id);assert.deepEqual(actual.position,{x:source.position.x+60,y:source.position.y+40});}
    assert.deepEqual(canvasDragMoveRoots(canvas,['a','b']),['a','b'],'selecting members without their group keeps independent movement');
});
