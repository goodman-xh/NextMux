import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const core = require('@nextmux/comic-core');
const compositionCore = require('@nextmux/comic-core/composition');
const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['comicCompositionForProject','comicCompositionMediaAssets','commitComicComposition','insertComicCompositionAssets',
    'transcribeComicComposition','comicTranscriptionMaximumPriceMicros','comicTranscriptionConsentKey','comicAssetOnTimeline','ensureComicCompositionSubtitlePreview']);
const methods = [];
(function visit(node) { if (ts.isMethodDeclaration(node) && names.has(node.name.getText(ast))) methods.push(node.getText(ast)); ts.forEachChild(node, visit); })(ast);
assert.equal(methods.length, names.size);
const compiled = ts.transpileModule(`class Widget {${methods.join('\n')}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const Widget = new Function('resolveComicComposition','getComicAssetDurationFrames','comicCutText','comicCompositionClipPermissions', `${compiled}; return Widget;`)(
    compositionCore.resolveComicComposition, core.getComicAssetDurationFrames, (_locale,key) => key, compositionCore.comicCompositionClipPermissions);

function fixture() {
    const now = '2026-10-04T00:00:00.000Z';
    const asset = { id:'asset-film',kind:'video',uri:'nextmux.media/source.mp4',status:'ready',source:'imported',model:'film.mp4',
        durationMs:4000,streamStartMs:1250,createdAt:now,updatedAt:now };
    let project = { ...core.createComicProject({ title:'Editor',starter:'empty',now }), assets:[asset],
        composition:{schemaVersion:1,tracks:[{id:'track-picture',kind:'video',title:'Picture'}],clips:[{id:'clip-one',trackId:'track-picture',
            kind:'video',assetId:asset.id,from:48,durationFrames:48,sourceStartFrames:24,title:'Selected range'}]} };
    const main = {...project,id:'project-main',composition:undefined}, requests=[], snapshots=[], history=[];
    let scope='scope-one';
    const widget = Object.assign(new Widget(), { comicCompositionCache:new WeakMap(), comicCompositionMediaCache:new WeakMap(), desktopLocale:'en', activeComicWorkspaceRoot:'/fixture', comicStage:'idle',
        comicProject:()=>main,comicEditingProject:()=>project,comicCutScopeKey:()=>scope,comicCutAssets:()=>[{id:asset.id,title:'Film'}],comicMediaUrl:uri=>'file:///'+uri,
        resolveComicCutAssetIds:async ids=>ids,comicTimelineDocument:()=>({id:'timeline-fixture',revision:project.revision,project}),
        comicTranscriptionRequestRoute:()=>undefined,ct:key=>key,update(){},
        runComicCutEdits:async edits=>{history.push(project);project=core.applyComicEditorEdits(project,edits,{now}).project;snapshots.push(structuredClone(project));return [];},
        platformService:{transcribeComicShot:async request=>{requests.push(request);return {...request,revision:project.revision,timelineRevision:project.revision,
            cues:[{text:'Source range speech',startFrame:12,durationFrames:60}]};}} });
    return {widget,asset,main,requests,snapshots,history,get project(){return project;},set project(value){project=value;},switchScope(){scope='scope-two';}};
}

test('multi-track edits use existing project edit/history route and preserve source project',async()=>{
    const f=fixture(),main=JSON.stringify(f.main);
    const next={...f.project.composition,tracks:[...f.project.composition.tracks,{id:'track-overlay',kind:'video',title:'Overlay'}]};
    assert.equal(await f.widget.commitComicComposition(next),true);
    assert.equal(f.project.composition.tracks.length,2);assert.equal(f.history.length,1);
    assert.equal(f.project.revision,f.history[0].revision+1);assert.equal(JSON.stringify(f.main),main);
});

test('library insertion uses independent frame position and exact source duration',async()=>{
    const f=fixture();
    assert.equal(await f.widget.insertComicCompositionAssets([f.asset.id],'track-picture',12),true);
    const added=f.project.composition.clips.at(-1);
    assert.equal(added.from,12);assert.equal(added.durationFrames,96);assert.equal(added.sourceStartFrames,0);
    assert.equal(f.project.composition.clips[0].from,48,'existing clips never ripple by accident');
    f.project={...f.project,composition:{...f.project.composition,tracks:[{...f.project.composition.tracks[0],locked:true}]}};
    assert.equal(await f.widget.insertComicCompositionAssets([f.asset.id],'track-picture',0),false);
});

test('resolved external assets cannot land in a different editor after a scope switch',async()=>{
    const f=fixture();let resolve;
    f.widget.resolveComicCutAssetIds=()=>new Promise(done=>{resolve=done;});
    const pending=f.widget.insertComicCompositionAssets(['external:source'],'track-picture',0);
    f.switchScope();resolve([f.asset.id]);assert.equal(await pending,false);assert.equal(f.snapshots.length,0);
});

test('preview media keeps frozen aliases and nonzero stream origin, even when the bin deduplicates',()=>{
    const f=fixture(),alias={...f.asset,id:'asset-alias'};
    f.project={...f.project,assets:[f.asset,alias]};
    const assets=f.widget.comicCompositionMediaAssets(f.project);
    assert.equal(assets.length,2);assert.equal(assets[1].id,'asset-alias');assert.equal(assets[0].streamStartMs,1250);
    assert.equal(f.widget.comicCompositionMediaAssets(f.project),assets,'transport updates preserve preview asset identity');
    f.widget.comicPlayback={root:'/fixture',copies:{[f.asset.uri]:'nextmux.media/proxy.mp4'}};
    assert.notEqual(f.widget.comicCompositionMediaAssets(f.project),assets,'newly prepared playback copies refresh media URLs');
    assert.equal(f.widget.comicCompositionMediaAssets(f.project)[0].streamStartMs,0,'playback copies are normalized by their remuxer');
});

test('ASR binds to saved composition source range and places clipped captions at timeline time',async()=>{
    const f=fixture();await f.widget.transcribeComicComposition();
    assert.equal(f.requests.length,1);assert.equal(f.requests[0].compositionClipId,'clip-one');assert.equal(f.requests[0].timelineId,'timeline-fixture');
    const caption=f.project.composition.clips.find(clip=>clip.purpose==='subtitle');
    assert.equal(caption.from,60);assert.equal(caption.durationFrames,36);assert.equal(caption.captionSourceClipId,'clip-one');
    assert.equal(f.widget.comicEpisodeRecognition,undefined);assert.equal(f.widget.comicTranscriptionBusy,false);
    await f.widget.transcribeComicComposition();assert.equal(f.requests.length,1,'existing captions are not duplicated');
});

test('ASR result is discarded when revision changes while recognition is pending',async()=>{
    const f=fixture();let resolve;
    f.widget.platformService.transcribeComicShot=request=>new Promise(done=>{resolve=()=>done({...request,revision:request.expectedRevision,timelineRevision:request.expectedTimelineRevision,cues:[{text:'stale',startFrame:0,durationFrames:24}]});});
    const pending=f.widget.transcribeComicComposition();
    f.project={...f.project,revision:f.project.revision+1};resolve();await pending;
    assert.equal(f.snapshots.length,0);assert.equal(f.widget.comicTranscriptionBusy,false);
});

test('an empty embedded-caption descriptor does not prevent ASR and is replaced only after success',async()=>{
    const f=fixture();
    f.project={...f.project,composition:{...f.project.composition,tracks:[...f.project.composition.tracks,{id:'track-captions',kind:'text',title:'Captions'}],
        clips:[...f.project.composition.clips,{id:'native-source',trackId:'track-captions',kind:'text',assetId:f.asset.id,purpose:'subtitle',captionSourceClipId:'clip-one',from:48,durationFrames:48,sourceStartFrames:24}]}};
    f.widget.comicCompositionSubtitlePreview={key:'test',cues:{[f.asset.id]:[]}};
    await f.widget.transcribeComicComposition();
    assert.equal(f.requests.length,1);assert.ok(!f.project.composition.clips.some(clip=>clip.id==='native-source'));
    assert.equal(f.project.composition.clips.filter(clip=>clip.captionSourceClipId==='clip-one').length,1);
});

test('finishing an old ASR batch does not clear a new project recognition request',async()=>{
    const f=fixture();let resolve;
    f.widget.platformService.transcribeComicShot=request=>new Promise(done=>{resolve=()=>done({...request,revision:request.expectedRevision,timelineRevision:request.expectedTimelineRevision,cues:[]});});
    const pending=f.widget.transcribeComicComposition();f.switchScope();
    f.widget.comicTranscriptionRun={requestId:'new-project-request',workspaceRoot:'/new-project'};
    f.widget.comicTranscriptionBusy=true;f.widget.comicTranscriptionCompositionClipId='new-project-clip';
    resolve();await pending;
    assert.equal(f.widget.comicTranscriptionRun.requestId,'new-project-request');assert.equal(f.widget.comicTranscriptionBusy,true);
    assert.equal(f.widget.comicTranscriptionCompositionClipId,'new-project-clip');assert.equal(f.snapshots.length,0);
});

test('subtitle preview retries a stale revision once the current revision advances',async()=>{
    const f=fixture();let calls=0;
    f.project={...f.project,composition:{...f.project.composition,tracks:[...f.project.composition.tracks,{id:'captions',kind:'text',title:'Captions'}],clips:[...f.project.composition.clips,{id:'native-source',trackId:'captions',kind:'text',assetId:f.asset.id}]}};
    f.widget.platformService.getComicCompositionSubtitlePreview=async()=>{calls++;if(calls===1)throw new Error('revision changed');return{cues:{[f.asset.id]:[{text:'Recovered',startFrame:0,durationFrames:24}]}};};
    f.widget.ensureComicCompositionSubtitlePreview(f.project,f.project.composition);await new Promise(setImmediate);
    f.widget.ensureComicCompositionSubtitlePreview(f.project,f.project.composition);assert.equal(calls,1,'same-revision errors do not create a request loop');
    f.project={...f.project,revision:f.project.revision+1};
    f.widget.ensureComicCompositionSubtitlePreview(f.project,f.project.composition);await new Promise(setImmediate);
    assert.equal(calls,2);assert.equal(f.widget.comicCompositionSubtitlePreview.cues[f.asset.id][0].text,'Recovered');
});

test('ASR price ceiling follows the independent clip duration, not a legacy shot',()=>{
    const f=fixture();f.widget.comicTranscriptionCompositionClipId='clip-one';
    const route={offering:{price:{mode:'direct'},pricingDetails:{dimensions:[{metric:'audio_second',user:{amountMicros:10,unitSize:1}}]}}};
    assert.equal(f.widget.comicTranscriptionMaximumPriceMicros(route),30);
});
