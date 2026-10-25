import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const core = createRequire(desktop.resolve('@theia/core/package.json'));
const platform = createRequire(new URL('../../../apps/cloudflare-platform/package.json', import.meta.url));
const puppeteer = (await import(platform.resolve('puppeteer'))).default;
const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'NextMuxDesktopWidget');
assert.ok(widget);
const names = [
    'clampPaneSize', 'readPaneSize', 'persistPaneSize', 'paneShellWidth', 'paneWorkspaceWidth',
    'paneWorkspaceHeight', 'paneWorkspaceVerticalInset', 'contextPanelMaximumWidth',
    'workContextMaximumWidth', 'workContextInlineMaximumWidth', 'workContextIsOverlay',
    'effectiveWorkContextWidth', 'setWorkContextExpanded', 'terminalAvailableWidth',
    'terminalListMaximumWidth', 'terminalListMinimumWidth', 'terminalSurfaceMinimumWidth',
    'effectiveTerminalListWidth', 'contextFileListMaximumWidth', 'terminalMaximumHeight',
    'syncPaneCssVariables', 'setPaneCssVariable', 'constrainPaneSizes', 'paneResizeSignature', 'schedulePaneResizeUpdate', 'beginPaneDrag',
    'handlePaneResizeKey', 'beginWorkContextResize', 'renderWorkContextTitlebar', 'renderTitlebarPrimaryNavigation',
    'renderWorkContext', 'renderContextDrawerFileList', 'noteBrowserDrawerDismissed'
];
const methods = names.map(name => {
    const method = widget.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(parsed) === name);
    assert.ok(method, name);
    return method.getText(parsed);
});
const constants = widget.members.filter(node => ts.isPropertyDeclaration(node)
    && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.StaticKeyword)
    && /(?:WIDTH|HEIGHT|SIZE)$/.test(node.name.getText(parsed))).map(node => node.getText(parsed));

// Real production renderer, pane sizing, persistence and pointer capture. Only
// host services and content leaves are synthetic: no user profile or RPC runs.
const fixtureEntry = `import * as React from 'react';
import {createRoot} from 'react-dom/client';
import {workbenchText} from './packages/theia-nextmux-extension/src/browser/nextmux-workbench-locale';
import {agentChildText} from './packages/theia-nextmux-extension/src/browser/nextmux-agent-child-locale';
import {contextFileText} from './packages/theia-nextmux-extension/src/browser/nextmux-context-file-menu';
const browserConversationKey=id=>'session:'+id;
const localizeDesktopSurface=(_locale,text)=>text;
const params=new URL(location.href).searchParams;
document.body.classList.toggle('windows',params.has('windows'));
class NextMuxDesktopWidget {
 ${constants.join('\n')}
 node=document.querySelector('#fixture'); desktopLocale='en'; activeSection='coding';
 workContextOpen=true; workContextClosing=false; workContextMode=params.get('mode')||'browser';
 contextPanelCollapsed=params.has('collapsed'); contextPanelWidth=276; preferredContextPanelWidth=276;
 workContextWidth=358; preferredWorkContextWidth=358; contextFileMaximized=false;
 contextFileListWidth=180; preferredContextFileListWidth=180; terminalListWidth=160; preferredTerminalListWidth=160;
 terminalDrawerHeight=190; preferredTerminalDrawerHeight=190; contextFileTabs=new Map(); contextFileDrafts={};
 contextFileSavingUris=new Set(); contextFileChildren=new Map([['/fixture',[]]]); contextFilesWorkspace='/fixture';
 contextFileHistoryOpen=false; activeCodingSessionId='fixture'; activeBrowserId='fixture-browser';
 mountedBrowserIds=new Set(); codingSessions=[]; projectBrowsers=new Map([['/fixture',[{id:'fixture-browser',title:'Local fixture',url:'about:blank'}]]]);
 persistedStates=0; persistActiveCodingSessionState(){this.persistedStates++;}
 paneResizeUpdateFrame=0; paneResizeAppliedSignature=''; isDisposed=false; repositionModelEffortPicker(){}
 tx(key){return {mainNavigation:'主导航',modelCenter:'模型中心',coding:'编程',comic:'漫剧'}[key];} selectSection(){}
 activeCodingSession(){return {id:'fixture',workspacePath:'/fixture'};} codingSessionWorkspaceRoot(){return '/fixture';}
 browserWorkspacePath(){return '/fixture';} currentCodingBrowsers(){return this.projectBrowsers.get('/fixture');}
 currentAgentChildren(){return [];} refreshActiveTerminalLayout(){}
 showBrowserWorkContext(){this.workContextMode='browser';this.workContextOpen=true;this.update();}
 showFileWorkContext(){this.workContextMode='file';this.workContextOpen=true;this.update();}
 showAgentWorkContext(){this.workContextMode='agent';this.workContextOpen=true;this.update();}
 renderAgentChildPanel(){return <section id='nmx-context-panel-agents' role='tabpanel' className='fixture-leaf'>Synthetic child agent</section>;}
 renderContextDrawerFileRows(){return <div className='fixture-leaf'>Synthetic file list</div>;}
 renderContextFileMenu(){return null;}
 renderCodingBrowserView(browser,visible){return <iframe key={browser.id} className='fixture-browser' title='Local iframe' aria-hidden={!visible} srcDoc='<body>Local browser fixture</body>' style={{display:visible?'block':'none',flex:1,width:'100%',border:0}}/>;}
 ${methods.join('\n')}
}
const widget=new NextMuxDesktopWidget();
widget.preferredWorkContextWidth=widget.readPaneSize('nextmux.desktop.pane.workContextWidth.v1',358,NextMuxDesktopWidget.WORK_CONTEXT_MIN_WIDTH,NextMuxDesktopWidget.WORK_CONTEXT_MAX_WIDTH);
function Fixture(){const [,update]=React.useReducer(value=>value+1,0);widget.update=update;
 React.useLayoutEffect(()=>{widget.constrainPaneSizes();widget.syncPaneCssVariables();widget.update();const resize=()=>widget.schedulePaneResizeUpdate();window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[]);
 return <main className={'nmx-shell nmx-theme-'+(params.get('theme')||'dark')+(widget.workContextOpen?' is-work-context-open':'')+(widget.contextPanelCollapsed?' is-context-collapsed':'')}>
 {widget.renderTitlebarPrimaryNavigation()}
 {!widget.contextPanelCollapsed&&<aside className='nmx-context-panel'>Projects fixture</aside>}
 <section className='nmx-workspace'><article className='fixture-conversation'>Readable conversation</article></section>
 {widget.workContextOpen&&widget.renderWorkContextTitlebar()}{widget.renderWorkContext()}
 </main>;
}
window.fixture={widget};createRoot(document.querySelector('#fixture')).render(<Fixture/>);`;

