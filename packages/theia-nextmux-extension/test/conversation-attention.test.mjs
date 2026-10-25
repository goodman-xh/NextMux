import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { ConversationReceiptStore } from '../lib/node/nextmux-conversation-receipts.js';
import { ConversationIndex } from '../lib/node/nextmux-conversation-index.js';
import { conversationAttention, conversationAttentionLabel, conversationNoticeUnread, ConversationReadTracker, monotonicConversationCompletionAt } from '../lib/browser/nextmux-conversation-attention.js';

const turn = (patch={}) => ({ id:'turn-a', stage:'complete', createdAt:100, completedAt:200, ...patch });
const question = (patch={}) => ({ type:'user_input_requested', at:new Date(300).toISOString(), question:{runId:'run-a',taskId:'session-a',questionId:'q-a',createdAt:new Date(300).toISOString(),expiresAt:new Date(900).toISOString(), ...patch} });

test('terminal completion timestamps advance when Date.now shares a millisecond', () => {
  assert.equal(monotonicConversationCompletionAt(200, 0, 0), 200);
  assert.equal(monotonicConversationCompletionAt(200, 200, 200), 201);
  assert.equal(monotonicConversationCompletionAt(199, 201, 202), 203);
});

test('blue dot is an unread outcome, never simply an inactive conversation', () => {
  for (const stage of ['complete','paused','error','cancelled']) {
    const notice=conversationAttention('session-a',turn({stage}));
    assert.equal(conversationNoticeUnread(notice,undefined),true);
    assert.equal(conversationNoticeUnread(notice,notice),false);
    assert.equal(conversationNoticeUnread({...notice,noticeId:'next',noticedAt:201},notice),true);
  }
  assert.equal(conversationAttention('session-a',turn({stage:'running',response:'new streamed text'})),undefined);
  assert.equal(conversationAttention('session-a',turn({branchUserOnly:true})),undefined);
});

test('same-millisecond notices require their own acknowledgement, independent of UUID order', async () => {
  const tracker = new ConversationReadTracker({ read: async () => [], mark: async receipt => receipt, changed() {} });
  const base = conversationAttention('session-a', turn({ id: 'turn-a', completedAt: 200 }));
  const first = { ...base, noticeId: `${randomUUID()}:complete:200` };
  const second = { ...base, noticeId: `${randomUUID()}:complete:200` };
  tracker.accept(first);
  tracker.unread(second);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(tracker.unread(second), true);
  assert.equal(conversationNoticeUnread(second, first), true);
  tracker.accept(second);
  assert.equal(tracker.unread(second), false);
  assert.equal(tracker.unread(first), false);
  tracker.dispose();
});

test('questions and permission requests notify once and stop waiting when resolved or expired', () => {
  const pending = turn({stage:'running',events:[question()]});
  const notice=conversationAttention('session-a',pending,400);
  assert.equal(notice.kind,'question');
  assert.equal(conversationAttention('session-a',turn({stage:'running',events:[question({kind:'permission'})]}),400).kind,'permission');
  assert.equal(conversationAttention('session-a',pending,901),undefined);
  assert.equal(conversationAttention('session-a',turn({stage:'running',events:[question(),{type:'user_input_resolved',questionId:'q-a',at:new Date(400).toISOString()}]}),500),undefined);
  assert.equal(conversationAttention('session-a',turn({stage:'error',events:[question()]}),500).kind,'error');
});

