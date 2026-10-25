import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../src/browser/', import.meta.url));
const require = createRequire(import.meta.url);
const core = createRequire(require.resolve('@theia/core/package.json'));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const puppeteer = (await import(platform.resolve('puppeteer'))).default;

test('the actual multitrack shortcut panel displays Mac and Windows modifiers while retaining their real handlers', { timeout: 120000 }, async t => {
    const { outputFiles } = await desktop('esbuild').build({
        stdin: { loader: 'tsx', resolveDir: src, contents: `
import React from 'react'; import { createRoot } from 'react-dom/client'; import { ComicMultitrack } from './nextmux-comic-multitrack';
window.calls = { undo: 0, redo: 0, export: 0 };
createRoot(document.querySelector('main')).render(<ComicMultitrack
composition={{schemaVersion:1,tracks:[],clips:[]}} assets={[]} mediaAssets={[]} fps={24} projectCanvas={{width:320,height:180}}
locale='en' busy={false} importing={false} canUndo={true} canRedo={true} exportLabel='Export' exportDisabled={false}
onCommit={async()=>true} onInsertAsset={async()=>true} onImportFiles={()=>{}}
actions={{pickFiles(){},undo(){calls.undo++;},redo(){calls.redo++;},exportVideo(){calls.export++;}}} />);
` },
        bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty' },
        alias: { react: core.resolve('react'), 'react-dom/client': core.resolve('react-dom/client') }
    });
    const browser = await puppeteer.launch({ headless: true });
    t.after(() => browser.close());
    for (const [os, modifier, expected] of [
        ['MacIntel', 'Meta', ['⌘D', '⌘Z', '⇧⌘Z', '⌘E']],
        ['Win32', 'Control', ['Ctrl+D', 'Ctrl+Z', 'Ctrl+Shift+Z', 'Ctrl+E']]
    ]) await t.test(os, async () => {
        const page = await browser.newPage();
        try {
            await page.setViewport({ width: 1280, height: 800 });
            await page.setContent('<main></main>');
            await page.evaluate(value => Object.defineProperty(navigator, 'platform', { configurable: true, value }), os);
            await page.addStyleTag({ content: await readFile(new URL('../src/browser/style/nextmux-comic-multitrack.css', import.meta.url), 'utf8') });
            await page.addStyleTag({ content: 'html,body,main{height:100%;margin:0}main{--nmx-bg:#171717;--nmx-text:#eee;--nmx-panel:#222;--nmx-border:#555;font:12px system-ui}' });
            await page.addScriptTag({ content: outputFiles[0].text });
            await page.click('.nmx-mt-toolbar button:has(.codicon-keyboard)');
            await page.waitForSelector('.nmx-mt-shortcuts');
            const keys = await page.$$eval('.nmx-mt-shortcuts kbd', nodes => nodes.map(node => node.textContent));
            assert.deepEqual([keys[6], keys[8], keys[9], keys[12]], expected);
            const text = await page.$eval('.nmx-mt-shortcuts', node => node.textContent);
            if (os === 'Win32') { assert.doesNotMatch(text, /⌘/); assert.match(text, /Ctrl\+wheel/); }
            else assert.match(text, /⌘/);
            await page.click('.nmx-mt-shortcuts > button');
            await page.$eval('.nmx-mt', node => node.focus());
            await page.keyboard.down(modifier);
            await page.keyboard.press('z');
            await page.keyboard.down('Shift'); await page.keyboard.press('z'); await page.keyboard.up('Shift');
            await page.keyboard.press('e'); await page.keyboard.up(modifier);
            assert.deepEqual(await page.evaluate(() => calls), { undo: 1, redo: 1, export: 1 });
        } finally { await page.close(); }
    });
});