async function fixture(t) {
    const bundle = await desktop('esbuild').build({ stdin: { contents: fixtureEntry, resolveDir: root, sourcefile: 'resize-fixture.tsx', loader: 'tsx' },
        bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'silent',
        alias: { react: core.resolve('react'), 'react-dom/client': core.resolve('react-dom/client') } });
    const styles = await Promise.all(['nextmux.css', 'nextmux-desktop-production.css'].map(name => readFile(new URL(`../src/browser/style/${name}`, import.meta.url))));
    const html = `<!doctype html><html><head><meta charset='utf-8'><link rel='stylesheet' href='/style.css'><link rel='stylesheet' href='/production.css'>
<style>html,body{margin:0;height:100%;font:14px system-ui}#fixture,.nmx-desktop-widget{height:100vh}.fixture-leaf,.fixture-conversation{padding:18px}.fixture-browser{min-height:0}</style>
</head><body><div class='nmx-desktop-widget'><div id='fixture'></div></div><script src='/fixture.js'></script></body></html>`;
    const assets = { '/fixture.js': ['text/javascript', bundle.outputFiles[0].contents], '/style.css': ['text/css', styles[0]], '/production.css': ['text/css', styles[1]] };
    const server = createServer((request, response) => {
        const asset = assets[new URL(request.url, 'http://127.0.0.1').pathname] || ['text/html', html];
        response.writeHead(200, { 'content-type': asset[0] }); response.end(asset[1]);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
    const page = await browser.newPage(); page.setDefaultTimeout(5000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    t.after(() => assert.deepEqual(errors, []));
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.setViewport({ width: 1200, height: 700 });
    return { page, url: `http://127.0.0.1:${server.address().port}/` };
}

const separator = '.nmx-work-context-resize';
async function state(page) {
    return page.evaluate(() => {
        const widget = window.fixture.widget;
        const rect = document.querySelector('.nmx-work-context').getBoundingClientRect();
        const workspace = document.querySelector('.nmx-workspace').getBoundingClientRect();
        const divider = document.querySelector('.nmx-work-context-resize');
        const grip = divider.getBoundingClientRect();
        return { width: rect.width, left: rect.left, right: rect.right, workspaceWidth: workspace.width,
            preferred: widget.preferredWorkContextWidth, requested: widget.workContextWidth,
            overlay: widget.workContextIsOverlay(), maximum: widget.workContextMaximumWidth(), inlineMaximum: widget.workContextInlineMaximumWidth(),
            aria: Number(divider.getAttribute('aria-valuenow')), stored: localStorage.getItem('nextmux.desktop.pane.workContextWidth.v1'),
            hit: document.elementFromPoint(Math.max(0, grip.left + grip.width / 2), grip.top + 80) === divider,
            resizing: document.documentElement.classList.contains('nmx-pane-resizing-x') };
    });
}
async function grip(page) { const rect = await page.$eval(separator, el => { const box = el.getBoundingClientRect(); return {x:box.left + box.width / 2,y:box.top + 80}; }); return rect; }
async function settle(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function open(page, url, query = '') { await page.goto(url + query); await page.waitForSelector(separator); await settle(page); }
function closeTo(actual, expected, message) { assert.ok(Math.abs(actual - expected) < 1.1, `${message}: expected ${expected}, actual ${actual}`); }

test('all three production drawer modes resize continuously without a pointer-down jump and share the saved width', { timeout: 30000 }, async t => {
    const { page, url } = await fixture(t);
    await open(page, url, '?mode=browser');
    for (const [index, mode] of ['browser', 'files', 'agents'].entries()) {
        await page.click(`#nmx-context-tab-${mode}`); await settle(page);
        const before = await state(page), start = await grip(page);
        closeTo(before.width, 358 + index * 40, `${mode} retains shared width`);
        await page.mouse.move(start.x, start.y); await page.mouse.down(); await settle(page);
        closeTo((await state(page)).width, before.width, `${mode} pointer-down`);
        for (const delta of [10, 20, 30, 40]) {
            await page.mouse.move(start.x - delta, start.y); await settle(page);
            const resized = await state(page);
            closeTo(resized.width, before.width + delta, `${mode} small movement ${delta}`);
            assert.equal(resized.overlay, false); assert.ok(resized.workspaceWidth >= 400);
            closeTo(resized.aria, resized.width, 'accessible actual width');
        }
        await page.mouse.up(); await settle(page);
        assert.equal((await state(page)).stored, String(before.width + 40));
    }
    await page.reload(); await page.waitForSelector(separator); await settle(page);
    closeTo((await state(page)).width, 478, 'reload restores persisted preference');
});

test('crossing the readable conversation limit covers the work area and can be restored by drag, keyboard or close', { timeout: 30000 }, async t => {
    const { page, url } = await fixture(t);
    await open(page, url, '?mode=browser&theme=light');
    const first = await state(page), start = await grip(page);
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(start.x - (first.inlineMaximum - first.width), start.y); await settle(page);
    const boundary = await state(page);
    assert.equal(boundary.overlay, false, 'the exact readable-width boundary remains inline');
    assert.ok(boundary.workspaceWidth >= 400, 'the conversation remains readable at its boundary');
    await page.mouse.move(start.x - (first.inlineMaximum + 1 - first.width), start.y); await settle(page); await page.mouse.up();
    let expanded = await state(page);
    assert.equal(expanded.overlay, true); closeTo(expanded.width, expanded.maximum, 'overlay fills work area');
    closeTo(expanded.left, 276, 'project sidebar remains accessible'); assert.equal(expanded.hit, true);
    const expandedGrip = await grip(page);
    await page.mouse.move(expandedGrip.x, expandedGrip.y); await page.mouse.down(); await settle(page);
    closeTo((await state(page)).width, expanded.width, 'expanded pointer-down does not jump');
    await page.mouse.move(expandedGrip.x + expanded.width - 460, expandedGrip.y); await settle(page); await page.mouse.up();
    closeTo((await state(page)).width, 460, 'dragging back returns to inline width');
    assert.equal((await state(page)).overlay, false);
    await page.focus(separator); await page.keyboard.press('End'); await settle(page);
    expanded = await state(page); assert.equal(expanded.overlay, true); closeTo(expanded.width, expanded.maximum, 'End expands');
    await page.keyboard.press('ArrowRight'); await settle(page);
    const reduced = await state(page); assert.equal(reduced.overlay, false); closeTo(reduced.width, reduced.inlineMaximum - 16, 'one arrow restores inline width');
    await page.keyboard.press('End'); await settle(page);
    assert.equal(await page.$eval('.nmx-titlebar-context-close', el => { const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2) === el || el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); }), true);
    await page.click('.nmx-titlebar-context-close'); await settle(page);
    assert.equal(await page.evaluate(() => window.fixture.widget.workContextOpen), false);
    assert.equal(await page.$eval('.nmx-work-context', el => el.getAttribute('aria-hidden')), 'true', 'retained browser is hidden when closing');
});

test('narrow windows temporarily cover the conversation without losing the preferred width; collapsed sidebar overlay fills the window', { timeout: 30000 }, async t => {
    const { page, url } = await fixture(t);
    await open(page, url, '?mode=agent');
    const start = await grip(page);
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x - 72, start.y); await settle(page); await page.mouse.up();
    closeTo((await state(page)).width, 430, 'preference selected');
    await page.setViewport({width:1000,height:700}); await settle(page);
    const mid = await state(page); assert.equal(mid.overlay,true); closeTo(mid.width,724,'viewport-only change updates overlay despite unchanged pane preferences');
    await page.setViewport({width:830,height:700}); await settle(page);
    const narrow = await state(page); assert.equal(narrow.overlay,true); closeTo(narrow.width,narrow.maximum,'narrow window overlay'); assert.equal(narrow.preferred,430);
    await page.setViewport({width:700,height:700}); await settle(page);
    assert.equal(await page.evaluate(() => window.fixture.widget.contextPanelCollapsed), true, 'left sidebar auto-collapses when window narrows below threshold');
    await page.setViewport({width:1200,height:700}); await settle(page);
    assert.equal(await page.evaluate(() => window.fixture.widget.contextPanelCollapsed), false, 'left sidebar auto-expands when window widens back');
    closeTo((await state(page)).width,430,'wide window restores preference'); assert.equal((await state(page)).overlay,false);
    await open(page,url,'?mode=file&collapsed');
    await page.focus(separator); await page.keyboard.press('End'); await settle(page);
    const collapsed=await state(page); assert.equal(collapsed.overlay,true); closeTo(collapsed.width,1200,'collapsed-sidebar overlay has no old 400 px CSS cap');
    closeTo(collapsed.left,0,'collapsed overlay starts at window edge'); assert.equal(collapsed.hit,true);
    await page.keyboard.press('Home'); await settle(page); closeTo((await state(page)).width,280,'Home restores minimum');
});

test('pointer capture preserves dragging across a live iframe and releases the resize state', { timeout: 30000 }, async t => {
    const {page,url}=await fixture(t);
    await open(page,url,'?mode=browser');
    const start=await grip(page), initial=await state(page);
    await page.mouse.move(start.x,start.y); await page.mouse.down(); await settle(page);
    assert.equal(await page.$eval(separator,el=>el.hasPointerCapture(1)),true);
    await page.mouse.move(start.x+50,start.y+100); await settle(page);
    closeTo((await state(page)).width,initial.width-50,'iframe crossing still resizes');
    await page.mouse.up(); await settle(page);
    assert.equal((await state(page)).resizing,false); assert.equal(await page.$eval(separator,el=>el.hasPointerCapture(1)),false);
});

test('expanded drawer keeps primary navigation and all three drawer tabs reachable without overlap', { timeout: 30000 }, async t => {
    const {page,url}=await fixture(t);
    for (const width of [1200,980]) for (const query of ['?mode=browser','?mode=browser&collapsed','?mode=browser&windows','?mode=browser&collapsed&windows']) {
        await page.setViewport({width,height:700});
        await open(page,url,query);
        await page.focus(separator); await page.keyboard.press('End'); await settle(page);
        const geometry=await page.evaluate(()=>{
            const inspect=selector=>[...document.querySelectorAll(selector)].map(el=>{
                const r=el.getBoundingClientRect(), hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
                return {text:el.textContent,left:r.left,right:r.right,top:r.top,bottom:r.bottom,reachable:hit===el||el.contains(hit)};
            });
            return {primary:inspect('.nmx-titlebar-primary-nav button'),drawer:inspect('.nmx-context-entry-tab'),close:inspect('.nmx-titlebar-context-close')};
        });
        for(const primary of geometry.primary){
            assert.ok(primary.left>=0&&primary.right<=width,`${width} ${query} primary nav fits: ${JSON.stringify(geometry)}`);
            assert.equal(primary.reachable,true,`${width} ${query} primary nav reachable: ${JSON.stringify(geometry)}`);
            for(const drawer of geometry.drawer)assert.ok(primary.right<=drawer.left||primary.left>=drawer.right||primary.bottom<=drawer.top||primary.top>=drawer.bottom,`${width} ${query} titlebar buttons overlap: ${JSON.stringify(geometry)}`);
        }
        assert.ok(geometry.drawer.every(item=>item.reachable),`${width} ${query} drawer tabs reachable: ${JSON.stringify(geometry)}`);
        assert.equal(geometry.close[0].reachable,true,`${width} ${query} close remains clickable`);
        assert.ok(geometry.close[0].right<=width-(query.includes('windows')?138:0),`${width} ${query} close avoids native caption controls`);
        await page.click('.nmx-titlebar-context-close'); await settle(page);
        assert.equal(await page.evaluate(()=>window.fixture.widget.workContextOpen),false);
    }
});
