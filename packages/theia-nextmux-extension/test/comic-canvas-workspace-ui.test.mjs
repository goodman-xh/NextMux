import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url), core = createRequire(require.resolve('@theia/core/package.json'));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const puppeteer = (await import(platform.resolve('puppeteer'))).default;

test('compact canvas workspace preserves guarded editor navigation, recovery and editing controls', { timeout: 45000 }, async t => {
    const { outputFiles } = await desktop('esbuild').build({ stdin: { resolveDir: new URL('../src/browser/', import.meta.url).pathname, loader: 'tsx', contents: `
import React from 'react';import{createRoot}from'react-dom/client';import{ComicDesk}from'./nextmux-comic-desk';
const root=createRoot(document.querySelector('main'));const calls={editor:0,retry:0,pause:0,resume:0,close:0,export:0,steps:[]};
let props={locale:'zh-CN',step:'canvas',projectTitle:'A very long project title '.repeat(12),reachable:new Set(['canvas','edit']),episodes:[],cards:[],stopped:false,shooting:false,paused:false,splitting:false,adapting:false,canShoot:false,toEditorDisabled:true,toEditorLabel:'进入剪辑',canvasNote:'7/8 个镜头已有视频',canvasView:<div data-fixture-canvas style={{height:'100%'}}>Canvas content</div>,editor:<div data-fixture-editor>Editor content</div>,exportLabel:'导出',exportDisabled:false,onExport(){calls.export++;},onStep(s){calls.steps.push(s);},onToEditor(){calls.editor++;},onRetrySplit(){calls.retry++;},onPause(){calls.pause++;},onResume(){calls.resume++;},onMinimize(){calls.close++;}};
function render(){root.render(<ComicDesk {...props}/>)};window.fixture={calls,set(p){props={...props,...p};render()}};render();` }, bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty' }, alias: { react: core.resolve('react'), 'react-dom/client': core.resolve('react-dom/client') } });
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage(), errors = []; page.setDefaultTimeout(5000); page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1200, height: 800 }); await page.setRequestInterception(true);
    page.on('request', r => void r.respond({ status: 200, contentType: 'text/html', body: '<main class="nmx-shell"><div class="nmx-comic-studio"></div></main>' }));
    await page.goto('https://canvas-workspace.fixture/');
    await page.addStyleTag({ content: await readFile(new URL('../src/browser/style/nextmux-comic-desk.css', import.meta.url), 'utf8') });
    await page.addStyleTag({ content: 'html,body{margin:0;height:100%;background:#171717}main{position:relative;width:1100px;height:700px;--nmx-bg:#171717;--nmx-panel:#222;--nmx-panel-2:#333;--nmx-text:#eee;--nmx-muted:#aaa;--nmx-border:#555;--nmx-accent:#a368d8;font:13px system-ui}button{font:inherit}' });
    await page.addScriptTag({ content: outputFiles[0].text }); await page.waitForSelector('.nmx-desk-enter-editor');
    await page.click('.nmx-desk-enter-editor'); assert.equal(await page.evaluate(() => fixture.calls.editor), 0, 'empty or busy canvas cannot enter editing');
    assert.equal(await page.$('.nmx-desk-footer'), null); assert.equal(await page.$('.nmx-desk-steps'), null);
    for (const width of [1100, 600, 400]) {
        await page.$eval('main', (e, w) => e.style.width = w + 'px', width);
        const bounds = await page.evaluate(() => { const stage=document.querySelector('.nmx-desk-stage').getBoundingClientRect(),button=document.querySelector('.nmx-desk-enter-editor').getBoundingClientRect(),host=document.querySelector('main').getBoundingClientRect();return {stageHeight:stage.height,buttonRight:button.right,hostRight:host.right,scroll:document.querySelector('.nmx-desk-header').scrollWidth,headerWidth:document.querySelector('.nmx-desk-header').clientWidth}; });
        assert.ok(bounds.stageHeight >= 650 && bounds.buttonRight <= bounds.hostRight && bounds.scroll <= bounds.headerWidth, JSON.stringify(bounds));
    }
    await page.evaluate(() => fixture.set({toEditorDisabled:false})); await page.waitForFunction(() => !document.querySelector('.nmx-desk-enter-editor').disabled);
    await page.click('.nmx-desk-enter-editor'); assert.equal(await page.evaluate(() => fixture.calls.editor), 1);
    await page.evaluate(() => fixture.set({toEditorDisabled:true,toEditorLabel:'正在准备剪辑…',splitError:'Fixture failure',shooting:true}));
    await page.waitForSelector('.nmx-desk-canvas-status[role="alert"]');
    await page.click('.nmx-desk-enter-editor'); assert.equal(await page.evaluate(() => fixture.calls.editor), 1, 'commit guard remains on the new single entry');
    await page.click('.nmx-desk-canvas-status button'); assert.equal(await page.evaluate(() => fixture.calls.retry), 1);
    await page.$$eval('.nmx-desk-actions button', buttons => buttons.find(b => b.textContent === '暂停').click()); assert.equal(await page.evaluate(() => fixture.calls.pause), 1);
    await page.evaluate(() => fixture.set({paused:true})); await page.waitForFunction(() => document.querySelector('.nmx-desk-actions').textContent.includes('继续'));
    await page.$$eval('.nmx-desk-actions button', buttons => buttons.find(b => b.textContent === '继续').click()); assert.equal(await page.evaluate(() => fixture.calls.resume), 1);
    await page.click('.nmx-desk-close'); assert.equal(await page.evaluate(() => fixture.calls.close), 1);
    await page.evaluate(() => fixture.set({splitError:undefined,splitting:true,shooting:false})); await page.waitForSelector('.nmx-desk-canvas-status[role="status"]');
    await page.evaluate(() => fixture.set({splitting:false})); await page.waitForFunction(() => !document.querySelector('.nmx-desk-canvas-status'));
    await page.$eval('main', e => e.style.width='1100px');
    const evidence = new URL('../../../.nextmux-run/canvas-simplification-review/', import.meta.url); await mkdir(evidence,{recursive:true});
    await page.screenshot({path:new URL('compact-workspace.png',evidence).pathname});
    await page.evaluate(() => fixture.set({step:'edit'})); await page.waitForSelector('[data-fixture-editor]');
    await page.click('.nmx-desk-footer .nmx-primary-button'); assert.equal(await page.evaluate(() => fixture.calls.export), 1);
    await page.click('.nmx-desk-footer button'); assert.deepEqual(await page.evaluate(() => fixture.calls.steps), ['canvas']);
    assert.deepEqual(errors, []);
});
