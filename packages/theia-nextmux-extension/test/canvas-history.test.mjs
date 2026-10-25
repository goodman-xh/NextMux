import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceModule } from './helpers/comic-organizer-source-loader.mjs';
const {collectCanvasHistory,filterCanvasHistory,canvasHistoryVersionAvailable,canvasHistoryParameters,groupCanvasHistory,clampCanvasHistoryWindow}=sourceModule('browser/nextmux-comic-canvas-history-logic.ts');
const {canvasHistoryText,CANVAS_HISTORY_LOCALES}=sourceModule('browser/nextmux-comic-canvas-history-text.ts');
const snapshot={modelId:'model-original',prompt:'A sailboat',parameters:{resolution:'720p',aspectRatio:'16:9',generateAudio:false,apiKey:'not-for-display',headers:{Authorization:'not-for-display'}},resolvedInputs:[]};
const v=(id,patch={})=>({id,assetId:id,kind:'image',uri:'nextmux.media/same.png',createdAt:'2026-10-03T00:00:00Z',...patch});
const canvas=(id='one')=>({id,projectId:id,title:id,nodes:[{id:'node',title:'Picture',kind:'imageGen',payload:{versions:[v('older',{snapshot}),v('current',{createdAt:'2026-10-03T01:00:00Z',provenance:{jobId:'output-job'}})],currentVersionId:'current',jobs:[
    {idempotencyKey:'success',jobId:'output-job',snapshot,status:'succeeded',createdAt:'2026-10-03T01:00:00Z'},
    {idempotencyKey:'pending',snapshot,status:'running',createdAt:'2026-10-03T03:00:00Z'},
    {idempotencyKey:'failed',snapshot,status:'failed',createdAt:'2026-10-03T02:00:00Z'}]}}]});
test('actual history collection retains immutable versions and outstanding jobs without URL or cross-work deduplication',()=>{
    const original=canvas(),before=structuredClone(original),entries=collectCanvasHistory([original,canvas('two')]);
    assert.equal(entries.length,8);assert.equal(new Set(entries.map(entry=>entry.key)).size,8);assert.deepEqual(original,before);
    assert.equal(entries[0].job.idempotencyKey,'pending');assert.equal(entries.filter(entry=>entry.current).length,2);
    assert.equal(entries.filter(entry=>entry.version?.id==='current').length,2);assert.ok(entries.find(entry=>entry.version?.id==='current').snapshot);
    assert.equal(entries.filter(entry=>!entry.version&&entry.job?.idempotencyKey==='success').length,0,'persisted output is not repeated as an empty successful job');
    assert.equal(filterCanvasHistory(entries,{canvasId:'one',status:'failed'}).length,1);
    assert.equal(filterCanvasHistory(entries,{query:'sailboat',kind:'image',nodeId:'node'}).length,8);
    assert.equal(filterCanvasHistory(entries,{kind:'audio'}).length,0);
});
test('unavailable/uploading versions and output-less jobs cannot be selected; history metadata excludes private adapter keys',()=>{
    const doc=canvas();doc.nodes[0].payload.versions.push(v('missing',{status:'missing'}),v('upload',{status:'uploading'}),v('blank',{uri:' '}));
    const entries=collectCanvasHistory([doc]);for(const id of ['missing','upload','blank'])assert.equal(canvasHistoryVersionAvailable(entries.find(entry=>entry.version?.id===id)),false);
    assert.equal(canvasHistoryVersionAvailable(entries.find(entry=>entry.job?.idempotencyKey==='pending')),false);
    assert.equal(entries.find(entry=>entry.version?.id==='upload').status,'running');assert.equal(entries.find(entry=>entry.version?.id==='missing').status,'other');
    assert.deepEqual(canvasHistoryParameters(snapshot),{resolution:'720p',aspectRatio:'16:9',generateAudio:false});
});
test('history supports all 12 app locales and resolves every label and interpolation',()=>{
    const keys=['title','scope','all','node','search','success','running','failed','other','empty','current','select','unavailable','checking','noResult','model','prompt','parameters','close','refresh','failedAction','saving','previous','next','page','perPage','day','week','month','grid','list'];
    assert.equal(CANVAS_HISTORY_LOCALES.length,12);for(const locale of CANVAS_HISTORY_LOCALES)for(const key of keys){const text=canvasHistoryText(locale,key,{n:3,page:2,pages:5});assert.ok(text.trim(),`${locale}/${key}`);assert.doesNotMatch(text,/\{(?:n|page|pages)\}/);}
    assert.equal(canvasHistoryText('zh-HK','title'),canvasHistoryText('zh-TW','title'));assert.equal(canvasHistoryText('en-US','title'),canvasHistoryText('en','title'));
});
test('day/week/month grouping and restored floating bounds retain actual records and stay in the viewport',()=>{
    const entries=collectCanvasHistory([canvas()]);for(const mode of ['day','week','month'])assert.equal(groupCanvasHistory(entries,mode).flatMap(group=>group.entries).length,entries.length);
    for(const size of [{width:1600,height:900},{width:600,height:400}]){const rect=clampCanvasHistoryWindow({left:-500,top:9000,width:4000,height:4000},size);
        assert.ok(rect.left>=24&&rect.top>=24);assert.ok(rect.left+rect.width<=size.width-24);assert.ok(rect.top+rect.height<=size.height-24);}
});
