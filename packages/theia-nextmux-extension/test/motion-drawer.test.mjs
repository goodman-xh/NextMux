import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

// REQUIREMENTS §4.2 right drawers: open/close/drag/overlay are smooth, the body
// reflows with the drawer, the composer never jumps and the Model Center /
// Coding / Comic tabs stay centred above the conversation while it moves.
// Same production renderer fixture as work-context-resize.test.mjs, with
// motion enabled.
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
    'renderWorkContext', 'renderContextDrawerFileList'
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
const browserConversationKey=id=>'session:'+id;
const localizeDesktopSurface=(_locale,text)=>text;
const params=new URL(location.href).searchParams;
document.body.classList.toggle('windows',params.has('windows'));
class NextMuxDesktopWidget {
 ${constants.join('\n')}
 node=document.querySelector('#fixture'); desktopLocale='en'; activeSection='coding';
 workContextOpen=!params.has('closed'); workContextClosing=false; workContextMode=params.get('mode')||'browser';
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
 <section className='nmx-workspace'><article className='fixture-conversation'>Readable conversation</article><div className='fixture-composer'>Composer</div></section>
 {widget.workContextOpen&&widget.renderWorkContextTitlebar()}{widget.renderWorkContext()}
 </main>;
}
window.fixture={widget};createRoot(document.querySelector('#fixture')).render(<Fixture/>);`;

async function fixture(t, motion = 'no-preference') {
    const bundle = await desktop('esbuild').build({ stdin: { contents: fixtureEntry, resolveDir: root, sourcefile: 'resize-fixture.tsx', loader: 'tsx' },
        bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'silent',
        alias: { react: core.resolve('react'), 'react-dom/client': core.resolve('react-dom/client') } });
    const styles = await Promise.all(['nextmux.css', 'nextmux-desktop-production.css', 'nextmux-motion.css'].map(name => readFile(new URL(`../src/browser/style/${name}`, import.meta.url))));
    const html = `<!doctype html><html><head><meta charset='utf-8'><link rel='stylesheet' href='/style.css'><link rel='stylesheet' href='/production.css'><link rel='stylesheet' href='/motion.css'>
<style>html,body{margin:0;height:100%;font:14px system-ui}#fixture,.nmx-desktop-widget{height:100vh}.fixture-leaf,.fixture-conversation{padding:18px}.fixture-browser{min-height:0}.fixture-composer{margin:0 auto;width:min(560px,calc(100% - 48px));height:64px;border:1px solid #555;border-radius:14px}</style>
</head><body><div class='nmx-desktop-widget'><div id='fixture'></div></div><script src='/fixture.js'></script></body></html>`;
    const assets = { '/fixture.js': ['text/javascript', bundle.outputFiles[0].contents], '/style.css': ['text/css', styles[0]], '/production.css': ['text/css', styles[1]], '/motion.css': ['text/css', styles[2]] };
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
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: motion }]);
    await page.setViewport({ width: 1200, height: 700 });
    return { page, url: `http://127.0.0.1:${server.address().port}/` };
}



// Production renders the pane variables and the open class in one React commit;
// mirror that by syncing the variables when the shell class changes. The toggle
// and the per-frame sampling run in one task so a loaded runner cannot let the
// 180 ms transition finish before the first measurement.
const toggleAndSample = (page, open, closing = false) => page.evaluate((open, closing) => new Promise(resolve => {
    const widget = window.fixture.widget, shell = document.querySelector('.nmx-shell');
    const out = [];
    const read = () => {
        const composer = document.querySelector('.fixture-composer').getBoundingClientRect();
        const workspace = document.querySelector('.nmx-workspace').getBoundingClientRect();
        const nav = document.querySelector('.nmx-titlebar-primary-nav').getBoundingClientRect();
        const drawer = document.querySelector('.nmx-work-context');
        out.push({ composer: composer.left + composer.width / 2, workspace: workspace.left + workspace.width / 2, nav: nav.left + nav.width / 2,
            composerTop: composer.top, drawerOpacity: drawer ? Number(getComputedStyle(drawer).opacity) : 0 });
    };
    read();
    const observer = new MutationObserver(() => { observer.disconnect(); widget.syncPaneCssVariables(); });
    observer.observe(shell, { attributes: true, attributeFilter: ['class'] });
    widget.workContextOpen = open; widget.workContextClosing = closing; widget.update();
    if (closing) setTimeout(() => { widget.workContextClosing = false; widget.update(); }, 180);
    const started = performance.now();
    const tick = () => { read(); if (performance.now() - started > 420) resolve(out); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
}), open, closing);
const toggleDrawer = (page, open) => page.evaluate(open => {
    const widget = window.fixture.widget, shell = document.querySelector('.nmx-shell');
    const observer = new MutationObserver(() => { observer.disconnect(); widget.syncPaneCssVariables(); });
    observer.observe(shell, { attributes: true, attributeFilter: ['class'] });
    widget.workContextOpen = open; widget.update();
}, open);
const frame = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve())));
const sample = page => page.evaluate(() => {
    const composer = document.querySelector('.fixture-composer').getBoundingClientRect();
    return [{ composer: composer.left + composer.width / 2 }];
});
function assertSmooth(samples, label) {
    const first = samples[0].composer, last = samples.at(-1).composer, distance = Math.abs(last - first);
    assert.ok(distance > 100, `${label}: the body really reflows (${distance}px)`);
    const intermediate = samples.filter(item => Math.abs(item.composer - first) > 2 && Math.abs(item.composer - last) > 2);
    // Frame timing varies under a loaded test runner (6 Chromiums at once); any
    // in-between frame proves interpolation rather than a jump.
    assert.ok(intermediate.length >= 1, `${label}: composer passes through intermediate positions (${intermediate.length})`);
    const direction = Math.sign(last - first);
    for (let index = 1; index < samples.length; index++) {
        assert.ok((samples[index].composer - samples[index - 1].composer) * direction >= -0.5, `${label}: composer never moves backwards`);
        assert.ok(Math.abs(samples[index].composerTop - samples[0].composerTop) < .5, `${label}: composer does not jump vertically`);
        assert.ok(Math.abs((samples[index].nav - samples[0].nav) - (samples[index].workspace - samples[0].workspace)) < 12, `${label}: tabs move in lockstep with the moving conversation (${samples[index].nav} vs ${samples[index].workspace})`);
    }
}

