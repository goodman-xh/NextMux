import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url), core = createRequire(require.resolve('@theia/core/package.json'));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const puppeteer = (await import(platform.resolve('puppeteer'))).default;
const base = fileURLToPath(new URL('../../../', import.meta.url)), src = fileURLToPath(new URL('../src/browser/', import.meta.url));

test('real canvas image/video preview closes on blank click with accurate close hitbox and no canvas click-through', { timeout: 60000 }, async t => {
    const { outputFiles } = await desktop('esbuild').build({ stdin: { resolveDir: src, loader: 'tsx', contents: `
import React from 'react';import {createRoot} from 'react-dom/client';import {ComicCanvas} from './nextmux-comic-canvas';
import {createCanvasDocument} from '@nextmux/comic-core/canvas';
const root=createRoot(document.querySelector('main')),now='2026-10-03T00:00:00Z';
const picture=(w,h)=>'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'"><rect width="100%" height="100%" fill="#346178"/><circle cx="50%" cy="50%" r="80" fill="#e2b969"/></svg>');
const media={wide:picture(1920,1080),tall:picture(900,1600),video:''};
const nodes=['wide','tall','video'].map((id,i)=>({id,kind:id==='video'?'video':'image',title:id,position:{x:50+i*330,y:90},size:{width:280,height:220},payload:{versions:[{id:'v-'+id,assetId:'a-'+id,uri:id,kind:id==='video'?'video':'image',createdAt:now}],currentVersionId:'v-'+id}}));
let canvas={...createCanvasDocument({id:'c',projectId:'p',now}),viewport:{x:1,y:1,zoom:1},nodes};
const calls={runs:[],tools:[],changes:0,down:0,up:0,click:0};
const props={locale:'en',saveState:'saved',canUndo:false,canRedo:false,models:{image:[],video:[]},families:{image:[],video:[]},defaultRoute:()=>undefined,routeOf:()=>undefined,capabilityOf:()=>({}),jobOf:()=>undefined,waiting:new Set(),submitting:new Set(),mediaUrl:uri=>media[uri]||'',defaults:{aspectRatio:'16:9',durationSeconds:5},onChange(next){canvas=next;calls.changes++;render();},onUndo(){},onRedo(){},onSetRoute(){},onRun:ids=>calls.runs.push(ids),onExtract(){},onImport(){},onUsePortrait(){},onRetrySave(){},onNotice(){},toolProgress:new Map(),onTool:async(...args)=>{calls.tools.push(args);return false;},onCancelTool(){},onPickLut:async()=>undefined,onDirectorCapture:async()=>{},onSaveMarks:async()=>{throw Error('unused');},onDirectorImport:async()=>{throw Error('unused');}};
function render(){root.render(<ComicCanvas {...props} canvas={canvas}/>);}window.fixture={calls,render,async recordVideo(){const c=document.createElement('canvas');c.width=640;c.height=360;const context=c.getContext('2d');context.fillStyle='#246';context.fillRect(0,0,640,360);const stream=c.captureStream(10),recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'}),chunks=[];recorder.ondataavailable=e=>chunks.push(e.data);const ready=new Promise(resolve=>recorder.onstop=resolve);recorder.start();await new Promise(r=>setTimeout(r,350));recorder.stop();await ready;stream.getTracks().forEach(track=>track.stop());media.video=URL.createObjectURL(new Blob(chunks,{type:'video/webm'}));render();}};render();
` }, bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty', '.svg': 'dataurl' }, alias: {
        react: core.resolve('react'), 'react/jsx-runtime': core.resolve('react/jsx-runtime'), 'react-dom': core.resolve('react-dom'), 'react-dom/client': core.resolve('react-dom/client'),
        '@nextmux/comic-core/canvas': base + 'packages/comic-core/src/canvas.ts', '@nextmux/comic-core/canvas-capabilities': base + 'packages/comic-core/src/canvas-capabilities.ts'
    } });
    const evidence = base + '.nextmux-run/canvas-lightbox-review'; await mkdir(evidence, { recursive: true });
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage(); page.setDefaultTimeout(6000); await page.setViewport({ width: 1400, height: 900 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true); page.on('request', request => void (request.url().startsWith('data:') || request.url().startsWith('blob:') ? request.continue() : request.respond({ status: 200, contentType: 'text/html', body: '<main class="nmx-desktop-widget nmx-shell"></main>' })));
    await page.goto('https://canvas-lightbox.fixture/');
    // Include actual cross-surface rules: the native modal carries nmx-desktop-widget,
    // so a canvas-only CSS fixture would miss global sizing/font overrides.
    const frontend = await readFile(src + 'nextmux-frontend-module.ts', 'utf8');
    const styles = [...frontend.matchAll(/import ['"]\.\.\/\.\.\/src\/browser\/style\/([^'"]+\.css)['"]/g)].map(match => match[1]);
    for (const name of [...styles, 'nextmux-comic-canvas.css', 'nextmux-comic-canvas-float.css', 'nextmux-comic-canvas-dock.css']) {
        await page.addStyleTag({ content: await readFile(src + 'style/' + name, 'utf8') });
    }
    await page.addStyleTag({ content: await readFile(require.resolve('@xyflow/react/dist/style.css'), 'utf8') });
    await page.addStyleTag({ content: 'html,body{margin:0;height:100%}main.nmx-shell{position:absolute;inset:0;display:block}' });
    await page.addStyleTag({ content: (await readFile(core.resolve('@vscode/codicons/dist/codicon.css'), 'utf8')).replace(/url\([^)]*codicon\.ttf[^)]*\)/g, 'url(data:font/ttf;base64,' + (await readFile(core.resolve('@vscode/codicons/dist/codicon.ttf'))).toString('base64') + ')') });
    await page.addScriptTag({ content: outputFiles[0].text }); await page.waitForSelector('[data-id="wide"] img');
    await page.evaluate(async () => {
        await fixture.recordVideo();
        const board = document.querySelector('.nmx-board');
        for (const [event, key] of [['pointerdown', 'down'], ['pointerup', 'up'], ['click', 'click']]) board.addEventListener(event, () => fixture.calls[key]++);
    });
    const rect = selector => page.$eval(selector, element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; });
    const open = async id => {
        await page.click(`[data-id="${id}"] ${id === 'video' ? 'video' : 'img'}`, { count: 2 });
        await page.waitForSelector('.nmx-board-lightbox').catch(async error => {
            await page.screenshot({ path: evidence + '/open-failed-' + id + '.png' });
            console.log('preview open diagnostic', await page.evaluate(id => { const m=document.querySelector('[data-id="'+id+'"] img,[data-id="'+id+'"] video'),r=m.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{image:{x:r.x,y:r.y,width:r.width,height:r.height},hit:hit?.outerHTML.slice(0,240),modal:document.querySelector('dialog')?.open,errors:fixture.calls};},id));
            throw error;
        });
        await page.waitForFunction(() => { const media = document.querySelector('.nmx-board-lightbox img, .nmx-board-lightbox video'); return media instanceof HTMLImageElement ? media.complete && media.naturalWidth > 0 : media.readyState >= 1; });
    };
    const closed = () => page.waitForFunction(() => !document.querySelector('.nmx-board-lightbox') && !document.querySelector('dialog:modal'));
    const counts = () => page.evaluate(() => ({ ...fixture.calls }));
    const box = '.nmx-board-lightbox', close = '.nmx-board-lightbox-close';
    await open('wide'); await page.keyboard.press('Escape'); await closed();

    for (const id of ['wide', 'tall', 'video']) {
        await t.test(id + ': accurate close target and media/control clicks preserve preview', async () => {
            await open(id);
            const bounds = await rect(close), glyph = await rect(close + ' .codicon');
            assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.right <= 1400 && bounds.bottom <= 900);
            assert.equal(bounds.width, 40); assert.equal(bounds.height, 40);
            assert.ok(Math.abs(glyph.x + glyph.width / 2 - bounds.x - bounds.width / 2) < 1);
            assert.ok(Math.abs(glyph.y + glyph.height / 2 - bounds.y - bounds.height / 2) < 1);
            const hitSamples = await page.$eval(close, element => {
                const r = element.getBoundingClientRect();
                return [[.5,.5],[.15,.5],[.85,.5],[.5,.15],[.5,.85]].map(([x,y]) => element.contains(document.elementFromPoint(r.x+r.width*x,r.y+r.height*y)));
            });
            assert.deepEqual(hitSamples, [true,true,true,true,true], 'the visible close circle receives pointer events at its centre and four sides');
            const before = await counts();
            await page.click(box + (id === 'video' ? ' video' : ' img')); assert.ok(await page.$(box), 'clicking actual media keeps the preview open');
            if (id === 'video') {
                const media = await rect(box + ' video');
                await page.mouse.click(media.x + 25, media.bottom - 22); // Actual native player control area.
                assert.ok(await page.$(box), 'native video controls do not count as blank backdrop');
            }
            await page.screenshot({ path: evidence + '/' + id + '.png' });
            assert.deepEqual(await rect(close), bounds, 'interacting with media never scrolls the close button away from its visible top-right hitbox');
            await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await closed();
            assert.deepEqual(await counts(), before, 'media and close clicks do not leak pointer events or model actions to the canvas');
        });
        await t.test(id + ': a complete blank click closes without dispatching its release to the canvas', async () => {
            await open(id); const before = await counts();
            const media = await rect(box + (id === 'video' ? ' video' : ' img'));
            const point = { x: 16, y: Math.min(450, media.y + media.height / 2) };
            assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.classList.contains('nmx-board-lightbox'), point), true);
            await page.mouse.move(point.x, point.y); await page.mouse.down();
            const remainedDuringPress = Boolean(await page.$(box));
            await page.mouse.up(); await closed();
            assert.deepEqual(await counts(), before, 'blank-close gesture is consumed by the preview through mouse release');
            assert.ok(remainedDuringPress, 'a press alone must not unmount the modal before the user completes a blank click');
        });
    }
    await t.test('dragging from blank into media preserves preview; Escape closes normally', async () => {
        await open('wide'); const before = await counts(), media = await rect(box + ' img');
        await page.mouse.move(16, 450); await page.mouse.down(); await page.mouse.move(media.x + media.width / 2, media.y + media.height / 2, { steps: 5 }); await page.mouse.up();
        assert.ok(await page.$(box), 'releasing on media is not a click on the blank area');
        await page.keyboard.press('Escape'); await closed(); assert.deepEqual(await counts(), before);
    });
    assert.deepEqual(errors, []);
});
