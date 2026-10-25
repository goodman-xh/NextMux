import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const { createComicProject } = require('@nextmux/comic-core');
const { createCanvasDocument } = require('@nextmux/comic-core/canvas');
const { analyzeCanvasSequence } = require('@nextmux/comic-core/canvas-sequence');
const { createCanvasTimeline, editCanvasTimeline, restoreCanvasTimeline } = require('@nextmux/comic-core/canvas-timeline');
const { resolveComicComposition } = require('@nextmux/comic-core/composition');
const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['comicTimelineDocument','comicEditingProject','comicCutScopeKey','comicTimelineSelectionKey','applyComicTimelineState','selectComicTimeline',
    'commitComicCanvasToEditor','comicCutHistoryValid','comicCutHistoryEntry','applyComicCutLibraryState','runComicCutEdits','stepComicCutHistory','comicCutEpisodeNumber',
    'startComicExport','syncComicSelection','resolveComicCutAssetIds','insertComicCutAssets','importComicCutFiles']);
const methods = [];
(function walk(node) { if (ts.isMethodDeclaration(node) && names.has(node.name.getText(ast))) methods.push(node.getText(ast)); ts.forEachChild(node, walk); })(ast);
assert.equal(methods.length, names.size);
const compiled = ts.transpileModule(`class Widget {${methods.join('\n')}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const Widget = new Function('analyzeCanvasSequence','modelFailureText','canvasText','localizeDesktopSurface','comicCutText', `${compiled}; return Widget;`)(
    analyzeCanvasSequence, (_locale, error) => String(error), (_locale,key,args) => `${key}:${args?.error ?? ''}`, (_locale,text) => text, (_locale,key) => key);
const storage = new Map();
globalThis.window = { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key,value) => storage.set(key,value) } };
const now = '2026-10-03T00:00:00.000Z';
function fixture() {
    const main = createComicProject({ title: 'Main project', starter: 'empty', now });
    const version = { id:'version-video',assetId:'asset-frozen-video',kind:'video',uri:'nextmux.media/frozen.mp4',createdAt:now,metadata:{ durationMs:4000,width:96,height:64 } };
    const canvas = { ...createCanvasDocument({id:'canvas-free',projectId:main.id,now}), nodes:[{id:'node-video',kind:'video',title:'Source video',position:{x:0,y:0},size:{width:280,height:180},payload:{currentVersionId:version.id,versions:[version]}}] };
    let saved = createCanvasTimeline(canvas,main,{id:'timeline-widget-first',now});
    const session = { workspaceRoot:'/fixture',projectId:main.id,canvasId:canvas.id,isMain:false,doc:canvas,base:canvas,committing:false };
    const calls = [];
    const widget = Object.assign(new Widget(), {
        activeComicWorkspaceRoot:'/fixture',comicLoadSequence:1,comicTimelineSequence:0,comicCutOperation:0,comicState:{project:main},desktopLocale:'en',comicStage:'idle',
        comicTimeline:{workspaceRoot:'/fixture',document:saved},comicTimelines:[saved],comicCutBusy:false,comicCutImporting:false,comicTimelineLoading:false,
        comicUndoStack:[],comicRedoStack:[],comicUndoRevision:saved.revision,comicUndoWorkspaceRoot:'/fixture',comicUndoProjectId:saved.project.id,
        activeComicSceneId:saved.project.scenes[0].id,activeComicShotId:saved.project.scenes[0].shots[0].id,activeComicEpisodeId:'',comicCanvas:session,
        comicDesk:{step:'edit',projectId:main.id,workspaceRoot:'/fixture'},comicExportStage:'idle',comicExportState:{exports:[],defaultDirectory:''},comicExportDraft:{fileName:'Selected edit',quality:'balanced',subtitleMode:'none',episodeId:'stale-episode',allowPlaceholders:true,verifyAssetIntegrity:false},
        comicProject(){return this.comicState.project;},comicHasDirtyDraft:()=>false,update(){},persistComicDesk(){},comicCanvasSession:()=>session,comicCanvasProjectOf:()=>undefined,
        flushComicCanvas:async()=>{},comicCanvasNotice:(_session,message)=>calls.push(['notice',message]),
        comicCutClips:project=>project.scenes.flatMap(scene=>scene.shots.map(shot=>({sceneId:scene.id,shotId:shot.id,duration:shot.durationFrames/project.frameRate}))),
        scheduleComicLibraryRefresh(){},comicEpisodes(){throw Error('independent edit cannot consult episodes');},comicWorkspaceRequestCurrent(root,sequence){return root===this.activeComicWorkspaceRoot&&sequence===this.comicLoadSequence;},
        platformService:{
            applyComicCanvasTimelineEdits:async request=>{ calls.push(['edit',request]); const result=editCanvasTimeline(saved,request.edits,{now,availableProject:main}); saved=result.timeline; return result; },
            restoreComicCanvasTimeline:async request=>{ calls.push(['restore',request]); saved=restoreCanvasTimeline(saved,request.project,now); return saved; },
            applyComicEdits:()=>{throw Error('unexpected main project write');},restoreComicProject:()=>{throw Error('unexpected main project restore');},
            listComicCanvasTimelines:async(...args)=>{calls.push(['list',args]);return [saved];},getComicCanvasTimeline:async(...args)=>{calls.push(['get',args]);return saved;},
            createComicCanvasTimeline:async request=>{calls.push(['create',request]);saved=createCanvasTimeline(canvas,main,{id:'timeline-widget-second',now,paths:request.paths});return saved;},
            startComicExport:async request=>{calls.push(['export',request]);return {id:'export-1',timelineId:request.timelineId};}
        }
    });
    return {widget,main,canvas,session,calls,get saved(){return saved;}};
}

test('actual editor actions save only timeline, keep undo/redo and retain original project identity', async()=>{
    const f=fixture(),main=JSON.stringify(f.main),shot=f.saved.project.scenes[0].shots[0],scene=f.saved.project.scenes[0];
    await f.widget.runComicCutEdits([{type:'command',command:{type:'shot.split',sceneId:scene.id,shotId:shot.id,splitAtFrame:24}}]);
    assert.equal(f.widget.comicEditingProject().scenes[0].shots.length,2);assert.equal(f.widget.comicUndoStack.length,1);
    await f.widget.stepComicCutHistory('undo');assert.equal(f.widget.comicEditingProject().scenes[0].shots.length,1);
    await f.widget.stepComicCutHistory('redo');assert.equal(f.widget.comicEditingProject().scenes[0].shots.length,2);
    assert.equal(JSON.stringify(f.main),main);assert.equal(f.widget.comicProject().id,f.main.id);assert.equal(f.widget.comicCutEpisodeNumber(),undefined);
    assert.equal(f.widget.comicUndoRevision,f.saved.revision);
});

test('multi-track data, keyframes and source identity survive actual timeline edit/undo/redo routes', async()=>{
    const f=fixture(),main=JSON.stringify(f.main),composition=resolveComicComposition(f.saved.project),original=composition.clips.find(clip=>clip.kind==='video');
    const overlay={...original,id:'clip-overlay',trackId:'track-overlay',from:24,durationFrames:48,transform:{scale:.4,x:80},
        keyframes:[{property:'x',frame:0,value:80,easing:'easeIn'},{property:'x',frame:48,value:0,easing:'linear'}]};
    const next={...composition,tracks:[...composition.tracks,{id:'track-overlay',title:'Overlay',kind:'video'}],clips:[...composition.clips,overlay]};
    await f.widget.runComicCutEdits([{type:'composition',operation:{type:'replace',composition:next}}]);
    assert.equal(f.saved.project.composition.clips.find(clip=>clip.id==='clip-overlay').from,24);
    assert.ok(f.saved.project.assets.some(asset=>asset.id===original.assetId));
    await f.widget.stepComicCutHistory('undo');assert.equal(f.saved.project.composition,undefined);
    await f.widget.stepComicCutHistory('redo');
    assert.deepEqual(f.saved.project.composition.clips.find(clip=>clip.id==='clip-overlay').keyframes,overlay.keyframes);
    assert.equal(JSON.stringify(f.main),main);assert.equal(f.saved.project.scenes[0].shots.length,1);
});

test('enter edit restores the active free canvas saved edit; explicit new leaves old edit intact',async()=>{
    const f=fixture(),first=structuredClone(f.saved); f.widget.comicDesk.step='canvas';
    await f.widget.commitComicCanvasToEditor();assert.equal(f.widget.comicDesk.step,'edit');assert.equal(f.calls.some(([type])=>type==='create'),false);
    assert.deepEqual(f.calls.find(([type])=>type==='list')[1],['/fixture']);
    await f.widget.commitComicCanvasToEditor({newTimeline:true});
    assert.equal(f.widget.comicTimelineDocument().id,'timeline-widget-second');assert.equal(first.project.scenes[0].shots[0].durationFrames,96);
    assert.equal(f.calls.find(([type])=>type==='create')[1].canvasId,'canvas-free');assert.equal(f.widget.comicTimelines.length,2);
});

test('an acknowledgement failure retries the same timeline intent even when a saved edit already exists',async()=>{
    const f=fixture(),requests=[];let first=true;
    const create=f.widget.platformService.createComicCanvasTimeline;
    f.widget.platformService.createComicCanvasTimeline=async request=>{requests.push(request);if(first){first=false;throw Error('lost response');}return create(request);};
    await f.widget.commitComicCanvasToEditor({newTimeline:true});await f.widget.commitComicCanvasToEditor({newTimeline:true});
    assert.equal(requests.length,2);assert.equal(requests[0].requestId,requests[1].requestId);assert.equal(f.widget.comicTimelineRetry,undefined);
});

test('an empty canvas requires explicit choice before restoring an edit from another or deleted source canvas',async()=>{
    const f=fixture();f.session.canvasId='canvas-empty';f.session.doc={...f.canvas,id:'canvas-empty',nodes:[]};f.session.base=f.session.doc;f.widget.comicDesk.step='canvas';
    await f.widget.commitComicCanvasToEditor();
    assert.equal(f.widget.comicDesk.step,'canvas');assert.equal(f.calls.some(([type])=>type==='get'||type==='create'),false);
    assert.equal(f.widget.comicTimelineHistory.entries[0].id,f.saved.id);
    await f.widget.selectComicTimeline(f.saved.id);
    assert.equal(f.widget.comicDesk.step,'edit');assert.equal(f.widget.comicTimelineHistory,undefined);
    assert.equal(f.widget.comicTimelineDocument().sourceCanvasId,'canvas-free');
});

test('dismissing saved-edit choice or switching canvas while loading cannot reopen the old edit',async()=>{
    for(const change of ['dismiss','canvas']){
        const f=fixture();let finish;f.widget.comicDesk.step='canvas';f.widget.comicTimelineHistory={session:f.session,entries:[f.saved]};
        f.widget.platformService.getComicCanvasTimeline=()=>new Promise(resolve=>{finish=()=>resolve(f.saved);});
        const pending=f.widget.selectComicTimeline(f.saved.id);
        if(change==='dismiss')f.widget.comicTimelineHistory=undefined;else f.widget.comicCanvas={...f.session,canvasId:'canvas-other'};
        finish();await pending;assert.equal(f.widget.comicDesk.step,'canvas',change);assert.equal(f.widget.comicTimelineLoading,false,change);
    }
});

test('switching canvas during creation or edit never adopts stale results into the new canvas',async()=>{
    for(const action of ['create','edit']){
        const f=fixture();let finish;
        if(action==='create')f.widget.platformService.createComicCanvasTimeline=()=>new Promise(resolve=>{finish=()=>resolve(f.saved);});
        else f.widget.platformService.applyComicCanvasTimelineEdits=()=>new Promise(resolve=>{finish=()=>resolve({timeline:{...f.saved,revision:1},createdShotIds:[]});});
        const pending=action==='create'?f.widget.commitComicCanvasToEditor({newTimeline:true}):f.widget.runComicCutEdits([{type:'command',command:{type:'project.rename',title:'test'}}]);
        for(let i=0;i<8&&!finish;i++)await Promise.resolve(); assert.ok(finish);
        f.widget.comicCanvas={...f.session,canvasId:'canvas-other'};f.widget.comicDesk.step='canvas';finish();await pending;
        assert.equal(f.widget.comicTimelineDocument().revision,0);assert.equal(f.widget.comicDesk.step,'canvas');assert.equal(f.widget.comicCutBusy,false);
    }
});

test('ordinary main-project refresh neither invalidates a pending timeline edit nor selects a main-project shot',async()=>{
    const f=fixture(),scope=f.widget.comicCutScopeKey();f.widget.comicLoadSequence++;
    assert.equal(f.widget.comicCutScopeKey(),scope);f.widget.syncComicSelection('main-scene','main-shot');
    assert.equal(f.widget.activeComicShotId,f.saved.project.scenes[0].shots[0].id);
    f.widget.applyComicCutLibraryState({project:{...f.main,revision:10,assets:[]}});
    assert.equal(f.widget.comicUndoRevision,0);assert.equal(f.widget.comicCutHistoryValid(),true);
});

test('export uses the selected edit identity and revision; legacy range and unsafe flags cannot leak into the request',async()=>{
    const f=fixture();f.widget.comicExportTimeline={workspaceRoot:'/fixture',document:f.saved};
    assert.equal(await f.widget.startComicExport(),true);
    const request=f.calls.find(([type])=>type==='export')[1];
    assert.equal(request.timelineId,f.saved.id);assert.equal(request.expectedTimelineRevision,0);assert.equal(request.canvasId,f.canvas.id);
    assert.equal(request.episodeId,undefined);assert.equal(request.verifyAssetIntegrity,true);assert.equal(request.allowPlaceholders,false);
    assert.equal(f.widget.comicExportCurrentId,'export-1');
});

test('an external library import cannot insert media into another timeline after the user switches',async()=>{
    const f=fixture();let finish;const inserts=[];
    f.widget.importComicExternalMaterial=()=>new Promise(resolve=>{finish=resolve;});
    f.widget.runComicCutEdits=async edits=>{inserts.push(edits);return [];};
    f.widget.insertComicCutAssets(['external:/original.mp4','external:/second.mp4'],0);
    f.widget.comicCanvas={...f.session,canvasId:'other'};finish('asset-imported');
    await Promise.resolve();await Promise.resolve();await Promise.resolve();assert.deepEqual(inserts,[]);
});

test('video path choice copy is complete in all twelve locales',async()=>{
    const text=await readFile(new URL('../src/browser/nextmux-comic-canvas-timeline-text.ts',import.meta.url),'utf8');
    const output=ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
    const module={exports:{}};new Function('module','exports',output+'\nexports.en=en;exports.rows=rows;')(module,module.exports);
    for(const locale of ['zh-CN','zh-TW','en','ja','ko','es','fr','de','pt-BR','ru','ar','hi']){
        for(const key of [...Object.keys(module.exports.en),'chooseSaved','open','deletedSource','source'])assert.ok(module.exports.canvasTimelineText(locale,key).trim(),`${locale}/${key}`);
        if(locale!=='en')assert.equal((module.exports.rows[locale]??module.exports.rows[locale.split('-')[0]]).length,Object.keys(module.exports.en).length);
    }
});