test('read receipts persist across restart, keep newer events, and do not touch conversation files', async () => {
  const root=await mkdtemp(join(tmpdir(),'nm-attention-'));
  try {
    const path=join(root,'receipts.sqlite');
    const first=new ConversationReceiptStore(path);
    const receipt=conversationAttention('session-a',turn());
    assert.deepEqual(first.read(['session-a']),[]);
    first.mark(receipt);
    const reopened=new ConversationReceiptStore(path);
    assert.equal(conversationNoticeUnread(receipt,reopened.read(['session-a'])[0]),false);
    reopened.mark({...receipt,noticeId:'newer',noticedAt:400});
    first.mark(receipt);
    assert.equal(reopened.read(['session-a'])[0].noticeId,'newer');
    assert.throws(()=>first.read(Array(501).fill('session-a')));
    assert.throws(()=>first.mark({...receipt,sessionId:'../not-a-session'}));
    reopened.forget(['session-a']);
    assert.deepEqual(first.read(['session-a']),[]);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('durable receipts preserve every explicitly acknowledged event at the same timestamp', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nm-attention-tie-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ConversationReceiptStore(join(root, 'receipts.sqlite'));
  const first = conversationAttention('session-a', turn({ id: 'turn-a', completedAt: 200 }));
  const firstReceipt = { ...first, noticeId: `${randomUUID()}:complete:200` };
  const secondReceipt = { ...first, noticeId: `${randomUUID()}:complete:200` };
  store.mark(firstReceipt); store.mark(secondReceipt);
  const saved = store.read(['session-a']);
  assert.equal(saved.length, 2);
  for (const notice of [firstReceipt, secondReceipt]) {
    assert.equal(conversationNoticeUnread(notice, saved.find(row => row.noticeId === notice.noticeId)), false);
  }
});

test('acknowledgements do not hide unviewed events with older clocks or the same ID in a different conversation', async () => {
  const tracker = new ConversationReadTracker({ read: async () => [], mark: async receipt => receipt, changed() {} });
  const latest = conversationAttention('session-a', turn({ id: 'latest', completedAt: 500 }));
  const olderClock = conversationAttention('session-a', turn({ id: 'older-clock', completedAt: 100 }));
  const otherSession = { ...latest, sessionId: 'session-b' };
  tracker.accept({ ...latest, readAt: 2000 });
  for (const notice of [olderClock, otherSession]) tracker.unread(notice);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(tracker.unread(olderClock), true);
  assert.equal(tracker.unread(otherSession), true);
  assert.equal(conversationNoticeUnread(otherSession, latest), true);
  await tracker.seen(olderClock);
  assert.equal(tracker.unread(olderClock), false);
  assert.equal(tracker.unread(latest), false);
  tracker.dispose();
});

test('same-time clicks survive reversed writes, broadcasts, stale reads and reopening another window', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nm-attention-windows-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ConversationReceiptStore(join(root, 'receipts.sqlite'));
  const first = conversationAttention('session-a', turn({ id: 'a', completedAt: 200 }));
  const second = conversationAttention('session-a', turn({ id: 'b', completedAt: 200 }));
  store.mark({ ...first, readAt: 1000 });
  let finishRead;
  const oldRead = new Promise(resolve => { finishRead = resolve; });
  const pendingWrites = [];
  const broadcasts = [];
  const firstWindow = new ConversationReadTracker({ read: async () => oldRead,
    mark: receipt => new Promise(resolve => pendingWrites.push(() => resolve(store.mark(receipt)))),
    changed() {}, broadcast: receipt => broadcasts.push(receipt) });
  const secondWindow = new ConversationReadTracker({ read: async (ids, notices) => store.read(ids, notices), mark: async r => store.mark(r), changed() {} });
  firstWindow.unread(second);
  await Promise.resolve();
  const firstClick = firstWindow.seen(first);
  const secondClick = firstWindow.seen(second);
  pendingWrites[1](); pendingWrites[0]();
  await Promise.all([firstClick, secondClick]);
  secondWindow.accept(broadcasts[1]); secondWindow.accept(broadcasts[0]);
  finishRead([{ ...first, readAt: 1000 }]);
  await new Promise(resolve => setImmediate(resolve));
  const reopened = new ConversationReadTracker({ read: async (ids, notices) => store.read(ids, notices), mark: async r => store.mark(r), changed() {} });
  reopened.unread(first); reopened.unread(second);
  await new Promise(resolve => setImmediate(resolve));
  for (const window of [firstWindow, secondWindow, reopened]) {
    assert.equal(window.unread(first), false);
    assert.equal(window.unread(second), false);
    window.dispose();
  }
  assert.deepEqual(new Set(store.read(['session-a']).map(row => row.noticeId)), new Set([first.noticeId, second.noticeId]));
});

test('exact receipt queries pair session and notice IDs rather than taking their cross product', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nm-attention-pairs-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ConversationReceiptStore(join(root, 'receipts.sqlite'));
  for (const sessionId of ['a', 'b']) for (const noticeId of ['x', 'y']) store.mark({ sessionId, noticeId, noticedAt: 20, readAt: 1 });
  assert.deepEqual(store.read(['a', 'b'], ['x', 'y']).map(row => `${row.sessionId}:${row.noticeId}`).sort(), ['a:x', 'b:y']);
  assert.equal(store.read(['a']).length, 2, 'legacy reads remain supported');
  assert.throws(() => store.read(['a'], []));
  assert.throws(() => store.read(['a'], ['bad\0notice']));
  assert.throws(() => store.read([undefined]));
  store.mark({ sessionId: 'a', noticeId: 'x', noticedAt: 20, readAt: 5000 });
  store.mark({ sessionId: 'a', noticeId: 'x', noticedAt: 10, readAt: 1000 });
  assert.equal(store.read(['a'], ['x'])[0].readAt, 5000, 'stale writes cannot replace an acknowledgement');
});

