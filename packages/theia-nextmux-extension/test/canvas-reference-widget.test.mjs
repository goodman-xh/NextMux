import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { sourceModule, comicCoreSource } from './helpers/comic-organizer-source-loader.mjs';

const logic=sourceModule('browser/nextmux-comic-canvas-logic.ts');
const attachment=sourceModule('common/nextmux-canvas-reference-attachment.ts');
const source=await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('widget.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),methods=[];
const names=new Set(['attachComicCanvasReference','useCanvasLibraryItem','importComicCanvasFiles','useComicCanvasPortrait','adoptComicCanvas','refreshComicCanvas', 'comicCanvasVideoInputFingerprint', 'invalidateComicCanvasVideoInputs']);
(function visit(node){if(ts.isMethodDeclaration(node)&&names.has(node.name.getText(ast)))methods.push(node.getText(ast));ts.forEachChild(node,visit);})(ast);assert.equal(methods.length,names.size);
const deps={...logic,...attachment,canvasIssueText:(_locale,issue)=>issue.code,applyCanvasCommand:comicCoreSource.applyCanvasCommand,window:{crypto:globalThis.crypto,nextmuxDesktop:{getPathForFile:file=>file.path}},
    canvasText:(_locale,key,args)=>`${key}${args?.error?`: ${args.error}`:''}`,modelFailureText:(_locale,error)=>String(error.message)};
const compiled=ts.transpileModule(`const {${Object.keys(deps).join(',')}}=deps;class Widget{comicCanvasVideoInputs = new WeakMap();${methods.join('\n')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const Widget=new Function('deps',`${compiled};return Widget;`)(deps);
const now='2026-10-03T00:00:00Z';
const version=(id,kind='image')=>({id:`v-${id}`,assetId:`asset-${id}`,kind,uri:`media/${id}.${kind==='image'?'png':kind==='video'?'mp4':'wav'}`,createdAt:now});
const media=(id,kind='image')=>({id,kind,title:id,position:{x:0,y:0},size:{width:360,height:260},payload:{versions:[version(id,kind)],currentVersionId:`v-${id}`}});
const edge=(id,sourceNodeId,role)=>({id,sourceNodeId,sourcePort:'output',targetNodeId:'target',targetPort:role,role,order:0,binding:'followCurrent'});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
function fixture(){
    const project={id:'project-a',revision:3,characters:[]};
    const target={...logic.createCanvasNode('videoGen',{x:500,y:0},{title:'Target',videoModelId:'test-video'}),id:'target'};
    target.payload={...target.payload,mode:'firstLastFrame'};
    const doc={...comicCoreSource.createCanvasDocument({id:'canvas-a',projectId:project.id,now}),nodes:[media('old-first'),media('old-last'),media('new-first'),media('new-last'),media('audio','audio'),target],edges:[edge('first','old-first','firstFrame'),edge('last','old-last','lastFrame')]};
    const session={workspaceRoot:'/project-a',projectId:project.id,canvasId:doc.id,doc,base:doc,save:'saved'},tracked=new Set([session]);
    const other={workspaceRoot:'/project-b',projectId:'project-b',canvasId:'canvas-b',doc:comicCoreSource.createCanvasDocument({id:'canvas-b',projectId:'project-b',now}),save:'saved'};
    const imports=[],binds=[],changes=[],flushes=[],notices=[],loads=[],projectReads=[],picker=[];
    const widget=Object.assign(new Widget(),{desktopLocale:'en',activeComicWorkspaceRoot:session.workspaceRoot,comicCanvas:session,comicState:{project},
        comicProject(){return this.comicState.project;},comicCanvasIsTracked:item=>tracked.has(item),update(){},notifyComicCanvasJobs(){},
        comicCanvasNotice:(item,text)=>notices.push({item,text}),changeComicCanvasSession:(item,next)=>{changes.push({item,next});item.doc=next;item.save='dirty';},
        flushComicCanvas:async item=>{flushes.push(item);if(widget.onFlush)await widget.onFlush(item);item.base=item.doc;item.save='saved';},
        loadComicProject:async()=>loads.push(widget.activeComicWorkspaceRoot),fileDialogService:{showOpenDialog:async options=>{picker.push(options);if(widget.onPicker)return widget.onPicker();return {path:{fsPath:()=>'/reference.png'}};}},
        platformService:{importComicCanvasAsset:async request=>importAsset(request,'upload'),importComicAssetLibraryAsset:async request=>importAsset(request,'library'),
            getComicProject:async root=>{projectReads.push(root);return {project};},getComicCanvas:async()=>({canvas:session.doc}),
            bindComicCanvasCharacter:async request=>{binds.push(request);if(widget.onBind)return widget.onBind(request);return {project:{...project,revision:project.revision+1}};}}});
    async function importAsset(request,kind){imports.push({request,kind});const baseline=session.base;if(widget.onImport)await widget.onImport(request);const mediaKind=/\.(mp4|mov|webm|m4v)$/i.test(request.path??'')?'video':/\.(mp3|wav|m4a|aac|ogg)$/i.test(request.path??'')?'audio':'image';const node=media(`returned-${imports.length}`,mediaKind);
        if(request.target)return {nodeId:request.target.nodeId,state:{canvas:attachment.attachCanvasReferenceVersion(baseline,request.target,node.payload.versions[0],`input-${node.id}`,now)}};
        return {nodeId:node.id,state:{canvas:{...baseline,revision:baseline.revision+1,nodes:[...baseline.nodes,node]}}};}
    function switchProject(){tracked.add(other);widget.comicCanvas=other;widget.activeComicWorkspaceRoot=other.workspaceRoot;widget.comicState={project:{id:other.projectId,revision:20,characters:[]}};}
    return {widget,session,other,tracked,imports,binds,changes,flushes,notices,loads,projectReads,picker,switchProject};
}

test('actual attachment replaces only the requested first/last frame and rejects invalid references without changing the canvas',async()=>{
    const f=fixture();await f.widget.attachComicCanvasReference(f.session,'new-first','target','firstFrame');
    assert.deepEqual(f.session.doc.edges.map(item=>[item.role,item.sourceNodeId]),[['lastFrame','old-last']]);
    assert.equal(f.session.doc.nodes.find(node=>node.id==='target').payload.inputs.find(input=>input.role==='firstFrame').version.id,'v-new-first');
    await f.widget.attachComicCanvasReference(f.session,'new-last','target','lastFrame');
    assert.equal(f.session.doc.edges.length,0);
    assert.deepEqual(f.session.doc.nodes.find(node=>node.id==='target').payload.inputs.map(input=>[input.role,input.version.id]).sort(),[['firstFrame','v-new-first'],['lastFrame','v-new-last']]);
    assert.deepEqual(comicCoreSource.validateCanvasDocument(f.session.doc),[]);
    for(const [sourceId,targetId]of [['audio','target'],['new-first','missing']]){const original=f.session.doc,count=f.changes.length,flushed=f.flushes.length;
        await assert.rejects(f.widget.attachComicCanvasReference(f.session,sourceId,targetId,'firstFrame'));assert.equal(f.session.doc,original);assert.equal(f.changes.length,count);assert.equal(f.flushes.length,flushed);}
});
test('upload and library imports send inline targets to the backend and stay bound to the captured canvas after a tab/project switch',async()=>{
    for(const route of ['upload','library']){const f=fixture(),gate=deferred();f.widget.onImport=()=>gate.promise;const position={x:30,y:40};
        const pending=route==='upload'?f.widget.importComicCanvasFiles(position,[{path:'/ref.png'}],{nodeId:'target',role:'firstFrame'},f.session)
            :f.widget.useCanvasLibraryItem(f.session,'library-picture',position,'request-1',{nodeId:'target',role:'firstFrame'});
        while(!f.imports.length)await new Promise(resolve=>setImmediate(resolve));f.switchProject();const otherDoc=f.other.doc;gate.resolve();await pending;
        assert.equal(f.imports[0].request.workspaceRoot,'/project-a');assert.equal(f.imports[0].request.canvasId,'canvas-a');
        assert.deepEqual(f.imports[0].request.target,{nodeId:'target',role:'firstFrame'});
        assert.equal(f.session.doc.nodes.length,6);assert.equal(f.session.doc.edges.some(edge=>edge.role==='firstFrame'),false);
        assert.equal(f.session.doc.nodes.find(node=>node.id==='target').payload.inputs.find(input=>input.role==='firstFrame').version.id,'v-returned-1');assert.equal(f.other.doc,otherDoc);assert.equal(f.loads.length,0);
        assert.ok(f.changes.every(item=>item.item===f.session));assert.deepEqual(comicCoreSource.validateCanvasDocument(f.session.doc),[]);
    }
});
test('native picker remains bound to its original target and uses single selection for a frame slot',async()=>{
    const f=fixture(),gate=deferred();f.widget.onPicker=()=>gate.promise;const pending=f.widget.importComicCanvasFiles({x:10,y:10},undefined,{nodeId:'target',role:'lastFrame'},f.session);
    f.switchProject();gate.resolve({path:{fsPath:()=>'/picked.png'}});await pending;
    assert.equal(f.picker[0].canSelectMany,false);assert.equal(f.imports[0].request.canvasId,'canvas-a');assert.equal(f.session.doc.nodes.find(node=>node.id==='target').payload.inputs.find(input=>input.role==='lastFrame').version.id,'v-returned-1');
    assert.deepEqual(f.picker[0].filters,{'kind.image':['png','jpg','jpeg','webp','gif']});
    const g=fixture(),closed=deferred();g.widget.onPicker=()=>closed.promise;const abandoned=g.widget.importComicCanvasFiles({x:10,y:10},undefined,{nodeId:'target',role:'firstFrame'},g.session);
    g.tracked.delete(g.session);g.switchProject();closed.resolve({path:{fsPath:()=>'/picked.png'}});await abandoned;assert.equal(g.imports.length,0);assert.equal(g.changes.length,0);
});
test('deleted targets and closed sessions are not resurrected by late import responses',async()=>{
    for(const route of ['upload','library'])for(const moment of ['flush','import','closed']){const f=fixture();
        const mutate=()=>{if(moment==='closed')f.tracked.delete(f.session);else{f.session.doc={...f.session.doc,nodes:f.session.doc.nodes.filter(item=>item.id!=='target'),edges:[]};f.session.save='dirty';}};
        if(moment==='flush')f.widget.onFlush=mutate;else f.widget.onImport=mutate;
        const pending=route==='upload'?f.widget.importComicCanvasFiles({x:0,y:0},[{path:'/ref.png'}],{nodeId:'target',role:'firstFrame'},f.session)
            :f.widget.useCanvasLibraryItem(f.session,'library-picture',{x:0,y:0},'request-1',{nodeId:'target',role:'firstFrame'});
        if(route==='library')await assert.rejects(pending);else await pending;
        assert.equal(f.imports.length,moment==='flush'?0:1);assert.equal(f.changes.length,0);if(moment!=='closed')assert.ok(!f.session.doc.nodes.some(item=>item.id==='target'));
    }
});
test('portrait errors propagate to the picker and late binding does not overwrite another active project',async()=>{
    const makeCharacter=f=>{f.session.doc={...f.session.doc,nodes:f.session.doc.nodes.map(node=>node.id==='target'?{...node,kind:'character',payload:{characterId:'hero',versions:[]}}:node),edges:[]};f.session.base=f.session.doc;};
    const f=fixture();makeCharacter(f);f.widget.onBind=async()=>{throw Error('BIND_REJECTED');};
    await assert.rejects(f.widget.attachComicCanvasReference(f.session,'new-first','target','referenceImage'),/BIND_REJECTED/);assert.match(f.notices.at(-1).text,/BIND_REJECTED/);
    await assert.rejects(f.widget.attachComicCanvasReference(f.session,'audio','target','referenceImage'),/ROLE_TYPE/);assert.equal(f.binds.length,1);
    const g=fixture();makeCharacter(g);const gate=deferred();g.widget.onBind=()=>gate.promise;
    const pending=g.widget.attachComicCanvasReference(g.session,'new-first','target','referenceImage');while(!g.binds.length)await new Promise(resolve=>setImmediate(resolve));
    g.switchProject();const current=g.widget.comicState;gate.resolve({project:{id:'project-a',revision:4}});await pending;
    assert.equal(g.widget.comicState,current);assert.equal(g.binds[0].workspaceRoot,'/project-a');assert.equal(g.binds[0].expectedProjectRevision,3);
    const h=fixture();makeCharacter(h);h.switchProject();await h.widget.attachComicCanvasReference(h.session,'new-first','target','referenceImage');
    assert.deepEqual(h.projectReads,['/project-a']);assert.equal(h.binds[0].expectedProjectRevision,3);assert.equal(h.widget.comicState.project.id,'project-b');
});
test('replacing inline first-frame input preserves an inline last frame and its required mode',async()=>{
    const f=fixture();f.session.doc={...f.session.doc,edges:[],nodes:f.session.doc.nodes.map(node=>node.id==='target'?{...node,payload:{...node.payload,inputs:[
        {id:'inline-first',role:'firstFrame',order:0,version:version('old-first')},{id:'inline-last',role:'lastFrame',order:0,version:version('old-last')} ]}}:node)};
    f.session.base=f.session.doc;await f.widget.attachComicCanvasReference(f.session,'new-first','target','firstFrame');
    const target=f.session.doc.nodes.find(node=>node.id==='target');assert.equal(target.payload.mode,'firstLastFrame');assert.equal(target.payload.inputs.find(input=>input.role==='lastFrame').id,'inline-last');
    assert.equal(target.payload.inputs.find(input=>input.role==='firstFrame').version.id,'v-new-first');
    assert.equal(f.session.doc.edges.length,0);assert.deepEqual(comicCoreSource.validateCanvasDocument(f.session.doc),[]);
    await f.widget.attachComicCanvasReference(f.session,'new-last','target','lastFrame');
    assert.equal(f.session.doc.edges.length,0);
    assert.deepEqual(f.session.doc.nodes.find(node=>node.id==='target').payload.inputs.map(input=>[input.role,input.version.id]).sort(),[['firstFrame','v-new-first'],['lastFrame','v-new-last']]);
    assert.deepEqual(comicCoreSource.validateCanvasDocument(f.session.doc),[]);
});

function setReferenceMode(f){f.session.doc={...f.session.doc,edges:[],nodes:f.session.doc.nodes.map(node=>node.id==='target'?{...node,payload:{...node.payload,mode:'referenceToVideo'}}:node)};f.session.base=f.session.doc;}
test('each reference upload picker restricts its native file filter and embeds the matching media type',async()=>{
    for(const [role,kind,path,extensions]of [
        ['referenceImage','image','/picked.PNG',['png','jpg','jpeg','webp','gif']],
        ['referenceVideo','video','/picked.mp4',['mp4','mov','webm','m4v']],
        ['referenceAudio','audio','/picked.wav',['mp3','wav','m4a','aac','ogg']]]){
        const f=fixture();setReferenceMode(f);f.widget.onPicker=()=>({path:{fsPath:()=>path}});
        await f.widget.importComicCanvasFiles({x:0,y:0},undefined,{nodeId:'target',role},f.session);
        assert.deepEqual(f.picker[0].filters,{[`kind.${kind}`]:extensions});assert.equal(f.picker[0].canSelectMany,true);
        assert.equal(f.imports.length,1);assert.deepEqual(f.imports[0].request.target,{nodeId:'target',role});
        assert.equal(f.session.doc.nodes.length,6);assert.equal(f.session.doc.edges.length,0);
        assert.equal(f.session.doc.nodes.find(node=>node.id==='target').payload.inputs[0].version.kind,kind);
    }
});
test('a mixed batch, contradictory File MIME or absent path is rejected before any file is written',async()=>{
    for(const files of [[{path:'/first.png'},{path:'/wrong.mp4'}],[{path:'/first.png'},{path:'/fake.png',type:'video/mp4'}],[{path:'/first.png'},{}]]){
        const f=fixture();setReferenceMode(f);const original=f.session.doc;
        await f.widget.importComicCanvasFiles({x:0,y:0},files,{nodeId:'target',role:'referenceImage'},f.session);
        assert.equal(f.imports.length,0);assert.equal(f.flushes.length,0);assert.equal(f.session.doc,original);assert.match(f.notices.at(-1).text,/ROLE_TYPE/);
    }
    const f=fixture();await f.widget.importComicCanvasFiles({x:0,y:0},[{path:'/first.png'},{path:'/second.png'}],{nodeId:'target',role:'firstFrame'},f.session);
    assert.equal(f.imports.length,0);assert.match(f.notices.at(-1).text,/ROLE_LIMIT/);
});
test('a valid multi-picture selection adds inline versions in order without canvas nodes or wires',async()=>{
    const f=fixture();setReferenceMode(f);
    await f.widget.importComicCanvasFiles({x:0,y:0},[{path:'/first.png',type:'image/png'},{path:'/second.jpg',type:'image/jpeg'}],{nodeId:'target',role:'referenceImage'},f.session);
    assert.equal(f.notices.length,0);assert.equal(f.imports.length,2);assert.equal(f.session.doc.nodes.length,6);assert.equal(f.session.doc.edges.length,0);
    const inputs=f.session.doc.nodes.find(node=>node.id==='target').payload.inputs;
    assert.deepEqual(inputs.map(item=>[item.role,item.version.id]),[['referenceImage','v-returned-1'],['referenceImage','v-returned-2']]);
    assert.equal(f.imports[1].request.expectedRevision,f.imports[0].request.expectedRevision+1);
});
test('ordinary canvas uploads and library placement still create asset nodes; character targets still bind portraits',async()=>{
    const f=fixture();await f.widget.importComicCanvasFiles({x:10,y:20},[{path:'/asset.png'}],undefined,f.session);
    assert.equal(f.imports[0].request.target,undefined);assert.equal(f.session.doc.nodes.length,7);
    await f.widget.useCanvasLibraryItem(f.session,'library-picture',{x:20,y:30},'plain-library');
    assert.equal(f.imports[1].request.target,undefined);assert.equal(f.session.doc.nodes.length,8);
    const g=fixture();g.session.doc={...g.session.doc,edges:[],nodes:g.session.doc.nodes.map(node=>node.id==='target'?{...node,kind:'character',payload:{characterId:'hero',versions:[]}}:node)};g.session.base=g.session.doc;
    await g.widget.importComicCanvasFiles({x:0,y:0},[{path:'/portrait.png'}],{nodeId:'target',role:'referenceImage'},g.session);
    assert.equal(g.imports[0].request.target,undefined);assert.equal(g.binds.length,1);assert.equal(g.binds[0].portraitNodeId,'returned-1');
});
test('choosing an existing canvas source pins its current version independently of later source selection or deletion',async()=>{
    const f=fixture();setReferenceMode(f);const count=f.session.doc.nodes.length;
    await f.widget.attachComicCanvasReference(f.session,'new-first','target','referenceImage');
    const chosen=f.session.doc.nodes.find(node=>node.id==='target').payload.inputs[0];assert.equal(chosen.version.id,'v-new-first');
    assert.equal(f.session.doc.nodes.length,count);assert.equal(f.session.doc.edges.length,0);
    f.session.doc={...f.session.doc,nodes:f.session.doc.nodes.map(node=>node.id==='new-first'?{...node,payload:{versions:[...node.payload.versions,version('later')],currentVersionId:'v-later'}}:node)};
    assert.equal(comicCoreSource.resolveCanvasInputs(f.session.doc,'target').inputs[0].versionId,'v-new-first');
    f.session.doc={...f.session.doc,nodes:f.session.doc.nodes.filter(node=>node.id!=='new-first')};
    assert.equal(comicCoreSource.resolveCanvasInputs(f.session.doc,'target').inputs[0].versionId,'v-new-first');
});

test('reselecting the same canvas reference is idempotent and a busy target refuses uploads before opening a picker',async()=>{
    const f=fixture();setReferenceMode(f);
    await f.widget.attachComicCanvasReference(f.session,'new-first','target','referenceImage');
    const original=f.session.doc,changes=f.changes.length,flushes=f.flushes.length;
    await f.widget.attachComicCanvasReference(f.session,'new-first','target','referenceImage');
    assert.equal(f.session.doc,original);assert.equal(f.changes.length,changes);assert.equal(f.flushes.length,flushes);
    const g=fixture();g.session.doc={...g.session.doc,nodes:g.session.doc.nodes.map(node=>node.id==='target'?{...node,payload:{...node.payload,job:{status:'running'}}}:node)};
    await g.widget.importComicCanvasFiles({x:0,y:0},undefined,{nodeId:'target',role:'firstFrame'},g.session);
    assert.equal(g.picker.length,0);assert.equal(g.imports.length,0);assert.match(g.notices.at(-1).text,/CANVAS_NODE_BUSY/);
});
