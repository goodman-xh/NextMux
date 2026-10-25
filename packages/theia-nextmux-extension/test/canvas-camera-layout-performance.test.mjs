import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const require = createRequire(import.meta.url), core = createRequire(require.resolve('@theia/core/package.json'));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));

test('camera remains node anchored across boundaries without pan redraws and disconnects its size observer', { timeout: 30000 }, async t => {
    const { outputFiles } = await desktop('esbuild').build({ stdin: { loader: 'tsx', resolveDir: new URL('../src/browser/', import.meta.url).pathname, contents: `
import React from 'react';import {createRoot} from 'react-dom/client';
import {CameraControl} from './nextmux-comic-canvas-camera';import {CanvasFloatingForm} from './nextmux-comic-canvas-float';
const root=createRoot(document.querySelector('main'));window.commits=[];let open=true;
function render(){root.render(<div className='nmx-board'><div className='nmx-board-panel-layer'><CanvasFloatingForm locale='en' title='Audit'><div className='nmx-board-panel'><button>Camera</button>{open&&<React.Profiler id='camera' onRender={(_id,phase,duration)=>window.commits.push({phase,duration})}><CameraControl locale='en' onConfirm={()=>{}} onCancel={()=>{}}/></React.Profiler>}</div></CanvasFloatingForm></div></div>);}
window.audit={open(value){open=value;render();}};render();
` }, bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty' }, alias: {
        react: core.resolve('react'), 'react-dom/client': core.resolve('react-dom/client'), '@theia/core/shared/react': core.resolve('react')
    } });
    const puppeteer = (await import(platform.resolve('puppeteer'))).default, browser = await puppeteer.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 1400, height: 1000 }); await page.setContent('<main></main>');
    for (const file of ['nextmux.css', 'nextmux-desktop-production.css', 'nextmux-comic-canvas.css', 'nextmux-comic-canvas-float.css', 'nextmux-comic-canvas-camera.css']) {
        await page.addStyleTag({ content: await readFile(new URL('../src/browser/style/' + file, import.meta.url), 'utf8') });
    }
    await page.addStyleTag({ content: 'html,body{margin:0}.nmx-board{position:relative;width:1400px;height:1000px}.nmx-board-panel-layer{position:absolute;top:500px;left:100px}.nmx-board-panel{width:560px}' });
    // Observe the actual component lifecycle without replacing its implementation or geometry.
    await page.evaluate(() => {
        window.rectReads = {};
        const original = Element.prototype.getBoundingClientRect;
        Element.prototype.getBoundingClientRect = function () {
            const key = this.classList?.contains('nmx-board') ? 'board' : this.classList?.contains('nmx-board-panel') ? 'panel' : 'other';
            window.rectReads[key] = (window.rectReads[key] || 0) + 1; return original.call(this);
        };
        const RO = window.ResizeObserver, MO = window.MutationObserver;
        window.observers = { resize: 0, mutation: 0 };
        window.ResizeObserver = class extends RO {
            constructor(callback) { super(callback); window.observers.resize++; this.auditLive = true; }
            disconnect() { if (this.auditLive) { window.observers.resize--; this.auditLive = false; } return super.disconnect(); }
        };
        window.MutationObserver = class extends MO {
            constructor(callback) { super(callback); window.observers.mutation++; this.auditLive = true; }
            disconnect() { if (this.auditLive) { window.observers.mutation--; this.auditLive = false; } return super.disconnect(); }
        };
    });
    await page.addScriptTag({ content: outputFiles[0].text }); await page.waitForSelector('.nmx-camera-control');
    const metrics = await page.evaluate(async () => {
        const frames = async (count, callback) => {
            for (let i = 0; i < count; i++) { await new Promise(resolve => requestAnimationFrame(resolve)); callback?.(i); }
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        };
        await frames(3);
        const reset = () => { window.commits = []; window.rectReads = {}; };
        const snapshot = () => ({ commits: window.commits.length, renderMs: Number(window.commits.reduce((sum, value) => sum + value.duration, 0).toFixed(3)),
            rectReads: { ...window.rectReads }, maxHeight: document.querySelector('.nmx-camera-control')?.style.maxHeight, observers: { ...window.observers } });
        reset(); await frames(12); const idle = snapshot();
        const layer = document.querySelector('.nmx-board-panel-layer');
        reset(); await frames(60, i => { layer.style.top = (500 + i) + 'px'; }); const capped = snapshot();
        reset(); await frames(20, i => { layer.style.top = (300 - i) + 'px'; }); const limited = snapshot();
        const popup = document.querySelector('.nmx-camera-control').getBoundingClientRect(), board = document.querySelector('.nmx-board').getBoundingClientRect();
        const form = document.querySelector('.nmx-board-panel').getBoundingClientRect();
        const limitedGeometry = { top: popup.top, bottom: popup.bottom, formTop: form.top, boardTop: board.top, height: popup.height };
        reset(); document.querySelector('.nmx-board').style.height = '190px'; await frames(3); const resized = snapshot();
        for (let i = 0; i < 10; i++) { window.audit.open(false); await frames(1); window.audit.open(true); await frames(1); }
        window.audit.open(false); await frames(2);
        return { idle, capped, limited, limitedGeometry, resized, afterClose: window.observers };
    });
    console.log('camera layout metrics', JSON.stringify(metrics));
    assert.equal(metrics.idle.commits, 0);
    assert.equal(metrics.capped.maxHeight, '320px');
    assert.equal(metrics.capped.commits, 0, 'moving through 60 frames of ample space must not redraw unchanged camera content');
    assert.equal(metrics.limited.maxHeight, '320px');
    assert.equal(metrics.limited.commits, 0, 'crossing the top boundary moves only CSS geometry, never camera content');
    assert.deepEqual(metrics.limited.rectReads, {}, 'pan never measures the anchor or canvas');
    assert.ok(metrics.limitedGeometry.top < metrics.limitedGeometry.boardTop, 'the drawer follows its owner beyond the top edge');
    assert.ok(Math.abs(metrics.limitedGeometry.bottom - metrics.limitedGeometry.formTop + 8) <= 1);
    assert.equal(metrics.resized.maxHeight, '174px', 'resizing the whole canvas updates the usable height');
    assert.ok(metrics.resized.commits > 0);
    assert.equal(metrics.limitedGeometry.height, 320);
    assert.deepEqual(metrics.afterClose, { resize: 0, mutation: 0 });
    assert.deepEqual(errors, []);
});
