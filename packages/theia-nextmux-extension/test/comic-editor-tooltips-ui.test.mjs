import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const pkg = fileURLToPath(new URL('../', import.meta.url)), src = join(pkg, 'src/browser');
const require = createRequire(join(pkg, 'package.json'));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const core = createRequire(require.resolve('@theia/core/package.json'));
const puppeteer = (await import(platform.resolve('puppeteer'))).default;

test('editor buttons expose stable, bounded hover help across playback, disabled controls, nested targets and native dialogs', { timeout: 120_000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'nextmux-editor-tooltips-'));
    let browser, server;
    t.after(async () => {
        if (browser) await browser.close();
        if (server) await new Promise(resolve => server.close(resolve));
        await rm(directory, { recursive: true, force: true });
    });
    const video = join(directory, 'blue.mp4'), ffmpeg = require('@ffmpeg-installer/ffmpeg').path;
    const encoded = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
        'color=c=blue:s=320x180:r=24:d=12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video], { timeout: 15_000 });
    assert.equal(encoded.status, 0, encoded.stderr?.toString());
    const videoBytes = await readFile(video);
    const { outputFiles } = await desktop('esbuild').build({ stdin: { loader: 'tsx', resolveDir: src, contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {ComicMultitrack} from './nextmux-comic-multitrack';
import {SurfaceTooltips} from './nextmux-surface-tooltips';
const scope='.nmx-mt, .nmx-multitrack-transcription, .nmx-comic-export-sheet, .nmx-comic-setup';
let composition={schemaVersion:1,tracks:[{id:'picture',kind:'video',title:'Picture'},{id:'sound',kind:'audio',title:'Sound'},{id:'text',kind:'text',title:'Text'}],clips:[
 {id:'video',trackId:'picture',kind:'video',title:'Blue video',assetId:'blue',from:0,durationFrames:288,sourceStartFrames:0,nativeAudio:false,keyframes:[{property:'x',frame:0,value:0,easing:'linear'},{property:'x',frame:24,value:20,easing:'linear'}]},
 {id:'caption',trackId:'text',kind:'text',title:'Source captions',purpose:'subtitle',assetId:'srt',from:0,durationFrames:240,sourceStartFrames:0,textStyle:{fontSize:18}},
 {id:'title',trackId:'text',kind:'text',title:'Title',purpose:'title',text:'Title',from:240,durationFrames:48,sourceStartFrames:0,textStyle:{fontSize:20}}]};
const assets=[{id:'blue',kind:'video',title:'Blue video',url:'/blue.mp4',durationMs:12000,source:'imported',used:true},
 {id:'red',kind:'image',title:'Red picture',url:'/red.svg',source:'imported',used:false}];
let controller,locale='en',busy=false,groupOpen=true,subtitles=true,recognition=false,latest,renderCount=0;
const root=createRoot(document.querySelector('main'));
function render(){renderCount++;root.render(<><SurfaceTooltips scope={scope}/><section className='nmx-multitrack-transcription'>
 <button type='button' aria-label='Choose transcription model'>Model</button><button type='button' disabled>Recognize subtitles</button>
 <button type='button' aria-label='Close transcription settings'>×</button></section>
 <ComicMultitrack composition={composition} assets={assets} mediaAssets={assets} groups={[{key:'source',title:'Project media',open:groupOpen,onToggle(){groupOpen=!groupOpen;render();},assets,loading:false,empty:'No media'}]}
 fps={24} projectCanvas={{width:320,height:180}} locale={locale} busy={busy} importing={false} canUndo={false} canRedo={true} exportLabel='Export' exportDisabled={false}
 onBack={()=>{}} backLabel='Back to canvas' onClose={()=>{}} closeLabel='Minimize editor' onCommit={async next=>{composition=next;render();return true;}}
 onInsertAsset={()=>true} onImportFiles={()=>{}} actions={{pickFiles(){},undo(){},redo(){},exportVideo(){}}}
 player={{onController:value=>{controller=value;},onStateChange:value=>{latest=value;},subtitlesVisible:subtitles,onToggleSubtitles(){subtitles=!subtitles;render();},
 onRecognize(){recognition=!recognition;render();},...(recognition?{recognition:{completed:0,total:1}}:{}),subtitleCues:{srt:[{startFrame:0,durationFrames:240,text:'Caption'}]}}}/></>);}
window.qa={get state(){return controller.state();},get renders(){return renderCount;},rerender:render,pause(){controller.pause();},seek(seconds){controller.seek(seconds,true);},
 busy(value){busy=value;render();},locale(value){locale=value;document.querySelector('main').lang=value;document.querySelector('main').dir=value==='ar'?'rtl':'ltr';render();}};
render();
` }, bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty' },
        alias: { react: core.resolve('react'), 'react-dom/client': core.resolve('react-dom/client') } });
    server = createServer((request, response) => {
        const body = request.url === '/blue.mp4' ? videoBytes : request.url === '/red.svg'
            ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="red"/></svg>')
            : Buffer.from('<div class="nmx-shell"><main lang="en" dir="ltr"></main></div>');
        const type = request.url === '/blue.mp4' ? 'video/mp4' : request.url === '/red.svg' ? 'image/svg+xml' : 'text/html';
        const range = /bytes=(\d+)-(\d*)/.exec(request.headers.range || '');
        if (range) {
            const start = Number(range[1]), end = range[2] ? Math.min(body.length - 1, Number(range[2])) : body.length - 1;
            response.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' });
            response.end(body.subarray(start, end + 1));
        } else { response.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Accept-Ranges': 'bytes' }); response.end(body); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await puppeteer.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
    const page = await browser.newPage(), errors = [], observations = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(5_000);
    await page.setViewport({ width: 1400, height: 1100 });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.addStyleTag({ content: await readFile(join(src, 'style/nextmux-comic-multitrack.css'), 'utf8') });
    await page.addStyleTag({ content: 'html,body,main,.nmx-shell{height:100%;margin:0;box-sizing:border-box}main{display:flex;flex-direction:column;--nmx-bg:#171717;--nmx-panel:#222;--nmx-panel-2:#333;--nmx-text:#eee;--nmx-muted:#aaa;--nmx-border:#555;--nmx-accent:#ad91ec;font:12px system-ui}.nmx-mt{flex:1;min-height:0}.nmx-multitrack-transcription{height:28px;flex:none}.nmx-multitrack-transcription button{height:25px}.qa-modal{padding:24px;min-width:280px;border:0}.qa-modal button{height:30px}.qa-model{position:fixed;left:0;bottom:0;z-index:3000}' });
    await page.addScriptTag({ content: outputFiles[0].text });
    await page.waitForFunction(() => document.querySelector('.nmx-mt-layer video')?.readyState >= 2);

    const rect = async selector => page.$eval(selector, element => {
        const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    const hide = async () => {
        await page.mouse.move(1399, 1);
        await page.waitForFunction(() => !document.querySelector('.nmx-surface-tooltip'));
    };
    const hover = async (selector, label = selector) => {
        await hide();
        await page.$eval(selector, element => element.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
        const before = await rect(selector);
        await page.hover(selector);
        await page.waitForSelector('.nmx-surface-tooltip', { visible: true });
        const info = await page.$eval('.nmx-surface-tooltip', element => {
            const r = element.getBoundingClientRect(), style = getComputedStyle(element);
            return { text: element.textContent.trim(), count: document.querySelectorAll('.nmx-surface-tooltip').length,
                visible: style.visibility, x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: innerWidth, height: innerHeight,
                lang: element.lang, direction: style.direction, modal: Boolean(element.closest('dialog:modal')) };
        });
        assert.equal(info.count, 1, `${label}: only one tooltip`);
        assert.match(info.text, /[\p{L}\p{N}]/u, `${label}: readable help, not a bare icon`);
        assert.ok(!/^\d+%$/u.test(info.text), `${label}: progress must retain its action description`);
        assert.equal(info.visible, 'visible', label);
        assert.ok(info.x >= 7 && info.y >= 7 && info.right <= info.width - 7 && info.bottom <= info.height - 7, `${label}: tooltip stays in viewport ${JSON.stringify(info)}`);
        const after = await rect(selector);
        for (const key of Object.keys(before)) assert.ok(Math.abs(before[key] - after[key]) < .15, `${label}: hover must not stretch or move its button (${key})`);
        assert.equal(await page.$eval(selector, element => (element.getAttribute('aria-describedby') || '').split(/\s+/).some(id => document.getElementById(id)?.getAttribute('role') === 'tooltip')), true, `${label}: accessible tooltip relation`);
        observations.push({ label, text: info.text, disabled: await page.$eval(selector, element => element.matches(':disabled')) });
        return info;
    };
    const sweep = async (scope, label) => {
        const ids = await page.$$eval(`${scope} button, ${scope} [role="button"]`, (elements, prefix) => elements.filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden').map((element, index) => {
            const id = `${prefix}-${index}`; element.dataset.qaTooltip = id; return id;
        }), label);
        for (const id of ids) await hover(`[data-qa-tooltip="${id}"]`, id);
        return ids.length;
    };

    // Unselected editor includes disabled undo/edit controls, all bin items and all track actions.
    const initialCount = await sweep('.nmx-mt', 'editor');
    await sweep('.nmx-multitrack-transcription', 'transcription');
    assert.ok(initialCount >= 35, `expected the real editor control surface, got ${initialCount}`);
    assert.ok(observations.some(item => item.disabled), 'disabled controls are actually hovered');
    await hover('select[aria-label="Add track"]', 'add-track-select');
    await hover('.nmx-mt-transport select', 'playback-speed-select');
    await page.evaluate(() => qa.busy(true));
    await page.waitForFunction(() => document.querySelector('select[aria-label="Add track"]').disabled);
    await hover('select[aria-label="Add track"]', 'disabled-add-track-select');
    await page.evaluate(() => qa.busy(false));

    // A child action must supersede the parent tooltip without first leaving the asset card.
    await hover('.nmx-mt-asset', 'asset-parent');
    await page.hover('.nmx-mt-asset .nmx-mt-asset-add');
    await page.waitForFunction(() => document.querySelector('.nmx-surface-tooltip')?.textContent.trim() === document.querySelector('.nmx-mt-asset-add')?.getAttribute('aria-label'));
    assert.equal(await page.$eval('.nmx-mt-asset-add', element => (element.getAttribute('aria-describedby') || '').includes(document.querySelector('.nmx-surface-tooltip').id)), true);

    // Select a real video to expose detach audio, property keys, keyframe navigation/deletion, and timeline diamonds.
    await page.click('.nmx-mt-clip[data-clip-id="video"]');
    await page.waitForSelector('.nmx-mt-inspector');
    await sweep('.nmx-mt-inspector', 'video-inspector');
    const selects = await page.$$eval('.nmx-mt-inspector select', elements => elements.filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden').map((element, index) => {
        element.dataset.qaSelect = String(index); return element.getAttribute('aria-label');
    }));
    assert.ok(selects.includes('Framing') && selects.filter(label => label === 'Keyframes').length >= 2,
        `inspector dropdowns must explain fit, keyframe property and easing: ${JSON.stringify(selects)}`);
    for (let i = 0; i < selects.length; i++) await hover(`[data-qa-select="${i}"]`, `inspector-select-${i}`);
    const diamonds = await page.$$('.nmx-mt-key-diamond');
    assert.equal(diamonds.length, 2);
    for (let i = 0; i < diamonds.length; i++) await hover(`.nmx-mt-key-diamond:nth-of-type(${i + 1})`, `timeline-key-${i}`);
    await page.click('.nmx-mt-clip[data-clip-id="caption"]');
    await page.waitForSelector('.nmx-mt-inspector button[aria-label="Edit captions"]');
    await sweep('.nmx-mt-inspector', 'caption-inspector');
    await page.click('.nmx-mt-toolbar [aria-label="Keyboard shortcuts"]');
    await page.waitForSelector('.nmx-mt-shortcuts');
    await hover('.nmx-mt-shortcuts > button', 'shortcuts-close');
    await page.click('.nmx-mt-shortcuts > button');

    // Playback repeatedly renders frame-dependent controls while the hovered DOM button remains stable.
    await page.evaluate(() => qa.seek(0));
    await page.click('.nmx-mt-play');
    await page.waitForFunction(() => qa.state.playing && qa.state.seconds > .1);
    await hover('.nmx-mt-toolbar button[disabled]', 'playing-disabled-control');
    const began = await page.evaluate(() => { window.qaHeldTip = document.querySelector('.nmx-surface-tooltip'); return qa.state.seconds; });
    await page.waitForFunction(time => qa.state.seconds > time + .7, {}, began);
    assert.equal(await page.evaluate(() => qaHeldTip === document.querySelector('.nmx-surface-tooltip') && qaHeldTip.isConnected), true, 'playback refresh must not recreate/hide the tooltip');
    await page.evaluate(() => { for (let i = 0; i < 8; i++) qa.rerender(); });
    assert.equal(await page.evaluate(() => qaHeldTip === document.querySelector('.nmx-surface-tooltip')), true, 'equivalent parent renders retain tooltip');
    const playingTip = await hover('.nmx-mt-play', 'playing-pause-action');
    assert.match(playingTip.text, /Pause/i);
    await page.evaluate(() => qa.pause());
    await page.waitForFunction(() => /^Play$/i.test(document.querySelector('.nmx-surface-tooltip')?.textContent.trim() || ''));

    // The actual preview close button lives in the browser top layer, not in a body-only overlay.
    await page.click('[aria-label="Expand preview"]');
    await page.waitForSelector('dialog:modal');
    const closeTip = await hover('.nmx-mt-preview-close', 'preview-modal-close');
    assert.equal(closeTip.modal, true, 'preview tooltip shares its native dialog top layer');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog:modal') && !document.querySelector('.nmx-surface-tooltip'));

    // Export uses CanvasModalLayer's stopPropagation pattern. Captured clearing must still win.
    await page.evaluate(() => {
        const dialog = document.createElement('dialog'); dialog.className = 'qa-modal';
        dialog.innerHTML = '<section class="nmx-comic-export-sheet"><button id="qa-export" title="Export the edited timeline">Start export</button><button id="qa-export-disabled" disabled aria-label="Cancel export">×</button></section>';
        dialog.addEventListener('pointerdown', event => event.stopPropagation());
        dialog.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Escape') event.preventDefault(); });
        dialog.addEventListener('cancel', event => event.preventDefault()); document.body.append(dialog); dialog.showModal();
    });
    assert.equal((await hover('#qa-export-disabled', 'export-disabled')).modal, true);
    await hover('#qa-export', 'export-modal');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.nmx-surface-tooltip'));
    await hover('#qa-export', 'export-pointer-clear');
    const exportPoint = await rect('#qa-export');
    await page.mouse.move(exportPoint.x + exportPoint.width / 2, exportPoint.y + exportPoint.height / 2);
    await page.mouse.down();
    await page.waitForFunction(() => !document.querySelector('.nmx-surface-tooltip'));
    await page.mouse.up();
    await page.evaluate(() => { const dialog = document.querySelector('dialog.qa-modal'); dialog.close(); dialog.remove(); });

    // Model setup is a body portal. Its switch has aria-labelledby, but no title, label or textContent.
    await page.evaluate(() => {
        const panel = document.createElement('section'); panel.className = 'nmx-comic-setup qa-model'; panel.lang = 'ar'; panel.dir = 'rtl';
        panel.innerHTML = '<span id="qa-model-label">اختيار النموذج تلقائيًا</span><button id="qa-model-switch" role="switch" aria-checked="false" aria-labelledby="qa-model-label"><span aria-hidden="true"></span></button>';
        panel.querySelector('button').style.cssText = 'width:40px;height:28px'; document.body.append(panel);
    });
    const rtl = await hover('#qa-model-switch', 'model-labelledby-switch');
    assert.equal(rtl.text, 'اختيار النموذج تلقائيًا');
    assert.equal(rtl.direction, 'rtl'); assert.equal(rtl.lang, 'ar');
    await page.$eval('#qa-model-label', element => { element.textContent = 'تغيير النموذج التلقائي'; });
    await page.waitForFunction(() => document.querySelector('.nmx-surface-tooltip')?.textContent === 'تغيير النموذج التلقائي');
    await page.$eval('#qa-model-switch', element => element.setAttribute('data-help', 'تعطيل اختيار النموذج تلقائيًا'));
    await page.waitForFunction(() => document.querySelector('.nmx-surface-tooltip')?.textContent === 'تعطيل اختيار النموذج تلقائيًا');
    assert.equal(await page.$eval('.nmx-surface-tooltip', element => getComputedStyle(element).visibility), 'visible');
    await page.evaluate(() => document.querySelector('.qa-model').remove());
    await page.waitForFunction(() => !document.querySelector('.nmx-surface-tooltip'));

    // Focus, timeline scrolling and narrow RTL placement use the same real delegated helper.
    await hide(); await page.focus('.nmx-mt-toolbar [aria-label="Redo"]');
    await page.waitForSelector('.nmx-surface-tooltip', { visible: true });
    assert.match(await page.$eval('.nmx-surface-tooltip', element => element.textContent), /Redo/i);
    await page.$eval('.nmx-mt-timeline', element => { element.scrollLeft += 25; element.dispatchEvent(new Event('scroll')); });
    await page.waitForFunction(() => !document.querySelector('.nmx-surface-tooltip'));
    await page.evaluate(() => { document.activeElement?.blur(); qa.locale('ar'); });
    await page.setViewport({ width: 640, height: 700 });
    const localized = await hover('.nmx-mt-toolbar button', 'rtl-editor');
    assert.equal(localized.direction, 'rtl'); assert.equal(localized.lang, 'ar');
    assert.deepEqual(errors, []);
    t.diagnostic(`${observations.length} actual button/rolebutton/select hover checks; ${observations.filter(item => item.disabled).length} disabled checks; ${initialCount} initial editor controls. Verified nested asset/key actions, caption/video inspectors, track/speed/fit/property/easing dropdowns, keyboard help, live playback, native preview/export, captured dismissal, aria-labelledby, dynamic Arabic help, focus, scroll and viewport bounds.`);
});