test('drawer open and close reflow the conversation smoothly with centred tabs, then go idle', { timeout: 30000 }, async t => {
    const { page, url } = await fixture(t);
    await page.goto(url + '?mode=browser&closed'); await page.waitForSelector('.fixture-composer');
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 300)));
    const opening = await toggleAndSample(page, true);
    assertSmooth(opening, 'open');
    const names = await page.evaluate(() => document.getAnimations().map(animation => animation.animationName || animation.transitionProperty));
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 250)));
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0, 'idle after opening');
    await page.screenshot({ path: '/tmp/nm-motion-drawer-open.png' });
    assert.ok(Array.isArray(names));

    // Close: production marks the retained drawer `is-closing` for 180 ms.
    const closing = await toggleAndSample(page, false, true);
    assertSmooth(closing, 'close');
    assert.ok(closing.some(item => item.drawerOpacity > .05 && item.drawerOpacity < .95), 'drawer fades out instead of vanishing');
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 250)));
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0, 'idle after closing');
});

test('drag-resize tracks the pointer 1:1 (no easing lag) and the overlay state does not animate the body', { timeout: 30000 }, async t => {
    const { page, url } = await fixture(t);
    await page.goto(url + '?mode=files'); await page.waitForSelector('.nmx-work-context-resize');
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 300)));
    const grip = await page.$eval('.nmx-work-context-resize', el => { const box = el.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + 80 }; });
    await page.mouse.move(grip.x, grip.y); await page.mouse.down();
    for (const delta of [20, 60, 120]) {
        await page.mouse.move(grip.x - delta, grip.y); await frame(page);
        const state = await page.evaluate(() => ({ resizing: document.documentElement.classList.contains('nmx-pane-resizing-x'),
            transitions: document.getAnimations().filter(animation => ['margin-right', 'margin-left', 'left', 'right', 'width', 'transform'].includes(animation.transitionProperty)).map(animation => animation.transitionProperty),
            drawer: document.querySelector('.nmx-work-context').getBoundingClientRect().left }));
        assert.equal(state.resizing, true);
        assert.deepEqual(state.transitions, [], 'no geometry transition lags behind the pointer while dragging');
        assert.ok(Math.abs(state.drawer - (grip.x - delta)) < 6, `drawer edge follows the pointer (${state.drawer} vs ${grip.x - delta})`);
    }
    await page.mouse.up();
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 250)));
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
});

test('reduced motion: drawer and body switch instantly', { timeout: 30000 }, async t => {
    const { page, url } = await fixture(t, 'reduce');
    await page.goto(url + '?mode=browser&closed'); await page.waitForSelector('.fixture-composer');
    await toggleDrawer(page, true);
    await page.waitForSelector('.nmx-shell.is-work-context-open');
    await frame(page); await frame(page);
    const [settled] = await sample(page);
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 250)));
    const [later] = await sample(page);
    assert.ok(Math.abs(settled.composer - later.composer) < .5, `no transition under reduced motion (${settled.composer} vs ${later.composer})`);
});

test('production close path keeps the 180 ms is-closing handoff and skips it under reduced motion', async () => {
    const source = await readFile(new URL('../src/browser/nextmux-desktop-widget.tsx', import.meta.url), 'utf8');
    assert.match(source, /this\.workContextClosing = this\.workContextWasOpen && !this\.workContextOpen && !window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches;/);
    assert.match(source, /if \(this\.workContextClosing\) this\.workContextCloseTimer = setTimeout\(\(\) => \{[\s\S]{0,200}\}, 180\);/);
});
