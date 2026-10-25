import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const puppeteer = (await import(platform.resolve('puppeteer'))).default;
const base = fileURLToPath(new URL('../../../', import.meta.url));
const src = fileURLToPath(new URL('../src/browser/', import.meta.url));

// The next-shot wizard was removed. Exercise the real canvas, including old saved
// continuity provenance, instead of retaining a fixture for the deleted component.
test('the actual canvas has no next-shot wizard, preserves legacy continuity until unlink, and displays pinned/direct video references', { timeout: 60000 }, async t => {
    const { outputFiles } = await desktop('esbuild').build({ stdin: { loader: 'tsx', resolveDir: src, contents: `
import * as React from 'react';import {createRoot} from 'react-dom/client';
import {ComicCanvas} from './nextmux-comic-canvas';
import {continuityText} from './nextmux-comic-continuity-text';
import {createCanvasDocument,validateCanvasDocument} from '@nextmux/comic-core/canvas';
const root=createRoot(document.querySelector('main')),now='2026-10-03T00:00:00.000Z';
const version=id=>({id,assetId:'asset-'+id,kind:'video',uri:'fixture/'+id+'.webm',createdAt:now,metadata:{width:16,height:16,durationMs:1000,mimeType:'video/webm'}});
const first=version('video-v1'),second=version('video-v2'),direct=version('direct-v1');
const source={id:'source',kind:'video',title:'Source video',position:{x:40,y:120},size:{width:280,height:220},payload:{versions:[first,second],currentVersionId:second.id}};
const record={version:1,sourceNodeId:source.id,sourceVersionId:first.id,sourceAssetId:first.assetId,approvedAt:now,intent:'continueAction',strategy:'videoReference',inputVersionId:first.id,inputAssetId:first.assetId,inputNodeId:source.id,boundary:{appearance:'Blue jacket',action:'Hand holds a cup',camera:'Medium shot',story:'At the door'},userPrompt:'Open the door.'};
const target={id:'target',kind:'videoGen',title:'Saved continuation',position:{x:520,y:120},size:{width:360,height:260},payload:{mode:'referenceToVideo',modelId:'fixture',prompt:'Continue opening the door.',parameters:{aspectRatio:'16:9',resolution:'720p',durationSeconds:5},versions:[],continuity:record,inputs:[{id:'direct-reference',role:'referenceVideo',order:1,version:direct}]}};
const edge={id:'pinned-reference',sourceNodeId:'source',sourcePort:'output',targetNodeId:'target',targetPort:'referenceVideo',role:'referenceVideo',order:0,binding:'pinnedVersion',pinnedVersionId:first.id};
let canvas={...createCanvasDocument({id:'canvas',projectId:'project',now}),viewport:{x:0,y:0,zoom:1},nodes:[source,target],edges:[edge]};
validateCanvasDocument(canvas);
const route={key:'route',kind:'video',modelId:'fixture',label:'Fixture',source:'Fixture relay',routeKind:'relay',available:true};
const mode={mode:'referenceToVideo',referenceRules:{video:{supported:true,maxCount:3}},combinationConstraints:[{combination:'video',maxVideos:3}],outputVariants:[{id:'720p',resolution:'720p',aspectRatios:['16:9']}],duration:{kind:'fixed',seconds:5},audioGeneration:{mode:'unsupported',defaultEnabled:false}};
const capability={id:'fixture',providerId:'fixture',providerModelId:'fixture',displayName:'Fixture',version:'v1',status:'available',modes:[mode]};
const calls={changes:[],runs:[],extracts:[],videoInputs:[],modeIntents:[]};
const props={locale:'en',saveState:'saved',models:{image:[],video:[route]},families:{image:[],video:[{id:'fixture',name:'Fixture',vendor:'fixture',available:true,routes:[route]}]},defaultRoute:()=>route,routeOf:()=>route,capabilityOf:()=>({capability}),jobOf:()=>undefined,waiting:new Set(),submitting:new Set(),mediaUrl:uri=>window.fixtureVideos[uri],defaults:{aspectRatio:'16:9',durationSeconds:5},
onChange(next,options){canvas=next;calls.changes.push({record:options?.record!==false});render();},onUndo(){},onRedo(){},onSetRoute(){},onRun:ids=>calls.runs.push(ids),onExtract:id=>calls.extracts.push(id),onExtractVersion:async(...args)=>{calls.extracts.push(args);throw Error('unexpected extraction')},onVideoInput:(...args)=>calls.videoInputs.push(args),onVideoModeIntent:id=>calls.modeIntents.push(id),onImport(){},onUsePortrait(){},onRetrySave(){},onNotice(){},toolProgress:new Map(),onTool:async()=>false,onCancelTool(){},onPickLut:async()=>undefined,onDirectorCapture:async()=>{},onSaveMarks:async()=>{throw Error('unused')},onDirectorImport:async()=>{throw Error('unused')}};
function render(){root.render(<ComicCanvas {...props} canvas={canvas} canUndo={false} canRedo={false}/>)}
window.fixture={calls,get canvas(){return canvas},text:continuityText,followCurrent(){canvas={...canvas,edges:canvas.edges.map(e=>({...e,binding:'followCurrent',pinnedVersionId:undefined}))};render();}};render();
` }, bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty', '.svg': 'dataurl' }, alias: {
        react: core.resolve('react'), 'react/jsx-runtime': core.resolve('react/jsx-runtime'), 'react-dom': core.resolve('react-dom'), 'react-dom/client': core.resolve('react-dom/client'),
        '@nextmux/comic-core/canvas': base + 'packages/comic-core/src/canvas.ts',
        '@nextmux/comic-core/canvas-camera': base + 'packages/comic-core/src/canvas-camera.ts',
        '@nextmux/comic-core/canvas-capabilities': base + 'packages/comic-core/src/canvas-capabilities.ts',
        '@nextmux/comic-core/canvas-continuity': base + 'packages/comic-core/src/canvas-continuity.ts'
    } });
    const reviewDir = base + '.nextmux-run/canvas-continuity-compat-review'; await mkdir(reviewDir, { recursive: true });
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage(), errors = [], external = [];
    page.setDefaultTimeout(7000); page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1400, height: 1000 });
    await page.setRequestInterception(true); page.on('request', request => {
        const url = request.url();
        if (url.startsWith('blob:') || url.startsWith('data:')) return void request.continue();
        if (url === 'https://continuity-compat.test/' && request.isNavigationRequest()) return void request.respond({ status: 200, contentType: 'text/html', body: '<main class="nmx-shell"></main>' });
        if (url === 'https://continuity-compat.test/favicon.ico') return void request.respond({ status: 204 });
        external.push(url); return void request.abort();
    });
    await page.goto('https://continuity-compat.test/');
    for (const name of ['nextmux-comic-canvas.css', 'nextmux-comic-canvas-float.css', 'nextmux-comic-canvas-view-controls.css']) await page.addStyleTag({ content: await readFile(src + 'style/' + name, 'utf8') });
    await page.addStyleTag({ content: await readFile(require.resolve('@xyflow/react/dist/style.css'), 'utf8') });
    await page.addStyleTag({ content: 'html,body,main{height:100%;margin:0}main{--nmx-bg:#171717;--nmx-panel:#222;--nmx-panel-2:#333;--nmx-text:#eee;--nmx-muted:#aaa;--nmx-border:#555;--nmx-accent:#b18cdb;--cv-float:#222;font:13px system-ui}.nmx-board{width:100%;height:100%}' });
    await page.addStyleTag({ content: (await readFile(core.resolve('@vscode/codicons/dist/codicon.css'), 'utf8')).replace(/url\([^)]*codicon\.ttf[^)]*\)/g, 'url(data:font/ttf;base64,' + (await readFile(core.resolve('@vscode/codicons/dist/codicon.ttf'))).toString('base64') + ')') });
    // Produce a tiny, valid local video so ReferenceMedia's error fallback cannot
    // hide a video element just because the test supplied an invalid placeholder URI.
    await page.evaluate(async () => {
        const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
        const context = canvas.getContext('2d'); context.fillStyle = '#5588cc'; context.fillRect(0, 0, 16, 16);
        const stream = canvas.captureStream(10), chunks = [], recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
        const recorded = new Promise((resolve, reject) => { recorder.ondataavailable = e => chunks.push(e.data); recorder.onstop = resolve; recorder.onerror = reject; });
        try {
            recorder.start(); await new Promise(resolve => setTimeout(resolve, 120));
            context.fillStyle = '#6699dd'; context.fillRect(0, 0, 16, 16);
            await new Promise(resolve => setTimeout(resolve, 120)); recorder.stop(); await recorded;
            const blob = new Blob(chunks, { type: 'video/webm' });
            if (!blob.size) throw Error('empty local video fixture');
            window.fixtureVideos = Object.fromEntries(['video-v1', 'video-v2', 'direct-v1'].map(id => ['fixture/' + id + '.webm', URL.createObjectURL(blob)]));
        } finally { stream.getTracks().forEach(track => track.stop()); }
    });
    await page.addScriptTag({ content: outputFiles[0].text });
    const summary = '.nmx-board-continuity-summary';
    const nextShotAbsent = async () => {
        assert.deepEqual(await page.$$eval('button,[role="menuitem"]', els => els.map(e => [e.textContent, e.getAttribute('aria-label'), e.title].filter(Boolean).join(' ')).filter(text => /create next shot|创建下一镜|下一镜头/i.test(text))), []);
        assert.equal(await page.$('.nmx-board-continuity'), null, 'removed next-shot dialog never mounts');
        assert.equal(await page.$('[role="dialog"],dialog'), null, 'selection does not open a replacement wizard');
    };
    await page.waitForSelector('[data-id="source"] header');
    await nextShotAbsent();
    await page.click('[data-id="source"] header'); await page.waitForSelector('.nmx-board-toolbar');
    await nextShotAbsent();
    assert.ok(await page.$('.nmx-board-toolbar button .codicon-device-camera'), 'the real frame-extraction action remains available');
    await page.click('[data-id="source"] header', { button: 'right' }); await page.waitForSelector('.nmx-board-menu[role="menu"]');
    await nextShotAbsent(); await page.keyboard.press('Escape');
    await page.click('[data-id="target"] header'); await page.waitForSelector(summary);
    await nextShotAbsent();
    assert.equal(await page.$eval(summary + ' code', e => e.textContent), 'video-v1', 'saved provenance stays pinned to the approved version');
    assert.equal(await page.$eval(summary + ' [role="status"]', e => e.textContent), await page.evaluate(() => fixture.text('en', 'updated')));
    assert.equal(await page.$(summary + ' [role="alert"]'), null, 'a valid pinned legacy reference is still accepted');
    const videos = '[data-reference-role="referenceVideo"] video';
    await page.waitForFunction(selector => { const videos = [...document.querySelectorAll(selector)]; return videos.length === 2 && videos.every(video => video.readyState >= 1 && video.videoWidth === 16); }, {}, videos);
    assert.deepEqual(await page.$$eval(videos, els => els.map(video => ({ src: video.src, muted: video.muted, inline: video.playsInline, preload: video.preload }))), await page.evaluate(() => ['video-v1', 'direct-v1'].map(id => ({ src: fixtureVideos['fixture/' + id + '.webm'], muted: true, inline: true, preload: 'metadata' }))));
    assert.equal(await page.$$eval('[data-reference-role="referenceVideo"] img', els => els.length), 0, 'video references are not treated as image URIs');
    await page.screenshot({ path: reviewDir + '/legacy-continuity-video-references.png' });
    for (const locale of ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ar', 'hi']) {
        const labels = await page.evaluate(locale => ['source', 'updated', 'unlink', 'invalid'].map(key => fixture.text(locale, key)), locale);
        assert.ok(labels.every(label => typeof label === 'string' && label.length > 0), locale);
    }
    // Changing the actual reference does not silently rewrite old approval: show
    // invalid provenance until the user explicitly removes that record.
    await page.evaluate(() => fixture.followCurrent());
    await page.waitForSelector(summary + ' [role="alert"]');
    assert.equal(await page.$eval(summary + ' code', e => e.textContent), 'video-v1');
    await page.waitForFunction(selector => document.querySelector(selector)?.src === fixtureVideos['fixture/video-v2.webm'], {}, videos);
    const before = await page.evaluate(() => structuredClone(fixture.canvas));
    await page.click(summary + ' button'); await page.waitForFunction(() => !document.querySelector('.nmx-board-continuity-summary'));
    const after = await page.evaluate(() => fixture.canvas);
    const expected = structuredClone(before);
    delete expected.nodes.find(node => node.id === 'target').payload.continuity;
    assert.deepEqual(after.nodes, expected.nodes, 'unlink removes only legacy approval, preserving prompt, parameters, versions and direct references');
    assert.deepEqual(after.edges, before.edges, 'unlink never removes or changes the actual reference wire');
    assert.deepEqual(after.settings, before.settings);
    await nextShotAbsent();
    assert.deepEqual(await page.evaluate(() => ({ runs: fixture.calls.runs, extracts: fixture.calls.extracts, videoInputs: fixture.calls.videoInputs, modeIntents: fixture.calls.modeIntents })), { runs: [], extracts: [], videoInputs: [], modeIntents: [] }, 'inspection and unlink do not generate, extract or change input modes');
    assert.deepEqual(errors, []); assert.deepEqual(external, [], 'all fixture media remains local; no provider/service requests');
});