test('canvas group menus and mark-editor titles use the same platform shortcut display', { timeout: 120000 }, async t => {
    const { outputFiles } = await desktop('esbuild').build({
        stdin: { loader: 'tsx', resolveDir: src, contents: `
import React from 'react'; import {createRoot} from 'react-dom/client'; import {ComicCanvas} from './nextmux-comic-canvas';
import {MarkEditor} from './nextmux-comic-canvas-marks'; import {createCanvasDocument} from '@nextmux/comic-core/canvas';
import {createCanvasNode} from './nextmux-comic-canvas-logic'; import {groupCanvasNodes} from './nextmux-comic-canvas-groups';
const now='2026-10-05T00:00:00Z'; let canvas={...createCanvasDocument({id:'canvas',projectId:'project',now}),viewport:{x:10,y:10,zoom:1},
nodes:['a','b'].map((id,i)=>({...createCanvasNode('text',{x:80+i*250,y:80},{title:id}),id,size:{width:200,height:160},payload:{text:id}}))};
canvas=groupCanvasNodes(canvas,['a','b'],{title:'Scene',now}).canvas; const root=createRoot(document.querySelector('main'));
const props={locale:'en',saveState:'saved',models:{image:[],video:[]},defaultRoute:()=>undefined,routeOf:()=>undefined,capabilityOf:()=>undefined,jobOf:()=>undefined,
waiting:new Set(),submitting:new Set(),mediaUrl:()=>'',defaults:{aspectRatio:'16:9',durationSeconds:5},onChange:next=>{canvas=next;render();},onUndo(){},onRedo(){},onSetRoute(){},onRun(){},onExtract(){},onImport(){},onUsePortrait(){},onRetrySave(){},onNotice(){},toolProgress:new Map(),onTool:async()=>false,onCancelTool(){},onPickLut:async()=>undefined};
function render(){root.render(<ComicCanvas {...props} canvas={canvas} canUndo={false} canRedo={false}/>);}render();
createRoot(document.querySelector('aside')).render(<MarkEditor locale='en' src='' marks={[]} imageRef={{current:null}} onChange={()=>{}}/>);
` },
        bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty', '.svg': 'dataurl' },
        alias: { react: core.resolve('react'), 'react/jsx-runtime': core.resolve('react/jsx-runtime'), 'react-dom/client': core.resolve('react-dom/client') }
    });
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    for (const [os, modifier, group, duplicate, undo, redo] of [
        ['MacIntel', 'Meta', '⌘G', '⌘D', '⌘Z', '⇧⌘Z'],
        ['Win32', 'Control', 'Ctrl+G', 'Ctrl+D', 'Ctrl+Z', 'Ctrl+Shift+Z']
    ]) await t.test(os, async () => {
        const page = await browser.newPage();
        try {
            await page.setViewport({ width: 1280, height: 850 });
            await page.setContent('<main></main><aside></aside>');
            await page.evaluate(value => Object.defineProperty(navigator, 'platform', { configurable: true, value }), os);
            await page.addStyleTag({ content: await readFile(require.resolve('@xyflow/react/dist/style.css'), 'utf8') });
            await page.addStyleTag({ content: await readFile(new URL('../src/browser/style/nextmux-comic-canvas.css', import.meta.url), 'utf8') });
            await page.addStyleTag({ content: 'main{height:650px;width:1100px}.nmx-board{height:100%;width:100%}aside{height:150px}' });
            await page.addScriptTag({ content: outputFiles[0].text });
            await page.waitForSelector('.nmx-board-group');
            await page.$eval('.nmx-board', node => node.focus());
            await page.keyboard.down(modifier); await page.keyboard.press('a'); await page.keyboard.up(modifier);
            await page.waitForSelector('.nmx-board-selection');
            assert.equal(await page.$eval('.nmx-board-selection button:has(.codicon-folder)', node => node.title), group);
            await page.$eval('.nmx-board-group', node => node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 140, clientY: 140 })));
            await page.waitForSelector('.nmx-board-menu');
            const menu = await page.$eval('.nmx-board-menu', node => node.textContent);
            assert.ok(menu.includes(duplicate));
            assert.ok(menu.includes(os === 'Win32' ? 'Ctrl+Shift+G' : '⇧⌘G'));
            if (os === 'Win32') assert.doesNotMatch(menu, /⌘/);
            assert.equal(await page.$eval('.nmx-board-marks button:has(.codicon-discard)', node => node.title), 'Undo (' + undo + ')');
            assert.equal(await page.$eval('.nmx-board-marks button:has(.codicon-redo)', node => node.title), 'Redo (' + redo + ')');
        } finally { await page.close(); }
    });
});