for (const legacyReadAt of [false, true]) test(`legacy ${legacyReadAt ? 'four' : 'three'}-column receipts migrate without losing confirmations`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'nm-attention-migration-')); t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'receipts.sqlite');
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE receipts(session_id TEXT PRIMARY KEY,notice_id TEXT NOT NULL,noticed_at INTEGER NOT NULL${legacyReadAt ? ',read_at INTEGER NOT NULL DEFAULT 0' : ''})`);
  db.prepare(`INSERT INTO receipts VALUES(${legacyReadAt ? '?,?,?,?' : '?,?,?'})`).run(...['legacy', 'event-a', 200, ...(legacyReadAt ? [1000] : [])]);
  db.close();
  const store = new ConversationReceiptStore(path);
  const original = store.read(['legacy'], ['event-a']);
  assert.equal(original.length, 1);
  assert.equal(conversationNoticeUnread({ sessionId: 'legacy', noticeId: 'event-a', noticedAt: 200 }, original[0]), false);
  store.mark({ sessionId: 'legacy', noticeId: 'event-b', noticedAt: 200 });
  assert.equal(new ConversationReceiptStore(path).read(['legacy']).length, 2);
});

test('pending exact reads are batched once and ignore unrelated stale rows', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const queries = [];
  const notice = conversationAttention('session-a', turn());
  const tracker = new ConversationReadTracker({ read: async (ids, notices) => { queries.push([ids, notices]); return gate; }, mark: async r => r, changed() {} });
  tracker.unread(notice);
  await Promise.resolve();
  for (let i = 0; i < 50; i++) tracker.unread(notice);
  release([{ ...notice, noticeId: 'unrelated-event' }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(queries, [[['session-a'], [notice.noticeId]]]);
  assert.equal(tracker.unread(notice), true);
  tracker.dispose();
});

test('lazy receipt loading batches sidebar entries and cannot resurrect a just-read blue dot', async () => {
  let release; let writes=0, reads=0;
  const gate=new Promise(resolve=>{release=resolve;});
  const tracker=new ConversationReadTracker({read:async ids=>{reads++; await gate; return [];},mark:async r=>{writes++;return r;},changed:()=>{}});
  const notice=conversationAttention('session-a',turn());
  assert.equal(tracker.unread(notice),false);
  tracker.unread(conversationAttention('session-b',turn()));
  await Promise.resolve();
  await tracker.seen(notice);
  release();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reads,1);
  assert.equal(tracker.unread(notice),false);
  await tracker.seen(notice);
  assert.equal(writes,1);
  assert.equal(tracker.unread(conversationAttention('session-b',turn())),true);
  tracker.accept({...notice,noticedAt:400,noticeId:'peer-newer'});
  tracker.accept(notice);
  assert.equal(tracker.unread({...notice,noticeId:'peer-newer',noticedAt:400}),false);
  tracker.dispose();
});

test('failed persistence keeps an immediate read state without a render retry loop', async () => {
  let reads=0,writes=0;
  const tracker=new ConversationReadTracker({read:async()=>{reads++;throw Error('offline');},mark:async()=>{writes++;throw Error('offline');},changed:()=>{}});
  const notice=conversationAttention('session-a',turn());
  tracker.unread(notice);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(tracker.unread(notice),true);
  await tracker.seen(notice);
  for(let i=0;i<100;i++) assert.equal(tracker.unread(notice),false);
  assert.equal(reads,1); assert.equal(writes,1);
  tracker.dispose();
});

test('attention labels cover each UI locale and distinguish completion, answer and permission',()=>{
  for(const locale of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt-BR','ru','ar','hi']){
    const labels=['complete','error','paused','question','permission','cancelled'].map(kind=>conversationAttentionLabel(locale,kind));
    assert.equal(new Set(labels).size,6);
    assert.ok(labels.every(Boolean));
  }
});

test('a branch sharing earlier turn objects keeps independent read receipts', async()=>{
  const tracker=new ConversationReadTracker({read:async()=>[],mark:async r=>r,changed:()=>{}});
  const shared=turn();
  const original=tracker.notice('original',shared);
  const branch=tracker.notice('branch',shared);
  assert.equal(original.sessionId,'original');
  assert.equal(branch.sessionId,'branch');
  await tracker.seen(original);
  tracker.unread(branch);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(tracker.unread(branch),true);
  assert.equal(tracker.unread(original),false);
  tracker.dispose();
});

test('header-only sidebar rows retain pending attention without loading tool output or question text',()=>{
  const index=new ConversationIndex(':memory:');
  try {
    const created=Date.now(), expires=created+60_000;
    const pending=turn({stage:'running',events:[question({createdAt:new Date(created).toISOString(),expiresAt:new Date(expires).toISOString(),prompt:'private prompt'})]});
    index.upsert({id:'session-a',title:'Task',workspacePath:'/project',updatedAt:created,turns:[pending]});
    const row=index.list({limit:10}).sessions[0];
    assert.equal(row.turns.length,0);
    assert.equal(row.latestTurn.events,undefined);
    const notice=conversationAttention(row.id,row.latestTurn,created+100);
    assert.equal(notice.kind,'question');
    assert.equal(JSON.stringify(row).includes('private prompt'),false);
    assert.equal(conversationAttention(row.id,row.latestTurn,expires+1),undefined);
    index.upsert({id:'branch',title:'Branch',workspacePath:'/project',updatedAt:created+1,turns:[turn({branchUserOnly:true})]});
    const branch=index.list({limit:10}).sessions.find(row=>row.id==='branch');
    assert.equal(conversationAttention(branch.id,branch.latestTurn),undefined);
  } finally {index.close();}
});
