import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { conversationWindowDelta: delta, applyConversationWindowDelta: apply, conversationTileBounds: bounds, ConversationWindowPublisher } = require('../lib/common/nextmux-conversation-window.js');
test('simultaneous model/draft and streaming changes do not overwrite each other', () => {
 const base = { id:'a', modelId:'original', draftPrompt:'draft', turns:[{id:'t',response:'hello',stage:'running'}] };
 const stream = {...base, turns:[{id:'t',response:'hello world',stage:'complete'}]};
 const edit = {...base,modelId:'new',draftPrompt:'next question'};
 const a=apply(apply(base,delta(base,stream)),delta(base,edit));
 const b=apply(apply(base,delta(base,edit)),delta(base,stream));
 assert.deepEqual(a,b);assert.equal(a.turns[0].response,'hello world');assert.equal(a.modelId,'new');assert.equal(a.draftPrompt,'next question');
});
test('removed fields and edited/deleted turns propagate explicitly',()=>{
 const before={id:'a',error:'old',turns:[{id:'1',response:'one'},{id:'2',response:'two'}]};
 const after={id:'a',turns:[{id:'1',response:'edited'}]};
 assert.deepEqual(apply(before,delta(before,after)),after);assert.equal(delta(after,after),undefined);
});
test('each tile stays within work area, including multi-monitor origins and overflow',()=>{
 for(const area of [{x:0,y:24,width:1369,height:850},{x:-1920,y:0,width:1920,height:1080},{x:0,y:0,width:800,height:600}]) for(const count of [1,2,3,7,25]) for(let i=0;i<count;i++){
 const b=bounds(area,i,count);assert.ok(b.x>=area.x);assert.ok(b.y>=area.y);assert.ok(b.x+b.width<=area.x+area.width);assert.ok(b.y+b.height<=area.y+area.height);
 }
});
test('failed synchronization retains every edit and retries in order before newer edits', async () => {
 const publisher = new ConversationWindowPublisher();
 const first = delta({id:'a'}, {id:'a',draftPrompt:'keep this draft'});
 const second = delta({id:'a'}, {id:'a',modelId:'selected'});
 await assert.rejects(publisher.publish([first], [], async () => false), error => error.code === 'CONVERSATION_WINDOW_SYNC_FAILED'
  && error.domainError?.params.reason === 'window_sync_failed' && error.data.domainError === error.domainError);
 const delivered = [];
 const send = async (changes,removed) => {delivered.push({changes,removed});return true;};
 await Promise.all([publisher.publish([second], [], send), publisher.publish([], ['b'], send)]);
 assert.deepEqual(delivered,[{changes:[first],removed:[]},{changes:[second],removed:[]},{changes:[],removed:['b']}]);
 await publisher.publish([], [], send);
 assert.equal(delivered.length,3);
});
test('applyConversationWindowDelta guards non-array turns.removed/upserts and preserves non-tail turn insertion and reordering', () => {
 const base = { id: 'a', turns: [{ id: '1', response: 'one' }, { id: '3', response: 'three' }] };
 assert.doesNotThrow(() => apply(base, { id: 'a', set: {}, unset: [], turns: { removed: null, upserts: null } }));
 assert.deepEqual(apply(base, { id: 'a', set: {}, unset: [], turns: { removed: undefined, upserts: {} } }), base);

 const insertedMiddle = {
  id: 'a',
  turns: [{ id: '1', response: 'one' }, { id: '2', response: 'two' }, { id: '3', response: 'three' }]
 };
 const dMid = delta(base, insertedMiddle);
 assert.deepEqual(dMid.turns.order, ['1', '2', '3']);
 assert.deepEqual(apply(base, dMid).turns.map(t => t.id), ['1', '2', '3']);

 const insertedHead = {
  id: 'a',
  turns: [{ id: '0', response: 'zero' }, { id: '1', response: 'one' }, { id: '3', response: 'three' }]
 };
 const dHead = delta(base, insertedHead);
 assert.deepEqual(apply(base, dHead).turns.map(t => t.id), ['0', '1', '3']);

 // Also preserves relative order when applying upserts without explicit order array
 const manualUpsert = {
  id: 'a',
  set: {},
  unset: [],
  turns: {
   removed: [],
   upserts: [
    { id: '0', set: { id: '0', response: 'zero' }, unset: [] },
    { id: '1', set: { id: '1', response: 'one' }, unset: [] },
    { id: '2', set: { id: '2', response: 'two' }, unset: [] }
   ]
  }
 };
 assert.deepEqual(apply(base, manualUpsert).turns.map(t => t.id), ['0', '1', '2', '3']);
});
