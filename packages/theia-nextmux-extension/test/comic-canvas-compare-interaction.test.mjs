import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import ts from 'typescript';
import { loadCanvasToolsSource } from './helpers/canvas-tools-source-loader.mjs';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const desktopRequire = createRequire(join(root, 'apps/desktop/package.json'));
const platformRequire = createRequire(join(root, 'apps/cloudflare-platform/package.json'));
const coreRequire = createRequire(require.resolve('@theia/core/package.json'));
const helper = await loadCanvasToolsSource('browser/nextmux-comic-canvas-compare-interaction.ts');
const copy = await loadCanvasToolsSource('browser/nextmux-comic-canvas-panels-text.ts');
const base = { focused: true, editing: false, hasVideo: false, mode: 'slider', count: 3 };

test('comparison key table applies slider, video and media strip precedence with Shift', () => {
    const action = (key, extra = {}) => helper.canvasCompareKey({ ...base, key, ...extra });
    assert.deepEqual(action('ArrowLeft'), { type: 'split', value: -2 });
    assert.deepEqual(action('ArrowRight', { shiftKey: true }), { type: 'split', value: 10 });
    assert.equal(action('ArrowRight', { mode: 'side' }), undefined);
    assert.deepEqual(action('ArrowLeft', { hasVideo: true }), { type: 'seek', value: -1 });
    assert.deepEqual(action('ArrowRight', { hasVideo: true, shiftKey: true }), { type: 'seek', value: 5 });
    for (const [key, index, expected] of [['ArrowLeft', 0, 0], ['ArrowRight', 2, 2], ['ArrowLeft', 2, 1], ['Home', 2, 0], ['End', 0, 2]]) {
        assert.deepEqual(action(key, { hasVideo: true, stripIndex: index }), { type: 'select', value: expected });
    }
    assert.equal(action('c', { mode: 'side' }), undefined);
    assert.deepEqual(action('C'), { type: 'center' });
    for (const [key, type] of [['v', 'mode'], ['X', 'swap'], ['?', 'help'], ['Escape', 'escape'], ['0', 'reset']]) assert.deepEqual(action(key), { type });
    assert.equal(action(' '), undefined);
    assert.deepEqual(action(' ', { hasVideo: true }), { type: 'play' });
    assert.deepEqual(action('m', { hasVideo: true }), { type: 'mute' });
    for (const guard of [{ focused: false }, { editing: true }, { isComposing: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
        for (const key of ['v', 'Escape', 'Delete', 'ArrowLeft', '?']) assert.equal(action(key, guard), undefined);
    }
});

test('comparison zoom keeps the pointer anchor and seek remains in media bounds', () => {
    assert.deepEqual(helper.zoomCanvasCompare({ scale: 1, x: 0, y: 0 }, 2, { x: 100, y: -50 }), { scale: 2, x: -100, y: 50 });
    assert.equal(helper.zoomCanvasCompare({ scale: 1, x: 0, y: 0 }, 100).scale, 10);
    assert.equal(helper.zoomCanvasCompare({ scale: 1, x: 0, y: 0 }, .001).scale, .1);
    assert.equal(helper.canvasCompareSeek(2, 8, -5), 0);
    assert.equal(helper.canvasCompareSeek(7, 8, 5), 8);
    assert.equal(helper.canvasCompareSeek(NaN, NaN, 1), 1);
});

test('all 12 locales explicitly contain comparison controls and complete keyboard help', async () => {
    const filename = new URL('../src/browser/nextmux-comic-canvas-panels-text.ts', import.meta.url);
    const syntax = ts.createSourceFile('panels-text.ts', await readFile(filename, 'utf8'), ts.ScriptTarget.Latest, true);
    const declarations = new Map(syntax.statements.filter(ts.isVariableStatement).flatMap(s => s.declarationList.declarations).map(d => [d.name.text, d.initializer]));
    const keys = ['comparePause', 'compareUnmute', 'compareMute', 'compareAudioLeft', 'compareAudioRight', 'compareReset', 'compareClearPreview', 'compareHelp', 'compareHelpKeys'];
    assert.equal(declarations.get('TEXT').properties.length, 12);
    for (const property of declarations.get('TEXT').properties) {
        const entries = new Map(declarations.get(property.initializer.text).properties.map(entry => [entry.name.text, entry.initializer.text]));
        for (const key of keys) {
            assert.ok(entries.get(key)?.trim(), `${property.name.text}:${key}`);
            assert.equal(copy.panelText(property.name.text, key), entries.get(key));
        }
        for (const token of ['V', 'C', 'X', 'Shift', 'Home/End', 'M', '?', 'Esc']) assert.ok(entries.get('compareHelpKeys').includes(token));
    }
});

test('real mounted comparison preserves editing/focus and implements view, escape and media controls', { timeout: 90_000 }, async t => {
    // Build only this real React component into an isolated fixture; never emit extension/lib or open the user's desktop.
    const directory = await mkdtemp(join(tmpdir(), 'nextmux-compare-ui-'));
    let browser, server;
    t.after(async () => {
        if (browser) await browser.close();
        if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
        await rm(directory, { recursive: true, force: true });
    });
    const entry = join(directory, 'entry.jsx');
    await writeFile(entry, `
import React from ${JSON.stringify(coreRequire.resolve('react'))};
import {createRoot} from ${JSON.stringify(coreRequire.resolve('react-dom/client'))};
import {CompareWindow} from ${JSON.stringify(fileURLToPath(new URL('../src/browser/nextmux-comic-canvas-panels.tsx', import.meta.url)))};
const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="64"><rect width="96" height="64" fill="red"/></svg>');
window.canvasKeys = []; window.compareClosed = 0; window.removed = []; window.cleared = 0;
function App() {
 const [mode,setMode]=React.useState('image'), [epoch,setEpoch]=React.useState(0), [visible,setVisible]=React.useState(true);
 window.show = kind => {setMode(kind);setEpoch(e=>e+1);setVisible(true)};
 const entries = [0,1,2].map(i=>({id:'v'+i,assetId:'a'+i,kind:mode,uri:mode==='image'?image+'#'+i:'/clip.webm?'+i,createdAt:'2026-10-03T00:00:00Z'}));
 return <div id="canvas-host" onKeyDown={e=>window.canvasKeys.push(e.key)}><button id="outside">Canvas</button><input id="outside-input"/>{visible&&<CompareWindow key={epoch} locale="en" library={entries} mediaUrl={x=>x} onClose={()=>{window.compareClosed++;setVisible(false)}} onRemove={uri=>window.removed.push(uri)} onClear={()=>window.cleared++}/>}</div>
}
createRoot(document.getElementById('root')).render(<App/>);
`);
    await desktopRequire('esbuild').build({ entryPoints: [entry], outfile: join(directory, 'fixture.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'transform',
        alias: { '@theia/core/shared/react': coreRequire.resolve('react') }, define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
    execFileSync(process.execPath, ['--check', join(directory, 'fixture.js')]);
    execFileSync(require('@ffmpeg-installer/ffmpeg').path, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=96x64:r=8:d=9', '-an', '-c:v', 'libvpx-vp9', '-y', join(directory, 'clip.webm')]);
    const css = await readFile(new URL('../src/browser/style/nextmux-comic-canvas.css', import.meta.url), 'utf8');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;--theia-editor-background:#fff;--theia-editor-foreground:#111;--nmx-line:#ccc;--nmx-muted:#777}${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
    server = createServer(async (req, res) => {
        if (req.url === '/') {res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return;}
        const path = req.url?.startsWith('/clip.webm') ? 'clip.webm' : req.url === '/fixture.js' ? 'fixture.js' : undefined;
        if (!path) {res.statusCode = 404; res.end(); return;}
        const bytes = await readFile(join(directory, path));
        res.setHeader('Content-Type', path.endsWith('webm') ? 'video/webm' : 'application/javascript; charset=utf-8');
        const match = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
        if (match) {
            const start = Number(match[1]), end = match[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
            res.statusCode = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${bytes.length}`); res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Content-Length', end - start + 1); res.end(bytes.subarray(start, end + 1));
        } else {res.setHeader('Content-Length', bytes.length); res.end(bytes);}
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const puppeteer = platformRequire('puppeteer');
    browser = await puppeteer.launch({ headless: true, userDataDir: join(directory, 'chromium-profile'), args: ['--autoplay-policy=no-user-gesture-required'] });
    const page = await browser.newPage();
    const devtools = await page.createCDPSession();
    await devtools.send('Runtime.enable');
    devtools.on('Runtime.exceptionThrown', e => t.diagnostic(JSON.stringify(e.exceptionDetails)));
    await page.setViewport({ width: 1400, height: 1000 });
    const errors = []; page.on('pageerror', error => { errors.push(error.message); t.diagnostic(error.stack); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForSelector('[data-compare-stage]', { timeout: 5000 }).catch(error => { throw new Error(errors.join('\n') || error.message); });
    const focus = () => page.focus('[role="dialog"]');
    const split = () => page.$eval('input[type=range]', el => Number(el.value));
    const images = () => page.$$eval('[data-compare-stage] img', els => els.map(el => el.src));
    const key = async name => {
        if (name.startsWith('Shift+')) { await page.keyboard.down('Shift'); try { await page.keyboard.press(name.slice(6)); } finally { await page.keyboard.up('Shift'); } }
        else await page.keyboard.press(name);
    };
    const button = async text => page.evaluate(text => [...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent.trim() === text)?.click(), text);
    await focus(); await key('ArrowRight'); assert.equal(await split(), 52);
    await key('Shift+ArrowLeft'); assert.equal(await split(), 42);
    await key('c'); assert.equal(await split(), 50);
    const beforeSwap = await images(); await key('x'); assert.deepEqual(await images(), beforeSwap.toReversed());
    await key('v'); assert.equal(await page.$eval('[data-compare-stage]', el => el.dataset.compareStage), 'side');
    await key('v'); await key('+'); assert.equal(await page.$eval('[data-compare-stage]', el => Number(el.dataset.compareScale)), 1.2);
    await key('0'); assert.equal(await page.$eval('[data-compare-stage]', el => Number(el.dataset.compareScale)), 1);
    const stageBox = await page.$eval('[data-compare-stage]', el => { const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}; });
    await page.mouse.move(stageBox.x + stageBox.width / 2 + 80, stageBox.y + stageBox.height / 2);
    await page.mouse.wheel({ deltaY: -100 });
    await page.waitForFunction(() => Number(document.querySelector('[data-compare-stage]').dataset.compareScale) > 1);
    const zoomed = await page.$eval('[data-compare-stage] img', el => {const m=new DOMMatrix(getComputedStyle(el).transform);return {scale:m.a,x:m.e,y:m.f};});
    assert.ok(Math.abs(zoomed.x - 80 * (1 - zoomed.scale)) < .1, 'wheel zoom preserves the pointer anchor');
    await page.mouse.down({ button: 'middle' }); await page.mouse.move(stageBox.x + stageBox.width / 2 + 100, stageBox.y + stageBox.height / 2 + 10); await page.mouse.up({ button: 'middle' });
    const panned = await page.$eval('[data-compare-stage] img', el => {const m=new DOMMatrix(getComputedStyle(el).transform);return {x:m.e,y:m.f};});
    assert.ok(Math.abs(panned.x - zoomed.x - 20) < .1); assert.ok(Math.abs(panned.y - zoomed.y - 10) < .1);
    await page.click('[data-compare-stage]', { count: 2 });
    await page.waitForFunction(() => Number(document.querySelector('[data-compare-stage]').dataset.compareScale) === 1, { timeout: 2000 });
    // Dragging out of content must not dismiss the comparison window.
    await page.evaluate(() => {const stage=document.querySelector('[data-compare-stage]');const backdrop=document.querySelector('.nmx-board-modal-backdrop');stage.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));backdrop.dispatchEvent(new MouseEvent('click',{bubbles:true}));});
    assert.equal(await page.evaluate(() => window.compareClosed), 0);

    // A mounted input, textarea and contenteditable descendant get browser-native editing. Their keys never touch the underlying canvas.
    for (const tag of ['input', 'textarea', 'div']) {
        await page.evaluate(tag => { const field=document.createElement(tag);field.id='native-editor';if(tag==='div')field.contentEditable='true';document.querySelector('[role=dialog]').append(field);field.focus(); }, tag);
        const old = await split(); await page.keyboard.type('vcx'); await key('Escape'); await key('Backspace');
        assert.equal(await page.$eval('#native-editor', el => el.value ?? el.textContent), 'vc');
        assert.equal(await split(), old); assert.equal(await page.evaluate(() => window.compareClosed), 0);
        await page.$eval('#native-editor', el => el.remove());
    }
    await page.focus('#outside'); await key('v'); await key('Delete'); await key('Escape');
    assert.equal(await page.$eval('[data-compare-stage]', el => el.dataset.compareStage), 'slider');
    assert.deepEqual(await page.evaluate(() => window.canvasKeys), ['v', 'Delete', 'Escape']);
    await focus(); await key('Delete'); assert.deepEqual(await page.evaluate(() => window.canvasKeys), ['v', 'Delete', 'Escape']);
    // Strip navigation takes precedence over split/seek and keeps the chosen side, including explicit left after choosing right.
    await page.focus('[data-compare-index="0"] [data-compare-side="right"]'); await key('End');
    assert.match((await images())[1], /#2$/); assert.equal(await page.evaluate(() => document.activeElement.dataset.compareIndex), '2');
    await key('Home'); assert.match((await images())[1], /#0$/);
    await page.focus('[data-compare-index="1"] [data-compare-side="left"]'); await key('ArrowRight'); assert.match((await images())[0], /#2$/);
    await focus(); await key('?'); assert.ok(await page.$('[data-compare-help]'));
    await key('Escape'); assert.equal(await page.$('[data-compare-help]'), null); assert.equal((await images()).length, 2);
    await key('Escape'); assert.equal((await images()).length, 0); assert.equal(await page.evaluate(() => window.compareClosed), 0);
    await key('Escape'); assert.equal(await page.$('[role=dialog]'), null); assert.equal(await page.evaluate(() => window.compareClosed), 1);
    assert.deepEqual(await page.evaluate(() => [window.removed, window.cleared]), [[], 0]);
    // Real decoded videos exercise native seek/play/mute without mocks or a user's app/profile.
    await page.evaluate(() => window.show('video')); await page.waitForSelector('[data-compare-stage] video');
    await page.waitForFunction(() => [...document.querySelectorAll('[data-compare-stage] video')].every(v => v.readyState >= 2 && Number.isFinite(v.duration)));
    await focus(); await key('ArrowRight'); await key('Shift+ArrowRight');
    const times = () => page.$$eval('[data-compare-stage] video', els => els.map(el => el.currentTime));
    assert.deepEqual(await times(), [6, 6]); await key('Shift+ArrowLeft'); assert.deepEqual(await times(), [1, 1]);
    await key('m'); assert.deepEqual(await page.$$eval('[data-compare-stage] video', els => els.map(el => el.muted)), [false, true]);
    await button('Listen to right'); assert.deepEqual(await page.$$eval('[data-compare-stage] video', els => els.map(el => el.muted)), [true, false]);
    await focus(); await key('Space'); await page.waitForFunction(() => [...document.querySelectorAll('[data-compare-stage] video')].every(v => !v.paused));
    await key('Space'); assert.deepEqual(await page.$$eval('[data-compare-stage] video', els => els.map(el => el.paused)), [true, true]);
    assert.ok((await times()).every(time => time >= 1), 'play resumes the selected time instead of restarting');
    await page.focus('[data-compare-index="0"]'); const stopped = await times(); await key('End');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.compareIndex), '2');
    assert.equal((await times())[1], stopped[1], 'strip navigation does not seek the other media');
    await focus(); await key('Space'); await page.waitForFunction(() => [...document.querySelectorAll('[data-compare-stage] video')].every(v => !v.paused));
    await page.evaluate(() => {window.previewVideos=[...document.querySelectorAll('[data-compare-stage] video')];});
    await key('Escape'); assert.equal(await page.$$eval('[data-compare-stage] video', els => els.length), 0);
    assert.equal(await page.evaluate(() => window.previewVideos.every(v => v.paused)), true, 'clearing preview stops detached players');
    await key('Escape'); assert.equal(await page.$('[role=dialog]'), null);
    assert.deepEqual(await page.evaluate(() => [window.removed, window.cleared]), [[], 0], 'view actions never mutate the library');
    assert.deepEqual(errors, []);
});
