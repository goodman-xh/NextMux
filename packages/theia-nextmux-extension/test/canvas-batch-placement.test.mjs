import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceModule } from './helpers/comic-organizer-source-loader.mjs';
const { canvasBatchPlacementOffset, placeCanvasNode } = sourceModule('browser/nextmux-comic-canvas-logic.ts');

const node = (id, x, y, width=320, height=240, kind='imageGen') => ({ id, kind, title:id, position:{x,y},size:{width,height},payload:{prompt:id,versions:[]} });
const intersects = (a,b) => a.position.x < b.position.x+b.size.width && a.position.x+a.size.width > b.position.x
    && a.position.y < b.position.y+b.size.height && a.position.y+a.size.height > b.position.y;
function placed(canvas, batch, center) {
    const before=JSON.stringify({canvas,batch}),offset=canvasBatchPlacementOffset(canvas,batch,center);
    const result=batch.map(item=>({...item,position:{x:item.position.x+offset.x,y:item.position.y+offset.y}}));
    assert.equal(JSON.stringify({canvas,batch}),before,'placement never mutates saved or draft nodes');
    for(const item of result) for(const existing of canvas.nodes.filter(n=>n.kind!=='group')) assert.equal(intersects(item,existing),false,`${item.id} covers ${existing.id}`);
    for(let i=1;i<result.length;i++) assert.deepEqual({x:result[i].position.x-result[0].position.x,y:result[i].position.y-result[0].position.y},
        {x:batch[i].position.x-batch[0].position.x,y:batch[i].position.y-batch[0].position.y},'one translation retains batch spacing');
    return result;
}

test('AI multi-card placement avoids an existing card missed by the old first-card placeholder',()=>{
    const canvas={nodes:[node('source',0,0,498,280),node('obstacle',950,10,280,280)]};
    const batch=[node('first',758,0),node('second',1118,0)];
    const old=placeCanvasNode(canvas,{x:758,y:140});
    assert.deepEqual(old,{x:578,y:10});
    assert.equal(intersects({...batch[1],position:{x:old.x+360,y:old.y}},canvas.nodes[1]),true,'fixture reproduces the former second-card collision');
    const result=placed(canvas,batch,{x:758,y:140});
    assert.equal(result.length,2);assert.equal(result[0].payload,batch[0].payload);
});

test('the full bounds include negative coordinates, mixed sizes and later rows',()=>{
    const batch=[node('first',50,60,498,280),node('upperLeft',-400,-250,280,498),node('lastRow',180,720,640,360)];
    const canvas={nodes:[node('upper-obstacle',-700,-400,600,400),node('lower-obstacle',0,650,800,500)]};
    placed(canvas,batch,{x:0,y:0});
});

test('crowded placement falls beyond existing cards when the bounded diagonal search is exhausted',()=>{
    const canvas={nodes:[node('large-existing',-5000,-5000,10000,10000)]};
    const result=placed(canvas,[node('first',0,0),node('second',360,0)],{x:0,y:0});
    assert.ok(result[0].position.x >= 5040);
});

test('a lone draft uses its actual size and group backdrops do not push new cards away',()=>{
    const batch=[node('portrait',80,-50,280,498)],canvas={nodes:[node('group',-10000,-10000,20000,20000,'group')]};
    const result=placed(canvas,batch,{x:700,y:400});
    assert.deepEqual(result[0].position,{x:560,y:151});
});

test('an empty draft batch has no translation',()=>{
    assert.deepEqual(canvasBatchPlacementOffset({nodes:[]},[],{x:200,y:300}),{x:0,y:0});
});
