import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const puppeteer = (await import(platform.resolve('puppeteer'))).default;

test('node-anchored generation prompt creates one undo step and preserves validation and external updates', { timeout: 45000 }, async t => {
    const url = new URL('../src/browser/nextmux-comic-canvas.tsx', import.meta.url);
    const source = ts.createSourceFile('canvas.tsx', await readFile(url, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    // Run the production panel and validators in a real browser, without starting a paid model job.
    const functions = ['withCameraState', 'capabilityInputs', 'nodeProblems', 'statusOf', 'InlineCanvasText', 'ReferenceMedia', 'ReferenceInputs', 'GenerationPanel', 'DurationField'].map(name => {
        const node = source.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
        assert.ok(node, `production function ${name}`);
        return node.getText(source);
    }).join('\n');
    const { outputFiles } = await desktop('esbuild').build({
        stdin: { loader: 'tsx', resolveDir: dirname(fileURLToPath(url)), contents: `
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { createCanvasDocument, applyCanvasCommand, resolveCanvasInputs, createGenerationSnapshot } from '@nextmux/comic-core/canvas';
import { assertCanvasContinuityInputs } from '@nextmux/comic-core/canvas-continuity';
import { continuityText } from './nextmux-comic-continuity-text';
import { CanvasFloatingForm } from './nextmux-comic-canvas-float';
import { CameraControl, CameraTags } from './nextmux-comic-canvas-camera';
import { composeCanvasCameraPrompt, deriveCanvasCameraPrompt } from './nextmux-comic-canvas-camera-state';
import { CanvasRouteSelector, useCanvasRouteSelection } from './nextmux-comic-canvas-route-selector';
import { canvasLibraryReferenceRoles, removeCanvasDirectReference } from './nextmux-comic-canvas-reference-inputs';
import { comicAssetLibraryText } from './nextmux-comic-asset-library-text';
import { isCanvasDurationValid, reconcileCanvasGenerationParameters, resolveCanvasCapability, resolveCanvasGenerationOptions, validateCanvasGenerationParameters } from '@nextmux/comic-core/canvas-capabilities';
import { createCanvasNode, canvasMediaCardSize, canvasCurrentVersion, canvasVersionReady, deleteFromCanvas, canvasLatestJob, canvasPendingUpstream, switchCanvasMode, CANVAS_ACTIVE_JOB } from './nextmux-comic-canvas-logic';
import { canvasText, canvasIssueText } from './nextmux-comic-canvas-text';
import { ImeInput, ImeTextarea } from './nextmux-ime-field';
import { panelText } from './nextmux-comic-canvas-panels-text';
import { storyboardText } from './nextmux-comic-canvas-storyboard-text';
import { canvasOptionAdjustments, canvasOptionsText } from './nextmux-comic-canvas-options-text';
import { fitCanvasNodeOptions, switchCanvasModeKeepingInputs } from './nextmux-comic-canvas-options';
const CanvasContext = React.createContext(undefined);
const now = () => new Date().toISOString();
${functions}
const mode = { mode: 'textToVideo', outputVariants: [{id:'720p',resolution:'720p',aspectRatios:['16:9','9:16']}],
    duration:{kind:'enum',seconds:[5,10],defaultSeconds:5},audioGeneration:{mode:'unsupported',defaultEnabled:false} };
const capability = {id:'fixture-video',providerId:'fixture',providerModelId:'fixture-video',displayName:'Fixture',status:'available',version:'fixture-v1',modes:[mode,{...mode,mode:'imageToVideo',firstFrame:true}]};
const route = {key:'route-a',modelId:'fixture-video',source:'Fixture A',sourceKey:'managed:a',available:true};
let doc = createCanvasDocument({id:'canvas',projectId:'fixture'});
const node = createCanvasNode('videoGen',{x:0,y:0},{title:'Fixture video'});
node.payload = {...node.payload,modelId:'fixture-video',prompt:'',mode:'textToVideo',parameters:{resolution:'720p',aspectRatio:'16:9',durationSeconds:5}};
doc = applyCanvasCommand(doc,{type:'node.add',node});
const changes = [], records = [], runs = [], notices = [];
let holdOwnerPaint = false;
const root = createRoot(document.querySelector('main'));
const owner = {locale:'zh-CN',canvas:doc,mediaUrl:uri=>uri,submitting:new Set(),waiting:new Set(),jobOf:()=>undefined,
    routeOf:()=>route,capabilityOf:()=>({capability}),families:{image:[],video:[{id:'family',name:'Fixture',available:true,routes:[route,{...route,key:'route-b',source:'Fixture B',sourceKey:'managed:b'}]}]},
    onChange(next, options) { owner.canvas=next; records.push(options?.record!==false); changes.push(next.nodes[0].payload.prompt); if (!holdOwnerPaint) requestAnimationFrame(render); },
    onNotice:message=>notices.push(message),onSetRoute:()=>{}};
function render() {root.render(<CanvasContext.Provider value={{props:owner,selectNode:()=>{},pickReference:()=>{},change:(next,record)=>owner.onChange(next,{record}),t:(key,args)=>canvasText(owner.locale,key,args),run:ids=>runs.push({ids,prompt:owner.canvas.nodes[0].payload.prompt})}}><CanvasFloatingForm key={'form-'+owner.canvas.nodes[0].id} locale={owner.locale} title={owner.canvas.nodes[0].title}><GenerationPanel node={owner.canvas.nodes[0]}/></CanvasFloatingForm></CanvasContext.Provider>);}
window.fixture={owner,changes,records,runs,notices,render,text:key=>canvasText(owner.locale,key),snapshot:()=>createGenerationSnapshot(owner.canvas,node.id,{capabilityVersion:'fixture-v1'}),
    locale(value) {owner.locale=value;route.sourceLabel=value==='zh-CN'?'用于完整名称布局验证的中转服务商':'NextMux OpenRouter International Production Connection';owner.families.video[0].name=value==='zh-CN'?'MiniMax H3 Max 视频生成高品质模型':'MiniMax H3 Max Long Display Name Video Generation';render();},
    holdOwnerPaint() { holdOwnerPaint=true; }, releaseOwnerPaint() { holdOwnerPaint=false;requestAnimationFrame(render); },
    configure(modes, selectedMode, parameters, references=[]) {
        capability.modes=modes;
        let next=createCanvasDocument({id:'canvas',projectId:'fixture'});
        next=applyCanvasCommand(next,{type:'node.add',node:{...node,payload:{...node.payload,prompt:'A valid prompt',mode:selectedMode,parameters}}});
        for (const [index, role] of references.entries()) {
            const kind=role==='referenceAudio'?'audio':role==='referenceVideo'?'video':'image';
            const version={id:'ref-version-'+index,assetId:'ref-asset-'+index,kind,uri:'nextmux.media/ref-'+index,createdAt:'2026-10-03T00:00:00.000Z',metadata:{width:1280,height:720,durationMs:2000}};
            const source={id:'ref-'+index,kind,title:'Reference',position:{x:0,y:0},size:{width:200,height:200},payload:{versions:[version],currentVersionId:version.id}};
            next=applyCanvasCommand(next,{type:'node.add',node:source});
            next=applyCanvasCommand(next,{type:'edge.connect',edge:{id:'edge-'+index,sourceNodeId:source.id,sourcePort:'output',targetNodeId:node.id,targetPort:role,role,order:index,binding:'pinnedVersion',pinnedVersionId:version.id}});
        }
        owner.canvas=next;render();
    }, makeReferencesDirect() {
        const inputs=owner.canvas.edges.map(edge=>({id:'direct-'+edge.id,role:edge.role,order:edge.order,version:owner.canvas.nodes.find(source=>source.id===edge.sourceNodeId).payload.versions[0]}));
        owner.canvas={...owner.canvas,edges:[],nodes:owner.canvas.nodes.map(item=>item.id===node.id?{...item,payload:{...item.payload,inputs}}:item)};render();
    }, fit(projectAspect) {const next=fitCanvasNodeOptions(owner.canvas,node.id,capability,now(),projectAspect);if(next)owner.canvas=next;render();return !!next;},
    externalPrompt(value) {owner.canvas={...owner.canvas,nodes:owner.canvas.nodes.map(n=>({...n,payload:{...n.payload,prompt:value}}))};render();},
    externalLegacyPrompt(value) {
        // Loading an untouched legacy document has no explicit authored-camera marker.
        // Ordinary external prompt edits above retain metadata, just like the product.
        const targetId=owner.canvas.nodes[0].id;
        const nodeCamera={...owner.canvas.settings.nodeCamera};delete nodeCamera[targetId];
        owner.canvas={...owner.canvas,settings:{...owner.canvas.settings,nodeCamera},nodes:owner.canvas.nodes.map(n=>n.id===targetId?{...n,payload:{...n.payload,prompt:value}}:n)};render();
    }};
render();` },
        bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty' },
        alias: { react: core.resolve('react'), 'react-dom/client': core.resolve('react-dom/client'),
            '@nextmux/comic-core/canvas': fileURLToPath(new URL('../../comic-core/src/canvas.ts', import.meta.url)),
            '@nextmux/comic-core/canvas-camera': fileURLToPath(new URL('../../comic-core/src/canvas-camera.ts', import.meta.url)),
            '@nextmux/comic-core/canvas-capabilities': fileURLToPath(new URL('../../comic-core/src/canvas-capabilities.ts', import.meta.url)) }
    });
    const browser = await puppeteer.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage(); page.setDefaultTimeout(7000);
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.log('generation fixture error',error.stack); });
    await page.setViewport({width:1400,height:900});
    await page.setRequestInterception(true);page.on('request',request=>void request.respond({status:200,contentType:'text/html',body:'<div class="nmx-shell"><div class="nmx-desk"><main></main></div></div>'}));
    await page.goto('https://canvas-form.test/');
    for (const file of ['nextmux.css','nextmux-desktop-production.css','nextmux-comic-canvas.css','nextmux-comic-canvas-float.css','nextmux-comic-canvas-camera.css']) await page.addStyleTag({content:await readFile(new URL('../src/browser/style/'+file,import.meta.url),'utf8')});
    await page.addStyleTag({content:'main{--nmx-bg:#171717;--nmx-panel:#212121;--nmx-panel-2:#292929;--nmx-border:#3d3d3d;--nmx-muted:#b0b0b0;--nmx-text:#ededed;--nmx-accent:#a86fd4;--cv-float:#212121;--cv-brand:linear-gradient(135deg,#ff5f8a,#8e4ec6);font:13px system-ui;padding:40px;box-sizing:border-box}body{background:#171717}'});
    await page.addScriptTag({ content: outputFiles[0].text });
    await page.waitForSelector('textarea');
    assert.equal(await page.$eval('.nmx-board-generate', el => el.disabled), true);
    // Widget ownership is acknowledged on a later paint. Make that delay deterministic:
    // the input must save every character without waiting for that acknowledgement or blur.
    await page.evaluate(() => window.fixture.holdOwnerPaint());
    await page.type('textarea', '星港码头的女机械师');
    assert.equal(await page.$eval('textarea', el => el === document.activeElement), true);
    assert.equal(await page.$eval('textarea', el => el.value), '星港码头的女机械师');
    assert.equal(await page.evaluate(() => window.fixture.owner.canvas.nodes[0].payload.prompt), '星港码头的女机械师');
    assert.equal(await page.$eval('.nmx-board-generate', el => el.disabled), true, 'the parent still has the empty prompt until its scheduled paint');
    await page.evaluate(() => window.fixture.releaseOwnerPaint());
    await page.waitForFunction(() => !document.querySelector('.nmx-board-generate').disabled
        && document.querySelector('textarea') === document.activeElement
        && document.querySelector('textarea').value === '星港码头的女机械师'
        && window.fixture.owner.canvas.nodes[0].payload.prompt === '星港码头的女机械师');
    assert.equal(await page.$eval('.nmx-board-generate', el => el.disabled), false,
        `typing enables Generate before blur: ${await page.$eval('.nmx-board-panel', el => el.innerText)}`);
    assert.equal(await page.evaluate(() => window.fixture.changes.at(-1)), '星港码头的女机械师', 'inline edits save without waiting for blur');
    assert.equal(await page.evaluate(() => window.fixture.records.filter(Boolean).length), 1, 'one focus session is one undo entry');
    // Programmatic activation does not blur: the run handler itself must persist the draft.
    await page.$eval('.nmx-board-generate', el => el.click());
    await page.waitForFunction(() => window.fixture.runs.length === 1);
    await page.$eval('textarea', el => el.blur());
    assert.deepEqual(await page.evaluate(() => window.fixture.runs.map(r=>r.prompt)), ['星港码头的女机械师']);
    await page.evaluate(() => window.fixture.externalPrompt('撤销后恢复的提示词'));
    await page.waitForFunction(() => document.querySelector('textarea').value === '撤销后恢复的提示词');
    await page.focus('textarea');
    // Use the input's select() across macOS and Linux, then real keyboard input.
    await page.$eval('textarea', el => el.select());
    await page.keyboard.type('   ');
    await page.waitForFunction(()=>document.querySelector('.nmx-board-generate').disabled);
    assert.equal(await page.$eval('.nmx-board-generate', el => el.disabled), true, 'whitespace cannot bypass required prompt');
    await page.$eval('textarea', el => el.select());
    await page.keyboard.type('A valid second prompt');
    await page.waitForFunction(()=>!document.querySelector('.nmx-board-generate').disabled);
    await page.click('.nmx-board-generate');
    assert.equal(await page.evaluate(() => window.fixture.runs.at(-1).prompt), 'A valid second prompt', 'mouse blur and click use the new prompt');
    assert.equal(await page.evaluate(() => window.fixture.changes.filter(value=>value==='A valid second prompt').length), 1);
    const review = fileURLToPath(new URL('../../../.nextmux-run/canvas-route-review-2026-10-03/', import.meta.url));
    await mkdir(review, { recursive: true });
    await (await page.$('.nmx-board-panel')).screenshot({ path: review + 'connection-form.png' });
    console.log('connection form geometry', await page.$eval('.nmx-board-panel', el => ({ width: el.getBoundingClientRect().width,
        controls: [...el.querySelectorAll('select, .nmx-board-generate')].map(item => ({ label: item.getAttribute('aria-label') || item.textContent, x: item.getBoundingClientRect().x, y: item.getBoundingClientRect().y, width: item.getBoundingClientRect().width })) })));
    const parameter = async key => 'select[aria-label='+JSON.stringify(await page.evaluate(key=>window.fixture.text(key),key))+']';
    assert.equal(await page.$('.nmx-board-settings-popover,button[aria-label="视频设置"],button[aria-label="Video settings"]'),null,'all parameters are directly visible without a settings popover');
    const rowSelects='.nmx-board-generation-actions select,.nmx-board-parameter-row select';
    const labels = await page.$$eval(rowSelects, els => els.map(el => el.getAttribute('aria-label')));
    assert.equal(labels.length, 6);
    assert.equal(new Set(labels.filter(Boolean)).size, 6, 'source, connection, model and three parameter selects have distinct accessible names');
    for (const key of ['resolution','duration','aspect']) assert.ok(await page.$(await parameter(key)),`${key} is directly available`);
    assert.equal(await page.$$eval('[role=tablist] [role=tab]', els=>els.length),2,'generation modes are real visible tabs');
    const modeButton = async mode => '[role=tab][title='+JSON.stringify(await page.evaluate(mode=>window.fixture.text('mode.'+mode),mode))+']';
    const selectMode = async mode => {const selector=await modeButton(mode);await page.waitForSelector(selector,{visible:true});await page.click(selector);};
    const tabGeometry=()=>page.$$eval('[role=tablist] [role=tab]',tabs=>tabs.map(tab=>{const r=tab.getBoundingClientRect();return {label:tab.textContent,x:r.x,y:r.y};}));
    const beforeMode=await tabGeometry();
    await selectMode('imageToVideo');
    await page.waitForFunction(() => document.querySelector('.nmx-board-generate').disabled);
    assert.deepEqual(await tabGeometry(),beforeMode,'choosing image-to-video never reorders or repositions mode tabs');
    await selectMode('textToVideo');await page.waitForFunction(()=>!document.querySelector('.nmx-board-generate').disabled);
    assert.deepEqual(await tabGeometry(),beforeMode,'choosing text-to-video keeps the same tab coordinates');
    await selectMode('imageToVideo');await page.waitForFunction(()=>document.querySelector('.nmx-board-generate').disabled);
    assert.equal(await page.$eval('.nmx-board-generate', el => el.disabled), true, 'a valid prompt does not bypass a missing first frame');

    const variants = [{ id:'720p',resolution:'720p',aspectRatios:['16:9','9:16'] },
        { id:'1080p',resolution:'1080p',aspectRatios:['9:16'],durationOverride:{kind:'enum',seconds:[8],defaultSeconds:8},audioGenerationOverride:{mode:'required',defaultEnabled:true} }];
    const editable = {mode:'textToVideo',outputVariants:variants,duration:{kind:'enum',seconds:[5,10],defaultSeconds:5},audioGeneration:{mode:'optional',defaultEnabled:false}};
    const configure = async (modes, mode, parameters, refs=[]) => {
        await page.evaluate(args => window.fixture.configure(...args), [modes,mode,parameters,refs]);
        // The selected mode can be unchanged while its capability and sibling tabs change.
        // Wait for the committed capability's whole mode list, not an already-selected stale tab.
        await page.waitForFunction(({modes,mode})=>{
            const tabs=[...document.querySelectorAll('[role=tablist] [role=tab]')],labels=modes.map(value=>window.fixture.text('mode.'+value));
            return tabs.length===labels.length&&tabs.every((tab,index)=>tab.title===labels[index])
                &&tabs.find(tab=>tab.title===window.fixture.text('mode.'+mode))?.getAttribute('aria-selected')==='true';
        }, {}, {modes:[...new Set([...modes.map(item=>item.mode),mode])],mode});
    };
    const setLocale = async locale => {
        await page.evaluate(locale=>window.fixture.locale(locale),locale);
        await page.waitForFunction(locale=>document.querySelector('.nmx-canvas-floating-host')?.lang===locale
            &&document.querySelector('select[aria-label="'+window.fixture.text('model')+'"]')?.selectedOptions[0]?.textContent===window.fixture.owner.families.video[0].name,{},locale);
    };
    // Real resolution selection cascades ratio, duration and required audio in the same document edit.
    await configure([editable], 'textToVideo', {resolution:'720p',aspectRatio:'16:9',durationSeconds:5,generateAudio:false});
    // Production desktop resets and long names must preserve both directly visible control rows.
    for (const locale of ['zh-CN','en']) {
        await setLocale(locale);
        const geometry=await page.evaluate(()=>{
            const panel=document.querySelector('.nmx-board-panel'),box=panel.getBoundingClientRect();
            const measure=control=>{const b=control.getBoundingClientRect();return {
                label:control.getAttribute('aria-label')||control.closest('label')?.title,x:b.x,y:b.y,width:b.width,height:b.height,right:b.right,bottom:b.bottom,
                centerY:b.y+b.height/2,hit:control.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2))};};
            const row=element=>{const b=element.getBoundingClientRect();return {top:b.top,bottom:b.bottom,width:b.width,height:b.height,scrollWidth:element.scrollWidth,clientWidth:element.clientWidth};};
            const camera=panel.querySelector('.is-camera[aria-expanded]'),top=camera.closest('.nmx-board-generation-actions');
            const parameters=['resolution','aspect','duration'].map(key=>panel.querySelector('select[aria-label="'+window.fixture.text(key)+'"]'));
            const generate=panel.querySelector('.nmx-board-generate'),bottom=generate.closest('.nmx-board-parameter-row');
            const bottomControls=[panel.querySelector('.is-api-source select'),panel.querySelector('.is-connection select'),panel.querySelector('.is-model select'),panel.querySelector('.is-toggle input'),generate];
            return {width:box.width,left:box.left,right:box.right,bottom:box.bottom,topRow:row(top),bottomRow:row(bottom),
                topControls:[camera,...parameters].map(measure),bottomControls:bottomControls.map(measure),
                parametersInTop:parameters.every(control=>top.contains(control)),bottomControlsInRow:bottomControls.every(control=>bottom.contains(control)),generateInTop:top.contains(generate)};
        });
        console.log('compact parameter rows',locale,JSON.stringify(geometry));
        assert.equal(Math.round(geometry.width),560);
        assert.equal(geometry.parametersInTop,true,'resolution, aspect and duration share the camera action row');
        assert.equal(geometry.bottomControlsInRow,true,'source, connection, model, audio and send remain in the bottom row');
        assert.equal(geometry.generateInTop,false,'send is no longer in the camera row');
        assert.ok(geometry.topRow.bottom<geometry.bottomRow.top,'the two control rows are separated by the prompt');
        for (const [name,row,controls] of [['camera',geometry.topRow,geometry.topControls],['API',geometry.bottomRow,geometry.bottomControls]]) {
            assert.ok(row.scrollWidth<=row.clientWidth+1,name+' row does not overflow horizontally');
            assert.ok(row.height<=40,name+' controls occupy one compact row');
            const centerYs=controls.map(control=>control.centerY);
            assert.ok(Math.max(...centerYs)-Math.min(...centerYs)<=2,name+' controls share the same row center');
        }
        for (const control of [...geometry.topControls,...geometry.bottomControls]) {
            assert.ok(control.width>=10&&control.height>=10,control.label+' retains a usable hit target');
            assert.ok(control.x>=geometry.left&&control.right<=geometry.right&&control.bottom<=geometry.bottom,control.label+' stays inside the form');
            assert.equal(control.hit,true,control.label+' is actually clickable, not covered');
        }
        const send=geometry.bottomControls.at(-1);
        assert.ok(geometry.bottomControls.slice(0,-1).every(control=>control.right<=send.x),'send stays to the right of the bottom controls');
        for (const control of await page.$$(rowSelects)) {await control.click();await page.keyboard.press('Escape');}
        await page.click('.nmx-board-parameter-row input[type=checkbox]');
        await page.waitForFunction(()=>window.fixture.owner.canvas.nodes[0].payload.parameters.generateAudio===true);
        await page.click('.nmx-board-parameter-row input[type=checkbox]');
        await page.waitForFunction(()=>window.fixture.owner.canvas.nodes[0].payload.parameters.generateAudio===false);
    }
    await setLocale('zh-CN');
    await page.select(await parameter('resolution'), '1080p');
    await page.waitForFunction(()=>window.fixture.owner.canvas.nodes[0].payload.parameters.durationSeconds===8);
    const adjusted = await page.evaluate(()=>window.fixture.owner.canvas.nodes[0].payload);
    assert.deepEqual(adjusted.parameters,{resolution:'1080p',aspectRatio:'9:16',durationSeconds:8,generateAudio:true});
    assert.equal(adjusted.optionDecision.requested.parameters.aspectRatio,'16:9');
    await page.waitForSelector('[role="status"] li');
    assert.deepEqual(await page.$$eval('[role="status"] li', els=>els.map(el=>el.textContent)), ['画幅: 16:9 → 9:16','时长: 5 → 8','声音: 关 → 开']);
    assert.deepEqual(await page.$$eval((await parameter('duration'))+' option',els=>els.map(el=>el.value)), ['8']);
    assert.deepEqual(await page.$eval('input[type="checkbox"]',el=>({checked:el.checked,disabled:el.disabled})),{checked:true,disabled:true});
    const frozen = await page.evaluate(()=>window.fixture.snapshot());
    assert.deepEqual(frozen.optionDecision.effective.parameters,frozen.parameters);
    await page.select(await parameter('resolution'), '720p');
    await page.waitForFunction(()=>window.fixture.owner.canvas.nodes[0].payload.parameters.durationSeconds===5);
    assert.equal(frozen.parameters.resolution,'1080p','snapshot is independent of later form changes');

    const refsMode={...editable,mode:'referenceToVideo',outputVariants:[variants[0]],referenceRules:{audio:{supported:true,maxCount:1}},combinationConstraints:[{combination:'audio',maxAudios:1}]};
    await configure([refsMode,editable], 'referenceToVideo', {resolution:'720p',aspectRatio:'16:9',durationSeconds:5,generateAudio:true}, ['referenceAudio']);
    await page.waitForSelector('input[type="checkbox"]:checked');
    const originalEdges=await page.evaluate(()=>window.fixture.owner.canvas.edges);
    await page.click('input[type="checkbox"]');
    await page.waitForFunction(()=>window.fixture.owner.canvas.nodes[0].payload.parameters.generateAudio===false);
    assert.deepEqual(await page.evaluate(()=>window.fixture.owner.canvas.edges),originalEdges,'sound off retains the actual reference edge and pinned version');
    assert.match(await page.$eval('.nmx-board-panel',el=>el.innerText),/参考音频保留/);
    assert.equal(await page.$eval('.nmx-board-generate',el=>el.disabled),false,'audio reference and optional output sound are independent');
    assert.equal((await page.evaluate(()=>window.fixture.snapshot())).resolvedInputs[0].versionId,'ref-version-0');
    await selectMode('textToVideo');
    await page.waitForFunction(()=>window.fixture.notices.length>0);
    assert.equal(await page.evaluate(()=>window.fixture.owner.canvas.nodes[0].payload.mode),'referenceToVideo');
    assert.deepEqual(await page.evaluate(()=>window.fixture.owner.canvas.edges),originalEdges,'incompatible mode is rejected atomically');
    await page.evaluate(()=>window.fixture.makeReferencesDirect());
    const direct=await page.evaluate(()=>window.fixture.owner.canvas.nodes[0].payload.inputs);
    await selectMode('textToVideo');
    await page.waitForFunction(()=>window.fixture.notices.length===2);
    assert.deepEqual(await page.evaluate(()=>window.fixture.owner.canvas.nodes[0].payload.inputs),direct,'direct imported inputs also cannot disappear during a mode change');
    assert.equal(await page.evaluate(()=>window.fixture.owner.canvas.nodes[0].payload.mode),'referenceToVideo');

    const imageReferences={...refsMode,referenceRules:{image:{supported:true,maxCount:1}},combinationConstraints:[{combination:'image',maxImages:1}]};
    const firstFrame={...editable,mode:'imageToVideo',outputVariants:[variants[0]],firstFrame:true};
    await configure([imageReferences,firstFrame], 'referenceToVideo', {resolution:'720p',aspectRatio:'16:9',durationSeconds:5,generateAudio:false}, ['referenceImage']);
    await selectMode('imageToVideo');
    await page.waitForFunction(()=>window.fixture.owner.canvas.nodes[0].payload.mode==='imageToVideo');
    assert.deepEqual(await page.evaluate(()=>window.fixture.owner.canvas.edges.map(edge=>({role:edge.role,version:edge.pinnedVersionId}))),[{role:'firstFrame',version:'ref-version-0'}],
        'compatible reference images become first frames without changing their approved version');

    const stepped={...editable,duration:{kind:'range',min:2,max:10,step:2,defaultSeconds:4},outputVariants:[variants[0]]};
    await configure([stepped], 'textToVideo', {resolution:'720p',aspectRatio:'16:9',durationSeconds:4,generateAudio:false});
    await page.waitForSelector('input[type="number"]');
    await page.$eval('input[type="number"]',el=>el.select());
    await page.keyboard.type('3');
    await page.waitForFunction(()=>window.fixture.owner.canvas.nodes[0].payload.parameters.durationSeconds===3);
    await page.waitForFunction(()=>document.querySelector('.nmx-board-generate').disabled);
    assert.equal(await page.$eval('.nmx-board-generate',el=>el.disabled),true,'off-step duration remains visible and cannot generate');
    await page.$eval('input[type="number"]',el=>el.select());
    await page.keyboard.type('10');
    await page.waitForFunction(()=>window.fixture.owner.canvas.nodes[0].payload.parameters.durationSeconds===10);
    await page.waitForFunction(()=>!document.querySelector('.nmx-board-generate').disabled);
    assert.equal(await page.$eval('.nmx-board-generate',el=>el.disabled),false,'typing 10 is not snapped to a default after the first digit');

    await configure([editable], 'textToVideo', {resolution:'retired',aspectRatio:'1:1',durationSeconds:12,quality:'unsupported'});
    assert.equal(await page.evaluate(()=>window.fixture.fit('9:16')),true);
    const fitted=await page.evaluate(()=>window.fixture.owner.canvas.nodes[0].payload);
    assert.equal(fitted.parameters.aspectRatio,'9:16','model fitting preserves the project frame preference');
    assert.equal(fitted.parameters.quality,undefined,'unsupported paid controls are not silently forwarded');
    assert.equal(fitted.optionDecision.requested.parameters.aspectRatio,'1:1','preference does not overwrite the originally requested value');
    const proven={...editable,outputVariants:[{...variants[0],requestShapes:[
        {aspectRatio:'16:9',durationSeconds:5,firstFrame:false,lastFrame:false,referenceImages:0,requestAudio:false,width:1280,height:720},
        {aspectRatio:'16:9',durationSeconds:10,firstFrame:false,lastFrame:false,referenceImages:0,requestAudio:true,width:1280,height:720}
    ]}],duration:{kind:'enum',seconds:[5,8,10],defaultSeconds:5}};
    await configure([proven], 'textToVideo', {resolution:'720p',aspectRatio:'16:9',durationSeconds:5,generateAudio:false});
    await page.waitForFunction(()=>!document.querySelector('input[type="number"]'));
    assert.deepEqual(await page.$$eval((await parameter('duration'))+' option:not(:disabled)',els=>els.map(el=>el.value)),['5','10'],'unproven 8 seconds is not an offered paid option');
    assert.deepEqual(await page.$$eval((await parameter('aspect'))+' option:not(:disabled)',els=>els.map(el=>el.value)),['16:9'],'unproven aspect is not an offered paid option');
    await page.select(await parameter('duration'),'10');
    await page.waitForFunction(()=>window.fixture.owner.canvas.nodes[0].payload.parameters.generateAudio===true);
    await page.waitForSelector('input[type="checkbox"]:checked:disabled');
    assert.equal(await page.$eval('.nmx-board-generate',el=>el.disabled),false,'duration and sound satisfy one complete proven request tuple');
    assert.equal(await page.evaluate(()=>window.fixture.runs.length),2,'option edits and fitting never start a model job');

    // Valid media parameters alone must not authorize a changed, previously approved continuation input.
    await configure([firstFrame,imageReferences], 'imageToVideo', {resolution:'720p',aspectRatio:'16:9',durationSeconds:5,generateAudio:false}, ['firstFrame']);
    await page.evaluate(()=>{
        const fixture=window.fixture;
        const continuity={version:1,sourceNodeId:'approved-video',sourceVersionId:'approved-video-version',sourceAssetId:'approved-video-asset',
            approvedAt:'2026-10-03T00:00:00.000Z',intent:'continueAction',strategy:'tailFrame',
            inputNodeId:'ref-0',inputVersionId:'ref-version-0',inputAssetId:'ref-asset-0',
            boundary:{appearance:'Same character',action:'Walking out of the doorway',camera:'Rear view',story:'The door is open'},userPrompt:'Continue walking'};
        fixture.owner.canvas={...fixture.owner.canvas,nodes:fixture.owner.canvas.nodes.map((node,index)=>index===0?{...node,payload:{...node.payload,continuity}}:node)};
        fixture.continuityBaseline=structuredClone(fixture.owner.canvas);
        fixture.render();
    });
    const continuityIssue='衔接参考或生成方式已改变';
    await page.waitForFunction(()=>!document.querySelector('.nmx-board-generate').disabled);
    for (const identity of ['node','version','asset']) {
        await page.evaluate(identity=>{
            const fixture=window.fixture, next=structuredClone(fixture.continuityBaseline);
            const reference=next.nodes.find(node=>node.id==='ref-0');
            if (identity==='node') {
                reference.id='replacement-ref';
                next.edges[0].sourceNodeId=reference.id;
            } else if (identity==='version') {
                reference.payload.versions[0].id='replacement-version';
                reference.payload.currentVersionId='replacement-version';
                next.edges[0].pinnedVersionId='replacement-version';
            } else reference.payload.versions[0].assetId='replacement-asset';
            fixture.owner.canvas=next;fixture.render();
        },identity);
        await page.waitForFunction(issue=>document.querySelector('.nmx-board-generate').disabled
            && document.querySelector('.nmx-board-panel').innerText.includes(issue),{},continuityIssue);
        assert.equal(await page.$eval('.nmx-board-generate',el=>el.disabled),true,`changed reference ${identity} blocks Generate even with valid media`);
        assert.deepEqual(await page.evaluate(()=>window.fixture.owner.canvas.nodes[0].payload.continuity),
            await page.evaluate(()=>window.fixture.continuityBaseline.nodes[0].payload.continuity),'the approved provenance remains fixed');
        await page.evaluate(()=>{const fixture=window.fixture;fixture.owner.canvas=structuredClone(fixture.continuityBaseline);fixture.render();});
        await page.waitForFunction(issue=>!document.querySelector('.nmx-board-generate').disabled
            && !document.querySelector('.nmx-board-panel').innerText.includes(issue),{},continuityIssue);
    }
    await selectMode('referenceToVideo');
    await page.waitForFunction(()=>window.fixture.owner.canvas.nodes[0].payload.mode==='referenceToVideo'
        && document.querySelector('.nmx-board-generate').disabled);
    assert.match(await page.$eval('.nmx-board-panel',el=>el.innerText),/衔接参考或生成方式已改变/,'a compatible media role change still invalidates the approved continuation strategy');
    assert.equal(await page.evaluate(()=>window.fixture.owner.canvas.edges[0].role),'referenceImage');
    await selectMode('imageToVideo');
    await page.waitForFunction(()=>window.fixture.owner.canvas.nodes[0].payload.mode==='imageToVideo'
        && !document.querySelector('.nmx-board-generate').disabled);
    assert.equal(await page.evaluate(()=>window.fixture.owner.canvas.edges[0].role),'firstFrame');
    assert.equal(await page.evaluate(()=>window.fixture.runs.length),2,'continuity changes and recovery never submit a generation');
    // The only prompt stays inline while React updates and directly visible parameter controls receive focus.
    await page.focus('textarea');
    await page.$eval('textarea',el=>{el.select();window.promptElement=el;});
    const beforeInline=await page.evaluate(()=>({params:window.fixture.owner.canvas.nodes[0].payload.parameters,edges:window.fixture.owner.canvas.edges,runs:window.fixture.runs.length}));
    const cdp=await page.createCDPSession();
    await cdp.send('Input.imeSetComposition',{text:'ni',selectionStart:2,selectionEnd:2});
    await page.evaluate(()=>window.fixture.render());
    await cdp.send('Input.imeSetComposition',{text:'你好',selectionStart:2,selectionEnd:2});
    assert.equal(await page.$eval('textarea',el=>el===window.promptElement&&el===document.activeElement),true);
    await cdp.send('Input.insertText',{text:'你好'});
    await page.waitForFunction(()=>window.fixture.owner.canvas.nodes[0].payload.prompt==='你好');
    assert.deepEqual(await page.evaluate(()=>({params:window.fixture.owner.canvas.nodes[0].payload.parameters,edges:window.fixture.owner.canvas.edges,runs:window.fixture.runs.length})),beforeInline);
    assert.equal(await page.$('[data-canvas-float-toggle],.nmx-canvas-floating-grip,.nmx-canvas-floating-host.is-expanded'),null);
    assert.equal(await page.$$eval('.nmx-board-generate',els=>els.length),1);
    await page.focus(await parameter('resolution'));await page.keyboard.press('Escape');
    assert.equal(await page.$('.nmx-board-settings-popover'),null,'direct parameter controls never create a settings modal');
    assert.ok(await page.$('.nmx-canvas-floating-form.is-inline'),'Escape keeps the fixed node form');
    await page.keyboard.press('Escape');
    assert.equal(await page.$eval('textarea',el=>el===window.promptElement),true,'a second Escape never unmounts the input');
    assert.equal(await page.$$eval('.nmx-canvas-floating-form textarea',els=>els.length),1);
    await page.screenshot({path:'/tmp/nextmux-form-inline.png'});
    await page.evaluate(()=>{window.fixture.owner.canvas={...window.fixture.owner.canvas,nodes:window.fixture.owner.canvas.nodes.map((n,i)=>i===0?{...n,id:'different-node',payload:{...n.payload,prompt:'第二个节点'}}:n)};window.fixture.render();});
    await page.waitForFunction(()=>document.querySelector('textarea').value==='第二个节点');
    assert.equal(await page.$$eval('textarea',els=>els.length),1,'switching nodes does not retain the old prompt');
    assert.equal(await page.$eval('textarea',el=>el===window.promptElement),false);
    assert.equal(await page.$$eval('body > .nmx-canvas-floating-host',els=>els.length),0);
    assert.equal(await page.evaluate(()=>window.fixture.runs.length),2);
    // Historical executable camera instructions project to tags while author text stays editable.
    await configure([editable], 'textToVideo', {resolution:'720p',aspectRatio:'16:9',durationSeconds:5,generateAudio:false});
    const legacyPrefix='[Zoom toward the subject] [Pan the camera to the left] [at a slow pace] ';
    await page.evaluate(value=>window.fixture.externalLegacyPrompt(value),legacyPrefix+'Original body');
    await page.waitForFunction(()=>document.querySelector('textarea').value==='Original body');
    assert.equal(await page.$$eval('.nmx-camera-tags [data-camera-remove]',items=>items.length),2);
    assert.equal(await page.evaluate(()=>window.fixture.owner.canvas.nodes[0].payload.prompt),legacyPrefix+'Original body','opening legacy camera tags does not rewrite saved content');
    await page.focus('textarea');await page.$eval('textarea',e=>e.select());
    await cdp.send('Input.imeSetComposition',{text:'ni',selectionStart:2,selectionEnd:2});
    assert.equal(await page.evaluate(()=>window.fixture.owner.canvas.nodes[0].payload.prompt),legacyPrefix+'Original body','unfinished IME never saves pinyin');
    await cdp.send('Input.insertText',{text:'你好'});await page.keyboard.type(' edited body');
    await page.waitForFunction(prefix=>window.fixture.owner.canvas.nodes[0].payload.prompt===prefix+'你好 edited body',{},legacyPrefix);
    assert.equal(await page.$eval('textarea',e=>e.value),'你好 edited body');
    await page.click('.nmx-board-generate');assert.equal(await page.evaluate(()=>window.fixture.runs.at(-1).prompt),legacyPrefix+'你好 edited body','actual run callback receives camera instructions and the latest body');
    await page.click('[data-camera-remove="zoom_in"]');
    await page.waitForFunction(()=>!document.querySelector('[data-camera-remove="zoom_in"]'));
    assert.equal(await page.$eval('textarea',e=>e.value),'你好 edited body','removing a tag preserves author text');
    assert.equal(await page.evaluate(()=>window.fixture.owner.canvas.nodes[0].payload.prompt),'[Pan the camera to the left] [at a slow pace] 你好 edited body');
    await page.click('.nmx-camera-tags [data-camera-action="clear"]');
    await page.waitForFunction(()=>!document.querySelector('.nmx-camera-tags'));
    assert.equal(await page.evaluate(()=>window.fixture.owner.canvas.nodes[0].payload.prompt),'你好 edited body','clear removes instructions without deleting text');
    await page.evaluate(value=>window.fixture.externalLegacyPrompt(value),legacyPrefix.trimEnd());
    await page.waitForFunction(()=>document.querySelector('textarea').value===''&&document.querySelector('.nmx-board-generate').disabled);
    assert.equal(await page.$eval('.nmx-board-generate',e=>e.disabled),true,'camera instructions alone never satisfy authored content');
    assert.equal(await page.evaluate(()=>window.fixture.runs.length),3,'tag and prompt changes never submit a model by themselves');
    // Selecting a camera before writing has no separator until the first real body character.
    await page.click('.nmx-camera-tags [data-camera-action="clear"]');
    await page.waitForFunction(()=>document.querySelector('textarea').value===''&&!document.querySelector('.nmx-camera-tags'));
    await page.evaluate(()=>document.querySelector('main').style.paddingTop='400px');
    await page.click('.nmx-board-panel button.is-camera[aria-expanded]');await page.waitForSelector('.nmx-camera-control');
    await page.click('[data-camera-move="zoom_in"]');await page.click('[data-camera-action="confirm"]');
    await page.waitForFunction(()=>!document.querySelector('.nmx-camera-control')&&document.querySelector('[data-camera-remove="zoom_in"]'));
    const emptyCameraPrefix='[Zoom toward the subject]';
    const cameraDocument=()=>page.evaluate(()=>{const node=window.fixture.owner.canvas.nodes[0];return {prompt:node.payload.prompt,prefix:window.fixture.owner.canvas.settings.nodeCamera[node.id].prefix,body:document.querySelector('textarea').value};});
    assert.deepEqual(await cameraDocument(),{prompt:emptyCameraPrefix,prefix:emptyCameraPrefix,body:''});
    for(const text of ['ABC','XYZ']){
        await page.focus('textarea');
        let body='';
        for(const character of text){
            body+=character;await page.keyboard.type(character);
            await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
            assert.deepEqual(await cameraDocument(),{prompt:emptyCameraPrefix+' '+body,prefix:emptyCameraPrefix+' ',body},'each authored key remains exact after the owner renders');
        }
        await page.$eval('textarea',e=>e.select());await page.keyboard.press('Backspace');
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        assert.deepEqual(await cameraDocument(),{prompt:emptyCameraPrefix,prefix:emptyCameraPrefix,body:''},'clearing the body removes its separator before the next input session');
        assert.equal(await page.$eval('.nmx-board-generate',e=>e.disabled),true);
    }
    assert.equal(await page.evaluate(()=>window.fixture.runs.length),3);
    assert.deepEqual(errors, []);
});
