import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { createCanvasDocument } from '@nextmux/comic-core/canvas';
import { formatModelError } from '@nextmux/model-runtime/errors';

const helper=await readFile(new URL('../src/browser/nextmux-canvas-story.ts',import.meta.url),'utf8');
const helpers=await import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(helper,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64')}`);
const textSource=await readFile(new URL('../src/browser/nextmux-comic-canvas-story-text.ts',import.meta.url),'utf8');
const {canvasStoryText}=await import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(textSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64')}`);
const source=await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('widget.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),methods=[];
const names=new Set(['startComicScriptAdaptation','planComicCanvasStory','runComicPlanningRequest','deskCommand']);
(function visit(node){if(ts.isMethodDeclaration(node)&&names.has(node.name.getText(ast)))methods.push(node.getText(ast));ts.forEachChild(node,visit);})(ast);assert.equal(methods.length,names.size);
const deps={...helpers,canvasStoryText,window:{crypto:globalThis.crypto},modelFailure:(locale,error)=>formatModelError(error,locale),modelFailureText:(locale,error)=>formatModelError(error,locale).text,
    canvasVersionFromComicAsset:asset=>({id:`version-${asset.id}`,assetId:asset.id,kind:asset.kind,uri:asset.uri,createdAt:asset.createdAt}),
    createCanvasNode:()=>{throw Error('Creation is not expected in load-switch test');},placeCanvasNode:()=>({x:0,y:0}),applyCanvasCommand:()=>{throw Error('Unexpected canvas creation');}};
const compiled=ts.transpileModule(`const {${Object.keys(deps).join(',')}}=deps;class Widget{${methods.join('\n')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const Widget=new Function('deps',`${compiled};return Widget;`)(deps);
const now='2026-10-03T00:00:00Z';
function fixture(story='Moon opens a door.'){
    const hero={id:'hero',name:'Moon',aliases:['Luna'],appearance:'Short hair',referenceAssetIds:['portrait']};
    const portrait={id:'portrait',kind:'image',status:'ready',uri:'nextmux.media/portrait.png',createdAt:now};
    const project={id:'project-1',revision:0,characters:[hero],assets:[portrait],canvas:{aspectRatio:'16:9'}};
    const text={id:'story-node',kind:'text',title:'Story',position:{x:120,y:120},size:{width:360,height:260},payload:{text:story}};
    const character={id:'character-node',kind:'character',title:'Moon',position:{x:120,y:-200},size:{width:360,height:260},payload:{characterId:'hero',appearance:'Short hair',versions:[]}};
    const session={workspaceRoot:'/project',projectId:project.id,canvasId:'canvas-one',doc:{...createCanvasDocument({id:'canvas-one',projectId:project.id,now}),nodes:[text,character]}};
    const starts=[],polls=[],commands=[],saved=[],cancelled=[];
    let result={characters:[{name:'Moon',appearance:'Short hair'}],shots:[{title:'A door',prompt:'Moon opens the door.',characters:['Moon','Luna']}]};
    const widget=Object.assign(new Widget(),{comicAdaptation:{status:'idle'},comicDesk:{workspaceRoot:'/project'},activeComicWorkspaceRoot:'/project',desktopLocale:'en',comicState:{project},comicCanvas:session,
        comicProject(){return this.comicState.project;},comicTextRoute:()=>({}),comicAgentRoute:()=>({kind:'official'}),comicLanguageName:()=> 'English',
        comicCanvasIsTracked:()=>true,comicCanvasSession:()=>session,openComicDesk(){},ct:key=>key,update(){},comicCanvasNotice(){},
        canvasDefaultChoice:()=>({modelId:'video-provider',key:'official:video'}),changeComicCanvasSession:(target,doc)=>{target.doc=doc;},flushComicCanvas:async target=>{saved.push(structuredClone(target.doc));},
        platformService:{getComicTextModelLimits:async()=>({contextWindowTokens:32768,modelOutputTokenLimit:2048}),
            startAgentRun:async request=>{starts.push(request);return {runId:`agent-${starts.length}`};},
            getAgentRunSnapshot:async runId=>{polls.push(runId);if(widget.onPoll)await widget.onPoll(runId);return {status:'completed',nextEventIndex:1,result:{finalText:JSON.stringify(result)}};},
            cancelAgentRun:async id=>{cancelled.push(id);},
            applyComicCommand:async request=>{commands.push(request);if(widget.failCharacter){widget.failCharacter=false;throw Error('local save unavailable');}
                const current=widget.comicState.project;return {project:{...current,revision:current.revision+1,characters:[...current.characters,{id:'added-character',...request.command.character,referenceAssetIds:[]}]}};}}});
    return {widget,session,starts,polls,commands,saved,cancelled,setResult:value=>{result=value;},run:()=>widget.planComicCanvasStory(session,text.id)};
}
test('actual story widget keeps output caps, one identity across chunks/aliases, real portraits, and drafts without automatic media generation',async()=>{
    const f=fixture('Moon walks. '.repeat(750));await f.run();
    assert.equal(f.widget.comicAdaptation.status,'done');assert.ok(f.starts.length>1);
    assert.ok(f.starts.every(request=>request.comicMaximumOutputTokens===2048&&request.toolScope==='comic-json'&&request.permissionMode==='read_only'));
    const characters=f.session.doc.nodes.filter(node=>node.kind==='character'),shots=f.session.doc.nodes.filter(node=>node.kind==='videoGen');
    assert.equal(characters.length,1);assert.equal(characters[0].payload.versions[0].assetId,'portrait');assert.equal(f.commands.length,0);
    assert.equal(shots.length,f.starts.length);assert.equal(f.session.doc.sequenceLinks.length,shots.length-1);assert.ok(shots.every(node=>node.payload.versions.length===0));
    assert.equal(f.session.doc.edges.length,shots.length);const count=f.starts.length;await f.run();assert.equal(f.starts.length,count,'completed checkpoints do not call a model again');
});
test('poll interruption reopens the saved run; later character-write failure reuses the saved plan without another model request',async()=>{
    const f=fixture();let failed=false;f.widget.onPoll=async()=>{if(!failed){failed=true;throw Error('temporary polling connection loss');}};
    await f.run();assert.equal(f.starts.length,1);assert.equal(f.session.doc.settings.storyImports['story-node'].pendingRunId,'agent-1');
    f.session.doc=structuredClone(f.saved.at(-1));await f.run();assert.equal(f.starts.length,1);assert.deepEqual(f.polls,['agent-1','agent-1']);
    const g=fixture();g.setResult({characters:[{name:'New person',appearance:'Blue coat'}],shots:[{title:'Arrival',prompt:'New person arrives',characters:['New person']}]});g.widget.failCharacter=true;
    await g.run();assert.equal(g.starts.length,1);assert.ok(g.session.doc.settings.storyImports['story-node'].pendingPlan);assert.equal(g.session.doc.nodes.filter(node=>node.kind==='videoGen').length,0);
    g.session.doc=structuredClone(g.saved.at(-1));await g.run();assert.equal(g.starts.length,1);assert.equal(g.session.doc.nodes.filter(node=>node.kind==='videoGen').length,1);
});
test('edited/deleted stories reject late plans; switching projects keeps the new project state; switching tabs can save the captured canvas',async()=>{
    for(const kind of ['edit','delete','project','tab']){
        const f=fixture();f.widget.onPoll=async()=>{
            if(kind==='edit')f.session.doc={...f.session.doc,nodes:f.session.doc.nodes.map(node=>node.kind==='text'?{...node,payload:{text:'Edited while planning'}}:node)};
            if(kind==='delete')f.session.doc={...f.session.doc,nodes:f.session.doc.nodes.filter(node=>node.kind!=='text')};
            if(kind==='project'){f.widget.activeComicWorkspaceRoot='/other';f.widget.comicState={project:{id:'other-project',characters:[]}};f.widget.comicAdaptation={status:'idle',message:'new project'};}
            if(kind==='tab')f.widget.comicCanvas={canvasId:'other-tab',doc:{nodes:[]}};
        };await f.run();assert.equal(f.commands.length,0);
        assert.equal(f.session.doc.nodes.filter(node=>node.kind==='videoGen').length,kind==='tab'?1:0,kind);
        if(kind==='project')assert.equal(f.widget.comicAdaptation.message,'new project');
        if(kind==='edit'||kind==='delete')assert.match(f.widget.comicCanvasStoryRun.status,/story changed or was removed/);
    }
});
test('known-character context is counted before any model request, and diagnostics are redacted',async()=>{
    const f=fixture();f.widget.comicState.project.characters[0].appearance='巨大人物背景'.repeat(10000);await f.run();assert.equal(f.starts.length,0);
    const g=fixture();g.widget.onPoll=async()=>{throw Error('Authorization: Bearer sk-secret-fixture-never-display');};await g.run();assert.doesNotMatch(g.widget.comicCanvasStoryRun.status,/sk-secret-fixture-never-display/);
});
test('initial canvas load finishing after a project switch does not add a story or start planning',async()=>{
    const f=fixture();let done;f.session.load=new Promise(resolve=>{done=resolve;});const pending=f.widget.startComicScriptAdaptation('/project','new story');
    f.widget.activeComicWorkspaceRoot='/other';done();await pending;assert.equal(f.starts.length,0);assert.equal(f.saved.length,0);
});

test('all 12 story locales interpolate real progress and preserve localized late-source diagnostics',async()=>{
    const locales=['zh-CN','zh-TW','en','ja','ko','es','fr','de','pt-BR','ru','ar','hi'];
    const keys=['planning','progress','contextBudget','unknownCharacter','savedContinue','savedReady','incomplete','sourceChanged'];
    for(const locale of locales){
        for(const key of keys){
            const result=canvasStoryText(locale,key,{current:2,total:3,count:4,name:'Hero $& <name>'});
            assert.ok(result.length>0);assert.doesNotMatch(result,/\{(?:current|total|count|name)\}/);
            if(locale!=='en')assert.notEqual(result,canvasStoryText('en',key,{current:2,total:3,count:4,name:'Hero $& <name>'}),`${locale} ${key} must not fall back to English`);
            if(key==='unknownCharacter')assert.ok(result.includes('Hero $& <name>'),'dynamic text is literal, not a replacement pattern');
        }
        const f=fixture(),statuses=[];f.widget.desktopLocale=locale;f.widget.update=()=>statuses.push(f.widget.comicCanvasStoryRun?.status);
        await f.run();assert.equal(f.widget.comicAdaptation.status,'done');assert.ok(statuses.includes(canvasStoryText(locale,'planning')));
        assert.ok(statuses.includes(canvasStoryText(locale,'progress',{current:1,total:1,count:0})));
        assert.equal(f.widget.comicCanvasStoryRun.status,canvasStoryText(locale,'savedReady',{count:1}));
        const g=fixture();g.widget.desktopLocale=locale;g.widget.onPoll=async()=>{g.session.doc={...g.session.doc,nodes:g.session.doc.nodes.filter(node=>node.kind!=='text')};};
        await g.run();assert.ok(g.widget.comicCanvasStoryRun.status.includes(canvasStoryText(locale,'sourceChanged')));
        assert.ok(g.widget.comicCanvasStoryRun.status.startsWith(canvasStoryText(locale,'incomplete')));
        assert.equal(g.session.doc.nodes.filter(node=>node.kind==='videoGen').length,0);
    }
    assert.notEqual(canvasStoryText('zh-CN','savedReady',{count:3}),canvasStoryText('zh-TW','savedReady',{count:3}));
});
