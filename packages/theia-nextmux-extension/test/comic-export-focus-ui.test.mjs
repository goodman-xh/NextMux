import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url), core = createRequire(require.resolve('@theia/core/package.json'));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const src = fileURLToPath(new URL('../src/browser/', import.meta.url)), base = fileURLToPath(new URL('../../../', import.meta.url));

test('actual export sheet receives focus, traps Tab, isolates the editor and restores its trigger on close', { timeout: 45000 }, async t => {
    const source = await readFile(src + 'nextmux-desktop-widget.tsx', 'utf8');
    const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const names = new Set(['openComicExportSheet', 'renderComicExportSheet', 'setComicExportDraft', 'startComicExport', 'renameComicExport', 'setComicExportDirectory']), methods = [];
    (function visit(node) { if (ts.isMethodDeclaration(node) && names.has(node.name.getText(ast))) methods.push(node.getText(ast)); ts.forEachChild(node, visit); })(ast);
    assert.equal(methods.length, names.size);
    const { outputFiles } = await desktop('esbuild').build({ stdin: { resolveDir: src, loader: 'tsx', contents: `
import React from 'react';import {createRoot} from 'react-dom/client';
import {CanvasModalLayer} from './nextmux-comic-canvas-modal';import {ComicDesk} from './nextmux-comic-desk';import {ImeInput} from './nextmux-ime-field';
import {comicExportConflictText} from './nextmux-comic-export-conflict-text';import {comicCutText} from './nextmux-comic-cut-text';import {SurfaceTooltips} from './nextmux-surface-tooltips';
const localizeDesktopSurface=(_,value)=>value, dynamicLabel=()=>'',getComicDissolveOverlaps=()=>new Map(),resolveComicShotTransitions=()=>({});
const canvasTimelineText=(_,key)=>key,mediaAuditText=()=>'',ComicExportWarnings=()=>null,comicExportMessageText=()=>'';
const modelFailureText=(_,error)=>String(error.message||error);
const COMIC_EXPORT_DIRECTORY_KEY='fixture.export-directory';
const project={id:'p',title:'Export fixture',revision:1,frameRate:24,canvas:{width:1280,height:720},characters:[],assets:[{id:'image',kind:'image',status:'ready'}],scenes:[{id:'scene',shots:[{id:'shot',durationFrames:48,visualAssetId:'image',dialogueCues:[]}]}]};
class Fixture {
 desktopLocale='en';comicExportSheetOpen=false;comicView='timeline';comicDesk={step:'edit'};activeComicWorkspaceRoot='/fixture';comicExportStage='idle';comicExportState={exports:[],defaultDirectory:'/fixture/output'};
 comicExportDraft={fileName:'',quality:'balanced',subtitleMode:'none'};mediaState={runtime:{ffmpeg:{available:true}}};closes=0;starts=0;underlyingKeys=0;updates=0;
 comicProject=()=>project;comicTimelineDocument=()=>undefined;comicHasDirtyDraft=()=>false;rememberNavigation=()=>{};clearNavigationSurfaces=()=>{};loadComicExportState=async()=>{};comicExportNameIsDefault=()=>false;formatComicTimecode=()=> '00:00:02:00';
 closeNavigationSurface=()=>{this.closes++;this.comicExportSheetOpen=false;this.update();};chooseComicExportDirectory=async()=>{};openSettingsPanel=()=>{};
 node=document.querySelector('main');comicLoadSequence=1;destination={fileName:'Export-fixture.mp4',conflicts:[]};requests=[];
 comicWorkspaceRequestCurrent=(root,sequence)=>root===this.activeComicWorkspaceRoot&&sequence===this.comicLoadSequence;
 platformService={getComicExportDestination:async request=>this.destination,startComicExport:async request=>{this.starts++;this.requests.push(request);return {id:'export',status:'rendering',progress:0,cancellable:true,updatedAt:new Date().toISOString(),projectTitle:'Export fixture'};}};
 comicExportStatusLabel=()=> 'Rendering';cancelComicExport=async()=>{};
 ${methods.join('\n')}
 update(){this.updates++;render();}
}
const fixture=new Fixture(),root=createRoot(document.querySelector('main')),noop=()=>{};
function render(){root.render(<div onKeyDown={()=>fixture.underlyingKeys++}><SurfaceTooltips scope='.nmx-comic-export-sheet'/><ComicDesk locale='en' projectTitle='Export fixture' step='edit' reachable={new Set(['edit'])} episodes={[]} cards={[]} library={[]} focusEpisode={0} focusClip={0} focusCard={0} adapting={false} stopped={false} shooting={false} paused={false} splitting={false} canShoot={false} onStep={noop} onMinimize={noop} onToEditor={noop} onExport={()=>fixture.openComicExportSheet()} editor={<button id='editor-control'>Underlying editor control</button>}/><button id='export-trigger' onClick={()=>fixture.openComicExportSheet()}>Open export</button>{fixture.renderComicExportSheet()}</div>);}
window.fixture=fixture;render();
` }, bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty', '.svg': 'dataurl' }, alias: {
        react: core.resolve('react'), 'react/jsx-runtime': core.resolve('react/jsx-runtime'), 'react-dom': core.resolve('react-dom'), 'react-dom/client': core.resolve('react-dom/client')
    } });
    const puppeteer = (await import(platform.resolve('puppeteer'))).default;
    const browser = await puppeteer.launch({ headless: true, args: ['--force-renderer-accessibility'] }); t.after(() => browser.close());
    const page = await browser.newPage(), errors = []; page.setDefaultTimeout(7000); page.on('pageerror', error => { errors.push(error.message); t.diagnostic(error.message); });
    await page.setViewport({ width: 1280, height: 850 });
    await page.setContent('<main class="nmx-desktop-widget nmx-shell nmx-theme-dark"></main>');
    for (const name of ['nextmux.css', 'nextmux-desktop-production.css', 'nextmux-comic-desk.css', 'nextmux-comic-studio.css', 'nextmux-comic-workshop.css', 'nextmux-comic-canvas.css']) {
        await page.addStyleTag({ content: await readFile(src + 'style/' + name, 'utf8') });
    }
    await page.addStyleTag({ content: 'html,body{margin:0;height:100%}main.nmx-shell{position:absolute;inset:0;display:block}#export-trigger{position:fixed;z-index:1250;top:60px;left:50px}' });
    await page.addScriptTag({ content: outputFiles[0].text });
    const client = await page.createCDPSession(); await client.send('Accessibility.enable');
    const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const field = '.nmx-comic-export-config input';
    const open = async () => { await page.click('#export-trigger'); await page.waitForSelector('dialog:modal .nmx-comic-export-sheet'); await frames(); };
    const focused = selector => page.$eval(selector, element => element === document.activeElement);
    const evidence = [];
    await open();
    assert.equal(await focused(field), true, 'the filename receives initial focus without another click');
    assert.equal(await page.$eval('dialog:modal', element => Boolean(element.closest('.nmx-shell'))), true, 'ancestor-scoped theme stays intact');
    const { root: dom } = await client.send('DOM.getDocument');
    const { nodeId } = await client.send('DOM.querySelector', { nodeId: dom.nodeId, selector: '#editor-control' });
    const { node } = await client.send('DOM.describeNode', { nodeId });
    const { nodes } = await client.send('Accessibility.getFullAXTree');
    const underlying = nodes.find(entry => entry.backendDOMNodeId === node.backendNodeId);
    assert.ok(!underlying || underlying.ignored, 'underlying ARIA modal is excluded while native export is on top');
    await page.$eval('#editor-control', element => element.focus());
    assert.equal(await focused(field), true, 'programmatic focus cannot enter the inert editor');
    await page.focus('.nmx-comic-export-start'); await page.keyboard.press('Tab');
    assert.equal(await focused('.nmx-comic-export-sheet > header button'), true, 'Tab wraps to the first enabled control');
    await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
    assert.equal(await focused('.nmx-comic-export-start'), true, 'Shift+Tab wraps to the last control');
    await page.focus(field); await page.keyboard.press('End'); await page.keyboard.type(' changed'); await frames();
    assert.equal(await focused(field), true, 'rerender after editing does not steal focus');
    assert.equal(await page.evaluate(() => fixture.underlyingKeys), 0, 'modal keys do not reach the editor');
    evidence.push(await page.$eval('.nmx-comic-export-sheet', element => { const r = element.getBoundingClientRect(); return { width: r.width, height: r.height, background: getComputedStyle(element).backgroundColor, focused: document.activeElement?.tagName }; }));
    assert.ok(evidence[0].width > 600 && evidence[0].background !== 'rgba(0, 0, 0, 0)', 'actual export styling remains applied');
    await page.keyboard.press('Escape'); await page.waitForSelector('dialog:modal', { hidden: true });
    assert.equal(await focused('#export-trigger'), true); assert.equal(await page.evaluate(() => fixture.closes), 1);
    await open(); await page.click('.nmx-comic-export-sheet > header button'); await page.waitForSelector('dialog:modal', { hidden: true });
    assert.equal(await focused('#export-trigger'), true, 'close button restores the opener');
    await open();
    await page.$eval(field, element => element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
    await page.keyboard.press('Escape'); assert.ok(await page.$('dialog:modal'), 'IME Escape does not dismiss');
    await page.$eval(field, element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
    await page.evaluate(() => { fixture.comicExportStage = 'starting'; fixture.update(); }); await frames();
    await page.keyboard.press('Escape'); assert.ok(await page.$('dialog:modal'), 'starting state retains the existing close guard');
    await page.evaluate(() => { fixture.comicExportStage = 'idle'; fixture.update(); }); await frames();
    await page.keyboard.press('Escape'); await page.waitForSelector('dialog:modal', { hidden: true }); assert.equal(await focused('#export-trigger'), true);
    await page.evaluate(() => { fixture.comicExportState.active = { id: 'active', status: 'running', progress: 25, cancellable: true }; });
    await open(); assert.equal(await focused('.nmx-comic-export-sheet > header button'), true, 'rendering progress without filename still receives focus');
    const out = base + '.nextmux-run/minimal-fixes-2026-10-04/export-focus'; await mkdir(out, { recursive: true });
    await page.screenshot({ path: out + '/export-active.png' }); await writeFile(out + '/evidence.json', JSON.stringify({ evidence, underlyingEditorIgnored: !underlying || underlying.ignored, requests: await page.evaluate(() => fixture.starts), errors }, null, 2));
    await page.keyboard.press('Escape'); await page.waitForSelector('dialog:modal', { hidden: true });
    assert.equal(await page.evaluate(() => fixture.starts), 0, 'focus verification does not start export or media generation'); assert.deepEqual(errors, []);
    // Same destination choices must gate the actual start method, including a repeat after renaming.
    await page.evaluate(() => { fixture.comicExportState.active=undefined; fixture.destination.conflicts=['Export-fixture.mp4','Export-fixture.srt']; });
    await open(); await page.click('.nmx-comic-export-start');
    await page.waitForSelector('.nmx-comic-export-conflict');
    assert.equal(await page.evaluate(()=>fixture.starts),0,'collision preflight must not render or overwrite');
    assert.equal(await page.$eval('.nmx-comic-export-start',element=>element.disabled),true);
    assert.match(await page.$eval('.nmx-comic-export-conflict',element=>element.textContent),/Files already exist/);
    for (const selector of ['.nmx-comic-export-conflict button:first-child','.nmx-comic-export-conflict button:last-child']) {
        await page.hover(selector);
        const text=await page.$eval(selector,e=>e.textContent);
        await page.waitForFunction(text=>document.querySelector('.nmx-surface-tooltip')?.textContent===text,{},text);
        const before=await page.$eval(selector,e=>({width:e.offsetWidth,height:e.offsetHeight}));
        await frames();
        assert.deepEqual(await page.$eval(selector,e=>({width:e.offsetWidth,height:e.offsetHeight})),before);
    }
    await page.click('.nmx-comic-export-conflict button'); await frames();
    assert.equal(await focused(field),true,'Rename returns focus to the existing filename field');
    assert.equal(await page.$eval(field,e=>e.selectionEnd-e.selectionStart),await page.$eval(field,e=>e.value.length));
    await page.keyboard.type('Renamed film');
    assert.equal(await page.$('.nmx-comic-export-conflict'),null);
    await page.click('.nmx-comic-export-start'); await page.waitForSelector('.nmx-comic-export-conflict');
    await page.click('.nmx-comic-export-conflict button:last-child');
    await page.waitForSelector('.nmx-comic-export-active');
    assert.equal(await page.evaluate(()=>fixture.requests[0].destinationConflict),'overwrite');
    assert.equal(await page.evaluate(()=>fixture.requests[0].fileName),'Renamed film');
    await page.evaluate(()=>{fixture.comicExportState.active=undefined;fixture.destination.conflicts=[];fixture.update();});
    await page.waitForSelector('.nmx-comic-export-start');
    await page.click('.nmx-comic-export-start'); await page.waitForSelector('.nmx-comic-export-active');
    assert.equal(await page.evaluate(()=>fixture.requests[1].destinationConflict),'error','overwrite authorization is not reused for another export');
    await page.evaluate(()=>{fixture.comicExportState.active=undefined;fixture.comicExportDraft.fileName='Occupied';fixture.destination.conflicts=['Occupied.mp4'];fixture.update();});
    await page.waitForSelector('.nmx-comic-export-start');
    await page.click('.nmx-comic-export-start'); await page.waitForSelector('.nmx-comic-export-conflict');
    await page.evaluate(()=>fixture.setComicExportDirectory('/different-folder')); await frames();
    assert.equal(await page.$('.nmx-comic-export-conflict'),null,'changing folder invalidates prior confirmation');
    await page.evaluate(async()=>{fixture.platformService.getComicExportDestination=async()=>{fixture.comicLoadSequence++;return fixture.destination;};await fixture.startComicExport();});
    assert.equal(await page.evaluate(()=>fixture.starts),2,'late destination lookup cannot start another workspace export');
    assert.deepEqual(errors, []);
});
