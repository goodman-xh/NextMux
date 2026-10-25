import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url), core = createRequire(require.resolve('@theia/core/package.json'));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const puppeteer = (await import(platform.resolve('puppeteer'))).default;
const repo = fileURLToPath(new URL('../../../', import.meta.url)), src = fileURLToPath(new URL('../src/browser/', import.meta.url));

test('actual canvas shortcuts precede editor capture and respect desk, input, IME, modal and navigation lifecycles', { timeout: 60000 }, async t => {
    const contribution = await readFile(src+'nextmux-desktop-contribution.ts','utf8');
    const shellHandler = contribution.match(/protected readonly handleProductWorkbenchShortcut =[\s\S]*?\n    };/)?.[0];
    const navigationTargetGuard = contribution.match(/protected canHandleNavigationShortcut\([\s\S]*?\n    }/)?.[0];
    assert.ok(shellHandler,'extract the actual early shell capture handler');
    assert.ok(navigationTargetGuard,'extract the navigation keyboard ownership guard');
    const { outputFiles } = await desktop('esbuild').build({ stdin: { resolveDir: src, loader:'tsx', contents: `
import React from 'react';import {createRoot} from 'react-dom/client';import {ComicCanvas} from './nextmux-comic-canvas';
import {isOSX} from '@theia/core/lib/common/os';
import {canvasKeyboardOwnsTarget} from './nextmux-comic-canvas-keyboard';
import {createCanvasDocument} from '@nextmux/comic-core/canvas';import {createCanvasNode} from './nextmux-comic-canvas-logic';import {groupCanvasNodes} from './nextmux-comic-canvas-groups';
let copied='',denyBrowser=false,failNative=false,holdNativeRead=false,releaseRead;const clipCalls={browserWrites:0,nativeWrites:0,nativeReads:0};Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{clipCalls.browserWrites++;if(denyBrowser)throw new DOMException('Write permission denied','NotAllowedError');copied=value;},readText:async()=>{if(denyBrowser)throw new DOMException('Read permission denied','NotAllowedError');return copied;}}});
const now='2026-10-03T00:00:00Z',root=createRoot(document.querySelector('main'));
let canvas={...createCanvasDocument({id:'canvas',projectId:'project',now}),viewport:{x:10,y:10,zoom:1},nodes:['a','b','c'].map((id,i)=>({...createCanvasNode('text',{x:50+i*240,y:100},{title:id}),id,size:{width:200,height:160},payload:{text:'text '+id}}))};
canvas=groupCanvasNodes(canvas,['a','b'],{title:'Scene',now}).canvas;let past=[],future=[];const calls={recorded:0,viewports:0,shell:0,imports:[],notices:[],unboundZoomKeys:[]};
document.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&/^[qe]$/i.test(event.key))calls.unboundZoomKeys.push({key:event.key,meta:event.metaKey,ctrl:event.ctrlKey,prevented:event.defaultPrevented});});
function change(next,opts={}){if(opts.record!==false){past.push(canvas);future=[];calls.recorded++;}else calls.viewports++;canvas=next;render();}
const props={locale:'en',saveState:'saved',models:{image:[],video:[]},defaultRoute:()=>undefined,routeOf:()=>undefined,capabilityOf:()=>undefined,jobOf:()=>undefined,waiting:new Set(),submitting:new Set(),mediaUrl:()=>'',defaults:{aspectRatio:'16:9',durationSeconds:5},onChange:change,
onUndo(){if(past.length){future.push(canvas);canvas=past.pop();render();}},onRedo(){if(future.length){past.push(canvas);canvas=future.pop();render();}},onSetRoute(){},onRun(){throw Error('unexpected generation')},onExtract(){},onImport(position,files){calls.imports.push({position,files:files.map(file=>({name:file.name,type:file.type}))});},onUsePortrait(){},onRetrySave(){},onNotice(message){calls.notices.push(message);},toolProgress:new Map(),onTool:async()=>false,onCancelTool(){},onPickLut:async()=>undefined};
function render(){root.render(<ComicCanvas {...props} canvas={canvas} canUndo={past.length>0} canRedo={future.length>0}/>)}
class Shell { ${navigationTargetGuard} ${shellHandler} };const shell=new Shell();window.addEventListener('keydown',event=>shell.handleProductWorkbenchShortcut(event),true);
document.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key==='a'&&!event.target.closest?.('input,textarea,[contenteditable]')){calls.shell++;event.preventDefault();event.stopPropagation();}},true);
window.fixture={calls,clipCalls,enableNativeDenied(){denyBrowser=true;window.electronTheiaCore={writeClipboard:async text=>{clipCalls.nativeWrites++;if(failNative)throw Error('native clipboard unavailable');copied=text;},readClipboard:async()=>{clipCalls.nativeReads++;const text=copied;if(holdNativeRead)await new Promise(resolve=>releaseRead=resolve);return text;}};},setFailNative(value){failNative=value;},holdRead(){holdNativeRead=true;},releaseRead(){holdNativeRead=false;releaseRead?.();releaseRead=undefined;},get canvas(){return canvas},get past(){return past},get copied(){return copied},reset(){past=[];future=[];calls.recorded=0;calls.viewports=0;},scope(){canvas={...canvas,id:canvas.id+'-next'};render();}};render();
` }, bundle:true, write:false, platform:'browser', format:'iife', loader:{'.css':'empty','.svg':'dataurl'}, alias:{react:core.resolve('react'),'react/jsx-runtime':core.resolve('react/jsx-runtime'),'react-dom':core.resolve('react-dom'),'react-dom/client':core.resolve('react-dom/client'),'@nextmux/comic-core/canvas':repo+'packages/comic-core/src/canvas.ts','@nextmux/comic-core/canvas-capabilities':repo+'packages/comic-core/src/canvas-capabilities.ts'} });
    const browser = await puppeteer.launch({ headless:true }); t.after(()=>browser.close());
    const page = await browser.newPage(); page.setDefaultTimeout(5000); await page.setViewport({width:1200,height:900});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);page.on('request',request=>void request.respond({status:200,contentType:'text/html',body:'<div class="nmx-desk-backdrop" role="dialog" aria-modal="true"><main class="nmx-shell"></main></div><input id="coding" value="code editor text"><div id="rich" contenteditable="true">rich text</div>'}));
    await page.goto('https://canvas-keyboard.test/');
    for (const name of ['nextmux-comic-canvas.css','nextmux-comic-canvas-float.css','nextmux-comic-canvas-view-controls.css']) await page.addStyleTag({content:await readFile(src+'style/'+name,'utf8')});
    await page.addStyleTag({content:await readFile(require.resolve('@xyflow/react/dist/style.css'),'utf8')});
    await page.addStyleTag({content:'html,body{margin:0}main{width:1100px;height:760px;--nmx-bg:#171717;--nmx-panel:#222;--nmx-panel-2:#333;--nmx-text:#eee;--nmx-muted:#aaa;--nmx-border:#555;--nmx-accent:#b18cdb;--theia-editor-background:#222;--theia-foreground:#eee;--theia-panel-border:#555;--theia-input-background:#333;--theia-input-foreground:#eee;--theia-descriptionForeground:#aaa;font:13px system-ui}.nmx-board{width:100%;height:100%}'});
    await page.addScriptTag({content:outputFiles[0].text});await page.waitForSelector('.react-flow__node[data-id="a"]');
    const chord=async(key,shift=false,mod='Meta')=>{await page.keyboard.down(mod);if(shift)await page.keyboard.down('Shift');await page.keyboard.press(key);if(shift)await page.keyboard.up('Shift');await page.keyboard.up(mod);};
    const count=()=>page.$$eval('.react-flow__node.selected',nodes=>nodes.length);
    const boardFocus=()=>page.$eval('.nmx-board',el=>el.focus());
    const viewport=()=>page.$eval('.react-flow__viewport',el=>{const m=new DOMMatrix(getComputedStyle(el).transform);return{x:m.e,y:m.f,zoom:m.a};});
    await chord('a');await page.waitForFunction(()=>document.querySelectorAll('.react-flow__node.selected').length===fixture.canvas.nodes.length);
    assert.equal(await count(),4,'body focus after opening the desk selects all nodes including group members');assert.equal(await page.evaluate(()=>fixture.calls.shell),0,'canvas capture precedes Theia document capture');
    await page.keyboard.press('Escape');await page.waitForFunction(()=>document.querySelectorAll('.react-flow__node.selected').length===0);
    await page.click('[data-id="c"] .nmx-board-node-title');await chord('a');await page.waitForFunction(()=>document.querySelectorAll('.react-flow__node.selected').length===4);
    await chord('g',true);await page.waitForFunction(()=>fixture.canvas.groups.length===0);assert.equal(await page.evaluate(()=>fixture.canvas.nodes.length),3,'actual earlier shell capture yields Shift+Cmd+G to canvas ungroup');await chord('z');await page.waitForFunction(()=>fixture.canvas.nodes.length===4);await page.evaluate(()=>fixture.reset());await chord('a');await page.waitForFunction(()=>document.querySelectorAll('.react-flow__node.selected').length===4);
    // Undoing duplicate removes the duplicate IDs from local selection before another node is selected.
    await page.keyboard.press('Escape');await page.click('[data-id="c"] .nmx-board-node-title');await boardFocus();await chord('d');await page.waitForFunction(()=>fixture.canvas.nodes.length===5);await chord('z');await page.waitForFunction(()=>fixture.canvas.nodes.length===4);
    await page.click('[data-id="c"] .nmx-board-node-title');await page.waitForFunction(()=>document.querySelectorAll('.react-flow__node.selected').length===1);
    assert.equal(await page.$('.nmx-board-selection'),null,'undo does not leave invisible duplicate IDs in the selection toolbar');
    await boardFocus();await chord('z',true);await page.waitForFunction(()=>fixture.canvas.nodes.length===5);assert.equal(await count(),1,'redo preserves the surviving selection without reviving deleted IDs');
    await chord('z');await page.waitForFunction(()=>fixture.canvas.nodes.length===4);await chord('a');await page.waitForFunction(()=>document.querySelectorAll('.react-flow__node.selected').length===4);await page.evaluate(()=>fixture.reset());
    await page.evaluate(()=>fixture.enableNativeDenied());
    await chord('c');assert.equal(await page.evaluate(()=>fixture.clipCalls.nativeWrites),1,'Electron uses its existing preload bridge when browser clipboard permission is denied');assert.equal(await page.evaluate(()=>fixture.clipCalls.browserWrites),0,'denied browser API is bypassed');assert.equal(await page.evaluate(()=>JSON.parse(fixture.copied).nodes.length),4);
    // A genuine key chord on a non-editable div must work even when Electron sends no paste event.
    await boardFocus();await chord('v');await page.waitForFunction(()=>fixture.canvas.nodes.length===8);
    assert.equal(await page.evaluate(()=>fixture.calls.recorded),1,'desktop keydown alone pastes in one undo transaction');
    assert.equal(await page.evaluate(()=>fixture.clipCalls.nativeReads),1,'desktop fallback uses the existing native bridge');
    const dispatchPaste=()=>page.evaluate(()=>{const data=new DataTransfer();data.setData('text/plain',fixture.copied);document.querySelector('.nmx-board').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
    await chord('z');await page.waitForFunction(()=>fixture.canvas.nodes.length===4);await page.evaluate(()=>{fixture.reset();fixture.holdRead();});
    await chord('v');await dispatchPaste();await page.waitForFunction(()=>fixture.canvas.nodes.length===8);await page.evaluate(()=>fixture.releaseRead());await new Promise(r=>setTimeout(r,30));
    assert.equal(await page.evaluate(()=>fixture.calls.recorded),1,'native paste event first claims the gesture before the delayed desktop read');
    await chord('z');await page.waitForFunction(()=>fixture.canvas.nodes.length===4);await page.evaluate(()=>fixture.reset());
    await page.keyboard.down('Meta');await page.keyboard.down('v');await page.waitForFunction(()=>fixture.canvas.nodes.length===8);await dispatchPaste();
    assert.equal(await page.evaluate(()=>fixture.calls.recorded),1,'desktop read first suppresses the matching native event for that same gesture');
    await page.keyboard.up('v');await page.keyboard.up('Meta');
    await page.evaluate(()=>{fixture.calls.notices.length=0;fixture.setFailNative(true);});await chord('c');await page.waitForFunction(()=>fixture.calls.notices.length>0);assert.equal(await page.evaluate(()=>fixture.calls.notices.some(text=>text.startsWith('Copied'))),false,'failed native write never reports copy success');assert.equal(await page.evaluate(()=>fixture.calls.notices.at(-1)),'The clipboard is unavailable. Please try again.');await page.evaluate(()=>fixture.setFailNative(false));
    await chord('z');await page.waitForFunction(()=>fixture.canvas.nodes.length===4);await chord('z',true);await page.waitForFunction(()=>fixture.canvas.nodes.length===8);
    await chord('a');await page.keyboard.press('Backspace');await page.waitForFunction(()=>fixture.canvas.nodes.length===0);await chord('z');await page.waitForFunction(()=>fixture.canvas.nodes.length===8);
    await chord('a');await page.keyboard.press('Escape');await page.waitForFunction(()=>document.querySelectorAll('.react-flow__node.selected').length===0);
    await page.waitForSelector('[data-id="a"] textarea');await page.click('[data-id="a"] textarea');await page.waitForFunction(()=>document.querySelectorAll('.react-flow__node.selected').length===1);await chord('a');assert.equal(await count(),1,'textarea select-all does not select canvas');
    assert.equal(await page.evaluate(()=>{const event=new KeyboardEvent('keydown',{key:'a',metaKey:true,bubbles:true,cancelable:true});document.activeElement.dispatchEvent(event);return event.defaultPrevented;}),false,'input shortcut is left to the native editor');
    // Headless Chrome does not have Electron's macOS edit menu; send the same native editing command through CDP.
    const cdp=await page.createCDPSession();await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:4,commands:['selectAll']});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:0});
    const inputSelection=await page.evaluate(()=>{const el=document.activeElement;return[el.tagName,el.selectionStart,el.selectionEnd,el.value.length];});assert.equal(inputSelection[0],'TEXTAREA');assert.equal(inputSelection[2]-inputSelection[1],inputSelection[3]);
    await boardFocus();await page.evaluate(()=>document.querySelector('.nmx-board').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})));
    await chord('a');assert.equal(await count(),1,'composition suppresses commands');await page.evaluate(()=>document.querySelector('.nmx-board').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
    await page.evaluate(()=>{const modal=document.createElement('dialog');modal.id='overlay';modal.innerHTML='<button>Modal</button>';document.body.append(modal);modal.showModal();});await chord('a');assert.equal(await count(),1,'top-layer dialog suppresses commands');await page.evaluate(()=>{document.querySelector('#overlay').close();document.querySelector('#overlay').remove();});
    await page.focus('#coding');await chord('a');assert.equal(await count(),1,'coding controls remain independent');await page.focus('#rich');await chord('a');assert.equal(await count(),1,'contenteditable remains independent');
    await boardFocus();assert.equal(await page.evaluate(()=>{const data=new DataTransfer();data.items.add(new File(['image fixture'],'clipboard.png',{type:'image/png'}));const event=new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true});document.querySelector('.nmx-board').dispatchEvent(event);return event.defaultPrevented;}),true);assert.equal(await page.evaluate(()=>fixture.calls.imports[0].files[0].name),'clipboard.png');
    await page.evaluate(()=>{const data=new DataTransfer();data.setData('text/plain','unrelated external text');document.querySelector('.nmx-board').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});assert.equal(await page.evaluate(()=>fixture.canvas.nodes.length),8,'external text never re-pastes the old canvas clipboard');
    await page.focus('#coding');assert.equal(await page.evaluate(()=>{const data=new DataTransfer();data.items.add(new File(['image fixture'],'input.png',{type:'image/png'}));const event=new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true});document.querySelector('#coding').dispatchEvent(event);return event.defaultPrevented;}),false);assert.equal(await page.evaluate(()=>fixture.calls.imports.length),1,'input paste is not imported onto canvas');
    await boardFocus();await page.evaluate(()=>fixture.reset());const before=await viewport();await page.keyboard.down('w');await page.waitForFunction(y=>new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).f>y+25,{},before.y);await page.keyboard.up('w');
    const after=await viewport();assert.ok(after.y>before.y);await new Promise(r=>setTimeout(r,80));assert.equal((await viewport()).y,after.y,'keyup ends continuous movement');assert.equal(await page.evaluate(()=>fixture.calls.viewports),1,'held navigation saves only on completion');
    await page.keyboard.down('e');await page.waitForFunction(z=>new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).a>z*1.03,{},after.zoom);await page.keyboard.up('e');const zoomed=await viewport();assert.ok(zoomed.zoom>after.zoom);
    await page.keyboard.down('q');await page.waitForFunction(z=>new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).a<z*0.97,{},zoomed.zoom);await page.keyboard.up('q');
    for(const mod of ['Meta','Control']){
        const beforeChord=await viewport();await chord('=',false,mod);await page.waitForFunction(z=>new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).a>z*1.1,{},beforeChord.zoom);await new Promise(r=>setTimeout(r,180));
        const plus=await viewport();await chord('-',false,mod);await page.waitForFunction(z=>new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).a<z*0.9,{},plus.zoom);await new Promise(r=>setTimeout(r,180));
        const stable=await viewport();await chord('q',false,mod);await chord('e',false,mod);await new Promise(r=>setTimeout(r,80));
        assert.deepEqual(await viewport(),stable,mod+' Q/E never zoom the canvas');
    }
    const unbound=await page.evaluate(()=>fixture.calls.unboundZoomKeys);assert.deepEqual(unbound.map(event=>[event.key,event.meta,event.ctrl,event.prevented]),[['q',true,false,false],['e',true,false,false],['q',false,true,false],['e',false,true,false]],'Command Q reaches the next handler without preventDefault or propagation interception');
    await chord('0');await new Promise(r=>setTimeout(r,360));assert.ok((await viewport()).zoom>=0.15);
    await page.keyboard.down('d');await page.waitForFunction(()=>fixture.calls.viewports>=3);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));const blur=await viewport();await new Promise(r=>setTimeout(r,80));assert.deepEqual(await viewport(),blur,'window blur clears held keys');await page.keyboard.up('d');
    await page.keyboard.down('Space');await page.mouse.move(950,650);await page.mouse.down();await page.mouse.move(1000,690,{steps:5});await page.mouse.up();await page.keyboard.up('Space');
    const panned=await viewport();assert.ok(Math.abs(panned.x-blur.x)>10,'Space plus left drag pans the canvas');
    await page.click('[aria-label="Zoom"]');await page.waitForSelector('.nmx-board-zoom-menu');
    for(const [label,key] of [['Zoom in','E'],['Zoom out','Q']]){
        const displayed=await page.$eval('.nmx-board-zoom-menu [aria-label="'+label+'"]',el=>({keys:[...el.querySelectorAll('kbd')].map(k=>k.textContent),text:el.textContent}));
        assert.deepEqual(displayed,{keys:[key],text:label+key},'zoom menu advertises only the unmodified key');
    }
    const menuView=await viewport();await page.keyboard.down('w');await new Promise(r=>setTimeout(r,80));await page.keyboard.up('w');assert.deepEqual(await viewport(),menuView,'navigation does not steal keys from the zoom menu');await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.nmx-board-zoom-menu'));assert.equal(await count(),1,'menu Escape closes the menu without clearing selection');
    await page.click('.nmx-board-view-controls button:has(.codicon-question)');await page.waitForSelector('.nmx-canvas-guide');
    const guideKeys=await page.$$eval('.nmx-canvas-guide-keys > div',rows=>rows.filter(row=>['Zoom in','Zoom out'].includes(row.firstElementChild?.textContent)).map(row=>({keys:[...row.querySelectorAll('kbd')].map(k=>k.textContent),text:row.textContent})));
    assert.deepEqual(guideKeys,[{keys:['E'],text:'Zoom inE'},{keys:['Q'],text:'Zoom outQ'}],'guide and menu advertise only E and Q while modifier shortcuts remain functional');await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.nmx-canvas-guide'));
    await boardFocus();const originalPositions=await page.evaluate(()=>fixture.canvas.nodes.map(n=>n.position));const card=await page.$eval('[data-id="c"] header',el=>{const r=el.getBoundingClientRect();return{x:r.left+10,y:r.top+10};});
    await page.keyboard.down('Space');await page.mouse.move(card.x,card.y);await page.mouse.down();await page.mouse.move(card.x+60,card.y+40,{steps:5});await page.mouse.up();await page.keyboard.up('Space');assert.deepEqual(await page.evaluate(()=>fixture.canvas.nodes.map(n=>n.position)),originalPositions,'Space drag over a node never moves that node');
    await page.keyboard.down('w');await page.evaluate(()=>fixture.scope());await new Promise(r=>setTimeout(r,80));const switched=await viewport();await new Promise(r=>setTimeout(r,80));assert.deepEqual(await viewport(),switched,'switching canvases clears navigation keys even before keyup');await page.keyboard.up('w');
    const countBeforeScope=await page.evaluate(()=>fixture.canvas.nodes.length);await boardFocus();await page.evaluate(()=>fixture.holdRead());await chord('v');await page.evaluate(()=>fixture.scope());await new Promise(r=>setTimeout(r,20));await page.evaluate(()=>fixture.releaseRead());await new Promise(r=>setTimeout(r,30));assert.equal(await page.evaluate(()=>fixture.canvas.nodes.length),countBeforeScope,'late native read cannot paste after the canvas scope changes');
    await boardFocus();await page.evaluate(()=>fixture.holdRead());await chord('v');await page.keyboard.press('Escape');await page.evaluate(()=>fixture.releaseRead());await new Promise(r=>setTimeout(r,30));assert.equal(await page.evaluate(()=>fixture.canvas.nodes.length),countBeforeScope,'Escape cancels a pending native clipboard read');
    await page.click('[data-id="a"] textarea');await page.waitForFunction(()=>document.querySelectorAll('.react-flow__node.selected').length===1);
    await page.evaluate(()=>document.querySelector('.nmx-desk-backdrop').style.display='none');await chord('a');assert.equal(await count(),1,'hidden comic canvas does not intercept coding shortcuts');assert.ok(await page.evaluate(()=>fixture.calls.shell)>0);
    assert.deepEqual(errors,[]);
});
