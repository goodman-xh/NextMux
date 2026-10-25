import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source=await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('widget.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const names=new Set(['transcribeComicShot','transcribeComicEpisode','stopComicEpisodeRecognition','cancelComicTranscription','comicTranscriptionMaximumPriceMicros','comicTranscriptionConsentKey']);
const methods=[];(function visit(node){if(ts.isMethodDeclaration(node)&&names.has(node.name.getText(ast)))methods.push(node.getText(ast));ts.forEachChild(node,visit);})(ast);
assert.equal(methods.length,names.size);
const compiled=ts.transpileModule(`class Widget{${methods.join('\n')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const Widget=new Function('modelFailureText',`${compiled};return Widget;`)((_locale,error)=>String(error));
function fixture(){
    let scope='project/canvas/timeline',resolve;
    const main={id:'project-main',revision:29,frameRate:24,assets:[],scenes:[]};
    const shot={id:'cut-shot',durationFrames:48,dialogueCues:[],audioAssetId:'audio-one'};
    const project={...main,id:'project-timeline',revision:4,scenes:[{id:'cut-scene',shots:[shot]}]};
    const timeline={id:'timeline-fixture',revision:4,project};
    const edits=[],requests=[],mainWrites=[],cancels=[];
    const widget=Object.assign(new Widget(),{activeComicWorkspaceRoot:'/project',comicLoadSequence:1,activeComicSceneId:'cut-scene',activeComicShotId:'cut-shot',desktopLocale:'en',
        comicProject:()=>main,comicEditingProject:()=>project,comicTimelineDocument:()=>timeline,comicCutScopeKey:()=>scope,comicTranscriptionRequestRoute:()=>undefined,
        update(){},ct:key=>key,openMediaSheet(){throw Error('Do not open the main project subtitle editor for a timeline');},
        selectComicLocation(){throw Error('Do not select main-project scenes');},comicScenesForActiveEpisode(){throw Error('The timeline has no episodes');},
        runComicCutEdits:async value=>{edits.push(value);project.revision++;timeline.revision++;return [];},commitComicCommand:async value=>{mainWrites.push(value);return {};},
        platformService:{transcribeComicShot:request=>{requests.push(request);return new Promise(done=>{resolve=()=>done({...request,revision:request.expectedRevision,timelineRevision:request.expectedTimelineRevision,cues:[{text:'Actual timed speech',startFrame:3,durationFrames:20}]});});},
            cancelComicShotTranscription:async(...args)=>{cancels.push(args);return {cancelled:true};}}});
    return {widget,main,project,timeline,requests,edits,mainWrites,cancels,finish:()=>resolve(),switchScope:()=>{scope='other-canvas';}};
}
test('actual widget transcription submits the independent timeline and saves cues through its editor/history route',async()=>{
    const f=fixture(),main=JSON.stringify(f.main),pending=f.widget.transcribeComicShot();
    assert.equal(f.requests[0].projectId,f.project.id);assert.equal(f.requests[0].timelineId,f.timeline.id);assert.equal(f.requests[0].expectedTimelineRevision,4);
    f.finish();assert.equal(await pending,true);assert.equal(f.edits[0][0].command.type,'dialogue.replace');assert.equal(f.edits[0][0].command.shotId,'cut-shot');
    assert.deepEqual(f.mainWrites,[]);assert.equal(JSON.stringify(f.main),main);assert.equal(f.widget.comicTranscriptionBusy,false);
});
test('switching canvas, changing revision or cancelling while ASR is pending never writes a stale cue',async()=>{
    for(const change of ['scope','revision','cancel']){
        const f=fixture(),pending=f.widget.transcribeComicShot();
        if(change==='scope')f.switchScope();else if(change==='revision')f.project.revision++;else await f.widget.cancelComicTranscription();
        f.finish();assert.equal(await pending,false,change);assert.deepEqual(f.edits,[],change);assert.deepEqual(f.mainWrites,[],change);
        if(change==='cancel')assert.equal(f.cancels.length,1);
    }
});
test('recognize all walks timeline clips without episodes; a canvas switch releases the old batch without changing the new UI',async()=>{
    const f=fixture(),pending=f.widget.transcribeComicEpisode();assert.equal(f.requests.length,1);f.finish();await pending;
    assert.equal(f.edits.length,1);assert.equal(f.widget.comicEpisodeRecognition,undefined);
    const switched=fixture(),other=switched.widget.transcribeComicEpisode();switched.switchScope();switched.finish();await other;
    assert.deepEqual(switched.edits,[]);assert.equal(switched.widget.comicEpisodeRecognition,undefined);assert.notEqual(switched.widget.comicMessage,'recognizeDone');
});
